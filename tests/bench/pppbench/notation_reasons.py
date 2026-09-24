"""Why a residual is there (docs/GOALS/G03 §28 M6, §29 U-1/U-2): the reason for every triplet length without
time-modification, one-note bracket and mergeable tie that nq.* counts, read from reader/5's notation layer.

G3a writes what the metric grid lets it write and keeps what it cannot. A residual is not a defect when G3a had a
reason to leave it, and the G3 gate (g3gate.py) counts each reason apart instead of relaxing the zero:

  R17_DEFER_G3B           the residual sits in a voice-bar window whose boundaries are neither all on the binary
                          grid nor all on the triplet grid, and choosing one grid, every point off it is a release
                          (a note end, a rest edge; never an onset): only moving a release fixes it, which is G3b's
                          R-reg (G03 §6.3 R17). A residual sharing a window with such a segment is one too (R-repr
                          keeps a triplet region whole around what it cannot write). The gate holds each case's
                          count to a recorded baseline (U-1): a change that adds R17 residuals fails.
  MIXED_ONSETS            a window of that kind where some point off the grid is an onset: not R17, the quantizer's
                          (counted as unexpected: G3a has no rule that keeps it)
  OFF_GRID                a boundary on neither grid of 1/192 whole (unexpected)
  CLEAN                   nothing in the voice-bar stops G3a writing it (unexpected)

A mergeable tie (nq.tie.mergeable_rate's numerator: two pieces of one pitch in one bar, the joined span inside one
beat and one value with at most two dots) is a defect only when merging it into one symbol is legal and G3a's policy
would write that symbol (U-1). The reasons, in the order they are tried:

  CROSS_VOICE             the two pieces are in different voices: one symbol cannot belong to both
  PARTIAL_CHORD_REQUIRED  a chord only some of whose heads are tied on (or into a chord with heads not tied from
                          it): one symbol would drop or add a sounding head (U-2; G3a does not change what sounds)
  REQUIRED_H6             a piece inside a tuplet bracket and one outside it (or in another): a triplet symbol does
                          not leave its group (H6)
  REQUIRED_H7             the joined value is double-dotted and neither starts on a beat nor completes one (H7)
  REQUIRED_BEAT_SPLIT     the joined value would hide a beat the S table does not allow (H4/H5), the pickup offset
                          counted (the metric's own beat test reads positions from the bar's start)
  R17_DEFER_G3B           as above: legal, but in a window R-repr keeps as written
  MERGEABLE_DEFECT        none of these: G3a should have written one symbol

Positions are integers of 1/48 quarter (1/192 whole): the binary 1/64-whole grid is the multiples of 3, the
triplet-32nd grid the multiples of 4 (pro-rhythm.js reads the same two grids).
"""

from __future__ import annotations

from fractions import Fraction
from typing import Any, Dict, List, Optional, Tuple

from . import notation_read as NR

UQ = 48                       # positions per quarter
TICK = 2                      # audio-score's tick (1/96 whole) in positions: how far off a release R17 allows
RANK = {"CLEAN": 0, "R17": 1, "R17_WIDE": 2, "MIXED_ONSETS": 3}
R17_CLASSES = ("R17", "R17_WIDE")
TIE_REASONS = ("CROSS_VOICE", "PARTIAL_CHORD_REQUIRED", "REQUIRED_H6", "REQUIRED_H7", "REQUIRED_BEAT_SPLIT",
               "R17_DEFER_G3B", "MERGEABLE_DEFECT")


def _u(x: Fraction) -> Optional[int]:
    v = x * UQ
    return int(v) if v.denominator == 1 else None


def _offset(nt: Dict[str, Any], m: int) -> Fraction:
    """A short first bar is a pickup: its positions sit at the end of a full bar (notation_quality's rule)."""
    ms = nt["measures"]
    if m == 0 and ms and ms[0]["len"] < ms[0]["nominal"]:
        return ms[0]["nominal"] - ms[0]["len"]
    return Fraction(0)


def _dots_of(length: Fraction) -> Optional[Tuple[str, int]]:
    """The one value with at most two dots a length (quarters) is, as (type, dots), or None."""
    for t, q in NR.TYPE_Q.items():
        for d, f in ((0, Fraction(1)), (1, Fraction(3, 2)), (2, Fraction(7, 4))):
            if length == q * f:
                return t, d
    return None


class _VoiceBar:
    """One (part, voice, bar): its events, their tied runs and rest runs, and the class of each window."""

    def __init__(self, nt: Dict[str, Any], evs: List[int], links: Dict[int, set]):
        self.nt = nt
        events = nt["events"]
        self.evs = sorted(evs, key=lambda i: (events[i - 1]["first"]["at"], i))
        first = events[self.evs[0] - 1]["first"]
        self.m = first["m"]
        time = first["time"]
        bar = nt["measures"][self.m] if self.m < len(nt["measures"]) else None
        self.dur_u = _u(bar["len"]) if bar else None
        self.off = _u(_offset(nt, self.m)) or 0
        compound = NR.is_compound(time)
        simple = not compound and time[1] in (2, 4)
        self.win = UQ if simple else UQ // 2          # the window: a quarter in simple metre, an eighth otherwise
        inside = set(self.evs)
        # tied runs inside the bar (union of events whose heads tie), rest runs (adjacent rests)
        root = {i: i for i in self.evs}

        def find(x):
            while root[x] != x:
                root[x] = root[root[x]]
                x = root[x]
            return x

        self.tied_in, self.tied_out = set(), set()
        for i in self.evs:
            for j in links.get(i, ()):
                if j in inside:
                    self.tied_out.add(i)
                    self.tied_in.add(j)
                    a, b = find(i), find(j)
                    if a != b:
                        root[b] = a
        prev = None
        for i in self.evs:
            e = events[i - 1]["first"]
            if e["rest"] and prev is not None and events[prev - 1]["first"]["rest"] and \
                    events[prev - 1]["first"]["at"] + events[prev - 1]["first"]["dur"] == e["at"]:
                a, b = find(prev), find(i)
                if a != b:
                    root[b] = a
            prev = i
        self.seg: Dict[int, Tuple[Optional[int], Optional[int]]] = {}
        spans: Dict[int, List[Optional[int]]] = {}
        for i in self.evs:
            e = events[i - 1]["first"]
            s, en = _u(e["at"]), _u(e["at"] + e["dur"])
            r = find(i)
            if r not in spans:
                spans[r] = [s, en]
            else:
                lo, hi = spans[r]
                spans[r] = [None if lo is None or s is None else min(lo, s), None if hi is None or en is None else max(hi, en)]
        for i in self.evs:
            self.seg[i] = tuple(spans[find(i)])
        self.segs = sorted({tuple(v) for v in spans.values() if v[0] is not None and v[1] is not None})
        # boundary points and what they are
        self.kinds: Dict[int, set] = {}
        for i in self.evs:
            e = events[i - 1]["first"]
            s, en = _u(e["at"]), _u(e["at"] + e["dur"])
            if e["rest"]:
                self._add(s, "restS")
                self._add(en, "restE")
                continue
            self._add(s, "piece" if i in self.tied_in else "on")
            self._add(en, "piece" if i in self.tied_out else "rel")
        top = self.dur_u if self.dur_u is not None else 10 ** 9
        self.pts = sorted(p for p, k in self.kinds.items() if 0 < p < top and k != {"piece"})
        self._win_cache: Dict[int, str] = {}

    def _add(self, p: Optional[int], kind: str) -> None:
        if p is not None:
            self.kinds.setdefault(p, set()).add(kind)

    def window_class(self, a: int) -> str:
        if a in self._win_cache:
            return self._win_cache[a]
        ins = [p for p in self.pts if a < p < a + self.win]
        binary = lambda p: (p + self.off) % 3 == 0      # noqa: E731
        triplet = lambda p: (p + self.off) % 4 == 0     # noqa: E731
        if all(binary(p) for p in ins) or all(triplet(p) for p in ins):
            cls = "CLEAN"
        else:
            cands = []
            for on in (binary, triplet):
                off = [p for p in ins if not on(p)]
                if any("on" in self.kinds[p] for p in off):
                    continue
                dist = max([min(abs(q - p) for q in range(p - 6, p + 7) if on(q)) for p in off] or [0])
                cands.append((dist, len(off)))
            cls = "MIXED_ONSETS" if not cands else ("R17" if min(cands)[0] <= TICK else "R17_WIDE")
        self._win_cache[a] = cls
        return cls

    def windows(self, s: int, en: int) -> List[int]:
        a = ((s + self.off) // self.win) * self.win - self.off
        out = []
        while a < en:
            out.append(a)
            a += self.win
        return out

    def span_class(self, s: int, en: int) -> str:
        worst = "CLEAN"
        for a in self.windows(s, en):
            c = self.window_class(a)
            if RANK[c] > RANK[worst]:
                worst = c
        return worst

    def classify(self, i: int) -> str:
        """The class of event i's segment: its own windows', else (one step) that of a segment sharing a window."""
        s, en = self.seg[i]
        if s is None or en is None:
            return "OFF_GRID"
        own = self.span_class(s, en)
        if own != "CLEAN":
            return own
        worst = "CLEAN"
        for a in self.windows(s, en):
            for x, y in self.segs:
                if x < a + self.win and y > a:
                    c = self.span_class(x, y)
                    if RANK[c] > RANK[worst]:
                        worst = c
        return worst


def _is_r17(cls: str) -> bool:
    return cls in R17_CLASSES


def reasons(nt: Dict[str, Any]) -> Dict[str, int]:
    """Counts per reason for one file: tm.r17 / tm.unexpected, one.r17 / one.unexpected, and tie.<REASON>."""
    events = nt["events"]
    out = {"tm.r17": 0, "tm.unexpected": 0, "one.r17": 0, "one.unexpected": 0}
    out.update({"tie." + r: 0 for r in TIE_REASONS})
    if not events:
        return out
    pitched = [e for e in nt["elems"] if e["pitch"] is not None and e["pitch"][0] in NR.STEP_IDX]
    # element links along each tie chain, and the same per event
    elem_next: Dict[int, Dict[str, Any]] = {}
    links: Dict[int, set] = {}
    for ch in NR.tie_chains(pitched):
        for prev, nxt in zip(ch["notes"], ch["notes"][1:]):
            elem_next[id(prev)] = nxt
            links.setdefault(prev["ev"], set()).add(nxt["ev"])
    bars: Dict[Tuple, List[int]] = {}
    for i, ev in enumerate(events, start=1):
        e = ev["first"]
        bars.setdefault((e["part"], e["voice"], e["m"]), []).append(i)
    vb_of: Dict[int, _VoiceBar] = {}
    for evs in bars.values():
        vb = _VoiceBar(nt, evs, links)
        for i in evs:
            vb_of[i] = vb

    # triplet lengths without time-modification
    for i, ev in enumerate(events, start=1):
        e = ev["first"]
        if not e["tm"] and e["dur"] > 0 and not NR.dyadic(e["dur"]):
            out["tm.r17" if _is_r17(vb_of[i].classify(i)) else "tm.unexpected"] += 1
    # one-note tuplets: a bracket over one event, and a time-modified event under no bracket (a one-note tuplet whose
    # bracket is not printed: the writer hides the middle pieces of a triplet it split, G1 F1, and G3 keeps them where
    # it cannot regroup them; §28 M5: counted, not left out)
    bracket_of: Dict[int, int] = {}
    for bi, b in enumerate(nt["brackets"]):
        for i in b["events"]:
            bracket_of.setdefault(i, bi)
        if len(b["events"]) == 1:
            i = b["events"][0]
            out["one.r17" if _is_r17(vb_of[i].classify(i)) else "one.unexpected"] += 1
    for i, ev in enumerate(events, start=1):
        if ev["first"]["tm"] and i not in bracket_of:
            out["one.r17" if _is_r17(vb_of[i].classify(i)) else "one.unexpected"] += 1
    # mergeable ties (the metric's rule) and why each is there
    for ch in NR.tie_chains(pitched):
        for prev, nxt in zip(ch["notes"], ch["notes"][1:]):
            if prev["m"] != nxt["m"]:
                continue
            beat = NR.beat_len(prev["time"])
            end = nxt["at"] + nxt["dur"]
            joined = end - prev["at"]
            if int(prev["at"] / beat) != int((end - Fraction(1, 10 ** 6)) / beat) or not NR.single_symbol(joined):
                continue
            out["tie." + _tie_reason(nt, prev, nxt, joined, vb_of, bracket_of, elem_next)] += 1
    return out


def _tie_reason(nt, prev, nxt, joined, vb_of, bracket_of, elem_next) -> str:
    events = nt["events"]
    a, b = prev["ev"], nxt["ev"]
    if prev["voice"] != nxt["voice"] or prev["part"] != nxt["part"]:
        return "CROSS_VOICE"
    # U-2: every head of the one chord tied to a head of the other, and nothing else
    from_elems, to_elems = events[a - 1]["elems"], events[b - 1]["elems"]
    hits = [x for x in from_elems if elem_next.get(id(x)) is not None and elem_next[id(x)]["ev"] == b]
    if len(hits) != len(from_elems) or len(hits) != len(to_elems):
        return "PARTIAL_CHORD_REQUIRED"
    # H6: a triplet symbol stays in its group
    ba, bb = bracket_of.get(a), bracket_of.get(b)
    tm_a, tm_b = events[a - 1]["first"]["tm"], events[b - 1]["first"]["tm"]
    if ba != bb or tm_a != tm_b:
        return "REQUIRED_H6"
    printed = joined
    if ba is not None or tm_a:
        ratio = nt["brackets"][ba]["ratio"] if ba is not None else events[a - 1]["first"]["tm_ratio"]
        if ratio:
            printed = joined * Fraction(ratio[0], ratio[1])
        if _dots_of(printed) is None:
            return "REQUIRED_H6"
    sym = _dots_of(printed)
    vb = vb_of[a]
    off = _offset(nt, prev["m"])
    time = prev["time"]
    beat = NR.beat_len(time)
    x0, x1 = prev["at"] + off, prev["at"] + joined + off
    # H7: a double dot only from a beat, or completing one (ending on the next beat line without crossing one)
    if sym is not None and sym[1] == 2:
        on_beat = (x0 / beat).denominator == 1
        completes = (x1 / beat).denominator == 1 and int(x0 / beat) + 1 == int(x1 / beat)
        if not on_beat and not completes:
            return "REQUIRED_H7"
    # H4/H5 with the pickup offset (inside a tuplet the bracket's own region rules, H6 above)
    if ba is None and not tm_a and sym is not None:
        from .metrics.notation_quality import hides_beat
        if hides_beat(time, x0, joined, sym[0], sym[1]):
            return "REQUIRED_BEAT_SPLIT"
    if _is_r17(vb.classify(a)):
        return "R17_DEFER_G3B"
    return "MERGEABLE_DEFECT"
