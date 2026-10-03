#!/usr/bin/env node
/* G10c-0: what the one-note arranger does to RECORDINGS (docs/GOALS/G10 section 9, "rec-arrange").

     node tests/bench/node/rec-arrange.js --in jobs.jsonl --refs refs.jsonl --out out.jsonl [--audio-score path]

   jobs   {"id", "ref", "input", "opts", "bar_sec": [seconds of every reference bar start, then of its end]}   (the performance, as notate.js takes it)
   refs   {"id", "xml"}                                                                                           (the true score)
   out    {"id", "ok": true, "metrics": {...}, "counts": {...}} or {"id", "ok": false, "error", "code"}, in input order, then one {"meta": {...}} line.

   For each job: the recording graph (audio-score.js toMusicXml with the case's options, the app's closeGaps / exactBars) is arranged the way the app does it
   (tests/realize/app-single-extract.js: the app's own arrangeSingleNote glue) at the three levels, and the arrangements are measured against the TRUE score:
   its melody (SongGraph's melody voice, the top head of each event), its harmony (G7a on the true score) and its own arrangement by the same pipeline.
   The true melody notes are matched to the heard notes by pitch and time (one to one, 0.2 s), so a note the transcription never heard is an upstream error
   and is not charged to the arranger (`src.melody.heard` says how many were heard); every position after that is the recording graph's own (the
   arrangement keeps the timeline), so the metrics read positions, not seconds.

   Two halves, on purpose. The system under test is audio-score.js and the arranger modules (scoregraph/, songgraph/, arrangement/, candidates/, repair/,
   realize/, critics/, playability/, difficulty/) beside the --audio-score file: a mutant or an A/B side supplies them. The RULER is the repository's own
   songgraph/, scoregraph/ and playability/ (analysis of the true score, harmony, the checker, hard violations), whatever the system under test is, so a
   planted defect in the system cannot change the ruler. Metric tool: it is not part of the SUT, and meta.sut_modules lists only the SUT's modules.

   Metrics (a case's value is the mean over the levels that were made; names in docs/GOALS/G10 section 20):
     arr.made                  share of the three levels (beginner, intermediate, advanced) the arranger made (the others are refusals)
     arr.melody.kept           share of the heard true melody notes the arrangement has, same pitch, in the right hand (the melody hand), onset within 0.15 quarter
     arr.melody.cross          ... that it has only in the left hand (the hand split's error, kept)
     arr.melody.lost           ... that it does not have at all
     arr.melody.gap_rate       ... at whose onset the right hand sounds nothing (a rest in the melody staff where a melody note exists: the 15-of-118 effect)
     arr.harmony.agreement     share of the true score's beat windows (G7a root + quality) whose chord the arrangement's window at that moment has
     arr.level.distinct        (distinct arrangements among the levels made - 1) / (levels made - 1): 0 when the levels collapse into one
     arr.level.distance        mean Jaccard distance of the levels' note sets (onset, pitch, hand), over the pairs
     arr.rh.not_melody         share of the right hand's attacks that are no true melody note (same pitch, onset within 0.15 quarter): a note taken for the melody that is not
     arr.lh.notes_per_bar      left-hand attacks per bar
     arr.rh.above_c6           share of right-hand attacks above C6 (MIDI 84)
     arr.hard.violations       G5 hard violations at the request's hand profile
     arr.check.1 .. 7          notation-check classes per 100 bars (the acceptance classes)
     arr.notes                 notes written (information)
     src.melody.heard / src.melody.in_lh / src.harmony.agreement   about the recording graph before any arranging (information)
     clean.<name>              the same, for the true score's own arrangement (information: the ceiling the recording is measured against) */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function arg(name) { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : null; }
const repoRoot = path.resolve(__dirname, '..', '..', '..');
const sut = path.resolve(arg('--audio-score') || process.env.PPP_BENCH_AUDIO_SCORE || path.join(repoRoot, 'audio-score.js'));
const sutDir = path.dirname(sut);
const inPath = arg('--in'), refsPath = arg('--refs'), outPath = arg('--out');
if (!inPath || !refsPath || !outPath) { process.stderr.write('usage: rec-arrange.js --in jobs.jsonl --refs refs.jsonl --out out.jsonl [--audio-score path]\n'); process.exit(2); }

/* A file the SUT's modules read that is not part of its snapshot (critics/metrics.js loads tests/ helpers and the G6 weights, as the Node build always has) is read from this
   repository at the same relative path, when the SUT directory is a copy (a mutant, an A/B side). The snapshot's own files are never redirected. */
if (sutDir !== repoRoot) {
  const Module = require('module');
  const resolve = Module._resolveFilename;
  Module._resolveFilename = function (request, parent, ...rest) {
    try { return resolve.call(this, request, parent, ...rest); }
    catch (e) {
      if (e && e.code === 'MODULE_NOT_FOUND' && path.isAbsolute(request)) {
        const rel = path.relative(sutDir, request);
        if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) return resolve.call(this, path.join(repoRoot, rel), parent, ...rest);
      }
      throw e;
    }
  };
}

/* the RULER: this repository's own modules */
const RR = p => require(path.join(repoRoot, p));
const RAT = RR('scoregraph/rational.js');
const SGR = RR('scoregraph/index.js');
const TIME = RR('scoregraph/time.js');
const SGGR = RR('songgraph/index.js');
const HARM = RR('songgraph/harmony.js');
const UTIL = RR('songgraph/util.js');
const PLA = RR('playability/index.js');
const NC = RR('scoregraph/tools/notation-check.js');

/* the SYSTEM UNDER TEST: the snapshot beside --audio-score */
const SR = p => require(path.join(sutDir, p));
const A = require(sut);
const E = RR('tests/realize/app-single-extract.js');
function sutWindow() {
  return {
    PPPSongGraph: SR('songgraph/index.js'), PPPArrangement: SR('arrangement/index.js'),
    PPPCandidates: SR('candidates/index.js'), PPPRepair: SR('repair/index.js'),
    PPPCriticsModules: { metrics: SR('critics/metrics.js') },
    PPPArrangementModules: { reference: SR('arrangement/reference.js') },
    PPPRealizeModules: { ottava: SR('realize/ottava.js'), clefs: SR('realize/clefs.js') },
    PPPScoreGraphModules: { serialize: SR('scoregraph/serialize.js'), legacyScore: SR('scoregraph/legacy-score.js'), pitch: SR('scoregraph/pitch.js') }
  };
}
const reference = E.reference();
const app = E.make({ window: sutWindow(), Score: {}, loadArrangerReference: () => Promise.resolve(reference) });
const SGSER = SR('scoregraph/index.js');

const M = require('./rec-arrange-metrics.js');
const LEVELS = ['beginner', 'intermediate', 'advanced'];
const HEARD_WINDOW_S = 0.2;       /* a true melody note and the heard note it became */
const EPS = 1e-6;
const num = r => RAT.toNumber(r);

function jsonl(file) { return fs.readFileSync(file, 'utf8').split('\n').filter(l => l.trim()).map(l => JSON.parse(l)); }
const mean = xs => { const v = xs.filter(x => x !== null && x !== undefined && !Number.isNaN(x)); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };

/* ---- graph reading (positions in quarter notes) ---- */
function staffIndex(g) { const m = new Map(); g.parts.forEach(p => p.staves.forEach((s, i) => m.set(s.id, i))); return m; }
function tieStops(g) { const s = new Set(); g.parts.forEach(p => (p.spanners || []).forEach(sp => { if (sp.type === 'tie' && sp.to) s.add(sp.to); })); return s; }
/* every sounding head: {q0, q1, midi, staff (0 = upper), tieStop, headId} */
function notesOf(g) {
  const si = staffIndex(g), ts = tieStops(g);
  return UTIL.noteWindows(g).map(n => ({ q0: num(n.w0) * 4, q1: num(n.w1) * 4, midi: n.midi, staff: si.get(n.staff) || 0, tieStop: ts.has(n.headId), headId: n.headId }));
}
function measureTable(g) {
  const startQ = [], durQ = []; let acc = 0;
  g.timeline.measures.forEach(m => { const d = num(RAT.parse(m.dur)) * 4; startQ.push(acc); durQ.push(d); acc += d; });
  return { startQ, durQ, bars: g.timeline.measures.length };
}

/* ---- the true score (cached per reference) ---- */
const truthCache = new Map();
function barOf(tab, q) { let k = 0; for (let i = 0; i < tab.startQ.length; i++) { if (tab.startQ[i] <= q + EPS) k = i; else break; } return k; }
function analyseTruth(ref) {
  if (truthCache.has(ref.id)) return truthCache.get(ref.id);
  const r = SGR.musicxml.import(ref.xml, { scoreId: 'ref' });
  const T = r.graph || r;
  if (!T || !T.timeline) throw Object.assign(new Error('the reference does not import'), { code: 'REF_IMPORT' });
  const tab = measureTable(T);
  const sg = SGGR.analyze(T);
  const si = staffIndex(T), ts = tieStops(T);
  const mb = sg.melodyBass.parts[0];
  const melody = [];
  if (mb && mb.melodyVoice) {
    const part = T.parts.find(p => p.id === mb.part);
    part.events.forEach(e => {
      if (e.kind !== 'note' || e.grace || e.voice !== mb.melodyVoice || !(e.heads || []).length) return;
      const heads = e.heads.filter(h => !ts.has(h.id));
      if (!heads.length) return;
      const top = heads.reduce((a, b) => (SGR.pitch.midi(b.pitch) > SGR.pitch.midi(a.pitch) ? b : a));
      const q = num(TIME.scorePos(T, e)) * 4;
      melody.push({ q, midi: SGR.pitch.midi(top.pitch), staff: si.get(e.staff) || 0 });
    });
  }
  melody.sort((a, b) => a.q - b.q || a.midi - b.midi);
  const windows = HARM.harmonyOf(T).filter(w => w.root !== null && w.root !== undefined).map(w => ({ q0: num(w.w0) * 4, q1: num(w.w1) * 4, chord: w.root + ':' + w.quality }));
  const t = { T, tab, melody, windows, clean: null };
  truthCache.set(ref.id, t);
  return t;
}
/* seconds of a true-score position: linear inside the bar between the performance's bar starts (``barSec``: every bar's start, then the end of the last) */
function secOfFor(t, barSec) {
  if (!barSec || barSec.length !== t.tab.bars + 1) throw Object.assign(new Error('the reference has ' + t.tab.bars + ' bars, the time table ' + (barSec ? barSec.length - 1 : 'none')), { code: 'REF_BARS' });
  return q => { const i = barOf(t.tab, q); const f = t.tab.durQ[i] ? (q - t.tab.startQ[i]) / t.tab.durQ[i] : 0; return barSec[i] + f * (barSec[i + 1] - barSec[i]); };
}

/* ---- measuring one arrangement ---- */
/* the windows of a graph's own harmony: [{q0, q1, chord}] */
function chordWindows(g) {
  return HARM.harmonyOf(g).filter(w => w.root !== null && w.root !== undefined).map(w => ({ q0: num(w.w0) * 4, q1: num(w.w1) * 4, chord: w.root + ':' + w.quality }));
}

function measureLevel(arr, melodyAt, truthChordsAt) {
  const g = arr.graph, ix = M.indexNotes(notesOf(g)), tab = measureTable(g);
  const out = {};
  const ms = M.melodyStats(ix, melodyAt);
  if (ms) { out['arr.melody.kept'] = ms.kept; out['arr.melody.cross'] = ms.cross; out['arr.melody.lost'] = ms.lost; out['arr.melody.gap_rate'] = ms.gap_rate; out['arr.rh.not_melody'] = M.notMelody(ix, melodyAt); }
  out['arr.harmony.agreement'] = truthChordsAt.length ? M.chordAgreement(chordWindows(g), truthChordsAt) : null;
  const hs = M.handStats(ix, tab.bars);
  out['arr.lh.notes_per_bar'] = hs.lh_notes_per_bar; out['arr.rh.above_c6'] = hs.rh_above_c6;
  let hard = null;
  try { hard = PLA.analyzeGraph(g, { profile: (arr.report && arr.report.request && arr.report.request.handProfile) || 'medium' }).totals.hard; } catch (e) { hard = null; }
  out['arr.hard.violations'] = hard;
  try {
    const rep = NC.checkGraph(g);
    for (let c = 1; c <= 7; c++) out['arr.check.' + c] = rep.bars ? 100 * rep.classes[c].count / rep.bars : null;
  } catch (e) { for (let c = 1; c <= 7; c++) out['arr.check.' + c] = null; }
  out['arr.notes'] = ix.onsets.length;
  out._keys = M.keysOf(ix);
  out._fp = SGSER.fingerprint ? SGSER.fingerprint(g) : null;
  return out;
}

async function arrangeAll(g) {
  const res = [];
  for (const level of LEVELS) {
    let a;
    try { a = await app.arrangeSingleNote(g, { level }); } catch (e) { a = { ok: false, reason: 'THROW', message: String(e && e.message || e) }; }
    res.push(a);
  }
  return res;
}

/* the metrics of the levels that were made, averaged, plus the level spread; `prefix` is 'arr.' (the recording) or 'clean.' */
function summarise(arrs, melodyAt, chordsAt) {
  const made = arrs.filter(a => a && a.ok);
  const m = { 'arr.made': made.length / LEVELS.length };
  if (!made.length) return m;
  const per = made.map(a => measureLevel(a, melodyAt, chordsAt));
  Object.keys(per[0]).filter(k => k[0] !== '_').forEach(k => { m[k] = mean(per.map(p => p[k])); });
  const sp = M.levelSpread(per.map(p => ({ keys: p._keys, fp: p._fp })));
  if (sp) { m['arr.level.distinct'] = sp.distinct; m['arr.level.distance'] = sp.distance; }
  return m;
}
const rename = (m, prefix) => { const o = {}; Object.keys(m).forEach(k => { o[k.replace(/^arr\./, prefix)] = m[k]; }); return o; };

/* one true score's own arrangement, once per process */
async function cleanOf(t) {
  if (t.clean) return t.clean;
  const melodyAt = t.melody.map(x => ({ q: x.q, midi: x.midi }));
  const chordsAt = t.windows.map(w => ({ q: (w.q0 + w.q1) / 2, chord: w.chord }));
  const arrs = await arrangeAll(t.T);
  t.clean = rename(summarise(arrs, melodyAt, chordsAt), 'clean.');
  return t.clean;
}

/* the heard note each true melody note became (rec-arrange-metrics.js matchHeard), and where the recording graph has it: [{q, midi, srcStaff}] */
function matchToGraph(perf, g, truthMelody, secOf) {
  const src = new Map(notesOf(g).map(n => [n.headId, n]));
  const heard = (perf.notes || []).filter(h => h.link && src.get(h.link)).map(h => ({ midi: h.midi, sec: h.on / 1e6, node: src.get(h.link) }));
  return M.matchHeard(truthMelody.map(m => ({ sec: secOf(m.q), midi: m.midi, q: m.q })), heard, HEARD_WINDOW_S)
    .map(x => ({ q: x.heard.node.q0, midi: x.truth.midi, srcStaff: x.heard.node.staff }));
}

async function runJob(job, refs) {
  const ref = refs.get(job.ref);
  if (!ref) throw Object.assign(new Error('no reference ' + job.ref), { code: 'NO_REF' });
  const t = analyseTruth(ref);
  const secOf = secOfFor(t, job.bar_sec);
  const built = A.toMusicXml(job.input, job.opts || {});
  const g = built.graph;
  const perf = g && g.performances && g.performances[0];
  if (!g || !perf) throw Object.assign(new Error('the recording graph has no performance layer'), { code: 'NO_PERF' });
  const matched = matchToGraph(perf, g, t.melody, secOf);
  const ptm = TIME.perfTimeMap(g, perf.id);
  const tabG = measureTable(g), endQ = tabG.startQ.length ? tabG.startQ[tabG.bars - 1] + tabG.durQ[tabG.bars - 1] : 0;
  const chordsAt = [];
  t.windows.forEach(w => {
    const us = secOf((w.q0 + w.q1) / 2) * 1e6;
    let q = null;
    try { const pp = ptm.fromUs(Math.round(us)); q = num(TIME.scorePos(g, { m: pp.m, at: pp.at })) * 4; } catch (e) { q = null; }
    if (q !== null && q >= 0 && q < endQ) chordsAt.push({ q, chord: w.chord });
  });
  const arrs = await arrangeAll(g);
  const metrics = summarise(arrs, matched.map(m => ({ q: m.q, midi: m.midi })), chordsAt);
  metrics['src.melody.heard'] = t.melody.length ? matched.length / t.melody.length : null;
  metrics['src.melody.in_lh'] = matched.length ? matched.filter(m => m.srcStaff === 1).length / matched.length : null;
  metrics['src.harmony.agreement'] = chordsAt.length ? M.chordAgreement(chordWindows(g), chordsAt) : null;
  Object.assign(metrics, await cleanOf(t));
  const reasons = {}; arrs.forEach(a => { if (!a.ok) reasons[a.reason || 'NOT_OK'] = (reasons[a.reason || 'NOT_OK'] || 0) + 1; });
  return { metrics, counts: { heard_input: job.input.notes.length, melody_truth: t.melody.length, melody_heard: matched.length, bars: tabG.bars, refused: reasons } };
}

(async () => {
  const refs = new Map(jsonl(refsPath).map(r => [r.id, r]));
  const jobs = jsonl(inPath);
  const out = fs.openSync(outPath, 'w');
  for (const job of jobs) {
    let row;
    try {
      const r = await runJob(job, refs);
      row = { id: job.id, ok: true, metrics: r.metrics, counts: r.counts };
    } catch (e) {
      row = { id: job.id, ok: false, error: String(e && e.message || e), code: (e && e.code) || null };
    }
    fs.writeSync(out, JSON.stringify(row) + '\n');
  }
  const sha = crypto.createHash('sha256').update(fs.readFileSync(sut)).digest('hex');
  /* the SUT's own modules: those loaded from its directory that are SUT files (the ruler's, the tests' and this tool are not) */
  const inside = f => { const r = path.relative(sutDir, f); return r && !r.startsWith('..') && !path.isAbsolute(r); };
  const sutTrees = ['scoregraph', 'rec', 'songgraph', 'arrangement', 'candidates', 'repair', 'realize', 'critics', 'playability', 'difficulty'];
  const sutModules = Object.keys(require.cache).filter(f => inside(f)).map(f => path.relative(sutDir, f).split(path.sep).join('/'))
    .filter(r => r.endsWith('.js') && (r === path.basename(sut) || sutTrees.indexOf(r.split('/')[0]) >= 0)).sort();
  fs.writeSync(out, JSON.stringify({ meta: { audio_score_path: sut, audio_score_sha256: sha, node: process.version, sut_modules: sutModules, sut_outside: [] } }) + '\n');
  fs.closeSync(out);
})().catch(e => { process.stderr.write(String(e && e.stack || e) + '\n'); process.exit(1); });
