"""nq.* — notation quality (docs/GOALS/G03 §20.3), computed from reader/5's notation layer.

Informational: no nq.* metric enters a critical gate, the diagnostic score or the usable rate. The G3 gate
(``run.py check --g3``, §20.4) reads three of them. Every value is a property of one file, computed on the
prediction and on the reference the same way; ``.delta`` is prediction − reference.

The shared definitions (events, tie chains, mergeable ties, triplet lengths, spelling, ledger lines) are
``pppbench.notation_read``'s, the ones the G3 Step 0 audit (tests/bench/tools/notation_audit.py) reproduced
Appendix A-2 with, so a file's nq value and its audit numbers agree.

  nq.tuplet.group_complete   printed brackets whose members' printed values add up to actual × unit (unit
                             = <normal-type>, else any plain value that makes it so) / brackets
  nq.tuplet.one_note_rate    brackets holding one event / brackets (G1 F1, issue 20)
  nq.shape.tm_missing        Σ events whose length is not a dyadic fraction of a quarter and that carry no
                             <time-modification> (issue 19)
  nq.tie.mergeable_rate      ties whose joined span lies in one beat and is one value with <= 2 dots / ties
  nq.rhythm.hidden_beat_rate pitched events that hide a beat the S table does not allow / pitched events:
                             simple metre — starting off a beat and crossing one, or crossing the middle of
                             4/4 from a beat; compound — crossing a dotted-quarter beat, unless it starts on a
                             beat and ends at its group's end (G03 §6.2 H4/H5, §6.3)
  nq.rest.per_measure_delta  rests / bar, prediction − reference
  nq.rhythm.short_rate_delta 32nd-or-shorter note elements / note elements, prediction − reference
  nq.voice.poly_recall       reference staff-bars (the piano's two staves) with 2+ voices whose aligned
                             prediction staff-bar has 2+ voices / those reference staff-bars
  nq.beam.coverage           beamable events (printed eighth or shorter, 2+ of them in one voice's primary
                             beam group, G03 §11.2) under a primary beam / beamable events
  nq.beam.boundary_ok        primary beams inside one beam group of one bar / beams
  nq.acc.redundant_rate      printed accidentals neither needed (key signature and the bar's state per staff,
                             step and octave) nor courtesy (G03 §10.3 a–c) / pitched notes
  nq.spell.context_odd       E#, B#, Cb, Fb the key signature does not contain, per 1000 pitched notes
  nq.spell.mixed_bar_rate    staff-bars printing both sharp- and flat-type accidentals / staff-bars
  nq.range.ledger4_rate      pitched notes 4+ ledger lines off their staff, per 1000 pitched notes
  nq.ned                     notation edit distance: per bar and piano staff, the events' symbols (rest or
                             note, type, dots, tie start, inside a bracket) in voice then time order;
                             Levenshtein distance of the prediction's bar (shifted by the bars the matched
                             notes say) to the reference's, summed / reference symbols

Why each residual is there (G03 §28 M6, U-1/U-2; pppbench.notation_reasons), prediction only, counts:

  nq.shape.tm_missing.r17 / .unexpected      tm_missing split: R17 (G3b's to fix) / every other reason
  nq.tuplet.one_note.r17 / .unexpected       one-note tuplets, split the same way: a bracket over one event, and a
                                             time-modified event under no bracket (one whose bracket is hidden)
  nq.tie.mergeable.defect                    mergeable ties one legal symbol G3a would write could replace
  nq.tie.mergeable.required_h6 / .required_h7 / .required_beat_split / .partial_chord / .cross_voice / .r17
                                             mergeable ties merging would break a rule for (H6, H7, H4/H5 with the
                                             pickup offset), a chord only partly tied (U-2), two voices, or R17

A metric with nothing to measure (no bracket, no tie, no beam …) is None.
"""

from __future__ import annotations

from collections import Counter
from fractions import Fraction
from typing import Any, Dict, List, Optional, Tuple

from .. import notation_read as NR
from .. import notation_reasons as RS

EPS = Fraction(1, 10 ** 6)
PLAIN_Q = [Fraction(2) ** k for k in range(-8, 4)]      # 1/256 … 8 quarters

# metrics with a prediction value and a .delta against the reference
PAIRED = ("nq.tuplet.group_complete", "nq.tuplet.one_note_rate", "nq.shape.tm_missing", "nq.tie.mergeable_rate",
          "nq.rhythm.hidden_beat_rate", "nq.beam.coverage", "nq.beam.boundary_ok", "nq.acc.redundant_rate",
          "nq.spell.context_odd", "nq.spell.mixed_bar_rate", "nq.range.ledger4_rate")
# the reason split (prediction only): metric id -> notation_reasons key
REASONS = {"nq.shape.tm_missing.r17": "tm.r17", "nq.shape.tm_missing.unexpected": "tm.unexpected",
           "nq.tuplet.one_note.r17": "one.r17", "nq.tuplet.one_note.unexpected": "one.unexpected",
           "nq.tie.mergeable.defect": "tie.MERGEABLE_DEFECT", "nq.tie.mergeable.required_h6": "tie.REQUIRED_H6",
           "nq.tie.mergeable.required_h7": "tie.REQUIRED_H7",
           "nq.tie.mergeable.required_beat_split": "tie.REQUIRED_BEAT_SPLIT",
           "nq.tie.mergeable.partial_chord": "tie.PARTIAL_CHORD_REQUIRED", "nq.tie.mergeable.cross_voice": "tie.CROSS_VOICE",
           "nq.tie.mergeable.r17": "tie.R17_DEFER_G3B"}
IDS = PAIRED + ("nq.rest.per_measure_delta", "nq.rhythm.short_rate_delta", "nq.voice.poly_recall", "nq.ned") + tuple(REASONS)


def _rate(num: int, den: int, scale: float = 1.0) -> Optional[float]:
    return num * scale / den if den else None


def _offsets(nt: Dict[str, Any]) -> List[Fraction]:
    """Per bar of part 0: how far its positions sit from a full bar's start (a short first bar is a pickup)."""
    out = []
    for i, m in enumerate(nt["measures"]):
        out.append(m["nominal"] - m["len"] if i == 0 and m["len"] < m["nominal"] else Fraction(0))
    return out


# ----------------------------------------------------------------- rhythm
def hides_beat(time: Tuple[int, int], x: Fraction, dur: Fraction, type_: Optional[str], dots: int) -> bool:
    """Does a symbol at x (quarters from a full bar's start) lasting dur hide a beat outside the S table?"""
    beats, bt = time
    end = x + dur
    if NR.is_compound(time):
        beat = NR.beat_len(time)
        nominal = Fraction(beats * 4, bt)
        crossings = [k * beat for k in range(1, int(nominal / beat) + 1) if x < k * beat < end]
        if not crossings:
            return False
        group = nominal / 2 if beats == 12 else nominal
        on_beat = (x / beat).denominator == 1
        group_end = (int(x / group) + 1) * group
        return not (on_beat and end == group_end)
    beat = Fraction(4, bt)
    nominal = Fraction(beats * 4, bt)
    crossings = [k * beat for k in range(1, int(nominal / beat) + 1) if x < k * beat < end]
    if not crossings:
        return False
    on_beat = (x / beat).denominator == 1
    middle = time == (4, 4) and x < 2 < end
    if on_beat and not middle:
        return False
    plain = lambda t, d: type_ == t and dots == d   # noqa: E731
    if bt == 4 and beats in (2, 4) and not on_beat and plain("quarter", 0) and (x / (beat / 2)).denominator == 1 \
            and not middle:
        return False                                              # 8 4 8
    if time == (4, 4) and on_beat:
        if plain("half", 0) and x in (0, 1, 2):
            return False                                          # 4 2 4, 2 + 2
        if plain("half", 1) and x in (0, 1):
            return False                                          # 2. 4, 4 2.
        if plain("whole", 0) and x == 0:
            return False
    if time == (2, 2) and plain("half", 0) and x == 1:
        return False                                              # 4 2 4 in 2/2
    return True


def beam_groups(time: Tuple[int, int]) -> List[Fraction]:
    """Primary beam group starts in quarters of a full bar (G03 §11.2)."""
    beats, bt = time
    nominal = Fraction(beats * 4, bt)
    if NR.is_compound(time):
        step = nominal if beats == 3 else NR.beat_len(time)
    elif bt >= 8 and beats in (5, 7):
        lens = [2, 3] if beats == 5 else [2, 2, 3]
        out, at = [], Fraction(0)
        for n in lens:
            out.append(at)
            at += Fraction(n * 4, bt)
        return out
    elif bt == 2:
        step = Fraction(1)
    else:
        step = Fraction(4, bt) if bt <= 4 else Fraction(1)
    out, at = [], Fraction(0)
    while at < nominal:
        out.append(at)
        at += step
    return out


def _group_of(time, x: Fraction) -> int:
    starts = beam_groups(time)
    i = 0
    while i + 1 < len(starts) and starts[i + 1] <= x:
        i += 1
    return i


# ----------------------------------------------------------------- one file
def file_stats(canon) -> Optional[Dict[str, Any]]:
    """Everything nq.* needs from one score, or None when reader/5's layer is missing."""
    nt = getattr(canon, "notation", None)
    if nt is None:
        return None
    elems, events, measures = nt["elems"], nt["events"], nt["measures"]
    offs = _offsets(nt)
    upper, lower = nt["piano"]
    out: Dict[str, Any] = {"bars": len(measures)}
    out["elements"] = len(elems)
    out["short"] = sum(1 for e in elems if e["type"] in NR.SHORT_TYPES)
    firsts = [ev["first"] for ev in events]
    out["rests"] = sum(1 for e in firsts if e["rest"])
    out["tm_missing"] = sum(1 for e in firsts if not e["tm"] and e["dur"] > 0 and not NR.dyadic(e["dur"]))

    # brackets
    br = nt["brackets"]
    out["brackets"] = len(br)
    out["bracket_one"] = sum(1 for b in br if len(b["events"]) == 1)
    complete = 0
    for b in br:
        if not b["ratio"]:
            continue
        actual = b["ratio"][0]
        total = Fraction(0)
        ok = True
        for i in b["events"]:
            e = events[i - 1]["first"]
            v = NR.printed_q(e["type"], e["dots"])
            if v is None:
                ok = False
                break
            total += v
        if not ok:
            continue
        unit = NR.printed_q(b["normal_type"], 0) if b["normal_type"] else None
        if unit is not None:
            complete += 1 if total == actual * unit else 0
        elif any(total == actual * u for u in PLAIN_Q):
            complete += 1
    out["bracket_complete"] = complete

    # ties (the audit's rule)
    pitched = [e for e in elems if e["pitch"] is not None and e["pitch"][0] in NR.STEP_IDX]
    out["notes"] = len(pitched)
    out["ties"] = sum(1 for e in pitched if e["tie_start"])
    merge = 0
    for ch in NR.tie_chains(pitched):
        for prev, nxt in zip(ch["notes"], ch["notes"][1:]):
            if prev["m"] != nxt["m"]:
                continue
            beat = NR.beat_len(prev["time"])
            end = nxt["at"] + nxt["dur"]
            if int(prev["at"] / beat) == int((end - EPS) / beat) and NR.single_symbol(end - prev["at"]):
                merge += 1
    out["tie_merge"] = merge

    # hidden beats (pitched events)
    hid = pe = 0
    for e in firsts:
        if e["rest"] or e["pitch"] is None or e["dur"] <= 0:
            continue
        pe += 1
        off = offs[e["m"]] if e["m"] < len(offs) else Fraction(0)
        if hides_beat(e["time"], e["at"] + off, e["dur"], e["type"], e["dots"]):
            hid += 1
    out["pitched_events"], out["hidden"] = pe, hid

    # beams
    beam_of: Dict[int, int] = {}
    for bi, b in enumerate(nt["beams"]):
        for i in b["events"]:
            beam_of[i] = bi
    groups: Dict[Tuple, List[int]] = {}
    for i, ev in enumerate(events, start=1):
        e = ev["first"]
        v = NR.printed_q(e["type"], 0)
        if e["rest"] or v is None or v > Fraction(1, 2):
            continue
        off = offs[e["m"]] if e["m"] < len(offs) else Fraction(0)
        groups.setdefault((e["part"], e["voice"], e["m"], _group_of(e["time"], e["at"] + off)), []).append(i)
    beamable = [i for g in groups.values() if len(g) >= 2 for i in g]
    out["beamable"] = len(beamable)
    out["beamed_beamable"] = sum(1 for i in beamable if i in beam_of)
    out["beams"] = len(nt["beams"])
    ok = 0
    for b in nt["beams"]:
        keys = set()
        for i in b["events"]:
            e = events[i - 1]["first"]
            off = offs[e["m"]] if e["m"] < len(offs) else Fraction(0)
            keys.add((e["m"], _group_of(e["time"], e["at"] + off)))
        ok += 1 if len(keys) == 1 else 0
    out["beam_ok"] = ok

    # accidentals, spelling, range
    out["redundant"] = _redundant_accidentals(pitched, nt)
    out["odd_spell"] = sum(1 for e in pitched if (e["pitch"][0], e["pitch"][1]) in (("E", 1), ("B", 1), ("C", -1), ("F", -1))
                           and NR.key_alter(e["fifths"], e["pitch"][0]) != e["pitch"][1])
    staff_acc: Dict[Tuple, set] = {}
    staff_bars = set()
    for e in firsts:
        staff_bars.add((e["part"], e["staff"], e["m"]))
    for e in pitched:
        if e["acc"]:
            kind = "s" if e["acc"] in NR.SHARP_ACC else "f" if e["acc"] in NR.FLAT_ACC else None
            if kind:
                staff_acc.setdefault((e["part"], e["staff"], e["m"]), set()).add(kind)
    out["staff_bars"] = len(staff_bars)
    out["mixed"] = sum(1 for s in staff_acc.values() if len(s) == 2)
    out["ledger4"] = sum(1 for e in pitched if NR.ledger_lines(e["pitch"][0], e["pitch"][2], e["clef"]) >= 4)

    # voices and symbols per (bar, piano staff)
    voices: Dict[Tuple[int, str], set] = {}
    symbols: Dict[Tuple[int, str], List[Tuple]] = {}
    in_bracket = {i for b in br for i in b["events"]}
    for i, ev in enumerate(events, start=1):
        e = ev["first"]
        hand = "r" if e["gstaff"] == upper else "l" if e["gstaff"] == lower else ("r" if upper is None and e["gstaff"] == 1 else None)
        if hand is None:
            continue
        voices.setdefault((e["m"], hand), set()).add(e["voice"])
        tie = any(x["tie_start"] for x in ev["elems"])
        symbols.setdefault((e["m"], hand), []).append((e["voice"], e["at"], i,
                                                       ("r" if e["rest"] else "n", e["type"], e["dots"], tie, i in in_bracket)))
    out["poly_bars"] = {k for k, v in voices.items() if len(v) >= 2}
    out["symbols"] = {k: [s[3] for s in sorted(v, key=lambda s: (_voice_key(s[0]), s[1], s[2]))] for k, v in symbols.items()}
    out["reasons"] = RS.reasons(nt)
    return out


def _voice_key(v: str):
    try:
        return (0, int(v), v)
    except ValueError:
        return (1, 0, v)


def _redundant_accidentals(pitched: List[Dict[str, Any]], nt: Dict[str, Any]) -> int:
    """Printed accidentals that neither the key signature and the bar's state require nor a courtesy rule
    (G03 §10.3: (a) a step altered in the bar before, first time in this bar; (b) a step the key signature
    of this bar changed; (c) a step tied over the bar line, again in that bar) allows."""
    by_staff: Dict[int, List[Dict[str, Any]]] = {}
    for e in pitched:
        by_staff.setdefault(e["gstaff"], []).append(e)
    redundant = 0
    for notes in by_staff.values():
        notes.sort(key=lambda e: (e["m"], e["at"]))
        prev_bar_alters: Dict[Tuple[str, int], int] = {}
        state: Dict[Tuple[str, int], int] = {}
        courtesy: set = set()
        prev_fifths: Optional[int] = None
        bar = -1
        fifths = 0
        for e in notes:
            if e["m"] != bar:
                prev_bar_alters = dict(state) if bar >= 0 else {}
                state = {}
                courtesy = set()
                prev_fifths = fifths if bar >= 0 else None
                bar = e["m"]
                fifths = e["fifths"]
                seen_this_bar: set = set()
            step, alter, octave = e["pitch"]
            key = (step, octave)
            key_alt = NR.key_alter(e["fifths"], step)
            cur = state.get(key, key_alt)
            if e["tie_stop"]:
                cross = e["at"] == 0
                if cross:
                    courtesy.add(key)
                if e["acc"] and not cross:
                    redundant += 1
                continue
            needed = alter != cur
            if e["acc"] and not needed:
                ok = False
                if key not in seen_this_bar and key in prev_bar_alters and prev_bar_alters[key] != key_alt:
                    ok = True                                                     # (a)
                if prev_fifths is not None and prev_fifths != e["fifths"] and \
                        NR.key_alter(prev_fifths, step) != key_alt and key not in seen_this_bar:
                    ok = True                                                     # (b)
                if key in courtesy:
                    ok = True                                                     # (c)
                if not ok:
                    redundant += 1
            state[key] = alter
            seen_this_bar.add(key)
    return redundant


# ----------------------------------------------------------------- the metrics
def values(st: Dict[str, Any]) -> Dict[str, Optional[float]]:
    """The one-file values (prediction or reference alike)."""
    return {
        "nq.tuplet.group_complete": _rate(st["bracket_complete"], st["brackets"]),
        "nq.tuplet.one_note_rate": _rate(st["bracket_one"], st["brackets"]),
        "nq.shape.tm_missing": float(st["tm_missing"]),
        "nq.tie.mergeable_rate": _rate(st["tie_merge"], st["ties"]),
        "nq.rhythm.hidden_beat_rate": _rate(st["hidden"], st["pitched_events"]),
        "nq.beam.coverage": _rate(st["beamed_beamable"], st["beamable"]),
        "nq.beam.boundary_ok": _rate(st["beam_ok"], st["beams"]),
        "nq.acc.redundant_rate": _rate(st["redundant"], st["notes"]),
        "nq.spell.context_odd": _rate(st["odd_spell"], st["notes"], 1000.0),
        "nq.spell.mixed_bar_rate": _rate(st["mixed"], st["staff_bars"]),
        "nq.range.ledger4_rate": _rate(st["ledger4"], st["notes"], 1000.0),
        **{k: float(st["reasons"][r]) for k, r in REASONS.items()},
    }


def levenshtein(a: List[Any], b: List[Any]) -> int:
    prev = list(range(len(b) + 1))
    for i, x in enumerate(a, start=1):
        cur = [i] + [0] * len(b)
        for j, y in enumerate(b, start=1):
            cur[j] = min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (0 if x == y else 1))
        prev = cur
    return prev[-1]


def bar_offset(ref, pred, pairs) -> int:
    """The bar shift most matched notes agree on (notation.py's rule), 0 without pairs."""
    if not pairs:
        return 0
    rb = {s.id: s for s in ref.played()}
    pb = {s.id: s for s in pred.played()}
    offs = Counter(pb[x[1]].measure - rb[x[0]].measure for x in pairs if x[0] in rb and x[1] in pb)
    if not offs:
        return 0
    top = max(offs.values())
    return sorted((v for v, c in offs.items() if c == top), key=lambda v: (abs(v), v))[0]


def compare(pst: Dict[str, Any], rst: Dict[str, Any], offset: int) -> Dict[str, Optional[float]]:
    out: Dict[str, Optional[float]] = {}
    pv, rv = values(pst), values(rst)
    for k in PAIRED:
        out[k] = pv[k]
        out[k + ".delta"] = (pv[k] - rv[k]) if pv[k] is not None and rv[k] is not None else None
    rp, pp = _rate(rst["rests"], rst["bars"]), _rate(pst["rests"], pst["bars"])
    out["nq.rest.per_measure_delta"] = (pp - rp) if rp is not None and pp is not None else None
    rs, ps = _rate(rst["short"], rst["elements"]), _rate(pst["short"], pst["elements"])
    out["nq.rhythm.short_rate_delta"] = (ps - rs) if rs is not None and ps is not None else None
    poly = rst["poly_bars"]
    out["nq.voice.poly_recall"] = (sum(1 for (m, h) in poly if (m + offset, h) in pst["poly_bars"]) / len(poly)
                                   if poly else None)
    total = dist = 0
    for (m, h), seq in rst["symbols"].items():
        total += len(seq)
        dist += levenshtein(pst["symbols"].get((m + offset, h), []), seq)
    out["nq.ned"] = dist / total if total else None
    for k in REASONS:
        out[k] = pv[k]
    return out


def compute(ctx) -> Dict[str, Optional[float]]:
    pst = file_stats(ctx["pred"])
    rst = ctx.get("ref_nq") or file_stats(ctx["ref"])
    if pst is None or rst is None:
        return {k: None for k in IDS}
    return compare(pst, rst, bar_offset(ctx["ref"], ctx["pred"], ctx.get("pairs") or []))
