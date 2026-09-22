"""Run a tests/golden_benchmark.py manifest and write the result in the G0 format (docs/GOALS/G00 §9.4).

The metrics come from ``golden_benchmark.run_case`` unchanged, so the numbers
match ``python tests/golden_benchmark.py <manifest>``. What changes is the
labelling: MusicXML-vs-MusicXML cases are measured in quarter beats, so their
tolerance and error are reported in quarter beats, not "ms" (§2 P6).
"""

from __future__ import annotations

import json
import os
import sys
from typing import Any, Dict, List

from . import util


def _import_legacy():
    tests_dir = os.path.join(util.repo_root(), "tests")
    if tests_dir not in sys.path:
        sys.path.insert(0, tests_dir)
    import golden_benchmark  # noqa: E402  (tests/golden_benchmark.py, unchanged)
    return golden_benchmark


def inside_repo(path: str) -> bool:
    root = os.path.abspath(util.repo_root())
    return os.path.abspath(path).startswith(root + os.sep)


def run_manifest(manifest_path: str) -> Dict[str, Any]:
    gb = _import_legacy()
    manifest = util.load_json(manifest_path)
    root = os.path.dirname(os.path.abspath(manifest_path))
    cases = manifest.get("cases", []) if isinstance(manifest, dict) else manifest
    out: List[Dict[str, Any]] = []
    for case in cases:
        name = case.get("name") or case.get("reference")
        try:
            r = gb.run_case(case, root)
        except Exception as exc:  # a broken private case is reported, not hidden
            out.append({"name": name, "status": "error", "error": str(exc)})
            continue
        m = dict(r["metrics"])
        timebase = r.get("referenceTimebase")
        ref_ext = os.path.splitext(case["reference"])[1].lower()
        pred_ext = os.path.splitext(case["prediction"])[1].lower()
        score_pair = ref_ext in (".xml", ".musicxml", ".mxl") and pred_ext in (".xml", ".musicxml", ".mxl")
        unit = "quarter-beats" if score_pair else "seconds"
        if score_pair:
            m["onset_tolerance_quarter"] = m.pop("onset_tolerance_ms") / 1000
            err = m.pop("mean_onset_error_ms")
            m["mean_onset_error_quarter"] = err / 1000 if err is not None else None
        row = {"name": r["name"], "status": "ok", "unit": unit, "timebase": timebase, "metrics": m}
        for k in ("referenceMeasures", "referenceTempo", "measureCountOk", "tempoOk"):
            if k in r:
                row[k] = r[k]
        out.append(row)
    return {"schema": "ppp.bench-legacy/1", "manifest": os.path.basename(manifest_path), "cases": out}


def cli_legacy(args) -> int:
    manifest = os.path.abspath(args.manifest)
    private = not inside_repo(manifest)
    out = args.out or (os.path.join(os.path.dirname(manifest), "out", "legacy-results.json") if private
                       else os.path.join(util.bench_root(), "out", "legacy", "legacy-results.json"))
    if private and inside_repo(out):
        print("ERROR PRIVATE_OUTPUT_IN_REPO: a manifest outside the repository keeps its results outside it too")
        return 2
    res = run_manifest(manifest)
    util.dump_json(res, out)
    print(json.dumps(res, ensure_ascii=False, indent=1))
    print(f"legacy results: {out}")
    return 1 if any(c["status"] == "error" for c in res["cases"]) else 0
