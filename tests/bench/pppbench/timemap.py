"""Quarter positions -> seconds for reference and prediction (docs/GOALS/G00 §8.3)."""

from __future__ import annotations

from fractions import Fraction
from typing import Any, Dict, List, Sequence


class StatsShapeError(Exception):
    code = "STATS_SHAPE"


class RefTime:
    """Reference q -> sec from a synthetic TimeMap, or from recorded bar starts."""

    def __init__(self, fn):
        self._fn = fn

    @classmethod
    def from_timemap(cls, tm) -> "RefTime":
        return cls(lambda measure, pos_q, onset_q: tm.sec(onset_q))

    @classmethod
    def from_bar_starts(cls, canon, bar_starts_s: Sequence[float]) -> "RefTime":
        if len(bar_starts_s) != len(canon.measures) + 1:
            raise StatsShapeError(f"bar_starts has {len(bar_starts_s)} values for {len(canon.measures)} measures (+1 expected)")
        lens = [m.len_q for m in canon.measures]

        def fn(measure, pos_q, onset_q):
            t0, t1 = bar_starts_s[measure], bar_starts_s[measure + 1]
            return t0 + float(Fraction(pos_q) / lens[measure]) * (t1 - t0)
        return cls(fn)

    def sec(self, measure: int, pos_q, onset_q) -> float:
        return self._fn(measure, pos_q, onset_q)


class PredTime:
    """Prediction q -> sec from toMusicXml's ``stats.barStarts`` and ``stats.beats``."""

    def __init__(self, pred_canon, stats: Dict[str, Any]):
        bs = list(stats.get("barStarts") or [])
        n = len(pred_canon.measures)
        if len(bs) != n + 1:
            raise StatsShapeError(f"stats.barStarts has {len(bs)} values for {n} measures (+1 expected)")
        beats = sorted(stats.get("beats") or [])
        self.points: List[List[float]] = []
        for i in range(n):
            t0 = bs[i]
            t1 = bs[i + 1] if i + 1 < len(bs) else bs[i] + (bs[i] - bs[i - 1])
            inner = [b for b in beats if t0 + 0.001 < b < t1 - 0.001]
            self.points.append([t0] + inner + [t1])
        self.lens = [m.len_q for m in pred_canon.measures]

    def sec(self, measure: int, pos_q) -> float:
        pts = self.points[measure]
        u = float(Fraction(pos_q) / self.lens[measure]) * (len(pts) - 1)
        k = int(u)
        if k > len(pts) - 2:
            k = len(pts) - 2
        if k < 0:
            k = 0
        return pts[k] + (u - k) * (pts[k + 1] - pts[k])


class BarStartTimeMap:
    """Reference q -> sec from human-checked bar starts (len = measures + 1), linear inside a bar.

    Has the ``sec(q)`` interface of perform.TimeMap so replay cases share the timed evaluation."""

    def __init__(self, canon, bar_starts_s: Sequence[float]):
        if len(bar_starts_s) != len(canon.measures) + 1:
            raise StatsShapeError(f"bar_starts has {len(bar_starts_s)} values for {len(canon.measures)} measures (+1 expected)")
        self.starts = [m.start_q for m in canon.measures]
        self.lens = [m.len_q for m in canon.measures]
        self.bs = list(bar_starts_s)

    def sec(self, q) -> float:
        import bisect
        q = Fraction(q)
        i = max(0, min(len(self.starts) - 1, bisect.bisect_right(self.starts, q) - 1))
        t0, t1 = self.bs[i], self.bs[i + 1]
        return t0 + float((q - self.starts[i]) / self.lens[i]) * (t1 - t0)
