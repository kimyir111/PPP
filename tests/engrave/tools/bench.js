/* G04 §21.1 L1 at the plan level (G4a): does the NotationPlan carry everything each graph states?

     node tests/engrave/tools/bench.js run --suite r|e|x        per-graph rows + summary -> tests/engrave/out/<suite>.l1.json
     node tests/engrave/tools/bench.js check --suite r|e|x      the summary against tests/engrave/baselines/<suite>.l1.json: exit 1 on
                                                                a regression, or on any zero-target metric that is not 0
     node tests/engrave/tools/bench.js baseline --suite r|e|x   write that baseline from a fresh run

   Suites (G04 §22): r = the reference corpus (tests/engrave/corpus.json), e = the E fixtures, x = what PPP makes itself:
   its transcriptions with G3 off (the golden graphs), the same through G3a (in this tool only - production keeps G3 off),
   the MIDI fixtures that open, and graphs rebuilt from the Scores the app holds (legacy.fromScore, RenderSource 'projected').
   Node only, deterministic, no network: this is the CI gate. The metrics G4b-G4f add (geometry) join the same rows.

   Each metric is computed here, from the graph and the plan output, independently of ledger.js - the audit is one more
   metric (eg.ledger.*), not the only one. Hold-out references never enter any suite (corpus.json rule). */
'use strict';
const fs = require('fs');
const path = require('path');
const H = require('../helpers.js');
const { SG, E, REPO } = H;
const L = SG.legacy;

const OUT = path.join(REPO, 'tests', 'engrave', 'out');
const BASE = path.join(REPO, 'tests', 'engrave', 'baselines');
const ZERO = ['eg.ledger.silent', 'eg.ledger.invented', 'eg.ledger.duplicate', 'eg.ledger.missing', 'eg.ledger.altered', 'eg.ledger.orphan',
  'eg.ledger.unapproved', 'eg.ledger.uncoded', 'eg.ledger.unsupported', 'eg.beam.derived_in_beamed_part', 'eg.beam.orphan', 'eg.tuplet.suppressed_drawn',
  'eg.graph.changed', 'eg.plan.nondeterministic', 'eg.error'];
const ONE = ['eg.beam.graph_drawn_ratio', 'eg.beam.members_exact', 'eg.tuplet.drawn_ratio', 'eg.tuplet.show_ok', 'eg.tie.drawn_ratio',
  'eg.slur.pair_exact', 'eg.event.multiset_equal', 'eg.staff.assignment_exact', 'eg.source.agree_live', 'eg.source.agree_projected'];
/* a graph a legacy Score cannot rebuild, and the one code fromScore names it with (G04 §32.10): percussion has no pitch on a Score */
const PROJECTION_ALLOWED = { 'e/E27-percussion.musicxml': 'percussion-or-unpitched' };
const MARKS = ['articulation', 'ornament', 'fermata', 'fingering', 'dynamic', 'wedge', 'pedal', 'pedal-change', 'ottava', 'words', 'tempo',
  'jump', 'chord', 'lyric', 'gliss', 'arpeggio', 'grace'];

async function inputs(suite) {
  if (suite === 'r') {
    const m = JSON.parse(fs.readFileSync(path.join(REPO, 'tests', 'engrave', 'corpus.json'), 'utf8'));
    const out = [];
    for (const rel of m.files) out.push({ id: rel, graph: await H.graphOf(rel) });
    return out;
  }
  if (suite === 'e') {
    const d = path.join(REPO, 'tests', 'engrave', 'fixtures', 'e');
    const out = [];
    for (const f of fs.readdirSync(d).filter(x => x.endsWith('.musicxml')).sort()) out.push({ id: 'e/' + f, graph: await H.graphOf('tests/engrave/fixtures/e/' + f) });
    return out;
  }
  if (suite === 'x') {
    const out = H.goldenGraphs().map(([k, g]) => ({ id: k, graph: g })).concat(H.g3aGraphs().map(([k, g]) => ({ id: k, graph: g })));
    const md = path.join(REPO, 'tests', 'scoregraph', 'fixtures', 'midi');
    for (const f of fs.readdirSync(md).filter(x => x.endsWith('.mid')).sort()) {
      const g = await H.graphOf('tests/scoregraph/fixtures/midi/' + f);
      if (g) out.push({ id: 'midi/' + f, graph: g });
    }
    H.storedScores().forEach(([f, x]) => {
      const fr = L.fromScore(x.score);
      if (fr.ok) out.push({ id: 'projected/' + f, graph: fr.graph, score: x.score, projection: { unsupported: fr.unsupported } });
    });
    return out;
  }
  throw new Error('unknown suite ' + suite + ' (r, e, x)');
}

function measure(item) {
  const g = item.graph;
  const row = { id: item.id, m: {} };
  const set = (k, v) => { row.m[k] = v; };
  try {
    const fp = SG.fingerprint(g);
    const cfg = item.projection ? { projection: item.projection } : {};
    const t0 = process.hrtime.bigint();
    const p = E.plan(g, cfg);
    row.ms = Number(process.hrtime.bigint() - t0) / 1e6;
    set('eg.plan.nondeterministic', JSON.stringify(E.plan(g, cfg)) === JSON.stringify(p) ? 0 : 1);
    set('eg.graph.changed', SG.fingerprint(g) === fp ? 0 : 1);
    const a = E.audit(g, p);
    ['silent', 'invented', 'duplicate', 'missing', 'altered', 'orphan', 'unapproved', 'uncoded', 'unsupported'].forEach(k => set('eg.ledger.' + k, a[k].length));
    Object.keys(a.codes).filter(c => c.split(':')[1] === 'deferred').forEach(c => set('eg.ledger.deferred.' + c.split(':')[2], a.codes[c]));
    const byId = new Map(g.parts.flatMap(pt => pt.events.map(e => [e.id, Object.assign({ part: pt.id }, e)])));
    /* beams */
    const gb = g.parts.flatMap(pt => pt.spanners.filter(s => s.type === 'beam'));
    const pb = new Map(p.beams.filter(b => b.source === 'graph').map(b => [b.id, b]));
    const beamParts = new Set(g.parts.filter(pt => pt.spanners.some(s => s.type === 'beam')).map(pt => pt.id));
    set('eg.beam.graph_drawn_ratio', gb.length ? gb.filter(s => pb.has(s.id)).length / gb.length : 1);
    set('eg.beam.members_exact', gb.length ? gb.filter(s => pb.has(s.id) && pb.get(s.id).events.join(' ') === s.events.join(' ')).length / gb.length : 1);
    set('eg.beam.derived_in_beamed_part', p.beams.filter(b => b.source === 'derived' && beamParts.has(byId.get(b.events[0]).part)).length);
    set('eg.beam.orphan', p.beams.filter(b => b.source === 'graph' && !gb.some(s => s.id === b.id)).length);
    set('eg.beam.derived', p.beams.filter(b => b.source === 'derived').length);
    /* tuplets: printed ones shown (drawn, or shown in a display group), shown as §12.1 says; none of printed:false */
    const gt = g.parts.flatMap(pt => pt.spanners.filter(s => s.type === 'tuplet'));
    const inOut = new Map(p.tuplets.filter(t => t.source === 'graph').map(t => [t.id, t]));
    const inGroup = new Set(p.tuplets.filter(t => t.source === 'merged').flatMap(t => t.members));
    const shown = gt.filter(s => s.printed !== false && !(s.show && s.show.number === 'none' && s.show.bracket === false));
    set('eg.tuplet.drawn_ratio', shown.length ? shown.filter(s => inOut.has(s.id) || inGroup.has(s.id)).length / shown.length : 1);
    const beamKeys = new Set(p.beams.map(b => b.events.join(' ')));
    const showOk = [...inOut.values()].filter(t => {
      const s = gt.find(x => x.id === t.id), show = s.show || {};
      return t.number === (show.number || 'actual') && t.bracket === (show.bracket !== undefined ? show.bracket : !beamKeys.has(s.events.join(' ')));
    });
    set('eg.tuplet.show_ok', inOut.size ? showOk.length / inOut.size : 1);
    set('eg.tuplet.suppressed_drawn', gt.filter(s => s.printed === false && (inOut.has(s.id) || inGroup.has(s.id))).length);
    set('eg.tuplet.merged_groups', p.tuplets.filter(t => t.source === 'merged').length);
    /* ties and slurs: the graph's own pairs */
    const ties = g.parts.flatMap(pt => pt.spanners.filter(s => s.type === 'tie'));
    set('eg.tie.drawn_ratio', ties.length ? ties.filter(s => p.ties.some(t => t.id === s.id && t.from === (s.from || null) && t.to === (s.to || null))).length / ties.length : 1);
    const slurs = g.parts.flatMap(pt => pt.spanners.filter(s => s.type === 'slur'));
    set('eg.slur.pair_exact', slurs.length ? slurs.filter(s => p.slurs.some(t => t.id === s.id && t.from === (s.from || null) && t.to === (s.to || null))).length / slurs.length : 1);
    /* marks: of each kind the graph states, what the ledger draws is in the output */
    MARKS.forEach(kind => {
      const en = p.ledger.filter(x => x.kind === kind);
      const due = en.filter(x => x.status === 'drawn' || x.status === 'merged');
      if (en.length) set('eg.mark.drawn_ratio.' + kind, due.length ? due.filter(x => a.missing.indexOf(x.ref) < 0).length / due.length : 1);
    });
    /* events and staves: the same notes at the same times on the same staves */
    const key = e => [e.id, e.m, e.at, e.dur, e.staff, e.voice].join('|');
    const ge = g.parts.flatMap(pt => pt.events.map(key)).sort(), pe = p.events.map(key).sort();
    set('eg.event.multiset_equal', ge.join('\n') === pe.join('\n') ? 1 : 0);
    const gh = new Map(g.parts.flatMap(pt => pt.events.flatMap(e => (e.heads || []).map(h => [h.id, h.staff || e.staff]))));
    const ph = p.events.flatMap(e => e.heads);
    set('eg.staff.assignment_exact', ph.length ? ph.filter(h => gh.get(h.id) === h.staff).length / ph.length : 1);
    /* the render source: the Score the app would hold agrees with the graph (live), and its rebuilt graph with it
       (projected). A Score from an item that is itself a projection is that Score. */
    const score = item.score || H.scoreOf(g, item.id);
    set('eg.source.agree_live', item.score ? 1 : (L.agree(score, g).ok ? 1 : 0));
    const fr = item.score ? { ok: true, graph: g } : L.fromScore(score);
    const projOk = fr.ok && L.agree(score, fr.graph).ok;
    const allowed = !projOk && PROJECTION_ALLOWED[item.id] && fr.unsupported && fr.unsupported.some(u => u.code === PROJECTION_ALLOWED[item.id]);
    set('eg.source.agree_projected', projOk || allowed ? 1 : 0);
    if (allowed) set('eg.source.projection_allowlisted', 1);
    set('eg.error', 0);
  } catch (e) {
    set('eg.error', 1);
    row.error = String(e && e.stack || e).slice(0, 400);
  }
  return row;
}

function summarise(rows) {
  const s = { graphs: rows.length };
  const keys = new Set(rows.flatMap(r => Object.keys(r.m)));
  [...keys].sort().forEach(k => {
    const vs = rows.map(r => r.m[k]).filter(v => v !== undefined);
    if (ONE.indexOf(k) >= 0 || k.indexOf('ratio') >= 0) s[k] = Math.round(Math.min(...vs) * 1e6) / 1e6;
    else s[k] = vs.reduce((a, b) => a + b, 0);
  });
  const ms = rows.map(r => r.ms || 0).sort((a, b) => a - b);
  s.timing = { planMsMedian: +ms[Math.floor(ms.length / 2)].toFixed(2), planMsMax: +ms[ms.length - 1].toFixed(2) };
  return s;
}

function compare(sum, base) {
  const bad = [];
  ZERO.forEach(k => { if ((sum[k] || 0) !== 0) bad.push(k + ' = ' + sum[k] + ' (must be 0)'); });
  ONE.forEach(k => { if (sum[k] !== undefined && sum[k] < 1) bad.push(k + ' = ' + sum[k] + ' (must be 1)'); });
  if (base) {
    if (sum.graphs !== base.graphs) bad.push('graphs ' + sum.graphs + ' vs baseline ' + base.graphs);
    Object.keys(base).filter(k => k.indexOf('eg.') === 0).forEach(k => {
      const v = sum[k] === undefined ? 0 : sum[k], b = base[k];
      const higherIsBetter = ONE.indexOf(k) >= 0 || k.indexOf('ratio') >= 0;
      if (higherIsBetter ? v < b : (k.indexOf('.deferred.') >= 0 || ZERO.indexOf(k) >= 0) ? v > b : false) bad.push(k + ' ' + v + ' vs baseline ' + b);
    });
    Object.keys(sum).filter(k => k.indexOf('eg.ledger.deferred.') === 0 && base[k] === undefined).forEach(k => bad.push(k + ' ' + sum[k] + ': a deferred code the baseline does not have'));
  }
  return bad;
}

async function main() {
  const cmd = process.argv[2];
  const i = process.argv.indexOf('--suite');
  const suite = i > 0 ? process.argv[i + 1] : 'r';
  if (['run', 'check', 'baseline'].indexOf(cmd) < 0) { console.error('usage: bench.js run|check|baseline --suite r|e|x'); process.exit(2); }
  const t0 = Date.now();
  const rows = (await inputs(suite)).map(measure);
  const sum = summarise(rows);
  const wall = ((Date.now() - t0) / 1000).toFixed(1) + ' s';
  const failures = rows.filter(r => r.m['eg.error'] || ZERO.some(k => r.m[k]) || ONE.some(k => r.m[k] !== undefined && r.m[k] < 1));
  if (cmd === 'run') {
    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(path.join(OUT, suite + '.l1.json'), JSON.stringify({ suite: suite, summary: sum, rows: rows }, null, 1) + '\n');
    console.log('suite ' + suite + ': ' + rows.length + ' graphs in ' + wall + ', ' + failures.length + ' with a failing metric -> ' + path.relative(process.cwd(), path.join(OUT, suite + '.l1.json')));
    failures.slice(0, 10).forEach(r => console.log('  ' + r.id + ' ' + JSON.stringify(Object.fromEntries(Object.entries(r.m).filter(([k, v]) => (ZERO.indexOf(k) >= 0 && v) || (ONE.indexOf(k) >= 0 && v < 1)))) + (r.error ? ' ' + r.error : '')));
    return;
  }
  if (cmd === 'baseline') {
    const bad = compare(sum, null);
    if (bad.length) { console.error('not writing a baseline over failing metrics:\n  ' + bad.join('\n  ')); process.exit(1); }
    fs.mkdirSync(BASE, { recursive: true });
    const b = Object.assign({}, sum); delete b.timing;
    fs.writeFileSync(path.join(BASE, suite + '.l1.json'), JSON.stringify(b, null, 1) + '\n');
    console.log('baseline ' + suite + ' written: ' + rows.length + ' graphs');
    return;
  }
  const bf = path.join(BASE, suite + '.l1.json');
  const base = fs.existsSync(bf) ? JSON.parse(fs.readFileSync(bf, 'utf8')) : null;
  if (!base) { console.error('no baseline ' + path.relative(process.cwd(), bf) + ' (bench.js baseline --suite ' + suite + ')'); process.exit(1); }
  const bad = compare(sum, base);
  console.log('suite ' + suite + ': ' + rows.length + ' graphs in ' + wall + ' - ' + (bad.length ? 'REGRESSION' : 'PASS'));
  bad.forEach(x => console.log('  ' + x));
  failures.slice(0, 10).forEach(r => console.log('  ' + r.id + (r.error ? ' ' + r.error : '')));
  process.exit(bad.length ? 1 : 0);
}
if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });
module.exports = { inputs, measure, summarise, compare, ZERO, ONE };
