"""The rec-arrange suites (G10c-0, pppbench/recarrange.py, tests/bench/node/rec-arrange.js): what the one-note arranger does to recordings."""

import glob
import json
import os
import subprocess
import tempfile
import unittest

from pppbench import corpus, mutation, recarrange, stages, suite as suite_mod, sut as sut_mod, util
from pppbench.sg_roundtrip import xml_text
from pppbench import musicxml

NODE_DIR = os.path.join(util.bench_root(), "node")
ARRANGE_SUITES = ("rec-arrange-smoke", "rec-arrange-core", "rec-arrange-mutation", "rec-arrange-lead-mutation", "rec-arrange-full")
LEAD_GATED = ("rec-arrange-core", "rec-arrange-lead-mutation", "rec-arrange-full")     # the suites that have the v2-lead row (G10c-1a)


def gate_keys():
    from tools import make_rec_suites
    return make_rec_suites.ARRANGE_GATE.keys()


class Suites(unittest.TestCase):
    def test_the_committed_suites_are_the_generators(self):
        from tools import make_rec_suites
        for name, built in make_rec_suites.build_arrange().items():
            have = util.load_json(os.path.join(suite_mod.SUITES_DIR, name + ".json"))
            self.assertEqual(have, util.load_json_text(util.dumps_json(built)), name)

    def test_every_suite_asks_for_the_arranger_and_gates_every_metric(self):
        for name in ARRANGE_SUITES:
            s = suite_mod.load_suite(name)
            self.assertTrue(s["rec_arrange"], name)
            for k in gate_keys():
                self.assertIn(k, s["gate"]["metrics"], (name, k))
            for k, kind in s["gate"]["subgroups"]["metrics"].items():
                self.assertEqual(s["gate"]["metrics"][k]["dir"], "up", f"{name}: a subgroup drop is a regression, so only metrics better higher: {k}")

    def test_the_suites_with_the_lead_row_gate_its_metrics_and_only_they(self):
        from tools import make_rec_suites
        for name in ARRANGE_SUITES:
            s = suite_mod.load_suite(name)
            rows = {row["opt_name"] for row in s["matrix"]}
            for k in make_rec_suites.ARRANGE_LEAD_GATE:
                if name in LEAD_GATED:
                    self.assertIn("v2-lead", rows, name)
                    self.assertEqual(s["gate"]["metrics"][k], make_rec_suites.ARRANGE_LEAD_GATE[k], (name, k))
                else:
                    self.assertNotIn(k, s["gate"]["metrics"], (name, k))
                    self.assertNotIn("v2-lead", rows, name)
        # the lead row plays v2's very performances where v2 is also a row; the mutation suite has the lead row alone
        for name in ("rec-arrange-core", "rec-arrange-full"):
            lead = next(r for r in suite_mod.load_suite(name)["matrix"] if r["opt_name"] == "v2-lead")
            self.assertEqual(lead["perform_as"], "v2")
            self.assertEqual(lead["opts"]["recordingArrange"], "leadsheet")
        self.assertEqual([r["opt_name"] for r in suite_mod.load_suite("rec-arrange-lead-mutation")["matrix"]], ["v2-lead"])

    def test_the_core_suite_holds_the_real_amt_fixtures(self):
        s = suite_mod.load_suite("rec-arrange-core")
        self.assertEqual(s["replay_dirs"], ["replay-of"])
        refs = corpus.by_id(corpus.load_corpus())
        cases = recarrange.replay_cases(s, refs)
        # one case per fixture and per distinct stage-option row of the matrix (G10c-1a added the row v2-lead: the count is derived, not a number to edit)
        rows = {row["opt_name"] for row in s["matrix"]}
        fixtures = glob.glob(os.path.join(util.bench_root(), "replay-of", "*.json"))
        self.assertTrue(fixtures)                 # the real-AMT fixtures of replay-of (20 on 2026-10-07)
        self.assertEqual(len(cases), len(fixtures) * len(rows))
        self.assertEqual({c["id"].rsplit("|opt:", 1)[1] for c in cases}, rows)
        self.assertEqual(rows, {"app", "v2", "v2-lead"})
        # the replay fixtures and the new key change this suite's hash, and only the suites that have them: no other suite's moved
        plain = dict(s)
        del plain["replay_dirs"]
        self.assertNotEqual(suite_mod.suite_sha256(s), suite_mod.suite_sha256(plain))
        smoke = suite_mod.load_suite("smoke")
        self.assertEqual(suite_mod.suite_sha256(smoke), util.load_json(os.path.join(util.bench_root(), "baselines", "smoke.json"))["suite_sha256"])

    def test_the_arranger_trees_are_in_the_system_under_test(self):
        for tree in ("songgraph", "arrangement", "candidates", "repair", "realize", "critics", "playability", "difficulty"):
            self.assertIn(tree, sut_mod.SUT_TREES)
        files = sut_mod.sut_files(stages.default_audio_score())
        for f in ("candidates/index.js", "realize/index.js", "repair/index.js", "songgraph/voices.js"):
            self.assertIn(f, files)


class Mutations(unittest.TestCase):
    """Every rec-arrange metric has a planted defect that must be flagged by name (mutation-check --rec-arrange)."""

    def test_every_anchor_occurs_exactly_once(self):
        root = os.path.dirname(stages.default_audio_score())
        for m in mutation.REC_ARRANGE_MUTATIONS:
            with open(os.path.join(root, *mutation.target(m).split("/")), "rb") as handle:
                src = util.normalise_eol(handle.read()).decode("utf-8")
            for find, _ in mutation.edits(m):
                self.assertEqual(src.count(find), 1, m["id"])
            self.assertNotEqual(mutation.apply_mutation(src, m), src)

    def test_every_metric_is_named_by_a_mutation(self):
        named = {x for m in mutation.REC_ARRANGE_MUTATIONS for x in m["metrics"]}
        for metric in gate_keys():
            self.assertIn(metric, named, metric)
        for m in mutation.REC_ARRANGE_MUTATIONS:
            if m["expect"] == "REGRESSION":
                self.assertTrue(all(x.startswith("arr.") for x in m["metrics"]), m["id"])

    def test_ids_are_unique_and_the_noop_is_last(self):
        ids = [m["id"] for m in mutation.REC_ARRANGE_MUTATIONS]
        self.assertEqual(len(ids), len(set(ids)))
        self.assertEqual(mutation.REC_ARRANGE_MUTATIONS[-1]["id"], "MUT-NOOP")
        self.assertEqual(mutation.REC_ARRANGE_MUTATIONS[-1]["expect"], "PASS")


class LeadMutations(unittest.TestCase):
    """The lead sheet's planted defects (mutation-check --rec-arrange-lead, G10c-1a): anchors, names, the no-op last."""

    def test_every_anchor_occurs_exactly_once(self):
        root = os.path.dirname(stages.default_audio_score())
        for m in mutation.REC_ARRANGE_LEAD_MUTATIONS:
            with open(os.path.join(root, *mutation.target(m).split("/")), "rb") as handle:
                src = util.normalise_eol(handle.read()).decode("utf-8")
            for find, _ in mutation.edits(m):
                self.assertEqual(src.count(find), 1, m["id"])
            self.assertNotEqual(mutation.apply_mutation(src, m), src)

    def test_every_lead_metric_is_named_by_a_mutation(self):
        from tools import make_rec_suites
        named = {x for m in mutation.REC_ARRANGE_LEAD_MUTATIONS for x in m["metrics"]}
        for metric in make_rec_suites.ARRANGE_LEAD_GATE:
            self.assertIn(metric, named, metric)

    def test_ids_are_unique_and_the_noop_is_last(self):
        ids = [m["id"] for m in mutation.REC_ARRANGE_LEAD_MUTATIONS]
        self.assertEqual(len(ids), len(set(ids)))
        self.assertEqual(mutation.REC_ARRANGE_LEAD_MUTATIONS[-1]["id"], "MUT-NOOP")
        self.assertEqual(mutation.REC_ARRANGE_LEAD_MUTATIONS[-1]["expect"], "PASS")


class NodeMetrics(unittest.TestCase):
    def test_the_pure_metrics(self):
        proc = subprocess.run([stages.node_binary(), "--test", os.path.join(NODE_DIR, "rec-arrange.test.js")], capture_output=True)
        self.assertEqual(proc.returncode, 0, proc.stdout.decode("utf-8", "replace")[-2000:])


class OneCase(unittest.TestCase):
    """One small recording through the whole path: the numbers have the right shape, and the result is a function of the input."""

    @classmethod
    def setUpClass(cls):
        suite = suite_mod.load_suite("rec-arrange-smoke")
        refs = corpus.load_corpus()
        cls.by = corpus.by_id(refs)
        cls.jobs, _, cls.tags = recarrange.generate(suite, refs, "micro/M01-waltz-3-4|cover|none|s1|opt:app")

    def run_once(self):
        return recarrange.run_node(self.jobs, self.by, stages.default_audio_score())

    def test_a_case_is_measured_and_deterministic(self):
        self.assertEqual(len(self.jobs), 1)
        a, b = self.run_once(), self.run_once()
        row = a["results"][self.jobs[0]["id"]]
        self.assertTrue(row["ok"], row)
        m = row["metrics"]
        for k in gate_keys():
            self.assertIn(k, m, k)
        self.assertEqual(m["arr.made"], 1.0)
        for k in ("arr.melody.kept", "arr.melody.cross", "arr.melody.lost", "arr.melody.gap_rate", "arr.harmony.agreement", "arr.level.distinct",
                  "arr.level.distance", "arr.rh.above_c6", "src.melody.heard", "src.melody.in_lh"):
            self.assertTrue(0.0 <= m[k] <= 1.0, (k, m[k]))
        self.assertAlmostEqual(m["arr.melody.kept"] + m["arr.melody.cross"] + m["arr.melody.lost"], 1.0, places=9)
        self.assertEqual(json.dumps(a["results"], sort_keys=True), json.dumps(b["results"], sort_keys=True), "the same input gives the same rows")
        self.assertTrue(set(a["meta"]["sut_modules"]) <= set(sut_mod.sut_files(stages.default_audio_score())))
        self.assertIn("candidates/index.js", a["meta"]["sut_modules"])


if __name__ == "__main__":
    unittest.main()
