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
const CAND = require(path.join(REPO, 'candidates/index.js'));

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

  /* ---- G9a best-of-N (docs/GOALS/G09_CANDIDATES_CRITICS_REPAIR.md §5/§6): the SAME
     (targetLevel, handProfile) G8a's own single-realization search above already found
     for this file - so best-of-N and single-realization are compared at the exact same
     request, never a more favorable target/profile silently substituted for one side.
     Enumeration+scoring is done once; ablations (opts.ablateCritics) re-run only the cheap
     `select()` step against the SAME already-scored candidates with one critic's weight
     zeroed - no re-planning/re-realizing per ablation. */
  if (opts.g9a) {
    const request = { targetLevel: found.targetLevel, handProfile: found.profile, sections: 'all' };
    const t1 = Date.now();
    const enumerated = CAND.enumerate(g, sg, request, { n: opts.n || 8, reference: opts.reference });
    const scored = CAND.scoreCandidates(enumerated.candidates, g, sg, request, { reference: opts.reference });
    row.g9aMs = Date.now() - t1;
    row.g9aTried = enumerated.tried.length;
    row.g9aScored = scored.length;
    const sel = CAND.select(scored, request, {});
    if (!sel.ok) { row.g9a = { error: sel.reason }; }
    else {
      row.g9aPattern = sel.selected.spec;
      row.g9aExplanation = sel.explanation;
      row.g9a = scoreGraphCandidate(sel.selected.graph, rel + ':g9a', found.profile, found.targetLevel, sg.harmony, origMelody);
    }
    if (opts.ablateCritics && opts.ablateCritics.length && scored.length) {
      row.g9aAblate = {};
      opts.ablateCritics.forEach(critic => {
        const weights = Object.assign({}, CAND.DEFAULT_WEIGHTS); weights[critic] = 0;
        const abl = CAND.select(scored, request, { weights: weights });
        row.g9aAblate[critic] = abl.ok
          ? scoreGraphCandidate(abl.selected.graph, rel + ':g9a-ablate-' + critic, found.profile, found.targetLevel, sg.harmony, origMelody)
          : { error: abl.reason };
        if (abl.ok) row.g9aAblate[critic].pattern = abl.selected.spec;
      });
    }
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

/* One engine's summary row, given its own per-file entry accessor `get(r) -> entry|undefined`
   (used for both the five top-level engines and, from `main()`, each G6-level-critic
   ablation variant under `row.g9aAblate[critic]` - same shape, same computation, so an
   ablation's numbers are directly comparable to the real g9a row). */
function summarizeEntries(ok, get) {
  const entries = ok.map(get).filter(Boolean).filter(e => !e.error);
  const out = {
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
  const withTarget = ok.filter(r => { const e = get(r); return e && !e.error && e.g6Level != null; });
  out.levelWithin1 = withTarget.filter(r => Math.abs(get(r).g6Level - r.target) <= 1).length;
  out.levelMeanAbsDiff = mean(withTarget.map(r => Math.abs(get(r).g6Level - r.target)));
  out.nWithLevel = withTarget.length;
  return out;
}

function summarize(rows, opts) {
  opts = opts || {};
  const engines = ['g8a', 'g9a', 'arrangeScorePy', 'scoreArranger', 'audioScore'];
  const ok = rows.filter(r => !r.error);
  const sum = { files: rows.length, ok: ok.length, errors: rows.filter(r => r.error).map(r => r.file + ': ' + r.error) };
  engines.forEach(eng => { sum[eng] = summarizeEntries(ok, r => r[eng]); });
  if (opts.ablateCritics && opts.ablateCritics.length) {
    sum.g9aAblate = {};
    opts.ablateCritics.forEach(critic => {
      sum.g9aAblate[critic] = summarizeEntries(ok, r => r.g9aAblate && r.g9aAblate[critic]);
    });
  }
  return sum;
}

async function main() {
  const args = process.argv.slice(2);
  const flag = name => args.indexOf(name) >= 0;
  const opt = (name, dflt) => args.indexOf(name) >= 0 ? args[args.indexOf(name) + 1] : dflt;
  const sampleN = flag('--sample') ? Number(opt('--sample')) : null;
  const outPath = opt('--out', path.join(__dirname, '..', '..', 'tests', 'realize', 'out', 'harness.json'));
  const pattern = opt('--pattern', 'auto');
  const g9a = flag('--g9a'); /* docs/GOALS/G09_CANDIDATES_CRITICS_REPAIR.md §5/§6 central measurement */
  const n = flag('--n') ? Number(opt('--n')) : 8;
  const ablateCritics = flag('--ablate-critics') ? opt('--ablate-critics').split(',') : [];
  const files = sampleFiles(sampleN);
  console.log('running harness over', files.length, 'files, pattern=', pattern, g9a ? ('g9a n=' + n + (ablateCritics.length ? ' ablate=' + ablateCritics.join(',') : '')) : '(g9a off)');
  const rows = [];
  for (const f of files) {
    const t0 = Date.now();
    const row = await runFile(f, { pattern: pattern, g9a: g9a, n: n, ablateCritics: ablateCritics });
    row.ms = Date.now() - t0;
    console.log(f, row.error ? ('ERROR: ' + row.error) : ('ok in ' + row.ms + 'ms' + (row.g9aMs != null ? (' (g9a ' + row.g9aMs + 'ms, ' + row.g9aScored + ' candidates)') : '')));
    rows.push(row);
  }
  const summary = summarize(rows, { ablateCritics: ablateCritics });
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify({ summary: summary, rows: rows }, null, 1));
  console.log('written', outPath);
  console.log(JSON.stringify(summary, null, 1));
}

if (require.main === module) main().catch(e => { console.error(e.stack || e); process.exit(1); });
module.exports = { sampleFiles, runFile, summarize };
