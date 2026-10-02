"""Does the humanized catalogue reproduce the real transcription's statistics? (G10a-0, docs/GOALS/G10 section 7.3)

``flat_input`` turns a humanized performance (the truth is known) into the input ``node/perf-stats.js`` reads,
``extract`` runs the extractor on several pieces pooled, ``BANDS`` are the acceptance bands of section 7.3 and
``check`` compares an extraction with the calibration file's targets.
"""

from __future__ import annotations

import json
import os
import subprocess
import tempfile
from typing import Any, Dict, List, Tuple

from . import humanize, util

PERF_STATS = os.path.join(util.bench_root(), "node", "perf-stats.js")

def rest_share(canon) -> float:
    """Share of notes followed, in their own hand, by a written silence (the next onset of the hand lies after the
    note's written end). The humanizer articulates those notes (a different release rule), the real transcription's
    statistics cannot separate them, so the calibration pieces have almost none."""
    n = rests = 0
    for hand in ("r", "l"):
        onsets = sorted({s.onset_q for s in canon.played() if s.hand == hand})
        nxt = {q: onsets[i + 1] for i, q in enumerate(onsets[:-1])}
        for s in canon.played():
            if s.hand == hand and s.onset_q in nxt:
                n += 1
                rests += nxt[s.onset_q] > s.onset_q + s.dur_q
    return rests / max(1, n)


def attack_rate(flat: Dict[str, Any]) -> float:
    """Attacks per second of a flat input: onsets within 50 ms of an attack's first onset are one attack, as in
    perf-stats' ``chords.attacks``."""
    ons = sorted(x["on"] for x in flat["notes"])
    starts: List[float] = []
    for t in ons:
        if not starts or t - starts[-1] > 0.05:
            starts.append(t)
    return len(starts) / max(1e-9, ons[-1] - ons[0])


def select_references(candidates, target_rate: float, n: int = 20) -> List[str]:
    """How CALIBRATION_REFERENCES was chosen. ``candidates`` is [(id, canon, flat input of its humanized onsets)], the
    steady (one tempo) pieces of the core suite with at least 100 notes; pieces with more than 2 % of their notes
    before a written silence are left out, and the ``n`` whose attacks per second are closest to the real
    transcription's (5.1) are taken, ties by id. The rule uses the written score, the onsets and the target rate only:
    never a release, never a result."""
    rows = []
    for rid, canon, flat in candidates:
        if rest_share(canon) <= 0.02:
            rows.append((abs(attack_rate(flat) - target_rate) / target_rate, rid))
    return [rid for _, rid in sorted(rows)[:n]]


# The twenty references the calibration test humanizes, chosen once by select_references from the steady (one tempo)
# non-micro pieces of the core suite against calibration/cover-of-2026-10.json (5.1 attacks/s).
CALIBRATION_REFERENCES: List[str] = [
    "method/czerny599/027", "method/czerny599/026", "method/czerny599/022", "method/czerny599/040",
    "method/burgmuller25/023", "method/beyer/052", "method/beyer/059", "method/czerny599/048", "method/czerny599/036",
    "method/hanon/020", "method/hanon/002", "method/hanon/007", "method/hanon/004", "method/czerny599/034",
    "method/czerny599/023", "method/hanon/009", "method/hanon/005", "method/hanon/008", "method/czerny599/037",
    "method/czerny599/024"]


def humanize_pieces(profile: str, ids: List[str], seed: int = 1) -> List[Dict[str, Any]]:
    """The flat inputs of ``ids`` humanized with ``profile`` (beats none: the notes do not depend on them)."""
    from . import corpus, perform
    refs = corpus.by_id(corpus.load_corpus())
    out = []
    for rid in ids:
        canon = corpus.read_reference(refs[rid])
        out.append(flat_input(canon, perform.perform(canon, rid, profile, "none", seed, expect=refs[rid].expect)))
    return out


def flat_input(canon, perf) -> Dict[str, Any]:
    """{notes: [{on, off, midi, vel, hand, w}], anchors: [{w, s}]} of one humanized performance; ``w`` (whole
    notes) is the written position of the note the performer meant, the anchors map bar starts to seconds."""
    by_id = {s.id: s for s in canon.sounding}
    notes = []
    for n, t in zip(perf.input["notes"], perf.truth):
        s = by_id.get(t["ref"]) if t["ref"] is not None else None
        if s is None:
            continue                                   # a ghost the overlay added: no written position
        notes.append({"on": n["on"], "off": n["off"], "midi": n["midi"], "vel": n["vel"],
                      "hand": "RH" if s.hand == "r" else "LH", "w": float(s.onset_q) / 4.0})
    bars = [m for m in canon.measures if not m.implicit]
    anchors = [{"w": float(m.start_q) / 4.0, "s": perf.timemap.sec(m.start_q), "kind": "bar"} for m in bars]
    last = bars[-1]
    anchors.append({"w": float(last.start_q + last.len_q) / 4.0, "s": perf.timemap.sec(last.start_q + last.len_q), "kind": "bar"})
    return {"notes": notes, "anchors": anchors}


def extract(flats: List[Dict[str, Any]], frame: float) -> Dict[str, Any]:
    with tempfile.TemporaryDirectory(prefix="pppbench-cal-") as tmp:
        path = os.path.join(tmp, "in.json")
        util.dump_json({"pieces": flats}, path)
        res = subprocess.run(["node", PERF_STATS, path, "--frame", repr(frame)], capture_output=True, text=True, encoding="utf-8")
    if res.returncode != 0:
        raise RuntimeError("perf-stats failed: " + res.stderr.strip())
    return json.loads(res.stdout)


def _get(d: Dict[str, Any], path: str):
    for k in path.split("."):
        d = d[k]
    return d


# (statistic path, kind, band) - the bands of docs/GOALS/G10 section 7.3
#   rel: |got - target| <= max(band * |target|, REL_FLOOR)      abs: |got - target| <= band      max: got <= band      (shares in points as fractions,
#   milliseconds as milliseconds, velocity in velocity units)
REL_FLOOR = 0.06   # a ratio is a whole number of frames over a few frames: +-15 % of 0.3 is less than one step

BANDS: List[Tuple[str, str, float]] = [
    ("tempo.barDurCV", "max", 0.01),
    ("releasesFreeByHand.RH.ratioP10", "rel", 0.15), ("releasesFreeByHand.RH.ratioP25", "rel", 0.15),
    ("releasesFreeByHand.RH.ratioMedian", "rel", 0.15), ("releasesFreeByHand.RH.ratioP75", "rel", 0.15),
    ("releasesFreeByHand.RH.ratioP90", "rel", 0.15),
    ("releasesFreeByHand.LH.ratioP10", "rel", 0.15), ("releasesFreeByHand.LH.ratioP25", "rel", 0.15),
    ("releasesFreeByHand.LH.ratioMedian", "rel", 0.15), ("releasesFreeByHand.LH.ratioP75", "rel", 0.15),
    ("releasesFreeByHand.LH.ratioP90", "rel", 0.15),
    ("releasesFreeByHand.RH.releasedBeforeNextOnset", "abs", 0.05), ("releasesFreeByHand.LH.releasedBeforeNextOnset", "abs", 0.05),
    ("releasesFreeByHand.RH.gapMsMedian", "abs", 35.0), ("releasesFreeByHand.LH.gapMsMedian", "abs", 35.0),
    ("chords.spreadOneFrame", "abs", 0.10),
    ("onsetResidualVsWrittenMs.sd", "abs", 8.0),
    ("velocity.mean", "abs", 3.0), ("velocity.sd", "abs", 2.0),
    ("resolution.onsetsOnFrames", "abs", 0.02), ("resolution.offsetsOnFrames", "abs", 0.02),
]


def check(got: Dict[str, Any], target: Dict[str, Any]) -> List[Dict[str, Any]]:
    """One row per band: the target, the measured value and whether it is inside."""
    rows = []
    for path, kind, band in BANDS:
        want, have = _get(target, path), _get(got, path)
        if kind == "max":                                  # a ceiling (the cover's tempo is steady: bar CV <= 1 %)
            rows.append({"stat": path, "target": want, "got": have, "band": band, "ok": have <= band})
            continue
        tol = max(band * abs(want), REL_FLOOR) if kind == "rel" else band
        rows.append({"stat": path, "target": want, "got": have, "band": tol, "ok": abs(have - want) <= tol})
    return rows
