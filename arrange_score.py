#!/usr/bin/env python3
"""Phrase-aware piano accompaniment arranger for PPP.

The browser sends one of PPP's compact score objects on stdin and receives a
new note list on stdout.  The design follows the useful split in AccoMontage:
global harmonic/phrase planning first, detailed texture generation second.
Unlike the old browser arranger it does not assume that the lowest note of an
entire bar is the chord root, and it never changes the source metre.

music21 is optional.  When present it supplies an additional key estimate and
chord names; the deterministic planner remains available without it so an
arrangement never depends on a research checkpoint or a network service.
"""

from __future__ import annotations

import itertools
import json
import math
import sys
from collections import Counter, defaultdict
from dataclasses import dataclass
from typing import Any, Iterable

try:  # Optional, deliberately isolated from the real-time browser code.
    from music21 import chord as m21_chord
    from music21 import harmony as m21_harmony
    from music21 import key as m21_key
    from music21 import note as m21_note
    from music21 import stream as m21_stream

    HAVE_MUSIC21 = True
except Exception:  # pragma: no cover - the standard-library fallback is tested.
    HAVE_MUSIC21 = False


LEVELS = {"beginner", "intermediate", "advanced", "original"}
STYLES = {"balanced", "jazz", "ballad", "pop", "waltz", "bossa", "cinematic"}
MAJOR_TONICS = [11, 6, 1, 8, 3, 10, 5, 0, 7, 2, 9, 4, 11, 6, 1]
MINOR_TONICS = [8, 3, 10, 5, 0, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10]
MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]

QUALITY_INTERVALS = {
    "maj": (0, 4, 7),
    "min": (0, 3, 7),
    "dim": (0, 3, 6),
    "sus4": (0, 5, 7),
    "7": (0, 4, 7, 10),
    "maj7": (0, 4, 7, 11),
    "min7": (0, 3, 7, 10),
    "m7b5": (0, 3, 6, 10),
}

TYPE_BY_Q = (
    (3.5, "whole"),
    (1.75, "half"),
    (0.75, "quarter"),
    (0.375, "eighth"),
    (0.1875, "16th"),
    (0.09375, "32nd"),
)


def clamp(value: float, lo: float, hi: float) -> float:
    return lo if value < lo else hi if value > hi else value


def qround(value: float) -> float:
    return round(float(value) * 96.0) / 96.0


def note_type(duration: float) -> str:
    for threshold, name in TYPE_BY_Q:
        if duration >= threshold:
            return name
    return "64th"


def midi_name(midi: int, prefer_flats: bool = False) -> str:
    sharp = ("C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B")
    flat = ("C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B")
    names = flat if prefer_flats else sharp
    return f"{names[midi % 12]}{midi // 12 - 1}"


@dataclass(frozen=True)
class Harmony:
    root: int
    quality: str

    @property
    def pcs(self) -> tuple[int, ...]:
        return tuple((self.root + i) % 12 for i in QUALITY_INTERVALS[self.quality])


@dataclass
class Slot:
    measure: dict[str, Any]
    start: float
    end: float
    index_in_measure: int
    observations: dict[int, float]
    bass_pc: int | None
    melody_pc: int | None
    candidates: list[tuple[Harmony, float]]
    harmony: Harmony | None = None
    voicing: tuple[int, ...] = ()


class Arranger:
    def __init__(self, payload: dict[str, Any]):
        score = payload.get("score") or {}
        options = payload.get("arrangement") or {}
        self.level = options.get("level") if options.get("level") in LEVELS else "intermediate"
        self.style = options.get("style") if options.get("style") in STYLES else "balanced"
        self.tempo = clamp(float(score.get("tempo") or 80), 30, 300)
        self.measures = self._measures(score.get("measures"))
        self.by_number = {m["number"]: m for m in self.measures}
        self.notes = self._notes(score.get("notes"))
        self.sections = score.get("sections") if isinstance(score.get("sections"), list) else []
        self.prefer_flats = self._prefer_flats()
        self.key_pc, self.key_mode, self.key_source = self._infer_key()
        self.scale_pcs = self._scale_pcs()
        self.melody = self._extract_melody()
        self.melody_by_measure = defaultdict(list)
        for n in self.melody:
            self.melody_by_measure[n["m"]].append(n)
        self.slots = self._make_slots()

    @staticmethod
    def _measures(raw: Any) -> list[dict[str, Any]]:
        if not isinstance(raw, list) or not raw or len(raw) > 2000:
            raise ValueError("A score with 1 to 2000 measures is required.")
        out: list[dict[str, Any]] = []
        start = 0.0
        for index, source in enumerate(raw):
            if not isinstance(source, dict):
                continue
            time = source.get("time") if isinstance(source.get("time"), dict) else {}
            beats = int(clamp(float(time.get("beats") or 4), 1, 24))
            beat_type = int(time.get("beatType") or 4)
            if beat_type not in (1, 2, 4, 8, 16, 32):
                beat_type = 4
            expected = beats * 4.0 / beat_type
            length = float(source.get("lenQ") or expected)
            length = clamp(length, 0.125, 32.0)
            number = source.get("number", index + 1)
            m = dict(source)
            m.update({
                "number": number,
                "lenQ": length,
                "time": {"beats": beats, "beatType": beat_type},
                "_start": start,
                "_index": index,
            })
            out.append(m)
            start += length
        if not out:
            raise ValueError("The score has no usable measures.")
        return out

    def _notes(self, raw: Any) -> list[dict[str, Any]]:
        if not isinstance(raw, list) or len(raw) > 50000:
            raise ValueError("The score note list is missing or too large.")
        out: list[dict[str, Any]] = []
        for source in raw:
            if not isinstance(source, dict) or source.get("rest") or source.get("midi") is None:
                continue
            measure = self.by_number.get(source.get("m"))
            if not measure:
                continue
            try:
                midi = int(round(float(source["midi"])))
                beat = float(source.get("b") or 0)
                duration = float(source.get("dur") or 0.25)
            except (TypeError, ValueError):
                continue
            if not 21 <= midi <= 108 or beat < -0.02 or beat >= measure["lenQ"] + 0.05:
                continue
            n = dict(source)
            n.update({
                "midi": midi,
                "b": clamp(beat, 0, measure["lenQ"] - 0.01),
                "dur": clamp(duration, 0.0625, measure["lenQ"]),
                "_abs": measure["_start"] + clamp(beat, 0, measure["lenQ"]),
            })
            out.append(n)
        if not out:
            raise ValueError("The score has no sounding notes to arrange.")
        out.sort(key=lambda n: (n["_abs"], n["midi"]))
        return out

    def _prefer_flats(self) -> bool:
        fifths = []
        for m in self.measures:
            key = m.get("key") if isinstance(m.get("key"), dict) else {}
            if key.get("fifths") is not None:
                try:
                    fifths.append(int(key["fifths"]))
                except (TypeError, ValueError):
                    pass
        return bool(fifths and Counter(fifths).most_common(1)[0][0] < 0)

    def _signature_key(self) -> tuple[int, str] | None:
        keys: list[tuple[int, str]] = []
        for m in self.measures:
            raw = m.get("key") if isinstance(m.get("key"), dict) else {}
            try:
                fifths = int(raw.get("fifths"))
            except (TypeError, ValueError):
                continue
            if not -7 <= fifths <= 7:
                continue
            mode = "minor" if str(raw.get("mode") or "").lower() == "minor" else "major"
            keys.append((fifths, mode))
        if not keys:
            return None
        (fifths, mode), count = Counter(keys).most_common(1)[0]
        # A default C major signature on every inferred score is weak evidence;
        # let pitch statistics challenge it below.
        tonic = (MINOR_TONICS if mode == "minor" else MAJOR_TONICS)[fifths + 7]
        return tonic, mode

    def _profile_key(self) -> tuple[int, str, float]:
        histogram = [0.0] * 12
        for n in self.notes:
            weight = min(3.0, n["dur"]) * (1.18 if n.get("hand") == "l" or n.get("staff") == 2 else 1.0)
            histogram[n["midi"] % 12] += weight
        total = sum(histogram) or 1.0
        hist = [x / total for x in histogram]
        ranked: list[tuple[float, int, str]] = []
        for mode, profile in (("major", MAJOR_PROFILE), ("minor", MINOR_PROFILE)):
            norm = sum(profile)
            p = [x / norm for x in profile]
            for tonic in range(12):
                score = sum(hist[pc] * p[(pc - tonic) % 12] for pc in range(12))
                ranked.append((score, tonic, mode))
        ranked.sort(reverse=True)
        margin = ranked[0][0] - ranked[1][0]
        return ranked[0][1], ranked[0][2], margin

    def _music21_key(self) -> tuple[int, str, float] | None:
        if not HAVE_MUSIC21:
            return None
        try:
            part = m21_stream.Part()
            # Analysis does not improve after thousands of repeated tremolo
            # notes, so keep a duration-weighted, deterministic sample.
            sample = self.notes if len(self.notes) <= 5000 else self.notes[:: max(1, len(self.notes) // 5000)]
            for item in sample:
                n = m21_note.Note(item["midi"])
                n.quarterLength = max(0.125, min(4.0, item["dur"]))
                part.insert(item["_abs"], n)
            found = part.analyze("key")
            return int(found.tonic.pitchClass), str(found.mode), float(getattr(found, "correlationCoefficient", 0.0) or 0.0)
        except Exception:
            return None

    def _infer_key(self) -> tuple[int, str, str]:
        signature = self._signature_key()
        prof_pc, prof_mode, margin = self._profile_key()
        m21 = self._music21_key()
        if m21 and (not signature or m21[2] >= 0.72):
            return m21[0], m21[1], "music21"
        if signature:
            sig_pc, sig_mode = signature
            # Keep an authored signature.  For the ubiquitous inferred C-major
            # default, use the profile when it has a meaningful lead.
            if (sig_pc, sig_mode) != (0, "major") or margin < 0.00045:
                return sig_pc, sig_mode, "signature"
        return prof_pc, prof_mode, "pitch-profile"

    def _scale_pcs(self) -> set[int]:
        intervals = (0, 2, 3, 5, 7, 8, 10) if self.key_mode == "minor" else (0, 2, 4, 5, 7, 9, 11)
        return {(self.key_pc + i) % 12 for i in intervals}

    @staticmethod
    def _clean_source_note(source: dict[str, Any]) -> dict[str, Any]:
        keep = {"m", "b", "dur", "midi", "staff", "hand", "voice", "type", "dots", "acc", "dyn"}
        n = {k: source[k] for k in keep if k in source}
        midi = int(source["midi"])
        n.update({
            "m": source["m"],
            "b": qround(source["b"]),
            "dur": max(0.0625, qround(source["dur"])),
            "midi": midi,
            "p": source.get("p") or midi_name(midi),
            "staff": 1,
            "hand": "r",
            "voice": 1,
            "type": note_type(source["dur"]),
            "dots": int(source.get("dots") or 0),
            "chord": False,
        })
        return n

    def _extract_melody(self) -> list[dict[str, Any]]:
        attacks: list[tuple[float, list[dict[str, Any]]]] = []
        grouped: dict[float, list[dict[str, Any]]] = defaultdict(list)
        for n in self.notes:
            if n.get("hand") == "x":
                continue
            grouped[round(n["_abs"] * 96) / 96].append(n)
        for at in sorted(grouped):
            group = grouped[at]
            right = [n for n in group if n.get("hand") == "r" or n.get("staff") == 1]
            if not right:
                continue
            # One candidate per pitch; voices and long values are useful clues.
            by_pitch: dict[int, dict[str, Any]] = {}
            for n in right:
                prior = by_pitch.get(n["midi"])
                if prior is None or (n.get("voice") == 1, n["dur"]) > (prior.get("voice") == 1, prior["dur"]):
                    by_pitch[n["midi"]] = n
            candidates = sorted(by_pitch.values(), key=lambda n: n["midi"], reverse=True)[:5]
            attacks.append((at, candidates))
        if not attacks:
            attacks = [(n["_abs"], [n]) for n in self.notes]

        costs: list[list[float]] = []
        back: list[list[int]] = []
        for index, (at, candidates) in enumerate(attacks):
            row: list[float] = []
            row_back: list[int] = []
            for candidate in candidates:
                pitch = candidate["midi"]
                rank_cost = -0.035 * pitch
                rank_cost -= 0.8 if candidate.get("voice") in (None, 1, "1") else 0.0
                rank_cost -= 0.22 * min(2.0, candidate["dur"])
                if index == 0:
                    row.append(rank_cost)
                    row_back.append(-1)
                    continue
                gap = max(0.125, at - attacks[index - 1][0])
                best_cost = float("inf")
                best_index = 0
                for prev_index, previous in enumerate(attacks[index - 1][1]):
                    leap = abs(pitch - previous["midi"])
                    transition = 0.045 * leap + 0.12 * max(0, leap - 12)
                    if gap > 2.5:
                        transition *= 0.35
                    if candidate.get("voice") == previous.get("voice"):
                        transition -= 0.18
                    value = costs[-1][prev_index] + transition + rank_cost
                    if value < best_cost:
                        best_cost, best_index = value, prev_index
                row.append(best_cost)
                row_back.append(best_index)
            costs.append(row)
            back.append(row_back)

        chosen: list[dict[str, Any]] = []
        cursor = min(range(len(costs[-1])), key=lambda i: costs[-1][i])
        indices = [0] * len(attacks)
        for attack_index in range(len(attacks) - 1, -1, -1):
            indices[attack_index] = cursor
            cursor = back[attack_index][cursor]
            if cursor < 0:
                cursor = 0
        for i, (_, candidates) in enumerate(attacks):
            chosen.append(self._clean_source_note(candidates[indices[i]]))

        # Do not let a copied value obscure the next melodic attack in the same
        # bar.  This also prevents the arranger from inventing legato/ties.
        for i, n in enumerate(chosen[:-1]):
            nxt = chosen[i + 1]
            if n["m"] == nxt["m"] and nxt["b"] > n["b"]:
                n["dur"] = max(0.0625, min(n["dur"], qround(nxt["b"] - n["b"])))
                n["type"] = note_type(n["dur"])
        return chosen

    def _slot_size(self, measure: dict[str, Any]) -> float:
        beat = 4.0 / measure["time"]["beatType"]
        if self.level == "beginner":
            return measure["lenQ"]
        if self.level == "intermediate":
            return measure["lenQ"] if self.tempo >= 156 else max(beat, min(measure["lenQ"], beat * 2))
        return max(beat, beat * 2 if self.tempo >= 188 else beat)

    def _slot_observations(self, start: float, end: float) -> tuple[dict[int, float], int | None]:
        obs = [0.0] * 12
        active: list[tuple[dict[str, Any], float]] = []
        for n in self.notes:
            n_start, n_end = n["_abs"], n["_abs"] + n["dur"]
            overlap = min(end, n_end) - max(start, n_start)
            if overlap <= 0:
                continue
            weight = min(end - start, overlap) / max(0.125, end - start)
            if start <= n_start < end:
                weight += 0.55
            if n.get("hand") == "l" or n.get("staff") == 2:
                weight *= 1.22
            obs[n["midi"] % 12] += weight
            active.append((n, weight))
        if not active:
            return {}, None
        low = min(active, key=lambda pair: pair[0]["midi"])[0]
        obs[low["midi"] % 12] += 0.9
        return {pc: value for pc, value in enumerate(obs) if value > 0}, low["midi"] % 12

    def _melody_pc_at(self, start: float, end: float) -> int | None:
        found = []
        for n in self.melody:
            measure = self.by_number.get(n["m"])
            absolute = (measure["_start"] if measure else 0) + n["b"]
            if start <= absolute < end:
                found.append(n["midi"])
        return max(found) % 12 if found else None

    def _qualities(self) -> tuple[str, ...]:
        if self.level == "beginner":
            return ("maj", "min", "dim", "sus4")
        if self.style in {"jazz", "bossa"} or self.level in {"advanced", "original"}:
            return tuple(QUALITY_INTERVALS)
        return ("maj", "min", "dim", "sus4", "7", "maj7", "min7")

    def _candidate_score(self, harmony: Harmony, slot: Slot) -> float:
        pcs = set(harmony.pcs)
        total = sum(slot.observations.values()) or 1.0
        covered = sum(weight for pc, weight in slot.observations.items() if pc in pcs)
        foreign = total - covered
        score = covered * 1.55 - foreign * 0.54
        root_weight = slot.observations.get(harmony.root, 0.0)
        third_pc = (harmony.root + QUALITY_INTERVALS[harmony.quality][1]) % 12
        score += root_weight * 0.42 + slot.observations.get(third_pc, 0.0) * 0.25
        if slot.bass_pc is not None:
            if slot.bass_pc == harmony.root:
                score += 1.2
            elif slot.bass_pc == (harmony.root + 7) % 12:
                score += 0.38
            elif slot.bass_pc not in pcs:
                score -= 0.32
        if slot.melody_pc is not None:
            score += 0.58 if slot.melody_pc in pcs else (-0.08 if slot.melody_pc in self.scale_pcs else -0.34)
        diatonic = sum(1 for pc in pcs if pc in self.scale_pcs) / len(pcs)
        score += 0.78 * diatonic
        if harmony.root == self.key_pc:
            score += 0.3
        elif harmony.root == (self.key_pc + 7) % 12:
            score += 0.18
        if harmony.quality in {"dim", "m7b5", "sus4"}:
            score -= 0.12
        return score

    def _make_slots(self) -> list[Slot]:
        out: list[Slot] = []
        qualities = self._qualities()
        for measure in self.measures:
            size = self._slot_size(measure)
            count = max(1, int(math.ceil(measure["lenQ"] / size - 1e-9)))
            actual = measure["lenQ"] / count
            for index in range(count):
                start = measure["_start"] + index * actual
                end = measure["_start"] + (index + 1) * actual
                observations, bass_pc = self._slot_observations(start, end)
                slot = Slot(measure, start, end, index, observations, bass_pc, self._melody_pc_at(start, end), [])
                candidates = [Harmony(root, quality) for root in range(12) for quality in qualities]
                ranked = sorted(((h, self._candidate_score(h, slot)) for h in candidates), key=lambda pair: pair[1], reverse=True)
                keep = ranked[:14]
                # Always give tonic and dominant a route through sparse/rest bars.
                for required in (Harmony(self.key_pc, "min" if self.key_mode == "minor" else "maj"), Harmony((self.key_pc + 7) % 12, "7" if "7" in qualities else "maj")):
                    if required.quality in qualities and all(item[0] != required for item in keep):
                        keep.append((required, self._candidate_score(required, slot)))
                slot.candidates = keep
                out.append(slot)
        self._plan_harmony(out)
        self._plan_voicings(out)
        return out

    def _section_starts(self) -> set[Any]:
        starts = {self.measures[0]["number"]}
        for section in self.sections:
            if isinstance(section, dict) and section.get("from") in self.by_number:
                starts.add(section["from"])
        return starts

    def _transition_cost(self, previous: Harmony, current: Harmony, slot: Slot, section_starts: set[Any]) -> float:
        if previous == current:
            return -0.22
        root_motion = (current.root - previous.root) % 12
        cost = {5: 0.08, 7: 0.08, 2: 0.22, 10: 0.22, 3: 0.30, 4: 0.30}.get(root_motion, 0.46)
        common = len(set(previous.pcs) & set(current.pcs))
        cost -= 0.07 * common
        if previous.root == (current.root + 7) % 12:
            cost -= 0.28  # dominant-like resolution
        change_weight = {"beginner": 1.25, "intermediate": 0.72, "advanced": 0.38, "original": 0.32}[self.level]
        if self.style in {"jazz", "bossa"}:
            change_weight *= 0.72
        if slot.index_in_measure == 0:
            change_weight *= 0.58
        if slot.measure["number"] in section_starts:
            change_weight *= 0.35
        return cost + change_weight

    def _plan_harmony(self, slots: list[Slot]) -> None:
        section_starts = self._section_starts()
        costs: list[list[float]] = []
        backs: list[list[int]] = []
        for index, slot in enumerate(slots):
            row: list[float] = []
            back: list[int] = []
            for harmony, emission in slot.candidates:
                if index == 0:
                    row.append(-emission)
                    back.append(-1)
                    continue
                options = [
                    costs[-1][j] + self._transition_cost(prev_harmony, harmony, slot, section_starts) - emission
                    for j, (prev_harmony, _) in enumerate(slots[index - 1].candidates)
                ]
                best = min(range(len(options)), key=options.__getitem__)
                row.append(options[best])
                back.append(best)
            costs.append(row)
            backs.append(back)
        cursor = min(range(len(costs[-1])), key=lambda i: costs[-1][i])
        for index in range(len(slots) - 1, -1, -1):
            slots[index].harmony = slots[index].candidates[cursor][0]
            cursor = backs[index][cursor]
            if cursor < 0:
                cursor = 0

    def _melody_floor(self, slot: Slot) -> int:
        pitches = []
        for n in self.melody_by_measure.get(slot.measure["number"], []):
            absolute = slot.measure["_start"] + n["b"]
            if slot.start <= absolute < slot.end:
                pitches.append(n["midi"])
        return min(pitches) if pitches else 81

    def _voicing_intervals(self, harmony: Harmony) -> list[int]:
        base = list(QUALITY_INTERVALS[harmony.quality])
        if self.style in {"jazz", "bossa"}:
            order = {
                "maj": [4, 11, 2, 7], "min": [3, 10, 2, 7], "dim": [3, 9, 6, 0],
                "sus4": [5, 10, 2, 7], "7": [4, 10, 2, 7], "maj7": [4, 11, 2, 7],
                "min7": [3, 10, 2, 7], "m7b5": [3, 10, 6, 0],
            }[harmony.quality]
        else:
            order = base[1:] + [0, 12]
        voices = {"beginner": 2, "intermediate": 3, "advanced": 4, "original": 4}[self.level]
        return order[:voices]

    def _voicing_options(self, slot: Slot) -> list[tuple[int, ...]]:
        harmony = slot.harmony or Harmony(self.key_pc, "maj")
        pcs = [((harmony.root + interval) % 12) for interval in self._voicing_intervals(harmony)]
        upper = int(clamp(self._melody_floor(slot) - 2, 62, 78))
        pools: list[list[int]] = []
        for pc in pcs:
            pools.append([p for p in range(48, upper + 1) if p % 12 == pc])
        options: list[tuple[float, tuple[int, ...]]] = []
        for product in itertools.product(*pools):
            pitches = tuple(sorted(product))
            if len(set(pitches)) != len(pitches):
                continue
            gaps = [b - a for a, b in zip(pitches, pitches[1:])]
            if any(gap < 2 or gap > 12 for gap in gaps) or pitches[-1] - pitches[0] > 24:
                continue
            center = sum(pitches) / len(pitches)
            local = abs(center - (61 if self.style in {"jazz", "bossa"} else 59)) * 0.08
            local += max(0, pitches[-1] - 72) * 0.08
            options.append((local, pitches))
        if not options:
            fallback = []
            for pc in pcs:
                choices = [p for p in range(48, upper + 1) if p % 12 == pc]
                fallback.append(min(choices or [60 + ((pc - 0) % 12)], key=lambda p: abs(p - 60)))
            return [tuple(sorted(set(fallback)))]
        options.sort(key=lambda item: item[0])
        return [pitches for _, pitches in options[:24]]

    @staticmethod
    def _voicing_motion(previous: tuple[int, ...], current: tuple[int, ...]) -> float:
        if not previous:
            return 0.0
        count = min(len(previous), len(current))
        motion = sum(abs(previous[i] - current[i]) for i in range(count))
        motion += 4 * abs(len(previous) - len(current))
        common = len({p % 12 for p in previous} & {p % 12 for p in current})
        return motion * 0.12 - common * 0.16

    def _plan_voicings(self, slots: list[Slot]) -> None:
        options = [self._voicing_options(slot) for slot in slots]
        costs: list[list[float]] = []
        backs: list[list[int]] = []
        for i, choices in enumerate(options):
            row: list[float] = []
            back: list[int] = []
            for current in choices:
                local = abs(sum(current) / len(current) - 60) * 0.035
                if i == 0:
                    row.append(local)
                    back.append(-1)
                else:
                    values = [costs[-1][j] + self._voicing_motion(previous, current) + local for j, previous in enumerate(options[i - 1])]
                    best = min(range(len(values)), key=values.__getitem__)
                    row.append(values[best])
                    back.append(best)
            costs.append(row)
            backs.append(back)
        cursor = min(range(len(costs[-1])), key=lambda i: costs[-1][i])
        for i in range(len(slots) - 1, -1, -1):
            slots[i].voicing = options[i][cursor]
            cursor = backs[i][cursor]
            if cursor < 0:
                cursor = 0

    def _slot_at(self, measure: dict[str, Any], offset: float) -> Slot:
        absolute = measure["_start"] + offset
        candidates = [slot for slot in self.slots if slot.measure is measure]
        for slot in candidates:
            if slot.start - 1e-6 <= absolute < slot.end - 1e-6:
                return slot
        return candidates[-1]

    def _bass_pitch(self, root_pc: int, previous: int | None, prefer_fifth: bool = False) -> int:
        pc = (root_pc + (7 if prefer_fifth else 0)) % 12
        candidates = [p for p in range(34, 51) if p % 12 == pc]
        target = previous if previous is not None else 42
        return min(candidates, key=lambda p: abs(p - target))

    def _new_note(self, measure: dict[str, Any], beat: float, duration: float, midi: int, staff: int = 2) -> dict[str, Any] | None:
        if beat < -1e-6 or beat >= measure["lenQ"] - 0.02 or not 21 <= midi <= 108:
            return None
        duration = max(0.0625, min(duration, measure["lenQ"] - beat))
        duration = qround(duration)
        return {
            "m": measure["number"], "b": qround(beat), "dur": duration,
            "midi": int(midi), "p": midi_name(int(midi), self.prefer_flats),
            "staff": staff, "hand": "l" if staff == 2 else "r", "voice": 5 if staff == 2 else 2,
            "type": note_type(duration), "dots": 0, "chord": False,
        }

    def _add(self, output: list[dict[str, Any]], measure: dict[str, Any], beat: float, duration: float, pitches: int | Iterable[int], staff: int = 2) -> None:
        values = [pitches] if isinstance(pitches, int) else list(pitches)
        for midi in values:
            n = self._new_note(measure, beat, duration, int(midi), staff)
            if n:
                output.append(n)

    def _texture(self) -> list[dict[str, Any]]:
        output = list(self.melody)
        previous_bass: int | None = None
        density = {"beginner": 0, "intermediate": 1, "advanced": 2, "original": 2}[self.level]
        for measure in self.measures:
            length = measure["lenQ"]
            beat_q = 4.0 / measure["time"]["beatType"]
            beats = max(1, measure["time"]["beats"])

            def data(at: float) -> tuple[Slot, int]:
                nonlocal previous_bass
                slot = self._slot_at(measure, min(length - 0.01, max(0, at)))
                root = (slot.harmony or Harmony(self.key_pc, "maj")).root
                bass = self._bass_pitch(root, previous_bass)
                previous_bass = bass
                return slot, bass

            if self.style == "jazz":
                for i in range(beats):
                    at = i * beat_q
                    slot, bass = data(at)
                    walking = self._bass_pitch((slot.harmony or Harmony(self.key_pc, "maj")).root, previous_bass, i % 2 == 1)
                    previous_bass = walking
                    self._add(output, measure, at, beat_q * 0.72, walking)
                comp = [beat_q * 0.5]
                if density >= 1 and beats >= 3:
                    comp.append(beat_q * 2.5)
                if density >= 2 and beats >= 4:
                    comp.append(beat_q * 3.5)
                for at in comp:
                    if at < length:
                        slot, _ = data(at)
                        self._add(output, measure, at, min(beat_q * 0.58, length - at), slot.voicing, 1)
            elif self.style == "ballad":
                step = beat_q if density == 0 else beat_q / 2
                count = max(1, int(math.ceil(length / step - 1e-9)))
                for i in range(count):
                    at = i * step
                    slot, bass = data(at)
                    sequence = (bass,) + slot.voicing + tuple(reversed(slot.voicing[1:-1]))
                    self._add(output, measure, at, step * 0.86, sequence[i % len(sequence)])
            elif self.style == "pop":
                for i in range(beats):
                    at = i * beat_q
                    slot, bass = data(at)
                    self._add(output, measure, at, beat_q * 0.62, bass if i % 2 == 0 else self._bass_pitch((slot.harmony or Harmony(self.key_pc, "maj")).root, previous_bass, True))
                    if (density == 0 and i == 0) or (density > 0 and i % 2 == 1):
                        chord_at = min(length - 0.03, at + (beat_q * 0.08 if density else beat_q * 0.5))
                        self._add(output, measure, chord_at, beat_q * 0.66, slot.voicing)
            elif self.style == "waltz":
                # Retain the written time signature.  In compound/non-triple
                # metres this is a three-pulse cross-rhythm, not a destructive
                # rewrite of every bar to 3/4.
                pulses = [0.0, length / 3.0, length * 2.0 / 3.0]
                for i, at in enumerate(pulses):
                    slot, bass = data(at)
                    self._add(output, measure, at, min(length / 3 * 0.72, length - at), bass if i == 0 else slot.voicing)
            elif self.style == "bossa":
                positions = [(0.0, "bass"), (0.25, "chord"), (0.5, "bass5"), (0.75, "chord")]
                for ratio, kind in positions:
                    at = ratio * length
                    slot, bass = data(at)
                    if kind == "bass5":
                        root = (slot.harmony or Harmony(self.key_pc, "maj")).root
                        self._add(output, measure, at, min(beat_q * 0.68, length - at), self._bass_pitch(root, previous_bass, True))
                    elif kind == "bass":
                        self._add(output, measure, at, min(beat_q * 0.68, length - at), bass)
                    else:
                        self._add(output, measure, at, min(beat_q * 0.48, length - at), slot.voicing, 1)
            elif self.style == "cinematic":
                slot, bass = data(0)
                root = (slot.harmony or Harmony(self.key_pc, "maj")).root
                open_fifth = self._bass_pitch(root, previous_bass, True)
                self._add(output, measure, 0, min(length * 0.9, 4), [bass, min(59, bass + 12)])
                step = beat_q if density == 0 else beat_q / 2
                seq = tuple(slot.voicing) + (slot.voicing[-1] + 12 if slot.voicing[-1] + 12 < self._melody_floor(slot) else open_fifth + 12,)
                for i in range(max(1, int(length / step))):
                    at = i * step
                    local = self._slot_at(measure, at)
                    use = tuple(local.voicing) or seq
                    self._add(output, measure, at, step * 0.84, use[i % len(use)])
            else:  # balanced
                slots = [slot for slot in self.slots if slot.measure is measure]
                for slot in slots:
                    at = slot.start - measure["_start"]
                    root = (slot.harmony or Harmony(self.key_pc, "maj")).root
                    bass = self._bass_pitch(root, previous_bass)
                    previous_bass = bass
                    self._add(output, measure, at, min(beat_q * 0.72, slot.end - slot.start), bass)
                    chord_at = at + (beat_q * 0.5 if density == 0 and at + beat_q * 0.5 < slot.end - 0.02 else 0)
                    self._add(output, measure, chord_at, min(beat_q * 0.7, slot.end - measure["_start"] - chord_at), slot.voicing)
        return self._finalize_notes(output)

    def _finalize_notes(self, notes: list[dict[str, Any]]) -> list[dict[str, Any]]:
        # Difficulty is enforced across both hands.  Melody wins, then bass,
        # then the closest inner voices; this keeps beginner attacks playable.
        cap = {"beginner": 2, "intermediate": 4, "advanced": 6, "original": 7}[self.level]
        groups: dict[tuple[Any, float], list[dict[str, Any]]] = defaultdict(list)
        for n in notes:
            if n and n.get("m") in self.by_number and 21 <= int(n.get("midi", 0)) <= 108:
                groups[(n["m"], qround(n["b"]))].append(n)
        output: list[dict[str, Any]] = []
        for key in sorted(groups, key=lambda item: (self.by_number[item[0]]["_index"], item[1])):
            group = groups[key]
            melody = sorted((n for n in group if n.get("staff") == 1 and n.get("voice") == 1), key=lambda n: n["midi"], reverse=True)
            bass = sorted((n for n in group if n.get("staff") == 2), key=lambda n: n["midi"])
            inner = sorted((n for n in group if n not in melody and n not in bass), key=lambda n: abs(n["midi"] - 60))
            picked: list[dict[str, Any]] = []
            for pool in (melody[:1], bass[:1], inner, melody[1:], bass[1:]):
                for n in pool:
                    if len(picked) >= cap:
                        break
                    if all(existing["midi"] != n["midi"] or existing.get("staff") != n.get("staff") for existing in picked):
                        picked.append(n)
            picked.sort(key=lambda n: (n.get("staff", 1), n["midi"]))
            per_staff = defaultdict(int)
            for n in picked:
                n.pop("_abs", None)
                n.pop("slurStart", None); n.pop("slurStop", None)
                n.pop("tieStart", None); n.pop("tieStop", None)
                n.pop("tupletStart", None); n.pop("tupletStop", None)
                n["b"] = qround(n["b"])
                n["dur"] = max(0.0625, qround(n["dur"]))
                n["type"] = note_type(n["dur"])
                staff = int(n.get("staff") or 1)
                n["chord"] = per_staff[staff] > 0
                per_staff[staff] += 1
                output.append(n)
        return output

    def _label(self, harmony: Harmony) -> str:
        if HAVE_MUSIC21:
            try:
                pitches = [60 + harmony.root + interval for interval in QUALITY_INTERVALS[harmony.quality]]
                return str(m21_harmony.chordSymbolFigureFromChord(m21_chord.Chord(pitches)))
            except Exception:
                pass
        root = midi_name(60 + harmony.root, self.prefer_flats)[:-1]
        suffix = {"maj": "", "min": "m", "dim": "dim", "sus4": "sus4", "7": "7", "maj7": "maj7", "min7": "m7", "m7b5": "m7b5"}[harmony.quality]
        return root + suffix

    def arrange(self) -> dict[str, Any]:
        notes = self._texture()
        changes = []
        previous = None
        movements = []
        previous_voicing: tuple[int, ...] = ()
        for slot in self.slots:
            if slot.harmony != previous:
                changes.append({
                    "measure": slot.measure["number"],
                    "beat": qround(slot.start - slot.measure["_start"]),
                    "symbol": self._label(slot.harmony or Harmony(self.key_pc, "maj")),
                })
                previous = slot.harmony
            if previous_voicing and slot.voicing:
                movements.append(self._voicing_motion(previous_voicing, slot.voicing))
            previous_voicing = slot.voicing
        key_name = midi_name(60 + self.key_pc, self.prefer_flats)[:-1] + (" minor" if self.key_mode == "minor" else " major")
        return {
            "ok": True,
            "notes": notes,
            "analysis": {
                "engine": "music21-hybrid" if HAVE_MUSIC21 else "harmonic-dp",
                "inspiredBy": "AccoMontage/AccoMontage2",
                "key": key_name,
                "keySource": self.key_source,
                "harmonyChanges": changes,
                "averageVoiceMovement": round(sum(movements) / max(1, len(movements)), 3),
                "sourceNotes": len(self.notes),
                "melodyNotes": len(self.melody),
                "arrangedNotes": len(notes),
                "metrePreserved": True,
            },
        }


def main() -> int:
    try:
        payload = json.load(sys.stdin)
        if not isinstance(payload, dict):
            raise ValueError("A JSON object is required.")
        result = Arranger(payload).arrange()
        json.dump(result, sys.stdout, ensure_ascii=False, separators=(",", ":"))
        return 0
    except Exception as exc:
        json.dump({"ok": False, "error": str(exc)}, sys.stdout, ensure_ascii=False, separators=(",", ":"))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
