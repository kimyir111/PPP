/* ============================================================================
   PPP Candidates (docs/GOALS/G09_CANDIDATES_CRITICS_REPAIR.md §5, G9a) — enumerate N
   candidate arrangements from the real knobs G7b's planner and G8a's realizer already
   have, score them with `critics/index.js`, filter by G5 hard violations (a structural
   filter, never a score - G9 §2), and select one survivor with a human-readable
   explanation. Node-only, not loaded by the app (per G9 §10).

   ---- the enumerable product (no new generation machinery, G9 §4) ----
   The three real knobs this module composes, unmodified:
     - `arrangement/index.js`'s `planner.plan(g, sg, request)`: for a FIXED targetLevel and
       handProfile, `plan()` greedily walks its own full/partial/reduced texture ladder
       (arrangement/texture.js) and returns the first reachable rung - one plan per call,
       not several. Texture-ladder variety therefore comes from varying handProfile (a
       smaller hand profile's tighter MAX_SPAN can only reach a lower rung than a larger
       profile reaches for the SAME piece - a real, not invented, way this existing knob
       produces different textures), never from re-implementing plan.js's own ladder walk.
     - `realize/index.js`'s `realize(g, sg, plan, opts)`: `opts.pattern` is one of
       PATTERN_NAMES (hymn/block/broken/ballad/pop/waltz) or 'auto' - 7 real values.
     - the PLANNING target level itself (round 2, docs/GOALS/G09 §12 "round 2"): `plan()`'s
       own `request.targetLevel` is a real knob too (§4), and round 1's central measurement
       found G8's G6-level-accuracy gap to ScoreArranger untouched by pattern/hand-profile
       variation alone. Round 2's own bias measurement (§12) found the realizer's output
       level is NOT systematically biased (mean signed error ~0 across the round-1 sample)
       but IS noisy per file (stdev ~0.82, per-file means from -1.14 to +1.24) - so this
       module plans at the request's own targetLevel PLUS a small, fixed, symmetric set of
       offsets (`LEVEL_OFFSETS_DEFAULT`, chosen from that bias measurement, see the doc) and
       lets SELECTION pick whichever offset's OUTPUT lands assessed-closest to the
       REQUESTED target - never by the internal planning target, which is not even visible
       to `badnessOf`/`select()` (see SELECTION below).
   The request's OWN handProfile (what the request actually asked for) is always the
   primary axis, walked across every one of the 7 pattern values first (in
   `realize/index.js`'s own PATTERN_NAMES order, 'auto' first); only once those are
   exhausted does enumeration reach into the OTHER hand profiles (`playability/reach.js`'s
   own PROFILES order), each tried once at `opts.pattern:'auto'` (the natural per-profile
   default) - a real, but secondary, source of texture variety, appended rather than
   interleaved so the request's own stated hand size is always favoured first. This whole
   9-spec block is then repeated once per `levelOffset` in `LEVEL_OFFSETS_DEFAULT` order
   (0 first - so round 1's exact candidate set is always a PREFIX of round 2's, never
   reordered), and every level-offset's specs use the SAME pattern/profile sub-order. This
   is a fixed, request/graph-independent ORDER (`specOrder` below) - determinism (G9 §6,
   "same request + same SongGraph -> same candidate set, same order") follows directly
   from walking it in the same order every time and never using Math.random/Date.now
   anywhere in this module or the two it composes.

   Fewer than N candidates can legitimately result (a request's own hand profile may only
   have 5 of the 7 patterns realize successfully, e.g.) - reported honestly in `tried`, not
   padded or hidden.

   ---- the engrave (G4 L2) budget gate (round 2, docs/GOALS/G09 §12 "round 2") ----
   Measured, not assumed: the `engrave` critic (`critics/metrics.js`'s `engraveMetrics`, via
   `tests/engrave/tools/bench.js`'s full layout pass) costs ~150-200ms per candidate, ~85-
   90% of one candidate's total scoring cost - the other six critics combined cost under
   30ms. Round 1's own ablation also found `engrave` has ZERO discriminative power on its
   sample (every surviving candidate reads 0/0). `run()`'s production pipeline therefore
   scores every enumerated candidate on the six CHEAP critics first
   (`scoreCandidates(..., {skipEngrave:true})`), ranks the hard-violation-free survivors by
   that cheap badness, and computes the real, expensive `engrave` critic only for a small
   top-K of them (`opts.topKForEngrave`, default 3) - the final winner is chosen among just
   that top-K, with `engrave` now real. This is a genuine approximation (a candidate ranked
   K+1 or worse on cheap critics is never engrave-checked, so it can never win even if its
   real engrave score would have been excellent) - documented here, not hidden; K=3 was
   picked as an engineering budget choice, not tuned against any sample's numbers.

   ---- selection (G9 §4, §6) ----
   `select()` turns each surviving candidate's seven raw critic numbers into one
   dimensionless "badness" (0 = perfect on that critic) per DEFAULT_WEIGHTS, sums them,
   and picks the minimum, breaking ties by the fixed enumeration index (never by anything
   candidate-content-dependent, so a real tie is still deterministic). `explain()` reports
   which critics separated the winner from the runner-up, in human-readable terms, per G9
   §5's "select one survivor with a human-readable explanation naming which critics
   decided it."

   `opts.registerFloor` (post-H-8) is threaded to `realize()` and the register-floor critic (default
   realize/theory.js REGISTER_FLOOR = 40; `null` = the pre-floor behaviour).

   `run(g, sg, request, opts)` does enumerate -> score -> select in one call - the entry
   point `realize/tools/harness.js`'s own G9a comparison mode and this module's own tests
   use. `opts`: `n` (default 8), `weights` (critic weight overrides, for ablations - see
   `tests/critics/candidates-gate.test.js`), `reference` (G6 reference-data override, threaded to
   `critics/register-density.js` exactly as `realize/index.js`'s own `opts.reference`
   already is - the same G8b browser-`require()` fix, reused here rather than
   reinvented), `cache` (a Map, see CACHING below; omit for a fresh, uncached run), `engraveCache` (a Map,
   keyed by candidate fingerprint, that lets repeated gate calls over the same pool reuse a
   real engrave result instead of recomputing it - the gate never mutates the caller's
   scored candidates). */
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

  /* Round 2 (docs/GOALS/G09 §12): offsets on G6's real position scale, chosen from the
     round-2 bias measurement on the round-1 16-file sample (mean signed error ~0.008,
     stdev ~0.82) BEFORE looking at any held-out numbers - symmetric because the bias is
     noise, not a consistent direction, so bracketing 0 (rather than only going one way)
     is what the measurement actually supports. 0 is always tried first (see specOrder). */
  const LEVEL_OFFSETS_DEFAULT = Object.freeze([0, -1, 1]);
  const TOP_K_FOR_ENGRAVE_DEFAULT = 3; /* an engineering budget choice, not tuned to any sample - see header */

  /* ---- deterministic enumeration order (see header) ---- */
  function patternProfileSpecs(request) {
    const primary = request.handProfile;
    const specs = PATTERNS.map(p => ({ handProfile: primary, pattern: p }));
    REACH.PROFILES.forEach(p => { if (p !== primary) specs.push({ handProfile: p, pattern: 'auto' }); });
    return specs;
  }

  function specOrder(request, opts) {
    const offsets = (opts && opts.levelOffsets) || LEVEL_OFFSETS_DEFAULT;
    const base = patternProfileSpecs(request);
    const out = [];
    offsets.forEach(off => base.forEach(s => out.push(Object.assign({ levelOffset: off }, s))));
    return out;
  }

  function specKey(spec) { return spec.handProfile + ':' + spec.pattern + '@' + (spec.levelOffset || 0); }

  /* One plan per (handProfile, planTargetLevel) pair (cached across the pattern loop -
     plan() does not depend on opts.pattern at all). `request.targetLevel` (the REQUESTED
     target) is NEVER itself modified here - only the argument `plan()` is called with
     (`planTargetLevel`) varies; every candidate object still carries the caller's original
     `request` for scoring, plus its own real `planTargetLevel` for transparency/reporting
     only (round 2 §12: "select by how close the output's ASSESSED level is to the
     REQUESTED target - never the internal planning target" - scoreCandidates/badnessOf
     below never read `planTargetLevel`, only `request.targetLevel` and the candidate's own
     OUTPUT `scores.level`, so this structurally cannot leak the planning target into
     selection). */
  function enumerate(g, sg, request, opts) {
    opts = opts || {};
    const n = opts.n == null ? 24 : opts.n;
    const specs = specOrder(request, opts);
    const planCache = new Map();
    const seenFingerprints = new Set();
    const candidates = [];
    const tried = [];
    for (let i = 0; i < specs.length && candidates.length < n; i++) {
      const spec = specs[i];
      const planTargetLevel = request.targetLevel + (spec.levelOffset || 0);
      const planCacheKey = spec.handProfile + '@' + planTargetLevel;
      let planResult = planCache.get(planCacheKey);
      if (planResult === undefined) {
        planResult = ARR.planner.plan(g, sg, Object.assign({}, request, { handProfile: spec.handProfile, targetLevel: planTargetLevel }), opts.planOpts);
        planCache.set(planCacheKey, planResult);
      }
      if (!planResult.ok) { tried.push({ spec: spec, ok: false, stage: 'plan', reason: planResult.reason }); continue; }
      const realized = REALIZE.realize(g, sg, planResult.plan, { pattern: spec.pattern, reference: opts.reference, registerFloor: opts.registerFloor, stride: opts.stride });
      if (!realized.ok) { tried.push({ spec: spec, ok: false, stage: 'realize', reason: realized.reason }); continue; }
      const fp = SER.fingerprint(realized.graph);
      if (seenFingerprints.has(fp)) { tried.push({ spec: spec, ok: false, stage: 'dedup', reason: 'DUPLICATE_OF_EARLIER_CANDIDATE', fingerprint: fp }); continue; }
      seenFingerprints.add(fp);
      tried.push({ spec: spec, ok: true });
      candidates.push({
        index: candidates.length, spec: spec, planTargetLevel: planTargetLevel,
        plan: planResult.plan, graph: realized.graph, report: realized.report, fingerprint: fp
      });
    }
    /* specs never reached because n was already met, or the loop ran out - both real,
       reported for transparency (G9a's central measurement needs to know, e.g., how often
       a request's own primary hand profile alone already supplies all N candidates). */
    for (let i = tried.length; i < specs.length; i++) tried.push({ spec: specs[i], ok: false, stage: 'not-tried', reason: 'N_ALREADY_MET' });
    return { candidates: candidates, tried: tried };
  }

  /* ---- scoring ---- `opts.skipEngrave` (round 2, see header): every score here is keyed
     ONLY to `request.targetLevel` (the requested target, fixed across every candidate
     regardless of its own `planTargetLevel`) - this is the structural guarantee behind
     "select by assessed closeness to the requested target, never the planning target". */
  function scoreCandidates(candidates, g, sg, request, opts) {
    opts = opts || {};
    const stage = REF.stageForPosition(request.targetLevel, opts.reference);
    const sourceNotes = CRIT.metrics.graphNoteList(g); /* the original piece's notes: the register-floor critic never counts one of them */
    const melodyCache = new Map(); /* keyed by plan identity (object reference is stable - one plan per (handProfile, planTargetLevel), shared across pattern variants) */
    function origMelodyOf(plan) {
      let notes = melodyCache.get(plan);
      if (!notes) { notes = CRIT.metrics.originalMelodyNotes(g, plan); melodyCache.set(plan, notes); }
      return notes;
    }
    return candidates.map(c => {
      const ctx = {
        /* the G5 hard filter uses the REQUEST's own hand profile, never the candidate's:
           enumeration appends OTHER hand profiles' plans as texture variety, but a candidate
           is only acceptable if it is playable for the hands the user actually asked for. */
        profile: request.handProfile, targetLevel: request.targetLevel, stage: stage,
        origHarmony: sg.harmony, origMelodyNotes: origMelodyOf(c.plan), reference: opts.reference,
        id: 'candidate:' + specKey(c.spec), skipEngrave: !!opts.skipEngrave,
        sourceNotes: sourceNotes, registerFloor: opts.registerFloor
      };
      const ev = CRIT.evaluate(c.graph, ctx);
      return Object.assign({}, c, { scores: ev.critics, hardOk: ev.hardOk });
    });
  }

  /* ---- badness (see header): every critic normalized to ~0 (perfect) .. ~1 (bad).

     `voiceLeading`'s default weight is 0, decided in round 2 (docs/GOALS/G09 section 12
     "round 2") before that round's held-out slice was run. THE STATED REASON NO LONGER HOLDS.
     The decision cited round 1's ablation ("removing voiceLeading is Pareto-better on the
     16-file sample") and round 2's "replication" of it; both were measured while
     critics/voice-leading.js counted a lone note as a parallel octave (844 inflated vs 26
     real parallels on the 16-file selected graphs), so they were one artifact measured
     twice, not two findings (docs/GOALS/G09 section 12, "Voice-leading ablation,
     re-measured"). Re-measured with the corrected critic (weight 1 vs 0, same cheap-scored
     pool): weight 1 lowers the smells on the selected graphs (16-file 26 -> 20, held-out
     40 -> 9) with hard/melody/engrave unchanged, at a cost that differs by sample - none on
     level and 0.0011 of harmony on the 16-file sample; on held-out, mean level distance
     0.2079 -> 0.3007 (still 14/14 within +-1) while harmony rises 0.9345 -> 0.9392. That is a
     trade-off, not a Pareto win for either setting. The weight is left at 0 only because
     changing it after seeing both samples would be tuning on them; whether to raise it is
     the user's decision (docs/GOALS/G09 section 12). The critic is still computed and
     reported every time; `opts.weights: {voiceLeading: 1}` (harness: `--weights
     voiceLeading=1`) restores it. */
  /* `registerFloor` (post-H-8, docs/GOALS/G09 section 12 "G9 register floor") is REPORT ONLY: weight 0. The realizer itself
     keeps every candidate's generated notes at or above E2, so the critic reads 0 on every candidate that is not degraded
     (measured: 0 degraded in 184 candidates over the two samples) - there is nothing for selection to separate, and a hard
     filter would only turn a degraded piece into "no arrangement". `--weights registerFloor=1` counts it. */
  /* `leftHandJump` (post-H-8 re-look, docs/GOALS/G09 section 12 "G9 left-hand jumps") is REPORT ONLY too: weight 0. The standing
     rule is no further tuning of selection; the fix for the reviewer's "awkward hand position" is the realizer's stride geometry
     (realize/patterns.js), and the critic measures it. `--weights lowRegisterCluster=1` counts the low-register cluster rate the same way. `--weights leftHandJump=1` counts it (a jump rate of JUMP_RATE_CAP or more
     is the worst score). */
  const DEFAULT_WEIGHTS = Object.freeze({ level: 1, melody: 1, harmony: 1, engrave: 1, voiceLeading: 0, registerDensity: 1, registerFloor: 0, leftHandJump: 0, lowRegisterCluster: 0 });
  const LEVEL_CAP = 3;      /* a 3-course-position miss is already "as bad as it gets" for this term */
  const ENGRAVE_CAP = 5;    /* 5 combined L1/L2 violations likewise */
  const SMELL_CAP = 10;     /* 10 combined voice-leading smells likewise */
  const JUMP_RATE_CAP = 0.25; /* a quarter of the left-hand steps an octave or more apart is already "as bad as it gets" (weight 0 by default: report only) */
  const CLUSTER_RATE_CAP = 0.5; /* half the chord attacks a low second or third is "as bad as it gets" (weight 0 by default: report only) */
  const FLOOR_CAP = 10;     /* 10 arranged notes below the register floor likewise (weight 0 by default: report only) */

  /* A score that is absent (`undefined`) or whose critic recorded an error (`<name>Error`,
     or an `engrave` result carrying `.error`) counts as the WORST (1) - never as perfect, so a
     failed critic can never make a candidate look better than a clean one. `null` is
     different and deliberate: `melody`/`harmony` are `null` when the ORIGINAL has nothing to
     compare against (no declared melody notes / no harmony windows - not applicable, no
     defect), and `engrave` is `null` only when deliberately deferred (`flags.deferEngrave`,
     the cheap phase of the engrave gate, where it is uniformly absent for every candidate). */
  function badnessOf(scores, targetLevel, weights, flags) {
    flags = flags || {};
    const w = Object.assign({}, DEFAULT_WEIGHTS, weights);
    const failed = key => scores[key] === undefined || scores[key + 'Error'] != null;
    const levelBad = (scores.level == null || scores.levelError != null) ? 1 : Math.min(1, Math.abs(scores.level - targetLevel) / LEVEL_CAP);
    const melodyBad = failed('melody') ? 1 : scores.melody == null ? 0 : 1 - scores.melody;
    const harmonyBad = (failed('harmony') || !scores.harmony) ? 1 : scores.harmony.rootQuality == null ? 0 : 1 - scores.harmony.rootQuality;
    const eg = scores.engrave;
    const engraveBad = eg == null ? ((flags.deferEngrave && eg === null) ? 0 : 1)
      : eg.error ? 1
      : Math.min(1, ((eg.silent || 0) + (eg.hardLayout || 0)) / ENGRAVE_CAP);
    const vl = scores.voiceLeading;
    const voiceLeadingBad = (failed('voiceLeading') || !vl) ? 1 : Math.min(1, vl.count / SMELL_CAP);
    const rd = scores.registerDensity;
    const registerDensityBad = (failed('registerDensity') || !rd) ? 1 : Math.min(1, rd.overage);
    const rf = scores.registerFloor;
    const registerFloorBad = (failed('registerFloor') || !rf) ? 1 : Math.min(1, rf.below / FLOOR_CAP);
    const lj = scores.leftHandJump;
    const leftHandJumpBad = (failed('leftHandJump') || !lj) ? 1 : Math.min(1, lj.rate / JUMP_RATE_CAP);
    const lc = scores.lowRegisterCluster;
    const lowRegisterClusterBad = (failed('lowRegisterCluster') || !lc) ? 1 : Math.min(1, lc.clusterRate / CLUSTER_RATE_CAP);
    const parts = { level: levelBad, melody: melodyBad, harmony: harmonyBad, engrave: engraveBad, voiceLeading: voiceLeadingBad, registerDensity: registerDensityBad, registerFloor: registerFloorBad, leftHandJump: leftHandJumpBad, lowRegisterCluster: lowRegisterClusterBad };
    let total = 0;
    Object.keys(parts).forEach(k => { total += (w[k] == null ? 1 : w[k]) * parts[k]; });
    return { total: total, parts: parts, weights: w };
  }

  function fmtSpec(spec) {
    return 'handProfile=' + spec.handProfile + ' pattern=' + spec.pattern +
      (spec.levelOffset ? ' levelOffset=' + (spec.levelOffset > 0 ? '+' : '') + spec.levelOffset : '');
  }

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
    if (!scored.length) return { ok: false, reason: 'NO_CANDIDATES', discarded: [] };
    const survivors = scored.filter(c => c.hardOk);
    const discarded = scored.filter(c => !c.hardOk);
    if (!survivors.length) return { ok: false, reason: 'ALL_CANDIDATES_HAVE_HARD_VIOLATIONS', discarded: discarded };
    const ranked = survivors
      .map(c => Object.assign({}, c, { badness: badnessOf(c.scores, request.targetLevel, opts.weights) }))
      .sort((a, b) => (a.badness.total - b.badness.total) || (a.index - b.index));
    const selected = ranked[0], runnerUp = ranked[1] || null;
    return { ok: true, selected: selected, runnerUp: runnerUp, ranked: ranked, discarded: discarded, explanation: explain(selected, runnerUp) };
  }

  /* ---- round 2's engrave-gate selection (see header's "engrave budget gate"). `cheapScored`
     must already carry every OTHER critic's real score (`scoreCandidates(..., {skipEngrave:
     true})`) with `scores.engrave === null`. Two-phase, both phases deterministic:
       1. filter hard violations (same rule as select()); rank the real survivors by CHEAP
          badness alone (engrave contributes 0 - badnessOf's existing "no engrave data"
          handling, unchanged); take the first `topK` of that ranking.
       2. compute the REAL `engrave` critic for exactly those `topK` candidates (on COPIES -
          the caller's `cheapScored` array is never mutated and keeps `engrave: null` for
          every candidate; the real numbers appear on `selected`/`ranked` in the result),
          then call the ordinary, already-tested `select()` on just
          that top-K to pick the final winner - reusing its tie-break/explanation logic
          rather than a second selection mechanism.
     `discarded` in the result is the FULL hard-violation set from the WHOLE candidate pool
     (not just the top-K) - `select()`'s own `discarded`, called on the top-K slice, would
     always be empty (every top-K member already passed the hard filter) and is
     intentionally overwritten with the true, complete set here.  `notEngraveChecked` is the
     real, named remainder: survivors that were never given the expensive engrave check
     because a cheap-critic-only ranking placed them outside the top-K - reported for
     transparency, a real approximation cost, not hidden. */
  function selectWithEngraveGate(cheapScored, g, sg, request, opts) {
    opts = opts || {};
    const topK = opts.topKForEngrave == null ? TOP_K_FOR_ENGRAVE_DEFAULT : opts.topKForEngrave;
    if (!cheapScored.length) return { ok: false, reason: 'NO_CANDIDATES', discarded: [], notEngraveChecked: [] };
    const survivors = cheapScored.filter(c => c.hardOk);
    const hardDiscarded = cheapScored.filter(c => !c.hardOk);
    if (!survivors.length) return { ok: false, reason: 'ALL_CANDIDATES_HAVE_HARD_VIOLATIONS', discarded: hardDiscarded, notEngraveChecked: [] };
    const cheapRanked = survivors
      .map(c => Object.assign({}, c, { cheapBadness: badnessOf(c.scores, request.targetLevel, opts.weights, { deferEngrave: true }) }))
      .sort((a, b) => (a.cheapBadness.total - b.cheapBadness.total) || (a.index - b.index));
    const notEngraveChecked = cheapRanked.slice(topK);
    /* the gate never mutates the caller's scored candidates (a cached or re-used pool stays
       exactly as scoreCandidates returned it): each gated member is a COPY carrying its own
       `scores` with the real engrave result. A result the candidate already carries, or one
       memoised in `opts.engraveCache` (keyed by fingerprint - e.g. ablation re-selection over
       the same pool), is reused, never recomputed. */
    const gated = cheapRanked.slice(0, topK).map(c => {
      let eg = c.scores.engrave;
      if (!(eg && !eg.error)) {
        const memo = opts.engraveCache && opts.engraveCache.get(c.fingerprint);
        if (memo) eg = memo;
        else {
          try { eg = CRIT.metrics.engraveMetrics(c.graph, 'candidate:' + specKey(c.spec) + ':gate'); }
          catch (e) { eg = { error: String(e && e.message || e) }; }
          if (opts.engraveCache && c.fingerprint != null && !eg.error) opts.engraveCache.set(c.fingerprint, eg);
        }
      }
      return Object.assign({}, c, { scores: Object.assign({}, c.scores, { engrave: eg }) });
    });
    const finalSel = select(gated, request, opts);
    if (!finalSel.ok) return finalSel; /* structurally unreachable (every `gated` member already passed hardOk), kept for safety */
    return Object.assign({}, finalSel, {
      discarded: hardDiscarded, notEngraveChecked: notEngraveChecked, cheapRanked: cheapRanked, topK: topK,
      explanation: finalSel.explanation + ' (engrave checked for the top ' + gated.length + ' of ' + survivors.length + ' hard-violation-free candidates.)'
    });
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
    return SER.fingerprint(g) + '|' + JSON.stringify(request) + '|' + (opts && opts.n != null ? opts.n : 24) +
      '|' + JSON.stringify((opts && opts.levelOffsets) || LEVEL_OFFSETS_DEFAULT) +
      '|' + (opts && opts.topKForEngrave != null ? opts.topKForEngrave : TOP_K_FOR_ENGRAVE_DEFAULT) +
      '|' + JSON.stringify((opts && opts.weights) || null) +
      '|' + JSON.stringify((opts && opts.reference) || null) +
      '|' + JSON.stringify((opts && opts.planOpts) || null) +
      '|' + JSON.stringify(opts && opts.registerFloor !== undefined ? opts.registerFloor : 'default') +
      '|' + JSON.stringify((opts && opts.stride) || 'default') +
      '|' + (opts && opts.fullEngrave ? 'full' : 'gate');
  }

  /* `run()`'s production pipeline (round 2, default): enumerate -> score the six cheap
     critics on every candidate -> engrave-gate-select among the cheap top-K. Pass
     `opts.fullEngrave: true` to opt back into round 1's shape (real engrave on EVERY
     candidate, then the plain, ungated `select()`) - kept for callers that want the exact
     round-1 semantics (e.g. a small N where the budget saving does not matter) and for
     this module's own tests that construct fully-scored candidates directly. */
  function run(g, sg, request, opts) {
    opts = opts || {};
    if (opts.cache) {
      const key = cacheKey(g, request, opts);
      if (opts.cache.has(key)) return Object.assign({}, opts.cache.get(key)); /* a copy: a caller mutating its result never poisons the cache */
      const result = runUncached(g, sg, request, opts);
      opts.cache.set(key, result);
      return result;
    }
    return runUncached(g, sg, request, opts);
  }

  function runUncached(g, sg, request, opts) {
    const enumerated = enumerate(g, sg, request, opts);
    if (opts.fullEngrave) {
      const scored = scoreCandidates(enumerated.candidates, g, sg, request, opts);
      const selection = select(scored, request, opts);
      return Object.assign({ tried: enumerated.tried, scored: scored }, selection);
    }
    const cheapScored = scoreCandidates(enumerated.candidates, g, sg, request, Object.assign({}, opts, { skipEngrave: true }));
    const selection = selectWithEngraveGate(cheapScored, g, sg, request, opts);
    return Object.assign({ tried: enumerated.tried, scored: cheapScored }, selection);
  }

  return Object.freeze({
    PATTERNS, LEVEL_OFFSETS_DEFAULT, TOP_K_FOR_ENGRAVE_DEFAULT,
    specOrder, patternProfileSpecs, specKey, enumerate, scoreCandidates, badnessOf, select, selectWithEngraveGate, explain, run,
    DEFAULT_WEIGHTS
  });
});
