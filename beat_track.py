#!/usr/bin/env python3
"""Audio beat/downbeat times via Beat This (CPJKU), when installed."""
import argparse
import json
import math
import sys


def say(line):
    sys.stdout.write(line + '\n')
    sys.stdout.flush()


def beat_quality(beats):
    """Return a conservative 0..1 quality estimate for a beat sequence.

    Beat This can jump to subdivisions or half-time on dense piano.  The
    score writer needs a signal that says when the supplied grid is too
    unstable to trust; this uses only the returned inter-beat intervals.
    """
    values = []
    for raw in ([] if beats is None else beats):
        try:
            value = float(raw)
        except (TypeError, ValueError):
            continue
        if math.isfinite(value):
            values.append(value)
    values.sort()
    if len(values) < 4:
        return 0.0, 0.0, None
    ibis = [b - a for a, b in zip(values, values[1:]) if b - a >= 0.02]
    if len(ibis) < 3:
        return 0.0, 0.0, None
    ordered = sorted(ibis)
    median = ordered[len(ordered) // 2]
    if not median or not math.isfinite(median):
        return 0.0, 0.0, None
    mean = sum(ibis) / len(ibis)
    variance = sum((x - mean) ** 2 for x in ibis) / len(ibis)
    cv = math.sqrt(variance) / median
    outliers = sum(1 for x in ibis if x < median * 0.55 or x > median * 1.8)
    score = math.exp(-2.4 * min(cv, 1.5)) * max(0.0, 1.0 - outliers / len(ibis) * 1.5)
    return (round(max(0.0, min(1.0, score)), 5), round(cv, 5), round(median, 5))


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
    quality, ibi_cv, ibi_median = beat_quality(result['beats'])
    result['confidence'] = quality
    result['ibiCv'] = ibi_cv
    result['ibiMedian'] = ibi_median
    with open(a.out, 'w', encoding='utf-8') as f:
        json.dump(result, f)
    say('PROGRESS 1')
    say('DONE')


if __name__ == '__main__':
    main()
