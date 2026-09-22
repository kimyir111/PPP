"""Diagnostic score ("SQI", version sqi/2), 0-100 (docs/GOALS/G00 §8.5, §17 M2).

A continuous number for trends between runs. It is NOT a quality verdict: whether a score can be
used is decided by the critical gates (metrics/critical.py) and reported as the usable-score rate.

Weights (sum 1.00), one user-facing dimension each, set from what a player sees and hears, not
fitted to results:
  notes present           notes.identity.f1                  0.20  wrong or missing notes are the most visible error
  beat placement          notation.onset_pos.accuracy_ref    0.15  where a note sits in the bar is what is read
  rhythm between onsets   notation.ioi.accuracy              0.10  lenient (allows a consistent ×2/×½ reading)
  note values             notation.duration.accuracy_ref     0.10
  metre                   struct.time_sig.score              0.10  partial credit only for true regroupings
  playback tempo          struct.tempo.ok_effective          0.10  what the app plays; missing = 0
  key signature           struct.key.fifths_exact            0.10
  hands                   notation.hand.accuracy_ref         0.10
  spelling                notation.spelling.accuracy_ref     0.05  same sound, readability only
The *_ref components count against every reference note, so a lost note is also unplaced, untimed,
unhanded and unspelled (sqi/1 scored those only on surviving notes, and an OMR result that lost
its whole right hand kept 72.5).

A component is left out (and the rest re-weighted) only when it does not apply to the case —
never because the prediction lacks it (§17 B1). Below half the weight applying, the score is null.
"""

from __future__ import annotations

from typing import Dict, Optional

SQI_WEIGHTS = {
    "notes.identity.f1": 0.20,
    "notation.onset_pos.accuracy_ref": 0.15,
    "notation.ioi.accuracy": 0.10,
    "notation.duration.accuracy_ref": 0.10,
    "struct.time_sig.score": 0.10,
    "struct.tempo.ok_effective": 0.10,
    "struct.key.fifths_exact": 0.10,
    "notation.hand.accuracy_ref": 0.10,
    "notation.spelling.accuracy_ref": 0.05,
}

SQI_S_WEIGHTS = {
    "notes.symbolic.f1": 0.35,
    "notation.duration.accuracy_ref": 0.15,
    "notation.onset_pos.accuracy_ref": 0.15,
    "notation.hand.accuracy_ref": 0.10,
    "notation.spelling.accuracy_ref": 0.05,
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
