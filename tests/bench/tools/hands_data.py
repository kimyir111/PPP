#!/usr/bin/env python3
"""The hand model's training and evaluation data (G10a-2, stage S4; docs/GOALS/G10 section 8.3 AI-5b; G10a-2b section 26).

    python tests/bench/tools/hands_data.py [--out tests/bench/.cache/hands/truth.json]
    python tests/bench/tools/hands_data.py --perfs tests/bench/.cache/hands/perfs.jsonl [--seeds 201] [--no-textures]

Reads every registered, licence-clean reference with two piano staves (the benchmark's own reader, so the hand of a
note is exactly what ``notation.hand.accuracy`` calls its hand: the upper piano staff is the right hand) and writes,
per reference, its key presses in onset order: ``[onset in quarters, onset in seconds at the reference tempo, midi,
hand (1 right / 2 left)]``. Hold-out references are written too, marked ``holdout``: the trainer never fits on them, it
only reports them. The output is note-level data and stays in the git-ignored cache (never committed, G10-D15 / the
roadmap's data rule); ``tests/bench/tools/train_hands.js`` turns it into the aggregate tables of ``rec/weights/hands-v1.json``.

``--perfs`` writes one line per (reference, profile, seed): the humanizer's performance of a reference (its input: the
heard notes, and with ``--beats oracle-noisy`` the helper-like beats) and the written hand of every heard note (0 for a
note the performer or the AMT overlay added). ``train_hands.js --perfs`` runs them through audio-score.js's recording
conversion v2 and fits the weights on exactly the onset groups S4 receives. The seeds default to 201, which no suite and
no other model's data uses (the suites use 1, 2, 11, 12; AI-5a 101-103), so the benchmark never measures a performance
the hand model was fitted on. Hold-out references are never written here.

The references are the benchmark's lint-clean, licence-evidenced list (the ``full`` suite's: quarantined and broken files
are already out), as for the time-skeleton model (``rec_dataset.py``).

Textures (G10a-2b): every two-staff reference that is not a hymn is written three more times, re-voiced as piano covers are
(``pppbench/texture.py``: ``octaves-l`` the left hand's single notes doubled an octave below, ``octaves-r`` the right hand's an
octave above, ``octaves`` both; every note keeps its hand), marked ``"texture"``. The trainer counts the training ones with the
references (the catalogue has almost no octave played by one hand: its bare octaves are the unison exercises' one note per
hand) and reports the hold-out ones; ``--perfs`` writes the textured performances of the training references too (cover and
cover+of: S4's real input on covers, evaluated, not fitted). Hymns stay as written: the chorale style is the hymnal's four parts
on two staves.
"""

from __future__ import annotations

import argparse
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

from pppbench import corpus, perform, suite as suite_mod, util  # noqa: E402

util.setup_stdio()
DEFAULT_OUT = os.path.join(util.bench_root(), ".cache", "hands", "truth.json")
PERF_ROWS = (("cover", "none"), ("cover-pedal", "none"), ("human-real", "none"), ("cover+of", "none"),
             ("cover", "oracle-noisy"), ("cover-pedal+helper", "oracle-noisy"))
TEXTURES = ("octaves-l", "octaves-r", "octaves")          # pppbench/texture.py; written in this order after each reference
TEXTURE_PERF_ROWS = (("cover", "none"), ("cover+of", "none"))


def references():
    by = corpus.by_id(corpus.load_corpus())
    return [by[r] for r in sorted(suite_mod.load_suite("full")["references"])]


def textured(entry) -> bool:
    return entry.set != "hymns"


def perf_rows(entry, rows, seeds, texture=None):
    canon = corpus.reference_for(entry, texture)
    if canon.staves < 2 or "notation.hand.accuracy" in (entry.expect.get("skip_metrics") or ()):
        return
    hand = {s.id: (1 if s.hand == "r" else 2) for s in canon.played()}
    for prof, beats in rows:
        for seed in seeds:
            p = perform.perform(canon, entry.id, prof, beats, seed, expect=entry.expect)
            inp = {"notes": p.input["notes"]}
            for k in ("beats", "downbeats", "pedals"):
                if k in p.input:
                    inp[k] = p.input[k]
            row = {"id": f"{entry.id}|{prof}|{beats}|s{seed}" + (f"|tex:{texture}" if texture else ""), "ref": entry.id,
                   "set": entry.set, "book": entry.book, "input": inp,
                   "hands": [hand.get(t["ref"], 0) if t["ref"] is not None else 0 for t in p.truth]}
            if texture:
                row["texture"] = texture
            yield row


def piece(entry, texture=None) -> dict:
    ref = corpus.reference_for(entry, texture)
    if ref.staves < 2 or "notation.hand.accuracy" in (entry.expect.get("skip_metrics") or ()):
        return None
    qpm = float(entry.expect.get("tempo_qpm") or ref.effective_qpm or 100)
    notes = sorted(ref.played(), key=lambda s: (s.onset_q, s.midi, s.id))
    rows = [[round(float(s.onset_q), 6), round(float(s.onset_q) * 60.0 / qpm, 6), s.midi, 1 if s.hand == "r" else 2]
            for s in notes]
    out = {"id": entry.id, "set": entry.set, "book": entry.book, "holdout": bool(entry.holdout), "qpm": qpm, "notes": rows}
    if texture:
        out["texture"] = texture
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=DEFAULT_OUT)
    ap.add_argument("--perfs", help="write the training performances (JSONL) instead of the truth")
    ap.add_argument("--seeds", default="201")
    ap.add_argument("--no-textures", action="store_true", help="--perfs: the references as written only")
    args = ap.parse_args()
    if args.perfs:
        seeds = [int(x) for x in args.seeds.split(",") if x]
        n = 0
        os.makedirs(os.path.dirname(os.path.abspath(args.perfs)), exist_ok=True)
        with open(args.perfs, "w", encoding="utf-8", newline="\n") as h:
            for entry in references():
                if entry.holdout:
                    continue
                for row in perf_rows(entry, PERF_ROWS, seeds):
                    h.write(json.dumps(row, sort_keys=True, separators=(",", ":")) + "\n")
                    n += 1
                if args.no_textures or not textured(entry):
                    continue
                for texture in TEXTURES:
                    for row in perf_rows(entry, TEXTURE_PERF_ROWS, seeds, texture):
                        h.write(json.dumps(row, sort_keys=True, separators=(",", ":")) + "\n")
                        n += 1
        print(f"wrote {n} performances to {args.perfs}")
        return 0
    pieces = []
    for entry in references():
        p = piece(entry)
        if p and p["notes"]:
            pieces.append(p)
            if textured(entry):
                pieces.extend(t for t in (piece(entry, texture) for texture in TEXTURES) if t and t["notes"])
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    util.dump_json({"schema": "ppp.hands-truth/1", "pieces": pieces}, args.out)
    plain = [p for p in pieces if not p.get("texture")]
    n_hold = sum(p["holdout"] for p in plain)
    print(f"wrote {util.rel(args.out) if os.path.abspath(args.out).startswith(util.repo_root()) else args.out}: "
          f"{len(plain)} references ({len(plain) - n_hold} training, {n_hold} hold-out), "
          f"{sum(len(p['notes']) for p in plain)} key presses; {len(pieces) - len(plain)} textured, "
          f"{sum(len(p['notes']) for p in pieces if p.get('texture'))} key presses")
    return 0


if __name__ == "__main__":
    sys.exit(main())
