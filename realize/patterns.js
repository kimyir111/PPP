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

/* ---- stride geometry (docs/GOALS/G09 section 12 "G9 left-hand jumps (post H-8 re-look)") ----
   `pop` and `waltz` put a bass note below a chord. They used to voice the chord by smooth voice leading around the section's
   left-hand register midpoint and put the bass an octave under that midpoint, so the chord sat 8 to 20 semitones above the
   bass (mean 16-17 measured): every bass-to-chord and chord-to-bass step was an octave or more (the reviewer's "the distance
   between the low notes, an octave or a tenth, is too far"). The geometry now voices the chord just above its bass
   (theory.foldAbove: every chord tone in (bass, bass + 12]) and takes the bass no lower than the register floor when one is given.
   Three settings of `opts.stride`: 'wide' is the old geometry, kept only so the change can be measured and tested against it;
   'close' is the fold above the bass exactly; 'open' (the DEFAULT) is 'close' except that when the bass is below C3 (MIDI 48) the chord
   is folded above max(bass + 4, 47), so its tones are at or above C3 and at least a fifth over the bass (a third or second between
   two low notes is a muddy cluster, measured by critics/low-register-cluster.js). That start is capped at bass + 5, so for the two
   lowest basses (E2, F2) a chord may still start under C3 and the bass-to-chord step stays under an octave. */
function closeStride(opts) { return opts.stride !== 'wide'; }
function strideLo(opts) { return closeStride(opts) && opts.floor != null ? { lo: opts.floor } : undefined; }
/* A silent window (root null) takes root 0 for the bass AND the chord on the close path, so they agree (the old path took the
   bass's pitch class from the previous chord's first voice and the chord from root 0). */
function rootOf(w) { return w.root == null ? 0 : w.root; }
/* The chord over `bass`, within the hand profile's span exactly as the old path was (`fitSpan`): fold above `start`, then, while the
   span is over `maxSpan`, move the lowest tone up an octave (an inversion; every pitch class kept, the top rises by at most a few
   semitones past the octave). */
function closeChord(bass, w, opts) {
  const start = opts.stride !== 'close' && bass < TH.CLUSTER_BELOW ? Math.min(Math.max(bass + 4, TH.CLUSTER_BELOW - 1), bass + 5) : bass;
  let chord = TH.foldAbove(start, TH.targetPcs(rootOf(w), w.quality || 'maj', opts.count));
  for (let i = 0; i < chord.length && chord.length > 1 && span(chord) > opts.maxSpan; i++) chord = chord.slice(1).concat([chord[0] + 12]);
  return chord;
}

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
  const close = closeStride(opts), lo = strideLo(opts);
  windows.forEach((w, i) => {
    const rootMidi = TH.nearestWithPc(close ? rootOf(w) : (w.root == null ? (prevMidis ? prevMidis[0] % 12 : 0) : w.root), opts.anchor - 12, lo);
    const fifthMidi = TH.nearestWithPc(((w.root == null ? 0 : w.root) + 7) % 12, rootMidi, lo);
    const bassNote = i % 2 === 0 ? rootMidi : fifthMidi;
    const chord = close ? closeChord(rootMidi, w, opts) : fitSpan(chordOf(prevMidis, w, opts.anchor, opts.count), opts.maxSpan);
    const half = R.div(R.sub(w.w1, w.w0), R.make(2, 1));
    events.push({ at: w.w0, dur: half, midis: [bassNote] });
    if (i % 2 === 1) events.push({ at: R.add(w.w0, half), dur: half, midis: close ? chord : fitSpan(chord, opts.maxSpan) });
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
  const close = closeStride(opts), lo = strideLo(opts);
  let bass = null; /* the measure's bass note (close geometry: every chord of the measure is voiced just above it) */
  windows.forEach((w, i) => {
    if (close) {
      if (i === 0 || bass == null) bass = TH.nearestWithPc(rootOf(w), opts.anchor - 12, lo);
      const chord = closeChord(bass, w, opts);
      events.push({ at: w.w0, dur: R.sub(w.w1, w.w0), midis: i === 0 ? [bass] : chord });
      prevMidis = chord;
      return;
    }
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
