"""omr-live-2: `python tests/bench/run.py omr-live-2 <command>` (docs/GOALS/G12_OMR.md section 10; G12-0).

    cases [--check | --write]      the 60 excerpts (tests/omr/cases.json) against the corpus registry
    render [--cases S] [--tiers T] the page images (cached; tests/omr/out/render/)
    run    [--cases S] [--tiers T] [--mode engine|app] ...   render, read, judge; writes tests/omr/out/<mode>/results.json
    check  [--results P] [--baseline P]                       a run against the committed baseline (exit 1 on a regression)
    baseline --reason R [--results P]                         record a results file as the baseline (tests/omr/baselines/)
    determinism [--cases S]        render twice, the second time in reverse order, and compare every byte
    fetch-real ...                 the real-scan tier's page images (tests/omr/omrbench/fetch_real.py; never run by the gate)

    --cases   all | tune | held | s1 | s1-app | id,id,...  (an id, a case name, or tag:<name>)
    --tiers   clean-A,clean-B,scan-A,scan-B,photo-A,photo-B,brace-less (default: all seven); scan and photo are also reported merged (A + B)

It is a LOCAL tool: it needs Audiveris 5.11, Java (Audiveris brings its own), Verovio, NumPy, OpenCV and puppeteer (tests/omr/README.md).
Where one is missing it prints ``SKIPPED: <reason>`` and exits 0 (2 with --require-env); the CI gate never runs it, only the unit tests of its
pure parts (tests/bench/unit/test_omr2_*.py).
"""

from __future__ import annotations

import argparse
import datetime
import hashlib
import os
import subprocess
import sys
from collections import OrderedDict
from typing import Any, Dict, List, Optional, Tuple

from . import BENCH, BENCH_VERSION, baseline as bl, cases as casesmod, degrade, engine, envinfo, metrics, render, xmlscore

HERE = envinfo.HERE
OUT = os.path.join(HERE, "out")
BASELINE_DIR = os.path.join(HERE, "baselines")
PAGE_TIERS = ("clean-A", "clean-B", "scan-A", "scan-B", "photo-A", "photo-B")
TIERS = PAGE_TIERS + ("brace-less",)
MODES = ("engine", "app", "app-nohelper")
MERGED = {"scan": ("scan-A", "scan-B"), "photo": ("photo-A", "photo-B")}
VARIANT_OF = {"clean": "clean", "scan": "scan", "photo": "photo"}


def baseline_path(mode: str = "engine", engine_version: str = "5.11.0") -> str:
    name = {"engine": f"audiveris-{engine_version}.json", "app": f"audiveris-{engine_version}.app.json", "app-nohelper": "browser-draft.app.json"}[mode]
    return os.path.join(BASELINE_DIR, name)


def tier_parts(tier: str) -> Tuple[str, str]:
    """("clean", "A") of "clean-A"; the brace-less tier has no engraver."""
    if tier == "brace-less":
        return "fixture", "-"
    v, e = tier.split("-")
    return v, e


def select_cases(doc: Dict[str, Any], selector: str) -> List[Dict[str, Any]]:
    cs = doc["cases"]
    if selector in ("all", ""):
        return list(cs)
    if selector in ("tune", "held"):
        return [c for c in cs if c["split"] == selector]
    out: List[Dict[str, Any]] = []
    for tok in selector.split(","):
        tok = tok.strip()
        if tok in ("s1", "s1-app"):
            found = [c for c in cs if tok in c["tags"]]
        elif tok.startswith("tag:"):
            found = [c for c in cs if tok[4:] in c["tags"]]
        else:
            found = [c for c in cs if tok in (c["id"], c["case"])]
        if not found:
            raise SystemExit(f"--cases: nothing matches {tok!r}")
        for c in found:
            if c not in out:
                out.append(c)
    return out


def parse_tiers(text: str) -> List[str]:
    tiers = list(TIERS) if text in ("all", "", None) else [t.strip() for t in text.split(",")]
    for t in tiers:
        if t not in TIERS:
            raise SystemExit(f"--tiers: {t!r} is not one of {', '.join(TIERS)}")
    return tiers


def git_info() -> Dict[str, Any]:
    def run(*a):
        try:
            return subprocess.run(["git", *a], cwd=envinfo.REPO, capture_output=True, text=True, timeout=30).stdout.strip()
        except (OSError, subprocess.SubprocessError):
            return ""
    return {"sha": run("rev-parse", "HEAD") or None, "dirty": bool(run("status", "--porcelain", "--", "tests/omr", "engrave", "scoregraph"))}


def cases_digest() -> str:
    with open(casesmod.CASES, "rb") as h:
        return hashlib.sha256(h.read().replace(b"\r\n", b"\n")).hexdigest()


def env_problem(need_engine: bool, need_verovio: bool) -> Optional[str]:
    if not degrade.available():
        return "NumPy and OpenCV are not installed (pip install -r tests/omr/requirements.txt)"
    try:
        envinfo.node_binary()
    except RuntimeError as exc:
        return str(exc)
    if render.tool_versions().get("puppeteer") == "missing":
        return "puppeteer is not installed (npm install in the main worktree, or set PPP_BENCH_NODE_MODULES)"
    if need_verovio and render.tool_versions().get("verovio") == "missing":
        return "Verovio is not installed (pip install -r tests/omr/requirements.txt)"
    if need_engine and not envinfo.audiveris_path():
        return "Audiveris is not installed (set PPP_AUDIVERIS or --audiveris; tools/audiveris/Audiveris/Audiveris.exe)"
    return None


def skip(reason: str, require: bool) -> int:
    print(f"SKIPPED: {reason}")
    return 2 if require else 0


# ---------------------------------------------------------------------------------------- scoring
def read_pages(recs: List[Dict[str, Any]], divisions: str = "as-read", movements: str = "all") -> Optional[xmlscore.Score]:
    """The engine's pages of one case joined into one score (None when no page produced a file).
    ``movements``: ``all`` (every .mxl of a page, in order) or ``last`` (one per page, as the local helper keeps it today)."""
    docs = []
    for rec in recs:
        files = rec.get("mxl") or []
        if movements == "last" and files:
            files = files[-1:]
        for f in files:
            try:
                with open(f, "rb") as h:
                    docs.append(xmlscore.parse_score(xmlscore.mxl_text(h.read()), divisions))
            except (OSError, xmlscore.ScoreError, ValueError, KeyError):
                continue
    return xmlscore.join(docs) if docs else None


def truth_score(case: Dict[str, Any], root: str = render.RENDER) -> xmlscore.Score:
    with open(os.path.join(root, case["case"], "truth.musicxml"), encoding="utf-8") as h:
        return xmlscore.parse_score(h.read())


def aggregate_subsets(rows: List[Tuple[Dict[str, Any], metrics.CaseResult]]) -> Dict[str, Any]:
    subs = OrderedDict()
    pick = {"all": lambda c: True, "tune": lambda c: c["split"] == "tune", "held": lambda c: c["split"] == "held", "s1": lambda c: "s1" in c["tags"]}
    for name, f in pick.items():
        sel = [r for c, r in rows if f(c)]
        if sel:
            subs[name] = metrics.aggregate(sel)
    return subs


def case_row(case: Dict[str, Any], r: metrics.CaseResult, ms: float, pages: int) -> Dict[str, Any]:
    return {"split": case["split"], "tags": case["tags"], "bars": case["bars"], "metrics": {k: (round(v, 6) if v is not None else None) for k, v in sorted(r.metrics.items())},
            "counts": dict(sorted(r.counts.items())), "structure": r.structure, "ok": r.ok, "pages": pages, "ms": int(ms)}


def tier_block(rows: List[Tuple[Dict[str, Any], metrics.CaseResult]], extra: List[Tuple[Dict[str, Any], Dict[str, Any]]], pages: int, ms: float) -> Dict[str, Any]:
    return {"pages": pages, "ms_per_page": round(ms / pages / 1000, 2) if pages else None, "subsets": aggregate_subsets(rows),
            "cases": {c["case"]: row for c, row in extra}}


# ---------------------------------------------------------------------------------------- the engine-alone run
def fixture_truth() -> xmlscore.Score:
    with open(os.path.join(envinfo.REPO, casesmod.FIXTURE_TRUTH), encoding="utf-8") as h:
        return xmlscore.parse_score(h.read())


def run_engine(args) -> int:
    doc = casesmod.load()
    sel = select_cases(doc, args.cases or "all")
    tiers = parse_tiers(args.tiers)
    page_tiers = [t for t in tiers if t != "brace-less"]
    engravers = sorted({tier_parts(t)[1] for t in page_tiers})
    problem = env_problem(True, "A" in engravers) if page_tiers else (None if envinfo.audiveris_path(args.audiveris) else "Audiveris is not installed")
    if problem:
        return skip(problem, args.require_env)
    exe = envinfo.audiveris_path(args.audiveris)
    eng = dict(envinfo.audiveris_version(exe) or {"version": "?", "jar_sha256": None}, name="audiveris", options=engine.engine_options())
    out_dir = os.path.join(args.out or OUT, "engine" + render.SUFFIX)
    variants = sorted({tier_parts(t)[0] for t in page_tiers})
    print(f"omr-live-2 engine: {len(sel)} cases x {len(tiers)} tiers, Audiveris {eng['version']} ({exe})")
    report = render.render_cases(sel, engravers=engravers, variants=tuple(variants), force=args.force) if page_tiers else {}
    jobs, order, inputs = [], {}, {}
    for tier in tiers:
        if tier == "brace-less":
            for f in doc.get("fixtures", []):
                if f["engine"]:
                    key = f"{f['case']}|{tier}|p1"
                    jobs.append({"key": key, "image": os.path.join(envinfo.REPO, f["path"]), "out": os.path.join(out_dir, f["case"], f"{tier}-p1")})
                    order.setdefault((f["case"], tier), []).append(key)
                    inputs[(f["case"], tier)] = f["sha256"]
            continue
        v, e = tier_parts(tier)
        for c in sel:
            for entry in report[c["case"]][e]:
                key = f"{c['case']}|{tier}|p{entry['page']}"
                jobs.append({"key": key, "image": entry[v]["file"], "out": os.path.join(out_dir, c["case"], f"{tier}-p{entry['page']}")})
                order.setdefault((c["case"], tier), []).append(key)
            inputs[(c["case"], tier)] = hashlib.sha256("|".join(p[v]["sha256"] for p in report[c["case"]][e]).encode()).hexdigest()
    print(f"engine: {len(jobs)} pages")
    eng["options"] = engine.engine_options(args.step_timeout)
    recs = engine.run_pages(exe, jobs, eng, workers=args.jobs, force=args.force, timeout=args.timeout, step_timeout=args.step_timeout)
    results = score_engine(doc, sel, tiers, order, inputs, recs, eng, args)
    os.makedirs(out_dir, exist_ok=True)
    with open(os.path.join(out_dir, "results.json"), "w", encoding="utf-8", newline="\n") as h:
        h.write(bl.dumps(results))
    with open(os.path.join(out_dir, "summary.txt"), "w", encoding="utf-8", newline="\n") as h:
        h.write(bl.table(results) + "\n")
    print(bl.table(results))
    if results["timeouts"]:
        print(f"WARNING: {len(results['timeouts'])} pages timed out and count as unread; run the same command again (finished pages are kept)")
    print(f"wrote {os.path.relpath(os.path.join(out_dir, 'results.json'), envinfo.REPO)}")
    if args.check:
        return do_check(results, args.baseline or baseline_path("engine", eng["version"]))
    return 0


def score_engine(doc, sel, tiers, order, inputs, recs, eng, args) -> Dict[str, Any]:
    results: Dict[str, Any] = {"schema": bl.RESULTS_SCHEMA, "bench": BENCH, "bench_version": BENCH_VERSION, "mode": "engine", "engine": eng,
                               "created": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"), "git": git_info(),
                               "versions": render.tool_versions(), "cases_sha256": cases_digest(), "movements": args.movements,
                               "divisions": args.divisions, "degrade": degrade.describe(), "tiers": OrderedDict(), "inputs_sha256": {}}
    scored: Dict[str, List[Tuple[Dict[str, Any], metrics.CaseResult]]] = {}
    pages_of: Dict[str, int] = {}
    ms_of: Dict[str, float] = {}
    for tier in tiers:
        if tier == "brace-less":
            units = [(dict(f, tags=["brace-less"]), fixture_truth()) for f in doc.get("fixtures", []) if f["engine"]]
        else:
            units = [(c, truth_score(c)) for c in sel]
        rows, extra, pages, ms = [], [], 0, 0.0
        for c, truth in units:
            rs = [recs[k] for k in order[(c["case"], tier)]]
            r = metrics.judge(truth, read_pages(rs, args.divisions, args.movements))
            t_ms = sum(x["ms"] for x in rs)
            pages += len(rs)
            ms += t_ms
            row = case_row(c, r, t_ms, len(rs))
            row["engine_files"] = sum(len(x.get("mxl") or []) for x in rs)
            rows.append((c, r))
            extra.append((c, row))
            results["inputs_sha256"][f"{c['case']}|{tier}"] = inputs[(c["case"], tier)]
        results["tiers"][tier] = tier_block(rows, extra, pages, ms)
        scored[tier], pages_of[tier], ms_of[tier] = rows, pages, ms
    for name, parts in MERGED.items():
        if all(p in scored for p in parts):
            both = [x for p in parts for x in scored[p]]
            results["tiers"][name] = tier_block(both, [], sum(pages_of[p] for p in parts), sum(ms_of[p] for p in parts))
    results["timeouts"] = sorted(k for k, r in recs.items() if r.get("timed_out") or r.get("rc") == -9)
    return results


# ---------------------------------------------------------------------------------------- check / baseline
def do_check(results: Dict[str, Any], base_path: str) -> int:
    if not os.path.isfile(base_path):
        print(f"ERROR NO_BASELINE: {os.path.relpath(base_path, envinfo.REPO)} does not exist (run `baseline --reason ...` first)")
        return 2
    verdict = bl.check(results, bl.load(base_path))
    print(bl.format_check(verdict))
    return 1 if verdict["verdict"] == "REGRESSION" else 0


def cmd_check(args) -> int:
    path = args.results or os.path.join(OUT, args.mode + render.SUFFIX, "results.json")
    if not os.path.isfile(path):
        print(f"ERROR NO_RESULTS: {path} does not exist (run `omr-live-2 run` first)")
        return 2
    results = bl.load(path)
    return do_check(results, args.baseline or baseline_path(args.mode, results["engine"].get("version", "5.11.0")))


def cmd_baseline(args) -> int:
    path = args.results or os.path.join(OUT, args.mode + render.SUFFIX, "results.json")
    if not os.path.isfile(path):
        print(f"ERROR NO_RESULTS: {path} does not exist (run `omr-live-2 run` first)")
        return 2
    results = bl.load(path)
    if results.get("mode") != args.mode:
        print(f"ERROR WRONG_MODE: {path} is a {results.get('mode')} run, not {args.mode}")
        return 2
    doc = casesmod.load()
    if args.mode == "engine":
        want_tiers, want_cases = set(TIERS) | set(MERGED), {c["case"] for c in doc["cases"]}
    else:
        import omrbench.appmode as appmode
        want_tiers, want_cases = set(appmode.DEFAULT_TIERS.split(",")), {c["case"] for c in doc["cases"] if "s1-app" in c["tags"]}
    if not want_tiers <= set(results["tiers"]):
        print(f"ERROR PARTIAL_RUN: a baseline is recorded from a run of {', '.join(sorted(want_tiers))} (missing: {sorted(want_tiers - set(results['tiers']))})")
        return 2
    page_cases = {c for t, blk in results["tiers"].items() if t != "brace-less" for c in blk.get("cases", {})}
    if args.mode == "engine" and page_cases != want_cases:
        print(f"ERROR PARTIAL_RUN: a baseline is recorded from a run of every case (run without --cases); got {len(page_cases)} of {len(want_cases)}")
        return 2
    if results.get("cases_sha256") != cases_digest():
        print("ERROR STALE_RESULTS: tests/omr/cases.json changed since this run")
        return 2
    if (results.get("versions") or {}).get("raster") != "cpu":
        print("ERROR RASTER: a baseline is recorded from the CPU raster (byte-stable); OMR_CHROME_GPU=1 pages are for reproducing section 1 only")
        return 2
    if results.get("timeouts"):
        print(f"ERROR TIMEOUTS: {len(results['timeouts'])} pages timed out (the PC was busy?); run again, finished pages are kept: {results['timeouts'][:3]}")
        return 2
    out = args.baseline or baseline_path(args.mode, results["engine"].get("version", "5.11.0"))
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, "w", encoding="utf-8", newline="\n") as h:
        h.write(bl.dumps(bl.to_baseline(results, args.reason)))
    print(f"recorded {os.path.relpath(out, envinfo.REPO)}")
    return 0


# ---------------------------------------------------------------------------------------- render / determinism / cases
def cmd_render(args) -> int:
    doc = casesmod.load()
    sel = select_cases(doc, args.cases or "all")
    tiers = [t for t in parse_tiers(args.tiers) if t != "brace-less"]
    engravers = sorted({tier_parts(t)[1] for t in tiers})
    problem = env_problem(False, "A" in engravers)
    if problem:
        return skip(problem, args.require_env)
    report = render.render_cases(sel, engravers=engravers, force=args.force)
    pages = sum(len(p) for c in report.values() for p in c.values())
    print(f"rendered {len(sel)} cases, {pages} pages under {os.path.relpath(render.RENDER, envinfo.REPO)}")
    return 0


def tree_hashes(root: str) -> Dict[str, str]:
    out = {}
    for d, _, files in os.walk(root):
        for f in files:
            if f.endswith((".key", ".json")):
                continue
            p = os.path.join(d, f)
            out[os.path.relpath(p, root).replace(os.sep, "/")] = render.sha256_file(p)
    return out


def cmd_determinism(args) -> int:
    """The pages must not change between runs or with the order: render three times (in order, reversed, rotated) into scratch roots and
    compare every byte of every file (A0: "3 runs, reversed order")."""
    import tempfile
    doc = casesmod.load()
    sel = select_cases(doc, args.cases or "s1")
    problem = env_problem(False, True)
    if problem:
        return skip(problem, args.require_env)
    orders = [list(sel), list(reversed(sel)), sel[len(sel) // 2:] + sel[:len(sel) // 2]]
    hashes = []
    with tempfile.TemporaryDirectory(prefix="omr-det-") as tmp:
        for k, order in enumerate(orders[:args.runs]):
            root = os.path.join(tmp, f"run{k}")
            render.render_cases(order, root=root, log=lambda *x: None)
            hashes.append(tree_hashes(root))
    first = hashes[0]
    bad = sorted({k for h in hashes[1:] for k in set(first) | set(h) if first.get(k) != h.get(k)})
    if bad:
        print(f"NOT DETERMINISTIC: {len(bad)} of {len(first)} files differ, e.g. {bad[:5]}")
        return 1
    print(f"deterministic: {len(first)} files byte-identical in {len(hashes)} renders (in order, reversed, rotated) of {len(sel)} cases")
    return 0


def cmd_cases(args) -> int:
    return casesmod.main(["--check"] if args.check else ["--write"] if args.write else [])


# ---------------------------------------------------------------------------------------- CLI
def build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(prog="run.py omr-live-2", description="omr-live-2: the OMR benchmark (G12-0)")
    sub = ap.add_subparsers(dest="cmd", required=True)

    def common(p, tiers=True):
        p.add_argument("--cases", default=None, help="default: all (engine mode), s1-app (app modes)")
        if tiers:
            p.add_argument("--tiers", default=None, help="default: all seven (engine mode); pdf-A,photo-A,brace-less (app modes)")
        p.add_argument("--force", action="store_true", help="redo pages and engine runs even when their inputs are unchanged")
        p.add_argument("--require-env", action="store_true", help="exit 2, not 0, when a tool is missing")

    p = sub.add_parser("run", help="render, read and judge")
    common(p)
    p.add_argument("--mode", choices=MODES, default="engine")
    p.add_argument("--jobs", type=int, default=1, help="Audiveris processes at a time (engine mode)")
    p.add_argument("--audiveris")
    p.add_argument("--timeout", type=int, default=engine.TIMEOUT_S, help="seconds Audiveris may take for one page (default %(default)s)")
    p.add_argument("--step-timeout", type=int, default=engine.STEP_TIMEOUT_S, dest="step_timeout",
                   help="seconds Audiveris may take for one step of a sheet (its own default is 120; default %(default)s)")
    p.add_argument("--out")
    p.add_argument("--check", action="store_true", help="then check against the committed baseline")
    p.add_argument("--baseline")
    p.add_argument("--divisions", choices=("as-read", "repair"), default="as-read", help="how a <divisions> of 0 is read (default: as the app reads it)")
    p.add_argument("--movements", choices=("all", "last"), default="all", help="every movement file of a page, or one per page as the helper keeps it")
    p.add_argument("--base-url", default=None, help="(app mode) an app server already running; default: one started here on a free port")
    p.set_defaults(fn=lambda a: run_engine(a) if a.mode == "engine" else run_app(a))
    p = sub.add_parser("check", help="compare a results file with the committed baseline")
    p.add_argument("--results")
    p.add_argument("--baseline")
    p.add_argument("--mode", choices=MODES, default="engine")
    p.set_defaults(fn=cmd_check)
    p = sub.add_parser("baseline", help="record a results file as the committed baseline")
    p.add_argument("--results")
    p.add_argument("--baseline")
    p.add_argument("--mode", choices=MODES, default="engine")
    p.add_argument("--reason", required=True)
    p.set_defaults(fn=cmd_baseline)
    p = sub.add_parser("render", help="make the page images")
    common(p)
    p.set_defaults(fn=cmd_render)
    p = sub.add_parser("determinism", help="render twice (second time reversed) and compare bytes")
    p.add_argument("--cases", default="s1")
    p.add_argument("--runs", type=int, default=3, choices=(2, 3))
    p.add_argument("--require-env", action="store_true")
    p.set_defaults(fn=cmd_determinism)
    p = sub.add_parser("cases", help="the case list against the corpus registry")
    p.add_argument("--check", action="store_true")
    p.add_argument("--write", action="store_true")
    p.set_defaults(fn=cmd_cases)
    p = sub.add_parser("fetch-real", help="the real-scan tier's page images (never run by the gate)")
    p.add_argument("rest", nargs=argparse.REMAINDER)
    p.set_defaults(fn=lambda a: __import__("omrbench.fetch_real", fromlist=["main"]).main(a.rest))
    return ap


def run_app(args) -> int:
    from . import appmode
    return appmode.run(args)


def main(argv: Optional[List[str]] = None) -> int:
    args = build_parser().parse_args(argv)
    return args.fn(args)


if __name__ == "__main__":
    sys.exit(main())
