# G06 — Difficulty

## 0. Status

Architect 2026-09-27 (Lead). Depends on G5 (CLOSED, deployed) for its features. Full roadmap entry:
`docs/PPP_MASTER_ROADMAP.md` §5.4. This doc is the contract for G6 and grows with each phase's
implementation record, the way `docs/GOALS/G05_PLAYABILITY_FINGERING.md` did.

**G6a implemented 2026-09-28 (branch `g6-difficulty`). §5's leave-one-book-out bar is NOT met: a tie with
legacy. The model is better within books and on the hold-out. An open decision for the Lead is in §11.**

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

### G6a — features, dataset, ranker, leave-one-book-out evaluation (2026-09-28)

**Headline, before the detail.** G6a is built, tested and reproducible, but **it does not meet §5's
leave-one-book-out acceptance bar as fixed below**. On the pre-declared primary pairs it **ties** the legacy
heuristic's best reading (89.5% vs 89.5%, piece-bootstrap 95% CI of the difference −1.4 to +1.2 points). The
bar was +2.0 points, and a fold may not lose more than 1.0 point; the Czerny 30 fold loses 1.4. The model is
clearly better at **ordering pieces inside a book**: within-book pairs are 84.7% vs 79.0% pooled over the
folds, and on the untouched hold-out 86.5% vs 75.6%. It is **no better at placing a whole unseen book**
against the others (90.9% vs 92.5% cross-book). On the registry's hold-out files, tested once at the end, it is
ahead overall: 90.4% vs 87.0%, +3.4 points, CI +0.4 to +6.6. The metamorphic tests pass 100%. Performance is
well inside §7. **The Lead should decide how to proceed before G6b starts** (see *Open decision* at the end).

**What was built** (Node only, not loaded by the app; no app, `engrave/`, `scoregraph/` or `playability/`
change):
- `difficulty/features.js`: the §3(a) features over a ScoreGraph, per piece and per measure (21 features;
  the table is `FEATURES`, and the ranker uses 20 of them, all but `length`).
- `difficulty/model.js`: inference. A linear ranker over standardized features with **every weight ≥ 0**.
  Its output is a level anchored to named method-book pieces, the top reasons, and a per-measure hotspot map
  with a hand per hotspot.
- `difficulty/index.js`: UMD entry, `assess(graph, weights)`.
- `difficulty/weights/g6a-v1.json`: the committed weights. `"schema": "ppp.difficulty-weights/1"`,
  `tool: 'ppp.g6a'`, following `scoregraph/pro.js`'s `VERSION`/`SOURCE {tool: 'ppp.g3'}` and the corpus
  files' `ppp.<name>/N` schema strings.
- `difficulty/tools/build-dataset.js`: builds the dataset. `--check` verifies the committed
  `difficulty/tools/dataset/method-books.json`.
- `difficulty/tools/train.js`: training plus the leave-one-book-out and hold-out evaluation. `--check`
  verifies the committed weights and `dataset/g6a-v1.evaluation.json`.
- `difficulty/tools/perf.js`: timing.
- `tests/difficulty/`: 34 tests, `npm run test:difficulty`. Also here: `legacy-difficulty-extract.js`,
  placed like G5b's `tests/playability/legacy-fingering-extract.js`.
- CI gate: `test:difficulty` and `train.js --check`.
- `.gitignore`: `!difficulty/tools/`. The root `tools/` rule was silently ignoring the whole directory,
  including the earlier attempt's files.

**Training runs in Node, not Python.** `tests/bench/` is Python, but the model is small: 20 inputs, about
7k pairs. A Node trainer means every evaluation scores pieces through the committed inference code itself
(`model.js scoreOf`), so there is no second implementation to drift. It adds no dependency, and it is
deterministic: zero initialization, fixed iterations, a seeded bootstrap. Floats come out identical on Windows
and in CI, which `--check` relies on.

**The real legacy baseline (read, not paraphrased — §10).**
- **`Score.deriveSections`** (App 3668), called from `finalize()` (App 3615) because `legacy.toScore` sets
  `sections: null`:
  - It cuts the piece into 8-measure sections. A tail of ≤ 2 measures is folded into the previous section.
  - Each section's score is `0.6·notes/measure + 0.5·max LH leap + 0.2·max RH leap + 12·chord share +
    14·off-beat share`. "Off-beat" means any note not on an integer quarter.
  - `hard` marks the top third of **that piece's own** sections: `round(n/3)`, at least 1.
- **`Coach.structural`** (App 8005):
  - Per section it reports notes/measure, chord share, widest leap (either hand), voice count and accidental
    share.
  - It turns these into threshold "traits" (≥ 9 notes/measure, ≥ 30% chords, leap ≥ 14, ≥ 12% accidentals,
    > 2 voices).
  - `hardest` is `argmax(notesPerMeasure + widestLeap)`.
- **Neither produces a piece-level difficulty.** Both rank sections inside one piece, and `hard` is relative
  by construction: every piece has hard sections. So "the legacy heuristic's implicit ordering" (§5) had to
  be defined. Six readings are measured, all on the Score the app itself builds: the app's real `finalize`
  and real `deriveSections`, extracted verbatim.
- Measured on the same pairs as the model:

  | Legacy reading | What it is | Pooled primary |
  | --- | --- | --- |
  | `sectionMax` | the score of the app's hardest 8-bar section | **89.5% (the bar)** |
  | `whole` | `deriveSections` over the whole piece as one section | 89.4% |
  | `sectionMean` | mean section score | 88.8% |
  | `structuralMax` | `structural`'s own ranking key for `hardest` | 87.8% |
  | `structuralTraits` | the trait count the Coach reports | 82.9% |
  | `hardShare` | the share of bars flagged `hard` | 35.0% |

  `hardShare` falls below chance, which confirms the `hard` flag cannot order pieces at all.

**Corrections to this doc, from reading the code and the registry.**
1. **There are three leave-one-book-out folds, not four.** Every `czerny299` file (10 of 10) is P1
   licence-quarantined. The registry has **0** usable Czerny 40 files, so no stage-4 fold and no stage-4 anchor
   exist. The scale's top is late Czerny 30. Each fold trains on the other **two** main books, not three.
2. **The registry's current rules.** The "15 P1 entries" figure still holds: 5 `burgmuller25` + 10
   `czerny299`. But **12 method files are also out under L8**, reference bar integrity: 4 `czerny599`, 8
   `sonatina`. They are absent from `references.json` too. `build-dataset.js` asserts that no `excluded.json`
   id is registered and lists every file it leaves out and why.
3. **Side books are not all alike (`course.js`, read in full).**
   - `hanon` appears in the `with` list of stages 2, 3 **and** 4, and `chooseWithPath` puts it in the
     **"warm"** slot. It is a warm-up carried through the course, so it has **no stage and no ordinal label**.
     The final model places all 16 of its training-eligible exercises at course position 2.87–3.1, late
     stage 2, consistent with that role.
   - `burgmuller25` and `sonatina` fill the **"side"** slot of stages 2 and 3. But `chooseWithPath` fills that
     slot only `if (!s.side)`, so a pupil keeps Burgmüller while moving on to Czerny 30. "Alongside stage N" is
     therefore a weaker ordinal claim than the main path's book-after-book order. The model is trained on
     side books' **own within-book order only**, never their stage. Their stage is still reported in
     evaluation as `crossSide`.
4. **"Position within a book" is not ordinal for the sonatina album.** It numbers **movements** across three
   composers: Clementi Op. 36, then Kuhlau, then Beethoven Anh. 5. Movement II is not harder than movement I,
   and Kuhlau Op. 55 No. 1 is not harder than Op. 20 No. 1 because it is printed later. Only Clementi's
   graded Op. 36 set is ordered, by sonatina number, and never within one sonatina.
5. **Pedal.** No method-book file has a single notated pedal mark. The pedal feature is computed but
   constant (0) in this corpus, so its weight is 0.
6. **One hand rule G5 does not have.** A one-staff part has no limb (G1), so G5's `attacksOf` drops it by
   design (G05 §10). Beyer 1–2 are the pupil's line of a duet, 104 and 144 bars. They would have had every
   G5 feature at 0 and looked empty rather than easy. When no head in the graph has a hand, `features.js`
   applies the app's own existing rule (App 4303 / `legacy-score.js:328`: a one-staff piano part is the
   right hand) to a shallow copy of the graph and reports `handFallback: true`. This affects exactly those 2
   files.
7. **G5's own output carries less signal than expected.**
   - The final model gives G5's soft strain weight **0**, and right-hand DP cost weight 0.
   - Left-hand DP cost (0.25) and G5 hard violations (0.26) do carry weight.
   - In this corpus, soft strain adds no ordering information beyond range, speed, chords and accidentals.
     This is a measurement, not a design choice: signs are constrained, magnitudes are learned.
8. **§7's "≤ 20 ms given G5's report" needs one correction.** G6 cannot reuse a G5 report computed on the
   printed pitches, because it runs G5 on key-normalized pitches (the transposition item under *Metamorphic
   results*). Measured warm in Node over 163 pieces (the non-hold-out registered pieces plus sonatina/020,
   the longest, 1,401 attacks):

   | Stage | Median | Worst |
   | --- | --- | --- |
   | G6's own features + inference | 0.43 ms | 3.7 ms |
   | G6's G5 run (analyzer + DP) | 1.7 ms | 13.6 ms |
   | G6 total | 2.1 ms | 17.4 ms |
   | `attacksOf` (shared input) | — | 3.8 ms |

   Inside the budget, before browser/CPU-throttle factors, which G6b must measure in the page. A cold-run
   test guards sonatina/020 at ≤ 100 ms, the way `playability.test.js` guards G5.

**Dataset** (`method-books.json`, registry sha256 recorded in the file):
- **195 registered pieces**, with hold-out counts from the registry flag `fnv1a32(id) % 5 == 0`:

  | Book | Stage | Registered | Hold-out |
  | --- | --- | --- | --- |
  | beyer | 1 | 65 | 11 |
  | czerny599 | 2 | 52 | 9 |
  | czerny849 | 3 | 28 | 6 |
  | burgmuller25 | side 2 | 10 | 1 |
  | sonatina | side 3 | 20 | 2 |
  | hanon | — | 20 | 4 |
  | czerny299 | 4 | **0** | 0 |

- 175 are labelled (all but hanon). **146 are training-eligible**, meaning labelled and not hold-out.
- The final model trains on those 146, using 7,115 pairs: 2,659 within-book and 4,456 cross-stage (main
  books only).
- **No hold-out file is in any training set, fold or final.** This is asserted in `tests/difficulty/`.

**Pairs and the leave-one-book-out protocol** (`train.js` header):
- **Pairs.** *b* is harder than *a* only when `course.js` says so: a lower stage, or an earlier place in the
  same book.
- **A fold holds out one main book *B*.** It trains on every other labelled, non-hold-out piece **except
  *B* and the side books of *B*'s stage.** Training on Burgmüller would reveal where stage 2 sits.
- **Test pairs** are those involving *B*:

  | Kind | What it compares |
  | --- | --- |
  | `within` | *B*'s own order; neither piece seen in training |
  | `crossMain` | *B* against the other main books |
  | `crossSide` | *B* against other stages' side books (secondary) |

  **Primary = within + crossMain.**
- **Hold-out files are in no fold, train or test.** They were kept for one test of the final model, run once,
  after everything else was fixed.

**The acceptance bar, fixed after the legacy-only run and before the first model run.** This was the order
§5 asks for, and it is recorded in `train.js`. The best legacy reading was `sectionMax` at 89.5%. The model
must:
1. reach pooled primary ≥ 89.5% + **2.0 points**, about a fifth of legacy's errors;
2. have a piece-bootstrap 95% CI for the difference that lies above 0;
3. lose no fold by more than 1.0 point.

**Development log.** It is reported in full because every change after the first run was chosen by looking
at leave-one-book-out numbers. The leave-one-book-out figures below are therefore **optimistic**, and the
hold-out is the unbiased check.

| Step | Model | Pooled primary | Beyer | Czerny 100 | Czerny 30 |
| --- | --- | --- | --- | --- | --- |
| 1 | first model (18 features incl. seconds-free length) | 88.6 | 84.1 | 89.8 | 95.8 |
| 2 | + notes per beat (RH/LH), off-beat rate, from a diagnosis of Beyer | 87.8 | 83.6 | 88.8 | 95.0 |
| 3 V1 | `log1p` on rate features | 87.3 | | | |
| 3 V2 | length out of the ranker | 89.2 | | | |
| 3 V3 | both | 88.5 | | | |
| 4 V4 | V2 + notes/beat over the busiest bars | 88.9 | | | |
| 4 V6 | V2 + side books' within-book order only | **89.5** | 88.0 | 88.1 | 94.9 |
| 4 V7 | both | 89.2 | | | |
| | legacy `sectionMax` | 89.5 | 88.2 | 87.1 | 96.3 |

Notes on the log:
- **Step 2's diagnosis.** Within Beyer, tempo-free notes per beat orders pieces at 78.4%, against ≤ 74.5% for
  notes per second. Beyer's tempo marks run against its order: later pieces include Andante at 76. Off-beat
  notes are the legacy term G6 lacked.
- **Round 3 was declared in advance, as four variants.** Length went because Beyer 1–2 are the two longest
  and two easiest pieces in the course, and the first model placed them near the top of Beyer on length
  alone. Within the main books, length orders pieces at 42–55%.
- **Round 4 was declared in advance as the last.** Iteration then stopped regardless of the outcome. V6 was
  adopted.
- **Sensitivity (reported, not selected on):** λ = 0.001 / 0.01 (used) / 0.1 / 1 gives 90.2 / 89.5 / 88.4 /
  88.5. Unbalanced pair weighting gives 89.6.

**Final leave-one-book-out** (V6, committed; `dataset/g6a-v1.evaluation.json`):

| Held-out book | Pieces | Legacy primary | G6 primary | Legacy within | G6 within | Legacy crossMain | G6 crossMain |
| --- | --- | --- | --- | --- | --- | --- | --- |
| beyer | 54 | 88.2 | 88.0 | 81.8 | **84.6** | 90.8 | 89.4 |
| czerny599 | 43 | 87.1 | **88.1** | 77.4 | **90.5** | 89.8 | 87.5 |
| czerny849 | 22 | 96.3 | 94.9 | 67.5 | 62.8 | 99.4 | 98.4 |
| **pooled** | | **89.5** | **89.5** | 79.0 | **84.7** | 92.5 | 90.9 |

Why cross-book placement does not improve: the features are not the limit. In-sample, the committed model
(trained on all three main books) leads legacy cross-book, 93.8% vs 92.5%. It also leads at the weakest
boundary, late Beyer against early Czerny 100, 88.9% vs 86.1%. Those books overlap in difficulty, so some
teaching-order pairs there cannot be learned from the notation. The loss is **extrapolation**. With a whole
book left out, the weights fitted on the other two transfer to it less well than the legacy heuristic's fixed,
hand-set weights. That boundary makes up 40% of the primary pairs (4,644 of 11,477).

**Hold-out** (29 labelled hold-out pieces, 4,328 pairs with at least one hold-out piece; final model; run
once, at the end):

| | G6 | legacy `sectionMax` | legacy `whole` |
| --- | --- | --- | --- |
| all | **90.4** | 87.0 | 87.4 |
| within-book | **86.5** | 75.6 | 75.8 |
| cross-stage | 91.9 | 91.6 | 92.1 |

- G6 − `sectionMax` = **+3.4 points, piece-bootstrap 95% CI +0.4 to +6.6**.
- This tests unseen **pieces** from books the model trained on, which is interpolation. Leave-one-book-out
  tests unseen **books**, which is extrapolation. The two answer different questions.

**Metamorphic results (§5), 100% pass**, on 3 fixtures plus 18 real non-hold-out pieces (first, middle and
last of each book). Each property is also checked **feature by feature**, so it cannot hold by an accident
of today's weights.
- **Tempo** (126 cases, 21 graphs × ×0.5/0.9/1.1/1.5/2/4):
  - Faster never lowers any feature or the score; slower never raises them.
  - The score does respond: at ×2 it rose on all 21.
  - This holds by construction. Tempo enters only through per-second speed and G5's two timing checks. Every
    count is per notated beat, and length is in beats. The earlier attempt's `durationSec` (a positive
    weight on seconds) broke this.
- **Transposition** (466 transpositions to more accidentals, 10 to equally many):
  - Every feature except `keyLoad` is unchanged to 1e-9, and `keyLoad` rises.
  - By construction: G5's analyzer and DP see key-normalized pitches, with the signature's scale moved onto
    the white keys. Key colour is carried by `keyLoad` alone.
  - Without that normalization the test fails. This was checked by mutation.
- **Fewer notes:**
  - Removing either hand never raises any feature or the score (42 cases).
  - Across 84 patterned removals, **no feature outside the named set rises**. The named set is G5 strain, hard
    violations, DP cost and independence, which can rise when a removal leaves a leap behind or exposes one
    hand's rhythm. The score never rose.
  - **No feature is a share of the piece's notes**, so deleting plain notes cannot dilute a rate upward. A
    per-note ratio fails the dilution tests, checked by mutation.
  - A sparse piece of wide chromatic chords in six sharps outranks a dense five-finger C-major exercise, so
    fewer notes is not automatically easier.
- **No-op edits:** re-running, a `serialize`/`parse` round trip, a re-import and a sealed `ops.edit` that only
  bumps `rev` all give an identical prediction.

**The earlier, interrupted attempt** (uncommitted files found in this worktree; assessed file by file):

| File(s) | Decision | What was wrong, and what survived |
| --- | --- | --- |
| `features.js` | **Rewritten**; kept the UMD placement, the tuplet/pedal spanner reading, and its DP path-cost replay | The replay was correct; it is now proven equal to the DP's own optimum by brute force in `features.test.js`. Everything below was wrong: Beyer 1–2 had all-zero features (the one-staff gap above). `durationSec` violated the tempo property. Five features were per-note ratios (dilution). Syncopation used `>=`, so every off-beat eighth ending on the beat counted, contradicting its own comment. `handIndependence` gave a one-hand piece the maximum, 1. G5 ran on printed pitches, so transposition could lower the score. `pedalOverlap` was always 0 |
| `model.js` | **Rewritten** | Unconstrained signs: its weights said more strain, more violations and more independence make a piece *easier*. Hotspots came from hand-set local weights unrelated to the model |
| `tools/build-dataset.js` | **Rewritten**; kept the registry-based universe and hanon = no stage, which was the right reading | Hard-coded a copy of `PATH`. Treated sonatina numbering as ordinal. No leak check. No L8 accounting. One arbitrary legacy reading |
| `tools/legacy-extract.js` | **Discarded**, replaced by `tests/difficulty/legacy-difficulty-extract.js` | Its dataset builder finalized scores through `tests/engrave/helpers.js appFinalize`, which stubs `deriveSections: () => []`. It then called `deriveSections` once with a whole-piece chunk, so the app's real 8-bar sections, and `Coach.structural`, which reads them, were never measured. The replacement runs the app's real `finalize` → `deriveSections` path and `structural`, and records six readings |
| `tools/train.py` | **Discarded**; its "no Czerny 40 data" finding was right | Leave-one-book-out evaluated on the held book's **hold-out** files during development. Trained on within-hanon and sonatina-numbering pairs. No sign constraint. A numpy copy of inference |
| `weights/g6a-v1.json`, `dataset/method-books.json` | **Regenerated** | |
| `tests/difficulty/*` | **Rewritten** | The "transposition" test only changed the key signature, not the notes. The hand-independence "= 1" case asserted the bug |

**Scope notes.** No `PPP.difficulty` switch, no Analysis-screen or Coach change, no app file edit: that is
G6b. The legacy functions are untouched. H-56 (§8) can now draw "which is harder" pairs from this model.

**Open decision for the Lead.** §5's leave-one-book-out bar, fixed before the first model run, is not met: a
tie on pooled primary. The evidence splits two ways. The model is significantly better at within-book order
(leave-one-book-out and hold-out) and better overall on the hold-out. It is not better at placing an unseen
book. Options:
- **(a) Accept G6a on the evidence as it stands**, with an explicitly revised bar for G6b. For example:
  within-book leave-one-book-out ≥ legacy, plus the hold-out CI above 0.
- **(b) Get more data.** Licence-clearing even part of Czerny 40 (P1) would add the missing stage-4 fold and
  a real top anchor. Today the scale ends at late Czerny 30.
- **(c) Iterate further on features or a hybrid ranker.** Any new leave-one-book-out selection would need a
  fresh untouched test set, because the current hold-out has now been looked at once.

G6b should not start until this is settled.
