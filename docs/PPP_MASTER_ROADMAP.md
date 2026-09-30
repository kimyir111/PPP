# PPP — Master Roadmap

The operational roadmap for everything after G4a: order, dependencies, gates, and what happens next.

| | |
| --- | --- |
| Owner | The **Lead / Orchestrator** session. Implementers, reviewers and fixers read it. Only the Lead edits it. |
| Updated | 2026-09-30 — forty-first edition (Lead): **G9e-lite DEPLOYED** (#113, `88900fe`, deploy `dep-dauh8ou0tbcc73feapa0`; rollback `26e26f3`). The app has an opt-in "one note per hand" mode (`PPP.arranger = 'single'`, a chip in the Song Arranger and on the review screen); the default is unchanged (`legacy`). Verified live beyond `/health`: 0 lazy G9 scripts requested at load, served HTML identical to the merged file, four hymns arranged in single-note mode with no two-note starts, the option off restores the default. The production run of `tests/single-note-app.test.js` shows 2 "FAILED" checks that are the test's own environment, not the code: production has no local helper, so the default arranger's first request (`/helper/arrange-score`) is answered 503 by design (`server.js` proxyHelper) and the app falls back to its browser engine; the test only blocks port 8788, so it counts that console line. **User decision (2026-09-30): one-note-per-hand counts as the EASY tier ("쉬움").** The single-note output is about 0.5 level easier than requested, so it is treated as easy, not as a mode that must match the requested level. Previous: fortieth edition (Lead): **G9c tooling merged** (#98, `de2dc5f`, the blind-review packet builder for H-8/H-9; the human reviews themselves have NOT been run). Previous: thirty-ninth edition (Lead): **G9a (#94) and G9b (#96) merged** (Node-only); **TD14 (#92) and TD15 (#93) fixed and live** (deploy `26e26f3`, verified live). Previous: 2026-09-28 — thirty-eighth edition (Lead, on Opus for G9's design at the user's request): **G9 designed** (PR #90, `9f9897e`, `docs/GOALS/G09_CANDIDATES_CRITICS_REPAIR.md`). Three roadmap corrections: H-8 was never run, so AI-4 has zero training data; the planned H-8/H-9 volume likely can't support AI-4's bar; the flip needs G8b's `'balanced'`-routing gap fixed first. Phased G9a-G9e so nothing waits on missing data or user decisions. Current: G9a (candidates + deterministic critics + selection, measured head-to-head vs legacy) |
| Base | `origin/main` = `9f9897e`, deployed as `4866b66` |
| Active | **G4, MX-2, G5, G6, G7 and G8 all live. G9a-G9c merged (Node-only, not loaded by the app); the teacher's two blind reviews are done and their criterion is implemented as `singleNoteHands` (#111).** Next: the user's decision on connecting G9 to the app (G9e) and on the difficulty-scale meaning of one-note-per-hand. |
| Lead worktree | `D:/PPP-lead`, branch `lead-roadmap`. The Lead writes docs only, never in an implementer's worktree. |
| How this relates to other docs | `docs/CURRENT_STATE.md` says what is true now, with measurements. `docs/DECISIONS.md` says why. `docs/GOALS/Gxx_*.md` is the contract for one Goal: design, acceptance and implementation record. **This document says in what order, behind which gates, and what comes next.** It does not repeat the goal specs. On detail, the spec wins. On sequencing, this document wins. |

## Contents

1. [Product north star](#1-product-north-star)
2. [Current architecture](#2-current-architecture)
3. [Completed Goals](#3-completed-goals)
4. [Deferred work](#4-deferred-work)
5. [Remaining Goals](#5-remaining-goals)
6. [Dependency graph](#6-dependency-graph)
7. [Recommended implementation order](#7-recommended-implementation-order)
8. [Phase boundaries](#8-phase-boundaries)
9. [Acceptance gates](#9-acceptance-gates)
10. [Human-review gates](#10-human-review-gates)
11. [Automation / test strategy](#11-automation--test-strategy)
12. [AI / model milestones](#12-ai--model-milestones)
13. [Technical debt that blocks later Goals](#13-technical-debt-that-blocks-later-goals)
14. [Current task](#14-current-task)
15. [Next task](#15-next-task)
16. [Stop conditions](#16-stop-conditions)
17. [Definition of final product completion](#17-definition-of-final-product-completion)
18. [Decisions that need the user](#18-decisions-that-need-the-user)
19. [Change log](#19-change-log)

---

## 1. Product north star

PPP turns music a person cares about into a piano score they can actually learn, and then helps them learn it.

```
original audio │ symbolic file │ printed score
   → musical understanding            SongGraph (what the piece is)
   → arrangement planning             for which player, what to keep, which style
   → arrangement realization          notes → ScoreGraph (what is played and notated)
   → professional notation            engraving: screen + print
   → playability + difficulty         is it playable, how hard, where
   → adaptive practice                practise, measure, simplify or advance
```

**Quality bar.**
- A piano teacher would hand the score to a student without fixing it. This is the absolute axis of the G3 and G4 human reviews.
- The app never contradicts itself: **what is drawn = what is played = what is judged.**

**Principles (binding on every Goal).**

1. **정답이 명확한 것은 코드로, 음악적으로 애매한 것은 AI로.**
   - Clear answers are written as code: notation legality, geometry, collision, validation, playback semantics, timing arithmetic, physical reach and hand constraints.
   - Musically ambiguous questions go to learned models: arrangement choices, style, how difficulty factors weigh, which reading is more musical, audio perception.
   - **The AI proposes, deterministic code verifies, and the ScoreGraph records provenance** (`inferred`, `generated`, `repaired` — all already in the schema, `scoregraph/schema.js:51`).
2. **ScoreGraph is the only notation truth.** Everything else is a projection or a cache (G1-D1..D12, G4-U1).
3. **SongGraph understands; ScoreGraph states.** SongGraph points into a ScoreGraph by ID and `ScoreSpan`, never the reverse, and never copies notes (G1-D11, G01 §10).
4. **Boundaries move by strangler**: shadow → A/B → flip behind an explicit switch, and the old path is kept for one release.
   - Writers never fall back silently (G1-D13).
   - Screens fall back per song, and the fallback is counted (G04 §16.7).
5. **Measure before and after.** Every change reports its effect on a committed benchmark. People are asked only at milestones.
6. **Judge each stage on clean input.** Upstream errors are reported separately (`CLEAN_INPUT` / `UPSTREAM_ERROR`), never excluded after the fact (A36 lesson, G3-U10).
7. No copyrighted material in the repository. Hold-out cases are never inspected or reported one by one.

---

## 2. Current architecture

At `a0bc2ea`. The detailed structure is in `docs/ARCHITECTURE.md`.

```
 producers                                   canonical                     consumers (what they read today)
 MusicXML/MXL/MIDI import (G2) ───────────►                                 renderer ──────── legacy Score  → G4 moves it to the graph
 recording → toMusicXml → buildGraph (G1) ─►  ScoreGraph  ── toScore ──►   playback, practice, follow,
 recording/rewrite → parseMusicXML(xml) ───►  (scoregraph/)                  Coach, Fingering ── legacy Score
 OMR → parseMusicXML + PdfLayer.apply ─────►   + IndexedDB cache (G4a)     arrangers (3 engines) ── legacy Score / wire JSON
 arrangers → parseMusicXML(xml) ───────────►   + engrave/ plan + ledger    MusicXML export ────── graph (G1)
                                               (no layout yet)             G0 benchmark ───────── MusicXML artifact
 SongGraph: design only (G01 §10), no code.
```

**Strangler stages** (G01 §15.2), with owners **reassigned by this roadmap** where the old owner lapsed:

| Stage | What | Status | Owner now |
| --- | --- | --- | --- |
| S0–S2 | Library, corpus round trip, writer goes through the graph | done (G1) | – |
| S3 | App import goes through the graph | done (G2) | – |
| S4 | App-made XML stops being re-parsed with `parseMusicXML` | **no owner.** G01 gave it to G2–G3; G2 and G3 both excluded it. | Split by producer: **arrangement → G8**, **recording/rewrite → G10**, **OMR → G12** |
| S5-render | The renderer reads the graph | G4a done (source, plan, ledger); G4b–G4f remain | G4 |
| S5-play | Playback, practice judging, follow and Coach read the graph | not started | **G11a** (the only Goal that needs it); two playback bugs go earlier in MX-1 |
| S6 | Arrangement input and output on the graph | not started | G8 |
| S7 | SongGraph and planner | not started | G7 (drums: not scheduled, §5.13) |
| S8 | Remove `parseMusicXML`, `buildXml`, `packScore`, the legacy renderer | not started | staged: the switches in MX-3 after G4f; the legacy renderer one release after the G4f flip; `packScore` and the legacy Score in G13 |

**What already exists as legacy code** (surveyed 2026-09-25 at `a0bc2ea`). Later Goals are migrations and upgrades of these, not greenfield:

| Capability | Legacy code | Reads | Measured? |
| --- | --- | --- | --- |
| Fingering | `Fingering` (App 8303–8769): a Parncutt span table plus keyboard-distance DP; the output feeds only the on-keyboard hand guide | Score | 17 exact cases in `tests/fingering.test.js` (browser, not in CI). No corpus metric. The path cost is discarded, so it produces no playability output. |
| Hand split | `audio-score.js` 840–899 (recordings); `scoregraph/pro-staff.js` (G3, off) | heard notes / graph | G0 hands gate |
| Difficulty | `Score.deriveSections` (App 3658) fixed 8-bar chunks with a weighted heuristic; `Coach.structural` (App 7958) | Score | nothing measures accuracy |
| Arrangement | browser `ScoreArranger` (App 8964); `arrange_score.py` (harmony Viterbi and voicing DP, music21 optional); `audio-score.js` `arrangeNotes` (subset of heard notes) | Score / wire JSON / heard notes | `tests/arranger_test.py` 3 tests, one golden. **No quality metric. No hand-span check** — LH voicings can exceed an octave. |
| LLM use | helper `/coach` (practice plans) and `/arrange` (level and style **parameters only**; "never invent, remove, transpose or name pitches") via Claude or Ollama | summaries | `coach.test.js` with a fake provider |
| Transcription | `transcribe.py` ensemble (TransKun V2, Kong, Aria-AMT) + Beat This + PM2S on the local helper; Basic Pitch and Onsets&Frames in the browser as fallback | audio | G0 bench (core 553, usable 18.1 %) |
| OMR | Audiveris or PDFtoMusic on the helper; `PdfLayer.apply` edits the Score | PDF | `omr-live` 4 cases, usable 0 % |
| Practice | `PerformanceEngine` (App 4924), `Learning` (5188), `Memory` (5691), `Coach` (7763), `course.js`, `lessons.js` | Score | browser suites only |
| Playback | `PianoScore` (App 2590); `Score.form` expands repeats and voltas only (no D.S., D.C. or Fine); pedal `change` = no lift | Score | `playback-scheduler.test.js` |
| Server | `server.js`: auth, progress blob, shares, helper proxy; Postgres or a JSON file. Songs are **not** synced, only progress. | – | browser suites |

---

## 3. Completed Goals

| Goal | Status | Merged | Later Goals reuse |
| --- | --- | --- | --- |
| G0 Quality Foundation | CLOSED | PR #1 `aff7080` | `tests/bench/`: `run.py run/check/ab/golden/mutation-check/update-baseline`, suites smoke/core/robust/full/replay-public/omr-live, the usable-score gates, hold-out rules, review scripts, CI `bench.yml` |
| G1 ScoreGraph | CLOSED | PR #2 `aa77d2e`, #3 `00081cc` | `scoregraph/`: schema, validator, canonical JSON, `time.js` (unroll, tempoMap, resolveSpan), `prov.js`, ops, MusicXML import/export, `sg-roundtrip`, SongGraph interface types (G01 §10.3) |
| G2 Score Import | CLOSED | PR #4 `cc0da79` (+#5, #6) | `scoregraph/import.js` (the one door), MIDI (`midi-file.js`, `midi-import.js`), `legacy-score.js` `toScore`/`compare`, schema v2, the written/sounding pitch layers (G2-D15) |
| G3 Score Intelligence | **PARTIAL / DEFERRED**, all off | PR #7 `c5474c2` (+#8) | `professionalize()` passes and critic (off), `meter-grid.js`, `pro-beam.js` `groups` (used by G4), reason-aware gates, blind human-review tooling (`run.py human-set`) |
| G4d-1b System marks and vertical spacing | CLOSED | PR #19 `a6e1a75` | `sysmarks.js`: dynamics, hairpins, pedal (change visible), ottava ("(8)" after a break), voltas, chord names, tempo (one line), rehearsal, jumps, words, lyrics; §15.3 vertical spacing; §15.4 courtesy signs; named metrics for A8 positions and hairpin extent; `plan/3`, `engr/5`; B9 0.32 |
| G4d-1a Curves and note marks | CLOSED | PR #17 `b4fe019` | `curves.js` (ties, slurs, glissandi, halves at system breaks), `marks.js` (one `place()` over skylines, `FAR_PLACEMENT`), articulations, ornaments, fermatas, fingering inside slurs (G4-L5), chord ties split relative to the chord (G4-L4), arpeggios, noteheads, cautionary accidentals, percussion; text-metrics table; `plan/2`, `engr/3` and a version guard |
| G4e Print and PDF | CLOSED | PR #26 `a33ccd3` | Print-only DP line-breaker (`engrave/breaks.js`), pagination that never splits a system, a title/composer/page-number area, print-only multi-measure rest merging, a dev-switch-gated print command; screen output byte-identical (`engr/6`, 236/236 SERIALIZATION_ONLY); a committed print regression-hash baseline added after review (G4-E8) |
| G4d-2 Page integration | CLOSED | PR #23 `16ce784` | `engrave/page.js`: the renderer in the page behind a dev-only switch (default `'legacy'`); `sync` touches only changed elements; §16.4 DOM contract; fallback to legacy with a counted warning; `server.js` hash-gated immutable caching; the M-H1 review tool. Verified byte-identical to base on a scripted default-renderer user session |
| G4c Notation core | CLOSED | PR #15 `e3c8c5a` | Beams (graph exact, derived only where none), final stems, tuplets, voices (shared unisons; G4-B11 down-stem moves right), rests, grace notes, the mid-measure key change; `svg.js` + vendored Bravura outlines (B9 0.19–0.28); rest and stem/flag collisions as zero-target gates; 7 named metrics for the G4c rules after the review |
| MX-1 Playback correctness | CLOSED | PR #13 `e37d37a` | An 8va sounds at the file's pitch and is drawn under its sign in every view (D-1; the MusicXML octave-shift sign fixed, MX1-D1); cards print where a note sounds; a pedal `change` lifts and re-presses the damper; the four-note `.mid` message; the `ottavaRule` marker; audit: all 34 octave-line files sounding-encoded. **Deployed 2026-09-26** (production `0ef0950`) |
| G4b Layout core | CLOSED | PR #12 `62ede61` | `engrave/` layout core (`metrics`, `space`, `breaks`, `skyline`, `canon`, `layout`, `practice`): NotationPlan → EngravedScore `engr/1`, practice map and highlighter; L2 geometry bench; committed layout hashes (Windows = Linux = Chrome); layout mutation test; A29 static ban; the other-voice collision ratchets |
| G4a Engraving source and plan | CLOSED | PR #9 `df8a571` (+#10) | `engrave/` (RenderSource, NotationPlan, fidelity ledger, glyph table, IndexedDB graph cache), `legacy.fromScore/agree/link`, vendored VexFlow 4.2.3, E01–E40, R corpus (61 files), L1 bench, `test:engrave` in CI |

Every Goal from here on must keep these green. See §9.

---

## 4. Deferred work

Each item has one owner and one trigger. The deferred item is not done until its trigger fires and its owner closes it.

| Item | From | Why deferred | Trigger to reopen | Owner |
| --- | --- | --- | --- | --- |
| **G3a** (hands, voices, rhythm representation, logical tuplets, spelling, beams) | G03 §30–§31 | Blind review A36 failed (16/20, 4 rhythm losses) | The G4 flip makes beams visible (G3-U8, G3-U10), then Fixer H1/H2, a new seed and A36 re-run in the PPP renderer | **G10a** — folded in so there is one human review, not two |
| **G3b** (release → note value R-reg, voices from the performance) | G03 §31 | Needs real recordings | M11 done | G10a |
| G3 automatic 8va | G3-U2 | Issue 3 (8va playback) | MX-1 done | G10a (switch-on decision) |
| G3 `pedalJoin` | G3-U7 | The app plays `change` with no lift | MX-1 done | G10a |
| **M11** — at least 3 licence-clean real performances (duple, triple, compound) with bar starts checked by ear | G00 §19.20 | Nobody recorded them (G3-U9) | Required before any onset/beat/tempo/metre/release inference change | **User action** before G10 (§18 D-4) |
| Issue 3 — 8va plays an octave off (30 files, 2,229 notes) | G00 §14 | Playback is out of the scope of G1–G4 | Before the G4f flip (drawn must equal played) | **MX-1** (§18 D-1) |
| Pedal `change` played as no lift | G3 B1, G3-U7 | Out of the scope of G3 | Before the G4f flip (G4 draws `change`, A9) | MX-1 |
| Issue 10 — hymns ignore the key signature (89/100 hymns, 6,119 wrong notes), ties with no stop, carried accidentals | G00 §14 | "a later goal" | Before G7a: hymns are the SATB harmony and melody set | **MX-2** |
| Issues 14, 15 — catalogue bar integrity, contradicting tempo marks | G00 §14 | – | With MX-2 | MX-2 |
| Issues 1, 2, 13, 18 — compound tempo, metre bias, 5/4, releases as note values | G00 §14 | M11-gated | M11 | G10a |
| Issue 17 — AMT invents pedal | G00 §14 | no owner | – | G10a |
| Issues 11, 12 — OMR loses the right hand; 16 bars instead of 8 | G00 §14 | no owner | – | G12 (issue 11 may move to MX if the user prioritises OMR) |
| Issue 16 — grace notes dropped by `toScore`/`parseMusicXML`, so not played | G00 §14 | Playback | S5-play | G11a (G4c draws them) |
| F7 — full-suite baselines predate `audio-score.js` changes | G01 §23 | "user decision" | – | MX-2 (Lead proposes the rebaseline, §18 note) |
| R4 — a `.mid` with fewer than 4 notes does not open, and the message says it has no notes | G02 §25 | Needs a new quantizer | Honest message now; lower floor in G10a | MX-1 (message) / G10a (floor) |
| R5 — G2 page checks (`shadow-legacy`, `app-import-check`, `pitch-layers-check`) and all browser suites not in CI | G02 §25.6 | Need puppeteer and a server | – | **G4f** (nightly Chrome job) |
| `buildXml` + `opts.legacyWriter`; `PPP.legacyImport` | G01 §15.3, G2-D13 | "one release"; the owner lapsed after G2 | Shadow checks prove each can go | **MX-3** after G4f |
| Storing the graph with a song on the server; sharing graphs; syncing songs | G2-D14, G4-U1 | Size strategy; per-device cache only | – | G13 (earlier only if the user asks, §18 D-5) |
| G0 Step 14 — arrangement invariants | G00 §16.6 | never done | – | G7b (definitions), G5 (playability baseline of the legacy arrangers) |
| G4 upstream-defect list ("what engraving exposed") | G04 §26.1, §30.8 | Produced at G4f | – | input to G10a |
| Verovio re-evaluation | G04 §7.3 | Hedge | At G4d: L2 curve/collision metrics or M-H1 placement fail and the cause is PPP layout | G4d → user |
| Drums (arrangement, engraving, playback) | G2-D10, G01 §9.3 | Not in the product vision's piano scope | A user request | not scheduled |

---

## 5. Remaining Goals

### 5.0 Overview

| ID | Name | Purpose (one line) | Depends on | Human gate | AI |
| --- | --- | --- | --- | --- | --- |
| G4b | Layout core + practice map | Deterministic geometry (NotationPlan → EngravedScore) for notes, rests, staves; practice map and highlighter — **Node only, the app loads nothing new** (ratified, §5.1) | G4a | – | no |
| G4c | Beams, stems, tuplets, voices, rests, grace notes + SVG backend | Draw the graph's rhythm notation faithfully; `svg.js` turns EngravedScore into SVG | G4b | – | no |
| G4d | Curves, marks, collisions + page integration | Ties, slurs, every mark, skyline placement; then the app's dev-only renderer switch, so M-H1 is judged in the real page | G4c | **M-H1** (diagnostic) | no |
| G4e | Pages and print | Print layout, page breaking, browser PDF | G4d | – | no |
| G4f | Benchmark completion and flip | Mutations, perf, CI, M-H2, `PPP.renderer = 'engrave'` | G4b–e, MX-1 | **M-H2** + flip approval | no |
| MX-1 | Playback correctness batch | 8va sounds right, pedal `change` lifts, honest MIDI message | D-1 | – | no |
| MX-2 | Catalogue data integrity | Hymns' notes, ties, bars, tempo marks; rebaseline | G4f | – | no |
| MX-3 | Legacy ways back removed | `buildXml`/`legacyWriter`, `legacyImport` | G4f | – | no |
| G5 | Playability and fingering | Can a human play it, with which fingers, where does it strain | G4f | H-56 (shared with G6) | no (DP) |
| G6 | Difficulty | How hard, where, and why — on a scale anchored to the method books | G5 | H-56 | **AI-1** (small learned ranker) |
| G7 | SongGraph + Arrangement Planner | Understand a piece; plan an arrangement for a player | G6, MX-2 | – | no (AI-2 only on evidence) |
| G8 | Arrangement realization (style arranger) | Turn a plan into a playable, engraved piano ScoreGraph | G7 | H-8 (diagnostic) | **AI-3** (after D-3) |
| G9 | Multi-candidate, critics, repair | Generate several, judge, repair, pick; flip the arranger | G8 | **H-9** + flip approval | **AI-4** (preference critic) |
| G10 | Audio → SongGraph, and transcription notation | Songs from audio; piano recordings to better notation (G3 reopened) | G7a, M11, D-4 | **H-10** | **AI-5** (audio models) |
| G11 | Adaptive practice and arrangement | Practice on the graph; a learner model; simplify or advance adaptively | G6, G9 | H-11 (dogfooding) | AI-6 (evidence-gated) |
| G12 | OMR | Printed score → graph, fix what Audiveris breaks, correction UI | G4f, G9 (repair) | H-12 | AI-7 (engine choice) |
| G13 | Productization | Server graph storage and sync, S8 removal, no runtime CDN, ops, business | all | H-13 (release) | – |

The cards below give each Goal's **planning brief**. A Goal's Architect session turns its card into `docs/GOALS/Gxx_*.md` **after inspecting the repository at that time** (§8). The cards for G5 and later are deliberately not specs.

### 5.1 G4 remaining stages (G4b–G4f)

**The contract is G04 §27** (stages), §24 (A1–A48), §19 (B1–B9), §21–§23 (bench, corpus, mutations), §25 (rollout). The Lead does not restate it.

**Phase-boundary change, ratified by the Lead (G4-L1, 2026-09-25).** The G4b implementer kept G4b **geometry-only** (G04 §33.1, G4-B1): no `svg.js`, no app renderer switch, no new `sync` in the page, no browser suites under `renderer='engrave'`. The Lead accepts this. It gives one coherent, Node-testable unit, and it keeps the 19k-line app file out of three stages in a row.

Where the moved responsibilities go:

| Moved from G4b | Now in | Why there |
| --- | --- | --- |
| `svg.js` — the SVG backend (`<symbol>`/`<use>`, the DOM contract of §16.4 as attributes), B9 (SVG ≤ 0.5 × baseline) | **G4c** | Beams, flags and tuplet brackets are the first objects whose drawing needs VexFlow's drawing path. Building the backend with them avoids a second pass. It is still Node-testable (a deterministic SVG string). |
| App integration behind a **dev-only** switch: ScoreView `renderer` prop, `?renderer=engrave`, `PPP.strictEngrave`, per-song fallback counter (§16.7), the G4b highlighter as the new `sync`, `drawKey` by content hash, `agree.ok` required (not `PROJECTION_DISAGREES`), vendored VexFlow and `engrave/*.js` served cacheably, `resolve` cost on reload, the `with-port.js` gaps (`createBrowserContext`, the page's own 8788 health check) | **G4d-2** | M-H1 must be judged in the real PPP page (the G3-U8/U10 lesson). Before G4d there is nothing complete enough to show. |
| A30 (all browser suites under both renderers), A32 browser part, A33, page-level A35–A37 (including the plan's 65 ms at 4× CPU: idle or worker slicing) | A32 and A33 in **G4d-2**; the rest in **G4f** | These need the page integration. |

G4b's acceptance is judged on what it built: A14, A17–A19 (basic), A23, A24, A27–A29, B1–B7 as Node/Chrome measurements, A31 through its Node proxy.

| Stage | Scope (G04 §27 + the Lead's refinements) |
| --- | --- |
| **G4b** | **CLOSED** — PR #12 `62ede61` (G04 §33–§33.17). The six G4a MINORs; `metrics`, `space`, `breaks`, `skyline`, `canon`, `layout`, `practice`; L2 bench; committed layout hashes; browser parity; perf; after the review's Fixer, an A29 ban that can fail, a layout mutation test, and ratchets on other-voice collisions. |
| **G4c** | **CLOSED** — PR #15 `e3c8c5a` (G04 §34–§34.19). Beams, stems, tuplets, voices, rests, grace notes, `svg.js` + B9, the G4b backlog, both collision ratchets at 0; after the review's Fixer, shared flagged unisons and named metrics for merges, middle-line stems, rest positions, hook sides and tuplet hooks. G4-C4 ratified as G4-L2. |
| **G4d** | **Three merge points** (G4-L3 splits G4d-1 so each review is of a manageable size). **G4d-1a** (Node; **CLOSED**, PR #17 `b4fe019`, with G4-L4 and G4-L5): §13 curves (ties, slurs, glissando), `place()` over skylines, marks attached to notes (§10.2 priorities 3–7: articulations, ornaments, fermata, tremolo, fingering, arpeggio, notehead shapes, cautionary accidentals), the §18.3 text-metrics table; A5–A7, A22, A20 for its objects, A12 percussion noteheads; E08–E11, E15, E23, E27, E31–E33, E40; M8, M12, M14, M15, M23. **G4d-1b** (Node; **CLOSED**, PR #19 `a6e1a75`): marks attached to systems (priorities 8–11: dynamics, hairpins, pedal, ottava, volta, chord names, tempo, rehearsal, jumps, words, lyrics), §15.3 vertical spacing, §15.4 courtesy signs; A8–A10, A12 lyrics, A20, A25; E16–E22, E24, E25, E35; M13, M19, M20. **Carry-overs from the G4c review** (the Lead assigned them; all to G4d-1a except B9, which G4d-1b re-measures; plus an augmented-unison case in E12, because the Lead's alteration mutation changed no committed input): ledger lines for rests moved off the staff (15 whole/half rests in 4 files float without one, so whole and half look alike); tuplet numbers more than 1.5 sp from their beam (16 of 223, Czerny 849) — place them inside the staff where it is free; re-measure **B9** once curves and marks are drawn (the reviewer estimates ≈0.32 for sonatina/020, still ≤ 0.5); **bump `plan/1` and `engr/1`** — G4c changed both outputs without a bump, and from G4d-1 every output change bumps its version so that G4d-2's caches and `data-plan` can tell old from new. **G4d-2** (page): the app integration listed above, still defaulting to `'legacy'`, so nothing a user sees changes; A32, A33, the browser suites that can pass by then. **M-H1 watch list** (from the G4d-1a review and re-check): fingering beside the stem at the start of an up-stem beam group; one slur end lifted 7 sp (czerny849/013); short half-slurs after a system break; two-note slurs that look like hooks; per-piece slur hits; (from G4d-1b) a tempo word in its own direction stacked over the metronome mark (czerny599/054), ottava labels drawn as text (the pinned Bravura has no ottava glyphs), octave-line and tempo rows far above long phrase slurs, no melisma extender lines. Then **M-H1**, rendered through the real page, and the **Verovio trigger check** (G04 §7.3). If the trigger fires: stop, spike NotationPlan → MEI → Verovio on the same R corpus and L2, and put it to the user before G4e (§16). |
| G4e | Unchanged (print). If print slips, G4f may flip the screen renderer with the print command hidden (the rollback for print is independent, G04 §27). |
| **G4f** | Two merge points. **G4f-1 (engineering evidence base) — CLOSED**, PR #28 `2c6d108` (G04 §40–§40.11): mutation suite completed to 25/25 (M1–M25, each caught by a named metric, N1/N2 byte-identical controls); `legacy-geometry.js` built and run over the full R corpus for A43 (G4 ≥ legacy in every category — confirmed, including the tuplet-number category, where the 106/84/129 legacy over-counts were confirmed against raw MusicXML `show-number="none"` and the legacy source never reading it); perf under CPU 4× throttle (B2, B6 within budget); the CI gate/nightly split (gate stays Node-only and ≤90s; nightly carries the full mutation suite, the A43 comparison and the three browser/puppeteer tools with `continue-on-error` for their first CI run); A46 (G3 independence), A47 (import robustness, 0 exceptions/fallbacks), A48 (round-trip, already covered by `test:scoregraph`) all confirmed. Review PASS (0 BLOCKER/MAJOR, 2 MINOR); the Lead fixed the one substantive MINOR directly (CI readiness loop now fails its own step on a server-boot timeout, `5079d64`) rather than opening a Fixer round.<br>- **G4f-2 (the Lead) — next**: **R5**, a nightly CI job with Chrome that runs the page tools (G2 shadow/app-import/pitch-layers; G4 `a48-coverage`, `u1-paths`, `legacy-parity`) and every browser suite **separately**, not `&&`-chained (TD8), if not already covered by G4f-1's nightly wiring; A30 under both renderers; then **M-H2** (pass/fail human review) and, on approval, the flip.<br>**The flip requires MX-1 merged** (done: PR #13 `e37d37a`) (drawn = played for 8va and pedal `change`). 8va display is settled by D-1 (§18): the plan's written = sounding − shift is correct. |

**Not yet (whole of G4):** no fingering generation, no playback changes (MX-1 is its own batch), no G3 flag changes, no schema change, no VexFlow upgrade.

### 5.2 Maintenance lane — MX-1, MX-2, MX-3

Small, deterministic fixes with a clear right answer. They are not Goals; each is one PR from its **own worktree** (`git worktree add -b mx-N D:/PPP-mx origin/main`). The Lead schedules them between milestones and never inside an active milestone's worktree.

| | MX-1 Playback correctness | MX-2 Catalogue data integrity | MX-3 Legacy ways back |
| --- | --- | --- | --- |
| Purpose | Drawn = played = judged for 8va and pedal `change`; stop saying a `.mid` has no notes | The catalogue plays and notates what its editions say | Delete switches whose shadow checks prove they are dead |
| Why now | The G4f flip cannot ship a renderer that draws 8va where the app does not play it (G04 §32.12.10) | Hymns are G7a's SATB harmony and melody set, and G6 uses the catalogue | Each has been past its "one release" since G1/G2 |
| Slot | **CLOSED** — PR #13 `e37d37a` (2026-09-25) | After G4f, before G5 | After G4f |
| Scope | Issue 3 in `Score.finalize` (App 3593–3606 adds the shift to what sounds and draws the file's pitch — right only if the file held the written pitch) and the matching un-shift in `legacy.fromScore` (`legacy-score.js` 601–613); pedal `change` = damper lift then re-press (`PianoScore`, App 2681); R4 message; an audit of every 8va file's encoding. Brief in §15 | Fix `catalog/hymns/abc-to-musicxml.js` (key signature, tie stops, carried accidentals), regenerate the hymns, fix the issue-14/15 files with evidence — including `in-the-bleak-midwinter.musicxml`, whose last bar holds the rest of the piece (175/4; G04 §33.15) — and any 8va file MX-1's audit finds encoded as written pitch; **rebaseline the G0 suites** (including F7) with reasons | Remove `buildXml` + `opts.legacyWriter`, and `PPP.legacyImport` (the import door only — S4 paths still call `parseMusicXML`) |
| Carry-overs | – | From MX-1 (review 2026-09-25): (a) migrate songs saved between `72549cb` and MX-1 (an 8va plays an octave low), keyed on the finalize-rule marker MX-1 stamps (MX1-D3, review M1) — 1 of 110 production shares has an octave line, song slots are browser-local; (b) MIDI out: a same-point pedal `stop` + `start` sends only CC64 127 (M4); (c) an octave line naming no staff shifts bass notes but brackets only the treble (E18 bar 3), and the legacy renderer draws a pedal change as a lone ∗ (M5; the legacy renderer retires at G4f, so fix only if it ships before); (d) rebaseline the G0 bench's model of the pre-MX-1 app (`ottava="app"`, `octave_shift_playback`, C10/C11, r20, `golden.py` 237/285; MX1-D7) | – |
| Acceptance | Page check: the app's sounding MIDI = the graph's concert pitch on all 30 8va files; pedal `change` lifts in `PianoScore` events; `ab` core/smoke identical (the bench excludes 8va truth, G0-D10) | Hymns: key/spelling metrics enabled; `lint-corpus` 0 errors; `update-baseline` with reason; hold-out untouched | `shadow-legacy --check` and `sg-roundtrip` unchanged; the G0 gate is green |
| Rollback | Revert the PR | Revert the PR plus the baseline | Revert the PR |
| Not | No playback migration to the graph (that is G11a) | No new converter; no changes to the method books beyond the listed defects | No `parseMusicXML` removal (S4 is not done) |

### 5.3 G5 — Playability and fingering

| | |
| --- | --- |
| Purpose | A deterministic answer to "can a human play this, with which hand and fingers, and where does it strain". Every later Goal judges scores with it. |
| Why now | Arrangement cannot be judged without it (G7–G9), and difficulty is built from its features (G6). The G4 flip lets generated fingering be drawn (G4 draws `Head.fingering`, A7). The legacy arrangers can already produce left-hand chords wider than an octave, and nothing detects it. |
| Depends on | G1 (limbs RH/LH inherited head → voice → staff, G1-D12; `time.js`), G4f (display). **Does not depend on G3a**: hands come from the graph's staves and limbs. |
| Scope | **(a) Playability analyzer**: a pure-function UMD module outside the app file (like `engrave/`) over the graph, with a hand profile (small/medium/large). Hard violations: span per hand beyond reach, more than 5 simultaneous keys in one hand, impossible lateral velocity for the time available, holds that cannot be released or re-struck. Soft strain: stretch, jumps, crossings, repeated-note speed, black-key thumb, polyphony per hand. Output: a PlayabilityReport per event and measure. **(b) Fingering**: port and extend the legacy `Fingering` DP (Parncutt spans, keyboard distance, second-order DP) to the graph and to both hands jointly. Keep its path cost as strain. Printed fingering is fixed. Write the result as `Head.fingering` with provenance `inferred` — never over `imported` or `edited` (G3-D4). **(c) Integration**: the hand guide reads the G5 plan through `link`; the score shows generated fingering behind a config (G4 `fingering`). **(d) Measurement**: `pl.*` metrics over the R corpus, the printed-fingering set (14,305 heads in 84 files, licence-clean, no hold-out) and generated arrangements. **The playability baseline of all three legacy arrangers** — this closes half of G0 Step 14. |
| Non-goals | No difficulty score (G6). No simplification or repair (G9). No changes to notes or hands. No hand inference for recordings (G10a). No learned fingering model. No per-user hand calibration UI (G11). |
| Phases | G5a analyzer + metrics + legacy-arranger baseline (no UI) → G5b fingering DP on the graph, measured against printed fingering and the legacy model → G5c app integration behind a switch. |
| Acceptance (targets fixed in the G05 spec after a Step-0 baseline) | Hard-violation false positives on the clean R corpus ≈ 0: published pieces are playable, so every hit is either a real defect or a named exception. Planted unplayable fixtures are all caught. Fingering beats the legacy model on printed-finger agreement per hand on the same set, and keeps its 17 book cases. Deterministic. Off-path identical. |
| Regression | G0 gate, `test:scoregraph`, `test:engrave`, new `test:playability` in CI, mutation suite (planted span, velocity, finger defects each caught; dead mutation fails), `fingering.test.js` under both engines. |
| Performance | Analyzer + fingering for the longest corpus piece (sonatina/020, 1,776 notes): ≤ 150 ms in Node; in the page, idle-sliced with no long task; re-solving one passage ≤ 20 ms (G9's repair loop needs this). |
| Human review | H-56, shared with G6 (§10): about 10 fingering passages. |
| Rollback | `PPP.fingering = 'legacy'`; the fingering display off by config. |
| Not yet | Nothing that edits notes to make them playable (G9). No ML. |

### 5.4 G6 — Difficulty

| | |
| --- | --- |
| Purpose | One difficulty scale that says how hard a score is, where, and why, and that later Goals use as a **target** (G7–G9 plan to a level; G11 adapts around it). |
| Why now | Needs G5's features. Required before the planner can budget difficulty. |
| Depends on | G5; MX-2 (clean catalogue). |
| Scope | Features: G5 strain and violations, rhythm complexity (syncopation, tuplets, note-value variety), density per hand at tempo, hand independence and polyphony, accidental and key load, range, pedal, length. **Model (AI-1)**: a small interpretable ranker (ordinal or pairwise logistic) trained on the method-book progression — `course.js` PATH (Beyer → Czerny 599 with Hanon and Burgmüller → Czerny 849 with the Sonatinas → Czerny 299) plus the order within each book, with quarantined and hold-out files excluded. Weights committed as versioned JSON; deterministic inference. Output: a level (anchored to named method-book points), a per-measure hotspot map, and the top reasons. It replaces `Score.deriveSections`' `hard` flags and `Coach.structural` behind a switch. |
| Non-goals | No per-player measured difficulty (that is `Learning` today and G11 later). No arrangement. No change to how the app practises. |
| Phases | G6a features + dataset + model with leave-one-book-out evaluation (Node) → G6b app integration (Analysis screen, Coach context) behind a switch. |
| Acceptance | Leave-one-book-out pairwise accuracy beats the legacy heuristic by a margin fixed in the G06 spec. Metamorphic tests are 100 %: a faster tempo is not easier; fewer notes is not harder; transposing to a key with more accidentals is not easier. Stable under no-op edits. Hold-out files never used for training. |
| Regression | As G5, plus `coach.test.js` and `musicxml.test.js` section snapshots under both switches. |
| Performance | ≤ 20 ms per piece given the G5 report. |
| Human review | H-56: about 10 pairs of "which is harder". |
| Rollback | `PPP.difficulty = 'legacy'`. |
| Not yet | No learner model. No LLM. |

### 5.5 G7 — SongGraph and Arrangement Planner

| | |
| --- | --- |
| Purpose | **G7a** makes the SongGraph real, from symbolic input: what the piece is. **G7b** plans an arrangement for a player: what to keep, where, at what level and in which style. It does not write notes. |
| Why now | The arranger needs musical understanding, and the old roadmap had SongGraph arrive only with audio (G10). **Change: the SongGraph schema and symbolic analysis come first**, so arrangement can be built and judged on clean symbolic input. Audio later becomes one more producer of the same SongGraph. |
| Depends on | G6 (the level scale), G5 (constraints), MX-2 (hymns), G1 §10.3 (ScoreRef, ScoreSpan, fingerprint, resolveSpan). |
| Scope | **G7a**: `songgraph_version` 1. Key regions (reuse G3's pure region code where it fits), harmony per beat window (printed chord symbols are ground truth where present — 550 in the corpus), melody and bass identification with confidence, sections and repetition, phrases and cadences, voice roles, an energy/density curve. Freshness through `scoreRef.fp` and op `idMap`. Promotion only through `ops.addSection`/`addPhrase`. **G7b**: an ArrangementRequest (target level, style, hand profile, sections, key) → an ArrangementPlan per section (melody placement and register, texture class, density and difficulty budget, voicing constraints), found by deterministic search under G5/G6 constraints, with explanations. **Arrangement invariants** (G0 Step 14): melody preserved, harmony covered, bars intact, range, level. |
| Non-goals | No note generation (G8). No audio (G10). No LLM in analysis unless G7a's accuracy gate fails (AI-2, evidence-gated). No drums. |
| Acceptance | G7a: harmony agreement with printed chord symbols and hymn SATB ≥ targets set after a baseline; melody identification on hymns (soprano) and the catalogue ≥ target; deterministic; `resolveSpan` round trips. G7b: every plan satisfies the invariants and the G6 level budget on the evaluation set. |
| Regression | New `test:songgraph`, the arrangement-invariant checks, mutations (a planted wrong key, a melody swap, an off-by-one span each caught). |
| Performance | Analysis ≤ 500 ms for the longest corpus piece in Node; planning ≤ 200 ms. |
| Human review | None: the planner is judged through G8 and G9 outputs. |
| Rollback | Nothing user-facing. |
| Not yet | No UI beyond a debug view. |

### 5.6 G8 — Arrangement realization (style arranger)

| | |
| --- | --- |
| Purpose | Turn an ArrangementPlan into a two-staff piano ScoreGraph that is playable by construction, on the target level, and engraved by G4. |
| Why now | G7 gives the plan; G5, G6 and G4 give the verifiers and the renderer. |
| Depends on | G7, G5, G6, G4. **D-3** before its model phase. |
| Scope | **v1 deterministic realizers**: a pattern library of textures (block chords, broken chords/Alberti, ballad arpeggio, hymn 4-part, simple pop comping, waltz), voice leading, limbs and fingering from G5. Output provenance `generated`, source kind `generator`. **S6**: the arranger reads and writes graphs; `arrange_score.py`'s harmony DP either becomes a G7 analyzer or is retired; the wire-score JSON goes. **S4 for arrangement**: the review screen adopts the arranger's graph instead of re-parsing XML. **v2 (AI-3, after D-3)**: a model proposes realizations (voicings, figuration, fills) and the deterministic verifiers accept or reject. |
| Non-goals | No multi-candidate search or learned critic (G9). No audio input. No adaptive variants (G11). |
| Acceptance | 0 G5 hard violations on every output; G6 level within ±1 of target; melody preserved; harmony agreement with the SongGraph; engraving L1 silent 0 and L2 hard 0 on the outputs; better than all three legacy engines on these metrics on the same inputs. |
| Regression | `test:arranger` (replaced or extended), new `test:arrange`, golden arrangements (deterministic, SERIALIZATION_ONLY rules), mutations. |
| Performance | v1 ≤ 1 s per piece; the v2 model's latency and cost budget is set with D-3. |
| Human review | H-8, diagnostic: about 8 inputs × 2 levels, blind against the legacy arranger. |
| Rollback | `PPP.arranger = 'legacy'`. |
| Not yet | No production flip — that is G9's. |

### 5.7 G9 — Multi-candidate, critics and repair

| | |
| --- | --- |
| Purpose | Generate several arrangements, judge them with deterministic and learned critics, repair local faults, pick one, and explain why. Then flip the arranger. |
| Why now | One realization per request cannot beat the legacy engines consistently. Human preference data from H-8 exists by now. |
| Depends on | G8, G5, G6, G4. |
| Scope | N candidates (plan variants × realizer variants). **Deterministic critics**: playability, level, melody preservation, harmony fidelity, voice-leading smells, register and density, engraving readability (G4 L2 costs). **Learned preference critic (AI-4)**: trained only on committed blind A/B judgments (H-8, H-9 and opt-in in-app choices). **Repair**: graph → graph ops with a critic and per-measure rollback, like G3's critic (G3-D5), provenance `repaired`. Selection with an explanation. |
| Non-goals | No audio (G10). No learner adaptation (G11). The learned critic never overrides a hard constraint. |
| Acceptance | Everything G8 requires on every output; repair never adds a hard violation; the learned critic agrees with held-out human choices above chance by a margin set in the spec; **H-9 passes**; the user approves the flip. |
| Performance | N = 8 end to end ≤ 10 s on the helper or server, with progress in the UI and results cached by (SongGraph fingerprint, request). |
| Human review | **H-9** (pass/fail, blind, about 16 pieces). |
| Rollback | `PPP.arranger = 'legacy'`, kept for one release. |
| Not yet | No adaptive difficulty steps (G11). |

### 5.8 G10 — Audio → SongGraph, and transcription notation

| | |
| --- | --- |
| Purpose | **G10a**: piano recordings → correct notation. This reopens G3a and G3b, fixes issues 1, 2, 13, 17 and 18, and completes S4 for recordings. **G10b**: song audio (voice and band) → a lead-sheet ScoreGraph (melody, chords, bars) plus a SongGraph over it, so G7–G9 can arrange it. |
| Why now | Last of the inputs. **Deliberately not coupled to engraving or arrangement**: it produces the same ScoreGraph and SongGraph the symbolic path does. It needs the G4 flip (G3a's beams must be visible for its re-review) and G7a (the SongGraph schema). |
| Depends on | **M11** (user action), **D-4** (audio data licensing and model hosting), G7a, the G4f flip. |
| Scope | G10a: beat, metre and tempo inference with the real recordings; R-reg; hands and voices (G3a H1/H2 fixes); AMT pedal; the `.mid` floor (R4); the recording path adopts `built.graph` (S4); G3 switches on only by gates. G10b: pinned pretrained audio models (beat/downbeat, chords, melody extraction, source separation where needed), a licence-clean evaluation set with aligned truth. |
| Non-goals | No arrangement changes. No OMR. No copyrighted audio in the repository — ever. |
| Acceptance | G10a: G0 usable-rate Δ on core, robust, hold-out and **recorded** tiers, reported, with no critical-gate regression; G3 gates per G03; **H-10** passes (the A36 rules, the PPP renderer, `CLEAN_INPUT`/`UPSTREAM_ERROR` reported separately). G10b: SongGraph accuracy on the licensed set ≥ targets in the spec. |
| Performance | Set with D-4 (hosting). As a guide, ≤ 1× real time on the helper's GPU. |
| Human review | **H-10**. |
| Rollback | Each switch (`professional`, `g3b`, the audio path) independently off. |
| Not yet | Nothing M11-gated before M11 exists. |

**Ordering note.** G10 and G11 do not depend on each other. The default order is G10 → G11, as in the old roadmap. **If at G9's closeout M11 or D-4 is not ready, G11 goes first rather than the project idling.**

### 5.9 G11 — Adaptive practice and arrangement

| | |
| --- | --- |
| Purpose | Close the loop: practise on the graph, model the learner, and adapt both the practice plan and the arrangement (easier or harder variants of the hard passages). |
| Depends on | G6, G9. **G11a is S5-play**: nothing else needs it, so it lives here. |
| Scope | **G11a practice on the graph**: a PlaybackPlan from `time.js` (repeats by the app's rule plus D.S., D.C. and Fine, the tempo map, pedal including `change`, ottava, grace notes), the practice matcher keyed by graph IDs through `link`, parity with the legacy player (identical events where the legacy player was right, and a documented list where it was wrong), behind a switch. **G11b learner model and adaptation**: per-note and per-measure error and timing statistics keyed by graph and SongGraph IDs (extending `Learning`/`Memory`); recommendations (loops, tempo ramps, hands separately) replace the Coach heuristics where they measurably do better; adaptive arrangement asks G9 for a variant at level ± 1 for a section and splices it in with continuity; progress tracking. |
| Non-goals | No new input paths. No payments. The LLM coach keeps its current guardrails (`Coach.validate`); it never writes notes. |
| Acceptance | G11a: every browser practice suite passes under both switches; event parity as above; no long task over 50 ms; matcher latency unchanged. G11b: measured on the user's dogfooding and on synthetic learners — thresholds in the spec. |
| Human review | **H-11**: the user practises 2–3 pieces with it for about a week. |
| Rollback | `PPP.practice = 'legacy'`. The adaptive features are off by default until H-11. |
| Not yet | ML learner models only when the data supports them (AI-6). |

### 5.10 G12 — OMR

| | |
| --- | --- |
| Purpose | A printed score becomes a correct graph, or the user can see and fix exactly where it is not. |
| Depends on | G4f (review in the PPP renderer); G9's repair ops and notation checks. Independent of G10 and G11. **It could be pulled earlier if the product wants it** (a user decision). |
| Scope | S4 for OMR (`PdfLayer.apply` onto the graph, so Audiveris' beams survive); issue 11 (two single-staff parts → a grand staff); issue 12 (bar count); suspect-bar flags with measured recall; a correction UI on the engrave renderer; the engine (Audiveris vs a learned OMR) chosen by evidence (AI-7); a larger licence-clean `omr-live` suite. |
| Acceptance | `omr-live` usable-rate Δ and flag recall against targets in the spec; H-12. |
| Rollback | `PPP.omr` switch. |

### 5.11 G13 — Productization

| | |
| --- | --- |
| Purpose | Make it a product people can rely on across devices. |
| Scope | Graph stored and synced on the server (songs as well as progress), sharing graphs; S8 final removals (the legacy Score, `packScore`, the remaining `parseMusicXML`, the legacy renderer if still present); runtime CDN dependencies vendored or built (React, Babel, pdf.js, tfjs, fonts); tablet and mobile performance; deploy automation and monitoring (engrave fallback counters, errors); i18n completeness; licence and copyright notices; accounts and business items as the user decides (D-6). |
| Acceptance | Release checklist; H-13 (an end-to-end walkthrough). |

**Operations are not scheduled here.** Hosting, database and deploy incidents are handled when they happen, by the user where they cost money (§18 D-0).

### 5.12 Explicitly not scheduled

- Drums and other instruments (G2-D10).
- Tablature and modern notation (G04 §3).
- A VexFlow 5 upgrade (G04 R3).
- A server-side engraving engine (G4-U3).

---

## 6. Dependency graph

```mermaid
graph TD
  G4a[G4a done] --> G4b --> G4c --> G4d --> G4e --> G4f
  D1{{D-1 8va}} --> MX1[MX-1 playback fixes]
  G4b --> MX1 --> G4f
  G4f --> MX2[MX-2 catalogue data] & MX3[MX-3 legacy removal] & G5
  G5 --> G6
  MX2 --> G6
  G6 --> G7a[G7a SongGraph core] --> G7b[G7b Planner] --> G8
  G5 --> G8
  D3{{D-3 model strategy}} -.-> G8
  G8 --> G9
  G7a --> G10
  G4f --> G10
  M11{{M11 recordings + D-4}} --> G10
  G6 --> G11
  G9 --> G11
  G4f --> G12
  G9 -. repair ops .-> G12
  G9 & G10 & G11 & G12 --> G13
```

**Critical path:** G4b → G4c → G4d → G4e → G4f → G5 → G6 → G7 → G8 → G9 → (G10 ∥ G11) → G12 → G13.

**Off the critical path:**
- MX-1: after G4b, before G4f.
- MX-2 and MX-3: after G4f.
- G10's prerequisites (M11, D-4) can be gathered at any time by the user.

---

## 7. Recommended implementation order

1. **G4b** — geometry-only as built (ratified, §5.1); under independent review.
2. **MX-1** — approved (D-1 = YES), right after G4b; may run beside G4c in its own worktree.
3. **G4c (+ `svg.js`) → G4d (G4d-1a note marks, G4d-1b system marks, G4d-2 page integration, M-H1) → G4e → G4f (M-H2, flip)**.
4. **MX-2, MX-3** — clean data and dead switches before any new consumer is built on them.
5. **G5 → G6** — the verifiers and the level scale; one shared human review, H-56.
6. **G7 (a, b) → G8 → G9** — arrangement on clean symbolic input; H-8, then H-9 and the flip.
7. **G10 or G11** — whichever has its prerequisites (§5.8 ordering note), then the other.
8. **G12**, then **G13**.

**Why this order.**
- Every arrangement decision must be judged by playability (G5) and difficulty (G6), and must be seen through the new renderer (G4).
- Audio and OMR are front doors that feed the same graphs. They can come last without blocking anything.
- The adaptive loop needs both a level scale and a generator.

**Changes from the old roadmap (G0 … G13), with evidence.**

| # | Change | Evidence |
| --- | --- | --- |
| 1 | **SongGraph is split out of audio.** G7a builds the SongGraph schema and analysis from symbolic input; G10 becomes one more producer of it. | The planner needs a SongGraph. Arrangement must be judged on clean input (A36: 10 of 20 excerpts contaminated by upstream errors). G01 §10 already defines the SongGraph boundary on ScoreGraph IDs. |
| 2 | **G3's reopening is folded into G10a** (G3a H1/H2 + G3b + auto-8va + `pedalJoin`). | G3a needs the G4 flip to show its beams (G3-U8/U10); G3b needs M11, which G10 needs anyway. One human review instead of two. |
| 3 | **Playback and practice on the graph (S5-play) moves to G11a.** The two playback bugs that make drawing and playing disagree move up to **MX-1**, before the G4 flip. | Nothing before G11 needs the player on the graph (`toScore` feeds it); G11's learner model does. Issue 3 and pedal `change` would otherwise ship as "drawn ≠ played" at the flip. |
| 4 | **S4 gets owners**: arrangement → G8, recording → G10, OMR → G12. | S4 had no owner (G01 §15.2 vs G02 §24.4 vs G03). |
| 5 | **Catalogue data fix (MX-2) before G6/G7.** | Issue 10: 89 of 100 hymns play wrong notes, and hymns are the SATB set for harmony and melody. |
| 6 | **G10 and G11 are independent**; the order is decided by prerequisite readiness at G9's close. | Neither consumes the other's output. |
| 7 | **G5 measures the legacy arrangers first.** | `arrange_score.py` has no hand-span check. This gives G8/G9 a real baseline. |
| 8 | **Keep the app file out of the engine stages: G4b and G4c are Node-only, page integration is one merge point (G4d-2) just before M-H1; G4f takes R5 (nightly page checks).** (Superseded the first edition's "G4b in two merge points" after the implementer built G4b geometry-only — G4-L1.) | G4a, one large stage, needed four independent reviews and two fix rounds. Browser suites and page tools are the only evidence for several acceptance criteria and are not in CI. |
| 9 | **Human reviews are consolidated** (G5 + G6 share H-56; G3 re-review folds into H-10). | The user asked for milestone-only review. |

Kept as it was: G5 before G6 (difficulty uses playability); both before arrangement; G12 late (independent; can be pulled earlier by the user).

---

## 8. Phase boundaries

**Lifecycle of a Goal.**

```
Architect (spec in docs/GOALS/, from this roadmap's card + a fresh repository inspection; user decisions listed)
  → Stage 1..n   each: implement → CI gate → one independent review → Fixer only for BLOCKER/MAJOR → merge (squash)
  → Flip         only for user-visible change: human gate + user approval; the old path stays one release
  → Closeout     docs PR: spec record, CURRENT_STATE, DECISIONS, this roadmap
```

**A stage:**
- is one PR a single reviewer can review in one session;
- merges with the new behaviour switched **off**, and switched-off output is **byte-identical to `main`**;
- never mixes two Goals;
- leaves `main` releasable.

**Workflow roles:**
- **One writer per worktree.** The implementer owns the Goal's worktree. MX batches use their own worktrees. The Lead writes only in `D:/PPP-lead`.
- **Review policy:**
  - one independent review per merge point, from a `git archive`/`git clone --shared` snapshot, never from the shared worktree;
  - BLOCKER and MAJOR go to a Fixer; MINOR goes into the next stage's backlog;
  - a second review happens only if a BLOCKER was found, and then only on the fixed items.
  - **No review loops.**
- **Lead after every merge:** update §14/§15/§19, move MINORs into the next card, choose the next task immediately.
- Merge convention: `gh pr merge N --squash --match-head-commit <sha>`. The branch is kept. Deploys are manual (Render); a merge does not deploy.
- **`main` has no required status checks, so `gh pr merge` does not wait for or respect a failed gate.** Read the gate's result as a separate step, and merge only on `pass`. On 2026-09-26 the docs-only closeout PR #20 was merged with a failed gate. The failure was a test-infrastructure race, not the change: G3 test files regenerate `tests/bench/out/g3/jobs-*.jsonl` concurrently on a fresh checkout. It is fixed by PR #21 (`84abe80`).

**Git safety.**
- Never touch `D:/PPP` or its local `main` `d82bb71`.
- Never `git add .` or `-A`; stage by explicit path.
- Never reset, clean or stash another session's uncommitted work.
- New goal branches are created with `--no-track` so a bare push cannot aim at `main`.

---

## 9. Acceptance gates

**Every merge to `main`, whatever the Goal:**

1. The CI gate (`.github/workflows/bench.yml`) is green: G0 unit, golden, correctness, smoke/core/robust/replay-public run + check, `test:scoregraph`, `sg-roundtrip`, `test:engrave`, `bench.js check --suite r|e|x`, transcription-core, arranger — plus every new suite the Goal adds.
2. **Off-path identity**: with the Goal's switch off, output is byte-identical to `main` (`ab` identical, `legacy-parity`, page snapshots).
3. No G0 critical-gate regression, unless the Goal targets that gate and reports the core/robust/hold-out usable-rate Δ with a reason.
4. **Every new check is proven by a mutation** it catches (a dead mutation — byte-identical output — is a failure; anchors are CRLF-normalised; no-op controls are byte-identical).
5. Determinism: three runs, reversed input order, Windows and Linux.
6. Hold-out and copyright rules.
7. Browser evidence comes from the worktree's own server (`tests/engrave/tools/with-port.js`, `PPP_PORT`), and any failure is attributed against a base snapshot.
8. Docs updated (spec record, CURRENT_STATE, DECISIONS, this roadmap).

**Per-Goal acceptance** is in each card (§5) and becomes numbered criteria in its spec.

---

## 10. Human-review gates

Only at milestones. Always blind:
- opaque labels, a new seed, the key kept separately (G3-F5);
- `CLEAN_INPUT` / `UPSTREAM_ERROR` split up front;
- results committed as JSON; the single-reviewer limitation stated.

| Gate | When | Set | Time | Rule |
| --- | --- | --- | --- | --- |
| **M-H1** | End of G4d | 16 excerpts × 8 bars, legacy vs G4 (G04 §22.4) | ~45 min | Diagnostic: tunes spacing α and placement constants; the Verovio trigger |
| **M-H2** | G4f | 16 excerpts, new seed | ~45 min | Pass: G4 ≥ legacy on ≥ 14/16; 0 "looks wrong" only in G4; yes+fix ≥ legacy (G04 §22.4). Then **flip approval** |
| **H-56** | End of G6 | ~10 fingering passages + ~10 "which is harder" pairs | ~30 min | Diagnostic for fingering (no passage rated absurd); difficulty pairs agreement reported against the model |
| **H-8** | End of G8 | ~8 inputs × 2 levels, blind vs the legacy arranger | ~45 min | Diagnostic; the judgments become AI-4 training data |
| **H-9** | G9 | ~16 blind comparisons | ~60 min | Pass rule set in the G09 spec (starting point: new ≥ legacy on ≥ 13/16, zero rated unplayable). Then **flip approval** |
| **H-10** | G10 | A36-style set (G3a/G3b + audio lead sheets) | ~60 min | The A36 rules (G03 §21) in the PPP renderer |
| **H-11** | G11 | The user practises 2–3 pieces for about a week | spread | Go/no-go plus telemetry thresholds in the spec |
| **H-12** | G12 | ~8 scanned pages | ~30 min | In the spec |
| **H-13** | Release | End-to-end walkthrough | ~60 min | Release checklist |

About nine sittings for the rest of the project. **No human review for G4b, G4c, G4e, G7, the MX batches**, or any stage whose acceptance is structural.

---

## 11. Automation / test strategy

The order of evidence: **automatic tests → mutation → metrics and gates → deterministic snapshots → milestone human review.**

| Layer | What | Where it runs |
| --- | --- | --- |
| Static | Lint, corpus lint, bans (no DOM measurement in layout — G04 A29; `engrave/` never calls `professionalize` — A46), provenance | CI |
| Unit / property | `node --test` per module; Python `unittest` for the bench; property tests (round trips, idempotence, monotonicity) | CI |
| Mutation | Source-anchor edits in a copy; each must fail a named metric (G0 `mutation-check`, engrave ledger/source mutations, and one per new Goal) | CI (fast set), nightly (full) |
| Metrics and gates | G0 usable-rate gates; engrave L1/L2 (`bench.js`); new per Goal: `pl.*` (G5), `df.*` (G6), `sg.*` (G7a), `arr.*` (G8/G9), `omr.*` (G12) — each with a committed baseline and `check` exit codes | CI gate; full suites nightly |
| Snapshots | Deterministic JSON goldens with change classes (`SERIALIZATION_ONLY` / geometry-only / semantic), never pixel snapshots in CI | CI |
| Page checks | puppeteer tools and the 26 browser suites against the worktree's own server | local now; **nightly CI from G4f** (TD8) |
| Performance | perf tools with CPU throttling; CI uses deterministic proxies (elements touched, bytes, object counts) | local, recorded in the spec |
| Human | §10 | milestones |

**Review depth by risk** (user decision, 2026-09-26): the full cycle (implementer → one independent review → Fixer for BLOCKER/MAJOR → Lead re-check → merge) stays mandatory for anything touching the app file or `server.js`, anything that could reach the live deploy, or anything hard to roll back. For docs-only, test/tooling-only, or Node-only engine code the app does not yet load, the Lead may read the diff directly and skip or shrink the independent-review step, at its own judgment, without asking each time.

**Known environment traps** (details in CURRENT_STATE and the Goal records):
- Port 8777 is usually another tree's server.
- `npm test` is `&&`-chained, so one failure hides the rest.
- CRLF breaks anchors, and `git hash-object` normalises line endings — use `cmp`.
- On cp949, Python `print` crashes on non-ASCII.
- The root `.gitignore` has `tools/`, so `git add -f` tool files by explicit path.
- `update-baseline` reuses the last `run` output on disk.

---

## 12. AI / model milestones

| ID | Goal | Component | Kind | Adopted when |
| --- | --- | --- | --- | --- |
| AI-0 | G4–G5 | — | **None.** Layout, collision, playability constraints and fingering DP are code | – |
| AI-1 | G6 | Difficulty ranker | Small interpretable learned model on method-book order; committed weights; deterministic inference | It beats the legacy heuristic out of sample |
| AI-2 | G7a | Harmony, section or melody labelling | Only if the deterministic analysers miss their accuracy gates | Evidence at G7a |
| AI-3 | G8 v2 | **Arrangement model** | An LLM (the helper already calls Claude for parameters) or a trained symbolic model **proposes**; G5/G6/validator/G4 **verify** | **D-3** (cost, privacy, hosting) |
| AI-4 | G9 | Preference critic | Trained on committed blind A/B judgments only | Agrees with held-out human choices |
| AI-5 | G10 | Audio understanding | Pinned pretrained models (the existing AMT ensemble; beat/downbeat; chords; melody; separation) | **D-4** + M11 |
| AI-6 | G11 | Learner model and recommendations | Start with transparent statistics (`Learning`); ML only with enough data | D-5 (privacy) |
| AI-7 | G12 | OMR engine | Audiveris vs a learned OMR, by measurement | Evidence + licence |

**Guardrails for every model:**
- Never used for legality, geometry, validation or playback semantics.
- Version and hash pinned, recorded in provenance `src`.
- Evaluated on a fixed committed set.
- An offline or deterministic fallback exists.
- No training on hold-out data or copyrighted material.
- **A model never writes pitches into a ScoreGraph without deterministic verification.** This extends the helper's current rule for `/arrange`.

---

## 13. Technical debt that blocks later Goals

| TD | Debt | Blocks | Resolved in |
| --- | --- | --- | --- |
| TD1 | Playback, practice judging, follow, Coach and Fingering read the legacy Score (S5-play) | G11's learner model keyed by graph IDs; S8 | G11a |
| TD2 | App-made XML is re-parsed with `parseMusicXML` (S4): recording/rewrite, OMR (`PdfLayer` edits the Score), arrangement | Full-fidelity rendering of those paths (OMR renders projected and loses its beams) | G8, G10a, G12 |
| TD3 | The graph lives only in per-device IndexedDB; the server and shares keep a packed Score; **songs are not synced at all** | Cross-device fidelity of arrangements; G13 | G13 (earlier on D-5) |
| TD4 | Issue 3: 8va plays an octave off | The G4f flip (drawn ≠ played); G3 auto-8va | MX-1 |
| TD5 | Pedal `change` plays as no lift | G4 A9 consistency; G3 `pedalJoin` | MX-1 |
| TD6 | No real recordings (M11) | G10a, G3b | User, before G10 |
| TD7 | Full-suite baselines are stale (F7) | Trusting `check --suite full` | MX-2 |
| TD8 | The page tools and the 26 browser suites are not in CI; the `&&` chain | Regression detection for every UI-touching Goal | G4f |
| TD9 | Catalogue defects (issues 10, 14, 15) | G6 labels; G7a evaluation | MX-2 |
| TD10 | Ways back never removed (`buildXml`/`legacyWriter`, `legacyImport`) | S8; code weight | MX-3 |
| TD11 | Arrangers have no quality metric and no hand-span check | G8/G9 baselines | G5 (baseline), G7b (invariants) |
| TD12 | `Score.form` ignores D.S., D.C. and Fine; grace notes are not played | G4 draws jumps and graces the player ignores; G11a parity | G11a |
| TD13 | Runtime CDN dependencies (React, Babel, pdf.js, tfjs, fonts) | Offline use, determinism | G13 |
| TD14 | ~~A latent `engrave/marks.js` tie-endpoint bug~~ — **FIXED, MERGED** (#92, squashed to `856a165`, 2026-09-29). Root cause was two-fold, both in the same `be-still-my-soul.musicxml` tie into a note with its own printed accidental, first note of a new system: (1) `tests/engrave/l2.js`'s endpoint checker never widened the "own head" box with the note's own accidental for a tie-end (only did so with dot/flag for a tie-start), so a correctly-routed `marks.js` endpoint measured as out-of-bounds; (2) a genuine `marks.js` bug — a cross-system tie-end's stub start (`p0`) was pinned to the system's start X with no floor against the landing point, producing a backwards, accidental-crossing curve when the note's own accidental overhangs left of the system margin. A same-day independent review (Sonnet) approved with one non-blocking finding (the first fix's `p0` clamp could collapse the stub to zero visible length on the phone breakpoint for this exact note); fixed in a same-PR follow-up giving the degenerate case the standard `CV.TIE.stub` length instead. `test:engrave` 200/201 both before and after (the 1 remaining failure is a pre-existing, unrelated `A27` layout-hash-drift that reproduces on an unmodified checkout). Corpus-wide scan confirmed `be-still-my-soul` is the only hymn hit by this pattern; two Czerny method ties were already marginally (imperceptibly) affected pre-existing, no regression | `test:engrave`'s full-corpus zero-target gate | Done |
| TD15 | ~~The legacy arranger never returned on some pieces~~ — **FIXED, MERGED, DEPLOYED** (#93, `acffcd1`, 2026-09-30; live in deploy `26e26f3`). Root cause: an infinite fill loop when a same-attack group has more notes than the level cap but fewer distinct pitches (`used` counts pitches, `g.length` counts notes), in the app's `ScoreArranger.selectVoices` (`balanced` style; 14 hangs over 347 files x 4 levels x 7 styles) and, found by the review, the identical loop in `audio-score.js` `arrangeNotes` (used by the review screen). One `if (!best) break;` each; outputs of every input that used to finish are unchanged (9702/9702 and 36000/36000). The browser freeze on such pieces is gone in production since the 2026-09-30 deploy | Any arrangement or recording with unisons | Done |
| TD16 | The engraver draws arranged output with no 8va/8vb: high notes sit on many ledger lines and low notes likewise (H-8, items 11 and 12; both arms) | Readability of any arranged score; G9e | Unscheduled (engraver, G4 territory) |
| TD17 | Arranged graphs draw simultaneous notes of one staff with odd stems or tails, and a low note's notation looked wrong (H-8, items 1, 3 and 5; mostly the legacy arm, one G9 item) | Readability of arranged scores; G9e decides where accidentals and voicing come from | Unscheduled (engraver, G4 territory; look with G9e's printed-accidental finding) |

---

## 14. Current task

**G4 "Professional Engraving", MX-2, G5 (playability and fingering), G6 (difficulty), G7 (SongGraph + Arrangement Planner) and G8 (Arrangement Realization) are all completely done, merged, and deployed.** Full G4 blow-by-blow is in `docs/GOALS/G04_PROFESSIONAL_ENGRAVING.md` §32-§52 and `docs/DECISIONS.md`'s G4-* rows; G5's is in `docs/GOALS/G05_PLAYABILITY_FINGERING.md` §11; G6's is in `docs/GOALS/G06_DIFFICULTY.md` §11; G7a's is in `docs/GOALS/G07_SONGGRAPH_CORE.md` §12; G7b's is in `docs/GOALS/G07B_ARRANGEMENT_PLANNER.md` §11; G8a's is in `docs/GOALS/G08_ARRANGEMENT_REALIZATION.md` §14; G8b's is in `docs/GOALS/G08B_LEGACY_RETIREMENT.md` §11 -- this section only tracks what's still open (nothing).

- **G8b** (PR #87, `1d03117`/`e076f8a`, squashed `4866b66`): new `PPP.arranger` switch (`'legacy'` default, `'g8'` opt-in). Fixed the review screen's XML re-parse (TD2) for the `'g8'` path -- `built.graph` goes straight to `songgraph.analyze()` → `arrangement.plan()` → `realize()`, no `parseMusicXML`/wire-JSON/HTTP. **Investigated and refuted a pre-implementation hypothesis**: `arrange_score.py` is confirmed fully deployed and the PRIMARY engine for the `'legacy'` path in production (`render.yaml` spawns the helper, `server.js` proxies to it) -- correctly NOT retired this phase (deferred to a future flip, G4's own precedent), since deleting it now would silently change production behavior for the still-default path. Found and fixed two real, previously-unknown bugs in G8a's already-merged `realize/*.js`: no UMD wrapper at all (would have completely blocked browser loading), and `opts.reference` never threaded through (would have silently discarded G8a's own tuned density data) -- both independently verified via a Node `vm`-based check confirming byte-identical output between simulated browser loading and Node's `require()`. `graphToReviewScore()` substitutes real hand/limb data, measured as a substantial fix (35-42% of notes corrected). **Independent review found one MAJOR, non-blocking scope gap** the implementation's own call-site search missed: the review screen's DEFAULT style (`'balanced'`) never reaches the gated code path at all -- it routes through a third, entirely separate legacy engine (`audio-score.js`) with no switch check anywhere in that path, so `PPP.arranger='g8'` has zero effect for the most common request shape. No live risk today (switch defaults to `'legacy'` regardless), disclosed honestly for any future default-flip decision, not fixed in this phase. **Deployed to production** (`dep-dat761nlk1mc73ehv95g`, 2026-09-28) -- verified live: `PPP.arranger` defaults to `'legacy'` (an invalid value falls back to it too), and the `realize`/`arrangement` modules load correctly in the real production browser (`PPP.arranger='g8'` works, zero console errors) -- validating G8b's UMD-wrapper fix outside the `vm` simulation it was originally checked in.

- **G8a** (multiple PRs, squashed `2f97ceb`, on top of the design doc PR #81 `aaeb67f`): a deterministic pattern-library realizer turning a G7b `ArrangementPlan` into a real ScoreGraph. Hit a real multi-writer collision mid-implementation -- sub-agents dispatched for research did not stay read-only and wrote conflicting implementations to the shared worktree; cleaned up, kept the better-evidenced one (`realize/`, which reuses the standard G4a reference corpus for its comparison harness and found/fixed a real correctness bug in the harness itself -- `legacy-score.js`'s `fromScore` never sets a hand limb, which had silently produced a false "0 hard violations for everyone" result). **Real finding, independently reproduced by two separate implementations/harnesses before cleanup, and confirmed again after one tuning round: §7's "better than all three legacy engines on every metric" bar is NOT met** -- G8a does not beat the in-app `ScoreArranger` on hard-violation rate or (fully) on G6-level accuracy, though it clearly beats the other two legacy engines and, after tuning the density policy against G7b's real per-stage bands (`arrangement/reference.js`), now ties `ScoreArranger` on G6-level-within-±1 (83.3% vs 83%) and narrowly beats it on harmony root-only agreement. Still behind on level mean-error (>2x), harmony root+quality, and hard-violation rate. One tuning round included a disclosed, reverted regression (a data-driven chord-sizing attempt that caused a real build failure) -- independent review reproduced the regression exactly, confirmed the revert is clean. **A second, final tuning round** (PR #84, `6dd7d45`) traced and fixed the hard-violation source (`'hymn'` mode trusted G7b's plan-level reach check, but real kept-voice spans sometimes exceeded it for the specific hand profile -- fixed by re-checking G7b's own `maxSimultaneous` before committing to hymn mode) and the harmony root+quality gap (a 7th-chord quality was always voiced as a bare triad, dropping the 7th needed to re-identify it): **hard violations corpus-wide went from 57 files/327 violations to 2/3 (independently verified, exceeding the implementer's own claim), G8a now clearly beats `ScoreArranger` on that metric**, and the harmony root+quality gap narrowed (0.053 -> 0.018). Honest, understood trade-offs: harmony root-only slipped slightly, and G6-level-within-±1 regressed (83.3% -> 66.7%, traced to two specific files, one being the direct and arguably-correct cost of fixing 6 real hard violations). **Final state: G8a ties or beats `ScoreArranger` on 3 of 5 metrics (up from 2); §7's full bar remains unmet. Tuning concluded per the user's own "one more round, then accept" instruction.** Reported to the user plainly at each step, not narrowed to favorable metrics. Node-only, not loaded by the app.

- **G7b** (PR #79, `fd74d06`/`e2efc52`, squashed `b344688`): given a piece's SongGraph and a target (level, style, hand profile, sections, key), finds an `ArrangementPlan` by deterministic search under G5/G6 constraints -- writes no notes (G8's job). Rejected inverting G6's trained difficulty model for plan-level bounds (mathematically unsound: non-negative weights + possibly-negative feature z-scores means a partial sum isn't a real bound) and built real empirical per-stage bands from G6's own training data instead. Rejected the design doc's own suggested texture vocabulary (block chords/Alberti/arpeggiated) since G7a has no rhythmic-pattern feature to distinguish them -- used a "full/partial/reduced" voice-retention ladder instead. Classified all 10 G0 Step 14 arrangement invariants explicitly (real-and-checked / structurally-guaranteed-of-the-plan / partial-proxy / deferred-to-G8) rather than overclaiming. **169/369 corpus files plannable at their own G6-assessed level (67/100 hymns), 0 crashes across 3,321 attempts, 400/400 determinism checks identical, 49ms worst-case (budget 200ms).** Two honest negative findings reported, not tuned away: Hanon fails at every hand profile (both voices land in the same hand by real register, doubling its attack rate past the corpus band); czerny299's low coverage is the same licence-quarantine data gap G6/G7a already found, not a planner defect. Independent review: READY_TO_MERGE, found one small (1/169, 0.6%) real circularity in max-based ceilings for anchor pieces evaluated against bands built partly from themselves -- documented as follow-up for G8/G9, not fixed now (negligible today). One MINOR doc-accuracy fix applied. Node-only, not loaded by the app.

- **G7a** (PR #76, `9d6315f`/`79c82ca`, squashed `bbadfd6`): built the SongGraph's core analyses over a ScoreGraph in one pass (no split needed) -- key regions (reusing G3's existing `regionKeys()` directly), harmony per beat window, melody/bass identification with confidence, exact-repeat section detection, cadence-based phrase detection, voice-role classification, an energy/density curve. New `ops.addSection`/`addPhrase` (the only promotion path into the previously schema-only `Structure.sections`/`phrases`), reusing G1's already-built `resolveSpan`/`spanOf`/`fingerprint`/`scoreRef` machinery rather than rebuilding it. **Corrected a stale roadmap assumption before implementation**: the "550 printed chord symbols" ground truth is real as a count but 100% concentrated in licence-quarantined `czerny299` files (effectively zero usable) -- hymn SATB (a real, independent 4-voice texture, not a reduction) is the actual usable ground truth. Measured against it: **harmony 89.2% root+quality / 93.1% root-only, melody 100.0%, bass 99.0%**. No ground truth exists anywhere in the repo for sections/phrases/energy (confirmed, not assumed) -- exercised by mutation tests instead. Independent review specifically checked the unusually strong 100%/99% figures for leakage and confirmed none (the detectors never read SATB voice-label conventions, only the eval/test code does); found and the Lead fixed one MAJOR test-quality gap (a committed regression test for a real, already-fixed bug didn't actually discriminate it on its small synthetic fixture -- added a test against the real `amazing-grace.musicxml` file instead, verified to fail under the reverted bug and pass under the fix). Performance 53ms worst-case, budget 500ms. Node-only, not loaded by the app.

- **G4**: every stage, both human review gates, the flip, all polish, and the full legacy-renderer removal are closed, merged, and live in production (deploy `dep-dasi7ah7lnhs739a2ia0`, commit `256aa9a`, 2026-09-27). Nothing open.
- **MX-2** (PR #57 `789e6de`/`fbda4b4`, squashed as `ca70a03`): `catalog/hymns/abc-to-musicxml.js` wrote `<alter>` only for an explicit ABC accidental, so most hymn notes played natural regardless of the printed key signature, and wrote tie starts with no matching stop. Fixed the converter (key-signature default, in-bar carry across voices on a staff, tie-stop matching) and patched the 91 affected shipped `.musicxml` files directly (the ABC source tree no longer exists on disk -- `catalog/hymns/README.md`). `known_defects.py` hymn counts: `key_signature_playback` 89/89 files to 0, `bar_accidental_not_carried` 10/100 to 0, `tie_without_stop` 10/10 to 0. `bar_integrity` (12 hymn files) and `tempo_marks_disagree` (0 hymns) were investigated and deliberately deferred -- per-file judgment, not a mechanical fix. Independent review found two MAJOR issues (a latent ordering bug and a missing audit trail for the one-off data patch), both fixed and re-verified. **Deployed to production** (`dep-dasjdlt9fdbs73dnhgo0`, 2026-09-27) -- verified live (F#3 midi 54 where it used to read F natural). Incidentally exposed a pre-existing, unrelated `engrave/marks.js` tie-endpoint bug on one file's last measure (TD14, §13) -- cosmetic only, logged as backlog, not a MX-2 regression.
- **G5a** (PR #62, `676ca48`/`08b226f`, squashed `0b6c8dd`): a playability analyzer (`playability/`) over the ScoreGraph -- hard violations (span, key-count, velocity, held-note conflict) and soft strain, at event and measure level, for a hand profile (small/medium/large, reach numbers from the app's own `Fingering.SPANS`). R-corpus false-positive baseline: 68 hits across 14/61 files at medium profile, investigated file-by-file (mostly the SATB two-voices-per-staff convention, a couple of real transcription artifacts), gated as a regression baseline rather than tuned to zero. Legacy-arranger baseline (closes half of G0 Step 14): all three arrangers produce real hand-span violations against their own output. One independent review round: READY_TO_MERGE, two trivial doc fixes applied, one follow-up noted (KEYS check should dedupe identical simultaneous pitches -- deferred to G5b, affects one file). Node-only, not loaded by the app.
- **G5b** (PR #64, `5f85f35`/`1fde340`, squashed `290dba3`): a faithful port of the app's legacy `Fingering` DP onto the ScoreGraph (`playability/fingering.js`). Independent review confirmed the design doc's "extend jointly across both hands" premise was wrong -- the legacy DP has zero cross-hand cost term anywhere, so G5b solves each hand independently, same as legacy. Found and fixed a real bug (heads sharing a pitch within one attack must collapse to one finger), moving overall printed-fingering agreement from 69.7% (losing to legacy) to **70.7% vs legacy's 70.6%** -- beats legacy on both hands and overall, the acceptance bar. Ground truth recounted: 66 files/10,358 heads (not the design doc's never-verified 84/14,305). Performance well inside budget (~20-40ms full piece, ~0.1ms one passage). Writes `Head.fingering` with `provenance:'inferred'`, never overwriting `imported`/`edited`. Given the narrow reported margin, one independent review round reproduced every number from scratch (including deliberately disabling the fix to confirm it's load-bearing): READY_TO_MERGE, two MINOR doc-citation errors fixed. Node-only, not loaded by the app.
- **G5c** (PR #66, `708e5f2`/`5fe02ce`, squashed `ba8ee49`): app integration, the only G5 phase touching the live app file. A new `PPP.fingering` switch (`'legacy'` default, `'inferred'` opt-in, matching the `PPP.legacyImport` convention). Investigated (not assumed) that the existing hand-guide's live `Fingering.plan(sc)` DP already unconditionally honors a pre-set `n.finger` as a fixed constraint, so writing G5b's fingering onto the graph before `toScore()` at all 3 real call sites is enough -- no rendering-code change needed. Correctly does nothing on 3 graph-bypassing paths (audio-recording transcription, rhythm-rewrite/arrangement, OMR scan import) -- fails safe, disclosed. Reuses G5b's `write()`/`fingerGraph()` provenance guard verbatim. **Full review found and fixed one BLOCKER**: the commit's own claim that all 3 `test:engrave` failures were pre-existing (\"verified via git stash\") was false -- one was a real regression in a test's literal-regex assertion, caused by this commit's own refactor (fixed: the test now checks the actual invariant via a backreference, verified by deliberately breaking the invariant and confirming the test catches it). Two MINOR findings also fixed (an undisclosed third graph-bypass path; an honest note that the import-time solve is synchronous, not idle-sliced as aspired -- low risk, switch defaults off). Final: `test:engrave` 199/201 (2 genuinely pre-existing failures), `test:scoregraph` 216/216, `test:playability` 32/32, `tests/fingering.test.js` 86/86. **Deployed to production** (`dep-dasm7onpn0mc7391j9kg`, 2026-09-27) -- verified live: `PPP.fingering` defaults to `'legacy'` (an invalid value falls back to it too), and setting it to `'inferred'` fingers 18/22 notes of a real song (Für Elise) with zero console errors.
- **G6a** (PR #70, `e86d416`/`1cabec2`/`fad3f34`, squashed `697f404`; implementer on Opus per user request for this AI-modeling phase, review on Sonnet): 21 difficulty features on top of G5's output, plus a small interpretable ranker (not a deep model) trained on `course.js`'s method-book `PATH`. Measured the real legacy baseline first: neither `Score.deriveSections` nor `Coach.structural` actually ranks whole pieces (both score 8-bar sections within one piece); the best cross-piece reading reaches 89.5%. **Missed the original bar** (leave-one-book-out, legacy +2.0 points overall -- a tie, 89.5% vs 89.5%), but **beats legacy within-book (84.7% vs 79.0%) and on hold-out (+3.4 points, 95% CI +0.4 to +6.6)**. Independent review reproduced every number from scratch and traced the one losing fold (czerny849, 22 pieces) to sampling noise (its own bootstrap CI: -26 to +16), not a real generalization failure. **Decision G6-L1** (`docs/DECISIONS.md`): presented to the user with both reports; the user accepted G6a with the bar revised to what matches actual deployment usage (within-book beats legacy, hold-out CI excludes zero -- both true). Placing an entirely unseen whole book remains unresolved and is logged as future work (G6-L2), not a blocker. czerny299 has 0 usable files (all licence-quarantined), so only 3 folds exist, not 4. Metamorphic tests 100% pass, verified via mutation testing. Node-only, not loaded by the app.
- **G6b** (PR #72, `a3063d8`, squashed `6c63338`): app integration, the only G6 phase touching the live app file. A new `PPP.difficulty` switch (`'legacy'` default, `'g6'` opt-in, matching `PPP.fingering`'s exact shape). Investigation found **4 real consumers** of the legacy difficulty logic (2 more than the design doc named): `Coach.context()`'s `structural` field, the Coach panel's own separate inline `Coach.structural` call, `App.difficultyLabel()`, and the Analysis screen's `hard`/`hardCount` list -- all four gated. **Correctly diverges from G5c's precedent**: uses `engrave/source.js`'s `resolveSync` (the same synchronous, content-hash-memoised resolver the renderer itself uses) rather than G5c's import-time-only call sites, since difficulty must work for a reopened, saved, or demo score too -- verified live that G5c's mechanism would NOT have worked for the demo score, confirming the choice was necessary, not arbitrary. Caught and fixed a real bug pre-commit (an early version could cache a premature `null` before weights loaded, sticking a score at no-assessment forever). The UI never overclaims confidence on a book the model has weak coverage for, honestly reflecting decision G6-L1. Performance ~40ms once per song view, cached to 0ms on repeat, off the critical path. Full independent review: READY_TO_MERGE, no BLOCKER/MAJOR -- every claim independently reproduced live (the four-consumer gating, the `resolveSync` necessity, the caching-bug fix via a reproduced race, switch-off byte-identical behavior re-derived independently, the degraded case, runtime switch-back, performance). `test:engrave` 199/201 on both this commit and its base -- confirmed no new regression. Two pre-existing, unrelated dead-code fields noted (never reach any template, out of scope). **Deployed to production** (`dep-dasuhch7lnhs73atgh80`, 2026-09-28) -- verified live: `PPP.difficulty` defaults to `'legacy'` (an invalid value falls back to it too), and `'g6'` produces a real level ("Harder than beyer No. 61, easier than beyer No. 67"), named method-book anchors, and hotspots for a real song (Für Elise) after its one-time lazy weights fetch, zero console errors.

## 15. Next task

**G9 after the two blind human reviews (2026-09-30 to 10-01; all Node-only, merged #104-#111; the user reads Korean and reviews on a phone, so the review page is Korean and published as an Artifact with the db capability).** The teacher's complaint ('notes stuck together, one hand playing an octave or more, two notes at once in one hand') went unresolved through five rounds of G9 fixes because the review page mixed both arms and every screenshot they sent came from the LEGACY ScoreArranger arm (124 stem-joined wide intervals and 641 two-notehead columns in the legacy arm, 0 and 0 in G9); matching their crops to the drawn DOM finally proved it, and a G9-only page built for them showed no problem. Fixes that did matter: stride patterns (pop, waltz) out of the default candidates (#104: flagged 12 of 14 vs 0 of 7), TD16 auto 8va/8vb (#105), review page fidelity (rests, ties, phone drawing, per-measure clef; #106, an earlier page had dropped rests and ties), compound-meter patterns + diatonic low stages + bounded left-hand chords (#107), the app's own sampled piano in the review page (#108, an earlier page used a plain synth), melody-clash guard and no-second pass (#109, #110), and finally the `singleNoteHands` switch (#111: one note per hand at every stage, melody top and bass never removed). Costs: by the harness metrics singleNoteHands loses harmony (16-file 0.9648 to 0.8838) and level distance (0.3325 to 0.4433) and loses melody and harmony to ScoreArranger while keeping hard violations and engraving; the harness melody number collapses on chord-written melodies (real melody top-line preservation is 1.0000 in every mode); hymns become melody plus one bass line; the output is about 0.5 easier than the requested level. Blind AI teacher-judges (Opus, rendered scores) over 16 unseen pieces: G9 6, legacy 7, same 3, and they over-prefer legacy on hymns where the user preferred G9, so AI preference is used for flags only. Open decisions for the user: connect G9 to the app (G9e) and how; what difficulty-scale meaning one-note-per-hand should have ('single-note mode' tier); the legacy arranger still has the shapes the teacher dislikes and is what the app uses today (TD16/TD17 engraving of arranged output partly done). H-9 was effectively run as a pass/fail page without a saved pass/fail. **G9a** (DONE, MERGED #94 `8330b48`, Node-only): held-out (11 scored files, disjoint from the tuning sample) best-of-N beats or ties ScoreArranger on 4 of 5 metrics and still LOSES on harmony (0.932 vs 0.971); the tuning sample showed a harmony win (0.975 vs 0.947) that did not hold on unseen files. Selection metrics overlap the reported metrics and the comparison favours G9a (disclosed in the goal doc). Independent review found 4 MAJOR items, all fixed; numbers unchanged. User decision 2026-09-30: no further tuning; accept as measured. **G9b** (DONE, MERGED #96 `9af3701`, Node-only): per-measure repair (parallel fifths/octaves, inner leaps, voice crossings, drop doubling) that never adds a hard violation (verified on ~3000 repairs); on both samples it leaves the five acceptance metrics unchanged and only lowers the voice-leading smell count (its own objective; 16-file 26 to 19, held-out 40 to 26), so it is not evidence the music is better. Review found and fixed a critic regression and stale G9a ablation claims: voice-leading is a real selection trade-off (weight left at 0, a user decision). Harmony still trails ScoreArranger on held-out. **G9c step 1** (DONE, MERGED #98 `de2dc5f`, Node-only): `review/` builds blind X/Y packets (G9 pipeline vs the legacy ScoreArranger) as an offline HTML page plus a separate key and `review/decode.js`; two independent reviews (the first found a blocker: a two-level piece repeated the legacy arrangement and revealed the arm; fixed). Limits stated in `review/README.md`: the arm is often guessable from density (G9 is fuller and more left-hand-heavy, and legacy misses the level target more), so ratings show whether this reviewer prefers G9's notes on G7b-plannable pieces at hand profile large, not that G9 is generally better; H-8 is now 16 pieces at one level each; audio has not been listened to. **H-8 DONE 2026-09-30** (G09 doc section 12, 'H-8 result'): preference G9 5, legacy 4, no difference 6 (inconclusive, confounded by density and level miss); the useful finding is one defect per arm that the harness cannot see: G9's bass goes too low (no register floor anywhere; flagged G9 arrangements average 25 notes below E2) and the legacy arranger writes wide left-hand chords. **Next: a register-floor fix for G9 (in progress), then a re-review; then H-9 and the G9e decisions (where accidentals come from, since realized G9 graphs carry no printed-accidental info; TD16/TD17 engraving of arranged output).** Original G9a scope: N candidates from the real G7b/G8a knobs, seven deterministic critics (five
promoted from G8a's harness, two new), hard constraints as filters, deterministic selection with an
explanation — then **best-of-N measured head-to-head against all three legacy engines on G8a's same
harness and 16-file sample**. That number decides whether G9's approach works at all. Then:

1. G9b (repair, G3-D5's per-measure rollback, provenance `repaired`) — Node-only
2. G9c (new blind-review packet builder, then H-8/H-9) — **needs the user's time; schedule with them**
3. G9d (AI-4, Opus) — **only if real judgment data can support its bar**; user decides on the opt-in
   in-app preference picker (the only realistic data source) and whether AI-4 is worth pursuing
4. G9e (app integration, route `'balanced'` through the gated path, flip) — **H-9 + explicit user approval**
5. Then G10 or G11 (whichever has its prerequisites ready first, per §5.8's ordering note)

## 16. Stop conditions

Stop, record and escalate to the user — do not work around these:

1. **A human gate fails** (M-H2, H-9, H-10 …). The flip stops and the Goal closes PARTIAL, as G3 did. The bar is never lowered silently.
2. Acceptance cannot be met without changing a **quality target, product behaviour or a user decision**.
3. **Evidence contradicts an architecture decision** (the Verovio trigger at G4d; G5 unable to reach near-zero false positives on published pieces; G7a analysis below its gate). Stop, run a spike, report.
4. **Two Fixer rounds fail** to clear a BLOCKER or MAJOR. Re-scope the stage instead of looping.
5. **An external prerequisite is missing** (M11, licensed data, a paid service). Move to the next independent Goal; never simulate the missing data as if it were real.
6. **Off-path identity breaks** (switched-off output differs from `main`). The merge stops.
7. **Safety**: touching `D:/PPP` / `d82bb71`, committing copyrighted or hold-out material, `git add .`, or disturbing another session's uncommitted work.
8. **A production incident or data-loss risk** (see D-0). Tell the user at once.

---

## 17. Definition of final product completion

PPP is complete when all of these hold and are recorded in CURRENT_STATE:

1. **Inputs.** A user can bring a piano recording, song audio (as far as licensing allows), MusicXML/MXL/MIDI, or a PDF/photo. Each becomes a ScoreGraph, and a song also gets a SongGraph, with a report that says what was inferred.
2. **Arrangement.** For any song input, PPP produces a piano arrangement at a requested level and style with:
   - 0 hard playability violations;
   - a level within ±1 of the target;
   - the melody preserved and the harmony faithful, by metric;
   - H-9 passed.
3. **Notation.** Everything is engraved by PPP's engine, on screen and in print (L1 silent 0, L2 hard 0 on the corpus and on generated arrangements). **Drawn = played = judged** for every symbol: 8va, pedal `change`, D.S./D.C./Fine, grace notes.
4. **Practice.** The adaptive loop runs on graph IDs: recommendations, level ± 1 variants, measured progress (H-11 passed).
5. **Transcription and OMR** reach the usable-rate targets the user approves in G10 and G12.
6. **Product.**
   - Songs and graphs are stored and synced on the server.
   - Core features have no runtime CDN dependency.
   - Deploys are automated and monitored.
   - The legacy Score, `parseMusicXML`, `buildXml` and the legacy renderer are removed (S8).
   - i18n is complete, and licences and notices are in place.
   - The business items the user chose are done.
7. Every Goal spec is closed; CURRENT_STATE lists no open BLOCKER or MAJOR; this roadmap says **COMPLETE**.

---

## 18. Decisions that need the user

Everything else — internal, reversible, evidence-backed engineering choices — the Lead decides and records.

| ID | Decision | Needed by | Lead's recommendation |
| --- | --- | --- | --- |
| **D-0** | Operations: the shared free Render Postgres `duckscope-db` expires **2026-09-26 12:44 UTC**. | – | **Decided 2026-09-25: Neon Free, $0/month. DONE 2026-09-25.**<br>- Full dump verified locally (`D:/PPP-db-backups/2026-09-25/`, 54 tables identical by row count and checksum).<br>- ppp-web moved to Neon project `ppp` (3 tables, identical by manifest, no writes lost; redeployed the live commit `72549cb` at 08:19Z; 110 public shares identical).<br>- A peer session moved DuckScope's 51 tables to Neon project `duckscope` and verified them.<br>- The temporary Render IP allow-list is cleared.<br>- Render is left to expire untouched; rollback is possible until then.<br>- The home PC holds the dumps as backup only. |
| **D-1** | 8va semantics | – | **Decided 2026-09-25: YES.** ScoreGraph pitch is the sounding truth; 8va/15ma is a display transformation; playback never shifts it again. MX-1 is approved right after G4b. Files encoded the other way are MX-2 data defects. |
| D-2 | Your time for M-H1 (end of G4d) and M-H2 plus the flip approval (G4f) | G4d / G4f | Already accepted as requests (G04 §29). |
| D-3 | The arrangement model (AI-3): a hosted LLM (per-call cost, privacy, network) vs a trained or local model vs deterministic realizers only | Before G8 v2 | Decide at G8 design with measured v1 results. |
| D-4 | G10 prerequisites: record M11 (3 pieces), licensing of song audio for evaluation, model-hosting cost (GPU) | Before G10 | – |
| D-5 | Practice data (storage, privacy) and syncing songs across devices | Before G11 / G13 | – |
| D-6 | Business: accounts, pricing, payments | G13 | – |

The Lead **will do these unless you object:**
- rebaseline the full suite in MX-2, with reasons (F7, open since G1);
- keep G12 (OMR) late.

---

## 19. Change log

| Date | Change |
| --- | --- |
| 2026-09-27 | Twenty-first edition. **§25 step 3 MERGED (PR #54 `4962251`) — G4 "Professional Engraving" is completely closed.** The legacy renderer (`draw()`/`buildVoice()`/`sync()`, the VexFlow CDN loader, the `PPP.renderer` switch) is gone from the app entirely, net -1503 lines. Three independent-review rounds given the stakes (this permanently removes the instant `?renderer=legacy` rollback); the Lead's own final re-check (fresh clone, full Node suites, direct code read of the closing fix) stood in for a fourth review round, since three prior rounds of independent verification had already converged on the same picture. §14/§15 rewritten to a concise summary — the full round-by-round history stays in G04 §32-§52 and DECISIONS' G4-* rows, not duplicated here. Not yet deployed. |
| 2026-09-27 | Twentieth edition. **§25 step 3, second fixer round** (two more independent findings, G04 §52.11): the Nineteenth edition's "3 files, fixed" claim for `openingBars()`'s dynamics/wedges leak was itself an undercount - a full corpus sweep (not a spot-check) put the real pre-fix scope at 62 real catalog files (58 in the R corpus, 4 in the licence-quarantined set), 61 of which that fix already resolved. The 2 remaining gaps, both fixed now: `tempos` had the identical unfiltered-leak bug (dormant in the eligible corpus, live in a quarantined file); and a wedge/pedal span whose start falls inside the preview window and stop falls outside (or vice versa) survived as an orphan, since simple field-filtering checks each point event independently - fixed with a new `spanned()` helper that keeps a span only whole, dropped exactly like `ottavas` otherwise (found and fixed defensively for pedals too, no corpus instance yet). Re-verifying this fix with its own full sweep caught a self-introduced ordering bug before it shipped: the first `spanned()` draft could emit a pedal's `change` event before its own `start`, which `fromScore()` misread as two spanners instead of one on a fixture file - fixed by filtering the original array by index instead of rebuilding it. Final sweep: 362 files (347 eligible + 15 quarantined) × 2 preview widths = 724 checks, 0 disagreements (the one that did show, `unpitched.musicxml`, reproduces identically on the raw full score with no preview involved at all - an existing, already-documented percussion exception, DECISIONS G4-I7, unrelated). Separately, re-ran `ottava-check.js` with views on across all 35 octave-line files (not a spot-check): the "dashboard" residual the Nineteenth edition left open is confirmed, by the reviewer, to not be an `engrave/`-side caching artifact as first guessed (a fresh page with zero prior renders reproduces it byte-identically) - likely a bug in the test tool's own row-matching logic instead, and the same symptom turns out to reach `whole`/`part`/`tablet`/`phone`/`review`/`old-part` on a handful of other files too, confirmed pre-existing and unrelated to this round's changes (identical with them stashed out). Left as tracked backlog, not fixed this round, per instruction. `test:engrave` 201/201, `test:scoregraph` 216/216, unchanged. |
| 2026-09-27 | Nineteenth edition. **§25 step 3 fixer round** (independent review NEEDS_FIX, 2 MAJOR + 1 MINOR, G04 §52.9): one MAJOR was a real regression, not the "pre-existing, unrelated" call the implementer's first report made - removing `render()`'s old VexFlow-readiness gate changed a timing race in `engrave/source.js`'s `resolve()`, so a corrupted stored graph's diagnostic code could be silently lost to the app's own earlier repaint; fixed by carrying the diagnostic forward from an earlier resolve of the same Score (`engrave/source.js`, `?v=4`), with a new unit test. The other MAJOR was the implementer's report showing only a `--no-views` pass for `tests/scoregraph/tools/ottava-check.js`, not the full run: fixed the tool's label-matching regex (the engraver's abbreviated "(8)"/"(15)" continuation label, G4-D1b-7, pre-existing and unrelated to this PR, had never been exercised because the tool always forced the old `?renderer=legacy`) and, along the way, found and fixed a real pre-existing bug in `openingBars()` (My Songs/Shared card previews) that leaked a whole score's `dynamics`/`wedges` into a 2-bar extract, causing spurious `SOURCE_DISAGREES` on several real catalog pieces - silent under the old renderer (which never checked `agree()`), newly visible now. That fully resolved several view kinds (card, shared-card, link, stored previews) but a distinct, unresolved geometry mismatch remains in others (dashboard and some multi-bar windows) after many sequential renders in one page session - reported honestly as not fixed, flagged for follow-up, not hidden. The MINOR (a stale comment) is fixed. DECISIONS G4-R3's perf claim was also corrected: the reviewer's own repeated measurements showed the home page really is ~7% slower at 4× CPU (not noise, as first reported) - the Practice-load speedup (27-35% faster) still nets out ahead, but the cost is disclosed rather than implied away. Full regression re-run on both OSes after the fixes; `test:engrave` now 201/201 (one new unit test). |
| 2026-09-27 | Eighteenth edition. **§25 step 3 (remove the legacy renderer) implemented, READY_FOR_REVIEW** (branch `g4-legacy-removal`, `docs/GOALS/G04_PROFESSIONAL_ENGRAVING.md` §52, DECISIONS G4-R3/G4-R4) — the largest single change to the app file so far, comparable in size to the flip. `draw()`/`buildVoice()`/`sync()`, the VexFlow CDN loader and the `PPP.renderer` dev-only switch are gone; the engraver is the only renderer. The two open design questions were resolved with measurement, not guessed: reduced views (home page thumbnail, empty-state staff) now draw through the engraver like any other view, clef and all - the engraver's plan/layout has no notion of hiding a clef (out of scope to add), and the measured cost (a few tens of ms, content-hash cached) is smaller than the VexFlow CDN round trip every view used to wait on; a genuine engraving failure now shows the view's own existing "could not be engraved" placeholder instead of a second renderer. Full regression on Windows and Linux (Docker, a real `git clone`): `test:engrave` 200/200, `test:scoregraph` 216/216, `layout-hashes.js`, `bench.js check --suite r|e|x` 61/40/76, all five `make-*.js --check` tools, `page-check.js`, `print-check.js`, `a48-coverage.js`, `u1-paths.js`, `storage-failure.js`, 25/26 browser suites (the 26th fails on an unrelated local Python venv gap) — all pass, both OSes matching. `legacy-parity.js` is retired: there is no more legacy renderer to compare against. |
| 2026-09-27 | Seventeenth edition. **Time-signature fix DEPLOYED** (PR #41 `16f4311`, deploy `dep-das1chvlk1mc73duo510`), the user's word, verified live (a windowed practice view now shows "6/8" where it showed nothing). All four G4 polish items are closed. Current: §25 step 3 (remove the legacy renderer). |
| 2026-09-27 | Sixteenth edition. Three G4 polish items ran in parallel (user-requested), each in its own worktree: **flag shape CLOSED** (no defect, G04 §46), **sonatina beaming (H03) CLOSED** (no defect — engrave was more complete, legacy had real artifacts, G04 §48, PR #38), **B5 first-draw perf DEFERRED as backlog** (root-caused, but fully closing it needs a Web Worker split, out of scope for now, G04 §49, PR #39). A fourth, more serious finding surfaced along the way and is being fixed now: the app's default practice view can show **no time signature at all** in a windowed section away from the piece's start (G04 §47) — a live regression, not cosmetic. |
| 2026-09-27 | Fifteenth edition. **G4 polish m2 CLOSED** (PR #35 `7ecfb53`) — a typo in `catalog/build-shared-seeds.js` (`<stave-count>` instead of MusicXML's `<staves>`), not a `scoregraph/` bug, made 4 of 7 Shared Scores library songs fall back to the legacy renderer. Fixed, regenerated the seed data, then migrated the 4 already-seeded production rows (backed up, dry-run checked, user-confirmed write) since the app never re-seeds an existing id. All 7 shared songs verified live with the engraver. Remaining polish: flag shape, sonatina beaming, B5, then §25 step 3. |
| 2026-09-26 | Fourteenth edition. **The flip is DEPLOYED to production** (`dep-daru9259fdbs73b3j7eg`, commit `9dc6942`), the user's word, verified live with a fresh puppeteer check (not just `/health`). G4 "Professional Engraving" has reached its product goal. Current: G4 polish (the 4-of-7 library fallback songs, the flag shape, sonatina beaming, B5), then §25 step 3 (remove the legacy renderer). |
| 2026-09-26 | Thirteenth edition. **M-H2 accepted** by the user with one known exception (G4-U6) and **the flip merged** (PR #32 `9dc6942`) after review (NEEDS_FIX, MAJOR 2: `<use>` glyphs made playback slower than legacy → inline, G4-L6; Print silently failing on fallback songs → shown only where the engraver drew) → Fixer → Lead re-check (playback now faster than legacy). Not deployed — deploy on the user's word. |
| 2026-09-26 | Twelfth edition. **G4f-1 CLOSED** (PR #28 `2c6d108`) after review (PASS, 0 BLOCKER/MAJOR, 2 MINOR) — the Lead fixed the one substantive MINOR directly (`5079d64`, CI readiness loop) rather than opening a Fixer round. Mutation suite complete 25/25; `legacy-geometry.js`/A43 confirms G4 ≥ legacy in every category; A46/A47/A48 confirmed. Current: G4f-2 (M-H2, then the flip). |
| 2026-09-25 | First edition (Lead). Remaining sequence G4b–G13; changes from the old roadmap in §7; MX lane; S4 owners; current task G4b in two merge points. |
| 2026-09-26 | Deploy: **production runs `0ef0950`** (user request; before `72549cb`), verified in the live page. PR #20 had been merged with a failed gate (a CI race, not the change); rule added in §8, fix running. |
| 2026-09-26 | Eleventh edition. **G4e CLOSED** (PR #26 `a33ccd3`) after review (NEEDS_FIX, MAJOR 2: a wrong page-fill claim, no print regression baseline) -> Fixer -> Lead re-check, which reproduced both corrections independently. Current: G4f. |
| 2026-09-26 | Tenth edition. **M-H1 DONE** (G04 §38): the user rated all 16 blind excerpts; engrave preferred 5, legacy 2, tied 9; zero excerpts where only engrave looked wrong; two legacy-preferred cases checked by hand and found to be minor, non-blocking; two real legacy defects the ratings surfaced turned out already fixed by engrave. Verovio trigger (§7.3) does not fire. Current: G4e. |
| 2026-09-26 | Ninth edition. **G4d-2 CLOSED** (PR #23 `16ce784`) after review (NEEDS_FIX, MAJOR 3) -> Fixer -> Lead re-check, which found and closed a *third*, independent M-H1 leak the Fixer's own B9 fix had reopened. The engraver now reaches the real page, still behind a dev-only switch. Current: M-H1. |
| 2026-09-26 | Eighth edition. **G4d-1b CLOSED** (PR #19 `a6e1a75`) after review (NEEDS_FIX, MAJOR 3; no invented notation) → Fixer → Lead re-check; the Node engraver is complete. Current: G4d-2 (page integration behind a dev-only switch, with the M-H1 review tool). Next: M-H1. |
| 2026-09-26 | Seventh edition. **G4d-1a CLOSED** (PR #17 `b4fe019`) after review (NEEDS_FIX, MAJOR 3) → Lead spec amendments **G4-L4** (chord ties) and **G4-L5** (fingering inside slurs, `FAR_PLACEMENT`) → Fixer → Lead re-check. M-H1 watch list started. Current: G4d-1b. |
| 2026-09-25 | Sixth edition. **G4c CLOSED** (PR #15 `e3c8c5a`) after review (NEEDS_FIX, MAJOR 2) → Fixer → Lead re-check → merge with `main`. G4-L2 recorded; **G4-L3** splits G4d-1 into G4d-1a (curves, note marks) and G4d-1b (system marks, vertical spacing). Current: G4d-1a. |
| 2026-09-25 | Fifth edition. **MX-1 CLOSED** (PR #13 `e37d37a`) after review (NEEDS_FIX) → Fixer → Lead re-check; MX-2 gets its carry-overs. G4c review NEEDS_FIX (MAJOR 2) → Fixer; G4-C4 ratified as G4-L2; G4d-1 carry-overs. |
| 2026-09-25 | Fourth edition. **G4b CLOSED** (PR #12 `62ede61`) after review → Fixer → Lead re-check; the closeout records the review (G04 §33.17) and G4-L1. Current: MX-1 and G4c (briefs in §14). Next: G4d-1, G4d-2 + M-H1. |
| 2026-09-25 | Third edition. G4b review: NEEDS_FIX, MAJOR 3 (dead static ban, no layout mutations, other-voice collisions invisible). Fixer launched for R1–R3; MINORs routed to G4c (R12 to G4d-2). D-0 done: both apps on Neon Free at $0. |
| 2026-09-25 | Second edition. G4b handed in as `ab59f80` (geometry-only). The Lead ratifies the boundary (G4-L1): `svg.js` → G4c, page integration → G4d-2 (before M-H1), full browser-suite and page-perf acceptance → G4f. D-0 decided (Neon Free, $0) and in progress; D-1 decided (YES). Current task: one independent G4b review. Next: MX-1 (brief in §15) and G4c. The hymn-bar defect goes to MX-2. |
