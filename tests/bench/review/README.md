# G0 independent review — adversarial checks

Added by the independent review of 2026-09-22 (docs/GOALS/G00_QUALITY_FOUNDATION.md §17) and
extended by the fixer (§18). These scripts test **the benchmark**, not PPP. They are not part of
`npm run test:bench` (they take minutes); CI runs them nightly. They never modify `audio-score.js`:
mutants and outputs go to `tests/bench/out/review/` (git-ignored).

```sh
python tests/bench/review/adversarial.py                  # all offline checks, ~5 min, exit 1 while a GAP remains
python tests/bench/review/adversarial.py --only mutations # or: sqi | oracle | lock | data | correctness
PPP_BENCH_NODE_MODULES=D:/PPP/node_modules \
  python tests/bench/review/adversarial.py --only lock --conformance http://127.0.0.1:8777   # + T1-C blind spots
```

Each line prints `OK` when the benchmark behaves as a sound benchmark should, `GAP` when it does not.

## Results

Final fixer run, 2026-09-22: **25 OK, 0 GAP** offline (about 4–5 min), plus **4 OK** for `--only lock
--conformance` against the g0 worktree's own server.

| check | what a sound benchmark does | at review (gate/1) | after the fix (gate/2) |
| --- | --- | --- | --- |
| `sqi` | the release verdict never calls a severely broken score usable, and leads the report | GAP | OK |
| `mutations` ADV ×7 | a user-visible SUT regression is a core REGRESSION | 1 of 7 | 7 of 7 (smoke also REGRESSION for all 7) |
| `mutations` FIX ×5 (new) | the same, for kinds the review did not try | – | 5 of 5 |
| `oracle` ×3 | the ideal output for a reference's performance scores perfectly; the committed file does not where PPP would play it wrong | GAP (pickups) | OK ×3 |
| `lock` | an edited reference stops `run` with INPUT_DRIFT | GAP | OK |
| `data` ×4 | known catalogue defects, octave-shift, licence evidence and self-contradicting tempo marks are measured and reported | GAP ×4 | OK ×4 |
| `correctness` ×4 (new) | the reader reads independent fixtures right, and catches a broken reader without a browser | – | OK ×4 |
| `--conformance` ×3 | parser parity catches a reader that breaks ties / spelling / mode | GAP ×3 (224/224) | OK ×3 (258/258 → 217, 112, 36) |

## What the fixer changed in this script, and why

The review's mutations and their expectation (a core REGRESSION) are unchanged. Five checks were
written by the review to report GAP unconditionally, because no benchmark output existed to test
against. The fixer gave each an explicit pass criterion, commented where it is applied; none is
weaker than the finding it came from:

- **`sqi`**: the review asked that SQI separate unusable scores from usable ones. The fix makes the
  release headline a separate verdict (usable-score rate over critical gates) instead of reshaping
  one number. Criterion: no case with any of the review's severe failures (wrong metre, played tempo
  off by more than 4 %, wrong key, fewer than half the notes in the right bar and beat) is usable;
  no usable case fails the review's own strict rule; the usable rate re-derived from raw case metrics
  equals the aggregate; `summary.md` shows it before the diagnostic score and lists the "diagnostic
  high but unusable" cases.
- **hymn defects**: the defects this script counts on its own (key signature, unterminated ties,
  lost bar accidentals) must appear with the same counts in `results.json` and `summary.md`. The
  bar-accidental count is compared exactly (files by collection and notes), from a raw-XML counter
  that reads the bar in time order across voices, as a reader of the page does. The review counted
  in document order and got 21; that includes four voice-2 notes that sound *before* the voice-1
  accidental (i-am-jesus-little-lamb bars 6 and 8, mighty-fortress bars 1 and 3) and misses one
  the other way (what-child-is-this bar 13). The count is 18 notes in 10 hymns.
- **oracle**: the review fed each reference file in as its own prediction. After B1 and M9 that
  file is not the ideal PPP output for 16 core references, and the difference is real: 8 have no
  tempo, so they cannot tell PPP to play at the qpm they were performed at; 8 use `<octave-shift>`,
  which PPP's player reads an octave off. The check now builds the ideal output (the same sounding
  pitches without octave-shift, the performed tempo written in) and still demands a perfect score
  on every metric for all 141 core references. Two new checks require the raw files to score below
  perfect for exactly those reasons (8/8 and 8/8), so the benchmark cannot hide either failure.
- **octave-shift**: no octave-shift score may be left out silently; each is a reference read the
  MusicXML way or excluded for another stated reason (licence, broken bars), the app's reading is a
  counted KNOWN_FAILURE, and the correctness fixtures record the departure.
- **licence evidence**: unchanged criterion (no registered reference without evidence, no PPP
  transcription labelled PDMX); it now passes because the six references the review named were
  quarantined (with nine more Czerny 299 files that came back from the octave-shift exclusion with
  no licence evidence either: 15 in all) and the labels come from `corpus/provenance.json`.
- **tempo marks**: G0 may not edit catalogue data, so the review's own recommendation (m5: a lint
  rule) is the bar — every reference whose marks disagree is flagged by lint L13 and counted as a
  known failure.

New: five FIX-* mutations (high notes on the left hand, no triplets, no natural signs, the last bar
cut, bar times a beat late with the MusicXML untouched) and the `correctness` checks.

## Final independent review (G00 §19) and its fix (§20)

Two more scripts from the final review, run nightly in CI. They change no criterion above.

```sh
python tests/bench/review/final_review.py     # 10 user-visible mutations through core, smoke, robust, golden, replay (~5 min)
python tests/bench/review/final_oracle.py     # the same music engraved differently must score perfectly (~5 s)
```

- `final_review.py`: each mutation must be a core REGRESSION that names its own metric, and golden
  must never label it SERIALIZATION_ONLY (exit 1 otherwise). At the review 7 of 10 passed every
  metric gate — dots dropped, a tempo change to half speed midway, a wrong metre or key signature in
  the last third, the bass staff in treble clef, bar numbers restarting, an accidental on every note
  — and golden called the dots, clef and bar-number mutants SERIALIZATION-ONLY. After the fix
  (2026-09-22): **10 of 10 caught on their own metric**; golden labels them SEMANTIC_CHANGE or
  STRUCTURAL_CHANGE. The same mutations (and three more) are in `mutation-check` as FIN-*.
- `final_oracle.py`: the ideal output, written four ways (as the file has it; the pickup as a full
  bar starting with typed rests; the mode flipped; every tempo only as a printed mark), must score
  perfectly on every metric, critical gate and the usable verdict. A reference whose own page carries
  a counted catalogue defect may fall short only on the metrics that defect explains (e.g. the 36
  hymns that ignore their key signature, on the printed-accidental gate); anything else is a GAP.
  At the review the pickup-as-full-bar variant lost pitch identity on five pieces (PredTime, §19
  m1); after the fix: **4 OK, 0 GAP**.
