/* ============================================================================
   PPP Arrangement Realizer — pattern library (docs/GOALS/G08_ARRANGEMENT_REALIZATION.md §6a)

   NAMING NOTE (found 2026-09-28): this file was originally written as `arrangement/patterns.js`
   but a second, concurrent writer in this same worktree (D:/PPP-g8) independently built its own,
   different pattern-library module under that same filename (and `arrangement/voicing.js`,
   `arrangement/spell.js`, a scratch `realize/` directory) while this file was being written -
   the project's own memory note on parallel sessions ("goal worktrees can have a second writer
   even when told 'only writer'") describes exactly this. Renamed here to avoid overwriting that
   other in-progress work; both implementations exist on disk until a Lead reconciles them. See
   this Goal's PR / final report for the full account.

   Six named patterns, read once from `arrange_score.py`'s `_texture()` (lines 642-733) for
   prior art (the ballad style's up-and-back arpeggio index, the pop style's alternating
   root/fifth-ish bass) and then designed fresh against what this codebase's own real modules
   provide: a real per-beat-window harmony fit (songgraph/harmony.js), a real per-section
   texture tier and register (arrangement/plan.js's ArrangementPlan), and real chord-tone voice
   leading (arrangement/voicelead.js) - none of arrange_score.py's code, wire-JSON shape or
   crude simultaneous-note cap is reused (docs/GOALS/G08 §5/§13).

   Every pattern is a function (windows, ctx) -> [{w0, w1, midis: [midi, ...]}], absolute
   ScorePos Rats (the same w0/w1 unit songgraph/util.js's beatGrid/noteWindows use), one entry
   per real attack the pattern wants to place. A window with root === null (no sounding harmony
   - songgraph/harmony.js never guesses one) produces no event: a real silence stays silent,
   never papered over with an invented chord.

   ctx: { QUALITIES (songgraph/harmony.js's), chordSize (1..3, from the caller's texture-tier
   mapping), seed (a real register midpoint to start a fresh voicing near - arrangement/
   g8a-realize.js derives it from the plan's own registerLH), maxSpan (the request's real
   hand-profile MAX_SPAN, so a generated chord never asks voicelead to exceed what the SAME hand
   profile G7b already checked), register: {lo, hi}, state (mutable, THREADED ACROSS THE WHOLE
   PIECE by g8a-realize.js so voice leading carries continuity across a section boundary, not
   just within one) }.
   ========================================================================== */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory(require('../scoregraph/rational.js'), require('./voicelead.js'));
  else {
    const SG = root.PPPScoreGraphModules || {};
    const M = root.PPPArrangementModules = root.PPPArrangementModules || {};
    M.accompaniment = factory(SG.rational, M.voicelead);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (R, VL) {
  'use strict';

  function ivOf(ctx, w) {
    const q = (ctx.QUALITIES || []).find(x => x.name === w.quality);
    return q ? q.iv : [0, 4, 7];
  }

  function split(w0, w1, n) {
    const step = R.mul(R.sub(w1, w0), R.make(1, n));
    const out = [];
    let at = w0;
    for (let i = 0; i < n; i++) { const next = i === n - 1 ? w1 : R.add(at, step); out.push([at, next]); at = next; }
    return out;
  }

  function chordVoicing(ctx, w, size) {
    const iv = ivOf(ctx, w);
    const pcs = VL.chordTones(w.root, iv, size);
    const opts = { seed: ctx.seed, register: ctx.register, maxSpan: ctx.maxSpan };
    const v = VL.voiceGroup(ctx.state.prevChord, pcs, opts);
    ctx.state.prevChord = v;
    return v;
  }

  function bassNote(ctx, w) {
    const v = VL.voiceGroup(ctx.state.prevBass, [w.root], { seed: ctx.seed, register: ctx.register, maxSpan: ctx.maxSpan });
    ctx.state.prevBass = v;
    return v[0];
  }

  /* block chords: one full-window chord attack per beat window. The simplest, safest pattern
     (fewest attacks -> least VELOCITY risk) and the natural default. */
  function block(windows, ctx) {
    const out = [];
    windows.forEach(w => {
      if (w.root == null) return;
      out.push({ w0: w.w0, w1: w.w1, midis: chordVoicing(ctx, w, ctx.chordSize) });
    });
    return out;
  }

  /* broken chords / Alberti: the SAME held chord shape as `block`, played one note at a time in
     the classic bottom-top-middle-top order (arrange_score.py's `_texture` prior art, redesigned
     against a real voiced chord rather than a fixed voicing list). A 1-note chord (reduced
     texture) degenerates to a plain repeated bass note - still a real, if simple, pattern. */
  function broken(windows, ctx) {
    const out = [];
    windows.forEach(w => {
      if (w.root == null) return;
      const v = chordVoicing(ctx, w, Math.max(ctx.chordSize, 1));
      const seq = v.length >= 3 ? [0, 2, 1, 2] : v.length === 2 ? [0, 1, 0, 1] : [0, 0, 0, 0];
      split(w.w0, w.w1, seq.length).forEach(([a, b], i) => out.push({ w0: a, w1: b, midis: [v[seq[i]]] }));
    });
    return out;
  }

  /* ballad arpeggio: an up-and-back sweep through the chord's own voiced tones (the
     arpeggiation-index idea in arrange_score.py's `ballad` branch, re-derived from a real voiced
     chord: `sequence = bass, ...up, ...back down` rather than a fixed tuple). */
  function ballad(windows, ctx) {
    const out = [];
    windows.forEach(w => {
      if (w.root == null) return;
      const v = chordVoicing(ctx, w, Math.max(ctx.chordSize, 2));
      const seq = v.concat(v.slice(1, -1).reverse());
      split(w.w0, w.w1, 4).forEach(([a, b], i) => out.push({ w0: a, w1: b, midis: [seq[i % seq.length]] }));
    });
    return out;
  }

  /* simple pop comping: a single bass note on the first half of the beat, a short chord stab on
     the second half (arrange_score.py's `pop` branch's alternating-bass-plus-chord idea, without
     its hard-coded density table). */
  function pop(windows, ctx) {
    const out = [];
    windows.forEach(w => {
      if (w.root == null) return;
      const mid = R.add(w.w0, R.mul(R.sub(w.w1, w.w0), R.make(1, 2)));
      out.push({ w0: w.w0, w1: mid, midis: [bassNote(ctx, w)] });
      out.push({ w0: mid, w1: w.w1, midis: chordVoicing(ctx, w, ctx.chordSize) });
    });
    return out;
  }

  /* waltz: bass alone on a measure's first beat, chord on every other beat of that measure - the
     "oom-pah-pah" shape, generalized to whatever the real meter's own beatGrid gives (a genuine
     3/4 gets the classic three-in-a-bar; another meter gets the same bass-then-chord idea over
     its own real beat count, rather than arrange_score.py's own meter-ignoring 3-way split). */
  function waltz(windows, ctx) {
    const out = [];
    windows.forEach(w => {
      if (w.root == null) return;
      if (w.beat === 0) out.push({ w0: w.w0, w1: w.w1, midis: [bassNote(ctx, w)] });
      else out.push({ w0: w.w0, w1: w.w1, midis: chordVoicing(ctx, w, ctx.chordSize) });
    });
    return out;
  }

  const STYLES = Object.freeze({ block, broken, ballad, pop, waltz });
  return Object.freeze({ STYLES, ivOf, split, chordVoicing, bassNote });
});
