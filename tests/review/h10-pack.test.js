/* G10a-5 (H-10): the drawings of a page are packed (shared glyphs, shared markup fragments) without loss, and the page's own options and Score are
   the app's: read out of the app file, with a planted defect in a copy of the file caught. */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { REPO, heardOf } = require('./h10-helpers.js');
const PACK = require(path.join(REPO, 'review/lib/svgpack.js'));
const APP = require(path.join(REPO, 'review/lib/appcode.js'));
const DRAW = require(path.join(REPO, 'review/lib/h10-draw.js'));
const AS = require(path.join(REPO, 'audio-score.js'));

test('hoist + pack + unpack give every drawing back exactly, and the page holds the glyph definitions once', () => {
  const built = APP.convertHeard(heardOf('nearer'), 'T', true).built;
  const a = DRAW.drawPart(built.graph, [2, 7], 'g-'), b = DRAW.drawPart(built.graph, [4, 9], 'g-');
  const svgs = { a0: a.svg, a1: a.svgNarrow, b0: b.svg, b1: b.svgNarrow };
  const h = PACK.hoistDefs(svgs);
  assert.ok(h.symbols.length > 3 && h.symbols.every(s => /^<symbol id="g-/.test(s)), 'shared symbols with one prefix');
  Object.keys(svgs).forEach(k => assert.ok(!/<defs>/.test(h.bodies[k]), k + ' has no defs left'));
  const p = PACK.pack(h.bodies);
  Object.keys(svgs).forEach(k => {
    assert.equal(PACK.unpack(p.dict, p.packed[k]), h.bodies[k], k + ' unpacks to what was packed');
    const back = PACK.unpack(p.dict, p.packed[k]).replace(/^(<svg[^>]*>)\n?/, '$1\n<defs>\n' + h.symbols.join('\n') + '\n</defs>\n');
    /* the glyphs put back are the drawing's own: every symbol it uses is defined */
    (svgs[k].match(/href="#([^"]+)"/g) || []).forEach(u => assert.ok(back.indexOf('id="' + u.slice(7, -1) + '"') >= 0, k + ' uses ' + u + ' and it is defined'));
  });
  const raw = Object.values(svgs).reduce((n, s) => n + s.length, 0), packed = JSON.stringify(p.dict).length + Object.values(p.packed).reduce((n, s) => n + Buffer.byteLength(s), 0) + h.symbols.join('').length;
  assert.ok(packed < raw * 0.6, 'packing saves at least 40%: ' + packed + ' of ' + raw);
});

test('a glyph that differs between two drawings is an error (never merged), and a drawing with a private-use character is refused', () => {
  assert.throws(() => PACK.hoistDefs({ a: '<svg>\n<defs>\n<symbol id="g-x"><path d="M0 0"/></symbol>\n</defs>\n</svg>', b: '<svg>\n<defs>\n<symbol id="g-x"><path d="M1 1"/></symbol>\n</defs>\n</svg>' }), /drawn differently/);
  assert.throws(() => PACK.pack({ a: 'xy' }), /private-use/);
  assert.throws(() => PACK.hoistDefs({ a: '<svg><defs><symbol id="g-x"></symbol><g/></defs></svg>' }), /other than symbols/);
});

test('tokenize is exact: fragments and numbers put back make the string', () => {
  ['M2.4 5.78H57.09-3 x="-1.25" y="4"', 'no numbers', '12', ''].forEach(s => {
    const t = PACK.tokenize(s);
    assert.equal(t.frags.length, t.nums.length + 1);
    assert.equal(t.frags.map((f, i) => f + (t.nums[i] || '')).join(''), s);
  });
});

test('the page\'s recording options are read from the app file (finishHeard), classic and v2, and a planted defect in a copy of it is caught', () => {
  const o = APP.appOptions();
  assert.deepEqual(o.classic, { title: 'T', easy: false, closeGaps: true, exactBars: true });
  assert.deepEqual(o.v2, { title: 'T', easy: false, closeGaps: true, exactBars: true, recording: 'v2' });
  const html = APP.html();
  const call = 'Object.assign({ title: title, easy: what.mode === \'arrange\', closeGaps: true, exactBars: true }, v2 ? { recording: \'v2\' } : {})';
  assert.ok(html.indexOf(call) >= 0, 'the call the mutants edit is in the page');
  const mutants = {
    'classic loses exactBars': html.replace(call, 'Object.assign({ title: title, easy: what.mode === \'arrange\', closeGaps: true }, v2 ? { recording: \'v2\', exactBars: true } : {})'),
    'classic loses closeGaps': html.replace(call, 'Object.assign({ title: title, easy: what.mode === \'arrange\', exactBars: true }, v2 ? { recording: \'v2\', closeGaps: true } : {})'),
    'classic asks for v2': html.replace(call, 'Object.assign({ title: title, easy: what.mode === \'arrange\', closeGaps: true, exactBars: true, recording: \'v2\' }, {})'),
    'v2 never asked for': html.replace(call, 'Object.assign({ title: title, easy: what.mode === \'arrange\', closeGaps: true, exactBars: true }, {})')
  };
  Object.keys(mutants).forEach(name => assert.throws(() => APP.appOptions(mutants[name]), /appcode/, name + ' is caught'));
});

test('convertHeard is the page\'s conversion: classic = the options of the page, v2 adds recording v2, and the same heard notes give the same result twice', () => {
  const heard = heardOf('know');
  const c = APP.convertHeard(heard, 'T', false), v = APP.convertHeard(heard, 'T', true);
  assert.equal(c.v2, false); assert.equal(v.v2, true); assert.equal(v.rejected, false);
  const direct = AS.toMusicXml({ notes: heard.notes, pedals: heard.pedals, beats: heard.beats, downbeats: heard.downbeats, grid: heard.grid, title: 'T' }, { title: 'T', easy: false, closeGaps: true, exactBars: true });
  assert.equal(c.built.xml, direct.xml, 'the classic arm is toMusicXml with the page\'s classic options');
  assert.equal(APP.convertHeard(heard, 'T', true).built.xml, v.built.xml, 'deterministic');
  assert.notEqual(c.built.xml, v.built.xml);
});

test('the page\'s plausibility check is applied: a v2 result it would not believe is replaced by the classic one and says so', () => {
  const heard = heardOf('know');
  const r = APP.convertHeard(heard, 'T', true, () => ({ ok: false }));
  assert.equal(r.rejected, true); assert.equal(r.v2, false, 'the classic conversion wrote it');
  assert.equal(r.built.xml, APP.convertHeard(heard, 'T', false).built.xml);
  const kept = APP.convertHeard(heard, 'T', true, () => ({ ok: true }));
  assert.equal(kept.rejected, false); assert.equal(kept.v2, true);
  /* and the default check is the page's own (rec/app.js plausible): an ordinary piece passes it */
  assert.equal(APP.convertHeard(heard, 'T', true).rejected, false);
});

test('the app\'s own Score and player plan: ties are one strike, and the strikes of an excerpt are [t, held, midi, velocity] from its first bar', () => {
  const built = APP.convertHeard(heardOf('nearer'), 'T', false).built;
  const p = DRAW.drawPart(built.graph, [3, 8], 'g-');
  const s = p.counts.score;
  assert.equal(p.counts.struck, p.notes.length);
  assert.equal(p.counts.struck, s.heads - s.tieStops, 'every head but the tied continuations is struck');
  assert.ok(p.notes.every(n => n.length === 4 && n[0] >= 0 && n[1] > 0 && n[2] >= 21 && n[2] <= 108 && n[3] > 0), 'shape');
  assert.ok(p.notes[0][0] < 0.5, 'the first strike is near the start of the excerpt');
  assert.ok(p.notes.every((n, i) => i === 0 || p.notes[i - 1][0] <= n[0]), 'sorted by time');
  assert.ok(p.seconds > p.notes[p.notes.length - 1][0], 'the excerpt lasts past its last strike');
});
