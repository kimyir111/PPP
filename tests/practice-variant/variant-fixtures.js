/* Hand-written graphs for the tests of practice/variant.js (G11c-0): a piece in eight bars of 4/4 and a variant of it, built with the notation language of
   tests/scoregraph/g3-helpers.js (mk), and helpers to add what mk cannot write: pedal, 8va, slurs, directions, clef changes, second voices. Every graph is
   deterministic. Nothing here reads the repository's catalogue. */
'use strict';
const path = require('path');
const REPO = path.resolve(__dirname, '..', '..');
const { mk } = require(path.join(REPO, 'tests', 'scoregraph', 'g3-helpers.js'));
const B = require(path.join(REPO, 'scoregraph', 'build.js'));
const SG = require(path.join(REPO, 'scoregraph', 'index.js'));

const clone = x => JSON.parse(JSON.stringify(x));
const BUSY_RH = ['C5:8 D5:8 E5:8 F5:8 G5:8 A5:8 B5:8 C6:8', 'D5:8 E5:8 F5:8 G5:8 A5:8 B5:8 C6:8 D6:8', 'E5:8 F5:8 G5:8 A5:8 B5:8 C6:8 D6:8 E6:8', 'F5:8 G5:8 A5:8 B5:8 C6:8 D6:8 E6:8 F6:8'];
const BUSY_LH = ['C3:8 G3:8 C4:8 G3:8 C3:8 G3:8 C4:8 G3:8', 'F2:8 C3:8 F3:8 C3:8 F2:8 C3:8 F3:8 C3:8', 'G2:8 D3:8 G3:8 D3:8 G2:8 D3:8 G3:8 D3:8', 'C3:8 G3:8 C4:8 G3:8 C3:8 G3:8 C4:8 G3:8'];
const PLAIN_RH = ['C5:h E5:h', 'D5:h F5:h', 'E5:h G5:h', 'F5:h A5:h'];
const PLAIN_LH = ['C3:w', 'F2:w', 'G2:w', 'C3:w'];

/* eight bars: the first four and the last four are the same line, so a passage can be placed anywhere */
function bars(list, n) { const out = []; for (let i = 0; i < n; i++) out.push(list[i % list.length]); return out; }

/* a printed piece (source kind musicxml) of n bars: busy eighths in both hands, or the plain version of the same bars */
function piece(kind, opts) {
  opts = opts || {};
  const n = opts.bars || 8;
  const busy = kind === 'busy';
  return mk(Object.assign({ time: [4, 4], op: 'imported', id: opts.id || (busy ? 'base' : 'variant'),
    rh: bars(busy ? BUSY_RH : PLAIN_RH, n).join(' | '), lh: bars(busy ? BUSY_LH : PLAIN_LH, n).join(' | ') }, opts.spec || {}));
}

const ids = {
  bars: g => g.timeline.measures.map(m => m.id),
  staves: g => g.parts[0].staves.map(s => s.id),
  part: g => g.parts[0]
};

/* edit a clone of a graph with fn(doc, helpers) and seal it again; the new graph is validated and frozen */
function edit(g, fn) {
  const doc = clone(g);
  const h = { bars: doc.timeline.measures.map(m => m.id), staves: doc.parts[0].staves.map(s => s.id), part: doc.parts[0],
    id: prefix => prefix + (doc.nextId++) };
  fn(doc, h);
  return B.seal(doc).graph;
}

/* a graph in which the event of `voiceIdx` at bar index m, position at, is found by its first pitch */
function eventAt(g, m, at, staffIdx) {
  const p = g.parts[0], st = p.staves[staffIdx || 0].id, mid = g.timeline.measures[m].id;
  return p.events.find(e => e.m === mid && e.at === at && e.staff === st && e.kind === 'note' && !e.grace);
}

/* pedal over [from bar, at] .. [to bar, at] */
function addPedal(g, from, to, changes) {
  return edit(g, (doc, h) => {
    const s = { id: h.id('s'), type: 'pedal', pedal: 'damper', from: { m: h.bars[from[0]], at: from[1] }, to: { m: h.bars[to[0]], at: to[1] } };
    if (changes) s.changes = changes.map(c => ({ m: h.bars[c[0]], at: c[1] }));
    h.part.spanners.push(s);
  });
}
/* an 8va line (shift 1) on the upper staff */
function addOttava(g, from, to, staffIdx) {
  return edit(g, (doc, h) => {
    h.part.spanners.push({ id: h.id('s'), type: 'ottava', staff: h.staves[staffIdx || 0], shift: 1, from: { m: h.bars[from[0]], at: from[1] }, to: { m: h.bars[to[0]], at: to[1] } });
  });
}
/* a slur from the event at (bar a, at) to the event at (bar b, at) on the upper staff */
function addSlur(g, a, atA, b, atB) {
  return edit(g, (doc, h) => {
    const from = doc.parts[0].events.find(e => e.m === h.bars[a] && e.at === atA && e.staff === h.staves[0] && e.kind === 'note');
    const to = doc.parts[0].events.find(e => e.m === h.bars[b] && e.at === atB && e.staff === h.staves[0] && e.kind === 'note');
    h.part.spanners.push({ id: h.id('s'), type: 'slur', from: from.id, to: to.id });
  });
}
/* a clef change on a staff at the start of a bar */
function addClef(g, staffIdx, bar, sign, at) {
  return edit(g, (doc, h) => { h.part.clefs.push({ id: h.id('c'), staff: h.staves[staffIdx], m: h.bars[bar], at: at || '0', sign: sign }); });
}
function addDirection(g, bar, at, kind, extra) {
  return edit(g, (doc, h) => {
    const d = Object.assign({ id: h.id('d'), kind: kind, m: h.bars[bar], at: at, staff: h.staves[0] }, extra || {});
    h.part.directions.push(d);
  });
}
/* the same graph with every event of some staff/bar rewritten by fn(event) (events are plain copies) */
function mapEvents(g, fn) {
  return edit(g, (doc, h) => { h.part.events.forEach(e => fn(e, h)); });
}

module.exports = { REPO, SG, mk, piece, bars, ids, edit, eventAt, addPedal, addOttava, addSlur, addClef, addDirection, mapEvents, clone, BUSY_RH, BUSY_LH, PLAIN_RH, PLAIN_LH };
