# PPP — current state

Updated 2026-09-22, at the end of G0 (Quality Foundation). Read this first in a new session, then
the current goal's spec in `docs/GOALS/`.

## Where things are

| | |
| --- | --- |
| Goals | Numbered specs in `docs/GOALS/`. **G0 is implemented**. `G00_QUALITY_FOUNDATION.md` §16 has the result and what is still open. |
| G0 code | Branch `g0-quality-foundation`. It was developed in a separate worktree (`D:/PPP-g0`) so the shared `D:/PPP` tree and other sessions' uncommitted files stayed untouched. **Not merged to `main`, not pushed.** |
| App | `Piano Coach App.dc.html` (single file, ~19k lines), `audio-score.js` (recording → MusicXML), `omr-service.js` (local helper, 127.0.0.1:8788), `server.js` (port 8777). Deploy: Render, manual (`render deploys create …`; a push does not deploy). |
| Tests | `npm test` (26 browser suites; needs `npm start`, network, puppeteer), `npm run test:transcription-core` (16, now including `beat_track_test.py`), `npm run test:arranger` (3), `npm run test:bench` (122 + 14 golden snapshots). |
| CI | `.github/workflows/bench.yml` exists on the branch: a gate job on push/PR, and full + mutation-check nightly. It is **not active** until the branch is pushed. That needs the user's OK. |

## Measuring score quality (G0)

```sh
npm run bench:smoke     # < 1 s
npm run bench           # core gate: 523 cases, ~15 s, exit 1 on a regression
python tests/bench/run.py ab --suite core --a git:HEAD --b worktree   # what did my change do?
```

Everything is in `tests/bench/README.md`: metrics, corpus, the baseline update procedure,
private suites, and environment tiers.

### Baseline at G0 (audio-score.js sha256 559a1f40…, content hash with CRLF read as LF)

| suite | cases | SQI | notable |
| --- | --- | --- | --- |
| smoke | 32 | 89.70 | |
| core | 523 | 81.74 | identity F1 0.980 · time sig exact 0.576 · key 0.887 · tempo played ±4 % 0.549 (printed 0.818) · hands 0.885 · onset position 0.510 · duration 0.747 · false ties 4.25 / 100 notes |
| full | 4,172 (714 hold-out) | 82.67 (hold-out 80.13) | |
| omr-live | 4 | 74.34 | symbolic F1 0.50–0.64: the OMR'd right hand is not playable (issue 11) |
| replay-public | 6 recorded AMT results | 88.42 | |

- Results are byte-identical run to run.
- They are also byte-identical between Windows and Linux (checked in a `node:24` Docker container).
- The mutation check proves the gate catches five planted regressions.

## Known quality issues (measured, not fixed)

Numbered as in G0 §14 (1–9 from the design, 10–12 found while implementing). Each is visible in
the baseline, and each belongs to a later goal.

1. **6/8 `<sound tempo>` is written in dotted-quarter units.** Every compound-metre transcription
   plays at 2/3 speed. In core: 177 compound outputs, `mark_consistent` 0.00, `ok_effective` 0.04
   against `ok_written` 0.84.
2. **Metres are pulled towards 6/8.** 140 of 222 wrong metres in core are "→ 6/8" (2/4→6/8 alone:
   76). Simple-duple `time_sig.exact` is 0.07. Wrong-metre cases carry 7.4 false ties per 100
   notes, against 1.9.
3. **`octave-shift` reading is suspect** (the app treats `type="up"` as +12). 29 references are
   excluded until someone checks it.
4. `Import.load` returns the first-pass MusicXML even when it adopted the re-recognised merge.
5. **Key estimation.** Key signature 0.887 in core; Czerny 30 0.52; Beyer 8 and 9 come out in G
   instead of C.
6. **Hand split.** 0.885 in core; Beyer 0.74, Hanon 0.72; Beyer 9 is 0.39.
7. **Low-information input** (whole-note chords, M24): rhythm accuracy 0.00 on the onset path.
8. `tests/golden_benchmark.py` reads differently from the app (pickups, ties, grace notes, tempo)
   and labels quarter beats as "ms". Kept as it is; the new `legacy` command relabels its output.
9. `tests/beat_track_test.py` was orphaned. **Fixed in G0** (sys.path).
10. **(new) 78 of 88 hymns play wrong notes.** `catalog/hymns/abc-to-musicxml.js` writes `<alter>`
    only for explicit ABC accidentals and ignores the key signature. Every hymn not in C is
    affected; Amazing Grace in G has no F♯ at all. The benchmark skips key and spelling metrics
    for these hymns (lint L12).
11. **(new) An OMR'd piano score loses its right hand.** Audiveris exports two single-staff parts
    (the first named "Voice"). The app's hand rule then marks the treble staff `x` (shown, not
    played) and the bass `r`. Seen on all four OMR fixtures.
12. **(new) The PDF OMR fixture comes back with 16 bars instead of 8** at confidence 0.8, with no
    suspect bars flagged (`omr.flag.recall` 0).
13. **(new, expected) 5/4 is written as 4/4** (micro M21). The metre is not supported yet.

## Working in this repository

- Several Claude sessions share `D:/PPP`. Say which files you will touch before large edits, and
  never stage another session's files. At G0 time, `catalog/method/index.json` and ~120 untracked
  `catalog/method/**/*.mxl` belonged to another session's work.
- `.gitignore` now ignores `tmp/` (copyrighted experiments), `__pycache__/`, and
  `tests/bench/out/` and `.cache/`. The root `tools/` rule would also hide `tests/bench/tools/`,
  so a negation keeps that directory tracked.
- `core.autocrlf` is on. Text files are CRLF in the Windows working tree, so the benchmark hashes
  references with CRLF read as LF, and `tests/bench/.gitattributes` keeps its own files LF.
- On Windows (cp949), Python `print` of non-ASCII crashes unless stdout is UTF-8. The benchmark
  CLI reconfigures stdio itself. Bash heredocs can mangle backslashes in inline Python.
- A git worktree without its own `node_modules` can use `PPP_BENCH_NODE_MODULES=D:/PPP/node_modules`
  for the T1 tiers. `PPP_TRANSCRIBE_PYTHON` points at the transcribe venv for replay recording.

## Next

- Merge `g0-quality-foundation` into `main`, and push to turn on CI (the user decides).
- Later goals should target the measured issues above: 1 and 2 (compound tempo and the 6/8 pull)
  are the largest by count, 10 and 11 the largest per user. Follow the loop in
  `tests/bench/README.md` ("Changing the SUT") and report the core and hold-out Δ.
- G0 leftovers: Step 14 (arrangement invariants) was not done; see G00 §16.
