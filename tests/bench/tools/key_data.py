#!/usr/bin/env python3
"""The key and spelling stage's evaluation data (G10a-3, stage S8; docs/GOALS/G10 section 8.1).

    python tests/bench/tools/key_data.py [--out tests/bench/.cache/key/truth.json]

Reads every registered, licence-clean reference (the ``full`` suite's list, as for the hand model: quarantined and broken
files are already out) with the benchmark's own reader and writes, per reference, the key signature of each bar and every
key press in onset order with its written spelling:

    [onset in quarters, duration in quarters, midi, staff, step, alter, bar index, velocity-free]

The notes are what ``notation.spelling.accuracy`` calls the written pitch of a note and what ``struct.key.*`` call the key
signature in force. Hold-out references are written too, marked ``holdout``: tuning never reads them, evaluation reports
them. The output is note-level data and stays in the git-ignored cache (never committed: the roadmap's data rule);
``rec/tools/key-eval.js`` turns it into the aggregate numbers committed in ``rec/tools/key-v1.evaluation.json``.
"""

from __future__ import annotations

import argparse
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

from pppbench import corpus, suite as suite_mod, util  # noqa: E402

util.setup_stdio()
DEFAULT_OUT = os.path.join(util.bench_root(), ".cache", "key", "truth.json")


def references():
    by = corpus.by_id(corpus.load_corpus())
    return [by[r] for r in sorted(suite_mod.load_suite("full")["references"])]


def piece(entry) -> dict:
    ref = corpus.read_reference(entry)
    if "struct.key.fifths_exact" in (entry.expect.get("skip_metrics") or ()):
        trusted = False
    else:
        trusted = True
    notes = sorted(ref.played(), key=lambda s: (s.onset_q, s.midi, s.id))
    return {
        "id": entry.id, "set": entry.set, "book": entry.book, "holdout": bool(entry.holdout), "trusted": trusted,
        "bars": [[round(float(m.start_q), 6), round(float(m.len_q), 6), m.fifths, m.mode] for m in ref.measures],
        "notes": [[round(float(s.onset_q), 6), round(float(s.dur_q), 6), s.midi, 1 if s.staff == 1 else 2, s.step, s.alter,
                   s.measure] for s in notes],
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=DEFAULT_OUT)
    args = ap.parse_args()
    pieces = []
    for entry in references():
        p = piece(entry)
        if p["notes"]:
            pieces.append(p)
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    util.dump_json({"schema": "ppp.key-truth/1", "pieces": pieces}, args.out)
    n_hold = sum(p["holdout"] for p in pieces)
    print(f"wrote {args.out}: {len(pieces)} references ({len(pieces) - n_hold} tuning, {n_hold} hold-out), "
          f"{sum(len(p['notes']) for p in pieces)} key presses")
    return 0


if __name__ == "__main__":
    sys.exit(main())
