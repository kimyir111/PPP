"""One case: SUT output -> metrics (docs/GOALS/G00 §3.3, §8)."""

from __future__ import annotations

from typing import Any, Dict, Optional, Tuple

from . import align, musicxml
from .metrics import composite, notation, notes, readability, structure
from .timemap import PredTime, StatsShapeError

_ref_read_cache: Dict[int, Dict[str, Optional[float]]] = {}


class CaseError(Exception):
    def __init__(self, code: str, message: str = ""):
        super().__init__(message or code)
        self.code = code


def ref_readability(ref) -> Dict[str, Optional[float]]:
    key = id(ref)
    if key not in _ref_read_cache:
        _ref_read_cache[key] = readability.readability(ref)
    return _ref_read_cache[key]


def predicted_summary(pred, stats: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    st = stats or {}
    time = [int(st["beatsPerBar"]), int(st.get("beatType") or 4)] if st.get("beatsPerBar") else list(pred.primary_time())
    return {"time": time, "key": {"fifths": pred.measures[0].fifths, "mode": pred.measures[0].mode},
            "tempo_effective": pred.effective_qpm, "tempo_printed": pred.printed_qpm,
            "bars": len(pred.measures), "beatSource": st.get("beatSource")}


def evaluate_timed(ref, perf, row: Dict[str, Any], *, window_s: float = 0.30,
                   skip_metrics=()) -> Tuple[Dict[str, Optional[float]], Dict[str, int], Dict[str, Any]]:
    """Returns (metrics, counts, predicted). Raises CaseError."""
    if not row.get("ok"):
        raise CaseError("NOTATE_" + str(row.get("code") or "exception").upper().replace("-", "_"), row.get("error") or "")
    try:
        pred = musicxml.read_score(row["xml"])
    except musicxml.ReaderError as exc:
        raise CaseError("PRED_READER", str(exc)) from exc
    stats = row.get("stats") or {}
    try:
        pt = PredTime(pred, stats)
    except StatsShapeError as exc:
        raise CaseError("STATS_SHAPE", str(exc)) from exc
    tm = perf.timemap
    ref_played = ref.played()
    pred_played = pred.played()
    ref_t = [(s.id, s.midi, tm.sec(s.onset_q)) for s in ref_played]
    pred_t = [(s.id, s.midi, pt.sec(s.measure, s.pos_q)) for s in pred_played]
    pairs = align.align_timed(ref_t, pred_t, window_s)
    inp = perf.input["notes"]
    input_pairs = align.align_timed([(i, n["midi"], n["on"]) for i, n in enumerate(inp)], pred_t, window_s)
    ctx = {"ref": ref, "pred": pred, "stats": stats, "perf": perf, "expected": perf.expected, "kind": "T",
           "pairs": pairs, "input_pairs": input_pairs, "n_input": len(inp), "skip_metrics": skip_metrics,
           "ref_readability": ref_readability(ref)}
    metrics: Dict[str, Optional[float]] = {}
    metrics.update(structure.compute(ctx))
    metrics.update(notes.compute(ctx))
    metrics.update(notation.compute(ctx))
    metrics.update(readability.compute(ctx))
    for k in skip_metrics:
        if k in metrics:
            metrics[k] = None
    metrics["sqi"] = composite.sqi(metrics)
    counts = {"ref": len(ref_played), "pred": len(pred_played), "pairs": len(pairs), "input": len(inp)}
    return metrics, counts, predicted_summary(pred, stats)


def evaluate_symbolic(ref, pred, expected: Dict[str, Any], *, skip_metrics=()):
    """Prediction files and OMR output: no stats, bar-level alignment."""
    sa = align.align_symbolic(ref, pred)
    ctx = {"ref": ref, "pred": pred, "stats": None, "perf": None, "expected": expected, "kind": "S",
           "pairs": sa.pairs, "skip_metrics": skip_metrics, "ref_readability": ref_readability(ref)}
    metrics: Dict[str, Optional[float]] = {}
    metrics.update(structure.compute(ctx))
    metrics.update(notes.compute(ctx))
    metrics.update(notation.compute(ctx))
    metrics.update(readability.compute(ctx))
    metrics["omr.measure_alignment_rate"] = len(sa.measure_pairs) / sa.ref_measures if sa.ref_measures else None
    metrics["sqi"] = composite.sqi_symbolic(metrics)
    counts = {"ref": len(ref.played()), "pred": len(pred.played()), "pairs": len(sa.pairs)}
    return metrics, counts, predicted_summary(pred, None), sa
