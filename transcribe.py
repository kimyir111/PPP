#!/usr/bin/env python3
"""
PPP piano transcription worker.

Audio in, notes out. Prefers Transkun when it is installed; otherwise Kong et al.
(ByteDance, Apache-2.0). Writes notes and pedal as JSON. It does not write
notation: bars, beats, hands and spelling are decided by PPP, from these notes.

  python transcribe.py --wav in.wav --out notes.json [--checkpoint model.pth] [--engine auto|transkun|kong]

Progress goes to stdout, one line at a time, for omr-service.js to relay.
"""

import argparse
import json
import os
import sys
import time


def say(line):
    sys.stdout.write(line + '\n')
    sys.stdout.flush()


def have_transkun():
    try:
        import transkun  # noqa: F401
        return True
    except Exception:
        return False


def transkun_cmd(python, wav, midi, device):
    """How Transkun is actually launched. PyPI: python -m transkun.transcribe
    audio out.mid  (console script: transkun). There is no transkun.__main__
    and no transkun.commandline."""
    device = device or 'cpu'
    python = python or sys.executable
    script = os.path.join(os.path.dirname(os.path.abspath(python)), 'transkun')
    if os.name == 'nt':
        script += '.exe'
    return {
        'module': [python, '-m', 'transkun.transcribe', wav, midi, '--device', device],
        'script': [script, wav, midi, '--device', device]
    }


def transcribe_transkun(wav, device):
    import subprocess
    import tempfile
    import midi_notes
    mid = tempfile.NamedTemporaryFile(suffix='.mid', delete=False)
    mid.close()
    cmds = transkun_cmd(sys.executable, wav, mid.name, device)
    last_err = b''
    try:
        for key in ('module', 'script'):
            cmd = cmds[key]
            if key == 'script' and not os.path.isfile(cmd[0]):
                continue
            r = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            if r.returncode == 0:
                parsed = midi_notes.read_notes(mid.name)
                return parsed['notes'], []
            last_err = r.stderr or r.stdout or b''
        raise RuntimeError((last_err or b'transkun failed').decode('utf-8', 'replace')[:800])
    finally:
        try:
            os.unlink(mid.name)
        except OSError:
            pass


def transcribe_kong(wav, checkpoint, device):
    import numpy as np
    import soundfile as sf
    import torch
    from piano_transcription_inference import PianoTranscription
    from piano_transcription_inference.utilities import RegressionPostProcessor
    from piano_transcription_inference.pytorch_utils import move_data_to_device

    audio, sr = sf.read(wav, dtype='float32', always_2d=False)
    if audio.ndim > 1:
        audio = audio.mean(axis=1)
    if sr != 16000:
        raise SystemExit('expected 16 kHz audio, got %d' % sr)

    real_stdout = sys.stdout
    sys.stdout = sys.stderr
    try:
        pt = PianoTranscription(checkpoint_path=checkpoint, device=torch.device(device))
    finally:
        sys.stdout = real_stdout
    model = pt.model
    model.eval()
    say('PROGRESS 0.02')

    seg = pt.segment_samples
    x = audio[None, :].astype(np.float32)
    n = x.shape[1]
    pad = int(np.ceil(n / seg)) * seg - n
    x = np.concatenate((x, np.zeros((1, pad), dtype=np.float32)), axis=1)
    segments = pt.enframe(x, seg)

    outputs = {}
    total = len(segments)
    with torch.no_grad():
        for i in range(total):
            batch = move_data_to_device(segments[i:i + 1], device)
            out = model(batch)
            for k, v in out.items():
                outputs.setdefault(k, []).append(v.data.cpu().numpy())
            say('PROGRESS %.3f' % (0.02 + 0.93 * (i + 1) / total))
    for k in list(outputs.keys()):
        outputs[k] = pt.deframe(np.concatenate(outputs[k], axis=0))[0:n]

    post = RegressionPostProcessor(
        pt.frames_per_second, classes_num=pt.classes_num,
        onset_threshold=pt.onset_threshold, offset_threshold=pt.offset_threshod,
        frame_threshold=pt.frame_threshold, pedal_offset_threshold=pt.pedal_offset_threshold)
    notes, pedals = post.output_dict_to_midi_events(outputs)
    out_notes = [{
        'on': round(float(e['onset_time']), 4),
        'off': round(float(e['offset_time']), 4),
        'midi': int(e['midi_note']),
        'vel': int(e['velocity'])
    } for e in notes]
    out_pedals = [{
        'on': round(float(e['onset_time']), 4),
        'off': round(float(e['offset_time']), 4)
    } for e in (pedals or [])]
    return out_notes, out_pedals, n / 16000.0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--wav', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--checkpoint', default='')
    ap.add_argument('--device', default='auto')
    ap.add_argument('--engine', default='auto')
    a = ap.parse_args()

    t0 = time.time()
    import soundfile as sf
    import torch

    audio, sr = sf.read(a.wav, dtype='float32', always_2d=False)
    duration = (audio.shape[0] if audio.ndim == 1 else audio.shape[0]) / float(sr)

    if a.device == 'auto':
        device = 'cuda' if torch.cuda.is_available() else 'cpu'
    else:
        device = a.device
    if device == 'cpu':
        torch.set_num_threads(max(1, os.cpu_count() or 1))

    engine = a.engine
    notes, pedals = None, []
    if engine in ('auto', 'transkun') and have_transkun():
        say('PROGRESS 0.05')
        try:
            notes, pedals = transcribe_transkun(a.wav, device)
            engine = 'transkun'
            say('PROGRESS 0.95')
        except Exception as e:
            sys.stderr.write('transkun failed, falling back to Kong: %s\n' % e)
            notes = None
            engine = 'auto'
    if notes is None:
        if not a.checkpoint:
            raise SystemExit('no Transkun and no Kong checkpoint')
        notes, pedals, duration = transcribe_kong(a.wav, a.checkpoint, device)
        engine = 'piano-transcription'

    model_name = (
        'Transkun (Yan & Duan), piano transcription' if engine == 'transkun'
        else 'Kong et al. 2021, high-resolution piano transcription')
    result = {
        'engine': engine,
        'model': model_name,
        'device': device,
        'duration': duration,
        'ms': int((time.time() - t0) * 1000),
        'notes': notes,
        'pedals': pedals or []
    }
    with open(a.out, 'w', encoding='utf-8') as f:
        json.dump(result, f)
    say('PROGRESS 1')
    say('DONE')


if __name__ == '__main__':
    main()
