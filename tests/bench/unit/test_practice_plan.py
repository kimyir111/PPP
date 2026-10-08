"""The practice jobs' plan and the shape of their jobs (tests/practice/plan.py, .github/workflows/bench.yml; G11a-0).

(1) The plan answers `run` for everything it does not positively know to be unrelated to the practice suites, and `not run` only when
every changed path is not the app's page, a practice module, a practice suite or what they run on; anything it cannot trust is `run` and
`harness` (the mutation check) too. (2) The workflow's practice jobs are checks of their own: not jobs of the gate (the gate neither
waits for them nor counts them), they wait for practice-plan, run on a pull request only when it said so and always on a schedule or a
manual run, and between them run the eleven suites, the recorder, the mutation check and the perf probe. The workflow is read as text
(PyYAML is not installed in CI)."""

import contextlib
import importlib.util
import io
import json
import os
import re
import tempfile
import unittest

from pppbench import util
from unit.test_ci_plan import GATE_JOB, commands_of, git, jobs_of, read_workflow, write

_spec = importlib.util.spec_from_file_location("practice_plan", os.path.join(util.repo_root(), "tests", "practice", "plan.py"))
practice_plan = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(practice_plan)

SUITES = ("follow", "falling-notes", "memory", "learning", "playback-scheduler", "coach", "midi", "interactions", "lessons", "course", "alignment")


def run_main(argv):
    with contextlib.redirect_stdout(io.StringIO()):
        return practice_plan.main(argv)


class PathClasses(unittest.TestCase):
    def cls(self, p):
        return practice_plan.path_class(p)

    def test_the_page_the_practice_modules_and_the_suites_run(self):
        for p in ("Piano Coach App.dc.html", "practice/plan.js", "practice/sub/x.js", "tests/follow.test.js", "tests/midi.test.js",
                  "tests/boot.js", "tests/serve-free.js", "tests/engrave/tools/with-port.js", "package.json", "package-lock.json"):
            self.assertTrue(self.cls(p)[0], p)

    def test_all_eleven_suites_are_named(self):
        for name in SUITES:
            self.assertTrue(self.cls(f"tests/{name}.test.js")[0], name)
        self.assertEqual(len(practice_plan.SUITE_FILES), 11)

    def test_the_probes_and_the_workflow_also_run_the_mutation_check(self):
        for p in ("tests/practice/perf.js", "tests/practice/baselines/legacy.json", "tests/practice/plan.py", ".github/workflows/bench.yml",
                  "tests/engrave/tools/with-port.js", "tests/serve-free.js", "tests/boot.js"):
            self.assertEqual(self.cls(p), (True, True), p)

    def test_the_page_and_a_suite_alone_do_not_run_the_mutation_check(self):
        for p in ("Piano Coach App.dc.html", "tests/follow.test.js", "practice/plan.js", "package.json"):
            self.assertEqual(self.cls(p), (True, False), p)

    def test_everything_else_is_not_a_reason(self):
        for p in ("server.js", "NOTES.md", "README.md", "scoregraph/index.js", "engrave/page.js", "rec/key.js",
                  "tests/lessons-extra.test.js", "tests/import.test.js", "tests/engrave/layout.test.js", "tests/bench/run.py",
                  "tests/followx.test.js", "practicex/a.js", "Practice/a.js", "tests/practice", "tests/practice.js", "tests/Practice/x.js",
                  "catalog/index.json", "i18n/ko-KR.json"):
            self.assertEqual(self.cls(p), (False, False), p)

    def test_a_path_that_cannot_be_trusted_is_run_and_harness(self):
        for p in ("", "/Piano Coach App.dc.html", "notes/../server.js", "a\\b", "a\nb", "a\x00b", "x/�.md", "./x", "x//y", "x/"):
            self.assertEqual(self.cls(p), (True, True), repr(p))


class WholeChange(unittest.TestCase):
    def test_one_reason_is_enough(self):
        run, harness, reason = practice_plan.classify(["notes/a.md", "server.js", "Piano Coach App.dc.html"])
        self.assertTrue(run)
        self.assertFalse(harness)
        self.assertIn("Piano Coach App.dc.html", reason)

    def test_no_reason_is_no_run(self):
        run, harness, _ = practice_plan.classify(["notes/a.md", "server.js", "rec/key.js"])
        self.assertEqual((run, harness), (False, False))

    def test_the_probes_set_the_harness_flag(self):
        self.assertEqual(practice_plan.classify(["notes/a.md", "tests/practice/record.js"])[:2], (True, True))

    def test_an_empty_list_runs_everything(self):
        self.assertEqual(practice_plan.classify([])[:2], (True, True))

    def test_the_reason_has_no_line_breaks(self):
        _, _, reason = practice_plan.classify(["x\nrun=false"])
        self.assertNotIn("\n", reason)

    def test_a_rename_is_judged_by_both_names(self):
        # git diff --no-renames lists a move of the page out of the way as a delete and an add
        self.assertTrue(practice_plan.classify(["Piano Coach App.dc.html", "notes/page.md"])[0])


class FromARealMergeCommit(unittest.TestCase):
    def merge(self, repo, changes, deletes=()):
        git(repo, "init", "-q", "-b", "main")
        for rel in ("notes/a.md", "server.js", "Piano Coach App.dc.html", "tests/practice/x.js"):
            write(repo, rel, "one\n")
        git(repo, "add", ".")
        git(repo, "commit", "-q", "-m", "base")
        git(repo, "checkout", "-q", "-b", "topic")
        for rel in changes:
            write(repo, rel, "two\n")
        for rel in deletes:
            git(repo, "rm", "-q", rel)
        git(repo, "add", ".")
        git(repo, "commit", "-q", "-m", "topic")
        git(repo, "checkout", "-q", "main")
        write(repo, "unrelated-on-main.txt", "m\n")        # the base moved on: only the branch's own files may count
        git(repo, "add", ".")
        git(repo, "commit", "-q", "-m", "main moves")
        git(repo, "merge", "-q", "--no-ff", "-m", "merge", "topic")

    def plan(self, changes, deletes=(), event="pull_request"):
        with tempfile.TemporaryDirectory() as repo, tempfile.TemporaryDirectory() as out:
            self.merge(repo, changes, deletes)
            outfile, summary = os.path.join(out, "o"), os.path.join(out, "s")
            self.assertEqual(run_main(["--event", event, "--repo", repo, "--github-output", outfile, "--summary", summary]), 0)
            with open(outfile, encoding="utf-8") as handle:
                lines = handle.read().splitlines()
            with open(summary, encoding="utf-8") as handle:
                text = handle.read()
            self.assertEqual([x.split("=")[0] for x in lines], ["run", "harness", "reason"])
            return lines[0][4:], lines[1][8:], text

    def test_notes_only_do_not_run(self):
        run, harness, text = self.plan(["notes/a.md"])
        self.assertEqual((run, harness), ("false", "false"))
        self.assertIn("### practice plan: **SKIP**", text)

    def test_the_page_runs(self):
        run, harness, text = self.plan(["Piano Coach App.dc.html", "notes/a.md"])
        self.assertEqual((run, harness), ("true", "false"))
        self.assertIn("**RUN**", text)

    def test_a_probe_runs_the_mutation_check(self):
        self.assertEqual(self.plan(["tests/practice/x.js"])[:2], ("true", "true"))

    def test_a_deleted_page_runs(self):
        self.assertEqual(self.plan(["notes/a.md"], deletes=["Piano Coach App.dc.html"])[0], "true")

    def test_other_events_run_both_without_looking(self):
        for event in ("push", "schedule", "workflow_dispatch", ""):
            with tempfile.TemporaryDirectory() as out:
                outfile = os.path.join(out, "o")
                run_main(["--event", event, "--repo", out, "--github-output", outfile])
                with open(outfile, encoding="utf-8") as handle:
                    self.assertTrue(handle.read().startswith("run=true\nharness=true\n"), event)

    def test_a_head_that_is_not_a_merge_cannot_be_read_and_runs(self):
        with tempfile.TemporaryDirectory() as repo, tempfile.TemporaryDirectory() as out:
            git(repo, "init", "-q", "-b", "main")
            write(repo, "notes/a.md")
            git(repo, "add", ".")
            git(repo, "commit", "-q", "-m", "one")
            write(repo, "notes/a.md", "two\n")
            git(repo, "commit", "-q", "-am", "two")
            self.assertIsNone(practice_plan.changed_paths(repo))
            outfile = os.path.join(out, "o")
            run_main(["--event", "pull_request", "--repo", repo, "--github-output", outfile])
            with open(outfile, encoding="utf-8") as handle:
                self.assertTrue(handle.read().startswith("run=true\nharness=true\n"))


class PracticeJobs(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.text = read_workflow()
        cls.jobs = jobs_of(cls.text)
        cls.practice = {k: v for k, v in cls.jobs.items() if k.startswith("practice-")}
        with open(os.path.join(util.repo_root(), "tests", "practice", "run-suites.js"), encoding="utf-8") as handle:
            cls.script = handle.read()
        with open(os.path.join(util.repo_root(), "package.json"), encoding="utf-8") as handle:
            cls.scripts = json.load(handle)["scripts"]

    def needs_of(self, job):
        m = re.search(r"^    needs: (\[[^\]]*\]|[\w-]+)\s*$", self.jobs[job], re.M)
        self.assertTrue(m, f"{job} has no needs")
        return [x.strip() for x in m.group(1).strip("[]").split(",")]

    def test_the_four_jobs_are_there_and_none_is_a_gate_job(self):
        self.assertEqual(sorted(self.practice), ["practice-legacy", "practice-perf", "practice-plan", "practice-suites"])
        for name in self.practice:
            self.assertFalse(GATE_JOB.match(name), name)
            self.assertNotIn(name, self.needs_of("gate"))
        # and the gate's own count of the jobs it waits for (the workflow's regex) does not see them
        regex = re.compile(r"^  (plan|light|shard-[a-z]+|merge-[a-z0-9-]+):[ \t]*$", re.M)
        self.assertEqual(len(regex.findall(self.text)), len(self.needs_of("gate")))

    def test_the_plan_reads_the_base_copy_and_falls_back_to_running_everything(self):
        body = self.jobs["practice-plan"]
        self.assertIn("if: ${{ github.event_name == 'pull_request' }}", body)
        self.assertIn("git show HEAD^1:tests/practice/plan.py", body)
        self.assertIn('echo "run=true"', body)
        self.assertIn('echo "harness=true"', body)
        self.assertIn("fetch-depth: 2", body)

    def test_the_jobs_wait_for_the_plan_and_run_on_a_pull_request_only_when_it_says_so(self):
        for name in ("practice-suites", "practice-legacy", "practice-perf"):
            body = self.jobs[name]
            self.assertEqual(self.needs_of(name), ["practice-plan"], name)
            m = re.search(r"^    if: (.*)$", body, re.M)
            self.assertTrue(m, name)
            cond = m.group(1)
            self.assertIn("!cancelled()", cond, name)                                  # a skipped plan (schedule, manual run) must not skip them
            self.assertIn("github.event_name == 'schedule'", cond, name)
            self.assertIn("github.event_name == 'workflow_dispatch'", cond, name)
            self.assertIn("github.event_name == 'pull_request' && needs.practice-plan.outputs.run == 'true'", cond, name)
            self.assertNotIn("'push'", cond, name)

    def test_the_mutation_check_runs_on_a_pull_request_only_for_the_probes(self):
        body = self.jobs["practice-legacy"]
        m = re.search(r"^      - if: (.*)\n        run: node tests/practice/mutants\.js$", body, re.M)
        self.assertTrue(m, "the mutation step")
        self.assertIn("github.event_name != 'pull_request' || needs.practice-plan.outputs.harness == 'true'", m.group(1))

    def test_each_job_installs_before_it_runs_and_they_run_the_probes(self):
        want = {"practice-suites": ["npm ci", "node tests/practice/run-suites.js"],
                "practice-legacy": ["npm ci", "node tests/practice/record.js check", "node tests/practice/mutants.js"],
                "practice-perf": ["npm ci", "node tests/practice/perf.js check", "node tests/practice/perf.js record --attempts 5"]}
        for name, cmds in want.items():
            got = [c for c in commands_of(self.jobs[name])]
            for c in cmds:
                self.assertIn(c, got, name)
            self.assertEqual(got[0], "npm ci", name)
        for body in (self.jobs["practice-suites"], self.jobs["practice-legacy"], self.jobs["practice-perf"]):
            self.assertIn("actions/setup-node@v4", body)

    def test_the_perf_job_can_record_and_otherwise_checks(self):
        body = self.jobs["practice-perf"]
        self.assertIn("if: ${{ github.event.inputs.perf_record != 'true' }}", body)
        self.assertIn("if: ${{ github.event.inputs.perf_record == 'true' }}", body)
        self.assertIn("perf_record:", self.text)
        self.assertIn("only:", self.text)

    def test_the_practice_commands_are_not_in_the_full_gate(self):
        gate = {c for name, body in self.jobs.items() if name.startswith(("shard-", "merge-")) for c in commands_of(body)}
        for body in self.practice.values():
            for c in commands_of(body):
                if "tests/practice" in c:
                    self.assertNotIn(c, gate, c)

    def test_the_manual_run_can_leave_the_heavy_nightly_jobs_out(self):
        for name in ("nightly", "nightly-rec", "nightly-rec-shard", "nightly-rec-full"):
            m = re.search(r"^    if: (.*)$", self.jobs[name], re.M)
            self.assertTrue(m, name)
            self.assertIn("github.event.inputs.only != 'practice'", m.group(1), name)

    def test_the_suite_list_of_the_runner_is_the_plans(self):
        listed = re.findall(r"file: '([\w-]+\.test\.js)'", self.script)
        self.assertEqual(sorted(listed), sorted(os.path.basename(p) for p in practice_plan.SUITE_FILES))
        self.assertEqual(sorted(re.findall(r"name: '([\w-]+)', file:", self.script)), sorted(SUITES))
        for f in listed:
            self.assertTrue(os.path.isfile(os.path.join(util.repo_root(), "tests", f)), f)

    def test_the_npm_scripts_name_the_same_commands(self):
        self.assertEqual(self.scripts["test:practice-suites"], "node tests/practice/run-suites.js")
        self.assertEqual(self.scripts["test:practice-legacy"], "node tests/practice/record.js check")
        self.assertEqual(self.scripts["test:practice-perf"], "node tests/practice/perf.js check")
        self.assertEqual(self.scripts["test:practice-mutants"], "node tests/practice/mutants.js")
        self.assertIn("test:practice-suites", self.scripts["test:practice"])


if __name__ == "__main__":
    unittest.main()
