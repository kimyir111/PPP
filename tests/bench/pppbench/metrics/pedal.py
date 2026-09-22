"""Damper pedal: are the pedal changes the performer made written into the score, and only those? (§17 M4)

Truth is what the performer's foot did. For a synthetic case that is the input the SUT received
(the ``pedal`` profile, or none). A replayed helper result is different: its input pedal is the AMT's
guess, so replay passes the performance's own pedal as ``ctx["truth_pedals"]`` — none for a rendered
fixture (the renderer is given notes only), unknown (None) for a real recording nobody annotated.
Scoring against the AMT's guess would call a SUT that stops writing invented pedal a regression.

- ``notation.pedal.f1`` (recall, precision): only when the performance used the pedal.
- ``notation.pedal.false_per_min``: written pedal changes that match no performed one, per minute of
  playing; when the performance used no pedal, every written change is false (playback sustains
  what the page says, so an invented pedal blurs the practice audio).

Marks are placed in time with the same bar grid as the notes (``timemap.PredTime``).
"""

from __future__ import annotations

from typing import Dict, List, Optional

TOL_S = 0.15   # a pedal change within 150 ms of the performed one is the same change


def _matched(truth: List[float], pred: List[float], tol: float) -> int:
    cand = sorted((abs(a - b), i, j) for i, a in enumerate(truth) for j, b in enumerate(pred) if abs(a - b) <= tol)
    ut, up, tp = set(), set(), 0
    for _, i, j in cand:
        if i in ut or j in up:
            continue
        ut.add(i)
        up.add(j)
        tp += 1
    return tp


def _minutes(perf) -> Optional[float]:
    notes = (perf.input.get("notes") if perf else None) or []
    if not notes:
        return None
    span = max(float(n["off"]) for n in notes) - min(float(n["on"]) for n in notes)
    return span / 60.0 if span > 0 else None


def compute(ctx) -> Dict[str, Optional[float]]:
    pred = ctx["pred"]
    perf, pt = ctx.get("perf"), ctx.get("pred_time")
    if "truth_pedals" in ctx:
        truth = ctx["truth_pedals"]
    else:
        truth = ((perf.input.get("pedals") if perf else None) or []) if perf else []
    out: Dict[str, Optional[float]] = {"notation.pedal.marks": float(len(pred.pedals)),
                                       "notation.pedal.f1": None, "notation.pedal.recall": None,
                                       "notation.pedal.precision": None, "notation.pedal.false_per_min": None}
    minutes = _minutes(perf)
    if truth is None or pt is None:
        return out
    downs_p = [pt.sec(m.measure, m.pos_q) for m in pred.pedals if m.type in ("start", "change")]
    ups_p = [pt.sec(m.measure, m.pos_q) for m in pred.pedals if m.type in ("stop", "change")]
    n_pred = len(downs_p) + len(ups_p)
    if not truth:
        if minutes:
            out["notation.pedal.false_per_min"] = n_pred / minutes
        return out
    downs_t = [float(p["on"]) for p in truth]
    ups_t = [float(p["off"]) for p in truth]
    tp = _matched(downs_t, downs_p, TOL_S) + _matched(ups_t, ups_p, TOL_S)
    n_true = len(downs_t) + len(ups_t)
    prec = tp / n_pred if n_pred else 0.0
    rec = tp / n_true if n_true else 0.0
    out["notation.pedal.precision"] = prec
    out["notation.pedal.recall"] = rec
    out["notation.pedal.f1"] = 2 * prec * rec / (prec + rec) if prec + rec else 0.0
    if minutes:
        out["notation.pedal.false_per_min"] = (n_pred - tp) / minutes
    return out
