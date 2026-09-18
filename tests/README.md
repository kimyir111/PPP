# Tests

Browser tests. They drive the real app in headless Chrome and assert against the real DOM —
there is no mocking of PPP itself, only of things PPP talks to (a fake Web MIDI device, a fake
file upload).

## Running them

```sh
npm install                    # once — pulls puppeteer
npm run serve                  # in another terminal
npm run omr                    # optional, for the OMR tests
npm test                       # all nine suites
```

Or one at a time: `node tests/midi.test.js`.

Each file exits non-zero on failure and prints every check it ran.

| File | Covers |
| --- | --- |
| `import.test.js` | Import routing, recognition validation, multi-page MusicXML merge, PDF/PNG/JPG through OMR to a Score, honest failure, limits, and that downstream practice is unaffected. Skips the OMR half cleanly if the service is not running. |
| `memory.test.js` | Practice accuracy never memorizing on its own, eligibility gating, assisted vs blind recall, hints reducing confidence, progression and demotion, weak-measure detection, review scheduling on an injected clock, and persistence. |
| `learning.test.js` | Weakness from repeated failure, grouping into practice ranges, hand- and timing-driven recommendations, improvement changing the advice, memory unlocking on stability, history caps, and persistence across a reload. |
| `midi.test.js` | MIDI event normalization, note matching, early/late thresholds, wrong and missed notes, chords, hand filtering, measure transitions, run completion, device selection, and the no-Web-MIDI fallback. |
| `musicxml.test.js` | Parsing `samples/prelude-fragment.musicxml` — measures, pitch, duration, rests, chords, ties, accidentals, key, metre, tempo — then importing it through the UI and practising on it. |
| `interactions.test.js` | All navigation, transport, loop selection, memory progression, plan, search, quiz and settings. |
| `import-and-persistence.test.js` | Unsupported-file refusal, a real MusicXML import, keyboard shortcuts, and `localStorage` persistence across a reload. |
| `i18n-and-auth.test.js` | Locale switching across English, Korean, Japanese and Chinese, `html lang` following the locale, the health endpoint, and signup / session / progress round-tripping against the Node server. |
| `layout.test.js` | Sidebar hide/show on desktop, overlay drawer on tablet and phone, and no sideways page scroll. |
| `library.test.js` | My Songs: only real songs listed, adding a file keeps it, each song keeps its own tempo and progress across switching and a reload, removing asks twice and falls back to a song that exists, and a score saved before the library existed is adopted. |
| `video.test.js` | The performance beside the score: only YouTube and video-file songs get the panel, it sits under the coach in view, the YouTube embed (answered by a stand-in that echoes every command) is told to seek to the passage's first bar, play, match the practice speed and pause when the score plays; a video file recorded in the page is kept in IndexedDB, survives a reload, plays the passage at the practice speed, is asked for again when missing, and is deleted with its song. Never reaches YouTube. |
| `transcription.test.js` | Recordings → scores. Performances built from known scores (a waltz, an Alberti bass, a rubato waltz, a 6/8 jig, triplets) played with human untidiness, checking that the metre, tempo, key, downbeat, hands, tuplets, user lock, injected audio beats and a PM2S-shaped grid are recovered; spelling; note values; the parser, the engraving and the confidence report. With the helper running and transcription set up, a synthesised recording goes through the real UI to the review screen, plays back by measure, can rewrite the rhythm from already-heard notes, and joins My Songs. Skips live Beat This / PM2S / Transkun cleanly when those tools are missing. |
| `score-search.test.js` | Public-domain catalog: Gymnopédie matches, a nonsense title does not, alignment covers the recording, licenses are CC0. |
| `coach.test.js` | What the CoachContext may contain and what must stay out of it, every guardrail on a returned plan, the stripping of invented figures, deterministic planning, re-planning boundaries, all provider-failure modes, and a fake AI plan driving the real player. Needs no API key and never reaches a live model. |
| `fingering.test.js` | The hand guide: fingerings a piano book prints (scales with the thumb under, five-finger melodies, triads, the thumb off black keys), resting fingers kept in the key, every demo note fingered, a printed `<fingering>` kept — then, with a fake MIDI keyboard, that the fingers marked to play lie on exactly the keys PPP asks for and move on as they are played, plus the hand filter, the toggle, the transparency slider, the finger-number and hand-label settings, and their persistence. |

`coach-live.test.js` is **not** in `npm test` and is run by hand: it makes one real request to
whichever provider is configured. Against Ollama that is free; against Anthropic it costs one
request. With no provider available it skips.

```sh
node tests/coach-live.test.js
```

Screenshots land in `tests/.shots/`. Each suite needs the app served at
`http://127.0.0.1:8777`.

## Notes

`midi.test.js` installs a fake `navigator.requestMIDIAccess` before the page loads, so it
exercises the real `MidiInput` code path without hardware. The performance-engine cases run at
60 BPM, where one quarter note is exactly 1000 ms and the assertions read as plain milliseconds.

The suites assume the demo score (64 bars, 4/4). If you have imported a MusicXML file, clear
site data first — the app restores your score from `localStorage`.

`coach.test.js` never calls a real model. Most of it runs the pure functions — context,
validation, planning — in-page with a frozen clock; the end-to-end case installs a fake provider
at `window.__pppCoachProvider` that returns a hand-written plan with one deliberately invalid
task, then checks the surviving task against the loop range, the tempo and which notes are
filtered out of the engraved score. That last check reads the effect rather than the button
styling, so it cannot pass for the wrong reason.

The fake provider is installed **before the page loads**, not by asking for a re-plan afterwards.
That matters: if a live coach is configured on the machine, the startup plan is still in flight
when the test runs, and `requestPlan()` correctly refuses to stack a second request — so a
re-plan click would be ignored and the suite would fail for a reason that has nothing to do with
the code under test. Installing the fake first means no live model ever answers, whatever is
running locally.

`coach-live.test.js` records the real `/coach` request and response without altering either, then
re-runs `PPP.Coach.validate()` on the actual plan against the actual context that was sent. It
asserts the live call count is exactly 1 both before and after driving the UI, so a stray
re-plan cannot go unnoticed. Both coach suites read the panel scoped to the `PPP Coach` section
on the player screen, because Home carries its own "Measures 21–24" recommendation button and
clicking that one would prove nothing.
