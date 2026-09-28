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

(Grows here as G9a lands.)
