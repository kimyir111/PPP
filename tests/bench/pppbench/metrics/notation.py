"""Notation accuracy on aligned note pairs (docs/GOALS/G00 §8.4, §17 B1/M2/M5).

Two families:
* ``notation.X.accuracy``     — over matched pairs: "given the note survived, is it written right?"
* ``notation.X.accuracy_ref`` — over reference notes: a note that is missing from the score is
  not correctly placed, timed, handed or spelled. The diagnostic score uses these (§17 M2).

A metric is null only when it does not apply (the registry skips it, a one-staff reference has no
hands, the reference has no tuplets). When it applies and nothing matched, it is 0 (§17 B1).
"""

from __future__ import annotations

from collections import Counter, defaultdict
from fractions import Fraction
from typing import Dict, List, Optional, Tuple

from .notes import median
from .readability import TYPE_Q, app_type

SCALES = (Fraction(1), Fraction(2), Fraction(1, 2), Fraction(3), Fraction(1, 3), Fraction(3, 2), Fraction(2, 3))
TOL_48 = Fraction(1, 48)
TOL_96 = Fraction(1, 96)


def glyph_q(note) -> Optional[Fraction]:
    """The length a written note's printed shape says (type or the app's typeFromQ, dots, tuplet ratio)."""
    base = TYPE_Q.get(app_type(note.type, note.dur_q))
    if base is None:
        return None
    v = base * (2 - Fraction(1, 2 ** note.dots))
    if note.tuplet:
        v = v * note.tuplet[1] / note.tuplet[0]
    return v


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


def pickup_shift(ref, pred) -> Fraction:
    """How far to move the reference's pickup notes before comparing bar positions.

    A reference pickup bar (implicit) is compared as written when the prediction also writes an
    implicit pickup bar, and right-aligned in a full bar when the prediction writes the pickup as
    a full bar that starts with rests. Both are correct engravings; neither is penalised (§17 M5)."""
    first = ref.measures[0]
    if not first.implicit:
        return Fraction(0)
    if pred.measures and pred.measures[0].implicit:
        return Fraction(0)
    return first.sig_q - first.len_q


def compute(ctx) -> Dict[str, Optional[float]]:
    ref, pred = ctx["ref"], ctx["pred"]
    ref_played = ref.played()
    ref_by_id = {s.id: s for s in ref_played}
    pred_by_id = {s.id: s for s in pred.played()}
    pairs = [(p[0], p[1]) for p in ctx["pairs"]]
    match = dict(pairs)
    n = len(pairs)
    n_ref = len(ref_played)
    skip = set(ctx.get("skip_metrics") or ())
    hands_apply = ref.staves >= 2 and "notation.hand.accuracy" not in skip
    ref_hand_notes = [s for s in ref_played if s.hand in "rl"] if hands_apply else []
    ref_has_tuplets = any(s.tuplet for s in ref_played)
    ref_groups = len({s.onset_q for s in ref_played})
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
        # the reference has successive onsets but none survived in pairs: rhythm is wrong, not "n/a"
        missing = 0.0 if ref_groups >= 2 else None
        out["notation.ioi.accuracy"] = missing
        out["notation.ioi.accuracy_strict"] = missing if ctx["kind"] == "T" else None

    if not n:
        for k in ("onset_pos.accuracy", "duration.accuracy", "duration.page_accuracy", "spelling.accuracy",
                  "onset_pos.accuracy_ref", "duration.accuracy_ref", "spelling.accuracy_ref"):
            out["notation." + k] = 0.0 if n_ref else None
        out["notation.hand.accuracy"] = 0.0 if ref_hand_notes else None
        out["notation.hand.accuracy_ref"] = 0.0 if ref_hand_notes else None
        out["notation.ties.extra_per_100"] = None
        out["notation.tuplets.f1"] = 0.0 if ref_has_tuplets else None
        out["notation.tuplets.false_per_100"] = (100 * sum(1 for s in pred_by_id.values() if s.tuplet) / len(pred_by_id)
                                                 if pred_by_id else None)
        for k in list(out):
            if k.replace("_ref", "") in skip or k in skip:
                out[k] = None
        return out

    offsets = Counter(pred_by_id[pid].measure - ref_by_id[rid].measure for rid, pid in pairs)
    top = max(offsets.values())
    bar_offset = sorted((v for v, c in offsets.items() if c == top), key=lambda v: (abs(v), v))[0]
    shift = pickup_shift(ref, pred)
    pos_ok = 0
    for rid, pid in pairs:
        r, p = ref_by_id[rid], pred_by_id[pid]
        rpos = r.pos_q + shift if r.measure == 0 else r.pos_q
        if p.measure - bar_offset == r.measure and abs(p.pos_q - rpos) <= TOL_96:
            pos_ok += 1
    dur_ok = sum(1 for rid, pid in pairs if abs(pred_by_id[pid].dur_q * s - ref_by_id[rid].dur_q) <= TOL_48)
    # the value the page shows: the printed shapes of the note's tied pieces (the app draws <type>/<dot>,
    # plays <duration>); a shape that disagrees with the length misstates the rhythm (§19 F2)
    pred_notes = pred.notes
    page_ok = 0
    for rid, pid in pairs:
        shown = [glyph_q(pred_notes[i]) for i in pred_by_id[pid].notes]
        if all(v is not None for v in shown) and abs(sum(shown) * s - ref_by_id[rid].dur_q) <= TOL_48:
            page_ok += 1
    spell_ok = sum(1 for rid, pid in pairs
                   if (ref_by_id[rid].step, ref_by_id[rid].alter) == (pred_by_id[pid].step, pred_by_id[pid].alter))
    out["notation.onset_pos.accuracy"] = pos_ok / n
    out["notation.duration.accuracy"] = dur_ok / n
    out["notation.duration.page_accuracy"] = page_ok / n
    out["notation.spelling.accuracy"] = spell_ok / n
    out["notation.onset_pos.accuracy_ref"] = pos_ok / n_ref
    out["notation.duration.accuracy_ref"] = dur_ok / n_ref
    out["notation.spelling.accuracy_ref"] = spell_ok / n_ref
    hand_pairs = [(ref_by_id[r].hand, pred_by_id[p].hand) for r, p in pairs
                  if ref_by_id[r].hand in "rl" and pred_by_id[p].hand in "rl"]
    hand_ok = sum(1 for a, b in hand_pairs if a == b)
    if not hands_apply:
        out["notation.hand.accuracy"] = None
        out["notation.hand.accuracy_ref"] = None
    else:
        out["notation.hand.accuracy"] = hand_ok / len(hand_pairs) if hand_pairs else 0.0
        out["notation.hand.accuracy_ref"] = hand_ok / len(ref_hand_notes) if ref_hand_notes else None
    out["notation.ties.extra_per_100"] = 100 * sum(
        max(0, pred_by_id[pid].pieces - ref_by_id[rid].pieces) for rid, pid in pairs) / n
    # tuplets: F1 applies when the reference has tuplets (the truth decides, never the prediction);
    # tuplets written where the reference has none are counted separately, for every case
    tp = sum(1 for r, p in pairs if ref_by_id[r].tuplet and pred_by_id[p].tuplet)
    fp = sum(1 for r, p in pairs if not ref_by_id[r].tuplet and pred_by_id[p].tuplet)
    fn = sum(1 for r, p in pairs if ref_by_id[r].tuplet and not pred_by_id[p].tuplet)
    fn += sum(1 for sid, s in ref_by_id.items() if s.tuplet and sid not in match)   # lost tuplet notes
    out["notation.tuplets.f1"] = (2 * tp / (2 * tp + fp + fn)) if ref_has_tuplets else None
    matched_pred = set(match.values())
    false_tuplets = fp + sum(1 for pid, s in pred_by_id.items() if s.tuplet and pid not in matched_pred)
    out["notation.tuplets.false_per_100"] = 100 * false_tuplets / len(pred_by_id) if pred_by_id else None
    for k in list(out):
        base = k[:-4] if k.endswith("_ref") else k
        if k in skip or base in skip:
            out[k] = None
    return out
