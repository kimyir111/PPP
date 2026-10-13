"""omr-live-2 flags (G12-3): the bars of a recorded engine run, their signals and whether each is wrong.

``python tests/bench/run.py omr-live-2 flags-data`` reads what Audiveris wrote (``tests/omr/out/engine/``, recorded by ``run``; nothing is
rendered or recognised again), puts each case through ``tests/omr/node/flags-cli.js`` (omr/normalize.js, the ScoreGraph importer,
omr/flags.js) and judges the same normalised document against the truth with ``metrics.judge``. The result is one row per output bar:

    {tier, case, split, bar, wrong, cause, raw: {the bar's feature object}, n: {the normaliser's flags for the bar}, doc: {...}}

written to ``tests/omr/out/flags/tune.jsonl`` and ``held.jsonl`` **separately**: the fit tool (tests/omr/node/flags-fit.js) reads only the tuning
half; the held-out half is read by its one evaluation (G12 section 8.2: weights are fitted on the tuning half and judged on the other).
``truth.jsonl`` holds the same features for the truth files themselves (fed back as if they had been recognised): the false-positive census.

Standard library only apart from what the other omrbench modules use; the Node side is the only place omr/flags.js is run.
"""

from __future__ import annotations

import glob
import json
import os
import re
import subprocess
import tempfile
from collections import Counter
from typing import Any, Dict, List, Optional, Tuple

from . import envinfo, metrics, xmlscore

FLAGS_CLI = os.path.join(envinfo.REPO, "tests", "omr", "node", "flags-cli.js")
PAGE_TIERS = ("clean-A", "clean-B", "scan150-A", "scan150-B", "scan200-A", "scan200-B", "photo-A", "photo-B")
TIER_GROUPS = {"clean": ("clean-A", "clean-B"), "scan": ("scan150-A", "scan150-B", "scan200-A", "scan200-B"), "photo": ("photo-A", "photo-B")}


def group_of(tier: str) -> str:
    for g, ts in TIER_GROUPS.items():
        if tier in ts:
            return g
    return tier


def page_files(engine_root: str, case: str, tier: str) -> List[List[str]]:
    """The .mxl files of each page of a case in a tier, as the engine run recorded them (a page = its movements, in order)."""
    dirs = glob.glob(os.path.join(engine_root, case, f"{tier}-p*"))

    def num(d: str) -> int:
        m = re.search(r"-p(\d+)$", d)
        return int(m.group(1)) if m else 0

    def mvt(p: str) -> int:
        m = re.search(r"\.mvt(\d+)\.mxl$", p)
        return int(m.group(1)) if m else 0

    return [sorted(glob.glob(os.path.join(d, "**", "*.mxl"), recursive=True), key=lambda p: (mvt(p), p)) for d in sorted(dirs, key=num)]


def run_cli(jobs: List[Dict[str, Any]], raw: bool = False, params: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    with tempfile.TemporaryDirectory(prefix="omr-flags-") as tmp:
        jf, of = os.path.join(tmp, "jobs.json"), os.path.join(tmp, "answers.json")
        with open(jf, "w", encoding="utf-8") as h:
            json.dump(jobs, h)
        cmd = [envinfo.node_binary(), FLAGS_CLI, "--jobs", jf, "--out", of] + (["--raw"] if raw else [])
        if params is not None:
            pf = os.path.join(tmp, "params.json")
            with open(pf, "w", encoding="utf-8") as h:
                json.dump(params, h)
            cmd += ["--params", pf]
        r = subprocess.run(cmd, capture_output=True, env=envinfo.node_env(), timeout=7200)
        if r.returncode != 0:
            raise SystemExit("flags-cli failed: " + r.stderr.decode("utf-8", "replace")[-600:])
        with open(of, encoding="utf-8") as h:
            return json.load(h)


def truth_path(case: str, render_root: str) -> str:
    return os.path.join(render_root, case, "truth.musicxml")


def truth_of(case: str, render_root: str) -> xmlscore.Score:
    with open(truth_path(case, render_root), encoding="utf-8") as h:
        return xmlscore.parse_score(h.read())


def cause_of(tb: Optional[xmlscore.Bar], ob: xmlscore.Bar) -> str:
    """Why a wrong output bar is wrong, against the truth bar it aligned to (a diagnostic of the fit report; never an input of a flag)."""
    if tb is None:
        return "unaligned"
    tn = [n for n in tb.notes if not n.rest]
    on = [n for n in ob.notes if not n.rest]
    tp, op = Counter(n.midi for n in tn), Counter(n.midi for n in on)
    to, oo = Counter(n.on for n in tn), Counter(n.on for n in on)
    if len(on) < len(tn):
        return "missing"
    if len(on) > len(tn):
        return "extra"
    if tp != op and to == oo:
        return "pitch"
    if tp == op and to != oo:
        return "onset"
    if metrics.keyset(tb) == metrics.keyset(ob) and metrics.keyset(tb, True) != metrics.keyset(ob, True):
        return "dur"
    if metrics.keyset(tb, True) == metrics.keyset(ob, True):
        return "rest"
    return "mixed"


def build(cases: List[Dict[str, Any]], tiers: List[str], engine_root: str, render_root: str, params: Optional[Dict[str, Any]] = None,
          raw: bool = True) -> Tuple[List[Dict[str, Any]], Dict[str, int]]:
    """The per-bar rows of every (case, tier) the engine run has, and counts of what could not be used."""
    jobs, meta = [], {}
    for tier in tiers:
        for c in cases:
            files = page_files(engine_root, c["case"], tier)
            if not files:
                continue
            key = f"{c['case']}|{tier}"
            jobs.append({"key": key, "pages": files})
            meta[key] = (c, tier)
    answers = run_cli(jobs, raw=raw, params=params)
    rows: List[Dict[str, Any]] = []
    skipped = {"unreadable": 0, "import-refused": 0, "bar-mismatch": 0}
    for key, ans in answers.items():
        c, tier = meta[key]
        if not ans.get("ok") or not ans.get("xml"):
            skipped["unreadable"] += 1
            continue
        if not ans.get("importOk"):
            skipped["import-refused"] += 1
            continue
        truth = truth_of(c["case"], render_root)
        out = xmlscore.parse_score(ans["xml"])
        res = metrics.judge(truth, out)
        if len(out.bars) != ans.get("bars"):
            skipped["bar-mismatch"] += 1
            continue
        pairs = {j: i for i, j, s in metrics.align(truth.bars, out.bars) if s >= metrics.ALIGN_MIN}
        wrong = set(res.wrong_bars)
        feats = ans.get("raw") or []
        nflags = (ans.get("normalize") or {}).get("flags") or {}
        for j in range(len(out.bars)):
            rows.append({"case": c["case"], "tier": tier, "split": c["split"], "bar": j + 1, "wrong": j in wrong,
                         "cause": cause_of(truth.bars[pairs[j]] if j in pairs else None, out.bars[j]) if j in wrong else None,
                         "raw": feats[j] if j < len(feats) else None, "n": nflags.get(str(j + 1), []), "doc": ans.get("doc")})
    return rows, skipped


def truth_rows(cases: List[Dict[str, Any]], render_root: str, params: Optional[Dict[str, Any]] = None) -> List[Dict[str, Any]]:
    """The truth files fed back through the importer and omr/flags.js as if they had been recognised: every flag here is a false positive."""
    jobs = [{"key": f"{c['case']}|truth", "xml": truth_path(c["case"], render_root)} for c in cases if os.path.isfile(truth_path(c["case"], render_root))]
    answers = run_cli(jobs, raw=True, params=params)
    split = {c["case"]: c["split"] for c in cases}
    rows = []
    for key, ans in answers.items():
        case = key.split("|")[0]
        if not ans.get("importOk"):
            continue
        feats = ans.get("raw") or []
        for j, f in enumerate(feats):
            rows.append({"case": case, "tier": "truth", "split": split[case], "bar": j + 1, "wrong": False, "cause": None, "raw": f, "n": [], "doc": ans.get("doc")})
    return rows


def write_jsonl(path: str, rows: List[Dict[str, Any]]) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as h:
        for r in rows:
            h.write(json.dumps(r, sort_keys=True) + "\n")


def write_dataset(out_dir: str, rows: List[Dict[str, Any]], truth: List[Dict[str, Any]]) -> Dict[str, int]:
    """tune.jsonl, held.jsonl and truth.jsonl (the truth rows of the held-out cases go to held-truth.jsonl, which only the evaluation reads)."""
    write_jsonl(os.path.join(out_dir, "tune.jsonl"), [r for r in rows if r["split"] == "tune"])
    write_jsonl(os.path.join(out_dir, "held.jsonl"), [r for r in rows if r["split"] == "held"])
    write_jsonl(os.path.join(out_dir, "truth.jsonl"), [r for r in truth if r["split"] == "tune"])
    write_jsonl(os.path.join(out_dir, "held-truth.jsonl"), [r for r in truth if r["split"] == "held"])
    return {"tune": sum(1 for r in rows if r["split"] == "tune"), "held": sum(1 for r in rows if r["split"] == "held"),
            "truth-tune": sum(1 for r in truth if r["split"] == "tune"), "truth-held": sum(1 for r in truth if r["split"] == "held")}
