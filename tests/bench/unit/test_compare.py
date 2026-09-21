import copy
import unittest

from pppbench import compare, suite as suite_mod

V = {"reader": "reader/1", "metrics": "metrics/1", "sqi": "sqi/1", "generator": "perform/1"}


def results(sqi=80.0, hands=0.9, ties=4.0, tag_sqi=None, case_sqi=80.0, case_status="ok"):
    agg = {"sqi": {"mean": sqi, "n": 2}, "notation.hand.accuracy": {"mean": hands, "n": 2},
           "notation.ties.extra_per_100": {"mean": ties, "n": 2}, "errors": {"count": 0, "by_code": {}}, "cases": 2}
    tags = {"set:micro": dict(agg, sqi={"mean": tag_sqi if tag_sqi is not None else sqi, "n": 1}),
            "set:hymns": dict(agg)}
    cases = [{"id": "a", "key": "k1", "tags": ["set:micro"], "status": case_status,
              "error_code": None if case_status == "ok" else "NOTATE_NO_NOTES",
              "metrics": {"sqi": case_sqi} if case_status == "ok" else {}},
             {"id": "b", "key": "k2", "tags": ["set:hymns"], "status": "ok", "error_code": None, "metrics": {"sqi": 80.0}}]
    return {"suite": "t", "suite_sha256": "S", "lock_sha256": "L", "versions": dict(V), "filtered": False,
            "aggregates": {"all": agg, "by_tag": tags}, "cases": cases}


GATE = {"metrics": {"sqi": {"dir": "up", "tol": -0.30}, "notation.hand.accuracy": {"dir": "up", "tol": -0.003},
                    "notation.ties.extra_per_100": {"dir": "down", "tol": 0.5}},
        "tag_guards": {"metric": "sqi", "min_delta": -1.0, "tags": ["set:micro", "set:hymns"]},
        "case_fail_drop": 10.0, "case_warn_drop": 2.0}


def base_of(r):
    return compare.baseline_from_results(r, {"git_sha": "x"}, reason="test")


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

    def test_tag_guard_catches_a_hidden_group_regression(self):
        # the overall SQI is unchanged but one group lost 1.5 points
        v = compare.compare(results(tag_sqi=78.5), base_of(results()), GATE)
        self.assertEqual(v.status, "REGRESSION")
        self.assertIn("tag:set:micro", v.failed_metrics)

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
        r["versions"] = dict(V, metrics="metrics/2")
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

    def test_committed_suites_use_the_documented_tolerances(self):
        core = suite_mod.load_suite("core")["gate"]["metrics"]
        self.assertEqual(core["sqi"]["tol"], -0.30)
        self.assertEqual(core["notes.identity.f1"]["tol"], -0.002)
        self.assertEqual(core["notation.ties.extra_per_100"], {"dir": "down", "tol": 0.5})
        self.assertEqual(core["read.bar_integrity"]["tol"], 0.0)
        smoke = suite_mod.load_suite("smoke")["gate"]["metrics"]
        self.assertEqual(smoke["struct.time_sig.exact"]["tol"], -0.04)


if __name__ == "__main__":
    unittest.main()
