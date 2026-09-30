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
`harmonyAgreement`, `melodyPreservation` and `levelOfGraph` are ALL used as selection
critics AND reported as acceptance metrics (this paragraph originally named only harmony and
level; melody is also a weight-1 selection term - corrected in the round-2 fix pass, see
"Round 2 fix pass" below). Any improvement on those is therefore expected and partly "by
construction" of the selection objective, not independent evidence of a better arranger —
exactly the trap this task warned about. **Harmony's narrow improvement (0.929→0.949) is
the metric most attributable to selection itself** (harmony is directly optimized and moved
the most of any metric). **Level's near-non-movement, despite ALSO being directly
optimized, is the more informative result**: even with level explicitly in the selection
objective, best-of-N could not move the bucketed ±1 pass rate at all on this sample —
evidence that the candidate POOL (pattern × hand-profile variants of the same underlying
G7b plan) simply does not contain enough level-accuracy diversity to close this gap, not
that selection failed to look for it. **Hard violations and engrave
are NOT selection-objective overlap** in the interesting sense (hard violations are a filter,
not a score; engrave is uninformative here). Melody IS a selection term, but is 1.000 on
this sample by construction of G8a's realize() (verbatim copy) regardless of which candidate
is picked, so selecting on it changes nothing here;
hard violations were already 0/12→12/12 at G8a's single-realization baseline after G8a's
own final tuning round (§14 above), so best-of-N's "win" here is inherited, not newly
produced by selection; engrave is 0/0 for literally every candidate in this sample (bare
ScoreGraphs with no dynamics/pedals/lyrics rarely trigger L1/L2 at all — the same
"structurally uninformative here" caveat §14 already recorded for G8a). **The only metric
where best-of-N's number is NOT mostly explained by "inherited from G8a" or "by
construction" is harmony — and that is also the one metric most directly selected on.**

**Ablations** - **SUPERSEDED for `voiceLeading` (G9b fix pass, 2026-09-30): the voice-leading row and the paragraph under
it were measured on an inflated critic and their conclusion is withdrawn; the corrected measurement is in "Voice-leading
ablation, re-measured" below. The other rows were also computed with that inflated voice-leading term still inside the
weight-1 badness sum (a mostly-saturated, nearly constant term for most candidates), so they carry the same caveat and were
NOT re-measured; the shipped pipeline (`voiceLeading` weight 0 since round 2) does not use them.** Method: re-`select()` on the SAME already-scored
16-file candidate pool, one critic's weight zeroed at a time - cheap, no re-planning/re-realizing:

| Ablation (critic weight → 0) | level within±1 (%, mean\|diff\|) | harmony root+quality / root-only |
|---|---|---|
| none (default, all weight 1) | 66.7% (8/12), 0.6425 | 0.949 / 0.954 |
| level | 66.7% (8/12), **0.6725 (worse)** | 0.949 / 0.954 (unchanged) |
| harmony | **75% (9/12), 0.591 (better)** | 0.922 / 0.952 (rootQuality worse, as expected) |
| ~~voiceLeading~~ (superseded, inflated count) | ~~75% (9/12), 0.464 (better)~~ | ~~0.965 / 0.967 (both better)~~ |
| registerDensity | 75% (9/12), 0.573 (better) | 0.936 / 0.954 (mixed) |
| melody | identical to default (melody is 1.000 for every surviving candidate — zero discriminative power on this sample) |
| engrave | identical to default (0/0 for every surviving candidate — zero discriminative power on this sample) |

**SUPERSEDED (withdrawn in the G9b fix pass; kept below only so the history is readable).** ~~The load-bearing ablation
finding: removing `voiceLeading` from selection improves BOTH level and harmony - a Pareto improvement on this sample. ...
the earlier hand test on `catalog/method/beyer/007.mxl` found 23 planted-sounding "parallel octave" events ... these were
REAL, structural, not a bug ... not a bug in its detection logic (the mutation tests confirm the detector itself is correct)
... a flat per-smell count does not distinguish an occasional, genuinely bad parallel motion from a systematic, low-severity
byproduct of a deliberately simple single-note bass texture.~~ **That was wrong.** The detector had a bug: `outerOf` treated a
slice with ONE attacking note as an outer pair with `hi === lo` (a unison), so every same-direction step of a lone line - a
melody over a resting or sustaining other hand - was counted as a "parallel octave". The 23 events on `beyer/007` were mostly
this artifact, not textbook parallel motion between a real bass and melody; the mutation tests did not catch it because every
planted fixture had two attacking notes at both onsets. On the round-2 selected graphs of the 16-file sample the count is 844
under the G9a rule and 26 under the corrected one (re-measured in the G9b fix pass). Both the round-1 "Pareto improvement" and
the round-2 "replication" below rested on that inflated count, so neither is evidence about voice-leading; "two consistent
replications" was one artifact measured twice on the same 16 files. The recommendation in the withdrawn paragraph (lower the
weight, or score by rate) was made for the wrong reason and is not adopted; no weight was changed by this fix pass.

**Voice-leading ablation, re-measured (G9b fix pass, corrected critic).** Because `voiceLeading`'s default weight is 0
(`candidates/index.js`), `--ablate-critics voiceLeading` alone is a no-op (weight 0 against weight 0). `realize/tools/harness.js`
gained `--weights k=v,...`, so `--weights voiceLeading=1 --ablate-critics voiceLeading` compares weight 1 with weight 0 on the SAME
cheap-scored pool (`--sample 16 --g9a ... --timeout-s 120` and `--held-out 32 ... --timeout-s 180`; no timeouts; 12 and 14 files
scored). Smells = corrected voice-leading count on the selected graph, summed over files.

| Sample | voiceLeading weight | level within±1, mean\|diff\| | harmony root+quality / root-only | smells on selected graphs | hard 0 / melody / engrave |
|---|---|---|---|---|---|
| 16-file, 12 scored | 1 | 10/12, 0.3167 | 0.9742 / 0.9778 | 20 | 12/12 / 1.000 / 12/12 |
| 16-file, 12 scored | 0 (shipped default) | 10/12, 0.3167 | 0.9753 / 0.9778 | 26 | 12/12 / 1.000 / 12/12 |
| held-out, 14 scored | 1 | 14/14, 0.3007 | 0.9392 / 0.9748 | 9 | 14/14 / 1.000 / 14/14 |
| held-out, 14 scored | 0 (shipped default) | 14/14, 0.2079 | 0.9345 / 0.9651 | 40 | 14/14 / 1.000 / 14/14 |

**New conclusion.** With the corrected critic voice-leading is a real selection signal, and it is a trade-off, not a free win
and not an artifact. At weight 1 it cuts the smells on the selected graphs (26 -> 20 on the 16-file sample, 40 -> 9 on the
held-out slice) with hard violations, melody and engrave unchanged. What it costs differs by sample: on the 16-file sample
nothing on level (identical) and 0.0011 of harmony root+quality; on the held-out slice it worsens mean level distance from the
target (0.2079 -> 0.3007, still 14/14 within ±1) while improving harmony (root+quality 0.9345 -> 0.9392, root-only 0.9651 ->
0.9748). So "removing voice-leading is a Pareto improvement" is false: it helps its own objective, is neutral to slightly
negative on the tuning sample, and mixed on held-out data. Small samples (12 and 14 files) - wide uncertainty. Whether the
default weight should stay 0 is a decision this pass does NOT make: the round-2 decision to set it to 0 cited the withdrawn
ablation, so its stated reason no longer holds, but changing the weight now, after seeing both samples, would be tuning on
them. It is flagged for the user (with the level/harmony/smell trade-off above as the input) and the shipped default is unchanged.

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

### G9a round 2 — engrave-gated selection, target-closeness selection, disjoint held-out sweep (2026-09-30)

Changes (Node-only, no app file): `candidates/index.js` enumerates n=24 candidates at level offsets [0,-1,1]
and selects by assessed closeness to the REQUESTED target (never a candidate's own planning target);
`selectWithEngraveGate` runs the real engraver on the cheap-scored top-3 only; ablations reuse the cheap-scored pool.
`realize/tools/harness.js` gained `--held-out N` (the next N files of the same deterministic stratified walk, disjoint
from the round-1 16-file sample by construction) and a per-file child process with `--timeout-s`, so a legacy engine
that never returns is recorded as a timeout instead of stalling the sweep. `tests/critics` 21/21 at the time (29/29 after the fix pass below).

**Tuning sample (round-1's 16 files, 12 reachable, tuned against):** G9a vs ScoreArranger — hard violations 12/12 zero
vs 10/12; melody 1.000 vs 0.985; harmony root+quality 0.975 vs 0.947 (root-only 0.978 vs 0.956); level within ±1
10/12 vs 10/12 (mean |diff| 0.317 vs 0.304); engrave tied. "All five tied or beaten" is loose: level within ±1 is tied
10/12, but mean level diff is 0.317 (G9a) vs 0.304 (ScoreArranger), i.e. G9a is slightly WORSE there. This is also the
sample the tuning looked at, so it is optimistic.

**Disjoint held-out (32 files walked; 11 scored; 3 timeouts; rest have no reachable G7b plan):**

| Metric | G8a | **G9a** | ScoreArranger |
|---|---|---|---|
| hard violations (zero-files, mean) | 11/11, 0 | **11/11, 0** | 8/11, 0.82 |
| melody | 1.000 | **1.000** | 0.973 |
| harmony root+quality / root-only | 0.928 / 0.964 | **0.932 / 0.966** | 0.971 / 0.974 |
| level within ±1, mean \|diff\| | 11/11, 0.623 | **11/11, 0.255** | 11/11, 0.570 |
| engrave L1/L2 | 11/11 | **11/11** | 11/11 |

**Stated plainly:** on held-out data G9a beats or ties ScoreArranger on 4 of 5 metrics and **still loses on harmony**
(0.932 vs 0.971; root-only 0.966 vs 0.974). The tuning sample's harmony win (0.975) shrank to 0.932 on unseen files, which
is the overfitting the disjoint sweep exists to catch. Harmony is versus G8a only +0.004 on held-out. The level
improvement (0.62 -> 0.25) is partly by construction: level closeness is the selection objective. The held-out scored
set is 11 files, below the ~20 the plan asked for, because most of the slice is unreachable by G7b; that is a small
sample and the numbers carry wide uncertainty.

**Legacy hang found (tech debt, not G9a):** `ScoreArranger` at level `intermediate` did not return within 180-600 s on
`catalog/hymns/christ-arose.musicxml`, `catalog/hymns/god-rest-ye-merry.musicxml` and
`catalog/method/burgmuller25/019.mxl` (`beginner` on christ-arose takes 11 ms). Not yet checked whether the app runs the
same code path; if it does, arranging those pieces at intermediate could freeze the browser.

**Round 2 fix pass (2026-09-30, after independent review) - selection-objective overlap, stated plainly.** The overlap
disclosure above (round 1 and round 2) was understated. `badnessOf` minimises |DIFF level - target|, using the same
`levelOfGraph` the harness reports as the level metric; and melody and harmony are also selection terms, scored by the
same functions (`melodyPreservation`, `harmonyAgreement`) the harness reports. So G9a's melody, harmony and level results
are best-of-N ON THE EVALUATION METRICS THEMSELVES, not independent evidence of a better arranger. The comparison is also
unequal: each legacy engine gets a best-of-4 over its own native levels chosen by level closeness only, while G9a gets up
to 24 candidates (9 pattern/profile specs x 3 planning-level offsets, capped at 24) chosen by all three evaluation metrics together (plus
register/density and, for the top 3, engrave). The held-out level improvement (0.62 -> 0.25) and the harmony movement
should be read with that in mind; only hard violations (a structural filter, not a score) and engrave are outside the
selection objective. Separately: the harness only ever exercises hand profile `large` (`findG8Plan` tries `large` first
and all 12 + 11 scored files in these two runs used it), so nothing measured here says anything about `medium` or `small` hands.

Correctness fixes in this pass (no tuning of weights or of the arrangement; the user decided there is none):
1. The G5 hard-violation filter now uses the REQUEST's hand profile (`ctx.profile = request.handProfile`), not the
   candidate's own profile - enumeration appends other hand profiles' plans, and a candidate is only acceptable if it is
   playable for the hands actually asked for (mutation test: request `small`, a 12-semitone dyad, filtered).
2. `badnessOf` no longer treats a failed critic as perfect: an errored/absent engrave, melody, harmony, voice-leading,
   register-density or level score counts as the worst (1). `null` remains neutral only where it means not-applicable
   (no original melody notes / no harmony windows) or deliberately deferred (`deferEngrave`, the cheap phase of the gate).
3. Empty pool returns `NO_CANDIDATES` (not `ALL_CANDIDATES_HAVE_HARD_VIOLATIONS`); the cache key now includes `reference`,
   `planOpts` and the `fullEngrave` mode, a cache hit returns a copy, and the engrave gate no longer mutates the caller's
   scored candidates (an optional `engraveCache` Map lets ablation re-selection reuse real engrave results).
4. `harness.js`: the per-file temp row file is deleted after reading; `--held-out` throws a clear error when 16+count >=
   the manifest length (61), where `sampleFiles` would return manifest order and disjointness would break; `legacy.js`:
   the `arrange_score.py` child has a 120 s timeout so a hung Python process cannot orphan.
5. Tests: new `tests/critics/candidates-gate.test.js` (top-K gating, skip-if-already-real, empty pool, ablation by a zeroed
   weight, an errored engrave cannot win, badnessOf worst-on-missing, cache key/copy) and a request-profile mutation test;
   `tests/critics` is now 29/29 (was 21/21). The header comment that cited a non-existent `ablation.test.js` now names
   `candidates-gate.test.js`.

**Re-measurement after these fixes: the numbers did not change.** 16-file sample (12 scored): G9a harmony root+quality
0.975 / root-only 0.978, level within ±1 10/12, mean |diff| 0.317, hard 12/12 zero, melody 1.000 - identical to the table
above. Held-out (32 files walked, 11 scored, 3 timeouts): G9a harmony 0.932 / 0.966, level within ±1 11/11, mean |diff|
0.255, hard 11/11 zero, melody 1.000 - identical. This is expected: the harness requests are hand profile `large`, where
the request-profile filter accepts a superset of what the candidate-profile filter did and the gate/badness fixes only
matter when a critic errors or the pool is empty, neither of which happened on these samples.

### G9b - repair (2026-09-30)

Node-only, nothing the app loads (§2/§10 unchanged); `git diff --stat origin/main` shows no app or server file. Done directly
(Read/Grep/Bash and ad hoc Node scripts in this worktree); no sub-agent was dispatched.

**What was built**
- `repair/plan.js` - the note-level planner: given a note list it proposes one *unit* (the edits to one measure) per detected smell,
  under declared constraints. `repair/index.js` - `repair(graph, ctx, opts)`, `repairSelection(selection, g, sg, request)`: applies a
  unit with `scoregraph/ops.js` `edit()` on a private copy, judges it against the real critics, commits it or discards it.
- `tests/repair/repair.test.js` (18 tests) + `npm run test:repair`. `realize/tools/harness.js` gained `--repair` (additive; needs
  `--g9a`) with a `g9aRepair` row and a `repair` summary block, and (fix pass) `--weights k=v,...` and a per-engine `voiceLeadingSmellsSum`.
- Outside `repair/`: `critics/voice-leading.js` (correction + refactor, below) and one added export (`overageOf`) in
  `critics/register-density.js`. `scoregraph/schema.js` is **unchanged** (`repaired` in `PROV_OPS` and `repair` in `SOURCE_KINDS` already existed).

**Ops - each detects only what a G9a critic detects.** Every pitch edit is an octave displacement (+-12/+-24) of one head: same letter,
same alteration, only `oct` changes, so spelling and pitch-class content are untouched.
1. `parallel` - `voice-leading.parallels`: the non-melody outer note of the second slice moves an octave (for a chord's lowest note
   this is the re-voicing: the chord turns one inversion).
2. `innerLeap` - `voice-leading.innerLeaps`: an endpoint moves an octave towards the other.
3. `crossing` - `voice-leading.crossings`: one of the pair moves 1-2 octaves to restore the order.
4. `dropDoubling` - `register-density` chord load: in a measure whose chord load exceeds the stage's ceiling, drop an octave doubling
   (LH: the upper duplicate; RH: the lower one). It does **not** touch notes-per-beat/density overage - that would mean deleting notes.

**Never touched / constraints (declared before any measurement):** a note that matches the request's original melody (same match as
`melodyPreservation`, tolerance 0.15 quarter; with no melody given, the top note of each onset slice); a head any tie, glissando (fix pass: was a latent gap), arpeggio or
performance link refers to; a grace note. A candidate must keep the moved note's own-line interval to its neighbours <= max(old, 9
semitones) (this is what stops an octave-doubled scale run being "fixed" into octave leaps - such a smell is left in place and
reported as `unplannable`); stay inside the piece's own overall pitch range and 21..108; not duplicate a pitch in the same hand
attack; introduce no new hand crossing; strictly reduce the note-level smell count without raising any category.
Tie-break is deterministic (fewest smells after, smallest shift, fixed candidate order).

**Rollback and guarantees (how each is tested)**
- *Per-measure rollback, "worse" defined up front* (header of `repair/index.js`), compared with the graph the unit was applied to, over
  every measure (an edit can land in the next): G5 hard-violation count for the **request's** hand profile, total or any code, up; any
  smell category up, or the unit's own target not reduced; per-measure harmony (root+quality windows) down; per-measure original-melody
  notes matched down; per-measure register/density overage up. Cumulatively against the input: piece density overage up; |level -
  target| grown by more than 0.05. A failing unit is thrown away (never committed, so there is nothing to undo). The G5 filter and
  melody are re-checked on the final graph (fix pass: the G5 check is now per code - no hard-violation code's count may rise, not only
  the total); a failure returns the input object.
- *Never adds a hard violation*: `tests/repair` "rollback" plants a re-voicing that lowers the smell count but makes a 20-semitone LH
  span, proves the unit really does add a hard violation when forced, and shows it is rolled back and the input comes back as the
  same object; a second test shows the same re-voicing accepted for `large` and rolled back for `small` (request profile, not the
  candidate's). A property check (ad hoc script, not committed; re-run after the fix pass on the corrected code) repaired every enumerated candidate
  of both samples under all three hand profiles: 241 runs (16-file sample: 39 changed, 145 units accepted, 2 rolled back) and 277 runs
  (held-out: 70 changed, 273 accepted, 43 rolled back) with **zero** violations of: hard total and every hard code not above the
  input's, melody preservation not below, harmony root+quality not below, smell count not above, idempotence, no fallback.
- *Provenance*: each edited head gets head-level `op: repaired` plus `asp.pitch`; its event gets `asp.pitch` (an event-level op would be
  inherited by untouched sibling heads - caught by a test); a dropped-doubling's event gets `asp.exists`. Source `{kind:'repair',
  tool:'ppp.g9b-repair'}`. Fingering is then recomputed once for the whole graph (`fingerGraph`, inferred heads only), since an octave
  shift changes what the finger DP sees - so unrepaired heads' fingers can also change; no metric covers fingering.
- *Melody, harmony*: melody notes are never edited (test asserts preservation 1.0 and that only whole-octave moves happened); harmony
  root+quality is unchanged on every measured file, and guarded per measure.
- *Determinism, idempotence*: sweeps repeat until one accepts nothing; test asserts byte-identical output twice and that repairing a
  repaired graph returns the same object.

**Measurement** (`--sample 16 --g9a --repair --timeout-s 120`, then `--held-out 32 ...`; outputs written outside the repo). Ops were
designed looking only at the 16-file sample; the held-out slice was run once, after the code was frozen, and is reported as is.
G9a's own 16-file numbers reproduce the round-2 record exactly (harmony 0.975/0.978, level 10/12, 0.317). All numbers in this section were re-measured after the fix pass below (the five acceptance metrics are identical to the first G9b run; the smell/inner-leap counts are not).

| 16-file sample, 12 scored | G9a | **G9a + repair** | ScoreArranger |
|---|---|---|---|
| hard violations (zero-files, mean) | 12/12, 0 | 12/12, 0 | 10/12, 0.92 |
| melody | 1.000 | 1.000 | 0.985 |
| harmony root+quality / root-only | 0.975 / 0.978 | 0.975 / 0.978 | 0.947 / 0.956 |
| level within +-1, mean abs diff | 10/12, 0.317 | 10/12, 0.317 | 10/12, 0.304 |
| engrave L1/L2 | 12/12 | 12/12 | 12/12 |
| voice-leading smells (files with any) | 26 (2) | 19 (1) | - |
| register/density overage (sum) | 0.339 | 0.339 | - |

| Held-out, 32 walked, 14 scored, 0 timeouts | G9a | **G9a + repair** | ScoreArranger |
|---|---|---|---|
| hard violations (zero-files, mean) | 14/14, 0 | 14/14, 0 | 9/14, 1.50 |
| melody | 1.000 | 1.000 | 0.974 |
| harmony root+quality / root-only | 0.9345 / 0.9651 | 0.9345 / 0.9651 | 0.966 / 0.969 |
| level within +-1, mean abs diff | 14/14, 0.2079 | 14/14, **0.2086** | 14/14, 0.451 |
| engrave L1/L2 | 14/14 | 14/14 | 14/14 |
| voice-leading smells (files with any) | 40 (6) | 26 (5) | - |
| by category: parallels / inner leaps / crossings | 20 / 0 / 20 | 16 / 0 / 10 | - |
| register/density overage (sum) | 0 | 0 | - |

Repair counts. 16-file sample: 1 of 12 files repaired (6 units, 6 measures, all `parallel`), 0 rolled back, 19 smells left as
`unplannable` (all `beyer/007`: a verbatim LH doubling the melody in octaves through a scale run). Held-out: 5 of 14 files repaired
(13 units / 12 measures: parallel 3, crossing 10); 3 files had rollbacks (12 units / 6 measures: parallel 8, crossing 4 - all 12 by the
G5 hard guard `SPAN`); 14 smells left unplannable; no fallback and no truncation on either sample. `dropDoubling` never fired on real data (the only over-band feature on
either sample was notes-per-beat/density on `sonatina/003`, which it cannot fix) - it is tested on planted fixtures only. Repair cost
25 ms mean (107 ms max) on the 16-file sample, 79 ms mean (536 ms max) on the held-out slice.

**Stated plainly.** Repair does what it is built to do and nothing else: on the held-out slice it removed 14 of 40 counted smells
(crossings 20 -> 10, parallels 20 -> 16), and no other measured metric moved except mean level distance by +0.0007 (0.2079 -> 0.2086: one file,
`sonatina/004`, 3.46 -> 3.45 against a target of 3.87, i.e. 0.01 further away, inside the declared 0.05 slack). On the 16-file sample it changed one file.
The only thing it improved is the voice-leading smell count - the critic its own ops are written against - so this is *not*
independent evidence that the output is better music; it shows only that the smells the critic can see are fixable at no measured
cost. Whether a hymn with the bass re-voiced sounds better is exactly what H-8/H-9 (§5 G9c) are for. It also does not touch the
gap that matters for §6: harmony still loses to ScoreArranger on the held-out slice (0.9345 vs 0.966), and repair cannot change that
(harmony is a guard here, not a target).

**Corrections to the design text and to G9a, found while reading the code**
1. **G9a's voice-leading critic counted a lone note as a "parallel octave".** `outerOf` treated a slice with one attacking note as
   hi === lo (a unison) so every same-direction step of a single line was a parallel. Fixed in `critics/voice-leading.js` for
   PARALLEL detection only (`outerPairOf`: two outer voices need two attacking notes; tests pin it; a real two-voice unison is still a
   parallel). On the round-2 selected graphs of the 16-file sample the parallel count falls from 844 (G9a rule) to 26 (re-measured
   in the fix pass). Selection is unaffected in the shipped pipeline (`voiceLeading` weight is 0 by default): re-running G9a
   reproduced the round-2 row exactly. **Consequence for §12 G9a round 1 and round 2:** the ablation ("removing voiceLeading is a
   Pareto improvement") and its round-2 "replication" were measured on the inflated count; they are marked superseded in place and
   re-measured with the corrected critic (see "Voice-leading ablation, re-measured": a trade-off, not a Pareto win either way). The
   critic still compares only attack slices (a sustained bass under a moving melody is invisible to it), so the corrected count
   under-reports rather than over-reports.
2. **§4 says G3's rollback loop is reusable; only part of it is.** `pro-critic.js` `fingerprint`/`diff` are reused (a structural check
   over the components a pitch edit may not change). `C.check(before, after, may)` cannot be used: it deletes `onsets` (and every FIXED
   component) from what a pass may declare, and `onsets`/`sound`/`place` carry pitch. G3's shape - "run all, find the offending
   measures, re-run without them" - is also not used as such: repair units are applied one at a time and the rejected one is simply
   not committed (same per-measure guarantee, simpler, and adjacent units cannot mask each other's failure).
3. **§5's example "drop a doubling that breaks a density band" is narrower than it reads.** Only chord load is fixable that way;
   the register/density critic's over-band features on real files are notes-per-beat and density, which need notes removed.
4. Real corpus, both samples: the smells that exist are almost all parallels between outer voices (16-file: 26 parallels, 0 leaps,
   0 crossings). Crossings (20) appear only on the held-out slice; the selected graphs of neither sample have an inner leap.
5. The held-out slice scores 14 files now (round 2 recorded 11 with 3 legacy timeouts): TD15 (#93, merged before this branch) fixed
   the `ScoreArranger` hang on `christ-arose`, `god-rest-ye-merry` and `burgmuller25/019`, so all three now score. G9a's own code is
   unchanged; its held-out numbers are re-stated above for the 14-file set (harmony 0.9345/0.9651, level 0.2079), not the 11-file ones.

**Deviations from the brief:** the G5 filter runs over the whole graph and is compared measure by measure (VELOCITY and holds cross
measure lines), not only on the edited measure; an extra piece-level level/density guard; `--repair` requires `--g9a`;
`opts.seedUnits` is a public test hook; `critics/` was edited (item 1) though the brief was silent on it.

**Known limits.** (a) The planner does not pre-check hand span, so on the held-out slice 12 of 25 attempted units were wasted on a
candidate the G5 guard then rejected, where another shift might have worked; a span check in `bestShift` is the obvious follow-up
(not done after the held-out run, to keep it a single untuned look). (b) The note-level crossing check uses the input's register
averages; the real critic recomputes them, so a unit can pass the planner and fail the recount (rolled back correctly; it happened on
two units in the first G9b run, on none in the re-measured run).
(c) Only octave displacement and dropping a doubling exist: no chord-tone substitution, no rhythm change, no inner-voice re-spelling.
(d) A repair is judged on the measures' critics, not on how it sounds. (e) Melody protection is by onset+pitch match, so an
accompaniment note that coincides with a melody note is also protected (conservative). (f) `sonatina/003`'s density overage and
`beyer/007`'s octave-doubled run stay as they were, by design.

**G9b fix pass (2026-09-30, after independent review).** The reviewer verified the repair guarantees (hard violations never rise, melody
unchanged, whole-octave moves only, provenance, determinism, idempotence) and reproduced the numbers, and found:
1. **A regression my own G9b change to `critics/voice-leading.js` introduced.** The first version put the two-note-slice rule inside
   `outerOf`, which `innerVoiceLeaps` also uses to exempt outer voices; so a LONE bass or lone melody note became an INNER voice.
   Synthetic `C4 C6 C4 C6` melody leaps went from 0 to 3 inner leaps; corpus candidates gained inner leaps (e.g. a waltz bass note
   leaping 21 semitones to the chord in `beyer/001`), and `repair` then "fixed" them by moving real bass notes up an octave, which the
   first version of this section counted as accepted `innerLeap` units. Fix: `outerOf` is restored to its G9a behaviour (a lone note is
   still outer for the leap smell) and the new rule lives in a separate `outerPairOf`, used only by `parallelFifthsOctaves` and
   `repair/plan.js planParallel`. Tests added: a lone bass leap, a lone melody leap and the waltz shape are NOT inner leaps; the planted
   true inner-voice leap still is; a lone melody note is still not a parallel (the original bug stays fixed). With the fix reverted,
   the new test fails (the lone melody leaps are counted as 3 inner leaps).
2. **Stale G9a claims** contradicting the corrected critic were marked superseded in place and the ablation re-measured (above); the
   weights comment in `candidates/index.js` was rewritten to say its stated reason no longer holds.
3. **Minor:** the final check in `repair/index.js` is now per hard-violation code (no code's count may rise; before, only the total);
   `gliss` spanner ends are now locked in `repair/plan.js annotate` like tie and arpeggio heads (a test plants a glissed bass note that
   would otherwise be re-voiced).
4. **Before vs after, re-measured.** The five acceptance metrics are unchanged on both samples (hard, melody, harmony, level, engrave -
   identical to the first G9b run). What changed is the voice-leading accounting on the held-out slice: smells before repair 42 -> 40,
   after 27 -> 26; inner leaps before 2 -> 0 (both were the regression's false leaps), after 1 -> 0; accepted units 14 -> 13 (`innerLeap`
   accepted 1 -> 0), rolled back 14 -> 12 (`innerLeap` rolled back 2 -> 0; the 12 left are all `SPAN`); repaired measures 13 -> 12.
   The 16-file sample is unchanged (26 -> 19 smells, 6 `parallel` units accepted, 0 rolled back).
5. **Fingering is recomputed for the whole graph, not only for repaired heads.** `repair` re-runs `fingerGraph` (inferred heads only)
   once on the repaired graph, so an unrepaired head's inferred fingering can also change. The reviewer's cross-profile runs saw 759 and
   1,633 heads change fingering across the two samples' candidate sets (their count; not re-derived here). No acceptance metric covers
   fingering, so whether this makes fingerings better or worse is **unmeasured**.

### G9c - blind review tooling (2026-09-30, revised after independent review)

Step 1 of G9c: the tooling only. **No review was run and none needs the user's time yet**; `docs/PPP_MASTER_ROADMAP.md` and every
other roadmap file are untouched. Node-only, nothing the app or server loads (`git diff --stat origin/main` shows no app or server
file; the only existing code file touched is `realize/tools/harness.js`, which now also exports `findG8Plan` and `bestLegacyRun`
so the builder reuses them instead of copying them). Everything was done directly; no sub-agent was dispatched.

**Independent review of the first version (commit `6fa5133`): needs changes; all of it fixed here.** (1) BLOCKER: a piece shown at
two levels repeated the same ScoreArranger notes (it has four native levels), so "the repeated side" was the legacy arm - 12 of 14
two-level items gave the arm away without the key - and 16 items covered only 9 pieces while the decode treated them as 16
independent. (2) A weak seed was recoverable from the manifest alone (order = plain HMAC sort; a reviewer found `hello` in one guess;
minimum length was 4). (3) Unreported confounds: G9's extra notes are almost all left hand, ScoreArranger misses the requested level
more, and the page said "both aimed at level N". (4) G9-only audio artifacts: the same pitch struck by both hands at one onset
sounded louder; ties were re-struck. (5) The default key directory sat beside the packet, so zipping the folder would ship it; the
browser download had not been exercised for real. Fixes are described below.

**What it is.** `review/` builds, for a list of `(input file, G6 level, hand profile)` items, a blind packet comparing two
arrangements of the same piece at the same target: the **current G9 pipeline** (G9a `run` - best-of-N with the engrave gate - then
G9b `repairSelection`, all defaults, at the request `{targetLevel, handProfile, sections:'all'}`, the wiring `harness.js runFile`
uses for `g9aRepair`) against the **legacy comparator: the app's in-page `ScoreArranger`** at the one of its four native levels
whose measured G6 position is closest to the same target (`harness.js bestLegacyRun`). ScoreArranger is compared because it is the
strongest legacy engine on the harness metrics (G8a/G9 measurements above) and is the engine the app runs in the page;
`arrange_score.py` and `audio-score.js` did worse, so beating ScoreArranger is the conservative test. It runs in a child process
with a 120 s limit (TD15: it has hung on real pieces); a timeout drops the piece.

**Build and use.** `node review/build.js --mode h8|h9 --out <dir> --key-out <dir> [--seed <secret>]`; details in `review/README.md`.
`--out` must be outside every git working tree (the repository and any other checkout are refused before any work); nothing
generated is committed. **`--key-out` is required** and must be a different tree: not inside `--out`, not containing it, and not
inside its parent folder (`review/build.js` `planOutputs`; siblings are refused because zipping their common folder would ship the
key). **`--seed` is optional: omitted, a random 32-hex-character seed is made; given, it must be at least 20 characters** (a
short seed is guessable from the manifest's item order); either way it is written only to the key. The packet is `index.html`
(one self-contained offline page: inline CSS/JS, both scores as engraved SVG drawn Node-side by `engrave/`, a small Web Audio
synth per arrangement, the rating form, `localStorage` persistence, a JSON download button plus the same JSON in a box) and
`manifest.json`. The key (`key.json`) holds the seed, which of X/Y is G9 per item, each arm's measured level, the input tier, and
the **strata** (drawn-note counts, left-hand notes, note-count ratio, level miss) that `decode.js` splits by - none of it in the
packet. `node review/decode.js --key ... --ratings ...` joins them (below).

**How the user will review.** Open `index.html` from disk. H-8 (diagnostic): per item, X and Y as scores plus Play, then "which is
better" and, per arrangement, issue boxes (too hard, too easy, wrong harmony, melody unclear, awkward hand position, thin/muddy)
and a short note. H-9: Pass/Fail per arrangement ("would you give this to a student"), optional preference. Download the ratings
file and send it back. The reviewer names a role, not a person. The page says the level was *requested*, that neither arrangement
is guaranteed to land on it, and to mark "too easy/too hard" only if it would be so for a student at about that level. The
roadmap's own time estimates for H-8/H-9 are unchanged and untested here.

**How the blinding works, and how it is tested.** Assignment and shown order come from HMAC-SHA256 keyed with the secret seed
(`review/lib/blind.js`; the rule is public, replaying it needs the seed). Assignment is balanced (items ranked by the HMAC, even
ranks show G9 as X), so position bias cannot pass for a preference. Both arms are re-drawn through ONE path
(`review/lib/neutral.js`): flat notes only (measure, beat, duration, pitch spelling, staff, hand), voices re-derived from the
notes, one measure list/tempo/layout config, every `data-*` attribute removed from the SVG, glyph ids naming only item and label.
The sound: for both arms a tied continuation is joined to the note it continues, and one pitch struck by both hands at one onset
sounds once (`audioNotes`; the drawn score is unchanged - so a tied note is two drawn notes on both sides). **No side of any item
is identical to a side of another item**: the builder throws if one is, and a test checks every packet. `npm run test:review`
also includes: a byte-level scan of every file of an H-8 and an H-9 packet for `g9`, `legacy`, `scorearranger`, `arrange_score`,
`selected`, `repaired`, `repair`, `candidate`, `critic`, `realiz`, `engine`, pattern names and the seed; byte-identical packet and
key for the same seed and items in any listing order; a different seed changes assignment and order; the split is even; an unkeyed
guess does not reproduce it; short seeds refused and an omitted seed random and key-only; identical field sets for X and Y in the
manifest, the page data and the SVG root attributes; no `data-*`, fingering, tempo or dynamic marks in any SVG; no external URL,
request, import or `<link>`; `--out`/`--key-out` inside the repository or another git working tree refused, `--key-out` required,
and key/packet nesting or sharing a parent folder refused; decode attributes ratings to the right arm, flips correctly, counts
ties/unrated, refuses a mismatched packet or mode, counts a piece once, and splits by strata; the legacy level in the key is the
argmin re-derived independently; and, in headless Chrome, both scores of every item render, the form works, ratings survive a
reload, the export is valid JSON, Play/Stop run without error, no network request is made, the page works when storage is refused,
and **the real Download button writes a real file through the browser's own download path** (puppeteer `Browser.setDownloadBehavior`;
not a stub). Mutation checks: a forbidden word in either page title, and a removed `data-*` strip, each fail the tests.

**Decode: what it reports (`review/decode.js`).** Preference is counted per item, but the test unit is the **piece** (two items of
one piece are not independent): a piece counts as G9 / legacy / tie by which arm won more of its items, and the Wilson interval and
exact sign test are over decisive pieces; there is no item-level p-value. Pass rates and the paired McNemar table are over pieces
(a piece passes an arm only if every rated item of it does), item counts beside them. Preference and pass numbers are also **split
by note-count ratio (G9 fuller at ratio >= 1.1 / similar / legacy fuller) and by which arm missed the requested level by more**,
descriptive only, plus the confounds (mean level miss per arm, how much of G9's extra notes are left hand) and caveats, in plain
language: the arm is often guessable from density, so preference is confounded.

**What H-8/H-9 can and cannot support.** They can say whether *this reviewer* prefers G9's notes to ScoreArranger's on G7b-plannable
pieces at hand profile large, where each arm falls short (H-8), and what share of each arm this reviewer would hand to a student
(H-9). They **cannot** show that G9 is generally better: blinding does not hide the arm on most items, and preference is confounded
with density (G9 is fuller), left-heavy voicing (G9's extra notes are left hand) and level miss (ScoreArranger misses the requested
level more), none of which the design separates; one reviewer, about 16 units, wide intervals, one legacy engine. They say nothing
about touch, pedalling, phrasing, fingering (not shown), or medium/small hands (only `large` is reachable).

**What is NOT hidden, measured on the two rebuilt sample packets (random seeds): the music.** By drawn-note ratio, G9 is the fuller
arm in 12 of the 13 H-8 items and 10 of the 11 H-9 items whose densities clearly differ (ratio >= 1.1 or <= 0.9); by SVG length a
reader would have been right on 11 of 16 and 10 of 16, by sounding-note count on 12 of 16 and 11 of 16. Mean absolute miss of the
requested level: H-8 G9 0.21 vs ScoreArranger 0.54, H-9 0.27 vs 0.48. G9's left-hand notes beyond ScoreArranger's exceed all of its
extra notes (126% and 144%: it also has slightly fewer right-hand notes). No tooling can make two different arrangements look
alike; the tests close every other channel.

**Inputs (the documented rule; `review/lib/select.js`, `review/README.md` "Which pieces").** Pool = the 61 files of
`tests/engrave/corpus.json`. Usable only if it really runs: 8-40 bars; a G7b plan exists (`findG8Plan`; 27 of the 61 have none,
the binding limit); G9 returns an arrangement; ScoreArranger returns at all four levels within the limit (no timeouts); the two
arms are not the same notes at the level reviewed. Of the 34 reachable files, 5 fall outside 8-40 bars and 3 give identical arms
at every level, leaving about 26 usable pieces. Files are tried in a fixed order - tier 0 (never in any G9 measurement, 13 files)
before tier 1 (the 32-file held-out slice) before tier 2 (the 16-file tuning sample), strata round-robin,
`sha256("g9c-inputs-v1:" + path)` inside a stratum - and H-9 additionally prefers pieces not used for H-8. **Overlap with the
measurement samples, stated plainly (the two rebuilt sample packets):** **H-8 = 16 items over 16 pieces** (6 tier 0, 10 tier 1,
**0 from the tuning sample**); **H-9 = 16 pieces** (5 tier 0, 9 tier 1, **2 from the tuning sample**: `hymns/all-glory-laud`,
`hymns/all-creatures`), and **13 of H-9's 16 pieces are also in H-8** - H-8 now uses 16 of the ~26 usable pieces, so an H-9 with no H-8
repeat cannot exist; the rule spends the repeats before the tuning sample. A reviewer doing both sees most pieces twice (X/Y are
independently assigned per packet). Every piece is at hand profile `large`.

**H-8 is no longer "8 inputs x 2 levels".** A second level for a piece is kept only if BOTH arms change (G9 fuller - G6 level at
least 0.25 higher or 1.1x the notes - and ScoreArranger's notes different from its own at the first level; `levelItems`). On the
current corpus none qualifies, so H-8 is 16 items over 16 different pieces at one level each. That is the price of independent
items and of no repeated side; H-8 now measures breadth over pieces, not a level axis. (Before the fix H-8 had 7 two-level pieces
and 9 pieces in all - the source of the blocker.)

**Findings while building (not fixed; they matter for G9e).**
1. **A realized (G8a/G9) graph carries no printed-accidental information.** In `what-child-is-this` at 3.46 the G9 graph has 47
   altered heads and 0 with `head.acc`; engraved as it is, it draws 0 accidentals (the original graph: 39 altered heads, 8 printed,
   16 accidentals drawn) - a chromatic D# in D major reads as D natural. ScoreArranger's output carries the app's own accidental
   marks. The review packet recomputes accidentals from spelling and key for both arms (`neutral.js`), so it is unaffected, but
   **G9e must not put a G9 graph on screen through the engraver without deciding where the accidentals come from.**
2. **Both arms often do not reach the requested target** (means above; `findG8Plan` often returns the piece's own level + 1 as the
   request, which neither can reach).
3. G9 puts the same pitch in both hands at one onset (up to 15 pairs in `god-rest-ye-merry`); ScoreArranger almost never. It is
   deduplicated in the sound only, not in the drawing or in G9's output.
4. G9's fingering is not shown (and not judged) by design.

**Sample run (proof the tools work end to end; outputs under the OS temp dir, not committed).** Real H-8 and H-9 packets rebuilt
with random seeds (69 s and 74 s, run in parallel, including the selection walk; H-8 packet 2.28 MB, H-9 2.37 MB). Headless Chrome
(puppeteer) on both: 16 items and 32 scores per page, every score rendered with real size, no console error, no external request;
all 16 items rated survived a reload; the real Download button wrote `ratings-<mode>-<packet id>.json` to a download folder, and
`decode.js` joined it with the key. **Audio: Play/Stop were exercised and raised no error, but nobody has listened to the synth;
whether it sounds acceptable is unverified.**

**Limits.** One reviewer; about 16 units per review (wide intervals); only G7b-reachable pieces at hand profile large; one legacy
engine; the pieces are public-domain catalog scores already in the repository (nothing new is copied anywhere); `localStorage` is
per browser, so the reviewer must finish on one computer or export as they go; the sound is a plain synth; a `--seed` given on the
command line is visible in the builder machine's process list and shell history (omit it to avoid that). A second independent
review of the revised builder is advisable before a packet is trusted.

### H-8 result (2026-09-30, first blind human review; one reviewer, the user)

Packet `a6c3d082e300`: 16 pieces at one level each, hand profile large, G9 (best-of-N plus repair) against the legacy ScoreArranger, 15 of 16 rated
(item 12 left without a preference). The reviewer's notes are in Korean; the substance is below.

**Preference (counts only; too few and too confounded for a test):** G9 5, legacy 4, no difference 6, unrated 1. Piece-level sign test p = 1.
G9 was preferred on 4 of 5 hymns it won (when-i-survey, the-strife-is-oer, god-rest-ye-merry, christ-arose) and czerny599/032; legacy was
preferred on four method pieces (beyer/038, sonatina/025, burgmuller25/006, beyer/020), all four where G9 was flagged awkward-hand. Where legacy
missed the requested level by more (9 items), the reviewer preferred legacy 4 times and G9 once.

**What the reviewer flagged (this is the useful part):** "awkward hand position" on 8 G9 arrangements and 7 legacy arrangements, with different causes,
checked against the note data of the packet:
- **G9's problem is a bass that goes too low.** Flagged G9 arrangements: lowest note mean MIDI 34, mean 24.9 notes below E2 (MIDI 40); unflagged G9: lowest
  mean 39, 6.1 notes below E2. Worst cases: sonatina/025 (lowest MIDI 30, 98 notes below E2), pass-me-not (45), beyer/061 (22), burgmuller25/016 (17). The
  reviewer's words: the low notes are "too low". No current critic or hard filter has a register floor (G5's hard violations are about hand span, and the
  register-and-density critic scores overage against G7b's per-stage bands, not the floor), so G9 scored 0 hard violations on all of them.
- **Legacy's problem is wide left-hand chords** (a tenth or more between simultaneous left-hand notes: 5 groups in nearer-my-god, 3 in god-rest-ye-merry,
  4 in christ-arose): flagged legacy arrangements have mean maximum left-hand span 11.9 semitones against 4.4 unflagged. The reviewer: "an octave or tenth
  is too far".
- **Both arms:** burgmuller25/019 has its lowest notes at MIDI 25 in BOTH arms (the source piece itself goes that low).

**Engraving findings that affect both arms (not G9 quality):** high notes are drawn on many ledger lines with no 8va (items 11 and 12) and low notes with no 8vb;
simultaneous notes in one staff show odd stems or tails (items 3 and 5); a low note's drawing looked wrong (item 1). Recorded as TD16 and TD17 in the roadmap.

**What this does and does not show:** it shows two concrete defects in the arranged output, one per arm, that the harness cannot see (the harness scores
hand span and level, not register floor). It does not show G9 is better or worse overall: one reviewer, 16 pieces, an arm that is often guessable from density
(see the G9c section), a level miss that differs between arms, and no preference in 6 items. H-9 has not been run.

### G9 register floor (post H-8)

The fix for the defect H-8 found in G9's output (a bass that goes too low). Node-only: `git diff --stat origin/main` shows no app or server
file and no roadmap file. It does touch `realize/theory.js` and `realize/index.js`, which the app also loads for the `PPP.arranger` switch; the
switch defaults to `legacy`, so nothing visible changes until the user flips it. The legacy arm and G5's hard-violation definitions are
untouched. Done directly by one writer; no sub-agent was dispatched.

**1. Where the low notes came from (measured before changing anything).** For the eight pieces the reviewer named (plus burgmuller25/019 as
a control), G9 (best-of-N, then repair, at the H-8 packet's own requests) was re-run and every note below E2 (MIDI 40) was classified as
source (the same pitch at the same onset exists in the original piece) or generated. The counts reproduced the reviewer's exactly (98, 45, 22,
21 after repair, 17, 8, 6, 4 after repair).
- **In all eight, every low note was generated, none was source, and every one was the bass of the `pop` or `waltz` pattern.** Both place the
  bass at `nearestWithPc(root, anchor - 12)`, one octave under the midpoint of the section's left-hand band (often 48), so the bass lands
  anywhere from 30 to 42 depending on the root. Per piece: sonatina/025 pop 98, pass-me-not pop 45, beyer/061 pop 22, burgmuller25/006 pop 22
  (21 after repair), burgmuller25/016 waltz 17, nearer-my-god waltz 8, what-child-is-this waltz 6, beyer/020 waltz 5 (4 after repair).
- Over the pool of candidates each piece offered, `block`, `broken`, `ballad` and `hymn` had no generated low note on these pieces (`auto` had a
  few in two: 3 in beyer/061, 6 in what-child-is-this); on sonatina/025 pop had 98, waltz 14, the rest 0. G9a picked the pop or waltz candidate
  because nothing scored register.
- **Not the cause:** an octave doubling of the bass (the realizer generates none; the `dropDoubling` repair op only removes one), the bass
  placed relative to the melody, other hand profiles (all nine were chosen at `large`, the request's own), and repair (in these nine pieces it
  never increased the count, and `repair/plan.js` already refuses to go below the piece's own lowest note).
- burgmuller25/019: its 14 notes below E2 are source (`hymn` copies the voices verbatim; the piece itself goes down to MIDI 25), which is why
  both arms had them. One of the 14 is a source note that repair lifted from 25 to 37 (see below).

**2. What changed.**
- `realize/theory.js`: `REGISTER_FLOOR = 40` (E2), a named constant commented with where it comes from (the H-8 review), and
  `floorMidis(midis, floor, maxSpan)`.
- `realize/index.js`: every event a pattern generates goes through `floorMidis` just before its heads are written; the copied melody voice and
  every `hymn` voice are copied verbatim, never floored. `opts.registerFloor` overrides the floor; `null` turns it off (the pre-floor
  behaviour exactly: verified below). `report.floor` counts what happened (`eventsRaised`, `notesRaised`, `notesMerged`, `eventsShifted`,
  `eventsDegraded`, `notesDegraded`).
- `critics/register-floor.js` (new) and `critics/index.js`: the critic `registerFloor` = arranged notes below the floor (`belowSource` reports
  source notes below it, never a defect). `candidates/index.js` feeds it the original piece's notes and threads `opts.registerFloor` to the
  realizer. Its selection weight is **0** (report only): the realizer already makes every non-degraded candidate read 0, so there is nothing
  for selection to separate, and no weight had to be tuned. It is not a hard filter, because a degraded piece would then have no arrangement at
  all. `--weights registerFloor=1` counts it.
- `repair/plan.js`, `repair/index.js`: the guard `belowFloor(from, to, floor)`: a repair may never put a note below the floor, nor lower a note
  that is already below it; it may move one up, even if still short of the floor. Checked in the planner (`candidateOk`) and again on the unit
  itself in `tryUnit`, so a seeded unit is held to it too (reason `BELOW_FLOOR`). `ctx.registerFloor` overrides it, `null` turns it off.
- `realize/tools/harness.js`: `--register-floor N|off`, and the new metric on every engine's row and in the summary (`floorBelowArranged`,
  `floorBelowSource`, `floorFilesWithArrangedBelow`, and before/after repair).

**3. Floor semantics.** Applies to notes the realizer GENERATES, per event: (1) each pitch below the floor is raised by whole octaves (pitch
class kept); a pitch landing on one the event already has is merged into it (same key, so no pitch class is lost); (2) if that would break the
event's span for the hand profile (G5's `MAX_SPAN`), the whole event is instead shifted up by the fewest octaves that clear the floor
(intervals and span kept). Source notes are never touched: the melody voice and `hymn` voices are byte-identical at any floor, so a piece that
itself goes below E2 keeps those notes as written. **Degradation:** if the raise would put a left-hand note at or above the melody note the
right hand is sounding then (a hand crossing the source did not have), the event is left as generated and counted in `report.floor`. Pitch
classes and onsets of every attack are unchanged (tested). The floor is applied to what is written, not to the state the next chord is voice-led
from. Deterministic and idempotent (a floored event is already at the floor; tested).

**4. Numbers, before and after** (`node realize/tools/harness.js --sample 16 --g9a --repair --timeout-s 120` and `--held-out 32 ... --timeout-s
180`; outputs kept outside the repo). "Before" is a clean checkout of `59709c0`; the same run of this code with `--register-floor off` gave
identical values on every metric of every engine, so the off path is the old behaviour. 12 of 16 and 14 of 32 files have a reachable G7b plan
(the rest are "no reachable G7b plan"; none timed out). The rows are G9 after repair (`g9aRepair`), the arm H-8 showed.

| | 16-file sample before | after | 32-file held-out before | after |
|---|---|---|---|---|
| hard violations (files at 0) | 12/12 | 12/12 | 14/14 | 14/14 |
| G6 level within +-1 / mean distance to target | 10/12 / 0.3167 | 10/12 / **0.3258** | 14/14 / 0.2086 | 14/14 / **0.3386** |
| melody preservation (mean) | 1.0000 | 1.0000 | 1.0000 | 1.0000 |
| harmony root+quality / root-only | 0.9753 / 0.9778 | 0.9753 / 0.9778 | 0.9345 / 0.9651 | **0.9316 / 0.9619** |
| engrave silent / hard layout (files at 0) | 12/12, 12/12 | 12/12, 12/12 | 14/14, 14/14 | 14/14, 14/14 |
| arranged notes below E2 (files with any) | 96 (1) | **0 (0)** | 178 (8) | **1 (1)** |
| source notes below E2 (unchanged by design) | 10 | 10 | 14 | 14 |

**Hard violations, melody and both engraving counts did not move. Two metrics regressed slightly, and I did not tune around them.**
(a) **G6 level, mean distance to the target:** +0.0091 on the 16-file sample (still 10/12 within +-1) and **+0.1300 on the held-out slice
(0.2086 to 0.3386; still 14/14 within +-1)**. (b) **Harmony agreement on the held-out slice:** root+quality -0.0029, root-only -0.0032 (16-file
sample: unchanged). G8a alone (no selection) moved the other way on the same runs: level distance 0.7150 to 0.6592 (16) and 0.5229 to 0.5100
(held-out); harmony 0.9294/0.9457 to 0.9305/0.9468 (16), unchanged (held-out).

Where the held-out level distance comes from: 5 of the 14 files moved (a sixth, nearer-my-god, only changed pattern), for two causes. Same
pattern, lower assessed level: burgmuller25/006 (pop, 3.46 to 3.10) and czerny599/027 (pop, 3.38 to 2.87); the 16-file sample's all-creatures
did the same (2.87 to 2.76). Selection moved to another pattern: sonatina/004 and burgmuller25/016 (waltz to pop; harmony in 016 0.861 to
0.806) and pass-me-not (pop to auto, level 3.46 to 2.87). For czerny599/027 and burgmuller25/006 the G6 features that fell are the ones a very
low bass feeds: `range` (60 to 46 and 55 to 48), `strainRate` (6.9 to 0.9 and 7.1 to 5.2), `strainPeak` and `fingerCostLH`. So G6 rated the
old low-bass arrangements HARDER because they were awkward to play, which is what the reviewer said; the floored ones are measurably easier
by G6, so they land further from a target set at the piece's own original level. That reading of the feature deltas is measured but is an
interpretation, not a test. Whether the old level closeness was partly an artefact of awkward low notes, and whether G9a should compensate
with a level offset, is a question for the Lead.

The eight named pieces at the H-8 packet's own requests (G9 after repair; arranged notes below E2, lowest note, pattern G9a chose):

| piece | before | after | lowest before to after | pattern |
|---|---|---|---|---|
| method/sonatina/025 | 98 | 0 | 30 to 40 | pop to waltz |
| hymns/pass-me-not | 45 | 0 | 32 to 44 | pop to auto |
| method/beyer/061 | 22 | 0 | 36 to 42 | pop |
| method/burgmuller25/006 | 21 | 0 | 33 to 40 | pop |
| method/burgmuller25/016 | 17 | 0 | 30 to 40 | waltz to pop |
| hymns/nearer-my-god | 8 | 0 | 31 to 43 | waltz to pop |
| hymns/what-child-is-this | 6 | 0 | 35 to 40 | waltz |
| method/beyer/020 | 4 | 0 | 38 to 40 | waltz |
| (control) method/burgmuller25/019 | 1 (+13 source) | 1 (+13 source) | 25 to 25 | hymn |

Per file in the two samples (the harness's own requests), arranged notes below E2 before to after: 16-file sample: all-creatures 96 to 0, the
other 11 reachable files 0 to 0. Held-out: sonatina/004 39 to 0, czerny599/027 46 to 0, burgmuller25/006 21 to 0, burgmuller25/016 17 to 0,
nearer-my-god 8 to 0, pass-me-not 45 to 0, christ-arose 1 to 0, burgmuller25/019 1 to 1, the other 6 files 0 to 0.

**Still below E2 in the G9 output, and why.** 16-file sample: 0 arranged, 10 source (sonatina/001 6, gymnopedie-1 4: the source's own notes).
Held-out: 14 source (burgmuller25/019 13, czerny849/023 1) and **1 arranged, which is not a degraded event**: in burgmuller25/019 (a `hymn`
piece, so every note is a copy of the source) repair lifted one source note from MIDI 25 to 37 (allowed: an upward move), and because it no
longer equals a source note the critic counts it as arranged while it is still under the floor. **Degraded events: 0.** Across the 184
candidates the two samples enumerate (`enumerate`, default pool) the floor raised 3,398 notes in 3,345 events (pop 2,059; `auto` 921, which
resolves per section to waltz, block or broken; waltz 330; ballad 59; broken 15; block 14; hymn 0), merged 0, shifted a whole event 0 times and
degraded 0. So the merge, whole-event-shift and degradation paths are exercised only by unit tests (synthetic events, and an absurd floor of
84), not by any corpus piece: protective code, not measured behaviour.

**Tests** (all pass): `tests/realize/register-floor.test.js` (11: the constant; `floorMidis` for a single note, a chord, a merge, the span
fallback, the no-op, idempotence; the floor on sonatina/025 under every pattern with pitch classes, onsets, melody and G5 hard violations
checked, and the unfloored realizer shown to be low there; burgmuller25/019's source notes byte-identical even at floor 100; the override;
degradation at floor 84; determinism), `tests/critics/register-floor.test.js` (8: counting, source versus arranged, no source given, the
option, an empty graph, determinism, `evaluate`, weight 0 in selection, and G9a plus G9b end to end on sonatina/025 and pass-me-not with the
floor on and off), `tests/repair/register-floor.test.js` (5: the `belowFloor` truth table; a planted octave-down refused with the guard and
accepted without it; an upward move of a low note allowed and a downward one refused; the default floor; determinism and idempotence).
`test:realize`, `test:critics`, `test:repair`, `test:review`, `test:arrangement-planner`, `test:playability`, `test:difficulty` and
`test:songgraph` all pass.

**Known limits.** (1) The G6-level and held-out-harmony regressions above are real and unresolved. (2) The floor is one MIDI number (E2),
chosen from one reviewer's reaction to 8 flagged pieces; the reviewer said "too low" and "hard to read", not "below E2". (3) It does not address
the wide left-hand chords in the legacy arm, the engraving of very low or high notes (TD16/TD17), or readability just above the floor.
(4) The critic cannot tell an arranged note from a source note a repair moved; the one such note is counted as arranged. (5) A generated note
equal to a source note (same onset, same pitch) counts as source. (6) No human has re-reviewed it: all that is shown is that the notes the
reviewer called too low are gone and the five metrics moved as above; whether the floored bass reads better is unknown until the next review.
(7) `realize/` is loaded by the app; the change reaches users only through the `PPP.arranger` switch, which defaults to `legacy`. Not deployed.

### G9 left-hand jumps (post H-8 re-look)

The fix for the defect the register floor did not fix: the bass of G9's `pop` and `waltz` arrangements leaping an octave or more between consecutive
left-hand onsets. Node-only: `git diff --stat origin/main` shows no app, server or roadmap file. It touches `realize/patterns.js`, `realize/theory.js`
and `realize/index.js`, which the app also loads for the `PPP.arranger` switch; the switch defaults to `legacy`, so nothing visible changes until the
user flips it. The legacy arm, G5's hard-violation definitions and the selection weights and level offsets are untouched. One writer; no sub-agent was
dispatched. This section was revised after an independent review (two MAJOR findings, both confirmed and fixed below).

**1. What was found (measured before changing anything).** The re-review packet (`D:/PPP-review-keys/h8b`, 11 pieces at their request levels, hand
profile large, after the E2 floor) reproduced: G9 (best-of-N plus repair) had 95 left-hand octave-jumps in 1175 steps (8.1%) and 120 notes below G2
(MIDI 43), the legacy ScoreArranger 11 in 541 (2.0%) and 3. The proxy is `critics/left-hand-jump.js`: at every onset that has a note below middle C
(MIDI 60) the BASS is the lowest such note; a step is between consecutive such onsets; a JUMP is a step of 12 semitones or more.
- **The register floor fixed the wrong main cause.** It removed the extreme low notes (E2, MIDI 40) but left the geometry that makes the jumps: after the
  floor, the same 11 pieces still had 8.1% jumps. beyer/038 (flagged, lowest note MIDI 43) had 30%.
- **The source is the stride geometry of `pop` and `waltz`, and only those.** Over every candidate G9a enumerates (request's own hand profile, all level
  offsets; sample 16, held-out 32 and the 11 packet pieces), the left-hand jump rate by pattern before the fix:

  | pattern | 11 packet pieces | held-out 14 files | 16-file sample (12) |
  |---|---|---|---|
  | pop | 9.8% (142/1454) | 10.4% (185/1772) | 1.0% (21/2155) |
  | waltz | 17.6% (118/669) | 18.7% (135/723) | 4.2% (34/807) |
  | block, broken, ballad | 0.0-0.2% | 0.0% | 0.0% |
  | auto (resolves to block, broken, hymn per section) | 0.3% | 2.1% | 0.3% |
  | hymn (a verbatim copy of the source voices) | 1.1% | 6.9% | 5.5% |

  Of the steps of 12 semitones or more between consecutive left-hand events, all but one in `pop`/`waltz` were bass-to-chord or chord-to-bass (packet pop
  242 of 243, packet waltz 147 of 147, held-out pop 348 of 348); there were none in block, broken and ballad. Cause: both patterns put the bass at
  `nearestWithPc(root, anchor - 12)`, an octave under the section's left-hand register midpoint, and voice-led the chord around the midpoint. Over the
  bass-then-chord pairs, `pop`: the chord's top note was 15.5 (packet) and 17.1 (held-out) semitones above the bass on average and its lowest note 7.5
  and 9.0 above (`waltz`: 16.9 and 18.2, lowest 8.8 and 10.2); 59-74% of chords topped the bass by more than an octave. Not the cause: `broken` and
  `ballad` (0% at every stage), the hand profile, and repair.
- **What G9a picked.** Selected-pattern histogram before the fix: 11 packet pieces pop 4, waltz 4, block 1, auto 2; held-out (14 files) pop 5, hymn 5,
  auto 3, block 1; 16-file sample (12) hymn 7, auto 3, ballad 1, block 1. Nothing scored register or hand distance, so a stride pattern won on the
  method pieces the reviewer flagged.

**2. What changed.**
- `realize/theory.js`: `foldAbove(bass, pcs)`, a chord voiced close above its bass: each pitch class at its single instance in (bass, bass + 12],
  ascending; and `CLUSTER_BELOW = 48` (C3), the line under which a second or third between two notes reads as a cluster.
- `realize/patterns.js`: `pop` and `waltz` take a new stride geometry, `opts.stride` (threaded from the realizer, the candidate enumeration and the
  harness `--stride`): `'wide'` is the old geometry, kept only to measure and test against; `'close'` (first version of this fix) is the chord folded above its
  bass; **`'open'` is the default**. Every chord is voiced above its window's root bass (in `waltz`, the measure's bass) and the bass is placed as before
  (`nearestWithPc(root, anchor - 12)`) but not below the register floor. `'open'` differs from `'close'` only when the bass is below C3: the chord is folded above
  `min(max(bass + 4, 47), bass + 5)`, so for a bass from F#2 to B2 every chord tone is at or above C3 and at least a fifth over the bass, and for E2 and F2 the start
  is capped so the bass-to-chord step stays under an octave. Above C3 it equals `'close'` (tested).
- **MAJOR 1 fix: the span fit.** The first version's close path skipped `fitSpan`, so a chord with a seventh (root, third, seventh, a one-semitone gap
  around the octave) could span 11 and break the `small` profile's 10. `closeChord` now moves the lowest tone up an octave (an inversion, every pitch class
  kept) while the span is over the profile's `maxSpan`. Before: `waltz` at `small` on real files gave hard violations in 2 of 20 files (6 violations);
  `pop`, and `medium` and `large`, gave 0. After: 0 for `pop` and `waltz` at `small` (20 files) and `medium` (26 files), all three geometries.
- **Silent window (root null):** the close path takes root 0 for the bass and the chord alike (`rootOf`); the old path took the bass's pitch class from the
  previous chord's first voice, which is now the chord's third, so it was not kept. Rare, and not meaningful either way; stated here.
- `critics/left-hand-jump.js` and **`critics/low-register-cluster.js` (new, MAJOR 2)**, both wired in `critics/index.js`, both **weight 0** in
  `candidates/index.js` `DEFAULT_WEIGHTS` (report only; `--weights leftHandJump=1` / `lowRegisterCluster=1` count them): no selection weight or level offset
  was tuned. The cluster critic reports `clusterAttacks / chordAttacks` (two notes at one onset a second or third apart, lower note below C3),
  `closeBassChords / bassChordPairs` (a left-hand bass below C3 followed by a chord whose lowest note is within a third of it) and `notesBelow42`. The harness
  rows carry both for every engine, per file, with pooled and per-file figures in each summary, and the selected-pattern histogram. Note the definition:
  the independent review counted 15.1% (wide), 37.3% (close) and 3.7% (legacy) on the 11; this critic's denominators differ (every chord attack, not only
  left-hand ones) and it reads 7.9%, 19.6% and 1.7%; the ratios are the same.
- `repair/plan.js`, `repair/index.js`: the guard `createsLeftHandJump`: a repair may not move a note so that it creates a jump (identified by its two
  onsets) that was not there. Planner and applied unit; reason `LEFT_HAND_JUMP`; `ctx.leftHandJumpGuard: false` turns it off.
- `realize/tools/harness.js`: `--stride wide|close|open`, and the metrics above.
- Not applied: **the floor is still E2 (40).** G2 (43) is measured with the geometry below and would fix the two remaining items (christ-arose, the E2/F2 basses).

**3. Alternatives measured (11 re-review pieces at the request levels of `D:/PPP-review-keys/h8b/key.json`, hand profile large; G9 = best-of-N plus repair).**
"jumps" = pooled left-hand jump rate (max piece), "cluster" = pooled low-register cluster rate (max piece), "closeBC" = close bass-chord pairs.

| | jumps | cluster | closeBC | notes < G2 | level +-1 / distance | harmony rq / ro | pattern histogram |
|---|---|---|---|---|---|---|---|
| wide (before) | 7.9% (30%) | 7.9% (59%) | 14/114 | 120 | 11/11 / 0.4036 | 0.9235 / 0.9594 | pop 4, waltz 4, block 1, auto 2 |
| close (first version of this fix) | 1.3% (10%) | 19.6% (59%) | 30/140 | 100 | 11/11 / 0.4555 | 0.9312 / 0.9629 | pop 3, waltz 3, auto 3, block 1, hymn 1 |
| open uncapped (chord always at or above C3) | 2.7% (18%) | 6.1% (59%) | 1/140 | 94 | 11/11 / 0.4445 | 0.9306 / 0.9622 | same |
| **open (default: capped at bass + 5)** | **2.2% (10%)** | **7.3% (59%)** | **2/140** | 94 | 11/11 / **0.4445** | 0.9306 / 0.9622 | pop 3, waltz 3, auto 3, block 1, hymn 1 |
| close + floor G2 | 0.5% (2%) | 12.0% (29%) | 25/108 | 0 | 11/11 / 0.5255 | 0.9417 / 0.9625 | pop 2, waltz 3, auto 4, block 1, hymn 1 |
| open + floor G2 | 0.5% (2%) | 1.6% (15%) | 0/108 | 0 | 11/11 / 0.5227 | 0.9410 / 0.9618 | same |
| legacy ScoreArranger | 2.0% (6%) | 1.7% (22%) | 1/49 | 3 | 11/11 / 0.6945 | 0.9801 / 0.9900 | |
| the source pieces | 2.0% (6%) | 1.7% (22%) | 1/47 | 3 | | | |

Hard violations 11/11 files at 0, melody 1.0000 and both engraving counts 11/11 in every G9 row above (legacy: hard 6/11). Chosen: **`open`** at floor E2. It is
the smallest change that meets both targets: jump rate near legacy's (2.2% against 2.0%, no piece above 10%) and clusters down from 19.6% to 7.3% with the chords over
a low bass no longer within a third of it (close bass-chords 30 to 2 of 140). `open` uncapped is the same idea but lets a jump appear at 18% on one piece; the G2 floor
removes both remaining items but costs level distance (+0.078 on the 11 against `open`), which is a Lead decision, not a default.

Per piece, `open` (jump %, cluster %; wide before in brackets; legacy): beyer/061 3% (2%), 0% (10%), legacy 0% and 0%; burgmuller25/016 8% (0%), 0% (10%), legacy 3% and 22%;
the-strife-is-oer 0%, 0%; nearer-my-god 0% (13%), 0%; beyer/038 0% (30%), 0%; christ-arose 0%, **59% (59%)**, legacy 0%; sonatina/025 0% (23%), 1% (0%); what-child-is-this 10%
(30%), **16% (0%)**, legacy 5% and 0%; pass-me-not 0%; burgmuller25/006 0% (11%) (now `hymn`); beyer/020 8% (30%), 2% (0%). The two pieces above 10% on clusters:
- **christ-arose, 59% before and after: not the stride.** Its G9 selection is `auto` at the small hand profile (block chords voiced around a low left-hand midpoint; 36 notes under G2),
  the wide geometry has the same 59%, legacy reads 0%, and on the held-out slice it is the only file with a cluster (47 of 47). The fix does not touch `block`. The G2 floor
  brings the packet's worst piece to 15%.
- **what-child-is-this, 16%:** a waltz in E minor; all 8 of its cluster chords sit over bass E2 (40), where the start is capped at bass + 5 (for example 40 then 47, 51, 54), so a third under C3 remains. The G2 floor removes it (E2 is then raised).

Other samples, G9 after repair (`node realize/tools/harness.js --sample 16 --g9a --repair --timeout-s 120` and `--held-out 32 ... --timeout-s 180`; outputs outside the repo;
12 of 16 and 14 of 32 files have a reachable G7b plan). "before" is `--stride wide` on this code (origin/main's geometry with the repair guard on):

| | 16-file: before (wide) | close | **open** | open + G2 | held-out: before (wide) | close | **open** | open + G2 |
|---|---|---|---|---|---|---|---|---|
| hard violations (files at 0) | 12/12 | 12/12 | 12/12 | 12/12 | 14/14 | 14/14 | 14/14 | 14/14 |
| level within +-1 / mean distance | 10/12 / 0.3258 | same | same | 10/12 / 0.3375 | 14/14 / 0.3379 | 14/14 / 0.3836 | 14/14 / **0.3786** | 14/14 / 0.4164 |
| melody | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 1.0000 |
| harmony root+quality / root-only | 0.9753 / 0.9778 | same | same | 0.9729 / 0.9753 | 0.9316 / 0.9619 | 0.9470 / 0.9698 | **0.9470 / 0.9698** | 0.9519 / 0.9717 |
| engrave silent / hard layout (files at 0) | 12/12, 12/12 | same | same | same | 14/14, 14/14 | same | same | same |
| jump rate pooled (max file) | 2.9% (29%) | 2.9% (29%) | 2.9% (29%) | 2.9% (29%) | 4.8% (13%) | 6.6% (26%) | **7.3% (26%)** | 6.7% (26%) |
| jump rate, non-`hymn` selections | 0.2% | 0.2% | 0.2% | 0.2% | 4.9% (41/831) | 1.4% | **2.7% (14/513)** | 0.7% |
| cluster rate pooled (legacy) | 2.3% (0.0%) | 2.3% | 2.3% | 2.3% | 4.8% (1.0%) | 5.4% | **4.1%** | 1.1% |
| notes below G2 (source included) | 43 | 43 | 43 | 13 | 125 | 88 | 88 | 38 |
| selected pattern | hymn 7, auto 3, ballad 1, block 1 | same | same | same | pop 5, hymn 5, auto 3, block 1 | hymn 7, auto 3, pop 3, block 1 | hymn 7, auto 3, pop 3, block 1 | hymn 7, auto 3, pop 2, block 1, waltz 1 |

(The origin/main baseline without the guard is the same on every metric except held-out distance 0.3386 and a jump rate of 5.4%: repair created a jump in that run, 55 to 56, and the guard now
prevents it: like for like the held-out before figure is 4.8%.)

**Against the previous tip (`78a21aa`, the `close` first version): five metrics.** 16-file sample: no metric moved. Held-out: hard, melody, engraving, level distance (0.3786), harmony (0.9470 / 0.9698) did
not move; the pooled jump rate went from 6.6% to 7.3% (one more piece near 8%: burgmuller25/016 3% to 8%; the 26% file is unchanged). 11 packet pieces: level distance 0.4491 to 0.4445 (better),
harmony root+quality 0.9312 to 0.9306 (-0.0006) and root-only 0.9629 to 0.9622 (-0.0007), jump rate 1.3% to 2.2%. Nothing else moved.

**What the G6 level and the jump rate did, said exactly.** (a) G6 mean level distance against the target, versus before the fix: 16-file sample unchanged, held-out 0.3379 to 0.3786 (+0.0407; still 14/14 within +-1), the 11
pieces 0.4036 to 0.4445 (+0.0409; still 11/11). The held-out rise is two selection flips to a verbatim `hymn` copy, not a general easing of the stride: **sonatina/004** (pop, level 3.26, badness 0.310 before; after the fix the `pop`
candidate reads 3.10 and badness 0.363, the `hymn` copy at 2.87 and 0.333 wins by a margin of 0.030) and **burgmuller25/006** (before the fix `pop` won by a margin of 0.004 over the same `hymn` copy; after, `pop` reads 2.91,
badness 0.393, and `hymn` wins by 0.057 over a `waltz`). Both `hymn` copies sit at a distance of exactly 1.00 from the target (3.87 and 3.76 against 2.87 and 2.76), the edge of the +-1 band. Across the 70 `pop`/`waltz`
(file, spec) pairs the enumeration produces on the three sets (paired, same spec; the sets overlap on some files), the level change was small and mixed: mean -0.017 for `pop` (13 lower, 8 higher, 16 unchanged of 37) and -0.056 for `waltz` (13 lower, 2 higher, 18
unchanged of 33). That does not establish that the closer stride is "easier to play"; only that it shifts G6 slightly and that the winner changed on two files by small badness margins.
(b) The held-out pooled jump rate went from 4.8% (like for like) to 7.3%, and the worst file from 13% to 26%, because of sonatina/004: it was `pop` at 9% and is now `hymn` (verbatim copy) at 26%. Its source has a 26% left-hand
jump rate and legacy has 26% too; legacy's rate equals the source's on every piece (fur-elise 20%, gymnopedie-1 29%, sonatina/001 16%, sonatina/004 26%). Over what G9 generates (non-`hymn`), the held-out rate fell from 4.9% to 2.7%. On the held-out slice all 47 cluster chords of the `open` result are in christ-arose.
A repair can also shift a `hymn` copy slightly (burgmuller25/019: 3 jumps before repair, 2 after). This is a finding for the Lead: selection now copies a source whose own bass leaps rather than generating a stride.

**The floor, measured with the geometry (`--register-floor 43`; not applied).** With `open`: jump 0.5% (max 2%), cluster 1.6% (max 15%), 0 notes under G2 on the packet; held-out cluster 1.1%, 38 notes under G2. Cost:
level distance 0.4445 to 0.5227 (+0.078) on the 11, 0.3786 to 0.4164 (+0.038) held-out, 0.3258 to 0.3375 (+0.012) on the 16-file sample; harmony rises on the 11 (0.9410 / 0.9618 against 0.9306 / 0.9622) and
held-out (0.9519 / 0.9717) and falls slightly on the 16-file sample (0.9729 / 0.9753); always within +-1. `REGISTER_FLOOR = 43` in `realize/theory.js` is the one-number change; the tests use the constant.

**What the guard did in the corpus.** It never fired on the two samples (0 `LEFT_HAND_JUMP` rollbacks), so it is unit-tested protection, not measured behaviour, but it is not inert in effect: the held-out
jump count with `--stride wide` is 50 with the guard and 56 without it (repair created a jump without it).

**Tests** (all pass): `tests/realize/stride-geometry.test.js` (19: `foldAbove` bounds over every bass and quality; the synthetic progression within (root bass, root bass + 12] for `close`, and the old geometry shown to break it;
**a sweep over hand profiles small, medium and large, every quality, root, anchor and geometry: every chord fits the profile's span and the floor holds**; pitch classes equal to the old geometry; the open geometry keeps a chord over
a low bass at or above C3 and at least a fifth up, `close` does not; `open` equals `close` above C3; **real files at `small` and `medium`: pop and waltz give zero hard violations (20 and 26 files)**; the six flagged pieces' jump rate
against `wide` (pooled 21% to 4.7%) with melody untouched and pitch classes kept; the other patterns byte-identical; the melody-crossing degradation still covers block, broken and ballad through the floor, and pop and waltz place
their own bass; determinism), `tests/critics/left-hand-jump.test.js` (15), **`tests/critics/low-register-cluster.test.js` (9: planted defect, negative control, thresholds, the bass-chord pairs, a real graph, `evaluate`, weight 0, and `open`
against `close` on three pieces)**, `tests/repair/left-hand-jump.test.js` (5). `tests/realize/register-floor.test.js` had three assertions that exercised the post-hoc raise through `pop`; they use `stride: 'wide'`.

**Known limits.** (1) christ-arose keeps its 59% cluster rate (block chords, not the stride) and what-child-is-this 16%; the G2 floor is the measured remedy and costs level distance. (2) About 2.7% of non-`hymn` steps still jump
(a root moving up from the top of the bass window wraps down nine to eleven semitones). A voice-led bass with a wider band was tried and measured no better. (3) The cluster critic's definition is not the review's exactly (see above).
(4) The proxy is pitch-based; tied continuations are not told apart from attacks. (5) `pop` voices its chord over the root bass, not the alternating fifth. (6) The realizer places the stride bass at the floor itself with no melody-crossing
check (only an unrealistic floor crosses; the check remains for block, broken, ballad and `wide`). (7) No human has re-reviewed the result. (8) `realize/` is loaded by the app; the change reaches users only through the `PPP.arranger`
switch, which defaults to `legacy`. Not deployed.

### G9 without stride patterns (post H-8 re-review)

G9's candidate set no longer contains the stride patterns `pop` and `waltz` by default. Node-only: `git diff --stat origin/main` shows no app, server or roadmap file. It
touches `candidates/index.js`, `realize/index.js` (one option, off by default), `realize/tools/harness.js` and tests. The legacy arm, the selection weights, the level
offsets and the hard-violation definitions are untouched (standing rule: no tuning). One writer; no sub-agent was dispatched.

**1. Evidence (two blind reviews by one reviewer, the user: H-8 with 16 pieces, and its re-review with 5 pieces rated so far).** The arrangements the reviewer flagged
"awkward hand position" or "too hard", grouped by the pattern G9a selected (`g9.chosenSpec.pattern` in the keys):

| selected pattern | G9 arrangements | flagged |
|---|---|---|
| waltz | 8 | 6 |
| pop | 6 | 6 |
| **stride patterns together** | **14** | **12** |
| block | 3 | 0 |
| ballad | 1 | 0 |
| hymn | 2 | 0 |
| auto | 1 | 0 |
| **other patterns together** | **7** | **0** |

Preference: where G9 had selected pop or waltz the reviewer preferred G9 in 0 of 14 (legacy 7, no difference 6 to 7); with the other patterns G9 was preferred in 5 of 7 and never lost.
**Limits of this evidence:** n is small (21 arrangements), it is one reviewer, and the pattern is partly confounded with the piece (two pieces appear under different patterns across
the two reviews, and the stride patterns were mostly selected on method pieces, which are harder for other reasons too). It is not a test. What it does show: the two earlier fixes (the
E2 register floor and the closer `open` stride voicing, PR #102 and #103) each moved a measured proxy, and the reviewer still found the stride arrangements hard (nearer-my-god at a
left-hand jump rate of 0% was still flagged: "the low hand hopping is hard"). So the stride family itself, the left hand alternating bass and chord, is the working suspect, not its
interval sizes.

**2. What changed.**
- `candidates/index.js`: `STRIDE_PATTERNS = ['pop', 'waltz']` (with the reason above as a comment); `PATTERNS` is now the default walk, `auto, hymn, block, broken, ballad`;
  `ALL_PATTERNS` is the old seven-value set; `patternsFor(opts)` picks the list. Opt-in to the old set: `opts.allowStride: true` (on `enumerate` and `run`), or an explicit
  `opts.patterns` array (an unknown name throws). Both are in the cache key. The enumeration order is the old order with the stride specs removed (tested).
- **How `auto` was handled.** `auto` can resolve to a stride pattern inside the realizer: `realize/index.js` `structuralFallback` returns `waltz` for a genuinely triple meter
  (`auto` never resolves to `pop`). A new realizer option `opts.noStride` (default off, so direct `realize()` calls, the app's `PPP.arranger` path and every realizer test behave as
  before) makes that fallback `block` instead (which `policyForStage` may still subdivide into `broken` at stages 3 and 4, as for any `auto` block section). An explicit
  `opts.pattern` of `pop` or `waltz` is still honoured with `noStride` on. `candidates/` passes `noStride: !opts.allowStride`, so the default candidate set contains no stride texture,
  including through `auto`; `allowStride` restores `auto`'s triple-meter waltz too. With an explicit `opts.patterns` list that names `pop` or `waltz` the named candidates are
  enumerated but `auto` stays stride-free unless `allowStride` is also set.
- `realize/tools/harness.js`: `--allow-stride` (the old set, for comparison), `--patterns a,b,c`; `scoreGraphCandidate` is exported. The harness's G8a arm is unchanged
  (the realizer's own `auto`).
- The default set is 5 patterns plus 2 other hand profiles = 7 specs per level offset (21 with three offsets), so the old cap `n = 24` no longer truncates the walk (the old 27 specs lost the
  last three). Duplicates by fingerprint are still dropped, so a request has 2 to 9 candidates.
- Tests: `tests/critics/candidates-no-stride.test.js` (new, 7): constants and `patternsFor`; the default specs and the old order; no candidate resolves to a stride texture on a
  triple-meter hymn, `beyer/061` and `nearer-my-god`, and the opt-in restores both textures; `auto` gives waltz for a direct `realize()`, block with `noStride`, and an explicit
  `waltz` survives `noStride`; an explicit list; determinism and the cache; the selection after repair is never a stride texture. Two existing tests encoded the old default and were
  adjusted, nothing else: `tests/critics/register-floor.test.js` (the "floor off, the pipeline is low" non-vacuity check now runs with `allowStride: true`, since the low bass came
  from the stride patterns), and `tests/review/packet.test.js` (the leak scan searched the word `g8` as a bare substring, which matched the note-flag glyph id `flag8thdown` in a
  packet drawn from the new selections; `g8` and `g9` now count only when not preceded by a letter or digit; every other word is unchanged).

**3. Numbers, before (`--allow-stride`, the old set) and after (default).** G9 after repair, `node realize/tools/harness.js --sample 16 --g9a --repair --timeout-s 120` and
`--held-out 32 --g9a --repair --timeout-s 180`, outputs outside the repo; the 11 pieces are the re-review items of `D:/PPP-review-keys/h8d/key.json` (built from `03f2549`) at their
request levels, hand profile large, run through `candidates.run` and `repair.repairSelection`. "Jump" is the pooled left-hand jump rate (max file), "cluster" the pooled low-register
cluster rate.

| | 16-file sample (12 reachable), before = after | held-out (14 reachable): before | held-out: after | 11 re-review pieces: before | 11 re-review pieces: after |
|---|---|---|---|---|---|
| hard violations (files at 0) | 12/12 | 14/14 | 14/14 | 11/11 | 11/11 |
| level within +-1 / mean distance | 10/12 / 0.3258 | 14/14 / 0.3786 | 14/14 / **0.3957** (+0.0171) | 11/11 / 0.4445 | 11/11 / **0.4718** (+0.0273) |
| melody | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 1.0000 |
| harmony root+quality / root-only | 0.9753 / 0.9778 | 0.9470 / 0.9698 | 0.9726 / 0.9765 (+0.0256 / +0.0067) | 0.9306 / 0.9622 | 0.9357 / **0.9428** (+0.0051 / -0.0194) |
| engrave silent / hard layout (files at 0) | 12/12, 12/12 | 14/14, 14/14 | 14/14, 14/14 | 11/11, 11/11 | 11/11, 11/11 |
| jump (max file) | 2.9% (29%) | 7.3% (26%) | 5.2% (26%) | 2.2% (10%) | 0.3% (1.8%) |
| cluster | 2.3% | 4.1% | 4.1% | 7.4% | **8.3%** |
| close bass-chords / pairs | 0/14 | 3/76 | 1/29 | 2/140 | 1/25 |
| notes below E2 (arranged) | 0 | 1 | 1 | 0 | 0 |
| notes below G2 | 43 | 88 | 77 | 94 | 59 |
| selected pattern | hymn 7, auto 3, ballad 1, block 1 | hymn 7, pop 3, auto 3, block 1 | hymn 7, auto 6, block 1 | waltz 3, pop 3, auto 3, block 1, hymn 1 | auto 8, hymn 2, block 1 |

- **16-file sample: no metric moved.** Its old selections contained no stride pattern, so the change is inert there.
- **Held-out: three files changed** (czerny599/027, burgmuller25/016, nearer-my-god; all three were `pop`, now `auto` resolving to a block, broken or hymn texture). Regression, said
  exactly: the level distance rose 0.3786 to 0.3957 (+0.0171; still 14/14 within +-1; for example nearer-my-god 2.40 to 2.24 against target 2.40, czerny599/027 2.87 to 2.79 against 3.62).
  Harmony rose (+0.0256 root+quality). Hard, melody and engraving did not move.
- **11 re-review pieces: six changed** (what-child-is-this, sonatina/025, nearer-my-god, burgmuller25/016, beyer/020, beyer/061: exactly the six that had a stride, waltz 3 and pop 3; now
  hymn 1 and auto 5, resolving to block, broken or hymn). Regressions, said exactly: level distance 0.4445 to 0.4718 (+0.0273; 11/11 still within +-1); **harmony root-only 0.9622 to
  0.9428 (-0.0194)** while root+quality rose (+0.0051); the pooled cluster rate rose 7.4% to 8.3%, all of it beyer/061 (now a block texture at 21.9% where the pop had 0%; christ-arose
  stays at 58.8%, unchanged). Improved: jump rate 2.2% to 0.3%, notes below G2 94 to 59. sonatina/025 is now a verbatim `hymn` copy at level 2.40 against target 3.40 (distance exactly 1.00).
- **Unreachable: none.** All 11 pieces have 2 to 9 candidates without the stride patterns and a selection; 5 of 11 did not change selection (the-strife-is-oer, beyer/038, pass-me-not,
  burgmuller25/006, christ-arose). Selected instead, for the six changed: what-child-is-this `auto` (a hymn copy) at level offset -1 (level 3.46 against a 3.10 stride waltz before);
  sonatina/025 `hymn`; nearer-my-god `auto` (hymn and broken) at +1; burgmuller25/016 `auto` (broken); beyer/020 `auto` (block); beyer/061 `auto` (block) at -1.

**4. Known limits.**
- The stride code (`realize/patterns.js` `pop` and `waltz`, the `stride` geometries, and the register-floor, left-hand-jump and low-register-cluster critics and the repair guard) all stay; it is
  now opt-in (`allowStride`, `--allow-stride`, `--patterns`). Nothing was deleted, so it can be restored for a preference test.
- Nothing here shows the non-stride arrangements are good. It shows only that this reviewer did not flag them in 7 of 7 and preferred G9 in 5 of 7 (n small, one reviewer, confounded with
  piece). The selection now leans on `hymn` copies (verbatim source voices, which keep the source's own left-hand jumps: held-out sonatina/004 at 26%) and block or broken `auto` textures.
- The cost is measured above and not compensated for: a small rise in level distance, a lower root-only harmony on the 11, and one piece (beyer/061) with a higher cluster rate. No weight or
  offset was changed to offset them.
- No human has re-reviewed this change. Not deployed; `realize/` is loaded by the app, and with `noStride` off by default nothing the app does changes.

**Disclosures added after the independent review of this change.**
- **Per piece, harmony got worse where the aggregate improved.** On the 11 re-review pieces root-only harmony fell from 0.9622 to 0.9428 overall; what-child-is-this fell from 1.000 to 0.804 root-only and beyer/020 from 0.859 to 0.828. The held-out aggregate rose (0.9698 to 0.9765 root-only) because different files were affected.
- **Block chords are thick.** beyer/061 (now a block texture) has 2.73 left-hand notes per onset, 75% of onsets with three or more, 175 left-hand notes against 27 for legacy, and two left-hand chords spanning more than an octave; christ-arose is unchanged at 3.0 per onset. Whether a reviewer finds those chords hard is not known: the block arrangements in the two reviews were easy pieces.
- **Three of the 11 are now the source copied back.** sonatina/025 and burgmuller25/006 have left hands identical to the source and to legacy, and nearer-my-god is half a hymn copy, so for those the arrangement is the source. That is a valid outcome of best-of-N (the copy has zero invented notes) but it says nothing about the arranger's own skill on those pieces.
- **The evidence table is thinner than it looks.** All 11 re-review pieces are also in the original 16, so the 21 ratings cover at most 16 distinct pieces, and three pieces (nearer-my-god, burgmuller25/016, sonatina/025) appear under different patterns in the two reviews, not two. The 0-of-7 for non-stride patterns comes mostly from easy pieces and near-source hymn copies. The doc's confidence should be read at that strength: a strong signal about the stride family, not a demonstration that the other patterns work.

### TD16 auto 8va/8vb for arranged output

Notes far above or below a staff were printed on many ledger lines with no octave line, in both arms. The reviewer flagged it twice ("8va is still not shown, there are very high
notes"; "too extremely low or high notes are written on the staff as they are"). This adds G3's automatic 8va (G03 section 13.3, off since D2 because the app played 8va an octave off, fixed
by MX-1 and live since 2026-09-26) to arranged graphs, as a small reusable function, and wires it into the blind-review drawing path. Node-only: `git diff --stat origin/main` shows no app,
server, roadmap or `engrave/` file. One writer; no sub-agent was dispatched.

**1. What was measured.** 34 items (the 16 H-8 key items, plus the 16-file sample and the 32-file held-out slice at the request level `findG8Plan` finds, minus repeats; 32 distinct pieces; 22 of the
48 sample and held-out files have no reachable G7b plan, so they have no arrangement and are not in it), each arranged with today's code (`review/lib/arrange.js arrangeItem`: G9a best-of-N plus G9b repair, and ScoreArranger
at the closest of its four levels), then projected the way `review/lib/neutral.js` draws them. Ledger lines are counted on the clef actually in force at each note (the projected graph carries the original piece's
clef changes; a first count with the opening clefs only overstated the low left hand and was discarded). Notes per ledger-line count:

| clef, side | G9: 1 / 2 / 3 / 4 / 5+ lines | legacy: 1 / 2 / 3 / 4 / 5+ lines |
|---|---|---|
| treble, above | 187 / 130 / 49 / 33 / 49 | 191 / 130 / 49 / 33 / 49 |
| treble, below | 352 / 192 / 96 / 44 / 12 | 293 / 63 / 0 / 0 / 0 |
| bass, above | 535 / 288 / 83 / 36 / 50 | 577 / 188 / 51 / 37 / 53 |
| bass, below | 70 / 8 / 5 / 1 / 3 | 29 / 7 / 5 / 1 / 4 |
| **notes on 3 or more lines** | **461 of 8,835 (5.2%)** | **282 of 7,743 (3.6%)** |
| notes on 2 or more lines | 1,079 (12.2%) | 670 (8.7%) |

The pieces with the most notes on 3+ lines: czerny849/023 (both arms, 162), czerny599/049 (both arms, 71), czerny849/002 (G9 98, legacy 20), czerny599/027 (G9 36), burgmuller25/016 (G9 23, legacy 14).
Two things the numbers say that were not obvious. (a) G9 has 152 notes on 3+ lines below a **treble** staff and legacy has none: the projected graph keeps the original piece's clef map, so where the
original wrote the left hand in treble clef and G9 puts a low bass there (czerny849/002, czerny599/027, burgmuller25/016, beyer/020), the notes hang under a G clef. That is a clef problem more
than an octave problem (see the limits). (b) Notes above a **bass** staff (a left hand playing above G4) are the biggest group in both arms.

**2. The rule** (`realize/ottava.js`, constants in `OTTAVA_RULE`). Ledger lines are counted on the sounding pitch against the clef of the note's own staff at that onset (treble G or bass F only; a staff with
another clef, or one that already has an ottava line, is skipped). Per staff and direction (8va above, 8vb below):
- A note is *high* at 2 or more ledger lines (`highLines`) and a *seed* at 3 or more (`seedLines`). Notes at one onset on one staff are one group.
- A run is a stretch of high groups, each within 1/2 whole note (two quarter beats, `bridge`) of the end of the one before. A group between two high ones joins only if it would still read well moved
  (*fit*: after the shift a high note needs at most 2 lines, `keepHigh`, and any other note it covers at most 1, `keepOther`). A group that fails the test ends the run.
- A run gets a line when it holds a seed and either two onsets or a note on 4 or more lines (`loneLines`; a lone 3-line note gets nothing), or, with no seed, when it lasts at least one whole note
  (four quarter beats, `sustain`) with two onsets.
- 8va/8vb, unless a note would still need 3 lines after it; then 15ma/15mb (`maxShift` 2).
- The line starts at the run's first onset and ends where its last group ends, or where the staff's next note starts if that is sooner, so it covers exactly the notes it was made for (the engraver
  moves by staff and onset).

Why: 3 lines is where a note stops being readable at a glance (E6 on a treble staff); a printed edition uses 8va for a phrase there and for a longer stretch on 2 lines, and does not mark a
single E6. The 2-line sustained case is the "several beats" rule; the 4-line lone case keeps a single G6 from being left on 4 lines. The constants are engraving-practice defaults, not tuned to any metric.

Result on the same 34 items: **no note on 3 or more ledger lines is left in either arm; the most is 2.** Notes still on 2 lines: G9 105 (from 1,079), legacy 110 (from 670). 18 of 34 G9 arrangements and 16 of 34
legacy ones get at least one line (60 and 59 lines; 1,588 of 8,835 and 894 of 7,743 notes drawn shifted, bridged notes included). It runs in 1 to 70 ms per graph and never fell back.

**3. What it is and how it is checked.** `addOttava(graph, { rule })` returns `{ graph, changed, fallback, spans, report }` (the graph itself when there is nothing to do). It is one G3 pass run through
`scoregraph/pro.js professionalize` with only that pass, so `pro-critic.js` fingerprints the graph before and after (every component but `ottava` must be equal: sounding notes, onsets, staff and voice,
spelling, marks, pedal, timeline), the validator must find no new error or notation warning (`W-OTTAVA-OVERLAP` included), and anything else returns the input (`fallback: true`). G3's own permission
table is bypassed on purpose (an arranged graph is `generated`, which G3 never rewrites, and an ottava line is the one thing added). The graph keeps the sounding pitch; only the engraver's written pitch
moves. Deterministic and idempotent (a second run finds the staff already marked).

**4. Wiring.** (a) `review/lib/neutral.js svgOf` calls `addOttava` on the projected graph before `E.plan`, the same call for both arms; `render(..., { ottava: false })` draws without, for comparison.
`audioNotes` is made from the flat notes, so the packet's sound is unchanged by construction (tested). (b) `realize/ottava.js` is the reusable function for a later G9e integration
(`addOttava(rr.graph)` after repair). It is Node-only and not loaded by the app, and not re-exported from `realize/index.js` (which the app loads). Nothing else changed: `candidates/`, `repair/`, the
harness and its metrics do not call it, so selection and every harness number are byte-identical (the engrave metrics on the arranged graph are not run with it, so no delta is reported).

**5. Drawn and looked at.** Packets were built with `review/build.js --mode h8 --items` (one item per packet; two pieces whose arms are identical, sonatina/025 and czerny849/023, are refused by the builder and were drawn
directly through `svgOf`), and screenshotted with puppeteer: burgmuller25/016, /006, /003, /019, beyer/061, /020, czerny849/002, /023, czerny599/027, sonatina/025. Seen: the label ("8va", "8vb", "15ma") at the left of a
dashed line with a closing hook at the last covered note; heads at the written position (an 8va over a bass staff writes E4 as E3, an 8vb under a treble-clef left hand writes G3 as G4); the line above the treble staff,
below the staff for 8vb, and between the staves above the bass staff; "(8)" and "(15)" continue a line onto the next system; no line overlapped a stem, beam, ledger line or another mark, and none reached a note it does not
cover. Not perfect: the "8va" label sits close to the first covered head where a note comes just before it, without touching. The engraver drew everything correctly; nothing to report about `engrave/`.

**6. Tests.** `tests/realize/ottava.test.js` (10: a 3-line phrase gets 8va over exactly its notes and is drawn an octave down, a 1-line phrase gets nothing, a low bass gets 8vb, a lone 3-line note gets nothing and a
lone 4-line note does, a 2-line passage needs four beats, 15ma, the end of the line and the bridge, a full note-list comparison and the G3 critic, deterministic and idempotent, constants overridable) and
`tests/review/ottava.test.js` (4: labels drawn and a plain drawing byte-identical to the no-pass drawing, audio list equal with and without, both arms one path, no data attribute or engine name).

**7. Known limits.**
- **A clef change is the older answer, and it is not made here.** Where the projected graph keeps a treble clef under a low bass (152 G9 notes, above), the result is an 8vb under a G clef: readable and
  correct, but a printed score would write bass clef. 8va over a bass staff (the largest group) is likewise legal, not usual. Fixing the clef map for the G9 arm (G9e, or a clef step) would remove most of the
  8vb cases.
- No human has seen this. The constants are practice defaults; the sustained-2-line rule is the one most likely to be too eager (sonatina/025 gets an 8va over one bar of D6). To make it stricter raise
  `sustain` or set `highLines` to 3.
- Bridged notes can end on one ledger line (900 of the 8,835 G9 notes are on one line after the pass, 1,144 before).
- Cross-staff heads use the head's staff; the review path has none, and the pass was not exercised on them.
- 15ma appears in czerny849/023 and czerny599/049 only (notes to E7).

### Review page fidelity (rests, ties, spacing, phone, clef)

**Why.** The user, who reads Korean and reviews on a phone, kept reporting about both arms that notes sit "extremely close together in a row", that "the timing seems off", and that extreme high and low notes are written as they are. An investigation of the drawing path found that the review page itself misrepresented the scores, apart from anything the arrangers did:

1. `review/lib/neutral.js`, the one path that draws both arms from flat notes, dropped every rest and drew no ties. The source draws 24 rests in the-strife-is-oer and 44 in burgmuller25/016; in the arms 15 of 60 (G9) and 14 of 60 (legacy) staff-measures of the-strife-is-oer had silence with nothing drawn, so a half note floated mid-bar and beat positions could not be read. Ties were lost (10 in burgmuller25/016, 12 in nearer-my-god).
2. It always drew the desktop layout (100 staff spaces, 4 bars a system), and `page.js` showed the svg at `min-width:640px` in a sideways-scrolling box, so on a 400 px phone the reviewer saw 6.2 px per staff space, scrolled, with 16th heads about 9 px apart and stems and beams merging. The engraver's phone configuration was never used.
3. The arranged left hand was drawn under the source's clef: for pieces whose source writes the left hand in treble (czerny849/002, czerny599/027, burgmuller25/016, /003, beyer/020) a low left hand sat on many ledger lines, then hidden behind a long 8vb from TD16.

**Honest statement about earlier reviews.** H-8 and its re-review were rated on pages that lacked rests and ties and were drawn too tight for a phone. Their notation-related comments (timing, spacing, "notes crammed together", and probably some of the register and clef remarks) are therefore partly artefacts of the page, not of the arrangements, and cannot be attributed to either arm. Their comments about the notes (harmony, melody, hand position, difficulty) stand as far as the sound and the notes shown are concerned. The packets already built (`D:/PPP-review/*`) are unchanged and obsolete: rebuild before any further review.

**What changed** (only `review/` and `tests/review/`; no `engrave/`, app or server file), one path for both arms, reading only the notes:

- **Rests.** Every silent stretch of a staff (a gap between its notes, or to the bar end) is drawn as rests, in the staff's first voice: a silent bar is a whole-bar rest; other gaps are cut at the beats and written as the largest value that starts on a multiple of its own length (a half rest never on beat 2 of 4/4; compound meters get a dotted value per beat). The engines' own rest entries are ignored (G9 has some, legacy none), so a rest is a rest on both sides by the same rule. A gap off the 1/64 grid (a triplet edge) is left alone, never approximated, and counted.
- **Ties.** A `tieStart` and a `tieStop` note of one pitch and staff that meet exactly are drawn tied; an unpaired flag is dropped; a tied continuation prints no accidental of its own. A note that runs past its barline is cut into tied pieces of ordinary values (the graph builder would otherwise drop it). No such note occurs in the 12 pieces looked at; it is unit-tested. Only G9's notes carry tie flags (ScoreArranger re-strikes), so ties can appear on G9's side only. That is the music, and the sound already joins them.
- **Two drawings of each side** from one plan: wide = the desktop configuration with `barsPerSystem: 2`; narrow = the engraver's own phone configuration (`screenConfig(720)`: 40 staff spaces, 2 bars a system, what the app uses at 720 px or less). `page.js` embeds both and `@media (max-width:720px)` shows one; the `min-width:640px` and the sideways-scrolling box are gone. Glyph ids are per drawing (`i01X-...` and `i01X-n-...`). Ratings and sound never read the svgs. (The engraver treats `barsPerSystem` as a target: the wide drawing still fits a third bar where bars are sparse, and never puts two consecutive onsets closer than 2.25 sp.)
- **Clef.** Upper staff: treble always. Lower staff, per measure, from its notes: low = MIDI <= 60 (`CLEF_LOW_MAX_MIDI`, middle C stays in the bass clef); the staff opens in bass if at least `CLEF_OPEN_LOW` = 0.5 of the first measure's notes are low; it changes only at a barline and only when at least `CLEF_SWITCH_SHARE` = 0.75 of a measure's notes are on the other side; a stretch shorter than `CLEF_MIN_RUN` = 2 measures with notes is folded into its neighbours; a measure with no notes keeps the clef. Neither arm uses the source's clef marks or mid-bar clef changes. An earlier draft used "below 60" for low; it put a left hand of C4 quarter notes (czerny849/002, G9) under a treble clef that flipped to bass a bar later, so middle C was moved to the bass side.
- The sound (`audioNotes`) is computed from the arm's own notes exactly as before and is byte-identical on all 24 arms looked at (tested with a frozen list).

**Counts (drawn rests and ties, arm vs source).** Source graph / G9 drawn / legacy drawn: the-strife-is-oer rests 24 / 28 / 27 (the whole-bar rest is one of them); burgmuller25/016 rests 44 / 17 / 44, ties 10 / 4 / 0; nearer-my-god rests 12 / 3 / 6, ties 12 / 3 / 0; sonatina/025 rests 28 / 28 / 28 (its arms are the same notes at 3.4 and are refused by the builder at that level; drawn at 2.4), ties 2 (and 42 slurs, which are not drawn). Arm counts differ from the source because the arms are different music and rests are the staff's silences (G9's own rest entries are per voice: 15 in nearer-my-god against 3 silences). Legacy has no ties because ScoreArranger has none. In czerny849/002 the legacy arm has 39 staff-measures skipped as off-grid: it writes sextuplet-like notes as plain 16ths of length 1/12.

**Head gaps** (consecutive onsets in one staff, staff spaces, 12 pieces, from the engraved layout; the same measurement the investigator made): source at 4 bars 0 pairs under 1.5 sp (5 in burgmuller25/016), G9 at the old 4 bars 72 pairs under 1.5 sp (min 0.49) and 485 under 2.0; legacy 15 and 405. After (2 bars): **0 under 2.0 sp on both arms**, tightest 2.25 sp. Narrow drawing at 400 px (352 px svg, about 8.1 px per staff space): tightest 1.48 sp = 12 px (a head is about 9.6 px wide), 21 pairs under 1.5 sp for G9 and 13 for legacy, all at the engraver's own minimum for sixteenths; nothing under 12 px. Before, at the forced 640 px: 6.2 px per staff space and G9's tightest pair 3 px.

**Looked at** (puppeteer screenshots at 400 and 1100 px, first two systems of both sides): the-strife-is-oer, burgmuller25/016, sonatina/025, nearer-my-god, beyer/020, czerny849/002 (and pass-me-not, burgmuller25/006). Rests are present and beat positions readable; ties show as arcs; at 400 px sixteenth heads are clearly separated, systems of one bar where the music is dense (the-strife-is-oer G9 is 30 one-bar systems), no sideways scrolling (page and score box), the 8va/8vb lines are clean. Left-hand clefs are right (bass for the low hands, treble where the hand is written high, e.g. legacy beyer/020). Remaining: TD16 still writes 8va or 8vb over a left hand that sits around G3-F4 whichever clef it has (beyer/020 G9 bars 4-10 get an 8va over the bass staff; pass-me-not G9 gets an 8vb under a treble-clef left hand): two ledger lines sustained is the TD16 rule, not a clef problem; raising TD16's `sustain` or `highLines` is the lever if it reads badly.

**Ottava against the drawn clef (checked after a coordinator query).** The order was already clef first: `neutral.js prepare` writes the per-measure clefs into the graph (`part.clefs`, the map the engraver draws), then runs `addOttava`, which reads `part.clefs` at each onset. Checked independently (ledger lines counted against the clef map of `lowerClefs`, not the graph): all 32 lines (16 per arm on the 12 pieces) are justified by a note needing 2 or more ledger lines in the clef drawn at that measure. Lines per arm on the 12 pieces: before this work (source clefs) G9 17, legacy 20; now 16 and 16. The beyer/020 and pass-me-not cases are not a disagreement: a hand spanning G3-F4 has E4/F4 at exactly two lines over the bass staff, and Ab3 at exactly two lines under the treble one, so no clef avoids TD16's threshold. Extremes still get lines (sonatina/025 and burgmuller25/006 to MIDI 86-88: an 8va in the right hand; czerny849/002 to 93: six right-hand lines; czerny849/002 legacy an 8vb on the left). `tests/review/neutral.test.js` adds: a low left hand under a treble-clef source gets the bass clef and no line (the source-clef graph would get an 8vb), and every line agrees with the drawn clef, is the same for both arms, a high right hand and a low left hand still get lines and a G3-D4 left hand gets none.

**Tests** (`tests/review`): rest counts and values, tie pairing and barline splits, the clef rule and its constants, both arms identical (both layouts), narrow/wide present with the 720 px media query and no `min-width`, unique per-drawing glyph ids, no sideways scrolling at 400 px in a real browser, dense-piece spacing (>= 2.0 sp wide, >= 1.4 sp narrow), audio list frozen, plus the existing leak, blindness and determinism scans.
