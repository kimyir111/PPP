# PPP — Piano Practice Partner

A working frontend prototype of PPP. Upload your song, PPP breaks it down, you practise the
hard parts, then memorise it.

Add a **PDF, photo or MusicXML** file — or a **recording: a YouTube link, an MP3 or an MP4** —
and PPP turns it into a real, playable score. MusicXML is parsed in the browser; PDFs and images
go through optical music recognition; recordings go through a piano transcription model, and PPP
works out the beat, the bars, the key and the hands from what it heard. Either way PPP
extracts the measures, notes, rests, voices, staves, key, time signature and tempo, engraves them with VexFlow, and runs the whole practice system
on that data. **Connect a MIDI keyboard and PPP scores what you actually play** against those
notes, **learns which passages you struggle with, and decides what to practise next**. Without
a keyboard it falls back to a clearly labelled Demo Input. An **AI coach** turns those
measurements into a session plan — and everything it proposes is checked back against them
before PPP will run it.

## Running it

```sh
npm start          # the app + login API, on http://127.0.0.1:8777
npm run omr        # optional: PDF/image recognition, recordings → scores, and the AI coach
```

The UI is localized in Korean, Japanese, English and Simplified Chinese (header language button). Sign in to keep progress across devices, or continue as a guest. Online deploy is in `DEPLOY_RENDER.md`.

The app itself is a static site with no build step. The local service is only needed to import a
PDF or a photograph, to make a score from a recording, and to let the AI plan a session —
MusicXML, practice, weakness detection
and memory all work without it, and PPP says plainly which part is unavailable rather than
pretending otherwise. Set `ANTHROPIC_API_KEY` before starting it to enable the coach; see
**The AI coach** below.

Serve it over HTTP rather than opening the file directly — the runtime loads React from a CDN
with subresource integrity, which `file://` blocks.

## Files

| File | What it is |
| --- | --- |
| `Piano Coach App.dc.html` | The app: music model, MusicXML parser, notation renderer, practice engine. |
| `support.js` | Generated `dc-runtime` — parses `<x-dc>`, renders through React. Do not edit. |
| `lessons.js` | Piano Basics: the beginner course as data, the checks for each exercise, and the keyboard, staff, rhythm and hand drawings it teaches with. |
| `course.js` | Method Books: the academy path (Beyer → Czerny 100 → Czerny 30 → Czerny 40, with Hanon, Burgmüller and sonatinas beside them), today's plan, the practice circles, passing and the streak. Pure functions over the saved course state. |
| `catalog/method/` | The method-book scores as `.mxl`, `index.json` (built by `build.py` from `books.json`), and `src/` — the ABC the Beyer, Czerny 100 and other transcriptions were written in. |
| `index.html` | Entry point; redirects to the app. |
| `audio/piano/` | Salamander Grand Piano samples (CC BY 3.0), 30 MP3s, 1.3 MB. See its `README.md`. |
| `samples/prelude-fragment.musicxml` | A test score — 3/4, G major, chords, rests, a tie, a printed accidental. |
| `tests/` | Browser tests and fixtures. See `tests/README.md`. |
| `omr-service.js` | The local helper: OMR (page images in, MusicXML out), audio transcription jobs (a recording or a YouTube link in, notes out) and the coach endpoint. Holds the API key. |
| `transcribe.py` | Runs the piano transcription model over a WAV for the helper. Notes and pedal out, as JSON. |
| `audio-score.js` | Notes heard in a recording → beats, metre, key, hands → MusicXML. Browser and Node, no dependencies. |
| `score-search.js` | Title → public-domain catalog hit → bar times aligned to the recording. |
| `catalog/` | CC0 / public-domain MusicXML (not committed model weights; not commercial scrapes). |
| `tools/audiveris/` | Vendored Audiveris (AGPL-3.0), not committed. See below. |
| `tools/transcribe-venv/`, `tools/piano-transcription/`, `tools/yt-dlp.exe` | The transcription model's Python environment, its checkpoint, and yt-dlp. Not committed. See **Making a score from a recording**. |

The source Claude Design project also holds `Design System.dc.html`, a gallery of the tokens
and components this app is built from. It is reference material and was not pulled down.

`.dc.html` is a Design Component: an `<x-dc>` HTML template plus a
`class Component extends DCLogic` whose `renderVals()` returns the flat object the template
binds to. The runtime boots itself, pulls React 18 from unpkg, and mounts. Because the format
is preserved, the app still round-trips to Claude Design.

## Importing a PDF or a photo

Every route ends in the same two steps, so nothing downstream can tell where a score came from:

```
.musicxml .xml ─────────────────────────────┐
.mxl ───────────────────────────────────────┤
.pdf → pdf.js, 300 DPI, in the browser ─┐   │
.png .jpg ──────────────────────────────┴───┤→ OMR service → Audiveris → MusicXML
                                            └→ parseMusicXML() → Score → practice
```

### Why Audiveris, and why a local process

Optical music recognition cannot run in a browser — there is no production-grade OMR in JS or
WASM, and writing one is a research project, not a feature. Audiveris is the mature open-source
OMR, piano grand staff is its target case, and it emits MusicXML natively, so MusicXML stays the
only interchange format and the milestone-2 parser is reused untouched.

That means one extra process:

```sh
npm run omr        # in its own terminal, alongside npm run serve
```

It binds to `127.0.0.1` only, writes uploads to a private temp directory, never executes them,
and deletes them when the request ends. Limits: 40 MB per file, 24 pages, 16 MB per page.

**Audiveris is AGPL-3.0.** PPP invokes it as a separate process, which is the ordinary
arrangement and does not make PPP a derivative work — but if PPP is ever offered as a hosted
service, AGPL §13 reaches network users of that component. Worth knowing before commercialising.

### Setup

Java 17+ and Audiveris. The service looks for it at `tools/audiveris/Audiveris/Audiveris.exe`,
then on `PATH`, then wherever `PPP_AUDIVERIS` points. To vendor it without a system install:

```sh
curl -L -o tools/audiveris.msi \
  https://github.com/Audiveris/audiveris/releases/download/5.11.0/Audiveris-5.11.0-windowsConsole-x86_64.msi
msiexec /a tools\audiveris.msi /qn TARGETDIR=D:\PPP\tools\audiveris
```

Audiveris ships without Tesseract language data. Without it, Audiveris reads the notes but no
text: no chord names, titles or tempo words (its log says `No installed OCR languages`). Add the
English data once:

```sh
curl -L -o "$APPDATA/AudiverisLtd/audiveris/config/tessdata/eng.traineddata" \
  https://github.com/tesseract-ocr/tessdata/raw/main/eng.traineddata
```

A PDF exported from notation software (Finale, MuseScore, Sibelius) needs none of this for its
chord names, 8va brackets, title and tempo. Those are text and lines in the PDF itself, and PPP
reads them from there (`PdfLayer` in the app). On each page it counts the bar lines against the
bars Audiveris found, and puts each chord name or 8va on the note under it. A page whose bar
lines disagree with recognition is left as recognised. Notes under an 8va are stored at the pitch
they sound and drawn where the page writes them.

### PDFs are rasterised in the browser

pdf.js renders each page at 300 DPI before anything is sent. Audiveris wants roughly that
resolution, multi-page becomes explicit, and the review screen gets its page images for free.
Handing a PDF to Audiveris directly measured worse on the same file.

### Recognition is checked, not trusted

OMR makes mistakes, and a wrong score presented confidently is worse than one that admits doubt.
Every recognised Score is checked for measures that hold more or less than their time signature,
empty measures, notes off the end of a piano, a missing grand staff, implausibly few notes,
wandering time signatures, and pages that failed outright. Each finding is a plain structural
fact, and together they produce a confidence figure and a list of measures to look at:

> Mostly read — please check.
> Recognised 16 measures, 46 notes, but only one staff was found. Piano music normally has two —
> the grand staff may have been missed.
>
> PPP may have had trouble reading measures 17–20.

### Checking it before you practise

A recognised score always stops at a review step showing the original page beside the recognised
notation, page and measure navigation, suspect measures flagged in red, and the list of findings.
From there: **accept**, **try again**, or **replace the file**. Accepting starts practice on the
longest unflagged stretch, so one bad measure at the end does not poison the first session.

This is a verification step, not a notation editor — there is no way to fix a misread note yet.

### What is kept

Filename, source type, import date, recognition status and confidence. **The PDF or photograph
itself is never stored** — page images live in memory for the review screen and are discarded.
Score data and learning data stay separable from the source file.

### Failure

Unsupported type, oversized file, too many pages, corrupt PDF, unreadable image, service not
running, engine missing, nothing recognised, malformed MusicXML — each says what happened and
what to do instead. **A failed import never falls back to demo notation**; the score you already
had is left exactly as it was.

## Making a score from a recording

Paste a YouTube link, or add an MP3, WAV, M4A or MP4 (a video's sound track is used), and PPP
writes out the piano:

```
YouTube link ─ yt-dlp ─┐                                          local helper
.mp3 .wav .m4a .mp4 ───┴─ ffmpeg → 16 kHz mono ─ piano model → notes ─────────────┐
                                                                                  │ browser
                   audio-score.js: beats, metre, key, hands → MusicXML → parseMusicXML() → Score
```

### Two halves: the model hears, PPP writes

The model is Kong et al.'s high-resolution piano transcription (ByteDance, Apache-2.0, 2021).
It reports when each key went down and came up, how hard, and the sustain pedal. It was trained
on solo piano, and that is what it does best; with a voice or a band it writes whatever it hears
in the piano's range.

It does not hear bars, beats, hands or how a pitch is spelled. `audio-score.js` works those out,
and each step is a plain heuristic that reports how sure it was:

| Step | How |
| --- | --- |
| beat | the notes as one onset signal (louder and lower count more); the tempo from where that signal best matches itself; a local tempo curve over eight-second windows; dynamic-programming beat tracking (Ellis 2007), so the grid bends with rubato instead of drifting off it. The first beat is put on the first note. |
| metre & downbeat | three or four beats, from where a low note arrives and is held. Four unless three clearly wins. |
| grid | sixteenths. A finer position is charged in milliseconds, not in fractions of a beat, so a chord leaned on 100 ms late stays on the beat while a real sixteenth at a fast tempo is still written. |
| key & spelling | Krumhansl–Kessler key profiles. The key's notes as its signature spells them, the rest as the chromatic degree they usually are — D major's C is C♮, A minor's raised seventh is G♯. |
| hands | a split point per chord, so neither hand stretches past an octave, holds more than five notes or crowds the other; it moves as little as it can, and a chord either hand could play takes its hand from the chords around it. |
| notation | one voice per hand, ties at barlines, note values that never hide a beat, pedal marks. The piece ends with the bar its last note starts in, rather than tying a ringing final chord on through empty bars. |

On Satie's Gymnopédie No. 1 from YouTube (4:05, one pianist's rubato): 3/4 at 66 BPM in D major,
the bass on beat one of every one of its 78 bars, the chord on beat two in the left hand, the
melody entering on the second beat of bar 5 — about 1 min 45 s on a CPU.

### Checked by ear, not trusted

A transcription always stops at the review screen, with the recording beside the notation:
**Play measures 5–8** plays exactly those bars from the recording and stops, and the panel says
where in the recording each bar starts. Confidence never reaches 100% — a transcription is a
hearing, not the composer's page — and drops for a tempo that wanders, notes that sit between
the grid lines, a metre with no clear accent, or very few notes; bars with a loose rhythm or a
sudden change of tempo are marked red. Accepting starts practice on the longest clean stretch,
as with OMR.

### Setup

Python 3.10+ (tested on 3.13), ffmpeg (on `PATH`, `tools/ffmpeg.exe` or `PPP_FFMPEG`), and for
links yt-dlp (`tools/yt-dlp.exe`, `PATH` or `PPP_YTDLP`):

```sh
python -m venv tools/transcribe-venv
tools/transcribe-venv/Scripts/python -m pip install torch --index-url https://download.pytorch.org/whl/cpu
tools/transcribe-venv/Scripts/python -m pip install piano_transcription_inference soundfile audioread
mkdir -p tools/piano-transcription
curl -L -o "tools/piano-transcription/note_F1=0.9677_pedal_F1=0.9186.pth" \
  "https://zenodo.org/record/4034264/files/CRNN_note_F1%3D0.9677_pedal_F1%3D0.9186.pth?download=1"
curl -L -o tools/yt-dlp.exe https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe
```

The checkpoint is about 172 MB; the helper ignores a partial one. `npm run omr` then prints
`Transcription: on, YouTube links too`, and the add page says the same before anyone tries. A
CUDA build of PyTorch is several times faster and is used automatically when it sees a GPU.
`PPP_TRANSCRIBE_PYTHON` and `PPP_TRANSCRIBE_CHECKPOINT` point elsewhere if needed.

Optional extras, same venv, weights uncommitted under `tools/`:

```sh
# preferred piano AMT (falls back to Kong if missing)
tools/transcribe-venv/Scripts/python -m pip install transkun

# audio beat/downbeat tracker (falls back to onset tracking if missing)
tools/transcribe-venv/Scripts/python -m pip install beat-this

# neural rhythm quantization (falls back to PPP's multi-metre snap if missing)
tools/transcribe-venv/Scripts/python -m pip install git+https://github.com/cheriell/PM2S.git
```

A YouTube title or file name is searched against `catalog/` (public-domain / CC0 MusicXML only)
before anyone transcribes. A confident hit becomes the practice score; the recording is aligned
to it. A miss goes through AMT as before. The review screen can lock time signature, tempo and
the first downbeat and rewrite the bars from the notes already heard — it does not listen again.

### Limits and what is kept

400 MB per file, 15 minutes of music (a longer recording is cut there, and the review says so),
three transcriptions at once. Only single YouTube videos are accepted — not playlists or live
streams — and the helper hands yt-dlp the link after `--`, so it can never be read as an option.
Download only what you have the right to use.

**An audio recording is never stored.** It lives in memory for the review screen and is released
afterwards; the helper deletes the upload, the WAV and any download when the job ends, and every
job expires after 30 minutes regardless. **A video file is the one exception:** it is kept in
this browser's IndexedDB (`ppp-media`, one entry per song) so the practice page can show it, and
it is deleted with the song. A YouTube song stores nothing — it is embedded from YouTube.

### Watching the performance while you practise

A song made from a YouTube link or a video file shows that video on the Practice page, in the
right-hand column under the coach. **Watch measures 21–28** plays the passage you are on from the
performance — from where its first bar starts, as measured when it was transcribed — at your
practice speed (75% practice tempo, 75% video; YouTube in its quarter steps), and stops at the
end of the passage. One sound at a time: watching stops the score, and pressing Play on the score
pauses the video. YouTube is embedded from `youtube-nocookie.com` and driven through the player's
own `postMessage` commands, so no YouTube script is loaded into PPP. A video song added before
videos were kept says so and takes the file again.

Triplets and 6/8 are written when the grid is clear; 12/8 is still heard as 6/8 or 3/4.
One voice per hand, so a note held under a moving line in the same hand is shortened; no dynamics;
one tempo marking for the whole piece. The online deploy has no local helper, and says so.

## Piano Basics

From never having touched a piano to chords and accompaniment. The tab under Home (and a link
on Home itself) opens on a choice of three levels — each saying who it is for, what is in it and
how far through it you are — with a button straight back to the lesson you were on. Inside a
lesson, **← All levels** returns there and the course panel switches between levels.

- **Level 1 · First steps** (20 lessons): the white and black keys, Do, Do Re Mi up to the octave,
  finger numbers, the letter names C D E F G A B, the staff and treble clef, reading Do to high Do,
  the beat, half and whole notes, measures and rests, four first songs (Airplane / Mary Had a Little
  Lamb, School Bell, Twinkle Twinkle, Ode to Joy), sharps and flats, the left hand and bass clef,
  and a first chord.
- **Level 2 · Scales and chords** (14 lessons): intervals, half and whole steps, the major-scale
  pattern, G major and F major with their key signatures, A minor, building triads, major and minor
  chords, chord symbols (C, Am, Dm, G), inversions, eighth notes, dotted notes and ties, 3/4 time,
  and dynamics, legato/staccato and tempo words.
- **Level 3 · Chords and accompaniment** (9 lessons): the chords of a key (I–IV–V with Roman
  numerals), the I–V–vi–IV progression with a bass, G7 resolving to C, diminished/augmented/sus4,
  broken chords and arpeggios, Alberti bass, waltz and oom-pah, and both hands together, ending on
  the Ode to Joy with a left-hand bass.

Each lesson is a few steps, one on screen at a time: something to read and hear, then something
to do — play a sequence with the next key lit and then without it, find every key of a kind,
answer a quiz (some by ear, with their own Listen), name notes on a staff, tap a rhythm against a
count-in (four clicks, or three in 3/4; a tied note is not tapped), or hold a chord — and a line
can have chords in it, which wait for every key before moving on. Next
waits until the exercise is done; the dots above the card skip ahead for anyone who wants to.
Every exercise takes the keys on screen, the computer keyboard (A S D F G H J K is Do to high Do,
W E T Y U the black keys) and a MIDI keyboard alike. On this page those letters and the space bar
belong to the lesson, so none of the practice shortcuts fire. A rhythm is timed on the press, not
the click, and counts a tap within a fifth of a second of the note.

The see-through hand from the practice screen lies over the lesson keyboard too (**Show hands**,
the same setting and transparency as there). It is fingered by the same engine — Do Re Mi with 1 2 3,
the scale with the thumb passing under after Mi, the left hand 5 4 3 2 1, a chord with 1 3 5 —
except where a lesson writes the fingering out as beginner books print it (Twinkle: 1 1 4 4 5 5 4).
The finger for the next note is marked only when the step lights the next key, so a step to be
played on your own does not give the answer away.

The course lives in `lessons.js` as data plus small pure functions — a key in, the step's new
state out — so `tests/lessons.test.js` walks every exercise in Node as well as in the page. The
lesson and step you are on and the lessons finished are part of the saved state
(`learnLesson`, `learnStep`, `learnDone`), so they survive a reload and sync when you sign in.
A finished lesson is worth 25 XP, once. Every word is in all four languages; the note names
follow the language (도 레 미, ド レ ミ, Do Re Mi).

## Method Books (교재 진도)

The order a Korean piano academy (학원) teaches in, as a tab under Piano Basics: Beyer first,
then Czerny 100 with Hanon and Burgmüller beside it, then sonatinas and Czerny 30, then
Czerny 40. The path is drawn as four stages; a book is chosen as the one you study
(**Study this book**), one to study alongside (Burgmüller, sonatinas) and one to warm up with
(Hanon).

**Today's practice** is built from those choices every day: the warm-up piece, the piece you
are on, the last piece you passed (to keep it in the fingers) and the piece in the book
alongside. Each has a row of circles — five by default, three or ten if you like — filled one
at a time as you play it through from start to finish, the way an academy's practice book has
them. Tap a circle to fill it; tap the last filled one to take it back. With a MIDI keyboard a
whole run of that piece in Practice fills one by itself. A day with any circle counts toward
the streak, and the last fourteen days are shown as squares.

**Pass** marks a piece passed and moves the book on to the next number not yet passed; the
passed piece becomes tomorrow's review. When the book you study is finished, the next book on
the path takes its place. Below the path, a book's numbers are a grid: passed, the one you are
on, and any not yet transcribed. A number opens with **Practice**, **Start from here**, and
**Pass** / **Not passed yet**.

**Practice** opens the piece in the practice screen. It joins My Songs the first time (marked
*Method book*), so it keeps its own progress, loops and memory like any song; opening it again
opens that song. The course — the books chosen, where each book is, what was passed and when,
and the circles of the last 400 days — is part of the saved state (`course`), so it survives a
reload and syncs when you sign in. `course.js` holds the rules as pure functions, walked in node
by `tests/course.test.js`.

### The scores

| Book | Numbers | Source |
| --- | --- | --- |
| Beyer, Op. 101 | 1–106 | Transcribed for PPP from the Peters edition (Leipzig 1895, rev. Ruthardt) — the pupil's part of the duets. Peters numbers 1–106 as Beyer did; Ruthardt's added 107–109 are left out. |
| Czerny 100, Op. 599 | 1–100 | Transcribed for PPP from the Schirmer edition (New York 1893, ed. Buonamici). |
| Hanon, *The Virtuoso Pianist* | 1–20 | PDMX (CC0). |
| Burgmüller 25, Op. 100 | see `index.json` | PDMX (CC0), and transcribed for PPP from the Schirmer edition (1903, ed. Oesterle). |
| Sonatinas | Clementi Op. 36 Nos. 1–6, Kuhlau Op. 20 No. 1 and Op. 55 Nos. 1 and 3, Beethoven Anh. 5 Nos. 1–2 | PDMX (CC0), one entry per movement. |
| Czerny 30, Op. 849 | see `index.json` | Neru Hayashi's public-domain typeset (via PDMX), and transcribed for PPP from the Universal Edition (Vienna, c. 1901). |
| Czerny 40, Op. 299 | 1–10 | PDMX (CC0). |

Every composition is in the public domain; the scans are public-domain editions from the
Internet Archive; PDMX is the *Public Domain MusicXML* dataset (Long et al., 2024), limited here
to scores marked public domain or CC0. Nothing was taken from a commercial catalog.

The transcriptions were made from 600-dpi page images: each piece was written in ABC one printed
system per line, built to MusicXML with `abc2xml`, checked that every bar of every voice adds up,
rendered with the same system breaks and compared bar by bar with the page, and then compared
note by note with an independent Audiveris reading of the same page — every bar where the two
disagreed was looked at again, enlarged. The ABC is in `catalog/method/src/`. PDMX scores were
split into one file per piece, cross-staff notes were put back on the staff of the hand that
plays them (PPP assigns hands by staff), and a voice that overran its bar only because of stray
trailing rests lost them. `python catalog/method/build.py` zips each score to `.mxl` and writes
`index.json` with its bars, key and time signature.

## My Songs

Every song you add is kept, and each keeps its own progress: what PPP has learned about your
playing of it, its memory record, the passage you were on and the tempo. Opening another song
puts the current one back on the shelf as it was. A song you remove asks twice first; the
built-in sample cannot be removed. A recognition or transcription you turn down at the review
step (**Replace the file**, **Try again**) never joins the list.

The open song lives in the ordinary saved state (`ppp.state.v2`, now with its `songId`); the
others wait in slots of their own (`ppp.song.v1.<id>`), indexed by `ppp.library.v1`. A score
imported before there was a library becomes its first song rather than being lost. Signing in
syncs the open song only — the rest of the shelf stays in this browser.

A song is written the moment it is added or opened — its slot and the saved state — rather than
after the usual save delay, and whatever that delay is still holding is written as the page goes
(`pagehide`, or the tab being hidden). Before this, a reload within a second or so of adding a song
left its card with no score behind it; such a card is now taken off on load, with a message
asking for the song to be added again. A full browser store is reported, not silently ignored.

## Shared Scores

Every song of yours in My Songs has a **Share** button (the built-in sample does not). It opens
a dialog with two separate things:

- **Post to Shared Scores** lists the song in the Shared Scores tab, where anyone can find it and
  **Add to My Songs**. **Take down** unlists it; its link keeps working.
- **Send a link** — copy it, or send it to X, Facebook, LINE, Threads or email, or through the
  phone's own share sheet (**Other apps…**, which is where KakaoTalk is). The link is made the
  first time one is sent, and sending it never posts the song. **Stop sharing** (asked twice)
  deletes the copy, and the link stops working.

Only the notes are sent: never the practice history, the memory record, the recording, or the
file name — a YouTube source is kept as its link, since the video is public. The server keeps
the copy (`data/shares.json` locally, the `ppp_shares` table on Postgres), so sharing your own
songs needs an account; anyone can open a link or add a posted score, signed in or not. A link
is `/?share=<id>`: it opens straight onto the score without the sign-in gate, and the server puts
the title in the page's Open Graph tags so a post shows what it links to. Sharing again sends the
notes as they are now, under the same link.

| Route | |
| --- | --- |
| `GET /api/shares` | Posted scores, newest first, with a two-bar preview each. `?mine=1`: yours, posted or not. |
| `POST /api/shares` | Share a song (signed in). One copy per song: sharing it again updates it. |
| `GET /api/shares/:id` | One share, with its score. Anyone with the id. |
| `PATCH /api/shares/:id` | `{ listed }` — post or take down. Owner only. |
| `DELETE /api/shares/:id` | Stop sharing. Owner only. |

On Render without `DATABASE_URL` the file store is wiped when the instance sleeps, and shared
scores go with it; connect Postgres to keep them.

## The music model

Everything musical goes through one structure, so the practice system never knows or cares
where a score came from:

```
Score   { id, title, composer, tempo, staves, measures[], notes[], sections[] }
Measure { number, index, startQ, lenQ, time{beats,beatType}, key{fifths,mode}, clefs{} }
Note    { m, b, dur, p, midi, hand, staff, voice, rest, chord, tieStop, type, dots, abs }
```

Durations are quarter notes throughout and `abs` is the absolute quarter offset from the start
of the piece, which is what the transport runs on. `number` is the measure number *as printed* —
imported scores can start at 0 for a pickup or skip numbers, so nothing assumes `1..n`.

Three producers feed it today: `buildDemoScore()`, `parseMusicXML()` and `readMxl()`. An OMR or
MIDI importer is a fourth producer and needs no changes below it. The layer is exposed as
`window.PPP` so you can inspect a parsed score from the console:

```js
PPP.parseMusicXML(xmlText, 'name.musicxml')   // → Score
PPP.Score.notesIn(score, 21, 28)              // → notes in a measure range
```

### What the parser reads

`score-partwise`, with `divisions` resolved to quarter notes: measures and their printed
numbers, pitch (step / alter / octave → scientific pitch → MIDI), duration, notated type and
dots, rests, chords, voices, staves, clefs, key and time signature, ties, printed fingering, and tempo from either
a `sound` directive or a metronome mark (a mark in dotted quarters or halves is converted to
quarters a minute, which is what PPP counts in). `backup` and `forward` are honoured, so multi-voice
piano writing lands on the right beats. Staff 1 is the right hand and anything below it the
left — a two-part score with one staff each resolves the same way.

`.mxl` archives are unzipped in the browser with `DecompressionStream('deflate-raw')`, reading
`META-INF/container.xml` to find the score. No zip library.

### What it does not read yet

Grace notes are skipped. Tuplets play at the right time but are not
bracketed. Ties are marked and do not re-trigger on playback (a tie that leads to no matching
note is treated as absent, so that note still sounds), but are not drawn as slurs. Transposing
parts are not transposed. D.S. / D.C. / Fine navigation is stored as marks but playback follows
repeat signs and voltas, not those jumps.
`score-timewise` is rejected with a message rather than mis-parsed.

## Real piano input

Two layers, kept apart on purpose.

**`MidiInput`** is the device layer. It turns raw bytes into one normalized shape and knows
nothing about scores or scoring:

```
{ t, midi, velocity, channel, device, deviceName, type }
```

`t` is on the same clock as `performance.now()`. A note-on at velocity 0 is a note-off, as the
MIDI spec intends. Control change, pitch bend and clock are ignored. Devices are enumerated and
selectable, and a keyboard unplugged mid-session falls back to whatever else is attached
instead of throwing.

**`PerformanceEngine`** compares those events with the active Score. A run is a measure range,
a hand mode and a tempo; `begin()` snapshots the expected notes — hand-filtered, tied notes
excluded because they are already sounding — and puts each on the wall clock. Every note-on
matches by pitch to the nearest unmatched expected note within the window:

| | |
| --- | --- |
| within 55 ms | on the beat |
| within 250 ms | early or late, still correct |
| right moment, wrong key | wrong note |
| nowhere near an onset | extra note |
| window expired, nothing arrived | missed note |

The thresholds are configurable per engine. A wrong note leaves the expected note open, so
correcting yourself still scores it.

**Chords** need no special case. Notes sharing an onset are separate expected entries with the
same target time, so a rolled chord matches each key to its own entry. The same three keys
played against three *sequential* expected notes do not all match — that difference is covered
by a test.

It reports note, timing, per-measure, per-hand, per-section and overall run accuracy, plus mean
timing drift. When a run finishes, each section is scored on its own notes rather than the run
average, and that feeds the existing progress, weak-area and memory model unchanged.

### Fallback

If Web MIDI is missing, access is refused, or no device is attached, the badge reads **Demo
Input** and PPP simulates your playing as before. It never shows "MIDI Connected" without a
device actually selected.

## Hand guide

For someone who has never had a lesson, knowing *which key* is half the answer; the other half
is *which finger*. With **Show hands** on (the default, under the keyboard) a see-through hand
lies over the on-screen keys for each hand the passage uses: every fingertip rests on a key,
the finger to play now is outlined and numbered, and the keys stay readable underneath. It
follows the playhead — the timed transport, follow mode and a stopped player alike — and
glides to a new position when the hand has to move. The numbers are the ones every piano book
uses, 1 for the thumb to 5 for the little finger, and they are spelled out under the keyboard.

Beside the toggle, a slider sets how see-through the hands are (45% to start); the finger
numbers can show all five, only the fingers to play, or none — the finger to play stays
outlined either way — and the *Left hand* / *Right hand* labels can be hidden. All of it is
kept with the rest of your settings.

**`Fingering`** chooses the fingers. It is the ergonomic model of Parncutt et al. (1997): for
every pair of fingers, how far apart they can comfortably and practically reach, plus rules for
the thumb on black keys, the thumb passing under, and the weaker fourth and fifth fingers.
Distances are measured across the keyboard as it is built rather than in semitones (Jacobs
2001), so E–F counts as wide as C–D. Its position-change rules look at three notes at a time,
so the best fingering is a second-order shortest path over each hand's notes; chords are one
step with one finger per key, and a change from one chord to the next is costed by how far the
whole hand travels. It is weighted for a beginner: staying in one five-finger position counts
for more than it would for a pianist, and a rest is where the hand moves. A long rest splits
the part into phrases, so the demo piece is fingered in a few milliseconds.

A finger number printed in the MusicXML (`<technical><fingering>`) is kept as written, and the
rest of the passage is fitted around it.

Fingers that play nothing in a position rest a key apart beside the ones that do — on a key of
the passage's scale, so in F major the fourth finger waits over B flat, not B.

Checked against what a piano book prints: C, G and F major scales in both hands (the thumb
kept off B flat), two octaves with the thumb under, *Ode to Joy* and *Mary Had a Little Lamb*
in one C position, *Minuet in G*, *Happy Birthday*, root-position and inverted triads, a
I–IV–V–I left hand, an Alberti bass and an arpeggio.

## Weakness detection

Nothing about weakness is declared in advance. Every finished run folds into a rolling
per-measure summary — attempts, correct, wrong, missed and extra notes, early/late counts,
timing error, and the same broken out per hand and per tempo bucket — plus a short window of
recent run summaries. Raw MIDI is discarded; only the summary survives, so the model stays
small enough for `localStorage`.

A measure's weakness combines how much you are missing, how far off the beat you are, and how
far apart your hands are:

```
weakness = (1 - recentAccuracy) × 0.60
         + timingPenalty        × 0.35
         + handGap              × 0.60
```

Recent runs are weighted more than old ones, so improvement shows up quickly. The hand term
matters: a bar at 80% overall can still be a left hand at 50%, and averaging the hands would
hide exactly the thing worth practising. A passage played cleanly but never at the score's own
tempo is treated as unfinished rather than solid.

One good run does not make a measure mastered — confidence needs repeated successes at full
tempo, which is what separates **stable** from **memory-ready**.

### Practice ranges, not fragments

Weak measures are merged with a one-bar bridge, grown to at least two bars and split at four,
so you get `21–24` and `25–28` rather than `21–21`, `22–22`, `23–23`. Ranges are ranked by
weakness and the worst becomes today's focus.

### Explanations

Deterministic, straight from the statistics — no model is involved:

> Left hand accuracy is 56% in measures 21–24.
> You frequently miss the chord change in measure 21.
> Timing becomes less stable at full tempo.
> Measures 45–48 improve significantly when slowed to 75%.

### What to practise next

The recommendation takes the worst passage and picks the first thing that explains it: one hand
clearly behind → isolate that hand; notes landing but not in time → slow down; clean when slow
but never proven at speed → put the tempo back; solid at tempo → Memory Mode. Nothing played
yet → play it once and let PPP look, rather than inventing a weakness.

The drill sequence adapts too. A left-hand problem starts hands-apart; a timing problem stays
hands-together and slows down; an unplayed passage starts with a read-through.

### Section states

The song map reports what was actually played: **learning**, **weak**, **improving**,
**stable**, **memory-ready**, **memorized**. A section is judged on the balance of its bars —
one flubbed measure in eight does not erase an otherwise solid passage, though a genuinely weak
bar still pulls the section back.

### The loop

Every completed run updates the history, which recomputes weakness, section states and the next
recommendation; Home, Progress and the drill screen all re-read from it. Practise the flagged
passage well and it stops being flagged, and the advice moves on to whatever is now worst.

The built-in demo ships with a short seeded history so this is visible immediately. An imported
score starts with none and says so until you play it.

## Memory

Playing a passage accurately while reading it is not memory, so the two are tracked apart.
Practice mastery comes from the Learning model; memory strength moves **only** on an explicit
recall attempt. Read the page perfectly a hundred times and memory strength stays at zero.

Each section carries its own record:

```
practiceMastery   from the Learning model, never written here
memoryStrength    0–100, moved only by recall
memoryConfidence  successful recalls / all recalls
level             0–4, how much of the score is currently withdrawn
successfulRecalls / failedRecalls / blindPasses
lastMemoryTest / nextReview / reviewStage
```

### Earning your way in

Levels 3 and 4 — the ones that matter — stay locked until normal practice is solid: 90%
accuracy, timing inside 150 ms, hands within 15% of each other, demonstrated at full tempo,
across more than one run. The thresholds live in `MEMORY.eligible` and the UI says which one
you are failing rather than just refusing.

### Removing the score musically

Onsets are ranked by how much they anchor the passage — bar lines, downbeats, phrase starts and
chords score highest — and the weakest anchors are hidden first:

| Level | Page | What survives |
| --- | --- | --- |
| 0 | 100% | everything |
| 1 | 75% | every bar line and downbeat, all phrase starts |
| 2 | 50% | bar-line onsets and chords as landmarks |
| 3 | notes hidden | staff, clefs, key, metre, bar numbers |
| 4 | no score | nothing |

The plan is a pure function of (score, range, level, hints), so the same attempt always sees the
same page — hints never shuffle while you are trying to remember.

Six hints put specific things back: starting note, this measure, next chord, rhythm only
(ghosts the notes so you can see where they fall without reading them), left-hand anchor,
right-hand anchor. Using one is not a failure — it cuts the confidence gained to 45%.

### Progression

Assistance moves on evidence, never on one lucky run. Two **clean, unaided** passes remove more
of the score; two failures bring notation back; a pass that needed a hint holds the level. Two
clean blind recalls mark the section memorized.

### Where recall breaks

Deterministic, from the recall data:

> Measure 23 is the weakest point in your recall.
> You remember the right hand, but the left-hand entry in measure 24 is unstable.

### Review

A memorized passage is not finished. Blind recall books a review at 1 day, then 3, 7, 14, 30 as
each one passes. A failed review pulls the interval back a step, takes 18 points of strength,
and un-memorizes the section if strength falls below 40. Time comes from an injectable clock, so
"three days later" is one assignment in a test rather than a wait.

### Choosing today's task

Technique, weak-passage drilling, memory work and review all compete under fixed rules:

1. a serious technical weakness beats everything — there is no point memorising something you
   cannot yet play
2. otherwise an overdue review wins, before it is forgotten
3. otherwise whatever the practice model suggested
4. a memory suggestion is downgraded to "steady it first" if the passage has not earned it

### The map

Sections report **Not learned · Learning · Stable · Memory ready · Memorizing · Memorized · Due
for review**. Playing accuracy alone never reaches Memorized.

## The AI coach

The coach turns what PPP measured into a short session you can do right now. It interprets; it
never measures. Learning decides what is weak, Memory decides what is memorized, the
PerformanceEngine decides what was played — none of that is delegated to a model. With no
provider at all the deterministic planner produces the session instead and the panel reads
**planned by PPP**. AI is an enhancement here, never a dependency.

### What the coach is told

A `CoachContext` assembled entirely from conclusions the engines already reached — about 7 KB:

```
song            title, composer, tempo, key, metre, measure range, staves, where it came from
practice        current selection, hand mode, tempo, and the last six runs as summaries
learning        song accuracy, the worst weak ranges with per-hand figures and PPP's own
                explanation, and a per-measure summary of everything actually played
memory          per-section state, strength, confidence, recall counts, what is due for review
recommendation  whatever the deterministic model already decided to suggest
structural      difficulty predicted from the notation alone, labelled as a prediction
allowed         the measures, hands, modes, tempo range and repetition range a plan may use,
                plus the sections that have earned memory work
```

Raw MIDI never leaves the engines: no note events, no velocities, no per-note history — only the
rolling summaries, which is both what keeps the context small and all a plan actually needs.
Tests assert those absences rather than trusting them.

### What comes back

Structured output, parsed against a Zod schema on the server:

```
summary, todayGoal, coachNote, sessionMinutes
tasks[] { range{start,end}, hand, tempoPercent, mode, repetitions, reason }
```

### Guardrails

A schema is not a safety mechanism — a well-formed plan can still be wrong. Every plan, from any
provider including PPP's own, goes through `Coach.validate()` before the app acts on it:

| Check | What happens |
| --- | --- |
| a measure that is not in this score | task dropped |
| a hand or mode PPP does not have | task dropped |
| `memory` on a passage that has not earned it | task dropped — the eligibility gate is not the coach's to overrule |
| tempo outside 30–120%, repetitions outside 1–8 | clamped |
| a backwards range | corrected |
| a percentage the context never contained | stripped from the prose |
| nothing valid left, or not a plan at all | rejected outright; PPP plans instead |

Dropped tasks become visible issues rather than silence. The stripping rule is the one that
matters most: an invented "your left hand is at 3%" is removed because no such figure is in the
context, while a figure PPP did measure passes through untouched.

### The plan drives the real player

Clicking a task sets the loop range, the tempo, the hand mode and practice-or-memory mode — the
same controls you would use, with no special path for the coach. A task completes on its
repetitions, and only at that boundary does PPP consider re-planning: when the worst passage
changes, a review comes due, overall accuracy swings by 8 points, or a memory level moves. A
picture that has not moved is left alone, so the plan does not churn mid-session.

### Two providers, one endpoint

Something has to write the plan, and it does not have to be a paid API:

| | Needs | Costs | Panel reads |
| --- | --- | --- | --- |
| **Claude** | `ANTHROPIC_API_KEY` | per request | planned by Claude |
| **Ollama** | a model running on this machine | nothing | planned by Ollama |
| **PPP** | nothing at all | nothing | planned by PPP |

Both models answer the same `/coach` endpoint, get the same `CoachContext` and the same system
prompt, and return the same schema — Anthropic through `messages.parse()`, Ollama through
`/api/chat` with a JSON Schema derived from the very same zod definition, so the shape is
declared once. Everything after the response is identical: the same validator, the same
guardrails, the same panel.

PPP prefers Claude when a key is present and falls back to Ollama, then to itself.
`PPP_COACH_PROVIDER=anthropic|ollama` pins one.

```sh
PPP_OLLAMA_URL=http://127.0.0.1:11434    # default
PPP_OLLAMA_MODEL=qwen3:8b                # default; must already be pulled
PPP_OLLAMA_TIMEOUT_MS=180000             # a local model can think for a while
```

If Ollama is running somewhere the host cannot see — inside another project's Docker network,
say — it needs a way through. A one-line bridge is enough, and it changes nothing in the project
that owns the container:

```sh
docker run -d --name ppp-ollama-bridge --restart unless-stopped \
  --network <that-project's-network> -p 127.0.0.1:11434:11434 \
  alpine/socat tcp-listen:11434,fork,reuseaddr tcp-connect:<ollama-container>:11434
```

It binds to `127.0.0.1` only, so nothing is exposed beyond this machine, and `docker rm -f
ppp-ollama-bridge` undoes it.

`/health` reports which provider is live, and **the panel names whoever actually answered** —
that attribution is taken from the service, never assumed by the frontend, because a plan
credited to the wrong model is exactly the kind of lie the rest of this app is built to avoid.

A local model is worse at this than Claude, which is precisely why the guardrails are not
optional. In testing, qwen3:8b proposed blind recall on a passage that had not earned it and
asked for ten repetitions where eight is the limit. Both were caught: the task was dropped and
the count clamped, and the session it produced was still executable.

### Where the key lives

`ANTHROPIC_API_KEY` is read by the local Node service and never reaches the browser. The app
POSTs a context to `/coach` and gets a plan back; nothing is in the frontend source and nothing
about the provider is written to `localStorage`.

Put it in **`.env` at the project root** — copy `.env.example`, or edit the `.env` that is already
there and uncomment one line:

```
ANTHROPIC_API_KEY=sk-ant-...
```

`.env` is gitignored, along with `.env.*`, and the service reads it at startup with a small
built-in parser — no dependency. A real environment variable wins over the file, so CI can set
one without a file existing. The startup banner prints which **names** were loaded and never a
value, nothing logs the key, and any error on its way back to the browser is passed through a
redactor first. Restart the service after editing:

```sh
npm run omr
#   Coach: on — claude-opus-5
#   .env: ANTHROPIC_API_KEY, PPP_COACH_MODEL
```

`/health` reports whether a coach is reachable and PPP asks once at startup, so the panel is
honest about which planner produced the session. `PPP_COACH_MODEL` overrides the model
(default `claude-opus-5`).

### When the provider fails

Unreachable, throwing, rejecting, malformed, empty, or a plan where every task fails validation —
all six land in the same place: PPP's own session, attributed to PPP, with a line saying what
happened. A missing key, an Ollama that is not running, a model that is not pulled and a request
that times out are all just more ways into that same path. The deterministic planner is both the
fallback and the yardstick, so a failed request costs you the interpretation, never the practice.

### Before you have played anything

An unplayed score has no weaknesses and the coach does not invent any — it asks for a read-through.
What it offers instead is structural: note density, hand leaps, chord thickness, accidentals and
voice count, read from the notation. That is labelled a prediction in the panel and in the
context, and the model is told never to report it as something you did.

## The flow

Add Sheet Music → Analysis & Plan → Practice (start to finish · loop a passage · memorize) → Progress

Each step is one place. The sidebar has one list, with a line under each entry saying what is
there. Home puts the one recommended next step on top, and the four steps of the flow run
underneath it, each opening its page.

- **Analysis & Plan** — the song's facts, the passages PPP expects to be hard (or has heard you
  miss), the one recommended next step, and the day-by-day plan. Each plan task has a box to tick
  it done and a **Start** button that opens Practice set up for it. This page used to be two,
  "AI Analysis" and "Practice Plan", which described the same plan twice.
- **Practice** — one score, one transport, one keyboard, and three tabs for what you are doing
  with them. The loop screen and the memory screen used to be separate pages with their own copy
  of the score:
  - *Start to finish* plays the whole piece.
  - *Loop a passage* repeats the chosen bars.
  - *Memorize* hides the notes of that passage a level at a time.

  The side panel follows the tab. It shows the coach's session, or the steps for a passage you
  picked yourself, or the memory levels, hints and recall.
- **Home's "Today's Practice"** is the coach's session, the same list the Practice panel works
  through, not a second one.

Old screen ids (`loop`, `memory`, `plan`) still work and land on the tab or page that holds that
work now.

## What actually works

**Transport** — Play / Pause / Restart, driven by wall-clock time so tempo is honest. Tempo
30–200 BPM by slider. Right hand / Left hand / Both filters the notes that render, sound and
count toward accuracy.

**Loop selection** — On the *Loop a passage* tab: drag across bars on the score, set a range with
the `21 → 28` steppers, click a section chip, or click the bar strip (click a measure to start the
loop, click again to set its end). Weak-area cards, the hard-section list on Analysis & Plan and
the Progress song map all jump straight to a loop on their range.

**Practice / Memory** — the *Memorize* tab on the Practice page. Blind play replaces the score
with a notice rather than blanking one passage of it.

**Memory progression** — five levels, from full sheet music to none (see **Memory** above for
how the score is withdrawn and how recall is verified):

```
100% Sheet Music → 75% → 50% → Notes Hidden → No Sheet Music
```

Two clean unaided recalls remove more of the score; two clean blind ones memorize the section
and schedule a review.

**Progress that moves** — every completed lap of the loop scores the run, then eases the
drilled sections' accuracy and memory toward it. Song progress, the section map, memory
strength, mastered count, XP, daily-goal minutes and the session chart all derive from that
one model, so they update as you practise.

Accuracy is simulated, and the simulation is opinionated: neutral at the score's own tempo,
better when you slow down, worse when you rush, and harder the more sheet music is hidden.
Practising a weak section slowly does raise its score.

**Audio** — a sampled grand piano (Salamander, `audio/piano/`), one recording every minor third,
so no note is pitched more than a semitone. The recordings load in the background; until they
arrive, or if they cannot, a small synthesized piano stands in at the same loudness.

Playback follows the score, not a timer. Each run is anchored — this beat is heard at this
moment — and every note is placed on the Web Audio clock at its exact time, 400 ms ahead, so
chords land together and the tempo holds while the page is busy drawing. A note is held for
its written length, through ties and through the pedal where the score marks one, and let go
the way a damper stops a string. A loop's laps join without a gap. Changing the tempo, the
hands or the loop mid-run re-plans only what has not been heard yet; moving the playhead starts
again from there. The visual playhead is corrected for output latency, so it sits on what you
hear. The metronome counts the metre as it is conducted: 6/8 in two, cut time in two, a pickup
counted back from its bar line.

Simulated misses in Demo Input are shown on the page but never sounded — playback is always
the score as written. Clicking the on-screen keyboard plays a note; a MIDI keyboard sounds for
as long as each key is held, at the velocity it was struck. Metronome sound is off by default
(Settings → Devices & sound); the visual pulse stays on either way. With MIDI *input* connected the
score stops auto-playing its notes and only your key presses sound, so the two never double up.
With a MIDI *output* selected, those score notes go to the piano instead of the in-app samples;
if that output is the same device as the input, Local Control is switched off so the piano does
not double the computer's notes.

**Add Sheet Music** — choose a file, drop one anywhere on the page, or paste a YouTube link, and
reading starts at once; there is no second button to find. The panel beside it lists each stage
as it actually runs, with the helper's own percentages for downloading and listening, and a
**Cancel**. It then reports what was actually found (note count, bar count, staves, time
signature, recording length and tempo for a recording). An unsupported file is refused with a
reason rather than silently accepted.

**The coach panel** — the sidebar panel on Practice carries the session: today’s goal, the
numbered tasks with the reason for each, progress through them, and a re-plan button. It says
who planned it. Clicking a task configures the player.

**Elsewhere** — plan tasks tick off and move plan progress; Sight Reading is a real 10-question
quiz that scores and feeds the recognition-speed bars; song search and filters work; settings
toggles are live, including a progress reset.

**Shortcuts** — `Space` play/pause, `R` restart, `L` loop, `M` metronome. Ignored while typing.

**Persistence** — progress, tempo, memory level, settings and any imported score are saved to
`localStorage` and restored on reload, so a refresh does not lose your upload. Settings →
*Reset practice progress* clears it.

## Mock data

The built-in demo, Interstellar Theme, is generated rather than parsed: 64 bars of 4/4 in A
minor, eight sections seeded to match the original design (21–28 weak at 62%, 57–64 not
started). It is built through the same `Score` model as an imported file, so nothing
special-cases "no upload yet". It is the first song in My Songs, and the only one until you add
your own.

Add a score and it becomes the open song: real measures, notes, hands, key, metre and tempo,
with sections re-derived from the notation and progress starting at zero. The sample, and its
progress, stay on the shelf.

## Not built yet

No backend beyond the local helper that runs OMR, transcription and the coach. MIDI *files* are still refused
as an import format —
export MusicXML instead; MIDI *input* from a keyboard is real, and MIDI *output* can play the score
through a connected digital piano (note-on/off and sustain / una corda / sostenuto). There is no notation editor, so a
misread note cannot be corrected in PPP yet: reimport a better scan, or fix it in a notation
editor and import the MusicXML.

Without a keyboard attached, accuracy is simulated from the section's history, your tempo and
how much sheet music is hidden — the badge says Demo Input when that is what is happening. PPP
still does not listen through a microphone, and note-off timing is not scored, so held-note
length and pedalling are ignored.

Weakness, explanations and recommendations are statistics rather than a model — deliberately, so
they stay reproducible and explainable. The coach reads those statistics and writes the session;
it does not produce them and cannot overrule them. Nor is it a chat assistant: it answers one
question, which is what to practise next. Before you have played a passage there is nothing to
measure, so PPP falls back to a notation-only difficulty guess (note density, leaps, chord
thickness, off-beat placement) and says that is where the guess came from.
