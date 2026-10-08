#!/usr/bin/env node
/* G12-2 (docs/GOALS/G12_OMR.md section 22, gate A2): what the ScoreGraph importer makes of what the engine wrote, with no browser and no engine.

     node tests/omr/node/s4-stats.js [--engine tests/omr/out/engine] [--tier clean-A] [--normalizer file.js] [--json] [--check]

   For every (case, tier) of an engine-alone run (tests/omr/out/engine/<case>/<tier>-pN/*.mxl, written by `run.py omr-live-2 run`): the pages through omr/normalize.js (as the
   page does under PPP.omr = 'v2'), the document through scoregraph/import.js, and then
     refused   the importer refused the document (by code); before G12-2 this was 15 of 415 documents (3 notes of length 0, 12 documents with a hairpin that ends where it starts)
     repairs   what the normaliser repaired or removed to avoid that (zero-length rests, hairpins); it changes no sounding note (tests/omr/normalize: the multiset invariant)
     beams     the notes the engine beamed (a primary <beam> begin / continue / end in the normalised document), the notes in a graph beam, the notes the engraver's plan draws
               from the graph's beams (engrave/plan.js, not deferred: a beam across two staves is deferred by the engraver, counted apart)
     lengths   the bars of the graph against the time signature: a measure of the graph is as long as the meter in force at it (an implicit bar, a pick-up, is not asked; the
               last bar of a document is counted apart). A repaired whole-bar rest that doubled its bar is a disagreement; every later bar then plays one bar late
   --normalizer F  reads the documents through another copy of omr/normalize.js (a `git show` of an earlier commit), to compare
   --check exits 1 when any document is refused, a bar of the graph (not a last one) is not as long as its meter, or fewer than 95 % of the beamed notes are drawn (the A2 floor).
   Nothing is written. Needs the engine's output folder (git-ignored, made by the benchmark); without it it says so and exits 0. */
'use strict';
const fs = require('fs');
const path = require('path');
const REPO = path.resolve(__dirname, '..', '..', '..');
const arg0 = (name, dflt) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : dflt; };
const { normalize } = require(path.resolve(arg0('--normalizer', path.join(REPO, 'omr', 'normalize.js'))));
const RAT = SG0();
function SG0() { return require(path.join(REPO, 'scoregraph', 'rational.js')); }
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
  const out = { units: 0, normalized: 0, imported: 0, refused: 0, refusedBy: {}, refusedUnits: [], repairs: { unitsWithRepairs: 0 },
    beams: { xml: 0, graph: 0, drawn: 0, deferred: 0, planFailed: 0 }, lengths: { bars: 0, agree: 0, disagree: 0, last: 0, lastDisagree: 0, docsWithDisagreement: 0, docs: [], repairedBars: 0, repairedBarsDisagree: 0, repairedDocs: [] }, perTier: {} };
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
      ['zeroDurationsRepaired', 'zeroDurationsLeft', 'zeroRestsRepaired', 'zeroNotesRepaired', 'zeroRestsLeft', 'zeroNotesLeft', 'zeroRestBackups', 'zeroRestsRefused', 'wedgesDropped', 'wedgesDegenerate'].forEach(k => { out.repairs[k] = (out.repairs[k] || 0) + (cnt[k] || 0); });
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
      {
        /* the bars of the graph against the meter in force at each (implicit bars are not asked; the last bar is counted apart) */
        const g0 = r.graph, ms = g0.timeline.measures, metersBy = new Map(g0.timeline.meters.map(x => [x.m, x]));
        let mt = null, bad = 0;
        ms.forEach((m, i) => {
          if (metersBy.has(m.id)) mt = metersBy.get(m.id);
          if (m.implicit || !mt) return;
          const want = RAT.make(mt.beats.reduce((s, x) => s + x, 0), mt.beatType);
          const ok = RAT.eq(RAT.parse(m.dur), want);
          if (i === ms.length - 1) { out.lengths.last++; if (!ok) out.lengths.lastDisagree++; return; }
          out.lengths.bars++;
          if (ok) out.lengths.agree++; else { out.lengths.disagree++; bad++; }
          /* a bar the normaliser repaired (a rest given the bar, a wedge taken out) must come out as long as its meter */
          const fl = (n.report.flags && n.report.flags[i + 1]) || [];
          if (fl.indexOf('duration-repaired') >= 0 || fl.indexOf('wedge-dropped') >= 0) { out.lengths.repairedBars++; if (!ok) out.lengths.repairedBarsDisagree++; }
        });
        if ((n.report.counts.zeroRestsRepaired || n.report.counts.zeroDurationsRepaired) && out.lengths.repairedDocs.length < 20) out.lengths.repairedDocs.push(c + '|' + t + ': ' + ms.map(m => m.dur).slice(0, 8).join(','));
        if (bad) { out.lengths.docsWithDisagreement++; if (out.lengths.docs.length < 30) out.lengths.docs.push(c + '|' + t + ' ' + bad); }
      }
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
    if (out.lengths.repairedDocs.length) console.log('documents with a repaired rest, graph bar lengths (whole notes): ' + out.lengths.repairedDocs.join('; '));
    console.log('normaliser repairs: ' + JSON.stringify(out.repairs));
    console.log('bar lengths (graph measure = meter in force, last bar apart): ' + out.lengths.agree + ' of ' + out.lengths.bars + ' agree, ' + out.lengths.disagree + ' do not (in ' + out.lengths.docsWithDisagreement + ' documents); last bars ' + (out.lengths.last - out.lengths.lastDisagree) + ' of ' + out.lengths.last + '; of the ' + out.lengths.repairedBars + ' bars the normaliser repaired ' + (out.lengths.repairedBars - out.lengths.repairedBarsDisagree) + ' agree' + (out.lengths.docs.length ? ' [' + out.lengths.docs.join('; ') + ']' : ''));
    console.log('beams: ' + out.beams.xml + ' notes beamed by the engine, ' + out.beams.graph + ' in a graph beam (' + out.beams.graphPct + ' %), ' + out.beams.drawn + ' drawn from the graph (' + out.beams.drawnPct + ' %), ' + out.beams.deferred + ' in beams the engraver defers (across two staves)');
    Object.keys(out.perTier).forEach(t => console.log('  ' + t.padEnd(10) + ' ' + String(out.perTier[t].units).padStart(3) + ' documents, refused ' + out.perTier[t].refused + ', beamed ' + out.perTier[t].beamedXml + ', drawn ' + out.perTier[t].drawn));
    if (out.refused) console.log('refused: ' + out.refusedUnits.slice(0, 20).join('; '));
  }
  return flag('--check') && (out.refused > 0 || out.lengths.repairedBarsDisagree > 0 || (out.beams.xml && out.beams.drawn / out.beams.xml < 0.95)) ? 1 : 0;
}
main().then(code => process.exit(code), e => { console.error(e); process.exit(2); });
