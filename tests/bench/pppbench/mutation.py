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

G3 (docs/GOALS/G03 §20.5, A37; §29 M3, M6) adds 7 mutations of its own passes and input and a no-op control, run as
their own group:
G3 is off by default until its flip, so the group's original and every one of its mutants first turn it on
(``base: G3_ON``) and each mutant is judged against that G3-on original. They must regress the nq.* metric
(or the G0 metric) the pass exists for. The critic and the imported-slur mutations of §20.5 (7, 8) cannot
be seen by a transcription benchmark (it has no imported file, and the critic hands back a safe input), so
they are tests/scoregraph/g3-mutation.test.js's.
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
SG_TEMPO = ("    b.tempo({ m: mid[0], at: '0', qpm: model.qpm != null ? model.qpm : String(bpm), mark: mark, "
            "display: [{ part: part.id, staff: st[1], placement: 'above' }] });")   # G10a-1: model.qpm is v2's (issue 1)
SG_CLEF_RH = "    b.clef(part, { staff: st[1], m: mid[0], at: '0', sign: 'G' });"
SG_CLEF_LH = "    b.clef(part, { staff: st[2], m: mid[0], at: '0', sign: 'F' });"
SG_KEY_STATE = "      const state = keyAlters(key.fifths);             /* read only here */"
SG_TRAILING_REST = "      if (bar > cursor) rest(cursor, bar);"
SG_REST_TYPE = "          const t = full ? (TYPES[bar] || TYPES[v] || ['whole', 0]) : (TYPES[v] || ['16th', 0]);"
SG_NOTE_DISPLAY = "          const display = t[1] ? { type: t[0], dots: t[1] } : { type: t[0] };"
SG_ACCIDENTAL = "            if (sp.alter !== current && !tieStop) head.acc = { type: ACCIDENTAL_NAME[sp.alter] };"
SG_SPELL = "            const sp = spell(n.midi, table), k = sp.step + sp.octave;"
# G03 Step 6: toMusicXml exports `graph` (the built graph, or G3's when opts.professional is 'on')
SG_EXPORT = "    result.xml = scoreGraph().musicxml.export(graph, { software: 'PPP audio transcription' }).xml;"
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
    let splitGraph = graph;
    if (bars >= 3) {
      const Rm = scoreGraph().rational, g = JSON.parse(JSON.stringify(graph)), ms = g.timeline.measures, M = ms[bars - 2], P = g.parts[0];
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

# G3 (G03 §20.5): what turns G3 on for the group's original and mutants (empty once G3 is on by default)
G3_ON = [("  const PROFESSIONAL_DEFAULT = 'off';", "  const PROFESSIONAL_DEFAULT = 'on';")]
PRO = "scoregraph/pro-"

G3_MUTATIONS: List[Dict[str, Any]] = [
    {"id": "G3-F1-PIECE-BRACKETS",      # (1) a bracket over every triplet piece again (G1 F1)
     "base": "g3", "file": PRO + "tuplet.js",
     "find": "            const plan = groups.map(x => ({ events: x.events, actual: 3, normal: 2, unit: { type: x.unit } }));",
     "replace": "            const plan = groups.reduce((a, x) => a.concat(x.events.map(id => ({ events: [id], actual: 3, normal: 2, unit: { type: x.unit } }))), []);",
     "expect": "REGRESSION", "metrics": ["nq.tuplet.one_note_rate"]},
    {"id": "G3-TRIPLET-REST-NO-TM",     # (2) a rest is never a triplet piece: it gets no time-modification (issue 19)
     "base": "g3", "file": PRO + "tuplet.js",
     "find": "    if (!e.display || !e.display.type) return false;",
     "replace": "    if (!e.display || !e.display.type || e.kind === 'rest') return false;",
     # the reason split sees what the pass is for: these are not R17 residuals (§29 M6 proof 2)
     "expect": "REGRESSION", "metrics": ["nq.shape.tm_missing.unexpected"]},
    {"id": "G3-TIES-IN-BEAT",           # (3) R-repr keeps every writing the grid allows: ties inside a beat come back
     "base": "g3", "file": PRO + "rhythm.js",
     "find": "    return w.cost < now.cost;",
     "replace": "    return false;",
     # ties one legal symbol could replace: mergeable defects, not ties an H6/H7 rule requires (§29 M6 proof 1)
     "expect": "REGRESSION", "metrics": ["nq.tie.mergeable.defect"]},
    {"id": "G3-BEAM-ACROSS-BEATS",      # (4) one beam group per measure: beams run over the beat boundaries
     "base": "g3", "file": PRO + "beam.js",
     "find": "    const spans = MG.beamGroups(gr);",
     "replace": "    const spans = [[-100000, 100000]];",
     "expect": "REGRESSION", "metrics": ["nq.beam.boundary_ok"]},
    {"id": "G3-ACC-BAR-STATE",          # (5) the accidental plan forgets what the bar already printed: a note after an
     # accidental of its step reads the key signature again, so the natural back is lost (and a repeat is printed).
     # Replaces G3-SPELL-STATIC (keys by region off), which changed nothing: no recording in the suite modulates for
     # the one-fifth rule (G03 §28 M3)
     "base": "g3", "file": PRO + "spell.js",
     "find": "          const prevailing = state.has(k) ? state.get(k) : sig[p.step];",
     "replace": "          const prevailing = sig[p.step];",
     "expect": "REGRESSION", "metrics": ["critical.accidentals", "notation.accidentals.required_recall"]},
    {"id": "G3-R17-GROW",               # (6b) the tiny release gap before a triplet onset is no longer closed: more
     # one-tick releases reach G3, which keeps them as written (R17, G3b's). Nothing G3a should have written, so only
     # the R17 count sees it: R17 is left to G3b but must not grow (§29 M6 proof 3, U-1)
     "base": "g3",
     "find": "        if (gap <= Math.max(1, Math.round(span * 0.2)) &&",
     "replace": "        if (!ns.some(n => n.tuplet) && gap <= Math.max(1, Math.round(span * 0.2)) &&",
     "expect": "REGRESSION", "metrics": ["nq.shape.tm_missing.r17"]},
    {"id": "G3-HANDS-NO-KEEP",          # (6) the hand DP's keep term is 0: the staff the writer chose counts for nothing.
     # Replaces G3-HANDS-NO-MELODY, which the fixed hand model (G03 §29 M1: keep, keepWhereNotBetter, the fixed point)
     # left inside tolerance: hand accuracy 0.9187 -> 0.9159 on the mutation suite, a dead mutation (§29 M3)
     "base": "g3", "file": PRO + "staff.js",
     "find": "TUPLET: 1500, KEEP: 900,",
     "replace": "TUPLET: 1500, KEEP: 0,",
     "expect": "REGRESSION", "metrics": ["notation.hand.accuracy"]},
    {"id": "G3-NOOP",                   # the G3 group's control: a comment, and nothing moves
     "base": "g3", "file": PRO + "rhythm.js",
     "find": "    return w.cost < now.cost;",
     "replace": "    /* noop mutation */\n    return w.cost < now.cost;",
     "expect": "PASS", "metrics": []},
]
BASES: Dict[str, List[tuple]] = {"g3": G3_ON}

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
# the G3 group goes before the plain no-op, which stays last (the unit tests read it as MUTATIONS[-1])
MUTATIONS = MUTATIONS[:-1] + G3_MUTATIONS + MUTATIONS[-1:]

# G10a-0 (docs/GOALS/G10 section 15 step 3): one planted defect per recording metric (metrics/rec.py), run on the
# `rec-mutation` suite (the recording path with the app's options and the library default, which is where the
# defect has to show). Each must be a REGRESSION that names its metric; the no-op must leave results.json byte
# identical. rec.check.<class> is a family: the planted defects below move classes 1, 2, 3, 5, 6 and 7.
REC_MUTATIONS: List[Dict[str, Any]] = [
    {"id": "REC-REST-MIN-ZERO",           # the shortest rest an exact bar writes: an eighth -> none, so a 16th rest sits between notes
     "find": "  const REST_MIN = 1 / 8;",
     "replace": "  const REST_MIN = 0;",
     "all": True, "expect": "REGRESSION", "metrics": ["rec.rest.false_per_100_bars", "rec.check.1"]},
    {"id": "REC-NO-TRAILING-RESTS",       # the silence at the end of a bar is never written
     "replacements": [(SG_TRAILING_REST, "      /* mutation: no trailing rests */")],
     "all": True, "expect": "REGRESSION", "metrics": ["rec.rest.recall"]},
    {"id": "REC-EXACT-BARS-OFF",          # the app's exact bars switched off: the library's bars, as they were before G9
     "replacements": [("    if (opts.exactBars && !opts.legacyWriter && (opts.sourceKind || 'audio-score') === 'audio-score' && beatType === 4",
                       "    if (false && opts.exactBars && !opts.legacyWriter && (opts.sourceKind || 'audio-score') === 'audio-score' && beatType === 4"),
                      ("    const exactOn = !!opts.exactBars &&", "    const exactOn = false && !!opts.exactBars &&")],
     "all": True, "expect": "REGRESSION", "metrics": ["rec.check.2", "rec.check.5", "rec.check.6", "rec.check.7"]},
    {"id": "REC-TRIPLETS-EVERYWHERE",     # every beat with two onsets is called a triplet beat
     "find": "      if (e3 * 1.02 < e16 && (off16 >= 2 || (fs.length % 3 === 0 && fs.length >= 3))) flags[+k] = true;",
     "replace": "      flags[+k] = true;",
     "all": True, "expect": "REGRESSION", "metrics": ["rec.tuplet.precision", "rec.tuplet.false_per_100_beats"]},
    {"id": "REC-NO-TRIPLETS",             # no beat is ever a triplet beat
     "find": "      if (e3 * 1.02 < e16 && (off16 >= 2 || (fs.length % 3 === 0 && fs.length >= 3))) flags[+k] = true;",
     "replace": "      if (false) flags[+k] = true;",
     "all": True, "expect": "REGRESSION", "metrics": ["rec.tuplet.recall"]},
    {"id": "REC-VOICE-MERGE",             # both hands written as one voice: every note on the upper staff
     "find": "groups[g].notes.forEach(n => { n.staff = n.midi >= s ? 1 : 2; });",
     "replace": "groups[g].notes.forEach(n => { n.staff = 1; });",
     "all": True, "expect": "REGRESSION", "metrics": ["rec.voice.f1", "rec.usable"]},
    {"id": "REC-BAR-PHASE",               # the bar line one beat late: every note in the wrong place of the wrong bar
     "find": "      if (beatType === 4) origin = (pick.phase || 0) * Q;",
     "replace": "      if (beatType === 4) origin = ((pick.phase || 0) + 1) * Q;",
     "all": True, "expect": "REGRESSION", "metrics": ["rec.onset_f1", "rec.metre.f1", "rec.harmony.agreement", "rec.mv2h"]},
    {"id": "REC-PHASE-FROM-MILLISECONDS",  # the bar line depends on the milliseconds of the first onset: 10 ms of noise moves it
     "find": "      if (beatType === 4) origin = (pick.phase || 0) * Q;",
     "replace": "      if (beatType === 4) origin = (((pick.phase || 0) + (Math.floor(input.notes[0].on * 1000) % 3)) % Math.max(1, beatsPerBar)) * Q;",
     "all": True, "expect": "REGRESSION", "metrics": ["rec.stability"]},
    {"id": "REC-DOTTED-16TH-REST",       # a 16th rest printed with a dot (class 4: a dotted rest shorter than a dotted eighth)
     "replacements": [(SG_REST_TYPE, "          const t0 = full ? (TYPES[bar] || TYPES[v] || ['whole', 0]) : (TYPES[v] || ['16th', 0]);\n"
                                     "          const t = (!full && t0[0] === '16th') ? ['16th', 1] : t0;")],
     "all": True, "expect": "REGRESSION", "metrics": ["rec.check.4"]},
    {"id": "REC-RESTS-NOT-TIDIED",        # the rest-tidying pass (scoregraph/gaps.js tidyRests) does nothing
     "file": "scoregraph/gaps.js",
     "find": "  function tidyRests(g) {",
     "replace": "  function tidyRests(g) { if (g) return { graph: g, changed: false, stats: {}, rests: null, issues: null };",
     "all": True, "expect": "REGRESSION", "metrics": ["rec.check.3", "rec.rest.precision"]},
    {"id": "MUT-NOOP",
     "find": "  const api = {",
     "replace": "  /* noop mutation */\n  const api = {",
     "expect": "PASS", "metrics": []},
]

# G10c-0 (docs/GOALS/G10 section 20): one planted defect per rec-arrange metric (tests/bench/node/rec-arrange.js), run on the
# `rec-arrange-mutation` suite. The defects are in the arranger (the SUT's realize/, candidates/, scoregraph/, audio-score.js); the ruler (the
# repository's own songgraph/, playability/, the checker) is never mutated, so a defect cannot move its own measure. Each must be a REGRESSION that
# names every metric listed; the no-op must leave results.json byte identical.
REALIZE = "realize/index.js"
ARR_TAGGED_BEAT2 = "(tags && e.kind === 'note' && e.at === '1/4')"        # a note of the melody or the bass voice that starts on the second beat of a quarter-beat bar
REC_ARRANGE_MUTATIONS: List[Dict[str, Any]] = [
    {"id": "ARR-MELODY-DROPPED",         # the melody and bass notes on beat 2 are written as rests: melody gaps, melody lost
     "file": REALIZE,
     "find": "    if (skip && skip.has(e)) { x.kind = 'rest'; b.event(part, x); return; }",
     "replace": "    if ((skip && skip.has(e)) || " + ARR_TAGGED_BEAT2 + ") { x.kind = 'rest'; b.event(part, x); return; }",
     "all": True, "expect": "REGRESSION", "metrics": ["arr.melody.kept", "arr.melody.lost", "arr.melody.gap_rate"]},
    {"id": "ARR-MELODY-TO-LEFT-HAND",     # the melody voice is written in the left hand: the hand split's error, everywhere
     "file": REALIZE,
     "find": "    const melodyHand = melodyVoiceId && hands.RH.indexOf(melodyVoiceId) >= 0 ? 'RH'\n      : (melodyVoiceId && hands.LH.indexOf(melodyVoiceId) >= 0 ? 'LH' : 'RH');",
     "replace": "    const melodyHand = melodyVoiceId ? 'LH' : 'RH';",
     "all": True, "expect": "REGRESSION", "metrics": ["arr.melody.cross", "arr.melody.kept"]},
    {"id": "ARR-LEVELS-COLLAPSE",         # every request is arranged for the same target level: the three levels are one arrangement
     "file": "candidates/index.js",
     "find": "  async function runUncachedAsync(g, sg, request, opts) {\n",
     "replace": "  async function runUncachedAsync(g, sg, request, opts) {\n    request = Object.assign({}, request, { targetLevel: 2.5 });\n",
     "all": True, "expect": "REGRESSION", "metrics": ["arr.level.distinct", "arr.level.distance"]},
    {"id": "ARR-LEFT-HAND-DENSE",         # the one-note-per-hand pass is off: the left hand keeps the cover's chords and runs
     "file": "candidates/index.js",
     "find": "opts.singleNoteHands ? { handMaxNotes: 1, handMaxNotesMaxStage: 4, handDropBass: true } : {}",
     "replace": "{}",
     "all": True, "expect": "REGRESSION", "metrics": ["arr.lh.notes_per_bar"]},
    {"id": "ARR-RIGHT-HAND-TOO-HIGH",     # the melody and bass notes on beat 2 are written two octaves up: the right hand climbs above C6, a hand shift of two octaves
     "file": REALIZE,
     "find": "    if (e.kind === 'note') x.heads = e.heads.map(h => ({ pitch: h.pitch, prov: { src: SOURCE_ID.id, op: 'generated' } }));",
     "replace": "    if (e.kind === 'note') x.heads = e.heads.map(h => ({ pitch: " + ARR_TAGGED_BEAT2 + " ? Object.assign({}, h.pitch, { oct: h.pitch.oct + 2 }) : h.pitch, prov: { src: SOURCE_ID.id, op: 'generated' } }));",
     "all": True, "expect": "REGRESSION", "metrics": ["arr.rh.above_c6", "arr.hard.violations"]},
    {"id": "ARR-NO-PLAN",                 # the planner never finds a plan: every level is a refusal
     "file": "candidates/index.js",
     "find": "  async function runUncachedAsync(g, sg, request, opts) {\n",
     "replace": "  async function runUncachedAsync(g, sg, request, opts) {\n    if (g) return { ok: false, reason: 'MUTATION' };\n",
     "all": True, "expect": "REGRESSION", "metrics": ["arr.made"]},
    {"id": "ARR-HARMONY-LOST",            # the left hand is written as rests: the chords go with the bass
     "file": REALIZE,
     "find": "    if (skip && skip.has(e)) { x.kind = 'rest'; b.event(part, x); return; }",
     "replace": "    if ((skip && skip.has(e)) || (oldPart.staves[1] && oldPart.voices.find(v => v.id === oldVoiceId).staff === oldPart.staves[1].id)) { x.kind = 'rest'; b.event(part, x); return; }",
     "all": True, "expect": "REGRESSION", "metrics": ["arr.harmony.agreement"]},
    {"id": "ARR-REST-MIN-ZERO",           # no shortest rest: a 16th rest sits between notes of the arranged copy too
     "replacements": [("  const REST_MIN = 1 / 8;", "  const REST_MIN = 0;")],
     "all": True, "expect": "REGRESSION", "metrics": ["arr.check.1"]},
    {"id": "ARR-GAPS-NOT-CLOSED",         # the sub-16th gaps are never closed (scoregraph/gaps.js): tiny rests in the recording and its arrangement
     "file": "scoregraph/gaps.js",
     "find": "  const GAP_LIMIT = R.make(1, 16);",
     "replace": "  const GAP_LIMIT = R.make(0, 1);",
     "all": True, "expect": "REGRESSION", "metrics": ["arr.check.2"]},
    {"id": "ARR-RESTS-NOT-TIDIED",        # the rest-tidying pass does nothing: runs of rests stay runs
     "file": "scoregraph/gaps.js",
     "find": "  function tidyRests(g) {",
     "replace": "  function tidyRests(g) { if (g) return { graph: g, changed: false, stats: {}, rests: null, issues: null };",
     "all": True, "expect": "REGRESSION", "metrics": ["arr.check.3"]},
    {"id": "ARR-DOTTED-16TH-REST",        # a 16th rest printed with a dot (class 4)
     "replacements": [(SG_REST_TYPE, "          const t0 = full ? (TYPES[bar] || TYPES[v] || ['whole', 0]) : (TYPES[v] || ['16th', 0]);\n"
                                     "          const t = (!full && t0[0] === '16th') ? ['16th', 1] : t0;")],
     "all": True, "expect": "REGRESSION", "metrics": ["arr.check.4"]},
    {"id": "ARR-EXACT-BARS-OFF",          # the app's exact bars switched off: the bars of the recording do not add up as drawn
     "replacements": [("    if (opts.exactBars && !opts.legacyWriter && (opts.sourceKind || 'audio-score') === 'audio-score' && beatType === 4",
                       "    if (false && opts.exactBars && !opts.legacyWriter && (opts.sourceKind || 'audio-score') === 'audio-score' && beatType === 4"),
                      ("    const exactOn = !!opts.exactBars &&", "    const exactOn = false && !!opts.exactBars &&")],
     "all": True, "expect": "REGRESSION", "metrics": ["arr.check.5", "arr.check.6"]},
    {"id": "ARR-TUPLET-RATIO",           # the bracket of a triplet beat is written 4:3 (class 7: a tuplet that is not a triplet)
     "file": "scoregraph/rec-tuplet.js",
     "find": "          groups.push({ events: ids, actual: 3, normal: 2, unit: { type: 'eighth' }, isNew: true });",
     "replace": "          groups.push({ events: ids, actual: 4, normal: 3, unit: { type: 'eighth' }, isNew: true });",
     "all": True, "expect": "REGRESSION", "metrics": ["arr.check.7"]},
    {"id": "ARR-GUARD-LOOSE",           # the melody guard takes any note of the lower staff for the melody (no pitch floor, a step of two octaves): accompaniment in the melody hand
     "file": "candidates/index.js",
     "find": "  const MELODY_GUARD = Object.freeze({ MIN_PITCH: 48, STEP_NEAR: 5, STEP_FAR: 7, NEAR_Q: 0.5, WINDOW_Q: 4 });",
     "replace": "  const MELODY_GUARD = Object.freeze({ MIN_PITCH: 0, STEP_NEAR: 24, STEP_FAR: 24, NEAR_Q: 0.5, WINDOW_Q: 4 });",
     "all": True, "expect": "REGRESSION", "metrics": ["arr.rh.not_melody"]},
    {"id": "MUT-NOOP",
     "find": "  const api = {",
     "replace": "  /* noop mutation */\n  const api = {",
     "expect": "PASS", "metrics": []},
]

# G10a-1: the recording conversion v2 (rec/), one planted defect per decision of its time skeleton (the metre model's
# accents, the bar lines, the tempo octave, issue 1's compound tempo, the helper's beats, the on-beat quantiser fix), on
# the rec-mutation-v2 suite (the rec-mutation references and rows with the v2 options only: a v2 defect is not diluted by
# rows it cannot touch, and the legacy mutations above keep their own suite)
REC_V2_MUTATIONS: List[Dict[str, Any]] = [
    {"id": "REC-V2-NO-ACCENTS", "v2": True,           # the metre model ignores the beat accents (where bass, harmony, long notes fall)
     "file": "rec/metre.js",
     "find": "      sc[i] = model.score(row, W.weights);",
     "replace": "      for (let k = 6; k <= 10; k++) row[k] = 0;\n      sc[i] = model.score(row, W.weights);",
     "expect": "REGRESSION", "metrics": ["critical.meter", "struct.downbeat.f1", "rec.metre.f1"]},
    {"id": "REC-V2-BAR-LINE-LATE", "v2": True,        # the chosen reading's bar lines written one beat late
     "file": "rec/metre.js",
     "find": "    const startQ = bar0 * m.barQ;",
     "replace": "    const startQ = bar0 * m.barQ + m.unitQ;",
     "all": True, "expect": "REGRESSION", "metrics": ["critical.beat_placement", "struct.downbeat.f1"]},
    {"id": "REC-V2-HALF-TEMPO", "v2": True,           # the written beat twice as long as the reading's: the tempo octave one down
     "file": "rec/metre.js",
     "find": "out.push(beats.timeAt(tr.beats, (startQ + k * m.unitQ + best.phi) / best.rho));",
     "replace": "out.push(beats.timeAt(tr.beats, (startQ + 2 * k * m.unitQ + best.phi) / best.rho));",
     "all": True, "expect": "REGRESSION", "metrics": ["critical.playback_tempo"]},
    {"id": "REC-V2-ISSUE-1-BACK", "v2": True,         # issue 1 again: a compound metre plays its dotted-quarter bpm as quarters
     "find": "    const v2Compound = extra.recording === 'v2' && beatType >= 8 && beatsPerBar % 3 === 0;",
     "replace": "    const v2Compound = false;",
     "expect": "REGRESSION", "metrics": ["critical.playback_tempo", "struct.tempo.ok_effective"]},
    {"id": "REC-V2-NO-AUDIO-BEATS", "v2": True,       # the helper's beats and downbeats are not read (the human/oracle rows)
     "file": "rec/index.js",
     "find": "    const audio = opts.beats ? beats.audioTrack(opts.beats, att) : null;",
     "replace": "    const audio = null;",
     "expect": "REGRESSION", "metrics": ["critical.meter", "critical.beat_placement", "struct.downbeat.f1"]},
    {"id": "REC-V2-LATE-ON-BEAT", "v2": True,         # the quantiser's floor slip back in v2: an onset on a beat written a beat late
     "find": "      const r = quantize(clustered, beats, trip, true);",
     "replace": "      const r = quantize(clustered, beats, trip, false);",
     "expect": "REGRESSION", "metrics": ["critical.pitch_integrity", "notes.identity.f1", "rec.onset_f1"]},
    # G10a-2: S4, the hands of rec/hands.js (one planted defect per decision: S4 used at all, the hands' motion, the piece's
    # style, the partition prior). The hands' starting register is not guarded: swapping it moved notation.hand.accuracy on
    # this suite from 0.9870 to 0.9871 (it decides only a piece's first notes) - a decision the gate cannot see
    {"id": "REC-V2-HANDS-LEGACY", "v2": True,         # v2 writes the legacy pitch split again (S4 not used)
     "find": "    const mode = opts.hands || (extra.recording === 'v2' ? 'v2' : 'legacy');",
     "replace": "    const mode = opts.hands || 'legacy';",
     "all": True, "expect": "REGRESSION", "metrics": ["critical.hands", "notation.hand.accuracy"]},
    {"id": "REC-V2-HANDS-NO-MOTION", "v2": True,      # S4 ignores how far each hand moves (the continuity of a hand)
     "file": "rec/hands.js",
     "find": "    emit(L.move + (h * L.NB + bucketOf(P, g.t - t)) * (2 * MOVE_MAX + 1) + MOVE_MAX + clampI((lo + hi) - (sLo + sHi), -MOVE_MAX, MOVE_MAX));",
     "replace": "    /* mutation: no motion cost */",
     "expect": "REGRESSION", "metrics": ["notation.hand.accuracy"]},
    {"id": "REC-V2-HANDS-ONE-STYLE", "v2": True,      # S4 never reads a chorale: the hymns' tenor goes to the upper staff
     "file": "rec/hands.js",
     "find": "    M.styles.forEach((st, si) => {",
     "replace": "    M.styles.slice(0, 1).forEach((st, si) => {",
     "expect": "REGRESSION", "metrics": ["notation.hand.accuracy"]},
    {"id": "REC-V2-HANDS-NO-PART-PRIOR", "v2": True,  # S4 ignores how many notes each hand usually takes for a group's shape
     "file": "rec/hands.js",
     "find": "    emit(L.part + g.shape * (CAP + 1) * (CAP + 1) + Math.min(nL, CAP) * (CAP + 1) + Math.min(nR, CAP));",
     "replace": "    /* mutation: no partition prior */",
     "expect": "REGRESSION", "metrics": ["notation.hand.accuracy"]},
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


def all_edits(mut: Dict[str, Any]) -> Dict[str, List[tuple]]:
    """{file: edits}: the group's base edits (G3_ON for base "g3") first, then the mutation's own."""
    out: Dict[str, List[tuple]] = {}
    if mut.get("base"):
        out.setdefault(sut_mod.ENTRY, []).extend(BASES[mut["base"]])
    if mut.get("id", "").endswith("-ORIGINAL"):
        return out
    out.setdefault(target(mut), []).extend(edits(mut))
    return out


def write_mutant(mut: Dict[str, Any], sut: str) -> str:
    """A copy of the whole SUT snapshot of ``sut`` in .cache/mutations/<id>/ with the mutation (and its group's
    base edits) applied. Returns the copy's entry (audio-score.js) path."""
    try:
        return sut_mod.write_mutant_dir(os.path.join(MUT_DIR, mut["id"]), all_edits(mut), entry=sut, label=mut["id"])
    except sut_mod.SutError as exc:
        raise AnchorMissing(f"{exc}. Update the anchor in tests/bench/pppbench/mutation.py") from exc


def run_mutation_check(mutations=None, suite_name: str = "mutation", out_name: str = "mutation") -> int:
    if suite_name == "rec-mutation" and mutations is None:
        mutations = REC_MUTATIONS
    if suite_name == "rec-arrange-mutation" and mutations is None:
        mutations = REC_ARRANGE_MUTATIONS
    suite = suite_mod.load_suite(suite_name)
    gate = suite.get("gate") or {}
    sut = stages.default_audio_score()
    mutations = mutations or MUTATIONS
    try:
        paths = {m["id"]: write_mutant(m, sut) for m in mutations}
    except AnchorMissing as exc:
        print(f"ERROR {AnchorMissing.code}: {exc}")
        return 2
    out_root = os.path.join(runner.OUT_DIR, out_name)
    # one original per group: the SUT as it is, and for a base (G3 on) the SUT with the base edits alone
    originals: Dict[str, Any] = {}
    for key in sorted({m.get("base") or "" for m in mutations}):
        if key:
            try:
                entry = write_mutant({"id": key.upper() + "-ORIGINAL", "base": key}, sut)
            except AnchorMissing as exc:
                print(f"ERROR {AnchorMissing.code}: {exc}")
                return 2
        else:
            entry = sut
        orig = runner.run_suite(suite, audio_score=entry, out_dir=os.path.join(out_root, "original" + ("-" + key if key else "")),
                                write_cases=False, quiet=True)
        originals[key] = (compare.baseline_from_results(orig["results"], orig["run"], reason="mutation-check original", gate=gate),
                          util.sha256_file(os.path.join(orig["out"], "results.json")))
    orig_sha = originals[""][1] if "" in originals else None
    rows, ok_all = [], True
    for m in mutations:
        base, orig_sha = originals[m.get("base") or ""]
        r = runner.run_suite(suite, audio_score=paths[m["id"]], out_dir=os.path.join(out_root, m["id"]),
                             write_cases=False, quiet=True)
        v = compare.compare(r["results"], base, gate)
        sha = util.sha256_file(os.path.join(r["out"], "results.json"))
        hit = [x for x in m["metrics"] if x in v.failed_metrics]
        if m["expect"] == "PASS":
            passed = v.status == "PASS" and sha == orig_sha
        else:
            # G10a-0's recording mutations name the metrics they must move: every one of them has to be flagged
            passed = v.status == "REGRESSION" and (len(hit) == len(m["metrics"]) if m.get("all") else bool(hit))
        ok_all &= passed
        moved = {k: (d["baseline"], d["value"]) for k, d in v.deltas.items() if abs(d["delta"]) > 1e-9}
        rows.append({"id": m["id"], "expect": m["expect"], "status": v.status, "exit": v.exit_code, "ok": passed,
                     "expected_metrics": m["metrics"], "failed_metrics": v.failed_metrics,
                     "identical_results": sha == orig_sha, "moved": moved})
        print(f"{m['id']:22} expect {m['expect']:10} got {v.status:10} exit {v.exit_code} "
              f"{'OK ' if passed else 'BAD'} failed={','.join(v.failed_metrics) or '-'}"
              + (f" identical_results={sha == orig_sha}" if m["expect"] == "PASS" else ""))
        for k in m["metrics"]:
            if k in moved:
                print(f"{'':12}{k}: {moved[k][0]:.4f} -> {moved[k][1]:.4f}")
    util.dump_json({"schema": "ppp.bench-mutation/1", "suite": suite_name,
                    "original_results_sha256": {k or "plain": v[1] for k, v in originals.items()}, "mutations": rows},
                   os.path.join(out_root, "mutation-report.json"))
    print(f"mutation-check: {'PASS' if ok_all else 'FAIL'} — every harmful mutation caught, the no-op identical"
          if ok_all else "mutation-check: FAIL — see above")
    return 0 if ok_all else 1
