"""Structure: metre, key, tempo, bar count, downbeats (docs/GOALS/G00 §8.4)."""

from __future__ import annotations

from fractions import Fraction
from typing import Dict, Optional, Sequence, Tuple

METRICAL_RATIOS = (1.0, 2.0, 0.5, 3.0, 1 / 3, 1.5, 2 / 3)


def _beat_structure(time: Tuple[int, int]):
    b, t = time
    if t >= 8 and b % 3 == 0:
        return "compound", Fraction(3, t), b // 3
    return "simple", Fraction(1, t), b


def time_sig_score(pred: Tuple[int, int], exp: Tuple[int, int]) -> float:
    """1 exact · 0.5 regrouped (2/4↔4/4, 3/8↔6/8) · 0.25 same bar length (3/4↔6/8, 2/2↔4/4) · 0."""
    if tuple(pred) == tuple(exp):
        return 1.0
    kp, up, _ = _beat_structure(pred)
    ke, ue, _ = _beat_structure(exp)
    if kp == ke and up == ue:
        return 0.5
    if Fraction(pred[0], pred[1]) == Fraction(exp[0], exp[1]):
        return 0.25
    return 0.0


def tonic_pc(fifths: int, mode: str) -> int:
    major = (7 * fifths) % 12
    return (major + 9) % 12 if mode == "minor" else major


def key_mirex(pred_fifths: int, pred_mode: str, exp_fifths: int, exp_mode: Optional[str]) -> Optional[float]:
    if exp_mode not in ("major", "minor"):
        return None
    pm = "minor" if pred_mode == "minor" else "major"
    pt, et = tonic_pc(pred_fifths, pm), tonic_pc(exp_fifths, exp_mode)
    if pm == exp_mode and pt == et:
        return 1.0
    if pm == exp_mode and (pt - et) % 12 in (5, 7):
        return 0.5
    if pm != exp_mode and pred_fifths == exp_fifths:
        return 0.3
    if pm != exp_mode and pt == et:
        return 0.2
    return 0.0


def downbeat_f1(pred: Sequence[float], ref: Sequence[float], lo: float, hi: float, tol: float = 0.07) -> Optional[float]:
    p = [t for t in pred if lo <= t <= hi]
    r = [t for t in ref if lo <= t <= hi]
    if not p and not r:
        return None
    cand = sorted((abs(a - b), i, j) for i, a in enumerate(r) for j, b in enumerate(p) if abs(a - b) <= tol)
    ur, up_, tp = set(), set(), 0
    for _, i, j in cand:
        if i in ur or j in up_:
            continue
        ur.add(i)
        up_.add(j)
        tp += 1
    prec = tp / len(p) if p else 0.0
    rec = tp / len(r) if r else 0.0
    return 2 * prec * rec / (prec + rec) if prec + rec else 0.0


def predicted_time(ctx) -> Tuple[int, int]:
    st = ctx.get("stats")
    if st and st.get("beatsPerBar"):
        return (int(st["beatsPerBar"]), int(st.get("beatType") or 4))
    return ctx["pred"].primary_time()


def compute(ctx) -> Dict[str, Optional[float]]:
    pred, exp, kind = ctx["pred"], ctx["expected"], ctx["kind"]
    pt, et = predicted_time(ctx), tuple(exp["time"])
    m0 = pred.measures[0]
    out: Dict[str, Optional[float]] = {
        "struct.time_sig.exact": float(pt == et),
        "struct.time_sig.score": time_sig_score(pt, et),
        "struct.key.fifths_exact": float(m0.fifths == exp["key"]["fifths"]),
        "struct.key.mirex": key_mirex(m0.fifths, m0.mode, exp["key"]["fifths"], exp["key"].get("mode")),
        "struct.measures.count_exact": float(len(pred.measures) == exp["measures"]),
        "struct.measures.count_ratio": len(pred.measures) / exp["measures"] if exp["measures"] else None,
    }
    sq, pq = pred.sound_qpm, pred.printed_qpm
    out["struct.tempo.mark_consistent"] = float(abs(sq - pq) <= 0.01 * pq) if sq and pq else None
    qpm = exp.get("qpm")
    if kind == "T":
        eff = pred.effective_qpm
        ratio = eff / qpm if eff and qpm else None
        out["struct.tempo.ratio_effective"] = ratio
        out["struct.tempo.ok_effective"] = float(abs(ratio - 1) <= 0.04) if ratio is not None else None
        out["struct.tempo.ok_written"] = float(abs(pq / qpm - 1) <= 0.04) if pq and qpm else None
        base = pq or eff
        out["struct.tempo.metrical_ok"] = (float(any(abs(base / qpm / r - 1) <= 0.04 for r in METRICAL_RATIOS))
                                           if base and qpm else None)
        st = ctx.get("stats") or {}
        notes = ctx["perf"].input["notes"] if ctx.get("perf") else []
        if notes and st.get("barStarts") is not None:
            lo = min(n["on"] for n in notes) - 0.1
            hi = max(n["on"] for n in notes) + 0.1
            out["struct.downbeat.f1"] = downbeat_f1(st["barStarts"], exp.get("bar_starts") or [], lo, hi)
        else:
            out["struct.downbeat.f1"] = None
    return out
