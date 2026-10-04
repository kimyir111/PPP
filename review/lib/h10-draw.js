/* G10a-5 (H-10): one score of the review - an arm's graph, an excerpt of it - drawn and sounded the way the APP draws and plays it.

   Unlike review/lib/neutral.js (G9: both arms arrive as flat notes and are re-derived, so notation cannot tell them apart), a recording's
   notation IS what is being judged: its rests, ties, tuplets, bars and hand split. So here nothing is re-derived:

     picture   the arm's own graph through the app's own engraver (engrave/: E.plan, createEngraver, layout, svg), with the review page's
               two configurations (the engraver's desktop one at 2 bars a system, and its phone one: neutral.js LAYOUT) and the same
               `window` the app uses for a close view (a first and last measure), so only the bars of the excerpt are laid out. The SVG
               is cleaned by neutral.js `engraved` (data-* attributes, the pixel size and the root class are removed). Every drawing of a
               page uses the same glyph-id prefix, so the page can hold the glyph definitions once (review/lib/svgpack.js).
     sound     the app's own PianoScore plan for the app's own Score of that graph (Score.finalize(toScore(graph))): ties joined into one
               strike, a note held under a written pedal until the pedal lifts, the app's velocities, the app's tempo map. Each strike
               of the excerpt is [seconds from the start of the excerpt, seconds held, midi, velocity].
     counts    what a reader can count in the drawing (note heads, rests, ties, tuplet brackets, systems) beside what the Score says for the
               same bars, so the packet can be checked: what is drawn is what the arm's Score holds. */
'use strict';
const path = require('path');
const REPO = path.resolve(__dirname, '..', '..');
const E = require(path.join(REPO, 'engrave/index.js'));
const NEUTRAL = require('./neutral.js');
const APP = require('./appcode.js');

const r3 = v => Math.round(v * 1000) / 1000;
const count = (svg, re) => (svg.match(re) || []).length;

/* what can be counted in one engraved svg string */
function drawnCounts(svg) {
  return {
    heads: count(svg, /class="vf-notehead"/g),
    rests: count(svg, /class="vf-notehead vf-rest"/g),
    ties: count(svg, /class="vf-stavetie ppp-tie"/g),
    tuplets: count(svg, /class="ppp-tuplet[ "]/g),
    systems: count(svg, /class="ppp-system"/g)
  };
}

/* what the Score holds for the bars index i0..i1 (0-based, inclusive) */
function scoreCounts(score, i0, i1) {
  const numbers = new Set();
  for (let i = i0; i <= i1; i++) if (score.measures[i]) numbers.add(score.measures[i].number);
  const inWin = score.notes.filter(n => numbers.has(n.m));
  return {
    heads: inWin.filter(n => !n.rest).length,
    rests: inWin.filter(n => n.rest).length,
    tieStops: inWin.filter(n => !n.rest && n.tieStop).length,
    tupletStarts: inWin.filter(n => n.tupletStart).length,
    bars: i1 - i0 + 1
  };
}

/* the strikes of bars i0..i1 as [t, held, midi, vel] seconds from the first of them, by the app's own player plan */
function soundOf(score, i0, i1) {
  const PS = APP.appCode().PianoScore, plan = APP.playPlan(score);
  const a = score.measures[i0].startQ, b = score.measures[i1].startQ + score.measures[i1].lenQ;
  const ms = q => PS.msAt(plan, q, 1), t0 = ms(a);
  const strikes = plan.strikes.filter(s => s.abs >= a - 1e-9 && s.abs < b - 1e-9);
  const notes = strikes.map(s => [r3((ms(s.q) - t0) / 1000), r3((ms(s.upQ) - ms(s.q)) / 1000), s.midi, s.vel])
    .sort((x, y) => x[0] - y[0] || x[2] - y[2]);
  return { notes: notes, seconds: r3((ms(b) - t0) / 1000), strikes: strikes.length };
}

/* graph, bars [i0, i1] -> { svg, svgNarrow, notes, seconds, counts: { wide, narrow, score }, bars }. `prefix` is the glyph-id prefix of both layouts (the same for every drawing of a page). */
function drawPart(graph, win, prefix) {
  const score = APP.scoreOf(graph, 'h10');
  const n = score.measures.length;
  if (!(win[0] >= 0 && win[1] >= win[0] && win[1] < n)) throw new Error('excerpt bars ' + win + ' are outside the ' + n + ' bars of the score');
  const whole = win[0] === 0 && win[1] === n - 1;
  const plan = E.plan(graph), eg = E.layout.createEngraver(plan);
  const cfg = base => E.layout.normalizeConfig(Object.assign({}, base, { window: whole ? null : [win[0], win[1]] }));
  const svg = NEUTRAL.engraved(eg, plan, cfg(NEUTRAL.LAYOUT.wide), prefix);
  const svgNarrow = NEUTRAL.engraved(eg, plan, cfg(NEUTRAL.LAYOUT.narrow), prefix);
  const sound = soundOf(score, win[0], win[1]);
  return {
    svg: svg, svgNarrow: svgNarrow, notes: sound.notes, seconds: sound.seconds, bars: win[1] - win[0] + 1, window: [win[0], win[1]],
    counts: { wide: drawnCounts(svg), narrow: drawnCounts(svgNarrow), score: scoreCounts(score, win[0], win[1]), struck: sound.strikes }
  };
}

module.exports = { drawPart, drawnCounts, scoreCounts, soundOf };
