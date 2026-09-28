#!/usr/bin/env node
/* Corpus-wide real-numbers check for G07B (design doc §5 acceptance, §7 performance,
   §11 implementation record). For every importable corpus file (tests/scoregraph/tools/
   g3-corpus.js's own corpus definition, same roots G7a/G6/G5's own checks use):

     1. Assess the ORIGINAL piece's real difficulty (difficulty/index.js's assess(), same
        model G6 trained and shipped) to get its own real course position - the fair level
        to request a plan AT (not an arbitrary fixed level for every piece, which would
        make "unreachable" mean nothing).
     2. Ask the planner for a plan at that real level, one stage easier, and one stage
        harder, three hand profiles each - reporting ok/unreachable/degraded/crash counts
        and timing.
     3. Determinism: plan the same (graph, sg, request) twice, compare byte-for-byte
        (JSON.stringify).

     node arrangement/tools/corpus-check.js
   ========================================================================== */
'use strict';
const path = require('path');
const REPO = path.resolve(__dirname, '..', '..');
const { corpusFiles, importCorpus } = require(path.join(REPO, 'tests', 'scoregraph', 'tools', 'g3-corpus.js'));
const SGG = require(path.join(REPO, 'songgraph', 'index.js'));
const AP = require(path.join(REPO, 'arrangement', 'index.js'));
const DIFF = require(path.join(REPO, 'difficulty', 'index.js'));
const weights = require(path.join(REPO, 'difficulty', 'weights', 'g6a-v1.json'));

function stratumOf(p) {
  if (p.startsWith('catalog/hymns/')) return 'hymns';
  const m = p.match(/^catalog\/method\/([^/]+)\//);
  if (m) return 'method/' + m[1];
  if (p.startsWith('catalog/')) return 'catalog/other';
  return 'other';
}

async function main() {
  const files = corpusFiles();
  const rows = await importCorpus(files);
  const profiles = ['small', 'medium', 'large'];
  const totals = { ok: 0, unreachable: 0, otherFail: 0, degraded: 0, crash: 0, attempts: 0, sections: 0 };
  const byStratum = {};
  const reasons = {};
  let worstMs = -1, worstPath = null;
  const timings = [];
  let determinismChecked = 0, determinismMismatches = 0;
  let noDifficulty = 0;

  for (const r of rows) {
    if (!r.ok) continue;
    const strat = stratumOf(r.path);
    byStratum[strat] = byStratum[strat] || { ok: 0, unreachable: 0, otherFail: 0, degraded: 0, crash: 0 };
    let sg;
    try { sg = SGG.analyze(r.graph); } catch (e) { totals.crash++; byStratum[strat].crash++; console.log('SONGGRAPH CRASH', r.path, e.message); continue; }
    let level;
    try { level = DIFF.assess(r.graph, weights).level; } catch (e) { noDifficulty++; continue; }
    if (!level) { noDifficulty++; continue; }
    const targets = [level.position - 1, level.position, level.position + 1];
    for (const targetLevel of targets) {
      for (const handProfile of profiles) {
        totals.attempts++;
        const req = { targetLevel: targetLevel, handProfile: handProfile };
        const t0 = process.hrtime.bigint();
        let res;
        try { res = AP.plan(r.graph, sg, req); } catch (e) { totals.crash++; byStratum[strat].crash++; console.log('PLAN CRASH', r.path, targetLevel, handProfile, e.stack); continue; }
        const t1 = process.hrtime.bigint();
        const ms = Number(t1 - t0) / 1e6;
        timings.push(ms);
        if (ms > worstMs) { worstMs = ms; worstPath = r.path + ' @' + targetLevel.toFixed(2) + '/' + handProfile; }

        if (res.ok) {
          totals.ok++; byStratum[strat].ok++;
          totals.sections += res.plan.sections.length;
          if (res.plan.degraded) totals.degraded++;
          /* determinism: replan the same input, compare byte-for-byte */
          if (determinismChecked < 400) {
            determinismChecked++;
            const res2 = AP.plan(r.graph, sg, req);
            if (JSON.stringify(res) !== JSON.stringify(res2)) { determinismMismatches++; console.log('NONDETERMINISTIC', r.path, targetLevel, handProfile); }
          }
        } else if (res.reason === 'UNREACHABLE') {
          totals.unreachable++; byStratum[strat].unreachable++;
          reasons[res.reason] = (reasons[res.reason] || 0) + 1;
        } else {
          totals.otherFail++; byStratum[strat].otherFail++;
          reasons[res.reason] = (reasons[res.reason] || 0) + 1;
        }
      }
    }
  }

  console.log(rows.length + ' corpus files, ' + noDifficulty + ' skipped (no difficulty assessment)');
  console.log('\n=== totals over ' + totals.attempts + ' (level x hand-profile) attempts ===');
  console.log(totals);
  console.log('reasons', reasons);
  console.log('\n=== by stratum ===');
  Object.keys(byStratum).sort().forEach(s => console.log(s.padEnd(18), JSON.stringify(byStratum[s])));
  console.log('\n=== determinism ===', determinismChecked, 'checked,', determinismMismatches, 'mismatches');
  timings.sort((a, b) => a - b);
  const p = q => timings.length ? timings[Math.min(timings.length - 1, Math.floor(timings.length * q))] : 0;
  console.log('\n=== performance (ms per plan() call) === n=' + timings.length,
    'p50=' + p(0.5).toFixed(3), 'p90=' + p(0.9).toFixed(3), 'p99=' + p(0.99).toFixed(3), 'worst=' + worstMs.toFixed(3), worstPath);
}

main().catch(e => { console.error(e); process.exit(1); });
