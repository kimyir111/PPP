"""Readability: computed from one score alone (docs/GOALS/G00 §8.4)."""

from __future__ import annotations

from collections import defaultdict
from fractions import Fraction
from typing import Any, Dict, List, Optional

TOL = Fraction(1, 100)


def bar_integrity_detail(canon) -> Dict[str, Any]:
    """``Import.validate`` overfull/underfull/empty, implicit first/last bar exempt from underfull."""
    ends: Dict[int, Fraction] = {}
    for item in list(canon.notes) + list(canon.rests):
        e = item.pos_q + item.dur_q
        if item.measure not in ends or e > ends[item.measure]:
            ends[item.measure] = e
    bad: List[Dict[str, Any]] = []
    last = len(canon.measures) - 1
    for m in canon.measures:
        if m.index not in ends:
            bad.append({"index": m.index, "kind": "empty"})
            continue
        end, sig = ends[m.index], m.sig_q
        if end > sig + TOL:
            bad.append({"index": m.index, "kind": "overfull"})
        elif end < sig / 2 - TOL and not (m.implicit and m.index in (0, last)):
            bad.append({"index": m.index, "kind": "underfull"})
    return {"checked": len(canon.measures), "ok": len(canon.measures) - len(bad), "bad": bad}


def _hand_groups(canon):
    groups = defaultdict(list)
    for s in canon.played():
        groups[(s.hand, s.onset_q)].append(s.midi)
    return groups


def readability(canon) -> Dict[str, Optional[float]]:
    notes = canon.notes
    n = len(notes)
    bi = bar_integrity_detail(canon)
    groups = _hand_groups(canon)
    return {
        "read.bar_integrity": bi["ok"] / bi["checked"] if bi["checked"] else None,
        "read.ties_per_note": sum(1 for x in notes if x.tie_start) / n if n else None,
        "read.tuplets_per_note": sum(1 for x in notes if x.tuplet) / n if n else None,
        "read.accidentals_per_note": sum(1 for x in notes if x.accidental) / n if n else None,
        "read.short_notes_rate": sum(1 for x in notes if x.dur_q <= Fraction(1, 8)) / n if n else None,
        "read.over_span_rate": (sum(1 for g in groups.values() if max(g) - min(g) > 12) / len(groups)) if groups else None,
        "read.max_chord_size": float(max(len(g) for g in groups.values())) if groups else None,
        "read.rests_per_measure": len(canon.rests) / len(canon.measures) if canon.measures else None,
    }


def compute(ctx) -> Dict[str, Optional[float]]:
    pred = readability(ctx["pred"])
    ref = ctx.get("ref_readability") or readability(ctx["ref"])
    out = dict(pred)
    for k, v in pred.items():
        r = ref.get(k)
        out[k + ".delta"] = (v - r) if v is not None and r is not None else None
    return out
