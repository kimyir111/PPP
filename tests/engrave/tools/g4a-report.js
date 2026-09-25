/* G4a numbers (docs/GOALS/G04 §32): the L1 ledger over the corpus, and what the render source costs.

   node tests/engrave/tools/g4a-report.js [--json]

   Node only. Prints, over every eligible corpus file, the transcription goldens and their G3a versions:
     - per notation kind: how many the graphs state, and how the plan disposes of them
     - the audit (silent, invented, duplicate, missing: all must be 0)
     - time: plan, legacy.fromScore, agree, link, the cache's encode and decode (median and worst, ms)
     - storage: canonical text, gzip, and the legacy Score JSON a song slot already holds */
'use strict';
const path = require('path');
const H = require(path.join(__dirname, '..', 'helpers.js'));
const { SG, E } = H;

const ms = f => { const t0 = process.hrtime.bigint(); const r = f(); return [r, Number(process.hrtime.bigint() - t0) / 1e6]; };
const ams = async f => { const t0 = process.hrtime.bigint(); const r = await f(); return [r, Number(process.hrtime.bigint() - t0) / 1e6]; };
const stat = xs => { const s = xs.slice().sort((a, b) => a - b); return { median: +s[Math.floor(s.length / 2)].toFixed(2), max: +s[s.length - 1].toFixed(2) }; };

(async () => {
  const all = (await H.corpusGraphs()).concat(H.goldenGraphs(), H.g3aGraphs());
  const kinds = {}, audit = { silent: 0, invented: 0, duplicate: 0, missing: 0, kindMismatch: 0 };
  const t = { plan: [], fromScore: [], agree: [], link: [], encode: [], decode: [] };
  let text = 0, gzip = 0, scoreJson = 0, derivedBeams = 0, merged = 0, worst = { plan: ['', 0] };
  for (const [k, g] of all) {
    const [p, tp] = ms(() => E.plan(g));
    t.plan.push(tp);
    if (tp > worst.plan[1]) worst.plan = [k, tp];
    const a = E.audit(g, p);
    Object.keys(audit).forEach(x => { audit[x] += a[x].length; });
    Object.keys(a.byKind).forEach(kind => {
      const o = kinds[kind] = kinds[kind] || {};
      Object.keys(a.byKind[kind]).forEach(s => { o[s] = (o[s] || 0) + a.byKind[kind][s]; });
    });
    derivedBeams += p.beams.filter(b => b.source === 'derived').length;
    merged += p.tuplets.filter(x => x.source === 'merged').length;
    const score = H.scoreOf(g, k);
    const [fr, tf] = ms(() => SG.legacy.fromScore(score));
    t.fromScore.push(tf);
    t.agree.push(ms(() => SG.legacy.agree(score, g))[1]);
    t.link.push(ms(() => SG.legacy.link(score, g))[1]);
    if (!fr.ok) console.log('fromScore failed', k);
    const [rec, te] = await ams(() => E.store.encode(g, { key: k }));
    t.encode.push(te);
    t.decode.push((await ams(() => E.store.decode(rec)))[1]);
    text += rec.size; gzip += rec.stored; scoreJson += JSON.stringify(score).length;
  }
  const out = {
    graphs: all.length, audit: audit, kinds: kinds, derivedBeams: derivedBeams, mergedOneNoteGroups: merged,
    ms: Object.fromEntries(Object.keys(t).map(k => [k, stat(t[k])])), slowestPlan: worst.plan,
    storage: { textKB: Math.round(text / 1024), gzipKB: Math.round(gzip / 1024), ratio: +(gzip / text).toFixed(3), legacyScoreKB: Math.round(scoreJson / 1024) }
  };
  if (process.argv.indexOf('--json') > 0) { console.log(JSON.stringify(out, null, 1)); return; }
  console.log('graphs', out.graphs, ' audit', JSON.stringify(audit), ' derived beams', derivedBeams, ' merged one-note groups', merged);
  console.log('time (ms, median / worst):', Object.keys(out.ms).map(k => k + ' ' + out.ms[k].median + ' / ' + out.ms[k].max).join(', '), ' slowest plan', worst.plan[0]);
  console.log('storage:', JSON.stringify(out.storage));
  console.log('\nkind'.padEnd(20) + 'total  drawn derived merged suppr deferred');
  Object.keys(kinds).sort().forEach(k => {
    const o = kinds[k];
    console.log(k.padEnd(19) + String(o.total || 0).padStart(6) + String(o.drawn || 0).padStart(7) + String(o.derived || 0).padStart(8) +
      String(o.merged || 0).padStart(7) + String(o.suppressed || 0).padStart(6) + String(o.deferred || 0).padStart(9));
  });
})().catch(e => { console.error(e); process.exit(1); });
