/* G9c: draw and sound an arrangement WITHOUT saying who made it.

   Both arms of an item (G9 and the legacy engine) arrive as flat wire-score notes. Here BOTH go through this one function,
   the same steps in the same order, so the only thing that can differ between the two drawings is the notes themselves - which
   is what the review is about. Anything else that would tell them apart is removed or never created:

     - fields an engine set and the other did not (fingering, stem, tie and slur flags, rests, ottava bookkeeping, engine ids)
       are dropped: a note keeps only measure, beat, duration, pitch (with its spelling), staff and hand;
     - voices are re-derived from the notes alone (every note gets its staff as its voice; realize's or the legacy engine's own
       voice numbers are discarded), then split into layers by legacy.js `sanitizeLegacyNotes` (interval scheduling on note
       times), so a chord and a two-voice texture come out the same way whichever engine wrote them;
     - one measure list (the original piece's), one tempo, one engraving configuration;
     - TD16: both graphs then get the same automatic 8va/8vb pass (realize/ottava.js `addOttava`, one rule, default constants):
       notes far above or below a staff print an octave (two for 15ma) away under a line and label, as a printed score would,
       instead of on many ledger lines. The graph keeps the sounding pitch and the audio list is made from the flat notes, so
       the sound is the same with or without it (`render(..., { ottava: false })` draws without, for comparison and tests);
     - the SVG has every data-* attribute removed (event and graph ids, the graph fingerprint) and the root's px size;
       glyph ids carry a per-drawing prefix that names only the item and the label X/Y.

   What is deliberately NOT shown: the G9 realizer's own fingering, dynamics, tempo marks, and its own voice/beam structure,
   and ties (a tied note is two struck notes here, in the drawing and in the sound, on both sides). The review therefore judges
   the notes an arranger chose, not how well an engine notates them. This costs some realism (G9's fingering is a real feature);
   it is the price of not letting a notation difference stand in for a music difference. */
'use strict';
const path = require('path');
const REPO = path.resolve(__dirname, '..', '..');
const L = require(path.join(REPO, 'realize/tools/legacy.js'));
const E = require(path.join(REPO, 'engrave/index.js'));
const OTTAVA = require(path.join(REPO, 'realize/ottava.js'));

/* Printed accidentals, recomputed for BOTH arms from the pitch spelling and the measure's key signature. The engraver prints an
   accidental only where a head carries `acc` (scoregraph/legacy-score.js fromScore), and the two engines differ in whether they
   set it: ScoreArranger's output carries the app's own accidental marks, but a realized (G8a/G9) graph carries none, so drawn
   as it is a chromatic note of G9's would show no sign at all and read as the wrong pitch - a notation defect (and a giveaway)
   that has nothing to do with the notes chosen. Standard rule: a sign is printed when the note's alteration differs from what is
   in force for that staff position (step and octave) - the key signature at the barline, then whatever an earlier note in the
   same measure and staff set. */
const SHARPS = 'FCGDAEB', FLATS = 'BEADGCF';
function keyAlters(fifths) {
  const k = {};
  for (let i = 0; i < Math.abs(fifths || 0); i++) k[(fifths > 0 ? SHARPS : FLATS)[i % 7]] = fifths > 0 ? 1 : -1;
  return k;
}
const ACC_OF = { '-2': 'flat-flat', '-1': 'flat', '0': 'natural', '1': 'sharp', '2': 'double-sharp' };
function withAccidentals(measures, notes) {
  const out = notes.map(n => Object.assign({}, n));
  const byMeasure = new Map();
  out.forEach(n => { if (!byMeasure.has(n.m)) byMeasure.set(n.m, []); byMeasure.get(n.m).push(n); });
  byMeasure.forEach((list, mNo) => {
    const meas = measures[mNo - 1], base = keyAlters(meas && meas.key ? meas.key.fifths : 0);
    const inForce = new Map(); /* staff|step|oct -> alter */
    list.slice().sort((a, b) => a.b - b.b || a.midi - b.midi).forEach(n => {
      const m = /^([A-G])(#{0,3}|b{0,3})(-?\d+)$/.exec(n.p || '');
      if (!m) { n.acc = null; return; }
      const alter = m[2].length * (m[2][0] === 'b' ? -1 : 1) || 0;
      const key = n.staff + '|' + m[1] + '|' + m[3];
      const now = inForce.has(key) ? inForce.get(key) : (base[m[1]] || 0);
      if (alter !== now) { n.acc = ACC_OF[String(Math.max(-2, Math.min(2, alter)))]; inForce.set(key, alter); } else n.acc = null;
    });
  });
  return out;
}

/* the note fields kept, sorted so nothing depends on the order an engine happened to emit its notes in */
function neutralNotes(measures, notes) {
  const kept = notes.filter(n => !n.rest && n.midi != null).map(n => {
    const staff = n.staff || (n.hand === 'l' ? 2 : 1);
    return { m: n.m, b: n.b, dur: n.dur, type: n.type, dots: n.dots || 0, p: n.p, midi: n.midi, acc: null,
      staff: staff, hand: n.hand, voice: staff, rest: false, chord: false };
  }).sort((a, b) => a.m - b.m || a.b - b.b || a.staff - b.staff || a.midi - b.midi || a.dur - b.dur);
  return withAccidentals(measures, kept);
}

/* [startQ, durQ, midi] per SOUNDING note, in quarters from the start of the piece (audio + page data). The drawn score keeps every
   note as it is; the sound must not do what one hand cannot: (1) a note flagged as the end of a tie, starting exactly where a
   same-pitch note ends, is joined to it (a tied continuation is not re-struck) - both arms, though only G9's carry tie flags today;
   (2) two notes with the same pitch starting together are one key struck once (G9 puts the same pitch in both hands at one onset,
   which would otherwise sound louder than the legacy arm); the longer one is kept. */
function audioNotes(measures, notes) {
  const startQ = []; let acc = 0;
  measures.forEach(m => { startQ.push(acc); acc += m.lenQ; });
  const r = v => Math.round(v * 1000) / 1000;
  const list = notes.filter(n => !n.rest && n.midi != null).map(n => ({ s: startQ[n.m - 1] + n.b, d: n.dur, midi: n.midi, tieStop: !!n.tieStop }))
    .sort((a, b) => a.s - b.s || a.midi - b.midi || b.d - a.d);
  const out = [], last = new Map();
  list.forEach(n => {
    const prev = last.get(n.midi);
    if (n.tieStop && prev && Math.abs(prev.s + prev.d - n.s) < 1e-6) { prev.d += n.d; return; }
    const o = { s: n.s, d: n.d, midi: n.midi };
    out.push(o); last.set(n.midi, o);
  });
  const seen = new Map();
  out.forEach(o => {
    const k = r(o.s) + '|' + o.midi, p = seen.get(k);
    if (!p) seen.set(k, o); else if (o.d > p.d) p.d = o.d, p.dead = false, o.dead = true; else o.dead = true;
  });
  return out.filter(o => !o.dead).map(o => [r(o.s), r(o.d), o.midi]).sort((a, b) => a[0] - b[0] || a[2] - b[2] || a[1] - b[1]);
}

/* how many notes are drawn, and how many of them in the left hand (staff 2): the density the reviewer can see (kept in the key) */
function density(measures, notes) {
  const n = neutralNotes(measures, notes);
  return { notes: n.length, leftHand: n.filter(x => x.staff === 2).length };
}

/* the engraved SVG of a note list, as a string with nothing that names an engine or a graph */
function svgOf(measures, tempo, notes, idPrefix, opts) {
  const proj = L.graphFromLegacyNotes(measures, neutralNotes(measures, notes), tempo, 'review');
  if (!proj.ok) throw new Error('neutral projection failed: ' + JSON.stringify(proj.unsupported || proj).slice(0, 200));
  /* the same pass on either arm (`addOttava` gives the graph itself back when there is nothing to do, or when its own critic
     objects, so a piece it cannot improve is drawn exactly as before) */
  const graph = opts && opts.ottava === false ? proj.graph : OTTAVA.addOttava(proj.graph).graph;
  const plan = E.plan(graph);
  const eng = E.layout.engrave(plan, { breakpoint: 'desktop' });
  let svg = E.svg(eng, plan, { idPrefix: idPrefix });
  svg = svg.replace(/ data-[a-z-]+="[^"]*"/g, '');
  svg = svg.replace(/^(<svg[^>]*?) width="[\d.]+" height="[\d.]+"/, '$1');
  svg = svg.replace(/ class="ppp-engraved"/, ' class="score-svg"');
  return svg;
}

/* one arm -> what the packet embeds: the drawing and the sound, both from the same neutral notes */
function render(measures, tempo, notes, idPrefix, opts) {
  return { svg: svgOf(measures, tempo, notes, idPrefix, opts), notes: audioNotes(measures, notes) };
}

module.exports = { neutralNotes, audioNotes, density, svgOf, render };
