# PPP — current state

Updated 2026-09-23, during G2 (Score Import), on branch `g2-import` (worktree `D:/PPP-g2`).
G0 (Quality Foundation) and G1 (ScoreGraph) are both merged and closed; `origin/main` is `00081cc`.
Read this first in a new session, then the current goal's spec in `docs/GOALS/`.

## Where things are

| | |
| --- | --- |
| Goals | Numbered specs in `docs/GOALS/`. **G0 is merged and closed** — implemented (§16), reviewed and fixed through six passes (§17–§22.9), then merged as PR #1 (`aff7080`). `G00_QUALITY_FOUNDATION.md` §22.9 has the last result and what is still open (nothing). |
| G1 | **Merged and closed.** Implemented (§24), independently reviewed (§25: READY_TO_PR, BLOCKER 0, MAJOR 0), merged as PR #2 (`aa77d2e`), then the follow-up PR #3 (`00081cc`, §26) closed findings F2 and F3. F1 (tuplet bracket grouping) is left for G3 on purpose. `toMusicXml` writes its MusicXML from a ScoreGraph (`scoregraph/`); `opts.legacyWriter` is the way back for one release. |
| G2 | **In progress** on branch `g2-import` (worktree `D:/PPP-g2`). `G02_SCORE_IMPORT.md` is the design; 42 acceptance criteria, 15 steps. It widens the MusicXML importer to external files, adds MIDI as a second producer, and moves the app's import boundary onto the graph. Schema goes to version 2. |
| G0 code | On `main` since PR #1, which came from the clean branch `g0-quality-foundation-clean` (worktree `D:/PPP-g0-clean`). The older `g0-quality-foundation` branch and its `D:/PPP-g0` worktree are contaminated with other sessions' production changes — **never merge or edit those**. `tests/README.md` there has a two-line doc change left uncommitted on purpose (outside the allowed paths). |
| `main` | **Local `main` is `d82bb71`, which must not be pushed.** Despite its message ("harden G0 quality benchmark") it holds no benchmark code: it is a `git add -A` sweep of `D:/PPP` with copyrighted `tmp/` audio and score renders, `__pycache__`, a `_oh-sheet-compare` gitlink and another session's 124 `catalog/method` files (G00 §19.18). It is not pushed, and `origin/main` (`00081cc`) does not contain it. The user decides how to undo it. |
| App | `Piano Coach App.dc.html` (single file, ~19k lines), `audio-score.js` (recording → MusicXML; on the G1 branch through `scoregraph/`, which the page loads before it), `omr-service.js` (local helper, 127.0.0.1:8788), `server.js` (port 8777). Deploy: Render, manual (`render deploys create …`; a push does not deploy). |
| ScoreGraph | `scoregraph/` (13 UMD files, no dependencies; `scoregraph/README.md`): versioned plain-JSON canonical score, validator (31 errors, 14 warnings, 7 notes), canonical JSON, time and performance layers, MusicXML import and export. Every committed MusicXML (369 files) goes through it and back (`run.py sg-roundtrip`): 367 unchanged, 2 with a documented difference (allowlisted; a closing ending bracket and a wedge that were never opened). Nothing but `toMusicXml` uses it yet; the app's import, storage, renderer and player move in G2 onwards. |
| Tests | `npm test` (26 browser suites; needs `npm start`, network, puppeteer), `npm run test:transcription-core` (16, including `beat_track_test.py`), `npm run test:arranger` (3), `npm run test:bench` (221 unit tests + 17 golden snapshots + 13 correctness fixtures), `npm run test:scoregraph` (node tests, G1–G2). |
| CI | `.github/workflows/bench.yml`: a gate job (unit, `test:scoregraph` and `sg-roundtrip` since G1, golden, lint, provenance, correctness, smoke/core/robust run + check, replay-public, transcription-core, arranger) and a nightly job (mutation-check, full, the reviews' `adversarial.py`, `final_review.py`, `final_oracle.py`). The gate runs on a **pull request** or a push to `main`; pushing the branch alone runs nothing. The nightly schedule runs only from the default branch (`workflow_dispatch` runs it by hand). The gate has run on GitHub for PR #2 and PR #3 and passed both times. |

## Measuring score quality (G0)

```sh
npm run bench:smoke     # ~1 s
npm run bench           # core gate: 553 cases, ~16 s, exit 1 on a regression
python tests/bench/run.py ab --suite core --a git:HEAD --b worktree   # what did my change do?
npm run test:scoregraph && python tests/bench/run.py sg-roundtrip      # the ScoreGraph (G1)
```

Everything is in `tests/bench/README.md`: critical gates, metrics, corpus, the baseline update
procedure, private suites, and environment tiers.

**Read the usable-score rate first.** A score is *usable* when it passes every critical gate that
applies: the right metre (the main one, and for 19 in 20 notes the one in force), the app's score
tempo within ±4 % and its player's tempo map within ±4 % for 19 in 20 notes, at least 90 % of notes
in the right bar and beat, at least 80 % of notes with the right value as played and as printed, at
most ~5 % of notes missing or invented, the right key signature (first and for 19 in 20 notes), at
least 80 % of notes on the right hand, no broken, incomplete or added bars and bar numbers counting
up by one, the bars played in the music's order (no repeat sign added, moved or changed), every
needed accidental printed, pedal written when it was used. The diagnostic score
(`sqi/2`) is a trend line, not a verdict: 199 core cases score above its mean and are still unusable.

### Baseline (metrics/6, reader/4, gate/3; audio-score.js sha256 559a1f40…, CRLF read as LF)

metrics/5, metrics/6 and reader/4 (G00 §21.15, §22.9) changed no number below: the SUT writes no repeat
sign, no split bar, no inner implicit bar and always the reference's own bar count, so every stored
metric of every case is what it was at metrics/4.

**G1 changes no number either**: `ab --a git:aff7080 --b worktree` gives every case of core, robust,
smoke and replay-public the same status, metrics and semantic projection (`ab_identical.py`); so does full (4,976 cases).
**But the stored baselines were recorded from `audio-score.js` `559a1f40…` (the G0 branch), and
`aff7080` carries main's later `audio-score.js` (`78bd76e5…`, commits `e0d8b23`, `72549cb`)** (G01 §23
F7). Core, robust, smoke and replay-public still PASS against them; `check --suite full` does not
(REGRESSION on 12 subgroup gates, 20 improvements; usable 0.179 → 0.201), at `aff7080` exactly as at
G1. Rebaselining is the user's decision; the numbers in this table are the stored ones.

| suite | cases | usable | diagnostic | notes |
| --- | --- | --- | --- | --- |
| smoke | 44 | 38.6 % | 86.91 | |
| core | 553 | **18.1 %** | 76.86 | gates: meter 57.7 % · playback tempo 52.8 % · beat placement 45.2 % · note values 49.4 % · pitch integrity 92.8 % · key 88.6 % · hands 81.6 % · structure 100 % · accidentals 100 % · pedal 96.7 % |
| robust | 282 | 6.0 % | 76.55 | the performer with its cues off and releases 30–120 ms early: note values pass 17.7 % |
| full | 4,144 open + 832 hold-out | 18.0 % (hold-out 23.2 %) | 78.60 (hold-out 76.55) | |
| replay-public | 6 rendered AMT results | 16.7 % | 85.55 | |
| omr-live | 4 | 0 % | 53.32 | the OMR'd right hand is not playable (issue 11) |

Without the note-value gate core would be 25.9 % usable and robust 28.4 %: the gate added in §20
removes the scores whose note values are mostly wrong (issue 18).

By group in core: every compound-metre piece (103 cases) and every simple-duple piece (114) is
unusable; 4/4 pieces are usable 31.6 % of the time, 3/4 30.5 %. By book: Hanon 0 %, Czerny 849 0 %,
Burgmüller 3.4 %, Sonatina 9.8 %, Beyer 10.8 %, Czerny 599 12.5 %, hymns 33.5 %.

- Results are byte-identical run to run, from another working directory, with file enumeration
  reversed, and between Windows and Linux (`node:24-bookworm`, offline). Procedure in `tests/bench/README.md`.
- `mutation-check` plants 40 regressions (5 original, 7 from the first review, 5 from its fixer, 13
  from the final review, 4 from the short review: a spurious repeat sign, short bars marked
  `implicit="yes"`, a bar split without a repeat, no `<staves>`; 3 from the final pass review and its
  last fixer, G00 §22.9: a fake split excused by a forward repeat that cannot fire, a truncated last
  bar excused by position alone, a bar dropped outright with no measure-count gate to catch it; 3 in
  the ScoreGraph exporter, G1: no `<dot/>`, no `<time-modification>`, clefs swapped) and proves each
  is a REGRESSION on its metric; the review scripts (`tests/bench/review/`) check the benchmark
  itself. Since the G1 flip the writer mutations make their defect in `buildGraph` (the same defect
  in the file), and the review scripts share those edits.
- Golden labels a change `STRUCTURAL_CHANGE`, `SEMANTIC_CHANGE` or `SERIALIZATION_ONLY`; only the
  last is formatting. A dot, note type, rest, clef, staff, bar number, repeat sign or ending, or which
  staff is which hand never counts as formatting.
- **Repeats.** The benchmark reads repeat signs and endings the way the app does and compares the
  app's play order (`struct.form.order_exact`, in `critical.structure`). The synthetic performer takes
  no repeat, so against a performance a score is right with no repeat sign at all or with exactly the
  reference's; against a score (OMR, prediction files) only the reference's play order is right. A
  prediction's own lone forward repeat excuses a split only where a backward repeat could actually
  consume it (G00 §22.9 PF-M1) — one with no backward repeat anywhere after it in the file never fires
  and excuses nothing.
- **Short bars.** Only a pickup, its complement, or the two halves of a bar split at a repeat sign or
  ending are excused (in a prediction: a repeat it writes, which the play-order gate judges, or the
  reference's own split). A prediction's `implicit="yes"` or double bar line excuses nothing. A
  prediction's own first or last bar being short excuses nothing either, unless the truth is short the
  same way there too (G00 §22.9 PF-M2) — critical.structure also gates on `struct.measures.count_exact`
  (the same written bar count as the truth), independent of play order.

### What the benchmark leaves out, and why

- 24 catalogue scores with broken bars (L8) are excluded; they are counted as a known failure.
- 15 method-book scores are **quarantined** (P1): their files carry no public-domain or CC0
  statement (all 10 of Czerny 299, Burgmüller 1, 2, 4, 7 and 18). `tests/bench/corpus/provenance.json`
  records the evidence for every committed score; nothing is filled in by guess.
- **No real human performance exists in the repository** (M11, BLOCKED_ACCEPTABLE). `replay-public`
  is the synthetic performer rendered with real piano samples; the `input:recorded` tier is ready and
  empty. **Before the first Goal that changes how PPP infers onsets, beats, tempo or metre — or how it
  turns key releases into note values — at least three licence-clean real performances (simple
  duple, simple triple, compound metre) with bar starts checked by ear must be recorded and
  baselined** (procedure in `tests/bench/README.md`). Goals that change only the writer, ScoreGraph
  or engraving do not need them.

## Known quality issues (measured, not fixed)

Numbered as in G0 §14. Each is visible in the baseline or in the known-failure section of every
`summary.md`, and each belongs to a later goal.

1. **6/8 `<sound tempo>` is written in dotted-quarter units.** The app has two tempi: the score
   tempo (`Score.tempo`: practice tempo, metronome, tempo %) is the `<sound tempo>`, 2/3 of the
   performed tempo; the player's timeline (`PianoScore.tempoMap`) follows the dotted-quarter
   metronome mark written at the same place, which is right (checked in the app, G00 §20). In core:
   189 compound outputs, score tempo right 0.03, player timeline right 0.81. None of the 103
   compound-metre cases is usable.
2. **Metres are pulled towards 6/8.** 146 of 234 wrong metres in core are "→ 6/8" (2/4→6/8 alone:
   77). Simple-duple `time_sig.exact` is 0.05. Where the metre is misread as compound, the player
   plays 1.5× too fast even when the score tempo happens to be right (sonatina/002, hanon/007).
3. **The app plays 8va passages an octave off.** MusicXML's `<pitch>` is the sounding pitch; the app
   shifts it again. 30 committed scores, 2,229 notes. The benchmark reads references the MusicXML
   way (19 of the 29 method-book files are references again) and fixtures C10/C11 pin the rule.
4. `Import.load` returns the first-pass MusicXML even when it adopted the re-recognised merge.
5. **Key estimation.** Key gate 88.6 % in core; Sonatina 0.74, Czerny 849 0.77, Beyer 0.82. A piece
   that changes key (Burgmüller 15, C → E♭) gets one key signature for the whole piece.
6. **Hand split.** Hands gate 81.6 % in core (hand accuracy 0.888); Beyer 0.74, Hanon 0.72.
7. **Low-information input** (whole-note chords, M24): rhythm accuracy 0.00 on the onset path.
8. `tests/golden_benchmark.py` reads differently from the app (pickups, ties, grace notes, tempo)
   and labels quarter beats as "ms". Kept as it is; the new `legacy` command relabels its output.
9. `tests/beat_track_test.py` was orphaned. **Fixed in G0** (sys.path).
10. **89 of 100 hymns play wrong notes (6,119 notes).** `catalog/hymns/abc-to-musicxml.js` writes
    `<alter>` only for explicit ABC accidentals and ignores the key signature: every hymn not in C
    is affected; Amazing Grace in G has no F♯ at all. The same converter also writes tie starts with
    no stop (10 hymns, 101 ties replayed as separate notes; 16 files and 121 ties in the whole
    catalogue) and drops accidentals that should carry through the bar (18 notes in 10 hymns). The
    benchmark skips key and spelling metrics for these hymns and counts all three defects.
11. **An OMR'd piano score loses its right hand.** Audiveris exports two single-staff parts
    (the first named "Voice"). The app's hand rule then marks the treble staff `x` (shown, not
    played) and the bass `r`. Seen on all four OMR fixtures.
12. **The PDF OMR fixture comes back with 16 bars instead of 8** at confidence 0.8, with no
    suspect bars flagged (`omr.flag.recall` 0).
13. **(expected) 5/4 is written as 4/4** (micro M21). The metre is not supported yet.
14. **Catalogue bar integrity**: 24 files with overfull, underfull or empty bars (88 bars):
    hymns 12, Sonatina 8, Czerny 599 4. By the stricter rule (every staff fills its bar; a short bar
    only as a pickup, its complement or half of a bar split at a repeat sign, an ending or a double or
    final bar line), 12 files and 42 bars (`incomplete_bars`). Two of them since G00 §21.15: All Glory,
    Laud and Honor and I Need Thee Every Hour split a bar in two with no bar-line mark.
15. **Self-contradicting tempo marks**: 4 method-book files whose `<sound tempo>` and printed
    metronome disagree (lint L13). The app's score tempo follows one, its player the other.
16. **Grace notes are dropped** by `parseMusicXML` (a known limitation): 17 files, 244 notes.
17. **PPP writes the AMT's invented pedal into the score.** The six replay fixtures were played with
    no pedal; the helper reports 48 pedal presses on five of them and `toMusicXml` writes 78 pedal
    marks from them: 27.8 false pedal changes per minute in replay-public.
18. **(new, §20) PPP writes key releases as note values.** A legato note released early becomes a
    shorter note and a rest (Czerny 599/49: 16ths written as 32nd + 32nd rest, 8.9 rests a bar
    against 5.25). Note-value accuracy averages 0.739 per core case; the note-value gate passes
    49.4 % of core cases (deadpan 72 %, human 51 %, AMT 5 %) and 17.7 % of `robust`. Czerny 849 4 %,
    Hanon 0 %. The size of this depends on the synthetic release models, which no real recording
    has checked yet (M11).
19. **(new, §20) Printed shapes that contradict their length.** `toMusicXml` writes rests inside
    triplets without `<time-modification>` (a 2/3-beat rest drawn as a quarter rest) and leftover
    one-tick rests as 64ths: 107 core cases have at least one (`note_shape.consistency` 0.991). In
    the catalogue, 4 files and 8 notes (Für Elise bar 2: a quarter drawn as a dotted eighth; two
    hymns with undotted whole notes lasting six beats; `note_shape_mismatch`).
20. **(new, G1) A triplet bracket per piece.** `toMusicXml` opens and closes a `<tuplet>` bracket on
    every triplet piece (a one-note bracket) instead of one per group of three. The ScoreGraph carries
    it as it is and warns (`W-TUPLET-INCOMPLETE`: 47 in golden G03, 8,144 in core). The same graph
    warnings also count issue 1 (`W-TEMPO-MARK-MISMATCH`, 189 core cases) and issue 19
    (`W-DISPLAY-DURATION`, 2,647 events in core). G3.

## Working in this repository

- Several Claude sessions share `D:/PPP`. Say which files you will touch before large edits, and
  never stage another session's files. At G0 time, `catalog/method/index.json` and ~120 untracked
  `catalog/method/**/*.mxl` belonged to another session's work (now swept into local `main`, above).
- `.gitignore` on the G0 branch ignores `tmp/` (copyrighted experiments), `__pycache__/`, and
  `tests/bench/out/` and `.cache/`. The root `tools/` rule would also hide `tests/bench/tools/`,
  so a negation keeps that directory tracked.
- `core.autocrlf` is on. Text files are CRLF in the Windows working tree, so the benchmark hashes
  references with CRLF read as LF, and `tests/bench/.gitattributes` keeps its own files LF.
- On Windows (cp949), Python `print` of non-ASCII crashes unless stdout is UTF-8. The benchmark
  CLI reconfigures stdio itself. Bash heredocs can mangle backslashes and fail on mixed quotes.
- A git worktree without its own `node_modules` can use `PPP_BENCH_NODE_MODULES=D:/PPP/node_modules`
  for the T1 tiers (and `NODE_PATH=D:/PPP/node_modules` for `npm test`). `PPP_TRANSCRIBE_PYTHON` points
  at the transcribe venv; `PPP_AUDIVERIS=D:\PPP\tools\audiveris\Audiveris\Audiveris.exe` gives the
  worktree's helper an OMR engine for `omr-live`.
- `npm test` hardcodes port 8777. To test a worktree while another session's server holds 8777,
  run the worktree's server on another port and load a `-r` preload that rewrites the port in the
  test sources (G00 §18 records how).

## Next

- **G2 is the current Goal**: `docs/GOALS/G02_SCORE_IMPORT.md`. External MusicXML and MIDI into the
  graph, then the app's import boundary onto it (S3). Do not pull G3 notation work into it.
- **G1 is merged and closed** (PR #2 `aa77d2e`, follow-up PR #3 `00081cc`). §26 records the two
  findings it closed. **Left open on purpose:** tuplet bracket grouping for split triplet pieces
  (F1 — the app draws fewer brackets; G3 owns tuplet engraving, see issue 20 above), and F4–F8
  (§25.3), none of them reachable today.
- The full-suite baseline (and the others) predate main's `audio-score.js` changes (F7): decide on a
  rebaseline at `aff7080` before relying on `check --suite full`.
- G0 is merged (PR #1, `aff7080`) and CI is on. The one thing still open from G0 is what to do with
  local `main`'s `d82bb71`, which must never be pushed.
- Before any Goal that changes onset, beat, tempo, metre or note-value (release) inference: record
  the real performances above (M11).
- Later goals should target the measured issues above: 1, 2 and 18 decide most of the unusable
  cases (every compound-metre and simple-duple case; half of the rest on note values); 3, 10 and 11
  are the largest per user. Follow the loop in `tests/bench/README.md` ("Changing the SUT") and
  report the core, robust and hold-out usable-rate Δ.
- G0 leftovers: Step 14 (arrangement invariants) was not done; see G00 §16.6 and §18.7. Voices,
  beams and stems have no metric yet (golden labels a voice change STRUCTURAL_CHANGE); G4.
- G1 leftovers for G2: remove `buildXml` and `opts.legacyWriter` after one release (with
  `tests/scoregraph/tools/shadow_compare.py`); the app's import, storage and renderer onto the graph
  (G01 §15.2 S3, Appendix B).
