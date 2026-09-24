"""The G3 gate (docs/GOALS/G03 §20.4, A34; reason-aware since §29 M6): ``run.py check --suite core --g3``.

G3 flips on only when, besides the G0 check itself, every line below passes on the suite's last run:

* no case loses a G0 critical gate it passed in the baseline (stricter than check's flip allowance);
* every triplet length without time-modification (``nq.shape.tm_missing``) and every one-note bracket
  (``nq.tuplet.one_note_rate``) is an R17 residual, G3b's to fix: ``.unexpected`` is 0 in every case
  (pppbench.notation_reasons says why each residual is there);
* no mergeable tie is a defect (U-1): ``nq.tie.mergeable.defect`` is 0 in every case. The ties merging would
  break a rule for (H6, H7, a beat the S table keeps, a chord only partly tied (U-2), two voices) or that sit
  in an R17 window are counted apart and reported, never dropped;
* no case has more R17 residuals (of each kind: tm, one-note, tie) than its recorded baseline
  (``tests/bench/baselines/g3-r17.<suite>.json``, written by ``run.py g3-r17 --suite S --reason "..."``): R17
  is left to G3b, but a change that adds to it fails (U-1). Hold-out cases are held as one pool (their sum of each
  kind), never case by case: no per-case hold-out value is committed or printed (G00 §17 m10);
* ``notation.hand.accuracy`` averages at least 0.90 and no case's hands gate goes from pass to fail;
* no case's ``notation.spelling.accuracy`` falls below its baseline and no case's key gate goes from pass
  to fail (A24: no allowance list).

The gate reads only results and the baselines; it changes nothing check reports without ``--g3``. Exit code
of ``check --g3``: check's own code when that is not 0 (1 REGRESSION, 2 ERROR), else 1 when a G3 line
FAILs, else 0.
"""

from __future__ import annotations

import datetime
import os
from typing import Any, Dict, List, Optional, Tuple

from . import util
from .metrics.critical import GATES as CRITICAL_GATES

HAND_MEAN_MIN = 0.90
EPS = 1e-9
R17_SCHEMA = "ppp.bench-g3-r17/1"
# kind -> the metric that counts its R17 residuals
R17_METRICS = {"tm": "nq.shape.tm_missing.r17", "one": "nq.tuplet.one_note.r17", "tie": "nq.tie.mergeable.r17"}
# the residuals that must be 0: (line, metric that counts them, the total it is part of)
ZERO_LINES = (
    ("nq.shape.tm_missing: every residual is R17 (non-R17 == 0)", "nq.shape.tm_missing.unexpected", "nq.shape.tm_missing"),
    ("nq.tuplet one-note brackets: every one is R17 (non-R17 == 0)", "nq.tuplet.one_note.unexpected", None),
    ("nq.tie mergeable ties: MERGEABLE_DEFECT == 0", "nq.tie.mergeable.defect", None),
)
TIE_REASONS = ("nq.tie.mergeable.required_h6", "nq.tie.mergeable.required_h7", "nq.tie.mergeable.required_beat_split",
               "nq.tie.mergeable.partial_chord", "nq.tie.mergeable.cross_voice", "nq.tie.mergeable.r17")


def r17_path(suite_name: str) -> str:
    return os.path.join(util.bench_root(), "baselines", f"g3-r17.{suite_name}.json")


def load_r17(suite_name: str) -> Optional[Dict[str, Any]]:
    p = r17_path(suite_name)
    return util.load_json(p) if os.path.exists(p) else None


def r17_counts(case: Dict[str, Any]) -> Optional[Dict[str, int]]:
    m = case.get("metrics") or {}
    if any(m.get(k) is None for k in R17_METRICS.values()):
        return None
    return {kind: int(round(m[k])) for kind, k in R17_METRICS.items()}


def _holdout(case: Dict[str, Any]) -> bool:
    return "holdout" in (case.get("tags") or [])


def _label(case: Dict[str, Any]) -> str:
    return "(hold-out case)" if _holdout(case) else case["id"]


def _sum(cases, k) -> float:
    return sum((c["metrics"] or {}).get(k) or 0 for c in cases)


def evaluate(results: Dict[str, Any], baseline: Dict[str, Any],
             r17: Optional[Dict[str, Any]] = None) -> List[Tuple[str, bool, str]]:
    """[(name, passed, detail)] for every G3 gate line. ``r17``: the suite's recorded R17 baseline (None: none)."""
    cases = [c for c in results.get("cases", []) if c.get("status") == "ok"]
    base = (baseline or {}).get("cases") or {}
    lines: List[Tuple[str, bool, str]] = []

    lost = []
    for c in cases:
        b = (base.get(c["id"]) or {}).get("metrics") or {}
        for g in CRITICAL_GATES:
            if b.get(g) == 1.0 and (c["metrics"] or {}).get(g) == 0.0:
                lost.append(f"{_label(c)} {g}")
    lines.append(("G0 critical gates: no case regresses", not lost,
                  f"{len(lost)} case gate(s) lost" + (": " + "; ".join(lost[:5]) if lost else "")))

    unread = [c["id"] for c in cases if r17_counts(c) is None]
    for name, k, total in ZERO_LINES:
        if unread:
            lines.append((name, False, f"{len(unread)} case(s) carry no reason split (results from before §29 M6): "
                                       "run the suite again"))
            continue
        bad = [_label(c) for c in cases if ((c["metrics"] or {}).get(k) or 0) > EPS]
        detail = f"{len(bad)} case(s) above 0 (sum {_sum(cases, k):.0f})"
        if total:
            detail += f"; of {_sum(cases, total):.0f} in all, R17 {_sum(cases, k.rsplit('.', 1)[0] + '.r17'):.0f}"
        if k == "nq.tie.mergeable.defect":
            detail += "; not defects: " + ", ".join(f"{x.rsplit('.', 1)[1]} {_sum(cases, x):.0f}" for x in TIE_REASONS)
        if k == "nq.tuplet.one_note.unexpected":
            detail += f"; R17 {_sum(cases, 'nq.tuplet.one_note.r17'):.0f}"
        lines.append((name, not bad, detail + (", e.g. " + ", ".join(bad[:3]) if bad else "")))

    if unread:
        lines.append(("R17 residuals: no case above its baseline", False, "no reason split in the results"))
    elif r17 is None:
        lines.append(("R17 residuals: no case above its baseline", False,
                      "no R17 baseline for this suite: record one with `run.py g3-r17 --suite <suite> --reason \"...\"`"))
    else:
        allowed = r17.get("cases") or {}
        over = []
        pool = {kind: 0 for kind in R17_METRICS}
        for c in cases:
            got = r17_counts(c)
            if _holdout(c):
                for kind, n in got.items():
                    pool[kind] += n
                continue
            may = allowed.get(c["id"]) or {}
            for kind, n in got.items():
                if n > int(may.get(kind, 0)):
                    over.append(f"{c['id']} {kind} {may.get(kind, 0)}->{n}")
        held = r17.get("holdout") or {}
        for kind, n in pool.items():
            if n > int(held.get(kind, 0)):
                over.append(f"(hold-out cases, pooled) {kind} {held.get(kind, 0)}->{n}")
        now = {kind: sum(r17_counts(c)[kind] for c in cases) for kind in R17_METRICS}
        lines.append(("R17 residuals: no case above its baseline", not over,
                      f"{len(over)} case count(s) above; now " + ", ".join(f"{k} {v}" for k, v in now.items())
                      + (": " + "; ".join(over[:5]) if over else "")))

    hands = [c["metrics"].get("notation.hand.accuracy") for c in cases
             if (c["metrics"] or {}).get("notation.hand.accuracy") is not None]
    mean = sum(hands) / len(hands) if hands else None
    lines.append((f"notation.hand.accuracy mean >= {HAND_MEAN_MIN:.2f}", mean is not None and mean >= HAND_MEAN_MIN - EPS,
                  f"mean {mean:.4f} over {len(hands)} cases" if mean is not None else "no value"))
    flips = [_label(c) for c in cases if ((base.get(c["id"]) or {}).get("metrics") or {}).get("critical.hands") == 1.0
             and c["metrics"].get("critical.hands") == 0.0]
    lines.append(("hands gate: no case regresses", not flips,
                  f"{len(flips)} case(s)" + (": " + ", ".join(flips[:5]) if flips else "")))

    spell, key = [], []
    for c in cases:
        b = (base.get(c["id"]) or {}).get("metrics") or {}
        a, bb = c["metrics"].get("notation.spelling.accuracy"), b.get("notation.spelling.accuracy")
        if a is not None and bb is not None and a < bb - EPS:
            spell.append(f"{_label(c)} {bb:.4f}->{a:.4f}")
        if b.get("critical.key") == 1.0 and c["metrics"].get("critical.key") == 0.0:
            key.append(_label(c))
    lines.append(("spelling: no case regresses", not spell, f"{len(spell)} case(s)" + (": " + "; ".join(spell[:5]) if spell else "")))
    lines.append(("key gate: no case regresses", not key, f"{len(key)} case(s)" + (": " + ", ".join(key[:5]) if key else "")))
    return lines


def format_lines(lines: List[Tuple[str, bool, str]]) -> str:
    out = ["", "G3 gate (G03 §20.4, §29 M6)"]
    for name, ok, detail in lines:
        out.append(f"  {'PASS' if ok else 'FAIL'}  {name} — {detail}")
    out.append("G3 gate: " + ("PASS" if all(ok for _, ok, _ in lines) else "FAIL"))
    return "\n".join(out)


def record_r17(results: Dict[str, Any], run: Dict[str, Any], suite_name: str, reason: str) -> Tuple[bool, str]:
    """Write the suite's R17 baseline from its last run. Refused unless every case carries the reason split and the
    run has no non-R17 residual and no mergeable defect (a G3-off run, or one with a defect, never becomes the
    allowance)."""
    cases = [c for c in results.get("cases", []) if c.get("status") == "ok"]
    if not cases:
        return False, "no case in the results"
    if any(r17_counts(c) is None for c in cases):
        return False, "the results carry no reason split (from before §29 M6): run the suite again"
    for _, k, _ in ZERO_LINES:
        bad = [c["id"] for c in cases if ((c["metrics"] or {}).get(k) or 0) > EPS]
        if bad:
            return False, f"{k} is above 0 in {len(bad)} case(s) (e.g. {bad[0]}): a run with residuals G3a should " \
                          "have written (or a G3-off run) cannot be the R17 allowance"
    counts = {c["id"]: r17_counts(c) for c in cases if not _holdout(c)}
    pooled = {kind: sum(r17_counts(c)[kind] for c in cases if _holdout(c)) for kind in R17_METRICS}
    doc = {"schema": R17_SCHEMA, "suite": suite_name, "reason": reason,
           "recorded_at": datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0).isoformat(),
           "git_sha": (run or {}).get("git_sha"), "sut_sha256": (run or {}).get("sut_sha256"),
           "totals": {kind: sum(r17_counts(c)[kind] for c in cases) for kind in R17_METRICS},
           "holdout": pooled,
           "cases": {cid: x for cid, x in sorted(counts.items()) if any(x.values())}}
    util.dump_json(doc, r17_path(suite_name))
    return True, f"{os.path.relpath(r17_path(suite_name), util.repo_root())}: {len(doc['cases'])} case(s), totals {doc['totals']}"
