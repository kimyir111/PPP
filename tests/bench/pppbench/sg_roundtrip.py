"""Corpus round trip through ScoreGraph (docs/GOALS/G01 §16.2, A17, A32-A34).

Every committed MusicXML under catalog/, samples/, tests/bench/corpus/ and tests/fixtures/ goes
MusicXML -> ScoreGraph -> MusicXML -> ScoreGraph (tests/bench/node/sg-roundtrip.js). A file passes when

* L1  the app sees the same music: ``semantic.classify`` of the G0 projections of the original and the
      round-tripped MusicXML (app-parity reader, reader/4) is None;
* L1+ it prints the same notation: ``notation_inventory`` of both is equal;
* L2  the graph is a fixed point: the graph imported from the original and the one imported from its
      export serialize to the same JSON (``provenance.sources[].input`` aside);
* A17 the graph's play order (``time.unroll``) is the app's (``canonical.app_play_order``) bar for bar.

Files in ``tests/scoregraph/roundtrip-allowlist.json`` (at most three, each with a reason and a fixture
that reproduces its difference) may fail; the command checks the fixture still fails the same way.
"""

from __future__ import annotations

import json
import os
import subprocess
import tempfile
import time
from typing import Any, Dict, List

from . import musicxml, notation_inventory, semantic, stages, util

ROOTS = ("catalog/", "samples/", "tests/bench/corpus/", "tests/fixtures/")
EXTS = (".musicxml", ".mxl", ".xml")
NODE_JS = os.path.join(util.bench_root(), "node", "sg-roundtrip.js")
ALLOWLIST = os.path.join(util.repo_root(), "tests", "scoregraph", "roundtrip-allowlist.json")
OUT = os.path.join(util.bench_root(), "out", "sg-roundtrip")
MAX_ALLOWLIST = 3


def corpus_files() -> List[str]:
    return sorted(p for p in util.tracked_files() if p.startswith(ROOTS) and p.lower().endswith(EXTS))


def xml_text(data: bytes) -> str:
    """The file's text for the Node adapter (it receives text; Python opened the .mxl)."""
    if data.startswith(b"\xff\xfe") or data.startswith(b"\xfe\xff"):
        return data.decode("utf-16")
    return data.decode("utf-8-sig")


def run_node(jobs: List[Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
    with tempfile.TemporaryDirectory(prefix="sg-roundtrip-") as tmp:
        jin, jout = os.path.join(tmp, "jobs.jsonl"), os.path.join(tmp, "out.jsonl")
        with open(jin, "w", encoding="utf-8", newline="\n") as handle:
            for job in jobs:
                handle.write(json.dumps(job, ensure_ascii=False) + "\n")
        proc = subprocess.run([stages.node_binary(), NODE_JS, "--in", jin, "--out", jout], capture_output=True)
        if proc.returncode != 0:
            raise RuntimeError("sg-roundtrip.js failed: " + proc.stderr.decode("utf-8", "replace")[-2000:])
        rows = {}
        with open(jout, encoding="utf-8") as handle:
            for line in handle:
                row = json.loads(line)
                rows[row["id"]] = row
    return rows


def _graph_core(text: str) -> Any:
    doc = json.loads(text)
    for src in doc.get("provenance", {}).get("sources", []):
        src.pop("input", None)
    return doc


def judge(path: str, data: bytes, row: Dict[str, Any]) -> Dict[str, Any]:
    """L1, L1+, L2 and the play order for one file."""
    res: Dict[str, Any] = {"path": path, "ok": False, "fail": []}
    if not row.get("ok"):
        res["fail"].append(f"{row.get('stage')}: {row.get('code')} {row.get('message', '')[:300]}")
        if row.get("report") and row["report"].get("validation"):
            res["fail"] += [f"  {i['code']} {i['message']}" for i in row["report"]["validation"] if i["severity"] == "ERROR"][:6]
        res["levels"] = {"import": False}
        return res
    levels = {}
    try:
        a = musicxml.read_score(data)
        b = musicxml.read_score(row["xml"])
        label, lines = semantic.classify(semantic.projection(a), semantic.projection(b))
        levels["L1"] = label is None
        if label:
            res["fail"].append(f"L1 {label}")
            res["fail"] += ["  " + x for x in lines[:10]]
        order = a.app_play_order()
        levels["play_order"] = order == row["unroll"]
        if not levels["play_order"]:
            res["fail"].append(f"A17 play order: app {order[:16]} graph {row['unroll'][:16]}")
    except musicxml.ReaderError as exc:
        levels["L1"] = False
        res["fail"].append(f"L1 reader: {exc}")
    inv_a, inv_b = notation_inventory.inventory(data), notation_inventory.inventory(row["xml"].encode("utf-8"))
    levels["L1+"] = inv_a == inv_b
    if not levels["L1+"]:
        res["fail"].append("L1+ inventory differs")
        res["fail"] += ["  " + x for x in notation_inventory.diff(inv_a, inv_b)]
    levels["L2"] = row.get("graph2") is not None and _graph_core(row["graph"]) == _graph_core(row["graph2"])
    if not levels["L2"]:
        if row.get("graph2") is None:
            res["fail"].append(f"L2 re-import failed: {row.get('reimport')}")
        else:
            ga, gb = row["graph"].split("\n"), row["graph2"].split("\n")
            first = next((i for i in range(max(len(ga), len(gb))) if (ga[i:i + 1] or [None]) != (gb[i:i + 1] or [None])), None)
            res["fail"].append(f"L2 graph differs at line {first}: {ga[first] if first is not None and first < len(ga) else ''}"[:300])
            if first is not None and first < len(gb):
                res["fail"].append(f"   re-imported: {gb[first]}"[:300])
    res["levels"] = levels
    res["ok"] = all(levels.values())
    res["dropped"] = row["report"]["dropped"]
    res["import_issues"] = sorted({i["code"] for i in row["report"]["issues"]})
    res["issues"] = row.get("issues", {})
    return res


def load_allowlist() -> List[Dict[str, Any]]:
    if not os.path.exists(ALLOWLIST):
        return []
    return util.load_json(ALLOWLIST).get("files", [])


def run_files(paths: List[str]) -> Dict[str, Dict[str, Any]]:
    root = util.repo_root()
    datas, jobs = {}, []
    for p in paths:
        full = os.path.join(root, p)
        data = musicxml.read_bytes(full)
        datas[p] = data
        jobs.append({"id": p, "xml": xml_text(data), "name": os.path.basename(p), "sha256": util.content_sha256(full),
                     "container": "mxl" if p.lower().endswith(".mxl") else "musicxml"})
    rows = run_node(jobs)
    return {p: judge(p, datas[p], rows[p]) for p in paths}


def cli(args) -> int:
    t0 = time.perf_counter()
    files = corpus_files()
    allow = load_allowlist()
    allowed = {a["path"]: a for a in allow}
    problems: List[str] = []
    if len(allow) > MAX_ALLOWLIST:
        problems.append(f"the allowlist has {len(allow)} files (at most {MAX_ALLOWLIST})")
    for a in allow:
        if not a.get("reason") or not a.get("fixture"):
            problems.append(f"allowlist entry {a.get('path')} needs a reason and a fixture")
    results = run_files(files)
    fixtures = [a["fixture"] for a in allow if a.get("fixture")]
    fixture_results = run_files(fixtures) if fixtures else {}
    for a in allow:
        fr = fixture_results.get(a.get("fixture"))
        if fr is None or fr["ok"]:
            problems.append(f"allowlist fixture {a.get('fixture')} does not reproduce a round-trip difference")
    by_level: Dict[str, int] = {}
    failed = []
    for p in files:
        r = results[p]
        for k, v in r.get("levels", {}).items():
            by_level[k] = by_level.get(k, 0) + (1 if v else 0)
        if not r["ok"]:
            failed.append(p)
    unexpected = [p for p in failed if p not in allowed]
    dropped: Dict[str, int] = {}
    for r in results.values():
        for k, v in (r.get("dropped") or {}).items():
            dropped[k] = dropped.get(k, 0) + v
    report = {"schema": "ppp.sg-roundtrip/1", "files": len(files), "passed": len(files) - len(failed),
              "levels_passed": by_level, "failed": failed, "unexpected": unexpected,
              "allowlist": [a["path"] for a in allow], "problems": problems, "dropped": dict(sorted(dropped.items())),
              "results": results}
    util.dump_json(report, os.path.join(OUT, "report.json"))
    for p in failed:
        tag = "ALLOWED" if p in allowed else "FAIL"
        print(f"{tag} {p}")
        for line in results[p]["fail"][:14]:
            print("    " + line)
    print(f"sg-roundtrip: {len(files)} files, {len(files) - len(failed)} pass L1, L1+, L2 and the play order; "
          f"{len(failed)} fail ({len(failed) - len(unexpected)} allowlisted)")
    print("  per level: " + ", ".join(f"{k} {v}/{len(files)}" for k, v in sorted(by_level.items())))
    if dropped:
        print("  dropped by import (reported, Appendix A): " + ", ".join(f"{k} {v}" for k, v in sorted(dropped.items(), key=lambda kv: -kv[1])[:12]))
    for x in problems:
        print("  PROBLEM " + x)
    print(f"  {round(time.perf_counter() - t0, 1)} s · {util.rel(os.path.join(OUT, 'report.json'))}")
    return 0 if not unexpected and not problems else 1
