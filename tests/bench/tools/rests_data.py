#!/usr/bin/env python3
"""The silence classifier's training data (G10a-3, stage S6, AI-5b; docs/GOALS/G10 sections 8.3 and 22).

    python tests/bench/tools/rests_data.py --out DIR [--seeds 301] [--holdout]

Writes two files into DIR (note-level data: the git-ignored cache only, never committed - G10-D15 / the roadmap's data rule):

  truth.json    per reference: the written silences of each staff (stretches of a 16th or more in which no note of the staff
                sounds, rec.rest's own definition: metrics/rec.py truth_silences), in quarters from the start of the piece
  perfs.jsonl   one line per (reference, profile, beats, seed): the humanizer's performance (the input toMusicXml gets) and,
                per heard note, the written onset (quarters) and staff of the note it plays ([] for a note the performer or
                the AMT overlay added)

``tests/bench/tools/train_rests.js`` runs the performances through audio-score.js's recording conversion v2 and labels every
silence its writer asks S6 about: a rest when the written staff has a silence between the two written onsets the silence lies
between. The references are the benchmark's lint-clean, licence-evidenced list (the ``full`` suite's); hold-out references
(G0's fnv1a32(id) % 5 == 0) are never written unless ``--holdout`` (evaluation only: then ONLY the hold-out ones are written).
The seeds default to 301, which no suite (1, 2, 11, 12) and no other model (AI-5a 101-103, grid 101-102, hands 201) uses.
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
from pppbench.metrics import rec  # noqa: E402

util.setup_stdio()
ROWS = (("cover", "none"), ("cover-pedal", "none"), ("human-real", "none"), ("cover+of", "none"),
        ("cover", "oracle-noisy"), ("cover-pedal+helper", "oracle-noisy"))


def references():
    by = corpus.by_id(corpus.load_corpus())
    return [by[r] for r in sorted(suite_mod.load_suite("full")["references"])]


def silences(canon):
    """staff -> [[a, b], ...] absolute quarters (as floats rounded to 1e-6)"""
    merged = canon.staves <= 1
    out = {}
    for (m, st), gaps in sorted(rec.truth_silences(canon, merged).items()):
        start = canon.measures[m].start_q
        out.setdefault(str(st if not merged else 1), []).extend(
            [[round(float(start + a), 6), round(float(start + b), 6)] for a, b in gaps])
    for k in out:
        out[k].sort()
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--seeds", default="301")
    ap.add_argument("--holdout", action="store_true", help="write the hold-out references only (evaluation)")
    args = ap.parse_args()
    seeds = [int(x) for x in args.seeds.split(",") if x]
    os.makedirs(args.out, exist_ok=True)
    truth = {}
    n = 0
    with open(os.path.join(args.out, "perfs.jsonl"), "w", encoding="utf-8", newline="\n") as h:
        for entry in references():
            if bool(entry.holdout) != bool(args.holdout):
                continue
            canon = corpus.read_reference(entry)
            if "notation.duration.accuracy" in (entry.expect.get("skip_metrics") or ()):
                continue
            by_id = {s.id: s for s in canon.played()}
            truth[entry.id] = {"set": entry.set, "silences": silences(canon)}
            for prof, beats in ROWS:
                for seed in seeds:
                    p = perform.perform(canon, entry.id, prof, beats, seed, expect=entry.expect)
                    inp = {"notes": p.input["notes"]}
                    for k in ("beats", "downbeats", "pedals"):
                        if k in p.input:
                            inp[k] = p.input[k]
                    links = []
                    for t in p.truth:
                        s = by_id.get(t["ref"]) if t["ref"] is not None else None
                        links.append([round(float(s.onset_q), 6), 1 if canon.staves <= 1 else s.staff] if s is not None else [])
                    row = {"id": f"{entry.id}|{prof}|{beats}|s{seed}", "ref": entry.id, "set": entry.set, "input": inp, "truth": links}
                    h.write(json.dumps(row, sort_keys=True, separators=(",", ":")) + "\n")
                    n += 1
    util.dump_json({"schema": "ppp.rests-truth/1", "references": truth}, os.path.join(args.out, "truth.json"))
    print(f"wrote {n} performances of {len(truth)} references to {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
