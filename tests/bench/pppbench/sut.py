"""The system under test as a directory snapshot (docs/GOALS/G01 §15.4).

Until G1 the SUT was one file, ``audio-score.js``. From G1 it also loads the ScoreGraph library
beside it (``require('./scoregraph/index.js')``), so one file is no longer the whole SUT:

* ``ab --a git:<rev>`` would take the revision's ``audio-score.js`` but the working tree's
  ``scoregraph/`` (or none at all), and an A/B would silently compare the wrong code;
* a mutant copied alone into ``.cache/mutations/`` would not find its library;
* ``check`` would call results fresh after a change to ``scoregraph/``.

So the SUT is a **snapshot**: the entry file plus every ``*.js`` under the directories in
``SUT_TREES``, at the same relative paths. ``sut_sha256`` hashes that snapshot (paths and content,
CRLF read as LF), ``extract_git`` rebuilds it from a revision, ``write_mutant_dir`` copies it and edits
one or more of its files. ``notate.js`` reports the modules Node actually loaded, and ``check_closure``
refuses a run whose module closure leaves the snapshot: a snapshot that misses a module is an error,
never a silent mix of two versions.

Only these paths are the SUT; the rest of the repository (the app, the server, the Python pipeline) is
not copied.
"""

from __future__ import annotations

import json
import os
import shutil
from typing import Dict, List, Optional, Sequence, Tuple

from . import util

ENTRY = "audio-score.js"
SUT_TREES: Tuple[str, ...] = ("scoregraph",)


class SutError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(f"{code}: {message}")
        self.code = code


def _is_module(rel: str) -> bool:
    return rel.endswith(".js")


def sut_files(entry: str) -> List[str]:
    """The snapshot's files, relative to the entry's directory, sorted: the entry file, then every
    ``*.js`` under ``SUT_TREES``. A tree that does not exist (a revision before G1) adds nothing."""
    root = os.path.dirname(os.path.abspath(entry))
    files = [os.path.basename(entry)]
    for tree in SUT_TREES:
        base = os.path.join(root, tree)
        if not os.path.isdir(base):
            continue
        for dirpath, dirnames, filenames in os.walk(base):
            dirnames.sort()
            for name in sorted(filenames):
                rel = os.path.relpath(os.path.join(dirpath, name), root).replace(os.sep, "/")
                if _is_module(rel):
                    files.append(rel)
    return sorted(set(files))


def sut_sha256(entry: str) -> str:
    """sha256 of the snapshot: its sorted relative paths and each file's content hash (CRLF read as
    LF, so a Windows and a Linux checkout agree). Any edit to any SUT file changes it."""
    root = os.path.dirname(os.path.abspath(entry))
    rows = [[rel, util.content_sha256(os.path.join(root, rel))] for rel in sut_files(entry)]
    return util.sha256_bytes(json.dumps(rows, separators=(",", ":")).encode("utf-8"))


def git_sut_files(rev: str, repo: Optional[str] = None) -> List[str]:
    """The snapshot's files as committed in ``rev`` (of ``repo``, default this repository)."""
    listed = util.git("ls-tree", "-r", "--name-only", rev, "--", ENTRY, *SUT_TREES, cwd=repo).split("\n")
    files = [p for p in listed if p and (p == ENTRY or (_is_module(p) and p.split("/", 1)[0] in SUT_TREES))]
    if ENTRY not in files:
        raise SutError("SUT_NOT_IN_REV", f"{rev} has no {ENTRY}")
    return sorted(files)


def _fresh_dir(dest: str) -> None:
    if os.path.isdir(dest):
        shutil.rmtree(dest)
    os.makedirs(dest, exist_ok=True)


def extract_git(rev: str, dest: str, repo: Optional[str] = None) -> str:
    """Write the snapshot of ``rev`` into ``dest`` (emptied first, so no file of an earlier extraction
    survives) with the committed relative layout. Returns the entry path."""
    _fresh_dir(dest)
    for rel in git_sut_files(rev, repo):
        data = util.git("show", f"{rev}:{rel}", cwd=repo)
        path = os.path.join(dest, *rel.split("/"))
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8", newline="\n") as handle:
            handle.write(data)
    return os.path.join(dest, ENTRY)


def _read_lf(path: str) -> str:
    with open(path, "rb") as handle:
        return util.normalise_eol(handle.read()).decode("utf-8")


def write_mutant_dir(dest: str, edits: Dict[str, Sequence[Tuple[str, str]]], *,
                     entry: Optional[str] = None, label: str = "mutation") -> str:
    """Copy the snapshot of ``entry`` (default: the repository's ``audio-score.js``) into ``dest`` and
    apply exact string edits, ``{relative file: [(find, replace), ...]}``, each anchor required exactly
    once (``SutError`` MUTATION_ANCHOR_MISSING otherwise). Every file is written with LF. Returns the
    mutant's entry path. The original files are never touched."""
    from .stages import default_audio_score
    entry = os.path.abspath(entry or default_audio_score())
    root = os.path.dirname(entry)
    files = sut_files(entry)
    unknown = sorted(set(edits) - set(files))
    if unknown:
        raise SutError("MUTATION_ANCHOR_MISSING", f"{label}: {', '.join(unknown)} is not a SUT file")
    _fresh_dir(dest)
    for rel in files:
        text = _read_lf(os.path.join(root, rel))
        for find, replace in edits.get(rel, ()):
            n = text.count(find)
            if n != 1:
                raise SutError("MUTATION_ANCHOR_MISSING",
                               f"{label}: anchor found {n} times in {rel} (must be exactly once): {find[:70]!r}")
            text = text.replace(find, replace)
        path = os.path.join(dest, *rel.split("/"))
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8", newline="\n") as handle:
            handle.write(text)
    return os.path.join(dest, os.path.basename(entry))


def check_closure(meta: Dict, entry: str) -> List[str]:
    """The modules the Node adapter loaded (``meta["sut_modules"]``, relative to the SUT directory) must
    all be snapshot files, and none may lie outside the SUT directory (``meta["sut_outside"]``).
    Returns the closure; raises ``SutError`` otherwise. An adapter that reports nothing (an older
    notate.js) is not checked."""
    if "sut_modules" not in meta:
        return []
    outside = list(meta.get("sut_outside") or [])
    if outside:
        raise SutError("SUT_MODULE_OUTSIDE",
                       f"the SUT loaded {len(outside)} module(s) outside its directory, e.g. {outside[0]}: "
                       "an A/B or a mutant would mix two versions")
    closure = sorted(meta["sut_modules"])
    undeclared = sorted(set(closure) - set(sut_files(entry)))
    if undeclared:
        raise SutError("SUT_MODULE_UNDECLARED",
                       f"the SUT loaded {', '.join(undeclared)}, which the snapshot does not hold; add its "
                       "directory to pppbench/sut.py SUT_TREES")
    return closure


def describe(entry: str) -> Dict[str, object]:
    """What run.json records about the SUT besides the G0 ``audio_score_*`` fields."""
    return {"sut_sha256": sut_sha256(entry), "sut_files": sut_files(entry)}
