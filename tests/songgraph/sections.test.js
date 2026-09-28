/* songgraph/sections.js: exact-repeat section detection. An earlier version signatured a measure by
   its pitch-class histogram alone and over-matched constantly (any two measures sitting on the same
   tonic triad "repeated," regardless of what tune was over it) - these tests plant a real repeat and
   a look-alike near-miss (same harmony, different tune) to guard against that regression directly. */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { SEC, O, mk } = require('./helpers.js');

test('sectionsOf: a verbatim repeated 2-measure phrase is found and labelled the same letter both times', () => {
  const phrase = 'C5:q D5:q E5:q F5:q | G5:h E5:h';
  const bridge = 'A5:q G5:q F5:q E5:q | D5:h C5:h';
  const rh = [phrase, bridge, phrase].join(' | ');
  const lh = 'C3:w | C3:w | C3:w | C3:w | C3:w | C3:w';
  const g = mk({ time: [4, 4], rh: rh, lh: lh });
  const sections = SEC.sectionsOf(g);
  const labels = sections.map(s => s.label);
  assert.equal(labels[0], labels[2], 'the two verbatim copies of the phrase should share a label: ' + JSON.stringify(sections));
  assert.notEqual(labels[0], labels[1], 'the bridge is different material and must not share the phrase\'s label');
});

test('sectionsOf: same harmony, different melody is NOT reported as a repeat (the histogram-only regression)', () => {
  /* both halves sit on a plain C major triad for 2 measures, but the tune is different - a histogram-only
     signature would call this a repeat; the exact onset/pitch-class/duration signature must not */
  const a = 'C5:q E5:q G5:q C6:q | C6:q G5:q E5:q C5:q';
  const b = 'E5:q G5:q C6:q E6:q | E6:q C6:q G5:q E5:q';
  const g = mk({ time: [4, 4], rh: a + ' | ' + b, lh: 'C3:w | C3:w | C3:w | C3:w' });
  const sections = SEC.sectionsOf(g);
  const labels = new Set(sections.map(s => s.label));
  assert.equal(labels.size, sections.length, 'no two of these differently-tuned sections should share a label: ' + JSON.stringify(sections));
});

test('sectionsOf: a through-composed piece with no repeats is one section covering everything', () => {
  const g = mk({ time: [4, 4], rh: 'C5:q D5:q E5:q F5:q | G5:q A5:q B5:q C6:q | D6:q E6:q F#6:q G6:q', lh: 'C3:w | C3:w | C3:w' });
  const sections = SEC.sectionsOf(g);
  assert.equal(sections.length, 1);
  assert.equal(sections[0].from, g.timeline.measures[0].id);
  assert.equal(sections[0].to, g.timeline.measures[g.timeline.measures.length - 1].id);
});

test('promoteSections: writes real Section entities with inferred provenance, via ops.addSection only', () => {
  const g = mk({ time: [4, 4], rh: 'C5:q D5:q E5:q F5:q | G5:h E5:h | C5:q D5:q E5:q F5:q | G5:h E5:h', lh: 'C3:w | C3:w | C3:w | C3:w' });
  const candidates = SEC.sectionsOf(g);
  const { graph } = SEC.promoteSections(g, candidates);
  assert.equal(graph.structure.sections.length, candidates.length);
  graph.structure.sections.forEach(s => {
    assert.equal(s.prov.op, 'inferred');
    const src = graph.provenance.sources.find(x => x.id === s.prov.src);
    assert.equal(src.tool, 'ppp.songgraph.sections');
  });
});
