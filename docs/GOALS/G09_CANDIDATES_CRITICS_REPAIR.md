# G09 — Multi-candidate, Critics and Repair

## 0. Status

Architect 2026-09-28 (Lead, on Opus at the user's request). Depends on G8 (merged and deployed `4866b66`,
behind `PPP.arranger`, default `'legacy'`), G7 (SongGraph + Arrangement Planner), G6 (difficulty), G5
(playability), G4 (engraving). Full roadmap entry: `docs/PPP_MASTER_ROADMAP.md` §5.7.

G9 is the roadmap's designed answer to exactly what G8a measured: **one realization per request does not
beat the in-app legacy `ScoreArranger` on every metric** (`docs/GOALS/G08_ARRANGEMENT_REALIZATION.md` §14 —
3 of 5 metrics tied/beaten after two tuning rounds, not 5 of 5). G9's hypothesis: generating several
candidates, scoring them with critics, repairing local faults, and picking the best closes that gap. That
hypothesis is testable with the tools that already exist, and **G9's first job is to test it with real
numbers before building anything that depends on it being true.**

This doc corrects three roadmap assumptions that do not hold today (§3) and phases the Goal so that nothing
that needs missing data or a user decision blocks the parts that don't (§5).

## 1. Goal

Given an arrangement request, produce N candidate arrangements, judge them with deterministic critics (and,
only once real human data supports it, a learned preference critic), repair local faults with a
per-measure-rollback critic loop, pick one, and explain why. Then — as a separate, explicitly-approved step —
flip the app's default arranger.

## 2. Non-goals

- No audio input (G10). No learner adaptation or adaptive difficulty steps (G11).
- **The learned critic never overrides a hard constraint.** A candidate with any G5 hard violation is
  discarded before any scoring, never "outweighed" by a high preference score. (Roadmap, restated as a
  structural rule: hard constraints are filters, soft signals are scores.)
- No v2 / AI-3 arrangement model (that is G8 v2 and needs decision D-3 — independent of G9).
- No production flip without H-9 passing **and** explicit user approval (§5, G9e).

## 3. Corrections to the roadmap's text (verified against the repo before writing this doc)

1. **"Human preference data from H-8 exists by now" is false.** H-8 was never run.
   `docs/GOALS/G08_ARRANGEMENT_REALIZATION.md` §10 deliberately deferred it until G8a's numbers were "in the
   right ballpark," and §14 records it as "explicitly NOT started" — G8a's numbers never cleared that bar.
   **There are zero committed blind A/B judgments in this repo.** AI-4 (the learned preference critic) is
   specified as "trained only on committed blind A/B judgments (H-8, H-9 and opt-in in-app choices)" — so as
   of today it has **no training data and no held-out evaluation data at all.** G9 must not be designed as
   though AI-4 is available; it is gated on data that does not exist yet (§5, G9d).

2. **Even once H-8 and H-9 run, the planned data volume is probably too small for AI-4 as specified.** H-8 is
   "~8 inputs × 2 levels" (≈16 A/B judgments, roadmap §9 table) and H-9 is "about 16 pieces" pass/fail. A
   learned critic trained on a few dozen pairwise judgments and required to "agree with held-out human choices
   above chance by a margin" will very likely not clear any meaningful margin — the held-out set would be a
   handful of items, and the confidence interval on a handful of binary outcomes is enormous (compare G6a:
   even with 195 pieces, one 22-piece fold's CI spanned −26 to +16 points). This is flagged honestly now, not
   discovered later: **AI-4 is realistically viable only if data comes from somewhere besides H-8/H-9** — the
   roadmap's third source, "opt-in in-app choices," which is a product feature (an in-app A/B picker with
   consent) that does not exist and involves a user/product decision (§7).

3. **Flipping `PPP.arranger` today would not change what most users get.** G8b's independent review found
   (`docs/GOALS/G08B_LEGACY_RETIREMENT.md` §11) that the review screen's DEFAULT style, `'balanced'` — also the
   only style `easierArrangement()` requests — never reaches the switch-gated path. It routes through
   `rewriteFromHeard()` → `audio-score.js`'s `arrangeNotes` (a third legacy engine) with no `ARRANGER_MODE`
   check. Verified in the current app file: `Piano Coach App.dc.html` ~13907, ~13949, ~13959-13961 all branch
   `style !== 'balanced' ? applyRichReviewArrangement : rewriteFromHeard`. **The flip (G9e) must route
   `'balanced'` through the gated path first**, or "flipping the arranger" would silently leave the most
   common request on the old engine.

(Also confirmed, no correction needed: `repaired` is already a valid provenance op in `scoregraph/schema.js`'s
`PROV_OPS`; `scoreRef`/`fingerprint` for caching already exist in `scoregraph/serialize.js`; G3's
per-measure-rollback critic loop exists and is reusable — §4.)

## 4. What already exists — reuse, do not rebuild

- **Five of the seven deterministic critics already exist as functions** in `realize/tools/metrics.js` (G8a's
  comparison harness, already reviewed twice): `hardViolationsOfGraph` (playability), `levelOfGraph` (level),
  `melodyPreservation` (melody), `harmonyAgreement` (harmony fidelity), `engraveMetrics` (engraving
  readability, via G4's L2). They live in a `tools/` directory today — production code must not depend on a
  test-tooling path, so G9a **promotes** them into a real module (e.g. `critics/`), and `realize/tools/` then
  imports from there (one implementation, not two copies drifting apart).
- **Two critics are new**: *voice-leading smells* (parallel fifths/octaves between outer voices, large leaps
  in inner voices, voice crossing — check `scoregraph/pro-voice.js` and G7a's `songgraph/voices.js` first for
  anything already computed) and *register and density* (against G7b's real per-stage empirical bands,
  `arrangement/reference.js` — the same bands G8a's tuning already uses, including their disclosed
  max-ceiling circularity caveat, `docs/GOALS/G07B_ARRANGEMENT_PLANNER.md` §11).
- **The repair loop precedent** is `scoregraph/pro.js`'s `professionalize()` (G3-D5): run a pass, fingerprint
  before/after (`C.fingerprint`), check which components changed outside what the pass `may` change
  (`C.check`), re-run the pass skipping just the offending measures (per-measure rollback), and give back the
  whole input if a violation is global or persists. G9b's repair follows this exact shape — do not invent a
  second rollback mechanism.
- **The candidate knobs already exist**: G7b's `plan()` takes a target level and hand profile and walks a
  texture ladder (`full`/`partial`/`reduced`); G8a's `realize()` takes `opts.pattern` from
  `['hymn','block','broken','ballad','pop','waltz']` (or `'auto'`). Candidates are an enumerable product of
  these real knobs, not new generation machinery.
- **The comparison harness** (`realize/tools/harness.js`, `tests/engrave/corpus.json`'s 16-file stratified
  sample) is how G8a's "3 of 5" result was measured. G9a measures best-of-N on the **same** harness and the
  **same** sample so the before/after is directly comparable.
- **The blind-review methodology** from M-H1/M-H2 (`docs/GOALS/G04_PROFESSIONAL_ENGRAVING.md`, `docs/
  DECISIONS.md`): hash-seeded blind X/Y assignment, a manifest that never reveals the seed or assignment rule,
  independent review of the packet builder before trusting it, an interactive rating artifact. The old tool
  (`tests/engrave/tools/review-build.js`) was deleted and compared two renderings of the same notes; H-8/H-9
  compare two different arrangers' different notes, so a **new** builder is needed (G9c).

## 5. Phases

Ordered so nothing waits on data or decisions it doesn't need.

- **G9a — candidates, deterministic critics, selection, measurement (Node-only).** Enumerate N candidates
  (default N=8) from the real knobs in §4; discard any with a G5 hard violation (filter, not score); score the
  rest with the seven deterministic critics; select one with a human-readable explanation naming the critics
  that decided it. **Then measure best-of-N against the three legacy engines on the same G8a harness and
  sample.** This is the Goal's central empirical question: does selection close G8a's gap to `ScoreArranger`
  on all five of G8's acceptance metrics? Report the answer plainly either way — if best-of-N still doesn't
  beat `ScoreArranger`, that is a finding that reshapes the rest of G9 (and possibly argues for D-3/AI-3
  sooner), not something to tune around silently.
- **G9b — repair (Node-only).** Graph → graph repair ops (e.g. re-voice a chord that creates a parallel
  fifth, drop a doubling that breaks a density band) with G3-D5's per-measure rollback and provenance
  `repaired`. **Repair never adds a hard violation** (roadmap acceptance) — enforced structurally by
  re-running the G5 filter after every repair and rolling the measure back if it fails. Measured on the same
  harness: does repair improve the selected candidate's critic scores without regressing any metric?
- **G9c — blind review tooling, then H-8 and H-9 (costs the user's time).** Build the new packet builder
  (§4), independently reviewed before use. H-8 (diagnostic, ~8 inputs × 2 levels, blind vs legacy) and H-9
  (pass/fail, blind, ~16 pieces) need the user's own listening/reading time — **scheduled with the user, not
  assumed** (§7).
- **G9d — AI-4 learned preference critic, only if the data supports it (Opus, per the standing
  model-assignment rule for AI-modeling phases).** Gated on a real, sufficient set of committed blind
  judgments. Before training anything, compute whether the available judgment count can even support the
  roadmap's acceptance bar ("agrees with held-out human choices above chance by a margin set in the spec") —
  if not, say so and recommend either collecting more (the opt-in in-app picker, §7) or shipping G9 on
  deterministic critics alone. **Never train a critic on data it will then be evaluated on**; never let it
  override a hard constraint (§2).
- **G9e — app integration and the flip (touches the app file; full review cycle).** Wire the multi-candidate
  pipeline in behind `PPP.arranger` (extending G8b's switch, not a new one); **route `'balanced'` through the
  gated path** (§3.3) so a flip means what it says; show progress in the UI and cache results by (SongGraph
  fingerprint, request) (roadmap performance line). **The default flip requires H-9 passing and explicit user
  approval** — the same gate shape as G4's M-H2-gated flip. After the flip is live and stable for one release,
  `arrange_score.py` and the wire-score round trip become retirable (G8b deliberately deferred this; G4's own
  flip-then-remove precedent).

## 6. Acceptance

- **G9a/G9b**: every output meets everything G8 requires (0 G5 hard violations, G6 level within ±1, melody
  preserved, harmony agreement, engrave L1/L2 clean); repair never adds a hard violation; deterministic (same
  request + same SongGraph → same selected candidate, byte for byte); **best-of-N measured head-to-head against
  all three legacy engines on the same inputs**, reported plainly — the roadmap's own premise is that this is
  what finally beats `ScoreArranger`, so this is the number that decides whether G9's approach works.
- **G9d**: the learned critic agrees with held-out human choices above chance by a margin **fixed in this
  spec before training, once the real judgment count is known** (not before — the margin a dataset can support
  depends on its size; fixing it blind would repeat G6a's too-tight-for-its-fold problem, `docs/DECISIONS.md`
  G6-L2).
- **G9e**: H-9 passes; the user approves the flip; `PPP.arranger = 'legacy'` still works as rollback for one
  release after.

## 7. Decisions that belong to the user (flagged now, not blocking G9a/G9b)

- **When to run H-8 and H-9.** Both cost the user's own time (H-8 ~45 min per the roadmap; H-9 ~16 pieces).
  G9a/G9b's numbers should come first — no point scheduling blind reviews of candidates that the harness
  already shows are worse than legacy.
- **Whether to build an opt-in in-app A/B preference picker.** It is the only realistic path to enough data
  for AI-4 (§3.2). It is a user-visible product feature that collects preference data from real users —
  consent and privacy questions (adjacent to roadmap decision D-5) are the user's call, not an engineering
  default.
- **Whether AI-4 is worth pursuing at all**, if the data can't support its acceptance bar. G9 can ship on
  deterministic critics alone; the roadmap names AI-4 but its own gate ("agrees with held-out human choices")
  may simply be unreachable at feasible data volumes.
- **The flip itself** (G9e) — explicit approval, as with every default flip this project has done.

## 8. Performance

N = 8 end to end ≤ 10 s "on the helper or server, with progress in the UI and results cached by (SongGraph
fingerprint, request)" (roadmap). Real starting estimates from already-measured parts: G8a `realize()` ≈ 20 ms
per candidate; G5 `analyzeGraph` ≈ 10-40 ms; G6 assessment ≈ 20-40 ms; G4 L2 engrave metrics — not yet
measured per candidate and likely the most expensive critic; measure it first. If N=8 fits comfortably
in-browser (≈ 8 × ~100-200 ms), the "helper or server" placement may be unnecessary — decide from real numbers
in G9a, not from the roadmap's assumption. Caching uses the existing `scoreRef`/`fingerprint`.

## 9. Regression

New `test:critics` (or folded into `test:realize` if the boundary reads better — decide and document).
Mutation suite: a planted parallel fifth must be caught by the voice-leading critic; a planted hard violation
must be filtered before scoring; a repair that would introduce a hard violation must be rolled back; the
selection must be deterministic. `test:realize`, `test:arrangement-planner`, `test:songgraph`,
`test:playability`, `test:difficulty` must stay green.

## 10. Rollback

`PPP.arranger = 'legacy'`, kept for one release after the flip (roadmap). Before G9e, nothing user-facing
changes — G9a/b/d are Node-only.

## 11. Notes for implementers

- **Process constraint, stated as a hard rule** (from G8a's real multi-writer collision, `docs/GOALS/
  G08_ARRANGEMENT_REALIZATION.md` §14 and memory `subagent-research-scope-creep`): do not dispatch any
  sub-agent that could write files to the worktree. Investigate directly.
- G9a's central measurement (best-of-N vs legacy) comes **before** building repair or anything else on top of
  it. If best-of-N doesn't help, the Lead needs to know before more is built on the assumption that it does.
- Promote the five existing metric functions out of `realize/tools/` into a real module; do not copy them.
- Re-verify every file/line reference in this doc fresh — line numbers drift.
- Correct this doc in a §12 implementation record when reality disagrees with it — standard practice here.

## 12. Implementation record

### G9a — candidates, critics, selection, central measurement (2026-09-28)

Node-only, not loaded by the app (§2/§10 unchanged). All investigation was done directly
(Read/Grep/Bash on the real files, plus small ad hoc Node scripts run against this
worktree), per the hard process constraint above — no sub-agent was dispatched for any
part of this phase.

**What was built:**
- `critics/metrics.js` — the five G8a-harness metric functions (`hardViolationsOfGraph`,
  `levelOfGraph`, `melodyPreservation`, `harmonyAgreement`, `engraveMetrics`, plus their
  shared helpers), **moved verbatim** from `realize/tools/metrics.js` (only the `REPO`
  path-resolution depth changed, one `..` fewer). `realize/tools/metrics.js` is now a
  2-line re-export (`module.exports = require('../../critics/metrics.js')`) — confirmed by
  `require()` identity in `tests/critics/metrics-promotion.test.js` that it is the SAME
  module object, not a second implementation. Re-ran `realize/tools/harness.js --sample 16`
  immediately after the move and diffed the JSON summary byte-for-byte against a pre-move
  run: `g8a`/`arrangeScorePy`/`scoreArranger` summaries were identical — **the promotion
  changed no number**, confirmed, not assumed.
- `critics/voice-leading.js` (NEW) — parallel perfect fifths/octaves between the two OUTER
  voices (the highest/lowest sounding pitch at each onset slice, not one fixed voice id),
  large (>12-semitone) leaps in a voice that is genuinely inner at BOTH leap endpoints, and
  voice crossings within a part (two voices' relative pitch order reversed from their own
  real whole-piece average register, via `songgraph/voices.js`'s existing
  `perPartVoiceStats` — confirmed first, per §4's instruction, that neither
  `scoregraph/pro-voice.js` (G3 engraving cleanup, no pitch-relationship check at all) nor
  `songgraph/voices.js` (melody/bass/inner ROLE classification, no smell detection) already
  computes any of this — genuinely new). Built on `songgraph/util.js`'s existing
  `noteWindows` (read-only reuse). 9 unit tests incl. 5 mutation + 4 negative controls, all
  passing on hand-written `tests/scoregraph/g3-helpers.js` `mk()` fixtures with exact,
  known pitch sequences.
- `critics/register-density.js` (NEW) — `difficulty/features.js`'s real `featuresOf(graph)
  .piece` (notesPerBeatRH/LH, chordLoad, range, keyLoad, densityRH/LH — exactly
  `arrangement/reference.js`'s own `BAND_KEYS`) against `REF.bandsForStage(stage)`, using
  the SAME p90-for-continuous/max-for-spike ceiling convention `arrangement/plan.js`'s own
  `planSection` already established (reused, not reinvented). Genuinely independent of
  G7b's plan-time density gate: that gate checks the RETAINED VOICES' notes before any
  accompaniment exists; this critic checks the REALIZED candidate's actual generated notes
  — different information (G8a's own tuning record, §14 above, shows realized density can
  diverge from plan-time estimates).
- `critics/index.js` — `evaluate(graph, ctx) -> {critics, hardOk}`, composing all seven.
  `hardOk` is a boolean gate; the other six scores are always computed and returned even
  when `hardOk` is false (useful for reporting a discarded candidate's real numbers), but
  never blended into a weighted score — the structural filter-vs-score rule (§2) is
  enforced in `candidates/index.js`'s `select()`, not here.
- `candidates/index.js` (NEW) — `enumerate()`, `scoreCandidates()`, `select()`, `run()`.
  Enumeration order (deterministic, no randomness anywhere): the request's own
  `handProfile` walked across all 7 `realize()` pattern values (`'auto'` +
  `PATTERN_NAMES`), THEN the other two hand profiles (`playability/reach.js`'s own
  `PROFILES` order) each at `pattern:'auto'` — up to 9 specs, capped at `n` (default 8).
  Candidates are deduped by `scoregraph/serialize.js`'s real `fingerprint()` (reused
  directly, not a new canonicalization). `select()` computes a 0(perfect)–~1(bad)
  "badness" per critic (level: `|diff|/3` capped at 1; melody: `1-preservation`; harmony:
  `1-rootQuality`; engrave: combined L1/L2 count /5 capped at 1; voiceLeading: smell count
  /10 capped at 1; registerDensity: overage capped at 1), sums with a flat default weight
  of 1 each (`DEFAULT_WEIGHTS`, deliberately NOT tuned — see ablations below), picks the
  minimum, ties broken by the fixed enumeration index. `explain()` names, in order of
  contribution, which critics separated the winner from the runner-up. In-memory caching
  by `(fingerprint(g), request, n, weights)` is implemented (`opts.cache`, a Map the caller
  owns) — cheap to add (one existing `fingerprint()` call), so added now rather than
  deferred to G9e as the design doc allowed.
- `realize/tools/harness.js` extended (additive, opt-in `--g9a` flag; the pre-existing
  `g8a`/`arrangeScorePy`/`scoreArranger`/`audioScore` code paths and CLI defaults are
  **unchanged** — confirmed via the byte-for-byte summary diff above) with a `g9a` row
  computed at the exact SAME `(targetLevel, handProfile)` G8a's own per-file search already
  found (`found.targetLevel`/`found.profile`) — best-of-N and single-realization G8a are
  therefore compared on the literal same request, never a more favorable one substituted.
  `--ablate-critics a,b,c` re-runs only `select()` (cheap — no re-plan/re-realize) with
  each named critic's weight zeroed, against the SAME already-scored candidate pool.

**THE CENTRAL MEASUREMENT** — best-of-N (N=8 requested) vs. the three legacy engines vs.
G8a's own single-realization, on the SAME `realize/tools/harness.js`, the SAME 16-file
stratified sample (`tests/engrave/corpus.json`), the SAME 12/16-file scored subset (4 files
have no reachable G7b plan at any level/profile tried — a G7b coverage limit, unchanged by
this phase, identical exclusion set to every prior G8 measurement on this sample):

| Metric | G8a (single) | **G9a best-of-N** | arrange_score.py | ScoreArranger | audio-score.js |
|---|---|---|---|---|---|
| G5 hard violations (%zero, mean) | 100% (12/12), 0 | **100% (12/12), 0** | 0% (0/12), 37.25 | 83% (10/12), 0.917 | 8% (1/12), 77.25 |
| G6 level within ±1 (%), mean \|diff\| | 66.7% (8/12), 0.715 | **66.7% (8/12), 0.6425** | 58% (7/12), 0.811 | 83% (10/12), 0.304 | N/A |
| melody preservation (mean) | 1.000 | **1.000** | 0.927 | 0.985 | 0.946 |
| harmony root+quality / root-only | 0.929 / 0.946 | **0.949 / 0.954** | 0.520 / 0.653 | 0.947 / 0.956 | N/A |
| engrave L1 silent / L2 hard (all-zero rate) | 12/12, 12/12 | **12/12, 12/12** | 12/12, 12/12 | 12/12, 12/12 | N/A |

**Stated plainly: best-of-N does NOT beat `ScoreArranger` on every metric — it beats/ties on
the SAME 3 of 5 metrics G8a's single realization already did (hard violations, melody,
engrave), narrowly flips harmony root+quality from a loss (0.929) to a win (0.949 vs.
0.947) while root-only stays a narrow loss (0.954 vs. 0.956), and leaves G6 level-within-±1
completely unmoved on the metric the roadmap's own bucketed pass/fail form uses (still
66.7% vs. ScoreArranger's 83%) — only the finer mean-\|diff\| form improved (0.715 -> 0.6425,
still nearly double ScoreArranger's 0.304).** The roadmap's own hypothesis for G9 — "generate
several candidates, score them, pick the best, and this closes the gap to ScoreArranger" —
is **not supported by this measurement**: best-of-N is a small, real, but narrow
improvement over G8a's already-tuned single realization, not a phase change. The dominant
remaining gap (G6 level accuracy) is untouched by candidate selection on this sample. This
is reported plainly per this task's own instruction not to tune around an unfavorable
finding silently or narrow the sample to make it look better.

**Selection-objective overlap, disclosed explicitly (per this task's own instruction):**
`harmonyAgreement` and `levelOfGraph` are BOTH used as selection critics AND reported as
acceptance metrics. Any improvement on those two is therefore expected and partly "by
construction" of the selection objective, not independent evidence of a better arranger —
exactly the trap this task warned about. **Harmony's narrow improvement (0.929→0.949) is
the metric most attributable to selection itself** (harmony is directly optimized and moved
the most of any metric). **Level's near-non-movement, despite ALSO being directly
optimized, is the more informative result**: even with level explicitly in the selection
objective, best-of-N could not move the bucketed ±1 pass rate at all on this sample —
evidence that the candidate POOL (pattern × hand-profile variants of the same underlying
G7b plan) simply does not contain enough level-accuracy diversity to close this gap, not
that selection failed to look for it. **Hard violations, melody preservation and engrave
are NOT selection-objective overlap** in the interesting sense: melody is 1.000 by
construction of G8a's realize() (verbatim copy) regardless of which candidate is picked;
hard violations were already 0/12→12/12 at G8a's single-realization baseline after G8a's
own final tuning round (§14 above), so best-of-N's "win" here is inherited, not newly
produced by selection; engrave is 0/0 for literally every candidate in this sample (bare
ScoreGraphs with no dynamics/pedals/lyrics rarely trigger L1/L2 at all — the same
"structurally uninformative here" caveat §14 already recorded for G8a). **The only metric
where best-of-N's number is NOT mostly explained by "inherited from G8a" or "by
construction" is harmony — and that is also the one metric most directly selected on.**

**Ablations** (re-`select()` on the SAME already-scored 16-file candidate pool, one
critic's weight zeroed at a time — cheap, no re-planning/re-realizing):

| Ablation (critic weight → 0) | level within±1 (%, mean\|diff\|) | harmony root+quality / root-only |
|---|---|---|
| none (default, all weight 1) | 66.7% (8/12), 0.6425 | 0.949 / 0.954 |
| level | 66.7% (8/12), **0.6725 (worse)** | 0.949 / 0.954 (unchanged) |
| harmony | **75% (9/12), 0.591 (better)** | 0.922 / 0.952 (rootQuality worse, as expected) |
| **voiceLeading** | **75% (9/12), 0.464 (better)** | **0.965 / 0.967 (both better)** |
| registerDensity | 75% (9/12), 0.573 (better) | 0.936 / 0.954 (mixed) |
| melody | identical to default (melody is 1.000 for every surviving candidate — zero discriminative power on this sample) |
| engrave | identical to default (0/0 for every surviving candidate — zero discriminative power on this sample) |

**The load-bearing ablation finding**: removing `voiceLeading` from selection **improves
BOTH level (66.7%→75%, mean\|diff\| 0.6425→0.464) AND harmony (both sub-metrics) at
identical hard-violation/melody/engrave outcomes** — a Pareto improvement on this sample.
This means the voice-leading critic, at its current flat weight of 1 and its current
raw-count-based badness (`count/10` capped at 1), is actively steering selection AWAY from
the candidates that are also better on level and harmony, on this specific 16-file sample.
Investigated further (not just measured and left): the earlier hand test on
`catalog/method/beyer/007.mxl` (§12 development note, not corpus-wide) found 23 planted-
sounding "parallel octave" events from a single realize() output — but these were REAL,
structural, not a bug: a single-note-per-beat LH bass (G8a's own stage-1 `STAGE1_COUNT=1`
policy, §14 above) very often doubles the melody's own contour at some fixed octave
displacement, which is textbook parallel motion by definition, on almost every beat of a
simple, mostly-stepwise tune. **This is a real, disclosed limitation of the CURRENT
voice-leading critic's weighting, not a bug in its detection logic** (the mutation tests
confirm the detector itself is correct): a flat per-smell count does not distinguish an
occasional, genuinely bad parallel motion from a systematic, low-severity byproduct of a
deliberately simple single-note bass texture. **Recommendation for the Lead, not acted on
silently here**: either (a) lower `voiceLeading`'s default weight relative to `level`/
`harmony`, or (b) change its scoring from a raw count to a rate (smells per real harmonic
change, so a piece with many beats is not penalized merely for having more beats), before
this critic is trusted for a production selection decision. Not changed in this phase
because doing so ON THIS SAME 16-FILE SAMPLE that informed the observation would be tuning
to the test set without independent validation — exactly what this task's own instructions
warn against. The flat weight of 1 is kept as the shipped default, with this finding
recorded for whoever tunes G9's weights next (plausibly folded into G9b's repair work,
which already needs to reason about voice-leading faults).

**Performance** (design doc §8's own "measure the G4 L2 engrave cost first, it's likely the
most expensive critic" — confirmed, not assumed): per-candidate critic cost on a real
mid-size file (`sonatina/001.mxl`, 38 measures): hard violations 3ms, level 7ms, melody
2ms, harmony 1ms, voiceLeading 3ms, registerDensity 10ms — **engrave (G4 L2 via
`tests/engrave/tools/bench.js`'s `measure()`) 212ms cold / 148ms warm, i.e. 85-90% of one
candidate's total scoring cost**, exactly the "measure it first" the design doc called for.
End-to-end N=8 (enumerate + realize + score all 6 non-filter critics + select) on the
16-file sample ranged **53ms (a file with only 1 real candidate — see below) to 2628ms**
(`sonatina/003.mxl`, 8 real candidates scored); on the single largest reachable file found
in a broader sweep (`sonatina/013.mxl`, 86 measures — note G8a's own §14 record used
`sonatina/020.mxl` as its worst-case fixture, which has NO reachable G7b plan at any level/
profile, confirmed unchanged here; `013` is the largest REACHABLE file found), N=8 (6
candidates actually scored, all discarded — see below) took **6132ms**. All comfortably
under the roadmap's ≤10s budget. **This plausibly fits in-browser too** (a few seconds on
the largest real corpus file, well under 10s), though the biggest files sit close enough to
several seconds that a progress indicator or off-main-thread execution (a Web Worker) would
still be the right UX choice — a G9e decision, not a performance blocker for G9a. The "on
the helper or server" placement the roadmap assumed is **not required purely on
performance grounds**, contrary to that assumption.

**N=8 utilization, an honest limitation of the enumeration design**: across the 12 scored
files, the number of REAL, DISTINCT candidates actually found ranged 1–8 (mean 5.75/8,
71.9% of the requested N). Two files (`beyer/001.mxl`, `beyer/007.mxl`) produced only ONE
real candidate — **a genuine, disclosed corpus-check finding, not a bug**: both are simple
2-voice, G6-stage-1 pieces, and `realize/index.js`'s own `policyForStage(stage, ...)`
(§14 above) **unconditionally returns `{pattern:'block', ...}` for any `stage <= 1`,
discarding whatever pattern was actually requested** (including an EXPLICIT `'hymn'` or
`'broken'` request — `resolvePattern` honours the explicit request, but `policyForStage`
then silently overrides it for low-stage sections). This is a genuine correction to this
design doc's own framing in §4/§5 ("candidates are an enumerable product of [plan's texture
ladder] and [realize's pattern]"): **at G6 stage 1, the pattern axis contributes ZERO real
candidate diversity** — every one of the 7 pattern values realizes to the byte-identical
graph, confirmed directly (not assumed) via `scoregraph/serialize.js`'s `fingerprint()`
during a live run. Hand-profile variation is the only source of diversity at stage 1, and
it too is often exhausted (a simple piece frequently realizes identically at `medium` and
`large`, since neither profile's tighter `MAX_SPAN` changes anything for it). `sonatina/013
.mxl` (86 measures) got 6 real, distinct candidates, but **ALL SIX had a real G5 hard
violation** and `select()` correctly returned `ok:false` — this is the SAME real,
pre-existing SPAN violation §14's final tuning round already disclosed as unfixed on this
exact file (byte-identical before/after that round); best-of-N candidate diversity across
pattern/hand-profile does not touch it, because it is a structural feature of this piece's
own voice content at every texture this request's `handProfile` search reaches, not
something a different pattern choice changes.

**Tests**: new `npm run test:critics` (`tests/critics/**/*.test.js`), **not folded into
`test:realize`** — decided and documented here: `critics/` and `candidates/` are their own
modules with their own concerns (critic correctness and selection determinism), distinct
from `realize/`'s own concern (does `realize()` build a valid, deterministic graph from a
plan) — folding them together would blur which suite is guarding which promise, the same
reasoning `test:arrangement-planner` and `test:realize` are already kept separate for
adjacent-but-distinct modules. 19/19 passing: 9 voice-leading (5 mutation + 4 negative
control, on hand-written `mk()` fixtures with known planted pitch sequences), 3
register-density (incl. a synthetic no-reference-data case returning cleanly rather than
throwing), 5 candidates/selection mutation (a planted 2-octave-dyad hard violation is
filtered before scoring and never outweighs a clean candidate's worse other-critic scores;
if EVERY candidate has a hard violation, `select()` reports `ALL_CANDIDATES_HAVE_HARD_
VIOLATIONS` rather than picking one anyway; a real corpus file's full `enumerate→score→
select` pipeline run twice is byte-for-byte identical, including the selected candidate's
own `fingerprint()`; a real multi-voice file yields genuinely distinct, deduped candidates;
an unreachable request — the SAME planted-unreachable-target discipline `tests/realize/
realize.test.js`'s own mutation test uses — never reaches scoring with a fabricated plan),
2 metrics-promotion sanity (`require()` identity, not just value equality, between the old
path and the new one). `test:realize` (16/16), `test:arrangement-planner` (17/17),
`test:songgraph` (45/45), `test:playability` (32/32), `test:difficulty` (34/34) all
re-verified green after this phase's changes.

**Design-doc corrections** (verified fresh against the real repo, per §11's own
instruction):
1. §4/§5's framing of "candidates are an enumerable product of the texture ladder and the
   realize pattern" is only fully true at G6 stage 2+; at stage 1, `realize/index.js`'s
   `policyForStage` forces every pattern to `'block'` regardless of request (see above) —
   candidate diversity at stage 1 comes from hand-profile variation alone, and even that is
   often degenerate for simple pieces. Corrected here, not silently worked around.
2. `arrangement/plan.js`'s `REF.ref().stageForPosition(position)` **clamps** an
   out-of-range HIGH `targetLevel` to the highest real stage rather than refusing the
   request (discovered while writing an "unreachable" mutation test at `targetLevel: 999`,
   which unexpectedly succeeded) — only an extreme LOW target reliably fails, matching
   `tests/realize/realize.test.js`'s own existing `-50` convention, which this phase's own
   mutation test adopted once the high-end assumption proved wrong. Not a bug (plan.js is
   read-only here per scope), but worth the next implementer knowing before writing a
   similar "absurd target" test.
3. No correction needed to §3's three stale-roadmap-assumption corrections (H-8/H-9 not
   run, AI-4 data volume, `'balanced'` routing) — all re-verified true, unchanged by this
   phase (G9a touches none of them; they remain live for G9c/d/e).

**Scope discipline**: no change to `songgraph/`, `arrangement/`, `playability/`,
`difficulty/` internals (read/call only, confirmed by `git status`/diff review before
committing); `realize/` touched only for the metric-function move (`realize/index.js`
itself — the realizer — is byte-for-byte unchanged, confirmed by the pre/post-move harness
diff above) and the additive `--g9a` harness extension. No app file touched (Node-only,
per §2/§10). G9b (repair), G9c (review tooling/H-8/H-9), G9d (AI-4) and G9e (app
integration/flip) are untouched, per their own explicit exclusion from this phase.
