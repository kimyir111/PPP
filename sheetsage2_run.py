#!/usr/bin/env python3
"""Run SheetSage2 (m-a-p/SheetSage2, "SheetSage2: Coherent Lead-Sheet Transcription with Synthetic Supervision", 2026: a full
song to a lead sheet - melody, chords, beats, key, structure - on the MERT-v2-FullSong encoder) on one audio file and write its
melody as a MIDI file. transcribe.py calls this in song mode in SheetSage2's own Python (transformers 4.45.2, numpy 1.24.3), so
its packages never touch the piano models' environment. The weights are CC BY-NC 4.0: non-commercial use only.

  python sheetsage2_run.py --model-dir D:/PPP/tools/sheetsage2 --wav song.wav --out-dir out   (writes out/melody.mid, out/events.json)
  python sheetsage2_run.py --model-dir D:/PPP/tools/sheetsage2 --selftest                     (loads the model, downloading the
                                                                                                encoder the first time, and runs it)

Written from the model card and the YuE2 setup notes without the model at hand: if a newer SheetSage2 changes transcribe(),
the error below names what failed.
"""

import argparse
import glob
import os
import shutil
import sys


def fail(msg):
    sys.stderr.write('SHEETSAGE2_FAILED: ' + msg + '\n')
    raise SystemExit(2)


def utf8_stdio():
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding='utf-8', errors='replace')
        except Exception:
            pass


def stage_remote_code(model_dir):
    """transformers runs a model's own code from a copy in its modules cache (transformers_modules/<folder name>), and copies only
    the modeling file and the files it imports statically; SheetSage2's code opens its other modules (chord_spelling_sheetsage2.py,
    ...) beside itself, so the first load failed with FileNotFoundError. Every file of the model folder but the weights is copied
    there first."""
    try:
        from transformers.utils import HF_MODULES_CACHE
    except Exception:
        return
    dest = os.path.join(HF_MODULES_CACHE, 'transformers_modules', os.path.basename(os.path.normpath(model_dir)))
    for root, dirs, files in os.walk(model_dir):
        dirs[:] = [d for d in dirs if not d.startswith('.')]
        for name in files:
            src = os.path.join(root, name)
            if name.startswith('.') or name.endswith(('.safetensors', '.bin', '.pt', '.ckpt')) or os.path.getsize(src) > 20 * 1024 * 1024:
                continue
            to = os.path.join(dest, os.path.relpath(src, model_dir))
            os.makedirs(os.path.dirname(to), exist_ok=True)
            if not os.path.exists(to) or os.path.getmtime(to) < os.path.getmtime(src):
                shutil.copyfile(src, to)
    init = os.path.join(dest, '__init__.py')
    if not os.path.exists(init):
        open(init, 'w').close()


def load(model_dir, device):
    try:
        import torch
        from transformers import AutoModel
    except Exception as e:
        fail('could not import torch/transformers: %s: %s' % (type(e).__name__, e))
    if not os.path.isfile(os.path.join(model_dir, 'config.json')):
        fail('config.json is not in %s (setup-sheetsage2.cmd downloads m-a-p/SheetSage2 there)' % model_dir)
    stage_remote_code(model_dir)
    try:
        model = AutoModel.from_pretrained(model_dir, trust_remote_code=True).eval().to(device)
    except Exception as e:
        fail('could not load the model: %s: %s (the first load downloads m-a-p/MERT-v2-FullSong, ~2.5 GB)' % (type(e).__name__, str(e)[:400]))
    return model


def transcribe(model, y, sr, wav, out_dir, device):
    """The model's transcribe() on the samples (mono, with their rate); on the file path when this version takes no arrays."""
    kw = {'output_dir': out_dir, 'dtype': 'bf16' if device == 'cuda' else 'fp32'}
    try:
        return model.transcribe(y, sampling_rate=sr, **kw)
    except TypeError:
        return model.transcribe(wav, **kw)
    except RuntimeError as e:   # the card: a failure carries what was transcribed as e.result
        if getattr(e, 'result', None) is not None:
            return e.result
        raise


def write_melody(result, out_dir):
    """out_dir/melody.mid from the files transcribe() wrote, or from result['midis']['melody'] (MIDI bytes)."""
    target = os.path.join(out_dir, 'melody.mid')
    if os.path.isfile(target):
        return target
    found = sorted(glob.glob(os.path.join(out_dir, '**', 'melody.mid'), recursive=True))
    if found:
        shutil.copyfile(found[0], target)
        return target
    midis = result.get('midis') if isinstance(result, dict) else None
    data = midis.get('melody') if isinstance(midis, dict) else None
    if isinstance(data, (bytes, bytearray)) and data:
        with open(target, 'wb') as f:
            f.write(data)
        return target
    fail('the model wrote no melody MIDI (files: %s)' % ', '.join(sorted(os.listdir(out_dir)))[:400])


def main():
    utf8_stdio()
    ap = argparse.ArgumentParser()
    ap.add_argument('--model-dir', required=True)
    ap.add_argument('--wav', default='')
    ap.add_argument('--out-dir', default='')
    ap.add_argument('--device', default='auto')
    ap.add_argument('--selftest', action='store_true')
    a = ap.parse_args()
    device = a.device
    if device == 'auto':
        try:
            import torch
            device = 'cuda' if torch.cuda.is_available() else 'cpu'
        except Exception:
            device = 'cpu'
    import numpy as np
    model = load(os.path.abspath(a.model_dir), device)
    if a.selftest:
        import tempfile
        sr = 24000
        t = np.arange(sr * 12) / sr
        y = (0.3 * np.sin(2 * np.pi * 440 * t)).astype(np.float32)   # twelve seconds of A4: enough to run every stage once
        with tempfile.TemporaryDirectory() as d:
            try:
                transcribe(model, y, sr, '', d, device)
            except Exception as e:
                fail('the model loaded but could not run on %s: %s: %s' % (device, type(e).__name__, str(e)[:400]))
        print('SheetSage2: OK - the model loaded and ran on ' + device)
        return
    if not a.wav or not os.path.isfile(a.wav) or not a.out_dir:
        fail('--wav (an existing file) and --out-dir are needed')
    import soundfile as sf
    y, sr = sf.read(a.wav, dtype='float32', always_2d=True)
    os.makedirs(a.out_dir, exist_ok=True)
    try:
        result = transcribe(model, y.mean(axis=1), sr, os.path.abspath(a.wav), a.out_dir, device)
    except Exception as e:
        fail('transcription failed: %s: %s' % (type(e).__name__, str(e)[:400]))
    print('SheetSage2: wrote ' + write_melody(result, a.out_dir))
    gather(result, a.out_dir)


def gather(result, out_dir):
    """The annotations transcribe() wrote (beat.lab, downbeat.lab, key.lab, chord.lab, events.json), wherever under out_dir, copied
    to out_dir itself for transcribe.py; and result.json, a summary of what transcribe() returned (its keys, and its events when
    they are plain data), so that a version that writes them elsewhere can be read from it."""
    import json
    for name in ('beat.lab', 'downbeat.lab', 'key.lab', 'chord.lab', 'events.json'):
        target = os.path.join(out_dir, name)
        if os.path.isfile(target):
            continue
        found = sorted(glob.glob(os.path.join(out_dir, '**', name), recursive=True))
        if found:
            shutil.copyfile(found[0], target)
    summary = {'files': sorted(os.path.relpath(p, out_dir).replace(os.sep, '/') for p in glob.glob(os.path.join(out_dir, '**', '*'), recursive=True)
                               if os.path.isfile(p))[:200]}
    if isinstance(result, dict):
        summary['keys'] = sorted(str(k) for k in result.keys())
        for k in ('events', 'key', 'tempo', 'meter'):
            try:
                json.dumps(result.get(k))
                summary[k] = result.get(k)
            except (TypeError, ValueError):
                summary[k] = repr(result.get(k))[:2000]
    with open(os.path.join(out_dir, 'result.json'), 'w', encoding='utf-8') as f:
        json.dump(summary, f)


if __name__ == '__main__':
    main()
