"""The ``rec-arrange`` suites (G10c-0, docs/GOALS/G10 section 9): what the one-note arranger does to recordings.

A suite with ``"rec_arrange": true`` runs the same cases as a ``rec`` suite (the humanizer's families over the references, with
the stage options of each matrix row), but instead of judging the score of the recording it arranges the recording the way the
app does (``arrangeSingleNote`` at the three levels, tests/bench/node/rec-arrange.js) and measures the arrangements against the
true score: the melody, the harmony, the level spread, the left hand, the register, the hard violations and the checker
classes (metric names and definitions in rec-arrange.js and in docs/GOALS/G10 section 21).

A suite may also name ``replay_dirs`` (tests/bench/<dir>, as ``replay-of``): every fixture there is a case too, the heard notes
of the production browser model on rendered audio, run with each of the matrix rows' stage options.

``run_suite`` has the signature and the result of runner.run_suite, so ``check``, ``update-baseline``, ``ab`` and the mutation
check work on these suites with no special case.
"""

from __future__ import annotations

import glob
import json
import os
import platform
import shutil
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from . import VERSIONS, aggregate, corpus, musicxml, stages, suite as suite_mod, sut as sut_mod, util
from .sg_roundtrip import xml_text
from .timemap import BarStartTimeMap, StatsShapeError

REC_ARRANGE_VERSION = "rec-arrange/1"
REC_ARRANGE_JS = os.path.join(util.bench_root(), "node", "rec-arrange.js")
PARALLEL_FROM = 6          # fewer jobs than this run in one Node process


def versions(suite: Dict[str, Any]) -> Dict[str, str]:
    return {**VERSIONS, "generator": suite_mod.generator_version(suite), "rec_arrange": REC_ARRANGE_VERSION}


def replay_cases(suite: Dict[str, Any], refs_by_id: Dict[str, Any]) -> List[Dict[str, Any]]:
    """The replay fixtures of ``suite['replay_dirs']`` as cases: one per fixture and stage-option row of the matrix."""
    out: List[Dict[str, Any]] = []
    rows, seen = [], set()
    for row in suite.get("matrix") or []:
        key = row.get("opt_name") or ""
        if key not in seen:
            seen.add(key)
            rows.append((row.get("opt_name"), row.get("opts")))
    stage_opts = (suite.get("stage") or {}).get("opts") or {}
    for d in suite.get("replay_dirs") or []:
        for path in sorted(glob.glob(os.path.join(util.bench_root(), d, "*.json"))):
            fx = util.load_json(path)
            entry = refs_by_id[fx["reference"]]
            hr = fx["helper_result"]
            inp = {k: hr[k] for k in ("notes", "pedals", "beats", "downbeats", "beatConfidence", "grid") if k in hr}
            inp["title"] = "bench"
            for opt_name, opts in rows:
                cid = fx["id"] + (f"|opt:{opt_name}" if opt_name else "")
                case_opts = {"title": "bench", **stage_opts, **(opts or {})}
                out.append({"id": cid, "ref_id": fx["reference"], "entry": entry, "input": inp, "opts": case_opts,
                            "bar_sec": list(fx["truth"]["bar_starts_s"]), "fixture": path, "opt_name": opt_name,
                            "profile": d})
    return out


def generate(suite: Dict[str, Any], refs, filter_: Optional[str]):
    """(jobs, lock rows, tag lists): every case of the suite as an arranger job, in id order."""
    from . import runner
    by = corpus.by_id(refs)
    cases, rows, perfs = runner.generate(suite, refs, filter_)
    jobs: List[Dict[str, Any]] = []
    tags: Dict[str, List[str]] = {}
    for c in cases:
        p = perfs[c.id]
        canon = corpus.read_reference(by[c.ref_id])
        tm = p.timemap
        bar_sec = [tm.sec(m.start_q) for m in canon.measures] + [tm.sec(canon.end_q)]
        jobs.append({"id": c.id, "ref": c.ref_id, "input": p.input, "opts": p.opts, "bar_sec": bar_sec})
        tags[c.id] = list(c.tags)
    file_sha: Dict[str, str] = {}
    for rc in replay_cases(suite, by):
        if filter_ and filter_ not in rc["id"]:
            continue
        entry = rc["entry"]
        canon = musicxml.read_score(entry.abspath, ottava=corpus.REFERENCE_OTTAVA)
        try:
            tm = BarStartTimeMap(canon, rc["bar_sec"])
        except StatsShapeError as exc:
            raise ValueError(f"{rc['id']}: {exc}") from exc
        jobs.append({"id": rc["id"], "ref": rc["ref_id"], "input": rc["input"], "opts": rc["opts"], "bar_sec": rc["bar_sec"]})
        for f in (entry.abspath, rc["fixture"]):
            if f not in file_sha:
                file_sha[f] = util.content_sha256(f)
        tags[rc["id"]] = corpus.derived_tags(entry, corpus.read_reference(entry)) + [
            f"profile:{rc['profile']}", "beats:none", "kind:replay"] + ([f"opts:{rc['opt_name']}"] if rc["opt_name"] else [])
        rows.append({"id": rc["id"], "reference_sha256": file_sha[entry.abspath],
                     "input_sha256": suite_mod.input_sha256(rc["input"], rc["opts"])})
    jobs.sort(key=lambda j: j["id"])
    return jobs, rows, tags


def run_node(jobs: List[Dict[str, Any]], refs_by_id: Dict[str, Any], sut: str, node: Optional[str] = None) -> Dict[str, Any]:
    """The arranger batch: jobs are split by reference over up to four Node processes (every case is independent, and a reference's
    clean arrangement is made once per process); the rows are the same whatever the split."""
    workers = min(4, os.cpu_count() or 1) if len(jobs) >= PARALLEL_FROM else 1
    by_ref: Dict[str, List[Dict[str, Any]]] = {}
    for j in jobs:
        by_ref.setdefault(j["ref"], []).append(j)
    chunks: List[List[Dict[str, Any]]] = [[] for _ in range(max(1, workers))]
    load = [0] * len(chunks)
    for ref in sorted(by_ref, key=lambda r: (-len(by_ref[r]), r)):      # longest first onto the lightest chunk: deterministic
        i = load.index(min(load))
        chunks[i].extend(by_ref[ref])
        load[i] += len(by_ref[ref])
    chunks = [c for c in chunks if c]
    with tempfile.TemporaryDirectory(prefix="pppbench-arr-") as tmp:
        refs_path = os.path.join(tmp, "refs.jsonl")
        with open(refs_path, "w", encoding="utf-8", newline="\n") as h:
            for rid in sorted(by_ref):
                h.write(json.dumps({"id": rid, "xml": xml_text(musicxml.read_bytes(refs_by_id[rid].abspath))}, ensure_ascii=False) + "\n")

        def one(i_chunk):
            i, chunk = i_chunk
            jin, jout = os.path.join(tmp, f"jobs{i}.jsonl"), os.path.join(tmp, f"out{i}.jsonl")
            with open(jin, "w", encoding="utf-8", newline="\n") as h:
                for j in chunk:
                    h.write(json.dumps(j, ensure_ascii=False) + "\n")
            env = dict(os.environ)
            env["NODE_NO_WARNINGS"] = "1"
            proc = subprocess.run([stages.node_binary(node), REC_ARRANGE_JS, "--in", jin, "--refs", refs_path, "--out", jout,
                                   "--audio-score", sut], capture_output=True, env=env)
            if proc.returncode != 0:
                raise stages.StageError("rec-arrange.js failed: " + proc.stderr.decode("utf-8", "replace")[-2000:])
            rows, meta = {}, {}
            with open(jout, encoding="utf-8") as h:
                for line in h:
                    row = json.loads(line)
                    if "meta" in row:
                        meta = row["meta"]
                    else:
                        rows[row["id"]] = row
            return rows, meta

        from concurrent.futures import ThreadPoolExecutor
        with ThreadPoolExecutor(max_workers=len(chunks)) as pool:
            parts = list(pool.map(one, enumerate(chunks)))
    results: Dict[str, Any] = {}
    meta: Dict[str, Any] = dict(parts[0][1])
    for r, _ in parts:
        results.update(r)
    meta["sut_modules"] = sorted({x for _, m in parts for x in (m.get("sut_modules") or [])})
    if len(results) != len(jobs):
        raise stages.StageError(f"rec-arrange.js returned {len(results)} rows for {len(jobs)} jobs")
    try:
        sut_mod.check_closure(meta, sut)
    except sut_mod.SutError as exc:
        raise stages.StageError(str(exc)) from exc
    return {"results": results, "meta": meta}


def run_suite(suite: Dict[str, Any], *, audio_score: Optional[str] = None, out_dir: Optional[str] = None,
              filter_: Optional[str] = None, reveal_holdout: bool = False, write_cases: bool = True,
              check_lock: bool = True, quiet: bool = False) -> Dict[str, Any]:
    from . import runner
    t0 = time.perf_counter()
    started = datetime.now(timezone.utc).isoformat(timespec="seconds")
    refs = corpus.load_corpus()
    by = corpus.by_id(refs)
    jobs, rows, tags = generate(suite, refs, filter_)
    t_gen = time.perf_counter()
    lock_file = suite_mod.lock_path(suite)
    lock = util.load_json(lock_file) if os.path.exists(lock_file) else None
    if check_lock:
        drifts = suite_mod.verify_lock(suite, rows, lock, partial=bool(filter_))
        if drifts:
            raise runner.RunError("INPUT_DRIFT", f"{len(drifts)} difference(s) against {os.path.basename(lock_file)}:\n  " +
                                  "\n  ".join(drifts[:20]) + ("\n  ..." if len(drifts) > 20 else "") +
                                  "\nIf the change is intended: run.py relock --suite <name> --reason \"...\", then rebaseline.")
    sut = os.path.abspath(audio_score or stages.default_audio_score())
    ran = run_node(jobs, by, sut)
    t_arr = time.perf_counter()
    cases = []
    for j in jobs:
        row = ran["results"][j["id"]]
        rec = {"id": j["id"], "key": suite_mod.case_key(j["id"]), "tags": tags[j["id"]], "status": "ok", "error_code": None,
               "expected": None, "metrics": {}, "counts": {}, "predicted": None}
        if row.get("ok"):
            rec.update(metrics={k: v for k, v in sorted(row["metrics"].items())}, counts=row["counts"])
        else:
            rec.update(status="error", error_code="ARRANGE_" + str(row.get("code") or "exception").upper().replace("-", "_"),
                       error=str(row.get("error") or "")[:300])
        cases.append(rec)
    results = {"schema": "ppp.bench-results/1", "suite": suite["name"], "suite_sha256": suite_mod.suite_sha256(suite),
               "lock_sha256": util.content_sha256(lock_file) if lock else None, "versions": versions(suite),
               "filtered": bool(filter_), "rec_arrange": True, "aggregates": aggregate.aggregate(cases),
               "known_failures": None, "exclusions": None, "cases": cases}
    out = out_dir or runner.out_dir_for(suite)
    if os.path.isdir(os.path.join(out, "cases")):
        shutil.rmtree(os.path.join(out, "cases"))
    util.dump_json(results, os.path.join(out, "results.json"))
    finished = datetime.now(timezone.utc).isoformat(timespec="seconds")
    run = {"started_at": started, "finished_at": finished, "git_sha": util.git_sha(), "git_dirty": util.git_dirty(),
           "audio_score_path": util.rel(sut) if sut.startswith(util.repo_root()) else sut,
           "audio_score_sha256": util.content_sha256(sut), **sut_mod.describe(sut),
           "sut_modules": ran["meta"].get("sut_modules"), "node": ran["meta"].get("node"),
           "python": platform.python_version(), "platform": sys.platform, "argv": sys.argv[1:],
           "cases": len(jobs), "errors": sum(1 for r in cases if r["status"] == "error"),
           "timing": {"total_s": round(time.perf_counter() - t0, 3), "generate_s": round(t_gen - t0, 3),
                      "arrange_s": round(t_arr - t_gen, 3)}}
    util.dump_json(run, os.path.join(out, "run.json"))
    if not quiet:
        print(f"{suite['name']}: {len(jobs)} cases, {run['errors']} errors in {run['timing']['total_s']} s "
              f"(generate {run['timing']['generate_s']}, arrange {run['timing']['arrange_s']})")
        print(f"results: {util.rel(os.path.join(out, 'results.json')) if out.startswith(util.repo_root()) else out}")
    results = util.load_json_text(util.dumps_json(results))
    return {"results": results, "run": run, "out": out, "reveal_holdout": reveal_holdout}
