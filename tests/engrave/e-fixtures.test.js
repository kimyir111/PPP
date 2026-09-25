/* G4a on the E fixtures (docs/GOALS/G04 §22.1): forty small files, one notation topic each, written by
   tests/engrave/tools/make-e-fixtures.js. At the plan level (G4a) each must open, plan in both modes with a clean
   audit, leave its graph untouched, and dispose of its topic's notation the way G04 says. The geometry these files
   also exist for (spacing, collisions, curves) is judged from G4b on. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { REPO, SG, E } = require('./helpers.js');
const gen = require('./tools/make-e-fixtures.js');

const DIR = path.join(REPO, 'tests', 'engrave', 'fixtures', 'e');
const L = SG.legacy;
const cache = new Map();
async function load(prefix) {
  if (cache.has(prefix)) return cache.get(prefix);
  const f = fs.readdirSync(DIR).find(x => x.startsWith(prefix + '-'));
  assert.ok(f, prefix + ' exists');
  const r = await SG.importFile(new Uint8Array(fs.readFileSync(path.join(DIR, f))), { name: f, scoreId: 'e-' + prefix });
  assert.ok(r.ok, prefix + ' opens: ' + (r.message || ''));
  cache.set(prefix, r.graph);
  return r.graph;
}
const entries = (p, kind, status, code) => p.ledger.filter(en => en.kind === kind && (!status || en.status === status) && (code === undefined || en.code === code));
const spanners = (g, type) => g.parts.flatMap(pt => pt.spanners.filter(s => s.type === type));

test('the committed E fixtures are what the generator writes: forty, one per G04 topic', () => {
  const built = gen.build();
  assert.equal(built.length, 40);
  const files = fs.readdirSync(DIR).filter(f => f.endsWith('.musicxml')).sort();
  assert.deepEqual(files, built.map(x => x[0]));
  built.forEach(([name, text]) => assert.equal(fs.readFileSync(path.join(DIR, name), 'utf8').replace(/\r\n/g, '\n'), text, name));
});

test('every E fixture opens, plans in both modes with a clean audit, and its graph is untouched', async () => {
  for (const f of fs.readdirSync(DIR).filter(x => x.endsWith('.musicxml')).sort()) {
    const g = await load(f.slice(0, 3));
    const fp = SG.fingerprint(g);
    ['screen', 'print'].forEach(mode => {
      const a = E.audit(g, E.plan(g, { mode: mode }));
      assert.ok(a.ok, f + ' ' + mode + ' ' + JSON.stringify({ silent: a.silent.slice(0, 2), missing: a.missing.slice(0, 2), altered: a.altered.slice(0, 2), unapproved: a.unapproved }));
    });
    assert.equal(SG.fingerprint(g), fp, f + ': the graph is unchanged');
    assert.equal(JSON.stringify(E.plan(g)), JSON.stringify(E.plan(g)), f + ': deterministic');
  }
});

test('E01-E03 beams: every graph beam drawn with its notes and breaks, none derived where the file beams', async () => {
  for (const k of ['E01', 'E02', 'E03']) {
    const g = await load(k), p = E.plan(g);
    const gb = spanners(g, 'beam');
    assert.ok(gb.length >= 1, k);
    assert.equal(p.beams.filter(b => b.source === 'graph').length, gb.length, k + ': every graph beam');
    assert.equal(p.beams.filter(b => b.source === 'derived').length, 0, k + ': nothing derived in a part that beams');
    gb.forEach(s => assert.deepEqual(p.beams.find(b => b.id === s.id).events, s.events));
  }
  const p2 = E.plan(await load('E02'));
  assert.equal(entries(p2, 'beam-break', 'drawn').length, 1, 'E02: the secondary break');
  const g3 = await load('E03');
  assert.equal(spanners(g3, 'beam')[0].events.length, 3, 'E03: the beam holds the three notes around the rest');
});

test('E04-E07 tuplets: show options, printed:false, nesting, a rest member, one-note chains', async () => {
  const p4 = E.plan(await load('E04'));
  assert.equal(entries(p4, 'tuplet', 'suppressed', 'show-none').length, 1);
  assert.equal(entries(p4, 'tuplet', 'suppressed', 'printed-false').length, 1);
  const drawn4 = p4.tuplets.filter(t => t.source === 'graph');
  assert.deepEqual(drawn4.map(t => [t.number, t.bracket]).sort(), [['actual', false], ['actual', true]]);
  const p5 = E.plan(await load('E05'));
  const inner = p5.tuplets.find(t => t.parent);
  assert.ok(inner && inner.actual === 3 && inner.normal === 2, 'E05: the inner triplet names its 5:4 parent');
  assert.equal(p5.tuplets.find(t => t.id === inner.parent).actual, 5);
  const p6 = E.plan(await load('E06'));
  assert.equal(p6.tuplets[0].bracket, true, 'E06: a rest in the group - a bracket shows it');
  const p7 = E.plan(await load('E07'));
  const merged = p7.tuplets.filter(t => t.source === 'merged');
  assert.deepEqual(merged.map(t => t.events.length), [3, 3], 'E07: two exact chains shown as one triplet each');
  assert.equal(entries(p7, 'tuplet', 'drawn', 'one-note').length, 3, 'E07: the chain off the grid stays as the file states it');
});

test('E08-E11 ties and slurs: the graph\'s own pairs, over a bar line, a rest and a system break', async () => {
  const g8 = await load('E08'), p8 = E.plan(g8);
  assert.equal(p8.ties.length, 1);
  const head = g8.parts[0].events.flatMap(e => e.heads || []).find(h => h.id === p8.ties[0].from);
  assert.equal(head.pitch.step, 'E', 'E08: only the E of the chord is tied');
  const p9 = E.plan(await load('E09'));
  assert.equal(p9.ties.length, 2);
  assert.equal(entries(p9, 'layout-break', 'suppressed', 'source-break-not-honored').length, 1);
  assert.equal(entries(E.plan(await load('E09'), { respectSourceBreaks: true }), 'layout-break', 'drawn').length, 1);
  const g10 = await load('E10'), p10 = E.plan(g10);
  assert.deepEqual(p10.slurs.map(s => [s.from, s.to]), spanners(g10, 'slur').map(s => [s.from, s.to]), 'E10: overlapping slurs keep their own ends');
  const g11 = await load('E11'), p11 = E.plan(g11);
  const rest = g11.parts[0].events.find(e => e.kind === 'rest' && e.staff === g11.parts[0].staves[0].id);
  const over = p11.slurs.find(s => { const a = g11.parts[0].events.find(e => e.id === s.from), z = g11.parts[0].events.find(e => e.id === s.to);
    return a && z && a.m === rest.m && R(a.at) < R(rest.at) && R(rest.at) < R(z.at); });
  assert.ok(over, 'E11: a slur from a note over a rest to a note');
});
const R = w => SG.rational.toNumber(SG.rational.parse(w));

test('E12-E13 voices: roles from the graph\'s voice order, stated stems win, rests in both voices', async () => {
  const g = await load('E12'), p = E.plan(g);
  const role = p.roles.find(r => r.voices.length === 2);
  assert.ok(role, 'two voices on the upper staff');
  assert.deepEqual(Object.values(role.role), ['up', 'down']);
  p.events.filter(e => e.stemFrom === 'graph').forEach(e => assert.equal(e.stem, g.parts[0].events.find(x => x.id === e.id).display.stem));
  /* §22.1: a unison of different dots (and, for the G4c review R1, a unison and a second of flagged eighths) */
  const notes = p.events.filter(e => e.kind === 'note' && e.staff === p.staves[0].id);
  const pitch = e => e.heads.map(h => h.written.step + h.written.oct).join();
  const together = (a, b) => a.m === b.m && a.at === b.at && a.voice !== b.voice;
  assert.ok(notes.some(a => notes.some(b => together(a, b) && pitch(a) === pitch(b) && a.type === b.type && (a.dots || 0) !== (b.dots || 0))), 'E12: a unison of different dots');
  assert.ok(notes.some(a => notes.some(b => together(a, b) && pitch(a) === pitch(b) && a.type === 'eighth' && b.type === 'eighth')), 'E12: a unison of eighths');
  const p13 = E.plan(await load('E13'));
  const rests = p13.events.filter(e => e.kind === 'rest');
  assert.equal(rests.length, 5);
  /* §22.1: two voices resting together for the same length, and for different lengths */
  assert.ok(rests.some(a => rests.some(b => together(a, b) && a.dur === b.dur)), 'E13: rests of one length at once');
  assert.ok(rests.some(a => rests.some(b => together(a, b) && a.dur !== b.dur)), 'E13: rests of different lengths at once');
});

test('E14 grace notes: before a note drawn, slashed or not; one after the last note deferred grace-after', async () => {
  const p = E.plan(await load('E14'));
  const graces = p.events.filter(e => e.grace);
  assert.equal(graces.length, 5);
  assert.deepEqual(graces.filter(e => !e.grace.after).map(e => e.grace.slash), [true, false, false, true]);
  assert.equal(graces.filter(e => e.grace.after).length, 1);
  assert.equal(entries(p, 'grace', 'deferred', 'grace-after').length, 1);
  assert.equal(entries(p, 'grace', 'drawn').length, 4);
});

test('E15-E17 marks: articulations, fermatas, dynamics, hairpins, pedal marks and the pedal change', async () => {
  const p15 = E.plan(await load('E15'));
  assert.deepEqual(p15.events.flatMap(e => e.arts).sort(), ['accent', 'accent', 'marcato', 'staccato', 'staccato', 'tenuto']);
  assert.equal(entries(p15, 'fermata', 'drawn').length, 2);
  const p16 = E.plan(await load('E16'));
  assert.deepEqual(p16.marks.filter(m => m.kind === 'dynamic').map(m => m.value), ['p', 'f', 'pp']);
  assert.deepEqual(p16.lines.filter(l => l.kind === 'wedge').map(l => l.wedge), ['crescendo', 'diminuendo']);
  const p17 = E.plan(await load('E17'));
  const ped = p17.lines.filter(l => l.kind === 'pedal');
  assert.equal(ped.length, 2);
  assert.equal(ped.reduce((n, l) => n + l.changes.length, 0), 1, 'E17: the change is its own drawn item, not a release');
  assert.equal(entries(p17, 'pedal-change', 'drawn').length, 1);
  assert.ok(ped.some(l => l.mark && l.mark.line === true), 'a line pedal');
});

/* Score.finalize's reading of an 8va (App 3573-3606): the notes it moves are those that start inside [from, to) on the
   8va's staff, or on every staff when the 8va names none. Re-stated here from the app's code so the plan can be held
   to the same set of notes. */
function scoreShifted(score) {
  const byNumber = {};
  let q = 0;
  score.measures.forEach(m => { byNumber[m.number] = q; q += m.lenQ; });
  return score.notes.map(n => {
    if (n.rest) return false;
    const at = byNumber[n.m] + n.b;
    return (score.ottavas || []).some(ov => (ov.staff == null || ov.staff === (n.staff || 1)) &&
      at >= byNumber[ov.m] + ov.b - 1e-6 && at < byNumber[ov.endM] + ov.endB - 1e-6);
  });
}
test('E18 / fixer P6: an 8va that names no staff moves the notes of every staff - the plan, toScore and fromScore agree', async () => {
  const g = await load('E18');
  const p = E.plan(g);
  const oct = p.lines.filter(l => l.kind === 'ottava');
  assert.deepEqual(oct.map(o => o.shift).sort(), [-1, 1, 1, 2]);
  const assumed = oct.filter(o => o.assumed);
  assert.equal(assumed.length, 1, 'the file names no staff for one of them');
  assert.deepEqual(assumed[0].covers, g.parts[0].staves.map(s => s.id), 'and it covers every staff of the part');
  assert.ok(p.diagnostics.some(d => d.code === 'OTTAVA_STAFF_ASSUMED'));
  /* the notes the plan writes away from where they sound are exactly the notes the app moves */
  const score = L.toScore(g, { name: 'e18' });
  assert.equal(score.ottavas.find(o => o.m === score.measures[2].number).staff, null, 'toScore reads it on every staff');
  const link = L.link(score, g);
  assert.ok(link.ok);
  const heads = new Map(p.events.flatMap(e => e.heads.map(h => [h.id, h])));
  const moved = scoreShifted(score);
  score.notes.forEach((n, i) => {
    if (n.rest) return;
    const h = heads.get(link.byNote[i].head);
    assert.equal(h.written.oct !== h.pitch.oct, moved[i], 'note ' + n.p + ' in bar ' + n.m + ' staff ' + n.staff);
  });
  assert.ok(moved.filter(Boolean).length >= 10);
  /* rebuilt from the Score, the same 8va is again assumed and moves the same notes */
  const fr = L.fromScore(score);
  assert.ok(fr.ok);
  const pp = E.plan(fr.graph);
  const ph = new Map(pp.events.flatMap(e => e.heads.map(h => [h.id, h])));
  score.notes.forEach((n, i) => {
    if (n.rest) return;
    const a = heads.get(link.byNote[i].head), b = ph.get(fr.byNote[i].head);
    assert.deepEqual(b.written, a.written, 'projected: note ' + n.p + ' bar ' + n.m);
  });
});

test('E19-E21 clefs, keys and meters: as the graph states them, a hidden meter suppressed', async () => {
  const p19 = E.plan(await load('E19'));
  assert.deepEqual(p19.clefs.map(c => [c.sign, c.line, c.octave]), [['G', 2, 0], ['F', 4, 0], ['G', 2, 0], ['C', 3, 0], ['G', 2, -1], ['F', 4, 0]]);
  assert.ok(p19.clefs.some(c => c.at !== '0'), 'a change inside a bar');
  const p20 = E.plan(await load('E20'));
  assert.deepEqual(p20.keys.map(k => k.fifths), [3, -1]);
  const p21 = E.plan(await load('E21'));
  assert.deepEqual(p21.meters.map(m => m.symbol), [null, null, 'common', 'cut', null]);
  assert.equal(entries(p21, 'meter', 'suppressed', 'hidden').length, 1);
});

test('E22-E25: endings and jumps, fingering, lyrics, chord symbols (and a config that hides them)', async () => {
  const p22 = E.plan(await load('E22'));
  assert.equal(p22.endings.length, 2);
  assert.deepEqual(p22.jumps.map(j => j.kind).sort(), ['coda', 'dalsegno', 'segno', 'tocoda']);
  const p23 = E.plan(await load('E23'));
  assert.equal(entries(p23, 'fingering', 'drawn').length, 7);
  assert.equal(entries(E.plan(await load('E23'), { fingering: false }), 'fingering', 'suppressed', 'config-off').length, 7);
  const p24 = E.plan(await load('E24'));
  assert.deepEqual(p24.events.flatMap(e => e.lyrics.map(l => l.text)), ['Sing', 'hap', 'py']);
  const p25 = E.plan(await load('E25'));
  assert.equal(p25.marks.filter(m => m.kind === 'chord').length, 4);
  assert.equal(entries(E.plan(await load('E25'), { chords: false }), 'chord', 'suppressed', 'config-off').length, 4);
});

test('E26-E30: cross-staff, percussion, multi-bar and whole-bar rests, hidden and cue notes', async () => {
  const p26 = E.plan(await load('E26'));
  assert.equal(entries(p26, 'cross-staff-event', 'drawn').length, 1);
  assert.equal(entries(p26, 'cross-staff-head', 'deferred', 'cross-staff-chord').length, 1);
  const g27 = await load('E27'), p27 = E.plan(g27);
  assert.equal(p27.events.filter(e => e.kind === 'perc').length, 4, 'percussion notes are notes, not rests');
  assert.equal(p27.staves[0].kind, 'percussion');
  const g28 = await load('E28');
  assert.equal(entries(E.plan(g28), 'multi-rest', 'suppressed', 'screen-draws-each-bar').length, 1);
  assert.equal(entries(E.plan(g28, { mode: 'print' }), 'multi-rest', 'drawn').length, 1);
  assert.equal(E.plan(await load('E29')).events.filter(e => e.measureRest).length, 2);
  const p30 = E.plan(await load('E30'));
  assert.equal(entries(p30, 'note', 'suppressed', 'hidden').length, 1);
  assert.equal(entries(p30, 'rest', 'suppressed', 'hidden').length, 1);
  assert.equal(p30.events.filter(e => e.cue).length, 1);
});

test('E31-E36: noteheads, cautionary accidentals, an accidental chord, ledger lines, voice and piano, a pickup', async () => {
  const p31 = E.plan(await load('E31'));
  assert.deepEqual(p31.events.flatMap(e => e.heads.map(h => h.notehead && h.notehead.shape)).filter(Boolean).slice(0, 4), ['x', 'diamond', 'slash', 'normal']);
  const p32 = E.plan(await load('E32'));
  const acc = p32.events.flatMap(e => e.heads.map(h => h.acc)).filter(Boolean);
  assert.ok(acc.some(a => a.cautionary) && acc.some(a => a.paren) && acc.some(a => a.bracket));
  assert.equal(E.plan(await load('E33')).events[0].heads.filter(h => h.acc).length, 6);
  const p34 = E.plan(await load('E34'));
  assert.ok(p34.events.some(e => e.heads.some(h => h.written.oct >= 7)) && p34.events.some(e => e.heads.some(h => h.written.oct <= 1)));
  const g35 = await load('E35');
  assert.equal(entries(E.plan(g35), 'part-name', 'suppressed', 'print-only').length, 2);
  assert.equal(entries(E.plan(g35, { mode: 'print' }), 'part-name', 'drawn').length, 2);
  const p36 = E.plan(await load('E36'));
  assert.deepEqual(p36.measures.map(m => m.implicit), [true, false, false, true]);
});

test('E37-E40: a long piece, the G3-off recording shape, the G3a shape, arpeggios and glissandi', async () => {
  const p37 = E.plan(await load('E37'));
  assert.equal(p37.measures.length, 64);
  const p38 = E.plan(await load('E38'));
  assert.equal(p38.beams.filter(b => b.source === 'graph').length, 0);
  assert.ok(p38.beams.filter(b => b.source === 'derived').length >= 1, 'E38: no beam in the file - derived by the one rule');
  assert.equal(p38.tuplets.filter(t => t.source === 'merged').length, 1, 'E38: the one-note triplet chain shown as one triplet');
  assert.equal(p38.ties.length, 1);
  assert.equal(entries(p38, 'pedal-change', 'drawn').length, 1);
  const p39 = E.plan(await load('E39'));
  assert.equal(p39.beams.filter(b => b.source === 'derived').length, 0);
  const t39 = p39.tuplets.find(t => t.source === 'graph');
  assert.equal(t39.bracket, false, 'E39: the triplet is exactly one beam: the number alone');
  assert.ok(p39.roles.some(r => r.voices.length === 2));
  const p40 = E.plan(await load('E40'));
  assert.deepEqual(p40.lines.filter(l => l.kind === 'arpeggio').map(l => [l.dir, l.non]), [['up', false], ['down', false], [null, true]]);
  assert.deepEqual(p40.lines.filter(l => l.kind === 'gliss').map(l => JSON.stringify([l.line, l.slide])).sort(), ['["wavy",false]', '[null,true]']);
});
