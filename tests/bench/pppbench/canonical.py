"""Canonical score (schema ``ppp.canonical-score/1``, docs/GOALS/G00 §8.1).

Positions and durations are ``Fraction`` quarter notes inside Python and are
written as 6-decimal floats in JSON. ``notes`` are written notes (tie pieces
kept, rests excluded); ``sounding`` merges ties into one key press each.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from fractions import Fraction
from typing import Any, Dict, List, Optional, Tuple

from . import READER_VERSION

SCHEMA = "ppp.canonical-score/1"


@dataclass
class Measure:
    index: int
    number: str
    start_q: Fraction
    len_q: Fraction
    implicit: bool
    time: Tuple[int, int]
    fifths: int
    mode: str
    mode_explicit: bool
    # the bar number as the app keys it: parseInt(number), or the bar's position in its part when that
    # is not a number (parseMusicXML). Bars with the same app number are laid over each other.
    app_number: Optional[int] = None

    @property
    def sig_q(self) -> Fraction:
        return Fraction(self.time[0] * 4, self.time[1])

    def to_json(self) -> Dict[str, Any]:
        return {"index": self.index, "number": self.number, "app_number": self.app_number, "start_q": self.start_q,
                "len_q": self.len_q, "implicit": self.implicit, "time": list(self.time),
                "key": {"fifths": self.fifths, "mode": self.mode, "mode_explicit": self.mode_explicit}}


@dataclass
class Note:
    id: int
    measure: int
    pos_q: Fraction
    onset_q: Fraction
    dur_q: Fraction
    midi: int
    written_midi: int
    step: str
    alter: int
    octave: int
    staff: int
    hand: str
    voice: int
    chord: bool
    tie_start: bool
    tie_stop: bool
    tuplet: Optional[Tuple[int, int]]
    type: Optional[str]
    dots: int
    accidental: Optional[str]
    cue: bool

    def to_json(self) -> Dict[str, Any]:
        d = dict(self.__dict__)
        d["tuplet"] = list(self.tuplet) if self.tuplet else None
        return d


@dataclass
class Rest:
    measure: int
    pos_q: Fraction
    onset_q: Fraction
    dur_q: Fraction
    staff: int
    voice: int
    measure_rest: bool
    type: Optional[str] = None   # the printed rest (<type>); None when the file has none
    dots: int = 0
    tuplet: Optional[Tuple[int, int]] = None   # <time-modification>: a rest inside a triplet is a triplet rest

    def to_json(self) -> Dict[str, Any]:
        return dict(self.__dict__)


@dataclass
class ClefMark:
    """A clef as the app reads it: ``kind`` is treble, bass or alto (parseMusicXML ignores the line)."""
    measure: int
    pos_q: Fraction
    staff: int
    kind: str

    def to_json(self) -> Dict[str, Any]:
        return dict(self.__dict__)


@dataclass
class Sounding:
    id: int
    notes: List[int]
    midi: int
    measure: int
    pos_q: Fraction
    onset_q: Fraction
    dur_q: Fraction
    staff: int
    hand: str
    step: str
    alter: int
    pieces: int
    tuplet: bool

    def to_json(self) -> Dict[str, Any]:
        return dict(self.__dict__)


@dataclass
class TempoMark:
    measure: int
    pos_q: Fraction
    onset_q: Fraction
    qpm: float
    kind: str  # "sound" | "metronome"

    def to_json(self) -> Dict[str, Any]:
        return dict(self.__dict__)


@dataclass
class PedalMark:
    """A damper-pedal mark as the app reads it (``<pedal type>`` or ``<sound damper-pedal>``)."""
    measure: int
    pos_q: Fraction
    onset_q: Fraction
    type: str  # "start" | "stop" | "change"

    def to_json(self) -> Dict[str, Any]:
        return dict(self.__dict__)


@dataclass
class CanonicalScore:
    title: str
    source_path: Optional[str]
    source_sha256: Optional[str]
    effective_qpm: Optional[float]
    sound_qpm: Optional[float]
    printed_qpm: Optional[float]
    marks: List[TempoMark]
    staves: int
    piano_part: int
    measures: List[Measure]
    notes: List[Note]
    rests: List[Rest]
    sounding: List[Sounding]
    diagnostics: Dict[str, Any] = field(default_factory=dict)
    pedals: List[PedalMark] = field(default_factory=list)
    clefs: List[ClefMark] = field(default_factory=list)

    @property
    def app_qpm(self) -> int:
        v = self.effective_qpm or 84
        return int(v + 0.5) if v >= 0 else -int(-v + 0.5)

    def clef_at(self, staff: int, measure: int, pos_q: Fraction) -> str:
        """The clef in force for a note (clefs carry over bar lines); the app's default is treble on the
        first staff and bass below it."""
        kind = "treble" if staff == 1 else "bass"
        for c in self.clefs:   # document order within a staff is time order
            if c.staff == staff and (c.measure, c.pos_q) <= (measure, pos_q):
                kind = c.kind
        return kind

    def app_bar_starts(self) -> Dict[int, Fraction]:
        """Where the app puts each bar number (Score.finalize over parseMusicXML's measureInfo): bars are
        keyed by number, so two bars with one number share one entry — the later bar's length, and the
        start of its last occurrence. Notes of either bar are placed from there."""
        length: Dict[int, Fraction] = {}
        for m in self.measures:
            length[m.app_number] = m.len_q
        start: Dict[int, Fraction] = {}
        q = Fraction(0)
        for m in self.measures:
            start[m.app_number] = q
            q += length[m.app_number]
        return start

    @property
    def end_q(self) -> Fraction:
        if not self.measures:
            return Fraction(0)
        last = self.measures[-1]
        return last.start_q + last.len_q

    def played(self) -> List[Sounding]:
        """Sounding notes a pianist plays (hand r or l)."""
        return [s for s in self.sounding if s.hand in ("r", "l")]

    def primary_time(self) -> Tuple[int, int]:
        """Metre weighted by bar length; ties go to the one seen first."""
        weight: Dict[Tuple[int, int], Fraction] = {}
        order: List[Tuple[int, int]] = []
        for m in self.measures:
            if m.time not in weight:
                weight[m.time] = Fraction(0)
                order.append(m.time)
            weight[m.time] += m.len_q
        best = order[0]
        for t in order[1:]:
            if weight[t] > weight[best]:
                best = t
        return best

    def to_json(self) -> Dict[str, Any]:
        return {
            "schema": SCHEMA,
            "reader": READER_VERSION,
            "source": {"path": self.source_path, "sha256": self.source_sha256},
            "title": self.title,
            "tempo": {"effective_qpm": self.effective_qpm, "sound_qpm": self.sound_qpm,
                      "printed_qpm": self.printed_qpm, "app_qpm": self.app_qpm,
                      "marks": [m.to_json() for m in self.marks]},
            "staves": self.staves,
            "piano_part": self.piano_part,
            "measures": [m.to_json() for m in self.measures],
            "notes": [n.to_json() for n in self.notes],
            "rests": [r.to_json() for r in self.rests],
            "sounding": [s.to_json() for s in self.sounding],
            "pedals": [p.to_json() for p in self.pedals],
            "clefs": [c.to_json() for c in self.clefs],
            "diagnostics": self.diagnostics,
        }
