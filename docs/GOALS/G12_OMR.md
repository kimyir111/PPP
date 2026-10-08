# G12 — OMR: a printed score or a photo becomes a correct graph, or the user sees and fixes exactly where it is not

## 0. Status

Architect 2026-10-08 (on Opus), worktree `D:/PPP-g12d`, branch `g12-design` from `main` `3567e27` (= production,
deploy of 2026-10-08). Design only: no code, test, baseline or app change in this commit. Roadmap card:
`docs/PPP_MASTER_ROADMAP.md` §5.10 (G12), §4 (issues 11 and 12), §12 (AI-7), §10 (H-12).

**One-paragraph summary.** Today the live site cannot read a printed score at all: its `/helper/omr` answers 503,
so every PDF falls to the in-browser draft reader (`PdfLayer.notate`), which got **0 of 83 bars right** on six clean
vector PDFs measured for this document, and refused 5 of 6 phone-style photos. On the user's own PC, Audiveris 5.11
(already installed) reads clean engraved pages well (**note F1 0.85-0.87, 63-67 % of bars exactly right, 4-13 s a page**),
loses a lot on photos (F1 0.62, 26 % of bars right), and the app then **throws away part of what Audiveris read** in
three places: the hand rule silences whole staves when Audiveris splits a grand staff into single-staff parts
(issue 11), the helper keeps one `.mxl` per page when Audiveris splits a page into movements, and a
`<divisions>0</divisions>` export turns every half note into a quarter. Worst of all for the card's promise ("or the user
sees exactly where it is not"): on the app path the suspect-bar flags caught **0 of 24 wrong bars on PDFs and at most 5 of 59
on photos**, while the import said "good" with confidence 1.00. G12 therefore (1) fixes what PPP loses, in code, behind
`PPP.omr`; (2) puts OMR imports on the ScoreGraph (S4) so Audiveris' beams and every later fix live in one truth;
(3) builds flags that find wrong bars (recall target 0.90) from signals that are measurable today; (4) gives the
engrave renderer a small bar editor with undo; (5) runs the engine where it already works, on the user's PC, through
the G10b queue (recommended; $0), and (6) chooses a learned engine only by measurement (AI-7). A larger licence-clean
benchmark (`omr-live-2`) with exact ground truth comes first and needs no user time.

## 1. What was measured before designing (evidence)

All numbers below were measured for this document at `3567e27`, on the user's PC (Windows 11, RTX 5070 Ti 16 GB),
with scripts in the Architect's scratchpad (`scratchpad/g12-design/`: `render.py`, `shot.js`, `pdf.js`, `run_aud.py`,
`compare.py`, `appscore.py`, `memtest.py`, `mkjobs.py`; appendix A). Nothing was written to production; the only
requests to the live site were `GET /health`, `GET /helper/health` and one empty `POST /helper/omr` (answered 503 by
the stub, no state). Nothing was written to the repository except this file.

**The test pages.** 15 licence-clean excerpts (first 24 bars) from the catalogue's non-hold-out, non-quarantined
pieces: 5 hymns (Open Hymnal, public domain: 2/4, 3/4, 9/8, 2/2, 4/4; 0 to 5 flats), Beyer, Czerny 599, Czerny 849,
Hanon, two Burgmüller, two Clementi sonatina movements (PDMX, CC0), Gymnopédie 1 and Happy Birthday (PPP CC0). 267 bars,
2 pages for two of them. Each was engraved by **Verovio 6.3** (an engraver PPP does not use, so the pages are not
tuned to PPP), rasterised by Chrome at A4 300 DPI ("clean"), and degraded twice: "photo" (perspective up to 2.5 %,
1.5° rotation, uneven light 1.0-0.75, blur σ 1.1, noise, 3000 px tall, JPEG q70; flat paper, no curl, no shadow) and
"scan150" (150 DPI grey, JPEG q60). The truth is the catalogue file itself, so every bar is checked exactly.
Measures are aligned truth-to-output by dynamic programming on note sets (a bar is "aligned" at similarity ≥ 0.2, the
G0 `omr.measure_alignment_rate` rule); a bar is **exactly right** when its pitches, onsets, durations and rests all match.

| # | Finding | Numbers |
| --- | --- | --- |
| E1 | **Production has no OMR engine.** `server.js` `proxyHelper` (1383) answers `/helper/*` "not here" when `NODE_ENV=production`; the page then uses `PdfLayer.notate`, a browser reader that takes pitch from the vertical position, assumes treble/bass clefs, 4/4 and C major, and guesses durations from horizontal spacing. The report is capped at confidence 0.45 "poor" (App 8813-8824). | Live, 2026-10-08: `GET /helper/health` → `{"ok":false,"remote":true,"unreachable":true}`; `POST /helper/omr` → 503. The app's own `Import.load` with no helper (= production) on the 6 vector PDFs: **0 of 83 bars exactly right**, played-note F1 0.07 / 0.09 / 0.62 / 0.45 / 0.31 / 0.33 (mean 0.31); sonatina 31 bars for 24. On 6 photo JPEGs: **5 refused** ("PPP could not read notation on that file"), 1 read as 1 bar with F1 0.00. Fixture `piano-clean.png`: F1 0.05 |
| E2 | **The user's PC has a working engine.** `D:/PPP/tools/audiveris/Audiveris/Audiveris.exe`: Audiveris **5.11.0** (jpackage with its own Java runtime, Tesseract 5.5.2 for text), 156 MB installed, AGPL-3.0. System Java 21.0.11 also present. The helper (`omr-service.js`) finds it; the four-fixture `omr-live` suite has used it since G0. | 51 page runs, all exported MusicXML; **10.1 s a page clean, 7.5 s photo, 4.4 s scan150** (CPU only). Peak RSS of one A4 page **766 MB** at the default 8 GB heap, **504 MB** at `-Xmx300m` with byte-identical output (11 s) |
| E3 | **Audiveris on clean engraved pages is good, not perfect.** | 15 pages: note F1 **0.845** (P 0.884, R 0.824), durations of matched notes 0.909, bar count exact 12 of 15, time signature 14 of 15 (9/8 read as 6/8), **168 of 267 bars (63 %) exactly right**; one 2-staff part on all 15 (no issue 11 on a page with a real brace); staff of matched notes 1.000; every matched note that is beamed in the truth is beamed in the export (98-100 % on scan150) |
| E4 | **Audiveris on degraded pages.** | scan150: F1 0.756, 108 of 267 bars right (40 %), bar count exact 9 of 15. photo: F1 **0.616** (R 0.550), **69 of 267 bars right (26 %)**, bar count exact 3 of 15; the part structure fragments on 12 of 15 photos (`1x1`, `2x1x1`, `1x1x1x2` …): only 3 photos came back as one 2-staff part |
| E5 | **Where the clean-page errors are** (74 aligned wrong bars, divisions repaired). | rhythm/onsets wrong with the right pitches **27**; notes missing **22** (15 of them one 9/8 hymn read as 6/8); pitches wrong with the right rhythm 8 (a left hand in treble clef read in bass clef in Czerny 849; Hanon); rests only 6; extra notes 5; mixed 5; durations only 1. Two pieces (the 9/8 hymn and Czerny 849's dotted-16th + 32nd-rest figures with a treble-clef left hand) hold 30 of the 74 |
| E6 | **Issue 11 has two causes; the fixture shows one, photos show the other.** The 4 `omr-live` fixtures (VexFlow-drawn) have a thin bracket instead of a brace and bar lines that do not cross the staves, so Audiveris sees two independent staves: PNG/JPG → two 1-staff parts; PDF (rasterised by pdf.js) → one staff, **16 bars for 8 (issue 12)**. On real engraving with a brace this did not happen (E3), but photos fragment parts (E4). The app's hand rule (App 4705-4713, same in `scoregraph/legacy-score.js:207,327`) then plays only the LAST part when no part has 2 staves. | App path, fixtures: PNG/JPG/multipage **F1 0.500**, 32 of 48 notes marked `x` (not played), "good", confidence **1.00**, **0 suspect bars**; PDF 16/8 bars, 1 staff, confidence 0.80. Photos, Audiveris output under the app's hand rule: played-note F1 **0.427** vs 0.620 for all staves: the hand rule alone costs 0.19 F1 |
| E7 | **The helper drops movements.** Audiveris exported **6 of 15 photo pages as two movements** (`page.mvt1.mxl`, `page.mvt2.mxl`; it starts a "movement" at an indented system). `recognisePage` (omr-service.js 199-201) keeps the newest single `.mxl`. | Photo F1 0.616 with every movement, **0.498** with one per page as the helper does (played-note F1 under the hand rule 0.427 → 0.414). Separately, Audiveris itself returned only 2-4 of 8-12 bars on three photos (Beyer, Czerny 599, Gymnopédie) |
| E8 | **`<divisions>0</divisions>`.** On a page whose shortest value is a half note (Czerny 599 No. 10) Audiveris writes `divisions 0` with `duration 1` per half note. Both readers (`parseMusicXML` App 4392, `scoregraph/musicxml-import.js` 276) keep divisions 1, so every half note becomes a quarter and every bar half-full. | Czerny 599/10 clean: F1 0.587, **0 of 12 bars** right as read; **1.000, 12 of 12** with divisions inferred from `<type>`. On the app path it is reported "good", confidence 1.00, 0 suspect bars. Repairing divisions moves the clean set from F1 0.845 to 0.872 and 63 % to 67 % exact bars |
| E9 | **The flags do not find the wrong bars.** `Import.validate` flags a bar only if it is empty, overfull, or **less than half** full (App 7582-7597). | App path (Audiveris + PdfLayer + second DPI pass): **0 of 24** wrong bars flagged on the 6 PDFs, **at most 5 of 59** on the 6 photos (5 bars flagged in all), 0 of 32 on the fixtures. The same rule applied offline to all Audiveris outputs: recall **0.28 / 0.31 / 0.29** (clean / photo / scan150), precision 0.93-1.00. A stricter rule (any voice whose written values do not fill the bar exactly): recall **0.72 / 0.54 / 0.83**, precision 0.92 / 0.87 / 0.98. On the truth files the stricter rule flags only pick-up and irregular bars (0-2 per piece) |
| E10 | **OMR never reaches the ScoreGraph as read.** The OMR path parses with `parseMusicXML` (App 8753), applies `PdfLayer.apply` to that legacy Score, and registers a lazy graph made from the **raw** OMR XML (`engraveRememberXml`, App 5525-5531): the graph lacks every PdfLayer fix (8va shifts, accidental carries, phantom notes, chords, title), so `engrave/source.js` falls back to the projected Score when they disagree; the legacy Score has no beams (`parseMusicXML` reads none). | TD2/S4 for OMR as the roadmap says; Audiveris' beams (E3) are lost on screen whenever the projection is used |
| E11 | **Nothing can be corrected.** The review screen shows the page image beside 4 engraved bars and a strip of bars (red = suspect); the only actions are "Accept and practise", "Try again", "Replace the file" (App 2675-2677, 16173-16204). No note, bar, clef, time or staff edit exists anywhere in the app; Undo exists only for the recording "Write the notation again" (one step, `undoNotation` 15712). `scoregraph/ops.js` has head/event edits, retiming, beams, tuplets, accidentals, key, clefs (inside `edit`), rests refill; it has **no time-signature op and no measure insert/delete/split/merge**. `engrave/practice.js` already has `hitTest(x, y) → {system, measure, event}` | the correction UI is new work, on existing ops plus three new ones |
| E12 | **Timing on the app path** (one page each, local helper): | vector PDF 6-22 s (35 s for the fixture: the second, denser pass runs when a check fires), photo 5-10 s |

**What these numbers are not.** The pages are synthetic: one engraver (Verovio), flat-paper photos, no real print
typefaces, no real scanner noise, no hand-written marks. Real scans of 19th-century editions and real phone photos will
be worse (§18 K1-K3). 15 pieces is a design sample, not a benchmark; `omr-live-2` (§10) replaces it.

## 2. The roadmap card, checked

| # | Card statement | Verdict | Evidence |
| --- | --- | --- | --- |
| 1 | "S4 for OMR (`PdfLayer.apply` onto the graph, so Audiveris' beams survive)" | **Confirmed** | E10 |
| 2 | "issue 11 (two single-staff parts → a grand staff)" | **Confirmed, with a second cause** | E6: brace-less engraving (the fixtures) and photo fragmentation (12 of 15 photos). The fix is a normalisation of parts before import plus a hand rule that never silences a staff of a piano-only import |
| 3 | "issue 12 (bar count)" | **Explained** | E6: the fixture PDF read as one staff of 16 bars because no line joins the two staves; on braced engraving the count was exact on 12 of 15 clean pages (the misses: 25 for 24, 23 for 24, and 7 for 8 on a piece that starts with a pick-up). Bar count is a flag signal, not a separate fix |
| 4 | "suspect-bar flags with measured recall" | **Confirmed and urgent** | E9: today's recall is about 0 on the app path, and the import says "good" |
| 5 | "a correction UI on the engrave renderer" | **Confirmed** | E11 |
| 6 | "the engine (Audiveris vs a learned OMR) chosen by evidence (AI-7)" | **Confirmed** | Audiveris is the baseline (E3, E4); photos are where a learned engine could win (E4) |
| 7 | "Depends on G4f and G9" | **G4f done; G9 is not needed** | G9's repair ops change an arrangement's voicing by octaves; OMR needs edits of single notes, values and bars (`ops.js`, plus §7.4's new ops). The notation checks it needs are G10's `scoregraph/tools/notation-check.js` |
| 8 | "Independent of G10 and G11" | **Confirmed; it reuses G10b** | the home-PC queue (G10b) is the cheapest place to run the engine (§6) |

## 3. Goal and non-goals

**G12 — a printed piano score (PDF or photo) becomes a ScoreGraph that is right, or every bar that may be wrong is
marked, shown against the page, and fixable in a few taps.** Measured against exact truth on a licence-clean
benchmark, and judged once by the teacher (H-12).

Non-goals: hand-written scores; non-piano scores beyond what Audiveris already reads (the hand rule keeps working as
today for them); lyrics; chord-symbol recognition beyond `PdfLayer.chords`; a server-side engraving engine; training
a new OMR model from scratch (AI-7 only adopts pinned pretrained engines); OMR for anyone without an engine (the hosted
site keeps the browser draft, honestly labelled, unless the user decides a paid engine, §6 and U1).

## 4. What already exists — reuse, do not rebuild

| What | Where | Used for |
| --- | --- | --- |
| Audiveris CLI wrapper, per-page, timeout, `.mxl` reader | `omr-service.js` 104-223 | the engine call (keep; fix E7) |
| PDF rasterising at 300 DPI, vector text/lines layer, raster staff/bar/head finder | App 7364-7435, `PdfLayer.read/layout/fromCanvas` | page images for the engine and the review; bar boxes on the page (§9) |
| `PdfLayer.apply`: accidentals carried, phantom arpeggio heads, voice realign, chords, 8va, segno/coda, title/tempo; per-page bar-count gate; `missing` heads | App 11288-11587 | re-expressed as graph edits (§7.3) |
| Second-opinion pass at 1.17× DPI and per-bar merge where better | App 8774-8809, `mergeMeasuresWhereBetter` 7526 | a flag signal (disagreement) and a repair source |
| `Import.validate` | App 7560-7665 | replaced behind `PPP.omr` by the flag model (§8); the old one stays for `legacy` |
| MusicXML → graph, the one door | `scoregraph/import.js`, `musicxml-import.js` | S4 (§7.2) |
| Graph edit ops | `scoregraph/ops.js` (`updateHead`, `removeEvents`, `replaceRegion`, `edit`, `splitEvent`, `mergeTied`, `retimeVoiceMeasure`, `moveEvent`, `moveHeads`, `setTuplets`, `setBeams`, `setAcc`, `setSpelling`, `setKey`, `refillRests`; in `edit`: `addEvent`, `addVoice`, `addClef/removeClef`, …) | the correction UI (§9) |
| Notation checks, 10 classes per bar (voice-bar sum, drawn ≠ exact, bad tuplet, …), Node and browser | `scoregraph/tools/notation-check.js` | flag signals (§8) |
| Engraver, practice map `hitTest`, measure boxes | `engrave/`, `engrave/practice.js` | tap a bar / a note (§9) |
| Review screen: page image, engraved bars, bar strip | App 2681-2701, 19185-19271 | the correction UI extends it |
| Home-PC queue: jobs, worker token, claim/heartbeat/result, free-tier arithmetic | `home-jobs.js`, `home-jobs-store.js`, `home-result.js`, `tools/home-worker/`, G10B doc §3 | kind `omr` (§6, §7.5) |
| G0 `omr-live` tier, `omr.*` metrics (`measure_alignment_rate`, `flag.precision/recall`), symbolic alignment | `tests/bench/pppbench/tiers.py` 229-330, `node/omr-live.js` | `omr-live-2` extends it (§10) |
| Switch convention | `PPP.recording` (`ppp.recording.v1`, `?recording=`; App 5146-5175) | `PPP.omr` (§16) |

## 5. Decisions

| ID | Decision | Why |
| --- | --- | --- |
| G12-D1 | **Audiveris 5.11 stays the engine** until AI-7 shows a better one on `omr-live-2`. Pinned by version and installer hash, recorded in provenance `src` (`omr:audiveris@5.11.0`). Run unmodified, as a separate process (AGPL-3.0: no PPP code links it; its source is public). | E3: F1 0.85-0.87 on clean pages; nothing else is installed or measured |
| G12-D2 | **Fix what PPP loses before anything else**, in code, measurable today: keep every movement file (E7), repair `divisions 0` from `<type>` (E8), normalise parts into one grand staff (E6), and never silence a staff of a piano import. | E6-E8 together explain most of the gap between "Audiveris read it" and "the app plays it" |
| G12-D3 | **Normalisation happens on the MusicXML, before import**, in one pure module `omr/normalize.js` (Node + browser, UMD like `realize/`): merge movements and pages, repair divisions, merge adjacent 1-staff parts into a 2-staff part when they have the same bar count and treble-above-bass clefs (or the brace/system evidence of `PdfLayer.layout`), renumber bars, and report every change (`omr.normalize` notes in the import report). | One deterministic, testable step; the graph importer stays the one door; works for the helper, the worker and any later engine |
| G12-D4 | **OMR imports go through `scoregraph/import.js` (S4)** behind `PPP.omr = 'v2'`; `PdfLayer.apply`'s findings become graph edits with provenance `inferred` and `src: 'omr:pdflayer'`; the legacy Score is made with `toScore` from that graph, as for MusicXML files. | E10; beams survive; one truth for drawing, playing and judging |
| G12-D5 | **Flags come from several signals and are judged by recall first** (target 0.90 at precision ≥ 0.60 on `omr-live-2`). A flagged bar is never silently "fixed"; an automatic repair (e.g. the second pass) is shown as a change the user can undo. | E9: the single "less than half full" rule finds 0.28-0.31 |
| G12-D6 | **The correction UI edits the graph with `ops`, one undo stack per song**, on the engrave renderer; the page crop of the bar is always beside it. No free drawing, no new notation layer. | E11; "drawn = played = judged" holds because every edit is a graph edit |
| G12-D7 | **The engine for the hosted site runs on the user's PC** through the G10b queue (kind `omr`), unless the user chooses a paid engine (U1). The local helper path stays as it is for a PC running the app locally. The browser draft (`PdfLayer.notate`) stays as the last resort, labelled "draft", never "good". | §6: $0, already installed, measured; the alternatives cost money or do not exist |
| G12-D8 | **`omr-live-2` is built from licence-clean sources only**: the catalogue (public domain / CC0) engraved by two engravers (Verovio and PPP's own `engrave/`), deterministic degradations, and real public-domain scans of the very editions Beyer and Czerny 599 were transcribed from (§10). The user's own scores are a **private local suite**, never committed, reported only in aggregate. | Exact truth without user time; no copyright risk; G0 hold-out rules |
| G12-D9 | **AI-7 is a measured bake-off, not a rewrite**: homr (AGPL-3.0), oemer (MIT), SMT++ (MIT) against Audiveris on `omr-live-2`, run on the user's GPU PC; adopt only per §12 gate A7. | §1, §6; licences checked |
| G12-D10 | **`PPP.omr`: `'legacy'` (default) / `'v2'`**, stored like `PPP.recording` (`ppp.omr.v1`, `?omr=`). With `'legacy'` the import is byte-identical to `main` (the helper's extra fields are ignored). | Strangler rule, roadmap §1 principle 4 |

## 6. Where the engine runs: options and costs

Workload assumed for the arithmetic: the teacher imports **about 5 pieces a week, 3 pages each (≈ 65 pages a month)**;
a page image is 0.3-0.8 MB as a grey PNG/JPEG at 300 DPI (a phone photo 1-4 MB, downscaled to ≤ 3000 px before upload).

| Option | What runs where | Accuracy (measured or not) | Cost | Latency | Who can use it | Risks |
| --- | --- | --- | --- | --- | --- | --- |
| **A. Nothing new** (pdf text layer + browser draft) | `PdfLayer.notate` in the browser | **Measured: 0 of 83 bars right on clean PDFs; 5 of 6 photos refused** (E1) | $0 | seconds | everybody | the product promise "PDF/photo → score" is not met; this is what production does today |
| **B. Browser learned OMR** (ONNX Runtime Web / WASM) | an oemer/homr/SMT model in the page | **Not measured.** oemer's own README: "around 3~5 minutes" a page **with a GPU**; homr is AGPL-3.0 (a browser build would ship its code to visitors: source-offer duty for the page); SMT++ (MIT) is autoregressive full-page decoding | $0 server; model download unknown (expected 100+ MB, §18 K4) | likely minutes a page on a laptop CPU, worse on a phone | everybody, if it ran | no production-grade browser OMR exists today (the helper's own header says so); size and speed unknown; not recommended before AI-7 numbers |
| **C. The user's PC, through the G10b queue** (kind `omr`) **— recommended** | page images are uploaded to ppp-web, stored in Postgres until the PC claims them; the worker runs Audiveris (later the AI-7 winner on the RTX 5070 Ti) and posts per-page MusicXML | **Measured**: E3/E4 (Audiveris on this PC) | **$0.** Render: no new always-on time (the same 1-hour idle poll as G10b: 192 instance-hours a month, 26 % of the shared 750; or the desktop shortcut, about 0.5 instance-hour per job). Neon Free (0.5 GB storage, 5 GB egress, 100 CU-h a month): 65 pages × 0.6 MB ≈ **39 MB uploaded and read once a month** (0.8 % of the egress), at most ≈ 15 MB held at a time with a 1-day keeping time, results 20-200 KB a page | up to the poll interval (1 h default) unless the user runs the shortcut; then 5-13 s a page | the PC owner's linked accounts only (the G10b model) | the PC must be on; image storage needs new caps (§7.5); a job waits while the PC is off |
| **D1. Paid serverless** (e.g. Modal) | an Audiveris container per job, scale to zero | as E3/E4 (same engine) | Modal list prices: CPU $0.0000131/core-s, memory $0.00000222/GiB-s. A page ≈ 10 s × (2 cores + 1 GiB) ≈ **$0.0003**, plus a cold start (JVM + container, tens of seconds, not measured) ≈ $0.001-0.002 a job; 65 pages a month ≈ **$0.1-0.2**, inside the $30 monthly free credit of their Starter plan | cold start + 5-13 s a page | anyone the user allows | a new provider account and payment method; the user's scores leave PPP's hosting to a third party; a new deploy surface |
| **D2. Paid always-on instance** (e.g. Render) | Audiveris + Java beside or instead of the helper | as E3/E4 | Render list prices: 512 MB **$7/month** (too small: one page peaks at 504-766 MB RSS, E2), **2 GB $25/month** (fits, one page at a time; 1 CPU would make a page ≈ 20-40 s, not measured), plus the $25/month Pro workspace fee if a team plan is needed | 20-40 s a page (estimate) | anyone | $300+ a year for a feature used a few times a week; one more service sharing nothing with the free tier |

(Prices read from the public pages on 2026-10-08: render.com/pricing, modal.com/pricing; Neon Free limits from
neon.com's plan page. A European VPS as a further option: Hetzner's 4 GB CPX22 is now €19.49/month after the 2026 price
rises; same trade-offs as D2.)

**Recommendation: C**, with A as the honest fallback for everyone else. It is the only option that is measured, $0,
private (the pages go only to the user's own PC), and already half built (the G10b queue, token, worker, caps). Its
cost is latency and "only the PC owner". If the user wants strangers or students to import scores without the PC (U2),
D1 is the cheapest real engine and should be decided with the AI-7 numbers in hand, not before.

## 7. Target architecture

```
 page (PDF/photo)                         engine (one of)                                    page again
 ────────────────                         ───────────────                                    ──────────
 rasterise 300 DPI, PdfLayer.read/  ──►   local helper /omr        (PC running the app)  ──►  per-page result:
 fromCanvas (bar boxes, text, lines)      home-PC worker kind omr  (hosted site, U1 = C)      { movements: [xml…], engine,
                                          [paid engine]            (U1 = D)                     src, ms }
                                          browser draft            (last resort, "draft")
            │                                                                                     │
            ▼                                                                                     ▼
 omr/normalize.js  (pure)  movements + pages merged · divisions repaired · parts → grand staff · bars renumbered · report
            │
            ▼
 scoregraph/import.js (S4)  ──►  ScoreGraph  ──►  omr/apply.js: PdfLayer findings as graph edits (inferred, src omr:pdflayer)
            │                                             │
            ▼                                             ▼
 omr/flags.js  signals per bar → score → suspect bars (+ reasons)          toScore → playback/practice (as for MusicXML)
            │
            ▼
 review screen on the engrave renderer: page crop ↔ bar, bar strip, bar editor (ops), undo stack, live re-check
```

### 7.1 `omr/normalize.js` (G12-D3)

Input: the per-page result list (each page: one or more movement documents) plus optional page layout evidence
(`PdfLayer.layout` systems/staves per page). Output: one MusicXML document and a report. Rules, each a named,
counted change:

1. **Movements**: concatenate a page's `mvtN` documents in order (E7).
2. **Divisions**: a part whose `<divisions>` is 0 or missing gets divisions inferred from the first undotted, untupleted
   note with a `<type>` (E8); if none, the bar is flagged `divisions-unknown`.
3. **Grand staff**: two adjacent parts with one staff each, the upper with a G clef and the lower with an F clef (or any
   clef pair whose staves the page layout shows in one system with a shared left line), the same bar count (± a pick-up),
   become one part with 2 staves (`<staff>` 1/2, `<backup>` between them). Three or more fragments (`2x1x1`, `1x1x1x2`,
   E4) are merged system by system using the page layout; where the layout is missing the import keeps the parts and
   flags every bar `parts-fragmented`.
4. **Pages**: merged by part *after* rule 3, so a page whose parts were fragmented differently from page 1 lines up.
5. **Bars**: renumbered; a page whose recognised bar count differs from the bar lines `PdfLayer.layout`/`fromCanvas`
   found on it marks those bars `bar-count`.

### 7.2 S4 for OMR (G12-D4)

`PPP.omr = 'v2'`: `normalize` → `importToGraph(bytes, name, 'musicxml')` (the same function the MusicXML route uses,
App 8674) → `omr/apply.js` → `graphForScore` → `toScore`. The graph is kept with the song like any import. The hand rule
problem disappears for normalised imports; for safety, a piano-only OMR import whose parts are still several 1-staff
parts gets hands by staff position (top staff right, others left), never `x`.

### 7.3 `omr/apply.js`

The `PdfLayer.apply` findings, computed by the existing `PdfLayer` code from the page layers, applied as `ops` edits
on the graph instead of on the legacy Score: accidental carry (`setAcc`/`updateHead`), phantom arpeggio heads
(`removeEvents` + `retimeVoiceMeasure`), late-voice realign (`retimeVoiceMeasure`), 8va (`addSpanner` ottava; pitch
stays sounding per D-1), chords (harmony annotations), segno/coda/jumps, title/composer/tempo. Each edit carries
provenance `inferred`, `src: 'omr:pdflayer'`, so the review can list and undo it.

### 7.4 New graph ops (Node, tested, used by §9)

`setTime(graph, measureId, {beats, beatType})` (re-bars from that bar on, refuses when notes would be cut),
`insertMeasure/removeMeasure`, `splitMeasure/mergeMeasures`, and `swapStaff(event)` (a thin wrapper of `moveEvent`).
Every op is undoable by keeping the previous frozen graph (graphs are immutable already).

### 7.5 Home-PC queue kind `omr` (only if U1 = C)

Additive to G10b, same security model (§6 of the G10B doc): `POST /api/jobs {kind:'omr', pages:[…]}` from a linked
browser (PC link or account), images as grey PNG/JPEG ≤ 1.5 MB each, ≤ 12 pages a job (24 with an explicit "large"),
≤ 12 MB a job; a new table `ppp_omr_pages(job_id, idx, bytes bytea)` (or the job row's JSON for one page), deleted when
the job finishes, fails or expires (1 day), **a total cap of 64 MB of stored images** and 16 MB per link (the G10b
result caps' pattern); results are per-page MusicXML (≤ 2 MB a job), validated as XML with a size and element budget
(no DOCTYPE, no external entities). The worker: claim → download pages → `recognisePage` for each (the helper's
function, shared) → post `{pages:[{movements:[xml…], ms, ok}]}`. The page opens a finished job through the same
`normalize` → import path. No inbound connection, no new always-on time (G10B §3.1).

## 8. Suspect-bar flags

### 8.1 Signals (each a number per bar, all computable in the browser)

| Signal | Source | Evidence it carries information |
| --- | --- | --- |
| voice-bar sum ≠ bar length (any voice), overfull, empty | graph | E9: recall 0.54-0.83 alone, precision 0.87-0.98 |
| bar count ≠ bar lines found on the page; extra or missing bars at page ends | `PdfLayer.layout`/`fromCanvas` vs import | E6 (16 for 8), E3 (3 of 15 clean pages off by one) |
| parts fragmented on that system; staff left unassigned | `normalize` report | E4 (12 of 15 photos) |
| time signature implausible (bar sums fit another metre better, e.g. 9/8 written as 6/8) | graph | E5 (15 of the 22 "notes missing" bars) |
| clef plausibility (a staff whose notes sit mostly 3+ ledger lines out; LH treble/bass confusion) | graph | E5 (Czerny 849 left hand) |
| notation-check classes 5-8 (hole/overlap, drawn ≠ exact, bad tuplet, both hands same pitch) | `notation-check.js` | G10; untested on OMR (to measure in G12-3) |
| two passes disagree (first pass vs the 1.17× DPI pass; later: Audiveris vs the AI-7 engine) | existing second pass | not measured; the classic OMR ensemble signal |
| printed heads on the page ≠ heads read (vector PDFs) | `PdfLayer.apply` `missing` | exists; fires only when the page bar count matches |
| divisions repaired, movement merged, part merged on this page | `normalize` report | E7, E8 |

### 8.2 Model

G12-3 starts with a transparent rule set (a bar is suspect when any strong signal fires, or two weak ones); the
weights are fitted on `omr-live-2`'s tuning half and judged on its other half (a small logistic model only if the rules
miss the target; no deep model). The report shows the reason per bar ("the notes do not fill the bar", "the page shows 6
bars on this line, PPP read 5", "this part was rebuilt from two staves") and the confidence is computed from the flags,
never 1.00 when any bar is suspect.

### 8.3 Targets and ground truth

- **Ground truth of "wrong"**: an output bar is wrong unless it aligns to a truth bar it reproduces exactly (pitches,
  onsets, durations, rests), the definition used in §1; unaligned output bars are wrong; truth bars nothing aligned to
  count as missed and must be marked at their neighbours (the reviewer sees a gap).
- **Targets** (pooled over bars, per tier): **recall ≥ 0.90 at precision ≥ 0.60** on clean and scan tiers; **recall ≥ 0.85**
  on the photo tier; on truth files fed back as if recognised, ≤ 1 flag per 20 bars (pick-ups excepted).
- **Baselines** to beat: app path today 0/24 and 5/59 (E9); offline rule 0.28-0.31.
- **Human ground truth (H-12 only)**: for the teacher's private pages there is no file truth; the teacher marks wrong bars
  on the review page (the Artifact-with-db pattern of H-8/H-10), which gives recall on real pages in aggregate.

## 9. The correction UI on the engrave renderer

### 9.1 What the app can do today (E11)

Nothing on notes or bars. Existing pieces to build on: the review screen's page image and bar strip (click jumps the
engraved view); `engrave/practice.js` `hitTest`; `ops.js` (head, event, retime, beams, tuplets, accidentals, key, clefs,
rests); the recording screen's one-step Undo pattern.

### 9.2 Interaction (phone first; the teacher reviews on a phone)

1. The review screen opens on the **first suspect bar**; the bar strip shows suspect bars red with a count ("7 bars to
   check"); Next/Previous suspect.
2. **Tap a bar** (engraved view or strip) → a bar sheet: the **crop of that bar from the page image** (from the bar boxes
   `PdfLayer.layout`/`fromCanvas` found; if the page bar count does not match, the system crop with the bar index
   highlighted) above the engraved bar, both large; the reason(s) it was flagged; buttons "This bar is right" (clears the
   flag, recorded as `reviewed`), "Play this bar".
3. **Tap a note** → its handles: pitch up/down a step (diatonic, with Shift/long-press for a semitone), accidental
   (♯ ♭ ♮ none), value (𝅝 𝅗𝅥 ♩ ♪ 𝅘𝅥𝅯, dot), make rest / make note, delete, move to the other staff. **Tap an empty place
   on a staff** → insert a note there at the tapped pitch and the nearest free onset of the selected value.
4. **Bar tools**: clef for this staff from here, time signature from here, key from here, insert bar after / delete bar,
   split / merge with the next, "Re-read this bar" (asks the engine again at a higher DPI for that page and offers the
   alternative reading; available when an engine is reachable).
5. **Staff tools** (shown when the normaliser could not rebuild a grand staff): "These two staves are one piano part"
   (merge), "This staff is the left hand" (assign).
6. **Undo / Redo** for every edit (a stack of frozen graphs per song, kept for the visit, at least 100 steps); "Discard my
   changes" returns to the import.
7. After each edit the bar is re-engraved and re-checked live (the voice-bar sum and notation checks), so a fix that
   leaves the bar short stays red; "Accept and practise" saves the graph with the edits (`provenance: 'edited'`).

### 9.3 Mapping to ops

pitch/accidental → `updateHead`/`setAcc`/`setSpelling`; value → `retimeVoiceMeasure` (+ `refillRests`); rest ↔ note →
`replaceRegion`; delete → `removeEvents` + `refillRests`; insert → `edit(addEvent)`; staff move → `moveEvent`; clef →
`edit(addClef/removeClef)`; key → `setKey`; time, bars → the new ops of §7.4; beams after a value edit → `setBeams`
from G4c's derived grouping. Every edit goes through `ops` and the validator; the legacy Score is re-projected with
`toScore` once per edit (budget §14).

## 10. Benchmark: `omr-live-2`

| Tier | Source | Truth | Size (target) | Where it runs |
| --- | --- | --- | --- | --- |
| **clean-A** | catalogue excerpts engraved by Verovio (npm `verovio`, pinned), rasterised 300 DPI | the catalogue graph | 60 excerpts × 24 bars (≈ 1,400 bars): hymns, Beyer, Czerny 599/849, Hanon, Burgmüller, sonatinas, catalogue; every metre and key class present in the catalogue | T2 (Audiveris on a PC), nightly on a runner with Audiveris if CI can install it (§18 K5) |
| **clean-B** | the same excerpts engraved by PPP's own `engrave/` print path (G4e) | same | same | same |
| **scan** | clean-A/B degraded: 150/200 DPI grey, JPEG, salt noise, slight skew, binarisation | same | same | same |
| **photo** | clean-A/B degraded: perspective, rotation, lighting gradient, blur, noise, **page curl and shadow** (absent from §1's photos), phone resolution | same | same | same |
| **real-scan** | public-domain scans of the editions the catalogue was transcribed from: Beyer (Peters, Leipzig 1895) and Czerny Op. 599 (Schirmer, New York 1893), named in `catalog/method/books.json`; fetched from IMSLP by a script that pins each file's URL and sha256 and keeps only files IMSLP marks public domain; page images are generated locally, not committed | the catalogue's own transcription of that edition (bar-for-bar; the transcriber's deviations listed in a `known-differences.json` after one check) | 20-30 pages | T2, local |
| **brace-less** | the 4 existing G0 fixtures | `truth.json` | 4 | as today |
| **private** | the user's own scanned or photographed scores | none in files; H-12 marks | whatever the user provides | the user's PC only; never committed; aggregate numbers only |

Hold-out: the catalogue's existing hold-out pieces are never rendered into a tuning tier; a 30 % split of the excerpts is
reserved for the final report of each phase (G0 rules: not inspected one by one). Metrics (`omr.*`, new ones in
**bold**): `omr.measure_alignment_rate`, **`omr.bar_exact`**, **`omr.note_f1`** (all staves) and **`omr.played_f1`**
(what the app plays), **`omr.duration_acc`**, **`omr.staff_acc`**, **`omr.bar_count_exact`**, **`omr.parts_ok`**,
**`omr.time_ok`**, `omr.flag.recall`, `omr.flag.precision`, plus the G0 critical gates the symbolic evaluator already
computes. Two paths are measured per case: the engine alone (from its MusicXML) and the app path (`omr-live.js`
through `Import.load`), so a loss between them is visible (E6-E8 were found exactly this way).

## 11. Phases

Each phase is one PR, ships alone, and is **off by default** (`PPP.omr = 'legacy'` byte-identical to `main`) or
Node/test-only. Effort is in implementer sessions. Model choice: **Opus only for AI-7 (G12-6)**; every other
implementer, reviewer and fixer on Sonnet.

| Order | Phase | Scope | Effort | Who | Start now without the user? | Ships |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | **G12-0 Benchmark** | `tests/omr/`: renderer (Verovio + PPP print), degradations, truth export, the `omr.*` metrics, `run.py omr-live-2` (engine-alone and app-path modes), baselines for Audiveris 5.11 on clean-A/B, scan, photo; the brace-less tier kept; the real-scan fetch script (pages not committed) | 2 | Sonnet | **yes** | tests/tooling only |
| 2 | **G12-1 Keep what the engine read** | `omr/normalize.js` (movements, divisions, grand staff, bars, report); helper returns every movement (`movements` per page, new field; the old `musicxml` field unchanged); the hand rule never silences a staff of a piano OMR import (under `'v2'`); `PPP.omr` switch | 1-2 | Sonnet | **yes** | behind `PPP.omr='v2'` |
| 3 | **G12-2 S4 for OMR** | import through `scoregraph/import.js`; `omr/apply.js` (PdfLayer findings as ops); graph kept with the song; beams drawn | 2 | Sonnet | **yes** | behind `'v2'` |
| 4 | **G12-3 Flags** | `omr/flags.js` (§8), reasons in the report, confidence from flags; fitted on the tuning half | 1-2 | Sonnet | **yes** | behind `'v2'` |
| 5 | **G12-6 = AI-7 Engine bake-off** | homr, oemer, SMT++ (+ Audiveris) on `omr-live-2` incl. real-scan and photo, on the RTX 5070 Ti; licences, size, speed, accuracy; a report and, only if gate A7 passes, a worker-side engine switch | 2 | **Opus** | **yes** (measurement only; adoption needs no user decision unless it changes cost or privacy) | report (+ worker option) |
| 6 | **G12-4 Correction UI** | §9 on the review screen; new ops §7.4; undo stack; live re-check | 3 | Sonnet | after U3 (scope); can start with the recommended scope | behind `'v2'` |
| 7 | **G12-5 Engine for the hosted site** | the decided option of U1: queue kind `omr` (§7.5) — or a paid engine adapter | 2 | Sonnet | **no**: needs U1 (and U2) | behind `'v2'` + the PC link |
| 8 | **H-12 and flip** | §13; then `PPP.omr` default `'v2'` on the user's word | 1 (tooling) + the user's ~30 min | Sonnet | no | flip |

Phases 1-5 need nothing from the user and can run in parallel worktrees after G12-0 lands (1 → {2, 5}; 2 → 3 → 4).
Total about 14-16 sessions.

## 12. Acceptance gates (numbers)

| ID | Phase | Gate |
| --- | --- | --- |
| A0 | G12-0 | `omr-live-2` deterministic (3 runs, reversed order; Windows and Linux for the Node parts); its numbers for Audiveris on the §1 subset reproduce §1 within ±0.02; each new metric proven by a mutation (a dropped bar, a wrong staff, a halved duration, a missed flag) |
| A1 | G12-1 | brace-less tier: played-note F1 **0.500 → ≥ 0.98** on PNG/JPG/multipage and bar count **16 → 8** on the PDF (issues 11, 12); clean-A app path: played F1 ≥ engine-alone F1 − 0.01 (nothing lost between engine and app; today divisions alone cost up to 0.41 on a piece); photo tier: played F1 **≥ 0.60** (today 0.41 with one movement per page and the hand rule; engine-alone 0.62); off-path identity byte-for-byte |
| A2 | G12-2 | on clean-A/B every import's graph agrees with its Score (no projected fallback for OMR); beams drawn on ≥ 95 % of the notes Audiveris beamed; `omr.*` not worse than after G12-1 by more than 0.005; off-path identity |
| A3 | G12-3 | flag recall **≥ 0.90 at precision ≥ 0.60** on clean and scan, **≥ 0.85** on photo (held-out half); ≤ 1 flag per 20 bars on truth files; no import with a suspect bar reports confidence ≥ 0.85 |
| A4 | G12-4 | every edit kind of §9.2 covered by a browser test that edits, undoes and redoes and checks drawn = played (the Score from `toScore` equals the graph); an edit + re-engrave ≤ 100 ms on a desktop and ≤ 300 ms at 4× CPU throttling for a 4-bar view; the page crop matches the bar on clean-A pages (bar box overlap ≥ 0.8 on 95 %) |
| A5 | G12-5 | as G10b: 0 SQL statements on idle polls (counted), caps enforced (tests), a real end-to-end job from the site to the PC and back, images deleted after the job (counted), no new always-on time |
| A7 | G12-6 | a learned engine is adopted only if it beats Audiveris on `omr.bar_exact` by **≥ 0.10 on the photo tier and the real-scan tier** without losing more than 0.02 on clean-A/B, runs ≤ 60 s a page on the PC, and its licence allows the deployment chosen in U1 |
| A8 | flip | H-12 passes (§13) and the user approves |

Every merge also keeps the roadmap §9 gates (CI gate green, off-path identity, mutations, determinism, docs).

## 13. H-12 (the human review)

About 8 pages, about 30 minutes, on the phone, as a Korean Artifact with the db capability (the H-10 pattern): 4 of
the teacher's own pages (2 scans, 2 phone photos; private, never committed) and 4 public-domain pages from the real-scan
tier. For each page the teacher sees the review screen as the app will show it (flags and reasons, page crop, editor),
fixes it, and answers three questions. The engine runs on the PC (option C) for the private pages.

**Pass rule** (all three): (1) of the bars the teacher checks and leaves unflagged, ≥ 95 % are right (an unflagged wrong
bar is the worst failure); (2) median time to a correct page ≤ 5 minutes for a page of ≥ 16 bars; (3) on ≥ 6 of 8 pages
the teacher answers "I would use this instead of typing the piece in". A fail stops the flip (roadmap §16.1); the
recorded marks become flag ground truth.

## 14. Budgets

| What | Budget |
| --- | --- |
| Engine, per page on the user's PC | ≤ 15 s p90 (Audiveris measured 4.4-13.4 s); an AI-7 engine ≤ 60 s |
| `normalize` + import + `apply` + flags in the page | ≤ 300 ms for 24 pages on a desktop, ≤ 1 s at 4× CPU; off the main thread if over 100 ms per step |
| An edit + re-engrave + re-check | ≤ 100 ms desktop / ≤ 300 ms at 4× CPU (A4) |
| Upload for option C | ≤ 12 MB a job, ≤ 1.5 MB a page; total stored images ≤ 64 MB |
| Memory of the engine | Audiveris peak RSS 504-766 MB a page (E2): one page at a time in the worker |

## 15. Risks

| Risk | Effect | Mitigation |
| --- | --- | --- |
| Real scans and photos are much worse than the synthetic tiers | numbers in §1 overstate quality | the real-scan tier (§10), the private suite, H-12; photos labelled "draft, check the flagged bars" until A7 |
| Grand-staff merge joins two parts that are not one piano (a violin + piano page) | wrong hands | merge only treble-over-bass with matching bar counts or layout evidence; keep parts and flag otherwise; non-piano scores keep today's rule |
| `ops` lack time/measure edits | the editor cannot fix bar errors | §7.4 adds them first, in Node, tested, before any UI |
| The queue stores images in a 0.5 GB free database | quota pressure | caps (§7.5), 1-day keeping time, deletion after the job, counted in tests |
| AGPL engines | licence duty | run unmodified as separate processes on the user's PC (C) or a service (D); never bundle AGPL code into the page (B) |
| The flags become noisy and the user stops reading them | the card's promise fails the other way | precision ≥ 0.60 floor, reasons shown, "This bar is right" clears a flag |
| `index.html`/app file conflicts with parallel sessions | merge pain | G12-0, -1, -6 are mostly outside the app file; the app hunks are small and late (G12-2, -4) |

## 16. Rollback

`PPP.omr = 'legacy'` (default until the flip; `localStorage['ppp.omr.v1']`, `?omr=legacy`) restores today's path
byte-for-byte: helper `musicxml` field, `parseMusicXML`, `PdfLayer.apply` on the Score, `Import.validate`. After the
flip the old path stays one release (roadmap §1 principle 4). Songs saved with edits keep their graph; switching back
does not delete them. The queue kind `omr` can be turned off server-side (`PPP_OMR_JOBS=0`) without touching kind
`youtube`.

## 17. Decisions

### 17.1 Decisions the user must make (product, UX, cost)

| ID | Decision | Lead's recommendation | Cost of being wrong |
| --- | --- | --- | --- |
| **U1** | Where does the real OMR engine run for the live site? A: nowhere (browser draft only) · C: your PC through the existing queue · D: a paid service (≈ $0.1-0.2 a month serverless at your volume, plus a new account; or $25/month always-on) | **C** (your PC, $0, already measured on it); revisit D only if U2 says others must use it | C wrong (others need it): their imports wait or are drafts; switching to D later reuses the same `normalize`/flags/editor, about 2 sessions. D wrong: money and a third party holding your scores for no user benefit |
| **U2** | Who may use OMR on the site: only accounts linked to your PC (as the YouTube conversion), or anyone | **only your linked accounts** for now | too narrow: a student cannot import; widening needs D (U1). Too wide on your PC: strangers' jobs on your computer |
| **U3** | Scope of the first correction editor: (a) the full §9.2 set (notes, values, rests, accidentals, clef/time/key from a bar, bars insert/delete/split/merge, staves merge/assign, undo); (b) only "mark right / re-read this bar" | **(a)**, 3 sessions | (b) leaves the user unable to fix what the engine cannot re-read (most photo errors); (a) costs 1-2 sessions more than (b) |
| **U4** | May your own scanned/photographed scores be used privately (on your PC only, never committed, aggregate numbers only) for H-12 and a private test suite? | **yes** | no: H-12 runs on public-domain pages only and real-world quality stays unknown |
| **U5** | When: start G12-0 to G12-3 and AI-7 now (no user time, all off), or keep G12 after G11 as the roadmap says | **start now** in parallel with G10/G11 work: they touch mostly new files | starting now costs sessions that could go to G11; waiting leaves the live site with a PDF/photo import that is wrong in every bar (E1) |
| **U6** | What the app promises for photos before AI-7: "a draft: check the red bars" vs the same wording as scans | **draft wording for photos** | over-promising: the teacher meets 26 % right bars (E4) believing the app |

### 17.2 What the Lead decides alone (recorded, reversible)

Engine pinning and provenance; the `normalize` rules and their order; the flag signals, thresholds and the
tuning/held-out split; the benchmark's composition and tiers; the switch name and storage key; the phase order inside
§11; whether a phase is reviewed lightly (docs, tests, Node-only) or fully (app, server, queue); adopting an AI-7 engine
that passes A7 and changes neither cost nor privacy; the editor's exact layout within U3's scope.

## 18. Honest unknowns

| # | Unknown | How it will be known |
| --- | --- | --- |
| K1 | Audiveris on **real** scans of 19th-century editions (broken type, show-through, skew) | the real-scan tier in G12-0 |
| K2 | Audiveris on **real** phone photos (curl, shadows, glare, perspective beyond 2.5 %) | the photo tier with curl/shadow, then the private suite and H-12 |
| K3 | How much of the photo loss is layout (part fragmentation, movements) vs symbols | G12-1's normaliser measures it: today's split is engine 0.62 vs app 0.41 played F1 |
| K4 | Size and speed of homr/oemer/SMT++ models, and whether any runs in a browser | AI-7 |
| K5 | Whether GitHub's runners can install Audiveris (Linux package + Java) for a nightly `omr-live-2` | G12-0 tries; if not, the tier is T2 (local) like today's `omr-live` |
| K6 | Neon's real storage use of the `ppp` project today (the G10B doc could not check the console either) | read before G12-5 (decides whether the 64 MB image cap fits) |
| K7 | The cold-start time of a containerised Audiveris (option D1) | only if U1 = D |
| K8 | Whether the second DPI pass helps on photos (it runs on PDFs only today) | G12-3 measures it as a flag signal |
| K9 | Whether the flags' recall on synthetic pages transfers to real pages | H-12's marks |

## 19. What G12 does not do

- No OMR engine on the free Render instance (512 MB; one Audiveris page peaks at 504-766 MB RSS, and the image has no Java).
- No browser-side learned OMR before AI-7 shows it is small and fast enough.
- No training of an OMR model; no use of the user's scores for training.
- No change to the YouTube/recording conversion, the arrangers, or playback.
- No committed copyrighted pages; the private suite stays on the user's PC.
- No silent auto-correction: every automatic change is listed and undoable.
- Hand-written scores, lyrics, tablature, non-piano ensembles beyond today's behaviour.

## Appendix A. Measurement commands (Architect's scratchpad, not in the repository)

```
python -I render.py data 24 svg      # 15 catalogue excerpts -> truth.musicxml + Verovio SVG pages
node shot.js data                     # Chrome: SVG -> clean-pN.png (A4 300 DPI)
python -I render.py data 24 degrade   # photo-pN.jpg, scan150-pN.jpg
node pdf.js data                      # Chrome: SVG -> vector score.pdf (for the app's PDF path)
python -I run_aud.py data             # Audiveris 5.11 on 17 pages x 3 variants (D:/PPP/tools, read-only)
python -I compare.py data [--repair-div] [--app-pick] [--why] [--per-case] [--selftest]
python -I memtest.py <page> <out> <heap>             # peak RSS at a heap cap
node tests/bench/node/omr-live.js --in appjobs.jsonl --out appout.jsonl --base http://127.0.0.1:8801
   # the app's own Import.load: (a) with the worktree helper on 8788 (PPP_AUDIVERIS set), (b) without it (= production)
python -I appscore.py data appout.jsonl
```

`compare.py --selftest` (truth against itself) gives F1 1.000 and exact bars 1.00 on all 15; the stricter flag rule
fires there only on pick-up and irregular bars (0-2 per piece).

## 20. G12-0 implementation record (Implementer, Sonnet, 2026-10-08)

Branch `g12-0-bench` (`D:/PPP-g12p0`), PR #226, from `main` `439d3b0`. Tests and tooling only; the app, the server and the helper are untouched.
`tests/omr/README.md` is the manual; this section records what was measured and decided.

**Built (row G12-0 of section 11).** `python tests/bench/run.py omr-live-2 run|check|baseline|render|determinism|cases|fetch-real`:
60 catalogue excerpts (1,169 bars: the pool's longest-enough pieces; the 15 pages of section 1 are always in; every metre and key of the pool is
present; 18 of 60 held out, quoted as a number only) engraved by Verovio 6.3 (clean-A) and by PPP's print path (clean-B), A4 300 DPI by headless
Chrome, degraded to a synthetic flat-paper photo (photo-A/B), a 150 DPI scan and a 200 DPI scan (scan150/scan200-A/B); the 4 G0 fixtures as the
brace-less tier; Audiveris 5.11 alone (`--mode engine`) or through `Import.load` with the helper (`--mode app`) or without it (`--mode app-nohelper`,
what production does). The `omr.*` metrics are `note_f1`, `played_f1`, `bar_exact` (pooled), `measure_alignment_rate`, `duration_acc`, `staff_acc`,
`beam_kept`, `bar_count_exact`, `parts_ok`, `parts_fragmented`, `time_ok`, `key_ok`, `div0` and `flag.<rule>.recall/precision` (rules `app` and `voice`;
`external_flags` is the hook for G12-3). The real-scan fetch script is written and refuses anything the host does not mark public domain; its list is
empty (nothing was downloaded, no licence was read). Baselines (`tests/omr/baselines/`): `audiveris-5.11.0.json` (engine alone, every tier),
`audiveris-5.11.0.app.json` (helper), `browser-draft.app.json` (no helper), each with `check` at tolerance 0.02.

**A0, clause by clause.**

| clause | result |
| --- | --- |
| deterministic, 3 runs, reversed order | `omr-live-2 determinism`: truth, SVG, PNG, JPEG byte-identical in three renders (in order, reversed, rotated); the Node parts (`ppp-print.test.js`, in the gate) likewise, on Windows here and on Linux in the gate. Three things had to be fixed to get there: Verovio draws random element ids unless `xmlIdSeed` is set; Chrome's GPU raster draws the same SVG with a different anti-aliasing from one shot to the next (6 shots, 3 PNGs), so the benchmark rasterises on the CPU (`--disable-gpu`); the PDF is made in Chrome's quirks mode, as the document's measurement was (standards mode moved the browser draft reader's F1 of two PDFs by 0.03-0.09) |
| section-1 numbers within +-0.02 | **clean and photo yes, scan150 no on the CPU raster.** s1 (15 pages): clean-A F1 0.846, 169 of 267 bars (document 0.845, 168); photo-A 0.627, 65 (0.616, 69); scan150-A **0.721**, 100 (0.756, 108). With `OMR_CHROME_GPU=1` (the document's raster) all three come out to the last digit: 0.845 / 168, 0.616 / 69, 0.756 / 108. Audiveris is deterministic (17 of 17 outputs byte-identical on the document's own scan images, three at a time); what moves is the page: a different anti-aliasing of the same page moves the mean of 15 150 DPI scans by 0.035. The 60-excerpt tiers average four times as many pages. The Lead may prefer to make the GPU raster the baseline's (it reproduces section 1; its pages are not byte-stable) |
| each new metric proven by a mutation | `tests/bench/unit/test_omr2_metrics.py`: a dropped bar, an extra bar, a wrong staff, a halved duration, a wrong pitch, a missing rest, a missed note, fragmented parts, a misread metre and key, divisions 0 (as read and repaired), lost beams, a read of nothing, a missed flag, a false flag, a flag outside the score |
| E1, E6, E9 on the app path | no helper: 0 of 83 bars, played F1 0.07 / 0.09 / 0.62 / 0.45 / 0.31 / 0.33 (mean 0.311), 5 of 6 photos refused and the sixth one bar, as measured; brace-less fixtures: PNG, JPG, multipage 32 of 48 notes silenced, played F1 0.500, "good", confidence 1.00, no flag; the PDF 16 bars for 8, one staff. With the helper: 58 of 83 bars exactly right on the PDFs, 25 wrong, **0 flagged** (document: 0 of 24); on the photos 22 of 83, 7 bars flagged, all of them wrong (document: 5 flagged; the photo pages differ) |

**Baseline (engine alone, all 60 excerpts; note F1 is the mean over excerpts, bars are pooled; the held-out half is in the totals).**

| tier | excerpts | note F1 | played F1 | bars exactly right | bar count exact | parts ok | flag R (voice rule) | flag P |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| clean-A | 60 | 0.877 | 0.870 | 815 / 1169 (69.7 %) | 0.77 | 0.98 | 0.78 | 0.92 |
| clean-B | 60 | 0.888 | 0.815 | 685 / 1169 (58.6 %) | 0.92 | 0.77 | 0.61 | 0.94 |
| scan150-A | 60 | 0.793 | 0.793 | 518 / 1169 (44.3 %) | 0.73 | 0.97 | 0.78 | 0.92 |
| scan150-B | 60 | 0.000 | 0.000 | 0 / 1169 | 0.00 | 0.00 | - | - |
| scan200-A | 60 | 0.876 | 0.871 | 807 / 1169 (69.0 %) | 0.77 | 0.98 | 0.80 | 0.92 |
| scan200-B | 60 | 0.835 | 0.668 | 471 / 1169 (40.3 %) | 0.93 | 0.42 | 0.56 | 0.92 |
| photo-A | 60 | 0.702 | 0.473 | 201 / 1169 (17.2 %) | 0.15 | 0.17 | 0.49 | 0.97 |
| photo-B | 60 | 0.830 | 0.798 | 432 / 1169 (37.0 %) | 0.95 | 0.85 | 0.68 | 0.91 |
| **scan** (the four above) | 240 | 0.626 | 0.583 | 1796 / 4676 (38.4 %) | 0.61 | 0.59 | 0.69 | 0.92 |
| **photo** (A + B) | 120 | 0.766 | 0.636 | 633 / 2338 (27.1 %) | 0.55 | 0.51 | 0.58 | 0.94 |
| brace-less (engine alone, PNG + JPG) | 2 | 1.000 | 0.500 | 16 / 16 | 1.00 | 0.00 | - | - |

**What the 60 excerpts and the new tiers showed, beyond section 1.**
- **PPP's own print is not readable at 150 DPI.** Its staff is 7 mm high: 10 px an interline at 150 DPI, and Audiveris answers "a too low interline value
  of 10 pixels ... NOT RELIABLE ... Sheet ignored" on every page (scan150-B). At 200 DPI (14 px) it reads them (F1 0.835, 40 % of bars). That is why a
  200 DPI scan was added to the 150 DPI one; the merged `scan` tier holds both, scan150-B's zeros included.
- **clean-B (PPP's print) is read worse than Verovio's where it matters to the app**: note F1 0.888 but played F1 0.815, because only 77 % of the pages
  come back as exactly one grand-staff part (the rest as `1x1x2` or `2x1x1`: Audiveris splits off extra parts on PPP's pages, which the hand rule then
  plays or silences by position); 58.6 % of bars right against 69.7 %. Its bar count is exact more often (92 % against 77 %).
- **Photos lose the parts structure more than the notes**: photo-A has note F1 0.702 but played F1 0.473 (only 10 of 60 pages come back as one grand-staff
  part; 15 as `2x1x1`, 15 as `1x1`, 11 as `1x1x2` ...; 30 % are the issue-11 shape, several single-staff parts only); photo-B 0.830 / 0.798. The gap
  between note F1 and played F1 is the G12-1 target (K3).
- **The offline flag rules on the full set**: the app's rule finds 0.26-0.35 of the wrong bars (precision 0.84-0.99); the stricter voice rule 0.49-0.78
  (precision 0.92-0.97). G12-3's target is 0.90 at 0.60.
- **Seven pages fail inside Audiveris** besides scan150-B (a NullPointerException in `Part.isDrumPart`, a `NonInvertibleLineException`); they count as
  read-nothing.
- **A busy PC changes the answer.** Audiveris gives each step of a page 120 s and drops the page when a step is slower; beside another job on every core
  (4 pages at once next to a 14-thread job) pages were lost that way. The tool passes `-option org.audiveris.omr.Main.sheetStepTimeOut=1800` (an on-time
  page is unchanged), marks any page that still times out and refuses to record a baseline from a run that has one. The helper in `--mode app` takes no
  such option: run the app path on a quiet PC.

**Decisions of the Lead's kind taken here (reversible).** 1,169 bars rather than "about 1,400": the pool's pieces are short (hymns 16-24 bars, exercises
8-24) and the quotas take what exists; scan has two resolutions (above); the baseline is on the CPU raster; case selection is a hash of the id, the
held-out half the 18 smallest split hashes; the brace-less tier reads the two images alone and all four files on the app path; the PDFs of the app path are
vector PDFs of the same SVG pages; `omr-live.js` gained `--helper-port` (the page believes the helper is on 8788; the tool sends it to a helper it started
on a free port, or refuses it), so another session's helper is never used. **Not done:** the real-scan tier's pages and scoring (the list is empty; G12-6),
a page-curl and shadow photo (K2), the correction-time measures of section 13.

## 21. G12-1 implementation record (Implementer, Sonnet, 2026-10-08)

Branch `g12-1-normalize` (`D:/PPP-g12p1`), from `main` `f775bdd`. Row G12-1 of section 11, gate A1 of section 12. Everything is behind `PPP.omr = 'v2'`; with the default `'legacy'` the
import is the one `main` makes (proof below). `tests/omr/README.md` has the commands.

**Built.**

| What | Where |
| --- | --- |
| `normalize(pages, opts)` -> `{ok, xml, pages, report}`: the rules below on the MusicXML the engine wrote. UMD (Node and browser); its one dependency is `scoregraph/xml.js` (a DOCTYPE is skipped, never interpreted); deterministic; 24 pages of 16 bars in about 30 ms | `omr/normalize.js` |
| the helper's `/omr` answer has `movements` (every `.mxl` of each page, in movement order) beside the `musicxml` it always had (a new field; the old one is the line it was) | `omr/helper-output.js`, `omr-service.js` |
| `PPP.omr` (`'legacy'` default, `'v2'`; `?omr=`; `localStorage['ppp.omr.v1']`; any other value is no choice and the default comes back: PPP.recording's rule). Under `'v2'` `Import.load` reads the pages through the normaliser (fetched when a v2 import needs it, never by a legacy page; if it cannot be fetched the import is what legacy makes), `PdfLayer.apply` gets a per-page document with the page's bar count, `report.normalize` carries the normaliser's report, and `parseMusicXML(xml, name, {omrPiano: true})` never silences a staff of an engine import that has no two-staff part (top staff right hand, every other left) | `Piano Coach App.dc.html` (small hunks: the switch beside PPP.recording, `Import.omrXml`, the three `parseMusicXML` calls, one hand-rule line, `PPP.omr`) |
| `run --normalize` (engine alone, the files read through `omr/normalize.js`; diagnostic, never a baseline), `run --mode app --omr v2` (the page in v2, results in `out/app-v2/`) | `tests/omr/omrbench/`, `tests/omr/node/normalize-cli.js`, `tests/bench/node/omr-live.js` |
| 93 Node tests (`npm run test:omr-normalize`, a step of the gate, in `shard-g`; 2 of them stand in for Audiveris with a shell script and so run on Linux, in the gate, and here in Docker): 18 scenarios of pages built the way the engine was seen to write them (4 of them "rich": chords, grace notes, ties and a `<forward>` in the pair, systems, fold and pages paths), each answer computed from the same music written as one grand staff; one invariant test (the multiset of pitch, onset, duration, tie, chord, grace is the same before and after, in every scenario); 35 mutants of the module, each caught by the scenario named for it (`MUT-NOOP` the control); the helper's movement order and the service started with, without and with a broken `omr/helper-output.js`. The browser suite `npm run test:omr-app` (local): the switch, legacy unchanged, v2, an old helper, a normaliser that cannot be fetched, that throws, and a page nested 20,000 deep | `tests/omr/normalize/`, `tests/omr-normalize-app.test.js` |

**What the 480 files of G12-0 showed (rule 3 changed because of it).** Audiveris does not split a piano into "two parts that line up", as section 7.1 assumed. It reads a page *system by system*:
the notes of a system are in one part (or pair of parts) and the other parts of the movement hold whole-bar rests for the same bars; which part holds a system differs from page to page and
within a page. Of the 294 reads of the tuning half (case x tier; `scan150-B` reads nothing and is not in it): 192 are one two-staff part; 42 are one movement in another shape (`2x1x1` 15, `1x1x2` 14, `1x1` 9,
`1` 2, `1x1x1` 1, `2x1` 1); 56 are several movements; 4 read nothing. So the rule is not "merge adjacent G and F parts" but: **groups** (a two-staff part, or an adjacent pair of one-staff parts with a G
clef on the upper) that have no notes in the same bars are one piano, and each bar comes from the group that has its notes; groups that share more than a quarter of their bars (`OVERLAP_MAX`) are a score of
several parts, not a fragmented piano, and are left as they are and flagged `parts-fragmented`. On the 294 reads **no bar was shared and no note was dropped** (`report.counts.droppedNotes` 0; the note F1 of the
normalised read equals that of the divisions-repaired read to the third place); 283 come out as one two-staff part on every page; 7 do not (4 are a lone staff per movement, 3 are `1x1x1` / `1x1x2` pages whose groups share bars); 4 read nothing. The
"ghost" rule (a part with no pitched note beside one with notes is dropped) never fired on these files (the parts of rests next to a system hold notes in other bars): it stays as the guard for a part that is empty
all through. The PDF's 16 bars of one staff (issue 12) are the same thing seen from the other side: the engine read each staff as a system of one staff, G, F, G, F with 4 bars each (`<print new-system>`
before each); `systems` folds equal G-over-F pairs (it also did so on three photo reads of two bars of one staff: one system read as two staves).

**A1, clause by clause.** Pages and engine run here (Audiveris 5.11.0), `s1` = the design document's 15 pages (267 bars), CPU raster; the 83 page files (PNG, JPG, SVG, truth) are byte-identical to G12-0's.

| clause (section 12) | before (`main`) | after (`'v2'`) | gate |
| --- | --- | --- | --- |
| brace-less, app path, PNG / JPG / multipage PDF: played-note F1 | 0.500 / 0.500 / 0.500 (32 of 48 notes silenced, "good", confidence 1.00, no flag) | **1.000 / 1.000 / 1.000** (48 of 48 played, 8 of 8 bars exact each) | >= 0.98: met |
| brace-less, app path, the PDF: bars | 16 bars, one staff, played F1 0.638 | **8 bars, two staves**, played F1 0.979 (6 of 8 bars exact; the other two lack one note each) | 16 -> 8: met |
| brace-less, engine alone, PNG + JPG | played F1 0.500, parts ok 0.00 | 1.000, parts ok 1.00 | |
| clean app path (6 vector PDFs) played F1 against the engine alone's | 0.887 | **0.956**; the engine alone, normalised, on the same 6 pieces 0.960: -0.004 | >= engine - 0.01: met |
| photo app path (6 JPEGs) played F1 | 0.447 (note F1 0.552: the hand rule silences 0.105) | **0.600** (0.6001; the engine alone normalised, same 6 pieces: 0.6001: nothing is lost between the engine and the app) | >= 0.60: met by 0.0001 (0.6001 against 0.60 on 6 files: inside noise, not a margin) |
| Czerny 599/10, clean, the page whose shortest value is a half note | note F1 0.587, 0 of 12 bars (every half note a quarter) | **1.000, 12 of 12** (engine alone and app path) | |
| the photo movements (s1 photo-A, engine alone, the helper keeps one file a page): note F1 | 0.539 (design document, GPU raster: 0.498) | 0.627 with every movement (design 0.616); **0.638** normalised | |
| s1 clean-A (engine alone), note F1 / bars exact | 0.846 / 169 of 267 (63.3 %) | **0.874 / 181 (67.8 %)** | |
| s1 photo-A (engine alone), played F1 / bars exact / parts ok | 0.430 / 65 (24.3 %) / 0.33 | **0.607 / 101 (37.8 %) / 0.73** | |
| s1 scan150-A (engine alone), note F1 / bars exact | 0.721 / 99 (37.1 %) | 0.749 / 107 (40.1 %) | |
| the other app path numbers (6 vector PDFs): bars exactly right | 58 of 83 (69.9 %) | **70 of 83 (84.3 %)** | |
| ... (6 photos): bars exactly right, parts ok | 22 of 83 (26.5 %), 0.33 | **34 of 83 (41.0 %)**, 0.67 | |
| the app's own suspect-bar flags (photos): recall | 0.200 | 0.292 (the flags themselves are unchanged: G12-3's work) | |
| speed (app path, a file) | 4.5-23 s | 5-23 s (the normaliser adds under 30 ms) | |

The engine-alone rows come from one run (`run --cases s1 --tiers clean-A,photo-A,scan150-A,brace-less --jobs 1`) and then the same engine files scored four ways (`--movements last`, as read,
`--divisions repair`, `--normalize`); the app rows from `run --mode app` and `run --mode app --omr v2`.

**Off-path identity.** (1) `PPP.omr = 'legacy'` is the default, and the three browser suites that import a scan, `import`, `import-and-persistence` and `pdf-layer`, give **byte-identical logs** (ports aside) run against this
tree and against `git archive f775bdd` served on another port (40, 8 and 52 checks; the one failure each of the first two makes, a 401 on `/api/worker/status`, is the same on `main`: it is how that server answers a guest). (2) The
legacy app path through the real helper and Audiveris: `run --mode app --check` PASSES against the committed `audiveris-5.11.0.app.json` (130 checks), and the 730 numbers of the run's
aggregates and per-case metrics equal the baseline's exactly. (3) The helper's `musicxml` field is the line it was (a test reads the source for it; the legacy run above goes through it). (4) A legacy page never asks
for `omr/normalize.js` and the helper's `movements` are ignored (browser suite). (5) `omr/normalize.js` is not in the page's script list.

**Beyond the s1 pages: all 60 excerpts**, G12-0's own engine files re-read with `run --normalize` (the sha-256 of each page image equals the one in its engine record, for all the 65 (A) or 67 (B) pages of each tier; every clean and photo file
of s1 that I re-ran here is identical in text to G12-0's, and 16 of 17 scan150 files; the 17th, `method_burgmuller25_003`, differs in two notes' dots: see Findings), pooled over all 60 excerpts: **this is not a held-out measurement** (the held-out half is 18 of the 60 excerpts, 30 %, and is not reported apart); `scan150-B` (PPP's own print at 150 DPI, which the engine refuses) is not in the table.

| tier (60 excerpts) | note F1 | played F1 | bars exactly right | parts ok |
| --- | --- | --- | --- | --- |
| clean-A | 0.877 -> 0.891 | 0.870 -> 0.891 | 815/1169 (69.7 %) -> 857/1169 (73.3 %) | 0.98 -> 1.00 |
| clean-B | 0.888 -> 0.902 | 0.815 -> 0.902 | 685/1169 (58.6 %) -> 883/1169 (75.5 %) | 0.77 -> 0.98 |
| scan150-A | 0.793 -> 0.807 | 0.793 -> 0.807 | 518/1169 (44.3 %) -> 544/1169 (46.5 %) | 0.97 -> 1.00 |
| scan200-A | 0.876 -> 0.890 | 0.871 -> 0.890 | 807/1169 (69.0 %) -> 850/1169 (72.7 %) | 0.98 -> 1.00 |
| scan200-B | 0.835 -> 0.848 | 0.668 -> 0.848 | 471/1169 (40.3 %) -> 752/1169 (64.3 %) | 0.42 -> 0.95 |
| photo-A | 0.547 -> 0.712 | 0.402 -> 0.691 | 152/1169 (13.0 %) -> 472/1169 (40.4 %) | 0.37 -> 0.85 |
| photo-B | 0.830 -> 0.842 | 0.798 -> 0.842 | 432/1169 (37.0 %) -> 560/1169 (47.9 %) | 0.85 -> 0.98 |
| scan (150-A, 200-A, 200-B) | 0.835 -> 0.848 | 0.777 -> 0.848 | 1796/3507 (51.2 %) -> 2146/3507 (61.2 %) | 0.79 -> 0.98 |
| **photo** (A + B) | 0.688 -> 0.777 | 0.600 -> 0.767 | 584/2338 (25.0 %) -> 1032/2338 (44.1 %) | 0.61 -> 0.92 |

("the helper today" -> `omr/normalize.js`: one file a page as the local helper keeps it, `<divisions>` 0 read as 1, the app's hand rule; then the normaliser.) The weakest tier of the design, photos, goes from 0.600 to 0.767
played F1 and from 25 % to 44 % of bars exactly right; PPP's own print (clean-B, scan200-B), whose parts the engine splits more often, gains the most (played F1 0.815 -> 0.902, 0.668 -> 0.848).

**Findings and limits.**
- The two numbers the design called one (K3, "engine 0.62 vs app 0.41 on photos") are three: the movements the helper dropped (note F1 0.688 -> 0.776 on the 120 photo pages), the staves the hand rule silenced (played F1 0.644 -> 0.767), and the
  parts structure (bars exactly right 28.5 % -> 44.1 %). The photo tier is still far from the clean tier (0.777 note F1, 44 % of bars): what is left is the engine's (G12-6).
- A lone staff stays a lone staff: 4 of the 294 reads are movements of one staff each (the engine read half a system); `normalize` does not invent the other staff.
- 15 of the 415 normalised files the ScoreGraph importer refuses (`E-DURATION`: a note of length 0 that Audiveris wrote; 4 such notes in each raw file, 2 after the normaliser): G12-2's problem, not this module's. (Section 22: they were 3 files of that kind and 12 more with a hairpin the engine wrote to end where it starts; both are mended in the normaliser now, 15 -> 0.)
- Not done: the layout evidence (`PdfLayer.layout`'s bar lines per page) is accepted by `normalize` (`opts.pageBars`; a page whose bar count differs is reported and its bars flagged `bar-count`, tested) but the page does not pass it yet: it is a flag
  signal and goes in with G12-3. The hand rule of `scoregraph/legacy-score.js` (the graph path, not used by OMR yet) is untouched: G12-2 moves OMR onto it. `report.normalize` is not saved with the song and not shown on a screen.
- **The PC was not quiet** (Unity and other sessions' jobs: the load averaged 60-70 % and never fell below 25 % in the 40 minutes I waited): the runs were made at below-normal priority, one page at a time, with Audiveris's step limit raised
  as the tool does; no page timed out and the outputs match G12-0's (above) except one page. That page, `method_burgmuller25_003` scan150-A p1, differs from G12-0's file for the same image (same sha-256; two notes of staff 2 are
  plain quarters, duration 6, here and dotted quarters, duration 9, there; one bar of 267, 99 vs 100 in s1 scan150-A). I re-ran it on the PC once it had gone quiet (mean load 23 % before the runs), at below-normal priority, one at a
  time: twice under its own name and twice on a copy named `scan-p1.jpg` as in G12-0; all four raw `.mxl` files are identical to each other and to my earlier run under load, and differ from G12-0's. So it is not load and not the file
  name, and since the files compared are the engine's own output it is not the normaliser. This page's output differs from G12-0's for the same image, stable over four quiet runs here; the cause is unknown (no Audiveris
  setting or version change is known to me; I am not guessing).
- Held-out discipline, said plainly: the groups-and-per-bar-source rule was shaped by a structure census over **all 480 files, held-out reads included**, and by looking at the bar-by-bar structure of two held-out excerpts
  (`i-know-whom`, `all-creatures`) while the shapes were understood, before any threshold existed. No number in this section is therefore a clean held-out result: the 60-excerpt table is pooled, the s1 and app rows are
  small samples (15 pages, 6 files). The one threshold, `OVERLAP_MAX` 0.25, was not tuned: no bar is shared in the tuning half at all, so any value from 0.05 to 0.5 gives the same output on it.
- The photo gate (played F1 >= 0.60) is met by 0.0001 (0.6001) on 6 files. That is inside noise: it says nothing is lost between the engine and the app (the engine alone, normalised, gives the same 0.6001), not that photos are good.
  What photos get is the 60-excerpt number above (0.767 played F1, 44 % of bars exactly right), and that is pooled.
- The browser suite (`test:omr-app`) is not in the gate: the gate has no browser shard (its jobs have no `npm install`); the only browser jobs of the workflow are the practice jobs and the nightly ones, which run `npm ci` and
  download Chrome before they run a suite (not measured here; a minute or more, not the 15 s a step of a shard may add). It stays a local suite; the normaliser itself, which is where the logic is, is in the gate.

**Known limits (the independent review's minor findings that are not fixed in G12-1; stated plainly).**
- `foldSystems` (`omr/normalize.js`) folds a REAL single-staff piece whose clef alternates G and F from one system to the next, with equal lengths in each pair, into a grand staff of half the bars. The signature is the
  PDF's, and a pitch-range check (the F-clef systems sitting below the G-clef ones) would tell the two apart; there is none.
- A movement that holds only rests and is read as two or more parts adds a phantom empty column to the output (the "parts kept" path writes every part, and the join pads the shorter movements with empty bars). Harmless
  to the notes; the part list is longer than the music.
- A `<divisions>` that changes in the MIDDLE of a part re-times the notes after it without a flag: the repair and the scaling read the divisions in force at the start of each bar. Audiveris does not write this.
- Pair detection looks at the upper part's clef (G) and the bar counts, not at the lower part's clef: two one-staff parts with a G clef over a G clef (a violin duet) are merged as one "Piano" when no other group shares
  their bars.
- The helper's answer repeats the XML for a page it did not split (`musicxml` and `movements[0]`): up to twice the size for single-movement pages.
- A `parts-fragmented` result (groups that share bars, left as parts) gets its hands by staff position under `'v2'`: the top staff right, every other staff left, not by clef or pitch range.

**Review round (PR #237, verdict: merge).** Fixed: `Import.omrXml` falls back on any throw and `normalize()` never throws (a document nested 20,000 deep overflows the stack: `ok: false`, `internal-error`;
`report.normalizeFailed` says why); `omr/helper-output.js` is an optional `require` in `omr-service.js` (the service starts and answers as before without it); rich scenarios, the invariant test and the mutants
`MUT-CURSOR-COUNTS-CHORD` (the reviewer's), `-IGNORES-FORWARD`, `-IGNORES-BACKUP`, `MUT-FORWARD-UNSCALED`, `MUT-TIE-LOST`, `MUT-GRACE-LOST`, `MUT-NORMALIZE-THROWS`; the idempotence test compared a list with itself and now
asserts that the second pass reports no change.

**Decisions of the Lead's kind taken here (reversible).** Groups and per-bar sources instead of pairwise merging (above); a pair needs a G clef on the upper part and bar counts within one; a lone one-staff group may be part of a merge
but a one-staff part that shares bars with another group makes the movement "several parts"; `OVERLAP_MAX` 0.25; the divisions repair reads the value most notes agree on (at least half of them; dotted notes, tuplets, grace notes and notes
without a type are not read) and scales durations to whole numbers, and the whole document gets the common multiple of its parts' divisions; the output is one part named "Piano" per column, bars renumbered 1..N, the first file's header
kept (so the page still knows the notation came from the engine); the hand rule changes only for an engine file with several parts and none of two staves; the helper's new field is additive.

## 22. G12-2 implementation record (Implementer, Sonnet, 2026-10-08)

Branch `g12-2-s4` (`D:/PPP-g12p2`), from `main` `9c4e32f` (G12-1 merged), `origin/main` merged in at `296f50b` (MX-3 removed `LEGACY_IMPORT`; G13-2; G10d). Row G12-2 of section 11, gate A2 of section 12. Everything is behind `PPP.omr = 'v2'`;
with the default `'legacy'` the page does what it did (proof below). `tests/omr/README.md` has the commands.

**Built.**

| What | Where |
| --- | --- |
| `Import.omrS4` (v2 only): the normalised document through `importToGraph` (`scoregraph/import.js`, the door a MusicXML file uses); `omr/apply.js` `markOmr`; `PdfLayer.apply` on a **scratch copy** of the Score (`toScore(graph, {ids: true})` + `Score.finalize`, never the Score kept); `apply.diff(before, after)` reads what it changed; `apply.apply` makes those findings graph edits; the Score the app keeps is `toScore` of the edited graph. The graph is remembered with it (`engraveRemember(score, graph, 'omr')`: the song's graph is kept, persisted on save like any import) and returned as `result.graph`. `source.importReport` is the graph import's report (as for a MusicXML file), `report.graph` what the page's lines changed (counts, what was skipped and why, what the edits took away - `removed`: events with their pitches and bar, chord names, marks - and what the work cost - `work`: validations and milliseconds), `report.normalize` the normaliser's. The three places that parsed (the first pass, the 1.17x second-opinion pass, the merged pass) all go through it. Anything that fails (apply.js not fetched, the graph importer refuses, a page that cannot give its layers - they are asked for inside the fallback - PdfLayer throws) leaves G12-1's v2 import and says why: `report.graphFailed` / `report.graph.error`. A method, a loader and six small hunks in the app file | `Piano Coach App.dc.html` |
| `omr/apply.js` (UMD, pure): `diff`, `apply`, `ops.{setPitch, dropEvent, moveEvent, markArpeggio, addOttava, addChord, removeChord, addMark, removeMark, setHeading}`, `markOmr`, `count`. All findings in one `ops.edit` transaction (one validation). **An edit that cannot be made - a NaN, an Infinity, a null, a missing field, a note that is not there, whatever its handler throws - is that edit's refusal, named in `skipped` with its reason, and the others go on in the same transaction** (the inputs are checked first: a pitch has a letter, a whole octave and a whole alteration; a place is a finite number or a rational). When the validator refuses the whole graph, the entries its issues name are taken out and tried again without them, then each alone on the result (a valid edit that stood beside an invalid one is still made); when the issues name no entry the list is halved. **The work is bounded**: once something has been refused, at most 64 validations and 400 ms; what is then unresolved is refused with the reason `budget`, never applied unchecked (the first try is free). Applying findings already true changes nothing and returns the same graph; beams and tuplets over events only some of which moved are retired; a dynamic that belongs to a moved note moves with it; an 8va ends where its last note ends (PdfLayer's `+0.001` quarter is not written into the graph). **Provenance, exactly**: a head whose pitch or accidental changed carries `prov.asp.pitch` / `.spelling`, an event that moved `prov.asp.rhythm`, a new arpeggio, 8va or chord name `prov` - each `{src: omr / pdflayer, op: 'inferred'}`; the schema has no provenance field for a jump, a tempo, the title or the composer, so those edits carry none (the result counts them); a note, chord name or mark the page took away leaves no entity, so the result lists them (`removed`: counts, and the first 100 with bar, place and pitches) | `omr/apply.js` |
| the hand rule of the graph path: `toScore` reads `g.ext['ppp.omr'].hands === 'by-staff'` (registered in `scoregraph/README.md`) and then, when no part has two staves, plays the top staff right and every other left. Any other graph has no such mark: the line is dead for it. `ratQ`, `chordFromText`, `chordText` are exported (apply writes by the rules fromScore/toScore use). The page asks `legacy-score.js?v=11` (was 10; the server caches static files for an hour). The library version (`1.3.2`) is not bumped: no existing caller's output changes (see the proof), and `audio-score.js` (the recording path) names the version it needs | `scoregraph/legacy-score.js` |
| the normaliser repairs what the importer refused (below) | `omr/normalize.js` (`VERSION` 2, the page asks `?v=2`) |
| `run --mode app --omr v2 --replay`: no helper, no engine; the page is told what Audiveris wrote in an earlier engine-alone run (`out/engine`), so two trees' pages (`git archive` of main on one port, this tree on another, `--base-url`) are compared on the same engine output; rows carry whether the engraver's graph is the import's (`via`, `agree`), what the graph import reported, what v2 skipped | `tests/bench/node/omr-live.js`, `tests/omr/omrbench/appmode.py` |
| `node tests/omr/node/s4-stats.js --check`: every engine document through the normaliser and the importer, no browser: refusals by code, repairs, beams (xml / graph / drawn by `engrave/plan.js`) | `tests/omr/node/s4-stats.js` |
| 83 Node tests (`npm run test:omr-apply`, a step of the gate in `shard-g`: **75 steps**): 28 scenarios in which the Score made again from the edited graph must be the Score the stand-in for PdfLayer makes (written without a line of the module), each edit alone, JSON findings, refusals (NaN / Infinity / null items in every group; 100 findings with 5 refusals; the budget; what was removed), and 43 mutants; the normaliser's suite is 143 tests (10 new scenarios, 30 new mutants, an invariant that **every bar of every scenario ends where its time signature says**, explicit tests for the importer's refusal before and acceptance after) | `tests/omr/apply/`, `tests/omr/normalize/` |
| the browser suite (`npm run test:omr-apply-app`, local): the differential on a hand-written PDF that exercises every finding PdfLayer makes (a phantom note read from an arpeggio line, the arpeggio, a flat not read, a voice started late, chord names incl. `Cm/Eb`, segno / coda / jump words, an 8va, title, composer, tempo): legacy Score = v2 Score on notes, pitches, accidentals, arpeggios, hands, chords, marks, 8va brackets and the notes under them, heading; `PdfLayer.apply` saw the same page (same counts); the graph is `via: live`, `agree`; legacy asks for neither `omr/` file; beams; the failure paths | `tests/omr-apply-app.test.js`, `tests/omr-apply-fixture.js` |

**The 15 refusals were not what G12-1 said.** Section 21 called them "`E-DURATION`: a note of length 0". Of the 15 documents the importer refused, **3** are that and **12** are another thing:

| | documents | what it is | the repair, in `omr/normalize.js` |
| --- | --- | --- | --- |
| `E-DURATION` | 3 (`hymns_i-know-that-my-redeemer`, `hymns_jesus-shall-reign`, `hymns_when-i-survey`, photo-A) | Audiveris writes `<rest measure="yes"/><duration>0</duration>` for the whole-bar rest of a bar it read nothing in. In all 480 raw files: 12 such notes in 3 files, all whole-bar rests, **no pitched note** | a whole-bar rest lasts the bar of the time signature in force (beats x 4 / beat-type quarters, a whole number of divisions); any other zero-length note with a plain `<type>` (no dot, no tuplet) lasts its type; a zero with neither is left, counted (`zeroRestsLeft` / `zeroNotesLeft`) and flagged `duration-zero`: never guessed, never dropped. **A rest of length 0 had not moved the cursor, so what follows it in the bar - the other staff's whole-bar rest, written with no `<backup>` between - began where it began: a repaired whole-bar rest that is followed by other content gets a `<backup>` of its own length** (below). A whole-bar rest followed by a note of its own voice and staff (a bar read as empty and as full at once) is not repaired (`zeroRestsRefused`): the importer then refuses the document by name. 6 rests repaired in the 3 documents (flag `duration-repaired`), counted apart for rests (`zeroRestsRepaired`) and for pitched notes (`zeroNotesRepaired`: none), with the `<backup>`s counted (`zeroRestBackups`: 3) |
| `E-SPAN-ORDER` (a wedge that ends at or before its start) | 12 (`method_burgmuller25_003` x4 tiers, `method_czerny849_022` x7, `method_sonatina_027` x1) | a crescendo and a diminuendo that meet are written start, start, stop, stop with no note between the middle two: the middle pair ends where it starts | in a part with such a pair the normaliser simulates the importer's pairing (a start while one of that number is open drops it; a stop with none open and a start never stopped are dropped; a stop at or before its start is invalid) and removes every wedge that does not make a pair of positive length (the importer drops the unpaired ones itself; a degenerate pair removed alone would let its neighbour pair with a later stop: a mark the page does not show). **68 hairpin marks in 12 documents (17 degenerate pairs)** are removed, counted (`wedgesDropped`, `wedgesDegenerate`), flagged `wedge-dropped`, reported in `report.normalize`. A hairpin is a mark, never a note |

**A defect found by the independent review of this PR, and fixed (M1).** The first version of the repair gave each zero-length whole-bar rest the full bar and no `<backup>`. In all three repaired documents the rests are `rest(0, voice 1, staff 1)` `rest(0, voice 5, staff 2)` in one part with nothing between them; with a length the second began where the first ended, so **the bar was twice as long** (the graph's measures `1,2,1,...`, the Score's bar `lenQ` 8 in 2/2) **and every later bar played one bar late** - worse than the legacy reader, which falls back on the nominal length of a bar of zero. Nothing I had caught it: the multiset invariant counts sounding notes by their onset *in the bar* and skips rests, the metrics (`omr.*`) index bars by position, and my importer-level test only asked that both rests last '1'. Now: the `<backup>`, the withdrawal for a rest with notes in its own voice, scenarios and probes that assert each bar's end, an invariant over **all** scenarios that every bar ends where its time signature says (4/4, 2/2, 6/8, 3/4 with two empty staves among them), and mutants that drop the `<backup>`, give it the wrong length or write it where nothing follows. On the 417 documents (`s4-stats`, graph measure = the meter in force, the last bar of a document apart): the three repaired documents' bars `1,2,1,1,...` (two of them) and `1,1,1,2,...` (one) become `1,1,1,1,...`; of the 21 bars the normaliser repaired, **18 agreed with their meter before, 21 agree now**; over all documents 6,276 of 7,316 bars agreed before and **6,279 now (85.8 %)**. The other 1,037 bars (183 documents) are Audiveris' own misreadings (a bar whose content is short or long), the same kind the legacy reader has; they are not the normaliser's and not checked by `--check`, which fails only when a bar the normaliser repaired disagrees. At the Score level (the 390 replayed files, bars not last whose `lenQ` differs from the time signature): the legacy path 829 of 6,789 (12.21 %), the first draft of this repair 837, **the fixed one 834**; the three doubled bars are gone and the remaining difference of 5 bars is in two photos (`method_burgmuller25_015`, `method_hanon_002`) whose overfull bars the graph keeps as long as their content and the legacy Score keeps at the nominal length: a misreading, now one bar longer in v2 than in legacy.

The sounding notes of all 417 documents are identical before and after the repair (the multiset of pitch, onset, duration, tie, chord, grace, checked against the G12-1 module over every engine file; and the invariant test of G12-1 passes unchanged: it counts sounding notes, and the only note whose length the new rule may change is a pitched one with no length, which has its own test and its own count). 417 documents, not the 415 of section 21: this tool also counts the 2 brace-less ones.

**A2, clause by clause.**

| clause (section 12) | before (G12-1, `origin/main` `296f50b`, `'v2'`) | after (`'v2'`) | gate |
| --- | --- | --- | --- |
| the ScoreGraph importer refuses (417 documents through `normalize` -> `importFile`) | **15** (3 `E-DURATION`, 12 `E-SPAN-ORDER`) | **0** | 15 -> 0: met |
| a pitched note lost in the repair | - | none (417 of 417 identical sounding notes) | |
| the bars of the graph as long as their meter (417 documents, `s4-stats`; the last bar of a document apart) | 6,276 of 7,316 (the repaired documents: a doubled bar each; bars the normaliser repaired: 18 of 21) | **6,279 of 7,316; bars the normaliser repaired 21 of 21**; the rest are the engine's misreadings | added by the review (M1) |
| every import's graph agrees with its Score, no projected fallback (`PPPEngrave.app.resolveSync(score).via === 'live'`), replay of **390 files**, all 60 excerpts, the app tiers | pdf-A 31 of 60, pdf-B 30 of 59, photo-A 8 of 55, photo-B 11 of 53, scan150-A 13 of 55, scan200-A 26 of 55, scan200-B 21 of 51, brace-less 2 of 2 | **60/60, 59/59, 55/55, 53/53, 55/55, 55/55, 51/51, 2/2** (every one `live`, `agree.ok`, the import's own graph) | clean-A/B: met |
| ... with the real engine and helper (s1-app: 6 vector PDFs, 6 photos, 4 brace-less) | 11 of 16 (PDFs 5 of 6, photos 2 of 6, fixtures 4 of 4) | **16 of 16** | |
| beams drawn on >= 95 % of the notes Audiveris beamed (417 documents) | - (the legacy graph is the raw document's lazy one, or a projection: no beams when `projected`) | 38,780 notes beamed in the documents; **38,773 (99.98 %)** in a graph beam; **38,753 (99.93 %)** drawn from the graph by the engraver's plan; 34 more in beams across two staves, which the engraver defers (G4). Worst tier 99.84 % (scan200-A, 5124 of 5132) | >= 95 %: met |
| `omr.*` (app path, replay of 390 files, **all / tuning half / held-out half** of each tier) | note F1 / played F1 / bars exactly right, pooled: pdf-A 0.8840 / 0.8840 / 847 of 1169, pdf-B 0.9171 / 0.9171 / 883 of 1150, photo-A 0.7244 / 0.7077 / 440 of 1049, photo-B 0.8857 / 0.8857 / 538 of 1001, scan150-A 0.8283 / 0.8283 / 513, scan200-A 0.9137 / 0.9137 / 805, scan200-B 0.9310 / 0.9310 / 725, brace-less 1.000 | the same to the fourth place; **the worst change of any `omr.*` aggregate in any of the three subsets is -0.0004** (pdf-A, held-out half, note F1 0.9574 -> 0.9570), 0 deltas worse than -0.005 | not worse by more than 0.005: met |
| ... with the real engine (s1-app) | pdf-A: note F1 0.9558, 70 of 83 bars exactly right; photo-A: 0.6001, 34 of 83; brace-less (4 files): 0.9947, 30 of 32 | **identical** (every aggregate to the sixth place) | met |
| off-path identity | - | below | met |

(The replay's numbers for the six `s1-app` pieces match the real-engine run, 0.960 / 0.600 against 0.956 / 0.6001: the pages it replays were rasterised by Chrome from the SVG, the helper's by pdf.js from the PDF.)

What PdfLayer found on the 60 vector pages (pdf-A, Verovio): **306 findings on 16 of the 60 pages** (phantom notes, accidentals, late voices, 8va, chord names, marks, headings); **302 applied, 4 skipped, all in one piece** (`hymns_all-creatures`: PdfLayer's "voice started late" step moves the notes of one staff of a Score voice back, and in the graph that voice also holds an event of the other staff at the place they would land: `E-VOICE-OVERLAP`; the legacy Score tolerates two notes at one place in a voice, the graph does not). The four notes stay where the engine put them and `report.graph.skipped` says why. On the PPP-print pages (pdf-B) PdfLayer finds nothing (0 findings); photos and scans have no lines of their own.

**Off-path identity (`PPP.omr = 'legacy'` = `main`).** (1) The three browser suites that import a scan, `import`, `import-and-persistence` and `pdf-layer`, run against this tree and against a `git archive` of `origin/main` (`591c921`, after the last merge of main into this branch; the before/after tables above were made against `296f50b`) served on another port: **byte-identical logs, ports aside** (62, 14 and 70 lines; 40 + 8 + 52 checks pass; the one failure of `import` and the two of `import-and-persistence` are the same on `main`: a 401 on `/api/worker/status` as a guest). (2) The G12-1 browser suite `test:omr-app` (the switch, legacy, v2, an old helper, a normaliser that cannot be fetched) passes on this tree: v2 now goes through the graph and every check holds. (3) A legacy import asks for neither `omr/normalize.js` nor `omr/apply.js` (`test:omr-apply-app`), returns no `graph` key and no `report.graph`; the Score is `parseMusicXML`'s, as before. (4) The change in `scoregraph/legacy-score.js` is one early `return` guarded by a mark only `omr/apply.js` writes: `test:scoregraph` (229), `test:engrave` (207), `test:rec` (224 + 2 todo as before), the whole bench unit suite (623) pass. (5) `omr/apply.js` is not in the page's script list; the page fetches it when a v2 import needs it (`static-allow.js` serves it).

**What I measured under load.** The PC was not quiet (the load was 70-79 % from other sessions' jobs when the real-engine runs started). Audiveris and the page ran at below-normal priority, one page at a time; no page timed out and the outputs are those of the engine-alone run (the replay and the real runs agree). Per-file wall time of the real-engine app path: median 9.4 s before, 9.0 s after; max 22 s and 27 s. Timings below are from the same loaded machine and are upper bounds.

**Findings and limits, plainly.**
- **The cost on a phone is not small, and it is on the main thread.** 24 pages (400 bars, 4,588 notes) through `normalize` -> `importFile` -> `markOmr` -> `toScore` in Node on the loaded PC: 380-690 ms (normalise 60-130, import 270-540, mark 20-60, toScore 12-28); the importer's own validation is most of it. The independent review measured about 0.7-0.8 s per import at 4x CPU throttling (a phone) and an import runs up to three times for a flagged PDF (the first read, the second-opinion pass, the merged pass: up to roughly 2-2.5 s of work that blocks the UI). The budget of section 14 (300 ms for 24 pages on a desktop, 1 s at 4x) is **not shown to be met**; nothing is chunked or moved off the main thread in this phase (G12-4 or a worker). `markOmr` skips the second validation (`validate: false`; an `ext` namespace cannot make a valid graph invalid).
- **A refusal no longer costs log2 of the list.** Measured in Node on graphs of 24-80 bars (the review's workloads): 100 findings with 5 refusals 21 ms and 10 validations (was 1.3 s); 360 findings with 5 refusals in 60 bars 37 ms and 12 validations (500/5 was 2.8 s); 480 findings with 20 refusals in 80 bars 149 ms and 42 validations, all 20 refused named and the rest made (500/20 was 4.9 s); none refused: 7 ms, one validation. At 4x throttling the worst of these is about 0.6 s; the budget (64 validations, 400 ms after the first refusal) bounds what a pathological page can cost, at the price that what is unresolved when it runs out is refused as `budget` (valid edits included). A NaN, an Infinity or a null in a finding costs nothing but itself.
- **Overfull bars differ from the legacy Score.** An overfull bar (Audiveris read more notes than the metre holds) is as long as its content in the graph and has the nominal length in the legacy Score: 5 bars in 2 of the 390 replayed files (both photos); the later bars of such a file are placed later in v2. A short bar is the nominal length in both.
- **PdfLayer is still the finder.** It runs unchanged, on a scratch Score; `diff` turns its change into graph edits. A change PdfLayer makes that `diff` does not read (a field it does not compare) would be lost: the differential suite and the 60-excerpt replay compare the Score from the graph with the Score from the legacy path (notes, pitches, accidentals, arpeggios, hands, chords, marks, 8va, heading) and find none. Two Score-only things have no graph form and are skipped or approximated, named: an arpeggio mark on a single note (the graph's arpeggio needs two heads: skipped, `an arpeggio needs two notes`), and the tempo (written as a `TempoEvent` at the first bar: the Score gets a `tempos` entry the legacy Score lacks, with the same value).
- **A voice PdfLayer realigns across staves is refused** (the 4 findings above): the notes stay late, flagged in `report.graph.skipped`.
- **68 hairpin marks in 12 documents are removed**, not repaired: the engine's reading of a joined crescendo and diminuendo is not recoverable from the document. They are counted and flagged `wedge-dropped`, shown nowhere yet (`report.normalize`/`report.graph` are not saved with the song and not on a screen: G12-3/G12-4).
- **Not on the graph path**: the vector-PDF converter's document (`/pdf-vector`), the browser draft and the YouTube path keep their readers; `Import.validate` and the second-opinion merge still work on the XML and the Score (the flags are G12-3's). The second pass re-imports its candidate documents (up to three graph imports for a flagged PDF).
- **The `agree` acceptance is partly by construction**: the Score is `toScore(graph)`, so `agree` holds unless a later step changes one without the other. What it excludes is the old failure (the lazy graph from the raw document disagreeing with a Score PdfLayer had patched, then a projection without beams): 11 of 16 and, over the replay, about half of the imports used to be projected. The ops of G12-4 must keep it (A4).
- **Held-out discipline.** The tuning and held-out halves are reported pooled by `omr-live-2` (the held-out half as a number only); no threshold was fitted: there is none in this phase. The `diff`/`apply` rules were written from the Score fields and checked against the hand-written page and the 60-excerpt replay, which includes the held-out half; **I looked at one held-out excerpt by itself**: `hymns_all-creatures` is in the held-out half (`cases.json`), and I opened its four skipped findings to learn why the graph refused them (above). Nothing was changed because of it: no rule, no threshold; the finding stands as a limit.

**Decisions of the Lead's kind taken here (reversible).** Hairpins that cannot pair are removed in the normaliser, not in the importer (the importer is shared by every MusicXML import and by the recording path; `scoregraph/` changed by one guarded line); the repair of a zero-length note by the bar's time signature (then the type, never a guess); `diff` against a scratch Score rather than a recorder inside `PdfLayer.apply` (no change to PdfLayer; `legacy` cannot move); findings are data (JSON), applied once per import, not per user edit; a refused edit is named and skipped, not forced; `markOmr` is the mark, in `ext` of the graph, not a flag the Score carries (so `agree`, the store and the renderer read one rule); a new gate step (`test:omr-apply`, 75 steps) rather than widening `test:omr-normalize`; `PPP.omr` untouched in meaning (still `'legacy'` by default); provenance only where the schema has a field for it, and what has none is counted and listed (`removed`, `applied`) rather than hidden in `ext`; a refusal is per edit, a budget is a reason, not a throw.
