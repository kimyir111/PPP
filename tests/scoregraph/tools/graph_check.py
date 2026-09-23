"""The graphs toMusicXml builds for a benchmark suite (docs/GOALS/G01 A40).

    python tests/scoregraph/tools/graph_check.py [--suite core] [--suite golden ...]

Runs the suite's inputs through tests/bench/node/notate.js twice, with and without --emit-graph, and
requires (1) the same results either way (the option only adds its own file) and (2) a graph with no
ERROR for every case that notates. Prints the warning codes the graphs carry. Exit 0 when both hold.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tempfile
from collections import Counter
from typing import Dict, List

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import shadow_compare  # noqa: E402  (its jobs_for: the inputs of every suite kind; it puts tests/bench on the path)
from pppbench import stages  # noqa: E402


def notate(jobs_path: str, out: str, graphs: str = None) -> None:
    cmd = [stages.node_binary(), stages.NOTATE_JS, "--in", jobs_path, "--out", out,
           "--audio-score", stages.default_audio_score()]
    if graphs:
        cmd += ["--emit-graph", graphs]
    proc = subprocess.run(cmd, capture_output=True)
    if proc.returncode != 0:
        raise RuntimeError("notate.js failed: " + proc.stderr.decode("utf-8", "replace")[-2000:])


def rows(path: str) -> List[Dict]:
    out = []
    with open(path, encoding="utf-8") as handle:
        for line in handle:
            row = json.loads(line)
            row.pop("ms", None)
            out.append(row)
    return out


def check(name: str) -> int:
    jobs = shadow_compare.jobs_for(name)
    with tempfile.TemporaryDirectory(prefix="graph-check-") as tmp:
        jin = os.path.join(tmp, "in.jsonl")
        with open(jin, "w", encoding="utf-8", newline="\n") as handle:
            for j in jobs:
                handle.write(json.dumps(j, ensure_ascii=False) + "\n")
        plain, withg, gfile = (os.path.join(tmp, n) for n in ("plain.jsonl", "with.jsonl", "graphs.jsonl"))
        notate(jin, plain)
        notate(jin, withg, gfile)
        a, b = rows(plain), rows(withg)
        with open(gfile, encoding="utf-8") as handle:
            graphs = [json.loads(line) for line in handle]
    bad = 0
    if a != b:
        bad += 1
        print(f"{name}: results differ with --emit-graph")
    notated = {r["id"] for r in a if r.get("ok")}
    by_id = {g["id"]: g for g in graphs}
    warnings: Counter = Counter()
    without = 0
    for cid in sorted(notated):
        g = by_id.get(cid)
        errors = [i["code"] for i in (g or {}).get("issues", []) if i["severity"] == "ERROR"]
        if not g or not g.get("graph") or errors:
            bad += 1
            print(f"{name}: {cid}: " + ("no graph" if not g or not g.get("graph") else "graph errors " + ", ".join(errors)))
            continue
        without += 1
        warnings.update(i["code"] for i in g["issues"] if i["severity"] == "WARNING")
    failed = len(a) - 1 - len(notated)            # the last row is the meta line
    print(f"{name}: {len(notated)} graphs, {without} without an error"
          f"{f' ({failed} case(s) notate nothing, as before)' if failed else ''}; warnings: "
          + (", ".join(f"{k} {v}" for k, v in sorted(warnings.items())) or "none"))
    return bad


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--suite", action="append")
    args = ap.parse_args(argv)
    bad = sum(check(name) for name in (args.suite or ["core"]))
    return 0 if not bad else 1


if __name__ == "__main__":
    sys.exit(main())
