/* ============================================================================
   PPP Arrangement Planner — real reference bands from G6's own corpus (docs/GOALS/G07B §3)

   G7b needs a plan-level way to ask "is this budget consistent with G6's difficulty scale"
   WITHOUT notes existing yet (design doc §3). Inverting G6's trained weighted-sum ranker
   (difficulty/model.js scoreOf) to get a feature ceiling does not work: every feature's
   z-score can be NEGATIVE (below the corpus mean), and weights are non-negative, so a
   partial sum over a few features is not a sound lower bound on the full score - a piece
   that is complex in the features this module can check could still land at a LOWER
   overall score than a simpler-looking one, if it is unusually plain in every feature this
   module cannot check (rhythm, syncopation, fingering cost - all note-level, all deferred
   to G8, see arrangement/plan.js's header). Investigated and rejected before writing any
   search code, per §3's instruction.

   What IS sound and real: `difficulty/tools/dataset/method-books.json` already has the
   REAL per-piece feature vectors (notesPerBeatRH/LH, chordLoad, range, keyLoad, ...) for
   every piece `difficulty/weights/g6a-v1.json`'s anchors were trained from. Grouping those
   real feature vectors by the SAME book/stage the anchors already use gives a real,
   evidence-based ceiling ("real method-book pieces at this stage don't exceed X") with no
   model inversion needed - an empirical band, not a derived one.

   bandsForStage(stage) -> { n, notesPerBeatRH: {p50,p90,max}, notesPerBeatLH, chordLoad,
   range, keyLoad, densityRH, densityLH }, percentiles over the real per-piece feature
   vectors of every anchor piece in that stage.

   Stage 4 (czerny299, "Upper intermediate") has ZERO anchors - not a bug here, confirmed
   directly (`node -e` count below): G6's own training excluded czerny299 from its anchor
   set entirely (the same licence-quarantine G7a's §4 found for czerny299's chord symbols,
   and the "missing 4th fold" gap already on record from G6). `bandsForStage(4)` returns
   stage 3's real band with `extrapolated: true` - the closest REAL reference available,
   not a stage-4 measurement (there isn't one). Every caller must check `extrapolated`
   before treating a stage-4 result as a real stage-4 number.
   ========================================================================== */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory(require('path'));
  else { const M = root.PPPArrangementModules = root.PPPArrangementModules || {}; M.reference = factory(null); }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (path) {
  'use strict';

  const BAND_KEYS = ['notesPerBeatRH', 'notesPerBeatLH', 'chordLoad', 'range', 'keyLoad', 'densityRH', 'densityLH'];

  function pct(vals, p) {
    const s = vals.slice().sort((a, b) => a - b);
    if (!s.length) return 0;
    return s[Math.min(s.length - 1, Math.floor(s.length * p))];
  }

  function summarize(featureRows) {
    const out = { n: featureRows.length };
    BAND_KEYS.forEach(k => {
      const vals = featureRows.map(f => (f[k] == null ? 0 : f[k]));
      out[k] = { p50: pct(vals, 0.5), p90: pct(vals, 0.9), max: vals.length ? Math.max.apply(null, vals) : 0 };
    });
    return out;
  }

  /* Loads difficulty's own real weights + dataset (Node-only; both are plain JSON already
     committed to the repo, the same files difficulty/tools/train.js produced and
     difficulty/model.js reads). Throws if either is missing rather than guessing. */
  function load(opts) {
    opts = opts || {};
    const weights = opts.weights || require('../difficulty/weights/g6a-v1.json');
    const dataset = opts.dataset || require('../difficulty/tools/dataset/method-books.json');
    const byKey = new Map(dataset.records.map(r => [r.book + '#' + r.no, r]));
    const stageOfBook = {};
    Object.keys(weights.stages).forEach(s => { stageOfBook[weights.stages[s].book] = Number(s); });
    const stages = Object.keys(weights.stages).map(Number).sort((a, b) => a - b);
    const byStage = {};
    stages.forEach(s => { byStage[s] = []; });
    weights.anchors.forEach(a => {
      const stage = stageOfBook[a.book];
      const rec = byKey.get(a.book + '#' + a.no);
      if (stage == null || !rec) return;
      byStage[stage].push(rec.features);
    });
    const bands = {};
    stages.forEach(s => {
      if (byStage[s].length) { bands[s] = Object.assign({ extrapolated: false, stage: s }, summarize(byStage[s])); return; }
      /* No real anchors at this stage (czerny299/stage 4, see header): fall back to the
         nearest EASIER stage that does have real anchors, and say so explicitly. */
      let fallback = null;
      for (let t = s - 1; t >= stages[0]; t--) { if (bands[t]) { fallback = t; break; } }
      if (fallback == null) for (let t = s + 1; t <= stages[stages.length - 1]; t++) { if (byStage[t] && byStage[t].length) { fallback = t; break; } }
      bands[s] = fallback == null
        ? Object.assign({ extrapolated: true, stage: s, fallbackStage: null }, summarize([]))
        : Object.assign({}, bands[fallback], { extrapolated: true, stage: s, fallbackStage: fallback });
    });
    const stageNums = stages;
    function stageForPosition(position) {
      let stage = stageNums[0];
      stageNums.forEach(s => { if (position >= s) stage = s; });
      return stage;
    }
    return Object.freeze({ weights: weights, stages: stageNums, bands: bands, stageForBook: stageOfBook, stageForPosition: stageForPosition });
  }

  let cached = null;
  function ref(opts) {
    if (opts) return load(opts); /* explicit opts: never cache (tests use synthetic weights/datasets) */
    if (!cached) cached = load();
    return cached;
  }

  function bandsForStage(stage, opts) {
    return ref(opts).bands[stage] || null;
  }

  function stageForPosition(position, opts) {
    return ref(opts).stageForPosition(position);
  }

  return Object.freeze({ BAND_KEYS, load, ref, bandsForStage, stageForPosition });
});
