#!/usr/bin/env python3
"""The melody of a song as a lead sheet writes it, with Sheet Sage's melody model (Donahue, Thickstun & Liang, "Melody
transcription via generative pre-training", ISMIR 2022; https://github.com/chrisdonahue/sheetsage), run natively here instead
of in its Linux Docker image: its handcrafted-feature model (the Onsets & Frames log-mel spectrogram averaged over each 16th
note of the beat grid, a 6-layer transformer, CPU) and Beat This for the beats in place of madmom.

A note transcriber (YourMT3) writes every instrument, and PPP then has to guess which line is the tune; this model was trained
on 50+ hours of human lead sheets (HookTheory) to write the tune itself - the line a person would put on the top staff.

    python sheetsage_melody.py --get-model            downloads the model (~100 MB) to tools/sheetsage
    python sheetsage_melody.py --wav song.wav --out melody.json [--beats beats.json]

The trained model is CC BY-NC-SA 3.0 (derived from HookTheory user contributions): non-commercial use only. The model code
(sheetsage_modules.py) is MIT.
"""

import argparse
import hashlib
import json
import os
import sys
import urllib.request

ASSET_URL = 'https://sheetsage.s3.amazonaws.com/sheetsage/v0.2/'
ASSETS = {   # name -> (path under ASSET_URL, checksum: sha1 for 40 hex digits, sha256 for 64)
    'moments': ('oafmelspec_moments.npy', '81d20995052676ca4cd60afd2657c8fa0c10e21c0895b39cda85fe3f4d1255e5'),
    'cfg': ('0919_00_e0830_oafmelspecnorm/7d82e6839e582936ea428a823a0d868075a52dc5.cfg.json', '7d82e6839e582936ea428a823a0d868075a52dc5'),
    'model': ('0919_00_e0830_oafmelspecnorm/model.pt', '70f10a4146da8f1294597516622901d93621c5cd1bbb4e9dc831f9c43c081ef4'),
}
DEFAULT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'tools', 'sheetsage')

SR = 16000                 # the Onsets & Frames mel spectrogram the model was trained on
N_FFT, HOP, FMIN, N_MELS = 2048, 512, 30.0, 229
TERTIARIES_PER_BEAT = 4    # one input frame (and one prediction) per 16th note
MAX_TERTIARIES = 384       # the model's input length
BEATS_PER_CHUNK = 32       # eight 4/4 bars a chunk, as Sheet Sage
PITCH_MIN = 21             # prediction k > 0 is MIDI PITCH_MIN + k - 1; 0 is "no onset"


def _checksum(path, digest):
    h = hashlib.sha1() if len(digest) == 40 else hashlib.sha256()
    with open(path, 'rb') as f:
        for block in iter(lambda: f.read(1 << 20), b''):
            h.update(block)
    return h.hexdigest()


def asset(name, root=DEFAULT_DIR, download=False):
    rel, digest = ASSETS[name]
    path = os.path.join(root, os.path.basename(rel))
    if os.path.isfile(path) and _checksum(path, digest) == digest:
        return path
    if not download:
        raise FileNotFoundError('the Sheet Sage model is not downloaded (python sheetsage_melody.py --get-model): ' + path)
    os.makedirs(root, exist_ok=True)
    tmp = path + '.part'
    urllib.request.urlretrieve(ASSET_URL + rel, tmp)
    if _checksum(tmp, digest) != digest:
        os.remove(tmp)
        raise RuntimeError('the download of %s is damaged (checksum)' % rel)
    os.replace(tmp, path)
    return path


def ready(root=DEFAULT_DIR):
    try:
        for name in ASSETS:
            asset(name, root)
        return True
    except Exception:
        return False


def load_model(root=DEFAULT_DIR):
    import torch
    import sheetsage_modules as M
    with open(asset('cfg', root), 'r') as f:
        cfg = json.load(f)
    if cfg.get('src_max_len') != MAX_TERTIARIES or cfg.get('model') != 'transformer':
        raise RuntimeError('unexpected Sheet Sage model configuration')
    model = M.EncOnlyTransducer(
        89, src_emb_mode='project', src_vocab_size=None, src_dim=N_MELS, src_emb_dim=512,
        src_pos_emb='pos_emb' in cfg.get('hacks', []), src_dropout_p=0.1, enc_cls=M.TransformerEncoder,
        enc_kwargs={'model_dim': 512, 'num_heads': 8, 'num_layers': 4 if '4layers' in cfg.get('hacks', []) else 6,
                    'feedforward_dim': 2048, 'dropout_p': 0.1})
    model.load_state_dict(torch.load(asset('model', root), map_location='cpu'))
    model.eval()
    return model


def features(y, sr):
    """Log-mel frames (SR / HOP a second) of a mono signal."""
    import numpy as np
    import librosa
    if sr != SR:
        y = librosa.resample(y, orig_sr=sr, target_sr=SR)
    mel = librosa.feature.melspectrogram(y=y, sr=SR, n_fft=N_FFT, hop_length=HOP, fmin=FMIN, n_mels=N_MELS, htk=False).T
    return librosa.power_to_db(mel.astype(np.float32))


def tertiaries(beats):
    """Times of every 16th note from the first beat to the last."""
    import numpy as np
    beats = np.asarray(beats, dtype=np.float64)
    out = []
    for b0, b1 in zip(beats[:-1], beats[1:]):
        out.extend(b0 + (b1 - b0) * k / TERTIARIES_PER_BEAT for k in range(TERTIARIES_PER_BEAT))
    out.append(beats[-1])
    return np.asarray(out)


def beat_resample(feats, times):
    """The mean frame of each 16th note: len(times) - 1 rows."""
    import numpy as np
    fr = SR / float(HOP)
    rows = []
    for t0, t1 in zip(times[:-1], times[1:]):
        s = int(t0 * fr)
        e = max(s + 1, int(t1 * fr))
        seg = feats[s:min(e, len(feats))]
        rows.append(seg.mean(axis=0) if len(seg) else feats[-1])
    return np.stack(rows).astype(np.float32)


def transcribe(y, sr, beats, downbeats=(), root=DEFAULT_DIR, model=None):
    """[{'on', 'off', 'midi'}]: one melody note per predicted onset, lasting until the next onset or for at most two beats."""
    import numpy as np
    import torch
    beats = [float(b) for b in beats]
    if len(beats) < 4:
        return []
    times = tertiaries(beats)
    tfeat = beat_resample(features(y, sr), times)
    moments = np.load(asset('moments', root))
    tfeat = (tfeat - moments[0]) / moments[1]   # normalized after the beat resampling, as the model was trained
    model = model or load_model(root)
    # chunks of BEATS_PER_CHUNK beats from the first downbeat (the pickup before it a chunk of its own)
    start = 0
    if len(downbeats):
        d0 = float(downbeats[0])
        start = min(range(len(beats)), key=lambda i: abs(beats[i] - d0))
    edges = sorted(set([0, start] + list(range(start, len(beats) - 1, BEATS_PER_CHUNK)) + [len(beats) - 1]))
    preds = np.zeros(len(tfeat), dtype=np.int64)
    with torch.no_grad():
        for b0, b1 in zip(edges[:-1], edges[1:]):
            s, e = b0 * TERTIARIES_PER_BEAT, b1 * TERTIARIES_PER_BEAT
            if e <= s:
                continue
            src = tfeat[s:e]
            n = src.shape[0]
            src = np.pad(src, [(0, MAX_TERTIARIES - n), (0, 0)])[:, np.newaxis]
            logits = model(torch.tensor(src).float(), torch.tensor([n]).long(), None, None)[:n, 0].numpy()
            preds[s:e] = logits.argmax(axis=-1)
    onsets = [(i, int(p) - 1 + PITCH_MIN) for i, p in enumerate(preds) if p != 0]
    out = []
    beat_s = float(np.median(np.diff(beats)))
    for k, (i, midi) in enumerate(onsets):
        nxt = onsets[k + 1][0] if k + 1 < len(onsets) else len(times) - 1
        on = float(times[i])
        off = min(float(times[min(nxt, len(times) - 1)]), on + 2 * beat_s)
        out.append({'on': round(on, 4), 'off': round(max(off, on + 0.05), 4), 'midi': midi})
    return out


def beats_of(wav, device='cpu'):
    """Beat This (as beat_track.py): (beats, downbeats)."""
    from beat_this.inference import File2Beats
    real = sys.stdout
    sys.stdout = sys.stderr
    try:
        beats, downbeats = File2Beats(checkpoint_path='final0', device=device)(wav)
    finally:
        sys.stdout = real
    return [float(t) for t in beats], [float(t) for t in downbeats]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--get-model', action='store_true')
    ap.add_argument('--dir', default=DEFAULT_DIR)
    ap.add_argument('--wav', default='')
    ap.add_argument('--beats', default='', help="a beat_track.py JSON ({'beats', 'downbeats'}); otherwise Beat This runs")
    ap.add_argument('--out', default='')
    a = ap.parse_args()
    if a.get_model:
        for name in ASSETS:
            print('Sheet Sage: ' + asset(name, a.dir, download=True))
        load_model(a.dir)
        print('Sheet Sage: OK - the melody model loaded')
        return
    import soundfile as sf
    y, sr = sf.read(a.wav, dtype='float32', always_2d=True)
    if a.beats:
        with open(a.beats, 'r', encoding='utf-8') as f:
            b = json.load(f)
        beats, downbeats = b['beats'], b.get('downbeats', [])
    else:
        beats, downbeats = beats_of(a.wav)
    notes = transcribe(y.mean(axis=1), sr, beats, downbeats, a.dir)
    with open(a.out, 'w', encoding='utf-8') as f:
        json.dump({'notes': notes}, f)
    print('Sheet Sage: %d melody notes' % len(notes))


if __name__ == '__main__':
    main()
