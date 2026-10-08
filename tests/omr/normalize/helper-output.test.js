'use strict';
/* omr/helper-output.js (G12-1): the helper returns every movement Audiveris wrote for a page, in order, beside the one-file `musicxml` field it always had. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const H = require('../../../omr/helper-output.js');

const dirs = [];
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'omr-helper-')); dirs.push(d); return d; };
test.after(() => dirs.forEach(d => { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) { void e; } }));
const readText = f => fs.readFileSync(f, 'utf8');

test('movement order: the number after .mvt, not the spelling (mvt10 follows mvt9), and a file without one comes first', () => {
  assert.equal(H.movementOrder('page-1.mvt2.mxl'), 2);
  assert.equal(H.movementOrder('page-1.mvt10.mxl'), 10);
  assert.equal(H.movementOrder('page-1.mxl'), 0);
  assert.equal(H.movementOrder('page.MVT3.MXL'), 3);
  assert.equal(H.movementOrder(null), 0);
  assert.deepEqual(H.movementFiles(['p.mvt10.mxl', 'p.mvt2.mxl', 'p.mvt1.mxl', 'p.omr', 'p.log', 'q.mxl']), ['q.mxl', 'p.mvt1.mxl', 'p.mvt2.mxl', 'p.mvt10.mxl']);
  assert.deepEqual(H.movementFiles(['b.mxl', 'a.mxl']), ['a.mxl', 'b.mxl'], 'ties by name: the order never depends on the file system');
});

test('readMovements: every movement file of the directory, in order; the book-keeping files Audiveris leaves are not read', () => {
  const d = tmp();
  fs.writeFileSync(path.join(d, 'page.mvt2.mxl'), 'second');
  fs.writeFileSync(path.join(d, 'page.mvt1.mxl'), 'first');
  fs.writeFileSync(path.join(d, 'page.omr'), 'book');
  fs.writeFileSync(path.join(d, 'page.log'), 'log');
  assert.deepEqual(H.readMovements(d, readText, 'fallback'), ['first', 'second']);
});

test('readMovements: a page Audiveris did not split is its one file; an unreadable movement is left out; none readable gives the document the caller has', () => {
  const one = tmp();
  fs.writeFileSync(path.join(one, 'page.mxl'), 'only');
  assert.deepEqual(H.readMovements(one, readText, 'only'), ['only']);
  const two = tmp();
  fs.writeFileSync(path.join(two, 'page.mvt1.mxl'), 'good');
  fs.writeFileSync(path.join(two, 'page.mvt2.mxl'), 'bad');
  const reader = f => { if (/mvt2/.test(f)) throw new Error('not a zip'); return readText(f); };
  assert.deepEqual(H.readMovements(two, reader, 'x'), ['good']);
  const none = tmp();
  fs.writeFileSync(path.join(none, 'page.mxl'), 'bad');
  assert.deepEqual(H.readMovements(none, () => { throw new Error('x'); }, 'the-newest'), ['the-newest']);
  assert.deepEqual(H.readMovements(path.join(none, 'missing'), readText, 'the-newest'), ['the-newest']);
  assert.deepEqual(H.readMovements(path.join(none, 'missing'), readText, null), []);
});

test('the helper\'s answer: `musicxml` is untouched (the line that picks the newest file is the one it always was) and `movements` is new', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'omr-service.js'), 'utf8').split('\r\n').join('\n');
  assert.ok(src.includes("      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0] || null;"), 'the newest-file pick');
  assert.ok(src.includes("musicxml: xml, movements: pageMovements(outDir, xml)"));
  assert.ok(src.includes("try { readMovements = require('./omr/helper-output.js').readMovements; } catch (e) { readMovements = null; }"), 'the require is optional');
  assert.ok(src.includes("musicxml: results.map(r => (r.ok ? r.musicxml : null)),"), 'the old field, as it was, with a comma now');
  assert.ok(src.includes("movements: results.map(r => (r.ok ? r.movements : null))"));
});
