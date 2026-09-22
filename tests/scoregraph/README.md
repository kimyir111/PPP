# ScoreGraph tests

```sh
npm run test:scoregraph                              # node --test, the library (A1-A31, A35)
python -m unittest discover -s tests/bench/unit -t tests/bench -p "test_scoregraph*.py"   # Python interop and round trip
python tests/bench/run.py sg-roundtrip               # every committed MusicXML through ScoreGraph and back (A32-A34)
```

| path | what |
| --- | --- |
| `*.test.js` | `node --test` suites: rational, schema, browser loading, validator, serialization, determinism, time, provenance, ops, MusicXML |
| `fixtures/invalid/*.json` | one ERROR each; the sidecar `*.expect.json` names it (A5) |
| `fixtures/valid/*.sg.json` | canonical graphs: one fixture per WARNING code (`warn-*`, A6) and the topics of G01 §16.3 (A7) |
| `fixtures/xml/*.musicxml` | MusicXML fixtures with sidecars: tuplets, tempo/metre/key changes, pickup, six repeat forms, voices, cross-staff, ties and slurs, piano marks, transposing parts, percussion (refused), dropped elements, and the allowlist's reproductions |
| `migrations/` | the test-only v0 → v1 migration (A13) |
| `roundtrip-allowlist.json` | the corpus files that may fail `sg-roundtrip` (at most three), each with its reason and a fixture |
| `golden/` | the graphs `toMusicXml` makes for the 17 G0 golden inputs, and their issues (A40, A42) |
| `tools/` | `make-fixtures.js` and `make_repeat_fixtures.py` write the fixtures; `ab_identical.py` compares two A/B runs case by case (A36) |

**How the expectations were written.** A sidecar states what the specification says the code must report,
written by hand next to the edit that causes it (`tools/make-fixtures.js`); nothing is recorded by running
the code under test. The G0 correctness fixtures (`tests/bench/corpus/correctness`, written from the
MusicXML specification) give the key presses a file means.

After changing a fixture generator, run it and commit the fixtures with the change:

```sh
node tests/scoregraph/tools/make-fixtures.js
python tests/scoregraph/tools/make_repeat_fixtures.py
```
