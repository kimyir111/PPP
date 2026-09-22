#!/usr/bin/env python3
"""G0 SHORT FINAL review (2026-09-22, G00 §21): new harmful mutations after the final fixer (§20).

Not part of `npm run test:bench`. It never changes a benchmark criterion, a baseline or an expectation
of the other review scripts. Each mutation below is applied to a copy of audio-score.js only, then run
through core, smoke and robust (gate against the committed baselines) and golden, like final_review.py.

Every mutation is a change the app draws or plays (checked against `Piano Coach App.dc.html`):

- SR-SPURIOUS-REPEAT: a backward repeat sign at the end of the middle bar. The app's player expands
  repeats (`PianoScore.build` -> `Score.form` visits), so the first half is played twice and the page
  shows a repeat sign. The benchmark reader does not read <barline>.
- SR-IMPLICIT-MASKS-SHORT-BARS: the right hand's trailing rest loses a beat (the left hand stays whole)
  and every inner bar is marked implicit="yes". The page shows incomplete right-hand bars.
- SR-RH-RESTS-SHORT (control): the same short right-hand rests without implicit.
- SR-RH-ALTO-CLEF: the right-hand staff in a C (alto) clef; the app draws every note under it.
- SR-PRINTED-TEMPO-MIDWAY (control, expected PASS): a printed metronome mark at half tempo in the
  middle bar, followed at the same position by a <sound> that keeps the player's tempo. The app does
  not draw tempo marks on the page (they only feed PianoScore.tempoMap, where the later <sound> wins),
  so nothing the app shows or plays changes; golden must still call it a change in the file.
- SR-KEY-LAST-TWO-BARS: the last two bars under a key signature one fifth away (accidentals keep every
  pitch right): the per-case sequence threshold (0.95) against the aggregate gate.
- SR-NO-STAVES (control): <staves>2</staves> dropped. The app then reads staff 2 as a cue staff
  (hand x: shown, never played or practised).

Added by the last fixer (G00 §21.15; the mutations and expectations above are unchanged):

- SR-FAKE-SPLIT-BAR: the second-to-last bar split in two halves where no note crosses, with no repeat
  sign and the same metre (S-m2). stats.bars and barStarts follow the file, so only the split is wrong.

Added by the final pass review and the last fixer (G00 §22 PF-M1, PF-M2):

- PF-FORWARD-REPEAT-ONLY-EXCUSE: SR-FAKE-SPLIT-BAR's split, but its second half opens with a lone
  forward repeat that no backward repeat anywhere in the file ever consumes — it never fires in
  ``app_play_order`` and must not excuse the split by itself.
- PF-TRUNCATED-LAST-MEASURE: only the file's last bar loses a beat of trailing rest (every other bar
  stays full); the bar count still matches the reference, so only the edge-bar exemption is wrong.
- PF-DROPPED-LAST-MEASURE: the file's last written bar is missing outright, one fewer measure than the
  reference, with stats and barStarts following the shorter file — only ``struct.measures.count_exact``
  catches a bare count mismatch.
- Reference repeats (second part): on every core reference, the ideal output (final_oracle's) with a
  fake repeat after the middle bar, and, where the reference has repeats, its first backward repeat
  removed, moved a bar later, or taken three times. Each must fail the play-order gate against the
  benchmark's performance (T) and against the printed reference (S: OMR / prediction files), and golden
  must call it STRUCTURAL_CHANGE. One exception, by design (structure.play_order): removing a
  reference's only repeat leaves a score that plays every bar once, as the performance did, which is
  right for the recording; it must still fail S and golden, and is counted separately.

    python tests/bench/review/short_review.py                # everything, exit 1 when one is not caught
    python tests/bench/review/short_review.py --only NAME    # one mutation (NAME "repeats": the second part)

Outputs: tests/bench/out/short-review/ (git-ignored). audio-score.js is never modified.
"""

from __future__ import annotations

import argparse
import os
import re
import sys
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.dirname(HERE))

import final_review as fr  # noqa: E402  (its gate and golden helpers)
import adversarial  # noqa: E402  (its _ideal_prediction: the fixer's construction)
from pppbench import corpus, evaluate, musicxml, mutation, perform, semantic, stages, suite as suite_mod, sut as sut_mod, util  # noqa: E402

util.setup_stdio()
fr.OUT = os.path.join(fr.BENCH, "out", "short-review")

# G1: the MusicXML is written from the ScoreGraph since the flip (G01 §15.3); each writer defect below is made
# in buildGraph (or, for <staves>, the exporter) with the edits of pppbench/mutation.py: the same defect.
M = mutation

# name -> (area, what the user gets, expected core status, [(find, replace), ...])
MUTATIONS = {
    "SR-SPURIOUS-REPEAT": (
        "measure structure / sounding order",
        "a repeat sign after the middle bar: the app plays the first half twice",
        "REGRESSION",
        M.SPURIOUS_REPEAT_EDITS),
    "SR-IMPLICIT-MASKS-SHORT-BARS": (
        "measure completeness",
        "right-hand bars a beat short wherever the bar ends in a long rest; inner bars flagged implicit",
        "REGRESSION",
        M.IMPLICIT_SHORT_EDITS),
    "SR-RH-RESTS-SHORT": (
        "measure completeness (control)",
        "right-hand bars a beat short wherever the bar ends in a long rest",
        "REGRESSION",
        [M.RH_RESTS_SHORT]),
    "SR-RH-ALTO-CLEF": (
        "clef",
        "the right-hand staff in alto clef: every right-hand note reads a different pitch",
        "REGRESSION",
        [(M.SG_CLEF_RH, "    b.clef(part, { staff: st[1], m: mid[0], at: '0', sign: 'C' });")]),
    "SR-PRINTED-TEMPO-MIDWAY": (
        "tempo sequence (printed, control)",
        "a printed metronome mark at half tempo in the middle bar; the app neither draws it nor plays it",
        "PASS",
        [M.sg_tempo_at("Math.floor(bars / 2)", "(compound ? scoreGraph().rational.format(scoreGraph().rational.make(bpm * 3, 2)) : String(bpm))",
                       "String(Math.round(bpm / 2))")]),
    "SR-KEY-LAST-TWO-BARS": (
        "key sequence (threshold)",
        "the last two bars under a key signature one fifth away; accidentals keep every pitch right",
        "REGRESSION",
        M.sg_key_from("barIdx > 0 && barIdx >= bars - 2", "bars - 2")),
    "SR-NO-STAVES": (
        "staff structure (control)",
        "no <staves>: the app reads the left-hand staff as a cue staff and never plays it",
        "REGRESSION",
        {M.EXPORTER: M.NO_STAVES_EDITS}),
    "SR-FAKE-SPLIT-BAR": (
        "measure structure (split without a repeat)",
        "the second-to-last bar drawn as two half bars with no repeat sign between them",
        "REGRESSION",
        mutation.FAKE_SPLIT_EDITS),
    "PF-FORWARD-REPEAT-ONLY-EXCUSE": (
        "measure structure (fake split excused by a repeat that cannot fire)",
        "the same fake split as SR-FAKE-SPLIT-BAR, but its second half opens with a lone forward repeat "
        "no backward repeat in the file ever consumes",
        "REGRESSION",
        mutation.FORWARD_REPEAT_ONLY_EDITS),
    "PF-TRUNCATED-LAST-MEASURE": (
        "measure completeness (edge bar)",
        "only the file's last bar loses a beat of trailing rest; the bar count still matches the reference",
        "REGRESSION",
        mutation.TRUNCATED_LAST_MEASURE_EDITS),
    "PF-DROPPED-LAST-MEASURE": (
        "measure count",
        "the file's last written bar is missing outright: one fewer measure than the reference",
        "REGRESSION",
        mutation.DROPPED_LAST_MEASURE_EDITS),
}


def write_mutant(name: str) -> str:
    """A copy of the SUT snapshot (audio-score.js + scoregraph/, pppbench/sut.py) with the edits applied."""
    try:
        edits = MUTATIONS[name][3]     # [(find, replace), ...] in audio-score.js, or {SUT file: [...]}
        return sut_mod.write_mutant_dir(os.path.join(fr.OUT, "mutants", name),
                                        edits if isinstance(edits, dict) else {sut_mod.ENTRY: edits}, label=name)
    except sut_mod.SutError as exc:
        raise RuntimeError(str(exc)) from exc


# ------------------------------------------------------------------ reference repeats (§21.15)
BACKWARD = '<barline location="right"><bar-style>light-heavy</bar-style><repeat direction="backward"{}/></barline>'
_BWD = re.compile(r'<repeat\s+direction="backward"[^>]*/>')


def _part0_measures(xml: str):
    p = re.search(r"<part\b[^>]*>", xml)
    end = xml.index("</part>", p.end())
    return [(p.end() + m.start(), p.end() + m.end())
            for m in re.finditer(r"<measure\b.*?</measure>", xml[p.end():end], re.S)]


def _edit_bar(xml: str, index: int, fn) -> str:
    a, b = _part0_measures(xml)[index]
    return xml[:a] + fn(xml[a:b]) + xml[b:]


def _add_backward(xml: str, index: int) -> str:
    return _edit_bar(xml, index, lambda m: m[:-len("</measure>")] + BACKWARD.format("") + "</measure>")


def repeat_variants(xml: str, ref):
    """name -> a harmful variant of an ideal output (None where it does not apply to this reference)."""
    n = len(ref.measures)
    ends = [m.index for m in ref.measures if m.bar.get("repeatEnd")]
    mid = n // 2 - 1
    while mid in ends and mid > 0:
        mid -= 1
    out = {"fake-middle-repeat": _add_backward(xml, mid) if n >= 3 and mid not in ends else None,
           "remove-repeat": None, "move-repeat": None, "repeat-times": None}
    spans = _part0_measures(xml)
    first = next((i for i in ends if _BWD.search(xml[spans[i][0]:spans[i][1]])), None)
    if first is not None:
        def drop(m):
            return _BWD.sub("", m)
        out["remove-repeat"] = _edit_bar(xml, first, drop)
        if first + 1 < n and first + 1 not in ends:
            out["move-repeat"] = _add_backward(_edit_bar(xml, first, drop), first + 1)
        out["repeat-times"] = _edit_bar(xml, first, lambda m: _BWD.sub('<repeat direction="backward" times="3"/>', m))
    return out


def check_reference_repeats() -> bool:
    refs = corpus.by_id(corpus.load_corpus())
    s = suite_mod.load_suite("core")
    tried, caught, plays_once_ok, same_order = Counter(), Counter(), Counter(), Counter()
    gaps = []
    for rid in s["references"]:
        e = refs[rid]
        ref = corpus.read_reference(e)
        p = perform.perform(ref, rid, "deadpan", "oracle", 1, expect=e.expect)
        t = corpus.expected_time(e, ref)
        key = corpus.expected_key(e, ref)
        stats = {"barStarts": [p.timemap.sec(m.start_q) for m in ref.measures] + [p.timemap.sec(ref.end_q)],
                 "beats": list(p.input["beats"]), "beatsPerBar": t[0], "beatType": t[1]}
        expected = {"qpm": corpus.expected_qpm(e, ref), "time": list(t), "key": {"fifths": key["fifths"], "mode": key["mode"]},
                    "measures": len(ref.measures), "bar_starts": []}
        skip = e.expect.get("skip_metrics", ())
        raw = musicxml.read_bytes(e.abspath).decode("utf-8")
        ideal = adversarial._ideal_prediction(raw, corpus.expected_qpm(e, ref), ref.effective_qpm is not None)
        ideal_canon = musicxml.read_score(ideal)
        base_proj = semantic.projection(ideal_canon)
        for name, xml in repeat_variants(ideal, ref).items():
            if xml is None:
                continue
            tried[name] += 1
            pred = musicxml.read_score(xml)
            tm = evaluate.evaluate_timed(ref, p, {"ok": True, "xml": xml.encode("utf-8"), "stats": stats}, skip_metrics=skip)[0]
            sm = evaluate.evaluate_symbolic(ref, pred, expected, skip_metrics=skip)[0]
            label = semantic.classify(base_proj, semantic.projection(pred))[0]
            t_fail = tm["struct.form.order_exact"] == 0.0 and tm["critical.structure"] == 0.0 and tm["usable"] == 0.0
            s_fail = sm["struct.form.order_exact"] == 0.0 and sm["critical.structure"] == 0.0
            if pred.app_play_order() == ideal_canon.app_play_order():
                # the page changed, the app plays the same bars (times="3" on a repeat inside a first ending, which
                # the app never reaches a second time): golden must see it, the play-order gates must not
                ok = tm["struct.form.order_exact"] == 1.0 and sm["struct.form.order_exact"] == 1.0
                same_order[name] += ok
            elif pred.app_play_order() == list(range(len(pred.measures))):
                ok = tm["struct.form.order_exact"] == 1.0 and s_fail   # the performance's own order: right by design
                plays_once_ok[name] += ok
            else:
                ok = t_fail and s_fail
            ok = ok and label == "STRUCTURAL_CHANGE"
            caught[name] += ok
            if not ok:
                gaps.append(f"{rid} {name}: T order {tm['struct.form.order_exact']} usable {tm['usable']}, "
                            f"S order {sm['struct.form.order_exact']}, golden {label}")
    for name in tried:
        extra = "".join([
            f"; {plays_once_ok[name]} now play every bar once (right for the performance, still wrong against the "
            "printed score)" if plays_once_ok[name] else "",
            f"; {same_order[name]} change the page but not what the app plays (golden only)" if same_order[name] else ""])
        print(f"{'OK ' if caught[name] == tried[name] else 'GAP'}  REF-{name.upper()}: as expected on {caught[name]}/{tried[name]} "
              f"core references (T and S play-order gates, golden STRUCTURAL_CHANGE){extra}", flush=True)
    for g in gaps[:10]:
        print("     " + g)
    return not gaps


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--only")
    a = ap.parse_args()
    suites = ("core", "smoke", "robust")
    rows = []
    names = [n for n in MUTATIONS if not a.only or a.only == n]
    base_sha = {s: fr.gate(s, stages.default_audio_score(), "unmutated")[2] for s in suites} if names else {}
    for name in names:
        area, what, expect, _ = MUTATIONS[name]
        sut = write_mutant(name)
        res = {}
        for s in suites:
            v, d, sha = fr.gate(s, sut, name)
            res[s] = {"status": v.status, "failed": v.failed_metrics, "d_sqi": d.get("sqi"), "d_usable": d.get("usable"),
                      "identical": sha == base_sha[s]}
        res["golden"] = fr.golden_labels(sut)
        ok = res["core"]["status"] == expect and "SERIALIZATION_ONLY" not in res["golden"] and "CRASH" not in res["golden"]
        rows.append({"mutation": name, "area": area, "user_sees": what, "expect": expect, "ok": ok, **res})
        c = res["core"]
        print(f"{'OK ' if ok else 'GAP'}  {name} [{area}]\n     core {c['status']} (Δdiag {c['d_sqi']:+.3f}, "
              f"Δusable {c['d_usable']:+.4f}, failed={','.join(c['failed'][:10]) or '-'}"
              + ("; results.json byte-identical" if c["identical"] else "") + ")"
              f"\n     smoke {res['smoke']['status']}" + (" (identical)" if res["smoke"]["identical"] else "")
              + f" · robust {res['robust']['status']}" + (" (identical)" if res["robust"]["identical"] else "")
              + f" · golden {res['golden'] or 'none'}", flush=True)
    if rows:
        util.dump_json({"mutations": rows}, os.path.join(fr.OUT, "short-review-report.json"))
    gaps = [r["mutation"] for r in rows if not r["ok"]]
    if not a.only or a.only == "repeats":
        print()
        if not check_reference_repeats():
            gaps.append("reference repeats")
    print(f"\nshort review: {sum(1 for r in rows if r['ok'])} of {len(rows)} mutations caught; gaps: {', '.join(gaps) or 'none'}")
    return 1 if gaps else 0


if __name__ == "__main__":
    sys.exit(main())
