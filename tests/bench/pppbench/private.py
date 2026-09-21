"""Suites that are not synthetic: recorded helper results (replay) and finished score files.

* ``replay-public`` (in the repository): fixtures in tests/bench/replay/*.json
  recorded by tools/record_replay.py from licence-clean references (§6.8).
* private suites (``run --suite-file PATH``, docs/GOALS/G00 §15 B): copyrighted
  recordings and official scores stay outside the repository, and so do their
  outputs and baseline. Writing them inside the repository is refused.
"""

from __future__ import annotations

import glob
import os
import platform
import sys
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from . import VERSIONS, aggregate, corpus, evaluate, musicxml, stages, suite as suite_mod, util
from .perform import Performance
from .timemap import BarStartTimeMap, StatsShapeError

REPLAY_DIR = os.path.join(util.bench_root(), "replay")


def _inside_repo(path: str) -> bool:
    return os.path.abspath(path).startswith(os.path.abspath(util.repo_root()) + os.sep)


def _expected(canon, expect: Dict[str, Any], bar_starts: List[float]) -> Dict[str, Any]:
    t = expect.get("time")
    k = expect.get("key")
    m0 = canon.measures[0]
    return {"qpm": expect.get("tempo_qpm") or canon.effective_qpm,
            "time": list(t) if t else list(canon.primary_time()),
            "key": {"fifths": int(k["fifths"]), "mode": k.get("mode")} if k else
                   {"fifths": m0.fifths, "mode": m0.mode if m0.mode_explicit else None},
            "measures": len(canon.measures),
            "bar_starts": [bar_starts[i] for i, m in enumerate(canon.measures) if not m.implicit]}


def load_cases(suite: Dict[str, Any]) -> List[Dict[str, Any]]:
    base = os.path.dirname(suite["_path"])
    if suite.get("fixtures") == "replay":
        cases = []
        refs = corpus.by_id(corpus.load_corpus())
        for path in sorted(glob.glob(os.path.join(REPLAY_DIR, "*.json"))):
            fx = util.load_json(path)
            entry = refs[fx["reference"]]
            cases.append({"id": fx["id"], "kind": "replay", "reference_path": entry.abspath, "expect": entry.expect,
                          "bar_starts": fx["truth"]["bar_starts_s"], "helper_result": fx["helper_result"],
                          "truth_notes": fx["truth"].get("notes"), "reference_sha256": fx.get("reference_sha256"),
                          "entry_sha256": entry.sha256})
        return cases
    out = []
    for c in suite.get("cases", []):
        kind = c.get("kind") or suite.get("kind")
        row = {"id": c["id"], "kind": kind, "reference_path": os.path.join(base, c["reference"]),
               "expect": c.get("expect") or {}}
        if kind == "replay":
            bs = c["reference_bar_starts"]
            row["bar_starts"] = util.load_json(os.path.join(base, bs)) if isinstance(bs, str) else bs
            row["helper_result"] = util.load_json(os.path.join(base, c["helper_result"]))
            row["truth_notes"] = None
        else:
            row["prediction_path"] = os.path.join(base, c["prediction"])
        out.append(row)
    return out


def run_private(suite: Dict[str, Any], args) -> int:
    from . import compare, report
    private = suite_mod.is_private(suite)
    out = args.out or (os.path.join(os.path.dirname(suite["_path"]), "out", suite["name"]) if private
                       else os.path.join(util.bench_root(), "out", suite["name"]))
    if private and _inside_repo(out):
        print("ERROR PRIVATE_OUTPUT_IN_REPO: a private suite keeps its outputs outside the repository")
        return 2
    cases = load_cases(suite)
    if not cases:
        print(f"SKIPPED: suite {suite['name']} has no cases yet"
              + (" — record fixtures with `run.py record-replay` (tests/bench/README.md, Replay)" if suite.get("fixtures") == "replay" else ""))
        return 0
    t0 = time.perf_counter()
    jobs, perfs, canons = [], {}, {}
    for c in cases:
        canon = musicxml.read_score(c["reference_path"])
        canons[c["id"]] = canon
        if c["kind"] == "replay":
            try:
                tm = BarStartTimeMap(canon, c["bar_starts"])
            except StatsShapeError as exc:
                c["error"] = ("STATS_SHAPE", str(exc))
                continue
            hr = c["helper_result"]
            inp = {k: hr[k] for k in ("notes", "pedals", "beats", "downbeats", "beatConfidence", "grid") if k in hr}
            inp["title"] = "bench"
            perfs[c["id"]] = Performance(input=inp, opts={"title": "bench"}, truth=[],
                                         expected=_expected(canon, c["expect"], c["bar_starts"]), timemap=tm, start_s=0.0)
            jobs.append({"id": c["id"], "input": inp, "opts": {"title": "bench"}})
    sut = os.path.abspath(args.audio_score or stages.default_audio_score())
    notated = stages.notate_batch(jobs, audio_score=sut) if jobs else {"results": {}, "meta": {}}
    rows = []
    for c in cases:
        canon = canons[c["id"]]
        rec = {"id": c["id"], "key": suite_mod.case_key(c["id"]), "tags": [f"kind:{c['kind']}"], "status": "ok",
               "error_code": None, "metrics": {}, "counts": {}, "predicted": None,
               "expected": None}
        try:
            if c.get("error"):
                raise evaluate.CaseError(*c["error"])
            if c["kind"] == "replay":
                p = perfs[c["id"]]
                rec["expected"] = {k: p.expected[k] for k in ("qpm", "time", "key", "measures")}
                m, counts, pred = evaluate.evaluate_timed(canon, p, notated["results"][c["id"]],
                                                          skip_metrics=c["expect"].get("skip_metrics", ()))
                if c.get("truth_notes"):
                    sys.path.insert(0, util.repo_root())
                    from evaluate_transcription import evaluate as amt_eval  # unchanged, imported
                    a = amt_eval({"notes": c["truth_notes"], "pedals": []},
                                 {"notes": c["helper_result"].get("notes", []), "pedals": []})
                    m.update({"amt.note_f1": a["f1"], "amt.offset_f1": a["offset_f1"],
                              "amt.mean_onset_error_ms": a["mean_onset_error_ms"], "amt.pedal_iou": a["pedal_iou"]})
            else:
                pred_canon = musicxml.read_score(c["prediction_path"])
                exp = _expected(canon, c["expect"], [0.0] * (len(canon.measures) + 1))
                rec["expected"] = {k: exp[k] for k in ("qpm", "time", "key", "measures")}
                m, counts, pred, _ = evaluate.evaluate_symbolic(canon, pred_canon, exp,
                                                                skip_metrics=c["expect"].get("skip_metrics", ()))
            rec.update(metrics=m, counts=counts, predicted=pred)
        except (evaluate.CaseError, musicxml.ReaderError) as exc:
            rec.update(status="error", error_code=getattr(exc, "code", "ERROR"), error=str(exc)[:300])
        rows.append(rec)
    rows.sort(key=lambda r: r["id"])
    results = {"schema": "ppp.bench-results/1", "suite": suite["name"], "suite_sha256": suite_mod.suite_sha256(suite),
               "lock_sha256": None, "versions": dict(VERSIONS), "filtered": False,
               "aggregates": aggregate.aggregate(rows), "cases": rows}
    util.dump_json(results, os.path.join(out, "results.json"))
    run = {"started_at": datetime.now(timezone.utc).isoformat(timespec="seconds"), "git_sha": util.git_sha(),
           "git_dirty": util.git_dirty(), "audio_score_path": sut, "audio_score_sha256": util.content_sha256(sut),
           "node": notated["meta"].get("node"), "python": platform.python_version(), "platform": sys.platform,
           "cases": len(rows), "timing": {"total_s": round(time.perf_counter() - t0, 3)}}
    util.dump_json(run, os.path.join(out, "run.json"))
    base = compare.load_baseline(suite)
    verdict = compare.compare(results, base, suite.get("gate") or {}) if base else None
    report.write_summary(results, run, verdict, base, os.path.join(out, "summary.md"))
    print(f"{suite['name']}: {len(rows)} cases, {sum(r['status'] == 'error' for r in rows)} errors · results in {out}")
    if verdict:
        print(compare.format_verdict(verdict))
    return 0 if verdict is None else verdict.exit_code
