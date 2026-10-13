"""A tiny MusicXML builder for the omr-live-2 unit tests (tests/omr/omrbench): a piano score from bars of (right hand, left hand).

    piano([(["C4:1", "E4:1", "G4:2"], ["C3:4"]), (["r:4"], ["C3:2", "G3:2"])])

A note is ``"<pitch>:<quarters>"``; ``r`` is a rest; ``C4+E4`` is a chord; a trailing ``*`` marks the note as beamed. Durations are in
quarter notes and are written with ``divisions`` per quarter (``divisions=0`` writes the Audiveris quirk: a half note is ``duration 1``; use only halves and wholes with it).
"""

from __future__ import annotations

import os
import sys
from fractions import Fraction as F

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "omr"))

NAMES = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}


def _pitch(p: str) -> str:
    step, rest = p[0], p[1:]
    alter = 0
    while rest and rest[0] in "#b":
        alter += 1 if rest[0] == "#" else -1
        rest = rest[1:]
    return f"<pitch><step>{step}</step>" + (f"<alter>{alter}</alter>" if alter else "") + f"<octave>{rest}</octave></pitch>"


def _notes(items, staff, voice, divisions):
    out, total = [], F(0)
    div = divisions or 1
    for item in items:
        beamed = item.endswith("*")
        item = item.rstrip("*")
        name, q = item.split(":")
        q = F(q)
        total += q
        dur = int(q * div) if divisions else int(q / 2)       # the quirk: a half note is "duration 1"
        typ = {F(4): "whole", F(2): "half", F(1): "quarter", F(1, 2): "eighth", F(1, 4): "16th"}.get(q)
        t = f"<type>{typ}</type>" if typ else ""
        beam = '<beam number="1">begin</beam>' if beamed else ""
        if name == "r":
            out.append(f"<note><rest/><duration>{dur}</duration><voice>{voice}</voice>{t}<staff>{staff}</staff></note>")
            continue
        for k, p in enumerate(name.split("+")):
            out.append("<note>" + ("<chord/>" if k else "") + _pitch(p) + f"<duration>{dur}</duration><voice>{voice}</voice>{t}"
                       + (beam if not k else "") + f"<staff>{staff}</staff></note>")
    return "".join(out), total


def piano(bars, divisions=4, time=(4, 4), fifths=0, staves=2, parts="grand", doctype=False):
    """parts: ``grand`` (one part, two staves), ``split`` (two parts of one staff each: the issue 11 shape)."""
    def part_xml(pid, rows, nstaves, first_staff):
        ms = []
        for i, (rh, lh) in enumerate(rows):
            attrs = ""
            if i == 0:
                clefs = "".join(f'<clef number="{n + 1}"><sign>{"G" if (first_staff + n) == 0 else "F"}</sign><line>{2 if (first_staff + n) == 0 else 4}</line></clef>'
                                for n in range(nstaves))
                attrs = (f"<attributes><divisions>{divisions}</divisions><key><fifths>{fifths}</fifths></key>"
                         f"<time><beats>{time[0]}</beats><beat-type>{time[1]}</beat-type></time>"
                         + (f"<staves>{nstaves}</staves>" if nstaves > 1 else "") + clefs + "</attributes>")
            a, ta = _notes(rh, 1, 1, divisions)
            body = attrs + a
            if nstaves > 1:
                b, tb = _notes(lh, 2, 2, divisions)
                body += f"<backup><duration>{int(ta * divisions) if divisions else int(ta / 2)}</duration></backup>" + b
            ms.append(f'<measure number="{i + 1}">{body}</measure>')
        return f'<part id="{pid}">' + "".join(ms) + "</part>"

    if parts == "grand":
        plist = '<score-part id="P1"><part-name>Piano</part-name></score-part>'
        body = part_xml("P1", bars, staves, 0)
    else:
        plist = '<score-part id="P1"><part-name>R</part-name></score-part><score-part id="P2"><part-name>L</part-name></score-part>'
        body = part_xml("P1", [(rh, []) for rh, _ in bars], 1, 0) + part_xml("P2", [(lh, []) for _, lh in bars], 1, 1)
    dt = '<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">' if doctype else ""
    return f'<?xml version="1.0" encoding="UTF-8"?>{dt}<score-partwise version="3.1"><part-list>{plist}</part-list>{body}</score-partwise>'


# a 6-bar piece with a pick-up-free 4/4 grid, a rest bar, a chord, a beamed run and a left hand that moves
BARS = [
    (["C4:1", "E4:1", "G4:1", "E4:1"], ["C3:2", "G3:2"]),
    (["F4:1", "A4:1", "C5:2"], ["F2:2", "C3:2"]),
    (["G4:0.5*", "A4:0.5*", "B4:1", "D5:2"], ["G2:4"]),
    (["C5:1", "B4:1", "A4:1", "G4:1"], ["C3:1", "E3:1", "G3:2"]),
    (["r:4"], ["A2:4"]),
    (["C4+E4+G4:4"], ["C3:2", "C2:2"]),
]
