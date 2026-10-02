#!/usr/bin/env python3
"""The time-skeleton error analysis of a recording suite (G10a-1, docs/GOALS/G10 section 18).

    python tests/bench/tools/rec_skeleton_report.py [RESULTS.json] [--opts app] [--beats none] [--json OUT]

Reads a ``results.json`` of a rec suite (default ``tests/bench/out/rec-core/results.json``) and prints, for the cases of
one stage-options set and one beats profile (default: ``app`` and ``none``, what users get today):

  * the skeleton gates per options set and beats profile (metre, playback tempo, beat placement, structure, downbeat
    F1, usable, rec.usable) side by side,
  * how many unusable cases fail a skeleton gate (metre, playback tempo, beat placement, structure) and how many fail
    only those,
  * the metre confusion (the score's metre -> the metre written), the tempo ratio written / true by metre (x2, x2/3 ...),
    and each critical gate's failure rate by metre,
  * when metre and tempo are both right, how often the bar lines (downbeat F1 >= 0.9) are right too.

Reads only what the run wrote; computes nothing new about the music. The output is a pure function of the file.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from collections import Counter, defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

from pppbench import util  # noqa: E402

util.setup_stdio()
SKELETON = ("critical.meter", "critical.playback_tempo", "critical.beat_placement", "critical.structure")
GATES = ("critical.meter", "critical.playback_tempo", "critical.beat_placement", "critical.structure", "critical.note_values",
         "critical.hands", "critical.pitch_integrity", "critical.key", "critical.accidentals", "critical.pedal")
RATIOS = (("x1", 1.0), ("x2", 2.0), ("x1/2", 0.5), ("x3/2", 1.5), ("x2/3", 2 / 3), ("x3", 3.0), ("x1/3", 1 / 3), ("x3/4", 0.75), ("x4/3", 4 / 3))


def tag(case, prefix):
    for t in case["tags"]:
        if t.startswith(prefix + ":"):
            return t.split(":", 1)[1]
    return None


def mean(xs):
    xs = [x for x in xs if x is not None]
    return sum(xs) / len(xs) if xs else None


def report(results, opts, beats):
    cases = [c for c in results["cases"] if c["status"] == "ok"]
    out = {"by_opts": {}, "selection": {"opts": opts, "beats": beats}}
    keys = ("usable", "rec.usable") + SKELETON + ("struct.downbeat.f1",)
    groups = defaultdict(list)
    for c in cases:
        groups[(tag(c, "opts"), tag(c, "beats"))].append(c)
    for g in sorted(groups, key=lambda x: (str(x[0]), str(x[1]))):
        out["by_opts"]["%s/%s" % g] = {"n": len(groups[g]), **{k: mean([c["metrics"].get(k) for c in groups[g]]) for k in keys}}
    sel = [c for c in cases if tag(c, "opts") == opts and tag(c, "beats") == beats]
    unusable = [c for c in sel if c["metrics"].get("usable") == 0.0]
    skel = [c for c in unusable if any(c["metrics"].get(k) == 0.0 for k in SKELETON)]
    only = [c for c in skel if all(c["metrics"].get(k) != 0.0 for k in GATES if k not in SKELETON)]
    out["unusable"] = {"cases": len(sel), "unusable": len(unusable), "fail_a_skeleton_gate": len(skel), "fail_only_skeleton_gates": len(only)}
    conf, ratio, fails, by_metre = Counter(), defaultdict(Counter), defaultdict(Counter), Counter()
    right_both, right_bars = 0, 0
    for c in sel:
        e = "%d/%d" % tuple(c["expected"]["time"])
        p = "%d/%d" % tuple(c["predicted"]["time"]) if c.get("predicted") else "none"
        by_metre[e] += 1
        conf[(e, p)] += 1
        r = c["metrics"].get("struct.tempo.ratio_effective")
        if r is not None:
            name = next((n for n, v in RATIOS if abs(r / v - 1) <= 0.04), "other")
            ratio[e][name] += 1
        for k in GATES:
            if c["metrics"].get(k) == 0.0:
                fails[e][k] += 1
        if c["metrics"].get("critical.meter") == 1.0 and c["metrics"].get("critical.playback_tempo") == 1.0:
            right_both += 1
            right_bars += (c["metrics"].get("struct.downbeat.f1") or 0) >= 0.9
    out["metre_confusion"] = {e: dict(sorted(((p, n) for (ee, p), n in conf.items() if ee == e), key=lambda x: -x[1])) for e in sorted(by_metre)}
    out["tempo_ratio"] = {e: dict(ratio[e].most_common()) for e in sorted(ratio)}
    out["gate_failure_rate"] = {e: {k.split(".", 1)[1]: round(fails[e][k] / by_metre[e], 4) for k in GATES} for e in sorted(by_metre)}
    out["metre_and_tempo_right"] = {"cases": right_both, "bar_lines_right": right_bars}
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("results", nargs="?", default=os.path.join(util.bench_root(), "out", "rec-core", "results.json"))
    ap.add_argument("--opts", default="app")
    ap.add_argument("--beats", default="none")
    ap.add_argument("--json")
    a = ap.parse_args()
    rep = report(util.load_json(a.results), a.opts, a.beats)
    fmt = lambda v: "   -  " if v is None else "%.3f" % v
    print("skeleton gates by options / beats")
    for g, r in rep["by_opts"].items():
        print("  %-20s n %4d  " % (g, r["n"]) + "  ".join("%s %s" % (k.replace("critical.", ""), fmt(r[k])) for k in r if k != "n"))
    u = rep["unusable"]
    print("\n%s / %s: %d cases, %d unusable, %d fail a skeleton gate, %d fail only skeleton gates" % (
        a.opts, a.beats, u["cases"], u["unusable"], u["fail_a_skeleton_gate"], u["fail_only_skeleton_gates"]))
    print("\nmetre confusion (the score's -> written: cases)")
    for e, row in rep["metre_confusion"].items():
        print("  %-5s %s" % (e, ", ".join("%s %d" % kv for kv in row.items())))
    print("\nwritten tempo / true tempo")
    for e, row in rep["tempo_ratio"].items():
        print("  %-5s %s" % (e, ", ".join("%s %d" % kv for kv in row.items())))
    print("\ngate failure rate by metre")
    for e, row in rep["gate_failure_rate"].items():
        print("  %-5s %s" % (e, " ".join("%s %.2f" % kv for kv in row.items())))
    mt = rep["metre_and_tempo_right"]
    print("\nmetre and tempo right: %d cases, of which bar lines right (downbeat F1 >= 0.9): %d" % (mt["cases"], mt["bar_lines_right"]))
    if a.json:
        util.dump_json(rep, a.json)
    return 0


if __name__ == "__main__":
    sys.exit(main())
