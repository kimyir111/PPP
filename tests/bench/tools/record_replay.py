#!/usr/bin/env python3
"""Record replay fixtures (T0-R, docs/GOALS/G00 §6.8): reference -> performance -> WAV -> helper /transcribe.

    python tests/bench/tools/record_replay.py [--refs id,id,...] [--profile human] [--seed 1]
                                              [--venv-python PATH] [--helper http://127.0.0.1:8788]
    python tests/bench/tools/record_replay.py --recording take.wav --reference method/beyer/029 \\
        --bar-starts bars.json --performer "name" --license "CC0 1.0, recorded by the performer for PPP"

Each fixture stores the helper's result as it came back, with the truth (bar
starts, and notes when they are known) and provenance. Recording needs the local
helper with transcription set up (README: Making a score from a recording);
replaying the fixtures (``run.py run --suite replay-public``) needs only Node.

Two kinds of fixture (docs/GOALS/G00 §17 M11):
* rendered: the benchmark's synthetic performer, rendered with the Salamander samples and sent
  through the real models. Real AMT and beat-tracking errors, synthetic playing.
* recorded: a real person playing a licence-clean reference. The WAV is never committed (only its
  sha256); the bar starts are checked by a person (bars + 1 values in seconds). This is the only
  input independent of the synthetic generator; none exists yet — it needs recordings from the user.
"""

import argparse
import json
import os
import subprocess
import sys
import tempfile
import time
import urllib.request
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

from pppbench import corpus, perform, suite as suite_mod, util  # noqa: E402

util.setup_stdio()
REPLAY_DIR = os.path.join(util.bench_root(), "replay")


def post_wav(helper, wav_path, name):
    with open(wav_path, "rb") as h:
        data = h.read()
    req = urllib.request.Request(helper + "/transcribe", data=data, method="POST", headers={
        "Content-Type": "application/octet-stream", "X-PPP-Filename": name, "X-PPP-Mode": "solo"})
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.loads(r.read().decode("utf-8"))["job"]


def poll(helper, job, timeout_s=900):
    t0 = time.time()
    while time.time() - t0 < timeout_s:
        with urllib.request.urlopen(f"{helper}/transcribe/{job}", timeout=30) as r:
            v = json.loads(r.read().decode("utf-8"))
        if v["state"] == "done":
            return v["result"]
        if v["state"] == "error":
            raise RuntimeError(f"helper job failed: {v.get('code')}: {v.get('error')}")
        time.sleep(2)
    raise TimeoutError("helper job did not finish")


def default_refs(n=6, max_seconds=45.0):
    """Short, licence-clean core references (not micro), in fnv1a32 order."""
    refs = corpus.by_id(corpus.load_corpus())
    core = suite_mod.load_suite("core")["references"]
    out = []
    for rid in sorted((r for r in core if not r.startswith("micro/")), key=lambda r: (util.fnv1a32(r), r)):
        e = refs[rid]
        c = corpus.read_reference(e)
        p = perform.perform(c, rid, "human", "none", 1, expect=e.expect)
        if p.input["notes"][-1]["off"] <= max_seconds:
            out.append(rid)
        if len(out) >= n:
            break
    return out


def record_real(args, health) -> int:
    """A recorded fixture from a real performance. Refuses without a licence, a performer and bar starts."""
    missing = [k for k in ("reference", "bar_starts", "performer", "license") if not getattr(args, k)]
    if missing:
        print("ERROR: a recorded fixture needs " + ", ".join("--" + k.replace("_", "-") for k in missing))
        return 2
    e = corpus.by_id(corpus.load_corpus())[args.reference]
    c = corpus.read_reference(e)
    bar_starts = util.load_json(args.bar_starts)
    if len(bar_starts) != len(c.measures) + 1:
        print(f"ERROR: {len(bar_starts)} bar starts for {len(c.measures)} bars (+1 needed)")
        return 2
    wav_sha = util.sha256_file(args.recording)
    cid = f"replay/{args.reference}|recorded-{wav_sha[:8]}"
    key = suite_mod.case_key(cid)
    t0 = time.time()
    result = poll(args.helper, post_wav(args.helper, args.recording, f"ppp-bench-{key}.wav"))
    if result.get("engine") == "catalog":
        print("the helper answered from the catalog, not by transcribing — not recorded")
        return 1
    fixture = {
        "schema": "ppp.replay-case/1", "id": cid, "reference": args.reference, "reference_sha256": e.sha256,
        "recording": {"performer": args.performer, "license": args.license, "wav_sha256": wav_sha},
        # a real performer's pedal is not known unless someone writes it down: None, so pedal is not scored
        "truth": {"bar_starts_s": [util.round_t(float(t)) for t in bar_starts], "pedals": None},
        "helper_result": result,
        "provenance": {"recorded_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                       "git_sha": util.git_sha(), "seconds": round(time.time() - t0, 1),
                       "helper": {k: health.get(k) for k in ("service", "version", "amt", "amtEngines", "beatThis", "pm2s")}},
    }
    path = os.path.join(REPLAY_DIR, key + ".json")
    util.dump_json(fixture, path)
    print(f"{args.reference}: recorded fixture -> {util.rel(path)} (the WAV itself is not stored)")
    return 0


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--refs")
    ap.add_argument("--profile", default="human")
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--helper", default="http://127.0.0.1:8788")
    ap.add_argument("--venv-python", default=os.environ.get("PPP_TRANSCRIBE_PYTHON") or
                    os.path.join(util.repo_root(), "tools", "transcribe-venv", "Scripts", "python.exe"))
    ap.add_argument("--recording", help="a WAV of a real person playing --reference (recorded fixture)")
    ap.add_argument("--reference")
    ap.add_argument("--bar-starts", help="JSON list of bar start times in seconds, bars + 1 values, checked by a person")
    ap.add_argument("--performer")
    ap.add_argument("--license", help="the recording's licence, stated by the performer")
    args = ap.parse_args(argv)
    with urllib.request.urlopen(args.helper + "/health", timeout=5) as r:
        health = json.loads(r.read().decode("utf-8"))
    if not health.get("transcriber"):
        print("SKIPPED: the helper has no transcriber")
        return 0
    if args.recording:
        return record_real(args, health)
    ids = args.refs.split(",") if args.refs else default_refs()
    refs = corpus.by_id(corpus.load_corpus())
    os.makedirs(REPLAY_DIR, exist_ok=True)
    render = os.path.join(HERE, "render_piano.py")
    for rid in ids:
        e = refs[rid]
        c = corpus.read_reference(e)
        p = perform.perform(c, rid, args.profile, "none", args.seed, expect=e.expect)
        cid = f"replay/{rid}|salamander-v1|{args.profile}|s{args.seed}"
        key = suite_mod.case_key(cid)
        with tempfile.TemporaryDirectory(prefix="pppbench-rec-") as tmp:
            pj, wav = os.path.join(tmp, "perf.json"), os.path.join(tmp, f"ppp-bench-{key}.wav")
            util.dump_json({"notes": p.input["notes"]}, pj)
            subprocess.run([args.venv_python, render, pj, wav], check=True)
            t0 = time.time()
            job = post_wav(args.helper, wav, f"ppp-bench-{key}.wav")
            result = poll(args.helper, job)
            took = time.time() - t0
        if result.get("engine") == "catalog":
            print(f"{rid}: the helper answered from the catalog, not by transcribing — not recorded")
            continue
        bar_starts = [p.timemap.sec(m.start_q) for m in c.measures] + [p.timemap.sec(c.end_q)]
        fixture = {
            "schema": "ppp.replay-case/1", "id": cid, "reference": rid, "reference_sha256": e.sha256,
            "render": {"renderer": "render_piano.py/1 (Salamander Grand Piano V3, CC BY 3.0)", "profile": args.profile,
                       "seed": args.seed, "qpm": p.expected["qpm"], "start_s": p.start_s},
            "truth": {"bar_starts_s": [util.round_t(t) for t in bar_starts],
                      "notes": [{"midi": n["midi"], "on": n["on"], "off": n["off"], "ref_sounding_id": t["ref"]}
                                for n, t in zip(p.input["notes"], p.truth)],
                      "pedals": []},   # render_piano.py is given the notes only: the audio has no pedal
            "helper_result": result,
            "provenance": {"recorded_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                           "git_sha": util.git_sha(), "seconds": round(took, 1),
                           "helper": {k: health.get(k) for k in ("service", "version", "amt", "amtEngines", "beatThis", "pm2s")}},
        }
        path = os.path.join(REPLAY_DIR, key + ".json")
        util.dump_json(fixture, path)
        print(f"{rid}: {len(result.get('notes', []))} notes from {result.get('engine')} in {took:.0f} s -> {util.rel(path)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
