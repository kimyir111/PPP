/* ============================================================================
   PPP Candidates (docs/GOALS/G09_CANDIDATES_CRITICS_REPAIR.md §5, G9a) — enumerate N
   candidate arrangements from the real knobs G7b's planner and G8a's realizer already
   have, score them with `critics/index.js`, filter by G5 hard violations (a structural
   filter, never a score - G9 §2), and select one survivor with a human-readable
   explanation. Node-only, not loaded by the app (per G9 §10).

   ---- the enumerable product (no new generation machinery, G9 §4) ----
   The two real knobs this module composes, unmodified:
     - `arrangement/index.js`'s `planner.plan(g, sg, request)`: for a FIXED targetLevel and
       handProfile, `plan()` greedily walks its own full/partial/reduced texture ladder
       (arrangement/texture.js) and returns the first reachable rung - one plan per call,
       not several. Texture-ladder variety therefore comes from varying handProfile (a
       smaller hand profile's tighter MAX_SPAN can only reach a lower rung than a larger
       profile reaches for the SAME piece - a real, not invented, way this existing knob
       produces different textures), never from re-implementing plan.js's own ladder walk.
     - `realize/index.js`'s `realize(g, sg, plan, opts)`: `opts.pattern` is one of
       PATTERN_NAMES (hymn/block/broken/ballad/pop/waltz) or 'auto' - 7 real values.
   The request's OWN handProfile (what the request actually asked for) is always the
   primary axis, walked across every one of the 7 pattern values first (in
   `realize/index.js`'s own PATTERN_NAMES order, 'auto' first); only once those are
   exhausted does enumeration reach into the OTHER hand profiles (`playability/reach.js`'s
   own PROFILES order), each tried once at `opts.pattern:'auto'` (the natural per-profile
   default) - a real, but secondary, source of texture variety, appended rather than
   interleaved so the request's own stated hand size is always favoured first. This is a
   fixed, request/graph-independent ORDER (`SPEC_ORDER` below) - determinism (G9 §6,
   "same request + same SongGraph -> same candidate set, same order") follows directly
   from walking it in the same order every time and never using Math.random/Date.now
   anywhere in this module or the two it composes.

   Fewer than N candidates can legitimately result (a request's own hand profile may only
   have 5 of the 7 patterns realize successfully, e.g.) - reported honestly in `tried`, not
   padded or hidden.

   ---- selection (G9 §4, §6) ----
   `select()` turns each surviving candidate's seven raw critic numbers into one
   dimensionless "badness" (0 = perfect on that critic) per DEFAULT_WEIGHTS, sums them,
   and picks the minimum, breaking ties by the fixed enumeration index (never by anything
   candidate-content-dependent, so a real tie is still deterministic). `explain()` reports
   which critics separated the winner from the runner-up, in human-readable terms, per G9
   §5's "select one survivor with a human-readable explanation naming which critics
   decided it."

   `run(g, sg, request, opts)` does enumerate -> score -> select in one call - the entry
   point `realize/tools/harness.js`'s own G9a comparison mode and this module's own tests
   use. `opts`: `n` (default 8), `weights` (critic weight overrides, for ablations - see
   `tests/critics/ablation.test.js`), `reference` (G6 reference-data override, threaded to
   `critics/register-density.js` exactly as `realize/index.js`'s own `opts.reference`
   already is - the same G8b browser-`require()` fix, reused here rather than
   reinvented), `cache` (a Map, see CACHING below; omit for a fresh, uncached run). */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(
      require('../arrangement/index.js'), require('../realize/index.js'), require('../critics/index.js'),
      require('../playability/reach.js'), require('../arrangement/reference.js'), require('../scoregraph/serialize.js'));
  } else {
    const AR = root.PPPArrangementModules || {};
    const PP = root.PPPPlayabilityModules || {};
    const M = root.PPPRealizeModules || {};
    const SG = root.PPPScoreGraphModules || {};
    root.PPPCandidates = factory(root.PPPArrangement, root.PPPRealize, root.PPPCritics, PP.reach, AR.reference, SG.serialize);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (ARR, REALIZE, CRIT, REACH, REF, SER) {
  'use strict';

  const PATTERNS = ['auto'].concat(REALIZE.PATTERN_NAMES); /* auto, hymn, block, broken, ballad, pop, waltz */

  /* ---- deterministic enumeration order (see header) ---- */
  function specOrder(request) {
    const primary = request.handProfile;
    const specs = PATTERNS.map(p => ({ handProfile: primary, pattern: p }));
    REACH.PROFILES.forEach(p => { if (p !== primary) specs.push({ handProfile: p, pattern: 'auto' }); });
    return specs;
  }

  function specKey(spec) { return spec.handProfile + ':' + spec.pattern; }

  /* One plan per handProfile (cached across the pattern loop - plan() does not depend on
     opts.pattern at all, so calling it 7 times for the primary profile's 7 pattern specs
     would be wasted, real, deterministic work, never a correctness issue either way). */
  function enumerate(g, sg, request, opts) {
    opts = opts || {};
    const n = opts.n == null ? 8 : opts.n;
    const specs = specOrder(request);
    const planCache = new Map();
    const seenFingerprints = new Set();
    const candidates = [];
    const tried = [];
    for (let i = 0; i < specs.length && candidates.length < n; i++) {
      const spec = specs[i];
      let planResult = planCache.get(spec.handProfile);
      if (planResult === undefined) {
        planResult = ARR.planner.plan(g, sg, Object.assign({}, request, { handProfile: spec.handProfile }), opts.planOpts);
        planCache.set(spec.handProfile, planResult);
      }
      if (!planResult.ok) { tried.push({ spec: spec, ok: false, stage: 'plan', reason: planResult.reason }); continue; }
      const realized = REALIZE.realize(g, sg, planResult.plan, { pattern: spec.pattern, reference: opts.reference });
      if (!realized.ok) { tried.push({ spec: spec, ok: false, stage: 'realize', reason: realized.reason }); continue; }
      const fp = SER.fingerprint(realized.graph);
      if (seenFingerprints.has(fp)) { tried.push({ spec: spec, ok: false, stage: 'dedup', reason: 'DUPLICATE_OF_EARLIER_CANDIDATE', fingerprint: fp }); continue; }
      seenFingerprints.add(fp);
      tried.push({ spec: spec, ok: true });
      candidates.push({ index: candidates.length, spec: spec, plan: planResult.plan, graph: realized.graph, report: realized.report, fingerprint: fp });
    }
    /* specs never reached because n was already met, or the loop ran out - both real,
       reported for transparency (G9a's central measurement needs to know, e.g., how often
       a request's own primary hand profile alone already supplies all N candidates). */
    for (let i = tried.length; i < specs.length; i++) tried.push({ spec: specs[i], ok: false, stage: 'not-tried', reason: 'N_ALREADY_MET' });
    return { candidates: candidates, tried: tried };
  }

  /* ---- scoring ---- */
  function scoreCandidates(candidates, g, sg, request, opts) {
    opts = opts || {};
    const stage = REF.stageForPosition(request.targetLevel, opts.reference);
    const melodyCache = new Map(); /* keyed by plan identity (object reference is stable - one plan per handProfile, shared across pattern variants) */
    function origMelodyOf(plan) {
      let notes = melodyCache.get(plan);
      if (!notes) { notes = CRIT.metrics.originalMelodyNotes(g, plan); melodyCache.set(plan, notes); }
      return notes;
    }
    return candidates.map(c => {
      const ctx = {
        profile: c.spec.handProfile, targetLevel: request.targetLevel, stage: stage,
        origHarmony: sg.harmony, origMelodyNotes: origMelodyOf(c.plan), reference: opts.reference,
        id: 'candidate:' + specKey(c.spec)
      };
      const ev = CRIT.evaluate(c.graph, ctx);
      return Object.assign({}, c, { scores: ev.critics, hardOk: ev.hardOk });
    });
  }

  /* ---- badness (see header): every critic normalized to ~0 (perfect) .. ~1 (bad) so a
     flat default weight of 1 each is a defensible starting point - not claimed to be a
     tuned optimum (that is exactly the kind of decision G9a's own ablations, below, are
     for making visible, not this module's job to already have made). */
  const DEFAULT_WEIGHTS = Object.freeze({ level: 1, melody: 1, harmony: 1, engrave: 1, voiceLeading: 1, registerDensity: 1 });
  const LEVEL_CAP = 3;      /* a 3-course-position miss is already "as bad as it gets" for this term */
  const ENGRAVE_CAP = 5;    /* 5 combined L1/L2 violations likewise */
  const SMELL_CAP = 10;     /* 10 combined voice-leading smells likewise */

  function badnessOf(scores, targetLevel, weights) {
    const w = Object.assign({}, DEFAULT_WEIGHTS, weights);
    const levelBad = scores.level == null ? 1 : Math.min(1, Math.abs(scores.level - targetLevel) / LEVEL_CAP);
    const melodyBad = scores.melody == null ? 0 : 1 - scores.melody;
    const harmonyBad = (scores.harmony && scores.harmony.rootQuality != null) ? 1 - scores.harmony.rootQuality : 0;
    const eg = scores.engrave;
    const engraveBad = (eg && !eg.error) ? Math.min(1, ((eg.silent || 0) + (eg.hardLayout || 0)) / ENGRAVE_CAP) : 0;
    const vl = scores.voiceLeading;
    const voiceLeadingBad = vl ? Math.min(1, vl.count / SMELL_CAP) : 0;
    const rd = scores.registerDensity;
    const registerDensityBad = rd ? Math.min(1, rd.overage) : 0;
    const parts = { level: levelBad, melody: melodyBad, harmony: harmonyBad, engrave: engraveBad, voiceLeading: voiceLeadingBad, registerDensity: registerDensityBad };
    let total = 0;
    Object.keys(parts).forEach(k => { total += (w[k] == null ? 1 : w[k]) * parts[k]; });
    return { total: total, parts: parts, weights: w };
  }

  function fmtSpec(spec) { return 'handProfile=' + spec.handProfile + ' pattern=' + spec.pattern; }

  function explain(winner, runnerUp) {
    let text = 'Selected ' + fmtSpec(winner.spec) + ' (badness ' + winner.badness.total.toFixed(3) + ').';
    if (!runnerUp) { text += ' It was the only candidate to survive the G5 hard-violation filter.'; return text; }
    text += ' Runner-up ' + fmtSpec(runnerUp.spec) + ' (badness ' + runnerUp.badness.total.toFixed(3) + ').';
    const w = winner.badness.weights;
    const diffs = Object.keys(winner.badness.parts).map(k => ({
      critic: k, delta: (w[k] == null ? 1 : w[k]) * (runnerUp.badness.parts[k] - winner.badness.parts[k])
    })).sort((a, b) => b.delta - a.delta);
    const deciders = diffs.filter(d => d.delta > 1e-9);
    text += deciders.length
      ? ' Decided by: ' + deciders.map(d => d.critic + ' (+' + d.delta.toFixed(3) + ')').join(', ') + '.'
      : ' Every critic scored identically; tie-broken by deterministic enumeration order.';
    return text;
  }

  /* Selection itself: filter (hard violations, never scored), rank the survivors by total
     badness ascending, tie-break by `index` (the fixed enumeration order - never by
     anything the candidate's own content determines, so an exact tie stays deterministic
     the same way a re-run with the same inputs would resolve it). */
  function select(scored, request, opts) {
    opts = opts || {};
    const survivors = scored.filter(c => c.hardOk);
    const discarded = scored.filter(c => !c.hardOk);
    if (!survivors.length) return { ok: false, reason: 'ALL_CANDIDATES_HAVE_HARD_VIOLATIONS', discarded: discarded };
    const ranked = survivors
      .map(c => Object.assign({}, c, { badness: badnessOf(c.scores, request.targetLevel, opts.weights) }))
      .sort((a, b) => (a.badness.total - b.badness.total) || (a.index - b.index));
    const selected = ranked[0], runnerUp = ranked[1] || null;
    return { ok: true, selected: selected, runnerUp: runnerUp, ranked: ranked, discarded: discarded, explanation: explain(selected, runnerUp) };
  }

  /* ---- caching (G9 §8/design doc §5's own performance line: "results cached by (SongGraph
     fingerprint, request)") ---- opts.cache is a plain Map the CALLER owns and keeps across
     calls (a request-scoped or process-wide cache, per the caller's own needs - this module
     imposes no eviction policy, exactly the shape a later G9e caller can wrap with its own
     LRU/TTL without this module changing). Cheap to add now (one `SER.fingerprint(g)` call
     plus a JSON key) so it is added here rather than deferred; a MISSING cache (opts.cache
     omitted) costs nothing extra - every call is already this cheap (see PERFORMANCE in
     docs/GOALS/G09 §12). */
  function cacheKey(g, request, opts) {
    return SER.fingerprint(g) + '|' + JSON.stringify(request) + '|' + (opts && opts.n != null ? opts.n : 8) +
      '|' + JSON.stringify((opts && opts.weights) || null);
  }

  function run(g, sg, request, opts) {
    opts = opts || {};
    if (opts.cache) {
      const key = cacheKey(g, request, opts);
      if (opts.cache.has(key)) return opts.cache.get(key);
      const result = runUncached(g, sg, request, opts);
      opts.cache.set(key, result);
      return result;
    }
    return runUncached(g, sg, request, opts);
  }

  function runUncached(g, sg, request, opts) {
    const enumerated = enumerate(g, sg, request, opts);
    const scored = scoreCandidates(enumerated.candidates, g, sg, request, opts);
    const selection = select(scored, request, opts);
    return Object.assign({ tried: enumerated.tried, scored: scored }, selection);
  }

  return Object.freeze({
    PATTERNS, specOrder, specKey, enumerate, scoreCandidates, badnessOf, select, explain, run,
    DEFAULT_WEIGHTS
  });
});
