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
  accuracy ground truth (per-hand agreement with what the edition actually printed).
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
  whatever book-fixture cases the legacy model already had correct (the roadmap cites 17; confirm the real count
  when the legacy module is read).
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

(Grows here as each phase lands — G5a first.)
