"""Shared helpers: stdio, hashing, deterministic random numbers, JSON."""

from __future__ import annotations

import hashlib
import json
import math
import os
import subprocess
import sys
from fractions import Fraction
from typing import Any


def setup_stdio() -> None:
    """Make stdout/stderr UTF-8 so a Korean title cannot crash a cp949 console."""
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass


def repo_root() -> str:
    return os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))


def bench_root() -> str:
    return os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def rel(path: str) -> str:
    """Repository-relative path with forward slashes."""
    return os.path.relpath(os.path.abspath(path), repo_root()).replace(os.sep, "/")


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_file(path: str) -> str:
    with open(path, "rb") as handle:
        return sha256_bytes(handle.read())


def fnv1a32(text: str) -> int:
    h = 2166136261
    for byte in text.encode("utf-8"):
        h ^= byte
        h = (h * 16777619) & 0xFFFFFFFF
    return h


class Lcg:
    """The 32-bit LCG used by tests/transcription.test.js ``rng``.

    Only integer arithmetic and one division, so every platform produces the
    same bits (no libm)."""

    def __init__(self, seed: int):
        self.s = seed & 0xFFFFFFFF

    def next(self) -> float:
        self.s = (self.s * 1664525 + 1013904223) & 0xFFFFFFFF
        return self.s / 4294967296

    def uniform(self, a: float, b: float) -> float:
        return a + (b - a) * self.next()


def round_t(t: float) -> float:
    """Round a time to 0.1 ms the same way on every platform."""
    return math.floor(t * 10000 + 0.5) / 10000


def F(x: Any) -> Fraction:
    if isinstance(x, Fraction):
        return x
    if isinstance(x, float):
        return Fraction(x).limit_denominator(1 << 20)
    return Fraction(x)


def _normalise(obj: Any) -> Any:
    if isinstance(obj, bool) or obj is None or isinstance(obj, str):
        return obj
    if isinstance(obj, int):
        return obj
    if isinstance(obj, Fraction):
        obj = float(obj)
    if isinstance(obj, float):
        if not math.isfinite(obj):
            raise ValueError("NaN/Inf cannot be written to benchmark JSON")
        value = round(obj, 6)
        return 0.0 if value == 0 else value
    if isinstance(obj, dict):
        return {str(k): _normalise(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_normalise(v) for v in obj]
    if hasattr(obj, "to_json"):
        return _normalise(obj.to_json())
    raise TypeError(f"cannot serialise {type(obj).__name__}")


def dumps_json(obj: Any) -> str:
    """Deterministic JSON text: sorted keys, 6-decimal floats, trailing newline."""
    return json.dumps(_normalise(obj), sort_keys=True, ensure_ascii=False, indent=1, allow_nan=False) + "\n"


def dump_json(obj: Any, path: str) -> None:
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as handle:
        handle.write(dumps_json(obj))


def load_json(path: str) -> Any:
    with open(path, "r", encoding="utf-8") as handle:
        return json.load(handle)


def git(*args: str, cwd: str | None = None) -> str:
    out = subprocess.run(["git", *args], cwd=cwd or repo_root(), capture_output=True)
    if out.returncode != 0:
        raise RuntimeError(out.stderr.decode("utf-8", "replace").strip())
    return out.stdout.decode("utf-8", "replace")


def is_tracked(path: str) -> bool:
    try:
        git("ls-files", "--error-unmatch", "--", rel(path))
        return True
    except RuntimeError:
        return False


def tracked_files() -> set:
    return set(git("ls-files", "-z").split("\0")) - {""}


def git_sha() -> str | None:
    try:
        return git("rev-parse", "HEAD").strip()
    except RuntimeError:
        return None


def git_dirty() -> bool | None:
    try:
        return bool(git("status", "--porcelain", "--untracked-files=no").strip())
    except RuntimeError:
        return None
