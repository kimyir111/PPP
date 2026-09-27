# G06 — Difficulty

## 0. Status

Architect 2026-09-27 (Lead). Depends on G5 (CLOSED, deployed) for its features. Full roadmap entry:
`docs/PPP_MASTER_ROADMAP.md` §5.4. This doc is the contract for G6 and grows with each phase's
implementation record, the way `docs/GOALS/G05_PLAYABILITY_FINGERING.md` did.

## 1. Goal

One difficulty scale that says how hard a score is, where, and why — anchored to the method-book
progression this app already teaches from (`course.js`'s `PATH`: `beyer` → `czerny599` (with `hanon`,
`burgmuller25`) → `czerny849` (with `hanon`, `sonatina`) → `czerny299` (with `hanon`)). Later Goals use
this as a **target**: G7-G9 plan an arrangement to a level, G11 adapts practice around it.

It replaces two existing pieces of legacy difficulty logic, both real and both in the app today:
- `Score.deriveSections(score)` (App:3668) — called from `finalize()` at App:3615 whenever a score has no
  sections yet — produces `hard` flags on sections by some existing heuristic.
- `Coach.structural(score)` (App:8005) — read at App:7960 (`session.structural`) and App:17215
  (`Coach.structural(score).hardest`) to label a passage's difficulty for the Coach's guidance, explicitly
  commented "structural difficulty is labelled as a prediction, never as measurement" (App:17213).

Read both of these fully before writing anything — they are the actual baseline G6 must beat, not an
assumed one.

## 2. Non-goals

- No per-player measured difficulty (that already exists today as `Learning`, and gets a learned model
  later in G11 — G6 is about the *score*, not the *player*).
- No arrangement or note changes (G8/G9).
- No change to how the app practises today (G6b only changes what the Analysis screen and Coach context
  show, behind a switch).
- No LLM. The model is a small, interpretable, deterministic-inference ranker (see §4), not a language
  model.

## 3. Scope

### (a) Features (G6a)

Computed over a ScoreGraph, reusing what's already measured rather than re-deriving it:
- **G5's own output**: strain (soft) and hard-violation counts from `playability/analyze.js`, and
  fingering-DP path cost from `playability/fingering.js` (a proxy for finger-transition difficulty) —
  both hands, both profiles where relevant.
- **Rhythm complexity**: syncopation, tuplets, note-value variety within a passage.
- **Density per hand at tempo**: notes/second per hand, from the graph's own timing (`scoregraph/time.js`,
  already used by G5a's `attacksOf`).
- **Hand independence and polyphony**: how differently the two hands move, how many simultaneous voices
  per hand (G5a's `playability/graph.js` already extracts per-hand keyboard attacks — reuse, don't
  re-derive).
- **Accidental and key load**: key signature complexity, in-piece accidental density.
- **Range**: total keyboard span used, extremes.
- **Pedal**: pedal event density and complexity (change events, overlapping spans).
- **Length**: measure count, duration.

### (b) Model (AI-1: a small, interpretable ranker)

An ordinal or pairwise-logistic ranker (not a deep model — check what's already available in this
project's Python tooling, e.g. `tests/bench/`'s existing dependencies, before adding a new one) trained on
the method-book progression: `course.js`'s `PATH` gives book-level ordering (`beyer` < `czerny599` <
`czerny849` < `czerny299`), and the position of a piece *within* a book (its number/order) gives a
finer-grained signal within a stage. Quarantined and hold-out files (`tests/bench/corpus/excluded.json`,
the same registry G4/G5 already use — confirm current rules before assuming G5's "15 P1 entries" figure
still holds, since MX-2/G5 have already changed what's excluded and why) must never enter training.

Output per score:
- A level, anchored to named method-book points (e.g. "harder than czerny599#12, easier than
  czerny849#01" — not just a raw number nobody can interpret).
- A per-measure hotspot map (which measures/hands are the hard part, and why — trace back to §3(a)'s
  features, don't just emit a black-box score).
- The top reasons (feature attributions a person could read, not raw weights).

Weights committed as versioned JSON (same convention as other model artifacts in this repo — find the
existing pattern, e.g. how G3's `pro-*.js` modules version their own tunables, before inventing a new
format). Inference itself must be deterministic given the committed weights.

This **replaces `Score.deriveSections`'s `hard` flags and `Coach.structural`'s output behind a switch**
(see §9) — it does not delete the legacy functions (rollback needs them intact).

### (c) App integration (G6b)

The Analysis screen and Coach context read G6's level/hotspot/reasons instead of
`deriveSections`/`Coach.structural`'s output, behind the switch. Same rollout shape as G5c: default off,
investigate the real call sites and existing caching before touching anything, verify byte-identical
behavior when off.

## 4. Phases

- **G6a** — features (§3a) + dataset (the corpus registry filtered to the four `PATH` books, hold-out and
  quarantine respected) + model (§3b) with **leave-one-book-out evaluation** (train on 3 of the 4 books,
  test ordering accuracy on the held-out book — repeat for each book). Node/Python, whichever this
  project's existing model-training tooling actually uses (check before assuming Python; `tests/bench/` is
  Python, `playability/` is Node — G6a may need both, one for training/offline evaluation and one for
  committed-weights inference in the app). Not loaded by the app.
- **G6b** — app integration (§3c) behind a switch (§9). Touches the app file — full review cycle, same as
  G5c.

## 5. Acceptance

- **Leave-one-book-out pairwise accuracy beats the legacy heuristic** (`Score.deriveSections`/
  `Coach.structural`'s implicit ordering, measured the same way) **by a margin fixed after G6a's own
  baseline run** — do not assume a number now; measure the legacy baseline first, the way G5b measured the
  legacy fingering DP before claiming to beat it.
- **Metamorphic tests, 100%**: a faster tempo is not easier (difficulty is about the score, not the
  playback speed the app happens to set); fewer notes is not automatically harder or easier without
  checking why; transposing to a key with more accidentals is not easier (it should be harder or equal,
  never strictly easier).
- **Stable under no-op edits** (re-running on an unchanged graph gives the same level).
- **Hold-out files never used for training** — same discipline as every other Goal's evidence base.

## 6. Regression

`test:scoregraph`, `test:engrave`, `test:playability` unaffected (G6a doesn't touch those modules' own
logic, only reads their output). New `test:difficulty` (or wherever this project's convention puts a new
suite — follow `test:playability`'s precedent). `coach.test.js` and `musicxml.test.js` section-snapshot
tests, under both the legacy and G6 switch, once G6b exists.

## 7. Performance

≤ 20 ms per piece given G5's report is already computed (per §5.4's roadmap entry) — confirm this is
still realistic once the actual feature set and model inference cost are known; correct here if not, the
way every prior G4/G5 phase corrected its own early performance estimates once measured.

## 8. Human review

H-56, shared with G5's fingering review (§10 of the G05 doc) — about 10 pairs of "which is harder."
Scheduled once G6a has a real model to show pairs from, not before.

## 9. Rollback

`PPP.difficulty = 'legacy'` (matching `PPP.fingering`'s and `PPP.legacyImport`'s exact convention: a
get/set pair on `window.PPP`, default `'legacy'`, an invalid value falling back to `'legacy'`) once G6b
exists. Before G6b, there is nothing user-facing to roll back — G6a is Node-only, not loaded by the app,
same as G5a/b.

## 10. Notes for the G6a implementer

- Read `Score.deriveSections` (App:3668) and `Coach.structural` (App:8005) in full before designing
  anything — they are the real baseline, and G5a/b's own history shows this project's design docs get real
  numbers wrong until someone actually reads the legacy code (G5a corrected the reach-table citation, G5b
  discovered "joint hands" was never true in the legacy DP). Expect the same here: verify every claim in
  this doc against the real `deriveSections`/`Coach.structural` source rather than trusting this
  paragraph's description of what they do.
- `course.js`'s `PATH` (line 26-30) is the ground truth for book-level ordering — read the whole file, not
  just the `PATH` array, since stage membership (`with: [...]`) may matter for how "hard" a side-book like
  `hanon` or `burgmuller25` should be treated relative to the main sequence.
- Reuse G5's already-reviewed, already-correct hand/timing extraction (`playability/graph.js`'s
  `attacksOf`, `pitch.limbOf` per G1-D12) rather than re-deriving hand or timing data — this was
  independently reviewed twice (G5a, G5b) and is a solid foundation.
- If any number in this doc (the "≤20ms" budget, the exact corpus registry rules, what `PATH` actually
  contains) turns out wrong once you look, correct it here in a new §11 "Implementation record" the way
  every G4/G5 phase did — do not silently diverge from a written spec.

## 11. Implementation record

(Grows here as each phase lands — G6a first.)
