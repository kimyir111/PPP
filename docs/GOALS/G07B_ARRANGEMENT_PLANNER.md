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

### G7b — Arrangement Planner: request/plan shapes, texture ladder, deterministic search (2026-09-28)

**Headline.** Built and tested, Node-only (`arrangement/`, `tests/arrangement/`, `npm run
test:arrangement-planner`, 17/17 passing, wired into the CI gate right after
`test:songgraph`). G7b writes no notes and no pitches, per §1/§2: an `ArrangementPlan`
names which of a piece's real, already-identified voices (G7a's `voiceRolesOf`) each
section keeps and which hand plays them, never new note content. Real corpus coverage
(own-real-level, medium hand profile): **169/369 files overall, 67/100 hymns**; zero
crashes anywhere in the 369-file corpus across 3,321 (level × hand-profile) attempts;
**400/400 sampled determinism checks identical byte-for-byte**; worst-case performance
**48.7-49.1ms** (`sonatina/020.mxl`, the same file every prior phase's perf check uses),
comfortably inside §7's 200ms estimate — confirmed realistic, not revised.

**§3's open question, resolved (investigated before writing the search, per the doc's own
instruction) — the design doc's instinct (a) held, with one correction along the way:**

Inverting G6's trained weighted-sum ranker (`difficulty/model.js`'s `scoreOf`) to get a
feature ceiling for a target level was investigated and **rejected**: every one of its 20
features' z-scores can be *negative* (below the training corpus's mean) and every weight is
non-negative, so a partial sum over only the features a plan can honestly derive (register,
chord count, key) is **not a sound bound** on the real note-level score — a piece unusually
plain in the features this module cannot see (rhythm, syncopation, fingering cost, all
genuinely note-level) could still land at a *lower* total score than a simpler-looking one.
Building that inversion would have produced exactly the "confidently-wrong-looking plan"
§3 warns against. Documented in `arrangement/reference.js`'s header so the next person
doesn't re-attempt it.

What **is** sound: `difficulty/tools/dataset/method-books.json` already has the **real**
per-piece feature vectors (`notesPerBeatRH/LH`, `chordLoad`, `range`, `keyLoad`, ...) for
every training piece `difficulty/weights/g6a-v1.json`'s anchors came from. Grouping those
real feature vectors by the same book/stage the anchors already use gives a genuine,
evidence-based ceiling ("real method-book pieces at this stage don't exceed X") with no
model inversion needed. **One real correction made while building this**: a straight p90
ceiling degenerates for `chordLoad`/`keyLoad` at stage 1 (measured: p50=p90=0 - only 1 of
54 real Beyer anchors is ever nonzero), which would reject *any* real chord at all despite
the corpus itself containing one (chordLoad 1.16). Switched those two features' ceiling to
the real *max* instead of p90 (continuous features - range, notesPerBeatRH/LH - keep p90);
`plan.js`'s `densityOk` check documents why. **Stage 4 (czerny299) has zero real anchors at
all** — confirmed directly (`node -e` count in `reference.js`'s header), the same
licence-quarantine G7a's §4 already found (and G6's own "missing 4th fold" gap, on record
before this phase). `reference.js`'s `bandsForStage(4)` returns stage 3's real band with
`extrapolated: true` — every caller (and this doc) treats that as "closest real reference
available," never a real stage-4 measurement.

**The 10 G0 Step 14 invariants, resolved plainly (full reasoning in `arrangement/plan.js`'s
header, kept there so it stays next to the code it describes):**

| Invariant | Status |
|---|---|
| `read.max_chord_size` | **Real, checked.** The plan's `maxNotesPerHand` is the real simultaneous count of the retained voices, checked against G5's real `MAX_KEYS`. |
| `read.over_span_rate` | **Real per-section proxy.** The plan's hand span is the real simultaneous span of retained voices, checked against G5's real `MAX_SPAN[handProfile]` — a worst-case check, not a rate (no notes exist to compute a rate over). |
| `arr.max_notes_per_attack<=cap` | **Real, checked** — the same simultaneous-count check as `read.max_chord_size` (the two collapse to one check at plan level). |
| `arr.invented_pitches=0` | **Structurally guaranteed of the plan** (it names voice ids, never a pitch — there is no field that could invent one) — **not** independently verified of a future G8 realization; deferred. |
| `arr.metre_preserved` | **Structurally guaranteed of the plan** (no meter-change field exists) — realization-level verification deferred to G8. |
| `arr.tempo_preserved` | **Structurally guaranteed of the plan** (no tempo field exists) — deferred, same as above. |
| `arr.density_ratio` | **Partial/empirical.** `notesPerBeatRH/LH` and the chord-load proxy are computed from the SAME real retained notes G8 would keep, checked against the real per-stage band above — this bounds the plan's *target*, not a G8 realization's actually-achieved ratio (which may thin a kept voice further, or add fills G7b never proposes). |
| `arr.melody_retention` | **Partial.** Gated on G7a's real `melodyConf`/`bassConf` (below 0.3 forces the simplest texture and flags `degraded`) and always keeps the identified voice's own real notes verbatim when kept at all — but the fraction of the *original* melodic content actually present in a *realized* arrangement is unmeasurable without G8's notes. |
| `arr.bass_retention` | Same as `arr.melody_retention`, mirrored for the bass voice. |
| `arr.no_invented_legato` | **Genuinely deferred, no proxy exists.** Articulation/slur content has no representation anywhere in a plan's shape — reported here, not silently dropped. |

**What was built** (Node only, not loaded by the app; touches nothing in `songgraph/`,
`scoregraph/`, `playability/` or `difficulty/` — read-only consumption throughout, per §10):
- `arrangement/reference.js`: real per-stage bands from G6's own training corpus (above).
- `arrangement/texture.js`: the texture vocabulary, as a **voice-retention ladder**
  (`full`/`partial`/`reduced`), not an invented rhythmic-pattern list. The design doc's own
  examples ("block chords, Alberti bass, arpeggiated") were investigated and rejected: they
  are rhythmic-pattern distinctions, and G7a's `voiceRolesOf` has no rhythmic-pattern
  feature at all — it only ever sees which voice is on top/bottom/inner/accompaniment at
  each of *its own* onsets, so it cannot tell an Alberti bass from a block chord (same
  pitches, same voice, different onset spacing). The real, finite thing G7a's roles *can*
  distinguish is voice count and role, which drives the ladder directly: `full` keeps every
  real voice (1-4 in this corpus); `partial` drops the least-confident inner/accompaniment
  voice; `reduced` keeps melody+bass only (or melody alone, for a 1-voice part). A 2-voice
  part has exactly one rung (melody+bass *is* its full texture) — gating uses a real
  `extraKept` count, not the `tier` label, specifically to avoid conflating that case with a
  4-voice part's fully-reduced rung (both labelled differently but both `extraKept: 0`).
- `arrangement/plan.js`: the search. Per section: pick the real starting ambition from the
  requested level's stage (`texture.startExtraForStage`, a declared G7b policy, documented
  as such — not derived from G6's model, which §3's investigation showed doesn't decompose
  this way); assign each retained voice to a hand by its **own real average register within
  that section** (not by role label — this stays correct even when melody/bass confidence
  is low, since a role label can be wrong but a real average pitch cannot contradict
  itself); walk the ladder from most to least ambitious (monotonically safe: dropping a
  voice can only reduce a hand's simultaneous span/count/attack-rate, never raise it) and
  return the first rung whose real hand-reach (G5) and real difficulty-budget numbers (G6,
  above) both pass. If even the fully-reduced rung fails, the section — and the whole
  request (v1 is all-or-nothing across requested sections, a deliberate simplicity choice
  noted for a future refinement) — fails cleanly with `{ok:false, reason:'UNREACHABLE',
  detail:{attempts:[...]}}`, never a fabricated plan.
- Every section carries a real explanation string citing the actual numbers that drove the
  decision (register, span, notes/beat vs. the real corpus band, and — when degraded — the
  real confidence numbers that triggered it), not a template.
- `arrangement/index.js`: UMD aggregator, same shape as `songgraph/index.js`.
- `arrangement/tools/corpus-check.js` (gitignore-exempted like every prior phase's own
  tools directory): the real-numbers tool — per file, assesses the piece's own real G6
  level, requests a plan at that level ±1 stage across all three hand profiles, and reports
  coverage, degraded counts, determinism (400 samples) and timing percentiles.

**Two real findings from running the search over the whole corpus, not assumed:**
1. **Hanon exercises fail at their own G6-assessed level in every hand profile tested
   (0/180 attempts).** Not a search bug: Hanon's LH pattern in the fixture checked runs a
   genuine 4 attacks/beat (16th notes throughout, both voices landing in the same hand by
   real register), which exceeds the real stage-2 `notesPerBeatLH` ceiling (max 2.0) even
   though G6's whole-piece score places Hanon near stage 2 overall (averaged against its
   few other complexity dimensions). This is a real mismatch between Hanon's exercise style
   and the graded method-book corpus G6 trained its per-feature bands from, not a planner
   defect — noted here rather than loosened away.
2. **czerny299's low coverage (12/90) is the stage-4 extrapolation, not new evidence of
   anything wrong**: with no real stage-4 anchors (above), every czerny299 request is
   checked against stage 3's real band, which real czerny299 pieces (by construction,
   harder than stage 3) frequently exceed. Expected, given the extrapolation; would need
   real stage-4 ground truth (the same open licence question G6/G7a already flagged) to
   improve honestly.

**Tests.** `tests/arrangement/` — a **new** boundary (`test:arrangement-planner`), not
folded into `test:songgraph`: G7b consumes G7a's output as a read-only client (same
relationship G6's `test:difficulty` has to G5's `playability/`) rather than extending its
analysis, and the design doc's own §6 already names a distinct script. 17 tests: the
texture ladder in isolation (a 4-voice and a 2-voice synthetic fixture); the search over
real hymn material (a clean example, `o-come-emmanuel`, with a real-explanation content
check, and a deliberately-too-low level on `amazing-grace` failing cleanly); determinism
(both a single-file check and a 20-hymn sample); request validation (bad `targetLevel`,
unknown `handProfile`, unknown section label); the mutation suite (§6): an engineered
2-octave-dyad bass voice is unreachable under every hand profile at any level (the
"unreachable under the hand profile's constraints" case — not really a *level* problem,
since no simpler rung exists that drops that chord; noted honestly rather than mislabeled);
and the "no clear melody/bass" degradation checked against **the real corpus case the
design doc asked to be confirmed**, not an imagined one — `catalog/hymns/for-all-the-
saints.musicxml`'s second part has real `melodyConf`/`bassConf` of exactly 0.0/0.0 (G7a's
own documented hardest case, §12 of the G7a doc: 24% harmony agreement, "alto/bass rest
often, leaving thin, more ambiguous slices") — confirmed directly, not assumed, and the
plan for it is forced to the simplest texture and flagged `degraded: true`, never presented
as confident. `tests/arrangement/corpus.test.js` carries regression floors set safely below
the real measured baseline (55/100 hymns, 130/369 overall — both well under the real 67 and
169), the same discipline `tests/songgraph/hymn-corpus.test.js`'s floors use.

**Scope notes / what turned out different from §4's sketch.** `style` is part of
`ArrangementRequest`'s shape (as §4 specifies) but has **no effect on the search today** —
carried through and reported as a declared no-op in `plan.js`, not silently ignored or
faked, since nothing in G7a's real output distinguishes a "style" without inventing a
feature nobody has evaluated. `ArrangementRequest`/`ArrangementPlan` reuse G6's real level
scale (`difficulty/weights/g6a-v1.json`'s `stages`/anchors, via `stageForPosition`) and G5's
real hand-profile constants (`playability/reach.js`'s `PROFILES`/`MAX_SPAN`/`MAX_KEYS`/
`COMFORT_SPAN`) directly, per §10 — no parallel types were invented. `metrics/
arrangement.py`/`suites/arrange.json` (G0 Step 14's originally-planned home) remain
unwritten: every invariant they'd check is either a plan-level proxy now living in
`arrangement/plan.js`'s own checks, or genuinely requires G8's notes — a Python
note-level metrics file has nothing to measure yet.
