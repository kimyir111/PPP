# PPP score-quality benchmark (G0)

This directory measures **how good the sheet music PPP writes is**, with numbers that are
reproducible and do not need anyone to look at a score. It does not make the scores better.
Its job is to tell an improvement from a regression. Design: `docs/GOALS/G00_QUALITY_FOUNDATION.md`.

What it measures: mainly `audio-score.js` `toMusicXml()`, the one function every
recording-to-score path goes through (helper ensemble, browser model, arrange mode). It also has a
live OMR tier and a replay tier for recorded AMT output.

How: each licence-clean **reference score** in the repository is played by a deterministic
**synthetic performer** (exact, human, rubato, AMT-like errors, with or without beat information).
The performance goes through `toMusicXml()`. The score that comes out is read back by the same rules
the app uses (`parseMusicXML`) and compared with the reference. Notes are matched in seconds and
scored in notation terms: metre, key, tempo, bar positions, note values, hands, spelling, false
ties, tuplets and bar integrity.

Requirements: Python ≥ 3.10 (standard library only) and Node (any recent version; the baseline was
recorded with v24). No npm install, no browser, no network, no GPU.

## Commands

```sh
npm run bench:smoke          # 32 cases, < 1 s: run + check against the baseline
npm run bench                # core gate, 523 cases, ~15 s: run + check (exit 1 on a regression)
npm run bench:full           # every reference incl. hold-out, 4,172 cases (nightly / manual)
npm run test:bench           # the benchmark's own unit tests + golden snapshots

python tests/bench/run.py list                        # corpus, suites, baselines
python tests/bench/run.py lint-corpus                 # check the reference registry
python tests/bench/run.py run   --suite core          # writes tests/bench/out/core/
python tests/bench/run.py check --suite core          # exit 0 PASS · 1 REGRESSION · 2 ERROR
python tests/bench/run.py ab --suite core --a git:HEAD --b worktree   # what did my change do?
python tests/bench/run.py golden                      # exact-output snapshots
python tests/bench/run.py mutation-check              # proves the gate catches real regressions
python tests/bench/run.py update-baseline --suite core --reason "..."
python tests/bench/run.py relock --suite core --reason "..."
python tests/bench/run.py legacy --manifest PATH      # a tests/golden_benchmark.py manifest
python tests/bench/run.py run --suite-file PATH       # a private suite (outputs stay beside it)
python tests/bench/run.py conformance                 # T1: reader vs the app's parseMusicXML
python tests/bench/run.py run --suite omr-live        # T1: PDF/PNG/JPG through the app's OMR import
python tests/bench/run.py record-replay               # T2: record helper /transcribe fixtures
python tests/bench/run.py run --suite replay-public   # replay recorded helper results
```

Every command prints UTF-8 even on a cp949 console, with no `PYTHONIOENCODING` needed.

## The two layers of regression protection

1. **Metric gate** (`run` + `check`). A new `results.json` is compared with the committed
   baseline (`baselines/<suite>.json`) at three levels:
   - each aggregate metric, against its own tolerance;
   - each tag group (`set:hymns`, `profile:amt`, `beats:none`, …), so one group's gain cannot hide
     another group's loss;
   - each case: a case that errors now, or loses ≥ 10 SQI points, fails.

   The tolerances live in the suite file's `gate` block, so changing one shows up in review.
2. **Golden snapshots** (`golden`). Fourteen fixed inputs, including the lock, arrangement and
   PM2S-grid paths, must produce **byte-identical** MusicXML and the same key stats fields. A
   change that leaves every metric alone still shows up here. The output is a per-bar diff with
   the metric changes.

`mutation-check` shows the gate is not decorative. It copies `audio-score.js`, plants five known
regressions and one no-op, and requires each regression to fail on the metric it damages and the
no-op to pass with a byte-identical `results.json`. Last result:

| mutation | what it breaks | verdict | metric that failed (baseline → mutant) |
| --- | --- | --- | --- |
| MUT-HANDS | hand split at middle C | REGRESSION | `notation.hand.accuracy` 0.888 → 0.833 |
| MUT-KEY | key always C major | REGRESSION | `struct.key.fifths_exact` 0.895 → 0.619 |
| MUT-DUR | every note one 16th long | REGRESSION | `notation.duration.accuracy` 0.838 → 0.182 |
| MUT-METRE | metre always 2/4 | REGRESSION | `struct.time_sig.exact` 0.489 → 0.199 |
| MUT-PHASE | bar phase one beat late | REGRESSION | `notation.onset_pos.accuracy` 0.373 → 0.128, `struct.downbeat.f1` 0.543 → 0.245 |
| MUT-NOOP | a comment | PASS | identical `results.json` |

## Reading the results

`tests/bench/out/<suite>/` (git-ignored, overwritten on every run):

| file | what |
| --- | --- |
| `summary.md` | **Start here.** Verdict, headline metrics with Δ against the baseline and against the first (anchor) baseline, a per-tag table, the cases that moved most, the lowest cases, errors, and hold-out aggregates. |
| `results.json` | Every case's metrics. **Byte-identical** for the same code and inputs (checked by A5). |
| `run.json` | Environment and timing (not deterministic, so kept separate). |
| `cases/<key>.musicxml` | What PPP wrote for that case. Open it in the app (Add Sheet Music → MusicXML) to look at it. `index.json` maps keys to case ids. |

Case id: `<reference>|<profile>|<beats>|s<seed>`, e.g. `hymns/amazing-grace|human|oracle|s1`.

- **Profiles**:
  - `deadpan`: exact timing.
  - `human`: ±15 ms jitter, varied releases, rolled chords.
  - `rubato`: ±10 % tempo drift.
  - `amt`: `human` plus AMT-like errors (≈4 % dropped notes, ghost octaves, merged repeats,
    offset noise).
- **Beats**:
  - `none`: the onset tracker.
  - `oracle`: a perfect Beat This (beats + downbeats, confidence 0.9).
  - `oracle-noisy`: ±20 ms, 5 % missing.
  - `lowconf`: confidence 0.3, which takes the fallback path.

The main metrics (full definitions in G00 §8.4; ↑ better unless marked ↓):

| metric | question it answers |
| --- | --- |
| `notes.identity.f1` | Are the notes that were played in the score at all (±300 ms, per pitch)? |
| `notation.ioi.accuracy` | Is the rhythm between successive onsets written right (allowing a consistent ×2/×½/×3 tempo reading)? |
| `notation.onset_pos.accuracy` | Is each note in the right bar at the right beat (strict)? |
| `notation.duration.accuracy` | Are note values right (ties merged)? |
| `notation.hand.accuracy` | Right hand on the treble staff, left on the bass? |
| `notation.spelling.accuracy` | F♯ vs G♭? |
| `notation.ties.extra_per_100` ↓ | False ties per 100 notes (the 6/8-for-3/4 symptom). |
| `struct.time_sig.exact` / `.score` | Metre right (score gives partial credit: 2/4↔4/4 = 0.5, 3/4↔6/8 = 0.25). |
| `struct.key.fifths_exact` | Key signature right. |
| `struct.tempo.ok_effective` | Is the tempo **the app plays** (`<sound tempo>` first) within ±4 %? |
| `struct.tempo.ok_written` | Is the **printed** metronome mark within ±4 %? |
| `struct.downbeat.f1` | Do bar lines fall where the performance's bars start (±70 ms)? |
| `read.bar_integrity` | Share of bars that are neither overfull nor badly underfull. |
| `sqi` | 0–100 weighted summary (G00 §8.5). A dashboard number; the gate never relies on it alone. |

## The corpus

`corpus/references.json` lists every reference, with its sha256 and licence. Only files committed
to git are used; files other sessions are still writing are ignored. Sets:

| set | files | source |
| --- | --- | --- |
| `micro` | 24 | `corpus/micro/`, written for the benchmark by `tools/make_micro.py` (CC0). Each one isolates one question (pickup, 6/8, triplets, ties, D♭ spelling, melody in the bass, 5/4, a tempo change, …). |
| `catalog` | 3 | `catalog/*.musicxml` (CC0) |
| `samples` | 1 | `samples/prelude-fragment.musicxml` |
| `hymns` | 88 | `catalog/hymns` (Open Hymnal, public domain) |
| `method` | 182 | `catalog/method` (Beyer and Czerny 100: CC0 transcriptions; others PDMX PD/CC0) |
| `omr` | 1 | `corpus/omr/`, generated from `tests/fixtures/truth.json` (the OMR suite only) |

`corpus/excluded.json` lists what is left out and why:
- **L5**: 29 files with `<octave-shift>`. The app's 8va reading is disputed (G00 §14 I3).
- **L8**: 23 files whose own bars are overfull or underfull.

**Hold-out.** About one in five hymns and method pieces (`fnv1a32(id) % 5 == 0`) is hold-out.
Those pieces are only in `full` (seeds 11 and 12), and reports show only their aggregate.
When tuning a heuristic, do not look at hold-out cases (`--reveal-holdout` exists for
debugging, not for tuning); report the hold-out aggregate change with the PR.

**Known reference defects handled in `expect`.** 78 hymns (every hymn not in C) write their
notes without the key signature's `<alter>`. Amazing Grace, for example, has F♮ throughout. PPP
therefore plays them with wrong notes (G00 §14 I10). Their key and spelling "truth" is wrong, so
those references carry `expect.skip_metrics` for `struct.key.fifths_exact`, `struct.key.mirex` and
`notation.spelling.accuracy`. Rhythm, metre and hands still count. `lint-corpus` rule L12 keeps this
honest: a reference whose notes contradict its signature must skip those metrics. When the
hymns are fixed, their sha256 changes, lint fails with L2, and they are re-registered without the
skip.

### Adding a reference

1. Commit the MusicXML (lint rule L1: only committed files count). Licence-clean only: public
   domain, CC0, or written by PPP.
2. Add an entry to `corpus/references.json`:
   `{"id": "method/beyer/107", "path": "catalog/method/beyer/107.mxl", "sha256": "<see below>", "set": "method", "book": "beyer", "license": "...", "expect": {}, "holdout": <rule>, "note": ""}`.
   - Hash: `python -c "import sys; sys.path.insert(0,'tests/bench'); from pppbench import util; print(util.content_sha256('catalog/method/beyer/107.mxl'))"`.
     CRLF is read as LF, so the pin is the same on Windows and Linux.
   - `holdout`: `true` for hymns/method when `fnv1a32(id) % 5 == 0`
     (`from pppbench import corpus; corpus.holdout_for("method", id)`).
     Decide it once and never change it.
   - `expect` needs `tempo_qpm` if the file has no tempo. Add `key.mode` if the file lacks
     `<mode>` and you know it. Add `skip_metrics` if part of the file's truth is wrong.
3. `python tests/bench/run.py lint-corpus` must report 0 errors. Octave-shift files and files with
   broken bars belong in `excluded.json` instead.
4. Put the id into the suite's `references` list (suites never pick files up by themselves),
   then `relock --suite <s> --reason "add ..."`, `run --suite <s>`, and
   `update-baseline --suite <s> --reason "add ..."`. Commit the reference, registry, suite,
   lock and baseline together.

(`lint-corpus --init` rebuilds the whole registry from the committed files. It is for a full
re-registration, and it rewrites hand-made `expect` entries unless they are in
`pppbench/registry_notes.py`.)

## Suites

| suite | cases | use |
| --- | --- | --- |
| `smoke` | 32 (16 references × 2) | before a commit |
| `core` | 523 (141 references × deadpan/none, human/none, human/oracle + 60 amt + 40 rubato) | **the CI gate** |
| `full` | 4,172 (298 references × 7 profiles × 2 seeds; hold-out seeds 11, 12) | nightly, hold-out report |
| `mutation` | 141 | `mutation-check` only |
| `golden` | 14 snapshots | `golden` |
| `omr-live` | 4 fixtures | T1, needs the app server + helper with Audiveris |
| `replay-public` | recorded fixtures in `replay/` | T0-R, needs only Node to replay |

Each synthetic suite has a `<suite>.lock.json` with the sha256 of every generated input. `run`
regenerates the inputs and refuses with **`INPUT_DRIFT`** (exit 2) if one byte differs. That
catches a change to the generator, the reader or a reference that would otherwise quietly move
every number.

## Changing the SUT: the loop for later goals

1. Before you start: `npm run bench` must PASS. Pick the metric and tag you are going after
   (for example `struct.time_sig.exact` on `metre-class:simple-duple`).
2. While working: `python tests/bench/run.py ab --suite core --a git:HEAD --b worktree` shows what
   your working copy changed, per metric and per case, with no baseline involved.
3. When done:
   1. `run --suite core` and `check`;
   2. `run --suite full` for the hold-out aggregate;
   3. `golden` (and `golden --bless --reason "..."` if the output change is intended);
   4. `update-baseline --suite smoke|core --reason "..."`;
   5. put the SUT change, baselines and golden files in **one commit** whose message gives the
      headline Δ (e.g. `core SQI 81.7→83.0; time_sig.exact +0.04; hymns SQI −0.3`).
4. Never raise a tolerance to make a regression pass. Tolerance changes are suite-file diffs and
   get reviewed like code.

`update-baseline` refuses to run if `audio-score.js` changed after the run, or if the run used
another SUT. The first baseline is kept as the `anchor`, so drift across many small updates stays
visible in every summary.

## Private suites (copyrighted recordings and official scores)

Keep them outside the repository. A suite file there, e.g. `C:/private/ppp-bench/private.json`:

```json
{"schema": "ppp.bench-suite/1", "name": "private-real", "kind": "replay", "cases": [
  {"id": "looping-the-rooms", "reference": "looping-the-rooms.musicxml",
   "reference_bar_starts": "looping-the-rooms.bars.json", "helper_result": "looping-the-rooms.helper.json",
   "expect": {"tempo_qpm": 162}},
  {"id": "lulu-official-omr", "kind": "prediction-file", "reference": "lulu.musicxml", "prediction": "lulu.omr.musicxml"}]}
```

- `replay` cases put a saved helper `/transcribe` result through `toMusicXml`.
  `reference_bar_starts` gives the bar starts in seconds (bars + 1 values, checked by a person).
- `prediction-file` cases score an existing MusicXML (for example OMR output) with bar-level
  alignment.
- Run with `run --suite-file C:/private/ppp-bench/private.json`. Outputs go to `out/` and the
  baseline to `baseline.json` beside the suite file. Writing them inside the repository is refused
  (`PRIVATE_OUTPUT_IN_REPO`).
- The older manifest format still works: `legacy --manifest ...` runs
  `tests/golden_benchmark.py`'s own comparison and reports quarter-beat tolerances as quarter
  beats.

## Tiers and environments

| tier | command | needs | without it |
| --- | --- | --- | --- |
| T0 synthetic + golden | `run`, `check`, `golden`, `mutation-check` | Python + Node | – |
| T1-C conformance | `conformance` | `npm start`, network (the page loads React/Babel from unpkg), puppeteer | `SKIPPED: <reason>`, exit 0 (`--require-env` → 2) |
| T1-O OMR live | `run --suite omr-live` | the above + `npm run omr` with Audiveris | SKIPPED |
| T2 replay recording | `record-replay` | the helper with transcription (TransKun/Kong/Beat This), the transcribe venv (numpy, for `tools/render_piano.py`), ffmpeg | SKIPPED |
| T0-R replay | `run --suite replay-public` | Node | – (fixtures are committed) |

puppeteer is found in the repository's `node_modules` or in `PPP_BENCH_NODE_MODULES` (for
example a git worktree without its own `node_modules`). The transcribe venv's python is found
at `tools/transcribe-venv/Scripts/python.exe` or in `PPP_TRANSCRIBE_PYTHON`.

**Conformance** runs the app's own `PPP.parseMusicXML` in the real page on every core reference,
every sample, the 29 octave-shift files and 50 of the SUT's predictions, then compares bars
(start, length, metre, key), notes (bar, beat, value, sounding pitch, hand), tempo and staff
count with this reader. A difference means the benchmark no longer measures what PPP shows:
fix `pppbench/musicxml.py`, never the app.

**Replay.** `record-replay` renders a reference's performance to WAV with the Salamander samples
(CC BY 3.0; WAVs are never committed). It sends the WAV to the helper's `/transcribe` as a file
upload named `ppp-bench-<key>.wav` (so the catalog search cannot answer it) and saves the
helper's result with the truth and provenance in `replay/<key>.json`. Replaying a fixture is
deterministic. Recording is not: GPU inference and model versions vary. Re-record deliberately,
then rebaseline `replay-public`.

## Common errors

| code | meaning | what to do |
| --- | --- | --- |
| `INPUT_DRIFT` | A generated input differs from the lock, or the baseline was recorded against another lock. | If you changed the generator, reader or a reference on purpose: `relock --reason`, then `update-baseline --reason`. Otherwise find what changed. |
| `VERSION_MISMATCH` | `READER_VERSION`/`METRICS_VERSION`/`SQI_VERSION`/`GENERATOR_VERSION` differ from the baseline's. | Rebaseline. Bump the version whenever you change a definition (`pppbench/__init__.py`). |
| `SUITE_CHANGED` | The suite's references or matrix changed. | Relock and rebaseline with a reason. (Gate tolerances are not part of this hash.) |
| `NO_BASELINE` | No baseline for the suite yet. | `update-baseline`. |
| `STATS_SHAPE` | `toMusicXml`'s `stats.barStarts` no longer has bars + 1 values. | The SUT's stats contract changed: update `pppbench/timemap.py`, do not guess. |
| `MUTATION_ANCHOR_MISSING` | A mutation's search string is no longer in `audio-score.js` exactly once. | Update the anchor in `pppbench/mutation.py` to an equivalent line. |
| `NOTATE_NO_NOTES`, `NOTATE_…` | `toMusicXml` threw for that case. | A new one is a regression; look at the case. |
| `FILTERED_RUN` | `--filter` runs cannot be checked or baselined. | Run the whole suite. |

## Layout

```
run.py            CLI
pppbench/         reader (musicxml.py), canonical score, corpus + lint, perform (synthetic
                  performer), timemap, align, metrics/, suite + locks, runner, aggregate,
                  compare (gate), report, golden, mutation, legacy, private (replay/prediction
                  files), tiers (T1/T2), projection (app Score -> canonical)
node/             notate.js (SUT adapter), conformance.js, omr-live.js (puppeteer, T1 only)
tools/            make_micro.py, make_omr_reference.py, render_piano.py, record_replay.py
corpus/           references.json, excluded.json, micro/, omr/
suites/           suite definitions and input locks
baselines/        committed baselines (full: aggregates only)
golden/           inputs/, expected/, BLESS_LOG.md
replay/           recorded helper results (T0-R)
unit/             unit tests (python -m unittest discover -s tests/bench/unit -t tests/bench)
out/, .cache/     outputs and scratch (git-ignored)
```

## G0 acceptance record

Filled in from the actual runs; see the end of this file.
