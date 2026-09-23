# ScoreGraph tests

```sh
npm run test:scoregraph                              # node --test: the library (A1-A31, A35) and toMusicXml's graphs (A28, A40-A44)
python -m unittest discover -s tests/bench/unit -t tests/bench -p "test_scoregraph*.py"   # Python interop, round trip, A40, A42
python tests/bench/run.py sg-roundtrip               # every committed MusicXML through ScoreGraph and back (A32-A34)
python tests/scoregraph/tools/graph_check.py --suite core      # every core case's graph has no error (A40)
python tests/scoregraph/tools/shadow_compare.py      # buildXml and the ScoreGraph writer read back the same (Step 7)
python tests/bench/run.py ab --suite core --a git:aff7080 --b worktree && python tests/scoregraph/tools/ab_identical.py --suite core   # A36
```

| path | what |
| --- | --- |
| `*.test.js` | `node --test` suites: rational, schema, browser loading, validator, serialization, determinism, time, provenance, ops, MusicXML; `vertical-slice` (the graphs `toMusicXml` writes from, their performance layer and warnings, the legacy path, the app's script order) and `server` (the server hands out `scoregraph/`) |
| `fixtures/invalid/*.json` | one ERROR each; the sidecar `*.expect.json` names it (A5) |
| `fixtures/valid/*.sg.json` | canonical graphs: one fixture per WARNING code (`warn-*`, A6) and the topics of G01 §16.3 (A7) |
| `fixtures/xml/*.musicxml` | MusicXML fixtures with sidecars: tuplets, tempo/metre/key changes, pickup, six repeat forms, voices, cross-staff, ties and slurs, piano marks, transposing parts, percussion (refused), dropped elements, and the allowlist's reproductions |
| `migrations/` | the test-only v0 → v1 migration (A13) |
| `roundtrip-allowlist.json` | the corpus files that may fail `sg-roundtrip` (at most three), each with its reason and a fixture |
| `golden/` | the graphs `toMusicXml` makes for the 17 G0 golden inputs (`<key>.sg.json`, canonical) and their warning and note counts (`<key>.issues.json`) (A40, A42); `tools/make-golden.js` writes them |
| `tools/` | `make-fixtures.js` and `make_repeat_fixtures.py` write the fixtures; `make-golden.js` the golden graphs; `shadow_compare.py` runs both writers on every bench input; `graph_check.py` checks a suite's graphs through `notate.js --emit-graph`; `ab_identical.py` compares two A/B runs case by case (A36) |

**How the expectations were written.** A sidecar states what the specification says the code must report,
written by hand next to the edit that causes it (`tools/make-fixtures.js`); nothing is recorded by running
the code under test. The G0 correctness fixtures (`tests/bench/corpus/correctness`, written from the
MusicXML specification) give the key presses a file means.

After changing a fixture generator, run it and commit the fixtures with the change:

```sh
node tests/scoregraph/tools/make-fixtures.js
python tests/scoregraph/tools/make_repeat_fixtures.py
```

**The golden graphs** change only with a change to what `toMusicXml` builds. `vertical-slice.test.js` fails
with the key that changed; look at the difference, and if it is meant, run
`node tests/scoregraph/tools/make-golden.js` and commit the files with the change. The G0 golden
(`tests/bench/golden/`) is the MusicXML side of the same inputs and has its own bless procedure.
