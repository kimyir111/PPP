"""After `run.py ab --suite S --a git:<base> --b worktree`: are the two sides the same case by case?
(docs/GOALS/G01 A36)

    python tests/scoregraph/tools/ab_identical.py --suite core [--suite robust ...]

`ab` reads its verdict from aggregates and the gate's tolerances; this reads tests/bench/out/<suite>/ab-a and
ab-b/results.json and requires every case to be in both, with the same status and error code, the same
metrics and the same semantic projection of its score (predicted.semantic). Exit 0 when all are the same.
"""

from __future__ import annotations

import argparse
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "..", "bench"))

from pppbench import runner, suite as suite_mod, util  # noqa: E402

util.setup_stdio()
FIELDS = ("status", "error_code", "metrics")


def differences(a: dict, b: dict, limit: int = 10) -> list:
    ca = {c["id"]: c for c in a["cases"]}
    cb = {c["id"]: c for c in b["cases"]}
    out = [f"only in a: {k}" for k in sorted(set(ca) - set(cb))] + [f"only in b: {k}" for k in sorted(set(cb) - set(ca))]
    for cid in sorted(set(ca) & set(cb)):
        x, y = ca[cid], cb[cid]
        for f in FIELDS:
            if x.get(f) != y.get(f):
                keys = sorted(k for k in set(x[f] or {}) | set(y[f] or {}) if (x[f] or {}).get(k) != (y[f] or {}).get(k)) \
                    if isinstance(x.get(f), dict) and isinstance(y.get(f), dict) else []
                out.append(f"{cid}: {f} differs" + (f" ({', '.join(keys[:limit])})" if keys else f" ({x.get(f)!r} vs {y.get(f)!r})"))
        if (x.get("predicted") or {}).get("semantic") != (y.get("predicted") or {}).get("semantic"):
            out.append(f"{cid}: predicted.semantic differs")
    return out


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--suite", action="append", required=True)
    args = ap.parse_args(argv)
    bad = 0
    for name in args.suite:
        base = runner.out_dir_for(suite_mod.load_suite(name))
        a = util.load_json(os.path.join(base, "ab-a", "results.json"))
        b = util.load_json(os.path.join(base, "ab-b", "results.json"))
        diff = differences(a, b)
        print(f"{name}: {len(b['cases'])} cases, " + ("all the same (status, metrics, semantic projection)" if not diff
                                                     else f"{len(diff)} difference(s)"))
        for line in diff[:20]:
            print("    " + line)
        bad += bool(diff)
    return 0 if not bad else 1


if __name__ == "__main__":
    sys.exit(main())
