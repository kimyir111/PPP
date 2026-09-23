#!/usr/bin/env python3
"""Notation audit: file-level notation statistics of PPP's predictions against the references
(docs/GOALS/G03 §2.3 and Appendix A-2; G3 Step 0).

    python tests/bench/tools/notation_audit.py [--out-dir tests/bench/out/core] [--json out.json]

Inputs: the prediction MusicXML files a ``run.py run`` wrote (``<out-dir>/cases/<hash>.musicxml``,
``<out-dir>/index.json`` maps the hash to the case key ``ref|performer|cues|seed``; the *profile* is
``performer|cues``) and the distinct references those cases name (``tests/bench/corpus/references.json``).
Nothing is matched note to note: every number is a property of one file, then aggregated.

The G0 reader (``pppbench.musicxml``) does not read tuplet brackets, beams, slurs, dynamics or
articulations, so this script parses MusicXML itself (ElementTree, stdlib only). References are read
as the files state them: no octave-shift is applied to pitches, and ledger lines are counted from the
written ``<pitch>`` (an 8va passage in a reference therefore counts its ledger lines as if unshifted).

Units and conventions
---------------------
* **note element**: a ``<note>`` that is not ``<grace>`` (each chord tone and each rest is one).
  **event**: a note element without ``<chord/>`` (a chord is one event; a rest is an event).
  **pitched note**: a note element with ``<pitch>`` (``<unpitched>`` notes are skipped).
* **bar**: a ``<measure>`` of the first part. Positions are in quarters from the start of the measure.
* **beat**: the quarter in x/4, the half in x/2, the eighth in simple x/8, the dotted quarter in
  compound metre (beat-type >= 8 and beats divisible by 3, as G0 ``metre_class``).
* **staff-bar**: a (part, staff, measure) with at least one event. **voice-bar**: a (part, voice,
  measure) with at least one event.
* **tie**: a ``<tie type="start">`` on a pitched note. A ``<tie type="stop">`` joins the most recent open
  tie of the same sounding MIDI number on the same staff (the stop need not start where the tied note
  ended). This is the rule that reproduces Appendix A's 42 unmatched starts; the app's stricter rule
  (G0 reader R14 ``merge_ties``: the stop must start exactly where the tied note ends) is reported as
  ``tie_unmatched_app`` (57 in core: 15 more reference stops sit in another voice or after a gap).
* Rates are **pooled** over the files of a column (sum of numerators / sum of denominators);
  ``/ file`` and ``/ 1000 notes`` likewise pool; rows marked Σ are sums. The REF column counts each
  distinct reference once (141 in core), not once per case.

Metrics (key: definition)
-------------------------
files                   number of files
events_per_bar          events / bars
rests_per_bar           rest events / bars
short_share             note elements whose <type> is 32nd or shorter / note elements
ties_per_note           ties / pitched notes
tie_same_beat           ties whose joined span (start of the tied note to the end of the note it joins)
                        lies inside one beat of one bar AND is one plain note value with at most two
                        dots: a tie one symbol could replace (G03 §20.3 nq.tie.mergeable_rate)
tie_chain3              middle pieces (a pitched note with both a tie stop and a tie start: each one is
                        an extra piece of a chain of three or more) / ties
tie_unmatched           Σ ties with no stop to join (rule above)
tie_unmatched_app       Σ the same by the app's rule
tm_share                note elements with <time-modification> (actual != normal) / note elements
bracket_per_tm          <tuplet type="start"> / note elements with time-modification (about 1/3 when a
                        bracket covers three notes)
bracket_one_note        brackets whose start and stop are on the same event / brackets
tm_missing              Σ events whose length in quarters is not a dyadic fraction (denominator not a
                        power of two: a triplet length) and that have no time-modification
tm_missing_rests        Σ of those that are rests
voices_per_staff_bar    Σ (distinct voices with an event in the staff-bar) / staff-bars
poly_staff_bar          staff-bars with two or more voices / staff-bars
offbeat_cross           pitched events that start off a beat and end after the next beat / events
double_acc_per_k        pitched notes with |alter| = 2, per 1000 pitched notes
odd_spell_per_k         pitched notes spelled E#, B#, Cb or Fb where the key signature in force does
                        not contain that alteration, per 1000 pitched notes (a legitimate leading
                        note such as E# in F# minor counts too)
mixed_acc_staff_bar     staff-bars printing both a sharp-type (sharp, double-sharp, sharp-sharp) and a
                        flat-type (flat, flat-flat) <accidental> / staff-bars
printed_acc_per_note    pitched notes with an <accidental> / pitched notes
ledger4_per_k           pitched notes 4 or more ledger lines from their staff (clef in force: treble,
                        bass, alto, tenor), per 1000 pitched notes
ledger5_per_k           the same, 5 or more
rh_low_per_k            pitched notes on the piano part's upper staff below F3 (MIDI 53), per 1000
lh_high_per_k           pitched notes on the piano part's lower staff above G4 (MIDI 67), per 1000
octave_per_file         <octave-shift type="up|down"> / files
pedal_per_file          pedal presses (<pedal type="start|change">) / files
dynamics_per_file       <dynamics> elements / files
wedge_per_file          <wedge type="crescendo|diminuendo"> / files
slur_per_file           <slur type="start"> on note elements / files (grace notes' slurs not counted)
artic_per_file          children of <articulations> on note elements / files (every MusicXML
                        articulation, strong-accent included)
beamed_share            pitched notes with a <beam> / pitched notes
stem_share              pitched notes with a <stem> / pitched notes
voice_bar_short         inner voice-bars (not the first or last bar) whose events' lengths add up to
                        less than the bar / inner voice-bars
voice_bar_over          the same, more than the bar / inner voice-bars

The meter breakdown repeats rests_per_bar, short_share and tie_same_beat over the simple and compound
files (metre of the reference's first bar) of REF, human|oracle and deadpan|none.

Reproduction of Appendix A-2 (core outputs of cc509e2; the SUT is unchanged at 209f166)
------------------------------------------------------------------------------------------
Every cell of A-2 is reproduced to its printed precision, except:
* tie_chain3 REF: 0.031 here (4 middle pieces / 130 ties) against 0.023 (3 / 130) in A-2. Every
  prediction column matches exactly. Not resolved: a one-note difference in the references.
* artic_per_file REF: 18.397 against 18.284. A-2 left out <strong-accent> (16 in the references;
  the schema's marcato). Kept here: it is a printed articulation.
* voice_bar_short REF: 0.007 against 0.006 (A-2 does not record its definition; "the voice's last
  event ends before the bar" gives 0.004). Predictions are 0 either way.
* A-2's 11.30 / 8.97 / 6.84 (rubato ledger >= 4, pedal ledger >= 5, rubato LH above G4) are 11.2945,
  8.9645 and 6.8346 rounded twice (to three places, then two); the counts are the same. So is §2.3's
  REF simple 32nd share 0.020 (0.01949 here).
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import xml.etree.ElementTree as ET
from fractions import Fraction
from typing import Any, Dict, List, Optional, Tuple

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

from pppbench import musicxml, util  # noqa: E402

STEP_IDX = {"C": 0, "D": 1, "E": 2, "F": 3, "G": 4, "A": 5, "B": 6}
STEP_SEMI = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
SHORT_TYPES = {"32nd", "64th", "128th", "256th", "512th", "1024th"}
SHARP_ACC = {"sharp", "double-sharp", "sharp-sharp"}
FLAT_ACC = {"flat", "flat-flat"}
SHARP_ORDER = ["F", "C", "G", "D", "A", "E", "B"]
# (top line, bottom line) as diatonic index oct*7 + step
CLEF_LINES = {("G", 2): (38, 30), ("F", 4): (26, 18), ("C", 3): (32, 24), ("C", 4): (30, 22)}

# Every metric: key, label, (numerator, denominator or "" for a sum, scale).
METRICS: List[Tuple[str, str, Tuple[str, str, float]]] = [
    ("files", "files", ("files", "", 1)),
    ("events_per_bar", "event (chord = 1) / bar", ("events", "bars", 1)),
    ("rests_per_bar", "rests / bar", ("rests", "bars", 1)),
    ("short_share", "32nd-or-shorter share", ("short", "elements", 1)),
    ("ties_per_note", "ties / note", ("ties", "notes", 1)),
    ("tie_same_beat", "ties one symbol could replace (inside one beat) / tie", ("tie_same_beat", "ties", 1)),
    ("tie_chain3", "3+-piece chain middle pieces / tie", ("chain3", "ties", 1)),
    ("tie_unmatched", "unmatched tie starts (Σ)", ("tie_unmatched", "", 1)),
    ("tie_unmatched_app", "  by the app's tie rule (Σ)", ("tie_unmatched_app", "", 1)),
    ("tm_share", "time-mod notes / note element", ("tm", "elements", 1)),
    ("bracket_per_tm", "bracket starts / time-mod note", ("brackets", "tm", 1)),
    ("bracket_one_note", "one-note brackets / bracket", ("bracket_one", "brackets", 1)),
    ("tm_missing", "non-binary events without time-mod (Σ)", ("tm_missing", "", 1)),
    ("tm_missing_rests", "  of those rests (Σ)", ("tm_missing_rests", "", 1)),
    ("voices_per_staff_bar", "voices / staff-bar", ("voice_sum", "staff_bars", 1)),
    ("poly_staff_bar", "2+-voice staff-bars", ("poly", "staff_bars", 1)),
    ("offbeat_cross", "off-beat notes crossing the next beat / event", ("offbeat", "events", 1)),
    ("double_acc_per_k", "double accidentals / 1000 notes", ("double_acc", "notes", 1000)),
    ("odd_spell_per_k", "key-unrelated E#/B#/Cb/Fb / 1000 notes", ("odd_spell", "notes", 1000)),
    ("mixed_acc_staff_bar", "#/b mixed staff-bars", ("mixed_acc", "staff_bars", 1)),
    ("printed_acc_per_note", "printed accidentals / note", ("printed_acc", "notes", 1)),
    ("ledger4_per_k", "ledger >= 4 / 1000", ("ledger4", "notes", 1000)),
    ("ledger5_per_k", "ledger >= 5 / 1000", ("ledger5", "notes", 1000)),
    ("rh_low_per_k", "RH staff below F3 / 1000", ("rh_low", "notes", 1000)),
    ("lh_high_per_k", "LH staff above G4 / 1000", ("lh_high", "notes", 1000)),
    ("octave_per_file", "octave shifts / file", ("octave", "files", 1)),
    ("pedal_per_file", "pedal presses / file", ("pedal", "files", 1)),
    ("dynamics_per_file", "dynamics / file", ("dynamics", "files", 1)),
    ("wedge_per_file", "wedges / file", ("wedge", "files", 1)),
    ("slur_per_file", "slurs / file", ("slur", "files", 1)),
    ("artic_per_file", "articulations / file", ("artic", "files", 1)),
    ("beamed_share", "beamed note share", ("beamed", "notes", 1)),
    ("stem_share", "stem element share", ("stem", "notes", 1)),
    ("voice_bar_short", "short inner voice-bars", ("vb_short", "inner_vb", 1)),
    ("voice_bar_over", "overfull inner voice-bars", ("vb_over", "inner_vb", 1)),
]
BREAKDOWN = ["rests_per_bar", "short_share", "tie_same_beat"]


# ----------------------------------------------------------------- parsing
def _i(text: Optional[str], default: int) -> int:
    v = musicxml.js_int(text)
    return default if v is None else v


def _txt(el: Optional[ET.Element], name: str) -> Optional[str]:
    if el is None:
        return None
    x = el.find(name)
    return x.text.strip() if x is not None and x.text is not None else None


def beat_len(time: Tuple[int, int]) -> Fraction:
    beats, beat_type = time
    if beat_type >= 8 and beats % 3 == 0:
        return Fraction(3 * 4, beat_type)   # dotted quarter (in 6/8)
    return Fraction(4, beat_type)


def is_compound(time: Tuple[int, int]) -> bool:
    return time[1] >= 8 and time[0] % 3 == 0


def key_alter(fifths: int, step: str) -> int:
    if fifths > 0 and step in SHARP_ORDER[:fifths]:
        return 1
    if fifths < 0 and step in SHARP_ORDER[::-1][:-fifths]:
        return -1
    return 0


def ledger_lines(step: str, octave: int, clef: Tuple[str, int]) -> int:
    top, bottom = CLEF_LINES.get(clef, CLEF_LINES[("G", 2)])
    d = octave * 7 + STEP_IDX[step]
    if d >= top + 2:
        return (d - top) // 2
    if d <= bottom - 2:
        return (bottom - d) // 2
    return 0


def parse(data: bytes) -> Dict[str, Any]:
    """One MusicXML file -> {measures, events, notes, counts}."""
    root = ET.fromstring(data)
    musicxml._strip_ns(root)
    parts = [c for c in root if c.tag == "part"]
    counts = {k: 0 for k in ("octave", "pedal", "dynamics", "wedge", "slur", "artic")}
    for el in root.iter("octave-shift"):
        if el.attrib.get("type") in ("up", "down"):
            counts["octave"] += 1
    for el in root.iter("pedal"):
        if el.attrib.get("type") in ("start", "change"):
            counts["pedal"] += 1
    counts["dynamics"] = sum(1 for _ in root.iter("dynamics"))
    for el in root.iter("wedge"):
        if el.attrib.get("type") in ("crescendo", "diminuendo"):
            counts["wedge"] += 1
    for note in root.iter("note"):
        if note.find("grace") is not None:
            continue
        for el in note.iter("slur"):
            if el.attrib.get("type") == "start":
                counts["slur"] += 1
        for el in note.iter("articulations"):
            counts["artic"] += len(list(el))

    measures: List[Dict[str, Any]] = []        # bars of part 0
    elems: List[Dict[str, Any]] = []           # every non-grace note element
    staff_base = 0
    piano_upper = piano_lower = None
    for p_idx, part in enumerate(parts):
        divisions = Fraction(1)
        time = (4, 4)
        fifths = 0
        staves = 1
        clefs: Dict[int, Tuple[str, int]] = {}
        start = Fraction(0)
        for m_idx, m_el in enumerate(c for c in part if c.tag == "measure"):
            cursor = Fraction(0)
            max_cursor = Fraction(0)
            last_onset = Fraction(0)
            for el in m_el:
                tag = el.tag
                if tag == "attributes":
                    d = musicxml.js_float(_txt(el, "divisions"))
                    if d and d > 0:
                        divisions = d
                    t = el.find("time")
                    if t is not None:
                        b, bt = _i(_txt(t, "beats"), 4), _i(_txt(t, "beat-type"), 4)
                        if b > 0 and bt > 0:
                            time = (b, bt)
                    k = el.find("key")
                    if k is not None:
                        fifths = _i(_txt(k, "fifths"), 0)
                    st = _i(_txt(el, "staves"), 0)
                    if st > 0:
                        staves = st
                    for cl in el.findall("clef"):
                        clefs[_i(cl.attrib.get("number"), 1)] = (_txt(cl, "sign") or "G", _i(_txt(cl, "line"), 2))
                    continue
                if tag == "backup":
                    cursor = max(Fraction(0), cursor - (musicxml.js_float(_txt(el, "duration")) or 0) / divisions)
                    continue
                if tag == "forward":
                    cursor += (musicxml.js_float(_txt(el, "duration")) or 0) / divisions
                    max_cursor = max(max_cursor, cursor)
                    continue
                if tag != "note" or el.find("grace") is not None:
                    continue
                chord = el.find("chord") is not None
                dur = (musicxml.js_float(_txt(el, "duration")) or Fraction(0)) / divisions
                onset = last_onset if chord else cursor
                staff = _i(_txt(el, "staff"), 1)
                pit = el.find("pitch")
                pitch = None
                if pit is not None:
                    pitch = (_txt(pit, "step") or "C", _i(_txt(pit, "alter"), 0), _i(_txt(pit, "octave"), 4))
                tm = el.find("time-modification")
                has_tm = False
                if tm is not None:
                    a, n = _i(_txt(tm, "actual-notes"), 0), _i(_txt(tm, "normal-notes"), 0)
                    has_tm = a > 0 and n > 0 and a != n
                notations = el.findall("notations")
                tup = [t.attrib.get("type") for nt in notations for t in nt.findall("tuplet")]
                ties = [t.attrib.get("type") for t in el.findall("tie")]
                acc = _txt(el, "accidental")
                elems.append({
                    "part": p_idx, "m": m_idx, "abs": start + onset, "at": onset, "dur": dur,
                    "staff": staff, "gstaff": staff_base + staff, "voice": _txt(el, "voice") or "1",
                    "chord": chord, "rest": el.find("rest") is not None, "pitch": pitch,
                    "type": _txt(el, "type"), "tm": has_tm, "tup_start": tup.count("start"),
                    "tup_stop": tup.count("stop"), "tie_start": "start" in ties, "tie_stop": "stop" in ties,
                    "beam": el.find("beam") is not None, "stem": el.find("stem") is not None, "acc": acc,
                    "time": time, "fifths": fifths, "clef": clefs.get(staff, ("G", 2) if staff == 1 else ("F", 4)),
                })
                if not chord:
                    last_onset = cursor
                    cursor += dur
                max_cursor = max(max_cursor, cursor)
            nominal = Fraction(time[0] * 4, time[1])
            implicit = m_el.attrib.get("implicit") == "yes"
            length = max_cursor if implicit and max_cursor > 0 else max(nominal, max_cursor)
            if p_idx == 0:
                measures.append({"time": time, "len": length, "nominal": nominal})
            start += length
        if staves >= 2 and piano_upper is None:
            piano_upper, piano_lower = staff_base + 1, staff_base + 2
        staff_base += max(staves, 1)
    return {"measures": measures, "elems": elems, "counts": counts,
            "piano": (piano_upper, piano_lower), "time": measures[0]["time"] if measures else (4, 4)}


# ----------------------------------------------------------------- counting
def _dyadic(x: Fraction) -> bool:
    d = x.denominator
    return d & (d - 1) == 0


def single_symbol(length: Fraction) -> bool:
    """Is a length in quarters one plain note value with at most two dots?"""
    for k in range(-8, 5):
        base = Fraction(2) ** k
        if length in (base, base * Fraction(3, 2), base * Fraction(7, 4)):
            return True
    return False


def _midi(pitch: Tuple[str, int, int]) -> int:
    step, alter, octave = pitch
    return (octave + 1) * 12 + STEP_SEMI[step] + alter


def tie_chains(pitched: List[Dict[str, Any]], app_rule: bool = False) -> List[Dict[str, Any]]:
    """Pitched notes -> chains, in (onset, staff) order. See the module docstring for the two rules."""
    chains: List[Dict[str, Any]] = []
    for e in sorted(pitched, key=lambda e: (e["abs"], e["gstaff"])):
        midi = _midi(e["pitch"])
        target = None
        if e["tie_stop"]:
            if app_rule:
                adj = [ch for ch in chains if ch["open"] and ch["midi"] == midi and ch["end"] == e["abs"]]
                adj = [ch for ch in adj if ch["staff"] == e["gstaff"]] or adj
            else:
                adj = [ch for ch in chains if ch["open"] and ch["midi"] == midi and ch["staff"] == e["gstaff"]]
            target = adj[-1] if adj else None
        if target is None:
            target = {"midi": midi, "staff": e["gstaff"], "notes": [], "end": e["abs"], "open": False}
            chains.append(target)
        target["notes"].append(e)
        target["end"] = e["abs"] + e["dur"]
        target["open"] = e["tie_start"]
    return chains


def count(data: bytes) -> Dict[str, int]:
    """The numerators and denominators of every metric for one file."""
    f = parse(data)
    elems, measures = f["elems"], f["measures"]
    c: Dict[str, int] = {k: 0 for k in (
        "events", "rests", "elements", "short", "notes", "ties", "tie_same_beat", "chain3", "tie_unmatched",
        "tie_unmatched_app", "tm", "brackets", "bracket_one", "tm_missing", "tm_missing_rests", "voice_sum",
        "staff_bars", "poly", "offbeat", "double_acc", "odd_spell", "mixed_acc", "printed_acc", "ledger4",
        "ledger5", "rh_low", "lh_high", "beamed", "stem", "vb_short", "vb_over", "inner_vb")}
    c.update(f["counts"])
    c["files"] = 1
    c["bars"] = len(measures)
    c["compound"] = 1 if is_compound(f["time"]) else 0

    ev_index = 0
    for e in elems:
        if not e["chord"]:
            ev_index += 1
        e["ev"] = ev_index
    # note elements
    for e in elems:
        c["elements"] += 1
        if e["type"] in SHORT_TYPES:
            c["short"] += 1
        if e["tm"]:
            c["tm"] += 1
    # events
    staff_bars: Dict[Tuple[int, int, int], set] = {}
    voice_bars: Dict[Tuple[int, str, int], Fraction] = {}
    for e in elems:
        if e["chord"]:
            continue
        c["events"] += 1
        if e["rest"]:
            c["rests"] += 1
        if not e["tm"] and e["dur"] > 0 and not _dyadic(e["dur"]):
            c["tm_missing"] += 1
            if e["rest"]:
                c["tm_missing_rests"] += 1
        if e["pitch"] is not None:
            beat = beat_len(e["time"])
            k = e["at"] / beat
            if k.denominator != 1 and e["at"] + e["dur"] > (int(k) + 1) * beat:
                c["offbeat"] += 1
        staff_bars.setdefault((e["part"], e["staff"], e["m"]), set()).add(e["voice"])
        vk = (e["part"], e["voice"], e["m"])
        voice_bars[vk] = voice_bars.get(vk, Fraction(0)) + e["dur"]
    # brackets: a start and a stop on the same event is a one-note bracket
    open_bracket: Dict[Tuple[int, str], int] = {}
    for e in elems:
        key = (e["part"], e["voice"])
        for _ in range(e["tup_start"]):
            c["brackets"] += 1
            open_bracket[key] = e["ev"]
        for _ in range(e["tup_stop"]):
            if key in open_bracket and open_bracket.pop(key) == e["ev"]:
                c["bracket_one"] += 1
    for voices in staff_bars.values():
        c["staff_bars"] += 1
        c["voice_sum"] += len(voices)
        if len(voices) >= 2:
            c["poly"] += 1
    last_bar = len(measures) - 1
    for (_part, _voice, m), total in voice_bars.items():
        if m == 0 or m >= last_bar:
            continue
        c["inner_vb"] += 1
        if total < measures[m]["len"]:
            c["vb_short"] += 1
        elif total > measures[m]["len"]:
            c["vb_over"] += 1

    # pitched notes
    upper, lower = f["piano"]
    pitched = [e for e in elems if e["pitch"] is not None and e["pitch"][0] in STEP_IDX]
    staff_acc: Dict[Tuple[int, int, int], set] = {}
    for e in pitched:
        step, alter, octave = e["pitch"]
        c["notes"] += 1
        if e["beam"]:
            c["beamed"] += 1
        if e["stem"]:
            c["stem"] += 1
        if e["tie_start"]:
            c["ties"] += 1
            if e["tie_stop"]:
                c["chain3"] += 1
        if abs(alter) == 2:
            c["double_acc"] += 1
        if (step, alter) in (("E", 1), ("B", 1), ("C", -1), ("F", -1)) and key_alter(e["fifths"], step) != alter:
            c["odd_spell"] += 1
        if e["acc"]:
            c["printed_acc"] += 1
            kind = "s" if e["acc"] in SHARP_ACC else "f" if e["acc"] in FLAT_ACC else None
            if kind:
                staff_acc.setdefault((e["part"], e["staff"], e["m"]), set()).add(kind)
        ll = ledger_lines(step, octave, e["clef"])
        if ll >= 4:
            c["ledger4"] += 1
        if ll >= 5:
            c["ledger5"] += 1
        midi = _midi(e["pitch"])
        if upper is not None and e["gstaff"] == upper and midi < 53:
            c["rh_low"] += 1
        if lower is not None and e["gstaff"] == lower and midi > 67:
            c["lh_high"] += 1
    c["mixed_acc"] = sum(1 for s in staff_acc.values() if len(s) == 2)

    # ties
    for ch in tie_chains(pitched):
        if ch["open"]:
            c["tie_unmatched"] += 1
        for prev, nxt in zip(ch["notes"], ch["notes"][1:]):
            if prev["m"] != nxt["m"]:
                continue
            beat = beat_len(prev["time"])
            end = nxt["at"] + nxt["dur"]
            if int(prev["at"] / beat) == int((end - Fraction(1, 10 ** 6)) / beat) and single_symbol(end - prev["at"]):
                c["tie_same_beat"] += 1
    c["tie_unmatched_app"] = sum(1 for ch in tie_chains(pitched, app_rule=True) if ch["open"])
    return c


# ----------------------------------------------------------------- aggregation
def aggregate(rows: List[Dict[str, int]]) -> Dict[str, Optional[float]]:
    tot: Dict[str, int] = {}
    for r in rows:
        for k, v in r.items():
            tot[k] = tot.get(k, 0) + v
    out: Dict[str, Optional[float]] = {}
    for key, _label, (num, den, scale) in METRICS:
        if not den:
            out[key] = tot.get(num, 0)
        else:
            d = tot.get(den, 0)
            out[key] = tot.get(num, 0) * scale / d if d else None
    return out


def load_inputs(out_dir: str) -> Tuple[Dict[str, List[Tuple[str, Dict[str, int]]]], Dict[str, Dict[str, int]]]:
    """(per-profile list of (ref id, counts), per-reference counts)."""
    index = util.load_json(os.path.join(out_dir, "index.json"))
    refs = {r["id"]: r for r in util.load_json(os.path.join(util.bench_root(), "corpus", "references.json"))["references"]}
    preds: Dict[str, List[Tuple[str, Dict[str, int]]]] = {}
    ref_ids = set()
    for h in sorted(index):
        key = index[h]
        ref_id, performer, cues = key.split("|")[:3]
        path = os.path.join(out_dir, "cases", h + ".musicxml")
        if not os.path.exists(path):
            continue
        with open(path, "rb") as fh:
            preds.setdefault(performer + "|" + cues, []).append((ref_id, count(fh.read())))
        ref_ids.add(ref_id)
    ref_counts = {}
    for rid in sorted(ref_ids):
        ref_counts[rid] = count(musicxml.read_bytes(os.path.join(util.repo_root(), refs[rid]["path"])))
    return preds, ref_counts


def audit(out_dir: str) -> Dict[str, Any]:
    preds, refs = load_inputs(out_dir)
    columns: Dict[str, List[Dict[str, int]]] = {"REF": list(refs.values()),
                                                "ALL": [c for p in sorted(preds) for _, c in preds[p]]}
    for p in sorted(preds, key=lambda x: -len(preds[x])):
        columns[p] = [c for _, c in preds[p]]
    table = {col: aggregate(rows) for col, rows in columns.items()}
    breakdown: Dict[str, Dict[str, Any]] = {}
    ref_meter = {rid: "compound" if c["compound"] else "simple" for rid, c in refs.items()}
    for col, rows in (("REF", [(rid, refs[rid]) for rid in refs]),
                      ("human|oracle", preds.get("human|oracle", [])),
                      ("deadpan|none", preds.get("deadpan|none", []))):
        for meter in ("simple", "compound"):
            sub = [c for rid, c in rows if ref_meter.get(rid) == meter]
            agg = aggregate(sub)
            breakdown.setdefault(col, {})[meter] = {k: agg[k] for k in BREAKDOWN} | {"files": len(sub)}
    return {"table": table, "breakdown": breakdown}


def fmt(v: Optional[float], key: str) -> str:
    if v is None:
        return "–"
    if key in ("files", "tie_unmatched", "tie_unmatched_app", "tm_missing", "tm_missing_rests"):
        return f"{int(v):,}"
    if key.endswith("_per_k"):
        return f"{v:.2f}"
    return f"{v:.3f}"


def render(result: Dict[str, Any]) -> str:
    table = result["table"]
    cols = list(table)
    lines = ["| metric | " + " | ".join(cols) + " |", "| --- |" + " --- |" * len(cols)]
    for key, label, _ in METRICS:
        lines.append(f"| {label} | " + " | ".join(fmt(table[c][key], key) for c in cols) + " |")
    lines.append("")
    lines.append("Meter breakdown (metre of the reference's first bar)")
    lines.append("")
    lines.append("| column | metre | files | " + " | ".join(BREAKDOWN) + " |")
    lines.append("| --- | --- | --- |" + " --- |" * len(BREAKDOWN))
    for col, by in result["breakdown"].items():
        for meter, vals in by.items():
            lines.append(f"| {col} | {meter} | {vals['files']} | " + " | ".join(fmt(vals[k], k) for k in BREAKDOWN) + " |")
    return "\n".join(lines)


def main(argv: Optional[List[str]] = None) -> int:
    util.setup_stdio()
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--out-dir", default=os.path.join(util.bench_root(), "out", "core"))
    ap.add_argument("--json", default=None, help="also write the numbers as JSON here")
    args = ap.parse_args(argv)
    result = audit(args.out_dir)
    print(render(result))
    if args.json:
        with open(args.json, "w", encoding="utf-8") as fh:
            json.dump(result, fh, indent=1, sort_keys=True)
            fh.write("\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
