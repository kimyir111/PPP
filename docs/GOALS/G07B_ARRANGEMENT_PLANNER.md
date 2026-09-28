# G07b — Arrangement Planner

## 0. Status

Architect 2026-09-28 (Lead). Depends on G7a (SongGraph core, merged `bbadfd6`), G5 (playability, deployed), G6
(difficulty, deployed). Full roadmap entry: `docs/PPP_MASTER_ROADMAP.md` §5.5. This doc covers G7b only. G8
(arrangement realization — actually writing notes from a plan) is a separate, later Goal; this phase produces a
**plan**, never notes.

## 1. Goal

Given a piece's SongGraph (G7a) and a target (level, style, hand profile, which sections to include, key), find
an `ArrangementPlan`: per-section decisions about melody placement/register, texture class, density and
difficulty budget, and voicing constraints — found by deterministic search under G5's playability constraints
and G6's difficulty budget, with a human-readable explanation for each decision. **This does not write a single
note.** G8 later realizes a plan into an actual ScoreGraph.

## 2. Non-goals

- No note generation (G8).
- No audio (G10).
- No LLM (AI-2 is G7a's own evidence-gated fallback if its accuracy gate failed — it didn't, per G7a's real
  99%/100%/89% numbers against hymn SATB — G7b has no LLM component at all per the roadmap).
- No UI beyond a debug view.
- No human review scheduled for this phase (the roadmap defers judgment to G8/G9's output — a bad plan would
  surface as a visibly bad realized arrangement later, not here).

## 3. A real open question this doc does not resolve — the implementer must

**G0 Step 14's arrangement-invariant metrics are note-level, not plan-level**, and G7b produces no notes. The
real (previously never-implemented) metric list, corrected during G7a's own research (see
`docs/GOALS/G07_SONGGRAPH_CORE.md` §4, "G0 Step 14" — do not use the roadmap's own paraphrase, which doesn't
match): `arr.invented_pitches=0`, `arr.max_notes_per_attack≤cap`, `arr.metre_preserved`, `arr.tempo_preserved`,
`arr.melody_retention`, `arr.bass_retention`, `arr.density_ratio`, `read.over_span_rate`, `read.max_chord_size`,
`arr.no_invented_legato`. Every one of these needs actual notes to compute (you cannot measure "invented
pitches" or "max notes per attack" from a plan that only says "medium density, RH register C4-C6").

**Before writing any code, decide and document**: does G7b (a) define its own plan-level proxies for a subset
of these (e.g. a declared density budget is itself checkable against G6's difficulty scale without notes; a
declared register is checkable against G5's reach tables without notes), explicitly marking which real,
note-level invariants can only be checked once G8 exists; or (b) build a minimal, throwaway note-realization
just for evaluation purposes (risky — that would basically be doing G8's job to test G7b, blurring the two
Goals) — the design doc's own instinct is **(a)**, but investigate what's actually checkable at the plan level
before committing, and say plainly in your own implementation record which of the 10 invariants your plan-level
checks can and cannot stand in for. Do not claim "invariants satisfied" for anything you didn't actually check.

## 4. Scope

- **`ArrangementRequest`**: `{targetLevel (G6 scale), style, handProfile (G5's small/medium/large), sections
  (from G7a), key}`. Define this as a plain data shape — check whether G6/G5's existing types can be reused
  directly (G6's level anchors, G5's hand-profile constants) rather than inventing parallel ones.
- **`ArrangementPlan`**: one entry per G7a section, each with: melody placement (which voice/register carries
  the tune), texture class (e.g. block chords, Alberti bass, arpeggiated, melody+simple accompaniment — define
  a real, finite vocabulary grounded in what G7a's voice-role/texture analysis can actually distinguish, not an
  arbitrary list), a density/difficulty budget consistent with `targetLevel`, voicing constraints (register
  bounds, max simultaneous notes) consistent with `handProfile`'s G5 reach limits, and a human-readable
  explanation string per decision (not just a number — later Goals and any debug UI need to say *why*).
- **Deterministic search**: given the request and the SongGraph, search for a plan that satisfies every
  constraint (G5 playability limits, G6 difficulty budget) — a real search (not a single greedy pass with no
  fallback), with the found plan being reproducible byte-for-byte for the same input.
- **Explanations**: attach to each per-section decision, referencing the actual SongGraph features that drove
  it (e.g. "kept in RH register C4-C6: G6 target level allows span ≤ 8, section's melodic range is 6").

## 5. Acceptance

- Every plan satisfies the invariants **that are actually checkable at the plan level** (§3) and the G6 level
  budget, on an evaluation set assembled from G7a's own corpus (hymns first, given they have the richest SongGraph
  ground truth already).
- Deterministic: same request + same SongGraph in, same plan out.
- Do not claim satisfaction of any G0 Step 14 invariant that genuinely requires notes to check (§3) — report
  those as "deferred to G8" explicitly, not silently dropped or falsely claimed.

## 6. Regression

New `test:arrangement-planner` (or fold into `test:songgraph` if the module boundary makes more sense that
way — your call, document why). Mutation suite: a request whose target level is unreachable under the hand
profile's constraints must fail cleanly (not silently produce an invalid plan); a request for a section G7a
found no clear melody/bass in must degrade gracefully (same "honest degraded case" discipline as G6b's
`handFallback` piece), not crash or fabricate a confident-looking plan.

## 7. Performance

Planning ≤ 200ms per piece (correct here once real numbers exist, same as every prior phase).

## 8. Human review

None — deferred to G8/G9's judged output, per §2.

## 9. Rollback

Nothing user-facing — Node-only, not loaded by the app, same shape as G7a.

## 10. Notes for the G7b implementer

- Read `docs/GOALS/G07_SONGGRAPH_CORE.md` in full, especially §12's implementation record — you are consuming
  G7a's real output (harmony, melody/bass with confidence, sections, voice roles, energy curve), not an
  idealized version of it. G7a's melody/bass confidence score matters here: a low-confidence section needs
  different, more conservative planning than a high-confidence one.
- Reuse G5's actual reach/hand-profile constants (`playability/reach.js`) and G6's actual level-anchor scale
  (`difficulty/` — check its real exported shape, not an assumed one) rather than re-deriving either.
- §3's open question is the most important thing to get right in this phase — a design doc that quietly
  claims to satisfy invariants it can't actually check would be a worse outcome than one that's honest about
  the gap. Every prior phase in this project (G5a/b/c, G6a/b, G7a) was rewarded for exactly this kind of
  honesty; there is no reason G7b should be different.
- If anything in this doc turns out wrong once you've built something real, correct it in a new §11
  "Implementation record" — standard practice by now.

## 11. Implementation record

(Grows here as G7b lands.)
