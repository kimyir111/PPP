#!/usr/bin/env python3
"""G0 independent review (2026-09-22): adversarial checks of the benchmark itself.

Not part of `npm run test:bench`. Each check states what a sound benchmark should do and reports OK or
GAP for the current code. Exit 1 while any GAP remains. Findings: docs/GOALS/G00_QUALITY_FOUNDATION.md,
"Independent Review".

    python tests/bench/review/adversarial.py                      # every offline check (~6 min)
    python tests/bench/review/adversarial.py --only mutations     # mutations | oracle | lock | data | sqi | correctness
    python tests/bench/review/adversarial.py --conformance http://127.0.0.1:8777
                                          # also the T1-C blind-spot check (npm start + puppeteer)

Outputs go to tests/bench/out/review/ (git-ignored). audio-score.js is never modified: mutants are
written under out/review/mutants/.

Extended by the G0 fixer: five FIX-* mutations the review did not try, a musical-correctness check,
and explicit pass criteria for the five checks the review reported as GAP unconditionally (each
criterion is commented where it is applied, and tests/bench/review/README.md lists the changes).
The review's own mutations and expectations are unchanged.
"""

from __future__ import annotations

import argparse
import contextlib
import io
import os
import re
import sys
import types
import xml.etree.ElementTree as ET
from collections import Counter

BENCH = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BENCH)

from pppbench import (compare, corpus, evaluate, golden, musicxml, perform, private, runner,  # noqa: E402
                      stages, suite as suite_mod, sut as sut_mod, util)

util.setup_stdio()
REPO = util.repo_root()
OUT = os.path.join(BENCH, "out", "review")
RESULTS: list = []


def report(check: str, ok: bool, detail: str) -> None:
    RESULTS.append((check, ok, detail))
    print(f"{'OK ' if ok else 'GAP'}  {check}: {detail}")


# --------------------------------------------------------------------------- 1. SUT mutations
# Each is a user-visible regression the CI gate should call a REGRESSION on the metric layer.
MUTATIONS = {
    "ADV-NO-TEMPO": (  # the app then plays at its default 84 qpm (Score.tempo = round(tempo || 84))
        """        out.push('<direction placement="above"><direction-type>' + metro + '</direction-type><staff>1</staff><sound tempo="' + bpm + '"/></direction>');""",
        """        /* review mutation: tempo marks dropped */"""),
    "ADV-XML-METRE": (  # printed metre 3/4 -> 6/8, 4/4 -> 8/8 (same bar length); stats unchanged
        """'</mode></key><time><beats>' + beatsPerBar + '</beats><beat-type>' + beatType + '</beat-type></time><staves>2</staves>'""",
        """'</mode></key><time><beats>' + (beatsPerBar * 2) + '</beats><beat-type>' + (beatType * 2) + '</beat-type></time><staves>2</staves>'"""),
    "ADV-EXTRA-BAR": (  # an empty bar after the last note of every transcription
        """    const bars = Math.max(1, Math.floor(lastOnset / bar) + 1);""",
        """    const bars = Math.max(1, Math.floor(lastOnset / bar) + 2);"""),
    "ADV-NO-ACCIDENTAL": (  # the app draws accidentals only from <accidental>: a C# in C major shows as C
        """              acc = '<accidental>' + ({ '-2': 'flat-flat', '-1': 'flat', '0': 'natural', '1': 'sharp', '2': 'double-sharp' }[sp.alter]) + '</accidental>';""",
        """              acc = '';"""),
    "ADV-GLOBAL-TEMPO": (  # quantisation ignores local beat times (breaks rubato/drift only)
        """    return lo + (t - beats[lo]) / (beats[lo + 1] - beats[lo]);\n  }\n\n  function ibiOf(beats) {""",
        """    return (t - beats[0]) / ((beats[beats.length - 1] - beats[0]) / (beats.length - 1));\n  }\n\n  function ibiOf(beats) {"""),
    "ADV-NO-PEDAL": (  # pedal marks never written (the app's playback sustains from written pedals)
        """    (extra.pedals || []).forEach(p => {""",
        """    ([]).forEach(p => {"""),
    "ADV-MINOR-LEADING-TONE": (  # every minor key spells its raised 7th flat (A minor: Ab, not G#)
        """    minor: { 1: -1, 4: 1, 6: 1, 9: 1, 11: 1 }""",
        """    minor: { 1: -1, 4: 1, 6: 1, 9: 1, 11: -1 }"""),
    # --- added by the G0 fixer: kinds the review did not try ---
    "FIX-HIGH-NOTES-LEFT-HAND": (  # only notes from C6 up move to the left hand: a register-bound subgroup error
        """groups[g].notes.forEach(n => { n.staff = n.midi >= s ? 1 : 2; });""",
        """groups[g].notes.forEach(n => { n.staff = n.midi >= s && n.midi < 84 ? 1 : 2; });"""),
    "FIX-NO-TRIPLETS": (  # triplet detection off: only pieces with tuplets change
        """      if (e3 * 1.02 < e16 && (off16 >= 2 || (fs.length % 3 === 0 && fs.length >= 3))) flags[+k] = true;""",
        """      if (false) flags[+k] = true;"""),
    "FIX-NO-NATURALS": (  # natural signs are never printed; sharps and flats still are
        """            if (sp.alter !== current && !tieStop) {""",
        """            if (sp.alter !== current && !tieStop && sp.alter !== 0) {"""),
    "FIX-DROP-LAST-BAR": (  # the bar holding the last onset is cut off
        """    const bars = Math.max(1, Math.floor(lastOnset / bar) + 1);""",
        """    const bars = Math.max(1, Math.floor(lastOnset / bar));"""),
    "FIX-STATS-LATE-BARS": (  # the MusicXML is untouched; the bar times the app syncs audio with are a beat late
        """    for (let b = 0; b <= bars; b++) barStarts.push(Math.round(tickToSec(b * bar) * 1000) / 1000);""",
        """    for (let b = 0; b <= bars; b++) barStarts.push(Math.round(tickToSec(b * bar + ticksPerBeat) * 1000) / 1000);"""),
}


def write_mutant(mid: str) -> str:
    """A copy of the SUT snapshot (audio-score.js + scoregraph/, pppbench/sut.py) with one edit."""
    find, repl = MUTATIONS[mid]
    try:
        return sut_mod.write_mutant_dir(os.path.join(OUT, "mutants", mid), {sut_mod.ENTRY: [(find, repl)]}, label=mid)
    except sut_mod.SutError as exc:
        raise RuntimeError(f"{exc}; audio-score.js changed, update this review script") from exc


def gate(name: str, sut: str, tag: str):
    s = suite_mod.load_suite(name)
    r = runner.run_suite(s, audio_score=sut, out_dir=os.path.join(OUT, tag, name), write_cases=False, quiet=True)
    base = compare.load_baseline(s)
    v = compare.compare(r["results"], base, s.get("gate") or {})
    d = r["results"]["aggregates"]["all"]["sqi"]["mean"] - base["aggregates"]["all"]["sqi"]["mean"]
    same = util.sha256_file(os.path.join(OUT, tag, name, "results.json"))
    return v, d, same


def golden_run(sut: str) -> str:
    buf = io.StringIO()
    try:
        with contextlib.redirect_stdout(buf):
            rc = golden.run_golden(audio_score=sut)
    except Exception as exc:  # the golden diff reporter itself can crash
        return f"CRASH {type(exc).__name__}: {exc}"
    line = [ln for ln in buf.getvalue().splitlines() if ln.startswith("golden:")]
    return f"exit {rc} ({line[-1] if line else '?'})"


def replay_run(sut: str, tag: str) -> str:
    s = suite_mod.load_suite("replay-public")
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        rc = private.run_private(s, types.SimpleNamespace(audio_score=sut, out=os.path.join(OUT, tag, "replay-public")))
    return f"exit {rc}"


def check_mutations() -> None:
    original = util.sha256_file(os.path.join(OUT, "core-original", "results.json")) if os.path.exists(
        os.path.join(OUT, "core-original", "results.json")) else None
    for mid in MUTATIONS:
        sut = write_mutant(mid)
        v, d_sqi, sha = gate("core", sut, mid)
        sv, _, _ = gate("smoke", sut, mid)
        detail = (f"core {v.status} (SQI {d_sqi:+.2f}; failed={','.join(v.failed_metrics) or '-'}"
                  + ("; results.json byte-identical to the unmutated run" if sha == original else "")
                  + (f"; improvements={len(v.improvements)}" if v.improvements else "")
                  + (f"; warnings={len(v.warnings)}" if v.warnings else "")
                  + f") · smoke {sv.status} · golden {golden_run(sut)} · replay {replay_run(sut, mid)}")
        report(f"mutation {mid} is a core REGRESSION", v.status == "REGRESSION", detail)


# --------------------------------------------------------------------------- 2. oracle identity
def _ideal_prediction(xml: str, qpm: float, has_tempo: bool) -> str:
    """The reference as PPP should write it for the benchmark's performance of it (fixer, §18).

    Two references in core are not that as committed, and the difference is real, not a benchmark
    artefact: a file with no tempo cannot tell PPP to play at the qpm it was performed at (missing
    output scores 0, §17 B1), and PPP's player reads <octave-shift> an octave off (the app_ottava
    known failure, §17 M9). The ideal output states the performed tempo and writes the same sounding
    pitches without octave-shift, which every reader, PPP's included, plays right."""
    xml = re.sub(r"<octave-shift\b[^>]*/>|<octave-shift\b[^>]*>.*?</octave-shift>", "", xml, flags=re.S)
    if not has_tempo:
        mark = ('<direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit>'
                f'<per-minute>{qpm:g}</per-minute></metronome></direction-type><sound tempo="{qpm:g}"/></direction>')
        first = re.search(r"<measure\b[^>]*>", xml)
        xml = xml[:first.end()] + mark + xml[first.end():]
    return xml


def check_oracle() -> None:
    """The ideal prediction must score perfectly, and the raw reference must not where it is not ideal."""
    refs = corpus.by_id(corpus.load_corpus())
    s = suite_mod.load_suite("core")
    keys = ["sqi", "notes.identity.f1", "notation.onset_pos.accuracy", "struct.downbeat.f1", "notation.duration.accuracy",
            "notation.ioi.accuracy", "struct.time_sig.exact", "struct.key.fifths_exact", "struct.tempo.ok_effective"]
    below = Counter()
    examples = {}
    raw_ottava, raw_ottava_caught, raw_notempo, raw_notempo_caught = [], [], [], []
    for rid in s["references"]:
        e = refs[rid]
        ref = corpus.read_reference(e)
        p = perform.perform(ref, rid, "deadpan", "oracle", 1, expect=e.expect)
        t = corpus.expected_time(e, ref)
        stats = {"barStarts": [p.timemap.sec(m.start_q) for m in ref.measures] + [p.timemap.sec(ref.end_q)],
                 "beats": list(p.input["beats"]), "beatsPerBar": t[0], "beatType": t[1]}
        raw = musicxml.read_bytes(e.abspath).decode("utf-8")
        has_tempo = ref.effective_qpm is not None
        shifted = ref.diagnostics.get("octave_shift", False)

        def score(xml: str):
            return evaluate.evaluate_timed(ref, p, {"ok": True, "xml": xml.encode("utf-8"), "stats": stats},
                                           skip_metrics=e.expect.get("skip_metrics", ()))[0]

        m = score(_ideal_prediction(raw, corpus.expected_qpm(e, ref), has_tempo))
        for k in keys:
            v = m.get(k)
            if v is not None and v < (100.0 if k == "sqi" else 1.0) - 1e-9:
                below[k] += 1
                examples.setdefault(k, f"{rid} {v:.3f}")
        if shifted or not has_tempo:
            mr = score(raw)
            if shifted and ref.diagnostics.get("ottava_shifted_notes"):
                raw_ottava.append(rid)
                if (mr.get("notes.identity.f1") or 0) < 1 - 1e-9:
                    raw_ottava_caught.append(rid)
            if not has_tempo:
                raw_notempo.append(rid)
                if mr.get("struct.tempo.ok_effective") == 0.0 and mr.get("usable") == 0.0:
                    raw_notempo_caught.append(rid)
    pick = sum(1 for rid in s["references"] if corpus.read_reference(refs[rid]).measures[0].implicit)
    detail = f"{len(s['references'])} core references ({pick} with a pickup bar); below perfect: " + (
        ", ".join(f"{k} {n} (e.g. {examples[k]})" for k, n in below.items()) or "none")
    report("the ideal prediction of a reference's performance scores perfectly", not below, detail)
    # the committed file is not ideal for these, and scoring it perfect would hide a real PPP failure
    report("a reference PPP would play an octave off is not scored perfect",
           bool(raw_ottava) and raw_ottava_caught == raw_ottava,
           f"{len(raw_ottava_caught)}/{len(raw_ottava)} octave-shift references lose pitch identity in PPP's reading")
    report("a reference with no tempo, performed at a benchmark tempo, is not usable as written",
           bool(raw_notempo) and raw_notempo_caught == raw_notempo,
           f"{len(raw_notempo_caught)}/{len(raw_notempo)} tempo-less references fail playback_tempo")


# --------------------------------------------------------------------------- 3. input lock
def check_lock() -> None:
    """Editing a reference must stop `run` (INPUT_DRIFT), not surface as a SUT regression."""
    s = suite_mod.load_suite("core")
    rid = "samples/prelude-fragment"
    e = corpus.by_id(corpus.load_corpus())[rid]
    text = util.normalise_eol(open(e.abspath, "rb").read()).decode("utf-8")
    assert "<fifths>1</fifths>" in text
    tmp = os.path.join(OUT, "lock", "prelude-fragment.musicxml")
    os.makedirs(os.path.dirname(tmp), exist_ok=True)
    with open(tmp, "w", encoding="utf-8", newline="\n") as h:
        h.write(text.replace("<fifths>1</fifths>", "<fifths>0</fifths>"))   # key signature only: G -> C
    prop = corpus.RefEntry.abspath
    corpus.RefEntry.abspath = property(lambda self: tmp if self.id == rid else os.path.join(util.repo_root(), self.path))
    corpus._canon_cache.clear()
    try:
        r = runner.run_suite(s, out_dir=os.path.join(OUT, "lock", "core"), write_cases=False, quiet=True)
        v = compare.compare(r["results"], compare.load_baseline(s), s.get("gate") or {})
        report("an edited reference stops `run` with INPUT_DRIFT", False,
               f"run accepted the edited reference; check then blames the SUT: {v.status} — {'; '.join(v.failures[:2])}")
    except runner.RunError as exc:
        report("an edited reference stops `run` with INPUT_DRIFT", exc.code == "INPUT_DRIFT", str(exc).splitlines()[0])
    finally:
        corpus.RefEntry.abspath = prop
        corpus._canon_cache.clear()


# --------------------------------------------------------------------------- 4. data audit
def _xml(path: str) -> str:
    return musicxml.read_bytes(path).decode("utf-8", "replace")


ACC_ALTER = {"sharp": 1, "flat": -1, "natural": 0, "double-sharp": 2, "sharp-sharp": 2, "flat-flat": -2}


def _bar_accidentals_not_carried(root) -> int:
    """Notes printed with no accidental after an accidental on the same staff, step and octave earlier
    in the bar, whose <alter> plays another pitch than the page shows. Read from the raw XML, apart from
    the benchmark's reader, in time order across voices (the rule a reader of the page follows).

    The review counted in document order (21 in the hymns); that also counts a voice-2 note sounding
    before a voice-1 accidental printed later in the bar (i-am-jesus-little-lamb bars 6 and 8,
    mighty-fortress bars 1 and 3) and misses a voice-1 note after a voice-2 accidental
    (what-child-is-this bar 13)."""
    count = 0
    for part in root.iter("part"):
        for m in part.iter("measure"):
            t = last = 0
            staves = {}
            for i, el in enumerate(m):
                if el.tag in ("backup", "forward"):
                    d = int(el.findtext("duration") or 0)
                    t += d if el.tag == "forward" else -d
                    continue
                if el.tag != "note":
                    continue
                if el.find("chord") is not None:
                    at = last
                else:
                    at = last = t
                    if el.find("grace") is None:
                        t += int(el.findtext("duration") or 0)
                p = el.find("pitch")
                if p is None or any(x.get("type") == "stop" for x in el.findall("tie")):
                    continue
                staves.setdefault(el.findtext("staff") or "1", []).append(
                    (at, i, (p.findtext("step"), p.findtext("octave")), int(float(p.findtext("alter") or 0)),
                     el.findtext("accidental")))
            for notes in staves.values():
                state = {}
                for _, _, key, alter, acc in sorted(notes, key=lambda x: (x[0], x[1])):
                    if acc:
                        state[key] = ACC_ALTER.get(acc, alter)
                    elif key in state and state[key] != alter:
                        count += 1
    return count


def _core_results():
    """The unmutated core run of this review (check_sqi writes it); run it if it is missing."""
    p = os.path.join(OUT, "core-original", "results.json")
    if not os.path.exists(p):
        runner.run_suite(suite_mod.load_suite("core"), out_dir=os.path.dirname(p), write_cases=False, quiet=True)
    return util.load_json(p), util.read_text(os.path.join(OUT, "core-original", "summary.md")) if os.path.exists(
        os.path.join(OUT, "core-original", "summary.md")) else None


def check_data() -> None:
    # Criterion (fixer, replacing the review's hard-coded GAP): the defects this script finds on its
    # own must appear, with the same counts, in the benchmark's results.json and summary.md.
    hymns = sorted(os.path.join(REPO, "catalog", "hymns", f) for f in os.listdir(os.path.join(REPO, "catalog", "hymns"))
                   if f.endswith(".musicxml"))
    starts = stops = files = 0
    keysig = 0
    inherit = inherit_files = 0
    for f in hymns:
        data = musicxml.read_bytes(f)
        t = data.decode("utf-8", "replace")
        a, b = t.count('<tie type="start"/>'), t.count('<tie type="stop"/>')
        starts, stops, files = starts + a, stops + b, files + (a > 0 and b == 0)
        c = musicxml.read_score(f)
        keysig += corpus.keysig_contradicted(c)
        k = _bar_accidentals_not_carried(ET.fromstring(data))
        inherit, inherit_files = inherit + k, inherit_files + (k > 0)
    results, summary = _core_results()
    kf = ((results.get("known_failures") or {}).get("classes") or {})
    got = {"key signature": (kf.get("key_signature_playback") or {}).get("by_collection", {}).get("hymns"),
           "ties": (kf.get("tie_without_stop") or {}).get("by_collection", {}).get("hymns"),
           "bar accidentals": ((kf.get("bar_accidental_not_carried") or {}).get("by_collection"),
                               (kf.get("bar_accidental_not_carried") or {}).get("items"))}
    want = {"key signature": keysig, "ties": files, "bar accidentals": ({"hymns": inherit_files}, inherit)}
    reported = (got == want
                and all(kf.get(c, {}).get("status") == "KNOWN_FAILURE"
                        for c in ("key_signature_playback", "tie_without_stop", "bar_accidental_not_carried"))
                and summary is not None and "Known production failures" in summary)
    report("catalog hymn defects are measured by the benchmark", bool(reported),
           f"independent count: {keysig}/{len(hymns)} hymns ignore their key signature, {files} hymns carry {starts} "
           f"tie starts and {stops} stops, {inherit} notes lose a bar accidental; benchmark report (hymn files): "
           f"{got} (want {want}: files, and for bar accidentals (files by collection, notes)); summary lists them: "
           f"{summary is not None and 'Known production failures' in summary}")

    # octave-shift: is <pitch> sounding (MusicXML) or written (the app's reading)?
    tracked = util.tracked_files()
    files_os = [f for f in sorted(tracked) if f.startswith("catalog/") and f.endswith((".musicxml", ".mxl"))
                and b"octave-shift" in musicxml.read_bytes(os.path.join(REPO, f))]
    ex = [{"path": f} for f in files_os]
    raw_j, app_j, types_ = [], [], Counter()
    for x in ex:
        data = musicxml.read_bytes(os.path.join(REPO, x["path"]))
        root = ET.fromstring(data)
        musicxml._strip_ns(root)
        types_.update(o.get("type") for o in root.iter("octave-shift"))
        c = musicxml.read_score(data)
        for staff in {n.staff for n in c.notes}:
            groups = {}
            for n in c.notes:
                if n.staff == staff:
                    groups.setdefault(n.onset_q, []).append(n)
            seq = [max(groups[q], key=lambda n: n.written_midi) for q in sorted(groups)]
            for a, b in zip(seq, seq[1:]):
                if (a.midi != a.written_midi) != (b.midi != b.written_midi):
                    raw_j.append(abs(b.written_midi - a.written_midi))
                    app_j.append(abs(b.midi - a.midi))
    med = lambda v: sorted(v)[len(v) // 2]  # noqa: E731
    # Criterion (fixer): no octave-shift score is left out silently. Each is a benchmark reference
    # read the MusicXML way, or excluded for another stated reason (licence, broken bars); the app's
    # different reading is a KNOWN_FAILURE with a count in every run; the correctness fixtures pin it.
    refs = {r.path: r for r in corpus.load_corpus()}
    excluded = {x["path"]: x["rule"] for x in util.load_json(corpus.EXCLUDED)["excluded"]}
    silent = [f for f in files_os if f not in refs and excluded.get(f) not in ("P1", "L8", "L6")]
    std_ok = all(corpus.read_reference(refs[f]).diagnostics.get("ottava_mode") == "standard" for f in files_os if f in refs)
    ko = kf.get("octave_shift_playback") or {}
    from pppbench import correctness
    dev = set(correctness.check()["app_deviations"])
    ok = (not silent and std_ok and ko.get("status") == "KNOWN_FAILURE" and ko.get("files_affected", 0) >= len(files_os) - 1
          and {"C10-octave-shift-8va", "C11-octave-shift-8vb"} <= dev)
    report("the octave-shift scores are measured, and the app's reading is a tracked known failure", ok,
           f"{len(files_os)} catalogue files with octave-shift: {sum(1 for f in files_os if f in refs)} references read "
           f"the MusicXML way, excluded {Counter(excluded[f] for f in files_os if f in excluded)}, silently dropped "
           f"{len(silent)}; known failure {ko.get('status')} {ko.get('files_affected')} files / {ko.get('items')} notes; "
           f"independent check: types {dict(types_)}, at {len(raw_j)} 8va boundaries the melodic step is median "
           f"{med(raw_j)} semitones as written but {med(app_j)} the app's way")

    # licence evidence inside the files
    refs = {r.id: r for r in corpus.load_corpus()}
    weak, mislabel = [], []
    for rid, r in refs.items():
        if r.set != "method":
            continue
        t = _xml(r.abspath)
        rights = (re.findall(r"<rights[^>]*>(.*?)</rights>", t) or [""])[0]
        if "Transcribed for PPP" in rights and "PDMX" in r.license:
            mislabel.append(rid)
        elif not re.search(r"public domain|Public Domain|Transcribed for PPP|Hayashi Neru", rights):
            weak.append(f"{rid} ({rights or 'no <rights>'})")
    report("every reference's licence is evidenced in the repository", not weak and not mislabel,
           f"{len(weak)} registered references carry no PD/CC0 statement in the file: {', '.join(weak)}; "
           f"{len(mislabel)} PPP transcriptions are labelled PDMX: {', '.join(mislabel)}")

    # Criterion (fixer): the catalogue data cannot be edited in G0, so the review's own recommendation
    # (m5: a lint rule) is the bar — every reference whose tempo marks disagree is flagged by lint
    # L13 and counted as a known failure.
    tempo_bad = []
    for rid, r in refs.items():
        c = corpus.read_reference(r)
        if c.sound_qpm and c.printed_qpm and abs(c.sound_qpm - c.printed_qpm) > 0.01 * c.printed_qpm:
            tempo_bad.append(rid)
    flagged = {i.ref for i in corpus.lint(list(refs.values())) if i.rule == "L13"}
    tk = kf.get("tempo_marks_disagree") or {}
    ok = set(tempo_bad) <= flagged and (not tempo_bad or tk.get("status") == "KNOWN_FAILURE")
    report("references whose own tempo marks disagree are flagged (lint L13) and counted", ok,
           f"independent: {tempo_bad or 'none'}; lint L13: {sorted(flagged)}; known failure {tk.get('status')} "
           f"{tk.get('files_affected')} files")


# --------------------------------------------------------------------------- 5. SQI meaning
def check_sqi() -> None:
    s = suite_mod.load_suite("core")
    out = os.path.join(OUT, "core-original")
    run = runner.run_suite(s, out_dir=out, write_cases=False, quiet=True)
    r = run["results"]
    from pppbench import report as report_mod
    report_mod.write_summary(r, run["run"], compare.compare(r, compare.load_baseline(s), s.get("gate") or {}),
                             compare.load_baseline(s), os.path.join(out, "summary.md"))
    summary = util.read_text(os.path.join(out, "summary.md"))
    cs = [c for c in r["cases"] if c["status"] == "ok" and "holdout" not in c["tags"]]
    m = lambda c, k: c["metrics"].get(k)  # noqa: E731

    def severe(c):
        return [k for k, bad in (("metre", m(c, "struct.time_sig.exact") == 0),
                                 ("played tempo", m(c, "struct.tempo.ok_effective") == 0),
                                 ("key", m(c, "struct.key.fifths_exact") == 0),
                                 ("<50% notes in the right bar+beat", (m(c, "notation.onset_pos.accuracy") or 0) < 0.5)) if bad]
    three = [c for c in cs if len(severe(c)) >= 3]
    top = max(three, key=lambda c: m(c, "sqi")) if three else None
    strict = [c for c in cs if not severe(c) and (m(c, "notes.identity.f1") or 0) >= 0.95
              and (m(c, "notation.onset_pos.accuracy") or 0) >= 0.90]
    # Criterion (fixer, replacing the review's hard-coded GAP): the release verdict must never call a
    # case with one of the review's severe failures usable; the headline must be that verdict (the
    # usable-score rate, re-derived here from the raw case metrics), shown before the diagnostic
    # score, with the "high diagnostic but unusable" cases called out; and no case the review's
    # strict rule rejects may pass.
    wrongly_usable = [c["id"] for c in cs if severe(c) and m(c, "usable") == 1.0]
    lax = [c["id"] for c in cs if m(c, "usable") == 1.0 and c not in strict]
    rate = sum(1 for c in cs if m(c, "usable") == 1.0) / len(cs)
    agg_rate = r["aggregates"]["all"]["usable"]["mean"]
    head = summary.find("Usable-score rate")
    ok = (not wrongly_usable and not lax and abs(rate - agg_rate) < 1e-6 and 0 <= head < summary.find("## Headline metrics")
          and "Diagnostic score high but unusable" in summary)
    report("the release headline separates unusable scores from usable ones", ok,
           f"usable-score rate {rate:.1%} (aggregate {agg_rate:.1%}; the review's strict rule gives "
           f"{len(strict) / len(cs):.1%}); severe cases called usable: {len(wrongly_usable)}; usable cases the strict "
           f"rule rejects: {len(lax)}; diagnostic score (sqi/2) {r['aggregates']['all']['sqi']['mean']:.2f}; "
           + (f"{len(three)} cases have >= 3 severe failures, best diagnostic {m(top, 'sqi'):.1f}" if top else ""))


def check_correctness() -> None:
    """M6: the reader against spec-derived fixtures must catch the same broken readers the review
    showed the parity check missing — without a browser."""
    from pppbench import correctness
    r = correctness.check()
    report("the reader reads the independent MusicXML fixtures correctly", not r["failures"],
           f"{r['fixtures']} fixtures; failures: {r['failures'][:3] or 'none'}; app reading departs on "
           f"{sorted(r['app_deviations'])} (documented)")
    read0, merge0 = musicxml.read_score, musicxml.merge_ties
    nxt = dict(zip("CDEFGAB", "DEFGABC"))

    def no_merge(notes):
        for n in notes:
            n.tie_stop = False
        return merge0(notes)

    def respell(*a, **k):
        c = read0(*a, **k)
        for n in c.notes + c.sounding:
            if n.alter == 1 and n.step not in "EB":
                n.step, n.alter = nxt[n.step], -1
        return c

    def minor(*a, **k):
        c = read0(*a, **k)
        for mm in c.measures:
            mm.mode, mm.mode_explicit = "minor", True
        return c

    for name, (attr, fn) in {"never merges ties": ("merge_ties", no_merge),
                             "respells sharps as flats": ("read_score", respell),
                             "reads every key as minor": ("read_score", minor)}.items():
        musicxml.read_score, musicxml.merge_ties = read0, merge0
        setattr(musicxml, attr, fn)
        try:
            fails = correctness.check()["failures"]
        finally:
            musicxml.read_score, musicxml.merge_ties = read0, merge0
        report(f"musical correctness catches a reader that {name}", bool(fails), f"{len(fails)} failure(s), e.g. {fails[:1]}")


# --------------------------------------------------------------------------- 6. conformance blind spots
def check_conformance(base: str) -> None:
    from pppbench import tiers
    read0, merge0 = musicxml.read_score, musicxml.merge_ties
    nxt = dict(zip("CDEFGAB", "DEFGABC"))

    def no_merge(notes):
        for n in notes:
            n.tie_stop = False
        return merge0(notes)

    def respell(*a, **k):
        c = read0(*a, **k)
        for n in c.notes + c.sounding:
            if n.alter == 1 and n.step not in "EB":
                n.step, n.alter = nxt[n.step], -1
        return c

    def minor(*a, **k):
        c = read0(*a, **k)
        for mm in c.measures:
            mm.mode = "minor"
        return c

    variants = {"never merges ties": ("merge_ties", no_merge), "respells sharps as flats": ("read_score", respell),
                "reads every key as minor": ("read_score", minor)}
    for name, (attr, fn) in variants.items():
        musicxml.read_score, musicxml.merge_ties = read0, merge0
        setattr(musicxml, attr, fn)
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            rc = tiers.conformance(types.SimpleNamespace(base_url=base, require_env=True))
        line = [ln for ln in buf.getvalue().splitlines() if ln.startswith(("conformance:", "parser parity:", "SKIPPED"))]
        report(f"conformance catches a reader that {name}", rc == 1, line[-1] if line else f"exit {rc}")
    musicxml.read_score, musicxml.merge_ties = read0, merge0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--only", choices=["mutations", "oracle", "lock", "data", "sqi", "correctness"])
    ap.add_argument("--conformance", metavar="BASE_URL")
    a = ap.parse_args()
    # sqi first: it records the unmutated core run the mutation and data checks read
    checks = {"sqi": check_sqi, "mutations": check_mutations, "oracle": check_oracle, "lock": check_lock,
              "data": check_data, "correctness": check_correctness}
    for name, fn in checks.items():
        if a.only in (None, name):
            fn()
    if a.conformance:
        check_conformance(a.conformance)
    name = "adversarial-report" + (f".{a.only}" if a.only else "") + (".conformance" if a.conformance else "") + ".json"
    util.dump_json({"checks": [{"check": c, "ok": ok, "detail": d} for c, ok, d in RESULTS]}, os.path.join(OUT, name))
    gaps = sum(1 for _, ok, _ in RESULTS if not ok)
    print(f"\nreview: {len(RESULTS) - gaps} OK, {gaps} GAP · {util.rel(os.path.join(OUT, name))}")
    return 1 if gaps else 0


if __name__ == "__main__":
    sys.exit(main())
