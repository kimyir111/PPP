/* G9f (docs/GOALS/G09_CANDIDATES_CRITICS_REPAIR.md section 12 "G9f final-review fixes"): closeSmallGaps, the last step of repairSelection for a
   one-note-per-hand arrangement. A gap between a note's end and the hand's next onset (or the end of its measure) that is longer than 0 and shorter than a 16th
   (1/16 of a whole note) is closed by lengthening the note before it; the rests that were in the gap go. Only that:
     - no note is shortened, no onset or pitch changes, no note crosses a barline, no note passes the hand's next onset
     - a gap of a 16th or more, a gap at the start of a measure (nothing of the measure before it: no note is lengthened across a barline) and a gap that is a written triplet rest are left alone
     - the left hand is not touched by a right-hand gap; another voice's rest that reaches beyond the gap stays
     - running it again changes nothing (the same object comes back) */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const REPO = path.resolve(__dirname, '..', '..');
const { mk } = require(path.join(REPO, 'tests/scoregraph/g3-helpers.js'));
const R = require(path.join(REPO, 'scoregraph/rational.js'));
const REP = require(path.join(REPO, 'repair/index.js'));

/* "bar|staff|at|dur|display|pitches" for every note, and for every rest, in graph order of time */
function dump(g, kind) {
  const part = g.parts[0];
  const mi = new Map(g.timeline.measures.map((m, i) => [m.id, i + 1]));
  const si = new Map(part.staves.map((s, i) => [s.id, i + 1]));
  return part.events.filter(e => e.kind === kind).map(e => [mi.get(e.m), si.get(e.staff), e.at, e.dur, (e.display.type || '') + (e.display.dots ? '.' : ''),
    (e.heads || []).map(h => h.pitch.step + h.pitch.oct).join('+')].join('|')).sort();
}
const num = s => { const [n, d] = String(s).split('/'); return Number(n) / (d ? Number(d) : 1); };

/* bar 1: C5 quarter, a 32nd gap, D5 quarter, a 16th rest (exactly 1/16: not touched), E5 quarter, F5 eighth, two 64th rests to the barline (a 32nd gap at the end of the bar)
   bar 2: G4 32nd, a 32nd rest, A4 16th, B4 dotted half, C5 eighth (the first note becomes a plain 16th)
   bar 3: a 32nd rest at the START of the bar (no note before it in the bar), then notes */
const FIXTURE = {
  rh: 'C5:q r:32 D5:q r:16 E5:q F5:8 r:64 r:64 | G4:32 r:32 A4:16 B4:h. C5:8 | r:32 C5:q D5:q E5:q F5:8=7/32',
  lh: 'C3:w | C3:w | C3:w'
};

test('closeSmallGaps: sub-16th gaps are closed by lengthening the note before them, nothing else moves (planted fixture)', () => {
  const g = mk(FIXTURE);
  const r = REP.closeSmallGaps(g);
  assert.equal(r.changed, true);
  assert.deepEqual(r.stats, { gaps: 3, notesLengthened: 3, restsRemoved: 5, rewritten: 1, longest: '1/32', omitted: 1, skipped: 0 });
  const before = dump(g, 'note'), after = dump(r.graph, 'note');
  assert.equal(after.length, before.length);
  /* the same notes at the same onsets with the same pitches; only the length of three of them differs, each by less than a 16th */
  const key = x => x.split('|').filter((_, i) => i !== 3 && i !== 4).join('|');
  assert.deepEqual(after.map(key).sort(), before.map(key).sort());
  const durOf = (list, k) => num(list.find(x => key(x) === k).split('|')[3]);
  let lengthened = 0;
  before.forEach(b => {
    const d0 = durOf(before, key(b)), d1 = durOf(after, key(b));
    assert.ok(d1 >= d0, 'no note is shortened: ' + b);
    if (d1 > d0) { lengthened++; assert.ok(d1 - d0 < 1 / 16, 'by less than a 16th: ' + b); }
  });
  assert.equal(lengthened, 3);
  /* bar 1: C5 reaches the D5 (1/4 + 1/32), F5 reaches the barline (1/8 + 1/32: not a plain value, so it keeps its written eighth); bar 2: G4 + 1/32 = a 16th, written as one */
  assert.ok(after.includes('1|1|0|9/32|quarter|C5'), after.join(' '));
  assert.ok(after.includes('1|1|27/32|5/32|eighth|F5'));
  assert.ok(after.includes('2|1|0|1/16|16th|G4'), 'a 32nd + a 32nd gap is written as the 16th it now is');
  /* the rests: the 16th rest of bar 1 stays; the three gaps' four rests are gone, and so is the 32nd rest at the start of bar 3 (a 32nd rest is not drawn before a note: omitted, the silence stays) */
  assert.deepEqual(dump(r.graph, 'rest'), ['1|1|17/32|1/16|16th|']);
  /* the left hand is untouched */
  assert.deepEqual(dump(r.graph, 'note').filter(x => x.split('|')[1] === '2'), before.filter(x => x.split('|')[1] === '2'));
  /* every note ends where it ended or later, never past the next onset of its hand, never past its barline */
  const part = r.graph.parts[0];
  const bars = new Map(r.graph.timeline.measures.map(m => [m.id, R.parse(m.dur)]));
  const byStaff = new Map();
  part.events.filter(e => e.kind === 'note').forEach(e => { const k = e.staff + '|' + e.m; (byStaff.get(k) || byStaff.set(k, []).get(k)).push(e); });
  byStaff.forEach(list => {
    list.sort((a, b) => R.cmp(R.parse(a.at), R.parse(b.at)));
    list.forEach((e, i) => {
      const end = R.add(R.parse(e.at), R.parse(e.dur));
      assert.ok(R.le(end, bars.get(e.m)), 'inside its measure');
      if (list[i + 1]) assert.ok(R.le(end, R.parse(list[i + 1].at)), 'not past the next onset of the hand');
    });
  });
  /* the graph is valid (OPS.edit seals it) and the pitches sound as before */
  assert.equal(r.graph.parts[0].spanners.length, g.parts[0].spanners.length);
});

test('closeSmallGaps: a second run changes nothing (the very same graph object comes back), a graph with no sub-16th gap is returned as it is', () => {
  const g = mk(FIXTURE);
  const once = REP.closeSmallGaps(g);
  const twice = REP.closeSmallGaps(once.graph);
  assert.equal(twice.changed, false);
  assert.equal(twice.graph, once.graph);
  const clean = mk({ rh: 'C5:q D5:q E5:q F5:q | G5:h r:h', lh: 'C3:w | C3:w' });
  const c = REP.closeSmallGaps(clean);
  assert.equal(c.changed, false);
  assert.equal(c.graph, clean);
});

test('closeSmallGaps: a gap of exactly a 16th is not touched; a triplet 16th gap (1/24) is shorter than a 16th and is closed', () => {
  /* bar 1: a quarter, a 16th rest (exactly 1/16), a dotted eighth, a half: 1/4 + 1/16 + 3/16 + 1/2 = 1; bar 2: no rests at all */
  const g = mk({ rh: 'C5:q r:16 D5:8. E5:h | C5:q D5:q E5:q F5:q', lh: 'C3:w | C3:w' });
  const r = REP.closeSmallGaps(g);
  assert.equal(r.changed, false, 'nothing to close');
  assert.equal(r.graph, g);
  /* a transcription's triplet grid: a rest of 1/24 between two notes is a gap shorter than a 16th (it is drawn as a 16th rest, but it is not a written one: no tuplet) */
  const t = mk({ rh: 'C5:q r:16=1/24 D5:q E5:q F5:8=1/12 r:16=1/24 r:16=1/24 r:8=1/24', lh: 'C3:w' });
  const c = REP.closeSmallGaps(t);
  assert.equal(c.changed, true);
  assert.equal(c.stats.gaps, 1);
  assert.ok(dump(c.graph, 'note').includes('1|1|0|7/24|quarter|C5'), dump(c.graph, 'note').join(' '));
  assert.equal(dump(c.graph, 'rest').length, 3, 'the three rests at the end of the bar (1/8 in all, nothing after them) stay');
});

test('closeSmallGaps: a lengthened note takes a plain value of at most ONE dot (a double-dotted note is never written); otherwise it keeps its written value', () => {
  /* thirty-seconds: C5 eighth (4) + gap 1 -> 5/32 is not a plain value; D5 16th (2) + gap 1 -> 3/32 a dotted 16th (one dot: written); F5 dotted eighth (6) + gap 1 -> 7/32 would be a
     double-dotted eighth: not written, it stays the dotted eighth it was, 7/32 long */
  const g = mk({ rh: 'C5:8 r:32 D5:16 r:32 E5:16 F5:8. r:32 G5:q A5:q=7/32', lh: 'C3:w' });
  const r = REP.closeSmallGaps(g);
  assert.deepEqual(r.stats.rewritten, 1);
  const notes = dump(r.graph, 'note');
  assert.ok(notes.includes('1|1|0|5/32|eighth|C5'), notes.join(' '));
  assert.ok(notes.includes('1|1|5/32|3/32|16th.|D5'), notes.join(' '));
  assert.ok(notes.includes('1|1|5/16|7/32|eighth.|F5'), notes.join(' '));
  notes.forEach(x => assert.ok(x.split('|')[4].split('.').length <= 2, 'at most one dot: ' + x));
});

test('closeSmallGaps: a rest of another voice that reaches beyond the gap stays; a note of another voice that sounds through the gap means there is no gap', () => {
  /* voice 1: C5 half, a 32nd rest, D5 ..., voice 2 holds a whole-bar rest: that rest is not "in" the gap, so it stays */
  const g = mk({ rh: 'C5:h r:32 D5:h=15/32', rh2: 'r:w', lh: 'C3:w' });
  const r = REP.closeSmallGaps(g);
  assert.equal(r.changed, true);
  assert.deepEqual(dump(r.graph, 'rest'), ['1|1|0|1|whole|'], 'the other voice\'s whole-bar rest stays, the 32nd rest goes');
  assert.ok(dump(r.graph, 'note').includes('1|1|0|17/32|half|C5'), 'C5 reaches D5');
  /* a second voice's note sounds through the first voice's gap: no silence in the hand, nothing to close */
  const g2 = mk({ rh: 'C5:q r:32 D5:q=7/32 E5:h', rh2: 'G4:h r:h', lh: 'C3:w' });
  const r2 = REP.closeSmallGaps(g2);
  assert.equal(r2.changed, false, 'the hand sounds (G4) the whole time the first voice has a gap');
});

test('closeSmallGaps: a note is never lengthened across a barline (a gap at the start of a measure is not closed from the measure before)', () => {
  const g = mk({ rh: 'C5:w | r:32 D5:w=31/32', lh: 'C3:w | C3:w' });
  const r = REP.closeSmallGaps(g);
  assert.deepEqual(dump(g, 'note'), dump(r.graph, 'note'), 'C5 still ends at the barline, D5 still starts 1/32 after it');
  assert.equal(r.stats.notesLengthened, 0);
  assert.deepEqual(dump(r.graph, 'rest'), [], 'the 32nd rest at the start of the measure is not drawn (omitted), nothing is stretched');
});

test('closeSmallGaps: a 32nd or 64th rest among the pieces of a longer silence with a note after it is omitted (the silence stays, no note changes); a rest at the end of a measure stays', () => {
  /* bar 1: C5, a quarter rest and a 32nd rest (9/32 of silence: not a sub-16th gap), D5; bar 2: E5, then rests to the barline (nothing after them) */
  const g = mk({ rh: 'C5:q r:q r:32 D5:q=15/32 | E5:h r:q r:8 r:16 r:32 r:32', lh: 'C3:w | C3:w' });
  const r = REP.closeSmallGaps(g);
  assert.equal(r.changed, true);
  assert.deepEqual(r.stats, { gaps: 0, notesLengthened: 0, restsRemoved: 1, rewritten: 0, longest: '0', omitted: 1, skipped: 0 });
  assert.deepEqual(dump(r.graph, 'note'), dump(g, 'note'), 'no note changes at all (onset, length, pitch)');
  assert.deepEqual(dump(r.graph, 'rest'), ['1|1|1/4|1/4|quarter|', '2|1|1/2|1/4|quarter|', '2|1|3/4|1/8|eighth|', '2|1|7/8|1/16|16th|', '2|1|15/16|1/32|32nd|', '2|1|31/32|1/32|32nd|'].sort(), 'the 32nd before D5 is gone; the rests at the end of bar 2 stay');
});

test('closeSmallGaps never throws: two voices on one staff (the cases that made it throw E-VOICE-OVERLAP) come back valid, and a lengthened note never meets another event of its own voice', () => {
  const specs = [
    { rh: 'G5:8 r:16 r:h G5:32 C5:16 r:16 E5:8 G5:32', rh2: 'r:8 B4:8 r:16 r:32 r:32 A4:8 B4:16 r:8 r:8 B4:16 r:16 A4:32 r:32', lh: 'C3:w' },
    { rh: 'r:32 E5:16 C5:q E5:16 r:16 r:8 r:16 C5:32 C5:32 C5:q C5:32', rh2: 'r:8 r:32 G4:q r:32 A4:h r:16', lh: 'C3:w' }
  ];
  specs.forEach(spec => {
    const g = mk(spec);
    let r;
    assert.doesNotThrow(() => { r = REP.closeSmallGaps(g); });
    assert.equal(r.stats.failed, undefined, 'no internal failure was needed: the gaps that would overlap are skipped');
    /* no two events of one voice overlap */
    const by = new Map();
    r.graph.parts[0].events.filter(e => !e.grace).forEach(e => { const k = e.voice + '|' + e.m; (by.get(k) || by.set(k, []).get(k)).push(e); });
    by.forEach(list => {
      list.sort((a, b) => R.cmp(R.parse(a.at), R.parse(b.at)));
      for (let i = 1; i < list.length; i++) assert.ok(R.le(R.add(R.parse(list[i - 1].at), R.parse(list[i - 1].dur)), R.parse(list[i].at)), 'no overlap inside a voice');
    });
  });
  /* any internal failure comes back as the input graph itself */
  const bad = Object.freeze({ not: 'a graph' });
  const f = REP.closeSmallGaps(bad);
  assert.equal(f.graph, bad); assert.equal(f.changed, false); assert.ok(f.stats.failed);
});

test('closeGaps gating: only a transcription (source provenance audio-score) is closed by default; true closes anything, false nothing; a printed score keeps its short rests as written', async () => {
  const CAND = require(path.join(REPO, 'candidates/index.js'));
  const SGG = require(path.join(REPO, 'songgraph/index.js'));
  const H = require(path.join(REPO, 'tests/engrave/helpers.js'));
  const g = await H.graphOf('tests/fixtures/g9f-small-gaps.musicxml'); /* a 64th rest after the first eighth of every beat (32), a printed score */
  assert.equal(REP.isTranscription(g), false);
  const asRecording = JSON.parse(JSON.stringify(g));
  asRecording.provenance.sources.forEach(x => { x.kind = 'audio-score'; });
  assert.equal(REP.isTranscription(asRecording), true);
  assert.equal(REP.isTranscription(JSON.parse(require('fs').readFileSync(path.join(REPO, 'tests/fixtures/g9e-transcription-stray-note.graph.json'), 'utf8'))), true, 'the stored real transcription');
  const request = { targetLevel: 2, handProfile: 'large', sections: 'all' };
  const run = (graph, o) => {
    const sg = SGG.analyze(graph);
    let sel = CAND.run(graph, sg, request, { singleNoteHands: true });
    if (!sel.ok) sel = CAND.run(graph, sg, request, { singleNoteHands: true, relax: 2 });
    assert.ok(sel.ok);
    return REP.repairSelection(sel, graph, sg, request, o);
  };
  const smallRests = r => r.graph.parts[0].events.filter(e => e.kind === 'rest' && /^(32nd|64th)$/.test(e.display.type)).length;
  const printed = run(g, undefined);
  assert.equal(printed.report.closedGaps, undefined, 'default, printed score: not run');
  assert.equal(smallRests(printed), 32, 'its 32 rests are left exactly as written');
  const forced = run(g, { closeGaps: true });
  assert.equal(forced.report.closedGaps.gaps, 32);
  assert.equal(smallRests(forced), 0);
  const auto = run(asRecording, undefined);
  assert.equal(auto.report.closedGaps.gaps, 32, 'a transcription: closed by default');
  assert.equal(smallRests(auto), 0);
  const off = run(asRecording, { closeGaps: false });
  assert.equal(off.report.closedGaps, undefined);
  assert.equal(smallRests(off), 32);
  /* what closing does to the notes of the transcription: the same 72 notes at the same onsets and pitches */
  const key = r => r.graph.parts[0].events.filter(e => e.kind === 'note').map(e => e.m + '|' + e.at + '|' + e.heads.map(h => h.pitch.step + h.pitch.oct).join('+')).sort();
  assert.deepEqual(key(auto), key(off));
});
