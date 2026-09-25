"""The toMusicXml inputs of a benchmark suite, as JSONL, for G3's corpus-wide node tests (docs/GOALS/G03 A3-A6).

    python tests/scoregraph/tools/g3_jobs.py --suite core [--suite golden ...] [--force]

Writes tests/bench/out/g3/jobs-<suite>.jsonl (gitignored; PPP_G3_JOBS_DIR names another directory, a relative one
from the repository root): one {"id", "input", "opts"} per case, exactly what the benchmark gives audio-score.js
(shadow_compare.jobs_for: synthetic performances of the references, the golden inputs, the replay fixtures). A
complete file that exists is kept unless --force; its first line records the suite lock's sha256 (so a changed suite
is regenerated) and the number of cases (so a short file is too).

node --test runs the test files in parallel processes and several of them ask for the same suite at once on a fresh
checkout, so a file is never written in place: each process writes its own temporary file and renames it onto the
name, and a reader sees no file or a complete one (CI run 36174222416 read a half-written one).
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import shadow_compare  # noqa: E402  (puts tests/bench on the path)
from pppbench import suite as suite_mod, util  # noqa: E402

OUT = os.path.join(util.bench_root(), "out", "g3")


def out_dir() -> str:
    """tests/bench/out/g3, or PPP_G3_JOBS_DIR (a test's fresh directory)."""
    other = os.environ.get("PPP_G3_JOBS_DIR")
    return os.path.join(util.repo_root(), other) if other else OUT


def lock_sha(name: str) -> str:
    path = os.path.join(suite_mod.SUITES_DIR, name + (".json" if name == "golden" else ".lock.json"))
    if not os.path.exists(path):
        path = os.path.join(suite_mod.SUITES_DIR, name + ".json")
    with open(path, "rb") as handle:
        return util.sha256_bytes(util.normalise_eol(handle.read()))


def complete(path: str, sha: str) -> bool:
    """The file is there, made from this lock, and holds every case its header counts, each line ended."""
    try:
        with open(path, encoding="utf-8", newline="") as handle:
            first = handle.readline()
            head = json.loads(first) if first.endswith("\n") else {}
            if head.get("lock_sha256") != sha:
                return False
            count = 0
            for line in handle:
                if not line.endswith("\n"):
                    return False
                count += 1
            return count == head.get("cases")
    except (OSError, ValueError):
        return False


def publish(tmp: str, path: str, sha: str, tries: int = 40, wait: float = 0.05) -> None:
    """Rename tmp onto path. On Windows the rename fails while another process has path open (one checking it):
    try again, and if it keeps failing, a complete file from the same lock (another process's) will do."""
    for attempt in range(tries):
        try:
            os.replace(tmp, path)
            return
        except PermissionError:
            if attempt + 1 == tries:
                if complete(path, sha):
                    return
                raise
            time.sleep(wait)


def write(name: str, force: bool = False) -> str:
    out = out_dir()
    os.makedirs(out, exist_ok=True)
    path = os.path.join(out, f"jobs-{name}.jsonl")
    sha = lock_sha(name)
    if not force and complete(path, sha):
        return path
    jobs = shadow_compare.jobs_for(name)
    tmp = f"{path}.{os.getpid()}.tmp"
    try:
        with open(tmp, "w", encoding="utf-8", newline="\n") as handle:
            handle.write(json.dumps({"suite": name, "lock_sha256": sha, "cases": len(jobs)}) + "\n")
            for job in jobs:
                handle.write(json.dumps(job, ensure_ascii=False, sort_keys=True) + "\n")
            handle.flush()
            os.fsync(handle.fileno())
        publish(tmp, path, sha)
    finally:
        if os.path.exists(tmp):
            os.remove(tmp)
    return path


def main(argv=None) -> int:
    util.setup_stdio()
    ap = argparse.ArgumentParser()
    ap.add_argument("--suite", action="append")
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args(argv)
    for name in args.suite or ["core"]:
        print(write(name, args.force))
    return 0


if __name__ == "__main__":
    sys.exit(main())
