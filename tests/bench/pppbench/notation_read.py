"""reader/5's notation layer: what a MusicXML file prints, read element by element (docs/GOALS/G03 §20.2).

The app-parity reader (``musicxml.read_score``) keeps the G0 canonical score and every value it had at
reader/4. reader/5 only *adds* this layer, attached as ``CanonicalScore.notation`` (never serialised, never
compared): the printed note elements with their tuplet brackets and primary beams, which G0 never read
(the reason G1 F1 was invisible, G01 §25.3), and the file-level counts of marks PPP does not write.

``read_root`` is the same reading ``tests/bench/tools/notation_audit.py`` (G3 Step 0) measured Appendix
A-2 with; the tool imports it from here, so the audit and the ``nq.*`` metrics cannot drift apart.

Conventions (as the audit's docstring states them): a *note element* is a non-grace ``<note>``; an *event*
is a note element without ``<chord/>``; positions are quarters from the start of the measure; the beat is
the quarter in x/4, the half in x/2, the eighth in simple x/8 and the dotted quarter in compound metre.

Additions over the audit's parse (reader/5):
* every element: ``dots``, ``tm_ratio`` (actual, normal) or None, ``normal_type``, ``tuplets`` (the
  ``(type, number)`` of each ``<tuplet>`` start/stop), ``beam1`` (the value of ``<beam number="1">``),
  ``ev`` (the event index), ``ties`` read as before;
* ``brackets``: every printed tuplet bracket, ``{"part", "voice", "number", "ratio", "normal_type",
  "events": [event indices], "closed"}``. A bracket holds the events of its (part, voice) from the event
  that starts it to the one that stops it, both included; ``number`` pairs a start with its stop when
  brackets nest (a missing number is "1");
* ``beams``: every primary beam, ``{"part", "voice", "events": [event indices]}`` from ``begin`` to ``end``.
"""

from __future__ import annotations

import xml.etree.ElementTree as ET
from fractions import Fraction
from typing import Any, Dict, List, Optional, Tuple

from . import musicxml

STEP_IDX = {"C": 0, "D": 1, "E": 2, "F": 3, "G": 4, "A": 5, "B": 6}
STEP_SEMI = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
SHORT_TYPES = {"32nd", "64th", "128th", "256th", "512th", "1024th"}
SHARP_ACC = {"sharp", "double-sharp", "sharp-sharp"}
FLAT_ACC = {"flat", "flat-flat"}
SHARP_ORDER = ["F", "C", "G", "D", "A", "E", "B"]
# (top line, bottom line) as diatonic index oct*7 + step
CLEF_LINES = {("G", 2): (38, 30), ("F", 4): (26, 18), ("C", 3): (32, 24), ("C", 4): (30, 22)}
# a printed value in quarters
TYPE_Q = {"maxima": Fraction(32), "long": Fraction(16), "breve": Fraction(8), "whole": Fraction(4),
          "half": Fraction(2), "quarter": Fraction(1), "eighth": Fraction(1, 2), "16th": Fraction(1, 4),
          "32nd": Fraction(1, 8), "64th": Fraction(1, 16), "128th": Fraction(1, 32), "256th": Fraction(1, 64),
          "512th": Fraction(1, 128), "1024th": Fraction(1, 256)}


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


def dyadic(x: Fraction) -> bool:
    d = x.denominator
    return d & (d - 1) == 0


def single_symbol(length: Fraction) -> bool:
    """Is a length in quarters one plain note value with at most two dots?"""
    for k in range(-8, 5):
        base = Fraction(2) ** k
        if length in (base, base * Fraction(3, 2), base * Fraction(7, 4)):
            return True
    return False


def midi_of(pitch: Tuple[str, int, int]) -> int:
    step, alter, octave = pitch
    return (octave + 1) * 12 + STEP_SEMI[step] + alter


def printed_q(type_: Optional[str], dots: int) -> Optional[Fraction]:
    """The printed value of a note in quarters (type and dots, no tuplet ratio)."""
    base = TYPE_Q.get(type_ or "")
    if base is None:
        return None
    return base * (2 - Fraction(1, 2 ** dots))


def tie_chains(pitched: List[Dict[str, Any]], app_rule: bool = False) -> List[Dict[str, Any]]:
    """Pitched notes -> chains, in (onset, staff) order. A stop joins the most recent open tie of the same
    MIDI number on the same staff; app_rule: only one that ends exactly where the stop starts (G0 R14)."""
    chains: List[Dict[str, Any]] = []
    for e in sorted(pitched, key=lambda e: (e["abs"], e["gstaff"])):
        midi = midi_of(e["pitch"])
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


def read_bytes_root(data: bytes) -> ET.Element:
    root = ET.fromstring(data)
    musicxml._strip_ns(root)
    return root


def read_root(root: ET.Element) -> Dict[str, Any]:
    """One MusicXML document (namespace-stripped root) -> {measures, elems, counts, piano, time, brackets, beams}.
    Does not change the tree."""
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
                has_tm, ratio, normal_type = False, None, None
                if tm is not None:
                    a, n = _i(_txt(tm, "actual-notes"), 0), _i(_txt(tm, "normal-notes"), 0)
                    has_tm = a > 0 and n > 0 and a != n
                    if has_tm:
                        ratio = (a, n)
                        normal_type = _txt(tm, "normal-type")
                notations = el.findall("notations")
                tup_els = [t for nt in notations for t in nt.findall("tuplet")]
                tup = [t.attrib.get("type") for t in tup_els]
                ties = [t.attrib.get("type") for t in el.findall("tie")]
                acc = _txt(el, "accidental")
                beam1 = None
                for bm in el.findall("beam"):
                    if (bm.attrib.get("number") or "1") == "1" and bm.text:
                        beam1 = bm.text.strip()
                elems.append({
                    "part": p_idx, "m": m_idx, "abs": start + onset, "at": onset, "dur": dur,
                    "staff": staff, "gstaff": staff_base + staff, "voice": _txt(el, "voice") or "1",
                    "chord": chord, "rest": el.find("rest") is not None, "pitch": pitch,
                    "type": _txt(el, "type"), "tm": has_tm, "tup_start": tup.count("start"),
                    "tup_stop": tup.count("stop"), "tie_start": "start" in ties, "tie_stop": "stop" in ties,
                    "beam": el.find("beam") is not None, "stem": el.find("stem") is not None, "acc": acc,
                    "time": time, "fifths": fifths, "clef": clefs.get(staff, ("G", 2) if staff == 1 else ("F", 4)),
                    # reader/5
                    "dots": len(el.findall("dot")), "tm_ratio": ratio, "normal_type": normal_type,
                    "tuplets": [(t.attrib.get("type"), t.attrib.get("number") or "1") for t in tup_els],
                    "beam1": beam1, "measure_rest": (el.find("rest") is not None
                                                     and el.find("rest").attrib.get("measure") == "yes"),
                })
                if not chord:
                    last_onset = cursor
                    cursor += dur
                max_cursor = max(max_cursor, cursor)
            nominal = Fraction(time[0] * 4, time[1])
            implicit = m_el.attrib.get("implicit") == "yes"
            length = max_cursor if implicit and max_cursor > 0 else max(nominal, max_cursor)
            if p_idx == 0:
                measures.append({"time": time, "len": length, "nominal": nominal, "fifths": fifths})
            start += length
        if staves >= 2 and piano_upper is None:
            piano_upper, piano_lower = staff_base + 1, staff_base + 2
        staff_base += max(staves, 1)

    events = index_events(elems)
    return {"measures": measures, "elems": elems, "counts": counts,
            "piano": (piano_upper, piano_lower), "time": measures[0]["time"] if measures else (4, 4),
            "events": events, "brackets": read_brackets(elems, events), "beams": read_beams(elems, events)}


def index_events(elems: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Number the events (a chord's elements share the event of their first element) and return one record
    per event: its first element, with ``elems`` listing every element of the event."""
    events: List[Dict[str, Any]] = []
    for e in elems:
        if not e["chord"] or not events:
            events.append({"first": e, "elems": []})
        e["ev"] = len(events)
        events[-1]["elems"].append(e)
    return events


def read_brackets(elems: List[Dict[str, Any]], events: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Printed tuplet brackets and the events each holds (document order is time order within a voice)."""
    out: List[Dict[str, Any]] = []
    open_: Dict[Tuple[int, str], List[Dict[str, Any]]] = {}
    for ev in events:
        first = ev["first"]
        key = (first["part"], first["voice"])
        marks = [t for e in ev["elems"] for t in e["tuplets"]]
        for typ, num in marks:
            if typ == "start":
                ratio = next((e["tm_ratio"] for e in ev["elems"] if e["tm_ratio"]), None)
                ntype = next((e["normal_type"] for e in ev["elems"] if e["normal_type"]), None)
                b = {"part": key[0], "voice": key[1], "number": num, "ratio": ratio, "normal_type": ntype,
                     "events": [], "closed": False}
                out.append(b)
                open_.setdefault(key, []).append(b)
        for b in open_.get(key, []):
            b["events"].append(first["ev"])
        for typ, num in marks:
            if typ == "stop":
                stack = open_.get(key, [])
                hit = next((b for b in reversed(stack) if b["number"] == num), stack[-1] if stack else None)
                if hit is not None:
                    hit["closed"] = True
                    stack.remove(hit)
    return out


def read_beams(elems: List[Dict[str, Any]], events: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Primary beams: the events from a ``begin`` to its ``end`` in one (part, voice)."""
    out: List[Dict[str, Any]] = []
    open_: Dict[Tuple[int, str], Dict[str, Any]] = {}
    for ev in events:
        first = ev["first"]
        key = (first["part"], first["voice"])
        state = next((e["beam1"] for e in ev["elems"] if e["beam1"]), None)
        if state == "begin":
            b = {"part": key[0], "voice": key[1], "events": [first["ev"]]}
            out.append(b)
            open_[key] = b
        elif state in ("continue", "end") and key in open_:
            open_[key]["events"].append(first["ev"])
            if state == "end":
                del open_[key]
    return out
