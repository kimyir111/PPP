"""Golden snapshots: fixed inputs, exact outputs (docs/GOALS/G00 §7, §17 M7, §19 F3).

Two layers per case, with different jobs:
* **semantic snapshot** (``expected/<key>.semantic.json``, pppbench/semantic.py): the score's
  *structure* — bars, their numbers and repeat signs, the order the app plays them in, staves, which
  staff is which hand, clefs, which staff and voice each note and rest is in — and its *music* — metre, key, tempo marks, notes (position, length, pitch, spelling, printed
  shape, ties, tuplets, printed accidentals), rests (position, length, printed shape), pedal marks —
  plus the stats the app reads and the bar and beat times it syncs the recording with.
* **byte snapshot** (``expected/<key>.musicxml``): serialisation stability and determinism.

Labels, most severe first:
* ``STRUCTURAL_CHANGE`` — the frame changed: bars (count, number, length, repeat signs, endings), the
  play order, staves, hands, clefs, a note or rest moved to another staff or voice.
* ``SEMANTIC_CHANGE`` — the music changed (or the bar and beat times), in an unchanged frame.
* ``SERIALIZATION_ONLY`` — different bytes, the same structure, music, stats and times: formatting,
  element or attribute order, voice numbering. The only change a writer rewrite may bless as such.
* ``ok`` — identical; ``FAIL`` — no output, an unreadable output, or no snapshot.

All but ``ok`` need a bless to be accepted (exit 1 until then). Musical regressions outside these
few cases are the metric gate's job (every core case carries a semantic digest and every metric).
One case failing, even crashing, never stops the others.

    run.py golden                     compare against golden/expected (exit 1 on any difference)
    run.py golden --init              write inputs for cases that have none yet, then expected
    run.py golden --bless --reason R  accept the current output; logs to golden/BLESS_LOG.md
"""

from __future__ import annotations

import difflib
import os
import re
import traceback
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

from . import corpus, evaluate, musicxml, perform, semantic, stages, suite as suite_mod, util

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


def _extra_paths(key: str) -> Tuple[str, str]:
    return (os.path.join(GOLDEN_DIR, "expected", key + ".semantic.json"),
            os.path.join(GOLDEN_DIR, "expected", key + ".timing.json"))


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


def init_inputs(suite: Dict[str, Any]) -> List[str]:
    """Write inputs for cases that have none. Existing inputs are never regenerated: they are the
    fixed half of the snapshot, whatever the generator does later."""
    written = []
    for case in suite["cases"]:
        ip, _, _ = _paths(case["key"])
        if os.path.exists(ip):
            continue
        if case["source"] == "grid:pm2s-6-8":
            data = pm2s_grid_input()
        else:
            _, _, p = _perf_for(case)
            data = {"input": p.input, "opts": p.opts}
        data["source"] = case["source"]
        util.dump_json(data, ip)
        written.append(case["key"])
    return written


def _measure_blocks(xml: str) -> Dict[str, str]:
    """Measure blocks by number; a repeated number gets "#2", "#3" (the app would lay those bars over each other)."""
    out: Dict[str, str] = {}
    seen: Dict[str, int] = {}
    for m in re.finditer(r'<measure number="([^"]+)"[^>]*>.*?</measure>', xml, re.S):
        k = m.group(1)
        seen[k] = seen.get(k, 0) + 1
        out[k if seen[k] == 1 else f"{k}#{seen[k]}"] = m.group(0)
    return out


def xml_diff(expected: str, actual: str, max_measures: int = 3) -> List[str]:
    e, a = _measure_blocks(expected), _measure_blocks(actual)
    keys = sorted(set(e) | set(a), key=lambda k: (int(k.split("#")[0]) if k.split("#")[0].isdigit() else 1 << 30, k))
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


def _semantic_doc(xml: str, stats: Dict[str, Any]) -> Dict[str, Any]:
    return {"schema": semantic.SCHEMA, "score": semantic.projection(musicxml.read_score(xml)), "stats": stats_subset(stats)}


def _metrics(case, xml: str, stats: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """A few metrics of one output against its reference; {"error": ...} instead of raising."""
    try:
        entry, canon, p = _perf_for(case)
        if p is None:
            return {}
        if not stats or "barStarts" not in stats:
            return {"error": "no timing stored for this output"}
        m, _, _ = evaluate.evaluate_timed(canon, p, {"ok": True, "xml": xml, "stats": stats},
                                          skip_metrics=entry.expect.get("skip_metrics", ()))
    except evaluate.CaseError as exc:
        return {"error": exc.code}
    except Exception as exc:  # the metric report must never take the golden check down
        return {"error": f"{type(exc).__name__}: {exc}"}
    return {k: m.get(k) for k in ("usable", "notes.identity.f1", "struct.time_sig.exact", "struct.time_sig.timeline_accuracy",
                                  "struct.key.fifths_exact", "struct.key.timeline_accuracy", "struct.tempo.ok_effective",
                                  "struct.tempo.timeline_accuracy", "notation.hand.accuracy", "notation.duration.accuracy",
                                  "notation.note_shape.consistency", "read.bar_completeness",
                                  "struct.measure_numbers.app_onset_accuracy", "struct.measures.extra_empty_edge",
                                  "notation.pedal.f1", "sqi")}


def _write_expected(key: str, xml: str, stats: Dict[str, Any]) -> None:
    _, xp, sp = _paths(key)
    semp, tp = _extra_paths(key)
    os.makedirs(os.path.dirname(xp), exist_ok=True)
    with open(xp, "w", encoding="utf-8", newline="\n") as handle:
        handle.write(xml)
    util.dump_json(stats_subset(stats), sp)
    util.dump_json(_semantic_doc(xml, stats), semp)
    util.dump_json({"barStarts": stats.get("barStarts"), "beats": stats.get("beats")}, tp)


LABELS = ("ok", "SERIALIZATION_ONLY", "SEMANTIC_CHANGE", "STRUCTURAL_CHANGE", "FAIL")


def _check_case(case, row) -> Tuple[str, List[str]]:
    """(label, report lines). label: one of LABELS."""
    key = case["key"]
    _, xp, sp = _paths(key)
    semp, tp = _extra_paths(key)
    if not row.get("ok"):
        return "FAIL", [f"toMusicXml threw {row.get('code') or 'an exception'}: {row.get('error')}"]
    missing = [os.path.basename(p) for p in (xp, sp, semp, tp) if not os.path.exists(p)]
    if missing:
        return "FAIL", [f"no expected snapshot ({', '.join(missing)}); run `golden --init` or `--bless`"]
    xml = row["xml"].replace("\r\n", "\n")
    expected = util.read_text(xp).replace("\r\n", "\n")
    exp_sem = util.load_json(semp)
    if exp_sem.get("schema") != semantic.SCHEMA:
        return "FAIL", [f"{os.path.basename(semp)} has schema {exp_sem.get('schema')!r}, the reader writes {semantic.SCHEMA}: "
                        "rebless with `golden --bless --reason \"...\"` after checking the byte snapshots are unchanged"]
    try:
        act_sem = util.load_json_text(util.dumps_json(_semantic_doc(xml, row["stats"])))
    except musicxml.ReaderError as exc:
        return "FAIL", [f"the output is not readable MusicXML ({exc.code}): {exc}"]
    # the bar and beat times are output too: the app syncs the recording to the score with them
    exp_time = util.load_json(tp)
    act_time = util.load_json_text(util.dumps_json({"barStarts": row["stats"].get("barStarts"),
                                                    "beats": row["stats"].get("beats")}))
    if expected == xml and exp_sem == act_sem and exp_time == act_time:
        return "ok", []
    label, lines = semantic.classify(exp_sem["score"], act_sem["score"])
    stat_lines = [f"stats.{k}: {exp_sem['stats'].get(k)!r} -> {act_sem['stats'].get(k)!r}"
                  for k in sorted(set(exp_sem["stats"]) | set(act_sem["stats"])) if exp_sem["stats"].get(k) != act_sem["stats"].get(k)]
    for k in ("barStarts", "beats"):
        a, b = exp_time.get(k) or [], act_time.get(k) or []
        if a != b:
            i = next((j for j, (x, y) in enumerate(zip(a, b)) if x != y), min(len(a), len(b)))
            stat_lines.append(f"stats.{k}: {len(a)} -> {len(b)} values, first difference at [{i}]: "
                              f"{a[i] if i < len(a) else '-'} -> {b[i] if i < len(b) else '-'} s")
    if label is None and not stat_lines:
        lines = ["same structure, music, stats and bar times; different bytes (element order, whitespace, formatting)"]
        lines += ["    " + x for x in xml_diff(expected, xml)[:12]]
        return "SERIALIZATION_ONLY", lines
    label = label or "SEMANTIC_CHANGE"      # stats or bar times alone: what the app syncs and reads changed
    lines = lines + stat_lines
    before = _metrics(case, expected, exp_time)
    after = _metrics(case, xml, row["stats"])
    for k in sorted(set(before) | set(after)):
        if before.get(k) != after.get(k):
            lines.append(f"metric {k}: {before.get(k)} -> {after.get(k)}")
    lines.append("first differing bars of the MusicXML:")
    lines += ["    " + x for x in xml_diff(expected, xml)[:24]]
    return label, lines


def run_golden(init: bool = False, bless: bool = False, reason: Optional[str] = None,
               audio_score: Optional[str] = None) -> int:
    suite = util.load_json(os.path.join(suite_mod.SUITES_DIR, "golden.json"))
    if bless and not reason:
        print("ERROR: --bless needs --reason \"why the output changed\"")
        return 2
    new_inputs: List[str] = []
    if init:
        new_inputs = init_inputs(suite)
        print(f"wrote {len(new_inputs)} new golden input(s): {', '.join(new_inputs) or 'none'}")
    jobs = []
    for case in suite["cases"]:
        ip, _, _ = _paths(case["key"])
        if not os.path.exists(ip):
            print(f"ERROR: {os.path.relpath(ip, util.repo_root())} is missing; run `golden --init` once")
            return 2
        data = util.load_json(ip)
        jobs.append({"id": case["key"], "input": data["input"], "opts": data.get("opts") or {}})
    res = stages.notate_batch(jobs, audio_score=audio_score)["results"]
    counts: Dict[str, int] = {}
    changed: List[str] = []
    added: List[str] = []
    for case in suite["cases"]:
        key = case["key"]
        row = res[key]
        if init or bless:
            if not row.get("ok"):
                print(f"{key} FAIL: toMusicXml threw {row.get('code')}: {row.get('error')}")
                counts["FAIL"] = counts.get("FAIL", 0) + 1
                continue
            _, xp, _ = _paths(key)
            semp, _ = _extra_paths(key)
            old_schema = os.path.exists(semp) and util.load_json(semp).get("schema") != semantic.SCHEMA
            label, _ = _check_case(case, row) if os.path.exists(xp) and not old_schema else ("new", [])
            if old_schema:
                same_bytes = util.read_text(xp).replace("\r\n", "\n") == row["xml"].replace("\r\n", "\n")
                changed.append(f"{key} (semantic snapshot -> {semantic.SCHEMA}; MusicXML bytes "
                               f"{'unchanged' if same_bytes else 'CHANGED'})")
            elif label == "new" or key in new_inputs:
                added.append(key)
            elif label != "ok":
                changed.append(f"{key} ({label})")
            _write_expected(key, row["xml"].replace("\r\n", "\n"), row["stats"])
            continue
        try:
            label, lines = _check_case(case, row)
        except Exception as exc:  # a broken report is a failure of this case, never of the whole run
            label, lines = "FAIL", [f"golden check crashed: {type(exc).__name__}: {exc}"] + \
                traceback.format_exc().strip().splitlines()[-3:]
        counts[label] = counts.get(label, 0) + 1
        print(f"{key} {label:18} {case['source']}")
        for line in lines:
            print("    " + line)
    if init or bless:
        log = os.path.join(GOLDEN_DIR, "BLESS_LOG.md")
        exists = os.path.exists(log)
        with open(log, "a", encoding="utf-8", newline="\n") as handle:
            if not exists:
                handle.write("# Golden bless log\n\nEvery accepted change to tests/bench/golden/expected. "
                             "Bless in the same commit as the SUT change that caused it.\n\n")
            handle.write(f"- {datetime.now(timezone.utc).date().isoformat()} · {(util.git_sha() or '?')[:10]} · "
                         f"{'init' if init else 'bless'}: {reason or 'initial snapshots'} · changed: {', '.join(changed) or 'none'}"
                         + (f" · new: {', '.join(added)}" if added else "") + "\n")
        print(f"golden: {'initialised' if init else 'blessed'} {len(suite['cases'])} cases; changed: {', '.join(changed) or 'none'}"
              + (f"; new: {', '.join(added)}" if added else ""))
        return 1 if counts.get("FAIL") else 0
    ok = counts.get("ok", 0)
    print(f"golden: {ok}/{len(suite['cases'])} identical" +
          "".join(f" · {v} {k}" for k, v in sorted(counts.items()) if k != "ok"))
    return 0 if ok == len(suite["cases"]) else 1
