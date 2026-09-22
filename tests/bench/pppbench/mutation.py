"""Gate sensitivity check (docs/GOALS/G00 §9.5).

Copies audio-score.js to .cache/mutations/, applies each mutation's exact
string replacement (``find``/``replace``, or several ``replacements`` in
order), runs the ``mutation`` suite on the original and on each copy, and
compares each copy against the original run as a temporary baseline. Every
harmful mutation must be a REGRESSION that names its metric; the no-op
mutation must PASS with a byte-identical results.json.

30 harmful mutations: 5 original, 7 from the independent review (§17), 5 from
its fixer (§18), and 13 from the final review and its fixer (§19-§20): what the
app draws or plays that the gate used to miss.
"""

from __future__ import annotations

import os
from typing import Any, Dict, List

from . import compare, runner, stages, suite as suite_mod, util

BAR_LOOP = "      out.push(writeStaff(b1[b], 1, 1, b));"          # buildXml's per-bar loop
TAIL = "(b > 0 && b === Math.floor(bars * 2 / 3))"             # two thirds of the way in (fewer than half the bars follow)

MUTATIONS: List[Dict[str, Any]] = [
    {"id": "MUT-HANDS",
     "find": "groups[g].notes.forEach(n => { n.staff = n.midi >= s ? 1 : 2; });",
     "replace": "groups[g].notes.forEach(n => { n.staff = n.midi >= 60 ? 1 : 2; });",
     "expect": "REGRESSION", "metrics": ["notation.hand.accuracy"]},
    {"id": "MUT-KEY",
     "find": "best.margin = best.score - second;",
     "replace": "best = { fifths: 0, mode: 'major', tonic: 0, r: 0, score: 0, diatonicFit: 0 }; best.margin = 1;",
     "expect": "REGRESSION", "metrics": ["struct.key.fifths_exact"]},
    {"id": "MUT-DUR",
     "find": "let end = ends[Math.floor((ends.length - 1) / 2)];",
     "replace": "let end = t + 6;",
     "expect": "REGRESSION", "metrics": ["notation.duration.accuracy"]},
    {"id": "MUT-METRE",
     "find": "      beatsPerBar = pick.beats;\n      beatType = pick.beatType;",
     "replace": "      beatsPerBar = 2;\n      beatType = 4;",
     "expect": "REGRESSION", "metrics": ["struct.time_sig.exact"]},
    {"id": "MUT-PHASE",
     "find": "      if (beatType === 4) origin = (pick.phase || 0) * Q;",
     "replace": "      if (beatType === 4) origin = ((pick.phase || 0) + 1) * Q;",
     "expect": "REGRESSION", "metrics": ["notation.onset_pos.accuracy", "struct.downbeat.f1"]},
    # --- from the independent review (G00 §17) and the fixer: regressions gate/1 missed ---
    {"id": "ADV-NO-TEMPO",
     "find": """        out.push('<direction placement="above"><direction-type>' + metro + '</direction-type><staff>1</staff><sound tempo="' + bpm + '"/></direction>');""",
     "replace": "        /* mutation: tempo marks dropped */",
     "expect": "REGRESSION", "metrics": ["struct.tempo.ok_effective", "critical.playback_tempo"]},
    {"id": "ADV-XML-METRE",
     "find": """'</mode></key><time><beats>' + beatsPerBar + '</beats><beat-type>' + beatType + '</beat-type></time><staves>2</staves>'""",
     "replace": """'</mode></key><time><beats>' + (beatsPerBar * 2) + '</beats><beat-type>' + (beatType * 2) + '</beat-type></time><staves>2</staves>'""",
     "expect": "REGRESSION", "metrics": ["struct.time_sig.exact"]},
    {"id": "ADV-EXTRA-BAR",
     "find": "    const bars = Math.max(1, Math.floor(lastOnset / bar) + 1);",
     "replace": "    const bars = Math.max(1, Math.floor(lastOnset / bar) + 2);",
     "expect": "REGRESSION", "metrics": ["struct.measures.extra_empty_edge"]},
    {"id": "ADV-NO-ACCIDENTAL",
     "find": """              acc = '<accidental>' + ({ '-2': 'flat-flat', '-1': 'flat', '0': 'natural', '1': 'sharp', '2': 'double-sharp' }[sp.alter]) + '</accidental>';""",
     "replace": "              acc = '';",
     "expect": "REGRESSION", "metrics": ["notation.accidentals.required_recall"]},
    {"id": "ADV-NO-PEDAL",
     "find": "    (extra.pedals || []).forEach(p => {",
     "replace": "    ([]).forEach(p => {",
     "expect": "REGRESSION", "metrics": ["notation.pedal.f1"]},
    {"id": "ADV-GLOBAL-TEMPO",
     "find": "    return lo + (t - beats[lo]) / (beats[lo + 1] - beats[lo]);\n  }\n\n  function ibiOf(beats) {",
     "replace": "    return (t - beats[0]) / ((beats[beats.length - 1] - beats[0]) / (beats.length - 1));\n  }\n\n  function ibiOf(beats) {",
     "expect": "REGRESSION", "metrics": ["case:sqi", "notes.identity.f1", "sqi"]},
    {"id": "ADV-MINOR-LEADING-TONE",
     "find": "    minor: { 1: -1, 4: 1, 6: 1, 9: 1, 11: 1 }",
     "replace": "    minor: { 1: -1, 4: 1, 6: 1, 9: 1, 11: -1 }",
     "expect": "REGRESSION", "metrics": ["micro:notation.spelling.accuracy", "tag:mode:minor"]},
    {"id": "FIX-HIGH-NOTES-LEFT-HAND",
     "find": "groups[g].notes.forEach(n => { n.staff = n.midi >= s ? 1 : 2; });",
     "replace": "groups[g].notes.forEach(n => { n.staff = n.midi >= s && n.midi < 84 ? 1 : 2; });",
     "expect": "REGRESSION", "metrics": ["notation.hand.accuracy", "critical.hands"]},
    {"id": "FIX-NO-TRIPLETS",
     "find": "      if (e3 * 1.02 < e16 && (off16 >= 2 || (fs.length % 3 === 0 && fs.length >= 3))) flags[+k] = true;",
     "replace": "      if (false) flags[+k] = true;",
     "expect": "REGRESSION", "metrics": ["notation.tuplets.f1", "tag:feature:tuplets"]},
    {"id": "FIX-NO-NATURALS",
     "find": "            if (sp.alter !== current && !tieStop) {",
     "replace": "            if (sp.alter !== current && !tieStop && sp.alter !== 0) {",
     "expect": "REGRESSION", "metrics": ["notation.accidentals.required_recall"]},
    {"id": "FIX-DROP-LAST-BAR",
     "find": "    const bars = Math.max(1, Math.floor(lastOnset / bar) + 1);",
     "replace": "    const bars = Math.max(1, Math.floor(lastOnset / bar));",
     "expect": "REGRESSION", "metrics": ["notes.identity.f1", "critical.pitch_integrity"]},
    {"id": "FIX-STATS-LATE-BARS",
     "find": "    for (let b = 0; b <= bars; b++) barStarts.push(Math.round(tickToSec(b * bar) * 1000) / 1000);",
     "replace": "    for (let b = 0; b <= bars; b++) barStarts.push(Math.round(tickToSec(b * bar + ticksPerBeat) * 1000) / 1000);",
     "expect": "REGRESSION", "metrics": ["struct.downbeat.f1", "notes.identity.f1"]},
    # --- from the final independent review (G00 §19) and its fixer: what the app draws or plays that the
    # metric gate did not read. Each must be a REGRESSION on the metric added for it.
    {"id": "FIN-TEMPO-HALVED-MIDWAY",   # a printed and played change to half speed at the middle bar
     "find": BAR_LOOP,
     "replace": """      if (b > 0 && b === Math.floor(bars / 2)) out.push('<direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>' + Math.round(bpm / 2) + '</per-minute></metronome></direction-type><staff>1</staff><sound tempo="' + Math.round(bpm / 2) + '"/></direction>');\n""" + BAR_LOOP,
     "expect": "REGRESSION", "metrics": ["struct.tempo.timeline_accuracy", "critical.playback_tempo"]},
    {"id": "FIN-METRE-TAIL",            # the last third in a wrong metre of the same bar length (3/4 -> 6/8)
     "find": BAR_LOOP,
     "replace": "      if " + TAIL + " out.push('<attributes><time><beats>' + (beatsPerBar * 2) + '</beats><beat-type>' + (beatType * 2) + '</beat-type></time></attributes>');\n" + BAR_LOOP,
     "expect": "REGRESSION", "metrics": ["struct.time_sig.timeline_accuracy", "critical.meter"]},
    {"id": "FIN-KEY-TAIL",              # the last third under a key signature a fifth away; accidentals follow it
     "replacements": [
         (BAR_LOOP, "      if " + TAIL + " out.push('<attributes><key><fifths>' + (key.fifths >= 6 ? key.fifths - 1 : key.fifths + 1) + '</fifths><mode>' + key.mode + '</mode></key></attributes>');\n" + BAR_LOOP),
         ("      const state = Object.assign({}, keyAlters(key.fifths));",
          "      const tailKey = barIdx > 0 && barIdx >= Math.floor(bars * 2 / 3) && Math.floor(bars * 2 / 3) > 0;\n"
          "      const state = Object.assign({}, keyAlters(tailKey ? (key.fifths >= 6 ? key.fifths - 1 : key.fifths + 1) : key.fifths));")],
     "expect": "REGRESSION", "metrics": ["struct.key.timeline_accuracy", "critical.key"]},
    {"id": "FIN-DOTS-DROPPED",          # dotted notes printed without their dot; playback unchanged
     "find": """'</voice><type>' + t[0] + '</type>' + (t[1] ? '<dot/>' : '') + tm + acc +""",
     "replace": """'</voice><type>' + t[0] + '</type>' + tm + acc +""",
     "expect": "REGRESSION", "metrics": ["notation.note_shape.consistency", "notation.duration.page_accuracy"]},
    {"id": "FIN-NOTE-TYPE-SHORTER",     # every note printed one value shorter than it lasts
     "find": """'</voice><type>' + t[0] + '</type>' + (t[1] ? '<dot/>' : '') + tm + acc +""",
     "replace": """'</voice><type>' + ({ whole: 'half', half: 'quarter', quarter: 'eighth', eighth: '16th', '16th': '32nd', '32nd': '64th' }[t[0]] || t[0]) + '</type>' + (t[1] ? '<dot/>' : '') + tm + acc +""",
     "expect": "REGRESSION", "metrics": ["notation.duration.page_accuracy", "notation.note_shape.consistency"]},
    {"id": "FIN-LONG-NOTES-HALVED",     # notes of a beat or longer written at half length (rests fill the rest)
     "find": "      end = readableEnd(t, end, next, bar, beat, ns.some(n => n.tuplet));",
     "replace": "      end = readableEnd(t, end, next, bar, beat, ns.some(n => n.tuplet));\n      if (end - t >= 24) end = t + Math.round((end - t) / 2);",
     "expect": "REGRESSION", "metrics": ["notation.duration.accuracy", "critical.note_values"]},
    {"id": "FIN-BAR-NUMBERS-RESTART",   # 1 2 3 4 1 2 ...: the app lays bars with one number over each other
     "find": """      out.push('<measure number="' + (b + 1) + '">');""",
     "replace": """      out.push('<measure number="' + (b % 4 + 1) + '">');""",
     "expect": "REGRESSION", "metrics": ["struct.measure_numbers.app_onset_accuracy", "critical.structure"]},
    {"id": "FIN-BAR-NUMBERS-SKIP",      # 1 2 4 5 ...: a number skipped
     "find": """      out.push('<measure number="' + (b + 1) + '">');""",
     "replace": """      out.push('<measure number="' + (b + 1 + (b >= 2 ? 1 : 0)) + '">');""",
     "expect": "REGRESSION", "metrics": ["struct.measure_numbers.valid", "critical.structure"]},
    {"id": "FIN-BAR-NUMBERS-SWAP",      # 1 3 2 4 ...: two numbers out of order
     "find": """      out.push('<measure number="' + (b + 1) + '">');""",
     "replace": """      out.push('<measure number="' + (b === 1 ? 3 : b === 2 ? 2 : b + 1) + '">');""",
     "expect": "REGRESSION", "metrics": ["struct.measure_numbers.valid", "critical.structure"]},
    {"id": "FIN-BASS-STAFF-TREBLE-CLEF",  # the left hand on ledger lines under a treble clef
     "find": """<clef number="2"><sign>F</sign><line>4</line></clef>""",
     "replace": """<clef number="2"><sign>G</sign><line>2</line></clef>""",
     "expect": "REGRESSION", "metrics": ["read.ledger_lines.heavy_rate"]},
    {"id": "FIN-TRAILING-RESTS-SHORT",  # a trailing rest of two beats or more loses a beat: the staff's bar is short
     "find": "      if (cursor < bar) rest(cursor, bar);",
     "replace": "      if (cursor < bar) rest(cursor, bar - (bar - cursor >= 2 * beatTicks ? beatTicks : 0));",
     "expect": "REGRESSION", "metrics": ["read.bar_completeness", "critical.structure"]},
    {"id": "FIN-REST-TYPE-LONGER",      # rests printed one value longer than they last
     "find": "          const t = full ? TYPES[bar] || TYPES[v] || ['whole', 0] : TYPES[v] || ['16th', 0];",
     "replace": "          const t0 = TYPES[v] || ['16th', 0];\n          const t = full ? TYPES[bar] || TYPES[v] || ['whole', 0] : [({ '16th': 'eighth', eighth: 'quarter', quarter: 'half', half: 'whole' }[t0[0]] || 'whole'), t0[1]];",
     "expect": "REGRESSION", "metrics": ["notation.note_shape.consistency"]},
    {"id": "FIN-ACCIDENTAL-ON-EVERY-NOTE",  # an accidental printed on every struck note (pitch right, page cluttered)
     "find": "            if (sp.alter !== current && !tieStop) {",
     "replace": "            if (!tieStop) {",
     "expect": "REGRESSION", "metrics": ["notation.accidentals.courtesy_per_100"]},
    {"id": "MUT-NOOP",
     "find": "  const api = {",
     "replace": "  /* noop mutation */\n  const api = {",
     "expect": "PASS", "metrics": []},
]

MUT_DIR = os.path.join(runner.CACHE_DIR, "mutations")


class AnchorMissing(Exception):
    code = "MUTATION_ANCHOR_MISSING"


def edits(mut: Dict[str, Any]) -> List[tuple]:
    """A mutation's (find, replace) edits: one, or several applied in order."""
    return list(mut["replacements"]) if "replacements" in mut else [(mut["find"], mut["replace"])]


def apply_mutation(source: str, mut: Dict[str, Any]) -> str:
    for find, replace in edits(mut):
        n = source.count(find)
        if n != 1:
            raise AnchorMissing(f"{mut['id']}: anchor found {n} times (must be exactly once). audio-score.js changed; "
                                "update the anchor in tests/bench/pppbench/mutation.py")
        source = source.replace(find, replace)
    return source


def write_mutant(mut: Dict[str, Any], sut: str) -> str:
    with open(sut, "rb") as handle:
        source = util.normalise_eol(handle.read()).decode("utf-8")
    text = apply_mutation(source, mut)
    path = os.path.join(MUT_DIR, mut["id"] + ".js")
    os.makedirs(MUT_DIR, exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as handle:
        handle.write(text)
    return path


def run_mutation_check(mutations=None, suite_name: str = "mutation") -> int:
    suite = suite_mod.load_suite(suite_name)
    gate = suite.get("gate") or {}
    sut = stages.default_audio_score()
    mutations = mutations or MUTATIONS
    try:
        paths = {m["id"]: write_mutant(m, sut) for m in mutations}
    except AnchorMissing as exc:
        print(f"ERROR {AnchorMissing.code}: {exc}")
        return 2
    out_root = os.path.join(runner.OUT_DIR, "mutation")
    orig = runner.run_suite(suite, audio_score=sut, out_dir=os.path.join(out_root, "original"), write_cases=False, quiet=True)
    base = compare.baseline_from_results(orig["results"], orig["run"], reason="mutation-check original", gate=gate)
    orig_sha = util.sha256_file(os.path.join(orig["out"], "results.json"))
    rows, ok_all = [], True
    for m in mutations:
        r = runner.run_suite(suite, audio_score=paths[m["id"]], out_dir=os.path.join(out_root, m["id"]),
                             write_cases=False, quiet=True)
        v = compare.compare(r["results"], base, gate)
        sha = util.sha256_file(os.path.join(r["out"], "results.json"))
        hit = [x for x in m["metrics"] if x in v.failed_metrics]
        if m["expect"] == "PASS":
            passed = v.status == "PASS" and sha == orig_sha
        else:
            passed = v.status == "REGRESSION" and bool(hit)
        ok_all &= passed
        moved = {k: (d["baseline"], d["value"]) for k, d in v.deltas.items() if abs(d["delta"]) > 1e-9}
        rows.append({"id": m["id"], "expect": m["expect"], "status": v.status, "exit": v.exit_code, "ok": passed,
                     "expected_metrics": m["metrics"], "failed_metrics": v.failed_metrics,
                     "identical_results": sha == orig_sha, "moved": moved})
        print(f"{m['id']:10} expect {m['expect']:10} got {v.status:10} exit {v.exit_code} "
              f"{'OK ' if passed else 'BAD'} failed={','.join(v.failed_metrics) or '-'}"
              + (f" identical_results={sha == orig_sha}" if m["expect"] == "PASS" else ""))
        for k in m["metrics"]:
            if k in moved:
                print(f"{'':12}{k}: {moved[k][0]:.4f} -> {moved[k][1]:.4f}")
    util.dump_json({"schema": "ppp.bench-mutation/1", "suite": suite_name,
                    "original_results_sha256": orig_sha, "mutations": rows}, os.path.join(out_root, "mutation-report.json"))
    print(f"mutation-check: {'PASS' if ok_all else 'FAIL'} — every harmful mutation caught, the no-op identical"
          if ok_all else "mutation-check: FAIL — see above")
    return 0 if ok_all else 1
