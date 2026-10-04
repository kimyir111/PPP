/* toMusicXml with the key stage (G10a-3, S8): recording 'v2' writes rec/key.js's key, spelling and accidentals; opts.keys
   'legacy' keeps estimateKey / spellingTable under v2; opts.keys 'v2' swaps only S8 on any path; the library default is untouched.
   docs/GOALS/G10_AUDIO_TO_SCORE.md sections 8 and 22. node --test tests/rec */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { REPO } = require('./helpers.js');
const AS = require(path.join(REPO, 'audio-score.js'));
const SG = require(path.join(REPO, 'scoregraph', 'index.js'));

const v2 = { title: 't', closeGaps: true, exactBars: true, recording: 'v2' };
const app = { title: 't', closeGaps: true, exactBars: true };
const MAJOR = [0, 2, 4, 5, 7, 9, 11];

/* a 4/4 performance at 120 quarters a minute: per bar a bass half note and a melody of four quarters over the major
   scale of the section's tonic (a I - IV - V - I bass); `sections` = [[bars, tonic pitch class], ...] */
function performance(sections, opts) {
  opts = opts || {};
  const notes = [];
  let bar = 0;
  const deg = [0, 2, 4, 2, 5, 4, 2, 1, 0, 4, 2, 0, 6, 4, 1, 0];
  sections.forEach(([bars, tonic]) => {
    for (let b = 0; b < bars; b++, bar++) {
      const t0 = 1 + bar * 2;                                   /* seconds: 2 s a bar */
      const bassDeg = [0, 3, 4, 0][b % 4];
      notes.push({ on: t0, off: t0 + 0.95, midi: 36 + tonic + MAJOR[bassDeg], vel: 80 });
      notes.push({ on: t0 + 1, off: t0 + 1.9, midi: 48 + tonic + MAJOR[bassDeg], vel: 60 });
      for (let k = 0; k < 4; k++) notes.push({ on: t0 + k * 0.5, off: t0 + k * 0.5 + 0.45, midi: 60 + tonic + MAJOR[deg[(b * 4 + k) % deg.length]], vel: 70 });
    }
  });
  return { notes: notes.sort((a, b) => a.on - b.on || a.midi - b.midi), bars: bar };
}
const keysOf = xml => (xml.match(/<key>[\s\S]*?<\/key>/g) || []).map(k => +/<fifths>(-?\d+)<\/fifths>/.exec(k)[1]);
const errors = r => SG.validate(r.graph).issues.filter(i => i.severity === 'error');

test('v2 writes the key stage: the key, its report and its provenance; no errors', () => {
  const p = performance([[24, 7]]);
  const r = AS.toMusicXml({ notes: p.notes }, v2);
  assert.deepEqual(keysOf(r.xml), [1]);
  assert.ok(r.keyReport && r.keyReport.report.version === 'key/1');
  assert.equal(r.graph.provenance.sources[0].params.keys.model, 'key/1');
  assert.equal(errors(r).length, 0);
  assert.equal(r.stats.key.fifths, 1);
});

test('opts.keys legacy keeps the legacy key and table under v2 (the before arm of the benchmark)', () => {
  const p = performance([[24, 2]]);
  const r = AS.toMusicXml({ notes: p.notes }, Object.assign({ keys: 'legacy' }, v2));
  assert.equal(r.keyReport, undefined);
  assert.equal(r.graph.provenance.sources[0].params.keys, undefined);
  assert.deepEqual(keysOf(r.xml), [2]);
});

test('the library default and the app\'s options never see the key stage; opts.keys v2 swaps only S8 on the app\'s path', () => {
  const p = performance([[24, 7]]);
  const lib = AS.toMusicXml({ notes: p.notes }, { title: 't' });
  const a = AS.toMusicXml({ notes: p.notes }, app);
  assert.equal(lib.keyReport, undefined);
  assert.equal(a.keyReport, undefined);
  assert.equal(AS.toMusicXml({ notes: p.notes }, Object.assign({ keys: 'legacy' }, app)).xml, a.xml, 'keys legacy is the default');
  const k = AS.toMusicXml({ notes: p.notes }, Object.assign({ keys: 'v2' }, app));
  assert.ok(k.keyReport);
  assert.equal(k.stats.beatSource, a.stats.beatSource, 'the skeleton is the app\'s');
  assert.equal(errors(k).length, 0);
});

test('a modulation is written: C major, E flat major, C major: three key signatures, flats spelled as flats', () => {
  const p = performance([[20, 0], [16, 3], [20, 0]]);
  const r = AS.toMusicXml({ notes: p.notes }, v2);
  assert.deepEqual(keysOf(r.xml), [0, -3, 0]);
  assert.equal(r.keyReport.changes.length, 2);
  assert.equal(errors(r).length, 0);
  /* a spelled E flat has the alter -1 and E step; no D sharp anywhere in the middle */
  assert.ok(/<step>E<\/step>\s*<alter>-1<\/alter>/.test(r.xml));
  assert.ok(!/<step>D<\/step>\s*<alter>1<\/alter>/.test(r.xml));
  /* with keys legacy the whole piece is one key signature */
  const old = AS.toMusicXml({ notes: p.notes }, Object.assign({ keys: 'legacy' }, v2));
  assert.equal(keysOf(old.xml).length, 1);
});

test('a note tied over the bar line brings no accidental into force: the next one of the bar prints it (the E2 accidentals defect)', () => {
  /* C major. Bars 3-4, 7-8, ...: a B flat on beat 4 to the bar line, the next bar's first treble onset a 16th late (the writer ties the B flat
     over the bar line to it), and a B flat again on beat 3 of that bar, which needs its own accidental */
  const notes = [];
  const flatPair = b => (b % 4 === 2 || b % 4 === 3);
  for (let b = 0; b < 20; b++) {
    const t0 = 1 + b * 2;
    notes.push({ on: t0, off: t0 + 0.95, midi: 48, vel: 80 });
    notes.push({ on: t0 + 1, off: t0 + 1.95, midi: 55, vel: 70 });
    if (flatPair(b) && b % 2 === 0) {
      [[0, 64], [0.5, 67], [1, 72]].forEach(([d, m]) => notes.push({ on: t0 + d, off: t0 + d + 0.45, midi: m, vel: 70 }));
      notes.push({ on: t0 + 1.5, off: t0 + 1.98, midi: 70, vel: 70 });
    } else if (flatPair(b)) {
      [[0.125, 72, 0.325], [0.5, 67, 0.45], [1, 70, 0.45], [1.5, 67, 0.45]].forEach(([d, m, l]) => notes.push({ on: t0 + d, off: t0 + d + l, midi: m, vel: 70 }));
    } else {
      [64, 67, 72, 67].forEach((m, k) => notes.push({ on: t0 + k * 0.5, off: t0 + k * 0.5 + 0.45, midi: m, vel: 70 }));
    }
  }
  notes.sort((a, b) => a.on - b.on || a.midi - b.midi);
  const flats = xml => (xml.match(/<accidental>flat<\/accidental>/g) || []).length;
  const ties = xml => (xml.match(/<tie type="stop"/g) || []).length;
  const a = AS.toMusicXml({ notes: notes }, Object.assign({}, v2));
  const b = AS.toMusicXml({ notes: notes }, Object.assign({ keys: 'legacy' }, v2));
  assert.deepEqual(keysOf(a.xml), [0]);
  assert.deepEqual(keysOf(b.xml), [0], 'both arms read C major, so the only difference is the accidentals');
  assert.equal(ties(a.xml), 5, 'a B flat tied over the bar line in each of the five pairs');
  assert.equal(ties(b.xml), 5);
  assert.equal(flats(a.xml), 10, 'two printed per pair of bars: the first B flat, and the one on beat 3 after the tied piece');
  assert.equal(flats(b.xml), 5, 'the legacy writer counted the tied piece as in force: one per pair, the other one missing');
});

test('spelling follows the key signature: a G major piece writes F sharps without ever naming G flat', () => {
  const p = performance([[24, 7]]);
  const r = AS.toMusicXml({ notes: p.notes }, v2);
  assert.ok(!/<step>G<\/step>\s*<alter>-1<\/alter>/.test(r.xml));
  assert.equal(r.stats.key.fifths, 1);
});
