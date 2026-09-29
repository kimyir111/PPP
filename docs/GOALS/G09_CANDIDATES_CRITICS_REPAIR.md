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
