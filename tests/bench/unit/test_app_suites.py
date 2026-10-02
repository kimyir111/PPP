"""G10a-0 step 1: the *-app suites run the options the app passes at its recording call sites.

The suite's ``stage.opts`` used to be hashed into the suite and otherwise ignored; it now reaches ``toMusicXml``."""

import os
import re
import unittest

from pppbench import corpus, runner, suite as suite_mod, util

APP_OPTS = {"closeGaps": True, "exactBars": True}
PAIRS = (("smoke", "smoke-app"), ("core", "core-app"), ("robust", "robust-app"))


class StageOptsReachTheSut(unittest.TestCase):
    def test_merge_rule(self):
        self.assertIsNone(runner.stage_case_opts({}, None))                       # no stage opts: nothing added
        self.assertEqual(runner.stage_case_opts({}, {"lock": 1}), {"lock": 1})    # existing suites: the row's opts
        self.assertEqual(runner.stage_case_opts(APP_OPTS, None), APP_OPTS)
        self.assertEqual(runner.stage_case_opts(APP_OPTS, {"lock": 1, "exactBars": False}),
                         {"closeGaps": True, "exactBars": False, "lock": 1})     # the row wins

    def test_app_suites_pass_the_options_and_the_base_suites_do_not(self):
        refs = corpus.load_corpus()
        for base, app in PAIRS:
            _, rows_b, perfs_b = runner.generate(suite_mod.load_suite(base), refs, filter_="micro/M01")
            _, rows_a, perfs_a = runner.generate(suite_mod.load_suite(app), refs, filter_="micro/M01")
            self.assertTrue(perfs_a, app)
            for p in perfs_b.values():
                self.assertEqual(p.opts, {"title": "bench"}, base)
            for p in perfs_a.values():
                self.assertEqual(p.opts, {"title": "bench", **APP_OPTS}, app)
            # the same performances, only the options differ: the app suite's inputs are the base suite's
            self.assertEqual({k: p.input for k, p in perfs_a.items()}, {k: p.input for k, p in perfs_b.items()})

    def test_the_app_suites_are_the_base_suites_with_the_app_options(self):
        for base, app in PAIRS:
            b, a = suite_mod.load_suite(base), suite_mod.load_suite(app)
            self.assertEqual(a["name"], app)
            self.assertEqual(a["stage"], {"name": "notate", "opts": APP_OPTS}, app)
            self.assertEqual(b["stage"]["opts"], {}, base)
            for k in ("references", "matrix", "subsets", "gate", "align", "kind"):
                self.assertEqual(a.get(k), b.get(k), f"{app}.{k}")

    def test_the_options_are_the_ones_the_app_passes(self):
        """The four recording call sites in the page pass closeGaps and exactBars (read from the page source)."""
        page = util.read_text(os.path.join(util.repo_root(), "Piano Coach App.dc.html"))
        calls = re.findall(r"toMusicXml\(\{.*?\}, \{(.*?)\}\);", page, flags=re.S)
        self.assertEqual(len(calls), 4)
        for opts in calls:
            self.assertIn("closeGaps: true", opts)
            self.assertIn("exactBars: true", opts)


if __name__ == "__main__":
    unittest.main()
