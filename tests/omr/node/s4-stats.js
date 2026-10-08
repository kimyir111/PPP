#!/usr/bin/env node
/* G12-2 (docs/GOALS/G12_OMR.md section 22, gate A2): what the ScoreGraph importer makes of what the engine wrote, with no browser and no engine.

     node tests/omr/node/s4-stats.js [--engine tests/omr/out/engine] [--tier clean-A] [--json] [--check]

   For every (case, tier) of an engine-alone run (tests/omr/out/engine/<case>/<tier>-pN/*.mxl, written by `run.py omr-live-2 run`): the pages through omr/normalize.js (as the
   page does under PPP.omr = 'v2'), the document through scoregraph/import.js, and then
     refused   the importer refused the document (by code); before G12-2 this was 15 of 415 documents (3 notes of length 0, 12 documents with a hairpin that ends where it starts)
     repairs   what the normaliser repaired or removed to avoid that (zero-length rests, hairpins); it changes no sounding note (tests/omr/normalize: the multiset invariant)
     beams     the notes the engine beamed (a primary <beam> begin / continue / end in the normalised document), the notes in a graph beam, the notes the engraver's plan draws
               from the graph's beams (engrave/plan.js, not deferred: a beam across two staves is deferred by the engraver, counted apart)
   --check exits 1 when any document is refused or fewer than 95 % of the beamed notes are drawn (the A2 floor).
   Nothing is written. Needs the engine's output folder (git-ignored, made by the benchmark); without it it says so and exits 0. */
'use strict';
const fs = require('fs');
const path = require('path');
const REPO = path.resolve(__dirname, '..', '..', '..');
const { normalize } = require(path.join(REPO, 'omr', 'normalize.js'));
const SG = require(path.join(REPO, 'scoregraph', 'index.js'));
const XML = require(path.join(REPO, 'scoregraph', 'xml.js'));
const P = require(path.join(REPO, 'engrave', 'plan.js'));
const H = require(path.join(REPO, 'omr', 'helper-output.js'));
const { readMxl } = require('./normalize-cli.js');

const arg = (name, dflt) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : dflt; };
const flag = name => process.argv.indexOf(name) >= 0;

async function main() {
  const eng = path.resolve(arg('--engine', path.join(REPO, 'tests', 'omr', 'out', 'engine')));
  const only = arg('--tier', null);
  if (!fs.existsSync(eng)) { console.log('SKIPPED: no engine output at ' + eng + ' (run `python tests/bench/run.py omr-live-2 run` first)'); return 0; }
  const out = { units: 0, normalized: 0, imported: 0, refused: 0, refusedBy: {}, refusedUnits: [], repairs: { zeroDurationsRepaired: 0, zeroDurationsLeft: 0, wedgesDropped: 0, wedgesDegenerate: 0, unitsWithRepairs: 0 },
    beams: { xml: 0, graph: 0, drawn: 0, deferred: 0, planFailed: 0 }, perTier: {} };
  for (const c of fs.readdirSync(eng).sort().filter(d => fs.statSync(path.join(eng, d)).isDirectory())) {
    const tiers = {};
    for (const d of fs.readdirSync(path.join(eng, c))) { const m = /^(.*)-p(\d+)$/.exec(d); if (m) (tiers[m[1]] = tiers[m[1]] || []).push({ p: +m[2], dir: path.join(eng, c, d) }); }
    for (const t of Object.keys(tiers).sort()) {
      if (only && t !== only) continue;
      tiers[t].sort((a, b) => a.p - b.p);
      const pages = tiers[t].map(x => H.movementFiles(fs.readdirSync(x.dir)).map(f => { try { return readMxl(path.join(x.dir, f)); } catch (e) { return null; } }).filter(Boolean));
      out.units++;
      const n = normalize(pages);
      if (!n.ok) continue;
      out.normalized++;
      const pt = out.perTier[t] = out.perTier[t] || { units: 0, refused: 0, beamedXml: 0, drawn: 0 };
      pt.units++;
      const cnt = n.report.counts;
      const rep = cnt.zeroDurationsRepaired + cnt.zeroDurationsLeft + cnt.wedgesDropped;
      ['zeroDurationsRepaired', 'zeroDurationsLeft', 'wedgesDropped', 'wedgesDegenerate'].forEach(k => { out.repairs[k] += cnt[k]; });
      if (rep) out.repairs.unitsWithRepairs++;
      const r = await SG.importFile(Buffer.from(n.xml, 'utf8'), { name: 'page.musicxml', format: 'musicxml' });
      if (!r.ok) {
        out.refused++; pt.refused++;
        const why = (/E-[A-Z-]+/.exec(r.message) || [r.code])[0];
        out.refusedBy[why] = (out.refusedBy[why] || 0) + 1;
        out.refusedUnits.push(c + '|' + t + ' ' + why);
        continue;
      }
      out.imported++;
      let beamed = 0;
      const walk = e => { if (e.name === 'note' && !e.kids.some(k => k.name === 'grace')) { const b = e.kids.find(k => k.name === 'beam' && (k.attrs.number || '1') === '1'); if (b && /^(begin|continue|end)$/.test(b.text.trim())) beamed++; } e.kids.forEach(walk); };
      walk(XML.parse(n.xml).root);
      const g = r.graph;
      const byId = new Map();
      g.parts.forEach(p => p.events.forEach(e => byId.set(e.id, e)));
      const heads = id => { const e = byId.get(id); return e && !e.grace ? (e.heads || []).length || 1 : 0; };
      let inGraph = 0;
      g.parts.forEach(p => p.spanners.forEach(s => { if (s.type === 'beam') s.events.forEach(id => { inGraph += heads(id); }); }));
      let drawn = 0, deferred = 0;
      try {
        (P.plan(g).beams || []).forEach(b => { const hs = b.events.reduce((s, id) => s + heads(id), 0); if (b.deferred) deferred += hs; else if (b.source === 'graph') drawn += hs; });
      } catch (e) { out.beams.planFailed++; }
      out.beams.xml += beamed; out.beams.graph += inGraph; out.beams.drawn += drawn; out.beams.deferred += deferred;
      pt.beamedXml += beamed; pt.drawn += drawn;
    }
  }
  const pct = (a, b) => (b ? Math.round(10000 * a / b) / 100 : null);
  out.beams.graphPct = pct(out.beams.graph, out.beams.xml);
  out.beams.drawnPct = pct(out.beams.drawn, out.beams.xml);
  if (flag('--json')) console.log(JSON.stringify(out, null, 1));
  else {
    console.log('documents (case x tier): ' + out.units + ', normalised ' + out.normalized + ', imported by the ScoreGraph importer ' + out.imported + ', refused ' + out.refused + (out.refused ? ' ' + JSON.stringify(out.refusedBy) : ''));
    console.log('normaliser repairs: ' + JSON.stringify(out.repairs));
    console.log('beams: ' + out.beams.xml + ' notes beamed by the engine, ' + out.beams.graph + ' in a graph beam (' + out.beams.graphPct + ' %), ' + out.beams.drawn + ' drawn from the graph (' + out.beams.drawnPct + ' %), ' + out.beams.deferred + ' in beams the engraver defers (across two staves)');
    Object.keys(out.perTier).forEach(t => console.log('  ' + t.padEnd(10) + ' ' + String(out.perTier[t].units).padStart(3) + ' documents, refused ' + out.perTier[t].refused + ', beamed ' + out.perTier[t].beamedXml + ', drawn ' + out.perTier[t].drawn));
    if (out.refused) console.log('refused: ' + out.refusedUnits.slice(0, 20).join('; '));
  }
  return flag('--check') && (out.refused > 0 || (out.beams.xml && out.beams.drawn / out.beams.xml < 0.95)) ? 1 : 0;
}
main().then(code => process.exit(code), e => { console.error(e); process.exit(2); });
