/* "Left-hand run rests" (docs/GOALS/G09_CANDIDATES_CRITICS_REPAIR.md section 12): the teacher's copy of their YouTube transcription had a continuous left-hand run of 16th notes
   with 5 lone 16th rests inside it (m2 @3.25 and @3.75, m4 @1.5, m34 @3.25, m37 @1.25: a broken-looking arpeggio). Their decision: "delete the rest and extend the previous note".
   scoregraph/gaps.js fillRunRests (a part of tidyRests):
     - LEFT-HAND staff only (limb 'LH'; a two-staff part with no limb: the lower staff); the right hand's rests are the melody's and are never touched
     - a lone plain 16th rest with a plain 16th note of the same voice ending where it starts and a note of the voice starting where it ends (at the end of a bar: the first note of the next bar)
       -> the rest is removed, the note before it becomes an eighth (it rings exactly 1/16 of a whole note longer, never past the next onset, never across a barline)
     - not for another length, a tied / chord / tuplet / other-voice note, a bar end with no note after it, a span another voice of the staff starts a note in
     - onsets and pitches never change; idempotent; a fixed point with closeSmallGaps and mergeRests; gated like them (a printed score and a MIDI source are untouched) */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const REPO = path.resolve(__dirname, '..', '..');
const { mk } = require(path.join(REPO, 'tests/scoregraph/g3-helpers.js'));
const R = require(path.join(REPO, 'scoregraph/rational.js'));
const V = require(path.join(REPO, 'scoregraph/validate.js'));
const GAPS = require(path.join(REPO, 'scoregraph/gaps.js'));
const REP = require(path.join(REPO, 'repair/index.js'));
const A = require(path.join(REPO, 'audio-score.js'));

/* a 4/4 left-hand bar from tokens, completed with 16th notes (each told apart by its pitch) up to the barline; `n` is a plain 16th note, `r` a plain 16th rest */
const UNITS = { '16': 2, '8': 4, '8.': 6, '16.': 3, '32': 1, q: 8 };     /* in 32nds */
const PITCH = ['C3', 'E3', 'G3', 'E3', 'D3', 'F3', 'A3', 'F3'];
function bar(...tokens) {
  let u = 0, k = 0;
  const out = tokens.map(t => {
    if (t === 'n') t = PITCH[k++ % 8] + ':16';
    else if (t === 'r') t = 'r:16';
    const code = t.split(':')[1].replace(/=.*$/, '').replace(/~$/, '');
    u += UNITS[code];
    return t;
  });
  while (u < 32) { out.push(PITCH[k++ % 8] + ':16'); u += 2; }
  assert.equal(u, 32, 'the bar is full: ' + tokens.join(' '));
  return out.join(' ');
}
/* a bar of 16 positions from a pattern of 'n' and 'r' characters */
const pat = p => bar(...p.split(''));
const FULL = 'nnnnnnnnnnnnnnnn';
const lh = (...bars) => bars.join(' | ');
const rhOf = n => Array.from({ length: n }, () => 'C5:w').join(' | ');
const build = (pats, extra) => mk(Object.assign({ rh: rhOf(pats.length), lh: lh(...pats.map(pat)) }, extra));
const one = (lhLine, extra) => mk(Object.assign({ rh: 'C5:w', lh: lhLine }, extra));

const mIndex = g => new Map(g.timeline.measures.map((m, i) => [m.id, i + 1]));
const lhStaff = g => g.parts[0].staves.find(s => s.limb === 'LH').id;
function lhEvents(g, kind) {
  const mi = mIndex(g), st = lhStaff(g);
  return g.parts[0].events.filter(e => e.staff === st && !e.grace && (!kind || e.kind === kind))
    .map(e => ({ m: mi.get(e.m), at: R.parse(e.at), dur: R.parse(e.dur), e: e }))
    .sort((a, b) => a.m - b.m || R.cmp(a.at, b.at));
}
const beat = at => R.toNumber(at) * 4;             /* quarters from the bar's start (the score's own `b`) */
const restsAt = g => lhEvents(g, 'rest').map(x => x.m + '@' + beat(x.at));
const onsets = g => g.parts[0].events.filter(e => e.kind === 'note').map(e => [mIndex(g).get(e.m), e.at, e.staff, e.voice, e.heads.map(h => h.pitch.step + h.pitch.oct).join('+')].join('|')).sort();
const errors = g => V.validate(g).issues.filter(i => /^E-/.test(i.code));
const fill = g => GAPS.fillRunRests(g);

test('the teacher\'s five rests: m2 @3.25 and @3.75, m4 @1.5, m34 @3.25, m37 @1.25 vanish, the note before each is an eighth, nothing else changes', () => {
  /* a run of 16ths over 40 bars with the five rests of the teacher's score at their places (positions in 16ths: @3.25 is 13, @3.75 is 15, @1.5 is 6, @1.25 is 5) */
  const holes = { 2: [13, 15], 4: [6], 34: [13], 37: [5] };
  const pats = Array.from({ length: 40 }, (_, i) => FULL.split('').map((c, k) => (holes[i + 1] || []).includes(k) ? 'r' : c).join(''));
  const g = build(pats);
  assert.deepEqual(restsAt(g), ['2@3.25', '2@3.75', '4@1.5', '34@3.25', '37@1.25']);
  const r = fill(g);
  assert.equal(r.changed, true);
  assert.deepEqual(r.stats, { fills: 5, notesLengthened: 5, restsRemoved: 5, skipped: 0 });
  assert.deepEqual(restsAt(r.graph), [], 'no left-hand rest is left');
  /* the note before each rest: an eighth now (written value and length), at its old onset */
  const lengthened = lhEvents(r.graph, 'note').filter(x => R.eq(x.dur, R.make(1, 8)));
  assert.deepEqual(lengthened.map(x => x.m + '@' + beat(x.at)), ['2@3', '2@3.5', '4@1.25', '34@3', '37@1'], 'the previous note of each rest, at its own onset');
  lengthened.forEach(x => { assert.equal(x.e.display.type, 'eighth'); assert.equal(x.e.display.dots, undefined); });
  /* every other note is as it was: a plain 16th */
  const ids = new Set(lengthened.map(x => x.e.id));
  const all = lhEvents(r.graph, 'note');
  assert.equal(all.length, 40 * 16 - 5);
  all.filter(x => !ids.has(x.e.id)).forEach(x => { assert.ok(R.eq(x.dur, R.make(1, 16)) && x.e.display.type === '16th'); });
  assert.deepEqual(onsets(r.graph), onsets(g), 'onsets and pitches never change');
  /* a lengthened note ends exactly where the next note of the hand starts: never later, never across the barline */
  const barLen = new Map(r.graph.timeline.measures.map(m => [m.id, R.parse(m.dur)]));
  all.forEach((x, i) => {
    assert.ok(R.le(R.add(x.at, x.dur), barLen.get(x.e.m)), 'a note stays inside its bar');
    const nxt = all[i + 1];
    if (nxt && nxt.m === x.m) assert.ok(R.le(R.add(x.at, x.dur), nxt.at), 'a note stops at the next onset');
  });
  assert.equal(errors(r.graph).length, 0, 'the graph validates');
  assert.ok(r.graph.provenance.sources.some(s => s.tool === 'ppp.run-rests'));
  /* the rest at m2 @3.75 ends the bar: bar 3's first note follows it and is untouched */
  assert.equal(all.find(x => x.m === 3 && beat(x.at) === 0).e.display.type, '16th');
  /* through tidyRests: the same five, the same graph shape */
  const t = GAPS.tidyRests(g);
  assert.equal(t.fill.fills, 5);
  assert.deepEqual(restsAt(t.graph), []);
});

test('the right hand is never touched: its rests are the melody\'s', () => {
  const g = mk({ rh: pat('nnnrnnnnnrnnnnnr'), lh: 'C3:w' });
  const r = fill(g);
  assert.equal(r.changed, false);
  assert.equal(r.graph, g);
  assert.equal(GAPS.tidyRests(g).fill.fills, 0);
  /* both hands in one bar: only the left hand's rest goes */
  const both = mk({ rh: pat('nnnrnnnnnrnnnnnr'), lh: pat('nnnnnnnnnnnrnnnn') });
  const b = fill(both);
  assert.equal(b.stats.fills, 1);
  const rhRests = x => x.parts[0].events.filter(e => e.kind === 'rest' && e.staff !== lhStaff(x)).length;
  assert.equal(rhRests(b.graph), 3);
  assert.equal(rhRests(b.graph), rhRests(both), 'the three right-hand rests are as they were');
  assert.deepEqual(restsAt(b.graph), []);
});

test('which staff is the left hand: limb LH; with no limb at all, the lower of two staves; nothing otherwise', () => {
  const g = mk({ rh: 'C5:w', lh: 'C3:w' });
  const part = g.parts[0];
  assert.deepEqual([...GAPS.leftHandStaves(part)], [part.staves[1].id]);
  assert.equal(part.staves[1].limb, 'LH');
  const noLimb = JSON.parse(JSON.stringify(part));
  noLimb.staves.forEach(s => { delete s.limb; });
  assert.deepEqual([...GAPS.leftHandStaves(noLimb)], [noLimb.staves[1].id], 'two staves without a limb: the lower one');
  const oneStaff = JSON.parse(JSON.stringify(part));
  oneStaff.staves = oneStaff.staves.slice(0, 1); delete oneStaff.staves[0].limb;
  assert.equal(GAPS.leftHandStaves(oneStaff).size, 0, 'one staff without a limb: none');
  const rhOnly = JSON.parse(JSON.stringify(part));
  rhOnly.staves.forEach(s => { s.limb = 'RH'; });
  assert.equal(GAPS.leftHandStaves(rhOnly).size, 0, 'limbs that name no left hand: none');
  /* a graph whose staves carry no limb fills in the lower staff just the same, and not in the upper */
  const bare = JSON.parse(JSON.stringify(mk({ rh: pat('nnnrnnnnnnnnnnnn'), lh: pat('nnnnrnnnnnnnnnnn') })));
  bare.parts[0].staves.forEach(s => { delete s.limb; });
  const r = fill(bare);
  assert.equal(r.stats.fills, 1);
  assert.equal(r.graph.parts[0].events.filter(e => e.kind === 'rest').length, 1, 'the right hand\'s rest stays');
  assert.equal(r.graph.parts[0].events.find(e => e.kind === 'rest').staff, bare.parts[0].staves[0].id);
});

test('not touched: a rest of another length (dotted 16th, eighth, 32nd), a note before it that is not a plain 16th, a rest with no note before it, two rests in a row', () => {
  const cases = {
    'a dotted 16th rest': bar('n', 'n', 'n', 'n', 'n', 'n', 'n', 'n', 'n', 'n', 'n', 'n', 'n', 'r:16.', 'D3:32'),
    'an eighth rest': bar('n', 'n', 'n', 'n', 'n', 'n', 'n', 'n', 'n', 'n', 'n', 'n', 'n', 'r:8'),
    'a 32nd rest': bar('n', 'n', 'n', 'n', 'n', 'n', 'n', 'n', 'n', 'n', 'n', 'n', 'n', 'D3:32', 'r:32', 'r:32', 'D3:32'),
    'an eighth note before the rest': bar('n', 'n', 'n', 'n', 'n', 'n', 'n', 'n', 'n', 'n', 'n', 'n', 'E3:8', 'r'),
    'a dotted 16th note before the rest': bar('n', 'n', 'n', 'n', 'n', 'n', 'n', 'n', 'n', 'n', 'n', 'n', 'E3:16.', 'r', 'D3:32'),
    'a 32nd note before the rest': bar('n', 'n', 'n', 'n', 'n', 'n', 'n', 'n', 'n', 'n', 'n', 'n', 'C3:32', 'D3:32', 'r', 'n', 'n'),
    'no note before the rest (the start of a bar)': bar('r', 'n', 'n', 'n', 'n', 'n', 'n', 'n', 'n', 'n', 'n', 'n', 'n', 'n', 'n', 'n'),
    'two rests in a row': bar('n', 'n', 'n', 'n', 'n', 'n', 'n', 'n', 'n', 'n', 'n', 'n', 'n', 'r', 'r', 'n')
  };
  Object.keys(cases).forEach(name => {
    let g;
    try { g = one(cases[name]); } catch (e) { assert.fail(name + ': ' + e.message); }
    const r = fill(g);
    assert.equal(r.changed, false, name);
    assert.equal(r.graph, g, name);
  });
});

test('not touched: a note before the rest that is tied, a chord, in a tuplet, a grace note, or in another voice', () => {
  const head = 'C3:16 E3:16 G3:16 E3:16 C3:16 E3:16 G3:16 E3:16 C3:16 E3:16 G3:16 E3:16 ';
  /* control: the same bar untied is filled */
  assert.equal(fill(one(head + 'D3:16 r:16 E3:16 F3:16')).changed, true, 'control');
  /* tied from the note before (a tie into it) */
  assert.equal(fill(one(head + 'D3:16~ D3:16 r:16 E3:16')).changed, false, 'a tie into the note before the rest');
  assert.equal(fill(one(head + 'C3+G3:16 r:16 E3:16 F3:16')).changed, false, 'a chord');
  /* a tuplet: three 16ths in the time of two (2/3 of a 16th each), the rest is one of them */
  assert.equal(fill(one('C3:16 E3:16 G3:16 E3:16 C3:16 E3:16 G3:16 E3:16 C3:8 3s[ D3:16 E3:16 r:16] F3:16 G3:16 A3:16 B3:16')).changed, false, 'a note or a rest inside a tuplet');
  /* a grace note at the start of the next bar is not the note after the rest */
  const grace = mk({ rh: 'C5:w | C5:w', lh: pat('nnnnnnnnnnnnnnnr') + ' | r:w', graces: [{ staff: 1, bar: 1, at: '0', pitch: 'A2', type: 'eighth' }] });
  assert.equal(fill(grace).changed, false, 'the next bar holds only a grace note');
  /* another voice: the note before the rest is voice 5, the rest voice 6 */
  const v2 = mk({ rh: 'C5:w', lh: head + 'D3:16 r:16 E3:16 F3:16', lh2: 'r:w' });
  assert.equal(fill(v2).changed, true, 'control: the voice-5 pair is filled and the whole-bar rest of voice 6 is left');
  assert.equal(lhEvents(fill(v2).graph, 'rest').length, 1);
  const v3 = mk({ rh: 'C5:w', lh: 'r:w', lh2: head + 'D3:16 r:16 E3:16 F3:16' });
  /* the same notes in the second voice are filled too (a voice of its own: a note and a rest of voice 6) */
  assert.equal(fill(v3).changed, true);
});

test('not touched: the end of the hand\'s last bar, a bar end with no note of the voice in the next bar, a span another voice starts a note in', () => {
  /* the last bar of the hand: a rest with no note after it keeps its rest */
  const last = build([FULL, 'nnnnnnnnnnnnnnnr']);
  assert.equal(fill(last).changed, false, 'no note after it');
  /* the next bar starts with a rest, then notes */
  const gap = build(['nnnnnnnnnnnnnnnr', 'rnnnnnnnnnnnnnnn']);
  assert.equal(fill(gap).changed, false, 'the next bar\'s first position is a rest, not a note');
  /* control: the same two bars with a note at the start of bar 2 are filled, the note before the barline ends on it */
  const ok = build(['nnnnnnnnnnnnnnnr', FULL]);
  const o = fill(ok);
  assert.equal(o.changed, true);
  assert.deepEqual(restsAt(o.graph), []);
  const before = lhEvents(o.graph, 'note').find(x => x.m === 1 && beat(x.at) === 3.5);
  assert.ok(R.eq(before.dur, R.make(1, 8)));
  assert.ok(R.eq(R.add(before.at, before.dur), R.parse(o.graph.timeline.measures[0].dur)), 'it ends on the barline, not past it');
  /* another voice of the staff starts a note inside the rest's span: the lengthened note would ring past the hand's next onset */
  const head = 'C3:16 E3:16 G3:16 E3:16 C3:16 E3:16 G3:16 E3:16 C3:16 E3:16 G3:16 E3:16 ';
  const clash = mk({ rh: 'C5:w', lh: head + 'D3:16 r:16 E3:16 F3:16', lh2: 'r:q r:q r:q r:16 B1:16 r:8' });
  assert.equal(fill(clash).changed, false, 'a note of the other voice starts inside the span');
  const calm = mk({ rh: 'C5:w', lh: head + 'D3:16 r:16 E3:16 F3:16', lh2: 'r:q r:q r:q r:16 r:16 r:8' });
  const c = fill(calm);
  assert.equal(c.changed, true, 'control: a rest of the other voice does not stop it');
  assert.equal(errors(c.graph).length, 0);
});

test('idempotent, a fixed point with closeSmallGaps and mergeRests, composes with them; never a throw; a clean graph is returned as it is', () => {
  let s = 11;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  let filled = 0;
  for (let it = 0; it < 120; it++) {
    const pats = Array.from({ length: 3 }, () => Array.from({ length: 16 }, () => rnd() < 0.15 ? 'r' : 'n').join(''));
    const g = build(pats);
    const a = fill(g);
    assert.equal(fill(a.graph).graph, a.graph, 'idempotent: ' + pats);
    assert.equal(errors(a.graph).length, 0, 'valid: ' + pats);
    assert.deepEqual(onsets(a.graph), onsets(g));
    assert.equal(restsAt(a.graph).length + a.stats.fills, restsAt(g).length, 'every fill removes exactly one rest: ' + pats);
    filled += a.stats.fills;
    const t = GAPS.tidyRests(g);
    assert.equal(GAPS.tidyRests(t.graph).graph, t.graph, 'tidyRests is a fixed point: ' + pats);
    assert.equal(GAPS.closeSmallGaps(t.graph).graph, t.graph);
    assert.equal(GAPS.mergeRests(t.graph).graph, t.graph);
    assert.equal(fill(t.graph).graph, t.graph);
    assert.equal(errors(t.graph).length, 0);
    assert.deepEqual(onsets(t.graph), onsets(g), 'no onset or pitch changes through the three passes');
  }
  assert.ok(filled > 50, 'the fuzz fills: ' + filled);
  const bad = Object.freeze({ not: 'a graph' });
  const f = fill(bad);
  assert.equal(f.graph, bad);
  assert.equal(f.changed, false);
  assert.ok(f.stats.failed);
  const clean = build([FULL, FULL]);
  assert.equal(fill(clean).graph, clean);
});

test('composing with mergeRests and closeSmallGaps: rests that join are not lone; a gap shorter than a 16th is closed first', () => {
  /* a 16th rest and a dotted 16th rest side by side are not a lone rest: mergeRests writes them (the pass leaves them) */
  const head = 'C3:16 E3:16 G3:16 E3:16 C3:16 E3:16 G3:16 E3:16 C3:16 E3:16 G3:16 E3:16 ';
  const two = one(head + 'D3:16 r:16 r:16 E3:16');
  assert.equal(fill(two).changed, false);
  assert.equal(GAPS.tidyRests(two).fill.fills, 0);
  /* a note a 64th short of its slot leaves a gap of 1/64 closeSmallGaps closes; a lone 16th rest elsewhere in the same bar is filled by the same tidy */
  const g = one('C3:16 E3:16 G3:16 E3:16 C3:16 E3:16 G3:16 E3:16 C3:16=3/64 r:64 E3:16 G3:16 E3:16 C3:16 r:16 E3:16 F3:16', {});
  const t = GAPS.tidyRests(g);
  assert.equal(t.fill.fills, 1, 'the lone 16th rest');
  assert.equal(restsAt(t.graph).length, 0);
  assert.deepEqual(onsets(t.graph), onsets(g));
  assert.equal(errors(t.graph).length, 0);
});

test('recordings: a left-hand 16th run with dropped notes is clean after audio-score (closeGaps), unchanged without it, untouched for a MIDI source; the right hand\'s rests stay; the graph is valid', () => {
  /* a seeded recording: the right hand a slow melody, the left hand an arpeggio of 16ths with about one note in eight not heard */
  let s = 3;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const heard = [];
  for (let b = 0; b < 12; b++) {
    const t0 = b * 2;
    heard.push({ on: t0 + 0.25, off: t0 + 1.9, midi: 76 + (b % 3), vel: 80 });
    for (let k = 0; k < 16; k++) {
      if (rnd() < 0.12 && k > 0 && k < 15) continue;
      heard.push({ on: t0 + k * 0.125, off: t0 + k * 0.125 + 0.118, midi: [48, 52, 55, 52][k % 4], vel: 60 });
    }
  }
  const LOCK = { bpm: 120, beatsPerBar: 4, beatType: 4, firstDownbeat: 0 };
  const make = o => A.toMusicXml({ notes: heard, pedals: [], title: 'lh-run' }, Object.assign({ title: 'lh-run', lock: LOCK }, o));
  const plain = make({}), closed = make({ closeGaps: true });
  const lone = g => g.parts[0].events.filter(e => e.kind === 'rest' && e.staff === lhStaff(g) && e.display && e.display.type === '16th' && !e.display.dots).length;
  assert.ok(lone(plain.graph) > 3, 'the control has lone 16th rests in the left hand: ' + lone(plain.graph));
  assert.equal(lone(closed.graph), 0, 'none is left in the recording\'s graph');
  assert.ok(closed.graph.provenance.sources.some(x => x.tool === 'ppp.run-rests'));
  assert.equal(errors(closed.graph).length, 0, 'the graph validates');
  assert.equal(GAPS.tidyRests(closed.graph).graph, closed.graph, 'a fixed point');
  assert.equal(GAPS.restRuns(closed.graph, { skipped: 0 }).length, 0);
  /* without the fill: the same graph the previous passes make */
  const before = GAPS.mergeRests(GAPS.closeSmallGaps(plain.graph).graph).graph;
  assert.deepEqual(onsets(closed.graph), onsets(before), 'onsets and pitches are those of the graph without the fill');
  const rh = g => g.parts[0].events.filter(e => e.kind === 'rest' && e.staff !== lhStaff(g)).length;
  assert.equal(rh(closed.graph), rh(before), 'the right hand\'s rests are untouched');
  /* the library default (closeGaps unset) writes the plain build; a MIDI file is the player's own */
  const def = A.toMusicXml({ notes: heard, pedals: [], title: 'lh-run' }, { title: 'lh-run', lock: LOCK });
  assert.equal(def.xml, plain.xml);
  assert.ok(!def.graph.provenance.sources.some(x => x.tool === 'ppp.run-rests'));
  const midi = make({ closeGaps: true, sourceKind: 'midi-file' });
  assert.equal(midi.xml, plain.xml, 'a MIDI source is not tidied');
  assert.ok(!midi.graph.provenance.sources.some(x => x.tool === 'ppp.run-rests'));
});

test('the gate in the one-note pipeline: a printed score is not tidied, a transcription is (and stays a fixed point)', async () => {
  const CAND = require(path.join(REPO, 'candidates/index.js'));
  const SGG = require(path.join(REPO, 'songgraph/index.js'));
  const H = require(path.join(REPO, 'tests/engrave/helpers.js'));
  const g = await H.graphOf('tests/fixtures/g9f-small-gaps.musicxml');
  const asRecording = JSON.parse(JSON.stringify(g));
  asRecording.provenance.sources.forEach(x => { x.kind = 'audio-score'; });
  const request = { targetLevel: 2, handProfile: 'large', sections: 'all' };
  const run = (graph, o) => {
    const sg = SGG.analyze(graph);
    let sel = CAND.run(graph, sg, request, { singleNoteHands: true });
    if (!sel.ok) sel = CAND.run(graph, sg, request, { singleNoteHands: true, relax: 2 });
    assert.ok(sel.ok);
    return REP.repairSelection(sel, graph, sg, request, o);
  };
  const printed = run(g, undefined);
  assert.equal(printed.graph.provenance.sources.some(x => x.tool === 'ppp.run-rests'), false, 'a printed score: the pass is not run');
  const auto = run(asRecording, undefined);
  assert.ok(auto.report.mergedRests, 'a transcription: tidied');
  assert.equal(GAPS.tidyRests(auto.graph).graph, auto.graph, 'the arrangement of a transcription is a fixed point');
  assert.equal(run(asRecording, { closeGaps: false }).graph.provenance.sources.some(x => x.tool === 'ppp.run-rests'), false);
});
