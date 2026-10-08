#!/usr/bin/env python3
"""The practice jobs' plan: does this change need the practice and playback browser suites? (G11a-0)

    python3 tests/practice/plan.py --event pull_request [--github-output FILE] [--summary FILE]

In `.github/workflows/bench.yml` the job `practice-plan` runs this on a pull request's merge commit (HEAD, whose first parent HEAD^1 is the
base) and the jobs `practice-suites` and `practice-probes` read its answers:

    run       true when the change touches the app's page, the practice modules, the practice tests or what they run on (the list below).
              A pull request that touches none of them does not start the practice jobs: the gate (tests/bench/tools/ci_plan.py) is
              what runs for everything else, and the nightly runs the practice jobs on the whole tree.
    harness   true when the change touches the probes themselves (their files in tests/practice/, their baselines, the suites' port helper,
              the workflow): the mutation check
              (tests/practice/mutants.js, several minutes) runs only then, and every night.

It is the gate's classifier turned around, with the same safeguard: the question is "is it certain that the practice jobs are not needed?",
and everything that cannot be read - no file list, a path with a backslash, a control character or `..`, an error in this script - answers
`run=true`. The workflow runs the copy of this file from the pull request's BASE (`git show HEAD^1:tests/practice/plan.py`), so a change to
the rules does not apply to itself; when the base has none the workflow answers `run=true` and `harness=true` without running anything.
Other events (push, schedule, manual run) always run both.

tests/bench/unit/test_practice_plan.py holds the table of path classes as tests.
"""

import argparse
import subprocess
import sys

# The page, the modules the practice screens are made of (practice/, G11a-1) and the practice tests (tests/practice/: the probes below and
# G11a-1's Node unit tests of practice/).
APP_FILES = ("Piano Coach App.dc.html",)
APP_DIRS = ("practice/", "tests/practice/")
# The suites themselves and what they and the probes stand on (the server helper, the page boot, the port rewrite).
SUITE_FILES = tuple("tests/%s.test.js" % n for n in (
    "follow", "falling-notes", "memory", "learning", "playback-scheduler", "coach", "midi", "interactions", "lessons", "course", "alignment"))
RUN_FILES = ("tests/boot.js", "tests/serve-free.js", "tests/engrave/tools/with-port.js", "package.json", "package-lock.json")
# The probes: a change here also runs the mutation check. (A change to G11a-1's Node unit tests in tests/practice/ is a practice test, `run`,
# and not a probe.)
HARNESS_DIRS = ("tests/practice/baselines/",)
HARNESS_FILES = (".github/workflows/bench.yml", "tests/engrave/tools/with-port.js", "tests/serve-free.js", "tests/boot.js",
                 "tests/practice/canon.js", "tests/practice/lib.js", "tests/practice/mutants.js", "tests/practice/perf.js", "tests/practice/perf-selftest.js",
                 "tests/practice/plan.py",
                 "tests/practice/record.js", "tests/practice/run-suites.js")


def clean(path):
    """False for a path that cannot be trusted to be what it says: empty, absolute, a `.` or `..` part, a backslash, a control character,
    a replacement character (an undecodable byte)."""
    if not path or path.startswith("/") or "\\" in path or "�" in path:
        return False
    if any(ord(c) < 32 or ord(c) == 127 for c in path):
        return False
    return all(part not in ("", ".", "..") for part in path.split("/"))


def path_class(path):
    """``(run, harness)`` for one path."""
    if not clean(path):
        return True, True
    harness = path.startswith(HARNESS_DIRS) or path in HARNESS_FILES
    run = harness or path in APP_FILES or path.startswith(APP_DIRS) or path in SUITE_FILES or path in RUN_FILES
    return run, harness


def classify(paths):
    """``(run, harness, reason)`` for the changed paths. No path at all means the list was not read: run both."""
    if not paths:
        return True, True, "the changed-file list is empty: it cannot be told what changed"
    rows = [(p,) + path_class(p) for p in paths]
    run = any(r[1] for r in rows)
    harness = any(r[2] for r in rows)
    if not run:
        return False, False, "none of the %d changed files is the app's page, a practice module, a practice test or what they run on" % len(rows)
    first = next(r[0] for r in rows if r[1])
    return True, harness, "%d of %d changed files can affect the practice suites (first: %s)%s" % (
        sum(1 for r in rows if r[1]), len(rows), show(first), "; the probes themselves changed" if harness else "")


def show(path):
    """A path for a message: control characters (a line break could forge a second `run=` line in GITHUB_OUTPUT) shown as `?`."""
    return "".join("?" if ord(c) < 32 or ord(c) == 127 else c for c in path)


def parse_nul(data):
    text = data.decode("utf-8", "replace") if isinstance(data, (bytes, bytearray)) else data
    return [p for p in text.split("\0") if p != ""]


def changed_paths(repo=None, base="HEAD^1", head="HEAD"):
    """The paths a pull request's merge commit changes against its base, or None when they cannot be read (HEAD is not a merge).
    Renames are listed as a delete and an add, so both the old and the new path are judged."""
    def git(*args):
        return subprocess.run(["git", *args], cwd=repo, capture_output=True, check=True).stdout
    try:
        git("rev-parse", "--verify", "--quiet", head + "^2")
        return parse_nul(git("diff", "-z", "--name-only", "--no-renames", base, head))
    except (subprocess.CalledProcessError, OSError):
        return None


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--event", required=True, help="github.event_name")
    ap.add_argument("--github-output", help="append `run=`, `harness=` and `reason=` here (the file of GITHUB_OUTPUT)")
    ap.add_argument("--summary", help="append a markdown summary here (the file of GITHUB_STEP_SUMMARY)")
    ap.add_argument("--repo", help="the repository to run git in (default: the current directory)")
    args = ap.parse_args(argv)
    note = ""
    try:
        if args.event != "pull_request":
            run, harness, reason = True, True, "the event `%s` always runs the practice jobs" % show(args.event)
        else:
            paths = changed_paths(args.repo)
            if paths is None:
                run, harness, reason = True, True, "the changed files of the pull request could not be read"
            else:
                run, harness, reason = classify(paths)
    except Exception as exc:                        # never "not needed" when this tool itself is in doubt
        run, harness, reason = True, True, "the plan failed and answers run"
        note = show("%s: %s" % (type(exc).__name__, exc))
    out = "run=%s\nharness=%s\nreason=%s\n" % (str(run).lower(), str(harness).lower(), reason)
    sys.stdout.write(out + ("note=" + note + "\n" if note else ""))
    if args.github_output:
        with open(args.github_output, "a", encoding="utf-8", newline="\n") as handle:
            handle.write(out)
    if args.summary:
        with open(args.summary, "a", encoding="utf-8", newline="\n") as handle:
            handle.write("### practice plan: **%s**\n\n- event: `%s`\n- why: %s\n- mutation check: %s\n%s" % (
                "RUN" if run else "SKIP", show(args.event), reason, "yes" if harness else "no", ("- note: " + note + "\n") if note else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main())
