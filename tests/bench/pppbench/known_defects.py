"""Known production failures in the catalogue PPP ships (docs/GOALS/G00 §17 M8, M9).

G0 does not fix them. It measures them, every run, so that they stay visible and so that a fix
(or a new defect) shows up as a number: every suite's results.json carries ``known_failures``,
every summary.md lists them, and ``check`` fails when a count grows.

Scope: every committed score under catalog/ and samples/ — what users can open — whether or not it
is a benchmark reference. Each class says how many files and items are affected, out of how many
in scope, and what the user gets.
"""

from __future__ import annotations

import os
from collections import Counter, defaultdict
from typing import Any, Dict, List

from . import musicxml, util
from .metrics.readability import (ACCIDENTAL_ALTER, bar_completeness_detail, bar_integrity_detail, note_shape_detail,
                                  signature_alters)
from .metrics.structure import measure_numbers

AUDIT_VERSION = "known-defects/3"   # /2: note shapes, incomplete bars, bar numbering (G00 §19 F2)
                                    # /3: a bar split in two is excused only at a repeat sign, an ending or a
                                    #     double/final bar line (G00 §21 S-m2)
CACHE = os.path.join(util.bench_root(), ".cache", "known-defects.json")


def scope_files(tracked=None) -> List[str]:
    tracked = util.tracked_files() if tracked is None else tracked
    return sorted(f for f in tracked
                  if (f.startswith("catalog/") and f.endswith((".musicxml", ".mxl")))
                  or (f.startswith("samples/") and f.endswith(".musicxml")))


def collection(path: str) -> str:
    parts = path.split("/")
    if parts[0] == "samples":
        return "samples"
    if parts[1] == "hymns":
        return "hymns"
    if parts[1] == "method":
        return "method/" + parts[2]
    return "catalog"


def _pitch_errors(canon) -> Counter:
    """Notes whose printed page names another pitch than the one the app plays, by cause."""
    out: Counter = Counter()
    by_bar: Dict[tuple, list] = defaultdict(list)
    for n in canon.notes:
        by_bar[(n.measure, n.staff)].append(n)
    for (mi, _staff), notes in by_bar.items():
        sig = signature_alters(canon.measures[mi].fifths)
        state: Dict[tuple, int] = {}
        for n in sorted(notes, key=lambda x: (x.onset_q, x.id)):
            if n.tie_stop:
                continue
            key = (n.step, n.octave)
            if n.accidental:
                shown = ACCIDENTAL_ALTER.get(n.accidental)
                believed = shown if shown is not None else n.alter
                if believed != n.alter:
                    out["wrong_accidental"] += 1
                state[key] = believed
            elif key in state:
                if state[key] != n.alter:
                    out["bar_accidental_not_carried"] += 1   # an earlier accidental in the bar should still hold
            elif sig.get(n.step, 0) != n.alter:
                out["key_signature_ignored"] += 1            # the key signature says one pitch, the file plays another
    return out


def _unclosed_ties(canon) -> int:
    """Tie starts the app cannot continue: no tie-stop note of that pitch where the tied note ends."""
    stops = {(n.midi, n.onset_q) for n in canon.notes if n.tie_stop}
    return sum(1 for n in canon.notes if n.tie_start and (n.midi, n.onset_q + n.dur_q) not in stops)


def audit_file(path: str) -> Dict[str, Any]:
    data = musicxml.read_bytes(os.path.join(util.repo_root(), path))
    app = musicxml.read_score(data, source_path=path, ottava="app")
    pe = _pitch_errors(app)
    bi = bar_integrity_detail(app)
    sq, pq = app.sound_qpm, app.printed_qpm
    mn = measure_numbers(app)
    return {
        "note_shape_mismatches": note_shape_detail(app)["bad"],
        "incomplete_bars": len(bar_completeness_detail(app)["bad"]),
        "bar_numbering_wrong": int(mn["struct.measure_numbers.valid"] < 1.0 or mn["struct.measure_numbers.app_onset_accuracy"] < 1.0),
        "notes": len(app.notes),
        "fifths": app.measures[0].fifths,
        "key_signature_ignored": pe["key_signature_ignored"],
        "bar_accidental_not_carried": pe["bar_accidental_not_carried"],
        "wrong_accidental": pe["wrong_accidental"],
        "tie_without_stop": _unclosed_ties(app),
        "ties": sum(1 for n in app.notes if n.tie_start),
        "bars": bi["checked"],
        "bad_bars": len(bi["bad"]),
        "octave_shift": bool(app.diagnostics.get("octave_shift")),
        "ottava_shifted_notes": app.diagnostics.get("ottava_shifted_notes", 0),
        "tempo_marks_disagree": bool(sq and pq and abs(sq - pq) > 0.01 * pq),
        "grace_notes": app.diagnostics.get("grace_skipped", 0),
    }


def _files(tracked=None) -> Dict[str, Dict[str, Any]]:
    paths = scope_files(tracked)
    shas = {p: util.content_sha256(os.path.join(util.repo_root(), p)) for p in paths}
    cache = util.load_json(CACHE) if os.path.exists(CACHE) else {}
    if cache.get("version") != AUDIT_VERSION:
        cache = {"version": AUDIT_VERSION, "files": {}}
    out, dirty = {}, False
    for p in paths:
        hit = cache["files"].get(p)
        if hit and hit.get("sha256") == shas[p]:
            out[p] = hit["audit"]
            continue
        out[p] = audit_file(p)
        cache["files"][p] = {"sha256": shas[p], "audit": out[p]}
        dirty = True
    if dirty:
        cache["files"] = {p: cache["files"][p] for p in paths}
        util.dump_json(cache, CACHE)
    return out


CLASSES = [
    # id, title, item field, unit, applies(file) -> bool, impact
    ("key_signature_playback", "Notes played against the printed key signature (hymn converter)", "key_signature_ignored", "notes",
     lambda a: a["fifths"] != 0,
     "The page shows the key signature (e.g. F# in G major) but the note has no <alter> and no printed accidental, so the "
     "app plays another note (F natural) than the page shows. Cause in the hymns: catalog/hymns/abc-to-musicxml.js writes "
     "<alter> only for explicit ABC accidentals; in the other files a natural sign is missing."),
    ("tie_without_stop", "Tie starts that never stop", "tie_without_stop", "ties", lambda a: a["ties"] > 0,
     "The tied note is struck again instead of held (the app joins a tie only at a matching tie-stop). "
     "Cause: abc-to-musicxml.js writes <tie type=\"start\"> and never the stop."),
    ("bar_accidental_not_carried", "In-bar accidentals that are not carried", "bar_accidental_not_carried", "notes",
     lambda a: a["notes"] > 0,
     "An accidental earlier in the bar still holds on the page, but the file plays the note without it."),
    ("wrong_printed_accidental", "Printed accidentals naming another pitch", "wrong_accidental", "notes",
     lambda a: a["notes"] > 0, "The printed accidental and the played pitch disagree."),
    # MX-1: this class models the pre-MX-1 app; rebaselined in MX-2. The app now plays <pitch> under an octave line
    # (these 30 files and 2,229 notes); the count and the text stay in known_failures until then, so no baseline moves.
    ("octave_shift_playback", "8va/8vb passages read the app's way", "ottava_shifted_notes", "notes",
     lambda a: a["octave_shift"],
     "MusicXML keeps the sounding pitch in <pitch> and marks an 8va with octave-shift type=\"down\"; the app treats "
     "<pitch> as written and subtracts an octave, so these notes very likely play an octave low (melodic steps at the "
     "8va boundaries: median 3 semitones as written, 10 the app's way). Correctness fixture C10/C11 records the "
     "deviation; confirm once by ear in the app."),
    ("bar_integrity", "Overfull, underfull or empty bars", "bad_bars", "bars", lambda a: a["bars"] > 0,
     "Bars whose content does not fit the time signature (the app's own validation rule)."),
    ("tempo_marks_disagree", "Files whose <sound tempo> and printed tempo disagree", "tempo_marks_disagree", "files",
     lambda a: True, "The app's score tempo (practice tempo, metronome, tempo %) is the <sound tempo>; its player "
                     "follows the printed mark written at the same place (PianoScore.tempoMap). The two disagree."),
    ("grace_notes_dropped", "Grace notes the app skips", "grace_notes", "notes", lambda a: a["notes"] > 0,
     "parseMusicXML skips <grace> notes: they are neither shown nor played. A known limitation, not a data error."),
    ("note_shape_mismatch", "Printed note shapes that say another length", "note_shape_mismatches", "notes/rests",
     lambda a: a["notes"] > 0,
     "The app draws a note from <type> and <dot> and plays its <duration>; where they disagree the page shows another "
     "rhythm than the app plays (e.g. an undotted whole note that lasts six beats)."),
    ("incomplete_bars", "Bars a staff does not fill", "incomplete_bars", "bars", lambda a: a["bars"] > 0,
     "A staff's notes and rests stop before the bar ends, or a bar is short (not a pickup, its complement, or half of "
     "a bar split at a repeat sign, an ending or a double/final bar line): the app draws the bar short. Stricter "
     "than bar_integrity, the app's own check."),
    ("bar_numbering", "Bar numbers that do not count up by one", "bar_numbering_wrong", "files", lambda a: a["bars"] > 0,
     "The app finds bars by number: a repeated number lays bars over each other, a skipped or reordered one shows "
     "wrong bar numbers."),
]

STATUS = {"grace_notes_dropped": "KNOWN_LIMITATION"}


def audit(tracked=None) -> Dict[str, Any]:
    files = _files(tracked)
    classes = {}
    for cid, title, field, unit, applies, impact in CLASSES:
        in_scope = [p for p, a in files.items() if applies(a)]
        hit = {p: int(files[p][field]) for p in in_scope if files[p][field]}
        by_col = Counter(collection(p) for p in hit)
        classes[cid] = {
            "title": title, "status": (STATUS.get(cid, "KNOWN_FAILURE") if hit else "NONE"), "unit": unit,
            "files_affected": len(hit), "files_in_scope": len(in_scope), "items": sum(hit.values()),
            "by_collection": dict(sorted(by_col.items())),
            "in_scope_by_collection": dict(sorted(Counter(collection(p) for p in in_scope).items())),
            "examples": sorted(hit)[:5], "impact": impact,
        }
    return {"version": AUDIT_VERSION, "scope": "committed scores under catalog/ and samples/",
            "files_scanned": len(files), "files_by_collection": dict(sorted(Counter(collection(p) for p in files).items())),
            "classes": classes}


def summary_lines(kf: Dict[str, Any]) -> List[str]:
    rows = ["| class | status | affected | items | impact |", "| --- | --- | --- | --- | --- |"]
    for cid, c in kf["classes"].items():
        if c["status"] == "NONE":
            continue
        cols = ", ".join(f"{k} {v}/{c['in_scope_by_collection'].get(k, 0)}" for k, v in c["by_collection"].items())
        rows.append(f"| `{cid}` {c['title']} | **{c['status']}** | {c['files_affected']}/{c['files_in_scope']} files "
                    f"({cols}) | {c['items']} {c['unit']} | {c['impact']} |")
    return rows
