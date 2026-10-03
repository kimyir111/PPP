# G10 — Audio → correct notation

## 0. Status

Architect 2026-10-02 (on Opus), worktree `D:/PPP-g10`, branch `g10-design` from `origin/main` `415a4c4`
(= production). Design only: no code, baseline or app file changes in this commit. Roadmap card:
`docs/PPP_MASTER_ROADMAP.md` §5.8 (G10), with G3a/G3b folded in (§4, G03 §31).

**Why now.** The product owner (a piano teacher) spent days flagging "strange rests" bar by bar in the
score PPP made from their YouTube piano transcription. Seven fixes shipped in three days (#123, #125, #129,
#130, #132, #133, #134), most of them removing one class of rest after the fact. The teacher's verdict: the problem is the
system design, not the bars; "fix the system properly and go into G10". This document is that redesign.

**One-paragraph summary.** A transcription model hears a *performance* (when each key went down and up).
A score is a different object (bars, beats, written values, hands, voices). PPP converts one into the
other in a single file of hand-tuned rules (`audio-score.js`), on a heuristic beat map, and has stopped
measuring the result against truth. G10a keeps both objects in the ScoreGraph that already has room for
them (notation layer + `performances` layer), rebuilds the conversion as staged, measured functions with
small statistical models where the choice is genuinely ambiguous, and judges every stage on a ground-truth
benchmark that needs no user time and no licensed audio: the public-domain catalogue played by a
humanizer calibrated on the teacher's real transcription, plus the same scores rendered and re-transcribed
by the real models. The first phase (G10a-0) is that benchmark — and repairing the CI gate, which has not
run past its unit tests on `main` since 2026-09-27.

## 1. What was measured before designing (evidence)

All numbers below were measured for this document at `415a4c4` (scripts and logs in the Lead's scratchpad
`scratchpad/g10/`: `calib.js`, `catalog-overlap.js`, `grid.js`, `holes.js`, `replay-amt.py`, and G0 runs in
an independent `git archive` copy, `scratchpad/g10/tree`). Where a number comes from an earlier record, the
record is named.

| # | Finding | Numbers |
| --- | --- | --- |
| E1 | **The G0 gate has not run on `main` since MX-2.** `bench.yml` stops at its first step (bench unit tests) on every push since `ca70a03` (2026-09-27): three unit tests encode pre-MX-2 facts about the hymns (defect counts, an untrusted key, open ties). The smoke/core/robust run+check steps never execute. Separately, the `robust` and `full` locks were not refreshed by MX-2 (`INPUT_DRIFT`: 148 and 2,560 differences). | 83 consecutive failed `bench` runs on `main`; last green 2026-09-27T14:23Z (#56). Every recording fix (#123-#134) and G5-G9 merged while this gate was red. Failing: `test_review_fixes.KnownFailuresAreMeasured.test_counts`, `test_final_review_fixes.WholeScoreSequences.test_an_untrusted_key_is_not_trusted_bar_by_bar_either`, `test_scoregraph_roundtrip.CorpusOpenTies` |
| E2 | **G0 measures the library default, not what the app runs.** The app passes `closeGaps: true, exactBars: true` (and so onset durations, `REST_MIN` 1/8) at its four recording call sites; the bench's suites pass `stage.opts = {}`. Measured both on the same 553 core cases: | core usable **18.1 % → 24.8 %**; `critical.note_values` 49.4 % → **76.3 %**; `notation.duration.accuracy` 0.738 → 0.842; rests per bar 2.88 → 1.03 (reference 0.43); one-note tuplet brackets 100 % → 25 %. robust (releases 30-120 ms early): usable 6.0 % → 26.2 %, note values 17.7 % → 77.0 %. full (4,144 open cases): usable 20.1 % → 27.3 %; **hold-out (832 cases): usable 25.0 % → 30.5 %, note values 40.9 % → 72.6 %** — the gain generalises. **But** the A/B verdict is REGRESSION with 29 failures nobody saw: `critical.accidentals` 3 cases (Burgmüller, Czerny 849; 8va pieces), every 32nd-run micro piece, `feature:tuplets` IOI accuracy −3.4 pts, `notes.onset.f1_50ms` −1.0 pt, 1 pitch-integrity and 1 structure case |
| E3 | **Where the error mass is (app path, core).** Of 416 unusable cases, **340 fail at least one "time skeleton" gate** (metre, playback tempo, beat placement, structure) and 169 fail *only* those. Hands is the most frequent single blocker (25 cases), then playback tempo (24). | By metre, app path, no audio beats (= production): 4/4 usable 31 % (meter 0.90 but beat placement 0.46), 3/4 19 %, **2/4 0 %** (written as 6/8 in 77 meter failures), **3/8 0 %**, **2/2 0 %**, **6/8 0 %** (`critical.playback_tempo` fails in 97 %; issue 1, the compound tempo, is the likely cause). With oracle beats: 4/4 65 %, 3/4 74 %, 2/4 still 0 %. `feature:tuplets` beat placement 9 % |
| E4 | **Production runs the browser path only.** Onsets & Frames (`onsets_frames_uni`, tfjs 2.8.6, 30-s windows, 32-ms frames, no pedal output) plus `audio-score.js`'s onset-envelope beat tracker; production has no helper (no TransKun/Kong/Aria, no Beat This, no PM2S). | Production = G0 `beats:none` rows: usable 15.6 % on the app path (13.5 % library default) |
| E5 | **The teacher's real transcription** (`heard-prodZ-b.json`: 1,214 notes, 130.8 s, 9.3 notes/s, 90 bars, written 4/4 at 162). | Onsets and offsets 100 % on 32-ms frames. Chord asynchrony: 57 % of multi-note attacks 0 frames, 43 % one frame. Tempo extremely steady: bar-duration CV **0.7 %** (likely a sequenced cover). Velocity narrow: mean 67, sd 6.5. Onset residual against the written grid: sd 28 ms, \|p90\| 44 ms; 14 % of attacks are > 35 ms from every straight-16th and triplet point. **50 of 90 bars contain a triplet beat** (147 of 720 staff-beats). **Releases: 73 % (RH) / 69 % (LH) of notes are held past the next onset of their own hand** (held ÷ inter-onset ratio: RH p10 0.33, p25 0.78, median 1.83, p75 3.17, p90 8.0; LH 0.31 / 0.71 / 1.17 / 2.40 / 5.0); 27-31 % are released early, median gap 128 ms, 60 % of those gaps shorter than an eighth |
| E6 | **Truth base rates** (312 catalogue files, 82,099 notes, czerny299 excluded). | **93.8 %** of written notes last exactly until the next onset of their staff, 2.1 % longer (held under moving notes), 4.1 % shorter. A written silence sits between two notes of a voice in **4.1 %** of note pairs; **14.9 %** of those silences are shorter than an eighth (Burgmüller 11.4 % of pairs have a rest; Hanon 0 %). 24.5 % of staff-bars have 2+ voices; 6.7 % of events are in tuplets |
| E7 | **The synthetic performers model releases with the wrong sign.** G0 `human` releases 20-80 ms early, `robust` 30-120 ms early, never past the next onset; `tests/repair/rec-synth.js` releases at 0.5-1.0 of the written value + 40 ms. The real data overlaps 70 % of the time. G0's README already says the release models "are not checked against real playing". | Combined with E5/E6: in a real transcription the release says almost nothing about the written value; "written value = time to the next onset of the voice, a rest only with evidence" matches 94 % of written notes |
| E8 | **Real AMT on rendered audio is much cleaner than the real recording** (the six committed `replay-public` fixtures: synthetic `human` performances rendered with Salamander samples, transcribed by TransKun + Kong; truth known). | Onset error +9 ms bias, sd 2.9 ms. Offset error median +12 ms, \|p90\| 191 ms. Missed 1.9 %, extra 3.3 %. Pedal invented in 5 of 6 fixtures (none was played: issue 17). Held ÷ true length p10 0.84, median 1.01, p90 1.11 — no 70 % overlap: the renderer has no pedal, no resonance, no room |
| E9 | **The recording graph already has a performance layer; nothing reads it.** `buildGraph` writes `performances[0]` (`kind: 'source'`): every heard note in µs with velocity and a `link` to the head it became, the pedal, a bar anchor per bar. The validator checks it (`E-PERF`, `W-PERF-LINK-PITCH`); `ops` refuse to retire a linked head (G03 I5); `time.js` maps positions ↔ µs through the anchors; `midi-import.js` exports a performance as MIDI. | The app's player (`PianoScore`) plays the legacy Score's written durations; practice and follow read the Score; the Score of a recording is made by re-parsing the exported MusicXML (`parseMusicXML(built.xml)`, S4 not done). Heard notes survive a saved song only inside the per-device kept graph (IndexedDB); shares keep the packed Score (TD3) |
| E10 | **"Holes" in the one-note copy are a minority.** Current production one-note copy of the teacher's piece: 118 right-hand rests; 1 contains the onset of a heard note the transcription put in the right hand; 15 contain a heard note ≥ C4 that the hand split put in the left hand. The teacher's two older shared copies: 178-187 RH rests, 5-8 and 20-23. | 800 heard notes ≥ C4 vs 487 RH notes kept: confirmed. The rests came mostly from release-based durations (fixed by #134) and secondarily from the hand split, not from thinning |

## 2. The Lead's diagnosis, checked

| # | Lead's statement | Verdict | What the evidence says |
| --- | --- | --- | --- |
| 1 | The AMT outputs a performance, accurate on onsets, weak on offsets and pedal; PPP converts it with hand-written rules; performance-to-score is a research problem of its own. | **Confirmed**, with one precision | E5, E8. In production the AMT is the browser O&F model and the beat map comes from note onsets alone (E4): the helper's Beat This and PM2S, the two "research-grade" pieces in the repo, never run for users. Published approaches (e.g. PM2S, already wrapped by `pm2s_quant.py`; HMM rhythm quantisation; MV2H-style evaluation) evaluate beat tracking, quantisation, metre and hand/voice separation as separate outputs with their own metrics — PPP measures only the end result, and since 2026-09-27 not even that (E1). |
| 2 | "What is drawn = played = judged" forces the notation to inherit the performance's noise; the graph has a performances layer the recording path does not use; the recent fixes lengthened sounding notes to satisfy the invariant and are symptom patches. | **Partly wrong** | (a) The recording path *does* write the performance layer, linked note by note, since G1 (E9); what is missing is any *consumer* of it. (b) The invariant's pressure was real but indirect: because the player plays written values, the old writer kept heard releases as written values so playback would sound like the recording — that is where the wedged rests came from. (c) The last fix (#134, durations from onsets) is not a symptom patch: it is the right rule (G3's R-reg idea: written value from inter-onset intervals), and on G0 truth it is worth +27 points of `critical.note_values` (E2). It was shipped without M11, without G0 measurement, and with regressions G0 would have shown (E2). The earlier rest passes (#123, #125, #129, #130, #133) *are* symptom patches; on new transcriptions they are already no-ops (`tidyRests` returns the same graph) and stay as safety nets for old data. #132 (exact bars, beat-level tuplets) is a correct notation *writer* and stays as the back end (§4). |
| 3 | Everything after the transcription (SongGraph, arranger, critics, one-note thinning) was designed and benchmarked on clean symbolic scores; recording noise is amplified; 26 of 48 lone RH rests sit where RH-range notes were dropped; 800 heard ≥ C4 vs 487 kept. | **Confirmed in principle, number not reproduced** | Every G7-G9 measurement used catalogue pieces ("no catalogue piece is a recording" in every identity run). A recording graph has one voice per staff, so the SongGraph melody is "the right-hand staff", which inherits hand-split errors. 800 vs 487 confirmed. But on my measurement (E10) only 1 of 118 current RH rests (5-8 of ~180 in the older copies) has a dropped right-hand onset inside; 15-23 have a ≥ C4 note the hand split gave to the left hand. Thinning holes are a minority; the hand split is the larger amplifier. (My test: a heard onset inside the rest's span, ±1/32 tolerance; the Lead's 26/48 may use another definition.) |
| 4 | There is no ground-truth benchmark for recordings; quality was judged by the teacher's eyes. | **Wrong as stated; the practical point stands** | G0 *is* a ground-truth benchmark of the recording path: 325 catalogue scores played by a deterministic synthetic performer, 10 critical gates, usable rate, hold-out, plus `replay-public` (real AMT on rendered audio). What is true: it has no real recordings (M11), its release/pedal model is uncalibrated and has the wrong sign (E7), it does not run the app's options (E2), and it has not run in CI since 2026-09-27 (E1). So the last week's fixes were judged by eye alone. G10a-0 fixes all four. |
| 5 | The arranger reduces the transcription instead of generating from an estimated melody + harmony (the G10b lead-sheet idea). | **Confirmed** | §9 recommends a hybrid, gated by measurement. |

## 3. Goal and non-goals

**G10a — piano recording → a score a teacher would hand to a student,** measured against truth, with one
explicit contract between what is written and what was heard. Reopens G3a/G3b (roadmap §4), fixes issues 1,
2, 13, 17, 18 (G0 §14), completes S4 for recordings, lowers the 4-note floor (R4).

**G10b — song audio (voice + band) → a lead-sheet ScoreGraph + SongGraph.** Designed at the end of this
document only as far as its gates; it needs D-4 and a server decision (§14).

**G10c — arrangement for recordings.** How a recording's score feeds G7-G9 without hole artifacts (§9).
Added by this design; it was implicit in the roadmap card.

**Non-goals.** No new AMT model trained from scratch. No copyrighted audio, or notes transcribed from it, in
the repository — ever (the teacher's piece is a private suite, §7.6). No change to printed-score, MusicXML or
MIDI-file import (MIDI files keep the current writer unless a later phase measures v2 on them). No engraving
changes (G4 draws what the graph says). No learner model (G11). No production flip without H-10 and the
user's word.

## 4. What already exists — reuse, do not rebuild

- **G0 benchmark** (`tests/bench/`): reader, truth alignment in seconds, the ten critical gates, usable rate,
  per-tag gates, hold-out rule (`fnv1a32(id) % 5 == 0`, `full` only), locks, mutation-check, golden,
  `replay-public` with the rendered-audio fixtures, `tools/render_piano.py` (Salamander, CC BY 3.0),
  `tools/record_replay.py` (the M11 path), private suites outside the repo (`run --suite-file`). Suites already
  take `stage.opts`, so "run with the app's options" is a suite file, not new machinery.
- **The synthetic performer** `pppbench/perform.py` (LCG-deterministic, profiles deadpan/human/rubato/amt/
  pedal/human-alt, beat profiles none/oracle/oracle-noisy/lowconf). G10's humanizer extends it (§7.3).
- **The ScoreGraph performance layer** (E9) and `time.js` performance time; `Anchor.kind` already allows
  `'beat'`; `PerfNote.conf` and `Flag{kind:'uncertain'|'suspect'}` exist. **No schema bump is needed.**
- **Notation tools** shipped in the last week: `scoregraph/gaps.js` (`tile`, `tidyRests`),
  `scoregraph/rec-tuplet.js` (`addTriplets`), `audio-score.js` exact bars (`exactGrid`, `exactPieces`,
  `snapOnsets`, `CHAIN_COST`), `scoregraph/tools/notation-check.js` (classes 1-10, acceptance 1-7). These are
  correct *writers* of a decided rhythm; G10 keeps them as the notation back end and as assertions.
- **G3 passes, off** (`scoregraph/pro-*.js`): hand DP (`pro-staff`), logical tuplets (`pro-tuplet`), regional key
  and spelling (`pro-spell`), beams (`pro-beam`), R-reg and performance voices (`pro-rhythm`, `pro-voice`,
  `opts.g3b`). Candidate stage implementations, judged on the new benchmark (G10-D14).
- **G7a** `songgraph/` (harmony per beat window, keys, melody/bass): the lead-sheet path's harmony and the
  harmony sub-score of the benchmark.
- **The flow harnesses** in the Lead's scratchpad (`scratchpad/ioi/flow/flow.js` and predecessors): they serve
  a tree, answer `/api/youtube-audio` with saved audio and run the real in-page O&F — the basis for the
  real-AMT tier's browser runner (§7.4).

## 5. Decisions

| ID | Decision | Rejected alternatives | Evidence |
| --- | --- | --- | --- |
| **G10-D1** | **Two layers in one graph.** The notation layer (parts/events: written, quantized, readable) and the performance layer (`performances[kind:'source']`: heard, µs, velocity, pedal, anchors, `link` per note) are both kept, always linked. Notation passes may *read* the performance only through declared stages (§8) and never write it (G03 I5). No schema version change. | A separate "performance score" object; dropping heard notes after quantisation (today's de-facto state for consumers) | E9 |
| **G10-D2** | **One rule per consumer** (§6.2): the engraver draws notation; "Play" plays the notation; "Play as recorded" plays the performance (or the original audio); practice judges onsets and pitches of the notation, timed by whichever rendering is playing; arrangers and analysers read notation, with performance-derived confidences as features. | Playback that silently mixes written and heard timing | E9 |
| **G10-D3** | **The north-star invariant, restated for recordings** (§6.3): what is drawn = what PPP plays when it plays the score = what practice judges; a recording's heard performance is a second, *labelled* rendering, linked note by note, never drawn. | Keeping "drawn = played" literally, which pushes performance noise into the notation | §2 point 2 |
| **G10-D4** | **Releases are evidence, not values.** A written value comes from onsets (the inter-onset interval of the voice, on the decided grid); a release only decides whether a silence is a rest, and a pedal-down release says nothing. | Heard release → written value (the pre-#134 writer); fixed `REST_MIN` forever | E5, E6, E2 |
| **G10-D5** | **A staged pipeline in a new module family `rec/`** (UMD, Node + browser, pure functions, one stage per file, each with its own report and metric), dispatched by `toMusicXml(input, {recording: 'v2'})`; the current writer (heuristic beats + `closeGaps`/`exactBars`) stays as `'legacy'`. App switch `PPP.recording = 'legacy' \| 'v2'`, default `'legacy'` until H-10. | Keep patching `audio-score.js` in place (the last week's pattern) | E1-E3 |
| **G10-D6** | **Measure first, on truth, on the app's path.** G10a-0 repairs the gate (E1), adds suites that run the app's options (E2) and the calibrated humanizer; every later phase reports Δ on rec-core, rec-robust, hold-out, the real-AMT tier and the teacher tier, and merges only on a green gate. | Judging recording changes by the teacher's eye | E1, E2 |
| **G10-D7** | **The humanizer is G0's performer, extended, calibrated by data.** New profiles in `perform.py` (Python, LCG, G0-D8) whose noise is drawn from committed *quantile tables* measured on real transcriptions (aggregate statistics only, no notes), with a test that the humanized catalogue reproduces those statistics within bands. | A new generator in JS; hand-picked noise constants (what perform/2 and `rec-synth.js` did) | E5, E7 |
| **G10-D8** | **Order of attack by measured error mass:** (1) time skeleton — metre, tempo octave, downbeat, compound tempo (issue 1); (2) hands; (3) grid per beat (straight / triplet / swing / 32nd); (4) rests (silence classifier); (5) voices; (6) key and spelling; (7) pedal marks. | Rests first (the visible symptom) | E3 |
| **G10-D9** | **Code writes, small models choose, code verifies.** Arithmetic (grid, pieces, ties, tuplets, bar sums, spelling tables) is code. The ambiguous choices (which metre and phase, which grid for this beat, is this silence a rest, which hand) are scored by small statistical models whose parameters are learned from licence-clean data (the catalogue and its humanized performances) and committed as versioned JSON with deterministic inference that runs in the browser (G6's precedent). Verification: validator 0 errors, notation-check classes 1-7 = 0. Provenance `inferred` with `conf`; low confidence raises a per-bar `Flag{kind:'uncertain'}` that the review screen shows. | A large neural model per stage; rules tuned by eye | Roadmap principle 1, §12 guardrails |
| **G10-D10** | **The browser path first.** Every stage runs in the browser within 1 s for a 3-minute piece, without the helper. Helper models (Beat This, PM2S, TransKun/Kong) are optional evidence sources, measured on the real-AMT tier; putting them on a server is a cost decision for the user (U3). | Designing for the helper path most users do not have | E4 |
| **G10-D11** | **Arrangement for recordings is hybrid:** level "original" = the v2 transcription; easier levels are generated from an estimated lead sheet (melody + harmony + bars) through G7-G9, behind a switch and a measured gate (G10c). Interim: a cross-staff melody guard in the one-note pipeline. | Thinning only (today); generation only (loses the cover's figures at "original") | E10, §9 |
| **G10-D12** | **M11 stops blocking G10** (needs the user's ratification, U5): the M11 rule (G00 §20, G3-U1: real recordings before any change to onset/beat/release inference) is replaced by the calibrated humanizer, the real-AMT tier and the private teacher tier. M11 recordings become an optional accuracy upgrade. | Waiting for M11 (asked for since G0, 2026-09-22, never recorded; production already changed the release rule without it, #134) | E1, E2 |
| **G10-D13** | **Saved songs migrate by version, never silently.** `TRANSCRIPTION_VERSION` 8 marks v2 output; a song keeps the notation it was saved with; "Write the notation again" is offered when the song's kept graph has a source performance (same device); shares keep their packed Score. | Rewriting saved songs on load | E9 (heard notes are per-device) |
| **G10-D14** | **G3 is folded in as candidate stages, not re-reviewed separately.** Each G3 pass that a stage can use is measured on the new benchmark against the v2 stage alternative; H-10 replaces the A36 re-run (roadmap §7 change 2). | Fixing G3a's H1/H2 and re-running A36 first | G03 §30-§31 |
| **G10-D15** | **Real user material stays private.** The teacher's piece (and any future user recording) is a private suite outside the repo (`run --suite-file`): checker classes, stability and eyes, no truth. Only aggregate statistics may be committed (for calibration). | Committing heard notes of a copyrighted cover | Roadmap principle 7 |

## 6. Target architecture (A)

### 6.1 The two layers, what exists and what is missing

```
 heard notes (+pedal, +beats on the helper)
        │
        ▼
 rec/ pipeline (v2) ──────────────────────────► ScoreGraph
   S0 clean        S1 beats/tempo   S2 metre+downbeat     ├─ notation layer: measures, meters, keys, tempos,
   S3 grid+onsets  S4 hands         S5 voices             │   staves(limb), voices, events(written), spanners
   S6 durations/rests  S7 tuplets/ties/pieces             │   (ties, tuplets, pedal marks), flags(uncertain)
   S8 key/spelling S9 pedal marks   S10 verify            ├─ performances[0] kind 'source': every heard note
        │ report (ext 'ppp.rec': tempo map, metre posterior,│   (µs, vel, link → head), pedal, anchors per bar
        │ per-beat grid + conf, rest decisions)             │   AND per beat (new)
        ▼                                                   └─ provenance: src audio-score/rec v2, conf
 consumers (§6.2)
```

| Piece | Exists | Missing (G10 adds) |
| --- | --- | --- |
| Heard notes in µs, velocity, `link` to the head | yes (`buildGraph`) | `conf` per note (the helper ensemble has support/confidence; O&F has none → leave absent) |
| Pedal as heard | yes (`perfPedal`) | – |
| Time map | bar anchors only | **beat anchors** (`Anchor.kind:'beat'`) from S1, so following the recording is beat-accurate |
| Stage report | `stats`, `gridReport`, `gapReport` beside the graph | one `ext['ppp.rec']` report: tempo map, metre/phase posterior, per-beat grid kind and confidence, rest decisions with their evidence |
| Uncertainty in the page | `report.suspectMeasures` from `validateTranscription` | per-bar `Flag{kind:'uncertain', code}` from low-confidence decisions |
| Score for the app | `parseMusicXML(built.xml)` (S4 open) | `legacy.toScore(graph)` as for imports (S4 for recordings) |
| A reader of the performance | none | "Play as recorded" (§6.2), the benchmark's stability metric, G11a later |

### 6.2 Who reads what

| Consumer | Reads | Rule |
| --- | --- | --- |
| Engraver (screen, print) | notation | Always. Never the performance. |
| "Play" (score playback, metronome, tempo %) | notation | Deadpan: written values, the score's tempo marks, written pedal. What is drawn is what plays. |
| "Play as recorded" (new, G10a-4) | performance | The heard notes (exact times and velocities) or the original audio when the device still has it; the highlight follows `link`ed heads through the beat anchors. Labelled in the UI; never the default "Play". |
| Practice judge, Follow, Coach | notation onsets + pitches | What is judged is the drawn note. *When* it is due comes from the rendering that is playing: the score's tempo map for "Play"/metronome practice, the performance anchors when practising along with the recording. Tolerances unchanged. |
| SongGraph analysis, arrangers (G7-G9) | notation | Plus optional per-note features from the performance (velocity for melody salience, `conf`) — never heard timing. |
| Difficulty, playability (G5/G6) | notation | – |
| MusicXML export | notation | – |
| MIDI export | notation by default; performance on request | `midi.export` already writes a performance. |
| Humanized playback of a *printed* score (future, G11) | notation + a `kind:'render'` performance | Explicit humanization policy, never the default. |

### 6.3 The invariant, restated

Roadmap §1 says "the app never contradicts itself: what is drawn = what is played = what is judged". Proposed
wording (DECISIONS row G10-D3, roadmap §1 amended; the user's decision U4):

> For every score PPP shows, **what is drawn is what PPP plays when it plays the score, and what practice
> judges.** A recording also keeps **what was heard**, beside the score and linked note by note: every drawn
> note points to the heard note it came from (or is marked as added), every heard note points to the drawn
> note it became (or is marked as left out). The heard performance is played only when the user asks for
> "as recorded", is never drawn, and never changes when the notation is rewritten.

Consequence: the notation is free to be readable (a legato note is a quarter, not a 16th and a rest), because
the faithful sound has its own, labelled place. This is the separation a notation editor makes between written
values and sounding timing.

### 6.4 Migration of saved songs

- `TRANSCRIPTION_VERSION` 7 → 8 for songs written by v2; `source.recordingPipeline = 'v2'`;
  `migrateSavedTranscription` keeps its present job (retire stale review flags) and never rewrites notes.
- A saved v1 song opens exactly as saved (Score + kept graph). If its kept graph carries a `source`
  performance, the song page offers "Write the notation again" (runs v2 on the performance layer, shows a
  before/after, saves as a new version; Undo keeps the old one).
- Shares and other devices only have the packed Score (TD3): they keep the old notation; nothing breaks.
- Arranged copies (Song Arranger) are not migrated; a new copy from a v2 transcription uses v2.
- Off-path identity: with `PPP.recording = 'legacy'` the app is byte-identical to `main` (the current four
  call sites, the same options).

### 6.5 What changes in the decision log and the roadmap

When this design is accepted (the Lead's closeout PR, not this commit):

- `docs/DECISIONS.md`: a G10 section with G10-D1 … G10-D15 as **Proposed**; after the user's U4, G10-D3 becomes
  Accepted and the roadmap §1 quality-bar bullet is replaced by the §6.3 wording; after U5, **G3-U1 is marked
  Superseded by G10-D12** (and the G00 §20 / bench README "When real recordings are required" paragraph points
  to G10-D12).
- Roadmap: §4 (M11 row: optional, owner user; G3a/G3b rows: owner G10a, trigger "G10a-n gate"), §5.8 card
  (phases G10a-0 … a5, G10c, G10b), §12 (AI-5 split into AI-5a … AI-5d), §13 (TD6 "no real recordings"
  replaced by "calibrated humanizer + real-AMT tier; M11 optional"; a new TD for the red gate until a0 merges),
  §18 (U1-U8 of this document).

## 7. The ground-truth benchmark (B)

### 7.1 Principles

1. **Truth is a score**, not a performance: the catalogue's public-domain MusicXML (hymns, method books, the
   three catalogue pieces, micro pieces; 311 references after quarantine). Notation-level metrics compare the
   written result with the written truth.
2. **The noise is measured, not imagined**: the humanizer's distributions come from real transcriptions
   (§7.3) and must reproduce their statistics (a test).
3. **The path measured is the path users get**: suites run the app's options and the browser conditions
   (no audio beats), as well as the helper conditions (oracle/noisy beats) for the cost question.
4. **No user time and no licensed audio** are needed for any CI tier. The teacher's eyes are for H-10 only.

### 7.2 Gate repair (prerequisite)

The three stale unit tests (E1) are updated to the post-MX-2 catalogue with a reason; `robust` and `full`
are relocked and rebaselined with the reason "MX-2 regenerated the hymns (`ca70a03`); locks not refreshed".
Then `bench.yml` must be green on the branch before anything else in G10 merges (roadmap §8: `main` has no
required checks; read the result).

### 7.3 The humanizer (performer `perform/3`)

New profiles beside the old ones (old profiles byte-identical). Each draws from committed quantile tables
(piecewise-linear inverse CDF, LCG uniform: deterministic on every platform).

| Statistic | Teacher's transcription (E5) | G0 `human` today | `cover` (calibrated) | `human-real` |
| --- | --- | --- | --- | --- |
| Time resolution | 32-ms frames (O&F) | 1 ms rounding | onsets/offsets floored to 32-ms frames after jitter | 10 ms (helper-like) |
| Onset jitter | residual sd 28 ms (includes beat-map error) | uniform ±15 ms | sd 9 ms + frame floor (fit so the *measured residual* lands in 20-32 ms) | sd 15 ms |
| Chord asynchrony | 57 % 0 frames / 43 % 1 frame | 12-ms rolls on 25 % of ≥ 3-note chords | 43 % of chords spread one frame | rolls as `human` |
| Tempo | bar CV 0.7 % | 0 | steady (CV ≤ 1 %) | drift 3-6 % + ritardando over the last 2 beats of phrases (every 4/8 bars) + fermatas where written |
| Held ÷ next onset of the hand | RH p10 .33 / p25 .78 / med 1.83 / p75 3.17 / p90 8.0; LH .31 / .71 / 1.17 / 2.40 / 5.0 | 0.85-0.97, never > 1 | per-hand quantile table (overlaps 70 %), capped at the next same-pitch onset − 1 frame | the same table |
| Notes before a *written* rest | – (no truth) | early by 20-80 ms | articulated: written × U(0.6, 0.95) | the same |
| Released early | 27-31 %, gap median 128 ms | 100 % | from the table | from the table |
| Velocity | mean 67, sd 6.5 | 64 + voicing/accents ± 8 | N(67, 6.5) + voicing | N(64, 12) + voicing/accents |
| AMT layer | – | `amt`: drops 3-8 %, octave ghosts 2 %, merges | optional `+of` overlay: isolated notes < 55 ms dropped (the app's O&F filter), inner chord notes missed 2-4 %, extras 3 %, repeated-note merges, no pedal | optional `+helper` overlay from the replay statistics (E8): onset +9 ms, offset \|p90\| 191 ms, missed 1.9 %, extra 3.3 %, pedal invented |

Two more families: **`swing`** (straight eighths played long-short 1.6-2:1 on a subset; the truth stays as
written) and **`cover-pedal`** (`cover` + a damper span per bar or harmony change, notes sustaining to pedal-up:
the physical mechanism of the 70 % overlap).

**Calibration procedure.** `tests/bench/node/perf-stats.js` (new) computes the statistics of E5 from any
graph that has a performance layer (or heard notes + bar times + hands). It is run once on the teacher's
private graph; only the aggregate JSON is committed (`tests/bench/corpus/calibration/cover-of-2026-10.json`:
quantiles, rates, engine name, date; no notes, no title). It is also run on the six replay fixtures
(`replay-helper.json`). A unit test humanizes 20 fixed references with `cover`, runs the same extractor and
asserts each statistic within a band (held/IOI quantiles ±15 %, early-release share ±5 points, gap median
±30 ms, one-frame chord share ±10 points, onset residual sd ±8 ms, velocity mean ±3, sd ±2). **Unsure:** the
teacher's piece is one piece and probably sequenced (CV 0.7 %, narrow velocity); `human-real` and the robust
family exist so that nothing is tuned to one cover. Each new real transcription (the teacher's next ones,
M11) adds a calibration file and widens the bands.

### 7.4 Real-AMT tier (rendered audio + the real models)

- **Helper models** exist (`replay-public`, 6 fixtures). Extend to ~40 references × `cover-pedal`.
- **Onsets & Frames, the production model**, through the real page: render the humanized performance
  (`render_piano.py`, extended with damper-pedal sustain and a short room impulse response), serve it as the
  saved audio, run the page's `Import.pianoAmtNotes` headless (the scratch flow harness pattern), store the
  heard notes as a replay fixture (`engine: 'onsets-and-frames'`). Commit notes only, never audio.
- **Cost.** Rendering is cheap (numpy). O&F's speed in a headless page is not yet measured (the scratch flow
  harnesses already run the 131-s teacher piece end to end); the budget is ≤ 1 hour for 40 references × ~60 s
  per refresh, measured in a0b. Manual refresh (when the AMT model, renderer or humanizer changes), not CI; the
  fixtures themselves are replayed in CI in seconds.
- **Domain gap, stated.** Sampled piano without sympathetic resonance, one microphone position, no room
  variety, no real pedal noise. E8 shows the helper on this audio is far cleaner than the real recording, so
  this tier tests the models' *systematic* behaviour (offset tails, invented pedal, misses in chords), not
  real-world accuracy. The teacher tier and M11 cover the rest.

### 7.5 Metrics (notation level, against the true score)

All existing G0 metrics and the ten critical gates stay. New, in `pppbench/metrics/rec.py`:

| Metric | Definition |
| --- | --- |
| `rec.onset_f1` | Pitch + written position F1: a predicted note matches a truth note of the same pitch in the same bar at the same position (after the bar offset G0 already aligns) |
| `rec.rest.precision` / `.recall` / `.false_per_100_bars` | Per voice-bar, rest spans of the prediction against the truth's silences (≥ a 16th); a predicted rest overlapping truth silence by less than half its length is false |
| `rec.tuplet.precision` / `.recall` | Beats written as triplet beats vs the truth's triplet beats |
| `rec.voice.f1` | MV2H voice sub-score: consecutive-note pairs in one voice, prediction vs truth |
| `rec.check.<class>` | `scoregraph/tools/notation-check.js` class counts per 100 bars on the predicted graph (`notate.js --emit-graph` already emits it) |
| `rec.stability` | No truth needed: the same performance with ±10 ms onset noise (3 seeds); share of bars whose notation changes. A converter that rewrites bars for 10 ms of noise is not trustworthy |
| `rec.mv2h` | MV2H-like composite (McLeod & Steedman 2018): mean of multi-pitch onset F1, voice F1, metre F1 (bar, beat, sub-beat boundaries), value accuracy, harmony agreement (G7a on prediction vs truth) |
| existing `nq.ned` | notation edit distance (kept as a cross-check) |

**Usable recording score** (`rec.usable`): every applicable G0 critical gate passes, notation-check acceptance
classes 1-7 are 0, `rec.rest.false_per_100_bars ≤ 5`, `rec.tuplet` false triplet beats ≤ 2 per 100 beats.
Thresholds are provisional and fixed in G10a-0 from the baseline (the G0 rule: set from what a player needs,
not fitted to results).

### 7.6 Tiers

| Tier | Input | Truth | Runs | Gates |
| --- | --- | --- | --- | --- |
| `rec-smoke` | 16 references × `cover`, `cover-pedal`, `human-real` | score | CI | yes |
| `rec-core` | the core 141 references × the new families × beats `none` (production) and `oracle-noisy` (helper), stage opts `legacy` and `app` | score | CI | yes |
| `rec-robust` | same references, an independent family (different tables shape: triangular jitter, no voicing, early-release-heavy) | score | CI | yes |
| `rec-full` + hold-out | all references × families × 2 seeds; hold-out by the G0 rule, aggregate only | score | nightly | hold-out aggregate |
| real-AMT | §7.4 fixtures | score | replayed in CI, refreshed by hand | yes after its first baseline |
| teacher (private) | the teacher's real transcriptions (and later other users' with consent) | none | Lead, outside the repo | checker classes 1-7 = 0, `rec.stability`, eyes at H-10 |
| M11 (optional) | user plays registered references on a MIDI keyboard + microphone | performance (MIDI) + score | `replay-public` `input:recorded` | report |

From G10a-1 the stage-opts axis gains `v2` (`{recording: 'v2'}`), so every rec suite reports legacy-default,
app (production today) and v2 side by side. The existing `core`, `smoke`, `robust`, `full` keep running
unchanged (the library default path) until v2 is the default, as the regression baseline of the legacy writer.

## 8. The conversion pipeline (C)

### 8.1 Stages and contracts

Types (JS, in `rec/types` comments): `Perf = {notes:[{on,off,midi,vel,conf?}], pedals:[{on,off}], beats?, downbeats?,
engine, frameSec}`; `BeatMap = {beats:[s], tactus, tempoMap, conf}`; `Metre = {beats, beatType, origin, conf,
posterior}`; `GridPlan = [{beat, kind:'16'|'32'|'3'|'swing8', conf}]`; `QNote = {i, tick, staff, voice, conf}`;
output: `{graph, report}`.

| Stage | Contract | Today (legacy) | Stage metric | Code / model |
| --- | --- | --- | --- | --- |
| S0 clean | Perf → Perf: drop notes outside 21-108, velocity < 8, isolated transients; mark octave ghosts | `clean`, the app's O&F filter, helper `consensus` | perf-level pitch+onset F1 vs truth (real-AMT tier) | code |
| S1 beats + tempo | Perf → BeatMap (tempo octave decided, tactus named) | `estimatePeriod`, `trackBeats`, `stabilizeBeats`, `foldFastBeats`, `tryFastTempo`; Beat This on the helper | beat F (±70 ms), tempo-octave accuracy, `critical.playback_tempo` | **model** (AI-5a): a dynamic program over tempo × phase whose onset likelihoods are learned |
| S2 metre + downbeat | BeatMap + onsets → Metre | `meterAndPhase`, `compoundVsThree`, `compoundTactus`, `metreFromDownbeats` | `critical.meter`, `struct.downbeat.f1`, `critical.beat_placement` | **model** (AI-5a): Bayesian choice of metre × phase × tactus from metrical-position priors learned from the non-hold-out catalogue scores (where onsets, bass notes and long notes fall in 2/4, 3/4, 4/4, 2/2, 3/8, 6/8, 9/8, 12/8) |
| S3 grid per beat + onsets | (BeatMap, Metre, onsets) → GridPlan + onset ticks | `tripletBeats`, `snapStraightBest`, `snapTriplet`, `snapOnsets` | `notation.onset_pos.accuracy`, `rec.tuplet` P/R, IOI accuracy | **model** (AI-5b): per-beat classifier (straight 16ths / 32nds / triplet / swing eighths) on residual features with a smoothness prior across beats; code snaps |
| S4 hands | QNotes → staff/limb | `assignHands` (pitch split DP per onset group); G3 `pro-staff` (off) | `notation.hand.accuracy`, `critical.hands`, melody continuity | DP whose costs (span, continuity, crossing, register) are fit on the catalogue (AI-5b); G3 `pro-staff` measured as the alternative |
| S5 voices | per staff → voice | one voice per staff; G3b perf-voices (off) | `rec.voice.f1`, `nq.voice.poly_recall` | code; second voice only where held-note evidence is strong *and* the reading gets simpler — decided by measurement and H-10 |
| S6 durations + rests | QNotes + releases + pedal → written lengths and silences | `staffEvents` (onset durations, `REST_MIN` 1/8) | `critical.note_values`, `rec.rest` P/R, false rests per 100 bars | **model** (AI-5b): silence classifier (features: gap ÷ IOI, gap in ms, pedal state, metrical position of the gap's start and end, the same rhythm in parallel bars, the next onset's velocity); default "no rest" (94 % base rate, E6); code writes |
| S7 pieces, ties, tuplets | written rhythm → events | `exactPieces`, `gaps.tile`, `rec-tuplet.addTriplets`, G3 `pro-tuplet` | notation-check 5-7 = 0, `nq.tuplet.group_complete` | code |
| S8 key + spelling | → KeyEvents, spelled heads, printed accidentals | `estimateKey` (one key), `spellingTable`; G3 `pro-spell` (regional); G7a `keys.js` | `critical.key`, spelling accuracy, `critical.accidentals` | code (regional keys from G7a) |
| S9 pedal marks | performance pedal → pedal spanners | AMT pedal → marks; O&F: none | `notation.pedal.f1`, false per minute (issue 17) | code + policy: marks only when the helper ensemble agrees; heard pedal always kept in the performance layer |
| S10 verify + tidy | graph → graph | `tidyRests` as safety net; validator | classes 1-7 = 0; 0 errors | code |

Pre-existing defects to fix inside the v2 stages (never in legacy): issue 1 (a compound tempo plays `bpm`
quarters a minute but prints dotted quarter = `bpm`, `audio-score.js` `buildGraph`), issue 2 (metre bias:
2/4 → 6/8), issue 13 (5/4), issue 18 (releases as values: G10-D4), R4 (the 4-note floor), and the E2
regressions of the app path (32nd runs snapped to 16ths, tuplet IOI, 3 accidental cases whose cause is not
yet traced).

### 8.2 Order of attack (from E3)

1. **Time skeleton (S1, S2, issue 1).** 340 of 416 unusable core cases fail a skeleton gate; 169 fail only those.
   2/4, 3/8, 2/2 and 6/8 are at 0 % usable on the production path. Expected gain: the largest single step.
2. **Hands (S4).** Most frequent sole blocker (25 cases), accuracy 0.887; the hand split also creates the
   melody holes of E10.
3. **Grid per beat (S3).** The teacher's piece mixes straight and triplet beats (50/90 bars); `feature:tuplets`
   beat placement 9 %; the app path's 32nd and tuplet regressions. **Unsure:** the teacher's piece has no truth;
   triplets in 20 % of staff-beats plus 14 % of attacks off every grid could be written triplets, a swing feel, or
   a beat map that is slightly off. v2 reports a per-beat confidence and flags the bar instead of forcing a
   reading; the `swing` family measures how often each reading is chosen wrongly.
4. **Rests (S6).** Already 76 % note values; the classifier is about the last 15-25 % and the real short rests
   that `REST_MIN` erases (15 % of written silences, E6).
5. Voices (S5), key and spelling (S8), pedal marks (S9).

### 8.3 What is learned, on what (AI-5 scope)

| ID | Phase | What | Trained on | Form | Runs |
| --- | --- | --- | --- | --- | --- |
| AI-5a | G10a-1 | Tempo/phase likelihoods (S1); metrical-position priors per metre (S2) | Catalogue truth scores (positions) + humanized performances (timing); hold-out excluded | Tables + a dynamic program; JSON weights, versioned | browser + Node |
| AI-5b | G10a-2/3 | Per-beat grid classifier (S3); silence classifier (S6); hand-DP costs (S4) | Humanized catalogue (licence-clean); hold-out excluded | Logistic / small boosted trees; JSON | browser + Node |
| AI-5c | optional (U3) | Pinned pretrained audio models on a server: Beat This (beats/downbeats), PM2S (performance → score), TransKun/Kong (AMT) | Their own published training data — **licences of the weights checked under D-4** | as published | server/helper only |
| AI-5d | G10b | Song audio: source separation, melody, chords, beats | pretrained, D-4 | as published | server |

Guardrails (roadmap §12): models never decide legality, geometry or validity; versions and hashes in
provenance `src`; a deterministic fallback (the v2 stage with its default parameters, or legacy); no training on
hold-out or copyrighted material; **a model never writes a pitch** (pitches come from the AMT, unchanged). The
modelling sub-phases of AI-5a/AI-5b run on Opus (standing rule); everything else on Sonnet.

## 9. Arrangement for recordings (D)

**What happens today** (G9e records, E10): the recording graph has one voice per staff; G7a's melody is the
right-hand staff's voice; the one-note pipeline keeps the top note of each right-hand chord and one note in the
left hand. Consequences on the teacher's piece: the three levels collapse to the same output, the left hand
stays a dense 16th run copied from the cover, 45 % of right-hand notes sit above C6, and wherever the hand split
put a melody note in the left hand the melody has a gap (15 of 118 right-hand rests now).

| Option | How | For | Against |
| --- | --- | --- | --- |
| R — reduce (today) | Thin the transcription per hand | Keeps the cover's figures; no harmony inference | Inherits AMT and hand-split errors; levels collapse; dense left hand stays; melody gaps |
| G — generate (lead sheet) | Melody (cross-staff skyline with continuity, later a learned tracker) + harmony (G7a over *all* heard notes, robust to hand split) + bars → G7b plan → G8/G9 realize | Works like hymns, where G7-G9 are strongest; playable by construction; levels differ; no holes | Loses the cover's own accompaniment at "original"; harmony errors on chromatic covers |
| **H — hybrid (recommended)** | "original" = the v2 transcription notation; easier levels = G; optional G9 candidate "keep the cover's left-hand figure when it fits the level" | Faithful where asked, playable where asked | Two paths to maintain |

**Gated plan (G10c).**
- **c0 (Node-only, can start after G10a-0):** a `rec-arrange` benchmark — humanize a catalogue piece →
  transcribe (legacy and v2) → arrange at each level → compare with G9's arrangement of the *clean* score:
  melody preserved (vs the clean arrangement's melody), melody gaps (rests in the melody line where the clean
  arrangement has notes), level distance, hard violations. This is the first time G9 is measured on recordings.
- **Interim guard (c0, measured, Node-only):** in the one-note pipeline for a transcription, the melody is the
  cross-staff skyline above the hand split's local boundary with a continuity cost, so a melody note the split
  put in the left hand stays in the melody; no melody rest is created where the skyline has a note. Gate: melody
  gaps ↓ on `rec-arrange`, catalogue identity 975/975 (no catalogue piece is a recording).
- **c1:** lead-sheet generation for non-original levels behind `PPP.recordingArrange = 'reduce' | 'leadsheet'`.
  Gate: on `rec-arrange`, melody F1 vs truth melody (hymn soprano, method right-hand top line) ≥ 0.9 and harmony
  agreement within 5 points of G7a's symbolic numbers (89.2 % root+quality); then 3 recordings × 2 levels in H-10.

## 10. Phases (E)

| Phase | Deliverable | Touches the app? | Model | Effort | Depends on | Acceptance (provisional numbers become fixed after G10a-0's baseline) | Rollback |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **G10a-0** | Gate repaired; `core-app`/`smoke-app`/`robust-app` suites; humanizer `perform/3`; `rec.*` metrics and `rec.usable`; calibration files; real-AMT O&F runner (may split as a0b) | no | Sonnet | 2-3 sessions | – | §15 | revert |
| **G10a-1** | `rec/` S0-S2 + issue 1, behind `opts.recording:'v2'`; AI-5a | no (Node) | Opus (AI-5a), Sonnet (rest) | 3-4 | a0 | rec-core, beats `none`: `critical.meter` ≥ 0.80 (0.486 today), `beat_placement` ≥ 0.60 (0.351), `playback_tempo` ≥ 0.80 (0.475); every metre class > 0 % usable; no gate regression with oracle beats; hold-out Δ reported; teacher tier: metre/tempo unchanged or explained; ≤ 300 ms for a 3-min piece in Node | `recording:'legacy'` |
| **G10a-2** | S3 grid per beat, S4 hands v2; AI-5b (grid, hand costs); G3 `pro-staff` measured | no | Opus (models), Sonnet | 2-3 | a1 | hand accuracy ≥ 0.95; `rec.tuplet` P and R ≥ 0.9; micro 32nd/tuplet pieces not worse than the library default; onset_pos up | same |
| **G10a-3** | S5-S10: silence classifier (AI-5b), voices decision, regional keys, pedal-mark policy; v2 complete | no | Opus (classifier), Sonnet | 2-3 | a2 | `rec.usable` on rec-core ≥ 0.45 (app path today 0.248); rest precision ≥ 0.95, recall ≥ 0.70; classes 1-7 = 0 on every tier; real-AMT tier Δ ≥ 0 on every gate; teacher tier classes 1-7 = 0 and `rec.stability` ≤ 5 % bars | same |
| **G10c-0** | `rec-arrange` bench + interim melody guard | no (guard is in `repair/`/`candidates/` gated to transcriptions) | Sonnet | 1-2 | a0 | melody gaps ↓, identity 975/975 | gate off |
| **G10a-4** | App integration: `PPP.recording` switch, S4 (Score from graph), beat anchors, "Play as recorded", uncertain-bar flags, `TRANSCRIPTION_VERSION` 8, "Write the notation again" | **yes** — full review cycle | Sonnet | 2 + review | a3 | off-path byte identity; browser suites; `single-note-app`; **the teacher's exact flow reproduced** (YouTube link → review → Accept → Song Arranger) in a production-like page before "done" | `PPP.recording='legacy'` (default) |
| **G10a-5** | **H-10** + flip | yes (default) | – | user ~60 min | a4 | pass rule below; user approval | default back to legacy; kept one release |
| **G10c-1** | Lead-sheet arrangement for easier levels | yes (behind switch) | Sonnet (+Opus if a melody model is needed) | 3-4 | a3, c0 | §9 gate; part of H-10 | `PPP.recordingArrange='reduce'` |
| **G10b** | Song audio → lead sheet + SongGraph | server | Opus/Sonnet | later | D-4, U3 | SongGraph accuracy on a licensed set | `PPP.songAudio` off |

**H-10** (A36 rules, the PPP renderer, Korean Artifact with the db capability, phone-friendly): about 10
recordings the teacher chooses or has already used, each shown as v1 (today) vs v2 blind, plus 3 recordings ×
2 levels for G10c-1. Excerpts are split `CLEAN_INPUT` / `UPSTREAM_ERROR` (AMT errors) up front and reported
separately, never excluded. Pass (starting point, fixed in the packet's manifest before it is built): v2 ≥ v1
on ≥ 8 of 10, no excerpt where only v2 "looks wrong", the teacher would hand ≥ 6 of 10 v2 scores to a student
with at most small fixes. Run only after G10a-3's numbers moved (the "review only when fixed" rule).

## 11. Performance budgets

`rec/` v2 for a 3-minute piece (≈ 1,700 notes): ≤ 300 ms in Node, ≤ 1 s on the main thread in the page (or
idle-sliced). Model JSON ≤ 200 KB in total, lazy-loaded with the recording screens. The real-AMT refresh
(manual) ≤ 1 hour.

## 12. Risks

| Risk | Mitigation |
| --- | --- |
| The humanizer is fitted to one sequenced cover | Families (`human-real`, robust), bands not points, every new real transcription adds a calibration file; real-AMT and teacher tiers |
| Synthetic → real gap (models look good on synthetic, fail on real) | Real-AMT tier through the production model; teacher tier stability; M11 when the user records |
| Browser cost of the models | Tables/DP/logistic only; budget in §11; lazy load |
| Licences of pretrained weights (PM2S, Beat This) and datasets | D-4 before any of them reaches users; synthetic-only training for AI-5a/b |
| Two renderings confuse users ("Play" no longer sounds like the YouTube video) | Clear labels; "Play as recorded" next to it; the teacher's decision U4 |
| Overlap with G11a (S5-play) | G10a-4 only adds a separate "as recorded" player; G11a moves the main player to the graph later |
| Process: merging on a red gate again | G10-D6; the gate is repaired in a0 and every merge reads the result (memory: merge only on a green gate) |
| Teacher fatigue | H-10 only after measured gains; no more bar-by-bar rounds — new complaints become benchmark cases first |

## 13. Rollback

`PPP.recording = 'legacy'` (default until H-10) restores today's writer exactly; `opts.recording` absent in
the library = legacy; each model has a deterministic fallback; `PPP.recordingArrange = 'reduce'`; benchmark
additions are new suites and new profiles (old ones byte-identical), revertable by commit.

## 14. Decisions (F)

### 14.1 Need the user

| ID | Decision | Lead's recommendation |
| --- | --- | --- |
| **U1 (D-4)** | External training/evaluation data (e.g. MAESTRO, CC BY-NC-SA 4.0 — non-commercial) and song audio for G10b | **Not now.** G10a trains only on the licence-clean catalogue and its humanized performances. Revisit only if a G10a gate fails on the real-AMT tier. |
| **U2 (M11, optional)** | The user (or the teacher) records 3 registered pieces on a MIDI keyboard with a microphone (~30 min; duple, triple, compound) | **Recommended after G10a-1, not a blocker.** It turns the humanizer's guess into a measurement of real playing. |
| **U3** | Server/GPU cost to run helper-class models (TransKun/Kong, Beat This, PM2S) for users; today production uses the browser model only | **Decide after G10a-1** with the real-AMT tier's numbers (browser path vs helper path on the same pieces). Not priced in this design (unverified expectation: a pay-per-use GPU service costs little per song, an always-on GPU server much more); the Lead prices it when the gain is known. |
| **U4** | The invariant restated (§6.3): "Play" plays the clean score; "Play as recorded" plays what was heard | **Yes.** It is what lets the score be readable without lying about the sound. |
| **U5** | Ratify that M11 no longer blocks G10 (replaces G3-U1 / the G00 §20 rule) | **Yes** (G10-D12); production already crossed that line in #134. |
| **U6** | H-10: when, how many recordings, which ones | After G10a-3; ~10 recordings the teacher uses; ~60 minutes on a phone, Korean. |
| **U7** | Short rests in recordings | Keep the eighth (`REST_MIN`) until the classifier shows rest precision ≥ 0.95; then 16th rests only with strong evidence. The teacher decides the taste at H-10. |
| **U8** | Easier levels of a recording: generated from melody + harmony (loses the cover's figures) vs thinned | Hybrid (§9); the teacher judges at H-10. |

### 14.2 The Lead decides alone

The gate repair, relocks and rebaselines with reasons; module layout; stage order; model forms; thresholds
after the baseline (stated in the phase record); which G3 passes are reused; metric definitions; the interim
melody guard (Node-only, measured); the review depth per phase (full cycle for G10a-4 and anything served).

## 15. G10a-0 implementation brief (hand to a Sonnet implementer)

**Scope.** Tests, benchmark and CI only. No change to `audio-score.js`, `scoregraph/`, `repair/`, the app or the
server. Worktree `D:/PPP-g10a0`, branch `g10a-0` from `origin/main`, `--no-track`. Any sub-agent stays read-only.

**Step 0 — the gate.**
1. Update the three stale unit tests (E1) to the post-MX-2 catalogue: `test_review_fixes.KnownFailuresAreMeasured.test_counts`
   (`key_signature_playback` has no hymns since MX-2), `test_final_review_fixes.WholeScoreSequences.test_an_untrusted_key_is_not_trusted_bar_by_bar_either`
   (find the reference it relied on; choose a still-untrusted key or rebuild the fixture), `test_scoregraph_roundtrip.CorpusOpenTies`
   (open ties fell from ≥ 11 to the measured count). Each change states "MX-2 `ca70a03`" and the new measured value.
2. `run.py relock --suite robust` and `--suite full` with the reason; `run`; `update-baseline` (same reason).
3. Push the branch; **read the `bench` run result**; it must be green before step 1 is reviewed.

**Step 1 — the app's path.** New suites `smoke-app`, `core-app`, `robust-app`: the same references and matrix as
`smoke`/`core`/`robust`, `stage.opts = {"closeGaps": true, "exactBars": true}`. Locks, baselines, added to
`bench.yml`'s gate job. Expected (this design's scratch run at `415a4c4`): `core-app` usable 0.2477, note values
0.7631, beat placement 0.4665; `robust-app` usable 0.262. The 29 A/B failures of E2 are recorded in the phase
record as known regressions of the production path (not fixed here).

**Step 2 — the humanizer.**
- `tests/bench/node/perf-stats.js` (new, Node): input a graph JSON with a `source` performance (or `{notes, barStarts,
  hands}`); output the statistics of E5 (frame share, chord asynchrony, tempo CV and bar-to-bar ratios, onset
  residual vs written grid, held ÷ next-onset quantiles per hand, early-release share and gap quantiles, velocity
  moments, triplet-beat share). Deterministic, no network. A unit test on a hand-made graph.
- Calibration files (aggregate numbers only): once `perf-stats.js` exists, the Lead runs it on the teacher's
  private graph (`scratchpad/ioi/flow/after-trans-graph.json`, outside the repo) and hands the implementer the
  output JSON to commit as `tests/bench/corpus/calibration/cover-of-2026-10.json` (its numbers must match E5);
  the implementer runs it on the six replay fixtures for `replay-helper.json`. The scratch `scratchpad/g10/calib.js`
  is the reference implementation of the statistics.
- `pppbench/perform.py`: profiles `cover`, `cover-pedal`, `human-real`, `swing`, and overlays `+of`, `+helper`
  (§7.3), drawing from the calibration tables (piecewise-linear inverse CDF on the LCG). **Old profiles and every
  existing lock stay byte-identical** (choose the versioning so `perform/2` suites do not relock — e.g. a
  per-profile generator tag; say which in the record).
- `unit/test_calibration.py`: humanize 20 fixed references with `cover`, extract with `perf-stats.js`, assert the
  bands of §7.3; and the LCG ban test still passes (no `random`, no libm).

**Step 3 — metrics.** `pppbench/metrics/rec.py`: `rec.onset_f1`, `rec.rest.*`, `rec.tuplet.*`, `rec.voice.f1`,
`rec.check.*` (via `notation-check.js` on the `--emit-graph` output), `rec.stability`, `rec.mv2h`, and
`rec.usable` (§7.5). Unit tests with planted fixtures for each. `mutation.py` gains one planted defect per new
metric (e.g. stage opts `restMin: 0` → `rec.rest.precision` falls; exact bars off → `rec.check.5` rises; a voice
merge → `rec.voice.f1` falls); `mutation-check` must flag each by name, and no-ops stay byte-identical.

**Step 4 — suites.** `rec-smoke` (CI), `rec-core` (CI), `rec-robust` (CI), `rec-full` (nightly, hold-out
aggregate), each over the new families × beats `none`/`oracle-noisy` × stage opts `legacy`/`app`. Baselines with
the headline numbers in the commit message.

**Step 5 (may be a separate PR, a0b) — real-AMT runner.** `tests/bench/tools/of_replay.js`: render (pedal sustain
added to `render_piano.py`), serve on a free port with `NODE_ENV=production` (`tests/engrave/tools/with-port.js`;
never 8777), run the page's O&F headless, write replay fixtures (`engine: 'onsets-and-frames'`, notes only) for 20
references to start.

**Acceptance.**
1. `bench.yml` gate green on the branch, including the new suites.
2. `core`, `smoke`, `robust`, `replay-public` results byte-identical to `origin/main` except the documented relocks.
3. Calibration test passes; the record lists the extracted statistics next to the targets.
4. `rec-*` baselines recorded for `legacy` and `app` options, with usable, gates, rest P/R, tuplet P/R, checker
   classes, stability.
5. Every new metric caught by a named mutation; no-op controls byte-identical.
6. Determinism: three runs, Windows and Linux (the README's Docker recipe) byte-identical `results.json`.
7. No served file changed (`git diff --stat` shows only `tests/`, `.github/`, docs).

**Report back.** The measured baselines; anything in this design the numbers contradict (stop condition 3 of
the roadmap if so).

## 16. Lead summary (for the roadmap)

- G10a redesigns recording → score as two linked layers in the existing ScoreGraph: a readable notation layer
  and the exact heard performance (already written since G1, never read).
- New invariant: drawn = what "Play" plays = what practice judges; the heard performance is a labelled "Play as
  recorded" rendering, never drawn (user decision U4).
- Evidence: the G0 gate has been red on `main` for 83 runs since MX-2, and G0 never ran the app's options; on
  truth the last week's fixes lift usable 18.1 % → 24.8 % (hold-out 25.0 % → 30.5 %) and note values 49 % → 76 %,
  with 29 regressions nobody saw.
- Biggest remaining error: the time skeleton (metre, tempo, downbeat): 340 of 416 unusable cases; 2/4, 3/8, 2/2,
  6/8 are at 0 % usable. Then hands, then the grid per beat, then rests.
- Real transcription facts: 70 % of notes overlap the next onset, 50/90 bars mix triplets, 32-ms frames;
  written truth: 94 % of notes last to the next onset. Releases are evidence for rests only.
- Benchmark without user time: the catalogue played by G0's performer extended with a humanizer calibrated on
  the teacher's transcription, plus rendered audio through the real O&F; the teacher's piece is a private,
  no-truth tier.
- Phases: G10a-0 benchmark + gate (Sonnet) → a1 time skeleton (AI-5a, Opus) → a2 grid + hands → a3 rests,
  voices, keys → a4 app integration behind `PPP.recording` → a5 H-10 and flip; G10c arrangement for recordings
  (hybrid: original = transcription, easier levels from melody + harmony); G10b later (D-4, server).
- User decisions: D-4 data (recommend: no external data now), optional M11 recordings, server GPU cost (decide
  after a1's numbers), the invariant restatement, ratifying that M11 no longer blocks.

## Appendix A. Measurement commands (Lead's scratchpad)

| What | Command (cwd `scratchpad/`) |
| --- | --- |
| Teacher transcription statistics (E5) | `node g10/calib.js review-g9e5/heard-prodZ-b.json ioi/flow/after-trans-graph.json` |
| Onset phase histogram (E5) | `node g10/grid.js ioi/flow/after-trans-graph.json` |
| Catalogue base rates (E6) | `node g10/catalog-overlap.js D:/PPP-g10` |
| Real AMT vs truth (E8) | `python g10/replay-amt.py D:/PPP-g10` |
| Holes (E10) | `node g10/holes.js ioi/flow/after-trans-graph.json ioi/flow/after-arr-graph.json`; `node g10/holes-share.js ioi/flow/after-trans-graph.json userscore/share.json userscore/share2.json` |
| App path on G0 (E2, E3) | in `g10/tree` (a `git archive` of `415a4c4` with `toMusicXml` defaulting to `{closeGaps: true, exactBars: true}`): `python tests/bench/run.py ab --suite core --a git:HEAD --b worktree`; `robust` and `full` the same after a scratch relock (their committed locks are stale, E1); logs `g10/ab-core-app.log`, `g10/ab-robust-app.log`, `g10/ab-full-app.log` |
| CI history (E1) | `gh run list --workflow bench.yml -L 200`; `gh run view 36992820362 --log-failed` |


## 17. G10a-0 result (2026-10-02, merged #137-#141 as merge commits; Lead)

**Done:** the bench gate is green again (it was red for 83 runs since MX-2; the real cause list was eight, not the three of E1: three stale unit tests, stale robust/full locks, the we-gather-together replay fixture recorded from the pre-MX-2 hymn, the A44 script-order regexp, 8 hymn layout hashes, the G6a cold-assess budget 100 ms -> 250 ms); suites that run the app's options (smoke-app / core-app / robust-app: usable 0.2477 / 0.2624, note values 0.7631 on core-app, as predicted); the calibrated humanizer (profiles cover, cover-pedal, human-real, swing, cover-alt; overlays +of, +helper; calibration numbers committed as aggregates only, no note-level data) with perf-stats.js and a calibration test; the rec.* metrics, rec-smoke / rec-core / rec-robust (CI gate) and rec-full + mutation check (nightly-rec), ten planted mutations; the real-AMT tier (of_replay.js: the browser's Onsets & Frames on rendered audio, 20 fixtures, suites replay-of / replay-of-app). Determinism: three runs byte-identical on Windows, identical on Linux (Docker) for every suite listed in the PR.

**Baselines (ab00e01, legacy -> app options)** rec-core (1,692 cases): G0 usable 0.005 -> 0.015, rec.usable 0.000 -> 0.001, rest precision 0.044 -> 0.094, rest recall 0.523 -> 0.502, false rests per 100 bars 322 -> 148, tuplet P/R 0.368/0.230 -> 0.353/0.250, stability 0.681 -> 0.627, checker classes 1/2/3/5/6/7 per 100 bars 188/143/23/27/52/83 -> 7.5/1.0/6.0/18/13/28; rec-robust G0 usable 0.000 -> 0.011. Real AMT tier: O&F recall 0.902, precision 0.995, identity F1 0.958, onset F1 0.832 (0.751 with the app's options), usable 0 of 20 on both suites.

**Corrections the baselines force (Lead, supersede the earlier text):**
1. The G10a-3 gate in section 10 ("rec.usable on rec-core >= 0.45 (app path today 0.248)") is WITHDRAWN: 0.248 was G0's synthetic 'human' profile, not the calibrated families; on them the app path today is G0 usable 0.015 and rec.usable 0.001 (0.007 / 0.003 with production's beats none). The gate numbers are re-set from these baselines after G10a-1 (a1 reports its own movement); until then a phase is accepted by relative improvement over this baseline on rec-core and replay-of with no regression of the checker classes, plus the hold-out slice. cover+of fails pitch integrity in 73% of cases: the +of overlay values (misses, ghosts, merges) are unmeasured and likely harsher than real; calibrate them from replay-of.
2. The app's options (closeGaps / exactBars, #132-#134) LOWER onset F1 on real-AMT (0.832 -> 0.751) and note values (0.10 -> 0.05) on the replay-of tier: the exact-bars snap moves onsets (up to a 32nd) and costs accuracy against the true score on real transcriptions even though the drawn bars add up; the G10a-2 grid stage must be judged on this tier, not on bar sums alone.
3. TD20: the system under test crashes (E-SPAN-ORDER in the graph builder) on a pedal that starts after the last note (found by rec-full on method/czerny599/001); the humanizer avoids it for now; to be fixed in a G10a phase that touches audio-score.js.

## 18. G10a-1: the time skeleton (2026-10-03; implementer on Opus, AI-5a)

Worktree `D:/PPP-g10a1`, branch `g10a-1` from `origin/main` `2e09fad`. Measurement first: the baselines were reproduced
before anything changed, the error analysis below decided what S0-S2 had to fix, and every step was measured.

### 18.1 Baselines reproduced

At `2e09fad`, unchanged tree: `run` + `check` of rec-smoke, rec-core, rec-robust, replay-of and replay-of-app all
PASS, and every aggregate of each `results.json` equals the committed baseline's (0 differing keys; rec-core 1,692
cases in 2 min 39 s). The figures below are those runs.

### 18.2 Error analysis of the time skeleton (rec-core, the app's options, beats `none` = production)

`python tests/bench/tools/rec_skeleton_report.py tests/bench/out/rec-core/results.json` (new, reads a run, computes nothing
new about the music). 564 cases, **559 unusable; 528 fail at least one skeleton gate** (metre, playback tempo, beat
placement, structure); only 12 fail nothing else (on the calibrated families every other gate fails too, mainly note values:
E3's 169 "skeleton only" was G0's synthetic `human` profile).

| | metre | playback tempo | beat placement | structure | downbeat F1 |
| --- | --- | --- | --- | --- | --- |
| legacy, beats none | 0.420 | 0.420 | 0.034 | 0.344 | 0.410 |
| app, beats none (production) | **0.426** | **0.426** | **0.069** | 0.301 | 0.403 |
| app, oracle-noisy (helper) | 0.674 | 0.546 | 0.284 | 0.688 | 0.833 |

(The section 10 row of a1 quotes metre 0.486, beat placement 0.351, tempo 0.475 "today": those were G0's `human` profile
before G10a-0; the calibrated families start lower.)

**Metre written for each true metre** (app, none; cases): 4/4 → 4/4 185, 6/8 26, 3/4 9 · 3/4 → 4/4 57, 3/4 28, 6/8 23 ·
**2/4 → 6/8 48, 4/4 47, 3/4 1** · 6/8 → 6/8 27, 4/4 21, 3/4 16 · 3/8 → 6/8 22, 4/4 10, 3/4 4 · 2/2 → 4/4 10, 3/4 4, 6/8 2 ·
6/4, 3/2, 5/4, 9/8, 12/8 (24 cases) never right.

**Written tempo / true tempo**: 4/4 x1 144, x2 31, x2/3 12, x1/2 9 ... · 3/4 x1 51, x2 29, x2/3 18 · 2/4 x1 38, x2/3 29, x2 19 ·
**6/8 x2/3 20, x2 20, x4/3 13, x1 7** · **3/8 x2/3 19** · 9/8, 12/8 x2/3. The x2/3 rows are **issue 1** (a compound metre prints
dotted quarter = bpm but plays bpm quarters: every 6/8, 3/8, 9/8 and 12/8 piece written in a compound metre plays 2/3 of its
tempo, playback tempo fails in 92-100 % of them); the x2 rows are the tempo octave.

**Causes, read in the code** (`audio-score.js`):
- `compoundVsThree` scores a three-quarter grouping's dotted-quarter points (ticks 0 and 36) 2.2 times higher than its quarters:
  a 2/4 piece in eighths has notes on both, so 48 of 96 2/4 cases (and 22 of 36 3/8) become 6/8 bars of three quarters.
- `meterAndPhase` prefers four unless three is 8 % stronger: 3/4 → 4/4 (57) and 6/8 → 4/4 (21).
- `estimatePeriod`'s prior around 100 bpm and `tryFastTempo` decide the tempo octave from the onset envelope alone (the x2 and
  x1/2 rows).
- the bar phase is the accent phase of `meterAndPhase` on quarters: **when metre and tempo are both right (159 cases) the bar
  lines are right (downbeat F1 >= 0.9) in only 47**; the rest fail beat placement on the phase.
- a quantiser inconsistency (found while building v2, kept in legacy): `quantize` floors a beat position with 1e-9 of slack but
  `snapStraight` without it, so an onset a hair before a beat is written one beat late.

**What a perfect skeleton buys with today's S3-S10** (a scratch run, app options, beats none, `opts.lock` = the score's metre,
quarter tempo and first bar line, constant tempo): metre 1.000, playback tempo 0.801 (the compound pieces still fail: issue 1
is in the writer), beat placement 0.553 (cover 0.745, cover-pedal 0.723, human-real 0 - a constant tempo cannot follow its
drift), usable 0.113. So the a1 targets of section 10 are bounded by the stages after S2: beat placement >= 0.60 is above what
even a perfect constant-tempo skeleton gives with the legacy grid, and usable stays near 0.1 until note values (S6) move.

**The 2/4 problem is also a notation question.** 2/4 against 4/4 (and 2/2 against 4/4) differ by where the composer drew the
bar line every other beat, not by what is heard; the catalogue's 2/4 pieces are mostly method etudes (Hanon, Czerny, Beyer),
its 4/4 mostly hymns. A model can only use the tempo, the density of accents and the phrase rhythm. Together with the metres
v2 does not model (6/4, 3/2, 5/4: 16 core cases) about a fifth of rec-core is a convention or unmodelled metre: a metre gate of
0.80 from onsets alone is not reachable on this corpus (section 18.6).

### 18.3 What was built (S0-S2 behind `opts.recording: 'v2'`)

`toMusicXml(input, { recording: 'v2' })` (and nothing else: no lock, no stated metre) hands the cleaned, clustered notes to
`rec/` and writes the score on the skeleton it returns with the **legacy** quantiser and writer (S3-S10 are G10a-2/3). Without
the option, with `'legacy'`, with a lock or `beatsPerBar`, on a page without `rec/` or its weights, or when `rec/` cannot read
the performance (fewer than four attacks), the legacy path runs, byte for byte. The app is not touched (`PPP.recording` is
G10a-4).

| Stage | File | What it does |
| --- | --- | --- |
| S0 | `rec/attacks.js` | `cleanNotes` = audio-score.js `clean()` (a test asserts equality); one attack per clustered onset; per attack, classes read the same way on a score and a performance (bass change, IOI against the piece's median, fuller chord). No note is dropped or added beyond legacy's clean. |
| S1 | `rec/beats.js` | Up to 6 pulse tracks: the strongest periods of the attack-pair interval histogram (0.18-1.6 s), each followed by a DP over 10-ms frames (Ellis; step 0.6-1.5 periods, stiffness 100). A track is a time warp, not a decision. The helper's audio beats, when given, become one more track (gaps filled). |
| S2 | `rec/metre.js`, `rec/model.js` | Every reading (track x quarters per tracked beat x metre in {2/4, 3/4, 4/4, 2/2, 3/8, 6/8, 9/8, 12/8} x bar phase in eighths; quarter tempo 36-260: ~1,000-2,000 readings) is scored by a learned log-linear model; the best wins; its posterior and the posterior mass on readings with the same bar lines are the confidence. |
| issue 1 | `audio-score.js` `finish`/`buildGraph` | v2 only: a compound metre prints dotted quarter = bpm and plays 3 bpm / 2 quarters (`qpm` written as a rational, so the validator's W-TEMPO-MARK-MISMATCH is gone). |
| TD20 | `audio-score.js` `finish` | v2 only: a pedal pressed in the score's last tick is not written as a mark (it ended where it started: E-SPAN-ORDER threw the whole score away); the performance layer keeps it. Legacy keeps TD20 (the design: pre-existing defects are fixed inside v2, never in legacy). |
| quantiser | `audio-score.js` `quantize` | v2 only: an onset within 1e-9 of a beat is on it (v2's written beats run through the onsets, so legacy's floor slip, which writes such an onset one beat late, hit v2 constantly: pitch integrity fell from 0.80 to 0.75 before this). |
| provenance | the graph's source `params.recording` | `{pipeline: 'v2', skeleton: {model: 'ai5a@v1', conf, metre}}`; `stats.beatSource` `onset-v2` / `audio-v2`; the full skeleton (posterior per metre, tracks, the chosen reading) as `result.recReport` beside the graph (not in stats). |

**The model (AI-5a).** Tables counted from the catalogue truth (`tests/bench/tools/rec_dataset.py --truth`: the lint-clean,
licence-evidenced references, **hold-out excluded**, read with the benchmark's own reader): per metre family and metrical level a
Beta prior on how full each level is (a Beta-binomial marginal, so a dense etude is not a different metre than a hymn), where
first and last onsets fall, per-level ratios of the attack classes, and per metre and beat class (downbeat / mid-bar / other)
the log-likelihood ratio of a beat's accent evidence (an onset and how long until the next, a bass change, a harmony change, a
fuller chord, the four jointly), smoothed towards the family; per metre a log-normal of the quarter tempo. 25 weights (the
features of `rec/model.js` FEATURES) fitted by `rec/tools/train.js`: the conditional-logit likelihood of the right readings among
all readings of 2,570 humanized performances of the same references (`perform/3` cover, cover-pedal, human-real, cover+of at
seeds 101-102, no beats; cover and cover-pedal+helper at seed 103 with helper-like beats - seeds no suite uses), L2 1e-4,
Newton. Weights file `rec/weights/ai5a-v1.json`, 31 KB (budget 200 KB), its sha256 in the file and in `result.recReport`, its
name and version in every v2 graph's provenance; evaluation `rec/tools/ai5a-v1.evaluation.json`. `node rec/tools/train.js
--check` regenerates the data set (Python, the humanizer's LCG) and the fit (Node) and compares both files byte for byte: the
same on Windows, on Linux (Docker) and in CI.
No external data, no recording, no user material; the teacher's piece was not used.

| skeleton right (metre + tempo +-4 % + 90 % of bar lines) | n | right | metre | tempo | some track can be read right |
| --- | --- | --- | --- | --- | --- |
| training performances (in sample) | 2,570 | 0.668 | 0.716 | 0.869 | 0.904 |
| 5-fold cross-validation by reference (out of fold) | 2,570 | **0.613** | 0.668 | 0.857 | 0.904 |
| hold-out references (never seen) | 312 | **0.644** | 0.683 | 0.869 | 0.885 |

**Budget (section 11).** 147-s, 1,070-note piece: 100 ms for S0-S2 in Node (was 235 ms before two optimisations that leave
every feature value identical: a step-penalty table in the DP, no allocation per reading); a synthetic 180-s, 1,800-note piece
~150 ms. Whole `toMusicXml` with v2 on rec-core: median 46 ms, max 400 ms per case (the legacy writer's share included). Not
measured in the page (G10a-4).

### 18.4 What was tried and lost (measured, kept out)

Measured on the skeleton score above (5-fold CV by reference unless said), each decision in `rec/` names its reason:
- **Per-metre slot tables** (onset and hazard per 1/24-quarter slot of each metre): they learned the catalogue's textures, not
  metres (2/4 = Hanon's running 16ths gave a 16th slot a 52 % hazard, 4/4 = hymns 12 %): every hymn read as 4/4, every 16th
  etude as 2/4. Replaced by family-level tables with a piece's own fill integrated out.
- **Evidence as sums** (a proper log-likelihood per attack and per beat): the fit shrank them to near zero (misspecified
  independence: one tracking slip costs a whole piece) and accuracy fell (rec-core skeleton 0.456 as means, 0.410 with the
  square root, 0.392 nearer sums, before the clip). Means under-weight
  long clear pieces (a synthetic 24-bar waltz at 0.47 posterior); clipped per-beat ratios times the square root of the beats won
  by 0.010 on CV (lost 0.035 on the 312 hold-out cases: within their noise) and is what ships.
- **More candidate periods** (normalised per second, the tatum's multiples): more performances with no right track (88 and 104
  of 564 against 82); 6 tracks with stiffness 100 (62) instead of 4 with 50 (82) ship.
- **A joint 40-cell table of the beat evidence alone**: +0.05 in sample, nothing out of fold (memorised the pieces); kept only
  next to the four separate ratios, where CV gained +0.02. **Whole-bar rhythm patterns** (eighth-resolution bar masks against
  their independent model): weight -0.04, CV -0.004; dropped. The catalogue's 6/8 is 83 % running eighths, so a jig's
  quarter-eighth bar is not "typical 6/8" to any table learned here.
- **Per-feature diagnostics** on performances with the true pulse given (`--oracle`): the beat-accent ratios prefer the right
  grouping over a wrong one in most pairs (the onset/duration ratio in 80-100 % except between compound metres); S2 alone still
  reaches only 0.54 on rec-core, mostly because of the first-onset and metre priors (18.6).

### 18.5 Results: legacy / app / v2 side by side

Every rec suite now runs three option sets on the very same performances (`opts:legacy` the library default, `opts:app`
what the app passes today, `opts:v2` the app's options with `recording: 'v2'`); the legacy and app rows are byte-identical to
the G10a-0 baselines (every case's metrics and predicted summary: rec-smoke 96, rec-core 1,692, rec-robust 564 of 564).

**rec-core** (141 references x the calibrated families):

| beats | options | n | usable | rec.usable | metre | tempo | beat pl. | structure | values | hands | pitch | downbeat F1 | rec.metre.f1 | rec.onset_f1 | rec.mv2h | stability (lower is better) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| none | legacy | 564 | 0.005 | 0.000 | 0.420 | 0.420 | 0.034 | 0.344 | 0.011 | 0.826 | 0.803 | 0.410 | 0.555 | 0.188 | 0.591 | 0.818 |
| none | app (production) | 564 | 0.009 | 0.002 | 0.426 | 0.426 | 0.069 | 0.301 | 0.034 | 0.826 | 0.801 | 0.403 | 0.551 | 0.201 | 0.593 | 0.773 |
| none | **v2** | 564 | **0.089** | **0.016** | **0.585** | **0.849** | **0.457** | **0.585** | **0.243** | 0.824 | 0.794 | **0.761** | **0.836** | **0.554** | **0.746** | **0.342** |
| oracle-noisy | legacy | 282 | 0.004 | 0.000 | 0.699 | 0.574 | 0.124 | 0.709 | 0.032 | 0.826 | 0.918 | 0.855 | 0.842 | 0.474 | 0.705 | 0.407 |
| oracle-noisy | app | 282 | 0.028 | 0.000 | 0.674 | 0.546 | 0.284 | 0.688 | 0.096 | 0.833 | 0.926 | 0.833 | 0.819 | 0.489 | 0.707 | 0.335 |
| oracle-noisy | **v2** | 282 | **0.074** | 0.000 | **0.780** | **0.865** | **0.557** | **0.865** | **0.270** | 0.823 | 0.933 | **0.956** | **0.937** | **0.760** | **0.805** | **0.236** |

Checker classes 1-7 per 100 bars (notation-check.js; none / oracle-noisy): app 8.4 / 1.1 / 6.3 / 0.3 / 19.8 / 15.0 / 32.8 and
5.6 / 0.9 / 5.4 / 0.4 / 15.8 / 8.5 / 19.7; **v2 0.8 / 0.5 / 1.8 / 0.0 / 7.1 / 2.4 / 1.3 and 1.3 / 0.3 / 1.0 / 0.1 / 10.1 / 4.0 / 1.5**:
lower in every class on rec-core and rec-robust (a bar that is right needs fewer repairs).

**By metre** (v2, beats none, against app): 4/4 metre 0.932 (0.841), beat placement 0.664 (0.132); 3/4 0.676 (0.259), 0.630
(0.065); 6/8 0.547 (0.422), 0.422 (0.031), tempo 0.750 (0.078: issue 1); 3/8 0.389 (0), tempo 0.722 (0.056); **2/4 0.031
(0)**, 2/2 0 (0), and 6/4, 3/2, 5/4, 9/8, 12/8 0 (not modelled, or a single catalogue piece). Every metre class with a
modelled metre is above 0 % usable except 2/4 and 2/2 (simple-duple 0 %; see 18.6).

**rec-robust** (cover-alt, an independent, uncalibrated family): beats none, app -> v2: metre 0.482 -> 0.596, tempo 0.447 ->
0.823, beat placement 0.028 -> 0.454, structure 0.291 -> 0.596, usable 0.000 -> 0.028, stability 0.846 -> 0.388; oracle-noisy:
metre 0.681 -> 0.801, tempo 0.539 -> 0.879, beat placement 0.277 -> 0.589, usable 0.021 -> 0.064.

**rec-smoke** (beats none): app -> v2 usable 0.042 -> 0.250, rec.usable 0.021 -> 0.083, metre 0.500 -> 0.708, beat placement
0.167 -> 0.625.

**Real-AMT tier** (`replay-of`: the browser's Onsets & Frames on rendered audio, 20 fixtures; new suite `replay-of-v2`):

| | usable | metre | tempo | beat pl. | structure | values | hands | pitch | downbeat F1 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| replay-of (library) | 0.00 | 0.65 | 0.50 | 0.00 | 0.45 | 0.10 | 0.65 | 0.55 | 0.353 |
| replay-of-app (production) | 0.00 | 0.65 | 0.50 | 0.00 | 0.45 | 0.05 | 0.65 | 0.55 | 0.353 |
| **replay-of-v2** | **0.05** | **0.75** | **0.90** | **0.70** | **0.70** | **0.55** | 0.65 | 0.55 | **0.829** |

(The 20 references of `replay-of` are open references, in the training set of the tables; the humanized performances behind
them are seed 1 rendered and re-transcribed, which the training never saw.)

**What did not move or moved back.** Hands (S4, legacy) 0.826 -> 0.824 and pitch integrity 0.801 -> 0.794 on rec-core/none:
different ticks change the legacy hand split and the 300-ms matching near the thresholds (hands: 17 cases lost, 13 won; pitch:
19 lost, 17 won, mostly `cover+of` near 0.95; no systematic cause found). On rec-smoke the class 2 count (a rest shorter than a
16th) rises 0.3 -> 1.2 per 100 bars: three cases v2 reads as 6/8 (two 2/4 Czerny pieces, the 4/4 triplet micro piece), where the
legacy compound writer has no exact-bar grid (S3/S6, G10a-2/3). `rec.usable` stays near 0 because note values (S6) and the
rest/tuplet rules still fail; the time skeleton was the first wall, not the last.

**Usable by metre class** (rec-core, beats none; legacy / app / v2): simple-quadruple 0.005 / 0.014 / **0.132**, simple-triple
0.018 / 0.018 / **0.089**, compound-duple 0 / 0 / **0.125**, compound-single 0 / 0 / **0.083**; still 0 % with v2: simple-duple
(112 cases: 2/4 and 2/2), compound-triple and compound-quadruple (9/8 and 12/8: one catalogue piece each, 4 cases each) and
irregular (6/4, 5/4: not modelled). The section 10 target "every metre class > 0 %" is met for the four classes that have
enough catalogue pieces to learn from, and not for the others.

### 18.6 Against the a1 targets, and what could not be improved

| a1 target (section 10) | measured (rec-core, beats none) | verdict |
| --- | --- | --- |
| `critical.meter` >= 0.80 (0.486 "today") | 0.426 -> **0.585** | relative gain +0.16; the number is not reachable this way (below) |
| `beat_placement` >= 0.60 (0.351) | 0.069 -> **0.457** | x6.6; bounded by S3 (a perfect constant-tempo skeleton gives 0.553 with today's grid) |
| `playback_tempo` >= 0.80 (0.475) | 0.426 -> **0.849** | **met** (issue 1 and the tempo octave) |
| every metre class > 0 % usable | 4 of 8 classes | not met for simple-duple and the classes without training pieces |
| no gate regression with oracle beats | metre 0.674 -> 0.780, tempo, placement, structure, values up; hands 0.833 -> 0.823 | met except hands (-0.010, S4 churn) |
| hold-out reported | 18.8 | |
| teacher tier: metre/tempo unchanged or explained | not run (the teacher's graph is private, outside this worktree) | for the Lead |
| <= 300 ms for a 3-min piece in Node | ~150 ms (S0-S2) | met |

**Why metre >= 0.80 contradicts the design (roadmap stop condition 3: reported, not forced).** (1) 2/4 against 4/4 and 2/2 against
4/4 are notation conventions, not something heard: even with the true pulse given (a development model fitted that way), 2/4 was
right in 17 % of rec-core cases, and 112 of 564 rec-core cases are simple-duple; the catalogue's 2/4 pieces are method etudes,
its 4/4 hymns, and the tables can only tell them apart by texture, which section 18.4 shows generalises worse. (2) Metres with one
or no catalogue piece (6/4, 3/2, 5/4, 9/8, 12/8: 24 cases) cannot be learned from licence-clean data in this corpus (D-4 is the
user's decision). (3) A one-beat pickup is outweighed by the first-onset prior (85 % of the catalogue starts on a downbeat): 3/4
hymns with a pickup become 4/4 (3/4 -> 4/4 is still the largest single confusion, 19 of 108 cases with the true pulse). Without
(1) and (2) (136 of 564 cases, 24 %) a model that is right on everything else scores 0.76; v2 scores 0.585 overall and 0.764 on
the four metres it can learn (4/4 0.932, 3/4 0.676, 6/8 0.547, 3/8 0.389). **A metre gate for G10a should be per metre class,
relative to this baseline.**

**Not improved, and why:**
- **Pickups** (above): the right fix is evidence of the pickup itself (a short first bar is completed by the last one; phrase
  lengths), not a weaker prior; a1 records it as a todo test (`tests/rec/stages.test.js`).
- **2/4 vs 4/4**: bar-length conventions need phrase and harmony-rhythm models beyond one bar; a convention prior (2/4 below
  some tempo, say) would be fitting the catalogue's books, not music.
- **S1 reachability**: in 11 % of rec-core performances no track can be read right (Hanon's even 16ths with the cover profile's
  24-ms jitter; Czerny 849 at 200 qpm): a DP whose tempo state is explicit (a bar-pointer HMM) is the next step if a2 needs it.
- **Hands, pitch integrity** did not move (S4, legacy): the hand split is a2's.

### 18.7 What G10a-2 (grid + hands) should expect

- The skeleton is now right often enough that S3's own errors show: with the metre, tempo and bar lines right, beat placement is
  0.80 (cover), 0.79 (cover-pedal), 0.95 (human-real) on rec-core; the rest is the grid (16th vs triplet vs 32nd snaps, exact
  bars) and the AMT. On replay-of the gap between the app's and the library's options (G10a-0 correction 2) remains.
- **Compound metres have no exact-bar grid** (the legacy writer applies exact bars to x/4 only): v2 writes many more 6/8 and 3/8
  bars than legacy, with the rests of the old compound writer (rec-smoke class 2). S3 must cover compound beats.
- `result.recReport` (the skeleton, its posterior per metre and per reading) and the graph's provenance carry what an uncertain-
  bar flag (G10a-4) needs; a2's grid classifier can condition on the reading (beat unit, compound or not).
- Hands are the next blocker after the skeleton (S4 untouched: 0.824 on rec-core/none); the v2 path calls the legacy
  `assignHands` on v2's ticks.
- The training pipeline (`rec_dataset.py` + `rec/tools/train.js --check` in the gate) is reusable for AI-5b: same data rules
  (hold-out excluded, seeds no suite uses), same determinism check.

### 18.8 Verification

- **Legacy byte-identical.** `run.py ab --a git:2e09fad --b worktree` + `ab_identical.py` on smoke, core, robust, smoke-app,
  core-app, robust-app, replay-public, replay-of and replay-of-app: every case the same (status, metrics, semantic projection);
  golden, correctness and sg-roundtrip unchanged; the legacy and app rows of every rec suite equal the G10a-0 baselines case by
  case (rec-full: the aggregates); the 975 `arrangeSingleNote` requests of the app's one-note glue (325 catalogue pieces x three
  levels) give the same graphs as a clean `git archive` of `2e09fad` (933 arrangements, 42 refusals with the same codes).
- **Mutation coverage.** `mutation-check --rec`: the ten recording-metric defects of G10a-0 still caught on `rec-mutation`
  (legacy and app rows); on the new `rec-mutation-v2` (the same references and rows, v2 only) each v2 decision has a planted
  defect, each a REGRESSION naming its metric: accents ignored (critical.meter 0.714 -> 0.685, downbeat F1, rec.metre.f1),
  bar lines a beat late (beat placement 0.655 -> 0.018), the tempo octave halved (playback tempo 0.869 -> 0.024), issue 1
  back (playback tempo 0.869 -> 0.762), the helper's beats ignored (metre 0.714 -> 0.613), the on-beat quantiser slip back
  (pitch integrity 0.988 -> 0.982); the no-ops byte-identical.
- **Determinism.** `rec/tools/train.js --check` byte-identical on Windows (Python 3.13.5, Node 24.17) and Linux
  (`node:24-bookworm`, Python 3.11.2, Node 24.21, offline; and in CI); the `results.json` of rec-smoke (`c20547b101fbb0c5`),
  rec-core (`fb3fab4f8275e437`), rec-robust (`a18ebf2921f5d2a3`) and replay-of-v2 (`89ac8eecf04e8c2a`) byte-identical over three
  runs on Windows and one on Linux (Docker, the README's recipe), every `check` PASS.
- **Hold-out slice** (`rec-full`, seeds 11 and 12, 52 references never in the tables or the fit; app -> v2): usable 0.014 ->
  0.087, metre 0.502 -> 0.671, tempo 0.449 -> 0.853, beat placement 0.106 -> 0.500, structure 0.373 -> 0.639, note values
  0.043 -> 0.210, downbeat F1 0.472 -> 0.781, stability 0.712 -> 0.323; hands 0.753 -> 0.744, pitch 0.857 -> 0.854. The open
  references move the same way (metre 0.537 -> 0.695): the gain is not memorised pieces.
- **Not run here:** the teacher tier (the private graph is the Lead's; G10-D15) and the page (G10a-4).

## 19. G10a-2 (hands): stage S4 (2026-10-03; implementer on Opus, AI-5b)

Worktree `D:/PPP-g10a2hands`, branch `g10-a2hands` from `origin/main` `2e09fad`, `origin/main` `e2c066b` (G10a-1) merged in.
Lane: S4 only (the grid, S3, is a parallel phase). Measurement first; every number below is reproducible with the commands in
19.8.

### 19.1 Baselines reproduced

At `2e09fad`: `run` + `check` of rec-core and rec-robust PASS; `notation.hand.accuracy` 0.8946 (app) / 0.8938 (legacy),
`critical.hands` 0.829 / 0.826 on rec-core, exactly the committed aggregates (the new `tools/hands_report.py` recomputes both from
the cases and agrees to four decimals). After G10a-1 (v2, legacy S4): rec-core v2 hands 0.895, gate 0.824 (G10a-1 18.5: 0.824).

### 19.2 Error analysis of the legacy hand split (rec-core, app options, 846 cases, 223,823 matched pairs)

`python tests/bench/tools/hands_report.py --suite rec-core`: 22,907 pairs (10.2 %) on the wrong staff.

| cause (reference onset group of the note) | wrong pairs | share |
| --- | --- | --- |
| **split**: both hands start notes there, the split point is wrong | 17,583 | 76.8 % |
| solo-LH: only the left hand starts there, (part of) it went up | 2,701 | 11.8 % |
| solo-RH: only the right hand starts there, (part of) it went down | 2,552 | 11.1 % |
| cross: the reference itself crosses at that onset (no split can be right) | 71 | 0.3 % |

By register: left-hand notes C4-B4 25 % wrong (8,829 of 34,714), left-hand notes >= C5 83 % (1,395 of 1,673), right-hand notes
C3-B3 65 % (3,158 of 4,855), right-hand C4-B4 11 %. By family and mechanism (read case by case with the reference beside the
output): **hymns** 7,240 split errors - the hymnal writes the tenor in the lower staff even when it sits above the alto's
register, and a 4-part chord is two plus two, while the pitch split takes the tenor into the right hand (`my-hope-is-built` 0.70);
**Hanon and Beyer's first pieces** (4,907 + most of Beyer's) - both hands in parallel octaves, a bare octave fits one hand so the
split keeps both notes on one staff (Hanon 0.77, Beyer 032-034 0.50); **left-hand figures in the treble** (Beyer 052, Czerny
849/007, sonatinas) - an Alberti or broken-chord left hand above C4 under a right-hand melody: the split point follows the figure
up and hands its upper notes to the right hand (the solo causes). The melody gap of section 1 E10: a right-hand top note written
in the left hand leaves a hole in the right-hand line; 7.3 % of the reference's melody notes (7,151 of 98,580; Hanon 31 %).

### 19.3 What was built

`rec/hands.js` (UMD, Node + page, pure, deterministic; registered as `PPPRecModules.hands`, exposed by `rec/index.js` as
`hands`), weights `rec/weights/hands-v1.json` (25 KB), evaluation `rec/tools/hands-v1.evaluation.json`.

**The model.** Notes that start together (the same tick; without ticks, attacks within 35 ms) are an onset group; inside a group
the hands do not cross (the lowest k notes are the left hand's: 0.3 % of reference pairs say otherwise). A beam Viterbi (32 states)
over the groups carries each hand's last notes (lowest, highest), when it played, how many notes, its previous inter-onset interval,
and scores each k with the weighted sum of learned costs: **part** (how many notes each hand takes, given the group's size and shape:
a bare octave, a wide pair, three, four, five or more notes), **span** (per hand and count), **move** (the change of a hand's centre,
per hand and time since it last played), **reg** (each note's register per hand), **gap** (between the hands when both play), **rel**
(one hand's new notes against the other hand's position), **cnt** (a hand's count after its previous count: texture continuity),
**ioi** (a hand's new interval over its previous one: rhythm continuity). Each hand starts at the piece's lower / upper quartile
(no flat "first note" cost). Two **styles**, each a full set of tables: *piano* (every collection but the hymns) and *chorale*
(the hymns: four parts on two staves, tenor and bass below); every piece is decoded under both and the cheaper path's style is
the piece's (the tables are counted the same way and the weights are shared, so the costs compare as weighted likelihoods).
Confidence per note: a logistic of the cost margin to the best choice that puts the note in the other hand, from the same incoming
state. Velocity and releases are deliberately not read (G10-D4; loudness is the synthetic performer's voicing cue, which the robust
family switches off).

**Training (AI-5b).** `python tests/bench/tools/hands_data.py` (the lint-clean, licence-evidenced references with two staves,
the benchmark's own reader; hold-out flagged) then `node tests/bench/tools/train_hands.js`: each table is -log of add-0.5 smoothed
counts along the written hands of the 257 training references (hold-out excluded), in integer thousandths; one weight per table by
coordinate search over a fixed grid on the mean per-reference hand accuracy of the truth. Deterministic (no random, no clock; the
decoding is spread over worker threads and put back in order); `--check` retrains and compares the weights and the truth evaluation
byte for byte (in the gate, about 40 s). `hands_data.py --perfs` + the trainer also evaluate **S4's real input**: 1,538 humanized
performances of the training references (cover, cover-pedal, human-real, cover+of; cover and cover-pedal+helper with helper beats;
seed 201, which no suite and no other model uses) through `toMusicXml` v2, the quantized notes read where audio-score.js hands them
to S4 (a require-cache stand-in in the trainer process only). Note-level data never leaves the git-ignored cache.

| hand accuracy (mean per piece) | legacy split | S4 v1 |
| --- | --- | --- |
| truth groups, 257 training references | 0.854 | **0.984** |
| truth groups, 52 hold-out references (never counted, never tuned on) | 0.844 | **0.977** |
| S4's real input, 1,538 training performances (v2 skeleton and grid) | 0.866 | **0.973** |

Per family (hold-out): Beyer 0.726 -> 0.991, Hanon 0.746 -> 0.994, hymns 0.867 -> 0.987, Czerny 599 0.930 -> 0.998, sonatina
0.899 -> 0.949, Burgmüller (1 piece) 0.986 -> 0.997, **Czerny 849 0.878 -> 0.881 (gate 5 -> 4 of 6)**.

**Wiring.** `audio-score.js` `finish()`: under `recording: 'v2'` the staff of every quantized note comes from `rec/index.js`'s
`hands.assignQ` (S4); `opts.hands: 'legacy'` keeps `assignHands` under v2 (the "v2 without S4" arm); `opts.hands: 'v2'` swaps only S4
on any path (the app's path in the `rec-hands` measurement suite). Without either option nothing changes. Asked for by name and
missing is an error; under v2 without the option a page whose `rec/` has no hand model keeps `assignHands`, and `result.handsReport`
(beside the graph, not in `stats`) says `{fallback: 'legacy'}`. Otherwise `handsReport` = `{model, style, groups, notes, right,
left, lowConfidence}`.

**Budget (section 11).** S4 alone: 25-30 ms for 1,070 notes (sonatina 018), 50-85 ms for a dense synthetic 1,800-note piece of
three-note groups (Node 24, Windows, a loaded machine); with S0-S2's ~150 ms the v2 front end stays under 300 ms. Model 25 KB.

### 19.4 What was tried and lost (measured, kept out)

- **One table set for all textures** (no styles): truth 0.967 / hold-out 0.947, but the hymnal's two-plus-two leaked into piano
  block chords (Czerny 599/035, micro M14: a bass note under a right-hand triad split 2+2): v2 path Czerny 599 0.980 -> 0.974.
- **No count / rhythm continuity**: Beyer 067's right-hand sixths and Czerny 599/030's left-hand sixths split one note per hand
  (in the piano corpus 88 % of two-note groups 5-9 semitones wide are split). The two features gained +0.002 truth / +0.005 hold-out;
  Beyer 067 is still the worst training piece (0.61): an emission model pays for every event, so the path that explains the sixths
  as one hand's dyads pays span and count costs the split path does not (19.7).
- **Weights fitted on S4's real input** (`--tune both`): mean hand accuracy on rec-core + rec-robust v2 rows 0.9706 against 0.9703,
  7 fewer cases passing the hands gate (Burgmüller); and it ties the weights to today's grid and skeleton artifacts, which S3 is
  changing in parallel. Kept as an evaluation.
- **The start register from the first 32 notes** and **a piece-relative register term** (distance to the legacy writer's global
  split point): no change beyond noise (0.9703 / 0.9701), not kept.
- **G3 `pro-staff` as the alternative S4** (G10-D14; `professional: 'on'`, only the staff pass): on rec-core + rec-robust v2 rows
  0.894 -> 0.912 (gate 0.825 -> 0.886) over the legacy split, against 0.970 (gate 0.979) for S4; G3 on top of S4: 0.968 (it moves
  hymn tenors back up: hymns 0.988 -> 0.971). Not used.

### 19.5 Results: v2 (legacy S4) against v2 + S4

Same performances, same SUT except S4 (`run.py ab --a git:origin/main --b worktree`, the `opts:v2` rows pair by case id; the
legacy and app rows are byte-identical, 19.6).

| suite, beats | n | hand acc | hands gate | usable | rec.usable | note values | rec.voice.f1 | rec.mv2h | rest P / R | false rests /100 bars | stability |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| rec-core, none | 564 | 0.894 -> **0.971** | 0.824 -> **0.980** | 0.089 -> **0.112** | 0.016 -> **0.028** | 0.243 -> 0.268 | 0.721 -> 0.798 | | | | 0.342 -> 0.346 |
| rec-core, oracle-noisy | 282 | 0.895 -> **0.967** | 0.823 -> **0.975** | 0.074 -> **0.103** | 0 -> 0 | 0.270 -> 0.326 | 0.720 -> 0.792 | | | | 0.236 -> 0.232 |
| rec-core, all | 846 | 0.895 -> **0.969** | 0.824 -> **0.979** (136 gained, 5 lost) | 0.084 -> 0.109 (+27, -6) | 0.011 -> 0.019 | 0.252 -> 0.287 (+46, -16) | 0.721 -> 0.796 | 0.765 -> 0.784 | 0.160 / 0.561 -> 0.190 / 0.547 | 109.0 -> 106.0 | 0.306 -> 0.308 |
| rec-robust (cover-alt), all | 282 | 0.893 -> **0.973** | 0.826 -> **0.979** (44 / 1) | 0.046 -> 0.053 | 0 -> 0 | 0.085 -> 0.092 | 0.739 -> 0.822 | | | | 0.343 -> 0.341 |
| rec-smoke | 48 | 0.952 -> **0.986** | 0.938 -> **1.000** | 0.250 -> 0.271 | 0.083 -> 0.104 | 0.333 -> 0.396 | 0.842 -> 0.893 | | | | 0.214 -> 0.216 |
| **replay-of-v2** (the browser's O&F on rendered audio, 20) | 20 | 0.806 -> **0.966** | 0.65 -> **0.95** | 0.05 -> **0.25** | - | 0.55 -> 0.80 | - | | | | |
| **hold-out** (rec-full seeds 11, 12: 52 references never counted or tuned on, 6 families) | 624 | 0.849 -> **0.961** | 0.744 -> **0.946** (132 / 6) | 0.087 -> **0.122** | 0.008 -> 0.022 | 0.210 -> 0.264 | 0.641 -> 0.762 | 0.736 -> 0.768 | 0.114 / 0.511 -> 0.154 / 0.498 | 124.1 -> 119.9 | 0.323 -> 0.327 |

Hold-out by family: Beyer 0.744 -> 0.950, Hanon 0.775 -> 0.958, hymns 0.870 -> 0.991, Czerny 599 0.938 -> 0.988, sonatina 0.899 ->
0.937, Burgmüller 0.983 -> 0.991, **Czerny 849 0.853 -> 0.854, and its hands gate 0.75 -> 0.67: the 6 hold-out cases that lose the
gate are all Czerny 849** (left-hand figures in the treble, 19.7).

By family (rec-core v2, hand accuracy): Beyer 0.755 -> 0.964 (gate 0.33 -> 0.94), Hanon 0.774 -> 0.971 (0.15 -> 1.00), hymns
0.858 -> 0.987, sonatina 0.936 -> 0.968, Burgmüller 0.873 -> 0.903 (0.76 -> 0.93), catalog 0.896 -> 0.911, **Czerny 599 0.979 ->
0.974, Czerny 849 0.952 -> 0.940, micro 0.989 -> 0.987 (2 cases lose the gate), samples 1.000 -> 0.947**.

**Errors by cause and the melody gap** (`hands_report.py`, rec-core v2 rows, 846 cases): wrong pairs 22,858 -> 8,386 (pair accuracy
0.898 -> 0.963); split 17,570 -> 4,003, solo-LH 2,625 -> 1,371, **solo-RH 2,588 -> 2,890**, cross 75 -> 122. By register: left-hand
notes C4-B4 wrong 8,905 -> 1,522, left >= C5 1,388 -> 814, right C3-B3 3,098 -> 672, right C4-B4 5,174 -> 4,039, **right >= C5 435 ->
1,007** (a high left-hand figure's neighbours pulled down: the cost of 19.7). **Melody gap** (a reference melody note - the right
hand's top note at its onset - written in the left hand, the hole of section 1 E10): **7.0 % -> 3.9 %** of melody notes (6,917 ->
3,885 of 98,545); Hanon 28.5 % -> 4.8 %, Burgmüller 9.3 -> 7.5 %, sonatina 5.6 -> 4.0 %, hymns 1.5 -> 0.5 %, Czerny 599 1.8 -> 0.6 %;
worse: Czerny 849 5.6 -> 6.7 %, Beyer 1.6 -> 2.5 %, micro 0.7 -> 1.6 %.

**S4 alone on the app's path** (`rec-hands`, the app's options and skeleton, only S4 swapped, the very performances of the app
rows; 1,128 cases): hand accuracy 0.894 -> 0.970, critical.hands 0.831 -> 0.981 (174 gained, 5 lost), usable 0.014 -> 0.019,
rec.voice.f1 0.725 -> 0.802, rest recall 0.540 -> 0.525, notation-check class 7 28.3 -> 30.0 per 100 bars (19.6), class 5 19.3 ->
19.0, class 6 12.9 -> 12.7. The development numbers before G10a-1 merged (model without styles) were 0.958 on the same cases.

### 19.6 What else moved, and why

- **Notation-check classes** (rec-core v2, per 100 bars): 1 0.95 -> 0.96, 2 0.43 -> 0.43, 3 1.55 -> 1.49, 4 0.04 -> 0.03, 5 8.12 ->
  8.23, 6 2.95 -> 2.89, **7 1.39 -> 1.41**. On the app path (rec-hands against the app rows) class 7 rises 28.3 -> 30.3: the legacy
  grid's false triplet brackets (one-note brackets on Hanon's 16ths) are drawn once per staff, and a hand split that put both hands'
  notes on one staff drew them once; with the hands right each staff draws its own (Hanon +21 per 100 bars). The defect is the grid's
  (S3), not the hands'; v2's own grid writes few such brackets, so on v2 the effect is +0.03.
- **Rests**: precision 0.160 -> 0.190 and false rests -3.0 per 100 bars, recall 0.561 -> 0.547. **Hymns' false rests rise 136 -> 167
  per 100 bars and their note values 0.225 -> 0.196**: with the tenor in the lower staff a staff holds two parts with different
  rhythms, which the one-voice writer (S5/S6, G10a-3) writes as one line with rests; the legacy split hid it by moving the tenor
  into the right hand's chords. A voices decision for G10a-3, not a hand error.
- **rec-full (nightly, 11,196 cases, every option set)**: hand accuracy 0.866 -> 0.902, critical.hands 0.767 -> 0.839, note values
  0.104 -> 0.127; against its old baseline the check flags `tag set:hymns` note durations 0.537 -> 0.519 (the same tenor-below
  effect), `feature:dense-chords` and `feature:pickup` durations -0.014 to -0.016, `metre-class:compound-triple` note values 3 of 36
  cases, the sample's hands 0.999 -> 0.982; rebaselined with that reason.
- **Accidentals**: 3 rec-core v2 cases lose `critical.accidentals`, 8 hold-out cases lose it and 2 gain it (an accidental's bar
  state is per staff; a note moving staff changes which accidentals the page needs). **Ledger lines**: replay-of-v2 `read.ledger_lines.heavy_rate` 0 -> 0.014 (a warning:
  a very high or low note on the other staff).
- **The micro guard** (no drop allowed on a micro piece) flags v2 rows of micro pieces in the A/B: M05/M06 (32nd runs) hands 1.0 ->
  0.77-0.94 and two lose the hands gate, M17, M01, M04, M07, M12 by 0.01-0.04. Read case by case: the v2 grid quantizes consecutive
  32nds of a run to one tick, so S4 receives "chords" like C3 E3 G3 C4 D4 (the left hand's chord and the run's first two notes) and
  splits them by register (S4's confidence on those notes is 0.2-0.5); the legacy split happened to cut them at middle C. S3's
  32nd/tuplet acceptance criterion covers the cause; the rebaselined suites carry these values.

### 19.7 Limits

- **Czerny 849** (hold-out 0.88, rec-core 0.94, below the legacy split on rec-core) and **Burgmüller** (0.90): fast figures that the
  grid merges into chords, and left-hand figures that leap above the right hand's position. **Beyer 067** (0.61 on the truth):
  right-hand sixths over a sparse left hand read as one note per hand. Both need either a discriminative per-decision model (a CRF:
  the generative costs charge every event a path explains) or a grid that keeps runs apart (S3).
- **Styles** are piece-level: a piece that is a chorale in one section and piano writing in another takes one style.
- **Truth convention**: the chorale style reproduces the hymnal's staves (tenor below) because the benchmark's truth is the hymnal;
  for a hymn played as a piano arrangement a teacher might accept the tenor in the right hand.
- **No real recording**: synthetic performances, the replay-of tier (real O&F on rendered audio) and the hold-out; the teacher's
  private tier was not run (Lead).

### 19.8 Verification

- **Legacy byte-identical.** `run.py ab --a git:origin/main --b worktree` + `ab_identical.py`: smoke, core, robust, smoke-app,
  core-app, robust-app, replay-public, replay-of, replay-of-app - every case the same (status, metrics, semantic projection). The
  legacy and app rows of rec-smoke (96), rec-core (1,692) and rec-robust (564) identical case by case. The 975 `arrangeSingleNote`
  requests (325 catalogue pieces x 3 levels) give the same graphs as a clean `git archive` of `origin/main` (933 arranged, 42
  refusals with the same codes; none of its modules changed; checked by importing every catalogue file and running the app's extracted glue,
  `tests/realize/app-single-extract.js`, from each tree, hashing the serialized graphs).
- **Mutation coverage.** `mutation-check --rec`: the ten G10a-0 recording mutations and the six G10a-1 skeleton mutations still
  caught, the no-ops byte-identical; S4's four on `rec-mutation-v2`, each a REGRESSION naming its metric: S4 back to the legacy split
  (critical.hands 0.988 -> 0.786, notation.hand.accuracy 0.987 -> 0.896), no motion cost (-> 0.980), no chorale style (-> 0.928), no
  partition prior (-> 0.972). Swapping the hands' starting registers moved the hand accuracy 0.9870 -> 0.9871 (it decides a piece's
  first notes only): not kept as a guard, stated in `mutation.py`. No new metric was added (the melody gap is a report of
  `hands_report.py`, not a gated metric: a new `rec.*` metric would change every row's results).
- **Determinism.** The `results.json` of rec-smoke (`d9ed8014b35266a7`), replay-of-v2 (`fb51600af382af77`), rec-core
  (`555997ad7367ef59`) and rec-robust (`6c547acc1e566b3b`) byte-identical over three runs on Windows (Python 3.13.5, Node 24.17) and
  on Linux (`node:24-bookworm`, Python 3.11.2, Node 24.21, offline, the README's recipe), every `check` PASS there;
  `train_hands.js --check` the same on both.
- **Commands.** `python tests/bench/tools/hands_report.py --suite rec-core` (errors by cause, register, family; melody gap);
  `python tests/bench/tools/hands_ab.py --a A/results.json --a-opt v2 --b B/results.json --b-opt v2 --by family` (case-by-case A/B);
  `python tests/bench/run.py run --suite rec-hands` (S4 alone on the app path); `node tests/bench/tools/train_hands.js --check`.

### 19.9 What the next phases need

- **Interface** (`require('./rec/index.js').hands`, page `PPPRec.hands`): `assign(notes, opts) -> {staff, conf, report}`; notes
  `{midi, tick?, on?, attack?, staff?}` in any order; `staff[i]` 1 (right hand, upper staff) or 2 (left), 0 for a note without a
  pitch; a note that comes with staff 1 or 2 keeps it (conf 1); `conf[i]` in [0, 1]; opts `{model, chordWindow (0.035 s),
  secondsPerTick (0.5/24), lowConf (0.75)}`; `report {version, model, style ('piano'|'chorale'), groups, notes, right, left,
  lowConfidence}`. `assignQ(q, ctx)` writes `q[i].staff` on audio-score.js's quantized notes and returns the same result.
  `setModel(json)`; a missing or foreign model throws `E-HANDS-NO-MODEL`.
- **S3 (grid, parallel)**: S4 reads only `tick` (equal ticks = one onset group) and `attack`/`on` (seconds between groups). It runs
  after the quantiser and before the staff-dependent writers (exact bars' per-staff snapping, rests). Notes S3 puts on one tick are a
  chord to S4: merging a run's consecutive notes is the micro M05/M06 failure (19.6). A grid change needs no S4 change; the hand
  weights are fitted on the truth, not on the grid's output, on purpose.
- **G10a-3 (S5 voices, S6 rests)**: the chorale style marks four-part textures (two parts per staff with their own rhythms: the hymns'
  rests of 19.6 want two voices per staff there); `conf` per note can feed S5 and G10a-4's uncertain-bar flags.
- **G10a-4 (page)**: load `rec/hands.js` before `rec/index.js` and `rec/weights/hands-v1.json` as `window.PPPRecHandsWeights`.

### 19.10 Against the design

- `hand accuracy >= 0.95` (section 10, a2): met on every synthetic tier (rec-core 0.969, rec-robust 0.973, rec-smoke 0.986, replay-of-v2
  0.966, hold-out 0.961) as a relative gain of +0.07-0.16 over the legacy split, not forced: Czerny 849 and Burgmüller stay
  below it.
- E10 / section 9's "the hand split creates the melody gaps": confirmed and reduced (melody gap 7.0 % -> 3.9 % on rec-core v2); the remaining gaps are the
  grid's merged runs and the figures of 19.7.
- Found on the way: the humanizer's `+of` / `+helper` overlays and `oracle-noisy` beats are seeded by the case's option name
  (`perform.py`), so legacy / app / v2 rows of those families (3 of rec-core's 6 rows) are different draws, not the same input as
  the G10a-0/a1 records say; the rec-hands suite uses the new matrix-row field `perform_as` to replay the app rows' very
  performances. Rows with the same option name (v2 vs v2 + S4 here) were never affected.

## 20. G10a-2 (grid): the grid of each beat, stage S3 (2026-10-03; implementer on Opus, AI-5b)

Worktree `D:/PPP-g10a2grid`, branch `g10-a2grid` from `origin/main` `2e09fad`, `origin/main` `e2c066b` (G10a-1) merged in.
The hands half of G10a-2 (S4) is section 19; this section is S3, measured on top of it after `afdb23b` was merged in. Measurement first, as in section 18.

### 20.1 Baselines reproduced

At `2e09fad`: rec-smoke, rec-core, replay-of and replay-of-app `run` + `check` PASS. After merging `e2c066b`, `v2` (G10a-1's
skeleton with the legacy quantisers) is the "before" of every v2 number below; its committed baselines are the reference.

### 20.2 Error analysis of the legacy grid stage

**The stage alone** (`tests/bench/tools/train_grid.js --evaluate`: the true beat times given, so neither the skeleton nor the
writer can hide or cause an error; a verbatim copy of `tripletBeats` / `snapStraightBest` / `snapTriplet` / `quantize` /
`quantizeCompound` against the model; hold-out references, every family, 30,625 quarter beats with an onset):

| | legacy | the cause, read in the code and the data |
| --- | --- | --- |
| right grid per beat | 0.761 | per-onset decisions with hand-set costs, no beat-level evidence, no prior |
| false 32nd beats | 5,637 (18 % of beats; 32nd P 0.082) | `snapStraightBest` takes the 32nd lattice whenever an onset is more than half a 32nd off (24-ms jitter at 100-150 qpm is enough); this is what `snapOnsets` (exact bars) then has to undo, at a cost in onset accuracy (G10a-0 correction 2) |
| triplet beats | P 0.365, R 0.301 | `tripletBeats` flags a beat when two onsets are > 0.08 beat off the 16th grid and thirds fit better: jitter does that at fast tempi; three onsets that merged or split look the same |
| attacks | 6 % of heard attacks (cover family) sound two different written onsets | `clusterNotes`' 50-ms window merges two 16ths that the timing noise brought within 50 ms; its run detector splits chords heard a frame apart |
| swung eighths written straight | 20 % | swing reads as quarter-eighth triplets |
| compound beats (dotted quarters) | right grid 0.858, onsets 0.876 | `quantizeCompound` treats every 16th point like an eighth point |
| triplet 16ths (T6) | 2.6 % of beats | no writer for them (the exact-bars writer and `rec-tuplet.js` write thirds only) |

End to end, in legacy the triplet flags also feed `compoundTactus` (2/4 pieces became 6/8 in 24 of 48 oracle-noisy cases);
in v2, S2 decides the metre before S3, so that coupling is gone.

### 20.3 What was built: `rec/grid.js` as v2's S3

`toMusicXml(input, {recording: 'v2'})` now places its onsets with `rec/grid.js` on G10a-1's skeleton (simple and compound);
`opts.grid: 'legacy'` keeps G10a-1's legacy quantisers under v2 (the "v2-s3legacy" rows). Without `opts.recording` nothing
loads it: legacy and the app's options are byte-identical (20.6).

**The model** (generative per beat, all parameters counted; `rec/weights/ai5b-grid-v1.json`, 2.7 KB):
- grid kinds of a quarter beat: `16`, `32`, `3` (triplet eighths), `swing8` (straight eighths heard long-short, 1.5:1 to 2:1,
  written straight); of a dotted-quarter beat: `c8` (eighths), `c16` (16ths; a duplet's half is one of them);
- per kind, the probability of each **occupancy pattern** (which grid points hold a heard onset: 16 patterns for `16`,
  `swing8`, 8 for `3`, 64 for `c16`; `32` = a 16th pattern times independent odd 32nds, at least one) - learned on the heard
  onsets, so an AMT miss or merge is in the table; an earlier independent-occupancy version under-rated dense 16th beats ten
  times and wrote them as 32nds;
- the onsets are `clusterNotes`' attacks (a rolled chord stays one), split where two frames of an attack are more than 40 ms
  apart or continue each other by step (two 16ths merged by the 50-ms window; a fast run the run detector missed);
- the onsets of a beat matched in order to exactly the pattern's points (a dynamic program), each point taking a group of
  onsets heard at most 40 ms apart that neither repeat nor continue by step a pitch of the one before (a chord heard over
  two frames, not a run), every onset scored as a density
  (Gaussian timing noise; a joined onset by its offset from the group's mean) - without that accounting a finer grid won
  wherever chords were spread, and whole Hanon pieces flipped to 32nds under 10 ms of noise;
- the next beat's first onset may be heard early (a point of every kind); an onset no point explains is an outlier;
- the timing noise is the learned one, then the piece's own (the first pass's residuals, pooled with 30 pseudo-onsets);
- an HMM over the beats with onsets (learned priors and stay probabilities, forward-backward) gives each beat's kind and
  confidence;
- the snap is the matching itself (no onset moves past another; a chord's onsets share a tick).

Writer constraints kept: once the hands are known, `writable()` applies `snapOnsets`' genuine-run rule and nothing more (an
odd-32nd onset of a staff that played nothing a 32nd before moves to the 16th grid: the exact-bars writer has no 32nd rest).

**Training (AI-5b).** `tests/bench/tools/grid_data.py` (the benchmark's own performer and humanizer, LCG) writes humanized
performances of every lint-clean **non-hold-out** reference x cover, cover-pedal, human-real, swing, cover+of x seeds 101-102
(no suite uses them; cover-alt is never trained on) with the true grid of every beat; `node tests/bench/tools/train_grid.js
--write` counts the tables. `--check` (in the gate) regenerates the data and refits: byte-identical. No external data, no
audio, no user material, no note-level data committed. **Budget:** 95 ms for a 3-minute 1,800-note piece in Node (S0-S2 take
~150 ms: the v2 total stays under the 300 ms of section 11); weights 2.7 KB.

**The interface** (for G10a-3's `rec/index.js` and the writer):
```
PPPRecGrid.plan(beats, notes, {compound, kinds, model, ticksPerBeat}) ->
  { beats: [{beat, kind: '16'|'32'|'3'|'swing8'|'c8'|'c16', conf, post: {kind: p}, n, swing?}],   // GridPlan
    onsets: [{beat, tick, frac, kind, err}],     // per input note, same order; tick from beats[0] (24 or 36 a beat)
    report: {version, model, sigmaSec, beats: {kind: count}, lowConf} }
PPPRecGrid.legacyQ(notes, beats, {compound}) -> {q, errSum, plan, report}   // audio-score.js quantize/quantizeCompound's note shape
PPPRecGrid.writable(q) -> {moved}                                            // the exact-bars writer's run rule, after S4
```
`beats` = the skeleton's written beats (quarters, or dotted quarters with `compound: true`); `notes` = cleaned, clustered notes
(`attack` optional). The graph's provenance carries `params.recording.grid = {model, lowConf, beats}`; `result.gridPlan` holds
the plan beside the graph (not in stats) - per-beat `conf` is what an uncertain-bar flag (G10a-4) needs.

### 20.4 Tried and dropped (measured)

- Independent occupancy probabilities per grid point (dense 16th beats ten times too unlikely: 32nd P 0.12 in sample).
- Joined onsets scored without a density (32nd flips; rec-grid stability worse than legacy on Hanon); fixed, not dropped.
- Onsets as every distinct note time (slots) instead of `clusterNotes`' attacks split at 40 ms: +0.003 stage accuracy, but
  a different chord grouping than S0's; the attacks are kept.
- No early downbeat on the piece's last beat (it lost a hymn's last chord played early: 17 -> 16 bars). Reverted.
- Swing up to 2.33:1 (dotted eighth + 16th read as swing and written straight: micro M10). Limited to 2:1.
- The benchmark-only hook `opts.grid: 'v2'` on the legacy pipeline (the brief's "v2-grid" axis): replaced by wiring into v2
  when G10a-1 merged (the Lead's instruction); it never touched the legacy path.

### 20.5 Results

**The stage alone** (true beats; `rec/tools/ai5b-grid-v1.evaluation.json`; legacy -> model):

| set | beats | right grid | triplet P / R | 32nd P / R | onsets on the true written position | swung written straight | compound onsets |
| --- | --- | --- | --- | --- | --- | --- | --- |
| hold-out references (52, 6 families) | 30,625 | 0.761 -> **0.969** | 0.365 / 0.301 -> **0.956 / 0.689** | 0.082 / 0.877 -> 0.400 / 0.958 | 0.827 -> **0.955** | 0.20 -> **0.98** | 0.876 -> **0.999** |
| hold-out, beats +-20 ms | 30,493 | 0.746 -> 0.968 | 0.356 / 0.297 -> 0.951 / 0.689 | 0.077 -> 0.395 | 0.818 -> 0.954 | 0.22 -> 0.99 | 0.858 -> 0.998 |
| robustness family cover-alt (never trained) | 13,968 | 0.762 -> 0.981 | 0.242 / 0.259 -> 0.984 / 0.699 | 0.047 -> 0.383 | 0.825 -> 0.966 | - | 0.768 -> 0.921 |
| open references, seed 104 | 56,327 | 0.791 -> 0.975 | 0.229 / 0.265 -> 0.884 / 0.671 | 0.058 -> 0.381 | 0.843 -> 0.961 | 0.20 -> 0.98 | 0.816 -> 0.926 |

Triplet recall stops at 0.69 because of T6 (triplet 16ths): on the hold-out set 804 of the model's 810 missed triplet beats and
802 of its 828 false 32nd beats are T6 beats written as 32nds (the writer has no sextuplet); plain triplet beats (T3) are
found at 0.997.

**rec-grid** (CI; core references; the very same performance and skeleton on both sides, S4 = `rec/hands.js` on both;
v2-s3legacy -> v2):

| row | usable | rec.tuplet P | R | false/100 beats | onset_pos | rec.onset_f1 | onset F1 50 ms | classes 5 / 6 / 7 per 100 bars | stability | note values | beat placement | hands |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| cover, oracle | 0.142 -> **0.326** | 0.484 -> **0.982** | 0.260 -> 0.401 | 3.92 -> 0.28 | 0.797 -> **0.844** | 0.792 -> 0.839 | 0.932 -> 0.978 | 10.3/3.7/1.2 -> 5.6/0/0 | 0.232 -> 0.168 | 0.184 -> 0.440 | 0.645 -> 0.809 | 0.979 -> 0.979 |
| human-real, oracle | 0.262 -> 0.291 | 0.870 -> 0.993 | 0.150 -> 0.206 | 0.83 -> 0.23 | 0.819 -> 0.825 | 0.814 -> 0.819 | 0.983 -> 0.984 | 6.8/0.5/0.3 -> 6.1/0/0 | 0.152 -> 0.125 | 0.348 -> 0.411 | 0.773 -> 0.794 | 0.986 -> 0.986 |
| cover+of, oracle | 0.036 -> 0.092 | 0.486 -> 0.931 | 0.190 -> 0.617 | 3.82 -> 1.33 | 0.789 -> 0.834 | 0.743 -> 0.784 | 0.880 -> 0.921 | 11.1/3.4/1.3 -> 5.0/0/0 | 0.219 -> 0.162 | 0.106 -> 0.270 | 0.624 -> 0.780 | 0.972 -> 0.986 |
| swing, oracle | 0.043 -> **0.220** | 0.398 -> 0.942 | 0.168 -> 0.294 | 6.92 -> 1.10 | 0.708 -> **0.781** | 0.703 -> 0.776 | 0.876 -> 0.942 | 14.3/6.4/2.3 -> 6.4/0/0 | 0.269 -> 0.195 | 0.078 -> 0.305 | 0.404 -> 0.731 | 0.986 -> 0.979 |
| cover, none (production) | 0.050 -> 0.114 | 0.417 -> 0.914 | 0.215 -> 0.253 | 5.78 -> 2.45 | 0.552 -> 0.582 | 0.548 -> 0.578 | 0.890 -> 0.919 | 8.7/3.6/1.8 -> 4.1/0/0 | 0.394 -> 0.306 | 0.128 -> 0.291 | 0.426 -> 0.525 | 0.986 -> 0.986 |

**rec-core** (v2 with S4 and the legacy quantisers, `afdb23b` -> v2 with S4 and `rec/grid.js`; legacy and app rows identical
case by case):

| beats | usable | rec.usable | rec.tuplet P | R | false/100 beats | onset_pos | rec.onset_f1 | classes 5 / 6 / 7 | stability | note values | beat placement | hands | pitch |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| none (564) | 0.112 -> **0.156** | 0.028 -> 0.048 | 0.519 -> **0.905** | 0.200 -> 0.290 | 4.60 -> 1.81 | 0.565 -> 0.589 | 0.554 -> 0.577 | 7.2/2.4/1.3 -> **4.0/0/0** | 0.346 -> 0.268 | 0.268 -> 0.418 | 0.457 -> 0.543 | 0.980 -> 0.982 | 0.796 -> 0.800 |
| oracle-noisy (282) | 0.103 -> **0.262** | 0.000 -> 0.057 | 0.448 -> **0.968** | 0.224 -> 0.376 | 4.66 -> 0.91 | 0.775 -> **0.835** | 0.761 -> 0.820 | 10.2/3.8/1.6 -> **3.7/0/0** | 0.232 -> 0.173 | 0.326 -> 0.585 | 0.560 -> 0.791 | 0.975 -> 0.979 | 0.936 -> 0.947 |

Other v2 gates on rec-core (none / oracle-noisy): structure 0.592 -> 0.606 / 0.862 -> 0.894, rest precision 0.190 -> 0.202 /
0.191 -> 0.211, voice F1 0.798 -> 0.815 / 0.791 -> 0.812, MV2H 0.763 -> 0.785 / 0.824 -> 0.865; metre, tempo and key unchanged
(S3 does not touch the skeleton); accidentals 0.995 -> 0.991 / 0.979 -> 0.989.

**rec-robust** (cover-alt; v2 + S4 -> v2 + S4 + S3): none: usable 0.028 -> 0.113, tuplet P 0.406 -> 0.920, R 0.183 -> 0.346,
onset_pos 0.569 -> 0.596, stability 0.391 -> 0.306, note values 0.071 -> 0.255, classes 5/6/7 11.8/4.3/3.2 -> 7.3/2.5/9.8;
oracle-noisy: usable 0.078 -> 0.241, tuplet P 0.475 -> 0.981, onset_pos 0.786 -> 0.842, classes 14.7/5.7/2.3 -> 7.5/0/0;
hands 0.986 / 0.972 unchanged. The class 7 rise on none is one case (czerny849/002, which v2 writes in 2/2: the triplets are
now found, and the writer, exact bars and `rec-tuplet.js` both x/4-only, brackets them note by note).

**rec-smoke** (v2): usable 0.271 -> 0.312, rec.usable 0.104 -> 0.146, tuplet P 0.708 -> 0.979, onset_pos 0.701 -> 0.723,
classes 4.3/1.9/1.3 -> 2.5/0/0, stability 0.216 -> 0.185.

**The real-AMT tier** (replay-of: the browser's Onsets & Frames on rendered audio, 20 fixtures):

| | usable | onset F1 (50 ms) | onset_pos | IOI | values (duration acc.) | note values gate | structure | hands | false tuplets / 100 notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| library default | 0 | 0.832 | 0.141 | 0.541 | 0.487 | 0.10 | 0.45 | 0.65 | 4.49 |
| app options (production) | 0 | **0.751** | 0.173 | 0.641 | 0.511 | 0.05 | 0.45 | 0.65 | 11.38 |
| v2 (G10a-1: legacy S3, legacy S4) | 0.05 | 0.890 | 0.733 | 0.933 | 0.804 | 0.55 | 0.70 | 0.65 | 2.24 |
| v2 + S4 (section 19) | 0.25 | 0.890 | 0.733 | 0.933 | 0.870 | 0.80 | 0.70 | 0.95 | 2.16 |
| **v2 + S4 + S3 (`rec/grid.js`)** | **0.30** | **0.901** | **0.748** | **0.976** | **0.905** | **0.95** | **0.75** | 0.95 | **0** |

G10a-0's correction 2 (the app's exact-bars snap costs onset accuracy on real transcriptions: 0.832 -> 0.751) does not apply to
v2's grid stage: it places onsets once, per beat, and the writer's only remaining move is the genuine-run rule.

**Hold-out slice** (the 52 hold-out references, never in the tables; seeds 11 and 12; a scratch suite of rec-full's rows plus
cover with oracle beats, v2 + S4 -> v2 + S4 + S3, paired rows):

| beats | n | usable | rec.usable | rec.tuplet P | R | false/100 beats | onset_pos | onset F1 50 ms | classes 5 / 6 / 7 | stability | note values | beat placement | hands |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| none | 520 | 0.112 -> **0.154** | 0.027 -> 0.044 | 0.489 -> **0.877** | 0.230 -> **0.644** | 5.52 -> 2.63 | 0.564 -> 0.601 | 0.890 -> 0.918 | 2.4/0.9/0.5 -> 0.8/0/0 | 0.343 -> 0.274 | 0.221 -> 0.365 | 0.467 -> 0.552 | 0.942 -> 0.942 |
| oracle | 104 | 0.144 -> **0.212** | 0 -> 0.048 | 0.505 -> **0.971** | 0.281 -> **0.649** | 4.24 -> 0.93 | 0.795 -> 0.832 | 0.945 -> 0.985 | 4.6/1.6/0.9 -> 1.1/0/0 | 0.252 -> 0.181 | 0.164 -> 0.308 | 0.702 -> 0.817 | 0.971 -> 0.962 |

The nightly rec-full (11,196 cases, every reference, hold-out included) moves the same way and is rebaselined (its legacy
and app aggregates identical): usable 0.052 -> 0.073, rec.usable 0.009 -> 0.015, beat placement 0.243 -> 0.273, note values
0.127 -> 0.177, rec.tuplet P 0.404 -> 0.533, R 0.214 -> 0.258, onset F1 (50 ms) 0.836 -> 0.845, stability 0.585 -> 0.564 (all
options pooled, so legacy and app dilute every number).

### 20.6 Verification

- **Legacy byte-identical.** The legacy and app rows of rec-smoke, rec-core and rec-robust equal their baselines case by case
  (0 of 2,352 differing); replay-of and replay-of-app PASS unchanged; the 975 `arrangeSingleNote` requests of the app's one-note glue (325 catalogue pieces x three levels) give the same graphs and refusals as a clean `git archive` of `origin/main` (933 arrangements and 42 refusals on both sides, 0 of 975 differing; measured against `e2c066b` before S4 merged: neither stage touches the arrangers or the one-note glue); `run.py ab --a git:origin/main` + `ab_identical.py` on core, core-app, smoke-app and replay-of-app: every case the same (status, metrics, semantic projection). Without `opts.recording` the code path is
  the old one (`gridV2` null; `rec/grid.js` is not even required: a test asserts it).
- **Mutation coverage.** `mutation-check --rec`: rec-mutation (legacy, app) PASS unchanged; rec-mutation-v2 PASS with all
  fifteen v2 decisions (G10a-1's six, S4's four, S3's five) and the no-op byte-identical. The grid's: no triplets
  (rec.tuplet.recall 0.167 -> 0, notation.tuplets.f1 0.164 -> 0), a triplet bias (precision 0.964 -> 0.780, false triplet
  beats 1.10 -> 4.75 per 100), no chord groups (tuplet precision 0.964 -> 0.952, false rests, identity on micro pieces), no
  chain across beats (tuplet precision 0.964 -> 0.881), and G10a-1's on-beat slip, now guarded where v2 decides it
  (`rec/grid.js`'s early window: pitch integrity 0.988 -> 0.018). (Main's own nightly `mutation-check` failed in 14 s and its
  nightly-rec runner was shut down on 2026-10-02, before this work; not touched here.)
- **Determinism.** Three runs on Windows (Python 3.13.5, Node 24.17) and one on Linux (`node:24-bookworm`, offline, the
  README's recipe) give byte-identical `results.json`: rec-grid `a602d5330bde73be`, rec-smoke `8a753c64be5f5027`, replay-of-v2
  `5615c28ea3180b9a`; `train_grid.js --check` "same" on both (the data regenerated by the humanizer's LCG, the fit by counting).
- Unit tests: `tests/rec/grid.test.js` (straight 16ths stay straight, a triplet beat among straight ones, swing written
  straight, a chord over two frames, the fallback without weights, the legacy note shape, the budget) and
  `tests/rec/grid-v2.test.js` (the v2 wiring, `grid: 'legacy'`, legacy never loads the module, a compound skeleton's eighths,
  the run rule against class 5).

### 20.7 Against the a2 targets, limits, and what the next phases need

| a2 target (section 10, S3 part; relative per section 17) | measured | verdict |
| --- | --- | --- |
| `rec.tuplet` P >= 0.9 | rec-core 0.905 (none) / 0.968 (oracle-noisy); rec-grid oracle 0.982 | **met** |
| `rec.tuplet` R >= 0.9 | 0.290 / 0.376 (rec-core); stage alone 0.689 | **not met**: T6 (no writer), the skeleton (with beats none the windows are wrong: R 0.25 on cover/none), and the few triplet pieces of the core (10) |
| onset_pos up | up on every suite and row (rec-core +0.024 / +0.060; replay-of-v2 +0.015) | met |
| micro 32nd / tuplet pieces not worse | rec-grid: M04 triplets recall 0.56 -> 1.0 (cover, oracle), 0 -> 1.0 (cover+of); M05 / M06 32nds onset_pos up in 7 of 8 rows, their false triplet beats gone, no class 5; a fast run is not merged onto one tick (point 4) | met; the micro drops of the v2 gate rows are point 3 |
| classes 5-7 down | 0 for classes 6 and 7 on rec-core; class 5 roughly halved | met (rec-robust class 7: the 2/2 writer) |

**Limits and contradictions with the design (stop condition 3 reported, not forced).**
1. **Tuplet recall >= 0.9 is not reachable by S3 alone.** Triplet 16ths need a sextuplet writer (S7: `exactGrid`,
   `exactPieces`, `rec-tuplet.js` write thirds only), and 2/2 and compound bars have no exact-bar grid at all; plain triplet
   beats are found at 0.997 when the beats are right. The recall gate should be on writable kinds, or wait for G10a-3's writer.
2. **Hands.** Before S4 merged, S3 lowered legacy `assignHands`' accuracy slightly (rec-core 0.824 -> 0.819, Hanon 0.770 ->
   0.758): the legacy split scores a group by pitch span only (an octave pair in one hand costs nothing) and had found Hanon's
   split from groups holding two merged written onsets, which S3 now separates (forcing every legacy cluster back onto one tick
   restores it exactly, 0.863). With S4 (`rec/hands.js`) the effect is gone: hands 0.980 -> 0.982 / 0.975 -> 0.979 on rec-core.
3. **Micro drops the gate flagged** (rebaselined with this reason): M10-dotted when v2's skeleton reads it as 6/8 (beats none:
   the `c8` grid of a wrong compound metre loses its dotted 16ths; with the right skeleton 2 of 32 dotted beats still read as
   swing); M23-repeated-notes cover+of (an AMT-merged repeated 16th leaves three onsets on thirds: read as a triplet beat);
   M04 rows where the skeleton is wrong (onset accuracy < 0.1 before and after); M06-32nds cover / none (onset_pos 0.667 ->
   0.593, hand accuracy 0.889 -> 0.815: 32nds the transcription put in one frame, point 4); 6 critical.accidentals flips on
   rec-core (net 0.995 -> 0.991 on none, 0.979 -> 0.989 on oracle-noisy: notes on other ticks change a bar's accidental state).
4. **Fast runs and one tick** (the S4 agent's report: v2 writes a fast 32nd run's notes on one tick, micro M05 / M06). Measured
   as written onsets merged onto another's tick in those 8 performances: legacy quantiser 6-14, `rec/grid.js` before the fix
   2-18 (32nds a frame apart kept in one `clusterNotes` attack when its run detector missed them), now 1-8: an attack whose
   frames continue each other by step is a run, not a chord, and such onsets are never joined. The rest are notes the
   transcription put in the very same frame (two written 32nds heard in one 32-ms frame), which no timing can separate.
5. The swing family is 1 of 5 training families (prior 4.5 % of beats): real swing frequency is unknown; the teacher tier
   (private) should show how often `swing8` fires on the teacher's piece (its 14 % of attacks off every grid, E5).

**For S4 (`rec/hands.js`).** S3 hands over `q` (legacy shape) with `tick` per note: notes of one written onset share a tick
(a chord heard a frame apart is joined), two written onsets that `clusterNotes` merged are separated, a run is never one tick
unless the transcription heard its notes in one frame. `result.gridPlan.plan[k].conf` is per beat if S4 wants to weigh
uncertain beats. S3 runs before S4 (`legacyQ`), the writer's run rule (`writable`) after it.

**For G10a-3 (S5-S10 and `rec/index.js`).** `rec/grid.js` is pure and self-contained; `rec/index.js` can call
`PPPRecGrid.plan(skeleton.beats, notes, {compound: skeleton.metre.compound})` and get the GridPlan and onset ticks; the
writer must learn sextuplets, x/2 and compound exact bars for the remaining tuplet recall and the 2/2 brackets;
`writable()` is a writer constraint that can go when the writer writes 32nd rests or S6 decides silences.
## 21. G10c-0: what the one-note arranger does to recordings (2026-10-03; implementer on Sonnet)

Worktree `D:/PPP-g10c0`, branch `g10-c0` from main `2e09fad`, merged with main `b52b693` (G10a-1, G10a-2 hands and grid) before the PRs. The
`rec-arrange` benchmark is tests, tools and baselines only (no app, no `audio-score.js`, no engine file); the interim melody guard built beside it is not shipped (21.6).

### 21.1 The benchmark

`"rec_arrange": true` suites (`pppbench/recarrange.py`, `tests/bench/node/rec-arrange.js`, the pure metrics in
`rec-arrange-metrics.js`) build the same cases as a `rec` suite (calibrated humanizer `perform/3` over the catalogue, the stage
options of each matrix row), build the recording graph with the app's options, arrange it **the way the app does** (the app's own
`arrangeSingleNote` glue, `tests/realize/app-single-extract.js`, at beginner / intermediate / advanced), and measure the arrangements
against the TRUE score: its melody (SongGraph's melody voice of the true score, the top head of each event), its harmony (G7a on
the true score), its own arrangement by the same pipeline (the `clean.*` columns: the ceiling). True melody notes are matched to the
heard notes by pitch and time (one to one, 0.2 s), so a note the transcription never heard is charged to the transcription
(`src.melody.heard` 0.984), not to the arranger. Metrics (a case's value is the mean over the levels made): `arr.made`,
`arr.melody.kept / cross / lost / gap_rate`, `arr.harmony.agreement`, `arr.level.distinct / distance`, `arr.lh.notes_per_bar`,
`arr.rh.above_c6`, `arr.hard.violations`, `arr.check.1..7`; definitions in the header of `rec-arrange.js` and in the README.

Suites: `rec-arrange-smoke` (16 smoke references x cover, cover+of x app, v2: 64 cases, about 1.5 min) is in the `bench` gate. `rec-arrange-core` (64 small and
middle-sized core references x cover, plus the 20 real-AMT fixtures of `replay-of`, x app, v2: 168 cases, about 3-5 min), `rec-arrange-full` (all 141 core
references x cover x app, v2: 282 cases, about 8 min, aggregates only) and `mutation-check --rec-arrange` (13 planted defects, about 6 min) run in `nightly-rec`:
the gate is at its 50-minute limit (a first run with core in it was cancelled by the timeout, in `rec-grid`), so the heavier two are nightly. The system under test now includes the arranger's
modules (`pppbench/sut.py` `SUT_TREES`: songgraph, arrangement, candidates, repair, realize, critics, playability, difficulty, with
scoregraph and rec), so an A/B or a mutant carries the arranger a result names; the ruler (the true score's analysis, the checker,
hard violations) is always the repository's own, so a planted defect cannot move its own measure.

### 21.2 Baseline (main `b52b693`, after G10a-1 and G10a-2 hands and grid; `rec-arrange-core`, 84 cases per stage-option row: `cover` on 64 references and the 20 `replay-of` fixtures)

The branch was first measured on `e2c066b` (legacy, app, v2 = G10a-1); S4 (G10a-2 hands) and S3 (G10a-2 grid) then became part of `recording:'v2'`, so the gate's v2 row is now "v2 + S3 + S4"; the earlier v2s are reproduced here with `hands:'legacy'` / `grid:'legacy'`. The legacy and app columns did not move (the `app` rows of the three baselines are byte-identical to those recorded on `e2c066b`).

| metric | legacy | app | v2 (G10a-1: skeleton) | v2 + S4 | v2 + S3 + S4 (= v2 now) | clean (the true score's own arrangement) |
| --- | --- | --- | --- | --- | --- | --- |
| `arr.made` (levels made, of 3) | 0.988 | 0.988 | 0.988 | 0.988 | 0.988 | 0.964 |
| `arr.melody.kept` (true melody notes in the right hand) | 0.942 | 0.942 | 0.943 | 0.965 | 0.975 | 1.000 |
| `arr.melody.cross` (only in the left hand) | 0.0048 | 0.0049 | 0.0047 | 0.0099 | 0.0095 | 0.0001 |
| `arr.melody.lost` | 0.053 | 0.054 | 0.052 | 0.025 | 0.015 | 0.000 |
| `arr.melody.gap_rate` (right hand silent at a melody onset) | 0.0271 | 0.0272 | 0.0232 | 0.0083 | 0.0079 | 0.0000 |
| `arr.harmony.agreement` | 0.560 | 0.571 | 0.691 | 0.750 | 0.755 | 0.864 |
| `arr.level.distinct` (0 = the three levels are one arrangement) | 0.114 | 0.108 | 0.229 | 0.241 | 0.241 | 0.265 |
| `arr.level.distance` | 0.104 | 0.089 | 0.199 | 0.220 | 0.224 | 0.236 |
| `arr.lh.notes_per_bar` | 4.05 | 3.95 | 5.77 | 6.21 | 6.32 | 5.99 |
| `arr.rh.above_c6` | 0.0188 | 0.0189 | 0.0190 | 0.0183 | 0.0179 | 0.0140 |
| `arr.hard.violations` | 0 | 0 | 0 | 0 | 0 | 0 |
| `src.melody.in_lh` (the hand split error, before arranging) | 0.0345 | 0.0345 | 0.0330 | 0.0202 | 0.0185 |  |
| `src.harmony.agreement` (the recording graph itself) | 0.668 | 0.683 | 0.817 | 0.852 | 0.852 |  |
| checker classes per 100 bars 1 / 2 / 3 / 4 / 5 / 6 / 7 | 25.1 / 2.7 / 4.2 / 0.6 / 74.6 / 94.4 / 1.0 | 5.7 / 0.7 / 3.9 / 0.1 / 16.5 / 30.2 / 0 | 0.4 / 0.2 / 1.6 / 0 / 4.3 / 2.1 / 0 | 0.5 / 0.2 / 1.7 / 0 / 4.8 / 2.5 / 0 | 0.2 / 0.3 / 1.7 / 0 / 2.3 / 0 / 0 | 2.8 / 0 / 8.7 / 0 / 9.7 / 45.0 / 0 |

Where the melody gaps are (app row; v2 + S3 + S4 in brackets): methods 0.063 (0.007) (hanon: 0.14-0.58 in six exercises, where the hand split puts the whole texture in
the left staff), hymns 0.007 (0.002), micro pieces 0.001 (0.003), the real-AMT fixtures 0.005 (0.010: S4 leaves more holes than the old hands on those 20, from 0.002
under v2 with the old hands; the grid stage does not change it). The legacy row is not a path the app takes; the gate
suites leave it out (the table is a one-off: `legacy`, `v2` and the middle columns are not suites).

### 21.3 What the baseline says

1. **The levels collapse, as the design said.** On the app's recordings the three levels differ by 0.09 (Jaccard) and
   `arr.level.distinct` is 0.108 (0 = one arrangement, 1 = three different ones); the clean score's own arrangement spreads them 2.6 times as much
   (0.236). v2 doubles the spread (0.199), v2 + S4 reaches 0.220 and v2 + S3 + S4 0.224 (distinct 0.241): its bars, tempo, hands and grid give the planner a real density per section.
2. **The melody gap is real and concentrated.** 2.7 % of the true melody notes the transcription heard meet a silent right hand in
   the arrangement; the hand split put 3.5 % of them in the left staff, and the arranger keeps few of those there (cross 0.5 %: most
   are dropped by the one-note-per-hand thinning, `lost` 5.4 %). A clean score has 0 on all three. **S4 closes most of it under v2**:
   the hand split's error falls to 2.0 % of the heard melody (`src.melody.in_lh`), `lost` to 2.5 % and the melody gap rate to 0.8 % (v2 with the old hands 2.3 %), at the
   price of more notes the arranger keeps in the left hand (`cross` 0.5 -> 1.0 %). The grid (S3) adds `lost` 2.5 -> 1.5 % and `kept` 0.965 -> 0.975, gap rate 0.0079.
3. **Hard violations are 0 everywhere**: the G5 filter, not the recording, decides; the cost of a recording shows as refusals
   (`arr.made` 0.988: micro/M12-flats-db is unreachable in both rows) and as bare arrangements.
4. **v2 helps the arranger more than any arranger change measured so far**: harmony 0.571 -> 0.691 (v2 + S4 0.750, + S3 0.755; the clean 0.864), level distinct
   0.108 -> 0.229 (0.241), checker classes 5 and 6 (bars that do not add up, a drawn value that is not the length) 16.5 / 30.2 -> 4.3 / 2.1 (4.8 / 2.5 with S4; 2.3 / 0 with S3 + S4) per 100 bars.
   Left-hand notes per bar rise (3.95 -> 5.77 -> 6.21 -> 6.32, the clean 5.99): the recording's left hand is written fuller and the arranger keeps it.
5. **The checker classes of an arrangement are not 0** (class 5 and 6, 16.5 and 30.2 per 100 bars on app): the arranger's copy of a
   recording's events has bars that do not add up as drawn; the clean score's own arrangement has them too (9.7 and 45.0), so they
   are the realizer's, not the recording's. Not this phase's to fix; the v2 recording lowers them.

### 21.4 Determinism and sensitivity

- `results.json` of `rec-arrange-smoke` (`8bf5adaa0ecc6cb1`) and `rec-arrange-core` (`42d5f01776536edc`), on main `b52b693`: byte-identical over three
  runs on Windows (Python 3.13.5, Node 24.17); Linux (Docker `node:24-bookworm`, offline, Python 3.11, the README's recipe, an LF clone of the commit): the same two hashes, both `check` PASS.
- `mutation-check --rec-arrange`: 13 planted defects, one per metric (melody dropped, melody written in the left hand, levels collapsed,
  one-note pass off, right hand two octaves up, planner finds no plan, left hand silent, no shortest rest, gaps never closed, rests
  not tidied, dotted 16th rest, exact bars off, a 4:3 bracket), each a REGRESSION naming its metric; the no-op byte-identical.
- 9 unit tests (`tests/bench/unit/test_rec_arrange.py`) and 8 pure-metric tests (`tests/bench/node/rec-arrange.test.js`).

### 21.5 Limits and departures from the design

- Section 9 asks the melody to be "preserved (vs the clean arrangement's melody)". The benchmark measures it against the TRUE melody
  (SongGraph's melody voice of the true score, the top head of each event), which is the clean arrangement's own source: equal for a
  hymn or a method piece with a clear top line, different where the melody is not the top of its voice (a figure over a melody).
- `legacy` is not in the gates (no app path passes it). The stage-option axis is app and v2, as G10a-1 left it.
- Real AMT enters through the 20 `replay-of` fixtures (the production browser model on rendered audio). They are clean: few hand split
  errors (gap rate 0.005 against about 0.03 on `cover`), so they guard against a regression more than they measure the effect. The
  teacher's piece (private) is not in this PR; its aggregates come with the guard.
- `rec-arrange-core` leaves out the 700- to 1,000-note sonatinas and czernys (one arrangement costs up to a minute); `rec-arrange-full`
  has them.

### 21.6 The interim melody guard: not shipped (Lead's decision, 2026-10-03; branch `g10-c0-guard`, PR #152 closed)

The design's G10c-0 asks for an interim guard (section 9: the melody as the cross-staff skyline with a continuity cost, so that a melody note the hand split put in the
left hand stays in the melody). It was built and measured on this benchmark, and **it is not merged**. The branch `g10-c0-guard` keeps the code (`candidates/index.js`
`guardMelody`, gated to transcription provenance and a one-note-per-hand request, `opts.melodyGuard: false` as the rollback; `selection.source` read by
`repairSelection`), its tests (`tests/repair/melody-guard.test.js`), the identity tool (`tests/bench/tools/arrange-identity.js`) and its write-up.

Why not:
1. **It is an interim for a path v2 replaces.** It repairs what the legacy hand split (`assignHands`) gets wrong; S4 (G10a-2 hands) writes v2's hands and takes the melody
   gap rate from 0.0232 to 0.0083 alone. Applied to a v2 source the guard still lowers the gap (0.0083 -> 0.0043) but half of what it moves is not melody
   (detection precision 0.52 on the 141 core references, 0.63 on the 52 hold-out ones; on the legacy split 0.93 / 0.95), so the branch skips v2 sources and is
   inert once `PPP.recording` flips.
2. **It raises notation-check classes 5 and 6 on the app row**, and only a re-recorded baseline hid it: class 5 16.5 -> 18.8 and class 6 30.2 -> 35.8 per 100 bars,
   class 1 5.73 -> 6.34, class 2 0.72 -> 0.91 (`rec-arrange-core`, app row). Every one of those cases is a Hanon exercise: with the true melody in the right hand the
   generated-accompaniment candidates fall to a G5 hard violation and the surviving candidate is the verbatim copy of the recording's own bars, which do not add
   up as drawn (the guard creates none of it; the selection moves). A gate that is green only because its baseline was re-recorded for it is not a gate.

What it bought on the legacy (app) path, for the record (main `afdb23b`, `rec-arrange-core`, app row, 84 cases): melody gap rate 0.0272 -> 0.0124, kept 0.9415 -> 0.9557,
lost 0.0536 -> 0.0402, cross 0.0049 -> 0.0040, right-hand attacks that are no melody note 0.0550 -> 0.0555, hard violations 0 -> 0, levels and harmony unchanged;
the full suite (141 references): gap rate 0.0213 -> 0.0109. Identity: 975 of 975 catalogue requests identical to a clean `git archive` of main (933 results, 42
refusals). On the Lead's private 90-bar piece (aggregates): 8 notes moved, rests that hold a left-staff note at or above C4 17 -> 14, hard violations 0. Recall
0.47 (0.27 on the hold-out): a melody that lives wholly in the lower staff (Hanon) is not found.

**Revisit only if v2's flip is delayed** (G10a-4/5): then the legacy path keeps its hand-split holes for longer, and the branch is ready to rebase; the checker-class
cost on the Hanon exercises would have to be fixed or accepted explicitly, not re-baselined. The benchmark here is what measures it: run
`rec-arrange-core` against the branch and read the app row.

## 22. G10a-3 (lane B), S8: key, spelling and printed accidentals (2026-10-04; implementer on Sonnet, code only: no model)

Worktree `D:/PPP-g10a3keys`, branch `g10-a3-keys` from `origin/main` `074f078`. Lane B of G10a-3 (the silence classifier, voices and the writer are lane A's, `D:/PPP-g10a3writer`). Measurement first; the stage is `rec/key.js`, its hook in `audio-score.js` is its own commit (`opts.keys`, behind `recording: 'v2'`), legacy lines untouched.

### 22.1 Baselines reproduced
At `074f078`, unchanged tree: `run` + `check` of rec-smoke, rec-core, rec-robust and replay-of-v2 all PASS. rec-core v2 rows (beats none / oracle-noisy): `critical.key` 0.899 / 0.911, `notation.spelling.accuracy` 0.9972 / 0.9972, `critical.accidentals` 0.991 / 0.989 (app: 0.957 / 0.957; legacy 1.000).

### 22.2 Error analysis (by cause)

**Key signature** (`python tests/bench/tools/key_data.py` + `node rec/tools/key-eval.js`: the stage alone on the catalogue's truth notes; 311 trusted references, 259 tuning and 52 hold-out). The legacy estimator (`estimateKey`: Krumhansl-Kessler correlation + 1.8 x diatonic fit on heard durations x velocity) is right on the first signature for 0.888 of the tuning and 0.904 of the hold-out references: **hymns 100 %, method books 0.82**. The 34 misses are (a) **a fifth too sharp**, 32 of them (one is a fifth too flat, one Czerny 849/027): Beyer's early exercises and two Czerny studies lie on G A B D (the right hand in G position) in a C-major signature - the notes hold exactly the same pitch classes in C major and G major (no F, no F sharp), the tonic evidence says G, the book's convention says C; (b) a modal hymn (`what-child-is-this`, E Dorian in two sharps); (c) pieces whose first bars are in a neighbouring key or whose notes contradict their signature (Burgmueller 015, 023; Czerny 849/026, 027: 027 is a chromatic study).
**Release times** decide part of the legacy estimate: the cover family's notes overlap the next onset (70 %, the pedal's mechanism), so the legacy key moves with the articulation profile (rec-core legacy `critical.key` 0.879 for cover, 0.922 for cover-pedal on the very same pieces); the stage's evidence is onsets (G10-D4).
**Spelling** with the TRUE signature and the legacy table: 0.9948 (413 wrong of 79,818 notes); 147 of them in one chromatic study (Czerny 849/027, G sharp written A flat); in C major G sharp for A flat 102, C sharp for D flat 63, E flat for D sharp 40. On the chromatic notes of a piece (not in the signature) the table is right 85 % of the time in every melodic context. **Voice leading was measured and not used**: a chromatic passing note upward written sharp is right 0.874 against the table's 0.843 (286 notes); downward 0.403 (the table 0.893), a lower neighbour 0.10 (0.862): the catalogue writes descending chromatic notes with sharps as often as with flats. A line-of-fifths speller (each chromatic note spelled nearest the local centre of the line of fifths, windows of 1-8 beats, with the table as prior) is neutral on the 259 tuning pieces (0.99683 -> 0.9964-0.99683) and gains on the hold-out only through one piece (Czerny 849/027, 147 -> 59 wrong): not kept.
**Printed accidentals, the "untraced" E2 cause, found.** `buildGraph`'s `writeStaff` marks a head that a tie comes INTO as "in force" (`accState[k] = sp.alter` after `!tieStop` guards only the printing). The benchmark's rule (G03 section 10.3, MusicXML's) is that a tied-over head neither needs an accidental nor changes what is in force, so the next head of the same step and octave in that bar needs its own, and the writer printed none: `critical.accidentals` failed in 24 of 564 rec-core app cases (beats none) and 5 of 564 v2 cases (sonatina/012: a B flat tied over the bar line, a B flat again on beat 3). It needs a tie over a bar line with an accidental, which the app's writer makes where a note ends at the bar line and the next onset of its hand follows within an eighth (DURATIONS FROM ONSETS lengthens it across the line): common in the exact-bars path, rare in the library default (legacy: 0 failures). It is not about S4: a note that moves hand changes which ties it has.

### 22.3 What was built
`rec/key.js` (UMD, pure, deterministic; no model, no weights file: the constants were fitted on the tuning references only and are in `W`):
- **First key**: the 24 keys by correlation + 4 x diatonic fit, on durations to the next onset of the same staff (capped at two quarters), plus 0.25 / 0.1 / 0.1 for a piece that starts / ends on the tonic in the bass and ends with the tonic in its last chord, minus 0.08 per sharp or flat of the signature (the prior for a simple signature: a tie is the signature with fewer accidentals).
- **Tonal regions**: windows of 8 bars, hop 4, scored like the first key (no cues), a Viterbi with a free start (G03 section 10.2's idea: a change costs 1.5 plus 0.5 a fifth, a key lasts 4 bars at least); every bar has a region key; notes are spelled from their region's table (the legacy table: the signature's diatonic notes, each other pitch class in the direction the mode prefers).
- **Written key changes**: only for a region of 8 bars or more, two or more fifths from the signature in force, whose signature saves at least 8 accidentals and 6 % of its notes; region 0 is tested too (a piece that opens in its minor and ends in the major is written in the key it opens in). Closer keys are written with accidentals.
- **Printed accidentals** (`accidentals()`): the rule above.
Hook (`audio-score.js`, own commit): `writeKeys()` after S3/S4 and the exact-bars writer rule (final ticks and staves), per-note spelling `n.sp`, per-bar signature, `Object.assign(state, ...)` after the legacy `state` line, a v2 branch at the top of the head writer; the legacy lines of `buildGraph` are byte-identical (the planted-defect strings of `mutation.py` need no change). `opts.keys`: `'legacy'` keeps `estimateKey`/`spellingTable` under v2; `'v2'` swaps only S8 on any path (the app's path in the `rec-keys` suite). Not exposed through `rec/index.js` (lane A edits it): `audio-score.js` loads `rec/key.js` itself, like `rec/grid.js`; the page must load `rec/key.js` (G10a-4).

### 22.4 Results

Stage alone (`rec/tools/key-v1.evaluation.json`: truth notes, the exact bars, staves and durations of the score; legacy -> S8):

| set | references | first signature right | spelling (notes) | written key changes |
| --- | --- | --- | --- | --- |
| tuning (the constants were fitted here) | 259 | 0.888 -> **0.923** | 0.9966 -> 0.9966 | 1 piece, a true one (Burgmueller 015, below) |
| hold-out (never used to choose a constant) | 52 | 0.904 -> **0.942** | 0.9958 -> 0.9958 | none, none spurious |

Gained 15 pieces, lost 4 (hymns/what-child-is-this, beyer/032, burgmueller25/015 and 023: the legacy estimate had them right) over the 311 references. The regions do not move the spelling (0.9967 without them, 0.9966 with, on the tuning set): the catalogue modulates inside its signature and the key table already spells those notes. **The one piece with a key signature change in 312** (Burgmueller 015: three flats, none at bar 22, three flats again at bar 48) is found with the changes at bars 20 and 44 and the opening in two flats, one fifth off (G minor against the signature's E flat): the structure is right, its first key is not.

End to end, the benchmark's performances (v2 rows; `perform_as` keeps every pair on the very same performance; before = `origin/main` `074f078`):

| suite, beats | n | critical.key | critical.accidentals | spelling accuracy | usable (G0) |
| --- | --- | --- | --- | --- | --- |
| rec-core, none | 564 | 0.899 -> **0.945** | 0.991 -> **1.000** | 0.9972 -> 0.9974 | 0.156 -> 0.158 |
| rec-core, oracle-noisy | 282 | 0.911 -> **0.950** | 0.989 -> **1.000** | 0.9972 -> 0.9974 | 0.262 -> 0.270 |
| rec-robust (cover-alt), none / oracle-noisy | 141 / 141 | 0.908 -> 0.943 / 0.901 -> 0.957 | 0.993 -> 1.000 / 0.986 -> 1.000 | 0.9971 -> 0.9974 | 0.114 -> 0.114 / 0.241 -> 0.248 |
| rec-smoke, none | 48 | 0.958 -> 1.000 | 1.000 -> 1.000 | 0.9999 -> 0.9999 | 0.313 -> 0.313 |
| **hold-out slice** (rec-full's v2 rows on the 52 hold-out references, seeds 11 and 12) | 624 | 0.896 -> **0.941** | 0.978 -> **1.000** | 0.9972 -> 0.9970 | 0.181 -> 0.196 |
| replay-of-v2 (the browser's O&F on rendered audio) | 20 | 0.900 -> 0.900 | 1.000 -> 1.000 | 0.99955 -> 0.99955 | 0.30 -> 0.30 |

Case by case on rec-core's v2 rows (846): `critical.key` 57 cases up, 20 down (five pieces: what-child-is-this, beyer/032, burgmueller25/015 and 023, czerny849/013); `critical.accidentals` 8 up, 0 down; spelling 16 up, 12 down (mean +0.0002); G0 usable 7 up, 4 down (the four are the key losses). By book (v2, rec-core): sonatina 0.738 -> 1.000, Czerny 599 0.854 -> 0.990, Czerny 849 0.783 -> 0.933, micro 0.972 -> 1.000; **hymns 0.992 -> 0.975 (the one modal hymn)**, Burgmueller 0.889 -> 0.815, Beyer 0.781 -> 0.750. The key is now the same for every humanizer profile of one piece (rec-core v2: cover, cover-pedal, human-real 0.943 each; the legacy estimate moved with the articulation: 0.879 for cover, 0.922 for cover-pedal) because the evidence is onsets.

**S8 alone on the app's path** (`rec-keys`, `app-keys`: the app's options with only the key stage; the rec-core / rec-robust app rows are the other arm): critical.key 0.901 -> 0.940 (none), 0.910 -> 0.943 (oracle-noisy); **critical.accidentals 0.959 -> 1.000 and 0.955 -> 1.000**; spelling 0.9972 -> 0.9973. With v2 and without S8 (`v2-keylegacy`) the accidentals are 0.992 / 0.988: the tie defect is the writer's, not v2's. Budget: 5 ms for a 1,800-note piece (150 bars) in Node.

### 22.5 Tried and kept out

- A line-of-fifths speller and a direction rule for chromatic passing notes (22.2): no gain on the catalogue.
- Catalogue-counted scale-degree profiles (naive Bayes on 12 signatures, with the bass and the first and last bass notes): 0.934 on the tuning set, 0.931 leave-one-out, 0.942 on the hold-out - the same as the tuned Krumhansl-Kessler form, with tables to commit; the ceiling is the pieces whose pitch classes do not decide (22 pieces).
- The last bass as the lowest note of the last beat, two beats or a bar instead of the last onset: 0.911-0.915 against 0.923 on the tuning set.
- A stronger signature prior (0.12-0.2 a fifth): the simpler signature wins the G-position exercises but loses sonatinas and Czerny: 0.919 / 0.907 against 0.931.
- The first key taken from the whole piece's histogram, with the Viterbi started in it: a piece that opens in another key than its best overall (Burgmueller 015) could not be written in the key it opens in; the free start and the region 0 test fix that.

### 22.6 Verification

- **Legacy byte-identical.** `run.py ab --a git:origin/main --b worktree` and `ab_identical.py`: smoke 44, core 553, robust 282, smoke-app 44, core-app 553, robust-app 282, replay-public 6, replay-of 20, replay-of-app 20 cases, every one the same (status, metrics, semantic projection); the legacy and app rows of rec-core (846 + 846) are identical case by case, the 98 cases that change are all `opts:v2` rows; `golden` 17/17 identical, `sg-roundtrip` and `correctness` unchanged; `git diff --stat origin/main` touches none of `scoregraph/ songgraph/ arrangement/ candidates/ repair/ realize/ critics/ playability/ difficulty/`, so the 975 `arrangeSingleNote` requests (the catalogue's graphs, not recordings') are unchanged by construction; the planted-defect strings of `mutation.py` for the legacy writer need no change (the three lines they edit in `buildGraph` are byte-identical).
- **Rebaselined, with the reason recorded in each file:** rec-smoke, rec-core, rec-robust, rec-grid, rec-arrange-smoke (v2 rows only; rec-arrange-smoke's cases are identical, its aggregates carry the new reason). Before it, the checks of the suites failed only on `critical.key` (20 cases, one tag) and the usable flips that follow from them.
- **Tests:** `tests/rec/key.test.js` (12: the table is audio-score.js's own for all 24 keys, the keys, release times are not values, the prior, the cues of the ends, a modulation with its written changes and flats, a short excursion and a dominant region not written, windows, regions cover every bar, the accidentals rule, degenerate input, determinism and budget) and `tests/rec/key-v2.test.js` (6: the stage, `opts.keys 'legacy'`, the library default and the app's options never see it, a modulation through `toMusicXml`, the tied-over accidental, spelling).
- **Mutation coverage.** `mutation-check --rec` has a new group on a new suite, `rec-mutation-keys` (88 references, v2 rows of cover, cover-pedal, cover+of and helper-like beats: the tied-over defect needs those families, which `rec-mutation`'s two rows do not have): four planted defects, each a REGRESSION naming its metric (S8 not used: critical.key 0.9375 -> 0.9148, critical.accidentals 1.0000 -> 0.9915; no diatonic fit: critical.key -> 0.9290; the table's flats as sharps: spelling accuracy; the tied-over accidental state: critical.accidentals 1.0000 -> 0.9886), the no-op byte-identical; the existing v2 group (15 defects) is unchanged and still caught; the regions, the written changes, the cues of the ends and the prior are planted through the stage's weights in `tests/rec/key.test.js`.
- **Determinism and Linux:** see 22.8.

### 22.7 Limits, and what the next phases need

- **The first-signature ceiling on this corpus is about 0.94.** The misses are decided by convention (the C-position exercises), by modal hymns and by pieces whose notes contradict their signature; none is a bug of the estimator. The hymns lose one piece (E Dorian in two sharps) to the prior and the cues of the ends: a modal hymn is where the legacy estimate happened to be right.
- **The catalogue cannot measure regional keys**: one piece in 312 changes signature. The mechanism is tested on constructed modulations (`tests/rec/key.test.js`, `key-v2.test.js`) and on that piece; real covers modulate, and the Lead's private tier (G10-D15) is where its false change rate shows. The policy is conservative on purpose (8 bars, two fifths, 8 accidentals and 6 % of the region's notes saved); closer keys are always written with accidentals.
- **The accidentals defect is in the legacy writer too**: 24 of 564 rec-core app cases (4.3 %) print too few accidentals today, on the production path. The fix is in the v2 branch of the head writer only, as briefed (legacy untouched); `opts.keys: 'v2'` turns it on for the app's path (`app-keys`: 1.000) if the Lead wants the production path fixed before G10a-4.
- **For G10a-4:** the page must load `rec/key.js` (it registers `window.PPPRecKey`); the key stage reads the quantized notes after S3/S4 and the exact-bars run rule, and writes `result.keyReport` (the key, its regions and the changes) and `graph.provenance.sources[0].params.keys` beside the graph. `rec/index.js` is not touched (lane A edits it): `audio-score.js` loads `rec/key.js` itself, as it loads `rec/grid.js`.
- **For lane A:** the hook sits between the exact-bars writer rule and `staffEvents`; heads carry `n.sp` (the spelling) and a voice-aware writer must keep calling `accidentals()` per staff and bar in the order the notes are written (a second voice of one staff shares the bar's state).
