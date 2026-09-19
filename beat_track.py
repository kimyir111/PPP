#!/usr/bin/env python3
"""Audio beat/downbeat times via Beat This (CPJKU), when installed."""
import argparse
import json
import sys


def say(line):
    sys.stdout.write(line + '\n')
    sys.stdout.flush()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--wav', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--device', default='cpu')
    a = ap.parse_args()
    try:
        from beat_this.inference import File2Beats
    except Exception as e:
        raise SystemExit('beat-this is not installed: %s' % e)
    say('PROGRESS 0.1')
    real = sys.stdout
    sys.stdout = sys.stderr
    try:
        f2b = File2Beats(checkpoint_path='final0', device=a.device)
        beats, downbeats = f2b(a.wav)
    finally:
        sys.stdout = real
    result = {
        'engine': 'beat-this',
        'beats': [round(float(t), 4) for t in ([] if beats is None else beats)],
        'downbeats': [round(float(t), 4) for t in ([] if downbeats is None else downbeats)]
    }
    with open(a.out, 'w', encoding='utf-8') as f:
        json.dump(result, f)
    say('PROGRESS 1')
    say('DONE')


if __name__ == '__main__':
    main()
