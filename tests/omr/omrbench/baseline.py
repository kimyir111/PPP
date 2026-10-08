"""The committed baselines of omr-live-2 and the --check against them (docs/GOALS/G12_OMR.md A0).

A baseline is a JSON file under tests/omr/baselines/ holding, per tier and subset (all / tune / held / s1), the aggregates of one engine
on the benchmark, and per-case rows for the TUNING half only (the held-out half is quoted as a number and is not read case by case).
``check`` compares a run with it and answers per tier, subset and metric:

    ok          within the tolerance of the baseline
    better      higher (or lower, for a metric where less is better) by more than the tolerance: the baseline may be refreshed
    REGRESSION  worse by more than the tolerance (exit 1)
    new / gone  a tier, subset or metric only one side has (a gone one is a regression)

The tolerance is 0.02 on a rate (the A0 tolerance of the design document: the same pages and the same engine give the same numbers to
the sixth place on one machine; another machine's Chrome or OpenCV can move a page by a pixel value). Standard library only.
"""

from __future__ import annotations

import json
from typing import Any, Dict, List, Optional

SCHEMA = "ppp.omr-baseline/1"
RESULTS_SCHEMA = "ppp.omr-results/1"
TOLERANCE = 0.02

# metric -> direction ("up": more is better, "down": less is better)
CHECKED: Dict[str, str] = {
    "omr.note_f1": "up", "omr.played_f1": "up", "omr.bar_exact": "up", "omr.measure_alignment_rate": "up",
    "omr.duration_acc": "up", "omr.staff_acc": "up", "omr.bar_count_exact": "up", "omr.parts_ok": "up",
    "omr.parts_fragmented": "down", "omr.time_ok": "up", "omr.key_ok": "up",
    "omr.flag.app.recall": "up", "omr.flag.app.precision": "up", "omr.flag.voice.recall": "up", "omr.flag.voice.precision": "up",
}
SUBSETS = ("all", "tune", "held", "s1")


def load(path: str) -> Dict[str, Any]:
    with open(path, encoding="utf-8") as h:
        doc = json.load(h)
    if doc.get("schema") not in (SCHEMA, RESULTS_SCHEMA):
        raise ValueError(f"{path}: not an omr-live-2 results or baseline file")
    return doc


def dumps(doc: Dict[str, Any]) -> str:
    return json.dumps(doc, indent=1, sort_keys=True, ensure_ascii=False) + "\n"


def to_baseline(results: Dict[str, Any], reason: str) -> Dict[str, Any]:
    """The baseline a results file becomes: the aggregates, and the per-case metrics of the tuning half only."""
    tiers = {}
    for tier, t in results["tiers"].items():
        tiers[tier] = {
            "pages": t.get("pages"),
            "subsets": t["subsets"],
            "cases": {c: {"metrics": row["metrics"], "structure": row.get("structure"), "counts": row.get("counts")}
                      for c, row in sorted(t.get("cases", {}).items()) if row.get("split") == "tune"},
        }
    return {"schema": SCHEMA, "bench": results["bench"], "bench_version": results["bench_version"], "mode": results.get("mode", "engine"),
            "reason": reason, "engine": results["engine"], "recorded": {"git": results.get("git"), "created": results.get("created"),
                                                                       "versions": results.get("versions")},
            "cases_sha256": results.get("cases_sha256"), "inputs_sha256": results.get("inputs_sha256"), "tiers": tiers}


def _compare_value(metric: str, now: Optional[float], then: Optional[float], tol: float) -> str:
    if then is None and now is None:
        return "ok"
    if then is None:
        return "new"
    if now is None:
        return "REGRESSION"
    direction = CHECKED.get(metric, "up")
    delta = (now - then) if direction == "up" else (then - now)
    if delta < -tol:
        return "REGRESSION"
    if delta > tol:
        return "better"
    return "ok"


def check(results: Dict[str, Any], base: Dict[str, Any], tol: float = TOLERANCE) -> Dict[str, Any]:
    """{"verdict": "PASS"|"REGRESSION", "rows": [...], "notes": [...]}. Rows: {tier, subset, metric, now, then, status}."""
    rows: List[Dict[str, Any]] = []
    notes: List[str] = []
    if results.get("bench_version") != base.get("bench_version"):
        notes.append(f"bench_version {results.get('bench_version')} vs the baseline's {base.get('bench_version')}: not comparable")
    if results.get("mode") != base.get("mode"):
        notes.append(f"mode {results.get('mode')} vs the baseline's {base.get('mode')}: not comparable")
    rv, bv = (results.get("versions") or {}).get("raster"), ((base.get("recorded") or {}).get("versions") or {}).get("raster")
    if rv != bv:
        notes.append(f"the pages were rasterised on the {rv} and the baseline's on the {bv}: another anti-aliasing, so another page for Audiveris")
    if results.get("cases_sha256") != base.get("cases_sha256"):
        notes.append("the case list differs from the baseline's (tests/omr/cases.json changed)")
    for tier, bt in base["tiers"].items():
        rt = results["tiers"].get(tier)
        if rt is None:
            rows.append({"tier": tier, "subset": "-", "metric": "-", "now": None, "then": None, "status": "gone"})
            continue
        for sub in SUBSETS:
            b, r = bt["subsets"].get(sub), rt["subsets"].get(sub)
            if b is None:
                continue
            if r is None:
                rows.append({"tier": tier, "subset": sub, "metric": "-", "now": None, "then": None, "status": "gone"})
                continue
            for metric in CHECKED:
                if metric not in b and metric not in r:
                    continue
                st = _compare_value(metric, r.get(metric), b.get(metric), tol)
                rows.append({"tier": tier, "subset": sub, "metric": metric, "now": r.get(metric), "then": b.get(metric), "status": st})
    for tier in results["tiers"]:
        if tier not in base["tiers"]:
            rows.append({"tier": tier, "subset": "-", "metric": "-", "now": None, "then": None, "status": "new"})
    changed_inputs = 0
    bi, ri = base.get("inputs_sha256") or {}, results.get("inputs_sha256") or {}
    for k, v in ri.items():
        if k in bi and bi[k] != v:
            changed_inputs += 1
    if changed_inputs:
        notes.append(f"{changed_inputs} of the page-image sets differ byte for byte from the baseline's (another Chrome, OpenCV or "
                     f"Verovio draws a pixel differently): compare the numbers, not the hashes")
    bad = [r for r in rows if r["status"] in ("REGRESSION", "gone")]
    return {"verdict": "REGRESSION" if bad else "PASS", "rows": rows, "notes": notes, "tolerance": tol}


def format_check(verdict: Dict[str, Any], limit: int = 40) -> str:
    rows = verdict["rows"]
    counts: Dict[str, int] = {}
    for r in rows:
        counts[r["status"]] = counts.get(r["status"], 0) + 1
    lines = [f"omr-live-2 check: {verdict['verdict']} (tolerance {verdict['tolerance']}) · " + ", ".join(f"{k} {v}" for k, v in sorted(counts.items()))]
    lines += ["  note: " + n for n in verdict["notes"]]
    shown = [r for r in rows if r["status"] != "ok"][:limit]
    for r in shown:
        f = lambda x: "-" if x is None else f"{x:.3f}"       # noqa: E731
        lines.append(f"  {r['status']:10} {r['tier']:9} {r['subset']:5} {r['metric']:32} now {f(r['now'])}  baseline {f(r['then'])}")
    return "\n".join(lines)


def table(results: Dict[str, Any]) -> str:
    """The numbers of a results file as a text table (tier x the headline metrics, on the 'all' and the 's1' subsets)."""
    cols = [("omr.note_f1", "noteF1"), ("omr.played_f1", "playedF1"), ("omr.bar_exact", "bars ok"), ("omr.measure_alignment_rate", "aligned"),
            ("omr.bar_count_exact", "count ok"), ("omr.parts_ok", "parts ok"), ("omr.flag.voice.recall", "flag R"),
            ("omr.flag.voice.precision", "flag P")]  # voice rule; the app path: the app's own flags
    out = []
    for sub in ("all", "s1"):
        out.append(f"subset {sub}")
        out.append(f"  {'tier':9} {'cases':>5} " + " ".join(f"{h:>9}" for _, h in cols) + "   bars")
        for tier, t in results["tiers"].items():
            a = t["subsets"].get(sub)
            if not a:
                continue
            def val(m):
                v = a.get(m)
                if v is None and ".voice." in m:                 # the app path has the app's own flags only
                    v = a.get(m.replace(".voice.", ".app."))
                return f"{v:9.3f}" if v is not None else f"{'-':>9}"
            vals = " ".join(val(m) for m, _ in cols)
            out.append(f"  {tier:9} {a['cases']:5d} {vals}   {a['exact_bars']}/{a['truth_bars']}")
    return "\n".join(out)
