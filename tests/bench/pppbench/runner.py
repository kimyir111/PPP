"""Run a suite: generate inputs, verify the lock, notate, evaluate, write outputs (docs/GOALS/G00 §9.1)."""

from __future__ import annotations

import os
import platform
import shutil
import sys
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

from . import VERSIONS, aggregate, corpus, evaluate, perform, stages, suite as suite_mod, util

OUT_DIR = os.path.join(util.bench_root(), "out")
CACHE_DIR = os.path.join(util.bench_root(), ".cache")


class RunError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(f"{code}: {message}")
        self.code = code


def out_dir_for(suite: Dict[str, Any]) -> str:
    if suite_mod.is_private(suite):
        return os.path.join(os.path.dirname(suite["_path"]), "out", suite["name"])
    return os.path.join(OUT_DIR, suite["name"])


def generate(suite: Dict[str, Any], refs: Optional[List[corpus.RefEntry]] = None, filter_: Optional[str] = None):
    """Expand cases and build their synthetic performances. Returns (cases, lock rows, perfs)."""
    refs = refs if refs is not None else corpus.load_corpus()
    by = corpus.by_id(refs)
    cases = suite_mod.expand(suite, refs)
    if filter_:
        cases = [c for c in cases if filter_ in c.id]
    rows, perfs = [], {}
    for c in cases:
        entry = by[c.ref_id]
        canon = corpus.read_reference(entry)
        c.tags = corpus.derived_tags(entry, canon) + [f"profile:{c.profile}", f"beats:{c.beats}", f"seed:{c.seed}"] + \
            (["holdout"] if c.holdout else [])
        p = perform.perform(canon, c.ref_id, c.profile, c.beats, c.seed, expect=entry.expect,
                            case_opts=c.opts, opt_name=c.opt_name)
        perfs[c.id] = p
        rows.append({"id": c.id, "reference_sha256": entry.sha256, "input_sha256": suite_mod.input_sha256(p.input, p.opts)})
    return cases, rows, perfs


def run_suite(suite: Dict[str, Any], *, audio_score: Optional[str] = None, out_dir: Optional[str] = None,
              filter_: Optional[str] = None, reveal_holdout: bool = False, write_cases: bool = True,
              check_lock: bool = True, quiet: bool = False) -> Dict[str, Any]:
    t0 = time.perf_counter()
    started = datetime.now(timezone.utc).isoformat(timespec="seconds")
    refs = corpus.load_corpus()
    by = corpus.by_id(refs)
    cases, rows, perfs = generate(suite, refs, filter_)
    t_gen = time.perf_counter()
    lock_file = suite_mod.lock_path(suite)
    lock = util.load_json(lock_file) if os.path.exists(lock_file) else None
    if check_lock:
        drifts = suite_mod.verify_lock(suite, rows, lock, partial=bool(filter_))
        if drifts:
            raise RunError("INPUT_DRIFT", f"{len(drifts)} difference(s) against {os.path.basename(lock_file)}:\n  " +
                           "\n  ".join(drifts[:20]) + ("\n  ..." if len(drifts) > 20 else "") +
                           "\nIf the change is intended: run.py relock --suite <name> --reason \"...\", then rebaseline.")
    sut = os.path.abspath(audio_score or stages.default_audio_score())
    jobs = [{"id": c.id, "input": perfs[c.id].input, "opts": perfs[c.id].opts} for c in cases]
    notated = stages.notate_batch(jobs, audio_score=sut)
    t_not = time.perf_counter()
    window = (suite.get("align") or {}).get("window_s", 0.30)
    results_cases, per_case_ms, artifacts = [], {}, {}
    for c in cases:
        entry = by[c.ref_id]
        ref = corpus.read_reference(entry)
        p = perfs[c.id]
        row = notated["results"][c.id]
        per_case_ms[c.id] = round(row.get("ms", 0.0), 3)
        rec = {"id": c.id, "key": c.key, "tags": c.tags, "status": "ok", "error_code": None,
               "expected": {k: p.expected[k] for k in ("qpm", "time", "key", "measures")},
               "metrics": {}, "counts": {}, "predicted": None}
        try:
            metrics, counts, predicted = evaluate.evaluate_timed(ref, p, row, window_s=window,
                                                                 skip_metrics=entry.expect.get("skip_metrics", ()))
            rec.update(metrics=metrics, counts=counts, predicted=predicted)
        except evaluate.CaseError as exc:
            rec.update(status="error", error_code=exc.code, error=str(exc)[:300])
        results_cases.append(rec)
        artifacts[c.key] = (c.id, row, rec)
    t_met = time.perf_counter()

    results = {
        "schema": "ppp.bench-results/1", "suite": suite["name"], "suite_sha256": suite_mod.suite_sha256(suite),
        "lock_sha256": util.content_sha256(lock_file) if lock else None, "versions": dict(VERSIONS),
        "filtered": bool(filter_), "aggregates": aggregate.aggregate(results_cases), "cases": results_cases,
    }
    out = out_dir or out_dir_for(suite)
    if os.path.isdir(os.path.join(out, "cases")):
        shutil.rmtree(os.path.join(out, "cases"))
    util.dump_json(results, os.path.join(out, "results.json"))
    if write_cases:
        os.makedirs(os.path.join(out, "cases"), exist_ok=True)
        for key, (cid, row, rec) in artifacts.items():
            base = os.path.join(out, "cases", key)
            if row.get("ok"):
                with open(base + ".musicxml", "w", encoding="utf-8", newline="\n") as handle:
                    handle.write(row["xml"].replace("\r\n", "\n"))
                util.dump_json(row.get("stats"), base + ".stats.json")
            util.dump_json(rec, base + ".metrics.json")
        util.dump_json({k: v[0] for k, v in artifacts.items()}, os.path.join(out, "index.json"))
    finished = datetime.now(timezone.utc).isoformat(timespec="seconds")
    run = {"started_at": started, "finished_at": finished, "git_sha": util.git_sha(), "git_dirty": util.git_dirty(),
           "audio_score_path": util.rel(sut) if sut.startswith(util.repo_root()) else sut,
           "audio_score_sha256": util.content_sha256(sut), "node": notated["meta"].get("node"),
           "python": platform.python_version(), "platform": sys.platform, "argv": sys.argv[1:],
           "cases": len(cases), "errors": sum(1 for r in results_cases if r["status"] == "error"),
           "timing": {"total_s": round(time.perf_counter() - t0, 3), "generate_s": round(t_gen - t0, 3),
                      "notate_s": round(t_not - t_gen, 3), "metrics_s": round(t_met - t_not, 3),
                      "per_case_ms": per_case_ms}}
    util.dump_json(run, os.path.join(out, "run.json"))
    if not quiet:
        print(f"{suite['name']}: {len(cases)} cases, {run['errors']} errors in {run['timing']['total_s']} s "
              f"(generate {run['timing']['generate_s']}, notate {run['timing']['notate_s']}, metrics {run['timing']['metrics_s']})")
        print(f"results: {util.rel(os.path.join(out, 'results.json')) if out.startswith(util.repo_root()) else out}")
    return {"results": results, "run": run, "out": out, "reveal_holdout": reveal_holdout}


def cli_run(args) -> int:
    from . import compare, report
    suite = suite_mod.load_suite(args.suite or args.suite_file)
    if suite.get("kind") == "omr-live":
        from . import tiers
        return tiers.omr_live(args, suite)
    if suite.get("kind") != "synthetic-notation":
        from . import private
        return private.run_private(suite, args)
    try:
        r = run_suite(suite, audio_score=args.audio_score, out_dir=args.out, filter_=args.filter,
                      reveal_holdout=args.reveal_holdout)
    except RunError as exc:
        print(f"ERROR {exc}")
        return 2
    base = compare.load_baseline(suite)
    verdict = compare.compare(r["results"], base, suite.get("gate") or {}) if base else None
    report.write_summary(r["results"], r["run"], verdict, base, os.path.join(r["out"], "summary.md"),
                         reveal_holdout=args.reveal_holdout)
    headline = r["results"]["aggregates"]["all"]
    sqi = headline.get("sqi", {}).get("mean")
    print(f"SQI {sqi} · summary: {util.rel(os.path.join(r['out'], 'summary.md')) if r['out'].startswith(util.repo_root()) else r['out']}")
    return 0


def resolve_sut(spec: str, name: str) -> str:
    """``git:<rev>``, ``worktree`` or a file path -> a path to an audio-score.js."""
    if spec == "worktree":
        return stages.default_audio_score()
    if spec.startswith("git:"):
        rev = spec[4:]
        data = util.git("show", f"{rev}:audio-score.js")
        path = os.path.join(CACHE_DIR, "ab", f"{name}.js")
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8", newline="\n") as handle:
            handle.write(data)
        return path
    if not os.path.exists(spec):
        raise FileNotFoundError(spec)
    return os.path.abspath(spec)


def cli_ab(args) -> int:
    from . import compare, report
    suite = suite_mod.load_suite(args.suite)
    a_path, b_path = resolve_sut(args.a, "a"), resolve_sut(args.b, "b")
    base = out_dir_for(suite)
    try:
        ra = run_suite(suite, audio_score=a_path, out_dir=os.path.join(base, "ab-a"), write_cases=False)
        rb = run_suite(suite, audio_score=b_path, out_dir=os.path.join(base, "ab-b"))
    except RunError as exc:
        print(f"ERROR {exc}")
        return 2
    pseudo = compare.baseline_from_results(ra["results"], ra["run"], reason=f"A/B side a ({args.a})")
    verdict = compare.compare(rb["results"], pseudo, suite.get("gate") or {})
    path = os.path.join(base, "ab-summary.md")
    report.write_summary(rb["results"], rb["run"], verdict, pseudo, path,
                         title=f"A/B {suite['name']}: a = {args.a}, b = {args.b}")
    print(compare.format_verdict(verdict))
    print(f"A/B summary: {util.rel(path)}")
    return verdict.exit_code
