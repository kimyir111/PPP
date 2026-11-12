# omr-live-2: the OMR benchmark (G12-0)

A printed piano score, or a photo of one, goes in; a score comes out; this benchmark says how much of it is right, **bar by bar, against exact
truth**. Design: `docs/GOALS/G12_OMR.md` sections 1 and 10 (phase G12-0, gate A0). It is a **local tool**: it needs Audiveris, Verovio, Chrome and
a free PC, none of which the CI runners have. The CI gate runs only the unit tests of its pure parts.

```
catalogue score (public domain / CC0, exact MusicXML)
   │  truth.py        the first 24 bars, <print> and <credit> removed: THE TRUTH and the engraver's input (deterministic bytes)
   ▼
engraver A  Verovio 6.3 (python package)        engraver B  PPP's own print path (node/ppp-print.js, G4e)
   │  SVG pages, A4                                │  SVG pages, A4 print layout
   ▼  node/raster.js: headless Chrome, CPU raster ▼
clean 300 DPI PNG (2480 x 3508)
   │  degrade.py      photo: synthetic phone photo of FLAT paper, JPEG q70, 3000 px tall    scan: 150 or 200 DPI grey, JPEG q60
   ▼
page images  ──►  engine alone: Audiveris 5.11 ─► .mxl ──►  metrics.py (omr.*)   ──►  results.json  ──► check against / write a baseline
             └─►  app path: the app's own Import.load (the helper, or none) ─► the Score the app plays ─► the same metrics
```

## Run it (on the PC that has Audiveris)

```
pip install -r tests/omr/requirements.txt      # verovio, numpy, opencv, PyMuPDF (pinned to what the baselines were measured with)
# Node 24 + puppeteer: the main worktree's node_modules is found by itself (or PPP_BENCH_NODE_MODULES)
# Audiveris 5.11: PPP_AUDIVERIS, --audiveris, <repo>/tools/audiveris/Audiveris/Audiveris.exe, or the same in the main worktree

python tests/bench/run.py omr-live-2 cases --check                    # the 60 excerpts still are what the corpus registry gives
python tests/bench/run.py omr-live-2 determinism                      # render the S1 pages 3 times (in order, reversed, rotated): every byte equal?
python tests/bench/run.py omr-live-2 run --cases s1 --jobs 2          # the design document's 15 pages, all tiers
python tests/bench/run.py omr-live-2 run                              # all 60 excerpts, all tiers (engine alone); ~530 pages, about an hour on an idle PC with --jobs 3
python tests/bench/run.py omr-live-2 check                            # last run against tests/omr/baselines/audiveris-5.11.0.json (exit 1 = regression)
python tests/bench/run.py omr-live-2 baseline --reason "..."          # record the last full run as the baseline (refused for a partial or timed-out run)

python tests/bench/run.py omr-live-2 run --mode app                   # the same pages through Import.load with the helper (Audiveris), 6 pieces
python tests/bench/run.py omr-live-2 run --mode app-nohelper          # ... with no helper: the browser draft reader, i.e. what the live site does today
python tests/bench/run.py omr-live-2 run --mode app --omr v2          # ... with PPP.omr = 'v2' (G12-1: omr/normalize.js keeps what the engine read; G12-2: the import is a ScoreGraph, PdfLayer's findings are its edits); results in out/app-v2/
python tests/bench/run.py omr-live-2 run --mode app --omr v2 --replay --cases all --base-url http://127.0.0.1:PORT   # ... with no engine: the page is told what Audiveris wrote in an earlier engine-alone run (out/engine), so two trees' pages (a `git archive` of main on one port, this tree on another) are compared on the same engine output; results in out/app-v2-replay/
node tests/omr/node/s4-stats.js --check                              # no browser: every engine document through normalize + the ScoreGraph importer: refusals, repairs, beams (G12-2)
python tests/bench/run.py omr-live-2 run --normalize --cases s1       # engine alone, each case's files read through omr/normalize.js (diagnostic; never a baseline)
python tests/bench/run.py omr-live-2 fetch-real --check               # the real-scan tier (offline); see below
```

`--cases` is `all`, `tune`, `held`, `s1`, `s1-app` or a list of ids (`hymns/silent-night,method_beyer_012,tag:collection:hanon`). `--tiers` is a
list of `clean-A clean-B scan150-A scan150-B scan200-A scan200-B photo-A photo-B brace-less`. Anything missing prints `SKIPPED: <reason>` and exits 0 (`--require-env`:
2), like the other environment tiers (`run.py omr-live`). A page whose inputs did not change is not rendered or read again (`--force`).
Page images, engine output and results are written under `tests/omr/out/` (git-ignored) and are **never committed**.

**Run it on a quiet PC.** Audiveris gives each processing step of a page 120 s and drops the page when a step is slower; with every core busy
(measured: 4 pages at a time beside a 14-thread job) pages are lost that way. The tool passes `-option org.audiveris.omr.Main.sheetStepTimeOut=1800`
(an on-time page is unchanged), records any page that still times out as `timed_out`, never reuses it as an answer, and refuses to record a baseline
from a run that has one. `--jobs 1` is the timing the design document measured (3-13 s a page when idle).

## What is in it

| tier | pages | notes |
| --- | --- | --- |
| `clean-A` | 60 excerpts x up to 24 bars (1,169 bars), Verovio, A4 300 DPI | hymns, Beyer, Czerny 599 / 849, Hanon, Burgmuller, sonatinas, catalogue; every metre and key the pool has |
| `clean-B` | the same excerpts, PPP's own print path | title area and page numbers, as PPP prints them |
| `scan150-A`, `scan150-B` | clean-A / clean-B at 150 DPI grey, JPEG q60 | PPP's print sets a 7 mm staff: 10 px an interline at 150 DPI, which Audiveris refuses ("a too low interline value of 10 pixels ... Sheet ignored"), so `scan150-B` reads nothing: a fact about the engine, kept in the numbers |
| `scan200-A`, `scan200-B` | the same at 200 DPI (14 px an interline) | with the two above, merged as the `scan` tier |
| `photo-A`, `photo-B` | clean-A / clean-B as a synthetic phone photo of flat paper (perspective, 1.5 degrees, uneven light, blur, noise, 3000 px, JPEG q70) | merged as the `photo` tier. No page curl, no shadow, no glare: a real photo is worse |
| `brace-less` | the 4 G0 fixtures (`tests/fixtures`) | a thin bracket instead of a brace, bar lines that do not cross the staves: issues 11 and 12. Engine alone reads the PNG and the JPG; the app path reads all four |
| real-scan | public-domain scans of the very editions the catalogue was transcribed from | **not in G12-0's numbers**: the fetch script is written, the list is empty (below) |

The case list is `tests/omr/cases.json`, built by `omrbench/cases.py` from the corpus registry: licence-clean sets only, never a G0 hold-out file,
never a quarantined one; the 15 pages of the design document's section 1 (`s1`) are always in; every time signature and key the pool has is present;
each collection is filled to its quota in the order of a hash of the id. **30 % (18) of the excerpts are the held-out half** (`split: held`):
quoted as a number in every report, never read case by case (a baseline keeps per-case rows for the tuning half only). The 6 pieces the app path
is run on are tagged `s1-app`.

## The metrics (`omrbench/metrics.py`)

The read is aligned to the truth bar by bar (dynamic programming on note sets, a pair counts at similarity >= 0.2, the G0 rule), notes are matched on
(pitch, onset) inside aligned bars. A bar is **exactly right** when pitches, onsets, durations and rests all match; an output bar is **wrong**
unless it is aligned to a truth bar it reproduces exactly.

| metric | meaning |
| --- | --- |
| `omr.note_f1` (+ `_precision`, `_recall`, `.micro`) | note F1 over all staves; the aggregate is the mean of the cases' F1 (a case that read nothing counts 0) |
| `omr.played_f1` | what the app plays: the app's hand rule (the first part with two staves, else the LAST part; other parts are silent). In app mode: the notes whose hand is not `x` |
| `omr.bar_exact` | exact bars / truth bars, **pooled** over the tier ("168 of 267"); `omr.bar_exact.macro` is the mean of the cases' rates |
| `omr.measure_alignment_rate` | truth bars with an aligned output bar |
| `omr.bar_count_exact`, `omr.time_ok`, `omr.key_ok` | bar count, first time signature, first key |
| `omr.duration_acc`, `omr.staff_acc`, `omr.beam_kept` | among matched notes: same duration, same staff, beam kept |
| `omr.parts_ok`, `omr.parts_fragmented` | the staves per part equal the truth's (`2` = one grand-staff part); several parts of one staff each (issue 11) |
| `omr.div0` | the file has `<divisions>0</divisions>` (read as 1 by both of the app's readers: every half note a quarter, E8) |
| `omr.flag.<rule>.recall` / `.precision` | a flag rule's suspect bars against the wrong bars. Rules: `app` (the app's Import.validate per bar), `voice` (also any voice that does not fill the bar). The hook for G12-3's flags and for the app's own report is `metrics.judge(..., external_flags={name: [bar index]})` |

Each is proven by a planted defect in `tests/bench/unit/test_omr2_metrics.py` (a dropped bar, a wrong staff, a halved duration, a missed flag, a
wrong pitch, fragmented parts, a misread metre and key, divisions 0).

Options of `run` that change how the engine's file is read, for diagnosis (not for baselines): `--divisions repair` (infer a zero `divisions` from
`<type>`, the G12-1 fix) and `--movements last` (one file per page, as the local helper keeps it today, E7). `--normalize` (G12-1) reads each case's
files through `omr/normalize.js` (`tests/omr/node/normalize-cli.js`: movements joined, divisions repaired, the grand staff the engine split rebuilt, the
PDF's systems folded), which is what the app does under `PPP.omr = 'v2'`; `--mode app --omr v2` runs the page itself in that mode.

## Baselines (`tests/omr/baselines/`)

`audiveris-5.11.0.json` is the engine alone on all 60 excerpts and every tier; per tier it holds the aggregates of the subsets `all`, `tune`, `held` and
`s1`, and the per-case metrics of the tuning half. `check` compares a run with it at a tolerance of 0.02 on a rate (one-sided: better is reported, not
failed); the same pages and the same engine give the same numbers to the sixth place on one machine, and the 0.02 is the A0 tolerance for another
machine's Chrome or OpenCV. The app-path baselines are `audiveris-5.11.0.app.json` (the helper) and `browser-draft.app.json` (no helper).

## Determinism

The same excerpt gives the same bytes in every run and in any order: the truth export, the Verovio SVG (given `xmlIdSeed`: without it Verovio draws random element ids), the PPP print SVG (Windows and Linux alike:
`tests/omr/node/ppp-print.test.js`), the PNG (Chrome's **GPU** raster draws the same SVG with a different anti-aliasing from one shot to the next,
measured, so `raster.js` runs with `--disable-gpu`: the CPU raster is byte-stable), the photo and the scan (NumPy `default_rng(seed)`, the seed a
function of (engraver, page), `degrade.py`), the JPEG. `omr-live-2 determinism` renders three times (in order, reversed, rotated) and compares every byte.
Another machine's Chrome, OpenCV or Verovio can still draw a pixel differently: the baseline stores the sha256 of each page-image set and `check`
says so when they differ.

## Reproducing section 1 of the design document (A0)

The 15 pages of section 1 are the `s1` subset. Audiveris 5.11 on them, the baseline's pages (CPU raster) against the document, and the same pages
with `OMR_CHROME_GPU=1` (the raster the document was measured on; this PC's GPU):

| tier (s1, 15 pages, 267 bars) | design document | `OMR_CHROME_GPU=1` | baseline (CPU raster) |
| --- | --- | --- | --- |
| clean-A | note F1 0.845, 168 bars exact (63 %) | 0.845, 168 (63 %) | 0.846, 169 (63 %) |
| photo-A | 0.616, 69 (26 %) | 0.616, 69 (26 %) | 0.627, 65 (24 %) |
| scan150-A | 0.756, 108 (40 %) | 0.756, 108 (40 %) | **0.721**, 100 (37 %) |

With the GPU raster the numbers of section 1 come out to the last digit, so the renderer, the degradations, the engine call and the metrics are
the document's. The CPU raster (the default, because it is byte-stable) draws thin lines slightly differently, and Audiveris reads the 150 DPI scans
of those pages differently: the scan tier of 15 pages moves by 0.035 (clean and photo stay within 0.011). Audiveris itself is deterministic (its output
for the same image is byte-identical in every run and with 3 pages in parallel: checked on all 17 scan pages of the document); what moves it is the page.
The 60-excerpt tiers average four times as many pages. If you need the document's own pixels, `OMR_CHROME_GPU=1` writes them to `out/render-gpu/`,
`out/engine-gpu/` (never mixed with the baseline's); its pages are not byte-stable from one run to the next, and a baseline is refused from them.

The app path on the same pieces (6 PDFs and 6 photos, the document's E1 and E9):

| app path | design document | omr-live-2 |
| --- | --- | --- |
| browser draft reader (no helper), 6 vector PDFs | 0 of 83 bars exactly right; played F1 0.07 / 0.09 / 0.62 / 0.45 / 0.31 / 0.33 | 0 of 83; the same six F1s (mean 0.311) |
| ... 6 phone photos | 5 refused, 1 read as 1 bar, F1 0.00 | the same |
| ... fixture `piano-clean.png` | F1 0.05 | 0.047 |
| Audiveris through the helper, fixtures PNG / JPG / multipage PDF | played F1 0.500, 32 of 48 notes silenced, "good", confidence 1.00, no suspect bar | the same (note F1 1.000: the engine read it all) |
| ... the fixture PDF | 16 bars for 8, one staff, confidence 0.80 | the same |
| ... 6 vector PDFs | 0 of 24 wrong bars flagged | 58 of 83 bars right, 25 wrong, 0 flagged |
| ... 6 phone photos | at most 5 of 59 wrong bars flagged (5 flagged) | 22 of 83 bars right, 7 flagged, all of them wrong (the photo pages differ) |

## What the CI gate runs

`tests/bench/unit/test_omr2_*.py` (in the existing unit-test step, no new step): the raw MusicXML reader, the truth export and the case list against the
registry, the metrics with their planted defects, the baseline logic and the files committed under `baselines/`, the degradation parameters (the pixel
half only where NumPy and OpenCV are installed), Audiveris's process handling with a stand-in program, the app-path Score judging, the real-scan
manifest rules, and `tests/omr/node/*.test.js` (PPP's print engraver is deterministic; the SVG sizing). Nothing there starts Audiveris, Chrome or the
network.

## Flags: which bars are suspect (G12-3)

`omr/flags.js` marks the bars of a `PPP.omr = 'v2'` import that may be wrong, and says why (design: section 8 and the record in section 23 of `docs/GOALS/G12_OMR.md`). It is fitted and judged
on a RECORDED engine run, with nothing rendered and nothing recognised again:

```
python tests/bench/run.py omr-live-2 flags-data                      # tests/omr/out/flags/{tune,held,truth,held-truth}.jsonl: every output bar, its signals, whether it is wrong
node tests/omr/node/flags-fit.js table                               # per-signal precision / recall on the TUNING half, and how often each fires on the truth files
node tests/omr/node/flags-fit.js fit [--record]                      # which signals are strong, which weak, every threshold (TUNING half only), 5-fold cross-validated inside it
node tests/omr/node/flags-fit.js eval --params tests/omr/flags/flags-fit.json            # a PARAMS on the tuning half
node tests/omr/node/flags-fit.js eval --params tests/omr/flags/flags-fit.json --half held # the held-out half: ONCE (a second run is refused; `record-held` puts the result in the record)
python tests/bench/run.py omr-live-2 run --mode app --omr v2 --replay --cases tune --tiers pdf-A,photo-A,scan200-A --base-url http://127.0.0.1:<port>
                                                                     # the same through the page itself (PdfLayer's bars per line, omr/apply.js): omr.flag.app.* is then the flags'
```

`flags-data` reads `tests/omr/out/engine/` (a run of `run`), `tests/omr/out/render/<case>/truth.musicxml` and writes the dataset; the fit tool reads only `tune.jsonl` and `truth.jsonl`,
and the held-out files are opened by `eval --half held` and by nothing else (the tool says so, and keeps a mark that it has been done). `tests/omr/flags/flags-fit.json` is the record:
the parameters `omr/flags.js` holds (a unit test compares them), the tuning numbers, the cross-validation, the signal table and, once, the held-out numbers.

## The real-scan tier

`omrbench/fetch_real.py` downloads public-domain page images of the editions the catalogue was transcribed from (Beyer, Peters, Leipzig 1895; Czerny
Op. 599, Schirmer, New York 1893 - `catalog/method/books.json`) to a git-ignored folder, by the id listed in `tests/omr/real-scan.json`. It downloads
nothing the host does not itself mark public domain (Commons: not copyrighted and a public-domain licence; IMSLP: "Copyright Status: Public Domain"
on the evidence page; the Internet Archive's IMSLP mirror: IMSLP's own file by its sha1, IMSLP's record "Public Domain" and the words of the work page),
checks every file against its pinned sha256, and never writes inside a tracked path. To add an entry: read the licence on the host's page; write the entry
(`real-scan.json` shows the shape) with a sha256 of 64 zeros; run `omr-live-2 fetch-real --pin ID --allow-network` (it asks the host, downloads once,
prints the sha256); look at the file; commit the entry.

```
python tests/bench/run.py omr-live-2 fetch-real --check                      # offline: the manifest is well formed
python tests/bench/run.py omr-live-2 fetch-real --fetch --allow-network      # 15.7 MB: both PDFs, verified on their hosts, the 20 listed pages rendered at 300 DPI
python tests/bench/run.py omr-live-2 run --tiers real-scan                   # Audiveris on them (any engine: --engine NAME)
```

**What is in it (G12-6).** Two entries: Beyer from Wikimedia Commons (the bytes of IMSLP #81208) and Czerny from the Internet Archive's copy of IMSLP
#105466 (IMSLP itself now answers a script with a CAPTCHA, which this tool does not try to pass). 20 pages make **18 cases** (two cases are two pages:
a piece runs over the page); a page is in when every piece on it is in the catalogue, registered, not a G0 hold-out, and nothing but those pieces is
engraved on it (the small note-name diagrams in Beyer's margins excepted: they are part of the page an engine sees). A case's truth is its pieces'
catalogue bars in page order (`omrbench/realscan.py`); 6 of the 18 (the smallest hashes) are the held-out half. Known differences between the scans
and the truth, the same for every engine: Czerny No. 49 has `8va` passages the catalogue writes at sounding pitch (an engine that reads the written
notes is an octave off there); Beyer's margin diagrams are notes that are not in the truth; the catalogue is the transcriber's reading of these very
pages (no bar was checked against them one by one for G12-6).

## The bake-off (G12-6: Audiveris against learned engines)

Each learned engine runs in its own Python environment outside the repository (packages and weights never committed); the repository holds a runner
for each (`tests/omr/engines/run_<name>.py`) and `omrbench/engines.py` starts it at below-normal priority, one process for many pages, stopping a page
that answers nothing for 900 s (by PID) and recording a page whose runner dies as crashed. The engines are used as shipped; what a runner adds is only
what it takes to get MusicXML out (its docstring says what). The SMT answers Humdrum kern, which `omrbench/kern.py` turns into MusicXML.

```
# environments (Windows 11, Python 3.13, RTX 5070 Ti; the commands of the record in docs/GOALS/G12_OMR.md section 25)
set PPP_OMR_HOMR_PYTHON=D:\PPP-omr-bakeoff\venv-homr\Scripts\python.exe        (homr 0.7.0 + onnxruntime-gpu 1.26.0)
set PPP_OMR_OEMER_PYTHON=D:\PPP-omr-bakeoff\venv-oemer\Scripts\python.exe      (oemer 0.1.8 + onnxruntime-gpu 1.26.0 + opencv-python-headless 4.14)
set PPP_OMR_SMT_PYTHON=D:\PPP-omr-bakeoff\venv-smt\Scripts\python.exe          (torch 2.11.0+cu128, transformers 4.49.0)
set PPP_OMR_SMT_SRC=D:\PPP-omr-bakeoff\src\smt                                 (a clone of github.com/antoniorv6/SMT)
set PPP_OMR_CUDA_DLLS=<a folder of CUDA 12 / cuDNN 9 DLLs, e.g. a torch +cu128 install's torch\lib>
set HF_HOME=D:\PPP-omr-bakeoff\hf-cache

python tests/bench/run.py omr-live-2 run --cases tune --tiers all+real                      # Audiveris, the tuning half (out/engine)
python tests/bench/run.py omr-live-2 run --engine homr --cases tune --tiers all+real        # each learned engine likewise (out/engine-homr, ...)
python tests/bench/run.py omr-live-2 bakeoff --half tune                                    # side by side, raw and normalised; NOT the gate
python tests/bench/run.py omr-live-2 run --engine homr --cases held --tiers all+real        # the held-out half (prints no numbers)
python tests/bench/run.py omr-live-2 bakeoff --half held --record tests/omr/bakeoff/g12-6.json   # gate A7, once (a second time is refused)
```

`bakeoff` reads nothing again: it scores the recorded page reads of each engine, the MusicXML as the engine wrote it ("raw") and through
`omr/normalize.js` ("normalised": what the app does under `PPP.omr = 'v2'`), and judges A7 on the normalised path of the held-out half.

## Files

| file | what |
| --- | --- |
| `omrbench/xmlscore.py` | raw MusicXML -> bars of notes (quirks kept: divisions 0, fragmented parts) |
| `omrbench/truth.py`, `cases.py`, `cases.json` | the truth export; the 60 excerpts and the brace-less fixtures |
| `omrbench/metrics.py`, `baseline.py` | the omr.* metrics; baseline recording and `check` |
| `omrbench/degrade.py`, `render.py`, `node/ppp-print.js`, `node/raster.js` | engravers, Chrome raster, photo / scan |
| `omrbench/engine.py`, `appmode.py`, `suite.py` | Audiveris alone, the app path, the CLI behind `run.py omr-live-2` |
| `omrbench/fetch_real.py`, `real-scan.json`, `omrbench/realscan.py` | the real-scan tier: the fetch script, its two entries, the cases and their truth (G12-6) |
| `omrbench/engines.py`, `engines/run_*.py`, `omrbench/kern.py`, `omrbench/bakeoff.py` | G12-6: the learned engines' runners and how they are started, the SMT's kern -> MusicXML, the bake-off and gate A7 |
| `bakeoff/g12-6.json` | G12-6: the bake-off's numbers (aggregates only), both halves |
| `omrbench/flagdata.py`, `node/flags-cli.js`, `node/flags-fit.js` | G12-3: the per-bar dataset of omr/flags.js on a recorded run, its CLI, the fit and the held-out judgement |
| `baselines/*.json` | committed numbers of Audiveris 5.11.0  |
