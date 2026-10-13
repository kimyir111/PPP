'use strict';
/* omr/flags.js: the boundaries and the report merge that flags.test.js did not pin (G12-3, the independent review of PR #260: seven mutants of the module and the
   confidence of a report whose only suspect bars are the validator's survived the first suite). The numbers here are the fitted ones; nothing is moved. */
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('./lib.js');
const F = L.F;

const bars = (k, edits) => L.plainBars(k, edits);
const clone = g => JSON.parse(JSON.stringify(g));
/* a bar of 12, of 4 or of 2 heads (both hands) */
const heads = k => (k === 12
  ? { rh: new Array(8).fill(0).map((_, i) => L.n(['C5', 'D5', 'E5', 'F5'][i % 4], 0.5)), lh: [L.n('C3', 1), L.n('G3', 1), L.n('C3', 1), L.n('G3', 1)] }
  : k === 4 ? { rh: [L.n('C5', 2), L.n('E5', 2)], lh: [L.n('C3', 2), L.n('G3', 2)] } : { rh: [L.n('C5', 4)], lh: [L.n('C3', 4)] });

test('reasons are said strong first, the weak after, outside flags in the order they came among their kind', async () => {
  const g = await L.graphOf(L.doc(bars(3, { 2: { rh: [L.n('C3', 1), L.n('D3', 1), L.n('E3', 1), L.n('F3', 1)], lh: [L.n('C4', 1), L.n('G3', 1), L.n('C4', 1), L.n('G3', 1)] } })));
  // hands-cross is defined before rebuilt: made weak, with rebuilt strong, the strong one must still come first
  const res = F.analyze(g, { normalize: { flags: { 2: ['pair-merged'] } }, params: { strong: ['rebuilt'], weak: ['hands-cross'], weakNeeded: 2, thr: F.PARAMS.thr },
    external: { 2: ['ext-weak', { code: 'ext-strong', strength: 'strong' }] } });
  assert.deepEqual(res.bars[1].reasons.map(r => r.code), ['rebuilt', 'ext-strong', 'hands-cross', 'ext-weak']);
  assert.deepEqual(res.bars[1].strong, ['rebuilt', 'ext-strong']);
  assert.deepEqual(res.bars[1].weak, ['hands-cross', 'ext-weak']);
});

test('the bad-page threshold is "at least": 3 strong bars of 10 is a bad score, 2 are not', async () => {
  const short = { rh: [L.n('C5', 1), L.n('D5', 1), L.n('E5', 1)] };
  const params = { strong: ['fill-short'], weak: ['bad-page'], weakNeeded: 1, thr: Object.assign({}, F.PARAMS.thr, { badPage: 0.3 }) };
  const three = F.analyze(await L.graphOf(L.doc(bars(10, { 1: short, 4: short, 7: short }))), { params });
  assert.ok(three.bars[9].weak.includes('bad-page') && three.bars[9].suspect, '0.3 is a bad score: the quiet last bar carries it');
  const two = F.analyze(await L.graphOf(L.doc(bars(10, { 1: short, 4: short }))), { params });
  assert.ok(!two.bars[9].weak.includes('bad-page') && !two.bars[9].suspect, '0.2 is not');
  assert.equal(F.PARAMS.thr.badPage, 0.3, 'the fitted number this test stands on');
});

test('the x-misaligned threshold is "at least 20 tenths": 20 fires, 19 does not', async () => {
  const at = d => L.graphOf(L.doc(bars(3, { 2: { rh: [L.n('C5', 1, { x: 10 }), L.n('D5', 1, { x: 60 }), L.n('E5', 1, { x: 110 }), L.n('F5', 1, { x: 160 })],
    lh: [L.n('C3', 1, { x: 10 + d }), L.n('G3', 1, { x: 60 }), L.n('C3', 1, { x: 110 }), L.n('G3', 1, { x: 160 })] } })));
  assert.deepEqual(F.analyze(await at(20), { params: L.only('x-misaligned') }).suspect, [2], '20 apart');
  assert.deepEqual(F.analyze(await at(19), { params: L.only('x-misaligned') }).suspect, [], '19 apart');
  assert.equal(F.PARAMS.thr.xMis, 20, 'the fitted number this test stands on');
});

test('"sparse" compares a bar with the two bars on each side: not one, not three', async () => {
  // heads per bar: 4 2 12 4 [4] 4 12 2 4. The median of two on each side of the fifth is 8 (it is sparse); of one on each side 4, of three on each side 4
  const g = await L.graphOf(L.doc([4, 2, 12, 4, 4, 4, 12, 2, 4].map(heads)));
  const feat = F.derive(F.extract(g));
  assert.equal(feat.bars[4].heads, 4);
  assert.equal(feat.bars[4].hLocal, 0.5);
  assert.ok(F.analyze(g, { params: L.only('sparse', 'weak') }).bars[4].weak.includes('sparse'));
  assert.equal(F.PARAMS.thr.sparse, 0.6, 'the fitted number this test stands on');
});

test('ledger lines: the first ledger line is the one a note sits on; the space above the staff has none', () => {
  // treble clef: the bottom line is E4 (diatonic 30), the top line F5 (38); A5 (40) sits on the first ledger line, G5 (39) in the space above the staff
  assert.equal(F.ledgers(38, 30), 0, 'F5, the top line');
  assert.equal(F.ledgers(39, 30), 0, 'G5, in the space above the staff');
  assert.equal(F.ledgers(40, 30), 1, 'A5, the first ledger line');
  assert.equal(F.ledgers(41, 30), 1, 'B5, above it');
  assert.equal(F.ledgers(42, 30), 2, 'C6, the second');
  assert.equal(F.ledgers(30, 30), 0, 'E4, the bottom line');
  assert.equal(F.ledgers(29, 30), 0, 'D4, in the space below');
  assert.equal(F.ledgers(28, 30), 1, 'C4, the first ledger line below: middle C');
  assert.equal(F.ledgers(27, 30), 1, 'B3');
  assert.equal(F.ledgers(26, 30), 2, 'A3');
  assert.equal(F.ledgers(18, 18), 0, 'bass clef: G2 on its bottom line');
  assert.equal(F.clefBottom({ sign: 'G', line: 2 }), 30);
  assert.equal(F.clefBottom({ sign: 'F', line: 4 }), 18);
});

test('a chord is not a leap: only a single note is measured against the one before it', async () => {
  const g = await L.graphOf(L.doc(bars(3, { 2: { rh: [L.n('C5', 1), L.n('D5', 1), L.n('E5', 1), L.n(['C3', 'E3'], 1)] } })));
  assert.ok(F.extract(g).bars[1].leap < F.PARAMS.thr.leap, 'a chord whose first head is far from the note before it is no leap: ' + F.extract(g).bars[1].leap);
  assert.ok(!F.analyze(g, { params: L.only('big-leap') }).suspect.includes(2), 'bar 2 is not flagged (the note after the chord, in bar 3, is a leap from its top)');
});

test('grace notes take no time and are no notes of the bar: not in the fill, not in the counts', async () => {
  const g = clone(await L.graphOf(L.doc(bars(3))));
  const staff = g.parts[0].staves[0].id, m = g.timeline.measures[1].id;
  const third = g.parts[0].events.filter(e => e.m === m && e.staff === staff)[2];
  // the grace note of the third quarter, written after it in the event list (the order that makes a counted grace note an overlap)
  g.parts[0].events.push({ id: 'eg1', kind: 'note', m: m, at: third.at, dur: '0', voice: third.voice, staff: staff, grace: { order: 1 }, display: { type: 'eighth' }, heads: [{ id: 'hg1', pitch: { step: 'D', oct: 6 } }] });
  const f = F.extract(g).bars[1];
  assert.equal(f.overlap, 0, 'no overlap');
  assert.equal(f.hole, 0);
  assert.equal(f.short, 0);
  assert.equal(f.notes, 8, 'the grace note is not a note of the bar');
  assert.equal(f.heads, 8);
  assert.equal(f.leap, F.extract(await L.graphOf(L.doc(bars(3)))).bars[1].leap, 'and no leap to it or from it');
  assert.deepEqual(F.analyze(g, { params: L.only('fill-short') }).suspect, []);
});

test('the small-score cliff, plainly: three short bars of eight, each bar next to one, turn every bar red and the confidence to 0.24', async () => {
  const short = { rh: [L.n('C5', 1), L.n('D5', 1), L.n('E5', 1)] };
  const res = F.analyze(await L.graphOf(L.doc(bars(8, { 2: short, 4: short, 7: short }))), {});
  assert.deepEqual(res.suspect, [1, 2, 3, 4, 5, 6, 7, 8], '3 of 8 is over the 30 % of a bad score, and each bar has a short neighbour');
  assert.equal(Math.round(res.confidence * 100) / 100, 0.24);
  // one short bar of eight is not a bad score: only that bar
  assert.deepEqual(F.analyze(await L.graphOf(L.doc(bars(8, { 2: short }))), {}).suspect, [2]);
});

test('mergeIntoReport: the confidence is capped whenever any bar is suspect, the validator\'s own included', async () => {
  const numbers = [1, 2, 3, 4, 5, 6, 7, 8];
  const res = F.analyze(await L.graphOf(L.doc(bars(8))), {});
  assert.deepEqual(res.suspect, [], 'the flags mark nothing');
  const validatorOnly = { confidence: 0.8875, level: 'good', suspectMeasures: [3], issues: [{ measure: 3, kind: 'range', message: 'one note falls outside a piano' }], summary: 'Recognition looks clean: 8 measures, 31 notes.', advice: null };
  const out = F.mergeIntoReport(validatorOnly, res, { numbers, notes: 31 });
  assert.ok(out.confidence < F.GOOD, 'capped: ' + out.confidence);
  assert.notEqual(out.level, 'good');
  assert.deepEqual(out.suspectMeasures, [3]);
  assert.ok(/but 1 measure need checking/.test(out.summary) && /measures 3\./.test(out.advice), out.summary + ' | ' + out.advice);
  assert.equal(out.flagCodes, undefined, 'no flag marked a bar: no codes');
  assert.equal(out.flagsVersion, F.VERSION);
  // nothing suspect at all: the report is the validator's
  const clean = { confidence: 1, level: 'good', suspectMeasures: [], issues: [], summary: 'Recognition looks clean: 8 measures, 32 notes.', advice: null };
  const same = F.mergeIntoReport(clean, res, { numbers, notes: 32 });
  assert.equal(same.confidence, 1);
  assert.equal(same.level, 'good');
  assert.equal(same.summary, 'Recognition looks clean: 8 measures, 32 notes.');
  // a bar the flags marked, beside one the validator marked
  const res2 = F.analyze(await L.graphOf(L.doc(bars(8, { 5: { rh: [L.n('C5', 1), L.n('D5', 1), L.n('E5', 1)] } }))), {});
  const both = F.mergeIntoReport({ confidence: 0.95, level: 'good', suspectMeasures: [2], issues: [], summary: 's', advice: null }, res2, { numbers, notes: 30 });
  assert.deepEqual(both.suspectMeasures, [2, 5]);
  assert.deepEqual(both.flagCodes, { 5: ['fill-short'] });
  assert.ok(both.issues.some(i => i.measure === 5 && i.kind === 'flag' && /Measure 5: The notes do not fill this measure\./.test(i.message)));
  assert.ok(both.confidence < F.GOOD);
  // a partial run says so, and is not a clean one
  const part = F.mergeIntoReport({ confidence: 1, level: 'good', suspectMeasures: [], issues: [] }, res, { numbers, notes: 32, partial: 'no-notation-checker' });
  assert.equal(part.flagsPartial, 'no-notation-checker');
  assert.ok(part.issues.some(i => i.kind === 'flags-partial' && i.measure === null));
  // garbage in: the report comes back as it was
  assert.deepEqual(F.mergeIntoReport({ a: 1 }, null, {}), { a: 1 });
});

test('a saved report has codes, not sentences: a code makes its sentence at any time, with or without numbers', () => {
  F.CODES.forEach(code => assert.ok(F.reasonText({ code }, null).length > 10, code));
  assert.equal(F.reasonText({ code: 'page-bars' }), 'Another check doubts this measure.', 'no numbers: no made-up ones');
  assert.equal(F.reasonText({ code: 'bad-page' }), 'Much of this score was hard to read.');
});
