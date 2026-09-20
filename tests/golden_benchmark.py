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
        for measure in _tag(part, 'measure'):
            measure_count = max(measure_count, int(measure.attrib.get('number', measure_count + 1) or measure_count + 1))
            attrs = _child(measure, 'attributes')
            divisions = _number(_child(attrs, 'divisions') if attrs is not None else None, 1.0)
            time = _child(attrs, 'time') if attrs is not None else None
            beats = _number(_child(time, 'beats') if time is not None else None, 0.0)
            beat_type = _number(_child(time, 'beat-type') if time is not None else None, 4.0)
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
    return result


def run_case(case: Dict[str, Any], root: str) -> Dict[str, Any]:
    reference_path = os.path.abspath(os.path.join(root, case['reference']))
    prediction_path = os.path.abspath(os.path.join(root, case['prediction']))
    reference = load_any(reference_path)
    prediction = load_any(prediction_path)
    if reference.get('timebase') != prediction.get('timebase'):
        raise ValueError(f"{case.get('name', reference_path)}: reference/prediction timebases differ")
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
