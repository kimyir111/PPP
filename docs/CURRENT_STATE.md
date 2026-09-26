# PPP — current state

Updated 2026-09-26 (G4e merged as PR #26; G4d-2 merged as PR #23; G4d-1b merged as PR #19; G4d-1a merged as PR #17; G4c merged as PR #15; MX-1 merged as PR #13; G4b merged as PR #12; the production database moved to Neon Free). G0 (Quality Foundation), G1 (ScoreGraph) and G2 (Score Import) are all merged
and closed. **G3 is merged as PARTIAL / DEFERRED** (PR #7, `c5474c2`; G03 §31): implemented, reviewed and fixed,
but its blind human review (A36) failed (§30), so every part of it stays **off** — G3a, G3b, the automatic 8va
and the pedal join — and nothing a user sees changed. **The active goal is G4 Professional Engraving**
(`docs/GOALS/G04_PROFESSIONAL_ENGRAVING.md`, Architect 2026-09-24; user decisions G4-U1–U5, G04 §31). **Stage G4a is
CLOSED — merged as PR #9 (`df8a571`)** after its final independent review passed (BLOCKER 0, MAJOR 0, G04 §32.13–§32.14);
`origin/main` is `df8a571` plus the docs-only closeout that records it. G4a changes nothing a user sees: the legacy
renderer is still the one drawing (16/16 renders byte-identical to `55d1bd5`). **G4b (layout core) is CLOSED — merged as PR #12
(`62ede61`)**. It went through one independent review (NEEDS_FIX, MAJOR 3), its Fixer, and the Lead's re-check
(G04 §33–§33.17, DECISIONS G4-B1–B11, G4-L1). It lays a NotationPlan out as an EngravedScore, in Node and in the browser
alike, and changes nothing a user sees — the app does not load it. **MX-1 (playback correctness, decision D-1) is CLOSED —
merged as PR #13 (`e37d37a`)**: an 8va sounds where the file says and is drawn under its sign in every view, a pedal `change`
lifts the damper. **Production runs `0ef0950` since 2026-09-26** (deployed at the user's request, with G1/G2 and MX-1). **G4c (notation core) is CLOSED —
merged as PR #15 (`e3c8c5a`)**: beams, stems, tuplets, voices, rests, grace notes and `svg.js`, Node only, nothing a user
sees. **G4d-1a (curves and marks attached to notes; G4-L3) is CLOSED — merged as PR #17 (`b4fe019`)**, after its review (NEEDS_FIX,
MAJOR 3), the Lead's spec amendments G4-L4/G4-L5, its Fixer and the Lead's re-check (G04 §35–§35.19). **G4d-1b (marks
attached to systems, vertical spacing, courtesy signs) is CLOSED — merged as PR #19 (`a6e1a75`)** (G04 §36–§36.21), so the
Node engraver is complete. **G4d-2 (the renderer in the page behind a dev-only switch, default `'legacy'`) is CLOSED
— merged as PR #23 (`16ce784`)**, after its review, a Fixer, and a Lead re-check that found and closed a second blind-review
leak in the M-H1 packet tool. **M-H1 is DONE** (G04 §38): the user rated all 16 blind excerpts — engrave preferred 5,
legacy 2, tied 9, zero excerpts where only engrave looked wrong; the Verovio trigger does not fire. **G4e (print) is
CLOSED — merged as PR #26 (`a33ccd3`)** (G04 §39–§39.12, DECISIONS G4-E1–E8): `mode:'print'` alone gives a paginated
A4 `EngravedScore` from the same plan the screen uses — its own DP line breaker, page breaks that never split a system,
a title area, page numbers, bar numbers at each system's head, print-only multi-measure rest merging, and a
dev-switch-gated "Print / Save as PDF" command. Screen output stays byte-identical (`engr/6`, version-only re-bless).
Its independent review returned NEEDS_FIX (MAJOR 2: DECISIONS G4-E7's page-fill evidence was wrong, corrected in
place; print had no committed regression-hash baseline, added to `layout-hashes.js`), a Fixer closed both, and the
Lead's re-check reproduced the corrected 65.3% corpus-wide fill average and the hash guard's negative control
independently, bit for bit, and confirmed legacy parity 16/16 on its own two servers. **G4f-1 (the engineering
evidence base) is done** (G04 §40, DECISIONS G4-F1-1..5): all 25 mutations (G04 §23) are live under a named metric
each (M22 added); `tests/engrave/tools/legacy-geometry.js` (new) compares G4 against the legacy renderer's own drawn
SVG on 5 generic-geometry categories over the R corpus - G4 has 0 notehead overlaps to legacy's 402, matches on
clipping, and the one category that looked worse on a raw count (tuplets) turned out to be legacy drawing tuplet
numbers the graph says to suppress, not a G4 gap (G4's own count matches its ledger's `drawn` entries exactly on the
files checked); B2 and B6 hold under a simulated CPU 4x slowdown (55.8 ms and 0.4 ms, both under budget); the CI gate
stays as it was (~70 s, under A41's 90 s budget) and the nightly job now also carries the full mutation suite plus
three puppeteer tools (untested in a real GitHub Actions run yet - flagged for a manual one); A46, A47 and A48 were
re-confirmed rather than rebuilt (A47 found 2 already-documented fallbacks, not a new defect). No product-facing
change; the default renderer is still `'legacy'`. **Next: M-H2** (the pass/fail human review) **and then the flip -
both the Lead's, not done in G4f-1**.
Read this first in a new session, then
`docs/PPP_MASTER_ROADMAP.md` (the order of the remaining Goals, their gates, the current and next task), then the
current goal's spec in `docs/GOALS/`.

## Where things are

| | |
| --- | --- |
| Goals | Numbered specs in `docs/GOALS/`. **G0 is merged and closed** — implemented (§16), reviewed and fixed through six passes (§17–§22.9), then merged as PR #1 (`aff7080`). `G00_QUALITY_FOUNDATION.md` §22.9 has the last result and what is still open (nothing). |
| G3 | **PARTIAL / DEFERRED — not COMPLETE** (G03 §31, DECISIONS G3-U9). **Merged to `main` switched off** as PR #7 (`c5474c2`, a squash of `g3-score-intelligence` `966a053`; the branch and `D:/PPP-g3` are kept). `professionalize()` (a graph → graph pass pipeline behind a critic) runs in `toMusicXml` only when `opts.professional` is `'shadow'` or `'on'`; **the default is `'off'` and nothing passes it**, so G3 changes nothing a user sees — G3 off is byte-identical to the pre-G3 `main`, `cc509e2` (§31.2). G3a's other acceptance criteria are PASS or PARTIAL by design (§29.9), but it **failed the blind human review A36** (§30); G3b waits on M11; 8va on issue 3; the pedal join on the app's `change` playback. Reopening: §31.5. |
| G4 | **G4a–G4e all CLOSED** (PR #9 `df8a571`, PR #12 `62ede61`, PR #15 `e3c8c5a`, PR #17 `b4fe019`, PR #19 `a6e1a75`, PR #23 `16ce784`, PR #26 `a33ccd3`): the Node engraving engine is complete, reaches the real page, and now prints — all still behind a dev-only switch (`renderer` prop, default `'legacy'`); nothing a user sees changed, verified byte-identical to base on a scripted default-renderer session and on legacy parity (16/16, Lead re-check). **M-H1 is DONE** (G04 §38): the user rated 16 blind excerpts on the real page's own two renderers — engrave preferred 5, legacy 2, tied 9 (5 of those at a perfect score both sides), zero excerpts where only engrave looked wrong. The two legacy-preferred excerpts were checked by hand (§38.1 a beam/flag shape question, §38.2 a notation-reading question) — not engine defects, both on the G4f watch list. Two real legacy defects the ratings surfaced (tie/stem overlaps) turned out already fixed by engrave. The Verovio trigger (§7.3) does not fire (§38.4). **G4e (print)** — G04 §39–§39.12, DECISIONS G4-E1–E8: print's own DP line-breaker, page breaks that never split a system, title/composer/page-number/bar-number text, print-only multi-measure rest merging, a dev-switch-gated print command; screen output byte-identical (`engr/6`, version-only re-bless, 236/236 SERIALIZATION_ONLY). Its review (NEEDS_FIX, MAJOR 2: a wrong page-fill claim in DECISIONS G4-E7, corrected; print had no committed regression-hash baseline, added with a negative control) was fixed and the Lead's re-check independently reproduced both corrections bit for bit. **G4f-1 (the engineering evidence base) is done, not the whole of G4f** — G04 §40, DECISIONS G4-F1-1..5: mutation completeness (all 25, M22 added), `legacy-geometry.js` (new: G4 vs the legacy renderer's own SVG, 5 categories, R corpus — G4 clean or ahead on 4, the 5th (tuplet counts) explained as this generic tool's blind spot rather than a G4 gap), B2/B6 confirmed under simulated CPU 4x throttle, the CI gate unchanged (~70s, under A41's 90s) with nightly now also carrying the full mutation suite and three puppeteer tools (not yet run for real in GitHub Actions), and A46/A47/A48 re-confirmed (not rebuilt). No product change; renderer default stays `'legacy'`. **Next: M-H2** — the pass/fail human review (the Lead's), and, on approval, the flip (also the Lead's). |
| G1 | **Merged and closed.** Implemented (§24), independently reviewed (§25: READY_TO_PR, BLOCKER 0, MAJOR 0), merged as PR #2 (`aa77d2e`), then the follow-up PR #3 (`00081cc`, §26) closed findings F2 and F3. F1 (tuplet bracket grouping) is left for G3 on purpose. `toMusicXml` writes its MusicXML from a ScoreGraph (`scoregraph/`); `opts.legacyWriter` is the way back for one release. |
| G2 | **Merged and closed.** Implemented (§24), independently reviewed (§25), the one MAJOR it found closed by §26 (D7), merged as PR #4 (`cc0da79`) with BLOCKER 0 and MAJOR 0. Schema is version 2. **The app's import boundary is on the graph** — a file a person opens becomes a ScoreGraph and the Score is a projection of it; `PPP.legacyImport = true` is the way back for one release. **`.mid` opens**: its notes, times and controllers exactly as the file states them, its notation worked out by audio-score's existing quantizer and marked inferred in three places (D3). The MusicXML importer no longer refuses a whole file for an `<unpitched>` note, a missing time signature or a quarter tone. **A transposing part is printed where it is written and sounds where it sounds** (D7, §26). Transcription is unchanged: core 553/553 identical to `00081cc`. |
| G0 code | On `main` since PR #1, which came from the clean branch `g0-quality-foundation-clean` (worktree `D:/PPP-g0-clean`). The older `g0-quality-foundation` branch and its `D:/PPP-g0` worktree are contaminated with other sessions' production changes — **never merge or edit those**. `tests/README.md` there has a two-line doc change left uncommitted on purpose (outside the allowed paths). |
| `main` | **Local `main` is `d82bb71`, which must not be pushed.** Despite its message ("harden G0 quality benchmark") it holds no benchmark code: it is a `git add -A` sweep of `D:/PPP` with copyrighted `tmp/` audio and score renders, `__pycache__`, a `_oh-sheet-compare` gitlink and another session's 124 `catalog/method` files (G00 §19.18). It is not pushed, and `origin/main` (`df8a571`) does not contain it. It is unrelated stale local state: **leave `D:/PPP` and `d82bb71` untouched**; the user decides how to undo it. |
| App | `Piano Coach App.dc.html` (single file, ~19k lines), `audio-score.js` (recording → MusicXML; on the G1 branch through `scoregraph/`, which the page loads before it), `omr-service.js` (local helper, 127.0.0.1:8788), `server.js` (port 8777). Deploy: Render, manual (`render deploys create …`; a push does not deploy). |
| ScoreGraph | `scoregraph/` (27 UMD files — the 17 through G2 plus G3's `meter-grid.js`, `pro.js` and eight `pro-*.js`, which run only with G3 on — no dependencies; `scoregraph/README.md`): versioned plain-JSON canonical score, validator (31 errors, 14 warnings, 7 notes), canonical JSON, time and performance layers, MusicXML import and export. Every committed MusicXML (369 files) goes through it and back (`run.py sg-roundtrip`): 367 unchanged, 2 with a documented difference (allowlisted; a closing ending bracket and a wedge that were never opened). Since G2 the app's import is on it too: a file a person opens becomes a graph and the Score is a projection (`legacy-score.js`). Storage, renderer and player still read the legacy `Score`; they move in G4–G5. |
| Tests | `npm test` (26 browser suites; needs `npm start`, network, puppeteer; they are chained with `&&`, so a failing suite hides every suite after it — run those alone), `npm run test:transcription-core` (16, including `beat_track_test.py`), `npm run test:arranger` (3), `npm run test:bench` (283 unit tests + 17 golden snapshots + 13 correctness fixtures), `npm run test:scoregraph` (205 node tests since G3, core + robust + golden by default), `npm run test:scoregraph:perf` (G3 A39, run alone), `npm run test:engrave` (149 node tests in 19 files on the G4c branch — `notation.test.js` and `svg.test.js` added; 132 in 17 files since the G4b fixer — `layout.test.js`, `practice.test.js` and `layout-mutation.test.js` added, with the L2 geometry metrics of `tests/engrave/l2.js` over every committed score at both screen configs; G4a's 95: `fromScore` round trip and provenance, A48 over every committed import file with the app's own `Score.finalize`, `agree`/`link`, the NotationPlan and its ledger with a 27-mutation source proof, the one-note tuplet boundaries, the deferred allow-list, the graph cache and its gzip, the E fixtures, the R corpus and its L1 baselines, the glyph table, the vendored VexFlow, the app wiring). The G4a page checks are local (G04 §32.12, §32.13): `tests/engrave/tools/app-source-check.js`, `u1-paths.js` (never saves on its own: each review-screen change is reloaded at once), `storage-failure.js`, `legacy-parity.js`, `a48-coverage.js` (the core-553 A48 gate, exit 1 on a new loss), `perf-persist.js`. **The browser suites open `127.0.0.1:8777` by name — that port is often another session's server with another tree; run them against your own with `node -r ./tests/engrave/tools/with-port.js` and `PPP_PORT` (check the page's `PPPEngrave.version`).** |
| CI | `.github/workflows/bench.yml`: a gate job (unit, `test:scoregraph` and `sg-roundtrip` since G1, `test:engrave`, the E-fixture/corpus `--check`s and `bench.js check --suite r|e|x` since G4a (with the L2 geometry metrics since G4b), `make-metrics.js --check` and `layout-hashes.js` since G4b, `make-outlines.js --check` on the G4c branch, golden, lint, provenance, correctness, smoke/core/robust run + check, replay-public, transcription-core, arranger) and a nightly job (mutation-check, full, the reviews' `adversarial.py`, `final_review.py`, `final_oracle.py`). The gate runs on a **pull request** or a push to `main`; pushing the branch alone runs nothing. The nightly schedule runs only from the default branch (`workflow_dispatch` runs it by hand). The gate has run on GitHub for PR #2, PR #3 and PR #4 and passed every time, and on `main` at `cc0da79`. |

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
   **Fixed in MX-1** (PR #13 `e37d37a`; section at the end of this file). The G0
   bench's model of the app (`ottava="app"`, known failure `octave_shift_playback`) is left for MX-2's rebaseline.
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
- `npm run test:scoregraph` runs its files in parallel, and on a fresh checkout several generate the same
  `tests/bench/out/g3/jobs-<suite>.jsonl` at once; written in place, a reader could take a half-written file (CI
  run 36174222416: 7 pedalled graphs, not ≥ 20). `g3_jobs.py` now writes a temp file and renames it into place,
  and `g3-graphs.js` throws on a short file (`g3-jobs-race.test.js`; `PPP_G3_JOBS_DIR` moves the cache).

## Next

- **Active goal: G4 Professional Engraving — G4a through G4e all CLOSED (PR #9 `df8a571`, PR #12 `62ede61`, PR #15
  `e3c8c5a`, PR #17 `b4fe019`, PR #19 `a6e1a75`, PR #23 `16ce784`, PR #26 `a33ccd3`) and M-H1 DONE (G04 §38);
  G4f-1 (the engineering evidence base, G04 §40) is done - not merged yet, branch `g4f1-benchmark`; next M-H2, then
  the flip, both the Lead's.** The order, gates and briefs are in `docs/PPP_MASTER_ROADMAP.md` (§14 current task, §15 next).
  - **MX-1 — CLOSED, merged as PR #13 (`e37d37a`)** after one independent review (NEEDS_FIX: BLOCKER 1, MAJOR 1 — octave
    lines missing in partial views and on cards), its Fixer and the Lead's re-check (section "MX-1 — playback correctness"
    at the end of this file). **Deployed 2026-09-26** (production `0ef0950`). Its follow-ups
    (saved-song migration keyed on `ottavaRule`, M4, M5, the G0 bench rebaseline) are MX-2 carry-overs (roadmap §5.2).
  - **M-H1 — DONE** (G04 §38): a fresh blind packet, new seed, published as an interactive artifact; the user rated all
    16 excerpts. Engrave preferred 5, legacy 2, tied 9; zero excerpts where only engrave looked wrong. The two
    legacy-preferred cases were checked by hand and are minor, non-blocking (§38.1, §38.2) — on the G4e watch list, not
    fixed now. The Verovio trigger (§7.3) does not fire (§38.4).
  - **G4f-1 — done, awaiting review** (G04 §40, DECISIONS G4-F1-1..5): mutation completeness (M1-M25, M22 new),
    `tests/engrave/tools/legacy-geometry.js` (new, A43), B2/B6 under CPU 4x throttle (A37), CI gate unchanged
    (~70s of A41's 90s budget) with nightly extended (full mutation suite + three puppeteer tools, not yet run for
    real), A46/A47/A48 re-confirmed. Findings for the Lead, not fixed here: legacy has 402 real notehead overlaps
    on the R corpus to G4's 0; the tuplet-count category of `legacy-geometry.js` is not a reliable A43 signal
    (explained, not a G4 gap); A47 has 2 already-known fallbacks, not a new one; the CI gate has only ~20s of
    headroom left.
  - Production keeps the legacy renderer until the flip (G4f-2, after M-H2).
  - What G3 left for G4 is in G03 §30–§31 and DECISIONS G3-D3, G3-D4 and G3-U10.
- **Production database (2026-09-25, decision D-0): Neon Free, $0.**
  - ppp-web's `DATABASE_URL` points at the Neon project `ppp`. It was verified identical to the Render data, with no
    writes lost. The URL is in `D:/PPP-db-backups/neon.env`, outside the repository; never commit it.
  - The shared Render free Postgres expires 2026-09-26 12:44 UTC and is left to expire.
  - **Deploy 2026-09-26 (user request): production runs `0ef0950`** (Render `dep-darc098u01pc73barsh0`, live 2026-09-25T18:41Z UTC). It ships G1 (ScoreGraph), G2 (import through the graph, MIDI), G3 (all off), the G4a–G4d-1b engine (not loaded by the app) and MX-1 (8va, pedal change, R4). Before: `72549cb`. Checked after the deploy:
    - `/health`, `/`, the app, `/api/auth/me`, `/api/shares` (110) all answered 200; the app serves the MX-1 scripts (`?v=9`).
    - In the live page, E18 imports with 8va notes sounding at the file's pitch and written an octave lower, marked `ottavaRule: 'D-1'`, and no page errors.
    - The first `/api/shares` request after the restart stalled once (the database waking); later requests answered in under 1 s.
    - Rollback: `render deploys create srv-dalt5s6k1f9s739cuetg --commit 72549cb…`.
  - Dumps and checksums are in `D:/PPP-db-backups/`.
- **G2 is merged and closed** (PR #4, `cc0da79`): schema v2, a MusicXML importer that no longer
  refuses whole files, MIDI, one import door with one report, the legacy Score adapter, the flip,
  and D7's written/sounding split. The independent review (§25) found BLOCKER 0 and one MAJOR, which
  §26 closed. **Follow-ups, none of them blocking, for whoever wants them:**
  - **R4** — a `.mid` with fewer than four notes does not open. The floor is `audio-score.js:1556`
    (`if (notes.length < 4) noNotes();`), which predates G2 and cannot be lowered without a new
    quantizer, so the work is to say so honestly: the message a person sees is "This MIDI file has
    no notes to read", and the file does have notes. 26 of the 29 M fixtures hit it (§25.5).
    **The message is fixed in MX-1** (four languages); the floor stays.
  - **R5** — `node tests/scoregraph/tools/shadow-legacy.js --check`, `app-import-check.js` and
    `pitch-layers-check.js` run locally, not in CI, because they need puppeteer and `npm start`.
    They are the only evidence for A32/A33, so an adapter change after this merge is not caught
    automatically. `ubuntu-latest` has Chrome; a nightly job could take them (§25.6).
  - Still deferred on purpose: storing the graph with a song (§24.10 — `importSource` goes into
    localStorage whole), **A38** and the arrangement, recording and OMR paths' own reader, which
    still call `parseMusicXML` directly (stages S4/S5, §25.8), and decisions D2, D4, D5 and D6.
- **G1 is merged and closed** (PR #2 `aa77d2e`, follow-up PR #3 `00081cc`). §26 records the two
  findings it closed. **Left open on purpose:** tuplet bracket grouping for split triplet pieces
  (**F1** — the app draws fewer brackets; **G3 owns tuplet engraving**, see issue 20 above; G3a groups them in the
  graph but is off, so F1 is still open in production), and
  F4–F8 (§25.3), none of them reachable today.
- **G3 = PARTIAL / DEFERRED (2026-09-24, G03 §31, DECISIONS G3-U9) — not COMPLETE.** The user chose to stop
  here and move to the next Goal without the M11 recordings. What exists, all switched off:
  - **G3a** (hands and staves, voices, rhythm representation, logical tuplets = G1 F1, keys by region, spelling and
    accidentals, beams, marks, behind a critic) is implemented, its other criteria PASS or PARTIAL by design (§29.9),
    but it **failed the blind human review A36** (§30: overall 16/20 with 18 needed, 4 rhythm losses with 0 allowed, usable
    12 = 12), so `PROFESSIONAL_DEFAULT` stays `'off'`. **G3b** (release → note value, voices from the performance) is
    off until M11. The automatic **8va** is off until issue 3 is fixed; the **pedal join** is off until the app's
    `change` playback is fixed.
  - **No user-facing G3 behaviour.** G3 off is byte-identical to the pre-G3 `main` (`cc509e2`): MusicXML and stats of
    879 smoke/core/robust transcriptions, and graph, export, legacy Score and report of all 504 committed
    MusicXML/MXL/MIDI files through the import door (§31.2); `ab` smoke/core PASS with every case the same.
  - The feature-gated infrastructure is **on `main` since PR #7** (`c5474c2`, merged 2026-09-24, CI gate PASS),
    with the human review result (`tests/bench/human/g3/review-2026-09-24.json`). Regression before the merge: every
    CI gate step, mutation-check 49/49 and `npm test` 25/26 — the one failure (no transcribe venv in the worktree)
    fails the same way on the pre-G3 `main` (§31.3).
  - **To reopen** (§31.5): G3a — a Fixer on A36's H1 (moves that create rests) and H2 (rests and dots inside
    triplets), a set drawn with a new seed, and a second A36 in the PPP app's renderer with the excerpts pre-split
    into `CLEAN_INPUT` / `UPSTREAM_ERROR` (G3-U10). G3b — M11 (below). History: implementation §27, review §28,
    Fixer §29, A36 §30.
  - Local-only leftovers: branch `g3-dev-review-tool` (`9d02842`, the dev review page, not pushed, not for `main`).
- The full-suite baseline (and the others) predate main's `audio-score.js` changes (F7): decide on a
  rebaseline at `aff7080` before relying on `check --suite full`.
- G0 is merged (PR #1, `aff7080`) and CI is on. The one thing still open from G0 is what to do with
  local `main`'s `d82bb71`, which must never be pushed.
- Before any Goal that changes onset, beat, tempo, metre or note-value (release) inference: record
  the real performances above (M11). **M11 is deferred** (G3-U9): nothing has been recorded and no recording tool
  exists yet; G3b stays off until it is done.
- Later goals should target the measured issues above: 1, 2 and 18 decide most of the unusable
  cases (every compound-metre and simple-duple case; half of the rest on note values); 3, 10 and 11
  are the largest per user. Follow the loop in `tests/bench/README.md` ("Changing the SUT") and
  report the core, robust and hold-out usable-rate Δ.
- G0 leftovers: Step 14 (arrangement invariants) was not done; see G00 §16.6 and §18.7. Voices,
  beams and stems have no metric yet (golden labels a voice change STRUCTURAL_CHANGE); G4.
- Leftovers now that G2 is in: remove `buildXml` and `opts.legacyWriter`, and `parseMusicXML`
  with `PPP.legacyImport`, after one release — each is a way back, kept deliberately, and each has a
  shadow check to prove it can go. The app's storage, renderer and player onto the graph is
  G4–G5 (G01 §15.2 S4–S5, Appendix B).

### MX-1 — playback correctness (2026-09-25)

**CLOSED — merged as PR #13 (`e37d37a`)** after one independent review (NEEDS_FIX: BLOCKER 1, MAJOR 1), its Fixer
(`be2925a`) and the Lead's re-check (the views check fails on `8981750` and passes after; each fix reverted alone is caught). Record:
`docs/GOALS/MX1_PLAYBACK_CORRECTNESS.md` (what changed by file and line, the audit table, the tests). Decisions MX1-D1…D12.

- **Review and fix (record §7).** The review found NEEDS_FIX: views that show some bars of a longer 8va (This part, the
  phone, the review staff, the import preview, the loop card) and the song and share cards drew its notes an octave low
  with no sign. Fixed: those views draw the part of the line they show ("(8va)" when it carries on), and cards print the
  notes where they sound (previews already stored included). Every Score finalize reads afresh is now marked
  `ottavaRule: 'D-1'`, for MX-2's migration of older saves. A page check proves drawn = played in every view on all 34
  octave-line files (2,484 renders); it fails on the pre-fix commit `8981750`.

- **What changed.**
  - 8va (issue 3, decision D-1): `parseMusicXML` reads `<octave-shift type="down">` as an 8va, and `legacy.toScore` /
    `fromScore` sign it the same way. `Score.finalize` leaves what sounds alone and prints the note at sounding − shift
    (`writtenP`, `writtenMidi`), transposing parts included. Playback, MIDI out, practice judging, follow, the falling notes
    and the keyboard now play an 8va where the file says; the legacy renderer prints it where the edition does, under an
    "8va" over the staff.
  - A printed pedal `change` lifts the damper and presses it again: CC64 0 then 127 for MIDI out; the sampler lets go
    what only the pedal held. A numeric `<sound damper-pedal>` depth is still a half pedal. `pedalJoin` stays off.
  - R4: a `.mid` under the four-note floor now says "PPP needs at least four notes to write a score, and this MIDI file
    has fewer." in en/ko/ja/zh. The floor stays.
  - ScoreGraph library 1.3.1 (adapter behaviour), `?v=9` on the three changed scripts.
- **Audit.** All 30 catalogue and sample files with a line (2,229 notes), the 4 fixtures and the 2 G0 hold-out files
  (not named) are encoded as sounding pitch, the MusicXML way; nothing goes to MX-2 from it
  (`node tests/scoregraph/tools/ottava-audit.js`).
- **Evidence** (the base is `1c92fc4` served from `git archive`, the same checks run against both):
  - New tests fail on the base and pass here: `tests/scoregraph/app-playback.test.js` 7/7 (0/7 on the base), and in the
    browser suites playback-scheduler +5, follow +3, midi +4, engraving +2, pdf-layer +1.
  - `test:scoregraph` 212/212, `test:engrave` 132/132. A48 is exact and not loosened: 544 files, 540 exact, the same 4
    named losses; the 13 captured Scores (two re-captured from this page) and a Score saved before MX-1 come back exactly.
  - `ottava-check.js` (page): 34/34 files, 19,582 notes, 2,255 under a line all measured on the SVG; 34/34 fail on the base.
  - G0: unit 283 OK, golden 17/17, sg-roundtrip, lint-corpus, correctness 13/13, smoke/core/robust run + check PASS,
    replay-public PASS. `ab --suite core` and `smoke`: PASS, every case the same (553/553 and 44/44; `known_failures`
    identical).
  - `shadow-legacy --check` unchanged: 398 files, 375 identical, 23 listed, 0 unexpected (the same on the base).
    `pitch-layers-check` and `app-import-check` pass.
  - `legacy-parity` (base vs this): only the 8va fixture's two renders differ. Extended to every octave-line file and 12
    files without one: 47 renders differ, all in octave-line files; the 38 renders without a line are byte-identical.
  - Browser suites on this worktree's server: the remaining failures are the environment's (the refused
    127.0.0.1:8788/health, no transkun venv) and fail the same way on the base.
- **What remains.** Songs saved before MX-1 keep the reading they were saved with (MX1-D3; a course piece already on the
  shelf reopens from its slot). The G0 bench still models the old app reading — `ottava="app"`, known failure
  `octave_shift_playback`, C10/C11 notes, unit r20 — for MX-2's rebaseline (MX1-D7). Audiveris's encoding of a line is
  unchecked (no committed OMR output has one).
