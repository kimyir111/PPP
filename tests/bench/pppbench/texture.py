"""Textures: a reference re-voiced the way piano covers are written (G10a-2b, docs/GOALS/G10 section 26).

The catalogue is method books, sonatinas and hymns. A piano cover - what the app's users record - doubles its lines in
octaves: the left hand plays its bass in octaves, the right hand its melody in octaves. The hand split of the recording
conversion (rec/hands.js, S4) was counted on the catalogue, where a bare octave is almost always one note per hand (the
unison exercises of Hanon and Beyer: 99 % of 4,970 bare-octave onsets in the training references), so it splits a
cover's octaves between the hands (G10 section 26.2). A texture makes that visible on licence-clean material whose hands
are known: every note keeps its hand, and the doubled notes take the hand of the note they double.

    apply(canon, name) -> CanonicalScore      a new score; the reference's own object is not changed
    NAMES                                      the textures

``octaves``   at every onset where a hand plays ONE pitch, that pitch is doubled: the left hand's an octave below
              (not below A0), the right hand's an octave above (not above C8). A hand that plays two or more pitches
              at an onset is left as it is (its span would pass an octave: written cover octaves are within the hand),
              and a doubling that is already sounding at that onset (in either hand) is not added. So every doubled
              onset is a bare octave in one hand, playable by any hand profile.
``octaves-l`` the same, the left hand only; ``octaves-r`` the right hand only.

The doubled note copies its partner's written note piece by piece (tie pieces, voice, staff, duration, tuplet, type,
dots, spelling), an octave away. The printed-notation layer (reader/5 ``notation``, used only by nq.*) is not rebuilt: a
textured score has none, as a score the reader could not read it from. Pure and deterministic: the same canonical score
and name give the same score on every platform.
"""

from __future__ import annotations

import copy
import dataclasses
from typing import Any, Dict, List, Tuple

from .canonical import CanonicalScore, Note

NAMES = ("octaves", "octaves-l", "octaves-r")
LOWEST, HIGHEST = 21, 108


def _hands(name: str) -> Tuple[bool, bool]:
    if name not in NAMES:
        raise ValueError(f"unknown texture {name!r} (known: {', '.join(NAMES)})")
    return name in ("octaves", "octaves-l"), name in ("octaves", "octaves-r")


def apply(canon: CanonicalScore, name: str) -> CanonicalScore:
    from .musicxml import merge_ties
    do_l, do_r = _hands(name)
    by_id: Dict[int, Note] = {n.id: n for n in canon.notes}
    groups: Dict[Tuple[Any, str], List[Any]] = {}
    pitches: Dict[Any, set] = {}
    for s in canon.played():
        groups.setdefault((s.onset_q, s.hand), []).append(s)
        pitches.setdefault(s.onset_q, set()).add(s.midi)
    next_id = max([n.id for n in canon.notes], default=-1) + 1
    added: List[Note] = []
    for (onset, hand), group in sorted(groups.items(), key=lambda kv: (kv[0][0], kv[0][1])):
        if {s.midi for s in group} != {group[0].midi}:
            continue                                     # two or more pitches: not a single line here
        if hand == "l" and do_l:
            step = -12
        elif hand == "r" and do_r:
            step = 12
        else:
            continue
        src = min(group, key=lambda s: s.id)
        target = src.midi + step
        if not (LOWEST <= target <= HIGHEST) or target in pitches[onset]:
            continue
        pitches[onset].add(target)
        for nid in src.notes:
            n = by_id[nid]
            added.append(dataclasses.replace(n, id=next_id, midi=n.midi + step, written_midi=n.written_midi + step,
                                             octave=n.octave + step // 12, chord=True))
            next_id += 1
    notes = list(canon.notes) + added
    diagnostics = copy.deepcopy(canon.diagnostics)
    diagnostics["texture"] = {"name": name, "added_notes": len(added)}
    return dataclasses.replace(canon, notes=notes, sounding=merge_ties(notes), diagnostics=diagnostics, notation=None)
