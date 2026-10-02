"""Run the system under test (docs/GOALS/G00 §4, §4.1)."""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile
from typing import Any, Dict, List, Optional

from . import sut as sut_mod, util

NOTATE_JS = os.path.join(util.bench_root(), "node", "notate.js")
REC_HARMONY_JS = os.path.join(util.bench_root(), "node", "rec-harmony.js")


class StageError(Exception):
    pass


def node_binary(node: Optional[str] = None) -> str:
    found = node or os.environ.get("PPP_BENCH_NODE") or shutil.which("node")
    if not found:
        raise StageError("Node.js not found: install it or set PPP_BENCH_NODE")
    return found


def default_audio_score() -> str:
    return os.path.join(util.repo_root(), "audio-score.js")


def _notate_chunk(jobs: List[Dict[str, Any]], sut: str, node: Optional[str], check: bool):
    with tempfile.TemporaryDirectory(prefix="pppbench-") as tmp:
        jin, jout = os.path.join(tmp, "jobs.jsonl"), os.path.join(tmp, "out.jsonl")
        with open(jin, "w", encoding="utf-8", newline="\n") as handle:
            for job in jobs:
                handle.write(json.dumps({"id": job["id"], "input": job["input"], "opts": job.get("opts") or {}},
                                        ensure_ascii=False) + "\n")
        graphs = os.path.join(tmp, "graphs.jsonl")
        cmd = [node_binary(node), NOTATE_JS, "--in", jin, "--out", jout, "--audio-score", sut]
        if check:
            cmd += ["--check", "--emit-graph", graphs]
        proc = subprocess.run(cmd, capture_output=True)
        if proc.returncode != 0:
            raise StageError("notate.js failed: " + proc.stderr.decode("utf-8", "replace")[-2000:])
        harmony: Dict[str, Any] = {}
        if check:
            hout = os.path.join(tmp, "harmony.jsonl")
            hp = subprocess.run([node_binary(node), REC_HARMONY_JS, "--graphs", graphs, "--out", hout], capture_output=True)
            if hp.returncode != 0:
                raise StageError("rec-harmony.js failed: " + hp.stderr.decode("utf-8", "replace")[-2000:])
            with open(hout, encoding="utf-8") as handle:
                for line in handle:
                    row = json.loads(line)
                    harmony[row["id"]] = row.get("harmony")
        results, meta = {}, {}
        with open(jout, encoding="utf-8") as handle:
            for line in handle:
                row = json.loads(line)
                if "meta" in row:
                    meta = row["meta"]
                else:
                    if check:
                        row["harmony"] = harmony.get(row["id"])
                    results[row["id"]] = row
    return results, meta


PARALLEL_FROM = 300      # recording suites (check=True) run big batches in up to four Node processes


def notate_batch(jobs: List[Dict[str, Any]], *, audio_score: Optional[str] = None,
                 node: Optional[str] = None, check: bool = False, parallel: bool = False) -> Dict[str, Any]:
    """Run toMusicXml over every job in one Node process.

    Returns ``{"results": {id: row}, "meta": {...}}``; a row is the adapter's
    output line (``ok``, ``xml``, ``stats`` or ``error``/``code``, ``ms``). ``check``: also the notation checker's
    class counts and the bar chords of each graph (G10a-0 rec metrics); such a batch, or one asked to run ``parallel``, of ``PARALLEL_FROM`` jobs or
    more is split over up to four Node processes (every case is independent: the rows are the same whatever the split)."""
    sut = os.path.abspath(audio_score or default_audio_score())
    workers = min(4, os.cpu_count() or 1) if ((check or parallel) and len(jobs) >= PARALLEL_FROM) else 1
    if workers <= 1:
        results, meta = _notate_chunk(jobs, sut, node, check)
    else:
        from concurrent.futures import ThreadPoolExecutor
        chunks = [jobs[i::workers] for i in range(workers)]
        with ThreadPoolExecutor(max_workers=workers) as pool:
            parts = list(pool.map(lambda c: _notate_chunk(c, sut, node, check), chunks))
        results, meta = {}, dict(parts[0][1])
        for r, _ in parts:
            results.update(r)
        for key in ("sut_modules", "sut_outside"):
            meta[key] = sorted({x for _, m in parts for x in (m.get(key) or [])})
    if len(results) != len(jobs):
        raise StageError(f"notate.js returned {len(results)} rows for {len(jobs)} jobs")
    try:
        sut_mod.check_closure(meta, sut)
    except sut_mod.SutError as exc:
        raise StageError(str(exc)) from exc
    return {"results": results, "meta": meta}
