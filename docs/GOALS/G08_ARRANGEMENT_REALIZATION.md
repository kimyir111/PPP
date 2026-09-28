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

### G8a — Realizer + comparative harness, one of two independent implementations (2026-09-28)

**IMPORTANT — read this before anything else in this section.** This worktree (`D:/PPP-g8`,
branch `g8-arrangement-realization`) had **two concurrent writers** building G8a at the same
time, confirmed directly (not suspected): a second process independently created its own
`arrangement/realize.js`, `arrangement/patterns.js`, `arrangement/voicing.js`, `arrangement/
spell.js` and `arrangement/tools/eval-harness.js`, interleaved with the commits below on this
same branch (`git log` shows both authors' commits alternating by timestamp, same git identity).
This is exactly `parallel-sessions-one-file`'s documented risk ("goal worktrees can have a second
writer even when told 'only writer'"), generalized here beyond the app file to a whole goal
worktree. Neither implementation was stopped or merged into the other — that is a Lead decision,
not one this record makes. **This section documents the implementation under `arrangement/g8a-
realize.js`, `arrangement/g8a-accompaniment.js`, `arrangement/voicelead.js` and `tests/
arrangement/tools/g8a-harness.js` only** (filenames deliberately prefixed/renamed once the
collision was discovered, to stop overwriting the other writer's in-progress files) — the other
implementation (plain `realize.js`/`patterns.js`/`voicing.js`/`spell.js`) is a separate, real
piece of work with its own commits and its own record, not described further here. **Before this
branch is merged, a Lead must explicitly choose one implementation (or a merge of both), not
assume this one is "the" G8a.**

**What was built** (Node-only, not loaded by the app, per §2/§10):
- `arrangement/voicelead.js`: `chordTones(rootPc, iv, size)` (real chord-tone selection from a
  songgraph/harmony.js fit, priority fifth-before-third-before-extension when thinning),
  `voiceGroup(prevMidis, pcs, opts)` (per-voice nearest-pitch-class voice leading from the
  previous window's own voicing, or a fresh close-position voicing seeded from the plan's real
  register when there is none), `clamp` (span/register safety, applied unconditionally on every
  voicing - not only when a check trips, which is what kept this implementation from the
  unbounded-register-drift bug the other implementation found and had to fix separately).
- `arrangement/g8a-accompaniment.js`: the 6 named patterns (block, broken/Alberti, ballad, pop,
  waltz, generative; hymn is a separate literal-materialization mode in the realizer itself, not
  a pattern function - see below), each a pure `(windows, ctx) -> [{w0, w1, midis}]` over
  songgraph/harmony.js's real per-beat-window fits, read once against `arrange_score.py`'s
  `_texture()` (lines 642-733) for prior art (the ballad up-and-back arpeggio idea, the pop
  alternating-bass idea) and independently written against this module's own voiced tones - no
  code, wire-JSON shape or simultaneous-note cap reused from it, per §5/§13.
- `arrangement/g8a-realize.js`: `realize(g, sg, plan, opts)` and `arrange(g, sg, request, opts)`
  (plan+realize in one call). Two modes: **'hymn'** materializes every voice the plan already
  retained verbatim into the hand `arrangement/plan.js` already assigned it - no new note,
  inheriting G7b's own already-checked reach numbers for that exact voice combination (a
  structural way to reach 0 G5 hard violations for real multi-voice material). Every other style
  is **generative**: the RH plays the plan's declared melody voice verbatim (real notes, making
  "melody preserved" a checkable claim rather than a proxy); the LH is realized from the chosen
  pattern, sized 1/2/3 real chord tones by the plan's texture tier (reduced/partial/full) and
  bounded by the request's real G5 hand-profile MAX_SPAN/MAX_KEYS. Fingering: `playability/
  fingering.js`'s real `fingerGraph` (G5b), never re-derived. Provenance: verified against
  `scoregraph/schema.js` directly rather than trusting this doc's own §13 phrasing - `ProvRef.src`
  is a real ref to a registered `Source` (`{kind:'generator', tool:'ppp.g8a', version}`), set once
  as the whole document's `provenance.default` (`{src, op:'generated'}`), the same mechanism
  `tests/scoregraph/g3-helpers.js`'s `mk()` fixture builder and G7a's `addSection`/`addPhrase`
  already use - not a per-entity `{op, src:{kind,...}}` inline shape as a literal reading of §13
  might suggest.
- `tests/arrangement/g8a-realize.test.js` / `g8a-mutation.test.js` (`npm run test:arrange`, 9/9
  passing, deliberately named `g8a-*` rather than `realize.test.js`/`mutation.test.js` to avoid
  colliding with the other implementation's own tests in the same directory): all 6 styles build
  a valid 0-hard-violation graph on a real hymn; an unknown style fails cleanly; the generative
  styles keep the melody voice pitch-identical to the source, note for note; hymn style
  materializes every retained voice verbatim; the same plan realized twice is byte-for-byte
  identical (the "golden... same input, same output" requirement of §8, measured the same way
  G7b's own suite measures determinism - a same-run repeat-call comparison, not a new on-disk
  golden-file mechanism nothing else in this codebase uses for this purpose); the mutation suite
  (§8): the SAME planted 2-octave-dyad-bass fixture `tests/arrangement/mutation.test.js` uses
  fails cleanly through `arrange()` with G7b's own real `UNREACHABLE` reason at every hand
  profile; the SAME real degraded corpus case G7b's own mutation suite uses
  (`catalog/hymns/for-all-the-saints.musicxml`, `melodyConf`/`bassConf` exactly 0.0/0.0) realizes
  conservatively (texture `reduced`) at 0 hard violations rather than crashing or fabricating
  confidence, at both `block` and `hymn` styles.

**Real corpus sweep beyond the committed tests** (60 real files across `catalog/hymns/`,
`catalog/method/sonatina/` and `catalog/method/beyer/`, x 3 target levels, x all 6 styles = 975
attempts): **678/975 successful realizations, 0 crashes, 0 realize-level failures, 0 G5 hard
violations on any successful realization** (the 297 non-attempts are `arrangement/plan.js`
itself declining `UNREACHABLE` before G8a ever runs - a G7b coverage number, not a G8a defect).
Two real bugs found and fixed during this sweep, both from real corpus files, not hypothesized:
1. **A pickup/anacrusis measure overrun.** `songgraph/util.js`'s `beatGrid` sizes every measure's
   beat windows by the METER in force (its full beat count), not that specific measure's own
   (possibly shorter) written duration - real for a pickup measure, where the meter's later beat
   windows fall entirely past the measure's true end. A generated LH event derived from such a
   window could therefore extend past a short measure's real boundary. Fixed by clamping (and, if
   entirely beyond the true end, dropping) at the one place a generated event turns into a real
   `(measure, at, dur)` position - never an out-of-bounds event the validator would reject.
2. **A register-extreme spelling failure.** At a register extreme, `scoregraph/pro-spell.js`'s
   own key-based spelling table can pick a letter that needs to "borrow" from the octave above or
   below (e.g. a low pitch class spelled as B# rather than C), producing an `oct` outside the
   schema's required 0-9 range - `pro-spell.js`'s own note-line DP (`spellVoice`, not used here,
   see below) never hits this in real melodic lines because it always has a diatonic alternative
   nearby to prefer; G8a's accompaniment voicing has no such DP. Fixed with a real fallback via
   `pro-spell.js`'s own exported `candidates(midi)`: the first spelling (smallest `|alter|` first)
   whose octave actually lands in range - never an invented pitch class, only a different, equally
   real spelling of the same sounding pitch.
   `scoregraph/pro-spell.js`'s own `spellMidi` is a small **private** helper (not in its export
   list, checked directly) - reproduced verbatim (4 lines, read from the source, not guessed)
   rather than changing another Goal's already-reviewed module's public surface for G8a's sake.

**Performance** (§9's own ≤1s/piece estimate, checked, not assumed): the full committed
`catalog/` corpus (325 importable files) x 3 target levels x `analyze()`+`plan()`+`realize()` =
975 attempts, 363 successful (the same `plan()` coverage limit as above). **Worst case 72ms**
total (`catalog/method/sonatina/013.mxl`, stage 3), **p99 35ms**, **p50 5ms** - comfortably inside
budget, the same "confirmed realistic, not revised" finding every prior G5/G6/G7 phase reports
for its own perf estimate.

**The comparative evaluation harness** (`tests/arrangement/tools/g8a-harness.js` +
`legacy-arrange-score.py`, gitignore-exempted like every prior phase's own tools directory,
`!tests/arrangement/tools/` added to `.gitignore`): extends the G5a baseline (`docs/GOALS/
G05_PLAYABILITY_FINGERING.md` §11 - one fixture per legacy engine, one of the five metrics) to a
real 17-file corpus sample (10 hymns + 7 method-book pieces) x 2 target levels (G6 stage 2 and 3,
crosswalked to the legacy engines' own `beginner`/`intermediate` labels - **a declared,
approximate crosswalk**, since G6's numeric course scale and the legacy engines' 4-tier label
have no exact equivalence) = 34 inputs, scored on all five metrics for G8a's own `block`-style
output and all three legacy engines' `balanced`-style output. Every legacy engine is invoked
read-only:
- `arrange_score.py`: a real corpus piece converted to its wire-score shape
  (`scoregraph/legacy-score.js`'s `toScore`, adapted), piped to a new stdin/stdout sidecar script
  (`legacy-arrange-score.py`) that calls its own `Arranger` class unmodified.
- The in-app `ScoreArranger`: the SAME extraction `tests/playability/arranger-baseline.test.js`
  already uses (`tests/playability/score-arranger-extract.js`), never touching the app file.
- `audio-score.js`'s `arrangeNotes`: real "heard notes" synthesized from the piece's own real
  note timing (`playability/graph.js`'s `attacksOf`, already tempo-aware), matched back to their
  source event/head after thinning (never invents a pitch, per its own header comment - matches
  a genuine subset of what it was given).

Each legacy engine's very different output shape is turned into a real `ScoreGraph` via a
harness-only adapter (`wireNotesToGraph`/`audioScoreToGraph`) that reuses the ORIGINAL piece's own
unchanged timeline (every measure/meter/key/tempo), so every output's real beat windows line up
with the original's for the melody-preservation and harmony-agreement metrics - the same real
`scoregraph/pro-spell.js` spelling table G8a's own realizer uses, and a multi-layer voice
allocator (the same idea `scoregraph/legacy-score.js`'s own `fromScore`/`layerFor` uses) for the
same-hand overlaps a single ScoreGraph voice cannot represent (a held bass note under a
freshly-struck upper note in the same hand is real and common in these engines' own output).

**The real head-to-head, stated plainly** (34 inputs; G8a scored on 29/34 - `arrangement/plan.js`
itself declines the other 5 as `UNREACHABLE` before G8a ever runs, a real coverage gap disclosed
here, not excluded from the comparison silently):

| Metric | G8a | arrange_score.py | ScoreArranger | audio-score.js | G8a better than all 3? |
|---|---|---|---|---|---|
| G5 hard violations (mean, %zero) | 0, 100% | 0, 100% | 0, 100% | 0, 100% | **No - tied**, not better |
| G6 level within +/-1 (%) | 44.8% | 50.0% | 50.0% | 50.0% | **No - worse** |
| melody preservation (mean) | 1.000 | 0.987 | 1.000 | 0.936 | **No - tied with ScoreArranger** |
| harmony agreement root+quality / root-only | 0.860 / 0.983 | 0.385 / 0.559 | 0.839 / 0.891 | 0.831 / 0.886 | **Yes** |
| engrave L1 silent / L2 hard (mean) | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 | **No - tied**, and structurally uninformative here (see below) |

**§7's acceptance bar ("better than all three legacy engines on every metric, on the same
inputs") is NOT met.** G8a wins clearly only on harmony agreement. It ties (not strictly beats)
on G5 hard violations, melody preservation (tied with ScoreArranger specifically) and engraving,
and is measurably WORSE than all three legacy engines on G6 level-within-±1. This is reported
plainly, the same way G6a reported missing its original bar, per the task's own instruction not
to narrow the comparison to favorable metrics.

**Caveats a reader needs to weigh this table honestly, not hidden:**
- This run uses a DELIBERATELY GENTLE slice of each legacy engine's own real range: `balanced`
  style only, and only the `beginner`/`intermediate` levels. The G5a baseline (§11 of G05's own
  doc) measured `arrange_score.py` and `ScoreArranger` hitting a hard violation in most combos
  across their FULL style x level range (7 styles x 4 levels including `cinematic`/`jazz` at
  `advanced`/`original`). This harness's 0/0/0/0 hard-violation row does **not** contradict that
  finding - it measures a narrower, gentler slice and should not be read as "the legacy engines
  are actually always safe."
- G8a's G6 coverage (29/34) is lower than every legacy engine's (34/34, since none of them
  refuses an input the way `arrangement/plan.js` does). The 5 excluded inputs are omitted from
  G8a's averages entirely; whether including them would have raised or lowered G8a's numbers is
  not something this run measures, and is not assumed either way.
- Engraving L1/L2 reads 0/0 for all four because none of the four evaluation graphs carries
  dynamics, pedals or lyrics (the harness's own adapters strip to bare notes for comparability) -
  this metric leg had very little to trigger on for any engine in this run, not a genuine
  engraving-quality finding.
- The G6 stage <-> legacy-level crosswalk (`STAGE_TO_LEGACY` in the harness) is a declared
  approximation; a different, equally defensible crosswalk could move this number.

**Scope actually completed vs. this doc's own §6a/§13 sketch:**
- All 6 named patterns built and exercised on real corpus material - not split off.
- The evaluation harness covers all 5 metrics on a real multi-file sample - not split off,
  though the corpus sample (17 files) is a real, chosen slice, not the full 369-file corpus (G7b's
  own `corpus-check.js` full-corpus sweep was judged not necessary to add a 6th head-to-head
  metric; the 60-file/975-attempt internal sweep above already gives real, full-range evidence
  for G8a's OWN quality independent of the legacy comparison).
- The golden/determinism requirement (§8) is met via same-run repeat-call comparison, not a new
  on-disk golden-file mechanism - a deliberate choice to match G7b's own precedent rather than
  invent a second determinism-testing convention in the same codebase.
- H-8 (the blind human review) is explicitly NOT started here, per §10's own instruction not to
  schedule it until the evaluation harness already shows the realizer is in the right ballpark -
  the real numbers above do not clearly clear that bar (see the acceptance-bar finding), so H-8 is
  left for the Lead to decide whether to run anyway, run against the OTHER implementation instead,
  or hold until further tuning.
- G8b (legacy retirement, the review-screen fix, the `PPP.arranger` switch) is untouched, per
  its own explicit exclusion from this phase (§2, §6b).

**What in this doc turned out wrong or needed correction, once something real was built:**
- §13's phrasing of the provenance shape (`{op:'generated', src:{kind:'generator', ...}}`) reads
  as a per-entity inline shape; the real, schema-correct mechanism is a document-level
  `provenance.default` referencing a registered `Source` id, exactly as this section's "what was
  built" describes - confirmed by reading `scoregraph/schema.js`/`scoregraph/build.js` directly,
  per §13's own instruction to check fresh.
- §13 anticipated a possible split ("G8a-1: the realizer" vs. "G8a-2: the harness") if honest
  scope didn't fit one phase; it did fit, for this implementation - both the realizer and the
  full-5-metric harness landed in one phase, on real corpus evidence.
- The design doc's own informal expectation (never stated as a hard requirement, but implicit in
  §7's framing) that a deterministic v1 realizer would cleanly beat three much older, less
  G5/G6-aware legacy engines did not hold in this measurement - only harmony agreement shows a
  clear, real win; G6 level accuracy is measurably worse. This is worth the Lead's attention before
  deciding whether v1's pattern-density-by-texture-tier policy (1/2/3 chord tones) needs tuning
  against G6's real per-stage bands (`arrangement/reference.js`) rather than a fixed mapping, and
  before any H-8 review or production-flip discussion.
