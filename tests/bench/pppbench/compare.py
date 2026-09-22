"""Baselines and the regression gate (docs/GOALS/G00 §9.2, §9.3, §9.7, §17).

Order: versions/lock/suite checks (ERROR, exit 2) -> per case -> per aggregate metric -> subgroups
-> known failures. Any FAIL is a REGRESSION (exit 1); otherwise PASS (exit 0), with improvements.

What a regression is (gate/2):
* A case that was ok and now errors, or loses ``case_fail_drop`` diagnostic points.
* **Coverage**: a gated metric that had a value (in a case, or in an aggregate) and now has none.
  Missing output is never "not applicable" and never an improvement (§17 B1).
* **Critical flips**: more than ``case_flip_max`` cases going from pass to fail on one critical
  gate, even when as many others go the other way (§17 M2).
* **Micro guard**: a micro piece isolates one question, so any drop on any guarded metric of a
  micro case fails, with no tolerance (§17 M3).
* An aggregate metric beyond its tolerance, including ``usable`` and every critical gate's rate.
* **Subgroups** (§17 M3): every tag with a prefix in ``subgroups.prefixes`` and at least
  ``min_cases`` cases in both runs is checked on its own. Tolerances follow the group size so that
  one case cannot fail a group but a pattern can: a rate may drop by max(rate_abs, 1/n) (one case
  flipping), a 0-1 mean by max(mean_abs, mean_per_case/n), the diagnostic score by sqi_abs points.
  Smaller groups are covered by the case-level rules above.
* **Known failures**: a class of catalogue defect whose count grows (a new defect); a shrinking
  count is reported as an improvement (a fix).
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from . import stages, suite as suite_mod, util
from .metrics.critical import GATES as CRITICAL_GATES

BASELINE_DIR = os.path.join(util.bench_root(), "baselines")
EPS = 1e-9
ROUNDING = 1e-6  # results and baselines keep 6 decimals; smaller case differences are not changes
CRITICAL = list(CRITICAL_GATES) + ["usable"]
MICRO_GUARD = ["notes.identity.f1", "notation.onset_pos.accuracy", "notation.duration.accuracy",
               "notation.hand.accuracy", "notation.spelling.accuracy", "notation.ioi.accuracy",
               "struct.time_sig.exact", "struct.key.fifths_exact", "struct.tempo.ok_effective",
               "notation.accidentals.required_recall", "notation.pedal.f1", "read.bar_integrity",
               "struct.time_sig.timeline_accuracy", "struct.key.timeline_accuracy", "struct.tempo.timeline_accuracy",
               "notation.note_shape.consistency", "notation.duration.page_accuracy", "read.bar_completeness", "struct.measure_numbers.valid",
               "struct.measure_numbers.app_onset_accuracy"] + CRITICAL


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
    flips: Dict[str, List[str]] = field(default_factory=dict)
    semantic_changes: int = 0

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


def _n(agg: Dict[str, Any], key: str) -> int:
    v = agg.get(key)
    return int(v.get("n") or 0) if isinstance(v, dict) else 0


def _fail(v: Verdict, msg: str, metric: Optional[str] = None) -> None:
    v.failures.append(msg)
    if metric and metric not in v.failed_metrics:
        v.failed_metrics.append(metric)


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

    gated = set((gate.get("metrics") or {}).keys()) | set(CRITICAL)
    fail_drop, warn_drop = gate.get("case_fail_drop", 10.0), gate.get("case_warn_drop", 2.0)
    flip_max = gate.get("case_flip_max", 2)
    base_cases = baseline.get("cases") or {}
    now_null: List[str] = []
    flips: Dict[str, List[str]] = {g: [] for g in CRITICAL}
    for c in results["cases"]:
        b = base_cases.get(c["id"])
        if b is None:
            continue
        hidden = "holdout" in c["tags"]
        label = "(hold-out case)" if hidden else c["id"]
        if b.get("status") == "ok" and c["status"] != "ok":
            _fail(v, f"case {label}: was ok, now error {c['error_code']}", "case:error")
            continue
        if c["status"] != "ok":
            continue
        cm, bm = c["metrics"] or {}, b.get("metrics") or {}
        if b.get("semantic") and (c.get("predicted") or {}).get("semantic") != b.get("semantic"):
            v.semantic_changes += 1
        for k in sorted(gated):
            if bm.get(k) is not None and cm.get(k) is None:
                now_null.append(f"{label}: {k}")
        for g in CRITICAL:
            if bm.get(g) == 1.0 and cm.get(g) == 0.0:
                flips[g].append(label)
        if "set:micro" in c["tags"]:
            for k in MICRO_GUARD:
                a, bb = cm.get(k), bm.get(k)
                if bb is not None and a is not None and a < bb - ROUNDING:
                    _fail(v, f"micro case {label}: {k} {bb:.4f} -> {a:.4f} (micro pieces allow no drop)", f"micro:{k}")
        s_new, s_old = cm.get("sqi"), b.get("sqi")
        if s_new is None or s_old is None:
            continue
        d = s_new - s_old
        if abs(d) > ROUNDING:
            v.case_deltas.append({"id": c["id"], "key": c["key"], "delta": d, "sqi": s_new, "holdout": hidden,
                                  "cause": _cause(cm, bm)})
        if d <= -fail_drop + EPS:
            _fail(v, f"case {label}: diagnostic score {s_old:.2f} -> {s_new:.2f} ({d:+.2f})", "case:sqi")
        elif d <= -warn_drop + EPS:
            v.warnings.append(f"case {label}: diagnostic score {s_old:.2f} -> {s_new:.2f} ({d:+.2f})")
    if now_null:
        _fail(v, f"coverage: {len(now_null)} case metric(s) that had a value now have none (missing output is a "
                 f"regression, not n/a), e.g. {'; '.join(now_null[:4])}", "coverage")
    v.flips = {g: ids for g, ids in flips.items() if ids}
    for g, ids in v.flips.items():
        msg = f"{g}: {len(ids)} case(s) went from pass to fail, e.g. {', '.join(ids[:3])}"
        if len(ids) > flip_max:
            _fail(v, msg + f" (allowed {flip_max})", f"flip:{g}")
        else:
            v.warnings.append(msg)

    # aggregates
    new_all, old_all = results["aggregates"]["all"], baseline["aggregates"]["all"]
    for metric, rule in (gate.get("metrics") or {}).items():
        a, b = _mean(new_all, metric), _mean(old_all, metric)
        if b is not None and (a is None or _n(new_all, metric) < _n(old_all, metric)):
            _fail(v, f"{metric}: coverage fell from {_n(old_all, metric)} to {_n(new_all, metric)} cases "
                     "(a metric that stops applying is a regression, not n/a)", metric)
            if a is None:
                continue
        if a is None or b is None:
            if a is not None and b is None:
                v.warnings.append(f"{metric}: new metric (no baseline value)")
            continue
        d = a - b
        tol = rule["tol"]
        v.deltas[metric] = {"value": a, "baseline": b, "delta": d, "dir": rule["dir"], "tol": tol}
        worse = -d if rule["dir"] == "up" else d
        allowed = abs(tol)
        if worse > allowed + EPS:
            _fail(v, f"{metric}: {b:.6f} -> {a:.6f} ({d:+.6f}, allowed {'-' if rule['dir'] == 'up' else '+'}{allowed:g})", metric)
            v.deltas[metric]["status"] = "FAIL"
        elif worse > allowed / 2 + EPS:
            v.warnings.append(f"{metric}: {b:.6f} -> {a:.6f} ({d:+.6f})")
            v.deltas[metric]["status"] = "WARN"
        elif -worse > max(allowed, 0.0) + EPS:
            v.improvements.append(f"{metric}: {b:.6f} -> {a:.6f} ({d:+.6f})")
            v.deltas[metric]["status"] = "IMPROVED"
        else:
            v.deltas[metric]["status"] = "ok"

    _subgroups(v, results, baseline, gate)
    _known_failures(v, results, baseline)
    v.case_deltas.sort(key=lambda x: (x["delta"], x["id"]))
    v.status = "REGRESSION" if v.failures else "PASS"
    return v


def _subgroups(v: Verdict, results, baseline, gate) -> None:
    sg = gate.get("subgroups") or {}
    prefixes = tuple(sg.get("prefixes") or ())
    if not prefixes:
        return
    min_cases = sg.get("min_cases", 15)
    new_tags, old_tags = results["aggregates"]["by_tag"], baseline["aggregates"]["by_tag"]
    for tag in sorted(set(new_tags) & set(old_tags)):
        if not tag.startswith(prefixes):
            continue
        a_agg, b_agg = new_tags[tag], old_tags[tag]
        n = min(a_agg.get("cases", 0), b_agg.get("cases", 0))
        if n < min_cases:
            continue
        for metric, kind in (sg.get("metrics") or {}).items():
            a, b = _mean(a_agg, metric), _mean(b_agg, metric)
            if b is None:
                continue
            if a is None or _n(a_agg, metric) < _n(b_agg, metric):
                _fail(v, f"tag {tag}: {metric} coverage fell from {_n(b_agg, metric)} to {_n(a_agg, metric)}", f"tag:{tag}")
                continue
            if kind == "sqi":
                allowed = sg.get("sqi_abs", 1.0)
            elif kind == "rate":
                allowed = max(sg.get("rate_abs", 0.02), 1.0 / n)
            else:
                allowed = max(sg.get("mean_abs", 0.01), sg.get("mean_per_case", 0.25) / n)
            if b - a > allowed + EPS:
                _fail(v, f"tag {tag} ({n} cases): {metric} {b:.4f} -> {a:.4f} ({a - b:+.4f}, allowed -{allowed:.4f})",
                      f"tag:{tag}")


def _known_failures(v: Verdict, results, baseline) -> None:
    new = (results.get("known_failures") or {}).get("classes") or {}
    old = (baseline.get("known_failures") or {}).get("classes") or {}
    for cid in sorted(set(new) | set(old)):
        a, b = new.get(cid, {}), old.get(cid, {})
        ai, bi = a.get("items", 0), b.get("items", 0)
        af, bf = a.get("files_affected", 0), b.get("files_affected", 0)
        if ai > bi or af > bf:
            _fail(v, f"known failure {cid}: {bf} files / {bi} {a.get('unit') or b.get('unit')} -> {af} / {ai} "
                     "(a new catalogue defect)", f"known:{cid}")
        elif ai < bi or af < bf:
            v.improvements.append(f"known failure {cid}: {bf} files / {bi} -> {af} / {ai} (fewer: a fix?)")


def _cause(new: Dict[str, Any], old: Dict[str, Any]) -> Optional[str]:
    from .metrics.composite import SQI_WEIGHTS
    best, worst = None, 0.0
    for k in CRITICAL:
        if old.get(k) == 1.0 and new.get(k) == 0.0:
            return f"{k} failed"
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
    if v.semantic_changes:
        lines.append(f"semantic changes: {v.semantic_changes} case(s) now write different music (see summary.md)")
    return "\n".join(lines)


def case_row_keys(gate: Optional[Dict[str, Any]] = None) -> set:
    from .metrics.composite import SQI_S_WEIGHTS, SQI_WEIGHTS
    keep = set(SQI_WEIGHTS) | set(SQI_S_WEIGHTS) | set(CRITICAL) | set(MICRO_GUARD) | {"sqi"}
    if gate:
        keep |= set((gate.get("metrics") or {}).keys())
    return keep


def baseline_from_results(results: Dict[str, Any], run: Dict[str, Any], *, reason: str,
                          previous: Optional[Dict[str, Any]] = None, full: bool = False,
                          gate: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    date = datetime.now(timezone.utc).date().isoformat()
    agg_all = results["aggregates"]["all"]
    same_defs = previous is not None and previous.get("versions") == results["versions"]
    # the anchor is the first baseline under the current metric definitions; a version change
    # starts a new one (comparing sqi/2 with an sqi/1 anchor would mean nothing)
    anchor = ((previous or {}).get("anchor") if same_defs else None) or {
        "git_sha": run.get("git_sha"), "date": date, "versions": results["versions"],
        "aggregates_all": {k: v for k, v in agg_all.items() if isinstance(v, dict) and "mean" in v}}
    history = list((previous or {}).get("history") or [])
    if previous is not None and not same_defs:
        history.append({"date": date, "event": f"versions {previous.get('versions')} -> {results['versions']}; "
                                                "new anchor, earlier numbers are not comparable"})
    history.append({"date": date, "git_sha": run.get("git_sha"), "reason": reason,
                    "sqi_all": _mean(agg_all, "sqi"), "usable_all": _mean(agg_all, "usable"),
                    "audio_score_sha256": run.get("audio_score_sha256")})
    base = {
        "schema": "ppp.bench-baseline/1", "suite": results["suite"], "suite_sha256": results["suite_sha256"],
        "lock_sha256": results["lock_sha256"], "versions": results["versions"],
        "recorded": {"git_sha": run.get("git_sha"), "git_dirty": run.get("git_dirty"), "date": date,
                     "audio_score_sha256": run.get("audio_score_sha256"), "node": run.get("node"),
                     "python": run.get("python"), "platform": run.get("platform")},
        "anchor": anchor, "aggregates": results["aggregates"], "history": history,
        "known_failures": results.get("known_failures"),
    }
    if not full:
        keep = case_row_keys(gate)
        base["cases"] = {c["id"]: {"status": c["status"], "error_code": c["error_code"],
                                   "sqi": (c["metrics"] or {}).get("sqi"),
                                   "semantic": (c.get("predicted") or {}).get("semantic"),
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


def stale_reason(run: Dict[str, Any]) -> Optional[str]:
    """Why the last run's results no longer describe the SUT they name (m2), or None."""
    sut = run.get("audio_score_path") or ""
    sut_abs = sut if os.path.isabs(sut) else os.path.join(util.repo_root(), sut)
    if not os.path.exists(sut_abs):
        return f"the SUT {sut} of the last run no longer exists"
    if util.content_sha256(sut_abs) != run.get("audio_score_sha256"):
        return f"{os.path.basename(sut_abs)} changed after the run"
    return None


def cli_check(args) -> int:
    suite = suite_mod.load_suite(args.suite or args.suite_file)
    results, run = _load_last(suite)
    if results is None:
        print(f"ERROR NO_RESULTS: run `python tests/bench/run.py run --suite {suite['name']}` first")
        return 2
    why = stale_reason(run or {})
    if why:
        print(f"ERROR STALE_RESULTS: {why}; run the suite again first")
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
    why = stale_reason(run or {})
    if why:
        print(f"ERROR SUT_CHANGED: {why}; run the suite again first")
        return 2
    sut = run.get("audio_score_path") or ""
    sut_abs = sut if os.path.isabs(sut) else os.path.join(util.repo_root(), sut)
    if os.path.abspath(sut_abs) != os.path.abspath(stages.default_audio_score()):
        print("ERROR NOT_WORKTREE_SUT: the last run used a different audio-score.js; a baseline must come from the repository's SUT")
        return 2
    prev = load_baseline(suite)
    base = baseline_from_results(results, run, reason=args.reason, previous=prev, full=suite["name"] == "full",
                                 gate=suite.get("gate"))
    path = baseline_path_for(suite)
    util.dump_json(base, path)
    print(f"baseline {os.path.relpath(path, util.repo_root())} updated — usable {_mean(results['aggregates']['all'], 'usable')}, "
          f"diagnostic {_mean(results['aggregates']['all'], 'sqi')}; reason: {args.reason}")
    return 0
