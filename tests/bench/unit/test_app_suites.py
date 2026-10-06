"""G10a-0 step 1: the *-app suites run the options the app passes at its recording call sites.

The suite's ``stage.opts`` used to be hashed into the suite and otherwise ignored; it now reaches ``toMusicXml``."""

import json
import os
import subprocess
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
        """The six recording call sites in the page (the import, "Rewrite the rhythm", the review screen's arrangement, the rhythm rewrite, G10a-4's
        "Write the notation again" and the one-note arranger's fallback conversions) pass closeGaps and exactBars IN EACH BRANCH of their condition: the classic
        options and v2's (PPP.recording 'v2' adds `recording: 'v2'` and nothing else). tests/recording-v2-callsites.js reads the page source (each call's
        argument list, parentheses balanced) and evaluates the options for the flag false and true; a regex over the whole call cannot tell
        `Object.assign({.., exactBars: true}, v2 ? {recording: 'v2'} : {})` from `Object.assign({..}, v2 ? {recording: 'v2', exactBars: true} : {})`."""
        out = subprocess.run(["node", os.path.join(util.repo_root(), "tests", "recording-v2-callsites.js"), "--json", util.repo_root()],
                             capture_output=True, text=True, encoding="utf-8")
        self.assertEqual(out.returncode, 0, out.stderr)
        calls = json.loads(out.stdout)
        self.assertEqual(len(calls), 6)
        for c in calls:
            for branch in ("classic", "v2"):
                self.assertIs(c[branch].get("closeGaps"), True, f"{branch}: {c['call']}")
                self.assertIs(c[branch].get("exactBars"), True, f"{branch}: {c['call']}")
        # the classic branch never asks for v2 (G10a-5b: the one-note arranger's fallback is ONE call site that converts a refused v2 transcription's heard notes again, first with v2's options
        # and the classic hands - its v2 branch - then the classic way - its classic branch); only that call says `hands`, and only in its v2 branch
        for c in calls:
            self.assertNotIn("recording", c["classic"], c["call"])
            self.assertNotIn("hands", c["classic"], c["call"])
        fallback = [c for c in calls if c["v2"].get("hands") == "legacy"]
        self.assertEqual(len(fallback), 1)
        self.assertEqual(fallback[0]["v2"].get("recording"), "v2")
        # v2 is asked for by one option and nothing else changes; five of the six can ask for it ("Rewrite the rhythm" states the metre itself,
        # which v2 does not take from a person: it is the classic writer's, always)
        self.assertEqual(sum(1 for c in calls if c["v2"].get("recording") == "v2"), 5)
        self.assertEqual(len([c for c in calls if "lock" in c["v2"] and "recording" not in c["v2"]]), 1)


if __name__ == "__main__":
    unittest.main()
