/* G9e stray-note rescue (docs/GOALS/G09_CANDIDATES_CRITICS_REPAIR.md section 12, "G9e stray-note rescue").

   A real recording (YouTube piano cover, Onsets & Frames transcription, 90 measures, 1,225 notes) was refused by the one-note-per-hand arranger with
   ALL_CANDIDATES_HAVE_HARD_VIOLATIONS although the relaxed pass planned it: four of five candidates had exactly ONE hard violation, a VELOCITY (right hand, measure 12:
   the melody voice goes 94, then a chord [60, 65] - an accompaniment chord the transcription's voice split left in the melody voice - then 87; one note per hand keeps the 65,
   a 29-semitone shift in 0.123 s where the hand needs 0.18 s). candidates/index.js `strayRescue` now leaves such a note out (its event becomes a rest) when NO candidate
   survives and a candidate's every hard violation is a VELOCITY.

   What this checks (no browser; the page half is tests/single-note-app.test.js):
     - the real graph (tests/fixtures/g9e-transcription-stray-note.graph.json) is refused without the rescue and made with it, at the three levels: 0 hard violations at the
       request's hand profile, no hand starting two notes, no one-hand second or octave-plus, hands in order (<= 1% of the moments), exactly the expected notes reported, nothing
       but those notes missing (each is a rest now), the melody top line down by exactly one onset; the graph built from the heard notes (the review screen's path) does the same
     - a small synthetic piece with the same pattern (tests/fixtures/g9e-stray-note.musicxml, the investigation's melody 94 / [60, 65] chord / 87 shape): refused without, made with,
       the stray pitches reported and left out, every other note unchanged
     - strayRescue itself: the stray is the note the violation lands on or the one before it (the more isolated one); never a chord, a tied note, or a graph with any other hard
       violation (SPAN); more than RESCUE_MAX_DROPS notes is not a stray-note piece; idempotent on a graph with no violation
     - a piece with a surviving candidate is selected exactly as before (same fingerprint, no `rescued`), also with runAsync; a piece refused for another reason stays refused */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const E = require('./app-single-extract.js');
const REPO = E.REPO;
const R = p => require(path.join(REPO, p));
const CAND = R('candidates/index.js');
const SGG = R('songgraph/index.js');
const SGIDX = R('scoregraph/index.js');
const IMPORT = R('scoregraph/musicxml-import.js');
const PLA = R('playability/index.js');
const VCL = R('critics/vertical-clash.js');
const MET = R('critics/metrics.js');
const SER = R('scoregraph/serialize.js');
const AUDIO = R('audio-score.js');
const { mk } = R('tests/scoregraph/g3-helpers.js');

const ref = E.reference();
MET.setWeights(ref.weights);
const app = E.make({ window: E.nodeWindow(), loadArrangerReference: () => Promise.resolve(ref) });

const REAL = JSON.parse(fs.readFileSync(path.join(REPO, 'tests/fixtures/g9e-transcription-stray-note.graph.json'), 'utf8'));
const HEARD = JSON.parse(fs.readFileSync(path.join(REPO, 'tests/fixtures/g9e-transcription-stray-note.heard.json'), 'utf8'));
const LEVELS = ['beginner', 'intermediate', 'advanced'];
const STAGE = { beginner: 1, intermediate: 2, advanced: 3 };
/* the one note the rescue leaves out of the real piece: the stray chord's 65 of measure 12. (The hymn-pattern candidate has three more violations, in the left hand, none of them at
   an outlier, so it is not rescued and stays out of selection: the candidate the app selects is the ballad pattern.) */
const REAL_DROPPED = [{ m: '12', at: '7/12', hand: 'RH', pitch: 65 }];
const brief = list => list.map(x => ({ m: x.m, at: x.at, hand: x.hand, pitch: x.pitch }));

/* the same piece the page's graph of the investigation was: 8 bars, a melody around C5..G6, a left hand of half notes; bars 3 and 6 carry the stray [C4, F4] chord between A6 and D6
   (the melody 94 / [60, 65] / 87 shape, at 120 bpm: A6 a 16th, the chord an 8th, D6 a 16th) */
function synth() {
  const rh = [], lh = [];
  const mel = ['C5:q E5:q G5:q E5:q', 'D5:q F5:q A5:q F5:q', 'E5:q G5:q C6:q G5:q', 'F5:q A5:q C6:q A5:q'];
  for (let b = 0; b < 8; b++) {
    rh.push(b === 2 || b === 5 ? 'C6:q A6:16 C4+F4:8 D6:16 E6:q G6:q' : mel[b % 4]);
    lh.push(['C3:h G3:h', 'G2:h D3:h', 'A2:h E3:h', 'F2:h C3:h'][b % 4]);
  }
  return mk({ time: [4, 4], rh: rh.join(' | '), lh: lh.join(' | '), id: 'g9e-stray' });
}
const REQ = (level, hp) => ({ targetLevel: STAGE[level], handProfile: hp || 'large', sections: 'all' });
const RUN = { singleNoteHands: true, skipEngrave: true, reference: ref };

/* what each hand starts, in a realized graph: [{limb, midi, m, at}] (every head of every note event) */
function notesOf(graph) {
  const out = [];
  graph.parts.forEach(part => part.events.forEach(ev => {
    if (ev.kind !== 'note' || ev.grace) return;
    (ev.heads || []).forEach(h => out.push({ limb: R('scoregraph/pitch.js').limbOf(part, ev, h), midi: R('scoregraph/pitch.js').midi(h.pitch), m: ev.m, at: ev.at, dur: ev.dur, id: ev.id }));
  }));
  return out;
}

/* the checks of the output graph: hard violations at the request's profile, one note per hand, no second or octave-plus in one hand, hands in order */
function check(graph, profile) {
  const att = PLA.graph.attacksOf(graph);
  const v = VCL.verticalClash(graph), hc = MET.handCrossing(graph);
  return {
    hard: PLA.analyzeGraph(graph, { profile: profile }).totals.hard,
    multi: att.filter(a => a.heads.length > 1).length,
    handMax: Math.max(v.handMaxLH, v.handMaxRH),
    seconds: v.seconds, octave: v.octaveChords, handChords: v.handChords,
    crossing: hc.moments ? hc.crossed / hc.moments : 0, moments: hc.moments
  };
}
function assertClean(c, name) {
  assert.equal(c.hard, 0, name + ': no hard violation');
  assert.equal(c.multi, 0, name + ': no hand starts two notes');
  assert.equal(c.handMax, 1, name + ': one note per hand');
  assert.equal(c.seconds, 0, name + ': no one-hand second');
  assert.equal(c.octave, 0, name + ': no one-hand octave or more');
  assert.equal(c.handChords, 0, name + ': no hand chord');
  assert.ok(c.crossing <= CAND.HAND_CROSSING_MAX, name + ': hand crossing ' + c.crossing);
}

/* ================================================================ the real recording */
test('real transcription: refused without the rescue (every candidate has VELOCITY violations only), made at all three levels with it', async () => {
  const sg = SGG.analyze(REAL);
  const off = CAND.run(REAL, sg, REQ('intermediate'), Object.assign({ relax: 2, strayRescue: false }, RUN));
  assert.equal(off.ok, false);
  assert.equal(off.reason, 'ALL_CANDIDATES_HAVE_HARD_VIOLATIONS');
  off.scored.forEach(c => { assert.ok(!c.hardOk); assert.deepEqual(Object.keys(c.scores.hard.byCode), ['VELOCITY']); assert.ok(!('rescued' in c)); });
  assert.ok(off.scored.filter(c => c.scores.hard.byCode.VELOCITY === 1).length >= 4, 'four candidates have exactly the one violation of measure 12');
  const dropped = {};
  for (const level of LEVELS) {
    const r = await app.arrangeSingleNote(REAL, { level: level });
    assert.equal(r.ok, true, level + ' ' + r.reason);
    assert.equal(r.levelNote, 'relaxed-plan');
    assert.deepEqual(brief(r.rescued), REAL_DROPPED, level + ': exactly the expected notes are reported');
    assert.deepEqual(r.report.rescued, r.rescued, 'the report carries them too');
    r.rescued.forEach(x => assert.equal(x.why, 'VELOCITY'));
    assertClean(check(r.graph, r.report.request.handProfile), level);
    assert.equal(check(r.graph, 'large').hard, 0, level + ': none at the large profile either');
    dropped[level] = r;
  }
  /* the levels collapse for this recording (same plan, same candidate): documented limit, not a rescue effect */
  assert.equal(SER.fingerprint(dropped.beginner.graph), SER.fingerprint(dropped.advanced.graph));
});

test('real transcription: only the reported notes are missing (each is a rest now), the melody top line is down by exactly one onset, nothing is moved', () => {
  const sg = SGG.analyze(REAL), req = REQ('intermediate');
  /* the rescue is compared with and without ITSELF on the same source: the melody guard (G10c-0) would change the source of the run that is arranged and, when the run without the rescue finds
     no arrangement, fall back to the graph as it was, so both runs are made with the guard off here (the guarded piece is tested in tests/repair/melody-guard.test.js and by the first test above) */
  const on = CAND.run(REAL, sg, req, Object.assign({ relax: 2, melodyGuard: false }, RUN));
  const off = CAND.run(REAL, sg, req, Object.assign({ relax: 2, strayRescue: false, melodyGuard: false }, RUN));
  assert.equal(on.ok, true);
  const chosen = on.selected, before = off.scored.find(c => c.index === chosen.index);
  assert.equal(chosen.spec.pattern, before.spec.pattern, 'the same candidate (index ' + chosen.index + ') before and after');
  const a = notesOf(before.graph), b = notesOf(chosen.graph);
  assert.equal(a.length - b.length, chosen.rescued.length, 'one note per reported note');
  const keyOf = n => n.id + '|' + n.midi;
  const kept = new Set(b.map(keyOf));
  const gone = a.filter(n => !kept.has(keyOf(n)));
  assert.deepEqual(gone.map(n => n.midi).sort((x, y) => x - y), chosen.rescued.map(x => x.pitch).sort((x, y) => x - y), 'the missing notes are the reported ones');
  assert.equal(b.filter(n => !new Set(a.map(keyOf)).has(keyOf(n))).length, 0, 'no note was added or moved');
  /* each reported note's event is now a rest of the same length */
  const evBefore = new Map(), evAfter = new Map();
  before.graph.parts[0].events.forEach(e => evBefore.set(e.id, e)); chosen.graph.parts[0].events.forEach(e => evAfter.set(e.id, e));
  assert.equal(evBefore.size, evAfter.size, 'no event was removed (a rest keeps the voice whole)');
  gone.forEach(n => { const e = evAfter.get(n.id); assert.equal(e.kind, 'rest'); assert.equal(e.dur, evBefore.get(n.id).dur); assert.equal(e.at, evBefore.get(n.id).at); });
  /* melody: one onset of the original melody's top line is lost - the stray itself, which the source's melody voice does hold (1 of 462: 99.78%) */
  const tb = before.scores.melodyTopLine, ta = chosen.scores.melodyTopLine;
  assert.equal(tb, 1);
  assert.ok(Math.abs((tb - ta) - 1 / 462) < 1e-9, 'top line ' + tb + ' -> ' + ta);
  const ob = before.scores.melody, oa = chosen.scores.melody;
  assert.ok(Math.abs((ob - oa) - 1 / 656) < 1e-9, 'melody ' + ob + ' -> ' + oa);
  assert.equal(chosen.scores.level, before.scores.level, 'the assessed level does not move');
  /* the rescue stamps what it did: the event keeps no head; the graph validates and was sealed by ops.edit with the rescue as its source */
  assert.ok(chosen.graph.provenance.sources.some(s => s.tool === 'ppp.g9e-stray-note'));
});

test('real transcription, the review screen\'s path: the graph built from the heard notes is made too, with the same stray note left out', async () => {
  const built = AUDIO.toMusicXml({ notes: HEARD.notes, pedals: [], beats: [], downbeats: [] }, { title: 'Looping the Rooms', lock: { beats: 4, beatType: 4, bpm: 162, firstDownbeat: -0.371 } });
  assert.ok(built.graph);
  const r = await app.arrangeSingleNote(built.graph, { level: 'intermediate' });
  assert.equal(r.ok, true, r.reason);
  assert.deepEqual(r.rescued.map(x => [x.m, x.hand, x.pitch]), [['12', 'RH', 65]]);
  assertClean(check(r.graph, r.report.request.handProfile), 'review path');
});

/* ================================================================ the small piece with the same shape */
test('synthetic melody 94 / [60, 65] / 87: refused without the rescue, made with it; the stray notes are left out and nothing else changes', async () => {
  const g = synth(), sg = SGG.analyze(g);
  const off = CAND.run(g, sg, REQ('intermediate'), Object.assign({ strayRescue: false }, RUN));
  assert.equal(off.ok, false);
  assert.equal(off.reason, 'ALL_CANDIDATES_HAVE_HARD_VIOLATIONS');
  off.scored.forEach(c => assert.deepEqual(Object.keys(c.scores.hard.byCode), ['VELOCITY']));
  for (const level of LEVELS) {
    const r = await app.arrangeSingleNote(g, { level: level });
    assert.equal(r.ok, true, level + ' ' + r.reason);
    assert.deepEqual(brief(r.rescued), [{ m: '3', at: '5/16', hand: 'RH', pitch: 65 }, { m: '6', at: '5/16', hand: 'RH', pitch: 65 }], level);
    assertClean(check(r.graph, r.report.request.handProfile), level);
    /* the melody around it is as it was: A6 and D6 are still there, in both bars */
    const rh = notesOf(r.graph).filter(n => n.limb === 'RH').map(n => n.midi);
    assert.equal(rh.filter(x => x === 93).length, 2); assert.equal(rh.filter(x => x === 86).length, 2);
    assert.ok(!rh.includes(60) && !rh.includes(65), 'the chord is out of the right hand');
  }
});

test('synthetic: the rescue is deterministic, the same through runAsync, and the result carries `rescued` on the selection and in its report', async () => {
  const g = synth(), sg = SGG.analyze(g), req = REQ('intermediate');
  const a = CAND.run(g, sg, req, RUN), b = await CAND.runAsync(g, sg, req, Object.assign({ yield: () => Promise.resolve() }, RUN)), c = CAND.run(g, sg, req, Object.assign({ fullEngrave: true }, RUN, { skipEngrave: true }));
  [a, b, c].forEach(x => { assert.equal(x.ok, true); assert.equal(x.selected.rescued.length, 2); assert.deepEqual(x.selected.report.rescued, x.selected.rescued); });
  assert.equal(a.selected.fingerprint, b.selected.fingerprint);
  assert.equal(a.selected.fingerprint, c.selected.fingerprint);
  assert.equal(SER.fingerprint(a.selected.graph), a.selected.fingerprint);
  /* every candidate that is not rescued is reported as it was */
  a.scored.forEach(x => { if (x.hardOk) assert.ok(x.rescued && x.rescued.length); });
  /* the cache key tells the two apart */
  const cache = new Map();
  CAND.run(g, sg, req, Object.assign({ cache: cache }, RUN));
  CAND.run(g, sg, req, Object.assign({ cache: cache, strayRescue: false }, RUN));
  assert.equal(cache.size, 2);
});

/* ================================================================ strayRescue itself */
const LARGE = 'large';
const vel = g => PLA.analyzeGraph(g, { profile: LARGE }).events.filter(e => e.hard.length);

test('strayRescue: the note the violation lands on, or the one before it (the more isolated one), is the one left out', () => {
  /* a chord's single stray between two high notes (arrival violates): the stray goes */
  const arrive = mk({ time: [4, 4], rh: 'C6:q A6:16 C4:16 D6:8 E6:q r:q', lh: 'C3:w' });
  assert.ok(vel(arrive).length > 0);
  const r1 = CAND.strayRescue(arrive, LARGE);
  assert.deepEqual(r1.rescued.map(x => x.pitch), [60]);
  assert.equal(vel(r1.graph).length, 0);
  /* the stray is the note BEFORE the one flagged (it is reached slowly, left fast): still the stray goes, not the normal note after it */
  const leave = mk({ time: [4, 4], rh: 'C6:q C4:16 A6:16 r:8 r:q r:q', lh: 'C3:w' });
  assert.ok(vel(leave).length > 0);
  const r2 = CAND.strayRescue(leave, LARGE);
  assert.deepEqual(r2.rescued.map(x => x.pitch), [60], 'the low note, not A6');
  assert.equal(vel(r2.graph).length, 0);
  assert.equal(notesOf(r2.graph).filter(n => n.limb === 'RH').map(n => n.midi).join(), '84,93');
  /* the dropped event is a rest, the voice is whole, the graph validated */
  assert.ok(r2.graph.parts[0].events.some(e => e.kind === 'rest' && e.at === '1/4' && e.dur === '1/16' && e.voice === r2.graph.parts[0].events.find(x => x.kind === 'note' && x.at === '0').voice));
});

test('strayRescue: not a chord, not a tied note, not a graph with another kind of hard violation, not more than eight notes, nothing to do on a clean graph', () => {
  const chord = mk({ time: [4, 4], rh: 'C6:q A6:16 C4+F4:16 D6:8 E6:q r:q', lh: 'C3:w' });
  assert.ok(vel(chord).length > 0);
  assert.equal(CAND.strayRescue(chord, LARGE), null, 'an attack with two notes is not taken');
  const tied = mk({ time: [4, 4], rh: 'C6:q A6:16 C4:16~ C4:8 D6:16 r:8 r:16 r:q', lh: 'C3:w' });
  assert.ok(vel(tied).length > 0);
  assert.equal(CAND.strayRescue(tied, LARGE), null, 'a tied note is not taken');
  const span = mk({ time: [4, 4], rh: 'C6:q A6:16 C4:16 D6:8 C4+C6:q r:q', lh: 'C3:w' });
  assert.ok(PLA.analyzeGraph(span, { profile: LARGE }).events.some(e => e.hard.some(h => h.code === 'SPAN')));
  assert.equal(CAND.strayRescue(span, LARGE), null, 'another hard violation (SPAN) means no rescue at all');
  const bar = 'A6:8 A6:16 C4:16 A6:8 A6:16 C4:16 r:q r:q';
  const six = mk({ time: [4, 4], rh: [bar, bar, bar].join(' | '), lh: 'C3:w | C3:w | C3:w' });
  const r6 = CAND.strayRescue(six, LARGE);
  assert.equal(r6.rescued.length, 6, 'six strays go');
  assert.equal(vel(r6.graph).length, 0);
  const ten = mk({ time: [4, 4], rh: Array.from({ length: 10 }, () => bar).join(' | '), lh: Array.from({ length: 10 }, () => 'C3:w').join(' | ') });
  assert.equal(CAND.strayRescue(ten, LARGE), null, 'twenty are not a stray-note piece');
  const clean = mk({ time: [4, 4], rh: 'C5:q D5:q E5:q F5:q', lh: 'C3:w' });
  assert.equal(CAND.strayRescue(clean, LARGE), null, 'a graph with no violation is returned as null: nothing was rescued');
});

/* the review's reproductions of the first version: a stray at the LAST attack, two adjacent strays, and a note inside a wide figure */
test('strayRescue: a stray at the last or the first attack of the hand goes, not the legitimate note next to it', () => {
  const last = mk({ time: [4, 4], rh: 'C6:q D6:q E6:8 D6:16 C3:16 r:q', lh: 'C3:w' });
  assert.ok(vel(last).length > 0);
  const r = CAND.strayRescue(last, LARGE);
  assert.deepEqual(r.rescued.map(x => x.pitch), [48], 'the C3 goes (D6 stays)');
  assert.equal(vel(r.graph).length, 0);
  assert.deepEqual(notesOf(r.graph).filter(n => n.limb === 'RH').map(n => n.midi), [84, 86, 88, 86]);
  const first = mk({ time: [4, 4], rh: 'C3:16 D6:16 E6:8 D6:q r:q r:q', lh: 'C3:w' });
  assert.ok(vel(first).length > 0);
  const f = CAND.strayRescue(first, LARGE);
  assert.deepEqual(f.rescued.map(x => x.pitch), [48], 'a stray first note goes (D6 stays)');
  assert.deepEqual(notesOf(f.graph).filter(n => n.limb === 'RH').map(n => n.midi), [86, 88, 86]);
});

test('strayRescue: two adjacent strays go together (a chord split over two attacks), the notes around them stay', () => {
  const two = mk({ time: [4, 4], rh: 'C6:q A6:16 C4:32 F3:32 D6:8 E6:q r:q', lh: 'C3:w' });
  assert.ok(vel(two).length > 0);
  const r = CAND.strayRescue(two, LARGE);
  assert.deepEqual(r.rescued.map(x => x.pitch), [60, 53]);
  assert.equal(vel(r.graph).length, 0);
  assert.deepEqual(notesOf(r.graph).filter(n => n.limb === 'RH').map(n => n.midi), [84, 93, 86, 88]);
  /* three adjacent are not a stray: the run is at most two */
  const three = mk({ time: [4, 4], rh: 'C6:q A6:16 C4:32 F3:32 B3:32 r:32 D6:8 E6:q r:8 r:16', lh: 'C3:w' });
  assert.equal(CAND.strayRescue(three, LARGE), null);
});

test('strayRescue: a note inside a regular wide figure is no outlier and is never taken (czerny849/010: 60 69 77 50 60 69 78)', () => {
  const fig = mk({ time: [4, 4], rh: 'C4:16 A4:16 F5:16 D3:16 C4:16 A4:16 F#5:16 r:q r:q r:16', lh: 'C3:w' });
  assert.ok(vel(fig).length > 0);
  assert.equal(CAND.strayRescue(fig, LARGE), null, 'the D3 is part of the figure: the piece stays refused');
});

test('strayRescue: random melodies with planted strays - the legitimate notes are not dropped (fuzz, seeded)', () => {
  let seed = 7;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const pick = a => a[Math.floor(rnd() * a.length)];
  const NAMES = ['C', 'D', 'E', 'F', 'G', 'A', 'B'], PCN = { 0: 'C', 2: 'D', 4: 'E', 5: 'F', 7: 'G', 9: 'A', 11: 'B', 1: 'C#', 3: 'D#', 6: 'F#', 8: 'G#', 10: 'A#' };
  let triggered = 0, legit = 0, dropped = 0;
  for (let it = 0; it < 300; it++) {
    const notes = []; let deg = 35 + Math.floor(rnd() * 7);
    const bars = 4 + Math.floor(rnd() * 6);
    for (let b = 0; b < bars; b++) {
      let left = 16;
      while (left > 0) {
        const d = pick([4, 2, 1].filter(x => x <= left));
        notes.push({ deg: deg, dur: d }); left -= d;
        deg = Math.max(31, Math.min(47, deg + pick([-2, -1, -1, 0, 1, 1, 2])));
      }
    }
    const cand = [];
    for (let k = 0; k < notes.length - 1; k++) if (k === 0 || notes[k - 1].dur === 1) cand.push(k);
    const strays = new Set();
    for (let t = 0; t < 1 + Math.floor(rnd() * 2); t++) {
      const k = pick(cand);
      [k].concat(rnd() < 0.25 && k + 2 < notes.length ? [k + 1] : []).forEach(j => { strays.add(j); notes[j].low = 48 + Math.floor(rnd() * 18); });
    }
    /* strays at least three notes apart: a stray, a melody note, a stray is the pattern of a trill, which nothing can tell from a melody */
    const sorted = [...strays].sort((a, b) => a - b);
    if (sorted.some((x, i) => i && x - sorted[i - 1] > 1 && x - sorted[i - 1] < 3)) continue;
    let acc = 0; const toks = [];
    notes.forEach(n => {
      const m = n.low, nm = m != null ? PCN[m % 12] + (Math.floor(m / 12) - 1) : NAMES[((n.deg % 7) + 7) % 7] + Math.floor(n.deg / 7);
      toks.push(nm + ':' + { 4: 'q', 2: '8', 1: '16' }[n.dur]); acc += n.dur; if (acc % 16 === 0) toks.push('|');
    });
    const line = toks.join(' ').replace(/ \|$/, '').split(' | ').map(x => x.replace(/ \|$/, '')).join(' | ');
    const g = mk({ time: [4, 4], rh: line, lh: Array.from({ length: line.split('|').length }, () => 'C3:w').join(' | ') });
    if (!vel(g).length) continue;
    const r = CAND.strayRescue(g, LARGE);
    if (!r) continue;
    triggered++;
    const rh = g.parts[0].events.filter(e => e.kind === 'note' && e.staff === g.parts[0].staves[0].id), after = new Map(r.graph.parts[0].events.map(e => [e.id, e]));
    rh.forEach((e, i) => { if (after.get(e.id).kind === 'rest') { dropped++; if (!strays.has(i)) legit++; } });
    assert.equal(vel(r.graph).length, 0);
  }
  assert.ok(triggered >= 80, 'the rescue was exercised: ' + triggered);
  assert.equal(legit, 0, legit + ' legitimate notes dropped of ' + dropped);
});

test('fewestDrops: among the candidates the rescue cleared, those that left out more notes are discarded; nothing else is touched', () => {
  const mkc = (index, n, hardOk) => ({ index: index, hardOk: hardOk !== false, rescued: n ? new Array(n).fill({}) : undefined });
  const list = [mkc(0, 1), mkc(1, 4), mkc(2, 1), mkc(3, 2), mkc(4, 0, false)];
  const out = CAND.fewestDrops(list);
  assert.deepEqual(out.map(c => c.hardOk), [true, false, true, false, false]);
  assert.deepEqual(out.filter(c => c.rescueExtra).map(c => c.index), [1, 3]);
  const same = [mkc(0, 2), mkc(1, 2)];
  assert.equal(CAND.fewestDrops(same), same, 'equal counts: the very same list');
  const none = [mkc(0, 0, false)];
  assert.equal(CAND.fewestDrops(none), none);
});

test('real transcription: the left-hand notes of the hymn candidate are no outliers, so that candidate is not rescued and the app\'s result leaves out the one stray note only', () => {
  const sg = SGG.analyze(REAL);
  const sel = CAND.run(REAL, sg, REQ('intermediate'), Object.assign({ relax: 2 }, RUN));
  assert.equal(sel.ok, true);
  const hymn = sel.scored.find(c => c.spec.pattern === 'hymn');
  assert.equal(hymn.hardOk, false, 'four violations, three of them not at a stray: refused as before');
  assert.ok(!('rescued' in hymn));
  assert.equal(sel.selected.rescued.length, 1);
  assert.equal(sel.selected.rescued[0].pitch, 65);
  sel.scored.filter(c => c.hardOk).forEach(c => assert.equal(c.rescued.length, 1));
});

/* ================================================================ nothing else changes */
test('a piece with a surviving candidate is selected exactly as before (same fingerprints, no `rescued`), with runAsync too', async () => {
  const hymn = IMPORT.importMusicXml(fs.readFileSync(path.join(REPO, 'catalog/hymns/christ-arose.musicxml'), 'utf8'), { scoreId: 'h-christ-arose' }).graph;
  const sg = SGG.analyze(hymn), req = REQ('intermediate');
  const a = CAND.run(hymn, sg, req, RUN), b = CAND.run(hymn, sg, req, Object.assign({ strayRescue: false }, RUN)), c = await CAND.runAsync(hymn, sg, req, RUN);
  assert.equal(a.ok && b.ok && c.ok, true);
  assert.equal(a.scored.length, b.scored.length);
  a.scored.forEach((x, i) => { assert.equal(x.fingerprint, b.scored[i].fingerprint); assert.ok(!('rescued' in x)); });
  assert.equal(a.selected.fingerprint, b.selected.fingerprint);
  assert.equal(a.selected.fingerprint, c.selected.fingerprint);
  assert.ok(!('rescued' in a.selected) && !('rescued' in c.selected));
  const r = await app.arrangeSingleNote(hymn, { level: 'intermediate' });
  assert.equal(r.ok, true);
  assert.equal(r.rescued, null);
  assert.ok(!('rescued' in r.report));
});

test('a piece refused for another reason stays refused (hanon/006: every candidate crosses its hands; no rescue is tried)', async () => {
  const r = await SGIDX.importFile(new Uint8Array(fs.readFileSync(path.join(REPO, 'catalog/method/hanon/006.mxl'))), { name: 'catalog/method/hanon/006.mxl', scoreId: 'hanon-006' });
  assert.ok(r.ok);
  const sel = CAND.run(r.graph, SGG.analyze(r.graph), REQ('advanced'), Object.assign({ relax: 2 }, RUN));
  assert.equal(sel.ok, false);
  assert.equal(sel.reason, 'ALL_CANDIDATES_HAVE_HARD_VIOLATIONS');
  assert.ok(sel.scored.every(c => !('rescued' in c)));
  /* without singleNoteHands the rescue never runs, whatever the violations (the standard candidates are not touched) */
  const g = synth();
  const std = CAND.run(g, SGG.analyze(g), REQ('intermediate'), { skipEngrave: true, reference: ref });
  assert.ok(std.scored.every(c => !('rescued' in c)));
});
