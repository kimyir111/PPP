# ScoreGraph (`scoregraph/`)

PPP's canonical score representation: a versioned, plain-JSON graph and the pure functions around it.
The design and the rules are in `docs/GOALS/G01_SCOREGRAPH.md`; this file is the API summary and the
registry of `ext` namespaces.

No dependencies, no build step. The same files run in Node (`require('./scoregraph/index.js')`) and in
the browser (one `<script>` per file, `index.js` last, which leaves `window.PPPScoreGraph`). Script order:
`rational, schema, pitch, time, serialize, validate, build, prov, ops, xml, musicxml-import,
musicxml-export, index`.

## API

| call | returns | |
| --- | --- | --- |
| `version` | `'1.0.0'` | the library's own version; `audio-score.js` checks it |
| `SCOREGRAPH_VERSION` | `1` | the schema's version (`scoregraph_version`) |
| `builder({id, meta, source, default})` | a builder | `.measure() .meter() .key() .tempo() .ending() .jump() .part() .staff() .voice() .clef() .event() .direction() .spanner() .performance() .perfNote() .perfPedal() .anchor() .flag() .id(prefix)`, then `.finish()` → `{graph, issues}` (canonical, validated, frozen; throws `BuildError` on an ERROR) |
| `validate(graph)` | `{ok, issues}` | issues `{code, severity, message, ids?, at?}`, sorted; `CODES` lists every code |
| `serialize(graph)` / `parse(text, {migrations?, current?})` | text / frozen graph | canonical JSON (§14); `parse` refuses an unknown version (`E-VERSION`) and migrates older ones |
| `canonicalize(doc)`, `migrate(doc, opts)`, `fingerprint(graph)`, `scoreRef(graph)` | | FNV-1a 64 of the canonical text; `{scoreId, rev, fp}` |
| `time.*` | | `measureStart, scorePos, posAt, meterAt, metric, keyAt, clefAt, unroll, playback, playbackW, tempoMap, seconds, secondsAt, micros, perfTimeMap, resolveSpan, spanOf` (§6.8) |
| `pitch.*` | | `midi, written, concert, writtenFifths, displayOctave, limbOf` (§7.2, §8.2) |
| `prov.provOf(graph, id, aspect?)` | `{src?, op?, conf?}` | §11.2 |
| `ops.updateHead / removeEvents / replaceRegion` | `{graph, idMap, issues}` | §12.3, §12.4; `OpError` with `E-REGION-BOUNDARY`, `E-OP-TARGET`, `E-OP-RESULT` |
| `musicxml.import(text, opts)` | `{ok, graph, report}` / `{ok: false, code, message, report}` | Appendix A; `report.dropped` counts every element not mapped |
| `musicxml.export(graph, {software})` | `{ok, xml}` / `{ok: false, code}` | Appendix A |

A graph is never changed in place: every op returns a new one (`rev` + 1) and an `idMap` of retired IDs.

## Decisions taken while implementing G1

The G01 specification is the source; these points it leaves open or states in a way that cannot be
implemented literally. Each is recorded in G01 §24.

- **Chord symbols** name their quality `chordKind` (§5.8 calls it `kind`, which a Direction already uses to
  say what it is).
- **`at == measure.dur`** is an error only for a non-grace event (it would last past the bar line). A
  direction, clef, key, tempo, jump, grace note or spanner end may sit at the end of its measure, where
  MusicXML files put a clef change for the next bar or a trailing grace note.
- **Empty objects are kept** in the canonical form (§14.2 leaves out empty optional *arrays*): `fermata: {}`
  is a fermata with the default shape. Only the maps `ext` and `asp` are dropped when empty.
- **A Tie is a sounding tie** (`<tie>`). A `<tied>` with no `<tie>` of its type is a printed tie that does not
  sound; the graph cannot keep it, and the import reports it.
- **Import IDs** follow each category's musical order, document order breaking ties (clefs at one position
  keep their document order). The same file gives the same IDs (A30), and so does the file's own export
  (L2).

## `ext` namespaces

An experimental field lives under `ext.<namespace>` (G01 §5.13); the validator reports each namespace in
use (`I-EXT`). Registered:

| namespace | on | value | meaning |
| --- | --- | --- | --- |
| `musicxml.beam` | Beam spanner | `{levels: n}` | the source wrote only the first `n` beam levels (for example only the primary beam over sixteenths); the export writes no deeper level. Set by the MusicXML import only when the source wrote fewer levels than the note values imply. |
| `test.*` | anywhere | any JSON | reserved for test fixtures |
