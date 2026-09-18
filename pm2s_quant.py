#!/usr/bin/env python3
"""Performance notes JSON → quantized musical grid via PM2S, when installed."""
import argparse
import json
import os
import sys
import tempfile

import midi_notes


def say(line):
    sys.stdout.write(line + '\n')
    sys.stdout.flush()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--notes', required=True)
    ap.add_argument('--out', required=True)
    a = ap.parse_args()
    heard = json.load(open(a.notes, encoding='utf-8'))
    notes = heard.get('notes') or []
    if len(notes) < 4:
        raise SystemExit('too few notes')
    try:
        from pm2s.pm2s import CRNNJointPM2S
    except Exception:
        try:
            from pm2s import CRNNJointPM2S
        except Exception as e:
            raise SystemExit('pm2s is not installed: %s' % e)

    perf = tempfile.NamedTemporaryFile(suffix='.mid', delete=False)
    score = tempfile.NamedTemporaryFile(suffix='.mid', delete=False)
    perf.close()
    score.close()
    midi_notes.write_notes(perf.name, notes)
    say('PROGRESS 0.2')
    real = sys.stdout
    sys.stdout = sys.stderr
    try:
        conv = CRNNJointPM2S()
        conv.convert(perf.name, score.name)
    finally:
        sys.stdout = real
    parsed = midi_notes.read_notes(score.name)
    try:
        os.unlink(perf.name)
        os.unlink(score.name)
    except OSError:
        pass
    tpq = parsed['ticksPerQuarter']
    grid_notes = []
    for n in parsed['notes']:
        tick = int(round(n['on'] * tpq * parsed['bpm'] / 60))
        end = int(round(n['off'] * tpq * parsed['bpm'] / 60))
        grid_notes.append({
            'midi': n['midi'], 'vel': n['vel'],
            'tick': tick, 'endTick': max(tick + 1, end),
            'on': n['on'], 'off': n['off']
        })
    result = {
        'engine': 'pm2s',
        'ticksPerQuarter': tpq,
        'beatsPerBar': parsed['beatsPerBar'],
        'beatType': parsed['beatType'],
        'bpm': parsed['bpm'],
        'notes': grid_notes
    }
    with open(a.out, 'w', encoding='utf-8') as f:
        json.dump(result, f)
    say('PROGRESS 1')
    say('DONE')


if __name__ == '__main__':
    main()
