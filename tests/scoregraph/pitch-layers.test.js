/* D7: which pitch each layer speaks.
     canonical graph  -> concert (what sounds)
     notation / UI    -> written (what is printed)
     sound            -> concert
   A piano part does not transpose, so written and concert are the same note and nothing here may
   change for it. The app-side half of this contract (the sheet draws `writtenP`, the player sounds
   `soundingMidi`) is checked end to end by tests/scoregraph/tools/pitch-layers-check.js, which needs
   the real page. (docs/GOALS/G02_SCORE_IMPORT.md §26) */
const test = require('node:test');
const assert = require('node:assert/strict');
const { SG, xml, importXml, corpus, list, pitchName } = require('./helpers.js');

const P = SG.pitch;
const scoreOf = (name, g) => SG.legacy.toScore(g || importXml(xml(name)).graph, { name: name + '.musicxml' });
const sounding = n => (n.soundingMidi != null ? n.soundingMidi : n.midi);
/* what the sheet draws: the renderer prefers writtenP (App 10659) */
const drawn = n => n.writtenP || n.p;

test('A. a transposing part: the graph is concert, the page is written, the sound is concert (D7)', () => {
  const g = importXml(xml('transposing')).graph;
  const s = scoreOf('transposing', g);

  /* the file's own written pitches, in document order, from the fixture itself */
  const written = [['D5', 74], ['E5', 76], ['F#5', 78], ['C5', 72], ['Bb2', 46], ['F3', 53]];
  const concert = [['C5', 72], ['D5', 74], ['E5', 76], ['Bb4', 70], ['Bb1', 34], ['F2', 41]];

  /* the graph holds concert pitch, and the written pitch is derived from it */
  const heads = [];
  g.parts.forEach(part => part.events.forEach(e => e.heads.forEach(h => heads.push([
    pitchName(h.pitch), P.midi(h.pitch),
    pitchName(P.written(h.pitch, part.instrument.transpose))]))));
  assert.deepEqual(heads.map(h => [h[0], h[1]]), concert, 'the graph is concert pitch');
  assert.deepEqual(heads.map(h => h[2]), written.map(w => w[0]), 'written is derivable from it');

  /* the projection: what is printed, and what sounds */
  assert.deepEqual(s.notes.map(n => [drawn(n), n.writtenMidi]), written, 'the page shows the written pitch');
  assert.deepEqual(s.notes.map(n => [n.p, sounding(n)]), concert, 'and the sound is concert pitch');

  /* the printed key belongs with the printed notes: C major for a clarinet written in C */
  assert.equal(s.measures[0].key.fifths, 0, 'the printed key is the written one');
  assert.equal(g.timeline.keys[0].fifths, -2, 'and the graph keeps the concert key');

  /* what a person plays is never the written note here */
  assert.notDeepEqual(s.notes.map(n => n.writtenMidi), s.notes.map(sounding));
});

test('A2. an octave-transposing part moves by an octave and nothing else (D7)', () => {
  const s = scoreOf('transposing');
  const bass = s.notes.filter(n => n.staff > 1);
  assert.equal(bass.length, 2);
  bass.forEach(n => {
    assert.equal(n.writtenMidi - sounding(n), 12, 'written an octave above what sounds');
    assert.equal(drawn(n).replace(/\d/, ''), n.p.replace(/\d/, ''), 'the same letter, one octave apart');
  });
});

test('B. a piano part does not transpose, so the projection gains nothing (D7)', () => {
  ['grand-staff', 'piano-marks', 'ties-slurs', 'accidentals-printed'].forEach(name => {
    const s = scoreOf(name);
    s.notes.filter(n => !n.rest).forEach(n => {
      assert.equal(n.writtenP, undefined, name + ': no written pitch is invented');
      assert.equal(n.writtenMidi, undefined, name + ': no written MIDI is invented');
      assert.equal(n.soundingMidi, undefined, name + ': no sounding MIDI is invented');
    });
  });
});

test('B2. over every fixture and some real music, a written pitch appears exactly when the part transposes (D7)', () => {
  const jobs = list('xml', '.musicxml').map(f => ({ id: f, text: xml(f.replace(/\.musicxml$/, '')) }))
    .concat(['catalog/fur-elise.musicxml', 'catalog/gymnopedie-1.musicxml', 'catalog/hymns/mighty-fortress.musicxml',
      'catalog/hymns/the-lords-my-shepherd.musicxml', 'catalog/hymns/when-the-roll.musicxml']
      .map(p => ({ id: p, text: corpus(p) })));

  let carried = 0, read = 0;
  jobs.forEach(j => {
    const r = SG.musicxml.import(j.text, { scoreId: 'c', sourceName: j.id });
    if (!r.ok) return;
    read++;
    const transposes = r.graph.parts.some(p => p.instrument && p.instrument.transpose &&
      (p.instrument.transpose.chromatic || p.instrument.transpose.diatonic || p.instrument.transpose.octave));
    const s = SG.legacy.toScore(r.graph, { name: j.id });
    const has = s.notes.some(n => n.writtenP !== undefined);
    assert.equal(has, transposes, j.id + ': a written pitch appears exactly when the part transposes');
    if (has) carried++;
  });
  assert.ok(read > 25, 'enough files were read, got ' + read);
  assert.equal(carried, 1, 'only the transposing fixture carries one');
});

test('C. a microtone keeps its exact value in the graph and says the projection is approximate (D7)', () => {
  const r = importXml(xml('microtone-quarter-sharp'));
  const heads = [];
  r.graph.parts.forEach(p => p.events.forEach(e => e.heads.forEach(h => heads.push(h))));

  /* the file's own value survives, exactly, as the text it was written as */
  const micro = heads.filter(h => h.ext && h.ext['musicxml.microtone']);
  assert.equal(micro.length, 2);
  assert.deepEqual(micro.map(h => h.ext['musicxml.microtone'].alter), ['0.5', '-0.5']);
  /* and the canonical alter is a whole semitone, because canonical JSON carries no floats (A3) */
  micro.forEach(h => assert.equal(Number.isInteger(h.pitch.alter), true));

  /* the import says it out loud */
  assert.deepEqual(r.report.issues.map(i => i.code), ['W-IMPORT-MICROTONE', 'W-IMPORT-MICROTONE']);

  /* the projection marks the notes it could not say exactly */
  const s = SG.legacy.toScore(r.graph, { name: 'microtone-quarter-sharp.musicxml' });
  const approx = s.notes.filter(n => n.approx);
  assert.equal(approx.length, 2, 'both microtones are marked');
  approx.forEach(n => assert.equal(n.approx, 'microtone'));
  /* a note that is exactly what the file said is not marked */
  assert.equal(s.notes.filter(n => !n.rest && !n.approx).length, s.notes.length - 2);
});

test('C2. the report names every approximation it made, and none that it did not (A13, D7)', () => {
  const micro = importXml(xml('microtone-quarter-sharp'));
  assert.deepEqual(micro.report.normalized.map(n => n.what).sort(), ['microtone']);

  const tr = importXml(xml('transposing'));
  assert.deepEqual(tr.report.normalized.map(n => n.what).sort(), ['concert-pitch']);

  /* an ordinary piano file normalises nothing */
  const plain = importXml(xml('grand-staff'));
  assert.deepEqual(plain.report.normalized, []);
});
