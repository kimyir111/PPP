"""MusicXML (.xml/.musicxml/.mxl) -> canonical score, with app parity.

The rules copy ``parseMusicXML()`` and ``Score.finalize`` in
``Piano Coach App.dc.html`` (docs/GOALS/G00 §8.2, R1-R22) so the benchmark
measures what PPP shows and plays, not a textbook reading of MusicXML:
grace notes skipped, a pickup bar as long as its content, part 0 defining the
bar grid, the first tempo (a ``<sound>`` before a ``<metronome>``), ottavas
applied the app's way, and hands from the piano part's last two staves.
"""

from __future__ import annotations

import os
import re
import zipfile
import xml.etree.ElementTree as ET
from fractions import Fraction
from typing import Any, Dict, List, Optional, Tuple

from .canonical import CanonicalScore, ClefMark, Measure, Note, PedalMark, Rest, Sounding, TempoMark
from .util import normalise_eol, sha256_bytes

# How <octave-shift> is read.
#   "app":      the app's reading (parseMusicXML): <pitch> is the written note, type="up" adds 12,
#               type="down" subtracts 12. Used for predictions and for T1-C parser parity.
#   "standard": MusicXML's reading: <pitch> is the sounding pitch and octave-shift only changes how it
#               is printed ("a treble clef line noted with 8va will be indicated with an octave-shift
#               down from the pitch data"). Used for reference scores: their truth is the music, not
#               the app's reading of it (G00 §17 M9). The difference is tracked as a known failure.
OTTAVA_MODES = ("app", "standard")


def pedal_sound_value(raw: Optional[str]) -> Optional[int]:
    """``pedalSoundValue`` in the app: <sound damper-pedal> as 0-127."""
    if raw is None or raw == "":
        return None
    if raw == "yes":
        return 127
    if raw == "no":
        return 0
    v = js_float(raw)
    if v is None:
        return None
    if v <= 1:
        return int(v * 127 + Fraction(1, 2)) if v >= 0 else 0
    return max(0, min(127, int(v + Fraction(1, 2))))

STEP_SEMI = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
UNIT_Q = {"breve": 8, "whole": 4, "half": 2, "quarter": 1, "eighth": Fraction(1, 2),
          "16th": Fraction(1, 4), "32nd": Fraction(1, 8)}
EPS = Fraction(1, 1000000)

_FLOAT_RE = re.compile(r"^\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)")
_INT_RE = re.compile(r"^\s*([+-]?\d+)")


class ReaderError(Exception):
    def __init__(self, code: str, message: str = ""):
        super().__init__(f"{code}: {message}" if message else code)
        self.code = code


# ----------------------------------------------------------------- JS parity
def js_float(text: Optional[str]) -> Optional[Fraction]:
    """``parseFloat`` as an exact Fraction (None for NaN)."""
    if text is None:
        return None
    m = _FLOAT_RE.match(text)
    if not m:
        return None
    try:
        return Fraction(m.group(1))
    except (ValueError, ZeroDivisionError):
        return None


def js_int(text: Optional[str]) -> Optional[int]:
    if text is None:
        return None
    m = _INT_RE.match(text)
    return int(m.group(1)) if m else None


def _first(el: ET.Element, name: str) -> Optional[ET.Element]:
    """``el.querySelector(name)``: first descendant, document order."""
    for x in el.iter(name):
        if x is not el:
            return x
    return None


def _all(el: ET.Element, name: str) -> List[ET.Element]:
    return [x for x in el.iter(name) if x is not el]


def _txt(el: ET.Element, name: str, default: Optional[str]) -> Optional[str]:
    n = _first(el, name)
    return n.text.strip() if n is not None and n.text is not None else (default if n is None else "")


def _num(el: ET.Element, name: str, default: Optional[Fraction]) -> Optional[Fraction]:
    v = js_float(_txt(el, name, ""))
    return v if v is not None else default


def _strip_ns(root: ET.Element) -> None:
    for el in root.iter():
        if isinstance(el.tag, str) and "}" in el.tag:
            el.tag = el.tag.rsplit("}", 1)[1]


# ----------------------------------------------------------------- files
def read_bytes(path: str) -> bytes:
    if path.lower().endswith(".mxl"):
        try:
            with zipfile.ZipFile(path) as z:
                names = z.namelist()
                if "META-INF/container.xml" in names:
                    croot = ET.fromstring(z.read("META-INF/container.xml"))
                    _strip_ns(croot)
                    for rf in croot.iter("rootfile"):
                        full = rf.attrib.get("full-path")
                        if full and full in names:
                            return z.read(full)
                xmls = [n for n in names if n.lower().endswith((".xml", ".musicxml")) and not n.startswith("META-INF/")]
                if not xmls:
                    raise ReaderError("bad-xml", f"{path}: no MusicXML inside the .mxl")
                return z.read(max(xmls, key=lambda n: (z.getinfo(n).file_size, n)))
        except zipfile.BadZipFile as exc:
            raise ReaderError("bad-xml", f"{path}: {exc}") from exc
    with open(path, "rb") as handle:
        return handle.read()


# ----------------------------------------------------------------- reader
def read_score(src: Any, *, source_path: Optional[str] = None, ottava: str = "app") -> CanonicalScore:
    """``src`` is a file path, XML bytes or XML text. ``ottava`` is "app" or "standard" (OTTAVA_MODES)."""
    if ottava not in OTTAVA_MODES:
        raise ValueError(f"ottava must be one of {OTTAVA_MODES}")
    if isinstance(src, str) and not src.lstrip().startswith("<") and os.path.exists(src):
        source_path = source_path or src
        data = read_bytes(src)
    elif isinstance(src, str):
        data = src.encode("utf-8")
    else:
        data = bytes(src)
    try:
        root = ET.fromstring(data)
    except ET.ParseError as exc:
        raise ReaderError("bad-xml", str(exc)) from exc
    _strip_ns(root)
    if root.tag == "score-timewise":
        raise ReaderError("timewise", "score-timewise is not supported (the app rejects it too)")
    if root.tag != "score-partwise":
        raise ReaderError("bad-xml", f"root element is <{root.tag}>")

    title = None
    work = root.find("work")
    if work is not None:
        wt = work.find("work-title")
        if wt is not None and wt.text and wt.text.strip():
            title = wt.text.strip()
    if not title:
        mt = _first(root, "movement-title")
        if mt is not None and mt.text and mt.text.strip():
            title = mt.text.strip()
    title = title or (os.path.basename(source_path) if source_path else "Untitled")

    parts = [c for c in root if c.tag == "part"]
    if not parts:
        raise ReaderError("no-parts")

    def piano_guess() -> int:
        for i, p in enumerate(parts):
            for a in p.iter("attributes"):
                st = a.find("staves")
                if st is not None:
                    if (js_int(st.text) or 1) >= 2:
                        return i
                    break
            # querySelector('attributes > staves') finds the first one only
        return len(parts) - 1

    guess = piano_guess()
    diag: Dict[str, Any] = {"parts": len(parts), "grace_skipped": 0, "cue_notes": 0,
                            "octave_shift": any(True for _ in root.iter("octave-shift")),
                            "duplicate_measure_numbers": False, "backup_clamped": 0,
                            "unpitched": 0, "orphan_notes": 0}

    raw_notes: List[Dict[str, Any]] = []   # notes and rests, app order
    marks: List[Dict[str, Any]] = []
    ottavas: List[Dict[str, Any]] = []
    pedal_raw: List[Dict[str, Any]] = []   # damper pedal marks, app order
    clef_raw: List[Dict[str, Any]] = []    # clefs, document order (parseMusicXML: sign F bass, C alto, else treble)
    grid: List[Dict[str, Any]] = []        # part 0 measures
    part_span: List[Tuple[int, int]] = []
    staff_base = 0
    max_staff_seen = 0
    first_tempo: Optional[Fraction] = None

    for part_idx, part in enumerate(parts):
        divisions = Fraction(1)
        time = (4, 4)
        fifths, mode, mode_explicit = 0, "major", False
        part_staves = 1
        seq = 0
        numbers_seen = set()
        for m_idx, m_el in enumerate(c for c in part if c.tag == "measure"):
            seq += 1
            raw_no = m_el.attrib.get("number")
            number = js_int(raw_no)
            if number is None:
                number = seq
            implicit = m_el.attrib.get("implicit") == "yes"
            if part_idx == 0:
                if number in numbers_seen:
                    diag["duplicate_measure_numbers"] = True
                numbers_seen.add(number)
            cursor = Fraction(0)
            max_cursor = Fraction(0)
            last_onset = Fraction(0)
            for el in m_el:
                tag = el.tag
                if tag == "attributes":
                    d = _num(el, "divisions", None)
                    if d and d > 0:
                        divisions = d
                    t = _first(el, "time")
                    if t is not None:
                        b = js_int(_txt(t, "beats", "4"))
                        bt = js_int(_txt(t, "beat-type", "4"))
                        if b is not None and bt is not None and b > 0 and bt > 0:
                            time = (b, bt)
                    k = _first(el, "key")
                    if k is not None:
                        fifths = js_int(_txt(k, "fifths", "0")) or 0
                        mode = _txt(k, "mode", "major")
                        mode_explicit = _first(k, "mode") is not None
                    st = js_int(_txt(el, "staves", ""))
                    if st is not None and st > 0:
                        part_staves = st
                    for cl in _all(el, "clef"):
                        sign = _txt(cl, "sign", "G")
                        kind = "bass" if sign == "F" else "alto" if sign == "C" else "percussion" if sign == "percussion" else "treble"
                        clef_raw.append({"m": m_idx, "b": cursor, "staff": staff_base + (js_int(cl.attrib.get("number") or "1") or 1),
                                         "kind": kind})
                    continue
                if tag == "direction":
                    at = cursor + (_num(el, "offset", Fraction(0)) or Fraction(0)) / divisions
                    if part_idx == guess:
                        ped = _first(el, "pedal")
                        if ped is not None and ped.attrib.get("type") in ("start", "stop", "change"):
                            pedal_raw.append({"m": m_idx, "b": at, "type": ped.attrib["type"]})
                        oct_el = _first(el, "octave-shift")
                        if oct_el is not None:
                            ty = oct_el.attrib.get("type")
                            size = js_int(oct_el.attrib.get("size") or "8") or 8
                            onum = oct_el.attrib.get("number") or None
                            on_staff = js_int(_txt(el, "staff", ""))
                            gstaff = staff_base + on_staff if on_staff is not None else None
                            if ty in ("up", "down"):
                                octaves = 2 if size >= 15 else 1
                                ottavas.append({"m": m_idx, "b": at, "end_m": None, "end_b": None,
                                                "semitones": (12 if ty == "up" else -12) * octaves,
                                                "staff": gstaff, "number": onum})
                            elif ty == "stop":
                                for ov in reversed(ottavas):
                                    if ov["end_m"] is not None:
                                        continue
                                    if onum and ov["number"] and ov["number"] != onum:
                                        continue
                                    if gstaff is not None and ov["staff"] is not None and ov["staff"] != gstaff:
                                        continue
                                    ov["end_m"], ov["end_b"] = m_idx, at
                                    break
                    snd = _first(el, "sound")
                    if snd is not None:
                        t2 = js_float(snd.attrib.get("tempo"))
                        if t2 is not None and t2 > 0:
                            marks.append({"m": m_idx, "b": at, "qpm": t2, "kind": "sound"})
                            if first_tempo is None:
                                first_tempo = t2
                        dv = pedal_sound_value(snd.attrib.get("damper-pedal"))
                        if dv is not None:
                            pedal_raw.append({"m": m_idx, "b": at,
                                              "type": "stop" if dv <= 0 else "change" if dv < 127 else "start"})
                    met = _first(el, "metronome")
                    per = _first(met, "per-minute") if met is not None else None
                    if per is not None:
                        t3 = js_float((per.text or "").strip())
                        unit = UNIT_Q.get(_txt(met, "beat-unit", "quarter"), 1)
                        dots = len(_all(met, "beat-unit-dot"))
                        if t3 is not None and t3 > 0:
                            bpm = t3 * unit * (2 - Fraction(1, 2 ** dots))
                            marks.append({"m": m_idx, "b": at, "qpm": bpm, "kind": "metronome"})
                            if first_tempo is None:
                                first_tempo = bpm
                    continue
                if tag == "sound":
                    t4 = js_float(el.attrib.get("tempo"))
                    if t4 is not None and t4 > 0:
                        marks.append({"m": m_idx, "b": cursor, "qpm": t4, "kind": "sound"})
                        if first_tempo is None:
                            first_tempo = t4
                    continue
                if tag == "backup":
                    cursor -= (_num(el, "duration", Fraction(0)) or Fraction(0)) / divisions
                    if cursor < 0:
                        cursor = Fraction(0)
                        diag["backup_clamped"] += 1
                    continue
                if tag == "forward":
                    cursor += (_num(el, "duration", Fraction(0)) or Fraction(0)) / divisions
                    max_cursor = max(max_cursor, cursor)
                    continue
                if tag != "note":
                    continue

                if _first(el, "grace") is not None:
                    diag["grace_skipped"] += 1
                    continue
                is_chord = _first(el, "chord") is not None
                rest_el = _first(el, "rest")
                dur_q = (_num(el, "duration", Fraction(0)) or Fraction(0)) / divisions
                staff_no = js_int(_txt(el, "staff", "1")) or 1
                voice = js_int(_txt(el, "voice", "1")) or 1
                gstaff = staff_base + staff_no
                max_staff_seen = max(max_staff_seen, gstaff)
                onset = last_onset if is_chord else cursor
                pitch = None
                if rest_el is None:
                    pit = _first(el, "pitch")
                    if pit is not None:
                        step = _txt(pit, "step", "C")
                        alter = js_int(_txt(pit, "alter", "0")) or 0
                        octave = js_int(_txt(pit, "octave", "4"))
                        pitch = (step, alter, 4 if octave is None else octave)
                cue = _first(el, "cue") is not None
                if cue and pitch is not None:
                    diag["cue_notes"] += 1
                tm = _first(el, "time-modification")
                tuplet = None
                if tm is not None:
                    a = js_int(_txt(tm, "actual-notes", "0")) or 0
                    n = js_int(_txt(tm, "normal-notes", "0")) or 0
                    if a > 0 and n > 0 and a != n:
                        tuplet = (a, n)
                ties = [t.attrib.get("type") for t in _all(el, "tie")]
                raw_notes.append({
                    "part": part_idx, "m": m_idx, "b": onset, "dur": dur_q, "staff": gstaff, "voice": voice,
                    "rest": rest_el is not None and pitch is None, "measure_rest": rest_el is not None and rest_el.attrib.get("measure") == "yes",
                    "pitch": pitch, "chord": is_chord, "tie_start": "start" in ties, "tie_stop": "stop" in ties,
                    "tuplet": tuplet, "type": _txt(el, "type", None) or None, "dots": len(_all(el, "dot")),
                    "accidental": _txt(el, "accidental", None) or None, "cue": cue, "doc": len(raw_notes),
                })
                if not is_chord:
                    last_onset = cursor
                    cursor += dur_q
                max_cursor = max(max_cursor, cursor)

            if part_idx == 0:
                sig = Fraction(time[0] * 4, time[1])
                content = Fraction(round(max_cursor * 1000000), 1000000)
                if implicit and content > 0:
                    len_q = content
                else:
                    len_q = content if content > sig + EPS else sig
                grid.append({"number": raw_no if raw_no is not None else str(number), "app_number": number,
                             "len_q": len_q, "implicit": implicit, "time": time, "fifths": fifths, "mode": mode,
                             "mode_explicit": mode_explicit})
        part_span.append((staff_base, max(part_staves, 1)))
        staff_base += max(part_staves, 1)

    if not grid:
        raise ReaderError("no-measures")

    measures: List[Measure] = []
    q = Fraction(0)
    for i, g in enumerate(grid):
        measures.append(Measure(i, g["number"], q, g["len_q"], g["implicit"], g["time"],
                                g["fifths"], g["mode"], g["mode_explicit"], app_number=g["app_number"]))
        q += g["len_q"]

    def start_of(m_idx: int) -> Fraction:
        return measures[m_idx].start_q if m_idx < len(measures) else Fraction(0)

    # hands (R17)
    piano_part = next((i for i, sp in enumerate(part_span) if sp[1] >= 2), len(part_span) - 1)
    base, count = part_span[piano_part]
    lh = base + count
    rh = lh - 1 if count >= 2 else lh
    for n in raw_notes:
        if count >= 2:
            n["hand"] = "r" if n["staff"] == rh else "l" if n["staff"] == lh else "x"
        else:
            n["hand"] = "r" if n["staff"] == base + 1 else "x"
    if not any(n["hand"] != "x" for n in raw_notes):
        for n in raw_notes:
            n["hand"] = "r" if n["staff"] <= 1 else "l"

    # ottavas (Score.finalize): closed spans only, staff-bound, latest start wins
    closed = [ov for ov in ottavas if ov["end_m"] is not None]

    def shift_at(staff: int, at: Fraction) -> int:
        best, best_start = 0, None
        for ov in closed:
            if ov["m"] >= len(measures) or ov["end_m"] >= len(measures):
                continue
            if ov["staff"] is not None and ov["staff"] != staff:
                continue
            a = start_of(ov["m"]) + ov["b"]
            z = start_of(ov["end_m"]) + ov["end_b"]
            if at < a - EPS or at >= z - EPS or (best_start is not None and a < best_start):
                continue
            best, best_start = ov["semitones"], a
        return best

    notes: List[Note] = []
    rests: List[Rest] = []
    diag["ottava_shifted_notes"] = 0   # notes whose app reading differs from MusicXML's (see OTTAVA_MODES)
    for n in raw_notes:
        if n["m"] >= len(measures):
            diag["orphan_notes"] += 1
            continue
        onset_q = start_of(n["m"]) + n["b"]
        if n["rest"]:
            rests.append(Rest(n["m"], n["b"], onset_q, n["dur"], n["staff"], n["voice"], n["measure_rest"],
                              n["type"], n["dots"], n["tuplet"]))
            continue
        if n["pitch"] is None:
            diag["unpitched"] += 1
            continue
        step, alter, octave = n["pitch"]
        if step not in STEP_SEMI or abs(alter) > 3:
            diag["unpitched"] += 1
            continue
        written = (octave + 1) * 12 + STEP_SEMI[step] + alter
        app_shift = shift_at(n["staff"], onset_q) if closed else 0
        if app_shift:
            diag["ottava_shifted_notes"] += 1
        midi = written + (app_shift if ottava == "app" else 0)
        notes.append(Note(len(notes), n["m"], n["b"], onset_q, n["dur"], midi, written, step, alter, octave,
                          n["staff"], n["hand"], n["voice"], n["chord"], n["tie_start"], n["tie_stop"],
                          n["tuplet"], n["type"], n["dots"], n["accidental"], n["cue"]))

    sounding = merge_ties(notes)
    if not sounding:
        raise ReaderError("no-notes")

    tempo_marks = [TempoMark(mk["m"], mk["b"], start_of(mk["m"]) + mk["b"], float(mk["qpm"]), mk["kind"])
                   for mk in marks if mk["m"] < len(measures)]
    sound_qpm = next((float(mk["qpm"]) for mk in marks if mk["kind"] == "sound"), None)
    printed_qpm = next((float(mk["qpm"]) for mk in marks if mk["kind"] == "metronome"), None)

    pedals = sorted((PedalMark(p["m"], p["b"], start_of(p["m"]) + p["b"], p["type"])
                     for p in pedal_raw if p["m"] < len(measures)), key=lambda p: p.onset_q)  # stable: document order at equal onsets
    diag["ottava_mode"] = ottava
    clefs = [ClefMark(c["m"], c["b"], c["staff"], c["kind"]) for c in clef_raw if c["m"] < len(measures)]
    canon = CanonicalScore(
        title=title, source_path=source_path, source_sha256=sha256_bytes(normalise_eol(data)),
        effective_qpm=float(first_tempo) if first_tempo is not None else None,
        sound_qpm=sound_qpm, printed_qpm=printed_qpm, marks=tempo_marks,
        staves=max(1, min(max_staff_seen, 4)), piano_part=piano_part,
        measures=measures, notes=notes, rests=rests, sounding=sounding, diagnostics=diag, pedals=pedals, clefs=clefs)
    from .metrics.readability import bar_integrity_detail
    diag["bar_integrity"] = bar_integrity_detail(canon)
    return canon


def merge_ties(notes: List[Note]) -> List[Sounding]:
    """Tie pieces -> key presses (R14).

    A tie-stop note continues an open chain of the same pitch only where that chain ends — the
    app's rule (``PianoScore.ties``: the stop note must sit at ``abs + dur`` of the tied note) and
    MusicXML's. reader/1 also joined a stop to any open chain of that pitch, which turned a tie that
    skips notes or lands after a gap (samples/prelude-fragment bar 6-7) into one long held note
    while the app strikes twice (§17 M6)."""
    order = sorted(notes, key=lambda n: (n.onset_q, n.staff, n.id))
    chains: List[Dict[str, Any]] = []
    for n in order:
        target = None
        if n.tie_stop:
            adjacent = [c for c in chains if c["open"] and c["midi"] == n.midi and abs(c["end"] - n.onset_q) <= EPS]
            same_staff = [c for c in adjacent if c["staff"] == n.staff]
            if same_staff or adjacent:
                target = (same_staff or adjacent)[-1]
        if target is None:
            target = {"first": n, "notes": [], "midi": n.midi, "staff": n.staff, "dur": Fraction(0),
                      "end": n.onset_q, "open": False, "tuplet": False}
            chains.append(target)
        target["notes"].append(n.id)
        target["dur"] += n.dur_q
        target["end"] = n.onset_q + n.dur_q
        target["open"] = n.tie_start
        target["tuplet"] = target["tuplet"] or n.tuplet is not None
    out: List[Sounding] = []
    for c in sorted(chains, key=lambda c: (c["first"].onset_q, c["first"].staff, c["midi"], c["first"].id)):
        f = c["first"]
        out.append(Sounding(len(out), c["notes"], c["midi"], f.measure, f.pos_q, f.onset_q, c["dur"],
                            f.staff, f.hand, f.step, f.alter, len(c["notes"]), c["tuplet"]))
    return out
