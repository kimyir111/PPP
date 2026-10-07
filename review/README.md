# review/ - blind review tooling for G9 (H-8 and H-9) and, further down, for G10a-5 (H-10)

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
node review/build.js --mode h8 --out <packet-dir> --key-out <key-dir> [--seed <secret>]
node review/build.js --mode h9 --out <packet-dir> --key-out <key-dir> [--seed <secret>]
node review/build.js --mode h8 --list            # show which pieces would be used, write nothing
node review/build.js --mode h9 --out d --key-out k --items items.json   # your own [{file, targetLevel, handProfile}] list
```

- `--seed` is optional. Leave it out and a random 32-hex-character one is made (the best choice: nobody has to remember it,
  it is in the key). If you give one it must be at least **20 characters** and secret: the shown order is a plain HMAC sort and the
  manifest lists the pieces in it, so a short or dictionary seed can be guessed from the manifest alone (a review recovered
  `hello` in one guess). Either way it is written to the key file only.
- `--out` becomes the **packet**: `index.html` (the whole review, one self-contained file) and `manifest.json`. **It must be
  outside every git working tree**; the build refuses (before doing any work) a path in this repository or in any other checkout.
- `--key-out` is **required** (no default) and becomes the **key**: `key.json`. It must be a different tree from `--out`: not
  inside it, not containing it, and not inside its parent folder (so `--out X/h8 --key-out X/h8-key` is refused: zipping `X` to
  send the packet would ship the key). Example: `--out %TEMP%\review\h8 --key-out %TEMP%\review-keys\h8`. **Never give the key to
  the reviewer.**
- A full build takes 1-2.5 minutes (it runs the real G9 pipeline and the legacy engine on every piece; H-9 also runs the H-8
  selection first, to avoid reusing its pieces). The build refuses any packet in which a side (drawing or sound) of one item
  is identical to a side of another item.
- Sound: notes that are the continuation of a tie are joined, and one pitch struck by both hands at one onset sounds once, for
  both arms (the drawn score is unchanged). The sound is made from the arm's own notes and is not touched by any drawing rule.
  The instrument is the PPP app's own sampled grand piano (see "The sound", below).
- Size: each side is embedded twice (wide and narrow drawing), about 0.25 MB per item, plus the piano recordings once per page
  (1.67 MB as base64); a 16-item packet is about 5.7 MB (H-8) to 6.5 MB (H-9), an 11-item one about 4.2 MB.
  **Packets built before this change (`D:/PPP-review/*`) are obsolete**: their scores lack rests and ties, are drawn 4 bars to a
  system, and force a 640 px minimum width. Rebuild them.


Give the reviewer the packet directory (or just `index.html`). When they send back the exported ratings file:

```
node review/decode.js --key <key-dir>/key.json --ratings ratings-h8-<id>.json [--out summary.json]
```

`decode.js` refuses a key and ratings that are not the same packet or mode, then reports per arm (G9 vs legacy):
preference item counts (ties counted) and, for the test, **piece-level** counts (two items of one piece are not independent, so a
piece counts once: G9 if it won more of its items, legacy if fewer, else a tie; a 95% Wilson interval and an exact sign test over
the decisive pieces; no item-level p-value), H-8 issue tags and notes, H-9 pass rates over pieces (a piece passes an arm only if
every rated item of it passes) with intervals and the paired both/only/neither table with an exact McNemar test. It also splits
the preference and pass numbers **by note-count ratio (G9 fuller / similar / legacy fuller) and by which arm missed the requested
level by more** (numbers the builder keeps in the key, never in the packet), descriptive only, and prints the confounds and
caveats. It sets no pass threshold: what H-9 must show before a flip is the user's decision.

## What the reviewer does

Open `index.html` from disk in any current browser (no network, no server). For each item: read the X and Y scores, press
Play on each (the same notes on the app's own sampled piano; speed 100/80/60%; the first Play takes a moment to load the sound, and the button says "소리 불러오는 중..." meanwhile), and fill in the form - H-8: which is better,
and per arrangement the issue boxes (too hard, too easy, wrong harmony, melody unclear, awkward hand position, thin/muddy)
plus a short note; H-9: Pass/Fail per arrangement (and an optional preference). Ratings are kept in the browser's
`localStorage` as they go (so the page can be closed and reopened on the same computer); **Download ratings (JSON)** writes
the file to send back (the same JSON is also shown in a box to copy, in case a download is blocked). The reviewer names
their role, not themselves.

## The sound

The review page plays the app's piano, not a synth: the 30 Salamander Yamaha C5 recordings from `audio/piano/` (one every minor
third from A0, CC BY 3.0) are read by `build.js` (`readPianoSamples`, at build time; no copy is committed) and embedded ONCE per
page as a base64 JSON list in `<script id="piano-samples">`. `lib/page.js` decodes them from those bytes (`atob`, then
`decodeAudioData` on an `OfflineAudioContext` at 32 kHz, on the first Play press; nothing is fetched, so it works from disk and inside
an Artifact page) and is a port of `Piano Coach App.dc.html`'s `PIANO`, `pianoAttack` (skip the silence before the hammer),
`pianoDamp` (release times 0.075 / 0.1 / 0.14 / 0.6 s by register), `pianoRoom` (small reverb at 0.22 wet; its noise is a fixed
sequence here instead of `Math.random`), `PianoSamples.pick` (nearest recording, pitched by at most a semitone) and
`PianoPlayer.strike / release / prune / silence` (per-voice lowpass by velocity, limiter, bus gain 1.4, one string per key,
72 voices). Differences from the app, all because the review has no dynamics, pedal or hands: every note is struck at the
app's default velocity 80 (mezzo-forte), both arms alike; a note is held for its written length (ties already joined) and let go
by the damper; the whole phrase is put on the audio clock at once, so chords land together and the tempo holds while the page is
busy. If the recordings cannot be decoded (or the page has no sample block) a small additive synth plays the same notes; a key
whose own recording failed borrows a neighbour's. The tap itself does what the app's `wake` / `unlock` / `ping` do (create or resume the `AudioContext` and start a one-frame silent buffer, all
before anything is awaited), because iOS only accepts sound from a tap that does so; then the recordings decode, then the player is built, and
only then is the 0.12 s lead before the first note taken, so a slow phone cannot make the first chord late. A phrase that plays to
its end is not cut by a final silence (the top octaves' dampers take up to 0.6 s); only Stop silences. The page ends with the CC BY 3.0
credit for the recordings, in Korean and English. With no Web Audio at all the page says so and plays nothing (as before; a synth
cannot run without it either). `window.__pppReview.sound` exposes the decoded samples, the last play and an offline render for the tests.

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
below the target, ScoreArranger more than G9 (on the sample packets the mean absolute miss was about 0.5 for ScoreArranger
against 0.2-0.3 for G9; the key records each arm's measured level). The page says the level was *requested*, that neither arm is
guaranteed to land on it, and to mark "too easy / too hard" only if it would be so for a student at about that level.

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
  the label. What is deliberately **not** shown: G9's own fingering, tempo marks and voice/beam structure. So the review judges
  **the notes an arranger chose**, not how well an engine notates them.
- **The drawing shows what the notes are** (see "Review page fidelity" below): rests, ties, a per-measure lower-staff clef,
  fewer bars per system, and a second drawing laid out for a phone.
- **The packet** is two files. The manifest lists the pieces and levels and gives X and Y the same two fields
  (`label`, `bars`); it has no seed, no rule, no engine name, no per-arrangement count, size or level. No side of any item
  is identical to a side of another item (checked at build time and in a test).
- **Tests** (`npm run test:review`): a byte-level scan of every packet file for `g9`, `legacy`, `scorearranger`,
  `arrange_score`, `selected`, `repaired`, `repair`, `candidate`, `critic`, `realiz`, `engine`, ... and for the seed; identical
  packets for the same seed whatever order the items are listed in; a different seed changes assignment and order; the split
  is even; an unkeyed guess does not reproduce it; seeds under 20 characters are refused and an omitted seed is random and
  only in the key; no side of any item repeats a side of another; identical field sets for X and Y in the manifest, the page
  data and the SVG roots; no `data-*`, fingering or tempo marks in any SVG; no external URL, request or import in the page; the
  key directory is required and may not sit in the packet's folder; a real (not stubbed) browser download of the ratings.

**What blinding does not hide: the music.** G9 usually writes a fuller texture (more notes, almost all of the extra ones in
the left hand) than ScoreArranger, and a reader can see that: on the sample packets "the fuller one is G9" was right for 12 of
the 13 H-8 items and 10 of the 11 H-9 items whose densities clearly differed. The tooling closes every other channel; it cannot
make two different arrangements look alike. A preference for the fuller arrangement is therefore not independent of that guess -
which is why `decode.js` splits by density and by level miss.

## Review page fidelity (rests, ties, spacing, phone, clef)

An investigation found the page itself misrepresented both arms' scores; all of this is in `lib/neutral.js` / `lib/page.js`,
one path for both arms, reading only the notes:

- **Rests.** Each staff's silent stretches (gaps between its notes and to the bar end; the engines' own rest entries are
  ignored, so both arms follow one rule) are drawn as rests: a silent bar is a whole-bar rest, other gaps are cut at the beats
  and written as the largest value that fits and starts on a multiple of its own length (compound meters: dotted values per
  beat). A gap that is not on a 1/64 grid (a triplet edge; ScoreArranger writes some sextuplets as plain 16ths of length 1/12) is
  left alone, never approximated.
- **Ties.** A `tieStart` note and a `tieStop` note of the same pitch and staff that meet exactly are drawn tied; an unpaired
  flag is dropped; a tied continuation prints no accidental of its own; a note that runs past its barline is cut into tied pieces
  of ordinary values (it would otherwise vanish). Only G9's notes carry tie flags today (ScoreArranger re-strikes), so ties appear
  on G9's side only: that is the music, and the sound already joins them.
- **Spacing.** The wide drawing is the desktop configuration with `barsPerSystem: 2` (the engraver's default is 4, which
  packed 16th runs under 2 staff spaces apart; the engraver treats the number as a target and may still fit a third bar where
  they are sparse). The narrow drawing is the engraver's own phone configuration (`screenConfig(720)`: 40 staff spaces, 2 bars a
  system, what the app uses at 720 px or less). `page.js` embeds both and a `@media (max-width:720px)` rule shows one; the old
  `min-width:640px` and the sideways-scrolling box are gone. Glyph ids are per drawing (`i01X-...` and `i01X-n-...`). Ratings and
  sound never read the drawings.
- **Clef.** The upper staff is always treble. The lower staff's clef is chosen per measure by what an engraver looks at, the
  clef that needs fewer ledger lines: each note's lines are counted as `realize/ottava.js` counts them (treble staff E4..F5,
  bass staff G2..A3; two diatonic steps to a line) and summed over the measure. The staff opens in bass; it changes only at a
  barline and only when the other clef costs at least `CLEF_SAVE_SHARE` = 0.5 less and at least `CLEF_SAVE_MIN` = 4 lines less
  than the clef in force (a tie or a small gain keeps it); a stretch shorter than `CLEF_MIN_RUN` = 2 measures with notes is
  folded into its neighbours; a measure with no notes keeps the clef. Neither arm uses the source's clefs. (The first try, 0.25
  and 2 lines, made 11 and 6 clef changes on the 12 pieces and more 8va/8vb lines, because mid-range bars differ by only a
  line or two.)
- **Order.** The per-measure clefs are written into the graph first and the 8va/8vb pass (TD16, `realize/ottava.js`,
  unchanged) runs on that graph, so it counts ledger lines against the clef the drawing uses (a test checks every line against the
  drawn clef, both arms alike).
- **Not fixed here:** TD16 still fires for a left hand that sits at exactly two ledger lines in the clef drawn (E4/F4 over the
  bass staff, A3 and lower under the treble one, sustained for a bar): that is its rule, no clef choice avoids it for a hand
  that spans G3-F4, and its constants are not tuned here; slurs, dynamics and fingering are not drawn; sextuplet-like 1/12 notes from ScoreArranger have no tuplet mark.

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

H-8 may show a piece at a second, higher level (candidate targets: the request level and +1, +1.5, +2 above it), but **only if
both arms change**: at the second level G9's arrangement is really fuller (G6 level at least 0.25 higher, or at least 1.1x the
notes) AND the legacy notes differ from the legacy notes at the first level. (A first version required only G9 to change;
ScoreArranger has four native levels and usually returned identical notes at both targets, so a repeated score gave the arm away
and 16 items covered 9 pieces - an independent review's blocker.) Otherwise one level per piece. Pieces are taken in the order above
until there are 16 items. **On the current corpus the selection order never reaches a piece with such a second level (one piece, gymnopedie-1, would qualify, but it is 60th of 61 in the order), so H-8 is 16 items over 16 different pieces
(one level each) - the "8 inputs x 2 levels" shape is gone, and that is the price of independent items.** H-9 is 16 pieces; about 13 of them are also in H-8, so someone doing both reviews sees most pieces twice. Prefer the random seed (omit --seed): the 20-character check is length only.
**Overlap with the measurement samples is stated in the key file (`tier` per item) and in the G09 section 12 record; any tier-2
piece makes that item optimistic for G9.**

## Ratings: what they can and cannot show

**What H-8/H-9 can and cannot support.** They can say whether *this reviewer* prefers G9's notes to ScoreArranger's on
G7b-plannable pieces at hand profile large, where each arm falls short (H-8), and what share of each arm this reviewer would
hand to a student (H-9). They **cannot** show that G9 is generally better: blinding does not hide the arm on most items, and
preference is confounded with density (G9 is fuller), left-heavy voicing (the extra notes are left hand) and level miss
(ScoreArranger misses the requested level more), none of which the design separates; the reviewer is one person, with about 16
units and wide intervals, on one legacy engine. They say nothing about touch, pedalling, phrasing, fingering (not shown), small
or medium hands (only `large` is reachable), or whether the difference would survive the notation each engine would produce in
the app. The H-9 bar for flipping the default is not fixed here.

## H-10 - the blind review of the recording conversion (G10a-5)

A different review, built on the same page conventions: the teacher compares **how PPP writes a recording down** - the new conversion (`recording: 'v2'`)
against the classic one - on pieces she chose, blind, on a phone, in Korean (`docs/GOALS/G10_AUDIO_TO_SCORE.md` sections 10 and 27). Nothing here touches the
app or the server; packets and keys are written outside every git tree, never committed.

```
# 1. the heard notes of YouTube pieces, as the app's own browser transcription gives them (about 6 minutes a piece; 2 or 3 at a time)
node review/h10/collect.js --items links.json --out <heard-dir> [--parallel 2] [--max-minutes 15] [--force] [--only id1,id2]
# 2. the packet
node review/build.js --mode h10 --heard <heard-dir> --out <packet-dir> --key-out <key-dir> [--seed <secret>] [--jobs 3]
                     [--excerpt-bars 12] [--excerpt-seconds N] [--level intermediate] [--no-titles]
# 3. the answers
node review/decode.js --mode h10 --key <key-dir>/key.json --ratings ratings-h10-<id>.json [--out summary.json]
node review/decode.js --mode h10 --key <key-dir>/key.json --db rows.json        # answers read out of the artifact database
```

- **links.json** is `[{ id, url, title?, excerpt?: { bars?, seconds?, start? }, inputClass?: "CLEAN_INPUT" | "UPSTREAM_ERROR" }]`; `id` is letters, digits, `-`, `_`.
- **The collector** (`review/h10/collect.js`) serves THIS tree with `tests/serve-free.js` (a free port, `NODE_ENV=production`, nothing on 8788) and drives the real page
  under puppeteer as a person would (My Songs, the add card, the link, "Make sheet music"), one browser process and one port per piece. The local server cannot download
  audio, so the page's `GET /api/youtube-audio` is answered by the production endpoint (`--audio-base`, default `https://ppp-web-2o99.onrender.com`): the only request it makes of
  production, a read-only GET; any other request of the page goes where the page sends it and nothing but GETs leaves this machine. It writes ONLY in `--out`: `<id>.json` (the
  heard notes, the shape of the app's `PPP.app._heard`, the same as a `heard-*.json` kept from an earlier run), `collect-status.json` (per piece: status `ok` / `refused` /
  `too-long` / `no-notes` / `failed`, model, notes, duration, `truncated`, download and transcription seconds, the reason) and `items.json` (the list; later runs add to it).
  **Nothing is dropped silently**: a refused link, a piece whose decoded audio is longer than `--max-minutes` (15 = the app's own limit, checked before the model starts so
  no 40 minutes are spent), a piece the app cut at its limit, one that hears no notes, a timeout - each is in the status and on the console. A piece whose `<id>.json` exists is skipped
  (resumable; `--force`). `--stub-dir <dir>` replaces the model by notes from `<dir>/<id>.json` and the audio by a tiny wav (tests of the tool itself). Run for real on the teacher's 2:19 piece it took 446 s
  (71 s download, 367 s model) and wrote notes byte-identical to the earlier saved run.
- **The builder** (`review/h10/packet.js`, called by `build.js --mode h10`) reads that folder. Per piece, in its own process (`--jobs`, default 3): the heard notes go through the
  page's own conversion twice (`review/lib/appcode.js`: the options are read out of `Piano Coach App.dc.html`'s `finishHeard` call, `closeGaps` and `exactBars` in both, the page's
  plausibility check applied to v2), and each result - and the Song Arranger's one-note-per-hand copy of it at the middle level, made by the page's own
  `arrangeSingleNoteWithHandsFallback` (so a v2 graph the arranger refuses for hard violations is arranged from the same heard notes with the classic hands, as in the app) - becomes
  one score. Two parts per piece: **(T)** the transcription as the review screen holds it, **(A)** the arranger's copy of it. A piece whose arranger refused one of the two ways has no
  part A (said in the key). **X or Y is decided per piece by `HMAC(seed, id)`** (`lib/blind.js assignArms`, an even split, the same sides for T and A); the order of the pieces is a
  second HMAC; the seed rules are those of H-8/H-9 (at least 20 characters, random when omitted, in the key only).
- **What a score is.** The arm's graph through the app's own engraver (`engrave/`: `plan`, `createEngraver`, `layout` with the `window` of the excerpt's bars, `svg`), at the two
  layouts of the G9 page (the engraver's phone configuration up to 720 px, its desktop one with 2 bars a system above) - **not** re-derived from notes as in H-8/H-9: a recording's
  rests, ties, tuplets and bars are what is judged. The sound is the app's own player plan for the app's own Score of that graph (`Score.finalize(toScore(graph))`, `PianoScore`:
  ties joined, written pedal, the app's velocities and tempo map) played through the sampled piano of the G9 page. The builder refuses an item (and says so) whose drawing shows
  a different number of note heads or rests than the Score holds for the same bars; the key records both numbers.
- **The excerpt** (`lib/h10-excerpt.js`) is chosen in TIME from the heard notes alone, so both ways show the same seconds although their bar numbers differ: the length is
  `--excerpt-seconds` (or an item's `excerpt.seconds`), else `--excerpt-bars` (default 12) times the mean of the two arms' median bar length (6-60 s, never longer than the
  piece); the start is an item's `excerpt.start`, else the window that is sounding for at least 95% of its length, holds at least 60% of the piece's usual onset density, and lies
  closest to the middle of the piece (no silence; the earlier of two equally close). Each arm shows the bars that hold those seconds (at most a bar of margin at each end; the key
  has each arm's bars and the seconds they cover). A link `원곡 열기` opens the YouTube video in a new tab at the excerpt's first second; **no audio of the recording is in the page**.
- **The page** (`lib/page-h10.js`; one file, offline): per piece and part, X and Y one under the other (a 360 px column, targets at least 44 px), for each side Play (+ speed) and
  "would you give this to a student? (small fixes are fine)", seven tags (rests, hand split, bars and metre, note lengths, pitch and octave, missing or extra notes, other), an
  optional note; then which is better (X / Y / similar). Progress bar, "continue" button, resume where left off (it scrolls to the first part left open), a closing screen that
  lists what is open and exports. **Keeping the answers**: memory, `localStorage` on every tap (the page works with storage refused), and - when the file is published as an
  Artifact with the `db` capability (`capabilities: { db: {}, downloads: true }`) - the artifact database through the small adapter `store` (documents
  `answers/<packetId>/items/<id>` and `answers/<packetId>` for the role; per item the newer `t` wins on load, so another device resumes; a failed write says so and the answer
  stays on the device). Export: ratings JSON (`ppp-review-ratings/2`) by download (through the `downloads` capability when it answers), copy, or a text box.
  `decode.js --db rows.json` reads the database rows (`review/h10/db-to-ratings.js`).
- **Size and time**: the drawings of a page are packed (`lib/svgpack.js`: one glyph-id prefix, so the glyphs are written once, and the markup repeated between numbers becomes
  one character each); the piano recordings are embedded once as before. Measured: 10 pieces of the size of the teacher's (1,214 heard notes, 14-bar excerpts) 3.4 MB, built in
  101 s with 3 processes; 10 small fixture pieces 3.2 MB in 7.5 s. The packet says about 5.5 minutes a piece, so 10 pieces about an hour; to cut it, `--excerpt-bars 8`, or
  tell the reviewer part 1 alone is enough.
- **Blinding**: the page, the manifest and every drawing (after unpacking) are scanned by the tests for arm names, `v2`, version or build stamps, the seed and
  the way a score was made; the two sides of every part have one markup, one set of ids and classes; no side repeats a side of another piece (the builder refuses it); titles are the
  same for both sides (`--no-titles` leaves them out); the key alone holds the sides, the hands-fallback and plausibility facts, bars shown and the drawn/written counts. **What blinding does not hide: the
  music.** v2 usually writes far fewer rests and tuplet brackets and reads the bars differently; `decode.js` prints how many pieces each way draws more rests or brackets in, so a
  preference can be read against it.
- **Decode** prints, per arm: wins, losses and ties (per part and over both), pass rates with Wilson intervals, tag counts (per part, per piece), the per-piece table, the
  arranger's outcome (which pieces have no part A, which v2 copies came through the hands fallback, a v2 result the page threw away), the CLEAN_INPUT / UPSTREAM_ERROR split when the
  items were labelled, the notes in the teacher's words, and **the starting rule of G10 section 10 as the key fixed it before any answer existed** (v2 at least as good on 80% of
  the pieces answered, no piece where only v2 fails, v2 handed to a student on 60%), on part T and, for information, on part A. It decides nothing.
- **Limits**: one excerpt per piece (the rest of the piece is not seen); no recording audio; one reviewer; the model is the browser Onsets and Frames path (no helper, no pedal);
  part A of a v2 piece the arranger refused is made through the hands fallback, so it judges that conversion and not v2's own hand split; the page does not show the review
  screen's amber "not sure" bars (they would give v2 away); the fingering the arranger writes is drawn, as the app draws it.

## H-10b - the engine comparison (G10b-0)

The same review page and pipeline, for another question: the teacher's H-10 verdict was that both ways of writing a recording down fail mostly on **missing, extra and off-beat
notes** - the ceiling of the in-browser model. The helper ensemble (TransKun + Kong, run on the Lead's PC) hears about 1.6 times as many notes. Are the scores written from the
helper's notes **better** (the extra notes are real) or **worse** (clutter)? `docs/GOALS/G10_AUDIO_TO_SCORE.md` section 30. Both arms use the **v2** conversion with the page's own
options (as the H-10 builder's v2 arm does), from the notes alone: arm `browser` = the in-browser model's heard notes (what production serves), arm `helper` = the helper's accepted
notes. **No pedal and no Beat This beats for either** (measured on six pieces, the helper's beats made v2 write bars two to four times too short as wired).

```
# 1. the browser notes: the H-10 heard folder (review/h10/collect.js), unchanged
# 2. the helper notes of the same pieces: <root>/<id>/notes-cuda.json is what transcribe.py wrote on the helper PC; this makes a heard folder of them (items.json copied)
node review/h10/helper-heard.js --from <root> --heard <heard-dir> --out <helper-heard-dir> [--file notes-cuda.json]
# 3. the packet
node review/build.js --mode h10 --compare engine --heard <heard-dir> --heard-b <helper-heard-dir> --out <packet-dir> --key-out <key-dir> [--seed <secret>] [--jobs 3]
                     [--excerpt-bars 12] [--excerpt-seconds N] [--level intermediate] [--no-titles] [--list]
# 4. the answers (the page's export, or --db rows, exactly as H-10)
node review/decode.js --mode h10 --compare engine --key <key-dir>/key.json --ratings ratings-h10-<id>.json [--out summary.json]
```

- **The converter** (`h10/helper-heard.js`) keeps the helper's *accepted* notes as `{ on, off, midi, vel }` and nothing else (no confidence, support or models; no pedal; no beats; the
  single-model `uncertainNotes` are not notes and are only counted in `helper.uncertain`), `duration`, `engine`. A piece with no helper file, or one that is not helper notes, is said
  (`MISSING`) and left out; the builder then reports it as skipped. The files are the teacher's pieces' notes: keep them out of the repository like the packets.
- **Per piece** (`lib/h10-item.js buildEngineItem`): both note sets go through `APP.convertHeard(..., v2)` (the page's own function; the plausibility check applies and a score it
  throws away is kept, written by the classic conversion, and said in the key and on the console). Part **T** (the transcription as the review screen shows it) for every piece;
  part **A** (the one-note-per-hand arrangement) only when the arranger accepts **both** readings (the H-10 rule). X or Y per piece by `HMAC(seed, id)`, an even split, the same sides for T
  and A; the key records it.
- **One window of seconds per piece, from the BROWSER notes**: the helper hears more, so its density would pick another stretch. `lib/h10-excerpt.js pickExcerpt({ lengthArms: ['browser'] })`:
  the start is the H-10 rule (sounding, dense, closest to the middle) on the browser's notes, the default length is twelve of the browser's bars; each reading shows the bars that
  cover those seconds. When the readings have different bar lengths (a tempo octave) the one with shorter bars shows more of them for the same seconds.
- **Agreement** (the key's `agreement`, per piece; `DISAGREE` on the console): tempo, metre, bar length and where the bars begin (the share of aligned bar starts for the whole piece and for
  the excerpt, and the offset in beats). Flags: `tempo-octave`, `metre`, `bar-length`, `bar-phase`. A flagged piece is **kept** (nothing is hidden): the Lead decides whether the teacher's eyes
  should go there (edit `items.json`), and `decode.js` splits the counts by agreeing and disagreeing pieces.
- **The page** is the H-10 page (Korean, phone first, the same db adapter and export). Only the introduction differs: the two scores are "two readings of the same recording" of the audio
  (`두 가지로 듣고`), they may differ in notes, rests and bars, look for notes that are not in the original or are missing; the title is "H-10b". It names neither source. The builder
  **refuses to write the packet** if the page, the manifest or a drawing carries the vocabulary of the sources (`lib/h10-leak.js`: browser, helper, engine, TransKun, Kong, ensemble, onsets,
  model, local as a word, the Korean words for browser and engine, ..., plus the H-10 list, versions and the seed), and **warns** about a piece title that does (titles are the pieces' own;
  `--no-titles` leaves them out). The tests carry a mutation test for it.
- **Decode** (`h10/decode-engine.js`) prints, per source: wins, losses and ties (overall and per part, with the helper's share of the decisive parts, a Wilson interval and an exact sign test),
  pass rates, tags per source (part, piece), the notes in the teacher's words, per piece what each reading wrote (bars, tempo, metre, heard notes, rests, tuplet brackets), what the excerpt
  drew, the agreement flags, the arranger's outcome, the **visible differences** (note heads, rests, tuplet brackets per excerpt: how often the helper draws more, means), the counts split
  by agreeing and disagreeing pieces, and the disclaimers - the two sources differ visibly in how many notes they hold, so **the blinding is partial** and a preference can follow density.
  `--compare engine` must match the key (it is refused for another key; an engine key without the flag is decoded as one). It decides nothing.
- **Limits**: one excerpt per piece; one reviewer; notes only (the helper path as it would ship, with its beats and pedal, is not what is judged); "missing or extra notes" is one tag for both
  directions (her notes say which); part A exists for few pieces (the arranger refuses many of them, differently for the two readings, which is itself a result).

## H-10c - the lead sheet against the reduction, on the NOTES (`--compare arrange`)

The user's rule (2026-10-07): **if the notes are accurate, switch recordings to the lead sheet** (`recordingArrange: 'leadsheet'`, `docs/GOALS/G10_AUDIO_TO_SCORE.md` sections 33 and 34).
This packet asks one person (the user, or the piano teacher) exactly that, blind, on real covers: are the notes (the melody) of the lead-sheet copy accurate against the original, and
how does it compare with the reduction's copy of the same cover? One note set per piece (the helper ensemble's notes are what the user's PC produces now), read ONCE by the page's v2
conversion; the Song Arranger's one-note-per-hand copy of it is made at beginner and at intermediate, each once with `recordingArrange: 'leadsheet'` and once with `'reduce'`
(`lib/appcode.js arranger().arrange(graph, level, title, { recordingArrange })`: the page's own function, every fallback included).

```
node review/build.js --mode h10 --compare arrange --heard <heard-dir> --out <packet-dir> --key-out <key-dir> [--seed <secret>] [--jobs 3]
                     [--excerpt-bars 12] [--excerpt-seconds N] [--levels beginner,intermediate] [--no-titles] [--list]
node review/decode.js --mode h10 --compare arrange --key <key-dir>/key.json --ratings ratings-h10c-<id>.json [--out summary.json]
node review/decode.js --mode h10 --compare arrange --key <key-dir>/key.json --db rows.json        # answers read out of the artifact database
```

- **One folder**: `--heard` is a heard-notes folder (`items.json` and one `<id>.json` per piece, the format of `collect.js` and `helper-heard.js`); there is no `--heard-b`. An item's
  `inputClass` in `items.json` is copied into the key (say which pieces come from which note source there, never on the page).
- **What counts as made** (`lib/h10-item.js buildArrangeItem`): the reduction when `res.ok`; the lead sheet only when the lead sheet itself made the copy (`recordingArrange === 'leadsheet'`).
  A lead sheet that refused and fell back to the reduction made NOTHING: its reason (`leadsheetRefusal`) is in the key and the reduction's own copy is the other method's. A copy with other
  bars than the conversion is not drawn (said in the key).
- **The window**: about twelve bars, chosen in time from the heard notes (`lib/h10-excerpt.js`, the H-10 rule) and the bars of the conversion that cover it; the SAME bars for every copy of
  the piece and for both levels. The link opens the original at the first bar drawn.
- **Pair or single**: where both methods made a copy at a level the page shows two scores X and Y (which method is X is `HMAC(seed, piece id)`, an even split over the pieces that have a
  pair - `blind.js assignArms` with a `balance` predicate - and the same sides for both levels); where only one did, ONE score, with no label, and the key says which method and why the
  other made none. When every method gives the same sounding notes at both levels the two levels are ONE part ("초급 · 중급"), drawn from beginner (`merged` in the key).
- **The page** (`lib/page-arrange.js`; one file, offline, Korean, phone first; the H-10 page's styles, player, packed drawings and answer keeping): per copy "음(멜로디)이 원곡과 맞나요?"
  (맞아요 / 대체로 맞아요 / 틀린 곳이 많아요) and "학생에게 줄 수 있나요?" (그대로 / 조금 고치면 / 안 돼요); per pair "어느 쪽이 나아요?" (X / 비슷해요 / Y); per part an optional note.
  Answers: memory, `localStorage`, and with the Artifact `db` capability the documents `answers/<packetId>/items/<id>` (per part `B`, `I` or `BI`: `{ pref, X: { notes, hand }, Y, text }` or
  `{ S: { notes, hand }, text }`) and `answers/<packetId>` (the role). Export: `ppp-review-ratings/3` (`mode h10`, `compare arrange`).
- **The vocabulary**: nothing on the page, in the manifest or in a drawing may name either method or the app's own words for them (`lib/h10-leak.js scanArrange`: lead sheet, 리드 시트,
  reduce, reduction, 덜어내, the composer line's "(lead sheet)", the relaxed-plan note, `recordingArrange`, ...); the builder **refuses to write** a packet that does. The page's script
  never uses `Array.prototype.reduce` (the scan reads it too).
- **The pass rule is written into the key before any answer exists** (`key.passRule`, `h10/packet-arrange.js PASS_RULE`): (1) the lead-sheet copies shown are judged 맞아요 or 대체로 맞아요 on at
  least 80%; (2) no pair in which the lead copy is 틀린 곳이 많아요 while the reduction's copy of the same piece and level is not; (3) of the pairs answered, the lead copy is preferred or 비슷해요
  on at least 80%. `decode-arrange.js` reads the numbers from the KEY and prints PASS / FAIL / INCOMPLETE per the rule (an answer still missing is counted in the worst and the best case: a rule
  is decided only when the missing answers cannot change it), the counts per method, per piece, the comments and the caveats. It decides nothing beyond the rule: the switch is the user's.
- **Limits**: one reviewer; a handful of pieces and one excerpt each; a transcription error is in both copies (rule 2 is the comparison, rule 1 is not); the two methods differ visibly in
  density and the left hand, so the blinding is partial; singles tell the reviewer that one method refused (not which).
- Tests: `tests/review/h10-arrange.test.js` (Node), `tests/review/h10-arrange-page.test.js` (the page in a browser).

## Files

- `build.js` - packet builder CLI and `buildPacket()`; `decode.js` - ratings + key.
- `lib/select.js` - the input rule; `lib/arrange.js` - the two arms; `lib/legacy-worker.js` - ScoreArranger in a child
  process; `lib/neutral.js` - the one drawing path; `lib/blind.js` - the assignment; `lib/page.js` - the reviewer page
  (forms, both drawings, and the sampled-piano player).
- Tests: `tests/review/` (`npm run test:review`), including rest and tie counts, the clef rule, the two layouts and the media
  query, and that the sound list is unchanged by any drawing rule.
- H-10: `h10/collect.js` (the collector), `h10/packet.js` (the packet), `h10/item-worker.js` (one piece in its own process), `h10/decode-h10.js`, `h10/db-to-ratings.js`;
  `lib/appcode.js` (the page's own options, Score, player and arranger, read out of the app file), `lib/h10-item.js`, `lib/h10-draw.js`, `lib/h10-excerpt.js`, `lib/svgpack.js`, `lib/page-h10.js`.
  Tests: `tests/review/h10-*.test.js` (excerpt, pack and the page's own code, packets and decode, the page in a browser, the collector).
- H-10b (G10b-0): `h10/helper-heard.js` (the helper's notes -> heard notes), `h10/decode-engine.js`, `lib/h10-leak.js` (the vocabulary scan); `buildEngineItem` in `lib/h10-item.js`.
  Tests: `tests/review/h10-engine.test.js` (Node only), `tests/review/h10-engine-page.test.js` (the page in a browser).
- H-10c: `h10/packet-arrange.js` (the packet, the pass rule), `h10/decode-arrange.js`, `lib/page-arrange.js`; `buildArrangeItem` in `lib/h10-item.js`, `scanArrange` in `lib/h10-leak.js`,
  `dbToRatingsArrange` in `h10/db-to-ratings.js`.
