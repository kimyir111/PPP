/* G4b - the layout core: NotationPlan -> EngravedScore (docs/GOALS/G04 §8.4, §9, §10, §15, §20, §21.2; A14, A17-A19,
   A23-A25, A27, A29). Node only, no DOM: the layout is pure and reads glyph sizes from engrave/metrics.js.
   The practice map and the highlighter are practice.test.js; the geometry metrics are l2.js (shared with bench.js). */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { REPO, SG, E, corpusGraphs, graphOf } = require('./helpers.js');
const { l2, MAXIMA, RECORDED } = require('./l2.js');
const A29 = require('./a29.js');
const HASHES = require('./tools/layout-hashes.js');

const L = E.layout;
const CN = require(path.join(REPO, 'engrave', 'canon.js'));
const SP = require(path.join(REPO, 'engrave', 'space.js'));
const BR = require(path.join(REPO, 'engrave', 'breaks.js'));
const SK = require(path.join(REPO, 'engrave', 'skyline.js'));
const MT = require(path.join(REPO, 'engrave', 'metrics.js'));
const R = SG.rational;

const efix = () => fs.readdirSync(path.join(REPO, 'tests', 'engrave', 'fixtures', 'e')).filter(f => f.endsWith('.musicxml')).sort();
const eplan = async f => E.plan(await graphOf('tests/engrave/fixtures/e/' + f));
/* the one committed score whose measure no width holds: its last measure is 175/4 whole notes (166 events, the rest of
   the hymn in one bar - a source defect); it overflows and says so */
const OVERFLOW_ALLOWED = new Set(['catalog/hymns/in-the-bleak-midwinter.musicxml']);
/* every L2 metric l2.js computes is a zero target but the steepest beam (a limit), the count of systems drawn smaller
   (recorded) and an overflow (the one source defect below). G4b's ratchets on other-voice collisions (eg.rest.overlap,
   eg.voice.stem_over_head: 189 and 216 over the corpus at G4b) are zero targets since G4c. */
const NOT_ZERO = new Set(Object.keys(MAXIMA).concat(RECORDED, ['eg.system.overflow']));
const zeroKeys = m => Object.keys(m).filter(k => !NOT_ZERO.has(k)).sort();
const ZERO_L2 = ['eg.clip.count', 'eg.overlap.head_head', 'eg.overlap.acc', 'eg.overlap.dot', 'eg.staff.overlap', 'eg.system.overlap',
  'eg.spacing.rod_violations', 'eg.spacing.monotonic_violations', 'eg.column.order_violations', 'eg.layout.event_missing',
  'eg.layout.event_unknown', 'eg.layout.head_missing', 'eg.layout.head_staff_wrong', 'eg.systems.one_bar', 'eg.layout.hard_violations',
  'eg.glyph.fallback', 'eg.layout.multiset_diff', 'eg.system.fill_err', 'eg.system.scaled_avoidable',
  'eg.rest.overlap', 'eg.voice.stem_over_head', 'eg.voice.stem_policy_violations', 'eg.stem.short', 'eg.beam.graph_missing',
  'eg.beam.derived_missing', 'eg.beam.unplanned', 'eg.beam.level_errors', 'eg.beam.flag_errors', 'eg.beam.slope_violations',
  'eg.beam.head_crossings', 'eg.tuplet.missing', 'eg.tuplet.show_errors', 'eg.tuplet.extent_err', 'eg.tuplet.nesting_errors',
  'eg.tuplet.suppressed_rendered', 'eg.grace.misplaced', 'eg.grace.stem_errors', 'eg.rest.measure_errors', 'eg.layout.attachment_diff',
  'eg.layout.signature_diff', 'eg.layout.pitch_y_err', 'eg.layout.duplicate_ids',
  'eg.voice.merge_illegal', 'eg.voice.unison_unshared', 'eg.voice.offset_err', 'eg.stem.middle_line', 'eg.rest.position_err',
  'eg.beam.hook_side_err', 'eg.tuplet.hook_dir_err',
  /* G4d-1a: curves, marks attached to notes, fingering, text, rest ledger lines, tuplet numbers by their beams */
  'eg.tie.missing', 'eg.tie.endpoint_err', 'eg.tie.dir_err', 'eg.slur.pair_errors', 'eg.slur.endpoint_err', 'eg.curve.hits_undiagnosed',
  'eg.gliss.errors', 'eg.ledger.drawn_missing', 'eg.mark.missing.articulation', 'eg.mark.missing.ornament', 'eg.mark.missing.fermata',
  'eg.mark.missing.fingering', 'eg.mark.missing.gliss', 'eg.mark.missing.arpeggio', 'eg.mark.side_err', 'eg.mark.order_err', 'eg.mark.on_line',
  'eg.fingering.side_err', 'eg.fingering.order_err', 'eg.arpeggio.errors', 'eg.notehead.shape_err', 'eg.accidental.enclosure_err',
  'eg.rest.ledger_missing', 'eg.tuplet.number_far', 'eg.overlap.text', 'eg.overlap.text_text', 'eg.overlap.mark_mark', 'eg.overlap.mark_note',
  'eg.text.width_err', 'eg.text.missing_glyph', 'eg.clip.curves',
  /* the G4d-1a fixer (G04 §35.18): G4-L4's tie ends and crossings, G4-L5's fingering by its notes and §10.5, the review's R3 */
  'eg.tie.crossings', 'eg.slur.missing', 'eg.slur.side_err', 'eg.mark.glyph_err', 'eg.fingering.far', 'eg.layout.far_undiagnosed',
  /* G4d-1b (G04 §10.2 priorities 7-11, §10.4 S2 and S5, §15.3, §15.4; A8-A10, A12 lyrics, A20, A25; the G4d-1a review R5): the
     marks attached to systems drawn and where their rules put them, the written pitch under octave lines, vertical spacing,
     courtesy signs, bracketed accidentals */
  'eg.mark.missing.dynamic', 'eg.mark.missing.wedge', 'eg.mark.missing.pedal', 'eg.mark.missing.pedal-change', 'eg.mark.missing.ottava',
  'eg.mark.missing.ending', 'eg.mark.missing.chord', 'eg.mark.missing.tempo', 'eg.mark.missing.rehearsal', 'eg.mark.missing.jump',
  'eg.mark.missing.words', 'eg.mark.missing.lyric', 'eg.dynamic.side_err', 'eg.row.baseline_err', 'eg.hairpin.level_err', 'eg.hairpin.shape_err',
  'eg.hairpin.clear_err', 'eg.pedal.errors', 'eg.pedal.change_err', 'eg.ottava.extent_err', 'eg.ottava.label_err', 'eg.event.written_diff',
  'eg.volta.extent_err', 'eg.chord.order_err', 'eg.lyric.staff_err', 'eg.lyric.place_err', 'eg.row.order_err', 'eg.text.content_err',
  'eg.skyline.vertical_collisions', 'eg.staff.gap_err', 'eg.system.gap_err', 'eg.courtesy.missing', 'eg.accidental.bracket_err',
  /* the G4d-1b fixer (G04 §36.18; the review's R1-R3) */
  'eg.tempo.split_err', 'eg.mark.anchor_err', 'eg.hairpin.extent_err', 'eg.words.push_err', 'eg.row.centre_err'];

/* A piano piece from a compact spec: bars of voices of [dur, type, pitch, extra] with pitch 'C5', 'F#4' ('r' a rest) or
   an array of pitches (a chord); extra: {dots, acc, stem}. Voice 1 and 2 on the upper staff, voice 3 on the lower. */
function piece(spec) {
  const b = SG.builder({ id: spec.id || 'g4b', meta: { title: 'T' } });
  const src = b.source({ kind: 'user' });
  b.setDefault({ src: src.id });
  const ms = spec.bars.map((bar, i) => b.measure({ number: String(i + 1), dur: bar.dur || spec.dur || '1' }));
  b.meter({ m: ms[0].id, beats: Array.isArray(spec.beats) ? spec.beats : [spec.beats || 4], beatType: spec.beatType || 4 });
  if (spec.fifths) b.key({ m: ms[0].id, at: '0', fifths: spec.fifths, hidden: spec.keyHidden || undefined });
  const part = b.part({ instrument: { kind: 'piano', family: 'keyboard' } });
  const st = [b.staff(part, {}), b.staff(part, {})];
  const vs = [b.voice(part, { staff: st[0].id, label: '1' }), b.voice(part, { staff: st[0].id, label: '2' }), b.voice(part, { staff: st[1].id, label: '5' })];
  b.clef(part, { staff: st[0].id, m: ms[0].id, at: '0', sign: 'G' });
  b.clef(part, { staff: st[1].id, m: ms[0].id, at: '0', sign: 'F' });
  const pitch = p => { const m = /^([A-G])(#|b)?(\d)$/.exec(p); return { step: m[1], alter: m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0, oct: +m[3] }; };
  spec.bars.forEach((bar, mi) => (bar.voices || []).forEach((notes, vi) => {
    let at = R.ZERO;
    notes.forEach(([dur, type, p, x]) => {
      x = x || {};
      const e = { kind: p === 'r' ? 'rest' : 'note', m: ms[mi].id, at: R.format(at), dur: dur, voice: vs[vi].id, staff: st[vi === 2 ? 1 : 0].id,
        display: Object.assign({ type: type }, x.dots ? { dots: x.dots } : {}, x.stem ? { stem: x.stem } : {}) };
      if (p !== 'r') e.heads = (Array.isArray(p) ? p : [p]).map(q => Object.assign({ pitch: pitch(q) }, x.acc ? { acc: { type: x.acc } } : {}));
      b.event(part, e);
      at = R.add(at, R.parse(dur));
    });
  }));
  return b.finish().graph;
}
const bars = (n, voices, dur) => Array.from({ length: n }, () => ({ voices: voices, dur: dur }));
const QUARTERS = [[['1/4', 'quarter', 'C5'], ['1/4', 'quarter', 'D5'], ['1/4', 'quarter', 'E5'], ['1/4', 'quarter', 'F5']]];
const SIXTEENTHS = [Array.from({ length: 16 }, (_, i) => ['1/16', '16th', ['C5', 'D5', 'E5', 'F5'][i % 4], { acc: i % 4 === 3 ? 'sharp' : undefined }])];
const HALVES = [[['1/2', 'half', 'G4']]];
const layoutOf = (graph, cfg) => { const p = E.plan(graph); const P = L.prepare(p); return { p, P, e: L.layout(P, cfg || {}) }; };
const timeCols = e => e.measures.flatMap(m => m.columns.filter(c => c.time).map(c => ({ m: m.id, at: c.at, x: c.x, system: m.system })));

/* ------------------------------------------------------------------ canonical form, hash, determinism (A27) */
test('canonical JSON sorts keys, rounds to 0.01 and has no -0; the hash is FNV-1a 64 of it', () => {
  assert.equal(CN.canonical({ b: 1.004, a: [-0.001, { z: 1, y: 2 }] }), '{"a":[0,{"y":2,"z":1}],"b":1}');
  assert.equal(CN.hash({ a: 1 }), CN.hash(JSON.parse('{"a":1.001}')));
  assert.equal(CN.hash({ a: 1 }), '9c3e82dd6fcae8b1');
  assert.notEqual(CN.hash({ a: 1 }), CN.hash({ a: 1.01 }));
});

test('A27: the same plan and config give the same EngravedScore, three times, prepared once or afresh, in any order', async () => {
  const files = efix();
  const forward = {};
  for (const f of files) {
    const p = await eplan(f);
    const h = [CN.hash(L.engrave(p, {})), CN.hash(L.engrave(E.plan(await graphOf('tests/engrave/fixtures/e/' + f)), {})), CN.hash(L.createEngraver(p).layout({}))];
    assert.equal(new Set(h).size, 1, f + ' lays out the same every time');
    forward[f] = h[0];
  }
  for (const f of files.slice().reverse()) assert.equal(CN.hash(L.engrave(await eplan(f), {})), forward[f], f + ' after the others in reverse');
  /* the EngravedScore is plain data: it survives JSON unchanged */
  const e = L.engrave(await eplan('E22-repeats-jumps.musicxml'), {});
  assert.equal(CN.hash(JSON.parse(JSON.stringify(e))), CN.hash(e));
});

test('A27: the committed layout hashes (E fixtures, the R suite, PPP transcriptions; desktop and phone) - the same on every OS', async () => {
  const want = JSON.parse(fs.readFileSync(HASHES.FILE, 'utf8'));
  assert.equal(want.version, L.VERSION);
  assert.equal(want.planVersion, E.PLAN_VERSION);
  const got = await HASHES.computeAll('reverse');
  const bad = HASHES.diff(got.hashes, want.hashes).concat(HASHES.diffPlans(got.plans, want.plans));
  assert.deepEqual(bad, [], 'tests/engrave/tools/layout-hashes.js --write after an intended layout change');
  assert.ok(Object.keys(want.hashes).length >= 118);
  assert.deepEqual(Object.keys(want.plans), Object.keys(want.hashes), 'a plan hash for every score');
});

test('A29: no DOM measurement anywhere in engrave/ but the drawing backend; no browser global, clock, random, timer, network, locale or VexFlow from graph to EngravedScore', () => {
  const r = A29.scanDir(path.join(REPO, 'engrave'));
  assert.deepEqual(r.findings, [], 'engrave/ is clean');
  /* what the tiers cover (G04 §20): DOM measurement in every file but svg.js (not written yet, G4c+); the determinism
     rules in every file but that and the G4a render-source files that talk to the page by design */
  assert.deepEqual(r.scanned.measure, r.files.filter(f => !A29.BACKEND[f] && !A29.PAGE[f]));
  assert.deepEqual(r.files.filter(f => r.scanned.pure.indexOf(f) < 0 && !A29.BACKEND[f] && !A29.PAGE[f]), Object.keys(A29.EDGE).sort());
  /* G4d-2: the page adapter is the one file exempt from both - and no engrave/ file requires it, so nothing from a graph to an
     EngravedScore or an SVG can reach the DOM through it */
  assert.deepEqual(Object.keys(A29.PAGE), ['page.js']);
  r.files.filter(f => f !== 'page.js').forEach(f => assert.doesNotMatch(fs.readFileSync(path.join(REPO, 'engrave', f), 'utf8'), /require\(['"]\.\/page\.js['"]\)|M\.page\b/,
    f + ' does not read the page adapter'));
  Object.keys(A29.EDGE).forEach(f => assert.ok(r.files.indexOf(f) >= 0, 'the exemption names a file that exists: ' + f));
  ['metrics', 'space', 'breaks', 'skyline', 'canon', 'notation', 'layout', 'practice', 'outlines', 'plan', 'plan-beams', 'plan-tuplets', 'ledger', 'glyphs',
    'curves', 'marks', 'metrics-text', 'sysmarks'].forEach(n => assert.ok(r.scanned.pure.indexOf(n + '.js') >= 0, n + '.js is held to every rule'));
  /* the drawing backend is exempt by §20, and needs no exemption: it emits text and measures nothing */
  assert.ok(r.files.indexOf('svg.js') >= 0);
  assert.deepEqual(A29.scanSource(fs.readFileSync(path.join(REPO, 'engrave', 'svg.js'), 'utf8'), 'svg-as-a-layout-module.js'), [], 'svg.js holds to every rule too');
  /* the metrics table is exactly the pinned font's (CI runs the same check) */
  const out = execFileSync(process.execPath, [path.join(REPO, 'tests', 'engrave', 'tools', 'make-metrics.js'), '--check'], { encoding: 'utf8' });
  assert.match(out, /holds the pinned font's metrics/);
});

test('A29 negative controls: every banned construct is caught by its rule, whatever precedes the dot; comments, the config\'s window and the UMD root are not', () => {
  const CAUGHT = [
    ['dom-measure', 'const w = el.getComputedTextLength();'],
    ['dom-measure', 'const b = node.getBBox();'],
    ['dom-measure', 'const w = ctx.measureText(label).width;'],
    ['dom-measure', 'const r = el.getBoundingClientRect();'],
    ['dom-measure', 'const s = getComputedStyle(el).fontSize;'],
    ['dom-global', 'const d = globalThis.document;'],
    ['global-object', 'const d = globalThis.document;'],
    ['dom-global', 'const d = root.document;'],
    ['dom-global', 'const b = document.body;'],
    ['dom-global', "const d = root['document'];"],
    ['dom-global', 'const w = window.innerWidth;'],
    ['dom-global', 'const w = root.window;'],
    ['dom-global', 'const n = navigator.hardwareConcurrency;'],
    ['dom-global', 'const r = devicePixelRatio;'],
    ['global-object', 'const r = self.devicePixelRatio;'],
    ['global-object', 'const g = globalThis;'],
    ['global-object', 'global.cache = {};'],
    ['clock', 'const t = Date.now();'],
    ['clock', 'const t = new Date();'],
    ['clock', 'const t = performance.now();'],
    ['clock', 'const t = process.hrtime();'],
    ['timer', 'setTimeout(next, 0);'],
    ['timer', 'requestAnimationFrame(draw);'],
    ['random', 'const r = Math.random();'],
    ['random', "const r = Math['random']();"],
    ['random', 'crypto.getRandomValues(buf);'],
    ['network', 'fetch(url);'],
    ['network', 'const x = new XMLHttpRequest();'],
    ['network', "import('./font.js');"],
    ['dynamic-code', "const f = new Function('return this')();"],
    ['dynamic-code', 'eval(src);'],
    ['locale', 'const s = new Intl.NumberFormat().format(x);'],
    ['locale', 'const s = x.toLocaleString();'],
    ['locale', 'const s = n.toLocaleUpperCase();'],
    ['locale', 'ids.sort((a, b) => a.localeCompare(b));'],
    ['vexflow', "const VF = require('../vendor/vexflow-4.2.3.js');"],
    ['vexflow', 'const st = new Vex.Flow.Stave(0, 0, 100);'],
    ['require-nonrelative', "const fs = require('fs');"],
    /* a string is scanned: computed access names the global in one */
    ['dom-global', "const k = 'document';"],
    /* what looks like a comment inside a string or a regex hides nothing */
    ['network', "const a = '/*'; fetch(u); const b = '*/';"],
    ['network', 'const re = /[/*]/; fetch(u); const c = 1; /* */']
  ];
  CAUGHT.forEach(([rule, src]) => {
    const f = A29.scanSource(src, 'layout.js');
    assert.ok(f.some(x => x.rule === rule), rule + ' catches: ' + src + ' -> ' + JSON.stringify(f));
  });
  const CLEAN = [
    '/* getBBox, getComputedTextLength, measureText, document, window, Date, Math.random, fetch, Intl, toLocaleString, VexFlow */ const a = 1;',
    '// a line comment naming document.body, performance.now() and require(\'fs\')\nconst b = 2;',
    'const lo = cfg.window ? cfg.window[0] : 0, hi = config.window ? config.window[1] : 0;',
    'return { mode: \'screen\', window: win, width: w };',
    "(function (root, factory) { root.M = factory(); })(typeof globalThis !== 'undefined' ? globalThis : this, function () { return 1; });",
    'const documentation = 1, windowed = 2, updatedAt = 3, randomize = 4, dateOf = 5;',
    'const re = /\\/\\/ x/g; const q = a / b / c;',
    "const self = ['drawn', null]; put(self[0], self[1]);",
    "const M = require('./metrics.js'), SG = require('../scoregraph/index.js');"
  ];
  CLEAN.forEach(src => assert.deepEqual(A29.scanSource(src, 'layout.js'), [], 'no finding: ' + src));
  /* the tiers: the G4a edge files may use their page globals but may not measure the DOM; the backend may measure */
  assert.deepEqual(A29.scanSource('setTimeout(f, 0); const db = indexedDB; const t = Date.now();', 'store.js'), []);
  assert.ok(A29.scanSource('const b = el.getBBox();', 'store.js').some(x => x.rule === 'dom-measure'));
  assert.deepEqual(A29.scanSource('const b = el.getBBox(), w = el.getComputedTextLength();', 'svg.js'), []);
  assert.ok(A29.scanSource('const t = Date.now();', 'some-new-module.js').some(x => x.rule === 'clock'), 'a new file is held to every rule');
});

/* ------------------------------------------------------------------ the EngravedScore */
test('the EngravedScore: staff-space coordinates to 0.01, every object keyed to plan or graph ids, unique ids, plain data', async () => {
  const p = await eplan('E35-voice-and-piano.musicxml');
  const e = L.engrave(p, {});
  assert.equal(e.version, 'engr/5');
  assert.equal(e.planKey, p.graph.fingerprint + ':' + p.version);
  assert.deepEqual(e.config, { mode: 'screen', breakpoint: 'desktop', width: 100, barsPerSystem: 4, respectSourceBreaks: false, window: null });
  assert.deepEqual(Object.keys(e).sort(), ['config', 'coverage', 'curves', 'diagnostics', 'measures', 'objects', 'pages', 'planKey', 'systems', 'version']);
  assert.deepEqual(e.curves, [], 'this piece has no tie, slur or glissando (curves: marks.test.js)');
  const ids = new Set();
  const planIds = new Set([].concat(p.events.map(x => x.id), p.events.flatMap(x => x.heads.map(h => h.id)), p.measures.map(x => x.id),
    p.clefs.map(x => x.id), p.keys.map(x => x.id), p.meters.map(x => x.id), p.staves.map(x => x.id), p.parts.map(x => x.id), p.endings.map(x => x.id),
    p.beams.map(x => x.id), p.tuplets.map(x => x.id), p.tuplets.flatMap(x => x.members || []),
    /* G4d-1b: the marks attached to systems - directions, lines, tempos, jumps, lyrics (by their ledger refs) */
    p.marks.map(x => x.id), p.lines.map(x => x.id), p.tempos.map(x => x.id), p.jumps.map(x => x.id),
    p.ledger.filter(x => x.kind === 'lyric' || x.kind === 'pedal-change').map(x => x.ref)));
  const two = v => Math.round(v * 100) / 100 === v;
  e.objects.forEach(o => {
    assert.ok(!ids.has(o.id), 'unique id ' + o.id);
    ids.add(o.id);
    assert.ok(o.box.every(two) && o.box[0] <= o.box[2] && o.box[1] <= o.box[3], o.id + ' box');
    o.refs.forEach(r => assert.ok(planIds.has(r), o.id + ' refers to ' + r));
    if (o.event) assert.ok(planIds.has(o.event));
    if (o.glyph) assert.ok(MT.has(o.glyph) && o.origin.every(two), o.id + ' glyph');
    if (o.anchor) assert.ok(o.anchor.every(two));
    /* an object's id is its graph id (a head, an event's rest), or that id and a suffix, or a decoration ('d:') */
    assert.ok(planIds.has(o.id) || planIds.has(o.id.split(/[#:]/)[0]) || o.id.startsWith('d:'), 'id ' + o.id);
  });
  e.systems.forEach(s => assert.ok([s.x, s.y, s.w, s.u].every(two) && s.staves.every(t => [t.y, t.top, t.bottom, t.h].every(two))));
  e.measures.forEach(m => assert.ok([m.x, m.w].concat(m.content, m.columns.map(c => c.x)).every(two)));
});

/* ------------------------------------------------------------------ intrinsic widths (§9.3) */
test('intrinsic widths: accidentals, dots, seconds, chords, a second voice and rests make a column wider; nothing is time x constant', () => {
  const colOf = spec => L.prepare(E.plan(piece(spec))).measures[0];
  const one = x => colOf({ beats: 1, dur: '1/4', bars: [{ voices: [[['1/4', 'quarter', 'C5', x]]] }] }).cols[0];
  const plain = one();
  const w = c => c.left + c.right;
  assert.ok(Math.abs(w(plain) - MT.glyph('noteheadBlack').w) < 1e-9, 'a lone quarter: its head');
  assert.ok(one({ acc: 'sharp' }).left >= MT.glyph('accidentalSharp').w + MT.ENGRAVING.accidentalGap - 1e-9, 'an accidental widens the left');
  assert.ok(one({ acc: 'flat-flat' }).left > one({ acc: 'flat' }).left, 'a double flat is wider than a flat');
  assert.ok(one({ dots: 1 }).right > plain.right + MT.ENGRAVING.dotGap, 'a dot widens the right');
  assert.ok(one({ dots: 2 }).right > one({ dots: 1 }).right, 'two dots more');
  const second = colOf({ beats: 1, dur: '1/4', bars: [{ voices: [[['1/4', 'quarter', ['C5', 'D5']]]] }] }).cols[0];
  assert.ok(w(second) > 2 * MT.glyph('noteheadBlack').w - 1e-9, 'a second puts a head on the other side of the stem');
  const third = colOf({ beats: 1, dur: '1/4', bars: [{ voices: [[['1/4', 'quarter', ['C5', 'E5']]]] }] }).cols[0];
  assert.ok(Math.abs(w(third) - w(plain)) < 1e-9, 'a third does not');
  const chordAcc = colOf({ beats: 1, dur: '1/4', bars: [{ voices: [[['1/4', 'quarter', ['C5', 'D5', 'E5'], { acc: 'sharp' }]]] }] }).cols[0];
  assert.ok(chordAcc.left > one({ acc: 'sharp' }).left, 'accidentals a second apart stack in columns');
  /* two voices on one pitch (§14.2): one head of one shape is shared; a half and a quarter stand side by side */
  const unison = colOf({ beats: 1, dur: '1/4', bars: [{ voices: [[['1/4', 'quarter', 'C5', { stem: 'up' }]], [['1/4', 'quarter', 'C5', { stem: 'down' }]]] }] }).cols[0];
  assert.ok(Math.abs(w(unison) - MT.glyph('noteheadBlack').w) < 1e-9, 'two voices on one pitch and one shape share a head');
  const unison2 = colOf({ beats: 2, dur: '1/2', bars: [{ voices: [[['1/2', 'half', 'C5', { stem: 'up' }]], [['1/4', 'quarter', 'C5', { stem: 'down' }], ['1/4', 'quarter', 'D5', { stem: 'down' }]]] }] }).cols[0];
  assert.ok(w(unison2) > 2 * MT.glyph('noteheadBlack').w - 1e-9, 'a half and a quarter on one pitch stand side by side');
  const rest = colOf({ beats: 2, dur: '1/2', bars: [{ voices: [[['1/4', 'quarter', 'r'], ['1/4', 'quarter', 'C5']]] }] }).cols[0];
  assert.ok(Math.abs(w(rest) - MT.glyph('restQuarter').w) < 1e-9, 'a rest: its glyph');
  /* a rest the whole measure long is a whole rest (§14.3, G4b review R6) */
  const bar = colOf({ beats: 1, dur: '1/4', bars: [{ voices: [[['1/4', 'quarter', 'r']]] }] }).cols[0];
  assert.ok(Math.abs(w(bar) - MT.glyph('restWhole').w) < 1e-9, 'a whole-measure rest: a whole rest');
  /* extents are per staff: the upper staff's accidental does not give the lower staff a left extent */
  const twoP = E.plan(piece({ beats: 1, dur: '1/4', bars: [{ voices: [[['1/4', 'quarter', 'C5', { acc: 'sharp' }]], [], [['1/4', 'quarter', 'C3']]] }] }));
  const two = L.prepare(twoP).measures[0].cols[0];
  assert.ok(two.staves[twoP.staves[0].id].left > 0);
  assert.equal(two.staves[twoP.staves[1].id].left, 0);
  /* spacing grows with duration by (Δ/¼)^0.65, not in proportion */
  const g = piece({ beats: 4, bars: [{ voices: [[['1/2', 'half', 'C5'], ['1/4', 'quarter', 'C5'], ['1/4', 'quarter', 'C5']]] }] });
  const { e } = layoutOf(g, { width: 200 });
  const c = e.measures[0].columns;
  const ratio = (c[1].x - c[0].x) / (c[2].x - c[1].x);
  assert.ok(Math.abs(ratio - Math.pow(2, 0.65)) < 0.01, 'a half is 2^0.65 of a quarter, not twice: ' + ratio);
});

/* ------------------------------------------------------------------ springs and rods (§9.4) */
test('springs and rods: solve() finds the exact u, never goes below a rod, and says when even the rods do not fit', () => {
  const springs = [{ g: 1, rod: 2 }, { g: 0.4, rod: 3 }, { g: 1.57, rod: 1.5 }, { g: 0, rod: 0.8 }];
  [12, 15, 20, 40].forEach(target => {
    const s = SP.solve(springs, 4, target);
    assert.equal(s.overflow, false);
    assert.ok(Math.abs(SP.width(springs, 4, s.u) - target) < 1e-9, 'exactly ' + target);
    SP.distances(springs, s.u).forEach((d, i) => assert.ok(d >= springs[i].rod - 1e-12));
  });
  const over = SP.solve(springs, 4, 10);
  assert.deepEqual([over.u, over.overflow, over.width], [0, true, 11.3]);
  assert.equal(SP.minWidth(springs, 4), 11.3);
  /* a longer time step is never narrower, whatever the stretch */
  [0.5, 2, 4, 9].forEach(u => assert.ok(u * SP.factor(0.5) > u * SP.factor(0.25) && u * SP.factor(0.25) > u * SP.factor(0.125)));
  assert.equal(SP.factor(0), 0);
  assert.equal(SP.factor(0.25), 1);
});

/* ------------------------------------------------------------------ meters, voices, chords (§9, §14) */
test('meters 4/4, 3/4, 6/8 and 5/8 (3+2): a column at every onset, equal steps equally spaced, longer steps wider', () => {
  const cases = [
    { beats: 4, beatType: 4, dur: '1', v: [[['1/4', 'quarter', 'C5'], ['1/8', 'eighth', 'D5'], ['1/8', 'eighth', 'E5'], ['1/2', 'half', 'F5']]] },
    { beats: 3, beatType: 4, dur: '3/4', v: [[['1/4', 'quarter', 'C5'], ['1/4', 'quarter', 'D5'], ['1/4', 'quarter', 'E5']]] },
    { beats: 6, beatType: 8, dur: '3/4', v: [[['1/8', 'eighth', 'C5'], ['1/8', 'eighth', 'D5'], ['1/8', 'eighth', 'E5'], ['3/8', 'quarter', 'F5', { dots: 1 }]]] },
    { beats: [3, 2], beatType: 8, dur: '5/8', v: [[['1/8', 'eighth', 'C5'], ['1/8', 'eighth', 'D5'], ['1/8', 'eighth', 'E5'], ['1/8', 'eighth', 'F5'], ['1/8', 'eighth', 'G5']]] }
  ];
  cases.forEach(cs => {
    const g = piece({ beats: cs.beats, beatType: cs.beatType, dur: cs.dur, bars: bars(4, cs.v, cs.dur) });
    const { p, P, e } = layoutOf(g);
    const m0 = e.measures[0];
    assert.equal(m0.columns.length, cs.v[0].length, 'one column per onset');
    const steps = [];
    for (let i = 0; i + 1 < m0.columns.length; i++) steps.push([R.toNumber(R.sub(R.parse(m0.columns[i + 1].at), R.parse(m0.columns[i].at))), m0.columns[i + 1].x - m0.columns[i].x]);
    steps.forEach(a => steps.forEach(b => {
      if (Math.abs(a[0] - b[0]) < 1e-9) assert.ok(Math.abs(a[1] - b[1]) < 0.02, 'equal steps equal: ' + JSON.stringify([a, b]));
      if (a[0] > b[0] + 1e-9) assert.ok(a[1] > b[1], 'a longer step is wider');
    }));
    const m = l2(e, p, { prepared: P, layout: L });
    ZERO_L2.forEach(k => assert.equal(m[k], 0, JSON.stringify(cs.beats) + '/' + cs.beatType + ' ' + k));
    /* the time signature at the first system's head says the meter */
    const digits = e.objects.filter(o => o.kind === 'timesig' && o.system === 0 && o.staffKey === p.staves[0].id).map(o => o.glyph);
    const want = [].concat(...(Array.isArray(cs.beats) ? cs.beats : [cs.beats]).map((b, i) => (i ? ['timeSigPlus'] : []).concat(String(b).split('').map(d => 'timeSig' + d))), String(cs.beatType).split('').map(d => 'timeSig' + d));
    assert.deepEqual(digits.slice().sort(), want.slice().sort());
  });
});

test('several voices, chords, accidentals and rests share columns: what sounds together is drawn together', () => {
  const g = piece({ beats: 4, bars: bars(2, [
    [['1/4', 'quarter', ['C5', 'E5', 'G5']], ['1/4', 'quarter', 'D5', { acc: 'sharp' }], ['1/2', 'half', ['C5', 'D5']]],
    [['1/8', 'eighth', 'A4'], ['1/8', 'eighth', 'r'], ['3/8', 'quarter', 'G4', { dots: 1 }], ['1/8', 'eighth', 'F4'], ['1/4', 'quarter', 'r']],
    [['1/2', 'half', 'C3'], ['1/4', 'quarter', 'r'], ['1/4', 'quarter', ['G2', 'D3']]]
  ]) });
  const { p, P, e } = layoutOf(g);
  const m0 = e.measures[0];
  assert.deepEqual(m0.columns.map(c => c.at), ['0', '1/8', '1/4', '1/2', '5/8', '3/4']);
  /* every event's objects hang from its column */
  p.events.filter(x => x.m === m0.id).forEach(ev => {
    const col = m0.columns.find(c => c.at === R.format(R.parse(ev.at)));
    e.objects.filter(o => o.event === ev.id && o.anchor).forEach(o => assert.equal(o.anchor[0], col.x, ev.id + ' ' + o.kind));
  });
  const m = l2(e, p, { prepared: P, layout: L });
  ZERO_L2.forEach(k => assert.equal(m[k], 0, k));
  assert.ok(e.objects.some(o => o.kind === 'dot'), 'the dotted quarter has its dot');
  assert.ok(e.objects.filter(o => o.kind === 'rest').length === 6, 'three rests a bar');
});

test('notes sit on the staff position their written pitch and clef give; stems point away from the middle; ledger lines where needed', () => {
  const g = piece({ beats: 4, bars: [{ voices: [[['1/4', 'quarter', 'B4'], ['1/4', 'quarter', 'C6'], ['1/4', 'quarter', 'C4'], ['1/4', 'quarter', 'F5']], [], [['1', 'whole', 'A3']]] }] });
  const { p, e } = layoutOf(g);
  const st = e.systems[0].staves;
  const heads = p.events.filter(x => x.heads.length).map(x => e.objects.find(o => o.id === x.heads[0].id));
  const pos = h => (h.box[1] + h.box[3]) / 2 - st.find(s => s.key === h.staffKey).y;
  /* treble: B4 the middle line (2), C6 on the second ledger line above (-2), C4 one ledger below (5), F5 the top line (0);
     bass: A3 the top line */
  assert.deepEqual(heads.map(h => Math.round(pos(h) * 100) / 100), [2, -2, 5, 0, 0]);
  const stem = id => e.objects.find(o => o.id === id + '#stem');
  const evs = p.events.filter(x => x.kind === 'note');
  assert.ok(stem(evs[0].id), 'B4 has a stem (down, on the middle line)');
  assert.ok(stem(evs[0].id).box[0] <= heads[0].box[0] + 0.01, 'B4 stem down, at the left');
  assert.ok(stem(evs[2].id).box[2] >= heads[2].box[2] - 0.01, 'C4 stem up, at the right');
  assert.equal(e.objects.filter(o => o.kind === 'ledger' && o.event === evs[1].id).length, 2, 'C6: two ledger lines (A5, C6)');
  assert.equal(e.objects.filter(o => o.kind === 'ledger' && o.event === evs[2].id).length, 1, 'C4: one ledger line');
  assert.equal(e.objects.filter(o => o.kind === 'stem' && o.event === evs[4].id).length, 0, 'a whole note has no stem');
  /* the positions under other clefs */
  assert.equal(L.yOf({ step: 'C', oct: 4 }, { sign: 'C', line: 3 }), 2, 'alto: middle C on the middle line');
  assert.equal(L.yOf({ step: 'C', oct: 4 }, { sign: 'C', line: 4 }), 1, 'tenor: middle C on the fourth line');
  assert.equal(L.yOf({ step: 'G', oct: 3 }, { sign: 'G', line: 2, octave: -1 }), 3, 'treble 8vb: G3 on the G line');
  assert.equal(L.yOf({ step: 'F', oct: 3 }, { sign: 'F', line: 4 }), 1, 'bass: F3 on the fourth line');
});

/* ------------------------------------------------------------------ line breaking (§15.2, G4-U4) */
test('G4-U4: four bars a desktop system and two a phone system are preferences - dense music takes fewer, sparse music more', () => {
  const normal = layoutOf(piece({ beats: 4, bars: bars(12, QUARTERS) }));
  assert.deepEqual(normal.e.systems.map(s => s.measures.length), [4, 4, 4]);
  const phone = L.layout(normal.P, { breakpoint: 'phone' });
  assert.deepEqual(phone.systems.map(s => s.measures.length), [2, 2, 2, 2, 2, 2]);
  const dense = layoutOf(piece({ beats: 4, bars: bars(12, SIXTEENTHS) }));
  assert.ok(dense.e.systems.every(s => s.measures.length < 4), 'dense: fewer than 4 - ' + dense.e.systems.map(s => s.measures.length));
  assert.ok(dense.e.systems.every(s => s.w <= 100 + 0.01), 'and never wider than the screen');
  const sparse = layoutOf(piece({ beats: 2, dur: '1/2', bars: bars(20, HALVES, '1/2') }));
  assert.ok(sparse.e.systems.slice(0, -1).every(s => s.measures.length > 4), 'sparse: more than 4 - ' + sparse.e.systems.map(s => s.measures.length));
  /* every system respects the width; the last one may be ragged */
  [normal.e, phone, dense.e, sparse.e].forEach(e => e.systems.forEach(s => assert.ok(s.w <= e.config.width + 0.01)));
});

test('a lone last measure is avoided where the measures allow; a one-bar system appears only when the width forces it', () => {
  [5, 9, 13].forEach(n => {
    const { p, P, e } = layoutOf(piece({ beats: 4, bars: bars(n, QUARTERS) }));
    assert.ok(e.systems[e.systems.length - 1].measures.length > 1, n + ' bars: ' + e.systems.map(s => s.measures.length));
    assert.equal(l2(e, p, { prepared: P, layout: L })['eg.systems.one_bar'], 0);
  });
  /* the breaker by itself: 5 equal bars, 20 sp each, N = 4, 100 sp - not 4 + 1 */
  const r = BR.breakLines(5, 4, 100, (i, j) => ({ minWidth: (j - i + 1) * 12, natural: (j - i + 1) * 20 }));
  assert.ok(r.systems[r.systems.length - 1][1] - r.systems[r.systems.length - 1][0] >= 1, JSON.stringify(r.systems));
  /* nothing fits two bars: one each, and nothing is called avoidable */
  const r1 = BR.breakLines(3, 2, 40, (i, j) => ({ minWidth: (j - i + 1) * 30, natural: (j - i + 1) * 32 }));
  assert.deepEqual(r1.systems, [[0, 0], [1, 1], [2, 2]]);
  /* one measure wider than the width: alone, and the layout says so */
  const r2 = BR.breakLines(3, 2, 40, (i, j) => ({ minWidth: i <= 1 && j >= 1 ? 90 : 10, natural: 20 }));
  assert.deepEqual(r2.systems.find(s => s[0] <= 1 && s[1] >= 1), [1, 1]);
  /* the same input, the same breaks */
  assert.deepEqual(BR.breakLines(7, 4, 100, (i, j) => ({ minWidth: (j - i + 1) * 15, natural: (j - i + 1) * 24 })),
    BR.breakLines(7, 4, 100, (i, j) => ({ minWidth: (j - i + 1) * 15, natural: (j - i + 1) * 24 })));
});

test('respectSourceBreaks: the source\'s system breaks are honoured only when asked (§15.5)', () => {
  const g = piece({ beats: 4, bars: bars(8, QUARTERS) });
  const m3 = g.timeline.measures[2].id;
  /* the same graph with a stated break before bar 3 */
  const json = JSON.parse(SG.serialize(g));
  json.timeline.measures[2].layout = { newSystem: true };
  const gb = SG.parse(JSON.stringify(json));
  const p = E.plan(gb, { respectSourceBreaks: true });
  const off = L.engrave(E.plan(gb), {});
  const on = L.engrave(p, { respectSourceBreaks: true });
  assert.ok(!off.systems.some(s => s.measures[0] === m3), 'not by default');
  assert.ok(on.systems.some(s => s.measures[0] === m3), 'when asked');
});

/* ------------------------------------------------------------------ staves, systems, heads (§15.3, §15.4) */
test('staff and system geometry: a braced grand staff with bar lines through it, staves by clearance, systems as bands', async () => {
  const p = await eplan('E37-long.musicxml');
  const e = L.engrave(p, {});
  const s1 = p.staves[0];
  assert.equal(p.staves.length, 2);
  e.systems.forEach((s, k) => {
    const a = s.staves[0], b = s.staves[1];
    assert.ok(b.y - a.y >= 4 + L.VGAP.inPart - 0.01, 'at least 5 sp between the grand staff\'s staves');
    assert.ok(s.x >= L.MARGIN.left + L.BRACE.w + L.BRACE.gap - 0.01);
    assert.ok(s.w <= 100 + 0.01);
    if (k) assert.ok(s.box[1] >= e.systems[k - 1].box[3] + L.VGAP.systemPad - 0.02, 'systems do not interleave');
    const brace = e.objects.filter(o => o.kind === 'brace' && o.system === k);
    assert.equal(brace.length, 1);
    assert.ok(brace[0].box[2] <= s.x && brace[0].box[1] === a.y && brace[0].box[3] === Math.round((b.y + 4) * 100) / 100);
    assert.ok(e.objects.some(o => o.id === 'd:sysbar:' + s.measures[0]), 'the opening line');
    /* a bar line of the upper staff runs down to the lower staff's top line */
    const bar = e.objects.find(o => o.kind === 'barline' && o.system === k && o.staffKey === s1.id && !o.glyph && o.measure === s.measures[0]);
    assert.equal(bar.box[3], b.y);
    assert.ok(e.objects.filter(o => o.system === k && o.kind === 'staff').length === 2);
  });
});

test('system heads, clef/key/time changes: a clef change at a bar line goes before it, small; courtesy key and time end a system', async () => {
  const e19 = L.engrave(await eplan('E19-clefs.musicxml'), {});
  /* (G4d-1b's longer E19 and E20: the IDs moved) the alto clef c18 starts bar 2, the clef inside bar 1 is c17 */
  const alto = e19.objects.find(o => o.id === 'c18');
  const bar = e19.objects.find(o => o.id === 'm7#bar.right:' + alto.staffKey + '#0');
  assert.ok(alto.scale < 1 && alto.box[2] < bar.box[0] - 0.1 && alto.measure === 'm7', 'the alto clef that starts bar 2 ends bar 1, before its bar line');
  assert.ok(e19.objects.find(o => o.id === 'c17').box[0] > e19.measures[0].columns[0].x, 'a clef inside a bar, before the notes it applies to');
  /* key change: A major to F major - three naturals and a flat, after the bar line (all six bars on one wide system) */
  const e20 = L.engrave(await eplan('E20-key-change.musicxml'), { width: 200, barsPerSystem: 6 });
  const ks = e20.objects.filter(o => o.kind === 'keysig' && o.measure === 'm11' && o.staffKey === e20.systems[0].staves[0].key);
  assert.deepEqual(ks.map(o => o.glyph), ['accidentalNatural', 'accidentalNatural', 'accidentalNatural', 'accidentalFlat']);
  assert.equal(e20.objects.filter(o => o.kind === 'keysig' && o.measure === null && o.system === 0).length, 6, 'the head: three sharps on each staff');
  /* when the change starts a system, the one before ends with it (courtesy), and the new system's head shows the new key */
  const narrow = L.engrave(await eplan('E20-key-change.musicxml'), {});
  assert.equal(narrow.systems[1].measures[0], 'm11');
  assert.equal(narrow.objects.filter(o => o.courtesy && o.kind === 'keysig').length, 8);
  assert.equal(narrow.objects.filter(o => o.kind === 'keysig' && o.system === 1 && o.measure === null).map(o => o.glyph).join(), 'accidentalFlat,accidentalFlat');
  /* meters: C and cut time are their symbols; a courtesy meter ends the system before a change */
  const e21 = L.engrave(await eplan('E21-meter.musicxml'), { breakpoint: 'phone' });
  assert.ok(e21.objects.some(o => o.glyph === 'timeSigCommon') && e21.objects.some(o => o.glyph === 'timeSigCutCommon'));
  assert.ok(e21.objects.some(o => o.courtesy && o.kind === 'timesig'));
});

test('repeats and voltas: a forward repeat after the head or in place of a plain bar line; one volta bracket per system it crosses', async () => {
  const p = await eplan('E22-repeats-jumps.musicxml');
  const e = L.engrave(p, {});
  const fwd = e.objects.filter(o => o.id.indexOf('#bar.left:') > 0);
  assert.ok(fwd.length > 0 && fwd.some(o => o.glyph === 'augmentationDot'));
  const voltas = e.objects.filter(o => o.kind === 'volta');
  assert.equal(voltas.length, p.endings.length);
  voltas.forEach(v => {
    assert.ok(v.box[3] <= e.systems[v.system].staves[0].y - 1, 'above the top staff');
    assert.ok(v.start && /\.$/.test(v.label));
  });
  /* across a system break the ending continues without a label */
  const narrow = L.engrave(p, { width: 25 });
  const byEnding = {};
  narrow.objects.filter(o => o.kind === 'volta').forEach(v => { (byEnding[v.refs[0]] = byEnding[v.refs[0]] || []).push(v); });
  Object.values(byEnding).forEach(list => { assert.equal(list.filter(v => v.start).length, 1); list.filter(v => !v.start).forEach(v => assert.equal(v.label, undefined)); });
});

/* ------------------------------------------------------------------ collisions (§10), overflow, coverage */
test('A17-A19, A23-A25: the E fixtures and every committed score lay out with no clip, overlap, rod, order or width violation', async () => {
  const items = [];
  for (const f of efix()) items.push(['e/' + f, await graphOf('tests/engrave/fixtures/e/' + f)]);
  (await corpusGraphs()).forEach(x => items.push(x));
  const bad = [];
  let n = 0, slope = 0, hits = 0, slurs = 0, tieEnd = 0;
  items.forEach(([id, g]) => {
    const p = E.plan(g);
    const P = L.prepare(p);
    ['desktop', 'phone'].forEach(bp => {
      const e = L.layout(P, { breakpoint: bp });
      const m = l2(e, p, { prepared: P, layout: L, graph: g });
      hits += m['eg.curve.hits']; slurs += m['eg.curve.slurs']; tieEnd = Math.max(tieEnd, m['eg.curve.endpoint_err_max']);
      /* every zero target l2.js computes, whatever this list names (a new metric cannot be left out by accident) */
      assert.deepEqual(zeroKeys(m), ZERO_L2.slice().sort());
      zeroKeys(m).forEach(k => { if (m[k]) bad.push(id + ' ' + bp + ' ' + k + ' ' + m[k]); });
      if (m['eg.system.overflow'] && !OVERFLOW_ALLOWED.has(id)) bad.push(id + ' ' + bp + ' overflow ' + m['eg.system.overflow']);
      slope = Math.max(slope, m['eg.beam.slope_max']);
      n++;
    });
  });
  assert.deepEqual(bad, []);
  assert.ok(n >= 2 * 380, n + ' layouts');
  /* A21: no beam steeper than 0.25 */
  assert.ok(slope <= 0.25 && slope > 0.1, 'the steepest beam ' + slope);
  /* A22: every tie within 0.5 sp of its heads; at most 1 % of the slurs cross a note between their ends (each diagnosed) */
  assert.ok(tieEnd <= 0.5, 'the farthest tie end ' + tieEnd);
  assert.ok(slurs > 5000 && hits / slurs <= 0.01, hits + ' of ' + slurs + ' slurs cross a note');
});

test('the collision check finds each hard violation it names (negative controls)', async () => {
  const e = L.engrave(await eplan('E33-accidental-chord.musicxml'), {});
  const base = SK.collisions(e.objects, e.pages[0], e.measures, e.systems);
  assert.deepEqual(base, []);
  const clone = () => JSON.parse(JSON.stringify(e));
  const moveOnto = (x, a, b) => { const A = x.objects.find(o => o.id === a), B = x.objects.find(o => o.id === b); A.box = B.box.slice(); return x; };
  const codes = x => SK.collisions(x.objects, x.pages[0], x.measures, x.systems).map(c => c.code);
  const ofKind = (x, k) => x.objects.filter(o => o.kind === k);
  /* H2: an accidental on a head */
  let x = clone();
  moveOnto(x, ofKind(x, 'accidental')[0].id, ofKind(x, 'notehead')[0].id);
  assert.ok(codes(x).indexOf('H2') >= 0);
  /* H1: two events' heads on one spot (E12: two voices) */
  const e12 = L.engrave(await eplan('E12-two-voices-heads.musicxml'), {});
  x = JSON.parse(JSON.stringify(e12));
  const hs = ofKind(x, 'notehead');
  const other = hs.find(h => h.event !== hs[0].event && h.staffKey === hs[0].staffKey);
  moveOnto(x, other.id, hs[0].id);
  assert.ok(codes(x).indexOf('H1') >= 0);
  /* H3: a dot on another note's head */
  const e36 = L.engrave(await eplan('E36-pickup-implicit.musicxml'), {});
  x = JSON.parse(JSON.stringify(e36));
  const dot = ofKind(x, 'dot')[0];
  assert.ok(dot, 'E36 has dotted notes');
  moveOnto(x, dot.id, ofKind(x, 'notehead').find(hd => hd.staffKey === dot.staffKey && hd.event !== dot.event).id);
  assert.ok(codes(x).indexOf('H3') >= 0);
  /* H4: outside the page; H8: a head outside its measure; H6: a head on the other staff */
  x = clone();
  x.objects[5].box = [-3, -3, -1, -1];
  assert.ok(codes(x).indexOf('H4') >= 0);
  x = clone();
  const h = ofKind(x, 'notehead')[0];
  const m = x.measures.find(mm => mm.id === h.measure);
  h.box = [m.x + m.w + 2, h.box[1], m.x + m.w + 3, h.box[3]];
  assert.ok(codes(x).indexOf('H8') >= 0);
  x = clone();
  const lower = x.systems[0].staves[1];
  const h2 = ofKind(x, 'notehead')[0];
  h2.box = [h2.box[0], lower.y + 1, h2.box[2], lower.y + 2];
  assert.ok(codes(x).indexOf('H6') >= 0);
  /* the L2 metrics count the same things, computed on their own */
  assert.ok(l2(x, E.plan(await graphOf('tests/engrave/fixtures/e/E33-accidental-chord.musicxml')), {})['eg.staff.overlap'] > 0);
});

test('the G4b fixer\'s L2 metrics find what they name (negative controls): other-voice rests and stems, the drawn multiset, justification, avoidable small staves', async () => {
  const p = await eplan('E13-two-voices-rests.musicxml');
  const e = L.engrave(p, {});
  const base = l2(e, p, {});
  ['eg.rest.overlap', 'eg.voice.stem_over_head', 'eg.layout.multiset_diff', 'eg.system.fill_err', 'eg.system.scaled_avoidable'].forEach(k => assert.equal(base[k], 0, k));
  const voice = new Map(p.events.map(x => [x.id, x.voice]));
  const clone = () => JSON.parse(JSON.stringify(e));
  const other = (x, a, kind) => x.objects.find(o => o.kind === kind && o.system === a.system && o.staffKey === a.staffKey && voice.get(o.event) !== voice.get(a.event));
  const m = x => l2(x, p, {});
  /* a rest on another voice's head */
  let x = clone();
  const rest = x.objects.find(o => o.kind === 'rest' && other(x, o, 'notehead'));
  assert.ok(rest, 'E13 has a rest beside another voice');
  rest.box = other(x, rest, 'notehead').box.slice();
  assert.ok(m(x)['eg.rest.overlap'] >= 1);
  /* a stem across another voice's head */
  x = clone();
  const stem = x.objects.find(o => o.kind === 'stem' && other(x, o, 'notehead'));
  const h = other(x, stem, 'notehead');
  stem.box = [h.box[0] + 0.3, h.box[1] - 1, h.box[0] + 0.42, h.box[3] + 1];
  assert.ok(m(x)['eg.voice.stem_over_head'] >= 1);
  /* the multiset: a rest twice under one id, a copy under a new id, a head on the other staff */
  x = clone();
  x.objects.push(JSON.parse(JSON.stringify(x.objects.find(o => o.kind === 'rest'))));
  assert.equal(m(x)['eg.layout.multiset_diff'], 1);
  x = clone();
  x.objects.push(Object.assign(JSON.parse(JSON.stringify(x.objects.find(o => o.kind === 'rest'))), { id: 'copy' }));
  assert.equal(m(x)['eg.layout.multiset_diff'], 1);
  x = clone();
  const hd = x.objects.find(o => o.kind === 'notehead');
  hd.staffKey = x.systems[0].staves.find(s => s.key !== hd.staffKey).key;
  assert.equal(m(x)['eg.layout.multiset_diff'], 2, 'missing where it belongs, extra where it is');
  /* justification: a justified system short of the width; a ragged system that is not the last */
  const long = L.engrave(await eplan('E37-long.musicxml'), {});
  const pl = await eplan('E37-long.musicxml');
  assert.equal(l2(long, pl, {})['eg.system.fill_err'], 0);
  x = JSON.parse(JSON.stringify(long));
  x.systems[0].w -= 5;
  assert.equal(l2(x, pl, {})['eg.system.fill_err'], 1);
  x = JSON.parse(JSON.stringify(long));
  x.systems[0].ragged = true;
  assert.equal(l2(x, pl, {})['eg.system.fill_err'], 1);
  /* a system of several measures at a smaller staff size could have been broken; one measure may be (G4-B5) */
  x = JSON.parse(JSON.stringify(long));
  x.systems[0].space = 0.8;
  assert.ok(x.systems[0].measures.length > 1);
  assert.equal(l2(x, pl, {})['eg.system.scaled_avoidable'], 1);
  x.systems[0].measures = x.systems[0].measures.slice(0, 1);
  assert.equal(l2(x, pl, {})['eg.system.scaled_avoidable'], 0);
});

test('zero gates (bench.js): G4b\'s two ratchets and every G4c metric are zero targets; the steepest beam is a limit; a baseline without a measured zero target fails', () => {
  const B = require('./tools/bench.js');
  ['eg.rest.overlap', 'eg.voice.stem_over_head'].concat(ZERO_L2).forEach(k => assert.ok(B.ZERO.indexOf(k) >= 0, k + ' is a zero target'));
  assert.equal(B.RATCHET, undefined, 'no ratchet is left');
  const base = { graphs: 1, 'eg.rest.overlap': 0, 'eg.voice.stem_over_head': 0, 'eg.beam.slope_max': 0.25 };
  const sum = v => Object.assign({ graphs: 1, 'eg.rest.overlap': 0, 'eg.voice.stem_over_head': 0, 'eg.beam.slope_max': 0.25 }, v);
  assert.deepEqual(B.compare(sum({}), base), []);
  assert.deepEqual(B.compare(sum({ 'eg.rest.overlap': 1 }), base), ['eg.rest.overlap = 1 (must be 0)', 'eg.rest.overlap 1 vs baseline 0']);
  assert.deepEqual(B.compare(sum({ 'eg.voice.stem_over_head': 2 }), base), ['eg.voice.stem_over_head = 2 (must be 0)', 'eg.voice.stem_over_head 2 vs baseline 0']);
  assert.deepEqual(B.compare(sum({ 'eg.beam.slope_max': 0.26 }), base), ['eg.beam.slope_max = 0.26 (must be <= 0.25)']);
  assert.ok(B.compare(sum({ 'eg.tuplet.missing': 0 }), base).some(s => /a zero-target metric the baseline does not record/.test(s)));
  /* every committed suite baseline records them, at 0 */
  ['r', 'e', 'x'].forEach(s => {
    const b = JSON.parse(fs.readFileSync(path.join(REPO, 'tests', 'engrave', 'baselines', s + '.l1.json'), 'utf8'));
    ZERO_L2.forEach(k => assert.equal(b[k], 0, s + ' ' + k));
    assert.ok(b['eg.beam.slope_max'] <= 0.25, s + ' slope');
  });
});

test('a measure wider than the screen is drawn at a smaller staff size, never clipped; beyond the floor it is an overflow and says so', async () => {
  const g = await graphOf('catalog/method/czerny849/005.mxl');
  const { p, P, e } = layoutOf(g, { breakpoint: 'phone' });
  const scaled = e.systems.filter(s => s.space < 1);
  assert.ok(scaled.length > 0);
  scaled.forEach(s => {
    assert.ok(s.w <= 40 + 0.01 && s.space >= 0.5);
    e.objects.filter(o => o.kind === 'staff' && o.system === s.index).forEach(o => assert.equal(o.space, s.space));
    assert.ok(e.diagnostics.some(d => d.code === 'SYSTEM_SCALED'));
  });
  const m = l2(e, p, { prepared: P, layout: L });
  ZERO_L2.forEach(k => assert.equal(m[k], 0, k));
  const bleak = layoutOf(await graphOf('catalog/hymns/in-the-bleak-midwinter.musicxml'));
  assert.ok(bleak.e.diagnostics.some(d => d.code === 'SYSTEM_OVERFLOW' && d.refs[0] === bleak.p.measures[bleak.p.measures.length - 1].id));
  assert.equal(bleak.p.measures[bleak.p.measures.length - 1].dur, '175/4', 'the source defect the allowance names');
});

test('coverage: what G4b places is counted, and what later stages draw is pending - nothing silently absent', async () => {
  const p = await eplan('E15-articulations.musicxml');
  const e = L.engrave(p, {});
  assert.ok(e.coverage.placed.notehead > 0 && e.coverage.placed.staff > 0);
  const arts = p.events.reduce((a, x) => a + (x.arts || []).length, 0);
  assert.ok(arts > 0);
  /* G4d-1a places articulations, fermatas, slurs (and ties, ornaments, fingering, glissandi, arpeggios): none is pending */
  /* each articulation one object; a detached-legato two (its tenuto over its staccato) */
  assert.equal(e.coverage.placed.articulation, arts + p.events.reduce((a, x) => a + (x.arts || []).filter(t => t === 'detached-legato').length, 0));
  assert.equal(e.coverage.placed.slur, p.slurs.length);
  ['articulation', 'ornament', 'fermata', 'fingering', 'tie', 'slur', 'gliss', 'arpeggio'].forEach(k => assert.equal(e.coverage.pending[k], undefined, k));
  /* G4d-1b places the marks attached to systems: nothing is pending any more - each dynamic, hairpin and word is drawn */
  const p16 = await eplan('E16-dynamics-hairpins.musicxml');
  const e16 = L.engrave(p16, {});
  assert.deepEqual(e16.coverage.pending, {});
  assert.ok(e16.coverage.placed.dynamic >= p16.marks.filter(m => m.kind === 'dynamic').length && e16.coverage.placed.hairpin >= 2 && e16.coverage.placed.words >= 1);
  const p1 = await eplan('E01-beams-basic.musicxml');
  const e1 = L.engrave(p1, {});
  /* G4c places beams, tuplets and grace stems: nothing of them is pending, and no stem is provisional any more */
  ['beam', 'tuplet', 'grace-stem', 'key-mid-measure'].forEach(k => assert.equal(e1.coverage.pending[k], undefined, k));
  assert.ok(e1.coverage.placed.beam >= p1.beams.length);
  const beamed = new Set(p1.beams.flatMap(b => b.events));
  assert.ok(e1.objects.filter(o => o.kind === 'flag').every(o => !beamed.has(o.event)));
  assert.ok(e1.objects.filter(o => o.kind === 'stem').every(o => !o.provisional && (o.dir === 'up' || o.dir === 'down')));
  assert.ok(e1.objects.filter(o => o.kind === 'stem' && beamed.has(o.event)).every(o => o.beam));
  /* hidden events and after-graces are not placed; a TAB staff (deferred) is not laid out */
  const p30 = await eplan('E30-hidden-cue.musicxml');
  const e30 = L.engrave(p30, {});
  p30.events.filter(x => x.hidden).forEach(x => assert.ok(!e30.objects.some(o => o.event === x.id), x.id));
  /* a hidden key draws no signature (§15.4); a shown one does, on both staves */
  const keyed = hidden => L.engrave(E.plan(piece({ beats: 4, fifths: 2, keyHidden: hidden, bars: bars(2, QUARTERS) })), {});
  assert.equal(keyed(false).objects.filter(o => o.kind === 'keysig').length, 4);
  assert.equal(keyed(true).objects.filter(o => o.kind === 'keysig').length, 0);
  /* a key change inside a measure (§15.4; pending in G4b): drawn where it happens, on every staff, cancelling the old key */
  const tkg = await graphOf('tests/scoregraph/fixtures/xml/tempo-meter-key-changes.musicxml');
  const tkp = E.plan(tkg);
  const tk = L.engrave(tkp, {});
  const mid = tkp.keys.find(k => k.at !== '0');
  assert.ok(mid, 'the fixture changes key inside a measure');
  assert.equal(tk.coverage.pending['key-mid-measure'], undefined);
  const kobj = tk.objects.filter(o => o.kind === 'keysig' && o.refs[0] === mid.id);
  assert.ok(kobj.length >= Math.abs(mid.fifths) && kobj.every(o => o.measure === mid.m), 'the change is in its measure: ' + kobj.length);
  const col = tk.measures.find(m => m.id === mid.m).columns.find(c => !c.time && c.at === mid.at);
  assert.ok(col && kobj.every(o => o.box[0] >= col.x - 0.01), 'at its own column, before the notes of its time');
  assert.equal(l2(tk, tkp, { graph: tkg })['eg.layout.signature_diff'], 0);
  /* the slash notehead is a shape VexFlow draws, not a fallback */
  const e31 = L.engrave(await eplan('E31-noteheads.musicxml'), {});
  assert.ok(!e31.diagnostics.some(d => d.code === 'GLYPH_FALLBACK'));
  assert.ok(e31.objects.some(o => o.drawn && o.glyph === 'noteheadSlashHorizontalEnds'));
});

/* ------------------------------------------------------------------ reflow (§16.5) */
test('reflow: desktop -> phone -> desktop gives the same EngravedScore back from the cache; ids do not depend on the width', async () => {
  const p = await eplan('E37-long.musicxml');
  const eng = L.createEngraver(p);
  const before = L.counters.prepare;
  const d1 = eng.layout({ breakpoint: 'desktop' }), ph = eng.layout({ breakpoint: 'phone' }), d2 = eng.layout({ breakpoint: 'desktop' });
  assert.equal(d1, d2, 'the cached layout');
  assert.deepEqual(eng.stats, { layouts: 2, hits: 1 });
  assert.equal(L.counters.prepare, before, 'the plan is prepared once, not per width');
  assert.equal(CN.hash(d1), CN.hash(L.engrave(p, { breakpoint: 'desktop' })));
  assert.notEqual(d1.systems.length, ph.systems.length);
  /* every note-level object keeps its id at every width */
  const noteIds = x => x.objects.filter(o => o.event).map(o => o.id).sort();
  assert.deepEqual(noteIds(d1), noteIds(ph));
  assert.deepEqual(noteIds(d1), noteIds(eng.layout({ width: 63 })));
  /* screen configs: the breakpoint at 720 px, zoom as a width change */
  assert.deepEqual(L.screenConfig(1280), L.normalizeConfig({ breakpoint: 'desktop' }));
  assert.deepEqual(L.screenConfig(390), L.normalizeConfig({ breakpoint: 'phone' }));
  assert.equal(L.screenConfig(720).breakpoint, 'phone');
  assert.equal(L.screenConfig(1280, 1.25).width, 80);
  /* the cache holds eight configs, least recently used out */
  for (let w = 50; w < 60; w++) eng.layout({ width: w });
  const s = eng.stats.layouts;
  eng.layout({ width: 59 });
  assert.equal(eng.stats.layouts, s, 'recent: a hit');
  eng.layout({ breakpoint: 'phone' });
  assert.equal(eng.stats.layouts, s + 1, 'evicted: laid out again');
});

test('the index exports the layout core in Node; the app does not load it yet (legacy stays the renderer)', () => {
  assert.equal(typeof E.engrave, 'function');
  assert.equal(E.layout.VERSION, 'engr/5');
  assert.equal(typeof E.practice.createPracticeMap, 'function');
  assert.equal(typeof E.layoutHash, 'function');
  const html = fs.readFileSync(path.join(REPO, 'Piano Coach App.dc.html'), 'utf8');
  ['metrics', 'metrics-text', 'space', 'breaks', 'skyline', 'canon', 'notation', 'curves', 'marks', 'sysmarks', 'layout', 'practice', 'outlines', 'svg'].forEach(n => assert.doesNotMatch(html, new RegExp('engrave/' + n + '\\.js')));
});
