# G07 — SongGraph Core (G7a)

## 0. Status

Architect 2026-09-28 (Lead). Depends on G1 §10.3 (ScoreRef/ScoreSpan machinery, already built), G5 (playability
constraints, deployed), G6 (difficulty scale, deployed), MX-2 (hymn data quality, deployed). Full roadmap entry:
`docs/PPP_MASTER_ROADMAP.md` §5.5. This doc covers **G7a only** — SongGraph analysis. G7b (the Arrangement
Planner) is a separate, later phase with its own design once G7a's real accuracy numbers are in hand; do not
start G7b work against this doc.

This doc corrects several roadmap claims that a pre-implementation investigation found stale or wrong (the same
discipline G5/G6 each applied once real code was read) — see §3's footnotes.

## 1. Goal

Build a real SongGraph from symbolic input (a ScoreGraph): what the piece *is*, musically — key regions, harmony,
melody/bass identification, sections and repetition, phrases and cadences, voice roles, an energy/density curve.
This becomes the input G7b's Arrangement Planner reasons over, and later Goals' shared "what is this piece"
representation.

**Direction rule (G1 §10.3, already decided, not open for reinterpretation)**: SongGraph reads a ScoreGraph and
never the reverse. A SongGraph never copies notes — it holds `ScoreSpan`s (`scoregraph/time.js`) resolved against
the ScoreGraph on demand. The only way a SongGraph's finding becomes a first-class graph object is "promotion":
calling `ops.addSection`/`addPhrase` on the ScoreGraph itself with `prov: {op:'inferred', src: <this analyzer>}`.

## 2. Non-goals

- No note generation or arrangement realization (G8).
- No audio (G10 — this is symbolic-input only; audio becomes one more SongGraph producer later, not now).
- No LLM in analysis unless G7a's own accuracy gate fails on real measurement (AI-2, evidence-gated — do not
  reach for an LLM as a first resort; the roadmap's own ordering here is deliberate).
- No drums, no G7b arrangement planning, no UI beyond a debug view.
- Does not touch `Score.deriveSections` (the app's legacy ~8-bar practice-chunk heuristic used by G6's difficulty
  pipeline) — **that is a different, unrelated concept from this Goal's `sections`**, despite the shared English
  word. See §4's schema note.

## 3. What already exists (read before writing anything)

- **`scoregraph/time.js`**: `resolveSpan(g, span)` (a `ScoreSpan` → `Event[]`, deterministically ordered, throws
  `E-REF-MISSING` for an unknown part/voice) and `spanOf(g, ids)` (the inverse: smallest `ScoreSpan` covering a
  set of event/head IDs) are **already built and exported**. G7a uses these directly; it does not reinvent span
  resolution.
- **`scoregraph/serialize.js`**: `fingerprint(g)` (FNV-1a 64-bit hash of the graph's canonical serialized JSON)
  and `scoreRef(g)` (`{scoreId, rev, fp}`, literally the `ScoreRef` constructor, with a comment naming this exact
  Goal: "How SongGraph (G7+) points at the graph it analysed") are **already built**. Freshness checking (does a
  cached SongGraph still match its ScoreGraph) is: recompute `fingerprint(g)`, compare to the stored `ScoreRef.fp`.
- **`scoregraph/pro-spell.js`'s `regionKeys(g, part, opening)`**: a pure, standalone Viterbi key-region detector
  (24 major/minor keys, windowed pitch-class histograms, boundary refinement) — **this is "G3's pure region
  code"** the roadmap points to. It computes **key regions only** (not sections, phrases, melody, or harmony —
  correct the roadmap's broader-sounding phrase to this specific, narrower scope). It's callable directly; it
  does not require `professionalize()`'s pipeline (which stays off by default per G3-U9 and is unaffected by
  calling `regionKeys` standalone).
- **`scoregraph/schema.js`'s `Structure: {sections, phrases}`**: the schema slots already exist (`Section: {id,
  label?, from, to, parent?, prov?}`, `Phrase: {id, part?, voices?, from, to, section?, prov?}`), already wired
  into canonical serialization and validation. **Nothing populates them yet** — no `ops.addSection`/`addPhrase`
  exist in `scoregraph/ops.js`, and MusicXML import never touches `structure.sections`/`structure.phrases`.
  **G7a must add these two ops.** This is genuinely new schema-populating work, not a wrapper around something
  that already runs.
- **No cadence concept exists anywhere in the codebase.** G7a defines it from scratch.

## 4. Ground truth reality check (corrects the roadmap's acceptance-criteria assumptions)

- **Printed chord symbols ("550 in the corpus," roadmap §5.5)**: numerically correct as a raw count, but
  **all 550 are in the 8 `czerny299` files that carry `<harmony>`, and all 10 czerny299 files are licence-
  quarantined** (`tests/bench/corpus/excluded.json`, rule P1 — no `<rights>` evidence, contradicted by other
  files' provenance). **Effectively zero licence-clean printed-chord-symbol ground truth exists today.** G7a's
  harmony accuracy cannot be measured against printed chord symbols as the roadmap assumed. Options, in order of
  preference: (a) measure harmony agreement against the hymn SATB texture instead (see below — this is real,
  usable ground truth, just a different source than the roadmap named); (b) if czerny299 licence evidence is
  ever found (the same open question as G6's missing 4th fold, `czerny40`/`czerny299` data), re-add it as a
  second ground truth set; (c) do not invent synthetic chord-symbol ground truth — measure what's real, the way
  every prior phase did, and say plainly if a metric has no ground truth yet rather than faking one.
- **Hymn SATB ("hymn SATB," roadmap §5.5)**: **real and usable**, confirmed by reading the data directly — all
  100 `catalog/hymns/*.musicxml` files (already fixed by MX-2 this session, `ca70a03`) encode 4 genuinely
  independent, mostly-monophonic voices (soprano/alto on staff 1, tenor/bass on staff 2 — the "S1/S1V2/S2/S2V2"
  convention), not a reduced 2-voice-per-hand piano texture. Soprano (voice 1) is a real, usable melody-ID ground
  truth; the 4-voice vertical slice at any beat is a real, usable harmony ground truth (compare G7a's own
  harmony-per-beat-window output to what the 4 written pitches actually spell). **Caveat**: this same SATB
  two-voices-per-staff layout was the leading cause of G5a's playability false positives (roadmap §5.3's G5a
  summary) — any G7a code reasoning about "voices per staff" should expect this pattern and not assume one voice
  per staff.
- **Arrangement invariants (G0 Step 14)**: the roadmap's own gloss ("melody preserved, harmony covered, bars
  intact, range, level") does not match the actual spec. The real list, from `docs/GOALS/G00_QUALITY_FOUNDATION.md`
  "Step 14" (never implemented — `metrics/arrangement.py` and `suites/arrange.json` do not exist anywhere in the
  repo): `arr.invented_pitches=0`, `arr.max_notes_per_attack≤cap`, `arr.metre_preserved`, `arr.tempo_preserved`,
  `arr.melody_retention`, `arr.bass_retention`, `arr.density_ratio`, `read.over_span_rate`, `read.max_chord_size`,
  `arr.no_invented_legato`. This is G7b's concern (arrangement invariants apply to a *plan*, not to G7a's
  analysis), but the design doc that eventually covers G7b should build from this real list, not the roadmap's
  paraphrase, and should expect to write `metrics/arrangement.py`/`suites/arrange.json` from scratch.

## 5. Scope (G7a)

`songgraph_version` 1. Over a ScoreGraph, produce (not yet promoted into the graph — held as SongGraph state
alongside a `ScoreRef`, per §1's direction rule):

- **Key regions**: `regionKeys()`, reused directly (§3). Confirm it handles every corpus stratum reasonably
  (hymns' frequent modulations, method-book pieces' simpler key plans) before assuming zero further work.
- **Harmony per beat window**: new. A beat-window chord-detection pass (pitch-class content per window → best-
  fit triad/seventh chord, roman-numeral or absolute naming — pick one, document why). Ground truth: hymn SATB
  (§4), not printed chord symbols (§4's correction).
- **Melody and bass identification, with confidence**: new. Per-voice-role classification (which voice/staff
  carries the tune, which carries the bass) with a confidence score, not a bare boolean. Ground truth: hymn
  soprano (melody) and bass (voice 6) lines; for non-hymn corpus material without SATB structure, define a
  fallback ground truth or explicitly report "no ground truth available for this stratum" rather than guessing.
- **Sections and repetition**: new — genuinely populates the empty `Structure.sections` schema slot via a new
  `ops.addSection`. Detect repeated material (verse/chorus-like structure, method-book piece sections) — do not
  conflate with `Score.deriveSections`'s unrelated ~8-bar practice chunks (§2).
- **Phrases and cadences**: new — populates `Structure.phrases` via a new `ops.addPhrase`. Cadence detection is
  entirely new (§3 — nothing exists yet); ground it in real harmonic-rhythm/melodic-closure signals, not a
  guessed heuristic with no evaluation.
- **Voice roles**: melody/bass/inner-voice/accompaniment classification per voice, building on the melody/bass
  work above.
- **An energy/density curve**: new — a per-measure or per-beat-window density/intensity signal (note density,
  dynamic markings, register, texture thickness) usable later by G7b's planner.
- **Freshness**: `scoreRef.fp` (already built, §3) checked against the current graph on each read; on mismatch,
  either remap via the edit op's `idMap` (if available) or re-analyse from scratch — do not silently serve stale
  analysis.
- **Promotion**: only through the two new ops, `ops.addSection`/`ops.addPhrase`, with `prov: {op:'inferred',
  src: 'songgraph'}` (or a more specific `src` per analyzer) — never a direct schema write.

## 6. Acceptance

- **Harmony agreement**: measured against hymn SATB (not printed chord symbols — see §4's correction), target
  fixed after a first real baseline run (do not assume a number now — same discipline as G5b/G6a).
- **Melody identification**: measured against hymn soprano; report separately for any stratum with no usable
  ground truth rather than inventing one.
- **Deterministic**: same graph in, same SongGraph analysis out, byte for byte.
- **`resolveSpan` round trips**: for an `EventSet` E, `resolveSpan(g, spanOf(g, E))` recovers E (or a well-defined
  superset, if E wasn't already contiguous) in the same deterministic order, and doing this twice is idempotent.
  This is a new test G7a must write (no existing test covers spans specifically — do not confuse this with G1's
  unrelated `sg-roundtrip`, which tests MusicXML import/export, not span resolution).

## 7. Regression

New `test:songgraph`. Arrangement-invariant checks are G7b's concern, not this phase's. Mutation suite: a planted
wrong key (does `regionKeys`'/the harmony pass's output visibly break), a melody/bass swap, an off-by-one span —
each must be caught.

## 8. Performance

Analysis ≤ 500ms for the longest corpus piece in Node (confirm this is still realistic once real algorithms
exist — correct here if not, per every prior phase's own discipline).

## 9. Human review

None for G7a — the roadmap defers judgment of SongGraph quality to G8/G9's downstream output, since a wrong
SongGraph would surface as a visibly bad arrangement later. Do not schedule a review round for this phase.

## 10. Rollback

Nothing user-facing — G7a is Node-only, not loaded by the app, same shape as G5a/G6a's first phases.

## 11. Notes for the G7a implementer

- Read `docs/GOALS/G01_SCOREGRAPH.md` §10.3 in full before designing anything — it already specifies the
  ScoreRef/ScoreSpan contract in more detail than this doc repeats.
- Do not re-derive `resolveSpan`/`spanOf`/`fingerprint`/`scoreRef` — they exist, are correct, and are already
  exported (`scoregraph/time.js`, `scoregraph/serialize.js`).
- Reuse `regionKeys()` directly for key regions; do not write a second key-detection algorithm.
- The harmony and melody/bass ground truth is hymn SATB, not printed chord symbols — §4 explains why the
  roadmap's original assumption doesn't hold. If you find yet another usable ground truth source while working
  (e.g. an untried corpus feature), say so and use it, the same way G5b found the reach-table citation was
  wrong and G6a found czerny299 had zero usable fingering data.
- `ops.addSection`/`addPhrase` are new — write them carefully against `scoregraph/ops.js`'s existing conventions
  (check how the existing single-entity ops there are structured, e.g. `splitEvent`/`setKey`, for the pattern
  this project uses for a graph-mutating op with provenance).
- If any number or claim in this doc turns out wrong once you've actually built something, correct it here in
  a new §12 "Implementation record" — this is not optional, it's this project's established discipline.

## 12. Implementation record

### G7a — SongGraph analysis: key regions, harmony, melody/bass, sections, phrases/cadences, voice roles, energy (2026-09-28)

**Headline.** All of §5's scope is built and tested, Node-only (`songgraph/`, `tests/songgraph/`,
`npm run test:songgraph`, 44/44 passing; wired into the CI gate alongside `test:difficulty`). No
split was needed — this phase's honest scope turned out to fit in one pass, unlike some earlier
Goals (G4b/c/d). The two passes with real ground truth (harmony, melody/bass) are measured against
it directly, on the real hymn corpus, not assumed: **harmony 89.2% root+quality / 93.1% root-only
agreement with hymn SATB; melody 100.0%, bass 99.0%**. Sections, phrases/cadences and the energy
curve have no ground truth anywhere in this repo to measure against (confirmed, not assumed — see
below) and are exercised by the mutation suite instead. Performance is 53ms worst-case in Node
(sonatina/020, 158 measures/1423 notes), comfortably inside §8's 500ms budget — confirmed realistic,
no correction needed.

**What was built** (Node only, not loaded by the app; scoregraph/ gets exactly two new ops):
- `scoregraph/ops.js`: `addSection(from, to, opts)` and `addPhrase(from, to, opts)`, matching the
  existing single-op/`edit()` pattern (`setKey`, `addClef`, `addSpanner`). Both validate their
  measure/part/parent/section references (`E-OP-TARGET`) before writing, and both take `prov:
  {op, source: {kind, tool, version}}` — a new `Draft.sourceOf(desc)` generalizes G3's existing
  `source()` (which is fixed to one `{kind,tool}` per edit) to any number of caller-chosen sources
  reused across calls by `{kind,tool,version}` equality, since G07's analyzers register several
  distinct tools (`ppp.songgraph.sections`, `ppp.songgraph.phrases`, …) where G3 only ever needed
  one. `Draft.provRefOf(prov)` turns `{op, source}` into the `ProvRef` the schema actually requires
  (`src` must be a real registered `Source` id — the design doc's own `prov: {op:'inferred',
  src:'songgraph'}` phrasing reads as a bare string, but the schema's `ProvRef.src` is `T.ref(['sr'])`;
  a first implementation attempt hit `E-ID-FORMAT`/`E-PROV` immediately and made this concrete).
- `songgraph/util.js`: `beatGrid(g)` (every notated beat window, from `time.js`'s own
  `meterAt`/`groups` — the same beat grouping `metric()` uses), `noteWindows(g, opts)` (every
  sounding note, once, reused by every other module instead of each re-walking `g.parts`),
  `pcWeights`/`overlap`/`soundingAt`.
- `songgraph/keys.js`: `keyRegionsOf(g, opts)` — wires up `pro-spell.js`'s `regionKeys()` directly,
  per §3/§11's instruction; no second key-detection algorithm.
- `songgraph/harmony.js`: `fitChord(hist, bassPc)` (12-bin pitch-class histogram → best {root,
  quality} over 9 triad/seventh qualities, scored as in-chord weight minus a penalty on
  out-of-chord weight minus a small per-tone size bias, with a bass-note-agreement bonus small
  enough to only break real ties) and `harmonyOf(g, opts)` (one fit per `beatGrid` window, over the
  duration-weighted pitch-class content of every part combined).
- `songgraph/voices.js`: `melodyBassOf(g, opts)` (per voice, the fraction of the part's shared
  onset instants where that voice sounds the highest/lowest pitch — "melody"/"bass" almost by a
  chorale or keyboard texture's own definition — plus a confidence margin over the runner-up) and
  `voiceRolesOf(g, opts)` (melody/bass as above, 'inner' for a 3rd+ voice, 'accompaniment' for a
  2-voice part's non-melody voice, e.g. a keyboard LH that both harmonizes and carries the bass).
- `songgraph/sections.js`: `sectionsOf(g)` — an **exact-repeat** detector. Each measure gets a
  content signature (every note's voice/onset-offset/pitch-class/duration, across every part, not a
  pitch-class histogram — see the correction below); candidate run lengths [16,8,4,2] measures are
  tried longest-first, a run that recurs verbatim (2+ non-overlapping copies, octave differences
  tolerated since pitch class rather than absolute MIDI is used) claims those measures under one
  shared label, and whatever is left becomes its own single-run section. `promoteSections` writes
  the result via `ops.addSection` only.
- `songgraph/phrases.js`: `cadencesOfPart`/`phrasesOf(g, opts)` — cadence detection grounded in
  this phase's own harmony+melody output, exactly as the design doc's §5 directs
  ("harmonic-rhythm/melodic-closure signals," not an arbitrary heuristic). Primary signal:
  **authentic** (a dominant-function chord resolving a fifth down, i.e. V-I/V7-I or IV-I, with the
  melody voice landing on and holding a note at least as long as the arrival beat). Only when a
  part has *no* authentic cadence anywhere (and the piece has more than one distinct chord at all —
  see the correction below) does a weaker **harmonic-rest** fallback fire: the same chord held
  across an entire measure while the melody also stops moving. `promotePhrases` writes the result
  via `ops.addPhrase` only.
- `songgraph/energy.js`: `energyOf(g, opts)` — density (onsets/beat), spread (sounding-register
  width), thickness (mean simultaneous notes at an onset) all min-max normalized per piece, folded
  with a printed dynamic's 0..13 index (2x weight) **only where one is printed** — `dynamic: null`
  otherwise, never invented.
- `songgraph/index.js`: `analyze(g, opts)` (every pass above, plus `ref: scoreRef(g)`),
  `isFresh(g, sg)`/`refresh(g, sg, opts)` (recompute `fingerprint(g)`, compare to `sg.ref.fp`; a
  stale SongGraph is always fully re-analyzed, not patched via `idMap` — see the note below),
  `promote(g, sg, opts)` (sections first, then phrases, since a phrase can name a `section`).
- `songgraph/tools/hymn-ground-truth.js`, `hymn-eval.js` (the reporting CLI that produced the
  numbers below) and `corpus-check.js` (crash/performance/key-region sanity over the full 369-file
  corpus). `!songgraph/tools/` added to `.gitignore` (the same root-`tools/`-swallows-everything gap
  G6a hit).
- `tests/songgraph/`: 44 tests, `npm run test:songgraph`, wired into `.github/workflows/bench.yml`'s
  gate job alongside `test:difficulty`.

**Harmony and melody/bass, measured against real hymn SATB ground truth** (design doc §4's
correction: printed chord symbols are unusable, all 550 licence-quarantined in `czerny299`; hymn
SATB is real and usable instead). 96 of the 100 `catalog/hymns/*.musicxml` files carry the full
`1/2/5/6` (soprano/alto/tenor/bass) voice-label convention (3 are `1,5` only — soprano+tenor, no
independent alto/bass line to compare against; 1 is `1,2,5` — no bass; both are simply excluded
from the harmony comparison, not padded with a guess); all 100 have at least voice 1 or voice 6, so
melody and bass are each checked separately against whichever of the two exists per file.

- **Harmony**: 5,586 beats compared (every beat where at least 3 of the 4 SATB voices sound,
  across the 96 full-SATB files) — **89.2% root+quality agreement, 93.1% root-only**. The ground
  truth is the chord `fitChord` itself computes from exactly the 4 written pitches sounding at the
  beat's onset (a "vertical-slice" reading); the detector is the same `fitChord` run on the
  duration-weighted content of the *whole* beat window across all four voices. The gap between the
  two is exactly what an onset-vs-window comparison should surface: passing tones and suspensions
  inside a beat that the window-based detector sees and the instantaneous slice does not. Per-file
  agreement ranges from 100% (5 files, e.g. `o-come-emmanuel`, `when-i-survey`) down to 24%
  (`for-all-the-saints`, only 29 comparable beats — a passage where alto/bass rest often, leaving
  thin, more ambiguous 3-voice slices).
- **Melody/bass**: melody (voice 1) correct in **100/100** files; bass (voice 6) correct in
  **95/96**. This is a real measurement, but an "easy" one for this stratum by construction — a
  four-part chorale texture puts the soprano on top and the bass on the bottom almost by the
  convention's own definition, so a top-voice/bottom-voice feature is close to definitionally
  correct here. It is a legitimate general feature (it also correctly separates RH melody from LH
  bass in every method-book piece checked, §5's "building on the melody/bass work" for voice roles),
  just not a hard test of anything subtler than "which staff is which" for this particular stratum.
- **No ground truth exists for the non-hymn corpus** (design doc §5's instruction, followed rather
  than assumed): checked directly, not guessed — `grep`-ing every file under this phase's corpus
  roots (`catalog/`, `samples/`, `tests/bench/corpus/`, `tests/fixtures/`, the same roots
  `tests/scoregraph/tools/g3-corpus.js` defines) for `<lyric>` found none outside `catalog/hymns/`
  (two unrelated fixtures under `tests/engrave/fixtures/`, not one of those corpus roots, do have
  lyrics, and are not evaluated). No other melody-tagging convention exists in the committed corpus
  either. `voices.js`'s header states this gap explicitly; `hymn-corpus.test.js` has a standing
  assertion that fails loudly if this ever stops being true, so a future addition to the corpus
  can't silently go unnoticed.

**Sections, phrases and energy have no ground truth to measure against, anywhere in this repo** —
confirmed, not assumed, the same honesty the melody/bass gap gets. `structure.sections`/`phrases`
were schema-only before this Goal (§3); no annotated form/cadence/energy dataset exists. These are
exercised by the mutation suite (§7) instead of an accuracy number: a real, present structure (a
verbatim repeat, a genuine V-I resolution, a real key change) must be found, and a look-alike
near-miss must not be over-claimed. Real-corpus sanity (not accuracy): over all 369 importable
corpus files, `sectionsOf` finds at least one verbatim repeated passage in **53.9%** of pieces
(average 5.88 sections/piece), and `phrasesOf` finds an authentic cadence in most pieces (902
authentic vs. 159 harmonic-rest-fallback cadences over 1,061 total; average 3.76 phrases/piece).

**Two real regressions found and fixed while building this, both by looking at real output, not
assumed correct on the first attempt:**
1. **Section detection's first version signatured a measure by its pitch-class histogram alone**,
   and over-matched constantly: two measures sitting on the same tonic triad "matched" regardless
   of what tune was written over it (a hymn in G major restates a plain G-B-D triad in many
   unrelated measures). `amazing-grace.musicxml` came back with 7 sections from 8 spurious
   "repeats" before this was caught. Fixed by signaturing the *exact* note content (voice, onset
   offset, pitch class, duration) instead — deliberately narrower (misses a transposed repeat) but
   no longer conflates "same chord" with "same passage." `sections.test.js` plants exactly this
   case (same harmony, different melody) as a standing regression guard.
2. **Cadence detection's first "harmonic-rest" fallback fired on almost every measure** of a
   typical hymn (any measure ending in a held chord + a held melody note — common on beats 3-4 of a
   4/4 hymn line) — `amazing-grace` got 7 "cadences" in 17 measures. Tightened twice: the fallback
   now requires the chord held across the *entire* measure (not just its last beat), only fires at
   all when a part has zero real authentic cadences, and is skipped entirely for a piece with only
   one distinct chord from start to end (a sustained drone has no harmonic rhythm to pause in — it
   is not that every bar-end is a rest, it is that nothing ever moves). `phrases.test.js` plants
   both a real V-I cadence and a static single-chord piece as standing regression guards.

**Corrections to this doc's own claims, from real measurement:**
1. **§4/§5's "hymns modulate more than method-book pieces" does not hold for this corpus.**
   `songgraph/tools/corpus-check.js` ran `regionKeys()` over all 305 corpus files long enough to
   have windows (≥12 measures) and found **zero** with more than one distinct key region — hymns
   included. This corpus's hymn arrangements and method-book pieces are both, in fact, single-key
   throughout. This is a fact about this specific corpus, not a claim that hymns or tonal music in
   general don't modulate.
2. **`regionKeys()` had no test anywhere in this repo before G07** (confirmed by grep across
   `tests/`) — the design doc's "already correct" (§3, §11) was accurate but, until now, was never
   actually exercised by a test that plants a real modulation. `tests/songgraph/keys.test.js` and
   `mutation.test.js` are the first: a synthetic 16-measures-C-major-then-16-D-major fixture (long
   enough to give the Viterbi real evidence on both sides — a 12+12 first attempt sat right at the
   window-size boundary and stayed a single compromise region, which is itself informative about
   how much evidence `regionKeys` needs, not a bug) is correctly split into two regions.
3. **§5's "promotion... `prov: {op:'inferred', src: 'songgraph'}`" reads as a bare string `src`,
   but the schema requires `ProvRef.src` to be a real registered `Source` entity id.** `addSection`/
   `addPhrase` instead take `prov: {op, source: {kind, tool, version}}` and register-or-reuse the
   source via the new `Draft.sourceOf`, exactly as G3's own `source()` already does for its one
   fixed source per edit.
4. **§5's freshness plumbing is implemented as "always re-analyze," not the `idMap`-remap fast
   path the design doc allows as an alternative.** At 53ms worst-case (§8, 9x under budget),
   re-analysis from scratch is cheap enough that the fast path isn't needed yet — noted here as a
   real, deliberately-not-taken optimization, not a correctness gap.

**Mutation suite (§7), all three planted defects caught:**
- **A planted wrong key** (transposing the second half of a piece up a step): `keyRegionsOf` splits
  it into two regions with different `fifths`, where the clean (untransposed) version is one region.
- **A melody/bass swap** (rewriting the same two lines onto the opposite staff — the tune now in
  the bass clef, the accompaniment in the treble): `melodyBassOf`'s `melodyVoice` moves to the other
  staff's voice, with high confidence retained in both directions.
- **An off-by-one span**: shrinking or shifting a `spanOf` selection by one event changes what
  `resolveSpan` recovers, and the dropped/shifted-past event does not reappear.

**`resolveSpan`/`spanOf` round-trip test (§6, new — did not exist before G07, not to be confused
with G1's unrelated MusicXML-import/export `sg-roundtrip`):** `tests/songgraph/roundtrip.test.js`.
A contiguous single-voice run recovers exactly itself, in the same order; a non-contiguous
selection recovers a real, larger superset (checked to actually be larger, not accidentally exact);
a head id resolves through its owning event; `spanOf(resolveSpan(spanOf(E)))` is a fixed point
(idempotent); and the same checks hold over real corpus graphs (a hymn and a method-book piece), not
only synthetic fixtures. `resolveSpan`/`spanOf` themselves needed no changes — the design doc's
"already correct" held up under this first real exercise of the round trip specifically.

**Performance (§8):** measured over the full 369-file corpus (`songgraph/tools/corpus-check.js`),
worst case **53.6ms** for `analyze()` end-to-end, `catalog/method/sonatina/020.mxl` (158 measures,
1,423 notes — the same file G5/G6's own perf checks already use as the corpus's longest). Next
slowest: `sonatina/016.mxl` 46.7ms, `czerny299/009.mxl` 43.2ms. All comfortably inside the 500ms
budget (§8's own number is confirmed realistic, not revised). `tests/songgraph/perf.test.js` guards
`sonatina/020.mxl` directly so a real regression trips CI without re-running the whole corpus.

**Scope notes.** All of §5 is built; nothing was deferred or split off. `Score.deriveSections` and
the app file are untouched (§13, §2) — no G6-style integration phase is implied or started here.
G7b (the Arrangement Planner) is explicitly out of scope and untouched, per §0.

**Pre-existing, unrelated finding (not caused by this work, not fixed here):**
`tests/scoregraph/server.test.js`'s script-tag-ordering assertion already failed on this branch's
starting commit (`6753a53`, before any G7a change) — confirmed by stashing every G7a change and
re-running `test:scoregraph` (215/216 pass either way, same one failure). The regex expects
`scoregraph/index.js` to be followed by `playability/graph.js` with nothing but whitespace between;
G6b's real script additions (`playability/reach.js`, `analyze.js`, `index.js`, then
`difficulty/*.js`) sit in between today. Left alone — G7a adds no `<script>` tags (it is Node-only,
§13) and fixing an unrelated pre-existing test is out of scope for this phase.

**Independent review (2026-09-28): READY_TO_MERGE, one MAJOR test-quality gap fixed, two MINOR
doc/comment fixes applied.** The review reproduced every headline number from scratch (harmony 89.2%/
93.1%, melody 100.0%, bass 99.0%, performance 53.1ms) and specifically checked the two 100%/99%
figures for leakage — confirmed `harmony.js`/`voices.js` never read SATB voice labels or hymn
conventions; the ground-truth extraction lives only in the eval/test code, never in the detectors.
The `addSection`/`addPhrase` ops, their validation, and the provenance-schema fix were all
independently re-verified against `scoregraph/validate.js`/`schema.js` (both diffs empty — pre-existing
wiring, as claimed).

One real gap found: the committed `sections.test.js` regression test for the histogram-over-match
bug (the near-miss "same harmony, different melody" fixture) does not actually discriminate the
bug — reverting the fix on that small 4-measure fixture still produces a shape-identical false
match (adjacent runs collapse under the same-letter merge either way). The bug and its fix are both
real (confirmed against the real corpus: buggy code gives `amazing-grace.musicxml` 10 sections with
3 duplicated labels; fixed code gives 1), so nothing shipped was wrong — only the safety net was
weak. **Fixed**: added a new test using the real `amazing-grace.musicxml` file, which does
discriminate (verified both directions: fails under a temporarily-reverted buggy signature, passes
under the real fix). Also fixed two MINOR doc nits the review found: `harmony.js`'s comment named a
test file that doesn't exist (corrected to the real `hymn-corpus.test.js`), and `sections.js`'s
module-level docstring still described the discarded histogram-only approach after the function-level
comment had already been corrected (now consistent).
