"""Critical quality gates and the usable-score verdict, per case (docs/GOALS/G00 §17 M2, §19).

A score is **usable** when every critical gate that applies passes. One failed gate means the
score cannot be handed to a pianist as it is, however good its other numbers are. The suite
headline is the share of usable scores (``usable``); the diagnostic score (``sqi``, v2) is a
continuous trend line and never a quality verdict.

A gate is a list of conditions on metrics; it passes when every condition that applies passes. A
condition is left out only when its metric does not apply to the case (no hands on a one-staff
reference, a key the registry cannot trust, no pedal in the performance, no tempo to judge in a
symbolic comparison). Whether a metric applies depends on the truth, never on what the prediction
wrote: a missing output is a failure, never "not applicable" (§17 B1).

Thresholds, and why (set from what a player needs, not fitted to current results):
"""

from __future__ import annotations

from typing import Dict, List, Optional

# A change of tempo, metre or key written in the wrong place costs the notes between where it is and
# where it should be. At most 1 note in 20 may be affected — about a bar of a short piece, the size of
# a mark placed a bar early or late — before the score reads or plays a passage wrongly (§19 F1).
SEQUENCE_MIN = 0.95

# gate -> (conditions [(metric, minimum or maximum, threshold)], why)
GATES = {
    "critical.meter": ([("struct.time_sig.exact", ">=", 1.0), ("struct.time_sig.timeline_accuracy", ">=", SEQUENCE_MIN)],
                       "The printed metre is the frame every bar is read in: the main time signature is right, and at "
                       "least 19 in 20 notes sit in bars whose time signature is the music's (a metre change written in "
                       "the wrong place, or a wrong one late in the piece, re-bars what follows)."),
    "critical.playback_tempo": ([("struct.tempo.ok_effective", ">=", 1.0),
                                 ("struct.tempo.timeline_accuracy", ">=", SEQUENCE_MIN)],
                                "The tempo the app uses: its score tempo (practice tempo, metronome, tempo %: the first "
                                "mark, <sound> before <metronome>) within ±4 %, and its player's tempo map (every tempo "
                                "mark, PianoScore.tempoMap) within ±4 % for at least 19 in 20 notes; missing counts as wrong."),
    "critical.beat_placement": ([("notation.onset_pos.accuracy", ">=", 0.90)],
                                "At least 9 in 10 kept notes in the right bar at the right position."),
    "critical.note_values": ([("notation.duration.accuracy", ">=", 0.80), ("notation.duration.page_accuracy", ">=", 0.80)],
                             "At least 4 in 5 kept notes have the music's value, both as the app plays it (<duration>) "
                             "and as the page shows it (the printed type, dots and tuplet). Less strict than positions "
                             "(0.90) because a wrong value leaves the note where it is played; past 1 in 5, most bars "
                             "show or play another rhythm than the music (§19 usable-duration)."),
    "critical.pitch_integrity": ([("notes.identity.f1", ">=", 0.95)],
                                 "At most about 1 in 20 notes missing or invented against the music."),
    "critical.key": ([("struct.key.fifths_exact", ">=", 1.0), ("struct.key.timeline_accuracy", ">=", SEQUENCE_MIN)],
                     "The key signature decides every unmarked note's pitch for the reader: the first one is right, and "
                     "at least 19 in 20 notes are read under the music's key signature."),
    "critical.hands": ([("notation.hand.accuracy", ">=", 0.80)],
                       "PPP practises hands separately; more than 1 in 5 notes on the wrong hand breaks that."),
    "critical.structure": ([("read.bar_integrity", ">=", 1.0), ("struct.measures.extra_empty_edge", "<=", 0.0),
                            ("struct.stats_consistent", ">=", 1.0), ("read.bar_completeness", ">=", 1.0),
                            ("struct.measure_numbers.valid", ">=", 1.0),
                            ("struct.measure_numbers.app_onset_accuracy", ">=", 1.0)],
                           "No overfull, underfull or incomplete bar (every staff fills its bar), no empty bar added at "
                           "either end, bar numbers that count up by one (the app finds bars by number), and stats that "
                           "describe the MusicXML they came with."),
    "critical.accidentals": ([("notation.accidentals.required_recall", ">=", 1.0)],
                             "Every accidental the page needs is printed; a missing one is a wrong note for the reader."),
    "critical.pedal": ([("notation.pedal.f1", ">=", 0.5)],
                       "When the performance used the pedal, at least half its changes are written."),
}


def _holds(v: float, rule: str, threshold: float) -> bool:
    return v >= threshold - 1e-9 if rule == ">=" else v <= threshold + 1e-9


def gates(m: Dict[str, Optional[float]]) -> Dict[str, Optional[float]]:
    out: Dict[str, Optional[float]] = {}
    for name, (conditions, _) in GATES.items():
        applied = [(m[k], rule, t) for k, rule, t in conditions if m.get(k) is not None]
        out[name] = float(all(_holds(v, rule, t) for v, rule, t in applied)) if applied else None
    applied = [v for v in out.values() if v is not None]
    out["usable"] = float(all(v >= 1.0 for v in applied)) if applied else None
    return out


def failed(m: Dict[str, Optional[float]]) -> List[str]:
    return [k.split(".", 1)[1] for k in GATES if m.get(k) == 0.0]


def rule_text(name: str) -> str:
    return GATES[name][1]
