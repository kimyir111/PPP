/* G04 §21.3: classify how the committed layout hashes' scores change between two engrave/ trees, before a re-bless.

     node tests/engrave/tools/layout-diff.js --base=<dir> [--json=<file>]

   <dir> holds the other tree's engrave/ and scoregraph/ (for instance `git archive <rev> engrave scoregraph | tar -x -C
   <dir>`). Every score of tests/engrave/tools/layout-hashes.js (E fixtures, the R suite, PPP transcriptions) is laid out
   at both screen configs by both trees, and each pair is:
     SAME                identical canonical JSON
     SERIALIZATION_ONLY  the same objects (kind, id, glyph, refs) at the same coordinates; other fields differ - '(version)'
                         when only the EngravedScore's and the plan's version names differ (G4-D1a-1)
     GEOMETRY_ONLY       the same objects; some coordinate differs (L1 and L2 must not get worse - bench.js says)
     LEDGER_CHANGE       what is drawn differs: an object or a curve (a tie, slur or glissando, G4d-1a) added or gone, or
                         drawn with another glyph (review needed)
   with the kinds that changed. Writes nothing into the repository. */
'use strict';
const fs = require('fs');
const path = require('path');
const H = require('../helpers.js');
const HASHES = require('./layout-hashes.js');

const REPO = H.REPO;
const COORD = ['box', 'origin', 'anchor', 'line', 'gap'];
const CURVE = ['p0', 'c1', 'c2', 'p3'];

function load(root) {
  const dir = path.resolve(root);
  Object.keys(require.cache).forEach(k => { if (k.startsWith(dir)) delete require.cache[k]; });
  return require(path.join(dir, 'engrave', 'index.js'));
}
const keyOf = o => [o.kind, o.id, o.glyph || '', (o.refs || []).join(','), o.part || ''].join('|');
/* a system's own decorations (its staff lines, brace, opening line, head clef, key and time) are named by the system's
   first measure: a line break moved is a geometry change, not a change of what is drawn */
const frameObj = o => /^d:(staff|brace|sysbar|clef|keysig|timesig):/.test(o.id);

function classify(a, b, CN) {
  if (CN.canonical(a) === CN.canonical(b)) return { cls: 'SAME', kinds: [] };
  /* the curves (G4d-1a) are drawn things like the objects; a version name is not */
  const drawn = x => x.objects.filter(o => !frameObj(o)).concat(x.curves || []);
  const ka = new Map(drawn(a).map(o => [keyOf(o), o])), kb = new Map(drawn(b).map(o => [keyOf(o), o]));
  const kinds = new Set();
  let ledger = false;
  ka.forEach((o, k) => { if (!kb.has(k)) { ledger = true; kinds.add(o.kind); } });
  kb.forEach((o, k) => { if (!ka.has(k)) { ledger = true; kinds.add(o.kind); } });
  if (ledger) return { cls: 'LEDGER_CHANGE', kinds: [...kinds].sort() };
  let geo = false;
  ka.forEach((o, k) => {
    const p = kb.get(k);
    const moved = COORD.concat(CURVE).some(f => CN.canonical(o[f] === undefined ? null : o[f]) !== CN.canonical(p[f] === undefined ? null : p[f])) || o.system !== p.system;
    if (moved) { geo = true; kinds.add(o.kind); }
  });
  const fa = a.objects.filter(frameObj), fb = b.objects.filter(frameObj);
  const frame = ['pages', 'systems', 'measures'].some(f => CN.canonical(a[f]) !== CN.canonical(b[f])) || CN.canonical(fa) !== CN.canonical(fb);
  if (geo || frame) return { cls: 'GEOMETRY_ONLY', kinds: [...kinds].sort().concat(frame ? ['(frame)'] : []) };
  ka.forEach((o, k) => { if (CN.canonical(o) !== CN.canonical(kb.get(k))) kinds.add(o.kind); });
  const bare = x => Object.assign({}, x, { version: null, planKey: String(x.planKey).replace(/:plan\/\d+$/, '') });
  if (!kinds.size && CN.canonical(bare(a)) === CN.canonical(bare(b))) kinds.add('(version)');
  return { cls: 'SERIALIZATION_ONLY', kinds: [...kinds].sort() };
}

async function main() {
  const arg = n => { const a = process.argv.find(x => x.startsWith('--' + n + '=')); return a ? a.slice(n.length + 3) : null; };
  const base = arg('base');
  if (!base) { console.error('usage: layout-diff.js --base=<dir with engrave/ and scoregraph/>'); process.exit(2); }
  const B = load(base), N = load(REPO);
  const CN = require(path.join(REPO, 'engrave', 'canon.js'));
  const items = await HASHES.inputs();
  const out = { base: path.resolve(base), counts: {}, byKind: {}, scores: {} };
  items.forEach(([id, g]) => {
    out.scores[id] = {};
    Object.keys(HASHES.CONFIGS).forEach(c => {
      const a = B.layout.engrave(B.plan(g), HASHES.CONFIGS[c]), b = N.layout.engrave(N.plan(g), HASHES.CONFIGS[c]);
      const r = classify(a, b, CN);
      out.scores[id][c] = r;
      out.counts[r.cls] = (out.counts[r.cls] || 0) + 1;
      r.kinds.forEach(k => { const t = out.byKind[r.cls] = out.byKind[r.cls] || {}; t[k] = (t[k] || 0) + 1; });
    });
  });
  console.log(items.length + ' scores x ' + Object.keys(HASHES.CONFIGS).length + ' configs: ' + JSON.stringify(out.counts));
  Object.keys(out.byKind).forEach(c => console.log('  ' + c + ' by changed kind: ' + JSON.stringify(out.byKind[c])));
  const j = arg('json');
  if (j) fs.writeFileSync(j, JSON.stringify(out, null, 1) + '\n');
}
if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });
module.exports = { classify };
