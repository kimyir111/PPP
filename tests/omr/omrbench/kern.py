"""Humdrum **kern, as the Sheet Music Transformer writes it, -> MusicXML (G12-6, the AI-7 bake-off; docs/GOALS/G12_OMR.md section 25).

The full-page SMT model (PRAIG/smt-fp-grandstaff) answers a page with kern: one spine per staff, the LEFT spine the lower staff, ``*^``
splitting a spine into two voices of its staff, ``*v`` joining adjacent ones, ``=`` a bar line, ``.`` "the note above goes on". It does not
always keep its own spine count (a split it never wrote, a join of spines that are not there, a data line with one field too many), and
music21's Humdrum reader refuses such a file: 5 of the first 10 tuning pages. This reader never refuses; its rules, fixed on the tuning
half only:

  1. spines: the first line's fields are the spines; the left half of them (rounded down) the lower staff (2), the rest the upper (1);
     a split spine's two children keep its staff; a join keeps the staff of its first spine; a ``*v`` alone, or on a field that is not
     a spine, is ignored; a data line with more fields than spines adds spines on the staff of the last one; fewer: the missing ones are
     ``.``;
  2. time: every data line starts where the earliest note still sounding on any spine ends (the Humdrum rule); a bar line starts the
     next bar at 0;
  3. a token: ``<recip>[.]<pitch>[accidentals]`` (``4.cc#``, ``16GG-``, ``2r``), several space-separated = a chord; recip ``0`` a breve,
     ``3%2`` a rational; grace notes (``q``/``Q``) and tokens without a recip are not read (the benchmark's reader ignores grace notes
     too); a rest without a recip lasts the bar; ties, beams, articulations are ignored (the omr.* metrics do not read them);
  4. ``*k[...]``, ``*M3/4``, ``*clefG2`` / ``*clefF4`` are the key, the metre and the clef of the spine's staff from that point on;
  5. MusicXML: one part "Piano", two staves; each note is written at its onset (``<forward>`` / ``<backup>`` to it), voice = its spine's
     place among its staff's spines (staff 1: voices 1-4, staff 2: 5-8), ``divisions`` the common denominator of every onset and value.

Standard library only (unit-tested in the gate: tests/bench/unit/test_omr2_kern.py).
"""

from __future__ import annotations

import math
import re
from fractions import Fraction as F
from typing import Dict, List, Optional, Tuple
from xml.sax.saxutils import escape

STEPS = {"c": ("C", 0), "d": ("D", 2), "e": ("E", 4), "f": ("F", 5), "g": ("G", 7), "a": ("A", 9), "b": ("B", 11)}
_RECIP = re.compile(r"(?P<recip>\d+(?:%\d+)?)(?P<dots>\.*)")
_PITCH = re.compile(r"(?P<p>([a-gA-G])\2*|r+)(?P<acc>[#\-n]*)")


class Event:
    __slots__ = ("on", "dur", "staff", "voice", "pitches", "rest")

    def __init__(self, on: F, dur: F, staff: int, voice: int, pitches: List[Tuple[str, int, int]], rest: bool):
        self.on, self.dur, self.staff, self.voice, self.pitches, self.rest = on, dur, staff, voice, pitches, rest


def recip_quarters(recip: str, dots: int) -> Optional[F]:
    """The value of a kern recip in quarter notes (``4`` 1, ``8.`` 3/4, ``0`` 8, ``3%2`` 8/3); None when it is not one."""
    if not recip:
        return None
    if "%" in recip:
        a, b = recip.split("%", 1)
        if not a.isdigit() or not b.isdigit() or int(a) == 0:
            return None
        base = F(4 * int(b), int(a))
    elif set(recip) == {"0"}:
        base = F(8) * (2 ** (len(recip) - 1))
    else:
        base = F(4, int(recip))
    total, add = base, base
    for _ in range(dots):
        add /= 2
        total += add
    return total


def parse_note(sub: str) -> Optional[Tuple[Optional[F], Optional[Tuple[str, int, int]], bool]]:
    """One sub-token -> (value in quarters or None, (step, alter, octave) or None for a rest, is_rest); None = not read.
    The recip is the first run of digits (with its dots), the pitch the first run of one letter a-g / A-G (or ``r``), its
    accidentals what follows it; every other character (slurs, beams, ties, articulations) is ignored."""
    if not sub or "q" in sub or "Q" in sub:
        return None
    m = _RECIP.search(sub)
    recip, dots = (m.group("recip"), len(m.group("dots"))) if m else ("", 0)
    pm = _PITCH.search(sub)
    if not pm:
        return None
    value = recip_quarters(recip, dots)
    p = pm.group("p")
    if p[0] == "r":
        return value, None, True
    letter = p[0]
    step, _ = STEPS[letter.lower()]
    octave = 3 + len(p) if letter.islower() else 4 - len(p)
    acc = pm.group("acc")
    alter = acc.count("#") - acc.count("-")
    return value, (step, alter, octave), False


def key_fifths(tok: str) -> Optional[int]:
    m = re.fullmatch(r"\*k\[([a-g#\-]*)\]", tok)
    if not m:
        return None
    body = m.group(1)
    return body.count("#") - body.count("-")


def meter(tok: str) -> Optional[Tuple[int, int]]:
    m = re.fullmatch(r"\*M(\d+)/(\d+)", tok)
    if not m or int(m.group(2)) == 0:
        return None
    return int(m.group(1)), int(m.group(2))


def clef(tok: str) -> Optional[Tuple[str, int]]:
    m = re.fullmatch(r"\*clef([GFC])v?(\d)", tok)
    return (m.group(1), int(m.group(2))) if m else None


class Bar:
    def __init__(self) -> None:
        self.events: List[Event] = []
        self.attrs: Dict[str, object] = {}       # key, time, clef1, clef2 changes at the start of this bar
        self.length: Optional[F] = None


def _initial(fields: List[str]) -> List[int]:
    """The staff of each spine of a first line: the **kern spines' left half (rounded down) the lower staff (2), the rest the upper (1);
    a spine of another kind (**dynam, **text ...) is 0 and never read."""
    music = [i for i, f in enumerate(fields) if not f.startswith("**") or f.startswith("**kern") or f.startswith("**ekern")
             or f.startswith("**bekern")]
    staves = [0] * len(fields)
    n = len(music)
    for k, i in enumerate(music):
        staves[i] = 2 if (n > 1 and k < n // 2) else 1
    return staves


def read(text: str) -> Tuple[List[Bar], Dict[str, int]]:
    """kern text -> bars of events, and counts of what was mended (``extra_fields``, ``missing_fields``, ``bad_joins``, ``skipped``)."""
    lines = [ln.rstrip("\r") for ln in text.split("\n")]
    lines = [ln for ln in lines if ln.strip() and not ln.startswith("!")]
    counts = {"extra_fields": 0, "missing_fields": 0, "bad_joins": 0, "skipped": 0, "lines": len(lines)}
    staves: List[int] = []                         # the staff of each spine (0: not a music spine)
    ends: List[F] = []                             # where the note of each spine ends, in the bar
    bars: List[Bar] = [Bar()]
    t = F(0)
    cur_len: Optional[F] = None
    started = False
    for ln in lines:
        fields = ln.split("\t")
        if fields[0].startswith("**"):
            if not started:
                staves = _initial(fields)
                ends = [F(0)] * len(staves)
                started = True
            continue
        if not started:
            staves = _initial(fields)
            ends = [F(0)] * len(staves)
            started = True
        if all(f.startswith("=") for f in fields):
            bars[-1].length = cur_len
            bars.append(Bar())
            t = F(0)
            ends = [F(0)] * len(staves)
            continue
        if all(f.startswith("*") for f in fields):
            new_staves: List[int] = []
            new_ends: List[F] = []
            i = 0
            nf = len(fields)
            while i < len(staves):
                f = fields[i] if i < nf else "*"
                if f == "*^":
                    new_staves += [staves[i], staves[i]]
                    new_ends += [ends[i], ends[i]]
                    i += 1
                elif f == "*v":
                    j = i
                    while j < len(staves) and j < nf and fields[j] == "*v":
                        j += 1
                    if j - i >= 2:
                        new_staves.append(staves[i])
                        new_ends.append(max(ends[i:j]))
                    else:
                        counts["bad_joins"] += 1
                        new_staves.append(staves[i])
                        new_ends.append(ends[i])
                    i = j
                elif f == "*-":
                    i += 1                          # the spine ends
                else:
                    st = staves[i]
                    m = re.fullmatch(r"\*staff(\d)", f)
                    if m and st and m.group(1) in ("1", "2"):
                        st = int(m.group(1))
                    k, me, cl = key_fifths(f), meter(f), clef(f)
                    if st:
                        if k is not None:
                            bars[-1].attrs["key"] = k
                        if me is not None:
                            bars[-1].attrs["time"] = me
                            cur_len = F(4 * me[0], me[1])
                        if cl is not None:
                            bars[-1].attrs[f"clef{st}"] = cl
                    new_staves.append(st)
                    new_ends.append(ends[i])
                    i += 1
            if nf > len(staves) and any(f != "*" for f in fields[len(staves):]):
                counts["extra_fields"] += 1
            staves, ends = new_staves, new_ends
            continue
        # a data line
        if len(fields) > len(staves):
            counts["extra_fields"] += 1
            last = next((x for x in reversed(staves) if x), 1)
            for _ in range(len(fields) - len(staves)):
                staves.append(last)
                ends.append(t)
        elif len(fields) < len(staves):
            counts["missing_fields"] += 1
        voice_of = _voices(staves)
        grace = timed = False
        for i, f in enumerate(fields):
            if f == "." or f == "" or not staves[i]:
                continue
            if any(("q" in x or "Q" in x) for x in f.split(" ")):
                grace = True                        # a grace note takes no time: this line does not move the clock
            evs = [parse_note(x) for x in f.split(" ") if x]
            evs = [e for e in evs if e is not None]
            if not evs:
                counts["skipped"] += 1
                continue
            vals = [e[0] for e in evs if e[0] is not None]
            if not vals:
                if all(e[2] for e in evs):          # a rest of no value: the whole bar
                    vals = [cur_len or F(4)]
                else:
                    counts["skipped"] += 1
                    continue
            dur = min(vals)
            pitches = [e[1] for e in evs if not e[2] and e[1] is not None]
            bars[-1].events.append(Event(t, dur, staves[i], voice_of[i], pitches, not pitches))
            ends[i] = t + dur
            timed = True
        later = [e for e in ends if e > t]
        if later and not (grace and not timed):
            t = min(later)
    bars[-1].length = cur_len
    if bars and not bars[-1].events and len(bars) > 1:
        bars.pop()
    if bars and not bars[0].events and len(bars) > 1:     # a bar line before any note (the model's leading "=")
        attrs = bars[0].attrs
        bars = bars[1:]
        bars[0].attrs = {**attrs, **bars[0].attrs}
    return bars, counts


def _voices(staves: List[int]) -> List[int]:
    """The voice of each spine: its place among the spines of its staff (staff 1: 1, 2, ...; staff 2: 5, 6, ...)."""
    seen: Dict[int, int] = {}
    out = []
    for st in staves:
        seen[st] = seen.get(st, 0) + 1
        out.append(seen[st] + (0 if st == 1 else 4))
    return out


TYPES = [(F(8), "breve"), (F(4), "whole"), (F(2), "half"), (F(1), "quarter"), (F(1, 2), "eighth"), (F(1, 4), "16th"),
         (F(1, 8), "32nd"), (F(1, 16), "64th"), (F(1, 32), "128th")]


def _type_of(q: F) -> Tuple[Optional[str], int]:
    for base, name in TYPES:
        for dots, mul in ((0, F(1)), (1, F(3, 2)), (2, F(7, 4))):
            if q == base * mul:
                return name, dots
    return None, 0


def to_musicxml(bars: List[Bar]) -> str:
    dens = [1]
    for b in bars:
        for e in b.events:
            dens += [e.on.denominator, e.dur.denominator]
        if b.length is not None:
            dens.append(b.length.denominator)
    div = 1
    for d in dens:
        div = div * d // math.gcd(div, d)
    out = ['<?xml version="1.0" encoding="UTF-8"?>', '<score-partwise version="4.0">',
           '<part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>', '<part id="P1">']
    for bi, b in enumerate(bars, 1):
        out.append(f'<measure number="{bi}">')
        attrs = []
        if bi == 1:
            attrs.append(f"<divisions>{div}</divisions>")
        if "key" in b.attrs:
            attrs.append(f"<key><fifths>{b.attrs['key']}</fifths></key>")
        if "time" in b.attrs:
            be, bt = b.attrs["time"]
            attrs.append(f"<time><beats>{be}</beats><beat-type>{bt}</beat-type></time>")
        if bi == 1:
            attrs.append("<staves>2</staves>")
        for st in (1, 2):
            c = b.attrs.get(f"clef{st}") or ((("G", 2) if st == 1 else ("F", 4)) if bi == 1 else None)
            if c:
                attrs.append(f'<clef number="{st}"><sign>{c[0]}</sign><line>{c[1]}</line></clef>')
        if attrs:
            out.append("<attributes>" + "".join(attrs) + "</attributes>")
        pos = F(0)
        for st in (1, 2):
            evs = sorted((e for e in b.events if e.staff == st), key=lambda e: (e.voice, e.on))
            for e in evs:
                if e.on > pos:
                    out.append(f"<forward><duration>{_d(e.on - pos, div)}</duration></forward>")
                elif e.on < pos:
                    out.append(f"<backup><duration>{_d(pos - e.on, div)}</duration></backup>")
                pos = e.on
                ty, dots = _type_of(e.dur)
                tail = (f"<voice>{e.voice}</voice>" + (f"<type>{ty}</type>" if ty else "") + "<dot/>" * dots + f"<staff>{st}</staff>")
                if e.rest or not e.pitches:
                    out.append(f"<note><rest/><duration>{_d(e.dur, div)}</duration>{tail}</note>")
                else:
                    for k, (step, alter, octave) in enumerate(e.pitches):
                        alt = f"<alter>{alter}</alter>" if alter else ""
                        out.append(("<note>" + ("<chord/>" if k else "") + f"<pitch><step>{escape(step)}</step>{alt}<octave>{octave}</octave></pitch>"
                                    f"<duration>{_d(e.dur, div)}</duration>{tail}</note>"))
                pos = e.on + e.dur
        out.append("</measure>")
    out += ["</part>", "</score-partwise>", ""]
    return "\n".join(out)


def _d(q: F, div: int) -> int:
    return int(q * div)


def convert(text: str) -> Tuple[str, Dict[str, int]]:
    """kern text -> (MusicXML text, counts of what was mended)."""
    bars, counts = read(text)
    counts["bars"] = len(bars)
    return to_musicxml(bars), counts
