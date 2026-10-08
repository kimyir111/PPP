"""omr-live-2: the OMR benchmark of G12 (docs/GOALS/G12_OMR.md section 10; phase G12-0).

A licence-clean page is made from a catalogue score (Verovio, or PPP's own print path), degraded the same way every time
(clean 300 DPI, a synthetic phone photo of flat paper, a 150 DPI scan), read by an engine (Audiveris 5.11, alone, or through
the app's own Import.load) and judged against the exact MusicXML it was made from.

    xmlscore   raw MusicXML (.xml / .mxl) -> bars of notes, Audiveris quirks kept as they are (divisions 0 included)
    truth      a catalogue file -> the excerpt that is both the truth and the engraver's input (deterministic bytes)
    cases      which excerpts omr-live-2 holds, and which half of them is held out (deterministic from the corpus registry)
    metrics    the omr.* metrics: bar alignment, note F1, exact bars, part structure, the flag hooks
    degrade    clean / photo / scan150 (parameters pure, pixels numpy + OpenCV)
    render     truth -> engraver -> page images (cached by the inputs' hash)
    engine     Audiveris 5.11 as a separate process, one page at a time
    appmode    the same pages through the app's Import.load (the helper, or none = what production does)
    suite      run / check / baseline: `python tests/bench/run.py omr-live-2 ...`
    fetch_real the real-scan tier: public-domain page images fetched by id to a scratch path, never committed

Everything that needs only the standard library (xmlscore, truth, cases, metrics, the parameter half of degrade, the
baseline logic) is unit-tested in the CI gate (tests/bench/unit/test_omr2_*.py); the rest needs Verovio, NumPy, OpenCV,
Chrome (puppeteer) and Audiveris and is a LOCAL / nightly-on-the-user's-PC tool (tests/omr/README.md).
"""

BENCH = "omr-live-2"
BENCH_VERSION = 1            # bump when a change makes numbers of an older baseline not comparable
