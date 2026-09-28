/* ============================================================================
   PPP Arrangement Realizer — the pattern library (G8a, design doc §6a)

   Each pattern is a pure function (windows, opts) -> [{w0, w1, midis: [midi,...]}] covering
   the section's full beat range with no gaps (an empty `midis` array is a rest). `windows` is
   the section's real per-beat harmony (songgraph/harmony.js's harmonyOf, one fit per notated
   beat - G7a real data, not invented). `opts`: {n (target simultaneous notes, from the plan's
   own real voicing.maxNotesPerHand for this hand), center (register target midi, from the
   plan's own registerRH/LH), profile (G5 hand-reach profile), prevMidis (carries voice
   leading across a section boundary)}.

   Read arrange_score.py's `_texture()` (lines 642-733) once before writing this, per the
   design doc's own instruction (§4, §13): its `ballad` branch's arpeggiation-index idea
   (bass + ascending voicing + a partial descent back through the inner tones) and its `pop`
   branch's alternating root/fifth bass are real, informal prior art worth the SAME MUSICAL
   IDEA, independently written here against THIS module's own voice-led tone set (never its
   code, its wire-JSON shape, or its crude simultaneous-note cap - `_finalize_notes` has no
   G5 reach-table awareness at all, voicing.js's clampToReach does).

   'hymn' and 'block' are the SAME function (aliased, not duplicated): nothing in G7a's real
   output (a harmony fit per notated beat - the same granularity every pattern here reads)
   distinguishes a hymn's chorale rhythm from a generic block-chord accompaniment; inventing
   an artificial difference between them would be exactly the "a pattern the input data can't
   actually drive" the design doc's own instructions warn against (G7b's texture.js made the
   identical honest call about 'style' at the plan level). Documented here, not hidden. */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('../scoregraph/rational.js'), require('./voicing.js'));
  } else {
    const SG = root.PPPScoreGraphModules || {};
    const M = root.PPPArrangementModules = root.PPPArrangementModules || {};
    M.patterns = factory(SG.rational, M.voicing);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (R, V) {
  'use strict';

  const STYLES = ['block', 'hymn', 'broken', 'ballad', 'pop', 'waltz'];

  /* n (1-4, the plan's own real per-hand note budget) -> a power-of-two subdivision count, so
     every sub-beat length this module ever asks voicing.wToDisplay to print is a plain value
     (never a tuplet - see voicing.js's header). */
  function subdivisionsFor(n) { return n <= 1 ? 1 : n === 2 ? 2 : 4; }

  function voiceLeadWindow(win, n, prevMidis, center, profile) {
    const pcs = V.chordTones(win, n);
    if (!pcs) return { midis: [], prevMidis: prevMidis }; /* a real silent window (no harmony content) - a rest, not an invention */
    const midis = V.clampToReach(V.voiceLead(pcs, prevMidis, center), profile, center);
    return { midis: midis, prevMidis: midis };
  }

  /* One full voice-led chord per notated beat, held for the whole beat. Used by 'block' and,
     aliased, 'hymn' (see header). */
  function blockPattern(windows, opts) {
    let prev = opts.prevMidis || null;
    return windows.map(w => {
      const r = voiceLeadWindow(w, opts.n, prev, opts.center, opts.profile);
      prev = r.prevMidis;
      return { w0: w.w0, w1: w.w1, midis: r.midis };
    });
  }

  /* Alberti-style broken chord: the beat's own chord tones cycled low-high-mid-high (a
     generalization of the classic 3-note Alberti shape to however many tones `n` gives),
     across a power-of-two subdivision of the beat. n<2 has nothing to arpeggiate and falls
     back to blockPattern (disclosed, not silently identical by accident). */
  function brokenPattern(windows, opts) {
    if (opts.n < 2) return blockPattern(windows, opts);
    let prev = opts.prevMidis || null;
    const out = [];
    windows.forEach(w => {
      const pcs = V.chordTones(w, opts.n);
      if (!pcs) { out.push({ w0: w.w0, w1: w.w1, midis: [] }); return; }
      const voiced = V.clampToReach(V.voiceLead(pcs, prev, opts.center), opts.profile, opts.center).slice().sort((a, b) => a - b);
      prev = voiced;
      const k = subdivisionsFor(voiced.length);
      const order = voiced.length >= 3 ? [0, voiced.length - 1, 1, voiced.length - 1] : [0, voiced.length - 1];
      V.subdivide(w.w0, w.w1, k).forEach((sw, i) => out.push({ w0: sw.w0, w1: sw.w1, midis: [voiced[order[i % order.length] % voiced.length]] }));
    });
    return out;
  }

  /* AccoMontage-style ballad arpeggio (same musical idea as arrange_score.py's ballad branch,
     independently written): an ascending sweep through the beat's voice-led tones, then a
     partial descent back through the inner tones before the next beat's chord change - the
     "arpeggiation index" shape, over this module's own tones. n<2 falls back to blockPattern. */
  function balladPattern(windows, opts) {
    if (opts.n < 2) return blockPattern(windows, opts);
    let prev = opts.prevMidis || null;
    const out = [];
    windows.forEach(w => {
      const pcs = V.chordTones(w, opts.n);
      if (!pcs) { out.push({ w0: w.w0, w1: w.w1, midis: [] }); return; }
      const voiced = V.clampToReach(V.voiceLead(pcs, prev, opts.center), opts.profile, opts.center).slice().sort((a, b) => a - b);
      prev = voiced;
      const sweep = voiced.concat(voiced.slice(1, -1).reverse());
      const k = subdivisionsFor(voiced.length);
      V.subdivide(w.w0, w.w1, k).forEach((sw, i) => out.push({ w0: sw.w0, w1: sw.w1, midis: [sweep[i % sweep.length]] }));
    });
    return out;
  }

  /* Pop comping (same musical idea as arrange_score.py's pop branch, independently written):
     the bass alternates root/fifth beat to beat; with n>=2 a light chord stab fills the
     second half of every other beat from the remaining voice-led tones. */
  function popPattern(windows, opts) {
    let prev = opts.prevMidis || null;
    const out = [];
    windows.forEach((w, i) => {
      const pcs = V.chordTones(w, Math.max(opts.n, 2));
      if (!pcs) { out.push({ w0: w.w0, w1: w.w1, midis: [] }); return; }
      const voiced = V.clampToReach(V.voiceLead(pcs, prev, opts.center), opts.profile, opts.center).slice().sort((a, b) => a - b);
      prev = voiced;
      const bassMidi = (i % 2 === 0) ? voiced[0] : (voiced[1] !== undefined ? voiced[1] : voiced[0]);
      if (opts.n <= 1) { out.push({ w0: w.w0, w1: w.w1, midis: [bassMidi] }); return; }
      const halves = V.subdivide(w.w0, w.w1, 2);
      out.push({ w0: halves[0].w0, w1: halves[0].w1, midis: [bassMidi] });
      const stabTones = V.clampToReach(voiced.slice(0, opts.n), opts.profile, opts.center);
      out.push({ w0: halves[1].w0, w1: halves[1].w1, midis: i % 2 === 1 ? stabTones : [] });
    });
    return out;
  }

  /* Waltz "oom-pah": the measure's first beat plays the bass root alone; every later beat in
     the SAME measure plays the upper chord tones (no bass) - generalized to however many
     beats the measure actually has (arrange_score.py's own waltz branch forces exactly 3
     pulses even in a non-triple metre, which this deliberately does NOT do - see patterns.js
     header / the doc's implementation record). `windows` must carry a real `.m` (measure id)
     per window (harmonyOf's own output field) so "first beat of the measure" is known here
     without re-deriving it. */
  function waltzPattern(windows, opts) {
    let prev = opts.prevMidis || null;
    const out = [];
    let lastM = null;
    windows.forEach(w => {
      const firstOfMeasure = w.m !== lastM;
      lastM = w.m;
      const pcs = V.chordTones(w, Math.max(opts.n, 1));
      if (!pcs) { out.push({ w0: w.w0, w1: w.w1, midis: [] }); return; }
      const voiced = V.clampToReach(V.voiceLead(pcs, prev, opts.center), opts.profile, opts.center).slice().sort((a, b) => a - b);
      prev = voiced;
      if (firstOfMeasure || opts.n <= 1) out.push({ w0: w.w0, w1: w.w1, midis: [voiced[0]] });
      else out.push({ w0: w.w0, w1: w.w1, midis: voiced.slice(1) });
    });
    return out;
  }

  const REGISTRY = Object.freeze({
    block: blockPattern, hymn: blockPattern, broken: brokenPattern, ballad: balladPattern, pop: popPattern, waltz: waltzPattern
  });

  function realizeStyle(style, windows, opts) {
    const fn = REGISTRY[style] || REGISTRY.block;
    return fn(windows, opts);
  }

  return Object.freeze({ STYLES, REGISTRY, realizeStyle, subdivisionsFor });
});
