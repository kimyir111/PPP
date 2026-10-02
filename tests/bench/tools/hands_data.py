#!/usr/bin/env python3
"""The hand model's training and evaluation data (G10a-2, stage S4; docs/GOALS/G10 section 8.3 AI-5b).

    python tests/bench/tools/hands_data.py [--out tests/bench/.cache/hands/truth.json]

Reads every registered, licence-clean reference with two piano staves (the benchmark's own reader, so the hand of a
note is exactly what ``notation.hand.accuracy`` calls its hand: the upper piano staff is the right hand) and writes,
per reference, its key presses in onset order: ``[onset in quarters, onset in seconds at the reference tempo, midi,
hand (1 right / 2 left)]``. Hold-out references are written too, marked ``holdout``: the trainer never fits on them, it
only reports them. The output is note-level data and stays in the git-ignored cache (never committed, G10-D15 / the
roadmap's data rule); ``tests/bench/tools/train_hands.js`` turns it into the aggregate tables of ``rec/hands-model.json``.
"""

from __future__ import annotations

import argparse
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

from pppbench import corpus, util  # noqa: E402

util.setup_stdio()
DEFAULT_OUT = os.path.join(util.bench_root(), ".cache", "hands", "truth.json")


def piece(entry) -> dict:
    ref = corpus.read_reference(entry)
    if ref.staves < 2 or "notation.hand.accuracy" in (entry.expect.get("skip_metrics") or ()):
        return None
    qpm = float(entry.expect.get("tempo_qpm") or ref.effective_qpm or 100)
    notes = sorted(ref.played(), key=lambda s: (s.onset_q, s.midi, s.id))
    rows = [[round(float(s.onset_q), 6), round(float(s.onset_q) * 60.0 / qpm, 6), s.midi, 1 if s.hand == "r" else 2]
            for s in notes]
    return {"id": entry.id, "set": entry.set, "book": entry.book, "holdout": bool(entry.holdout), "qpm": qpm, "notes": rows}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=DEFAULT_OUT)
    args = ap.parse_args()
    pieces = []
    for entry in sorted(corpus.load_corpus(), key=lambda e: e.id):
        if entry.set == "omr":
            continue
        p = piece(entry)
        if p and p["notes"]:
            pieces.append(p)
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    util.dump_json({"schema": "ppp.hands-truth/1", "pieces": pieces}, args.out)
    n_hold = sum(p["holdout"] for p in pieces)
    print(f"wrote {util.rel(args.out) if os.path.abspath(args.out).startswith(util.repo_root()) else args.out}: "
          f"{len(pieces)} references ({len(pieces) - n_hold} training, {n_hold} hold-out), "
          f"{sum(len(p['notes']) for p in pieces)} key presses")
    return 0


if __name__ == "__main__":
    sys.exit(main())
