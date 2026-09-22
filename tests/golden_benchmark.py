#!/usr/bin/env python3
"""Run repeatable transcription/score comparisons without storing user media.

The manifest is intentionally external to the repository.  A case can point
at MIDI/JSON event files (seconds) or at MusicXML/MXL score files (quarter
beats).  This lets a user keep a copyrighted PDF/audio pair locally while
still producing a small, reviewable metrics report in CI or before a deploy.

Example:
    python tests/golden_benchmark.py C:/private/ppp-golden/manifest.json
"""

from __future__ import annotations

import argparse
import json
import math
import os
import sys
import zipfile
import xml.etree.ElementTree as ET
from typing import Any, Dict, Iterable, List, Sequence, Tuple

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from evaluate_transcription import evaluate, load_events


def _tag(element: ET.Element, name: str) -> Iterable[ET.Element]:
    """Yield descendants while accepting MusicXML namespace variants."""
    wanted = name.rsplit('}', 1)[-1]
    for child in element.iter():
        if child.tag.rsplit('}', 1)[-1] == wanted:
            yield child


def _child(element: ET.Element, name: str) -> ET.Element | None:
    wanted = name.rsplit('}', 1)[-1]
    for child in list(element):
        if child.tag.rsplit('}', 1)[-1] == wanted:
            return child
    return None


def _text(element: ET.Element | None, default: str = '') -> str:
    return (element.text or '').strip() if element is not None else default


def _number(element: ET.Element | None, default: float = 0.0) -> float:
    try:
        value = float(_text(element))
    except (TypeError, ValueError):
        return default
    return value if math.isfinite(value) else default


def _musicxml_bytes(path: str) -> bytes:
    if path.lower().endswith('.mxl'):
        with zipfile.ZipFile(path) as archive:
            names = [n for n in archive.namelist() if n.lower().endswith(('.xml', '.musicxml'))]
            # container.xml identifies the score, but falling back to the
            # largest XML keeps hand-made MXL fixtures usable.
            container = next((n for n in names if n.lower().endswith('container.xml')), None)
            if container:
                root = ET.fromstring(archive.read(container))
                full = next((x for x in _tag(root, 'rootfile') if x.attrib.get('full-path')), None)
                if full and full.attrib['full-path'] in archive.namelist():
                    return archive.read(full.attrib['full-path'])
            score = [n for n in names if not n.lower().endswith('container.xml')]
            if not score:
                raise ValueError(f'{path}: MXL contains no MusicXML document')
            return archive.read(max(score, key=lambda n: archive.getinfo(n).file_size))
    with open(path, 'rb') as handle:
        return handle.read()


def load_musicxml(path: str) -> Dict[str, Any]:
    """Extract pitch/onset/offset in quarter beats from a score file.

    This is deliberately a metric reader, not a renderer.  It understands
    partwise scores, backups, forwards, chords, voices and changing divisions;
    ties are left as written events so a report can expose tie mistakes.
    """
    root = ET.fromstring(_musicxml_bytes(path))
    notes: List[Dict[str, Any]] = []
    measure_count = 0
    absolute_base = 0.0
    tempo = None
    for part in _tag(root, 'part'):
        # A piano score's parts are independent staves.  Measure positions are
        # shared, so each part starts at the same absolute base.
        part_base = 0.0
        # MusicXML attributes are stateful.  ``divisions`` and ``time`` are
        # normally written only when they change; resetting them to defaults
        # on every measure turns a multi-measure score into a wildly stretched
        # timeline and makes a useful golden comparison look like a total
        # transcription failure.
        divisions = 1.0
        current_beats = 4.0
        current_beat_type = 4.0
        for measure in _tag(part, 'measure'):
            measure_count = max(measure_count, int(measure.attrib.get('number', measure_count + 1) or measure_count + 1))
            attrs = _child(measure, 'attributes')
            if attrs is not None:
                next_divisions = _number(_child(attrs, 'divisions'), divisions)
                if next_divisions > 0:
                    divisions = next_divisions
            time = _child(attrs, 'time') if attrs is not None else None
            if time is not None:
                next_beats = _number(_child(time, 'beats'), current_beats)
                next_beat_type = _number(_child(time, 'beat-type'), current_beat_type)
                if next_beats > 0 and next_beat_type > 0:
                    current_beats, current_beat_type = next_beats, next_beat_type
            beats = current_beats
            beat_type = current_beat_type
            measure_hint = beats * 4.0 / beat_type if beats and beat_type else 0.0
            cursor = 0.0
            max_cursor = 0.0
            last_onset: Dict[Tuple[str, str], float] = {}
            for item in list(measure):
                kind = item.tag.rsplit('}', 1)[-1]
                if kind == 'direction':
                    for sound in _tag(item, 'sound'):
                        value = sound.attrib.get('tempo')
                        try:
                            tempo = float(value)
                        except (TypeError, ValueError):
                            pass
                if kind == 'backup':
                    cursor = max(0.0, cursor - _number(_child(item, 'duration')) / max(divisions, 1.0))
                    continue
                if kind == 'forward':
                    cursor += _number(_child(item, 'duration')) / max(divisions, 1.0)
                    max_cursor = max(max_cursor, cursor)
                    continue
                if kind != 'note':
                    continue
                duration = _number(_child(item, 'duration')) / max(divisions, 1.0)
                voice = _text(_child(item, 'voice'), '1')
                staff = _text(_child(item, 'staff'), '1')
                key = (voice, staff)
                chord = _child(item, 'chord') is not None
                onset = last_onset.get(key, cursor) if chord else cursor
                end = onset + duration
                max_cursor = max(max_cursor, cursor + duration)
                pitch = _child(item, 'pitch')
                if pitch is not None:
                    step = _text(_child(pitch, 'step'), 'C').upper()
                    alter = _number(_child(pitch, 'alter'), 0.0)
                    octave = int(_number(_child(pitch, 'octave'), 4.0))
                    midi = {'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11}.get(step, 0)
                    midi += (octave + 1) * 12 + int(round(alter))
                    notes.append({'midi': midi, 'on': part_base + onset, 'off': part_base + end})
                last_onset[key] = onset
                if not chord:
                    cursor += duration
                max_cursor = max(max_cursor, cursor)
            part_base += max(measure_hint, max_cursor)
        absolute_base = max(absolute_base, part_base)

    return {
        'notes': sorted(notes, key=lambda n: (n['on'], n['midi'])),
        'pedals': [],
        'measures': measure_count,
        'tempo': tempo,
        'timebase': 'quarter-beats',
    }


def load_any(path: str) -> Dict[str, Any]:
    ext = os.path.splitext(path)[1].lower()
    if ext in {'.xml', '.musicxml', '.mxl'}:
        return load_musicxml(path)
    result = load_events(path)
    result['timebase'] = 'seconds'
    # Keep timing metadata from a helper JSON without making the generic
    # evaluator depend on the helper's schema.
    if ext == '.json':
        with open(path, 'r', encoding='utf-8') as handle:
            raw = json.load(handle)
        if isinstance(raw, dict):
            for key in ('beats', 'downbeats', 'tempo', 'duration', 'firstDownbeat'):
                if key in raw:
                    result[key] = raw[key]
    return result


def _finite_number(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def _map_with_beats(value: float, beats: Sequence[float], offset: float = 0.0) -> float:
    """Map quarter-beat coordinates onto an observed beat-time sequence."""
    if len(beats) < 2:
        raise ValueError('beat alignment needs at least two predicted beats')
    position = value + offset
    index = math.floor(position)
    fraction = position - index
    if index < 0:
        step = beats[1] - beats[0]
        return beats[0] + position * step
    if index >= len(beats) - 1:
        step = beats[-1] - beats[-2]
        return beats[-1] + (position - (len(beats) - 1)) * step
    return beats[index] + fraction * (beats[index + 1] - beats[index])


def _map_events(events: Sequence[Dict[str, Any]], mapper) -> List[Dict[str, Any]]:
    mapped = []
    for note in events:
        mapped.append({
            'midi': int(note['midi']),
            'on': mapper(float(note['on'])),
            'off': mapper(float(note['off'])),
        })
    return mapped


def _map_intervals(events: Sequence[Dict[str, Any]], mapper) -> List[Dict[str, Any]]:
    return [{'on': mapper(float(event['on'])), 'off': mapper(float(event['off']))} for event in events]


def _align_timebases(reference: Dict[str, Any], prediction: Dict[str, Any], case: Dict[str, Any]):
    """Return both event sets in seconds for score-vs-recording cases.

    A private golden case can compare an official MusicXML score (quarter
    beats) directly with helper JSON (seconds).  Fixed tempo is reproducible;
    ``alignment: prediction-beats`` uses the beat times returned by Beat This
    and therefore preserves rubato and local tempo changes.
    """
    ref_base = reference.get('timebase')
    pred_base = prediction.get('timebase')
    if ref_base == pred_base:
        return reference, prediction
    if {ref_base, pred_base} != {'quarter-beats', 'seconds'}:
        raise ValueError(f"{case.get('name', 'case')}: unsupported timebase pair {ref_base}/{pred_base}")

    if ref_base == 'quarter-beats':
        score, recording = reference, prediction
        invert = False
    else:
        score, recording = prediction, reference
        invert = True

    alignment = str(case.get('alignment', 'tempo')).lower()
    if alignment in {'prediction-beats', 'beats', 'beat-grid'}:
        beats = [_finite_number(value) for value in recording.get('beats', [])]
        beats = sorted(set(value for value in beats if value is not None))
        mapper = lambda value: _map_with_beats(value, beats, float(case.get('beatOffset', 0.0)))
    else:
        tempo = _finite_number(case.get('tempo')) or _finite_number(score.get('tempo'))
        if not tempo or tempo <= 0:
            raise ValueError(f"{case.get('name', 'case')}: tempo is required for quarter-beat/seconds comparison")
        start = _finite_number(case.get('startSeconds'))
        if start is None:
            start = _finite_number(recording.get('firstDownbeat')) or 0.0
        scale = 60.0 / tempo
        mapper = lambda value: start + value * scale

    mapped_score = dict(score)
    mapped_score['notes'] = _map_events(score.get('notes', []), mapper)
    mapped_score['pedals'] = _map_intervals(score.get('pedals', []), mapper) if score.get('pedals') else []
    mapped_score['timebase'] = 'seconds'
    if invert:
        return recording, mapped_score
    return mapped_score, recording


def run_case(case: Dict[str, Any], root: str) -> Dict[str, Any]:
    reference_path = os.path.abspath(os.path.join(root, case['reference']))
    prediction_path = os.path.abspath(os.path.join(root, case['prediction']))
    reference = load_any(reference_path)
    prediction = load_any(prediction_path)
    reference, prediction = _align_timebases(reference, prediction, case)
    metrics = evaluate(
        reference, prediction,
        onset_tolerance=max(0.0, float(case.get('onsetMs', 50.0)) / 1000.0),
        offset_tolerance=max(0.0, float(case.get('offsetMs', 50.0)) / 1000.0),
        offset_ratio=max(0.0, float(case.get('offsetRatio', 0.2))),
    )
    result = {'name': case.get('name') or os.path.basename(reference_path), 'metrics': metrics}
    for key in ('measures', 'tempo', 'timebase'):
        if key in reference:
            result['reference' + key.capitalize()] = reference[key]
    expected_measures = case.get('expectedMeasures')
    if expected_measures is not None:
        result['measureCountOk'] = reference.get('measures') == int(expected_measures)
    expected_tempo = case.get('expectedTempo')
    if expected_tempo is not None and reference.get('tempo') is not None:
        result['tempoOk'] = abs(float(reference['tempo']) - float(expected_tempo)) <= float(case.get('tempoTolerance', 2.0))
    return result


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description='Evaluate private PPP golden transcription cases')
    parser.add_argument('manifest', help='JSON manifest kept outside the repository')
    args = parser.parse_args(argv)
    with open(args.manifest, 'r', encoding='utf-8') as handle:
        manifest = json.load(handle)
    root = os.path.dirname(os.path.abspath(args.manifest))
    cases = manifest.get('cases', []) if isinstance(manifest, dict) else manifest
    if not cases:
        raise SystemExit('manifest has no cases')
    output = []
    failures = []
    for case in cases:
        try:
            result = run_case(case, root)
            output.append(result)
            f1 = result['metrics']['f1']
            minimum = case.get('minF1')
            if minimum is not None and f1 < float(minimum):
                failures.append(f"{result['name']}: F1 {f1:.3f} < {float(minimum):.3f}")
            minimum_offset = case.get('minOffsetF1')
            if minimum_offset is not None and result['metrics']['offset_f1'] < float(minimum_offset):
                failures.append(f"{result['name']}: offset F1 {result['metrics']['offset_f1']:.3f} < {float(minimum_offset):.3f}")
            maximum_onset = case.get('maxOnsetErrorMs')
            onset_error = result['metrics'].get('mean_onset_error_ms')
            if maximum_onset is not None and (onset_error is None or onset_error > float(maximum_onset)):
                failures.append(f"{result['name']}: onset error {onset_error}ms > {float(maximum_onset):.3f}ms")
            if result.get('measureCountOk') is False:
                failures.append(f"{result['name']}: reference measure count differs from expected")
            if result.get('tempoOk') is False:
                failures.append(f"{result['name']}: reference tempo differs from expected")
        except Exception as exc:  # one broken private case should be visible, not hidden
            failures.append(f"{case.get('name', case.get('reference', 'case'))}: {exc}")
    print(json.dumps({'cases': output, 'failures': failures}, ensure_ascii=False, indent=2))
    return 1 if failures else 0


if __name__ == '__main__':
    raise SystemExit(main())
