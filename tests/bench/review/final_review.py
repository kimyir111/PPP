#!/usr/bin/env python3
"""G0 FINAL independent review (2026-09-22): new adversarial mutations the fixer did not plan for.

Not part of `npm run test:bench`; CI runs it nightly. It never changes a benchmark criterion or an
expectation of tests/bench/review/adversarial.py. Each mutation below is a regression a user
would see or hear. At the review 7 of 10 passed every metric gate (G00 §19); after the fix (§20)
each must be a core REGRESSION naming its own metric, and golden must not call it formatting.
Exit 1 while any mutation is not caught that way.

    python tests/bench/review/final_review.py                 # every mutation (~5 min), exit 1 on a gap
    python tests/bench/review/final_review.py --only NAME     # one mutation
    python tests/bench/review/final_oracle.py                 # (separate script) correct outputs engraved differently

Outputs: tests/bench/out/final-review/ (git-ignored). audio-score.js is never modified.
Findings: docs/GOALS/G00_QUALITY_FOUNDATION.md, "Final Independent Review".
"""

from __future__ import annotations

import argparse
import contextlib
import io
import os
import sys
import types
from collections import Counter

BENCH = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BENCH)

from pppbench import compare, golden, mutation, private, runner, stages, suite as suite_mod, sut as sut_mod, util  # noqa: E402

util.setup_stdio()
OUT = os.path.join(BENCH, "out", "final-review")

# G1: the MusicXML is written from the ScoreGraph since the flip (G01 §15.3); each writer defect below is made
# in buildGraph with the same edit as the gate's mutation (pppbench/mutation.py), so it says the same thing.
M = mutation

# name -> (category, what the user gets, [(find, replace), ...])
# After the fix (G00 §20) each must be a core REGRESSION that names TARGET[name] among its failed
# metrics, and golden must never label it SERIALIZATION_ONLY (it changes what the app draws or plays).
TARGET = {
    "FINAL-DOTS-DROPPED": "notation.note_shape.consistency",
    "FINAL-TEMPO-HALVED-MIDWAY": "struct.tempo.timeline_accuracy",
    "FINAL-METRE-TAIL": "struct.time_sig.timeline_accuracy",
    "FINAL-KEY-TAIL": "struct.key.timeline_accuracy",
    "FINAL-BASS-STAFF-TREBLE-CLEF": "read.ledger_lines.heavy_rate",
    "FINAL-BAR-NUMBERS-RESTART": "struct.measure_numbers.app_onset_accuracy",
    "FINAL-ACCIDENTAL-ON-EVERY-NOTE": "notation.accidentals.courtesy_per_100",
    "FINAL-TRAILING-RESTS-SHORT": "read.bar_completeness",
    "FINAL-PEDAL-HELD-TO-BARLINE": "notation.pedal.f1",
    "FINAL-TOP-REGISTER-OCTAVE-DOWN": "notes.identity.f1",
}
MUTATIONS = {
    "FINAL-DOTS-DROPPED": (
        "rhythm / notation",
        "every dotted note is printed without its dot (the app draws glyphs from <type>/<dot>); playback unchanged",
        M.DOTS_DROPPED_EDITS),
    "FINAL-TEMPO-HALVED-MIDWAY": (
        "tempo",
        "a printed and played tempo change to half speed at the middle bar (the app's tempoMap plays every mark)",
        M.TEMPO_HALVED_MIDWAY_EDITS),
    "FINAL-METRE-TAIL": (
        "meter / partial corruption",
        "from two thirds of the way in, a time-signature change to a wrong metre of the same bar length (3/4->6/8, 4/4->8/8)",
        M.METRE_TAIL_EDITS),
    "FINAL-KEY-TAIL": (
        "key / partial corruption",
        "from two thirds of the way in, a key-signature change one fifth away; accidentals follow the printed key, "
        "so every pitch still reads right, under the wrong key signature",
        M.KEY_TAIL_EDITS),
    "FINAL-BASS-STAFF-TREBLE-CLEF": (
        "hand / staff notation",
        "the left-hand staff is written in treble clef (pitches right, the left hand sits on ledger lines)",
        M.BASS_STAFF_TREBLE_CLEF_EDITS),
    "FINAL-BAR-NUMBERS-RESTART": (
        "structural (app parity)",
        "bar numbers restart every 4 bars (1 2 3 4 1 2 ...); the app keys bars by number, so bars 1, 5, 9 ... collapse",
        M.BAR_NUMBERS_RESTART_EDITS),
    "FINAL-ACCIDENTAL-ON-EVERY-NOTE": (
        "notation / readability",
        "a sharp, flat or natural is printed on every non-tied note (pitch right, page cluttered)",
        M.ACCIDENTAL_ON_EVERY_NOTE_EDITS),
    "FINAL-TRAILING-RESTS-SHORT": (
        "rhythm / structure",
        "a trailing rest of two beats or more loses its last beat: that staff's bar no longer adds up",
        M.TRAILING_RESTS_SHORT_EDITS),
    "FINAL-PEDAL-HELD-TO-BARLINE": (
        "articulation / pedal (control)",
        "every pedal release is written at the end of its bar instead of where the foot came up",
        [("""      pedals.push({ tick: Math.min(bars * bar - 1, h[1]), type: 'stop' });""",
          """      pedals.push({ tick: Math.min(bars * bar - 1, Math.ceil(h[1] / bar) * bar - 1), type: 'stop' });""")]),
    "FINAL-TOP-REGISTER-OCTAVE-DOWN": (
        "pitch / subgroup-only",
        "notes from A6 (MIDI 93) up are written an octave low (a range clamp); only high-register pieces change",
        [(M.SG_SPELL, "            const sp = spell(n.midi >= 93 ? n.midi - 12 : n.midi, table), k = sp.step + sp.octave;")]),
}


def write_mutant(name: str) -> str:
    """A copy of the SUT snapshot (audio-score.js + scoregraph/, pppbench/sut.py) with the edits applied."""
    try:
        return sut_mod.write_mutant_dir(os.path.join(OUT, "mutants", name), {sut_mod.ENTRY: MUTATIONS[name][2]}, label=name)
    except sut_mod.SutError as exc:
        raise RuntimeError(str(exc)) from exc


def gate(name: str, sut: str, tag: str):
    s = suite_mod.load_suite(name)
    out = os.path.join(OUT, tag, name)
    r = runner.run_suite(s, audio_score=sut, out_dir=out, write_cases=False, quiet=True)
    base = compare.load_baseline(s)
    v = compare.compare(r["results"], base, s.get("gate") or {})
    agg, bagg = r["results"]["aggregates"]["all"], base["aggregates"]["all"]
    d = {k: agg[k]["mean"] - bagg[k]["mean"] for k in ("sqi", "usable") if k in agg and k in bagg}
    return v, d, util.sha256_file(os.path.join(out, "results.json"))


def golden_labels(sut: str) -> str:
    buf = io.StringIO()
    try:
        with contextlib.redirect_stdout(buf):
            golden.run_golden(audio_score=sut)
    except Exception as exc:
        return f"CRASH {type(exc).__name__}: {exc}"
    labels = Counter()
    for ln in buf.getvalue().splitlines():
        parts = ln.split()
        if len(parts) >= 2 and len(parts[0]) == 3 and parts[0][0] == "G":
            labels[parts[1]] += 1
    return ", ".join(f"{v} {k}" for k, v in sorted(labels.items()))


def replay(sut: str, tag: str) -> str:
    s = suite_mod.load_suite("replay-public")
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        rc = private.run_private(s, types.SimpleNamespace(audio_score=sut, out=os.path.join(OUT, tag, "replay-public")))
    return {0: "PASS", 1: "REGRESSION"}.get(rc, f"exit {rc}")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--only")
    a = ap.parse_args()
    base_sha = {}
    for s in ("core", "smoke", "robust"):
        _, _, base_sha[s] = gate(s, stages.default_audio_score(), "unmutated")
    rows = []
    for name, (cat, what, _) in MUTATIONS.items():
        if a.only and a.only != name:
            continue
        sut = write_mutant(name)
        res = {}
        for s in ("core", "smoke", "robust"):
            v, d, sha = gate(s, sut, name)
            res[s] = {"status": v.status, "failed": v.failed_metrics, "d_sqi": d.get("sqi"), "d_usable": d.get("usable"),
                      "identical": sha == base_sha[s], "semantic_changes": v.semantic_changes,
                      "warnings": len(v.warnings), "improvements": len(v.improvements)}
        res["golden"] = golden_labels(sut)
        res["replay"] = replay(sut, name)
        rows.append({"mutation": name, "category": cat, "user_sees": what, **res})
        c = res["core"]
        print(f"{name} [{cat}]\n  core {c['status']} (Δdiag {c['d_sqi']:+.3f}, Δusable {c['d_usable']:+.4f}, "
              f"failed={','.join(c['failed']) or '-'}; semantic changes {c['semantic_changes']}"
              + ("; results.json byte-identical to unmutated" if c["identical"] else "") + ")"
              f"\n  smoke {res['smoke']['status']} · robust {res['robust']['status']}"
              f" (failed={','.join(res['robust']['failed'][:6]) or '-'}) · golden {res['golden']} · replay {res['replay']}")
    gaps = []
    print()
    for r in rows:
        named = TARGET[r["mutation"]] in r["core"]["failed"]
        r["ok"] = (r["core"]["status"] == "REGRESSION" and named and "SERIALIZATION_ONLY" not in r["golden"]
                   and "CRASH" not in r["golden"])
        print(f"{'OK ' if r['ok'] else 'GAP'}  {r['mutation']}: core {r['core']['status']}, target "
              f"{TARGET[r['mutation']]} {'named' if named else 'NOT named'}; golden {r['golden'] or 'none'}")
        if not r["ok"]:
            gaps.append(r["mutation"])
    util.dump_json({"mutations": rows}, os.path.join(OUT, "final-review-report.json"))
    print(f"\nfinal review: {len(rows) - len(gaps)} of {len(rows)} mutations caught on their own metric; "
          f"gaps: {', '.join(gaps) or 'none'}")
    return 1 if gaps else 0


if __name__ == "__main__":
    sys.exit(main())
