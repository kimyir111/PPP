#!/usr/bin/env python3
"""Hand-assignment report of a recording suite run (G10a-2, stage S4; docs/GOALS/G10 section 8).

    python tests/bench/tools/hands_report.py --suite rec-core [--out-dir tests/bench/out/rec-core] [--json report.json]
                                             [--by opts] [--filter TEXT]

Reads the cases a ``run`` wrote (``out/<suite>/cases/<key>.musicxml`` + ``.stats.json``), aligns them with their
references exactly as the benchmark does (``align.align_timed`` on the same time maps) and breaks the hand errors
down by cause, register and family. Nothing here enters a gate: it is the error analysis behind
``notation.hand.accuracy`` / ``critical.hands`` (whose definitions it reproduces: matched pairs whose reference and
prediction both have a hand), and the melody-gap count of section 1 E10 (a reference melody note - the top note of
the right hand at its onset - written in the left hand leaves a hole in the right-hand line).

Causes (per matched pair with a wrong hand), from the reference onset group the note belongs to:
  cross      the reference itself crosses at this onset (a right-hand note below a left-hand note or the reverse):
             no pitch split of the group can be right
  split      both hands play at this onset and the split point is wrong (e.g. a hymn tenor in the right hand)
  solo-rh    only the right hand starts a note at this onset and (part of) it went to the left hand
  solo-lh    only the left hand starts a note at this onset and (part of) it went to the right hand
Register: the reference pitch in four bands (< C3, C3-B3, C4-B4, >= C5) and the hand.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from collections import Counter, defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

from pppbench import align, corpus, musicxml, runner, suite as suite_mod, util  # noqa: E402
from pppbench.timemap import PredTime  # noqa: E402

util.setup_stdio()


def band(midi: int) -> str:
    return "<C3" if midi < 48 else "C3-B3" if midi < 60 else "C4-B4" if midi < 72 else ">=C5"


def case_rows(ref, perf, xml: str, stats, window: float):
    """[(ref Sounding, pred hand, cause or None, is melody)] for the matched pairs with a hand on both sides."""
    pred = musicxml.read_score(xml)
    pt = PredTime(pred, stats or {})
    tm = perf.timemap
    ref_played = ref.played()
    pred_played = pred.played()
    pairs = align.align_timed([(s.id, s.midi, tm.sec(s.onset_q)) for s in ref_played],
                              [(s.id, s.midi, pt.sec(s.measure, s.pos_q)) for s in pred_played], window)
    rb = {s.id: s for s in ref_played}
    pb = {s.id: s for s in pred_played}
    groups = defaultdict(list)
    for s in ref_played:
        groups[s.onset_q].append(s)
    out = []
    for rid, pid, _ in pairs:
        r, p = rb[rid], pb[pid]
        if r.hand not in "rl" or p.hand not in "rl":
            continue
        g = groups[r.onset_q]
        rh = [x.midi for x in g if x.hand == "r"]
        lh = [x.midi for x in g if x.hand == "l"]
        melody = r.hand == "r" and r.midi == max(rh)
        cause = None
        if r.hand != p.hand:
            if rh and lh and min(rh) < max(lh):
                cause = "cross"
            elif rh and lh:
                cause = "split"
            elif r.hand == "r":
                cause = "solo-rh"
            else:
                cause = "solo-lh"
        out.append((r, p.hand, cause, melody))
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--suite", required=True)
    ap.add_argument("--out-dir")
    ap.add_argument("--filter")
    ap.add_argument("--by", default="opts", help="the tag prefix to split the report by (default opts)")
    ap.add_argument("--json")
    args = ap.parse_args()
    suite = suite_mod.load_suite(args.suite)
    out_dir = args.out_dir or runner.out_dir_for(suite)
    refs = corpus.load_corpus()
    by = corpus.by_id(refs)
    cases, _, perfs = runner.generate(suite, refs, args.filter)
    window = (suite.get("align") or {}).get("window_s", 0.30)
    agg = defaultdict(lambda: defaultdict(Counter))
    per_case = {}
    for c in cases:
        base = os.path.join(out_dir, "cases", c.key)
        if not os.path.exists(base + ".musicxml"):
            continue
        ref = corpus.read_reference(by[c.ref_id])
        if ref.staves < 2 or "notation.hand.accuracy" in (by[c.ref_id].expect.get("skip_metrics") or ()):
            continue
        with open(base + ".musicxml", encoding="utf-8") as h:
            xml = h.read()
        stats = util.load_json(base + ".stats.json") if os.path.exists(base + ".stats.json") else {}
        try:
            rows = case_rows(ref, perfs[c.id], xml, stats, window)
        except Exception as exc:     # a case the reader refuses is the benchmark's error, not this report's
            print(f"skip {c.id}: {exc}", file=sys.stderr)
            continue
        split = next((t.split(":", 1)[1] for t in c.tags if t.startswith(args.by + ":")), "all")
        fam = c.ref_id.split("/")[1] if c.ref_id.startswith("method/") else c.ref_id.split("/")[0]
        n_ok = sum(1 for r, ph, cause, mel in rows if cause is None)
        per_case[c.id] = {"pairs": len(rows), "ok": n_ok, "acc": (n_ok / len(rows)) if rows else 0.0}
        for key in ("all", "family:" + fam):
            A = agg[split][key]
            A["cases"] += 1
            A["case_gate"] += int(rows and n_ok / len(rows) >= 0.80)
            A["case_acc_sum_x1e6"] += int(round(1e6 * (n_ok / len(rows)))) if rows else 0
            for r, ph, cause, mel in rows:
                A["pairs"] += 1
                A["wrong"] += int(cause is not None)
                A["cause:" + (cause or "ok")] += 1
                A[f"band:{r.hand}:{band(r.midi)}"] += 1
                A[f"band-wrong:{r.hand}:{band(r.midi)}"] += int(cause is not None)
                if mel:
                    A["melody"] += 1
                    A["melody_to_lh"] += int(ph == "l")
    report = {}
    for split, keys in sorted(agg.items()):
        report[split] = {}
        for key, A in sorted(keys.items()):
            n = A["cases"] or 1
            row = {"cases": A["cases"], "hand_acc_mean": round(A["case_acc_sum_x1e6"] / 1e6 / n, 6),
                   "hands_gate": round(A["case_gate"] / n, 6), "pairs": A["pairs"],
                   "pair_acc": round(1 - A["wrong"] / max(1, A["pairs"]), 6),
                   "causes": {k.split(":", 1)[1]: v for k, v in sorted(A.items()) if k.startswith("cause:") and k != "cause:ok"},
                   "melody_notes": A["melody"], "melody_to_lh": A["melody_to_lh"],
                   "melody_gap_rate": round(A["melody_to_lh"] / max(1, A["melody"]), 6)}
            if key == "all":
                row["bands"] = {k.split(":", 1)[1]: [A[k], A["band-wrong:" + k.split(":", 1)[1]]]
                                for k in sorted(A) if k.startswith("band:")}
            report[split][key] = row
    for split, keys in report.items():
        print(f"== {args.by}:{split}")
        for key, row in keys.items():
            print(f"  {key:22s} cases {row['cases']:4d}  hand acc {row['hand_acc_mean']:.4f}  gate {row['hands_gate']:.4f}  "
                  f"pairs {row['pairs']:6d} pair acc {row['pair_acc']:.4f}  melody->LH {row['melody_to_lh']}/{row['melody_notes']} "
                  f"({row['melody_gap_rate']:.4f})  causes {row['causes']}")
            if "bands" in row:
                print("      bands [notes, wrong]: " + ", ".join(f"{k} {v}" for k, v in row["bands"].items()))
    if args.json:
        util.dump_json({"report": report, "cases": per_case}, args.json)
    return 0


if __name__ == "__main__":
    sys.exit(main())
