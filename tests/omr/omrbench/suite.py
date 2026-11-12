"""omr-live-2: `python tests/bench/run.py omr-live-2 <command>` (docs/GOALS/G12_OMR.md section 10; G12-0).

    cases [--check | --write]      the 60 excerpts (tests/omr/cases.json) against the corpus registry
    flags-data [--cases S] [--tiers T]   (G12-3) the bars of a recorded engine run with omr/flags.js' signals and whether each is wrong (tests/omr/out/flags/)
    render [--cases S] [--tiers T] the page images (cached; tests/omr/out/render/)
    run    [--cases S] [--tiers T] [--mode engine|app] ...   render, read, judge; writes tests/omr/out/<mode>/results.json
           [--engine homr|oemer|smt [--engine-python P]]      (G12-6) a learned engine in its own environment instead of Audiveris: out/engine-<name>/
    check  [--results P] [--baseline P]                       a run against the committed baseline (exit 1 on a regression)
    baseline --reason R [--results P]                         record a results file as the baseline (tests/omr/baselines/)
    bakeoff [--half tune|held] [--engines E] [--record P]     (G12-6) every engine's recorded reads side by side, raw and normalised; gate A7
    determinism [--cases S]        render twice, the second time in reverse order, and compare every byte
    fetch-real ...                 the real-scan tier's page images (tests/omr/omrbench/fetch_real.py; never run by the gate)

    --cases   all | tune | held | s1 | s1-app | id,id,...  (an id, a case name, or tag:<name>)
    --tiers   clean-A,clean-B,scan150-A,scan150-B,scan200-A,scan200-B,photo-A,photo-B,brace-less (default: all nine); scan and photo are also reported merged (A + B);
              real-scan (G12-6: the fetched public-domain scans; all+real = the nine and it)

It is a LOCAL tool: it needs Audiveris 5.11, Java (Audiveris brings its own), Verovio, NumPy, OpenCV and puppeteer (tests/omr/README.md).
Where one is missing it prints ``SKIPPED: <reason>`` and exits 0 (2 with --require-env); the CI gate never runs it, only the unit tests of its
pure parts (tests/bench/unit/test_omr2_*.py).
"""

from __future__ import annotations

import argparse
import datetime
import hashlib
import json
import os
import subprocess
import sys
import tempfile
from collections import OrderedDict
from typing import Any, Dict, List, Optional, Tuple

from . import BENCH, BENCH_VERSION, baseline as bl, cases as casesmod, degrade, engine, engines as learned, envinfo, metrics, realscan, render, xmlscore

ENGINE_NAMES = tuple(learned.names())
HERE = envinfo.HERE
OUT = os.path.join(HERE, "out")
BASELINE_DIR = os.path.join(HERE, "baselines")
PAGE_TIERS = ("clean-A", "clean-B", "scan150-A", "scan150-B", "scan200-A", "scan200-B", "photo-A", "photo-B")
TIERS = PAGE_TIERS + ("brace-less",)
EXTRA_TIERS = ("real-scan",)        # G12-6: public-domain scans (tests/omr/real-scan.json, fetched by fetch-real); only when asked for
MODES = ("engine", "app", "app-nohelper")
MERGED = {"scan": ("scan150-A", "scan150-B", "scan200-A", "scan200-B"), "photo": ("photo-A", "photo-B")}


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
    """``all`` = the nine tiers of G12-0; ``all+real`` adds the real-scan tier (G12-6); or a list."""
    if text in ("all", "", None):
        return list(TIERS)
    if text == "all+real":
        return list(TIERS + EXTRA_TIERS)
    tiers = [t.strip() for t in text.split(",")]
    for t in tiers:
        if t not in TIERS + EXTRA_TIERS:
            raise SystemExit(f"--tiers: {t!r} is not one of {', '.join(TIERS + EXTRA_TIERS)}")
    return tiers


def rel(path: str) -> str:
    """A path as the repository sees it; one on another drive (an --out on C: for a tree on D:) is shown whole."""
    try:
        return os.path.relpath(path, envinfo.REPO)
    except ValueError:
        return path


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
                    data = h.read()
                # Audiveris writes .mxl (zip); a learned engine of the bake-off writes plain MusicXML (G12-6)
                text = xmlscore.mxl_text(data) if data[:2] == b"PK" else data.decode("utf-8-sig")
                docs.append(xmlscore.parse_score(text, divisions))
            except (OSError, xmlscore.ScoreError, ValueError, KeyError, UnicodeDecodeError):
                continue
    return xmlscore.join(docs) if docs else None


NORMALIZE_CLI = os.path.join(envinfo.REPO, "tests", "omr", "node", "normalize-cli.js")


def normalize_units(units: Dict[str, List[List[str]]]) -> Dict[str, Dict[str, Any]]:
    """omr/normalize.js (G12-1) on the files Audiveris wrote: {key: [the .mxl files of each page]} -> {key: {ok, xml, report, pages}}.
    One Node process for all of them. This is what the app does under PPP.omr = 'v2' before it reads a scan, run on the engine's files alone."""
    with tempfile.TemporaryDirectory(prefix="omr-normalize-") as tmp:
        jobs, out = os.path.join(tmp, "jobs.json"), os.path.join(tmp, "answers.json")
        with open(jobs, "w", encoding="utf-8") as h:
            json.dump([{"key": k, "pages": v} for k, v in units.items()], h)
        r = subprocess.run([envinfo.node_binary(), NORMALIZE_CLI, "--jobs", jobs, "--out", out], capture_output=True, env=envinfo.node_env(), timeout=3600)
        if r.returncode != 0:
            raise SystemExit("normalize-cli failed: " + r.stderr.decode("utf-8", "replace")[-400:])
        with open(out, encoding="utf-8") as h:
            return json.load(h)


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


def engine_out_dir(args) -> str:
    """out/engine for Audiveris (as since G12-0), out/engine-<name> for a learned engine of the bake-off (G12-6)."""
    name = getattr(args, "engine", "audiveris") or "audiveris"
    return os.path.join(args.out or OUT, ("engine" if name == "audiveris" else f"engine-{name}") + render.SUFFIX)


def run_engine(args) -> int:
    if (getattr(args, "engine", "audiveris") or "audiveris") != "audiveris":
        return run_learned(args)
    doc = casesmod.load()
    sel = select_cases(doc, args.cases or "all")
    tiers = parse_tiers(args.tiers)
    page_tiers = [t for t in tiers if t in PAGE_TIERS]
    engravers = sorted({tier_parts(t)[1] for t in page_tiers})
    problem = env_problem(True, "A" in engravers) if page_tiers else (None if envinfo.audiveris_path(args.audiveris) else "Audiveris is not installed")
    if problem:
        return skip(problem, args.require_env)
    real, problem = real_selection(args, tiers)
    if problem:
        return skip(problem, args.require_env)
    exe = envinfo.audiveris_path(args.audiveris)
    eng = dict(envinfo.audiveris_version(exe) or {"version": "?", "jar_sha256": None}, name="audiveris", options=engine.engine_options())
    out_dir = os.path.join(args.out or OUT, "engine" + render.SUFFIX)
    variants = sorted({tier_parts(t)[0] for t in page_tiers})
    print(f"omr-live-2 engine: {len(sel)} cases x {len(tiers)} tiers, Audiveris {eng['version']} ({exe})")
    report = render.render_cases(sel, engravers=engravers, variants=tuple(variants), force=args.force) if page_tiers else {}
    jobs, order, inputs = page_jobs(doc, sel, tiers, report, out_dir, real)
    print(f"engine: {len(jobs)} pages")
    eng["options"] = engine.engine_options(args.step_timeout)
    recs = engine.run_pages(exe, jobs, eng, workers=args.jobs, force=args.force, timeout=args.timeout, step_timeout=args.step_timeout)
    results = score_engine(doc, sel, tiers, order, inputs, recs, eng, args, real)
    os.makedirs(out_dir, exist_ok=True)
    with open(os.path.join(out_dir, "results.json"), "w", encoding="utf-8", newline="\n") as h:
        h.write(bl.dumps(results))
    with open(os.path.join(out_dir, "summary.txt"), "w", encoding="utf-8", newline="\n") as h:
        h.write(bl.table(results) + "\n")
    print(bl.table(results))
    if results["timeouts"]:
        print(f"WARNING: {len(results['timeouts'])} pages timed out and count as unread; run the same command again (finished pages are kept)")
    print(f"wrote {rel(os.path.join(out_dir, 'results.json'))}")
    if args.check:
        return do_check(results, args.baseline or baseline_path("engine", eng["version"]))
    return 0


def real_selection(args, tiers):
    """(the real-scan cases of the --cases selector, a reason to skip) when the real-scan tier is asked for (G12-6)."""
    if realscan.TIER not in tiers:
        return [], None
    real = realscan.select(realscan.cases(), args.cases or "all")
    gone = realscan.missing_images(real)
    if gone:
        return real, (f"the real-scan pages are not here ({len(gone)} missing, e.g. {rel(gone[0])}): "
                      "python tests/bench/run.py omr-live-2 fetch-real --fetch --allow-network")
    return real, None


def tier_units(doc, sel, tier, real=None):
    """(case, truth) of every case of a tier: the fixtures (brace-less), the real-scan cases, or the excerpts."""
    if tier == "brace-less":
        return [(dict(f, tags=["brace-less"]), fixture_truth()) for f in doc.get("fixtures", []) if f["engine"]]
    if tier == realscan.TIER:
        paths = realscan._registry_paths()
        return [(c, realscan.truth(c, paths=paths)) for c in real or []]
    return [(c, truth_score(c)) for c in sel]


def page_jobs(doc, sel, tiers, report, out_dir, real=None):
    """The page images of the selection as engine jobs [{key, image, out}], the keys of each (case, tier) in page order, and the
    sha256 of each (case, tier)'s page set. Shared by Audiveris and the learned engines: the same pages, the same keys.
    ``real``: the real-scan cases of the selection (G12-6), when the real-scan tier is asked for."""
    jobs, order, inputs = [], {}, {}
    for tier in tiers:
        if tier == realscan.TIER:
            for c in real or []:
                for k, image in enumerate(c["images"], 1):
                    key = f"{c['case']}|{tier}|p{k}"
                    jobs.append({"key": key, "image": image, "out": os.path.join(out_dir, c["case"], f"{tier}-p{k}")})
                    order.setdefault((c["case"], tier), []).append(key)
                inputs[(c["case"], tier)] = hashlib.sha256("|".join(render.sha256_file(p) for p in c["images"]).encode()).hexdigest()
            continue
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
    return jobs, order, inputs


def run_learned(args) -> int:
    """A learned engine of the bake-off (G12-6) on the same pages: its runner in its own environment (omrbench/engines.py), then the
    same scoring as Audiveris. A selection that holds held-out cases prints no numbers: those are judged once, by `bakeoff --half held`."""
    from . import engines
    name = args.engine
    doc = casesmod.load()
    sel = select_cases(doc, args.cases or "all")
    tiers = parse_tiers(args.tiers)
    page_tiers = [t for t in tiers if t in PAGE_TIERS]
    engravers = sorted({tier_parts(t)[1] for t in page_tiers})
    python = engines.python_for(name, args.engine_python)
    if python is None:
        return skip(f"{name}: no Python environment for it (set {engines.ENGINES[name]['env']} or --engine-python; tests/omr/README.md, 'The bake-off')",
                    args.require_env)
    problem = env_problem(False, "A" in engravers) if page_tiers else None
    if problem:
        return skip(problem, args.require_env)
    real, problem = real_selection(args, tiers)
    if problem:
        return skip(problem, args.require_env)
    out_dir = engine_out_dir(args)
    variants = sorted({tier_parts(t)[0] for t in page_tiers})
    inf = engines.info(name, python)
    if inf.get("error"):
        print(f"ERROR ENGINE: {name} --info failed: {inf['error']}")
        return 2
    eng = engines.describe(name, inf)
    print(f"omr-live-2 engine: {len(sel)} cases x {len(tiers)} tiers, {name} {eng['version']} ({python})")
    report = render.render_cases(sel, engravers=engravers, variants=tuple(variants), force=args.force) if page_tiers else {}
    jobs, order, inputs = page_jobs(doc, sel, tiers, report, out_dir, real)
    print(f"engine: {len(jobs)} pages")
    run = engines.run_pages(name, python, jobs, force=args.force, timeout=args.timeout)
    eng["run"] = {"gpu": run["gpu"], "restarts": run["restarts"], "wall_s": run["wall_s"]}
    results = score_engine(doc, sel, tiers, order, inputs, run["records"], eng, args, real)
    results["pages_records"] = {k: {x: r.get(x) for x in ("ms", "rc", "timed_out", "crashed", "error", "cold", "peak_rss_mb", "gpu_peak_mb")}
                                for k, r in sorted(run["records"].items())}
    os.makedirs(out_dir, exist_ok=True)
    with open(os.path.join(out_dir, "results.json"), "w", encoding="utf-8", newline="\n") as h:
        h.write(bl.dumps(results))
    held = sum(1 for c in list(sel) + list(real or []) if c["split"] == "held")
    if held:
        print(f"{held} held-out cases in the selection: no numbers are printed (they are judged once, by `bakeoff --half held`)")
    else:
        with open(os.path.join(out_dir, "summary.txt"), "w", encoding="utf-8", newline="\n") as h:
            h.write(bl.table(results) + "\n")
        print(bl.table(results))
    bad = sum(1 for r in run["records"].values() if r["rc"] != 0)
    print(f"{bad} of {len(jobs)} pages gave no MusicXML; wrote {rel(os.path.join(out_dir, 'results.json'))}")
    return 0


def score_engine(doc, sel, tiers, order, inputs, recs, eng, args, real=None) -> Dict[str, Any]:
    results: Dict[str, Any] = {"schema": bl.RESULTS_SCHEMA, "bench": BENCH, "bench_version": BENCH_VERSION, "mode": "engine", "engine": eng,
                               "created": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"), "git": git_info(),
                               "versions": render.tool_versions(), "cases_sha256": cases_digest(), "movements": args.movements,
                               "divisions": args.divisions, "degrade": degrade.describe(), "tiers": OrderedDict(), "inputs_sha256": {}}
    norm: Dict[str, Dict[str, Any]] = {}
    if getattr(args, "normalize", False):
        results["normalize"] = True          # a diagnostic run: omr/normalize.js on the engine's files (G12-1); never a baseline
        units: Dict[str, List[List[str]]] = {}
        for tier in tiers:
            for c, _ in tier_units(doc, sel, tier, real):
                units[f"{c['case']}|{tier}"] = [recs[k].get("mxl") or [] for k in order[(c["case"], tier)]]
        norm = normalize_units(units)
    scored: Dict[str, List[Tuple[Dict[str, Any], metrics.CaseResult]]] = {}
    pages_of: Dict[str, int] = {}
    ms_of: Dict[str, float] = {}
    for tier in tiers:
        units = tier_units(doc, sel, tier, real)
        rows, extra, pages, ms = [], [], 0, 0.0
        for c, truth in units:
            rs = [recs[k] for k in order[(c["case"], tier)]]
            if norm:
                ans = norm.get(f"{c['case']}|{tier}") or {}
                r = metrics.judge(truth, xmlscore.parse_score(ans["xml"]) if ans.get("ok") else None)
            else:
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
        print(f"ERROR NO_BASELINE: {rel(base_path)} does not exist (run `baseline --reason ...` first)")
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
    page_cases = {c for t, blk in results["tiers"].items() if t in PAGE_TIERS for c in blk.get("cases", {})}
    if args.mode == "engine" and page_cases != want_cases:
        print(f"ERROR PARTIAL_RUN: a baseline is recorded from a run of every case (run without --cases); got {len(page_cases)} of {len(want_cases)}")
        return 2
    if results.get("cases_sha256") != cases_digest():
        print("ERROR STALE_RESULTS: tests/omr/cases.json changed since this run")
        return 2
    if (results.get("versions") or {}).get("raster") != "cpu":
        print("ERROR RASTER: a baseline is recorded from the CPU raster (byte-stable); OMR_CHROME_GPU=1 pages are for reproducing section 1 only")
        return 2
    if results.get("normalize"):
        print("ERROR DIAGNOSTIC_RUN: a run with --normalize reads the engine's files through omr/normalize.js; a baseline is the engine alone")
        return 2
    if results.get("timeouts"):
        print(f"ERROR TIMEOUTS: {len(results['timeouts'])} pages timed out (the PC was busy?); run again, finished pages are kept: {results['timeouts'][:3]}")
        return 2
    out = args.baseline or baseline_path(args.mode, results["engine"].get("version", "5.11.0"))
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, "w", encoding="utf-8", newline="\n") as h:
        h.write(bl.dumps(bl.to_baseline(results, args.reason)))
    print(f"recorded {rel(out)}")
    return 0


# ---------------------------------------------------------------------------------------- render / determinism / cases
def cmd_render(args) -> int:
    doc = casesmod.load()
    sel = select_cases(doc, args.cases or "all")
    tiers = [t for t in parse_tiers(args.tiers) if t in PAGE_TIERS]
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


# ---------------------------------------------------------------------------------------- flags (G12-3)
def cmd_flags_data(args) -> int:
    """The per-bar dataset of omr/flags.js on a RECORDED engine run (nothing is rendered or recognised again): tune.jsonl, held.jsonl, truth.jsonl."""
    from . import flagdata
    doc = casesmod.load()
    sel = select_cases(doc, args.cases or "all")
    tiers = [t for t in parse_tiers(args.tiers) if t in PAGE_TIERS]
    base = args.out or OUT
    engine_root = os.path.join(base, "engine" + render.SUFFIX)
    if not os.path.isdir(engine_root):
        print(f"ERROR NO_ENGINE_RUN: {rel(engine_root)} does not exist (run `omr-live-2 run` first, or copy a recorded run there)")
        return 2
    render_root = os.path.join(base, "render" + render.SUFFIX)
    rows, skipped = flagdata.build(sel, tiers, engine_root, render_root)
    truth = flagdata.truth_rows(doc["cases"], render_root)
    out_dir = os.path.join(base, "flags")
    counts = flagdata.write_dataset(out_dir, rows, truth)
    print(f"flags-data: {len(rows)} bars from {len(sel)} cases x {len(tiers)} tiers ({skipped}); {counts}; wrote {rel(out_dir)}")
    return 0


# ---------------------------------------------------------------------------------------- the bake-off (G12-6)
def _load_records(name: str, jobs: List[Dict[str, str]]) -> Tuple[Dict[str, Dict[str, Any]], List[str]]:
    """The recorded page reads of an engine for these jobs; a page with no record, or a record of another image, is missing."""
    recs, missing = {}, []
    for j in jobs:
        path = os.path.join(j["out"], "engine.json")
        try:
            with open(path, encoding="utf-8") as h:
                raw = json.load(h)
        except (OSError, ValueError):
            missing.append(j["key"])
            continue
        sha = raw.get("image_sha256")
        if sha and sha != render.sha256_file(j["image"]):
            missing.append(j["key"])
            continue
        if name == "audiveris":
            raw.setdefault("mxl", [])
            recs[j["key"]] = raw
        else:
            recs[j["key"]] = learned.to_record(raw, cached=True)
    return recs, missing


def cmd_bakeoff(args) -> int:
    from . import bakeoff as bk
    doc = casesmod.load()
    half = args.half
    out_root = args.out or OUT
    if half == "held" and args.cases:
        print("REFUSED: the held-out half is judged whole, never a part of it (G0 rules: its cases are not looked at one by one)")
        return 2
    if half == "held":
        prev = bk.held_already(out_root)
        if prev and not args.again:
            print(f"REFUSED: the held-out half was judged on {prev['runs'][0]['at']} ({bk.marker_path(out_root)}); it is judged once "
                  "(--again REASON to judge it again; the reason is recorded)")
            return 2
    names = [n.strip() for n in args.engines.split(",") if n.strip()]
    if names[:1] != ["audiveris"]:
        names = ["audiveris"] + [n for n in names if n != "audiveris"]
    tiers = parse_tiers(args.tiers or "all+real")
    sel = [c for c in select_cases(doc, args.cases or "all") if c["split"] == half]
    real = [c for c in realscan.select(realscan.cases(), args.cases or "all") if c["split"] == half] if realscan.TIER in tiers else []
    page_tiers = [t for t in tiers if t in PAGE_TIERS]
    engravers = sorted({tier_parts(t)[1] for t in page_tiers})
    variants = sorted({tier_parts(t)[0] for t in page_tiers})
    report = render.render_cases(sel, engravers=engravers, variants=tuple(variants), log=lambda *x: None) if page_tiers else {}
    paths = {"raw": argparse.Namespace(normalize=False, divisions="as-read", movements="all"),
             "normalised": argparse.Namespace(normalize=True, divisions="as-read", movements="all")}
    out: Dict[str, Any] = {"schema": "ppp.omr-bakeoff/1", "bench": BENCH, "half": half, "tiers": tiers, "git": git_info(),
                           "cases_sha256": cases_digest(), "created": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
                           "cases": len(sel), "real_scan_cases": len(real), "engines": {}}
    for name in names:
        jobs, order, inputs = page_jobs(doc, sel, tiers, report, engine_out_dir(argparse.Namespace(out=args.out, engine=name)), real)
        recs, missing = _load_records(name, jobs)
        if missing:
            print(f"ERROR NO_READS: {name} has no read of {len(missing)} of {len(jobs)} pages of the {half} half (e.g. {missing[0]}); "
                  f"run: python tests/bench/run.py omr-live-2 run --engine {name} --cases {half} --tiers {','.join(tiers)}")
            return 2
        eng = {"name": name}
        blocks = {}
        for pname, ns in paths.items():
            res = score_engine(doc, sel, tiers, order, inputs, recs, eng, ns, real)
            blocks[pname] = {t: {k: v for k, v in blk["subsets"].get(half, blk["subsets"].get("all", {})).items() if k != "structures"}
                             for t, blk in res["tiers"].items()}
        ms = [r["ms"] for r in recs.values()]
        cold = [r["ms"] for r in recs.values() if r.get("cold")]
        out["engines"][name] = {
            "pages": len(recs), "no_musicxml": sum(1 for r in recs.values() if r.get("rc") not in (0, None) or not r.get("mxl")),
            "timed_out": sum(1 for r in recs.values() if r.get("timed_out")), "crashed": sum(1 for r in recs.values() if r.get("crashed")),
            "timing": bk.timing(ms), "cold_s": [round(x / 1000, 1) for x in cold][:5],
            "peak_rss_mb": max([r.get("peak_rss_mb") or 0 for r in recs.values()] or [0]) or None,
            "gpu_peak_mb": max([r.get("gpu_peak_mb") or 0 for r in recs.values()] or [0]) or None,
            "tiers": blocks}
    for pname in paths:
        print(f"\n{half} half, {pname} path: omr.bar_exact (exact / truth bars), pooled")
        print(bk.format_table({n: e["tiers"][pname] for n, e in out["engines"].items()}))
        print(f"{half} half, {pname} path: omr.note_f1 (mean over cases)")
        print(bk.format_table({n: e["tiers"][pname] for n, e in out["engines"].items()}, metric="omr.note_f1"))
    print("\nengine      pages  no MusicXML  timed out  crashed   s/page median   p90    max   peak RSS MB")
    for n, e in out["engines"].items():
        t = e["timing"]
        print(f"{n:10} {e['pages']:6d} {e['no_musicxml']:12d} {e['timed_out']:10d} {e['crashed']:8d}   {t['median_s']!s:>13} {t['p90_s']!s:>6} {t['max_s']!s:>6}"
              f"   {e['peak_rss_mb']!s:>10}")
    verdicts = {}
    ref = out["engines"]["audiveris"]["tiers"]["normalised"]
    for n in names[1:]:
        e = out["engines"][n]
        verdicts[n] = bk.verdict(n, e["tiers"]["normalised"], ref, e["timing"]["p90_s"])
    out["verdicts"] = verdicts
    label = "GATE A7 (held-out half, normalised path)" if half == "held" else "NOT THE GATE: the tuning half (A7 is judged on the held-out half)"
    print(f"\n{label}")
    for n, v in verdicts.items():
        print(f"  {n}: {'PASS' if v['pass'] else 'FAIL'} -> {v['decision']}")
        for c in v["clauses"]:
            nums = "" if "delta" not in c else f"  ({c['engine']} vs {c['audiveris']}, delta {c['delta']})"
            if "delta" not in c and c.get("engine") is not None:
                nums = f"  ({c['engine']} s)"
            print(f"    {'ok  ' if c['pass'] else 'FAIL'} {c['clause']}{nums}")
    if half == "held":
        bk.mark_held(out_root, {"engines": names, "tiers": tiers, "again": args.again, "git": out["git"]})
    if args.record:
        os.makedirs(os.path.dirname(os.path.abspath(args.record)), exist_ok=True)
        prev = {}
        if os.path.isfile(args.record):
            with open(args.record, encoding="utf-8") as h:
                prev = json.load(h)
        prev.setdefault("schema", "ppp.omr-bakeoff-record/1")
        prev[half] = out
        with open(args.record, "w", encoding="utf-8", newline="\n") as h:
            h.write(json.dumps(prev, indent=1, sort_keys=True, ensure_ascii=False) + "\n")
        print(f"recorded the {half} half in {rel(args.record)}")
    return 0


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
    p.add_argument("--engine", choices=("audiveris",) + tuple(sorted(ENGINE_NAMES)), default="audiveris",
                   help="(engine mode, G12-6) the engine: Audiveris, or a learned engine of the bake-off run in its own environment; results in <out>/engine-<name>")
    p.add_argument("--engine-python", default=None, help="(G12-6) the Python of the learned engine's environment (default: its PPP_OMR_<NAME>_PYTHON)")
    p.add_argument("--timeout", type=int, default=engine.TIMEOUT_S, help="seconds Audiveris may take for one page (default %(default)s)")
    p.add_argument("--step-timeout", type=int, default=engine.STEP_TIMEOUT_S, dest="step_timeout",
                   help="seconds Audiveris may take for one step of a sheet (its own default is 120; default %(default)s)")
    p.add_argument("--out")
    p.add_argument("--check", action="store_true", help="then check against the committed baseline")
    p.add_argument("--baseline")
    p.add_argument("--divisions", choices=("as-read", "repair"), default="as-read", help="how a <divisions> of 0 is read (default: as the app reads it)")
    p.add_argument("--movements", choices=("all", "last"), default="all", help="every movement file of a page, or one per page as the helper keeps it")
    p.add_argument("--normalize", action="store_true", help="(engine mode, diagnostic) read each case's files through omr/normalize.js (G12-1), as the app does under PPP.omr = 'v2'; never a baseline")
    p.add_argument("--omr", choices=("legacy", "v2"), default=None, help="(app mode) the page's PPP.omr for the run (default: the page's own, legacy); results go to <out>/app-v2 for v2")
    p.add_argument("--base-url", default=None, help="(app mode) an app server already running; default: one started here on a free port")
    p.add_argument("--replay", action="store_true", help="(app mode, G12-2) no helper and no engine: the page is told what Audiveris wrote earlier (<out>/engine, from an engine-alone run), so any tree's page can be compared on the same engine output; results go to <out>/app[-v2]-replay")
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
    p = sub.add_parser("flags-data", help="(G12-3) the bars of a recorded engine run, their omr/flags.js signals and whether each is wrong")
    p.add_argument("--cases", default=None)
    p.add_argument("--tiers", default=None)
    p.add_argument("--out", default=None)
    p.set_defaults(fn=cmd_flags_data)
    p = sub.add_parser("bakeoff", help="(G12-6) every engine's recorded reads, scored side by side, raw and normalised; gate A7 on the held-out half")
    p.add_argument("--half", choices=("tune", "held"), default="tune")
    p.add_argument("--cases", default=None, help="a part of the half (default: all of it); the gate is judged on the whole held-out half only")
    p.add_argument("--engines", default="audiveris," + ",".join(sorted(ENGINE_NAMES)))
    p.add_argument("--tiers", default=None, help="default: all+real (the nine tiers and the real-scan tier)")
    p.add_argument("--out", default=None)
    p.add_argument("--again", default=None, metavar="REASON", help="judge the held-out half again (the reason is recorded)")
    p.add_argument("--record", default=None, help="write the numbers (aggregates only) to this JSON file (tests/omr/bakeoff/g12-6.json)")
    p.set_defaults(fn=cmd_bakeoff)
    p = sub.add_parser("fetch-real", help="the real-scan tier's page images (never run by the gate)")
    p.add_argument("rest", nargs=argparse.REMAINDER)
    p.set_defaults(fn=lambda a: __import__("omrbench.fetch_real", fromlist=["main"]).main(a.rest))
    return ap


def run_app(args) -> int:
    from . import appmode
    return appmode.run(args)


def main(argv: Optional[List[str]] = None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    if argv[:1] == ["fetch-real"]:          # its options are its own: argparse's REMAINDER does not take a first argument that starts with --
        from . import fetch_real
        return fetch_real.main(argv[1:])
    args = build_parser().parse_args(argv)
    return args.fn(args)


if __name__ == "__main__":
    sys.exit(main())
