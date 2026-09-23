'use strict';
/* G3 Step 1: the metric grid every notation pass reads (docs/GOALS/G03 §6.2, §6.3, §11.2). */
const test = require('node:test');
const assert = require('node:assert/strict');
const { SG } = require('./helpers.js');
const { mk } = require('./g3-helpers.js');
const MG = SG.meterGrid;

/* a one-staff graph with measures of the given durations under one time signature, each a whole-measure rest */
function graph(beats, beatType, durs, extra) {
  const g = mk({ time: [beats, beatType], durs: durs, groups: extra && extra.groups, rh: durs.map(d => 'r:w=' + d).join(' | ') });
  return { g: g, ms: g.timeline.measures.map(m => m.id) };
}
const u = w => MG.toU(w);
const Q = MG.U / 4, E = MG.U / 8, S16 = MG.U / 16;
const sym = (type, dots) => ({ type: type, dots: dots || 0 });

test('levels: 4/4 has a bar, a middle, beats, half-beats and finer (§6.2)', () => {
  const { g, ms } = graph(4, 4, ['1']);
  const gr = MG.grid(g, ms[0]);
  assert.equal(gr.nomU, MG.U);
  assert.deepEqual([0, 2 * Q, Q, E, S16, S16 / 2].map(p => MG.levelOf(gr, p)), [0, 1, 2, 3, 4, 5]);
  assert.equal(MG.levelOf(gr, u('1/12')), Infinity, 'a triplet point is on no binary level');
});

test('levels: 6/8 beats are dotted quarters, eighths below them (H4)', () => {
  const { g, ms } = graph(6, 8, ['3/4']);
  const gr = MG.grid(g, ms[0]);
  assert.equal(gr.compound, true);
  assert.deepEqual(gr.beats, [0, 3 * E]);
  assert.deepEqual([3 * E, E, 2 * E, S16].map(p => MG.levelOf(gr, p)), [2, 3, 3, 4]);
});

test('12/8 has two groups of two beats; 5/8 groups follow the time signature or 2+3', () => {
  const a = graph(12, 8, ['3/2']);
  assert.deepEqual(MG.grid(a.g, a.ms[0]).groups, [0, MG.U * 3 / 4]);
  const b = graph(5, 8, ['5/8']);
  assert.deepEqual(MG.grid(b.g, b.ms[0]).beats, [0, 2 * E]);
  const c = graph(5, 8, ['5/8'], { groups: ['3/8', '1/4'] });
  assert.deepEqual(MG.grid(c.g, c.ms[0]).beats, [0, 3 * E]);
});

test('a pickup lines up with the end of a full measure (R14)', () => {
  const { g, ms } = graph(3, 4, ['1/4', '3/4']);
  const gr = MG.grid(g, ms[0]);
  assert.equal(gr.pickup, true);
  assert.equal(gr.off, 2 * Q);
  assert.equal(MG.levelOf(gr, 0), 2, 'the pickup starts on the third beat');
  assert.equal(MG.grid(g, ms[1]).pickup, false);
});

test('the S table: 2/4 and 4/4 allow 8 4 8, 3/4 does not (R05-R07)', () => {
  const two = graph(2, 4, ['1/2']), three = graph(3, 4, ['3/4']), four = graph(4, 4, ['1']);
  const g2 = MG.grid(two.g, two.ms[0]), g3 = MG.grid(three.g, three.ms[0]), g4 = MG.grid(four.g, four.ms[0]);
  assert.equal(MG.symbolOk(g2, E, E + Q, sym('quarter'), 'note'), true, '2/4: 8 4 8');
  assert.equal(MG.symbolOk(g4, E, E + Q, sym('quarter'), 'note'), true, '4/4: 8 4 8 inside the first half');
  assert.equal(MG.symbolOk(g4, 3 * E, 5 * E, sym('quarter'), 'note'), false, '4/4: a quarter over the middle');
  assert.equal(MG.symbolOk(g3, E, E + Q, sym('quarter'), 'note'), false, '3/4: 8 4 4 8 is not allowed (R07)');
  assert.equal(MG.symbolOk(g4, Q, 3 * Q, sym('half'), 'note'), true, '4/4: 4 2 4');
  assert.equal(MG.symbolOk(g4, 0, 3 * Q, sym('half', 1), 'note'), true, '4/4: 2. 4');
  assert.equal(MG.symbolOk(g3, Q, 3 * Q, sym('half'), 'note'), true, '3/4: 4 2');
});

test('compound metre: nothing hides the dotted-quarter beat unless it runs to the group end (H4, R08-R11)', () => {
  const { g, ms } = graph(6, 8, ['3/4']);
  const gr = MG.grid(g, ms[0]);
  assert.equal(MG.symbolOk(gr, 0, 2 * E, sym('quarter'), 'note'), true, '4 8 inside the beat');
  assert.equal(MG.symbolOk(gr, 0, 4 * E, sym('half'), 'note'), false, 'a half from the downbeat hides the second beat');
  assert.equal(MG.symbolOk(gr, 0, 6 * E, sym('half', 1), 'note'), true, 'the dotted half fills the group');
  assert.equal(MG.symbolOk(gr, 2 * E, 4 * E, sym('quarter'), 'note'), false, 'an off-beat quarter over the beat');
});

test('rests: no rest over a beat, except the half rests of 4/4; a 16th rest and an 8th rest, not a dotted 8th (H3)', () => {
  const four = graph(4, 4, ['1']), three = graph(3, 4, ['3/4']);
  const g4 = MG.grid(four.g, four.ms[0]), g3 = MG.grid(three.g, three.ms[0]);
  assert.equal(MG.symbolOk(g4, 0, 2 * Q, sym('half'), 'rest'), true);
  assert.equal(MG.symbolOk(g4, Q, 3 * Q, sym('half'), 'rest'), false);
  assert.equal(MG.symbolOk(g3, 0, 2 * Q, sym('half'), 'rest'), false);
  assert.equal(MG.symbolOk(g4, 0, MG.U, sym('whole'), 'rest'), true, 'the whole-measure rest');
  assert.equal(MG.symbolOk(g4, S16, Q, sym('eighth', 1), 'rest'), false);
  assert.equal(MG.symbolOk(g4, 0, 3 * S16, sym('eighth', 1), 'rest'), true);
});

test('cost: fewer symbols, fewer ties; a dotted quarter beats a quarter tied to an eighth (§6.2)', () => {
  const { g, ms } = graph(4, 4, ['1']);
  const gr = MG.grid(g, ms[0]);
  const dotted = MG.symbolCost(gr, 0, 3 * E, sym('quarter', 1), false);
  const tied = MG.symbolCost(gr, 0, Q, sym('quarter'), false) + MG.symbolCost(gr, Q, 3 * E, sym('eighth'), true);
  assert.ok(dotted < tied, dotted + ' < ' + tied);
  assert.ok(Number.isInteger(dotted) && Number.isInteger(tied), 'integer costs (§16.2)');
  assert.ok(MG.symbolCost(gr, 0, MG.U / 32, sym('32nd'), false) > MG.symbolCost(gr, 0, S16, sym('16th'), false));
});

test('beam groups follow the §11.2 table', () => {
  const span = (b, bt, d) => { const x = graph(b, bt, [d]); return MG.beamGroups(MG.grid(x.g, x.ms[0])); };
  assert.deepEqual(span(4, 4, '1'), [[0, Q], [Q, 2 * Q], [2 * Q, 3 * Q], [3 * Q, 4 * Q]]);
  assert.deepEqual(span(3, 4, '3/4'), [[0, Q], [Q, 2 * Q], [2 * Q, 3 * Q]]);
  assert.deepEqual(span(6, 8, '3/4'), [[0, 3 * E], [3 * E, 6 * E]]);
  assert.deepEqual(span(3, 8, '3/8'), [[0, 3 * E]]);
  assert.deepEqual(span(2, 2, '1'), [[0, Q], [Q, 2 * Q], [2 * Q, 3 * Q], [3 * Q, 4 * Q]]);
  assert.deepEqual(span(7, 8, '7/8'), [[0, 2 * E], [2 * E, 4 * E], [4 * E, 7 * E]]);
});
