"""Readability: computed from one score alone (docs/GOALS/G00 §8.4)."""

from __future__ import annotations

from collections import defaultdict
from fractions import Fraction
from typing import Any, Dict, List, Optional

TOL = Fraction(1, 100)


def bar_integrity_detail(canon) -> Dict[str, Any]:
    """``Import.validate`` overfull/underfull/empty, implicit first/last bar exempt from underfull."""
    ends: Dict[int, Fraction] = {}
    for item in list(canon.notes) + list(canon.rests):
        e = item.pos_q + item.dur_q
        if item.measure not in ends or e > ends[item.measure]:
            ends[item.measure] = e
    bad: List[Dict[str, Any]] = []
    last = len(canon.measures) - 1
    for m in canon.measures:
        if m.index not in ends:
            bad.append({"index": m.index, "kind": "empty"})
            continue
        end, sig = ends[m.index], m.sig_q
        if end > sig + TOL:
            bad.append({"index": m.index, "kind": "overfull"})
        elif end < sig / 2 - TOL and not (m.implicit and m.index in (0, last)):
            bad.append({"index": m.index, "kind": "underfull"})
    return {"checked": len(canon.measures), "ok": len(canon.measures) - len(bad), "bad": bad}


SHARP_ORDER = "FCGDAEB"
ACCIDENTAL_ALTER = {"sharp": 1, "flat": -1, "natural": 0, "double-sharp": 2, "sharp-sharp": 2, "flat-flat": -2,
                    "natural-sharp": 1, "natural-flat": -1}


def signature_alters(fifths: int) -> Dict[str, int]:
    a = {s: 0 for s in "CDEFGAB"}
    for s in (SHARP_ORDER[:fifths] if fifths > 0 else SHARP_ORDER[::-1][:-fifths] if fifths < 0 else ""):
        a[s] = 1 if fifths > 0 else -1
    return a


def accidental_needs(canon) -> Dict[str, int]:
    """Printed accidentals the reader of this score needs, by standard engraving rules.

    Inside a bar, for each staff, step and octave the prevailing alteration starts at the key
    signature's and becomes a note's own alteration once that note is printed with an accidental.
    A note whose alteration differs from the prevailing one needs a printed accidental, or the
    player reads a different pitch from the one the score plays. A tied-over note needs none and
    changes nothing. Independent of the SUT's own writer (§17 M4)."""
    needed = present = missing = spurious = 0
    by_bar: Dict[tuple, list] = defaultdict(list)
    for n in canon.notes:
        by_bar[(n.measure, n.staff)].append(n)
    for (mi, _staff), notes in sorted(by_bar.items()):
        sig = signature_alters(canon.measures[mi].fifths)
        state: Dict[tuple, int] = {}
        for n in sorted(notes, key=lambda x: (x.onset_q, x.id)):
            if n.tie_stop:
                continue
            key = (n.step, n.octave)
            prevailing = state.get(key, sig.get(n.step, 0))
            shown = ACCIDENTAL_ALTER.get(n.accidental or "", None)
            # what a player reading the page takes the pitch to be
            believed = (shown if shown is not None else n.alter) if n.accidental else prevailing
            if believed != n.alter:
                needed += 1          # missing, or an accidental naming another pitch
                missing += 1
            elif n.alter != prevailing:
                needed += 1
                present += 1
            elif n.accidental:
                spurious += 1        # courtesy/cautionary accidentals are not wrong; counted for information
            if n.accidental:
                state[key] = believed   # only a printed accidental changes what the player assumes
    return {"needed": needed, "present": present, "missing": missing, "courtesy": spurious}


def _hand_groups(canon):
    groups = defaultdict(list)
    for s in canon.played():
        groups[(s.hand, s.onset_q)].append(s.midi)
    return groups


# ----------------------------------------------------------------- note shapes (G00 §19 F2)
TYPE_Q = {"breve": Fraction(8), "whole": Fraction(4), "half": Fraction(2), "quarter": Fraction(1),
          "eighth": Fraction(1, 2), "16th": Fraction(1, 4), "32nd": Fraction(1, 8), "64th": Fraction(1, 16),
          "128th": Fraction(1, 32)}
SHAPE_TOL = Fraction(1, 96)


def app_type(type_: Optional[str], dur_q: Fraction) -> str:
    """The glyph the app draws: the file's <type>, else ``typeFromQ(duration)``."""
    if type_:
        return type_
    for q, name in ((4, "whole"), (2, "half"), (1, "quarter"), (Fraction(1, 2), "eighth"), (Fraction(1, 4), "16th"),
                    (Fraction(1, 8), "32nd")):
        if dur_q >= q - Fraction(1, 1000000):
            return name
    return "32nd"


def note_shape_detail(canon) -> Dict[str, Any]:
    """Do the printed shapes say how long the notes and rests last? The app draws a note's head, flag
    and dots from <type> and <dot> (``VF_TYPE[head.type]``) and plays <duration>, so a shape that
    disagrees shows a different rhythm from the one the app plays. A whole-bar rest (``measure="yes"``,
    or a whole rest filling its bar) is a whole rest in every metre."""
    checked, bad, examples = 0, 0, []
    items = [(n.measure, n.pos_q, n.dur_q, n.type, n.dots, n.tuplet, False) for n in canon.notes] + \
            [(r.measure, r.pos_q, r.dur_q, r.type, r.dots, r.tuplet, True) for r in canon.rests if not r.measure_rest]
    for mi, pos, dur, typ, dots, tup, is_rest in items:
        shape = app_type(typ, dur)
        if is_rest and shape == "whole" and abs(dur - canon.measures[mi].len_q) <= SHAPE_TOL:
            continue
        checked += 1
        base = TYPE_Q.get(shape)
        want = None if base is None else base * (2 - Fraction(1, 2 ** dots))
        if want is not None and tup:
            want = want * tup[1] / tup[0]
        if want is None or abs(want - dur) > SHAPE_TOL:
            bad += 1
            if len(examples) < 3:
                examples.append({"bar": mi + 1, "pos": float(pos), "shape": shape, "dots": dots, "lasts": float(dur),
                                 "rest": is_rest})
    return {"checked": checked, "bad": bad, "examples": examples}


# ----------------------------------------------------------------- complete bars (G00 §19 F2, rests)
def bar_completeness_detail(canon) -> Dict[str, Any]:
    """Does every staff fill every bar? Each staff's notes and rests must reach the end of the bar's
    content, and that must be the whole bar — except where a short bar is normal engraving: the first
    and last bar (a pickup and its complement), a bar the file marks implicit, and the two halves of a
    bar split at a repeat (together one whole bar). A trailing rest that is too short leaves a staff's
    bar incomplete; the app draws it short. Stricter than ``bar_integrity`` (the app's own validation,
    which accepts a bar down to half its length)."""
    ends: Dict[tuple, Fraction] = {}
    for it in list(canon.notes) + list(canon.rests):
        k = (it.measure, it.staff)
        e = it.pos_q + it.dur_q
        if k not in ends or e > ends[k]:
            ends[k] = e
    staves = sorted({k[1] for k in ends})
    ms = canon.measures
    last = len(ms) - 1
    content = [max((ends.get((m.index, s), Fraction(0)) for s in staves), default=Fraction(0)) for m in ms]
    checked, bad = 0, []
    for m in ms:
        i = m.index
        if i in (0, last) or m.implicit:
            continue
        checked += 1
        if any(ends.get((i, s)) is None or ends[(i, s)] < content[i] - SHAPE_TOL for s in staves):
            bad.append({"bar": i + 1, "kind": "staff short"})
            continue
        if content[i] >= m.sig_q - SHAPE_TOL:
            continue
        split = (i > 0 and abs(content[i - 1] + content[i] - m.sig_q) <= SHAPE_TOL) or \
                (i < last and abs(content[i] + content[i + 1] - m.sig_q) <= SHAPE_TOL)
        if not split:
            bad.append({"bar": i + 1, "kind": "bar short"})
    return {"checked": checked, "bad": bad}


# ----------------------------------------------------------------- clefs: ledger lines
STEP_INDEX = {"C": 0, "D": 1, "E": 2, "F": 3, "G": 4, "A": 5, "B": 6}
CLEF_BOTTOM_LINE = {"treble": 4 * 7 + 2, "bass": 2 * 7 + 4, "alto": 3 * 7 + 3, "percussion": 4 * 7 + 2}   # E4, G2, F3
HEAVY_LEDGER = 4


def ledger_lines(canon, n) -> int:
    """Ledger lines a note needs on its staff under the clef in force (the app ignores a clef's line
    and octave: F is bass, C alto, anything else treble)."""
    bottom = CLEF_BOTTOM_LINE[canon.clef_at(n.staff, n.measure, n.pos_q)]
    top = bottom + 8
    idx = n.octave * 7 + STEP_INDEX.get(n.step, 0)
    if idx < bottom:
        return (bottom - idx) // 2
    if idx > top:
        return (idx - top) // 2
    return 0


def readability(canon) -> Dict[str, Optional[float]]:
    notes = canon.notes
    n = len(notes)
    bi = bar_integrity_detail(canon)
    groups = _hand_groups(canon)
    acc = accidental_needs(canon)
    shapes = note_shape_detail(canon)
    bc = bar_completeness_detail(canon)
    struck = sum(1 for x in notes if not x.tie_stop)
    return {
        # share of the accidentals the score needs that it prints; 1 when it needs none (nothing is
        # missing). Never null: whether it applies must not depend on what the prediction wrote, or an
        # improvement that removes needless accidentals would read as lost coverage (§17 B1).
        "notation.accidentals.required_recall": acc["present"] / acc["needed"] if acc["needed"] else 1.0,
        "notation.accidentals.missing": float(acc["missing"]),
        # printed accidentals the standard rules do not ask for, per 100 struck notes (clutter, §19 m4)
        "notation.accidentals.courtesy_per_100": 100 * acc["courtesy"] / struck if struck else 0.0,
        # printed shapes that say another length than the note or rest lasts; 1 when there is nothing to check
        "notation.note_shape.consistency": 1 - shapes["bad"] / shapes["checked"] if shapes["checked"] else 1.0,
        "notation.note_shape.mismatches": float(shapes["bad"]),
        "read.bar_completeness": 1 - len(bc["bad"]) / bc["checked"] if bc["checked"] else 1.0,
        "read.ledger_lines.heavy_rate": sum(1 for x in notes if ledger_lines(canon, x) >= HEAVY_LEDGER) / n if n else 0.0,
        "read.bar_integrity": bi["ok"] / bi["checked"] if bi["checked"] else None,
        "read.ties_per_note": sum(1 for x in notes if x.tie_start) / n if n else None,
        "read.tuplets_per_note": sum(1 for x in notes if x.tuplet) / n if n else None,
        "read.accidentals_per_note": sum(1 for x in notes if x.accidental) / n if n else None,
        "read.short_notes_rate": sum(1 for x in notes if x.dur_q <= Fraction(1, 8)) / n if n else None,
        "read.over_span_rate": (sum(1 for g in groups.values() if max(g) - min(g) > 12) / len(groups)) if groups else None,
        "read.max_chord_size": float(max(len(g) for g in groups.values())) if groups else None,
        "read.rests_per_measure": len(canon.rests) / len(canon.measures) if canon.measures else None,
    }


def compute(ctx) -> Dict[str, Optional[float]]:
    pred = readability(ctx["pred"])
    ref = ctx.get("ref_readability") or readability(ctx["ref"])
    out = dict(pred)
    for k, v in pred.items():
        r = ref.get(k)
        out[k + ".delta"] = (v - r) if v is not None and r is not None else None
    return out
