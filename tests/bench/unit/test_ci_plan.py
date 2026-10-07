"""The CI gate's plan and the shape of its jobs (tests/bench/tools/ci_plan.py, .github/workflows/bench.yml, tests/bench/README.md
"The gate in CI").

Two things are held here. (1) The classifier answers `full` for everything it does not positively know to be harmless, and `docs` /
`tooling` only when every changed path is on its whitelist (a table of path classes, and the same through a real merge commit).
(2) The workflow's gate jobs keep their invariants as the shards are moved around: every step in exactly one job, a `run --suite X`
with its `check`, a sharded suite complete with its merge job, the light job running nothing the full gate does not, `gate` waiting
for every job. The workflow is read as text (PyYAML is not installed in CI: the bench needs only the Python standard library)."""

import contextlib
import io
import os
import re
import subprocess
import sys
import tempfile
import unittest

from pppbench import util

sys.path.insert(0, os.path.join(util.bench_root(), "tools"))
import ci_plan  # noqa: E402

sys.path.pop(0)

WORKFLOW = os.path.join(util.repo_root(), ".github", "workflows", "bench.yml")


class PathClasses(unittest.TestCase):
    def test_documents_are_docs(self):
        for p in ("docs/GOALS/G10_AUDIO_TO_SCORE.md", "docs/DECISIONS.md", "docs/img/diagram.png", "README.md", "DEPLOY_RENDER.md",
                  "CHANGELOG.md", "LICENSE", "LICENSE.md", "LICENSE.txt", "COPYING", "NOTICE.txt"):
            self.assertEqual(ci_plan.path_class(p), "docs", p)

    def test_tooling_is_tooling(self):
        for p in ("review/build.js", "review/lib/page.js", "tests/review/blind.test.js", "tools/home-worker/worker.js",
                  "tools/home-worker/README.md", "tests/home-worker/jobs.test.js"):
            self.assertEqual(ci_plan.path_class(p), "tooling", p)

    def test_anything_the_whitelist_does_not_name_is_full(self):
        for p in (".github/workflows/bench.yml", "package.json", "package-lock.json", ".gitignore", "tests/bench/README.md",
                  "tests/bench/unit/test_ci_plan.py", "tests/bench/tools/ci_plan.py", "tests/engrave/layout.test.js",
                  "server.js", "audio-score.js", "rec/key.js", "scoregraph/README.md", "vendor/README.md", "catalog/hymns/README.md",
                  "audio/piano/README.md", "i18n/ko-KR.json", "Piano Coach App.dc.html", "home-jobs.js", "tools/other.js",
                  "tools/home-worker", "tools/home-workers/x.js", "docs", "review", "tests/review", "tests/reviewed/x.js",
                  "tests/home-worker-extra/x.js", "render.yaml", "Dockerfile", "requirements-arranger.txt"):
            self.assertEqual(ci_plan.path_class(p), "full", p)

    def test_a_markdown_file_is_a_document_only_at_the_root(self):
        self.assertEqual(ci_plan.path_class("README.md"), "docs")
        for p in ("sub/README.md", "scoregraph/README.md", "tests/README.md", "tests/bench/golden/BLESS_LOG.md", "a/b/c.md"):
            self.assertEqual(ci_plan.path_class(p), "full", p)

    def test_case_and_look_alikes_are_full(self):
        for p in ("Docs/a.md", "DOCS/a.md", "docs.md/a.js", "docs-old/a.md", "Review/build.js", "readme.MD", "README.md/x", "docs//a.md"):
            self.assertEqual(ci_plan.path_class(p), "full", p)

    def test_a_path_that_cannot_be_trusted_is_full(self):
        for p in ("", "/docs/a.md", "docs/../server.js", "docs/./a.md", "docs\\a.md", "docs/a\nb.md", "docs/a\x00b.md", "docs/�.md",
                  "docs/a\tb.md", "./docs/a.md", "docs/"):
            self.assertEqual(ci_plan.path_class(p), "full", repr(p))

    def test_parse_nul(self):
        self.assertEqual(ci_plan.parse_nul(b"docs/a.md\0README.md\0"), ["docs/a.md", "README.md"])
        self.assertEqual(ci_plan.parse_nul(b""), [])
        self.assertEqual(ci_plan.parse_nul("a\0b"), ["a", "b"])
        # a name that is not UTF-8 survives as text no whitelist entry matches
        self.assertEqual(ci_plan.path_class(ci_plan.parse_nul(b"docs/\xff.md\0")[0]), "full")


class WholeChange(unittest.TestCase):
    def mode(self, *paths):
        return ci_plan.classify(list(paths))[0]

    def test_all_docs_is_docs(self):
        self.assertEqual(self.mode("docs/a.md", "README.md"), "docs")
        self.assertEqual(self.mode("docs/GOALS/G10.md"), "docs")

    def test_docs_and_tooling_is_tooling(self):
        self.assertEqual(self.mode("docs/a.md", "tools/home-worker/worker.js"), "tooling")
        self.assertEqual(self.mode("tests/review/x.test.js", "review/build.js"), "tooling")

    def test_one_other_path_makes_the_whole_change_full(self):
        for extra in ("audio-score.js", "rec/key.js", "Piano Coach App.dc.html", ".github/workflows/bench.yml", "package.json",
                      "tests/bench/run.py", "scoregraph/index.js", "something/new.txt"):
            self.assertEqual(self.mode("docs/a.md", extra), "full", extra)
            self.assertEqual(self.mode(extra, "tools/home-worker/worker.js", "docs/a.md"), "full", extra)

    def test_an_empty_list_is_full(self):
        self.assertEqual(ci_plan.classify([])[0], "full")

    def test_a_rename_out_of_a_code_path_is_judged_by_both_names(self):
        # git diff --no-renames lists a move of server.js to docs/server.md as a delete and an add
        self.assertEqual(self.mode("server.js", "docs/server.md"), "full")

    def test_the_reason_names_the_first_blocking_file_without_line_breaks(self):
        mode, reason, _ = ci_plan.classify(["docs/a.md", "server.js"])
        self.assertEqual(mode, "full")
        self.assertIn("server.js", reason)
        mode, reason, _ = ci_plan.classify(["docs/a.md", "x\nmode=docs"])
        self.assertEqual(mode, "full")
        self.assertNotIn("\n", reason)


def run_main(argv):
    """ci_plan.main(argv) with its two printed lines kept out of the test log; returns its exit code."""
    with contextlib.redirect_stdout(io.StringIO()):
        return ci_plan.main(argv)


def git(repo, *args):
    return subprocess.run(["git", "-c", "user.email=ci@example.invalid", "-c", "user.name=ci", "-c", "core.autocrlf=false", *args],
                          cwd=repo, check=True, capture_output=True).stdout


def write(repo, rel, text="x\n"):
    path = os.path.join(repo, *rel.split("/"))
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as handle:
        handle.write(text)


class FromARealMergeCommit(unittest.TestCase):
    """A pull request's checkout is a merge commit of the branch into the base: HEAD^1 the base, HEAD^2 the branch."""

    def merge(self, repo, changes, deletes=(), moves=()):
        git(repo, "init", "-q", "-b", "main")
        for rel in ("docs/a.md", "README.md", "server.js", "tools/home-worker/worker.js", "other.txt"):
            write(repo, rel, "one\n")
        git(repo, "add", ".")
        git(repo, "commit", "-q", "-m", "base")
        git(repo, "checkout", "-q", "-b", "topic")
        for rel in changes:
            write(repo, rel, "two\n")
        for rel in deletes:
            git(repo, "rm", "-q", rel)
        for a, b in moves:
            os.makedirs(os.path.dirname(os.path.join(repo, b)) or repo, exist_ok=True)
            git(repo, "mv", a, b)
        git(repo, "add", ".")
        git(repo, "commit", "-q", "-m", "topic")
        git(repo, "checkout", "-q", "main")
        write(repo, "unrelated-on-main.txt", "m\n")        # the base moved on: only the branch's own files may count
        git(repo, "add", ".")
        git(repo, "commit", "-q", "-m", "main moves")
        git(repo, "merge", "-q", "--no-ff", "-m", "merge", "topic")

    def plan(self, *args, **kw):
        with tempfile.TemporaryDirectory() as repo, tempfile.TemporaryDirectory() as out:
            self.merge(repo, *args, **kw)
            outfile, summary = os.path.join(out, "o"), os.path.join(out, "s")
            self.assertEqual(run_main(["--event", "pull_request", "--repo", repo, "--github-output", outfile, "--summary", summary]), 0)
            with open(outfile, encoding="utf-8") as handle:
                lines = handle.read().splitlines()
            with open(summary, encoding="utf-8") as handle:
                text = handle.read()
            self.assertEqual(len(lines), 2)
            self.assertTrue(lines[0].startswith("mode=") and lines[1].startswith("reason="), lines)
            return lines[0][5:], text, ci_plan.changed_paths(repo)

    def test_docs_only(self):
        mode, text, paths = self.plan(["docs/a.md", "README.md", "docs/new/b.md"])
        self.assertEqual(mode, "docs")
        self.assertEqual(sorted(paths), ["README.md", "docs/a.md", "docs/new/b.md"])      # not the base's own commit
        self.assertIn("### gate plan: **DOCS**", text)

    def test_tooling_only(self):
        self.assertEqual(self.plan(["tools/home-worker/worker.js", "docs/a.md"])[0], "tooling")

    def test_a_code_file_beside_a_doc_is_full(self):
        mode, text, _ = self.plan(["docs/a.md", "server.js"])
        self.assertEqual(mode, "full")
        self.assertIn("| full | `server.js` |", text)

    def test_a_deleted_code_file_is_full(self):
        self.assertEqual(self.plan(["docs/a.md"], deletes=["server.js"])[0], "full")

    def test_a_code_file_moved_into_docs_is_full(self):
        mode, _, paths = self.plan([], moves=[("server.js", "docs/server.md")])
        self.assertEqual(mode, "full")
        self.assertIn("server.js", paths)

    def test_a_head_that_is_not_a_merge_cannot_be_read_and_is_full(self):
        with tempfile.TemporaryDirectory() as repo:
            git(repo, "init", "-q", "-b", "main")
            write(repo, "docs/a.md")
            git(repo, "add", ".")
            git(repo, "commit", "-q", "-m", "one")
            write(repo, "docs/a.md", "two\n")
            git(repo, "commit", "-q", "-am", "two")
            self.assertIsNone(ci_plan.changed_paths(repo))
            self.assertEqual(run_main(["--event", "pull_request", "--repo", repo]), 0)

    def test_not_a_repository_is_full(self):
        with tempfile.TemporaryDirectory() as out, tempfile.TemporaryDirectory() as notrepo:
            outfile = os.path.join(out, "o")
            env = dict(os.environ, GIT_CEILING_DIRECTORIES=os.path.dirname(notrepo))
            old = dict(os.environ)
            os.environ.update(env)
            try:
                run_main(["--event", "pull_request", "--repo", notrepo, "--github-output", outfile])
            finally:
                os.environ.clear()
                os.environ.update(old)
            with open(outfile, encoding="utf-8") as handle:
                self.assertTrue(handle.read().startswith("mode=full\n"))

    def test_other_events_are_full_without_looking(self):
        for event in ("push", "workflow_dispatch", "schedule", "pull_request_target", ""):
            with tempfile.TemporaryDirectory() as out:
                outfile = os.path.join(out, "o")
                run_main(["--event", event, "--repo", out, "--github-output", outfile])
                with open(outfile, encoding="utf-8") as handle:
                    self.assertTrue(handle.read().startswith("mode=full\n"), event)

    def test_a_file_name_cannot_forge_the_output(self):
        # a changed file called "x\nmode=docs" must not add a second `mode=` line to GITHUB_OUTPUT
        with tempfile.TemporaryDirectory() as repo, tempfile.TemporaryDirectory() as out:
            if os.name == "nt":
                self.skipTest("a line break cannot be in a Windows file name")
            self.merge(repo, ["docs/a.md", "x\nmode=docs"])
            outfile = os.path.join(out, "o")
            run_main(["--event", "pull_request", "--repo", repo, "--github-output", outfile])
            with open(outfile, encoding="utf-8") as handle:
                lines = handle.read().splitlines()
            self.assertEqual([x for x in lines if x.startswith("mode=")], ["mode=full"])


# ------------------------------------------------------------------------------------------------ the workflow, read as text
def read_workflow():
    with open(WORKFLOW, encoding="utf-8") as handle:
        return handle.read().replace("\r\n", "\n")


def jobs_of(text):
    """{job id: body text} of the `jobs:` section."""
    body = text.split("\njobs:\n", 1)[1]
    parts = re.split(r"^  ([a-z][a-z0-9-]*):[ \t]*$", body, flags=re.M)
    return {parts[i]: parts[i + 1] for i in range(1, len(parts), 2)}


def commands_of(body):
    """The `run:` commands of a job in order (a trailing comment cut off); `name: runner` (the CPU line) is not a gate step."""
    out = []
    for m in re.finditer(r"^      - (?:if: [^\n]*\n        )?run: ([^|\n].*)$", body, re.M):
        out.append(re.sub(r"\s+#\s.*$", "", m.group(1)).rstrip())
    return out


GATE_JOB = re.compile(r"^(plan|light|shard-[a-z]+|merge-[a-z0-9-]+)$")


class GateShape(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.text = read_workflow()
        cls.jobs = jobs_of(cls.text)
        cls.gate_jobs = {k: v for k, v in cls.jobs.items() if GATE_JOB.match(k)}
        cls.shards = {k: v for k, v in cls.jobs.items() if k.startswith("shard-")}
        cls.merges = {k: v for k, v in cls.jobs.items() if k.startswith("merge-")}

    def needs_of(self, job):
        m = re.search(r"^    needs: (\[[^\]]*\]|[\w-]+)\s*$", self.jobs[job], re.M)
        self.assertTrue(m, f"{job} has no needs")
        return [x.strip() for x in m.group(1).strip("[]").split(",")]

    def test_the_gate_waits_for_every_job_of_the_gate(self):
        self.assertEqual(sorted(self.needs_of("gate")), sorted(self.gate_jobs))
        self.assertGreaterEqual(len(self.shards), 10)
        self.assertTrue(self.merges)

    def test_the_gate_runs_after_failures_and_counts_the_jobs_it_waited_for(self):
        body = self.jobs["gate"]
        self.assertIn("always()", body)
        self.assertIn("github.event_name != 'schedule'", body)
        self.assertIn("plan|light|shard-[a-z]+|merge-[a-z0-9-]+", body)         # the count of the jobs in the file
        self.assertIn('"$waited" != "$in_file"', body)

    def test_shards_wait_for_the_plan_and_run_only_in_full_mode(self):
        for name, body in self.shards.items():
            self.assertEqual(self.needs_of(name), ["plan"], name)
            self.assertIn("if: ${{ needs.plan.outputs.mode == 'full' }}", body, name)

    def test_the_light_job_runs_only_in_the_light_modes(self):
        body = self.jobs["light"]
        self.assertEqual(self.needs_of("light"), ["plan"])
        self.assertIn("needs.plan.outputs.mode == 'docs' || needs.plan.outputs.mode == 'tooling'", body)
        self.assertNotIn("== 'full'", body)

    def test_the_plan_does_not_run_on_a_schedule(self):
        self.assertIn("if: ${{ github.event_name != 'schedule' }}", self.jobs["plan"])

    def test_no_step_of_the_gate_is_twice_in_the_full_gate(self):
        seen = {}
        for name in sorted(self.shards):
            for cmd in commands_of(self.shards[name]):
                self.assertNotIn(cmd, seen, f"{cmd!r} is in {seen.get(cmd)} and {name}")
                seen[cmd] = name
        self.assertGreaterEqual(len(seen), 60)

    def test_a_run_has_its_check_in_the_same_job_after_it(self):
        for name, body in self.shards.items():
            cmds = commands_of(body)
            for i, cmd in enumerate(cmds):
                m = re.fullmatch(r"python tests/bench/run\.py run --suite ([\w-]+)", cmd)
                if m and not m.group(1).startswith("replay-"):          # a replay run exits with its own verdict
                    self.assertIn(f"python tests/bench/run.py check --suite {m.group(1)}", cmds[i + 1:],
                                  f"{name}: run --suite {m.group(1)} has no check after it")

    def sliced(self):
        """{suite: [(k, n, job)]} of every `run --suite S --shard K/N` in the shard jobs."""
        out = {}
        for name, body in self.shards.items():
            for cmd in commands_of(body):
                m = re.fullmatch(r"python tests/bench/run\.py run --suite ([\w-]+) --shard (\d+)/(\d+)", cmd)
                if m:
                    out.setdefault(m.group(1), []).append((int(m.group(2)), int(m.group(3)), name))
        return out

    def test_a_sharded_suite_has_all_its_shards_once_and_a_merge_job_that_checks_it(self):
        sliced = self.sliced()
        self.assertTrue(sliced)
        for suite, parts in sliced.items():
            n = parts[0][1]
            self.assertTrue(all(p[1] == n for p in parts), suite)
            self.assertEqual(sorted(p[0] for p in parts), list(range(1, n + 1)), f"{suite}: the shards 1..{n} once each")
            for _, _, job in parts:                   # the unsharded run + check must not also be there
                self.assertNotIn(f"python tests/bench/run.py check --suite {suite}", commands_of(self.shards[job]), suite)
            merge = self.jobs.get(f"merge-{suite}")
            self.assertTrue(merge, f"no merge job for {suite}")
            self.assertEqual(sorted(self.needs_of(f"merge-{suite}")), sorted({p[2] for p in parts}))
            cmds = commands_of(merge)
            self.assertEqual(cmds, [f"python tests/bench/run.py merge-shards --suite {suite}", f"python tests/bench/run.py check --suite {suite}"])
            self.assertIn(f"pattern: {suite}-shard-*", merge)
            self.assertIn(f"path: tests/bench/out/{suite}/shards", merge)
            for k, _, job in parts:                   # and each shard job hands its result on under the name the merge looks for
                body = self.shards[job]
                self.assertIn(f"name: {suite}-shard-{k}-of-{n}", body)
                self.assertIn(f"tests/bench/out/{suite}/shards/{k}-of-{n}/shard.json", body)
                self.assertIn(f"tests/bench/out/{suite}/shards/{k}-of-{n}/run.json", body)
        self.assertEqual(sorted(f"merge-{s}" for s in sliced), sorted(self.merges))

    def test_a_merge_job_is_python_only(self):
        for name, body in self.merges.items():
            self.assertIn("actions/setup-python@v5", body, name)
            self.assertNotIn("actions/setup-node", body, name)
            for cmd in commands_of(body):
                self.assertFalse(re.search(r"\b(node|npm)\b", cmd), f"{name}: {cmd}")

    def test_every_job_that_runs_commands_has_the_runtimes_they_need(self):
        for name in list(self.shards) + ["light"]:
            body = self.jobs[name]
            self.assertIn("actions/setup-node@v4", body, name)          # python tools spawn node and node tools spawn python
            self.assertIn("actions/setup-python@v5", body, name)

    def test_the_scoregraph_job_has_the_whole_history_and_nothing_else_needs_it(self):
        with_history = [n for n, b in self.shards.items() if "fetch-depth: 0" in b]
        runs_scoregraph = [n for n, b in self.shards.items() if "npm run test:scoregraph" in commands_of(b)]
        self.assertEqual(runs_scoregraph, with_history)
        self.assertEqual(len(runs_scoregraph), 1)

    def test_the_light_commands_are_steps_of_the_full_gate(self):
        full = {c for body in self.shards.values() for c in commands_of(body)}
        light = commands_of(self.jobs["light"])
        self.assertTrue(light)
        for cmd in light:
            self.assertIn(cmd, full, f"the light job runs {cmd!r}, which no shard does")

    def test_no_command_of_the_gate_reads_a_path_the_light_modes_skip_except_the_home_worker_tests(self):
        """The light modes skip every shard. They are safe only if no shard step reads docs/, review/, tests/review/,
        tools/home-worker/ or tests/home-worker/ (the README's table lists how each step was shown not to) - here, the part a
        file can show: no command, and no npm script it runs, names those paths, except `npm run test:home-worker`."""
        import json
        with open(os.path.join(util.repo_root(), "package.json"), encoding="utf-8") as handle:
            scripts = json.load(handle)["scripts"]
        paths = re.compile(r"(^|[\s'\"/])(docs|review|tests/review|tools/home-worker|tests/home-worker)(/|\b)")
        for name, body in self.shards.items():
            for cmd in commands_of(body):
                text = cmd
                for m in re.finditer(r"npm run ([\w:-]+)", cmd):
                    text += " " + scripts[m.group(1)]
                if "npm run test:home-worker" in cmd:
                    self.assertIn("tests/home-worker", text)
                    self.assertTrue(re.search(r"npm run test:home-worker(?!-)", cmd))
                    continue
                self.assertFalse(paths.search(text), f"{name}: {cmd!r} names a path the light modes skip")
        # and the review's own tests are not a step of the gate at all (so `tooling` skips nothing that tests review/)
        every = " ".join(c for body in self.shards.values() for c in commands_of(body))
        self.assertNotIn("test:review", every)

    def test_the_nightly_jobs_are_not_gate_jobs(self):
        for name in ("nightly", "nightly-rec", "nightly-rec-shard", "nightly-rec-full"):
            self.assertIn(name, self.jobs)
            self.assertNotIn(name, self.gate_jobs)
            self.assertNotIn(name, self.needs_of("gate"))


if __name__ == "__main__":
    unittest.main()
