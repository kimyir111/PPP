/* G4a: the practice identity map (docs/GOALS/G04 §8.2 link, §16; A16).

   The page will be drawn from the graph; highlighting, seeking, loops, MIDI feedback and hand filters work on the
   Score. For every note the Score holds, the plan must name the event that draws it, and the plan's own reading of
   that event - its bar, its beat, its staff, its pitch - must be the practice layer's:
     highlight   the legacy renderer's data-onset key "m|b|staff" (App onsetKey)
     bar, loop   the Score's measure number at the same position in the bar list
     seek        the absolute position in quarters (Score.finalize's abs)
     MIDI        the pitch the app sounds and checks (with its 8va reading, issue 3)
     hands       the hand the Score gives the note */
const test = require('node:test');
const assert = require('node:assert/strict');
const { SG, E, corpusGraphs, goldenGraphs, g3aGraphs, storedScores, scoreOf } = require('./helpers.js');

const R = SG.rational;
const key = n => n.m + '|' + (+n.b).toFixed(3) + '|' + n.staff;

function check(name, score, res) {
  const plan = E.plan(res.graph);
  const id = E.identity(score, res, plan);
  assert.equal(id.unmatchedNotes, 0, name + ': every Score note has an event');
  assert.deepEqual(id.unmatchedEvents, [], name + ': every drawn event has its Score notes');
  const pe = new Map(plan.events.map(e => [e.id, e]));
  const mStart = new Map();
  plan.measures.forEach(m => mStart.set(m.id, R.parse(m.start)));
  const mIndex = new Map(plan.measures.map((m, i) => [m.id, i]));
  score.notes.forEach((n, i) => {
    const l = res.link.byNote[i];
    const ev = pe.get(l.event);
    const head = l.head ? ev.heads.find(h => h.id === l.head) : null;
    /* highlight: the plan's own onset key is the one the legacy renderer puts on this note */
    assert.equal(E.onsetKey(plan, ev, head ? head.staff : ev.staff), key(n), name + ' note ' + i + ': highlight key');
    /* bar and loop: the same bar */
    assert.equal(score.measures[mIndex.get(ev.m)].number, n.m, name + ' note ' + i + ': bar');
    /* seek: the same absolute position */
    if (n.abs !== undefined) assert.ok(Math.abs(R.toNumber(R.add(mStart.get(ev.m), R.parse(ev.at))) * 4 - n.abs) < 1e-6, name + ' note ' + i + ': position');
    /* MIDI feedback: the pitch the app plays and checks (concert pitch, plus its own 8va reading) */
    if (head && head.midi !== null) assert.equal(head.midi + (+n.ottavaShift || 0), n.midi, name + ' note ' + i + ': pitch');
    assert.ok(id.events[l.event].hands.indexOf(n.hand) >= 0, name + ' note ' + i + ': hand');
  });
  /* loops and bar highlights name bars by number, in order */
  assert.deepEqual(id.measures.map(m => m.number), score.measures.map(m => m.number), name + ': bars');
  return id;
}

test('A16: the practice map is complete and exact for every corpus Score (a live graph)', async () => {
  let notes = 0;
  for (const [rel, g] of await corpusGraphs()) {
    const score = scoreOf(g, rel);
    const src = E.createSource();
    src.remember(score, g, 'test');
    const res = src.resolveSync(score);
    if (rel.endsWith('unpitched.musicxml')) { assert.equal(res.via, 'live'); continue; }
    assert.equal(res.via, 'live', rel);
    check(rel, score, res);
    notes += score.notes.length;
  }
  assert.ok(notes > 80000, notes + ' notes mapped');
});

test('A16: the same for PPP transcriptions, their G3a versions, and the Scores the app holds (rebuilt graphs)', () => {
  goldenGraphs().concat(g3aGraphs()).forEach(([k, g]) => {
    const score = scoreOf(g, k);
    const src = E.createSource();
    src.remember(score, g, 'recording');
    check(k, score, src.resolveSync(score));
  });
  storedScores().forEach(([f, x]) => {
    const res = E.createSource().resolveSync(x.score);
    assert.equal(res.via, 'projected', f + ': no graph but the Score');
    check(f, x.score, res);
  });
});

test('the map survives what the practice layer does: the same answers for a Score saved and read back', () => {
  storedScores().forEach(([f, x]) => {
    const again = JSON.parse(JSON.stringify(x.score));
    const a = E.identity(x.score, E.createSource().resolveSync(x.score), null);
    const b = E.identity(again, E.createSource().resolveSync(again), null);
    assert.deepEqual(b.byNote.length, a.byNote.length, f);
    assert.deepEqual(Object.keys(b.events).sort(), Object.keys(a.events).sort(), f + ': the same event names');
  });
});
