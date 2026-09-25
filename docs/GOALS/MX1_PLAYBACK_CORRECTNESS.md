# MX-1 — playback correctness (record)

| | |
| --- | --- |
| Kind | Maintenance batch, not a Goal (`docs/PPP_MASTER_ROADMAP.md` §5.2, §14). Approved by the user (decision D-1, 2026-09-25) |
| Branch | `mx1-playback-correctness` from `origin/main` `1c92fc4`, worktree `D:/PPP-mx1` |
| Status | Implemented 2026-09-25, waiting for the independent review. Not merged |
| Decisions | `docs/DECISIONS.md` MX1-D1 … MX1-D8 |

## 1. The rule (D-1)

ScoreGraph pitch and MusicXML `<pitch>` are the **sounding** pitch. An 8va, 8vb, 15ma or 15mb is a display transformation:
**written = sounding − shift**. Playback, practice judging, follow, the falling notes and the on-screen keyboard read the
sounding pitch and never shift it again.

MusicXML says which way the notes are *printed*: `<octave-shift type="down">` is an 8va ("a treble clef line noted with 8va
will be indicated with an octave-shift down from the pitch data indicated in the notes"). Before MX-1 the app read it the
other way on both counts: it took `<pitch>` as the printed pitch and `type="down"` as a sounding shift down. A real 8va
(MuseScore/PDMX writes every one as `type="down"`) was therefore played an octave low, and drawn at the sounding pitch with
an "8vb" under the staff — drawn and played agreed with each other, but not with the file or the edition.

## 2. What changed

| Where | Change |
| --- | --- |
| `Piano Coach App.dc.html` 4101–4109 (`parseMusicXML`) | `type="down"` → `dir +1`, `semitones +12·octaves` (an 8va); `"up"` → an 8vb. `dir`/`semitones` now mean *sounding − written* everywhere in the app, as PdfLayer already had it |
| App 3593–3611 (`Score.finalize`) | For a note whose pitch came from a file or the graph: `soundingMidi = midi`, `writtenMidi = (writtenMidi ?? midi) − shift`, `writtenP = shiftPitchOctave(writtenP ‖ p, −shift)`; `p`/`midi` untouched. A transposing part's pre-filled written pitch (G2-D15) is shifted the same way. Notes that already carry `soundingMidi` (PdfLayer, a saved song) are left alone, as before |
| App 2669–2691 (`PianoScore.pedal`) | A printed `change` closes the damper span and opens the next at the same point: what only the pedal held is released there (the sampler's `upQ`), a key still down carries on into the new span |
| App 2835–2858 (`pedalEvents`, `lifts`) | A printed `change` goes to MIDI out as CC64 **0 then 127** at the same timestamp (it was a single 64, a half pedal). A change the file gives as a number (`<sound damper-pedal="64">`) is still a half pedal |
| App 4480–4485 (`midiMessage`) | `no-notes` (a `.mid` under the four-note floor) says *"PPP needs at least four notes to write a score, and this MIDI file has fewer."*; `MIDI-NO-NOTES` (a file with no note at all) keeps *"has no notes to read"* |
| App 23, 35, 36 | `?v=9` on `legacy-score.js`, `index.js`, `audio-score.js` so a cached old adapter never meets the new `finalize` |
| `audio-score.js` 1345–1353, 1512, 1572, 1154 | `noNotes(count)` says how many notes there were (code `no-notes` unchanged); `SCOREGRAPH_VERSION` 1.3.1 |
| `scoregraph/legacy-score.js` 202–236 | `toScore`: graph shift +1 → app `dir +1` (was −1); the comments state D-1 |
| `legacy-score.js` 603–619 | `unfinalize`/`beforeFinalize`: takes back the printed pitch (`writtenP`, `writtenMidi` + shift) and leaves `p`/`midi` alone |
| `legacy-score.js` 1271 | `fromScore`: app `dir +1` → graph shift +1 |
| `scoregraph/index.js` 38 | library version 1.3.0 → 1.3.1 (behaviour of the adapter; engrave's stored graphs are revalidated through `agreeLib`) |
| `i18n/{ja-JP,ko-KR,zh-CN}.json` | the new message in three languages (en-US is the key). Written with `json.dumps(indent=2, ensure_ascii=False) + "\n"`, so each file now round-trips exactly; that drops the first of two `"Wrong note"` keys in each, which `JSON.parse` already ignored (the value the app shows is unchanged) |

The floor itself (`audio-score.js` `notes.length < 4`) stays. G3's `pedalJoin` and automatic 8va stay off.

## 3. Audit of every committed octave line (task 4)

`node tests/scoregraph/tools/ottava-audit.js` reads every committed MusicXML/MXL file with an `<octave-shift>` and weighs
the two readings with evidence from the file itself:

- **page** — the mean number of diatonic steps outside the staff (by clef) at which the notes under the line would be
  printed: read as sounding (MusicXML), the page shows `<pitch>` − shift; read as written, it shows `<pitch>`. An engraver
  writes an 8va to bring notes back to the staff.
- **joins** — the median melodic step (the staff's outer voice, within two bars) into and out of each line: read as
  sounding, a line changes nothing in what sounds; read as written, everything under it sounds an octave away.

A verdict needs both to agree. Notes are counted the way the app reads a line (closed lines, the named staff or every
staff), which reproduces issue 3's count: **30 files and 2,229 notes** in the catalogue and samples.

| File | Line | Staff | Notes | `<pitch>` range | Page, steps off the staff: sounding / written | Joins, median semitones: sounding / written (n) | Verdict |
| --- | --- | --- | --- | --- | --- | --- | --- |
| catalog/method/burgmuller25/015.mxl | 8va | 1 | 4 | G6–C7 | 2.5 / 9.5 | 22.5 / 34.5 (2) | sounding |
| catalog/method/burgmuller25/021.mxl | 8va | 1 | 9 | D6–B6 | 1 / 7.22 | 4 / 11 (2) | sounding |
| catalog/method/czerny299/001.mxl | 8va | 1 | 103 | G5–F7 | 2.37 / 8.62 | 2 / 14 (10) | sounding |
| catalog/method/czerny299/002.mxl | 8va | 1 | 38 | A5–E7 | 0.71 / 6.71 | 1 / 13 (1) | sounding |
| catalog/method/czerny299/003.mxl | 8va | 1 | 99 | C5–F7 | 0.87 / 5.83 | 8.5 / 11.5 (8) | sounding |
| catalog/method/czerny299/004.mxl | 8va | 1 | 44 | D#6–E7 | 1.98 / 8.8 | 18.5 / 30.5 (2) | sounding |
| catalog/method/czerny299/005.mxl | 8va | 1 | 244 | F5–F7 | 1.38 / 7.2 | 2 / 12 (10) | sounding |
| catalog/method/czerny299/006.mxl | 8va | 1 | 70 | C5–C7 | 0.26 / 3.66 | 7 / 19 (1) | sounding |
| catalog/method/czerny299/007.mxl | 8va | 1 | 37 | E5–Bb6 | 0.27 / 4.78 | 12 / 24 (4) | sounding |
| catalog/method/czerny299/008.mxl | 8va | 1 | 116 | F#5–F7 | 1.84 / 7.74 | 2 / 14 (10) | sounding |
| catalog/method/czerny299/009.mxl | 8va | 1 | 268 | C5–F7 | 0.88 / 6.1 | 2 / 14 (10) | sounding |
| catalog/method/czerny849/006.mxl | 8va | 1 | 49 | D6–F7 | 2.49 / 9.18 | 5.5 / 17.5 (10) | sounding |
| catalog/method/czerny849/008.mxl | 8va | 1 | 86 | F#5–G7 | 1.8 / 7.66 | 5.5 / 8.5 (4) | sounding |
| catalog/method/czerny849/011.mxl | 8va | 1 | 35 | A5–D7 | 1.71 / 7.83 | 2 / 14 (8) | sounding |
| catalog/method/czerny849/012.mxl | 8va | 1 | 67 | G5–G7 | 1.75 / 8.19 | 4 / 15 (7) | sounding |
| catalog/method/czerny849/014.mxl | 8va | 1 | 104 | E5–E7 | 1.08 / 6.63 | 1 / 13 (5) | sounding |
| catalog/method/czerny849/016.mxl | 8va | 1 | 35 | C6–Bb6 | 1.03 / 7.74 | 4 / 16 (2) | sounding |
| catalog/method/czerny849/017.mxl | 8va | 1 | 100 | G5–E7 | 1.27 / 7.34 | 5 / 13 (7) | sounding |
| catalog/method/czerny849/018.mxl | 8va | 1 | 33 | Bb5–G7 | 2.33 / 8.76 | 1.5 / 13.5 (4) | sounding |
| catalog/method/czerny849/019.mxl | 8va | 1 | 41 | C5–F7 | 2.32 / 8.2 | 6.5 / 14.5 (4) | sounding |
| catalog/method/czerny849/020.mxl | 8va | 1 | 216 | F#5–D7 | 0.25 / 5 | 4 / 13 (4) | sounding |
| catalog/method/czerny849/021.mxl | 8va | 1 | 181 | F5–Eb7 | 0.55 / 5.53 | 2 / 11 (7) | sounding |
| catalog/method/czerny849/022.mxl | 8va | 1 | 42 | G#5–E7 | 1.67 / 7.79 | 1 / 13 (3) | sounding |
| catalog/method/czerny849/023.mxl | 8va | 1 | 37 | A5–E7 | 1.32 / 7.49 | 2 / 14 (3) | sounding |
| catalog/method/czerny849/024.mxl | 8va | 1 | 57 | D5–D7 | 0.53 / 5.21 | 3.5 / 15.5 (4) | sounding |
| catalog/method/sonatina/018.mxl | 8va | 1 | 16 | G5–B6 | 0.44 / 5.69 | 6.5 / 18.5 (2) | sounding |
| catalog/method/sonatina/022.mxl | 8va | 1 | 23 | G5–C7 | 0.57 / 5.48 | 18.5 / 30.5 (2) | sounding |
| samples/marks-sample.musicxml | 8va | none named | 3 | C6–G6 | 0.33 / 6 | 5 / 17 (1) | sounding |
| two G0 hold-out references (not named, G0 rule) | 8va | — | 72 | — | — | — | sounding (both) |
| tests/bench/corpus/correctness/C10-octave-shift-8va.musicxml | 8va | 1 | 5 | G6–D7 | 3 / 10 | 20.5 / 32.5 (2) | sounding |
| tests/bench/corpus/correctness/C11-octave-shift-8vb.musicxml | 8vb | 1 | 4 | C1–F1 | 2.5 / 9.5 | 19 / 31 (2) | sounding |
| tests/engrave/fixtures/e/E18-ottava.musicxml | 8va, 8vb, 15ma, 8va (no staff) | 1, 2, 1, both | 11 | G1–E7 | 0.09 / 6.09 | 16 / 29 (5) | sounding |
| tests/scoregraph/fixtures/xml/ottava-8va-8vb.musicxml | 8va, 8vb | 1, 2 | 6 | G2–C6 | 0.67 / 0.83 | 8.5 / 20.5 (2) | sounding (one sign: the page reads both ways) |

**Result: 30 of 30 catalogue and sample files, and all four fixtures, are encoded as sounding pitch (MusicXML).** None is
written-encoded, so the audit gives MX-2 no octave-line defect. Every catalogue line is an 8va on the treble staff. Edition
evidence agrees: every catalogue file with a line is a MuseScore/PDMX typeset (the Burgmüller and Sonatina files name their
musescore.com source; Czerny 849 is Neru Hayashi's PDMX typeset; Czerny 299 has no provenance record, it is quarantined
P1), and MuseScore exports `<pitch>` as sounding with `type="down"` for an 8va. No Beyer file has an octave line. The
largest "joins" values (Burgmüller 15, Czerny 299/4, Sonatina 22) are leaps into the line where the written reading is
larger still.

## 4. Tests (each fails on `1c92fc4` and passes here)

| Test | What it proves | On `1c92fc4` |
| --- | --- | --- |
| `tests/scoregraph/app-playback.test.js` (new, node, in `test:scoregraph`) — the app's own `Score.finalize` and `PianoScore` read out of the App file | 7 tests: all 34 committed octave-line files (2,255 notes under a line) sound the graph's concert pitch, print it less the shift, strike it; E18 8va/8vb/15ma/unnamed-staff values and labels; the parse-ottava-8va-8vb fixture; a transposing part under an 8va; a pre-MX-1 saved song (read back unchanged, A48-exact from its own graph, no longer `agree`d with the file); E17 pedal change (spans, CC64 0/127, the sampler's releases, a numeric depth stays a half pedal); change/stop edge cases | 7 of 7 fail |
| `tests/playback-scheduler.test.js` (browser) | +5: what the scheduler hands the piano for E18 and the 8va/8vb fixture through both doors, and E17's releases | 5 of 5 fail |
| `tests/follow.test.js` (browser) | +3: follow gates and the keyboard ask for the sounding keys under E18's lines, and playing them advances | 3 of 3 fail |
| `tests/midi.test.js` (browser) | +4: MIDI out sends the sounding pitch under an 8va and CC64 0 then 127 at a change; a three-note `.mid` gets the four-note message in en/ko/ja/zh | 4 of 4 fail |
| `tests/engraving.test.js` (browser) | +2: E18 through the app's reader is drawn "8va" over the treble staff, "8vb" under the bass, "15ma"; its notes on the staff where the page prints them | 2 of 2 fail |
| `tests/pdf-layer.test.js` (browser) | +1: PdfLayer's 8va (sound from the glyph) and `Score.finalize` (print from the sound) give the same layers | fails (double shift) |
| `tests/transcription.test.js` | its 8va fixture changed to MusicXML's own encoding (`type="down"`, `<pitch>` C5): printed C4, sounds C5 | — |
| `tests/engrave/{agree,identity}.test.js`, legacy fixtures | `unfinalize` and the practice map state D-1; the two captured 8va Scores re-captured from this page (`capture-legacy-scores.js`; the other 11 byte-identical); the pre-MX-1 capture kept as `tests/scoregraph/fixtures/saved/stored-pre-mx1-ottava.score.json` | — |
| `tests/scoregraph/tools/ottava-check.js` (new, page, local) | every octave-line file, both doors: sounding MIDI = the graph's concert pitch, writtenMidi = concert − shift, the player's strikes, and the legacy renderer's noteheads measured on the SVG at the written staff position, and its labels | 34 of 34 files fail |

## 5. Gates and evidence

The base is `1c92fc4` from `git archive`, served on its own port; every browser check ran against both servers
(`node -r ./tests/engrave/tools/with-port.js`, `PPP_PORT`), each suite on its own.

| Gate | This branch | Base `1c92fc4` |
| --- | --- | --- |
| `npm run test:scoregraph` | 212/212 (205 + 7 new) | new file 0/7 |
| `npm run test:engrave` | 132/132; A48 (A) 544 files, 540 exact, 4 named losses (unchanged, not loosened); A48 (C) 13 captured Scores exact | 132/132, same A48 numbers |
| CRLF checkout (`git checkout-index`) | engrave 132/132, app-playback 7/7; scoregraph 207/212 — the 5 are the tests that need `.git`, as on the archived base | — |
| G0 unit / golden / sg-roundtrip / lint-corpus / provenance / correctness | 283 OK / 17/17 identical / 369 files, 2 allowlisted / 0 errors / ok / 13/13 (C10, C11 "app reading: KNOWN_DEVIATION" — MX1-D7) | — |
| `run` + `check` smoke, core, robust; replay-public | PASS, PASS, PASS; PASS | — |
| `ab --suite core --a git:HEAD --b worktree` (and smoke) | PASS; `ab_identical.py`: 553/553 and 44/44 cases the same (status, metrics, semantic projection); `known_failures` identical | — |
| engrave CI checks (E fixtures, corpus manifest, metrics, layout hashes, `bench.js check` r/e/x), MIDI fixtures, transcription-core, arranger | all exit 0 | — |
| `shadow-legacy.js --check` | 398 files, 375 identical, 23 listed, 0 unexpected | the same |
| `pitch-layers-check.js`, `app-import-check.js` | all ok (the transposing part draws written, sounds concert; the 8va fixture differs only by its line) | — |
| `ottava-check.js` (new) | 34/34 files: 19,582 notes, 2,255 under a line, all measured on the page; 30,809 strikes | 34/34 FAIL |
| `legacy-parity.js` (base → this) | only `ottava` (close, whole) differs | — |
| the same, extended in scratch to every octave-line file and 12 without one | 47 renders differ, every one in an octave-line file (all 34 whole-score views, 11 close views that reach a line, the committed `ottava` pair); the 38 renders without a line are byte-identical | — |

Browser suites (distinct checks passed / failed):

| Suite | This branch | Base | The difference |
| --- | --- | --- | --- |
| musicxml | 42 / 1 | 42 / 1 | none; the 1 is the refused 127.0.0.1:8788/health |
| playback-scheduler | 9 / 0 | 4 / 5 | the 5 new checks |
| follow | 31 / 1 | 28 / 4 | the 3 new checks; the 1 is 8788 |
| engraving | 37 / 0 | 35 / 2 | the 2 new checks |
| midi | 74 / 0 | 70 / 4 | the 4 new checks |
| alignment, falling-notes, layout | 11 / 0, 26 / 0, 45 / 0 | the same | none |
| pdf-layer | 52 / 0 | 51 / 1 | the new check |
| transcription | 84 / 1 | 83 / 2 | the changed 8va fixture; the 1 is the missing transkun venv |
| import-and-persistence, interactions | 8 / 2, 52 / 2 | the same | none; 8788 |

## 6. What remains

- **Saved songs are not migrated** (MX1-D3). A Score saved before MX-1 (a song slot, a shared score) keeps the reading it
  was saved with: drawn = played still holds for it, an octave from the file. Importing the file again reads it anew. A
  course piece already on the shelf is reopened from its slot (App `openCoursePiece` → `openSong`), so a person who
  opened one of the 30 catalogue pieces with a line before MX-1 keeps the old playback until the song is removed and
  added again. A load-time migration needs a marker that says which rule a stored Score was finalized with (a stored
  line does not say whether it came from a file, where the sign flipped, or from PdfLayer, where it did not); that is a
  follow-up if the Lead wants one. A G4 renderer that draws from the graph will not take such a Score for its file
  (`agree` fails) and falls back to the Score's own projection.
- **The G0 bench still models the pre-MX-1 app** (MX1-D7): `pppbench/musicxml.py` `ottava="app"`, the known-failure class
  `octave_shift_playback` (30 files, 2,229 notes), the C10/C11 "the app reads this differently" notes and unit test r20.
  None of them feeds a core/smoke metric (predictions carry no octave line), so the G0 numbers do not move; the local
  conformance tier (T1-C) would now differ on the octave-line files. Updating them changes `known_failures` and belongs with
  MX-2's rebaseline.
- An OMR (Audiveris) file with an `<octave-shift>` is now read the MusicXML way too; whether Audiveris writes the sounding
  pitch under a line is not checked (no committed OMR output has one).
- A line that names no staff moves the notes of every staff (G2 parity, G4 fixer P6), and the legacy renderer draws its
  bracket once, over the treble. Only E18 bar 3 has notes on the other staff under such a line; no catalogue file does.
  The G4 renderer decides how to draw it.
- G3's automatic 8va and `pedalJoin` stay off; reopening them is their Goal's decision (G3-D2, G10a).
