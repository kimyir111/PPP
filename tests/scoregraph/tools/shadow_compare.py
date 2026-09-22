"""The shadow comparison of G01 §15.3 / §20 Step 7.2: the old writer (buildXml) and the ScoreGraph writer
(buildGraph -> musicxml.export) on the same inputs, read back by the G0 app-parity reader.

    python tests/scoregraph/tools/shadow_compare.py [--suite golden|smoke|core|robust|replay-public|full ...]

For every input of the suites named (default: golden, smoke, core, robust, replay-public), toMusicXml runs
once with the legacy writer and once with the ScoreGraph writer. The two MusicXML files must read back into
the same canonical score (every field the reader produces, the source hash aside) - stronger than the
semantic projection - and the graph must have no ERROR. Exit 0 when every case agrees.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tempfile
from typing import Any, Dict, List

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
sys.path.insert(0, os.path.join(REPO, "tests", "bench"))

from pppbench import corpus, musicxml, perform, private, semantic, stages, suite as suite_mod, util  # noqa: E402

util.setup_stdio()

NODE = r"""
const fs = require('fs');
const A = require(process.argv[1]);
const jobs = fs.readFileSync(process.argv[2], 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
const out = fs.openSync(process.argv[3], 'w');
for (const job of jobs) {
  let row;
  try {
    const legacy = A.toMusicXml(job.input, Object.assign({}, job.opts, { legacyWriter: true }));
    const sg = A.toMusicXml(job.input, Object.assign({}, job.opts, { scoreGraph: true }));
    const errors = (sg.graphIssues || []).filter(i => i.severity === 'ERROR').length;
    row = { id: job.id, ok: true, legacy: legacy.xml, sg: sg.graphXml || null, statsSame: JSON.stringify(legacy.stats) === JSON.stringify(sg.stats),
            errors: errors, hasGraph: !!sg.graph, warnings: (sg.graphIssues || []).filter(i => i.severity === 'WARNING').map(i => i.code) };
  } catch (e) {
    row = { id: job.id, ok: false, code: e.code || null, error: String(e && e.stack || e).slice(0, 2000) };
  }
  fs.writeSync(out, JSON.stringify(row) + '\n');
}
fs.closeSync(out);
"""


def jobs_for(name: str) -> List[Dict[str, Any]]:
    if name == "golden":
        suite = util.load_json(os.path.join(suite_mod.SUITES_DIR, "golden.json"))
        out = []
        for case in suite["cases"]:
            data = util.load_json(os.path.join(util.bench_root(), "golden", "inputs", case["key"] + ".json"))
            out.append({"id": "golden:" + case["key"], "input": data["input"], "opts": data.get("opts") or {}})
        return out
    suite = suite_mod.load_suite(name)
    if suite.get("kind") == "synthetic-notation":
        refs = corpus.load_corpus()
        by = corpus.by_id(refs)
        out = []
        for c in suite_mod.expand(suite, refs):
            canon = corpus.read_reference(by[c.ref_id])
            p = perform.perform(canon, c.ref_id, c.profile, c.beats, c.seed, expect=by[c.ref_id].expect, case_opts=c.opts, opt_name=c.opt_name)
            out.append({"id": name + ":" + c.id, "input": p.input, "opts": p.opts})
        return out
    out = []
    for c in private.load_cases(suite):
        if c.get("kind") != "replay":
            continue
        hr = c["helper_result"]
        inp = {k: hr[k] for k in ("notes", "pedals", "beats", "downbeats", "beatConfidence", "grid") if k in hr}
        inp["title"] = "bench"
        out.append({"id": name + ":" + c["id"], "input": inp, "opts": {"title": "bench"}})
    return out


def canonical(xml: str) -> Dict[str, Any]:
    d = musicxml.read_score(xml).to_json()
    d["source"] = None
    return json.loads(json.dumps(d, default=str))


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--suite", action="append")
    ap.add_argument("--audio-score", default=os.path.join(REPO, "audio-score.js"))
    args = ap.parse_args(argv)
    suites = args.suite or ["golden", "smoke", "core", "robust", "replay-public"]
    bad = 0
    total = 0
    for name in suites:
        jobs = jobs_for(name)
        with tempfile.TemporaryDirectory(prefix="shadow-") as tmp:
            jin, jout = os.path.join(tmp, "in.jsonl"), os.path.join(tmp, "out.jsonl")
            with open(jin, "w", encoding="utf-8", newline="\n") as h:
                for j in jobs:
                    h.write(json.dumps(j, ensure_ascii=False) + "\n")
            proc = subprocess.run([stages.node_binary(), "-e", NODE, os.path.abspath(args.audio_score), jin, jout], capture_output=True)
            if proc.returncode != 0:
                print(proc.stderr.decode("utf-8", "replace")[-2000:])
                return 2
            rows = [json.loads(l) for l in open(jout, encoding="utf-8")]
        same = 0
        for row in rows:
            total += 1
            if not row["ok"]:
                if row.get("code") == "no-notes":
                    same += 1
                    continue
                bad += 1
                print(f"ERROR {row['id']}: {row['error'][:600]}")
                continue
            problems = []
            if not row["hasGraph"] or not row["sg"]:
                problems.append("no graph or no ScoreGraph MusicXML")
                bad += 1
                print(f"DIFF {row['id']}: " + problems[0])
                continue
            if row["errors"]:
                problems.append(f"{row['errors']} graph ERROR(s)")
            if not row["statsSame"]:
                problems.append("stats differ")
            a, b = canonical(row["legacy"]), canonical(row["sg"])
            if a != b:
                label, lines = semantic.classify(semantic.projection(musicxml.read_score(row["legacy"])),
                                                 semantic.projection(musicxml.read_score(row["sg"])))
                diffs = [k for k in a if a[k] != b[k]]
                problems.append(f"canonical score differs in {diffs}; projection: {label}")
                problems += ["  " + x for x in lines[:8]]
            if problems:
                bad += 1
                print(f"DIFF {row['id']}")
                for p in problems[:12]:
                    print("    " + p)
            else:
                same += 1
        print(f"{name}: {same}/{len(rows)} cases read back the same")
    print(f"shadow compare: {total - bad}/{total} cases identical" + ("" if not bad else f", {bad} differ"))
    return 0 if not bad else 1


if __name__ == "__main__":
    sys.exit(main())
