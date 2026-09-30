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

   node realize/tools/harness.js [--sample N] [--out path.json] [--g9a [--repair]] [--held-out N] [--register-floor N|off] [--stride wide|close|open] [--allow-stride | --patterns a,b,c]
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
const CRIT = require(path.join(REPO, 'critics/index.js'));
const REPAIR = require(path.join(REPO, 'repair/index.js'));
const VLC = require(path.join(REPO, 'critics/voice-leading.js'));
const RFC = require(path.join(REPO, 'critics/register-floor.js'));
const LHJ = require(path.join(REPO, 'critics/left-hand-jump.js'));
const LRC = require(path.join(REPO, 'critics/low-register-cluster.js'));
const LHT = require(path.join(REPO, 'critics/left-hand-thickness.js'));

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

/* Round 2's disjoint held-out slice (docs/GOALS/G09_CANDIDATES_CRITICS_REPAIR.md §12
   "round 2", overfitting guard): `sampleFiles` walks the SAME manifest's strata in the
   SAME round-robin order every time (deterministic, no randomness) - the round-1 16-file
   sample is exactly its first 16 files. `heldOutFiles(count)` takes the NEXT `count` files
   of that same deterministic walk (`sampleFiles(16 + count).slice(16)`) - disjoint from
   the round-1 sample BY CONSTRUCTION (the same prefix/suffix of one fixed ordering, never
   a second, independently-drawn sample that could accidentally overlap), stratified the
   same way the original sample was (round-robin across the manifest's own hymns/method-
   book strata). Some of these files will have no reachable G7b plan at any level/profile
   tried (a real G7b coverage limit, the same kind round 1's own sample hit) - `count` is
   chosen generously (round 1's reachability rate was 12/16, 75%) so the SCORED subset
   still clears the "~20 reachable files" the task asked for; the real reachable count is
   reported, not assumed. */
function heldOutFiles(count) {
  const total = JSON.parse(fs.readFileSync(path.join(REPO, 'tests', 'engrave', 'corpus.json'), 'utf8')).files.length;
  if (16 + count >= total) {
    throw new Error('--held-out ' + count + ' is too large: 16 + ' + count + ' >= manifest length ' + total +
      ' (sampleFiles then returns manifest order, so the slice would no longer be disjoint from the round-1 sample); use at most ' + (total - 17));
  }
  return sampleFiles(16 + count).slice(16);
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
  const sourceNotes = M.graphNoteList(g);
  row.origMelodyNotes = origMelody.length;

  /* ---- G8a ---- */
  const t0 = Date.now();
  const g8 = REALIZE.realize(g, sg, found.plan, Object.assign({ pattern: opts.pattern || 'auto', registerFloor: opts.registerFloor, stride: opts.stride }, opts.last));
  row.g8aMs = Date.now() - t0;
  if (!g8.ok) { row.g8a = { error: g8.reason + ' ' + JSON.stringify(g8.detail).slice(0, 200) }; }
  else {
    row.g8aPattern = g8.report.patternCounts;
    row.g8a = scoreGraphCandidate(g8.graph, 'g8a:' + rel, found.profile, found.targetLevel, sg.harmony, origMelody, sourceNotes);
  }

  /* ---- G9a best-of-N (docs/GOALS/G09_CANDIDATES_CRITICS_REPAIR.md §5/§6, round 2 in §12):
     the SAME (targetLevel, handProfile) G8a's own single-realization search above already
     found for this file - so best-of-N and single-realization are compared at the exact
     same REQUESTED target, never a more favorable one silently substituted for one side.
     `request.targetLevel` here is what `scoreCandidates`/`badnessOf` score every candidate
     against, REGARDLESS of which internal `planTargetLevel` (requested +/- an offset)
     actually produced it - round 2's own "select by assessed closeness to the requested
     target, never the planning target" rule. Enumeration+cheap-scoring is done once;
     `opts.g9aN`/`opts.levelOffsets`/`opts.topKForEngrave` thread through to
     `candidates/index.js`'s round-2 defaults (n=24, offsets [0,-1,1], topK=3). Ablations
     (opts.ablateCritics) re-run only `selectWithEngraveGate` against the SAME already
     cheap-scored candidate pool with one critic's weight zeroed - no re-planning/
     re-realizing per ablation (real engrave numbers already computed for a candidate are
     never recomputed, via the shared `engraveCache` Map passed to `selectWithEngraveGate`). */
  if (opts.g9a) {
    const request = { targetLevel: found.targetLevel, handProfile: found.profile, sections: 'all' };
    const t1 = Date.now();
    const enumerated = CAND.enumerate(g, sg, request, { n: opts.g9aN, levelOffsets: opts.levelOffsets, reference: opts.reference, registerFloor: opts.registerFloor, stride: opts.stride, patterns: opts.patterns, allowStride: opts.allowStride, last: opts.last });
    const cheapScored = CAND.scoreCandidates(enumerated.candidates, g, sg, request, { reference: opts.reference, skipEngrave: true, registerFloor: opts.registerFloor });
    const engraveCache = new Map(); /* real engrave results are reused by the ablation re-selections below (the gate never mutates cheapScored) */
    /* `opts.weights` (--weights k=v,...): selection weights overriding CAND.DEFAULT_WEIGHTS for the g9a row AND
       as the base every ablation zeroes one critic of; needed to measure a critic whose DEFAULT weight is already 0
       (voiceLeading): --weights voiceLeading=1 --ablate-critics voiceLeading compares weight 1 against weight 0. */
    const baseWeights = Object.assign({}, CAND.DEFAULT_WEIGHTS, opts.weights || {});
    const sel = CAND.selectWithEngraveGate(cheapScored, g, sg, request, { weights: baseWeights, topKForEngrave: opts.topKForEngrave, engraveCache: engraveCache });
    row.g9aMs = Date.now() - t1;
    row.g9aTried = enumerated.tried.length;
    row.g9aScored = cheapScored.length;
    row.g9aEngraveChecked = sel.ok ? sel.ranked.length : 0;
    row.g9aNotEngraveChecked = sel.ok ? sel.notEngraveChecked.length : 0;
    if (!sel.ok) { row.g9a = { error: sel.reason }; }
    else {
      row.g9aPattern = sel.selected.spec;
      row.g9aExplanation = sel.explanation;
      row.g9a = scoreGraphCandidate(sel.selected.graph, rel + ':g9a', found.profile, found.targetLevel, sg.harmony, origMelody, sourceNotes);
    }
    /* ---- G9b repair (docs/GOALS/G09 §5, §12 "G9b - repair"; `--repair`, additive): the graph G9a
       selected, repaired per measure under the REQUEST's hand profile, scored on the same five
       metrics as every other row, plus the critic scores before/after (the goal's real question:
       does repair improve the selected candidate's critic scores without regressing any metric). */
    if (opts.repair && sel.ok) {
      const t2 = Date.now();
      const rr = REPAIR.repairSelection(sel, g, sg, request, { reference: opts.reference, registerFloor: opts.registerFloor });
      row.g9aRepairMs = Date.now() - t2;
      const rep = rr.report;
      row.g9aRepairReport = {
        accepted: rep.accepted, rolledBack: rep.rolledBack, unplannable: rep.unplannable, sweeps: rep.sweeps, truncated: rep.truncated,
        fallback: rep.fallback, byOp: rep.byOp, repairedMeasures: rep.repairedMeasures.length, rolledBackMeasures: rep.rolledBackMeasures.length,
        rollbackReasons: rep.units.filter(u => !u.ok).map(u => ({ op: u.op, measure: u.measure, reasons: u.reasons }))
      };
      const criticCtx = graph => {
        const ev = CRIT.evaluate(graph, { profile: found.profile, targetLevel: found.targetLevel, stage: rr.ctx.stage, origHarmony: sg.harmony,
          origMelodyNotes: rr.ctx.origMelody, reference: opts.reference, skipEngrave: true, sourceNotes: sourceNotes });
        const c = ev.critics;
        return {
          hard: c.hard && c.hard.hard, level: c.level, melody: c.melody,
          harmonyRootQuality: c.harmony && c.harmony.rootQuality,
          voiceLeading: c.voiceLeading && c.voiceLeading.count,
          parallels: c.voiceLeading && c.voiceLeading.parallels.length,
          innerLeaps: c.voiceLeading && c.voiceLeading.innerLeaps.length,
          crossings: c.voiceLeading && c.voiceLeading.crossings.length,
          registerDensityOverage: c.registerDensity && c.registerDensity.overage,
          floorBelow: c.registerFloor && c.registerFloor.below,
          lhJumps: c.leftHandJump && c.leftHandJump.jumps, lhSteps: c.leftHandJump && c.leftHandJump.steps
        };
      };
      row.g9aCriticsBefore = criticCtx(sel.selected.graph);
      row.g9aCriticsAfter = criticCtx(rr.graph);
      row.g9aRepairChanged = rr.changed;
      row.g9aRepair = scoreGraphCandidate(rr.graph, rel + ':g9a-repair', found.profile, found.targetLevel, sg.harmony, origMelody, sourceNotes);
    }
    if (opts.ablateCritics && opts.ablateCritics.length && cheapScored.length) {
      row.g9aAblate = {};
      opts.ablateCritics.forEach(critic => {
        const weights = Object.assign({}, baseWeights); weights[critic] = 0;
        const abl = CAND.selectWithEngraveGate(cheapScored, g, sg, request, { weights: weights, topKForEngrave: opts.topKForEngrave, engraveCache: engraveCache });
        row.g9aAblate[critic] = abl.ok
          ? scoreGraphCandidate(abl.selected.graph, rel + ':g9a-ablate-' + critic, found.profile, found.targetLevel, sg.harmony, origMelody, sourceNotes)
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
    return scoreGraphCandidate(proj.graph, rel + ':asp', found.profile, found.targetLevel, sg.harmony, origMelody, sourceNotes);
  }, found.targetLevel);

  row.scoreArranger = bestLegacyRun(level => {
    const res = L.runScoreArranger(ws, level, 'balanced');
    const proj = L.graphFromLegacyNotes(ws.measures, res.notes, ws.tempo, rel + ':sa');
    if (!proj.ok) return { error: 'projection failed: ' + JSON.stringify(proj.unsupported).slice(0, 200) };
    return scoreGraphCandidate(proj.graph, rel + ':sa', found.profile, found.targetLevel, sg.harmony, origMelody, sourceNotes);
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

function scoreGraphCandidate(graph, id, profile, target, origHarmony, origMelody, sourceNotes) {
  const out = {};
  try { out.hard = M.hardViolationsOfGraph(graph, profile); } catch (e) { out.hardError = String(e && e.message || e); }
  try { out.g6Level = M.levelOfGraph(graph); } catch (e) { out.g6LevelError = String(e && e.message || e); }
  try { out.melody = M.melodyPreservation(origMelody, M.graphNoteList(graph)); } catch (e) { out.melodyError = String(e && e.message || e); }
  try { out.harmony = M.harmonyAgreement(origHarmony, graph); } catch (e) { out.harmonyError = String(e && e.message || e); }
  try { out.engrave = M.engraveMetrics(graph, id); } catch (e) { out.engraveError = String(e && e.message || e); }
  try { out.smells = VLC.voiceLeadingSmells(graph).count; } catch (e) { out.smellsError = String(e && e.message || e); } /* corrected voice-leading count, reported for every engine, never a selection input here */
  /* G9 post-H-8: arranged notes below the register floor (E2). `sourceNotes` = the original piece's notes: a note the
     source has is never counted as arranged. Reported for every engine; never a selection input. */
  try { out.floor = RFC.registerFloor(graph, { sourceNotes: sourceNotes }); } catch (e) { out.floorError = String(e && e.message || e); }
  /* G9 post-H-8 re-look: left-hand jump rate (share of left-hand steps whose bass moves an octave or more) and the
     notes below G2, for every engine; never a selection input here. */
  try { out.lhj = LHJ.leftHandJump(graph); } catch (e) { out.lhjError = String(e && e.message || e); }
  /* low-register clusters (a second or third whose lower note is below C3) and low bass-then-chord pairs, every engine, report only */
  try { out.cluster = LRC.lowRegisterCluster(graph); } catch (e) { out.clusterError = String(e && e.message || e); }
  /* G9 last defect round: left-hand notes per onset, onsets of 3+ notes, seconds below C4, chord tops at E4 or above; every engine, report only */
  try { out.lht = LHT.leftHandThickness(graph); } catch (e) { out.lhtError = String(e && e.message || e); }
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
    voiceLeadingSmellsSum: entries.reduce((a, e) => a + (typeof e.smells === 'number' ? e.smells : 0), 0),
    /* G9 post-H-8: notes below the register floor (E2) - the arranged ones (the engine's own notes) and the source ones */
    floorBelowArranged: entries.reduce((a, e) => a + (e.floor ? e.floor.below : 0), 0),
    floorBelowSource: entries.reduce((a, e) => a + (e.floor ? e.floor.belowSource : 0), 0),
    floorFilesWithArrangedBelow: entries.filter(e => e.floor && e.floor.below > 0).length,
    /* G9 post-H-8 re-look: left-hand jumps (a bass move of an octave or more between consecutive left-hand onsets).
       Pooled = all jumps / all steps; mean/max are over files; the count of files at or above the review's flagged floor (18%) */
    lhJumps: entries.reduce((a, e) => a + (e.lhj ? e.lhj.jumps : 0), 0),
    lhSteps: entries.reduce((a, e) => a + (e.lhj ? e.lhj.steps : 0), 0),
    lhJumpRatePooled: (() => { const st = entries.reduce((a, e) => a + (e.lhj ? e.lhj.steps : 0), 0); return st ? entries.reduce((a, e) => a + (e.lhj ? e.lhj.jumps : 0), 0) / st : null; })(),
    lhJumpRateMeanPerFile: mean(entries.map(e => e.lhj && e.lhj.rate)),
    lhJumpRateMaxPerFile: entries.reduce((a, e) => (e.lhj && e.lhj.rate > a ? e.lhj.rate : a), 0),
    lhJumpFilesAtOrOver18pc: entries.filter(e => e.lhj && e.lhj.rate >= 0.18).length,
    /* low-register clusters, pooled over files (chord attacks with a second or third whose lower note is below C3) */
    clusterAttacks: entries.reduce((a, e) => a + (e.cluster ? e.cluster.clusterAttacks : 0), 0),
    chordAttacks: entries.reduce((a, e) => a + (e.cluster ? e.cluster.chordAttacks : 0), 0),
    clusterRatePooled: (() => { const c = entries.reduce((a, e) => a + (e.cluster ? e.cluster.chordAttacks : 0), 0); return c ? entries.reduce((a, e) => a + (e.cluster ? e.cluster.clusterAttacks : 0), 0) / c : null; })(),
    clusterRateMeanPerFile: mean(entries.map(e => e.cluster && e.cluster.clusterRate)),
    closeBassChords: entries.reduce((a, e) => a + (e.cluster ? e.cluster.closeBassChords : 0), 0),
    bassChordPairs: entries.reduce((a, e) => a + (e.cluster ? e.cluster.bassChordPairs : 0), 0),
    notesBelowFSharp2: entries.reduce((a, e) => a + (e.cluster ? e.cluster.notesBelow42 : 0), 0),
    notesBelowG2: entries.reduce((a, e) => a + (e.lhj ? e.lhj.belowG2 : 0), 0),
    /* left-hand thickness (critics/left-hand-thickness.js), pooled over files */
    lhOnsets: entries.reduce((a, e) => a + (e.lht ? e.lht.onsets : 0), 0),
    lhNotes: entries.reduce((a, e) => a + (e.lht ? e.lht.notes : 0), 0),
    lhNotesPerOnset: (() => { const o = entries.reduce((a, e) => a + (e.lht ? e.lht.onsets : 0), 0); return o ? entries.reduce((a, e) => a + (e.lht ? e.lht.notes : 0), 0) / o : null; })(),
    lhOnsets3plus: entries.reduce((a, e) => a + (e.lht ? e.lht.onsets3plus : 0), 0),
    lhSecondsBelowC4: entries.reduce((a, e) => a + (e.lht ? e.lht.secondsBelowC4 : 0), 0),
    lhTopsAtOrAboveE4: entries.reduce((a, e) => a + (e.lht ? e.lht.topsAtOrAboveE4 : 0), 0),
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

/* G9b: repair counts and the critic scores before/after, over the files that reached repair */
function summarizeRepair(ok) {
  const rs = ok.filter(r => r.g9aRepairReport);
  const sumOf = f => rs.reduce((a, r) => a + (f(r) || 0), 0);
  const byOp = {};
  rs.forEach(r => Object.keys(r.g9aRepairReport.byOp || {}).forEach(op => {
    const o = byOp[op] = byOp[op] || { accepted: 0, rolledBack: 0 };
    o.accepted += r.g9aRepairReport.byOp[op].accepted; o.rolledBack += r.g9aRepairReport.byOp[op].rolledBack;
  }));
  const crit = k => ({ before: sumOf(r => r.g9aCriticsBefore && r.g9aCriticsBefore[k]), after: sumOf(r => r.g9aCriticsAfter && r.g9aCriticsAfter[k]) });
  const files = pred => rs.filter(pred).length;
  return {
    files: rs.length,
    filesWithAcceptedRepair: files(r => r.g9aRepairReport.accepted > 0),
    filesWithRolledBackRepair: files(r => r.g9aRepairReport.rolledBack > 0),
    filesWithFallback: files(r => r.g9aRepairReport.fallback),
    filesTruncated: files(r => r.g9aRepairReport.truncated),
    unitsAccepted: sumOf(r => r.g9aRepairReport.accepted),
    unitsRolledBack: sumOf(r => r.g9aRepairReport.rolledBack),
    unplannableSmells: sumOf(r => r.g9aRepairReport.unplannable),
    measuresRepaired: sumOf(r => r.g9aRepairReport.repairedMeasures),
    measuresRolledBack: sumOf(r => r.g9aRepairReport.rolledBackMeasures),
    byOp: byOp,
    filesWithSmellsBefore: files(r => r.g9aCriticsBefore && r.g9aCriticsBefore.voiceLeading > 0),
    filesWithSmellsAfter: files(r => r.g9aCriticsAfter && r.g9aCriticsAfter.voiceLeading > 0),
    smells: crit('voiceLeading'), parallels: crit('parallels'), innerLeaps: crit('innerLeaps'), crossings: crit('crossings'),
    registerDensityOverageSum: crit('registerDensityOverage'),
    floorBelowSum: crit('floorBelow'),
    lhJumps: crit('lhJumps'), lhSteps: crit('lhSteps'),
    hardSum: crit('hard'),
    meanHarmonyRootQuality: { before: mean(rs.map(r => r.g9aCriticsBefore && r.g9aCriticsBefore.harmonyRootQuality)), after: mean(rs.map(r => r.g9aCriticsAfter && r.g9aCriticsAfter.harmonyRootQuality)) },
    meanLevel: { before: mean(rs.map(r => r.g9aCriticsBefore && r.g9aCriticsBefore.level)), after: mean(rs.map(r => r.g9aCriticsAfter && r.g9aCriticsAfter.level)) },
    meanRepairMs: mean(rs.map(r => r.g9aRepairMs))
  };
}

function summarize(rows, opts) {
  opts = opts || {};
  const engines = ['g8a', 'g9a'].concat(opts.repair ? ['g9aRepair'] : [], ['arrangeScorePy', 'scoreArranger', 'audioScore']);
  const ok = rows.filter(r => !r.error);
  const sum = { files: rows.length, ok: ok.length, errors: rows.filter(r => r.error).map(r => r.file + ': ' + r.error) };
  engines.forEach(eng => { sum[eng] = summarizeEntries(ok, r => r[eng]); });
  if (opts.repair) sum.repair = summarizeRepair(ok);
  /* the pattern the G9a selection picked, per file (before repair: repair never changes the pattern), as a histogram */
  sum.selectedPatternHistogram = {};
  ok.forEach(r => { if (r.g9aPattern) sum.selectedPatternHistogram[r.g9aPattern.pattern] = (sum.selectedPatternHistogram[r.g9aPattern.pattern] || 0) + 1; });
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
  const heldOutCount = flag('--held-out') ? Number(opt('--held-out')) : null;
  const outPath = opt('--out', path.join(__dirname, '..', '..', 'tests', 'realize', 'out', 'harness.json'));
  const pattern = opt('--pattern', 'auto');
  const g9a = flag('--g9a'); /* docs/GOALS/G09_CANDIDATES_CRITICS_REPAIR.md §5/§6 central measurement */
  const repair = flag('--repair'); /* G9b: also repair the graph G9a selected (needs --g9a) */
  if (repair && !g9a) throw new Error('--repair needs --g9a (it repairs the graph G9a selected)');
  const g9aN = flag('--n') ? Number(opt('--n')) : undefined; /* undefined -> candidates/index.js's own default (24, round 2) */
  const levelOffsets = flag('--level-offsets') ? opt('--level-offsets').split(',').map(Number) : undefined;
  const topKForEngrave = flag('--top-k') ? Number(opt('--top-k')) : undefined;
  const ablateCritics = flag('--ablate-critics') ? opt('--ablate-critics').split(',') : [];
  let weights;
  if (flag('--weights')) {
    weights = {};
    opt('--weights').split(',').forEach(kv => { const [k, v] = kv.split('='); if (!(k in CAND.DEFAULT_WEIGHTS) || !isFinite(Number(v))) throw new Error('--weights: bad entry ' + kv); weights[k] = Number(v); });
  }
  /* --register-floor <n|off>: the realizer's register floor (default realize/theory.js REGISTER_FLOOR = 40; `off` = the
     pre-floor behaviour, for a before/after on the same code). Threaded to the realizer, the critic and repair. */
  let registerFloor;
  if (flag('--register-floor')) {
    const v = opt('--register-floor');
    registerFloor = v === 'off' ? null : Number(v);
    if (registerFloor !== null && !Number.isFinite(registerFloor)) throw new Error('--register-floor: expected a MIDI number or off, got ' + v);
  }
  /* --stride wide: the pre-fix stride geometry (pop/waltz chord voiced around the register midpoint, bass an octave under it),
     for a before/after on the same code. Default: close (chord voiced just above its bass). */
  const stride = opt('--stride', undefined);
  if (stride !== undefined && !['wide', 'close', 'open'].includes(stride)) throw new Error('--stride: expected wide, close or open (default open), got ' + stride);
  /* --allow-stride: enumerate the stride patterns (pop, waltz) and let 'auto' pick the triple-meter waltz, as before the post-H-8 change.
     --patterns a,b,c: enumerate exactly these patterns, in this order. */
  const allowStride = flag('--allow-stride');
  const patterns = flag('--patterns') ? opt('--patterns').split(',') : undefined;
  if (patterns) CAND.patternsFor({ patterns: patterns }); /* validates the names */
  /* --no-compound-beat / --no-diatonic-low / --no-left-shape: switch one last-defect-round fix off (realize/index.js; the old behaviour, for a before/after) */
  const last = {};
  if (flag('--no-compound-beat')) last.compoundBeat = false;
  if (flag('--no-diatonic-low')) last.diatonicLow = false;
  if (flag('--no-left-shape')) last.leftShape = false;
  const runOpts = { last: last, allowStride: allowStride, patterns: patterns, stride: stride, registerFloor: registerFloor, weights: weights, pattern: pattern, g9a: g9a, repair: repair, g9aN: g9aN, levelOffsets: levelOffsets, topKForEngrave: topKForEngrave, ablateCritics: ablateCritics };
  /* child mode: one file, row written to --row-out (the parent gives each file its own process and a time limit,
     so a legacy engine that never returns on one file is recorded as a timeout instead of stalling the sweep) */
  if (flag('--one')) {
    const row = await runFile(opt('--one'), runOpts);
    fs.writeFileSync(opt('--row-out'), JSON.stringify(row));
    return;
  }
  const timeoutS = Number(opt('--timeout-s', 300));
  const files = heldOutCount != null ? heldOutFiles(heldOutCount) : sampleFiles(sampleN);
  console.log('running harness over', files.length, heldOutCount != null ? '(held-out slice)' : '(round-1 sample)', 'files, pattern=', pattern,
    (repair ? '+repair ' : '') + (g9a ? ('g9a n=' + (g9aN || 24) + ' offsets=' + (levelOffsets || [0, -1, 1]).join(',') + ' topK=' + (topKForEngrave || 3) + (ablateCritics.length ? ' ablate=' + ablateCritics.join(',') : '')) : '(g9a off)'));
  const rows = [];
  for (const f of files) {
    const t0 = Date.now();
    const rowPath = path.join(require('os').tmpdir(), 'ppp-harness-row-' + process.pid + '.json');
    try { fs.unlinkSync(rowPath); } catch (e) { /* none yet */ }
    const child = require('child_process').spawnSync(process.execPath, [__filename].concat(args.filter((a, i) => {
      const prev = args[i - 1];
      return !['--held-out', '--sample', '--out', '--timeout-s'].includes(a) && !['--held-out', '--sample', '--out', '--timeout-s'].includes(prev);
    }), ['--one', f, '--row-out', rowPath]), { timeout: timeoutS * 1000, stdio: ['ignore', 'ignore', 'pipe'], encoding: 'utf8' });
    let row;
    if (child.error && child.error.code === 'ETIMEDOUT') row = { file: f, error: 'timeout after ' + timeoutS + 's (an engine did not return)', timedOut: true };
    else if (!fs.existsSync(rowPath)) row = { file: f, error: 'child failed: ' + String(child.stderr || child.error || child.status).slice(0, 300) };
    else row = JSON.parse(fs.readFileSync(rowPath, 'utf8'));
    try { fs.unlinkSync(rowPath); } catch (e) { /* already gone */ }
    row.ms = Date.now() - t0;
    console.log(f, row.error ? ('ERROR: ' + row.error) : ('ok in ' + row.ms + 'ms' + (row.g9aMs != null ? (' (g9a ' + row.g9aMs + 'ms, ' + row.g9aScored + ' candidates, ' + row.g9aEngraveChecked + ' engrave-checked' + (row.g9aRepairReport ? ', repair ' + row.g9aRepairMs + 'ms +' + row.g9aRepairReport.accepted + '/-' + row.g9aRepairReport.rolledBack : '') + ')') : '')));
    rows.push(row);
  }
  const summary = summarize(rows, { ablateCritics: ablateCritics, repair: repair });
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify({ summary: summary, rows: rows }, null, 1));
  console.log('written', outPath);
  console.log(JSON.stringify(summary, null, 1));
}

if (require.main === module) main().catch(e => { console.error(e.stack || e); process.exit(1); });
module.exports = { sampleFiles, heldOutFiles, runFile, summarize, findG8Plan, bestLegacyRun, scoreGraphCandidate };
