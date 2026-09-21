"""Run the system under test (docs/GOALS/G00 §4, §4.1)."""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile
from typing import Any, Dict, List, Optional

from . import util

NOTATE_JS = os.path.join(util.bench_root(), "node", "notate.js")


class StageError(Exception):
    pass


def node_binary(node: Optional[str] = None) -> str:
    found = node or os.environ.get("PPP_BENCH_NODE") or shutil.which("node")
    if not found:
        raise StageError("Node.js not found: install it or set PPP_BENCH_NODE")
    return found


def default_audio_score() -> str:
    return os.path.join(util.repo_root(), "audio-score.js")


def notate_batch(jobs: List[Dict[str, Any]], *, audio_score: Optional[str] = None,
                 node: Optional[str] = None) -> Dict[str, Any]:
    """Run toMusicXml over every job in one Node process.

    Returns ``{"results": {id: row}, "meta": {...}}``; a row is the adapter's
    output line (``ok``, ``xml``, ``stats`` or ``error``/``code``, ``ms``)."""
    sut = os.path.abspath(audio_score or default_audio_score())
    with tempfile.TemporaryDirectory(prefix="pppbench-") as tmp:
        jin, jout = os.path.join(tmp, "jobs.jsonl"), os.path.join(tmp, "out.jsonl")
        with open(jin, "w", encoding="utf-8", newline="\n") as handle:
            for job in jobs:
                handle.write(json.dumps({"id": job["id"], "input": job["input"], "opts": job.get("opts") or {}},
                                        ensure_ascii=False) + "\n")
        proc = subprocess.run([node_binary(node), NOTATE_JS, "--in", jin, "--out", jout, "--audio-score", sut],
                              capture_output=True)
        if proc.returncode != 0:
            raise StageError("notate.js failed: " + proc.stderr.decode("utf-8", "replace")[-2000:])
        results, meta = {}, {}
        with open(jout, encoding="utf-8") as handle:
            for line in handle:
                row = json.loads(line)
                if "meta" in row:
                    meta = row["meta"]
                else:
                    results[row["id"]] = row
    if len(results) != len(jobs):
        raise StageError(f"notate.js returned {len(results)} rows for {len(jobs)} jobs")
    return {"results": results, "meta": meta}
