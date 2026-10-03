#!/usr/bin/env python3
"""The hand model's training and evaluation data (G10a-2, stage S4; docs/GOALS/G10 section 8.3 AI-5b).

    python tests/bench/tools/hands_data.py [--out tests/bench/.cache/hands/truth.json]
    python tests/bench/tools/hands_data.py --perfs tests/bench/.cache/hands/perfs.jsonl [--seeds 201]

Reads every registered, licence-clean reference with two piano staves (the benchmark's own reader, so the hand of a
note is exactly what ``notation.hand.accuracy`` calls its hand: the upper piano staff is the right hand) and writes,
per reference, its key presses in onset order: ``[onset in quarters, onset in seconds at the reference tempo, midi,
hand (1 right / 2 left)]``. Hold-out references are written too, marked ``holdout``: the trainer never fits on them, it
only reports them. The output is note-level data and stays in the git-ignored cache (never committed, G10-D15 / the
roadmap's data rule); ``tests/bench/tools/train_hands.js`` turns it into the aggregate tables of ``rec/weights/hands-v1.json``.

``--perfs`` writes one line per (reference, profile, seed): the humanizer's performance of a reference (its input: the
heard notes, and with ``--beats oracle-noisy`` the helper-like beats) and the written hand of every heard note (0 for a
note the performer or the AMT overlay added). ``train_hands.js --perfs`` runs them through audio-score.js's recording
conversion v2 and fits the weights on exactly the onset groups S4 receives. The seeds default to 201, which no suite and
no other model's data uses (the suites use 1, 2, 11, 12; AI-5a 101-103), so the benchmark never measures a performance
the hand model was fitted on. Hold-out references are never written here.

The references are the benchmark's lint-clean, licence-evidenced list (the ``full`` suite's: quarantined and broken files
are already out), as for the time-skeleton model (``rec_dataset.py``).
"""

from __future__ import annotations

import argparse
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

from pppbench import corpus, perform, suite as suite_mod, util  # noqa: E402

util.setup_stdio()
DEFAULT_OUT = os.path.join(util.bench_root(), ".cache", "hands", "truth.json")
PERF_ROWS = (("cover", "none"), ("cover-pedal", "none"), ("human-real", "none"), ("cover+of", "none"),
             ("cover", "oracle-noisy"), ("cover-pedal+helper", "oracle-noisy"))


def references():
    by = corpus.by_id(corpus.load_corpus())
    return [by[r] for r in sorted(suite_mod.load_suite("full")["references"])]


def perf_rows(entry, rows, seeds):
    canon = corpus.read_reference(entry)
    if canon.staves < 2 or "notation.hand.accuracy" in (entry.expect.get("skip_metrics") or ()):
        return
    hand = {s.id: (1 if s.hand == "r" else 2) for s in canon.played()}
    for prof, beats in rows:
        for seed in seeds:
            p = perform.perform(canon, entry.id, prof, beats, seed, expect=entry.expect)
            inp = {"notes": p.input["notes"]}
            for k in ("beats", "downbeats", "pedals"):
                if k in p.input:
                    inp[k] = p.input[k]
            yield {"id": f"{entry.id}|{prof}|{beats}|s{seed}", "ref": entry.id, "set": entry.set, "book": entry.book,
                   "input": inp, "hands": [hand.get(t["ref"], 0) if t["ref"] is not None else 0 for t in p.truth]}


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
    ap.add_argument("--perfs", help="write the training performances (JSONL) instead of the truth")
    ap.add_argument("--seeds", default="201")
    args = ap.parse_args()
    if args.perfs:
        seeds = [int(x) for x in args.seeds.split(",") if x]
        n = 0
        os.makedirs(os.path.dirname(os.path.abspath(args.perfs)), exist_ok=True)
        with open(args.perfs, "w", encoding="utf-8", newline="\n") as h:
            for entry in references():
                if entry.holdout:
                    continue
                for row in perf_rows(entry, PERF_ROWS, seeds):
                    h.write(json.dumps(row, sort_keys=True, separators=(",", ":")) + "\n")
                    n += 1
        print(f"wrote {n} performances to {args.perfs}")
        return 0
    pieces = []
    for entry in references():
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
