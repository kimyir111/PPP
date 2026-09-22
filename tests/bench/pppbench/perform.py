"""Deterministic synthetic performances of a reference score (docs/GOALS/G00 §6.6).

Only + - * /, floor and abs are used, and random numbers come from the 32-bit
LCG, so every platform produces the same bits (D8). Do not use libm
functions or the ``random`` module here; a unit test greps for them.
"""

from __future__ import annotations

from dataclasses import dataclass
from fractions import Fraction
from typing import Any, Dict, List, Optional, Tuple

from .util import Lcg, fnv1a32, round_t

PROFILES: Dict[str, Dict[str, Any]] = {
    "deadpan": {"jitter": 0.0, "drift": 0.0, "period": 14, "gap": (0.040, 0.040), "vel_noise": 0, "roll_p": 0.0, "amt": False, "accent": False},
    "human": {"jitter": 0.015, "drift": 0.0, "period": 14, "gap": (0.02, 0.08), "vel_noise": 8, "roll_p": 0.25, "amt": False, "accent": True},
    "rubato": {"jitter": 0.025, "drift": 0.10, "period": 14, "gap": (0.02, 0.08), "vel_noise": 8, "roll_p": 0.25, "amt": False, "accent": True},
    "amt": {"jitter": 0.020, "drift": 0.04, "period": 14, "gap": (0.02, 0.10), "vel_noise": 12, "roll_p": 0.25, "amt": True, "accent": True},
    # `human` plus the sustain pedal: down just after every downbeat, up just before the next (§17 M4)
    "pedal": {"jitter": 0.015, "drift": 0.0, "period": 14, "gap": (0.02, 0.08), "vel_noise": 8, "roll_p": 0.25, "amt": False, "accent": True,
              "pedal": True},
    # A second generator family for robustness (§17 M11): none of the cues the main family gives —
    # no downbeat accent, no louder melody or bass, no rolled chords — and a triangular timing error.
    # It is not real playing; it exists so that a change tuned to one generator's habits shows up.
    "human-alt": {"jitter": 0.020, "drift": 0.0, "period": 14, "gap": (0.03, 0.12), "vel_noise": 10, "roll_p": 0.0, "amt": False,
                  "accent": False, "voicing": False, "jitter_shape": "triangular", "base_vel": 70},
}
PEDAL_DOWN_S, PEDAL_UP_S = 0.05, 0.02   # pedal-profile offsets after a downbeat / before the next

BEAT_PROFILES: Dict[str, Dict[str, Any]] = {
    "none": None,
    "oracle": {"noise": 0.0, "drop": 0.0, "confidence": 0.90},
    "oracle-noisy": {"noise": 0.02, "drop": 0.05, "confidence": 0.60},
    "lowconf": {"noise": 0.0, "drop": 0.0, "confidence": 0.30},
}

STEPS_PER_Q = 96
ROLL_STEP = 0.012


def tri(x: float) -> float:
    """Triangle wave, period 1, range [-1, 1]."""
    return 1.0 - 4.0 * abs((x - _floor(x)) - 0.5)


def _floor(x: float) -> int:
    i = int(x)
    return i - 1 if x < i else i


def tactus_q(time: Tuple[int, int]) -> Fraction:
    b, t = time
    if t == 8 and b % 3 == 0:
        return Fraction(3, 2)
    if t == 4:
        return Fraction(1)
    if t == 2:
        return Fraction(2)
    return Fraction(1, 2)


class TimeMap:
    """Reference quarter position -> performance seconds.

    ``sec(q) = start_s + Σ spq(q_k + Δ/2)·Δ`` on a 1/96-quarter grid, with the
    score's tempo marks and an optional triangle-wave tempo drift."""

    def __init__(self, end_q: Fraction, qpm: float, start_s: float, drift: float = 0.0, period: float = 14.0,
                 marks: Optional[List[Tuple[Fraction, float]]] = None):
        self.qpm, self.start_s, self.drift, self.period = float(qpm), float(start_s), float(drift), float(period)
        self.marks = sorted(marks or [], key=lambda m: m[0])
        self.n = int(end_q * STEPS_PER_Q) + 8 * STEPS_PER_Q
        dq = 1.0 / STEPS_PER_Q
        mark_pos = [float(p) for p, _ in self.marks]
        cum = [self.start_s]
        spq = []
        mi = 0
        tempo = self.qpm
        for k in range(self.n):
            mid = (2 * k + 1) / (2 * STEPS_PER_Q)
            while mi < len(self.marks) and mark_pos[mi] <= mid:
                tempo = self.marks[mi][1]
                mi += 1
            v = self._spq(tempo, mid)
            spq.append(v)
            cum.append(cum[-1] + v * dq)
        self.cum, self.spq = cum, spq

    def _spq(self, tempo: float, q: float) -> float:
        m = 1.0 + self.drift * tri(q / self.period) if self.drift else 1.0
        return 60.0 / (tempo * m)

    def sec(self, q) -> float:
        """Seconds at quarter position ``q`` (exact Fraction arithmetic for the grid index)."""
        q = Fraction(q)
        steps = q * STEPS_PER_Q
        k = steps.numerator // steps.denominator
        frac = float(steps - k)
        dq = 1.0 / STEPS_PER_Q
        if k < 0:
            return self.start_s + float(q) * self.spq[0]
        if k >= self.n:
            return self.cum[self.n] + float(q - Fraction(self.n, STEPS_PER_Q)) * self.spq[-1]
        return self.cum[k] + frac * dq * self.spq[k]


@dataclass
class Performance:
    input: Dict[str, Any]
    opts: Dict[str, Any]
    truth: List[Dict[str, Any]]
    expected: Dict[str, Any]
    timemap: TimeMap
    start_s: float
    errors: Optional[Dict[str, int]] = None   # AMT profile: notes dropped, ghosts added, repeats merged


def reference_marks(canon, qpm: float, override: bool) -> List[Tuple[Fraction, float]]:
    """First tempo mark at each position; scaled when expect.tempo_qpm overrides the file."""
    seen, out = set(), []
    for m in sorted(canon.marks, key=lambda m: m.onset_q):
        if m.onset_q in seen:
            continue
        seen.add(m.onset_q)
        out.append((m.onset_q, m.qpm))
    if not out:
        return []
    if override and out[0][1] != qpm:
        scale = qpm / out[0][1]
        out = [(p, v * scale) for p, v in out]
    return out


def perform(canon, ref_id: str, profile: str, beats: str, seed: int, *, expect: Optional[Dict[str, Any]] = None,
            case_opts: Optional[Dict[str, Any]] = None, opt_name: Optional[str] = None) -> Performance:
    expect = expect or {}
    prof = PROFILES[profile]
    bprof = BEAT_PROFILES[beats]
    qpm = float(expect.get("tempo_qpm") or canon.effective_qpm or 100)
    start_s = 1.0 + 0.25 * (fnv1a32(ref_id) % 5)
    case_base = f"{ref_id}|{profile}|{beats}" + (f"|opt:{opt_name}" if opt_name else "")
    rng = Lcg(fnv1a32(case_base) ^ ((seed * 0x9E3779B1) & 0xFFFFFFFF))
    marks = reference_marks(canon, qpm, bool(expect.get("tempo_qpm")) and canon.effective_qpm is not None)
    tm = TimeMap(canon.end_q, qpm, start_s, prof["drift"], prof["period"], marks)

    played = sorted(canon.played(), key=lambda s: (s.onset_q, s.staff, s.midi))
    groups: Dict[Tuple[Fraction, str], List[Any]] = {}
    for s in played:
        groups.setdefault((s.onset_q, s.hand), []).append(s)

    # 1) rolled chords, per same-hand onset group of three or more notes
    roll: Dict[int, float] = {}
    for key in sorted(groups, key=lambda k: (k[0], k[1])):
        g = groups[key]
        if prof["roll_p"] and len(g) >= 3 and rng.next() < prof["roll_p"]:
            for i, s in enumerate(sorted(g, key=lambda s: s.midi)):
                roll[s.id] = ROLL_STEP * i

    measures = canon.measures
    first_beat = {m.start_q for m in measures if not m.implicit}
    notes: List[Dict[str, Any]] = []
    errors = {"dropped": 0, "ghosts": 0, "merged": 0}
    for s in played:
        g = groups[(s.onset_q, s.hand)]
        nominal_on = tm.sec(s.onset_q)
        nominal_off = tm.sec(s.onset_q + s.dur_q)
        # 2) per note: jitter, release gap, velocity noise, then AMT errors
        if not prof["jitter"]:
            jitter = 0.0
        elif prof.get("jitter_shape") == "triangular":   # sum of two uniforms: most errors small, few large
            jitter = (rng.uniform(-prof["jitter"], prof["jitter"]) + rng.uniform(-prof["jitter"], prof["jitter"])) / 2
        else:
            jitter = rng.uniform(-prof["jitter"], prof["jitter"])
        gap = rng.uniform(*prof["gap"]) if prof["gap"][0] != prof["gap"][1] else prof["gap"][0]
        vnoise = rng.uniform(-prof["vel_noise"], prof["vel_noise"]) if prof["vel_noise"] else 0.0
        on = nominal_on + jitter + roll.get(s.id, 0.0)
        off = max(on + 0.05, nominal_off - gap)
        voicing = prof.get("voicing", True)
        top = voicing and s.hand == "r" and s.midi == max(x.midi for x in g)
        bottom = voicing and s.hand == "l" and s.midi == min(x.midi for x in g)
        accent = prof["accent"] and s.onset_q in first_beat
        vel = prof.get("base_vel", 64) + 12 * top + 6 * bottom + 6 * accent + vnoise
        vel = int(_floor(min(110.0, max(20.0, vel)) + 0.5))
        drop = False
        ghost = None
        if prof["amt"]:
            p_drop = 0.03 + (0.03 if off - on < 0.10 else 0.0)
            if len(g) >= 3 and s.midi not in (min(x.midi for x in g), max(x.midi for x in g)):
                p_drop += 0.02
            drop = rng.next() < p_drop
            if rng.next() < 0.02:
                interval = 12 if rng.next() < 0.7 else 19
                g_on = on + rng.uniform(0.0, 0.02)
                g_len = rng.uniform(0.06, 0.15)
                if s.midi + interval <= 108:
                    ghost = {"on": g_on, "off": g_on + g_len, "midi": s.midi + interval, "vel": max(20, vel // 2)}
            off = off + rng.uniform(-0.15, 0.15) * (off - on)
            off = max(on + 0.05, off)
        errors["dropped"] += drop
        errors["ghosts"] += ghost is not None
        if not drop:
            notes.append({"on": on, "off": off, "midi": s.midi, "vel": vel,
                          "_truth": {"ref": s.id, "nominal_on": nominal_on, "nominal_off": nominal_off}})
        if ghost:
            ghost["_truth"] = {"ref": None, "nominal_on": ghost["on"], "nominal_off": ghost["off"]}
            notes.append(ghost)

    for n in notes:
        n["on"], n["off"] = round_t(n["on"]), round_t(n["off"])
    notes.sort(key=lambda n: (n["on"], n["midi"], n["off"]))

    # 3) AMT: repeated notes closer than 30 ms merge half the time
    if prof["amt"]:
        merged: List[Dict[str, Any]] = []
        last_by_pitch: Dict[int, Dict[str, Any]] = {}
        for n in notes:
            prev = last_by_pitch.get(n["midi"])
            if prev is not None and n["on"] - prev["off"] < 0.03 and rng.next() < 0.5:
                prev["off"] = max(prev["off"], n["off"])
                errors["merged"] += 1
                continue
            merged.append(n)
            last_by_pitch[n["midi"]] = n
        notes = merged

    pedals: List[Dict[str, float]] = []
    if prof.get("pedal"):
        for m in measures:
            if m.implicit and m.index == 0:
                continue
            down, up = tm.sec(m.start_q) + PEDAL_DOWN_S, tm.sec(m.start_q + m.len_q) - PEDAL_UP_S
            if up > down:
                pedals.append({"on": round_t(down), "off": round_t(up)})
    inp: Dict[str, Any] = {"notes": [{"on": n["on"], "off": n["off"], "midi": n["midi"], "vel": n["vel"]} for n in notes],
                           "pedals": pedals, "title": "bench"}
    truth = [n["_truth"] for n in notes]

    # beat information
    time = tuple(expect["time"]) if expect.get("time") else canon.primary_time()
    anchor = next((m.start_q for m in measures if not m.implicit), Fraction(0))
    downbeats_q = [m.start_q for m in measures if not m.implicit]
    bar_starts = [tm.sec(q) for q in downbeats_q]
    if bprof:
        step = tactus_q(time)
        end_q = canon.end_q
        k0 = -((anchor // step) + 1)
        grid = []
        k = k0
        while anchor + k * step <= end_q:
            q = anchor + k * step
            if q >= 0:
                grid.append(q)
            k += 1
        brng = Lcg(fnv1a32(case_base + "|beats") ^ ((seed * 0x9E3779B1) & 0xFFFFFFFF))
        beats_s = [tm.sec(q) for q in grid]
        down_s = list(bar_starts)
        if bprof["noise"] or bprof["drop"]:
            beats_s = _noisy(beats_s, brng, bprof)
            down_s = _noisy(down_s, brng, bprof)
        inp["beats"] = [round_t(t) for t in beats_s]
        inp["downbeats"] = [round_t(t) for t in down_s]
        inp["beatConfidence"] = bprof["confidence"]

    opts: Dict[str, Any] = {"title": "bench"}
    if case_opts:
        opts.update(_resolve_opts(case_opts, bar_starts[0] if bar_starts else start_s))

    key = expect.get("key")
    m0 = measures[0]
    expected = {
        "qpm": qpm,
        "time": [int(time[0]), int(time[1])],
        "key": {"fifths": int(key["fifths"]), "mode": key.get("mode")} if key else
               {"fifths": m0.fifths, "mode": m0.mode if m0.mode_explicit else None},
        "measures": len(measures),
        "bar_starts": [round_t(t) for t in bar_starts],
    }
    return Performance(input=inp, opts=opts, truth=truth, expected=expected, timemap=tm, start_s=start_s,
                       errors=errors if prof["amt"] else None)


def _noisy(times: List[float], rng: Lcg, bprof: Dict[str, Any]) -> List[float]:
    out = []
    for t in times:
        drop = rng.next() < bprof["drop"]
        jit = rng.uniform(-bprof["noise"], bprof["noise"])
        if not drop:
            out.append(t + jit)
    return sorted(out)


def _resolve_opts(opts: Dict[str, Any], first_downbeat: float) -> Dict[str, Any]:
    out = {}
    for k, v in opts.items():
        if isinstance(v, dict):
            out[k] = _resolve_opts(v, first_downbeat)
        elif v == "<start_s>":
            out[k] = round_t(first_downbeat)
        else:
            out[k] = v
    return out
