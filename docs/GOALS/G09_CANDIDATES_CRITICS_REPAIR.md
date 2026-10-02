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
- **Clef.** Upper staff: treble always. Lower staff, per measure, by fewer ledger lines (the rule a human engraver uses; revised after a coordinator query, the first version counted notes at or below middle C): each note's lines are counted as `realize/ottava.js` counts them (treble staff E4..F5, bass staff G2..A3, two diatonic steps to a line) and summed over the measure; the staff opens in bass; it changes only at a barline and only when the other clef costs at least `CLEF_SAVE_SHARE` = 0.5 less and at least `CLEF_SAVE_MIN` = 4 lines less than the clef in force (a tie or a small gain keeps it); a stretch shorter than `CLEF_MIN_RUN` = 2 measures with notes is folded into its neighbours; a measure with no notes keeps the clef. Neither arm uses the source's clef marks or mid-bar clef changes. Thresholds of 0.25 and 2 lines were tried first and rejected: on the 12 pieces they made 11 (G9) and 6 (legacy) clef changes and 20 and 19 ottava lines (sonatina/025 got four clef changes and two 8vb lines), because mid-range bars differ by only a line or two between the clefs. Clef changes per piece and arm with the final constants: G9 5 in total (pass-me-not 2, czerny849/002 2, beyer/020 1), legacy 4 (burgmuller25/016 3, czerny849/002 1); no piece has more than 3, the rest none.
- The sound (`audioNotes`) is computed from the arm's own notes exactly as before and is byte-identical on all 24 arms looked at (tested with a frozen list).

**Counts (drawn rests and ties, arm vs source).** Source graph / G9 drawn / legacy drawn: the-strife-is-oer rests 24 / 28 / 27 (the whole-bar rest is one of them); burgmuller25/016 rests 44 / 17 / 44, ties 10 / 4 / 0; nearer-my-god rests 12 / 3 / 6, ties 12 / 3 / 0; sonatina/025 rests 28 / 28 / 28 (its arms are the same notes at 3.4 and are refused by the builder at that level; drawn at 2.4), ties 2 (and 42 slurs, which are not drawn). Arm counts differ from the source because the arms are different music and rests are the staff's silences (G9's own rest entries are per voice: 15 in nearer-my-god against 3 silences). Legacy has no ties because ScoreArranger has none. In czerny849/002 the legacy arm has 39 staff-measures skipped as off-grid: it writes sextuplet-like notes as plain 16ths of length 1/12.

**Head gaps** (consecutive onsets in one staff, staff spaces, 12 pieces, from the engraved layout; the same measurement the investigator made): source at 4 bars 0 pairs under 1.5 sp (5 in burgmuller25/016), G9 at the old 4 bars 72 pairs under 1.5 sp (min 0.49) and 485 under 2.0; legacy 15 and 405. After (2 bars): **0 under 2.0 sp on both arms**, tightest 2.25 sp. Narrow drawing at 400 px (352 px svg, about 8.1 px per staff space): tightest 1.48 sp = 12 px (a head is about 9.6 px wide), 21 pairs under 1.5 sp for G9 and 13 for legacy, all at the engraver's own minimum for sixteenths; nothing under 12 px. Before, at the forced 640 px: 6.2 px per staff space and G9's tightest pair 3 px.

**Looked at** (puppeteer screenshots at 400 and 1100 px, first two systems of both sides): the-strife-is-oer, burgmuller25/016, sonatina/025, nearer-my-god, beyer/020, czerny849/002 (and pass-me-not, burgmuller25/006). Rests are present and beat positions readable; ties show as arcs; at 400 px sixteenth heads are clearly separated, systems of one bar where the music is dense (the-strife-is-oer G9 is 30 one-bar systems), no sideways scrolling (page and score box), the 8va/8vb lines are clean. Left-hand clefs are right (bass for the low hands, treble where the hand is written high, e.g. legacy beyer/020; changes are rare, one courtesy clef at a system end where one happens). Remaining: TD16 still writes 8va or 8vb over a left hand that sits around G3-F4 whichever clef it has (beyer/020 G9 bars 4-10 get an 8va over the bass staff; pass-me-not G9 gets an 8vb under a treble-clef left hand): two ledger lines sustained is the TD16 rule, not a clef problem; raising TD16's `sustain` or `highLines` is the lever if it reads badly.

**Ottava against the drawn clef (checked after a coordinator query).** The order was already clef first: `neutral.js prepare` writes the per-measure clefs into the graph (`part.clefs`, the map the engraver draws), then runs `addOttava`, which reads `part.clefs` at each onset. Checked independently (ledger lines counted against the clef map of `lowerClefs`, not the graph): all 32 lines (16 per arm on the 12 pieces) are justified by a note needing 2 or more ledger lines in the clef drawn at that measure. Lines per arm on the 12 pieces: before this work (source clefs) G9 17, legacy 20; with the share-of-notes clef rule 16 and 16; with the final ledger-line clef rule G9 16 and legacy 15 (the same for the check as above; all justified). The beyer/020 and pass-me-not cases are not a disagreement, and the ledger-line clef rule does not remove them: a hand spanning G3-F4 has E4/F4 at exactly two lines over the bass staff, and Ab3 at exactly two lines under the treble one, and both clefs cost about the same, so beyer/020 G9 keeps one 8va and pass-me-not G9 its 8vb (now two 8vb lines). Removing them would take a change to TD16's threshold (not made). Extremes still get lines (sonatina/025 and burgmuller25/006 to MIDI 86-88: an 8va in the right hand; czerny849/002 to 93: six right-hand lines; czerny849/002 legacy an 8vb on the left). `tests/review/neutral.test.js` adds: a low left hand under a treble-clef source gets the bass clef and no line (the source-clef graph would get an 8vb), and every line agrees with the drawn clef, is the same for both arms, a high right hand and a low left hand still get lines and a G3-D4 left hand gets none.

**Tests** (`tests/review`): rest counts and values, tie pairing and barline splits, the clef rule and its constants, both arms identical (both layouts), narrow/wide present with the 720 px media query and no `min-width`, unique per-drawing glyph ids, no sideways scrolling at 400 px in a real browser, dense-piece spacing (>= 2.0 sp wide, >= 1.4 sp narrow), audio list frozen, plus the existing leak, blindness and determinism scans.

### G9 last defect round (compound meter, chromatic harmony, chord thickness)

The last fix round the user agreed to before judging G9 (if G9 still does not beat the legacy ScoreArranger on the user's and the AI judges' eyes, G9 is paused). Node-only: `git diff --stat origin/main`
shows no `engrave/`, app or server file and no roadmap file. It touches `realize/` (`theory.js`, `patterns.js`, `index.js`, `notation.js`), `candidates/index.js` (one option passed through), one new report-only critic,
`realize/tools/harness.js` and tests. `realize/` is loaded by the app only behind the `PPP.arranger` switch (default `legacy`), so nothing visible changes until the user flips it (no `?v=` bump is needed). **The app's g8 path (a direct `realize()` call) changes
with the `compoundBeat` and `leftShape` defaults only** (my 70-realization sweep: 39 differ from origin/main 387b4c5; an independent sweep found 758 of 1278 differing while `diatonicLow` was still on by default). `diatonicLow` is OFF for a direct call and ON only from `candidates/` (as `noStride` is), see 2 and 4b; each option switches its fix off or on. No selection weight, level offset or hard-violation definition was touched (standing rule). One writer;
no sub-agent was dispatched. This section was revised after an independent review: the first commit (`8de3956`) capped the stage-2 stack at a dyad and regressed harmony; the triad is back (see 3).

**1. Measured causes (before changing anything).** Evidence: the blind pre-check (5 pieces drawn through the fixed review page, hand profile large; per-item notes of two independent blind AI teacher judges).
- **Compound meter.** `broken` and `ballad` cut every harmony beat window into 4 equal parts (`realize/patterns.js`). In 6/4 the window is a dotted half (3/4), in 6/8, 9/8 and 12/8 a dotted quarter (3/8): a quarter of it is 3/16 (a dotted eighth) resp. 3/32, which starts
  between the beats and beams across them. nearer-my-god (6/4): 8 dotted eighths per bar. It is reached by `auto` through `policyForStage` (a stage-3 `block` becomes `broken`). `pop` halves a window, the same flaw. Of the 30 distinct files with a plan among the 16-file sample,
  the 32-file held-out slice and the 11 pieces of the h8d and h8f keys only 2 are compound (burgmuller25/003, 6/8; nearer-my-god, 6/4): in them 1696 of the 2008 generated left-hand events were the dotted split (84%; 384 of 384 for `broken`/`ballad` at stage 2, 360 of 372 at stage 3).
- **The G#/G.** beyer/020 (C major): the source beats 1 and 3 of most bars sound only C (melody) over E (left hand). `songgraph/harmony.js` `fitChord` scores every chord by tones covered minus 1.1 x tones outside; C-E fits C major, A minor and E augmented (E G# C) exactly alike
  (two tones in, one out), and the only tie-break is a +0.02 bonus for a root equal to the lowest sounding pitch class, so the windows were labelled **E augmented** (on beats 2 and 4, where G also sounds: C major). The realizer wrote the G# the source never has: E-G#-C then E-G-C.
  The same thin-window tie gives Bmaj (B D# F#) and Dmaj (D F# A) in beyer/061 (key C, source has no F#). So this is **G7a's label being wrong on thin windows and the realizer writing the label literally**. Left hand at stage 2 (onsets with a tone outside the key's scale that the source does not sound
  at that instant): **131 of 1000 block onsets (13.1%)**; `broken`/`ballad` at stage 2 172 of 4000 (4.3%); stage 3 350 of 6139 (5.7%, not gated, see limits).
- **Thickness.** `policyForStage` sets the chord size to a triad for every stage 2 and up and the stack was written as found: `leadVoicing` keeps the chord near the section's register midpoint (the plan's left-hand band, often 50-64), with no bound on the top and no rule on seconds. On the 30
  pieces at stage 2 `block`: **a second below middle C on 107 of 1000 onsets, a top at E4 or above on 273 of 1000 (27%; drawn with an 8va over the bass staff by TD16), a second or third below C3 on 161 (16%)**; 3 notes on all of them. The default `auto` at stage 3 and up is `broken`
  (single notes), so stacks occur at stage 2 and in `waltz`. The defect was the register and the seconds more than the third note.

**2. What changed** (each of the three has its own switch, ON by default; `false` restores the previous behaviour exactly: a fingerprint sweep over 70 realizations of 6 pieces x 3 levels x 7 patterns with all three off equals origin/main 387b4c5 byte for byte).
- `opts.compoundBeat` (`realize/patterns.js` `isCompound`: a beat window whose duration has a numerator divisible by 3 is a dotted value): `broken` and `ballad` split such a window in **three** equal parts (a dotted-half beat: 3 quarters; a dotted-quarter beat: 3 eighths), `broken` low-high-mid, `ballad` one pass up the chord; `pop` gives a long two thirds and a
  short third. A simple meter is unchanged (tested). One rhythm for every stage: three equal parts is the simplest count inside a compound beat.
- `opts.diatonicLow` (**default OFF for a direct `realize()` call; `candidates/index.js` passes `diatonicLow: true`**, `opts.last` and the harness flags `--diatonic-low` / `--no-diatonic-low` override; `theory.js` `DIATONIC_MAX_STAGE = 2`, `keyPcs`, `playedPcs`, `diatonicSubstitute`; `realize/index.js`): at stages 1 and 2, when a window's chord has a tone that **will sound**, is outside the key signature's scale (minor: natural minor plus the raised seventh) **and is not sounded by the source
  in that window**, the chord is replaced by the diatonic maj/min/dim/dom7 chord that covers most of the source's own pitch classes, then holds the inferred root, then shares most tones with the inferred chord, then I V IV vi ii iii vii. A chromatic tone the source sounds is left alone; stages 3 and 4 are left alone.
- `opts.leftShape` (`theory.js`: `STACK_MAX_BY_STAGE = {1:1, 2:3, 3:3, 4:3}` (one note at stage 1, **a triad from stage 2**), `LH_CHORD_TOP = 60` (middle C), `SECOND_BELOW = 60`, `CLUSTER_BELOW = 48`, `thinChord`, `chordLegal`, `settleChord`, `clusterPairs`; `patterns.js` `shapeChord`): every chord a `block`, `broken` or `ballad` window uses is (a) for a stack (`block`)
  thinned to the stage's cap (root, fifth, third, seventh: a triad is kept whole), (b) if it is not already legal, re-placed by whole octaves (pitch classes and count kept) so that its top is at or under middle C (no ledger line pair or 8va over the bass staff), it is inside the hand's span and the register floor, and, for a stack, it has no second below C4 and no third below C3; among the
  placements of a chord that had to move, the one closest to the chord written before it (no octave leap from that bass). A chord that is already legal is kept exactly as voice-led (measured: re-placing legal chords by the previous chord cost harmony on the SATB hymns and gained nothing on jumps). (c) **A stack whose triad cannot be placed legally falls back to the dyad (root and fifth) for that window only** (0.8% of stage-2 block windows at hand profile large, about 8% at small and medium, from an independent count).
  Left hand only for (b) and (c). The stride patterns (`pop`, `waltz`) are not shaped (off in the default candidate set, their own geometry; but reachable through `auto` in the app's g8 path, where a triple meter resolves to `waltz`); `pop` only gets the compound split.
- Report only: `critics/left-hand-thickness.js` (not part of `evaluate`, not a selection weight) and harness rows; `candidates/index.js` passes `opts.last` to the realizer (and into its cache key); harness flags `--no-compound-beat`, `--no-diatonic-low`, `--no-left-shape`.
- Two intermediate versions were measured and dropped. (i) Holding arpeggios to the cluster rule spread them into open voicings and left-hand jumps rose from 2.9% to 7.4%: clusters are now checked for stacks only. (ii) **The stage-2 dyad cap** (the first commit, following the suggested "2 at stages 1-2"): it dropped the third, see below.
- The existing floor test ("the floor never changes a pitch class") is now run with `leftShape: false`, because the shape re-places arpeggio chords by the floor as well; the floor itself is unchanged.

**3. The dyad was the cause of the harmony loss (measured, replacing the first commit's explanation).** The first version's explanation, that the harmony metric rewards G7a's wrong thin-window labels, was not supported. Per file (G9 + repair, root+quality harmony / assessed level; requests are the sample's own):

| file (target) | 387b4c5 | 8de3956 (dyad) | this fix (triad) |
|---|---|---|---|
| all-creatures (3.88) | 0.853 / 2.76 | 0.794 / 2.40 | **0.912** / 2.40 |
| all-glory-laud (2.76) | 0.931 / 2.40 | 0.806 / 2.40 | 0.931 / **2.76** |
| christ-arose (2.76) | 0.975 / 2.76 | 0.813 / 2.40 | 0.963 / 2.87 |
| god-rest-ye-merry (2.87) | 0.975 / 2.76 | 0.800 / 2.41 | 0.938 / 2.80 |
| czerny599/013 (2.11) | 1.000 / 2.29 | 0.938 / 2.37 | **0.906** / 2.40 |
| burgmuller25/003 (3.8) | 0.948 / 2.79 | 0.948 / 2.79 | 0.948 / 2.79 |
| pass-me-not (3.87) | 0.906 / 2.87 | 0.938 / 2.87 | 0.938 / 2.87 |

Review requests (same three states): nearer-my-god 2.4: 1.000 / 2.24, 1.000 / 2.24, 1.000 / 2.36 (now `block`); burgmuller25/016 3.9: 0.944 / 3.46 in all three; what-child-is-this 3.46: 0.725, 0.725, **0.902** (level 3.46 throughout); when-i-survey 2.24: 1.000 / 2.24, 0.875 / 2.22, 0.938 / 2.24;
beyer/020 2.55: 0.828 / 2.40, 0.828 / 2.11, 0.828 / 2.11 (still the stage-1 single-bass texture); beyer/061 3.24: 0.969 / 2.87 (old thick block), 1.000 / 2.24, 1.000 / 2.24 (the source itself, see limits). The harmony losses were on the fully sounded SATB hymns, whose stage-2 `block` texture lost its third under the dyad; the thin-window pieces (beyer/020, beyer/061) did not lose harmony, and the diatonic rule alone costs at most 0.0009 (ablation).

**4. Numbers, before and after** (G9 after repair, `g9aRepair`; `node realize/tools/harness.js --sample 16 --g9a --repair --timeout-s 120` and `--held-out 32 ... --timeout-s 180`; outputs kept outside the repo; 12 of 16 and 14 of 32 files have a reachable plan). 387b4c5 = origin/main, 8de3956 = the dyad version, now = this fix.

| | 16-file 387b4c5 | 16-file 8de3956 | 16-file now | held-out 387b4c5 | held-out 8de3956 | held-out now |
|---|---|---|---|---|---|---|
| hard violations (files at 0) | 12/12 | 12/12 | 12/12 | 14/14 | 14/14 | 14/14 |
| level within +-1 / mean distance | 10/12 / 0.3258 | 10/12 / 0.3625 | 10/12 / **0.3350** | 14/14 / 0.3957 | 14/14 / 0.4464 | 14/14 / **0.3921** |
| melody | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 1.0000 |
| harmony root+quality / root-only | 0.9753 / 0.9778 | 0.9548 / 0.9643 | **0.9724** / 0.9788 | 0.9726 / 0.9765 | 0.9507 / 0.9743 | **0.9712** / 0.9788 |
| engrave silent / hard layout (files at 0) | 12/12, 12/12 | 12/12, 12/12 | 12/12, 12/12 | 14/14, 14/14 | 14/14, 14/14 | 14/14, 14/14 |
| left-hand jump rate | 2.86% | 2.49% | 24/962 = 2.49% | 5.23% | 4.41% | 59/1244 = 4.74% |
| low-register cluster rate | 2.33% | 0% | 0% | 4.07% | 0% | 0% |
| left-hand notes per onset (pooled) | 1.296 | 1.195 | 1.309 | 1.263 | 1.151 | 1.290 |
| notes below E2 / below G2 | 0 / 43 | 0 / 16 | 0 / 17 | 1 / 77 | 1 / 57 | 1 / 55 |
| selected pattern histogram | auto 3, hymn 7, ballad 1, block 1 | auto 4, hymn 7, block 1 | auto 4, hymn 7, block 1 | auto 6, hymn 7, block 1 | auto 5, hymn 7, ballad 1, broken 1 | auto 5, hymn 7, block 2 |

**Against the best legacy arm (ScoreArranger), same runs** (ScoreArranger: 16-file hard 10/12, level 10/12 and distance 0.3042, melody 0.9845, harmony 0.9467 / 0.9565, engrave 12/12; held-out hard 9/14, level 14/14 and distance 0.4507, melody 0.9744, harmony 0.9661 / 0.9692, engrave 14/14):

| five metrics, G9 + repair vs ScoreArranger | 16-file 387b4c5 | 16-file 8de3956 | 16-file now | held-out 387b4c5 | held-out 8de3956 | held-out now |
|---|---|---|---|---|---|---|
| hard violations (G9 / SA files at 0) | 12 vs 10: win | win | win | 14 vs 9: win | win | win |
| level mean distance (G9 / SA; lower wins) | 0.3258 / 0.3042: **loss** | 0.3625: **loss** | 0.3350: **loss** | 0.3957 / 0.4507: win | 0.4464: win by 0.004 | 0.3921: **win by 0.059** |
| melody | 1.0000 / 0.9845: win | win | win | 1.0000 / 0.9744: win | win | win |
| harmony root+quality (G9 / SA) | 0.9753 / 0.9467: win | 0.9548: win | **0.9724: win** | 0.9726 / 0.9661: win | 0.9507 / 0.9661: **loss** | **0.9712: win by 0.005** |
| harmony root-only | 0.9778 / 0.9565: win | 0.9643: win | 0.9788: win | 0.9765 / 0.9692: win | 0.9743: win | 0.9788: win |
| engrave (files at 0) | tie | tie | tie | tie | tie | tie |

Net: this fix returns the harmony win on the held-out slice (the 8de3956 loss, 0.9507 against 0.9661, is gone) and the 16-file level loss to ScoreArranger (0.335 against 0.3042) remains, as it was at 387b4c5. Against 387b4c5 itself the remaining regressions are: **harmony root+quality -0.0029 (16) and -0.0014 (held-out); level distance +0.0092 (16) and -0.0036 (held-out, better)**, and per file **god-rest-ye-merry harmony -0.037 (0.975 to 0.938) and christ-arose -0.012 (0.975 to 0.963)**; hard violations, melody and engrave did not move; jumps, clusters and notes below G2 improved.
Not fixed by the triad: **czerny599/013 (harmony 1.000 to 0.906)**, a selection that moved to another candidate once the register rules changed the candidate pool (with `leftShape: false` it selects a 0.969 candidate); about 0.016 of the drop is `diatonicLow` in my ablation (an independent run found about 0.03); and **all-creatures' level (2.76 to 2.40)**: that piece is 6/4 and any setting with the compound split on gives 2.40, but the shape rules alone also move it from 2.76 to 2.62, so it is not only the compound split; G6 assesses the simpler rhythm and the lower register as easier, so it lands further from the 3.88 target. Both are real costs of the fixes, not measurement artefacts. The selected G9 output still has 17 (16-file) and 15 (held-out) left-hand onsets with a chord top at E4 or above; all are in verbatim `hymn` sections (source notes are never re-placed).

**4b. The plain realizer (the app's g8 path), one option at a time** (`node realize/tools/harness.js --sample 16 --timeout-s 120` without `--g9a`, G8a row, 12 files with a plan; `off` = all three options off = origin/main 387b4c5, `def` = the defaults now: compoundBeat and leftShape on, diatonicLow off). G9 headline numbers with `candidates/` turning `diatonicLow` on are unchanged to the last digit from 69ab3bc.

| G8a, 16-file | hard (files at 0) | level +-1 / distance | harmony root+quality / root-only | jump | cluster |
|---|---|---|---|---|---|
| off (= 387b4c5) | 12/12 | 8/12 / 0.6675 | 0.9328 / 0.9492 | 0.53% | 1.34% |
| compoundBeat only | 12/12 | 8/12 / 0.6883 | 0.9445 / 0.9609 | 0.48% | 1.23% |
| leftShape only | 12/12 | 9/12 / 0.7483 | 0.9302 / 0.9466 | 0.45% | 0% |
| diatonicLow only (on) | 12/12 | 9/12 / 0.5792 | **0.8639** / 0.9412 | 0.53% | 1.34% |
| **default now (compoundBeat + leftShape)** | 12/12 | 8/12 / 0.7733 | **0.9433** / 0.9597 | 0.41% | 0% |

`diatonicLow` alone costs the plain path 0.069 of harmony (fur-elise 0.917 to 0.333, sonatina/003 0.919 to 0.748): inside G9's selection a candidate that loses harmony is simply not selected (<= 0.003 measured), but a direct call writes it, so it is OFF there. `compoundBeat` and `leftShape` do not cost the plain path harmony (+0.0117 and -0.0026; together +0.0105) or hard violations; **they do raise the plain path's level distance to the target (0.6675 to 0.7733 together; leftShape alone +0.081), at the same 8/12 within +-1.** I kept both on because harmony does not fall and the seconds and the 8va are the defects being fixed; the level distance is the cost, and moving `leftShape` to `candidates/` only is one line if the coordinator prefers it.

**Occurrence of each defect at the realize level** (30 files; counts of left-hand onsets, old -> new): stage 2 `block`: seconds below C4 107 -> 0, tops at E4+ 273 -> 0, low clusters 161 -> 0, invented chromatic tones 131 -> 2, 3-note stacks 100% -> 98.8% (the rest are dyad fallbacks); stage 2 `auto` (its `hymn` sections are verbatim source and untouched): seconds 95 -> 0, tops 232 -> 0; compound meters: dotted splits 1696 of 2008 events -> 0 of 1584.

**What the screenshots show** (puppeteer, 400 px wide, the review page, both arms; before = origin/main or 8de3956, after = this fix). (1) **nearer-my-god (6/4):** before, runs of 4 dotted eighths per dotted-half beat; with the compound fix, three quarters per beat (first commit) and, at the final selection, a block triad per dotted-half beat in the bass staff, top C4 on one ledger line, no 8va, no second, two countable chords per bar (one bar at the bottom of the register has a triad on two ledger lines below the staff, at the E2 floor).
burgmuller25/003 (6/8): eighths in threes, beamed per dotted-quarter beat. all-creatures (6/4): quarter-note arpeggios in threes. (2) **The four hymns christ-arose, god-rest-ye-merry, when-i-survey, all-creatures** (all flagged by the judges): christ-arose and god-rest-ye-merry are three-note quarter-note chords on every beat, inside the bass staff plus at most one ledger line (C4), no 8va, no visible second, steady and countable; they are not thin, and only moderately thick (close position, each chord is a plain triad). (3) **beyer/020:** before, triads alternating # and natural with an 8va; now the chromatic tones and the 8va are gone, but the selection is a stage-1 single bass note per beat (E C E C), clean and thin, as in the first commit. (4) **beyer/061 before:** close triads, an Eb-F#-B chord, clusters and an 8va; now not drawn (G9 returns the source).
I changed nothing after looking beyond the dyad reversal above.

**Tests** (all pass; `npm run test:realize` 73, `test:critics` 73, `test:repair` 28, `test:review` 70, `test:arrangement-planner` 17, `test:playability` 57, `test:songgraph` 45, `test:difficulty` 34): `tests/realize/last-defects.test.js` (17, incl. that `diatonicLow` is off for a direct call, on from `candidates/` and overridable: compound rhythm per meter 6/8, 9/8, 12/8, 6/4, off-switch and simple-meter identity, pop; real nearer-my-god and burgmuller25/003; `keyPcs`, `diatonicSubstitute` incl. the source-accidental exemption, minor, every substitute in key;
beyer/020 no invented chromatic tone; the stage gate; `thinChord` order and the stack table `{1:1,2:3,3:3,4:3}`; `settleChord` legal-stays, top, seconds, thirds, span, floor, continuity only for chords that must move, determinism; beyer/061 stage 2 triad with no seconds and no tops; the triad-to-dyad fallback for one window; the switches restore the old behaviour; right hand, melody and `hymn` voices untouched; determinism, floor held),
`tests/critics/left-hand-thickness.test.js` (3).

**Known limits.** (1) **beyer/061 is now the source itself at every target tried (2.6, 2.9, 3.24, 3.6, 4.0)**: G9 selects the `hymn` candidate (level 2.24), identical to the legacy arm, where it used to choose the thick block arrangement (level 2.87); the stage-3 `broken` candidates lose on register density and harmony. The review builder refuses an identical pair, so the piece is left out of packets.
(2) beyer/020 is still a stage-1 bass line at 2.55 (level 2.11), thin, because selection prefers it. (3) **Stage 3 and 4 are not substituted: the chromatic tones G7a invents remain in `broken`/`ballad` (stage 3: 288 of 5103 onsets, 5.6%).** (4) `pop` and `waltz` are not shaped (only `pop` gets the compound split), and they are reachable through `auto` in the app's g8 path (a triple meter resolves to `waltz`) and by explicit request. (5) Only 2 of the 30 measured pieces are compound; 9/8 and 12/8 are covered by pattern-level tests only.
(6) The app's g8 path changes with the `compoundBeat` and `leftShape` defaults (39 of 70 direct realizations differ from 387b4c5; `diatonicLow` is off there); it is behind `PPP.arranger`, default `legacy`, no `?v=` bump needed. The plain path's level distance rises (see 4b). (7) czerny599/013 lost harmony (1.000 to 0.906) and all-creatures' level stays at 2.40. (8) `settleChord` is not exactly idempotent when no placement is fully legal. (9) No human has looked at the after packet. Not deployed.

### Review page sound: the app's own sampled piano

**Why.** The user asked why the review page sounds like "a mechanical piano" and not PPP's piano. They were right: `review/lib/page.js` played every note with a two-oscillator Web Audio tone (triangle plus a quiet octave sine), while the app plays a sampled grand (Salamander, Yamaha C5, `audio/piano/*.mp3`). A plain tone also makes chords sound harsher than they are, and the user judges harmony by ear, so the synth was a validity problem for the review itself, separate from anything the arrangers do.

**What changed** (only `review/`, `tests/review/` and this note; no app, `engrave/` or server file). The page now plays the same notes (`audioNotes`, unchanged: ties joined, unison duplicates deduped) on the app's sampler, ported from `Piano Coach App.dc.html`: `PIANO` (constants: lowest key 21, one recording per 3 semitones, decode rate 32 kHz, velocity 80, 72 voices), `pianoAttack`, `pianoDamp`, `pianoRoom`, `PianoSamples.pick` and `PianoPlayer.strike / release / prune / silence` (per-voice lowpass by velocity, limiter, bus 1.4, room 0.22 wet, one string per key, damper release). Every note is struck at one fixed mezzo-forte (velocity 80) for both arms, held for its written length and released like a damper. The recordings are read from `audio/piano/` by `review/build.js` at build time and embedded ONCE per page as base64 (1.67 MB; no copies are committed); the page decodes them from those bytes (`atob`, `decodeAudioData`) on the first Play press and fetches nothing, so it works from disk and inside an Artifact page. The button reads "소리 불러오는 중..." while decoding; if decoding fails the old synth plays the same notes, and a key whose recording failed borrows a neighbour's. Packet sizes: 16 items 5.7 MB (H-8) and 6.5 MB (H-9), 11 items 4.2 MB (before: about 4.0 and 4.8 MB for 16 items). The leak scan no longer reads the audio block: 1.67 MB of random base64 contains "g9" 513 times and "g8" 783 times by chance, so `tests/review/helpers.js` `splitAudio` takes the block out of the scanned text, and `checkAudioBlob` first proves the block is exactly a JSON list of 30 base64 strings, each byte-equal to the repository's own recording for that key and an MP3. That is safe because the block is a closed alphabet a reviewer never reads, it is the same 30 files on every page and for both arms, and every other byte of the page is still scanned.

**Measured (headless Chrome via puppeteer; nobody has heard any of it).** (a) All 30 samples decode (73 ms in headless, 32 kHz stereo): durations 3.9 to 9.0 s, peaks 0.10 to 0.45, hammer onset 4 to 20 ms. (b) Pressing Play on a real item decodes and schedules in about 0.1 to 0.2 s and creates one voice per note (144, 169, 34, 27 voices for the four sides of two items; 419 and 546 for the densest side of the 16-item H-8 and H-9 packets, replaying them takes 35 to 50 ms from click to playing); no error, no request; the same on the packet wrapped as an Artifact fragment (no doctype, html, head or body) with `fetch` and XHR disabled. (c) An offline render of the first 20 s of a real side through the same code path: peak -4.2 dBFS (i01 X) and -6.1 dBFS (i02 Y), no clipped sample, active RMS -18.6 and -22.1 dBFS. The old synth rendered the same phrases at peak -3.9 and -6.8 dBFS, active RMS -15.9 and -18.5 dBFS: about 2.6 to 3.6 dB louder on average for a similar peak. Energy above 2 kHz is 0.66% against 0.05% (i01 X) and 0.15% against 0.08% (i02 Y) of the signal, spectral centroid 448 Hz against 337 Hz and 257 Hz against 265 Hz, and the first note reaches half its first-300 ms peak in 3.9 ms against 10.2 ms (i01 X; the other way round for i02 Y, 18.4 ms against 6.4 ms, which starts on a different kind of note). These numbers say the new sound is not the synth and is not clipping; they do not say it sounds like a piano.

**Review fixes (same branch).** (1) iOS unlock: `playSound` now does the app's `wake` / `unlock` / `ping` inside the tap, before any await: it creates or resumes the `AudioContext` and starts a one-frame silent buffer, and only then decodes; a headless test logs the audio calls and checks that the context and the silent start happen synchronously in the click, before the decode resolves. iOS itself cannot be tested headless, so whether the first press is audible on an iPhone is unverified. (2) The end-of-phrase `silence(0.06)` cut the top octaves (damper release 0.6 s) while still audible; a phrase that plays to its end now only resets the button (every note was already released by its own damper), and only Stop silences; tested by counting damper releases. (3) `t0` is now taken after the player is built (the decode was already before it), keeping the fixed 0.12 s lead; tested with a player build slowed by 150 ms. (4) The page ends with the CC BY 3.0 credit for the Salamander recordings in Korean and English, wording from `audio/piano/README.md`, no link and no arrangement source.

**Honest limit.** Nobody has listened to this page yet, including the implementer, who cannot listen. The port reproduces the app's code and constants, and the sample set is the app's, so it should sound like the app's piano with two known differences: no pedal and no dynamics (a flat mezzo-forte), and the room noise is a fixed sequence rather than `Math.random` (the same statistics). Whether the level is comfortable, whether the lowpass at velocity 80 sounds right on a phone speaker, and whether chords now sound as the arrangements really are, are open until the user plays one. The first Play press decodes 30 files, which was measured fast on a desktop and not on a phone. Packets built before this change keep the old synth (their page has no sample block); rebuild to get the piano.

**Tests** (`tests/review`): samples embedded once and byte-equal to the repository files; all 30 decode to real recordings with the loading label shown; one voice per note and the page's note list equal to the packet's; the nearest-recording pick never pitches a key more than a semitone; stop while loading cancels; the synth takes over when `decodeAudioData` refuses or the block is absent; one corrupted sample is covered by a neighbour; an offline render is audible and unclipped and differs from the synth; the Artifact-style fragment works with requests blocked; the leak scan still runs on everything except the audio block and that block is itself checked; the frozen `audioNotes` tests are untouched.

### G9 clash guard, seconds and one-hand spans (post user review 3)

The user's third look at the G9 output, by eye and ear with two screenshots (in Korean): (1) "notes stuck together (adjacent noteheads, a second) and playing an octave or more at once in one hand is very hard"; (2) "the harmony got weirder than before and the notes sound strange". (The review page's synthesized piano instead of the app's is fixed separately.) Node-only: `git diff --stat origin/main` shows no `engrave/`, app or server file and no roadmap file. It touches `realize/` (`theory.js`, `patterns.js`, `index.js`, which the app loads only behind `PPP.arranger`, default `legacy`), `candidates/index.js` (one option passed, one weight-0 term), `critics/` (one new report-only critic), `realize/tools/harness.js` and tests. No selection weight, level offset or hard-violation definition was touched (standing rule). Done directly by one writer; no sub-agent was dispatched. Committed on `g9-clash-guard`, not merged, not deployed.

**1. Measured causes (before changing anything; `critics/vertical-clash.js` is the measuring tool).** Definitions: a *harsh pair* is two sounding notes whose pitch-class interval is 1 or 11 (minor second, major seventh, minor ninth at any octave), counted when one of them attacks; hands are the graph's limbs (what is drawn on each staff), not a pitch-60 split, so the counts differ slightly from the proxy count in the brief. Evidence = the G9 arm (`candidates` + `repair`, all defaults, d5f715f) for the 8 hymns of `D:/PPP-review-keys/h8h/key.json` and the 16 pieces of `h9wide2`; attribution by comparing every note with the source (same pitch at the same onset = a source note; "source has both pcs" = the source sounds both pitch classes at that instant).
- **Harsh pairs, 16 pieces: 83 over 2224 onsets (0.037 per onset), 8 hymns: 31.** By cause (16 pieces): **(a) a generated left-hand tone against the melody note sounding with it: 51 (broken 36, block 15)**; 31 of them have no counterpart in the source (the rest, 20, are pairs the source sounds too); **(b) two generated tones of one stack: 8, all `block`: the maj7 voicing root + third + seventh (C E B) holds its own major seventh** (nearer-my-god m9 C3+B3, m12 F#2+G3; christ-arose m5 C3+B3; what-child-is-this 4); (c) a generated tone against a source note that happens to sit at the same pitch and onset (held for the window after the source note ended): 4; (d) pairs of source notes only (verbatim `hymn` sections and the melody against a source inner voice): 20, unchanged by any realizer rule and present in the source. Examples: all-creatures (6/4, `broken`): 12 of its 13 pairs are a chord tone of the window label under a melody that moves inside the window, F#4 (melody) over G3, G4 over F#3, D4 over C#3, C#5 over D3 (m2, m4, m5, m10, m13, m14); nearer-my-god m1, m5, m13: F#3 (held chord tone) under G4; christ-arose m13: B2 under C5, F2 under E5. The window is a beat (a dotted half in 6/4) and the label covers the window, not the instant. **Not the cause: `diatonicLow`** (83 pairs with it off, 83 with it on), **not verbatim sections** (they carry only the (d) pairs); **`leftShape` (last round) added 12** (71 with it off): it re-places a chord by whole octaves and so can move a tone next to the melody.
- **One-hand octave-plus chords (one hand's sounding notes span 12 or more semitones, held notes included): 8 hymns, left hand 27 of 336 hand-chords, right hand 0; 16 pieces: 29 (left hand, generated stacks) + 4 (left hand, verbatim).** By pattern and stage of the selected G9 output: `block` (generated stack) 23 of the 27 in the 8 hymns (christ-arose 12, all-glory-laud 6, god-rest-ye-merry 4, nearer-my-god 1), verbatim `hymn` 4 (pass-me-not). So the brief's hypothesis that they come "mostly from the `hymn` pattern" holds for the pattern as such and not for the final selection: a `hymn` realization of the same pieces has 27 (christ-arose), 24 (god-rest-ye-merry), 19 (pass-me-not), 21+3 (all-creatures), and in the selected output those pieces had chosen `block`/`auto`. The generated stacks are wide because `leadVoicing` and `settleChord` only bounded them by the hand profile's span (14 at `large`): a dom7 or min7 stack root + third + seventh voiced F2 B2 G3 spans 13.
- **Simultaneous seconds within a hand: 0 in any generated stack (the "no second below C4" rule already held); the 16 pieces have 14 (RH 14, LH 0), all between notes of the source**: the melody voice's own two-note events and a kept inner voice (burgmuller25/016 8, czerny599/032 4, all-creatures 1, burgmuller25/019 1). (The brief counted 43 for the legacy arm over the same 16 pieces, by a pitch-60 split.)
- **The source itself has the same vertical clashes and wide voicings**: a hymn is written for four singers. Source left-hand octave chords: nearer-my-god 8, christ-arose 27, all-creatures 18 (+3 right hand); source harsh pairs: all-creatures 7, the-strife-is-oer 12, christ-arose 3. The realizer therefore leaves a pair alone where the source sounds it (spec (a)); what it must not do is write one the source does not have.

**2. What changed.** Three switches in `realize()` (each with its stage gate and named constants in `realize/theory.js`; `false` restores the previous behaviour exactly: with all three off, 30 fingerprints (6 pieces x `auto`, `block`, `broken`, `ballad`, `hymn`) equal origin/main d5f715f byte for byte, `tests/fixtures/clash-guard-golden.json`).
- `opts.melodyClash` (default ON, every stage up to `MELODY_CLASH_MAX_STAGE` = 4): any generated event, of any pattern, is checked against the melody notes (the plan's melody voice, verbatim source) sounding during it; a tone that is HARSH (`isHarshPair`) against one of them, unless the source sounds that tone's pitch class during the overlap, is **dropped** from a stack, or, when it is the only tone (an arpeggio step), **replaced by another tone of the window's chord** that clashes with nothing (nearest, not under the register floor); an event where every chord tone clashes is left and counted (`report.clash.unresolved`). Re-octaving cannot help (the clash is by pitch class), so there is none. (`guardTones`, `guardEvent`.)
- `opts.handGuard` (default ON; needs `leftShape`; stages <= 3, stage 4 keeps the old rules; `handGuardFor`): for every generated one-hand stack (`block`; either hand): **no second anywhere in the register** (the old rule: none below middle C; `ANY_SECOND`, `NO_SECONDS_MAX_STAGE` = 3), **span at most 10 semitones** (`ONE_HAND_SPAN_CAP`, `SPAN_CAP_MAX_STAGE` = 3; the smaller of the cap and the profile's span, so profile small is unchanged), and **no harsh pair between its own tones** (`unclashStack`, `STACK_CLASH_MAX_STAGE` = 3: a maj7 stack gives its seventh up for the fifth, C E B becomes C E G). A seventh chord (root, third, seventh) that cannot be placed under these rules and the existing top/floor/cluster rules **now falls back to root-third-fifth** (`fifthForSeventh`) before the dyad: without that step 9 of 12 roots of dom7, min7 and m7b5 fell to a dyad (root and third), with it all 108 root x quality chords of stages 2 and 3 are triads (tested).
- `opts.hymnThin` (**default OFF for a direct `realize()` call, ON from `candidates/`** (as `diatonicLow` is; `opts.last.hymnThin: false` or the harness `--no-hymn-thin` turns it off there); stages <= `HYMN_THIN_MAX_STAGE` = 3): in a verbatim `hymn` section, where one hand's simultaneous notes span an octave or more or hold a second, an **unprotected** note is dropped (written as a rest of its length; a whole tied chain goes together). Protected: the section's melody voice and the lowest voice of the left hand (the bass): a melody or bass note is never dropped or moved. Which note goes: a doubling of a pitch class the hand sounds anyway first, else the one farthest from the protected note it is stacked on; the first whose removal clears the violation. A violation that only protected notes make is left (`report.clash.hymnUnresolved`: gymnopedie-1 3, sonatina/004 1). `hymnThinDrops` in `realize/index.js`.
- Report only: `critics/vertical-clash.js` (harsh vertical pairs per onset, arranged pairs with `sourceNotes`, one-hand octave-plus chords and seconds per hand; in `evaluate`, weight 0 in `candidates/index.js` `DEFAULT_WEIGHTS`, `CLASH_RATE_CAP`, `--weights verticalClash=1` counts it) and the harness rows (`vcl*` fields; flags `--no-melody-clash`, `--no-hand-guard`, `--no-hymn-thin`, `--hymn-thin`).

**What the guard does to harmony agreement (measured).** Direct `hymn` realization of the 7 hymns that build (the-strife-is-oer's explicit `hymn` fails to build in both states): mean root+quality **0.868 (verbatim) to 0.837 (thinned)**, and **G5 hard violations 28 to 0**: the verbatim copies all carry span violations at profile large (christ-arose 3, god-rest-ye-merry 9, all-glory-laud 5, all-creatures 6, pass-me-not 3, nearer-my-god 1, when-i-survey 1), so **before, a hymn candidate was usually discarded by the hard filter, and now it survives** (this is why the selection moves to `hymn` below). all-creatures loses most (1.000 to 0.824: 32 notes dropped, 1 unresolved), pass-me-not and christ-arose nothing, nearer-my-god nothing. Ablation over the 16-file sample (one switch at a time, G9 + repair): `melodyClash` alone harmony 0.9724 to 0.9649 (removing a tone lowers the quality reading), `handGuard` alone level distance 0.3350 to 0.3650 and harmony 0.9666, `hymnThin` alone level distance 0.3025 and harmony 0.9651.

**3. The hand profile (G5 `handProfile`: small 10, medium 12, large 14 semitones).** The 8 hymns of the h8h key, G9 + repair requested at each profile (request profile, all else as the review; `n` = 8):

| profile, guard | level within +-1 / mean distance | harmony root+quality | one-hand octave-plus chords | harsh pairs per onset | LH notes per onset |
|---|---|---|---|---|---|
| small, old | 7/8 / 0.540 | 0.9076 | 0 of 285 | 0.0199 | 1.438 |
| small, guard | 7/8 / 0.476 | 0.9114 | 0 of 462 | 0.0120 | 1.579 |
| medium, old | 7/8 / 0.537 | 0.9194 | 9 of 364 | 0.0206 | 1.527 |
| medium, guard | 6/8 / 0.506 | 0.9502 | 0 of 600 | 0.0168 | 1.494 |
| large (the review default), old | 7/8 / 0.449 | 0.9452 | 27 of 336 | 0.0310 | 1.605 |
| large, guard | 6/8 / 0.506 | 0.9502 | 0 of 600 | 0.0168 | 1.494 |

Before the guard, only `small` (a span of 10) removed the octave chords, and it cost 0.038 harmony, 0.09 of level distance and 10% of the left hand's notes per onset against `large`. With the guard the octave-plus chord is gone at every profile, so **the profile no longer has to carry that rule; I recommend keeping `large` (harmony 0.950, same as medium) and report the choice; I did not change any default.** `small` has the best level distance with the guard (0.476 against 0.506) and 0.04 less harmony: it is the choice only if the user wants the span-10 guarantee on the source's own voices at stage 4 too (the guard is off there). Medium and large give identical outputs on these 8 hymns with the guard.

**4. Numbers, before and after** (`node realize/tools/harness.js --sample 16 --g9a --repair --timeout-s 120` and `--held-out 32 ... --timeout-s 180`; outputs kept outside the repo; 12 of 16 and 14 of 32 files have a reachable plan; "before" = d5f715f = the run with all three switches off, equal to a run of the untouched d5f715f copy on the five metrics and the jump rate; "after" = this commit). G9 after repair:

| | 16-file before | 16-file after | held-out before | held-out after | ScoreArranger 16 / held-out |
|---|---|---|---|---|---|
| hard violations (files at 0) | 12/12 | 12/12 | 14/14 | 14/14 | 10/12 / 9/14 |
| level within +-1 / mean distance | 10/12 / 0.3350 | 10/12 / **0.3325** | 14/14 / 0.3921 | **13/14 / 0.4271** | 10/12 / 0.3042; 14/14 / 0.4507 |
| melody | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 0.9845 / 0.9744 |
| harmony root+quality / root-only | 0.9724 / 0.9788 | **0.9648 / 0.9735** | 0.9712 / 0.9788 | 0.9774 / 0.9831 | 0.9467 / 0.9565; 0.9661 / 0.9692 |
| engrave silent / hard layout (files at 0) | 12/12, 12/12 | 12/12, 12/12 | 14/14, 14/14 | 14/14, 14/14 | 12/12; 14/14 |
| **harsh pairs per onset** | 0.0283 (47 / 1658) | **0.0208** (34 / 1635) | 0.0346 (70 / 2026) | **0.0266** (50 / 1881) | 0.0250; 0.0331 |
| harsh pairs with a note the source does not have | 25 | 6 | 29 | 10 | 0 |
| **one-hand octave-plus chords LH / RH** (of one-hand chords) | 9 / 0 (of 230) | **3 / 0** (of 370) | 28 / 1 (of 482) | **7 / 1** (of 606) | 33 / 6 (of 411); 87 / 3 (of 692) |
| **one-hand seconds LH / RH** | 0 / 1 | 0 / 1 | 0 / 15 | 0 / 15 | 29 / 4; 10 / 11 |
| LH notes per onset (pooled) | 1.309 | 1.278 | 1.290 | 1.227 | 1.306; 1.273 |
| left-hand jump rate | 2.49% | 3.01% | 4.74% | 5.27% | 4.97%; 8.07% |
| low-register cluster rate | 0 | 0 | 0 | 0 | 0; 0.97% |
| arranged notes below E2 / below G2 | 0 / 17 | 0 / 16 | 1 / 55 | 1 / 41 | 0 / 20; 0 / 39 |
| selected pattern histogram | auto 4, hymn 7, block 1 | hymn 9, auto 2, ballad 1 | auto 5, hymn 7, block 2 | hymn 9, auto 5 | |
| repair units accepted | 6 | 0 | 3 | 4 | |

**Regressions, exactly.** Against the previous G9 (not against any acceptance bar): **16-file harmony root+quality -0.0076 (0.9724 to 0.9648) and root-only -0.0053; held-out level: 14/14 to 13/14 files within +-1 (pass-me-not 2.87 to 2.79 against a target of 3.87, a miss of 1.08) and mean distance +0.0350 (0.3921 to 0.4271); left-hand jump rate +0.52 and +0.53 points; left-hand notes per onset -0.031 and -0.063.** Hard violations, melody and engraving did not move. Against ScoreArranger the five-metric table is as before: hard, melody, engrave and harmony win in both samples, **level distance loses on the 16-file sample (0.3325 against 0.3042, it was 0.3350)** and wins on held-out (0.4271 against 0.4507, by 0.024; it was by 0.059). The held-out harmony rose (0.9712 to 0.9774), consistent with thinned hymn candidates passing the hard filter that discarded the verbatim ones (not isolated). The level shift is selection following its own unchanged weights: a hymn candidate that no longer has hard violations is now reachable and is closer to the target than the block candidate it replaces (christ-arose 2.87 to 2.40 against 2.76, all-creatures 2.40 to 2.79 against 3.88); nothing was tuned around it.

What is left: (1) **octave-plus chords (16: 3, held-out: 7 + 1 RH) are the stage-4 pieces (the gate: how-firm-a-foundation 6 + 1) and 4 protected pairs** (gymnopedie-1 3, sonatina/004 1: melody and bass in one hand); (2) **right-hand seconds (14 and 15) are the source's own melody-voice chords** (and kept inner voices at stage 4), which the realizer never edits; (3) **harsh pairs**: on the 16-piece wide set 83 fall to 41 and every one of the 41 is a pair the source sounds too (23 between source notes only, mostly verbatim `hymn` sections; 18 between a generated left-hand tone and the melody where the source has that pitch class against the melody, at another octave, in 027, 016, 002, 013, when-i-survey, what-child-is-this); in the harness samples 34 and 50 remain, 6 and 10 of them with an arranged note, which is the same exemption; (4) the legacy arm has 33 and 87 left-hand octave chords and 29 and 10 left-hand seconds, so G9 is now well under it on these counts.

**5. What the screenshots show** (puppeteer, 400 px wide, the review page; before = d5f715f packet, after = this commit; 8 hymns + czerny599/013, G9 arm). nearer-my-god: before, wide three-note chords in the bass staff on both beats (a top C4 with a tenth under it); after, the first bars are the hymn's own notes with the left hand thinned to a dyad or one note, then a three-quarter arpeggio per dotted-half beat (low, high, mid) with no second; the harmony of the hymn bars is the source's. christ-arose: before, bass-clef chords with a bass-to-top span of a ninth to a tenth (F2 B2 G3) and some with a # chord over an octave; after, the piece is the hymn (soprano and alto in the right hand, bass alone in the left, the tenor dropped wherever it stood an octave over the bass) with the source's own moving bass: thinner, three voices, each note a real note of the hymn; no second, no octave chord. all-creatures: before a quarter-note arpeggio with clashing chord tones (G3 under F#4); after the hymn's voices with a moving left hand and no clash beyond the source's. god-rest-ye-merry: close three-note triads in the bass staff with the top at or under C4, no 8va, no second, no chord wider than an octave. all-glory-laud: the hymn thinned, some phrase-end rests taken from the source. czerny599/013: almost unchanged (one harsh pair fewer). Nothing looks thinner than a three-voice hymn or a triad per beat; the stage-2 hymns christ-arose and all-glory-laud are the thinnest (two right-hand voices over a single-note bass), The notes the user's second complaint points at are the measured clashes (G3 under F#4, C3 under B3, B2 under C5), which are gone; no human has compared the before and after pictures.

**Tests** (all pass; `npm run test:realize` 90, `test:critics` 83, `test:repair` 32, `test:review` 84, `test:arrangement-planner` 17, `test:playability` 57, `test:songgraph` 45, `test:difficulty` 34): `tests/realize/clash-guard.test.js` (16: harsh-pair table; stage gates; `unclashStack` maj7 and idempotence; `guardTones` drop, replace, unresolved, floor, idempotence; `guardEvent` with and without a source clash, melody end, overlap-only source question, minor ninth; every root x quality at stages 2 and 3 (span <= 10, no second, no harsh pair, top, floor, always a triad) and stage 4 equal to the old rule; the profile cap; all-creatures 13 to 1 arranged pairs and the `unexcusedClashes` check; christ-arose source clash and right hand untouched; real pieces no octave chord or second at stage 2; hymn thinning: 27 notes dropped, bass and melody untouched, nothing added, the default off, stage gate, `candidates` on and `last.hymnThin:false` off (the verbatim candidate has 3 hard span violations); determinism; the 30 golden fingerprints with all three off), `tests/critics/vertical-clash.test.js` (10: planted harsh pair, clean negative control, counted-once, tie continuation, octave chord with held notes and an 11-semitone control, seconds with a third and a cross-hand control, arranged pairs, empty, evaluate and weight 0, real pieces). `tests/realize/last-defects.test.js` and `stride-geometry.test.js` call the old rules with the new switches off (`melodyClash: false`, `handGuard: false`).

**Known limits.** (1) The defaults change the app's g8 direct path: 21 of 30 direct realizations differ from d5f715f with `melodyClash` and `handGuard` ON (behind `PPP.arranger`, default `legacy`; `hymnThin` is OFF there, so an explicit `hymn` stays verbatim and has the octave chords); `opts.melodyClash: false, handGuard: false` restores them. (2) Stage 4 (the plan's stage: how-firm-a-foundation reaches it at level offset +1) is not gated for the span cap, seconds, stack clash and hymn thinning; how-firm-a-foundation keeps 6 left-hand octave chords. (3) The melody clash guard applies to `pop` and `waltz` events too (they are not shaped): on burgmuller25/006 it raised the stride left-hand jump rate from 0.096 to 0.104, so the stride-geometry test is run with the guard off; both patterns are off in the default candidate set. (4) The exemption is the letter of the brief: a pair is left where the source sounds both pitch classes together, at any octave; the user may hear a generated G3 against the melody F#5 as a clash although the source has a G in another voice. (5) `settleChord` is still not exactly idempotent when no placement is fully legal. (6) Thinned hymns are thinner: two right-hand voices over a one-note bass at stage 2; the repair step accepted 0 units on the 16-file sample after (6 before), because the selected candidates are mostly verbatim hymns, which have no smells to repair (not measured further). (7) The remaining right-hand seconds are in the source's own melody events; dropping one would change the melody. (8) No human has looked at the after packet; the user's second complaint (the harmony) is addressed by removing the measured clashes, not by any harmony metric: root+quality agreement moved -0.0076 and +0.0062. Not deployed.

**Review round 1 (independent review of 1f52056: one major, two minor; all three addressed).** The numbers in section 4 above are from this round's commit; every headline cell was re-run and is identical to the digit.

1. **Repair could undo the guard (major, fixed).** At profile small, christ-arose's repair (op `parallel`, 2 units accepted) moved D3 to D4 beside C4 and wrote a left-hand second (C4 D4 with F3) that was 0 before repair. `repair/index.js` `tryUnit` now rejects, on the applied unit and before the critics (exactly where `LEFT_HAND_JUMP` is), an edit that creates a one-hand simultaneous second (`SECOND_UP`) or a one-hand span of an octave or more (`OCTAVE_CHORD_UP`) that the graph did not have, at the stages where `handGuard` applies (`ctx.stage <= theory.NO_SECONDS_MAX_STAGE`; `repairSelection` always passes the stage), and a new harsh vertical pair (`HARSH_PAIR_UP`, every stage). `ctx.clashGuard: false` (`repairSelection` opts `clashGuard: false`) turns it off. `critics/vertical-clash.js` `newClashes(before, after)` does the counting. **The harsh-pair part is structurally vacuous for repair**: a repair only moves a head by whole octaves and a harsh pair is a pitch-class relation, so an octave move can neither create nor remove one (tested; it is a cheap safety net, not a filter that fires). Result on the case: christ-arose, profile small, `clashGuard: false`: 2 accepted, 1 left-hand second, guard on: 1 accepted, **2 rolled back (`SECOND_UP`), 0 seconds, 0 octave chords**; profile large: 0 accepted either way, unchanged. **The headline numbers on the default (large) path did not move**: the five metrics, harsh rate, repair counts (0 and 4 accepted) are identical before and after this change, in both samples. Tests: four in `tests/repair/repair.test.js` (planted second rolled back at stages 2 and 3 and not at stage 4 or with the switch off, with the forced edit shown to create the second; planted octave chord; pitch-class invariance of the harsh pair; the christ-arose small case, idempotent).
2. **Bass at a voice crossing: investigated, not reproduced, protection not adopted.** The reviewer saw one onset in all-creatures where a tenor under the bass lost the lowest sounding note. I could not reproduce a change of the lowest sounding pitch in any of 756 enumerated candidates (190 at profile large, 566 at small and medium; an equal-pitch doubling hides it). I tried protecting the lowest sounding left-hand note at every onset, for its whole tied chain, in `hymnThin`; it cost exactly what the user complained about (all-creatures kept 2 more left-hand octave-plus chords and 3 left-hand seconds; the 16-file totals went from 3 octave chords and 0 seconds to 5 and 3), so it was **not adopted**: `hymnThin` protects the melody voice and the bass VOICE only, as before. Stated as a limit: a tenor under the bass at a crossing can still be thinned.
3. **The direct (plain g8a) path pays for the two default-on switches (minor, documented).** `melodyClash` and `handGuard` are ON by default for a direct `realize()` call, so **the app's g8 path, behind the `PPP.arranger` switch (default `legacy`), changes with them**; both respond to the user's two complaints (clashing seconds and octave chords; harmony that sounds strange). The plain-path cost (`node realize/tools/harness.js --sample 16` and `--held-out 32` without `--g9a`, G8a row, 12 and 14 files with a plan, hard violations 12/12 and 14/14 and melody 1.0000 in every state; "off" = both switches off = d5f715f's defaults):

| G8a plain path | harmony root+quality / root-only | level within +-1 / mean distance | harsh pairs per onset | octave chords LH / RH | seconds LH / RH |
|---|---|---|---|---|---|
| 16-file, off | 0.9433 / 0.9597 | 8/12 / 0.7733 | 0.0570 | 28 / 0 | 30 / 1 |
| 16-file, `melodyClash` only | 0.9356 / 0.9568 | 8/12 / 0.7700 | 0.0144 | 27 / 0 | 20 / 1 |
| 16-file, `handGuard` only | 0.9255 / 0.9584 | 8/12 / 0.6900 | 0.0549 | 2 / 0 | 30 / 1 |
| 16-file, both (the default) | **0.9178 / 0.9555** | 8/12 / **0.6867** | 0.0133 | 2 / 0 | 20 / 1 |
| held-out, off | 0.9309 / 0.9671 | 14/14 / 0.5164 | 0.0461 | 48 / 1 | 17 / 15 |
| held-out, `melodyClash` only | 0.9290 / 0.9652 | 14/14 / 0.5164 | 0.0184 | 47 / 1 | 16 / 15 |
| held-out, `handGuard` only | 0.9200 / 0.9653 | 14/14 / 0.5100 | 0.0452 | 22 / 1 | 17 / 15 |
| held-out, both (the default) | **0.9201 / 0.9643** | 14/14 / **0.5100** | 0.0171 | 22 / 1 | 16 / 15 |

   So the plain path loses harmony (**-0.0255 on the 16-file sample, of which `melodyClash` -0.0077 and `handGuard` -0.0178; -0.0108 held-out, `melodyClash` -0.0019, `handGuard` -0.0109**) and gains level distance (0.7733 to 0.6867, 0.5164 to 0.5100). Inside G9 the selection absorbs the harmony cost; a direct call cannot. `opts.melodyClash: false` and `handGuard: false` restore the old path.
4. **What the G9 "harmony improvement" is, and is not.** The held-out root+quality rise (0.9712 to 0.9774) is partly the selection preferring a thinned near-source hymn copy over a generated block: **pass-me-not 0.938 to 1.000 and christ-arose 0.963 to 0.988** (a near-verbatim hymn reads as the hymn's own harmony), while the generated part of the output lost harmony (the plain-path table above; the 16-file sample fell 0.0076). The output for **christ-arose and all-glory-laud is now two right-hand voices over a single-note bass (bare at level 2.4)**, and **the harmony metric cannot see thinness**: it reads the chord from whatever notes sound, so a bare three-voice hymn can score 1.000. The guard is a reading of the user's complaint, not evidence that the result sounds fuller or better; no human has compared the two.


### G9 source-copied hand chords (post user review 4)

The user (a piano teacher, reviewing blind, so they do not know which arm is which) looked at the latest packet (`h8i`, 8 hymns) and said "it is still exactly the same", with three crops: (a) two noteheads stacked touching (a second), (b) a second with a beam, (c) two notes an octave or more apart played together by "one hand". They consider a one-hand simultaneous second and a one-hand simultaneous interval of an octave or more very hard for levels 2-4. Node-only: `git diff --stat origin/main` shows no `engrave/`, app or server file and no roadmap file. It touches `realize/` (`handchords.js` new, `index.js`, which the app loads only behind `PPP.arranger`, default `legacy`, and never loads `handchords.js`), `candidates/index.js` (one option passed), `critics/vertical-clash.js` (report only), `repair/index.js` (one more guard, only for candidates that went through the pass), `realize/tools/harness.js` and tests. No selection weight, level offset or hard-violation definition was touched (standing rule). One writer, no sub-agent. Branch `g9-source-hand-chords`, not merged, not deployed.

**1. Measured causes (before changing anything; the G9 arm = `candidates` + `repair`, all defaults, origin/main 57f56e3).**

*The first finding is about what "one hand" means.* The hands as written (the staff a note is drawn on, which is what the pianist's hand plays) hold, on the 8 hymns of `h8i`, **1 second and 0 octave-plus chords**. The brief's proxy (below MIDI 60 = left hand, at or above = right hand; the packet carries no hand labels) gives **6 seconds and 33 octave-plus chords** (LH 5 / RH 28), which is the brief's count. The difference is entirely a voice of one written hand sounding beside, or an octave under, a voice of the other hand around middle C: 29 notes of christ-arose alone sit on the other side of C4 from their staff. The reviewer reads the page, not a hand label: a left-hand tenor C#4 (bass staff, one ledger line above it) under a right-hand alto D#4 (treble staff, just under it) is two noteheads touching, and a left-hand C4 with a right-hand A4 and C5 reads as one C4-C5 chord. I first treated BOTH groupings as "one hand" (`handChordsModel` `both`, the first version's default); **the independent review changed the default to `limbSeconds` (see "Review round 1" at the end of this section): the hands as written plus seconds between the two hands' notes, the pitch grouping's octave-plus rule being opt-in.** The first-version numbers in sections 2 to 4 below are the opt-in `both` row; `limb` alone is measured below and changes almost nothing. (The earlier rounds counted the written hands, which is why their counts reached 0 while the complaint stayed.)

Where the violating chords of the 8 hymns come from (39 chords: 33 octave-plus, 6 seconds; chords by the two notes that make the violation: source role of the lower and the higher note, `M` the melody voice, `B` the bass voice = the lowest-averaging left-hand voice of the plan section, `I` another source voice, `G` a generated tone; `l`/`r` the written hand):

| count | defect | lower note | higher note | pattern | source has both |
|---|---|---|---|---|---|
| 19 | octave-plus | `I` left (tenor, C4 or above) | `M` right (melody) | `hymn` | yes |
| 8 | octave-plus | `B` left (bass) | `I` right (an inner voice below C4) 5, `M` right 3 | `hymn` | yes |
| 5 | octave-plus | `G` left (the top tone of a generated stack, C4 or E4) | `M` right | `block` | no |
| 1 | octave-plus | `I` left | `M` right | `block` | yes |
| 5 | second | `I` left (tenor, C#4) | `I` right (alto, D#4) | `hymn` | yes |
| 1 | second | `M` right | `M` right (a harmony note inside the melody voice's own event; the only one by the hands as written) | `hymn` | yes |

So, which voice pair: **the left-hand tenor beside the right hand (25 of 39)**, **the bass against a right-hand inner voice or melody (8)**, all copied verbatim in `hymn` sections, where the source has both notes (a hymn is written for four singers); 6 are a generated left-hand stack at the top of its range under a high melody; 1 is the melody with a harmony note in its own voice. Repair adds none (pre- and post-repair counts are identical on all 8). The samples have the same causes (G9 arm with the pass off; pitch grouping unless said): 16-file sample (12 files with a plan): hands as written 1 second and 3 octave chords (gymnopedie-1: melody and bass in one hand); pitch grouping 8 seconds and 151 octave-plus chords, of which `hymn` copies 90, `block` 58, `ballad` 3, by role: bass under the melody 51, tenor under the melody 50, generated tone under the melody 43, bass with an inner voice 4, bass with bass 3. Held-out (14 files): hands as written 15 seconds (13 of them a melody-voice event with a second head, 8 in `broken` and 7 in `hymn`) and 8 octave chords (all `hymn`; `how-firm-a-foundation` and `sonatina/004`); pitch grouping 30 seconds and 241 octave-plus chords, of which `hymn` 198, `broken` 37, `block` 6, by role: bass under the melody 99, tenor under the melody 91, generated tone under the melody 42. The big sample counts come mostly from two-part method pieces (`czerny599/013` 58, `burgmuller25/006` 54, `czerny849/023` 68 chords): a left hand that plays above middle C under a right-hand melody, which no removal can cure and which is two hands each playing one note.

**2. What changed.**
- `realize/handchords.js` (new, pure): `thin(notes, opts)` over a note list {id, hand, on, off, midi, cont (tie continuation), chain (tie chain), keep, low}. For every group (per hand, per the pitch grouping, or both) at every onset (held notes included, at least one attacking) a violation is a second (adjacent notes 1 or 2 semitones apart; a unison is not one) or a span of an octave or more (constants `SECOND_MAX_SEMITONES` 2, `OCTAVE_SEMITONES` 12, `HAND_PITCH_SPLIT` 60, `HAND_CHORDS_MAX_STAGE` 3). Removal, least important first: only a note **involved** in the violation (a member of the second, or the lowest or highest note of the span); a note that is neither protected nor in a melody-voice event (an inner voice, a generated tone) before a melody-event head that is not the top head (so an octave double of the melody goes, and the melody note never does); then one whose removal clears the whole violation, then a doubled pitch class, then the one farthest from a protected note, then the higher pitch. **Protected, never removed:** the top head of every melody-voice event and the bass (for a verbatim copy the lowest-averaging left-hand voice, as `hymnThinDrops` takes it; for generated left-hand events the lowest note of each harmony window). A violation whose involved notes are all protected is left and counted as **unfixable**. A removed note goes with its whole tie chain (nothing is shortened or moved; an event left with no head becomes a rest of its own length, as a hymn-thinned note does; pitch classes, onsets and durations of the rest are unchanged). Removing a note never makes a second or widens a span, so one ascending pass suffices; deterministic and idempotent (tested).
- `realize/index.js`: `opts.handChords` (**default off for a direct `realize()` call, on from `candidates/`**, like `hymnThin`; `opts.last.handChords: false` or harness `--no-hand-chords` turns it off there), `opts.handChordsModel`; runs as the last step before the graph is sealed and fingered, at plan stages 1-3 only (**stage 4 untouched, every existing gate kept**); `report.handChords` = {active, model, notes, removedNotes, removedChains, eventsToRests, before/after by group, violationsBefore/After, unfixable (seconds, octave, limb, pitch)} (present only when the option is given). `copyVoiceVerbatim` takes one extra optional argument (tag sets); nothing else in the realizer changed. **With the option off, 30 realizations (6 pieces x `auto`, `block`, `broken`, `ballad`, `hymn`) are byte for byte origin/main's, both with the direct defaults and with the options `candidates/` passed before** (`tests/fixtures/hand-chords-golden.json`, made from an untouched copy of origin/main).
- `repair/index.js`: a candidate that went through the pass carries `report.handChords.active`; `repairSelection` then sets `ctx.handChordsGuard`, and `tryUnit` refuses (`HAND_CHORD_UP`) any edit that writes a violating chord the graph did not have, in either grouping, **by identity** (an edit that clears one chord and writes another is refused; the old `SECOND_UP`/`OCTAVE_CHORD_UP` guards count net change and stay, at the plan's stage). Needed: on god-rest-ye-merry repair accepted 2 units that wrote 2 new pitch-grouping octave chords (0 before repair); with the guard they are rolled back (`opts.handChordsGuard: false` restores the old behaviour).
- `critics/vertical-clash.js` (report only, weight 0 as before): `violations[LH|RH]` (chords with a second or an octave-plus span, once each), the same counts for the pitch grouping (`pitchSeconds[Low|High]`, `pitchOctaveChords[Low|High]`, `pitchViolations`), `notesPerOnsetLH/RH`, `violationKeys`, `newViolations`. Harness rows and summary carry all of them for every engine, plus the pass's own `handChords` sums (removed notes, unfixable).

**3. Numbers, before and after** (`node realize/tools/harness.js --sample 16 --g9a --repair --timeout-s 120` and `--held-out 32 --g9a --repair --timeout-s 180`, outputs outside the repo; 12 of 16 and 14 of 32 files have a reachable plan; "before" = `--no-hand-chords`, **equal on every metric to a run of an untouched copy of origin/main 57f56e3**; ScoreArranger from the same run). G9 after repair:

| | 16-file before | 16-file after | held-out before | held-out after | ScoreArranger 16 / held-out |
|---|---|---|---|---|---|
| hard violations (files at 0) | 12/12 | 12/12 | 14/14 | 14/14 | 10/12 / 9/14 |
| level within +-1 / mean distance | 10/12 / 0.3325 | 10/12 / **0.3250** | 13/14 / 0.4271 | **14/14** / 0.4236 | 10/12 / 0.3042; 14/14 / 0.4507 |
| melody | 1.0000 | **0.9988** | 1.0000 | **0.9975** | 0.9845 / 0.9744 |
| harmony root+quality | 0.9648 | **0.9558** | 0.9774 | **0.9493** | 0.9467 / 0.9661 |
| harmony root-only | 0.9735 | **0.9645** | 0.9831 | **0.9613** | 0.9565 / 0.9692 |
| engrave silent / hard layout (files at 0) | 12/12, 12/12 | 12/12, 12/12 | 14/14, 14/14 | 14/14, 14/14 | 12/12; 14/14 |
| harsh pairs per onset | 0.0208 | 0.0184 | 0.0266 | 0.0243 | 0.0250; 0.0331 |
| one-hand octave chords LH / RH (hands as written) | 3 / 0 | 3 / 0 | 7 / 1 | 7 / 1 | 33 / 6; 87 / 3 |
| one-hand seconds LH / RH (hands as written) | 0 / 1 | 0 / **0** | 0 / 15 | 0 / **11** | 29 / 4; 10 / 11 |
| chords with a second or an octave-plus, LH / RH (hands as written) | 3 / 1 | 3 / 0 | 7 / 16 | 7 / 12 | 62 / 10; 97 / 14 |
| pitch grouping: seconds low / high | 0 / 8 | 0 / 6 | 0 / 30 | 0 / 22 | 7 / 51; 8 / 37 |
| pitch grouping: octave-plus low / high | 11 / 140 | 7 / 147 | 15 / 226 | 14 / 174 | 26 / 418; 45 / 265 |
| notes per onset LH / RH | 1.278 / 1.114 | 1.156 / 1.130 | 1.227 / 1.252 | 1.186 / 1.222 | 1.306 / 1.086; 1.273 / 1.245 |
| notes written (both hands) | 2748 | 2591 | 3718 | 3754 | 2823; 3417 |
| LH jump rate / low-register cluster rate | 3.01% / 0 | 3.21% / 0 | 5.27% / 0 | 4.56% / 0 | 4.97% / 0; 8.07% / 0.97% |
| selected pattern histogram | hymn 9, auto 2, ballad 1 | hymn 10, auto 1, ballad 1 | hymn 9, auto 5 | hymn 8, block 1, auto 5 | |
| repair units accepted | 0 | 0 | 4 | 2 | |
| **pass: notes removed / unfixable chords left (limb, pitch)** | | **12 of 2603 / 163 (3, 160)** | | **63 of 2986 / 169 (1, 168)** | |

**The five acceptance metrics, exactly:** hard violations, engraving: no change (12/12 and 14/14; 12/12 and 14/14). **Regressions:** melody 1.0000 to 0.9988 (16-file) and 0.9975 (held-out) (the top note of every melody-voice event is kept; what goes is a second head of a melody-voice event: the G4 under the melody A4 in all-creatures bar 10, 1.000 to 0.985, and czerny599/032 in held-out, 1.000 to 0.966; the metric counts every head of a melody-voice event); harmony root+quality **-0.0090** (16-file) and **-0.0281** (held-out), root-only -0.0090 and -0.0218. The held-out harmony drop is 5 files: czerny599/027 0.938 to 0.750 (32 generated left-hand notes removed from a `pitch`-grouping octave chord under a high melody: the largest single cost, a method piece, not a hymn), god-rest-ye-merry 0.950 to 0.900, pass-me-not 1.000 to 0.938, czerny599/032 1.000 to 0.938, nearer-my-god 1.000 to 0.969. Improvements: level within +-1 13/14 to 14/14 and mean distance 0.4271 to 0.4236 (16-file 0.3325 to 0.3250), harsh pairs 34 to 30 and 50 to 49. Against ScoreArranger the table is as before: hard, melody, engrave win on both samples, harmony wins on 16-file (0.9558 against 0.9467) and **loses on held-out (0.9493 against 0.9661)**, level distance loses on the 16-file sample (0.3250 against 0.3042) and wins held-out. Nothing was tuned around any of it.

The 8 hymns of `h8i`, G9 + repair at the review's requests (before: origin/main; chords counted both ways):

| hymn | selected pattern before to after | limb sec / oct | pitch sec / oct, before | pitch sec / oct, after | notes removed | harmony root+quality |
|---|---|---|---|---|---|---|
| all-glory-laud | hymn (same) | 0 / 0 | 0 / 5 | 0 / 0 | 4 of 207 | 0.958 to 0.958 |
| god-rest-ye-merry | auto small to **block large** | 0 / 0 | 0 / 6 | 0 / 0 | 6 of 298 | 0.950 to 0.900 |
| the-strife-is-oer | block (same) | 0 / 0 | 0 / 0 | 0 / 0 | 0 | 0.944 |
| when-i-survey | auto small (same) | 0 / 0 | 0 / 0 | 0 / 0 | 0 | 0.938 |
| pass-me-not | **hymn to auto** | 0 / 0 | 4 / 1 | 0 / 0 | 4 of 264 (candidate) | 1.000 to 0.938 |
| christ-arose | hymn (same) | 0 / 0 | 0 / 16 | 0 / **3** | 16 of 274 | 0.988 to 0.988 |
| all-creatures | hymn (same) | 1 sec to 0 | 2 / 4 | 0 / 0 | 5 of 239 | 0.824 to 0.794 |
| nearer-my-god | auto (same) | 0 / 0 | 0 / 1 | 0 / 0 | 1 of 168 | 1.000 to 0.969 |
| **total** | | 1 / 0 to 0 / 0 | **6 / 33** | **0 / 3** | 36 of 1937 in all; 26 of 1474 (1.8%) on the six unchanged selections | mean 0.9502 to 0.9285 |

Mean over the 8: melody 1.0000 to 0.9981, level distance 0.506 to 0.496, hard 0 to 0, notes per onset LH 1.494 to 1.370 and RH 1.554 to 1.459. **The 3 left are unfixable by rule**: christ-arose bar 17 (three onsets): the source's bass voice and tenor both sound C4 at the bottom of a high passage, with a right-hand inner G4 and the melody E5 held over it; the two ends of the span, C4 (bass) and E5 (melody), are both protected. **Removal can also make the selection flip**: pass-me-not's verbatim hymn candidate lost 5 notes and with them harmony 1.000 to 0.938 (badness 0.360 to 0.423), so `auto` (0.396) now wins, and what the reviewer sees is a sixteenth-note left-hand arpeggio where there used to be four voices (level distance 1.08 to 1.00); god-rest-ye-merry likewise moves from `auto` at profile small to `block` at large (close triads on every beat). That is selection following its unchanged weights, not a rule of the pass.

`handChordsModel: 'limb'` (the hands as written only, for comparison, same code): removes 1 note (16-file) and 4 (held-out), harmony 0.9648 and 0.9729 (held-out -0.0045 against -0.0281 for `both`), melody 0.9988 and 0.9975, pitch-grouping chords 158 and 266 (against 159 and 270 before): it does what the earlier rounds did and does not change what the reviewer counts.

**4. What the screenshots show** (puppeteer, 400 px wide, device scale 2, the G9 side of all 8 hymns of a packet built from this commit, every system looked at; before = the packet of 57f56e3). christ-arose: RH thirds and sixths (soprano and alto), LH mostly single bass notes with an occasional fifth (F3 + C4, D3 + A3); no note stacked against another across the staves; bars 17-18 show the 3 unfixable onsets (C4 in the bass staff under a dotted-half G4 + E5). all-glory-laud: two voices per hand (RH thirds, LH fifths and sixths), no stacked seconds. nearer-my-god: clean three-quarter arpeggio bars and two-voice bars. all-creatures: the hymn's own four voices with thinner chords at the tenor; the former melody second (G4 + A4, bar 10) is a single note. god-rest-ye-merry: a close triad in the bass staff on every beat (no second, top at or under E4), RH melody single line. pass-me-not (now `auto`): sixteenth-note broken-chord figure in the left hand with the melody above, one system with a half-note dyad pair. the-strife-is-oer and when-i-survey: unchanged. I did not find a stacked second, a second with a beam, or a one-hand octave-plus chord in any system (except the 3 of christ-arose named above); the numbers above say the same and are the authority, as the crops the user sent were not available to me.

**Is the result musically acceptable, not only legal?** Mostly, with three flags. (1) On the hymns the pass removes 1.8% of the notes on the six selections that did not flip (16 of 274, 5.8%, in christ-arose, the worst); it is a hymn with two voices in the right hand and a bass, plus a tenor where it does not stack: not bare, but **christ-arose's left hand is now mostly single bass notes**, which is thin for a hymn (it is also what the source's own bass voice plus the gate allows). (2) Two selections flipped to other patterns (pass-me-not to a sixteenth arpeggio, god-rest-ye-merry to a triad on every beat); neither is a rule of the pass, both are more mechanical than the verbatim hymn they replaced, and whether they are better or worse for a student is not something any metric here can say. (3) The harmony metric fell by 0.009 and 0.028; it cannot tell bare from full (see the previous round), and a hymn reduced by a tenor note reads as a different chord to it. **No human has looked at the after packet.**

**Tests** (all pass; `npm run test:realize` 108, `test:critics` 89, `test:repair` 34, `test:review` 84, `test:arrangement-planner` 17, `test:playability` 57, `test:songgraph` 45, `test:difficulty` 34): `tests/realize/hand-chords.test.js` (18: second and octave-plus removal; an exact octave is a violation, 11 is not, a unison is not a second; melody and bass never removed; the melody's own double goes, and an inner voice before a melody-event harmony note; unfixable counted and nothing removed for it; a removed tie chain goes whole and nothing is shortened; only attacking chords count; the three models (a left-hand tenor C#4 under a right-hand alto D#4: none for `limb`, one removal for `pitch` and `both`); deterministic and idempotent; input untouched; on real pieces: options off equal to the 30 origin/main fingerprints for the direct defaults, `handChords: false` and the old candidate options; a direct call has no report, candidates turn it on and `opts.last` off; christ-arose: only notes removed, every kept note a note the graph had with the same pitch, onset, end, hand and tie role, the melody top and the bass at every onset kept, `violationsBefore/After` equal to the critic's counts, deterministic; generated `block` and `auto` realizations; stage 4 equal to off; the three models; melody preservation 1 on christ-arose), `tests/critics/vertical-clash.test.js` (+6: planted pitch-grouping second and octave chords, a negative control, a chord with both counted once, notes per onset per hand, `newViolations` refuses the swap that `newClashes` counts as 0), `tests/repair/repair.test.js` (+2: the god-rest-ye-merry case with and without the guard, no `HAND_CHORD_UP` for a candidate made with the pass off; the older `SECOND_UP` test now runs on a candidate made with `last: { handChords: false }`), `tests/realize/clash-guard.test.js` (one line: the test of `hymnThin: false` also switches `handChords` off, since the new pass thins the same copy).

**Known limits.** (1) "One hand" is taken as the written hands or the pitch grouping around middle C; the second is a reading of the user's counts (they reproduce the brief's 6 and 33 exactly) and not a fact about hands: it removes notes that two different hands play, and it cost czerny599/027 32 notes (harmony 0.938 to 0.750). `handChordsModel: 'limb'` is the conservative switch. (2) Unfixable chords are counted and left: 163 (3 by hands as written) on the 16-file sample and 169 (1) held-out, almost all two-part method pieces whose left hand plays above middle C; the 8 hymns have 3. (3) Stage 4 is untouched (the plan's hardest stage, for example how-firm-a-foundation, burgmuller25/016): 18 of the 19 held-out chords by hands as written are there. (4) Protection is by voice, not by sounding pitch: a tenor under the bass at a voice crossing can still go (the previous round's finding, not changed). (5) The pass removes a second head of a melody-voice event when it is the violation, so the melody metric can fall below 1 although every melody top note is kept. (6) The selection can flip to another pattern when the pass lowers a candidate's harmony; not tuned. (7) The pass runs before selection, so every candidate is cleaned, but nothing re-runs it after repair: the repair guard above is what keeps the final graph clean (0 new chords on the 8 hymns; repair accepted 0 and 2 units on the two samples, and the guard refuses by identity). (8) The critic's `violations` counts a chord once when a held note keeps it alive at several onsets, as the earlier counts did. (9) Not deployed, not merged, no human has compared before and after.


**Review round 1 (independent review of 23d5b70: one major, addressed; the default model changed).** The reviewer found everything else sound (no protected note removed, no note moved or shortened, ties intact, stage 4 untouched, 6000 fuzzed chords clean, options-off byte-identical on 1064 realizations, repair adds no violating chord, numbers reproduce) and one major: the default model `both` removed 75 notes over the 33 pieces (samples plus hymns), 69 of them by the pitch grouping's octave-plus rule on cross-staff chords, cost czerny599/027 32 notes (harmony 0.938 to 0.750) and flipped pass-me-not and god-rest-ye-merry to mechanical patterns, while the hands as written already had 0 octave-plus chords on the 8 hymns. **The default is now `limbSeconds`:** the hands as written (seconds and octave-plus spans, as before) plus a `cross` grouping, all notes of both hands together, **seconds only**. That grouping also fixes the boundary: a B3 under a C4 is a second although 59 and 60 are on different sides of the split at 60 (the pitch grouping could not see it; `crossSeconds` in the critic and the `cross` kind of `violationKeys` and `newViolations` count it, and the repair guard watches the groupings the pass searched: `ctx.handChordsKinds`). The pitch grouping's octave-plus rule is the opt-in: `handChordsModel: 'pitch'` (pitch grouping alone) or `'both'` (limb + pitch, the first version's default: its numbers are reproduced exactly by `--hand-chords-model both`). Models: `limb`, `limbSeconds` (default), `pitch`, `both`; harness flag `--hand-chords-model`.

Measured (same commands as above; "before" = `--no-hand-chords` = origin/main 57f56e3 on every metric; G9 + repair):

| | 16-file before | 16-file default | 16-file opt-in `both` | held-out before | held-out default | held-out opt-in `both` |
|---|---|---|---|---|---|---|
| hard violations (files at 0) | 12/12 | 12/12 | 12/12 | 14/14 | 14/14 | 14/14 |
| level within +-1 / mean distance | 10/12 / 0.3325 | 10/12 / 0.3325 | 10/12 / 0.3250 | 13/14 / 0.4271 | 13/14 / 0.4271 | 14/14 / 0.4236 |
| melody | 1.0000 | 0.9988 | 0.9988 | 1.0000 | 0.9975 | 0.9975 |
| harmony root+quality / root-only | 0.9648 / 0.9735 | **0.9648 / 0.9735** | 0.9558 / 0.9645 | 0.9774 / 0.9831 | **0.9729 / 0.9831** | 0.9493 / 0.9613 |
| engrave silent / hard layout (files at 0) | 12/12, 12/12 | 12/12, 12/12 | 12/12, 12/12 | 14/14, 14/14 | 14/14, 14/14 | 14/14, 14/14 |
| harsh pairs per onset | 0.0208 | 0.0202 | 0.0184 | 0.0266 | 0.0266 | 0.0243 |
| **hands as written**: seconds LH / RH | 0 / 1 | 0 / 0 | 0 / 0 | 0 / 15 | 0 / 11 | 0 / 11 |
| hands as written: octave-plus LH / RH | 3 / 0 | 3 / 0 | 3 / 0 | 7 / 1 | 7 / 1 | 7 / 1 |
| cross-hand seconds (all notes of both hands) | 8 | 6 | 6 | 38 | 30 | 30 |
| **pitch 60**: seconds low / high | 0 / 8 | 0 / 6 | 0 / 6 | 0 / 30 | 0 / 22 | 0 / 22 |
| pitch 60: octave-plus low / high | 11 / 140 | 11 / 140 | 7 / 147 | 15 / 226 | 15 / 226 | 14 / 174 |
| notes per onset LH / RH | 1.278 / 1.114 | 1.278 / 1.112 | 1.156 / 1.130 | 1.227 / 1.252 | 1.227 / 1.247 | 1.186 / 1.222 |
| notes written | 2748 | 2746 | 2591 | 3718 | 3710 | 3754 |
| selected patterns | hymn 9, auto 2, ballad 1 | same | hymn 10, auto 1, ballad 1 | hymn 9, auto 5 | same | hymn 8, block 1, auto 5 |
| repair units accepted | 0 | 0 | 0 | 4 | 4 | 2 |
| **pass: notes removed / chords left (limb, cross)** | | 2 of 2748 / 9 (3, 6) | 12 / 163 | | 8 of 2887 / 2 (1, 1) | 63 / 169 |

The default removes 2 notes (16-file: all-creatures' melody harmony head) and 8 (held-out: pass-me-not 4 cross-hand seconds, czerny599/032 4), against 12 and 63 for `both`. **Regressions against origin/main, exactly:** melody 1.0000 to 0.9988 and 0.9975 (melody-voice event harmony heads); harmony root+quality 0.9774 to 0.9729 held-out (czerny599/032 1.000 to 0.938), none on the 16-file sample; hard, level, engraving unchanged. Against the first version: harmony +0.0090 and +0.0236; level distance 0.3250 to 0.3325 and 0.4236 to 0.4271 (the extra level gain of `both` came from selection moving on the thinned candidates, not from anything the default does).

The 8 hymns of `h8i`, default: **no pattern flips** (all 8 selections equal origin/main's: all-glory-laud hymn, god-rest-ye-merry auto small, strife block, when-i-survey auto small, pass-me-not hymn, christ-arose hymn, all-creatures hymn, nearer-my-god auto), 6 of 1937 notes removed (pass-me-not 4, all-creatures 2), mean harmony 0.9502 to 0.9502, melody 1.0000 to 0.9981 (all-creatures 0.985), level distance 0.506 to 0.506, hard 0. Counts, before then after: hands as written: seconds 1 to 0, octave-plus 0 to 0; cross-hand seconds 6 to 0; pitch-60 seconds 6 to 0; **pitch-60 octave-plus 33 to 33 (LH 5, RH 28), deliberately not touched**. So by the brief's proxy, count (c), two notes an octave or more apart, is unchanged; it is cross-staff (a left-hand tenor or bass with a right-hand note a tenth or more above), the written hands have none, and whether the user's crop showed that or something else (the legacy arm has LH 61 / RH 43 octave-plus chords by the same proxy on these items) is unknown. `handChordsModel: 'both'` or `'pitch'` removes them (33 to 3, at the costs above).

**Looked at again** (400 px, device scale 2, the G9 side of all 8 hymns from a packet built at this state; every system of seven hymns viewed, the-strife-is-oer's first systems only, it is unchanged): christ-arose: right-hand thirds and sixths over a left hand that keeps its tenor (fifths F3+C4, sixths D3+B3 on the bass staff), no second touching another across the staves; the left-hand C4 sits under the right hand's A4/C5 in a few bars (the cross-staff octave, left in). pass-me-not: back to the four-voice hymn (dyads in both hands, left-hand tops at Db4 under a Bb4 melody), no sixteenth-note arpeggio. all-creatures: the hymn's own voices, the melody's G4 harmony note gone in bar 10. god-rest-ye-merry: a close triad in the bass staff on every beat (as before this round), single-line melody; tops at C4/E4 under a melody at E5 (the cross-staff octave, left in). nearer-my-god, all-glory-laud, when-i-survey, the-strife-is-oer: as before this round. I saw no stacked second and no second with a beam in any system; the cross-staff octave-plus chords named above are there.

**What the reviewer noticed, kept here:** a pass that "fixes" the pitch-60 octave count barely moves the corpus-wide count: the 16-file pitch-60 octave-plus count went from 151 to 154 under `both`, because czerny599/013 flipped from `auto` to `hymn` (a verbatim copy with many such chords, 58 to 73) while the pass removed 12 notes elsewhere. The pitch-60 view is therefore not a good metric on its own; it is reported beside the written-hands view and the cross-hand seconds, not instead of them. The same flip is why `both` cost level and harmony in the samples: selection follows its unchanged weights after a candidate is thinned.

**Limits after the review.** (1) The default leaves cross-staff octave-plus chords alone: 33 on the 8 hymns by the brief's proxy, 151 and 241 on the samples (mostly two-part method pieces). (2) Chords left by the default: 9 on the 16-file sample (3 by hands as written: gymnopedie-1 melody and bass in one hand; 6 cross-hand seconds between protected notes) and 2 held-out (sonatina/004); stage-4 candidates are not touched, so the final graphs still hold 6 and 30 cross-hand seconds, written-hand seconds 0 / 0 and 0 / 11 and written-hand octave chords 3 / 0 and 7 / 1 (16-file and held-out). (3) Everything else in the limits above holds; `both` is still available for a user who decides the cross-staff octaves matter more than the cost.

**Tests after the review** (all pass; `npm run test:realize` 112, `test:critics` 90, `test:repair` 35, `test:review` 84, `test:arrangement-planner` 17, `test:playability` 57, `test:songgraph` 45, `test:difficulty` 34): `tests/realize/hand-chords.test.js` now checks the four models (a tenor C#4 under an alto D#4: none for `limb`, removed by the default, `pitch` and `both`; B3 under C4: removed by the default, invisible to `pitch`; a C4 / A4 / C5 chord across the hands: only `pitch` and `both` remove it; a limb octave-plus chord is in the default; no attack means no chord), pass-me-not under the default (the 4 cross-hand seconds go, 4 notes, melody 1.000, only removal, counts equal the critic's), christ-arose under `both` (the first version's checks, kept) and under the default (none removed); `tests/critics/vertical-clash.test.js` adds `crossSeconds` across the split at 60 and the `cross` kind; `tests/repair/repair.test.js` runs the with/without-guard case under `both` and checks the default's guard (no new limb or cross chord) on three hymns.


### G9 single-note hands (post user review 5: the teacher's criterion)

**The criterion.** After round 4 the teacher (a piano teacher, reviewing blind) kept saying the packets were "exactly the same". I matched their screenshots to the drawn pages of that packet and found their crops came from the **legacy arm** (ScoreArranger): the drawn-SVG check below finds 124 stem-joined wide intervals in the legacy arm of the `h9k` packet and 0 in G9. They then sent one more crop, of the new page, showing ordinary two-note chords in both hands (thirds with the noteheads touching vertically, a sixth, a diminished fifth), and in a direct question picked "the noteheads look touching vertically", "one hand playing two notes at once" and "still octave-plus / touching seconds visible". Conclusion, taken as the authority on their students: **for the levels we generate (targetLevel 2.1 to 3.9 on the G6 scale) one hand plays one note at a time: a single-note melody in the right hand and a single-note bass (or single-note broken-chord line) in the left; no dyads or triads in either hand.** Node-only; `git diff --stat origin/main` shows no `engrave/`, app, server or roadmap file. One writer, no sub-agent.

**What changed.**
- `realize/handchords.js`: `thin(notes, { maxNotes: N })` (integer >= 1; undefined/null = off, the old behaviour byte for byte). Before the old rules run, every written hand ('RH' / 'LH' = the staff a note is drawn on) keeps at most N of the notes it sounds at every onset (held notes counted). Removed first: a melody event's extra head (`low`), then in the right hand the lower note, in the left the higher note, then the id; so with no protected note present the right hand keeps its top note and the left its lowest. Never a protected note: the top head of a melody-voice event, and the bass. A hand holding more protected notes than N (melody and bass both in the left hand) is left and counted (`stats.maxNotes.unfixable`). A removed note goes with its whole tie chain (nothing shortened or moved; an event left empty is a rest of its own length, as before). Deterministic, idempotent (tested). The old rules (seconds, octave-plus, the model) then run on what is left, which at N = 1 only leaves the cross-hand seconds. Stats: `stats.maxNotes` = {n, before/after per hand: onsets, multi (two or more notes), over (more than N), max, perOnset, removedNotes, unfixable}.
- `realize/index.js`: `opts.handMaxNotes` (default off; needs `opts.handChords`, runs at the same stages 1-3, `report.handChords.handMaxNotes`). With it, the bass of a bass-voice event is its **lowest head** (a bass voice that holds a chord in one event protects only its lowest note; without the option every head of the bass voice is protected as before, so the old paths are unchanged). `opts.handMaxNotesMaxStage` (default 3; 1..4) is a measurement switch that lets the pass run at stage 4 too; nothing turns it on. **Direct `realize()` defaults are byte-identical to origin/main** (`tests/fixtures/hand-chords-golden.json`, checked again in the new tests).
- `candidates/index.js`: one switch, `singleNoteHands` (default false = origin/main behaviour exactly; true = `handMaxNotes: 1` and `handMaxNotesMaxStage: 4`). **Review correction:** the first commit also passed `handMaxNotes: 1` at stages 1-3 by default; that changed the selection on 12 of 28 items, sent 2 of the 8 hymns to stage 4 and still left 98 / 152 multi-note chords held-out, so it paid most of the cost without delivering the criterion. It is removed; the stage-3-gated variant is reachable only as `opts.last.handMaxNotes: 1` (a measured counterfactual below).
- `critics/vertical-clash.js` (report only): `handChordsLH/RH` (onsets where a hand sounds two or more notes), `handMaxLH/RH`; `violationKeys` / `newViolations` take `{ maxNotes }` and report a `multi` kind (the key carries the note count, so a chord made bigger is a new one); without the option the output is exactly as before.
- `repair/index.js`: `repairSelection` carries `handMaxNotes` into the context and `tryUnit` refuses `HAND_NOTES_UP` when an edit creates a hand with more notes than before. It cannot fire in practice: repair only moves a note by whole octaves or drops a doubling, never adds a note or changes a hand (0 accepted units on the 8 hymns, with and without the guard); it is a guard for a future operation, tested for wiring and for no new multi-note chord on three hymns.
- `realize/tools/harness.js`: `--single-note-hands` (candidates `singleNoteHands`), `--hand-max-notes <n|off>` and `--hand-max-notes-max-stage 4` (measurement switches through `opts.last`); rows carry the new counts and `melodyTopLine`.
- `critics/metrics.js`, `critics/index.js`, harness rows: **`melodyTopLine`** (report only): the share of the original melody's onsets whose TOP head is still sounded (same pitch, onset within 0.15 quarter). The existing `melody` number counts every head of a melody voice written in chords.
- No selection weight, level offset or hard-violation definition was touched.

**How each pattern behaves at N = 1** (tested on god-rest-ye-merry). `block`: the right hand is the melody alone; the left hand loses every chord note but the lowest, so it becomes one bass note per beat window (repeated, the chord's lowest note, which is the root only when the chord is in root position). `broken`, `ballad`: already one note at a time in time, unchanged (the output is byte-identical with and without the option). `hymn` copies: right hand = the melody voice (its top head), left hand = the bass voice only (its lowest head); the alto and tenor voices go and leave rests in their own voices (45 and 51 notes on god-rest-ye-merry and christ-arose). `auto`: per section whatever it resolved to, by the same rules. (`pop`, `waltz` are not enumerated by candidates; a stab after a bass note would keep its lowest note.) Notes removed from a stage-3 or lower candidate are the inner voices, so the selection (unchanged weights) now sees them as worse on harmony and melody and often prefers a stage-4 candidate, which the pass does not touch: see the numbers.

**Numbers** (G9 + repair; `node realize/tools/harness.js --sample 16 --g9a --repair --timeout-s 120` and `--held-out 32 --g9a --repair --timeout-s 180`, outputs outside the repo; 12 of 16 and 14 of 32 files have a reachable plan; **"off" = the default now (`singleNoteHands` false), equal on the five metrics to origin/main da1a73b** (re-measured after the review fix: level distance 0.3325 / 0.4271, harmony root+quality 0.9648 / 0.9729, melody 0.9988 / 0.9975, hard and engraving unchanged); **"`singleNoteHands`" = `--single-note-hands`, no two-note chord at any stage** (re-measured, equal to the stage-4 columns first reported); **"stage-3 gated" = `--hand-max-notes 1`, the first commit's default, kept only as a counterfactual**: it flips 2 of the 8 hymns to stage-4 candidates and leaves dyads). ScoreArranger from the same runs.

| | 16-file off (= origin/main) | stage-3 gated (counterfactual) | `singleNoteHands` | held-out off | stage-3 gated (counterfactual) | `singleNoteHands` | ScoreArranger 16 / held-out |
|---|---|---|---|---|---|---|---|
| hard violations (files at 0) | 12/12 | 12/12 | 12/12 | 14/14 | 14/14 | 14/14 | 10/12 / 9/14 |
| level within +-1 / mean distance | 10/12 / 0.3325 | 10/12 / 0.4375 | 10/12 / 0.4433 | 13/14 / 0.4271 | 14/14 / 0.4750 | 13/14 / 0.5336 | 10/12 / 0.3042; 14/14 / 0.4507 |
| mean (measured level minus requested) | -0.284 | -0.438 | -0.443 | -0.427 | -0.475 | -0.534 | |
| melody (every head of a melody voice; **not meaningful alone in this mode**) | 0.9988 | 0.9446 | 0.9272 | 0.9975 | 0.9557 | 0.8988 | 0.9845 / 0.9744 |
| **melodyTopLine** (the tune's top head at each onset) | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 1.0000 / 0.9990 |
| harmony root+quality | 0.9648 | 0.8837 | 0.8838 | 0.9729 | 0.8975 | 0.8795 | 0.9467 / 0.9661 |
| harmony root-only | 0.9735 | 0.9143 | 0.9143 | 0.9831 | 0.9220 | 0.9067 | 0.9565 / 0.9692 |
| engrave silent / hard layout (files at 0) | 12/12, 12/12 | 12/12, 12/12 | 12/12, 12/12 | 14/14, 14/14 | 14/14, 14/14 | 14/14, 14/14 | 12/12; 14/14 |
| **one-hand multi-note chords LH / RH (written hands)** | 212 / 154 | **0 / 23** | **0 / 0** | 270 / 332 | **98 / 152** | **0 / 0** | 290 / 121; 327 / 365 |
| most notes at once LH / RH | 3 / 3 | 1 / 2 | 1 / 1 | 4 / 3 | 4 / 3 | 1 / 1 | |
| notes per onset LH / RH | 1.278 / 1.112 | 1.000 / 1.018 | 1.000 / 1.000 | 1.227 / 1.247 | 1.060 / 1.108 | 1.000 / 1.000 | |
| notes written | 2746 | 2286 | 2263 | 3710 | 3440 | 3362 | 2823; 3417 |
| harsh pairs per onset | 0.0202 | 0.0128 | 0.0134 | 0.0266 | 0.0228 | | 0.0250; 0.0331 |
| selected patterns | hymn 9, auto 2, ballad 1 | same | same | hymn 9, auto 5 | hymn 8, auto 5, broken 1 | hymn 8, auto 4, block 1, broken 1 | |
| selected candidates the pass could touch (stage <= 3) | 12/12 | 9/12 | 12/12 | 11/14 | 6/14 | 14/14 | |
| **pass: notes removed / unfixable** | 2 of 2748 / 9 | 188 of 1553 / **0** | 211 of 2474 / 0 | 8 of 2887 / 2 | 295 of 1006 / **0** | 473 of 3835 / 0 | |
| repair units accepted | 0 | 0 | 0 | 4 | 2 | 1 | |

**Reading the table.** (1) The pass itself works: on every candidate it touches, every hand holds one note at every onset, 0 unfixable (melody and bass are never in one hand at the same moment in any of these files once the bass is taken as the lowest head). (2) **In the stage-3-gated counterfactual the final output is not guaranteed single-note**: removing the inner voices makes every stage 1-3 candidate worse on harmony and melody, so the unchanged selection routes to a stage-4 candidate, which the pass does not touch: 3 of 12 (16-file) and 8 of 14 (held-out) final selections are stage 4 and still hold 23 + 0 and 152 + 98 chords. `singleNoteHands` (the gate at stage 4 too) gives 0 multi-note chords in every final graph, in both samples and on the 8 hymns; it is the variant for a teacher whose range (2.1 to 3.9) includes the stage-4 selections of the 3.1 to 3.9 requests, and it costs (over the gated counterfactual) a further 0.006 (16-file) and 0.059 (held-out) of level distance and 0.017 and 0.057 of melody (the melody metric counts every head of a melody-voice event, and the pieces whose "melody voice" is written in chords lose all but the top: czerny599/010 1.000 to 0.357, czerny599/032 0.966 to 0.379, burgmuller25/019 to 0.551. **The real melody loss is 0: `melodyTopLine` is 1.0000 for off, stage-3 gated and `singleNoteHands` on both samples and on the 8 hymns** (ScoreArranger 1.0000 and 0.9990); the `melody` number in this mode reads the dropped chord notes under the tune as lost melody and is not meaningful alone). (3) Harmony root+quality falls 0.965 to 0.884 (16-file) and 0.973 to 0.898 (held-out): a melody over a single bass note cannot sound a chord quality; it is the largest cost, as expected. (4) Level distance 0.3325 to 0.4375 and 0.4271 to 0.4750: the output is easier than requested by another 0.15 and 0.05 of a level on average (measured level minus requested: -0.284 to -0.438, -0.427 to -0.475). (5) Against ScoreArranger the table changes: G9 still wins hard violations and ties engraving; it **now loses melody** (0.9446 against 0.9845; 0.9557 against 0.9744), **loses harmony on both samples** (0.8837 against 0.9467; 0.8975 against 0.9661; before it won both), and loses level distance (held-out 0.4750 against 0.4507; before it won). What it gains is the criterion: ScoreArranger holds 290 / 121 and 327 / 365 multi-note hand chords. Nothing was tuned around any of it.

**The 8 hymns of the `h9k` packet** (G9 + repair at each item's targetLevel and handProfile; before = origin/main = the default, after = the stage-3-gated counterfactual; in brackets `singleNoteHands` where it differs):

| hymn (target) | pattern before to after | notes drawn | hand chords LH / RH after | measured level before to after | harmony root+quality |
|---|---|---|---|---|---|
| all-glory-laud (2.76) | hymn (same) | 207 to 107 | 0 / 0 | 2.40 to 2.17 | 0.958 to 0.750 |
| when-i-survey (2.24) | auto small to auto large | 171 to 103 | 0 / 0 | 2.24 to 1.92 | 0.938 to 0.828 |
| pass-me-not (3.87) | hymn to auto large (stage 4) | 170 to 268 (250) | **9 / 10** (0 / 0) | 2.79 to 2.87 | 1.000 to 0.938 (0.906) |
| all-creatures (3.88) | hymn to auto large (stage 4) | 237 to 165 (158) | **0 / 7** (0 / 0) | 2.79 to 2.40 | 0.824 to 0.853 |
| christ-arose (2.76) | hymn (same) | 274 to 150 | 0 / 0 | 2.40 to 2.24 | 0.988 to 0.725 |
| nearer-my-god (2.4) | auto to broken | 168 to 143 | 0 / 0 | 2.24 to 2.20 | 1.000 to 0.938 |
| god-rest-ye-merry (2.87) | auto small to hymn large | 289 to 135 | 0 / 0 | 2.76 to 2.40 | 0.950 to 0.563 |
| the-strife-is-oer (3.77) | block (same) | 415 (same) | 0 / 0 | 2.88 (same) | 0.944 (same) |
| **mean / total** | | 1931 to 1486 (1461) | 9 / 17 (0 / 0) | 2.56 to 2.39; distance 0.506 to 0.684; within +-1: 6 to 7 | 0.9502 to 0.8173 (0.8133); root-only 0.9643 to 0.8959 |

Hard violations 0 to 0, engraving clean, melody 0.9981 to 1.0000 (`singleNoteHands`: 0.9869: all-creatures 0.896, a harmony head; `melodyTopLine` 1.0000 on all eight in all three states). The two stage-4 flips (pass-me-not: a sixteenth-note left-hand arpeggio with dyads in some half-note bars; all-creatures: thirds in the right hand) are the selection routing around the pass.

**How bare the hymns become.** all-glory-laud at 2.76 becomes a right-hand melody over a left-hand single bass line (quarter notes, halves and a dotted half, no chord note anywhere): 107 notes where the hymn had 207, measured level 2.17 (0.59 under the request; it was 0.36 under). It reads as a real two-line arrangement (melody and bass, like the outer voices of the hymn), clean to read and easy to play, but it is bare: no inner voice, no third or sixth, so the harmony is implied only by the bass, which is why the harmony metric falls to 0.750 (christ-arose 0.725, god-rest-ye-merry 0.563). Whether the teacher, whose own students these are, finds it a real arrangement is exactly the thing this round cannot decide. `block` (when-i-survey, stage 1) is the same shape with a bass note per beat; `broken` (nearer-my-god) keeps its arpeggio, which was already one note at a time.

**LOOK** (puppeteer, 400 px wide, device scale 2, packets built from this branch with `review/build.js --mode h9` on the 8 items of the `h9k` key (first the stage-3-gated counterfactual, which was then the default, then the stage-4 gate = `singleNoteHands`); G9 side of all 8 hymns, every system seen; the crops are at `.../scratchpad/single/shots-def` and `shots-c4`, outside the repo). Checked two ways. **Data**: the G9 arm's wire notes with their staff (what the packet draws): stage-3 gated: 9 LH and 17 RH onsets with two notes (pass-me-not 9 / 10, all-creatures 0 / 7), all other six hymns 0 / 0 (max 1 note at once); with `singleNoteHands`, 0 / 0 on all eight. **DOM** (the drawn SVG: noteheads in one staff row at one x column, plus the two earlier probes): stage-3 gated, G9 arm: 23 columns with two noteheads (pass-me-not 17, all-creatures 6), 4 "touching" and 4 stem-joined wide intervals (all in pass-me-not), 0 columns on six hymns; `singleNoteHands`: **0 columns with two noteheads, 0 stem-joined wide intervals, 3 "touching"**, which on inspection are successive single notes a step apart drawn close (16th notes of christ-arose and pass-me-not, different stave notes, not chords). The legacy arm of the same packet: 641 multi-notehead columns, 9 touching, 124 stem-joined wide intervals (the teacher's crops). What I see: all-glory-laud, christ-arose, god-rest-ye-merry, when-i-survey, nearer-my-god: a right hand that is the melody alone over a left hand that is one line (quarter and half notes; christ-arose's second half has dotted-eighth and sixteenth figures in both hands), clean to read, nothing stacked anywhere; the-strife-is-oer: melody over a sixteenth-note left-hand pattern (unchanged by this round); in the stage-3-gated packet pass-me-not shows the stage-4 candidate (a left-hand sixteenth arpeggio, and in its last systems half-note dyads in both hands); with `singleNoteHands` its right-hand dyads are gone and the left keeps the arpeggio as single notes.

**Tests** (all pass): `npm run test:realize` 127, `test:critics` 94, `test:repair` 36, `test:review` 87, `test:arrangement-planner` 17, `test:playability` 57, `test:songgraph` 45, `test:difficulty` 34 (run alone; under load its cold-performance test can miss its 100 ms limit). New: `tests/realize/hand-max-notes.test.js` (14: third, sixth, diminished fifth and triads removed down to the melody or bass; melody top, bass and a melody event's extra head; unfixable counted and N = 2 allows the pair; held and tied notes removed whole, nothing shortened, a kept tie chain intact; one-note-at-a-time input untouched; deterministic, idempotent, input untouched, cross-hand second still handled after; `maxNotes` validated; direct `realize()` and `handMaxNotes` without `handChords` equal to the origin/main golden; candidates do not pass it by default, `opts.last.handMaxNotes: 1` is the stage-3-gated counterfactual with stage 4 untouched; christ-arose: one note per hand, only removal, melody top and bass kept, melody metric 1; the five patterns; stage gate; the critic's counts equal the pass's and the `multi` key), `tests/repair/repair.test.js` (+1, the wiring and no new multi-note chord on three hymns; the single-note guard test builds its candidates with `singleNoteHands: true`; the older god-rest-ye-merry guard test is as before), `tests/critics/melody-top-line.test.js` (4: all top notes present is 1 while the every-head number falls; a lost top note is caught and a lost inner head is not; wrong pitch and tolerance; the critic reports it and a one-note-per-hand realization keeps it at 1).

**Limits.** (1) The stage-3-gated variant (the first commit's default, removed) does not deliver the criterion at the final output: stage-4 selections keep their dyads; only `singleNoteHands` does, and it is off by default. (2) The criterion removes the inner voices of every hymn copy: harmony (0.75 and lower on three hymns), level (about 0.2 to 0.6 under the request) and melody (for pieces whose melody voice is written in chords) all fall; none of it tuned. (3) "Bass" is the lowest head of the lowest-averaging left-hand voice for copies and the lowest note of the harmony window for generated patterns, not always the lowest sounding pitch. (4) `block` becomes repeated bass notes, one per beat window; whether a teacher prefers that to an octave or a fifth is a musical choice this pass does not make (it never adds or moves a note). (5) The hymn voices removed become rests in their own voice; the engraver draws them cleanly here (engrave metrics 0 silent, 0 hard layout, every file). (6) A cross-hand second between two protected notes is still left (16-file 7, held-out 30). (7) One reviewer's criterion; no human has seen the after packet; not merged, not deployed.

**The teacher-criterion switch (`singleNoteHands`).** One switch makes the variant that satisfies the criterion in full available for review: `candidates` option `singleNoteHands` (default false; true = `handMaxNotes: 1` and `handMaxNotesMaxStage: 4`, so no two-note chord in either hand at ANY stage; it is part of the `run()` cache key and `opts.last` can still override). `review/build.js --single-note-hands` (through `review/lib/arrange.js` and `select.js`) applies it to the **G9 arm only**; the legacy arm is unchanged (tested: identical with and without). The flag is recorded in `key.json` (`singleNoteHands`) and appears nowhere in the packet. Nothing else changed: with the switch off the G9 arm is origin/main's, so a default packet still shows the round-4 chords.

*What it is and what it costs.* It is a teacher-criterion mode: one note per hand. By the harness metrics it makes G9 lose melody and harmony agreement against ScoreArranger (numbers in the `singleNoteHands` columns above: harmony root+quality 0.8838 / 0.8795, melody 0.9272 / 0.8988, against ScoreArranger's 0.9467 / 0.9661 and 0.9845 / 0.9744) and level distance; what it wins is hand comfort (0 multi-note chords in both hands on both samples and on the 8 hymns, against 290 / 121 and 327 / 365 for ScoreArranger). **Caveat, stated plainly: the harness melody metric collapses on pieces whose melody voice is written in chords** (czerny599/010 1.000 to 0.357, czerny599/032 0.966 to 0.379, burgmuller25/019 to 0.551) **because it counts every head of a melody-voice event**; the top note is kept, so the tune is intact, but the metric reads the dropped chord notes as lost melody. Those drops are not a melody loss in the teacher's sense; the harmony drop (a melody over a bass note cannot sound a chord quality) is a real loss of content.

*The `h9m` packet* (`D:/PPP-review/h9m`, key `D:/PPP-review-keys/h9m`, id `0fb1c746d793`, the 8 hymns of `h9k`, `--single-note-hands`). DOM check on the G9 arm (400 px, every system): 0 columns with two noteheads, 0 stem-joined wide intervals (3 "touching" are successive single notes a step apart in different stave notes, not chords); the legacy arm of the same packet: 641 columns, 124 stem-joined wide intervals. Notes drawn and measured level against the request: god-rest-ye-merry 135, 2.40 (req 2.87); all-glory-laud 107, 2.17 (2.76); nearer-my-god 143, 2.20 (2.4); the-strife-is-oer 415, 2.88 (3.77); christ-arose 150, 2.24 (2.76); when-i-survey 103, 1.92 (2.24); all-creatures 158, 2.40 (3.88); pass-me-not 250, 2.87 (3.87); hard violations 0 on all. How they read: all-glory-laud, christ-arose, god-rest-ye-merry, when-i-survey are melody over one bass line (a real two-part texture, bare: no inner voice); nearer-my-god is melody over a single-note broken-chord figure (the most arrangement-like); all-creatures (now a stage-3 `auto`) is melody in the right hand over a single bass note per beat with a moving bass, a plain but complete-looking accompaniment; pass-me-not is melody over a sixteenth-note left-hand arpeggio written as single notes (the closest to a real accompaniment, but sixteenths are a demanding left hand at a level-2.87 measured result); the-strife-is-oer is unchanged, melody over a sixteenth-note left-hand pattern, already single-note. The two that previously flipped to stage-4 candidates (pass-me-not, all-creatures) now hold no two-note chord and read as simpler, single-line versions.

*Tests:* `tests/review/single-note-hands.test.js` (3: the G9 arm of pass-me-not at 3.87 has 0 multi-note hand onsets in the packet data and 0 two-notehead columns in the drawn SVG, with a control that the default arm has both; the legacy arm is identical with and without the flag; the flag is in the key and absent from the packet HTML and manifest), and one in `tests/realize/hand-max-notes.test.js` (every candidate single-note at every stage, the default leaves stage 4 alone, a separate cache entry).

**Review round on c99389a (corrections, all measured again).** (1) The always-on stages 1-3 `handMaxNotes: 1` is removed (above); the default equals origin/main: 16-file and held-out level distance 0.3325 / 0.4271, harmony root+quality 0.9648 / 0.9729, melody 0.9988 / 0.9975, hard 12/12 / 14/14, engraving clean, notes written 2746 / 3710, and the 8 hymns (level distance 0.5062, harmony 0.9502, notes 1931) equal the runs of an untouched copy of origin/main. `singleNoteHands` reproduces the numbers reported above. (2) **Melody top line** (`melodyTopLine`, report only, above): 1.0000 for off, stage-3 gated and `singleNoteHands` on both samples and on the 8 hymns; the old `melody` number in this mode (0.9272 / 0.8988 against 0.9988 / 0.9975) is not meaningful alone. (3) "Byte-identical" holds for the realized graph; the candidates' report gains a `handChords.maxNotes: null` key (the pass's stats), and `report.handChords.handMaxNotes` only when the option is given. (4) "Unfixable 0" in the table counts only the single-note kind (`stats.maxNotes.unfixable`); the harness's `unfixable` sums all kinds and shows 6 (16-file) and 7 (held-out) under `singleNoteHands` (9 and 2 when off), all of them cross-hand seconds between two protected notes (`unfixableCross`), none a hand holding two notes. (5) The `h9m` key's `builtFrom` records `63ef7e1`; the packet was built from the later `c99389a` code (the switch), whose G9 arm is the same as `63ef7e1` with the stage-4 gate.


### G9e-lite: single-note option in the app

**What this is.** G9's `singleNoteHands` arrangement (one note per hand, the teacher's criterion) reachable from the app as an **opt-in**. The app's default stays `legacy`: nobody who does not turn the option on sees any change. (*Superseded in part by "G9e default-on" below: the default is now `'single'`; everything else in this subsection, the costs and the limits included, still describes the option.*) Branch `g9e-single-note-option` from origin/main 14a76f8. Not merged, **not deployed**. One writer, no sub-agent. Changed: the app file, `candidates/index.js`, `critics/metrics.js`, `realize/ottava.js`, `realize/index.js` (one line), the new `realize/clefs.js` (and `review/lib/neutral.js`, which now imports it), tests, `package.json`, i18n (ko, ja, zh), this doc and G08b's mode list. No `engrave/`, `server.js` or roadmap file.

**Why it is opt-in, and what it costs (disclosed, not hidden).** The legacy arranger writes two-note chords and wide simultaneous notes (641 two-notehead columns and 124 stem-joined wide intervals in the 8 hymns of the `h9k` packet, against 0 and 0 for `singleNoteHands`). By the harness metrics `singleNoteHands` **loses harmony agreement and level distance** to legacy (section above: harmony root+quality 0.884 / 0.880 against ScoreArranger 0.947 / 0.966; level distance 0.443 / 0.534), and a hymn becomes a melody plus a single-note left-hand accompaniment (often a broken-chord figure, not "one bass line": an independent measurement found the lowest note on the beat equals the source's on only 16-52% of beats in hymns), **about 0.5 of a level easier than requested on average** (measured level minus requested: -0.44 / -0.53) although **the note count often goes up** (pass-me-not 193 to 250, czerny599/027 186 to 213, czerny299/009 1464 to 1880; czerny599/027's blocked left-hand chords become 16th-note arpeggios). It is a teacher-criterion mode, not a better arranger. (The first version of the control's explanation said "plainer, and often easier than the level you choose" and "one bass line": both were wrong for such pieces and are corrected below.)

**`PPP.arranger`.** `'legacy'` (default) | `'g8'` (G8b, unchanged) | `'single'` (new). Any other value is `'legacy'` (G4-F2-1's convention; tested with 9 odd values). In `'single'` the request goes: the same unarranged graph the `'g8'` path uses (`built.graph`; in the Song Arranger the open song's graph from `PPPEngrave.app.resolve`: the importer's own, the kept one, or the one rebuilt from its Score) -> G7a `analyze` -> the G8b hand-profile and level search (`ARRANGER_LEVEL_TO_STAGE`, large/medium/small) to find a reachable request -> `candidates.runAsync({ singleNoteHands: true, skipEngrave: true })` with the G6 reference the page fetches once (weights + method-books dataset) -> G9b `repairSelection` -> the lower staff's clef per measure (`realize/clefs.js`) -> TD16 `addOttava` -> `graphToReviewScore` (the conversion `'g8'` uses), and the graph is remembered with the Score (`engraveRemember`, `via: 'live'`), so the engraver draws the graph G9 made, rests, ties and 8va lines included.

**What had to change to run in a browser** (each verified by loading the files in a bare `vm` context, no `require`, no `module`, and in headless Chrome):
- `critics/metrics.js` had plain top-level `require()`s of Node-only things (`tests/`, `path`, the layout benchmark): now a UMD wrapper, Node exports and numbers identical plus `setWeights(weights)` (the browser has no weights file to read; the app passes the one it fetched). In a browser `engraveMetrics` and `hardViolationsOfAudioNotes` throw "Node-only"; `levelOfGraph` throws until `setWeights` is called.
- `realize/ottava.js` (TD16): UMD wrapper, Node behaviour identical (its 14 tests unchanged).
- `candidates/index.js`: (1) `opts.reference` now also reaches `planner.plan` (it reached only `realize` and the critics, so `plan()` fell to its Node-`require` default and threw `require is not defined` in the page: the same class of gap G8b found in `realize`); (2) `opts.skipEngrave`: no engrave critic (default off = the gate, byte for byte); (3) `runAsync`: the same pipeline and result as `run()` (tested equal on summary, selected fingerprint, explanation and tried list for four option sets), handing the thread back between candidates (`enumerate` became a generator that `enumerate()` drains; identical for every existing caller).
- `realize/index.js`: `g.timeline.tempos.forEach` -> `(g.timeline.tempos || [])`. A graph read from a file with no tempo list (czerny299/009) made `realize()` throw in Node and in the page; a real gap in merged G8a code, unrelated to the option, found here.
- `realize/clefs.js` (new; the rule was in `review/lib/neutral.js`): a UMD module with `lowerClefs` and `ledgerLines` moved out unchanged (the review tool imports them; its 87 tests are unchanged and a differential check of 5 items, wide and narrow drawings and audio, is byte-identical to origin/main) and `applyLowerClefs(graph)`, which writes the lower staff's clef per measure into the realized graph (removing its clefs and adding one per change, at the barline; the graph itself comes back when the rule says bass all the way, so a hymn is unchanged). It runs before `addOttava`, which reads the drawn clef. The realizer writes a bass clef on the lower staff for the whole piece, so a piece whose left hand lies in the treble register got long 8va lines over a bass staff. `scoregraph/legacy-score.js` already carries a clef change at a barline (each measure's `clefs` snapshot), so no converter change was needed (tested).
- No Node `require` is reached from the page in this path: `realize/index.js` already looks for `PPPRealizeModules.handchords`, `repair` takes `opts.REF`.

**Scripts and cost.** Not in the page's `<script>` list: 14 files fetched the first time the option is turned on (the control starts the download), executed in list order (`async = false`): `realize/handchords.js`, `realize/clefs.js`, `realize/ottava.js`, `critics/{voice-leading,register-density,register-floor,left-hand-jump,low-register-cluster,vertical-clash,metrics,index}.js`, `candidates/index.js`, `repair/{plan,index}.js`, about 185 KB, plus the two reference files (`difficulty/weights/g6a-v1.json`, `difficulty/tools/dataset/method-books.json`, 207 KB) the `'g8'` path already uses. **Cost to every user who does not turn it on: the app file grew by about 13 KB of text (the glue, the two controls, comments); zero extra requests** (tested: a page load requests none of the 14 scripts or the reference data; with the option on each is requested exactly once and nothing else). `?v=1` like the other G8 scripts; `server.js` serves `.js` no-store, so no bump.

**The balanced gap, and every entry point.** The review screen's default texture `'balanced'` goes `rewriteFromHeard()` -> `audio-score.js arrangeNotes` and bypassed every switch (G8b section 11). With the option on, the request is routed before that choice: any level but "Original transcription", any texture, goes to the single path. Inventory of every place that arranges (grep of `ScoreArranger.arrange`, `arrangeWithService`, `arrangeNotes`, `rewriteFromHeard`, `toMusicXml(... arrangement)`, `/arrange-score`):

| entry point | covered by `'single'` |
|---|---|
| Recognition review: Apply arrangement (`applyArrangement`), every texture incl. balanced | yes |
| Recognition review: AI custom arrangement (`aiArrangement`; the LLM only picks a texture, which does not apply; the level is the person's) | yes |
| Recognition review: Rewrite the rhythm (`rewriteRhythm`, re-applies the stored arrangement) | yes, when the option is on and the stored level is not "original" |
| `easierArrangement()` (no button calls it today) | yes |
| Song Arranger in My Songs: Create new song, AI custom arrangement (`saveSongArrangement`) | yes |
| Difficulty "Original transcription" on either screen | **no, by design** (not an arrangement: the heard notes are restored, the Song Arranger copy is origin/main's, tested identical) |
| `rewriteFromHeard()` used by import/"Try again" (transcription, not arrangement) and `arrangeWithService` / `arrange_score.py` | unchanged (legacy) |
| Import, Practice, Analysis, Shared Scores | have no arranger |
| `'g8'` | unchanged (still bypassed by `'balanced'`) |

The texture (style) choice has no effect under the option (as under `'g8'`); the control's text says so.

**The control.** A chip button "One note per hand (experimental)" (ko: "한 손 단음 (실험)"; ja, zh added) with a two-line explanation under it ("The right hand plays the melody as one line; the left hand plays an accompaniment one note at a time. No hand plays two or more notes together, but depending on the piece the left hand may play more notes, and some of the original harmony can be lost."; the same in ko, ja, zh). That the texture choice does not apply and that "Original transcription" is not arranged is in this doc and the entry-point table, no longer in the chip's text. Space and Enter on the focused chip press it (the app-wide key handler used to take Space for Play); switching it off returns to the mode that was set before it, so a console-set `'g8'` is not lost. On the review screen it sits under the Difficulty / Texture / Apply / AI row; in the Song Arranger under the texture hint. `aria-pressed`, off at load, reads `PPP.arranger` (so a value set from the console shows), **session only, not stored** (decided: an experimental mode that silently stays on next week is worse than one click). Switching it on also renames the Song Arranger's suggested copy "... one-note-per-hand arrangement" (texture names would be false). Checked at 400 and 1100 px: inside the viewport, no sideways scroll, wraps under the buttons at 400 px.

**Failure behaviour (decided).** A refusal (`UNREACHABLE`, no reference data, scripts that did not load, a crash) is never shown under a single label and never silent. **Review screen:** the standard arrangement (today's default engine) is built and shown, with the notice "This piece could not be made in one-note-per-hand mode, so the standard arrangement is shown." (ko: "이 곡은 한 손 단음 모드로 만들 수 없어 기본 편곡을 보여줍니다.") left on screen under the controls (it is the status line) and as the toast; its source says `engine: 'browser-fallback'` (or the legacy engine's own) and `singleFallback: <reason>`, never `ppp.g9-single`. **Song Arranger:** nothing is saved (the copy is a durable library entry) and the dialog stays open with "This piece could not be made in one-note-per-hand mode. Turn the option off to make the standard arrangement." Real cases: sonatina/020 has no reachable plan at any level (G7b), tested in both screens; a blocked `candidates/index.js` gives the same notice with `SINGLE_NOT_LOADED`. **Reference data is retried, not remembered as failed:** `loadArrangerReference` kept a failed fetch for the whole session (and the chip prefetches it, so a blip was likelier), giving `REFERENCE_UNAVAILABLE` on every later Apply until a reload. Now only a success is kept; a fetch in flight is shared; a failed weights fetch is asked for again in the same call (`loadDifficultyWeights`, G6b's, still keeps its own failure: left alone). Tested in Node (stub fetch: fail once then succeed, both files, in flight, no fetch) and in the page (the first two requests for `method-books.json` blocked: the first Apply shows the notice, the next works with no reload). The Song Arranger's AI button saves the honest provider `PPP one-note-per-hand arranger` (the AI only proposed a texture, which does not apply), and the review screen drops the AI's "chose level · texture" status line for a single-note result.

**Performance** (headless Chrome, this machine, cold first call includes JIT; `PPP.arrangeSingleNote`, G9 default N; "longest block" = longest gap between 4 ms timer ticks while it ran). Before `runAsync` the whole run was one block; with it:

| piece | level | total | longest block (one block before) |
|---|---|---|---|
| christ-arose | beginner / advanced | 409 / 493 ms | 52 ms (382 / 562 ms) |
| nearer-my-god | beginner / advanced | 181 / 221 ms | 33 / 21 ms |
| pass-me-not | beginner / advanced | 307 / 275 ms | 42 / 36 ms |
| sonatina/016 (1,567 notes, stage 3 at large) | beginner / advanced | 3.9 / 3.8 s | 799 / 745 ms (4.7 / 4.2 s) |
| czerny299/009 (1,464 notes) | beginner / advanced | 3.0 / 2.9 s | 470 / 458 ms (crashed before the tempo fix) |
| sonatina/020 (the longest, 1,776 notes) | any | 0.2-0.4 s, then refused: no reachable plan | 0.17-0.39 s |

Hymns are well under a second and never block the page for more than about 50 ms; the long method pieces take 3-4 s with the page answering between candidates (the single `realize()` of a dense piece is still up to 0.8 s and is not divided). The "Writing one note per hand..." line paints first. Results are cached by (graph fingerprint, level), 6 entries: the same request again is 1-8 ms. The thread is handed back with a `MessageChannel`, not `setTimeout`, which a background tab holds to one tick a second.

**Without the engrave gate.** The browser has no layout benchmark, so `skipEngrave` replaces the gate (engrave checks only the top 3 cheap-ranked candidates). Measured on 125 corpus files (all 106 hymns and every 9th method piece) at two levels each, 220 requests with a reachable plan: **the winner was the same candidate in 220 of 220**, and no engrave-checked candidate read anything but 0/0 (the round-2 finding, again). The page's own drawing is the engraver's, run afterwards on the result.

**Default identical to origin/main.** Through the real entry points on a build of `git archive origin/main` (14a76f8) against this tree, both on the browser engine (the helper refused): Song Arranger at all four levels and a jazz copy on christ-arose, nearer-my-god, pass-me-not, plus sonatina/020, and the review screen (christ-arose, four levels and three textures): 31 of 31 saved scores identical by sha-256; the test's own 21-entry recipe is pinned in `tests/fixtures/g9e-legacy-identity.json` (made from that build) and was re-checked after the option had been turned on and off again. "Original transcription" with the option on is identical too.

**Looked at** (puppeteer, Korean, 400 and 1100 px, device scale 2): the control reads "한 손 단음 (실험)" as a violet-outlined chip when on and a grey one when off, under the Difficulty/Texture/Apply row with its explanation; at 400 px the row wraps, the chip sits under the buttons and the text is five lines; in the Song Arranger it is between the texture hint and the title field, nothing clipped. A result (christ-arose, intermediate) opened on the Practice screen at 400 px: treble staff melody, one bass note per beat in the bass staff, fingering numbers, title line "... PPP 한 손 단음 편곡", no stacked notes. The toast "중급 한 손 단음 편곡을 만들었습니다." shows. Not done: a human has not judged this arrangement in the app.

**Tests.** `tests/realize/app-single-note.test.js` (12: the switch and `singleRoute`; every lazily loaded script in a bare vm; metrics in a browser; vm pipeline equals Node byte for byte; winner without the gate equals the gated one; one note per hand on 4 hymns x 4 levels through the app's own `arrangeSingleNote` and `graphToReviewScore`; refusals; cache; a tempo-less graph, the reference loader that keeps only a success, and the clefs of beyer/020, burgmuller25/016 and a hymn), `tests/realize/clefs.test.js` (6: shared with the review tool, a treble-register left hand, a low one returns the graph itself, clef before 8va, the Score carries a mid-piece change, bare vm), `tests/critics/candidates-async.test.js` (3), `tests/single-note-app.test.js` (`npm run test:single-note-app`, its own free-port server via `tests/serve-free.js`; 49 checks: identity, control at 400/1100 px and in Korean, scripts requested only after turning it on, four hymns in the Song Arranger and three on the review screen, engraver draws with no fallback, Play starts, no console or page error, original, both refusals the blocked script, the reference-data blip, Space and Enter on the chip, and the mode the chip returns to).

Run alone on this tree (all pass unless stated), after the review round: `test:review` 87, `test:realize` 145, `test:critics` 97, `test:repair` 36, `test:arrangement-planner` 17, `test:playability` 57, `test:songgraph` 45, `test:difficulty` 34, `test:engrave` 200 of 201 (the one failure is the known A27 layout-hash drift, unchanged), `test:scoregraph` 215 of 216 (A44: a stale script-list regex, fails identically on an origin/main build; first round), `node tests/engrave/tools/page-files.js --check` passes (no `--write` needed), `tests/library.test.js` passes, `tests/transcription.test.js` has two transkun-console-script failures that fail identically on origin/main (first round), `test:single-note-app` 49 of 49. Default identity after the review round: the 31 saved scores (Song Arranger and review screen, default mode, the option visited and left first) are identical to an origin/main build, and `review/lib/neutral.js` renders 5 items (beyer/020, burgmuller25/016, czerny849/002, czerny599/027, christ-arose: wide and narrow drawings and the audio list) byte-identically to origin/main.

**Limits and risks.** (1) The review screen's heard notes are injected in the test (no transcription helper here); a real recording's graph is the same `built.graph` the `'g8'` path already uses, not exercised with a real recording. (2) Song Arranger graphs: the importer's (live or kept) and a Score-rebuilt (projected) graph both work on the four hymns; a rebuilt graph has no hand marks (`Staff.limb`), and only hymns were tried there. (3) **Clefs and 8va (review round).** The converted Score used the realizer's bass clef for the whole left hand, so pieces whose left hand lies in the treble register showed long 8va/15ma lines over a bass staff; `realize/clefs.js` now chooses the clef per measure by ledger-line cost, exactly the review tool's rule (constants 0.5 / 4 / 2, not tuned). Looked at in the real UI at 400 px, Song Arranger, intermediate, before and after: beyer/020 had one 8va over the left hand for all 16 bars, now a treble clef on the lower staff and no line; burgmuller25/016 had five left-hand lines (8va at 3, 8, 17, 18 and 15ma over 12-15), now lower clefs `1:bass 3:treble 10:bass 12:treble` (three changes in 18 bars, courtesy clefs at system ends) and two lines (8vb over bars 4-6 and a 15mb over 16-17: bar 16-17 stay in treble under the rule's hysteresis with notes to D2, a residual the rule's constants would have to change to remove, not made); czerny849/002 and czerny599/027 are unchanged (bass throughout, their 8va lines are over the right hand: the left hand is not in the treble register at this level, so the rule keeps bass); hymns are unchanged (bass all the way, the graph is returned as it was). (4) 22 of 48 sample pieces have no reachable plan: there the option refuses (it never "tries harder"). (5) Dense pieces take 3-4 s (page responsive). (6) Not deployed; `arrange_score.py` still the primary engine of the default. (7) The Song Arranger's suggested title follows the locale at the moment the option is toggled. (9) Leaving the review screen while an arrangement is still running can apply it to the next song opened; this is on origin/main too and was left alone. (8) The harness costs above stand: harmony and level worse than legacy, melody-plus-bass hymns.

### G9e default-on (user decision 2026-09-30)

**What changed.** `PPP.arranger` now starts as `'single'` (one note per hand), not `'legacy'`. Branch `g9e-default-on` from origin/main 88900fe (the G9e-lite merge, #113). The chip ("One note per hand", ko "한 손 단음"; the word "experimental" was dropped from it in this branch) is **pressed on the first render**; pressing it turns the mode off and returns to `'legacy'` (`ARRANGER_MODE_BEFORE_SINGLE` starts as `'legacy'`; a console-set `'g8'` is still restored when it was set before the chip was pressed on). `'legacy'` and `'g8'` stay settable through `PPP.arranger`; any other value is still `'legacy'` (G4-F2-1). The difficulty "Original transcription" is untouched (`singleRoute` excludes it). No selection weight, level offset or legacy/g8 algorithm changed (standing rule: no more tuning).

**Why.** A decision of the user, not a measured result: the one-note-per-hand arrangement is the "쉬움" (easy) tier of the app: the harness measured it about 0.5 of a level easier than requested (section above), and it is the arrangement that passed the teacher's criterion on a G9-only page. It is not a better arranger by the harness metrics (harmony agreement and level distance are worse than legacy, listed above), and none of that has changed.

**Startup: a page that does not arrange asks for nothing.** The 14 scripts and 2 data files (16 requests, about 420 KB, every one `Cache-Control: no-store`: `server.js` sends that for `.html`, `.js` and `.json`, so they are fetched again on every visit that arranges) are fetched by `warmSingleModules()`, which runs when a screen that arranges opens: `openSongArranger`, and the recognition review screen (`componentDidUpdate`, when `screen` becomes `'review'`), and by the chip when it is pressed on. It is a no-op while another mode is set. There is **no timer**: an earlier version of this branch started the download 2.5 s after every page load, which a review found costs every visitor 16 requests even if they never arrange; it was removed. An arrangement asked for before the download has finished waits for the same download (`loadSingleModules` and `loadArrangerReference` share what is in flight); tested with every file held 3 s and Apply pressed at once: 16 requests in all, none doubled. A failed download degrades as in #113 (the standard arrangement with the existing notice, no page or console error, nothing cached as failed, the next Apply asks again).

**`loadSingleModules` no longer says "ready" on two globals.** It used to return true as soon as `PPPCandidates` and `PPPRepair` existed, so one failed script of the other twelve (after which those two globals exist anyway) left the session with `SINGLE_CRASH` until a reload. It now keeps a set of the scripts that have loaded, is ready only when all 14 have, and on a retry asks again for the first script that has not loaded and for every script after it in the list (they may have run without it), never for the ones before it. Tested by refusing `critics/vertical-clash.js`, then letting it through: the notice and the standard arrangement first, one note per hand on the next Apply, the eight scripts before it fetched once, it and the five after it fetched again.

**The Song Arranger is not a dead end.** With the option on, 9 of 20 catalogue pieces are refused by the single-note pipeline (happy-birthday has no plan at any level; hanon 001/010, burgmuller25 005/010/020, czerny599 001, czerny849 010, sonatina 020). #113's Song Arranger then saved nothing and told the person to turn the option off; with the default now on that is where a new user got stuck. Now `saveSongArrangement` behaves like the review screen: it makes the standard arrangement by the path the option-off copy takes (`arrangeWithService`, the browser arranger if there is no helper), saves it as a copy titled as a standard copy ("... · Balanced piano arrangement"; a title the person typed stays), records `singleFallback: <reason>` in its source, and says "This piece could not be made in one-note-per-hand mode, so the standard arrangement was saved." (ko/ja/zh added). **The review screen's refusal now uses the same engine as the option off**, which is what the review found to differ: a balanced, melody or accompaniment texture is written by the rhythm rewriter (`rewriteFromHeard`), a rich texture by the arranger (`applyRichReviewArrangement`), exactly as `applyArrangement` routes them with the option off; before, every refusal went through the arranger. Tested on happy-birthday in both screens (the same notes the chip off gives) and on sonatina/020.

**A copy is named what the person typed.** `scoregraph/legacy-score.js` takes `g.meta.title` over the name it is given, so a one-note-per-hand copy was saved, on its card and in its score, under the ORIGINAL's title. The app now sets the arranged score's title to the copy title after the conversion (`scoregraph` itself is unchanged). The Song Arranger's suggested title also follows the level: "... · one-note-per-hand arrangement" only for a level that goes to the single-note arranger, so for "Original transcription" it is the standard copy's title; it updates when the level, the texture or the chip changes (a title the person typed is never touched).

**The texture choices do nothing in this mode, and the screens say so.** Beside the texture control, while the mode applies (any level but "Original transcription"): on the review screen a line "Texture choices don't apply in one-note-per-hand mode; turn it off to use them."; in the Song Arranger the same sentence replaces the description of the chosen texture (which would describe something that will not happen). ko, ja and zh are in the catalogs. The success message of a one-note-per-hand result never names a texture (tested with jazz chosen).

**The identity guarantee moved.** It is now "with `PPP.arranger = 'legacy'` the output is identical to origin/main's legacy output", not "the default is". `tests/fixtures/g9e-legacy-identity.json` is unchanged (its 21 hashes were made from origin/main 14a76f8 in legacy mode); the suite sets `'legacy'` explicitly, and also checks it after the option's scripts have loaded and after the real chip was pressed off on a fresh page, and again after the chip is pressed back on (one note per hand again, the same arrangement as the first time). The tests that asserted "default is legacy" (`tests/realize/app-single-note.test.js`, `tests/single-note-app.test.js`, `tests/transcription.test.js`) now assert `'single'`, and the browser suites that use a texture engine on purpose (`tests/library.test.js`'s jazz copy, `tests/transcription.test.js`'s texture checks, `tests/engrave/tools/u1-paths.js`) set `'legacy'` explicitly. The extractor `tests/realize/app-single-extract.js` takes the app's own `let ARRANGER_MODE` line instead of a copy of it.

**Also for a person who did nothing:** the Song Arranger's suggested copy title says "one-note-per-hand arrangement" and its composer line says so; AI custom arrangement (both screens) uses the single path, keeping the person's level. The review screen's `'balanced'` texture goes to the single path too (it bypassed `'g8'`), so the third ungated legacy engine is now reached only with the chip off, or when a piece is refused.

**Known limits, unchanged:** some pieces refuse (9 of 20 catalogue pieces; both screens then give the standard arrangement with the notice, marked `singleFallback`); some arrangements flip the lower staff's clef; thin hymns become a melody plus a single-note left hand; dense pieces take 3-4 s (page responsive). Every visit that opens an arranging screen downloads the option's 16 files once (about 420 KB, no-store, so again next visit). Two more limits, left on purpose: (N2) 'Rewrite rhythm' on a recording that was imported in 'arrange' mode (legacy easy, balanced) now re-arranges it in one-note mode (151 notes against 164 from the legacy engine with the option off); (N5) AI custom arrangement in one-note mode still asks the helper for a style and then ignores it, and the saved entry records that style although it was not applied; a console-set PPP.arranger does not refresh the chip until the next state change. The Song Arranger's old refusal text ("Turn the option off to make the standard arrangement.") is no longer used; its catalog entries are left in place.

**Rollback.** Redeploy 88900fe (the app file's default is the only behavioural switch; the fixture is unchanged), or ask a user to press the chip off (session only, not stored).

**Tests.** `tests/single-note-app.test.js` 86 of 86 pass, 0 fail (62 before this round; identity recipe: 21 of 21 hashes equal to origin/main's in legacy mode); `tests/realize/app-single-note.test.js` and `app-arranger.test.js` 19 of 19 (`npm run test:realize` 145 of 145). New in it: a fresh page that never opens an arranging screen requests none of the 16 files; opening the Song Arranger asks for them once each after the first paint and the load event; the in-flight race; a failing script other than candidates and the recovery; the copy's title on the card and in the score (suggested, typed, "Original transcription"); the suggestion following the level; the texture note (default, original, chip off, ko catalog) and the success message; the Song Arranger and the review screen on happy-birthday and sonatina/020 giving the chip-off notes with the notice.

### G9e refusals (2026-10-01)

**The problem.** With one note per hand as the app's default, 119 of the 222 method pieces (53.6%, at each of the three levels; 117 `UNREACHABLE` and 2 `ALL_CANDIDATES_HAVE_HARD_VIOLATIONS`) and dense piano covers were refused, and the app then saved the LEGACY arrangement (dyads, octave chords), which the teacher rejects. The cause is in `arrangement/plan.js` `planSection`: it checks the SOURCE notes of the retained voices (a hand's simultaneous span of at most 14 semitones and 5 keys, `chordLoad`, notes per beat per hand, range) BEFORE the single-note thinning runs, so chords the realizer would never play made a section unreachable. (Found by a read-only investigation, reproduced with the app's own `arrangeSingleNote`, prototypes in the scratchpad; the structural fixes below follow its findings, with no tuning of any selection weight or level offset.)

**What changed.** Branch `g9e-refusals` from origin/main 8a7a65a. (A first version of this subsection, commit 2e8c5d1, reported 2.7% refusal; an independent review then found 12 of the 20 Hanon exercises made with the RIGHT hand below the LEFT at 20 to 40% of the moments; item 5 is the fix and the numbers below are after it.)

1. **A second planning pass, used only when the strict search finds no plan.** `plan(g, sg, request, { relax })` (`relax` 0 = off, the default and the exact old behaviour, 1 or 2). In a section the strict search cannot fit (every rung of the texture ladder refused) the search is repeated for that section only: tier 1 checks reach and `chordLoad` on the THINNED view (a hand's simultaneous count is `min(count, 1)`, span 0, extra keys per beat 0; the density ceilings are the strict ones); tier 2 also puts the density ceiling at the stage's real maximum (`band.notesPerBeatRH/LH.max` instead of p90) and drops the range ceiling (a one-note hand over a wide range is played with 8va/8vb and a hand move, not a stretch). A section planned by a relaxed tier carries `relaxed: 1 | 2`, the plan carries the highest tier used, and the attempt record says so; a strict plan has none of those fields, so its object is what it always was. `candidates/index.js` takes `opts.relax`, ignored without `singleNoteHands`, and uses it only when NO spec of the enumeration has a strict plan (otherwise the piece is enumerated exactly as without the option, candidate for candidate). The app (`arrangeSingleNote`) runs its strict search over the four levels and three hand profiles exactly as before; only when that finds nothing does it run the same loop with `relax: 2` and pass `relax: 2` to `runAsync`. The result carries `levelNote: 'relaxed-plan'` (and `report.relaxed`) when the chosen candidate's plan was relaxed.
2. **`dropBass`** in `realize/handchords.js` `thin` (`opts.dropBass`, only with `maxNotes`; `realize()` option `handDropBass`, which `candidates/` passes with `singleNoteHands`). Before, a hand whose notes at an onset were all protected and more than N (the melody's top note and a bass note in the same hand; a melody event's own extra head that is also the bass) was left and counted as `unfixable`, which let a dyad through in a result the pipeline called a success (burgmuller25/001: 1 multi-note onset; hanon/020 when planned relaxed: 1). With the option the melody's top note stays and the other protected notes of that hand go, the least important first (right hand: the lower; left hand: the higher), each counted in `stats.maxNotes.droppedBass`; nothing is shortened or moved, a removed note takes its whole tie chain, `thin(thin(x))` removes nothing. No effect without `maxNotes`, without the option, or at N >= 2.
3. **A refusal in the Song Arranger is not easy to miss and saves nothing by itself.** When a piece still cannot be made one note per hand (the residual pieces below, scripts that did not load, a crash, no graph), the window STAYS OPEN with a persistent, dismissible notice (`data-single-refusal`, `role="alert"`): "This piece could not be made in one-note-per-hand mode, so nothing was saved. You can save the standard arrangement instead, in which a hand may play two or more notes at once." and two buttons, "Save the standard arrangement" (saves the standard copy, marked `singleFallback`, titled as a standard copy, with the old "so the standard arrangement was saved" toast) and "Cancel" (dismisses the notice; the window and its options stay). Changing the level or texture, or pressing Create or AI again, clears it. The standard copy is now saved only on that click. The review screen keeps its fallback (a person is looking at the result); its notice was already persistent (`arrangementStatus`, under the controls), and the test now checks that it is still there after the toast has gone.
4. **The harder-than-chosen sentence.** A result planned by the relaxed pass says "This piece has many notes, so the arrangement may be a little harder than the level you chose." (ko "이 곡은 음이 많아 고른 난이도보다 조금 어려울 수 있어요.", ja, zh in the catalogs) in the Song Arranger's success toast and on the review screen (persistent line under the controls, and appended to the success toast); `levelNote` is saved in the arrangement's source. "May": the flag says the plan needed the relaxed search, it does not compare the output's assessed level with the request.

5. **Hand order (the review's major finding).** Cause, verified on hanon/007: a relaxed section with both voices below middle C left the right hand empty (`RH: [], LH: [v5, v6]`); `realize/index.js` `rebalanceHands` then moves the LOWER voice of the busy hand across, which is right for two voices in the right hand (the bass goes left) and wrong here: the bass went to the RIGHT hand under the melody in the left (87 of 225 two-hand moments with the right hand below the left; a right-hand line E2 D2 F2 under an 8vb mark). The strict search never produced such a section (its reach check refuses two voices an octave apart), which is why strict successes were not affected. Two structural fixes, neither touching a strict output: (a) `plan.js`, relaxed tiers only: when a section's split leaves one hand empty and the other with two or more voices, the plan makes the split itself in the direction that keeps the right hand above the left (the lowest voice of an all-right section goes left, the highest voice of an all-left section goes right), so `rebalanceHands` finds nothing to move; (b) `candidates/index.js`: a candidate whose plan is relaxed is also discarded, like a G5 violation, when its right hand's lowest sounding note is below its left hand's highest at more than `HAND_CROSSING_MAX` = 1% of the two-hand moments (`critics/metrics.js` `handCrossing`, a pure function of the graph; held notes count; the value is reported in `scores.handCrossing`). (a) alone took the Hanon exercises from 20 to 40% down to 1 to 7% (a generated accompaniment landing under a low melody; the source's own crossing is 0% in every Hanon file checked), (b) removes the rest: the verbatim-voice candidate of the same enumeration is what is left where it crosses at most once in about 225 moments (a held note across a section boundary); where none is, the piece is refused. No weight or level offset was touched. 1% is a bar chosen from the strict successes' own numbers (mean 0.15%, 3 of 309 above 5%), not fitted to an outcome; with a bar of 0 the refusal rate was 7.2% because the single boundary moment also refused the verbatim candidates of 9 Hanon pieces.

**Numbers** (the app's own `arrangeSingleNote`, extracted and run in Node over all 222 method pieces x 3 levels = 666 requests, before = origin/main 8a7a65a, after = this branch; `tests/realize/app-single-extract.js`, run by hand, results are not committed):

| | before | after |
|---|---|---|
| refused, of 666 | 357 (53.6%) | 30 (4.5%): 10 pieces x 3 levels |
| `UNREACHABLE` / `ALL_CANDIDATES_HAVE_HARD_VIOLATIONS` | 351 / 6 | 12 / 18 |
| made one note per hand | 309 (103 pieces) | 636 (212 pieces) |
| hard (G5) violations in a result | 0 | 0 |
| hands starting two notes at one moment, in all results | 3 (burgmuller25/001) | 0 |
| one-hand octave-plus spans, one-hand seconds | 0 | 0 |
| right hand sounding below the left (pooled over two-hand moments; `handCrossing`) | 0.15% (mean per file 0.16%; 3 results above 5%, all beyer/059 and burgmuller25/016, whose sources cross) | all made 0.07% (the same 3 results above 5%); newly made 0.01%, worst 0.4%; the 17 Hanon pieces made 0.00% |
| a right-hand and a left-hand note a second apart at one onset (see residual) | 33 onsets, 15 results (5 pieces) | 39 onsets, 18 results (6 pieces) |

- **The 103 pieces that succeeded before (309 requests): 306 byte-identical** (sha-256 of the realized graph); the 3 that differ are burgmuller25/001 at the three levels, where `dropBass` removed the leaked dyad. With `dropBass` switched off (`last: { handDropBass: false }`) burgmuller25/001 gives its origin/main hash at all three levels, so 309 of 309 are identical apart from that one deliberate fix.
- Of the 327 newly made requests (109 pieces), the plan needed tier 1 in 179 and tier 2 in 160 of the 339 requests whose strict search had no plan at the app's level (plan-only count, with item 5's split in; the other 12 have no plan even relaxed: czerny849/005, 009, 011, 020). All 327 carry `levelNote: 'relaxed-plan'`; none of the 309 strict ones does. The crossing filter and two later refusals take 12 requests off the 339: hanon/006, 009, 017 (every candidate crosses) and czerny849/010 (`VELOCITY`).
- **Cost in level**: the output's assessed level (`critics/metrics.js` `levelOfGraph`) minus the requested stage, mean +0.46 for the strict pieces (n = 309) and +0.67 for the newly made ones (n = 327; max +2.84, the extreme dense covers). Requests are also planned at a harder level than asked (beginner planned at stage +1 in 30 and +2 in 53 of the relaxed requests, intermediate at +1 in 53), which is where the cost comes from. The user's standing rule applies: no offsets or weights were tuned to reduce it.
- **Time** (Node, per request, 8 processes in parallel): p50 0.73 s, p90 2.9 s, max 12.6 s (before: max 11.4 to 19.8 s across runs on a loaded machine); the relaxed pieces do not cost more than the dense strict ones. In the page the same work runs on the main thread between `singleTick` yields, up to about 2 s of it without a yield (known limit, not changed).
- **Output check** (the task's item 4, re-run after item 5). The two synthetic dense covers (`tests/realize/g9e-synth.js`: A = 16th runs to C7 with octave chords and a busy left hand, B = a typical busy pop arrangement) are refused by the strict search at every level and are made at all three, relaxed, with 0 hard violations, 0 multi-note onsets, 0 touching seconds, 0 one-hand octave-plus spans, 0 crossed moments. Their assessed level is 3.10 (A) and 2.57 to 2.88 (B) for requests of 1 to 3: the cost above, unflattering and real. Ten formerly refused pieces at 'intermediate' (hanon/001, hanon/010, beyer/012, beyer/016, burgmuller25/005, czerny599/001, czerny599/048, czerny299/002, czerny849/006, sonatina/020): all made, 0 hard violations, 0 multi-note onsets, 0 one-hand octave-plus spans, 0 one-hand seconds, 0 touching seconds, 0 crossed moments; assessed level 1.37 to 3.46 (requested 2). happy-birthday: made at all three levels (assessed 2.15, 2.36, 2.40), same zeros. Over all 636 results: 0 hard violations, 0 multi-note onsets, 0 one-hand octave-plus spans, 0 one-hand seconds; the melody's top note is never removed (the critics' melody-retention numbers were not re-measured here).
- **Hand crossing, before and after item 5** (intermediate, Node; `handCrossing`, sustained: the right hand's lowest sounding note below the left hand's highest, at every onset where both hands sound): hanon/007 was 87 of 225 two-hand moments (reviewer's number); with the plan split alone 7 of 228 (3%); with the filter 0 of 225 (the verbatim-voice candidate). The 12 Hanon pieces the review listed (007, 011, 016, 002, 005, 009, 010, 019, 008, 017, 013, 012) are now: 10 made with 0 crossed moments each (0 of 223 to 236), and hanon/009 and 017 refused (with the plan split alone they were 8 of 225 and 14 of 212; the others 0 to 7 of about 225). Hanon/006, which the review did not list, is refused too (every candidate crosses).

**Known residual.**
- **10 pieces stay refused** (30 of 666 requests, 4.5%): czerny849/005, 009, 011, 020 (no plan even relaxed); czerny849/010, 027 and sonatina/013 (every candidate has a G5 hard violation: `VELOCITY` in 010, `SPAN` in sonatina/013: the melody's own notes are too fast or too wide for the levels, and the melody is never changed); hanon/006, 009, 017 (every candidate's right hand sounds below the left at more than 1% of the moments). The Song Arranger now stops at the notice for them; the review screen shows the standard arrangement with its notice. Before the crossing fix the refusal rate was 2.7%; the 1.8 points are the price of not handing a teacher a right hand under the left, reported honestly.
- **Seconds between the hands, at one moment:** 6 pieces (beyer/059, burgmuller25/016, sonatina/003, 010, 025, 027; 18 of the 636 results, 39 onsets in all; 33 onsets in 15 results before) have a note of the right hand and a note of the left hand a second apart at 1 to 3 onsets. The 5 that were made before (beyer/059, burgmuller25/016, sonatina/003, 010, 025) already had them on origin/main; sonatina/027 is newly made. Only checked on the melody-vs-bass pair for hanon/006 (RH 57 over LH 55, both protected; the piece is refused now); nothing removes a protected note, so this stays: it is the source's own voicing, not a leak of the thinning.
- **Some outputs are harder than the level chosen (above); the screens say so, with a flag that is not measured** (known limit): the note appears whenever the relaxed pass was used, not when the output's assessed level is actually above the request, so it can be shown for a result that came out at the level asked for, and a result can be harder than asked without it (a strict plan at a higher offset). A difficulty meaning of single-note mode for the levels is still the user's decision.
- **The levels barely differ for the newly made pieces:** 63 of the 109 newly made pieces are byte-identical at all three levels (the relaxed plan lands on the same texture whatever was asked), and the Hanon exercises return full-speed 16th notes in both hands at beginner too (assessed level 2.87 at all three requests). Known limit, not changed (no offset tuning).
- **Refusals are slow and block the page:** a piece that is refused runs the whole enumeration first (seconds, up to about 2 s of it on the main thread without a yield), then shows the notice. Known limit, not changed.
- The third ungated legacy engine is reached only with the chip off (unchanged).

**Tests.** `tests/realize/g9e-refusals.test.js`, 20 of 20 (run by `npm run test:realize`): the relaxed search runs only for a section the strict search cannot fit (a piece with a strict plan is planned byte for byte as before, no `relaxed` field anywhere, relax 1 and 2 alike; relax off by default and for any other value); the two synthetic dense covers are refused strictly at every level and planned by relax 2 with the flag on the plan, each section, each relaxed attempt and in the explanation; relax 1 alone plans beyer/013 at all 12 (level, profile) pairs, asserted, and relax 2 returns the same plan there; per section, beyer/013 has sections planned exactly as the strict search plans them and one relaxed section that the strict search refuses (`planSection` with relax 0 on each); a relaxed section never leaves one hand empty with two or more voices in the other; `metrics.handCrossing` (in order 0, swapped 4 of 4, a held low note counted); `candidates` ignores `relax` without `singleNoteHands`, enumerates a strict piece candidate for candidate as without it, and discards a relaxed candidate whose right hand crosses above `HAND_CROSSING_MAX` (hanon/001: the generated-accompaniment candidates go, the verbatim one is selected; hanon/006: refused; a strict hymn carries no `handCrossing` score); `dropBass` (pure) and `realize()` with `handDropBass` and no `handMaxNotes`; the app's `arrangeSingleNote` over a 24-request strict panel hashes exactly as origin/main 8a7a65a made them (`tests/fixtures/g9e-refusals-strict.json`); the dense covers, hanon/001, czerny599/001 and happy-birthday make it with `levelNote` and no multi-note onset or G5 violation; hanon/001, 002, 007, 011, 016 have the right hand below the left at no more than 1% of the moments and never at a simultaneous attack; burgmuller25/001 has no dyad; czerny849/009 is `{ok: false}`. `npm run test:realize` 165 of 165 (145 before this work); `app-single-note.test.js`'s refusal test uses czerny849/009 for the piece that stays refused. The browser suite `tests/single-note-app.test.js` 105 of 105 (86 before; identity recipe 21 of 21 equal to origin/main's in legacy mode): happy-birthday, sonatina/020 on the review screen and the harder-than-chosen note (persistent, toast, ko, cleared by choosing another level on the review screen), the new sentences and the "Dismiss" label in the ko/ja/zh catalogs, and the refusals (czerny849/009 and a blocked script keep the Song Arranger open with the notice and "Save the standard arrangement" / "Dismiss", exactly one button reads "Cancel", nothing saved, the notice still there 4.5 s later, cleared by a level change or the chip, Dismiss keeps the window, Save saves the marked standard copy, the next Create works after a blocked script; the review screen's fallback notice outlasts the toast). One of three full runs of this suite timed out once (90 s in a review Apply in the texture-note section) and the next two passed; not reproduced, not understood. Also passing on this tree: `test:critics` 97, `test:repair` 36, `test:arrangement-planner` 17, `test:playability` 57, `test:review` 87 (Node) and `library`, `interactions`, `import-and-persistence`, `i18n-and-auth` (browser, exit 0, against this tree through `tests/engrave/tools/with-port.js`). The other suites of `npm test` were not re-run.

**Rollback.** Revert the commit (`arrangement/plan.js`, `candidates/index.js`, `realize/handchords.js`, `realize/index.js`, the app file and the three catalogs carry the whole change). Keeping the Song Arranger notice but not the relaxed pass is one line: in `arrangeSingleNote`, loop `[0]` instead of `[0, 2]`. Nothing is stored that an older build cannot read (`levelNote` is an extra field of the arrangement source).


#### G9e long-id fix (2026-10-01)

A user's 90-measure piano transcription (title "Looping the Rooms feat. Hatsune Miku - rusino (Piano)") was refused in the Song Arranger although the music was arrangeable. Cause: scoregraph/legacy-score.js idOf cuts a graph id at 64 characters, realize/index.js appended "-g8a" (68 > the validator's 64), so every candidate failed to build (BUILD_FAILED -> NO_CANDIDATES) at every level. Any import titled about 36 characters or longer was hit (the method panel given a 64-character id: 141 of 147 runs refused). The earlier refusal numbers (53.6% to 4.5%) were measured with short ids and so missed this. Fix: the realizer keeps at most 60 characters of the id before the suffix (an id of 60 or fewer is unchanged); tests/realize/g9e-refusals.test.js has a regression test (fails without the fix). The review screen was not hit (its graph id is sg-audio). Known limits for such recordings: the planner needs the relaxed pass, so levels collapse (beginner = advanced material, flagged by the note); the left hand can be dense (continuous 16ths); about 45% of right-hand notes of that piece are above C6 (printed under 8va lines) because nothing caps melody height.


#### G9e stray-note rescue (2026-10-01)

**The problem.** A user's YouTube piano recording (Onsets & Frames transcription, 90 measures, 1,225 heard notes, graph id `sg-audio`) was refused by the app's one-note-per-hand arranger at all three levels with `ALL_CANDIDATES_HAVE_HARD_VIOLATIONS`. The strict planner finds no plan; the relaxed pass (`relax 2`) plans it, and then all 5 candidates are discarded: four have exactly ONE G5 hard violation, a `VELOCITY` (the hymn-pattern candidate has four). The one they share: right hand at t = 17.16 s, source measure 12 (the graph's `m18`): the melody voice goes 94, then a chord [60, 65], then 87; one note per hand keeps the 65, a 29-semitone shift in 0.123 s where `playability/analyze.js` needs 0.18 s. The [60, 65] chord is a leftover of the transcription's voice split (an accompaniment chord that landed in the melody voice, between two high notes). The note is in every candidate because it is the melody voice's own, and `repair` never touches melody notes, so one note in about 1,900 events refused the whole piece. The user is a piano teacher who rejects arrangements with dyads and wide hands; they want it to work.

**What changed.** Branch `g9e-velocity` from origin/main 6a579e3 (code = deploy ebca5ef). Two commits: the first version (0208ed5) and the review fixes below (version 1.1.0 of the rescue).

1. **`candidates/index.js` `strayRescue`** (on by default with `singleNoteHands`; `opts.strayRescue: false` switches it off; exported for tests). A last resort, used ONLY when no candidate survives selection, and only on a candidate whose every hard violation is a `VELOCITY`. It leaves out an OUTLIER, never a note of a figure. For the first violation of a hand the candidate units are the note the violation lands on or the one before it, alone, or a run of two adjacent notes that starts at the first or ends at the second. A unit is taken only if ALL of these hold:
   - **Outlier:** it is farther in pitch from BOTH of its neighbours in the hand than twice the distance between those neighbours (94, [65], 87: 29 and 22 against 2 x 7; at the first or last attack of a hand, farther than twice the distance from its one neighbour to the next one). A note inside a regular wide figure (77, 50, 60) is no outlier.
   - **Minority:** the 4 attacks either side of it, those within an octave of it plus the unit itself, are fewer than the rest (three adjacent low notes among high ones are a hand that moved, not strays).
   - **Clears something, makes nothing new:** its removal leaves fewer hard violations and none but `VELOCITY`.
   Among the units that qualify, the shortest goes, then one with a neighbour on both sides (an edge unit is weaker evidence), then the one that leaves the fewest violations, then the larger margin. The unit is LEFT OUT: its events become rests of the same length and display (the way `realize/index.js` `applyHandChords` empties an event), through `scoregraph/ops.js` `edit()` (one validated transaction; provenance source `ppp.g9e-stray-note`, op `repaired` on the event's `exists` aspect), then the hard filter is re-evaluated (one sweep per drop) and fingering is recomputed once, as `repair()` does. The candidate is scored again with the same critics and filter (the G5 hard filter, and `handCrossing` for a relaxed plan). Guards: a chord (two or more notes in one attack), a tied note (either end) or a note linked to a performance note is never taken, and the note next to it is not taken in its place (the candidate stays refused); at most `RESCUE_MAX_DROPS` = 8 notes go; any non-`VELOCITY` hard violation in the candidate means no rescue at all; the input graph is never modified. A piece with ANY surviving candidate never reaches it, so every result that exists without it is byte for byte the same. The same code runs in `run`, `runAsync` (one candidate at a time, the thread handed back between them) and the `fullEngrave` path.
2. **Fewest drops first.** Among the candidates the rescue cleared, only those that left out the fewest notes stay in the running (`fewestDrops`; the others are marked `rescueExtra` and discarded like a candidate with a violation), then the usual selection runs unchanged: no weight or level offset is touched, and a candidate that survives WITHOUT the rescue is never in this list (the rescue does not run then).
3. **The result says what it did.** `selected.rescued` and `selected.report.rescued` are `[{ m (measure number), at (position in the measure), sec, hand, pitch, why: 'VELOCITY' }]` (a rescued candidate carries them; others do not have the field). The app's `arrangeSingleNote` returns `rescued` (null when nothing was left out) and `report.rescued`; the saved song and the review screen's `importSource.arrangement` carry `rescued: <count>` (absent when none).
4. **One sentence, in both places**, in the app's two-key plural convention (like "Next review in {{n}} day / days"): "{{n}} note was left out because it could not be played smoothly." / "{{n}} notes were left out because they could not be played smoothly." (ko "부드럽게 치기 어려운 음 {{n}}개를 뺐어요.", ja "滑らかに弾けない音を{{n}}個省きました。", zh "有 {{n}} 个音符难以流畅演奏，已省略。"). It is appended to the Song Arranger's success toast and is the persistent line under the review screen's controls, next to the level note when both apply (`singleNoticeText`, which remembers the exact text so that choosing another level takes it off the screen, as the level note does).

**Review findings of the first version (0208ed5), all fixed here.** The first version chose, among the two notes next to a violation, the one whose removal left the fewest violations, then the more isolated one, with no test that the note was an outlier.
- *Edge stray:* `iso` counted one neighbour at the edge, so `mk({rh:'C6:q D6:q E6:8 D6:16 C3:16 r:q'})` dropped the legitimate D6 and kept the stray C3. Now an edge unit is judged against its one neighbour and the next one, and the stray goes (test).
- *Two adjacent strays:* `'C6:q A6:16 C4:32 F3:32 D6:8 E6:q r:q'` dropped A6 and D6 and kept C4, F3. Now a run of two is one unit and both strays go (test).
- *Fewest drops:* on the real piece four candidates cleared it with 1 drop and the app chose the hymn candidate, which dropped 4 (three left-hand notes as well). Those three left-hand notes are not outliers, so the hymn candidate is no longer rescued, and the fewest-drops rule would have chosen among rescued candidates anyway.
- *Sentence:* "so 1 left out" was ungrammatical and "cannot be played" is not always true; reworded as above, singular and plural.
- *Legitimate notes in figures:* czerny849/010 and 027 flipped to success only by dropping notes of regular arpeggio figures (010: the low 50 of a 60 69 77 50 arpeggio, twice in measure 22; 027: the RH 85 and 56). Those are no outliers and the pieces are REFUSED again, as before the rescue; a refusal is preferable to a silent change to a figure (test: the 60 69 77 50 60 69 78 figure is not rescued).

**Decision: drop, not move** (unchanged). The first draft (the investigation's `velocity-rescue.patch`) moved each offending single note by whole octaves (65 to 89) with floor, tie and link guards. Measured on the real piece in the first version, on the hymn-pattern candidate (the one then selected), before = the unrescued candidate with its 4 violations:

| | before (4 hard) | drop | move (draft) |
|---|---|---|---|
| hard violations, large profile | 4 | 0 | 0 |
| notes | 900 | 896 | 900 |
| notes at a pitch the source does not have at that onset | 0 | 0 | 4 |
| melody top line kept (of 462 onsets) | 100% | 99.78% (-1) | 99.78% (-1) |
| harmony (root + quality) | 0.7944 | 0.7861 | 0.7944 |

Both lose the same melody onset (the moved 89 does not match the source's 65 either); moving buys back 0.0083 of harmony (three left-hand notes kept at another octave) and costs 4 notes the source does not contain at that place, one of them in the melody. With the outlier rule only the right-hand 65 is left out and the selected candidate's harmony is unchanged by it (0.8444 before and after). A moved note sounds like a mistake in the tune; a note that is not there is a smaller, honest change.

**Numbers.**
- **The real piece** (`tests/fixtures/g9e-transcription-stray-note.graph.json`, the stored graph, 359 KB; and `...heard.json`, the heard notes, which the review screen builds its graph from): refused at all three levels before; made at all three after. The levels collapse for this recording (one relaxed plan: the three results are the same graph, known limit below). The selected candidate is the ballad pattern (the stored graph) or the auto pattern (the graph built from the heard notes); it leaves out exactly ONE note: the stray chord's 65 in measure 12, right hand (`rescued = [{m:'12', at:'7/12', hand:'RH', pitch:65}]`; measure 12 at 17.16 s). The hymn-pattern candidate, which has three more left-hand violations, is no longer rescued and is not selected. 0 hard violations at the large profile the request uses (the app takes the first hand profile that has a plan; at small and medium the result has 1), 0 hands starting two notes, 0 one-hand seconds, 0 one-hand octave-plus spans, hand crossing 2 of 1,080 two-hand moments (0.19%, under the 1% filter; the review path 2 of 1,061).
- **Melody**: the top line is down by exactly one onset (462 to 461, 99.78%), the melody notes matched by one (656 to 655). A "99.9%" gate cannot be met by any handling of this note: one onset of 462 is 0.22%, and the stray IS an onset of the source's melody voice (a move loses it the same way). The same candidate scored 100% before, with a note no hand can play. Harmony and assessed level (3.84) do not move.
- **Fuzz** (`fuzz.js` of the investigation, run by hand; 400 random 4 to 9 bar melodies with 1 to 2 planted strays, a quarter of them adjacent pairs, some at the first or last attack, per seed; 6 seeds = 2,400 melodies, 1,176 of them with a VELOCITY violation): with this version the rescue is applied to 1,146 of the 1,176 and refuses 30 (they stay refused), and drops **0 legitimate notes** (every dropped note is a planted stray; 1,795 dropped); the first version dropped 169 legitimate notes in 144 of its 1,169 rescues. `tests/realize/g9e-stray-note.test.js` carries a seeded 300-melody version of it.
- **Time**: about 0.3 s per candidate on this 1,900-event graph under load, a yield after each candidate in the page's async path; the whole request about 9 to 13 s in Node on a loaded machine (6.4 s for the refusal it replaces).
- **Identity** (the app's own `arrangeSingleNote`, extracted, 325 files x 3 levels = 975 requests: 222 method pieces, 100 hymns, 3 catalog pieces; before = a clean extract of origin/main 6a579e3, after = this branch; run by hand, not committed): **all 933 requests that succeed on origin/main are byte-identical** (sha-256 of the realized graph, and `levelNote`; none carries `rescued`). **No refused request flips: all 42 stay refused** (24 `UNREACHABLE`: czerny849/005, 009, 011, 020 and the hymns beneath-the-cross, it-is-well, the-love-of-god, under-his-wings; 18 hard-violation refusals: czerny849/010, 027, sonatina/013 `SPAN`, hanon/006, 009, 017 crossed hands). The first version made czerny849/010 and 027 at the three levels; they are refused again, as on origin/main, because the notes it dropped were notes of regular arpeggio figures, not outliers (010: the low 50 of a 60 69 77 50 arpeggio, twice in measure 22; 027: the RH 85 and 56). Every piece the rescue now makes is a stray-note piece like the user's; of the 325 files none other is one.

**Known limits.**
- **The upstream cause is the transcription's voice split** (`audio-score.js`): an accompaniment chord can land in the melody voice. The rescue treats the symptom, a note no hand can play in time; the chord's other note, the neighbours, and the voice assignment are not repaired. A recording with many such places (more than 8 notes) is not made at all.
- **The levels collapse for such recordings**: the relaxed plan lands on one texture whatever level is asked (the three results for the real piece are the same graph), and the output is harder than the level (assessed 3.84 for a request of 3), with the harder-than-chosen sentence shown as for any relaxed plan. The left hand is dense (an accompaniment as written in the recording, one note at a time).
- **Ambiguous patterns stay refused or are decided by the rule, not known**: an alternating high/low trill (A6 C4 A6 C4) is no minority and is refused; three or more adjacent strays are refused. A stray is told from music only by the outlier rule above; a leap that is a real musical gesture and also unplayable in time, flanked by close notes, would be taken for a stray (an intermediate version of the rule, without the minority test, dropped the melody note between two strays two notes apart in 1 of 2,400 melodies, and the three-adjacent-strays case dropped the melody; the minority rule resolves both).
- Only `VELOCITY`: a candidate with another kind of hard violation is not rescued; a stray that is part of a tie, a chord or a linked note is not rescued either (the candidate stays refused, as before).
- The rescue runs on the main thread between the page's `singleTick` yields; about 0.3 s per candidate on this piece, with a yield after each (async path).

**Tests.** `tests/realize/g9e-stray-note.test.js` (15, in `npm run test:realize`): the real graph is refused without the rescue (every candidate `VELOCITY` only) and made at three levels with it (exactly the one expected note, 0 hard at the request's profile and at large, no hand chord, no second, no octave-plus, crossing under the filter's 1%); only the reported note is missing (a rest of the same length, no event removed, nothing added or moved), the top line down by exactly 1/462, melody by 1/656, level unchanged, the rescue is the provenance source; the hymn candidate stays refused and every rescued candidate has exactly one drop; the review screen's path; the synthetic melody 94 / [60, 65] / 87 piece (`tests/fixtures/g9e-stray-note.musicxml`); determinism, `runAsync` and `fullEngrave` give the same fingerprint, the cache key tells on and off apart; `strayRescue` unit cases (the stray is the arrival or the departure note; a stray at the last or the first attack; two adjacent strays; three adjacent are refused; a note of a wide figure is never taken; a chord, a tied note and a graph with a `SPAN` violation are not rescued; 6 strays go, 20 do not; a clean graph gives null); the seeded fuzz (0 legitimate notes dropped); `fewestDrops` unit; a piece with a surviving candidate (christ-arose) is selected with the same fingerprints with the rescue on, off and through `runAsync`, no `rescued` field; hanon/006 (refused for crossed hands) stays refused. `tests/single-note-app.test.js` has a section "a stray note" (15 checks; the whole suite is 120 of 120: Song Arranger and review screen saved as one note per hand, `arrangement.rescued` = 2, the sentence in the toast and persistent on the review screen, singular and plural, gone when the level changes, absent for christ-arose, Korean text, catalogs). Also run on this tree: `npm run test:realize` 181 of 181, `test:critics` 97, `test:repair` 36, `test:arrangement-planner` 17, and the browser suites library, interactions, import-and-persistence and i18n-and-auth against this tree's server (all pass). One suite change: czerny849/009 is refused in the Song Arranger (its imported graph has no plan) and was refused on the review screen too, but the review screen's graph, built from the heard notes, has two low notes (70 and 69) among 98 to 101 in measure 11, the stray-pair pattern, which the rescue now leaves out, so the review path makes that piece; the suite's review-screen refusal checks use the hymn beneath-the-cross (no plan at any level) instead.

**Rollback.** Revert the commits (`candidates/index.js`, the app file, the three catalogs). Switching the rescue off without reverting: `strayRescue: false` in `candidates.run`'s options (the app does not pass it). Nothing stored is unreadable by an older build (`rescued` is an extra field of `importSource.arrangement`).


### G9f final-review fixes (2026-10-01)

Branch `g9f-rests-parallel` from origin/main 35130f0 (code = deploy 9c66496). The teacher's final G9 review passed 13 of 16; an investigation of the failures found three causes in rests and one repair move; an independent review of the first version (9b7283a) then found the source guard too loose and the review page still drawing 32nd rests, and this subsection is the corrected version. Everything below is measured against a clean `git archive` extract of 35130f0 with the app's own `arrangeSingleNote` (extracted, `tests/realize/app-single-extract.js`), run in Node over all 325 pieces (222 method, 100 hymns, 3 catalog) x 3 levels = 975 requests (42 of them refused, as before, on both sides).

**1. The review page (`review/lib/neutral.js`) drew rests no printed edition writes.**
- *Eighth rest.* `restPieces` only allowed a rest to start on a multiple of its own length, so the silence of "16th note, eighth rest, 16th note" (a dropped stray note) was cut into two 16th rests, which the engraver put above the beam (i11 bars 3 and 6). An eighth that starts on the second sixteenth of a quarter and fills the end of a silence without leaving the quarter is now ONE eighth rest (the investigator's patch; it also fires on the tail of a longer silence whose start was a sliver, which is intended: an 11-unit silence is a 64th, a 32nd and an eighth, and only the eighth is drawn). Simple meters only; every other silence is cut as before (tested: x/8, compound, longer gaps).
- *No remainder shorter than a 16th.* A piece of a silence shorter than a 16th (a 32nd, a 64th: a gap between two notes, the sliver before or after a note, the remainder of a silence that does not start on the grid) is not drawn anywhere, between notes or at the start or end of a bar; the silence stays as space. i10's review page had 31 32nd rests (22 inside silences of a 16th or longer); now 0 and 0 64th. Rests by value, i10 G9 arm (the packet item `oaf.musicxml`, `closeGaps: true`): half 5, quarter 30, eighth 60, 16th 116, whole-bar 1 (212); no silence of an eighth or longer is left undrawn (77 undrawn stretches, the longest 5.3 64ths).
- *Off-grid bars.* The page used to skip every staff-measure with a note off the 1/64 grid (the triplet bars: 42 in i10), so those bars got no rests at all. A silence beside an off-grid note is now drawn from the first grid line after the end of the note before it to the last grid line before the next (a drawn rest never touches a note), then cut as any other; `stats.offGrid` counts those staff-measures (41 in i10), `stats.skippedGaps` only a measure whose own length is off the grid (0). The rest is drawn on the grid, a binary value beside a triplet: the nearest sane rest, not a tuplet rest (the realized graph has no tuplet spanners at all: `realize/` copies ties only, so the triplet notes beside it are drawn as plain eighths too).
- Looked at (400 px wide, the first 8 systems of i10, and i11 bars 3 and 6): no 32nd or 64th rest anywhere, the eighth rest in the right place.

**2. The real app drew 32nd and 64th rests between notes (i10, the 90-bar audio piece).** Cause: the arrangement keeps the right hand's note lengths, and a transcription's lengths are what a player did: 102 of 169 gaps between consecutive right-hand notes were shorter than a 16th. Fix, at the end of the G9 pipeline (after selection and repair, so no candidate score or repair decision sees it): `repair/index.js` `closeSmallGaps`, called by `repairSelection` for a one-note-per-hand selection.
- *Only for a transcription.* `opts.closeGaps`: `'auto'` (the default) closes only when the source graph's provenance says it was made by `audio-score.js` (`isTranscription`: source kind `audio-score`, which is what a recording's heard notes become, in the kept song graph, the review screen's graph and `tests/fixtures/g9e-transcription-stray-note.graph.json`); `true` closes whatever the source (the review packet maker passes it for an item with `item.transcription`, `review/lib/arrange.js`); `false` never. A printed score's own short rests are what its edition wrote and are left exactly as written (czerny849/005 has 50 printed 32nd rests between notes; closing would have changed 50 notes, 011 23 rests, 009 11: those pieces are refused today, which is why the first version showed no change). Limit: a transcription saved and uploaded as a MusicXML file is a printed score as far as the graph says (the review packet item flag exists for that).
- *Closing.* Per staff and measure, a gap is a stretch in which no note of the staff sounds, from the end of the last note before it (a note of the same measure must precede it) to the next onset of the staff or the end of the measure. A gap of more than 0 and less than 1/16 of a whole note is closed: the note(s) ending where it starts are lengthened to its end (never shortened, never past the hand's next onset, never past the barline, no onset or pitch changes), and the rests wholly inside it are removed. A gap is skipped (left as it is) when a lengthened note would meet another event of its own voice (a rest of that voice reaching past the gap): the first version threw `E-VOICE-OVERLAP` on a staff with two voices (286 of 4000 random two-voice cases); the pass now never throws, an internal failure returns the input graph. A lengthened note takes its new length as its written value when that is a plain value of at most one dot (a 32nd plus a 32nd gap: a 16th; a dotted eighth plus 1/32 would need two dots: it keeps its written dotted eighth); otherwise it keeps its written value (i10 had seven double-dotted eighths in the first version: now none).
- *Omitting.* A 32nd or 64th rest among the pieces of a longer silence that has a note after it (and at the start of a measure) is dropped: the silence stays, no note changes. A silence with no note after it (the end of a measure) keeps its rests.
- *Triplet rests.* A 1/24 rest between two notes is a gap shorter than a 16th and is closed like any other (the first version spared it because it is drawn as a 16th rest; with the gate it protected nothing, and in a transcription it is not a written rest: the realized graph has no tuplet to put it in). The 3 that remain in the stored real transcription sit inside longer silences and are drawn as plain 16th rests, like the triplet notes beside them.
- *Sound.* A lengthened note rings at most 1/16 of a whole note (about 0.1 s at 120 bpm) longer and stops where the hand's next note starts; omitted rests change nothing in the sound; the pedal is as it was.
- **Numbers, the real transcription path** (the stored audio-score graph of the user's YouTube piece, `arrangeSingleNote`, intermediate, `graphToReviewScore`; before = origin/main 35130f0): notes 1896 both; rests 280 -> 194; 32nd 50 -> 0, 64th 33 -> 0, 16th 72 -> 69, rests of 1/24 6 -> 3, double-dotted notes 0. (The packet item `oaf.musicxml`, the same piece exported to MusicXML, has 1917 notes: its graph rests were 323 (62 32nd, 53 64th) and are 202 with `closeGaps: true`. The first version's "208" was that item before the triplet rests were closed, and an independent run's 196 was the real path with the earlier code: the two paths are different graphs of the same recording, and every figure here says which.) Looked at in the real app (Song Arranger, saved song opened, first 36 bars, before and after, for the MusicXML upload with the first version): the tiny rests are gone and nothing is missing.
- **Identity, all 975 requests, origin/main 35130f0 against this change alone** (the source guard of item 3 off): 933 byte-identical and 42 refused as before, 0 changed (measured before the gate existed, with the pass on for every piece; with the gate it cannot run on any of them). With the gate, no catalogue piece (all MusicXML or MXL files, printed scores) is touched at all; the 933 results contain no 32nd or 64th rest.
- Fixture and tests: `tests/fixtures/g9f-small-gaps.musicxml` (a 64th rest after the first eighth of every beat, 32 between notes) as a printed score keeps all 32 in the app (`tests/single-note-app.test.js`), and as a recording-marked copy has none (`tests/repair/g9f-gaps.test.js`, which also tests the gate, the dot cap, the two-voice staffs and the omission).

**3. Hanon/010: the repair broke the source's parallel octaves.** The source is one note per hand, built on deliberate octave doubling between the hands. The G9b `parallel` move (and `innerLeap`, `crossing`) fixes a smell found in the ARRANGED graph, and moved ten left-hand notes (beat 1 of bars 15-24) down an octave. Rule now (`repair/plan.js`, `ctx.sourceSmells` and `ctx.sourcePitchAt`, supplied by `repairSelection`; `opts.sourceGuard: false` turns it off):
- *The same smell.* A smell the SOURCE graph has too: the same onset and, for a parallel, the same interval and (modulo an octave) the same pitches of both slices' outer pair (an arrangement an octave from its source still has the source's parallel octaves); for an inner leap and a crossing, the EXACT pitches. The first version compared pitch classes for all three and so matched coincidences: in-the-bleak-midwinter has 141 inner-voice crossings in the source, two at m2 3/4 sharing the pitch classes {C, A}, which suppressed the repair of a real hand crossing (RH A4 under LH C5) at all three levels (0 -> 1 hand crossing). Now `smellId('crossing', {w0: '3/4', midis: [69, 72]})` is not a source smell and bleak-midwinter's results are what they were.
- *Only towards the source.* A source smell is still planned, but a candidate move is allowed only if it brings the note nearer to a pitch of the same pitch class that the source sounds at that onset. An arrangement that IS the source cannot get nearer and is left alone (hanon/010); one the realizer put octaves away from its source may be brought back. The first version just skipped such smells and so left 36 note-instances in hanon/012, 015 and 020 at an octave the realizer chose, where repair used to bring them to the source's pitch (note-for-note differences from the source rose 217 -> 223 in hanon/020).
- **Identity, 975 requests**: 882 identical, 42 refused, 51 changed in 17 pieces (hanon 001, 005, 008, 010, 011, 013, 019, 020; czerny849 014, 015; czerny599 036, 039, 056; beyer/059; burgmuller25/015; sonatina 004, 018), 197 note positions in all, every one a whole-octave shift (a repair move not made), no spec or status change. 184 of the 197 are now the very pitch the source has at that onset; 13 (hanon/020, beyer/059 and others) are an octave nearer to the source without being on it. beyer/033 and beyer/034 and the hymn in-the-bleak-midwinter, changed by the first version, are now identical to origin/main.
- **Note-for-note difference from the source** (position = staff, bar, onset; before = origin/main 35130f0, after = this change; intermediate): never more than before in any of the 32 pieces concerned. Hanon: 001 2 -> 1, 002 170 -> 170, 003 170 -> 170, 004 1 -> 1, 005 3 -> 1, 007 1 -> 1, 008 11 -> 1, 010 11 -> 1, 011 10 -> 1, 012 215 -> 215, 013 7 -> 1, 014 1 -> 1, 015 197 -> 197, 016 175 -> 175, 018 1 -> 1, 019 209 -> 207, 020 218 -> 216 (006, 009, 017 refused). Others that moved: beyer/059 2 -> 0, burgmuller25/015 159 -> 158, czerny599 036 1 -> 0, 039 2 -> 0, 056 60 -> 59, czerny849/015 61 -> 53, sonatina/004 26 -> 25. (The large Hanon figures, 170 to 217, are pieces whose left hand the arrangement regenerates; the guard does not touch them.)
- **Quality counters** (`qual.js`: G5 hard violations, hand crossings, seconds between the hands, hands with two notes at an onset, octave-plus one-hand spans; the source, origin/main and this change; 17 changed pieces and beyer 033, 034 and the bleak-midwinter, three levels, 60 results): 57 of 60 identical; hard violations, seconds, dyads and octave-plus spans identical in all 60. The three that differ are beyer/059 (all levels): hand crossings 7, 7, 5 -> 9. The source has 9 (its own writing crosses the hands) and origin/main's repair removed 2 to 4 of them; the guard leaves what the source does. A decision for the user if crossings the source writes should still be repaired.
- **hanon/010 (all three levels): 450 source notes, 450 arranged, 1 differs** (11 before: ten parallel moves and the last bar). The remaining note is the last bar's left hand, C3 where the source has C2.
- **Cause of that note, and why it is not changed.** The plan puts both voices of the last section in the left hand (`RH: [], LH: [v5, v6]`); `realize/index.js` `rebalanceHands` then moves the LOWER voice to the idle right hand, which is right for two right-hand voices (the bass goes left) and wrong for two left-hand voices (the bass goes into the right hand, under the left hand's C3: the hands cross). Repair's `crossing` then lifts the right hand's C2 to C3, which equals the source's right hand, and leaves the left hand's C3. It is not the register floor: nothing was raised (the floor's counters are 0). `realize()` has the fix, `opts.orderedHands` (the highest voice of an all-left-hand section goes right; tested on hanon/010: last bar C3 right, C2 left, the source's own), OFF by default and NOT passed by `candidates/`. Measured with it on (975 requests, against the first guard version): 57 requests change. 8 Hanon pieces (001, 004, 005, 007, 008, 011, 013, 014; 24 requests) improve by exactly that one note. But 8 pieces (hanon 002, 003, 010, 012, 015, 016, 018, 019; 24 requests) change winner: the crossing was giving the `auto` and `ballad` candidates a `VELOCITY` hard violation, the fix lifts it, and under the existing weights a regenerated left hand (25 to 217 notes differ from the source) then beats the verbatim copy; and 3 more pieces (hanon 006, 009, 017; 9 requests) go from refused to made. Making hanon/010's last bar faithful would make it unfaithful everywhere else, and the weights are not to be tuned: left off, a user decision.

**Known limits.** (a) The review page draws a binary rest beside a triplet where the real silence is a triplet value. (b) A silence tiled by rests that are all 16th or longer but badly (a 5/16 gap as a quarter plus a 16th) is not re-tiled. (c) The one hanon note above, and the winner flip behind `orderedHands`. (d) A transcription uploaded as a MusicXML file is not tidied in the app (it says printed score); the packet maker has `item.transcription`. (e) beyer/059's own hand crossings are no longer repaired. (f) `review/lib/arrange.js` (the packet maker) goes through `repairSelection`, so future packets carry the guard; packets already made do not.

**Tests.** `tests/repair/g9f-gaps.test.js` (9: planted fixture, idempotence, a 16th gap kept and a triplet gap closed, the one-dot cap, another voice's rest, no note across a barline, omission, two-voice staffs never throw, the gate), `tests/repair/g9f-source-guard.test.js` (5: exactness of the ids including the bleak-midwinter case, towards-the-source, the real pieces), `tests/repair/g9f-hanon.test.js` (2), `tests/review/neutral.test.js` (+2 and two rewritten: eighth rest, remainders, off-grid bars), `tests/single-note-app.test.js` (+4 checks: a printed score keeps its rests), the re-pinned hash (`tests/fixtures/g9e-refusals-strict.json`, sonatina/004 advanced).

**Rollback.** Revert the commit. Without reverting: `closeGaps: false` and `sourceGuard: false` in `repairSelection`'s options (the app passes neither); `orderedHands` is already off.


### Transcription rests at the source (2026-10-01)

Branch `g10-transcription-rests` from origin/main ab4191c (code = deploy a33074d). The teacher kept seeing tiny rests (32nd and 64th rests between notes, for example `[16th rest][32nd rest] F# eighth [32nd rest][16th rest]`) in the score of a YouTube transcription (Looping the Rooms, Onsets & Frames in the browser, 90 bars).

**Cause.** `audio-score.js` gives a recording's notes the lengths they were heard with, so every silence between two notes that was shorter than a 16th became a rest of its own, and a silence with such a sliver in it (a 16th plus a 32nd) was written as two rests. G9f's `closeSmallGaps` removed these only inside the one-note pipeline (`repairSelection`, gate: provenance `audio-score`), so nothing else was tidied: not the recognition review screen, not the saved transcription song, and not what any arranger starts from. The headless run of the user's exact flow (same saved audio, in-browser Onsets & Frames, 1226 notes) on origin/main: review screen and saved song 547 rests, of which 106 are 32nd and 74 are 64th; 180 of them are 32nd or 64th rests with a note of the same hand before and after them. (The Song Arranger at "original" makes the legacy `balanced piano arrangement`; that copy has no rest events at all, before or after this change, so it is not where the rests come from. Its input did change, see below.)

**Fix, at the source.** The pass moved out of `repair/index.js` into `scoregraph/gaps.js` (UMD: Node and a `<script>` after `ops.js`; `closeSmallGaps`, `isTranscription`, `plainValue`, `smallGaps`; the code is the G9f code, one function, not a copy; `repair/index.js` imports it and re-exports the same names, so the one-note pipeline is unchanged). `audio-score.js` runs it on the graph it builds (`toMusicXml`, before G3 and before the file is written: the graph and the MusicXML are the same score, with a `<forward>` where a rest is not drawn) when `opts.closeGaps` is true and the source kind is `audio-score` (a recording). The app asks for it at its four recording call sites (the recording import, `rewriteRhythm`, `rewriteFromHeard` and the review screen's arrangement, `applyRichReviewArrangement`; `PPPAudioScore.fromMidi` does not: a MIDI file is the player's own file). The rule, as in G9f: a gap of more than 0 and less than 1/16 of a whole note between a note and the next onset of the same staff lengthens the note before it (never shortened, onset and pitch never move, never over a barline or past the hand's next onset, a plain value of at most one dot is written as such, otherwise the note keeps the value it was written with), and a 32nd or 64th rest among the pieces of a longer silence that has a note after it is not drawn. One refinement: a silence at the end of a measure has a note after it when the hand has a note in a LATER measure, so its 32nd and 64th pieces are omitted too (G9f kept them; at the end of the hand's last measure with a note they are still kept). The G9f gate and the `closeGaps` options of `repairSelection` are unchanged.

- **Why opt-in in the library.** `closeGaps` defaults to false in `toMusicXml` (`CLOSE_GAPS_DEFAULT`, like `PROFESSIONAL_DEFAULT`): the 17 golden graphs (A40), the benchmark snapshots and the G3/G4 contracts on "the recording graphs" (one source, no per-entity provenance, committed layout hashes) are about the library's own output. The pass adds a source (`repair`, `ppp.g9f-gaps`) and `rhythm` provenance on the lengthened notes, as it already does in a one-note arrangement. With the default, `toMusicXml` is byte-identical to origin/main (checked on the real heard notes: xml and graph).
- **Idempotent, no double application.** A graph the pass has run on has no gap left: a second run returns the very same object. The G9f step in `repairSelection` runs the same function on the arrangement of a graph that already went through it and finds nothing to do (the arrangement copies the closed lengths); for a graph from a page without `gaps.js` (an old cached page) the app writes the score as before and `repair/index.js` degrades to no-ops (never a throw).
- **Sound.** A lengthened note rings at most 1/16 of a whole note less one grid step longer (the real piece: at most 5/96 whole = 0.08 s at its 162 bpm quarter; the mean of the 93 lengthened notes is 0.04 s) and always stops where the hand's next note starts; omitted rests change nothing. The page's player and the follow/practice gates read note onsets: a rest event is only a gate when it is drawn, and a silence with no rest glyph is a gap gate already (`followGates`), so a silence that lost a drawn sliver is one gate, not two (checked: Play runs from the saved transcription and after a reload, the beat advances; follow gates are built from onsets and the spans of sounding notes).

**Numbers, the user's piece in the real page** (`scratchpad/review-g9e5/flow-local.js` extended to `scratchpad/g10r/flow.js`; origin/main ab4191c against this change; the same 1226 notes both times):

| | before | after |
|---|---|---|
| rests in the review screen's Score and graph | 547 | 357 |
| 32nd / 64th rests | 106 / 74 | 0 / 0 |
| small rests with a note of the hand before and after | 180 | 0 |
| rest glyphs drawn in the saved song, 32nd/64th (DOM) | 180 | 0 |
| notes (Score) / drawn heads / player strikes | 1226 / 1226 / 1199 | 1226 / 1226 / 1199 |

The saved transcription after a page reload (graph from the store) is the same as the review screen. The same heard notes through the library on its own (graph level, 1214 notes, 900 note events, 1225 heads): rests 521 -> 360 (32nd 90 -> 0, 64th 64 -> 0), 93 notes lengthened and none shortened, 41 rests omitted in silences, every onset and pitch where it was, no note past its barline or the hand's next onset, no validator error, the MusicXML reads back as the same notes. Looked at: the first 4 systems of the saved song as the page draws it (no 32nd or 64th rest anywhere; notes that were followed by a sliver are dotted values now) and the engraver's render of the same graph before and after.

**What changed for the other copies.** The Song Arranger at "original" (the legacy copy, `arrange_score.py`): its input is now the closed score, and its output is 2243 -> 2241 notes (the arranger weighs note lengths; 0.09 %), no rest events in either. At "intermediate" (one note per hand): 1906 notes, no small rest between notes (the G9f result), the same rest counts as before.

**Identity.** All 975 requests (325 catalogue pieces x 3 levels, `arrangeSingleNote` through the app's own glue) against a clean `git archive` of origin/main ab4191c: 933 identical results and 42 identical refusals, 0 changed (no catalogue piece is a recording, and the pass is not part of any import). The legacy golden of `tests/single-note-app.test.js` (21 legacy-mode arrangements, Song Arranger and review screen) still holds; its review screen heard notes are a recording (a hymn with every note held 95 %), so that identity run switches the closing off in the page (`closeGaps: false` wrapper) and the closing has its own section.

**Limits.** (a) A song transcribed before this change keeps the rests it was saved with (its Score and its kept graph are what they were); re-running the rhythm (`Rewrite the rhythm`) or transcribing again writes the clean score. (b) A MIDI file is not closed (a played MIDI has the same slivers; it is the player's file and was left alone). (c) A 32nd rest at the end of the hand's last measure with a note, and a silence of a 16th or more tiled by rests that are all 16th or longer, stay as before. (d) A lengthened note whose new length is not a plain value keeps the value it was written with while its exact length is longer (`W-DISPLAY-DURATION`, 143 -> 150 on the real piece), as in G9f; the holes where a rest is not drawn show as `I-VOICE-GAP` infos (34).

**Tests.** `tests/repair/g10r-transcription-rests.test.js` (9: seeded recording, no 32nd/64th rest, same notes and none shortened, idempotence and the one function, library default off and a MIDI source untouched, nothing else moved and the performance layer byte-equal, the sound bound, the page's own scripts in a bare context writing the same file and degrading without `gaps.js`, a printed score untouched, the end-of-measure omission, the app asks at its four call sites), `tests/single-note-app.test.js` (a new section: "Rewrite the rhythm" of injected heard notes gives a Score, graph and DOM with no 32nd/64th rest, the same notes none shorter, the same strikes; the unclosed control has them), `tests/scoregraph/browser-load.test.js` (`gaps` in the script order). Runs on this change: new tests 9/9, `test:repair` 61/61, `test:realize` 181/181, `test:critics` 97/97, `test:review` 89/89, `test:arrangement-planner` 17/17, `test:playability` 57/57 (includes `audio-score-termination`), `test:songgraph` 45/45, `test:difficulty` 34/34, `tests/single-note-app.test.js` 130 checks, all passed; library, interactions, import-and-persistence, i18n-and-auth, midi, musicxml, import, playback-scheduler, follow, falling-notes, engraving, alignment pass (served tree); `test:scoregraph` 215/216 and `test:engrave` 200/201, the two failures (A44 `server.test.js` expects `audio-score.js` right after `fingering.js` in the script list; A27 committed layout hashes of the catalogue hymns) fail the same way on an untouched origin/main extract. `tests/transcription.test.js` needs the local helper and was not run.

**Rollback.** Revert the commit. Without reverting: the app's four `closeGaps: true` options are the only switch; removing them restores origin/main's transcription output exactly (the library default is off).

### Consecutive rests (2026-10-02)

Branch `rests-merge` from origin/main 64bd9a4 (production runs 646e12a). The teacher's screenshots of their one-note-per-hand copy of "Looping the Rooms" (level intermediate) showed, after the gap fixes, two small dotted rests in a row before a quarter note (bar 17, right hand), a dotted small rest inside a beamed 16th group (bar 16) and a quarter-rest glyph between eighth notes (bar 12).

**Cause.** `audio-score.js` writes a silence one piece at a time (`pieces()`: each piece is the longest value that fits, nothing crosses a beat line unless it starts on one; a 3-tick piece is a 32nd, a 9-tick piece a dotted 16th, a 4-tick one a triplet 16th), and the one-note arrangement (`realize`) copies those gaps and writes its own, so one silence becomes two events, and a silence that starts on an odd 32nd comes out as a *dotted 16th rest*. `closeSmallGaps` (G9f / "Transcription rests at the source") only removes 32nd/64th pieces; it never looked at rests that follow each other. On the user's flow (same saved audio, in-browser Onsets & Frames, 1226 notes) on origin/main: the saved transcription had 357 rests, 33 of them dotted 16th rests, and 38 runs of rests that are not in the standard tiling; the one-note copy 197 rests, 20 dotted 16th rests and 22 such runs. The bar-17 pattern of the user's score is `dotted 16th (3/32) + a 1/24 triplet 16th`: a note that ended on a triplet position and the next note on a straight one (the quantiser's mixed grids), so no standard tiling of that silence exists. (My headless run of the same flow does not reproduce bars 12/16/17 note for note: the in-browser model is not deterministic across machines; it reproduces the same kinds of rests, see the numbers.) The quarter-rest glyph of bar 12 is *not* a merge defect: it is the second half of a triplet pair (an eighth and a quarter on a triplet beat, 1/3 + 2/3 of a beat): a triplet silence, which stays (see Limits).

**Fix.** `scoregraph/gaps.js` has a second pass, `mergeRests(graph)` (and `tidyRests` = `closeSmallGaps` then `mergeRests`). Per voice and measure, a run is rests that follow each other with nothing between them (a lone whole-bar rest, a rest a spanner or direction refers to, a pickup or additive-metre measure: not touched). Its silence [a, b) is written again:

1. a and b on the 32nd grid: the tiling with the fewest pieces (then the fewest dots, then the longer value first) of values that start on a multiple of their own length and do not cross a beat line unless they start on a beat (a dotted eighth may also end on a beat); whole, dotted half, half, dotted quarter, quarter, dotted eighth, eighth, 16th, 32nd; no dotted rest shorter than a dotted eighth (3/32 + 3/32 = one dotted eighth rest; a lone dotted 16th rest = a 16th rest, the 32nd left over is not drawn when a note follows, kept at the end of the hand's last note bar, as `closeSmallGaps` does). Beats 2-3 of 3/4 are two quarter rests, not a dotted quarter and an eighth; a 6/8 beat is a dotted quarter; a bar of several rests is one measure rest.
2. a or b off the 32nd grid: one rest from the start, written as the longest plain value (a 16th or longer, a dotted one a dotted eighth or longer) not longer than the silence when the silence is less than a 16th longer than it (the user's bar 17: 3/32 + 1/24 = 13/96 becomes an eighth rest, the 1/96 left over is a hole, an `I-VOICE-GAP` info), and no beat line lies inside it unless it starts on a beat. A tuplet silence (a quarter rest and a triplet eighth rest) stays; its leading pieces that end on the 32nd grid are written by rule 1.

No note, onset, length, written value or pitch changes (only rest events: ids are reused, extra ones removed or added, `rhythm` provenance, source `ppp.consecutive-rests`). Idempotent (the same graph object comes back), never a throw. **Gate**: exactly `closeSmallGaps`: `audio-score.js` with `opts.closeGaps` (the app's four recording call sites; the library default stays off, a MIDI file is never touched; the report is `restReport`) and `repair/index.js`'s transcription gate (`closeGaps` auto: provenance `audio-score`; `report.mergedRests`). A page with an older `gaps.js` has no `mergeRests`/`tidyRests` and writes the score as before. Cache versions bumped (`gaps.js?v=2`, `audio-score.js?v=11`, the option scripts `?v=2`).

**Numbers, the user's flow in the real page** (`scratchpad/rests2/flow.js`: serves a tree, answers `/api/youtube-audio` with the saved audio, runs the in-browser Onsets & Frames, Accept, Song Arranger intermediate, opens the copy, reloads; origin/main 64bd9a4 against this change, the same 1226 heard notes both times):

| | before | after |
|---|---|---|
| saved transcription: rests / dotted 16th rests / runs not in the standard tiling | 357 / 33 / 38 | 337 / 0 / 0 |
| one-note copy (and after reload): rests / dotted 16th rests / runs not in the standard tiling | 197 / 20 / 22 | 186 / 0 / 0 |
| copy: adjacent rest pairs (all that remain are standard tilings: half + eighth, quarter + 16th, dotted eighth + dotted eighth ...) | 25 | 15 |
| notes (Score) / note events in the graph / strikes: transcription | 1226 / 906 / 1199 | the same |
| notes: copy | 1906 / 1906 / 1900 | the same, every note identical (onset, length, value, pitch) |
| rest glyph groups drawn in the copy (DOM = graph) | 197 | 186 |
| graph errors | 0 | 0 |

(An adjacent pair is not a defect when it is the standard tiling of the silence: 2.5 beats are a half rest and an eighth rest, and no single rest can write them, so "no consecutive rests" is measured as "no run of rests that is not in the standard tiling" (`gaps.restRuns`), 0 after.) Looked at: bars 36-41 and 44-46 of the copy before and after, and 12-17 (`scratchpad/rests2/crop-*.png`): the dotted-16th-plus-16th pairs (bars 37, 39, 41, 46) are single eighth or 16th rests, a dotted 16th rest inside a 16th group (bars 4, 6, 29) is a 16th rest, the triplet bars are as they were.

**Identity.** All 975 requests (325 catalogue pieces x 3 levels, `arrangeSingleNote` through the app's own glue) against a clean `git archive` of origin/main 64bd9a4, run twice (before and after the last edit of `gaps.js`): 933 identical results and 42 identical refusals (same reasons), 0 changed: no catalogue piece is a recording, so the gate keeps them out. The legacy identity golden of `tests/single-note-app.test.js` still holds (its review screen wraps `toMusicXml` with `closeGaps: false`).

**Limits.** (a) A song transcribed before this change keeps its rests (as G10r). (b) The silence between a triplet position and a straight one that crosses a beat line from an off-beat start has no single rest: the dotted 16th piece before it becomes a 16th, the triplet rest stays. (c) Triplet pairs (an eighth and a quarter rest on a triplet beat, the user's bar 12) are still drawn without a bracket: that is the tuplet display of the transcription, not a rest merge; left as it is. (d) The remainder of a silence (a 32nd at either end, or what is under a 16th after a mixed-grid rest) is a hole, as in G10r: `I-VOICE-GAP` infos 34 -> 48 in the saved transcription and 20 -> 28 in the copy; no warning is added (`W-DISPLAY-DURATION` 189 -> 185 and 224 -> 222, `W-TUPLET-INCOMPLETE` 255 as before).

**Tests.** `tests/repair/consecutive-rests.test.js` (11: 3/32 + 3/32 = a dotted eighth rest, a lone dotted 16th rest, an odd-32nd start, a property test over every silence [a, b) of a 4/4 bar written as one piece and as 32nd pieces (900+ cases: tiling, alignment, beat lines, no small dotted rest, notes unchanged, idempotent), the mixed-grid case of the user's bar 17, a tuplet silence and a whole-bar rest untouched, rests in a tuplet spanner untouched, two voices, 3/4 and 6/8, a clean graph returned as the same object, garbage never throws, a seeded recording through `toMusicXml` (library default byte-equal, MIDI untouched, no non-standard run), the `repairSelection` gate, the page's own scripts in a bare context and an older `gaps.js`); `tests/single-note-app.test.js` (a new section, 9 checks: the review screen's "Rewrite the rhythm", the saved transcription after Accept and the Song Arranger's one-note copy of it have no run of rests that is not in the standard tiling and no dotted 16th/32nd/64th rest in the graph or the DOM, the same notes; the control has them). Runs: new tests 11/11, `test:repair` 72/72, `test:critics` 97/97, `test:review` 89/89, `test:realize` 181/181 (its 200 ms performance test fails once when eight other node processes share the machine, passes alone), `tests/single-note-app.test.js` 140 checks all passed, `tests/library.test.js`, `tests/interactions.test.js`, `tests/import-and-persistence.test.js` and `tests/scoregraph/browser-load.test.js` (3/3) pass on a served tree.

**Independent review fixes (same day).** The review of the first commit found one major and three minor defects, all fixed:
- *A 16th silence could disappear* (major): a 16th rest that starts on an odd 32nd (a note ends at an odd 32nd, the next starts a 16th later) was tiled as two 32nd pieces that were both left out as holes (the teacher's bar 47 shape; about 1000 of 15000 random pure-grid cases). Only a remainder shorter than a 16th is a hole now: a silence of a 16th or more always keeps a rest, one plain 16th rest from its start (across a beat line it stays the two 32nd rests); the test that hard-coded "both left out" is corrected.
- *Not a fixed point*: `mergeRests` now runs to a fixed point (a silence written once can leave a neighbour that is now a run of its own: the pieces before a triplet rest are split off and the remainder is its own run; the mixed-grid rest that starts on the 32nd grid is written by the straight tiler so that a second run finds it as it is), and `tidyRests` runs the closing and the merging together to a fixed point (a hole the merging leaves could let the second `closeSmallGaps` lengthen a note by up to 1/32). `repairSelection` calls `tidyRests`. Seeded fuzz of 4/4 and 6/8 bars (pure grid and with triplet positions, 8000 per seed, 4 seeds): no case where `mergeRests` or `tidyRests` is not a fixed point, a note moves or shortens, a silence of a 16th or more vanishes, or a half rest starts off beat 1/3; 40 synthetic recordings through `toMusicXml(closeGaps: true)` are fixed points.
- *A half rest could start on beat 2* in the mixed-grid fallback, and a dotted rest from beat 2 could cross the middle of 4/4: in 4/4 nothing that starts after beat 1 crosses the middle of the bar (beats 2-4 are a quarter rest and a half rest), in the tiler and in the mixed-grid rest. A lone dotted 16th rest on a triplet position is a 16th rest too.
- *A reused rest id lost the other fields of its `display`* (a written position): they are kept.
Numbers after the fixes, the user's flow in the real page (same 1226 heard notes): saved transcription 357 -> 343 rests (a few more than the first version because nothing vanishes any more), dotted 16th rests 33 -> 0, runs not in the standard tiling 38 -> 0; one-note copy 197 -> 188 rests, dotted 16th rests 20 -> 0, runs 22 -> 0, adjacent pairs 25 -> 16 (all standard tilings); notes identical (906 and 1906 note events, 1226 Score notes), both graphs fixed points of `tidyRests`, 0 graph errors, `I-VOICE-GAP` 34 -> 47 and 20 -> 28. On the teacher's shared score (the page's graph with this `gaps.js` injected, `scratchpad/userscore/tidy-user.js`): bar 16 is one plain 16th rest, bar 17 one eighth rest, bar 47 keeps its 16th rest, rest runs 21 -> 0, dotted 16th rests 19 -> 0, 194 -> 185 rests, all 1896 non-rest events byte-identical, a second run returns the same graph. Catalogue identity again: 975 requests, 933 identical, 42 identical refusals, 0 changed. Tests: `tests/repair/consecutive-rests.test.js` 16/16 (new: bar 47, half rest and middle of the bar, display fields kept, fixed-point fuzz, recordings, arrangement), `test:repair` 77/77, `test:realize` 181/181, `test:critics` 97/97, `test:review` 89/89, `tests/single-note-app.test.js` 140 checks, library, interactions, import-and-persistence, `browser-load` 3/3.

**Rollback.** Revert the commit. Without reverting: remove the `tidyRests` call in `audio-score.js` and the `mergeRests` call in `repair/index.js`.

### Left-hand run rests (2026-10-02)

Branch `rests-lh-fill` from origin/main 79dc80a (production). The teacher's latest copy of their YouTube transcription (share `q-6QcTI4Y_md`) is clean of tiny, dotted and consecutive rests, but its LEFT hand, one continuous run of 16th notes, has five lone 16th rests inside it: bar 2 at beat 3.25 and 3.75, bar 4 at 1.5, bar 34 at 3.25 and bar 37 at 1.25 (0-based quarter positions, as the Score's `b`; bar 2 reads `N2.25 N2.5 N2.75 N3.0 R3.25 N3.5 R3.75`). Drawn between the 16ths of an arpeggio a 16th rest looks like a broken pattern. The teacher's decision (explicit): **delete the rest and extend the previous note**.

**Fix.** `scoregraph/gaps.js` has a third pass, `fillRunRests(graph)`, run by `tidyRests` (closing, merging, filling, to a fixed point) and so by the same callers and the same gate as the other two (`audio-score.js` with `opts.closeGaps`, `repair/index.js` for a transcription; a printed score, a catalogue piece and a MIDI source never reach it). For the LEFT-HAND staff only (a staff whose `limb` is `LH`; a part with no limb on any staff and exactly two staves: the lower one) a rest is removed and the note before it becomes an eighth when ALL hold:

- the rest is exactly one plain 16th (1/16, not dotted, not in a tuplet, not a measure rest, not hidden), and only a beam refers to it;
- one note ends exactly where the rest starts, in the same measure, staff and voice: a plain 16th (1/16, not dotted, not in a tuplet), a single head (not a chord), not a grace note, not tied to or from anything, nothing else (a spanner, a direction) refers to it;
- a note of the same staff and voice starts exactly where the rest ends (when the rest ends the bar: the first note of the next bar; the hand's last bar, or a next bar that opens with a rest, keeps the rest);
- nothing else of the voice lies in the rest's span, and no other note of the staff (another voice) starts inside it.

The note keeps its onset and pitch; length 1/16 -> 1/8 and written value 16th -> eighth (the other fields of its display stay), `rhythm` provenance, source `ppp.run-rests`. **Sound**: the note rings exactly 1/16 of a whole note longer (a quarter of a beat in 4/4), where the silence was, and stops where the next note of the hand starts (never past the next onset, never across a barline; the pedal as it was). The right hand's rests (the melody's, meaningful) and every other length (eighth, 32nd, dotted 16th) are never touched. A beam over the run keeps its notes (the removed rest leaves it). Idempotent (the same graph object comes back), never a throw. `tidyRests` also returns `fill: {fills, notesLengthened, restsRemoved, skipped}`.

**Numbers.**

1. The teacher's real score (`scratchpad/userscore/tidy-lh.js`: the worktree's `gaps.js` injected into the production page on the share, `tidyRests` on the graph the page resolves): exactly the five rests vanish (`2@13/16, 2@15/16, 4@3/8, 34@13/16, 37@5/16`), the note before each is an eighth (`2@3/4, 2@7/8, 4@5/16, 34@3/4, 37@1/4`), 185 -> 180 rests, 1896 note events unchanged except those five durations and written values, validation issues identical (0 errors; the same warnings and infos), the earlier two passes change nothing on this score.
2. The user's flow in the real page (`scratchpad/review-rests3/flow.js`: serves a tree, answers `/api/youtube-audio` with the saved audio, in-browser Onsets & Frames, Accept, Song Arranger intermediate/balanced, opens the saved copy; origin/main 79dc80a against this change, the same 1226 heard notes):

| | before | after |
|---|---|---|
| saved one-note copy: lone LH 16th rests between two notes (Score = graph = DOM) | 5 (bars 2, 2, 4, 34, 37: the teacher's five) | **0** |
| saved one-note copy: rests drawn | 188 | 183 (the right hand's 183 untouched) |
| saved transcription: rests drawn | 343 | 332 |
| saved transcription: LH 16th rests / lone between two notes | 38 / 23 | 27 / 12 |
| saved transcription: note events, onsets, pitches | 1226 | the same; 11 durations 1/16 -> 1/8 (bars 2, 7, 8, 9, 30, 34, 47, 83, 84, 85, 86) |
| graph errors (transcription, copy) | 0, 0 | 0, 0 |

The 12 lone LH rests that remain in the saved transcription are all outside the rule on purpose: 7 follow a chord (two heads), 2 a 32nd, 3 a dotted note (a dotted 16th or a dotted eighth). **The copy is not note-identical to before: bars 85-88 of its left hand are a different arpeggio** (50 notes differ in pitch, not in onset). The arranger is fed the transcription, and four notes of bars 83-86 of the transcription are now eighths: the realizer's chord choice there changes (bar 85: `G2 B2 F3 B2 | G2 C3 Ab3 C3 | ...` before, `G2 B2 F3 B2 | Ab2 D3 F3 D3 | ...` after; the transcription's own left hand in those bars is eighth notes, so both are inventions of the arranger). Every other note of the copy is identical to before except the five lengthened ones (bars 2, 2, 4, 34, 37). Looked at: bars 2 and 4 (and 34, 37) of the copy before and after, `scratchpad/review-rests3/before4-onenote-m*.png` / `after4-onenote-m*.png`: before, a note, a 16th rest, a note, a 16th rest ending the bar; after, two beamed eighths.

**Identity.** All 975 requests (325 catalogue pieces x 3 levels, `arrangeSingleNote` through the app's own glue, `scratchpad/review-rests3/ident-mine.js`) against a clean `git archive` of origin/main 79dc80a: 933 identical results and 42 identical refusals (same reasons), 0 changed. No catalogue piece is a recording, so the gate keeps them out. The legacy identity fixture in `tests/single-note-app.test.js` passes.

**Tests.** `tests/repair/lh-run-rests.test.js` (10): the teacher's five rests in a 40-bar run (shape, onsets and pitches, bar end, validation), the right hand untouched, which staff is the left hand, other lengths and other preceding notes untouched (dotted 16th / eighth / 32nd rest; eighth / dotted / 32nd note before; no note before; two rests in a row), tied / chord / tuplet / grace / other voice untouched, the end of the hand's last bar and a next bar that opens with a rest, a note of another voice that starts inside the span, a seeded fuzz (idempotent, fixed point with closeSmallGaps and mergeRests, onsets and pitches never move, valid), composing with the closing, a seeded recording through `audio-score` (clean with `closeGaps`, unchanged without, a MIDI source untouched, the right hand's rests untouched), the pipeline gate. `tests/single-note-app.test.js`: a new section runs a seeded left-hand 16th run with dropped notes through "Rewrite the rhythm", Accept and the Song Arranger's copy (Score, graph and DOM have no lone LH 16th rest, notes as before, right-hand rests as before, valid graph; the control has them). Run: the new file 10/10, `test:repair` 87/87, `test:realize` 181/181, `test:critics` 97/97, `test:review` 89/89, `tests/single-note-app.test.js` 147 checks (140 + 7 new), library, interactions (52 checks), import-and-persistence, `browser-load` 3/3, all green.

**Limits.** (a) A song transcribed before this change keeps its rests (as G10r). (b) The rule is the teacher's for a left-hand 16th run only: a rest after a chord, a dotted note or a 32nd stays. (c) The pass changes the transcription the arranger is fed (above), so a copy made from a transcription made after this change can differ in the arranger's own inventions from one made before; to keep the arranger's input exactly as before, `audio-score.js` can skip the fill and only the arrangement step (`repair/index.js`) run it (not done: the teacher also looks at the saved transcription).

**Rollback.** Revert the commit. Without reverting: remove `fillRunRests` from the loop in `tidyRests` (the other two passes do not depend on it).

### Recording notation: tuplets and the grid (2026-10-02)

Branch `rec-tuplets` from origin/main c6e357b (production). The teacher's YouTube-piano-transcription copy of "Looping the Rooms" (90 bars, 162 bpm, 4/4, the one-note copy) did not add up as drawn: 59 of 90 right-hand bars showed more or less than 4/4 (bar 12 six beats, bar 6 five and a half), only 28 were right; the left hand was clean.

**Causes.** (a) The piece has a triplet feel and the drawn score has no tuplet: a third of a beat is an eighth and two thirds a quarter, drawn plain (`W-DISPLAY-DURATION`), a rest inside a triplet is printed with its plain value and gets no bracket; `audio-score.js` wrote only one-note tuplets (one "3" over every note that lasts exactly a third, 213 brackets on the real piece), `realize/index.js` copies events but only ties, so the one-note arrangement had none. (b) The quantiser leaves onsets and releases on three lattices (16th grid 6 ticks, a 32nd lattice 3, triplet thirds 8; a tick is 1/96 of a whole note): 38 bars had values no plain written value expresses (a G3 at 3.625 beats lasting 3/8 of a beat), pieces such as 9+6 or a 1-tick remainder. (c) The earlier gaps passes (`gaps.js`) leave a hole where they omit a 32nd/64th rest, so those bars did not add up either (40 holes of an eighth of a beat).

**Fix, step A: tuplets** (`scoregraph/rec-tuplet.js`, UMD like `gaps.js`; `addTriplets(graph)`). Per voice and measure of a simple-time bar with a quarter-note beat, for each beat whose events (notes, chords and rests; they must START in the beat) tile it exactly with thirds and two-thirds of the beat, printed as the value that is 3:2 of their length (eighth / quarter), at least two of them: ONE 3:2 tuplet spanner in unit eighth over those events, rests included. Nothing else changes (no onset, length, value). A one-note tuplet of the old writer inside such a beat is replaced (no event is in two tuplets); another tuplet (imported, another ratio, nested) is kept and its beat left alone. Idempotent (the same graph object comes back), never a throw. Gate: a recording only: `audio-score.js` with the new option `opts.exactBars` (the app passes it, with `closeGaps`, at its four recording call sites; off by default for the same reason `closeGaps` is: goldens, benchmark snapshots, G3/G4 contracts; a MIDI file and a compound metre are not touched) and `repair/index.js` on the arrangement of a transcription (`repairSelection`, the `closeGaps` 'auto' gate; `report.tuplets`): the realizer's copy drops the tuplets, so they are written again on the finished arrangement. The pass runs BEFORE `tidyRests`: `mergeRests` never touches a rest a tuplet holds, so a quarter rest and the triplet rest after it are not turned into a dotted rest with a hole.

**Fix, step B: the grid** (`audio-score.js`, `opts.exactBars`, simple time with a quarter beat). Every onset and release is put on one grid per beat: a triplet beat (an onset 8 or 16 ticks into it): the thirds; any other beat: the 16th grid. An onset on the 32nd lattice moves to the 16th-grid point beside it, the one nearer its measured time (3 ticks = 1/32 of a whole note at most), unless another onset sits there; then it stays when every hand that plays it also played a note a 32nd before (a genuine 32nd run, which keeps its lattice and still adds up), else it goes to the nearer point (two notes of a hand that meet are one chord, and a pitch the chord already holds is never given up). A release is the grid point nearest the heard one where a length that needs a tie costs `CHAIN_COST` (13 ticks, 3 for a note that starts on a third of a triplet beat, which can reach no single value but the beat's end, so it keeps its heard length through the next beat as a tie); no silence is shorter than a 16th and none starts on an odd 32nd (the note before rings up to the next 16th-grid point or the next onset). Pieces: a triplet beat's part of a note or rest is 8 or 16 ticks, the rest the ordinary pieces; silences are written with `gaps.js`'s standard tiling (`tile`, the one `mergeRests` writes), so the gaps passes find nothing to close, omit or retile (on the real piece: 0 gaps, 0 omitted, 0 rest runs; `fillRunRests` still fills the teacher's lone left-hand 16th rests). `gaps.js` itself is unchanged: a graph saved before this change keeps its behaviour.

**Numbers, the teacher's piece in the real page** (`scratchpad/rt/flow3.js`: serves a tree, answers `/api/youtube-audio` with the saved audio, in-browser Onsets & Frames (1214 heard notes, byte-identical in both runs), review screen, Accept, Song Arranger Create at intermediate and at original, each saved song opened on the Practice screen, Play, reload and open again; clean `git archive` of origin/main c6e357b against this branch). The metric (`scratchpad/rt/scoremetric.js`, on the page's own Score): per hand, voice and bar, the drawn values (type and dots times the 2/3 of a tuplet) sum to the bar, each event starts where the ones before end and lasts what it is drawn as ("fully correct"; "adds up" is the sum alone).

| | before | after |
|---|---|---|
| saved transcription (= review screen): right-hand bars fully correct (adds up) | 32 (32) of 90 | **90 (90)** |
| saved transcription: left-hand bars fully correct (adds up) | 35 (37) of 90 | **90 (90)** |
| one-note copy (intermediate), and after a reload: right hand | 28 (31) of 90 | **90 (90)** |
| one-note copy: left hand | 90 | 90 |
| tuplet brackets drawn (DOM): transcription / copy | 205 one-note brackets / 0 | 149 beat brackets / 80 |
| rests: transcription / copy | 325 / 180 | 348 / 197 (of which in a tuplet: 82 / 48) |
| `W-DISPLAY-DURATION`: transcription / copy | 145 / 187 | 0 / 0 |
| `W-TUPLET-INCOMPLETE`: transcription | 213 | 0 |
| graph errors | 0 | 0 |
| heard notes written (attacks, Score) / strikes of the player | 1214 / 1214 | 1214 / 1214 |
| copy: attacks | 1892 | 1894 (the arranger chooses on other onsets) |

(Right-hand fully correct before, by the investigator's graph metric: 28 of 90, the same number.) Rests of the transcription by value before: 6 dotted half, 44 dotted eighth, 103 eighth, 58 quarter, 98 16th, 9 dotted quarter, 5 half, 2 whole; after: 6, 50, 52 eighth + 53 eighth in a tuplet, 40 quarter + 29 quarter in a tuplet, 104 16th, 7, 5, 2. Tied pieces: 11 -> 33 continuations (a heard note that crosses a beat from a triplet position is a tie of a triplet piece and a plain one, 4 -> 10 tie spanners in the copy).

*Shifts.* Onsets: 133 of the 1214 heard notes (87 of 647 distinct onsets) moved, every one by exactly 3 ticks: **maximum 46.3 ms, mean 46.3 ms over the moved notes, 5.1 ms over all notes** (at 162 bpm a tick is 15.4 ms); none by more, none lost, no note passed another (0 order violations), no voice overlaps itself. Releases (sounding lengths): 1025 of 1214 identical, 189 differ (mean 61 ms over those, a handful above 120 ms and the largest 247 ms: where the old pipeline wrote a length off every lattice, 20 or 29 ticks, and the new one writes the grid length; without the tie cost 27 notes ended more than 6 ticks further from the heard length than before, with it 7, four of them isolated 64th-length notes that the sub-16th rule lengthens to the next onset).

*Looked at* (`scratchpad/rt/png/`: `before-arr-bars{4-6,12-17,20-24}-sys*.png` / `after2-arr-...`, the same for `trans` and `orig`, `before-review.png` / `after2-review.png`; also the engraver's own render of bars 4-6 and 12-17 in `arrB-sys*.png`): bar 12 is `eighth rest + quarter` and `eighth + quarter` under a bracket "3" each, bars 4-6 read `quarter, dotted eighth, 16th rest, ...` with brackets over the rest-plus-quarter and eighth-plus-rest beats, beams and rest heights are the engraver's own and look right, 8va lines are as before. The one-note-per-hand copy of the page has the brackets drawn like the transcription's.

*The 'original' level copy* (Song Arranger at original = the legacy engine, `ScoreArranger` / `arrange_score.py`) is rebuilt note by note by that engine, which deletes tie and tuplet marks (`cleanCopied`, `_finalize_notes`), writes its own types and has no rest events at all: before and after it has no bracket and no rests, so bars cannot add up there (2 of 90 before, 3 after). Its input is on the grid now (`W-DISPLAY-DURATION` 286 -> 243, `W-TUPLET-INCOMPLETE` 117 -> 106; 1214 attacks, played and followed as before). Not changed (the legacy engine is the standard arrangement of printed scores too).

*Playback and practice.* The player's strikes are the heard notes both ways (1214 transcription; the copy's 1894). Play on the saved transcription, the copy, the original copy and the copy after a reload: the beat advances (checked). The follow gates, built from onsets and the spans of sounding notes: 865 -> 850 on the transcription (distinct onsets 651 -> 652; the snap merges gates that were a 32nd apart), 1590 -> 1532 on the copy; `tests/follow.test.js` (Follow mode waits, advances on the right notes) passes on this tree. After a reload the transcription comes from the store with its kept graph (identical to the live one: no warning); the copy comes back projected from its Score, as before this change, which has no tuplet unit: 80 brackets drawn, `W-TUPLET-INCOMPLETE` 37 (information; before: `W-DISPLAY-DURATION` 187).

**Identity.** All 975 requests (325 catalogue pieces x 3 levels, `arrangeSingleNote` through the app's own glue) against a clean `git archive` of c6e357b: 933 identical results and 42 identical refusals (same reasons), 0 changed (no catalogue piece is a recording; the gate keeps them out). The legacy identity fixture of `tests/single-note-app.test.js` (21 legacy-mode arrangements) holds (its wrapper switches `exactBars` off with `closeGaps`). The printed pieces' layout hashes (`A27`) are not touched: that test fails the same way on an untouched c6e357b extract (byte-identical failure output), as does `A44` of `server.test.js`.

**Tests.** `tests/repair/rec-tuplets.test.js` (13: the rule, mixed and rest-containing beats, chords and 3/4, what is left alone, idempotence and the replaced one-note tuplets, other tuplets kept, compound metre untouched, never a throw, a synthetic recording through `exactBars`, the one-note pipeline gate with a recording and a printed score, the page's scripts in a bare context and an older page, the four call sites), `tests/repair/rec-grid.test.js` (9: a property test over 60 seeded recordings, tempi 60-170, jitter, triplets, rests, chords, 32nd runs: every voice of every bar adds up, valid, no unlinked heard note; fixed point of `tidyRests`, `closeSmallGaps`, `mergeRests` and the tuplet pass in either order; nothing for the gaps pass to do; onset shift <= 3 ticks, order kept, no overlap; a genuine 32nd run; default off, MIDI and compound untouched; the MusicXML reads back; a symbolic grid input with bar-crossing notes; 2/4, 3/4, 5/4), `tests/repair/rec-teacher.test.js` (the real heard notes: 113-115 of 180 voice-bars did not add up, none now with and without the review lock; the arrangement adds up and keeps the brackets), `tests/single-note-app.test.js` (a new section: a seeded triplet piece through "Rewrite the rhythm", Accept and the Song Arranger copy: every voice-bar adds up as the Score draws it, brackets in the Score and DOM, no `W-DISPLAY-DURATION`, a strike per heard note; the control has bars that do not add up; the G10r check now allows the 1/32 snap), `tests/scoregraph/browser-load.test.js` (`rec-tuplet` in the script order). Runs: `test:repair` 111/111, `test:realize` 181/181, `test:critics` 97/97, `test:review` 89/89, `test:playability` 57/57 (audio-score termination), `test:scoregraph` 215/216 (A44, as on c6e357b), `test:engrave` 200/201 (A27, as on c6e357b), `tests/single-note-app.test.js` 154 checks all passed, library, interactions (52), import-and-persistence, midi, musicxml, import, follow, playback-scheduler, falling-notes, alignment, engraving pass on a served tree, `browser-load` 3/3. `tests/transcription.test.js` needs the local helper and was not run; `server.js` is unchanged (guest-share suites not run).

**Cache versions.** `audio-score.js?v=12`, new `scoregraph/rec-tuplet.js?v=1` (after `gaps.js`), the option scripts (`repair/index.js` among them) `?v=3`.

**Limits.** (a) A song transcribed before this change keeps what it was saved with (as G10r); re-running the rhythm or transcribing again writes exact bars; its arrangement still gets the brackets (the pass is part of the arrangement) but not the grid. (b) Only a simple-time bar with a quarter-note beat: 6/8, 12/8 and other metres are written as before. (c) Every bar of this piece adds up; a beat that is neither straight nor a third-and-two-thirds tiling (a triplet 16th run, a quintuplet) is not written as a tuplet, and the grid cannot express it either: it is moved to the grid (not on this piece). (d) A genuine 32nd run is kept only where every hand that plays it was already playing a 32nd before; any other 32nd-lattice onset goes to the 16th grid, and two notes of a hand that meet there become one chord (1 such onset, and 1 run kept, on the lock build of the real piece). (e) A heard release is moved to the grid (see above): ends differ on 189 of 1214 notes, mostly by one tick (15 ms), at most 247 ms. (f) The legacy 'original' copy has no rests and no brackets, as before (above). (g) After a reload the copy's projected graph warns `W-TUPLET-INCOMPLETE` (no tuplet unit in the Score), drawing unaffected.

**Rollback.** Revert the commits. Without reverting: remove `exactBars: true` from the app's four `toMusicXml` calls (the library default is off) and the `RECTUP` call in `repair/index.js`.
