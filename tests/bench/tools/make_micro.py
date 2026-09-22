#!/usr/bin/env python3
"""Write the G0 micro corpus (docs/GOALS/G00 §6.4) to tests/bench/corpus/micro/.

Twenty-four short piano pieces written for PPP's benchmark (CC0). Each one
isolates one notation question: metre, pickup, tuplets, ties, spelling,
hands, tempo. The output is committed; rerun only to change a piece, then
relock and rebaseline (tests/bench/README.md).

    python tests/bench/tools/make_micro.py [--check]
"""

from __future__ import annotations

import argparse
import os
import sys
from fractions import Fraction as Fr
from typing import Dict, List, Optional, Tuple

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(os.path.dirname(HERE), "corpus", "micro")

DIV = 24
STEP_SEMI = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
SHARP_ORDER = "FCGDAEB"
TYPES = {96: ("whole", 0), 72: ("half", 1), 48: ("half", 0), 36: ("quarter", 1), 24: ("quarter", 0),
         18: ("eighth", 1), 12: ("eighth", 0), 9: ("16th", 1), 6: ("16th", 0), 3: ("32nd", 0),
         144: ("whole", 1)}
TRIPLET_TYPES = {8: "eighth", 4: "16th"}


def pitch(name: str) -> Tuple[str, int, int]:
    step = name[0]
    rest = name[1:]
    alter = 0
    while rest and rest[0] in "#b":
        alter += 1 if rest[0] == "#" else -1
        rest = rest[1:]
    if rest.startswith("n"):
        rest = rest[1:]
    return step, alter, int(rest)


def key_alters(fifths: int) -> Dict[str, int]:
    alters = {s: 0 for s in "CDEFGAB"}
    if fifths > 0:
        for s in SHARP_ORDER[:fifths]:
            alters[s] = 1
    elif fifths < 0:
        for s in SHARP_ORDER[::-1][:-fifths]:
            alters[s] = -1
    return alters


class Piece:
    def __init__(self, pid: str, title: str, time: Tuple[int, int], fifths: int, mode: str, qpm: float,
                 bars: int, pickup: Optional[Fr] = None, metronome: Optional[Tuple[str, bool, float]] = None):
        self.id, self.title, self.time, self.fifths, self.mode, self.qpm = pid, title, time, fifths, mode, qpm
        self.bars, self.pickup = bars, pickup
        self.metronome = metronome or ("quarter", False, qpm)
        self.events: List[dict] = []
        self.tempo_changes: List[Tuple[int, float]] = []   # (measure index, qpm)

    @property
    def bar_q(self) -> Fr:
        return Fr(self.time[0] * 4, self.time[1])

    def measure_starts(self) -> List[Fr]:
        starts, q = [], Fr(0)
        if self.pickup:
            starts.append(q)
            q += self.pickup
        for _ in range(self.bars):
            starts.append(q)
            q += self.bar_q
        starts.append(q)
        return starts

    def at(self, bar: int, pos) -> Fr:
        """Absolute quarter position of ``pos`` quarters into bar ``bar`` (1-based; 0 = pickup)."""
        starts = self.measure_starts()
        index = bar if self.pickup else bar - 1
        return starts[index] + Fr(pos)

    def add(self, staff: int, voice: int, bar: int, pos, dur, pitches, tie: bool = False, tuplet: bool = False):
        if isinstance(pitches, str):
            pitches = pitches.split()
        self.events.append({"staff": staff, "voice": voice, "start": self.at(bar, pos), "dur": Fr(dur),
                            "pitches": list(pitches), "tie": tie, "tuplet": tuplet})

    def seq(self, staff: int, voice: int, bar: int, pos, items):
        """Add consecutive notes: items = [(dur, "C5"), (dur, "C4 E4 G4"), (dur, None = rest), ...]."""
        at = self.at(bar, pos)
        for dur, p in items:
            if p:
                pl = p.split()
                self.events.append({"staff": staff, "voice": voice, "start": at, "dur": Fr(dur),
                                    "pitches": pl, "tie": False, "tuplet": Fr(dur) * DIV % 3 != 0 and Fr(dur) * DIV in (8, 4)})
            at += Fr(dur)


def split_ticks(ticks: int) -> List[int]:
    out = []
    for d in sorted(TYPES, reverse=True):
        while ticks >= d:
            out.append(d)
            ticks -= d
    if ticks:
        raise ValueError(f"unwritable duration remainder {ticks}")
    return out


def write(piece: Piece) -> str:
    starts = piece.measure_starts()
    n_measures = len(starts) - 1
    alters_key = key_alters(piece.fifths)
    out = ['<?xml version="1.0" encoding="UTF-8"?>',
           '<score-partwise version="3.1">',
           f"<work><work-title>{piece.title}</work-title></work>",
           '<identification><creator type="composer">PPP benchmark (G0 micro corpus)</creator>'
           "<rights>CC0 1.0 — written for PPP's benchmark</rights></identification>",
           '<part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>',
           '<part id="P1">']
    voices = sorted({(e["staff"], e["voice"]) for e in piece.events} | {(1, 1), (2, 5)})
    for mi in range(n_measures):
        m0, m1 = starts[mi], starts[mi + 1]
        mlen = m1 - m0
        implicit = bool(piece.pickup) and mi == 0
        number = mi if piece.pickup else mi + 1
        out.append(f'<measure number="{number}"' + (' implicit="yes"' if implicit else "") + ">")
        if mi == 0:
            out.append(f"<attributes><divisions>{DIV}</divisions><key><fifths>{piece.fifths}</fifths><mode>{piece.mode}</mode></key>"
                       f"<time><beats>{piece.time[0]}</beats><beat-type>{piece.time[1]}</beat-type></time><staves>2</staves>"
                       '<clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes>')
            out.append(tempo_direction(piece.metronome, piece.qpm))
        for idx, q in piece.tempo_changes:
            if idx == mi:
                out.append(tempo_direction(("quarter", False, q), q))
        cursor_total = 0
        for vi, (staff, voice) in enumerate(voices):
            pieces = []
            for e in piece.events:
                if (e["staff"], e["voice"]) != (staff, voice):
                    continue
                s, t = e["start"], e["start"] + e["dur"]
                if t <= m0 or s >= m1:
                    continue
                ps, pt = max(s, m0), min(t, m1)
                pieces.append({"pos": int((ps - m0) * DIV), "ticks": int((pt - ps) * DIV), "pitches": e["pitches"],
                               "tie_stop_bar": s < m0, "tie_start_bar": t > m1, "tie": e["tie"] and t <= m1,
                               "tuplet": e["tuplet"]})
            primary = voice in (1, 5)
            if not pieces and not primary:
                continue
            if vi and cursor_total:
                out.append(f"<backup><duration>{cursor_total}</duration></backup>")
            cursor = 0
            if not pieces:
                out.append(f'<note><rest measure="yes"/><duration>{int(mlen * DIV)}</duration><voice>{voice}</voice><staff>{staff}</staff></note>')
                cursor_total = int(mlen * DIV)
                continue
            acc_state: Dict[Tuple[str, int], int] = {}
            pieces.sort(key=lambda p: p["pos"])
            prev_tie_pitches: set = set()
            for p in pieces:
                if p["pos"] > cursor:
                    gap = p["pos"] - cursor
                    if primary:
                        for d in split_ticks(gap):
                            out.append(rest_xml(d, voice, staff))
                    else:
                        out.append(f"<forward><duration>{gap}</duration></forward>")
                    cursor = p["pos"]
                if p["pos"] < cursor:
                    raise ValueError(f"{piece.id}: overlapping notes in voice {voice} measure {mi}")
                if p["tuplet"]:
                    chunks = [p["ticks"]]
                else:
                    chunks = split_ticks(p["ticks"])
                for ci, ticks in enumerate(chunks):
                    tie_stop = p["tie_stop_bar"] and ci == 0 or ci > 0 or (ci == 0 and p.get("tie_in"))
                    tie_start = ci < len(chunks) - 1 or p["tie_start_bar"] or (ci == len(chunks) - 1 and p["tie"])
                    pos = cursor
                    for k, name in enumerate(sorted(p["pitches"], key=lambda nm: midi_of(nm))):
                        step, alter, octave = pitch(name)
                        current = acc_state.get((step, octave), alters_key[step])
                        acc = ""
                        stopped = tie_stop or (name in prev_tie_pitches and ci == 0)
                        if alter != current and not stopped:
                            acc = "<accidental>" + {-2: "flat-flat", -1: "flat", 0: "natural", 1: "sharp", 2: "double-sharp"}[alter] + "</accidental>"
                        acc_state[(step, octave)] = alter
                        if p["tuplet"]:
                            typ, dot = TRIPLET_TYPES[ticks], 0
                        else:
                            typ, dot = TYPES[ticks]
                        tm = ("<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>"
                              if p["tuplet"] else "")
                        nots = []
                        if stopped:
                            nots.append('<tied type="stop"/>')
                        if tie_start:
                            nots.append('<tied type="start"/>')
                        if p["tuplet"] and k == 0:
                            beat_ticks = 3 * ticks
                            if pos % beat_ticks == 0:
                                nots.append('<tuplet type="start" bracket="yes"/>')
                            if (pos + ticks) % beat_ticks == 0:
                                nots.append('<tuplet type="stop"/>')
                        out.append("<note>" + ("<chord/>" if k else "") +
                                   f"<pitch><step>{step}</step>" + (f"<alter>{alter}</alter>" if alter else "") + f"<octave>{octave}</octave></pitch>"
                                   f"<duration>{ticks}</duration>" + ('<tie type="stop"/>' if stopped else "") +
                                   ('<tie type="start"/>' if tie_start else "") +
                                   f"<voice>{voice}</voice><type>{typ}</type>" + ("<dot/>" if dot else "") + tm + acc +
                                   f"<staff>{staff}</staff>" + (f"<notations>{''.join(nots)}</notations>" if nots else "") + "</note>")
                    cursor += ticks
                prev_tie_pitches = set(p["pitches"]) if p["tie"] else set()
            end = int(mlen * DIV)
            if cursor < end:
                if primary:
                    for d in split_ticks(end - cursor):
                        out.append(rest_xml(d, voice, staff))
                    cursor = end
            cursor_total = cursor
        out.append("</measure>")
    out.append("</part></score-partwise>")
    return "\n".join(out) + "\n"


def tempo_direction(metronome, qpm) -> str:
    unit, dotted, per = metronome
    per_s = str(int(per)) if float(per).is_integer() else str(per)
    q_s = str(int(qpm)) if float(qpm).is_integer() else str(qpm)
    return ('<direction placement="above"><direction-type><metronome><beat-unit>' + unit + "</beat-unit>" +
            ("<beat-unit-dot/>" if dotted else "") + f"<per-minute>{per_s}</per-minute></metronome></direction-type>"
            f'<staff>1</staff><sound tempo="{q_s}"/></direction>')


def rest_xml(ticks: int, voice: int, staff: int) -> str:
    typ, dot = TYPES[ticks]
    return f"<note><rest/><duration>{ticks}</duration><voice>{voice}</voice><type>{typ}</type>" + ("<dot/>" if dot else "") + f"<staff>{staff}</staff></note>"


def midi_of(name: str) -> int:
    step, alter, octave = pitch(name)
    return (octave + 1) * 12 + STEP_SEMI[step] + alter


H = Fr(1, 2)   # eighth
S = Fr(1, 4)   # sixteenth
T = Fr(1, 8)   # thirty-second
TR = Fr(1, 3)  # triplet eighth


def build() -> List[Tuple[Piece, dict]]:
    pieces: List[Tuple[Piece, dict]] = []

    def reg(p: Piece, **expect):
        pieces.append((p, expect))
        return p

    # M01 waltz 3/4, G major, 96
    p = reg(Piece("M01-waltz-3-4", "M01 Waltz in 3/4", (3, 4), 1, "major", 96, 16))
    bass = ["G2", "D2", "E2", "D2"]
    chords = ["B2 D3 G3", "A2 C3 F#3", "B2 E3 G3", "A2 D3 F#3"]
    tune = "B4 D5 G5 F#5 E5 D5 C5 B4 C5 D5 E5 D5".split()
    for b in range(1, 17):
        p.add(2, 5, b, 0, 3, bass[(b - 1) % 4])
        p.add(2, 6, b, 1, 1, chords[(b - 1) % 4])
        p.add(2, 6, b, 2, 1, chords[(b - 1) % 4])
        for k in range(3):
            p.add(1, 1, b, k, 1, tune[((b - 1) * 3 + k) % 12])

    # M02 Alberti bass 4/4, C major, 112
    p = reg(Piece("M02-alberti-4-4", "M02 Alberti bass", (4, 4), 0, "major", 112, 12))
    alb = [["C3", "G3", "E3", "G3"], ["C3", "A3", "F3", "A3"], ["B2", "G3", "F3", "G3"], ["C3", "G3", "E3", "G3"]]
    mel = [[(1, "E5"), (1, "D5"), (2, "C5")], [(1, "F5"), (1, "A5"), (2, "C6")],
           [(1, "D5"), (1, "F5"), (2, "G5")], [(2, "E5"), (2, "C5")]]
    for b in range(1, 13):
        pat = alb[(b - 1) % 4]
        p.seq(2, 5, b, 0, [(H, x) for x in pat + pat])
        p.seq(1, 1, b, 0, mel[(b - 1) % 4])

    # M03 jig 6/8, G major, dotted quarter = 60
    p = reg(Piece("M03-jig-6-8", "M03 Jig in 6/8", (6, 8), 1, "major", 90, 8, metronome=("quarter", True, 60)))
    prog = ["G", "D", "G", "C", "G", "D", "G", "G"]
    lh = {"G": ("G2", "D3"), "D": ("D2", "A2"), "C": ("C3", "G2")}
    rh = {"G": "D5 B4 G4 B4 D5 G5", "D": "F#5 A5 D5 A4 D5 F#5", "C": "E5 G5 C5 G4 C5 E5"}
    for b, c in enumerate(prog, 1):
        p.add(2, 5, b, 0, Fr(3, 2), lh[c][0])
        p.add(2, 5, b, Fr(3, 2), Fr(3, 2), lh[c][1])
        p.seq(1, 1, b, 0, [(H, x) for x in rh[c].split()])

    # M04 triplets 4/4, C major, 100
    p = reg(Piece("M04-triplets-4-4", "M04 Triplets", (4, 4), 0, "major", 100, 4))
    trip = [["C5", "E5", "G5"], ["D5", "F5", "A5"], ["B4", "D5", "G5"], ["C5", "E5", "G5"]]
    for b in range(1, 5):
        p.add(2, 5, b, 0, 4, ["C3", "D3", "G2", "C3"][b - 1])
        p.seq(1, 1, b, 0, [(TR, x) for x in trip[b - 1] * 4])

    # M05 / M06 32nd-note runs at 120 and 176
    up = "C4 D4 E4 F4 G4 A4 B4 C5 D5 E5 F5 G5 A5 B5 C6 D6".split()
    down = "E6 D6 C6 B5 A5 G5 F5 E5 D5 C5 B4 A4 G4 F4 E4 D4".split()
    for pid, title, qpm in (("M05-32nds-120", "M05 Thirty-seconds at 120", 120),
                            ("M06-32nds-176", "M06 Thirty-seconds at 176", 176)):
        p = reg(Piece(pid, title, (4, 4), 0, "major", qpm, 2))
        p.seq(1, 1, 1, 0, [(T, x) for x in up + down])
        p.add(1, 1, 2, 0, 4, "C5")
        p.seq(2, 5, 1, 0, [(1, "C3 E3 G3")] * 4)
        p.seq(2, 5, 2, 0, [(1, "G2 B2 D3"), (1, "G2 B2 D3"), (2, "C3 E3 G3")])

    # M07 pickup 3/4, F major, 108
    p = reg(Piece("M07-pickup-3-4", "M07 Pickup in 3/4", (3, 4), -1, "major", 108, 8, pickup=Fr(1)))
    p.add(1, 1, 0, 0, 1, "C5")
    prog = ["F", "F", "C", "C", "Bb", "F", "C", "F"]
    bass = {"F": "F2", "C": "C3", "Bb": "Bb2"}
    dy = {"F": "A3 C4", "C": "G3 Bb3", "Bb": "Bb3 D4"}
    mel = [[(1, "A4"), (1, "C5"), (1, "F5")], [(2, "E5"), (1, "D5")], [(1, "C5"), (1, "E5"), (1, "G5")],
           [(2, "G5"), (1, "E5")], [(1, "D5"), (1, "F5"), (1, "Bb5")], [(2, "A5"), (1, "F5")],
           [(1, "G5"), (1, "E5"), (1, "C5")], [(3, "F5")]]
    for b, c in enumerate(prog, 1):
        p.add(2, 5, b, 0, 1, bass[c])
        p.seq(2, 5, b, 1, [(1, dy[c]), (1, dy[c])])
        p.seq(1, 1, b, 0, mel[b - 1])

    # M08 pickup 4/4 (two eighths), D major, 96
    p = reg(Piece("M08-pickup-4-4", "M08 Pickup in 4/4", (4, 4), 2, "major", 96, 8, pickup=Fr(1)))
    p.seq(1, 1, 0, 0, [(H, "A4"), (H, "B4")])
    mel = [[(2, "D5"), (1, "F#5"), (H, "E5"), (H, "D5")], [(2, "A5"), (2, "F#5")],
           [(1, "E5"), (1, "C#5"), (2, "A4")], [(1, "E5"), (1, "G5"), (1, "F#5"), (1, "E5")],
           [(1, "D5"), (1, "B4"), (2, "G5")], [(1, "F#5"), (1, "A5"), (2, "D5")],
           [(1, "C#5"), (1, "E5"), (1, "A5"), (1, "G5")], [(2, "F#5"), (2, "D5")]]
    prog = ["D", "D", "A", "A", "G", "D", "A", "D"]
    bass = {"D": "D2", "A": "A2", "G": "G2"}
    ch = {"D": "D3 F#3 A3", "A": "C#3 E3 A3", "G": "B2 D3 G3"}
    for b, c in enumerate(prog, 1):
        p.seq(1, 1, b, 0, mel[b - 1])
        p.seq(2, 5, b, 0, [(2, bass[c]), (2, ch[c])])

    # M09 syncopation and ties, C major, 100
    p = reg(Piece("M09-syncopation-ties", "M09 Syncopation and ties", (4, 4), 0, "major", 100, 8))
    for pair in range(4):
        b = pair * 2 + 1
        p.add(1, 1, b, 0, H, "C5")
        p.add(1, 1, b, H, 1, "E5")
        p.add(1, 1, b, Fr(3, 2), H, "G5", tie=True)
        p.add(1, 1, b, 2, 1, "G5")
        p.add(1, 1, b, 3, 2, "C6")               # crosses the barline
        p.add(1, 1, b + 1, 1, H, "B5")
        p.add(1, 1, b + 1, Fr(3, 2), 1, "A5")
        p.add(1, 1, b + 1, Fr(5, 2), H, "G5")
        p.add(1, 1, b + 1, 3, 1, "E5")
        p.seq(2, 5, b, 0, [(2, "C3 E3 G3"), (2, "C3 E3 G3")])
        p.seq(2, 5, b + 1, 0, [(2, "G2 B2 D3"), (2, "C3 E3 G3")])

    # M10 dotted rhythms, B-flat major, 92
    p = reg(Piece("M10-dotted", "M10 Dotted rhythms", (4, 4), -2, "major", 92, 8))
    motifs = [["D5", "Eb5", "F5", "D5", "Bb4", "C5", "D5"], ["Eb5", "F5", "G5", "Eb5", "C5", "D5", "Eb5"],
              ["F5", "G5", "A5", "F5", "C5", "D5", "C5"], ["D5", "C5", "Bb4", "D5", "F5", "Eb5", "D5"]]
    bassl = [["Bb2", "F2", "Bb2", "D3"], ["Eb2", "G2", "Bb2", "G2"], ["F2", "A2", "C3", "F2"], ["Bb2", "D3", "F2", "Bb2"]]
    for b in range(1, 9):
        m = motifs[(b - 1) % 4]
        p.seq(1, 1, b, 0, [(Fr(3, 4), m[0]), (S, m[1]), (Fr(3, 4), m[2]), (S, m[3]),
                           (Fr(3, 4), m[4]), (S, m[5]), (1, m[6])])
        p.seq(2, 5, b, 0, [(1, x) for x in bassl[(b - 1) % 4]])

    # M11 harmonic minor, A minor, 84
    p = reg(Piece("M11-harmonic-minor", "M11 Harmonic minor", (3, 4), 0, "minor", 84, 8))
    prog = ["Am", "Dm", "E", "Am"] * 2
    bass = {"Am": "A2", "Dm": "D3", "E": "E2"}
    dy = {"Am": "C3 E3", "Dm": "F3 A3", "E": "G#2 B2"}
    mel = [[(1, "E5"), (1, "A5"), (1, "C6")], [(1, "D6"), (1, "A5"), (1, "F5")],
           [(1, "E5"), (1, "G#5"), (1, "B5")], [(3, "A5")], [(1, "C5"), (1, "B4"), (1, "A4")],
           [(1, "F5"), (1, "E5"), (1, "D5")], [(1, "B4"), (1, "G#4"), (1, "E4")], [(3, "A4")]]
    for b, c in enumerate(prog, 1):
        p.add(2, 5, b, 0, 1, bass[c])
        p.seq(2, 5, b, 1, [(1, dy[c]), (1, dy[c])])
        p.seq(1, 1, b, 0, mel[b - 1])

    # M12 flats, D-flat major, 76
    p = reg(Piece("M12-flats-db", "M12 D-flat major", (4, 4), -5, "major", 76, 8))
    prog = ["Db", "Gb", "Ab", "Db", "Bbm", "Gb", "Ab", "Db"]
    ch = {"Db": "Db3 F3 Ab3", "Gb": "Gb2 Bb2 Db3", "Ab": "Ab2 C3 Eb3", "Bbm": "Bb2 Db3 F3"}
    mel = {"Db": ["F5", "Ab5", "Db6", "Ab5"], "Gb": ["Gb5", "Bb5", "Db6", "Bb5"], "Ab": ["Eb5", "C5", "Ab4", "C5"],
           "Bbm": ["F5", "Db5", "Bb4", "Db5"]}
    for b, c in enumerate(prog, 1):
        p.seq(2, 5, b, 0, [(2, ch[c]), (2, ch[c])])
        p.seq(1, 1, b, 0, [(1, x) for x in mel[c]])

    # M13 sharps and chromatic passing notes, E major, 100
    p = reg(Piece("M13-sharps-chromatic", "M13 E major, chromatic", (4, 4), 4, "major", 100, 8))
    lines = [
        "E5 D#5 E5 F#5 G#5 F#5 E5 B4",
        "A4 A#4 B4 C#5 E5 C#5 B4 A4",
        "B4 C#5 D#5 E5 F#5 A5 G#5 F#5",
        "E5 Dn5 C#5 Cn5 B4 G#4 E4 G#4",
        "C#5 Dn5 D#5 E5 F#5 E5 C#5 A4",
        "G#4 A4 A#4 B4 C#5 D#5 E5 F#5",
        "F#5 E5 D#5 C#5 B4 A#4 B4 D#5",
        "E5 B4 G#4 B4 E5 G#5 E5 B4",
    ]
    prog = ["E", "A", "B", "E", "A", "E", "B", "E"]
    ch = {"E": "E3 G#3 B3", "A": "A2 C#3 E3", "B": "B2 D#3 F#3 A3"}
    for b, c in enumerate(prog, 1):
        p.seq(1, 1, b, 0, [(H, x) for x in lines[b - 1].split()])
        p.seq(2, 5, b, 0, [(2, ch[c]), (2, ch[c])])

    # M14 melody in the bass, C major, 90
    p = reg(Piece("M14-melody-in-bass", "M14 Melody in the bass", (4, 4), 0, "major", 90, 8))
    rhc = ["E4 G4 C5", "F4 A4 C5", "F4 G4 B4", "E4 G4 C5"] * 2
    lhm = [[(1, "C3"), (H, "D3"), (H, "E3"), (1, "G3"), (1, "C4")],
           [(1, "A3"), (H, "G3"), (H, "F3"), (2, "A3")],
           [(H, "G3"), (H, "A3"), (H, "B3"), (H, "G3"), (1, "D3"), (1, "G3")],
           [(1, "C4"), (1, "G3"), (2, "E3")],
           [(H, "E3"), (H, "F3"), (1, "G3"), (1, "A3"), (1, "G3")],
           [(1, "F3"), (1, "A3"), (1, "C4"), (1, "A3")],
           [(1, "B3"), (H, "A3"), (H, "G3"), (1, "F3"), (1, "D3")],
           [(2, "C3"), (2, "C4")]]
    for b in range(1, 9):
        p.add(1, 1, b, 0, 4, rhc[b - 1])
        p.seq(2, 5, b, 0, lhm[b - 1])

    # M15 wide chords, G major, 72
    p = reg(Piece("M15-wide-chords", "M15 Wide chords", (4, 4), 1, "major", 72, 8))
    prog = ["G", "C", "D", "G", "Em", "C", "D", "G"]
    tenth = {"G": "G2 B3", "C": "C3 E4", "D": "D3 F#4", "Em": "E2 G3"}
    rch = {"G": "G4 B4 D5 G5", "C": "G4 C5 E5 G5 C6", "D": "A4 C5 D5 F#5", "Em": "G4 B4 E5 G5"}
    for b, c in enumerate(prog, 1):
        p.seq(2, 5, b, 0, [(2, tenth[c]), (2, tenth[c])])
        p.seq(1, 1, b, 0, [(1, rch[c])] * 4)

    # M16 long notes and rests, F major, 80
    p = reg(Piece("M16-long-notes-rests", "M16 Long notes and rests", (4, 4), -1, "major", 80, 8))
    p.add(1, 1, 1, 0, 4, "F5"); p.add(2, 5, 1, 0, 4, "F3")
    p.add(1, 1, 2, 2, 2, "A4"); p.add(2, 5, 2, 0, 4, "C3")
    p.add(1, 1, 3, 0, 4, "D5")                      # left hand: a whole-bar rest
    p.add(1, 1, 4, 0, 2, "C5"); p.add(2, 5, 4, 0, 4, "F2")
    p.add(2, 5, 5, 0, 4, "Bb2")                     # right hand: a whole-bar rest
    p.add(1, 1, 6, 0, 4, "A4"); p.add(2, 5, 6, 0, 2, "F3")
    p.seq(1, 1, 7, 0, [(2, "G4"), (2, "E5")]); p.add(2, 5, 7, 0, 4, "C3")
    p.add(1, 1, 8, 0, 4, "F4"); p.add(2, 5, 8, 0, 4, "F2")

    # M17 march 2/4, C major, 116
    p = reg(Piece("M17-march-2-4", "M17 March in 2/4", (2, 4), 0, "major", 116, 16))
    for b in range(1, 17):
        g = (b - 1) % 4
        tonic = g in (0, 3)
        p.seq(2, 5, b, 0, [(H, "C3" if tonic else "G2"), (H, "E3 G3" if tonic else "F3 G3"),
                           (H, "G2" if tonic else "D3"), (H, "E3 G3" if tonic else "F3 G3")])
        if b % 2:
            p.seq(1, 1, b, 0, [(H, x) for x in (["E5", "G5", "E5", "C5"] if tonic else ["D5", "F5", "D5", "B4"])])
        else:
            p.seq(1, 1, b, 0, [(S, x) for x in (["D5", "E5", "F5", "G5", "A5", "G5", "F5", "E5"] if tonic
                                               else ["C5", "D5", "E5", "F5", "G5", "F5", "E5", "D5"])])

    # M18 alla breve, G major, half = 72
    p = reg(Piece("M18-alla-breve", "M18 Alla breve", (2, 2), 1, "major", 144, 8, metronome=("half", False, 72)))
    prog = ["G", "D", "G", "C", "G", "D", "C", "G"]
    bass = {"G": ("G2", "D3"), "D": ("D3", "A2"), "C": ("C3", "G2")}
    mel = {"G": "G4 B4 D5 B4", "D": "A4 F#4 D5 A4", "C": "E5 C5 G4 C5"}
    for b, c in enumerate(prog, 1):
        p.seq(2, 5, b, 0, [(2, bass[c][0]), (2, bass[c][1])])
        p.seq(1, 1, b, 0, [(1, x) for x in mel[c].split()])

    # M19 fast 3/8, D minor, eighth = 184
    p = reg(Piece("M19-fast-3-8", "M19 Fast 3/8", (3, 8), -1, "minor", 92, 16, metronome=("eighth", False, 184)))
    prog = ["Dm", "A", "Dm", "A", "Gm", "Dm", "A", "Dm"] * 2
    rh = {"Dm": "D5 F5 A5", "A": "C#5 E5 A5", "Gm": "D5 G5 Bb5"}
    lb = {"Dm": "D3", "A": "A2", "Gm": "G2"}
    for b, c in enumerate(prog, 1):
        notes = rh[c].split()
        if b % 2 == 0:
            notes = notes[::-1]
        p.seq(1, 1, b, 0, [(H, x) for x in notes])
        p.add(2, 5, b, 0, Fr(3, 2), lb[c])

    # M20 12/8, E-flat major, dotted quarter = 66
    p = reg(Piece("M20-compound-12-8", "M20 Compound 12/8", (12, 8), -3, "major", 99, 4, metronome=("quarter", True, 66)))
    prog = [("Eb", "Ab", "Bb", "Eb"), ("Eb", "Cm", "Ab", "Bb"), ("Eb", "Ab", "Eb", "Bb"), ("Ab", "Bb", "Eb", "Eb")]
    rh = {"Eb": "G5 Eb5 Bb4", "Ab": "Ab5 Eb5 C5", "Bb": "F5 D5 Bb4", "Cm": "G5 Eb5 C5"}
    lb = {"Eb": "Eb3", "Ab": "Ab2", "Bb": "Bb2", "Cm": "C3"}
    for b, beats in enumerate(prog, 1):
        for k, c in enumerate(beats):
            p.add(2, 5, b, Fr(3, 2) * k, Fr(3, 2), lb[c])
            p.seq(1, 1, b, Fr(3, 2) * k, [(H, x) for x in rh[c].split()])

    # M21 5/4 (3 + 2), A minor, 100
    p = reg(Piece("M21-five-four", "M21 Five-four", (5, 4), 0, "minor", 100, 6))
    lb = [("A2", "E3"), ("D3", "A2"), ("E2", "B2"), ("A2", "E3"), ("F2", "C3"), ("E2", "A2")]
    mel = ["C5 E5 A5 G5 E5", "F5 A5 D6 C6 A5", "B4 E5 G#5 F#5 E5", "A5 C6 E6 D6 C6", "A5 F5 C5 D5 E5", "E5 C5 B4 G#4 A4"]
    for b in range(1, 7):
        p.add(2, 5, b, 0, 3, lb[b - 1][0])
        p.add(2, 5, b, 3, 2, lb[b - 1][1])
        p.seq(1, 1, b, 0, [(1, x) for x in mel[b - 1].split()])

    # M22 tempo change 120 -> 80 at bar 5, C major
    p = reg(Piece("M22-tempo-change", "M22 Tempo change", (4, 4), 0, "major", 120, 8), tempo_qpm=120)
    p.tempo_changes.append((4, 80))
    mel = ["E5 D5 C5 D5", "E5 E5 E5 G5", "F5 D5 B4 D5", "C5 E5 G5 C6"] * 2
    ch = ["C3 E3 G3", "C3 E3 G3", "G2 B2 D3", "C3 E3 G3"] * 2
    for b in range(1, 9):
        p.seq(1, 1, b, 0, [(1, x) for x in mel[b - 1].split()])
        p.seq(2, 5, b, 0, [(2, ch[b - 1]), (2, ch[b - 1])])

    # M23 repeated sixteenths, C major, 132
    p = reg(Piece("M23-repeated-notes", "M23 Repeated notes", (4, 4), 0, "major", 132, 4))
    ch = ["C3 E3 G3", "B2 D3 F3", "C3 F3 A3", "C3 E3 G3"]
    for b in range(1, 5):
        p.seq(1, 1, b, 0, [(S, "G5")] * 16)
        p.seq(2, 5, b, 0, [(1, ch[b - 1])] * 4)

    # M24 block chords (whole notes), G major, 60
    p = reg(Piece("M24-block-chords", "M24 Block chords", (4, 4), 1, "major", 60, 8))
    prog = ["G", "C", "D", "G", "Em", "C", "D", "G"]
    rch = {"G": "G4 B4 D5", "C": "G4 C5 E5", "D": "F#4 A4 D5", "Em": "G4 B4 E5"}
    lch = {"G": "G2 D3", "C": "C3 G3", "D": "D3 A3", "Em": "E2 B2"}
    for b, c in enumerate(prog, 1):
        p.add(1, 1, b, 0, 4, rch[c])
        p.add(2, 5, b, 0, 4, lch[c])

    return pieces


def expectations(piece: Piece, extra: dict) -> dict:
    exp = {"tempo_qpm": piece.qpm, "key": {"fifths": piece.fifths, "mode": piece.mode},
           "time": list(piece.time), "measures": len(piece.measure_starts()) - 1}
    exp.update(extra)
    return exp


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--check", action="store_true", help="fail if a committed file differs from the generator")
    args = ap.parse_args(argv)
    os.makedirs(OUT, exist_ok=True)
    changed = []
    for piece, _ in build():
        text = write(piece)
        path = os.path.join(OUT, piece.id + ".musicxml")
        old = None
        if os.path.exists(path):
            with open(path, encoding="utf-8") as handle:
                old = handle.read()
        if old != text:
            changed.append(piece.id)
            if not args.check:
                with open(path, "w", encoding="utf-8", newline="\n") as handle:
                    handle.write(text)
    if args.check:
        if changed:
            print("micro corpus differs from the generator: " + ", ".join(changed))
            return 1
        print("micro corpus matches the generator")
        return 0
    print(f"wrote {len(changed)} of {len(build())} micro scores to {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
