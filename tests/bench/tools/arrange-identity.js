#!/usr/bin/env node
/* Identity of the one-note arranger on the printed catalogue (a recording-only change must leave every catalogue piece byte for byte as it was).

     node tests/bench/tools/arrange-identity.js --root DIR --out result.json [--shard I/N] [--only substring]
     node tests/bench/tools/arrange-identity.js --compare a.json b.json         # exit 1 unless every request is identical

   --root is a checkout (or a `git archive` extract) of the tree to test: its own app file, modules and catalogue are used, so running it on a clean
   extract of origin/main and on this branch gives the two sides. Every MusicXML / MXL file of catalog/ (the 100 hymns, the 222 method pieces and the
   3 catalogue pieces: 325 files) goes through the app's own import and `arrangeSingleNote` (tests/realize/app-single-extract.js, the app's glue) at the
   three levels: 975 requests. A request is its result's sha-256 (the arranged graph, `levelNote`, `rescued`) or its refusal's reason.
   `--shard I/N` runs every N-th file starting at I (the shards' results merge by concatenating their `requests`). */
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

(async () => {
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
