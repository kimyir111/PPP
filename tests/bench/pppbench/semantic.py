"""The meaning of a score, without its serialisation (docs/GOALS/G00 §17 golden policy, §19 F3).

``projection(canon)`` keeps everything a reader or the app's player gets from a MusicXML file, in two
parts:

* **structure** — the frame the music is written in: the bars (count, number as the app keys it,
  length, pickup), the staves, the clefs, which staff and which voice each note and rest is in.
* **music** — what is written in it: metre and key signature per bar, tempo marks, notes (position,
  length, pitch, spelling, printed shape — type and dots —, ties, tuplets, printed accidentals),
  rests (position, length, printed shape), pedal marks.

Only formatting is left out: element order inside a note, whitespace, attribute order, the numbers
given to voices (voices are compared by their content, in the order they appear), stem directions
the app recomputes. reader/2's projection also dropped note types, dots, clefs, rests and bar
numbers; the app draws all of them, so a dot removed or a clef swapped was labelled "same music"
(§19 F3).

``classify(expected, actual)`` says which part changed: ``STRUCTURAL_CHANGE`` when the frame
changed (with or without music changes), ``SEMANTIC_CHANGE`` when only the music did, ``None``
when the two are the same music.
"""

from __future__ import annotations

import json
from collections import Counter, defaultdict
from typing import Any, Dict, List, Optional, Tuple

from . import util

SCHEMA = "ppp.bench-semantic/2"


def _q(x) -> str:
    return str(x)  # Fractions print exactly ("3/2")


def _voice_slots(canon) -> Dict[Tuple[int, int, int], int]:
    """Each voice number within a bar and staff, renumbered by first appearance (1, 2, ...)."""
    order: Dict[Tuple[int, int], List[int]] = defaultdict(list)
    items = sorted([(n.measure, n.staff, n.onset_q, 0, n.id, n.voice) for n in canon.notes] +
                   [(r.measure, r.staff, r.onset_q, 1, i, r.voice) for i, r in enumerate(canon.rests)])
    for m, s, _, _, _, v in items:
        if v not in order[(m, s)]:
            order[(m, s)].append(v)
    return {(m, s, v): order[(m, s)].index(v) + 1 for (m, s), vs in order.items() for v in vs}


def projection(canon) -> Dict[str, Any]:
    slot = _voice_slots(canon)
    return {
        "schema": SCHEMA,
        "structure": {
            "bars": [{"i": m.index, "number": m.app_number, "len": _q(m.len_q), "implicit": m.implicit}
                     for m in canon.measures],
            "staves": canon.staves,
            "clefs": [[c.measure, _q(c.pos_q), c.staff, c.kind] for c in canon.clefs],
            # where each note and rest sits, keyed by what it is: [bar, position, pitch or "rest", staff, voice slot]
            "placement": sorted([[n.measure, _q(n.pos_q), n.midi, n.staff, slot[(n.measure, n.staff, n.voice)]]
                                 for n in canon.notes], key=lambda r: (r[0], r[1], r[2], r[3], r[4])) +
                         sorted([[r.measure, _q(r.pos_q), "rest", r.staff, slot[(r.measure, r.staff, r.voice)]]
                                 for r in canon.rests], key=lambda r: (r[0], r[1], r[3], r[4])),
        },
        "music": {
            "measures": [{"i": m.index, "time": list(m.time), "fifths": m.fifths, "mode": m.mode} for m in canon.measures],
            "tempo": [{"at": _q(t.onset_q), "qpm": round(t.qpm, 3), "kind": t.kind} for t in canon.marks],
            "notes": sorted(([n.measure, _q(n.pos_q), _q(n.dur_q), n.midi, n.step, n.alter, bool(n.tie_start),
                              bool(n.tie_stop), list(n.tuplet) if n.tuplet else None, n.accidental or "",
                              n.type or "", n.dots] for n in canon.notes),
                            key=lambda r: tuple(str(x) for x in r)),
            "rests": sorted(([r.measure, _q(r.pos_q), _q(r.dur_q), r.type or "", r.dots, bool(r.measure_rest),
                              list(r.tuplet) if r.tuplet else None] for r in canon.rests), key=lambda r: tuple(str(x) for x in r)),
            "pedals": [[p.measure, _q(p.pos_q), p.type] for p in canon.pedals],
        },
    }


def digest(canon) -> str:
    # the projection holds only strings, ints, bools and 3-decimal floats: plain sorted JSON is stable
    return util.sha256_bytes(json.dumps(projection(canon), sort_keys=True, ensure_ascii=False,
                                        separators=(",", ":")).encode("utf-8"))[:16]


def _norm(x: Any) -> Any:
    return json.loads(json.dumps(x, sort_keys=True))


def _placement_moved(expected: List, actual: List) -> List[str]:
    """Notes and rests present in both (same bar, position and pitch) that changed staff or voice."""
    def by_key(rows):
        out: Dict[Tuple, List[Tuple]] = defaultdict(list)
        for r in rows:
            out[(r[0], r[1], r[2])].append((r[3], r[4]))
        return out
    e, a = by_key(expected), by_key(actual)
    moved = []
    for k in sorted(set(e) & set(a), key=lambda k: tuple(str(x) for x in k)):
        if sorted(e[k]) != sorted(a[k]) and len(e[k]) == len(a[k]):
            moved.append(f"bar {k[0] + 1} at {k[1]} {k[2]}: staff/voice {sorted(e[k])} -> {sorted(a[k])}")
    return moved


def structure_diff(expected: Dict[str, Any], actual: Dict[str, Any]) -> List[str]:
    es, as_ = expected["structure"], actual["structure"]
    out = []
    if es["bars"] != as_["bars"]:
        if len(es["bars"]) != len(as_["bars"]):
            out.append(f"bars: {len(es['bars'])} -> {len(as_['bars'])}")
        for a, b in zip(es["bars"], as_["bars"]):
            if a != b:
                out.append(f"bar {a['i'] + 1}: {a} -> {b}")
                if len(out) > 6:
                    break
    if es["staves"] != as_["staves"]:
        out.append(f"staves: {es['staves']} -> {as_['staves']}")
    if es["clefs"] != as_["clefs"]:
        out.append(f"clefs: {es['clefs'][:4]} -> {as_['clefs'][:4]}")
    moved = _placement_moved(es["placement"], as_["placement"])
    if moved:
        out.append(f"{len(moved)} note(s)/rest(s) moved to another staff or voice, e.g. {moved[0]}")
    if not moved:
        # a voice added or removed in a bar changes the frame even where no single item moved
        ev = Counter((r[0], r[3], r[4]) for r in es["placement"])
        av = Counter((r[0], r[3], r[4]) for r in as_["placement"])
        if set(ev) != set(av):
            out.append(f"voices per bar and staff: {len(set(ev))} -> {len(set(av))}")
    return out


def music_diff(expected: Dict[str, Any], actual: Dict[str, Any], limit: int = 12) -> List[str]:
    em, am = expected["music"], actual["music"]
    out: List[str] = []
    for a, b in zip(em["measures"], am["measures"]):
        if a != b:
            out.append(f"bar {a['i'] + 1}: {a} -> {b}")
            if len(out) > 4:
                break
    if em["tempo"] != am["tempo"]:
        out.append(f"tempo marks: {em['tempo']} -> {am['tempo']}")
    if em["pedals"] != am["pedals"]:
        out.append(f"pedal marks: {len(em['pedals'])} -> {len(am['pedals'])} "
                   f"(first difference: {next((p for p in em['pedals'] if p not in am['pedals']), None)} / "
                   f"{next((p for p in am['pedals'] if p not in em['pedals']), None)})")
    for label, fields in (("notes", "bar,pos,dur,midi,step,alter,tie_start,tie_stop,tuplet,accidental,type,dots"),
                          ("rests", "bar,pos,dur,type,dots,measure_rest,tuplet")):
        en = Counter(tuple(map(str, r)) for r in em[label])
        an = Counter(tuple(map(str, r)) for r in am[label])
        gone, new = sorted((en - an).elements()), sorted((an - en).elements())
        if gone or new:
            out.append(f"{label}: {len(gone)} only in expected, {len(new)} only in actual")
            for r in gone[:limit // 4]:
                out.append(f"  - bar {int(r[0]) + 1} [{fields}] {list(r)}")
            for r in new[:limit // 4]:
                out.append(f"  + bar {int(r[0]) + 1} [{fields}] {list(r)}")
    return out[:limit + 6]


def classify(expected: Dict[str, Any], actual: Dict[str, Any]) -> Tuple[Optional[str], List[str]]:
    """(label, lines): STRUCTURAL_CHANGE, SEMANTIC_CHANGE or None (the same music)."""
    expected, actual = _norm(expected), _norm(actual)
    # a placement row also changes when a note's pitch or position changes; that is music, so the frame
    # counts as changed only for bars, staves, clefs, items that moved staff or voice, or the voice layout
    s = structure_diff(expected, actual) if expected["structure"] != actual["structure"] else []
    m = music_diff(expected, actual) if expected["music"] != actual["music"] else []
    if expected["music"] != actual["music"] and not m:
        m = ["music differs"]              # never let a difference go unlabelled
    if expected["structure"] != actual["structure"] and not s and not m:
        s = ["structure differs"]
    if s:
        return "STRUCTURAL_CHANGE", ["structure:"] + ["  " + x for x in s] + (["music:"] + ["  " + x for x in m] if m else [])
    if m:
        return "SEMANTIC_CHANGE", m
    return None, []
