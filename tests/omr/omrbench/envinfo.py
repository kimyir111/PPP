"""Where the local tools are (the machine omr-live-2 runs on is the user's PC, not a CI runner).

Audiveris is looked for in this order: ``--audiveris`` / PPP_AUDIVERIS, ``<repo>/tools/audiveris/Audiveris/Audiveris.exe``, the same under
the MAIN worktree of this repository (a goal worktree has no ``tools/``: it is not source), Program Files, ``audiveris`` on the PATH.
puppeteer comes from this tree's node_modules, PPP_BENCH_NODE_MODULES, or the main worktree's.

Nothing here starts a process that is not asked for; ``terminate_tree`` stops a process this module's callers started, by PID.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
from typing import Dict, List, Optional

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPO = os.path.dirname(os.path.dirname(HERE))


def main_worktree(repo: str = REPO) -> Optional[str]:
    """The top of the main worktree (where an untracked tools/ and node_modules/ live), via git's common dir."""
    try:
        r = subprocess.run(["git", "rev-parse", "--git-common-dir"], cwd=repo, capture_output=True, text=True, timeout=20)
    except (OSError, subprocess.SubprocessError):
        return None
    if r.returncode != 0:
        return None
    common = os.path.normpath(os.path.join(repo, r.stdout.strip()))
    return os.path.dirname(common) if os.path.basename(common) == ".git" else None


def node_binary() -> str:
    found = os.environ.get("PPP_BENCH_NODE") or shutil.which("node")
    if not found:
        raise RuntimeError("Node.js not found: install it or set PPP_BENCH_NODE")
    return found


def node_modules_dirs() -> List[str]:
    dirs = [os.path.join(REPO, "node_modules")]
    dirs += [p for p in os.environ.get("PPP_BENCH_NODE_MODULES", "").split(os.pathsep) if p]
    main = main_worktree()
    if main:
        dirs.append(os.path.join(main, "node_modules"))
    seen, out = set(), []
    for d in dirs:
        k = os.path.normcase(os.path.abspath(d))
        if k not in seen and os.path.isdir(d):
            seen.add(k)
            out.append(d)
    return out


def node_env() -> Dict[str, str]:
    env = dict(os.environ)
    env["PPP_BENCH_NODE_MODULES"] = os.pathsep.join(node_modules_dirs())
    return env


def audiveris_path(explicit: Optional[str] = None) -> Optional[str]:
    cands: List[Optional[str]] = [explicit, os.environ.get("PPP_AUDIVERIS")]
    rels = [("tools", "audiveris", "Audiveris", "Audiveris.exe"), ("tools", "audiveris", "Audiveris", "bin", "Audiveris.bat")]
    roots = [REPO] + ([main_worktree()] if main_worktree() else [])
    for root in roots:
        cands += [os.path.join(root, *r) for r in rels]
    cands += ["C:\\Program Files\\Audiveris\\Audiveris.exe", shutil.which("audiveris"), "/usr/bin/audiveris", "/usr/local/bin/audiveris"]
    for c in cands:
        if c and os.path.isfile(c):
            return os.path.abspath(c)
    return None


def audiveris_version(exe: str) -> Optional[Dict[str, str]]:
    """{"version", "jar_sha256"} of the installed Audiveris, read from audiveris.jar's manifest (the program is never started)."""
    import hashlib
    import re
    import zipfile
    jar = os.path.join(os.path.dirname(exe), "app", "audiveris.jar")
    if not os.path.isfile(jar):
        return None
    try:
        with zipfile.ZipFile(jar) as z:
            m = re.search(r"Implementation-Version:\s*(\S+)", z.read("META-INF/MANIFEST.MF").decode("utf-8", "replace"))
        with open(jar, "rb") as h:
            digest = hashlib.sha256(h.read()).hexdigest()
    except (OSError, KeyError, zipfile.BadZipFile):
        return None
    return {"version": m.group(1) if m else "?", "jar_sha256": digest}


def terminate_tree(pid: int) -> None:
    """Stop the process tree rooted at a PID this tool started (never by name)."""
    if pid is None:
        return
    if sys.platform == "win32":
        subprocess.run(["taskkill", "/T", "/F", "/PID", str(pid)], capture_output=True)
    else:
        try:
            os.killpg(pid, 15)
        except OSError:
            try:
                os.kill(pid, 15)
            except OSError:
                pass
