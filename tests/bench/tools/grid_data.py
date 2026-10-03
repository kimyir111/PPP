#!/usr/bin/env python3
"""The per-beat grid dataset of G10a-2 (docs/GOALS/G10 section 8, stage S3; AI-5b): humanized performances of the
licence-clean catalogue with the true grid of every beat, for the training script (``train_grid.js``) and the stage's
error analysis. Deterministic (the bench's own performer, LCG streams); nothing here is committed as data.

    python tests/bench/tools/grid_data.py --refs train --out grid-train.jsonl      # every lint-clean NON-hold-out reference
    python tests/bench/tools/grid_data.py --refs holdout --out grid-holdout.jsonl  # the hold-out references (evaluation only)
    python tests/bench/tools/grid_data.py --refs core --profiles cover,swing --beats oracle --seeds 1 --out x.jsonl

One JSON object per performance (a reference x profile x beats profile x seed):

    id, ref, profile, beats, seed, holdout, time [b, t], qpm,
    notes     [[on, off, midi, vel, tq]]   the heard notes; tq the written onset (quarter notes) of the reference note it
                                           plays, null for a note no reference note explains (an AMT ghost)
    inBeats   the beat times the input carries (oracle / oracle-noisy beats), or null
    windows   [[q0, q1, t0, t1, label, swing, n, bar, beat, fracs]]  every quarter-note beat of every bar of the reference (a
              bar's beats start on its own start, as rec.tuplet counts them): its span in quarter notes and in seconds of the
              performance's time map (the true beat times), the true grid ``label``, ``swing`` (1 when the performer played
              a note of the beat late on purpose: the swing family's long-short eighths; the written truth stays straight),
              ``n`` the reference onsets in the beat, the bar index, the beat in the bar and the written onset fractions
              of the beat (distinct, sorted; tuplet rests included).

    cwindows  compound metres only (6/8, 9/8, 12/8; the metre's beat a dotted quarter): the same rows per dotted-quarter
              beat, fractions of the dotted quarter, labels C8 (eighths), C16 (sixteenths), C32 (finer), CT (a tuplet)

Labels (the finest grid the written beat needs; tuplet rests count, as in rec.tuplet):
    T3   a 3:2 tuplet on the thirds of the beat          T6   a tuplet with an onset on a sixth (triplet 16ths)
    S32  a straight onset off the 16th grid (32nd)       S16  everything else (16ths, eighths, quarters, an empty beat)

The hold-out rule (fnv1a32(id) % 5 == 0, references.json ``holdout``): ``--refs train`` refuses a hold-out reference.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from fractions import Fraction

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

from pppbench import corpus, perform, suite as suite_mod, util  # noqa: E402

util.setup_stdio()

DEFAULT_PROFILES = ["cover", "cover-pedal", "human-real", "swing", "cover+of", "cover-alt"]


def ref_ids(which: str):
    refs = corpus.load_corpus()
    by = corpus.by_id(refs)
    full = suite_mod.load_suite("full")["references"]          # every lint-clean reference (hold-out included)
    if which == "train":
        ids = [r for r in full if not by[r].holdout]
    elif which == "holdout":
        ids = [r for r in full if by[r].holdout]
    elif which == "core":
        ids = list(suite_mod.load_suite("core")["references"])
    else:
        ids = which.split(",")
    return sorted(ids), by


def label_of(fracs, tuplet_fracs) -> str:
    if tuplet_fracs:
        return "T6" if any((f * 3).denominator != 1 for f in tuplet_fracs) else "T3"
    if any((f * 4).denominator != 1 for f in fracs):
        return "S32"
    return "S16"


def windows_of(canon, perf, notes):
    """Every quarter-note beat of every bar with its true grid (see the module docstring)."""
    tm = perf.timemap
    events = []                                   # (onset_q, tuplet?)
    for s in canon.sounding:
        events.append((s.onset_q, bool(s.tuplet)))
    for r in canon.rests:
        if r.tuplet:
            events.append((r.onset_q, True))
    # which written onsets the performer moved on purpose (swing): the heard nominal time is not the time map's
    swung = set()
    for n in notes:
        t = n.get("_truth") or {}
        if t.get("ref") is None:
            continue
        q = SOUND_Q[t["ref"]]
        if abs(t["nominal_on"] - tm.sec(q)) > 1e-6:
            swung.add(q)
    events.sort()
    out = []
    j = 0
    for m in canon.measures:
        b = 0
        while m.start_q + b < m.start_q + m.len_q:
            q0 = m.start_q + b
            q1 = min(q0 + 1, m.start_q + m.len_q)
            fr, tf, n = [], [], 0
            for q, tup in events:
                if q0 <= q < q1:
                    f = q - q0
                    (tf if tup else fr).append(f)
                    n += 1
            sw = 1 if any(q0 <= q < q1 for q in swung) else 0
            fracs = sorted({round(float(f), 6) for f in fr + tf})
            out.append([float(q0), float(q1), util.round_t(tm.sec(q0)), util.round_t(tm.sec(q1)),
                        label_of(fr + tf, tf), sw, n, m.index, b, fracs])
            b += 1
            j += 1
    return out


def clabel_of(fracs, tuplet_fracs) -> str:
    """The grid a dotted-quarter beat needs (fractions of the dotted quarter): C8 eighths (thirds), C16 sixteenths
    (sixths), C32 anything finer, CT a tuplet (a duplet, a triplet of 16ths)."""
    if tuplet_fracs:
        return "CT"
    if all((f * 3).denominator == 1 for f in fracs):
        return "C8"
    if all((f * 6).denominator == 1 for f in fracs):
        return "C16"
    return "C32"


def cwindows_of(canon, perf):
    """Compound metres (x/8 with a multiple of three beats, the metre's beat a dotted quarter): every dotted-quarter beat
    of every bar, as windows_of (fractions in dotted quarters). Empty for any other metre."""
    t = canon.primary_time()
    if not (t[1] == 8 and t[0] % 3 == 0):
        return []
    tm = perf.timemap
    events = [(s.onset_q, bool(s.tuplet)) for s in canon.sounding] + [(r.onset_q, True) for r in canon.rests if r.tuplet]
    events.sort()
    out = []
    unit = Fraction(3, 2)
    for m in canon.measures:
        if m.time != t:
            continue
        b = 0
        while m.start_q + b * unit < m.start_q + m.len_q:
            q0 = m.start_q + b * unit
            q1 = min(q0 + unit, m.start_q + m.len_q)
            fr, tf, n = [], [], 0
            for q, tup in events:
                if q0 <= q < q1:
                    f = (q - q0) / unit
                    (tf if tup else fr).append(f)
                    n += 1
            fracs = sorted({round(float(f), 6) for f in fr + tf})
            out.append([float(q0), float(q1), util.round_t(tm.sec(q0)), util.round_t(tm.sec(q1)),
                        clabel_of(fr + tf, tf), 0, n, m.index, b, fracs])
            b += 1
    return out


SOUND_Q = {}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--refs", default="train", help="train | holdout | core | id,id,...")
    ap.add_argument("--profiles", default=",".join(DEFAULT_PROFILES))
    ap.add_argument("--beats", default="oracle", help="comma list of beat profiles (oracle, oracle-noisy, none)")
    ap.add_argument("--seeds", default="1")
    ap.add_argument("--out", required=True)
    args = ap.parse_args()
    ids, by = ref_ids(args.refs)
    if args.refs == "train":
        assert not any(by[r].holdout for r in ids), "hold-out reference in the training set"
    profiles = [p for p in args.profiles.split(",") if p]
    beats = [b for b in args.beats.split(",") if b]
    seeds = [int(s) for s in args.seeds.split(",") if s]
    n_cases = 0
    with open(args.out, "w", encoding="utf-8", newline="\n") as handle:
        for rid in ids:
            entry = by[rid]
            canon = corpus.read_reference(entry)
            SOUND_Q.clear()
            SOUND_Q.update({s.id: s.onset_q for s in canon.sounding})
            for prof in profiles:
                for bp in beats:
                    for seed in seeds:
                        try:
                            p = perform.perform(canon, rid, prof, bp, seed, expect=entry.expect)
                        except Exception as exc:                       # noqa: BLE001 - a reference the performer refuses
                            print(f"skip {rid} {prof}: {exc}", file=sys.stderr)
                            continue
                        # the performer's raw notes (with _truth) are not on the Performance; rebuild the mapping from
                        # the truth list, which is in the same order as input notes
                        notes = []
                        raw = []
                        for n, t in zip(p.input["notes"], p.truth):
                            tq = SOUND_Q.get(t.get("ref")) if t.get("ref") is not None else None
                            notes.append([n["on"], n["off"], n["midi"], n["vel"], None if tq is None else round(float(tq), 6)])
                            raw.append({"_truth": t})
                        row = {"id": f"{rid}|{prof}|{bp}|s{seed}", "ref": rid, "profile": prof, "beats": bp, "seed": seed,
                               "holdout": bool(entry.holdout), "time": list(canon.primary_time()),
                               "qpm": p.expected["qpm"], "notes": notes,
                               "inBeats": p.input.get("beats"), "inDownbeats": p.input.get("downbeats"),
                               "windows": windows_of(canon, p, raw), "cwindows": cwindows_of(canon, p)}
                        handle.write(json.dumps(row, separators=(",", ":")) + "\n")
                        n_cases += 1
    print(f"wrote {n_cases} performances of {len(ids)} references to {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
