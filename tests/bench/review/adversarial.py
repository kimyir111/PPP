#!/usr/bin/env python3
"""G0 independent review (2026-09-22): adversarial checks of the benchmark itself.

Not part of `npm run test:bench`. Each check states what a sound benchmark should do and reports OK or
GAP for the current code. Exit 1 while any GAP remains. Findings: docs/GOALS/G00_QUALITY_FOUNDATION.md,
"Independent Review".

    python tests/bench/review/adversarial.py                      # every offline check (~3 min)
    python tests/bench/review/adversarial.py --only mutations     # mutations | oracle | lock | data | sqi
    python tests/bench/review/adversarial.py --conformance http://127.0.0.1:8777
                                          # also the T1-C blind-spot check (npm start + puppeteer)

Outputs go to tests/bench/out/review/ (git-ignored). audio-score.js is never modified: mutants are
written under out/review/mutants/.
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
                      stages, suite as suite_mod, util)

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
}


def write_mutant(mid: str) -> str:
    find, repl = MUTATIONS[mid]
    src = util.normalise_eol(open(stages.default_audio_score(), "rb").read()).decode("utf-8")
    n = src.count(find)
    if n != 1:
        raise RuntimeError(f"{mid}: anchor found {n} times; audio-score.js changed, update this review script")
    path = os.path.join(OUT, "mutants", mid + ".js")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as h:
        h.write(src.replace(find, repl))
    return path


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
def check_oracle() -> None:
    """The reference itself, as the prediction, must score perfectly."""
    refs = corpus.by_id(corpus.load_corpus())
    s = suite_mod.load_suite("core")
    keys = ["sqi", "notes.identity.f1", "notation.onset_pos.accuracy", "struct.downbeat.f1", "notation.duration.accuracy",
            "notation.ioi.accuracy", "struct.time_sig.exact", "struct.key.fifths_exact", "struct.tempo.ok_effective"]
    below = Counter()
    examples = {}
    for rid in s["references"]:
        e = refs[rid]
        ref = corpus.read_reference(e)
        p = perform.perform(ref, rid, "deadpan", "oracle", 1, expect=e.expect)
        t = corpus.expected_time(e, ref)
        stats = {"barStarts": [p.timemap.sec(m.start_q) for m in ref.measures] + [p.timemap.sec(ref.end_q)],
                 "beats": list(p.input["beats"]), "beatsPerBar": t[0], "beatType": t[1]}
        m, _, _ = evaluate.evaluate_timed(ref, p, {"ok": True, "xml": musicxml.read_bytes(e.abspath), "stats": stats},
                                          skip_metrics=e.expect.get("skip_metrics", ()))
        for k in keys:
            v = m.get(k)
            if v is not None and v < (100.0 if k == "sqi" else 1.0) - 1e-9:
                below[k] += 1
                examples.setdefault(k, f"{rid} {v:.3f}")
    pick = sum(1 for rid in s["references"] if corpus.read_reference(refs[rid]).measures[0].implicit)
    detail = f"{len(s['references'])} core references ({pick} with a pickup bar); below perfect: " + (
        ", ".join(f"{k} {n} (e.g. {examples[k]})" for k, n in below.items()) or "none")
    report("a reference scored against itself is perfect", not below, detail)


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


def check_data() -> None:
    hymns = sorted(os.path.join(REPO, "catalog", "hymns", f) for f in os.listdir(os.path.join(REPO, "catalog", "hymns"))
                   if f.endswith(".musicxml"))
    starts = stops = files = 0
    keysig = 0
    inherit = 0
    for f in hymns:
        data = musicxml.read_bytes(f)
        t = data.decode("utf-8", "replace")
        a, b = t.count('<tie type="start"/>'), t.count('<tie type="stop"/>')
        starts, stops, files = starts + a, stops + b, files + (a > 0 and b == 0)
        c = musicxml.read_score(f)
        keysig += corpus.keysig_contradicted(c)
        root = ET.fromstring(data)
        for m in root.iter("measure"):
            seen = {}
            for n in m.iter("note"):
                p = n.find("pitch")
                if p is None:
                    continue
                k = (p.findtext("step"), p.findtext("octave"), n.findtext("staff"))
                if p.findtext("alter") is not None:
                    seen[k] = p.findtext("alter")
                elif seen.get(k, "0") != "0":
                    inherit += 1
    report("catalog hymn defects are measured by the benchmark", False,
           f"{keysig}/{len(hymns)} hymns ignore their key signature (documented, I10); {files} hymns carry "
           f"{starts} <tie type=start> and {stops} stops (the app re-strikes them; undocumented); {inherit} notes lose "
           "a bar accidental (undocumented). No suite, metric or summary line reports any of them.")

    # octave-shift: is <pitch> sounding (MusicXML) or written (the app's reading)?
    ex = [x for x in util.load_json(corpus.EXCLUDED)["excluded"] if x["rule"] == "L5"]
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
    report("the 29 octave-shift exclusions hide no production defect", False,
           f"octave-shift types {dict(types_)}; at {len(raw_j)} 8va boundaries the melodic step is median "
           f"{med(raw_j)} semitones reading <pitch> as sounding (MusicXML) but {med(app_j)} with the app's -12 "
           f"({sum(j >= 10 for j in app_j) / len(app_j):.0%} octave-size leaps): the app very likely plays these "
           "passages an octave low (G00 §14 I3)")

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

    tempo_bad = []
    for rid, r in refs.items():
        c = corpus.read_reference(r)
        if c.sound_qpm and c.printed_qpm and abs(c.sound_qpm - c.printed_qpm) > 0.01 * c.printed_qpm:
            tempo_bad.append(f"{rid} sound {c.sound_qpm:g} vs printed {c.printed_qpm:g}")
    report("references agree with their own tempo marks (lint)", not tempo_bad, "; ".join(tempo_bad) or "all agree")


# --------------------------------------------------------------------------- 5. SQI meaning
def check_sqi() -> None:
    s = suite_mod.load_suite("core")
    r = runner.run_suite(s, out_dir=os.path.join(OUT, "core-original"), write_cases=False, quiet=True)["results"]
    cs = [c for c in r["cases"] if c["status"] == "ok" and "holdout" not in c["tags"]]
    m = lambda c, k: c["metrics"].get(k)  # noqa: E731

    def severe(c):
        return [k for k, bad in (("metre", m(c, "struct.time_sig.exact") == 0),
                                 ("played tempo", m(c, "struct.tempo.ok_effective") == 0),
                                 ("key", m(c, "struct.key.fifths_exact") == 0),
                                 ("<50% notes in the right bar+beat", (m(c, "notation.onset_pos.accuracy") or 0) < 0.5)) if bad]
    three = [c for c in cs if len(severe(c)) >= 3]
    top = max(three, key=lambda c: m(c, "sqi"))
    usable = [c for c in cs if not severe(c) and (m(c, "notes.identity.f1") or 0) >= 0.95
              and (m(c, "notation.onset_pos.accuracy") or 0) >= 0.90]
    report("SQI separates unusable scores from usable ones", False,
           f"core SQI {r['aggregates']['all']['sqi']['mean']:.2f}; {len(three)}/{len(cs)} cases have >= 3 severe "
           f"failures, the best of them SQI {m(top, 'sqi'):.1f} ({top['id']}: {', '.join(severe(top))}); "
           f"strict usable-score rate {len(usable)}/{len(cs)} = {len(usable) / len(cs):.1%}")


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
        line = [ln for ln in buf.getvalue().splitlines() if ln.startswith(("conformance:", "SKIPPED"))]
        report(f"conformance catches a reader that {name}", rc == 1, line[-1] if line else f"exit {rc}")
    musicxml.read_score, musicxml.merge_ties = read0, merge0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--only", choices=["mutations", "oracle", "lock", "data", "sqi"])
    ap.add_argument("--conformance", metavar="BASE_URL")
    a = ap.parse_args()
    # sqi first: it records the unmutated core run the mutation check compares hashes with
    checks = {"sqi": check_sqi, "mutations": check_mutations, "oracle": check_oracle, "lock": check_lock, "data": check_data}
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
