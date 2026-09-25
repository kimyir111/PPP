/* G04 §20, §21.3, A27: the EngravedScore hash of every E fixture, R suite score and PPP transcription, at the desktop
   and phone screen configs - committed, so the same graphs lay out to the same geometry on every machine (Windows
   here, Linux in CI).

     node tests/engrave/tools/layout-hashes.js           compare with tests/engrave/baselines/layout-hashes.json (exit 1 on a difference)
     node tests/engrave/tools/layout-hashes.js --write   write that file (after an intended layout change, with the reason in the commit)

   A difference names the score and config; tests/engrave/tools/layout-view.js draws both sides for a look. */
'use strict';
const fs = require('fs');
const path = require('path');
const H = require('../helpers.js');
const { REPO, E } = H;

const FILE = path.join(REPO, 'tests', 'engrave', 'baselines', 'layout-hashes.json');
const CONFIGS = { desktop: { breakpoint: 'desktop' }, phone: { breakpoint: 'phone' } };

async function inputs() {
  const out = [];
  const d = path.join(REPO, 'tests', 'engrave', 'fixtures', 'e');
  for (const f of fs.readdirSync(d).filter(x => x.endsWith('.musicxml')).sort()) out.push(['e/' + f, await H.graphOf('tests/engrave/fixtures/e/' + f)]);
  const corpus = JSON.parse(fs.readFileSync(path.join(REPO, 'tests', 'engrave', 'corpus.json'), 'utf8'));
  for (const rel of corpus.files) out.push([rel, await H.graphOf(rel)]);
  H.goldenGraphs().forEach(([k, g]) => out.push([k, g]));
  return out;
}

async function compute(order) {
  const list = await inputs();
  if (order === 'reverse') list.reverse();
  const out = {};
  list.forEach(([id, g]) => {
    const eng = E.layout.createEngraver(E.plan(g));
    out[id] = {};
    Object.keys(CONFIGS).forEach(c => { out[id][c] = E.layoutHash(eng.layout(CONFIGS[c])); });
  });
  const sorted = {};
  Object.keys(out).sort().forEach(k => { sorted[k] = out[k]; });
  return sorted;
}

function diff(got, want) {
  const bad = [];
  Object.keys(want).forEach(k => {
    if (!got[k]) { bad.push(k + ': missing'); return; }
    Object.keys(want[k]).forEach(c => { if (got[k][c] !== want[k][c]) bad.push(k + ' ' + c + ': ' + got[k][c] + ' != ' + want[k][c]); });
  });
  Object.keys(got).filter(k => !want[k]).forEach(k => bad.push(k + ': not in the baseline'));
  return bad;
}

async function main() {
  const got = await compute();
  if (process.argv.indexOf('--write') > 0) {
    fs.writeFileSync(FILE, JSON.stringify({ version: E.layout.VERSION, configs: CONFIGS, hashes: got }, null, 1) + '\n');
    console.log('wrote ' + Object.keys(got).length + ' scores x ' + Object.keys(CONFIGS).length + ' configs to ' + path.relative(REPO, FILE));
    return;
  }
  const want = JSON.parse(fs.readFileSync(FILE, 'utf8')).hashes;
  const bad = diff(got, want);
  console.log(Object.keys(got).length + ' scores x ' + Object.keys(CONFIGS).length + ' configs: ' + (bad.length ? bad.length + ' DIFFER' : 'all the committed hashes'));
  bad.slice(0, 20).forEach(b => console.log('  ' + b));
  process.exit(bad.length ? 1 : 0);
}

if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });
module.exports = { FILE, CONFIGS, inputs, compute, diff };
