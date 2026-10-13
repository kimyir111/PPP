"""Raw MusicXML -> bars of notes, for judging an OMR engine's output (docs/GOALS/G12_OMR.md section 1, 10).

This is deliberately NOT the app's reader (tests/bench/pppbench/musicxml.py copies parseMusicXML, which refuses or bends what an
engine writes): it reads what the file says, note by note, in quarter notes (Fractions), and keeps the engine's own quirks visible:

  * ``<divisions>0</divisions>`` (Audiveris writes it on a page whose shortest value is a half note) is read as 1, as both of the
    app's readers read it, and noted in ``Score.div0``; ``divisions="repair"`` infers it from the first plain note's ``<type>``
    instead (the fix G12-1 makes, E8 of the design document);
  * a part's staves, not only its notes, are kept (part structure is a metric: ``parts_ok``);
  * bars of several parts are put on one grid by index, as the app does; the pages of a document are joined by ``join``.

Standard library only (the CI gate runs it).
"""

from __future__ import annotations

import re
import zipfile
import xml.etree.ElementTree as ET
from collections import defaultdict
from dataclasses import dataclass, field
from fractions import Fraction as F
from typing import Dict, List, Optional, Tuple, Union

STEP = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
# a note value in quarter notes (the types the divisions repair can read a duration against)
TYPE_Q = {"breve": F(8), "whole": F(4), "half": F(2), "quarter": F(1), "eighth": F(1, 2), "16th": F(1, 4),
          "32nd": F(1, 8), "64th": F(1, 16), "128th": F(1, 32)}


class ScoreError(Exception):
    """The file is not a MusicXML score this module can read."""


@dataclass
class Note:
    midi: Optional[int]          # None for a rest
    on: F                        # onset in the bar, quarter notes
    dur: F
    staff: int                   # global staff index (parts' staves counted one after the other)
    rest: bool
    beam: bool
    part: int


@dataclass
class Bar:
    notes: List[Note] = field(default_factory=list)
    len: Optional[F] = None      # the bar's length from the time signature in force (None before one is read)
    voices: Dict[Tuple[int, str], F] = field(default_factory=lambda: defaultdict(F))   # (part, voice) -> written total
    end: F = F(0)                # where the last note or rest ends


@dataclass
class PartInfo:
    bars: int
    staves: int


@dataclass
class Score:
    parts: List[PartInfo]
    bars: List[Bar]
    key: Optional[int] = None    # fifths of the first key signature
    time: Optional[str] = None   # "3/4" of the first time signature
    div0: bool = False           # a <divisions> of 0 was met

    @property
    def structure(self) -> str:
        """The staves of each part, e.g. ``2`` (one grand staff part), ``1x1`` (two single-staff parts), ``2x1x1``."""
        return "x".join(str(p.staves) for p in self.parts)


# ----------------------------------------------------------------------------- reading files
def mxl_text(data: bytes) -> str:
    """The MusicXML of an .mxl archive (container.xml's rootfile, else the first non-META xml entry)."""
    try:
        z = zipfile.ZipFile(_BytesIO(data))
    except zipfile.BadZipFile as exc:
        raise ScoreError(f"not a zip archive: {exc}") from exc
    names = z.namelist()
    target = None
    try:
        m = re.search(r'full-path\s*=\s*"([^"]+)"', z.read("META-INF/container.xml").decode("utf-8"))
        target = m.group(1) if m else None
    except KeyError:
        pass
    if target not in names:
        cand = [n for n in names if n.lower().endswith((".xml", ".musicxml")) and not n.startswith("META-INF")]
        if not cand:
            raise ScoreError("no MusicXML inside the .mxl")
        target = cand[0]
    return z.read(target).decode("utf-8")


def _BytesIO(data: bytes):
    import io
    return io.BytesIO(data)


def read_text(path: str) -> str:
    """The MusicXML text of a .musicxml / .xml / .mxl file."""
    with open(path, "rb") as handle:
        data = handle.read()
    if data[:2] == b"PK":
        return mxl_text(data)
    text = data.decode("utf-8-sig")
    return text


# ----------------------------------------------------------------------------- parsing
def _repair_divisions(part: ET.Element) -> F:
    """divisions per quarter, from the first note that has a <type> and a <duration> and is neither dotted nor in a tuplet."""
    for n in part.iter("note"):
        ty, dn = n.find("type"), n.find("duration")
        if (ty is not None and dn is not None and (ty.text or "").strip() in TYPE_Q and n.find("dot") is None
                and n.find("time-modification") is None and (dn.text or "").strip()):
            try:
                d = F((dn.text or "").strip()) / TYPE_Q[(ty.text or "").strip()]
            except (ValueError, ZeroDivisionError):
                continue
            if d > 0:
                return d
    return F(1)


def parse_score(xml: Union[str, bytes], divisions: str = "as-read") -> Score:
    """Bars of notes. ``divisions``: ``"as-read"`` (a zero is read as 1) or ``"repair"`` (a zero is inferred from <type>)."""
    if divisions not in ("as-read", "repair"):
        raise ValueError("divisions: as-read | repair")
    if isinstance(xml, str):
        xml = xml.encode("utf-8")
    try:
        root = ET.fromstring(xml)
    except ET.ParseError as exc:
        raise ScoreError(f"not XML: {exc}") from exc
    if root.tag not in ("score-partwise",):
        raise ScoreError(f"not a score-partwise document ({root.tag})")
    out = Score(parts=[], bars=[])
    grid: Dict[int, Bar] = {}
    off = 0
    for pi, part in enumerate(root.findall("part")):
        div, beats = F(1), None
        mx_staves = 1
        measures = part.findall("measure")
        for mi, m in enumerate(measures):
            cur = last = end = F(0)
            bar = grid.setdefault(mi, Bar())
            for el in m:
                if el.tag == "attributes":
                    d = el.find("divisions")
                    if d is not None and (d.text or "").strip():
                        try:
                            div = F((d.text or "").strip())
                        except (ValueError, ZeroDivisionError):
                            div = F(0)
                        if not div:
                            out.div0 = True
                            div = _repair_divisions(part) if divisions == "repair" else F(1)
                    s = el.find("staves")
                    if s is not None and (s.text or "").strip().isdigit():
                        mx_staves = max(mx_staves, int(s.text.strip()))
                    t = el.find("time")
                    if t is not None and t.find("beats") is not None and t.find("beat-type") is not None:
                        try:
                            beats = F(int(t.find("beats").text.split("+")[0])) * 4 / int(t.find("beat-type").text)
                        except (ValueError, ZeroDivisionError, AttributeError):
                            pass
                        if out.time is None:
                            out.time = t.find("beats").text + "/" + t.find("beat-type").text
                    k = el.find("key/fifths")
                    if k is not None and out.key is None:
                        try:
                            out.key = int(k.text)
                        except (ValueError, TypeError):
                            pass
                elif el.tag == "backup":
                    cur -= _dur(el, div)
                elif el.tag == "forward":
                    cur += _dur(el, div)
                elif el.tag == "note":
                    if el.find("grace") is not None or el.find("cue") is not None:
                        continue
                    dur = _dur(el, div)
                    chord = el.find("chord") is not None
                    on = last if chord else cur
                    st = el.find("staff")
                    st = int(st.text) if st is not None and (st.text or "").strip().isdigit() else 1
                    vo = el.find("voice")
                    voice = (pi, (vo.text or "1").strip() if vo is not None else "1")
                    rest = el.find("rest") is not None
                    midi = None
                    if not rest:
                        p = el.find("pitch")
                        if p is None:
                            continue
                        al = p.find("alter")
                        try:
                            midi = (STEP[p.find("step").text.strip()] + (int(float(al.text)) if al is not None else 0)
                                    + 12 * (int(p.find("octave").text) + 1))
                        except (KeyError, ValueError, AttributeError):
                            continue
                    bar.notes.append(Note(midi, on, dur, off + st - 1, rest, el.find("beam") is not None, pi))
                    if not chord:
                        bar.voices[voice] += dur
                        last = cur
                        cur += dur
                    end = max(end, on + dur)
            if beats is not None:
                bar.len = beats
            bar.end = max(bar.end, end)
        out.parts.append(PartInfo(len(measures), mx_staves))
        off += mx_staves
    out.bars = [grid[i] for i in sorted(grid)]
    return out


def _dur(el: ET.Element, div: F) -> F:
    d = el.find("duration")
    if d is None or not (d.text or "").strip():
        return F(0)
    try:
        return F((d.text or "").strip()) / div
    except (ValueError, ZeroDivisionError):
        return F(0)


def join(scores: List[Score]) -> Score:
    """The pages (or movements) of one piece as ONE score, as the app's merge reads them: the first document's parts and
    key and time, every document's bars one after the other."""
    if not scores:
        raise ScoreError("no pages")
    bars: List[Bar] = []
    for s in scores:
        bars.extend(s.bars)
    return Score(parts=scores[0].parts, bars=bars, key=scores[0].key if scores[0].key is not None else 0,
                 time=scores[0].time, div0=any(s.div0 for s in scores))
