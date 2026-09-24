import copy
import unittest

from pppbench import compare, suite as suite_mod

V = {"reader": "reader/2", "metrics": "metrics/2", "sqi": "sqi/2", "generator": "perform/2"}


def results(sqi=80.0, hands=0.9, ties=4.0, tag_sqi=None, case_sqi=80.0, case_status="ok", usable=0.5, tag_cases=20):
    agg = {"sqi": {"mean": sqi, "n": 2}, "notation.hand.accuracy": {"mean": hands, "n": 2},
           "notation.ties.extra_per_100": {"mean": ties, "n": 2}, "usable": {"mean": usable, "n": 2},
           "errors": {"count": 0, "by_code": {}}, "cases": 2}
    tags = {"set:method": dict(agg, sqi={"mean": tag_sqi if tag_sqi is not None else sqi, "n": tag_cases}, cases=tag_cases),
            "set:hymns": dict(agg)}
    cases = [{"id": "a", "key": "k1", "tags": ["set:method"], "status": case_status,
              "error_code": None if case_status == "ok" else "NOTATE_NO_NOTES",
              "metrics": {"sqi": case_sqi, "usable": 1.0, "critical.meter": 1.0} if case_status == "ok" else {}},
             {"id": "b", "key": "k2", "tags": ["set:hymns"], "status": "ok", "error_code": None,
              "metrics": {"sqi": 80.0, "usable": 0.0, "critical.meter": 0.0}}]
    return {"suite": "t", "suite_sha256": "S", "lock_sha256": "L", "versions": dict(V), "filtered": False,
            "aggregates": {"all": agg, "by_tag": tags}, "cases": cases}


GATE = {"metrics": {"sqi": {"dir": "up", "tol": -0.30}, "notation.hand.accuracy": {"dir": "up", "tol": -0.003},
                    "notation.ties.extra_per_100": {"dir": "down", "tol": 0.5}, "usable": {"dir": "up", "tol": -0.005}},
        "subgroups": {"prefixes": ["set:"], "min_cases": 15, "metrics": {"sqi": "sqi", "usable": "rate"},
                      "sqi_abs": 1.0, "rate_abs": 0.02, "mean_abs": 0.01, "mean_per_case": 0.25},
        "case_fail_drop": 10.0, "case_warn_drop": 2.0, "case_flip_max": 0}


def base_of(r):
    return compare.baseline_from_results(r, {"git_sha": "x"}, reason="test", gate=GATE)


class Gate(unittest.TestCase):
    def test_unchanged_is_pass(self):
        r = results()
        v = compare.compare(r, base_of(r), GATE)
        self.assertEqual((v.status, v.exit_code), ("PASS", 0))
        self.assertEqual(v.failures + v.warnings + v.improvements, [])

    def test_aggregate_regression_fails(self):
        v = compare.compare(results(hands=0.896), base_of(results()), GATE)
        self.assertEqual((v.status, v.exit_code), ("REGRESSION", 1))
        self.assertIn("notation.hand.accuracy", v.failed_metrics)

    def test_down_metric_regression_fails(self):
        v = compare.compare(results(ties=4.6), base_of(results()), GATE)
        self.assertIn("notation.ties.extra_per_100", v.failed_metrics)

    def test_warning_is_half_the_tolerance(self):
        v = compare.compare(results(hands=0.898), base_of(results()), GATE)
        self.assertEqual(v.status, "PASS")
        self.assertTrue(any("notation.hand.accuracy" in w for w in v.warnings))

    def test_improvement(self):
        v = compare.compare(results(hands=0.95, ties=2.0), base_of(results()), GATE)
        self.assertEqual(v.status, "PASS")
        self.assertEqual(len(v.improvements), 2)

    def test_subgroup_catches_a_hidden_group_regression(self):
        # §17 M3: the overall score is unchanged but one group of 20 cases lost 1.5 points
        v = compare.compare(results(tag_sqi=78.5), base_of(results()), GATE)
        self.assertEqual(v.status, "REGRESSION")
        self.assertIn("tag:set:method", v.failed_metrics)

    def test_small_subgroups_are_left_to_the_case_rules(self):
        v = compare.compare(results(tag_sqi=78.5, tag_cases=5), base_of(results(tag_cases=5)), GATE)
        self.assertEqual(v.status, "PASS")

    def test_missing_output_is_a_regression_not_na(self):
        # §17 B1: a gated metric that had a value and now has none fails, at the aggregate and per case
        b = base_of(results())
        r = results()
        r["aggregates"]["all"]["usable"] = {"mean": None, "n": 0}
        v = compare.compare(r, b, GATE)
        self.assertEqual(v.status, "REGRESSION")
        self.assertIn("usable", v.failed_metrics)
        r = results()
        r["aggregates"]["all"]["usable"] = {"mean": 0.5, "n": 1}      # same mean, one case fewer
        self.assertIn("usable", compare.compare(r, b, GATE).failed_metrics)
        r = results()
        r["cases"][0]["metrics"]["critical.meter"] = None
        self.assertIn("coverage", compare.compare(r, b, GATE).failed_metrics)

    def test_critical_flips_and_micro_guard(self):
        b = base_of(results())
        r = results()
        r["cases"][0]["metrics"]["critical.meter"] = 0.0             # pass -> fail, rate otherwise untouched
        v = compare.compare(r, b, GATE)
        self.assertIn("flip:critical.meter", v.failed_metrics)
        lenient = dict(GATE, case_flip_max=1)
        self.assertEqual(compare.compare(r, b, lenient).status, "PASS")
        micro = copy.deepcopy(results())
        micro["cases"][0]["tags"] = ["set:micro"]
        micro["cases"][0]["metrics"]["notation.spelling.accuracy"] = 1.0
        bm = base_of(micro)
        worse = copy.deepcopy(micro)
        worse["cases"][0]["metrics"]["notation.spelling.accuracy"] = 0.99
        v = compare.compare(worse, bm, dict(GATE, case_flip_max=5))
        self.assertIn("micro:notation.spelling.accuracy", v.failed_metrics)

    def test_micro_note_shape_is_judged_by_its_mismatch_count(self):
        # G03 §28 m4 (micro M20): one tie piece merged, 8 mismatches of 109 symbols -> 8 of 108: the ratio falls, no
        # defect was added; a ninth mismatch fails
        micro = copy.deepcopy(results())
        micro["cases"][0]["tags"] = ["set:micro"]
        micro["cases"][0]["metrics"].update({"notation.note_shape.consistency": 1 - 8 / 109, "notation.note_shape.mismatches": 8.0})
        bm = base_of(micro)
        merged = copy.deepcopy(micro)
        merged["cases"][0]["metrics"].update({"notation.note_shape.consistency": 1 - 8 / 108})
        self.assertEqual(compare.compare(merged, bm, GATE).status, "PASS")
        worse = copy.deepcopy(micro)
        worse["cases"][0]["metrics"].update({"notation.note_shape.consistency": 1 - 9 / 109, "notation.note_shape.mismatches": 9.0})
        self.assertIn("micro:notation.note_shape.consistency", compare.compare(worse, bm, GATE).failed_metrics)
        # without the count (an old baseline) the ratio rule stands
        old = copy.deepcopy(micro)
        del old["cases"][0]["metrics"]["notation.note_shape.mismatches"]
        bo = base_of(old)
        merged_old = copy.deepcopy(merged)
        del merged_old["cases"][0]["metrics"]["notation.note_shape.mismatches"]
        self.assertIn("micro:notation.note_shape.consistency", compare.compare(merged_old, bo, GATE).failed_metrics)

    def test_known_failures_may_shrink_but_not_grow(self):
        kf = lambda n: {"classes": {"tie_without_stop": {"items": n, "files_affected": 1, "unit": "ties"}}}  # noqa: E731
        r = results()
        r["known_failures"] = kf(10)
        b = base_of(r)
        grown = results()
        grown["known_failures"] = kf(11)
        self.assertIn("known:tie_without_stop", compare.compare(grown, b, GATE).failed_metrics)
        fixed = results()
        fixed["known_failures"] = kf(0)
        v = compare.compare(fixed, b, GATE)
        self.assertEqual(v.status, "PASS")
        self.assertTrue(any("tie_without_stop" in i for i in v.improvements))

    def test_case_drop_and_new_error(self):
        v = compare.compare(results(case_sqi=69.0), base_of(results()), GATE)
        self.assertEqual(v.status, "REGRESSION")
        self.assertTrue(any("case a" in f for f in v.failures))
        v = compare.compare(results(case_sqi=77.0), base_of(results()), GATE)
        self.assertEqual(v.status, "PASS")
        self.assertTrue(any("case a" in w for w in v.warnings))
        v = compare.compare(results(case_status="error"), base_of(results()), GATE)
        self.assertEqual(v.status, "REGRESSION")
        self.assertTrue(any("now error" in f for f in v.failures))

    def test_errors_exit_2(self):
        b = base_of(results())
        self.assertEqual(compare.compare(results(), None, GATE).exit_code, 2)
        r = results()
        r["versions"] = dict(V, metrics="metrics/3")
        v = compare.compare(r, b, GATE)
        self.assertEqual((v.status, v.exit_code), ("ERROR", 2))
        self.assertIn("VERSION_MISMATCH", v.errors[0])
        r = results()
        r["lock_sha256"] = "other"
        self.assertIn("INPUT_DRIFT", compare.compare(r, b, GATE).errors[0])
        r = results()
        r["suite_sha256"] = "other"
        self.assertIn("SUITE_CHANGED", compare.compare(r, b, GATE).errors[0])
        r = results()
        r["filtered"] = True
        self.assertIn("FILTERED_RUN", compare.compare(r, b, GATE).errors[0])

    def test_baseline_keeps_anchor_and_history(self):
        b1 = base_of(results(sqi=80.0))
        b2 = compare.baseline_from_results(results(sqi=82.0), {"git_sha": "y"}, reason="better", previous=b1)
        self.assertEqual(b2["anchor"], b1["anchor"])
        self.assertEqual([h["reason"] for h in b2["history"]], ["test", "better"])
        self.assertEqual(b2["anchor"]["aggregates_all"]["sqi"]["mean"], 80.0)
        full = compare.baseline_from_results(results(), {}, reason="r", full=True)
        self.assertNotIn("cases", full)
        # a version change starts a new anchor: old and new definitions are not comparable
        r3 = results(sqi=70.0)
        r3["versions"] = dict(V, sqi="sqi/3")
        b3 = compare.baseline_from_results(r3, {"git_sha": "z"}, reason="new metric", previous=b2)
        self.assertEqual(b3["anchor"]["aggregates_all"]["sqi"]["mean"], 70.0)
        self.assertTrue(any("event" in h for h in b3["history"]))

    def test_committed_suites_use_the_documented_tolerances(self):
        core = suite_mod.load_suite("core")["gate"]
        m = core["metrics"]
        self.assertEqual(m["sqi"]["tol"], -0.30)
        self.assertEqual(m["usable"], {"dir": "up", "tol": -0.005})
        self.assertEqual(m["notes.identity.f1"]["tol"], -0.002)
        self.assertEqual(m["notation.ties.extra_per_100"], {"dir": "down", "tol": 0.5})
        for zero in ("read.bar_integrity", "struct.tempo.present", "struct.stats_consistent"):
            self.assertEqual(m[zero]["tol"], 0.0, zero)
        self.assertEqual(m["struct.measures.extra_empty_edge"], {"dir": "down", "tol": 0.0})
        for g in suite_mod.CRITICAL_KEYS:
            self.assertIn(g, m)
            self.assertEqual(core["subgroups"]["metrics"][g], "rate")
        self.assertEqual(core["subgroups"]["min_cases"], 15)
        self.assertIn("mode:", core["subgroups"]["prefixes"])
        self.assertEqual(core["case_flip_max"], 2)
        smoke = suite_mod.load_suite("smoke")["gate"]
        self.assertEqual(smoke["metrics"]["struct.time_sig.exact"]["tol"], -0.02)
        self.assertEqual(smoke["case_flip_max"], 1)


if __name__ == "__main__":
    unittest.main()
