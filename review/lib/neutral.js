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

   Review page fidelity (the drawing must show what the notes are, or the reviewer judges the drawing, not the music). All of
   this too is the same code for both arms and reads only the notes:
     - RESTS: every stretch of a staff where no note of that staff sounds is drawn as rests (barRests below): a whole-bar
       silence is a whole-bar rest, other gaps are cut at the beats and written as the largest values that fit and are aligned
       with their own length. The engines' own rest entries are ignored (G9 has some, the legacy arm none), so a rest is a
       rest on both sides by the same rule. A gap that does not sit on a 1/64 grid (a triplet's edge) is left alone, never
       approximated, and counted in `render(...).stats`.
     - TIES: a tieStart note and a tieStop note of the same pitch and staff that meet exactly (the first ends where the second
       starts) are drawn tied; a flag with no partner is dropped. A note that crosses a barline is split at the barlines into
       tied pieces of ordinary values (splitAcrossBars) instead of being lost from the drawing. The sound is made from the
       raw notes and is not touched by any of this (audioNotes): it already joins tied continuations.
     - CLEF: the upper staff is always treble. The lower staff's clef is chosen per measure from its notes (lowerClefs; the
       clef that needs fewer ledger lines, constants named CLEF_*), so the arranged left hand is not drawn under a G clef on
       ledger lines just because the source wrote its left hand in treble; the source's own clefs are not used by either arm.
       The clefs go into the graph before the 8va/8vb pass, which so reads the clef that is drawn.
     - TWO DRAWINGS: each arm is engraved twice from one plan, once for a wide screen (LAYOUT.wide: the desktop configuration,
       2 bars a system) and once for a narrow one (LAYOUT.narrow: the engraver's phone configuration, the one the app uses at
       720 px or less). They are the same music; the page shows one by a media query.

   What is deliberately NOT shown: the G9 realizer's own fingering, dynamics, tempo marks, and its own voice/beam structure.
   The review therefore judges the notes an arranger chose, not how well an engine notates them; the price is some realism
   (G9's fingering is a real feature), paid so that a notation difference cannot stand in for a music difference. */
'use strict';
const path = require('path');
const REPO = path.resolve(__dirname, '..', '..');
const L = require(path.join(REPO, 'realize/tools/legacy.js'));
const E = require(path.join(REPO, 'engrave/index.js'));
const OTTAVA = require(path.join(REPO, 'realize/ottava.js'));
const R = require(path.join(REPO, 'scoregraph/rational.js'));
const Ops = require(path.join(REPO, 'scoregraph/ops.js'));

/* the two engravings of every arm: the desktop configuration with 2 bars a system (the engraver's default is 4, which packs
   16th-note runs to under 2 staff spaces between heads), and the engraver's own phone configuration, the one the app uses at
   a viewport of 720 px or less (engrave/layout.js screenConfig: 40 staff spaces wide, 2 bars a system) */
const NARROW_VIEWPORT_PX = 720; /* the page's media query (page.js) and the engraver's phone breakpoint (engrave SCREEN.phoneMaxPx) */
const LAYOUT = Object.freeze({
  wide: Object.freeze({ breakpoint: 'desktop', barsPerSystem: 2 }),
  get narrow() { return E.layout.screenConfig(NARROW_VIEWPORT_PX); }
});

/* the lower staff's clef rule (C): per measure, from that staff's notes alone, the way an engraver picks: the clef that needs
   FEWER ledger lines. A note's ledger lines are counted as realize/ottava.js counts them (diatonic steps beyond the staff's
   outer line, two steps to a line): treble staff E4..F5, bass staff G2..A3 (so a treble note needs 1 line at C4 and 2 at A3,
   a bass note 1 at C4 and 2 at E4). The measure's cost in a clef is the SUM of its notes' lines.
     CLEF_SAVE_SHARE    0.5:  a change needs a clear advantage - the other clef's cost is at least this share below the cost
                        of the clef in force ...
     CLEF_SAVE_MIN      4:    ... and at least this many ledger lines below it, over the measure. Otherwise (a tie, or a small
                        gain) the clef in force stays; the staff opens in bass unless treble wins by the same margin.
     CLEF_MIN_RUN       2:    a stretch in the other clef shorter than this many measures WITH lower-staff notes is not worth
                        the two clef signs; it is folded into its neighbours (the ottava pass carries any extreme notes)
   (0.25 and 2 were tried first: on the 12 pieces they made 11 and 6 clef changes and more 8va/8vb lines than before,
   because mid-range bars differ by only a line or two between the clefs.) A measure with no note on the staff keeps the clef in force (nothing to read); a change is only ever made at a barline. The
   graph is given these clefs BEFORE the ottava pass runs, so 8va/8vb is judged against the clef that is drawn. */
/* the rule's code lives in realize/clefs.js (the app uses it too, G9e-lite); the constants and `ledgerLines` are re-exported below as before */
const { CLEF_SAVE_SHARE, CLEF_SAVE_MIN, CLEF_MIN_RUN, ledgerLines, lowerClefs } = require(path.join(REPO, 'realize/clefs.js'));

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
      if (!m || n.tieStop) { n.acc = null; return; } /* a tied continuation repeats no sign (a tie into the next bar carries it) */
      const alter = m[2].length * (m[2][0] === 'b' ? -1 : 1) || 0;
      const key = n.staff + '|' + m[1] + '|' + m[3];
      const now = inForce.has(key) ? inForce.get(key) : (base[m[1]] || 0);
      if (alter !== now) { n.acc = ACC_OF[String(Math.max(-2, Math.min(2, alter)))]; inForce.set(key, alter); } else n.acc = null;
    });
  });
  return out;
}

/* the ordinary note values, in quarters, largest first (a piece of a note that crosses a barline is written as these) */
const VALUES = [[4, 'whole', 0], [3, 'half', 1], [2, 'half', 0], [1.5, 'quarter', 1], [1, 'quarter', 0], [0.75, 'eighth', 1], [0.5, 'eighth', 0],
  [0.375, '16th', 1], [0.25, '16th', 0], [0.1875, '32nd', 1], [0.125, '32nd', 0], [0.0625, '64th', 0]];
const EPS = 1e-6;
const startsOf = measures => { const q = []; let acc = 0; measures.forEach(m => { q.push(acc); acc += m.lenQ; }); return q; };

/* a note that runs past its barline is cut at the barlines (the engraver refuses a note that overflows its measure, which would
   drop it from the drawing) into tied pieces, each an ordinary value; the first keeps the note's own tie-in and the last its own
   tie-out. A note that fits is returned as it is. */
function splitAcrossBars(measures, list) {
  const out = [];
  list.forEach(n => {
    const meas = measures[n.m - 1];
    if (!meas || n.b + n.dur <= meas.lenQ + EPS) { out.push(n); return; }
    const segs = [];
    let m = n.m, b = n.b, left = n.dur;
    while (left > EPS && measures[m - 1]) {
      const d = Math.min(left, measures[m - 1].lenQ - b);
      if (d > EPS) segs.push({ m: m, b: b, d: d });
      left -= d; m += 1; b = 0;
    }
    const pieces = [];
    segs.forEach(sg => {
      let d = sg.d, at = sg.b;
      while (d > EPS) {
        const v = VALUES.find(x => x[0] <= d + EPS);
        if (!v) break; /* less than a 64th: nothing to draw */
        pieces.push({ m: sg.m, b: at, dur: v[0], type: v[1], dots: v[2] });
        at += v[0]; d -= v[0];
      }
    });
    pieces.forEach((pc, i) => out.push(Object.assign({}, n, pc, {
      tieStop: i === 0 ? n.tieStop : true, tieStart: i === pieces.length - 1 ? n.tieStart : true
    })));
  });
  return out;
}

/* keep a tie only where both ends are there: a tieStart note whose partner - the same pitch on the same staff, flagged tieStop -
   starts exactly where it ends. (The graph builder would otherwise draw a tie hanging off one note.) */
function pairTies(measures, list) {
  const q = startsOf(measures), abs = n => q[n.m - 1] + n.b, key = (n, t) => n.staff + '|' + n.midi + '|' + Math.round(t * 1000);
  const stops = new Map();
  list.forEach(n => { if (n.tieStop) { const k = key(n, abs(n)); if (!stops.has(k)) stops.set(k, []); stops.get(k).push(n); } });
  const from = new Set(), to = new Set();
  list.forEach(n => {
    if (!n.tieStart) return;
    const c = stops.get(key(n, abs(n) + n.dur)), p = c && c.find(x => x !== n && !to.has(x));
    if (p) { from.add(n); to.add(p); }
  });
  list.forEach(n => { n.tieStart = from.has(n); n.tieStop = to.has(n); });
}

/* the note fields kept, sorted so nothing depends on the order an engine happened to emit its notes in. `opts.split` (the drawing
   does; counting notes does not) also cuts notes at barlines. */
function neutralNotes(measures, notes, opts) {
  let kept = notes.filter(n => !n.rest && n.midi != null).map(n => {
    const staff = n.staff || (n.hand === 'l' ? 2 : 1);
    return { m: n.m, b: n.b, dur: n.dur, type: n.type, dots: n.dots || 0, p: n.p, midi: n.midi, acc: null,
      staff: staff, hand: n.hand, voice: staff, rest: false, chord: false, tieStart: !!n.tieStart, tieStop: !!n.tieStop };
  }).sort((a, b) => a.m - b.m || a.b - b.b || a.staff - b.staff || a.midi - b.midi || a.dur - b.dur);
  if (opts && opts.split) kept = splitAcrossBars(measures, kept).sort((a, b) => a.m - b.m || a.b - b.b || a.staff - b.staff || a.midi - b.midi || a.dur - b.dur);
  pairTies(measures, kept);
  return withAccidentals(measures, kept);
}

/* the measure list both arms are drawn from: the piece's own bars and keys and times, and the clefs of this rule (no clef change
   inside a bar; the source's own clef marks are not used) */
function measuresWithClefs(measures, notes) {
  const lower = lowerClefs(measures, notes);
  return measures.map((m, i) => Object.assign({}, m, { clefs: { 1: 'treble', 2: lower[i] }, clefChanges: null }));
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

/* ---- A. rests ---- */
const UNITS = 64; /* a whole note is 64 units: every rest starts and ends on a 64th or is not drawn */
const REST_VALUES = [[64, 'whole', 0], [48, 'half', 1], [32, 'half', 0], [24, 'quarter', 1], [16, 'quarter', 0], [12, 'eighth', 1], [8, 'eighth', 0],
  [6, '16th', 1], [4, '16th', 0], [3, '32nd', 1], [2, '32nd', 0], [1, '64th', 0]];
const restDisplay = u => { const v = REST_VALUES.find(x => x[0] === u); return v ? (v[2] ? { type: v[1], dots: v[2] } : { type: v[1] }) : null; };
const SHORTEST_GAP = 4; /* units (a 16th): a smaller gap between two notes of a staff is not drawn as a rest */
const BINARY_REST = [32, 16, 8, 4, 2, 1]; /* no whole rest inside a bar: the whole rest is the whole-bar rest */

/* the rests for the silent stretch [a, b) of a measure (units), measure length `len` units, beat `beat` units, `compound` when
   a beat is a dotted value (6/8, 9/8, 12/8): a whole-bar silence is one whole-bar rest; a compound beat's worth is one dotted
   rest; everything else is cut at the beats and written as the largest value that fits and starts on a multiple of its own
   length (so a half rest is never on beat 2 of 4/4, and a run of whole beats is merged). */
function restPieces(a, b, len, beat, compound) {
  if (a === 0 && b === len) {
    const d = restDisplay(len) || { type: 'whole' };
    return [{ at: 0, dur: len, display: Object.assign({}, d, { measureRest: true }) }];
  }
  const out = [];
  let x = a;
  while (x < b) {
    const inBeat = beat - (x % beat);
    if (compound && x % beat === 0 && x + beat <= b && restDisplay(beat)) { out.push({ at: x, dur: beat, display: restDisplay(beat) }); x += beat; continue; }
    const cap = compound ? Math.min(b - x, inBeat) : b - x;
    /* an eighth that starts on the second sixteenth of a quarter and fills the rest of the silence without leaving the quarter (16th note, eighth rest, 16th note: how a
       dropped note in a run of sixteenths is written; also the tail of a longer silence that began with a sliver) is ONE eighth rest, not two 16th rests that the beam
       would run across. Simple meters only (a compound beat is cut above). Any other silence is cut as it always was. */
    const inside = v => !compound && v === 8 && b - x === 8 && x % 16 === 4 && x % beat + 8 <= beat;
    const u = BINARY_REST.find(v => v <= cap && (x % v === 0 || inside(v)));
    /* a piece shorter than a 16th (a 32nd, a 64th: the remainder of a silence that does not start on the grid, a note lifted a little) is not drawn: a printed edition writes
       neither between notes, and the silence stays as space (the same rule the app's arrangement follows, repair/index.js closeSmallGaps) */
    if (u >= SHORTEST_GAP) out.push({ at: x, dur: u, display: restDisplay(u) });
    x += u;
  }
  return out;
}

/* Rests for every staff of the graph: each stretch of a measure in which no note of that staff sounds is filled with rests in
   the staff's first voice. Reads only the graph's notes; the notes are not touched. Returns { graph, stats }. */
function addRests(graph, measures) {
  const stats = { rests: 0, wholeBarRests: 0, skippedGaps: 0, offGrid: 0 };
  const part = graph.parts[0];
  const ms = graph.timeline.measures;
  if (!part || ms.length !== measures.length) return { graph: graph, stats: stats };
  /* units are 1/64 of a whole note; a note off that grid (a triplet's edge) keeps its exact place: a silence is drawn from the first grid line at or after the end of
     the note before it to the last grid line at or before the start of the next (so a drawn rest never touches a note), and a remainder shorter than a 16th is not drawn */
  const exact = w => R.toNumber(R.parse(w)) * UNITS;
  const onGrid = u => Math.abs(u - Math.round(u)) < 1e-6;
  const todo = []; /* {staff, m, gaps:[[a,b]], len, beat, compound} */
  part.staves.forEach(st => {
    const perMeasure = new Map();
    part.events.forEach(e => {
      if (e.staff !== st.id || e.kind !== 'note' || e.grace) return;
      if (!perMeasure.has(e.m)) perMeasure.set(e.m, []);
      perMeasure.get(e.m).push(e);
    });
    ms.forEach((m, i) => {
      const lenX = exact(m.dur);
      const evs = perMeasure.get(m.id) || [];
      const spans = evs.map(e => { const a = exact(e.at); return [a, a + exact(e.dur)]; });
      if (!onGrid(lenX)) { stats.skippedGaps++; return; }
      const len = Math.round(lenX);
      if (spans.some(x => !onGrid(x[0]) || !onGrid(x[1]))) stats.offGrid++;
      spans.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
      const gaps = [];
      let cur = 0;
      const gap = (from, to) => { const lo = Math.ceil(from - 1e-6), hi = Math.floor(to + 1e-6); if (hi > lo) gaps.push([lo, hi]); };
      spans.forEach(sp => { if (sp[0] > cur + 1e-6) gap(cur, sp[0]); cur = Math.max(cur, sp[1]); });
      if (cur < len - 1e-6) gap(cur, len);
      if (!gaps.length) return;
      const t = measures[i].time || {};
      const bt = t.beatType > 0 ? t.beatType : 4, beats = t.beats > 0 ? t.beats : 4;
      const compound = (bt === 8 || bt === 16) && beats % 3 === 0 && beats >= 6;
      todo.push({ staff: st.id, m: m.id, gaps: gaps, len: len, beat: (UNITS / bt) * (compound ? 3 : 1), compound: compound });
    });
  });
  if (!todo.length) return { graph: graph, stats: stats };
  const res = Ops.edit(graph, d => {
    const dpart = d.doc.parts[0];
    const voiceOf = new Map();
    dpart.staves.forEach((st, si) => {
      const v = dpart.voices.find(x => x.staff === st.id);
      voiceOf.set(st.id, v ? v.id : d.addVoice(st.id, String(si + 1), dpart));
    });
    todo.forEach(t => t.gaps.forEach(g => {
      restPieces(g[0], g[1], t.len, t.beat, t.compound).forEach(pc => {
        d.addEvent(dpart, { kind: 'rest', m: t.m, at: R.format(R.make(pc.at, UNITS)), dur: R.format(R.make(pc.dur, UNITS)), voice: voiceOf.get(t.staff), staff: t.staff, display: pc.display });
        stats.rests++;
        if (pc.display.measureRest) stats.wholeBarRests++;
      });
    }));
  }, { source: { kind: 'generator', tool: 'ppp.review-page', version: '1.0.0' } });
  return { graph: res.graph, stats: stats };
}

/* the graph both drawings come from: neutral notes (drawn ones: split at barlines), the clef rule, rests, then the ottava pass */
function prepare(measures, tempo, notes, opts) {
  const flat = neutralNotes(measures, notes, { split: true });
  const proj = L.graphFromLegacyNotes(measuresWithClefs(measures, flat), flat, tempo, 'review');
  if (!proj.ok) throw new Error('neutral projection failed: ' + JSON.stringify(proj.unsupported || proj).slice(0, 200));
  const withRests = addRests(proj.graph, measures);
  /* the same pass on either arm (`addOttava` gives the graph itself back when there is nothing to do, or when its own critic
     objects, so a piece it cannot improve is drawn exactly as before) */
  const graph = opts && opts.ottava === false ? withRests.graph : OTTAVA.addOttava(withRests.graph).graph;
  return { graph: graph, stats: withRests.stats };
}

/* one engraving of a prepared graph as a string with nothing that names an engine or a graph */
function engraved(engraver, plan, cfg, idPrefix) {
  let svg = E.svg(engraver.layout(cfg), plan, { idPrefix: idPrefix });
  svg = svg.replace(/ data-[a-z-]+="[^"]*"/g, '');
  svg = svg.replace(/^(<svg[^>]*?) width="[\d.]+" height="[\d.]+"/, '$1');
  svg = svg.replace(/ class="ppp-engraved"/, ' class="score-svg"');
  return svg;
}

/* the wide (default) or narrow engraving of a note list; `opts.layout` picks, `opts.ottava === false` draws without the 8va pass */
function svgOf(measures, tempo, notes, idPrefix, opts) {
  const graph = prepare(measures, tempo, notes, opts).graph, plan = E.plan(graph);
  const narrow = opts && opts.layout === 'narrow';
  return engraved(E.layout.createEngraver(plan), plan, narrow ? LAYOUT.narrow : LAYOUT.wide, idPrefix);
}

/* one arm -> what the packet embeds: both drawings (wide, narrow) and the sound, all from the same neutral notes. The narrow
   drawing's glyph ids carry the label and a marker, so no id repeats on the page. */
function render(measures, tempo, notes, idPrefix, opts) {
  const pre = prepare(measures, tempo, notes, opts), plan = E.plan(pre.graph), eg = E.layout.createEngraver(plan);
  return { svg: engraved(eg, plan, LAYOUT.wide, idPrefix), svgNarrow: engraved(eg, plan, LAYOUT.narrow, idPrefix + 'n-'),
    notes: audioNotes(measures, notes), stats: pre.stats };
}

module.exports = { neutralNotes, audioNotes, density, svgOf, render, prepare, lowerClefs, measuresWithClefs, splitAcrossBars, restPieces, addRests, LAYOUT,
  NARROW_VIEWPORT_PX, CLEF_SAVE_SHARE, CLEF_SAVE_MIN, CLEF_MIN_RUN, ledgerLines };
