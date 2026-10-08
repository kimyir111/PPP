"""The inputs of the bench suites as toMusicXml jobs (the id, the input and the options of every case).

    shadow_compare.jobs_for(name)    name: golden | smoke | core | robust | replay-public | ...

This was the shadow comparison of G01 section 15.3 / section 20 Step 7.2: the old writer (buildXml, behind
opts.legacyWriter) and the ScoreGraph writer on the same inputs, read back by the G0 app-parity reader. The
comparison is finished and MX-3 removed the old writer, so the comparison itself is gone; what stays is the one
function the other tools here (g3_jobs.py, graph_check.py) borrow, which is why the file keeps its name.
"""

from __future__ import annotations

import os
import sys
from typing import Any, Dict, List

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
sys.path.insert(0, os.path.join(REPO, "tests", "bench"))

from pppbench import corpus, perform, private, suite as suite_mod, util  # noqa: E402

util.setup_stdio()


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
