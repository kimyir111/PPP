#!/usr/bin/env node
/* ============================================================================
   G08 comparative evaluation harness (docs/GOALS/G08_ARRANGEMENT_REALIZATION.md section 6a,
   correcting section 4's finding that the existing G5a baseline covers one fixture per legacy
   engine and one of the five metrics).

     node tests/arrangement/tools/g8a-harness.js [--out FILE.json]

   Runs G8a's own realizer AND all three legacy engines (arrange_score.py, the in-app
   ScoreArranger, audio-score.js's arrangeNotes) over the SAME real corpus sample, then scores
   all four on the same inputs across the design doc's five acceptance metrics:
     1. G5 hard violations (playability/analyze.js, via playability/index.js's analyzeGraph)
     2. G6 level vs. the request's target (difficulty/index.js's assess(), |position-target|<=1)
     3. melody preservation (the original piece's own melody-voice pitch classes, checked against
        the output's own sounding content at the SAME real beat window - songgraph/util.js's
        beatGrid, which every output graph here shares with the original since none of the four
        adapters below change the piece's own measure/meter timeline)
     4. harmony agreement (songgraph/harmony.js's harmonyOf, output vs. the SAME piece's own
        original harmony, root+quality and root-only - the same two numbers G7a's own hymn-SATB
        eval reports)
     5. engraving L1/L2 (tests/engrave/tools/bench.js's existing measure(), eg.ledger.silent and
        eg.layout.hard_violations - no new instrumentation, per the design doc's section 5)

   Every legacy engine is invoked read-only, through the same extraction/adapter technique G5a's
   own baseline already established (tests/playability/score-arranger-extract.js,
   tests/playability/arranger-adapters.js) - nothing here modifies arrange_score.py, the app file,
   or audio-score.js. A legacy engine's raw output (measure/beat/midi/hand notes, or a flat heard-
   note subset for audio-score.js) is turned into a real ScoreGraph by `wireNotesToGraph` below, a
   Node/JS analogue of tests/playability/arranger-baseline.test.js's own graph-shape needs, reusing
   the ORIGINAL piece's own full timeline (measures/meter/key/tempo unchanged) so every output
   graph's beat windows line up with the original's for metrics 3/4 above.

   STAGE_TO_LEGACY is a DECLARED, approximate crosswalk (G6's numeric course stage <-> the legacy
   engines' own 4-tier beginner/intermediate/advanced/original label) - no exact equivalence
   exists between the two scales; this harness does not claim one.
   ========================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO = path.resolve(__dirname, '..', '..', '..');
const R = require(path.join(REPO, 'scoregraph', 'rational.js'));
const Build = require(path.join(REPO, 'scoregraph', 'build.js'));
const T = require(path.join(REPO, 'scoregraph', 'time.js'));
const SG = require(path.join(REPO, 'scoregraph', 'index.js'));
const SGG = require(path.join(REPO, 'songgraph', 'index.js'));
const U = require(path.join(REPO, 'songgraph', 'util.js'));
const HARM = require(path.join(REPO, 'songgraph', 'harmony.js'));
const AP = require(path.join(REPO, 'arrangement', 'plan.js'));
const RZ = require(path.join(REPO, 'arrangement', 'g8a-realize.js'));
const PL = require(path.join(REPO, 'playability', 'index.js'));
const DIFF = require(path.join(REPO, 'difficulty', 'index.js'));
const weights = require(path.join(REPO, 'difficulty', 'weights', 'g6a-v1.json'));
const { importCorpus } = require(path.join(REPO, 'tests', 'scoregraph', 'tools', 'g3-corpus.js'));
const { attacksFromWireNotes, attacksFromAudioScoreNotes } = require(path.join(REPO, 'tests', 'playability', 'arranger-adapters.js'));
const { scoreArranger } = require(path.join(REPO, 'tests', 'playability', 'score-arranger-extract.js'));
const bench = require(path.join(REPO, 'tests', 'engrave', 'tools', 'bench.js'));
const AS = require(path.join(REPO, 'audio-score.js'));

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
function midiToP(m) { return NOTE_NAMES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1); }

const STAGE_TO_LEGACY = { 1: 'beginner', 2: 'beginner', 3: 'intermediate', 4: 'advanced' };
const LEGACY_STYLE = 'balanced';

/* -------------------------------------------------------------- the corpus sample */
/* More than one fixture per engine (design doc section 4's correction), spanning both
   committed corpus strata (hymns, method books) - not a cherry-picked easy case. */
const HYMNS = ['o-come-emmanuel', 'amazing-grace', 'when-i-survey', 'for-all-the-saints',
  'holy-holy-holy', 'be-thou-my-vision', 'all-creatures', 'blessed-assurance',
  'christ-the-lord-is-risen', 'come-holy-spirit'].map(n => 'catalog/hymns/' + n + '.musicxml');
const METHOD = ['catalog/method/beyer/002.mxl', 'catalog/method/beyer/010.mxl',
  'catalog/method/beyer/020.mxl', 'catalog/method/beyer/030.mxl',
  'catalog/method/sonatina/001.mxl', 'catalog/method/sonatina/005.mxl', 'catalog/method/sonatina/009.mxl'];
const SAMPLE = HYMNS.concat(METHOD);
const LEVELS = [2, 3];

/* -------------------------------------------------------------- shared graph-building */
function tonicPcOf(fifths, mode) {
  const majorPc = (((7 * fifths) % 12) + 12) % 12;
  return mode === 'minor' ? (majorPc + 9) % 12 : majorPc;
}
function spellMidi(midi, table) {
  const x = table[((midi % 12) + 12) % 12];
  const oct = Math.floor((midi - (x.alter || 0)) / 12) - 1;
  return x.alter ? { step: x.step, alter: x.alter, oct: oct } : { step: x.step, oct: oct };
}
function safeSpell(midi, table, SPELL) {
  const p = spellMidi(midi, table);
  if (p.oct >= 0 && p.oct <= 9) return p;
  const alts = SPELL.candidates(midi).filter(c => c.oct >= 0 && c.oct <= 9);
  alts.sort((a, b) => Math.abs(a.alter || 0) - Math.abs(b.alter || 0));
  return alts[0] || p;
}

/* A legacy engine's own hand model can genuinely overlap within one hand (a held bass note under
   a freshly-struck upper note in the SAME hand, e.g. a sustained whole-note chord while the
   melody keeps moving, or two originally-distinct voices audio-score.js's kept subset lands on
   the same register-based hand) - a single ScoreGraph voice cannot hold two overlapping events,
   so this opens a NEW voice layer on demand (the same idea scoregraph/legacy-score.js's own
   fromScore uses, `layerFor`: reuse the first layer whose reach has passed, else add one).
   Callers must feed this chronologically (measure index, then W offset) ordered per hand. */
function makeLayerFactory(b, part, staffId, labelBase) {
  const layers = [];
  return function assign(mIdx, atR, durR) {
    const endAt = R.add(atR, durR);
    for (const layer of layers) {
      if (layer.reachM < mIdx || (layer.reachM === mIdx && !R.gt(layer.reachAt, atR))) {
        layer.reachM = mIdx; layer.reachAt = endAt;
        return layer.voiceId;
      }
    }
    const v = b.voice(part, { staff: staffId, label: String(labelBase + layers.length) }).id;
    layers.push({ voiceId: v, reachM: mIdx, reachAt: endAt });
    return v;
  };
}

/* Full time coverage, per voice, per measure (the validator requires it): for every measure in
   `measureIds` (in order), fill whatever this voice does NOT already cover with rests - before
   its first real event in that measure, between two real events, after its last one, or the
   whole measure when it has none at all. A harness-only adapter's own note lists routinely leave
   gaps (a hand that plays only every other beat, a voice layer born mid-piece), unlike G8a's own
   realizer (arrangement/g8a-realize.js), which never has this problem because it always writes
   its own rests inline as it goes. */
function fillVoiceGaps(b, part, voiceId, staffId, measureIds, measureDur) {
  measureIds.forEach(mId => {
    const dur = measureDur.get(mId);
    const here = part.events.filter(e => e.voice === voiceId && e.m === mId).sort((a, c) => R.cmp(R.parse(a.at), R.parse(c.at)));
    let cursor = R.ZERO;
    here.forEach(e => {
      const at = R.parse(e.at);
      if (R.gt(at, cursor)) b.event(part, { kind: 'rest', m: mId, at: R.format(cursor), dur: R.format(R.sub(at, cursor)), voice: voiceId, staff: staffId });
      cursor = R.add(at, R.parse(e.dur));
    });
    if (R.lt(cursor, dur)) b.event(part, { kind: 'rest', m: mId, at: R.format(cursor), dur: R.format(R.sub(dur, cursor)), voice: voiceId, staff: staffId });
  });
}

/* The ORIGINAL piece's own full timeline (every measure, meter, key, tempo - unchanged), with a
   caller-supplied note list replacing its content. Used for both legacy wire-note engines (each
   note: {m: measure NUMBER, b: quarters offset, dur: quarters, midi, hand: 'l'|'r'|'x'}) and the
   audio-score.js kept-subset path (each note: {origEventId, origHeadId} straight from `g`). This
   is a harness-only adapter (evaluation tooling, not part of G8a's own realizer) - it exists so
   all three legacy engines' very different output shapes can be scored by the SAME real G5/G6/G4
   tools G8a's own output is scored by. */
function wireNotesToGraph(g, notes, opts) {
  opts = opts || {};
  const SPELL = require(path.join(REPO, 'scoregraph', 'pro-spell.js'));
  const numberToMeasure = new Map(g.timeline.measures.map((mm, i) => [parseInt(mm.number, 10) || (i + 1), mm]));
  const keysByM = new Map();
  (g.timeline.keys || []).forEach(k => { if (!keysByM.has(k.m)) keysByM.set(k.m, k); });
  const temposByM = new Map();
  (g.timeline.tempos || []).forEach(t => { if (t.qpm !== undefined && !temposByM.has(t.m)) temposByM.set(t.m, t); });

  const b = Build.builder({ id: 'g8a-eval:' + (opts.tag || 'x'), meta: { title: (g.meta && g.meta.title || 'Untitled') + ' (' + (opts.tag || '') + ')' } });
  const src = b.source({ kind: 'generator', tool: 'ppp.g8a.harness', version: '0.1.0' });
  b.setDefault({ src: src.id, op: 'generated' });
  const part = b.part({ name: 'Piano', instrument: { kind: 'piano', family: 'keyboard' } });
  const staffRH = b.staff(part, {}).id, staffLH = b.staff(part, {}).id;

  const assignRH = makeLayerFactory(b, part, staffRH, 1), assignLH = makeLayerFactory(b, part, staffLH, 5);

  const measureMap = new Map();
  let prevMeterKey = null, prevKey = null, prevTempo = null, firstNew = null;
  g.timeline.measures.forEach((mm, i) => {
    const nm = b.measure({ number: String(i + 1), dur: mm.dur });
    if (!firstNew) firstNew = nm.id;
    let meter = null;
    try { meter = T.meterAt(g, mm.id); } catch (e) { meter = null; }
    const mk = meter ? meter.beats.join(',') + '/' + meter.beatType : null;
    if (mk !== prevMeterKey) { b.meter(meter ? { m: nm.id, beats: meter.beats.slice(), beatType: meter.beatType } : { m: nm.id, beats: [4], beatType: 4 }); prevMeterKey = mk; }
    const k = keysByM.get(mm.id);
    const keyVal = k ? { fifths: k.fifths, mode: k.mode || 'major' } : (prevKey ? null : { fifths: 0, mode: 'major' });
    if (keyVal && (!prevKey || keyVal.fifths !== prevKey.fifths || keyVal.mode !== prevKey.mode)) { b.key({ m: nm.id, at: '0', fifths: keyVal.fifths, mode: keyVal.mode }); prevKey = keyVal; }
    const tp = temposByM.get(mm.id);
    const tempoVal = tp ? R.toNumber(R.parse(tp.qpm)) : (prevTempo ? null : 120);
    if (tempoVal !== null && tempoVal !== prevTempo) { b.tempo({ m: nm.id, at: '0', qpm: String(tempoVal) }); prevTempo = tempoVal; }
    measureMap.set(i + 1, { id: nm.id, dur: R.parse(mm.dur) });
  });
  b.clef(part, { staff: staffRH, m: firstNew, at: '0', sign: 'G' });
  b.clef(part, { staff: staffLH, m: firstNew, at: '0', sign: 'F' });

  const keyByNewMeasure = new Map();
  { let running = { fifths: 0, mode: 'major' }; g.timeline.measures.forEach((mm, i) => { const k = keysByM.get(mm.id); if (k) running = { fifths: k.fifths, mode: k.mode || 'major' }; keyByNewMeasure.set(measureMap.get(i + 1).id, running); }); }

  /* group simultaneous same-hand notes into one chord event (a voice cannot hold two overlapping
     events); quarters -> W via the exact 1/3840-quarter grid legacy-score.js's fromScore uses for
     the same reason (a plain float quarter offset is not exact) */
  const G = 3840;
  const qToW = q => R.make(Math.round(q * G), G * 4);
  const groups = new Map();
  notes.forEach(n => {
    if (n.midi == null || n.hand === 'x' || n.hand == null) return;
    const mNum = Math.round(n.m);
    const mEntry = measureMap.get(mNum);
    if (!mEntry) return;
    const hand = n.hand === 'l' ? 'LH' : 'RH';
    const key = hand + '@' + mEntry.id + ':' + n.b.toFixed(6) + ':' + n.dur.toFixed(6);
    if (!groups.has(key)) groups.set(key, { hand: hand, mNum: mNum, m: mEntry.id, b: n.b, dur: n.dur, midis: [] });
    groups.get(key).midis.push(n.midi);
  });
  const sorted = Array.from(groups.values()).sort((a, c) => a.mNum - c.mNum || a.b - c.b);
  const tableCache = new Map();
  sorted.forEach(gr => {
    const at = qToW(gr.b), dur = qToW(gr.dur);
    if (!R.gt(dur, R.ZERO)) return;
    const key = keyByNewMeasure.get(gr.m) || { fifths: 0, mode: 'major' };
    const cacheKey = key.fifths + ':' + key.mode;
    let table = tableCache.get(cacheKey);
    if (!table) { table = SPELL.spellingTable({ fifths: key.fifths, mode: key.mode, tonic: tonicPcOf(key.fifths, key.mode) }); tableCache.set(cacheKey, table); }
    const heads = Array.from(new Set(gr.midis)).sort((a, c) => a - c).map(m => ({ pitch: safeSpell(m, table, SPELL) }));
    const staffId = gr.hand === 'RH' ? staffRH : staffLH;
    const voiceId = (gr.hand === 'RH' ? assignRH : assignLH)(gr.mNum, at, dur);
    b.event(part, { kind: 'note', m: gr.m, at: R.format(at), dur: R.format(dur), voice: voiceId, staff: staffId, heads: heads });
  });
  const allMeasureIds = Array.from(measureMap.values()).map(x => x.id);
  const measureDur = new Map(Array.from(measureMap.values()).map(x => [x.id, x.dur]));
  part.voices.slice().forEach(v => fillVoiceGaps(b, part, v.id, v.staff, allMeasureIds, measureDur));

  try { return { ok: true, graph: b.finish().graph }; } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
}

/* -------------------------------------------------------------- per-engine runners */
function legacyScoreFromGraph(g) {
  const score = SG.legacy.toScore(g, { name: 'harness', id: 'harness', ids: true });
  const part = g.parts[0];
  score.notes.forEach(n => {
    if (n.rest) return;
    const ev = part.events.find(e => e.id === n.sgEvent);
    if (!ev) return;
    const head = (ev.heads || []).find(h => h.id === n.sgHead);
    const limb = head ? SG.pitch.limbOf(part, ev, head) : undefined;
    if (limb === 'LH') n.hand = 'l'; else if (limb === 'RH') n.hand = 'r';
  });
  return score;
}

function runArrangeScorePy(score, level, style) {
  const input = JSON.stringify({ score: { tempo: score.tempo, measures: score.measures.map(m => ({ number: m.number, lenQ: m.lenQ, time: m.time, key: m.key })), notes: score.notes.filter(n => !n.rest).map(n => ({ m: n.m, b: n.b, dur: n.dur, midi: n.midi, staff: n.staff, hand: n.hand, voice: n.voice })), sections: [{ from: score.measures[0].number, to: score.measures[score.measures.length - 1].number }] }, level: level, style: style });
  const out = execFileSync(process.platform === 'win32' ? 'python' : 'python3',
    [path.join(__dirname, 'legacy-arrange-score.py')], { input: input, maxBuffer: 64 * 1024 * 1024 }).toString();
  return JSON.parse(out);
}

function runScoreArranger(SA, score, level, style) {
  const arranged = SA.arrange(score, { level: level, style: style });
  return arranged.notes.map(n => ({ m: n.m, b: n.b, dur: n.dur, midi: n.midi, hand: n.hand }));
}

function runAudioScore(g) {
  const attacks = PL.graph.attacksOf(g, {});
  const heard = [];
  const byKey = new Map();
  attacks.forEach(a => a.heads.forEach(h => {
    const on = Math.round(a.onsetSec * 1e6) / 1e6, off = Math.round(h.offSec * 1e6) / 1e6;
    const key = on + ':' + off + ':' + h.midi;
    heard.push({ on: on, off: Math.max(on + 0.01, off), midi: h.midi, vel: 80 });
    if (!byKey.has(key)) byKey.set(key, { headId: h.id, m: a.m });
  }));
  return { heard: heard, byKey: byKey };
}

/* audio-score's surviving subset -> real copied events (same technique as g8a-realize.js's
   copyVoice, generalized to the whole piece: every kept head's OWN real event is copied verbatim
   at its own real position, hands reassigned purely by register - the same MIDI-60 split G7b's
   plan.js itself declares as its own convention - since audio-score.js has no hand model at all). */
function audioScoreToGraph(g, kept) {
  const PITCH = require(path.join(REPO, 'scoregraph', 'pitch.js'));
  const b = Build.builder({ id: 'g8a-eval:audio-score', meta: { title: (g.meta && g.meta.title || 'Untitled') + ' (audio-score.js)' } });
  const src = b.source({ kind: 'generator', tool: 'ppp.g8a.harness', version: '0.1.0' });
  b.setDefault({ src: src.id, op: 'generated' });
  const part = b.part({ name: 'Piano', instrument: { kind: 'piano', family: 'keyboard' } });
  const staffRH = b.staff(part, {}).id, staffLH = b.staff(part, {}).id;
  const assignRH = makeLayerFactory(b, part, staffRH, 1), assignLH = makeLayerFactory(b, part, staffLH, 5);
  const measureMap = new Map();
  const measureIdx = new Map(g.timeline.measures.map((mm, i) => [mm.id, i]));
  const keysByM = new Map(); (g.timeline.keys || []).forEach(k => { if (!keysByM.has(k.m)) keysByM.set(k.m, k); });
  const temposByM = new Map(); (g.timeline.tempos || []).forEach(t => { if (t.qpm !== undefined && !temposByM.has(t.m)) temposByM.set(t.m, t); });
  let prevMeterKey = null, prevKey = null, prevTempo = null, firstNew = null;
  g.timeline.measures.forEach(mm => {
    const nm = b.measure({ number: String(measureMap.size + 1), dur: mm.dur });
    if (!firstNew) firstNew = nm.id;
    let meter = null; try { meter = T.meterAt(g, mm.id); } catch (e) { meter = null; }
    const mk = meter ? meter.beats.join(',') + '/' + meter.beatType : null;
    if (mk !== prevMeterKey) { b.meter(meter ? { m: nm.id, beats: meter.beats.slice(), beatType: meter.beatType } : { m: nm.id, beats: [4], beatType: 4 }); prevMeterKey = mk; }
    const k = keysByM.get(mm.id);
    const keyVal = k ? { fifths: k.fifths, mode: k.mode || 'major' } : (prevKey ? null : { fifths: 0, mode: 'major' });
    if (keyVal && (!prevKey || keyVal.fifths !== prevKey.fifths || keyVal.mode !== prevKey.mode)) { b.key({ m: nm.id, at: '0', fifths: keyVal.fifths, mode: keyVal.mode }); prevKey = keyVal; }
    const tp = temposByM.get(mm.id);
    const tempoVal = tp ? R.toNumber(R.parse(tp.qpm)) : (prevTempo ? null : 120);
    if (tempoVal !== null && tempoVal !== prevTempo) { b.tempo({ m: nm.id, at: '0', qpm: String(tempoVal) }); prevTempo = tempoVal; }
    measureMap.set(mm.id, { id: nm.id, dur: R.parse(mm.dur) });
  });
  b.clef(part, { staff: staffRH, m: firstNew, at: '0', sign: 'G' });
  b.clef(part, { staff: staffLH, m: firstNew, at: '0', sign: 'F' });

  const kept2 = [];
  g.parts.forEach(p2 => p2.events.forEach(e => {
    if (e.kind !== 'note' || e.grace) return;
    const keepHeads = (e.heads || []).filter(h => kept.has(h.id) && h.pitch);
    if (keepHeads.length) kept2.push({ e: e, heads: keepHeads });
  }));
  kept2.sort((a, c) => measureIdx.get(a.e.m) - measureIdx.get(c.e.m) || R.cmp(R.parse(a.e.at), R.parse(c.e.at)));
  kept2.forEach(({ e, heads }) => {
    const avg = heads.reduce((s, h) => s + PITCH.midi(h.pitch), 0) / heads.length;
    const hand = avg >= 60 ? 'RH' : 'LH';
    const mEntry = measureMap.get(e.m);
    const mIdx = measureIdx.get(e.m);
    const at = R.parse(e.at), dur = R.parse(e.dur);
    const voiceId = (hand === 'RH' ? assignRH : assignLH)(mIdx, at, dur);
    b.event(part, { kind: 'note', m: mEntry.id, at: e.at, dur: e.dur, voice: voiceId, staff: hand === 'RH' ? staffRH : staffLH, heads: heads.map(h => ({ pitch: { step: h.pitch.step, alter: h.pitch.alter, oct: h.pitch.oct } })) });
  });
  const allMeasureIds = Array.from(measureMap.values()).map(x => x.id);
  const measureDur = new Map(Array.from(measureMap.values()).map(x => [x.id, x.dur]));
  part.voices.forEach(v => fillVoiceGaps(b, part, v.id, v.staff, allMeasureIds, measureDur));
  try { return { ok: true, graph: b.finish().graph }; } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
}

/* -------------------------------------------------------------- metrics */
function hardViolations(graph) {
  try { return PL.analyzeGraph(graph, { profile: 'medium' }).totals.hard; } catch (e) { return null; }
}
function g6Level(graph, target) {
  try {
    const a = DIFF.assess(graph, weights, {});
    return { position: a.level.position, within1: Math.abs(a.level.position - target) <= 1 };
  } catch (e) { return null; }
}
/* melody preservation: for each real beat window (songgraph/util.js beatGrid, on the ORIGINAL
   piece), does the ORIGINAL melody voice's own sounding pitch class (if any) also sound
   SOMEWHERE in the output graph during that same window? Only windows where the original melody
   voice actually sounds are counted (a window it rests in says nothing about preservation). */
function melodyPreservation(origG, origMelodyVoiceId, origPart, outGraph) {
  const grid = U.beatGrid(origG);
  const origNotes = U.noteWindows(origG, { part: origPart }).filter(n => n.voiceId === origMelodyVoiceId);
  const outNotes = U.noteWindows(outGraph, {});
  let checked = 0, matched = 0;
  grid.forEach(w => {
    const here = U.overlap(origNotes, w.w0, w.w1);
    if (!here.length) return;
    checked++;
    const wantPcs = new Set(here.map(n => n.pc));
    const got = U.overlap(outNotes, w.w0, w.w1).map(n => n.pc);
    if (got.some(pc => wantPcs.has(pc))) matched++;
  });
  return checked ? matched / checked : null;
}
/* harmony agreement: the SAME real per-beat-window harmony fit (songgraph/harmony.js), computed
   once on the original piece (ground truth: what this piece's own harmony really is) and once on
   the output graph, root+quality and root-only, over every window either side has content in. */
function harmonyAgreement(origG, outGraph) {
  const gridOrig = HARM.harmonyOf(origG, {});
  const gridOut = HARM.harmonyOf(outGraph, {});
  const n = Math.min(gridOrig.length, gridOut.length);
  let compared = 0, rootQual = 0, rootOnly = 0;
  for (let i = 0; i < n; i++) {
    const a = gridOrig[i], b2 = gridOut[i];
    if (a.root == null || b2.root == null) continue;
    compared++;
    if (a.root === b2.root) rootOnly++;
    if (a.root === b2.root && a.quality === b2.quality) rootQual++;
  }
  return compared ? { rootQuality: rootQual / compared, rootOnly: rootOnly / compared, n: compared } : null;
}
function engraveL1L2(graph, id) {
  const row = bench.measure({ id: id, graph: graph });
  if (row.error) return null;
  return { silent: row.m['eg.ledger.silent'] || 0, hard: row.m['eg.layout.hard_violations'] || 0 };
}

/* -------------------------------------------------------------- main */
async function main() {
  const outArg = process.argv.indexOf('--out');
  const outFile = outArg >= 0 ? process.argv[outArg + 1] : null;
  const rows = await importCorpus(SAMPLE);
  const SA = scoreArranger();
  const results = [];

  for (const row of rows) {
    if (!row.ok) { console.error('IMPORT FAIL', row.path, row.code); continue; }
    const g = row.graph;
    let sg;
    try { sg = SGG.analyze(g); } catch (e) { console.error('SG CRASH', row.path, e.message); continue; }
    const part = AP.pickPart(g, {});
    const mb = sg.melodyBass.parts.find(p2 => p2.part === part.id);

    for (const stage of LEVELS) {
      const legacyLevel = STAGE_TO_LEGACY[stage] || 'intermediate';
      const entry = { file: row.path, stage: stage, legacyLevel: legacyLevel, engines: {} };

      /* ---- G8a ---- */
      const p = AP.plan(g, sg, { targetLevel: stage, handProfile: 'medium' });
      if (p.ok) {
        const r = RZ.realize(g, sg, p.plan, { style: 'block' });
        entry.engines.g8a = r.ok ? { graph: r.graph } : { error: r.reason };
      } else entry.engines.g8a = { error: 'PLAN_' + p.reason };

      /* ---- legacy 1: arrange_score.py ---- */
      try {
        const score = legacyScoreFromGraph(g);
        const legacyStyle = 'balanced';
        const py = runArrangeScorePy(score, legacyLevel, legacyStyle);
        if (py.error) entry.engines.arrangeScorePy = { error: py.error };
        else {
          const notes = py.notes.map(n => ({ m: n.m, b: n.b, dur: n.dur, midi: n.midi, hand: n.hand }));
          const gg = wireNotesToGraph(g, notes, { tag: 'arrange_score.py' });
          entry.engines.arrangeScorePy = gg.ok ? { graph: gg.graph } : { error: gg.error, rawNotes: notes };
        }
      } catch (e) { entry.engines.arrangeScorePy = { error: String(e && e.message || e) }; }

      /* ---- legacy 2: ScoreArranger ---- */
      try {
        const score = legacyScoreFromGraph(g);
        const notes = runScoreArranger(SA, score, legacyLevel, LEGACY_STYLE);
        const gg = wireNotesToGraph(g, notes, { tag: 'ScoreArranger' });
        entry.engines.scoreArranger = gg.ok ? { graph: gg.graph } : { error: gg.error, rawNotes: notes };
      } catch (e) { entry.engines.scoreArranger = { error: String(e && e.message || e) }; }

      /* ---- legacy 3: audio-score.js ---- */
      try {
        const { heard, byKey } = runAudioScore(g);
        const kept = AS.arrangeNotes(heard, { level: legacyLevel, style: 'balanced' });
        const keptHeadIds = new Set();
        kept.forEach(n => {
          const on = Math.round(n.on * 1e6) / 1e6, off = Math.round(n.off * 1e6) / 1e6;
          const key = on + ':' + off + ':' + n.midi;
          const info = byKey.get(key);
          if (info) keptHeadIds.add(info.headId);
        });
        const gg = audioScoreToGraph(g, keptHeadIds);
        entry.engines.audioScore = gg.ok ? { graph: gg.graph } : { error: gg.error };
      } catch (e) { entry.engines.audioScore = { error: String(e && e.message || e) }; }

      /* ---- score every engine that produced a graph, on the same 5 metrics ---- */
      Object.keys(entry.engines).forEach(name => {
        const e = entry.engines[name];
        if (!e.graph) return;
        e.hard = hardViolations(e.graph);
        e.g6 = g6Level(e.graph, stage);
        e.melody = mb ? melodyPreservation(g, mb.melodyVoice, part.id, e.graph) : null;
        e.harmony = harmonyAgreement(g, e.graph);
        e.engrave = engraveL1L2(e.graph, row.path + '#' + stage + '#' + name);
        delete e.graph; /* keep the JSON report small; graphs are reproducible from the same run */
      });

      results.push(entry);
      process.stderr.write('.');
    }
  }
  process.stderr.write('\n');

  if (outFile) fs.writeFileSync(outFile, JSON.stringify(results, null, 2));
  report(results);
}

function mean(xs) { const v = xs.filter(x => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; }
function pct(xs, pred) { const v = xs.filter(x => x != null); return v.length ? v.filter(pred).length / v.length : null; }
function fmt(x) { return x == null ? 'n/a' : (typeof x === 'number' ? x.toFixed(3) : String(x)); }

function report(results) {
  const engines = ['g8a', 'arrangeScorePy', 'scoreArranger', 'audioScore'];
  console.log('\n=== G8a comparative evaluation harness: ' + results.length + ' (file, level) inputs ===\n');
  engines.forEach(name => {
    const rows = results.map(r => r.engines[name]).filter(Boolean);
    const errors = rows.filter(r => r.error).length;
    const scored = rows.filter(r => !r.error);
    const hard = scored.map(r => r.hard);
    const within1 = scored.map(r => r.g6 && r.g6.within1);
    const melody = scored.map(r => r.melody);
    const harmRQ = scored.map(r => r.harmony && r.harmony.rootQuality);
    const harmR = scored.map(r => r.harmony && r.harmony.rootOnly);
    const silent = scored.map(r => r.engrave && r.engrave.silent);
    const l2hard = scored.map(r => r.engrave && r.engrave.hard);
    console.log(name + ':');
    console.log('  inputs: ' + rows.length + ', errored/no-output: ' + errors + ', scored: ' + scored.length);
    console.log('  G5 hard violations: mean=' + fmt(mean(hard)) + ', pct-zero=' + fmt(pct(hard, x => x === 0)));
    console.log('  G6 level within +/-1: ' + fmt(pct(within1, x => x === true)));
    console.log('  melody preservation: mean=' + fmt(mean(melody)));
    console.log('  harmony agreement: root+quality mean=' + fmt(mean(harmRQ)) + ', root-only mean=' + fmt(mean(harmR)));
    console.log('  engrave L1 silent: mean=' + fmt(mean(silent)) + ', pct-zero=' + fmt(pct(silent, x => x === 0)));
    console.log('  engrave L2 hard: mean=' + fmt(mean(l2hard)) + ', pct-zero=' + fmt(pct(l2hard, x => x === 0)));
    console.log('');
  });
}

if (require.main === module) main().catch(e => { console.error(e.stack || e); process.exit(1); });

module.exports = { wireNotesToGraph, audioScoreToGraph, melodyPreservation, harmonyAgreement, SAMPLE, LEVELS };
