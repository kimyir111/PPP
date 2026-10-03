#!/usr/bin/env python3
"""Write the recording suites (G10a-0, docs/GOALS/G10 section 7.6): rec-smoke, rec-core, rec-robust, rec-full,
rec-mutation (the sensitivity check of the recording metrics) and rec-mutation-v2 (G10a-1: of the v2 time skeleton).

    python tests/bench/tools/make_rec_suites.py            # writes tests/bench/suites/rec-*.json
    python tests/bench/tools/make_rec_suites.py --check    # the committed files are this tool's output (exit 1 if not)

Every suite sets ``"rec": true`` (the recording metrics of metrics/rec.py are computed) and runs the humanizer's
families on the references of smoke / core / full, in the three stage-option sets of docs/GOALS/G10 section 7.6:
``legacy`` (the library default, ``{}``), ``app`` (what the app passes today, closeGaps + exactBars) and, from G10a-1,
``v2`` (the app's options with the recording conversion v2, ``recording: 'v2'``: what the app will pass when
PPP.recording is 'v2', G10a-4). The beats axis is ``none`` (production: the browser's onset tracker) and
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

from pppbench import suite as suite_mod, util  # noqa: E402

util.setup_stdio()
OPTS = {"legacy": {}, "app": {"closeGaps": True, "exactBars": True}, "v2": {"closeGaps": True, "exactBars": True, "recording": "v2"}}
# G10a-2 stage S4 in isolation: the app's path (the legacy time skeleton and grid) with only the hands of rec/hands.js
# (opts.hands 'v2'). Its own suite, rec-hands, a measurement suite (not in the CI gate: v2's rows carry S4 there)
HANDS_OPTS = {"app-hands": {"closeGaps": True, "exactBars": True, "hands": "v2"}}

# (profile, beats): the rows of each tier
SMOKE = [("cover", "none"), ("cover-pedal", "none"), ("human-real", "none")]
CORE = [("cover", "none"), ("cover", "oracle-noisy"), ("cover-pedal", "none"), ("human-real", "none"), ("cover+of", "none"),
        ("cover-pedal+helper", "oracle-noisy")]
ROBUST = [("cover-alt", "none"), ("cover-alt", "oracle-noisy")]
MUTATION = [("cover", "none"), ("human", "oracle")]    # human + oracle beats: the family where G0 passes a quarter of the cases, so rec.usable can move
FULL = [("cover", "none"), ("cover-pedal", "none"), ("human-real", "none"), ("swing", "none"), ("cover+of", "none"),
        ("cover-pedal+helper", "oracle-noisy")]

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


def gate(base: dict, scale: float = 1.0, holdout: bool = False) -> dict:
    g = copy.deepcopy(base)
    g["metrics"] = {k: v for k, v in g["metrics"].items() if k in KEEP or k.startswith("critical.")}
    g["subgroups"]["metrics"] = {k: v for k, v in g["subgroups"]["metrics"].items() if k in g["metrics"]}
    g["metrics"].update({k: {"dir": v["dir"], "tol": round(v["tol"] * scale, 6)} for k, v in REC_GATE.items()})
    g["subgroups"]["metrics"].update(REC_SUB)
    g["subgroups"]["prefixes"] = list(base["subgroups"]["prefixes"]) + ["opts:"] + (["holdout"] if holdout else [])
    return g


def rows(table, seeds, names=None, opts_table=None, perform_as=None):
    out = []
    for profile, beats in table:
        for name, opts in (opts_table or OPTS).items():
            if names is not None and name not in names:
                continue
            row = {"profile": profile, "beats": beats, "seeds": seeds, "opt_name": name, "opts": opts}
            if perform_as:
                row["perform_as"] = perform_as      # the very performance of the rows named perform_as (pppbench/suite.py Case)
            out.append(row)
    return out


def build() -> dict:
    smoke = suite_mod.load_suite("smoke")
    core = suite_mod.load_suite("core")
    full = suite_mod.load_suite("full")
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
        "rec-hands": dict(base, name="rec-hands", references=core["references"],
                          matrix=rows(CORE + ROBUST, [1], opts_table=HANDS_OPTS, perform_as="app"),
                          description="G10a-2 stage S4 in isolation (a measurement suite, not in the CI gate): rec-core's and "
                                      "rec-robust's cases with the app's options and only the hands of rec/hands.js (opts.hands "
                                      "'v2'); the very performances of their opts:app rows, so tools/hands_ab.py compares them case by case",
                          gate=gate(suite_mod.GATE_CORE)),
        "rec-full": dict(base, name="rec-full", references=full["references"], holdout_seeds=[11, 12], matrix=rows(FULL, [1, 2]),
                         description="Nightly/manual: every lint-clean reference, hold-out included (seeds 11, 12), x the humanizer's "
                                     "families x legacy / app / v2; the hold-out is reported as an aggregate",
                         gate=gate(suite_mod.GATE_FULL, holdout=True)),
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()
    bad = 0
    for name, s in build().items():
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
