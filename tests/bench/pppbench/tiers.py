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
from typing import Any, Dict, List, Optional, Tuple

from . import corpus, musicxml, stages, suite as suite_mod, sut as sut_mod, util

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
    # scores that are not core references are still read by the app: excluded/quarantined catalogue
    # files, every octave-shift reference, and the independent correctness fixtures
    core_ids = set(core["references"])
    for x in util.load_json(corpus.EXCLUDED)["excluded"]:
        targets.append(("excluded/" + x["id"], musicxml.read_bytes(os.path.join(util.repo_root(), x["path"]))))
    for rid, e in sorted(refs.items()):
        if rid not in core_ids and corpus.read_reference(e).diagnostics.get("octave_shift"):
            targets.append(("ottava/" + rid, musicxml.read_bytes(e.abspath)))
    from . import correctness
    for p in sorted(glob.glob(os.path.join(correctness.DIR, "*.musicxml"))):
        targets.append(("correctness/" + os.path.basename(p), musicxml.read_bytes(p)))
    cases_dir = os.path.join(util.bench_root(), "out", "core", "cases")
    index = os.path.join(util.bench_root(), "out", "core", "index.json")
    if os.path.exists(index):
        idx = util.load_json(index)
        for key, cid in sorted(idx.items(), key=lambda kv: kv[1])[:max_predictions]:
            p = os.path.join(cases_dir, key + ".musicxml")
            if os.path.exists(p):
                targets.append(("prediction/" + cid, musicxml.read_bytes(p)))
    return targets


def _pitch_name(step: str, alter: int, octave: int) -> str:
    return step + ("#" * alter if alter > 0 else "b" * -alter) + str(octave)


def _multiset_diff(label: str, mine: Counter, theirs: Counter) -> List[str]:
    if mine == theirs:
        return []
    only_me, only_app = mine - theirs, theirs - mine
    return [f"{label} differ: {sum(only_me.values())} only in reader (e.g. {list(only_me)[:2]}), "
            f"{sum(only_app.values())} only in app (e.g. {list(only_app)[:2]})"]


def compare_projection(canon, app: Dict[str, Any]) -> List[str]:
    """Parser parity: the reader against the app's own reading of the same file (§17 M6).

    Compared: bars (count, number as the app keys it, start, length, metre, key and mode, repeat signs,
    endings and bar-line style), the order the app plays the bars in (``Score.form``, §21 S-M1), written
    notes (bar, position, value, sounding pitch, hand), spelling (the app's pitch name), tuplets, the
    printed shapes of notes and rests (type — or the app's typeFromQ — and dots, §19 F2), the key
    presses the app's player makes (PianoScore.ties: struck notes and how long they are held) against
    the reader's tie-merged ``sounding``, tempo and staff count. Parity is not correctness: a rule both
    get wrong passes here; musical correctness is `run.py correctness`."""
    diffs = []
    if len(canon.measures) != len(app["measures"]):
        diffs.append(f"measures {len(canon.measures)} vs app {len(app['measures'])}")
    nums, app_nums = [m.app_number for m in canon.measures], [a.get("number") for a in app["measures"]]
    if nums != app_nums:
        diffs.append(f"bar numbers {nums[:6]} vs app {app_nums[:6]}")
    for m, a in zip(canon.measures, app["measures"]):
        if abs(float(m.start_q) - a["startQ"]) > 1e-6 or abs(float(m.len_q) - a["lenQ"]) > 1e-6:
            diffs.append(f"measure {m.index}: start/len {float(m.start_q)}/{float(m.len_q)} vs app {a['startQ']}/{a['lenQ']}")
        if list(m.time) != a["time"] or m.fifths != a["fifths"]:
            diffs.append(f"measure {m.index}: time/key {m.time}/{m.fifths} vs app {a['time']}/{a['fifths']}")
        if "mode" in a and m.mode != a["mode"]:
            diffs.append(f"measure {m.index}: mode {m.mode} vs app {a['mode']}")
        if "bar" in a and m.bar != (a["bar"] or {}):
            diffs.append(f"measure {m.index}: repeats/endings {m.bar} vs app {a['bar']}")
        if len(diffs) > 5:
            break
    mine = canon.app_play_order() if "visits" in app else None
    if mine is not None and mine != app["visits"]:
        diffs.append(f"play order: {len(mine)} bars {mine[:12]} vs app {len(app['visits'])} {app['visits'][:12]}")
    r6 = lambda x: round(float(x), 6)  # noqa: E731
    diffs += _multiset_diff("notes", Counter((n.measure, r6(n.pos_q), r6(n.dur_q), n.midi, n.hand) for n in canon.notes),
                            Counter((n["m"], r6(n["b"]), r6(n["dur"]), n["midi"], n["hand"]) for n in app["notes"]))
    if app["notes"] and "p" in app["notes"][0]:
        diffs += _multiset_diff("spellings",
                                Counter((n.measure, r6(n.pos_q), _pitch_name(n.step, n.alter, n.octave)) for n in canon.notes),
                                Counter((n["m"], r6(n["b"]), n["p"]) for n in app["notes"]))
        diffs += _multiset_diff("tuplets",
                                Counter((n.measure, r6(n.pos_q), n.midi, tuple(n.tuplet) if n.tuplet else None) for n in canon.notes),
                                Counter((n["m"], r6(n["b"]), n["midi"], tuple(n["tm"]) if n["tm"] else None) for n in app["notes"]))
        diffs += _multiset_diff("key presses (tie merging)",
                                Counter((s.measure, r6(s.pos_q), r6(s.dur_q), s.midi) for s in canon.sounding),
                                Counter((n["m"], r6(n["b"]), r6(n["hold"]), n["midi"]) for n in app["notes"] if n["struck"]))
    if app["notes"] and "type" in app["notes"][0]:
        from .metrics.readability import app_type
        diffs += _multiset_diff("note shapes",
                                Counter((n.measure, r6(n.pos_q), n.midi, app_type(n.type, n.dur_q), n.dots) for n in canon.notes),
                                Counter((n["m"], r6(n["b"]), n["midi"], n["type"], n["dots"]) for n in app["notes"]))
        diffs += _multiset_diff("rests",
                                Counter((r.measure, r6(r.pos_q), r6(r.dur_q), r.staff, app_type(r.type, r.dur_q), r.dots,
                                         tuple(r.tuplet) if r.tuplet else None) for r in canon.rests),
                                Counter((r["m"], r6(r["b"]), r6(r["dur"]), r["staff"], r["type"], r["dots"],
                                         tuple(r["tm"]) if r.get("tm") else None) for r in app.get("rests", [])))
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
    util.dump_json({"schema": "ppp.bench-conformance/2", "kind": "parser parity (not correctness)",
                    "targets": len(rows), "mismatches": bad, "rows": rows}, out)
    print(f"parser parity: {len(rows) - bad}/{len(rows)} identical (reader vs the app's parseMusicXML and player ties). "
          f"Parity is not correctness — see `run.py correctness`. · {util.rel(out)}")
    return 1 if bad else 0


# ----------------------------------------------------------------- T1-O
OMR_HELPER = "http://127.0.0.1:8788/health"


def omr_flags(sa, pred, suspects) -> Dict[str, Any]:
    """Precision/recall of the app's suspect bars against bars that are really wrong.

    A prediction bar is wrong when it is not aligned to a reference bar or aligned with S < 1."""
    aligned = {p: sim for _, p, sim in sa.measure_pairs}
    wrong = {j for j in range(len(pred.measures)) if aligned.get(j, 0.0) < 1.0}
    number_to_index = {m.number: m.index for m in pred.measures}
    flagged = {number_to_index[str(x)] for x in suspects if str(x) in number_to_index}
    hit = len(flagged & wrong)
    return {"omr.flag.precision": hit / len(flagged) if flagged else None,
            "omr.flag.recall": hit / len(wrong) if wrong else None,
            "omr.wrong_measures": float(len(wrong)), "omr.flagged_measures": float(len(flagged))}


def _fmt(v) -> str:
    return f"{v:.3f}" if isinstance(v, float) else str(v)


def omr_live(args, suite=None) -> int:
    import platform
    import sys
    import time
    from datetime import datetime, timezone
    from . import VERSIONS, aggregate, compare, evaluate, projection, report
    base = (getattr(args, "base_url", None) or "http://127.0.0.1:8777").rstrip("/")
    require = getattr(args, "require_env", False)
    if not _http_ok(base + "/"):
        return _skip(f"the app server is not reachable at {base} (run `npm start`)", require)
    try:
        with urllib.request.urlopen(OMR_HELPER, timeout=3) as r:
            health = json.loads(r.read().decode("utf-8"))
    except Exception:
        return _skip("the local helper is not running at 127.0.0.1:8788 (run `npm run omr`)", require)
    if not (health.get("audiveris") or health.get("pdfToMusic")):
        return _skip("the helper has no OMR engine (Audiveris or PDFtoMusic Pro)", require)
    node = stages.node_binary()
    reason = _puppeteer_available(node)
    if reason:
        return _skip(reason, require)
    suite = suite or suite_mod.load_suite("omr-live")
    entry = corpus.by_id(corpus.load_corpus())[suite["reference"]]
    ref = corpus.read_reference(entry)
    key = corpus.expected_key(entry, ref)
    expected = {"qpm": corpus.expected_qpm(entry, ref), "time": list(corpus.expected_time(entry, ref)),
                "key": {"fifths": key["fifths"], "mode": key["mode"]}, "measures": len(ref.measures), "bar_starts": []}
    t0 = time.perf_counter()
    with tempfile.TemporaryDirectory(prefix="pppbench-omr-") as tmp:
        fin, fout = os.path.join(tmp, "in.jsonl"), os.path.join(tmp, "out.jsonl")
        with open(fin, "w", encoding="utf-8", newline="\n") as h:
            for c in suite["cases"]:
                h.write(json.dumps({"id": c["id"], "path": os.path.join(util.repo_root(), c["fixture"]),
                                    "type": c["type"]}) + "\n")
        r = subprocess.run([node, os.path.join(NODE_DIR, "omr-live.js"), "--in", fin, "--out", fout, "--base", base],
                           capture_output=True)
        if r.returncode != 0:
            msg = r.stderr.decode("utf-8", "replace").strip().splitlines()
            return _skip("the app page did not run OMR: " + (msg[-1] if msg else f"exit {r.returncode}"), require)
        rows_in = {}
        for line in util.read_text(fout).splitlines():
            if line.strip():
                row = json.loads(line)
                rows_in[row["id"]] = row
    cases, timing = [], {}
    for c in suite["cases"]:
        row = rows_in[c["id"]]
        timing[c["id"]] = row.get("ms")
        rec = {"id": c["id"], "key": suite_mod.case_key(c["id"]),
               "tags": ["set:omr", "input:" + c["type"].split("/")[-1]], "status": "ok", "error_code": None,
               "metrics": {}, "counts": {}, "predicted": None,
               "expected": {k: expected[k] for k in ("qpm", "time", "key", "measures")}}
        if not row["ok"]:
            rec.update(status="error", error_code="OMR_" + str(row.get("code") or "exception").upper().replace("-", "_"),
                       error=(row.get("error") or "")[:300])
        else:
            util.dump_json({"projection": row["projection"], "report": row["report"], "engine": row.get("engine")},
                           os.path.join(util.bench_root(), "out", suite["name"], "cases", rec["key"] + ".app-score.json"))
            pred = projection.canonical_from_projection(row["projection"])
            m, counts, predicted, sa = evaluate.evaluate_symbolic(ref, pred, expected)
            m.update(omr_flags(sa, pred, row["report"]["suspectMeasures"]))
            m["omr.confidence"] = row["report"]["confidence"]
            predicted = dict(predicted, engine=row.get("engine"), level=row["report"]["level"], pages=row.get("pages"))
            rec.update(metrics=m, counts=counts, predicted=predicted)
        cases.append(rec)
    cases.sort(key=lambda x: x["id"])
    from . import known_defects
    lock = util.sha256_bytes(util.dumps_json(sorted(
        [c["id"], util.content_sha256(os.path.join(util.repo_root(), c["fixture"]))] for c in suite["cases"])).encode("utf-8"))
    results = {"schema": "ppp.bench-results/1", "suite": suite["name"], "suite_sha256": suite_mod.suite_sha256(suite),
               "lock_sha256": lock, "versions": dict(VERSIONS), "filtered": False,
               "aggregates": aggregate.aggregate(cases), "known_failures": known_defects.audit(), "cases": cases}
    out = os.path.join(util.bench_root(), "out", suite["name"])
    util.dump_json(results, os.path.join(out, "results.json"))
    results = util.load_json_text(util.dumps_json(results))   # compare what results.json holds (see private.py)
    app = os.path.join(util.repo_root(), "Piano Coach App.dc.html")
    run = {"started_at": datetime.now(timezone.utc).isoformat(timespec="seconds"), "git_sha": util.git_sha(),
           "git_dirty": util.git_dirty(), "audio_score_path": "audio-score.js",
           "audio_score_sha256": util.content_sha256(stages.default_audio_score()),
           **sut_mod.describe(stages.default_audio_score()),
           "app_sha256": util.content_sha256(app),
           "helper": {k: health.get(k) for k in ("version", "audiveris", "pdfToMusic")},
           "node": None, "python": platform.python_version(), "platform": sys.platform, "cases": len(cases),
           "timing": {"total_s": round(time.perf_counter() - t0, 3), "per_case_ms": timing}}
    util.dump_json(run, os.path.join(out, "run.json"))
    base_line = compare.load_baseline(suite)
    verdict = compare.compare(results, base_line, suite.get("gate") or {}) if base_line else None
    report.write_summary(results, run, verdict, base_line, os.path.join(out, "summary.md"))
    shown = ("notes.symbolic.f1", "omr.measure_alignment_rate", "struct.measures.count_exact",
             "omr.flag.precision", "omr.flag.recall", "sqi")
    for c in cases:
        if c["status"] != "ok":
            print(f"{c['id']:22} error {c['error_code']}")
            continue
        m = c["metrics"]
        print(f"{c['id']:22} " + " ".join(f"{k.split('.', 1)[-1]}={_fmt(m.get(k))}" for k in shown))
    print(f"omr-live: {len(cases)} cases in {run['timing']['total_s']} s · {util.rel(os.path.join(out, 'summary.md'))}")
    if verdict:
        print(compare.format_verdict(verdict))
        return verdict.exit_code
    return 0


# ----------------------------------------------------------------- T2
def record_replay(args) -> int:
    helper = "http://127.0.0.1:8788/health"
    require = getattr(args, "require_env", False)
    try:
        with urllib.request.urlopen(helper, timeout=3) as r:
            health = json.loads(r.read().decode("utf-8"))
    except Exception:
        return _skip("the local helper is not running at 127.0.0.1:8788 (npm run omr, with transcription set up)", require)
    if not health.get("transcriber"):
        return _skip("the helper has no transcriber configured (README: Making a score from a recording)", require)
    venv = os.environ.get("PPP_TRANSCRIBE_PYTHON") or os.path.join(util.repo_root(), "tools", "transcribe-venv", "Scripts", "python.exe")
    if not os.path.exists(venv):
        return _skip(f"no transcribe venv python at {venv} (set PPP_TRANSCRIBE_PYTHON); it renders the WAVs", require)
    import sys
    tool = os.path.join(util.bench_root(), "tools", "record_replay.py")
    return subprocess.run([sys.executable, tool, "--venv-python", venv]).returncode
