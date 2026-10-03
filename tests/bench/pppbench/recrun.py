"""What a ``rec`` suite adds to a run (G10a-0): the stability probe and the reference bar chords.

``stability``: the same performance with +-10 ms of onset and release noise (three seeds) goes through the same
SUT again; the share of bars whose written notation differs from the unperturbed run's (bar by bar, so a bar
line that moves changes every bar after it) is the case's ``rec.stability``. A converter that rewrites bars for
10 ms of noise is not trustworthy.
"""

from __future__ import annotations

import json
import os
import subprocess
import tempfile
from typing import Any, Dict, List, Optional

from . import musicxml, stages, util
from .metrics import rec as rec_mod
from .sg_roundtrip import xml_text
from .util import Lcg, fnv1a32, round_t

HARMONY_JS = os.path.join(util.bench_root(), "node", "rec-harmony.js")
NOISE_S = 0.010
SEEDS = (1, 2, 3)


def perturb(inp: Dict[str, Any], case_id: str, seed: int, noise: float = NOISE_S) -> Dict[str, Any]:
    """The same performance, each onset and release moved by up to +-``noise`` seconds (deterministic)."""
    rng = Lcg(fnv1a32(f"{case_id}|stability|{seed}"))
    notes = []
    for n in inp["notes"]:
        on = n["on"] + rng.uniform(-noise, noise)
        off = max(on + 0.02, n["off"] + rng.uniform(-noise, noise))
        notes.append({"on": round_t(on), "off": round_t(off), "midi": n["midi"], "vel": n["vel"]})
    notes.sort(key=lambda n: (n["on"], n["midi"], n["off"]))
    out = dict(inp)
    out["notes"] = notes
    return out


def stability_of(base_xml: str, runs: List[Optional[str]]) -> float:
    """Mean over the perturbed runs of the share of bars that differ from ``base_xml``'s (a failed run: 1.0)."""
    base = rec_mod.bar_digests(musicxml.read_score(base_xml))
    shares = []
    for xml in runs:
        if xml is None:
            shares.append(1.0)
            continue
        try:
            shares.append(rec_mod.changed_bar_share(base, rec_mod.bar_digests(musicxml.read_score(xml))))
        except musicxml.ReaderError:
            shares.append(1.0)
    return sum(shares) / len(shares)


def reference_harmony(entries: Dict[str, Any]) -> Dict[str, Optional[List[Optional[str]]]]:
    """{reference id: the chord of each bar} (songgraph/harmony.js on the reference imported to a ScoreGraph)."""
    with tempfile.TemporaryDirectory(prefix="pppbench-harm-") as tmp:
        jin, jout = os.path.join(tmp, "in.jsonl"), os.path.join(tmp, "out.jsonl")
        with open(jin, "w", encoding="utf-8", newline="\n") as h:
            for rid in sorted(entries):
                h.write(json.dumps({"id": rid, "xml": xml_text(musicxml.read_bytes(entries[rid].abspath))}, ensure_ascii=False) + "\n")
        proc = subprocess.run([stages.node_binary(), HARMONY_JS, "--in", jin, "--out", jout], capture_output=True)
        if proc.returncode != 0:
            raise stages.StageError("rec-harmony.js failed: " + proc.stderr.decode("utf-8", "replace")[-1500:])
        out = {}
        with open(jout, encoding="utf-8") as h:
            for line in h:
                row = json.loads(line)
                out[row["id"]] = row.get("harmony")
    return out


def extras(cases, perfs, rows: Dict[str, Dict[str, Any]], by_entry: Dict[str, Any], audio_score: str) -> Dict[str, Dict[str, Any]]:
    """Per case id: {check, harmony, ref_harmony, stability} for metrics/rec.py."""
    ref_h = reference_harmony({c.ref_id: by_entry[c.ref_id] for c in cases})
    jobs = []
    for c in cases:
        if rows[c.id].get("ok"):
            for s in SEEDS:
                jobs.append({"id": f"{c.id}#{s}", "input": perturb(perfs[c.id].input, c.id, s), "opts": perfs[c.id].opts})
    noisy = stages.notate_batch(jobs, audio_score=audio_score, parallel=True)["results"] if jobs else {}
    out: Dict[str, Dict[str, Any]] = {}
    todo = []
    for c in cases:
        row = rows[c.id]
        out[c.id] = {"check": row.get("check"), "harmony": row.get("harmony"), "ref_harmony": ref_h.get(c.ref_id), "stability": None}
        if row.get("ok"):
            runs = [(noisy[f"{c.id}#{s}"].get("xml") if noisy[f"{c.id}#{s}"].get("ok") else None) for s in SEEDS]
            todo.append((c.id, row["xml"], runs))
    workers = min(4, os.cpu_count() or 1)
    if workers > 1 and len(todo) >= 200:
        import multiprocessing
        from concurrent.futures import ProcessPoolExecutor
        # "spawn" on every platform (Windows always did): a worker forked on Linux starts as a copy of this process, whose heap
        # holds the run's every case (13.7 GB for the whole rec-full) and which is copied page by page as the worker's garbage
        # collector and reference counts touch it. In a 16 GiB, 4-CPU Linux container the whole rec-full had the kernel
        # OOM-kill a worker here and the pool then hung for good (tests/bench/README.md, "Sharded runs"); a shard's heap is a
        # quarter of that, and a spawned worker starts empty either way
        with ProcessPoolExecutor(max_workers=workers, mp_context=multiprocessing.get_context("spawn")) as pool:
            shares = list(pool.map(_stability_job, [(x, r) for _, x, r in todo], chunksize=16))
    else:
        shares = [_stability_job((x, r)) for _, x, r in todo]
    for (cid, _, _), share in zip(todo, shares):
        out[cid]["stability"] = share
    return out


def _stability_job(args):
    """(base xml, [perturbed xml or None]) -> the stability, or None when the base cannot be read (a worker of the pool)."""
    base, runs = args
    try:
        return stability_of(base, runs)
    except musicxml.ReaderError:
        return None
