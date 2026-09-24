/* G4a: when a graph may stand for a Score (docs/GOALS/G04 §8.2, A16).

   The renderer draws a graph; practice, playback and the song slot keep the Score. A graph is used for a Score only
   when legacy.agree() finds the same music in both: the G2 comparator, on both sides in one note order. These tests
   show it is strict where it must be (a changed pitch, value, tie, hand, bar, mark) and blind only where it should be
   (the order of notes that share a beat, the title the app shows). */
const test = require('node:test');
const assert = require('node:assert/strict');
const { SG, corpusGraphs, storedScores, scoreOf, graphOf } = require('./helpers.js');

const L = SG.legacy;
const clone = x => JSON.parse(JSON.stringify(x));
const fixture = name => clone(storedScores().find(([f]) => f === name + '.score.json')[1].score);

test('a Score and the graph it was made from agree - every corpus file, and the captured app Scores', async () => {
  const bad = [];
  (await corpusGraphs()).forEach(([rel, g]) => { const a = L.agree(scoreOf(g, rel), g); if (!a.ok) bad.push(rel + ' ' + JSON.stringify(a.diffs[0])); });
  assert.deepEqual(bad, []);
  /* the app's own Scores against an import of the XML they were parsed from (the catalogue-match and OMR path) */
  [['parse-engraving-stress', 'tests/fixtures/engraving-stress.musicxml'], ['parse-ottava-8va-8vb', 'tests/scoregraph/fixtures/xml/ottava-8va-8vb.musicxml'],
    ['parse-tuplets-nested', 'tests/scoregraph/fixtures/xml/tuplets-nested.musicxml'], ['parse-voices-4', 'tests/scoregraph/fixtures/xml/voices-4.musicxml']]
    .forEach(([f, rel]) => { /* graphOf is async; the xml graphs are synchronous imports */
      const g = SG.musicxml.import(require('fs').readFileSync(require('path').join(require('./helpers.js').REPO, rel), 'utf8'), { scoreId: 'x' }).graph;
      const a = L.agree(fixture(f), g);
      assert.ok(a.ok, f + ': ' + JSON.stringify(a.diffs[0]));
    });
});

test('agree catches every kind of semantic loss', async () => {
  const g = await graphOf('catalog/method/burgmuller25/021.mxl');
  const base = scoreOf(g, 'burg');
  assert.ok(L.agree(base, g).ok);
  const pitched = s => s.notes.findIndex(n => !n.rest && n.p);
  const cases = {
    'a pitch': s => { const n = s.notes[pitched(s)]; n.p = n.p.replace(/\d+$/, d => String(+d + 1)); n.midi += 12; },
    'a note dropped': s => { s.notes.splice(pitched(s), 1); },
    'a note value': s => { s.notes[pitched(s)].dur += 0.5; },
    'a printed value': s => { const n = s.notes[pitched(s)]; n.type = n.type === 'quarter' ? 'eighth' : 'quarter'; },
    'a tie': s => { const n = s.notes.find(x => x.tieStart); n.tieStart = false; },
    'a slur': s => { const n = s.notes.find(x => x.slurStart); n.slurStart = false; },
    'a tuplet bracket': s => { const n = s.notes.find(x => x.tupletStart); n.tupletStart = false; },
    'a hand': s => { const n = s.notes[pitched(s)]; n.hand = n.hand === 'r' ? 'l' : 'r'; },
    'a voice': s => { s.notes[pitched(s)].voice += 1; },
    'an accidental': s => { const n = s.notes.find(x => x.acc); n.acc = n.acc === 'sharp' ? 'flat' : 'sharp'; },
    'a bar length': s => { s.measures[1].lenQ += 1; },
    'a time signature': s => { s.measures[0].time = { beats: 7, beatType: 8 }; },
    'a key': s => { s.measures[0].key = { fifths: s.measures[0].key.fifths + 1, mode: 'major' }; },
    'a clef': s => { s.measures[0].clefs = Object.assign({}, s.measures[0].clefs, { 1: 'alto' }); },
    'a repeat': s => { s.measures[2].bar = Object.assign({}, s.measures[2].bar || {}, { repeatEnd: 2 }); },
    'an 8va': s => { s.ottavas = s.ottavas.slice(1); },
    'a dynamic': s => { s.dynamics = s.dynamics.slice(1); },
    'a hairpin': s => { s.wedges = s.wedges.slice(2); },
    'the staff count': s => { s.staves += 1; }
  };
  Object.keys(cases).forEach(name => {
    const s = clone(base);
    cases[name](s);
    assert.notDeepEqual(s, base, name + ' is a real change of this Score');
    const a = L.agree(s, g);
    assert.equal(a.ok, false, 'agree must see ' + name);
  });
  /* a pedal: Burgmueller 21 has none, the piano-marks fixture has one */
  const pm = SG.musicxml.import(require('fs').readFileSync(require('path').join(require('./helpers.js').REPO,
    'tests/scoregraph/fixtures/xml/piano-marks.musicxml'), 'utf8'), { scoreId: 'pm' }).graph;
  const ps = scoreOf(pm, 'pm');
  assert.ok(ps.pedals.length > 0 && L.agree(ps, pm).ok);
  const qs = clone(ps);
  qs.pedals = qs.pedals.slice(1);
  assert.equal(L.agree(qs, pm).ok, false, 'agree must see a pedal');
});

test('agree is blind only to what is not music: note order, title, composer, the score tempo', async () => {
  const g = await graphOf('catalog/method/burgmuller25/021.mxl');
  const s = clone(scoreOf(g, 'burg'));
  s.notes.reverse();                                   /* Score.finalize sorts; the projection does not */
  s.title = 'Renamed'; s.composer = 'Someone'; s.tempo = 200;
  const a = L.agree(s, g);
  assert.ok(a.ok, JSON.stringify(a.diffs[0]));
  assert.deepEqual(a.info.map(i => i.field), ['title', 'composer', 'tempo'], 'and says what it did not compare');
});

test('unfinalize undoes the 8va move Score.finalize makes, so a finalized Score compares with its projection', () => {
  const s = fixture('parse-ottava-8va-8vb');
  const moved = s.notes.filter(n => n.ottavaShift);
  assert.ok(moved.length > 0, 'the fixture has notes under an 8va');
  const u = L.unfinalize(s);
  moved.forEach(n => {
    const back = u.notes[s.notes.indexOf(n)];
    assert.equal(back.midi, n.midi - n.ottavaShift);
    assert.notEqual(back.p, n.p);
  });
  /* and a Score that was never finalized comes back untouched */
  const plain = L.toScore(SG.musicxml.import(require('fs').readFileSync(require('path').join(require('./helpers.js').REPO,
    'tests/scoregraph/fixtures/xml/ottava-8va-8vb.musicxml'), 'utf8'), { scoreId: 'o' }).graph);
  assert.deepEqual(L.unfinalize(plain).notes, plain.notes);
});

test('link names the graph event and head of every note, and refuses a Score that is not the graph', async () => {
  const g = await graphOf('catalog/method/czerny849/001.mxl');
  const s = scoreOf(g, 'cz');
  const l = L.link(s, g);
  assert.ok(l.ok);
  const heads = new Map(), events = new Map();
  g.parts.forEach(p => p.events.forEach(e => { events.set(e.id, e); (e.heads || []).forEach(h => heads.set(h.id, { h, e })); }));
  s.notes.forEach((n, i) => {
    const x = l.byNote[i];
    assert.ok(x && events.has(x.event), 'note ' + i + ' has an event');
    if (n.rest) { assert.equal(events.get(x.event).kind, 'rest'); assert.equal(x.head, null); }
    else { assert.equal(heads.get(x.head).e.id, x.event); assert.equal(SG.pitch.midi(heads.get(x.head).h.pitch), n.midi); }
  });
  const t = clone(s);
  t.notes[0].dur += 1;
  assert.equal(L.link(t, g).ok, false);
});
