/* G4b - the layout core: NotationPlan -> EngravedScore (docs/GOALS/G04 §8.4, §9, §10, §15, §20, §21.2; A14, A17-A19,
   A23-A25, A27, A29). Node only, no DOM: the layout is pure and reads glyph sizes from engrave/metrics.js.
   The practice map and the highlighter are practice.test.js; the geometry metrics are l2.js (shared with bench.js). */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { REPO, SG, E, corpusGraphs, graphOf } = require('./helpers.js');
const { l2 } = require('./l2.js');
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
const ZERO_L2 = ['eg.clip.count', 'eg.overlap.head_head', 'eg.overlap.acc', 'eg.overlap.dot', 'eg.staff.overlap', 'eg.system.overlap',
  'eg.spacing.rod_violations', 'eg.spacing.monotonic_violations', 'eg.column.order_violations', 'eg.layout.event_missing',
  'eg.layout.event_unknown', 'eg.layout.head_missing', 'eg.layout.head_staff_wrong', 'eg.systems.one_bar', 'eg.layout.hard_violations',
  'eg.glyph.fallback'];

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
  const bad = HASHES.diff(await HASHES.compute('reverse'), want.hashes);
  assert.deepEqual(bad, [], 'tests/engrave/tools/layout-hashes.js --write after an intended layout change');
  assert.ok(Object.keys(want.hashes).length >= 118);
});

test('A29: the layout modules measure no DOM, read no clock, draw no random number and load no VexFlow', () => {
  ['metrics', 'space', 'breaks', 'skyline', 'canon', 'layout', 'practice'].forEach(n => {
    const src = fs.readFileSync(path.join(REPO, 'engrave', n + '.js'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    /* the browser globals (a property named window - the close view's config - is not one) */
    assert.doesNotMatch(src, /(?<![.\w])(document|window)\b(?!\s*:)|getBBox|getBoundingClientRect|getComputedStyle|measureText|\bDate\b|performance\.now|Math\.random|vexflow|\bfetch\b|XMLHttpRequest/,
      'engrave/' + n + '.js');
    /* the check itself sees a global */
    assert.match('const w = window.innerWidth;', /(?<![.\w])(document|window)\b(?!\s*:)/);
  });
  /* the metrics table is exactly the pinned font's (CI runs the same check) */
  const out = execFileSync(process.execPath, [path.join(REPO, 'tests', 'engrave', 'tools', 'make-metrics.js'), '--check'], { encoding: 'utf8' });
  assert.match(out, /holds the pinned font's metrics/);
});

/* ------------------------------------------------------------------ the EngravedScore */
test('the EngravedScore: staff-space coordinates to 0.01, every object keyed to plan or graph ids, unique ids, plain data', async () => {
  const p = await eplan('E35-voice-and-piano.musicxml');
  const e = L.engrave(p, {});
  assert.equal(e.version, 'engr/1');
  assert.equal(e.planKey, p.graph.fingerprint + ':' + p.version);
  assert.deepEqual(e.config, { mode: 'screen', breakpoint: 'desktop', width: 100, barsPerSystem: 4, respectSourceBreaks: false, window: null });
  assert.deepEqual(Object.keys(e).sort(), ['config', 'coverage', 'curves', 'diagnostics', 'measures', 'objects', 'pages', 'planKey', 'systems', 'version']);
  assert.deepEqual(e.curves, [], 'curves are G4d');
  const ids = new Set();
  const planIds = new Set([].concat(p.events.map(x => x.id), p.events.flatMap(x => x.heads.map(h => h.id)), p.measures.map(x => x.id),
    p.clefs.map(x => x.id), p.keys.map(x => x.id), p.meters.map(x => x.id), p.staves.map(x => x.id), p.parts.map(x => x.id), p.endings.map(x => x.id)));
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
  const unison = colOf({ beats: 1, dur: '1/4', bars: [{ voices: [[['1/4', 'quarter', 'C5', { stem: 'up' }]], [['1/4', 'quarter', 'C5', { stem: 'down' }]]] }] }).cols[0];
  assert.ok(w(unison) > 2 * MT.glyph('noteheadBlack').w - 1e-9, 'two voices on one pitch stand side by side');
  const rest = colOf({ beats: 1, dur: '1/4', bars: [{ voices: [[['1/4', 'quarter', 'r']]] }] }).cols[0];
  assert.ok(Math.abs(w(rest) - MT.glyph('restQuarter').w) < 1e-9, 'a rest: its glyph');
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
  const c15 = e19.objects.find(o => o.id === 'c15');
  const bar = e19.objects.find(o => o.id === 'm7#bar.right:' + c15.staffKey + '#0');
  assert.ok(c15.scale < 1 && c15.box[2] < bar.box[0] - 0.1 && c15.measure === 'm7', 'the alto clef that starts bar 2 ends bar 1, before its bar line');
  assert.ok(e19.objects.find(o => o.id === 'c14').box[0] > e19.measures[0].columns[0].x, 'a clef inside a bar, before the notes it applies to');
  /* key change: A major to F major - three naturals and a flat, after the bar line */
  const e20 = L.engrave(await eplan('E20-key-change.musicxml'), {});
  const ks = e20.objects.filter(o => o.kind === 'keysig' && o.measure === 'm9' && o.staffKey === e20.systems[0].staves[0].key);
  assert.deepEqual(ks.map(o => o.glyph), ['accidentalNatural', 'accidentalNatural', 'accidentalNatural', 'accidentalFlat']);
  assert.equal(e20.objects.filter(o => o.kind === 'keysig' && o.measure === null && o.system === 0).length, 6, 'the head: three sharps on each staff');
  /* when the change starts a system, the one before ends with it (courtesy), and the new system's head shows the new key */
  const narrow = L.engrave(await eplan('E20-key-change.musicxml'), { width: 30 });
  assert.equal(narrow.systems[1].measures[0], 'm9');
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
  let n = 0;
  items.forEach(([id, g]) => {
    const p = E.plan(g);
    const P = L.prepare(p);
    ['desktop', 'phone'].forEach(bp => {
      const e = L.layout(P, { breakpoint: bp });
      const m = l2(e, p, { prepared: P, layout: L });
      ZERO_L2.forEach(k => { if (m[k]) bad.push(id + ' ' + bp + ' ' + k + ' ' + m[k]); });
      if (m['eg.system.overflow'] && !OVERFLOW_ALLOWED.has(id)) bad.push(id + ' ' + bp + ' overflow ' + m['eg.system.overflow']);
      n++;
    });
  });
  assert.deepEqual(bad, []);
  assert.ok(n >= 2 * 380, n + ' layouts');
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
  assert.equal(e.coverage.pending.articulation, arts);
  const p1 = await eplan('E01-beams-basic.musicxml');
  const e1 = L.engrave(p1, {});
  assert.equal(e1.coverage.pending.beam, p1.beams.length);
  /* beamed notes get provisional stems and no flags until G4c */
  const beamed = new Set(p1.beams.flatMap(b => b.events));
  assert.ok(e1.objects.filter(o => o.kind === 'flag').every(o => !beamed.has(o.event)));
  assert.ok(e1.objects.filter(o => o.kind === 'stem').every(o => o.provisional));
  /* hidden events and after-graces are not placed; a TAB staff (deferred) is not laid out */
  const p30 = await eplan('E30-hidden-cue.musicxml');
  const e30 = L.engrave(p30, {});
  p30.events.filter(x => x.hidden).forEach(x => assert.ok(!e30.objects.some(o => o.event === x.id), x.id));
  /* a hidden key draws no signature (§15.4); a shown one does, on both staves */
  const keyed = hidden => L.engrave(E.plan(piece({ beats: 4, fifths: 2, keyHidden: hidden, bars: bars(2, QUARTERS) })), {});
  assert.equal(keyed(false).objects.filter(o => o.kind === 'keysig').length, 4);
  assert.equal(keyed(true).objects.filter(o => o.kind === 'keysig').length, 0);
  /* a key change inside a measure is not placed yet: it is pending, not dropped */
  const tk = L.engrave(E.plan(await graphOf('tests/scoregraph/fixtures/xml/tempo-meter-key-changes.musicxml')), {});
  assert.equal(tk.coverage.pending['key-mid-measure'], 1);
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
  assert.equal(E.layout.VERSION, 'engr/1');
  assert.equal(typeof E.practice.createPracticeMap, 'function');
  assert.equal(typeof E.layoutHash, 'function');
  const html = fs.readFileSync(path.join(REPO, 'Piano Coach App.dc.html'), 'utf8');
  ['metrics', 'space', 'breaks', 'skyline', 'canon', 'layout', 'practice'].forEach(n => assert.doesNotMatch(html, new RegExp('engrave/' + n + '\\.js')));
});
