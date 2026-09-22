import argparse
import io
import unittest
from contextlib import redirect_stdout
from unittest import mock

from pppbench import corpus, perform, runner, suite as suite_mod, util


class SuiteAndLock(unittest.TestCase):
    def setUp(self):
        self.refs = corpus.load_corpus()
        self.smoke = suite_mod.load_suite("smoke")

    def test_case_counts(self):
        sub = self.smoke["subsets"]
        self.assertEqual(len(suite_mod.expand(self.smoke, self.refs)),
                         16 * 2 + len(sub["smoke-amt"]) + len(sub["smoke-rubato"]) + len(sub["smoke-pedal"]))
        core = suite_mod.load_suite("core")
        n = len(core["references"])
        expected = 3 * n + sum(len(core["subsets"][k]) for k in ("amt-subset", "rubato-subset", "pedal-subset"))
        self.assertEqual(len(suite_mod.expand(core, self.refs)), expected)
        full = suite_mod.load_suite("full")
        cases = suite_mod.expand(full, self.refs)
        hold = [c for c in cases if c.holdout]
        self.assertTrue(hold)
        self.assertEqual({c.seed for c in hold}, {11, 12})
        self.assertEqual({c.seed for c in cases if not c.holdout}, {1, 2})

    def test_open_suites_hold_no_holdout_reference(self):
        by = corpus.by_id(self.refs)
        for name in ("smoke", "core", "mutation"):
            s = suite_mod.load_suite(name)
            self.assertFalse([r for r in s["references"] if by[r].holdout], name)

    def test_holdout_rule(self):
        for e in self.refs:
            self.assertEqual(e.holdout, corpus.holdout_for(e.set, e.id), e.id)

    def test_committed_lock_matches_the_generator(self):
        _, rows, _ = runner.generate(self.smoke, self.refs)
        lock = util.load_json(suite_mod.lock_path(self.smoke))
        self.assertEqual(suite_mod.verify_lock(self.smoke, rows, lock), [])

    def test_one_changed_input_byte_is_input_drift(self):
        real = perform.perform

        def drifting(*a, **kw):
            p = real(*a, **kw)
            if a[1] == "micro/M01-waltz-3-4":
                p.input["notes"][0]["vel"] += 1   # a one-byte change in one generated input
            return p

        with mock.patch.object(perform, "perform", drifting):
            with self.assertRaises(runner.RunError) as e:
                runner.run_suite(self.smoke, quiet=True, write_cases=False)
            self.assertEqual(e.exception.code, "INPUT_DRIFT")
            self.assertIn("micro/M01-waltz-3-4|deadpan|none|s1: input_sha256", str(e.exception))
            args = argparse.Namespace(suite="smoke", suite_file=None, audio_score=None, out=None, filter=None,
                                      reveal_holdout=False, jobs=1)
            buf = io.StringIO()
            with redirect_stdout(buf):
                code = runner.cli_run(args)
            self.assertEqual(code, 2)
            self.assertIn("INPUT_DRIFT", buf.getvalue())

    def test_suite_sha_ignores_gate_and_description(self):
        a = dict(self.smoke)
        b = dict(self.smoke, gate={}, description="changed")
        self.assertEqual(suite_mod.suite_sha256(a), suite_mod.suite_sha256(b))
        c = dict(self.smoke, references=self.smoke["references"][:-1])
        self.assertNotEqual(suite_mod.suite_sha256(a), suite_mod.suite_sha256(c))

    def test_version_change_is_drift(self):
        _, rows, _ = runner.generate(self.smoke, self.refs)
        lock = dict(util.load_json(suite_mod.lock_path(self.smoke)), generator="perform/0")
        self.assertTrue(any("generator" in d for d in suite_mod.verify_lock(self.smoke, rows, lock)))
        self.assertEqual(suite_mod.verify_lock(self.smoke, rows, None)[0][:12], "no lock file")


if __name__ == "__main__":
    unittest.main()
