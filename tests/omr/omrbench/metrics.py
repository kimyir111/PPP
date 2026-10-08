"""The omr.* metrics of omr-live-2 (docs/GOALS/G12_OMR.md section 10; A0).

A read (an engine's MusicXML, or the Score the app made from a page) is judged against the exact truth it was engraved from.

  bars       the read's bars are aligned to the truth's by dynamic programming on note sets (a pair counts at similarity >= 0.2,
             the G0 ``omr.measure_alignment_rate`` rule); a bar is EXACTLY RIGHT when its pitches, onsets, durations and rests
             all equal the truth's. An output bar is WRONG unless it is aligned to a truth bar it reproduces exactly.
  notes      matched on (pitch, onset) inside aligned bars: precision, recall, F1 over all staves (``omr.note_f1``) and over the
             part the app plays (``omr.played_f1``: the app's hand rule, the first part with two staves else the LAST part)
  structure  bar count, parts (``omr.parts_ok``: the staves per part equal the truth's; ``omr.parts_fragmented``: several
             parts of one staff each, the issue 11 shape), time signature, key
  flags      a flag rule names output bars it suspects; recall and precision against the wrong bars. Rules are a registry
             (``FLAG_RULES``: ``app`` = the app's Import.validate per bar, ``voice`` = any voice that does not fill the bar);
             G12-3's flags and the app's own report come in through ``external_flags``

Standard library only. Every metric is proven by a planted defect in tests/bench/unit/test_omr2_metrics.py.
"""

from __future__ import annotations

from collections import Counter, defaultdict
from dataclasses import dataclass, field
from fractions import Fraction as F
from typing import Callable, Dict, Iterable, List, Optional, Tuple

from .xmlscore import Bar, Note, PartInfo, Score

ALIGN_MIN = 0.2


# --------------------------------------------------------------------------------------- the alignment
def keyset(bar: Bar, dur: bool = False) -> Counter:
    return Counter((n.midi, n.on) + ((n.dur,) if dur else ()) for n in bar.notes if not n.rest)


def rest_set(bar: Bar) -> Counter:
    return Counter((n.on, n.dur) for n in bar.notes if n.rest)


def _f1(a: Counter, b: Counter) -> float:
    inter = sum((a & b).values())
    tot = sum(a.values()) + sum(b.values())
    return 2 * inter / tot if tot else 1.0


def align(truth: List[Bar], out: List[Bar]) -> List[Tuple[int, int, float]]:
    """(truth index, output index, similarity) pairs, monotone, maximising the summed similarity; a pair of two empty bars is 1.0."""
    n, m = len(truth), len(out)
    tk = [keyset(b) for b in truth]
    ok = [keyset(b) for b in out]
    sims = [[_f1(tk[i], ok[j]) for j in range(m)] for i in range(n)]
    S = [[0.0] * (m + 1) for _ in range(n + 1)]
    for i in range(1, n + 1):
        for j in range(1, m + 1):
            S[i][j] = max(S[i - 1][j], S[i][j - 1], S[i - 1][j - 1] + sims[i - 1][j - 1])
    i, j, pairs = n, m, []
    while i > 0 and j > 0:
        if abs(S[i][j] - (S[i - 1][j - 1] + sims[i - 1][j - 1])) < 1e-9 and sims[i - 1][j - 1] > 0:
            pairs.append((i - 1, j - 1, sims[i - 1][j - 1]))
            i -= 1
            j -= 1
        elif S[i][j] == S[i - 1][j]:
            i -= 1
        else:
            j -= 1
    return pairs[::-1]


def bar_exact(t: Bar, o: Bar) -> bool:
    """The bar reproduces the truth's pitches, onsets, durations and rests exactly."""
    return keyset(t, True) == keyset(o, True) and rest_set(t) == rest_set(o)


# --------------------------------------------------------------------------------------- flag rules
def suspect_app(bar: Bar) -> bool:
    """The app's Import.validate rule, per bar: empty, overfull (past the bar), or under half full."""
    notes = [n for n in bar.notes if not n.rest]
    if not notes:
        return True
    length = bar.len or F(4)
    end = max(n.on + n.dur for n in bar.notes)
    return end > length + F(1, 100) or end < length / 2


def suspect_voice(bar: Bar) -> bool:
    """The stricter rule: the app's, or any voice whose written values do not fill the bar exactly."""
    if suspect_app(bar):
        return True
    length = bar.len or F(4)
    return any(v != length for v in bar.voices.values())


FLAG_RULES: Dict[str, Callable[[Bar], bool]] = {"app": suspect_app, "voice": suspect_voice}


# --------------------------------------------------------------------------------------- one case
@dataclass
class CaseResult:
    ok: bool                                            # the engine produced a score to judge
    metrics: Dict[str, Optional[float]] = field(default_factory=dict)
    counts: Dict[str, int] = field(default_factory=dict)
    structure: Optional[str] = None


COUNT_KEYS = ("truth_bars", "out_bars", "aligned", "exact", "wrong", "truth_notes", "out_notes", "matched", "matched_dur",
              "staff_ok", "beam_truth", "beam_ok", "played_matched", "played_out", "missed_bars")


def _f1_of(match: int, a: int, b: int) -> float:
    return 2 * match / (a + b) if a + b else 0.0


def _app_hand_rule_part(parts: List[PartInfo]) -> int:
    """App 4705-4713: the first part with 2+ staves is the piano, else the LAST part; other parts are not played."""
    return next((k for k, p in enumerate(parts) if p.staves >= 2), len(parts) - 1)


def judge(truth: Score, out: Optional[Score], *, external_flags: Optional[Dict[str, Iterable[int]]] = None,
          rules: Optional[Dict[str, Callable[[Bar], bool]]] = None, hand_rule: bool = True) -> CaseResult:
    """All omr.* metrics for one read. ``out`` None = the engine produced nothing (every rate 0, the case counted).

    ``external_flags``: {rule name: output bar indices} from a source outside this module (the app's suspect bars, G12-3's
    flags); judged like the built-in rules. ``hand_rule``: False skips ``omr.played_f1`` (a read that is already played notes)."""
    rules = FLAG_RULES if rules is None else rules
    tb = truth.bars
    c = {k: 0 for k in COUNT_KEYS}
    c["truth_bars"] = len(tb)
    c["truth_notes"] = sum(1 for b in tb for n in b.notes if not n.rest)
    if out is None or not out.bars:
        r = CaseResult(False, {}, c, None)
        r.metrics = _zero_metrics(truth)
        c["missed_bars"] = len(tb)
        return r
    ob = out.bars
    c["out_bars"] = len(ob)
    c["out_notes"] = sum(1 for b in ob for n in b.notes if not n.rest)
    pairs = align(tb, ob)
    al = [(i, j) for i, j, s in pairs if s >= ALIGN_MIN]
    c["aligned"] = len(al)
    c["missed_bars"] = len(tb) - len(al)
    exact_t = set()
    for i, j in al:
        a, b = keyset(tb[i]), keyset(ob[j])
        c["matched"] += sum((a & b).values())
        c["matched_dur"] += sum((keyset(tb[i], True) & keyset(ob[j], True)).values())
        if bar_exact(tb[i], ob[j]):
            exact_t.add(i)
        # staff and beam among the (pitch, onset)-matched notes, greedy in order
        pool: Dict[Tuple[int, F], List[Note]] = defaultdict(list)
        for n in ob[j].notes:
            if not n.rest:
                pool[(n.midi, n.on)].append(n)
        for n in tb[i].notes:
            if n.rest:
                continue
            lst = pool.get((n.midi, n.on))
            if lst:
                o = lst.pop(0)
                c["staff_ok"] += o.staff == n.staff
                if n.beam:
                    c["beam_truth"] += 1
                    c["beam_ok"] += o.beam
    c["exact"] = len(exact_t)
    jmap = {j: i for i, j in al}
    wrong = [j for j in range(len(ob)) if not (j in jmap and jmap[j] in exact_t)]
    c["wrong"] = len(wrong)

    m: Dict[str, Optional[float]] = {}
    m["omr.note_precision"] = c["matched"] / c["out_notes"] if c["out_notes"] else 0.0
    m["omr.note_recall"] = c["matched"] / c["truth_notes"] if c["truth_notes"] else 0.0
    m["omr.note_f1"] = _f1_of(c["matched"], c["truth_notes"], c["out_notes"])
    m["omr.duration_acc"] = c["matched_dur"] / c["matched"] if c["matched"] else 0.0
    m["omr.staff_acc"] = c["staff_ok"] / c["matched"] if c["matched"] else 0.0
    m["omr.beam_kept"] = c["beam_ok"] / c["beam_truth"] if c["beam_truth"] else None
    m["omr.bar_exact"] = c["exact"] / len(tb) if tb else None
    m["omr.measure_alignment_rate"] = len(al) / len(tb) if tb else None
    m["omr.bar_count_exact"] = 1.0 if len(tb) == len(ob) else 0.0
    m["omr.parts_ok"] = 1.0 if out.structure == truth.structure else 0.0
    m["omr.parts_fragmented"] = 1.0 if len(out.parts) > 1 and all(p.staves == 1 for p in out.parts) else 0.0
    m["omr.time_ok"] = 1.0 if truth.time == out.time else 0.0
    m["omr.key_ok"] = 1.0 if (truth.key or 0) == (out.key or 0) else 0.0
    m["omr.div0"] = 1.0 if out.div0 else 0.0
    if hand_rule:
        piano = _app_hand_rule_part(out.parts)
        played = [Bar(notes=[n for n in b.notes if n.part == piano]) for b in ob]
        pp = align(tb, played)
        c["played_matched"] = sum(sum((keyset(tb[i]) & keyset(played[j])).values()) for i, j, s in pp if s >= ALIGN_MIN)
        c["played_out"] = sum(1 for b in played for n in b.notes if not n.rest)
        m["omr.played_f1"] = _f1_of(c["played_matched"], c["truth_notes"], c["played_out"])
    # flags
    named: Dict[str, List[int]] = {name: [j for j in range(len(ob)) if rule(ob[j])] for name, rule in rules.items()}
    for name, idx in (external_flags or {}).items():
        named[name] = sorted({int(j) for j in idx if 0 <= int(j) < len(ob)})
    wset = set(wrong)
    for name, flags in named.items():
        tp = len(set(flags) & wset)
        c[f"flag.{name}.flagged"] = len(flags)
        c[f"flag.{name}.tp"] = tp
        m[f"omr.flag.{name}.recall"] = tp / len(wrong) if wrong else None
        m[f"omr.flag.{name}.precision"] = tp / len(flags) if flags else None
    return CaseResult(True, m, c, out.structure)


def _zero_metrics(truth: Score) -> Dict[str, Optional[float]]:
    m: Dict[str, Optional[float]] = {k: 0.0 for k in (
        "omr.note_precision", "omr.note_recall", "omr.note_f1", "omr.duration_acc", "omr.staff_acc", "omr.bar_exact",
        "omr.measure_alignment_rate", "omr.bar_count_exact", "omr.parts_ok", "omr.parts_fragmented", "omr.time_ok",
        "omr.key_ok", "omr.played_f1")}
    m["omr.beam_kept"] = None if not any(n.beam for b in truth.bars for n in b.notes if not n.rest) else 0.0
    m["omr.div0"] = 0.0
    return m


# --------------------------------------------------------------------------------------- many cases
# metrics whose aggregate is pooled over bars (or notes) rather than the mean of the per-case rates
MEAN_METRICS = ("omr.note_precision", "omr.note_recall", "omr.note_f1", "omr.played_f1", "omr.duration_acc", "omr.staff_acc",
                "omr.beam_kept", "omr.bar_exact", "omr.measure_alignment_rate", "omr.bar_count_exact", "omr.parts_ok",
                "omr.parts_fragmented", "omr.time_ok", "omr.key_ok", "omr.div0")


def aggregate(results: List[CaseResult]) -> Dict[str, object]:
    """One tier's numbers: the mean of each per-case rate (a failed case counts as 0), and the pooled ones.

    ``omr.bar_exact`` is POOLED over the truth bars (exact bars / truth bars: "168 of 267"), its per-case mean is
    ``omr.bar_exact.macro``; ``omr.note_f1`` is the mean of the cases' F1s, the pooled one is ``omr.note_f1.micro``;
    flag recall and precision are pooled over bars."""
    out: Dict[str, object] = {"cases": len(results), "failed": sum(1 for r in results if not r.ok)}
    tot = Counter()
    for r in results:
        tot.update({k: v for k, v in r.counts.items() if isinstance(v, int)})
    out["truth_bars"] = tot["truth_bars"]
    out["exact_bars"] = tot["exact"]
    out["wrong_bars"] = tot["wrong"]
    for name in MEAN_METRICS:
        vals = [r.metrics.get(name) for r in results if name in r.metrics]
        vals = [v for v in vals if v is not None]
        out[name + (".macro" if name == "omr.bar_exact" else "")] = _r(sum(vals) / len(vals)) if vals else None
    out["omr.bar_exact"] = _r(tot["exact"] / tot["truth_bars"]) if tot["truth_bars"] else None
    out["omr.note_f1.micro"] = _r(_f1_of(tot["matched"], tot["truth_notes"], tot["out_notes"])) if tot["truth_notes"] else None
    out["omr.played_f1.micro"] = _r(_f1_of(tot["played_matched"], tot["truth_notes"], tot["played_out"])) if tot["truth_notes"] else None
    rules = sorted({k.split(".")[1] for r in results for k in r.counts if k.startswith("flag.") and k.endswith(".flagged")})
    for name in rules:
        tp = sum(r.counts.get(f"flag.{name}.tp", 0) for r in results)
        fl = sum(r.counts.get(f"flag.{name}.flagged", 0) for r in results)
        out[f"omr.flag.{name}.recall"] = _r(tp / tot["wrong"]) if tot["wrong"] else None
        out[f"omr.flag.{name}.precision"] = _r(tp / fl) if fl else None
        out[f"omr.flag.{name}.flagged"] = fl
    structures = Counter(r.structure for r in results if r.ok)
    out["structures"] = dict(sorted(structures.items(), key=lambda kv: (-kv[1], str(kv[0]))))
    return out


def _r(x: float) -> float:
    return round(x, 6)
