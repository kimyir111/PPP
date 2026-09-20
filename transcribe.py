#!/usr/bin/env python3
"""
PPP piano transcription worker.

Audio in, notes out. When more than one piano model is installed it runs a
small consensus ensemble (TransKun, Kong and Aria-AMT); with one model it keeps
the old single-model behaviour. Writes notes and pedal as JSON. It does not
write notation: bars, beats, hands and spelling are decided by PPP, from these
notes.

  python transcribe.py --wav in.wav --out notes.json [--checkpoint model.pth]
      [--kong-wav in-16k-mono.wav] [--aria-checkpoint model.safetensors]
      [--engine auto|ensemble|transkun|kong|aria]

Progress goes to stdout, one line at a time, for omr-service.js to relay.
"""

import argparse
import json
import os
import shutil
import statistics
import subprocess
import sys
import tempfile
import time


def say(line):
    sys.stdout.write(line + '\n')
    sys.stdout.flush()


def have_transkun():
    try:
        import transkun  # noqa: F401
        return True
    except Exception:
        return False


def have_aria():
    try:
        import amt  # noqa: F401
        return True
    except Exception:
        return False


def transkun_cmd(python, wav, midi, device):
    """How Transkun is actually launched. PyPI: python -m transkun.transcribe
    audio out.mid  (console script: transkun). There is no transkun.__main__
    and no transkun.commandline."""
    device = device or 'cpu'
    python = python or sys.executable
    script = os.path.join(os.path.dirname(os.path.abspath(python)), 'transkun')
    if os.name == 'nt':
        script += '.exe'
    return {
        'module': [python, '-m', 'transkun.transcribe', wav, midi, '--device', device],
        'script': [script, wav, midi, '--device', device]
    }


def transcribe_transkun(wav, device):
    import midi_notes
    mid = tempfile.NamedTemporaryFile(suffix='.mid', delete=False)
    mid.close()
    cmds = transkun_cmd(sys.executable, wav, mid.name, device)
    last_err = b''
    try:
        for key in ('module', 'script'):
            cmd = cmds[key]
            if key == 'script' and not os.path.isfile(cmd[0]):
                continue
            r = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            if r.returncode == 0:
                parsed = midi_notes.read_notes(mid.name)
                return parsed['notes'], parsed.get('pedals') or []
            last_err = r.stderr or r.stdout or b''
        raise RuntimeError((last_err or b'transkun failed').decode('utf-8', 'replace')[:800])
    finally:
        try:
            os.unlink(mid.name)
        except OSError:
            pass


def transcribe_kong(wav, checkpoint, device, progress=None):
    import numpy as np
    import soundfile as sf
    import torch
    from piano_transcription_inference import PianoTranscription
    from piano_transcription_inference.utilities import RegressionPostProcessor
    from piano_transcription_inference.pytorch_utils import move_data_to_device

    audio, sr = sf.read(wav, dtype='float32', always_2d=False)
    if audio.ndim > 1:
        audio = audio.mean(axis=1)
    if sr != 16000:
        raise SystemExit('expected 16 kHz audio, got %d' % sr)

    real_stdout = sys.stdout
    sys.stdout = sys.stderr
    try:
        pt = PianoTranscription(checkpoint_path=checkpoint, device=torch.device(device))
    finally:
        sys.stdout = real_stdout
    model = pt.model
    model.eval()
    if progress:
        progress(0.02)

    seg = pt.segment_samples
    x = audio[None, :].astype(np.float32)
    n = x.shape[1]
    pad = int(np.ceil(n / seg)) * seg - n
    x = np.concatenate((x, np.zeros((1, pad), dtype=np.float32)), axis=1)
    segments = pt.enframe(x, seg)

    outputs = {}
    total = len(segments)
    with torch.no_grad():
        for i in range(total):
            batch = move_data_to_device(segments[i:i + 1], device)
            out = model(batch)
            for k, v in out.items():
                outputs.setdefault(k, []).append(v.data.cpu().numpy())
            if progress:
                progress(0.02 + 0.93 * (i + 1) / total)
    for k in list(outputs.keys()):
        outputs[k] = pt.deframe(np.concatenate(outputs[k], axis=0))[0:n]

    post = RegressionPostProcessor(
        pt.frames_per_second, classes_num=pt.classes_num,
        onset_threshold=pt.onset_threshold, offset_threshold=pt.offset_threshod,
        frame_threshold=pt.frame_threshold, pedal_offset_threshold=pt.pedal_offset_threshold)
    notes, pedals = post.output_dict_to_midi_events(outputs)
    out_notes = [{
        'on': round(float(e['onset_time']), 4),
        'off': round(float(e['offset_time']), 4),
        'midi': int(e['midi_note']),
        'vel': int(e['velocity'])
    } for e in notes]
    out_pedals = [{
        'on': round(float(e['onset_time']), 4),
        'off': round(float(e['offset_time']), 4)
    } for e in (pedals or [])]
    return out_notes, out_pedals, n / 16000.0


def aria_cmds(python, wav, checkpoint, out_dir):
    """Commands used by the public aria-amt package.

    The project exposes both an ``aria-amt`` console script and ``amt.run``.
    Trying both keeps Windows virtual environments and editable installs
    working without importing Aria's training stack into this worker.
    """
    exe = os.path.join(os.path.dirname(os.path.abspath(python)), 'aria-amt')
    if os.name == 'nt':
        exe += '.exe'
    tail = [
        'transcribe', 'medium-double', checkpoint,
        '-load_path', wav, '-save_dir', out_dir, '-bs', '1'
    ]
    return [[python, '-m', 'amt.run'] + tail, [exe] + tail]


def transcribe_aria(wav, checkpoint):
    import midi_notes
    out_dir = tempfile.mkdtemp(prefix='ppp-aria-')
    last_err = b''
    try:
        for cmd in aria_cmds(sys.executable, wav, checkpoint, out_dir):
            if cmd[0].lower().endswith(('.exe', 'aria-amt')) and not os.path.isfile(cmd[0]):
                continue
            r = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            if r.returncode:
                last_err = r.stderr or r.stdout or b''
                continue
            mids = []
            for root, _dirs, files in os.walk(out_dir):
                mids.extend(os.path.join(root, f) for f in files if f.lower().endswith(('.mid', '.midi')))
            if mids:
                parsed = midi_notes.read_notes(max(mids, key=os.path.getmtime))
                return parsed['notes'], parsed.get('pedals') or []
        raise RuntimeError((last_err or b'aria-amt produced no MIDI').decode('utf-8', 'replace')[:800])
    finally:
        shutil.rmtree(out_dir, ignore_errors=True)


ENGINE_WEIGHT = {'transkun': 1.0, 'piano-transcription': 0.96, 'aria-amt': 0.92}


def _median(values):
    return float(statistics.median(values)) if values else 0.0


def _normalise_note(note):
    on = max(0.0, float(note.get('on', 0)))
    off = max(on + 0.03, float(note.get('off', on + 0.03)))
    return {
        'on': on, 'off': off, 'midi': int(note.get('midi', 0)),
        'vel': max(1, min(127, int(note.get('vel', 64) or 64)))
    }


def _fast_windows(notes, max_gap=0.18, min_attacks=3):
    """Return spans containing a short, dense run of attacks.

    A second model's isolated note is usually an overtone. A coherent stream
    is different evidence: it is commonly an ornament or run that the primary
    model thinned out. Three attacks are enough to establish that pattern;
    requiring four made short 16th/32nd-note figures disappear at phrase
    boundaries.
    """
    slots = []
    for note in sorted(notes or [], key=lambda n: float(n.get('on', 0))):
        on = max(0.0, float(note.get('on', 0)))
        if not slots or on - slots[-1] > 0.008:
            slots.append(on)
    windows = []
    start = 0
    for i in range(1, len(slots) + 1):
        gap = slots[i] - slots[i - 1] if i < len(slots) else float('inf')
        if 0.015 <= gap <= max_gap:
            continue
        if i - start >= min_attacks:
            windows.append((slots[start] - 0.02, slots[i - 1] + 0.02))
        start = i
    return windows


def _inside_windows(on, windows):
    return any(a <= on <= b for a, b in windows)


def _fast_recovery_allowed(on, windows, primary_onsets):
    """Allow a coherent secondary run when the primary thinned or skipped it."""
    for start, end in windows:
        if not (start <= on <= end):
            continue
        nearby = sum(1 for t in primary_onsets if abs(t - on) <= 0.22)
        if nearby >= 2:
            return True
        # If the primary missed the whole ornament, require context on both
        # sides.  This keeps a long overtone/room-resonance stream rejected.
        width = end - start
        before = any(start - 0.45 <= t < start for t in primary_onsets)
        after = any(end < t <= end + 0.45 for t in primary_onsets)
        if width >= 0.24 and before and after:
            return True
    return False


def consensus(results, onset_tolerance=0.09):
    """Use the strongest available model as the recall floor, then let other
    models correct its timing and jointly recover notes it missed.

    A plain union adds every model's overtones; a strict intersection deletes
    real ornaments. This rule never adds a secondary-only note unless at least
    two independent secondary models agree on pitch and onset.
    """
    if not results:
        raise RuntimeError('no transcription model produced a result')
    names = [r['engine'] for r in results]
    primary = max(names, key=lambda n: ENGINE_WEIGHT.get(n, 0.5))
    fast_windows = {r['engine']: _fast_windows(r.get('notes') or []) for r in results}
    primary_onsets = sorted({
        round(float(n.get('on', 0)), 3)
        for r in results if r['engine'] == primary
        for n in (r.get('notes') or [])
    })
    by_pitch = {}
    for r in results:
        engine = r['engine']
        for raw in r.get('notes') or []:
            note = _normalise_note(raw)
            note['engine'] = engine
            by_pitch.setdefault(note['midi'], []).append(note)

    clusters = []
    for pitch, items in by_pitch.items():
        for note in sorted(items, key=lambda n: (n['on'], n['engine'])):
            best = None
            best_gap = onset_tolerance + 1
            for cluster in reversed(clusters):
                if cluster['midi'] != pitch:
                    continue
                gap = abs(note['on'] - _median([x['on'] for x in cluster['items']]))
                if gap > onset_tolerance and cluster['items'][0]['on'] < note['on'] - onset_tolerance:
                    break
                if gap <= onset_tolerance and note['engine'] not in {x['engine'] for x in cluster['items']} and gap < best_gap:
                    best, best_gap = cluster, gap
            if best is None:
                clusters.append({'midi': pitch, 'items': [note]})
            else:
                best['items'].append(note)
        clusters.sort(key=lambda c: (c['items'][0]['on'], c['midi']))

    accepted = []
    uncertain = []
    fast_recovered = 0
    model_count = len(results)
    for cluster in clusters:
        items = cluster['items']
        engines = sorted({x['engine'] for x in items})
        support = len(engines)
        out = {
            'on': round(_median([x['on'] for x in items]), 4),
            'off': round(_median([x['off'] for x in items]), 4),
            'midi': cluster['midi'],
            'vel': int(round(_median([x['vel'] for x in items]))),
            'confidence': round(support / model_count, 3),
            'support': support,
            'models': engines
        }
        fast_recovery = False
        if model_count == 2 and support == 1 and primary not in engines:
            engine = engines[0]
            on = out['on']
            fast_recovery = _fast_recovery_allowed(on, fast_windows.get(engine, []), primary_onsets)
        if primary in engines or support >= 2 or fast_recovery:
            if fast_recovery:
                out['recovered'] = 'fast-run'
                fast_recovered += 1
            accepted.append(out)
        else:
            uncertain.append(out)

    accepted.sort(key=lambda n: (n['on'], n['midi']))
    uncertain.sort(key=lambda n: (n['on'], n['midi']))
    agreement = (_median([n['support'] / model_count for n in accepted]) if accepted else 0.0)

    # Pedal is continuous control data, so majority-voting individual edges is
    # brittle. Prefer the most trusted model that actually emitted CC64.
    pedal_source = None
    pedals = []
    for r in sorted(results, key=lambda x: ENGINE_WEIGHT.get(x['engine'], 0.5), reverse=True):
        if r.get('pedals'):
            pedal_source = r['engine']
            pedals = r['pedals']
            break
    return {
        'notes': accepted,
        'pedals': pedals,
        'uncertainNotes': uncertain,
        'ensemble': {
            'models': names, 'primary': primary,
            'agreement': round(agreement, 3),
            'accepted': len(accepted), 'uncertain': len(uncertain),
            'fastRecovered': fast_recovered,
            'pedalSource': pedal_source
        }
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--wav', required=True)
    ap.add_argument('--kong-wav', default='')
    ap.add_argument('--out', required=True)
    ap.add_argument('--checkpoint', default='')
    ap.add_argument('--aria-checkpoint', default='')
    ap.add_argument('--device', default='auto')
    ap.add_argument('--engine', default='auto')
    a = ap.parse_args()

    t0 = time.time()
    import soundfile as sf
    import torch

    audio, sr = sf.read(a.wav, dtype='float32', always_2d=False)
    duration = (audio.shape[0] if audio.ndim == 1 else audio.shape[0]) / float(sr)

    if a.device == 'auto':
        device = 'cuda' if torch.cuda.is_available() else 'cpu'
    else:
        device = a.device
    if device == 'cpu':
        torch.set_num_threads(max(1, os.cpu_count() or 1))

    requested = a.engine.lower()
    available = []
    if have_transkun():
        available.append('transkun')
    if a.checkpoint:
        available.append('piano-transcription')
    if a.aria_checkpoint and have_aria():
        available.append('aria-amt')
    explicit = {
        'transkun': 'transkun', 'kong': 'piano-transcription',
        'piano-transcription': 'piano-transcription', 'aria': 'aria-amt',
        'aria-amt': 'aria-amt'
    }.get(requested)
    chosen = [explicit] if explicit else list(available)
    if explicit and explicit not in available:
        raise SystemExit('requested transcription engine is not installed: ' + explicit)
    if not chosen:
        raise SystemExit('no TransKun, Kong checkpoint or Aria-AMT checkpoint')

    results = []
    failures = []
    for index, engine in enumerate(chosen):
        lo = 0.02 + index / len(chosen) * 0.94
        span = 0.94 / len(chosen)
        say('ENGINE ' + engine)
        say('PROGRESS %.3f' % lo)
        try:
            if engine == 'transkun':
                notes, pedals = transcribe_transkun(a.wav, device)
            elif engine == 'piano-transcription':
                kong_wav = a.kong_wav or a.wav
                notes, pedals, _kong_duration = transcribe_kong(
                    kong_wav, a.checkpoint, device,
                    progress=lambda p, base=lo, width=span: say('PROGRESS %.3f' % (base + width * p)))
            else:
                notes, pedals = transcribe_aria(a.wav, a.aria_checkpoint)
            results.append({'engine': engine, 'notes': notes, 'pedals': pedals})
            say('PROGRESS %.3f' % (lo + span))
        except Exception as e:
            failures.append({'engine': engine, 'error': str(e)[:300]})
            sys.stderr.write('%s failed: %s\n' % (engine, e))

    if not results:
        raise SystemExit('all transcription engines failed: ' + '; '.join(x['engine'] for x in failures))
    merged = consensus(results)
    notes, pedals = merged['notes'], merged['pedals']
    engine = 'ensemble' if len(results) > 1 else results[0]['engine']
    model_names = {
        'transkun': 'TransKun V2',
        'piano-transcription': 'Kong et al. high-resolution piano transcription',
        'aria-amt': 'Aria-AMT piano transcription'
    }
    model_name = ' + '.join(model_names.get(r['engine'], r['engine']) for r in results)
    result = {
        'engine': engine,
        'model': model_name,
        'device': device,
        'duration': duration,
        'ms': int((time.time() - t0) * 1000),
        'notes': notes,
        'pedals': pedals or [],
        'uncertainNotes': merged['uncertainNotes'],
        'ensemble': merged['ensemble'],
        'modelFailures': failures
    }
    with open(a.out, 'w', encoding='utf-8') as f:
        json.dump(result, f)
    say('PROGRESS 1')
    say('DONE')


if __name__ == '__main__':
    main()
