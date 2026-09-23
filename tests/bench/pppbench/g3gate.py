"""The G3 gate (docs/GOALS/G03 §20.4, A34): ``run.py check --suite core --g3``.

G3 flips on only when, besides the G0 check itself, every line below passes on the suite's last run:

* no case loses a G0 critical gate it passed in the baseline (stricter than check's flip allowance);
* ``nq.tuplet.one_note_rate`` is 0 in every case (no one-note bracket), ``nq.shape.tm_missing`` is 0 in
  every case (no triplet length without time-modification), ``nq.tie.mergeable_rate`` is 0 in every case
  (no tie one symbol could replace);
* ``notation.hand.accuracy`` averages at least 0.90 and no case's hands gate goes from pass to fail;
* no case's ``notation.spelling.accuracy`` falls below its baseline and no case's key gate goes from pass
  to fail (A24: no allowance list).

The gate reads only results and the baseline; it changes nothing check reports without ``--g3``. Exit code
of ``check --g3``: check's own code when that is not 0 (1 REGRESSION, 2 ERROR), else 1 when a G3 line
FAILs, else 0.
"""

from __future__ import annotations

from typing import Any, Dict, List, Tuple

from .metrics.critical import GATES as CRITICAL_GATES

ZERO_METRICS = ("nq.tuplet.one_note_rate", "nq.shape.tm_missing", "nq.tie.mergeable_rate")
HAND_MEAN_MIN = 0.90
EPS = 1e-9


def evaluate(results: Dict[str, Any], baseline: Dict[str, Any]) -> List[Tuple[str, bool, str]]:
    """[(name, passed, detail)] for every G3 gate line."""
    cases = [c for c in results.get("cases", []) if c.get("status") == "ok"]
    base = (baseline or {}).get("cases") or {}
    lines: List[Tuple[str, bool, str]] = []

    lost = []
    for c in cases:
        b = (base.get(c["id"]) or {}).get("metrics") or {}
        for g in CRITICAL_GATES:
            if b.get(g) == 1.0 and (c["metrics"] or {}).get(g) == 0.0:
                lost.append(f"{c['id']} {g}")
    lines.append(("G0 critical gates: no case regresses", not lost,
                  f"{len(lost)} case gate(s) lost" + (": " + "; ".join(lost[:5]) if lost else "")))

    for k in ZERO_METRICS:
        vals = [(c["id"], c["metrics"].get(k)) for c in cases if (c["metrics"] or {}).get(k) is not None]
        bad = [(cid, v) for cid, v in vals if v > EPS]
        total = sum(v for _, v in vals)
        lines.append((f"{k} == 0", not bad,
                      f"{len(bad)} of {len(vals)} cases above 0 (sum {total:.4g}, mean {total / len(vals) if vals else 0:.4g})"
                      + (", e.g. " + ", ".join(cid for cid, _ in bad[:3]) if bad else "")))

    hands = [c["metrics"].get("notation.hand.accuracy") for c in cases
             if (c["metrics"] or {}).get("notation.hand.accuracy") is not None]
    mean = sum(hands) / len(hands) if hands else None
    lines.append((f"notation.hand.accuracy mean >= {HAND_MEAN_MIN:.2f}", mean is not None and mean >= HAND_MEAN_MIN - EPS,
                  f"mean {mean:.4f} over {len(hands)} cases" if mean is not None else "no value"))
    flips = [c["id"] for c in cases if ((base.get(c["id"]) or {}).get("metrics") or {}).get("critical.hands") == 1.0
             and c["metrics"].get("critical.hands") == 0.0]
    lines.append(("hands gate: no case regresses", not flips,
                  f"{len(flips)} case(s)" + (": " + ", ".join(flips[:5]) if flips else "")))

    spell, key = [], []
    for c in cases:
        b = (base.get(c["id"]) or {}).get("metrics") or {}
        a, bb = c["metrics"].get("notation.spelling.accuracy"), b.get("notation.spelling.accuracy")
        if a is not None and bb is not None and a < bb - EPS:
            spell.append(f"{c['id']} {bb:.4f}->{a:.4f}")
        if b.get("critical.key") == 1.0 and c["metrics"].get("critical.key") == 0.0:
            key.append(c["id"])
    lines.append(("spelling: no case regresses", not spell, f"{len(spell)} case(s)" + (": " + "; ".join(spell[:5]) if spell else "")))
    lines.append(("key gate: no case regresses", not key, f"{len(key)} case(s)" + (": " + ", ".join(key[:5]) if key else "")))
    return lines


def format_lines(lines: List[Tuple[str, bool, str]]) -> str:
    out = ["", "G3 gate (G03 §20.4)"]
    for name, ok, detail in lines:
        out.append(f"  {'PASS' if ok else 'FAIL'}  {name} — {detail}")
    out.append("G3 gate: " + ("PASS" if all(ok for _, ok, _ in lines) else "FAIL"))
    return "\n".join(out)
