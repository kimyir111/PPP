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

> **Built in G12-5 (section 24), with these differences from the paragraph below:** its own route `POST /api/jobs/omr`; one atomic upload (12 pages, 1.5 MB a page, 12 MB a job, 24 pages when asked); a result of up to 4 MB; quotas per link (2 scores, 16 MB of images), per creating address (16 MB, 12 an hour) and for the site (64 MB); a score nobody's PC takes expires after a day, a finished one is purged after a day, images are deleted the moment the job ends; and the kind is reachable only with a PC link's code, a job only by the token of its own link.

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

## 23. G12-3 implementation record (Implementer, Sonnet, 2026-10-13)

Branch `g12-3-flags` (`D:/PPP-g12p3`), from `main` `fb98439`, `origin/main` merged in after G12-2 (#246) landed. Row G12-3 of section 11, gate A3 of section 12. Everything is behind `PPP.omr = 'v2'`; with the default
`'legacy'` the page never asks for `omr/flags.js` (browser suite) and its report has no flag field. `tests/omr/README.md` has the commands.

**Built.**

| What | Where |
| --- | --- |
| `omr/flags.js` (UMD, pure, deterministic, never throws): `extract` (per bar, facts only: does each voice fill the bar, voices, registers, leaps, doubled pitches, off-key notes, ledger lines, how the page spaced simultaneous notes, notation-check classes 5-8, the engine's own system breaks), `derive` (what is relative: the piece's median and the neighbours'), `decide` (the rule), `analyze` (graph + `report.normalize` + optional layout + external flags -> per bar `{suspect, strong, weak, reasons}`), `confidenceOf`, `reasonText(reason, tx)`. 28 signals; `PARAMS` says which are strong, which weak, and every threshold | `omr/flags.js` |
| **the rule**: a bar is suspect when ANY strong signal fires or TWO weak ones. "This score was read badly as a whole" (more than 30 % of the bars of the import, all its pages together, carry a strong signal) and "next to a bar that carries one" are themselves weak signals, so on a badly read score one more doubt is enough. The confidence is `min(base, 0.84 - 0.6 x share of suspect bars)`, applied **whenever any bar is suspect, the validator's included** (the independent review found the first version capping it only when a flag had marked a bar: a validator-only suspect bar kept "good"); never 0.85 ("good") while any bar is suspect | `omr/flags.js` |
| the page: after a v2 import `report.suspectMeasures` gains the flagged bars (the strip's red bars and the count of the review screen are the existing mechanism), `report.flagCodes[measure]` the codes (**no sentence is kept**: the strip's tooltip and the issue lines make theirs from the codes when they are shown, in the language of the moment; a saved report asks for `omr/flags.js` when the review opens), `report.issues` one `{kind: 'flag'}` line per bar, `report.confidence`/`level`/`summary`/`advice` follow; the report is made by `mergeIntoReport` of the module (so it is tested in Node and mutated); `report.flagsVersion`, or `report.flagsFailed` and the import as v2 made it when `omr/flags.js` could not be fetched, or `report.flagsPartial` and an issue line when the notation checker could not (the module then runs without it and is not kept: `tuplet`, `value`, `sum-mismatch` and `same-note` are silent). The review's issue list shows 12 lines instead of 8 when bars were flagged, the bars on show first, and a line that says how many more the strip has. `flagCodes` are kept with the song (both save sites). `omr/flags.js` and the notation checker are fetched by a v2 import only; `static-allow.js` serves exactly those two files | `Piano Coach App.dc.html` (`loadOmrFlags`, `Import.omrFlags`, one call, two persisted fields, the strip's tooltip, `reviewIssueLines`), `static-allow.js` |
| 33 sentences in ko, ja, zh (the 30 reasons, "Measure {{n}}: {{why}}", "{{n}} more measures are marked on the strip above.", and the partial-run line); `tests/i18n/gaps.js --check` stays at 0 | `i18n/*.json` |
| the dataset and the fit: `omr-live-2 flags-data` (every output bar of a RECORDED engine run, its signals, whether it is wrong and why; tuning and held-out halves in separate files), `tests/omr/node/flags-fit.js` (`table`, `fit`, `eval`, `record-held`), `tests/omr/flags/flags-fit.json` (the record) | `tests/omr/omrbench/flagdata.py`, `tests/omr/node/flags-cli.js`, `flags-fit.js` |
| 136 Node tests, a step of the gate in `shard-g` (`npm run test:omr-flags`: **76 steps**): a case for every signal (it fires on one named bar and on no other), the same music without the fault, pickups, the rule, the page and next-to signals, outside flags, the confidence, the sentences, "never throws", the module without the notation checker (the four signals built on it go quiet and every other stands), eight catalogue scores fed back (at most one flag in twenty bars), the parameters against the record and against the judged parameters; the boundaries the first suite did not pin (the order of reasons, the bad-score threshold, the `x-misaligned` threshold, the `sparse` window, the ledger offset, chords and grace notes), the small-score cliff, and the report merge (a validator-only suspect bar is capped); and **107 mutants** of the module (and a control): each signal replaced by "never fires", and each line of the extraction, the rule, the confidence, the report merge broken once, each caught by a named case or check | `tests/omr/flags/` |
| the browser suite (`npm run test:omr-flags-app`, local): legacy asks for none of the files and has no flag field; v2 on a clean page marks nothing; a short bar is marked with its code, joins the issue list (as text) and the strip (red, tooltip made from the code), the confidence is below 0.85; **a page whose only suspect bar is the validator's is capped too (legacy's is not)**; 13 short bars of 40 give twelve lines, the bars on show first, and the count of the rest; a saved report with codes only gets its sentences once the module has been fetched; the sentences are Korean in ko; the song slot keeps the codes and no sentence; the module in the page has the repository's parameters and the checker loaded before it; a checker that cannot be fetched is said (`flagsPartial`, an issue line) and the module is not kept; a page that cannot get `omr/flags.js` is v2's import and says why | `tests/omr-flags-app.test.js` |

**How it was fitted and judged (section 8.2).** The 60 excerpts of `omr-live-2`: 42 tuning, 18 held out (`cases.json`); engine output recorded by G12-0 (`out/engine`, 480 reads, 417 of them importable before G12-2's repairs and **all of them
after**: the dataset is the engine's files through `omr/normalize.js` as G12-2 leaves it, then the ScoreGraph importer, then `omr/flags.js`). The label of a bar is the benchmark's own: an output bar is wrong unless it aligns to a truth bar
it reproduces exactly (`omr.bar_exact`). 5,475 bars of the tuning half (clean 1,609, scan 2,404, photo 1,462; 2,254 of them wrong), 2,314 of the held-out half (clean 682, scan 1,003, photo 629; 617 wrong); `scan150-B` reads nothing and is not in it.
Truth files fed back as if recognised: the 60 catalogue excerpts (1,169 bars; 825 and 344 by half).

1. **Signals are measured one by one** on the tuning half (`flags-fit.js table`, the table below, also in the record).
2. **Strong by a statistic**: right at least 85 % of the time, fires at least 25 times, at most 0.15 times in 20 bars of truth files. **Strong by what it is** (the importer or the normaliser says content was lost): overlap in a voice, a bar the
   normaliser dropped notes from, a length it could not work out. Nothing else is strong.
3. **The weak set and the thresholds**: start with every other signal weak at its default threshold; move one thing at a time (drop one, add one back, change one threshold from a small grid) while the objective improves, then drop what costs nothing.
   The objective is, in order: precision at least 0.65 on every tier and at most 0.9 flags in 20 bars of truth files (the gate says 0.60 and 1.0: the margin is for the other half), then the weakest tier's recall against its target (0.90 clean and
   scan, 0.85 photo) up to 4 % above it, then precision. Five-fold cross-validation by case inside the tuning half says how much of it is luck.
4. **The held-out half was judged once**, by `flags-fit.js eval --half held` (which refuses a second time and keeps a mark), with the parameters of the commit before it. Nothing was changed after it for its sake. The judged
   parameters and the sha-256 of `omr/flags.js` at that commit (`6acccca`) are stored with the numbers in `tests/omr/flags/flags-fit.json` (`heldOut`), and a test holds `PARAMS` to them: the one difference is `page-bars` leaving the strong list (below), and the test names it.
   **The held-out half is not pristine**: G12-0 to G12-2 quoted it pooled, in aggregates (never excerpt by excerpt), and G12-2 opened one held-out excerpt by itself (`hymns_all-creatures`, section 22) to learn why the graph refused four findings. "Judged once"
   applies to THIS rule: its parameters were fixed on the tuning half, and the held-out half was judged with them once.

| signal | what | role | n (tune) | precision | truth files /20 bars |
| --- | --- | --- | --- | --- | --- |
| `fill-short` | a voice does not fill its bar (a hole, or it ends early) | strong | 1650 | 0.94 | 0.10 |
| `fill-over` | a voice runs past the bar, or the bar is longer than its metre | strong | 974 | 1.00 | 0.00 |
| `fill-overlap` | two notes of one voice overlap | strong (design) | 0 | - | 0.00 |
| `empty-staff` | a hand has nothing in the bar | strong | 171 | 0.90 | 0.00 |
| `many-voices` | three or more voices on a staff | strong | 706 | 1.00 | 0.00 |
| `tuplet` | notation-check class 7 | strong | 57 | 1.00 | 0.00 |
| `x-misaligned` | two notes that start together are 20 or more tenths apart on the page (the engine's `default-x`) | strong | 662 | 0.99 | 0.00 (truth files carry no x: vacuous) |
| `fragmented` | the normaliser could not join the parts | strong | 36 | 1.00 | 0.00 |
| `dropped`, `unreadable-lengths` | the normaliser dropped notes / could not work out a length | strong (design) | 0 | - | 0.00 |
| `hands-cross` | the right hand's lowest note is below the left hand's highest | weak | 291 | 0.60 | 0.61 |
| `big-leap` | 19 semitones or more between two notes of a voice | weak | 154 | 0.67 | 0.27 |
| `sparse` | at most 0.6 of the notes of the bars around it | weak | 530 | 0.43 | 1.72 |
| `voice-loss` | fewer voices than the piece's usual | weak | 648 | 0.73 | 0.92 |
| `rebuilt` | the normaliser merged two staves or folded a pair of systems into it | weak | 646 | 0.46 | 0.00 |
| `bad-page`, `next-to-bad` | the score's (all pages of the import together), and the neighbours', strong signals | weak | - | - | - |
| not used: `value` (class 6), `sum-mismatch` (class 5), `same-note` (class 8), `dense`, `dup-pitch`, `off-key`, `ledger`, `switched`, `repaired`, `joined` | | | | 0.19-0.89 | 0.00-2.79 |
| not used: `page-bars` (the page shows N bars on this line) | | none | | 0.18-0.35 | |

Class 5 alone is right 0.89 of the time (recall 0.74-0.85) but adds nothing to `fill-short` / `fill-over`, which find the same bars with the pickup handled, and fires 0.56 times in 20 bars of correct music (a measure rest without a drawn value, a
voice with a value the checker does not know). Class 6 and 8: 0.70 / 0.37, no use. `dup-pitch` is right 0.83 of the time on photos and 0.43 on clean pages, because a unison in two voices is correct music (2.79 flags in 20 bars of truth files).

**Results (precision and recall of "this bar is wrong", pooled over the tier's bars; `scan` is scan150-A, scan200-A, scan200-B and scan150-B (which reads nothing); `photo` is photo-A and photo-B).**

| | tuning half (fit) | tuning half, 5-fold cross-validation | **held-out half, once** | gate A3 |
| --- | --- | --- | --- | --- |
| clean | recall **0.929**, precision 0.732 (434 of 467 wrong bars, 593 flagged) | 0.908 / 0.707 | recall **0.929**, precision **0.595** (78 of 84, 131 flagged of 682 bars) | recall >= 0.90, precision >= 0.60 |
| scan | recall **0.929**, precision 0.708 (922 of 992, 1,302 flagged) | 0.921 / 0.676 | recall **0.933**, precision **0.664** (251 of 269, 378 flagged of 1,003) | recall >= 0.90, precision >= 0.60 |
| photo | recall **0.908**, precision 0.694 (722 of 795, 1,040 flagged) | 0.883 / 0.682 | recall **0.852**, precision **0.628** (225 of 264, 358 flagged of 629) | recall >= 0.85 |
| truth files, flags per 20 bars | 0.53 (22 in 825 bars) | 0.65 | 0.06 (1 in 344 bars); all 1,169 bars: 23, **0.39** | <= 1 |
| the app's own flags before (G12-2 replay, tuning half, app path) | recall 0.41-0.46, precision 0.92-0.95 | | | |

**Through the page (the app path, replayed: `run --mode app --omr v2 --replay`, the page's own `Import.load`, PdfLayer and `omr/apply.js` on the recorded engine output; one rendering of each excerpt per tier, `pdf` = the vector PDF; the labels are the
played Score's bars, so the hand rule and PdfLayer's edits are in them).** The suspect bars are the report's `suspectMeasures`: the validator's (empty, overfull, under half full, "the page shows more notes") and the flags'.

| tier | tuning half: recall / precision (wrong bars) | held-out half, once: recall / precision (wrong bars) | the same before G12-3 (G12-2 replay), tuning / held-out |
| --- | --- | --- | --- |
| pdf-A (Verovio) | 0.894 / 0.756 (264) | 0.867 / 0.684 (45 of 344) | 0.458 / 0.945 ; 0.067 / 0.429 |
| pdf-B (PPP's print) | 0.972 / 0.707 (211) | 0.951 / 0.488 (41 of 344) | 0.536 / 0.950 ; 0.049 / 0.333 |
| pdf-A + pdf-B (clean) | 0.928 / 0.733 | **0.907 / 0.569** (86 wrong) | |
| scan200-A (200 DPI scan) | 0.848 / 0.671 (178) | **0.865 / 0.662** (52 of 344) | 0.438 / 0.918 ; 0.173 / 0.692 |
| photo-A (synthetic photo) | 0.878 / 0.619 (294) | **0.900 / 0.542** (100 of 344) | 0.408 / 0.930 ; 0.250 / 0.926 |

The flags raise the share of wrong bars the review marks from 0.41-0.54 to 0.85-0.97 (tuning half) and from 0.07-0.25 to 0.87-0.95 (held-out half: the validator's own rules flagged 6 to 27 bars of 344). They cost precision: PPP's print on the
held-out half is flagged 80 times for 41 wrong bars (0.49), the photos 166 times for 100 (0.54). Two things make the page numbers differ from the engine-alone ones above: the Score the page plays has PdfLayer's edits and the hand rule (bars the engine
read right can be wrong in the Score, and the other way), and one rendering per piece is a small, uneven draw (18 pieces, 41-100 wrong bars a tier). **On the page, the gate's precision (0.60) is not met on held-out clean-B (0.49) or photo (0.54), and the recall of clean-A and
scan is 0.87 (0.90 asked).** These numbers were not fitted for; the page was measured with the parameters of the engine-alone fit, after it was frozen, on the tuning half first and on the held-out half once, and nothing was changed afterwards.


**A3 is not met as written.** Engine-alone, held-out (18 pieces, 2,314 bars): scan met (R 0.933 / P 0.664); clean R 0.929 but P 0.595 < 0.60 (one bar: 79 of 131 would pass); photo R 0.852 passes by one bar (225 of 264; 224 would be 0.848) at P 0.628; truth
files 0.06 flags per 20 bars held out, 0.39 over all 60. Through the page, judged once: clean 0.907 / 0.569, scan 0.865 / 0.662, photo 0.900 / 0.542, so scan recall and clean and photo precision miss on the path the user gets.

**A3, clause by clause.**

| clause | result |
| --- | --- |
| recall >= 0.90 at precision >= 0.60, clean | recall 0.929 **met**; precision **0.595 on the held-out half: 0.005 under the line, one bar (79 of 131 would pass), not met** (0.732 on the tuning half, 0.707 cross-validated: the held-out clean excerpts are better read, 12 % of their bars wrong against 29 %, and precision falls with the base rate). 78 true flags in 131; a different draw of the same size moves it by about 0.04 |
| recall >= 0.90 at precision >= 0.60, scan | recall 0.933, precision 0.664: **met** |
| recall >= 0.85, photo (held-out) | recall 0.852, precision 0.628: **met by one bar** (225 of 264; 224 would be 0.848: inside noise, not a margin) |
| <= 1 flag per 20 bars on truth files | 0.39 over all 60 excerpts (0.06 held out): **met** (32 of the 42 tuning excerpts and 17 of the 18 held-out ones have none) |
| no import with a suspect bar reports confidence >= 0.85 | **met** (`confidenceOf` and `mergeIntoReport`: the cap applies whenever any bar is suspect, the validator's included; a unit test over 100 combinations, the merge tests and mutants that remove the cap or apply it only to flagged bars; in the page, a browser test with a validator-only bar). The first version of the page hook capped only when a flag had marked a bar (independent review, major): 8 bars with one note at C9 stayed at 0.8875, "good", "Recognition looks clean" under v2 |

**What the flags do not find, plainly.** The unflagged wrong bars of the tuning half are 33, 70 and 73 (clean, scan, photo; 7 %, 7 % and 9 %): a note the engine did not read in a bar that still adds up (20, 37 and 47 of them), a note it read twice (1, 10, 20), a pitch
off by a clef or an accidental that nothing in the graph contradicts (12, 22, 5). The commonest whole-piece case is a time signature read as another (9/8 as 6/8: the engine then drops what does not fit and every bar "adds up"); no signal of the
graph shows it. What is missing is evidence from the page itself: **printed heads against read heads per bar** (PdfLayer's `missing` exists for vector PDFs and fires only when the page bar count matches), a second reading (the 1.17x DPI pass:
the nearest thing to an ensemble signal; it needs a second engine run, so it is not in the benchmark replay), and a bar-line finder that is right more often than PdfLayer's.

**Measured and not used (negative results).**
- **PdfLayer's bars per line** (`page-bars`; the example of section 8.2). The app path of the tuning half (`--mode app --omr v2 --replay`, 126 files) with the page's bar count per line passed in: recall 0.90-0.94 but precision 0.26-0.54; offline on the
  same files, flagging only the bars of a line whose count differs (and only when the page and the read have the same number of lines): precision 0.35 on vector PDFs (37 bars; the base rate there is 0.26), 0 flags on photos (the number of lines
  never agrees), 0.19 on 200 DPI scans. A "1" at the end of a line, the first bar of a line that holds a clef and a key, a pickup read as a bar: PdfLayer's own count is wrong in the same places the page gate (`PdfLayer.apply`, bars of the page
  against the bars read) already fails. As a weak signal it lowers precision to 0.51 on scans. The signal is implemented (`opts.layout`, tested) and **unused**: the app passes no layout, and `page-bars` is in neither list of `PARAMS`.
- **Audiveris' own symbol grades** (`ctx-grade` of heads and rests in the `.omr` project file, per bar, 216 single-sheet documents, 4,031 bars): on the bars the rule left unflagged, a head below 0.7 is wrong 0 of 34 (clean), 6 of 75 (scan, 8 %), 7 of 36 (photo, 19 %): the
  base rate. The engine is as sure of what it dropped as of what it kept. (`stack` elements of the project file also hold the engine's own "expected / duration / excess" per measure: the same information as `fill-short` / `fill-over`.)
- **Bar width against the piece's median**, **onset density against the neighbours**, **chord size**, **hands swapped (the right hand's register below the left's through a piece)**: no lift, or one the fit paid for in precision (onset density: +0.01 recall for -0.03 precision).
- **Where the engine writes `<divisions>` 0 or a movement break** (`repaired`, `joined`): 77 and 20 bars, right 0.19 and 0.65 of the time; no use as signals, kept for the report.

**Findings and limits, plainly.**
- **Clean precision on the held-out half is 0.595: the gate's 0.60 is not met there (by one bar).** It is not tuned for; the held-out half was looked at once. Photo recall is 0.852 against 0.85: by one bar, no margin. Scan and the truth-file rate pass. The halves differ (held-out clean
  is 12 % wrong, tuning clean 29 %), and 84 wrong bars is a small sample.
- **The fit is a fit of 42 pieces, 8 renderings each**; the cross-validation is by piece, so the eight renderings of one piece are never on both sides, but the pieces are the catalogue's hymns and method books engraved by two engravers, flat paper. Real scans and
  phone photos will be worse (K1-K3), and what "wrong" means for a bar nobody has a truth file of is the teacher's judgement (H-12).
- **Flags per 20 bars on the OMR reads themselves are high**: 593 of 1,609 clean bars (37 %), 1,302 of 2,404 scan bars (54 %), 1,040 of 1,462 photo bars (71 %) are flagged, because 29 %, 41 % and 54 % of them are wrong. Precision 0.7 means three in ten flags
  are bars that were right: the reviewer looks at about 1.4 bars per wrong bar found. On clean reads that is 2 false flags in 20 bars (159 in 1,609); most of them are a right bar beside a broken one on a page that is mostly broken (`bad-page` + `next-to-bad`, 118 of 1,040 on photos, 112 of 1,302 on scans).
- **The score signal ("much of this score was hard to read") makes small scores all-or-nothing, and it is a share of the whole import, not of a page.** The fit saw excerpts of one page (a few of two). A score of eight bars with three short ones, each next to a bad bar (bars 2, 4 and 7), is flagged in
  every bar and its confidence is 0.24 (`boundaries.test.js` pins it); one short bar of eight marks that bar only. In a long score the share is of all its pages together, so one bad page among many is diluted below 30 % and a few weak signals on it do not add up: per page would be the natural reading, and it is unmeasured.
  The sentence says "score", not "page". It is the threshold (30 %), not retuned.
- **`x-misaligned` needs the engine's `default-x`** (Audiveris writes it; another engine, or a MusicXML export that lacks it, makes the signal silent). **`tuplet` (strong), `value`, `sum-mismatch` and `same-note` need the notation checker** (the page fetches it first; without it
  those four are silent and the rest stand; the import then says the check was partial, `report.flagsPartial` and an issue line, and the module is not kept so that the next import asks for both again).
- **A flagged bar is not "fixed"**, and an unflagged bar is not "right": 7 to 15 % of the wrong bars of every tier stay unflagged (7 % clean, 7 % scan, 15 % photo on the held-out half).
- **Reasons are kept as codes**; the sentences are made when they are shown (the strip's tooltip, the issue lines), so a later language change shows the new language. A saved report has no issue lines (they are made at import time and never were kept): when the review opens they
  are made again from the saved codes, once `omr/flags.js` has been fetched for the purpose. A touch screen has no tooltip: the issue list (12 lines, the bars on show first, "N more") is where the reasons are read there.
- **Risk not measured: `many-voices`, `x-misaligned` and `fill-short` are strong with precision 0.94-1.00 on hymns and elementary method books** (the catalogue). Bach and Chopin textures legitimately have three voices on a staff, a rubato bar can look short to an engine, and a score engraved by another
  program has other `default-x` habits: none of that is in the benchmark. It belongs in H-12 (the teacher's own pages), which should look first at bars flagged by exactly one strong signal of these three.
- **The app-path replay uses recorded engine output**: nothing here ran Audiveris. G12-0's files (clean, photo, scan150, scan200; two engravers) are the only engine runs the fit has seen.

**Decisions of the Lead's kind taken here (reversible).** Strong by a statistic or by design, nothing else; the weak count is 2 and fixed; "the page is bad" and "next to a bad bar" are weak signals, not a second rule; precision floor 0.65 and truth-file allowance 0.9
inside the gate's 0.60 and 1.0 (the first fit at 0.70 / 0.7 reached 0.914 / 0.901 / 0.868 on the tuning half and 0.901 / 0.898 / 0.873 cross-validated, too close to the line; the second is the one judged); the confidence cap is 0.84 and falls with the share
of suspect bars; the notation checker is served to the page (one file; `static-allow.js` and its test) rather than copied into `omr/`; the suspect bars are the report's own `suspectMeasures` (no new screen; the correction UI is G12-4); the reasons are saved as codes and made into sentences at display time (the review's preference; a code is small and language-free); the confidence cap does not wait for a flag; no layout is passed to the
flags (above); `page-bars` was in the strong list when the held-out half was judged and was taken out afterwards because of the TUNING half's app-path replay: the dataset has no layout, so the signal never fired in any recorded number and the
tuning and held-out numbers are those of the list without it (the record says so).

## 24. G12-5 implementation record (Implementer, Sonnet, 2026-10-13)

Branch `g12-5-omr-queue` (`D:/PPP-g12p5`), from `origin/main` `adb9f3f` (live `f64d06b` + docs). Row G12-5 of section 11, gate A5 of section 12. **User decision of 2026-10-13: U1 = C (the engine runs on THEIR PC, $0), U2 = only the user's
linked PC: only a browser that holds a PC-link capability code may queue or read a score; nobody else's job ever runs on that computer; the site stays usable with no login.** Everything is behind `PPP.omr = 'v2'` and a PC link
on the device; `'legacy'` (the default) and a device with no link make no request to the new routes and import what they imported (proof below). Nothing was deployed or merged.

**Built.**

| What | Where |
| --- | --- |
| the kind `omr` of the home-PC queue: `POST /api/jobs/omr` (a score as page images), the job answers `GET /api/jobs/:id` / `POST .../cancel` / `DELETE` as any job; a worker claims it only when its claim says `omr: true`, fetches each page with `GET /api/worker/jobs/:id/pages/:n`, posts `{engine, engineVersion, ms, pages: [{index, ok, ms, error?, movements}]}` to the existing result route; `heartbeat` carries the page number; the list of conversions never shows a score; `PPP_OMR_JOBS=0` switches the kind off | `home-jobs.js` |
| what may go up and come back, one file for the site and the worker: PNG/JPEG read by header (type, width, height), every cap, base64 and data: URLs, a content fingerprint; MusicXML checked as text (standard DOCTYPE cut out, every other DOCTYPE, entities, CDATA, control characters, nesting, tag count, root) and the result's shape | `home-omr.js` (new) |
| the table `ppp_omr_pages(job_id, idx, bytes, created_at)`, a foreign key to the job that CASCADES; the job row and its pages in ONE statement; a page is read only for the owner's CLAIMED job; pages are deleted only for a job that is no longer waiting or claimed; the boot read counts each job's pages inside its one statement; `purge` has a shorter keeping time for a score; the file store keeps pages as files | `home-jobs-store.js` |
| the call to Audiveris, the `.mxl` reader and `movements`, shared: `readMxlSync`, `findAudiveris`, `recognisePage(audiveris, image, outDir, {timeoutMs, extraArgs, onChild, lowPriority})`, `engineVersion`; the local helper now calls it with no option (its answers are what they were), the worker adds the step time-out and the priority | `omr/engine.js` (new), `omr-service.js` (delegates; an optional `require`: the service starts without the file, `/omr` then says "engine missing") |
| the worker: `omr: true/false` in every claim, scores handled by `processScore` (pages fetched and re-checked, one at a time, below-normal priority of the engine's process, and of the worker itself while it reads (on Windows only: elsewhere a process cannot raise its priority again), a page time-out, the result validated with the site's own rules before it leaves the PC, cancel kills the engine's process by its PID, the scratch folder removed); `--check` says what the engine is; settings `omr`, `audiverisPath`, `omrPageTimeoutSeconds`, `omrHeapMb` (the engine's Java heap cap); a `.bat` Audiveris is said to be no use; README (Korean first) | `tools/home-worker/worker.js`, `README.md`, `worker.config.example.json` |
| the page: under `'v2'`, a PC link, and no local helper, `Import.load` sends the pages to the PC (`Import.recogniseOnPc`), shows "Sending ... / Waiting for your PC to read the pages / Your PC is reading page n of N", and goes on with the result through `Import.omrXml`, S4 and the flags as a helper's answer does; **Use the draft instead** (cancels the job), Cancel, a PC that is not on (a hint), a PC that fails (its line): the browser draft, and the review says why (a `pc-omr-fallback` issue). 26 sentences in ko, ja, zh (6 of them after the review: the question before a link this device did not make is sent the pages, and the 404/410 ends); `tests/i18n/gaps.js --check` stays at 0 | `Piano Coach App.dc.html` (module-level `PC_OMR`/`pcOmrApi`, five `Import` methods, one hunk in `Import.load`, three in `runAnalysis`, `cancelImport`, `usePcDraft`, one button in the template) |

**The contract.**

| Route | Who | Answers |
| --- | --- | --- |
| `POST /api/jobs/omr` `{title?, pages: [base64 PNG/JPEG or data: URL], large?}` | a browser with the link's code (`X-PPP-PC`, this site as origin) | 201 `{job, worker}`; 200 `existing` for the same pages while they wait; 401 `no-link` / `bad-code` (before a byte of the body is read); 403 `cross-site`; 408 `slow` (the body did not arrive in time; the connection is closed); 409 `no-pc` (the PC has never connected), `no-omr-pc` (its worker said it cannot); 413 `too-large`, `too-many-pages`, `page-too-large`, `job-too-large`; 422 `no-pages`, `bad-image`, `image-size`, `bad-body` (also: the JSON's structure is over its bound); 429 `queue-full`, `quota`, `too-many`, `in-flight` (this link's body is already being sent); 503 `busy`, `quota`, `budget` (the site's budget for what it takes in or sends for scores is used up: Retry-After), `omr-off`, `store`. A newer score at a link's cap of 2 takes the place of the oldest one **no PC has taken** (that one is cancelled and its images deleted); one being read is never touched |
| `GET /api/jobs/:id`, `POST /api/jobs/:id/cancel`, `DELETE /api/jobs/:id` | the same | as for a conversion; a score that is done answers with `result`, a read counted in the link's 60 an hour; cancel deletes the images at once; the page DELETEs the job when it has taken the score |
| `GET /api/worker/status` (and the `worker` of every answer) | the link's code | gains `omrMode`: `true` (the PC's worker said at its last claim that it can read a score), `false` (it cannot: an older worker, or no engine), `null` (not heard since the server started), `'off'` (this site has the kind switched off); the page offers the PC path unless it is `false` or `'off'` |
| `POST /api/worker/claim {…, omr: true}` | a worker token | the oldest queued job of ITS link that it can do; a score comes as `{id, kind: 'omr', url: '', title, pages, attempt, maxAttempts}` |
| `GET /api/worker/jobs/:id/pages/:n` | the token that holds the claim | the page's bytes (`image/png` or `image/jpeg`, `no-store`, `attachment`); 409 when the job is not claimed or another token holds it; 410 gone; 429 `too-many` past the job's reads over its LIFETIME (below) or 300 pages an hour per token; 503 `budget` when the site's hourly or daily budget for scores is used up (Retry-After; the worker does not wait it out: it gives the score up with the site's words) |
| `POST /api/worker/jobs/:id/result` | the token that holds the claim (or, after a lease ran out, any token of the link: a late result is still taken) | 200; 422 `bad-result`, `bad-xml`, `nothing-read`, `too-large`; 409; the shape depends on the job's KIND, so notes for a score and pages for a conversion are 422 |
| `heartbeat`, `fail` | as above | `page` (0..n) in a heartbeat is shown by the page; `fail` with `retry` keeps the images, a final failure deletes them |

**Caps and quotas** (`home-jobs.js` `LIMITS`, `home-omr.js` `LIMITS`; the three byte caps are also settings of the service, `PPP_OMR_TOTAL_IMAGE_MB` the site's):

| What | Cap | Refusal |
| --- | --- | --- |
| pages in a job | 12 (24 when the body says `large`) | 413 `too-many-pages` |
| one page / a whole job | 1.5 MB / 12 MB of image bytes (the body: 16.25 MB as base64) | 413 `page-too-large`, `job-too-large`, `too-large` |
| a picture | PNG or JPEG, 200 to 6000 px a side, 20 megapixels | 422 `image-size` (a PNG header that claims 100,000 x 100,000 pixels is refused from its 33 bytes) |
| scores waiting or being read, per link | 2 (and 5 with conversions) | 429 `queue-full` |
| scores asked for | 6 an hour per link, 12 an hour per address (links made from one address share it) | 429 `too-many`, Retry-After |
| page images held (waiting or claimed jobs) | 16 MB per link, 16 MB per creating address, 64 MB for the site | 429 `quota`, 503 `quota`, 503 `busy` |
| bodies being read at one moment (an upload, or a PC's result; counted apart) | **1 per link, 1 per address (an IPv6 /48 is one), 3 in the whole site** (a body is held in memory while it is read and decoded); the place is taken before the first byte and given back in a `finally` | 429 `in-flight`, 503 `busy`, Retry-After 10 |
| how long a body may take | 60 s in all, and never 10 s without a chunk | 408 `slow`, connection closed |
| the structure of a JSON body (counted as it arrives, outside strings) | tokens (`{ [ , :`) / containers (`{ [`) / depth: a small body 64 / 8 / 6; an upload 112 / 8 / 4 (about 30 tokens are used); a score's result 1,120 / 64 / 6; a conversion's notes 520,064 / 30,064 / 8 (30,000 notes at 16 tokens) | 422 `bad-body`, nothing parsed |
| a score's attempts | **2** (one claim, one more when the PC lost it); a conversion keeps 3 | `fail` with `retry` on the last is the end |
| page reads of one job | over its LIFETIME, never reset by a claim: `attempts x (pages + 2)`, at most 2 x (p + 2); a refused read is not counted | 429 `too-many` |
| what the site reads out of the database for scores (pages for PCs, finished scores for pages), all links | 64 MB an hour and 128 MB a day (`PPP_OMR_EGRESS_MB_HOUR`, `_DAY`); a restart forgets it | 503 `budget` |
| what the site writes for scores (the images it accepts), all links | 64 MB an hour and 128 MB a day (`PPP_OMR_INGRESS_MB_HOUR`, `_DAY`); given back when nothing is written | 503 `budget` |
| a PNG | 16 KB of anything that is not the picture (IHDR, PLTE, IDAT, IEND), and it must end in IEND | 422 `bad-image` |
| keeping time | a score nobody's PC took expires after **1 day**; a finished score is purged after 1 day (a conversion: 3); images are deleted when the job is done, failed, cancelled, expired or removed (and by the cascade when its row goes) | |
| a result | 4 MB of JSON (one movement 3 MB, 400,000 tags, depth 40, 16 movements a page), counted in the link's 8 MB of notes (the oldest finished one makes room), 16 MB per address, 64 MB site (the existing result caps) | 422 `too-large`, 503 `quota` / `busy` |
| a page handed to a PC | the job's reads above, 300 an hour per token | 429, 503 `budget` |

**The abuse analysis** (one row per threat; each has a test, named, in `tests/home-worker/`):

| Threat | What stops it | Tested by |
| --- | --- | --- |
| a stranger with no code queues a score | no header is 401 `no-link` before the body is read; a code that is not a live link's is 401 `bad-code`, counted per address (20 an hour, then 429), failures only; a session cookie, a code in the body or in the query, a worker token and a link id are not codes; another site as origin is 403 | `omr-jobs` "a score: who may ask"; `omr-abuse` "what a stranger learns" |
| a valid code reads, cancels, removes or opens another link's score | the job is "not there" (404), answered byte for byte as a job that never existed (status and body), for the browser routes and the worker routes | `omr-jobs`; `omr-abuse` ("answered exactly as ... an id that never existed") |
| a stranger makes a link of their own and queues scores | possible (as for YouTube: a link is free): their job belongs to THEIR link, so only their own worker token can claim it - it never reaches the user's PC (the owner's worker, asking with `omr: true`, is told there is none). What it can store is bounded per link (2 scores, 16 MB), per creating address (16 MB, 12 scores an hour), for the site (64 MB), and lives a day | `omr-abuse` "a stranger with a link of their own"; `omr-limits` |
| a stranger fills the site's 64 MB of images (four addresses can) | the owner's score is then 503 `busy` until the images are a day old or deleted; the page falls back to the draft and says so. No data is at risk (64 MB of a 0.5 GB database); the knobs are `PPP_OMR_TOTAL_IMAGE_MB` and `PPP_OMR_JOBS=0`. **Said plainly: the kind opens a resource that strangers can exhaust for a day; it cannot run anything on the user's PC.** | `omr-limits` "the images held" |
| oversized, many, malformed or hostile pictures | caps above; the type and size are read from the bytes, not the name; a decompression bomb is refused by its header; the worker re-checks every page it is handed and writes it under its own name | `omr-jobs` "page images"; `omr-limits` "uploads"; `omr-worker` "what the worker does not trust" |
| XML bombs and entity tricks in a result (billion laughs, XXE, a huge document) | text checks without building a tree: no DOCTYPE but the standard one (cut out), no entity declaration, no CDATA, only the five entities and character numbers, depth 40, 400,000 tags, 3 MB a movement, 4 MB a result; the page reads it with the importer that already ignores a DOCTYPE | `omr-jobs` "what comes back"; `omr-flow` "a document with entities" |
| a zip bomb in the engine's `.mxl` | the worker inflates at most 64 MB (`maxOutputLength`); only Audiveris writes there | `omr-worker` "a .mxl that inflates past 64 MB" |
| a worker token posts a result of the wrong kind, or for a job another token holds | the result's shape is chosen by the job's kind (422 both ways); a score answers to the token that claimed it (409 `not-yours` for another token of the same link, e.g. after a rotation; the lease then gives it back); pages go only to the claiming token while the job is claimed | `omr-flow` "what a worker token may do with a score" |
| two claims of one score | the state change is made in memory before anything is awaited and the SQL has `status = 'queued'` in its WHERE: of eight claims at once exactly one wins | `omr-flow` "eight claims at once"; `omr-jobs-pg` guards |
| a name becomes a path | job ids are the server's (96 random bits, base64url); the file store names its files by them only after a pattern check; the worker names its files itself; a title is text; a job id with `..` is no route | `omr-abuse` "the site fetches nothing, and a name is never a path" |
| the site fetches an address from a score (SSRF) | nothing in this feature fetches a URL; a score that names addresses in its body is queued as if it did not, and none is kept | `omr-abuse` |
| images or results in a log | none is ever logged (the service's log lines, the job file, server.js's output are searched for marker bytes); the worker logs titles and counts | `omr-abuse` "what is kept"; `omr-jobs-pg` |
| images kept after the job | deleted at the result, a failure, a cancel, an expiry, a removed link (cascade); a delete that fails is retried at the next purge and found again by the boot read | `omr-flow` "the keeping time"; `omr-jobs-pg` "a restart" |
| the queue's idle poll costs SQL or keeps the site awake | unchanged: an idle claim (now also saying `omr: true`) runs no statement, counted on the store and in the database's own log | `omr-flow` "the free-tier rule"; `omr-jobs-pg` |
| **a JSON body that is small in bytes and huge in objects** (a 16 MB `{"pages":[{},{},...]}` is 5.6 million objects: 357 MB of heap and 650 ms of a blocked loop; one request ended a server with a 256 MB heap) | the structure is counted **as the bytes arrive**, before anything is parsed or held (`jsonGuard`: tokens, containers and depth outside strings; base64 and MusicXML strings cost nothing to scan, 11 ms for 16 MB), on **every** route of the queue that reads JSON, with the bound each route's legitimate bodies need; a body over it is read on and thrown away up to its drain, answered 422 `bad-body`, and stores nothing | `omr-guard` "the shape of a body" (a child process with a **200 MB heap**: the guard gone ends it by the heap limit, one failed assertion here), mutants X1-X5 |
| **a slow sender holds the places** (two sockets that send a header and a few bytes held both of the site's places for 311 s each, and came back) | a deadline for the whole body (60 s) and one for the gap between chunks (10 s), then 408 `slow` and the connection closed; **one place per link and per address, 3 for the site above them**, taken before the first byte and given back in a `finally` (answered, refused, cut, timed out); a result's places are counted apart from uploads | `omr-guard` "a body must arrive"; mutants X6-X13, O7 |
| **egress amplification** (one 11 MB upload read 99 times out of Postgres: 3 claims x 3 reads of each page x 11 pages; about 1.3 GB an hour from one address) | a score has 2 attempts, not 3; page reads are counted over the job's lifetime (never reset by a claim): `attempts x (pages + 2)`; and the site has an hour and a day budget for what it reads for scores (pages for PCs and finished scores for pages) and one for what it writes, with 503 `budget` and a Retry-After; the worker does not wait a budget out | `omr-guard` "page reads over the whole life of a job"; mutants X14-X21, X38-X40 |
| **the PC's page images go to a PC the person never chose** (zero-tap `#pc=` adoption, then a score is imported) | a link the device did not make is **not trusted** with page images: the first send asks "Send the pages of this score to the PC ending in `…tag`?" and uploads nothing before the answer; made here / `&local=1` / the person's own "Send the pages" is trusted (G10B section 15.9) | `omr-page` "whose PC"; mutants G16-G19, G22, G23 |
| page rows nobody can ever read (the jobs table dropped and made again: the pages table has no key and its images stay for ever) | the migration puts the foreign key back and deletes the page rows no job names, at every boot (inside the same DO block, only when the key is missing); the boot read counts them and deletes them; every purge that deletes jobs takes them in the same statement | `omr-jobs-pg` "a jobs table dropped by hand"; `omr-guard` "page files that no job names"; mutants X32-X37 |
| a crafted PNG (a compressed `iCCP`/`zTXt` chunk that a decoder inflates to gigabytes) reaches Audiveris's Java runtime | the pages the app sends are always re-drawn through a canvas first (`imageToPage`, `rasterisePdf`: nothing of the file's own chunks survives; tested here with a file carrying a 100 KB `zTXt`); the site and the worker both refuse a PNG with more than 16 KB around its picture or without an IEND; and the engine's Java heap is capped (`omrHeapMb`, 2048, as `-Xmx` in `JAVA_TOOL_OPTIONS` ahead of the person's own) with the page time-out (600 s) and the step time-out (1800 s) as before | `omr-jobs` "a PNG is its picture"; `omr-page` "the file is re-drawn"; `omr-worker`; mutants X25-X28, X31 |
| a tab closed while the PC is off leaves 2 scores the page cannot list or cancel for a day | a newer score from the same link takes the place of the oldest one no PC has taken (cancelled, images deleted); a score being read is never touched | `omr-limits` "the queue: scores waiting"; mutants X22-X24 |

**Free-tier arithmetic.** The idle poll is the same claim (an hour apart, zero SQL, 26 % of the shared Render hours with the PC on all day; none with the shortcut). A score costs: one statement to queue it (job and pages), one to claim, one
read per page the PC fetches, one to finish and one to delete its images, plus the page's polls while the person waits on the Add screen (a look per 3 s, then 10 s, then 30 s: they keep the free instance awake only while the tab
is open and waiting; a job the person abandons costs nothing more than its day). Storage: at most 12 MB of images per job and 64 MB for the site, held only from the upload until the PC has read them (minutes to an hour); a result
is 20-300 KB a page and goes when the page has taken it. Egress: a score of 3 pages is about 1.5 MB up and 1.5 MB read by the PC plus 0.3 MB for the page's one read of the result; 65 pages a month is about 0.2 GB of Neon's 5.

**Migration and rollback.** `SCHEMA_SQL` gains `CREATE TABLE IF NOT EXISTS ppp_omr_pages` and one index: nothing is altered, nothing dropped, in the same transaction under the same advisory lock, inside the savepoint that makes the queue
optional. The code before G12-5 boots on the result (tested on a Postgres 17: it migrates, reads the queue, purges, claims; its `DELETE` of a job row removes the page rows by the cascade). **A manual `DROP TABLE ppp_transcribe_jobs`
now needs `ppp_omr_pages` dropped first (or `CASCADE`); the rollback line of section 10 of `G10B_HOME_WORKER.md` becomes `DROP TABLE ppp_omr_pages, ppp_worker_tokens, ppp_transcribe_jobs;`.** Rolling back the code leaves score rows
in the table; the old worker never receives one (it does not say `omr: true`); a score row that the old server hands to a new-enough worker does not exist.

**What the independent review will find first, said here.** (1) The kind is reachable by anybody who makes a link (the YouTube conversion is the same); the bound is the quotas above, not the user's identity. (2) A worker trusts the
site for what its engine opens: the page header is checked, the decoder is the Java runtime's. (3) `PPP_OMR_JOBS` defaults to ON: the route exists on the live site as soon as this is deployed, and only a page with
`PPP.omr = 'v2'` uses it. (4) A phone that queues a score waits for the PC's next check (an hour by default) unless the PC's own browser queued it (`pppworker://run`); the page says so and offers the draft.

**The independent review of PR 269 at `7162bc5` (2026-10-14: "do not merge as is": one blocker, three majors, minors; reproduced by the reviewer against the real `server.js` and Postgres) and what changed.** The user's decision (only a linked PC; the site usable
with no login) is untouched. Everything below is in the same PR; the numbers are from this tree, on this PC (Windows 11, Node 24).

| # | Finding | What changed | What was measured |
| --- | --- | --- | --- |
| 1 BLOCKER | `JSON.parse` of the whole body before any structural check: a 16 MB `{"pages":[{},{},...]}` is 5.6 million objects, 357 MB of heap, 650 ms; against `--max-old-space-size=256` ONE request ended the process; no precondition but a link; the 5 MB result route the same shape (110 MB), no cap on how many at once | The structure is counted **while the body arrives** (`jsonGuard` in `home-omr.js`: tokens `{ [ , :`, containers and depth, outside strings; O(n), no allocation), on every route that reads JSON (claim, heartbeat, fail, result of a score, result of a conversion, making a link, rotating a token, a conversion, a score) with the bound of that route; a body over it is read on, thrown away and answered 422 `bad-body`. Parsing is synchronous, so two parses never overlap; what is capped is bodies HELD (below). | in a child process with a **200 MB heap**: the 16 MB upload is refused in **14 ms** (the whole request, on loopback), the event loop blocked at most **13 ms**, heap growth **0 MB**; 16 MB of `[` 17 ms; 5 MB of `{}` as a score's result 6 ms (job stays claimed); 3 MB of `{}` as a conversion's notes 4 ms; the child ends at 7 MB of heap used (105 MB resident). The scan of 16 MB of base64 costs 11 ms. With the guard removed (mutant X1) the child is ended by the heap limit (`FATAL ERROR: Reached heap limit`, exit 134) and the test reports one failed assertion. |
| 2 MAJOR | `readBody` has no read deadline and the site had 2 upload places: two sockets that send headers and a few bytes held both for 311 s each (the server's own timeout) and came back: another link got 503 | a deadline for the whole body (**60 s**) and one for the gap between chunks (**10 s**) on every body of the queue, then 408 `slow` and the connection closed; places counted **per link (1), per address (1) and for the site (3)**, taken before the first byte, given back in a `finally`; a PC's result has its own places (a person's own PC finishing one score does not wait for their browser's next upload) | (deadlines shortened to 0.4 s / 1.6 s for the test) a stalled sender is answered 408 at **411 ms** and the socket closed; a sender of one byte every 100 ms at **1,607 ms**; while it stalls another link on another address is taken (201), the same link is 429 `in-flight`, another link on the same address 503 `busy`; the place is free again at once after a 408, a refusal (422) and a socket that goes away; a stalled result holds only its own link's result place |
| 3 MAJOR | the per-page read count started again at every claim and a retry allowed 3 claims: one 11 MB upload was read 99 times (99 MB out of Postgres); per address 12 uploads an hour is about 1.3 GB an hour | a score has **2 attempts**; page reads are counted over the job's **lifetime** (`attempts x (pages + 2)`, never reset, a refused read is not counted); **budgets for the site**: 64 MB an hour and 128 MB a day for what it reads for scores (pages for PCs, finished scores for pages) and the same for what it writes (the images it accepts), 503 `budget` with Retry-After, checked before a byte is read from or written to the database; a score the budget could not send once is refused at the door; the worker does not wait a budget out (one request per page, the score is given up with the site's words) | the same 11 MB job (11 pages of 1 MB) with a worker that fails every claim with `retry`: **25 page reads, not 99** (the bound is 26); a claim does not start the count again (12 reads for 2 attempts of 4 pages, then 429); the budget ends the reads at 5 pages of 4 KB with a 18 KB budget (the read that crosses it is served), then 503 `budget` with Retry-After >= 60; an hour later it is back; the day's budget holds when the hour's has room; a finished score counts like a page |
| 4 MAJOR | zero-tap pairing adopted `/#pc=<code>` at once, and the same device's next v2 import then uploaded its page images and file name to whoever held the code | the link record carries `trusted`; a link this device **made**, or whose pairing link carried **`&local=1`**, or that the person confirmed with **"Send the pages"**, is trusted; an adopted, typed or older link is **asked once, at the first send**: "Send the pages of this score to the PC ending in `…tag`?" with **Send the pages** / **Use the draft instead** (ko 해요체, ja, zh, en); nothing is encoded or uploaded before the answer; with nobody to ask nothing is sent. Policy in G10B section 15.3 (table) and 15.9. | in a fresh context at `/#pc=<foreign code>`: adopted with `{v:1}` (no trust); a PNG imported: the question appears with the link's tag and **no `POST /api/jobs/omr`, nothing queued for that PC, after 1.5 s of waiting**; "Use the draft instead" uploads nothing and leaves it untrusted; "Send the pages" sends once and records `trusted: true`; the next score is sent without asking; `&local=1` and a link made on the device send at once |
| 5 MINOR | a manual `DROP TABLE ppp_transcribe_jobs CASCADE` and a reboot leaves `ppp_omr_pages` without its foreign key and its rows (images) for ever, no sweeper | the migration, in its one DO block, adds the key (named as the table names it) when it is missing and deletes the page rows no job names first; the boot read counts such rows (one more statement in the same round trip) and deletes them; the purge statement takes them too (a CTE: still one statement; idle purge still none); the file store does the same for page files | on Postgres 17: key back with `ON DELETE CASCADE`, 3 orphan rows deleted, a job's own pages kept, a third migrate deletes nothing; `loadAll` still one statement; the purge is one statement and removes the 2 rows; `server.js`'s own boot repairs it |
| 6 MINOR | crafted PNG chunks to the JVM; closed tab leaves 2 waiting scores; second tab's 404 misleading; 410 loops; `Audiveris.bat` | the app re-draws every page through a canvas before it is sent (it already did: `imageToPage`, `rasterisePdf`; shown by a test with a 100 KB `zTXt`); site and worker both refuse a PNG with more than 16 KB around its picture or with no IEND; the engine's Java heap is capped (`-Xmx2048m`, `omrHeapMb`); a newer score takes the place of the oldest one no PC has taken; 404 says "no longer waiting on the site: if you sent it from another tab, it is in My Songs" and makes no second copy; 410 ends the wait; a `.bat` is not started (EINVAL since Node 18.20/20.12) and `--check` says to point at `Audiveris.exe`, the PC says it cannot read scores | tests in `omr-jobs`, `omr-limits`, `omr-worker`, `omr-page` (below) |

**What is still true, said plainly** (the residual risks of this feature after the fixes). (1) **Four addresses fill the site's 64 MB of images for a day** (16 MB each); the owner's score is then 503 `busy` and the page falls back to the draft. The new budget for what the site writes (128 MB a day by default) bounds the churn: at most
two such fills a day. (2) **Three addresses can hold the site's three upload places** for up to 60 s each (they are cut and may come back): a person is 503 `busy` with Retry-After 10 and gets the draft; each of them needs a link whose PC has connected. (3) **The budgets and the places are in memory.** A restart (a deploy, or Render's sleep after 15 idle minutes) gives a fresh hour; an attacker who waits for the sleep
between bursts moves about 64 MB per 16 minutes through the database (the hourly limits of scores a link and an address may ask for are in memory too, as they are for conversions); what a restart does not forget is what is IN the tables: the images held per link, per address and for the site, and the rows. Making the budget survive a restart needs a row written
with each read, which is the one thing this feature promised not to do (a page read is one statement). **Not done; recorded.** (4) **Neon's history.** The images are `bytea` that is written once and deleted: every byte is also write-ahead log, and Neon keeps history for point-in-time restore for a window the plan decides; whether that counts toward the Free plan's 0.5 GB or its transfer was not measured here. The ingress budget is what bounds it. (5) `readBody` of the routes outside the queue (2 MB by default) was not
changed here; its parse is the same shape of risk at a tenth of the size (about 45 MB for a body of `{}`s). (6) JPEG metadata is not bounded (there is nothing to inflate in it); the app's canvas never sends any. (7) A `.bat` is detected on Windows only. (8) The worker's heap cap is Java's: Audiveris's native parts are not capped. (9) A person whose link was made on this device before this change has a record with no `trusted` field: they are asked once.

**Mutants of the review's fixes.** 48 new (`omr-mutants.js`: X1-X40 for the shape, the deadlines and places, the reads and budgets, the replacing of a waiting score, the PNG, the worker, the migration and the rows nothing names; G16-G23 for the page's question and the 404/410 ends), and the 13 patterns of the first round that named code which moved were repaired (O7, O8, O16, O18,
O31, O32, V3, V10, V13, G13, A7, N7, R8): **all killed** (two first survived, X12 and X23 - the check of the announced size on a route that is not the upload's, and the cancel of a score that is being read - and got their tests). `MUT_CHECK=1` finds every pattern once.

**Verification.** `npm run test:home-worker` (in `shard-h` of the gate): `jobs` 298, `links` 166, `server` 39, `worker` 147, `pair` 66, `protocol` 93, `omr-jobs` 123 (the module's rules, every refusal, the queue's rows), `omr-limits` 50, **`omr-guard` 64 (new: the shape of a body in a child process with a 200 MB heap, the deadlines and the places, the page reads over a job's life, the budgets, page files nothing names)**, `omr-flow` 88 (a whole job,
the six ways it ends, the keeping time, a delete that fails, the scope of a worker, the kind switched off, idle polls, eight claims at once, the quota of results), `omr-abuse` 23, `omr-worker` 73 (settings, the claim, a whole score
with a stand-in for the engine, pages the worker does not trust, priority, cancel by PID, a rejected token, `--check`; plus, where there is a shell, the real `omr/engine.js` with a script for Audiveris), `jobs-pg` 118 and `omr-jobs-pg` 62
(on a throwaway Postgres 17 with `log_statement=all`: skipped in the gate, like `jobs-pg`); `npm run test:home-worker-page` (local, puppeteer): `omr-page` 55 (the gate: legacy / no link / PC never seen / PC cannot / site switched off: no request to the queue; the flow with a
fake worker; the draft; a failing PC; Cancel; a big photo re-encoded; 13 pages "large"; Korean; the question before a link this device did not make is sent pages, the draft and the 404/410 ends, the file re-drawn), the old page suites unchanged and green (`page` all, `findable` 115, `pairing` 271), and the browser suites of G12-1..3 (`omr-normalize-app`, `omr-apply-app`, `omr-flags-app`) pass; on Linux (Docker, Node 24) the Node suites above and the two helper suites pass, the helper's shell-script stand-in tests included (10 of 10). `tests/omr/normalize/helper-service.test.js` and `helper-output.test.js` were updated for
`omr/engine.js` (the helper's answer is the same; a service without the module starts). `tests/home-worker/jobs-pg.test.js` was already out of date on `main` (G13-5's `ppp_users.created_ip_tag` is in the boot SQL): its schema
and data comparisons now name that column and the new table.

**The real end-to-end run** (this PC, Windows 11, Audiveris 5.11.0 as installed in `D:/PPP/tools/audiveris`; a local server of this tree on a free port with the file store; the Add screen driven by puppeteer as a person drives it, with
`PPP.omr = 'v2'` and a PC link; the real `worker.js --once` started by the script, which put itself and the engine at below-normal priority; the PC was loaded by other sessions' jobs; one page at a time):

| File | Pages | The engine, per page | Worker `--once` | Score in the review |
| --- | --- | --- | --- | --- |
| `tests/fixtures/piano-clean.png` | 1 | 5.1 s | 6.5 s (file chosen to review: 7.6 s) | 8 bars, 2 staves, 48 notes, "good", confidence 1.00, no suspect bar; the result 20 KB; v2's normaliser and the flags ran; "Audiveris on your PC" |
| `tests/fixtures/piano-clean.jpg` | 1 | 4.3 s | 5.8 s (7.3 s) | the same score |
| `tests/fixtures/piano-multipage.pdf` | 2 | 9.4 s and 8.5 s | 19.3 s | the same 8 bars and 48 notes, the pages joined; 25 KB |

The site then held no job (the page removed it). 0 page errors. The engine was started with `-batch -export -option org.audiveris.omr.Main.sheetStepTimeOut=1800 -output <dir> -- <page>`: Audiveris 5.11.0 accepts that option
(the pages were read). Nothing was sent to the live site and no other Audiveris was running (the PC's other work was other sessions' browsers and tests).

**Memory of the site while uploading.** (First measure, before the review's fixes: a local server held 74 MB; one 12 MB job took 83 ms to accept and the working set peaked at 128 MB with two in flight.) After them, a local `server.js` (Node 24, file store, a fresh process) held **60 MB** after its boot; one 12 MB job (12 pages of 1 MB) took 345 ms
to accept (the whole request, on loopback) and the working set peaked at **119 MB**; **three at once** (the site's ceiling, three links on three addresses; 36 MB of images) all 201 in 836 ms, peak **119 MB**, **106 MB** afterwards (the allocator keeps what it took); a 16 MB body of `{}` was refused in **14 ms** with no growth. Render's free instance has 512 MB. A body is held only
between its first byte and the write of the job; the ceiling of 3 uploads and 3 results keeps the worst case near 180 MB above the boot's. (Parsing is synchronous: two `JSON.parse` never overlap; what the ceiling bounds is bodies HELD.)

**What could not be tested.**
- **Production.** Nothing was deployed or contacted: Render's spin-down, its request limits for a 16 MB body, Neon's quotas and a real Neon are argued from the numbers, not measured. The Postgres tests ran on a throwaway
  `postgres:17` container, with `log_statement=all`; the migration is plain `CREATE TABLE/INDEX IF NOT EXISTS`.
- **A phone, and a real photograph.** The page drives a headless desktop Chrome; the photo path was exercised with a JPEG fixture and a synthetic noisy canvas, not a camera's output (curl, shadows, perspective: K2).
- **Documents of many pages through the real engine.** One and two pages ran for real; 12 and 24 pages are tested with stand-ins (the caps, the page loop, the heartbeat), not with 24 real Audiveris runs.
- **A busy PC under load for long.** The runs above were beside other sessions' work and no page timed out, but the 1800 s step time-out and the 600 s page time-out were not driven to their limits with the real engine.
- **The real `pppworker://` launch.** The page's call is intercepted in the tests (as in G10b-4); nothing starts the real worker from a browser here.
- **The AGPL question** was not looked at again: Audiveris stays a separate process on the user's PC (G12-D1), nothing of it is bundled or served.

**Decisions of the Lead's kind taken here (reversible).** (1) A route of its own, `POST /api/jobs/omr`, so that `POST /api/jobs` (4 KB body, YouTube links) is byte for byte what it was. (2) One atomic JSON upload (base64, 16.25 MB at most)
rather than per-page uploads: a job never exists half uploaded; the price is memory while it is decoded, bounded by two uploads at once. (3) Images in Postgres `bytea`, never in memory, deleted at the result; a cascading foreign key
so that no path that deletes a job row can leave them. (4) The kind is ON by default (`PPP_OMR_JOBS=0` turns it off; `PPP_OMR_TOTAL_IMAGE_MB` sizes the images); only a page on `'v2'` uses it. (5) A PC must have connected and not have
said it cannot (resource hygiene, not security: a stranger's own worker can say anything). (6) A result may be 4 MB, not the 2 MB of section 7.5 (twelve dense pages are about 3.6 MB of text). (7) The wait is on the Add screen with an
escape, not a background list: the page images are never persisted, so a later "Open" could not show the page beside the bars; closing the tab abandons the read (the job expires in a day). (8) The PC path is used only where no local
helper is, and has no second DPI pass. (9) The file name (without its extension, 120 characters at most) is stored on the site for up to a day, as the title of the job. (10) The worker passes the step time-out option of G12-0 (on a
busy PC at below-normal priority the 120 s default would lose pages); the local helper still runs the engine as it did. **After the review of PR 269:** (11) a score has 2 attempts, not 3 (a PC that lost it once is asked once more; a score is worth less to read twice than to store). (12) A newer score takes the place of the oldest waiting one (no
list or cancel button for scores: the simplest thing that frees a closed tab's place; a score being read is never touched). (13) The three places for uploads and for results are per link and per address with a ceiling of 3, not 1-2: parsing is synchronous, so the number is of bodies held, and a ceiling of 3 leaves room for one honest person beside two stalled senders. (14) A budget
that refuses is not waited out by the worker: the score is given up with the site's words and the page uses the draft. (15) A typed code, a pairing accepted by tap and a record from before the field are not trusted with page images; the person is asked once. (16) The budget numbers (64 MB an hour, 128 MB a day, each way) are guesses sized by honest use (a few MB a day) and by Neon's
5 GB a month (about 3.8 GB a month at the daily number); they are settings.

**Operations (for the deploy, which the Lead decides).** Nothing to configure: the table is made at the boot, the kind is on, only a page on `PPP.omr = 'v2'` with a PC link uses it. Verify beyond `/health`: `POST /api/jobs/omr` with no `X-PPP-PC` header is 401 `{"code":"no-link"}`; `GET /api/worker/status` (with a link's code) carries `omrMode`. After the merge the home-PC worker worktree (`D:/PPP-worker`) must be updated to the live sha: the worker's `omr: true` and `processScore` are in `tools/home-worker/worker.js`, and `omr/engine.js` and `home-omr.js` beside it; then `node tools/home-worker/worker.js --check` should say "scores: Audiveris 5.11.0 at ...". Costs and switches: `PPP_OMR_JOBS=0` (off), `PPP_OMR_TOTAL_IMAGE_MB`, `PPP_OMR_EGRESS_MB_HOUR` / `PPP_OMR_EGRESS_MB_DAY` (what the site reads for scores), `PPP_OMR_INGRESS_MB_HOUR` / `PPP_OMR_INGRESS_MB_DAY` (what it writes); a PC's own cap on the engine's Java heap is `omrHeapMb` in `worker.config.json` (2048). Rollback: deploy the previous sha (it boots on the migrated database); the kind's rows and `ppp_omr_pages` stay and are purged by the cascade/keeping time.

**Found on the way.** `tests/home-worker/jobs-pg.test.js` was out of date on `main` (G13-5 added `ppp_users.created_ip_tag` to the boot SQL; its schema and data comparisons failed before this change) and seven mutants of
`mutants.js` named code that G10d had reworded (A5, A18, B3, R7, L35, R13, T2): all are fixed here, with the new table added to the comparisons. A manual `DROP TABLE ppp_transcribe_jobs` now needs `ppp_omr_pages` dropped first.
