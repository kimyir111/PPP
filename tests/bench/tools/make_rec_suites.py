#!/usr/bin/env python3
"""Write the recording suites (G10a-0, docs/GOALS/G10 section 7.6): rec-smoke, rec-core, rec-robust, rec-full,
rec-mutation (the sensitivity check of the recording metrics), rec-mutation-v2 (G10a-1: of the v2 time skeleton and, from
G10a-2, of its grid stage) and rec-grid (G10a-2: v2 with and without its grid stage, rec/grid.js), rec-hands and rec-keys (measurement suites of S4 and S8 on the app's path), and G10c-0's rec-arrange-smoke,
rec-arrange-core, rec-arrange-mutation and rec-arrange-full (what the one-note arranger does to recordings: docs/GOALS/G10
section 9; tests/bench/pppbench/recarrange.py); G10c-1a adds the row v2-lead (the lead sheet of a recording) to rec-arrange-core and
-full, and the suite rec-arrange-lead-mutation (docs/GOALS/G10 section 33).

    python tests/bench/tools/make_rec_suites.py            # writes tests/bench/suites/rec-*.json
    python tests/bench/tools/make_rec_suites.py --check    # the committed files are this tool's output (exit 1 if not)

Every suite sets ``"rec": true`` (the recording metrics of metrics/rec.py are computed) and runs the humanizer's
families on the references of smoke / core / full, in the three stage-option sets of docs/GOALS/G10 section 7.6:
``legacy`` (the library default, ``{}``), ``app`` (what the app passes today, closeGaps + exactBars) and, from G10a-1,
``v2`` (the app's options with the recording conversion v2, ``recording: 'v2'``: what the app passes when
PPP.recording is 'v2': the app's default since G10a-5b, 2026-10-06; G10a-4 made the switch). The beats axis is ``none`` (production: the browser's onset tracker) and
``oracle-noisy`` (the helper's beats). The three option sets see the same base performance, but the +of / +helper
overlays and the oracle-noisy beats are drawn on streams named by the option name (G10a-2 found it): those rows of
different option sets are different draws. A row with ``perform_as`` plays the performance of the named option set
(rec-hands, G10a-2: the app's very performances with only the hands swapped).
"""

import argparse
import copy
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

from pppbench import corpus, suite as suite_mod, util  # noqa: E402

util.setup_stdio()
OPTS = {"legacy": {}, "app": {"closeGaps": True, "exactBars": True}, "v2": {"closeGaps": True, "exactBars": True, "recording": "v2"}}
# G10a-2 (docs/GOALS/G10 section 8, stage S3): v2's grid stage is rec/grid.js; `v2-s3legacy` is v2 with G10a-1's stage S3 (the
# legacy quantiser, opts.grid 'legacy'), so a suite shows the grid stage's own effect on the very same performances and skeleton
GRID_OPTS = {"v2-s3legacy": {"closeGaps": True, "exactBars": True, "recording": "v2", "grid": "legacy"}, "v2": OPTS["v2"]}
# G10a-2 stage S4 in isolation: the app's path (the legacy time skeleton and grid) with only the hands of rec/hands.js
# (opts.hands 'v2'). Its own suite, rec-hands, a measurement suite (not in the CI gate: v2's rows carry S4 there)
HANDS_OPTS = {"app-hands": {"closeGaps": True, "exactBars": True, "hands": "v2"}}
# G10a-3 stage S8 in isolation (rec/key.js, docs/GOALS/G10 section 22): v2 with the legacy key and spelling (`v2-keylegacy`, opts.keys
# 'legacy': the arm before S8) and the app's path with only S8 swapped (`app-keys`, opts.keys 'v2'). Its own suite, rec-keys, a measurement
# suite (nightly, not in the CI gate); each row plays the performance of the option set it is compared with (perform_as)
KEYS_OPTS = {"v2-keylegacy": {"closeGaps": True, "exactBars": True, "recording": "v2", "keys": "legacy"},
             "app-keys": {"closeGaps": True, "exactBars": True, "keys": "v2"}}
KEYS_AS = {"v2-keylegacy": "v2", "app-keys": "app"}
# G10a-3 stage S9 in isolation (rec/pedal.js, docs/GOALS/G10 section 23): v2 writing every heard pedal span (`v2-pedallegacy`, opts.pedal
# 'legacy': the arm before the policy) and the app's path with only S9 swapped (`app-pedal`, opts.pedal 'v2'). Its own suite, rec-pedal, a
# measurement suite (nightly, not in the CI gate); each row plays the performance of the option set it is compared with (perform_as)
PEDAL_OPTS = {"v2-pedallegacy": {"closeGaps": True, "exactBars": True, "recording": "v2", "pedal": "legacy"},
              "app-pedal": {"closeGaps": True, "exactBars": True, "pedal": "v2"}}
PEDAL_AS = {"v2-pedallegacy": "v2", "app-pedal": "app"}
# G10a-2b (docs/GOALS/G10 section 26): what the hand split asks of the hands, on the references as written and re-voiced as piano covers
# are (texture "octaves", pppbench/texture.py: single notes doubled in octaves, hands kept). `v2-handslegacy` is v2 with the classic hand
# split (opts.hands 'legacy': the Song Arranger's one-time fallback), on v2's very performances (perform_as "v2")
PLAY_OPTS = {"app": OPTS["app"], "v2": OPTS["v2"], "v2-handslegacy": {"closeGaps": True, "exactBars": True, "recording": "v2", "hands": "legacy"}}
PLAY_AS = {"v2-handslegacy": "v2"}
PLAY = [("cover", "none")]
PLAY_TEXTURES = (None, "octaves")
# the rec.hands.* metrics (pppbench/metrics/rec.py, only in a suite with "hands_play"): a crossing rate is guarded to a tenth of the
# arranger's limit, the hard violations to a quarter per 100 bars
PLAY_GATE = {"rec.hands.crossing": {"dir": "down", "tol": 0.001}, "rec.hands.hard_per_100_bars": {"dir": "down", "tol": 0.25},
             "rec.hands.line_velocity_per_100_bars": {"dir": "down", "tol": 0.25}}

# (profile, beats): the rows of each tier
SMOKE = [("cover", "none"), ("cover-pedal", "none"), ("human-real", "none")]
CORE = [("cover", "none"), ("cover", "oracle-noisy"), ("cover-pedal", "none"), ("human-real", "none"), ("cover+of", "none"),
        ("cover-pedal+helper", "oracle-noisy")]
ROBUST = [("cover-alt", "none"), ("cover-alt", "oracle-noisy")]
MUTATION = [("cover", "none"), ("human", "oracle")]    # human + oracle beats: the family where G0 passes a quarter of the cases, so rec.usable can move
FULL = [("cover", "none"), ("cover-pedal", "none"), ("human-real", "none"), ("swing", "none"), ("cover+of", "none"),
        ("cover-pedal+helper", "oracle-noisy")]
# rec-grid (G10a-2): v2's grid stage on the very same performances and skeleton with and without rec/grid.js: the beats given
# (oracle: the grid stage is judged where the time skeleton is right), the swing family (long-short eighths, written straight),
# the browser model's error overlay, and the production path (beats none). The oracle-noisy rows are in rec-core: their beat
# noise is drawn per options name, so they would not pair here
GRID = [("cover", "oracle"), ("human-real", "oracle"), ("cover+of", "oracle"), ("swing", "oracle"), ("cover", "none")]

# rec-mutation-keys (G10a-3): the planted defects of S8 (mutation-check --rec). The rows are the families where S8's decisions show: a
# cover-pedal piece, the browser model's overlay and helper-like beats, which rec-mutation's two rows lack (the tied-over accidental
# defect needs them); v2 only, and four more references where that defect shows (Czerny 849/006, 011, 013, sonatina 010)
KEY_MUTATION = [("cover", "none"), ("cover-pedal", "none"), ("cover+of", "none"), ("cover", "oracle-noisy")]
KEY_MUTATION_EXTRA = ["method/czerny849/006", "method/czerny849/011", "method/czerny849/013", "method/sonatina/010"]
# rec-pedal (G10a-3): the families that have a pedal (the performer's own, and the helper's invented one); rec-mutation-pedal: the same on the
# rec-mutation references (a compound piece among them: the tick unit of the marks), v2 options only
PEDAL_ROWS = [("cover-pedal", "none"), ("cover-pedal+helper", "oracle-noisy")]

REC_GATE = {
    "rec.usable": {"dir": "up", "tol": -0.005},
    "rec.mv2h": {"dir": "up", "tol": -0.005},
    "rec.onset_f1": {"dir": "up", "tol": -0.005},
    "rec.metre.f1": {"dir": "up", "tol": -0.005},
    "rec.voice.f1": {"dir": "up", "tol": -0.005},
    "rec.harmony.agreement": {"dir": "up", "tol": -0.01},
    "rec.rest.precision": {"dir": "up", "tol": -0.005},
    "rec.rest.recall": {"dir": "up", "tol": -0.01},
    "rec.rest.false_per_100_bars": {"dir": "down", "tol": 0.25},
    "rec.tuplet.precision": {"dir": "up", "tol": -0.01},
    "rec.tuplet.recall": {"dir": "up", "tol": -0.01},
    "rec.tuplet.false_per_100_beats": {"dir": "down", "tol": 0.25},
    "rec.stability": {"dir": "down", "tol": 0.01},
}
for _c in range(1, 8):
    REC_GATE[f"rec.check.{_c}"] = {"dir": "down", "tol": 0.05}     # per 100 bars: the acceptance classes
REC_SUB = {"rec.usable": "rate", "rec.mv2h": "mean", "rec.onset_f1": "mean", "rec.rest.precision": "mean",
           "rec.voice.f1": "mean"}


# the G0 metrics a recording suite keeps in its gate (and so in the per-case rows of its baseline): the critical gates and
# the metrics a recording is judged by; the rest of G0's list is for the library-default suites
KEEP = ("usable", "critical.", "sqi", "notes.identity.f1", "notes.onset.f1_50ms", "notation.ioi.accuracy", "notation.onset_pos.accuracy",
        "notation.onset_pos.accuracy_ref", "notation.duration.accuracy", "notation.duration.page_accuracy", "notation.hand.accuracy",
        "notation.tuplets.f1", "notation.tuplets.false_per_100", "notation.ties.extra_per_100", "struct.time_sig.exact",
        "struct.tempo.ok_effective", "struct.downbeat.f1", "struct.measures.count_exact", "struct.stats_consistent",
        "read.bar_integrity", "read.bar_completeness", "notation.note_shape.consistency", "struct.form.order_exact")


# G10a-3 (S9): the pedal metrics a recording suite guards besides critical.pedal: F1 and the false marks per minute (G10 issue 17: a pedal the performer
# never played blurs the practice audio). rec-full (the nightly aggregate baseline, holdout=True) keeps its gate as it was
PEDAL_KEEP = ("notation.pedal.f1", "notation.pedal.false_per_min")


def gate(base: dict, scale: float = 1.0, holdout: bool = False) -> dict:
    g = copy.deepcopy(base)
    g["metrics"] = {k: v for k, v in g["metrics"].items()
                    if k in KEEP or k.startswith("critical.") or (k in PEDAL_KEEP and not holdout)}
    g["subgroups"]["metrics"] = {k: v for k, v in g["subgroups"]["metrics"].items() if k in g["metrics"]}
    g["metrics"].update({k: {"dir": v["dir"], "tol": round(v["tol"] * scale, 6)} for k, v in REC_GATE.items()})
    g["subgroups"]["metrics"].update(REC_SUB)
    g["subgroups"]["prefixes"] = list(base["subgroups"]["prefixes"]) + ["opts:"] + (["holdout"] if holdout else [])
    return g


def rows(table, seeds, names=None, opts_table=None, perform_as=None, textures=(None,)):
    out = []
    for profile, beats in table:
        for texture in textures:
            for name, opts in (opts_table or OPTS).items():
                if names is not None and name not in names:
                    continue
                row = {"profile": profile, "beats": beats, "seeds": seeds, "opt_name": name, "opts": opts}
                pa = perform_as.get(name) if isinstance(perform_as, dict) else perform_as
                if pa:
                    row["perform_as"] = pa              # the very performance of the rows named perform_as (pppbench/suite.py Case)
                if texture:
                    row["texture"] = texture            # the reference re-voiced (pppbench/texture.py; G10a-2b)
                out.append(row)
    return out


def play_gate() -> dict:
    g = gate(suite_mod.GATE_CORE, holdout=True)
    g["metrics"].update(copy.deepcopy(PLAY_GATE))
    g["subgroups"]["prefixes"] = list(g["subgroups"]["prefixes"]) + ["texture:"]
    return g


def build() -> dict:
    smoke = suite_mod.load_suite("smoke")
    core = suite_mod.load_suite("core")
    full = suite_mod.load_suite("full")
    refs_by = corpus.by_id(corpus.load_corpus())
    mutation_refs = sorted(set([r for r in core["references"] if r.startswith("micro/")] + core["subsets"]["amt-subset"]))
    base = {"schema": "ppp.bench-suite/1", "kind": "synthetic-notation", "stage": {"name": "notate", "opts": {}},
            "align": {"window_s": 0.30}, "rec": True, "subsets": {}}
    return {
        "rec-smoke": dict(base, name="rec-smoke", references=smoke["references"], matrix=rows(SMOKE, [1]),
                          description="G10 recording smoke: the 16 smoke references x cover, cover-pedal, human-real (beats none) x "
                                      "stage options legacy / app / v2; the recording metrics (rec.*) on top of G0's",
                          gate=gate(suite_mod.GATE_SMOKE, 4.0)),
        "rec-core": dict(base, name="rec-core", references=core["references"], matrix=rows(CORE, [1]),
                         description="G10 recording gate: the core references x the calibrated humanizer's families (cover, cover-pedal, "
                                     "human-real, and the browser model's and the helper's error overlays; swing is in rec-full) x beats none "
                                     "(production) / oracle-noisy (helper) x stage options legacy / app / v2",
                         gate=gate(suite_mod.GATE_CORE)),
        "rec-robust": dict(base, name="rec-robust", references=core["references"], matrix=rows(ROBUST, [1]),
                           description="G10 recording robustness: the core references x cover-alt, an independent family (triangular "
                                       "jitter, no voicing, early-release-heavy; not calibrated), beats none / oracle-noisy, "
                                       "legacy / app / v2",
                           gate=gate(suite_mod.GATE_CORE)),
        "rec-mutation": dict(base, name="rec-mutation", references=mutation_refs,
                             matrix=rows(MUTATION, [1], ("legacy", "app")),
                             description="Gate sensitivity of the recording metrics (mutation-check --rec): the 24 micro pieces and 60 core "
                                         "references x cover (beats none), human (oracle beats) x legacy / app",
                             gate=gate(suite_mod.GATE_CORE)),
        "rec-mutation-v2": dict(base, name="rec-mutation-v2", references=mutation_refs,
                                matrix=rows(MUTATION, [1], ("v2",)),
                                description="Gate sensitivity of the v2 time skeleton (G10a-1, mutation-check --rec): the rec-mutation "
                                            "references and rows with the v2 options only",
                                gate=gate(suite_mod.GATE_CORE)),
        "rec-mutation-keys": dict(base, name="rec-mutation-keys", references=sorted(set(mutation_refs + KEY_MUTATION_EXTRA)),
                                  matrix=rows(KEY_MUTATION, [1], ("v2",)),
                                  description="Gate sensitivity of the key and spelling stage S8 (G10a-3, mutation-check --rec): the rec-mutation "
                                              "references and four more, cover / cover-pedal / cover+of (beats none) and cover (oracle-noisy), v2 options only",
                                  gate=gate(suite_mod.GATE_CORE)),
        "rec-pedal": dict(base, name="rec-pedal", references=core["references"],
                          matrix=rows(PEDAL_ROWS, [1], opts_table=PEDAL_OPTS, perform_as=PEDAL_AS),
                          description="G10a-3 stage S9 in isolation (a measurement suite, nightly, not in the CI gate): rec-core's pedal families "
                                      "(cover-pedal, cover-pedal+helper) with v2 and every heard pedal span written (v2-pedallegacy, opts.pedal "
                                      "'legacy') and with the app's options and only the pedal policy of rec/pedal.js (app-pedal, opts.pedal 'v2'); "
                                      "the very performances of the v2 / app rows",
                          gate=gate(suite_mod.GATE_CORE)),
        "rec-mutation-pedal": dict(base, name="rec-mutation-pedal", references=mutation_refs,
                                   matrix=rows(PEDAL_ROWS, [1], ("v2",)),
                                   description="Gate sensitivity of the pedal policy S9 (G10a-3, mutation-check --rec): the rec-mutation references x "
                                               "cover-pedal (beats none) and cover-pedal+helper (oracle-noisy), v2 options only",
                                   gate=gate(suite_mod.GATE_CORE)),
        "rec-hands": dict(base, name="rec-hands", references=core["references"],
                          matrix=rows(CORE + ROBUST, [1], opts_table=HANDS_OPTS, perform_as="app"),
                          description="G10a-2 stage S4 in isolation (a measurement suite, not in the CI gate): rec-core's and "
                                      "rec-robust's cases with the app's options and only the hands of rec/hands.js (opts.hands "
                                      "'v2'); the very performances of their opts:app rows, so tools/hands_ab.py compares them case by case",
                          gate=gate(suite_mod.GATE_CORE)),
        "rec-keys": dict(base, name="rec-keys", references=core["references"],
                         matrix=rows(CORE + ROBUST, [1], opts_table=KEYS_OPTS, perform_as=KEYS_AS),
                         description="G10a-3 stage S8 in isolation (a measurement suite, nightly, not in the CI gate): rec-core's and rec-robust's "
                                     "cases with v2 and the legacy key and spelling (v2-keylegacy, opts.keys 'legacy') and with the app's options "
                                     "and only the key stage of rec/key.js (app-keys, opts.keys 'v2'); the very performances of their v2 / app "
                                     "rows, so the rec-core / rec-robust rows are the other arm",
                         gate=gate(suite_mod.GATE_CORE)),
        "rec-hands-play": dict(base, name="rec-hands-play", hands_play=True,
                               references=sorted(set(core["references"]) | {r for r in full["references"] if refs_by[r].holdout}),
                               holdout_seeds=[11], matrix=rows(PLAY, [1], opts_table=PLAY_OPTS, perform_as=PLAY_AS, textures=PLAY_TEXTURES),
                               description="G10a-2b: what the hand split asks of the hands (a measurement suite, nightly, not in the CI gate). The core "
                                           "references and the 52 hold-out references (seed 11) as written and re-voiced as piano covers are (texture "
                                           "octaves: single notes doubled in octaves, hands kept) x cover (beats none) x the app's options / v2 / v2 with "
                                           "the classic hand split (v2-handslegacy, v2's very performances); the recording metrics and rec.hands.* (the "
                                           "written hands' crossing rate and their G5a hard violations, node/rec-hands-play.js)",
                               gate=play_gate()),
        "rec-mutation-play": dict(base, name="rec-mutation-play", hands_play=True, references=mutation_refs,
                                  matrix=rows(PLAY, [1], ("v2",), textures=("octaves",)),
                                  description="Gate sensitivity of S4's playability (G10a-2b, mutation-check --rec): the rec-mutation references "
                                              "re-voiced as piano covers are (texture octaves) x cover (beats none), v2 options only",
                                  gate=play_gate()),
        "rec-full": dict(base, name="rec-full", references=full["references"], holdout_seeds=[11, 12], matrix=rows(FULL, [1, 2]),
                         description="Nightly/manual: every lint-clean reference, hold-out included (seeds 11, 12), x the humanizer's "
                                     "families x legacy / app / v2; the hold-out is reported as an aggregate",
                         gate=gate(suite_mod.GATE_FULL, holdout=True)),
        "rec-grid": dict(base, name="rec-grid", references=core["references"], matrix=rows(GRID, [1], opts_table=GRID_OPTS),
                         description="G10a-2 grid stage (S3, rec/grid.js): the core references x the humanizer's families with the beats "
                                     "given (oracle) and as production finds them (none), the swing family included, x stage options "
                                     "v2-s3legacy (v2 with G10a-1's legacy quantisers) / v2 (v2 with rec/grid.js)",
                         gate=gate(suite_mod.GATE_CORE)),
    }

# ----------------------------------------------------------------------------- rec-arrange (G10c-0)
# The gate of the arranger-on-recordings suites. Every case is deterministic, so a tolerance is the size of change a phase may make without a new
# baseline (about one case in a suite of 60); the rates a guard is meant to move (the melody's gap rate, cross and lost shares) are tight.
ARRANGE_GATE = {
    "arr.made": {"dir": "up", "tol": -0.002},
    "arr.melody.kept": {"dir": "up", "tol": -0.002},
    "arr.melody.cross": {"dir": "down", "tol": 0.002},
    "arr.melody.lost": {"dir": "down", "tol": 0.002},
    "arr.melody.gap_rate": {"dir": "down", "tol": 0.002},
    "arr.harmony.agreement": {"dir": "up", "tol": -0.005},
    "arr.level.distinct": {"dir": "up", "tol": -0.01},
    "arr.level.distance": {"dir": "up", "tol": -0.01},
    "arr.lh.notes_per_bar": {"dir": "down", "tol": 0.05},
    "arr.rh.above_c6": {"dir": "down", "tol": 0.003},
    "arr.hard.violations": {"dir": "down", "tol": 0.0},
}
for _c in range(1, 8):
    ARRANGE_GATE[f"arr.check.{_c}"] = {"dir": "down", "tol": 0.05}
# the subgroup check reads a drop as a regression, so only the metrics that are better higher are listed
ARRANGE_SUB = {"arr.made": "mean", "arr.melody.kept": "mean", "arr.harmony.agreement": "mean", "arr.level.distinct": "mean",
               "arr.level.distance": "mean"}
# The arranger is measured on what the app writes (closeGaps + exactBars: `app`) and on the recording conversion v2 it will write after G10a-4 (`v2`);
# the library default (`legacy`) is not what any app path passes, so the gate suites leave it out (the one-off three-way table is in the G10 doc, section 17)
ARRANGE_ROWS = ("app", "v2")
# G10c-1a (docs/GOALS/G10 section 33): the row `v2-lead` arranges the recording from its lead sheet (rec/leadsheet.js, opts.recordingArrange 'leadsheet')
# on v2's very performances (perform_as "v2"). Only a suite that has the row carries the lead sheet's gate metrics: the melody F1 against the true
# melody of the lead sheet's own line (ls.*) and of the arrangement's right hand, exact pitch and pitch class; the old rows never have them (a rate that
# does not exist is not a regression), so the gate of the smoke, mutation and play suites is exactly what it was
ARRANGE_LEAD_OPTS = {"v2-lead": {"closeGaps": True, "exactBars": True, "recording": "v2", "recordingArrange": "leadsheet"}}
ARRANGE_LEAD_AS = {"v2-lead": "v2"}
ARRANGE_LEAD_GATE = {
    "ls.melody.f1": {"dir": "up", "tol": -0.01},
    "ls.melody.f1pc": {"dir": "up", "tol": -0.01},
    "arr.melody.f1pc": {"dir": "up", "tol": -0.01},
}


def arrange_gate(scale: float = 1.0, lead: bool = False) -> dict:
    table = dict(ARRANGE_GATE, **ARRANGE_LEAD_GATE) if lead else ARRANGE_GATE
    return {
        "metrics": {k: {"dir": v["dir"], "tol": round(v["tol"] * scale, 6)} for k, v in table.items()},
        "subgroups": {"prefixes": ["set:", "profile:"], "min_cases": 8, "metrics": dict(ARRANGE_SUB),
                      "rate_abs": 0.02, "mean_abs": 0.01, "mean_per_case": 0.25},
        "case_fail_drop": 10.0, "case_warn_drop": 2.0, "case_flip_max": 1,
    }


def arrange_rows(table, seeds, names=ARRANGE_ROWS, opts_table=None, perform_as=None, texture=None):
    out = []
    for profile, beats in table:
        for name in names:
            row = {"profile": profile, "beats": beats, "seeds": seeds, "opt_name": name, "opts": (opts_table or OPTS)[name]}
            if perform_as and perform_as.get(name):
                row["perform_as"] = perform_as[name]
            if texture:
                row["texture"] = texture
            out.append(row)
    return out


def arrange_core_references(core: dict) -> list:
    """The references of rec-arrange-core: the core's small and middle-sized pieces, stratified (one arrangement of a 1,000-note sonatina costs a
    minute; the gate has a time budget). Every micro piece, the catalogue and the sample, then by a fixed hash order: hymns, and a few of each
    method book (hanon, the book whose melody crosses the hand split most, in full)."""
    refs = corpus.by_id(corpus.load_corpus())
    size = {}
    for r in core["references"]:
        size[r] = len(corpus.read_reference(refs[r]).played())
    ids = list(core["references"])
    pick = [r for r in ids if r.startswith(("micro/", "catalog/", "samples/"))]

    def take(pred, n, max_notes=None):
        pool = [r for r in ids if pred(r) and (max_notes is None or size[r] <= max_notes)]
        return sorted(pool, key=lambda r: (util.fnv1a32("arr|" + r), r))[:n]
    pick += take(lambda r: r.startswith("hymns/"), 10, 260)
    for book, n, cap in (("beyer", 5, None), ("czerny599", 5, 260), ("burgmuller25", 4, 400), ("hanon", 8, None), ("czerny849", 2, 700), ("sonatina", 2, 800)):
        pick += take(lambda r, b=book: r.startswith(f"method/{b}/"), n, cap)
    return sorted(set(pick))


ARRANGE_SMOKE = [("cover", "none"), ("cover+of", "none")]
ARRANGE_CORE = [("cover", "none")]
ARRANGE_FULL = [("cover", "none")]


def build_arrange() -> dict:
    smoke = suite_mod.load_suite("smoke")
    core = suite_mod.load_suite("core")
    base = {"schema": "ppp.bench-suite/1", "kind": "synthetic-notation", "stage": {"name": "notate", "opts": {}},
            "align": {"window_s": 0.30}, "rec_arrange": True, "subsets": {}}
    core_refs = arrange_core_references(core)
    return {
        "rec-arrange-smoke": dict(base, name="rec-arrange-smoke", references=smoke["references"], matrix=arrange_rows(ARRANGE_SMOKE, [1]),
                                  description="G10c-0 smoke: the 16 smoke references x cover, cover+of (the browser model's errors), beats none, with the app's "
                                              "options and with the recording conversion v2, arranged the way the app does at the three levels and measured against the true score (melody, harmony, "
                                              "levels, left hand, register, hard violations, checker classes)",
                                  gate=arrange_gate(4.0)),
        "rec-arrange-core": dict(base, name="rec-arrange-core", references=core_refs,
                                 matrix=arrange_rows(ARRANGE_CORE, [1]) + arrange_rows(ARRANGE_CORE, [1], tuple(ARRANGE_LEAD_OPTS), ARRANGE_LEAD_OPTS, ARRANGE_LEAD_AS),
                                 replay_dirs=["replay-of"],
                                 description="G10c-0 gate: the small and middle-sized core references (every micro piece, the catalogue, hymns, method books; hanon "
                                             "in full) x cover (beats none, the app's options and v2), plus the 20 real-AMT fixtures of replay-of (the production browser "
                                             "model's heard notes on rendered audio), arranged at the three levels and measured against the true score; "
                                             "G10c-1a adds the row v2-lead: the same performances as v2, arranged from the lead sheet of the recording "
                                             "(plan.recordingArrange leadsheet, docs/GOALS/G10 section 33)",
                                 gate=arrange_gate(1.0, lead=True)),
        "rec-arrange-mutation": dict(base, name="rec-arrange-mutation",
                                     references=sorted(r for r in core["references"] if r.startswith("micro/")) + ["method/hanon/005", "method/hanon/007"],
                                     matrix=arrange_rows([("cover", "none")], [1], ("app",)),
                                     description="Gate sensitivity of the rec-arrange metrics (mutation-check --rec-arrange): the 24 micro pieces and two hanon "
                                                 "exercises x cover, with the app's options",
                                     gate=arrange_gate(1.0)),
        "rec-arrange-lead-mutation": dict(base, name="rec-arrange-lead-mutation",
                                          references=sorted(r for r in core["references"] if r.startswith("micro/")) + ["method/hanon/005", "method/hanon/007"],
                                          matrix=arrange_rows([("cover", "none")], [1], tuple(ARRANGE_LEAD_OPTS), ARRANGE_LEAD_OPTS),
                                          description="Gate sensitivity of the lead sheet of a recording (mutation-check --rec-arrange-lead, G10c-1a): the 24 micro pieces and two hanon "
                                                      "exercises x cover, v2, arranged from the lead sheet (plan.recordingArrange leadsheet)",
                                          gate=arrange_gate(1.0, lead=True)),
        "rec-arrange-play": dict(base, name="rec-arrange-play", references=core_refs,
                                 matrix=arrange_rows(ARRANGE_CORE, [1], ("v2", "v2-handslegacy"), PLAY_OPTS, PLAY_AS, "octaves"),
                                 description="G10a-2b: is a recording of a piano cover arrangeable without the Song Arranger's hands fallback? rec-arrange-core's "
                                             "references re-voiced as piano covers are (texture octaves, pppbench/texture.py) x cover (beats none) x v2 / v2 with "
                                             "the classic hand split (v2-handslegacy: the fallback, v2's very performances), arranged at the three levels "
                                             "(arr.made: the levels made without a refusal). The truth the melody and harmony are measured against is the "
                                             "reference as written (its octaves are not doubled): read arr.made and arr.hard.violations here (nightly)",
                                 gate=arrange_gate(1.0)),
        "rec-arrange-full": dict(base, name="rec-arrange-full", references=core["references"],
                                 matrix=arrange_rows(ARRANGE_FULL, [1]) + arrange_rows(ARRANGE_FULL, [1], tuple(ARRANGE_LEAD_OPTS), ARRANGE_LEAD_OPTS, ARRANGE_LEAD_AS),
                                 description="Nightly: every core reference x cover with the app's options and v2, arranged and measured (aggregates only); "
                                             "G10c-1a adds the row v2-lead: the same performances as v2, arranged from the lead sheet of the recording "
                                             "(plan.recordingArrange leadsheet, docs/GOALS/G10 section 33)",
                                 gate=arrange_gate(1.0, lead=True)),
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()
    bad = 0
    suites = dict(build())
    suites.update(build_arrange())
    for name, s in suites.items():
        path = os.path.join(suite_mod.SUITES_DIR, name + ".json")
        if args.check:
            have = util.load_json(path) if os.path.exists(path) else None
            same = have == util.load_json_text(util.dumps_json(s))
            print(("same " if same else "DIFFERS ") + name)
            bad += not same
        else:
            util.dump_json(s, path)
            print(f"wrote suites/{name}.json: {len(s['references'])} references")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
