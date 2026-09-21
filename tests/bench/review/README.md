# G0 independent review — adversarial checks

Added by the independent review of 2026-09-22 (docs/GOALS/G00_QUALITY_FOUNDATION.md, "Independent
Review"). These scripts test **the benchmark**, not PPP. They are not part of `npm run test:bench`
and never modify `audio-score.js`: mutants and outputs go to `tests/bench/out/review/` (git-ignored).

```sh
python tests/bench/review/adversarial.py                  # all offline checks, ~2 min, exit 1 while a GAP remains
python tests/bench/review/adversarial.py --only mutations # or: sqi | oracle | lock | data
PPP_BENCH_NODE_MODULES=D:/PPP/node_modules \
  python tests/bench/review/adversarial.py --only lock --conformance http://127.0.0.1:8777   # + T1-C blind spots
```

Each line prints `OK` when the benchmark already behaves as a sound benchmark should, `GAP` when it
does not. At review time the result was 1 OK, 16 GAP:

| check | what a sound benchmark does | review result |
| --- | --- | --- |
| `sqi` | an unusable score cannot sit at the suite-mean SQI | GAP: `micro/M19-fast-3-8` with the wrong metre, 2/3-speed playback and most notes misplaced scores 80.6 (core mean 81.7); strict usable rate 32.3 % |
| `mutations` ×7 | a user-visible SUT regression is a core REGRESSION | 1 of 7 caught (ADV-GLOBAL-TEMPO). ADV-NO-TEMPO passes as an SQI **improvement**; ADV-XML-METRE and ADV-NO-PEDAL leave `results.json` byte-identical; golden crashes on ADV-EXTRA-BAR / ADV-GLOBAL-TEMPO |
| `oracle` | the reference, used as its own prediction, scores perfectly | GAP: 20 pickup references lose `onset_pos`, 43 lose `downbeat.f1` |
| `lock` | an edited reference stops `run` with INPUT_DRIFT | GAP: a key-signature edit runs, and `check` blames the SUT |
| `data` ×4 | known catalog defects are measured; licences are evidenced; references agree with themselves | GAP ×4 (hymns, octave-shift, licence evidence, tempo marks) |
| `--conformance` ×3 | conformance catches a reader that breaks ties / spelling / mode | GAP ×3: all 224/224 |

When a finding is fixed, the matching check turns `OK`. A fixer can turn each check into a unit test
(most take well under a second on the smoke suite).
