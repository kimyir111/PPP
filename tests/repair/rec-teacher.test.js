/* "Recording notation: tuplets and the grid" (docs/GOALS/G09_CANDIDATES_CRITICS_REPAIR.md section 12) on the REAL piece: the heard notes of the teacher's 90-bar YouTube transcription (Looping the Rooms, 162 bpm, 4/4,
   tests/fixtures/g9e-transcription-stray-note.heard.json: 1214 notes of the in-browser Onsets & Frames) through the library and through the app's own one-note-per-hand glue.
   Written without exact bars (what the app did before) 113-115 of the 180 voice-bars do not add up as drawn (59 of 90 right-hand bars); written with them every one does, the arrangement keeps the
   brackets, no onset moves by more than 3 ticks (1/32 of a whole note, 46 ms at 162 bpm) and no heard note is lost. */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const E = require('../realize/app-single-extract.js');
const REPO = E.REPO;
const R = require(path.join(REPO, 'scoregraph/rational.js'));
const S = require(path.join(REPO, 'scoregraph/schema.js'));
const SG = require(path.join(REPO, 'scoregraph/index.js'));
const A = require(path.join(REPO, 'audio-score.js'));
const GAPS = require(path.join(REPO, 'scoregraph/gaps.js'));
const HEARD = JSON.parse(fs.readFileSync(path.join(REPO, 'tests/fixtures/g9e-transcription-stray-note.heard.json'), 'utf8'));

/* the voice-bars (hand@bar) of a graph that do not add up as drawn: the drawn values (with the tuplet ratio) are the bar, in order with no hole or overlap, each event lasting what it is drawn as */
function badBars(g) {
  const part = g.parts[0], mIdx = new Map(g.timeline.measures.map((m, i) => [m.id, i]));
  const limb = new Map(part.staves.map((s, i) => [s.id, s.limb || (i === 0 ? 'RH' : 'LH')]));
  const tupById = new Map(part.spanners.filter(s => s.type === 'tuplet').map(t => [t.id, t]));
  const tupsOf = new Map();
  part.spanners.filter(s => s.type === 'tuplet').forEach(t => t.events.forEach(id => { if (!tupsOf.has(id)) tupsOf.set(id, []); tupsOf.get(id).push(t); }));
  const ratio = id => { const l = tupsOf.get(id) || []; let t = l.find(x => !l.some(u => u !== x && u.parent === x.id)) || l[0], r = R.ONE, k = 0; while (t && k++ < 8) { r = R.mul(r, R.make(t.normal, t.actual)); t = t.parent ? tupById.get(t.parent) : null; } return r; };
  const by = new Map();
  part.events.forEach(e => { if (e.grace || (e.kind !== 'note' && e.kind !== 'rest')) return; const k = e.voice + '|' + e.m; if (!by.has(k)) by.set(k, []); by.get(k).push(e); });
  const bad = [];
  by.forEach(evs => {
    evs.sort((a, b) => R.cmp(R.parse(a.at), R.parse(b.at)));
    const len = R.parse(g.timeline.measures[mIdx.get(evs[0].m)].dur);
    let cur = R.ZERO, ok = true, sum = R.ZERO;
    evs.forEach(e => {
      const base = e.display && e.display.type ? S.noteValue(e.display.type, e.display.dots) : null;
      if (!base) { ok = false; return; }
      const drawn = R.mul(base, ratio(e.id)); sum = R.add(sum, drawn);
      if (!R.eq(R.parse(e.at), cur) || !R.eq(R.parse(e.dur), drawn)) ok = false;
      cur = R.add(R.parse(e.at), R.parse(e.dur));
    });
    if (!R.eq(cur, len) || !R.eq(sum, len)) ok = false;
    if (!ok) bad.push(limb.get(evs[0].staff) + '@' + (mIdx.get(evs[0].m) + 1));
  });
  return bad;
}
const build = o => A.toMusicXml({ notes: HEARD.notes, pedals: [], beats: [], downbeats: [] }, Object.assign({ title: 'Looping the Rooms', closeGaps: true }, o));
const LOCK = { beats: 4, beatType: 4, bpm: 162, firstDownbeat: -0.371 };

test('the teacher\'s piece, with and without the review screen\'s lock: before, over 110 of 180 voice-bars do not add up as drawn; with exact bars none', () => {
  [undefined, LOCK].forEach(lock => {
    const before = build({ exactBars: false, lock: lock }), after = build({ exactBars: true, lock: lock });
    assert.ok(badBars(before.graph).length >= 100, 'control: ' + badBars(before.graph).length);
    assert.deepEqual(badBars(after.graph), [], 'every voice of every bar adds up' + (lock ? ' (lock)' : ''));
    assert.deepEqual(SG.validate(after.graph).issues.filter(i => i.severity === 'ERROR' || i.code === 'W-DISPLAY-DURATION' || i.code === 'W-TUPLET-INCOMPLETE'), []);
    assert.ok(after.gridReport.maxShift <= 3 && after.gridReport.moved > 50, JSON.stringify(after.gridReport));
    assert.ok(after.graph.parts[0].spanners.filter(s => s.type === 'tuplet').length >= 100, 'a bracket per triplet beat');
    assert.equal(GAPS.tidyRests(after.graph).graph, after.graph, 'a fixed point of the gaps passes');
    assert.equal(after.gapReport.omitted, 0, 'no rest is left out any more');
    assert.equal(after.graph.performances[0].notes.filter(n => n.link === undefined).length, 0, 'no heard note is lost');
  });
});

test('the app\'s one-note-per-hand arrangement of it keeps the brackets and every bar of both hands adds up', async () => {
  const ref = E.reference();
  const app = E.make({ window: E.nodeWindow(), loadArrangerReference: () => Promise.resolve(ref) });
  const exact = build({ exactBars: true });
  const r = await app.arrangeSingleNote(exact.graph, { level: 'intermediate' });
  assert.equal(r.ok, true, r.reason);
  assert.deepEqual(badBars(r.graph), [], 'the arrangement adds up');
  assert.ok(r.graph.parts[0].spanners.filter(s => s.type === 'tuplet').length >= 50, 'the copy keeps a bracket per triplet beat');
  assert.deepEqual(SG.validate(r.graph).issues.filter(i => i.severity === 'ERROR' || i.code === 'W-DISPLAY-DURATION' || i.code === 'W-TUPLET-INCOMPLETE'), []);
});
