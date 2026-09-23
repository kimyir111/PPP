"""The notation a MusicXML file prints beyond what the app reads (docs/GOALS/G01 §16.2, L1+).

The G0 reader and its semantic projection judge what PPP shows and plays. A round trip through ScoreGraph
must also keep the notation PPP does not use yet: slurs, dynamics, wedges, articulations, ornaments,
fermatas, fingerings, arpeggios, chord symbols, lyrics, words, rehearsal marks, grace notes, beams, stems,
octave shifts, pedal marks, tuplet brackets, bar lines, repeats, endings, part names, title, composer,
transposition — and ties, whose start and stop the projection also reads.

``inventory(src)`` reads a file independently of the ScoreGraph code (Python stdlib only) into a multiset of
rows ``(part index, measure index, kind, position in quarters, staff, attributes…)`` (None where a field does not
apply: a title has no part, a part name no measure). Two files carry the same notation when their inventories
are equal. ``kind(row)`` is ``row[2]``.

What the rows leave out on purpose (ScoreGraph's model, docs/GOALS/G01 §5 and Appendix A):

* numbers that only pair marks (slur, wedge, octave-shift and tuplet ``number``): the export numbers them
  again by overlap;
* a pedal mark's staff and placement: a Pedal spanner has neither;
* bar lines, repeats and endings of parts after the first: the bar lines are the shared timeline's (the app
  reads them from the first part too), and one location's bar lines in one measure merge the way the app
  merges them (a later one overrides);
* defaults the ScoreGraph schema states: a tuplet bracket with no ``bracket`` attribute is shown, with no
  ``show-number`` it shows the actual number; a fermata with no ``type`` is upright; a lyric with no
  ``number`` is verse 1; a backward repeat with no ``times`` plays twice; a direction with no ``<staff>`` in
  a one-staff part, and an octave shift with no ``<staff>`` in any part, is on staff 1 (MusicXML's default;
  an Ottava names its staff);
* a note's articulations are a set (``event.arts`` has no duplicates, §5.6): ``<staccato/><staccato/>`` is
  one staccato;
* what Appendix A drops and the import reports (``<print>`` layout, ``<defaults>``, ``<credit>``, fonts,
  colours, positions, ``<dashes>``, wavy lines, ``<sound dynamics>`` …).
"""

from __future__ import annotations

import xml.etree.ElementTree as ET
from collections import Counter
from fractions import Fraction
from typing import Any, List, Optional, Tuple

from .musicxml import _strip_ns, js_float, js_int, read_bytes

NOTE_ORNAMENTS = ("trill-mark", "mordent", "inverted-mordent", "turn", "inverted-turn", "tremolo", "shake", "schleifer")
ARTICULATIONS = ("staccato", "staccatissimo", "tenuto", "accent", "strong-accent", "spiccato", "stress", "unstress",
                 "detached-legato", "breath-mark", "caesura")
DYNAMICS = {"pppppp", "ppppp", "pppp", "ppp", "pp", "p", "mp", "mf", "f", "ff", "fff", "ffff", "fffff", "ffffff",
            "sf", "sfz", "sffz", "sfp", "sfpp", "fp", "fz", "rf", "rfz", "pf", "n", "other-dynamics"}
BAR_STYLES = {"regular", "dotted", "dashed", "heavy", "light-light", "light-heavy", "heavy-light", "heavy-heavy",
              "tick", "short", "none"}


def _root(src: Any) -> ET.Element:
    if isinstance(src, (bytes, bytearray)):
        data = bytes(src)
    elif isinstance(src, str) and src.lstrip().startswith("<"):
        data = src.encode("utf-8")
    else:
        data = read_bytes(src)
    root = ET.fromstring(data)
    _strip_ns(root)
    return root


def _t(el: Optional[ET.Element]) -> Optional[str]:
    return None if el is None else (el.text or "").strip()


def _ending_numbers(attr: Optional[str], text: str) -> Tuple[int, ...]:
    def nums(s):
        out = []
        cur = ""
        for ch in (s or "") + " ":
            if ch.isdigit():
                cur += ch
            else:
                if cur and int(cur) > 0:
                    out.append(int(cur))
                cur = ""
        return out
    return tuple(nums(attr) or nums(text))


def inventory(src: Any) -> Counter:
    root = _root(src)
    rows: Counter = Counter()
    once = set()

    def add(row: Tuple) -> None:
        rows[row] += 1

    def add_once(row: Tuple) -> None:
        if row not in once:
            once.add(row)
            rows[row] += 1

    work = root.find("work")
    if work is not None and work.find("work-title") is not None:
        add((None, None, "work-title", None, None, _t(work.find("work-title"))))
    if root.find("movement-title") is not None:
        add((None, None, "movement-title", None, None, _t(root.find("movement-title"))))
    ident = root.find("identification")
    if ident is not None:
        seen = set()
        for cr in ident.findall("creator"):
            ty = cr.attrib.get("type")
            ty = "lyricist" if ty == "poet" else ty
            if ty in ("composer", "lyricist", "arranger") and ty not in seen:
                seen.add(ty)
                add((None, None, "creator", None, None, ty, _t(cr)))
    part_list = root.find("part-list")
    names = {}
    if part_list is not None:
        for sp in part_list.findall("score-part"):
            names[sp.attrib.get("id")] = (_t(sp.find("part-name")) or "", _t(sp.find("part-abbreviation")))

    for pi, part in enumerate(p for p in root if p.tag == "part"):
        one_staff = not any((js_int(_t(st) or "1") or 1) >= 2 for st in part.iter("staves"))
        name, abbr = names.get(part.attrib.get("id"), ("", None))
        add((pi, None, "part-name", None, None, name))
        if abbr:
            add((pi, None, "part-abbreviation", None, None, abbr))
        divisions = Fraction(1)
        for mi, measure in enumerate(m for m in part if m.tag == "measure"):
            cursor = Fraction(0)
            last_onset = Fraction(0)
            bars = {}
            endings = set()
            for el in measure:
                tag = el.tag
                if tag == "attributes":
                    d = js_float(_t(el.find("divisions")) or "")
                    if d and d > 0:
                        divisions = d
                    tr = el.find("transpose")
                    if tr is not None:
                        add_once((pi, None, "transpose", None, None, js_int(_t(tr.find("chromatic")) or "0") or 0,
                                  js_int(_t(tr.find("diatonic")) or "0") or 0, js_int(_t(tr.find("octave-change")) or "0") or 0))
                elif tag == "backup":
                    cursor -= (js_float(_t(el.find("duration")) or "") or 0) / divisions
                    if cursor < 0:
                        cursor = Fraction(0)
                elif tag == "forward":
                    cursor += (js_float(_t(el.find("duration")) or "") or 0) / divisions
                elif tag == "note":
                    grace = el.find("grace")
                    chord = el.find("chord") is not None
                    onset = last_onset if chord else cursor
                    staff = js_int(_t(el.find("staff")) or "1") or 1
                    pos = str(onset)
                    def base(kind, _pos=pos, _staff=staff):
                        return (pi, mi, kind, _pos, _staff)
                    if grace is not None:
                        add(base("grace") + (grace.attrib.get("slash") == "yes",))
                    for b in el.findall("beam"):
                        add(base("beam") + (b.attrib.get("number", "1"), _t(b)))
                    st = el.find("stem")
                    if st is not None:
                        add(base("stem") + (_t(st),))
                    pitch = el.find("pitch")
                    pkey = (_t(pitch.find("step")), js_int(_t(pitch.find("alter")) or "0") or 0, js_int(_t(pitch.find("octave")) or "4")) if pitch is not None else None
                    for t in el.findall("tie"):
                        add(base("tie") + (t.attrib.get("type"), pkey))
                    for nots in el.findall("notations"):
                        for n in nots:
                            if n.tag == "slur":
                                ty = n.attrib.get("type")
                                if ty in ("start", "stop"):
                                    add(base("slur") + (ty, n.attrib.get("placement") if ty == "start" else None,
                                                n.attrib.get("line-type") if ty == "start" else None))
                            elif n.tag == "tuplet":
                                ty = n.attrib.get("type")
                                if ty == "start":
                                    add(base("tuplet") + (ty, n.attrib.get("bracket", "yes"), n.attrib.get("show-number", "actual"),
                                                n.attrib.get("placement")))
                                elif ty == "stop":
                                    add(base("tuplet") + (ty,))
                            elif n.tag == "articulations":
                                for tag in sorted({a.tag for a in n if a.tag in ARTICULATIONS}):
                                    add(base("articulation") + (tag,))
                            elif n.tag == "ornaments":
                                for o in n:
                                    if o.tag in NOTE_ORNAMENTS:
                                        add(base("ornament") + (o.tag, _t(o) if o.tag == "tremolo" else None))
                                    elif o.tag == "accidental-mark":
                                        add(base("ornament-accidental") + (_t(o),))
                            elif n.tag == "fermata":
                                add(base("fermata") + (_t(n) or "normal", n.attrib.get("type") == "inverted"))
                            elif n.tag == "arpeggiate":
                                add(base("arpeggiate") + (n.attrib.get("direction"),))
                            elif n.tag == "non-arpeggiate":
                                add(base("non-arpeggiate"))
                            elif n.tag == "dynamics":
                                for dy in n:
                                    if dy.tag in DYNAMICS:
                                        add(base("note-dynamics") + (dy.tag, _t(dy) if dy.tag == "other-dynamics" else None,
                                                    n.attrib.get("placement")))
                            elif n.tag == "technical":
                                for tc in n:
                                    if tc.tag == "fingering":
                                        add(base("fingering") + (_t(tc), tc.attrib.get("substitution") == "yes",
                                                    tc.attrib.get("alternate") == "yes", tc.attrib.get("placement"), pkey))
                                    elif tc.tag in ("string", "fret"):
                                        add(base(tc.tag) + (_t(tc), pkey))
                    for ly in el.findall("lyric"):
                        txt = ly.find("text")
                        if txt is not None:
                            add(base("lyric") + (js_int(ly.attrib.get("number") or "1") or 1, _t(ly.find("syllabic")),
                                        txt.text or "", ly.find("extend") is not None))
                    if grace is None and not chord:
                        last_onset = cursor
                        cursor += (js_float(_t(el.find("duration")) or "") or 0) / divisions
                elif tag in ("direction", "harmony"):
                    off = el.find("offset")
                    at = cursor + ((js_float(_t(off) or "") or 0) / divisions if off is not None else 0)
                    staff_el = el.find("staff")
                    staff = (js_int(_t(staff_el) or "") or 1) if staff_el is not None else (1 if one_staff else 0)
                    def base(kind, _at=at, _staff=staff):
                        return (pi, mi, kind, str(_at), _staff)
                    if tag == "harmony":
                        rt = el.find("root")
                        kind = el.find("kind")
                        bass = el.find("bass")
                        degrees = tuple((_t(d.find("degree-value")), _t(d.find("degree-alter")), _t(d.find("degree-type")))
                                        for d in el.findall("degree"))
                        add(base("harmony") + (_t(rt.find("root-step")) if rt is not None else None,
                                    js_int(_t(rt.find("root-alter")) or "0") or 0 if rt is not None else 0,
                                    _t(kind), kind.attrib.get("text") if kind is not None else None,
                                    _t(bass.find("bass-step")) if bass is not None else None,
                                    (js_int(_t(bass.find("bass-alter")) or "0") or 0) if bass is not None else 0, degrees,
                                    el.attrib.get("placement")))
                        continue
                    placement = el.attrib.get("placement")
                    for dt in el.findall("direction-type"):
                        for k in dt:
                            if k.tag == "words":
                                add(base("words") + (k.text or "",))
                            elif k.tag == "rehearsal":
                                add(base("rehearsal") + (k.text or "",))
                            elif k.tag == "dynamics":
                                for dy in k:
                                    if dy.tag in DYNAMICS:
                                        add(base("dynamics") + (dy.tag, _t(dy) if dy.tag == "other-dynamics" else None, placement))
                            elif k.tag == "wedge" and k.attrib.get("type") in ("crescendo", "diminuendo", "stop"):
                                add(base("wedge") + (k.attrib.get("type"), k.attrib.get("niente") == "yes"))
                            elif k.tag == "pedal" and k.attrib.get("type") in ("start", "stop", "change"):
                                add((pi, mi, "pedal", str(at), None, k.attrib.get("type"), k.attrib.get("line"), k.attrib.get("sign") == "no"))
                            elif k.tag == "octave-shift" and k.attrib.get("type") in ("up", "down", "stop"):
                                add((pi, mi, "octave-shift", str(at), staff or 1, k.attrib.get("type"), js_int(k.attrib.get("size") or "8") or 8))
                elif tag == "barline" and pi == 0:
                    loc = el.attrib.get("location", "right")
                    b = bars.setdefault(loc, {})
                    style = _t(el.find("bar-style"))
                    if style in BAR_STYLES:
                        b["style"] = style
                    rep = el.find("repeat")
                    if rep is not None:
                        d = rep.attrib.get("direction")
                        b["repeat"] = d
                        if d == "backward":
                            b["times"] = js_int(rep.attrib.get("times") or "2") or 2
                    end = el.find("ending")
                    if end is not None:
                        said = "".join(end.itertext()).strip()
                        endings.add(("ending", end.attrib.get("type"), _ending_numbers(end.attrib.get("number"), said),
                                     said if end.attrib.get("type") == "start" else None))
            for loc, b in sorted(bars.items()):
                if b:
                    add((pi, mi, "barline", None, None, loc, b.get("style"), b.get("repeat"), b.get("times")))
            for e in sorted(endings, key=str):
                add((pi, mi, "ending", None, None) + e[1:])
    return rows


def kind(row: Tuple) -> str:
    return row[2]


def diff(a: Counter, b: Counter, limit: int = 8) -> List[str]:
    """Rows only in a (-) and only in b (+)."""
    gone, new = sorted((a - b).elements(), key=str), sorted((b - a).elements(), key=str)
    return ["- " + str(r) for r in gone[:limit]] + ["+ " + str(r) for r in new[:limit]] + \
        ([f"... {len(gone)} gone, {len(new)} new"] if len(gone) > limit or len(new) > limit else [])
