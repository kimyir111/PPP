/* rec/pedal.js (G10a-3, stage S9): when a heard pedal becomes a mark. docs/GOALS/G10_AUDIO_TO_SCORE.md sections 8 and 23.
   node --test tests/rec */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { REPO } = require('./helpers.js');
const PEDAL = require(path.join(REPO, 'rec', 'pedal.js'));

/* notes struck every half second from 1 s; each note ends where `release(n)` says */
function notes(count, release) {
  const out = [];
  for (let i = 0; i < count; i++) { const on = 1 + i * 0.5; out.push({ on: on, off: release ? release(on, i) : on + 0.45 }); }
  return out;
}
/* a pedal over [2, 4]: the notes struck in it ring to its end (3 of them are released at 4.0) */
const sustained = notes(10, (on) => (on >= 1.9 && on < 3.9 ? 4.0 : on + 0.45));

test('no pedals, no marks: the browser model hears none and nothing is invented', () => {
  const r = PEDAL.analyse([], sustained);
  assert.deepEqual(r.spans, []);
  assert.equal(r.report.heard, 0);
  assert.deepEqual(PEDAL.analyse(undefined, sustained).spans, []);
  assert.deepEqual(PEDAL.analyse(null, null).spans, []);
});

test('a pedal whose notes ring to its end is written, the mark where those releases are', () => {
  const r = PEDAL.analyse([{ on: 2, off: 4.12 }], sustained);
  assert.equal(r.spans.length, 1);
  assert.equal(r.spans[0].on, 2);
  assert.equal(r.spans[0].off, 4, 'the end of the pedal moves to the release cluster (a pedal edge is less certain than the releases it held)');
  assert.equal(r.spans[0].snapped, true);
  assert.ok(r.spans[0].atEnd >= 2 && r.spans[0].share >= 0.2);
  assert.equal(r.report.kept, 1);
});

test('a pedal that no note agrees with is not written: the invented pedal of five fixtures in six', () => {
  const free = notes(10);                                    /* every note released 0.45 s after its onset: no pedal held anything */
  const r = PEDAL.analyse([{ on: 2, off: 4 }], free);
  assert.deepEqual(r.spans, []);
  assert.deepEqual(r.dropped.map(d => d.why), ['weak']);
  assert.equal(r.report.dropped.weak, 1);
});

test('the policy\'s decisions: a short span, a span over silence, one release is not enough, a small share is not enough', () => {
  assert.deepEqual(PEDAL.analyse([{ on: 2, off: 2.2 }], sustained).dropped.map(d => d.why), ['short']);
  assert.deepEqual(PEDAL.analyse([{ on: 20, off: 22 }], sustained).dropped.map(d => d.why), ['nothing']);
  /* one note released with the pedal-up, the others not */
  const one = notes(10, (on, i) => (i === 4 ? 4.0 : on + 0.1));
  assert.deepEqual(PEDAL.analyse([{ on: 2, off: 4 }], one).dropped.map(d => d.why), ['weak'], 'at least two releases at the end');
  assert.equal(PEDAL.analyse([{ on: 2, off: 4 }], one, { minAt: 1, minShare: 0 }).spans.length, 1, 'and with the rule relaxed it is written');
  /* two of many notes: the share */
  const many = []; for (let i = 0; i < 40; i++) many.push({ on: 2 + i * 0.04, off: i < 2 ? 4 : 2 + i * 0.04 + 0.02 });
  assert.deepEqual(PEDAL.analyse([{ on: 2, off: 4 }], many).dropped.map(d => d.why), ['weak'], 'two of forty is a coincidence, not a pedal');
});

test('the releases must be at the span\'s end within the helper\'s offset error (0.2 s), not elsewhere', () => {
  const near = notes(10, (on) => (on >= 1.9 && on < 3.9 ? 4.15 : on + 0.45));    /* 150 ms after the span's end: still the end */
  const far = notes(10, (on) => (on >= 1.9 && on < 3.9 ? 4.6 : on + 0.45));     /* 600 ms after: not this pedal's end */
  assert.equal(PEDAL.analyse([{ on: 2, off: 4 }], near).spans.length, 1);
  assert.equal(PEDAL.analyse([{ on: 2, off: 4 }], far).spans.length, 0);
});

test('overlapping spans are one pedal; invalid spans are dropped without throwing', () => {
  const r = PEDAL.analyse([{ on: 2, off: 3.2 }, { on: 3, off: 4 }, { on: NaN, off: 1 }, { on: 5, off: 5 }, { on: 6, off: 5 }, null, { on: 'a', off: 2 }], sustained);
  assert.equal(r.report.merged, 1);
  assert.equal(r.spans.length, 1);
  assert.deepEqual([r.spans[0].on, r.spans[0].off], [2, 4]);
  assert.equal(r.report.dropped.invalid, 5);
});

test('a press the model never heard released lasts to the last note (and is judged like any span)', () => {
  const ring = notes(10, (on) => (on >= 1.9 ? 5.5 : on + 0.45));            /* the last note ends at 5.5 */
  const r = PEDAL.analyse([{ on: 2, off: Infinity }], ring);
  assert.equal(r.spans.length, 1);
  assert.equal(r.spans[0].off, 5.5);
  assert.deepEqual(PEDAL.analyse([{ on: 2, off: Infinity }], notes(10)).dropped.map(d => d.why), ['weak']);
  assert.deepEqual(PEDAL.analyse([{ on: 2, off: Infinity }], []).dropped.map(d => d.why), ['invalid'], 'no notes: no end to last to');
});

test('spans come out sorted and disjoint, and the mark never passes the next span', () => {
  const longNotes = notes(20, (on) => (on < 4 ? 3.95 : on < 7.9 ? 8.0 : on + 0.45));
  const r = PEDAL.analyse([{ on: 4.1, off: 8.05 }, { on: 1, off: 4 }], longNotes);
  assert.equal(r.spans.length, 2);
  assert.ok(r.spans[0].on < r.spans[1].on);
  assert.ok(r.spans[0].off <= r.spans[1].on + 1e-9);
});

test('the report adds up and the analysis is deterministic', () => {
  const spans = [{ on: 2, off: 4 }, { on: 2.2, off: 2.3 }, { on: 6, off: 8 }, { on: 30, off: 31 }];
  const a = PEDAL.analyse(spans, sustained), b = PEDAL.analyse(spans, sustained);
  assert.deepEqual(a, b);
  const d = a.report.dropped;
  assert.equal(a.report.kept + d.short + d.nothing + d.weak + d.invalid + a.report.merged, a.report.heard + d.invalid);
});
