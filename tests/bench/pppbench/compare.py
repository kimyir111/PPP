"""Baselines and the regression gate (docs/GOALS/G00 §9.2, §9.3, §9.7).

Order: versions/lock/suite checks (ERROR, exit 2) -> per case (new error,
SQI drop) -> per aggregate metric -> tag guards. Any FAIL is a REGRESSION
(exit 1); otherwise PASS (exit 0), with improvements listed.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from . import stages, suite as suite_mod, util

BASELINE_DIR = os.path.join(util.bench_root(), "baselines")
EPS = 1e-9


@dataclass
class Verdict:
    status: str  # PASS | REGRESSION | ERROR
    failures: List[str] = field(default_factory=list)
    warnings: List[str] = field(default_factory=list)
    improvements: List[str] = field(default_factory=list)
    errors: List[str] = field(default_factory=list)
    deltas: Dict[str, Dict[str, Any]] = field(default_factory=dict)
    case_deltas: List[Dict[str, Any]] = field(default_factory=list)
    failed_metrics: List[str] = field(default_factory=list)

    @property
    def exit_code(self) -> int:
        return {"PASS": 0, "REGRESSION": 1}.get(self.status, 2)


def baseline_path(name: str) -> str:
    return os.path.join(BASELINE_DIR, name + ".json")


def baseline_path_for(suite: Dict[str, Any]) -> str:
    if suite_mod.is_private(suite):
        return os.path.join(os.path.dirname(suite["_path"]), "baseline.json")
    if suite["name"] == "full":
        return os.path.join(BASELINE_DIR, "full.aggregates.json")
    return baseline_path(suite["name"])


def load_baseline(suite: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    p = baseline_path_for(suite)
    return util.load_json(p) if os.path.exists(p) else None


def _mean(agg: Dict[str, Any], key: str) -> Optional[float]:
    v = agg.get(key)
    return v.get("mean") if isinstance(v, dict) else None


def compare(results: Dict[str, Any], baseline: Optional[Dict[str, Any]], gate: Dict[str, Any]) -> Verdict:
    v = Verdict("PASS")
    if baseline is None:
        v.status = "ERROR"
        v.errors.append("NO_BASELINE: record one with update-baseline")
        return v
    if results.get("versions") != baseline.get("versions"):
        v.errors.append(f"VERSION_MISMATCH: results {results.get('versions')} vs baseline {baseline.get('versions')} — "
                        "rerecord the baseline (update-baseline) for the new versions")
    if results.get("suite_sha256") != baseline.get("suite_sha256"):
        v.errors.append("SUITE_CHANGED: the suite's cases changed since the baseline; rebaseline with a reason")
    if results.get("lock_sha256") != baseline.get("lock_sha256"):
        v.errors.append("INPUT_DRIFT: the input lock changed since the baseline; rebaseline with a reason")
    if results.get("filtered"):
        v.errors.append("FILTERED_RUN: a --filter run cannot be checked against the baseline")
    if v.errors:
        v.status = "ERROR"
        return v

    # per case
    base_cases = baseline.get("cases") or {}
    fail_drop, warn_drop = gate.get("case_fail_drop", 10.0), gate.get("case_warn_drop", 2.0)
    for c in results["cases"]:
        b = base_cases.get(c["id"])
        if b is None:
            continue
        hidden = "holdout" in c["tags"]
        label = "(hold-out case)" if hidden else c["id"]
        if b.get("status") == "ok" and c["status"] != "ok":
            v.failures.append(f"case {label}: was ok, now error {c['error_code']}")
            continue
        s_new, s_old = (c["metrics"] or {}).get("sqi"), b.get("sqi")
        if s_new is None or s_old is None:
            continue
        d = s_new - s_old
        if abs(d) > EPS:
            v.case_deltas.append({"id": c["id"], "key": c["key"], "delta": d, "sqi": s_new, "holdout": hidden,
                                  "cause": _cause(c["metrics"], b.get("metrics") or {})})
        if d <= -fail_drop + EPS:
            v.failures.append(f"case {label}: SQI {s_old:.2f} -> {s_new:.2f} ({d:+.2f})")
        elif d <= -warn_drop + EPS:
            v.warnings.append(f"case {label}: SQI {s_old:.2f} -> {s_new:.2f} ({d:+.2f})")

    # aggregates
    new_all, old_all = results["aggregates"]["all"], baseline["aggregates"]["all"]
    for metric, rule in (gate.get("metrics") or {}).items():
        a, b = _mean(new_all, metric), _mean(old_all, metric)
        if a is None or b is None:
            if (a is None) != (b is None):
                v.warnings.append(f"{metric}: {'now null' if a is None else 'was null'}")
            continue
        d = a - b
        tol = rule["tol"]
        v.deltas[metric] = {"value": a, "baseline": b, "delta": d, "dir": rule["dir"], "tol": tol}
        worse = -d if rule["dir"] == "up" else d
        allowed = abs(tol)
        if worse > allowed + EPS:
            v.failures.append(f"{metric}: {b:.6f} -> {a:.6f} ({d:+.6f}, allowed {'-' if rule['dir'] == 'up' else '+'}{allowed:g})")
            v.failed_metrics.append(metric)
            v.deltas[metric]["status"] = "FAIL"
        elif worse > allowed / 2 + EPS:
            v.warnings.append(f"{metric}: {b:.6f} -> {a:.6f} ({d:+.6f})")
            v.deltas[metric]["status"] = "WARN"
        elif -worse > max(allowed, 0.0) + EPS:
            v.improvements.append(f"{metric}: {b:.6f} -> {a:.6f} ({d:+.6f})")
            v.deltas[metric]["status"] = "IMPROVED"
        else:
            v.deltas[metric]["status"] = "ok"

    # tag guards
    tg = gate.get("tag_guards") or {}
    for tag in tg.get("tags", []):
        a = _mean(results["aggregates"]["by_tag"].get(tag, {}), tg.get("metric", "sqi"))
        b = _mean(baseline["aggregates"]["by_tag"].get(tag, {}), tg.get("metric", "sqi"))
        if a is None or b is None:
            continue
        if a - b < tg.get("min_delta", -1.0) - EPS:
            v.failures.append(f"tag {tag}: {tg.get('metric', 'sqi')} {b:.3f} -> {a:.3f} ({a - b:+.3f}, allowed {tg.get('min_delta')})")
            v.failed_metrics.append(f"tag:{tag}")
    v.case_deltas.sort(key=lambda x: (x["delta"], x["id"]))
    v.status = "REGRESSION" if v.failures else "PASS"
    return v


def _cause(new: Dict[str, Any], old: Dict[str, Any]) -> Optional[str]:
    from .metrics.composite import SQI_WEIGHTS
    best, worst = None, 0.0
    for k, w in SQI_WEIGHTS.items():
        a, b = new.get(k), old.get(k)
        if a is None or b is None:
            continue
        d = abs(a - b) * w
        if d > worst + EPS:
            best, worst = f"{k} {b:.3f}->{a:.3f}", d
    return best


def format_verdict(v: Verdict) -> str:
    lines = [f"verdict: {v.status}"]
    for title, items in (("errors", v.errors), ("failures", v.failures), ("warnings", v.warnings),
                         ("improvements", v.improvements)):
        if items:
            lines.append(f"{title} ({len(items)}):")
            lines += [f"  - {x}" for x in items[:40]]
            if len(items) > 40:
                lines.append(f"  ... {len(items) - 40} more")
    return "\n".join(lines)


def baseline_from_results(results: Dict[str, Any], run: Dict[str, Any], *, reason: str,
                          previous: Optional[Dict[str, Any]] = None, full: bool = False) -> Dict[str, Any]:
    date = datetime.now(timezone.utc).date().isoformat()
    agg_all = results["aggregates"]["all"]
    anchor = (previous or {}).get("anchor") or {
        "git_sha": run.get("git_sha"), "date": date,
        "aggregates_all": {k: v for k, v in agg_all.items() if isinstance(v, dict) and "mean" in v}}
    history = list((previous or {}).get("history") or [])
    history.append({"date": date, "git_sha": run.get("git_sha"), "reason": reason,
                    "sqi_all": _mean(agg_all, "sqi"), "audio_score_sha256": run.get("audio_score_sha256")})
    base = {
        "schema": "ppp.bench-baseline/1", "suite": results["suite"], "suite_sha256": results["suite_sha256"],
        "lock_sha256": results["lock_sha256"], "versions": results["versions"],
        "recorded": {"git_sha": run.get("git_sha"), "git_dirty": run.get("git_dirty"), "date": date,
                     "audio_score_sha256": run.get("audio_score_sha256"), "node": run.get("node"),
                     "python": run.get("python"), "platform": run.get("platform")},
        "anchor": anchor, "aggregates": results["aggregates"], "history": history,
    }
    if not full:
        # per case: what the case checks and the "main cause" column read (the SQI components)
        from .metrics.composite import SQI_S_WEIGHTS, SQI_WEIGHTS
        keep = set(SQI_WEIGHTS) | set(SQI_S_WEIGHTS)
        base["cases"] = {c["id"]: {"status": c["status"], "error_code": c["error_code"],
                                   "sqi": (c["metrics"] or {}).get("sqi"),
                                   "metrics": {k: v for k, v in (c["metrics"] or {}).items() if k in keep}}
                         for c in results["cases"]}
    return base


def _load_last(suite):
    from .runner import out_dir_for
    out = out_dir_for(suite)
    rp, jp = os.path.join(out, "results.json"), os.path.join(out, "run.json")
    if not os.path.exists(rp):
        return None, None
    return util.load_json(rp), util.load_json(jp)


def cli_check(args) -> int:
    suite = suite_mod.load_suite(args.suite or args.suite_file)
    results, run = _load_last(suite)
    if results is None:
        print(f"ERROR NO_RESULTS: run `python tests/bench/run.py run --suite {suite['name']}` first")
        return 2
    base = load_baseline(suite)
    v = compare(results, base, suite.get("gate") or {})
    print(format_verdict(v))
    from . import report
    from .runner import out_dir_for
    report.write_summary(results, run, v, base, os.path.join(out_dir_for(suite), "summary.md"))
    return v.exit_code


def cli_update_baseline(args) -> int:
    suite = suite_mod.load_suite(args.suite or args.suite_file)
    results, run = _load_last(suite)
    if results is None:
        print(f"ERROR NO_RESULTS: run the suite first")
        return 2
    if results.get("filtered"):
        print("ERROR FILTERED_RUN: a --filter run cannot become a baseline")
        return 2
    sut = run.get("audio_score_path") or ""
    sut_abs = sut if os.path.isabs(sut) else os.path.join(util.repo_root(), sut)
    if os.path.exists(sut_abs) and util.content_sha256(sut_abs) != run.get("audio_score_sha256"):
        print("ERROR SUT_CHANGED: audio-score.js changed after the run; run the suite again first")
        return 2
    if os.path.abspath(sut_abs) != os.path.abspath(stages.default_audio_score()):
        print("ERROR NOT_WORKTREE_SUT: the last run used a different audio-score.js; a baseline must come from the repository's SUT")
        return 2
    prev = load_baseline(suite)
    base = baseline_from_results(results, run, reason=args.reason, previous=prev, full=suite["name"] == "full")
    path = baseline_path_for(suite)
    util.dump_json(base, path)
    print(f"baseline {os.path.relpath(path, util.repo_root())} updated — SQI {_mean(results['aggregates']['all'], 'sqi')}; reason: {args.reason}")
    return 0
