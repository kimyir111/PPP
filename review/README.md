# review/ - blind review tooling for G9 (H-8 and H-9)

Builds the packets for the two human reviews the G9 design leaves to the user's own time
(`docs/GOALS/G09_CANDIDATES_CRITICS_REPAIR.md` section 5 G9c, section 12 "G9c - blind review tooling"):

- **H-8, diagnostic**: about 16 items (pieces at one or two difficulty levels). For each item the reviewer sees two
  arrangements of the same piece, X and Y, and says which is better and what is wrong with each.
- **H-9, pass/fail**: 16 pieces, X and Y each marked pass or fail ("would you give this to a student at that level").

One of X and Y is the **current G9 pipeline** (G9a best-of-N selection, then G9b repair); the other is the **legacy
comparator**. Which is which is decided by a secret seed and never shown to the reviewer.

Nothing here touches the app or the server. Nothing generated is committed.

## Build a packet

```
node review/build.js --mode h8 --seed <secret> --out <dir> [--key-out <dir>]
node review/build.js --mode h9 --seed <secret> --out <dir> [--key-out <dir>]
node review/build.js --mode h8 --list            # show which pieces would be used, write nothing
node review/build.js --mode h9 --seed s --out d --items items.json   # your own [{file, targetLevel, handProfile}] list
```

- `--seed` is a secret string (at least 4 characters). Pick it, note it, do not give it to the reviewer. It is written to
  the key file only.
- `--out` becomes the **packet**: `index.html` (the whole review, one self-contained file) and `manifest.json`. **It must be
  outside every git working tree**; the build refuses (before doing any work) a path in this repository or in any other
  checkout, and refuses a key directory inside the packet directory or the reverse.
- `--key-out` becomes the **key**: `key.json`. Default is a sibling of `--out` named `<out>-key`. **Never give the key to the
  reviewer.**
- A full build takes about a minute (it runs the real G9 pipeline and the legacy engine on every piece; H-9 also has to run
  the H-8 selection first, to avoid reusing its pieces).

Give the reviewer the packet directory (or just `index.html`). When they send back the exported ratings file:

```
node review/decode.js --key <key-dir>/key.json --ratings ratings-h8-<id>.json [--out summary.json]
```

`decode.js` refuses a key and ratings that are not the same packet or mode, then reports per arm (G9 vs legacy): preference
counts (ties counted), G9's share of decisive items with a 95% Wilson interval and an exact sign test, H-8 issue tags and
notes, H-9 pass rates with intervals and the paired both/only/neither table with an exact McNemar test. It sets no pass
threshold: what H-9 must show before a flip is the user's decision.

## What the reviewer does

Open `index.html` from disk in any current browser (no network, no server). For each item: read the X and Y scores, press
Play on each (a plain Web Audio synth of the same notes; speed 100/80/60%), and fill in the form - H-8: which is better,
and per arrangement the issue boxes (too hard, too easy, wrong harmony, melody unclear, awkward hand position, thin/muddy)
plus a short note; H-9: Pass/Fail per arrangement (and an optional preference). Ratings are kept in the browser's
`localStorage` as they go (so the page can be closed and reopened on the same computer); **Download ratings (JSON)** writes
the file to send back (the same JSON is also shown in a box to copy, in case a download is blocked). The reviewer names
their role, not themselves.

## The two arrangements

For an item `(file, target G6 level, hand profile)`:

- **G9 arm** - `candidates/index.js run` (G9a: up to 24 candidates over pattern x hand profile x planning-level offsets, G5
  hard-violation filter, six critics, engrave gate on the top 3) then `repair/index.js repairSelection` (G9b), all defaults, at
  the request `{targetLevel, handProfile, sections:'all'}` - the same wiring `realize/tools/harness.js runFile` uses for its
  `g9aRepair` row, at the request the G8a plan search (`findG8Plan`) finds for the piece.
- **Legacy arm** - the app's in-page **`ScoreArranger`** (`realize/tools/legacy.js runScoreArranger`, the class extracted
  read-only from the app file), run on the original piece at each of its four native levels; the level whose **measured G6
  position is closest to the same target** is kept (`harness.js bestLegacyRun`, the fairness every harness row gets). Why this
  engine: of the three legacy engines the G8a harness measured it is the strongest on the harness metrics, and it is the one the
  app runs in the page; `arrange_score.py` (the Python helper) and `audio-score.js` (no notated rhythm or hands) did worse.
  Beating the strongest legacy engine is the conservative test. The legacy engine runs in its own process with a 120 s limit
  (it has hung on real pieces before, TD15); a timeout drops the piece, it is never a result.

The **target level is a request, not a promise**: G7b cannot plan below a piece's own level, and both arms often sit at or
below the target (the key records each arm's measured level). The reviewer is told the target only as "aimed at level N".

## How the blinding works

- **Assignment.** Items are ranked by `HMAC-SHA256(seed, "xy|" + file|level|hand)`; even ranks show G9 as X, the others as Y,
  so the split is as even as possible (n even: exactly half) and position bias cannot pass for a preference. The shown order is
  a second HMAC. The rule is public (`review/lib/blind.js`); without the seed it cannot be replayed. The seed is written to the
  key file only. (The M-H1 lesson, `docs/DECISIONS.md` G4-D2-19: a manifest that stated the seed and the rule let a reviewer
  recompute every X/Y.)
- **One drawing path for both arms** (`review/lib/neutral.js`). Both arrive as flat notes and are re-drawn identically: only
  measure, beat, duration, pitch spelling, staff and hand are kept; voices are re-derived from the notes alone; printed
  accidentals are recomputed from the spelling and key for both; one measure list, one tempo, one engraving configuration; the
  SVG has every `data-*` attribute (event ids, graph fingerprint) removed and per-drawing glyph ids that name only the item and
  the label. What is deliberately **not** shown: G9's own fingering, tempo marks, voice/beam structure, and ties (a tied note is
  two struck notes, in the drawing and in the sound, on both sides). So the review judges **the notes an arranger chose**, not
  how well an engine notates them.
- **The packet** is two files. The manifest lists the pieces and levels and gives X and Y the same two fields
  (`label`, `bars`); it has no seed, no rule, no engine name, no per-arrangement count, size or level.
- **Tests** (`npm run test:review`): a byte-level scan of every packet file for `g9`, `legacy`, `scorearranger`,
  `arrange_score`, `selected`, `repaired`, `repair`, `candidate`, `critic`, `realiz`, `engine`, ... and for the seed; identical
  packets for the same seed whatever order the items are listed in; a different seed changes assignment and order; the split
  is even; an unkeyed guess does not reproduce it; identical field sets for X and Y in the manifest, the page data and the SVG
  roots; no `data-*`, fingering or tempo marks in any SVG; no external URL, request or import in the page; the key is
  outside the packet directory.

**What blinding does not hide: the music.** G9 usually writes a fuller texture (more notes) than ScoreArranger, and a reader can
see that. The tooling closes every channel except the notes; it cannot make two different arrangements look alike. A reviewer
who guesses G9 from density is still judging the notes, but the preference is then not independent of the guess.

## Which pieces

Pool: the 61 files of `tests/engrave/corpus.json` (the corpus every G8/G9 measurement uses). A piece is usable only if it
really runs: 8-40 bars; a G7b plan exists for it (`findG8Plan` - about half the corpus has none, the binding constraint); G9
returns an arrangement; ScoreArranger returns at all four levels within the limit (no timeouts); at the level reviewed the two
arms are not the very same notes; both draw. Files are then tried in a fixed order and the first that qualify are taken:

1. **Overlap preference** (so the review says as much as possible about pieces G9 was not tuned on). H-8: tier 0 (never in
   any G9 measurement: 13 files) before tier 1 (the 32-file held-out slice, measured once after the code was frozen) before
   tier 2 (the 16-file tuning sample, which selection was tuned against). H-9: tiers 0 and 1 before tier 2, and pieces not
   chosen for H-8 before ones that were. Tiers are computed from `harness.js sampleFiles(16)` / `heldOutFiles(32)`.
2. Within a preference group the corpus strata (hymns, beyer, czerny599, ...) are taken round-robin, and inside a stratum by
   `sha256("g9c-inputs-v1:" + path)` (a public constant that only orders candidates; unrelated to the secret seed).

H-8 wants two levels per piece: candidate targets are the request level and +1, +1.5, +2 above it; a target is kept only if
both arms give different notes there, and a second one only if G9's arrangement is really fuller (G6 level at least 0.25 higher,
or at least 1.1x the notes). Pieces with two levels are taken first (up to 8); only if fewer than 8 exist are single-level
pieces used to reach 16 items. **Overlap with the measurement samples is stated in the key file (`tier` per item) and in the
G09 section 12 record; any tier-2 piece makes that item optimistic for G9.**

## Ratings: what they can and cannot show

They can show, for these pieces and this reviewer, whether the notes G9 chose are preferred to ScoreArranger's, and where each
falls short (H-8), and what share of each arm a teacher would hand to a student (H-9). They cannot show: that G9 is better in
general (about 16 items, one reviewer: wide intervals, and the pieces are the ones G7b can plan, at hand profile `large`, against
one legacy engine); why one was preferred; anything about touch, pedalling, phrasing or fingering (the sound is a plain synth of
the notes, and fingering is not shown); or that the difference would survive the notation each engine would produce in the app.
The H-9 bar for flipping the default is not fixed here.

## Files

- `build.js` - packet builder CLI and `buildPacket()`; `decode.js` - ratings + key.
- `lib/select.js` - the input rule; `lib/arrange.js` - the two arms; `lib/legacy-worker.js` - ScoreArranger in a child
  process; `lib/neutral.js` - the one drawing path; `lib/blind.js` - the assignment; `lib/page.js` - the reviewer page.
- Tests: `tests/review/` (`npm run test:review`).
