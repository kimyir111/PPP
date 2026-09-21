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

    @property
    def sig_q(self) -> Fraction:
        return Fraction(self.time[0] * 4, self.time[1])

    def to_json(self) -> Dict[str, Any]:
        return {"index": self.index, "number": self.number, "start_q": self.start_q, "len_q": self.len_q,
                "implicit": self.implicit, "time": list(self.time),
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

    @property
    def app_qpm(self) -> int:
        v = self.effective_qpm or 84
        return int(v + 0.5) if v >= 0 else -int(-v + 0.5)

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
            "diagnostics": self.diagnostics,
        }
