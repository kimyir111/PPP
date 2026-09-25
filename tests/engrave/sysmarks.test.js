/* G4d-1b - the marks attached to systems (docs/GOALS/G04 §10.2 priorities 7-11, §10.4 S2 and S5, §10.5; A8-A10, A12 lyrics,
   A20, A25), vertical spacing (§15.3), courtesy signs (§15.4) and the G4d-1a review's R5 (bracketed accidentals). Node only.
   The metrics are tests/engrave/l2.js (shared with bench.js and the mutation test); here each rule is shown on the fixture made
   for it at both screen widths, and each new metric is shown to find the defect it names (negative controls on real layouts). */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { REPO, E, graphOf } = require('./helpers.js');
const { l2, MAXIMA, RECORDED } = require('./l2.js');

const L = E.layout;
const SM = require(path.join(REPO, 'engrave', 'sysmarks.js'));
const TX = require(path.join(REPO, 'engrave', 'metrics-text.js'));
const efile = k => 'tests/engrave/fixtures/e/' + fs.readdirSync(path.join(REPO, 'tests', 'engrave', 'fixtures', 'e')).find(f => f.startsWith(k + '-'));
async function lay(k, cfg) {
  const g = await graphOf(k.indexOf('/') >= 0 ? k : efile(k));
  const p = E.plan(g);
  const P = L.prepare(p);
  const e = L.layout(P, cfg || {});
  return { g, p, P, e, m: l2(e, p, { prepared: P, layout: L, graph: g }) };
}
const NOT_ZERO = Object.keys(MAXIMA).concat(RECORDED, ['eg.system.overflow']);
const zeroes = m => Object.keys(m).filter(k => NOT_ZERO.indexOf(k) < 0 && m[k]).map(k => k + '=' + m[k]);
const clone = x => JSON.parse(JSON.stringify(x.e));
const metric = (x, e, k) => l2(e, x.p, { graph: x.g })[k];
const CONFIGS = [{ breakpoint: 'desktop' }, { breakpoint: 'phone' }];
const kinds = (e, k) => e.objects.filter(o => o.kind === k);
const staffOf = (e, o) => e.systems[o.system].staves.find(s => s.key === o.staffKey);

test('A8, §10.2 priority 8, S2, S5: dynamics between a grand staff\'s staves on one line a system, hairpins level and clear of them, across a break', async () => {
  for (const cfg of CONFIGS) {
    const x = await lay('E16', cfg);
    assert.deepEqual(zeroes(x.m), [], cfg.breakpoint);
    const up = x.p.staves[0].id, lo = x.p.staves[1].id;
    /* every dynamic of the file is drawn; the ones the graph puts below the upper staff stand between the staves */
    const dyn = x.p.marks.filter(d => d.kind === 'dynamic');
    dyn.forEach(d => assert.ok(x.e.objects.some(o => o.kind === 'dynamic' && o.refs.indexOf(d.id) >= 0), d.id + ' drawn'));
    kinds(x.e, 'dynamic').filter(o => o.staffKey === up && o.side === 'below').forEach(o => {
      const a = x.e.systems[o.system].staves[0], b = x.e.systems[o.system].staves[1];
      assert.ok(o.box[1] >= a.y + a.h && o.box[3] <= b.y, o.id + ' between the staves');
    });
    /* mf above the upper staff, p below the lower one (the graph's placement and staff) */
    const mf = x.e.objects.find(o => o.kind === 'dynamic' && x.p.marks.find(d => d.id === o.refs[0]).value === 'mf');
    assert.ok(mf.side === 'above' && mf.box[3] <= staffOf(x.e, mf).y);
    assert.ok(x.e.objects.some(o => o.kind === 'dynamic' && o.staffKey === lo && o.side === 'below'));
    /* the diminuendo over five bars crosses a break: a part per system, the first opening from its wide end, the last closing */
    const dim = x.p.lines.find(l => l.kind === 'wedge' && l.wedge === 'diminuendo');
    const parts = kinds(x.e, 'hairpin').filter(o => o.refs[0] === dim.id).sort((a, b) => a.system - b.system);
    assert.ok(parts.length >= 2, 'in parts');
    assert.ok(parts[0].ends[0] > parts[0].ends[1] && parts[parts.length - 1].ends[1] === 0);
    parts.forEach(o => assert.equal(o.line[1], o.line[3], 'level'));
    /* p dolce: one dynamic, its letter a glyph and its word after it */
    const dolce = x.p.marks.find(d => d.kind === 'dynamic' && d.more.length);
    const ps = x.e.objects.filter(o => o.refs[0] === dolce.id).sort((a, b) => a.box[0] - b.box[0]);
    assert.deepEqual(ps.map(o => o.glyph || o.text), ['dynamicPiano', 'dolce']);
    /* cresc. by the dynamics, on their line */
    assert.ok(kinds(x.e, 'words').some(o => o.text === 'cresc.' && o.staffKey === up && o.side === 'below'));
  }
  /* sfz and ff a sixteenth apart: on the phone they would meet on one line - ff goes one line further out (§10.5) */
  const ph = await lay('E16', { breakpoint: 'phone' });
  const ff = ph.e.objects.filter(o => o.kind === 'dynamic' && ph.p.marks.find(d => d.id === o.refs[0]).value === 'ff');
  const sfz = ph.e.objects.filter(o => o.kind === 'dynamic' && ph.p.marks.find(d => d.id === o.refs[0]).value === 'sfz');
  assert.ok(ff[0].origin[1] > sfz[0].origin[1] + 1, 'ff a line under sfz');
});

test('A9, §10.2 priority 9: the pedal under the lower staff on one line a system; its sign or its line as the graph says; a change a change, never a release alone', async () => {
  for (const cfg of CONFIGS) {
    const e17 = await lay('E17', cfg);
    assert.deepEqual(zeroes(e17.m), [], 'E17 ' + cfg.breakpoint);
    /* E17: Ped. and *, the line with its hooks and its notch at the change, the recording shape (a line with no sign) */
    assert.deepEqual(kinds(e17.e, 'pedal').map(o => o.glyph).sort(), ['keyboardPedalPed', 'keyboardPedalUp']);
    assert.equal(kinds(e17.e, 'pedal-change').length, 1);
    /* E37 (E17 stays as MX-1's playback tests hold it): a sign pedal changed, a line pedal across a break */
    const x = await lay('E37', cfg);
    assert.deepEqual(zeroes(x.m), [], 'E37 ' + cfg.breakpoint);
    const lo = x.p.staves[1].id;
    x.e.objects.filter(o => /^pedal/.test(o.kind)).concat(e17.e.objects.filter(o => /^pedal/.test(o.kind))).forEach(o => assert.equal(o.staffKey, lo, o.id));
    x.e.objects.filter(o => /^pedal/.test(o.kind)).forEach(o => assert.ok(o.box[1] >= staffOf(x.e, o).y + 4, o.id + ' under the lower staff'));
    const peds = x.p.lines.filter(l => l.kind === 'pedal');
    /* the sign pedal changed: at its change the release and the press again */
    const signCh = peds.find(l => l.mark && l.mark.line === false && l.changes.length);
    const ch = x.e.objects.filter(o => o.refs.indexOf(signCh.id + '#change0') >= 0).sort((a, b) => a.box[0] - b.box[0]);
    assert.deepEqual(ch.map(o => o.glyph), ['keyboardPedalUp', 'keyboardPedalPed']);
    /* the line pedals: a notch at each change, hooks at their ends, a part in each system they cross */
    peds.filter(l => l.mark && l.mark.line).forEach(l => {
      l.changes.forEach((c, i) => assert.equal(x.e.objects.filter(o => o.kind === 'pedal-change' && o.refs.indexOf(l.id + '#change' + i) >= 0).length, 1));
      const lines = x.e.objects.filter(o => o.kind === 'pedal-line' && o.refs[0] === l.id);
      assert.ok(lines.some(o => o.hooks[0]) && lines.some(o => o.hooks[1]));
    });
    const long = peds[peds.length - 1];
    assert.ok(new Set(x.e.objects.filter(o => o.refs[0] === long.id).map(o => o.system)).size >= 2, 'the long line pedal crosses a break');
  }
});

test('A10, D-1: an octave line over exactly its notes, their heads at the written pitch; 8vb below, 15ma, an 8va naming no staff on both, "(8)" after a break', async () => {
  for (const cfg of CONFIGS) {
    /* E37: the 8va over bars 7-10 goes on after a break at both widths - "(8)" there, the line on to the system's end before */
    const x37 = await lay('E37', cfg);
    assert.deepEqual(zeroes(x37.m), [], 'E37 ' + cfg.breakpoint);
    assert.deepEqual(kinds(x37.e, 'ottava').map(o => o.text), ['8va', '(8)']);
    assert.ok(kinds(x37.e, 'ottava-line')[0].open && !kinds(x37.e, 'ottava-line')[1].open);
    const x = await lay('E18', cfg);
    assert.deepEqual(zeroes(x.m), [], cfg.breakpoint);
    const labels = kinds(x.e, 'ottava').map(o => o.text);
    ['8va', '8vb', '15ma'].forEach(t => assert.ok(labels.indexOf(t) >= 0, t));
    /* the 8va that names no staff moves both staves: a bracket over each */
    const assumed = x.p.lines.find(l => l.kind === 'ottava' && l.assumed);
    assert.equal(new Set(kinds(x.e, 'ottava').filter(o => o.refs[0] === assumed.id).map(o => o.staffKey)).size, 2);
    /* the heads under an 8va are written an octave below where they sound */
    const heads = new Map(x.p.events.flatMap(e => e.heads.map(h => [h.id, h])));
    const moved = [...heads.values()].filter(h => h.pitch && h.written && h.written.oct !== h.pitch.oct);
    assert.ok(moved.length >= 10 && moved.every(h => Math.abs(h.pitch.oct - h.written.oct) >= 1));
    const b8 = kinds(x.e, 'ottava').find(o => o.text === '8vb');
    assert.ok(b8.box[1] >= staffOf(x.e, b8).y + 4, '8vb below its staff');
  }
});

test('A8, §10.2 priority 10-11: voltas, a tempo with its metronome mark in parentheses, a framed rehearsal mark, segno, coda, D.S. al Coda, To Coda, Fine at its bar line', async () => {
  for (const cfg of CONFIGS) {
    const x = await lay('E22', cfg);
    assert.deepEqual(zeroes(x.m), [], cfg.breakpoint);
    const tp = x.e.objects.filter(o => o.refs[0] === x.p.tempos[0].id).sort((a, b) => a.box[0] - b.box[0]);
    assert.deepEqual(tp.filter(o => o.text !== undefined).map(o => o.text), ['Allegro', '(', '= 120)']);
    assert.ok(tp.some(o => o.glyph === 'noteheadBlack'));
    assert.ok(kinds(x.e, 'frame').length === 1 && kinds(x.e, 'rehearsal')[0].text === 'A');
    assert.deepEqual(kinds(x.e, 'jump').map(o => o.glyph || o.text).sort(), ['D.S. al Coda', 'To Coda', 'coda', 'segno']);
    /* Fine at the end of its measure: right-aligned to its bar line */
    /* the G4d-1b fixer (R1, G4-D1b-17): the words a file prints around a metronome mark on the mark's line, read as it prints them -
       each a words object naming its graph ID, one line with the tempo (one baseline), no empty "( )" */
    const line = t => x.e.objects.filter(o => o.group === t.id).sort((a, b) => a.box[0] - b.box[0])
      .map(o => (o.text !== undefined ? o.text : o.glyph === 'noteheadBlack' ? '♩' : null)).filter(Boolean).join(' ');
    assert.deepEqual(x.p.tempos.slice(1).map(line), ['Più mosso ( ♩ = 132 )', '(M.M. ♩ = 60 to 72.)']);
    x.p.tempos.forEach(t => assert.equal(new Set(x.e.objects.filter(o => o.group === t.id && o.text !== undefined).map(o => o.origin[1])).size, 1, t.id + ' one line'));
    x.p.marks.filter(d => d.kind === 'words' && d.text !== 'Fine').forEach(d => assert.ok(kinds(x.e, 'words').some(o => o.refs[0] === d.id && x.p.tempos.some(t => t.id === o.group)), d.text));
    const fine = kinds(x.e, 'words').find(o => o.text === 'Fine');
    const m = x.e.measures.find(y => y.id === fine.measure);
    assert.ok(Math.abs(fine.box[2] - (m.x + m.w)) < 0.02);
    kinds(x.e, 'volta').forEach(v => assert.ok(v.box[3] <= staffOf(x.e, v).y - 1));
  }
});

test('A12 lyrics: under their voice\'s staff, centred on their notes, one line a verse, a hyphen between the syllables of a word', async () => {
  for (const cfg of CONFIGS) {
    const x = await lay('E24', cfg);
    assert.deepEqual(zeroes(x.m), [], cfg.breakpoint);
    const ly = kinds(x.e, 'lyric');
    assert.equal(ly.length, 13);
    assert.deepEqual([...new Set(ly.map(o => o.verse))].sort(), [1, 2]);
    assert.equal(new Set(ly.filter(o => o.verse === 1).map(o => o.origin[1])).size, 1, 'one line for verse 1');
    assert.ok(kinds(x.e, 'lyric-line').length >= 2, 'hyphens');
    ly.forEach(o => assert.ok(o.box[1] >= staffOf(x.e, o).y + 4));
  }
  /* voice and piano: the lyrics under the voice's staff, its dynamic above it (a sung part), the piano's between its staves, a
     chord name over the voice */
  const x = await lay('E35');
  assert.deepEqual(zeroes(x.m), []);
  const voice = x.p.staves[0].id;
  kinds(x.e, 'lyric').forEach(o => assert.equal(o.staffKey, voice));
  const dv = kinds(x.e, 'dynamic').find(o => o.staffKey === voice);
  assert.ok(dv && dv.side === 'above');
  assert.ok(kinds(x.e, 'chord').every(o => o.staffKey === voice && o.side === 'above'));
});

test('§10.5 chord names: sans 1.4 sp at their notes, their widths in the spacing, pushed right in order where one stands where no note starts', async () => {
  for (const cfg of CONFIGS) {
    const x = await lay('E25', cfg);
    assert.deepEqual(zeroes(x.m), [], cfg.breakpoint);
    const chords = kinds(x.e, 'chord');
    chords.filter(o => o.text !== undefined).forEach(o => { assert.equal(o.font, 'sans'); assert.equal(o.size, 1.4); });
    /* sharps and flats as glyphs: F#m7b5, Bb7/D */
    assert.ok(chords.some(o => o.glyph === 'accidentalSharp') && chords.some(o => o.glyph === 'accidentalFlat'));
    const text = id => chords.filter(o => o.refs[0] === id).sort((a, b) => a.box[0] - b.box[0]).map(o => o.text || (o.glyph === 'accidentalSharp' ? '♯' : '♭')).join('');
    const names = x.p.marks.filter(d => d.kind === 'chord').map(d => text(d.id));
    assert.deepEqual(names.slice(4, 12), ['CM7', 'F♯m7♭5', 'B♭7/D', 'Em7', 'A7/C♯', 'Dm', 'Gsus4', 'C/E']);
    /* the last bar's second name stands where no note starts: pushed right of the first, 0.4 sp apart */
    const [a, b] = x.p.marks.filter(d => d.kind === 'chord').slice(12).map(d => chords.filter(o => o.refs[0] === d.id));
    const aEnd = Math.max(...a.map(o => o.box[2])), bStart = Math.min(...b.map(o => o.box[0]));
    assert.ok(Math.abs(bStart - aEnd - SM.PAD.apart) < 0.02);
  }
});

test('§15.3, A25: a grand staff 5.0 sp apart at least, one gap a system; systems 6.0 sp; §15.4 courtesy key, meter and clef at the end of the system before', async () => {
  for (const cfg of CONFIGS) for (const k of ['E19', 'E20', 'E21']) {
    const x = await lay(k, cfg);
    assert.deepEqual(zeroes(x.m), [], k + ' ' + cfg.breakpoint);
    assert.ok(x.e.systems.length >= 2, k + ' breaks');
    x.e.systems.forEach(s => assert.ok(s.staves[1].y - s.staves[0].y - 4 >= 5 - 0.01));
  }
  const e20 = (await lay('E20')).e;
  const last = e20.systems[0].measures[e20.systems[0].measures.length - 1];
  assert.deepEqual(e20.objects.filter(o => o.courtesy && o.kind === 'keysig' && o.measure === last && o.staffKey === e20.systems[0].staves[0].key).map(o => o.glyph),
    ['accidentalNatural', 'accidentalNatural', 'accidentalNatural', 'accidentalFlat']);
  const e19 = (await lay('E19')).e;
  const l19 = e19.systems[0].measures[e19.systems[0].measures.length - 1];
  assert.ok(e19.objects.some(o => o.kind === 'clef' && o.measure === l19 && o.scale < 1), 'a small clef before the last bar line');
});

test('the G4d-1a review R5: a bracketed flat on a line - its brackets taller than the flat, their ends off the staff lines', async () => {
  const x = await lay('E32');
  assert.deepEqual(zeroes(x.m), []);
  const br = x.e.objects.filter(o => /accidentalBracket/.test(o.glyph || ''));
  const flat = x.e.objects.find(o => o.glyph === 'accidentalFlat');
  assert.equal(br.length, 2);
  br.forEach(o => {
    assert.ok(o.box[1] < flat.box[1] - 0.1 && o.box[3] > flat.box[3] + 0.1, 'taller than the flat');
    const t0 = staffOf(x.e, o).y;
    [o.box[1], o.box[3]].forEach(y => { for (let k = 0; k <= 4; k++) assert.ok(Math.abs(y - (t0 + k)) >= 0.15 - 0.01, 'an end off line ' + k); });
  });
});

test('A20 in full, §18.3: every text of the marks attached to systems is as wide as the table says and meets nothing - on the fixtures and a real score', async () => {
  for (const k of ['E16', 'E17', 'E18', 'E22', 'E24', 'E25', 'E35', 'catalog/method/burgmuller25/015.mxl', 'catalog/method/sonatina/028.mxl']) {
    for (const cfg of CONFIGS) {
      const x = await lay(k, cfg);
      assert.deepEqual(zeroes(x.m), [], k + ' ' + cfg.breakpoint);
      x.e.objects.filter(o => o.text !== undefined).forEach(o => assert.ok(Math.abs((o.box[2] - o.box[0]) - TX.measure(o.text, o.font, o.size).w) <= 0.03, o.id));
    }
  }
});

/* ------------------------------------------------------------------ negative controls */
test('the G4d-1b metrics find the defects they name (negative controls on real layouts)', async () => {
  const x16 = await lay('E16'), x17 = await lay('E37'), x18 = await lay('E37', { breakpoint: 'phone' }), x22 = await lay('E22'), x24 = await lay('E24');
  const x25 = await lay('E25'), x35 = await lay('E35'), x20 = await lay('E20'), x32 = await lay('E32');
  [x16, x17, x18, x22, x24, x25, x35, x20, x32].forEach(x => assert.deepEqual(zeroes(x.m), []));
  const ok = (x, e, k, why) => assert.ok(metric(x, e, k) >= 1, k + ': ' + why);
  const move = (o, dx, dy) => { o.box = [o.box[0] + dx, o.box[1] + dy, o.box[2] + dx, o.box[3] + dy]; if (o.origin) o.origin = [o.origin[0] + dx, o.origin[1] + dy]; if (o.line) o.line = [o.line[0] + dx, o.line[1] + dy, o.line[2] + dx, o.line[3] + dy]; };
  let e;
  /* dynamics and hairpins */
  e = clone(x16); e.objects.filter(o => o.kind === 'dynamic' && o.side === 'below').slice(0, 1).forEach(o => move(o, 0, -8));
  ok(x16, e, 'eg.dynamic.side_err', 'a dynamic moved up into the upper staff');
  e = clone(x16); move(e.objects.find(o => o.kind === 'dynamic' && o.refs[0] === x16.p.marks[0].id), 0, 0.6);
  ok(x16, e, 'eg.row.baseline_err', 'one dynamic off its line');
  e = clone(x16); e.objects.find(o => o.kind === 'hairpin').line[3] += 0.4;
  ok(x16, e, 'eg.hairpin.level_err', 'a hairpin tilted');
  e = clone(x16); { const h = e.objects.find(o => o.kind === 'hairpin'); h.ends = h.ends.slice().reverse(); }
  ok(x16, e, 'eg.hairpin.shape_err', 'a crescendo drawn closing');
  e = clone(x16); { const h = e.objects.find(o => o.kind === 'hairpin' && o.id === o.refs[0]); h.box[0] -= 0.3; h.line[0] -= 0.3; }
  ok(x16, e, 'eg.hairpin.clear_err', 'a hairpin 0.2 sp from its dynamic');
  e = clone(x16); e.objects = e.objects.filter(o => o.kind !== 'hairpin' || o.refs[0] !== x16.p.lines.find(l => l.kind === 'wedge').id);
  ok(x16, e, 'eg.mark.missing.wedge', 'a hairpin not drawn');
  /* pedal */
  e = clone(x17); e.objects = e.objects.filter(o => !(o.glyph === 'keyboardPedalPed' && o.refs.length > 1));
  ok(x17, e, 'eg.mark.missing.pedal-change', 'a sign pedal\'s change drawn as its release alone');
  e = clone(x17); e.objects.filter(o => o.kind === 'pedal-change').forEach(o => move(o, 1.5, 0));
  ok(x17, e, 'eg.pedal.change_err', 'a notch away from its change');
  e = clone(x17); e.objects.filter(o => o.glyph === 'keyboardPedalUp' && o.refs.length === 1).forEach(o => move(o, 4, 0));
  ok(x17, e, 'eg.pedal.errors', 'a release after the note it lets go at');
  /* octave lines */
  e = clone(x18); { const l = e.objects.find(o => o.kind === 'ottava-line' && !o.open); l.line[2] -= 2; }
  ok(x18, e, 'eg.ottava.extent_err', 'a bracket short of its last note');
  e = clone(x18); e.objects.find(o => o.kind === 'ottava' && o.text === '(8)').text = '8va';
  ok(x18, e, 'eg.ottava.label_err', 'a line going on after a break labelled 8va');
  e = clone(x18); e.objects.filter(o => o.kind === 'notehead').slice(0, 1).forEach(o => move(o, 0, 3.5));
  ok(x18, e, 'eg.event.written_diff', 'a head seven steps from its written pitch');
  /* voltas, text, order */
  e = clone(x22); e.objects.find(o => o.kind === 'volta').box[2] += 3;
  ok(x22, e, 'eg.volta.extent_err', 'a volta past its bar');
  e = clone(x22); e.objects.find(o => o.kind === 'jump' && o.text).text = 'D.C.';
  ok(x22, e, 'eg.text.content_err', 'a jump\'s words not the graph\'s');
  e = clone(x22); e.objects = e.objects.filter(o => o.kind !== 'volta');
  ok(x22, e, 'eg.mark.missing.ending', 'voltas not drawn');
  e = clone(x25); e.objects.filter(o => o.kind === 'chord' && o.refs[0] === x25.p.marks.filter(d => d.kind === 'chord')[5].id).forEach(o => move(o, -1.5, 0));
  ok(x25, e, 'eg.chord.order_err', 'a chord name pushed left of its note');
  /* lyrics */
  e = clone(x35); e.objects.filter(o => o.kind === 'lyric').forEach(o => { o.staffKey = x35.p.staves[2].id; });
  ok(x35, e, 'eg.lyric.staff_err', 'lyrics said to stand under another staff');
  e = clone(x24); move(e.objects.find(o => o.kind === 'lyric'), 0.6, 0);
  ok(x24, e, 'eg.lyric.place_err', 'a syllable off its note\'s middle');
  e = clone(x24); e.objects = e.objects.filter(o => o.kind !== 'lyric-line');
  ok(x24, e, 'eg.lyric.place_err', 'no hyphen between the syllables of a word');
  /* vertical spacing, courtesy, brackets */
  e = clone(x16); e.systems[0].staves[1].y -= 1;
  ok(x16, e, 'eg.staff.gap_err', 'staves 4 sp apart');
  e = clone(x16); e.systems[1].staves.forEach(s => { s.y -= 2; }); e.systems[1].box[1] -= 2;
  ok(x16, e, 'eg.system.gap_err', 'systems 4 sp apart');
  e = clone(x16); { const s = e.systems[0].staves[1]; e.objects.filter(o => o.system === 0 && o.staffKey === s.key && o.kind === 'notehead').forEach(o => move(o, 0, -3)); }
  ok(x16, e, 'eg.skyline.vertical_collisions', 'lower-staff heads moved up into the upper staff\'s content');
  e = clone(x20); e.objects = e.objects.filter(o => !(o.courtesy && o.kind === 'keysig'));
  ok(x20, e, 'eg.courtesy.missing', 'no courtesy key signature');
  e = clone(x32); e.objects.filter(o => /accidentalBracket/.test(o.glyph || '')).forEach(o => { o.box[1] += 0.5; o.box[3] -= 0.5; });
  ok(x32, e, 'eg.accidental.bracket_err', 'brackets shorter than the flat');
  /* the G4d-1b fixer (G04 §36.18): R1 - the words around a metronome mark; R2 - A8's positions; R3 - G4-D1b-4 and -5 */
  e = clone(x22); e.objects.filter(o => o.kind === 'words' && o.text === ')').forEach(o => move(o, 0, -2));
  ok(x22, e, 'eg.tempo.split_err', 'a closing parenthesis a line above its tempo');
  e = clone(x22); e.objects.filter(o => o.kind === 'words' && o.text === '(').forEach(o => { o.text = 'Più mosso ( )'; });
  ok(x22, e, 'eg.tempo.split_err', 'an empty "( )"');
  e = clone(x16); e.objects.filter(o => o.kind === 'dynamic' && o.refs[0] === x16.p.marks.find(d => d.kind === 'dynamic').id).forEach(o => move(o, 1, 0));
  ok(x16, e, 'eg.mark.anchor_err', 'a dynamic 1 sp right of its note');
  e = clone(x22); e.objects.filter(o => o.group === x22.p.tempos[0].id).forEach(o => move(o, 2, 0));
  ok(x22, e, 'eg.mark.anchor_err', 'a tempo 2 sp after its note');
  e = clone(x22); e.objects.filter(o => o.kind === 'jump' && o.text === 'D.S. al Coda').forEach(o => move(o, -1, 0));
  ok(x22, e, 'eg.mark.anchor_err', 'D.S. al Coda short of its bar line');
  e = clone(x16); { const h = e.objects.find(o => o.kind === 'hairpin' && o.id === o.refs[0]); h.line[2] -= 1; h.box[2] -= 1; }
  ok(x16, e, 'eg.hairpin.extent_err', 'a hairpin 1 sp short of where it ends');
  e = clone(x16); e.objects = e.objects.filter(o => !(o.kind === 'hairpin' && /#end$/.test(o.id)));
  ok(x16, e, 'eg.hairpin.extent_err', 'the part of a hairpin after a break dropped');
  e = clone(x16); e.objects.filter(o => o.kind === 'words' && o.text === 'cresc.').forEach(o => move(o, 1, 0));
  ok(x16, e, 'eg.words.push_err', 'cresc. 1 sp after its place, nothing before it there');
  e = clone(x16); { const up = x16.p.staves[0].id; e.objects.filter(o => o.system === 0 && o.staffKey === up && o.side === 'below' && /^(dynamic|hairpin|words)$/.test(o.kind)).forEach(o => move(o, 0, -0.4)); }
  ok(x16, e, 'eg.row.centre_err', 'the row between the staves 0.4 sp above the middle');
});

test('the upper row inside to out (§10.2 priority 10) and the one placement function: rows stand outside what came before them', async () => {
  const x = await lay('E22');
  const vs = kinds(x.e, 'volta'), tempo = x.e.objects.filter(o => o.refs[0] === x.p.tempos[0].id);
  /* a volta and the tempo row over the same x: the tempo outside */
  vs.forEach(v => tempo.forEach(t => { if (t.box[0] < v.box[2] && v.box[0] < t.box[2]) assert.ok(t.box[3] <= v.box[1] + 0.02); }));
  /* sizes (§18.3): dynamics 2.5 sp (their glyphs at 2.5/4), chord names 1.4, lyrics 1.3 */
  assert.equal(SM.SIZE.dynamic, 2.5); assert.equal(SM.SIZE.chord, 1.4); assert.equal(SM.SIZE.lyric, 1.3);
  const d = kinds((await lay('E16')).e, 'dynamic').find(o => o.glyph);
  assert.equal(d.scale, 0.63);
});
