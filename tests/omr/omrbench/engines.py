"""The learned OMR engines of the G12-6 bake-off (AI-7; docs/GOALS/G12_OMR.md G12-D9, gate A7, section 25), run the way omr-live-2 runs
Audiveris: one page image in, MusicXML out, judged by the same metrics, alone and through omr/normalize.js.

Each engine lives OUTSIDE the repository in a Python environment of its own (its packages and its weights are never committed). The
repository holds one small runner per engine (``tests/omr/engines/run_<name>.py``), which this module starts with that environment's
interpreter (``--engine-python``, or the variable named below), at below-normal priority, one process for many pages:

    <python> -I -X utf8 tests/omr/engines/run_<name>.py --jobs <jobs.json> [--force]      (and --info: what is installed)

The runner prints ``START <key>`` before a page and ``DONE <key> <ms> ok|failed`` after it, and writes ``<out>/engine.json`` (the page's
record) beside the MusicXML. A page that prints nothing for ``timeout`` seconds is stopped (the runner's process tree, by its PID),
recorded as ``timed_out``, and the runner is started again on the pages that are left; a runner that dies mid-page has that page recorded
as ``crashed``. A finished page is not read again while its image and the engine are the same (``--force`` reads it again).

The engines are used as shipped: no fine-tuning, no setting changed from the engine's own default. What each runner adds is only what
it takes to get MusicXML out of the engine (written in the runner's docstring); everything else is the benchmark's (same pages, same
truth, same metrics, same normaliser).
"""

from __future__ import annotations

import json
import os
import queue
import shutil
import subprocess
import sys
import tempfile
import threading
import time
from typing import Any, Callable, Dict, List, Optional

from . import envinfo

RUNNERS = os.path.join(envinfo.HERE, "engines")
BELOW_NORMAL_PRIORITY_CLASS = 0x00004000
TIMEOUT_S = 900                  # no line from the runner for this long: the page is stopped (Audiveris' wall-clock limit is the same)
MAX_RESTARTS = 40

# name -> what the record and the report say about it (licences read from the projects' own files, 2026-10-16)
ENGINES: Dict[str, Dict[str, str]] = {
    "homr": {
        "runner": "run_homr.py", "env": "PPP_OMR_HOMR_PYTHON", "package": "homr==0.7.0",
        "source": "https://github.com/liebharc/homr (PyPI homr 0.7.0; models: the project's GitHub release 'onnx_checkpoints')",
        "licence": "AGPL-3.0 (code; the models are release assets of the same repository, no separate licence)",
    },
    "oemer": {
        "runner": "run_oemer.py", "env": "PPP_OMR_OEMER_PYTHON", "package": "oemer==0.1.8",
        "source": "https://github.com/BreezeWhite/oemer (PyPI oemer 0.1.8; models: the project's GitHub release 'checkpoints')",
        "licence": "MIT (code; the models are release assets of the same repository, no separate licence)",
    },
    "smt": {
        "runner": "run_smt.py", "env": "PPP_OMR_SMT_PYTHON", "package": "github antoniorv6/SMT + PRAIG/smt-fp-grandstaff",
        "source": "https://github.com/antoniorv6/SMT (commit in the record) with the weights https://huggingface.co/PRAIG/smt-fp-grandstaff",
        "licence": "MIT (code: LICENSE of the repository; weights: 'license: mit' on the model card)",
    },
}


def names() -> List[str]:
    return sorted(ENGINES)


def python_for(name: str, explicit: Optional[str] = None) -> Optional[str]:
    """The interpreter of the engine's own environment: ``explicit``, else the engine's variable (``PPP_OMR_HOMR_PYTHON`` ...)."""
    cand = explicit or os.environ.get(ENGINES[name]["env"])
    return cand if cand and os.path.isfile(cand) else None


def runner_path(name: str) -> str:
    return os.path.join(RUNNERS, ENGINES[name]["runner"])


def _creationflags() -> int:
    return BELOW_NORMAL_PRIORITY_CLASS if sys.platform == "win32" else 0


def _preexec():
    if sys.platform == "win32":
        return None

    def lower():                                  # pragma: no cover - not on the PC the bake-off ran on
        os.setpgrp()
        try:
            os.nice(5)
        except OSError:
            pass
    return lower


def command(name: str, python: str, jobs_path: str, force: bool = False, extra: Optional[List[str]] = None,
            runner: Optional[str] = None) -> List[str]:
    """``runner``: another runner script (a test's stand-in); default tests/omr/engines/run_<name>.py."""
    return ([python, "-I", "-X", "utf8", runner or runner_path(name), "--jobs", jobs_path] + (["--force"] if force else [])
            + list(extra or []))


def info(name: str, python: str, timeout: int = 600) -> Dict[str, Any]:
    """What the engine's environment holds (versions, weight files and their sha256, the device), from ``runner --info``."""
    with tempfile.TemporaryDirectory(prefix="omr-engine-info-") as tmp:
        jobs = os.path.join(tmp, "jobs.json")
        with open(jobs, "w", encoding="utf-8") as h:
            json.dump([], h)
        r = subprocess.run(command(name, python, jobs) + ["--info"], capture_output=True, timeout=timeout,
                           creationflags=_creationflags(), env=dict(os.environ))
    for line in r.stdout.decode("utf-8", "replace").splitlines():
        if line.startswith("INFO "):
            try:
                return json.loads(line[5:])
            except ValueError:
                break
    return {"error": (r.stderr.decode("utf-8", "replace")[-400:] or "no INFO line"), "rc": r.returncode}


def to_record(raw: Dict[str, Any], cached: bool) -> Dict[str, Any]:
    """A runner's page record in the shape the benchmark keeps for Audiveris (``mxl`` = the MusicXML files, ``rc`` 0 = read)."""
    return {"ms": int(raw.get("ms") or 0), "rc": 0 if raw.get("ok") else 1, "mxl": [f for f in raw.get("files") or [] if os.path.isfile(f)],
            "timed_out": bool(raw.get("timed_out")), "crashed": bool(raw.get("crashed")), "error": raw.get("error"),
            "image_sha256": raw.get("image_sha256"), "engine_sha256": None, "options": [], "cached": cached,
            "cold": bool(raw.get("cold")), "peak_rss_mb": raw.get("peak_rss_mb"), "gpu_peak_mb": raw.get("gpu_peak_mb")}


def _write_failure(job: Dict[str, str], why: str, ms: int) -> None:
    os.makedirs(job["out"], exist_ok=True)
    rec = {"ok": False, "error": why, "files": [], "ms": ms, "timed_out": why == "timed out", "crashed": why != "timed out"}
    with open(os.path.join(job["out"], "engine.json"), "w", encoding="utf-8") as h:
        json.dump(rec, h, indent=1)


class GpuSampler:
    """The GPU's memory in use, sampled every 2 s by nvidia-smi while a runner works (the whole card's: the PC is shared, so the
    engine's share is the peak minus what was in use before it started; an upper bound, recorded as such)."""

    def __init__(self) -> None:
        self.base: Optional[int] = None
        self.peak: Optional[int] = None
        self._stop = threading.Event()
        self._t: Optional[threading.Thread] = None
        self.exe = shutil.which("nvidia-smi")

    def _read(self) -> Optional[int]:
        if not self.exe:
            return None
        try:
            r = subprocess.run([self.exe, "--query-gpu=memory.used", "--format=csv,noheader,nounits"], capture_output=True, timeout=20)
            return int(r.stdout.decode().strip().splitlines()[0])
        except (OSError, subprocess.SubprocessError, ValueError, IndexError):
            return None

    def start(self) -> "GpuSampler":
        self.base = self._read()

        def loop():
            while not self._stop.wait(2.0):
                v = self._read()
                if v is not None:
                    self.peak = v if self.peak is None else max(self.peak, v)
        self._t = threading.Thread(target=loop, daemon=True)
        self._t.start()
        return self

    def stop(self) -> Dict[str, Optional[int]]:
        self._stop.set()
        if self._t:
            self._t.join(timeout=30)
        return {"gpu_mem_before_mb": self.base, "gpu_mem_peak_mb": self.peak,
                "gpu_mem_delta_mb": (self.peak - self.base) if self.peak is not None and self.base is not None else None}


def run_pages(name: str, python: str, jobs: List[Dict[str, str]], force: bool = False, log: Callable[[str], None] = print,
              timeout: int = TIMEOUT_S, extra: Optional[List[str]] = None, runner: Optional[str] = None,
              sample_gpu: bool = True) -> Dict[str, Any]:
    """Run the engine on every job ({key, image, out}); returns {"records": {key: record}, "gpu": {...}, "restarts": n, "wall_s": s}."""
    todo = list(jobs)
    done_keys: set = set()
    restarts = 0
    first_force = force
    sampler = GpuSampler()
    if sample_gpu:
        sampler.start()
    t_all = time.time()
    with tempfile.TemporaryDirectory(prefix=f"omr-{name}-") as tmp:
        while todo:
            jobs_path = os.path.join(tmp, f"jobs-{restarts}.json")
            with open(jobs_path, "w", encoding="utf-8") as h:
                json.dump(todo, h)
            p = subprocess.Popen(command(name, python, jobs_path, first_force, extra, runner), stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                 stdin=subprocess.DEVNULL, creationflags=_creationflags(), preexec_fn=_preexec(), env=dict(os.environ))
            lines: "queue.Queue[Optional[str]]" = queue.Queue()

            def pump(stream=p.stdout):
                for raw in iter(stream.readline, b""):
                    lines.put(raw.decode("utf-8", "replace").rstrip("\r\n"))
                lines.put(None)
            threading.Thread(target=pump, daemon=True).start()
            current, started_at, eof = None, time.time(), False
            tail: List[str] = []
            try:
                while True:
                    try:
                        line = lines.get(timeout=timeout)
                    except queue.Empty:
                        line = "__TIMEOUT__"
                    if line is None:
                        eof = True
                        break
                    if line == "__TIMEOUT__":
                        envinfo.terminate_tree(p.pid)
                        if current is not None:
                            log(f"  {current}: no answer for {timeout} s, stopped")
                            job = next(j for j in todo if j["key"] == current)
                            _write_failure(job, "timed out", int((time.time() - started_at) * 1000))
                            done_keys.add(current)
                        break
                    tail = (tail + [line])[-12:]
                    if line.startswith("START "):
                        current, started_at = line[6:].strip(), time.time()
                    elif line.startswith("DONE "):
                        parts = line[5:].split(" ")
                        done_keys.add(parts[0])
                        log(f"  [{len(done_keys)}/{len(jobs)}] {parts[0]}: {int(parts[1]) / 1000:.1f} s {parts[2] if len(parts) > 2 else ''}")
                        current = None
                    elif line.startswith("SKIP "):
                        done_keys.add(line[5:].strip())
            finally:
                if p.poll() is None and not eof:
                    envinfo.terminate_tree(p.pid)
            p.wait()
            if p.stdout:
                p.stdout.close()
            if eof and current is not None:            # the runner died inside a page
                job = next(j for j in todo if j["key"] == current)
                log(f"  {current}: the runner ended inside the page (rc {p.returncode})")
                _write_failure(job, f"crashed (rc {p.returncode})", int((time.time() - started_at) * 1000))
                done_keys.add(current)
            left = [j for j in todo if j["key"] not in done_keys]
            if not left:
                break
            if len(left) == len(todo):                 # not one page done, stopped or crashed: starting it again would do the same
                raise RuntimeError(f"{name}: the runner made no progress (rc {p.returncode}); its last lines: " + " | ".join(tail))
            restarts += 1
            if restarts > MAX_RESTARTS:
                raise RuntimeError(f"{name}: more than {MAX_RESTARTS} restarts")
            todo, first_force = left, force
    gpu = sampler.stop()
    recs: Dict[str, Dict[str, Any]] = {}
    for j in jobs:
        path = os.path.join(j["out"], "engine.json")
        try:
            with open(path, encoding="utf-8") as h:
                raw = json.load(h)
        except (OSError, ValueError):
            raw = {"ok": False, "error": "no record", "files": []}
        recs[j["key"]] = to_record(raw, cached=False)
    return {"records": recs, "gpu": gpu, "restarts": restarts, "wall_s": round(time.time() - t_all, 1)}


def describe(name: str, inf: Dict[str, Any]) -> Dict[str, Any]:
    """The ``engine`` block of a results file for a learned engine."""
    meta = ENGINES[name]
    return {"name": name, "version": inf.get("version", "?"), "licence": meta["licence"], "source": meta["source"],
            "package": meta["package"], "info": inf, "options": []}
