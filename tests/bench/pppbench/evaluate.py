"""One case: SUT output -> metrics (docs/GOALS/G00 §3.3, §8, §17)."""

from __future__ import annotations

from typing import Any, Dict, Optional, Tuple

from . import align, musicxml, semantic
from .metrics import composite, critical, notation, notation_quality, notes, pedal, readability, structure
from .timemap import PredTime, StatsShapeError

# id(ref) -> (ref, its readability). The entry holds the reference itself: an id is only unique while its
# object lives, and a reference read afresh for each case (private.py, the replay fixtures) is freed after
# the case, so a later reference could take its id and be handed its readability (G03 §24 record).
_ref_read_cache: Dict[int, Tuple[Any, Dict[str, Optional[float]]]] = {}


class CaseError(Exception):
    def __init__(self, code: str, message: str = ""):
        super().__init__(message or code)
        self.code = code


_ref_nq_cache: Dict[int, Tuple[Any, Any]] = {}


def ref_notation_quality(ref):
    """The reference's nq.* file statistics, cached like its readability (the entry holds the reference)."""
    key = id(ref)
    hit = _ref_nq_cache.get(key)
    if hit is None or hit[0] is not ref:
        hit = _ref_nq_cache[key] = (ref, notation_quality.file_stats(ref))
    return hit[1]


def ref_readability(ref) -> Dict[str, Optional[float]]:
    key = id(ref)
    hit = _ref_read_cache.get(key)
    if hit is None or hit[0] is not ref:
        hit = _ref_read_cache[key] = (ref, readability.readability(ref))
    return hit[1]


def predicted_summary(pred, stats: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """What the score says, read from the MusicXML (stats only for the beat source)."""
    st = stats or {}
    return {"time": list(pred.primary_time()), "key": {"fifths": pred.measures[0].fifths, "mode": pred.measures[0].mode},
            "tempo_effective": pred.effective_qpm, "tempo_printed": pred.printed_qpm,
            "bars": len(pred.measures), "beatSource": st.get("beatSource"), "pedal_marks": len(pred.pedals)}


# A metric the registry skips takes the metrics that judge the same truth with it: a key signature the
# registry cannot trust is not trusted bar by bar either (§19 F1).
SKIP_WITH = {"struct.key.fifths_exact": ("struct.key.timeline_accuracy",)}


def _finish(metrics: Dict[str, Optional[float]], skip_metrics, symbolic: bool) -> None:
    for k in skip_metrics:
        for key in (k, k + "_ref") + SKIP_WITH.get(k, ()):
            if key in metrics:
                metrics[key] = None
    gate_input = dict(metrics)
    if symbolic and gate_input.get("notes.identity.f1") is None:
        gate_input["notes.identity.f1"] = gate_input.get("notes.symbolic.f1")
    metrics.update(critical.gates(gate_input))
    metrics["sqi"] = composite.sqi_symbolic(metrics) if symbolic else composite.sqi(metrics)


INPUT_PEDALS = object()   # truth_pedals default: the performer's pedal is the input's (synthetic cases)


def evaluate_timed(ref, perf, row: Dict[str, Any], *, window_s: float = 0.30,
                   skip_metrics=(), truth_pedals=INPUT_PEDALS) -> Tuple[Dict[str, Optional[float]], Dict[str, int], Dict[str, Any]]:
    """Returns (metrics, counts, predicted). Raises CaseError.

    ``truth_pedals``: the performance's own pedal when the input's is a guess (replay: a list, or None
    when unknown); see metrics/pedal.py."""
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
           "ref_readability": ref_readability(ref), "pred_time": pt, "ref_nq": ref_notation_quality(ref)}
    if truth_pedals is not INPUT_PEDALS:
        ctx["truth_pedals"] = truth_pedals
    metrics: Dict[str, Optional[float]] = {}
    metrics.update(structure.compute(ctx))
    metrics.update(notes.compute(ctx))
    metrics.update(notation.compute(ctx))
    metrics.update(readability.compute(ctx))
    metrics.update(notation_quality.compute(ctx))   # G03 §20.3, informational
    metrics.update(pedal.compute(ctx))
    _finish(metrics, skip_metrics, symbolic=False)
    counts = {"ref": len(ref_played), "pred": len(pred_played), "pairs": len(pairs), "input": len(inp)}
    predicted = predicted_summary(pred, stats)
    predicted["semantic"] = semantic.digest(pred)
    return metrics, counts, predicted


def evaluate_symbolic(ref, pred, expected: Dict[str, Any], *, skip_metrics=()):
    """Prediction files and OMR output: no stats, bar-level alignment."""
    sa = align.align_symbolic(ref, pred)
    ctx = {"ref": ref, "pred": pred, "stats": None, "perf": None, "expected": expected, "kind": "S",
           "pairs": sa.pairs, "skip_metrics": skip_metrics, "ref_readability": ref_readability(ref),
           "ref_nq": ref_notation_quality(ref)}
    metrics: Dict[str, Optional[float]] = {}
    metrics.update(structure.compute(ctx))
    metrics.update(notes.compute(ctx))
    metrics.update(notation.compute(ctx))
    metrics.update(readability.compute(ctx))
    metrics.update(notation_quality.compute(ctx))   # G03 §20.3, informational
    metrics["omr.measure_alignment_rate"] = len(sa.measure_pairs) / sa.ref_measures if sa.ref_measures else None
    _finish(metrics, skip_metrics, symbolic=True)
    counts = {"ref": len(ref.played()), "pred": len(pred.played()), "pairs": len(sa.pairs)}
    predicted = predicted_summary(pred, None)
    predicted["semantic"] = semantic.digest(pred)
    return metrics, counts, predicted, sa
