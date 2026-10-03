"""Run a suite: generate inputs, verify the lock, notate, evaluate, write outputs (docs/GOALS/G00 §9.1)."""

from __future__ import annotations

import os
import platform
import shutil
import sys
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

from . import VERSIONS, aggregate, corpus, evaluate, perform, stages, suite as suite_mod, sut as sut_mod, util

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


def stage_case_opts(stage_opts: Dict[str, Any], row_opts: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """The suite's ``stage.opts`` under the matrix row's own ``opts`` (the row wins). A suite with no stage opts
    gives exactly the row's opts (None stays None), so every existing suite and lock is unchanged."""
    if not stage_opts:
        return row_opts
    return {**stage_opts, **(row_opts or {})}


def parse_shard(spec: str) -> Tuple[int, int]:
    """``"K/N"`` (1 <= K <= N) -> ``(K, N)``: the K-th of N shards of a suite's cases."""
    try:
        k, n = (int(x) for x in str(spec).split("/"))
    except ValueError:
        raise RunError("BAD_SHARD", f"--shard wants K/N, e.g. 2/4, not {spec!r}") from None
    if not 1 <= k <= n:
        raise RunError("BAD_SHARD", f"--shard K/N needs 1 <= K <= N, not {spec!r}")
    return k, n


def select_shard(cases: List[Any], shard: Optional[Tuple[int, int]]) -> List[Any]:
    """Shard K of N: every N-th case of the suite's id-sorted list starting at the (K-1)-th. Round-robin over the sorted
    ids, so each shard holds the same mix of references, profiles and options (about the same work) and the N shards
    partition the suite exactly. Every case is independent of every other (its performance, notation, metrics and
    stability probe are functions of the case alone), so a case's row is the same in a shard as in the whole run."""
    if not shard:
        return cases
    k, n = shard
    return cases[k - 1::n]


def generate(suite: Dict[str, Any], refs: Optional[List[corpus.RefEntry]] = None, filter_: Optional[str] = None,
             shard: Optional[Tuple[int, int]] = None):
    """Expand cases and build their synthetic performances. Returns (cases, lock rows, perfs).

    The lock row's reference_sha256 is the hash of the reference file as it is now, not the value
    registered in references.json, so an edited reference stops `run` with INPUT_DRIFT even when
    the edit leaves the performance unchanged (a key signature, a spelling) (§17 m1)."""
    refs = refs if refs is not None else corpus.load_corpus()
    by = corpus.by_id(refs)
    cases = suite_mod.expand(suite, refs)
    if filter_:
        cases = [c for c in cases if filter_ in c.id]
    cases = select_shard(cases, shard)
    stage_opts = (suite.get("stage") or {}).get("opts") or {}   # what the suite asks of toMusicXml (G10a-0: the app's options)
    rows, perfs, file_sha = [], {}, {}
    for c in cases:
        entry = by[c.ref_id]
        if entry.path not in file_sha:
            file_sha[entry.path] = util.content_sha256(entry.abspath)
        canon = corpus.read_reference(entry)
        c.tags = corpus.derived_tags(entry, canon) + [f"profile:{c.profile}", f"beats:{c.beats}", f"seed:{c.seed}"] + \
            ([f"opts:{c.opt_name}"] if c.opt_name else []) + (["holdout"] if c.holdout else [])
        p = perform.perform(canon, c.ref_id, c.profile, c.beats, c.seed, expect=entry.expect,
                            case_opts=stage_case_opts(stage_opts, c.opts), opt_name=c.perform_as or c.opt_name)
        perfs[c.id] = p
        rows.append({"id": c.id, "reference_sha256": file_sha[entry.path],
                     "input_sha256": suite_mod.input_sha256(p.input, p.opts)})
    return cases, rows, perfs


def exclusions_summary(refs: Optional[List[corpus.RefEntry]] = None) -> Dict[str, Any]:
    """What the benchmark leaves out, why, and how much of each collection that is (§17 M8, M9)."""
    from collections import Counter, defaultdict
    from . import known_defects
    refs = refs if refs is not None else corpus.load_corpus()
    excluded = util.load_json(corpus.EXCLUDED)["excluded"]
    reasons = {"L6": "duplicate measure numbers", "L8": "the reference's own bars are overfull, underfull or empty",
               "P1": "quarantined: no licence evidence in the repository"}
    by_rule: Dict[str, Any] = {}
    for x in excluded:
        r = by_rule.setdefault(x["rule"], {"count": 0, "why": reasons.get(x["rule"], x["rule"]), "ids": []})
        r["count"] += 1
        r["ids"].append(x["id"])
    skipped = [r for r in refs if r.expect.get("skip_metrics")]
    cov: Dict[str, Dict[str, int]] = defaultdict(lambda: Counter())
    for c in corpus.candidate_files(util.tracked_files()):
        col = known_defects.collection(c["path"]) if not c["path"].startswith("tests/") else c["set"]
        cov[col]["committed"] += 1
    for r in refs:
        col = known_defects.collection(r.path) if not r.path.startswith("tests/") else r.set
        cov[col]["registered"] += 1
        cov[col]["hold-out"] += int(r.holdout)
    for x in excluded:
        col = known_defects.collection(x["path"]) if not x["path"].startswith("tests/") else x["id"].split("/")[0]
        cov[col]["excluded " + x["rule"]] += 1
    return {
        "excluded_references": dict(sorted(by_rule.items())),
        "skipped_metrics": {
            "references": len(skipped),
            "metrics": sorted({m for r in skipped for m in r.expect["skip_metrics"]}),
            "why": "the file's notes contradict its own key signature, so its key and spelling truth is wrong",
            "production_impact": "known failure key_signature_playback: these scores play wrong notes in PPP",
            "ids": sorted(r.id for r in skipped)},   # sorted: the registry's order must not change results.json
        "coverage_by_collection": {k: dict(sorted(v.items())) for k, v in sorted(cov.items())},
    }


SHARD_SCHEMA = "ppp.bench-shard/1"


def results_doc(suite: Dict[str, Any], lock_sha256: Optional[str], results_cases: List[Dict[str, Any]],
                known_failures: Dict[str, Any], exclusions: Dict[str, Any], *, filtered: bool) -> Dict[str, Any]:
    """The results.json of a suite, from its case rows: one function for ``run_suite`` and ``merge_shards``, so a merged
    run is the whole run's file byte for byte."""
    return {
        "schema": "ppp.bench-results/1", "suite": suite["name"], "suite_sha256": suite_mod.suite_sha256(suite),
        "lock_sha256": lock_sha256, "versions": {**VERSIONS, "generator": suite_mod.generator_version(suite)},
        "filtered": filtered, "aggregates": aggregate.aggregate(results_cases),
        "known_failures": known_failures, "exclusions": exclusions, "cases": results_cases,
    }


def run_suite(suite: Dict[str, Any], *, audio_score: Optional[str] = None, out_dir: Optional[str] = None,
              filter_: Optional[str] = None, reveal_holdout: bool = False, write_cases: bool = True,
              check_lock: bool = True, quiet: bool = False, shard: Optional[Tuple[int, int]] = None) -> Dict[str, Any]:
    """``shard=(K, N)``: only the K-th of N shards of the suite's cases, written as a shard (``shard.json``, ``run.json``) that
    ``merge_shards`` joins with the others into the very results.json of the whole run (docs: tests/bench/README.md)."""
    if suite.get("rec_arrange"):           # G10c-0: the arranger's behaviour on recordings (pppbench/recarrange.py), same result shape
        if shard:
            raise RunError("BAD_SHARD", "--shard is not implemented for a rec-arrange suite (its runner, recarrange.py, runs whole)")
        from . import recarrange
        return recarrange.run_suite(suite, audio_score=audio_score, out_dir=out_dir, filter_=filter_, reveal_holdout=reveal_holdout,
                                    write_cases=write_cases, check_lock=check_lock, quiet=quiet)
    t0 = time.perf_counter()
    started = datetime.now(timezone.utc).isoformat(timespec="seconds")
    refs = corpus.load_corpus()
    by = corpus.by_id(refs)
    cases, rows, perfs = generate(suite, refs, filter_, shard)
    t_gen = time.perf_counter()
    lock_file = suite_mod.lock_path(suite)
    lock = util.load_json(lock_file) if os.path.exists(lock_file) else None
    if check_lock:
        drifts = suite_mod.verify_lock(suite, rows, lock, partial=bool(filter_) or bool(shard))
        if drifts:
            raise RunError("INPUT_DRIFT", f"{len(drifts)} difference(s) against {os.path.basename(lock_file)}:\n  " +
                           "\n  ".join(drifts[:20]) + ("\n  ..." if len(drifts) > 20 else "") +
                           "\nIf the change is intended: run.py relock --suite <name> --reason \"...\", then rebaseline.")
    sut = os.path.abspath(audio_score or stages.default_audio_score())
    jobs = [{"id": c.id, "input": perfs[c.id].input, "opts": perfs[c.id].opts} for c in cases]
    use_rec = bool(suite.get("rec"))        # a suite that asks for the recording metrics (G10a-0, metrics/rec.py)
    notated = stages.notate_batch(jobs, audio_score=sut, check=use_rec)
    rec_extra = {}
    if use_rec:
        from . import recrun
        rec_extra = recrun.extras(cases, perfs, notated["results"], by, sut)
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
                                                                 skip_metrics=entry.expect.get("skip_metrics", ()),
                                                                 **({"truth_pedals": p.truth_pedals} if p.has_truth_pedals else {}),
                                                                 **({"rec_extra": rec_extra[c.id]} if use_rec else {}))
            rec.update(metrics=metrics, counts=counts, predicted=predicted)
        except evaluate.CaseError as exc:
            rec.update(status="error", error_code=exc.code, error=str(exc)[:300])
        results_cases.append(rec)
        artifacts[c.key] = (c.id, row, rec)
    t_met = time.perf_counter()

    from . import known_defects
    lock_sha = util.content_sha256(lock_file) if lock else None
    known, excl = known_defects.audit(), exclusions_summary(refs)
    out = out_dir or out_dir_for(suite)
    if shard:
        # a shard is not a result: its rows go to shard.json at full precision (merge_shards aggregates them exactly as the
        # whole run would have), and there is no results.json for `check` or `update-baseline` to mistake for one
        if os.path.isdir(os.path.join(out, "cases")):
            shutil.rmtree(os.path.join(out, "cases"))
        for stale in ("results.json", "summary.md", "index.json"):
            if os.path.exists(os.path.join(out, stale)):
                os.remove(os.path.join(out, stale))
        util.write_text(os.path.join(out, "shard.json"), util.dumps_json_exact(
            {"schema": SHARD_SCHEMA, "suite": suite["name"], "suite_sha256": suite_mod.suite_sha256(suite), "lock_sha256": lock_sha,
             "versions": {**VERSIONS, "generator": suite_mod.generator_version(suite)},
             "shard": {"index": shard[0], "of": shard[1]}, "known_failures": known, "exclusions": excl, "cases": results_cases}))
        results = None
    else:
        results = results_doc(suite, lock_sha, results_cases, known, excl, filtered=bool(filter_))
        if os.path.isdir(os.path.join(out, "cases")):
            shutil.rmtree(os.path.join(out, "cases"))
        util.dump_json(results, os.path.join(out, "results.json"))
    if write_cases and not shard:
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
           "audio_score_sha256": util.content_sha256(sut), **sut_mod.describe(sut),
           "sut_modules": notated["meta"].get("sut_modules"), "node": notated["meta"].get("node"),
           "python": platform.python_version(), "platform": sys.platform, "argv": sys.argv[1:],
           "cases": len(cases), "errors": sum(1 for r in results_cases if r["status"] == "error"),
           "timing": {"total_s": round(time.perf_counter() - t0, 3), "generate_s": round(t_gen - t0, 3),
                      "notate_s": round(t_not - t_gen, 3), "metrics_s": round(t_met - t_not, 3),
                      "per_case_ms": per_case_ms}}
    util.dump_json(run, os.path.join(out, "run.json"))
    if not quiet:
        what = f"shard {shard[0]}/{shard[1]} of {suite['name']}" if shard else suite["name"]
        print(f"{what}: {len(cases)} cases, {run['errors']} errors in {run['timing']['total_s']} s "
              f"(generate {run['timing']['generate_s']}, notate {run['timing']['notate_s']}, metrics {run['timing']['metrics_s']})")
        target = "shard.json" if shard else "results.json"
        print(f"results: {util.rel(os.path.join(out, target)) if out.startswith(util.repo_root()) else out}")
    if shard:
        return {"results": None, "run": run, "out": out, "reveal_holdout": reveal_holdout, "shard": shard}
    # hand back exactly what results.json holds (6-decimal floats), so an in-process compare
    # sees the same numbers as `check` reading the file
    results = util.load_json_text(util.dumps_json(results))
    return {"results": results, "run": run, "out": out, "reveal_holdout": reveal_holdout}


def shard_dirs_of(suite: Dict[str, Any]) -> List[str]:
    """Every directory under ``out/<suite>/shards/`` that holds a shard (sorted by name), the default input of a merge."""
    root = os.path.join(out_dir_for(suite), "shards")
    if not os.path.isdir(root):
        return []
    return [os.path.join(root, d) for d in sorted(os.listdir(root)) if os.path.isfile(os.path.join(root, d, "shard.json"))]


def merge_shards(suite: Dict[str, Any], dirs: List[str], out_dir: Optional[str] = None) -> Dict[str, Any]:
    """Join the N shards of one run of ``suite`` into the run's results.json and run.json (what ``check`` and
    ``update-baseline`` read), byte for byte what an unsharded run of the same code writes.

    Refuses (``RunError``, exit 2) anything that is not exactly one complete run: a shard missing or twice, shards of
    different suite definitions, locks, metric versions or SUT snapshots (another commit), and a union of cases that is not
    the committed lock's. Rows are ordered by case id, as ``expand`` does, and aggregated by ``results_doc``."""
    if not dirs:
        raise RunError("SHARD_MISSING", f"no shard directories (out/{suite['name']}/shards/*/shard.json)")
    shards = []
    for d in dirs:
        sp, rp = os.path.join(d, "shard.json"), os.path.join(d, "run.json")
        if not (os.path.isfile(sp) and os.path.isfile(rp)):
            raise RunError("SHARD_MISSING", f"{d} has no shard.json and run.json")
        shards.append((util.load_json(sp), util.load_json(rp), d))
    first, first_run, _ = shards[0]
    for sh, _, d in shards:
        where = sh.get("shard") if isinstance(sh.get("shard"), dict) else {}
        if sh.get("schema") != SHARD_SCHEMA or not isinstance(where.get("index"), int) or not isinstance(where.get("of"), int):
            raise RunError("SHARD_MISMATCH", f"{d}/shard.json is not a {SHARD_SCHEMA} file with a shard index")
    n = first["shard"]["of"]
    lock_file = suite_mod.lock_path(suite)
    lock = util.load_json(lock_file) if os.path.exists(lock_file) else None
    if lock is None:
        raise RunError("SHARD_MISMATCH", f"{os.path.basename(lock_file)}: the suite has no lock file")
    expect = {"suite": suite["name"], "suite_sha256": suite_mod.suite_sha256(suite), "lock_sha256": util.content_sha256(lock_file),
              "versions": {**VERSIONS, "generator": suite_mod.generator_version(suite)}}
    for sh, run, d in shards:
        for key, want in expect.items():
            if sh.get(key) != want:
                raise RunError("SHARD_MISMATCH", f"{d}: {key} differs from this checkout's ({str(sh.get(key))[:40]} against "
                                                 f"{str(want)[:40]}): the shards are not of this commit's suite, lock and metrics")
        for key in ("known_failures", "exclusions"):
            if sh.get(key) != first.get(key):
                raise RunError("SHARD_MISMATCH", f"{d}: {key} differs from the first shard's")
        if sh["shard"]["of"] != n:
            raise RunError("SHARD_MISMATCH", f"{d}: shard {sh['shard']['index']}/{sh['shard']['of']}, but the first is of {n}")
        for key in ("git_sha", "audio_score_path", "audio_score_sha256", "sut_sha256"):
            if run.get(key) != first_run.get(key):
                raise RunError("SHARD_MISMATCH", f"{d}: run.json {key} differs from the first shard's ({run.get(key)} against "
                                                 f"{first_run.get(key)}): the shards ran on different code")
    seen = sorted(sh["shard"]["index"] for sh, _, _ in shards)
    if seen != list(range(1, n + 1)):
        missing = sorted(set(range(1, n + 1)) - set(seen))
        dup = sorted({i for i in seen if seen.count(i) > 1})
        raise RunError("SHARD_MISSING" if missing else "SHARD_DUPLICATE",
                       f"shards {seen} of {n}" + (f": missing {missing}" if missing else "") + (f": twice {dup}" if dup else ""))
    cases = sorted((c for sh, _, _ in shards for c in sh["cases"]), key=lambda c: c["id"])
    ids = [c["id"] for c in cases]
    locked = {c["id"] for c in lock.get("cases", [])}
    if len(set(ids)) != len(ids) or set(ids) != locked:
        raise RunError("SHARD_INCOMPLETE", f"{len(ids)} rows ({len(set(ids))} distinct) against the lock's {len(locked)} cases: "
                       f"{len(locked - set(ids))} missing (e.g. {sorted(locked - set(ids))[:3]}), "
                       f"{len(set(ids) - locked)} not in the lock")
    results = results_doc(suite, expect["lock_sha256"], cases, first["known_failures"], first["exclusions"], filtered=False)
    out = out_dir or out_dir_for(suite)
    if os.path.isdir(os.path.join(out, "cases")):                # what an earlier unsharded run left is not this run's
        shutil.rmtree(os.path.join(out, "cases"))
    for stale in ("summary.md", "index.json"):
        if os.path.exists(os.path.join(out, stale)):
            os.remove(os.path.join(out, stale))
    util.dump_json(results, os.path.join(out, "results.json"))
    runs = [r for _, r, _ in shards]
    timing = {k: max(r["timing"][k] for r in runs) for k in ("total_s", "generate_s", "notate_s", "metrics_s")}
    timing["per_case_ms"] = {cid: ms for r in runs for cid, ms in r["timing"]["per_case_ms"].items()}
    timing["shard_total_s"] = [r["timing"]["total_s"] for r in runs]          # the shards ran side by side: the run took the longest
    run = {k: first_run[k] for k in ("git_sha", "audio_score_path", "audio_score_sha256", "sut_sha256", "sut_files", "node", "python",
                                     "platform") if k in first_run}
    runtimes = sorted({f"node {r.get('node')}, python {r.get('python')}, {r.get('platform')}" for r in runs})
    if len(runtimes) > 1:      # a patch release between two shards' setup steps: noted, not refused (the code is the same)
        run["runtimes"] = runtimes
    run.update({"git_dirty": any(r.get("git_dirty") for r in runs), "started_at": min(r["started_at"] for r in runs),
                "finished_at": max(r["finished_at"] for r in runs), "argv": ["merge-shards", suite["name"]],
                "sut_modules": sorted({m for r in runs for m in (r.get("sut_modules") or [])}),
                "cases": len(cases), "errors": sum(1 for c in cases if c["status"] == "error"), "shards": n, "timing": timing})
    util.dump_json(run, os.path.join(out, "run.json"))
    return {"results": results, "run": run, "out": out}


def cli_merge_shards(args) -> int:
    suite = suite_mod.load_suite(args.suite)
    dirs = args.dirs or shard_dirs_of(suite)
    try:
        r = merge_shards(suite, dirs, out_dir=args.out)
    except RunError as exc:
        print(f"ERROR {exc}")
        return 2
    print(f"{suite['name']}: merged {r['run']['shards']} shards, {r['run']['cases']} cases, {r['run']['errors']} errors "
          f"(the longest shard {r['run']['timing']['total_s']} s)")
    if r["run"].get("runtimes"):
        print("WARNING: the shards ran on different runtimes: " + "; ".join(r["run"]["runtimes"]))
    print(f"results: {util.rel(os.path.join(r['out'], 'results.json')) if r['out'].startswith(util.repo_root()) else r['out']}"
          f" · next: python tests/bench/run.py check --suite {suite['name']}")
    return 0


def cli_run(args) -> int:
    from . import compare, report
    suite = suite_mod.load_suite(args.suite or args.suite_file)
    shard_spec = getattr(args, "shard", None)
    if shard_spec and (suite.get("kind") != "synthetic-notation" or args.filter):
        print("ERROR BAD_SHARD: --shard is for a synthetic suite's whole run (not --filter, not a replay or OMR suite)")
        return 2
    if suite.get("kind") == "omr-live":
        from . import tiers
        return tiers.omr_live(args, suite)
    if suite.get("kind") != "synthetic-notation":
        from . import private
        return private.run_private(suite, args)
    if shard_spec:
        try:
            shard = parse_shard(shard_spec)
            out = args.out or os.path.join(out_dir_for(suite), "shards", f"{shard[0]}-of-{shard[1]}")
            run_suite(suite, audio_score=args.audio_score, out_dir=out, write_cases=False, shard=shard)
        except RunError as exc:
            print(f"ERROR {exc}")
            return 2
        print(f"a shard has no verdict: after all {shard[1]} shards, `python tests/bench/run.py merge-shards --suite {suite['name']}` "
              f"then `check --suite {suite['name']}`")
        return 0
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
    """``git:<rev>``, ``worktree`` or a file path -> a path to an audio-score.js.

    ``git:<rev>`` extracts the revision's whole SUT snapshot (audio-score.js and scoregraph/, pppbench/sut.py)
    into ``.cache/ab/<name>/`` so each side runs its own library, never the working tree's (G01 §15.4)."""
    if spec == "worktree":
        return stages.default_audio_score()
    if spec.startswith("git:"):
        return sut_mod.extract_git(spec[4:], os.path.join(CACHE_DIR, "ab", name))
    if not os.path.exists(spec):
        raise FileNotFoundError(spec)
    return os.path.abspath(spec)


def _fixture_side(suite: Dict[str, Any], sut: str, out: str) -> Dict[str, Any]:
    """One side of an A/B on a fixture suite (replay-public, omr-live, a private suite): the suite's own
    runner, whose results.json and run.json the comparison then reads."""
    import contextlib
    import io
    import types
    from . import private
    with contextlib.redirect_stdout(io.StringIO()):          # its verdict is against the stored baseline, not the other side
        private.run_private(suite, types.SimpleNamespace(audio_score=sut, out=out))
    return {"results": util.load_json(os.path.join(out, "results.json")), "run": util.load_json(os.path.join(out, "run.json"))}


def cli_ab(args) -> int:
    from . import compare, report
    suite = suite_mod.load_suite(args.suite)
    a_path, b_path = resolve_sut(args.a, "a"), resolve_sut(args.b, "b")
    base = out_dir_for(suite)
    try:
        if "references" in suite:
            ra = run_suite(suite, audio_score=a_path, out_dir=os.path.join(base, "ab-a"), write_cases=False)
            rb = run_suite(suite, audio_score=b_path, out_dir=os.path.join(base, "ab-b"))
        else:
            ra = _fixture_side(suite, a_path, os.path.join(base, "ab-a"))
            rb = _fixture_side(suite, b_path, os.path.join(base, "ab-b"))
            print(f"{suite['name']}: {len(rb['results']['cases'])} cases, "
                  f"{sum(c['status'] == 'error' for c in rb['results']['cases'])} errors on side b")
    except RunError as exc:
        print(f"ERROR {exc}")
        return 2
    pseudo = compare.baseline_from_results(ra["results"], ra["run"], reason=f"A/B side a ({args.a})",
                                           gate=suite.get("gate"))
    verdict = compare.compare(rb["results"], pseudo, suite.get("gate") or {})
    path = os.path.join(base, "ab-summary.md")
    report.write_summary(rb["results"], rb["run"], verdict, pseudo, path,
                         title=f"A/B {suite['name']}: a = {args.a}, b = {args.b}")
    print(compare.format_verdict(verdict))
    print(f"A/B summary: {util.rel(path)}")
    return verdict.exit_code
