"""Notation accuracy on aligned note pairs (docs/GOALS/G00 §8.4)."""

from __future__ import annotations

from collections import Counter, defaultdict
from fractions import Fraction
from typing import Dict, List, Optional, Tuple

from .notes import median

SCALES = (Fraction(1), Fraction(2), Fraction(1, 2), Fraction(3), Fraction(1, 3), Fraction(3, 2), Fraction(2, 3))
TOL_48 = Fraction(1, 48)
TOL_96 = Fraction(1, 96)


def _ioi_pairs(ref_by_id, pred_by_id, match: Dict[int, int]) -> List[Tuple[Fraction, Fraction]]:
    """(ref IOI, pred IOI) for adjacent reference onset groups that both have a matched note.

    Each group is represented by its highest matched reference note."""
    groups: Dict[Fraction, List] = defaultdict(list)
    for sid in match:
        s = ref_by_id[sid]
        groups[s.onset_q].append(s)
    all_onsets = sorted({s.onset_q for s in ref_by_id.values()})
    out = []
    for a, b in zip(all_onsets, all_onsets[1:]):
        if a not in groups or b not in groups:
            continue
        ra = max(groups[a], key=lambda s: (s.midi, s.id))
        rb = max(groups[b], key=lambda s: (s.midi, s.id))
        out.append((b - a, pred_by_id[match[rb.id]].onset_q - pred_by_id[match[ra.id]].onset_q))
    return out


def metrical_scale(ioi: List[Tuple[Fraction, Fraction]]) -> Optional[Fraction]:
    ratios = [float(r / p) for r, p in ioi if p > 0]
    if len(ratios) < 3:
        return None
    med = median(ratios)
    best, err = Fraction(1), None
    for c in SCALES:
        e = abs(med / float(c) - 1)
        if e <= 0.08 and (err is None or e < err):
            best, err = c, e
    return best


def compute(ctx) -> Dict[str, Optional[float]]:
    ref, pred = ctx["ref"], ctx["pred"]
    ref_by_id = {s.id: s for s in ref.played()}
    pred_by_id = {s.id: s for s in pred.played()}
    pairs = [(p[0], p[1]) for p in ctx["pairs"]]
    match = dict(pairs)
    n = len(pairs)
    out: Dict[str, Optional[float]] = {}
    ioi = _ioi_pairs(ref_by_id, pred_by_id, match)
    scale = metrical_scale(ioi) if ctx["kind"] == "T" else Fraction(1)
    out["notation.metrical_scale"] = float(scale) if scale is not None else None
    s = scale if scale is not None else Fraction(1)
    if ioi:
        out["notation.ioi.accuracy"] = sum(1 for r, p in ioi if abs(p * s - r) <= TOL_48) / len(ioi)
        out["notation.ioi.accuracy_strict"] = (sum(1 for r, p in ioi if abs(p - r) <= TOL_48) / len(ioi)
                                               if ctx["kind"] == "T" else None)
    else:
        out["notation.ioi.accuracy"] = None
        out["notation.ioi.accuracy_strict"] = None
    if not n:
        for k in ("onset_pos.accuracy", "duration.accuracy", "hand.accuracy", "spelling.accuracy",
                  "ties.extra_per_100", "tuplets.f1"):
            out["notation." + k] = None
        return out

    offsets = Counter(pred_by_id[pid].measure - ref_by_id[rid].measure for rid, pid in pairs)
    top = max(offsets.values())
    bar_offset = sorted((v for v, c in offsets.items() if c == top), key=lambda v: (abs(v), v))[0]
    first = ref.measures[0]
    pos_ok = 0
    for rid, pid in pairs:
        r, p = ref_by_id[rid], pred_by_id[pid]
        rpos = r.pos_q + (first.sig_q - first.len_q) if (r.measure == 0 and first.implicit) else r.pos_q
        if p.measure - bar_offset == r.measure and abs(p.pos_q - rpos) <= TOL_96:
            pos_ok += 1
    out["notation.onset_pos.accuracy"] = pos_ok / n
    out["notation.duration.accuracy"] = sum(
        1 for rid, pid in pairs if abs(pred_by_id[pid].dur_q * s - ref_by_id[rid].dur_q) <= TOL_48) / n
    skip = set(ctx.get("skip_metrics") or ())
    hand_pairs = [(ref_by_id[r].hand, pred_by_id[p].hand) for r, p in pairs
                  if ref_by_id[r].hand in "rl" and pred_by_id[p].hand in "rl"]
    if ref.staves < 2 or "notation.hand.accuracy" in skip or not hand_pairs:
        out["notation.hand.accuracy"] = None
    else:
        out["notation.hand.accuracy"] = sum(1 for a, b in hand_pairs if a == b) / len(hand_pairs)
    out["notation.spelling.accuracy"] = sum(
        1 for rid, pid in pairs
        if (ref_by_id[rid].step, ref_by_id[rid].alter) == (pred_by_id[pid].step, pred_by_id[pid].alter)) / n
    out["notation.ties.extra_per_100"] = 100 * sum(
        max(0, pred_by_id[pid].pieces - ref_by_id[rid].pieces) for rid, pid in pairs) / n
    tp = sum(1 for r, p in pairs if ref_by_id[r].tuplet and pred_by_id[p].tuplet)
    fp = sum(1 for r, p in pairs if not ref_by_id[r].tuplet and pred_by_id[p].tuplet)
    fn = sum(1 for r, p in pairs if ref_by_id[r].tuplet and not pred_by_id[p].tuplet)
    out["notation.tuplets.f1"] = (2 * tp / (2 * tp + fp + fn)) if tp + fp + fn else None
    for k in list(out):
        if k in skip:
            out[k] = None
    return out
