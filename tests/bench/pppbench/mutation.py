"""Gate sensitivity check (docs/GOALS/G00 §9.5).

Copies the SUT snapshot (audio-score.js and scoregraph/, pppbench/sut.py) to
.cache/mutations/<id>/, applies each mutation's exact string replacement
(``find``/``replace``, or several ``replacements`` in order) to its ``file``
(default audio-score.js; a scoregraph/ module since G1, G01 §15.4), runs the
``mutation`` suite on the original and on each copy, and
compares each copy against the original run as a temporary baseline. Every
harmful mutation must be a REGRESSION that names its metric; the no-op
mutation must PASS with a byte-identical results.json.

40 harmful mutations: 5 original, 7 from the independent review (§17), 5 from
its fixer (§18), 13 from the final review and its fixer (§19-§20), 4 from
the short final review and the last fixer (§21: a spurious repeat sign, short
bars marked implicit, a bar split without a repeat, no <staves>), and 3 from
the final pass review and the last fixer (§22: a fake split excused by a lone
forward repeat that cannot fire, a short last bar excused by position alone,
a bar dropped outright with no measure-count gate to catch it): what the app
draws or plays that the gate used to miss. G1 moved the writer mutations from
buildXml to buildGraph (the same defects; the MusicXML is written from the
ScoreGraph since the G1 flip) and added 3 in the ScoreGraph exporter (G01 A38:
no <dot/>, no <time-modification>, treble and bass clefs swapped).
"""

from __future__ import annotations

import os
from typing import Any, Dict, List

from . import compare, runner, stages, suite as suite_mod, sut as sut_mod, util

# G1 (docs/GOALS/G01 §15.3, §20 Step 7): since the flip, toMusicXml writes its MusicXML from the ScoreGraph
# buildGraph builds, so the mutations that edited buildXml's text now make the same defect in buildGraph
# (buildXml stays behind opts.legacyWriter, which the benchmark never sets). Each keeps its id, expectation
# and metrics; what the file says is the same defect as before.
SG_MEASURES = "    for (let i = 0; i < bars; i++) mid.push(b.measure({ number: String(i + 1), dur: W(bar) }).id);"
SG_METER = "    b.meter({ m: mid[0], beats: [beatsPerBar], beatType: beatType });"
SG_TEMPO = ("    b.tempo({ m: mid[0], at: '0', qpm: String(bpm), mark: mark, "
            "display: [{ part: part.id, staff: st[1], placement: 'above' }] });")
SG_CLEF_RH = "    b.clef(part, { staff: st[1], m: mid[0], at: '0', sign: 'G' });"
SG_CLEF_LH = "    b.clef(part, { staff: st[2], m: mid[0], at: '0', sign: 'F' });"
SG_KEY_STATE = "      const state = keyAlters(key.fifths);             /* read only here */"
SG_TRAILING_REST = "      if (bar > cursor) rest(cursor, bar);"
SG_REST_TYPE = "          const t = full ? (TYPES[bar] || TYPES[v] || ['whole', 0]) : (TYPES[v] || ['16th', 0]);"
SG_NOTE_DISPLAY = "          const display = t[1] ? { type: t[0], dots: t[1] } : { type: t[0] };"
SG_ACCIDENTAL = "            if (sp.alter !== current && !tieStop) head.acc = { type: ACCIDENTAL_NAME[sp.alter] };"
SG_SPELL = "            const sp = spell(n.midi, table), k = sp.step + sp.octave;"
SG_EXPORT = "    result.xml = scoreGraph().musicxml.export(built.graph, { software: 'PPP audio transcription' }).xml;"
EXPORTER = "scoregraph/musicxml-export.js"
SG_STAVES = "        if (mi === 0 && multiStaff) at0.push('<staves>' + part.staves.length + '</staves>');"
TAIL_BAR = "Math.floor(bars * 2 / 3)"                                 # two thirds of the way in (fewer than half the bars follow)
OTHER_FIFTHS = "(key.fifths >= 6 ? key.fifths - 1 : key.fifths + 1)"   # one fifth away


def sg_insert(code: str) -> tuple:
    """An edit adding ``code`` after the clefs, where every measure exists."""
    return (SG_CLEF_LH, SG_CLEF_LH + "\n" + code)


def sg_measures(extra: str) -> tuple:
    """An edit giving measure i (0-based) the fields of the JS expression ``extra`` as well."""
    return (SG_MEASURES, "    for (let i = 0; i < bars; i++) mid.push(b.measure(Object.assign({ number: String(i + 1), dur: W(bar) }, "
            + extra + ")).id);")


def sg_tempo_at(bar_expr: str, qpm_expr: str, mark_expr: str) -> tuple:
    return sg_insert(f"    if ({bar_expr} > 0) b.tempo({{ m: mid[{bar_expr}], at: '0', qpm: {qpm_expr}, "
                     f"mark: {{ unit: 'quarter', perMinute: {mark_expr} }}, display: [{{ part: part.id, staff: st[1], placement: 'above' }}] }});")


def sg_key_from(first_bar_cond: str, bar_expr: str) -> list:
    """A key signature one fifth away from ``bar_expr`` on; accidentals follow it (every pitch still right)."""
    return [sg_insert(f"    if ({bar_expr} > 0) b.key({{ m: mid[{bar_expr}], at: '0', fifths: {OTHER_FIFTHS}, mode: key.mode }});"),
            (SG_KEY_STATE, f"      const tailKey = {first_bar_cond};\n"
                           f"      const state = keyAlters(tailKey ? {OTHER_FIFTHS} : key.fifths);")]


def sg_rest_short(cond: str) -> tuple:
    """A trailing rest of two beats or more loses a beat where ``cond`` holds: that staff's bar is short."""
    return (SG_TRAILING_REST, "      if (bar > cursor) rest(cursor, bar - (" + cond + "bar - cursor >= 2 * beatTicks ? beatTicks : 0));")


TEMPO_HALVED_MIDWAY_EDITS = [sg_tempo_at("Math.floor(bars / 2)", "String(Math.round(bpm / 2))", "String(Math.round(bpm / 2))")]
METRE_TAIL_EDITS = [sg_insert(f"    if ({TAIL_BAR} > 0) b.meter({{ m: mid[{TAIL_BAR}], beats: [beatsPerBar * 2], beatType: beatType * 2 }});")]
KEY_TAIL_EDITS = sg_key_from(f"barIdx > 0 && barIdx >= {TAIL_BAR} && {TAIL_BAR} > 0", TAIL_BAR)
DOTS_DROPPED_EDITS = [(SG_NOTE_DISPLAY, "          const display = { type: t[0] };")]
BASS_STAFF_TREBLE_CLEF_EDITS = [(SG_CLEF_LH, "    b.clef(part, { staff: st[2], m: mid[0], at: '0', sign: 'G' });")]
BAR_NUMBERS_RESTART_EDITS = [(SG_MEASURES, SG_MEASURES.replace("String(i + 1)", "String(i % 4 + 1)"))]
ACCIDENTAL_ON_EVERY_NOTE_EDITS = [(SG_ACCIDENTAL, SG_ACCIDENTAL.replace("sp.alter !== current && !tieStop", "!tieStop"))]
TRAILING_RESTS_SHORT_EDITS = [sg_rest_short("")]
RH_RESTS_SHORT = sg_rest_short("staff === 1 && ")

# G00 §21 short review: a backward repeat sign after the middle bar (the app plays the first half twice)
SPURIOUS_REPEAT_EDITS = [sg_measures("i > 0 && i === Math.floor(bars / 2) - 1 ? "
                                     "{ barline: { right: { style: 'light-heavy', repeat: 'backward' } } } : {}")]
# ... the right hand's trailing rest a beat short, and every inner bar marked implicit="yes"
IMPLICIT_SHORT_EDITS = [sg_measures("i > 0 && i < bars - 1 ? { implicit: true } : {}"), RH_RESTS_SHORT]


def _split_edits(forward: bool) -> list:
    """G00 §21 last fixer: the second-to-last bar split in two where no note or rest of either staff crosses
    (the point nearest its middle), with no repeat sign and no change of time signature (two short bars;
    stats.bars and barStarts follow the file). With ``forward``, the second half opens with a lone forward
    repeat no backward repeat anywhere in the file ever consumes (G00 §22, PF-M1)."""
    left = ("\n        N.barline = { left: { style: 'heavy-light', repeat: 'forward' } };" if forward else "")
    code = r"""    /* mutation: the second-to-last bar split in two (no repeat sign, same metre) */
    let splitGraph = built.graph;
    if (bars >= 3) {
      const Rm = scoreGraph().rational, g = JSON.parse(JSON.stringify(built.graph)), ms = g.timeline.measures, M = ms[bars - 2], P = g.parts[0];
      const ends = v => new Set(P.events.filter(e => e.m === M.id && e.voice === v).map(e => Rm.format(Rm.add(Rm.parse(e.at), Rm.parse(e.dur)))));
      const A = ends(P.voices[0].id), B = ends(P.voices[1].id), len = Rm.toNumber(Rm.parse(M.dur));
      let p = null;
      A.forEach(t => {
        const x = Rm.toNumber(Rm.parse(t));
        if (x > 0 && x < len && B.has(t) && (p === null || Math.abs(x - len / 2) < Math.abs(Rm.toNumber(Rm.parse(p)) - len / 2))) p = t;
      });
      if (p !== null) {
        const cut = Rm.parse(p), id = 'm' + g.nextId++;
        const N = { id: id, number: String(bars), dur: Rm.format(Rm.sub(Rm.parse(M.dur), cut)) };""" + left + r"""
        M.dur = p;
        ms.splice(bars - 1, 0, N);
        ms[bars].number = String(bars + 1);
        const move = o => { if (o && o.m === M.id && Rm.ge(Rm.parse(o.at), cut)) { o.m = id; o.at = Rm.format(Rm.sub(Rm.parse(o.at), cut)); } };
        P.events.forEach(move); (P.clefs || []).forEach(move); (P.directions || []).forEach(move);
        (P.spanners || []).forEach(s => { move(s.from); move(s.to); (s.changes || []).forEach(move); });
        (g.timeline.keys || []).forEach(move); (g.timeline.tempos || []).forEach(move);
        splitGraph = g;
        result.stats.bars = bars + 1;
        result.stats.barStarts.splice(bars - 1, 0, Math.round(tickToSec((bars - 2) * bar + Rm.toNumber(cut) * 4 * Q) * 1000) / 1000);
      }
    }
    result.xml = scoreGraph().musicxml.export(splitGraph, { software: 'PPP audio transcription' }).xml;"""
    return [(SG_EXPORT, code)]


FAKE_SPLIT_EDITS = _split_edits(False)
# G00 §22 last fixer: the same fake split, its second half opening with a lone forward repeat (PF-M1)
FORWARD_REPEAT_ONLY_EDITS = _split_edits(True)
NO_STAVES_EDITS = [(SG_STAVES, "        /* mutation: no <staves> */")]
# G00 §22 last fixer: only the final bar's trailing rest loses a beat (every other bar is full); the bar
# count matches the reference exactly, so only bar_completeness's edge exemption can catch it (PF-M2)
TRUNCATED_LAST_MEASURE_EDITS = [sg_rest_short("barIdx === bars - 1 && ")]
# G00 §22 last fixer: the file's last written bar is dropped outright (one fewer measure than the
# reference, stats and barStarts follow); only struct.measures.count_exact catches a bare count mismatch (PF-M2)
DROPPED_LAST_MEASURE_EDITS = [
    ("    const bars = Math.max(1, Math.floor(lastOnset / bar) + 1);",
     "    const bars = Math.max(1, Math.floor(lastOnset / bar));")]

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
     "replacements": [(SG_TEMPO, "    /* mutation: tempo marks dropped */")],
     "expect": "REGRESSION", "metrics": ["struct.tempo.ok_effective", "critical.playback_tempo"]},
    {"id": "ADV-XML-METRE",
     "replacements": [(SG_METER, "    b.meter({ m: mid[0], beats: [beatsPerBar * 2], beatType: beatType * 2 });")],
     "expect": "REGRESSION", "metrics": ["struct.time_sig.exact"]},
    {"id": "ADV-EXTRA-BAR",
     "find": "    const bars = Math.max(1, Math.floor(lastOnset / bar) + 1);",
     "replace": "    const bars = Math.max(1, Math.floor(lastOnset / bar) + 2);",
     "expect": "REGRESSION", "metrics": ["struct.measures.extra_empty_edge"]},
    {"id": "ADV-NO-ACCIDENTAL",
     "replacements": [(SG_ACCIDENTAL, "            /* mutation: no accidentals */")],
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
     "replacements": [(SG_ACCIDENTAL, SG_ACCIDENTAL.replace("!tieStop)", "!tieStop && sp.alter !== 0)"))],
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
     "replacements": TEMPO_HALVED_MIDWAY_EDITS,
     "expect": "REGRESSION", "metrics": ["struct.tempo.timeline_accuracy", "critical.playback_tempo"]},
    {"id": "FIN-METRE-TAIL",            # the last third in a wrong metre of the same bar length (3/4 -> 6/8)
     "replacements": METRE_TAIL_EDITS,
     "expect": "REGRESSION", "metrics": ["struct.time_sig.timeline_accuracy", "critical.meter"]},
    {"id": "FIN-KEY-TAIL",              # the last third under a key signature a fifth away; accidentals follow it
     "replacements": KEY_TAIL_EDITS,
     "expect": "REGRESSION", "metrics": ["struct.key.timeline_accuracy", "critical.key"]},
    {"id": "FIN-DOTS-DROPPED",          # dotted notes printed without their dot; playback unchanged
     "replacements": DOTS_DROPPED_EDITS,
     "expect": "REGRESSION", "metrics": ["notation.note_shape.consistency", "notation.duration.page_accuracy"]},
    {"id": "FIN-NOTE-TYPE-SHORTER",     # every note printed one value shorter than it lasts
     "replacements": [(SG_NOTE_DISPLAY, "          const nt = { whole: 'half', half: 'quarter', quarter: 'eighth', eighth: '16th', '16th': '32nd', '32nd': '64th' }[t[0]] || t[0];\n"
                        "          const display = t[1] ? { type: nt, dots: t[1] } : { type: nt };")],
     "expect": "REGRESSION", "metrics": ["notation.duration.page_accuracy", "notation.note_shape.consistency"]},
    {"id": "FIN-LONG-NOTES-HALVED",     # notes of a beat or longer written at half length (rests fill the rest)
     "find": "      end = readableEnd(t, end, next, bar, beat, ns.some(n => n.tuplet));",
     "replace": "      end = readableEnd(t, end, next, bar, beat, ns.some(n => n.tuplet));\n      if (end - t >= 24) end = t + Math.round((end - t) / 2);",
     "expect": "REGRESSION", "metrics": ["notation.duration.accuracy", "critical.note_values"]},
    {"id": "FIN-BAR-NUMBERS-RESTART",   # 1 2 3 4 1 2 ...: the app lays bars with one number over each other
     "replacements": BAR_NUMBERS_RESTART_EDITS,
     "expect": "REGRESSION", "metrics": ["struct.measure_numbers.app_onset_accuracy", "critical.structure"]},
    {"id": "FIN-BAR-NUMBERS-SKIP",      # 1 2 4 5 ...: a number skipped
     "replacements": [(SG_MEASURES, SG_MEASURES.replace("String(i + 1)", "String(i + 1 + (i >= 2 ? 1 : 0))"))],
     "expect": "REGRESSION", "metrics": ["struct.measure_numbers.valid", "critical.structure"]},
    {"id": "FIN-BAR-NUMBERS-SWAP",      # 1 3 2 4 ...: two numbers out of order
     "replacements": [(SG_MEASURES, SG_MEASURES.replace("String(i + 1)", "String(i === 1 ? 3 : i === 2 ? 2 : i + 1)"))],
     "expect": "REGRESSION", "metrics": ["struct.measure_numbers.valid", "critical.structure"]},
    {"id": "FIN-BASS-STAFF-TREBLE-CLEF",  # the left hand on ledger lines under a treble clef
     "replacements": BASS_STAFF_TREBLE_CLEF_EDITS,
     "expect": "REGRESSION", "metrics": ["read.ledger_lines.heavy_rate"]},
    {"id": "FIN-TRAILING-RESTS-SHORT",  # a trailing rest of two beats or more loses a beat: the staff's bar is short
     "replacements": TRAILING_RESTS_SHORT_EDITS,
     "expect": "REGRESSION", "metrics": ["read.bar_completeness", "critical.structure"]},
    {"id": "FIN-REST-TYPE-LONGER",      # rests printed one value longer than they last
     "replacements": [(SG_REST_TYPE, "          const t0 = TYPES[v] || ['16th', 0];\n"
                     "          const t = full ? (TYPES[bar] || TYPES[v] || ['whole', 0]) : [({ '16th': 'eighth', eighth: 'quarter', quarter: 'half', half: 'whole' }[t0[0]] || 'whole'), t0[1]];")],
     "expect": "REGRESSION", "metrics": ["notation.note_shape.consistency"]},
    {"id": "FIN-ACCIDENTAL-ON-EVERY-NOTE",  # an accidental printed on every struck note (pitch right, page cluttered)
     "replacements": ACCIDENTAL_ON_EVERY_NOTE_EDITS,
     "expect": "REGRESSION", "metrics": ["notation.accidentals.courtesy_per_100"]},
    # --- from the short final review (G00 §21) and the last fixer: repeats, implicit bars, split bars, staves ---
    {"id": "SR-SPURIOUS-REPEAT",          # a repeat sign after the middle bar: the app plays the first half twice
     "replacements": SPURIOUS_REPEAT_EDITS,
     "expect": "REGRESSION", "metrics": ["struct.form.order_exact", "critical.structure"]},
    {"id": "SR-IMPLICIT-MASKS-SHORT-BARS",  # short right-hand bars the prediction marks implicit="yes"
     "replacements": IMPLICIT_SHORT_EDITS,
     "expect": "REGRESSION", "metrics": ["read.bar_completeness", "critical.structure"]},
    {"id": "SR-FAKE-SPLIT-BAR",           # a bar split in two halves with no repeat sign
     "replacements": FAKE_SPLIT_EDITS,
     "expect": "REGRESSION", "metrics": ["read.bar_completeness", "critical.structure"]},
    {"id": "SR-NO-STAVES",                # no <staves>: the app shows the left hand and never plays it
     "file": 'scoregraph/musicxml-export.js',
     "replacements": NO_STAVES_EDITS,
     "expect": "REGRESSION", "metrics": ["notes.identity.f1", "critical.pitch_integrity"]},
    # --- from the G00 §22 final pass review and the last fixer: excused() no longer trusts a repeat
    # mark that could not fire, and a short or missing edge bar is no longer excused by position alone ---
    {"id": "PF-FORWARD-REPEAT-ONLY-EXCUSE",  # a lone forward repeat (no backward repeat anywhere) on a fake split
     "replacements": FORWARD_REPEAT_ONLY_EDITS,
     "expect": "REGRESSION", "metrics": ["read.bar_completeness", "critical.structure"]},
    {"id": "PF-TRUNCATED-LAST-MEASURE",   # only the last bar's trailing rest short; bar count unchanged
     "replacements": TRUNCATED_LAST_MEASURE_EDITS,
     "expect": "REGRESSION", "metrics": ["read.bar_completeness", "critical.structure"]},
    {"id": "PF-DROPPED-LAST-MEASURE",     # the file's last bar is missing outright (one fewer than the reference)
     "replacements": DROPPED_LAST_MEASURE_EDITS,
     "expect": "REGRESSION", "metrics": ["struct.measures.count_exact", "critical.structure"]},
    # --- G1 (docs/GOALS/G01 A38): defects of the ScoreGraph exporter itself, which every score now goes through ---
    {"id": "SG-EXPORT-NO-DOT",            # <dot/> never written: dotted notes and rests print undotted, play unchanged
     "file": EXPORTER,
     "find": "          x += '<dot/>'.repeat(dsp.dots || 0);",
     "replace": "          /* mutation: <dot/> dropped */",
     "expect": "REGRESSION", "metrics": ["notation.note_shape.consistency", "notation.duration.page_accuracy"]},
    {"id": "SG-EXPORT-NO-TIME-MODIFICATION",  # <time-modification> never written: triplets print as plain values
     "file": EXPORTER,
     "find": "        const tmXml = tm ? '<time-modification>",
     "replace": "        const tmXml = false ? '<time-modification>",
     "expect": "REGRESSION", "metrics": ["notation.tuplets.f1"]},
    {"id": "SG-EXPORT-CLEF-SWAP",         # every treble clef written as bass and every bass clef as treble
     "file": EXPORTER,
     "find": "      function clefXml(c) {\n",
     "replace": "      function clefXml(c) {\n        c = Object.assign({}, c, { sign: { G: 'F', F: 'G' }[c.sign] || c.sign, line: undefined });\n",
     "expect": "REGRESSION", "metrics": ["read.ledger_lines.heavy_rate"]},
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


def target(mut: Dict[str, Any]) -> str:
    """The SUT file a mutation edits, relative to the SUT directory."""
    return mut.get("file", sut_mod.ENTRY)


def apply_mutation(source: str, mut: Dict[str, Any]) -> str:
    for find, replace in edits(mut):
        n = source.count(find)
        if n != 1:
            raise AnchorMissing(f"{mut['id']}: anchor found {n} times (must be exactly once). {target(mut)} changed; "
                                "update the anchor in tests/bench/pppbench/mutation.py")
        source = source.replace(find, replace)
    return source


def write_mutant(mut: Dict[str, Any], sut: str) -> str:
    """A copy of the whole SUT snapshot of ``sut`` in .cache/mutations/<id>/ with the mutation applied to
    its target file. Returns the copy's entry (audio-score.js) path."""
    try:
        return sut_mod.write_mutant_dir(os.path.join(MUT_DIR, mut["id"]), {target(mut): edits(mut)},
                                        entry=sut, label=mut["id"])
    except sut_mod.SutError as exc:
        raise AnchorMissing(f"{exc}. Update the anchor in tests/bench/pppbench/mutation.py") from exc


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
