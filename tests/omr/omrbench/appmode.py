"""omr-live-2, app path: the same pages through the app's own Import.load (docs/GOALS/G12_OMR.md section 10, "two paths per case").

Engine alone says what Audiveris read; the app path says what PPP did with it: movements dropped, divisions of 0, the hand rule that
silences staves, PdfLayer's changes, the suspect-bar flags. E6-E9 of the design document were found by the difference of the two.

    --mode app           a helper (omr-service.js) on a free port with Audiveris, the app page served on a free port
    --mode app-nohelper  no helper: the browser draft reader (PdfLayer.notate), what the live site does today (E1)

Both start their own server(s) and stop them by PID. The page believes the helper is at http://127.0.0.1:8788; tests/bench/node/omr-live.js
sends those requests to the helper started here (or refuses them), so another session's helper is never used. A PDF is rasterised by the
page itself with pdf.js from a CDN: this mode needs the network.

The Score the app returns is judged as the PLAYED notes (hand other than x): ``omr.played_f1`` and every bar metric; ``omr.note_f1`` is the
same read with the silenced hands counted too, so a note the engine read and the app threw away shows as the difference of the two.
Flags are the app's own report (``omr.flag.app.*``).
"""

from __future__ import annotations

import datetime
import hashlib
import json
import os
import socket
import subprocess
import time
import urllib.request
from collections import OrderedDict
from fractions import Fraction as F
from typing import Any, Dict, List, Optional, Tuple

from . import BENCH, BENCH_VERSION, baseline as bl, cases as casesmod, degrade, envinfo, metrics, render, xmlscore

APP_TIERS = ("pdf-A", "photo-A", "scan150-A", "scan200-A", "pdf-B", "photo-B", "scan150-B", "scan200-B", "brace-less")
DEFAULT_TIERS = "pdf-A,photo-A,brace-less"


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def wait_http(url: str, seconds: float = 30.0) -> Optional[Dict[str, Any]]:
    t0 = time.time()
    while time.time() - t0 < seconds:
        try:
            with urllib.request.urlopen(url, timeout=2) as r:
                body = r.read().decode("utf-8", "replace")
                try:
                    return json.loads(body)
                except ValueError:
                    return {"ok": True}
        except Exception:
            time.sleep(0.3)
    return None


class Procs:
    """Processes this run started, stopped by PID."""

    def __init__(self):
        self.items: List[subprocess.Popen] = []

    def start(self, argv, env=None, cwd=None) -> subprocess.Popen:
        p = subprocess.Popen(argv, env=env, cwd=cwd, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        self.items.append(p)
        return p

    def stop(self) -> None:
        for p in reversed(self.items):
            if p.poll() is None:
                envinfo.terminate_tree(p.pid)
        self.items.clear()


# ---------------------------------------------------------------------------------------- projection -> Score
def projection_score(proj: Dict[str, Any], played_only: bool) -> xmlscore.Score:
    """The app's Score (tests/bench/node/omr-live.js projection) as bars of notes. Playing hands are r and l; x is silenced."""
    ms = proj["measures"]
    bars = []
    for m in ms:
        b = xmlscore.Bar()
        b.len = F(m["lenQ"]).limit_denominator(96) if m.get("lenQ") is not None else None
        bars.append(b)
    for n in proj["notes"]:
        if played_only and n.get("hand") == "x":
            continue
        i = n["m"]
        if i is None or not 0 <= i < len(bars):
            continue
        on = F(n["b"]).limit_denominator(96)
        dur = F(n["dur"]).limit_denominator(96)
        rest = bool(n.get("rest")) or n.get("midi") is None
        bars[i].notes.append(xmlscore.Note(None if rest else n["midi"], on, dur, int(n.get("staff") or 1) - 1, rest, False, 0))
        bars[i].end = max(bars[i].end, on + dur)
    first = ms[0] if ms else None
    time_sig = "%s/%s" % (first["time"][0], first["time"][1]) if first else None
    return xmlscore.Score(parts=[xmlscore.PartInfo(len(ms), int(proj.get("staves") or 1))], bars=bars,
                          key=first["fifths"] if first else 0, time=time_sig)


def judge_app(truth: xmlscore.Score, row: Dict[str, Any]) -> Tuple[metrics.CaseResult, Dict[str, Any]]:
    """(result, note) for one app-path row ({"ok", "projection", "report", ...} or a failure)."""
    if not row.get("ok"):
        r = metrics.judge(truth, None)
        return r, {"error": (row.get("error") or "")[:200], "code": row.get("code")}
    proj, rep = row["projection"], row["report"]
    played = projection_score(proj, True)
    everything = projection_score(proj, False)
    numbers = {str(m["number"]): i for i, m in enumerate(proj["measures"])}
    flagged = [numbers[str(x)] for x in rep.get("suspectMeasures", []) if str(x) in numbers]
    r = metrics.judge(truth, played, external_flags={"app": flagged}, rules={}, hand_rule=False)
    a = metrics.judge(truth, everything, rules={}, hand_rule=False)
    r.metrics["omr.played_f1"] = r.metrics["omr.note_f1"]
    r.metrics["omr.note_f1"] = a.metrics["omr.note_f1"]
    r.metrics["omr.confidence"] = rep.get("confidence")
    note = {"engine": row.get("engine"), "level": rep.get("level"), "confidence": rep.get("confidence"), "suspect": len(rep.get("suspectMeasures", [])),
            "staves": proj.get("staves"), "out_bars": len(proj["measures"]), "played": sum(1 for n in proj["notes"] if n.get("hand") != "x" and not n.get("rest")),
            "silenced": sum(1 for n in proj["notes"] if n.get("hand") == "x" and not n.get("rest")), "ms": row.get("ms")}
    return r, note


# ---------------------------------------------------------------------------------------- the run
def build_jobs(sel: List[Dict[str, Any]], tiers: List[str], doc: Dict[str, Any], skipped: List[str]) -> List[Dict[str, Any]]:
    jobs = []
    for tier in tiers:
        if tier == "brace-less":
            for f in doc.get("fixtures", []):
                jobs.append({"id": f"{f['case']}|{tier}", "case": f["case"], "tier": tier, "path": os.path.join(envinfo.REPO, f["path"]), "type": f["type"]})
            continue
        kind, e = tier.split("-")
        for c in sel:
            if kind == "pdf":
                path, typ = render.ensure_pdf(c, e), "application/pdf"
            else:
                pages = render.svg_pages(c, e)
                if len(pages) != 1:
                    skipped.append(f"{c['case']}|{tier} (a {len(pages)}-page excerpt: the app takes one image)")
                    continue
                path, typ = os.path.join(render.RENDER, c["case"], e, kind + "-p1.jpg"), "image/jpeg"
            jobs.append({"id": f"{c['case']}|{tier}", "case": c["case"], "tier": tier, "path": path, "type": typ})
    return jobs


def run(args) -> int:
    from . import suite
    nohelper = args.mode == "app-nohelper"
    doc = casesmod.load()
    selector = args.cases or "s1-app"
    sel = suite.select_cases(doc, selector) if selector not in ("fixtures",) else []
    tiers = [t.strip() for t in (args.tiers or DEFAULT_TIERS).split(",")]
    for t in tiers:
        if t not in APP_TIERS:
            raise SystemExit(f"--tiers: {t!r} is not one of {', '.join(APP_TIERS)}")
    problem = suite.env_problem(not nohelper, any(t.endswith("-A") for t in tiers))
    if problem:
        return suite.skip(problem, args.require_env)
    omr_mode = getattr(args, "omr", None)
    out_dir = os.path.join(args.out or suite.OUT, args.mode + render.SUFFIX + ("-" + omr_mode if omr_mode and omr_mode != "legacy" else ""))
    os.makedirs(out_dir, exist_ok=True)
    img_tiers = [t for t in tiers if t != "brace-less"]
    if img_tiers:
        render.render_cases(sel, engravers=sorted({t.split("-")[1] for t in img_tiers}), variants=degrade.DEGRADED, force=args.force)
    skipped: List[str] = []
    jobs = build_jobs(sel, tiers, doc, skipped)
    for s in skipped:
        print("  skipped:", s)
    procs = Procs()
    node = envinfo.node_binary()
    try:
        helper_port = 0
        health: Dict[str, Any] = {}
        if not nohelper:
            exe = envinfo.audiveris_path(args.audiveris)
            helper_port = free_port()
            procs.start([node, os.path.join(envinfo.REPO, "omr-service.js"), "--port", str(helper_port), "--audiveris", exe],
                        env=envinfo.node_env(), cwd=envinfo.REPO)
            health = wait_http(f"http://127.0.0.1:{helper_port}/health", 40) or {}
            if not (health.get("audiveris") or health.get("pdfToMusic")):
                print(f"ERROR HELPER: the helper on port {helper_port} did not report an engine: {health}")
                return 2
        base = args.base_url
        if not base:
            port = free_port()
            data_dir = os.path.join(out_dir, "app-data")
            os.makedirs(data_dir, exist_ok=True)
            env = envinfo.node_env()
            env.update({"NODE_ENV": "production", "HOST": "127.0.0.1", "PORT": str(port), "PPP_DATA_DIR": data_dir})
            procs.start([node, "server.js"], env=env, cwd=envinfo.REPO)
            if wait_http(f"http://127.0.0.1:{port}/health", 40) is None:
                print(f"ERROR SERVER: server.js did not answer /health on port {port}")
                return 2
            base = f"http://127.0.0.1:{port}"
        jobs_path = os.path.join(out_dir, "jobs.jsonl")
        rows_path = os.path.join(out_dir, "rows.jsonl")
        with open(jobs_path, "w", encoding="utf-8", newline="\n") as h:
            for j in jobs:
                h.write(json.dumps({"id": j["id"], "path": j["path"], "type": j["type"]}) + "\n")
        t0 = time.time()
        print(f"omr-live-2 {args.mode}: {len(jobs)} files through Import.load at {base}"
              + (f", helper on port {helper_port}" if not nohelper else ", no helper"))
        r = subprocess.run([node, os.path.join(envinfo.REPO, "tests", "bench", "node", "omr-live.js"), "--in", jobs_path, "--out", rows_path,
                            "--base", base, "--helper-port", str(helper_port)] + (["--omr", omr_mode] if omr_mode else []), capture_output=True, env=envinfo.node_env(), timeout=7200)
        if r.returncode != 0:
            msg = r.stderr.decode("utf-8", "replace").strip().splitlines()
            return suite.skip("the app page did not run OMR: " + (msg[-1] if msg else f"exit {r.returncode}"), args.require_env)
        elapsed = time.time() - t0
    finally:
        procs.stop()
    rows = {}
    with open(rows_path, encoding="utf-8") as h:
        for line in h:
            if line.strip():
                row = json.loads(line)
                rows[row["id"]] = row
    results = score_app(doc, sel, tiers, jobs, rows, args, health, elapsed)
    with open(os.path.join(out_dir, "results.json"), "w", encoding="utf-8", newline="\n") as h:
        h.write(bl.dumps(results))
    with open(os.path.join(out_dir, "summary.txt"), "w", encoding="utf-8", newline="\n") as h:
        h.write(bl.table(results) + "\n")
    print(bl.table(results))
    print(f"wrote {os.path.relpath(os.path.join(out_dir, 'results.json'), envinfo.REPO)}")
    if args.check:
        return suite.do_check(results, args.baseline or suite.baseline_path(args.mode, "5.11.0"))
    return 0


def truth_for(job: Dict[str, Any], doc: Dict[str, Any]) -> xmlscore.Score:
    from . import suite
    if job["tier"] == "brace-less":
        with open(os.path.join(envinfo.REPO, casesmod.FIXTURE_TRUTH), encoding="utf-8") as h:
            return xmlscore.parse_score(h.read())
    c = next(x for x in doc["cases"] if x["case"] == job["case"])
    return suite.truth_score(c)


def score_app(doc, sel, tiers, jobs, rows, args, health, elapsed) -> Dict[str, Any]:
    from . import suite
    by_case = {c["case"]: c for c in doc["cases"]}
    fixtures = {f["case"]: f for f in doc.get("fixtures", [])}
    results: Dict[str, Any] = OrderedDict(schema=bl.RESULTS_SCHEMA, bench=BENCH, bench_version=BENCH_VERSION, mode=args.mode)
    nohelper = args.mode == "app-nohelper"
    if nohelper:
        results["engine"] = {"name": "browser draft reader (PdfLayer.notate)", "version": "-", "helper": None}
    else:
        installed = envinfo.audiveris_version(envinfo.audiveris_path(args.audiveris)) or {"version": "?", "jar_sha256": None}
        results["engine"] = dict(installed, name="audiveris via the local helper", helper={k: health.get(k) for k in ("version", "audiveris", "pdfToMusic")})
    results.update(created=datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"), git=suite.git_info(),
                   versions=render.tool_versions(), cases_sha256=suite.cases_digest(), tiers=OrderedDict(), inputs_sha256={},
                   timing_s=round(elapsed, 1))
    if getattr(args, "omr", None):
        results["omr"] = args.omr           # PPP.omr of the page for this run (G12-1)
    for tier in tiers:
        scored, extra, notes = [], [], {}
        ms = 0.0
        for j in [j for j in jobs if j["tier"] == tier]:
            truth = truth_for(j, doc)
            r, note = judge_app(truth, rows.get(j["id"], {"ok": False, "error": "no row"}))
            c = by_case.get(j["case"]) or dict(fixtures[j["case"]], tags=["brace-less"])
            row = suite.case_row(c, r, note.get("ms") or 0, 1)
            row["note"] = note
            scored.append((c, r))
            extra.append((c, row))
            ms += note.get("ms") or 0
            results["inputs_sha256"][j["id"]] = hashlib.sha256(open(j["path"], "rb").read()).hexdigest()
        results["tiers"][tier] = suite.tier_block(scored, extra, len(scored), ms)
    return results
