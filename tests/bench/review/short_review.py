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

    python tests/bench/review/short_review.py                # every mutation, exit 1 when one is not caught
    python tests/bench/review/short_review.py --only NAME

Outputs: tests/bench/out/short-review/ (git-ignored). audio-score.js is never modified.
"""

from __future__ import annotations

import argparse
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.dirname(HERE))

import final_review as fr  # noqa: E402  (its gate and golden helpers)
from pppbench import stages, util  # noqa: E402

util.setup_stdio()
fr.OUT = os.path.join(fr.BENCH, "out", "short-review")

BAR_LOOP = fr.BAR_LOOP
MEASURE_OPEN = """      out.push('<measure number="' + (b + 1) + '">');"""
TRAILING_REST = "      if (cursor < bar) rest(cursor, bar);"
RH_SHORT = ("      if (cursor < bar) rest(cursor, bar - (staff === 1 && bar - cursor >= 2 * beatTicks ? beatTicks : 0));")
LAST_TWO = "(b > 0 && b === bars - 2)"

# name -> (area, what the user gets, expected core status, [(find, replace), ...])
MUTATIONS = {
    "SR-SPURIOUS-REPEAT": (
        "measure structure / sounding order",
        "a repeat sign after the middle bar: the app plays the first half twice",
        "REGRESSION",
        [("      out.push('</measure>');",
          "      if (b > 0 && b === Math.floor(bars / 2) - 1) out.push('<barline location=\"right\"><bar-style>light-heavy"
          "</bar-style><repeat direction=\"backward\"/></barline>');\n      out.push('</measure>');")]),
    "SR-IMPLICIT-MASKS-SHORT-BARS": (
        "measure completeness",
        "right-hand bars a beat short wherever the bar ends in a long rest; inner bars flagged implicit",
        "REGRESSION",
        [(MEASURE_OPEN,
          """      out.push('<measure number="' + (b + 1) + '"' + (b > 0 && b < bars - 1 ? ' implicit="yes"' : '') + '>');"""),
         (TRAILING_REST, RH_SHORT)]),
    "SR-RH-RESTS-SHORT": (
        "measure completeness (control)",
        "right-hand bars a beat short wherever the bar ends in a long rest",
        "REGRESSION",
        [(TRAILING_REST, RH_SHORT)]),
    "SR-RH-ALTO-CLEF": (
        "clef",
        "the right-hand staff in alto clef: every right-hand note reads a different pitch",
        "REGRESSION",
        [("""<clef number="1"><sign>G</sign><line>2</line></clef>""",
          """<clef number="1"><sign>C</sign><line>3</line></clef>""")]),
    "SR-PRINTED-TEMPO-MIDWAY": (
        "tempo sequence (printed, control)",
        "a printed metronome mark at half tempo in the middle bar; the app neither draws it nor plays it",
        "PASS",
        [(BAR_LOOP,
          "      if (b > 0 && b === Math.floor(bars / 2)) out.push('<direction placement=\"above\"><direction-type>"
          "<metronome><beat-unit>quarter</beat-unit><per-minute>' + Math.round(bpm / 2) + '</per-minute></metronome>"
          "</direction-type><staff>1</staff></direction><direction><direction-type><words/></direction-type>"
          "<staff>1</staff><sound tempo=\"' + (compound ? bpm * 1.5 : bpm) + '\"/></direction>');\n" + BAR_LOOP)]),
    "SR-KEY-LAST-TWO-BARS": (
        "key sequence (threshold)",
        "the last two bars under a key signature one fifth away; accidentals keep every pitch right",
        "REGRESSION",
        [(BAR_LOOP,
          "      if " + LAST_TWO + " out.push('<attributes><key><fifths>' + (key.fifths >= 6 ? key.fifths - 1 : key.fifths + 1)"
          " + '</fifths><mode>' + key.mode + '</mode></key></attributes>');\n" + BAR_LOOP),
         ("      const state = Object.assign({}, keyAlters(key.fifths));",
          "      const tailKey = barIdx > 0 && barIdx >= bars - 2;\n"
          "      const state = Object.assign({}, keyAlters(tailKey ? (key.fifths >= 6 ? key.fifths - 1 : key.fifths + 1) : key.fifths));")]),
    "SR-NO-STAVES": (
        "staff structure (control)",
        "no <staves>: the app reads the left-hand staff as a cue staff and never plays it",
        "REGRESSION",
        [("<staves>2</staves>", "")]),
}


def write_mutant(name: str) -> str:
    src = util.normalise_eol(open(stages.default_audio_score(), "rb").read()).decode("utf-8")
    for find, repl in MUTATIONS[name][3]:
        n = src.count(find)
        if n != 1:
            raise RuntimeError(f"{name}: anchor found {n} times: {find[:60]}")
        src = src.replace(find, repl)
    path = os.path.join(fr.OUT, "mutants", name + ".js")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as h:
        h.write(src)
    return path


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--only")
    a = ap.parse_args()
    suites = ("core", "smoke", "robust")
    base_sha = {s: fr.gate(s, stages.default_audio_score(), "unmutated")[2] for s in suites}
    rows = []
    for name, (area, what, expect, _) in MUTATIONS.items():
        if a.only and a.only != name:
            continue
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
    util.dump_json({"mutations": rows}, os.path.join(fr.OUT, "short-review-report.json"))
    gaps = [r["mutation"] for r in rows if not r["ok"]]
    print(f"\nshort review: {len(rows) - len(gaps)} of {len(rows)} caught; gaps: {', '.join(gaps) or 'none'}")
    return 1 if gaps else 0


if __name__ == "__main__":
    sys.exit(main())
