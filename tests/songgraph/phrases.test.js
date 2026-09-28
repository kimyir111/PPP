/* songgraph/phrases.js: cadence detection and the phrases built from it. No prior art exists in
   this codebase (design doc §3) - these tests plant the two textbook signals the module actually
   looks for (harmonic-rhythm/melodic-closure, per the design doc's own phrasing) and confirm they
   are found, and that a piece with no such signal is not over-segmented. */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { PH, mk } = require('./helpers.js');

/* I - V - I with the melody landing on the tonic and holding: a textbook authentic cadence. */
const CADENTIAL = {
  time: [4, 4],
  rh: 'C5:q E5:q G5:q C6:q | B4:q D5:q G5:q B5:q | C5:w',
  lh: 'C3:w | G2:w | C3:w'
};

test('phrasesOf: a V-I resolution with a held tonic melody note is found as an authentic cadence', () => {
  const g = mk(CADENTIAL);
  const [{ cadences, phrases }] = PH.phrasesOf(g);
  assert.ok(cadences.some(c => c.type === 'authentic'), 'expected an authentic cadence: ' + JSON.stringify(cadences));
  assert.ok(phrases.length >= 2, 'a cadence should split the piece into at least two phrases');
});

test('phrasesOf: one held chord for the whole piece (no harmonic motion at all) reports no cadence', () => {
  const g = mk({ time: [4, 4], rh: 'C5:w | C5:w | C5:w', lh: 'C3:w | C3:w | C3:w' });
  const [{ cadences, phrases }] = PH.phrasesOf(g);
  assert.equal(cadences.length, 0);
  assert.equal(phrases.length, 1, 'no cadence found should mean one phrase covering the whole piece');
});

test('phrasesOf: constant eighth-note motion with no chord ever settling reports no authentic cadence', () => {
  const g = mk({ time: [4, 4], rh: 'C5:8 D5:8 E5:8 F5:8 G5:8 A5:8 B5:8 C6:8 | D6:8 E6:8 F#6:8 G6:8 A6:8 B6:8 C7:8 D7:8', lh: 'C3:w | D3:w' });
  const [{ cadences }] = PH.phrasesOf(g);
  assert.ok(!cadences.some(c => c.type === 'authentic'), 'nothing here ever resolves or holds: an authentic cadence would be fabricated');
});

test('promotePhrases: writes real Phrase entities with inferred provenance, via ops.addPhrase only', () => {
  const g = mk(CADENTIAL);
  const analysis = PH.phrasesOf(g);
  const candidates = [];
  analysis.forEach(pp => pp.phrases.forEach(ph => candidates.push({ part: pp.part, from: ph.from, to: ph.to })));
  const { graph } = PH.promotePhrases(g, candidates);
  assert.equal(graph.structure.phrases.length, candidates.length);
  graph.structure.phrases.forEach(ph => {
    assert.equal(ph.prov.op, 'inferred');
    const src = graph.provenance.sources.find(x => x.id === ph.prov.src);
    assert.equal(src.tool, 'ppp.songgraph.phrases');
  });
});
