"""Note preservation and timing (docs/GOALS/G00 §8.4)."""

from __future__ import annotations

from typing import Dict, Optional


def prf(tp: int, n_pred: int, n_ref: int):
    p = tp / n_pred if n_pred else (1.0 if not n_ref else 0.0)
    r = tp / n_ref if n_ref else (1.0 if not n_pred else 0.0)
    f = 2 * p * r / (p + r) if p + r else 0.0
    return p, r, f


def median(xs):
    s = sorted(xs)
    n = len(s)
    if not n:
        return None
    return s[n // 2] if n % 2 else (s[n // 2 - 1] + s[n // 2]) / 2


def compute(ctx) -> Dict[str, Optional[float]]:
    n_ref, n_pred = len(ctx["ref"].played()), len(ctx["pred"].played())
    pairs = ctx["pairs"]
    out: Dict[str, Optional[float]] = {}
    if ctx["kind"] == "S":
        p, r, f = prf(len(pairs), n_pred, n_ref)
        out.update({"notes.symbolic.precision": p, "notes.symbolic.recall": r, "notes.symbolic.f1": f})
        return out
    p, r, f = prf(len(pairs), n_pred, n_ref)
    out.update({"notes.identity.precision": p, "notes.identity.recall": r, "notes.identity.f1": f})
    tight = sum(1 for _, _, dt in pairs if abs(dt) <= 0.05)
    out["notes.onset.f1_50ms"] = prf(tight, n_pred, n_ref)[2]
    med = median([abs(dt) for _, _, dt in pairs])
    out["notes.timing.median_abs_ms"] = med * 1000 if med is not None else None
    if ctx.get("input_pairs") is not None:
        out["notes.input_fidelity.f1"] = prf(len(ctx["input_pairs"]), n_pred, ctx["n_input"])[2]
    return out
