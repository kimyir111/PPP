"""Score Quality Index, 0-100 (docs/GOALS/G00 §8.5). A dashboard number: gates never rely on it alone.

Changing a weight or a component means bumping SQI_VERSION."""

from __future__ import annotations

from typing import Dict, Optional

SQI_WEIGHTS = {
    "notes.identity.f1": 0.20,
    "notation.ioi.accuracy": 0.20,
    "notation.duration.accuracy": 0.10,
    "notation.onset_pos.accuracy": 0.10,
    "struct.time_sig.score": 0.10,
    "struct.key.fifths_exact": 0.10,
    "struct.tempo.ok_effective": 0.05,
    "notation.hand.accuracy": 0.10,
    "notation.spelling.accuracy": 0.05,
}

SQI_S_WEIGHTS = {
    "notes.symbolic.f1": 0.35,
    "notation.duration.accuracy": 0.15,
    "notation.onset_pos.accuracy": 0.15,
    "notation.hand.accuracy": 0.10,
    "notation.spelling.accuracy": 0.05,
    "struct.time_sig.score": 0.10,
    "struct.key.fifths_exact": 0.10,
}


def _weighted(metrics: Dict[str, Optional[float]], weights: Dict[str, float]) -> Optional[float]:
    num = den = 0.0
    for k, w in weights.items():
        v = metrics.get(k)
        if v is None:
            continue
        num += w * v
        den += w
    if den < 0.5 - 1e-9:
        return None
    return 100.0 * num / den


def sqi(metrics: Dict[str, Optional[float]]) -> Optional[float]:
    return _weighted(metrics, SQI_WEIGHTS)


def sqi_symbolic(metrics: Dict[str, Optional[float]]) -> Optional[float]:
    return _weighted(metrics, SQI_S_WEIGHTS)
