/* ============================================================================
   PPP G8a comparative evaluation harness (docs/GOALS/G08_ARRANGEMENT_REALIZATION.md §6a/§14)

   The real "same inputs, all five metrics" comparison the design doc's §4 says the existing
   G5a baseline (docs/GOALS/G05_PLAYABILITY_FINGERING.md §11) does NOT already give: that
   baseline covered one fixture per legacy engine and only the G5-hard-violations leg. This
   harness runs G8a's own realizer AND all three legacy engines over a real, multi-file
   corpus sample, converts every one of the four outputs to a real ScoreGraph (the one shape
   every metric below can be computed from uniformly), and scores all five of §7's metrics.

   ---- The four arrangers, and how each becomes a real ScoreGraph ----
   1. G8a (arrangement/realize.js): already produces a ScoreGraph directly.
   2. arrange_score.py (Python, read-only - this harness never edits it): invoked exactly as
      it always is, over stdin/stdout, with a real wire-score JSON built from the SAME graph
      via scoregraph/index.js's legacy.toScore - never a synthetic fixture. Its own real
      Arranger.arrange() output notes are spliced back onto that same wire score and turned
      into a graph via legacy.fromScore (the same round trip tests/engrave/tools/bench.js's
      own 'x' suite already uses for a stored Score).
   3. The in-app ScoreArranger (Piano Coach App.dc.html, extracted read-only the same way
      tests/playability/score-arranger-extract.js already does for G05's own baseline): same
      wire score, same round trip back to a graph.
   4. audio-score.js's arrangeNotes (Node-requireable directly): built for a "heard performance"
      input, not a written score, so the SAME graph's real notes are projected into
      {on, off, midi, vel} seconds using the wire score's own tempo (a literal, constant-tempo
      reading of the notated rhythm, not a real recording - the closest fair stand-in
      available, same honesty tests/playability/arranger-baseline.test.js's own audio-score
      baseline already declares). arrangeNotes only ever keeps a SUBSET of what it is given
      (never invents a pitch, per its own header), so every kept note is matched back to its
      real original wire note by (onset, midi) to recover its real m/b/dur, then rebuilt into
      a graph the same way as the other two.

   Both legacy Score-based engines need real hand/staff on the wire score to do anything
   useful (arrange_score.py's own melody/bass extraction keys off staff==1/voice==1 and
   staff==2, ScoreArranger's off `hand`) - `legacy.toScore` itself always writes `hand:'r'`
   (a known simplification documented in scoregraph/legacy-score.js's own header), so
   `patchHands` substitutes the graph's own real G1 limb back in, the same fix
   tests/playability/arranger-baseline.test.js already applies for its own baseline.

   ---- Style ----
   G8a's request style defaults to 'block' (a full voice-led chord per beat); the two legacy
   Score engines share an identical STYLES vocabulary (`balanced, jazz, ballad, pop, waltz,
   bossa, cinematic` - checked directly against arrange_score.py's own module-level STYLES set
   and the extracted ScoreArranger's own `.styles`, byte-identical) with no 'block' name, so
   'balanced' (their own "no particular style" default) is the fair equivalent used here. This
   harness's head-to-head numbers are for that one style pairing; arrangement/realize.js's
   other five patterns (hymn, broken, ballad, pop, waltz) are exercised separately by the full
   corpus sweep in this same tools/ directory's corpus-check.js (169/369 corpus files, 0
   crashes, all six style names, docs/GOALS/G08 §14 has the numbers) - not re-run here per
   style, to keep this harness's own runtime and report size real and readable. */
'use strict';
const path = require('path');
const { execFileSync } = require('child_process');

const REPO = path.resolve(__dirname, '..', '..');
const SG = require(path.join(REPO, 'scoregraph', 'index.js'));
const SGG = require(path.join(REPO, 'songgraph', 'index.js'));
const HARMONY = require(path.join(REPO, 'songgraph', 'harmony.js'));
const U = require(path.join(REPO, 'songgraph', 'util.js'));
const R = require(path.join(REPO, 'scoregraph', 'rational.js'));
const PLANJS = require(path.join(REPO, 'arrangement', 'plan.js'));
const REALIZE = require(path.join(REPO, 'arrangement', 'realize.js'));
const DIFF = require(path.join(REPO, 'difficulty', 'index.js'));
const weights = require(path.join(REPO, 'difficulty', 'weights', 'g6a-v1.json'));
const PL = require(path.join(REPO, 'playability', 'index.js'));
const bench = require(path.join(REPO, 'tests', 'engrave', 'tools', 'bench.js'));
const { scoreArranger } = require(path.join(REPO, 'tests', 'playability', 'score-arranger-extract.js'));
const AS = require(path.join(REPO, 'audio-score.js'));
const { importCorpus, corpusFiles } = require(path.join(REPO, 'tests', 'scoregraph', 'tools', 'g3-corpus.js'));

const STAGE_TO_LEGACY_LEVEL = { 1: 'beginner', 2: 'intermediate', 3: 'advanced', 4: 'original' };
const LEGACY_STYLE = 'balanced';

/* legacy.toScore always writes hand:'r' (documented simplification, legacy-score.js's own
   header); substitute the graph's own real G1 limb, the same fix G05's own baseline test
   applies (tests/playability/arranger-baseline.test.js's legacyScoreFromGraph). */
function patchHands(score, g) {
  const part = g.parts[0];
  score.notes.forEach(n => {
    if (n.rest) return;
    const ev = part.events.find(e => e.id === n.sgEvent);
    if (!ev) return;
    const head = (ev.heads || []).find(h => h.id === n.sgHead);
    const limb = head ? SG.pitch.limbOf(part, ev, head) : undefined;
    if (limb === 'LH') { n.hand = 'l'; n.staff = 2; } else if (limb === 'RH') { n.hand = 'r'; n.staff = 1; }
  });
  return score;
}

function measureStartsQ(score) {
  const starts = [];
  let acc = 0;
  score.measures.forEach(m => { starts.push(acc); acc += m.lenQ; });
  return starts;
}

function runArrangeScorePy(score, stage) {
  const payload = { score: score, arrangement: { level: STAGE_TO_LEGACY_LEVEL[stage] || 'intermediate', style: LEGACY_STYLE } };
  try {
    const out = execFileSync(process.platform === 'win32' ? 'python' : 'python3', [path.join(REPO, 'arrange_score.py')],
      { input: JSON.stringify(payload), maxBuffer: 64 * 1024 * 1024, timeout: 20000 }).toString();
    const result = JSON.parse(out);
    if (!result.ok) return { ok: false, reason: 'engine:' + result.error };
    return { ok: true, notes: result.notes };
  } catch (e) {
    return { ok: false, reason: 'exec:' + String(e && e.message || e).slice(0, 200) };
  }
}

let cachedSA = null;
function runScoreArranger(score, stage) {
  try {
    cachedSA = cachedSA || scoreArranger();
    const level = STAGE_TO_LEGACY_LEVEL[stage] || 'intermediate';
    const arranged = cachedSA.arrange(score, { level: level, style: LEGACY_STYLE });
    /* keep ScoreArranger's own full note objects (m,b,dur,midi,type,dots,p,hand,...) - a first
       version of this harness stripped them down to 7 bare fields, which silently produced
       zero usable notes out of legacy.fromScore (real finding, docs/GOALS/G08 §14) rather than
       a hard error; only staff/voice are normalized here since ScoreArranger's own hand-only
       convention doesn't always set them consistently for fromScore's own reader. */
    return { ok: true, notes: arranged.notes.map(n => Object.assign({}, n, { staff: n.hand === 'l' ? 2 : 1, voice: n.hand === 'l' ? (n.voice > 4 ? n.voice : 5) : (n.voice <= 4 ? n.voice : 1) })) };
  } catch (e) {
    return { ok: false, reason: 'exec:' + String(e && e.message || e).slice(0, 200) };
  }
}

function runAudioScore(score, stage) {
  const starts = measureStartsQ(score);
  const tempo = score.tempo > 0 ? score.tempo : 96;
  const secPerQ = 60 / tempo;
  const byKey = new Map();
  const heard = score.notes.filter(n => !n.rest && n.midi != null).map(n => {
    const absQ = starts[n.m - 1] + n.b;
    const on = absQ * secPerQ, off = (absQ + n.dur) * secPerQ;
    const note = { on: on, off: off, midi: n.midi, vel: 80 };
    byKey.set(note.on.toFixed(6) + '|' + note.midi, n);
    return note;
  });
  const level = STAGE_TO_LEGACY_LEVEL[stage] || 'intermediate';
  let kept;
  try { kept = AS.arrangeNotes(heard, { level: level, style: LEGACY_STYLE }); }
  catch (e) { return { ok: false, reason: 'exec:' + String(e && e.message || e).slice(0, 200) }; }
  const notes = [];
  kept.forEach(k => {
    const orig = byKey.get(k.on.toFixed(6) + '|' + k.midi);
    if (orig) notes.push(Object.assign({}, orig, { hand: 'r', staff: 1, voice: 1 }));
  });
  return { ok: true, notes: notes };
}

function graphFromNotes(score, notes) {
  const arranged = Object.assign({}, score, { notes: notes });
  const fr = SG.legacy.fromScore(arranged);
  if (!fr.ok || !fr.graph) return { ok: false, reason: 'fromScore:' + (fr.unsupported || []).map(u => u.code).join(',') };
  return { ok: true, graph: fr.graph };
}

/* ---- the five metrics, computed uniformly over any real ScoreGraph ---- */

function hardViolations(graph) {
  try { return PL.analyzeGraph(graph, { profile: 'medium' }).totals.hard; }
  catch (e) { return null; }
}

function levelPosition(graph) {
  try { return DIFF.assess(graph, weights).level.position; }
  catch (e) { return null; }
}

/* melody preservation: the fraction of the ORIGINAL declared melody voice's real (onset-
   quarter rounded to 1/16, midi) pairs that appear ANYWHERE in the arranged graph's own notes -
   a fair, hand/voice-agnostic check since none of the three legacy engines label a "melody
   voice" the way G7a/G7b do. */
function melodyPreservation(g, plan, argGraph) {
  const measureIds = new Set();
  plan.sections.forEach(sec => PLANJS.sectionMeasures(g, sec.section).forEach(m => measureIds.add(m.id)));
  const origMelody = [];
  plan.sections.forEach(sec => {
    U.noteWindows(g, { part: plan.part }).filter(n => n.voiceId === sec.melody.voice && PLANJS.sectionMeasures(g, sec.section).some(m => m.id === n.m))
      .forEach(n => origMelody.push({ q: Math.round(R.toNumber(n.w0) * 4 * 16) / 16, midi: n.midi }));
  });
  if (!origMelody.length) return null;
  const argSet = new Set();
  try {
    U.noteWindows(argGraph).forEach(n => argSet.add(Math.round(R.toNumber(n.w0) * 4 * 16) / 16 + '|' + n.midi));
  } catch (e) { return null; }
  const hit = origMelody.filter(n => argSet.has(n.q + '|' + n.midi)).length;
  return hit / origMelody.length;
}

/* harmony agreement: per-beat-window {root, quality} fit (songgraph/harmony.js's own fitChord,
   the SAME real analyzer G7a already validated against hymn SATB, 89.2%/93.1%) on the
   arranged graph's own note content, compared window-for-window against the ORIGINAL piece's
   own harmony (sg.harmony) - both graphs share the same measures/tempo (every arranger's
   output is spliced back onto the SAME wire score), so the beat grid lines up exactly. */
function harmonyAgreement(sg, argGraph) {
  let argHarmony;
  try { argHarmony = HARMONY.harmonyOf(argGraph); } catch (e) { return null; }
  const n = Math.min(sg.harmony.length, argHarmony.length);
  if (!n) return null;
  let rootQual = 0, rootOnly = 0, compared = 0;
  for (let i = 0; i < n; i++) {
    const a = sg.harmony[i], b = argHarmony[i];
    if (a.root == null) continue; /* only compare where the ORIGINAL piece has real harmony content */
    compared++;
    if (a.root === b.root) rootOnly++;
    if (a.root === b.root && a.quality === b.quality) rootQual++;
  }
  if (!compared) return null;
  return { rootQuality: rootQual / compared, rootOnly: rootOnly / compared, compared: compared };
}

function engraving(graph, id) {
  try {
    const row = bench.measure({ id: id, graph: graph });
    return { silent: row.m['eg.ledger.silent'], hard: row.m['eg.layout.hard_violations'], error: row.m['eg.error'] };
  } catch (e) { return { error: 1, exception: String(e && e.message || e).slice(0, 200) }; }
}

function scoreGraphFor(g, sg, plan, argGraph, label) {
  const row = { label: label };
  if (!argGraph) { row.ok = false; return row; }
  row.ok = true;
  row.hardViolations = hardViolations(argGraph);
  row.level = levelPosition(argGraph);
  row.melodyPreservation = melodyPreservation(g, plan, argGraph);
  row.harmony = harmonyAgreement(sg, argGraph);
  row.engrave = engraving(argGraph, label);
  return row;
}

/* ---- one corpus file, all four arrangers ---- */
async function evaluateFile(relPath) {
  const rows = await importCorpus([relPath]);
  const r = rows[0];
  if (!r.ok) return { path: relPath, ok: false, reason: 'import' };
  const g = r.graph;
  const sg = SGG.analyze(g);
  const assessed = DIFF.assess(g, weights);
  if (!assessed.level) return { path: relPath, ok: false, reason: 'no-level' };
  const targetLevel = assessed.level.position, stage = assessed.level.stage;
  const planned = PLANJS.plan(g, sg, { targetLevel: targetLevel, handProfile: 'medium', style: 'block' });
  if (!planned.ok) return { path: relPath, ok: false, reason: 'plan:' + planned.reason };
  const plan = planned.plan;

  const out = { path: relPath, ok: true, targetLevel: targetLevel, stage: stage, arrangers: {} };

  /* G8a */
  const g8a = REALIZE.realize(g, sg, plan, {});
  out.arrangers.g8a = scoreGraphFor(g, sg, plan, g8a.ok ? g8a.graph : null, 'g8a:' + relPath);
  if (!g8a.ok) out.arrangers.g8a.reason = g8a.reason;

  /* the two legacy Score-based engines share one wire score */
  const wire = patchHands(SG.legacy.toScore(g, { name: relPath, id: 'g8a-eval:' + relPath, ids: true, tempo: 96 }), g);

  const asp = runArrangeScorePy(wire, stage);
  if (asp.ok) {
    const gr = graphFromNotes(wire, asp.notes);
    out.arrangers.arrangeScorePy = gr.ok ? scoreGraphFor(g, sg, plan, gr.graph, 'asp:' + relPath) : { ok: false, reason: gr.reason };
  } else out.arrangers.arrangeScorePy = { ok: false, reason: asp.reason };

  const sar = runScoreArranger(wire, stage);
  if (sar.ok) {
    const gr = graphFromNotes(wire, sar.notes);
    out.arrangers.scoreArranger = gr.ok ? scoreGraphFor(g, sg, plan, gr.graph, 'sa:' + relPath) : { ok: false, reason: gr.reason };
  } else out.arrangers.scoreArranger = { ok: false, reason: sar.reason };

  const aud = runAudioScore(wire, stage);
  if (aud.ok) {
    const gr = graphFromNotes(wire, aud.notes);
    out.arrangers.audioScore = gr.ok ? scoreGraphFor(g, sg, plan, gr.graph, 'as:' + relPath) : { ok: false, reason: gr.reason };
  } else out.arrangers.audioScore = { ok: false, reason: aud.reason };

  return out;
}

/* A real, deterministic, multi-file sample (§4's correction: "more than one fixture per
   engine"): the first N files (alphabetical, i.e. deterministic) from each of the two real
   corpus families - hymns (SATB, richest G7a ground truth) and method books (the other real
   family G7b's own corpus-check.js measures) - that a plan actually succeeds on, since G8a
   cannot arrange what G7b cannot plan; legacy engines are run on the exact same set for a
   genuine same-inputs comparison, not a wider set that would only pad their own numbers. */
function sampleFiles(hymnCount, methodCount) {
  const all = corpusFiles();
  const hymns = all.filter(f => f.startsWith('catalog/hymns/'));
  const method = all.filter(f => f.startsWith('catalog/method/'));
  return { hymns: hymns.slice(0, hymnCount * 4), method: method.slice(0, methodCount * 4), hymnCount, methodCount };
}

module.exports = {
  REPO, patchHands, runArrangeScorePy, runScoreArranger, runAudioScore, graphFromNotes,
  hardViolations, levelPosition, melodyPreservation, harmonyAgreement, engraving,
  evaluateFile, sampleFiles, STAGE_TO_LEGACY_LEVEL, LEGACY_STYLE
};
