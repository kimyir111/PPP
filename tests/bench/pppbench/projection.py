"""An app Score projected in the page (node/omr-live.js) -> canonical score.

Used where the thing to measure is the Score PPP built, not a MusicXML file:
OMR output after the app's merge and repair passes (§14 I4)."""

from __future__ import annotations

import re
from fractions import Fraction
from typing import Any, Dict

from .canonical import CanonicalScore, Measure, Note, Rest
from .metrics.readability import bar_integrity_detail
from .musicxml import merge_ties

PITCH_RE = re.compile(r"^([A-G])(#{0,3}|b{0,3})(-?\d+)$")


def _q(x) -> Fraction:
    return Fraction(x).limit_denominator(1 << 16)


def canonical_from_projection(proj: Dict[str, Any]) -> CanonicalScore:
    measures = []
    for i, m in enumerate(proj["measures"]):
        sig = Fraction(m["time"][0] * 4, m["time"][1])
        len_q = _q(m["lenQ"])
        measures.append(Measure(i, str(m["number"]), _q(m["startQ"]), len_q,
                                implicit=(i == 0 or i == len(proj["measures"]) - 1) and len_q < sig,
                                time=(int(m["time"][0]), int(m["time"][1])), fifths=int(m["fifths"]),
                                mode=m.get("mode") or "major", mode_explicit=True))
    notes, rests = [], []
    for n in proj["notes"]:
        if n.get("m") is None:
            continue
        mi = int(n["m"])
        pos, dur = _q(n["b"]), _q(n["dur"])
        onset = measures[mi].start_q + pos
        if n.get("rest") or n.get("midi") is None:
            rests.append(Rest(mi, pos, onset, dur, int(n.get("staff") or 1), int(n.get("voice") or 1), False))
            continue
        mt = PITCH_RE.match(n.get("p") or "")
        if mt:
            step, acc, octave = mt.group(1), mt.group(2), int(mt.group(3))
            alter = len(acc) if acc.startswith("#") else -len(acc)
        else:
            step, alter, octave = "C", 0, 4
        tm = n.get("tm")
        notes.append(Note(len(notes), mi, pos, onset, dur, int(n["midi"]), int(n.get("writtenMidi") or n["midi"]),
                          step, alter, octave, int(n.get("staff") or 1), n.get("hand") or "r", int(n.get("voice") or 1),
                          bool(n.get("chord")), bool(n.get("tieStart")), bool(n.get("tieStop")),
                          (int(tm["a"]), int(tm["n"])) if tm else None, n.get("type"), int(n.get("dots") or 0),
                          n.get("acc"), False))
    tempo = proj.get("tempo")
    canon = CanonicalScore(title=proj.get("title") or "", source_path=None, source_sha256=None,
                           effective_qpm=float(tempo) if tempo else None, sound_qpm=None, printed_qpm=None, marks=[],
                           staves=int(proj.get("staves") or 1), piano_part=0, measures=measures, notes=notes,
                           rests=rests, sounding=merge_ties(notes), diagnostics={})
    canon.diagnostics["bar_integrity"] = bar_integrity_detail(canon)
    return canon
