"""Audiveris 5.11 on page images, alone (docs/GOALS/G12_OMR.md G12-D1; the "engine alone" mode of omr-live-2).

The engine is run unmodified, as a separate process (AGPL-3.0: no PPP code links it), one page image per process, the same command the
local helper uses (omr-service.js recognisePage): ``Audiveris -batch -export -output <dir> -- <image>``, plus one option, below. The
result of a page is every ``.mxl`` it exported, in movement order (a page Audiveris splits into movements gives ``page.mvt1.mxl``,
``page.mvt2.mxl``).

Audiveris gives every processing step of a sheet 120 seconds and fails the page when a step is slower ("Timeout 120 seconds for step
BEAMS"). On an idle PC a step takes seconds; on a PC whose cores are all busy with another job (measured: 4 pages at a time next to a
14-thread job) one does not, and the page is lost for a reason that has nothing to do with the page. So the benchmark raises that one limit
(``-option org.audiveris.omr.Main.sheetStepTimeOut=<s>``; the output of a page that finishes in time is unchanged), and a page that still
times out, in Audiveris or here, is recorded as ``timed_out``, is never reused as an answer, and keeps a baseline from being recorded.

A run is recorded in ``<dir>/engine.json`` and reused while the image, the engine and the options are the same. Processes started here are
stopped here, by PID; nothing is ever killed by name.
"""

from __future__ import annotations

import concurrent.futures
import glob
import hashlib
import json
import os
import re
import subprocess
import threading
import time
from typing import Any, Dict, List, Union

from . import envinfo

TIMEOUT_S = 900          # wall-clock limit for one page: a page takes 3-13 s on an idle PC
STEP_TIMEOUT_S = 1800    # Audiveris' own limit for one step of a sheet (its default is 120)
_STEP_TIMEOUT_LOG = re.compile(r"Timeout \d+ seconds for step")
_live: Dict[int, subprocess.Popen] = {}
_lock = threading.Lock()


def movement_order(path: str) -> int:
    m = re.search(r"\.mvt(\d+)\.mxl$", path)
    return int(m.group(1)) if m else 0


def _sha(path: str) -> str:
    with open(path, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()


def engine_options(step_timeout: int = STEP_TIMEOUT_S) -> List[str]:
    return ["-option", f"org.audiveris.omr.Main.sheetStepTimeOut={int(step_timeout)}"]


def run_page(exe: Union[str, List[str]], image: str, out_dir: str, engine: Dict[str, str], force: bool = False, timeout: int = TIMEOUT_S,
             step_timeout: int = STEP_TIMEOUT_S) -> Dict[str, Any]:
    """Run Audiveris on one image. Returns {ms, rc, mxl: [paths], timed_out, image_sha256, engine_sha256, options, cached}."""
    rec_path = os.path.join(out_dir, "engine.json")
    image_sha = _sha(image)
    options = engine_options(step_timeout)
    if not force and os.path.isfile(rec_path):
        try:
            with open(rec_path, encoding="utf-8") as h:
                rec = json.load(h)
            if (rec.get("image_sha256") == image_sha and rec.get("engine_sha256") == engine.get("jar_sha256") and rec.get("options") == options
                    and not rec.get("timed_out") and rec.get("rc") != -9 and all(os.path.isfile(p) for p in rec.get("mxl", []))):
                rec["cached"] = True
                return rec
        except (OSError, ValueError):
            pass
    if os.path.isdir(out_dir):
        for root, dirs, files in os.walk(out_dir, topdown=False):
            for f in files:
                os.remove(os.path.join(root, f))
            for d in dirs:
                os.rmdir(os.path.join(root, d))
    os.makedirs(out_dir, exist_ok=True)
    t0 = time.time()
    log, rc, timed_out = "", None, False
    prefix = list(exe) if isinstance(exe, (list, tuple)) else [exe]          # a list lets a test stand in for the program
    p = subprocess.Popen(prefix + ["-batch", "-export"] + options + ["-output", out_dir, "--", image], stdout=subprocess.PIPE,
                         stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL)
    with _lock:
        _live[p.pid] = p
    try:
        try:
            raw, _ = p.communicate(timeout=timeout)
            rc = p.returncode
            log = raw.decode("utf-8", "replace")
        except subprocess.TimeoutExpired:
            envinfo.terminate_tree(p.pid)
            try:
                raw, _ = p.communicate(timeout=30)
            except subprocess.SubprocessError:
                raw = b""
            log, rc, timed_out = "TIMEOUT\n" + raw.decode("utf-8", "replace"), -9, True
    finally:
        with _lock:
            _live.pop(p.pid, None)
    if _STEP_TIMEOUT_LOG.search(log):
        timed_out = True
    ms = int((time.time() - t0) * 1000)
    mxl = sorted(glob.glob(os.path.join(out_dir, "**", "*.mxl"), recursive=True), key=lambda x: (movement_order(x), x))
    with open(os.path.join(out_dir, "log.txt"), "w", encoding="utf-8") as f:
        f.write(log[-20000:])
    rec = {"ms": ms, "rc": rc, "mxl": mxl, "timed_out": timed_out, "image_sha256": image_sha, "engine_sha256": engine.get("jar_sha256"),
           "options": options, "cached": False}
    with open(rec_path, "w", encoding="utf-8", newline="\n") as f:
        json.dump(rec, f, indent=1)
    return rec


def stop_all() -> None:
    """Stop every Audiveris this process started and has not seen finish (by PID)."""
    with _lock:
        pids = list(_live)
    for pid in pids:
        envinfo.terminate_tree(pid)


def run_pages(exe: Union[str, List[str]], jobs: List[Dict[str, str]], engine: Dict[str, str], workers: int = 1, force: bool = False,
              log=print, timeout: int = TIMEOUT_S, step_timeout: int = STEP_TIMEOUT_S) -> Dict[str, Dict[str, Any]]:
    """jobs: [{"key", "image", "out"}]; returns {key: record}. ``workers`` Audiveris processes at a time (1 = the timing the design
    document measured; the output of a page does not depend on it on an idle PC)."""
    results: Dict[str, Dict[str, Any]] = {}
    done = 0

    def one(job):
        return job["key"], run_page(exe, job["image"], job["out"], engine, force, timeout, step_timeout)

    try:
        with concurrent.futures.ThreadPoolExecutor(max_workers=max(1, workers)) as pool:
            futs = [pool.submit(one, j) for j in jobs]
            for fut in concurrent.futures.as_completed(futs):
                key, rec = fut.result()
                results[key] = rec
                done += 1
                if not rec.get("cached"):
                    log(f"  [{done}/{len(jobs)}] {key}: {rec['ms'] / 1000:.1f} s, {len(rec['mxl'])} file(s), rc {rec['rc']}"
                        + (" TIMED OUT" if rec.get("timed_out") else ""))
    except BaseException:
        stop_all()
        raise
    return results
