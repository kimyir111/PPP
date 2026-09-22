"""Quarter positions -> seconds for reference and prediction (docs/GOALS/G00 §8.3)."""

from __future__ import annotations

import bisect
import math
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


def extend_beats(beats: Sequence[float], lo: float, hi: float, limit: int = 100000) -> List[float]:
    """The beat grid as the SUT uses it: past its first and last beat it goes on at the first and last
    beat interval (``tickToSec`` in audio-score.js extrapolates exactly so), until it covers [lo, hi]."""
    b = sorted(set(float(x) for x in beats))
    if len(b) < 2:
        return b
    first, last = b[1] - b[0], b[-1] - b[-2]
    head, tail = [], []
    t = b[0]
    while first > 1e-6 and t > lo + 1e-9 and len(head) < limit:
        t -= first
        head.append(t)
    t = b[-1]
    while last > 1e-6 and t < hi - 1e-9 and len(tail) < limit:
        t += last
        tail.append(t)
    return list(reversed(head)) + b + tail


class PredTime:
    """Prediction q -> sec from toMusicXml's ``stats.barStarts`` and ``stats.beats``.

    The SUT's time model: its beats are equally spaced in the score, time is linear between two beats,
    and a bar starts wherever ``tickToSec`` puts it — also before the first tracked beat or after the
    last one (a pickup written as a full bar, the bar holding the last note), where the grid is
    extended at the first or last beat interval. A position is mapped through its beat coordinate: the
    bar's start and end are located on the (extended) beat grid, the position is interpolated between
    them in beats, and the beat coordinate is turned into seconds. This holds whatever the phase of the
    bar line against the beats.

    reader/2 used only the tracked beats that fall inside a bar and spread them evenly over it. In a
    bar that reaches past the tracked grid (G05: a full first bar before the first beat) there are
    fewer such beats than beats in the bar, so the notes were placed up to a beat late — up to 300 ms
    at slow tempi, and 43 core cases lost pitch identity for it (G00 §19 m1)."""

    def __init__(self, pred_canon, stats: Dict[str, Any]):
        bs = [float(x) for x in (stats.get("barStarts") or [])]
        n = len(pred_canon.measures)
        if len(bs) != n + 1:
            raise StatsShapeError(f"stats.barStarts has {len(bs)} values for {n} measures (+1 expected)")
        self.bs = bs
        self.lens = [m.len_q for m in pred_canon.measures]
        grid = extend_beats(stats.get("beats") or [], min(bs), max(bs))
        self.grid = grid if len(grid) >= 2 else None
        self.u = [self._u_of_t(t) for t in bs] if self.grid else None

    def _u_of_t(self, t: float) -> float:
        g = self.grid
        j = bisect.bisect_right(g, t) - 1
        j = max(0, min(len(g) - 2, j))
        return j + (t - g[j]) / (g[j + 1] - g[j])

    def _t_of_u(self, u: float) -> float:
        g = self.grid
        j = max(0, min(len(g) - 2, int(math.floor(u))))
        return g[j] + (u - j) * (g[j + 1] - g[j])

    def sec(self, measure: int, pos_q) -> float:
        frac = float(Fraction(pos_q) / self.lens[measure]) if self.lens[measure] else 0.0
        if self.grid is None:
            t0, t1 = self.bs[measure], self.bs[measure + 1]
            return t0 + frac * (t1 - t0)
        u0, u1 = self.u[measure], self.u[measure + 1]
        return self._t_of_u(u0 + frac * (u1 - u0))


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
