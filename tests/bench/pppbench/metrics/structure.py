"""Structure: metre, key, tempo, bar count, bar numbers, play order, downbeats (docs/GOALS/G00 §8.4, §17, §19, §21).

Everything the user sees is read from the predicted MusicXML itself. The SUT's ``stats`` are used
only for what the MusicXML cannot say (where each bar falls in the recording) and are checked
against the MusicXML (``struct.stats_consistent``), never trusted for what it does say.

Tempo, metre and key are scored twice: the value the score states first (``struct.*.exact``,
``struct.tempo.ok_effective``: the app's score tempo) and over the whole score, note by note
(``struct.*.timeline_accuracy``, §19 F1), so that a change written in the wrong place — or a wrong
change late in the piece — counts.

Missing output is not "not applicable": when the reference has a tempo and the prediction writes
none, the tempo metrics are 0, not null (§17 B1).
"""

from __future__ import annotations

from fractions import Fraction
from typing import Dict, List, Optional, Sequence, Tuple

METRICAL_RATIOS = (1.0, 2.0, 0.5, 3.0, 1 / 3, 1.5, 2 / 3)
TEMPO_TOL = 0.04


def _beat_structure(time: Tuple[int, int]):
    b, t = time
    if t >= 8 and b % 3 == 0:
        return "compound", Fraction(3, t), b // 3
    return "simple", Fraction(1, t), b


def time_sig_score(pred: Tuple[int, int], exp: Tuple[int, int]) -> float:
    """1 exact · 0.5 regrouped (same beat, twice or half the beats a bar: 2/4↔4/4, 3/8↔6/8, 6/8↔12/8)
    · 0.25 same bar length, other beat (3/4↔6/8, 2/2↔4/4) · 0 anything else (3/4↔4/4 is not a regrouping)."""
    if tuple(pred) == tuple(exp):
        return 1.0
    kp, up, np_ = _beat_structure(pred)
    ke, ue, ne = _beat_structure(exp)
    if kp == ke and up == ue and (np_ == 2 * ne or ne == 2 * np_):
        return 0.5
    if Fraction(pred[0], pred[1]) == Fraction(exp[0], exp[1]):
        return 0.25
    return 0.0


def tonic_pc(fifths: int, mode: str) -> int:
    major = (7 * fifths) % 12
    return (major + 9) % 12 if mode == "minor" else major


def key_mirex(pred_fifths: int, pred_mode: str, exp_fifths: int, exp_mode: Optional[str]) -> Optional[float]:
    if exp_mode not in ("major", "minor"):
        return None
    pm = "minor" if pred_mode == "minor" else "major"
    pt, et = tonic_pc(pred_fifths, pm), tonic_pc(exp_fifths, exp_mode)
    if pm == exp_mode and pt == et:
        return 1.0
    if pm == exp_mode and (pt - et) % 12 in (5, 7):
        return 0.5
    if pm != exp_mode and pred_fifths == exp_fifths:
        return 0.3
    if pm != exp_mode and pt == et:
        return 0.2
    return 0.0


def downbeat_f1(pred: Sequence[float], ref: Sequence[float], lo: float, hi: float, tol: float = 0.07) -> Optional[float]:
    p = [t for t in pred if lo <= t <= hi]
    r = [t for t in ref if lo <= t <= hi]
    if not p and not r:
        return None
    cand = sorted((abs(a - b), i, j) for i, a in enumerate(r) for j, b in enumerate(p) if abs(a - b) <= tol)
    ur, up_, tp = set(), set(), 0
    for _, i, j in cand:
        if i in ur or j in up_:
            continue
        ur.add(i)
        up_.add(j)
        tp += 1
    prec = tp / len(p) if p else 0.0
    rec = tp / len(r) if r else 0.0
    return 2 * prec * rec / (prec + rec) if prec + rec else 0.0


def predicted_time(ctx) -> Tuple[int, int]:
    """The metre the user sees: the predicted MusicXML's own time signature (never stats, §17 M1)."""
    return ctx["pred"].primary_time()


# ----------------------------------------------------------------- whole-score sequences (G00 §19 F1)
EPS = Fraction(1, 1000000)


def app_tempo_timeline(canon) -> List[Tuple[Fraction, float]]:
    """The tempo the app's player uses along the score (``PianoScore.tempoMap``): every tempo mark —
    ``<sound tempo>`` and printed metronome marks alike — at its position; at one position the mark
    parseMusicXML read last wins (within a direction the metronome after the <sound>); before the first
    mark, the score tempo (``Score.tempo``, the first mark read, rounded; 84 without one).

    This is not always ``Score.tempo``: a 6/8 score whose <sound tempo> counts dotted quarters but whose
    printed dotted-quarter mark is right plays at the right speed, while its practice tempo, metronome
    and tempo % (``Score.tempo``) are 2/3 of it. Both are scored."""
    written = sorted(((mk.onset_q, float(mk.qpm)) for mk in canon.marks), key=lambda x: x[0])   # stable
    if not written or written[0][0] > EPS:
        written.insert(0, (Fraction(0), float(canon.app_qpm)))
    return written


def tempo_at(timeline: Sequence[Tuple[Fraction, float]], q) -> float:
    bpm = timeline[0][1]
    for pos, v in timeline:
        if pos > q + EPS:
            break
        bpm = v
    return bpm


def reference_tempo_timeline(ctx) -> Optional[List[Tuple[Fraction, float]]]:
    """The tempo the performance was played at, by score position: the synthetic performer's own map
    (its base tempo and the reference's marks, without rubato drift); for a recorded performance the
    reference's marks scaled to the expected tempo."""
    qpm = (ctx.get("expected") or {}).get("qpm")
    if not qpm:
        return None
    tm = getattr(ctx.get("perf"), "timemap", None)
    if tm is not None and hasattr(tm, "marks") and hasattr(tm, "qpm"):
        return [(Fraction(0), float(tm.qpm))] + [(Fraction(p), float(v)) for p, v in tm.marks]
    from ..perform import reference_marks
    return [(Fraction(0), float(qpm))] + [(Fraction(p), float(v)) for p, v in reference_marks(ctx["ref"], qpm, True)]


def _per_bar(values: List, expected) -> List:
    """The reference's value in each bar; a registry override applies when the reference has one value."""
    if expected is not None and len(set(values)) == 1:
        return [expected] * len(values)
    return values


def sequences(ctx) -> Dict[str, Optional[float]]:
    """Tempo, metre and key signature over the whole score, note by note: for every matched note, is it
    played at the right tempo, and read under the right time signature and key signature? A change
    written in the wrong place, or not at all, costs the notes it affects (G00 §19 F1)."""
    ref, pred, exp = ctx["ref"], ctx["pred"], ctx["expected"]
    ref_by = {s.id: s for s in ref.played()}
    pred_by = {s.id: s for s in pred.played()}
    pairs = [(p[0], p[1]) for p in ctx.get("pairs") or [] if p[0] in ref_by and p[1] in pred_by]
    has_notes = bool(ref_by)
    out: Dict[str, Optional[float]] = {}
    ref_times = _per_bar([m.time for m in ref.measures], tuple(exp["time"]) if exp.get("time") else None)
    ref_keys = _per_bar([m.fifths for m in ref.measures], (exp.get("key") or {}).get("fifths"))

    def share(ok) -> Optional[float]:
        if not pairs:
            return 0.0 if has_notes else None
        return sum(1 for r, p in pairs if ok(ref_by[r], pred_by[p])) / len(pairs)

    out["struct.time_sig.timeline_accuracy"] = share(
        lambda r, p: tuple(pred.measures[p.measure].time) == tuple(ref_times[r.measure]))
    out["struct.key.timeline_accuracy"] = share(lambda r, p: pred.measures[p.measure].fifths == ref_keys[r.measure])
    ref_tl = reference_tempo_timeline(ctx) if ctx["kind"] == "T" else None
    if ref_tl is None:
        out["struct.tempo.timeline_accuracy"] = None
    else:
        pred_tl = app_tempo_timeline(pred)
        out["struct.tempo.timeline_accuracy"] = share(
            lambda r, p: abs(tempo_at(pred_tl, p.onset_q) / tempo_at(ref_tl, r.onset_q) - 1) <= TEMPO_TOL)
        out["struct.tempo.marks_written"] = float(len(pred.marks))
    return out


def measure_numbers(pred) -> Dict[str, Optional[float]]:
    """Bar numbers as the app reads them (G00 §19 F2). ``valid``: they count up by one from 0 or 1 (every
    committed score does); a repeated, skipped or reordered number is a wrong number on the page and in
    every "practise bars 9-12". ``app_onset_accuracy``: the share of notes the app places where the
    MusicXML puts them — parseMusicXML keys bars by number, so bars sharing a number are laid over
    each other and their notes move (a restart 1 2 3 4 1 2 … stacks the piece into four bars)."""
    nums = [m.app_number for m in pred.measures]
    valid = bool(nums) and nums[0] in (0, 1) and all(b == a + 1 for a, b in zip(nums, nums[1:]))
    starts = pred.app_bar_starts()
    notes = pred.notes
    ok = sum(1 for n in notes if starts[pred.measures[n.measure].app_number] + n.pos_q == n.onset_q)
    return {"struct.measure_numbers.valid": float(valid),
            "struct.measure_numbers.app_onset_accuracy": ok / len(notes) if notes else 1.0}


def play_order(ctx) -> Dict[str, Optional[float]]:
    """Does the app play the prediction's bars in the music's order (G00 §21 S-M1)? The app expands repeat
    signs and first/second endings (``Score.form``) into what it strikes, its tempo map and its pedal, so a
    repeat sign that should not be there plays a passage twice, and one missing or moved plays another
    piece. ``order_exact`` compares the prediction's play order (``app_play_order``) with the truth's:

    * **performed input** (``kind`` T): the performance plays every written bar of the reference once, in
      order — the synthetic performer takes no repeat, and a recorded reference is "the score as played".
      Two notations of it are right: no repeat sign at all (the app plays every bar once, as performed),
      or the reference's own repeat signs and endings on the same bars (the piece as printed; the play
      order is then the reference's). Anything else is wrong: a repeat the reference does not have, one
      moved to another bar, another number of times, some of the reference's repeats kept and others
      dropped. The SUT hears no repeat it was not played, so leaving them all out is never penalised.
    * **a score read from a score** (``kind`` S: OMR, prediction files): the reference's play order only;
      without repeats on either side, every bar once.

    ``plays_per_bar`` (diagnostic): bars played per bar written, 1 without repeats."""
    pred, ref = ctx["pred"], ctx["ref"]
    pv, rv = pred.app_play_order(), ref.app_play_order()
    pred_once = pv == list(range(len(pred.measures)))
    ref_once = rv == list(range(len(ref.measures)))
    as_printed = len(pred.measures) == len(ref.measures) and pv == rv
    ok = as_printed or (pred_once and (ctx["kind"] == "T" or ref_once))
    return {"struct.form.order_exact": float(ok),
            "struct.form.plays_per_bar": len(pv) / len(pred.measures) if pred.measures else None}


def empty_edges(canon) -> Tuple[int, int]:
    """(leading, trailing) bars without a played note."""
    has = [False] * len(canon.measures)
    for s in canon.played():
        has[s.measure] = True
    lead = 0
    while lead < len(has) and not has[lead]:
        lead += 1
    if lead == len(has):
        return lead, 0
    trail = 0
    while not has[len(has) - 1 - trail]:
        trail += 1
    return lead, trail


def stats_consistent(pred, stats) -> Optional[float]:
    """1 when the SUT's stats describe the MusicXML it returned (bar count, metre, tempo); None without stats."""
    if not stats:
        return None
    if stats.get("bars") is not None and int(stats["bars"]) != len(pred.measures):
        return 0.0
    if stats.get("beatsPerBar"):
        if (int(stats["beatsPerBar"]), int(stats.get("beatType") or 4)) != tuple(pred.primary_time()):
            return 0.0
    if stats.get("tempo") is not None:
        if pred.sound_qpm is None or abs(float(stats["tempo"]) - pred.sound_qpm) > 0.5:
            return 0.0
    return 1.0


def compute(ctx) -> Dict[str, Optional[float]]:
    pred, ref, exp, kind = ctx["pred"], ctx["ref"], ctx["expected"], ctx["kind"]
    pt, et = predicted_time(ctx), tuple(exp["time"])
    m0 = pred.measures[0]
    pl, ptr = empty_edges(pred)
    rl, rtr = empty_edges(ref)
    out: Dict[str, Optional[float]] = {
        "struct.time_sig.exact": float(pt == et),
        "struct.time_sig.score": time_sig_score(pt, et),
        "struct.key.fifths_exact": float(m0.fifths == exp["key"]["fifths"]),
        "struct.key.mirex": key_mirex(m0.fifths, m0.mode, exp["key"]["fifths"], exp["key"].get("mode")),
        "struct.measures.count_exact": float(len(pred.measures) == exp["measures"]),
        "struct.measures.count_ratio": len(pred.measures) / exp["measures"] if exp["measures"] else None,
        # bars at the start or end of the score with nothing to play, beyond those the reference has
        "struct.measures.extra_empty_edge": float(max(0, (pl + ptr) - (rl + rtr))),
    }
    qpm = exp.get("qpm")
    if kind == "T":
        sq, pq, eff = pred.sound_qpm, pred.printed_qpm, pred.effective_qpm
        out["struct.stats_consistent"] = stats_consistent(pred, ctx.get("stats"))
        if qpm:
            # the reference has a tempo, so a prediction without one is missing output, scored 0 (§17 B1)
            out["struct.tempo.present"] = float(eff is not None)
            ratio = eff / qpm if eff else None
            out["struct.tempo.ratio_effective"] = ratio
            out["struct.tempo.ok_effective"] = float(ratio is not None and abs(ratio - 1) <= TEMPO_TOL)
            out["struct.tempo.ok_written"] = float(pq is not None and abs(pq / qpm - 1) <= TEMPO_TOL)
            out["struct.tempo.mark_consistent"] = float(sq is not None and pq is not None and abs(sq - pq) <= 0.01 * pq)
            base = pq or eff
            out["struct.tempo.metrical_ok"] = float(base is not None and
                                                    any(abs(base / qpm / r - 1) <= TEMPO_TOL for r in METRICAL_RATIOS))
        else:
            for k in ("present", "ratio_effective", "ok_effective", "ok_written", "mark_consistent", "metrical_ok"):
                out["struct.tempo." + k] = None
        st = ctx.get("stats") or {}
        notes = ctx["perf"].input["notes"] if ctx.get("perf") else []
        if notes and st.get("barStarts") is not None:
            lo = min(n["on"] for n in notes) - 0.1
            hi = max(n["on"] for n in notes) + 0.1
            starts = list(st["barStarts"])
            if pred.measures and pred.measures[0].implicit:
                starts = starts[1:]   # an implicit pickup bar starts on an upbeat, not a downbeat (§17 M5)
            out["struct.downbeat.f1"] = downbeat_f1(starts, exp.get("bar_starts") or [], lo, hi)
        else:
            out["struct.downbeat.f1"] = None
    out.update(sequences(ctx))
    out.update(measure_numbers(pred))
    out.update(play_order(ctx))
    return out
