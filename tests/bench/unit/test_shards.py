"""Sharded runs (tests/bench/README.md, "Sharded runs"): ``run --shard K/N`` and ``merge-shards``.

A big suite (rec-full: 11,196 cases) runs as a CI matrix of shards. The merge has to be the whole run: these tests run
a small recording suite whole and as three shards and compare the bytes of results.json, and check that a merge refuses
anything that is not exactly one complete run of this commit."""

import argparse
import io
import json
import os
import tempfile
import unittest
from contextlib import redirect_stdout

from pppbench import corpus, runner, suite as suite_mod, util

REFS = ["micro/M01-waltz-3-4", "micro/M02-alberti-4-4"]
ROWS = [("cover", "legacy"), ("cover", "app"), ("cover", "v2"), ("human-real", "v2")]     # 2 references x 4 rows x 1 seed = 8 cases


class SelectShard(unittest.TestCase):
    def test_parse(self):
        self.assertEqual(runner.parse_shard("2/4"), (2, 4))
        self.assertEqual(runner.parse_shard("1/1"), (1, 1))
        for bad in ("0/4", "5/4", "2", "a/b", "2/0", "-1/3", "1/2/3", ""):
            with self.assertRaises(runner.RunError, msg=bad) as e:
                runner.parse_shard(bad)
            self.assertEqual(e.exception.code, "BAD_SHARD")

    def test_the_shards_partition_the_cases_in_balance(self):
        cases = [f"c{i:05d}" for i in range(11196)]
        for n in (1, 2, 3, 4, 7):
            parts = [runner.select_shard(cases, (k, n)) for k in range(1, n + 1)]
            self.assertEqual(sorted(x for p in parts for x in p), cases)             # a partition: nothing twice, nothing lost
            self.assertLessEqual(max(map(len, parts)) - min(map(len, parts)), 1)       # and as even as it gets
        self.assertEqual(runner.select_shard(cases, None), cases)
        self.assertEqual(runner.select_shard(cases, (1, 1)), cases)

    def test_a_shard_keeps_the_suite_order(self):
        cases = [f"c{i:02d}" for i in range(10)]
        self.assertEqual(runner.select_shard(cases, (2, 3)), ["c01", "c04", "c07"])

    def test_the_real_rec_full_is_split_into_even_shards_by_reference_mix(self):
        suite = suite_mod.load_suite("rec-full")
        cases = suite_mod.expand(suite, corpus.load_corpus())
        parts = [runner.select_shard(cases, (k, 4)) for k in range(1, 5)]
        self.assertEqual(sum(map(len, parts)), len(cases))
        self.assertLessEqual(max(map(len, parts)) - min(map(len, parts)), 1)
        for p in parts:                                                                # every shard sees every family of the matrix
            self.assertEqual({c.opt_name for c in p}, {"legacy", "app", "v2"})
            self.assertGreaterEqual(len({c.profile for c in p}), 5)
            self.assertTrue(any(c.holdout for c in p))                                     # and some hold-out


class MergeIsTheWholeRun(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory(prefix="pppbench-shard-")
        cls.dir = cls.tmp.name
        base = suite_mod.load_suite("rec-smoke")
        base.pop("_path")
        small = dict(base, name="shard-test", description="unit test of sharded runs", references=REFS, subsets={},
                     matrix=[{k: v for k, v in m.items() if k != "subset"} for m in base["matrix"]
                             if (m["profile"], m["opt_name"]) in ROWS])
        path = os.path.join(cls.dir, "shard-test.json")
        util.dump_json(small, path)
        cls.suite = suite_mod.load_suite(path)
        rows = runner.generate(cls.suite)[1]
        util.dump_json(suite_mod.make_lock(cls.suite, rows), suite_mod.lock_path(cls.suite))
        cls.n_cases = len(rows)
        cls.whole = runner.run_suite(cls.suite, out_dir=os.path.join(cls.dir, "whole"), write_cases=False, quiet=True)
        cls.shard_dirs = []
        for k in (1, 2, 3):
            d = os.path.join(cls.dir, "shards", f"{k}-of-3")
            runner.run_suite(cls.suite, out_dir=d, write_cases=False, quiet=True, shard=(k, 3))
            cls.shard_dirs.append(d)
        cls.merged = runner.merge_shards(cls.suite, cls.shard_dirs, out_dir=os.path.join(cls.dir, "merged"))

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def read(self, *parts):
        with open(os.path.join(self.dir, *parts), "rb") as handle:
            return handle.read()

    def test_the_merged_results_are_the_whole_runs_bytes(self):
        self.assertEqual(self.n_cases, 8)
        self.assertEqual(self.read("merged", "results.json"), self.read("whole", "results.json"))

    def test_the_merged_run_describes_the_same_code_and_cases(self):
        whole, merged = self.whole["run"], self.merged["run"]
        for key in ("git_sha", "audio_score_path", "audio_score_sha256", "sut_sha256", "sut_files", "sut_modules", "node", "python",
                    "platform", "cases", "errors"):
            self.assertEqual(merged[key], whole[key], key)
        self.assertEqual(merged["shards"], 3)
        self.assertEqual(sorted(merged["timing"]["per_case_ms"]), sorted(whole["timing"]["per_case_ms"]))
        self.assertEqual(len(merged["timing"]["shard_total_s"]), 3)

    def test_a_shard_is_not_a_result(self):
        for d in self.shard_dirs:
            self.assertTrue(os.path.isfile(os.path.join(d, "shard.json")))
            self.assertTrue(os.path.isfile(os.path.join(d, "run.json")))
            self.assertFalse(os.path.exists(os.path.join(d, "results.json")))           # `check` and `update-baseline` need results.json
        sizes = [len(json.loads(self.read("shards", f"{k}-of-3", "shard.json"))["cases"]) for k in (1, 2, 3)]
        self.assertEqual(sizes, [3, 3, 2])

    def test_merge_is_independent_of_the_order_the_shards_are_given(self):
        out = os.path.join(self.dir, "merged-reversed")
        runner.merge_shards(self.suite, list(reversed(self.shard_dirs)), out_dir=out)
        self.assertEqual(self.read("merged-reversed", "results.json"), self.read("whole", "results.json"))

    def test_a_missing_shard_is_refused(self):
        with self.assertRaises(runner.RunError) as e:
            runner.merge_shards(self.suite, self.shard_dirs[:2], out_dir=os.path.join(self.dir, "x"))
        self.assertEqual(e.exception.code, "SHARD_MISSING")
        self.assertIn("missing [3]", str(e.exception))

    def test_a_shard_given_twice_is_refused(self):
        with self.assertRaises(runner.RunError) as e:
            runner.merge_shards(self.suite, self.shard_dirs + [self.shard_dirs[0]], out_dir=os.path.join(self.dir, "x"))
        self.assertEqual(e.exception.code, "SHARD_DUPLICATE")

    def test_no_shards_is_refused(self):
        with self.assertRaises(runner.RunError) as e:
            runner.merge_shards(self.suite, [], out_dir=os.path.join(self.dir, "x"))
        self.assertEqual(e.exception.code, "SHARD_MISSING")

    def tamper(self, k, edit_shard=None, edit_run=None):
        """A copy of the three shards with the k-th one edited."""
        out = []
        for i, d in enumerate(self.shard_dirs, 1):
            nd = os.path.join(self.dir, f"tampered-{k}-{edit_shard is not None}-{edit_run is not None}", f"{i}-of-3")
            sh, run = util.load_json(os.path.join(d, "shard.json")), util.load_json(os.path.join(d, "run.json"))
            if i == k:
                if edit_shard:
                    edit_shard(sh)
                if edit_run:
                    edit_run(run)
            util.write_text(os.path.join(nd, "shard.json"), json.dumps(sh))
            util.dump_json(run, os.path.join(nd, "run.json"))
            out.append(nd)
        return out

    def merge_error(self, dirs):
        with self.assertRaises(runner.RunError) as e:
            runner.merge_shards(self.suite, dirs, out_dir=os.path.join(self.dir, "x"))
        return e.exception

    def test_shards_of_another_lock_suite_or_metrics_version_are_refused(self):
        for key in ("lock_sha256", "suite_sha256", "versions"):
            err = self.merge_error(self.tamper(2, edit_shard=lambda s, key=key: s.__setitem__(key, "other" if key != "versions" else {})))
            self.assertEqual(err.code, "SHARD_MISMATCH", key)
            self.assertIn(key, str(err))

    def test_shards_of_another_commit_or_sut_are_refused(self):
        for key in ("git_sha", "audio_score_sha256", "sut_sha256", "audio_score_path"):
            err = self.merge_error(self.tamper(3, edit_run=lambda r, key=key: r.__setitem__(key, "elsewhere")))
            self.assertEqual(err.code, "SHARD_MISMATCH", key)
            self.assertIn(key, str(err))

    def test_another_node_or_python_patch_release_is_noted_not_refused(self):
        dirs = self.tamper(3, edit_run=lambda r: (r.__setitem__("node", "v99.0.0"), r.__setitem__("python", "9.9.9")))
        out = os.path.join(self.dir, "mixed-runtimes")
        r = runner.merge_shards(self.suite, dirs, out_dir=out)
        self.assertEqual(len(r["run"]["runtimes"]), 2)
        self.assertIn("node v99.0.0, python 9.9.9", " ".join(r["run"]["runtimes"]))
        self.assertEqual(self.read("mixed-runtimes", "results.json"), self.read("whole", "results.json"))      # the rows do not care
        self.assertNotIn("runtimes", self.merged["run"])

    def test_shards_of_different_counts_are_refused(self):
        err = self.merge_error(self.tamper(1, edit_shard=lambda s: s["shard"].__setitem__("of", 4)))
        self.assertEqual(err.code, "SHARD_MISMATCH")

    def test_a_lost_or_extra_case_is_refused(self):
        err = self.merge_error(self.tamper(2, edit_shard=lambda s: s["cases"].pop()))
        self.assertEqual(err.code, "SHARD_INCOMPLETE")
        self.assertIn("1 missing", str(err))
        err = self.merge_error(self.tamper(2, edit_shard=lambda s: s["cases"].append(dict(s["cases"][0], id="micro/other|cover|none|s1"))))
        self.assertEqual(err.code, "SHARD_INCOMPLETE")
        err = self.merge_error(self.tamper(2, edit_shard=lambda s: s["cases"].append(dict(s["cases"][0]))))        # a row twice
        self.assertEqual(err.code, "SHARD_INCOMPLETE")

    def test_a_file_that_is_not_a_shard_is_refused(self):
        err = self.merge_error(self.tamper(1, edit_shard=lambda s: s.pop("shard")))
        self.assertEqual(err.code, "SHARD_MISMATCH")
        err = self.merge_error(self.tamper(2, edit_shard=lambda s: s.__setitem__("schema", "ppp.bench-results/1")))
        self.assertEqual(err.code, "SHARD_MISMATCH")

    def test_a_directory_without_a_shard_is_refused(self):
        os.makedirs(os.path.join(self.dir, "empty"), exist_ok=True)
        err = self.merge_error([os.path.join(self.dir, "empty")])
        self.assertEqual(err.code, "SHARD_MISSING")

    def test_cli_run_refuses_a_shard_with_filter_and_a_bad_spec(self):
        base = dict(suite=None, suite_file=self.suite["_path"], audio_score=None, out=None, filter=None, reveal_holdout=False, jobs=1)
        for extra in (dict(shard="2/4", filter="micro/M01"), dict(shard="0/4"), dict(shard="x")):
            buf = io.StringIO()
            with redirect_stdout(buf):
                code = runner.cli_run(argparse.Namespace(**{**base, **extra}))
            self.assertEqual(code, 2, extra)
            self.assertIn("BAD_SHARD", buf.getvalue())

    def test_check_does_not_read_a_shard_as_a_result(self):
        """merge-shards -> results.json is the only way to `check`: a shard directory has none."""
        self.assertFalse(os.path.exists(os.path.join(self.shard_dirs[0], "results.json")))


class WorkflowAgrees(unittest.TestCase):
    """.github/workflows/bench.yml runs rec-full as a matrix of shards: the shard count is written in four places (the matrix,
    `--shard K/N`, the artifact paths), and merge-shards would only discover a disagreement a nightly later."""

    @classmethod
    def setUpClass(cls):
        with open(os.path.join(util.repo_root(), ".github", "workflows", "bench.yml"), encoding="utf-8") as handle:
            cls.text = handle.read()

    def test_the_matrix_and_the_shard_flag_and_the_artifacts_name_the_same_count(self):
        import re
        matrix = re.findall(r"^\s+shard:\s*\[([0-9, ]+)\]", self.text, re.M)
        self.assertEqual(len(matrix), 1, "one matrix of shards")
        shards = [int(x) for x in matrix[0].split(",")]
        n = len(shards)
        self.assertEqual(shards, list(range(1, n + 1)))
        flags = re.findall(r"run --suite rec-full --shard \$\{\{ matrix\.shard \}\}/(\d+)", self.text)
        self.assertEqual(flags, [str(n)])
        self.assertEqual(set(re.findall(r"shards/\$\{\{ matrix\.shard \}\}-of-(\d+)/", self.text)), {str(n)})
        self.assertIn("pattern: rec-full-shard-*", self.text)                 # the merge job downloads what the shards upload
        self.assertIn("name: rec-full-shard-${{ matrix.shard }}", self.text)

    def test_the_merge_waits_for_the_shards_and_nothing_runs_rec_full_whole(self):
        import re
        self.assertIn("needs: nightly-rec-shard", self.text)
        self.assertEqual(re.findall(r"run --suite rec-full(?! --shard)", self.text), [])       # no job runs it unsharded again
        self.assertIn("merge-shards --suite rec-full", self.text)
        self.assertLess(self.text.index("merge-shards --suite rec-full"), self.text.index("check --suite rec-full"))


if __name__ == "__main__":
    unittest.main()
