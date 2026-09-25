/* MX-1: what the app plays, taken from the app itself (docs/CURRENT_STATE.md issue 3; decision D-1).

   ScoreGraph pitch and MusicXML <pitch> are the pitch that sounds. An 8va, 8vb or 15ma moves only what is printed:
   written = sounding - shift. Score.finalize, which every Score the app holds goes through, must therefore leave what
   sounds alone - the player, practice judging, follow, the falling notes and the keyboard all read it - and print the
   note under the line an octave (or two) from it. And a printed pedal change lifts the damper and presses it again.

   Score.finalize and PianoScore are read out of Piano Coach App.dc.html, with the few constants they use, the way
   tests/engrave/helpers.js appFinalize reads finalize: these are the app's own functions, not copies. The same checks
   in the running page (both import doors, the renderer, the scheduler, follow) are tests/scoregraph/tools/ottava-check.js,
   tests/playback-scheduler.test.js and tests/follow.test.js. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { REPO, SG, FIX, xml, importXml } = require('./helpers.js');
const { ottavaFiles, holdouts } = require('./tools/ottava-audit.js');

const R = SG.rational, P = SG.pitch, L = SG.legacy;

/* ---------------------------------------------------------------- the app's own code */
function appCode() {
  const html = fs.readFileSync(path.join(REPO, 'Piano Coach App.dc.html'), 'utf8').replace(/\r\n/g, '\n');
  const decl = name => {
    const i = html.indexOf('\nconst ' + name + ' = ');
    if (i < 0) throw new Error('const ' + name + ' is not in the app');
    const line = html.slice(i + 1, html.indexOf('\n', i + 1));
    if (/;\s*$/.test(line)) return line + '\n';
    const z = html.indexOf('\n};\n', i);
    return html.slice(i + 1, z + 4);
  };
  const fn = name => {
    const i = html.indexOf('\nfunction ' + name + '(');
    if (i < 0) throw new Error('function ' + name + ' is not in the app');
    return html.slice(i + 1, html.indexOf('\n}\n', i) + 3);
  };
  const body = decl('PIANO') + decl('DYN_VEL') + decl('PEDAL_CC') + fn('firstAtOrAfter') + decl('STEP_SEMI') + decl('PITCH_RE') +
    fn('pitchToMidi') + fn('shiftPitchOctave') + fn('ottavaSemitones') + decl('PianoScore') + decl('Score') +
    'return { Score: Score, PianoScore: PianoScore, pitchToMidi: pitchToMidi, ottavaSemitones: ottavaSemitones };';
  return new Function(body)();
}
const APP = appCode();
const clone = x => JSON.parse(JSON.stringify(x));
/* the Score a person's import leaves in the app: the graph's projection, finalized (App scoreFromXml) */
const held = g => APP.Score.finalize(L.toScore(g, { name: 'mx1', id: 'mx1' }));
const graphOfFile = async rel => {
  const r = await SG.importFile(new Uint8Array(fs.readFileSync(path.join(REPO, rel))), { name: path.basename(rel), scoreId: 'mx1' });
  assert.ok(r.ok, rel + ' opens');
  return r.graph;
};
const pitchName = p => p.step + (p.alter > 0 ? '#'.repeat(p.alter) : p.alter < 0 ? 'b'.repeat(-p.alter) : '') + p.oct;

/* What the graph says about each head, read from the graph alone: the pitch that sounds, the line over it (the part the
   app plays; a line that names no staff covers every staff of that part, as the G4 plan reads it) and the pitch printed
   under it (written, less the shift). */
function graphTruth(g) {
  const c = SG.time.ctx(g);
  const start = (m, at) => R.add(c.starts[c.index.get(m)], R.parse(at));
  let pi = g.parts.findIndex(p => p.staves.length >= 2);
  if (pi < 0) pi = g.parts.length - 1;
  const lines = g.parts[pi].spanners.filter(s => s.type === 'ottava' && s.from && s.to).map(s => {
    const assumed = !s.staff || !!(s.ext && s.ext['musicxml.ottava'] && s.ext['musicxml.ottava'].staff === 'assumed');
    return { covers: assumed ? g.parts[pi].staves.map(x => x.id) : [s.staff], a: start(s.from.m, s.from.at), z: start(s.to.m, s.to.at), shift: s.shift };
  });
  const heads = new Map();
  g.parts.forEach((part, k) => {
    const tr = part.instrument && part.instrument.transpose;
    part.events.forEach(e => (e.heads || []).forEach(h => {
      if (!h.pitch) return;
      const t = start(e.m, e.at), staff = h.staff || e.staff;
      let shift = 0, from = null;
      if (k === pi) lines.forEach(o => {
        if (o.covers.indexOf(staff) < 0 || R.lt(t, o.a) || !R.lt(t, o.z) || (from && R.lt(o.a, from))) return;
        shift = o.shift; from = o.a;
      });
      const w = tr && (tr.chromatic || tr.diatonic || tr.octave) ? P.written(h.pitch, tr) : h.pitch;
      heads.set(h.id, { sounding: P.midi(h.pitch), shift: shift, writtenMidi: P.midi(w) - 12 * shift,
        writtenP: pitchName(Object.assign({}, w, { oct: P.displayOctave(w, shift) })) });
    }));
  });
  return heads;
}

test('D-1: every committed file with an octave line - the app sounds the graph\'s pitch and prints it less the shift', async () => {
  const hold = holdouts();
  const files = ottavaFiles();
  assert.ok(files.length >= 34, files.length + ' files with an octave line (issue 3: 30 in the catalogue and samples)');
  const bad = [];
  let under = 0, notes = 0;
  for (const rel of files) {
    const name = hold.has(rel) ? 'a G0 hold-out file' : rel;
    const g = await graphOfFile(rel);
    const truth = graphTruth(g);
    const s = held(g);
    const plan = APP.PianoScore.of(s);
    const struck = new Map(plan.strikes.map(x => [x.note, x.midi]));
    s.notes.filter(n => !n.rest && n.p).forEach(n => {
      const t = truth.get(n.sgHead);
      if (!t) { bad.push(name + ': a note with no head'); return; }
      notes++;
      if (t.shift) under++;
      const got = [n.soundingMidi, n.midi, APP.pitchToMidi(n.p), n.ottavaShift, n.writtenMidi, n.writtenP];
      const want = [t.sounding, t.sounding, t.sounding, 12 * t.shift, t.writtenMidi, t.writtenP];
      if (JSON.stringify(got) !== JSON.stringify(want)) bad.push(name + ' m' + n.m + ' b' + n.b + ' staff ' + n.staff + ': ' + JSON.stringify(got) + ' vs ' + JSON.stringify(want));
      if (struck.has(n) && struck.get(n) !== t.sounding) bad.push(name + ' m' + n.m + ' b' + n.b + ': struck ' + struck.get(n) + ', sounds ' + t.sounding);
    });
  }
  assert.deepEqual(bad.slice(0, 5), []);
  /* issue 3's count: 2,229 notes in the catalogue and samples, plus the fixtures' and the hold-out's */
  assert.ok(under >= 2229, under + ' notes under a line');
  assert.ok(notes > under);
});

test('E18: 8va, 8vb and 15ma sound where the file says and are printed where the page shows them; an unnamed staff covers both', async () => {
  const g = await graphOfFile('tests/engrave/fixtures/e/E18-ottava.musicxml');
  const s = held(g);
  const row = n => [n.m, n.b, n.staff, n.p, n.soundingMidi, n.writtenP, n.ottavaShift].join(' ');
  assert.deepEqual(s.notes.filter(n => !n.rest).map(row), [
    '1 0 1 C6 84 C5 12', '1 0 2 C2 36 C3 -12', '1 1 1 E6 88 E5 12', '1 2 1 G6 91 G5 12', '1 2 2 G1 31 G2 -12',
    '2 0 1 C7 96 C5 24', '2 0 2 C3 48 C3 0', '2 2 1 E7 100 E5 24',
    '3 0 1 C6 84 C5 12', '3 0 2 C4 60 C3 12', '3 2 1 D6 86 D5 12', '3 2 2 D4 62 D3 12']);
  /* the lines as the renderer labels them: sounding minus written, so an 8va is +12 and drawn "8va" above the staff */
  assert.deepEqual(s.ottavas.map(o => [o.dir, o.semitones, APP.ottavaSemitones(o), o.staff]),
    [[1, 12, 12, 1], [-1, -12, -12, 2], [1, 24, 24, 1], [1, 12, 12, null]]);
  /* what the player strikes */
  assert.deepEqual(APP.PianoScore.of(s).strikes.map(x => x.midi), [36, 84, 88, 31, 91, 48, 96, 100, 60, 84, 62, 86]);

  /* a song saved and opened again goes through finalize a second time: nothing moves */
  const layers = x => x.notes.map(n => [n.p, n.midi, n.writtenP, n.writtenMidi, n.soundingMidi, n.ottavaShift].join(' '));
  assert.deepEqual(layers(APP.Score.finalize(clone(s))), layers(s));
  /* and a Score saved before MX-1 (p and midi moved, the line signed the other way) is read back as it was saved: what it
     draws and what it plays still go together, an octave from the file - importing the file again reads it anew */
  const old = clone(s);
  old.notes.forEach(n => {
    if (!n.ottavaShift) return;
    n.writtenP = n.p; n.writtenMidi = n.midi;
    n.ottavaShift = -n.ottavaShift; n.midi += n.ottavaShift; n.soundingMidi = n.midi;
    n.p = n.p.replace(/-?\d+$/, o => String(+o + n.ottavaShift / 12));
  });
  old.ottavas.forEach(o => { o.dir = -o.dir; o.semitones = -o.semitones; });
  const back = APP.Score.finalize(clone(old));
  assert.deepEqual(layers(back), layers(old));
  back.notes.forEach(n => assert.equal(n.soundingMidi, n.writtenMidi + n.ottavaShift));
});

test('the legacy fixture parse-ottava-8va-8vb: 8va up, 8vb down, the bar after untouched', async () => {
  const g = await graphOfFile('tests/scoregraph/fixtures/xml/ottava-8va-8vb.musicxml');
  const s = held(g);
  assert.deepEqual(s.notes.filter(n => !n.rest).map(n => n.p + '/' + n.writtenP + '/' + n.soundingMidi), [
    'C5/C4/72', 'C3/C4/48', 'E5/E4/76', 'G5/G4/79', 'G2/G3/43', 'C6/C5/84', 'C5/C5/72', 'C3/C3/48']);
});

test('a transposing part under an 8va: printed as the part reads it, less the shift; sounding at concert pitch (G2-D15)', () => {
  /* a B-flat clarinet: <pitch> is the part's own (unshifted) written pitch, D6 sounds C6, and the page prints D5 under 8va */
  const xml = '<?xml version="1.0"?><score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Clarinet in B-flat</part-name></score-part></part-list>' +
    '<part id="P1"><measure number="1"><attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time>' +
    '<clef><sign>G</sign><line>2</line></clef><transpose><diatonic>-1</diatonic><chromatic>-2</chromatic></transpose></attributes>' +
    '<direction placement="above"><direction-type><octave-shift type="down" size="8"/></direction-type></direction>' +
    '<note><pitch><step>D</step><octave>6</octave></pitch><duration>2</duration><voice>1</voice><type>half</type></note>' +
    '<note><pitch><step>E</step><octave>6</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type></note>' +
    '<direction><direction-type><octave-shift type="stop" size="8"/></direction-type></direction>' +
    '<note><pitch><step>E</step><octave>5</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type></note>' +
    '</measure></part></score-partwise>';
  const s = held(importXml(xml).graph);
  const row = n => [n.p, n.soundingMidi, n.writtenP, n.writtenMidi, n.ottavaShift].join(' ');
  assert.deepEqual(s.notes.map(row), ['C6 84 D5 74 12', 'D6 86 E5 76 12', 'D5 74 E5 76 0']);
  assert.deepEqual(APP.PianoScore.of(s).strikes.map(x => x.midi), [84, 86, 74]);
});

test('a song saved before MX-1: read back as it was saved, rebuilt exactly from its own graph (A48), and no longer taken for the file', async () => {
  /* the app's Score for ottava-8va-8vb.musicxml, finalized before MX-1 and kept in a song slot (captured from the page) */
  const saved = JSON.parse(fs.readFileSync(path.join(FIX, 'saved', 'stored-pre-mx1-ottava.score.json'), 'utf8')).score;
  const s = APP.Score.finalize(clone(saved));
  const layers = x => x.notes.map(n => [n.p, n.midi, n.writtenP, n.writtenMidi, n.soundingMidi, n.ottavaShift].join(' '));
  assert.deepEqual(layers(s), layers(saved), 'what it draws and what it plays are what they were');
  const A48 = require(path.join(REPO, 'tests', 'engrave', 'a48-compare.js'));
  const fr = L.fromScore(s);
  assert.ok(fr.ok);
  assert.deepEqual(A48.fieldsThatDiffer(L, s, APP.Score.finalize(L.toScore(fr.graph, { name: 'back', id: s.id }))), []);
  assert.ok(L.agree(s, fr.graph).ok);
  /* the file's graph sounds the 8va an octave above what that Score plays: not the same music, so a renderer drawing
     from the graph falls back to the Score's own projection for such a song (G4 SOURCE_DISAGREE); the Score the app
     makes from the file today is the file's */
  const g = importXml(xml('ottava-8va-8vb')).graph;
  assert.equal(L.agree(s, g).ok, false);
  assert.ok(L.agree(held(g), g).ok);
});

/* ---------------------------------------------------------------- the pedal */
const E17 = 'tests/engrave/fixtures/e/E17-pedal.musicxml';

test('E17: a printed pedal change lifts the damper and presses it again (spans, MIDI CC64, the sampler\'s releases)', async () => {
  const s = held(await graphOfFile(E17));
  const plan = APP.PianoScore.of(s);
  /* bar 1: down and up; bar 2: down, changed at beat 3 (q 6), up at the end of bar 3 */
  assert.deepEqual(plan.pedal, [[0, 2], [4, 6], [6, 12]]);
  /* MIDI out: off, then on, at the change - never the half pedal (64) it sent before (the release at the very end of the
     piece is past the last bar the player schedules, as before) */
  const dampers = plan.ccs.filter(e => e.cc === 64).map(e => e.q + ':' + e.value);
  assert.deepEqual(dampers, ['0:127', '2:0', '4:127', '6:0', '6:127']);
  /* the sampler: D5 (bar 2, key up at the change) stops there; the G2 held through it goes on under the new pedal */
  const upOf = (m, b, p) => plan.strikes.find(x => x.m === m && x.note.b === b && x.note.p === p).upQ;
  assert.equal(upOf(2, 0, 'D5'), 6, 'what only the pedal held is let go at the change');
  assert.equal(upOf(2, 0, 'G2'), 12, 'a key still down at the change is caught by the pedal pressed again');
  assert.equal(upOf(2, 2, 'F5'), 12, 'what is struck after the change is held to the end of the pedal');
  assert.equal(upOf(1, 0, 'C5'), 2, 'bar 1 is unchanged');

  /* a pedal depth a file gives as a number (<sound damper-pedal="64"/>) is a half pedal, not a change: no lift */
  const half = APP.PianoScore.of(APP.Score.finalize({
    id: 'mx1-half', title: 'half pedal', tempo: 60, staves: 1,
    measures: [{ number: 1, lenQ: 4, time: { beats: 4, beatType: 4 }, key: { fifths: 0, mode: 'major' }, clefs: { 1: 'treble' } }],
    notes: [{ m: 1, b: 0, dur: 1, p: 'C4', midi: 60, staff: 1, voice: 1, hand: 'r', type: 'quarter' },
      { m: 1, b: 2, dur: 1, p: 'E4', midi: 64, staff: 1, voice: 1, hand: 'r', type: 'quarter' }],
    pedals: [{ m: 1, b: 0, type: 'start', kind: 'damper' }, { m: 1, b: 2, type: 'change', kind: 'damper', value: 64 },
      { m: 1, b: 4, type: 'stop', kind: 'damper' }],
    sections: [{ id: 's1', from: 1, to: 1 }]
  }));
  assert.deepEqual(half.pedal, [[0, 4]]);
  assert.deepEqual(half.ccs.map(e => e.q + ':' + e.value), ['0:127', '2:64']);
  assert.equal(half.strikes[0].upQ, 4);
});

test('a change at the point the pedal goes down, or with no pedal down, starts it; a stop at a change still lifts', () => {
  const base = pedals => APP.PianoScore.of(APP.Score.finalize({
    id: 'mx1-ped', title: 'p', tempo: 60, staves: 1,
    measures: [{ number: 1, lenQ: 4, time: { beats: 4, beatType: 4 }, key: { fifths: 0, mode: 'major' }, clefs: { 1: 'treble' } }],
    notes: [{ m: 1, b: 0, dur: 1, p: 'C4', midi: 60, staff: 1, voice: 1, hand: 'r', type: 'quarter' }],
    pedals: pedals, sections: [{ id: 's1', from: 1, to: 1 }]
  }));
  const a = base([{ m: 1, b: 0, type: 'start' }, { m: 1, b: 0, type: 'change' }, { m: 1, b: 4, type: 'stop' }]);
  assert.deepEqual(a.pedal, [[0, 4]]);
  const b = base([{ m: 1, b: 1, type: 'change' }, { m: 1, b: 3, type: 'stop' }]);
  assert.deepEqual(b.pedal, [[1, 3]]);
  const c = base([{ m: 1, b: 0, type: 'start' }, { m: 1, b: 2, type: 'change' }, { m: 1, b: 2, type: 'stop' }]);
  assert.equal(APP.PianoScore.pedalUp(c, 1), 2);
  assert.equal(APP.PianoScore.pedalUp(c, 3), null, 'nothing holds a key let go after the pedal came up');
  assert.deepEqual(c.ccs.map(e => e.q + ':' + e.value), ['0:127', '2:0', '2:0']);
});
