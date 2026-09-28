/* G07B §6 mutation suite: "a request whose target level is unreachable under the hand
   profile's constraints must fail cleanly (not silently produce an invalid plan); a
   request for a section G7a found no clear melody/bass in must degrade gracefully... not
   crash or fabricate a confident-looking plan." Both cases are exercised against REAL
   corpus material where the design doc asked for it (§6 "check that G7a's real corpus
   actually has a case like this"), plus one synthetic fixture for the hand-profile case
   (an engineered physical impossibility, the same technique G7a's own mutation suite uses
   for its planted defects). */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { SGG, AP, mk, importCorpus } = require('./helpers.js');

/* ---------------------------------------------------- unreachable under a hand profile */
test('mutation: a bass voice written as a real 2-octave dyad is unreachable for any hand profile, at any level', () => {
  /* The bass voice itself holds a chord spanning 24 semitones (2 octaves) at every attack -
     wider than even the LARGE hand profile's MAX_SPAN (14). Since dropping every other
     voice (the 'reduced' floor) still keeps this same chord, no rung of the ladder can ever
     fit it: a genuine structural impossibility, not a level problem. */
  const g = mk({ time: [4, 4], rh: 'C6:q D6:q E6:q F6:q', lh: 'C2+C4:q G1+G3:q C2+C4:q G1+G3:q' });
  const sg = SGG.analyze(g);
  ['small', 'medium', 'large'].forEach(profile => {
    const res = AP.plan(g, sg, { targetLevel: 3.5, handProfile: profile });
    assert.equal(res.ok, false, profile + ' should fail cleanly, not produce a plan');
    assert.equal(res.reason, 'UNREACHABLE');
    assert.ok(res.detail && Array.isArray(res.detail.attempts) && res.detail.attempts.length >= 1,
      'a clean failure must report what was actually tried, not just say no');
  });
});

test('mutation: request validation itself fails cleanly for a level with no real anchor at all (NaN, Infinity)', () => {
  const g = mk({ time: [4, 4], rh: 'C5:q D5:q E5:q F5:q', lh: 'C3:w' });
  const sg = SGG.analyze(g);
  [NaN, Infinity, -Infinity].forEach(bad => {
    const res = AP.plan(g, sg, { targetLevel: bad, handProfile: 'medium' });
    assert.equal(res.ok, false);
    assert.equal(res.reason, 'BAD_REQUEST');
  });
});

/* ---------------------------------------------------- honest degradation: real low confidence */
test('mutation: a real corpus section with G7a melody/bass confidence 0.0/0.0 degrades to the simplest texture and is flagged, not silently trusted', async () => {
  /* catalog/hymns/for-all-the-saints.musicxml is G7a's own documented hardest case (design
     doc §12: lowest harmony agreement of the hymn corpus, 24%, "alto/bass rest often,
     leaving thin, more ambiguous slices"). Checked directly here (not assumed): its second
     part's melodyConf/bassConf are exactly 0.0/0.0 - a real, not synthetic, "no clear
     melody/bass" case. */
  const rows = await importCorpus(['catalog/hymns/for-all-the-saints.musicxml']);
  assert.ok(rows[0].ok);
  const g = rows[0].graph;
  const sg = SGG.analyze(g);
  const mb = sg.melodyBass.parts[0];
  assert.equal(mb.melodyConf, 0, 'fixture assumption check: this file\'s real melodyConf must be exactly 0');
  assert.equal(mb.bassConf, 0, 'fixture assumption check: this file\'s real bassConf must be exactly 0');

  const res = AP.plan(g, sg, { targetLevel: 1.5, handProfile: 'medium' });
  assert.ok(res.ok, 'a low-confidence section must still produce SOME plan, just a conservative one: ' + JSON.stringify(res).slice(0, 300));
  assert.equal(res.plan.degraded, true);
  const sec = res.plan.sections.find(s => s.section.label === sg.sections[0].label);
  assert.equal(sec.confidenceTier, 'low');
  assert.equal(sec.degraded, true);
  assert.equal(sec.texture, 'reduced', 'a degraded section must never be planned at a fuller texture than melody+bass');
  assert.match(sec.explanation, /DEGRADED/);
});

test('mutation: a synthetic frequently-crossed-voice pair (ambiguous melody) still plans, conservatively, never crashes', () => {
  const g = mk({ time: [4, 4], rh: 'C6:q D6:q C3:q D3:q | C6:q D6:q C3:q D3:q', lh: 'G3:q F3:q G5:q F5:q | G3:q F3:q G5:q F5:q' });
  const sg = SGG.analyze(g);
  /* a generous level: this fixture's point is the CONFIDENCE degradation, not the register
     budget - a tight level here would fail for the wrong reason (range), muddying the
     assertion this test is actually making. */
  const res = AP.plan(g, sg, { targetLevel: 2.5, handProfile: 'medium' });
  assert.ok(res.ok);
  assert.equal(res.plan.degraded, true);
  assert.equal(res.plan.sections[0].confidenceTier, 'low');
});
