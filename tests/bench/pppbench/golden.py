"""Golden snapshots: exact toMusicXml output for fixed inputs (docs/GOALS/G00 §7).

    run.py golden                     compare against golden/expected (exit 1 on any difference)
    run.py golden --init              write golden/inputs from the generator (once), then expected
    run.py golden --bless --reason R  accept the current output; logs to golden/BLESS_LOG.md
"""

from __future__ import annotations

import difflib
import os
import re
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

from . import corpus, evaluate, perform, stages, suite as suite_mod, util

GOLDEN_DIR = os.path.join(util.bench_root(), "golden")
STATS_KEYS = ["bars", "beatsPerBar", "beatType", "tempo", "key.fifths", "key.mode", "notes", "rh", "lh", "beatSource",
              "quantizer", "tempoAlias", "beatFallback", "arrangement.level", "arrangement.style"]

# tests/transcription.test.js: "a PM2S-shaped grid becomes 6/8 MusicXML"
def pm2s_grid_input() -> Dict[str, Any]:
    grid = {"ticksPerQuarter": 24, "beatsPerBar": 6, "beatType": 8, "bpm": 60, "notes": []}
    for bar in range(4):
        o = bar * 72
        grid["notes"].append({"midi": 43, "tick": o, "endTick": o + 36, "vel": 80})
        grid["notes"].append({"midi": 47, "tick": o + 36, "endTick": o + 72, "vel": 70})
        for i in range(6):
            grid["notes"].append({"midi": 67, "tick": o + i * 12, "endTick": o + i * 12 + 12, "vel": 60})
    return {"input": {"grid": grid}, "opts": {"title": "Grid"}}


def _paths(key: str) -> Tuple[str, str, str]:
    return (os.path.join(GOLDEN_DIR, "inputs", key + ".json"),
            os.path.join(GOLDEN_DIR, "expected", key + ".musicxml"),
            os.path.join(GOLDEN_DIR, "expected", key + ".stats.json"))


def stats_subset(stats: Dict[str, Any]) -> Dict[str, Any]:
    out = {}
    for k in STATS_KEYS:
        v: Any = stats
        for part in k.split("."):
            v = v.get(part) if isinstance(v, dict) else None
        out[k] = v
    return out


def _parse_source(src: str):
    ref_id, profile, beats, seed = src.split("|")
    return ref_id, profile, beats, int(seed[1:])


def _perf_for(case: Dict[str, Any]):
    if case["source"].startswith("grid:"):
        return None, None, None
    ref_id, profile, beats, seed = _parse_source(case["source"])
    entry = corpus.by_id(corpus.load_corpus())[ref_id]
    canon = corpus.read_reference(entry)
    return entry, canon, perform.perform(canon, ref_id, profile, beats, seed, expect=entry.expect,
                                         case_opts=case.get("opts"), opt_name=case.get("opt_name"))


def init_inputs(suite: Dict[str, Any]) -> None:
    for case in suite["cases"]:
        ip, _, _ = _paths(case["key"])
        if case["source"] == "grid:pm2s-6-8":
            data = pm2s_grid_input()
        else:
            _, _, p = _perf_for(case)
            data = {"input": p.input, "opts": p.opts}
        data["source"] = case["source"]
        util.dump_json(data, ip)


def _measure_blocks(xml: str) -> Dict[str, str]:
    return {m.group(1): m.group(0) for m in re.finditer(r'<measure number="([^"]+)">.*?</measure>', xml, re.S)}


def xml_diff(expected: str, actual: str, max_measures: int = 3) -> List[str]:
    e, a = _measure_blocks(expected), _measure_blocks(actual)
    keys = sorted(set(e) | set(a), key=lambda k: (int(k) if k.isdigit() else 1 << 30, k))
    out, shown = [], 0
    head_e, head_a = expected.split("<measure ", 1)[0], actual.split("<measure ", 1)[0]
    if head_e != head_a:
        out += list(difflib.unified_diff(head_e.splitlines(), head_a.splitlines(), "expected", "actual", n=2, lineterm=""))
    for k in keys:
        if e.get(k) == a.get(k):
            continue
        el = (e.get(k) or "").replace("><", ">\n<").splitlines()
        al = (a.get(k) or "").replace("><", ">\n<").splitlines()
        out += list(difflib.unified_diff(el, al, f"expected measure {k}", f"actual measure {k}", n=2, lineterm=""))
        shown += 1
        if shown >= max_measures:
            break
    if not out and expected != actual:
        out.append("(the files differ outside measure blocks)")
    return out


def _metrics(case, xml: str, stats: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    entry, canon, p = _perf_for(case)
    if p is None:
        return None
    try:
        m, _, _ = evaluate.evaluate_timed(canon, p, {"ok": True, "xml": xml, "stats": stats},
                                          skip_metrics=entry.expect.get("skip_metrics", ()))
    except evaluate.CaseError as exc:
        return {"error": exc.code}
    return {k: m.get(k) for k in ("notes.identity.f1", "struct.time_sig.exact", "struct.key.fifths_exact",
                                  "notation.hand.accuracy", "notation.duration.accuracy", "sqi")}


def run_golden(init: bool = False, bless: bool = False, reason: Optional[str] = None,
               audio_score: Optional[str] = None) -> int:
    suite = util.load_json(os.path.join(suite_mod.SUITES_DIR, "golden.json"))
    if bless and not reason:
        print("ERROR: --bless needs --reason \"why the output changed\"")
        return 2
    if init:
        init_inputs(suite)
        print(f"wrote {len(suite['cases'])} golden inputs")
    jobs = []
    for case in suite["cases"]:
        ip, _, _ = _paths(case["key"])
        if not os.path.exists(ip):
            print(f"ERROR: {os.path.relpath(ip, util.repo_root())} is missing; run `golden --init` once")
            return 2
        data = util.load_json(ip)
        jobs.append({"id": case["key"], "input": data["input"], "opts": data.get("opts") or {}})
    res = stages.notate_batch(jobs, audio_score=audio_score)["results"]
    changed, failures = [], 0
    for case in suite["cases"]:
        key = case["key"]
        _, xp, sp = _paths(key)
        row = res[key]
        if not row.get("ok"):
            print(f"{key} FAIL: toMusicXml threw {row.get('code')}: {row.get('error')}")
            failures += 1
            continue
        xml = row["xml"].replace("\r\n", "\n")
        sub = stats_subset(row["stats"])
        if init or bless:
            old = util.read_text(xp).replace("\r\n", "\n") if os.path.exists(xp) else None
            old_stats = util.load_json(sp) if os.path.exists(sp) else None
            if old != xml or old_stats != util.load_json_text(util.dumps_json(sub)):
                changed.append(key)
            os.makedirs(os.path.dirname(xp), exist_ok=True)
            with open(xp, "w", encoding="utf-8", newline="\n") as handle:
                handle.write(xml)
            util.dump_json(sub, sp)
            continue
        if not os.path.exists(xp):
            print(f"{key} FAIL: no expected output; run `golden --init`")
            failures += 1
            continue
        expected = util.read_text(xp).replace("\r\n", "\n")
        exp_stats = util.load_json(sp)
        cur_stats = util.load_json_text(util.dumps_json(sub))
        if expected == xml and exp_stats == cur_stats:
            print(f"{key} ok   {case['source']}")
            continue
        failures += 1
        print(f"{key} DIFF {case['source']}")
        for line in xml_diff(expected, xml):
            print("    " + line)
        for k in STATS_KEYS:
            if exp_stats.get(k) != cur_stats.get(k):
                print(f"    stats.{k}: {exp_stats.get(k)!r} -> {cur_stats.get(k)!r}")
        before, after = _metrics(case, expected, row["stats"]), _metrics(case, xml, row["stats"])
        if before and after:
            for k in before:
                if before[k] != after[k]:
                    print(f"    metric {k}: {before[k]} -> {after[k]}")
    if init or bless:
        log = os.path.join(GOLDEN_DIR, "BLESS_LOG.md")
        exists = os.path.exists(log)
        with open(log, "a", encoding="utf-8", newline="\n") as handle:
            if not exists:
                handle.write("# Golden bless log\n\nEvery accepted change to tests/bench/golden/expected. "
                             "Bless in the same commit as the SUT change that caused it.\n\n")
            handle.write(f"- {datetime.now(timezone.utc).date().isoformat()} · {(util.git_sha() or '?')[:10]} · "
                         f"{'init' if init else 'bless'}: {reason or 'initial snapshots'} · changed: {', '.join(changed) or 'none'}\n")
        print(f"golden: {'initialised' if init else 'blessed'} {len(suite['cases'])} cases; changed: {', '.join(changed) or 'none'}")
        return 0
    print(f"golden: {len(suite['cases']) - failures}/{len(suite['cases'])} identical")
    return 1 if failures else 0
