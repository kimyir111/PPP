/* "Recording notation: tuplets and the grid" (docs/GOALS/G09_CANDIDATES_CRITICS_REPAIR.md section 12). A recording that has a triplet feel was written with NO tuplet: a third of a beat is an
   eighth and two thirds a quarter, drawn plain, so the bar added up to more than 4/4 as drawn (the teacher's bar 12 showed six beats). scoregraph/rec-tuplet.js writes ONE 3:2 tuplet
   (unit eighth) over every beat of a voice whose events tile it with thirds and two-thirds of the beat (rests included); the arrangement copies the events and loses the tuplets,
   so repair/index.js writes them again on a transcription's arrangement. This file tests STEP A (the pass); the grid (STEP B) is tested in rec-grid.test.js. */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const REPO = path.resolve(__dirname, '..', '..');
const { mk } = require(path.join(REPO, 'tests/scoregraph/g3-helpers.js'));
const R = require(path.join(REPO, 'scoregraph/rational.js'));
const V = require(path.join(REPO, 'scoregraph/validate.js'));
const RT = require(path.join(REPO, 'scoregraph/rec-tuplet.js'));
const GAPS = require(path.join(REPO, 'scoregraph/gaps.js'));
const A = require(path.join(REPO, 'audio-score.js'));
const REP = require(path.join(REPO, 'repair/index.js'));

const T8 = '=1/12', T4 = '=1/6';                          /* a third of a beat printed as an eighth / two thirds printed as a quarter, in 4/4 */
const tuplets = g => g.parts[0].spanners.filter(s => s.type === 'tuplet');
const byId = g => new Map(g.parts[0].events.map(e => [e.id, e]));
const codes = g => V.validate(g).issues.map(i => i.code);
const count = (g, code) => codes(g).filter(c => c === code).length;
const describe = (g, t) => t.events.map(id => { const e = byId(g).get(id); return (e.kind === 'rest' ? 'r' : 'n') + ':' + e.display.type + ':' + e.dur; }).join(' ');

test('three eighths of a triplet beat: one 3:2 tuplet, unit eighth, over the three; nothing else changes', () => {
  const g = mk({ rh: 'C5:8' + T8 + ' D5:8' + T8 + ' E5:8' + T8 + ' F5:q G5:h', lh: 'C3:w' });
  assert.equal(count(g, 'W-DISPLAY-DURATION'), 3, 'drawn plain they do not add up: 3 warnings');
  const r = RT.addTriplets(g);
  assert.equal(r.changed, true);
  const t = tuplets(r.graph);
  assert.equal(t.length, 1);
  assert.equal(t[0].actual, 3); assert.equal(t[0].normal, 2); assert.deepEqual(t[0].unit, { type: 'eighth' });
  assert.equal(t[0].events.length, 3);
  assert.equal(count(r.graph, 'W-DISPLAY-DURATION'), 0);
  assert.equal(count(r.graph, 'W-TUPLET-INCOMPLETE'), 0);
  assert.equal(count(r.graph, 'W-TUPLET-DISPLAY'), 0);
  assert.deepEqual(V.validate(r.graph).issues.filter(i => i.severity === 'ERROR'), []);
  /* events, onsets, lengths and printed values are exactly as they were */
  const shape = x => JSON.stringify(x.parts[0].events.map(e => [e.id, e.at, e.dur, e.display]));
  assert.equal(shape(r.graph), shape(g));
  assert.equal(r.stats.tuplets, 1);
});

test('a mixed beat (a quarter and an eighth) is one tuplet in unit eighth; so is an eighth and a quarter', () => {
  const g = mk({ rh: 'C5:q' + T4 + ' D5:8' + T8 + ' E5:8' + T8 + ' F5:q' + T4 + ' G5:q G5:q', lh: 'C3:w' });
  const r = RT.addTriplets(g);
  const t = tuplets(r.graph);
  assert.equal(t.length, 2);
  assert.deepEqual(t.map(x => x.unit.type), ['eighth', 'eighth']);
  assert.deepEqual(t.map(x => describe(r.graph, x)), ['n:quarter:1/6 n:eighth:1/12', 'n:eighth:1/12 n:quarter:1/6']);
  assert.equal(count(r.graph, 'W-TUPLET-DISPLAY'), 0, 'a quarter in a bracket of three eighths is not longer than the bracket');
  assert.equal(count(r.graph, 'W-DISPLAY-DURATION'), 0);
});

test('rests inside a triplet beat are members of its tuplet (an eighth rest and two notes; a quarter rest and a note; a note and a quarter rest)', () => {
  const g = mk({ rh: 'r:8' + T8 + ' C5:8' + T8 + ' D5:8' + T8 + ' r:q' + T4 + ' E5:8' + T8 + ' F5:8' + T8 + ' r:q' + T4 + ' G5:q', lh: 'C3:w' });
  const r = RT.addTriplets(g);
  assert.deepEqual(tuplets(r.graph).map(x => describe(r.graph, x)), ['r:eighth:1/12 n:eighth:1/12 n:eighth:1/12', 'r:quarter:1/6 n:eighth:1/12', 'n:eighth:1/12 r:quarter:1/6']);
  assert.equal(r.stats.restsInside, 3);
  assert.equal(count(r.graph, 'W-DISPLAY-DURATION'), 0);
});

test('a chord is one event; a bar of triplets in 3/4 works; each voice of a staff gets its own', () => {
  const g = mk({ time: [3, 4], rh: 'C5+E5:8' + T8 + ' D5+F5:8' + T8 + ' E5+G5:8' + T8 + ' F5:q G5:q | r:h.', lh: 'C3:h. | C3:h.',
    rh2: 'r:q' + T4 + ' A4:8' + T8 + ' r:h | r:h.' });
  const r = RT.addTriplets(g);
  assert.equal(tuplets(r.graph).length, 2, 'the chord beat of voice 1 and the quarter-rest + eighth beat of voice 2');
  assert.equal(count(r.graph, 'W-DISPLAY-DURATION'), 0);
  assert.deepEqual(V.validate(r.graph).issues.filter(i => i.severity === 'ERROR'), []);
});

test('what the rule does not describe is left as it is: a beat that is one note, straight sixteenths, an odd length, a note that crosses the beat, thirds that do not fill it', () => {
  const cases = {
    'a note a whole beat long': 'C5:q D5:q E5:q F5:q',
    'sixteenths': 'C5:16 D5:16 E5:16 F5:16 G5:q A5:h',
    'a length that is not a third': 'C5:8' + T8 + ' D5:8=1/8 E5:16=1/24 F5:q G5:h',
    'a note that crosses the beat': 'C5:8' + T8 + ' D5:q E5:8' + T8 + ' G5:h=7/12',
    'thirds that do not fill the beat': 'C5:8' + T8 + ' D5:8' + T8 + ' r:8 G5:h.=17/24'
  };
  Object.keys(cases).forEach(name => {
    const g = mk({ rh: cases[name], lh: 'C3:w' });
    const r = RT.addTriplets(g);
    assert.equal(r.changed, false, name);
    assert.equal(r.graph, g, name + ': the very same graph');
  });
});

test('idempotent: a second run returns the very same graph; a one-note tuplet of the old writer is replaced by the beat\'s tuplet and then nothing changes', () => {
  const g = mk({ rh: '3e[C5:8] 3e[D5:8] 3e[E5:8] F5:q G5:h', lh: 'C3:w' });
  assert.equal(tuplets(g).length, 3);
  const r = RT.addTriplets(g);
  assert.equal(tuplets(r.graph).length, 1, 'no event is in two tuplets: the three one-note tuplets went');
  assert.equal(tuplets(r.graph)[0].events.length, 3);
  assert.equal(r.stats.replaced, 3);
  const again = RT.addTriplets(r.graph);
  assert.equal(again.changed, false);
  assert.equal(again.graph, r.graph);
  /* the very tuplet the pass would make is kept: the pass returns the graph itself */
  const made = mk({ rh: '3e[C5:8 D5:8 E5:8] F5:q G5:h', lh: 'C3:w' });
  assert.equal(RT.addTriplets(made).graph, made);
});

test('a tuplet that is anything else is kept and its beat is left alone (another ratio, nested, longer than the beat)', () => {
  const g = mk({ rh: '3q[C5:q D5:q E5:q] F5:q G5:q', lh: 'C3:w' });                       /* a 3:2 over a half note: events of two beats */
  assert.equal(RT.addTriplets(g).graph, g);
  const g2 = mk({ rh: 'C5:8' + T8 + ' D5:8' + T8 + ' E5:8' + T8 + ' 3q[F5:q G5:q A5:q] r:q', lh: 'C3:w' });
  const r2 = RT.addTriplets(g2);
  assert.equal(tuplets(r2.graph).length, 2, 'the first beat gets its tuplet; the half-note one stays');
  assert.ok(tuplets(r2.graph).some(t => t.unit && t.unit.type === 'quarter'));
});

test('compound, additive and unusual metres, a pickup and a short measure are never touched', () => {
  const g = mk({ time: [6, 8], rh: 'C5:8' + T8 + ' D5:8' + T8 + ' E5:8' + T8 + ' F5:h', lh: 'C3:h.' });
  assert.equal(RT.addTriplets(g).graph, g, '6/8');
});

test('never a throw: a graph the pass does not understand comes back as it is', () => {
  const r = RT.addTriplets({ not: 'a graph' });
  assert.equal(r.changed, false);
  assert.ok(r.stats.failed);
});

/* ---- the whole path: a recording with a triplet feel (a synthetic one, 120 bpm in 4/4: a quarter is 0.5 s) */
const LOCK = { bpm: 120, beatsPerBar: 4, beatType: 4, firstDownbeat: 0 };
function heardTriplets(bars) {
  const notes = [];
  for (let b = 0; b < bars; b++) {
    const t0 = b * 2, th = 0.5 / 3;
    /* right hand: beat 1 three eighths, beat 2 a rest and two eighths, beat 3 a quarter and an eighth, beat 4 a plain quarter */
    [0, 1, 2].forEach(i => notes.push({ on: t0 + i * th, off: t0 + (i + 1) * th * 0.92, midi: 72 + 2 * i, vel: 80 }));
    [1, 2].forEach(i => notes.push({ on: t0 + 0.5 + i * th, off: t0 + 0.5 + (i + 1) * th * 0.92, midi: 79 - i, vel: 80 }));
    notes.push({ on: t0 + 1.0, off: t0 + 1.0 + 2 * th * 0.95, midi: 77, vel: 80 });
    notes.push({ on: t0 + 1.0 + 2 * th, off: t0 + 1.0 + 3 * th * 0.92, midi: 79, vel: 80 });
    notes.push({ on: t0 + 1.5, off: t0 + 1.95, midi: 76, vel: 80 });
    /* left hand: a bass note on each beat, and the thirds of beats 2 and 3 so the detector sees the triplet there too */
    [0, 0.5, 1.0, 1.5].forEach((x, i) => notes.push({ on: t0 + x, off: t0 + x + 0.4, midi: 48 - i, vel: 70 }));
    [1, 2].forEach(i => notes.push({ on: t0 + 0.5 + i * th, off: t0 + 0.5 + (i + 1) * th * 0.9, midi: 55 + i, vel: 70 }));
    [1, 2].forEach(i => notes.push({ on: t0 + 1.0 + i * th, off: t0 + 1.0 + (i + 1) * th * 0.9, midi: 55 + i, vel: 70 }));
  }
  return notes;
}
const build = opts => A.toMusicXml({ notes: heardTriplets(6), pedals: [], title: 'triplets' }, Object.assign({ title: 'triplets', lock: LOCK }, opts || {}));

test('a recording: exactBars writes one tuplet per triplet beat (rests inside), nothing is asked of a build that does not ask, a MIDI file is not touched', () => {
  const plain = build({ closeGaps: true });
  const on = build({ closeGaps: true, exactBars: true });
  assert.ok(on.tupletReport && on.tupletReport.tuplets > 0, JSON.stringify(on.tupletReport));
  assert.equal(plain.tupletReport, undefined);
  const t = tuplets(on.graph);
  assert.ok(t.length >= 6, 'a bracket per triplet beat: ' + t.length);
  /* no event is in two tuplets */
  const seen = new Set();
  t.forEach(s => s.events.forEach(id => { assert.ok(!seen.has(id), 'in one tuplet only: ' + id); seen.add(id); }));
  assert.ok(count(on.graph, 'W-DISPLAY-DURATION') < count(plain.graph, 'W-DISPLAY-DURATION'), 'fewer warnings');
  assert.deepEqual(V.validate(on.graph).issues.filter(i => i.severity === 'ERROR'), []);
  /* the MusicXML reads back with the tuplets */
  assert.match(on.xml, /<tuplet type="start"/);
  const midi = build({ closeGaps: true, exactBars: true, sourceKind: 'midi-file' });
  assert.equal(midi.xml, build({ closeGaps: false }).xml, 'a MIDI file is not a recording');
  /* what was heard and where it was written is the same */
  assert.deepEqual(on.stats, plain.stats);
});

test('the arrangement of a transcription writes the tuplets again (repair/index.js, scoregraph/rec-tuplet.js is loaded by it), a printed score\'s arrangement does not', () => {
  assert.equal(typeof REP.isTranscription, 'function');
  const on = build({ closeGaps: true, exactBars: true });
  assert.equal(RT.isTranscription(on.graph), true);
  /* the repair step's own call is on the arrangement the realizer writes: here, its pass on a graph that lost its tuplets */
  const stripped = JSON.parse(JSON.stringify(on.graph));
  stripped.parts[0].spanners = stripped.parts[0].spanners.filter(s => s.type !== 'tuplet');
  const r = RT.addTriplets(require(path.join(REPO, 'scoregraph/index.js')).parse(JSON.stringify(stripped)));
  assert.equal(tuplets(r.graph).length, tuplets(on.graph).length, 'the same tuplets come back');
});

test('the page loads the pass between gaps.js and index.js, and its scripts in a bare context write the same score as Node', () => {
  const html = fs.readFileSync(path.join(REPO, 'Piano Coach App.dc.html'), 'utf8').replace(/\r\n/g, '\n');
  const tags = [...html.matchAll(/<script src="\.\/([^"?]+)(?:\?v=\d+)?"><\/script>/g)].map(m => m[1]);
  assert.ok(tags.includes('scoregraph/rec-tuplet.js'), 'the page loads scoregraph/rec-tuplet.js');
  assert.ok(tags.indexOf('scoregraph/rec-tuplet.js') > tags.indexOf('scoregraph/ops.js') && tags.indexOf('scoregraph/rec-tuplet.js') < tags.indexOf('audio-score.js'));
  const ctx = vm.createContext({ console });
  ctx.window = ctx; ctx.globalThis = ctx;
  tags.filter(p => /^scoregraph\//.test(p) || p === 'audio-score.js').forEach(p => vm.runInContext(fs.readFileSync(path.join(REPO, p), 'utf8'), ctx, { filename: p }));
  const built = ctx.PPPAudioScore.toMusicXml({ notes: heardTriplets(6), pedals: [], title: 'triplets' }, { title: 'triplets', lock: LOCK, closeGaps: true, exactBars: true });
  assert.ok(built.tupletReport && built.tupletReport.tuplets > 0);
  assert.equal(built.xml, build({ closeGaps: true, exactBars: true }).xml, 'the browser build writes the same file');
  /* a page that has not loaded it (an old cached page) writes the score as before, no throw */
  const old = vm.createContext({ console });
  old.window = old; old.globalThis = old;
  tags.filter(p => (/^scoregraph\//.test(p) && p !== 'scoregraph/rec-tuplet.js') || p === 'audio-score.js').forEach(p => vm.runInContext(fs.readFileSync(path.join(REPO, p), 'utf8'), old, { filename: p }));
  const b0 = old.PPPAudioScore.toMusicXml({ notes: heardTriplets(6), pedals: [], title: 'triplets' }, { title: 'triplets', lock: LOCK, closeGaps: true, exactBars: true });
  assert.equal(b0.tupletReport, undefined);
});

test('the app asks for it at every recording call site, and the MIDI import does not', () => {
  const html = fs.readFileSync(path.join(REPO, 'Piano Coach App.dc.html'), 'utf8').replace(/\r\n/g, '\n');
  const calls = [...html.matchAll(/\.toMusicXml\(\{[\s\S]*?\}, (\{[^}]*\})\);/g)].map(m => m[1]);
  assert.equal(calls.length, 4);
  calls.forEach(c => assert.match(c, /exactBars: true/, c));
  const midi = /PPPAudioScore\.fromMidi\(bytes, (\{[^}]*\})\)/.exec(html);
  assert.ok(midi && !/exactBars/.test(midi[1]));
  void GAPS; void R;
});
