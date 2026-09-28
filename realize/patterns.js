/* ============================================================================
   PPP Arrangement Realization — accompaniment pattern library (docs/GOALS/G08 §6a).

   Six named textures, per the design doc's own list: 'hymn' (verbatim multi-voice copy -
   handled by realize/index.js directly, not here, since it never touches harmony) and five
   harmony-driven accompaniment shapes for the hand that is NOT carrying the melody:
   'block', 'broken' (Alberti), 'ballad' (rolling arpeggio), 'pop' (root/fifth + comping
   stab), 'waltz' (oom-pah-pah). Every one of the five is built from the SAME two real
   inputs - a section's real per-beat harmony windows (songgraph/harmony.js) and G5's real
   hand-reach constants - not from arrange_score.py's melody-derived voicing tables (G08
   §13: read for prior art, not ported; no G5/G6/graph awareness in that code).

   Each pattern function takes one measure's ordered harmony windows (songgraph/util.js's
   beatGrid grouping, one window per notated beat/pulse - see time.js's groups()) and the
   voice-leading state carried in from the previous measure (realize/theory.js), and returns
   {events: [{at, dur, midis:[...]}], prevMidis}. `at`/`dur` are rationals RELATIVE TO THE
   MEASURE (the same convention scoregraph Events use), so the caller (realize/index.js)
   only has to attach the right measure id.

   G8b note (docs/GOALS/G08B_LEGACY_RETIREMENT.md): wrapped in the same UMD shape every
   sibling module (songgraph/*, arrangement/*, playability/*) already uses, so the app can
   load it via <script> - a pure packaging change, no logic below this point was touched.
   ========================================================================== */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('../scoregraph/rational.js'), require('./theory.js'));
  } else {
    const SG = root.PPPScoreGraphModules || {};
    const M = root.PPPRealizeModules = root.PPPRealizeModules || {};
    M.patterns = factory(SG.rational, M.theory);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (R, TH) {
  'use strict';

function sortAsc(a) { return a.slice().sort((x, y) => x - y); }

/* A window with no real chord (a silent beat - root===null) reuses the previous voicing
   held (a rest in the harmony is not a reason to invent a pitch); the very first window of
   a piece/section with no chord falls back to a bare tonic-less anchor triad (root=0,'maj')
   rather than crash - callers should be rare to hit this (most corpus beats have content). */
function chordOf(prevMidis, w, anchor, count) {
  const root = w.root == null ? 0 : w.root;
  const quality = w.quality || 'maj';
  return prevMidis ? TH.leadVoicing(prevMidis, root, quality) : TH.freshVoicing(root, quality, count, anchor);
}

function span(midis) { const s = sortAsc(midis); return s[s.length - 1] - s[0]; }

function fitSpan(midis, maxSpan) { return span(midis) <= maxSpan ? midis : TH.clampSpan(midis, maxSpan); }

/* ---- block chords: one voiced chord struck per beat window, held for its full length ---- */
function block(windows, prevMidis, opts) {
  const events = [];
  windows.forEach(w => {
    const chord = fitSpan(chordOf(prevMidis, w, opts.anchor, opts.count), opts.maxSpan);
    events.push({ at: w.w0, dur: R.sub(w.w1, w.w0), midis: chord });
    prevMidis = chord;
  });
  return { events, prevMidis };
}

/* ---- broken chords / Alberti bass: low, high, mid, high within each beat window ---- */
function broken(windows, prevMidis, opts) {
  const events = [];
  windows.forEach(w => {
    const chord = fitSpan(chordOf(prevMidis, w, opts.anchor, opts.count), opts.maxSpan);
    const s = sortAsc(chord);
    const seq = s.length >= 3 ? [s[0], s[s.length - 1], s[1], s[s.length - 1]] : [s[0], s[s.length - 1], s[0], s[s.length - 1]];
    const step = R.div(R.sub(w.w1, w.w0), R.make(seq.length, 1));
    seq.forEach((m, i) => events.push({ at: R.add(w.w0, R.mul(step, R.make(i, 1))), dur: step, midis: [m] }));
    prevMidis = chord;
  });
  return { events, prevMidis };
}

/* ---- ballad arpeggio: a rolling up-then-partway-back sweep through the chord tones ---- */
function ballad(windows, prevMidis, opts) {
  const events = [];
  windows.forEach(w => {
    const chord = fitSpan(chordOf(prevMidis, w, opts.anchor, opts.count), opts.maxSpan);
    const s = sortAsc(chord);
    const seq = s.length > 2 ? s.concat(s.slice(1, -1).reverse()) : s;
    const step = R.div(R.sub(w.w1, w.w0), R.make(seq.length, 1));
    seq.forEach((m, i) => events.push({ at: R.add(w.w0, R.mul(step, R.make(i, 1))), dur: step, midis: [m] }));
    prevMidis = chord;
  });
  return { events, prevMidis };
}

/* ---- simple pop comping: alternating root/fifth bass, a chord stab off the beat.
   Each beat window splits into two clean (binary) halves - no swing ratio - so its
   duration always matches a real notated value without needing a tuplet (realize/index.js
   derives `display` from the exact duration; see its header). */
function pop(windows, prevMidis, opts) {
  const events = [];
  windows.forEach((w, i) => {
    const chord = fitSpan(chordOf(prevMidis, w, opts.anchor, opts.count), opts.maxSpan);
    const rootMidi = TH.nearestWithPc(w.root == null ? (prevMidis ? prevMidis[0] % 12 : 0) : w.root, opts.anchor - 12);
    const fifthMidi = TH.nearestWithPc(((w.root == null ? 0 : w.root) + 7) % 12, rootMidi);
    const bassNote = i % 2 === 0 ? rootMidi : fifthMidi;
    const half = R.div(R.sub(w.w1, w.w0), R.make(2, 1));
    events.push({ at: w.w0, dur: half, midis: [bassNote] });
    if (i % 2 === 1) events.push({ at: R.add(w.w0, half), dur: half, midis: fitSpan(chord, opts.maxSpan) });
    else events.push({ at: R.add(w.w0, half), dur: half, midis: [bassNote] });
    prevMidis = chord;
  });
  return { events, prevMidis };
}

/* ---- waltz: first pulse a low bass note, remaining pulses the voiced chord ("oom-pah") -
   §13's own note on arrange_score.py: for a non-triple metre this is a generalized N-pulse
   cross-rhythm (bass then chord on every later beat window), not a destructive rebarring. */
function waltz(windows, prevMidis, opts) {
  const events = [];
  windows.forEach((w, i) => {
    const chord = fitSpan(chordOf(prevMidis, w, opts.anchor, opts.count), opts.maxSpan);
    if (i === 0) {
      const rootMidi = TH.nearestWithPc(w.root == null ? chord[0] % 12 : w.root, opts.anchor - 12);
      events.push({ at: w.w0, dur: R.sub(w.w1, w.w0), midis: [rootMidi] });
    } else {
      events.push({ at: w.w0, dur: R.sub(w.w1, w.w0), midis: chord });
    }
    prevMidis = chord;
  });
  return { events, prevMidis };
}

const PATTERNS = Object.freeze({ block, broken, ballad, pop, waltz });

function patternNames() { return Object.keys(PATTERNS); }

/* opts: {anchor (MIDI register midpoint), count (chord size, 2-4), maxSpan, profile} */
function run(name, windows, prevMidis, opts) {
  const fn = PATTERNS[name] || PATTERNS.block;
  return fn(windows, prevMidis, opts);
}

  return { PATTERNS, patternNames, run, chordOf, sortAsc, span };
});
