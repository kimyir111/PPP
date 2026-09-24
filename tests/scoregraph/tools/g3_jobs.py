"""The toMusicXml inputs of a benchmark suite, as JSONL, for G3's corpus-wide node tests (docs/GOALS/G03 A3-A6).

    python tests/scoregraph/tools/g3_jobs.py --suite core [--suite golden ...] [--force]

Writes tests/bench/out/g3/jobs-<suite>.jsonl (gitignored): one {"id", "input", "opts"} per case, exactly what
the benchmark gives audio-score.js (shadow_compare.jobs_for: synthetic performances of the references, the golden
inputs, the replay fixtures). A file that exists is kept unless --force; its first line records the suite lock's
sha256 so a changed suite is regenerated.
"""

from __future__ import annotations

import argparse
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import shadow_compare  # noqa: E402  (puts tests/bench on the path)
from pppbench import suite as suite_mod, util  # noqa: E402

OUT = os.path.join(util.bench_root(), "out", "g3")


def lock_sha(name: str) -> str:
    path = os.path.join(suite_mod.SUITES_DIR, name + (".json" if name == "golden" else ".lock.json"))
    if not os.path.exists(path):
        path = os.path.join(suite_mod.SUITES_DIR, name + ".json")
    with open(path, "rb") as handle:
        return util.sha256_bytes(util.normalise_eol(handle.read()))


def write(name: str, force: bool = False) -> str:
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, f"jobs-{name}.jsonl")
    sha = lock_sha(name)
    if os.path.exists(path) and not force:
        with open(path, encoding="utf-8") as handle:
            head = json.loads(handle.readline() or "{}")
        if head.get("lock_sha256") == sha:
            return path
    jobs = shadow_compare.jobs_for(name)
    with open(path, "w", encoding="utf-8", newline="\n") as handle:
        handle.write(json.dumps({"suite": name, "lock_sha256": sha, "cases": len(jobs)}) + "\n")
        for job in jobs:
            handle.write(json.dumps(job, ensure_ascii=False, sort_keys=True) + "\n")
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
