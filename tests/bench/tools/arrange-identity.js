#!/usr/bin/env node
/* Identity of the one-note arranger on the printed catalogue (a recording-only change must leave every catalogue piece byte for byte as it was).

     node tests/bench/tools/arrange-identity.js --root DIR --out result.json [--shard I/N] [--only substring]
     node tests/bench/tools/arrange-identity.js --root DIR --out result.json --recordings jobs.jsonl [--heard DIR]   # G10c-1a: the RECORDING graphs
     node tests/bench/tools/arrange-identity.js --compare a.json b.json         # exit 1 unless every request is identical

   --root is a checkout (or a `git archive` extract) of the tree to test: its own app file, modules and catalogue are used, so running it on a clean
   extract of origin/main and on this branch gives the two sides. Every MusicXML / MXL file of catalog/ (the 100 hymns, the 222 method pieces and the
   3 catalogue pieces: 325 files) goes through the app's own import and `arrangeSingleNote` (tests/realize/app-single-extract.js, the app's glue) at the
   three levels: 975 requests. A request is its result's sha-256 (the arranged graph, `levelNote`, `rescued`) or its refusal's reason.
   `--shard I/N` runs every N-th file starting at I (the shards' results merge by concatenating their `requests`).

   --recordings (G10c-1a, docs/GOALS/G10 section 33): instead of the catalogue, the recording graphs of the arranger jobs of a rec-arrange suite (`jobs.jsonl`: {id, input, opts};
   tests/bench/node/rec-arrange.js's own input, written by `python tests/bench/tools/arrange_jobs.py --suite rec-arrange-core --opts app,v2 --out jobs.jsonl`: 168 jobs) are made by the ROOT's audio-score.js (a `recordingArrange` key in a job's opts is dropped) and
   arranged with the app's glue at the three levels with NO recordingArrange option: the reduction every recording gets today. `--heard DIR` adds the private covers of `DIR/<id>.json`
   ({notes: [{on, off, midi, vel}]}) through the app's own conversion options (review/lib/appcode.js of this tree, v2): their requests are named rec:heard/<id>; only the sha-256 of
   each result is written, never a note. The same file run on a clean extract of main and on the branch is the identity of 'reduce' on recordings (168 jobs x 3 levels + the six covers x 3 = 522 requests):
     git archive 94350c5 | tar -x -C /tmp/main       # the base of G10c-1a (any clean extract of the tree to compare with)
     python tests/bench/tools/arrange_jobs.py --suite rec-arrange-core --opts app,v2 --out jobs.jsonl
     node tests/bench/tools/arrange-identity.js --root /tmp/main --recordings jobs.jsonl --heard DIR --out main.json
     node tests/bench/tools/arrange-identity.js --root .         --recordings jobs.jsonl --heard DIR --out branch.json
     node tests/bench/tools/arrange-identity.js --compare main.json branch.json      # exit 1 unless every request is identical
   (the tool of THIS tree is run in both: --root names the tree whose audio-score.js, app file and modules are used; --shard I/N splits a long run). */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function arg(name) { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : null; }

if (process.argv.indexOf('--merge') >= 0) {            // --merge out.json shard0.json shard1.json ...
  const i = process.argv.indexOf('--merge');
  const merged = { root: null, shard: 'merged', requests: {} };
  process.argv.slice(i + 2).forEach(f => { const r = JSON.parse(fs.readFileSync(f, 'utf8')); merged.root = r.root; Object.assign(merged.requests, r.requests); });
  fs.writeFileSync(process.argv[i + 1], JSON.stringify(merged, null, 1) + '\n');
  console.log('merged ' + Object.keys(merged.requests).length + ' requests');
  process.exit(0);
}
if (process.argv.indexOf('--compare') >= 0) {
  const i = process.argv.indexOf('--compare');
  const a = JSON.parse(fs.readFileSync(process.argv[i + 1], 'utf8')), b = JSON.parse(fs.readFileSync(process.argv[i + 2], 'utf8'));
  const keys = Object.keys(a.requests).sort();
  const same = keys.filter(k => a.requests[k] === b.requests[k]).length;
  const refused = keys.filter(k => a.requests[k].indexOf('REFUSED:') === 0 && a.requests[k] === b.requests[k]).length;
  const diff = keys.filter(k => a.requests[k] !== b.requests[k]);
  const onlyB = Object.keys(b.requests).filter(k => !(k in a.requests));
  console.log('requests ' + keys.length + ': identical ' + same + ' (' + (same - refused) + ' results, ' + refused + ' refusals), different ' + diff.length + ', only in b ' + onlyB.length);
  diff.slice(0, 20).forEach(k => console.log('  DIFFERENT ' + k + '\n    a ' + a.requests[k] + '\n    b ' + b.requests[k]));
  process.exit(diff.length || onlyB.length ? 1 : 0);
}

const root = path.resolve(arg('--root') || path.join(__dirname, '..', '..', '..'));
const out = arg('--out');
const [shardI, shardN] = (arg('--shard') || '0/1').split('/').map(Number);
const only = arg('--only') || '';
if (!out) { process.stderr.write('usage: arrange-identity.js --root DIR --out result.json [--shard I/N]\n'); process.exit(2); }

const recordings = arg('--recordings'), heardDir = arg('--heard');
const E = require(path.join(root, 'tests/realize/app-single-extract.js'));
const SG = require(path.join(root, 'scoregraph/index.js'));
const SER = require(path.join(root, 'scoregraph/serialize.js'));
const ref = E.reference();
const app = E.make({ window: E.nodeWindow(), Score: {}, loadArrangerReference: () => Promise.resolve(ref) });

function files() {
  const out = [];
  (function walk(dir) {
    fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1)).forEach(d => {
      const p = path.join(dir, d.name);
      if (d.isDirectory()) walk(p);
      else if (/\.(musicxml|mxl)$/i.test(d.name)) out.push(p);
    });
  })(path.join(root, 'catalog'));
  return out;
}

const hashOf = a => (a.ok ? crypto.createHash('sha256').update(SER.serialize(a.graph) + '|' + (a.levelNote || '') + '|' + JSON.stringify(a.rescued || null)).digest('hex') : 'REFUSED:' + a.reason);

async function recordingRequests() {
  const requests = {};
  const AS = require(path.join(root, 'audio-score.js'));
  const arrangeAll = async (id, graph) => {
    for (const level of ['beginner', 'intermediate', 'advanced']) {
      let a;
      try { a = await app.arrangeSingleNote(graph, { level }); } catch (e) { a = { ok: false, reason: 'THROW:' + String(e && e.message || e).slice(0, 80) }; }
      requests[id + '|' + level] = hashOf(a);
    }
  };
  if (recordings) {
    const jobs = fs.readFileSync(recordings, 'utf8').split(String.fromCharCode(10)).filter(l => l.trim()).map(l => JSON.parse(l));
    for (const job of jobs.filter((j, i) => i % shardN === shardI && (!only || j.id.indexOf(only) >= 0))) {
      const opts = Object.assign({}, job.opts || {});
      delete opts.recordingArrange;
      let g = null;
      try { g = AS.toMusicXml(job.input, opts).graph; } catch (e) { requests['rec:' + job.id + '|convert'] = 'THROW:' + String(e && e.message || e).slice(0, 80); continue; }
      await arrangeAll('rec:' + job.id, g);
    }
  }
  if (heardDir) {
    const APP = require(path.join(root, 'review', 'lib', 'appcode.js'));
    for (const f of fs.readdirSync(heardDir).filter(x => /^p\d+\.json$/.test(x)).sort()) {
      const heard = JSON.parse(fs.readFileSync(path.join(heardDir, f), 'utf8'));
      const id = f.replace(/\.json$/, '');
      const opts = Object.assign({}, APP.appOptions().v2, { title: id });
      const g = AS.toMusicXml({ notes: heard.notes, pedals: heard.pedals, beats: heard.beats, downbeats: heard.downbeats, grid: heard.grid, title: id }, opts).graph;
      await arrangeAll('rec:heard/' + id, g);
    }
  }
  return requests;
}

(async () => {
  if (recordings || heardDir) {
    const requests = await recordingRequests();
    fs.writeFileSync(out, JSON.stringify({ root: root, shard: shardI + '/' + shardN, requests: requests }, null, 1) + '\n');
    console.log('shard ' + shardI + '/' + shardN + ': ' + Object.keys(requests).length + ' recording requests');
    return;
  }
  const requests = {};
  const list = files().filter(f => !only || f.indexOf(only) >= 0).filter((f, i) => i % shardN === shardI);
  for (const f of list) {
    const rel = path.relative(root, f).split(path.sep).join('/');
    let graph = null, why = null;
    try {
      const r = await SG.importFile(new Uint8Array(fs.readFileSync(f)), { name: path.basename(f), scoreId: 'ident' });
      if (!r.ok) why = 'IMPORT:' + r.code; else graph = r.graph;
    } catch (e) { why = 'IMPORT_THROW:' + String(e && e.message || e).slice(0, 80); }
    for (const level of ['beginner', 'intermediate', 'advanced']) {
      let v;
      if (!graph) v = 'REFUSED:' + why;
      else {
        let a;
        try { a = await app.arrangeSingleNote(graph, { level }); } catch (e) { a = { ok: false, reason: 'THROW:' + String(e && e.message || e).slice(0, 80) }; }
        v = a.ok ? crypto.createHash('sha256').update(SER.serialize(a.graph) + '|' + (a.levelNote || '') + '|' + JSON.stringify(a.rescued || null)).digest('hex') : 'REFUSED:' + a.reason;
      }
      requests[rel + '|' + level] = v;
    }
  }
  fs.writeFileSync(out, JSON.stringify({ root: root, shard: shardI + '/' + shardN, requests: requests }, null, 1) + '\n');
  console.log('shard ' + shardI + '/' + shardN + ': ' + Object.keys(requests).length + ' requests');
})().catch(e => { process.stderr.write(String(e && e.stack || e) + '\n'); process.exit(1); });
