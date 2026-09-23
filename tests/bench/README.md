# PPP score-quality benchmark (G0)

This directory measures **how good the sheet music PPP writes is**, with numbers that are
reproducible and do not need anyone to look at a score. It does not make the scores better.
Its job is to say "worse" whenever a user would get a worse score, and never to call a real
improvement a regression. Design: `docs/GOALS/G00_QUALITY_FOUNDATION.md` (§17 and §19 are the
independent reviews, §18 and §20 the fixes they led to).

What it measures: mainly `audio-score.js` `toMusicXml()`, the one function every
recording-to-score path goes through (helper ensemble, browser model, arrange mode). It also has a
live OMR tier, a replay tier for real model output, and an audit of the catalogue PPP ships.

How: each licence-clean **reference score** in the repository is played by a deterministic
**synthetic performer** (exact, human, rubato, AMT-like errors, sustain pedal, with or without beat
information). The performance goes through `toMusicXml()`. The MusicXML that comes out — the
artifact the user gets — is read back and compared with the reference: notes are matched in
seconds and scored in notation terms.

Requirements: Python ≥ 3.10 (standard library only), Node (the baseline was recorded with v24) and
a git checkout with the `git` executable: only committed files are truth, so `run`, `lint-corpus` and
`known-defects` read `git ls-files` and stop with `ERROR NEEDS_GIT` (exit 2) without it. No npm
install, no browser, no network, no GPU.

## Commands

```sh
npm run bench:smoke          # 44 cases, ~1 s: run + check against the baseline
npm run bench                # core gate, 553 cases, ~20 s: run + check (exit 1 on a regression)
npm run bench:full           # every reference incl. hold-out, 4,976 cases (nightly / manual, ~2-3 min)
npm run test:bench           # unit tests + golden snapshots + musical correctness

python tests/bench/run.py list                        # corpus, suites, baselines
python tests/bench/run.py lint-corpus                 # check the reference registry
python tests/bench/run.py run   --suite core          # writes tests/bench/out/core/
python tests/bench/run.py check --suite core          # exit 0 PASS · 1 REGRESSION · 2 ERROR
python tests/bench/run.py run   --suite robust        # a variant of the synthetic performer (see Tiers)
python tests/bench/run.py ab --suite core --a git:HEAD --b worktree   # what did my change do? (any suite, fixture suites too)
python tests/bench/run.py golden                      # semantic + byte snapshots
python tests/bench/run.py correctness                 # the reader against independent MusicXML fixtures
python tests/bench/run.py known-defects               # catalogue defects PPP ships (measured, not fixed)
python tests/bench/run.py sg-roundtrip                # every committed MusicXML through ScoreGraph and back (G1)
python tests/bench/run.py mutation-check              # proves the gate catches 40 planted regressions
python tests/bench/run.py update-baseline --suite core --reason "..."
python tests/bench/run.py relock --suite core --reason "..."
python tests/bench/tools/make_provenance.py [--check] # licence evidence manifest
python tests/bench/run.py legacy --manifest PATH      # a tests/golden_benchmark.py manifest
python tests/bench/run.py run --suite-file PATH       # a private suite (outputs stay beside it)
python tests/bench/run.py conformance                 # T1: parser parity with the app
python tests/bench/run.py omr-live                    # T1: PDF/PNG/JPG through the app's OMR import
python tests/bench/run.py record-replay               # T2: record helper /transcribe fixtures
python tests/bench/run.py run --suite replay-public   # replay recorded helper results
python tests/bench/review/adversarial.py              # the independent review's checks (nightly)
python tests/bench/review/final_review.py             # the final review's mutations (nightly)
python tests/bench/review/final_oracle.py             # correct outputs engraved differently (nightly)
```

Every command prints UTF-8 even on a cp949 console, with no `PYTHONIOENCODING` needed.

## What a result says

Three layers, in this order of importance:

1. **Usable-score rate** — the release headline. A case is *usable* when every **critical gate**
   that applies to it passes. One failed gate makes a score unusable however good its other numbers
   are. The gates and why (`pppbench/metrics/critical.py`):

   | gate | passes when | why |
   | --- | --- | --- |
   | `critical.meter` | the main time signature (read from the MusicXML) is exact, and ≥ 95 % of notes sit in bars whose time signature is the music's | every bar is read in it |
   | `critical.playback_tempo` | the app's score tempo (`<sound tempo>` first: practice tempo, metronome, tempo %) is within ±4 %, and the player's tempo map (every mark, `PianoScore.tempoMap`) is within ±4 % for ≥ 95 % of notes; missing = fail | practice and playback |
   | `critical.beat_placement` | ≥ 90 % of kept notes in the right bar and position | what a reader reads |
   | `critical.note_values` | ≥ 80 % of kept notes have the music's value, both as played (`<duration>`) and as printed (`<type>`, `<dot>`, tuplet) | the written rhythm |
   | `critical.pitch_integrity` | identity F1 ≥ 0.95 against the music | wrong or missing notes |
   | `critical.key` | the first key signature is exact, and ≥ 95 % of notes are read under the music's key signature (n/a when the registry cannot trust the key) | unmarked notes' pitch |
   | `critical.hands` | ≥ 80 % of notes on the right hand (n/a for one-staff references) | PPP practises hands separately |
   | `critical.structure` | no overfull, underfull or incomplete bar (every staff fills its bar; a short bar only as a pickup, its complement or half of a bar split at a repeat), no empty bar added at an end, bar numbers counting up by one, the app plays the bars in the music's order (no repeat sign added, moved or changed), stats that describe the MusicXML | structure; the app finds bars by number and plays repeats |
   | `critical.accidentals` | every accidental the page needs is printed, and none names another pitch | the reader's pitch |
   | `critical.pedal` | when the performance used the pedal, ≥ half its changes are written | sustain in playback |

   The thresholds were set from what a player needs, not fitted to current results
   (`pppbench/metrics/critical.py` gives each reason). The 95 % for tempo, metre and key sequences
   is "at most 1 note in 20 under the wrong mark": a change written about a bar away from the music's.
   The 80 % for note values is less strict than positions (90 %) because a wrong value leaves the
   note where it is played; past 1 in 5 wrong values, most bars show another rhythm than the music.
   **Note values depend on articulation**: the SUT writes how long a key was held, so the synthetic
   performers' release models decide much of this gate (core 49 % pass; `robust`, whose performer
   releases 30–120 ms early, 18 %). Those release models are not checked against real playing (see "How far
   from synthetic the inputs are" below): a change to how PPP turns releases into note values needs real recordings.
2. **Critical-gate pass rates** and the other metrics below, per case and per tag.
3. **Diagnostic score** (`sqi`, version `sqi/2`): a continuous 0–100 trend line. It is not a
   verdict — `summary.md` lists the cases whose diagnostic score is at or above the mean yet fail a
   critical gate (199 in core at the metrics/4 baseline). Weights and reasons are in
   `pppbench/metrics/composite.py`: identity 0.20, bar position 0.15, rhythm 0.10, note values 0.10,
   metre 0.10, playback tempo 0.10, key 0.10, hands 0.10, spelling 0.05. The position, value, hand and
   spelling components count against every reference note, so a lost note also counts as unplaced.

**Missing output is never "not applicable".** A metric is null only when the truth makes it not
apply (a reference without tempo, a one-staff reference, a key the registry marks as untrustworthy,
a performance without pedal, a reference without tuplets). When the reference has a tempo and the
prediction writes none, the tempo metrics are 0. Whether a metric applies never depends on what
the prediction wrote, so removing a spurious element cannot look like lost coverage.

**Everything the user sees is read from the MusicXML.** The SUT's `stats` are used only for what
the MusicXML cannot say (where each bar falls in the recording) and are checked against it
(`struct.stats_consistent`). Positions become seconds with the SUT's own beat model: beats evenly
spaced in the score, time linear between beats, the grid extended past the first and last beat at
their interval (as `audio-score.js` `tickToSec` does), so a pickup written as a full bar is timed
right (G00 §19 m1).

**Read the way the app reads.** Where the app uses a field, the benchmark reads it the same way:
the note glyph from `<type>`/`<dot>`, bars by number, every tempo mark for the player's timeline
(`PianoScore.tempoMap`: at one position the mark read last wins) and the first one for the score
tempo, the clef in force per staff.

The main metrics (↑ better unless marked ↓; `…_ref` variants count against reference notes):

| metric | question it answers |
| --- | --- |
| `notes.identity.f1` | Are the notes that were played in the score at all (±300 ms, per pitch)? |
| `notation.ioi.accuracy` | Is the rhythm between successive onsets written right (allowing a consistent ×2/×½/×3 reading)? |
| `notation.onset_pos.accuracy` | Is each note in the right bar at the right beat? A pickup written as an implicit bar or as a full bar with rests are both right. |
| `notation.duration.accuracy` | Are note values right as the app plays them (`<duration>`, ties merged)? |
| `notation.duration.page_accuracy` | Are note values right as the page shows them (the printed type, dots and tuplet of every tied piece)? |
| `notation.note_shape.consistency` | Does every printed note and rest shape say how long it lasts? The app draws `<type>`/`<dot>` and plays `<duration>`. |
| `struct.tempo.timeline_accuracy` / `struct.time_sig.timeline_accuracy` / `struct.key.timeline_accuracy` | Over the whole score, note by note: played at the right tempo (the app player's tempo map), read under the right time signature, under the right key signature? A change in the wrong place, or a wrong one late in the piece, counts. |
| `struct.measure_numbers.valid` / `.app_onset_accuracy` | Do bar numbers count up by one? Where does the app put each note, given that it finds bars by number (repeated numbers lay bars over each other)? |
| `read.bar_completeness` | Does every staff fill every bar? Excepted: the first and last bar (pickup, complement) and the two halves of a bar split at a repeat sign or ending — in a prediction only where it writes that repeat (judged by `struct.form.order_exact`) or where the reference splits the same bar; in a reference also at a double or final bar line ("Fine"). Never `implicit="yes"`: a prediction cannot excuse its own short bar (G00 §21). |
| `struct.form.order_exact` | Does the app play the bars in the music's order? The app expands repeat signs and endings (`Score.form`) into what it plays. Against a performance (which takes no repeat) the score may have no repeat at all or exactly the reference's repeats; against a score (OMR, prediction files) only the reference's. `plays_per_bar` (diagnostic): bars played per bar written. |
| `read.ledger_lines.heavy_rate` ↓ | Notes that need four or more ledger lines under the clef in force (a wrong clef shows here). |
| `notation.accidentals.courtesy_per_100` ↓ | Printed accidentals the page does not need, per 100 notes (clutter). |
| `notation.hand.accuracy` | Right hand on the treble staff, left on the bass? |
| `notation.spelling.accuracy` | F♯ vs G♭? |
| `notation.accidentals.required_recall` | Are the accidentals the page needs printed (standard engraving rules)? |
| `notation.pedal.f1` / `notation.pedal.false_per_min` ↓ | Are the performer's pedal changes written (performances that used the pedal) / pedal changes written that the performer never made, per minute. Truth is the performance: in replay the helper's pedal is the AMT's guess, not truth (rendered fixtures have no pedal; a real recording's pedal is unknown and not scored). |
| `notation.ties.extra_per_100` ↓ | False ties per 100 notes (the 6/8-for-3/4 symptom). |
| `notation.tuplets.f1` / `notation.tuplets.false_per_100` ↓ | Tuplets kept (references with tuplets) / tuplets invented. |
| `struct.time_sig.exact` / `.score` | Metre right (score: 2/4↔4/4 = 0.5, 3/4↔6/8 = 0.25, 3/4↔4/4 = 0). |
| `struct.key.fifths_exact` | Key signature right. |
| `struct.tempo.ok_effective` / `ok_written` / `present` | The app's score tempo (first mark: practice tempo, metronome, tempo %) within ±4 % / the printed metronome mark within ±4 % — a right `<sound tempo>` with no printed mark scores 0 here, as the page shows no tempo / any tempo written. |
| `struct.measures.extra_empty_edge` ↓ | Empty bars added at the start or end. |
| `struct.stats_consistent` | Do the SUT's stats describe its own MusicXML (bars, metre, tempo)? |
| `struct.downbeat.f1` | Do bar lines fall where the performance's bars start (±70 ms)? |
| `read.bar_integrity` | Share of bars that are neither overfull nor badly underfull. |

## The gate (`check`, gate/3)

`check` compares `results.json` with the committed baseline (`baselines/<suite>.json`). Any FAIL is
a REGRESSION (exit 1). The tolerances live in the suite file's `gate` block, so changing one shows
up in review. In a deterministic suite every change is real: a tolerance is the size of trade-off a
change may make without a new baseline.

- **Aggregate metrics**, including `usable` and each critical gate's rate (core: 0.005 ≈ 2–3 cases).
  Zero tolerance where any change is a defect: bar integrity and completeness, bar numbers, printed
  shapes that contradict their length, empty edge bars, stats that disagree with the MusicXML.
- **Coverage**: a gated metric that had a value (in a case or in an aggregate) and now has none fails.
- **Critical flips**: more than `case_flip_max` cases (core 2, smoke 1) going from pass to fail on
  one critical gate fail, even if as many others improve.
- **Micro guard**: each micro piece isolates one question, so any drop on any guarded metric of a
  micro case fails, with no tolerance.
- **Subgroups**: every tag under `set: book: profile: beats: metre-class: mode: feature: size:` with
  at least `min_cases` (core 15) cases in both runs is checked on its own: a rate may drop by
  max(0.02, 1/n) (one case flipping), a 0–1 mean by max(0.01, 0.25/n), the diagnostic score by 1.0.
  Smaller groups are covered by the case rules above. `full` also guards the `holdout` aggregate
  the same way (832 cases, so a 2-point usable-rate drop): a change that helps the open references
  and costs the unseen ones is the overfitting the hold-out exists to show.
- **Cases**: a case that errors, or loses 10 diagnostic points.
- **Known failures**: a catalogue defect count that grows fails; one that shrinks is an improvement.
- `check` refuses results produced by an `audio-score.js` or `scoregraph/` that has changed since (`STALE_RESULTS`).

`mutation-check` proves the gate works: it plants 37 regressions in a copy of the SUT (see "The SUT" below) —
the 5 original ones (hands, key, durations, metre, bar phase), the 7 from the independent review
(tempo mark dropped, printed metre changed without the stats, an extra empty bar, no printed
accidentals, a global-tempo quantiser, no pedal marks, minor-key leading tones spelled flat), 5
added by its fixer (high notes on the left hand, no triplets, no natural signs, the last bar cut,
bar times a beat late), 13 from the final review (G00 §19-§20: a tempo change to half speed
midway, a wrong metre or key signature in the last third, dots dropped, note types one value short,
long notes written at half length, bar numbers restarting, skipping or swapped, the bass staff in
treble clef, trailing rests a beat short, rests typed one value long, an accidental on every note)
and 4 from the short final review (G00 §21: a repeat sign after the middle bar, short right-hand
bars marked `implicit="yes"`, a bar split in two with no repeat sign, no `<staves>`), 3 from the final
pass review (G00 §22: a fake split excused by a forward repeat that cannot fire, a truncated last bar,
a bar dropped outright) and 3 in the ScoreGraph exporter (G01 A38: no `<dot/>`, no
`<time-modification>`, treble and bass clefs swapped) — and requires each to be a REGRESSION naming
its metric, and a no-op to leave `results.json` byte-identical.
gate/1 missed six of the review's seven; gate/2 missed seven of the final review's ten; gate/3 at
metrics/4 missed the repeat, the implicit bars and the split bar.

**Since G1** `toMusicXml` writes its MusicXML from a ScoreGraph (`buildGraph`, then the ScoreGraph
exporter; `buildXml` stays behind `opts.legacyWriter`, which the bench never sets). The writer
mutations therefore make their defect in `buildGraph` — the same defect in the file as before: the
same printed tempo, metre, key, dots, bar numbers, clef, rests, accidentals, repeat sign, implicit bars
or split bar — and `<staves>` is dropped in the exporter. The review scripts use the same edits
(`pppbench/mutation.py`'s `SG_*` anchors and edit lists).

## Golden snapshots

Seventeen fixed inputs (including the lock, arrangement, PM2S-grid, pedal, AMT-error and rubato
paths, a method-book piece in 2/4). Each has two snapshots with different jobs:

- **semantic** (`expected/<key>.semantic.json`, schema `ppp.bench-semantic/3`): the score's
  *structure* — bars with the numbers the app finds them by, their repeat signs, endings and bar-line
  style, the order the app plays the bars in, staves, which staff is which hand (or shown and never
  played), clefs, which staff and voice each note and rest is in — and its *music* — metre and key per bar, tempo marks, notes (position,
  value, pitch, spelling, printed type and dots, ties, tuplets, printed accidentals), rests
  (position, value, printed type and dots, tuplet), pedal marks; plus the stats the app reads, and
  the bar and beat times (`.timing.json`) it syncs the recording to the score with. A difference
  comes with a per-bar diff, the first shifted bar time, and the metric changes (the "before"
  metrics use the stored bar times).
- **byte** (`expected/<key>.musicxml`): serialisation stability and determinism.

Labels, most severe first: **STRUCTURAL_CHANGE** (bars, bar numbers, repeat signs and endings, the
play order, staves, hands, clefs, a note or rest moved to another staff or voice), **SEMANTIC_CHANGE** (the music, stats or bar times, in an unchanged
frame), **SERIALIZATION_ONLY** (different bytes; same structure, music, stats and times: element
order, whitespace, voice numbering). A dot removed, a note type or rest changed, a clef swapped, a
note moved to the other staff, a bar renumbered, a repeat sign added, removed or moved, or
`<staves>` dropped is never SERIALIZATION_ONLY (unit `test_final_review_fixes.GoldenClassification`,
`test_short_review_fixes`). When a writer is rewritten (G1), only
SERIALIZATION_ONLY may be blessed as formatting; every other label is a change of the music to judge.

Both need `golden --bless --reason` to be accepted. One case failing — or its report crashing —
never stops the others. Musical regressions outside these cases are the metric gate's job: every
core case carries a semantic digest, and `check` reports how many cases now write different music.

## Reading the results

`tests/bench/out/<suite>/` (git-ignored, overwritten on every run):

| file | what |
| --- | --- |
| `summary.md` | **Start here.** Verdict; usable-score rate and critical gates; "diagnostic high but unusable" cases; headline metrics with Δ against the baseline and the anchor; per-tag table; **known production failures**; **what the benchmark leaves out**; largest changes; lowest cases; errors; hold-out aggregate. |
| `results.json` | Every case's metrics, plus `known_failures` and `exclusions`. **Byte-identical** for the same code and inputs. |
| `run.json` | Environment and timing (not deterministic, so kept separate). |
| `cases/<key>.musicxml` | What PPP wrote for that case. Open it in the app (Add Sheet Music → MusicXML). |

Case id: `<reference>|<profile>|<beats>|s<seed>`, e.g. `hymns/amazing-grace|human|oracle|s1`.
Profiles: `deadpan` (exact), `human` (±15 ms, varied releases, rolled chords), `rubato` (±10 % drift),
`amt` (human plus dropped notes, ghost octaves, merged repeats, offset noise), `pedal` (human plus a
legato pedal each bar), `human-alt` (the robustness family below). Beats: `none` (the onset tracker),
`oracle` (perfect Beat This), `oracle-noisy` (±20 ms, 5 % missing), `lowconf` (confidence 0.3).

## Known production failures (measured, not fixed)

`run.py known-defects`, every `results.json` and every `summary.md` count the defects in the
catalogue PPP ships (every committed score under `catalog/` and `samples/`, reference or not). G0
does not fix them; `check` fails when a count grows. At the G0 baseline:

| class | files | items | cause / impact |
| --- | --- | --- | --- |
| `key_signature_playback` | 92 (hymns 89 of 89 non-C, czerny849 1, samples 2) | 6,119 notes | the page shows the key signature, the note has no `<alter>`: PPP plays another note than it shows (hymn converter) |
| `tie_without_stop` | 16 (hymns 10) | 121 ties | tied notes are struck again |
| `bar_accidental_not_carried` | 10 hymns | 18 notes | an accidental earlier in the bar is not applied |
| `octave_shift_playback` | 30 | 2,229 notes | the app reads 8va the opposite way to MusicXML: these passages very likely play an octave low |
| `bar_integrity` | 24 | 88 bars | overfull/underfull/empty bars |
| `tempo_marks_disagree` | 4 | 4 files | `<sound tempo>` and the printed mark differ |
| `grace_notes_dropped` (limitation) | 17 | 244 notes | parseMusicXML skips grace notes |
| `note_shape_mismatch` | 4 (Für Elise, 2 hymns, Burgmüller 19) | 8 notes/rests | the printed type/dots say another length than `<duration>`: the page shows another rhythm than the app plays |
| `incomplete_bars` | 12 | 42 bars | a staff stops before the bar ends, or a bar is short with nothing to split it (not a pickup, its complement, or half of a bar split at a repeat sign, an ending or a double/final bar line); stricter than `bar_integrity`. 2 of the 12 since G00 §21: two hymns split a bar with no bar-line mark |
| `bar_numbering` | 0 | – | every committed score numbers its bars 0/1, 2, 3, … |

## The corpus

`corpus/references.json` lists every reference, with its sha256 and licence;
`corpus/provenance.json` (built by `tools/make_provenance.py`) says for every candidate file where it
comes from, its original identifier, its licence status and the repository evidence for it, whether
PPP generated or transcribed it, and whether it is trusted. Only repository evidence counts (the
file's `<rights>`/`<software>`, a per-file catalogue entry, a book statement naming the file's own
typesetter); nothing is guessed. Untrusted files are **quarantined** (rule P1) from every suite.

| set | registered | source |
| --- | --- | --- |
| `micro` | 24 | `corpus/micro/`, written for the benchmark by `tools/make_micro.py` (CC0) |
| `catalog` | 3 | `catalog/*.musicxml` (CC0 per `catalog/index.json`) |
| `samples` | 1 | `samples/prelude-fragment.musicxml` (hand-written for PPP) |
| `hymns` | 88 | `catalog/hymns` (Open Hymnal, public domain, per-hymn source in `sources.js`) |
| `method` | 195 | `catalog/method`: PPP transcriptions (Beyer, Czerny 100, some Burgmüller and Czerny 849), files stating public domain (Hanon, Sonatina/PianoXML, Mutopia), Neru Hayashi's Czerny 849 |
| `omr` | 1 | `corpus/omr/`, generated from `tests/fixtures/truth.json` (the OMR suite only) |

`corpus/excluded.json` lists what is left out: **P1** 15 files with no licence evidence (all 10 of
Czerny 299, 5 Burgmüller — their quality is therefore not measured); **L8** 24 files whose own bars
are broken. Octave-shift scores are **not** excluded: references are read the MusicXML way
(`<pitch>` is the sounding pitch) and carry `feature:ottava`; the app's different reading is the
known failure above. The 78 registered hymns whose notes contradict their key signature skip the key
and spelling metrics (`expect.skip_metrics`, lint L12); `summary.md` says how many cases that is and
names the known failure it comes from.

**Hold-out.** About one in five hymns and method pieces (`fnv1a32(id) % 5 == 0`) is hold-out, only
in `full` (seeds 11 and 12), reported as an aggregate. Hold-out uses the same generator: it shows
generalisation to unseen pieces, not to real playing.

### Adding a reference

1. Commit the MusicXML (lint L1: only committed files count). Licence-clean only, with evidence in
   the repository (its `<rights>`, or a catalogue entry). Rerun `python tests/bench/tools/make_provenance.py`
   and check the file comes out trusted.
2. Add an entry to `corpus/references.json` (or rebuild with `lint-corpus --init`, which keeps
   hand-made `expect` entries in `pppbench/registry_notes.py`):
   `{"id": "method/beyer/107", "path": "catalog/method/beyer/107.mxl", "sha256": "<content_sha256>", "set": "method", "book": "beyer", "license": "...", "expect": {}, "holdout": <rule>, "note": ""}`.
   Hash: `python -c "import sys; sys.path.insert(0,'tests/bench'); from pppbench import util; print(util.content_sha256('catalog/method/beyer/107.mxl'))"`.
3. `python tests/bench/run.py lint-corpus` must report 0 errors.
4. Put the id into the suite's `references`, then `relock --suite <s> --reason "add ..."`,
   `run --suite <s>`, `update-baseline --suite <s> --reason "add ..."`. Commit them together.

## Suites and tiers

| suite | cases | use |
| --- | --- | --- |
| `smoke` | 44 (16 references × 2 + 4 each with AMT errors, rubato and pedal) | before a commit |
| `core` | 553 (141 references × 3 main profiles + 60 amt + 40 rubato + 30 pedal) | **the CI gate** |
| `robust` | 282 (the core references × `human-alt`, onset path and oracle beats) | CI gate |
| `full` | 4,976 (311 references × 8 profiles × 2 seeds; hold-out seeds 11, 12) | nightly, hold-out |
| `mutation` | 171 | `mutation-check` only |
| `golden` | 17 snapshots | `golden` |
| `replay-public` | 6 fixtures | CI gate (needs only Node) |
| `omr-live` | 4 fixtures | T1, needs the app server + helper with Audiveris |

**How far from synthetic the inputs are** (§17 M11):
- `core`, `smoke`, `full`: the synthetic performer.
- `robust`: the same performer with the main family's cues switched off (no downbeat accent, no
  louder melody or bass, no rolled chords), a triangular timing error and earlier releases (30–120 ms).
  It shares the tempo map (no rubato), the beat grid, the notes as written and the release model's
  shape, so it is a parameter variant, not an independent performer. A change tuned to the main
  performer's velocity cues shows up as a difference between `core` and `robust`; note values differ
  most (release timing).
- `replay-public`, `input:rendered`: the synthetic performer rendered with real piano samples and
  sent through the real helper (TransKun + Kong, Beat This): real model and beat-tracker errors,
  synthetic playing.
- `replay-public`, `input:recorded`: a real person playing a licence-clean reference. **None exists
  yet (BLOCKED on recordings).** To add one: record yourself (or a consenting performer) playing a
  registered reference, write the bar start times (bars + 1 values, checked by ear) to a JSON file,
  then `python tests/bench/tools/record_replay.py --recording take.wav --reference <id>
  --bar-starts bars.json --performer "<name>" --license "CC0 1.0, recorded for PPP"`, then
  `update-baseline --suite replay-public`. The WAV is never committed, only its sha256.
- **When real recordings are required (M11, G00 §20):** before the first Goal that changes how PPP
  infers onsets, beats, tempo or metre — or how it turns key releases into note values — at least
  three licence-clean real performances (simple duple, simple triple, compound metre) with bar
  starts checked by ear must be in `replay-public` (`input:recorded`) and baselined, and that Goal
  reports its Δ there. Goals that change only the writer, ScoreGraph or engraving do not need them.

| tier | command | needs | without it |
| --- | --- | --- | --- |
| T0 synthetic, golden, correctness | `run`, `check`, `golden`, `correctness`, `mutation-check` | Python + Node + git | – |
| T0-R replay | `run --suite replay-public` | Node | – (fixtures are committed) |
| T1-C parser parity | `conformance` | `npm start`, network (the page loads React/Babel from unpkg), puppeteer | `SKIPPED: <reason>`, exit 0 (`--require-env` → 2) |
| T1-O OMR live | `omr-live` | the above + `npm run omr` with Audiveris | SKIPPED |
| T2 replay recording | `record-replay` | the helper with transcription, the transcribe venv (numpy), ffmpeg | SKIPPED |

puppeteer is found in the repository's `node_modules` or in `PPP_BENCH_NODE_MODULES` (for example a
git worktree without its own `node_modules`). The transcribe venv's python is found at
`tools/transcribe-venv/Scripts/python.exe` or in `PPP_TRANSCRIBE_PYTHON`.

**Checking Linux determinism** (`results.json` must be byte-identical across operating systems; CI
runs on Linux, most development on Windows). With Docker and an LF checkout of the commit to test:

```sh
git clone -c core.autocrlf=false --branch <branch> <repo> /tmp/lf && cd /tmp/lf
docker run --rm --network none -v "$PWD:/src:ro" node:24-bookworm sh -c '
  git config --global --add safe.directory "*" && git clone -q -c core.autocrlf=false /src /w && cd /w &&
  for s in smoke core robust replay-public full; do python3 tests/bench/run.py run --suite $s >/dev/null;
    python3 tests/bench/run.py check --suite $s | tail -1; sha256sum tests/bench/out/$s/results.json; done'
```

Compare each sha256 with the same suites run on the development machine. At G0 (2026-09-22) all five
matched between Windows 11 (Python 3.13.5, Node 24.17) and `node:24-bookworm` offline (Python 3.11.2,
Node 24.21). `run.json` holds timing and the environment and is expected to differ.

**Parser parity is not correctness.**
- `correctness` (T0, CI) reads `corpus/correctness/*.musicxml` — thirteen small files whose expected
  meaning (ties, spelling, alter vs accidental, mode, grace notes, pickup, tempo units, octave-shift,
  voices/backup/forward, a tie whose stop is not adjacent) was written by hand from the MusicXML
  specification. C01–C12 are by an author who did not look at this reader or the app parser; C13
  was added later by the G0 fixer from the specification, and `expected.json` says so. References must read correctly; the app's reading may
  depart only where documented (octave-shift, fixtures C10 and C11), and that departure is a known
  failure.
- `conformance` (T1) checks the reader against the app's own `parseMusicXML` and player: bars
  and their numbers, written notes, spelling, key mode, tuplets, printed shapes of notes and rests
  (type and dots), and the key presses the app's player makes after joining ties
  (`PianoScore.ties`). A rule both get wrong passes parity; that is what `correctness` is for.

## The SUT

Until G1 the system under test was one file, `audio-score.js`. From G1 it also loads the ScoreGraph
library beside it (`scoregraph/`, docs/GOALS/G01 §15.4), so the bench treats the SUT as a **snapshot**:
`audio-score.js` plus every `*.js` under `scoregraph/`, at the same relative paths
(`pppbench/sut.py`). Nothing else of the repository is copied.

- `ab --a git:<rev>` extracts the revision's whole snapshot into `.cache/ab/a/` (a revision before G1
  simply has no `scoregraph/`), so each side runs its own library, never the working tree's. A fixture
  suite (`replay-public`, `omr-live`, a private suite) runs each side through its own runner.
  `tests/scoregraph/tools/ab_identical.py --suite S` then requires every case of the two sides to have
  the same status, metrics and semantic projection (stricter than the verdict).
- `mutation-check` and the review scripts copy the whole snapshot into `.cache/mutations/<id>/` and
  edit one file; a mutation's `file` names it (default `audio-score.js`).
- `run.json` records `sut_sha256` (the snapshot's paths and content hashes, CRLF read as LF),
  `sut_files` and `sut_modules`, the modules Node actually loaded. `audio_score_sha256` stays as in G0.
- `notate.js` reports its module closure, and the run stops with `SUT_MODULE_OUTSIDE` or
  `SUT_MODULE_UNDECLARED` when the SUT loads a module outside the snapshot: an A/B or a mutant would
  otherwise mix two versions without saying so (`unit/test_sut_snapshot.py`).

## ScoreGraph round trip (`sg-roundtrip`, G1)

`python tests/bench/run.py sg-roundtrip` takes every committed MusicXML under `catalog/`, `samples/`,
`tests/bench/corpus/` and `tests/fixtures/` (369 files at G1) through `MusicXML -> ScoreGraph -> MusicXML
-> ScoreGraph` (`node/sg-roundtrip.js`; Python opens `.mxl`) and requires of each (docs/GOALS/G01 §16.2):

- **L1** the app sees the same music: `semantic.classify` of the G0 projections of the original and the
  round-tripped file (this reader, reader/4) finds no change;
- **L1+** the same notation: `pppbench/notation_inventory.py` reads what the file prints beyond what the app
  reads (slurs, dynamics, wedges, articulations, ornaments, fermatas, fingerings, arpeggios, chord symbols,
  lyrics, words, rehearsal marks, grace notes, beams, stems, octave shifts, pedals, tuplet brackets, bar lines,
  repeats, endings, part names, title, composer, transposition, ties) and both inventories are equal; its
  docstring lists what it leaves out on purpose and why;
- **L2** the graph is a fixed point (the source's input name and hash aside);
- **play order** the graph's `time.unroll` is `canonical.app_play_order()` bar for bar (A17).

Files that may fail are in `tests/scoregraph/roundtrip-allowlist.json` (at most three, each with its reason
and a fixture that reproduces the difference; the command checks the fixture still fails). The import
reports every element it does not map; the command prints the totals. Output:
`out/sg-roundtrip/report.json`.

## Changing the SUT: the loop for later goals

1. Before you start: `npm run bench` must PASS. Pick the gate and tag you are going after (for
   example `critical.meter` on `metre-class:simple-duple`).
2. While working: `python tests/bench/run.py ab --suite core --a git:HEAD --b worktree` shows what your
   working copy changed, per metric, per critical gate and per case, with no baseline involved.
3. When done:
   1. `run --suite core` and `check`; `run --suite robust` and `check`;
   2. `run --suite full` for the hold-out aggregate;
   3. `golden` (and `golden --bless --reason "..."` if the output change is intended; the label
      tells a musical change from a serialisation one);
   4. `update-baseline --suite smoke|core|robust --reason "..."`;
   5. put the SUT change, baselines and golden files in **one commit** whose message gives the
      headline Δ (e.g. `core usable 25.9→28.1 %; critical.meter +0.04; hymns usable −0.6`).
4. Never raise a tolerance to make a regression pass. Tolerance changes are suite-file diffs and
   get reviewed like code.

## Private suites (copyrighted recordings and official scores)

Keep them outside the repository. A suite file there, e.g. `C:/private/ppp-bench/private.json`:

```json
{"schema": "ppp.bench-suite/1", "name": "private-real", "kind": "replay", "cases": [
  {"id": "looping-the-rooms", "reference": "looping-the-rooms.musicxml",
   "reference_bar_starts": "looping-the-rooms.bars.json", "helper_result": "looping-the-rooms.helper.json",
   "expect": {"tempo_qpm": 162}},
  {"id": "lulu-official-omr", "kind": "prediction-file", "reference": "lulu.musicxml", "prediction": "lulu.omr.musicxml"}]}
```

- `replay` cases put a saved helper `/transcribe` result through `toMusicXml`. The reference must be
  the score as played: expand repeats, and remember grace notes are not scored.
- `prediction-file` cases score an existing MusicXML (for example OMR output) with bar-level alignment.
- Run with `run --suite-file ...`. Outputs and the baseline stay beside the suite file; writing them
  inside the repository is refused (`PRIVATE_OUTPUT_IN_REPO`). The input files are hashed into the
  lock, so an edited fixture is INPUT_DRIFT, not a change blamed on the SUT.

## Common errors

| code | meaning | what to do |
| --- | --- | --- |
| `INPUT_DRIFT` | A generated input or a reference file differs from the lock, or the baseline was recorded against another lock. | If you changed the generator, reader or a reference on purpose: `relock --reason`, then `update-baseline --reason`. Otherwise find what changed. |
| `VERSION_MISMATCH` | `READER_VERSION`/`METRICS_VERSION`/`SQI_VERSION`/`GENERATOR_VERSION` differ from the baseline's. | Rebaseline (a new anchor starts). Bump the version whenever you change a definition. |
| `SUITE_CHANGED` | The suite's reference set or matrix changed (order does not matter). | Relock and rebaseline with a reason. |
| `STALE_RESULTS` | `audio-score.js` or a `scoregraph/` module changed after the run. | Run again. |
| `SUT_MODULE_OUTSIDE`, `SUT_MODULE_UNDECLARED` | The SUT loaded a module outside its snapshot (see "The SUT"). | Add the module's directory to `pppbench/sut.py` `SUT_TREES`. |
| `NO_BASELINE` | No baseline for the suite yet. | `update-baseline`. |
| `STATS_SHAPE` | `toMusicXml`'s `stats.barStarts` no longer has bars + 1 values. | The SUT's stats contract changed: update `pppbench/timemap.py`. |
| `MUTATION_ANCHOR_MISSING` | A mutation's search string is no longer in `audio-score.js` exactly once. | Update the anchor in `pppbench/mutation.py`. |
| `NOTATE_NO_NOTES`, `NOTATE_…` | `toMusicXml` threw for that case. | A new one is a regression. |
| `FILTERED_RUN` | `--filter` runs cannot be checked or baselined. | Run the whole suite. |

## Layout

```
run.py            CLI
pppbench/         reader (musicxml.py), canonical score, corpus + lint, perform (synthetic
                  performer), timemap, align, metrics/ (structure, notes, notation, readability,
                  pedal, critical, composite), semantic, suite + locks, runner, aggregate, compare
                  (gate), report, golden, mutation, correctness, known_defects, legacy, private,
                  tiers (T1/T2), projection
node/             notate.js (SUT adapter), conformance.js, omr-live.js (puppeteer, T1 only)
tools/            make_micro.py, make_provenance.py, make_omr_reference.py, render_piano.py, record_replay.py
corpus/           references.json, excluded.json, provenance.json, micro/, omr/, correctness/
suites/           suite definitions and input locks
baselines/        committed baselines (full: aggregates only)
golden/           inputs/, expected/ (.musicxml, .stats.json, .semantic.json, .timing.json), BLESS_LOG.md
replay/           recorded helper results (T0-R)
review/           the independent review's adversarial checks (not part of test:bench; nightly in CI)
unit/             unit tests (python -m unittest discover -s tests/bench/unit -t tests/bench)
out/, .cache/     outputs and scratch (git-ignored)
```

## G0 acceptance record

The original record (2026-09-22, gate/1) is in G00 §16. After the independent review (§17) the
benchmark was fixed and re-verified; that record, with every measurement, is G00 §18. The final
independent review (§19) found what the app draws or plays that the gate still did not read; the
fixes and their measurements (metrics/4, reader/3, gate/3) are G00 §20.
