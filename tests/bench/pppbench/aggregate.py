"""Suite aggregates: macro means per metric, micro note totals, per tag (docs/GOALS/G00 §8.6).

Hold-out cases are left out of ``all`` and reported only under ``by_tag.holdout``."""

from __future__ import annotations

from collections import Counter, defaultdict
from typing import Any, Dict, List


def _summarise(cases: List[Dict[str, Any]]) -> Dict[str, Any]:
    sums: Dict[str, float] = defaultdict(float)
    ns: Dict[str, int] = defaultdict(int)
    ok = [c for c in cases if c["status"] == "ok"]
    for c in ok:
        for k, v in c["metrics"].items():
            if v is None:
                continue
            sums[k] += float(v)
            ns[k] += 1
    out: Dict[str, Any] = {k: {"mean": sums[k] / ns[k], "n": ns[k]} for k in sorted(sums)}
    ref = sum(c["counts"].get("ref", 0) for c in ok)
    pred = sum(c["counts"].get("pred", 0) for c in ok)
    pairs = sum(c["counts"].get("pairs", 0) for c in ok)
    out["notes.identity.recall_micro"] = {"mean": pairs / ref if ref else None, "n": len(ok)}
    out["notes.identity.precision_micro"] = {"mean": pairs / pred if pred else None, "n": len(ok)}
    errors = Counter(c["error_code"] for c in cases if c["status"] == "error")
    out["errors"] = {"count": sum(errors.values()), "by_code": dict(sorted(errors.items()))}
    out["cases"] = len(cases)
    return out


def aggregate(cases: List[Dict[str, Any]]) -> Dict[str, Any]:
    open_cases = [c for c in cases if "holdout" not in c["tags"]]
    by_tag: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    for c in cases:
        for t in c["tags"]:
            if t == "holdout" or "holdout" not in c["tags"]:
                by_tag[t].append(c)
    return {"all": _summarise(open_cases), "by_tag": {t: _summarise(cs) for t, cs in sorted(by_tag.items())}}
