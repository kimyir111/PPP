#!/usr/bin/env python3
"""The CI gate's plan: which checks does a change need? (tests/bench/README.md, "The gate in CI")

    python3 tests/bench/tools/ci_plan.py --event pull_request [--github-output FILE] [--summary FILE]

In `.github/workflows/bench.yml` the job `plan` runs this first, on the pull request's merge commit (HEAD, whose first parent
HEAD^1 is the base), and the other jobs read its answer `mode`:

    full     every check of the gate (the 60 steps of the shard jobs). The answer for anything that is not a pull request (a push
             to main, a manual run, the schedule), for a pull request whose file list cannot be read, for any file this tool
             does not know to be harmless, and for the workflow, `package.json` and `tests/bench/` themselves.
    tooling  only files of tooling that no check of the gate reads except the home-PC worker's own tests (see the table in the
             README): the `light` job runs those tests, the bench unit tests and the two cheapest sanity checks.
    docs     only documents (`docs/`, a markdown or licence file at the repository root): the `light` job runs the two cheapest
             sanity checks. No step of the gate reads a document.

The rule is a WHITELIST. A path counts as light only if it is under a listed directory (or is a listed kind of root file); every
other path, whatever it is called, makes the whole change `full`. So a light answer is a claim about every changed path, and a
path this file has never heard of is never light. Paths that cannot be trusted (empty, absolute, `..`, backslash, a line break)
make the answer `full` too. An error anywhere in this script answers `full` (and says so); it never answers anything lighter.

The workflow runs the copy of this file from the pull request's BASE (`git show HEAD^1:tests/bench/tools/ci_plan.py`), not the
one the pull request carries, so a change to the rules does not apply to itself: it is `full` (it is under tests/bench/), and
the new rules start with the next change. When the base has no copy, the answer is `full` without running anything.

`tests/bench/unit/test_ci_plan.py` holds the table of every path class below against the steps that read them, as tests.
"""

import argparse
import os
import re
import subprocess
import sys

# path prefixes (with the slash) a DOCS change may touch; plus the root files of ROOT_DOC
DOCS_DIRS = ("docs/",)
ROOT_DOC = re.compile(r"^(?:[^/]+\.md|(?:LICENSE|LICENCE|COPYING|NOTICE)(?:\.(?:md|txt))?)$")
# further prefixes a TOOLING change may touch (it may touch the DOCS ones too)
TOOLING_DIRS = ("review/", "tests/review/", "tools/home-worker/", "tests/home-worker/")

MODES = ("full", "tooling", "docs")
MAX_LISTED = 40


def parse_nul(data):
    """``git diff -z --name-only`` output -> the paths (bytes decoded as UTF-8; an undecodable name is kept as the lossy string,
    which no whitelist entry matches)."""
    text = data.decode("utf-8", "replace") if isinstance(data, (bytes, bytearray)) else data
    return [p for p in text.split("\0") if p != ""]


def _clean(path):
    """False for a path that must not be trusted to be what the whitelist reads: empty, absolute, a `.` or `..` component,
    a backslash, a control character or a replacement character (an undecodable byte)."""
    if not path or path.startswith("/") or "\\" in path or "�" in path:
        return False
    if any(ord(c) < 32 or ord(c) == 127 for c in path):
        return False
    return all(part not in ("", ".", "..") for part in path.split("/"))


def _show(path):
    """A path for a message: control characters (a line break could forge a second `mode=` line in GITHUB_OUTPUT) shown as `?`."""
    return "".join("?" if ord(c) < 32 or ord(c) == 127 else c for c in path)


def path_class(path):
    """``"docs"``, ``"tooling"`` or ``"full"``: the lightest class the single path allows."""
    if not _clean(path):
        return "full"
    if path.startswith(DOCS_DIRS) or ROOT_DOC.match(path):
        return "docs"
    if path.startswith(TOOLING_DIRS):
        return "tooling"
    return "full"


def classify(paths):
    """``(mode, reason, rows)`` for a list of changed paths; ``rows`` is ``[(path, class)]``. The mode is the heaviest class of
    any path (docs < tooling < full); no path at all is `full` (a list that is empty was not read, or the change is nothing we
    should call harmless)."""
    rows = [(p, path_class(p)) for p in paths]
    if not rows:
        return "full", "the changed-file list is empty: it cannot be told what changed", rows
    heaviest = min((c for _, c in rows), key=MODES.index)          # MODES is ordered heaviest first
    n = {m: sum(1 for _, c in rows if c == m) for m in MODES}
    if heaviest == "full":
        first = next(p for p, c in rows if c == "full")
        return "full", f"{n['full']} of {len(rows)} changed files can affect a check (first: {_show(first)})", rows
    if heaviest == "tooling":
        return "tooling", f"all {len(rows)} changed files are tooling or documents that the gate does not read", rows
    return "docs", f"all {len(rows)} changed files are documents", rows


def changed_paths(repo=None, base="HEAD^1", head="HEAD"):
    """The paths a pull request's merge commit changes against its base, or None when they cannot be read: HEAD must be a merge
    (two parents, as the checkout of a pull request is). Renames are listed as a delete and an add (``--no-renames``), so both
    the old and the new path are judged."""
    def git(*args):
        return subprocess.run(["git", *args], cwd=repo, capture_output=True, check=True).stdout
    try:
        git("rev-parse", "--verify", "--quiet", head + "^2")
        return parse_nul(git("diff", "-z", "--name-only", "--no-renames", base, head))
    except (subprocess.CalledProcessError, OSError):
        return None


def summary_markdown(mode, reason, rows, event, note=""):
    lines = [f"### gate plan: **{mode.upper()}**", "", f"- event: `{event}`", f"- why: {reason}"]
    if note:
        lines.append(f"- note: {note}")
    if rows:
        lines += ["", f"{len(rows)} changed files" + (f" (first {MAX_LISTED} shown)" if len(rows) > MAX_LISTED else ""), "",
                  "| class | file |", "|---|---|"]
        # the files that decided the answer first
        shown = sorted(rows, key=lambda r: (MODES.index(r[1]), r[0]))[:MAX_LISTED]
        lines += [f"| {c} | `{_show(p)}` |" for p, c in shown]
    return "\n".join(lines) + "\n"


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--event", required=True, help="github.event_name")
    ap.add_argument("--github-output", help="append `mode=` and `reason=` here (the file of GITHUB_OUTPUT)")
    ap.add_argument("--summary", help="append a markdown summary here (the file of GITHUB_STEP_SUMMARY)")
    ap.add_argument("--repo", help="the repository to run git in (default: the current directory)")
    args = ap.parse_args(argv)
    note = ""
    try:
        if args.event != "pull_request":
            mode, reason, rows = "full", f"the event `{args.event}` always runs the full gate", []
        else:
            paths = changed_paths(args.repo)
            if paths is None:
                mode, reason, rows = "full", "the changed files of the pull request could not be read", []
            else:
                mode, reason, rows = classify(paths)
    except Exception as exc:                        # never anything lighter than full when this tool itself is in doubt
        mode, reason, rows = "full", "the plan failed and answers full", []
        note = _show(f"{type(exc).__name__}: {exc}")
    print(f"mode={mode}\nreason={reason}")
    if note:
        print("note=" + note)
    if args.github_output:
        with open(args.github_output, "a", encoding="utf-8", newline="\n") as handle:
            handle.write(f"mode={mode}\nreason={reason}\n")
    if args.summary:
        with open(args.summary, "a", encoding="utf-8", newline="\n") as handle:
            handle.write(summary_markdown(mode, reason, rows, args.event, note))
    return 0


if __name__ == "__main__":
    sys.exit(main())
