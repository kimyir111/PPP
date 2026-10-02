/* "Transcription rests at the source" (docs/GOALS/G09_CANDIDATES_CRITICS_REPAIR.md section 12): audio-score.js gives a recording's notes the lengths they were HEARD with, so every silence
   between two notes shorter than a 16th became a 32nd or 64th rest in the score the review screen draws, the saved transcription, the 'original' copy and every arranger's input
   (the user's 90-bar YouTube transcription: 90 32nd + 64 64th rests). scoregraph/gaps.js (the pass G9f runs on a one-note arrangement) now runs when the score is written:
     - a gap between a note and the next onset of the same hand that is more than 0 and less than a 16th lengthens the note before it (never shortened, onset and pitch never move,
       never over a barline or the hand's next onset, at most one dot when it takes a plain value); a 32nd or 64th rest inside a longer silence that has a note after it is not drawn
     - only for a recording (sourceKind 'audio-score'); a MIDI file is the player's own file and is left as it is; the library's default is OFF (opts.closeGaps: true asks, the app does at its four recording call sites)
     - the graph and the MusicXML are the same score; running the pass again changes nothing; repair/index.js's G9f step and this one are one function (no double application) */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const REPO = path.resolve(__dirname, '..', '..');
const A = require(path.join(REPO, 'audio-score.js'));
const SG = require(path.join(REPO, 'scoregraph/index.js'));
const R = require(path.join(REPO, 'scoregraph/rational.js'));
const GAPS = require(path.join(REPO, 'scoregraph/gaps.js'));
const REP = require(path.join(REPO, 'repair/index.js'));

/* a played piece, 120 bpm in 4/4 (a 16th is 0.125 s, a 32nd 0.0625 s), made by a seeded generator so it is the same on every machine: the left hand plays two held notes a bar, the
   right hand a run whose gaps between onsets are 2, 3, 4, 5 or 8 32nds (a recording's quantised onsets do land on the 32nd grid) and each note is held for 55-85% of its gap, so the
   silences after the notes come out as 32nd and 64th rests (before this change: 4 to 14 of them in 6 bars) */
function heardNotes(bars, seed) {
  let s = seed || 3;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const notes = [];
  const pat = [72, 74, 76, 77, 79, 77, 76, 74, 72, 71, 72, 74, 76, 74, 72, 71];
  for (let b = 0; b < bars; b++) {
    const t0 = b * 2;
    notes.push({ on: t0, off: t0 + 0.93, midi: 48, vel: 70 });
    notes.push({ on: t0 + 1, off: t0 + 1.93, midi: 43, vel: 70 });
    let t = 0, i = 0;
    while (t < 2 - 1e-9) {
      const r = rnd(), ioi32 = r < 0.55 ? 4 : r < 0.7 ? 3 : r < 0.8 ? 5 : r < 0.9 ? 2 : 8;
      const ioi = ioi32 * 0.0625;
      if (t + ioi > 2 + 1e-9) break;
      notes.push({ on: t0 + t + (rnd() - 0.5) * 0.01, off: t0 + t + ioi * (0.55 + 0.3 * rnd()), midi: pat[i % 16], vel: 80 });
      t += ioi; i++;
    }
  }
  return notes;
}
const LOCK = { bpm: 120, beatsPerBar: 4, beatType: 4, firstDownbeat: 0 };
const build = opts => A.toMusicXml({ notes: heardNotes(6), pedals: [], title: 'synthetic' }, Object.assign({ title: 'synthetic', lock: LOCK, closeGaps: true }, opts || {}));

function eventsOf(g, kind) { return g.parts[0].events.filter(e => e.kind === kind); }
function restsByType(g) { const c = {}; eventsOf(g, 'rest').forEach(e => { c[e.display.type] = (c[e.display.type] || 0) + 1; }); return c; }
const noteKey = e => e.m + '|' + e.staff + '|' + e.at + '|' + e.heads.map(h => h.pitch.step + (h.pitch.alter || 0) + h.pitch.oct).join('+');
const noteMap = g => new Map(eventsOf(g, 'note').map(e => [noteKey(e), e]));

test('a recording\'s transcription has no 32nd or 64th rest between its notes (and the same notes, none shortened)', () => {
  const before = build({ closeGaps: false }), after = build();
  const b0 = restsByType(before.graph);
  assert.ok((b0['32nd'] || 0) + (b0['64th'] || 0) >= 10, 'the heard lengths leave many sub-16th silences: ' + JSON.stringify(b0));
  const b1 = restsByType(after.graph);
  assert.equal(b1['32nd'] || 0, 0, JSON.stringify(b1));
  assert.equal(b1['64th'] || 0, 0, JSON.stringify(b1));
  assert.ok(after.gapReport && after.gapReport.gaps > 0, 'the report says what was closed');
  /* same notes: every note event of the plain build is in the closed one at the same onset with the same pitches */
  const m0 = noteMap(before.graph), m1 = noteMap(after.graph);
  assert.equal(m1.size, m0.size);
  const mDur = new Map(after.graph.timeline.measures.map(m => [m.id, R.parse(m.dur)]));
  let lengthened = 0;
  m0.forEach((e0, k) => {
    const e1 = m1.get(k);
    assert.ok(e1, 'note kept: ' + k);
    const d = R.sub(R.parse(e1.dur), R.parse(e0.dur));
    assert.ok(R.sign(d) >= 0, 'never shortened: ' + k);
    /* by less than a 16th (the gap closing), and by a 16th more where fillRunRests deleted a lone 16th rest after the note ("Right-hand run rests": both hands) */
    if (R.sign(d) > 0) { lengthened++; assert.ok(R.lt(d, R.make(1, 8)), 'by less than a 16th plus a filled 16th rest: ' + k); }
    assert.ok(R.le(R.add(R.parse(e1.at), R.parse(e1.dur)), mDur.get(e1.m)), 'never past its barline: ' + k);
  });
  assert.ok(lengthened >= 10);
  /* never past the next onset of the same hand */
  const by = new Map();
  m1.forEach(e => { const k = e.m + '|' + e.staff; (by.get(k) || by.set(k, []).get(k)).push(e); });
  by.forEach(list => {
    list.sort((x, y) => R.cmp(R.parse(x.at), R.parse(y.at)));
    for (let i = 0; i + 1 < list.length; i++) assert.ok(R.le(R.add(R.parse(list[i].at), R.parse(list[i].dur)), R.parse(list[i + 1].at)), 'no overlap in a hand');
  });
  /* the real silence (a quarter) is still a quarter rest: only the sub-16th ones went */
  assert.ok((b1.quarter || 0) >= 1, JSON.stringify(b1));
  /* the graph is valid and its MusicXML reads back as the same notes */
  assert.deepEqual(SG.validate(after.graph).issues.filter(i => i.severity === 'ERROR'), []);
  const back = SG.musicxml.import(after.xml, { scoreId: 'rt' });
  assert.equal(back.ok, true);
  assert.equal(eventsOf(back.graph, 'note').length, m1.size);
  assert.equal(eventsOf(back.graph, 'rest').filter(e => /^(32nd|64th)$/.test(e.display.type)).length, 0, 'the file has none either');
});

test('idempotent: running the pass again on the written graph, and the one-note pipeline\'s own G9f step, find nothing to do', () => {
  const after = build();
  const again = GAPS.closeSmallGaps(after.graph);
  assert.equal(again.changed, false);
  assert.equal(again.graph, after.graph, 'the very same graph object');
  assert.equal(REP.closeSmallGaps, GAPS.closeSmallGaps, 'repair/index.js uses this one function, not a copy');
  assert.equal(REP.closeSmallGaps(after.graph).graph, after.graph);
  assert.equal(REP.isTranscription(after.graph), true, 'still a transcription (the source says audio-score)');
});

test('the library default is off (the goldens and the G3/G4 contracts on recording graphs are about its own output), closeGaps false is the same, and a MIDI file (sourceKind midi-file) is not closed even when asked', () => {
  const off = build({ closeGaps: false });
  const dflt = build({ closeGaps: undefined });
  assert.equal(dflt.xml, off.xml, 'default: not closed');
  assert.equal(dflt.gapReport, undefined);
  const midi = build({ sourceKind: 'midi-file' });
  assert.equal(midi.xml, off.xml,'a MIDI file keeps its short rests: byte-identical to the unclosed build');
  assert.equal(midi.gapReport, undefined);
  assert.ok((restsByType(midi.graph)['32nd'] || 0) > 0);
});

test('the pass does not move or add anything else: same pitches, same onsets, same tempo/key/pedal/performance layer', () => {
  const off = build({ closeGaps: false }), on = build();
  const perf = g => JSON.stringify(g.performances || g.performance || null);
  assert.equal(perf(on.graph), perf(off.graph), 'what was heard stays as it was');
  assert.deepEqual(on.stats, off.stats, 'stats (the benchmark snapshots them) are unchanged');
  assert.equal(on.graph.timeline.measures.length, off.graph.timeline.measures.length);
  const pitches = g => eventsOf(g, 'note').map(e => e.m + '|' + e.staff + '|' + e.at + '|' + e.heads.length).sort();
  assert.deepEqual(pitches(on.graph), pitches(off.graph));
});

test('sound: a lengthened note rings at most one 16th longer and stops at the hand\'s next onset (playback effect, in seconds at 120 bpm)', () => {
  const off = build({ closeGaps: false }), on = build();
  const m0 = noteMap(off.graph);
  let max = R.ZERO;
  noteMap(on.graph).forEach((e, k) => { const d = R.sub(R.parse(e.dur), R.parse(m0.get(k).dur)); if (R.gt(d, max)) max = d; });
  /* the gap closing alone (no run-rest fill): under a 16th */
  const closing = (() => { let cur = off.graph; for (let i = 0; i < 6; i++) { const a = GAPS.closeSmallGaps(cur), b = GAPS.mergeRests(a.graph); if (!a.changed && !b.changed) break; cur = b.graph; } return cur; })();
  let maxClose = R.ZERO;
  noteMap(closing).forEach((e, k) => { const d = R.sub(R.parse(e.dur), R.parse(m0.get(k).dur)); if (R.gt(d, maxClose)) maxClose = d; });
  assert.ok(R.lt(maxClose, R.make(1, 16)));
  /* a whole note is two seconds at 120 bpm: the longest addition of the closing is under a 16th = 0.125 s */
  assert.ok(R.toNumber(maxClose) * 2 < 0.125, 'under 0.125 s at 120 bpm (a whole note is 2 s)');
  /* with the lone 16th rests of both hands deleted (fillRunRests) a note rings one more 16th, still up to the hand's next onset: under 0.25 s */
  assert.ok(R.lt(max, R.make(1, 8)));
});

test('the page runs it too: the page\'s own scripts in a bare context (no require, no module) give the same score as Node', () => {
  const html = fs.readFileSync(path.join(REPO, 'Piano Coach App.dc.html'), 'utf8').replace(/\r\n/g, '\n');
  const tags = [...html.matchAll(/<script src="\.\/([^"?]+)(?:\?v=\d+)?"><\/script>/g)].map(m => m[1]);
  assert.ok(tags.includes('scoregraph/gaps.js'), 'the page loads scoregraph/gaps.js');
  assert.ok(tags.indexOf('scoregraph/gaps.js') > tags.indexOf('scoregraph/ops.js') && tags.indexOf('scoregraph/gaps.js') < tags.indexOf('audio-score.js'), 'after ops.js, before audio-score.js');
  const ctx = vm.createContext({ console });
  ctx.window = ctx; ctx.globalThis = ctx;
  tags.filter(p => /^scoregraph\//.test(p) || p === 'audio-score.js').forEach(p => vm.runInContext(fs.readFileSync(path.join(REPO, p), 'utf8'), ctx, { filename: p }));
  const built = ctx.PPPAudioScore.toMusicXml({ notes: heardNotes(6), pedals: [], title: 'synthetic' }, { title: 'synthetic', lock: LOCK, closeGaps: true });
  assert.ok(built.gapReport && built.gapReport.gaps > 0);
  assert.equal(built.xml, build().xml, 'the browser build writes the same file');
  /* a page that has not loaded gaps.js (an old cached page) writes the score as before, no throw */
  const old = vm.createContext({ console });
  old.window = old; old.globalThis = old;
  tags.filter(p => (/^scoregraph\//.test(p) && p !== 'scoregraph/gaps.js') || p === 'audio-score.js').forEach(p => vm.runInContext(fs.readFileSync(path.join(REPO, p), 'utf8'), old, { filename: p }));
  const b0 = old.PPPAudioScore.toMusicXml({ notes: heardNotes(6), pedals: [], title: 'synthetic' }, { title: 'synthetic', lock: LOCK, closeGaps: true });
  assert.equal(b0.gapReport, undefined);
  assert.equal(b0.xml, build({ closeGaps: false }).xml);
});

test('a printed score is never touched: a MusicXML import is not a recording, and a clean graph comes back as it is', async () => {
  const file = path.join(REPO, 'tests', 'fixtures', 'g9f-small-gaps.musicxml'); /* a printed score with 32 printed 64th rests between notes */
  const imp = await SG.importFile(new Uint8Array(fs.readFileSync(file)), { name: 'g9f-small-gaps.musicxml', scoreId: 'small-gaps' });
  assert.equal(imp.ok, true);
  assert.equal(GAPS.isTranscription(imp.graph), false);
  assert.equal(restsByType(imp.graph)['64th'], 32, 'the importer writes the printed rests as they are (the pass is not part of the import)');
  const clean = SG.musicxml.import(fs.readFileSync(path.join(REPO, 'catalog', 'hymns', 'christ-arose.musicxml'), 'utf8'), { scoreId: 'hymn' });
  assert.equal(clean.ok, true);
  assert.equal(GAPS.closeSmallGaps(clean.graph).changed, false, 'a hymn has no gap shorter than a 16th');
});

test('a 32nd or 64th rest at the end of a measure is not drawn when the hand has a note in a later bar; at the end of its last bar it stays', () => {
  const { mk } = require(path.join(REPO, 'tests/scoregraph/g3-helpers.js'));
  /* bar 1: C5 half, D5 quarter, then the silence to the barline written as an eighth, a 16th and two 32nds (a quarter's worth, 8/32); bar 2 starts with a note, and its own end silence is the same */
  const g = mk({ rh: 'C5:h D5:q r:8 r:16 r:32 r:32 | E5:h r:q r:8 r:16 r:32 r:32', lh: 'C3:w | C3:w' });
  const r = GAPS.closeSmallGaps(g);
  const bar = i => eventsOf(r.graph, 'rest').filter(e => e.m === r.graph.timeline.measures[i].id && e.staff === r.graph.parts[0].staves[0].id).map(e => e.display.type).sort();
  assert.deepEqual(bar(0), ['16th', 'eighth'], 'bar 1: the two 32nd rests of the silence before the barline are not drawn (a note follows in bar 2)');
  assert.deepEqual(bar(1), ['16th', '32nd', '32nd', 'eighth', 'quarter'], 'the last bar of the hand keeps its rests');
  assert.equal(GAPS.closeSmallGaps(r.graph).graph, r.graph, 'idempotent');
  /* nothing else moved */
  assert.deepEqual(eventsOf(r.graph, 'note').map(e => e.at + '|' + e.dur), eventsOf(g, 'note').map(e => e.at + '|' + e.dur));
});

test('the app asks for it at every recording call site (and nowhere for a MIDI file)', () => {
  const html = fs.readFileSync(path.join(REPO, 'Piano Coach App.dc.html'), 'utf8').replace(/\r\n/g, '\n');
  const calls = [...html.matchAll(/\.toMusicXml\(\{[\s\S]*?\}, (\{[^}]*\})\);/g)].map(m => m[1]);
  assert.equal(calls.length, 4, 'the four recording call sites: ' + calls.join(' / '));
  calls.forEach(c => assert.match(c, /closeGaps: true/, c));
  const midi = /PPPAudioScore\.fromMidi\(bytes, (\{[^}]*\})\)/.exec(html);
  assert.ok(midi && !/closeGaps/.test(midi[1]), 'the MIDI import does not ask');
});

