"""Gate sensitivity check (docs/GOALS/G00 §9.5).

Copies audio-score.js to .cache/mutations/, applies one exact string
replacement per mutation, runs the ``mutation`` suite on the original and on
each copy, and compares each copy against the original run as a temporary
baseline. Every harmful mutation must be a REGRESSION that names its metric;
the no-op mutation must PASS with a byte-identical results.json.
"""

from __future__ import annotations

import os
from typing import Any, Dict, List

from . import compare, runner, stages, suite as suite_mod, util

MUTATIONS: List[Dict[str, Any]] = [
    {"id": "MUT-HANDS",
     "find": "groups[g].notes.forEach(n => { n.staff = n.midi >= s ? 1 : 2; });",
     "replace": "groups[g].notes.forEach(n => { n.staff = n.midi >= 60 ? 1 : 2; });",
     "expect": "REGRESSION", "metrics": ["notation.hand.accuracy"]},
    {"id": "MUT-KEY",
     "find": "best.margin = best.score - second;",
     "replace": "best = { fifths: 0, mode: 'major', tonic: 0, r: 0, score: 0, diatonicFit: 0 }; best.margin = 1;",
     "expect": "REGRESSION", "metrics": ["struct.key.fifths_exact"]},
    {"id": "MUT-DUR",
     "find": "let end = ends[Math.floor((ends.length - 1) / 2)];",
     "replace": "let end = t + 6;",
     "expect": "REGRESSION", "metrics": ["notation.duration.accuracy"]},
    {"id": "MUT-METRE",
     "find": "      beatsPerBar = pick.beats;\n      beatType = pick.beatType;",
     "replace": "      beatsPerBar = 2;\n      beatType = 4;",
     "expect": "REGRESSION", "metrics": ["struct.time_sig.exact"]},
    {"id": "MUT-PHASE",
     "find": "      if (beatType === 4) origin = (pick.phase || 0) * Q;",
     "replace": "      if (beatType === 4) origin = ((pick.phase || 0) + 1) * Q;",
     "expect": "REGRESSION", "metrics": ["notation.onset_pos.accuracy", "struct.downbeat.f1"]},
    {"id": "MUT-NOOP",
     "find": "  const api = {",
     "replace": "  /* noop mutation */\n  const api = {",
     "expect": "PASS", "metrics": []},
]

MUT_DIR = os.path.join(runner.CACHE_DIR, "mutations")


class AnchorMissing(Exception):
    code = "MUTATION_ANCHOR_MISSING"


def apply_mutation(source: str, mut: Dict[str, Any]) -> str:
    n = source.count(mut["find"])
    if n != 1:
        raise AnchorMissing(f"{mut['id']}: anchor found {n} times (must be exactly once). audio-score.js changed; "
                            "update the anchor in tests/bench/pppbench/mutation.py")
    return source.replace(mut["find"], mut["replace"])


def write_mutant(mut: Dict[str, Any], sut: str) -> str:
    with open(sut, "rb") as handle:
        source = util.normalise_eol(handle.read()).decode("utf-8")
    text = apply_mutation(source, mut)
    path = os.path.join(MUT_DIR, mut["id"] + ".js")
    os.makedirs(MUT_DIR, exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as handle:
        handle.write(text)
    return path


def run_mutation_check(mutations=None, suite_name: str = "mutation") -> int:
    suite = suite_mod.load_suite(suite_name)
    gate = suite.get("gate") or {}
    sut = stages.default_audio_score()
    mutations = mutations or MUTATIONS
    try:
        paths = {m["id"]: write_mutant(m, sut) for m in mutations}
    except AnchorMissing as exc:
        print(f"ERROR {AnchorMissing.code}: {exc}")
        return 2
    out_root = os.path.join(runner.OUT_DIR, "mutation")
    orig = runner.run_suite(suite, audio_score=sut, out_dir=os.path.join(out_root, "original"), write_cases=False, quiet=True)
    base = compare.baseline_from_results(orig["results"], orig["run"], reason="mutation-check original")
    orig_sha = util.sha256_file(os.path.join(orig["out"], "results.json"))
    rows, ok_all = [], True
    for m in mutations:
        r = runner.run_suite(suite, audio_score=paths[m["id"]], out_dir=os.path.join(out_root, m["id"]),
                             write_cases=False, quiet=True)
        v = compare.compare(r["results"], base, gate)
        sha = util.sha256_file(os.path.join(r["out"], "results.json"))
        hit = [x for x in m["metrics"] if x in v.failed_metrics]
        if m["expect"] == "PASS":
            passed = v.status == "PASS" and sha == orig_sha
        else:
            passed = v.status == "REGRESSION" and bool(hit)
        ok_all &= passed
        moved = {k: (d["baseline"], d["value"]) for k, d in v.deltas.items() if abs(d["delta"]) > 1e-9}
        rows.append({"id": m["id"], "expect": m["expect"], "status": v.status, "exit": v.exit_code, "ok": passed,
                     "expected_metrics": m["metrics"], "failed_metrics": v.failed_metrics,
                     "identical_results": sha == orig_sha, "moved": moved})
        print(f"{m['id']:10} expect {m['expect']:10} got {v.status:10} exit {v.exit_code} "
              f"{'OK ' if passed else 'BAD'} failed={','.join(v.failed_metrics) or '-'}"
              + (f" identical_results={sha == orig_sha}" if m["expect"] == "PASS" else ""))
        for k in m["metrics"]:
            if k in moved:
                print(f"{'':12}{k}: {moved[k][0]:.4f} -> {moved[k][1]:.4f}")
    util.dump_json({"schema": "ppp.bench-mutation/1", "suite": suite_name,
                    "original_results_sha256": orig_sha, "mutations": rows}, os.path.join(out_root, "mutation-report.json"))
    print(f"mutation-check: {'PASS' if ok_all else 'FAIL'} — every harmful mutation caught, the no-op identical"
          if ok_all else "mutation-check: FAIL — see above")
    return 0 if ok_all else 1
