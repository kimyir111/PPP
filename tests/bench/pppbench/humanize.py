"""The calibrated humanizer (G10a-0, docs/GOALS/G10 section 7.3): the synthetic performer's second generation.

``perform/3`` keeps the original profiles (deadpan, human, rubato, amt, pedal, human-alt) byte-identical and adds
profiles whose noise is drawn from committed *aggregate* tables measured on real transcriptions
(``corpus/calibration/*.json``: quantiles, shares, moments - no note, no title):

  cover         what an Onsets & Frames transcription of a steady, sequenced cover looks like (32-ms frames, one
                jitter per attack, chords one frame apart, releases that overlap the next onset 70 % of the time)
  cover-pedal   cover with the sustain pedal as the mechanism of the overlap: damper spans per bar, a note sounds
                until the pedal comes up
  human-real    a human-like family on a finer clock (10 ms), tempo drift and phrase-end ritardandi, wider velocity:
                an independent family so nothing is tuned to one cover
  swing         cover with straight eighths played long-short (1.6-2:1) in half of the 4-bar blocks; the truth
                stays as written
  cover-alt     the independent family for the robust suites (G10 section 7.6): the cover's clock and frame, but a
                triangular jitter, no voicing, a flat velocity and an early-release-heavy table that is NOT calibrated
                (65 % of the notes end before the next onset, against 27-31 % measured): a change tuned to the
                calibrated family's habits shows up as a difference between the two

  overlays      ``+of``      the production browser model's errors on top (isolated short notes dropped, inner chord
                             notes missed, octave ghosts, repeated-note merges, no pedal)
                ``+helper``  the helper ensemble's measured errors (replay-helper.json): onset bias, an offset-error
                             table, misses, extras, a pedal that was never played

A profile is ``base`` or ``base+overlay[+overlay]``; the base performance is the same with and without overlays
(overlays draw from their own stream). Only + - * /, floor and abs are used and every random number comes from the
32-bit LCG (D8): no libm, no ``random``. Normal draws are Irwin-Hall sums of twelve uniforms.

Fitted values (not measured, chosen so the *measured* statistics of the humanized catalogue land on the real ones;
``unit/test_calibration.py`` holds the bands): ``JITTER_SD`` (the real residual includes the beat map's error),
the velocity base and voicing, the chord split rule. Everything else is read from the calibration tables.
"""

from __future__ import annotations

import json
import os
from fractions import Fraction
from typing import Any, Dict, List, Optional, Tuple

from .util import Lcg, bench_root, fnv1a32, round_t

CAL_DIR = os.path.join(bench_root(), "corpus", "calibration")
COVER_FILE = "cover-of-2026-10.json"
HELPER_FILE = "replay-helper.json"

VERSION = "humanize/1"
BASES = ("cover", "cover-pedal", "human-real", "swing", "cover-alt")
OVERLAYS = ("of", "helper")
KNOT_N = 20                         # the tables hold the 21 quantiles p0, p5 ... p100
TAIL_MS = 600.0                     # an offset-error table's extremes are clipped (one outlier is not a distribution)

# Fitted (see the module docstring).
JITTER_SD = {"cover": 0.0243, "human-real": 0.015}
ALT_JITTER = 0.06                   # cover-alt: half-width of each of the two uniforms averaged (sd 24.5 ms)
ALT_RATIO = [0.05, 0.10, 0.15, 0.20, 0.30, 0.40, 0.50, 0.55, 0.60, 0.70, 0.80, 0.90, 0.95, 1.00, 1.10, 1.30, 1.60, 2.00,
             2.60, 3.50, 6.00]      # cover-alt release ratios (p0 ... p100), both hands: invented, early-release-heavy
VEL = {"cover": {"base": 65.0, "noise": 5.9, "top": 3.0, "bottom": 1.0, "accent": 0.0},
       "human-real": {"base": 64.0, "noise": 12.0, "top": 12.0, "bottom": 6.0, "accent": 6.0},
       "cover-alt": {"base": 70.0, "noise": 10.0, "top": 0.0, "bottom": 0.0, "accent": 0.0},
       "cover-alt": {"base": 70.0, "noise": 10.0, "top": 0.0, "bottom": 0.0, "accent": 0.0}}
ROLL_P, ROLL_STEP = 0.25, 0.012     # human-real: rolled chords, as the `human` profile
MIN_PEDAL_S = 0.25                  # no pedal change shorter than this (a bar of a quarter of a second has none)
MERGE_P = 0.2                       # +of: a repeated note one frame after the previous release merges (not measured: a guess)
SWING_BLOCK = 4                     # bars; each block swings with probability one half
RITARD_DEPTH = 0.30                 # human-real: the last two beats of a phrase slow down by up to 30 %


# ----------------------------------------------------------------------------- calibration tables
_CAL: Dict[str, Any] = {}


def calibration(name: str) -> Dict[str, Any]:
    if name not in _CAL:
        with open(os.path.join(CAL_DIR, name), "r", encoding="utf-8") as handle:
            _CAL[name] = json.load(handle)
    return _CAL[name]


def release_tables() -> Dict[str, List[float]]:
    """The per-hand release-ratio tables (held / interval to the hand's next heard onset) the base performance draws
    from: the real transcription's quantiles over its *free* notes, those no re-strike of their own pitch cut short.
    The humanizer applies that cut itself (a key cannot be struck again while it is held), so drawing from the
    all-notes table would count it twice."""
    cal = calibration(COVER_FILE)["releasesFreeByHand"]
    return {"RH": cal["RH"]["ratioQuantiles"], "LH": cal["LH"]["ratioQuantiles"]}


def _floor(x: float) -> int:
    i = int(x)
    return i - 1 if x < i else i


def inv_cdf(table: List[float], u: float) -> float:
    """Piecewise-linear inverse CDF through 21 quantiles (p0, p5 ... p100); ``u`` in [0, 1)."""
    x = u * KNOT_N
    i = _floor(x)
    if i >= KNOT_N:
        return float(table[KNOT_N])
    return table[i] + (x - i) * (table[i + 1] - table[i])


def norm(rng: Lcg) -> float:
    """Irwin-Hall: mean 0, sd 1 from twelve uniforms (no log, no sqrt)."""
    s = 0.0
    for _ in range(12):
        s += rng.next()
    return s - 6.0


# ----------------------------------------------------------------------------- profile names
class Spec:
    def __init__(self, name: str, base: str, overlays: Tuple[str, ...]):
        self.name, self.base, self.overlays = name, base, overlays

    @property
    def frame(self) -> float:
        return 0.01 if self.base == "human-real" else 0.032


def parse(name: str) -> Optional[Spec]:
    """A humanizer profile (``cover``, ``cover-pedal+helper`` ...) or None for one of the original profiles."""
    parts = name.split("+")
    if parts[0] not in BASES:
        return None
    for ov in parts[1:]:
        if ov not in OVERLAYS:
            raise KeyError(f"unknown overlay {ov!r} in profile {name!r}")
    return Spec(name, parts[0], tuple(parts[1:]))


def all_profiles() -> List[str]:
    return list(BASES) + [b + "+" + o for b in BASES for o in OVERLAYS]


# ----------------------------------------------------------------------------- timing of the piece
def timing(spec: Spec, rng: Lcg, canon) -> Tuple[float, List[Tuple[Fraction, Fraction, float]]]:
    """(tempo drift amplitude, ritardandi [(q0, q1, depth)]) of the piece. Steady for the cover family."""
    if spec.base != "human-real":
        return 0.0, []
    drift = 0.03 + 0.03 * rng.next()
    bars = [m for m in canon.measures if not m.implicit]
    phrase = 8 if len(bars) >= 16 else 4
    rit: List[Tuple[Fraction, Fraction, float]] = []
    for i in range(phrase - 1, len(bars), phrase):
        end = bars[i].start_q + bars[i].len_q
        rit.append((end - 2, end, RITARD_DEPTH * (0.6 + 0.4 * rng.next())))
    if bars:
        end = bars[-1].start_q + bars[-1].len_q
        if not rit or rit[-1][1] != end:
            rit.append((end - 2, end, RITARD_DEPTH))
    return drift, rit


def _swing_map(spec: Spec, rng: Lcg, canon):
    """q -> q' for the swing base: inside swung bars the second eighth of each beat moves late (R:1)."""
    if spec.base != "swing":
        return lambda q: q
    t = canon.primary_time()
    beat_q = Fraction(1) if t[1] == 4 else (Fraction(2) if t[1] == 2 else None)
    blocks: Dict[int, Optional[Fraction]] = {}
    bars = [m for m in canon.measures if not m.implicit]
    for i in range(0, len(bars), SWING_BLOCK):
        on = rng.next() < 0.5
        ratio = Fraction(int(1600 + 400 * rng.next()), 1000)
        blocks[i // SWING_BLOCK] = ratio if (on and beat_q is not None) else None
    spans = [(m.start_q, m.start_q + m.len_q, blocks[i // SWING_BLOCK]) for i, m in enumerate(bars)]

    def warp(q):
        q = Fraction(q)
        for lo, hi, ratio in spans:
            if lo <= q < hi:
                if ratio is None:
                    return q
                b = (q - lo) // beat_q
                u = (q - lo - b * beat_q) / beat_q
                if u < Fraction(1, 2):
                    v = u * 2 * ratio / (ratio + 1)
                else:
                    v = ratio / (ratio + 1) + (u - Fraction(1, 2)) * 2 / (ratio + 1)
                return lo + (b + v) * beat_q
        return q
    return warp


# ----------------------------------------------------------------------------- the base performance
def render(canon, spec: Spec, rng: Lcg, tm, case_base: str, seed: int):
    """The notes and pedals of one humanized base performance (before any overlay).

    ``notes`` carry ``_truth`` like the original profiles'; the caller sorts and rounds them."""
    cal = calibration(COVER_FILE)
    frame = spec.frame
    base = spec.base
    fam = base if base in ("human-real", "cover-alt") else "cover"
    jit_sd = JITTER_SD.get(fam, 0.0)
    vel = VEL[fam]
    chord_p = cal["chords"]["spreadOneFrame"]
    rel_tab = {"RH": ALT_RATIO, "LH": ALT_RATIO} if base == "cover-alt" else release_tables()
    warp = _swing_map(spec, rng, canon)

    def quant(t: float) -> float:
        # the nearest frame: a floor would shift every onset 16 ms early, a bias the real residual does not have
        return _floor(t / frame + 0.5) * frame

    played = sorted(canon.played(), key=lambda s: (s.onset_q, s.staff, s.midi))
    by_onset: Dict[Fraction, List[Any]] = {}
    groups: Dict[Tuple[Fraction, str], List[Any]] = {}
    for s in played:
        by_onset.setdefault(s.onset_q, []).append(s)
        groups.setdefault((s.onset_q, s.hand), []).append(s)
    first_beat = {m.start_q for m in canon.measures if not m.implicit}

    # 1) heard onsets: the cover family draws one jitter per attack and rounds it to the nearest frame; chords may split by
    #    one frame. human-real draws a jitter per note and rolls some chords, on a 10-ms clock.
    heard: Dict[int, float] = {}
    nominal_on: Dict[int, float] = {}
    nominal_off: Dict[int, float] = {}
    for s in played:
        nominal_on[s.id] = tm.sec(warp(s.onset_q))
        nominal_off[s.id] = tm.sec(warp(s.onset_q + s.dur_q))
    roll: Dict[int, float] = {}
    if base == "human-real":
        for key in sorted(groups, key=lambda k: (k[0], k[1])):
            g = groups[key]
            if len(g) >= 3 and rng.next() < ROLL_P:
                for i, s in enumerate(sorted(g, key=lambda s: s.midi)):
                    roll[s.id] = ROLL_STEP * i
    for q in sorted(by_onset):
        g = sorted(by_onset[q], key=lambda s: (s.midi, s.staff))
        if base == "human-real":
            for s in g:
                heard[s.id] = quant(nominal_on[s.id] + jit_sd * norm(rng) + roll.get(s.id, 0.0))
            continue
        if base == "cover-alt":                                  # triangular: two uniforms averaged
            jit = (rng.uniform(-ALT_JITTER, ALT_JITTER) + rng.uniform(-ALT_JITTER, ALT_JITTER)) / 2
        else:
            jit = jit_sd * norm(rng)
        t = quant(nominal_on[g[0].id] + jit)
        cut = len(g)
        if len(g) >= 2 and rng.next() < chord_p:
            cut = 1 + int(rng.next() * (len(g) - 1))      # notes from `cut` up sound one frame later
        for i, s in enumerate(g):
            heard[s.id] = t + (frame if i >= cut else 0.0)

    # 2) velocity
    vels: Dict[int, int] = {}
    for s in played:
        g = groups[(s.onset_q, s.hand)]
        top = s.hand == "r" and s.midi == max(x.midi for x in g)
        bottom = s.hand == "l" and s.midi == min(x.midi for x in g)
        v = vel["base"] + vel["top"] * top + vel["bottom"] * bottom + vel["accent"] * (s.onset_q in first_beat) + \
            vel["noise"] * norm(rng)
        vels[s.id] = int(_floor(min(110.0, max(20.0, v)) + 0.5))

    # 3) releases. The ratio (held / interval to the hand's next heard onset) comes from the calibration table of
    #    the hand; a note before a written silence is articulated; with the pedal the key comes up dry and the
    #    sound lasts to the pedal.
    def attack_starts(xs: List[float]) -> List[float]:
        """Onsets within 50 ms of an attack's first onset belong to that attack (a chord sounding one frame apart)."""
        out_: List[float] = []
        for t in xs:
            if not out_ or t - out_[-1] > 0.05:
                out_.append(t)
        return out_

    hand_on: Dict[str, List[float]] = {"RH": [], "LH": []}
    nom_hand_on: Dict[str, List[float]] = {"RH": [], "LH": []}
    for s in played:
        L = "RH" if s.hand == "r" else "LH"
        hand_on[L].append(_floor(heard[s.id] * 1000 + 0.5) / 1000.0)
        nom_hand_on[L].append(nominal_on[s.id])
    for L in hand_on:
        hand_on[L] = attack_starts(sorted(set(hand_on[L])))
        nom_hand_on[L] = sorted(set(nom_hand_on[L]))

    def next_after(xs: List[float], t: float) -> Optional[float]:
        lo, hi = 0, len(xs)
        while lo < hi:
            mid = (lo + hi) // 2
            if xs[mid] > t:
                hi = mid
            else:
                lo = mid + 1
        return xs[lo] if lo < len(xs) else None

    pedals: List[Dict[str, float]] = []
    spans: List[Tuple[float, float]] = []
    last_on = max(heard.values())             # no pedal is pressed after the last attack (the SUT's graph builder refuses it)
    if base == "cover-pedal":
        for m in canon.measures:
            if m.implicit and m.index == 0:
                continue
            down, up = tm.sec(m.start_q) + 0.05, tm.sec(m.start_q + m.len_q) - 0.02
            if up > down + MIN_PEDAL_S and down < last_on:
                pedals.append({"on": round_t(down), "off": round_t(up)})
                spans.append((down, quant(up)))
    by_pitch: Dict[int, List[Tuple[float, int]]] = {}
    for s in played:
        by_pitch.setdefault(s.midi, []).append((heard[s.id], s.id))
    for k in by_pitch:
        by_pitch[k].sort()

    out: List[Dict[str, Any]] = []
    for s in played:
        L = "RH" if s.hand == "r" else "LH"
        on = heard[s.id]
        wdur = nominal_off[s.id] - nominal_on[s.id]
        nx = next_after(hand_on[L], on + 1e-9)
        nx_nom = next_after(nom_hand_on[L], nominal_on[s.id] + 0.02)
        before_rest = nx_nom is not None and nx_nom - nominal_off[s.id] > 0.02
        if nx is None:
            held = wdur * (0.8 + 0.2 * rng.next())
        elif before_rest:
            held = wdur * (0.6 + 0.35 * rng.next())
        elif base == "cover-pedal":
            held = min(wdur * (0.7 + 0.3 * rng.next()), nx - on - frame)      # the key comes up dry ...
        else:
            held = inv_cdf(rel_tab[L], rng.next()) * (nx - on)
        off = on + max(1, _floor(held / frame + 0.5)) * frame
        if base == "cover-pedal":                                              # ... the damper keeps the sound
            for lo, hi in spans:
                if lo <= off < hi:
                    off = max(off, hi)
                    break
        # never past the next onset of the same pitch (one frame earlier)
        nxt = next((t for t, i in by_pitch[s.midi] if t > on + 1e-9), None)
        if nxt is not None and off > nxt - frame:
            off = max(on + frame, nxt - frame)
        out.append({"on": on, "off": off, "midi": s.midi, "vel": vels[s.id],
                    "_truth": {"ref": s.id, "nominal_on": nominal_on[s.id], "nominal_off": nominal_off[s.id]}})
    return out, pedals


# ----------------------------------------------------------------------------- overlays
def overlay_of(notes: List[Dict[str, Any]], rng: Lcg, frame: float) -> Tuple[List[Dict[str, Any]], Dict[str, int]]:
    """The production browser model's errors (docs/GOALS/G10 section 7.3): isolated notes shorter than 55 ms are
    dropped (the app's filter), inner notes of a chord are missed 3 % of the time, 3 % extras (octave ghosts),
    a repeated note one frame after the previous release merges 20 % of the time (a guess: nothing measured). The model
    hears no pedal."""
    err = {"dropped": 0, "ghosts": 0, "merged": 0}
    onset_groups: Dict[float, List[Dict[str, Any]]] = {}
    for n in notes:
        onset_groups.setdefault(n["on"], []).append(n)
    out: List[Dict[str, Any]] = []
    for n in notes:
        g = onset_groups[n["on"]]
        lo, hi = min(x["midi"] for x in g), max(x["midi"] for x in g)
        isolated = len(g) == 1
        if isolated and n["off"] - n["on"] < 0.055:
            err["dropped"] += 1
            continue
        if len(g) >= 3 and lo < n["midi"] < hi and rng.next() < 0.03:
            err["dropped"] += 1
            continue
        out.append(n)
        if rng.next() < 0.03:
            interval = 12 if rng.next() < 0.7 else 19
            if n["midi"] + interval <= 108:
                length = (2 + int(rng.next() * 3)) * frame
                out.append({"on": n["on"], "off": n["on"] + length, "midi": n["midi"] + interval,
                            "vel": max(20, n["vel"] // 2), "_truth": {"ref": None, "nominal_on": n["on"], "nominal_off": n["on"] + length}})
                err["ghosts"] += 1
    out.sort(key=lambda n: (n["on"], n["midi"], n["off"]))
    merged: List[Dict[str, Any]] = []
    last: Dict[int, Dict[str, Any]] = {}
    for n in out:
        prev = last.get(n["midi"])
        if prev is not None and n["on"] - prev["off"] < frame + 1e-9 and rng.next() < MERGE_P:
            prev["off"] = max(prev["off"], n["off"])
            err["merged"] += 1
            continue
        merged.append(n)
        last[n["midi"]] = n
    return merged, err


def overlay_helper(notes: List[Dict[str, Any]], pedals: List[Dict[str, float]], rng: Lcg, canon, tm
                   ) -> Tuple[List[Dict[str, Any]], List[Dict[str, float]], Dict[str, int]]:
    """The helper ensemble's measured errors (corpus/calibration/replay-helper.json, six rendered fixtures through
    TransKun + Kong): onset +9 ms (sd 2.9), an offset-error table, 1.9 % missed, 3.3 % extra, and a pedal the
    performer never played in five pieces of six."""
    cal = calibration(HELPER_FILE)
    on_bias, on_sd = cal["onsetErrorMs"]["mean"] / 1000.0, cal["onsetErrorMs"]["sd"] / 1000.0
    off_tab = [min(TAIL_MS, max(-TAIL_MS, v)) / 1000.0 for v in cal["offsetErrorMs"]["quantiles"]]
    p_miss, p_extra = cal["missed"], cal["extra"]
    err = {"dropped": 0, "ghosts": 0, "merged": 0}
    out: List[Dict[str, Any]] = []
    for n in notes:
        if rng.next() < p_miss:
            err["dropped"] += 1
            continue
        on = n["on"] + on_bias + on_sd * norm(rng)
        off = max(on + 0.03, n["off"] + inv_cdf(off_tab, rng.next()))
        m = dict(n)
        m["on"], m["off"] = on, off
        out.append(m)
        if rng.next() < p_extra:
            interval = 12 if rng.next() < 0.7 else 19
            if n["midi"] + interval <= 108:
                length = 0.06 + 0.09 * rng.next()
                out.append({"on": on, "off": on + length, "midi": n["midi"] + interval, "vel": max(20, n["vel"] // 2),
                            "_truth": {"ref": None, "nominal_on": on, "nominal_off": on + length}})
                err["ghosts"] += 1
    invented: List[Dict[str, float]] = []
    last_on = max((n["on"] for n in notes), default=0.0)
    if rng.next() < 5.0 / 6.0:
        for m in canon.measures:
            if m.implicit and m.index == 0:
                continue
            if rng.next() < 0.7:
                lo, hi = tm.sec(m.start_q), tm.sec(m.start_q + m.len_q)      # not aligned with the bar, unlike a played pedal
                down, up = lo + (hi - lo) * (0.02 + 0.15 * rng.next()), hi - (hi - lo) * (0.02 + 0.10 * rng.next())
                if up > down + MIN_PEDAL_S and down < last_on:
                    invented.append({"on": round_t(down), "off": round_t(up)})
    return out, invented, err
