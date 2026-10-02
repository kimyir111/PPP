#!/usr/bin/env python3
"""The training data of the recording time skeleton (G10a-1, AI-5a; docs/GOALS/G10 sections 8.1 and 8.3).

    python tests/bench/tools/rec_dataset.py --truth OUT.jsonl            # the catalogue truth: where onsets fall
    python tests/bench/tools/rec_dataset.py --perfs OUT.jsonl [--profiles cover,human-real] [--seeds 101,102]
    python tests/bench/tools/rec_dataset.py ... --holdout                # the hold-out references instead (evaluation only)

Licence-clean only: the references are the benchmark's lint-clean, licence-evidenced catalogue (the ``full`` suite's
reference list: quarantined and broken files are already out), read with the benchmark's own truth reader
(``pppbench.musicxml`` via ``corpus.read_reference``), and the performances are the benchmark's humanizer
(``pppbench.perform``, deterministic LCG, no libm). **Hold-out references are left out** unless ``--holdout`` asks for
them (and then only them): the hold-out rule is G0's ``fnv1a32(id) % 5 == 0``. No real recording, no user material and
no external data set is read. The seeds default to 101 and 102, which no suite uses (the suites use 1, 2, 11, 12), so a
trained model never saw the exact performances it is measured on; the references of the open suites are in the
training set (the hold-out slice of ``rec-full`` is the unseen-piece measurement).

``--truth`` writes one line per reference: its primary metre, written tempo, pickup and, per onset (the distinct onset
positions of the notes a pianist plays, every staff together), ``[bar index, position in the bar in 1/24 of a quarter (or
-1 off that grid), lowest midi, notes, the lowest midi of the previous onset (or -1), IOI to the next onset in 1/24 of a
quarter (or -1 at the end or off the grid), longest written length at the onset in 1/24 of a quarter, the pitch classes of
the onset's notes as a 12-bit mask]``. A pickup bar
(an implicit first bar) is right-aligned in its metre's bar; onsets in a later implicit bar (the halves of a bar split
at a repeat) are left out, since their place in the bar is not stated. A reference whose bars change metre keeps only
the bars in its primary metre.

``--perfs`` writes one line per (reference, profile, seed): the performance's input (its notes, and with ``--beats
oracle-noisy`` the helper-like beats and downbeats) and the truth of its time skeleton (metre, quarter tempo, bar starts in seconds, the time of every
eighth-note position of the score, the pickup length).

Output is a pure function of the committed catalogue and this code (sorted, no timestamps).
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from fractions import Fraction

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

from pppbench import corpus, perform, suite as suite_mod, util  # noqa: E402

util.setup_stdio()
GRID = 24          # positions per quarter: 32nds (3), 16ths (6), triplet eighths (8), triplet 16ths (4)


def references(holdout: bool):
    refs = corpus.by_id(corpus.load_corpus())
    ids = suite_mod.load_suite("full")["references"]
    return [refs[r] for r in sorted(ids) if refs[r].holdout == holdout]


def _grid(q: Fraction) -> int:
    v = q * GRID
    return int(v) if v.denominator == 1 else -1


def truth_row(entry) -> dict:
    canon = corpus.read_reference(entry)
    time = tuple(corpus.expected_time(entry, canon))
    qpm = corpus.expected_qpm(entry, canon) or canon.effective_qpm or 100
    sig = Fraction(time[0] * 4, time[1])
    ms = canon.measures
    pickup = ms[0].len_q if ms and ms[0].implicit else Fraction(0)
    groups = {}
    for s in canon.played():
        m = ms[s.measure]
        if m.time != time:
            continue
        if m.implicit and m.index != 0:
            continue
        pos = s.pos_q + (sig - m.len_q if m.implicit else Fraction(0))
        key = s.onset_q
        g = groups.setdefault(key, {"bar": s.measure, "pos": pos, "low": s.midi, "n": 0, "long": Fraction(0), "pcs": 0})
        g["low"] = min(g["low"], s.midi)
        g["n"] += 1
        g["pcs"] |= 1 << (s.midi % 12)
        g["long"] = max(g["long"], s.dur_q)
    onsets = sorted(groups)
    rows = []
    prev_low = -1
    for i, q in enumerate(onsets):
        g = groups[q]
        ioi = _grid(onsets[i + 1] - q) if i + 1 < len(onsets) else -1
        rows.append([g["bar"], _grid(g["pos"]), g["low"], g["n"], prev_low, ioi, _grid(g["long"]), g["pcs"]])
        prev_low = g["low"]
    return {"id": entry.id, "set": entry.set, "book": entry.book, "holdout": entry.holdout, "time": list(time), "qpm": float(qpm),
            "bar_q": float(sig), "pickup_q": float(pickup), "bars": len(ms), "onsets": rows}


def perf_rows(entry, profiles, seeds, beats="none"):
    canon = corpus.read_reference(entry)
    ms = canon.measures
    first_full = next((m for m in ms if not m.implicit), ms[0])
    for prof in profiles:
        for seed in seeds:
            p = perform.perform(canon, entry.id, prof, beats, seed, expect=entry.expect)
            tm = p.timemap
            eighths = []
            k = 0
            while Fraction(k, 2) <= canon.end_q:
                eighths.append(util.round_t(tm.sec(Fraction(k, 2))))
                k += 1
            inp = {"notes": p.input["notes"]}
            for k in ("beats", "downbeats"):
                if k in p.input:
                    inp[k] = p.input[k]
            yield {"id": f"{entry.id}|{prof}|{beats}|s{seed}", "ref": entry.id, "profile": prof, "seed": seed, "holdout": entry.holdout,
                   "input": inp,
                   "truth": {"time": p.expected["time"], "qpm": p.expected["qpm"], "bar_starts": p.expected["bar_starts"],
                             "measures": len(ms), "pickup_q": float(ms[0].len_q) if ms[0].implicit else 0.0,
                             "first_full_q": float(first_full.start_q), "eighths": eighths,
                             "multi_time": len({m.time for m in ms}) > 1}}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--truth")
    ap.add_argument("--perfs")
    ap.add_argument("--profiles", default="cover,cover-pedal,human-real,cover+of")
    ap.add_argument("--seeds", default="101,102")
    ap.add_argument("--holdout", action="store_true", help="the hold-out references only (never for training)")
    ap.add_argument("--beats", default="none", help="the performer's beat profile: none (production) or oracle-noisy (the helper's beats)")
    args = ap.parse_args()
    if not args.truth and not args.perfs:
        ap.error("--truth and/or --perfs")
    refs = references(args.holdout)
    if args.truth:
        with open(args.truth, "w", encoding="utf-8", newline="\n") as h:
            for e in refs:
                h.write(json.dumps(truth_row(e), sort_keys=True, separators=(",", ":")) + "\n")
        print(f"wrote {len(refs)} references to {args.truth}")
    if args.perfs:
        profiles = [p for p in args.profiles.split(",") if p]
        seeds = [int(s) for s in args.seeds.split(",") if s]
        n = 0
        with open(args.perfs, "w", encoding="utf-8", newline="\n") as h:
            for e in refs:
                for row in perf_rows(e, profiles, seeds, args.beats):
                    h.write(json.dumps(row, sort_keys=True, separators=(",", ":")) + "\n")
                    n += 1
        print(f"wrote {n} performances to {args.perfs}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
