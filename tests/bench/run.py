#!/usr/bin/env python3
"""PPP score-quality benchmark CLI (docs/GOALS/G00_QUALITY_FOUNDATION.md, tests/bench/README.md).

    python tests/bench/run.py list
    python tests/bench/run.py lint-corpus [--init]
    python tests/bench/run.py select-core
    python tests/bench/run.py run   --suite smoke|core|full|mutation [--audio-score PATH] [--filter S] [--reveal-holdout]
    python tests/bench/run.py run   --suite-file PATH           # private suite, outputs beside it
    python tests/bench/run.py check --suite core                # exit 0 PASS, 1 REGRESSION, 2 ERROR
    python tests/bench/run.py update-baseline --suite core --reason "..."
    python tests/bench/run.py relock --suite core --reason "..."
    python tests/bench/run.py golden [--init | --bless --reason "..."]
    python tests/bench/run.py mutation-check
    python tests/bench/run.py ab --suite core --a git:HEAD --b worktree
    python tests/bench/run.py legacy --manifest PATH
    python tests/bench/run.py conformance [--require-env]
    python tests/bench/run.py omr-live [--require-env]
    python tests/bench/run.py record-replay [--require-env]
"""

from __future__ import annotations

import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from pppbench import util  # noqa: E402

util.setup_stdio()


def cmd_list(args) -> int:
    from pppbench import corpus, suite as suite_mod, compare
    refs = corpus.load_corpus()
    by_set = {}
    for r in refs:
        by_set.setdefault(r.set, []).append(r)
    print(f"corpus: {len(refs)} references ({sum(r.holdout for r in refs)} hold-out) — {os.path.relpath(corpus.REFERENCES, util.repo_root())}")
    for s in corpus.SETS:
        if s in by_set:
            print(f"  {corpus.SET_LABELS[s]:34} {len(by_set[s]):4}")
    print("suites:")
    for name in suite_mod.list_suites():
        try:
            s = suite_mod.load_suite(name)
            info = suite_mod.describe(s, refs)
        except Exception as exc:  # a broken suite file is still listed
            info = f"unreadable: {exc}"
        base = "baseline" if os.path.exists(compare.baseline_path(name)) else "no baseline"
        print(f"  {name:16} {info} · {base}")
    return 0


def cmd_lint(args) -> int:
    from pppbench import corpus
    if args.init:
        sys.path.insert(0, os.path.join(util.bench_root(), "tools"))
        import make_micro
        micro = {p.id: make_micro.expectations(p, extra) for p, extra in make_micro.build()}
        from pppbench.registry_notes import MANUAL_EXPECT, NOTES
        refs, excluded = corpus.init_registry(micro, MANUAL_EXPECT, NOTES)
        corpus.write_registry(refs, excluded)
        print(f"wrote {len(refs)} references and {len(excluded)} exclusions")
    refs = corpus.load_corpus()
    issues = corpus.lint(refs)
    for i in issues:
        print(i)
    errors = [i for i in issues if i.level == "error"]
    excluded = util.load_json(corpus.EXCLUDED)["excluded"]
    print(f"lint: {len(refs)} references, {len(errors)} errors, {len(issues) - len(errors)} warnings, "
          f"{len(excluded)} excluded ({sum(1 for x in excluded if x['rule'] == 'L5')} octave-shift)")
    return 1 if errors else 0


def cmd_select(args) -> int:
    from pppbench import suite as suite_mod
    suite_mod.select_and_write()
    return 0


def cmd_run(args) -> int:
    from pppbench import runner
    return runner.cli_run(args)


def cmd_check(args) -> int:
    from pppbench import compare
    return compare.cli_check(args)


def cmd_update(args) -> int:
    from pppbench import compare
    return compare.cli_update_baseline(args)


def cmd_relock(args) -> int:
    from pppbench import suite as suite_mod
    return suite_mod.cli_relock(args)


def cmd_golden(args) -> int:
    from pppbench import golden
    return golden.run_golden(init=args.init, bless=args.bless, reason=args.reason, audio_score=args.audio_score)


def cmd_mutation(args) -> int:
    from pppbench import mutation
    return mutation.run_mutation_check()


def cmd_ab(args) -> int:
    from pppbench import runner
    return runner.cli_ab(args)


def cmd_legacy(args) -> int:
    from pppbench import legacy
    return legacy.cli_legacy(args)


def cmd_env_tier(name):
    def run(args) -> int:
        from pppbench import tiers
        return tiers.run_tier(name, args)
    return run


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="run.py", description="PPP score-quality benchmark")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("list").set_defaults(fn=cmd_list)
    p = sub.add_parser("lint-corpus")
    p.add_argument("--init", action="store_true", help="rebuild references.json/excluded.json from committed files")
    p.set_defaults(fn=cmd_lint)
    sub.add_parser("select-core").set_defaults(fn=cmd_select)
    p = sub.add_parser("run")
    g = p.add_mutually_exclusive_group(required=True)
    g.add_argument("--suite")
    g.add_argument("--suite-file")
    p.add_argument("--audio-score")
    p.add_argument("--jobs", type=int, default=1)
    p.add_argument("--filter")
    p.add_argument("--reveal-holdout", action="store_true")
    p.add_argument("--out")
    p.set_defaults(fn=cmd_run)
    p = sub.add_parser("check")
    g = p.add_mutually_exclusive_group(required=True)
    g.add_argument("--suite")
    g.add_argument("--suite-file")
    p.set_defaults(fn=cmd_check)
    p = sub.add_parser("update-baseline")
    g = p.add_mutually_exclusive_group(required=True)
    g.add_argument("--suite")
    g.add_argument("--suite-file")
    p.add_argument("--reason", required=True)
    p.set_defaults(fn=cmd_update)
    p = sub.add_parser("relock")
    p.add_argument("--suite", required=True)
    p.add_argument("--reason", required=True)
    p.set_defaults(fn=cmd_relock)
    p = sub.add_parser("golden")
    p.add_argument("--init", action="store_true")
    p.add_argument("--bless", action="store_true")
    p.add_argument("--reason")
    p.add_argument("--audio-score")
    p.set_defaults(fn=cmd_golden)
    sub.add_parser("mutation-check").set_defaults(fn=cmd_mutation)
    p = sub.add_parser("ab")
    p.add_argument("--suite", required=True)
    p.add_argument("--a", default="git:HEAD")
    p.add_argument("--b", default="worktree")
    p.set_defaults(fn=cmd_ab)
    p = sub.add_parser("legacy")
    p.add_argument("--manifest", required=True)
    p.add_argument("--out")
    p.set_defaults(fn=cmd_legacy)
    for tier in ("conformance", "omr-live", "record-replay"):
        p = sub.add_parser(tier)
        p.add_argument("--require-env", action="store_true")
        p.add_argument("--base-url", default="http://localhost:8777")
        p.set_defaults(fn=cmd_env_tier(tier))
    args = ap.parse_args(argv)
    return args.fn(args)


if __name__ == "__main__":
    sys.exit(main())
