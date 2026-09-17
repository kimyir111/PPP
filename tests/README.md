# Tests

Browser tests. They drive the real app in headless Chrome and assert against the real DOM —
there is no mocking of PPP itself, only of things PPP talks to (a fake Web MIDI device, a fake
file upload).

## Running them

```sh
npm install                    # once — pulls puppeteer
npm run serve                  # in another terminal
npm run omr                    # optional, for the OMR tests
npm test                       # all eight suites
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
| `coach.test.js` | What the CoachContext may contain and what must stay out of it, every guardrail on a returned plan, the stripping of invented figures, deterministic planning, re-planning boundaries, all provider-failure modes, and a fake AI plan driving the real player. Needs no API key. |

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
