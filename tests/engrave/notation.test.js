/* G4c - beams, stems, tuplets, voices, rests and grace notes in the EngravedScore (docs/GOALS/G04 §11, §12, §14; A2, A3
   at the render level, A4, A7 for grace notes, A11 for whole-measure rests, A21, A26), and the G4b review's backlog
   (§33.16.8: R4, R5, R6, R8, R11, O1, O2, O4; G4-B11). Node only. The metrics are tests/engrave/l2.js (shared with
   bench.js and the mutation test); here each rule is shown on the fixture made for it, and each metric is shown to
   find the defect it names (negative controls). */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { REPO, SG, E, graphOf } = require('./helpers.js');
const { l2, ACC_VS, DOT_VS, REST_VS, STEM_KINDS } = require('./l2.js');

const L = E.layout;
const R = SG.rational;
const CN = require(path.join(REPO, 'engrave', 'canon.js'));
const SK = require(path.join(REPO, 'engrave', 'skyline.js'));
const NT = require(path.join(REPO, 'engrave', 'notation.js'));
const efile = k => 'tests/engrave/fixtures/e/' + fs.readdirSync(path.join(REPO, 'tests', 'engrave', 'fixtures', 'e')).find(f => f.startsWith(k + '-'));
async function lay(k, cfg) {
  const g = await graphOf(k.indexOf('/') >= 0 ? k : efile(k));
  const p = E.plan(g);
  const P = L.prepare(p);
  const e = L.layout(P, cfg || {});
  return { g, p, P, e, m: l2(e, p, { prepared: P, layout: L, graph: g }) };
}
const of = (e, pred) => e.objects.filter(pred);
const byId = (e, id) => e.objects.find(o => o.id === id);
const ctr = b => (b[1] + b[3]) / 2;

/* a piece from a compact spec: bars of voices of [dur, type, pitch|pitches|'r', {dots, stem, acc}] on a treble staff
   (voices 1 and 2) and a bass staff (voice 3); beams: [[bar, voice, [note indices]]]; tuplets likewise */
function piece(spec) {
  const b = SG.builder({ id: spec.id || 'g4c', meta: { title: 'T' } });
  b.setDefault({ src: b.source({ kind: 'user' }).id });
  const ms = spec.bars.map((bar, i) => b.measure({ number: String(i + 1), dur: bar.dur || spec.dur || '1' }));
  b.meter({ m: ms[0].id, beats: [spec.beats || 4], beatType: spec.beatType || 4 });
  const part = b.part({ instrument: { kind: 'piano', family: 'keyboard' } });
  const st = [b.staff(part, {}), b.staff(part, {})];
  const vs = [b.voice(part, { staff: st[0].id, label: '1' }), b.voice(part, { staff: st[0].id, label: '2' }), b.voice(part, { staff: st[1].id, label: '5' })];
  b.clef(part, { staff: st[0].id, m: ms[0].id, at: '0', sign: 'G' });
  b.clef(part, { staff: st[1].id, m: ms[0].id, at: '0', sign: 'F' });
  const pitch = p => { const m = /^([A-G])(#|b)?(\d)$/.exec(p); return { step: m[1], alter: m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0, oct: +m[3] }; };
  const evs = spec.bars.map(() => [[], [], []]);
  spec.bars.forEach((bar, mi) => (bar.voices || []).forEach((notes, vi) => {
    let at = R.ZERO;
    notes.forEach(([dur, type, p, x]) => {
      x = x || {};
      const e = { kind: p === 'r' ? 'rest' : 'note', m: ms[mi].id, at: R.format(at), dur: dur, voice: vs[vi].id, staff: st[vi === 2 ? 1 : 0].id,
        display: Object.assign({ type: type }, x.dots ? { dots: x.dots } : {}, x.stem ? { stem: x.stem } : {}) };
      if (p !== 'r') e.heads = (Array.isArray(p) ? p : [p]).map(q => Object.assign({ pitch: pitch(q) }, x.acc ? { acc: { type: x.acc } } : {}));
      evs[mi][vi].push(b.event(part, e));
      at = R.add(at, R.parse(dur));
    });
  }));
  (spec.beams || []).forEach(([mi, vi, idx, breaks]) => b.spanner(part, { type: 'beam', events: idx.map(k => evs[mi][vi][k].id),
    breaks: breaks ? breaks.map(([k, lv]) => ({ after: evs[mi][vi][k].id, level: lv })) : undefined }));
  (spec.tuplets || []).forEach(([mi, vi, idx, t]) => b.spanner(part, Object.assign({ type: 'tuplet', events: idx.map(k => evs[mi][vi][k].id), actual: 3, normal: 2 }, t || {})));
  return b.finish().graph;
}
const E8 = (p, x) => ['1/8', 'eighth', p, x];
const Q = (p, x) => ['1/4', 'quarter', p, x];
const laid = g => { const p = E.plan(g); const P = L.prepare(p); const e = L.layout(P, {}); return { g, p, P, e, m: l2(e, p, { prepared: P, layout: L, graph: g }) }; };
const zeroes = m => Object.keys(m).filter(k => ['eg.beam.slope_max', 'eg.system.scaled', 'eg.system.overflow'].indexOf(k) < 0 && m[k]).map(k => k + '=' + m[k]);

/* ------------------------------------------------------------------ §11 beams (A2, A3, A21) */
test('A2: every graph beam is drawn over exactly its notes - secondary beams broken where the graph says, hooks on the side §11.2 gives - with stems to the beam and no flag', async () => {
  for (const k of ['E01', 'E02', 'E03', 'E39']) {
    const x = await lay(k);
    assert.deepEqual(zeroes(x.m), [], k);
    x.p.beams.filter(b => b.source === 'graph').forEach(b => {
      const prim = of(x.e, o => o.kind === 'beam' && o.refs[0] === b.id && o.level === 1);
      assert.equal(prim.length, 1, k + ' ' + b.id + ': one primary beam');
      assert.deepEqual(prim[0].events, b.events, k + ' ' + b.id + ': over exactly its notes');
      b.events.forEach(id => {
        const st = byId(x.e, id + '#stem');
        assert.equal(st.beam, b.id);
        const end = st.dir === 'up' ? st.box[1] : st.box[3];
        const l = prim[0].line, top = l[1] + (l[3] - l[1]) * ((st.box[0] + st.box[2]) / 2 - l[0]) / (l[2] - l[0]);
        assert.ok(Math.abs(end - (st.dir === 'up' ? top : top + prim[0].t)) < 0.02, k + ' ' + id + ': the stem ends at the beam');
        assert.ok(!byId(x.e, id + '#flag'), k + ' ' + id + ': no flag under a beam');
      });
    });
  }
  /* E02: 16ths of 6/8, the secondary beam broken after the second (the file's break), and a dotted eighth's 16th with a
     hook pointing back at it */
  const x = await lay('E02');
  const b1 = x.p.beams[0];
  const sec = of(x.e, o => o.refs[0] === b1.id && o.level === 2);
  assert.deepEqual(sec.map(o => o.events.length).sort(), [2, 4], 'E02: two secondary runs, cut at the stated break');
  const hook = of(x.e, o => o.kind === 'beam' && o.hook);
  assert.equal(hook.length, 1);
  assert.equal(hook[0].hook, 'left', 'the 16th after a dotted eighth: its hook points back (Gould, §11.2)');
  /* E03: the rest inside a beam is moved clear of it (§11.2) */
  const x3 = await lay('E03');
  const rest = of(x3.e, o => o.kind === 'rest')[0], beams = of(x3.e, o => o.kind === 'beam');
  assert.ok(beams.every(b => rest.box[3] < b.box[1] - 0.2 || rest.box[1] > b.box[3] + 0.2), 'the rest clears the beam');
});

test('beam geometry (§11.2, A21): at most 0.25 of slope and 1 sp of rise, flat when level or concave, every stem at least its length, a ledger-line group reaching the middle line', () => {
  const beamOf = (spec, i) => { const x = laid(piece(spec)); return { x: x, b: of(x.e, o => o.kind === 'beam' && o.level === 1)[i || 0] }; };
  const slope = b => (b.line[3] - b.line[1]) / (b.line[2] - b.line[0]);
  /* a leap: steep as allowed, never more */
  let r = beamOf({ bars: [{ voices: [[E8('C5'), E8('C6'), ['3/4', 'half', 'r', { dots: 1 }]]] }], beams: [[0, 0, [0, 1]]] });
  const rise = Math.abs(r.b.line[3] - r.b.line[1]), run = r.b.line[2] - r.b.line[0];
  assert.ok(rise <= 0.25 * run + 0.02 && rise <= 1 + 0.02, 'a leap of an octave: ' + slope(r.b) + ' (its ends are rounded to 0.01)');
  assert.deepEqual(zeroes(r.x.m), []);
  /* level ends: flat; a concave group (an inner note past both ends): flat */
  r = beamOf({ bars: [{ voices: [[E8('E5'), E8('G5'), E8('E5'), E8('E5'), ['1/2', 'half', 'r']]] }], beams: [[0, 0, [0, 1, 2, 3]]] });
  assert.equal(slope(r.b), 0, 'first and last level');
  r = beamOf({ bars: [{ voices: [[E8('E4'), E8('B4'), E8('F4'), ['5/8', 'half', 'r', { dots: 1 }]]] }], beams: [[0, 0, [0, 1, 2]]] });
  assert.equal(of(r.x.e, o => o.kind === 'stem')[0].dir, 'up');
  assert.equal(slope(r.b), 0, 'concave: the middle note reaches toward the beam past both ends');
  r = beamOf({ bars: [{ voices: [[E8('E4'), E8('D4'), E8('F4'), ['5/8', 'half', 'r', { dots: 1 }]]] }], beams: [[0, 0, [0, 1, 2]]] });
  assert.ok(slope(r.b) < 0, 'convex (the middle note away from the beam): sloped with the ends, up to the right');
  /* a second rises a quarter space, a third half a space (half the tips' distance) */
  r = beamOf({ bars: [{ voices: [[E8('C5'), E8('D5'), ['3/4', 'half', 'r', { dots: 1 }]]] }], beams: [[0, 0, [0, 1]]] });
  const ends = of(r.x.e, o => o.kind === 'stem').map(o => (o.dir === 'up' ? o.box[1] : o.box[3]));
  assert.ok(Math.abs(Math.abs(ends[1] - ends[0]) - 0.25) < 0.015, 'a second: the stems end a quarter space apart - ' + ends);
  /* the stems: >= 3.5 sp on the nearest, more for more beams; notes below the staff stretch to the middle line */
  r = beamOf({ bars: [{ voices: [[E8('A3'), E8('B3'), ['3/4', 'half', 'r', { dots: 1 }]]] }], beams: [[0, 0, [0, 1]]] });
  const st = r.x.p.events.filter(e => e.kind === 'note').map(e => byId(r.x.e, e.id + '#stem'));
  const top = r.x.e.systems[0].staves[0].y;
  assert.ok(st.every(s => s.dir === 'up' && s.box[1] <= top + 2 + 0.01), 'ledger notes: the beam at the middle line or above');
  r = beamOf({ bars: [{ voices: [[['1/32', '32nd', 'E5'], ['1/32', '32nd', 'F5'], ['1/32', '32nd', 'G5'], ['1/32', '32nd', 'A5'], ['7/8', 'half', 'r', { dots: 2 }]]] }], beams: [[0, 0, [0, 1, 2, 3]]] });
  assert.equal(of(r.x.e, o => o.kind === 'beam').length, 3, 'three beams for 32nds');
  r.x.p.events.filter(e => e.kind === 'note').forEach(e => {
    const s = byId(r.x.e, e.id + '#stem'), h = byId(r.x.e, e.heads[0].id);
    const len = s.dir === 'up' ? ctr(h.box) - s.box[1] : s.box[3] - ctr(h.box);
    assert.ok(len >= 2.5 + 2 * 0.75 - 0.02, '32nds: at least 4 sp (' + len + ')');
  });
  /* direction: the note farthest from the middle; a tie of distances to the majority; stated stems win */
  const dir = spec => of(laid(piece(spec)).e, o => o.kind === 'stem')[0].dir;
  assert.equal(dir({ bars: [{ voices: [[E8('A4'), E8('G5'), ['3/4', 'half', 'r', { dots: 1 }]]] }], beams: [[0, 0, [0, 1]]] }), 'down', 'G5 is farther than A4');
  assert.equal(dir({ bars: [{ voices: [[E8('G4'), E8('D5'), ['3/4', 'half', 'r', { dots: 1 }]]] }], beams: [[0, 0, [0, 1]]] }), 'down', 'a tie (G4 and D5 both 1.5 away): the majority, then down');
  assert.equal(dir({ bars: [{ voices: [[E8('G4'), E8('A4'), E8('D5'), ['5/8', 'half', 'r', { dots: 1 }]]] }], beams: [[0, 0, [0, 1, 2]]] }), 'up', 'a tie with more notes below: up');
  assert.equal(dir({ bars: [{ voices: [[E8('A4', { stem: 'down' }), E8('C4'), ['3/4', 'half', 'r', { dots: 1 }]]] }], beams: [[0, 0, [0, 1]]] }), 'down', 'the graph states down');
  /* NT.autoDir alone */
  assert.equal(NT.autoDir([0], 0), 'down');
  assert.equal(NT.autoDir([1, -0.5], 0), 'up');
  assert.equal(NT.autoDir([-1, 1, 0.5], 0), 'up');
  assert.equal(NT.autoDir([-1, 1], 0), 'down');
});

test('A3 (render level): derived beams only in a part the graph beams nowhere, exactly pro-beam.groups(), drawn; pro-beam.js and meter-grid.js unchanged', async () => {
  const x = await lay('E38');
  const derived = x.p.beams.filter(b => b.source === 'derived');
  assert.ok(derived.length >= 2);
  derived.forEach(b => assert.deepEqual(of(x.e, o => o.kind === 'beam' && o.refs[0] === b.id && o.level === 1).map(o => o.events), [b.events]));
  assert.equal(x.m['eg.beam.derived_missing'], 0);
  assert.equal(x.m['eg.beam.unplanned'], 0);
  /* E01 beams in the file: nothing derived there, nothing drawn beyond the graph's */
  const x1 = await lay('E01');
  assert.ok(of(x1.e, o => o.kind === 'beam').every(o => x1.p.beams.find(b => b.id === o.refs[0]).source === 'graph'));
  const h = f => crypto.createHash('sha256').update(fs.readFileSync(path.join(REPO, 'scoregraph', f), 'utf8').replace(/\r\n/g, '\n')).digest('hex');
  assert.equal(h('pro-beam.js'), '38475872e7c025fada200f8e963a69d3eda97709cfaf4e403f33b14240d4e44d', 'pro-beam.js as G3 left it');
  assert.equal(h('meter-grid.js'), '33ef4bd2ddc17fd826ad6b0ec1ddb6e5923568b8ce7d92f9f494c8b00b7bd0a5', 'meter-grid.js as G3 left it');
});

/* ------------------------------------------------------------------ §12 tuplets (A4) */
test('A4: tuplets as the graph shows them - bracket and number, the number alone on its beam, nothing for none or printed:false; nested inside out; a rest inside the bracket; one-note chains one number each', async () => {
  const digits = (x, id) => of(x.e, o => o.kind === 'tuplet-number' && o.refs[0] === id).sort((a, b) => a.box[0] - b.box[0]).map(o => o.glyph.replace('timeSig', '')).join('');
  const bracket = (x, id) => of(x.e, o => o.kind === 'tuplet-bracket' && o.refs[0] === id);
  const x4 = await lay('E04');
  assert.deepEqual(zeroes(x4.m), []);
  const t4 = x4.p.tuplets;
  assert.equal(t4.length, 2, 'E04: two of the four are shown (show-none, printed:false are not)');
  assert.equal(digits(x4, t4[0].id), '3');
  assert.equal(bracket(x4, t4[0].id).length, 1, 'unbeamed: a bracket');
  assert.equal(bracket(x4, t4[1].id).length, 0, 'exactly one beam: the number alone');
  const quiet = x4.g.parts[0].spanners.filter(s => s.type === 'tuplet' && (s.printed === false || (s.show && s.show.number === 'none')));
  assert.ok(quiet.length >= 1 && quiet.every(s => !x4.e.objects.some(o => o.refs.indexOf(s.id) >= 0)), 'nothing for printed:false or show none');
  /* E05: the inner triplet nearer the notes than its 5:4 parent */
  const x5 = await lay('E05');
  assert.deepEqual(zeroes(x5.m), []);
  const inner = x5.p.tuplets.find(t => t.parent), outer = x5.p.tuplets.find(t => t.id === inner.parent);
  const bi = bracket(x5, inner.id)[0], bo = bracket(x5, outer.id)[0];
  assert.equal(bi.side, bo.side);
  assert.ok(bi.side === 'above' ? bi.box[1] > bo.box[3] : bi.box[3] < bo.box[1], 'inside out');
  assert.equal(digits(x5, outer.id), '5');
  /* E06: the bracket runs from the first member to the last, the rest among them */
  const x6 = await lay('E06');
  const t6 = x6.p.tuplets[0], b6 = bracket(x6, t6.id)[0];
  const heads = t6.events.map(id => of(x6.e, o => o.event === id && (o.kind === 'notehead' || o.kind === 'rest'))[0]);
  assert.ok(heads.some(o => o.kind === 'rest'));
  assert.ok(b6.line[0] <= heads[0].box[0] + 0.01 && b6.line[2] >= heads[2].box[2] - 0.01);
  assert.deepEqual(b6.hooks, [true, true]);
  /* E07: two chains shown as one triplet each (G4-U2 B), the chain off the grid one number per note, no bracket (§12.3) */
  const x7 = await lay('E07');
  assert.deepEqual(zeroes(x7.m), []);
  const merged = x7.p.tuplets.filter(t => t.source === 'merged');
  assert.equal(merged.length, 2);
  merged.forEach(t => {
    assert.equal(digits(x7, t.id), '3');
    const o = of(x7.e, x => x.refs[0] === t.id)[0];
    assert.deepEqual(o.refs.slice(1).sort(), t.members.slice().sort(), 'the display group names the tuplets it shows');
  });
  const single = x7.p.tuplets.filter(t => t.source === 'graph' && t.events.length === 1);
  assert.equal(single.length, 3);
  single.forEach(t => { assert.equal(digits(x7, t.id), '3'); assert.equal(bracket(x7, t.id).length, 0); });
  /* stated: show both numbers, placed below */
  const g9 = piece({ bars: [{ voices: [[['1/12', 'eighth', 'C5'], ['1/12', 'eighth', 'D5'], ['1/12', 'eighth', 'E5'], ['3/4', 'half', 'r', { dots: 1 }]]] }],
    tuplets: [[0, 0, [0, 1, 2], { show: { number: 'both', placement: 'below' } }]] });
  const x9 = laid(g9);
  assert.deepEqual(zeroes(x9.m), []);
  const nums = of(x9.e, o => o.kind === 'tuplet-number');
  assert.deepEqual(nums.filter(o => o.glyph !== 'augmentationDot').map(o => o.glyph), ['timeSig3', 'timeSig2'], '3:2');
  assert.equal(nums.filter(o => o.glyph === 'augmentationDot').length, 2, 'the colon');
  assert.ok(nums.every(o => o.side === 'below' && o.box[1] > x9.e.systems[0].staves[0].y + 4), 'below the staff, as stated');
});

/* ------------------------------------------------------------------ §14 voices, rests, grace notes (A7, A11, A26) */
test('A26 and G4-B11: two voices - stems by the graph or the voice order; a second: the down-stem voice to the right, the stems in one line; a unison of one shape shares its head, of two shapes stands side by side', async () => {
  const x = await lay('E12');
  assert.deepEqual(zeroes(x.m), []);
  const ev = x.p.events.filter(e => e.kind === 'note' && e.staff === x.p.staves[0].id);
  const at = (v, a) => ev.find(e => e.voice === v && e.at === a);
  const v1 = ev[0].voice, v2 = ev.find(e => e.voice !== v1).voice;
  ev.forEach(e => assert.equal(byId(x.e, e.id + '#stem').dir, e.voice === v1 ? 'up' : 'down'));
  /* the second at beat 1: E5 up, D5 down */
  const up = byId(x.e, at(v1, '0').heads[0].id), dn = byId(x.e, at(v2, '0').heads[0].id);
  assert.ok(dn.box[0] >= up.box[2] - 0.01, 'G4-B11: the down-stem voice stands to the right');
  const su = byId(x.e, at(v1, '0').id + '#stem'), sd = byId(x.e, at(v2, '0').id + '#stem');
  assert.ok(Math.abs(sd.box[0] - su.box[2] - 0.2) < 0.02, 'the two stems 0.2 sp apart, as VexFlow sets them (head width + 2 px)');
  assert.ok(Math.abs(dn.box[0] - up.box[2] - 0.2) < 0.02);
  /* the unison of two quarters: one head, both objects at one place, naming each other */
  const a = byId(x.e, at(v1, '1/4').heads[0].id), b = byId(x.e, at(v2, '1/4').heads[0].id);
  assert.deepEqual(a.box, b.box);
  assert.deepEqual([a.merged, b.merged], [[b.id], [a.id]]);
  assert.deepEqual(SK.collisions([a, b], { w: 1000, h: 1000 }, [], []), [], 'not a collision (H1): shared by design');
  /* a half and a quarter on one pitch: side by side */
  const h = byId(x.e, at(v1, '1/2').heads[0].id), q = byId(x.e, at(v2, '1/2').heads[0].id);
  assert.ok(!h.merged && q.box[0] >= h.box[2] - 0.01);
  /* E39: the lower voice's stated down stems; the upper's by its role */
  const x39 = await lay('E39');
  assert.deepEqual(zeroes(x39.m), []);
  /* the rule itself: the stem-up voice keeps its place whichever voice is written first */
  const g = piece({ bars: [{ voices: [[Q('C5', { stem: 'down' }), ['3/4', 'half', 'r', { dots: 1 }]], [Q('D5', { stem: 'up' }), ['3/4', 'half', 'r', { dots: 1 }]]] }] });
  const y = laid(g);
  const [c5, d5] = [y.p.events[0], y.p.events.find(e => e.kind === 'note' && e.voice !== y.p.events[0].voice)];
  assert.ok(byId(y.e, c5.heads[0].id).box[0] >= byId(y.e, d5.heads[0].id).box[2] - 0.01, 'the down-stem C5 moves, the up-stem D5 stays');
});

test('§14.3, A11, R6: rests - two voices resting together are one rest; a voice\'s rest moves clear of the other voice; a whole-measure rest is a whole rest in the middle of its measure, never dotted', async () => {
  const x = await lay('E13');
  assert.deepEqual(zeroes(x.m), []);
  const rests = of(x.e, o => o.kind === 'rest');
  const pair = rests.filter(o => o.merged);
  assert.equal(pair.length, 2, 'the quarter rest both voices share');
  assert.deepEqual(pair[0].box, pair[1].box);
  /* E29: 3/4 and 6/8 bar rests: whole rests centred */
  const x29 = await lay('E29');
  assert.deepEqual(zeroes(x29.m), []);
  of(x29.e, o => o.kind === 'rest').forEach(o => {
    assert.equal(o.glyph, 'restWhole');
    const m = x29.e.measures.find(mm => mm.id === o.measure);
    assert.ok(Math.abs((o.box[0] + o.box[2]) / 2 - (m.content[0] + m.content[1] - 1) / 2) < 0.02, 'centred in ' + m.id);
  });
  /* R6: a dotted half rest filling 3/4 draws no dot */
  const g = piece({ beats: 3, dur: '3/4', bars: [{ voices: [[['3/4', 'half', 'r', { dots: 1 }]], [], [['3/4', 'half', 'C3', { dots: 1 }]]] }] });
  const y = laid(g);
  assert.deepEqual(zeroes(y.m), []);
  const r = of(y.e, o => o.kind === 'rest')[0];
  assert.equal(r.glyph, 'restWhole');
  assert.equal(of(y.e, o => o.kind === 'dot' && o.event === r.event).length, 0, 'no dot on a whole-measure rest');
  /* a rest of the lower voice under the upper voice's low notes moves down, in whole staff spaces */
  const g2 = piece({ bars: [{ voices: [[['1/2', 'half', 'G4'], ['1/2', 'half', 'A4']], [['1/2', 'half', 'r'], ['1/2', 'half', 'C4']]] }] });
  const z = laid(g2);
  assert.deepEqual(zeroes(z.m), []);
  const rr = of(z.e, o => o.kind === 'rest')[0];
  const y0 = z.e.systems[0].staves[0].y;
  assert.ok(rr.box[1] - y0 > 2, 'below its standard place');
  const moved = rr.box[3] - y0 - 0.01 - 2;
  assert.ok(Math.abs(moved - Math.round(moved)) < 0.02, 'by whole staff spaces: ' + moved);
});

test('A7 (grace notes), §14.5: small heads left of their note, stems up unless stated, a flag or the graph\'s beam, a slash for an acciaccatura; one after the last note deferred; never on a time column', async () => {
  const x = await lay('E14');
  assert.deepEqual(zeroes(x.m), []);
  const graces = x.p.events.filter(e => e.grace && !e.grace.after);
  graces.forEach(e => {
    const os = of(x.e, o => o.event === e.id);
    const h = os.find(o => o.kind === 'notehead');
    assert.ok(h.grace && Math.abs(h.scale - 0.66) < 0.01, e.id + ' small');
    assert.ok(h.box[2] <= h.anchor[0] + 0.01, e.id + ' left of its note\'s column');
    const st = os.find(o => o.kind === 'stem');
    assert.ok(st && st.dir === 'up', e.id + ' stem up');
    if (e.grace.slash) assert.ok(os.some(o => o.kind === 'slash'), e.id + ' slashed');
  });
  const gb = of(x.e, o => o.kind === 'beam' && o.grace);
  assert.ok(gb.length >= 1 && gb.every(o => o.events.every(id => x.p.events.find(e => e.id === id).grace)), 'the appoggiatura pair beamed as the file beams it');
  const after = x.p.events.find(e => e.grace && e.grace.after);
  assert.ok(after && !x.e.objects.some(o => o.event === after.id), 'the one after the last note waits (deferred grace-after)');
  /* a dotted grace note keeps its dot, after its flag (no committed score has one) */
  const b = SG.builder({ id: 'dg', meta: { title: 'T' } });
  b.setDefault({ src: b.source({ kind: 'user' }).id });
  const m = b.measure({ number: '1', dur: '1' });
  b.meter({ m: m.id, beats: [4], beatType: 4 });
  const part = b.part({ instrument: { kind: 'piano', family: 'keyboard' } });
  const st = b.staff(part, {}), v = b.voice(part, { staff: st.id, label: '1' });
  b.clef(part, { staff: st.id, m: m.id, at: '0', sign: 'G' });
  const ge = b.event(part, { kind: 'note', m: m.id, at: '0', dur: '0', voice: v.id, staff: st.id, grace: { order: 1 }, display: { type: 'eighth', dots: 1 }, heads: [{ pitch: { step: 'D', alter: 0, oct: 5 } }] });
  b.event(part, { kind: 'note', m: m.id, at: '0', dur: '1', voice: v.id, staff: st.id, display: { type: 'whole' }, heads: [{ pitch: { step: 'C', alter: 0, oct: 5 } }] });
  const dg = laid(b.finish().graph);
  assert.deepEqual(zeroes(dg.m), []);
  const dot = of(dg.e, o => o.kind === 'dot' && o.event === ge.id), flag = of(dg.e, o => o.kind === 'flag' && o.event === ge.id)[0];
  assert.ok(dot.length === 1 && dot[0].grace && dot[0].box[0] >= flag.box[2] - 0.01);
  /* the grace before the F#5 stands left of its principal's accidental */
  const fs5 = x.p.events.find(e => e.heads && e.heads.some(h => h.acc));
  const acc = byId(x.e, fs5.heads.find(h => h.acc).id + '#acc');
  const g = graces.find(e => e.at === fs5.at);
  assert.ok(of(x.e, o => o.event === g.id).every(o => o.box[2] <= acc.box[0] + 0.01));
});

test('R5 and §14.4: a cross-staff event is drawn on its staff; a chord across the staves (deferred) gets a stem on each, each named for its staff - no id twice', async () => {
  const x = await lay('E26');
  assert.deepEqual(zeroes(x.m), []);
  const ids = x.e.objects.map(o => o.id);
  assert.equal(new Set(ids).size, ids.length);
  const chord = x.p.events.find(e => e.heads.some(h => h.crossStaff));
  const home = byId(x.e, chord.id + '#stem'), there = x.e.objects.find(o => o.id.startsWith(chord.id + '#stem:'));
  assert.ok(home && there && home.staffKey !== there.staffKey && home.dir !== there.dir);
  assert.ok(x.p.ledger.some(en => en.code === 'cross-staff-chord'));
});

/* ------------------------------------------------------------------ the G4b backlog */
test('R8: prepare() reads the plan and writes nothing into it; R11: a ragged last system takes the spacing of the full-size systems only', async () => {
  for (const k of ['E13', 'E29', 'E14']) {
    const p = E.plan(await graphOf(efile(k)));
    const before = JSON.stringify(p);
    L.prepare(p);
    L.engrave(p, { breakpoint: 'phone' });
    assert.equal(JSON.stringify(p), before, k);
  }
  /* R11: a piece of two systems on a phone, the first squeezed to a smaller staff (u = 0 says nothing of the spacing):
     the ragged last system is spaced at the natural u, not at 0 */
  const x = await lay('tests/bench/corpus/micro/M05-32nds-120.musicxml', { breakpoint: 'phone' });
  const sys = x.e.systems;
  assert.ok(sys.length === 2 && sys[0].space < 1 && sys[0].u === 0, 'the first system drawn smaller');
  assert.ok(sys[1].ragged && sys[1].u === 4, 'the last at the natural spacing: ' + sys[1].u);
});

test('O1: the canonical form refuses a number that is not finite, and says where; O2: the engraver caches under the config it lays out', async () => {
  assert.throws(() => CN.canonical({ a: [1, { b: NaN }] }), /not finite at \$\.a\[1\]\.b = NaN/);
  assert.throws(() => CN.hash({ x: Infinity }), /not finite at \$\.x = Infinity/);
  assert.equal(CN.canonical({ a: null, b: 1.005 }), '{"a":null,"b":1}');
  const p = E.plan(await graphOf(efile('E37')));
  const eng = L.createEngraver(p);
  const a = eng.layout({ width: 50.004 }), b = eng.layout({ width: 50.001 }), c = eng.layout({ width: 50 });
  assert.equal(a.config.width, 50);
  assert.ok(a === b && b === c, 'one layout for the widths one config names');
  assert.deepEqual(eng.stats, { layouts: 1, hits: 2 });
  assert.equal(CN.hash(a), CN.hash(L.engrave(p, { width: 50 })));
});

test('O4: the L2 rule lists are l2.js\'s own - wider than the layout\'s collision rules, and it does not load skyline.js or notation.js', () => {
  const src = fs.readFileSync(path.join(REPO, 'tests', 'engrave', 'l2.js'), 'utf8');
  assert.doesNotMatch(src, /require\([^)]*(skyline|notation|layout)\.js/);
  const skySrc = fs.readFileSync(path.join(REPO, 'engrave', 'skyline.js'), 'utf8');
  const rule = code => JSON.parse(new RegExp("\\['" + code + "', '(\\w+)', (\\[[^\\]]*\\])").exec(skySrc)[2].replace(/'/g, '"'));
  const wider = (mine, theirs) => theirs.every(k => mine.indexOf(k) >= 0) && mine.length > theirs.length;
  assert.ok(wider(ACC_VS, rule('H2')), 'accidentals: ' + ACC_VS);
  assert.ok(wider(DOT_VS, rule('H3')), 'dots: ' + DOT_VS);
  assert.ok(REST_VS.indexOf('beam') >= 0 && STEM_KINDS.indexOf('beam') >= 0);
});

/* ------------------------------------------------------------------ negative controls: each metric finds what it names */
test('the G4c metrics find the defects they name (negative controls on real layouts)', async () => {
  const base = await lay('E02');
  const x12 = await lay('E12'), x04 = await lay('E04'), x14 = await lay('E14'), x29 = await lay('E29'), x38 = await lay('E38'), x26 = await lay('E26');
  const clone = x => JSON.parse(JSON.stringify(x.e));
  const m = (x, e) => l2(e, x.p, { graph: x.g });
  const ok = (x, e, k, why) => assert.ok(m(x, e)[k] >= 1, k + ': ' + why);
  [base, x12, x04, x14, x29, x38, x26].forEach(x => assert.deepEqual(zeroes(m(x, x.e)), []));
  let e = clone(base);
  /* beams */
  e.objects = e.objects.filter(o => !(o.kind === 'beam' && o.level === 1 && o.refs[0] === base.p.beams[0].id));
  ok(base, e, 'eg.beam.graph_missing', 'a graph beam not drawn');
  e = clone(base);
  e.objects.find(o => o.kind === 'beam' && o.level === 1).events.pop();
  ok(base, e, 'eg.beam.graph_missing', 'a beam over fewer notes than the graph\'s');
  e = clone(x38);
  e.objects = e.objects.filter(o => !(o.kind === 'beam' && o.refs[0].startsWith('d:beam:')));
  ok(x38, e, 'eg.beam.derived_missing', 'a derived beam not drawn');
  e = clone(base);
  e.objects.push(Object.assign(JSON.parse(JSON.stringify(e.objects.find(o => o.kind === 'beam'))), { id: 'x#b', refs: ['d:beam:nothing'] }));
  ok(base, e, 'eg.beam.unplanned', 'a beam of no plan');
  e = clone(base);
  e.objects = e.objects.filter(o => !(o.kind === 'beam' && o.hook));
  ok(base, e, 'eg.beam.level_errors', 'a hook left out');
  e = clone(base);
  e.objects.filter(o => o.kind === 'beam' && o.level === 2)[0].events = base.p.beams[0].events.slice();
  ok(base, e, 'eg.beam.level_errors', 'a secondary beam across the graph\'s break');
  e = clone(base);
  const st = e.objects.find(o => o.kind === 'stem' && o.beam);
  e.objects.push({ id: st.event + '#flag', kind: 'flag', refs: [st.event], event: st.event, system: st.system, staffKey: st.staffKey, measure: st.measure, glyph: 'flag8thUp',
    box: [st.box[0], st.box[1], st.box[0] + 1, st.box[1] + 3], layer: 'note' });
  ok(base, e, 'eg.beam.flag_errors', 'a flag under a beam');
  e = clone(base);
  const bm = e.objects.find(o => o.kind === 'beam' && o.level === 1);
  bm.line[3] = bm.line[1] + 0.4 * (bm.line[2] - bm.line[0]);
  ok(base, e, 'eg.beam.slope_violations', 'a beam steeper than 0.25');
  e = clone(base);
  const bm2 = e.objects.find(o => o.kind === 'beam' && o.level === 1), hd = e.objects.find(o => o.kind === 'notehead' && bm2.events.indexOf(o.event) >= 0);
  bm2.line[1] = bm2.line[3] = hd.box[1] + 0.2; bm2.box = [bm2.line[0], hd.box[1], bm2.line[2], hd.box[3]];
  ok(base, e, 'eg.beam.head_crossings', 'a beam through its own heads (H7)');
  e = clone(base);
  const s2 = e.objects.find(o => o.kind === 'stem' && o.beam);
  if (s2.dir === 'up') s2.box[1] = s2.box[3] - 1.5; else s2.box[3] = s2.box[1] + 1.5;
  ok(base, e, 'eg.stem.short', 'a stem under a beam shorter than 2.5 sp');
  /* stems and voices */
  e = clone(x12);
  const s12 = e.objects.find(o => o.kind === 'stem');
  s12.dir = s12.dir === 'up' ? 'down' : 'up';
  ok(x12, e, 'eg.voice.stem_policy_violations', 'a voice\'s stem the wrong way');
  e = clone(x12);
  const hh = e.objects.filter(o => o.kind === 'notehead' && o.merged);
  delete hh[0].merged;
  ok(x12, e, 'eg.overlap.head_head', 'two voices\' heads on one spot that do not name each other');
  /* tuplets */
  const t0 = x04.p.tuplets[0].id;
  e = clone(x04);
  e.objects = e.objects.filter(o => o.refs[0] !== t0);
  ok(x04, e, 'eg.tuplet.missing', 'a printed tuplet not drawn');
  e = clone(x04);
  e.objects.find(o => o.kind === 'tuplet-number' && o.refs[0] === t0).glyph = 'timeSig5';
  ok(x04, e, 'eg.tuplet.show_errors', 'the wrong number');
  e = clone(x04);
  e.objects = e.objects.filter(o => !(o.kind === 'tuplet-bracket' && o.refs[0] === t0));
  ok(x04, e, 'eg.tuplet.show_errors', 'a bracket left out');
  e = clone(x04);
  const br = e.objects.find(o => o.kind === 'tuplet-bracket');
  br.line[2] -= 2;
  ok(x04, e, 'eg.tuplet.extent_err', 'a bracket short of its last member');
  e = clone(x04);
  const quiet = x04.g.parts[0].spanners.find(s => s.type === 'tuplet' && s.show && s.show.number === 'none');
  e.objects.push(Object.assign(JSON.parse(JSON.stringify(e.objects.find(o => o.kind === 'tuplet-number'))), { id: quiet.id + '#num0', refs: [quiet.id] }));
  ok(x04, e, 'eg.tuplet.suppressed_rendered', 'a tuplet the file shows with nothing, drawn');
  const x05 = await lay('E05');
  e = clone(x05);
  const inner = x05.p.tuplets.find(t => t.parent);
  e.objects.filter(o => o.refs[0] === inner.id).forEach(o => { o.box = [o.box[0], o.box[1] + (o.side === 'above' ? -8 : 8), o.box[2], o.box[3] + (o.side === 'above' ? -8 : 8)]; });
  ok(x05, e, 'eg.tuplet.nesting_errors', 'the inner bracket outside the outer one');
  /* grace notes */
  e = clone(x14);
  const gh = e.objects.find(o => o.kind === 'notehead' && o.grace);
  delete gh.grace;
  ok(x14, e, 'eg.grace.misplaced', 'a grace note drawn as an ordinary note');
  e = clone(x14);
  e.objects = e.objects.filter(o => o.kind !== 'slash');
  ok(x14, e, 'eg.grace.stem_errors', 'an acciaccatura without its slash');
  /* rests */
  e = clone(x29);
  const rr = e.objects.find(o => o.kind === 'rest');
  rr.box = [rr.box[0] - 3, rr.box[1], rr.box[2] - 3, rr.box[3]];
  ok(x29, e, 'eg.rest.measure_errors', 'a bar rest off the middle');
  e = clone(x29);
  e.objects.find(o => o.kind === 'rest').glyph = 'restHalf';
  ok(x29, e, 'eg.rest.measure_errors', 'a bar rest in the written value\'s shape');
  e = clone(base);
  const bmr = e.objects.find(o => o.kind === 'beam' && o.level === 1);
  const ev = base.p.events.find(x => x.kind === 'rest') || null;
  if (ev) {
    const ro = e.objects.find(o => o.event === ev.id && o.kind === 'rest');
    ro.box = [bmr.box[0] + 0.5, bmr.box[1], bmr.box[0] + 1.5, bmr.box[3]];
    ok(base, e, 'eg.rest.overlap', 'a rest on a beam');
  }
  /* R4, R5 */
  e = clone(x12);
  const h12 = e.objects.find(o => o.kind === 'notehead' && !o.merged);
  h12.box = [h12.box[0], h12.box[1] + 0.5, h12.box[2], h12.box[3] + 0.5];
  ok(x12, e, 'eg.layout.pitch_y_err', 'a head a step off its written pitch');
  e = clone(x14);
  e.objects = e.objects.filter(o => !(o.kind === 'accidental' && !o.grace));
  ok(x14, e, 'eg.layout.attachment_diff', 'an accidental left out');
  e = clone(x29);
  e.objects.push(Object.assign(JSON.parse(JSON.stringify(e.objects.find(o => o.kind === 'rest'))), { id: e.objects.find(o => o.kind === 'rest').id + '#dot0', kind: 'dot', glyph: 'augmentationDot' }));
  ok(x29, e, 'eg.layout.attachment_diff', 'a dotted bar rest (R6)');
  e = clone(x29);
  e.objects = e.objects.filter(o => o.kind !== 'clef' || o.system !== 0 || o.id.indexOf('d:clef:') !== 0 || o.staffKey !== x29.p.staves[1].id);
  ok(x29, e, 'eg.layout.signature_diff', 'a system head without its clef');
  e = clone(x29);
  e.objects = e.objects.filter(o => !(o.kind === 'timesig' && o.measure === x29.p.measures[1].id));
  ok(x29, e, 'eg.layout.signature_diff', 'a meter change not shown');
  e = clone(x26);
  const dupStem = e.objects.find(o => o.id.indexOf('#stem:') > 0);
  dupStem.id = dupStem.id.split(':')[0].replace(/#stem.*/, '#stem');
  ok(x26, e, 'eg.layout.duplicate_ids', 'one stem id on two staves (R5)');
});
