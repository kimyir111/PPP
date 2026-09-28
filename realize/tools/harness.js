#!/usr/bin/env node
/* ============================================================================
   PPP Arrangement Realization — the real comparative harness (docs/GOALS/G08 §6a/§7).

   For each real corpus file: find a real G7b plan at the piece's own assessed G6 level
   (±1 stage, several hand profiles - the same fair "own real level" search
   arrangement/tools/corpus-check.js already established, reused here rather than an
   arbitrary fixed level that would make "unreachable" mean nothing); realize it with G8a;
   run the SAME piece through all three legacy engines, each given its own best-effort shot
   at the SAME G6 target (searching its own 4 native levels and keeping whichever one's REAL
   measured G6 position lands closest - the same fairness G8a's own search gets, never a
   fixed guess); score all four on the SAME five metrics (realize/tools/metrics.js).

   node realize/tools/harness.js [--sample N] [--out path.json]
   ========================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');
const REPO = path.resolve(__dirname, '..', '..');
const SGG = require(path.join(REPO, 'songgraph/index.js'));
const ARR = require(path.join(REPO, 'arrangement/index.js'));
const REALIZE = require(path.join(REPO, 'realize/index.js'));
const DIFF = require(path.join(REPO, 'difficulty/index.js'));
const WEIGHTS = require(path.join(REPO, 'difficulty/weights/g6a-v1.json'));
const H = require(path.join(REPO, 'tests/engrave/helpers.js'));
const L = require(path.join(REPO, 'realize/tools/legacy.js'));
const M = require(path.join(REPO, 'realize/tools/metrics.js'));

const LEGACY_LEVELS = ['beginner', 'intermediate', 'advanced', 'original'];
const HAND_PROFILES = ['large', 'medium', 'small'];

/* The real, stratified, seeded reference-corpus sample G4a already built
   (tests/engrave/corpus.json) - reused directly as G8's own "more than one fixture per
   engine" sample (docs/GOALS/G08 §4's correction), not a fresh, uncurated pick. */
function sampleFiles(n) {
  const manifest = JSON.parse(fs.readFileSync(path.join(REPO, 'tests', 'engrave', 'corpus.json'), 'utf8'));
  const files = manifest.files.slice();
  if (!n || n >= files.length) return files;
  /* even coverage across strata: round-robin the manifest's own stratum order */
  const byStratum = manifest.strata.map(s => s.files.slice());
  const out = [];
  let i = 0;
  while (out.length < n && byStratum.some(s => s.length)) {
    const s = byStratum[i % byStratum.length];
    if (s.length) out.push(s.shift());
    i++;
  }
  return out;
}

function findG8Plan(g, sg, ownPosition) {
  for (const lvl of [ownPosition, ownPosition + 1, ownPosition - 1, ownPosition + 2]) {
    for (const profile of HAND_PROFILES) {
      const r = ARR.planner.plan(g, sg, { targetLevel: lvl, handProfile: profile, sections: 'all' });
      if (r.ok) return { plan: r.plan, profile: profile, targetLevel: lvl };
    }
  }
  return null;
}

/* Every legacy engine gets the SAME fairness G8a's own plan search gets: try every one of
   its own native levels, keep whichever REAL measured G6 position lands closest to the
   SAME target G8a is planning for - never a fixed, guessed level-name mapping. */
function bestLegacyRun(runOne, target) {
  let best = null, bestDiff = Infinity;
  LEGACY_LEVELS.forEach(level => {
    let r;
    try { r = runOne(level); } catch (e) { r = { error: String(e && e.message || e) }; }
    if (r.error) return;
    const diff = r.level == null ? Infinity : Math.abs(r.level - target);
    if (diff < bestDiff) { bestDiff = diff; best = Object.assign({ level: level }, r); }
  });
  return best;
}

async function runFile(rel, opts) {
  const row = { file: rel };
  let g, sg, d;
  try {
    g = await H.graphOf(rel);
    sg = SGG.analyze(g);
    d = DIFF.assess(g, WEIGHTS);
  } catch (e) { row.error = 'import/analyze: ' + String(e && e.message || e); return row; }
  row.ownLevel = d.level.position;

  const found = findG8Plan(g, sg, d.level.position);
  if (!found) { row.error = 'no reachable G7b plan at any level/profile tried'; return row; }
  row.target = found.targetLevel; row.profile = found.profile; row.stage = found.plan.stage;

  const origMelody = M.originalMelodyNotes(g, found.plan);
  row.origMelodyNotes = origMelody.length;

  /* ---- G8a ---- */
  const t0 = Date.now();
  const g8 = REALIZE.realize(g, sg, found.plan, { pattern: opts.pattern || 'auto' });
  row.g8aMs = Date.now() - t0;
  if (!g8.ok) { row.g8a = { error: g8.reason + ' ' + JSON.stringify(g8.detail).slice(0, 200) }; }
  else {
    row.g8aPattern = g8.report.patternCounts;
    row.g8a = scoreGraphCandidate(g8.graph, 'g8a:' + rel, found.profile, found.targetLevel, sg.harmony, origMelody);
  }

  /* ---- legacy engines: same wire score, same fair per-engine level search ---- */
  const ws = L.wireScoreOf(g, path.basename(rel));

  row.arrangeScorePy = bestLegacyRun(level => {
    const res = L.runArrangeScorePy([{ id: rel, score: ws, level: level, style: 'balanced' }])[0];
    if (res.error) return { error: res.error };
    const proj = L.graphFromLegacyNotes(ws.measures, res.notes, ws.tempo, rel + ':asp');
    if (!proj.ok) return { error: 'projection failed: ' + JSON.stringify(proj.unsupported).slice(0, 200) };
    return scoreGraphCandidate(proj.graph, rel + ':asp', found.profile, found.targetLevel, sg.harmony, origMelody);
  }, found.targetLevel);

  row.scoreArranger = bestLegacyRun(level => {
    const res = L.runScoreArranger(ws, level, 'balanced');
    const proj = L.graphFromLegacyNotes(ws.measures, res.notes, ws.tempo, rel + ':sa');
    if (!proj.ok) return { error: 'projection failed: ' + JSON.stringify(proj.unsupported).slice(0, 200) };
    return scoreGraphCandidate(proj.graph, rel + ':sa', found.profile, found.targetLevel, sg.harmony, origMelody);
  }, found.targetLevel);

  /* audio-score.js: no ScoreGraph, no rhythm/hands (docs/GOALS/G08 §14) - metrics 1/3 only */
  const audioNotes = L.audioNotesOf(g, ws.tempo);
  const asOut = L.runAudioScore(audioNotes, 'intermediate', 'balanced');
  row.audioScore = {
    level: 'N/A (no notated rhythm/hands - not a G6-scoreable structure)',
    hard: M.hardViolationsOfAudioNotes(asOut, found.profile),
    melody: M.melodyPreservation(origMelody, M.audioNoteList(asOut, ws.tempo)),
    g6Level: null, harmony: null, engrave: null
  };

  return row;
}

function scoreGraphCandidate(graph, id, profile, target, origHarmony, origMelody) {
  const out = {};
  try { out.hard = M.hardViolationsOfGraph(graph, profile); } catch (e) { out.hardError = String(e && e.message || e); }
  try { out.g6Level = M.levelOfGraph(graph); } catch (e) { out.g6LevelError = String(e && e.message || e); }
  try { out.melody = M.melodyPreservation(origMelody, M.graphNoteList(graph)); } catch (e) { out.melodyError = String(e && e.message || e); }
  try { out.harmony = M.harmonyAgreement(origHarmony, graph); } catch (e) { out.harmonyError = String(e && e.message || e); }
  try { out.engrave = M.engraveMetrics(graph, id); } catch (e) { out.engraveError = String(e && e.message || e); }
  out.level = out.g6Level;
  return out;
}

function mean(xs) { const v = xs.filter(x => typeof x === 'number' && Number.isFinite(x)); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; }

function summarize(rows) {
  const engines = ['g8a', 'arrangeScorePy', 'scoreArranger', 'audioScore'];
  const ok = rows.filter(r => !r.error);
  const sum = { files: rows.length, ok: ok.length, errors: rows.filter(r => r.error).map(r => r.file + ': ' + r.error) };
  engines.forEach(eng => {
    const entries = ok.map(r => r[eng]).filter(Boolean).filter(e => !e.error);
    sum[eng] = {
      n: entries.length,
      hardViolationsZero: entries.filter(e => e.hard && e.hard.hard === 0).length,
      hardViolationsMean: mean(entries.map(e => e.hard && e.hard.hard)),
      meanMelody: mean(entries.map(e => e.melody)),
      meanHarmonyRootQuality: mean(entries.map(e => e.harmony && e.harmony.rootQuality)),
      meanHarmonyRootOnly: mean(entries.map(e => e.harmony && e.harmony.rootOnly)),
      engraveSilentZero: entries.filter(e => e.engrave && e.engrave.silent === 0).length,
      engraveHardLayoutZero: entries.filter(e => e.engrave && e.engrave.hardLayout === 0).length,
      engraveOk: entries.filter(e => e.engrave && !e.engrave.error).length
    };
  });
  /* level-within-1 needs the row's own target, computed properly here (the placeholder above is discarded) */
  engines.forEach(eng => {
    const withTarget = ok.filter(r => r[eng] && !r[eng].error && r[eng].g6Level != null);
    sum[eng].levelWithin1 = withTarget.filter(r => Math.abs(r[eng].g6Level - r.target) <= 1).length;
    sum[eng].levelMeanAbsDiff = mean(withTarget.map(r => Math.abs(r[eng].g6Level - r.target)));
    sum[eng].nWithLevel = withTarget.length;
  });
  return sum;
}

async function main() {
  const args = process.argv.slice(2);
  const sampleN = args.indexOf('--sample') >= 0 ? Number(args[args.indexOf('--sample') + 1]) : null;
  const outPath = args.indexOf('--out') >= 0 ? args[args.indexOf('--out') + 1] : path.join(__dirname, '..', '..', 'tests', 'realize', 'out', 'harness.json');
  const pattern = args.indexOf('--pattern') >= 0 ? args[args.indexOf('--pattern') + 1] : 'auto';
  const files = sampleFiles(sampleN);
  console.log('running harness over', files.length, 'files, pattern=', pattern);
  const rows = [];
  for (const f of files) {
    const t0 = Date.now();
    const row = await runFile(f, { pattern: pattern });
    row.ms = Date.now() - t0;
    console.log(f, row.error ? ('ERROR: ' + row.error) : ('ok in ' + row.ms + 'ms'));
    rows.push(row);
  }
  const summary = summarize(rows);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify({ summary: summary, rows: rows }, null, 1));
  console.log('written', outPath);
  console.log(JSON.stringify(summary, null, 1));
}

if (require.main === module) main().catch(e => { console.error(e.stack || e); process.exit(1); });
module.exports = { sampleFiles, runFile, summarize };
