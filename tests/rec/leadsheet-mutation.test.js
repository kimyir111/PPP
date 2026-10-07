/* Mutation check of rec/leadsheet.js (G10c-1a, docs/GOALS/G10_AUDIO_TO_SCORE.md section 33.7). Each planted defect is made in a copy of the module (outside the repository, its
   relative requires pointed at this tree) and must make one of the checks below fail on the synthetic covers of leadsheet-fixtures.js; the copy without a defect must pass them all.
   The benchmark's rec-arrange suites see the melody, harmony and notation of the lead sheet on the catalogue; these defects are the ones a synthetic cover shows at once.
   node --test tests/rec/leadsheet-mutation.test.js */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { REPO } = require('./helpers.js');
const SGG = require(path.join(REPO, 'songgraph', 'index.js'));
const HARM = require(path.join(REPO, 'songgraph', 'harmony.js'));
const NC = require(path.join(REPO, 'scoregraph', 'tools', 'notation-check.js'));
const P = require(path.join(REPO, 'scoregraph', 'pitch.js'));
const { cover, tune, headsOf, convert, f1, heldTune } = require('./leadsheet-fixtures.js');

const SRC = fs.readFileSync(path.join(REPO, 'rec', 'leadsheet.js'), 'utf8').replace(/\r\n/g, '\n');

/* a copy of rec/leadsheet.js with one edit (found exactly once), its requires made absolute */
function load(mutation) {
  let src = SRC;
  if (mutation) {
    const n = src.split(mutation.find).length - 1;
    if (n !== 1) throw new Error(mutation.id + ': anchor found ' + n + ' times: ' + mutation.find);
    src = src.replace(mutation.find, mutation.replace);
  }
  src = src.replace(/require\('\.\.\//g, "require('" + REPO.replace(/\\/g, '/') + '/').replace(/require\('\.\//g, "require('" + REPO.replace(/\\/g, '/') + "/rec/");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ppp-leadsheet-mut-'));
  const file = path.join(dir, 'leadsheet.js');
  fs.writeFileSync(file, src);
  try { return { LS: require(file), dir: dir }; } catch (e) { fs.rmSync(dir, { recursive: true, force: true }); throw e; }
}

/* the cases: [{name, ok}] */
function checks(LS) {
  const out = [];
  const add = (name, ok) => out.push({ name: name, ok: !!ok });
  const g = convert(cover(16, tune));
  const c = cover(16, tune);
  const gc = convert(c);
  const r = LS.prepare(gc, { songgraph: SGG });
  add('prepares', r.ok);
  if (!r.ok) return out;
  add('the top line is the tune', f1(r.melody.map(n => n.head), headsOf(gc, c.melody)).f1 >= 0.97);
  /* a stray high note between two tune notes is not melody */
  const cs = cover(16, tune);
  for (let b = 1; b < 16; b += 3) {
    const t = cs.melody.find(n => Math.abs(n.on - (1 + (b * 4 + 1) * 0.6)) < 0.05);
    if (t) cs.notes.push({ on: Math.round((t.on + 0.3) * 1000) / 1000, off: Math.round((t.on + 0.5) * 1000) / 1000, midi: t.midi + 19, vel: 60 });
  }
  cs.notes.sort((a, d) => a.on - d.on || a.midi - d.midi);
  const gs = convert(cs), rs = LS.prepare(gs, { songgraph: SGG });
  const ss = f1(rs.melody.map(n => n.head), headsOf(gs, cs.melody));
  add('a stray note above the tune is left out', ss.p >= 0.95 && ss.r >= 0.95);
  /* the tune in the lower staff in bars 5-10: the same line */
  const bad = JSON.parse(JSON.stringify(gc));
  const part = bad.parts[0];
  const rhStaff = part.staves[0].id, lhStaff = part.staves[1].id, lhVoice = part.voices.find(v => v.staff === lhStaff).id, rhVoice = part.voices.find(v => v.staff === rhStaff).id;
  const bars = new Set(bad.timeline.measures.slice(4, 10).map(m => m.id));
  part.events.forEach(e => { if (e.voice === rhVoice && bars.has(e.m)) { e.staff = lhStaff; e.voice = lhVoice; } });
  const rb = LS.prepare(bad, { songgraph: SGG });
  add('the staff is not read', rb.ok && JSON.stringify(rb.melody.map(n => [n.head, n.midi])) === JSON.stringify(r.melody.map(n => [n.head, n.midi])));
  /* a tune two octaves too high comes into C4..C6 */
  const gh = convert(cover(16, (b, k) => tune(b, k) + 24, { chord: false }));
  const rh = LS.prepare(gh, { songgraph: SGG });
  const w = rh.ok ? rh.graph.parts[0].events.filter(e => e.kind === 'note').map(e => P.midi(e.heads[0].pitch)) : [];
  add('octaves come into C4..C6', w.length > 20 && Math.max(...w) <= 84 && Math.min(...w) >= 60);
  /* the harmony is G7a over all notes */
  const want = HARM.harmonyOf(gc);
  add('the harmony is that of every heard note', r.sg.harmony.length === want.length && r.sg.harmony.every((x, i) => x.m === want[i].m && x.root === want[i].root && x.quality === want[i].quality));
  /* the lead sheet is a clean graph of the recording's bars, keys and provenance */
  add('the checker finds nothing', NC.checkGraph(r.graph).total === 0);
  add('bars and keys are the recording\'s', JSON.stringify(r.graph.timeline.measures.map(m => [m.id, m.dur])) === JSON.stringify(gc.timeline.measures.map(m => [m.id, m.dur])) &&
    JSON.stringify(r.graph.timeline.keys.map(k => [k.m, k.fifths, k.mode])) === JSON.stringify(gc.timeline.keys.map(k => [k.m, k.fifths, k.mode])));
  add('it is still a transcription', LS.isRecording(r.graph));
  /* a staccato tune (a third of a beat each) is written legato: no rest between the notes of a phrase */
  const gst = convert(cover(16, tune, { melodyLen: 0.4 })), rst = LS.prepare(gst, { songgraph: SGG });
  add('a silence shorter than a quarter is not a rest', rst.ok && rst.graph.parts[0].events.filter(e => e.kind === 'rest').length <= 2);
  /* a cover in D major: the key signature is the recording's */
  const gk = convert(cover(16, tune, { shift: 2 })), rk = LS.prepare(gk, { songgraph: SGG });
  add('the key signatures are those of the recording', rk.ok && gk.timeline.keys[0].fifths !== 0 && JSON.stringify(rk.graph.timeline.keys.map(k => [k.m, k.fifths, k.mode])) === JSON.stringify(gk.timeline.keys.map(k => [k.m, k.fifths, k.mode])));
  add('one note at a time', r.graph.parts[0].events.filter(e => e.kind === 'note').every(e => e.heads.length === 1));
  /* a tune note held across a barline is tied over it: no rest where the tune still sounds (review of #182) */
  const gh2 = convert(heldTune()), rh2 = LS.prepare(gh2, { songgraph: SGG });
  add('a held tune note is tied over the barline, no rest where it sounds', rh2.ok && rh2.graph.parts[0].events.every(e => e.kind !== 'rest') && (rh2.graph.parts[0].spanners || []).some(sp => sp.type === 'tie'));
  void g;
  return out;
}

const MUTATIONS = [
  { id: 'LOWEST-NOTE', why: 'the candidates of an instant are its lowest notes, not its highest', find: 'b.midi - a.midi || b.vel - a.vel || a.i - b.i', replace: 'a.midi - b.midi || b.vel - a.vel || a.i - b.i' },
  { id: 'NO-SKIP-COST', why: 'leaving out the highest note of an instant is free: a stray figure enters the line', find: 'put({ cost: s.cost + (it.topIsNew ? params.skip : 0), last: s.last, node: s.node });', replace: 'put({ cost: s.cost, last: s.last, node: s.node });' },
  { id: 'NO-OCTAVE-PASS', why: 'the octave pass moves nothing', find: "if (!params.octave || !melody.length) return shifts;", replace: 'return shifts;' },
  { id: 'HARMONY-OF-THE-LINE', why: 'the arranger is given the harmony the melody line alone gives', find: 'const harmony = harmonyOf(g);', replace: 'const harmony = analyzer.analyze(L).harmony;' },
  { id: 'UPPER-STAFF-ONLY', why: 'only the notes of the upper staff are candidates (the hand split is read)', find: 'if (!h.pitch || tieTo.has(h.id)) continue;', replace: 'if (!h.pitch || tieTo.has(h.id) || staffIx.get(e.staff) === 1) continue;' },
  { id: 'NO-LEGATO', why: 'every silence between two melody notes is a rest, however short', find: 'restMin: info.compound ? 36 : params.restMin', replace: 'restMin: 0' },
  { id: 'NO-BAR-TIES', why: 'the writer cuts a note at the barline (allowBarTies false): a rest is written where the tune still sounds', find: 'params.restMin, allowBarTies: true });', replace: 'params.restMin, allowBarTies: false });' },
  { id: 'KEYS-LOST', why: 'the recording\'s key signatures are not written to the lead sheet', find: 'g.timeline.keys.forEach(x => b.key(JSON.parse(JSON.stringify(x))));', replace: "b.key({ m: g.timeline.measures[0].id, at: '0', fifths: 0, mode: 'major' });" },
  { id: 'PROVENANCE-DROPPED', why: 'the lead sheet is no longer marked as a transcription', find: "if (!s || s.kind !== 'audio-score') return;", replace: 'return;' },
  { id: 'TWO-NOTES', why: 'the melody voice holds the two highest notes of an instant', find: 'if (p.kind === \'note\') ev.heads = [{ pitch: p.notes[0].pitch }];', replace: "if (p.kind === 'note') ev.heads = [{ pitch: p.notes[0].pitch }, { pitch: { step: p.notes[0].pitch.step, alter: p.notes[0].pitch.alter, oct: p.notes[0].pitch.oct - 1 } }];" }
];

test('the copy of rec/leadsheet.js without a defect passes every check', () => {
  const { LS, dir } = load(null);
  try { checks(LS).forEach(x => assert.ok(x.ok, x.name)); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

MUTATIONS.forEach(m => test('planted defect ' + m.id + ' (' + m.why + ') is caught', () => {
  const { LS, dir } = load(m);
  try {
    let failed;
    try { failed = checks(LS).filter(x => !x.ok); } catch (e) { failed = [{ name: 'threw: ' + String(e && e.message).slice(0, 80) }]; }
    assert.ok(failed.length > 0, m.id + ' was not caught: every check still passes');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}));
