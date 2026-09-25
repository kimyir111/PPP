"""Musical correctness of the reader against independent ground truth (docs/GOALS/G00 §17 M6).

Two different questions, kept apart:
* **Parser parity** (T1-C, `run.py conformance`): does this reader read a file the way the app's
  parseMusicXML does? Parity can hold while both are wrong.
* **Musical correctness** (T0, this module, CI): does this reader get what the MusicXML file
  means? The expectations in corpus/correctness/expected.json were written by hand from the
  MusicXML 4.0 specification by an author who did not consult this reader or the app parser.

References are read with ``ottava="standard"`` and must match every fixture. The app's reading
(``ottava="app"``) is checked too: where it departs from the specification, the departure must be
exactly the documented one (APP_DEVIATIONS), and it is reported as a known failure, not hidden.
"""

from __future__ import annotations

import os
from collections import Counter
from fractions import Fraction
from typing import Any, Dict, List

from . import musicxml, util

DIR = os.path.join(util.bench_root(), "corpus", "correctness")
EXPECTED = os.path.join(DIR, "expected.json")

# fixture id -> why the app's reading differs from MusicXML there (known_defects: octave_shift_playback)
# MX-1 (docs/GOALS/MX1_PLAYBACK_CORRECTNESS.md): these two and the "app reading departs from MusicXML on 2 (known)"
# line below model the pre-MX-1 app; rebaselined in MX-2. The app now reads C10/C11 the MusicXML way; the reader's
# ottava="app" mode still reproduces the old app, and the text and the count stay until that rebaseline.
APP_DEVIATIONS = {
    "C10-octave-shift-8va": "the app subtracts an octave under octave-shift type=\"down\" (MusicXML: pitch data is sounding)",
    "C11-octave-shift-8vb": "the app adds an octave under octave-shift type=\"up\" (MusicXML: pitch data is sounding)",
}


def _f(s) -> Fraction:
    return Fraction(str(s))


def compare_fixture(fx: Dict[str, Any], ottava: str) -> List[str]:
    """Differences between the reader and one fixture's expectations (empty = correct)."""
    exp = fx["expect"]
    try:
        c = musicxml.read_score(os.path.join(DIR, fx["file"]), ottava=ottava)
    except musicxml.ReaderError as exc:
        return [f"reader error {exc.code}"]
    out: List[str] = []
    if list(c.primary_time()) != list(exp["time"]):
        out.append(f"time {list(c.primary_time())} != {exp['time']}")
    m0 = c.measures[0]
    if m0.fifths != exp["key"]["fifths"]:
        out.append(f"fifths {m0.fifths} != {exp['key']['fifths']}")
    mode = m0.mode if m0.mode_explicit else None
    if mode != exp["key"]["mode"]:
        out.append(f"mode {mode} != {exp['key']['mode']}")
    em = exp["measures"]
    if len(c.measures) != len(em):
        out.append(f"{len(c.measures)} measures != {len(em)}")
    for m, e in zip(c.measures, em):
        if m.len_q != _f(e["len_q"]) or m.implicit != e["implicit"]:
            out.append(f"measure {m.index + 1}: len {m.len_q} implicit {m.implicit} != {e['len_q']} {e['implicit']}")
    got = sorted((s.onset_q, s.staff, s.midi, s.dur_q, s.step, s.alter) for s in c.sounding)
    want = sorted((_f(s["onset_q"]), s["staff"], s["midi"], _f(s["dur_q"]), s["step"], s["alter"]) for s in exp["sounding"])
    if got != want:
        g, w = Counter(got), Counter(want)
        extra, missing = list((g - w).elements()), list((w - g).elements())
        out.append(f"sounding differs: {len(missing)} expected key presses missing (e.g. {_fmt(missing[:2])}), "
                   f"{len(extra)} unexpected (e.g. {_fmt(extra[:2])})")
    if c.diagnostics.get("grace_skipped", 0) != exp["grace_notes"]:
        out.append(f"grace notes {c.diagnostics.get('grace_skipped')} != {exp['grace_notes']}")
    t = exp["tempo"]
    if c.sound_qpm != (float(t["sound_qpm"]) if t["sound_qpm"] is not None else None):
        out.append(f"sound tempo {c.sound_qpm} != {t['sound_qpm']}")
    if c.printed_qpm != (float(t["printed_qpm"]) if t["printed_qpm"] is not None else None):
        out.append(f"printed tempo {c.printed_qpm} != {t['printed_qpm']}")
    if sorted(round(m.qpm, 6) for m in c.marks) != sorted(round(float(x), 6) for x in t["marks_qpm"]):
        out.append(f"tempo marks {sorted(m.qpm for m in c.marks)} != {sorted(t['marks_qpm'])}")
    return out


def _fmt(rows) -> str:
    return ", ".join(f"midi {r[2]} at {r[0]} for {r[3]} ({r[4]}{r[5]:+d}, staff {r[1]})" for r in rows)


def check() -> Dict[str, Any]:
    """{fixtures, standard: {id: diffs}, app: {id: diffs}, failures: [...], app_deviations: {...}}."""
    doc = util.load_json(EXPECTED)
    std, app = {}, {}
    for fx in doc["fixtures"]:
        std[fx["id"]] = compare_fixture(fx, "standard")
        app[fx["id"]] = compare_fixture(fx, "app")
    failures = [f"{fid} (reference reading): {d}" for fid, ds in std.items() for d in ds]
    for fid, ds in app.items():
        if fid in APP_DEVIATIONS:
            if not ds:
                failures.append(f"{fid} (app reading): expected the documented deviation, found none — update APP_DEVIATIONS")
        else:
            failures += [f"{fid} (app reading): {d}" for d in ds]
    return {"fixtures": len(doc["fixtures"]), "standard": std, "app": app, "failures": failures,
            "app_deviations": {fid: {"why": why, "diffs": app.get(fid, [])} for fid, why in APP_DEVIATIONS.items()}}


def cli(args) -> int:
    r = check()
    for fid in r["standard"]:
        s, a = r["standard"][fid], r["app"][fid]
        tag = "ok " if not s else "BAD"
        app_tag = "same" if not a else ("KNOWN_DEVIATION" if fid in APP_DEVIATIONS else "DIFFERS")
        print(f"{tag} {fid:32} reference reading: {'correct' if not s else '; '.join(s)} · app reading: {app_tag}")
    out = os.path.join(util.bench_root(), "out", "correctness", "report.json")
    util.dump_json(r, out)
    print(f"musical correctness: {r['fixtures'] - sum(1 for v in r['standard'].values() if v)}/{r['fixtures']} fixtures "
          f"read correctly; app reading departs from MusicXML on {len(APP_DEVIATIONS)} (known) · {util.rel(out)}")
    for f in r["failures"]:
        print("FAIL " + f)
    return 1 if r["failures"] else 0
