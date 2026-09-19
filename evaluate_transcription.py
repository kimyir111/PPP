#!/usr/bin/env python3
"""Measure note and pedal accuracy against a ground-truth transcription.

Inputs may be a helper JSON result (an object with ``notes``/``pedals``), a
plain JSON note list, or a MIDI file.  The metrics intentionally stay small
and dependency-free so they can run in CI and on the local helper machine.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import sys
from typing import Any, Dict, Iterable, List, Sequence, Tuple

import midi_notes


def _finite(value: Any, default: float = 0.0) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return default
    return number if math.isfinite(number) else default


def load_events(path: str) -> Dict[str, List[Dict[str, Any]]]:
    if os.path.splitext(path)[1].lower() in {".mid", ".midi"}:
        data = midi_notes.read_notes(path)
    else:
        with open(path, "r", encoding="utf-8") as handle:
            data = json.load(handle)
    if isinstance(data, list):
        data = {"notes": data}
    if not isinstance(data, dict):
        raise ValueError(f"{path}: expected a JSON object/list or MIDI file")

    notes = []
    for raw in data.get("notes", []):
        if not isinstance(raw, dict):
            continue
        midi = int(raw.get("midi", raw.get("pitch", -1)))
        on = _finite(raw.get("on", raw.get("start", raw.get("startTime", 0))))
        off = _finite(raw.get("off", raw.get("end", raw.get("endTime", on))), on)
        if 0 <= midi <= 127 and off > on:
            notes.append({"midi": midi, "on": max(0.0, on), "off": off})

    pedals = []
    for raw in data.get("pedals", []):
        if not isinstance(raw, dict):
            continue
        on = _finite(raw.get("on", raw.get("start", 0)))
        off = _finite(raw.get("off", raw.get("end", on)), on)
        if off > on:
            pedals.append({"on": max(0.0, on), "off": off})
    return {
        "notes": sorted(notes, key=lambda n: (n["on"], n["midi"])),
        "pedals": sorted(pedals, key=lambda p: p["on"]),
    }


def _note_matches(reference: Sequence[Dict[str, Any]], prediction: Sequence[Dict[str, Any]],
                  onset_tolerance: float) -> List[Tuple[int, int, float]]:
    candidates = []
    for ri, ref in enumerate(reference):
        for pi, pred in enumerate(prediction):
            if ref["midi"] != pred["midi"]:
                continue
            error = abs(ref["on"] - pred["on"])
            if error <= onset_tolerance:
                candidates.append((error, ri, pi))
    used_ref, used_pred, matches = set(), set(), []
    for error, ri, pi in sorted(candidates):
        if ri in used_ref or pi in used_pred:
            continue
        used_ref.add(ri)
        used_pred.add(pi)
        matches.append((ri, pi, error))
    return matches


def _f1(matches: int, predicted: int, reference: int) -> Tuple[float, float, float]:
    precision = matches / predicted if predicted else (1.0 if not reference else 0.0)
    recall = matches / reference if reference else (1.0 if not predicted else 0.0)
    f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
    return precision, recall, f1


def _interval_length(intervals: Iterable[Dict[str, Any]]) -> float:
    merged: List[List[float]] = []
    for event in sorted(intervals, key=lambda p: p["on"]):
        start, end = event["on"], event["off"]
        if merged and start <= merged[-1][1]:
            merged[-1][1] = max(merged[-1][1], end)
        else:
            merged.append([start, end])
    return sum(end - start for start, end in merged)


def _intersection_length(left: Sequence[Dict[str, Any]], right: Sequence[Dict[str, Any]]) -> float:
    a = sorted(left, key=lambda p: p["on"])
    b = sorted(right, key=lambda p: p["on"])
    i = j = 0
    total = 0.0
    while i < len(a) and j < len(b):
        total += max(0.0, min(a[i]["off"], b[j]["off"]) - max(a[i]["on"], b[j]["on"]))
        if a[i]["off"] <= b[j]["off"]:
            i += 1
        else:
            j += 1
    return total


def evaluate(reference: Dict[str, Any], prediction: Dict[str, Any], onset_tolerance: float = 0.05,
             offset_tolerance: float = 0.05, offset_ratio: float = 0.2) -> Dict[str, Any]:
    ref_notes = reference.get("notes", [])
    pred_notes = prediction.get("notes", [])
    matches = _note_matches(ref_notes, pred_notes, onset_tolerance)
    precision, recall, note_f1 = _f1(len(matches), len(pred_notes), len(ref_notes))

    offset_matches = 0
    velocity_free_errors = []
    for ri, pi, onset_error in matches:
        ref, pred = ref_notes[ri], pred_notes[pi]
        allowed = max(offset_tolerance, (ref["off"] - ref["on"]) * offset_ratio)
        if abs(ref["off"] - pred["off"]) <= allowed:
            offset_matches += 1
        velocity_free_errors.append(onset_error)
    offset_precision, offset_recall, offset_f1 = _f1(offset_matches, len(pred_notes), len(ref_notes))

    ref_pedals = reference.get("pedals", [])
    pred_pedals = prediction.get("pedals", [])
    pedal_intersection = _intersection_length(ref_pedals, pred_pedals)
    pedal_union = _interval_length(ref_pedals) + _interval_length(pred_pedals) - pedal_intersection

    return {
        "reference_notes": len(ref_notes),
        "predicted_notes": len(pred_notes),
        "matched_notes": len(matches),
        "precision": round(precision, 6),
        "recall": round(recall, 6),
        "f1": round(note_f1, 6),
        "offset_f1": round(offset_f1, 6),
        "mean_onset_error_ms": round(
            sum(velocity_free_errors) / len(velocity_free_errors) * 1000, 3
        ) if velocity_free_errors else None,
        "pedal_iou": round(pedal_intersection / pedal_union, 6) if pedal_union else None,
        "onset_tolerance_ms": round(onset_tolerance * 1000, 3),
    }


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Evaluate a PPP transcription against ground truth")
    parser.add_argument("reference", help="ground-truth JSON or MIDI")
    parser.add_argument("prediction", help="predicted JSON or MIDI")
    parser.add_argument("--onset-ms", type=float, default=50.0, help="onset matching tolerance (default: 50)")
    parser.add_argument("--offset-ms", type=float, default=50.0, help="minimum offset tolerance (default: 50)")
    parser.add_argument("--offset-ratio", type=float, default=0.2, help="offset tolerance as reference duration ratio")
    args = parser.parse_args(argv)
    result = evaluate(
        load_events(args.reference), load_events(args.prediction),
        onset_tolerance=max(0.0, args.onset_ms / 1000),
        offset_tolerance=max(0.0, args.offset_ms / 1000),
        offset_ratio=max(0.0, args.offset_ratio),
    )
    json.dump(result, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
