'use strict';
/* practice/runlog.js (G11b-1; docs/GOALS/G11 G11-D4, G11-D5, G11-D6): the run entry, its 2 KB, the log with its cap, its epochs, its export and what it does when
   storage fails. Node only, no dependencies; the same log on IndexedDB is tests/learner-log.test.js (browser). */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const R = require(path.join(__dirname, '..', '..', 'practice', 'runlog.js'));

/* a seeded generator, so a failure is the same failure tomorrow */
function lcg(seed) { let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }

const input = (o) => Object.assign({
  id: 'r1', at: 1000, src: 'measured', mode: 'practice', hands: 'both', tempo: 90, scoreTempo: 100, from: 0, to: 3,
  hints: 0, level: 0, expected: 40, matched: 34, wrong: 1, extra: 0, accuracy: 0.85, rows: [], wrongs: []
}, o);
const rows = (from, to, f) => {
  const out = [];
  for (let mi = from; mi <= to; mi++) for (let h = 0; h < 2; h++) out.push(Object.assign({ mi: mi, h: h, e: 6, k: 5, sd: -70, ad: 190, ids: [mi * 7 + h] }, f ? f(mi, h) : null));
  return out;
};
const entryOf = (o) => R.buildEntry(input(o)).entry;
const mem = (opts) => R.memoryBackend(opts);

/* ---------------------------------------------------------------------------------------------- the run entry */
test('a short run is one row per measure and hand, with the missed ids, in the short keys', () => {
  const b = R.buildEntry(input({ rows: rows(0, 3) }));
  assert.equal(b.g, 1);
  assert.equal(b.ids, true);
  const e = b.entry;
  assert.equal(e.v, 1); assert.equal(e.src, 'measured'); assert.equal(e.md, 'practice'); assert.equal(e.hd, 'b');
  assert.equal(e.tp, 90); assert.equal(e.sr, 0.9); assert.equal(e.f, 0); assert.equal(e.t, 3);
  assert.equal(e.R.length, 8);
  assert.deepEqual(e.R[0], [0, 0, 6, 5, -14, 38, [0]]);
  assert.deepEqual(e.R[1], [0, 1, 6, 5, -14, 38, [1]]);
  assert.ok(R.validEntry(e));
  assert.ok(b.bytes < 600, 'a four-bar lap is a few hundred bytes: ' + b.bytes);
});

test('the signed and absolute means are per matched note; a row nothing matched has no mean', () => {
  const e = entryOf({ rows: [{ mi: 0, h: 0, e: 4, k: 0, sd: 0, ad: 0, ids: [1, 2, 3, 4] }, { mi: 1, h: 0, e: 4, k: 4, sd: -40, ad: 120, ids: [] }] });
  assert.deepEqual(e.R[0], [0, 0, 4, 0, null, null, [1, 2, 3, 4]]);
  assert.deepEqual(e.R[1], [1, 0, 4, 4, -10, 30]);
});

test('a timing that was not measured (Follow) is null, not zero', () => {
  const e = entryOf({ src: 'follow', rows: [{ mi: 0, h: 0, e: 3, k: 3, sd: null, ad: null, ids: null }] });
  assert.deepEqual(e.R[0], [0, 0, 3, 3, null, null]);
});

test('every run is at most 2000 bytes, whatever its length: neighbouring measures are merged until it fits', () => {
  const rnd = lcg(11);
  for (let trial = 0; trial < 400; trial++) {
    const span = 1 + Math.floor(rnd() * 400);
    const from = Math.floor(rnd() * 20);
    const rs = rows(from, from + span - 1, (mi, h) => ({ e: 1 + Math.floor(rnd() * 12), k: Math.floor(rnd() * 6), sd: Math.round((rnd() - 0.5) * 900), ad: Math.round(rnd() * 900), ids: rnd() < 0.4 ? [mi, mi + 1, mi + 2, mi + 3, mi + 4, mi + 5, mi + 6] : [] }));
    const w = []; for (let mi = from; mi < from + span; mi += 3) w.push({ mi: mi, w: 1, x: 2 });
    const b = R.buildEntry(input({ from: from, to: from + span - 1, rows: rs, wrongs: w, expected: 99999, matched: 88888, wrong: 123456, extra: 654321 }));
    assert.ok(b.bytes <= R.CAPS.body, 'span ' + span + ' gave ' + b.bytes + ' bytes');
    assert.equal(R.byteLen(JSON.stringify(b.entry)), b.bytes);
    assert.ok(b.bytes <= R.CAPS.bytes - 32, 'leaves room for a rating and the key of a rating');
    assert.ok(R.validEntry(b.entry), 'trial ' + trial);
    assert.ok(!b.entry.tr, 'rows are merged before they are given up: span ' + span);
  }
});

test('merging keeps the counts: the expected and matched notes of the rows add up to the run\'s, and the means are the weighted ones', () => {
  const rs = rows(0, 99, (mi, h) => ({ e: 4, k: 3, sd: 3 * (mi % 7 - 3), ad: 3 * (10 + mi % 5), ids: [] }));
  const b = R.buildEntry(input({ from: 0, to: 99, rows: rs, expected: 800, matched: 600 }));
  assert.ok(b.g >= 2);
  assert.equal(b.entry.R.reduce((a, r) => a + r[2], 0), 800);
  assert.equal(b.entry.R.reduce((a, r) => a + r[3], 0), 600);
  const sd = rs.reduce((a, r) => a + r.sd, 0) / 600, ad = rs.reduce((a, r) => a + r.ad, 0) / 600;
  const mSd = b.entry.R.reduce((a, r) => a + r[4] * r[3], 0) / 600, mAd = b.entry.R.reduce((a, r) => a + r[5] * r[3], 0) / 600;
  assert.ok(Math.abs(mSd - sd) < 1 && Math.abs(mAd - ad) < 1, 'signed ' + mSd + ' vs ' + sd + ', absolute ' + mAd + ' vs ' + ad);
  /* the segments start where the run starts */
  assert.ok(b.entry.R.every(r => (r[0] - b.entry.f) % b.g === 0));
});

test('missed ids are kept while they fit (at most 6 a row, 36 a run) and are the first thing given up', () => {
  const many = rows(0, 5, () => ({ e: 20, k: 5, ids: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] }));
  const e = entryOf({ from: 0, to: 5, rows: many });
  assert.ok(e.R.every(r => !r[6] || r[6].length <= R.CAPS.ids));
  assert.ok(e.R.reduce((a, r) => a + (r[6] ? r[6].length : 0), 0) <= R.CAPS.idsTotal);
  /* somewhere between "everything fits" and "the rows must be merged" there is a run whose rows fit and whose ids do not: the ids are what goes first */
  let sawIdsGone = false;
  for (let bars = 20; bars <= 80 && !sawIdsGone; bars++) {
    const b = R.buildEntry(input({ from: 0, to: bars - 1, rows: rows(0, bars - 1, (mi) => ({ ids: [mi, mi + 1, mi + 2, mi + 3, mi + 4, mi + 5] })) }));
    if (b.g === 1 && b.ids === false) sawIdsGone = true;
    if (b.g > 1) break;
  }
  assert.ok(sawIdsGone, 'with a bar more every time, the ids are dropped while the rows are still one per measure and hand');
});

test('wrong and extra keys are per measure, only where there are any, merged with the rows', () => {
  const e = entryOf({ from: 0, to: 3, rows: rows(0, 3), wrongs: [{ mi: 1, w: 2, x: 0 }, { mi: 2, w: 0, x: 0 }, { mi: 3, w: 0, x: 1 }] });
  assert.deepEqual(e.W, [[1, 2, 0], [3, 0, 1]]);
});

test('the header: tempo ratio, hands, memory, hints, accuracy', () => {
  const e = entryOf({ src: 'memory', mode: 'memory', hands: 'left', tempo: 63, scoreTempo: 84, hints: 2, level: 3, accuracy: 0.123456 });
  assert.equal(e.md, 'memory'); assert.equal(e.hd, 'l'); assert.equal(e.sr, 0.75); assert.equal(e.hn, 2); assert.equal(e.lv, 3); assert.equal(e.ac, 0.123);
});

test('validEntry refuses what is not a run', () => {
  const good = entryOf({ rows: rows(0, 1) });
  assert.ok(R.validEntry(good));
  assert.ok(!R.validEntry(null) && !R.validEntry('x') && !R.validEntry([]));
  assert.ok(!R.validEntry(Object.assign({}, good, { v: 2 })));
  assert.ok(!R.validEntry(Object.assign({}, good, { src: 'guessed' })));
  assert.ok(!R.validEntry(Object.assign({}, good, { R: [[0, 2, 1, 1, null, null]] })));
  assert.ok(!R.validEntry(Object.assign({}, good, { R: [[0, 0, 1]] })));
  assert.ok(!R.validEntry(Object.assign({}, good, { at: NaN })));
  assert.ok(!R.validEntry(Object.assign({}, good, { id: '' })));
});

/* ---------------------------------------------------------------------------------------------- reading the matcher */
const idx = n => n - 1;
test('rowsFromEngine: per measure index and hand; a miss keeps the note id; deltas are signed', () => {
  const notes = [{}, {}, {}, {}, {}];
  const info = { idxOf: idx, noteId: n => notes.indexOf(n) };
  const perf = { expected: [
    { m: 1, hand: 'r', matched: true, deltaMs: -20, note: notes[0] },
    { m: 1, hand: 'r', matched: true, deltaMs: 50, note: notes[1] },
    { m: 1, hand: 'l', matched: false, deltaMs: null, note: notes[2] },
    { m: 2, hand: 'l', matched: true, deltaMs: 7, note: notes[3] },
    { m: 9, hand: 'r', matched: true, deltaMs: 1, note: notes[4] }
  ] };
  const rr = R.rowsFromEngine(perf, { idxOf: n => (n === 9 ? -1 : n - 1), noteId: info.noteId });
  assert.equal(rr.expected, 4); assert.equal(rr.matched, 3);
  assert.deepEqual(rr.rows.map(r => [r.mi, r.h, r.e, r.k, r.sd, r.ad, r.ids]), [[0, 0, 2, 2, 30, 70, []], [0, 1, 1, 0, 0, 0, [2]], [1, 1, 1, 1, 7, 7, []]]);
});

test('rowsFromResult: totals and absolute timing per hand; no signed mean, no ids', () => {
  const h = (t, m, a, c) => ({ total: t, matched: m, timingAbsSum: a, timingCount: c });
  const rr = R.rowsFromResult({ byMeasure: { 1: { hands: { r: h(4, 3, 90, 3), l: h(2, 2, 0, 0) } }, 2: { hands: { r: h(0, 0, 0, 0), l: h(3, 0, 0, 0) } } } }, { idxOf: idx });
  assert.deepEqual(rr.rows.map(r => [r.mi, r.h, r.e, r.k, r.sd, r.ad]), [[0, 0, 4, 3, null, 90], [0, 1, 2, 2, null, null], [1, 1, 3, 0, null, 0]]);
  assert.equal(rr.expected, 9); assert.equal(rr.matched, 5);
  assert.deepEqual(R.wrongsFromResult({ byMeasure: { 1: { wrong: 2, extra: 0 }, 2: { wrong: 0, extra: 0 }, 3: { wrong: 0, extra: 4 } } }, { idxOf: idx }), [{ mi: 0, w: 2, x: 0 }, { mi: 2, w: 0, x: 4 }]);
});

test('scoreInfo: measure index by number (first of a repeated number), note ids, one hash per Score object', () => {
  const notes = [{ m: 1, b: 0 }, { m: 2, b: 0 }];
  const score = { measures: [{ number: 0 }, { number: 1 }, { number: 1 }], notes: notes, tempo: 80, title: 'T' };
  let calls = 0;
  const info = R.scoreInfo(score, () => { calls++; return { hash: 'abc', hashV: 'h2' }; });
  assert.equal(info.idxOf(0), 0); assert.equal(info.idxOf(1), 1); assert.equal(info.idxOf(7), -1);
  assert.equal(info.noteId(notes[1]), 1); assert.equal(info.noteId({}), -1);
  assert.deepEqual(info.hash(), { hash: 'abc', hashV: 'h2' });
  info.hash(); R.scoreInfo(score, () => { calls++; return 'zzz'; }).hash();
  assert.equal(calls, 1);
  assert.equal(R.scoreInfo({ measures: [], notes: [] }, () => 'plain').hash().hashV, 'h2');
  assert.equal(R.scoreInfo({ measures: [], notes: [] }, () => { throw new Error('no'); }).hash().hashV, 'x1');
});

test('the fallback hash follows the music, not the title', () => {
  const mk = (midi, title) => ({ title: title, measures: [{ number: 1, lenQ: 4 }], notes: [{ m: 1, b: 0, dur: 1, midi: midi, hand: 'r', staff: 1 }, { m: 1, b: 1, dur: 1, midi: 62, hand: 'r', staff: 1 }] });
  assert.equal(R.localHash(mk(60, 'A')), R.localHash(mk(60, 'B')));
  assert.notEqual(R.localHash(mk(60, 'A')), R.localHash(mk(61, 'A')));
  assert.match(R.localHash(mk(60, 'A')), /^[0-9a-f]{16}$/);
});

/* ---------------------------------------------------------------------------------------------- the log */
const run = (n, o) => entryOf(Object.assign({ id: 'r' + n, at: 1000 + n, rows: rows(0, 1) }, o));
const meta = { measures: 64, scoreTempo: 84, title: 'Etude' };

test('append and read: runs come back in order, with their sequence numbers', async () => {
  const log = R.createLog({ backend: mem() });
  for (let i = 1; i <= 3; i++) assert.deepEqual(await log.append('song-a', 'h1', run(i), meta, 'h2'), { ok: true, n: i, dropped: 0 });
  const r = await log.read('song-a', 'h1');
  assert.equal(r.ok, true);
  assert.deepEqual(r.runs.map(x => x.n), [1, 2, 3]);
  assert.deepEqual(r.runs.map(x => x.run.id), ['r1', 'r2', 'r3']);
  assert.equal(r.current, true);
  assert.equal(r.epoch.measures, 64); assert.equal(r.epoch.title, 'Etude'); assert.equal(r.epoch.hashV, 'h2'); assert.equal(r.epoch.runs, 3);
  assert.equal(log.stats.appended, 3);
});

test('300 runs per epoch: the 301st drops the oldest, ratings with it', async () => {
  const log = R.createLog({ backend: mem() });
  await log.append('s', 'h', run(1), meta);
  assert.deepEqual(await log.rate('s', 'h', 1, 3), { ok: true });
  assert.deepEqual(await log.rate('s', 'h', 99, 3), { ok: false, code: 'no-run' });
  for (let i = 2; i <= 310; i++) await log.append('s', 'h', run(i), meta);
  const r = await log.read('s', 'h');
  assert.equal(r.runs.length, 300);
  assert.equal(r.runs[0].n, 11); assert.equal(r.runs[299].n, 310);
  assert.equal(log.stats.dropped, 10);
  assert.equal(r.runs[0].run.rt, undefined, 'the rating of run 1 went with run 1');
  const b = ((await log.read('s', 'h')).runs);
  assert.ok(b.every(x => R.byteLen(JSON.stringify(x.run)) <= 2048));
  /* the cap is per epoch */
  await log.append('s', 'other', run(1), meta);
  assert.equal((await log.read('s', 'h')).runs.length, 300);
  assert.equal((await log.read('s', 'other')).runs.length, 1);
});

test('the cap can be set (a test or a smaller device), and numbers keep rising after evictions', async () => {
  const log = R.createLog({ backend: mem(), caps: { runs: 4 } });
  for (let i = 1; i <= 9; i++) await log.append('s', 'h', run(i), meta);
  const r = await log.read('s', 'h');
  assert.deepEqual(r.runs.map(x => x.n), [6, 7, 8, 9]);
});

test('a ratings is a separate record: it shows as rt, rating again replaces it, only 1, 2, 3 are ratings', async () => {
  const log = R.createLog({ backend: mem() });
  await log.append('s', 'h', run(1), meta);
  await log.append('s', 'h', run(2), meta);
  assert.equal((await log.rate('s', 'h', 2, 1)).ok, true);
  assert.equal((await log.rate('s', 'h', 2, 3)).ok, true);
  for (const bad of [0, 4, '2', null]) assert.deepEqual(await log.rate('s', 'h', 1, bad), { ok: false, code: 'invalid' });
  const r = await log.read('s', 'h');
  assert.deepEqual(r.runs.map(x => x.run.rt), [undefined, 3]);
  assert.equal(log.stats.rated, 2);
});

test('a simulated run is not evidence: append refuses it, the epoch counts it', async () => {
  const log = R.createLog({ backend: mem() });
  const sim = Object.assign({}, run(1), { src: 'simulated' });
  assert.deepEqual(await log.append('s', 'h', sim, meta), { ok: false, code: 'simulated' });
  assert.deepEqual(await log.append('s', 'h', null, meta), { ok: false, code: 'simulated' });
  assert.equal(log.stats.refused.simulated, 2);
  assert.deepEqual(await log.noteSimulated('s', 'h', meta, 'h2'), { ok: true, sim: 1 });
  assert.deepEqual(await log.noteSimulated('s', 'h', meta, 'h2'), { ok: true, sim: 2 });
  const ev = await log.evidence('s', 'h');
  assert.equal(ev.runs.length, 0);
  assert.equal(ev.epoch.sim.n, 2);
  assert.equal((await log.epochs('s')).epochs[0].sim.n, 2);
  await log.append('s', 'h', run(1), meta);
  assert.equal((await log.evidence('s', 'h')).runs.length, 1);
  assert.equal((await log.evidence('s', 'h')).epoch.sim.n, 2, 'the counter survives a real run');
});

test('a row that says simulated is skipped and counted however it got into the store', async () => {
  const be = mem();
  const log = R.createLog({ backend: be });
  await log.append('s', 'h', run(1), meta);
  be._raw.runs.get('s|h').push({ ep: 's|h', n: 2, e: Object.assign({}, run(2), { src: 'simulated' }) });
  const ev = await log.evidence('s', 'h');
  assert.deepEqual(ev.runs.map(x => x.n), [1]);
  assert.equal(log.stats.corrupt, 1);
});

test('what is not a run, or not a key, is refused before it reaches the store', async () => {
  const be = mem();
  const log = R.createLog({ backend: be });
  assert.deepEqual(await log.append('', 'h', run(1), meta), { ok: false, code: 'key' });
  assert.deepEqual(await log.append('s', '', run(1), meta), { ok: false, code: 'key' });
  assert.deepEqual(await log.append('s', 'h', { v: 1 }, meta), { ok: false, code: 'invalid' });
  const huge = run(1); huge.R = []; for (let i = 0; i < 400; i++) huge.R.push([i, 0, 1, 1, null, null]);
  assert.deepEqual(await log.append('s', 'h', huge, meta), { ok: false, code: 'too-large' });
  assert.equal((await log.epochs()).epochs.length, 0);
  assert.equal(log.stats.appended, 0);
});

test('a new music hash is a new epoch: the old one stays, read-only; the song has one current epoch', async () => {
  const log = R.createLog({ backend: mem() });
  await log.append('s', 'A', run(1), meta);
  await log.append('s', 'A', run(2), meta);
  await log.append('s', 'B', run(3), Object.assign({}, meta, { measures: 70 }));
  await log.append('t', 'A', run(4), meta);
  const eps = (await log.epochs()).epochs;
  assert.deepEqual(eps.map(e => [e.songId, e.hash, e.current, e.readOnly, e.runs]), [['s', 'A', false, true, 2], ['s', 'B', true, false, 1], ['t', 'A', true, false, 1]]);
  assert.equal(eps[1].measures, 70);
  assert.deepEqual((await log.read('s', 'A')).runs.map(x => x.n), [1, 2], 'the old epoch is untouched');
  assert.equal((await log.read('s', 'A')).current, false);
  /* going back to the old music (Undo of a rewrite) takes it up again */
  await log.append('s', 'A', run(5), meta);
  const back = (await log.epochs('s')).epochs;
  assert.deepEqual(back.map(e => [e.hash, e.current, e.runs]), [['A', true, 3], ['B', false, 1]]);
});

test('forget(song) takes every epoch of that song and nothing of another', async () => {
  const log = R.createLog({ backend: mem() });
  await log.append('s', 'A', run(1), meta); await log.append('s', 'B', run(2), meta); await log.append('t', 'A', run(3), meta);
  await log.rate('s', 'A', 1, 2);
  assert.deepEqual(await log.forget('s'), { ok: true });
  assert.deepEqual((await log.epochs()).epochs.map(e => e.songId + '|' + e.hash), ['t|A']);
  assert.equal((await log.read('s', 'A')).runs.length, 0);
});

test('a damaged epoch record is repaired by the next run; the runs already kept stay and numbering goes on', async () => {
  const be = mem();
  const log = R.createLog({ backend: be });
  for (let i = 1; i <= 3; i++) await log.append('s', 'h', run(i), meta);
  be._raw.epochs.set('s|h', { ep: 's|h', songId: 's', hash: 12 });
  assert.deepEqual((await log.epochs()).epochs, [], 'a damaged epoch is not listed');
  assert.equal(log.stats.corrupt, 1);
  const r = await log.append('s', 'h', run(4), meta);
  assert.deepEqual([r.ok, r.n], [true, 4]);
  assert.equal(log.stats.repaired, 1);
  assert.deepEqual((await log.read('s', 'h')).runs.map(x => x.n), [1, 2, 3, 4]);
  assert.equal((await log.epochs()).epochs[0].runs, 4);
});

/* ---------------------------------------------------------------------------------------------- the file */
test('the export: only the log\'s own fields, and parseExport gives back exactly the log', async () => {
  const be = mem();
  const log = R.createLog({ backend: be, now: () => Date.UTC(2026, 9, 8, 12) });
  await log.append('s', 'A', run(1), meta, 'h2'); await log.append('s', 'A', run(2), meta, 'h2'); await log.rate('s', 'A', 2, 2);
  await log.append('s', 'B', run(3), meta, 'h2');
  await log.noteSimulated('t', 'X', { measures: 8, title: 'Demo' }, 'h2');
  /* things a bug or a hostile page could have put in the store: extra keys on a run, a secret in a field the file does not carry */
  be._raw.runs.get('s|A')[0].e.secret = 'PC-CODE-1234';
  be._raw.runs.get('s|A')[0].e.token = 'GUEST-KEY';
  be._raw.epochs.get('s|A').guestKey = 'GUEST-KEY';
  const ex = await log.exportAll();
  assert.equal(ex.ok, true);
  const text = R.exportText(ex.file);
  assert.ok(!/PC-CODE|GUEST-KEY|secret|token|guestKey/.test(text), 'nothing but the known fields leaves');
  assert.deepEqual(Object.keys(ex.file), ['format', 'version', 'exportedAt', 'schema', 'epochs', 'skipped']);
  assert.equal(ex.file.exportedAt, Date.UTC(2026, 9, 8, 12));
  assert.equal(R.fileName(ex.file.exportedAt), 'ppp-practice-log-20261008.json');
  assert.deepEqual(ex.file.epochs.map(e => [e.songId, e.hash, e.current, e.runs.length, e.sim.n]), [['s', 'A', false, 2, 0], ['s', 'B', true, 1, 0], ['t', 'X', true, 0, 1]]);
  assert.equal(ex.file.epochs[0].runs[1].rt, 2);
  const back = R.parseExport(text);
  assert.equal(back.ok, true);
  assert.equal(back.rejected, 0);
  assert.deepEqual(back.file.epochs, ex.file.epochs);
  assert.equal(R.exportText(back.file), text);
});

test('parseExport refuses what is not an export and drops what is not a run', async () => {
  assert.deepEqual(R.parseExport('{'), { ok: false, code: 'json' });
  assert.deepEqual(R.parseExport('[]'), { ok: false, code: 'format' });
  assert.deepEqual(R.parseExport(JSON.stringify({ format: 'other', version: 1, epochs: [] })), { ok: false, code: 'format' });
  assert.deepEqual(R.parseExport(JSON.stringify({ format: 'ppp-practice-log', version: 2, epochs: [] })), { ok: false, code: 'version' });
  assert.deepEqual(R.parseExport(JSON.stringify({ format: 'ppp-practice-log', version: 1 })), { ok: false, code: 'epochs' });
  const good = Object.assign({ n: 1 }, run(1));
  const r = R.parseExport(JSON.stringify({ format: 'ppp-practice-log', version: 1, epochs: [
    { songId: 's', hash: 'h', runs: [good, { n: 2, v: 1 }, Object.assign({ n: 3 }, run(3), { src: 'simulated' }), Object.assign({ n: 4, extra: 'x' }, run(4))] },
    { songId: 7 }] }));
  assert.equal(r.ok, true);
  assert.equal(r.rejected, 3);
  assert.deepEqual(r.file.epochs[0].runs.map(x => x.n), [1, 4]);
  assert.equal(r.file.epochs[0].runs[1].extra, undefined);
});

/* ---------------------------------------------------------------------------------------------- failing storage */
const quota = () => Object.assign(new Error('The quota has been exceeded.'), { name: 'QuotaExceededError' });
test('storage full: the first failure degrades the log once, later calls are skipped and never reach the store', async () => {
  let calls = 0;
  const degrades = [];
  const log = R.createLog({ backend: mem({ fail: op => { calls++; return quota(); } }), onDegrade: c => degrades.push(c) });
  const first = await log.append('s', 'h', run(1), meta);
  assert.deepEqual(first, { ok: false, code: 'quota' });
  for (let i = 2; i <= 9; i++) assert.deepEqual(await log.append('s', 'h', run(i), meta), { ok: false, code: 'degraded' });
  assert.deepEqual(await log.noteSimulated('s', 'h', meta), { ok: false, code: 'degraded' });
  assert.equal(calls, 1, 'one call reached the store');
  assert.equal(log.degraded, 'quota');
  assert.deepEqual(degrades, ['quota']);
  assert.equal(log.stats.errors.quota, 1);
  assert.equal(log.stats.skipped, 9);
  assert.equal(log.stats.appended, 0);
  assert.deepEqual(await log.exportAll(), { ok: false, code: 'degraded' });
});

test('each way storage can fail has its own name', async () => {
  const cases = [
    ['blocked', Object.assign(new Error('denied'), { name: 'SecurityError' })],
    ['version', Object.assign(new Error('The requested version is less than the existing version.'), { name: 'VersionError' })],
    ['backend', new Error('disk on fire')],
    ['quota', quota()]
  ];
  for (const [code, err] of cases) {
    const log = R.createLog({ backend: mem({ fail: () => err }) });
    assert.deepEqual(await log.append('s', 'h', run(1), meta), { ok: false, code: code }, code);
    assert.equal(log.degraded, code);
  }
  const noIdb = R.createLog({ backend: R.idbBackend(null) });
  assert.deepEqual(await noIdb.append('s', 'h', run(1), meta), { ok: false, code: 'blocked' }, 'no indexedDB at all');
});

test('a store that never answers: the call times out, the log is degraded once', async () => {
  const hang = mem();
  hang.append = () => new Promise(() => {});
  const log = R.createLog({ backend: hang, caps: { timeout: 40 } });
  const t0 = Date.now();
  const p1 = log.append('s', 'h', run(1), meta), p2 = log.append('s', 'h', run(2), meta), p3 = log.noteSimulated('s', 'h', meta);
  assert.deepEqual(await p1, { ok: false, code: 'timeout' });
  assert.deepEqual(await p2, { ok: false, code: 'degraded' });
  assert.deepEqual(await p3, { ok: false, code: 'degraded' });
  assert.ok(Date.now() - t0 < 1000);
  assert.equal(log.stats.errors.timeout, 1);
});

test('a read that fails also degrades the log, and never throws', async () => {
  const log = R.createLog({ backend: mem({ fail: op => (op === 'readEpoch' ? new Error('boom') : null) }) });
  await log.append('s', 'h', run(1), meta);
  assert.deepEqual(await log.read('s', 'h'), { ok: false, code: 'backend' });
  assert.equal(log.degraded, 'backend');
  assert.deepEqual(await log.append('s', 'h', run(2), meta), { ok: false, code: 'degraded' });
});

test('damaged rows are read around and counted; the rest of the log is intact', async () => {
  const be = mem();
  const log = R.createLog({ backend: be });
  for (let i = 1; i <= 3; i++) await log.append('s', 'h', run(i), meta);
  const rows = be._raw.runs.get('s|h');
  rows.push({ ep: 's|h', n: 10, e: 'garbage' }, { ep: 's|h', n: 11, e: { v: 1, id: 'x' } }, { ep: 's|h', n: 12, e: null }, { ep: 's|h', n: 'x', e: run(9) });
  const ex = await log.exportAll();
  assert.equal(ex.ok, true);
  assert.deepEqual(ex.file.epochs[0].runs.map(r => r.n), [1, 2, 3]);
  assert.equal(ex.file.skipped.corrupt, 4);
  assert.equal(log.degraded, null);
});

test('warmUp compiles the paths of a lap and writes nothing (no window: no log either)', () => {
  assert.equal(R.warmUp(null), true);
});
