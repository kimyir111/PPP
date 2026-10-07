#!/usr/bin/env node
/* G10c-1a (docs/GOALS/G10_AUDIO_TO_SCORE.md section 33.3a): how hard the copies are, by G6a (`difficulty/`, `level.position`: the place on the course, a stage and a fraction; the
   model's top anchor is 3.84), per level, for the reduction and for the lead sheet. The levels are asked as stages 1, 2, 3 (the page's ARRANGER_LEVEL_TO_STAGE).

     node tests/bench/tools/level-table.js --jobs jobs.jsonl [--shard I/N] --out part.json     # the benchmark: the `v2` jobs of a jobs.jsonl (arrange_jobs.py), reduce and lead sheet
     node tests/bench/tools/level-table.js --heard DIR --out covers.json                       # the six private covers (DIR/<id>.json: {notes: [{on, off, midi, vel}]}), as real-covers.js reads them
     node tests/bench/tools/level-table.js --hymns --out hymns.json                            # the printed catalogue's hymns by the same reduction (the reference for what 'beginner' reads like)
     node tests/bench/tools/level-table.js --report part0.json part1.json ... covers.json hymns.json   # the tables (Markdown) of every part given

   Aggregates only: a case's row is its id, the position of the recording as heard and, per mode and level, the position of the copy and whether it carries the relaxed plan's note;
   nothing of a heard note is written. The recording graphs are those of audio-score.js with the job's options (a `recordingArrange` key dropped), the covers' those of the app's own
   conversion (review/lib/appcode.js, v2); every copy is made by the app's `arrangeSingleNote` (tests/realize/app-single-extract.js) with `recordingArrange` 'reduce' or 'leadsheet'. */
'use strict';
const fs = require('fs');
const path = require('path');

function arg(name) { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : null; }
const has = name => process.argv.indexOf(name) >= 0;
const REPO = path.resolve(__dirname, '..', '..', '..');
const R = p => require(path.join(REPO, p));
const LEVELS = ['beginner', 'intermediate', 'advanced'];
const MODES = ['reduce', 'leadsheet'];
const r2 = x => (x === null || x === undefined ? null : Math.round(x * 100) / 100);
const mean = xs => { const v = xs.filter(x => x !== null && x !== undefined && !Number.isNaN(x)); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
const fx = x => (x === null || x === undefined ? '-' : x.toFixed(2));

/* ------------------------------------------------------------------ report */
function setOf(id) {
  return id.startsWith('hymns/') ? 'hymns' : id.startsWith('method/') ? 'method' : id.startsWith('micro/') ? 'micro' : /^(catalog|samples)\//.test(id) ? 'catalog + samples' : 'real-AMT fixtures';
}
function table(cases, label) {
  const lines = [];
  lines.push('| ' + label + ' (' + cases.length + ' cases; heard ' + fx(mean(cases.map(c => c.src))) + ') | level | made: reduce / lead | mean position: reduce | lead | both made (n): reduce | lead | relaxed note: reduce / lead |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- |');
  LEVELS.forEach(lv => {
    const rd = cases.map(c => c['reduce|' + lv]), ld = cases.map(c => c['leadsheet|' + lv]);
    const rm = rd.filter(Boolean), lm = ld.filter(Boolean), both = cases.filter(c => c['reduce|' + lv] && c['leadsheet|' + lv]);
    lines.push('| | ' + lv + ' | ' + rm.length + ' / ' + lm.length + ' | ' + fx(mean(rm.map(x => x.pos))) + ' | ' + fx(mean(lm.map(x => x.pos))) + ' | ' + both.length + ': ' +
      fx(mean(both.map(c => c['reduce|' + lv].pos))) + ' | ' + fx(mean(both.map(c => c['leadsheet|' + lv].pos))) + ' | ' + rm.filter(x => x.relaxed).length + ' / ' + lm.filter(x => x.relaxed).length + ' |');
  });
  return lines.join('\n');
}
function report(files) {
  const parts = files.map(f => JSON.parse(fs.readFileSync(f, 'utf8')));
  const cases = [].concat(...parts.filter(p => p.kind === 'benchmark').map(p => p.cases));
  if (cases.length) {
    console.log(table(cases, 'all'));
    ['hymns', 'method', 'micro', 'catalog + samples', 'real-AMT fixtures'].forEach(s => { console.log(''); console.log(table(cases.filter(c => setOf(c.id) === s), s)); });
    const span = mode => { const both = cases.filter(c => c[mode + '|beginner'] && c[mode + '|advanced']); return mean(both.map(c => c[mode + '|advanced'].pos - c[mode + '|beginner'].pos)); };
    console.log('\nadvanced minus beginner (cases made at both): reduce ' + fx(span('reduce')) + ', lead ' + fx(span('leadsheet')));
  }
  parts.filter(p => p.kind === 'covers').forEach(p => {
    console.log('\n| cover | heard | reduce: beginner / intermediate / advanced | lead sheet: beginner / intermediate / advanced |\n| --- | --- | --- | --- |');
    Object.keys(p.pieces).forEach(id => {
      const w = m => LEVELS.map(lv => { const x = p.pieces[id][m + '|' + lv]; return x ? fx(x.pos) : 'refused'; }).join(' / ');
      console.log('| ' + id + ' | ' + fx(p.pieces[id].src) + ' | ' + w('reduce') + ' | ' + w('leadsheet') + ' |');
    });
  });
  parts.filter(p => p.kind === 'hymns').forEach(p => {
    console.log('\nprinted hymns (' + p.hymns + ', printed score ' + fx(p.src) + '): ' + LEVELS.map(lv => lv + ' made ' + p.levels[lv].made + ', mean ' + fx(p.levels[lv].mean) + ' (' + fx(p.levels[lv].min) + '-' + fx(p.levels[lv].max) + ')').join('; '));
  });
}
if (has('--report')) { report(process.argv.slice(process.argv.indexOf('--report') + 1)); process.exit(0); }

/* ------------------------------------------------------------------ measuring */
const out = arg('--out');
if (!out || !(arg('--jobs') || arg('--heard') || has('--hymns'))) { process.stderr.write('usage: level-table.js (--jobs jobs.jsonl [--shard I/N] | --heard DIR | --hymns) --out result.json | --report a.json ...\n'); process.exit(2); }
const E = R('tests/realize/app-single-extract.js');
const DIFF = R('difficulty/index.js');
const W = JSON.parse(fs.readFileSync(path.join(REPO, 'difficulty/weights/g6a-v1.json'), 'utf8'));
const positionOf = g => { try { return r2(DIFF.assess(g, W).level.position); } catch (e) { return null; } };

async function copies(app, g, row) {
  for (const mode of MODES) for (const level of LEVELS) {
    let a;
    try { a = await app.arrangeSingleNote(g, { level: level, recordingArrange: mode }); } catch (e) { a = { ok: false }; }
    row[mode + '|' + level] = a.ok ? { pos: positionOf(a.graph), relaxed: !!a.levelNote } : null;
  }
}

(async () => {
  const ref = E.reference();
  const app = E.make({ window: E.nodeWindow(), Score: {}, loadArrangerReference: () => Promise.resolve(ref) });
  let result;
  if (arg('--jobs')) {
    const AS = R('audio-score.js');
    const [si, sn] = (arg('--shard') || '0/1').split('/').map(Number);
    const jobs = fs.readFileSync(arg('--jobs'), 'utf8').split('\n').filter(l => l.trim()).map(l => JSON.parse(l)).filter(j => /\|opt:v2$/.test(j.id));
    const cases = [];
    for (const [i, job] of jobs.entries()) {
      if (i % sn !== si) continue;
      const opts = Object.assign({}, job.opts || {});
      delete opts.recordingArrange;
      let g;
      try { g = AS.toMusicXml(job.input, opts).graph; } catch (e) { continue; }
      const row = { id: job.id.replace(/\|opt:v2$/, ''), src: positionOf(g) };
      await copies(app, g, row);
      cases.push(row);
      process.stderr.write('.');
    }
    result = { kind: 'benchmark', shard: si + '/' + sn, cases: cases };
  } else if (arg('--heard')) {
    const APP = R('review/lib/appcode.js');
    const dir = arg('--heard');
    const pieces = {};
    for (const f of fs.readdirSync(dir).filter(x => /^p\d+\.json$/.test(x)).sort()) {
      const heard = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      const id = f.replace(/\.json$/, '');
      const g = APP.convertHeard(heard, id, true).built.graph;
      const row = { src: positionOf(g) };
      await copies(app, g, row);
      pieces[id] = row;
      process.stderr.write(id + ' ');
    }
    result = { kind: 'covers', pieces: pieces };
  } else {
    const SG = R('scoregraph/index.js');
    const dir = path.join(REPO, 'catalog', 'hymns');
    const files = fs.readdirSync(dir).filter(f => /\.musicxml$/.test(f)).sort();
    const pos = { beginner: [], intermediate: [], advanced: [] }, src = [];
    for (const f of files) {
      const r = SG.musicxml.import(fs.readFileSync(path.join(dir, f), 'utf8'), { scoreId: 'h' });
      const g = r.graph || r;
      src.push(positionOf(g));
      for (const level of LEVELS) {
        let a;
        try { a = await app.arrangeSingleNote(g, { level: level }); } catch (e) { a = { ok: false }; }
        if (a.ok) pos[level].push(positionOf(a.graph));
      }
    }
    const levels = {};
    LEVELS.forEach(lv => { levels[lv] = { made: pos[lv].length, refused: files.length - pos[lv].length, mean: r2(mean(pos[lv])), min: Math.min.apply(null, pos[lv]), max: Math.max.apply(null, pos[lv]) }; });
    result = { kind: 'hymns', hymns: files.length, src: r2(mean(src)), levels: levels };
  }
  fs.writeFileSync(out, JSON.stringify(result, null, 1) + '\n');
  process.stderr.write('\nwrote ' + out + '\n');
})().catch(e => { process.stderr.write(String(e && e.stack || e) + '\n'); process.exit(1); });
