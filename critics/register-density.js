/* ============================================================================
   PPP Critics — register and density, against G7b's real per-stage bands
   (docs/GOALS/G09_CANDIDATES_CRITICS_REPAIR.md §4: "the same bands G8a's tuning already
   uses, including their disclosed max-ceiling circularity caveat").

   `arrangement/reference.js`'s `bandsForStage(stage)` (real percentile bands over G6's own
   training corpus, read-only - not modified here) exposes exactly the feature names
   `difficulty/features.js`'s `featuresOf(graph).piece` already computes for a REALIZED
   ScoreGraph: notesPerBeatRH/LH, chordLoad, range, keyLoad, densityRH/LH
   (`arrangement/reference.js`'s own `BAND_KEYS`). This critic is a NEW, independent check
   on top of what G7b's `arrangement/plan.js` already does at plan time (`planSection`'s
   own `densityOk`): the plan-time check runs on the RETAINED VOICES' notes before any
   accompaniment is generated (an approximation, `extraKeysPerBeat`'s own header calls it
   "not the identical computation... close enough... not claimed to be bit-identical");
   this critic runs difficulty/features.js's real, precise computation on the REALIZED
   candidate's ACTUAL notes - the generated accompaniment (`realize/patterns.js`) can, and
   in G8a's own tuning record did, measurably change real density independent of what the
   plan approved (docs/GOALS/G08 §14's whole density-policy tuning section). Genuinely
   different information from G7b's plan-time gate, not a repeat of it.

   Ceiling convention matches `arrangement/plan.js`'s own precedent exactly (its own
   comment, reused verbatim here): a p90 ceiling for the three continuous features that
   are close to zero for many real pieces would reject almost anything real, so those use
   the real MAX instead - `chordLoad` and `keyLoad`. `notesPerBeatRH/LH`, `range`,
   `densityRH/LH` use p90 (real method-book pieces occasionally exceed their own stage's
   typical range without that being a genuine outlier - the same reasoning plan.js's
   header gives for using p90 rather than max on these).

   registerDensity(graph, stage, opts) -> { overage, detail, band }
     overage   sum of each feature's relative overage past its real ceiling
               (max(0, (value-ceiling)/ceiling), 0 when the feature already had a real
               ceiling of 0 and the candidate does too) - 0 means every feature is within
               what a real method-book piece at this stage has actually done.
     detail    per-feature {value, ceiling, over}, for the selection explanation.
     band      {stage, extrapolated} from `bandsForStage`, or null if G6's real reference
               data has no per-stage bands at all (Node-only `require()` unavailable to a
               browser caller with no `opts.reference` supplied - `realize/index.js`'s own
               `densityBand` has the identical try/catch fallback, for the identical
               reason, G8b's own fix note). */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('../difficulty/index.js'), require('../arrangement/reference.js'));
  } else {
    const DF = root.PPPDifficultyModules || {};
    const AR = root.PPPArrangementModules || {};
    const M = root.PPPCriticsModules = root.PPPCriticsModules || {};
    M.registerDensity = factory(root.PPPDifficulty || DF, AR.reference);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (DIFF, REF) {
  'use strict';

  /* p90 ceiling: continuous features where many real pieces sit well under a stage's
     typical value without that being unusual. max ceiling: spike features where the
     large majority of real pieces at lower stages are exactly 0 (a p90 of 0 would reject
     any real occurrence at all) - arrangement/plan.js's own densityOk comment, verbatim
     reasoning applied to the same two feature groups. */
  const P90_KEYS = ['notesPerBeatRH', 'notesPerBeatLH', 'range', 'densityRH', 'densityLH'];
  const MAX_KEYS = ['chordLoad', 'keyLoad'];

  function densityBand(stage, referenceOpts) {
    try { return REF.bandsForStage(stage, referenceOpts); } catch (e) { return null; }
  }

  function overageOf(value, ceiling) {
    if (ceiling > 0) return Math.max(0, (value - ceiling) / ceiling);
    return value > 0 ? 1 : 0; /* a real ceiling of exactly 0 and any real occurrence at all */
  }

  function registerDensity(graph, stage, opts) {
    opts = opts || {};
    const band = densityBand(stage, opts.reference);
    if (!band) return { overage: 0, detail: null, band: null };
    const feats = DIFF.features.featuresOf(graph, opts.featuresOpts).piece;
    const detail = {};
    let overage = 0;
    P90_KEYS.forEach(k => {
      const ceiling = band[k] ? band[k].p90 : 0;
      const over = overageOf(feats[k], ceiling);
      detail[k] = { value: feats[k], ceiling: ceiling, over: over };
      overage += over;
    });
    MAX_KEYS.forEach(k => {
      const ceiling = band[k] ? band[k].max : 0;
      const over = overageOf(feats[k], ceiling);
      detail[k] = { value: feats[k], ceiling: ceiling, over: over };
      overage += over;
    });
    return { overage: overage, detail: detail, band: { stage: band.stage, extrapolated: band.extrapolated } };
  }

  return Object.freeze({ P90_KEYS, MAX_KEYS, densityBand, overageOf, registerDensity });
});
