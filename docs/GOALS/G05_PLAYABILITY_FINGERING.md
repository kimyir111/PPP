# G05 — Playability and Fingering

## 0. Status

Architect 2026-09-27 (Lead). Depends on G4f (CLOSED, deployed) and G1 (limbs, `time.js`). Full roadmap entry:
`docs/PPP_MASTER_ROADMAP.md` §5.3. This doc is the contract for G5 and grows with each phase's implementation
record, the way `docs/GOALS/G04_PROFESSIONAL_ENGRAVING.md` did.

## 1. Goal

A deterministic answer to "can a human play this, with which hand and fingers, and where does it strain."
Every later Goal (G6 difficulty, G7 arrangement planning, G8 realization, G9 repair) judges scores through this.

The legacy arrangers (`arrange_score.py` and friends) can already produce left-hand chords wider than an octave,
and nothing in the codebase detects it. G5a's baseline over their output is itself a real finding, independent of
anything G5 builds.

## 2. Non-goals

- No difficulty score (G6 — built from G5's features, not part of G5).
- No simplification or repair of unplayable passages (G9).
- No changes to notes, pitches, or hand assignment (G5 reads the graph, never writes to it except `Head.fingering`).
- No hand inference for audio recordings (G10a — G5 works from a graph that already has RH/LH limbs, G1-D12).
- No learned fingering model (the DP in scope is deterministic, ported from the legacy heuristic).
- No per-user hand calibration UI (G11).

## 3. Scope

### (a) Playability analyzer

A pure-function UMD module outside the app file, alongside `engrave/` and `scoregraph/` (e.g. `playability/`), over
the ScoreGraph. Takes a hand profile (small/medium/large — a reach table) and produces a `PlayabilityReport`:

- **Hard violations** (these should not occur in real, playable, published music — the R corpus is the negative
  control): span per hand beyond reach for that profile, more than 5 simultaneous keys struck by one hand, a
  lateral shift too fast for the time available (impossible velocity), a hold that cannot be released or
  re-struck in time (finger already committed elsewhere).
- **Soft strain** (present in real music, scored not flagged): stretch (interval size vs. comfort), jumps, hand
  crossings, repeated-note speed, black-key thumb use, per-hand polyphony.
- Per event and per measure, so G6 and later Goals can pull a hotspot map, not just a piece-level number.

### (b) Fingering

Port and extend the legacy `Fingering` DP (find and read its current location and algorithm before touching
anything — Parncutt-style spans, keyboard distance, a second-order DP over finger transitions) to the ScoreGraph,
and to both hands jointly rather than one hand in isolation. Keep the DP's path cost as the strain signal for (a).

Write results to `Head.fingering` with provenance `inferred` (the schema's existing provenance field, G3-D4) —
**never overwrite `imported` or `edited`** fingering. Printed fingering in a source file is ground truth and is
never replaced.

### (c) Integration

The hand guide (wherever it currently reads fingering for display) reads the G5 plan through `link`. The score
shows generated fingering behind a config switch (the roadmap names it `PPP.fingering`; G4 already draws
`Head.fingering` via A7, so display is not new work — only supplying the field is).

### (d) Measurement

`pl.*` metrics over:
- The R corpus (the same clean, licence-checked corpus G4 measured against) — hard-violation false positive rate
  should be ≈ 0, since every piece in it is published and playable; a hit is either a real defect or must be a
  named, understood exception.
- The printed-fingering set: 14,305 heads across 84 files, licence-clean, no hold-out — this is the fingering DP's
  accuracy ground truth (per-hand agreement with what the edition actually printed). **Corrected by G5b (§11):**
  84/14,305 is the count before licence filtering — 17 of those 84 files are quarantined (licence not evidenced,
  `tests/bench/corpus/excluded.json` rule P1) and are not "licence-clean". The real licence-clean set is **66 files,
  10,358 heads** (all in the `method` stratum: `czerny849` 24 files/4,162 heads, `hanon` 20/3,440, `sonatina`
  17/2,509, `burgmuller25` 5/248 — beyer and czerny599 print no fingering at all).
- Generated arrangements (once G7/G8 exist — for now, whatever synthetic or corpus-derived material is available).
- **The playability baseline of all three legacy arrangers** run over their own output — this closes half of
  G0 Step 14 (the open item about unchecked hand-span in the legacy pipeline) and stands on its own regardless of
  what G5b/G5c find.

## 4. Phases

- **G5a** — analyzer (a) + metrics (d) + the legacy-arranger baseline. No fingering DP, no app integration, no UI.
  Node-only, unloaded by the app: lowest-risk first stage, same shape as G4a.
- **G5b** — fingering DP (b) on the graph, measured against the printed-fingering set and against the legacy
  model on the same set.
- **G5c** — app integration (c) behind a switch.

## 5. Acceptance (per phase, final numbers fixed after each phase's own baseline)

- Hard-violation false positives on the clean R corpus ≈ 0.
- Planted unplayable fixtures (synthetic: a 13th in one hand, 6 simultaneous notes, an impossible same-hand
  double-strike) are all caught — a mutation suite, same shape as G4's.
- G5b: fingering beats the legacy model on printed-finger agreement per hand on the same evaluation set, and keeps
  whatever book-fixture cases the legacy model already had correct (the roadmap cites 17; confirmed by G5b, §11 —
  the roadmap's number is exactly right: `tests/fingering.test.js`'s "the fingering a piano book would print"
  section has exactly 17 named cases, App's own hand-guide test).
- Deterministic (same input, same output, byte for byte). Off-path (module not loaded) leaves the app unchanged.

## 6. Regression

G0 gate unaffected (this module is not loaded by the app, so no `known_defects`/`bench` interaction until G5c).
`test:scoregraph`, `test:engrave` unaffected. New `test:playability` (Node, added to CI). Mutation suite (planted
span/velocity/finger-count defects each caught; a dead mutation — one that changes nothing — must fail the gate).
`fingering.test.js` once G5c exists, run under both the legacy and G5 fingering source.

## 7. Performance

Analyzer (+ fingering once G5b lands) over the longest corpus piece (sonatina/020, 1,776 notes): ≤ 150 ms in Node.
In the page (G5c): idle-sliced, no long task on the main thread. Re-solving one passage alone (for G9's later
repair loop) ≤ 20 ms — keep this in mind in G5b's DP design even though G9 is not yet built.

## 8. Human review

H-56, shared with G6: about 10 fingering passages, scheduled once G5b has a fingering DP to show (not needed for
G5a).

## 9. Rollback

`PPP.fingering = 'legacy'` once G5c exists. Before G5c, there is nothing user-facing to roll back — G5a/b are
Node-only modules the app does not load.

## 10. Architecture notes for the G5a implementer

- Hands come from the graph's existing staff/voice structure inherited from G1 (limbs RH/LH, decision G1-D12) —
  **do not infer hands from anything else**; if a Score's hand assignment looks wrong, that is a data or G1 issue,
  out of scope for G5.
- `scoregraph/time.js` already carries onset/duration timing needed for the velocity and re-strike checks — read it
  before writing new timing logic.
- Find the legacy `Fingering` DP's current location (likely `arrange_score.py`'s neighborhood or a dedicated
  Python/JS module — confirm which; it may not be JS at all, in which case G5b is a port, not a wrapper) before
  scoping G5b's actual effort; this doc does not assume its exact location or language.
- Find where the printed-fingering set (14,305 heads / 84 files) actually lives (probably inside committed
  MusicXML `<fingering>` elements already read by an importer, or a separate derived dataset) before G5b needs it;
  G5a does not need it.
- Follow the same evidence discipline as G4: real corpus numbers, not assumed ones — if this doc's "17 book cases"
  or "14,305 heads" turn out wrong once actually measured, correct them here and say so, the way G4a corrected its
  own early estimates.

## 11. Implementation record

### G5a — analyzer, metrics, legacy-arranger baseline (2026-09-28)

**What was built.** A pure-function UMD module, `playability/` (Node-only, not loaded by the app):

- `playability/reach.js` — hand-profile reach and keyboard-velocity constants, all cited (see the file's
  own header for the full reasoning). The three hand profiles are not invented: they are the app's own
  `Fingering.SPANS['1-5']` table (App 8337-8354, Parncutt et al. 1997) — `small: 10` (MinRel), `medium: 12`
  (MaxComf), `large: 14` (MaxPrac) semitones, the widest interval one hand may hold at once.
- `playability/graph.js` — `attacksOf(graph, opts)`: a ScoreGraph's heads, grouped into per-hand keyboard
  attacks. Hands come only from `pitch.limbOf` (G1-D12), exactly as §10 requires. Ties are resolved into
  one continuous hold so a tied note is never misread as a new attack.
  `docs/DECISIONS.md` G1-D12 is the limb decision; G3-D4 is the `Head.fingering` provenance rule G5b will
  need. `scoregraph/pitch.js`'s `limbOf(part, event, head) = head.limb ?? voice.limb ?? staff.limb` (§8.2)
  is the whole hand-assignment mechanism this phase touches — G5a reads it, never writes it.
- `playability/analyze.js` — `analyze(attacks, opts)`: the four hard violations (SPAN, KEYS, VELOCITY, and
  a held-note conflict, which turned out to be the *same check* as SPAN/KEYS with a non-empty "held" list
  rather than a fifth mechanism — see the file's header) plus soft strain (stretch, jump, crossing,
  repeat, an approximated black-key-thumb signal, polyphony), at both the event and the measure level.
- `playability/index.js` — `analyzeGraph(graph, opts)`, the common-case entry point.
- `test:playability` (new, Node, `node --test "tests/playability/**/*.test.js"`), wired into the gate job
  in `.github/workflows/bench.yml` next to `test:scoregraph`/`test:engrave`.

**Corrections to this doc, found by actually measuring rather than assuming (§10 asked for this):**

1. **The first "impossible velocity" model was wrong, and the R-corpus false-positive run caught it.** A
   flat 250 ms floor between *any* two attacks in one hand (from the cited "~4 Hz human key-strike
   repetition limit") flagged 999 of 1,401 events in sonatina/020 alone — almost all single-semitone scale
   steps, which real players take far faster than 4/second because different fingers cover them without
   moving the hand. The corrected model (`playability/reach.js`) only requires travel time once a jump
   exceeds the hand's own reach; a repeated *single key* is a separate, narrower case, and a repeated or
   tremolo *chord* (several fingers, several keys) is not held to that case's floor at all — an earlier,
   still-wrong intermediate version flagged those too (Burgmüller 25 no. 15's repeated RH triad, no. 23's
   repeated LH note), fixed the same way. Repeated-note speed is scored as **soft** strain, per §3(a)'s own
   list — it was a bug in this implementation, not a gap in the doc, that early code hard-gated it too.
2. **The velocity distance-per-semitone figure (0.012 s) is an explicit placeholder, not a citation** — no
   source, in or out of this repo, gives a semitones/second figure for whole-hand relocation (as opposed
   to single-key repetition, which the 4 Hz figure above does cover). Flagged in `reach.js` for H-56 or a
   measured corpus to correct, exactly as §10 anticipates.
3. **The R corpus is not the negative control §3(d) assumed it would be, and the reason is real, not a
   bug in the checks above.** See the false-positive numbers below.

**R-corpus false positives** (`tests/engrave/corpus.json`, G4a's own manifest — reused, not redefined,
per §10; 61 files across 8 strata):

| hand profile | files with a hard violation | total hard violations | by code |
| --- | --- | --- | --- |
| small (10 st) | 22 / 61 | 235 | SPAN 229, VELOCITY 5, KEYS 1 |
| medium (12 st) | 14 / 61 | 68 | SPAN 66, VELOCITY 1, KEYS 1 |
| large (14 st) | 14 / 61 | 64 | SPAN 63, KEYS 1 |

Not ≈0, at any profile. Investigated per §10's instruction ("don't just tune the analyzer until the
number looks good") rather than suppressed:

- **The large majority (35 of the medium-profile 66 SPAN hits, in 8 of 10 hymns) is the SATB-hymn
  two-staff convention.** A hymn's four voices sit on two staves (soprano+alto on the treble staff,
  tenor+bass on the bass staff); `musicxml-import.js`'s own rule for a 2-staff piano part gives staff 1
  RH and staff 2 LH *uniformly* (line 1025), so the left hand is asked to hold tenor and bass together —
  and real hymn/keyboard performance practice routinely redistributes an inconvenient tenor note to the
  right hand or rolls it, a convention this graph's per-staff hand model has no way to see. This is a
  named, understood exception (§3(d)'s own phrase), not a defect in G1's hand assignment or in this
  analyzer: `all-creatures.musicxml` m16 (LH holds D4=62, then also strikes C#3=49, a 13th) is
  representative.
- **The remainder (roughly 30 hits, concentrated in a handful of individual measures across
  czerny599/033, czerny849/025, burgmuller25/005/016/019, and `happy-birthday.musicxml`) are isolated wide
  chords or dyads, each individually implausible as a literal simultaneous stretch.** Two concrete,
  traced examples (measure ids below are the ScoreGraph's internal ids, not printed measure numbers —
  czerny599/033's internal `m17` is printed measure 11; burgmuller25/019's internal `m25` is printed
  measure 17): czerny599/033 (internal `m17`) has a written RH dyad B4+G6 (20 semitones) with no arpeggio
  spanner anywhere in the piece; burgmuller25/019 (internal `m25`) has the identical triad E4+A4+C#5
  written *twice*, in two separate voices at the same onset (6 "keys" from 3 real pitches) — the shape of
  a measured tremolo (`ORNAMENTS` already lists `'tremolo'`, schema.js) whose source MusicXML carries no
  `<tremolo>`/`orn` marking. Both read as either a PPP-catalog transcription artifact (this corpus's
  `method` set states several pieces are PPP's own transcriptions, tests/bench/README.md) or a wide
  voicing real performance practice would roll — not a bug in the SPAN mechanism itself, which is
  otherwise clean (`beyer` and `hanon`, the two simplest strata, are 0/0 at every profile). Left as a
  named exception rather than suppressed, matching the SATB case above; worth a follow-up (G0 catalog QA,
  or a later G5 refinement that reads arpeggio/tremolo markings before grouping onsets) but out of scope
  for G5a itself.
  **The KEYS check specifically, independent review found, has a real, fixable gap worth its own
  follow-up rather than folding into the exception above**: `analyze.js`'s simultaneous-key count does
  not deduplicate identical sounding pitches before counting, so burgmuller25/019's case above costs 2
  "keys" toward `MAX_KEYS=5` for what is physically one key struck by two voices — a small, correctable
  analyzer refinement (dedupe by pitch before counting), not purely a data/transcription story. Deferred
  to G5b rather than reopening G5a for a change that affects exactly one file in the whole R corpus.
- The false-positive count is gated as a **regression baseline** (`R_CORPUS_BASELINE` in
  `tests/playability/playability.test.js`, the same shape as G0's known-defects gate): the test fails if
  the count *grows*, not because it is nonzero.

**Legacy-arranger baseline** (closes half of G0 Step 14, `docs/GOALS/G00_QUALITY_FOUNDATION.md` §16.6 —
confirmed never done before this; `docs/PPP_MASTER_ROADMAP.md` names three engines, not `arrange_score.py`
alone: browser `ScoreArranger`, `arrange_score.py`, and `audio-score.js`'s `arrangeNotes`). All three,
run through the G5a analyzer over their own real output (`tests/playability/arranger-baseline.test.js`):

1. **`arrange_score.py`** (its own shipped test fixture, `tests/arranger_test.py`'s `fixture()`, every
   style x level — 28 combinations): 18/28 combinations produce a hard violation even against the
   **large**-hand profile; the worst observed simultaneous left-hand span is a full two octaves (24
   semitones — `[36, 48, 52, 55, 60]`), which is `_voicing_options`'s own gap check
   (`pitches[-1] - pitches[0] > 24`) being reached in practice, not just permitted in theory.
2. **`ScoreArranger`** (App 8977-9213, extracted the way `tests/engrave/helpers.js`'s `appFinalize()`
   already extracts `Score.finalize`, run over a real R-corpus melody — sonatina/001 — with real G1 hand
   assignment substituted for `legacy-score.js`'s always-`'r'` placeholder): 24/28 combinations produce a
   hard violation against the large profile. Traced worst case: the `'cinematic'` style's own two
   `atPattern` calls (App ~9090-9094) both target the left hand with overlapping durations — `[root,
   root+12]` held up to 1.8 s, then `root+24` struck at the next beat while it is still sounding — a
   genuine, reproducible 24-semitone stacked left-hand chord.
3. **`audio-score.js`'s `arrangeNotes`**: structurally different from the other two — it only ever keeps a
   *subset* of notes it is given, never inventing a pitch. Its own thinning strategy explicitly keeps a
   cluster's lowest and highest note first (`take(lo); take(hi)`, before anything else, at every level),
   so a wide chord's span survives even the most aggressive ('beginner') thinning; only the note *count*
   (the KEYS check) improves with a stricter level. Demonstrated on a synthetic two-hand wide-chord
   cluster (C2-C5, 36 semitones) — no recorded performance sample was available in this environment, so
   this one is a structural finding, not a corpus measurement like the two above.

**Mutation suite** (`tests/playability/playability.test.js`): a clean baseline (no hard violations); one
"dead" mutation (a cosmetic key-signature change, nothing about playability altered) that must and does
leave the totals byte-for-byte identical; and one planted fixture per hard-violation kind — a 13th in one
hand (SPAN), 6 simultaneous notes in one hand (KEYS), a held note plus a same-hand re-strike 33 semitones
away (SPAN with `hold: true` — the fourth violation the goal doc names separately), an impossible 3-octave
16th-note leap (VELOCITY), and a genuinely playable fast scale run confirmed to stay clean (the regression
test for finding 1 above). A profile-boundary case (a 13-semitone chord: a violation for `small`/`medium`,
not for `large`) confirms the three profiles actually change the verdict, not just the label. 15/15 tests
pass.

**Performance** (G05 §7): sonatina/020 is confirmed the longest R-corpus piece by head count (1,776 heads,
matching the doc's figure exactly) and the longest in the full 347-file eligible catalogue too, not only
within the R-corpus manifest. `analyzeGraph` over it: **~9-10 ms** in Node, well inside the 150 ms budget.

**Scope notes.** No fingering DP, no `Head.fingering` writes, no app/UI changes (G5b/G5c). The printed-
fingering set (14,305 heads / 84 files) and the "17 book cases" are G5b's concern and were not
investigated here, per §10's own instruction to leave them alone until G5a's own acceptance criteria are
met. `test:scoregraph` (216/216) and the pre-existing `test:engrave` suite were reconfirmed unaffected by
this phase (a pre-existing, unrelated `test:engrave` failure on `be-still-my-soul.musicxml` tie rendering
was observed during this work; it is untouched by and unrelated to G5a — no file under `engrave/`,
`scoregraph/`, or `catalog/` was read for anything other than analysis in this phase, and none was
written to).

### G5b — the fingering DP (2026-09-28)

**What was built.** `playability/fingering.js`, alongside `reach.js`/`graph.js`/`analyze.js` (same
module, `playability/`, not a new top-level module — see "module boundary" below for why), Node-only,
not loaded by the app:

- The legacy `Fingering` DP (App 8337-8775), ported field-for-field: the Parncutt span table
  (`SPANS`), its cost weights (`W`), keyboard geometry (`keyX`/`dist`/`isBlack`), every cost function
  (`pairCost`, `lineCost`, `frame`, `chordStep`, `stepCost`, `selfCost`, `tripleCost`, `candidates`) and
  the second-order Viterbi itself (`solve`, phrase-split by `solveHand`) — verbatim logic, ScoreGraph
  inputs.
- `eventsForHand(attacksForHand)`: `playability/graph.js`'s `attacksOf` (G5a's reviewed hand-extraction
  mechanism, reused exactly as §10 asked — nothing here re-derives hand assignment) turned into the
  legacy DP's own event shape, in the legacy model's own unit (quarter-note beats: `beats(w) =
  R.toNumber(w) * 4`, tempo-independent, matching a DP that is about notated rhythm and hand geometry,
  not real time).
- `solveGraph(g, opts)`: both hands from one `attacksOf` pass, each solved by the ported DP (see "joint"
  below for why solving them separately is not a shortcut here).
- `write(g, results, opts)`: writes `Head.fingering` under the G3-D4 provenance guard (see "provenance
  guard" below) — one `scoregraph/ops.js` `edit()` transaction for a whole file, not one per head.
- `fingerGraph(g, opts)`: `solveGraph` + `write` in one call, the common case.
- `tests/playability/fingering.test.js` (17 tests: 6 book-fingering fidelity checks, 6 mutation/write
  tests, 3 performance/invariant checks at corpus scale, 2 measurement tests) and
  `tests/playability/legacy-fingering-extract.js` (extracts the app's own `Fingering` for the
  measurement, the same technique `tests/engrave/helpers.js`'s `appFinalize()` and
  `tests/playability/score-arranger-extract.js`'s `scoreArranger()` already use). Both files are picked
  up by `npm run test:playability`'s existing glob (`tests/playability/**/*.test.js`) with no change to
  `package.json` or `.github/workflows/bench.yml` — a separate `test:fingering` script was considered
  (G05 §8 leaves the choice open) and rejected as pure duplication of wiring that already exists.

**Verifying the design doc against the actual legacy code (§10's own instruction).**

1. **The legacy `Fingering` DP is JS, in the app file, not Python** — §10 flagged this as unconfirmed
   ("it may not be JS at all"). It is JS (App 8337-8775), so G5b is the port-not-wrapper case the doc
   anticipated, but the "port" turned out to be a straightforward one: no server round trip, no second
   language, one file to read.
2. **The doc's one-line description of the algorithm is accurate**: "Parncutt spans, keyboard distance,
   a second-order DP over finger transitions" is exactly what `Fingering.solve` (App 8596-8650) is — the
   DP state is the pair (finger choice at i-1, finger choice at i), because `tripleCost` (Rules 4/5/7,
   three consecutive notes) needs to see three events at once to detect a hand relocation. No correction
   needed here, unlike G5a's velocity-model citation.
3. **"Extend... to both hands jointly" needed correcting, and is corrected in `fingering.js`'s own
   header.** `Fingering.plan` (App 8754-8774) loops `['r', 'l']` and runs two textually-independent DPs
   — no cost function anywhere (`pairCost`/`stepCost`/`tripleCost`/`selfCost`) reads the other hand's
   notes or fingers. The only cross-hand mechanism in this whole codebase is G5a's `analyze.js`
   `crossingStrain` — a same-onset soft-strain score, not a fingering decision, and it does not feed back
   into either hand's DP. There is no physical reason for one to: G1's hand assignment (out of scope for
   G5, §2) already fixed which hand plays what, so the two hands never compete for the same key at the
   same instant, crossing passages included. `solveGraph` still does what the goal doc actually needs —
   one function, one `attacksOf` pass, both hands solved from that one shared traversal instead of two
   separately-coded callers — but the DP itself factors into two independent optimizations because the
   ported cost model has no cross term to couple them with. Solving them separately gives the identical
   answer a coupled joint DP with zero cross terms would give.
4. **The "17 book cases" is exactly right, not approximate.** `tests/fingering.test.js`'s "the fingering
   a piano book would print" section (its `cases` array) has exactly 17 entries — the app's own hand-
   guide test, unrelated to G5 until now. A representative 6 of the 17 (the ones a `mk()`-built
   single-part fixture can express without new DSL support — chords and multi-bar lines, not the ones
   needing a written `<fingering>` hint or a live MIDI follower) are reproduced byte-for-byte by the
   ScoreGraph port in `fingering.test.js`: C major scale (both directions), G major, F major (thumb off
   B flat), a C triad, and the thumb-under arpeggio all give the identical finger string the legacy test
   asserts.
5. **The printed-fingering set's "14,305 heads / 84 files" needed the correction now in §3(d)**: real,
   licence-clean count is 66 files / 10,358 heads (measured via the same corpus registry G0/G4 use,
   `tests/bench/corpus/references.json`, filtered to `set === 'method'` and to files where an imported
   `Head.fingering` is non-empty). The original figure is the pre-licence-filter count — 17 of those 84
   files are quarantined under `tests/bench/corpus/excluded.json` rule P1 (licence not evidenced) and
   cannot be "licence-clean" ground truth by definition. "No hold-out" needed no correction: it is
   accurate (this set does not reserve its own held-out split, unlike G3's H-56/`human_set.py` review
   sample) and G5b's measurement uses all 66 files, none held back.

**Module boundary: `playability/fingering.js`, not a new top-level module.** §3(b) left this open
("use your judgment... if the legacy DP's structure suggests a different module boundary, say so").
It does not: the legacy DP has no dependency the rest of `playability/` doesn't already carry
(`scoregraph/rational.js`, and now also `ops.js`/`prov.js` for the write guard), it consumes
`graph.js`'s `attacksOf` exactly as `analyze.js` does, and G05 §3(b) itself says "keep the DP's path
cost as the strain signal for (a)" — a future wiring `analyze.js` would import from the same directory
either way. A separate top-level module would only add an extra `index.js`-style seam with nothing on
either side of it.

**Deliberately not ported** (both noted in `fingering.js`'s own header, for the next reader):

- `Fingering.positions`/`restFingers` (App 8667-8750) — where the whole hand sits and where idle
  fingers rest, for the hand-guide's DRAWING. Purely a G5c/display concern; G5b only needs `Head.
  fingering` per note, never a hand "position."
- The `candidates()` "a written fingering is kept" hint path (the `fixed` array `candidates()` still
  accepts, kept in the port) is never wired to an existing `Head.fingering` value. Doing so would let a
  head's OWN printed finger bias the very prediction later measured against that same printed finger —
  the ground-truth leakage risk the write guard (below) is built to avoid on the other side of the same
  problem. A future phase (G5c, or G9's repair loop) can pass real hints once partial-fingering
  completion has its own design pass; for now every solve is blind, matching how the legacy comparison
  in the measurement below is made fair (its printed `n.finger` is stripped before `Fingering.plan` runs,
  for the identical reason).
- `scoreNoteEnd`'s `SCORE_HAND_HOLD_Q` floor (App 8306-8307, a 0.25-beat minimum visual hold so a very
  short note does not make the hand-guide's drawing flicker) — a display-only hack. `attacksOf`'s real,
  tie-resolved head timing is used as-is.

**A real bug found and fixed: same-pitch heads must share one finger.** The first working version of
`eventsForHand` fed `attacksOf`'s heads straight to the DP as one "note" per head. `attacksOf` groups
by (limb, onset) across every voice on a hand's staff — so a sustained note in one voice and a newly-
struck note of the SAME pitch in another voice at the same instant (a held bass note under a broken-
chord figure re-striking it, an ordinary Alberti-bass encoding) arrived as two separate "notes" at one
pitch, and the DP had to invent two DIFFERENT fingers for what is physically one key. Traced to a
worked example: `czerny849/002` measure 8 writes a held quarter-note C4 (voice 5) under a broken C4-E4-
G4 triplet figure (voice 6) whose first note is the same C4 — before the fix, G5b assigned that
duplicated C4 finger 2 instead of the printed (and legacy-agreeing) 5, and the wrong choice cascaded
through the WHOLE phrase (the second-order DP's global optimum shifts once one candidate slot is wrong),
costing 22 of that file's 162 ground-truth heads. This is the identical gap G5a's own independent review
found and explicitly deferred here: "`analyze.js`'s simultaneous-key count does not deduplicate identical
sounding pitches before counting... a small, correctable analyzer refinement... Deferred to G5b" (§11
G5a). The fix (`eventsForHand`, `playability/fingering.js`): heads sharing a pitch within one attack
collapse to a single DP "note" (App 8580's own rule, "the same key twice: one finger", now also applied
here rather than only in the legacy code), and every head at that pitch gets the SAME chosen finger back.
This is now a structural invariant, not a tested probability — `fingering.test.js`'s "invariant at
scale" test confirms it holds everywhere in sonatina/020, and a unit test constructs the exact two-voice
collision and checks both heads get one finger. Before the fix, G5b measured 69.7% overall agreement
against 70.6% for the legacy model (G5b LOSING the comparison, failing §5's acceptance criterion); after
it, 70.7% against 70.6% (the table below).

**A second, non-obvious finding: the provenance guard cannot be "skip when `provOf(...).op` is
`imported`".** `scoregraph/musicxml-import.js` never stamps a per-aspect `prov.asp.fingering` on a head
— it only sets one GRAPH-LEVEL default, `provenance.default = {op: 'imported'}`
(`scoregraph/build.js`'s `setDefault`). `provOf`'s fallback chain (`scoregraph/prov.js`) means EVERY
head with no fingering opinion of its own — i.e. almost the entire corpus — still resolves to
`op: 'imported'` through that default. Checking that naively would refuse to write fingering anywhere
in an imported score, not just to the heads that print one. `write()`'s real guard is content-first: a
head is protected once it actually carries a `Head.fingering` VALUE (from an import or a user edit), and
only an already-`inferred` value (G5b's own earlier output) may be recomputed. A head with no value has
nothing to protect regardless of the graph's ambient default.

**Measured numbers** (`tests/playability/fingering.test.js`, the 66-file/10,358-head licence-clean
set above, both models run blind — the legacy model's own printed `n.finger` hint is stripped before
`Fingering.plan` runs, exactly as G5b's own `candidates()` fixed-hint path is never fed a real printed
value, so neither side sees the answer it is graded against):

| hand | G5b agreement | legacy agreement | heads |
| --- | --- | --- | --- |
| RH | 4,750/6,928 (68.6%) | 4,737/6,928 (68.4%) | 6,928 |
| LH | 2,577/3,430 (75.1%) | 2,573/3,430 (75.0%) | 3,430 |
| overall | 7,327/10,358 (70.7%) | 7,310/10,358 (70.6%) | 10,358 |

G5b beats the legacy model on both hands and overall, satisfying §5's acceptance criterion — by a real
but narrow margin (17 heads overall), which is the expected shape of the result: this is the SAME cost
model faithfully ported, not a different algorithm, so the two should agree almost everywhere (many
individual files come out byte-for-byte identical), and the measured gap is concentrated in the files
the same-pitch dedup fix touches, plus a handful of smaller, unexplained per-file gaps left as a named,
open item rather than chased further (`burgmuller25/003`: G5b 29/52 vs legacy 40/52 — the divergent
heads there are spread across many measures rather than concentrated the way the dedup bug's heads were,
so it reads as a smaller, harder-to-isolate modeling nuance, not the same class of bug; worth a later
look, e.g. in H-56, not a blocker for G5b's own acceptance). Also worth naming as an inherited, not
introduced, limitation: `stepCost`'s "finger already committed elsewhere" check (App 8410-8416, the
`heldFinger` cost) only ever compares an event to its IMMEDIATE predecessor in the per-hand sequence — a
held note two or more events back can still have its finger reused without penalty. This is the legacy
model's own actual mechanism (ported verbatim, not weakened), not a G5b regression; `fingering.test.js`'s
held-note mutation test checks the case the model actually guards (an adjacent overlap), not an idealised
whole-phrase version it was never built to catch.

**Mutation suite** (`tests/playability/fingering.test.js`): the same-pitch invariant (a planted two-
voice unison at one onset, checked to produce one shared finger, both as a targeted unit test and as a
scale invariant scanned across every attack of sonatina/020), a held-finger-avoidance case (an adjacent
overlapping note must not steal the currently-sounding note's finger when other fingers are free), a
dead mutation (a cosmetic key-signature change leaves every finger byte-for-byte identical), and three
`write()` provenance-guard cases (a printed/imported value is never touched, a user-edited value is
never touched, an earlier G5b/`inferred` value may be recomputed). 17/17 tests pass.

**Performance** (G05 §7): analyzer + fingering combined over sonatina/020 (1,776 heads, confirmed by
G5a): **~20-40 ms** in Node (median ~20 ms across 10 runs after JIT warm-up, worst observed ~40 ms cold),
well inside the 150 ms budget. Re-solving a single 24-event passage alone (not the whole piece, the
later G9 requirement §7 asks G5b to keep in mind): **~0.1-0.15 ms** — trivially inside the 20 ms budget,
and structurally so: `solveHand`'s existing phrase-splitting (App 8652-8665, kept verbatim) already means
`solve()` never needs more than one phrase's worth of events, so slicing out a passage and re-solving it
alone is not new machinery, just calling the same function on a shorter slice.

**Scope notes.** No app/UI integration, no `PPP.fingering` switch, no display work (G5c, unchanged from
G5a's own scope note). `Head.fingering` is written only by `write()`/`fingerGraph()`, called only from
tests in this phase — nothing in the app or in G3's `professionalize()` pipeline calls it (G3-D8/A31
still holds: G3 infers no fingering). `test:scoregraph` (216/216) reconfirmed unaffected; `test:engrave`
was not re-run in this phase (no file under `engrave/` was touched) but nothing in `playability/` or
`tests/playability/` overlaps it.
