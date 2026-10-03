#!/usr/bin/env python3
"""Case-by-case A/B of the hands v2 rows against the app path (G10a-2, stage S4).

    python tests/bench/tools/hands_ab.py --a out/rec-core/results.json [--a out/rec-robust/results.json] --a-opt app
                                         --b out/rec-hands/results.json --b-opt v2-hands [--by family|profile|beats] [--json PATH]

``rec-hands`` runs rec-core's and rec-robust's very performances with the app's options and only the hands swapped
(opts.hands 'v2'); the case ids differ only in their ``|opt:`` suffix. This pairs every case of B with its A twin and
reports, over the pairs: each gated metric's mean (A, B, delta), the usable rates, every critical gate's pass rate and
its flips (pass -> fail, fail -> pass), per group. Pure reading of two results.json files; nothing enters a gate.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

from pppbench import util  # noqa: E402

util.setup_stdio()

METRICS = ("usable", "rec.usable", "critical.hands", "notation.hand.accuracy", "notation.hand.accuracy_ref", "critical.meter",
           "critical.beat_placement", "critical.note_values", "critical.playback_tempo", "critical.pitch_integrity",
           "critical.key", "critical.structure", "critical.accidentals", "notation.onset_pos.accuracy", "notation.duration.accuracy",
           "notation.ioi.accuracy", "notation.spelling.accuracy", "rec.onset_f1", "rec.voice.f1", "rec.mv2h", "rec.rest.precision",
           "rec.rest.recall", "rec.rest.false_per_100_bars", "rec.tuplet.precision", "rec.tuplet.recall", "rec.stability",
           "rec.check.1", "rec.check.2", "rec.check.3", "rec.check.4", "rec.check.5", "rec.check.6", "rec.check.7",
           "rec.harmony.agreement", "notation.ties.extra_per_100", "nq.rest.per_measure_delta", "sqi")


def strip(cid: str) -> str:
    return cid.split("|opt:", 1)[0]


def load(paths, opt):
    out = {}
    for p in paths:
        for c in util.load_json(p)["cases"]:
            if c["id"].endswith("|opt:" + opt):
                out[strip(c["id"])] = c
    return out


def group_of(cid: str, by: str) -> str:
    ref, profile, beats = cid.split("|")[:3]
    if by == "profile":
        return profile
    if by == "beats":
        return beats
    if by == "family":
        return ref.split("/")[1] if ref.startswith("method/") else ref.split("/")[0]
    return "all"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--a", action="append", required=True)
    ap.add_argument("--a-opt", default="app")
    ap.add_argument("--b", action="append", required=True)
    ap.add_argument("--b-opt", default="v2-hands")
    ap.add_argument("--by", default="all")
    ap.add_argument("--metrics", default=None, help="comma-separated metric names (default: the built-in list)")
    ap.add_argument("--json")
    args = ap.parse_args()
    A, B = load(args.a, args.a_opt), load(args.b, args.b_opt)
    common = sorted(set(A) & set(B))
    metrics = args.metrics.split(",") if args.metrics else METRICS
    groups = defaultdict(list)
    for cid in common:
        groups["all"].append(cid)
        if args.by != "all":
            groups[group_of(cid, args.by)].append(cid)
    report = {"pairs": len(common), "only_a": len(set(A) - set(B)), "only_b": len(set(B) - set(A)), "groups": {}}
    for g in sorted(groups, key=lambda k: (k != "all", k)):
        ids = groups[g]
        rows = {}
        for m in metrics:
            va = [A[c]["metrics"].get(m) for c in ids]
            vb = [B[c]["metrics"].get(m) for c in ids]
            pa = [(x, y) for x, y in zip(va, vb) if x is not None and y is not None]
            if not pa:
                continue
            ma = sum(x for x, _ in pa) / len(pa)
            mb = sum(y for _, y in pa) / len(pa)
            row = {"n": len(pa), "a": round(ma, 6), "b": round(mb, 6), "delta": round(mb - ma, 6)}
            if m == "usable" or m.startswith("critical.") or m == "rec.usable":
                row["lost"] = sum(1 for x, y in pa if x >= 1 and y < 1)
                row["gained"] = sum(1 for x, y in pa if x < 1 and y >= 1)
            rows[m] = row
        errors = {"a": sum(1 for c in ids if A[c]["status"] != "ok"), "b": sum(1 for c in ids if B[c]["status"] != "ok")}
        report["groups"][g] = {"cases": len(ids), "errors": errors, "metrics": rows}
    print(f"pairs {report['pairs']} (only in A {report['only_a']}, only in B {report['only_b']})")
    for g, r in report["groups"].items():
        print(f"== {g}: {r['cases']} cases, errors A {r['errors']['a']} B {r['errors']['b']}")
        for m, row in r["metrics"].items():
            flips = f"  lost {row['lost']:3d} gained {row['gained']:3d}" if "lost" in row else ""
            print(f"  {m:34s} {row['a']:10.4f} -> {row['b']:10.4f}  ({row['delta']:+.4f}){flips}")
    if args.json:
        util.dump_json(report, args.json)
    return 0


if __name__ == "__main__":
    sys.exit(main())
