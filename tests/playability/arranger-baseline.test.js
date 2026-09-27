/* G05 §3(a)/(d) - "the playability baseline of all three legacy arrangers run over their own output" -
   closes half of G0 Step 14 (docs/GOALS/G00_QUALITY_FOUNDATION.md §16.6: arrangement invariants, never
   done; docs/PPP_MASTER_ROADMAP.md line 163). This is real, standalone evidence, independent of
   anything else G5 builds (G05 §1): the three arrangers already ship, already run in or alongside the
   app, and their own output - not a hypothetical - is what is measured here.

   Three arrangers, three adapters (tests/playability/arranger-adapters.js and
   tests/playability/score-arranger-extract.js):
     1. arrange_score.py (server-side, Python) - run directly via its own test fixture
        (tests/arranger_test.py's fixture(), reused verbatim - not invented for this baseline).
     2. ScoreArranger (App 8977-9213, in-page JS) - extracted the same way
        tests/engrave/helpers.js's appFinalize() already extracts Score.finalize, run over a real
        R-corpus melody with real G1 hand assignment.
     3. audio-score.js arrangeNotes (Node-requireable directly) - a subset-of-heard-notes arranger with
        no hand split; run over a synthetic wide-chord cluster (no real recorded performance sample is
        available in this environment) to show what its own thinning strategy structurally preserves.

   Each assertion below states the actual measured finding (docs/GOALS/G05_PLAYABILITY_FINGERING.md §11
   has the numbers and the investigation) - "ok >= 1" style assertions confirming the known defect is
   still present, not a design target to reach zero (G8/G9 are where a fix would land). */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { execFileSync } = require('child_process');
const { REPO, PL, SG, graphOf } = require('./helpers.js');
const { attacksFromWireNotes, attacksFromAudioScoreNotes } = require('./arranger-adapters.js');
const { scoreArranger } = require('./score-arranger-extract.js');

function legacyScoreFromGraph(g, name) {
  const score = SG.legacy.toScore(g, { name: name, id: 'pl:' + name, ids: true });
  const part = g.parts[0];
  score.notes.forEach(n => {
    if (n.rest) return;
    const ev = part.events.find(e => e.id === n.sgEvent);
    if (!ev) return;
    const head = (ev.heads || []).find(h => h.id === n.sgHead);
    /* G1-D12 limb, never inferred any other way (G05 §10) - toScore itself always writes hand:'r'
       (scoregraph/legacy-score.js: "the adapter reproduces the app", which derives real hands from a
       different, MusicXML-text-only heuristic this graph-based path does not go through); the graph's
       own limb is substituted back in so ScoreArranger.melody()/selectVoices() see real hands. */
    const limb = head ? SG.pitch.limbOf(part, ev, head) : undefined;
    if (limb === 'LH') n.hand = 'l'; else if (limb === 'RH') n.hand = 'r';
  });
  return score;
}

test('legacy baseline (1/3): arrange_score.py, its own test fixture, every level x style', () => {
  const out = execFileSync(process.platform === 'win32' ? 'python' : 'python3',
    [path.join(__dirname, 'tools', 'arrange-score-baseline.py')], { maxBuffer: 64 * 1024 * 1024 }).toString();
  const combos = JSON.parse(out);
  assert.equal(combos.length, 28, '7 styles x 4 levels');
  let withHard = 0, maxSpan = 0;
  combos.forEach(c => {
    const attacks = attacksFromWireNotes(c.notes, c.tempo);
    const r = PL.analyze(attacks, { profile: 'large' });
    if (r.totals.hard > 0) withHard++;
    r.events.forEach(e => e.hard.forEach(h => { if (h.code === 'SPAN' && h.span > maxSpan) maxSpan = h.span; }));
  });
  /* Measured 2026-09-28 (docs/GOALS/G05_PLAYABILITY_FINGERING.md §11): even against the LARGE hand
     profile (14-semitone reach - the most forgiving of the three), most style x level combinations
     produce a hard violation, and the widest observed simultaneous LH span is a full two octaves (24
     semitones) - `_voicing_options`'s own gap check (arrange_score.py) allows up to `pitches[-1] -
     pitches[0] > 24`, i.e. it only rejects a span strictly greater than 24; this is that ceiling being
     hit in practice, not just in theory. */
  assert.ok(withHard >= 15, 'expected most combos to hit a hard violation, got ' + withHard + '/28');
  assert.equal(maxSpan, 24, 'the widest observed LH span should be the voicing search\'s own 24-semitone ceiling');
});

test('legacy baseline (2/3): the in-app ScoreArranger, a real R-corpus melody, every level x style', async () => {
  const SA = scoreArranger();
  const g = await graphOf('catalog/method/sonatina/001.mxl');
  const score = legacyScoreFromGraph(g, 'sonatina001');
  let withHard = 0, combos = 0, maxSpan = 0;
  SA.levels.forEach(level => {
    SA.styles.forEach(style => {
      combos++;
      const arranged = SA.arrange(score, { level: level, style: style });
      const attacks = attacksFromWireNotes(
        arranged.notes.map(n => ({ m: n.m, b: n.b, dur: n.dur, midi: n.midi, hand: n.hand })), score.tempo || 80);
      const r = PL.analyze(attacks, { profile: 'large' });
      if (r.totals.hard > 0) withHard++;
      r.events.forEach(e => e.hard.forEach(h => { if (h.code === 'SPAN' && h.span > maxSpan) maxSpan = h.span; }));
    });
  });
  assert.equal(combos, 28, '7 styles x 4 levels');
  /* Measured 2026-09-28: 24/28 combos over Sonatina 001 alone hit a hard violation against the LARGE
     profile; the traced worst case is the 'cinematic' style's own two atPattern calls both targeting the
     left hand with overlapping durations (App ~9090-9094: [root, root+12] held up to 1.8s, then
     root+24 struck at the next beat while it is still sounding) - a genuine 24-semitone stacked LH
     chord, not an adapter artifact (docs/GOALS/G05_PLAYABILITY_FINGERING.md §11 traces it). */
  assert.ok(withHard >= 15, 'expected most combos to hit a hard violation, got ' + withHard + '/28');
  assert.ok(maxSpan >= 24, 'expected the cinematic-style stacked LH chord (>=24 semitones), got ' + maxSpan);
});

test('legacy baseline (3/3): audio-score.js arrangeNotes structurally preserves a wide chord\'s span', () => {
  /* Synthetic: a "heard" 6-note cluster spanning both hands' usual range (C2-C5, 36 semitones), as a real
     two-hand recording would produce when both hands play together in one detected attack - no recorded
     performance sample is available in this environment, so this is a stand-in, not a corpus measurement
     (unlike the other two arrangers above). arrangeNotes never invents a pitch (audio-score.js's own
     comment, line ~144): it can only keep a subset of what it is given. */
  const notes = [
    { on: 0, off: 1.2, midi: 36, vel: 90 }, { on: 0, off: 1.2, midi: 48, vel: 70 },
    { on: 0, off: 1.2, midi: 55, vel: 65 }, { on: 0, off: 1.2, midi: 64, vel: 80 },
    { on: 0, off: 1.2, midi: 67, vel: 75 }, { on: 0, off: 1.2, midi: 72, vel: 85 }
  ];
  const AS = require(path.join(REPO, 'audio-score.js'));
  ['beginner', 'intermediate', 'advanced', 'original'].forEach(level => {
    const out = AS.arrangeNotes(notes, { level: level, style: 'balanced' });
    const attacks = attacksFromAudioScoreNotes(out);
    const r = PL.analyze(attacks, { profile: 'medium' });
    /* Every level keeps the cluster's lowest (36) and highest (72) note - the thinning strategy
       (audio-score.js's selectVoices-equivalent) explicitly `take(lo); take(hi)` before anything else -
       so the 36-semitone span survives even the most aggressive ('beginner') thinning. */
    assert.ok(out.some(n => n.midi === 36) && out.some(n => n.midi === 72),
      level + ': expected the outer voices (36, 72) to survive thinning');
    assert.ok(r.totals.byCode.SPAN >= 1, level + ': expected the preserved outer span to still be a SPAN violation');
  });
});
