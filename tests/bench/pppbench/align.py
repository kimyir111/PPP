"""Note alignment (docs/GOALS/G00 §8.3).

``align_timed``: per pitch, a monotone DP that maximises Σ(W − |Δt|) over
matched pairs within ±W seconds. Ties prefer diagonal > up > left.
``align_symbolic``: bar-level Needleman–Wunsch, then greedy note matching
inside aligned bars (for OMR output and prediction files without stats).
"""

from __future__ import annotations

from collections import Counter, defaultdict
from dataclasses import dataclass, field
from fractions import Fraction
from typing import Dict, List, Sequence, Tuple

NEG = float("-inf")


def _align_pitch(R: Sequence[Tuple[int, float]], P: Sequence[Tuple[int, float]], W: float):
    n, m = len(R), len(P)
    D = [[0.0] * (m + 1) for _ in range(n + 1)]
    B = [[0] * (m + 1) for _ in range(n + 1)]  # 0 diag, 1 up, 2 left
    for i in range(1, n + 1):
        tr = R[i - 1][1]
        Di, Dp, Bi = D[i], D[i - 1], B[i]
        for j in range(1, m + 1):
            d = abs(tr - P[j - 1][1])
            diag = Dp[j - 1] + (W - d) if d <= W else NEG
            up, left = Dp[j], Di[j - 1]
            if diag >= up and diag >= left:
                Di[j], Bi[j] = diag, 0
            elif up >= left:
                Di[j], Bi[j] = up, 1
            else:
                Di[j], Bi[j] = left, 2
    out = []
    i, j = n, m
    while i > 0 and j > 0:
        b = B[i][j]
        if b == 0:
            out.append((R[i - 1][0], P[j - 1][0], P[j - 1][1] - R[i - 1][1]))
            i, j = i - 1, j - 1
        elif b == 1:
            i -= 1
        else:
            j -= 1
    return out


def align_timed(ref: Sequence[Tuple[int, int, float]], pred: Sequence[Tuple[int, int, float]],
                window_s: float = 0.30) -> List[Tuple[int, int, float]]:
    """ref/pred: (id, midi, seconds). Returns (ref_id, pred_id, pred_t − ref_t) sorted by ids."""
    by_r: Dict[int, List[Tuple[int, float]]] = defaultdict(list)
    by_p: Dict[int, List[Tuple[int, float]]] = defaultdict(list)
    for i, midi, t in ref:
        by_r[midi].append((i, t))
    for i, midi, t in pred:
        by_p[midi].append((i, t))
    pairs = []
    for midi in sorted(set(by_r) & set(by_p)):
        R = sorted(by_r[midi], key=lambda x: (x[1], x[0]))
        P = sorted(by_p[midi], key=lambda x: (x[1], x[0]))
        pairs.extend(_align_pitch(R, P, window_s))
    return sorted(pairs, key=lambda p: (p[0], p[1]))


@dataclass
class SymbolicAlignment:
    measure_pairs: List[Tuple[int, int, float]] = field(default_factory=list)  # (ref, pred, S) with S >= 0.2
    pairs: List[Tuple[int, int]] = field(default_factory=list)                 # (ref sounding id, pred sounding id)
    ref_measures: int = 0


def _bag(canon, index: int) -> Counter:
    return Counter((s.midi, round(float(s.pos_q) * 48)) for s in canon.played() if s.measure == index)


def _jaccard(a: Counter, b: Counter) -> float:
    if not a and not b:
        return 1.0
    inter = sum((a & b).values())
    union = sum((a | b).values())
    return inter / union if union else 1.0


def align_symbolic(ref_canon, pred_canon, gap: float = 0.2, threshold: float = 0.2) -> SymbolicAlignment:
    nr, np_ = len(ref_canon.measures), len(pred_canon.measures)
    rb = [_bag(ref_canon, i) for i in range(nr)]
    pb = [_bag(pred_canon, j) for j in range(np_)]
    S = [[_jaccard(rb[i], pb[j]) for j in range(np_)] for i in range(nr)]
    D = [[0.0] * (np_ + 1) for _ in range(nr + 1)]
    B = [[0] * (np_ + 1) for _ in range(nr + 1)]
    for i in range(1, nr + 1):
        D[i][0], B[i][0] = D[i - 1][0] - gap, 1
    for j in range(1, np_ + 1):
        D[0][j], B[0][j] = D[0][j - 1] - gap, 2
    for i in range(1, nr + 1):
        for j in range(1, np_ + 1):
            diag = D[i - 1][j - 1] + S[i - 1][j - 1]
            up = D[i - 1][j] - gap
            left = D[i][j - 1] - gap
            if diag >= up and diag >= left:
                D[i][j], B[i][j] = diag, 0
            elif up >= left:
                D[i][j], B[i][j] = up, 1
            else:
                D[i][j], B[i][j] = left, 2
    mp = []
    i, j = nr, np_
    while i > 0 or j > 0:
        b = B[i][j] if i > 0 and j > 0 else (1 if i > 0 else 2)
        if b == 0:
            if S[i - 1][j - 1] >= threshold:
                mp.append((i - 1, j - 1, S[i - 1][j - 1]))
            i, j = i - 1, j - 1
        elif b == 1:
            i -= 1
        else:
            j -= 1
    mp.reverse()
    pairs = []
    tol = Fraction(1, 48)
    rp = ref_canon.played()
    pp = pred_canon.played()
    for ri, pj, _ in mp:
        rs = [s for s in rp if s.measure == ri]
        ps = [s for s in pp if s.measure == pj]
        cand = []
        for a in rs:
            for b in ps:
                if a.midi == b.midi and abs(a.pos_q - b.pos_q) <= tol:
                    cand.append((abs(a.pos_q - b.pos_q), a.id, b.id))
        used_r, used_p = set(), set()
        for _, a, b in sorted(cand):
            if a in used_r or b in used_p:
                continue
            used_r.add(a)
            used_p.add(b)
            pairs.append((a, b))
    return SymbolicAlignment(mp, sorted(pairs), nr)
