# G08 — Arrangement Realization (style arranger)

## 0. Status

Architect 2026-09-28 (Lead). Depends on G7 (SongGraph + Arrangement Planner, merged `b344688`), G5 (playability,
deployed), G6 (difficulty, deployed), G4 (engraving, deployed). Full roadmap entry:
`docs/PPP_MASTER_ROADMAP.md` §5.6. This doc covers **G8 v1 only** (deterministic realizers). G8 v2 (AI-3, a
model proposing realizations) needs decision **D-3** and is out of scope until v1's real numbers exist — see §3.

Pre-implementation research corrected two roadmap assumptions before any code was written — see §4.

## 1. Goal

Turn a G7b `ArrangementPlan` into an actual two-staff piano ScoreGraph — real notes, playable by construction
(0 G5 hard violations), on the target G6 level, engraved cleanly by G4. This is the first Goal in the G5-G9
chain that writes new musical content rather than only analyzing or planning around existing content.

## 2. Non-goals

- No multi-candidate search or learned critic (G9).
- No audio input (G10).
- No adaptive per-player variants (G11).
- No v2 model work (AI-3) — that needs D-3, decided only once v1 has real measured numbers (roadmap's own
  ordering, not a new restriction invented here).
- **No production flip.** `PPP.arranger` defaults to `'legacy'`; nothing a real user sees changes until a
  separate, later, explicit flip decision (same shape as G4's M-H1/M-H2-gated flip) — H-8 informs that decision,
  it does not happen automatically once G8 merges.

## 3. D-3 is not needed for this phase

v1 is 100% deterministic (a pattern library + voice leading + G5/G6-aware constraints) — no LLM, no trained
model, nothing D-3 (hosted LLM vs. trained/local model vs. deterministic-only) needs to decide between. D-3
only matters for v2, and only once v1's real measured quality (§7) is in hand to decide whether v2 is even
worth pursuing. Do not block this phase on a decision it doesn't need.

## 4. Corrections to the roadmap's own text (found during pre-implementation research)

- **"`arrange_score.py`'s harmony DP either becomes a G7 analyzer or is retired" is a stale fork.** G7a is
  already fully merged with its own independent harmony analyzer (`songgraph/harmony.js`, per-beat-window chord
  fitting, already passed its own acceptance gate against hymn SATB at 89.2%/93.1%). It was built without
  reference to `arrange_score.py`'s Viterbi DP and is not going away. **The only fork left is retire
  `arrange_score.py` entirely** — do not port its DP into G7a; that ship has sailed. (A real, separate future
  question — not this Goal's — is whether `songgraph/harmony.js` would benefit from DP-style cross-window
  smoothing later; note it, don't act on it here.)
- **The G5a legacy-arranger baseline (`docs/GOALS/G05_PLAYABILITY_FINGERING.md` §11) is a partial starting
  point, not a ready-made "same inputs" evaluation harness.** It measured exactly one fixture per legacy engine
  and only the "G5 hard violations" leg of G8's five-metric acceptance bar (§7). G8 must build the broader
  harness itself — more corpus files, all three legacy engines plus G8's own output, all five metrics — reusing
  the fixture and the G5/G6/G4 tooling that already exists (§5), not reusing the *evaluation scope* as if it
  already covered everything.

## 5. What already exists — reuse, do not rebuild

- **`arrange_score.py`** (833 lines, Python, reads/writes a flat "wire" JSON, never touches a ScoreGraph): to be
  **retired**, not ported. Its `_texture()` (lines 642-733) is informal prior art worth reading once for the
  arpeggiation-index math (`ballad` style) and the alternating bass/voicing pattern (`pop` style) before
  designing G8's own pattern library from scratch on the graph — do not copy its code (it has no G5/G6/graph
  awareness beyond a crude simultaneous-note cap) or its wire-JSON shape.
- **The wire-score round trip** (`Piano Coach App.dc.html`: `wireScore()` ~9253-9264, `arrangeWithService()`
  ~9294, `fromEngine()` ~9265-9285) — a `Score` → flat JSON → HTTP → Python → flat JSON → `Score` round trip.
  Becomes obsolete once the arranger works on a ScoreGraph in-process; deleting this whole path is part of §6's
  scope (S6), not incidental cleanup.
- **The review screen's XML re-parse** (`applyRichReviewArrangement`, `Piano Coach App.dc.html` ~13836-13894) —
  already logged as technical debt (roadmap §13 TD2, which already names "arrangement" and cites G8 as the fix).
  It builds `built.graph` (a real graph) then discards it, reparsing `built.xml` via `parseMusicXML` instead,
  then throws that away again for `wireScore`'s flat JSON. Fixing this is S4's scope (§6) — hand `built.graph`
  straight to the graph-native arranger.
- **G4's engraving quality gates**: `tests/engrave/l2.js` + `tests/engrave/tools/bench.js` already compute
  `eg.ledger.silent` (L1) and `eg.layout.hard_violations` (L2 hard) as zero-target metrics. G8 runs its own
  output through the existing tool (`bench.js run --suite <new-suite-for-G8-output>`) — no new instrumentation.
- **`PPP.arranger` switch convention**: does not exist yet, but `PPP.fingering`/`PPP.difficulty` (both merged
  this session) establish an exact, clean pattern to copy verbatim — `get`/`set` on `window.PPP`, default
  `'legacy'`, any unrecognized value coerces to `'legacy'` ("G4-F2-1's convention," cited in both existing
  switches' own comments).
- **H-8's methodology precedent**: `tests/engrave/tools/review-build.js` (M-H1/M-H2's blind-packet builder) was
  deleted in this session's legacy-renderer removal and could not be reused unmodified even if it existed — it
  compared two *renderings* of the same notes (legacy vs. engrave), while H-8 compares two *different arrangers'
  different note content* (legacy vs. G8), a different comparison shape entirely. Reuse the **methodology**
  (documented in `docs/GOALS/G04_PROFESSIONAL_ENGRAVING.md` and `docs/DECISIONS.md`: deterministic seed-based
  blind X/Y assignment via a hash, a manifest that states selection rules but never the seed/assignment rule,
  independent review of the packet-builder before trusting it blind, an interactive rating artifact rather than
  a hand-filled file) — build a new packet-builder to this standard, not a resurrection of the old tool.

## 6. Scope

### (a) Core realizer (G8a — Node-only, no app touch)

- A pattern library of textures: block chords, broken chords/Alberti, ballad arpeggio, hymn 4-part, simple pop
  comping, waltz. Ground each pattern in what G7a's SongGraph and G7b's plan actually provide (voice roles,
  texture tier from G7b's full/partial/reduced ladder, harmony-per-window) — do not invent a pattern the input
  data can't actually drive.
- Voice leading between successive harmony windows (smooth motion, not per-window are re-randomized voicings).
- Limbs and fingering: call G5's actual modules (`playability/reach.js`, `playability/fingering.js`) rather than
  re-deriving hand/finger assignment.
- Output: a real ScoreGraph, `provenance: {op: 'generated', src: {kind: 'generator', ...}}` (check the real
  provenance schema shape — G7a's review already found and fixed a doc/schema mismatch here once; verify
  against `scoregraph/schema.js` directly, don't assume the shape from this doc).
- **The comparative evaluation harness** (§4's correction): build the real "same inputs, all five metrics"
  comparison — G8's own output plus all three legacy engines, across a real corpus sample (more than one
  fixture each), scored on: G5 hard violations (reuse `playability/analyze.js`), G6 level vs. target (reuse
  `difficulty/index.js`), melody preservation (compare against the G7b plan's declared melody voice / G7a's
  melody identification), harmony agreement (compare against G7a's `songgraph/harmony.js` output for the same
  piece), and engraving L1/L2 (§5's existing tooling).

### (b) Legacy integration and retirement (G8b — touches the app file, full review cycle)

- **S6**: retire `arrange_score.py`, its HTTP endpoint, and the wire-score round trip (`wireScore`/
  `arrangeWithService`/`fromEngine`) once G8a's realizer is wired in as the replacement.
- **S4**: fix `applyRichReviewArrangement` to adopt the arranger's own output graph directly (it already has
  `built.graph` in scope — stop discarding it) instead of re-parsing XML.
- New `PPP.arranger` switch (`'legacy'` default, `'g8'` opt-in — or whatever value naming reads best, following
  the established convention exactly).
- This phase is the one with real app-file risk (removing a whole existing arrangement pathway) — full
  independent review, same discipline as G5c/G6b.

## 7. Acceptance

On the real comparative harness (§6a), G8's output must be, on the same inputs as all three legacy engines:
- **0 G5 hard violations** on every output (not "fewer than legacy" — zero).
- **G6 level within ±1** of the `ArrangementRequest`'s target level.
- **Melody preserved** (matches the plan's declared melody voice/register).
- **Harmony agreement** with the SongGraph's own harmony analysis for the same piece.
- **Engraving L1 silent 0, L2 hard 0** on the realized output.
- **Better than all three legacy engines** on every one of the above, on the same inputs — not just "passes
  its own bar" the way G6a's narrower win was accepted; the roadmap sets a genuine head-to-head bar here.

## 8. Regression

`test:arranger` (the existing arranger test suite — check if it's `tests/arranger_test.py` from §4/§5's
research, decide whether to extend or replace), new `test:arrange` (Node, for the graph-native realizer),
golden arrangements (deterministic — same input, same output, byte for byte), a mutation suite (a planted
unreachable target, a section G7b marked `degraded: true`, must degrade gracefully here too, not crash or
silently produce a confidently-wrong arrangement).

## 9. Performance

v1: ≤ 1s per piece.

## 10. Human review

**H-8, diagnostic**: about 8 inputs × 2 levels, blind against the legacy arranger. Build a new blind-packet
tool following M-H1/M-H2's methodology (§5) — do not schedule this until G8a's real output exists and the
evaluation harness (§6a) already shows it's in the right ballpark; a blind human review of an obviously-broken
first draft wastes the reviewer's time the same way it would have in G4.

## 11. Rollback

`PPP.arranger = 'legacy'` (G8b). Default is `'legacy'` from the moment the switch exists — no production flip
happens as part of this Goal (§2). A flip is a separate, later, explicit decision informed by H-8, the same
shape as G4's M-H1/M-H2-gated flip.

## 12. Not yet

No production flip (G9's territory per the roadmap, or a later explicit Lead+user decision once H-8 exists —
whichever the roadmap actually specifies when this Goal is closer to done; do not assume G9 automatically owns
this without checking the roadmap again at that time).

## 13. Notes for the G8a implementer

- Start with the evaluation harness (§6a's second half) before or alongside the realizer itself — you need a
  real way to measure "0 hard violations, level ±1, melody preserved, harmony agreement, engrave clean" against
  real legacy-engine output before you can honestly claim G8 beats it. Building the harness first (or in
  lockstep) avoids the trap of tuning the realizer against your own untested intuition about what "better" means.
- Read `arrange_score.py`'s `_texture()` (lines 642-733) once for prior art, then design G8a's pattern library
  from scratch against the SongGraph/plan data actually available — do not port its code or its cap-based
  playability check (`_finalize_notes`, a crude simultaneous-note-count cap, not real G5 reach-table awareness).
- Verify the real provenance schema shape (`scoregraph/schema.js`) before writing `{op:'generated', ...}` —
  G7a's own review already caught a doc/schema mismatch here once (`prov:{op:'inferred', src:'songgraph'}` vs.
  the schema's actual `{op, source:{kind,tool,version}}` requirement); check fresh rather than assuming this
  doc's phrasing is exactly right.
- If G8a's honest scope turns out too large for one clean phase, say so and propose a split, the way this
  project has done before (G4b/c/d, and G7a's explicit permission to split that ended up not being needed).
- If anything in this doc turns out wrong once you've built something real, correct it in a new §14
  "Implementation record" — standard practice in this project by now.

## 14. Implementation record

(Grows here as G8a lands.)
