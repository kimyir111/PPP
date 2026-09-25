/* G04 §21.1 L1 at the plan level (G4a): does the NotationPlan carry everything each graph states?
   G04 §21.2 L2 at the layout level (G4b): is the EngravedScore free of clips, overlaps, rod and order violations and
   overflow, at the desktop and phone screen configs (tests/engrave/l2.js, computed apart from engrave/skyline.js)?

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
/* L2 (l2.js): every layout metric is a zero target but the steepest beam (MAXIMA, a limit) and the count of systems
   drawn smaller (LOWER). G4b's two ratchets on other-voice collisions (eg.rest.overlap, eg.voice.stem_over_head) are
   zero targets since G4c (G04 §33.16.4, §34). */
const { l2, MAXIMA, DRAWN_KINDS } = require('../l2.js');
const L = SG.legacy;

const OUT = path.join(REPO, 'tests', 'engrave', 'out');
const BASE = path.join(REPO, 'tests', 'engrave', 'baselines');
const ZERO = ['eg.ledger.silent', 'eg.ledger.invented', 'eg.ledger.duplicate', 'eg.ledger.missing', 'eg.ledger.altered', 'eg.ledger.orphan',
  'eg.ledger.unapproved', 'eg.ledger.uncoded', 'eg.ledger.unsupported', 'eg.beam.derived_in_beamed_part', 'eg.beam.orphan', 'eg.tuplet.suppressed_drawn',
  'eg.graph.changed', 'eg.plan.nondeterministic', 'eg.error',
  /* L2 (G4b) */
  'eg.clip.count', 'eg.overlap.head_head', 'eg.overlap.acc', 'eg.overlap.dot', 'eg.staff.overlap', 'eg.system.overlap', 'eg.system.overflow',
  'eg.spacing.rod_violations', 'eg.spacing.monotonic_violations', 'eg.column.order_violations', 'eg.layout.event_missing', 'eg.layout.event_unknown',
  'eg.layout.head_missing', 'eg.layout.head_staff_wrong', 'eg.systems.one_bar', 'eg.layout.hard_violations', 'eg.glyph.fallback',
  'eg.layout.nondeterministic', 'eg.layout.multiset_diff', 'eg.system.fill_err', 'eg.system.scaled_avoidable',
  /* G4c: the G4b ratchets, now zero; beams, stems, tuplets, voices, rests, grace notes at the layout level; R4, R5 */
  'eg.rest.overlap', 'eg.voice.stem_over_head', 'eg.voice.stem_policy_violations', 'eg.stem.short', 'eg.beam.graph_missing',
  'eg.beam.derived_missing', 'eg.beam.unplanned', 'eg.beam.level_errors', 'eg.beam.flag_errors', 'eg.beam.slope_violations',
  'eg.beam.head_crossings', 'eg.tuplet.missing', 'eg.tuplet.show_errors', 'eg.tuplet.extent_err', 'eg.tuplet.nesting_errors',
  'eg.tuplet.suppressed_rendered', 'eg.grace.misplaced', 'eg.grace.stem_errors', 'eg.rest.measure_errors', 'eg.layout.attachment_diff',
  'eg.layout.signature_diff', 'eg.layout.pitch_y_err', 'eg.layout.duplicate_ids',
  /* the G4c fixer (G04 §34.18, the G4c review R1-R2): legal merges, shared unisons, the offset of voices side by side,
     stems to the middle line, rests on line or space, hook sides, tuplet hooks toward the notes */
  'eg.voice.merge_illegal', 'eg.voice.unison_unshared', 'eg.voice.offset_err', 'eg.stem.middle_line', 'eg.rest.position_err',
  'eg.beam.hook_side_err', 'eg.tuplet.hook_dir_err',
  /* G4d-1a (G04 §21.1-§21.2 for ties, slurs, glissandi, marks attached to notes, fingering and text; the G4c review's rest
     ledger lines and tuplet numbers) */
  'eg.tie.missing', 'eg.tie.endpoint_err', 'eg.tie.dir_err', 'eg.slur.pair_errors', 'eg.slur.endpoint_err', 'eg.curve.hits_undiagnosed',
  'eg.gliss.errors', 'eg.ledger.drawn_missing', 'eg.mark.missing.articulation', 'eg.mark.missing.ornament', 'eg.mark.missing.fermata',
  'eg.mark.missing.fingering', 'eg.mark.missing.gliss', 'eg.mark.missing.arpeggio', 'eg.mark.side_err', 'eg.mark.order_err', 'eg.mark.on_line',
  'eg.fingering.side_err', 'eg.fingering.order_err', 'eg.arpeggio.errors', 'eg.notehead.shape_err', 'eg.accidental.enclosure_err',
  'eg.rest.ledger_missing', 'eg.tuplet.number_far', 'eg.overlap.text', 'eg.overlap.text_text', 'eg.overlap.mark_mark', 'eg.overlap.mark_note',
  'eg.text.width_err', 'eg.text.missing_glyph', 'eg.clip.curves',
  /* the G4d-1a fixer (G04 §35.18): G4-L4's tie ends and crossings, G4-L5's fingering by its notes and §10.5's FAR_PLACEMENT
     named, the review's R3 (a slur's middle parts, its side, a mark's glyph) */
  'eg.tie.crossings', 'eg.slur.missing', 'eg.slur.side_err', 'eg.mark.glyph_err', 'eg.fingering.far', 'eg.layout.far_undiagnosed'];
const ONE = ['eg.beam.graph_drawn_ratio', 'eg.beam.members_exact', 'eg.tuplet.drawn_ratio', 'eg.tuplet.show_ok', 'eg.tie.drawn_ratio',
  'eg.slur.pair_exact', 'eg.event.multiset_equal', 'eg.staff.assignment_exact', 'eg.source.agree_live', 'eg.source.agree_projected'];
/* recorded, lower is better: more systems drawn at a smaller staff size is a regression; so is a slur more that crosses a
   note between its ends (G4d-1a: at most 1 % of a suite's slurs, eg.curve.hit_ratio, each diagnosed), and an item more placed
   farther than 8 sp from its staff (§10.5 FAR_PLACEMENT, §21.2 eg.layout.far_placements: recorded, each named). The suite's
   share of slurs that cross a note (eg.curve.hit_ratio, A22) is a ratio where lower is better: it is held here, not with the
   drawn ratios (the G4d-1a fixer: compare() read every '.ratio' as higher-is-better, so a rise passed and a fall failed) */
const LOWER = ['eg.system.scaled', 'eg.curve.hits', 'eg.layout.far_placements', 'eg.curve.hit_ratio'];
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
    /* §12.1, and §12.3 for a tuplet of one note: its number alone */
    const showOk = [...inOut.values()].filter(t => {
      const s = gt.find(x => x.id === t.id), show = s.show || {};
      return t.number === (show.number || 'actual') && t.bracket === (show.bracket !== undefined ? show.bracket : s.events.length > 1 && !beamKeys.has(s.events.join(' ')));
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
    /* L2: the layout at both screen configs, each metric summed over the two; the same graph laid out afresh gives the
       same EngravedScore */
    const P = E.layout.prepare(p);
    const t1 = process.hrtime.bigint();
    const lays = ['desktop', 'phone'].map(bp => E.layout.layout(P, { breakpoint: bp }));
    row.layoutMs = Number(process.hrtime.bigint() - t1) / 1e6 / 2;
    /* what either layout should draw and does not (G4d-1a): the ties, slurs and marks the drawn ratios count out */
    const undrawn = new Set();
    lays.forEach(eng => {
      const m = l2(eng, p, { prepared: P, layout: E.layout, graph: g, missing: undrawn });
      Object.keys(m).forEach(k => set(k, MAXIMA[k] !== undefined ? Math.max(row.m[k] || 0, m[k]) : (row.m[k] || 0) + m[k]));
    });
    /* §21.1's drawn ratios, since G4d-1a at the layout: a tie is drawn when the plan carries it and each layout draws it (a
       curve, or two halves across a break), a slur when its curve joins its own notes, a mark when an object names it */
    set('eg.tie.drawn_ratio', ties.length ? ties.filter(s => p.ties.some(t => t.id === s.id && t.from === (s.from || null) && t.to === (s.to || null)) && !undrawn.has(s.id)).length / ties.length : 1);
    set('eg.slur.pair_exact', slurs.length ? slurs.filter(s => p.slurs.some(t => t.id === s.id && t.from === (s.from || null) && t.to === (s.to || null)) && !undrawn.has(s.id)).length / slurs.length : 1);
    DRAWN_KINDS.forEach(kind => {
      const due = p.ledger.filter(x => x.kind === kind && (x.status === 'drawn' || x.status === 'merged'));
      if (p.ledger.some(x => x.kind === kind)) set('eg.mark.drawn_ratio.' + kind, due.length ? due.filter(x => a.missing.indexOf(x.ref) < 0 && !undrawn.has(x.ref)).length / due.length : 1);
    });
    set('eg.layout.nondeterministic', E.layoutHash(E.engrave(E.plan(g, cfg), { breakpoint: 'desktop' })) === E.layoutHash(lays[0]) ? 0 : 1);
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
    else if (MAXIMA[k] !== undefined) s[k] = Math.max(...vs);
    else s[k] = vs.reduce((a, b) => a + b, 0);
  });
  /* A22: the share of the suite's slurs that cross a note between their ends (each layout's own share is a row's) */
  const slurs = rows.reduce((a, r) => a + (r.m['eg.curve.slurs'] || 0), 0), hits = rows.reduce((a, r) => a + (r.m['eg.curve.hits'] || 0), 0);
  if (keys.has('eg.curve.hit_ratio')) s['eg.curve.hit_ratio'] = slurs ? Math.round(hits / slurs * 10000) / 10000 : 0;
  const ms = rows.map(r => r.ms || 0).sort((a, b) => a - b);
  const lms = rows.map(r => r.layoutMs || 0).sort((a, b) => a - b);
  s.timing = { planMsMedian: +ms[Math.floor(ms.length / 2)].toFixed(2), planMsMax: +ms[ms.length - 1].toFixed(2),
    layoutMsMedian: +lms[Math.floor(lms.length / 2)].toFixed(2), layoutMsMax: +lms[lms.length - 1].toFixed(2) };
  return s;
}

function compare(sum, base) {
  const bad = [];
  ZERO.forEach(k => { if ((sum[k] || 0) !== 0) bad.push(k + ' = ' + sum[k] + ' (must be 0)'); });
  ONE.forEach(k => { if (sum[k] !== undefined && sum[k] < 1) bad.push(k + ' = ' + sum[k] + ' (must be 1)'); });
  Object.keys(MAXIMA).forEach(k => { if (sum[k] !== undefined && sum[k] > MAXIMA[k]) bad.push(k + ' = ' + sum[k] + ' (must be <= ' + MAXIMA[k] + ')'); });
  if (base) {
    if (sum.graphs !== base.graphs) bad.push('graphs ' + sum.graphs + ' vs baseline ' + base.graphs);
    Object.keys(base).filter(k => k.indexOf('eg.') === 0).forEach(k => {
      const v = sum[k] === undefined ? 0 : sum[k], b = base[k];
      const higherIsBetter = LOWER.indexOf(k) < 0 && (ONE.indexOf(k) >= 0 || k.indexOf('ratio') >= 0);
      if (higherIsBetter ? v < b : (k.indexOf('.deferred.') >= 0 || ZERO.indexOf(k) >= 0 || LOWER.indexOf(k) >= 0) ? v > b : false) bad.push(k + ' ' + v + ' vs baseline ' + b);
    });
    /* every zero target the suite measures is in the baseline (a metric added later is re-baselined, not skipped) */
    ZERO.filter(k => sum[k] !== undefined && base[k] === undefined).forEach(k => bad.push(k + ' ' + sum[k] + ': a zero-target metric the baseline does not record'));
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
module.exports = { inputs, measure, summarise, compare, ZERO, ONE, LOWER, MAXIMA };
