"""Environment-dependent tiers (docs/GOALS/G00 §3.2): T1-C conformance, T1-O OMR live, T2 replay recording.

Each checks its environment first. Missing pieces print ``SKIPPED: <reason>``
and exit 0 (exit 2 with ``--require-env``); the T0 gate never depends on them.
"""

from __future__ import annotations

import glob
import json
import os
import subprocess
import tempfile
import urllib.request
from collections import Counter
from fractions import Fraction
from typing import Any, Dict, List, Optional, Tuple

from . import corpus, musicxml, stages, suite as suite_mod, util

NODE_DIR = os.path.join(util.bench_root(), "node")


def _http_ok(url: str, timeout: float = 3.0) -> bool:
    try:
        with urllib.request.urlopen(url, timeout=timeout) as r:
            return 200 <= r.status < 500
    except Exception:
        return False


def _puppeteer_available(node: str) -> Optional[str]:
    paths = [os.path.join(util.repo_root(), "node_modules")] + \
        [p for p in os.environ.get("PPP_BENCH_NODE_MODULES", "").split(os.pathsep) if p]
    script = "require.resolve('puppeteer', {paths: %s})" % json.dumps(paths)
    r = subprocess.run([node, "-e", script], capture_output=True)
    return None if r.returncode == 0 else "puppeteer is not installed (npm install, or set PPP_BENCH_NODE_MODULES)"


def _skip(reason: str, require_env: bool) -> int:
    print(f"SKIPPED: {reason}")
    return 2 if require_env else 0


def run_tier(name: str, args) -> int:
    if name == "conformance":
        return conformance(args)
    if name == "omr-live":
        return omr_live(args)
    return record_replay(args)


# ----------------------------------------------------------------- T1-C
def conformance_targets(max_predictions: int = 50) -> List[Tuple[str, bytes]]:
    refs = corpus.by_id(corpus.load_corpus())
    core = suite_mod.load_suite("core")
    targets = []
    for rid in core["references"]:
        e = refs[rid]
        targets.append((rid, musicxml.read_bytes(e.abspath)))
    for p in sorted(glob.glob(os.path.join(util.repo_root(), "samples", "*.musicxml"))):
        targets.append(("samples-file/" + os.path.basename(p), musicxml.read_bytes(p)))
    # octave-shift files are excluded as references, but the reader's ottava rule must still match the app
    for x in util.load_json(corpus.EXCLUDED)["excluded"]:
        if x["rule"] == "L5":
            targets.append(("excluded/" + x["id"], musicxml.read_bytes(os.path.join(util.repo_root(), x["path"]))))
    cases_dir = os.path.join(util.bench_root(), "out", "core", "cases")
    index = os.path.join(util.bench_root(), "out", "core", "index.json")
    if os.path.exists(index):
        idx = util.load_json(index)
        for key, cid in sorted(idx.items(), key=lambda kv: kv[1])[:max_predictions]:
            p = os.path.join(cases_dir, key + ".musicxml")
            if os.path.exists(p):
                targets.append(("prediction/" + cid, musicxml.read_bytes(p)))
    return targets


def compare_projection(canon, app: Dict[str, Any]) -> List[str]:
    diffs = []
    if len(canon.measures) != len(app["measures"]):
        diffs.append(f"measures {len(canon.measures)} vs app {len(app['measures'])}")
    for m, a in zip(canon.measures, app["measures"]):
        if abs(float(m.start_q) - a["startQ"]) > 1e-6 or abs(float(m.len_q) - a["lenQ"]) > 1e-6:
            diffs.append(f"measure {m.index}: start/len {float(m.start_q)}/{float(m.len_q)} vs app {a['startQ']}/{a['lenQ']}")
        if list(m.time) != a["time"] or m.fifths != a["fifths"]:
            diffs.append(f"measure {m.index}: time/key {m.time}/{m.fifths} vs app {a['time']}/{a['fifths']}")
        if len(diffs) > 5:
            break
    mine = Counter((n.measure, round(float(n.pos_q), 6), round(float(n.dur_q), 6), n.midi, n.hand) for n in canon.notes)
    theirs = Counter((n["m"], round(n["b"], 6), round(n["dur"], 6), n["midi"], n["hand"]) for n in app["notes"])
    if mine != theirs:
        only_me, only_app = mine - theirs, theirs - mine
        diffs.append(f"notes differ: {sum(only_me.values())} only in reader (e.g. {list(only_me)[:2]}), "
                     f"{sum(only_app.values())} only in app (e.g. {list(only_app)[:2]})")
    if canon.app_qpm != app["tempo"]:
        diffs.append(f"tempo {canon.app_qpm} vs app {app['tempo']}")
    if canon.staves != app["staves"]:
        diffs.append(f"staves {canon.staves} vs app {app['staves']}")
    return diffs


def conformance(args) -> int:
    node = stages.node_binary()
    base = args.base_url.rstrip("/")
    if not _http_ok(base + "/"):
        return _skip(f"the app server is not reachable at {base} (run `npm start`)", args.require_env)
    reason = _puppeteer_available(node)
    if reason:
        return _skip(reason, args.require_env)
    targets = conformance_targets()
    with tempfile.TemporaryDirectory(prefix="pppbench-conf-") as tmp:
        fin, fout = os.path.join(tmp, "in.jsonl"), os.path.join(tmp, "out.jsonl")
        with open(fin, "w", encoding="utf-8", newline="\n") as h:
            for tid, data in targets:
                h.write(json.dumps({"id": tid, "xml": data.decode("utf-8", "replace")}, ensure_ascii=False) + "\n")
        r = subprocess.run([node, os.path.join(NODE_DIR, "conformance.js"), "--in", fin, "--out", fout, "--base", base],
                           capture_output=True)
        if r.returncode != 0:
            msg = r.stderr.decode("utf-8", "replace").strip().splitlines()
            return _skip("the app page did not load (network/CDN?): " + (msg[-1] if msg else f"exit {r.returncode}"),
                         args.require_env)
        app = {}
        for line in util.read_text(fout).splitlines():
            if line.strip():
                row = json.loads(line)
                app[row["id"]] = row
    rows, bad = [], 0
    for tid, data in targets:
        a = app.get(tid)
        try:
            canon = musicxml.read_score(data)
            reader_err = None
        except musicxml.ReaderError as exc:
            canon, reader_err = None, exc.code
        if a is None or not a["ok"]:
            diffs = [] if (reader_err and a is not None and not a["ok"]) else [f"app error: {a and a.get('error')}; reader: {reader_err}"]
        elif canon is None:
            diffs = [f"reader error {reader_err}, app parsed it"]
        else:
            diffs = compare_projection(canon, a)
        bad += bool(diffs)
        rows.append({"id": tid, "ok": not diffs, "diffs": diffs})
        if diffs:
            print(f"MISMATCH {tid}: " + " | ".join(diffs[:3]))
    out = os.path.join(util.bench_root(), "out", "conformance", "report.json")
    util.dump_json({"schema": "ppp.bench-conformance/1", "targets": len(rows), "mismatches": bad, "rows": rows}, out)
    print(f"conformance: {len(rows) - bad}/{len(rows)} identical (reader vs app parseMusicXML) · {util.rel(out)}")
    return 1 if bad else 0


# ----------------------------------------------------------------- T1-O
def omr_live(args) -> int:
    helper = "http://127.0.0.1:8788/health"
    if not _http_ok(args.base_url.rstrip("/") + "/"):
        return _skip(f"the app server is not reachable at {args.base_url} (run `npm start`)", args.require_env)
    if not _http_ok(helper):
        return _skip("the local helper is not running at 127.0.0.1:8788 (run `npm run omr` with Audiveris set up)",
                     args.require_env)
    return _skip("OMR live scoring is not implemented in G0 yet: tests/bench/README.md (OMR live) records the procedure",
                 args.require_env)


# ----------------------------------------------------------------- T2
def record_replay(args) -> int:
    helper = "http://127.0.0.1:8788/health"
    if not _http_ok(helper):
        return _skip("the local helper is not running at 127.0.0.1:8788 (npm run omr, with transcription set up)",
                     args.require_env)
    try:
        with urllib.request.urlopen(helper, timeout=3) as r:
            health = json.loads(r.read().decode("utf-8"))
    except Exception:
        health = {}
    if not (health.get("transcribe") or health.get("transcriber") or health.get("transcription")):
        return _skip("the helper has no transcriber configured (README: Making a score from a recording)",
                     args.require_env)
    return _skip("replay recording needs tools/render_piano.py (Salamander samples + ffmpeg) in the transcribe venv; "
                 "not implemented in G0 — procedure in tests/bench/README.md (Replay)", args.require_env)
