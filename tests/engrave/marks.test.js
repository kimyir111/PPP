/* G4d-1a - curves and marks attached to notes (docs/GOALS/G04 §10, §13, §18.3; A5-A7, A12 percussion, A20, A22), the text
   metrics table, the one placement function, and the G4c review's carry-overs: ledger lines for rests off the staff, tuplet
   numbers by their beams, the version names. Node only. The metrics are tests/engrave/l2.js (shared with bench.js and the
   mutation test); here each rule is shown on the fixture made for it, and each new metric is shown to find the defect it
   names (negative controls on real layouts). */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { REPO, SG, E, graphOf, goldenGraphs } = require('./helpers.js');
const { l2, MAXIMA, RECORDED, bulge, sampleBoxes } = require('./l2.js');

const L = E.layout;
const SK = require(path.join(REPO, 'engrave', 'skyline.js'));
const CV = require(path.join(REPO, 'engrave', 'curves.js'));
const MK = require(path.join(REPO, 'engrave', 'marks.js'));
const TX = require(path.join(REPO, 'engrave', 'metrics-text.js'));
const TM = require('./tools/make-text-metrics.js');
const efile = k => 'tests/engrave/fixtures/e/' + fs.readdirSync(path.join(REPO, 'tests', 'engrave', 'fixtures', 'e')).find(f => f.startsWith(k + '-'));
async function lay(k, cfg) {
  const g = typeof k === 'object' ? k : await graphOf(k.indexOf('/') >= 0 ? k : efile(k));
  const p = E.plan(g);
  const P = L.prepare(p);
  const e = L.layout(P, cfg || {});
  return { g, p, P, e, m: l2(e, p, { prepared: P, layout: L, graph: g }) };
}
const NOT_ZERO = Object.keys(MAXIMA).concat(RECORDED, ['eg.system.overflow']);
const zeroes = m => Object.keys(m).filter(k => NOT_ZERO.indexOf(k) < 0 && m[k]).map(k => k + '=' + m[k]);
const cy = b => (b[1] + b[3]) / 2, cx = b => (b[0] + b[2]) / 2;
const clone = x => JSON.parse(JSON.stringify(x.e));
const metric = (x, e, k) => l2(e, x.p, { graph: x.g })[k];

/* ------------------------------------------------------------------ §18.3 text metrics */
test('§18.3: the text widths are a table made from the page\'s fonts - five faces, the checked form and digest, no font file in the repository', () => {
  assert.deepEqual(TX.roles(), ['serif', 'serif-italic', 'sans', 'sans-bold', 'mono']);
  TM.FACES.forEach(f => {
    const d = TX.FACES[f.role];
    assert.equal(d.family, f.family);
    assert.equal(d.sha256, f.sha256, f.role + ': made from the pinned file');
    assert.ok(d.capHeight > 0 && d.descender > 0 && d.upm > 0);
    '0123456789ABCXYZabcxyz-.,'.split('').forEach(ch => assert.ok(String(ch.charCodeAt(0)) in d.widths, f.role + ' ' + ch));
  });
  /* the generated block is in the tool's own form, and its digest is its content's: a width edited by hand is caught */
  const cur = TM.current();
  assert.equal(TM.render(cur.data), cur.block);
  const edited = JSON.parse(JSON.stringify(cur.data));
  edited.sans.widths['49'] += 1;
  assert.notEqual(TM.render(edited), cur.block);
  const out = execFileSync(process.execPath, [path.join(REPO, 'tests', 'engrave', 'tools', 'make-text-metrics.js'), '--check'], { encoding: 'utf8' });
  assert.match(out, /PASS - form and digest checked/);
  /* only the table is committed (§18.3): no font binary is tracked */
  const tracked = execFileSync('git', ['ls-files'], { cwd: REPO, encoding: 'utf8' }).split('\n');
  assert.deepEqual(tracked.filter(f => /\.(ttf|otf|woff2?)$/i.test(f)), []);
});

test('§18.3: a width is the sum of the table\'s advances at the size in sp; a character the face lacks is 0.6 em and named', () => {
  const m = TX.measure('3', 'sans', 1.4);
  assert.equal(m.w, TX.FACES.sans.widths['51'] / 1000 * 1.4);
  assert.equal(m.top, -TX.FACES.sans.capHeight / 1000 * 1.4);
  assert.equal(m.bottom, 0);
  const two = TX.measure('35', 'sans', 1.4);
  assert.ok(Math.abs(two.w - (TX.FACES.sans.widths['51'] + TX.FACES.sans.widths['53']) / 1000 * 1.4) < 1e-12);
  assert.ok(TX.measure('gliss.', 'serif-italic', 1.2).bottom > 0, 'a descender below the baseline');
  const miss = TX.measure('♯', 'sans', 1.4);
  assert.deepEqual(miss.missing, [0x266f]);
  assert.ok(Math.abs(miss.w - TX.MISSING_EM * 1.4) < 1e-12);
  assert.throws(() => TX.measure('1', 'cursive', 1), /no face/);
});

test('§18.3: fingering is set in the table\'s widths at 1.4 sp; a finger the face cannot draw is 0.6 em and says TEXT_GLYPH_MISSING', async () => {
  const x = await lay('E23');
  const fs1 = x.e.objects.filter(o => o.kind === 'fingering');
  assert.ok(fs1.length >= 7);
  fs1.forEach(o => {
    assert.equal(o.font, 'sans');
    assert.equal(o.size, 1.4);
    assert.ok(Math.abs((o.box[2] - o.box[0]) - TX.measure(o.text, 'sans', 1.4).w) <= 0.011, o.id);
    assert.ok(Math.abs(o.origin[1] - (o.box[1] + TX.FACES.sans.capHeight / 1000 * 1.4)) <= 0.011, 'the baseline under the cap height');
  });
  const g = JSON.parse(JSON.stringify(x.g));
  const h = g.parts[0].events.find(e => e.heads && e.heads.some(q => q.fingering)).heads.find(q => q.fingering);
  h.fingering[0].f = '♯';
  const y = await lay(SG.parse(JSON.stringify(g)));
  assert.ok(y.e.diagnostics.some(d => d.code === 'TEXT_GLYPH_MISSING'));
  assert.equal(y.m['eg.text.missing_glyph'], 1);
});

/* ------------------------------------------------------------------ §10.1 the placement function */
test('§10.1: place() sets an item outside what the skyline holds there, a pad away, never inside its limit, and adds it', () => {
  const s = new SK.Skyline(0, 20);
  const r2 = b => b.map(v => Math.round(v * 100) / 100);
  s.add([2, 1, 4, 3]);
  assert.deepEqual(r2(s.put({ x0: 2, x1: 3, h: 0.5, side: 'above', pad: 0.3, limit: null, floor: 3 })), [2, 0.2, 3, 0.7]);
  assert.deepEqual(r2(s.put({ x0: 2, x1: 3, h: 0.5, side: 'above', pad: 0.3, limit: 0, floor: 3 })), [2, -0.8, 3, -0.3], 'outside the staff, and outside the first');
  assert.deepEqual(r2(s.put({ x0: 10, x1: 11, h: 1, side: 'below', pad: 0.5, limit: 4, floor: 2 })), [10, 4.5, 11, 5.5], 'nothing there: from the staff edge');
  assert.deepEqual(r2(s.put({ x0: 12, x1: 13, h: 1, side: 'below', pad: 0.5, limit: null, floor: 2 })), [12, 2.5, 13, 3.5], 'no limit: from its note');
  assert.throws(() => s.put({ x0: 15, x1: 16, h: 1, side: 'above', pad: 0.5, limit: null, floor: null }), /no limit and no floor/);
  /* the old positional form is the same function (a volta) */
  assert.deepEqual(r2(s.place(2, 3, 1, 'above', 0.2, 0)), [2, -2, 3, -1]);
  /* §10.5: on a staff's skyline, an item set more than 8 sp from the staff is placed all the same and put() says so, naming it */
  const far = [];
  const t = new SK.Skyline(0, 20, { edges: [0, 4], far: SK.FAR, diag: d => far.push(d) });
  t.add([5, -8.5, 6, -7.5]);
  assert.deepEqual(r2(t.put({ ref: 'near', x0: 1, x1: 2, h: 1, side: 'above', pad: 0.3, limit: 0 })), [1, -1.3, 2, -0.3]);
  assert.deepEqual(r2(t.put({ ref: 'high', x0: 5, x1: 6, h: 1, side: 'above', pad: 0.3, limit: 0 })), [5, -9.8, 6, -8.8]);
  assert.deepEqual(r2(t.put({ ref: 'low', x0: 9, x1: 10, h: 1, side: 'below', pad: 0.3, limit: 4, floor: 12 })), [9, 12.3, 10, 13.3]);
  assert.deepEqual(far.map(d => [d.code, d.refs[0]]), [['FAR_PLACEMENT', 'high'], ['FAR_PLACEMENT', 'low']]);
  assert.equal(SK.FAR, 8);
  /* a mark inside the staff keeps to a space: its centre moves outward to the nearest space centre */
  const snap = MK.spaceSnap('above', 4);
  assert.deepEqual(r2(snap([0, 1.8, 1, 2.2])), [0, 1.3, 1, 1.7]);
  assert.deepEqual(r2(snap([0, -1.2, 1, -0.8])), [0, -1.2, 1, -0.8], 'outside the staff it stays');
  assert.deepEqual(r2(MK.spaceSnap('below', 4)([0, 1.8, 1, 2.2])), [0, 2.3, 1, 2.7]);
});

/* ------------------------------------------------------------------ §13 curves */
test('§13: a curve bows 4h·t(1-t) off its chord; ties 0.5-1.2 sp by length; a slur clears what lies under it, raising its control points or moving its ends out', () => {
  const c = CV.arc([0, 0], [6, 0], 1, 'above');
  assert.ok(Math.abs(CV.yAt(c, 3) + 1) < 1e-9 && Math.abs(CV.yAt(c, 1.5) + 0.75) < 1e-9);
  assert.equal(CV.tieHeight(1), 0.5);
  assert.equal(CV.tieHeight(20), 1.2);
  assert.ok(CV.tieHeight(4) > 0.5 && CV.tieHeight(4) < 1.2);
  assert.equal(CV.slurHeight(2), 0.75);
  assert.equal(CV.slurHeight(40), 3);
  /* nothing under it: the default height */
  const a = CV.slur([0, 0], [10, 0], 'above', []);
  assert.ok(!a.collides && Math.abs(a.curve.h - 1) < 1e-9);
  /* a note near one end (x 7.5 reaching y -1.5): that control point rises, the curve clears it by 0.25 + half its thickness */
  const b = CV.slur([0, 0], [10, 0], 'above', [[7.25, 7.75, -1.5]]);
  assert.ok(!b.collides);
  assert.ok(b.curve.c2[1] < b.curve.c1[1], 'the control point nearer the obstacle is lifted more');
  assert.ok(CV.yAt(b.curve, 7.5) <= -1.5 - CV.SLUR.clear - CV.SLUR.thick / 2 + 1e-6);
  /* too high for any arc: the ends move out 0.5 sp at a time, then it is drawn anyway and says so */
  const d = CV.slur([0, 0], [10, 0], 'above', [[4.75, 5.25, -12]]);
  assert.ok(d.collides && d.lift === CV.SLUR.tries * CV.SLUR.move);
  const e = CV.slur([0, 0], [10, 0], 'above', [[4.75, 5.25, -4]]);
  assert.ok(!e.collides && e.lift > 0 && e.curve.p0[1] === -e.lift, 'moved out, then cleared');
  /* G4-L5: a finger by an end (a hard cell) is never crossed, up to the end - the end zone does not excuse it */
  const soft = CV.slur([0, 0], [6, -4], 'above', [[5.6, 5.9, -3.9]]);
  assert.ok(CV.yAt(soft.curve, 5.6) + CV.SLUR.thick / 2 > -3.9, 'in the end zone an ordinary cell is the end note\'s own: the curve goes through it');
  const hard = CV.slur([0, 0], [6, -4], 'above', [[5.6, 5.9, -3.9, true]]);
  assert.ok(!hard.collides && [5.6, 5.75, 5.9].every(x => CV.yAt(hard.curve, x) <= -3.9 - CV.SLUR.thick / 2 - CV.SLUR.touch + 1e-6), 'the curve passes over the finger');
  /* a long slur whose notes by its end stand high: past TRIES moves together, one end moves further than the other */
  const long = CV.slur([0, 0], [40, 0], 'above', [[37.75, 38.25, -5]]);
  assert.ok(!long.collides && long.curve.p3[1] < long.curve.p0[1] && long.lift > CV.SLUR.tries * CV.SLUR.move, 'the end by the high notes moved out further');
  /* samples: one box per 0.5 sp of run, covering the line */
  const bs = CV.samples(c, 0.2);
  assert.equal(bs.length, 12);
  assert.ok(bs.every(b0 => b0[2] - b0[0] <= 0.5 + 1e-9));
});

test('A5: every tie is drawn - a chord\'s partial tie, over bar lines, across a system break as two halves, from a voice to another, PPP\'s inferred ties inside a bar (G4-U2 A)', async () => {
  const x8 = await lay('E08');
  assert.equal(x8.e.curves.filter(c => c.kind === 'tie').length, 12, 'E08: the E of the first chord, then whole chords of four, three and three, and one into a chord');
  const t8 = x8.e.curves.find(c => c.refs[0] === x8.p.ties[0].id);
  assert.deepEqual(t8.heads, [x8.p.ties[0].from, x8.p.ties[0].to]);
  /* §16.4: PPP's own curve, with VexFlow's class */
  assert.match(E.svg(x8.e, x8.p), new RegExp('<path class="vf-stavetie ppp-tie" data-tie="' + t8.refs[0] + '" d="M[^"]+Z"/>'));
  for (const bp of ['desktop', 'phone']) {
    const x9 = await lay('E09', { breakpoint: bp });
    assert.ok(x9.e.systems.length > 1, 'E09 breaks at ' + bp);
    const parts = x9.p.ties.map(t => x9.e.curves.filter(c => c.refs[0] === t.id).map(c => c.part).sort().join());
    assert.ok(parts.some(p => p === 'end,start'), bp + ': a tie in two halves');
    parts.forEach(p => assert.ok(p === 'whole' || p === 'end,start', p));
    const half = x9.e.curves.find(c => c.part === 'start');
    const sys = x9.e.systems[half.system];
    assert.ok(Math.abs(half.p3[0] - (sys.x + sys.w)) < 0.02, 'the first half runs to the system\'s end');
    assert.deepEqual(zeroes(x9.m), []);
  }
  /* a tie from one voice to another (sonatina/024) joins the two heads directly */
  const x24 = await lay('catalog/method/sonatina/024.mxl');
  const ev = new Map(x24.p.events.flatMap(e => e.heads.map(h => [h.id, e])));
  const vc = x24.p.ties.filter(t => t.from && t.to && ev.get(t.from).voice !== ev.get(t.to).voice);
  assert.ok(vc.length >= 1);
  vc.forEach(t => assert.ok(x24.e.curves.some(c => c.refs[0] === t.id), t.id));
  assert.equal(x24.m['eg.tie.missing'], 0);
  /* inferred ties inside a bar (a transcription, G3 off) are drawn */
  const g16 = goldenGraphs().find(([k]) => k === 'golden/G16.sg.json')[1];
  const x16 = await lay(g16);
  const inferred = x16.p.ties.filter(t => t.inferred);
  assert.equal(inferred.length, 3);
  inferred.forEach(t => assert.ok(x16.e.curves.some(c => c.refs[0] === t.id)));
  /* G4-L4 on E08, at both widths: a chord's ties by each head's place in its chord (the outer ones away from it, the upper half up,
     the lower half down, an odd chord's middle away from the stem); each end nearer its own head than any other head of the chord -
     the second's displaced head too; the dotted chord's ties after the dots; the tie into the chord with a sharp clears the sharp */
  for (const bp of ['desktop', 'phone']) {
    const x = await lay('E08', { breakpoint: bp });
    assert.deepEqual(zeroes(x.m), [], bp);
    const byEv = new Map();
    x.e.curves.filter(c => c.kind === 'tie').forEach(c => {
      const h = x.e.objects.find(o => o.id === c.heads[0]);
      if (!byEv.has(h.event)) byEv.set(h.event, []);
      byEv.get(h.event).push({ c, h });
    });
    const chords = [...byEv.values()].filter(l => l.length > 1).map(l => l.sort((a, b) => cy(a.h.box) - cy(b.h.box)).map(({ c, h }) => {
      const st = x.e.objects.find(o => o.id === h.event + '#stem');
      return bulge(c) + (st ? ':' + st.dir : '');
    }).join(' '));
    assert.deepEqual(chords, ['above:down above:down below:down below:down', 'above:up below:up below:up', 'above:down above:down below:down'], bp);
    const dotted = [...byEv.values()].find(l => l.length === 3 && x.e.objects.some(o => o.kind === 'dot' && o.event === l[0].h.event));
    const dots = x.e.objects.filter(o => o.kind === 'dot' && o.event === dotted[0].h.event);
    dotted.forEach(({ c }) => assert.ok(sampleBoxes(c).every(b => dots.every(d => b[3] <= d.box[1] + 0.01 || b[1] >= d.box[3] - 0.01 || b[2] <= d.box[0] + 0.01 ||
      b[0] >= d.box[2] - 0.01)), c.id + ': clear of the dots - after them where they stand at its height'));
    assert.ok(dotted.some(({ c }) => c.p0[0] >= Math.max(...dots.map(o => o.box[2]))), 'a tie at a dot\'s height starts after it');
    const sharp = x.e.objects.find(o => o.kind === 'accidental' && o.glyph === 'accidentalSharp' && x.p.ties.some(t => {
      const to = x.e.objects.find(q => q.id === t.to);
      return to && to.event === o.event;
    }));
    const into = x.e.curves.find(c => c.kind === 'tie' && x.e.objects.find(o => o.id === c.heads[1]).event === sharp.event);
    assert.ok(sampleBoxes(into).every(b => b[3] <= sharp.box[1] + 0.01 || b[1] >= sharp.box[3] - 0.01 || b[2] <= sharp.box[0] + 0.01 || b[0] >= sharp.box[2] - 0.01),
      bp + ': the tie into the chord passes the sharp');
  }
  /* §13.1 direction: a single note's tie away from its stem; ends 0.2 sp from the head's centre, off its edge */
  const x9 = await lay('E09');
  x9.e.curves.filter(c => c.kind === 'tie' && c.part === 'whole').forEach(c => {
    const h = x9.e.objects.find(o => o.id === c.heads[0]), st = x9.e.objects.find(o => o.id === h.event + '#stem');
    assert.equal(bulge(c), st.dir === 'up' ? 'below' : 'above', c.id);
    assert.ok(Math.abs(c.p0[0] - (cx(h.box) + CV.TIE.outerDx)) < 0.02);
  });
});

test('A6: every slur between its own notes - overlapping slurs, a slur over a rest, halves at a system break, the graph\'s placement, a dashed line', async () => {
  const x10 = await lay('E10');
  const at = id => x10.e.objects.filter(o => o.event === id && o.kind === 'notehead').map(o => o.box)[0];
  x10.p.slurs.forEach(s => {
    const c = x10.e.curves.find(q => q.refs[0] === s.id);
    assert.ok(c.p0[0] >= at(s.from)[0] - 0.01 && c.p0[0] <= at(s.from)[2] + 0.01, s.id + ' starts at its note');
    assert.ok(c.p3[0] >= at(s.to)[0] - 0.01 && c.p3[0] <= at(s.to)[2] + 0.01, s.id + ' ends at its note');
    assert.deepEqual(c.events, [s.from, s.to]);
  });
  /* §13.2's side (the review's RV20): bar 2's slur over stems all up - below; bar 3's two voices - the upper voice's above, the
     lower voice's below, whatever their stems */
  const sideOf = s => bulge(x10.e.curves.find(q => q.refs[0] === s.id));
  const inBar = (s, k) => x10.p.events.find(e => e.id === s.from).m === x10.p.measures[k].id;
  assert.deepEqual(x10.p.slurs.filter(s => inBar(s, 1)).map(sideOf), ['below']);
  const two = x10.p.slurs.filter(s => inBar(s, 2));
  assert.deepEqual(two.map(s => x10.e.objects.find(o => o.id === s.from + '#stem').dir + ':' + sideOf(s)).sort(), ['down:below', 'up:above']);
  assert.equal(x10.m['eg.slur.side_err'], 0);
  /* a phrase slur over six bars: a middle part in every system between its halves, at both widths (the review's RV23) */
  for (const bp of ['desktop', 'phone']) {
    const x = await lay('E11', { breakpoint: bp });
    const phrase = x.p.slurs[x.p.slurs.length - 1];
    const parts = x.e.curves.filter(c => c.refs[0] === phrase.id);
    const from = x.e.objects.find(o => o.event === phrase.from && o.kind === 'notehead').system, to = x.e.objects.find(o => o.event === phrase.to && o.kind === 'notehead').system;
    assert.ok(to - from >= 2, bp + ': three systems or more');
    assert.deepEqual(parts.map(c => c.part + c.system), ['start' + from].concat(Array.from({ length: to - from - 1 }, (v, k) => 'mid' + (from + 1 + k)), ['end' + to]), bp);
    assert.equal(x.m['eg.slur.missing'], 0);
  }
  const x11 = await lay('E11', { respectSourceBreaks: true });
  const placed = x11.p.slurs.find(s => s.placement === 'above');
  assert.equal(bulge(x11.e.curves.find(c => c.refs[0] === placed.id)), 'above');
  assert.ok(x11.p.slurs.some(s => x11.e.curves.filter(c => c.refs[0] === s.id).map(c => c.part).sort().join() === 'end,start'), 'a slur across the break in halves');
  ['eg.slur.pair_errors', 'eg.slur.endpoint_err', 'eg.curve.hits', 'eg.ledger.drawn_missing'].forEach(k => assert.equal(x11.m[k], 0, k));
  /* a dashed slur keeps its line */
  const g = JSON.parse(JSON.stringify(x10.g));
  g.parts[0].spanners.find(s => s.type === 'slur').line = 'dashed';
  const xd = await lay(SG.parse(JSON.stringify(g)));
  assert.equal(xd.e.curves.filter(c => c.line === 'dashed').length, 1);
  assert.match(E.svg(xd.e, xd.p), /class="vf-curve ppp-slur" data-slur="[^"]+" d="[^"]+" fill="none" stroke="currentColor" stroke-width="[\d.]+" stroke-dasharray/);
});

/* ------------------------------------------------------------------ §10.2 priority 5-7: marks attached to notes */
test('A7: articulations, ornaments, fermatas (on notes and a bar line), a tremolo and a breath mark are drawn - staccato and tenuto innermost, in a space, the slur outside them', async () => {
  const x = await lay('E15');
  assert.deepEqual(zeroes(x.m), []);
  const kinds = {};
  x.e.objects.forEach(o => { kinds[o.kind] = (kinds[o.kind] || 0) + 1; });
  assert.ok(kinds.ornament === 3 && kinds.tremolo === 3 && kinds.fermata === 5, JSON.stringify(kinds));
  const glyphs = x.e.objects.filter(o => ['articulation', 'ornament', 'fermata', 'tremolo'].indexOf(o.kind) >= 0).map(o => o.glyph).sort();
  ['articStaccatoAbove', 'articTenutoAbove', 'articAccentAbove', 'articMarcatoAbove', 'fermataAbove', 'ornamentTrill', 'ornamentShortTrill', 'ornamentTurn',
    'tremolo1', 'breathMarkComma', 'fermataShortAbove', 'fermataLongAbove'].forEach(n => assert.ok(glyphs.indexOf(n) >= 0, n));
  /* an angled fermata is the short one, a square fermata the long one (the review's RV19) */
  const shaped = x.p.events.filter(e => e.fermata && e.fermata.shape);
  assert.deepEqual(shaped.map(e => e.fermata.shape + ':' + x.e.objects.find(o => o.id === e.id + '#fermata').glyph), ['angled:fermataShortAbove', 'square:fermataLongAbove']);
  assert.equal(x.m['eg.mark.glyph_err'], 0);
  /* staccato with accent on G5: the staccato nearer the note */
  const g5 = x.p.events.find(e => e.arts.join() === 'staccato,accent');
  const st = x.e.objects.find(o => o.id === g5.id + '#art0'), ac = x.e.objects.find(o => o.id === g5.id + '#art1');
  assert.ok(st.box[3] > ac.box[3], 'the staccato under the accent');
  /* the fermata over the final bar line: above the top staff, centred on the bar line */
  const bf = x.e.objects.find(o => o.kind === 'fermata' && !o.event);
  assert.equal(bf.staffKey, x.p.staves[0].id);
  assert.ok(bf.box[3] <= x.e.systems[0].staves[0].y - 0.2);
  /* the slur over the first bar clears its staccato and tenuto */
  const slur = x.e.curves.find(c => c.kind === 'slur');
  x.e.objects.filter(o => o.kind === 'articulation' && x.p.slurs[0] && o.box[0] >= slur.p0[0] - 0.5 && o.box[2] <= slur.p3[0] + 0.5)
    .forEach(o => assert.ok(sampleBoxes(slur).every(b => b[3] <= o.box[1] + 0.01 || b[2] <= o.box[0] || b[0] >= o.box[2]), o.id + ' under the slur'));
  /* a staccato inside the staff stands in a space */
  const top = x.e.systems[0].staves[0].y;
  x.e.objects.filter(o => o.glyph === 'articStaccatoAbove' && cy(o.box) > top).forEach(o => {
    const k = cy(o.box) - top - 0.5;
    assert.ok(Math.abs(k - Math.round(k)) < 0.02, o.id + ' in a space');
  });
});

test('A7: printed fingering above the right hand and below the left (the graph\'s placement first), a chord\'s fingers stacked in the order of its heads', async () => {
  const x = await lay('E23');
  assert.deepEqual(zeroes(x.m), []);
  const fs1 = x.e.objects.filter(o => o.kind === 'fingering');
  const chord = x.p.events.find(e => e.heads.length === 3);
  const stack = chord.heads.map(h => fs1.find(o => o.refs[1] === h.id + '#fing0'));
  assert.deepEqual(stack.map(o => o.text), ['1', '3', '5']);
  assert.ok(stack[0].box[1] > stack[1].box[1] && stack[1].box[1] > stack[2].box[1], 'the top finger for the top note');
  const lower = x.p.staves[1].id;
  fs1.filter(o => o.staffKey === lower).forEach(o => assert.ok(o.box[1] > x.e.systems[0].staves[1].y + 4, o.id + ' below the lower staff'));
  /* a head with no stated placement on the upper staff: above */
  const f5 = x.p.events.find(e => e.heads.length === 1 && e.heads[0].fingering.length && !e.heads[0].fingering[0].placement && e.staff === x.p.staves[0].id);
  const o5 = fs1.find(o => o.refs[1] === f5.heads[0].id + '#fing0');
  assert.ok(o5.box[3] <= x.e.objects.find(o => o.id === f5.heads[0].id).box[1]);
  /* the SVG writes it as text in the page's family */
  assert.match(E.svg(x.e, x.p), /<text class="ppp-fingering" x="[\d.]+" y="[\d.]+" font-family="Figtree, Arial, sans-serif" font-size="1.4">5<\/text>/);
  /* G4-L5: the sixteenths' fingers stand by their notes, inside the slur over them - the slur clears them; none farther from its note
     than what stands between (eg.fingering.far) */
  const slur = x.e.curves.find(c => c.kind === 'slur');
  const under = fs1.filter(o => o.box[0] > slur.p0[0] - 0.5 && o.box[2] < slur.p3[0] + 0.5 && o.staffKey === x.p.staves[0].id);
  assert.equal(under.length, 8);
  under.forEach(o => {
    const h = x.e.objects.find(q => q.kind === 'notehead' && q.event === o.event);
    assert.ok(o.box[3] <= h.box[1] + 0.01 && CV.yAt(slur, cx(o.box)) < o.box[1] - CV.SLUR.thick / 2, o.id + ' between its note and the slur');
  });
  assert.equal(x.m['eg.fingering.far'], 0);
  /* a finger wider than its head ("4-3") widens its column: it stands clear of its neighbours' fingers (§9, the review's RV9) */
  const wide = fs1.find(o => o.text === '4-3');
  const head = x.e.objects.find(q => q.kind === 'notehead' && q.event === wide.event);
  assert.ok(wide.box[2] - wide.box[0] > head.box[2] - head.box[0]);
  fs1.filter(o => o !== wide && o.staffKey === wide.staffKey).forEach(o => assert.ok(o.box[2] <= wide.box[0] + 0.01 || o.box[0] >= wide.box[2] - 0.01 ||
    o.box[3] <= wide.box[1] + 0.01 || o.box[1] >= wide.box[3] - 0.01, o.id + ' clear of the wide finger'));
  /* §10.5: the finger over a note far above the staff is placed all the same and named by FAR_PLACEMENT */
  const high = x.p.events.find(e => e.heads.length && (e.heads[0].written || e.heads[0].pos).oct === 7);
  const hf = fs1.find(o => o.event === high.id);
  assert.ok(x.e.systems[0].staves[0].y - hf.box[3] > 8, 'more than 8 sp above the staff');
  assert.deepEqual(x.e.diagnostics.filter(d => d.code === 'FAR_PLACEMENT').map(d => d.refs[0]), [hf.id]);
  assert.equal(x.m['eg.layout.far_placements'], 1);
  assert.equal(x.m['eg.layout.far_undiagnosed'], 0);
});

test('A7, A12: arpeggios (up, down, against), glissandi (wavy, a slide), noteheads (x, diamond, slash, in parentheses), cautionary and bracketed accidentals, percussion heads and stems', async () => {
  const x40 = await lay('E40');
  assert.deepEqual(zeroes(x40.m), []);
  const arps = x40.e.objects.filter(o => o.kind === 'arpeggio');
  assert.deepEqual(arps.map(o => (o.dir || '') + (o.non ? 'non' : '')).sort(), ['', 'down', 'non', 'up'].filter(s => s !== '' || arps.some(o => !o.dir && !o.non)));
  const gl = x40.e.curves.filter(c => c.kind === 'gliss');
  assert.deepEqual(gl.map(c => c.line).sort(), ['solid', 'wavy']);
  const x31 = await lay('E31');
  assert.deepEqual(zeroes(x31.m), []);
  const heads = x31.e.objects.filter(o => o.kind === 'notehead' && o.staffKey === x31.p.staves[0].id).map(o => o.glyph);
  ['noteheadXBlack', 'noteheadDiamondBlack', 'noteheadSlashHorizontalEnds', 'noteheadBlack'].forEach(n => assert.ok(heads.indexOf(n) >= 0, n));
  assert.equal(x31.e.objects.filter(o => o.kind === 'paren').length, 2);
  const x32 = await lay('E32');
  assert.deepEqual(zeroes(x32.m), []);
  const accs = x32.e.objects.filter(o => o.kind === 'accidental').map(o => o.glyph);
  ['accidentalBracketLeft', 'accidentalBracketRight', 'accidentalParensLeft', 'accidentalParensRight'].forEach(n => assert.ok(accs.indexOf(n) >= 0, n));
  /* A12: a percussion staff - heads as the kit writes them (the snare's x, also where the note does not say), stems up */
  const x27 = await lay('E27');
  assert.deepEqual(zeroes(x27.m), []);
  const snare = x27.p.events.filter(e => e.heads[0].inst === 'snare');
  assert.ok(snare.some(e => !e.heads[0].notehead), 'a snare note that states no head');
  snare.forEach(e => assert.equal(x27.e.objects.find(o => o.id === e.heads[0].id).glyph, 'noteheadXBlack'));
  x27.e.objects.filter(o => o.kind === 'stem').forEach(o => assert.equal(o.dir, 'up'));
  assert.ok(!x27.e.objects.some(o => o.kind === 'rest'), 'not drawn as rests');
});

/* ------------------------------------------------------------------ the G4c review's carry-overs */
test('carry-overs: a rest off the staff sits on a ledger line of its own; a tuplet number without a bracket stands by its beam, inside the staff where it is free', async () => {
  const x13 = await lay('E13');
  const rest = x13.p.events.filter(e => e.kind === 'rest' && e.dur === '1/2').pop();
  const r = x13.e.objects.find(o => o.id === rest.id);
  const top = x13.e.systems[0].staves[0].y;
  assert.equal(r.glyph, 'restHalf');
  assert.ok(r.origin[1] > top + 4, 'off the staff, below it');
  const led = x13.e.objects.filter(o => o.kind === 'ledger' && o.event === rest.id);
  assert.equal(led.length, 1);
  assert.ok(Math.abs(cy(led[0].box) - r.origin[1]) < 0.02 && led[0].box[0] < r.box[0] && led[0].box[2] > r.box[2], 'the line it sits on, wider than it');
  /* rests inside the staff have none */
  x13.e.objects.filter(o => o.kind === 'rest' && o.id !== rest.id).forEach(o => assert.ok(!x13.e.objects.some(q => q.kind === 'ledger' && q.event === o.event), o.id));
  const x04 = await lay('E04');
  const beamed = x04.p.tuplets.find(t => !t.bracket && t.number !== 'none');
  const num = x04.e.objects.find(o => o.kind === 'tuplet-number' && o.refs[0] === beamed.id);
  const beam = x04.e.objects.filter(o => o.kind === 'beam' && o.events.some(id => beamed.events.indexOf(id) >= 0));
  const gap = Math.min(...beam.map(b => Math.max(num.box[1] - b.box[3], b.box[1] - num.box[3])));
  assert.ok(gap >= 0.49 && gap <= 1.5, 'by its beam: ' + gap);
  assert.equal(x04.m['eg.tuplet.number_far'], 0);
  /* in the Czerny triplets G4c set 12 numbers more than 1.5 sp from their beams: none now - where the beam is inside the
     staff the number is too */
  const c20 = await lay('catalog/method/czerny849/020.mxl');
  assert.equal(c20.m['eg.tuplet.number_far'], 0);
  assert.deepEqual(zeroes(c20.m), []);
  const inside = c20.e.objects.filter(o => o.kind === 'tuplet-number').filter(o => {
    const st = c20.e.systems[o.system].staves.find(t => t.key === o.staffKey);
    return o.box[1] > st.y && o.box[3] < st.y + st.h;
  });
  assert.ok(inside.length > 0, 'numbers inside the staff');
});

test('versions (G4-D1a-1): every change to what the plan and the layout output moves their version - plan/2, engr/3 (G4-L4, G4-L5) - and the layout says whose plan it drew', async () => {
  const x = await lay('E01');
  assert.equal(x.p.version, 'plan/2');
  assert.equal(E.PLAN_VERSION, 'plan/2');
  assert.equal(x.e.version, 'engr/3');
  assert.ok(x.e.planKey.endsWith(':plan/2'));
  assert.match(E.svg(x.e, x.p), /data-plan="[^"]+:plan\/2"/);
  /* G4d-1a's head field: the percussion kit's notehead and stem, or null */
  assert.ok(x.p.events.every(e => e.heads.every(h => h.kit === null)));
});

/* ------------------------------------------------------------------ negative controls */
test('the G4d-1a metrics find the defects they name (negative controls on real layouts)', async () => {
  const x9 = await lay('E09', { breakpoint: 'phone' }), x10 = await lay('E10'), x15 = await lay('E15'), x23 = await lay('E23'), x40 = await lay('E40');
  const x31 = await lay('E31'), x32 = await lay('E32'), x13 = await lay('E13'), x04 = await lay('E04'), x27 = await lay('E27'), b15 = await lay('catalog/method/burgmuller25/015.mxl');
  [x9, x10, x15, x23, x40, x31, x32, x13, x04, x27, b15].forEach(x => assert.deepEqual(zeroes(x.m), []));
  const ok = (x, e, k, why) => assert.ok(metric(x, e, k) >= 1, k + ': ' + why);
  let e;
  /* ties */
  e = clone(x9); e.curves = e.curves.filter(c => c.part !== 'end');
  ok(x9, e, 'eg.tie.missing', 'a tie\'s second half not drawn');
  e = clone(x9); e.curves.find(c => c.kind === 'tie').p0[0] -= 2;
  ok(x9, e, 'eg.tie.endpoint_err', 'a tie end 2 sp from its head');
  assert.ok(metric(x9, e, 'eg.curve.endpoint_err_max') > 0.5);
  e = clone(x9);
  { const c = e.curves.find(q => q.kind === 'tie' && q.part === 'whole'); const d1 = c.c1[1] - c.p0[1], d2 = c.c2[1] - c.p3[1]; c.c1[1] = c.p0[1] - d1; c.c2[1] = c.p3[1] - d2; }
  ok(x9, e, 'eg.tie.dir_err', 'a tie bowing the other way');
  /* slurs */
  e = clone(x10);
  { const s = x10.p.slurs[1], c = e.curves.find(q => q.refs[0] === s.id), h = e.objects.find(o => o.kind === 'notehead' && o.event === x10.p.slurs[0].to); c.p3 = [cx(h.box), c.p3[1]]; }
  ok(x10, e, 'eg.slur.pair_errors', 'a slur ending at another slur\'s note');
  e = clone(x10);
  { const c = e.curves.find(q => q.kind === 'slur'), h = e.objects.find(o => o.kind === 'notehead' && o.event === x10.p.slurs.find(s => s.id === c.refs[0]).from); c.p0 = [c.p0[0], cy(h.box)]; }
  ok(x10, e, 'eg.slur.endpoint_err', 'a slur starting inside its head');
  e = clone(b15);
  { const c = e.curves.find(q => q.kind === 'slur' && q.part === 'whole' && Math.abs(q.p3[0] - q.p0[0]) > 6); const y = (c.p0[1] + c.p3[1]) / 2; c.c1 = [c.c1[0], y + (c.side === 'above' ? 6 : -6)]; c.c2 = [c.c2[0], y + (c.side === 'above' ? 6 : -6)]; }
  ok(b15, e, 'eg.curve.hits', 'a slur dragged through its notes');
  ok(b15, e, 'eg.curve.hits_undiagnosed', 'and not named by SLUR_COLLIDES');
  e = clone(x40); e.curves.find(c => c.kind === 'gliss' && c.line === 'wavy').line = 'solid';
  ok(x40, e, 'eg.gliss.errors', 'a wavy glissando drawn straight');
  /* marks */
  e = clone(x15); e.objects = e.objects.filter(o => o.kind !== 'ornament');
  ok(x15, e, 'eg.mark.missing.ornament', 'the ornaments gone');
  ok(x15, e, 'eg.ledger.drawn_missing', 'and nothing in the ledger says so');
  e = clone(x23); e.objects = e.objects.filter(o => o.kind !== 'fingering');
  ok(x23, e, 'eg.mark.missing.fingering', 'the fingering gone');
  e = clone(x40); e.objects = e.objects.filter(o => o.kind !== 'arpeggio');
  ok(x40, e, 'eg.mark.missing.arpeggio', 'the arpeggios gone');
  e = clone(x15);
  { const o = e.objects.find(q => q.glyph === 'articTenutoAbove'), h = e.objects.find(q => q.kind === 'notehead' && q.event === o.event), d = h.box[3] + 0.3 - o.box[1]; o.box = [o.box[0], o.box[1] + d, o.box[2], o.box[3] + d]; }
  ok(x15, e, 'eg.mark.side_err', 'a tenuto under its note, on its stem\'s side');
  e = clone(x15);
  { const g5 = x15.p.events.find(q => q.arts.join() === 'staccato,accent'), a = e.objects.find(o => o.id === g5.id + '#art0'), b = e.objects.find(o => o.id === g5.id + '#art1'); const t = a.box; a.box = [a.box[0], b.box[1], a.box[2], b.box[1] + (t[3] - t[1])]; b.box = [b.box[0], t[1] + 0.2, b.box[2], t[1] + 0.2 + (b.box[3] - b.box[1])]; }
  ok(x15, e, 'eg.mark.order_err', 'an accent under its staccato');
  e = clone(x15);
  { const o = e.objects.find(q => q.glyph === 'articStaccatoAbove' && cy(q.box) > e.systems[0].staves[0].y); o.box = [o.box[0], o.box[1] - 0.5, o.box[2], o.box[3] - 0.5]; }
  ok(x15, e, 'eg.mark.on_line', 'a staccato on a line');
  e = clone(x23);
  { const o = e.objects.find(q => q.kind === 'fingering' && q.staffKey === x23.p.staves[1].id); o.box = [o.box[0], o.box[1] - 9, o.box[2], o.box[3] - 9]; }
  ok(x23, e, 'eg.fingering.side_err', 'a left-hand finger above its note');
  e = clone(x23);
  { const fs1 = e.objects.filter(o => o.kind === 'fingering' && ['1', '5'].indexOf(o.text) >= 0 && o.staffKey === x23.p.staves[0].id); const t = fs1[0].box; fs1[0].box = fs1[1].box; fs1[1].box = t; }
  ok(x23, e, 'eg.fingering.order_err', 'a chord\'s fingers stacked upside down');
  e = clone(x40); e.objects.find(o => o.kind === 'arpeggio' && o.dir).dir = e.objects.find(o => o.kind === 'arpeggio' && o.dir).dir === 'up' ? 'down' : 'up';
  ok(x40, e, 'eg.arpeggio.errors', 'an arrow pointing the other way');
  e = clone(x31); e.objects = e.objects.filter(o => o.kind !== 'paren');
  ok(x31, e, 'eg.notehead.shape_err', 'a head in parentheses without them');
  e = clone(x27); e.objects.filter(o => o.glyph === 'noteheadXBlack').forEach(o => { o.glyph = 'noteheadBlack'; });
  ok(x27, e, 'eg.notehead.shape_err', 'a snare drawn round');
  e = clone(x32); e.objects.filter(o => /Bracket/.test(o.glyph || '')).forEach(o => { o.glyph = o.glyph.replace('Bracket', 'Parens'); });
  ok(x32, e, 'eg.accidental.enclosure_err', 'an editorial accidental in parentheses');
  /* the carry-overs */
  e = clone(x13); { const r = x13.e.objects.find(o => o.kind === 'rest' && o.glyph === 'restHalf' && x13.e.objects.some(q => q.kind === 'ledger' && q.event === o.event)); e.objects = e.objects.filter(o => !(o.kind === 'ledger' && o.event === r.event)); }
  ok(x13, e, 'eg.rest.ledger_missing', 'a half rest off the staff without its line');
  e = clone(x04); { const n = e.objects.find(o => o.kind === 'tuplet-number' && !e.objects.some(q => q.kind === 'tuplet-bracket' && q.refs[0] === o.refs[0])); n.box = [n.box[0], n.box[1] + 5, n.box[2], n.box[3] + 5]; }
  ok(x04, e, 'eg.tuplet.number_far', 'a tuplet number 5 sp from its beam');
  /* A20 */
  e = clone(x23); { const fs1 = e.objects.filter(o => o.kind === 'fingering' && o.staffKey === x23.p.staves[0].id); fs1[1].box = fs1[0].box.slice(); }
  ok(x23, e, 'eg.overlap.text_text', 'two fingers on each other');
  e = clone(x23); { const f = e.objects.find(o => o.kind === 'fingering'), h = e.objects.find(o => o.kind === 'notehead' && o.event === f.event); f.box = [h.box[0], h.box[1], h.box[0] + (f.box[2] - f.box[0]), h.box[1] + (f.box[3] - f.box[1])]; }
  ok(x23, e, 'eg.overlap.text', 'a finger on its head');
  e = clone(x15); { const ms = e.objects.filter(o => o.kind === 'articulation' && o.event); ms[1].box = ms[0].box.slice(); }
  ok(x15, e, 'eg.overlap.mark_mark', 'two marks on each other');
  e = clone(x15); { const o = e.objects.find(q => q.kind === 'ornament'), h = e.objects.find(q => q.kind === 'notehead' && q.event === o.event); o.box = h.box.slice(); }
  ok(x15, e, 'eg.overlap.mark_note', 'an ornament on its head');
  e = clone(x23); { const f = e.objects.find(o => o.kind === 'fingering'); f.box = [f.box[0], f.box[1], f.box[2] + 0.5, f.box[3]]; }
  ok(x23, e, 'eg.text.width_err', 'a finger wider than the table says');
  e = clone(x9); e.curves[0].p0 = [-3, e.curves[0].p0[1]];
  ok(x9, e, 'eg.clip.curves', 'a curve off the page');
  /* the fixer (G04 §35.18): G4-L4, G4-L5 and the review's R3 */
  const x8 = await lay('E08'), x11 = await lay('E11'), x10b = await lay('E10');
  [x8, x11].forEach(x => assert.deepEqual(zeroes(x.m), []));
  const tieOf = (x, e2, pick) => e2.curves.find(c => c.kind === 'tie' && pick(x.e.objects.find(o => o.id === c.heads[0]), c));
  e = clone(x8);
  { const c = tieOf(x8, e, (h, c) => c.part === 'whole' && bulge(c) === 'above' && x8.e.objects.filter(o => o.kind === 'notehead' && o.event === h.event).length === 4);
    const d1 = c.c1[1] - c.p0[1], d2 = c.c2[1] - c.p3[1]; c.c1[1] = c.p0[1] - d1; c.c2[1] = c.p3[1] - d2; }
  ok(x8, e, 'eg.tie.dir_err', 'an upper-half tie of a four-note chord bowing down');
  e = clone(x8);
  { const c = tieOf(x8, e, h => x8.e.objects.filter(o => o.kind === 'notehead' && o.event === h.event).length === 3 && !x8.e.objects.some(o => o.kind === 'dot' && o.event === h.event) &&
      bulge(x8.e.curves.find(q => q.heads[0] === h.id)) === 'above');
    const to = e.objects.find(o => o.id === c.heads[1]), other = e.objects.filter(o => o.kind === 'notehead' && o.event === to.event && o !== to).sort((a, b) => Math.abs(cy(a.box) - cy(to.box)) - Math.abs(cy(b.box) - cy(to.box)))[0];
    c.p3 = [other.box[0] - 0.1, cy(other.box) - 0.3]; }
  ok(x8, e, 'eg.tie.endpoint_err', 'the displaced head\'s tie meeting its neighbour');
  e = clone(x8);
  { const c = tieOf(x8, e, h => x8.e.objects.some(o => o.kind === 'dot' && o.event === h.event) && bulge(x8.e.curves.find(q => q.heads[0] === h.id)) === 'above' &&
      x8.e.objects.filter(o => o.kind === 'notehead' && o.event === h.event).sort((a, b) => cy(a.box) - cy(b.box))[1].id === h.id);
    const h = e.objects.find(o => o.id === c.heads[0]), dot = e.objects.filter(o => o.kind === 'dot' && o.event === h.event).sort((a, b) => Math.abs(cy(a.box) - cy(h.box)) - Math.abs(cy(b.box) - cy(h.box)))[0];
    const dx = h.box[2] + 0.1 - c.p0[0], dy = cy(dot.box) - c.p0[1]; ['p0', 'c1', 'c2'].forEach(k => { c[k] = [c[k][0] + (k === 'p0' ? dx : 0), c[k][1] + dy]; }); }
  ok(x8, e, 'eg.tie.crossings', 'a tie starting through its own dot');
  e = clone(x11); e.curves = e.curves.filter(c => c.part !== 'mid');
  ok(x11, e, 'eg.slur.missing', 'a phrase slur\'s middle part gone');
  e = clone(x10b);
  { const s = x10b.p.slurs.find(q => x10b.p.events.find(ev => ev.id === q.from).m === x10b.p.measures[1].id), c = e.curves.find(q => q.refs[0] === s.id);
    const d1 = c.c1[1] - c.p0[1], d2 = c.c2[1] - c.p3[1]; c.c1[1] = c.p0[1] - d1; c.c2[1] = c.p3[1] - d2; }
  ok(x10b, e, 'eg.slur.side_err', 'a slur over stems all up bowing above');
  e = clone(x40); { const c = e.curves.find(q => q.kind === 'gliss' && q.part === 'whole'); c.p3 = [c.p3[0], c.p0[1]]; }
  ok(x40, e, 'eg.gliss.errors', 'a glissando ending at its first note\'s height');
  e = clone(x15); e.objects.filter(o => /^fermata(Short|Long)/.test(o.glyph || '')).forEach(o => { o.glyph = o.glyph.replace(/Short|Long/, ''); });
  ok(x15, e, 'eg.mark.glyph_err', 'an angled and a square fermata drawn as the normal one');
  e = clone(x23); { const f = e.objects.find(o => o.kind === 'fingering' && o.text === '4-3'); f.box = [f.box[0], f.box[1] - 3, f.box[2], f.box[3] - 3]; }
  ok(x23, e, 'eg.fingering.far', 'a finger 3 sp farther from its note than it need be');
  e = clone(x23); e.diagnostics = e.diagnostics.filter(d => d.code !== 'FAR_PLACEMENT');
  ok(x23, e, 'eg.layout.far_undiagnosed', 'a finger more than 8 sp from the staff with nothing saying so');
});

test('the layout stays within its checks on the E fixtures G4d-1a is about, at both screen widths (A20, A22)', async () => {
  for (const k of ['E08', 'E09', 'E10', 'E11', 'E12', 'E13', 'E15', 'E23', 'E27', 'E31', 'E32', 'E33', 'E40']) {
    for (const bp of ['desktop', 'phone']) {
      const x = await lay(k, { breakpoint: bp });
      assert.deepEqual(zeroes(x.m), [], k + ' ' + bp);
      assert.ok(x.m['eg.curve.endpoint_err_max'] <= 0.5 && !x.e.diagnostics.some(d => d.code === 'HARD_VIOLATION' || d.code === 'SLUR_COLLIDES'), k + ' ' + bp);
    }
  }
});
