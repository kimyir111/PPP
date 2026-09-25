/* The graphs audio-score.js makes for a benchmark suite, for G3's corpus-wide checks (docs/GOALS/G03 A3-A6, A9).

     const { jobs, graphs, slice } = require('./g3-graphs.js');
     jobs('core')                      the suite's toMusicXml inputs (tests/scoregraph/tools/g3_jobs.py writes them)
     graphs('core', {filter, opts})    [{id, graph, stats}] from audio-score.js toMusicXml, in suite order: the graph
                                       before G3 (professional 'off') unless opts says otherwise
     slice(graph, from, to)            measures from..to (0-based, inclusive) as a graph of their own

   The inputs are generated once into tests/bench/out/g3/ (gitignored; PPP_G3_JOBS_DIR names another directory, a
   relative one from the repository root) and reused. g3_jobs.py renames a finished file into place, so the test
   processes node --test runs side by side never see half of one; a file whose header counts other than the lines it
   holds is an error here, never a short list. */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO = path.resolve(__dirname, '..', '..', '..');
const OUT = path.join(REPO, 'tests', 'bench', 'out', 'g3');
const SG = require(path.join(REPO, 'scoregraph', 'index.js'));

function python() { return process.env.PPP_PYTHON || (process.platform === 'win32' ? 'python' : 'python3'); }

function outDir() { return process.env.PPP_G3_JOBS_DIR ? path.resolve(REPO, process.env.PPP_G3_JOBS_DIR) : OUT; }

function jobs(suite) {
  const file = path.join(outDir(), 'jobs-' + suite + '.jsonl');
  execFileSync(python(), [path.join(__dirname, 'g3_jobs.py'), '--suite', suite], { cwd: REPO, stdio: ['ignore', 'ignore', 'inherit'] });
  const text = fs.readFileSync(file, 'utf8');
  const lines = text.split('\n').filter(l => l.trim());
  let head = null;
  try { head = JSON.parse(lines[0]); } catch (e) { /* reported below */ }
  if (!head || head.suite !== suite || head.cases !== lines.length - 1 || !text.endsWith('\n')) {
    throw new Error('g3-graphs: ' + file + ' is incomplete: its header ' + (head ? 'counts ' + head.cases + ' ' + head.suite + ' cases' : 'is missing') +
      ', it holds ' + Math.max(0, lines.length - 1) + (text.endsWith('\n') ? '' : ' (the last one cut off)') + '. Delete it and run again.');
  }
  return lines.slice(1).map(l => JSON.parse(l));
}

function graphs(suite, o) {
  o = o || {};
  const A = require(path.join(REPO, 'audio-score.js'));
  const out = [];
  jobs(suite).forEach(j => {
    if (o.filter && !o.filter(j.id)) return;
    let r;
    /* the graph as audio-score builds it, before G3 (whatever toMusicXml's default), unless o.opts asks otherwise */
    try { r = A.toMusicXml(j.input, Object.assign({}, j.opts || {}, { professional: 'off' }, o.opts || {})); } catch (e) { out.push({ id: j.id, error: e.code || e.message }); return; }
    out.push({ id: j.id, graph: r.graph, stats: r.stats, pro: r.proReport, xml: o.xml ? r.xml : undefined });
  });
  return out;
}

/* Measures [from, to] of a graph as a graph of their own: the time signature, key and clefs in force at `from`
   restated there, only what lies inside, ties and slurs with an end outside dropped, and the performance notes
   linked to the heads kept (with the anchors of the kept measures). IDs are kept, so a fixture can name them. */
function slice(g, from, to) {
  const doc = JSON.parse(SG.serialize(g));
  const tl = doc.timeline;
  const keepM = new Set(tl.measures.slice(from, to + 1).map(m => m.id));
  const first = tl.measures[from].id;
  const inForce = (list, idxOf) => {
    let cur = null;
    list.forEach(x => { if (idxOf(x) <= from) cur = x; });
    return cur;
  };
  const mIdx = new Map(tl.measures.map((m, i) => [m.id, i]));
  const meter = inForce(tl.meters, x => mIdx.get(x.m));
  const key = inForce(tl.keys || [], x => mIdx.get(x.m));
  const tempo = inForce(tl.tempos || [], x => mIdx.get(x.m));
  tl.measures = tl.measures.filter(m => keepM.has(m.id));
  tl.meters = [Object.assign({}, meter, { m: first })].concat(tl.meters.filter(x => keepM.has(x.m) && x.m !== first));
  if (key) tl.keys = [Object.assign({}, key, { m: first, at: '0' })].concat((tl.keys || []).filter(x => keepM.has(x.m) && x.m !== first));
  if (tempo) tl.tempos = [Object.assign({}, tempo, { m: first, at: '0' })].concat((tl.tempos || []).filter(x => keepM.has(x.m) && x.m !== first));
  delete tl.endings; delete tl.jumps;
  doc.parts.forEach(p => {
    const clefs = [];
    p.staves.forEach(st => {
      const c = inForce(p.clefs.filter(x => x.staff === st.id), x => mIdx.get(x.m));
      if (c) clefs.push(Object.assign({}, c, { m: first, at: '0' }));
    });
    p.clefs = clefs.concat(p.clefs.filter(c => keepM.has(c.m) && !(c.m === first && c.at === '0')));
    p.events = p.events.filter(e => keepM.has(e.m));
    const ev = new Set(p.events.map(e => e.id)), hd = new Set();
    p.events.forEach(e => (e.heads || []).forEach(h => hd.add(h.id)));
    const inPos = x => x && keepM.has(x.m);
    p.spanners = p.spanners.filter(s => {
      if (s.type === 'tie') { if (!hd.has(s.from)) delete s.from; if (!hd.has(s.to)) delete s.to; return s.from !== undefined && s.to !== undefined; }
      if (s.type === 'slur') return ev.has(s.from) && ev.has(s.to);
      if (s.type === 'tuplet' || s.type === 'beam') return s.events.every(id => ev.has(id));
      if (s.type === 'arpeggio') return s.heads.every(h => hd.has(h));
      if (s.type === 'gliss') return hd.has(s.from) && hd.has(s.to);
      if (s.type === 'pedal') { if (!inPos(s.from)) return false; if (s.to && !inPos(s.to)) delete s.to; if (s.changes) { s.changes = s.changes.filter(inPos); if (!s.changes.length) delete s.changes; } return true; }
      return inPos(s.from) && inPos(s.to);
    });
    p.directions = p.directions.filter(d => keepM.has(d.m));
    p.directions.forEach(d => { if (d.event && !ev.has(d.event)) delete d.event; });
  });
  const hd = new Set();
  doc.parts.forEach(p => p.events.forEach(e => (e.heads || []).forEach(h => hd.add(h.id))));
  (doc.performances || []).forEach(pf => {
    pf.notes = pf.notes.filter(n => n.link && hd.has(n.link));
    delete pf.pedals; delete pf.controls;
    if (pf.anchors) { pf.anchors = pf.anchors.filter(a => keepM.has(a.m)); if (!pf.anchors.length) delete pf.anchors; }
  });
  if (doc.provenance.flags) doc.provenance.flags = [];
  doc.id = (doc.id || 'sg') + '-slice';
  return SG.seal(doc).graph;
}

module.exports = { jobs, graphs, slice, outDir, REPO, OUT };
