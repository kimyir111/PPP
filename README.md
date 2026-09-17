# PPP — Piano Practice Partner

A working frontend prototype of PPP. Upload your song, PPP breaks it down, you practise the
hard parts, then memorise it.

Upload a **PDF, photo or MusicXML** file and PPP turns it into a real, playable score. MusicXML
is parsed in the browser; PDFs and images go through optical music recognition. Either way PPP
extracts the measures, notes, rests, voices, staves, key, time signature and tempo, engraves them with VexFlow, and runs the whole practice system
on that data. **Connect a MIDI keyboard and PPP scores what you actually play** against those
notes, **learns which passages you struggle with, and decides what to practise next**. Without
a keyboard it falls back to a clearly labelled Demo Input. An **AI coach** turns those
measurements into a session plan — and everything it proposes is checked back against them
before PPP will run it.

## Running it

```sh
npm start          # the app + login API, on http://127.0.0.1:8777
npm run omr        # optional: PDF/image recognition and the AI coach, in another terminal
```

The UI is localized in Korean, Japanese, English and Simplified Chinese (header language button). Sign in to keep progress across devices, or continue as a guest. Online deploy is in `DEPLOY_RENDER.md`.

The app itself is a static site with no build step. The local service is only needed to import a
PDF or a photograph, and to let the AI plan a session — MusicXML, practice, weakness detection
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
| `index.html` | Entry point; redirects to the app. |
| `samples/prelude-fragment.musicxml` | A test score — 3/4, G major, chords, rests, a tie, a printed accidental. |
| `tests/` | Browser tests and fixtures. See `tests/README.md`. |
| `omr-service.js` | The local helper: OMR (page images in, MusicXML out) and the coach endpoint. Holds the API key. |
| `tools/audiveris/` | Vendored Audiveris (AGPL-3.0), not committed. See below. |

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

Audiveris ships without Tesseract language data, so it reads notes but not text — titles and
tempo words come back empty. Notes, clefs, rests and staves are unaffected.

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
dots, rests, chords, voices, staves, clefs, key and time signature, ties, and tempo from either
a `sound` directive or a metronome mark. `backup` and `forward` are honoured, so multi-voice
piano writing lands on the right beats. Staff 1 is the right hand and anything below it the
left — a two-part score with one staff each resolves the same way.

`.mxl` archives are unzipped in the browser with `DecompressionStream('deflate-raw')`, reading
`META-INF/container.xml` to find the score. No zip library.

### What it does not read yet

Repeats and voltas are not expanded, so playback runs straight through. Grace notes are
skipped. Tuplets play at the right time but are not bracketed. Ties are marked and do not
re-trigger on playback, but are not drawn as slurs. Transposing parts are not transposed.
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
PerformanceEngine decides what was played — none of that is delegated to a model. With no key
the deterministic planner produces the session instead and the panel reads **planned by PPP**.
AI is an enhancement here, never a dependency.

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
happened. The deterministic planner is both the fallback and the yardstick, so a failed request
costs you the interpretation, never the practice.

### Before you have played anything

An unplayed score has no weaknesses and the coach does not invent any — it asks for a read-through.
What it offers instead is structural: note density, hand leaps, chord thickness, accidentals and
voice count, read from the notation. That is labelled a prediction in the panel and in the
context, and the model is told never to report it as something you did.

## The flow

Upload → AI Analysis → Practice Plan → Practice → Difficult Measure Loop → Memory Mode → Progress

The **Learning loop** rail across the top walks the ten steps of that journey; the sidebar
**Song flow** jumps straight to any screen.

## What actually works

**Transport** — Play / Pause / Restart, driven by wall-clock time so tempo is honest. Tempo
30–200 BPM by slider, or 50/75/100% of whatever tempo the score itself specifies. Right hand / Left hand / Both filters the notes
that render, sound and count toward accuracy.

**Loop selection** — Set a range with the `21 → 28` steppers, click a section chip, or click
the measure strip on the Measure Loop screen (click a measure to start the loop, click
again to set its end). Weak-area cards, the analysis hard-section list and the Progress song
map all jump straight to a drill on their range.

**Practice Mode / Memory Mode** — switched from the player toolbar, or from the dedicated
Memory Mode screen.

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

**Audio** — WebAudio metronome and note tones. Clicking the on-screen keyboard plays notes.
Metronome sound is off by default (Settings → Devices & sound); the visual pulse stays on
either way. With MIDI connected the score stops auto-playing its notes and only your key
presses sound, so the two never double up.

**Upload & analysis** — pick a MusicXML file and it is parsed in the browser. The analysis
panel reports what was actually found (note count, bar count, staves, time signature, how many
sections were flagged) and the summary names the key, metre and note count. An unsupported
file is refused with a reason rather than silently accepted.

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
special-cases "no upload yet". The other five library entries are display-only cards.

Import a MusicXML file and all of it is replaced: real measures, notes, hands, key, metre and
tempo, with sections re-derived from the notation and progress reset to zero.

## Not built yet

No backend beyond the local helper that runs OMR and the coach. MIDI *files* are still refused
as an import format —
export MusicXML instead; MIDI *input* from a keyboard is real. There is no notation editor, so a
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
