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

(Grows here as G7a lands.)
