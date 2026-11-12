"""What the bake-off runners share (tests/omr/engines/run_*.py; omrbench/engines.py starts them). Standard library only: it runs inside
each engine's own Python environment, never the repository's.

The protocol: a runner reads ``--jobs`` (a JSON list of {key, image, out}), prints ``START <key>`` before a page and ``DONE <key> <ms>
ok|failed`` after it (``SKIP <key>`` for a page already read), and writes ``<out>/engine.json``; ``--info`` prints one ``INFO <json>`` line.
"""

from __future__ import annotations

import argparse
import ctypes
import hashlib
import json
import os
import shutil
import sys
import time
import traceback
from typing import Any, Callable, Dict, List, Optional


def sha256(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def peak_rss_mb() -> Optional[float]:
    """This process's peak resident memory so far (Windows: PeakWorkingSetSize; elsewhere ru_maxrss)."""
    try:
        if sys.platform == "win32":
            class PMC(ctypes.Structure):
                _fields_ = [("cb", ctypes.c_ulong), ("PageFaultCount", ctypes.c_ulong), ("PeakWorkingSetSize", ctypes.c_size_t),
                            ("WorkingSetSize", ctypes.c_size_t), ("QuotaPeakPagedPoolUsage", ctypes.c_size_t),
                            ("QuotaPagedPoolUsage", ctypes.c_size_t), ("QuotaPeakNonPagedPoolUsage", ctypes.c_size_t),
                            ("QuotaNonPagedPoolUsage", ctypes.c_size_t), ("PagefileUsage", ctypes.c_size_t),
                            ("PeakPagefileUsage", ctypes.c_size_t)]
            pmc = PMC()
            pmc.cb = ctypes.sizeof(PMC)
            k32 = ctypes.windll.kernel32
            psapi = ctypes.windll.psapi
            psapi.GetProcessMemoryInfo.argtypes = [ctypes.c_void_p, ctypes.POINTER(PMC), ctypes.c_ulong]
            k32.GetCurrentProcess.restype = ctypes.c_void_p
            if psapi.GetProcessMemoryInfo(k32.GetCurrentProcess(), ctypes.byref(pmc), pmc.cb):
                return round(pmc.PeakWorkingSetSize / 2 ** 20, 1)
            return None
        import resource
        return round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024, 1)
    except Exception:                               # noqa: BLE001 - a measurement, never a reason to fail
        return None


def cuda_dll_dir() -> Optional[str]:
    """PPP_OMR_CUDA_DLLS: a folder with the CUDA 12 / cuDNN 9 DLLs (e.g. the torch/lib of a torch +cu128 install), on Windows."""
    d = os.environ.get("PPP_OMR_CUDA_DLLS")
    if d and os.path.isdir(d):
        if sys.platform == "win32":
            os.add_dll_directory(d)
        os.environ["PATH"] = d + os.pathsep + os.environ.get("PATH", "")
        return d
    return None


def parser(doc: str) -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(description=doc.split("\n\n")[0])
    ap.add_argument("--jobs", required=True)
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--info", action="store_true")
    return ap


def say(line: str) -> None:
    sys.stdout.write(line + "\n")
    sys.stdout.flush()


def run(jobs_path: str, engine_id: str, force: bool, page: Callable[[str, str], Dict[str, Any]],
        same: Optional[Callable[[Dict[str, Any]], bool]] = None, after: Optional[Callable[[], Dict[str, Any]]] = None) -> None:
    """The page loop. ``page(image_copy, out_dir)`` reads one page and returns {files: [...], ...}; it may raise (= a failed page).
    ``same(old_record)``: may an old record be kept (beyond the image and the engine id)? ``after()``: extra fields (GPU peak ...)."""
    with open(jobs_path, encoding="utf-8") as h:
        jobs: List[Dict[str, str]] = json.load(h)
    first = True
    for j in jobs:
        out, key = j["out"], j["key"]
        rec_path = os.path.join(out, "engine.json")
        img_sha = sha256(j["image"])
        if not force and os.path.isfile(rec_path):
            try:
                with open(rec_path, encoding="utf-8") as h:
                    old = json.load(h)
                if (old.get("image_sha256") == img_sha and old.get("engine") == engine_id and "ok" in old
                        and not old.get("timed_out") and not old.get("crashed") and (same is None or same(old))):
                    say(f"SKIP {key}")
                    continue
            except ValueError:
                pass
        say(f"START {key}")
        if os.path.isdir(out):
            shutil.rmtree(out)
        os.makedirs(out)
        ext = os.path.splitext(j["image"])[1].lower()
        copy = os.path.join(out, "page" + ext)
        shutil.copyfile(j["image"], copy)
        t = time.time()
        err, extra = None, {}
        try:
            extra = page(copy, out) or {}
        except KeyboardInterrupt:
            raise
        except BaseException as exc:            # noqa: BLE001 - one page failing must not end the run
            err = f"{type(exc).__name__}: {exc}"
            traceback.print_exc(file=sys.stdout)
            sys.stdout.flush()
        ms = int((time.time() - t) * 1000)
        if os.path.isfile(copy):
            os.remove(copy)
        files = [f for f in (extra.pop("files", None) or []) if os.path.isfile(f)]
        rec = {"engine": engine_id, "ms": ms, "ok": bool(files) and err is None and not extra.get("error"),
               "error": err or extra.get("error"), "files": files, "image_sha256": img_sha, "cold": first, "peak_rss_mb": peak_rss_mb()}
        rec.update({k: v for k, v in extra.items() if k != "error"})
        if after:
            rec.update(after())
        first = False
        with open(rec_path, "w", encoding="utf-8") as h:
            json.dump(rec, h, indent=1)
        say(f"DONE {key} {ms} {'ok' if rec['ok'] else 'failed'}")


def package_versions(names: List[str]) -> Dict[str, Optional[str]]:
    from importlib import metadata
    out: Dict[str, Optional[str]] = {}
    for n in names:
        try:
            out[n] = metadata.version(n)
        except metadata.PackageNotFoundError:
            out[n] = None
    return out


def files_sha(paths: List[str]) -> Dict[str, Dict[str, Any]]:
    return {os.path.basename(p): {"sha256": sha256(p), "bytes": os.path.getsize(p)} for p in paths if os.path.isfile(p)}


def print_info(d: Dict[str, Any]) -> None:
    d = dict(d, python=sys.version.split()[0], platform=sys.platform)
    say("INFO " + json.dumps(d, sort_keys=True))
