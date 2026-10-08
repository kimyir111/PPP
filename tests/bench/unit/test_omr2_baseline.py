"""omr-live-2: the baseline file and its check (tests/omr/omrbench/baseline.py, suite.py, the committed tests/omr/baselines/*.json). Standard
library only: the committed baselines are checked for shape and consistency here, never re-measured (that needs Audiveris)."""

import glob
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import omr2_synth  # noqa: E402,F401
from omrbench import baseline as B  # noqa: E402
from omrbench import cases as C  # noqa: E402
from omrbench import suite as SU  # noqa: E402
from pppbench import util  # noqa: E402

BASE_DIR = os.path.join(util.repo_root(), "tests", "omr", "baselines")


def agg(**kw):
    a = {"cases": 4, "failed": 0, "truth_bars": 40, "exact_bars": 20, "wrong_bars": 20, "omr.note_f1": 0.8, "omr.played_f1": 0.8,
         "omr.bar_exact": 0.5, "omr.measure_alignment_rate": 0.9, "omr.duration_acc": 0.9, "omr.staff_acc": 1.0,
         "omr.bar_count_exact": 0.75, "omr.parts_ok": 1.0, "omr.parts_fragmented": 0.0, "omr.time_ok": 0.9, "omr.key_ok": 1.0,
         "omr.flag.app.recall": 0.3, "omr.flag.app.precision": 0.9, "omr.flag.voice.recall": 0.7, "omr.flag.voice.precision": 0.9}
    a.update(kw)
    return a


def results(**tiers):
    t = {name: {"pages": 4, "subsets": {"all": a, "tune": a, "held": a, "s1": a},
                "cases": {"c1": {"split": "tune", "metrics": {"omr.note_f1": 0.8}, "counts": {}, "structure": "2"},
                      "c2": {"split": "held", "metrics": {"omr.note_f1": 0.7}, "counts": {}, "structure": "2"}}}
         for name, a in (tiers or {"clean-A": agg()}).items()}
    return {"schema": B.RESULTS_SCHEMA, "bench": "omr-live-2", "bench_version": 1, "mode": "engine", "engine": {"name": "audiveris", "version": "5.11.0"},
            "cases_sha256": "x", "inputs_sha256": {"c1|clean-A": "aa"}, "tiers": t}


class Check(unittest.TestCase):
    def test_the_same_numbers_pass(self):
        r = results()
        v = B.check(r, B.to_baseline(r, "test"))
        self.assertEqual(v["verdict"], "PASS")
        self.assertTrue(all(x["status"] == "ok" for x in v["rows"]))

    def test_a_drop_beyond_the_tolerance_is_a_regression_and_a_small_one_is_not(self):
        base = B.to_baseline(results(), "test")
        worse = results(**{"clean-A": agg(**{"omr.note_f1": 0.8 - 0.05})})
        v = B.check(worse, base)
        self.assertEqual(v["verdict"], "REGRESSION")
        self.assertTrue(any(r["metric"] == "omr.note_f1" and r["status"] == "REGRESSION" for r in v["rows"]))
        near = results(**{"clean-A": agg(**{"omr.note_f1": 0.8 - 0.015})})
        self.assertEqual(B.check(near, base)["verdict"], "PASS")

    def test_a_gain_is_reported_and_does_not_fail(self):
        base = B.to_baseline(results(), "test")
        v = B.check(results(**{"clean-A": agg(**{"omr.bar_exact": 0.7})}), base)
        self.assertEqual(v["verdict"], "PASS")
        self.assertTrue(any(r["status"] == "better" for r in v["rows"]))

    def test_a_metric_where_less_is_better(self):
        base = B.to_baseline(results(), "test")
        v = B.check(results(**{"clean-A": agg(**{"omr.parts_fragmented": 0.3})}), base)
        self.assertEqual(v["verdict"], "REGRESSION")
        self.assertEqual(B.check(results(**{"clean-A": agg(**{"omr.parts_fragmented": 0.0})}), base)["verdict"], "PASS")

    def test_a_missing_tier_or_a_metric_that_went_none_fails_and_a_new_tier_does_not(self):
        base = B.to_baseline(results(), "test")
        self.assertEqual(B.check(results(**{"photo-A": agg()}), base)["verdict"], "REGRESSION")
        self.assertEqual(B.check(results(**{"clean-A": agg(**{"omr.note_f1": None})}), base)["verdict"], "REGRESSION")
        two = results(**{"clean-A": agg(), "photo-A": agg()})
        v = B.check(two, base)
        self.assertEqual(v["verdict"], "PASS")
        self.assertTrue(any(r["status"] == "new" for r in v["rows"]))

    def test_notes_say_when_the_runs_are_not_comparable(self):
        base = B.to_baseline(results(), "test")
        r = results()
        r["bench_version"], r["mode"], r["cases_sha256"], r["inputs_sha256"] = 2, "app", "y", {"c1|clean-A": "bb"}
        notes = " ".join(B.check(r, base)["notes"])
        for word in ("bench_version", "mode", "case list", "page-image sets"):
            self.assertIn(word, notes)

    def test_the_text_report_names_the_regressions(self):
        base = B.to_baseline(results(), "test")
        text = B.format_check(B.check(results(**{"clean-A": agg(**{"omr.note_f1": 0.5})}), base))
        self.assertIn("REGRESSION", text)
        self.assertIn("omr.note_f1", text)


class Recording(unittest.TestCase):
    def test_a_baseline_keeps_per_case_rows_for_the_tuning_half_only(self):
        b = B.to_baseline(results(), "why")
        cases = b["tiers"]["clean-A"]["cases"]
        self.assertEqual(list(cases), ["c1"], "the held-out half is quoted as a number and not read case by case")
        self.assertEqual(b["reason"], "why")
        self.assertIn("held", b["tiers"]["clean-A"]["subsets"])

    def test_a_results_table_prints(self):
        text = B.table(results())
        self.assertIn("clean-A", text)
        self.assertIn("20/40", text)

    def test_the_baseline_file_names(self):
        self.assertTrue(SU.baseline_path("engine", "5.11.0").endswith("audiveris-5.11.0.json"))
        self.assertTrue(SU.baseline_path("app", "5.11.0").endswith("audiveris-5.11.0.app.json"))
        self.assertTrue(SU.baseline_path("app-nohelper").endswith("browser-draft.app.json"))


class SelectionAndTiers(unittest.TestCase):
    def test_case_selectors(self):
        doc = C.load()
        self.assertEqual(len(SU.select_cases(doc, "all")), 60)
        self.assertEqual(len(SU.select_cases(doc, "s1")), 15)
        self.assertEqual(len(SU.select_cases(doc, "s1-app")), 6)
        tune, held = SU.select_cases(doc, "tune"), SU.select_cases(doc, "held")
        self.assertEqual((len(tune), len(held)), (42, 18))
        one = SU.select_cases(doc, "hymns/silent-night,method_beyer_012")
        self.assertEqual([c["id"] for c in one], ["hymns/silent-night", "method/beyer/012"])
        self.assertEqual(len(SU.select_cases(doc, "tag:collection:hanon")), 3)
        with self.assertRaises(SystemExit):
            SU.select_cases(doc, "no-such-piece")

    def test_tiers(self):
        self.assertEqual(SU.parse_tiers("all"), list(SU.TIERS))
        self.assertEqual(SU.parse_tiers("clean-A,photo-B"), ["clean-A", "photo-B"])
        with self.assertRaises(SystemExit):
            SU.parse_tiers("clean-C")
        self.assertEqual(SU.tier_parts("scan-B"), ("scan", "B"))
        self.assertEqual(SU.tier_parts("brace-less"), ("fixture", "-"))


class Committed(unittest.TestCase):
    """Whatever baselines are committed must be well formed and about THIS case list."""

    def test_every_committed_baseline_is_consistent_with_the_case_list(self):
        files = sorted(glob.glob(os.path.join(BASE_DIR, "*.json")))
        for f in files:
            b = B.load(f)
            name = os.path.basename(f)
            self.assertEqual(b["schema"], B.SCHEMA, name)
            self.assertEqual(b["bench"], "omr-live-2", name)
            self.assertEqual(b["cases_sha256"], SU.cases_digest(), f"{name}: tests/omr/cases.json changed after this baseline was recorded")
            self.assertTrue(b["reason"], name)
            self.assertIn(b["mode"], SU.MODES, name)
            for tier, t in b["tiers"].items():
                self.assertIn("all", t["subsets"], f"{name} {tier}")
                for case, row in t["cases"].items():
                    self.assertIn("metrics", row, f"{name} {tier} {case}")
            doc = C.load()
            held = {c["case"] for c in doc["cases"] if c["split"] == "held"}
            for tier, t in b["tiers"].items():
                self.assertEqual(held & set(t["cases"]), set(), f"{name} {tier}: a held-out case is in the file")

    def test_the_engine_baseline_covers_every_tier(self):
        f = os.path.join(BASE_DIR, "audiveris-5.11.0.json")
        if not os.path.isfile(f):
            self.skipTest("no engine baseline committed yet")
        b = B.load(f)
        self.assertEqual(set(b["tiers"]), set(SU.TIERS) | set(SU.MERGED))
        self.assertEqual(b["engine"]["version"], "5.11.0")
        self.assertEqual(b["mode"], "engine")
        self.assertEqual(len(b["tiers"]["clean-A"]["subsets"]["all"]) > 5, True)
        self.assertEqual(b["tiers"]["clean-A"]["subsets"]["all"]["cases"], 60)
        self.assertEqual(b["tiers"]["clean-A"]["subsets"]["s1"]["cases"], 15)


if __name__ == "__main__":
    unittest.main()
