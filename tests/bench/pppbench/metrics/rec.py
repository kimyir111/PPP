"""Recording-to-score metrics (G10a-0, docs/GOALS/G10 section 7.5): what a teacher sees in a score made from a
transcription, against the written truth.

Computed only for suites that ask for them (``rec`` suites), on top of the G0 metrics; no existing suite's results
change. Inputs per case: the aligned note pairs of G0 (``ctx['pairs']``, one reference note to one predicted note,
within 300 ms in seconds), the bar offset G0 derives from them, the reference and predicted canonical scores, and
what the SUT adapter added (``extra``: the notation checker's class counts, the bar chords, the stability).

  rec.onset_f1                      pitch + written position (same bar, same place in the bar) F1
  rec.rest.precision / .recall      predicted rest spans against the truth's silences (>= a 16th, per staff-bar)
  rec.rest.false_per_100_bars       predicted rests that are not truth silences (overlap < half), per 100 bars
  rec.tuplet.precision / .recall    beats written as triplet beats against the truth's triplet beats
  rec.tuplet.false_per_100_beats    triplet beats the truth does not have, per 100 beats
  rec.voice.f1                      consecutive-note pairs in one voice, prediction against truth (MV2H voice sub-score)
  rec.check.<class>                 notation-check.js class counts per 100 bars of the predicted graph (classes 1-10)
  rec.harmony.agreement             share of truth bars whose chord (G7a root + quality) the prediction has too
  rec.stability                     share of bars whose notation changes when the onsets move by +-10 ms (3 seeds)
  rec.mv2h                          MV2H-like composite (McLeod and Steedman 2018): mean of the multi-pitch onset F1
                                    (notes.onset.f1_50ms), voice F1, metre F1 (bar, beat and sub-beat boundaries
                                    within 70 ms), value accuracy (notation.duration.accuracy_ref) and harmony agreement
  rec.usable                        every applicable G0 critical gate passes, classes 1-7 are 0, false rests per 100
                                    bars <= 5, false triplet beats <= 2 per 100 beats

Definitions are fixed here; a change is a new metric version (``REC_VERSION``).
"""

from __future__ import annotations

from collections import Counter, defaultdict
from fractions import Fraction
from typing import Any, Dict, List, Optional, Sequence, Tuple

REC_VERSION = "rec/1"
SIXTEENTH = Fraction(1, 4)             # a 16th, in quarter notes
POS_TOL = Fraction(1, 96)
METRE_TOL_S = 0.070
REST_FALSE_MAX = 5.0                   # rec.usable: false rests per 100 bars
TUPLET_FALSE_MAX = 2.0                 # rec.usable: false triplet beats per 100 beats
CHECK_CLASSES = tuple(range(1, 11))
ACCEPTANCE_CLASSES = tuple(range(1, 8))


def _f1(tp: float, n_pred: float, n_ref: float) -> float:
    if not tp:
        return 0.0
    p, r = tp / n_pred, tp / n_ref
    return 2 * p * r / (p + r)


# ----------------------------------------------------------------------------- alignment
def bar_offset_of(pairs, ref_by_id, pred_by_id) -> Optional[int]:
    """The predicted bar index minus the reference bar index that most pairs agree on (ties: smallest |offset|)."""
    if not pairs:
        return None
    offsets = Counter(pred_by_id[p].measure - ref_by_id[r].measure for r, p in pairs)
    top = max(offsets.values())
    return sorted((v for v, c in offsets.items() if c == top), key=lambda v: (abs(v), v))[0]


def pickup_shift(ref, pred) -> Fraction:
    """G0's rule (notation.pickup_shift): a reference pickup is right-aligned in a full predicted bar."""
    first = ref.measures[0]
    if not first.implicit or (pred.measures and pred.measures[0].implicit):
        return Fraction(0)
    return first.sig_q - first.len_q


# ----------------------------------------------------------------------------- rests
def _merge(spans: List[Tuple[Fraction, Fraction]]) -> List[Tuple[Fraction, Fraction]]:
    out: List[Tuple[Fraction, Fraction]] = []
    for a, b in sorted(spans):
        if out and a <= out[-1][1]:
            out[-1] = (out[-1][0], max(out[-1][1], b))
        else:
            out.append((a, b))
    return out


def _complement(spans, length: Fraction):
    gaps, at = [], Fraction(0)
    for a, b in _merge(spans):
        if a > at:
            gaps.append((at, a))
        at = max(at, b)
    if at < length:
        gaps.append((at, length))
    return gaps


def _overlap(a: Tuple[Fraction, Fraction], spans) -> Fraction:
    return sum((max(Fraction(0), min(a[1], b) - max(a[0], c)) for c, b in spans), Fraction(0))


def truth_silences(canon, merged_staves: bool) -> Dict[Tuple[int, int], List[Tuple[Fraction, Fraction]]]:
    """(bar index, staff) -> the maximal stretches of the bar where nothing sounds in that staff, each at least a
    16th long. ``merged_staves`` (a one-staff reference): the staff is the whole score, key (bar, 0)."""
    notes: Dict[Tuple[int, int], List[Tuple[Fraction, Fraction]]] = defaultdict(list)
    for s in canon.sounding:
        key = (s.measure, 0 if merged_staves else s.staff)
        notes[key].append((s.pos_q, s.pos_q + s.dur_q))
    staves = [0] if merged_staves else list(range(1, max(1, canon.staves) + 1))
    out = {}
    for m in canon.measures:
        for st in staves:
            gaps = [g for g in _complement(notes.get((m.index, st), []), m.len_q) if g[1] - g[0] >= SIXTEENTH]
            if gaps:
                out[(m.index, st)] = gaps
    return out


def predicted_rests(canon, merged_staves: bool) -> Dict[Tuple[int, int], List[Tuple[Fraction, Fraction]]]:
    """(bar index, staff) -> the written rest spans. Merged: only stretches rested in every staff count."""
    by: Dict[Tuple[int, int], List[Tuple[Fraction, Fraction]]] = defaultdict(list)
    for r in canon.rests:
        if r.measure_rest:
            length = canon.measures[r.measure].len_q
            by[(r.measure, r.staff)].append((Fraction(0), length))
        else:
            by[(r.measure, r.staff)].append((r.pos_q, r.pos_q + r.dur_q))
    if not merged_staves:
        return {k: _merge(v) for k, v in by.items()}
    staves = sorted({k[1] for k in by} | {s.staff for s in canon.sounding} | set(range(1, max(1, canon.staves) + 1)))
    out = {}
    for m in canon.measures:
        spans = None
        for st in staves:
            mine = _merge(by.get((m.index, st), []))
            spans = mine if spans is None else [(max(a, c), min(b, d)) for a, b in spans for c, d in mine if min(b, d) > max(a, c)]
        if spans:
            out[(m.index, 0)] = spans
    return out


def rest_metrics(ref, pred, offset: int, shift: Fraction) -> Dict[str, Optional[float]]:
    merged = ref.staves <= 1
    truth = truth_silences(ref, merged)
    # truth silences in the reference's own bars; the first bar's pickup shift is applied to them
    shifted: Dict[Tuple[int, int], List[Tuple[Fraction, Fraction]]] = {}
    for (m, st), gaps in truth.items():
        sh = shift if m == 0 else Fraction(0)
        shifted[(m + offset, st)] = [(a + sh, b + sh) for a, b in gaps]
    rests = predicted_rests(pred, merged)
    n_rest = n_ok = 0
    for key, spans in rests.items():
        for a, b in spans:
            n_rest += 1
            if (b - a) > 0 and _overlap((a, b), shifted.get(key, [])) * 2 >= (b - a):
                n_ok += 1
    n_truth = sum(len(v) for v in shifted.values())
    n_found = 0
    for key, gaps in shifted.items():
        spans = rests.get(key, [])
        for g in gaps:
            if _overlap(g, spans) * 2 >= (g[1] - g[0]):
                n_found += 1
    bars = len(pred.measures)
    return {"rec.rest.precision": (n_ok / n_rest) if n_rest else 1.0,
            "rec.rest.recall": (n_found / n_truth) if n_truth else None,
            "rec.rest.false_per_100_bars": 100.0 * (n_rest - n_ok) / bars if bars else None}


# ----------------------------------------------------------------------------- tuplets
def triplet_beats(canon, offset: int = 0, shift: Fraction = Fraction(0), first_bar_only_shift: bool = False):
    """The set of (bar index + offset, quarter-note beat) windows that hold a tuplet note or rest."""
    out = set()
    for s in canon.sounding:
        if s.tuplet:
            sh = shift if first_bar_only_shift and s.measure == 0 else Fraction(0)
            out.add((s.measure + offset, int(s.pos_q + sh)))
    for r in canon.rests:
        if r.tuplet:
            sh = shift if first_bar_only_shift and r.measure == 0 else Fraction(0)
            out.add((r.measure + offset, int(r.pos_q + sh)))
    return out


def tuplet_metrics(ref, pred, offset: int, shift: Fraction) -> Dict[str, Optional[float]]:
    truth = triplet_beats(ref, offset, shift, first_bar_only_shift=True)
    got = triplet_beats(pred)
    ok = len(truth & got)
    beats = float(sum(m.len_q for m in pred.measures))
    return {"rec.tuplet.precision": (ok / len(got)) if got else 1.0,
            "rec.tuplet.recall": (ok / len(truth)) if truth else None,
            "rec.tuplet.false_per_100_beats": 100.0 * len(got - truth) / beats if beats else None}


# ----------------------------------------------------------------------------- voices
def voice_pairs(canon, ids: Optional[Dict[int, int]] = None):
    """The consecutive-note pairs of every voice: per (staff, voice), the notes of each attack (onset) are linked to the
    notes of the next attack. ``ids`` maps a sounding id to the id compared in (None: the sounding's own)."""
    note_voice: Dict[int, int] = {}
    for s in canon.sounding:
        note_voice[s.id] = canon.notes[s.notes[0]].voice
    groups: Dict[Tuple[int, int], Dict[Fraction, List[int]]] = defaultdict(lambda: defaultdict(list))
    for s in canon.sounding:
        if s.hand not in ("r", "l"):
            continue
        groups[(s.staff, note_voice[s.id])][s.onset_q].append(s.id)
    pairs = set()
    n = 0
    for per in groups.values():
        qs = sorted(per)
        for a, b in zip(qs, qs[1:]):
            for x in per[a]:
                for y in per[b]:
                    n += 1
                    pairs.add((x, y))
    return pairs, n


def voice_f1(ref, pred, pairs) -> Optional[float]:
    t_pairs, n_truth = voice_pairs(ref)
    if not n_truth:
        return None
    p_pairs, n_pred = voice_pairs(pred)
    back = {p: r for r, p in pairs}                  # predicted id -> reference id
    tp = sum(1 for x, y in p_pairs if x in back and y in back and (back[x], back[y]) in t_pairs)
    return _f1(tp, n_pred, n_truth) if n_pred else 0.0


# ----------------------------------------------------------------------------- metre
def _beat_q(time: Tuple[int, int]) -> Tuple[Fraction, Fraction]:
    """(beat, sub-beat) in quarter notes: a dotted quarter divided in three eighths for 6/8, 9/8, 12/8; a quarter in
    halves for x/4; a half for x/2; an eighth for the rest (3/8, 5/8 ...)."""
    b, t = time
    if t == 8 and b % 3 == 0:
        return Fraction(3, 2), Fraction(1, 2)
    if t == 4:
        return Fraction(1), Fraction(1, 2)
    if t == 2:
        return Fraction(2), Fraction(1)
    return Fraction(1, 2), Fraction(1, 4)


def _boundaries(canon, sec) -> Dict[str, List[float]]:
    bars, beats, subs = [], [], []
    for m in canon.measures:
        beat, sub = _beat_q(m.time)
        q = Fraction(0)
        while q < m.len_q:
            beats.append(sec(m, q))
            q += beat
        q = Fraction(0)
        while q < m.len_q:
            subs.append(sec(m, q))
            q += sub
        bars.append(sec(m, Fraction(0)))
    return {"bar": bars, "beat": beats, "sub": subs}


def _match_f1(ref: Sequence[float], pred: Sequence[float], tol: float) -> float:
    ref, pred = sorted(ref), sorted(pred)
    i = j = tp = 0
    while i < len(ref) and j < len(pred):
        d = pred[j] - ref[i]
        if abs(d) <= tol:
            tp += 1
            i += 1
            j += 1
        elif d < 0:
            j += 1
        else:
            i += 1
    return _f1(tp, len(pred), len(ref)) if pred and ref else 0.0


def metre_f1(ref, pred, ref_sec, pred_sec) -> Optional[float]:
    r, p = _boundaries(ref, ref_sec), _boundaries(pred, pred_sec)
    if not r["bar"]:
        return None
    return sum(_match_f1(r[k], p[k], METRE_TOL_S) for k in ("bar", "beat", "sub")) / 3.0


# ----------------------------------------------------------------------------- harmony
def harmony_agreement(ref_chords: Optional[List[Optional[str]]], pred_chords: Optional[List[Optional[str]]], offset: int) -> Optional[float]:
    if not ref_chords or not any(ref_chords):
        return None
    if pred_chords is None:
        return 0.0
    ok = n = 0
    for i, c in enumerate(ref_chords):
        if c is None:
            continue
        n += 1
        j = i + offset
        if 0 <= j < len(pred_chords) and pred_chords[j] == c:
            ok += 1
    return ok / n if n else None


# ----------------------------------------------------------------------------- stability
def bar_digests(canon) -> List[Tuple]:
    """What is written in each bar (notes and rests with their printed shapes, ties, tuplets, staff), in a form
    two runs can be compared bar by bar."""
    per: Dict[int, List[Tuple]] = defaultdict(list)
    for n in canon.notes:
        per[n.measure].append(("n", n.staff, str(n.pos_q), str(n.dur_q), n.midi, n.type or "", n.dots, bool(n.tie_start), bool(n.tie_stop),
                               tuple(n.tuplet) if n.tuplet else None))
    for r in canon.rests:
        per[r.measure].append(("r", r.staff, str(r.pos_q), str(r.dur_q), r.type or "", r.dots, bool(r.measure_rest),
                               tuple(r.tuplet) if r.tuplet else None))
    return [(m.time, tuple(sorted(per.get(m.index, []), key=str))) for m in canon.measures]


def changed_bar_share(a: List[Tuple], b: List[Tuple]) -> float:
    n = max(len(a), len(b))
    if not n:
        return 0.0
    changed = sum(1 for i in range(n) if i >= len(a) or i >= len(b) or a[i] != b[i])
    return changed / n


# ----------------------------------------------------------------------------- assembly
def compute(ctx, extra: Dict[str, Any]) -> Dict[str, Optional[float]]:
    ref, pred, pt = ctx["ref"], ctx["pred"], ctx["pred_time"]
    perf = ctx["perf"]
    ref_by_id = {s.id: s for s in ref.played()}
    pred_by_id = {s.id: s for s in pred.played()}
    pairs = [(p[0], p[1]) for p in ctx["pairs"]]
    out: Dict[str, Optional[float]] = {}
    offset = bar_offset_of(pairs, ref_by_id, pred_by_id)
    shift = pickup_shift(ref, pred)
    if offset is None:
        offset = 0
    pos_ok = 0
    for rid, pid in pairs:
        r, p = ref_by_id[rid], pred_by_id[pid]
        rpos = r.pos_q + shift if r.measure == 0 else r.pos_q
        if p.measure - offset == r.measure and abs(p.pos_q - rpos) <= POS_TOL:
            pos_ok += 1
    out["rec.onset_f1"] = _f1(pos_ok, len(pred_by_id), len(ref_by_id)) if pred_by_id and ref_by_id else 0.0
    out.update(rest_metrics(ref, pred, offset, shift))
    out.update(tuplet_metrics(ref, pred, offset, shift))
    out["rec.voice.f1"] = voice_f1(ref, pred, pairs)
    check = extra.get("check")
    bars = len(pred.measures)
    for c in CHECK_CLASSES:
        out[f"rec.check.{c}"] = (100.0 * check["counts"].get(str(c), 0) / bars) if (check and bars) else None
    out["rec.harmony.agreement"] = harmony_agreement(extra.get("ref_harmony"), extra.get("harmony"), offset)
    out["rec.stability"] = extra.get("stability")
    ref_sec = lambda m, q: perf.timemap.sec(m.start_q + q)                       # noqa: E731
    pred_sec = lambda m, q: pt.sec(m.index, q)                                    # noqa: E731
    out["rec.metre.f1"] = metre_f1(ref, pred, ref_sec, pred_sec)
    return out


def finish(metrics: Dict[str, Optional[float]]) -> Dict[str, Optional[float]]:
    """Composites that need the G0 metrics and gates: rec.mv2h and rec.usable."""
    parts = [metrics.get("notes.onset.f1_50ms"), metrics.get("rec.voice.f1"), metrics.get("rec.metre.f1"),
             metrics.get("notation.duration.accuracy_ref"), metrics.get("rec.harmony.agreement")]
    have = [float(x) for x in parts if x is not None]
    out: Dict[str, Optional[float]] = {"rec.mv2h": sum(have) / len(have) if have else None}
    gates_ok = metrics.get("usable") == 1.0                       # every applicable G0 critical gate passes
    classes_ok = all((metrics.get(f"rec.check.{c}") or 0.0) == 0.0 and metrics.get(f"rec.check.{c}") is not None for c in ACCEPTANCE_CLASSES)
    false_rests = metrics.get("rec.rest.false_per_100_bars")
    false_tuplets = metrics.get("rec.tuplet.false_per_100_beats")
    rests_ok = false_rests is not None and false_rests <= REST_FALSE_MAX
    tuplets_ok = false_tuplets is not None and false_tuplets <= TUPLET_FALSE_MAX
    out["rec.usable"] = 1.0 if (gates_ok and classes_ok and rests_ok and tuplets_ok) else 0.0
    return out
