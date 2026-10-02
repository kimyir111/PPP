#!/usr/bin/env python3
"""The two Python halves of the real-AMT runner (G10a-0 step 5, docs/GOALS/G10 section 7.4); of_replay.js drives them.

    python tests/bench/tools/of_prepare.py render   --out DIR [--refs id,id,... | --n 20 --max-seconds 45]
                                                    [--profile cover-pedal] [--seed 1] [--no-room] [--venv-python PATH]
    python tests/bench/tools/of_prepare.py assemble --dir DIR [--replay-dir tests/bench/replay-of]

``render`` humanizes each reference (the calibrated ``cover-pedal`` family by default), renders the performance to a
WAV with the Salamander samples (damper pedal sustain, a short synthetic room: render_piano.py) in DIR and writes
DIR/manifest.json with the truth of every piece. The runner then transcribes each WAV in the production page (the
browser's Onsets & Frames, ``Import.pianoAmtNotes``) and leaves DIR/<key>.result.json. ``assemble`` turns the pairs
into replay fixtures (``engine: onsets-and-frames``, notes only: the audio and the WAV never enter the repository).
"""

import argparse
import json
import os
import subprocess
import sys
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
sys.path.insert(0, HERE)

from pppbench import corpus, perform, suite as suite_mod, util  # noqa: E402
import record_replay  # noqa: E402  (default_refs: the same short, licence-clean core references the helper fixtures use)

util.setup_stdio()
RENDER = os.path.join(HERE, "render_piano.py")
REPLAY_OF = os.path.join(util.bench_root(), "replay-of")
RENDER_TAG = "salamander-v2"


def case_id(rid: str, profile: str, seed: int) -> str:
    return f"replay/{rid}|{RENDER_TAG}|{profile}|s{seed}|of"


def default_python() -> str:
    return os.environ.get("PPP_TRANSCRIBE_PYTHON") or os.path.join(util.repo_root(), "tools", "transcribe-venv", "Scripts", "python.exe")


def pick_refs(args) -> list:
    if args.refs:
        return args.refs.split(",")
    out = []
    refs = corpus.by_id(corpus.load_corpus())
    core = suite_mod.load_suite("core")["references"]
    for rid in sorted((r for r in core if not r.startswith("micro/")), key=lambda r: (util.fnv1a32(r), r)):
        e = refs[rid]
        c = corpus.read_reference(e)
        p = perform.perform(c, rid, args.profile, "none", args.seed, expect=e.expect)
        if p.input["notes"] and p.input["notes"][-1]["off"] <= args.max_seconds:
            out.append(rid)
        if len(out) >= args.n:
            break
    return out


def render(args) -> int:
    os.makedirs(args.out, exist_ok=True)
    refs = corpus.by_id(corpus.load_corpus())
    manifest = []
    for rid in pick_refs(args):
        e = refs[rid]
        canon = corpus.read_reference(e)
        p = perform.perform(canon, rid, args.profile, "none", args.seed, expect=e.expect)
        cid = case_id(rid, args.profile, args.seed)
        key = suite_mod.case_key(cid)
        perf_json, wav = os.path.join(args.out, key + ".perf.json"), os.path.join(args.out, key + ".wav")
        util.dump_json({"notes": p.input["notes"], "pedals": p.input["pedals"]}, perf_json)
        cmd = [args.venv_python, RENDER, perf_json, wav] + ([] if args.no_room else ["--room"])
        subprocess.run(cmd, check=True, capture_output=True)
        bar_starts = [p.timemap.sec(m.start_q) for m in canon.measures] + [p.timemap.sec(canon.end_q)]
        manifest.append({
            "id": cid, "key": key, "reference": rid, "reference_sha256": e.sha256, "wav": wav, "profile": args.profile, "seed": args.seed,
            "room": not args.no_room, "qpm": p.expected["qpm"], "start_s": p.start_s,
            "bar_starts_s": [util.round_t(t) for t in bar_starts],
            "truth_notes": [{"midi": n["midi"], "on": n["on"], "off": n["off"], "ref_sounding_id": t["ref"]}
                            for n, t in zip(p.input["notes"], p.truth)],
            "pedals_used": p.input["pedals"]})
        print(f"{rid}: {len(p.input['notes'])} notes, {p.input['notes'][-1]['off']:.1f} s -> {os.path.basename(wav)}")
    util.dump_json({"schema": "ppp.of-replay-manifest/1", "pieces": manifest}, os.path.join(args.out, "manifest.json"))
    print(f"manifest: {len(manifest)} pieces in {args.out}")
    return 0


def assemble(args) -> int:
    man = util.load_json(os.path.join(args.dir, "manifest.json"))
    os.makedirs(args.replay_dir, exist_ok=True)
    wrote = 0
    for m in man["pieces"]:
        rpath = os.path.join(args.dir, m["key"] + ".result.json")
        if not os.path.exists(rpath):
            print(f"{m['reference']}: no result yet, skipped")
            continue
        res = util.load_json(rpath)
        result = res["helper_result"]
        notes = [{"on": util.round_t(n["on"]), "off": util.round_t(n["off"]), "midi": n["midi"], "vel": n["vel"]} for n in result["notes"]]
        fixture = {
            "schema": "ppp.replay-case/1", "id": m["id"], "reference": m["reference"], "reference_sha256": m["reference_sha256"],
            "render": {"renderer": "render_piano.py/2 (Salamander Grand Piano V3, CC BY 3.0; damper pedal" + (", synthetic room" if m["room"] else "") + ")",
                       "profile": m["profile"], "seed": m["seed"], "qpm": m["qpm"], "start_s": m["start_s"]},
            # the performer's pedal is in the audio but not a thing O&F writes, and no reference score marks it: pedal is not scored
            "truth": {"bar_starts_s": m["bar_starts_s"], "notes": m["truth_notes"], "pedals": None, "pedals_used": m["pedals_used"]},
            # the page's own result, notes only (engine, tier and the truncation flag as the app reports them)
            "helper_result": {"engine": result["engine"], "qualityTier": result.get("qualityTier"), "truncated": result.get("truncated"),
                              "duration": result.get("duration"), "notes": notes},
            "provenance": {"recorded_at": datetime.now(timezone.utc).isoformat(timespec="seconds"), "git_sha": util.git_sha(),
                           "seconds": res.get("seconds"), "model": res.get("model"), "runner": "tests/bench/tools/of_replay.js"},
        }
        util.dump_json(fixture, os.path.join(args.replay_dir, m["key"] + ".json"))
        wrote += 1
        shown = os.path.join(args.replay_dir, m["key"] + ".json")
        try:
            shown = util.rel(shown)
        except ValueError:                              # another drive: show the path as it is
            pass
        print(f"{m['reference']}: {len(notes)} heard notes of {len(m['truth_notes'])} played -> {shown}")
    print(f"assembled {wrote} fixtures")
    return 0


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("render")
    r.add_argument("--out", required=True)
    r.add_argument("--refs")
    r.add_argument("--n", type=int, default=20)
    r.add_argument("--max-seconds", type=float, default=45.0)
    r.add_argument("--profile", default="cover-pedal")
    r.add_argument("--seed", type=int, default=1)
    r.add_argument("--no-room", action="store_true")
    r.add_argument("--venv-python", default=default_python())
    a = sub.add_parser("assemble")
    a.add_argument("--dir", required=True)
    a.add_argument("--replay-dir", default=REPLAY_OF)
    args = ap.parse_args(argv)
    return render(args) if args.cmd == "render" else assemble(args)


if __name__ == "__main__":
    sys.exit(main())
