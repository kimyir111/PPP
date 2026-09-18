#!/usr/bin/env python3
"""
PPP piano transcription worker.

Audio in, notes out. Runs the high-resolution piano transcription model of
Kong et al. (ByteDance, Apache-2.0) over a 16 kHz mono WAV and writes the notes
and pedal it hears as JSON. It does not write notation: bars, beats, hands and
spelling are decided by PPP in the browser, from these notes, so the same code
handles every engine.

  python transcribe.py --wav in.wav --out notes.json --checkpoint model.pth

Progress goes to stdout, one line at a time, for omr-service.js to relay:

  PROGRESS 0.42
  DONE

Started by omr-service.js, never by the browser. It reads only the WAV it is
given and writes only the JSON it is told to.
"""

import argparse
import json
import os
import sys
import time


def say(line):
    sys.stdout.write(line + '\n')
    sys.stdout.flush()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--wav', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--checkpoint', required=True)
    ap.add_argument('--device', default='auto')
    a = ap.parse_args()

    t0 = time.time()
    import numpy as np
    import soundfile as sf
    import torch
    from piano_transcription_inference import PianoTranscription
    from piano_transcription_inference.utilities import RegressionPostProcessor
    from piano_transcription_inference.pytorch_utils import move_data_to_device

    audio, sr = sf.read(a.wav, dtype='float32', always_2d=False)
    if audio.ndim > 1:
        audio = audio.mean(axis=1)
    if sr != 16000:
        raise SystemExit('expected 16 kHz audio, got %d' % sr)

    if a.device == 'auto':
        device = 'cuda' if torch.cuda.is_available() else 'cpu'
    else:
        device = a.device
    if device == 'cpu':
        torch.set_num_threads(max(1, os.cpu_count() or 1))

    # The library prints as it loads; keep stdout for our own protocol.
    real_stdout = sys.stdout
    sys.stdout = sys.stderr
    try:
        pt = PianoTranscription(checkpoint_path=a.checkpoint, device=torch.device(device))
    finally:
        sys.stdout = real_stdout
    model = pt.model
    model.eval()
    say('PROGRESS 0.02')

    # The library's own transcribe(), with progress: pad, cut into half-
    # overlapping ten-second segments, run them one at a time, stitch back.
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

    result = {
        'engine': 'piano-transcription',
        'model': 'Kong et al. 2021, high-resolution piano transcription',
        'device': device,
        'duration': n / 16000.0,
        'ms': int((time.time() - t0) * 1000),
        'notes': [{
            'on': round(float(e['onset_time']), 4),
            'off': round(float(e['offset_time']), 4),
            'midi': int(e['midi_note']),
            'vel': int(e['velocity'])
        } for e in notes],
        'pedals': [{
            'on': round(float(e['onset_time']), 4),
            'off': round(float(e['offset_time']), 4)
        } for e in (pedals or [])]
    }
    with open(a.out, 'w', encoding='utf-8') as f:
        json.dump(result, f)
    say('PROGRESS 1')
    say('DONE')


if __name__ == '__main__':
    main()
