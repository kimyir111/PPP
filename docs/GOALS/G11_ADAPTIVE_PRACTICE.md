# G11 — Adaptive practice and arrangement

## 0. Status

Architect 2026-10-08 (on Opus), worktree `D:/PPP-g11d`, branch `g11-design` from `origin/main` `3567e27`
(= production). Design only: no code, baseline or app-file change in this commit. Roadmap card:
`docs/PPP_MASTER_ROADMAP.md` §5.9 (G11), TD1 and TD12 (§13), issue 16 (§4), AI-6 (§12), D-5 (§18).

**One-paragraph summary.** PPP already has a complete, working practice loop, written before the ScoreGraph
existed: a legacy player (`PianoScore`), a matcher (`PerformanceEngine`), a per-measure learner summary
(`Learning`), a memory trainer with spaced review (`Memory`) and a guarded plan maker (`Coach`), all reading
the legacy Score and keyed by measure *numbers*. Measured on the 325 catalogue pieces, the legacy play order
already equals the graph's `time.unroll` on 325 of 325 files, the matcher answers in ≤ 0.2 ms (p95, 4× CPU)
and the player builds a 1,776-note plan in 7 ms. So G11a is not a rescue of a broken player: it is an
adapter that makes the same plan from the graph, with ids, proven event-for-event against the legacy one,
and that fixes four measured places where the legacy player is wrong (D.C./Fine, grace notes, follow mode
skipping repeats, follow mode skipping dangling ties) only behind a switch and only on the user's word.
The real gaps are in the *evidence*: runs played without a keyboard are random simulations that are folded
into the learner history as if measured; nothing of a login-free user's practice ever leaves the device; no
practice test runs in CI. G11b therefore starts by making the evidence honest and exportable, builds a
transparent learner model and policy (spaced review of weak passages, tempo ramps, hands separately) that is
validated on synthetic learners first and on the user's own week of practice (H-11) second. G11c lets a
teacher ask for an easier or harder version of one passage, using the existing one-note arranger and the
recording lead sheet as generators and a new, verified measure-aligned splice.

## 1. What was measured before designing (evidence)

All numbers were measured for this document at `3567e27` in an independent server of this worktree
(`tests/serve-free.js`, headless Chrome, CPU throttling through CDP). Scripts and raw output are in the
Lead's scratchpad `scratchpad/g11-design/` (`measure.js`, `measure2.js`, `measure3.js`, `scan.py`,
`m1.json`, `m2.json`). "App N" means line N of `Piano Coach App.dc.html` at `3567e27`.

| # | Finding | Numbers |
| --- | --- | --- |
| E1 | **The practice code is old, self-contained and read through the legacy Score everywhere.** `PianoScore` (App 2984-3346), `scoreToVisualTimeline` (falling notes, 3409), `PerformanceEngine` (5957-6204), `Learning` (6221-6694), `Memory` (6725-7147), `Coach` (8894-9432), follow mode and the transport (13560-14400). About 2,900 of the file's 20,529 lines (1,215,763 bytes). The comments say these engines know nothing of React or the DOM. | Reads of the legacy Score for practice: `PianoScore.of` 9 call sites (38 `PianoScore.*` references), `Score.notesIn` 10, `Score.form` 1, `Score.allIn` 1 (follow), `Fingering.plan` 4, `Learning.*` 31, `Memory.*` 37, `Coach.*` 22, `S.score` 99. Nothing in practice reads the graph; the graph is resolved only by the renderer, difficulty, the arrangers and "Play as recorded" (`PPPEngrave.app.resolve/resolveSync`, App 15546, 15629, 16601, 17980) |
| E2 | **The legacy play order is the graph's play order.** `time.unroll` (G1) was written to the app's rule, quirks included. Compared on every catalogue file, whole piece, as measure numbers. | `Score.form` = `time.unroll` on **325 / 325** files (100,271 notes, 148,643 struck notes after repeats). `legacy.link` ok on 325 / 325. 168 files have backward repeats, 16 have voltas |
| E3 | **Where the legacy player is wrong (measured on the catalogue).** (a) D.C./D.S./Fine/Coda are never followed (`Score.form` comment, App 4093; `unroll` "Jumps are not followed in G1"). (b) Grace notes are dropped by `toScore`, so never played, judged or lit (issue 16). (c) Follow mode builds its gates from `Score.allIn` in written order (App 13617): a repeated passage is asked **once**, while the clock and the falling notes play it twice. (d) Follow mode skips every `tieStop` note (App 13628), while the clock strikes a tie "that leads nowhere" (`PianoScore.struck`, App 3024): the two modes ask for different notes. | (a) 8 files carry `fine` + `dacapo` jumps in the graph (Burgmüller 2, Czerny 599 3, Sonatina 3); segno/coda/to-coda: 0 in the catalogue. (b) **244 grace events in 17 files** (Sonatina 13). (c) 168 files. (d) **20 notes in 6 files** |
| E4 | **Legacy quirks that are arguably right and are kept.** (a) A loop's backward repeat with no forward repeat inside the loop goes back to the *loop start* (`Score.form` uses `i0`), so a 4-bar loop ending on a repeat sign is played twice per lap. (b) The metronome counts 6/4 as six beats (`PianoScore.beats`), the graph's metre helpers count it compound (G01 §6.4). (c) A pedal span is computed in written quarters and copied into every visit. | (a) 162 of the 168 repeat files have such a 4-bar loop |
| E5 | **The matcher is fast and simple.** `PerformanceEngine.begin` snapshots every struck note of the run as `expected[i]` (`id: i`, the index in the strike list, App 5999) with a wall-clock target; `noteOn` scans the whole list for the nearest unmatched same-pitch note within ±250 ms (`TIMING_DEFAULTS` perfect 55, good 130, window 250, roll 180 ms, App 5957). Per-note verdicts live only until the next `begin`; `result()` keeps per-measure and per-hand counts. | 1,776-note Sonatina (G06's timing piece): `begin` 8 ms (1×) / 30 ms (4×); `noteOn`+`advanceTo` p95 0.1 / 0.2 ms, max 0.3 / 1.7 ms; a wrong key p95 0.2 ms. Through the app's MIDI handler in a live clock run (86 notes pressed by a fake keyboard): p95 0.1 / 0.4 ms. **Press → painted frame** (two `requestAnimationFrame`s) at 4×: median 31 ms, p95 55 ms, max 64 ms (54 presses) |
| E6 | **Building plans is cheap; linking is the cost, and the renderer already pays it.** | Same piece, 1× / 4×: MusicXML import 76 / 353 ms; `toScore`+`finalize` 7 / 44; `legacy.link` 15 / 81; `legacy.agree` 19 / 99; `PianoScore.build` (whole piece) 7 / 35; `time.unroll` < 0.1 / 0.2; `time.tempoMap` 0.1 / 1.0 |
| E7 | **Long tasks.** The card's gate "no long task over 50 ms" is already violated by the practice screen's *entry*, which belongs to the engraver (G4 B5, deferred), not to practice code. During play the practice code is under budget. | Practice entry with the 1,776-note piece: long tasks 132 and 201 ms (1×); 575, 841 and 208 ms (4×). The G4 record (G04, line 5032) has 9-11 entry long tasks up to ~523 ms at 4×. During 9 s of a live clock run: none at 1×; one of 86 ms at 4× |
| E8 | **The learner history is per measure *number*, per song, small and lossy.** `Learning.record` folds a run into `byMeasure[number]` running totals (expected/matched/missed/wrong/extra, on-time/early/late, |Δt| sum, per hand r/l, tempo buckets 50/75/100 %, last 10 run summaries) plus the last 40 whole-run summaries. It keeps no per-note data and no signed timing. Sections for memory work are `Score.deriveSections`' fixed 8-bar chunks `s1..sn` (App 4039), unrelated to G7a's sections. | Fully practised (≥ 10 runs per bar): **≈ 1.1 KB per measure**; 158-bar piece 184 KB, 32-bar hymn 43 KB (the packed score of the same songs: 247 KB and 58 KB) |
| E9 | **Runs without a keyboard are simulated and counted as evidence.** With no Web MIDI input ("Demo Input"), Play draws hits with `Math.random()` from the section's displayed accuracy (`rollHit`, App 14277) and `completeLap` folds that simulated result into `Learning.record` (App 14329-14335). `runs[]` keeps a `simulated` flag; **`byMeasure` does not**. | Every Play without a keyboard writes invented per-measure accuracy and timing into the same totals that weakness, recommendations, memory eligibility and the Coach context read. iPhone/iPad Safari has no Web MIDI: on those devices every practice run is simulated |
| E10 | **Login-free practice never leaves the device.** History and memory live in the song's slot `ppp.song.v1.<id>` and, for the open song only, in `ppp.state.v2` (App 12717-12753, 16255-16274). `/api/progress` (server.js 1147-1161, table `ppp_progress`) answers 401 to a guest and, for a signed-in user, stores only `ppp.state.v2`, i.e. **the open song's** history; other songs' progress and the songs themselves are never synced (TD3). Two login-free server patterns exist: the guest key for shares (`GuestKey`, App 12312; owner `g_`+sha256) and the PC link code (`PcLink`, App 12352, G10b-2). | By reading (not reproduced): `restore()` applies a pulled `history` to whatever score is open when the pulled song's slot is absent on this device (App 12781 vs 12791-12800), so a second device can show song A's measure stats on song B |
| E11 | **Three recommenders overlap.** `Learning.recommend` (weak range → hand / timing / tempo-up / both, at 50/75/100 %), `Memory.nextTask` (a due memory review beats a mild weakness; a severe one beats a review), `Coach.deterministicPlan` (tasks from the same numbers); plus `Learning.practiceSequence` and the section "acc" moved by a 0.35 EMA in `completeLap`. Spaced repetition exists only for memorised sections (`MEMORY.reviewDays` 1, 3, 7, 14, 30 days), not for weak passages. | – |
| E12 | **The LLM coach is guarded, optional and probably off in production.** `Coach.context` sends summaries only (no MIDI, < 60 KB, `tests/coach.test.js`); `Coach.validate` repairs or drops any task with an unknown measure, hand or mode, a memory task the deterministic gate has not unlocked, tempo outside 30-120 %, repetitions outside 1-8, or a percentage PPP never measured; any failure falls back to the deterministic plan. The model runs in the helper (`omr-service.js` `/coach`, Claude `PPP_COACH_MODEL` default `claude-opus-5`, or Ollama). | `render.yaml` sets no `ANTHROPIC_API_KEY`; the G9e records say production answers `/helper` with 503. Production AI-coach availability: **unverified** (no production access) |
| E13 | **Graph ids are not a stable key across devices or paths.** The renderer's graph comes from the producer (`live`), the per-device store (`store`) or a projection of the Score (`projected`, new ids); projected graphs are never stored; graphs are per-device IndexedDB only (TD3). The measure *index* in written order is the same on every path (Score measures and graph measures are 1:1). The realizer (`realize/index.js` 590-607) builds a new graph with one new measure per source measure (same `number` and `dur`), so an arrangement shares the source's measure index but not its ids. | "Write the notation again" (`adoptScore`, App 15470-15480) starts the history over (Undo restores it); an arrangement copy is a new song with an empty history |
| E14 | **Passage-level arranging does not exist.** `arrangeSingleNote` (App 5056) always plans `sections: 'all'`, caches 6 results by (fingerprint, level), runs 0.2-4 s; the recording lead sheet (`rec/leadsheet.js`, G10 §33) keeps the recording's measure ids. The G9 record (G09, line 1843): 63 of 109 newly arranged pieces are byte-identical at all three levels; output is about 0.5 level easier than asked. G6's assessment has a per-measure, per-hand hotspot map (`difficulty/`, G06). | An "easier version of bars 17-20" will often be *identical* to what the user already has |
| E15 | **No practice test runs in CI.** 11 practice/playback browser suites (follow 37 checks, falling-notes 25, memory 35, learning 33, playback-scheduler 8, coach ~47, midi 73, interactions ~35, lessons ~126, course 46, alignment 10) run only by hand against port 8777; `bench.yml` installs no puppeteer for them. Nothing measures matcher latency or long tasks. Reusable spies for an event harness exist: the fake piano of `playback-scheduler.test.js` (strike/release times) and the fake MIDI output of `midi.test.js` (note on/off **and CC64/67** with timestamps). | – |

## 2. The roadmap card, checked

| # | Card statement (§5.9) | Verdict | Evidence |
| --- | --- | --- | --- |
| 1 | "G11a is S5-play: a PlaybackPlan from `time.js` (repeats by the app's rule plus D.S., D.C. and Fine, the tempo map, pedal including change, ottava, grace notes)" | **Confirmed, with scope** | `time.js` has `unroll` and `tempoMap` but no jumps, pedal, ottava, graces, ties, dynamics or range-restricted unrolling. The PlaybackPlan is a new module on top of it (§6.1). The graph already carries everything needed (`timeline.jumps`, `Grace`, pedal spanners with `changes`, ottava spanners, ties by head id) |
| 2 | "The practice matcher keyed by graph IDs through `link`" | **Confirmed for a run, wrong as a storage key** | Within one run, every expected note can carry its event and head id (`engrave/source.js` `identity`). For the stored learner history, graph ids change with the path and device (E13); the key must be (song, music hash, measure index) with ids as detail (G11-D4) |
| 3 | "Parity with the legacy player (identical events where the legacy player was right, and a documented list where it was wrong)" | **Confirmed and sized** | E2-E4: four wrong behaviours, three kept quirks, all counted on the catalogue; §6.2 is the harness |
| 4 | "No long task over 50 ms; matcher latency unchanged" | **Re-scoped** | Entry long tasks already reach 132-841 ms from the engraver (E7). The gate becomes: no long task over 50 ms *during play* at 1×, no new long task at entry, matcher and press-to-paint within the budgets of §11 |
| 5 | "G11b: per-note and per-measure error and timing statistics keyed by graph and SongGraph IDs (extending `Learning`/`Memory`)" | **Partly wrong** | No per-note data is kept today (E5, E8); the measured evidence is contaminated by simulated runs (E9). Before any model: honest evidence (G11b-1) |
| 6 | "Recommendations replace the Coach heuristics where they measurably do better" | **Confirmed** | Three overlapping recommenders (E11); "measurably" needs a simulator (G11b-0) and the user's logged week (H-11) |
| 7 | "Adaptive arrangement asks G9 for a variant at level ± 1 for a section and splices it in with continuity" | **Confirmed in principle, refusal is frequent** | No passage API, no splice (E14); an easier variant is often identical. Generate the whole piece at the other level (cached) and splice by measure index with seam checks (§8) |
| 8 | "H-11: the user practises 2-3 pieces for about a week" | **Confirmed, with a precondition** | Only runs with a MIDI keyboard on a browser with Web MIDI are evidence (E9). If the user practises on an iPhone/iPad or without a keyboard, H-11 produces no data (§10, U1) |

## 3. Goal and non-goals

**G11a — practice on the graph.** The player, the matcher, follow mode and the falling notes play and
judge a PlaybackPlan made from the ScoreGraph, with ids, identical to the legacy plan wherever the legacy
plan is right; D.C./D.S./Fine/Coda and grace notes become audible (and the repeated bars are asked in follow
mode) only when the user agrees. Behind `PPP.practice = 'legacy' | 'graph'`.

**G11b — honest evidence, a learner model, adaptation.** Every run is recorded as what it was (measured,
followed, memory recall, simulated); a bounded run log can be exported; a transparent model estimates, per
measure and hand, accuracy, timing and the tempo at which a passage is clean; a policy proposes the next
task (spaced review of weak passages, tempo ramps, hands separately, memory work) in the existing plan
schema, so `Coach.validate` stays the only door. Behind `PPP.learner = 'legacy' | 'adaptive'`.

**G11c — adaptive arrangement of a passage.** "Make bars 17-20 easier (or as written)": the deterministic
arrangers produce the variant, a verified splice puts it into a copy, and the app refuses honestly when the
variant is not easier. Behind `PPP.variant = 'off' | 'on'`.

**Non-goals.** No new input path (no microphone judging; Web MIDI only). No accounts, payments or teacher
dashboard for many students. No ML learner model before the data supports it (AI-6, G11-D7). The LLM coach
never writes notes and never bypasses `Coach.validate`. No change to engraving, to the arrangers' internals
or to the recording conversion. No humanized playback of a printed score. No removal of `PianoScore` or of
the legacy Score (S8 → G13). The Piano Basics lessons keep their own rhythm matcher (`lessons.js`).

## 4. What already exists — reuse, do not rebuild

- **The plan shape the whole transport speaks**: `PianoScore.build` → `{visits, strikes [{midi, vel, q, upQ,
  hand, m, abs, note, visit}], ccs, beats, tempoMap, pedal, soundLengthQ}` with `msAt`/`qAt`/`soundAtWritten`/
  `writtenAtSound`. The scheduler (`schedule`, App 14152), the matcher, the falling notes and the simulator all
  read this shape. G11a produces the same shape (G11-D1), so none of them changes.
- **`time.js`**: `unroll` (= the legacy rule, E2), `tempoMap`, `playbackPosAt`, `seconds`, `resolveSpan`/`spanOf`.
- **`engrave/source.js` `identity(score, source, plan)`**: per graph event, the Score notes, onset keys, MIDI
  values (sounding), hands; per Score note its event. The renderer already resolves `source` for every
  practice view; `link` is ok on 325/325 catalogue files.
- **`engrave/practice.js`**: practice map, `locate(q)`, highlighter (B6: ≤ 6 elements per frame, p95 0.5 ms at 4×).
- **MX-1's corrected semantics** in `PianoScore`: sounding pitch (D-1), pedal `change` lifts (CC64 0→127),
  half pedal by depth; the test fixtures E17 (pedal change) and E18 (ottava).
- **`Learning`/`Memory`/`Coach`**: thresholds (strong 0.90, weak 0.75, hand gap 0.12, timing 90/180 ms), the
  memory ladder (5 levels, hide plans, hints, review 1-3-7-14-30 days), `Coach.validate` and its tests.
- **G6** per-measure difficulty features and hotspots (`PPPDifficulty.assess`, behind `PPP.difficulty`), the
  only prior for a measure nobody has played.
- **G9/G10c generators**: `arrangeSingleNote(graph, {level, recordingArrange})`, the lead sheet
  `PPPRecLeadsheet.prepare`, `candidates`, `repair`, `realize/clefs` and `ottava`, `scoregraph/validate.js`,
  `scoregraph/tools/notation-check.js` (classes 1-7), G5 `playability/analyze.js` (hard violations per event).
- **Login-free server patterns**: guest key (`share-guest.js`, GS-1..3), PC link code (G10b-2).
- **Test spies**: fake piano (`playback-scheduler.test.js` 50-62, 138-158), fake MIDI output with CC
  (`midi.test.js` 16-57, 659-683), fake MIDI input (`follow.test.js` 27-50), `tests/serve-free.js`,
  `tests/engrave/tools/with-port.js`.

## 5. Decisions

| ID | Decision | Rejected alternatives | Evidence |
| --- | --- | --- | --- |
| **G11-D1** | **The PlaybackPlan is an adapter, not a new player.** A pure UMD module `practice/plan.js` (Node + browser) makes, from a graph, the *same shape* `PianoScore.build` returns, plus `ev`/`head` ids on every strike and measure ids on every visit. The scheduler, the matcher, the falling notes and the simulator are not rewritten. | A scheduler on exact graph time (rational µs) — a second transport and the largest blast radius; extending `PianoScore` to read graph fields — keeps the legacy Score as the source of truth | E1, E5, E6 |
| **G11-D2** | **Parity is proven event by event in the page**, over the catalogue, the engraving fixtures and new jump/grace fixtures, with a cause-coded allow-list; the module's `legacyCompat: true` mode must reproduce the legacy plan exactly on 100 % of files and ranges. | Moving `PianoScore` out of the app file so Node can run it (an app-file refactor with no user value, before the harness exists); re-implementing the legacy player in Node as an oracle (two copies to keep equal) | E2, E15 |
| **G11-D3** | **The legacy-wrong list** (fixed under `'graph'` only, each behind its own option, defaults decided by the user, U2/U3): `JUMP` (D.C./D.S./Fine/Coda followed, once, as engravers read them: no repeats on the return, by default), `GRACE` (graces sound; not judged until a later measured change), `FOLLOW_REPEAT` (follow asks repeated bars as often as the clock plays them), `FOLLOW_TIE` (follow asks exactly the notes the clock strikes). **Kept quirks** (parity): the loop-start repeat target, the 6/4 metronome, per-visit pedal copy, a tie that leads nowhere strikes. | Fixing everything at once (users would hear several changes at the same time and could not tell which one they dislike) | E3, E4 |
| **G11-D4** | **Learner evidence is keyed by (song id, music hash, measure index)**; the measure id, measure number and, inside one hash, event ids are recorded as detail. A hash change (rewrite, edit, re-import) starts a new evidence epoch; the old epoch is kept read-only and can be mapped by measure index when the measure count is unchanged. | Graph ids alone (change with path and device, E13); measure numbers alone (pickups and repeated numbers; numbers can be non-contiguous, `Score.snap`) | E8, E13 |
| **G11-D5** | **Evidence is typed.** Every run records `source: 'measured' | 'follow' | 'memory' | 'simulated'`; `simulated` never enters the model's evidence; `follow` never counts for timing or tempo (today's rule). Demo Input keeps a separate display state so the screen still moves without a keyboard (U4). | Keep folding simulations in (the model would learn from `Math.random`) | E9 |
| **G11-D6** | **A bounded, append-only run log in IndexedDB** (per song, per epoch: ≤ 300 runs, each ≤ 2 KB: per measure index and hand the counts, signed and absolute timing means, tempo ratio, mode, hint use, missed event ids), next to the engraver's graph store. The localStorage aggregates stay as they are (the legacy reader, rollback). An **export** writes the log as a JSON file. | Growing the localStorage slot (the 5 MB origin budget is shared with packed scores: a 158-bar song is already 247 KB + 184 KB); a server log (needs a decision, U5) | E8, E10 |
| **G11-D7** | **Model v1 is transparent statistics** (AI-6 stage 0): per measure × hand, a Beta posterior of note accuracy with forgetting, a timing error estimate, and a monotone tempo-accuracy curve per passage; G6 hotspots as a weak prior for unplayed bars. A learned model is considered only after ≥ 2,000 logged measure-attempts from real playing beat v1's calibration on held-out days. | A neural or knowledge-tracing model now (no data; H-11 gives a few hundred attempts) | E8, AI-6 |
| **G11-D8** | **One plan language, one gate.** The policy's output is the Coach plan schema (`range`, `hand`, `tempoPercent`, `mode`, `repetitions`, `reason`); tempo ramps are task sequences; spaced review is a due list. Every plan, from the policy, the deterministic planner or an LLM, passes `Coach.validate`. An LLM may word and order tasks; it never writes or edits notes, never chooses a variant's notes, and its absence changes nothing. | A new schema for adaptive tasks (a second validator to keep in step); letting the LLM pick passages to simplify | E12 |
| **G11-D9** | **Synthetic learners validate mechanics, not pedagogy.** They prove that a policy converges, does not loop, spends time where the simulated weakness is, is stable, and is not worse than the legacy policy for any learner type. Whether it helps a real person is H-11's question and only H-11 can answer it. | Claiming real learning gains from the simulator | – |
| **G11-D10** | **A variant is generated for the whole piece and spliced by measure index**, never generated for a passage alone: the arrangers plan whole pieces (E14) and cache them; the splice checks the seams (ties, held notes, pedal and ottava spans, clef and key state, hand jump within G5 reach and velocity, at most 2 widenings of one bar on each side) and the result passes `validate`, notation-check classes 1-7 and G5 hard violations 0. The app refuses when the variant's passage is identical or not easier by G6's per-measure features. | A passage-only arrangement request (G7b plans per section, sections are exact-repeat runs whose labels are shared, E14); splicing without seam checks | E13, E14 |
| **G11-D11** | **Switches, all default off**: `PPP.practice = 'legacy' | 'graph'`, `PPP.learner = 'legacy' | 'adaptive'`, `PPP.variant = 'off' | 'on'`, the same convention as `PPP.fingering`/`PPP.difficulty` (any other value = the default). `'graph'` falls back to the legacy plan **per song** when the source's link is not ok, and counts it (G04 §16.7). | One switch for everything (a problem in one part would turn off all three) | – |
| **G11-D12** | **The practice browser suites enter CI before any app change**: a nightly job and a PR job that runs when the app file or `practice/` changes, on a free port, both switches. | Keep running them by hand (they have not run in CI since they were written) | E15 |
| **G11-D13** | **Practice data stays on the device by default.** Leaving it is a user decision (U5); the H-11 data is collected by the export file. | Silent telemetry | E10 |

## 6. G11a — practice on the graph (A)

### 6.1 The PlaybackPlan module

`practice/plan.js` (UMD; globals `PPPPractice.plan`), pure, no DOM, no clock:

```
build(graph, opts) -> Plan            same fields as PianoScore.build, plus ids
  opts.range        {from, to}: measure ids (or indexes) of the loop; absent = whole piece
  opts.defaultQpm   the Score's tempo (the legacy fallback 84 when none)
  opts.legacyCompat true: reproduce PianoScore exactly (the parity mode; default true until each fix is approved)
  opts.jumps        false | 'once'   (G11-D3 JUMP)
  opts.graces       false | 'play'   (G11-D3 GRACE)
Plan.visits   [{index, number, id, pass, startQ, lenQ, soundQ}]          (Score.form + ids)
Plan.strikes  [{midi, vel, q, upQ, hand, m, abs, ev, head, visit, grace?}] sorted (q, midi) like today
Plan.ccs, Plan.beats, Plan.tempoMap, Plan.pedal, Plan.soundLengthQ, Plan.hold/cont equivalents
followGates(plan, hands) -> [{b, m, notes: [{midi, hand, ev}], rest, dur}]  (FOLLOW_REPEAT / FOLLOW_TIE options)
```

Rules, each with its legacy counterpart and a unit test:

| Piece of the plan | Legacy rule (App) | Graph rule |
| --- | --- | --- |
| Play order | `Score.form(score, from, to)`: repeats, voltas, loop-start target (4095-4138) | `time.unroll` generalised to a range (same algorithm, `i0` = range start; tests: range = whole piece ≡ `unroll`) |
| Jumps | none | `timeline.jumps` (segno, coda, fine, dacapo, dalsegno, tocoda), only with `opts.jumps` |
| Struck or tied | `n.tieStop && plan.cont.has(n)` matched by `midi@abs` (3024-3052) | tie spanners by head id; compat mode keeps "a tie that leads nowhere strikes" |
| Hold | tie chain length, pedal up point, sostenuto (3260-3284) | the same arithmetic on rationals → floats at the end |
| Pedal | spans `[down, up)` in written quarters, `change` lifts, depth = half pedal (3058-3075, 3219-3242) | pedal spanners `from/to/changes/depth`, `soundOnly` |
| Velocity | dynamics, wedges, accents, soft pedal (3105-3176) | the same from graph dynamics/wedges/articulations |
| Tempo | `PianoScore.tempoMap` per visit (3187-3218) | `time.tempoMap(g, {defaultQpm})` mapped to the visit list |
| Pitch | `soundingMidi` (MX-1 D-1) | graph pitch is sounding: no shift |
| Graces | dropped | `opts.graces 'play'`: a grace sounds before its main note, taking time from the previous event (acciaccatura) or the main note (appoggiatura), `order` respected; never in the matcher's `expected` until a later decision |
| Beats | `PianoScore.beats` (6/4 = six) | the same counting in compat mode |

Performance: build ≤ legacy + 25 % (§11); cached per (music hash, range, options) like `PianoScore._cache`.

### 6.2 The event-parity harness

`tests/practice/parity.js` (Node driver, puppeteer, `serve-free.js`), injected into the page with
`addScriptTag` so the app does not load `practice/` until G11a-3:

1. **Corpus**: the 325 catalogue files (the 10 licence-quarantined czerny299 files follow the corpus rules:
   only aggregate counts are reported, never per-file output), the 40
   engraving fixtures (`tests/engrave/fixtures/e`), the 29 `tests/scoregraph/fixtures/xml`, and **new hand-written
   fixtures** for what the catalogue lacks: D.S. al Coda, To Coda, D.C. al Fine inside a volta, nested repeats,
   a tie across a repeat and into a volta, a pickup bar, a mid-measure tempo change, sostenuto and soft pedal,
   a grace before a chord, an arpeggiated chord, a dangling tie, 6/4 and 6/8 beats.
2. **Ranges**: the whole piece; 20 four-bar loop windows per file from a fixed seed, always including the
   windows that end on a backward repeat and the ones that start inside a volta; hands `both/right/left`;
   tempo scale 0.5 and 1.
3. **Legacy side**: `PPP.PianoScore.build(score, from, to)` canonicalised: visits `[number, pass, startQ,
   lenQ]`; strikes `[visitIdx, q, upQ, midi, vel, hand, m]`; ccs `[q, cc, value]`; beats `[q, accent]`;
   tempoMap `[q, bpm]`; `soundLengthQ`; `PerformanceEngine.begin` `tMs` list; `followGates`. Floats to 1e-6.
4. **New side**: `PPPPractice.plan.build(graph, opts)` on the graph the renderer would use
   (`PPPEngrave.app.resolveSync(score)`), same canonical form, ids stripped for the comparison and checked
   separately (every strike's `ev` is the event `identity` gives its Score note).
5. **Diff and causes**: multiset difference per key; each difference is matched against the rule table of
   the allowed causes (`JUMP`, `GRACE`, `FOLLOW_REPEAT`, `FOLLOW_TIE`, and nothing else). Anything unmatched
   is `UNEXPLAINED` and fails. With every fix option off (`legacyCompat`), the allowed set is empty.
6. **Scripted performances through the matcher**: for each file and window, five synthetic input streams
   (perfect; every note +80 ms; a wrong pitch every 7th note; 10 % missed; chords rolled 60 ms) through
   `PerformanceEngine` fed by the legacy plan and by the new plan: per-measure and per-hand result objects
   must be equal (compat mode) or differ only by allowed causes.
7. **The real scheduler**, for 12 files (both switches): the fake piano and fake MIDI output spies record
   what `schedule()` actually queues (note on/off times, CC64/66/67), at 8× tempo so one pass holds the piece;
   compat mode: identical lists; this is also the off-path identity check for G11a-3.
8. **Report**: `tests/practice/out/parity.json` (per file, per cause, counts); a committed summary
   baseline and `check` exit code; mutation tests on `practice/plan.js` (drop the pedal change lift, shift one
   visit, key ties by pitch only, ignore the hand filter, off-by-one volta pass) must each fail the check.
   Measured cost to expect: the corpus probe of §1 ran 325 imports in about a minute at 1×.

### 6.3 Integration (G11a-3)

- `PPP.practice = 'graph'`: `PianoScore.of(score, from, to)` at its 9 call sites goes through one function
  `practicePlan(score, from, to)` that returns the graph plan when `resolveSync(score)` gives a source whose
  `link.ok`, else the legacy plan (counted as `practiceFallback` with a reason).
- The matcher's `expected[i]` gains `ev`, `head`, `mIdx`; `result().byMeasure` keeps the number key and adds
  `byMeasureIdx`; `Learning.record` is unchanged under `PPP.learner = 'legacy'`.
- Follow mode reads `followGates(plan)`; with the fix options off it equals today's gates.
- The highlighter, the hand guide (`Fingering.plan` on the Score), memory hide plans (onset keys) and the
  falling notes read what they read today: the identity map ties their Score notes to the plan's events.

### 6.4 What the user could notice if the replacement goes wrong (risks of replacing a working player)

| What the user would notice | How it could happen | Guard |
| --- | --- | --- |
| A note missing, doubled or wrong in Play | A tie keyed differently; a visit duplicated at a loop boundary | Harness steps 3-7 at 0 unexplained; per-song fallback |
| The pedal blurs or the sound goes dry | Pedal span or `change` lift computed differently; sostenuto | Harness ccs + fake MIDI output CC lists; E17 |
| Wrong ending of a repeat; a lap that never ends | Volta pass or range unrolling off by one; a jump loop | Fixtures; `E-UNROLL-RUNAWAY`-style guard; mutation tests |
| Louder or softer playback | Dynamics/wedges/accents mapped differently | Velocity is in the strike key |
| Correct notes judged "missed" or "late" | `tMs` differs; expected list differs by hand filter | Scripted performances (step 6); `tMs` list compared |
| Follow mode asks a different note | Gates built differently | Gate lists compared; `FOLLOW_*` only when approved |
| "My progress is gone" | Results keyed by a new key; migration bug | `byMeasure` keyed by number unchanged under `PPP.learner='legacy'`; read-both migration (§9) |
| Stutter on entering Practice or while playing | Plan building on the main thread | Built with the renderer's resolve, cached; budgets §11 |
| The falling notes or the moving highlight drift from the sound | Visual timeline and plan disagree | Both read the same plan object (as today) |
| A fix the user did not want (graces audible, D.C. makes "Start to finish" longer) | Fix options on | Off until U2/U3; listening check (§10) |

## 7. G11b — honest evidence, the learner model, adaptation (B)

### 7.1 What is measured today, per note and per measure

Per **note**, during a run only: verdict (`on`/`early`/`late`/`missed`), signed Δt, the key event; wrong and
extra keys with time and blamed measure. Discarded at the next `begin` (E5). Per **measure**, kept: totals,
per-hand totals, tempo bucket totals, last 10 run summaries (accuracy, tempo, hands, mean |Δt|), `lastAt`.
Per **section** (8-bar chunk): the memory record (level, strength, recalls, review stage and date, last 12
attempts with per-measure accuracy and per-hand accuracy). Per **song**: the last 40 runs. Not measured at
all: signed timing (rushing vs dragging), which notes of a measure fail, hint effects outside memory mode,
time of day/session boundaries, the device's MIDI latency (a constant offset reads as "early" or "late").

### 7.2 The model (v1, transparent)

For each (measure index, hand), with forgetting half-life `H` (start 4 days; a parameter the simulator and
H-11 tune):

- **Accuracy**: Beta(α, β) updated by matched/expected per measured run, decayed by `2^(-Δt/H)` toward the
  prior; the prior's mean is 0.75 lowered by G6's per-measure hotspot score when `PPP.difficulty='g6'` is
  available (weight equivalent to 2 notes, so one real run dominates).
- **Timing**: mean and spread of signed Δt per measure and hand (rushing vs dragging), and a per-device
  constant offset estimated over all on-time notes (shown as a calibration hint, never silently applied).
- **Tempo curve**: per passage (2-4 bars), accuracy as a monotone decreasing function of tempo ratio
  (isotonic fit over the logged runs); `cleanTempo` = the highest ratio where the posterior accuracy is ≥ 0.9
  with 80 % credibility.
- **State**: `new`, `weak`, `improving`, `stable`, `memory-ready`, `memorized`, `due` (the legacy names, so
  the screens and the Coach context keep their words), derived from the posteriors instead of fixed windows.

### 7.3 The policy

One function `nextTasks(model, memory, now, budgetMinutes) -> CoachPlan`:

1. **Due memory reviews** (the legacy rule: a severe technical weakness first).
2. **Spaced review of weak passages**: a passage that was drilled gets a due date (Leitner boxes 1, 2, 4, 7,
   14 days; promoted after a clean run at `cleanTempo` ≥ 0.9 × score tempo, demoted on a failed one). Today
   only memorised sections are scheduled (E11).
3. **Tempo ramp** on the weakest passage: start at `cleanTempo` (never below 40 %), +5 to +10 % after two
   clean laps, −10 % after two failing laps, stop at 100 % (optionally 105 %); expressed as tasks with rising
   `tempoPercent`. Suggest by default; the automatic step is a toggle (U6).
4. **Hands separately** when the posterior hand gap ≥ 0.12 over ≥ 2 runs (the legacy threshold), until the
   weak hand is ≥ 0.9 at the current tempo; then hands together at the same tempo.
5. **New material** when nothing is weak; **memory work** when eligible (the `Memory.eligible` gate unchanged).
6. **Stuck detection** (input to G11c): the same passage weak over ≥ 3 sessions with no posterior gain at
   ≤ 60 % tempo → offer the easier variant.

Stability rule: the target passage does not change within 3 laps unless its accuracy moved ≥ 8 points (the
`Coach.shouldReplan` threshold).

### 7.4 Synthetic learners (validation design)

A UMD module `practice/sim.js` (Node; the legacy policy is run in the page through `PPP.Learning`/`Memory`/
`Coach`, which are already exposed, by injecting the simulator script):

- **Learner**: per measure and hand a latent skill `s` (log-odds); `P(hit) = σ(s − d·g(tempoRatio) − c)` with
  `d` from G6's per-measure features of the real catalogue piece; timing error `N(bias, σ(tempo))`; practice
  raises `s` by `η·(1 − P)` per repetition (more gain at a moderate challenge), forgetting pulls `s` back with
  half-life `h`; hands-separate practice transfers a share `κ` to hands together; parameters drawn per learner
  from ranges for six types (even, weak left hand, rushing, slow learner, fast forgetter, beginner).
- **Sessions**: 20-minute sessions on 30 days, the policy chooses each lap; the simulated keyboard produces
  real event streams through the real `PerformanceEngine` (so the evidence path is the app's).
- **Metrics**: simulated minutes until every measure is ≥ 0.9 at ≥ 0.95 × tempo; share of practice time on
  the truly weakest quartile; retention at day 30 after a 7-day break; recommendation flips per session;
  calibration (Brier score) of the model's predicted next-run accuracy; no learner type worse than legacy.
- **Scale and determinism**: 200 learners × 6 types × 8 pieces (2 per method book, 1 hymn, 1 recording
  arrangement), seeded LCG, Windows = Linux.
- **What it cannot show**: real effect sizes (G11-D9).

### 7.5 What needs the user's data (H-11) and how to collect it without a login

Only real runs answer: is the advice sensible to a teacher, do the tempo ramps feel right, does the
model's predicted accuracy match the next real run, how long sessions really are, MIDI latency of the user's
device. Collection, with no account and no server: the run log (G11-D6) and a once-per-session one-tap
rating ("오늘 추천이 도움이 됐나요? 예 / 보통 / 아니오") stay in IndexedDB; at the end of H-11 the user
presses **연습 기록 내보내기** and sends the JSON file (≈ 300 runs × ≤ 2 KB ≤ 0.6 MB per song). The file has
measure indexes, counts and timings, no audio, no raw MIDI.

**What a sync would need, and cost** (only on U5): an endpoint pair `PUT/GET /api/practice-log` keyed like
guest shares (a browser secret, owner `g_`+sha256, no account) or like the PC link (a code shown on one
device, typed on the other); a table `ppp_practice_log(owner, song_key, epoch, run_id, at, payload)` with
union merge by `run_id` (runs are immutable, so two devices never conflict; aggregates are recomputed); the
song itself must be on the second device too (songs are not synced, TD3), so a sync is useful only for
catalogue songs or together with G13's song sync; rate limits like `share-guest.js`. Cost: Neon Free storage
(0.5 GB) holds about 0.5 MB per fully practised song → about a thousand such songs; Render free compute is
shared by three services, so the client sends once at the end of a session, never per lap. Effort about 2
Sonnet sessions + a full review (server and app). Privacy: practice data of a person; stated in the UI;
deletion endpoint.

### 7.6 The LLM coach (guardrails kept)

`Coach.context` keeps sending summaries only; the new model adds per-passage `cleanTempo`, due reviews and
hand gaps (all as measured percentages, so `Coach.numbersIn` whitelists them). `Coach.validate` is unchanged
except for one addition: a task whose measure range is a variant copy's must name that copy (no task may
point the user at notes that do not exist in the open song). The LLM never sees or writes notes; the
deterministic policy is the fallback and the yardstick (a plan the LLM writes is shown only if it validates).

## 8. G11c — adaptive arrangement of a passage (C)

### 8.1 Generators that exist

- **Easier**: `arrangeSingleNote(graph, {level: one step down})` for printed pieces; for recordings
  `recordingArrange: 'leadsheet'` (melody + harmony, measure ids kept). Both whole-piece, cached.
- **Harder / as written**: the source the copy was arranged from (an arrangement copy records its source
  song), or one step up. The realizer keeps one measure per source measure (E13), so measure index aligns.

### 8.2 The splice (`practice/variant.js`, Node + browser)

`splice(base, variant, {from, to}) -> {ok, graph, seams, widened, reason}`:

1. Refuse unless both graphs have the same measure count and durations in the range ± 2 bars
   (`VARIANT_TIMELINE`).
2. Copy the variant's events of the range; cut ties and slurs that cross a seam (the note keeps its written
   value inside the range); clip pedal and ottava spans; carry clef and key state at both seams
   (`realize/clefs.js`, `realize/ottava.js` re-run on the range).
3. Seam playability: G5 `analyze` on the last beat before and the first beat after each seam; a hard
   violation (span, velocity) widens the range by one bar on that side, at most twice; then refuse
   (`VARIANT_SEAM`).
4. Verify: `validate` ok, notation-check classes 1-7 = 0 on the range and its neighbours, G5 hard violations 0.
5. Judge: G6 per-measure features of the range (density, span, leaps, chord load) must be lower for
   "easier" (higher for "harder") by a margin; identical events = `VARIANT_IDENTICAL`; not easier =
   `VARIANT_NOT_EASIER`. Each refusal has a Korean sentence and an alternative (tempo, hands separately).
6. Provenance: the spliced events carry `prov: {op: 'generated'}` from the variant's source; the copy records
   `variantOf: {songId, from, to, level}`.

Benchmark (G11c-0): every catalogue piece × 10 seeded 4-bar windows × {easier, harder}: success, refusal by
reason, seam widenings, verification failures (target 0), identical rate, G6 local-difficulty change; the
recording tier (the G10 synthetic covers) for the lead-sheet path.

### 8.3 UX for a piano teacher (Korean-first wording)

| Where | Wording | What happens |
| --- | --- | --- |
| Loop panel ("구간 반복"), a new button | **이 구간 쉽게 만들기** | Makes a copy "곡명 · 17–20마디 쉽게" (U7: copy vs overlay); opens it on the same bars |
| Same, in a copy | **이 구간 원래대로 연습하기** | Opens the source song on the same bars |
| Refusal | "이 구간은 지금보다 더 쉽게 만들 수 없어요. 대신 **70% 빠르기**와 **왼손만** 연습을 추천해요." | The tempo/hands task is offered with one tap |
| Stuck suggestion (G11b policy) | "17–20마디가 3일째 제자리예요. 쉬운 버전으로 먼저 익혀 볼까요?" [쉬운 버전으로 연습] [지금 그대로] | Never automatic |
| Tempo ramp | "깨끗하게 2번 성공! 다음은 **80% 빠르기**로." / "조금 어려웠어요. **70%**로 한 번 더." | Suggests; automatic only with the toggle "빠르기 자동 조절" (U6) |
| Hands separately | "왼손 정확도가 오른손보다 20% 낮아요. **왼손만** 3번 → **양손** 2번." | Existing hand filter |
| Spaced review | "오늘 복습: 9–12마디 (3일 전에 연습)" | A due list on the home card |
| No keyboard | "건반이 연결되지 않아 이번 연습은 기록되지 않아요. (데모 입력)" | Demo Input display only (U4) |
| Export | **연습 기록 내보내기** | JSON file download |
| Teacher use, copy title | "학생용 · 17–20마디 쉬운 버전" | The teacher can print or share the copy with the existing share link |

Existing translations are reused (구간 반복, 외우기, 따라가기, 양손 {{pct}}% 빠르기, 왼손만, 마디 {{from}}–{{to}}).

## 9. Migration of saved progress

- **Today**: `ppp.song.v1.<id>` = `{score, secs, history {rev, byMeasure{number: stat}, runs[]}, memory
  {rev, sections{s1..: rec}}, …}`; `ppp.state.v2` mirrors the open song; signed-in users also have
  `ppp_progress.payload` = `ppp.state.v2`.
- **Read-time mapping, no rewrite**: the new model maps `byMeasure[number]` → measure index through the
  song's own Score (`Score.measure(score, number).index`), which is exact because the history was recorded
  against that Score (a rewrite starts it over, E13). The legacy aggregates are the model's prior for
  measures with no run-log evidence (weight capped so that new runs dominate).
- **Simulated history**: legacy `byMeasure` cannot tell simulated from measured (E9). The model treats legacy
  aggregates of a song whose `runs[]` are mostly `simulated` (> 50 %) as untrusted (prior weight 0) and says
  so once ("이 곡의 이전 기록은 데모 입력이라 참고하지 않아요").
- **New data** goes to the run log (IndexedDB) and, unchanged, to the legacy aggregates, so turning
  `PPP.learner` back to `'legacy'` loses nothing. `Learning.record` rebuilds its object from three fields; the
  model's own state therefore never lives inside `history`.
- **Memory** records stay keyed by the 8-bar chunk ids; G11 does not switch memory work to G7a sections
  (labels are shared by repeats, E14).
- **Server**: the `ppp_progress` payload shape is unchanged; the run log is not uploaded without U5.
- **One release** with both readers; the legacy aggregates are never deleted by G11.

## 10. Phases (E)

Each phase is shippable alone and merges with its switch off; "touches the app" phases get the full review
cycle (implementer → one independent review → fixer for BLOCKER/MAJOR → Lead re-check), the others the
light one (review-depth rule).

| Phase | Deliverable | Touches the app? | Model | Effort (sessions) | Depends on | Acceptance | Rollback |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **G11a-0** | Practice suites in CI (nightly + PR job on app/`practice/` changes, free port); the legacy recorder (canonical dumps of `PianoScore.build`, matcher verdicts, follow gates) and the perf probe of §1 as `tests/practice/perf.js` with committed baselines | no | Sonnet | 1-2 | – | the 11 suites green in CI on `main`; baselines reproduce E5-E7 within ±20 %; a deliberately broken matcher fails the job | revert |
| **G11a-1** | `practice/plan.js` with `legacyCompat`, `jumps`, `graces`, follow gates; Node unit tests (every row of §6.1) and new jump/grace fixtures | no (Node) | Sonnet | 2 | – | unit tests and mutations in `test:practice` (CI); ≤ 10 ms (1×) for 1,800 notes in Node | revert |
| **G11a-2** | The parity harness (§6.2) in the nightly and on `practice/` PRs | no | Sonnet | 1-2 | a0, a1 | compat mode: **0 differences** on 325 + 69 + new fixtures × ranges × hands × tempi, matcher results equal, scheduler spies equal on 12 files; fix options: only allowed causes, counts reported per cause (expected on the catalogue: JUMP 8 files, GRACE 17 files / 244 events, FOLLOW_REPEAT 168, FOLLOW_TIE 6 / 20 notes); all mutations caught | revert |
| **G11a-3** | `PPP.practice` switch, `practicePlan()` at the 9 call sites, ids on `expected`, per-song fallback counter | **yes** | Sonnet | 2 + review | a2 | every practice browser suite passes under `'legacy'` and `'graph'`; off-path: scheduler spies identical to `main`; §11 budgets; fallback 0 on the catalogue | `PPP.practice='legacy'` (default) |
| **G11a-4** | Fix options exposed under `'graph'` (D.C./Fine, graces, follow repeats, follow ties), with the defaults the user chose (U2, U3); a 10-minute listening check by the user on 3 pieces | yes | Sonnet | 1 + review | a3, U2, U3 | harness counts equal the expected list; the user's check ok | options off |
| **G11a-5** | Flip `PPP.practice` default to `'graph'` | yes (default) | – | 0.5 | a4, user's word | live check (smoke + a puppeteer run of follow/midi against production) | default back; legacy kept one release |
| **G11b-0** | `practice/sim.js` synthetic learners, the legacy-policy runner in the page, metrics (§7.4) | no | **Opus** | 2 | – | deterministic (3 runs, reversed order, Windows = Linux); legacy baseline per learner type recorded | revert |
| **G11b-1** | Typed evidence (G11-D5), the run log in IndexedDB (G11-D6), export button, rating tap, Demo Input display state — behind `PPP.learner` (the separation of simulated runs is the default only on U4) | **yes** | Sonnet | 2 + review | a0 | legacy aggregates byte-identical under `'legacy'`; log ≤ 2 KB/run, ≤ 5 ms per lap at 4×; export round-trips; storage-full and blocked-storage paths keep the app working | `PPP.learner='legacy'` |
| **G11b-2** | Model v1 + policy (§7.2-7.3) in `practice/learner.js`, `practice/policy.js`; tuned on the simulator | no (Node) | **Opus** | 2-3 | b0 | vs legacy on the simulator at equal minutes: time to mastery −20 % or better on average, **no learner type worse by > 5 %**, retention not worse, flips ≤ 1 per 3 laps, Brier ≤ legacy `recentAcc` Brier; every plan passes `Coach.validate` (10⁴ random states) | revert |
| **G11b-3** | App integration: the policy feeds the recommendation card, the Loop panel sequence and `Coach.context` under `PPP.learner='adaptive'` | **yes** | Sonnet | 2 + review | b1, b2 | all suites both switches; `coach.test.js` guardrails unchanged; policy ≤ 2 ms at 4×; Korean wording reviewed | switch |
| **G11b-4** | **H-11** (§10.1) + the go/no-go | user ~1 week | – | user | b3 (+a3 optional) | §10.1 | stay on legacy |
| **G11b-5** | Default flip of `PPP.learner` | yes (default) | – | 0.5 | b4, user's word | live check | default back |
| **G11c-0** | `practice/variant.js` splice + benchmark (§8.2) | no (Node) | Sonnet | 2 | – | verification failures 0; refusals reported by reason; identical rate measured (expected high, E14) | revert |
| **G11c-1** | "이 구간 쉽게 만들기 / 원래대로" in the Loop panel, copy creation, refusals with alternatives, `PPP.variant` | **yes** | Sonnet | 2 + review | c0, U7 | the teacher's flow reproduced in a production-like page (open a piece → loop 17-20 → easier → copy opens on those bars → practise → back); no main-thread block > 50 ms beyond the arranger's existing sliced run | `PPP.variant='off'` |
| **G11c-2** | The policy's stuck suggestion (§7.3 item 6) offers the variant | yes | Sonnet | 1 + review | b3, c1 | suggestion only after the stuck rule; never automatic | switch |
| **G11-S** (optional) | Login-free sync of the run log (§7.5) | **yes + server** | Sonnet | 2 + review | b1, U5 | merge by run id, rate limits, deletion | endpoint off |

**Order and what can start now, without the user**: G11a-0 → (G11a-1 ∥ G11b-0 ∥ G11c-0) → G11a-2 →
G11a-3 and G11b-1 (each behind a default-off switch) → G11b-2 → G11b-3. The user is needed at U1 (before
H-11 is scheduled), U2/U3 (before G11a-4), U4 (before G11b-1 changes a default), U7 (before G11c-1), H-11,
and each flip. **Total effort**: G11a ≈ 8-10 Sonnet sessions; G11b ≈ 4-5 Opus + 4 Sonnet; G11c ≈ 5 Sonnet;
plus reviews (about 5 full reviews for the app phases).

### 10.1 H-11 (dogfooding)

- **Setup**: a computer or Android device with a MIDI keyboard (U1); 2-3 pieces the user really practises,
  ideally one method-book piece, one hymn and one of their own arrangement copies; `PPP.learner='adaptive'`
  (and optionally `PPP.practice='graph'`) on that device only; 5-7 days, ≥ 4 sessions of ≥ 15 minutes.
- **Collected**: the run log, the one-tap ratings, and a two-line note at the end; the export file sent once.
- **Pass (go)**, fixed before H-11 starts: (1) the user wants to keep it on; (2) ≥ 60 % of the policy's
  proposed tasks were started; (3) no recommendation flagged "말이 안 됨" more than twice; (4) the model's
  predicted next-run accuracy has a lower Brier score than legacy `recentAcc` on the logged measure-attempts
  (needs ≥ 300); (5) no lost progress, no practice-screen regression. Improvement on the drilled passages
  (accuracy at tempo, `cleanTempo`) is **reported**, not a pass condition: one week of one person has no
  control group.
- **Fail**: the switch stays off; the log tells which part failed (advice, tempo steps, hands, stability).

## 11. Performance budgets

Measured today (E5-E7) → budget, for a 1,800-note piece, 1× / 4× CPU:

| Item | Today | Budget |
| --- | --- | --- |
| Plan build (whole piece) | 7 / 35 ms | ≤ 10 / 45 ms, cached, never on a play tick |
| Matcher `noteOn` p95 | 0.1 / 0.2 ms | ≤ 0.5 ms at 4× |
| Press → painted frame p95 (4×) | 55 ms | ≤ 60 ms |
| Long tasks during play | 0 (1×) / one of 86 ms in 9 s (4×) | 0 > 50 ms at 1×; ≤ today's count at 4× |
| Practice entry long tasks | 2 (132, 201 ms) / 3 (≤ 841 ms) | no new one; existing ones are G4 B5 |
| Learner update per lap | n/a | ≤ 5 ms at 4× |
| Policy decision | n/a | ≤ 2 ms at 4× |
| Run log | n/a | ≤ 2 KB per run, ≤ 300 runs per song epoch |
| Variant: splice + verify | n/a | ≤ 100 ms at 1× on top of the arranger (0.2-4 s, sliced) |

## 12. Risks

| Risk | Mitigation |
| --- | --- |
| Replacing a working player breaks what the user relies on (§6.4) | Adapter, not rewrite (D1); parity at 0 unexplained (D2); per-song fallback; switch off; one release with both |
| The user practises without a keyboard or on iOS: no evidence at all | Ask first (U1); H-11 only with a keyboard; say it on screen (D5) |
| The learner model fits the simulator, not people | D9; H-11 gate (4) is about real predictions; parameters reported, not hidden |
| Advice that flips every lap | Stability rule; flips metric in the simulator |
| "Easier" variants are identical or barely easier | Refuse with a reason and offer tempo/hands (D10); the identical rate is measured before UI work (G11c-0) |
| Seams of a splice unplayable or ill-notated | Seam checks, widening, full verification; 0 failures in the benchmark |
| Storage pressure (packed scores + histories + logs) | Log in IndexedDB with caps; the existing storage-full message; logs are prunable |
| Progress lost by a migration | Read-time mapping only; legacy aggregates kept and still written |
| Three switches multiply test configurations | Each phase tests its switch against `legacy`; combined only in H-11 |
| The LLM coach suggests a passage that does not exist in a copy | `Coach.validate` gains the copy-range rule (§7.6) |
| Process: merging app phases on a red gate | Read the gate result before every merge (§8 of the roadmap) |

## 13. Rollback

`PPP.practice = 'legacy'`, `PPP.learner = 'legacy'`, `PPP.variant = 'off'` restore today's behaviour exactly
(the off-path identity of every app phase is proven by the scheduler spies and the legacy aggregates). New
modules (`practice/*`) are not loaded while their switch is off. Logs in IndexedDB are ignored by the legacy
code. Variant copies are ordinary arrangement copies and survive a rollback.

## 14. Decisions (F)

### 14.1 Need the user (product, UX or cost only)

| ID | Decision | Lead's recommendation | Cost if the recommendation is wrong |
| --- | --- | --- | --- |
| **U1** | How and where do you (and your students) practise: with a MIDI keyboard on a computer or Android, or on a phone/iPad without one? Who is G11 for first: your own practice, or students at home? | **Your own practice with a MIDI keyboard first; students later.** Without Web MIDI nothing can be measured (E9). | If students on iPads are the real users, G11b produces nothing for them; a microphone judge would be a new Goal |
| **U2** | Play D.C./D.S./Fine/Coda and grace notes (drawn = played)? | **Yes for both; graces sound but are not judged** at first. | Laps of "Start to finish" get longer on 8 catalogue pieces; graces could sound unfamiliar on 17 |
| **U3** | Follow mode: ask repeated bars as often as Play plays them, and exactly the notes Play strikes? | **Yes.** Follow and Play then mean the same piece. | A follow lap of a repeated passage takes twice as long (168 catalogue pieces) |
| **U4** | Stop counting runs without a keyboard (Demo Input) as practice progress? | **Yes**: Demo Input still moves the screen, but writes no evidence. | Users who only press Play without a keyboard see "기록 없음" instead of rising bars |
| **U5** | Practice data off the device: (a) never, the export file only; (b) opt-in upload for the Lead's analysis; (c) sync between your devices by a link code | **(a) now; (c) only if you practise on two devices.** | (b)/(c): about 2 sessions of work, a new table on the free database (about 0.5 MB per fully practised song), a privacy note |
| **U6** | May the app change the tempo between laps by itself? | **Suggest by default; an automatic toggle, off.** | Too many taps if you want it automatic; surprise if it is automatic and you do not |
| **U7** | An easier passage as a separate copy ("곡명 · 17–20마디 쉽게") or swapped in place inside the song? | **A copy first** (progress kept apart, the original untouched). | A cluttered "내 곡" list |
| **U8** | The LLM coach in production: keep it off (the deterministic coach answers), or pay per call for a hosted model? | **Keep it off**; it adds wording, not notes or measurement. Priced only if you ask. | Plans are worded more plainly than an LLM would word them |
| **U9** | H-11: when, which 2-3 pieces, about a week | After G11b-3 is merged; pieces you really practise. | – |

### 14.2 The Lead decides alone

Module layout (`practice/`); the parity harness, its corpus, cause codes and baselines; keeping the legacy
quirks of E4; storage layout (IndexedDB log, caps); evidence keys (G11-D4); model forms and the simulator's
parameter ranges; thresholds after the baselines (stated in the phase records); migration rules; budgets;
review depth per phase (full cycle for G11a-3, a4, b1, b3, c1, c2, S).

## 15. Honest unknowns

1. Whether the user practises with a MIDI keyboard at all, and on which device (U1). Everything in G11b
   depends on it.
2. Whether any simulator setting predicts real improvement; the literature supports distributed and slowed
   practice in general, but nothing here measures effect sizes for this app (G11-D9).
3. How often an easier passage can be made that is really different and easier (E14 suggests often not); G11c-0
   measures it before any UI.
4. Whether the realizer keeps repeats, voltas and jumps in an arrangement copy (needed for playback parity of
   copies and for splicing near a repeat); not verified for this document.
5. Whether the AI coach runs in production (E12): the records and `render.yaml` disagree.
6. How often, in real use, a device falls back from a live/stored graph to a projected one (changing ids);
   G11a-3's fallback counter and G11-D4 make this harmless but it is unmeasured.
7. Whether the ±250 ms window and 55/130 ms on-time thresholds fit beginners and the user's MIDI latency
   (Bluetooth MIDI adds delay); no data; G11b's offset estimate will show it.
8. The cross-device restore issue of E10 was found by reading, not reproduced.

## 16. What G11 does not do

No microphone or audio judging of practice; no new import path; no accounts, payments or class management;
no ML learner model before the data gate (G11-D7); no LLM-written notes; no automatic arrangement change
without the user's tap; no change to the engraver, the arrangers' internals or the recording conversion;
no humanized playback; no removal of `PianoScore`, the legacy Score or `parseMusicXML` (G13); no change to
the Piano Basics lessons' matcher; no server sync unless U5.

## 17. Lead summary (for the roadmap)

G11 designed (`docs/GOALS/G11_ADAPTIVE_PRACTICE.md`). Measured: the legacy play order equals `time.unroll`
on 325/325 catalogue files; the matcher answers in ≤ 0.2 ms p95 at 4×; four legacy-wrong behaviours sized
(D.C./Fine 8 files, graces 244 events in 17 files, follow skips repeats in 168 files and dangling ties in 6);
runs without a keyboard are random simulations counted as evidence; no practice test runs in CI; the
practice entry's long tasks (132-841 ms) are the engraver's. Plan: G11a-0 (CI + baselines) → G11a-1/2
(graph plan + parity harness, Node/test only) → G11a-3 (switch); G11b-0 simulator (Opus) → G11b-1 honest
evidence + export → G11b-2 model/policy (Opus) → G11b-3 → H-11; G11c-0 splice benchmark → G11c-1 UI. Can
start now without the user: G11a-0, a1, a2, b0, c0 (and a3, b1 behind off switches). User decisions U1-U9.

## Appendix A. Measurement commands (Lead's scratchpad)

```
cd scratchpad/g11-design
node measure.js  > m1.json    # unit timings 1x/4x (import, toScore, link, agree, PianoScore.build, unroll, tempoMap,
                              # PerformanceEngine begin/noteOn/result), practice entry and live-play long tasks
node measure2.js > m2.json    # corpus: Score.form vs time.unroll, link, jumps, graces, dangling ties, loop quirk;
                              # press-to-paint latency at 4x
node measure3.js              # learner history and packed score sizes
python -I scan.py D:/PPP-g11d/catalog   # MusicXML feature counts (repeats, endings, D.C./Fine, graces, ottava, pedal)
```

All run against this worktree's own server (`tests/serve-free.js`, NODE_ENV=production), headless Chrome
from `D:/PPP/node_modules/puppeteer` (read only), CPU throttling by `Emulation.setCPUThrottlingRate`.
