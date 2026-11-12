"""The G12-6 bake-off (AI-7): every engine's recorded reads of omr-live-2, scored the same way, side by side, and gate A7
(docs/GOALS/G12_OMR.md section 12 and 25).

    python tests/bench/run.py omr-live-2 bakeoff [--half tune|held] [--engines audiveris,homr,oemer,smt] [--tiers all+real] [--record PATH]

Nothing is read again: the engines' page records (``out/engine[-<name>]/<case>/<tier>-p<n>/engine.json``, written by ``run`` and
``run --engine <name>``) are scored twice, the engine's MusicXML as it is ("raw") and through omr/normalize.js ("normalised", the path the
app takes under PPP.omr = 'v2'). Gate A7 is judged on the normalised path of the HELD-OUT half: a learned engine is adopted only if its
``omr.bar_exact`` beats Audiveris' by >= 0.10 on the photo tier (photo-A + photo-B, pooled) AND on the real-scan tier, loses no more than
0.02 on clean-A and on clean-B, reads a page in <= 60 s (the 90th percentile of its pages), and its licence allows the deployment of U1 (the
user's own PC, through the queue). The held-out half is judged once: a second ``--half held`` is refused (``--again REASON`` overrides and is
recorded). The pure half of this module (the verdict, the timing figures) is tested in the gate (tests/bench/unit/test_omr2_bakeoff.py).
"""

from __future__ import annotations

import datetime
import json
import os
import statistics
from typing import Any, Dict, List, Optional

GATE = {"photo": 0.10, "real-scan": 0.10, "clean-A": -0.02, "clean-B": -0.02, "seconds": 60.0}
# U1 = C (2026-10-13): the engine runs on the user's own PC, for the user's own use, as a separate process; AGPL and GPL allow that,
# MIT does. A licence that forbids it (none of the three) would be False here.
LICENCE_OK_FOR_U1 = {"audiveris": True, "homr": True, "oemer": True, "smt": True}
HEADLINE = ("clean-A", "clean-B", "scan150-A", "scan150-B", "scan200-A", "scan200-B", "scan", "photo-A", "photo-B", "photo", "real-scan",
            "brace-less")


def timing(page_ms: List[int]) -> Dict[str, Optional[float]]:
    """Seconds a page: median, 90th percentile (nearest rank), max, mean; None when there is no page."""
    if not page_ms:
        return {"pages": 0, "median_s": None, "p90_s": None, "max_s": None, "mean_s": None}
    xs = sorted(page_ms)
    k = max(0, min(len(xs) - 1, -(-9 * len(xs) // 10) - 1))
    return {"pages": len(xs), "median_s": round(statistics.median(xs) / 1000, 2), "p90_s": round(xs[k] / 1000, 2),
            "max_s": round(xs[-1] / 1000, 2), "mean_s": round(sum(xs) / len(xs) / 1000, 2)}


def bar_exact(block: Dict[str, Any]) -> Optional[float]:
    return block.get("omr.bar_exact") if block else None


def verdict(name: str, tiers: Dict[str, Dict[str, Any]], ref: Dict[str, Dict[str, Any]], seconds_p90: Optional[float],
            gate: Dict[str, float] = GATE) -> Dict[str, Any]:
    """Gate A7 for one learned engine. ``tiers`` / ``ref``: {tier: aggregate} of the engine and of Audiveris (the same half, the same
    path); ``seconds_p90``: the engine's 90th-percentile seconds a page. Every clause is reported, with its numbers; a clause whose tier
    is missing FAILS (it cannot be shown to pass)."""
    clauses = []
    for tier, need in (("photo", gate["photo"]), ("real-scan", gate["real-scan"]), ("clean-A", gate["clean-A"]), ("clean-B", gate["clean-B"])):
        a, b = bar_exact(tiers.get(tier, {})), bar_exact(ref.get(tier, {}))
        delta = None if a is None or b is None else round(a - b, 6)
        ok = delta is not None and delta >= need - 1e-9
        clauses.append({"clause": f"bar_exact {tier}: {name} minus audiveris >= {need:+.2f}", "tier": tier,
                        "engine": a, "audiveris": b, "delta": delta, "need": need, "pass": ok})
    sp_ok = seconds_p90 is not None and seconds_p90 <= gate["seconds"]
    clauses.append({"clause": f"seconds a page (p90) <= {gate['seconds']:.0f}", "engine": seconds_p90, "need": gate["seconds"], "pass": sp_ok})
    lic = LICENCE_OK_FOR_U1.get(name, False)
    clauses.append({"clause": "licence allows U1 (the user's PC, the user's own use, a separate process)", "pass": lic})
    passed = all(c["pass"] for c in clauses)
    return {"engine": name, "pass": passed, "clauses": clauses,
            "decision": ("adopt as a worker-side option (omrEngine), default stays audiveris" if passed else "do not adopt")}


def format_table(per_engine: Dict[str, Dict[str, Dict[str, Any]]], metric: str = "omr.bar_exact", tiers=HEADLINE) -> str:
    """tier x engine: the metric (bar_exact with exact/truth bars)."""
    names = list(per_engine)
    out = [f"  {'tier':10} " + " ".join(f"{n:>22}" for n in names)]
    for t in tiers:
        cells = []
        have = False
        for n in names:
            blk = per_engine[n].get(t)
            if not blk:
                cells.append(f"{'-':>22}")
                continue
            have = True
            v = blk.get(metric)
            extra = f" {blk['exact_bars']}/{blk['truth_bars']}" if metric == "omr.bar_exact" else ""
            cells.append(f"{(f'{v:.3f}' if v is not None else '-') + extra:>22}")
        if have:
            out.append(f"  {t:10} " + " ".join(cells))
    return "\n".join(out)


def marker_path(out_root: str) -> str:
    return os.path.join(out_root, "bakeoff", "held-judged.json")


def held_already(out_root: str) -> Optional[Dict[str, Any]]:
    p = marker_path(out_root)
    if not os.path.isfile(p):
        return None
    with open(p, encoding="utf-8") as h:
        return json.load(h)


def mark_held(out_root: str, info: Dict[str, Any]) -> None:
    p = marker_path(out_root)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    prev = held_already(out_root)
    runs = (prev or {}).get("runs", []) + [dict(info, at=datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"))]
    with open(p, "w", encoding="utf-8", newline="\n") as h:
        json.dump({"runs": runs}, h, indent=1)
