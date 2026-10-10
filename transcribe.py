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
import re
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


def _fast_windows(notes, max_gap=0.18):
    """Return spans containing at least four distinct fast attacks.

    A second model's isolated note is usually an overtone. A coherent stream
    is different evidence: it is commonly an ornament or run that the primary
    model thinned out.
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
        if i - start >= 4:
            windows.append((slots[start] - 0.02, slots[i - 1] + 0.02))
        start = i
    return windows


def _inside_windows(on, windows):
    return any(a <= on <= b for a, b in windows)


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
            nearby_primary = sum(1 for t in primary_onsets if abs(t - on) <= 0.22)
            fast_recovery = _inside_windows(on, fast_windows.get(engine, [])) and nearby_primary >= 2
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


MODEL_NAMES = {
    'transkun': 'TransKun V2',
    'piano-transcription': 'Kong et al. high-resolution piano transcription',
    'aria-amt': 'Aria-AMT piano transcription'
}


def run_piano_models(a, wav, kong_wav, device, lo=0.02, width=0.94):
    """The piano ensemble on one recording -> (results, failures). Progress runs from lo to lo + width."""
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
        base = lo + index / len(chosen) * width
        span = width / len(chosen)
        say('ENGINE ' + engine)
        say('PROGRESS %.3f' % base)
        try:
            if engine == 'transkun':
                notes, pedals = transcribe_transkun(wav, device)
            elif engine == 'piano-transcription':
                notes, pedals, _kong_duration = transcribe_kong(
                    kong_wav or wav, a.checkpoint, device,
                    progress=lambda p, b=base, w=span: say('PROGRESS %.3f' % (b + w * p)))
            else:
                notes, pedals = transcribe_aria(wav, a.aria_checkpoint)
            results.append({'engine': engine, 'notes': notes, 'pedals': pedals})
            say('PROGRESS %.3f' % (base + span))
        except Exception as e:
            failures.append({'engine': engine, 'error': str(e)[:300]})
            sys.stderr.write('%s failed: %s\n' % (engine, e))
    return results, failures


# ---------------------------------------------------------------- song mode
# A song that is not a piano recording (singing, a band, electronic music). The piano models are trained on piano alone: on a song
# TransKun hears almost nothing of the voice (2 notes of a 2:37 vocal stem) and Kong hears the drums as notes, so the ensemble keeps the
# drums and sets the tune apart. Song mode separates the recording first (Demucs htdemucs_6s), leaves the drums out, follows the sung
# melody and the bass line with a pitch tracker (one note at a time), and runs the piano ensemble on what is left (guitar, piano, other).
# Every note says which layer it is: track 1 the melody (the voice), 2 the bass, 3 the accompaniment.
SONG_TRACK = {'melody': 1, 'bass': 2, 'accomp': 3}
SONG_MODEL = 'htdemucs_6s'
PT_SR = 22050          # the pitch tracker's sample rate
PT_HOP = 256           # 11.6 ms a frame
NOTE_MIN_S = 0.09      # a tracked note shorter than this is a glide or a consonant, not a note
SPLIT_MIN_S = 0.06     # an onset splits a held pitch only when both pieces are at least this long
PITCH_TOL = 0.6        # semitones a frame may stray from the note's median and still belong to it
JOIN_GAP_S = 0.04      # two pieces of the same pitch closer than this (no onset between them) are one note
DIP_RATIO = 0.6        # a held pitch is struck again only where the level fell under this share of the note's own level just before an onset
DIP_LOOK_S = 0.05      # how far back that fall is looked for
OCTAVE_SLIP_S = 0.2    # a piece an octave off the note before it, shorter than this and not struck again, is the pitch tracker slipping
MELODY_GATE = 0.05     # a tracked melody frame quieter than this share of its stem's 95th-percentile level is silence (0.10 dropped the soft notes of an uneven line: recall 0.76 on a synthetic tune with known notes, 0.97 at 0.05, precision 1.00 with bleed down to -25 dB)
LAYER_MIN = 0.08       # a stem quieter than this share of the mix (95th-percentile frame level) is not there at all
DOUBLE_TOL_S = 0.06    # an accompaniment note on the same key as a melody or bass note this close is the same sound heard twice
LEAD_STEMS = ('other', 'guitar', 'piano')   # where an instrumental's tune can be
LEAD_MIN_SHARE = 0.15  # a lead line holds one clear pitch for at least this share of the song, or there is no tune to follow


def separate(wav, device, lib):
    """wav (44.1 kHz) -> ({source: float32 array [channels, samples]}, sample rate) with Demucs."""
    if lib and lib not in sys.path:
        sys.path.insert(0, lib)
    try:
        from demucs.pretrained import get_model
        from demucs.apply import apply_model
    except Exception as e:
        raise SystemExit('SONG_SEPARATION_MISSING: the source separation (demucs) is not installed on this PC: ' + str(e)[:200])
    import numpy as np
    import soundfile as sf
    import torch
    model = get_model(SONG_MODEL)
    model.eval()
    model.to(device)
    x, sr = sf.read(wav, dtype='float32', always_2d=True)
    if sr != model.samplerate:
        raise SystemExit('the separation needs %d Hz audio, got %d' % (model.samplerate, sr))
    if x.shape[1] == 1:
        x = np.repeat(x, 2, axis=1)
    t = torch.from_numpy(np.ascontiguousarray(x[:, :2].T))
    ref = t.mean(0)
    mu, sd = ref.mean(), ref.std() + 1e-8
    with torch.no_grad():
        y = apply_model(model, ((t - mu) / sd)[None].to(device), device=device, shifts=1, split=True, overlap=0.25, progress=False)[0]
    y = (y * sd + mu).cpu().numpy()
    return {name: y[i] for i, name in enumerate(model.sources)}, sr


def frame_level(mono, frame=2048, hop=PT_HOP):
    import numpy as np
    import librosa
    return librosa.feature.rms(y=mono, frame_length=frame, hop_length=hop)[0].astype(np.float64)


def track_notes(mono, sr, fmin, fmax, gate):
    """One note at a time from a separated stem: pYIN pitch, cut into notes where the pitch moves (more than PITCH_TOL from the
    note's median) and where an onset falls inside a held pitch (a repeated note). Frames quieter than `gate` are silence."""
    import numpy as np
    import librosa
    y = librosa.resample(mono, orig_sr=sr, target_sr=PT_SR) if sr != PT_SR else mono
    frame = 4096 if fmin < 60 else 2048
    f0, voiced, _p = librosa.pyin(y, fmin=fmin, fmax=fmax, sr=PT_SR, frame_length=frame, hop_length=PT_HOP)
    # the level that says sound or silence is read over a short window (23 ms; 46 ms for a bass): over the pitch tracker's long one a break of 80 ms
    # between two sung notes is not silence, and the release of the first note is cut off as a note of its own
    level = frame_level(y, frame=1024 if fmin < 60 else 512)
    n = min(len(f0), len(level))
    midi = librosa.hz_to_midi(np.where(np.isnan(f0[:n]), 1.0, f0[:n]))
    on_frames = set(int(i) for i in librosa.onset.onset_detect(y=y, sr=PT_SR, hop_length=PT_HOP, backtrack=False))
    dt = PT_HOP / float(PT_SR)
    split_min = int(round(SPLIT_MIN_S / dt))
    look = int(round(DIP_LOOK_S / dt))

    def dipped(i, ref):
        """the level fell under DIP_RATIO of `ref` just before frame i: the sound was articulated again (an onset alone may be a drum bleeding into the stem)"""
        return ref > 0 and float(np.min(level[max(0, i - look):i + 1])) < DIP_RATIO * ref

    segs = []
    cur = None
    prev_ok, prev_ref = False, 0.0
    for i in range(n):
        ok = bool(voiced[i]) and not np.isnan(f0[i]) and level[i] >= gate
        if ok and cur is not None:
            med = float(np.median(cur['m']))
            again = i in on_frames and i - cur['a'] >= split_min and dipped(i, float(np.median(cur['lv'])))
            if abs(midi[i] - med) <= PITCH_TOL and not again:
                cur['m'].append(midi[i]); cur['lv'].append(level[i]); cur['b'] = i + 1
                prev_ok = True
                continue
        if cur is not None:
            prev_ref = float(np.median(cur['lv']))
            segs.append(cur)
            cur = None
        if ok:
            # articulated: after silence, or after a dip of the level (not merely where the pitch tracker changed its mind)
            cur = {'a': i, 'b': i + 1, 'm': [midi[i]], 'lv': [level[i]], 'onset': (not prev_ok) or dipped(i, prev_ref)}
        prev_ok = ok
    if cur is not None:
        segs.append(cur)
    notes = []
    for s in segs:
        key = int(round(float(np.median(s['m']))))
        on, off = s['a'] * dt, s['b'] * dt
        joins = notes and on - notes[-1]['off'] <= JOIN_GAP_S and not s['onset']
        # the same key again, or a moment an octave off (the pitch tracker's octave slip inside one held note): the note goes on
        if joins and (notes[-1]['midi'] == key or (abs(notes[-1]['midi'] - key) == 12 and off - on < OCTAVE_SLIP_S)):
            notes[-1]['off'] = off
            notes[-1]['_lv'] = max(notes[-1]['_lv'], max(s['lv']))
            continue
        notes.append({'on': on, 'off': off, 'midi': key, '_lv': max(s['lv'])})
    peak = max([x['_lv'] for x in notes] or [1.0]) or 1.0
    out = []
    for x in notes:
        if x['off'] - x['on'] < NOTE_MIN_S or x['midi'] < 21 or x['midi'] > 108:
            continue
        vel = int(round(40 + 75 * min(1.0, (x['_lv'] / peak) ** 0.5)))
        out.append({'on': round(x['on'], 4), 'off': round(x['off'], 4), 'midi': x['midi'], 'vel': vel})
    return out


BP_AMP_MIN = 0.4       # a Basic Pitch note weaker than this is not the lead (a pad that bled into the stem: precision 0.60 -> 0.93 on a synthetic stem with a known answer)
BP_SKY_WIN_S = 0.05    # notes starting within this of each other are one attack; the highest is the tune


def basic_pitch_ready():
    """Basic Pitch (Spotify, ONNX) is optional: without it the lead line is followed by the pitch tracker, as before."""
    try:
        import basic_pitch.inference  # noqa: F401
        import onnxruntime  # noqa: F401
        return True
    except Exception:
        return False


def track_notes_bp(mono, sr, fmin, fmax, work):
    """The lead line of a stem with Basic Pitch: it hears chords and stacked voices that follow-one-pitch tracking loses (chord stabs on a synthetic
    stem: recall 0.55 -> 1.00; the line is the highest note of each attack). Same note dicts as track_notes."""
    import contextlib
    import soundfile as sf
    from basic_pitch.inference import predict
    from basic_pitch import ICASSP_2022_MODEL_PATH
    path = os.path.join(work, 'lead.wav')
    sf.write(path, mono.astype('float32'), sr, subtype='PCM_16')
    with contextlib.redirect_stdout(sys.stderr):
        _m, _midi, events = predict(path, ICASSP_2022_MODEL_PATH, onset_threshold=0.5, frame_threshold=0.3, minimum_note_length=58,
                                    minimum_frequency=float(fmin), maximum_frequency=float(fmax))
    ev = sorted(({'on': float(e[0]), 'off': float(e[1]), 'midi': int(e[2]), 'amp': float(e[3])} for e in events if float(e[3]) >= BP_AMP_MIN),
                key=lambda n: (n['on'], n['midi']))
    out, i = [], 0
    while i < len(ev):
        j, group = i, []
        while j < len(ev) and ev[j]['on'] - ev[i]['on'] <= BP_SKY_WIN_S:
            group.append(ev[j])
            j += 1
        top = max(group, key=lambda n: n['midi'])
        if 21 <= top['midi'] <= 108 and top['off'] - top['on'] >= NOTE_MIN_S * 0.6:
            out.append({'on': round(top['on'], 4), 'off': round(top['off'], 4), 'midi': top['midi'],
                        'vel': int(round(40 + 75 * min(1.0, top['amp'] ** 0.5))), '_n': len(group)})
        i = j
    return out


LEAD_WIN_S = 4.0       # an instrumental's tune may pass from one instrument to another: the lead is chosen again every this many seconds
                       # (synthetic tune moving from guitar to synth at half time, the guitar then strumming: one stem for the song recall 0.47,
                       # precision 0.53 (0.39 with the strum twice as loud); per window 0.94 / 0.94 both)


def lead_by_window(lines, levels, duration, win=LEAD_WIN_S):
    """An instrumental's melody when the tune moves between instruments. lines: [(held, stem, notes, tracker)]; levels: {stem: (rms, dt)}.
    In each window the stem whose line there is most like a tune wins: its level x the share of the window its line covers x how melodic it
    is (one note at a time, and moving: 1 / the mean notes per attack x the share of distinct pitches). Level alone picks a loud strummed
    accompaniment over a quieter lead. A single window that disagrees with both neighbours that agree is taken as theirs.
    Returns (notes without the private '_n', the stem that leads the longest, its tracker)."""
    if not lines:
        return [], None, None
    n_win = max(1, int(-(-duration // win)))
    by_stem = {k: (line, tracker) for _held, k, line, tracker in lines}

    def coverage(line, a, b):
        return sum(max(0.0, min(n['off'], b) - max(n['on'], a)) for n in line) / (b - a)

    def melodic(line, a, b):
        inside = [n for n in line if a <= n['on'] < b]
        if not inside:
            return 0.0
        per_attack = sum(n.get('_n', 1) for n in inside) / len(inside)
        return (1.0 / per_attack) * (len({n['midi'] for n in inside}) / len(inside))

    def level(k, a, b):
        rms, dt = levels[k]
        seg = rms[int(a / dt):max(int(a / dt) + 1, int(b / dt))]
        return float(sum(seg)) / len(seg) if len(seg) else 0.0   # a numpy array (stems) or a list (instruments)

    pick = []
    for w in range(n_win):
        a, b = w * win, min(duration, (w + 1) * win)
        if b <= a:
            pick.append(None)
            continue
        scores = {k: level(k, a, b) * coverage(by_stem[k][0], a, b) * melodic(by_stem[k][0], a, b) for k in by_stem}
        best = max(scores, key=lambda k: (scores[k], k))
        pick.append(best if scores[best] > 0 else None)
    for w in range(1, n_win - 1):
        if pick[w - 1] is not None and pick[w - 1] == pick[w + 1] != pick[w]:
            pick[w] = pick[w - 1]
    notes = []
    for k, (line, _t) in by_stem.items():
        for n in line:
            w = min(n_win - 1, int(n['on'] // win))
            if pick[w] == k:
                notes.append({key: v for key, v in n.items() if key != '_n'})
    notes.sort(key=lambda n: (n['on'], n['midi']))
    counts = {}
    for k in pick:
        if k is not None:
            counts[k] = counts.get(k, 0) + 1
    lead = max(counts, key=lambda k: (counts[k], k)) if counts else None
    return notes, lead, (by_stem[lead][1] if lead else None)


MT3_FRAME_S = 0.01      # the level of an instrument's notes (for choosing the lead) is read on this grid
MT3_BASS_PROGRAMS = range(32, 40)   # General MIDI basses
MELODY_LOW = 50         # a melody note below D3 is a bass or the low string of an arpeggio, not the tune: it is accompaniment
MELODY_DIP = 10         # ... and so is a note this many semitones under the tune around it (MELODY_NEAR_S either side)
MELODY_NEAR_S = 2.0
FILL_GAP_S = 1.0        # a stretch this long with no melody note is filled from the mix's most salient line (melody_contour.py)
FILL_PAD_S = 0.5        # the audio read around each such stretch


def _skyline(notes, win=BP_SKY_WIN_S):
    """The highest note of each attack (notes starting within win of the first), with '_n' = notes in the attack."""
    ev = sorted(notes, key=lambda n: (n['on'], n['midi']))
    out, i = [], 0
    while i < len(ev):
        j = i
        while j < len(ev) and ev[j]['on'] - ev[i]['on'] <= win:
            j += 1
        top = max(ev[i:j], key=lambda n: n['midi'])
        out.append({'on': top['on'], 'off': top['off'], 'midi': top['midi'], 'vel': top['vel'], '_n': j - i})
        i = j
    return out


def _note_level(notes, duration, dt=MT3_FRAME_S):
    """The sum of the sounding notes' velocities on a dt grid (plain lists: this path needs no numpy)."""
    lv = [0.0] * max(1, int(duration / dt) + 1)
    for n in notes:
        for k in range(int(n['on'] / dt), min(len(lv), max(int(n['on'] / dt) + 1, int(n['off'] / dt)))):
            lv[k] += n['vel'] / 127.0
    return lv, dt


def melody_family(program):
    """The review's word for the instrument a tune came from (home-result.js MELODY_FROM)."""
    return 'piano' if 0 <= program <= 7 else 'guitar' if 24 <= program <= 31 else 'other'


def drop_dips(melody):
    """The melody without the notes no tune has: below MELODY_LOW, or MELODY_DIP semitones under the median of the melody around
    it. An instrument's skyline takes a single low attack (a guitar's arpeggio dips to its bass string between two tune notes; an
    instrument chosen for a window where the model heard no tune plays bass notes), and the score wrote it as a wrong tune note."""
    out = []
    for n in melody:
        near = [m['midi'] for m in melody if abs(m['on'] - n['on']) <= MELODY_NEAR_S]
        if n['midi'] >= MELODY_LOW and statistics.median(near) - n['midi'] < MELODY_DIP:
            out.append(n)
    return out


def song_from_instruments(notes, duration):
    """A song's layers from a multi-instrument transcription (notes with 'channel' and 'program'): drums (channel 9) left out, the
    General MIDI basses are the bass, the melody is chosen every LEAD_WIN_S among the other instruments by lead_by_window (the
    instrument's notes as its level), and everything else of those instruments is the accompaniment.
    Returns (melody, bass, accomp, melody_from)."""
    groups, bass = {}, []
    for n in notes:
        if n.get('channel') == 9:
            continue
        clean = {'on': round(float(n['on']), 4), 'off': round(float(n['off']), 4), 'midi': int(n['midi']), 'vel': int(n.get('vel', 80))}
        if not (21 <= clean['midi'] <= 108) or clean['off'] <= clean['on']:
            continue
        prog = int(n.get('program', 0))
        (bass if prog in MT3_BASS_PROGRAMS else groups.setdefault(prog, [])).append(clean)
    lines = [(sum(x['off'] - x['on'] for x in sky), str(prog), sky, 'multi-instrument')
             for prog, sky in ((prog, _skyline(g)) for prog, g in groups.items())]
    levels = {str(prog): _note_level(g, duration) for prog, g in groups.items()}
    melody, lead, _tracker = lead_by_window(lines, levels, duration) if lines else ([], None, None)
    melody = drop_dips(melody)
    taken = {(n['on'], n['midi']) for n in melody}
    accomp = sorted((n for g in groups.values() for n in g if (n['on'], n['midi']) not in taken), key=lambda n: (n['on'], n['midi']))
    return melody, sorted(bass, key=lambda n: (n['on'], n['midi'])), accomp, (melody_family(int(lead)) if lead is not None else None)


def mt3_ready(a):
    return bool(getattr(a, 'mt3_python', '') and getattr(a, 'mt3_dir', '') and os.path.exists(a.mt3_python) and os.path.isdir(a.mt3_dir))


def run_mt3(a, device, duration, work):
    """YourMT3 (multi-instrument transcription) in its own Python, through yourmt3_run.py next to this file: the mix in, a MIDI with one
    program per instrument out. Its notes, each with 'channel' and 'program'."""
    import midi_notes
    mid = os.path.join(work, 'mt3.mid')
    runner = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'yourmt3_run.py')
    cmd = [a.mt3_python, runner, '--space', a.mt3_dir, '--wav', a.wav, '--mid', mid, '--device', device]
    env = dict(os.environ, PYTHONIOENCODING='utf-8')   # YourMT3 prints emoji; read its output as UTF-8 whatever the console's code page
    r = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8', errors='replace', env=env, timeout=max(600, int(duration * 10)))
    if r.returncode != 0 or not os.path.exists(mid):
        raise RuntimeError('YourMT3 failed (exit %s): %s' % (r.returncode, (r.stderr or r.stdout or '')[-400:]))
    # the last song's raw YourMT3 MIDI stays beside the YourMT3 folder (tools/yourmt3-last.mid), so a person can listen to what the model
    # heard before PPP picks the melody and writes the score: is a missing tune the model's or PPP's?
    try:
        shutil.copyfile(mid, os.path.join(os.path.dirname(os.path.abspath(a.mt3_dir)), 'yourmt3-last.mid'))
    except OSError:
        pass
    keep_audio(a.wav, os.path.join(os.path.dirname(os.path.abspath(a.mt3_dir)), 'yourmt3-last.wav'))
    return midi_notes.read_notes(mid, instruments=True)['notes']


def keep_audio(src, dst):
    """The same song's audio beside its MIDI (tools/yourmt3-last.wav: mono, 16 bit, at most 22.05 kHz, ~8 MB for three minutes),
    so the two can be compared where the original cannot be fetched (tools/home-worker/send-last-song.cmd sends both). Best
    effort: a song is transcribed whether or not this works."""
    try:
        import numpy as np
        import soundfile as sf
        data, sr = sf.read(src, dtype='float32', always_2d=True)
        x = data.mean(axis=1)
        step = max(1, int(sr // 22050))
        if step > 1:
            x = x[:len(x) // step * step].reshape(-1, step).mean(axis=1)
        sf.write(dst, np.clip(x, -1, 1), int(sr // step), subtype='PCM_16')
    except Exception:
        pass


def run_song_mt3(a, device, duration, t0):
    say('ENGINE multi-instrument')
    say('PROGRESS 0.050')
    work = tempfile.mkdtemp(prefix='mt3-', dir=os.path.dirname(os.path.abspath(a.out)))
    try:
        heard = run_mt3(a, device, duration, work)
    finally:
        shutil.rmtree(work, ignore_errors=True)
    say('PROGRESS 0.900')
    melody, bass, accomp, melody_from = song_from_instruments(heard, duration)
    tracker, filled, accomp_from = 'multi-instrument', [], 'multi-instrument'
    lead = lead_sheet(a, heard, duration)
    if lead and lead['melody']:
        # the tune a lead sheet writes (SheetSage2); the instrument line chosen above goes back to the accompaniment
        accomp = sorted(accomp + melody, key=lambda n: (n['on'], n['midi']))
        melody, tracker = lead['melody'], 'lead-sheet'
    if lead and lead['chords'] and lead['beats']:
        # and its chords, a chord a beat, are the accompaniment: what a pianist plays from a lead sheet, not every strum the band played
        from_chords = chord_accompaniment(lead['chords'], lead['beats'])
        if len(from_chords) >= 8:
            accomp, accomp_from = from_chords, 'lead-sheet'
            # and the bass under them, the chords' roots (YourMT3's bass line, eighths that fought the chords, is left out)
            roots = chord_bass(lead['chords'], lead['downbeats'] or lead['beats'][::4])
            if roots:
                bass = roots
    if tracker != 'lead-sheet':
        try:
            filled = fill_melody_gaps(melody, a.wav, duration)
        except Exception as e:   # the fill is an addition: a song is written without it
            say('NOTE the melody gaps were not filled: %s: %s' % (type(e).__name__, e))
        melody = sorted(melody + filled, key=lambda n: (n['on'], n['midi']))
    accomp, doubles = drop_doubles(accomp, melody + bass)
    for layer, name in ((melody, 'melody'), (bass, 'bass'), (accomp, 'accomp')):
        for n in layer:
            n['track'] = SONG_TRACK[name]
    notes = sorted(melody + bass + accomp, key=lambda n: (n['on'], n['midi']))
    if len(notes) < 4:
        raise RuntimeError('YourMT3 heard almost nothing')
    out = {
        'engine': 'song', 'mode': 'song', 'model': 'YourMT3 (multi-instrument)', 'device': device, 'duration': duration,
        'ms': int((time.time() - t0) * 1000), 'notes': notes, 'pedals': [], 'uncertainNotes': [],
        'ensemble': {'models': ['yourmt3'], 'primary': 'yourmt3', 'agreement': None, 'accepted': len(notes), 'uncertain': 0},
        'song': {'separation': 'yourmt3', 'melody': len(melody), 'melodyFrom': melody_from if melody else None,
                 'melodyTracker': tracker if melody else None, 'melodyFilled': len(filled), 'accompFrom': accomp_from, 'bass': len(bass), 'accomp': len(accomp),
                 'doublesDropped': doubles},
        'modelFailures': []
    }
    if lead and lead['beats']:
        # the lead sheet's beats and bar lines, which the page writes the bars on (song.beatsFrom 'lead-sheet'), and its key
        out['beats'], out['downbeats'], out['song']['beatsFrom'] = lead['beats'], lead['downbeats'], 'lead-sheet'
    if lead and lead['key']:
        out['song']['key'] = lead['key']
    return out


def ss2_ready(a):
    return bool(getattr(a, 'ss2_python', '') and getattr(a, 'ss2_dir', '') and os.path.exists(a.ss2_python) and os.path.isdir(a.ss2_dir))


LEAD_FILES = ('melody.mid', 'beat.lab', 'downbeat.lab', 'key.lab', 'chord.lab', 'events.json', 'result.json')


def lead_sheet(a, heard, duration):
    """SheetSage2's lead sheet (m-a-p/SheetSage2: a full song to melody, chords, beats and key) when it is installed
    (tools/home-worker/setup-sheetsage2.cmd), run in its own Python through sheetsage2_run.py: {'melody', 'beats', 'downbeats',
    'key', 'chords'} (each empty when the model gave none), or None when it is not installed or failed (a NOTE line; the song is
    then written from YourMT3 as before). Its files are kept in tools/sheetsage2-last/ for send-last-song.cmd."""
    if not ss2_ready(a):
        return None
    import midi_notes
    work = tempfile.mkdtemp(prefix='ss2-', dir=os.path.dirname(os.path.abspath(a.out)))
    try:
        say('PROGRESS 0.920')
        runner = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'sheetsage2_run.py')
        env = dict(os.environ, PYTHONIOENCODING='utf-8')
        r = subprocess.run([a.ss2_python, runner, '--model-dir', a.ss2_dir, '--wav', a.wav, '--out-dir', work], capture_output=True,
                           text=True, encoding='utf-8', errors='replace', env=env, timeout=max(600, int(duration * 10)))
        mid = os.path.join(work, 'melody.mid')
        if r.returncode != 0 or not os.path.exists(mid):
            raise RuntimeError('exit %s: %s' % (r.returncode, (r.stderr or r.stdout or '')[-400:]))
        keep = os.path.join(os.path.dirname(os.path.abspath(a.ss2_dir)), 'sheetsage2-last')
        try:
            shutil.rmtree(keep, ignore_errors=True)
            os.makedirs(keep, exist_ok=True)
            for name in LEAD_FILES:
                if os.path.exists(os.path.join(work, name)):
                    shutil.copyfile(os.path.join(work, name), os.path.join(keep, name))
        except OSError:
            pass
        melody = [{'on': round(float(n['on']), 4), 'off': round(float(n['off']), 4), 'midi': int(n['midi'])}
                  for n in midi_notes.read_notes(mid)['notes'] if float(n['off']) > float(n['on'])]
        lab = lambda name: read_lab(os.path.join(work, name))
        beats, downbeats = lab_times(lab('beat.lab')), lab_times(lab('downbeat.lab'))
        key, chords = lead_key(lab('key.lab')), lead_chords(lab('chord.lab'))
    except Exception as e:
        say('NOTE the lead sheet (SheetSage2) did not run: %s: %s' % (type(e).__name__, str(e)[:300]))
        return None
    finally:
        shutil.rmtree(work, ignore_errors=True)
    melody = melody_octaves(sorted(melody, key=lambda n: (n['on'], n['midi'])), heard)
    return {'melody': [dict(n, vel=80) for n in fold_outliers(melody)], 'beats': beats if len(beats) >= 4 else [],
            'downbeats': downbeats if len(beats) >= 4 else [], 'key': key, 'chords': chords}


# ---------------------------------------------------------------- lead-sheet annotations (LAB files: "time [time] [label]" a line)
PITCH_CLASS = {'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11}
CHORD_INTERVALS = {   # Harte shorthands (MIREX chord labels); a quality not listed is read by its leading letters below
    'maj': (0, 4, 7), 'min': (0, 3, 7), 'dim': (0, 3, 6), 'aug': (0, 4, 8), 'sus2': (0, 2, 7), 'sus4': (0, 5, 7), 'sus': (0, 5, 7),
    '7': (0, 4, 7, 10), 'maj7': (0, 4, 7, 11), 'min7': (0, 3, 7, 10), 'minmaj7': (0, 3, 7, 11), 'dim7': (0, 3, 6, 9), 'hdim7': (0, 3, 6, 10),
    'maj6': (0, 4, 7, 9), 'min6': (0, 3, 7, 9), '9': (0, 4, 7, 10), 'maj9': (0, 4, 7, 11), 'min9': (0, 3, 7, 10), '5': (0, 7), '1': (0,),
    'm': (0, 3, 7), 'm7': (0, 3, 7, 10), '': (0, 4, 7)}


def read_lab(path):
    """[(start, end or None, label or '')] of a LAB file; [] when it is not there. Lines that do not start with a number are skipped."""
    out = []
    if not os.path.isfile(path):
        return out
    with open(path, 'r', encoding='utf-8', errors='replace') as f:
        for line in f:
            parts = line.strip().split()
            nums = []
            for p in parts:
                try:
                    nums.append(float(p))
                except ValueError:
                    break
                if len(nums) == 2:
                    break
            if not nums:
                continue
            out.append((nums[0], nums[1] if len(nums) > 1 else None, ' '.join(parts[len(nums):])))
    return out


def lab_times(rows):
    """The start times of a beat or downbeat LAB, rising."""
    times = sorted(r[0] for r in rows if r[0] >= 0)
    return [round(t, 4) for i, t in enumerate(times) if i == 0 or t - times[i - 1] > 1e-3]


def pitch_class(label):
    m = re.match(r'^\s*([A-Ga-g])([#b♯♭]*)', label or '')
    if not m:
        return None
    return (PITCH_CLASS[m.group(1).upper()] + m.group(2).count('#') + m.group(2).count('♯') - m.group(2).count('b') - m.group(2).count('♭')) % 12


def chord_tones(label):
    """The pitch classes of a chord label ('F#:min', 'D:7/3', 'Bbmaj7', 'E'), root first; None for no chord ('N', 'X')."""
    label = (label or '').strip()
    if not label or label[0] in 'NX':
        return None
    root = pitch_class(label)
    if root is None:
        return None
    rest = re.sub(r'^\s*[A-Ga-g][#b♯♭]*', '', label).lstrip(':').split('/')[0].split('(')[0].strip()
    quality = rest if rest in CHORD_INTERVALS else ('min' if rest.startswith(('min', 'm')) and not rest.startswith('maj') else
                                                    'dim' if rest.startswith('dim') else 'aug' if rest.startswith('aug') else
                                                    'sus4' if rest.startswith('sus') else '7' if rest[:1].isdigit() else 'maj')
    return [(root + i) % 12 for i in CHORD_INTERVALS[quality]]


def lead_chords(rows):
    """[(start, end, [pitch classes])] of a chord LAB, no-chord stretches left out."""
    out = []
    for i, (t0, t1, label) in enumerate(rows):
        tones = chord_tones(label)
        end = t1 if t1 is not None else (rows[i + 1][0] if i + 1 < len(rows) else None)
        if tones and end is not None and end > t0:
            out.append((t0, end, tones))
    return out


def lead_key(rows):
    """{'tonic': 0-11, 'mode': 'major'|'minor'} of a key LAB: the key held longest; None when it states none."""
    held = {}
    for i, (t0, t1, label) in enumerate(rows):
        tonic = pitch_class(label)
        if tonic is None:
            continue
        low = label.lower()
        mode = 'minor' if re.search(r'(:|\s)(min|minor|m)\b|^[a-g][#b]*m\b|minor', low) else 'major'
        end = t1 if t1 is not None else (rows[i + 1][0] if i + 1 < len(rows) else t0 + 1.0)
        held[(tonic, mode)] = held.get((tonic, mode), 0.0) + max(0.0, end - t0)
    if not held:
        return None
    tonic, mode = max(held, key=lambda k: held[k])
    return {'tonic': tonic, 'mode': mode}


CHORD_LOW = 48    # the left hand's chord: its root from C3, the other tones above it within the octave
BASS_LOW = 36     # the lead sheet's bass: the chord's root from C2 to B2


def chord_bass(chords, downbeats):
    """The bass as a pianist plays it from a lead sheet: the chord's root, from C2 to B2, struck where the chord changes and on
    every downbeat, held until the next. [] without chords."""
    if not chords:
        return []
    times = sorted(set([round(c[0], 4) for c in chords] + [round(t, 4) for t in downbeats if chords[0][0] <= t < chords[-1][1]]))
    events = []
    for t in times:
        here = [c for c in chords if c[0] <= t + 1e-3 < c[1]]
        if here:
            events.append((t, BASS_LOW + here[0][2][0] % 12, here[0][1]))
    out = []
    for i, (t, midi, chord_end) in enumerate(events):
        end = min(events[i + 1][0] if i + 1 < len(events) else chord_end, chord_end)
        if end > t:
            out.append({'on': round(t, 4), 'off': round(end, 4), 'midi': midi, 'vel': 72})
    return out


def chord_accompaniment(chords, beats):
    """The accompaniment as a pianist plays a lead sheet: on every beat the chord sounding there, root, third and fifth (the
    seventh in place of the fifth), voiced up from its root at or above C3. [] without beats or chords."""
    out = []
    if len(beats) < 2 or not chords:
        return out
    for b0, b1 in zip(beats[:-1], beats[1:]):
        mid = (b0 + b1) / 2.0
        here = [c for c in chords if c[0] <= mid < c[1]]
        if not here:
            continue
        tones = here[0][2]
        pick = tones[:3] if len(tones) <= 3 else [tones[0], tones[1], tones[3]]
        root = CHORD_LOW + (pick[0] - CHORD_LOW) % 12
        for pc in pick:
            out.append({'on': round(b0, 4), 'off': round(b1, 4), 'midi': root + (pc - root) % 12, 'vel': 64})
    return out


def melody_octaves(notes, heard, near_s=0.12):
    """A lead sheet writes a tune in the octave that reads best, not always the one it sounds in: each note takes the octave of a
    note of its pitch class that YourMT3 heard starting within near_s of it (drums and basses aside), the one nearest the melody's
    previous note; a note with none keeps its own. On the test song this took the notes at Melodia's pitch from 48 to 111 of 535."""
    import bisect
    pitched = sorted((n for n in heard if n.get('channel') != 9 and int(n.get('program', 0)) not in MT3_BASS_PROGRAMS
                      and int(n['midi']) >= MELODY_LOW), key=lambda n: n['on'])
    starts = [float(n['on']) for n in pitched]
    out, prev = [], None
    for n in notes:
        lo, hi = bisect.bisect_left(starts, n['on'] - near_s), bisect.bisect_right(starts, n['on'] + near_s)
        same = [int(m['midi']) for m in pitched[lo:hi] if (int(m['midi']) - n['midi']) % 12 == 0]
        if same:
            ref = prev if prev is not None else n['midi']
            midi = min(same, key=lambda p: (abs(p - ref), abs(p - n['midi'])))
        else:
            midi = n['midi']
        out.append(dict(n, midi=midi))
        prev = midi
    return out


def fold_outliers(notes):
    """A melody note more than an octave from the melody around it (MELODY_NEAR_S either side), or below MELODY_LOW, is written
    in the melody's octave."""
    if not notes:
        return notes
    heard = [n['midi'] for n in notes]
    for n in notes:
        mid = statistics.median([heard[j] for j, m in enumerate(notes) if abs(m['on'] - n['on']) <= MELODY_NEAR_S])
        while n['midi'] - mid > 12:
            n['midi'] -= 12
        while mid - n['midi'] > 12 or n['midi'] < MELODY_LOW:
            n['midi'] += 12
    return notes


def melody_gaps(melody, duration, min_s=FILL_GAP_S):
    """The stretches of at least min_s where no melody note sounds: [(start, end)]."""
    gaps, end = [], 0.0
    for n in sorted(melody, key=lambda n: n['on']):
        if n['on'] - end >= min_s:
            gaps.append((end, n['on']))
        end = max(end, n['off'])
    if duration - end >= min_s:
        gaps.append((end, duration))
    return gaps


def fill_melody_gaps(melody, wav, duration):
    """Melody notes for the stretches the multi-instrument model left without a tune, from the predominant line of the mix
    (melody_contour.py) read in each stretch alone: a quiet lead under a loud band can be lost by a note transcriber and still
    be the most salient line. Notes below MELODY_LOW are left out, as everywhere."""
    gaps = melody_gaps(melody, duration)
    if not gaps:
        return []
    import numpy as np
    import soundfile as sf
    import melody_contour
    y, sr = sf.read(wav, dtype='float32', always_2d=True)
    y = y.mean(axis=1)
    out = []
    for g0, g1 in gaps:
        a0 = max(0.0, g0 - FILL_PAD_S)
        seg = y[int(a0 * sr):int(min(duration, g1 + FILL_PAD_S) * sr)]
        if len(seg) < sr // 2:
            continue
        times, midi = melody_contour.contour(seg, sr)
        got = []
        for n in melody_contour.notes(times, midi):
            on, off = n['on'] + a0, n['off'] + a0
            if on >= g0 + 0.02 and on < g1 - 0.05:
                got.append({'on': round(on, 4), 'off': round(min(off, g1), 4), 'midi': n['midi'], 'vel': 80})
        # a salience peak an octave off (the second harmonic's line) is written in the octave of the tune around it: the
        # stretch's own notes and the melody within FILL_GAP_S * 4 of it
        around = [m['midi'] for m in melody if g0 - 4 * FILL_GAP_S <= m['on'] <= g1 + 4 * FILL_GAP_S] + [n['midi'] for n in got]
        if around:
            mid = statistics.median(around)
            for n in got:
                while n['midi'] - mid > 7:
                    n['midi'] -= 12
                while mid - n['midi'] > 7:
                    n['midi'] += 12
        out.extend(n for n in got if n['midi'] >= MELODY_LOW)
    return out


def drop_doubles(accomp, others):
    """Accompaniment notes that are the melody or the bass heard again (the same key, starting within DOUBLE_TOL_S) go."""
    by_key = {}
    for n in others:
        by_key.setdefault(n['midi'], []).append(n['on'])
    kept, dropped = [], 0
    for n in accomp:
        if any(abs(t - n['on']) <= DOUBLE_TOL_S for t in by_key.get(n['midi'], [])):
            dropped += 1
            continue
        kept.append(n)
    return kept, dropped


def run_song(a, device, duration, t0):
    if mt3_ready(a):
        try:
            return run_song_mt3(a, device, duration, t0)
        except Exception as e:
            say('NOTE YourMT3 did not work, separating the stems instead: ' + str(e)[:300])
    import numpy as np
    import soundfile as sf
    say('ENGINE separation')
    say('PROGRESS 0.020')
    stems, sr = separate(a.wav, device, a.song_lib)
    try:
        import torch
        if device == 'cuda':
            torch.cuda.empty_cache()   # the separation's cached blocks go before TransKun (a subprocess) needs the GPU
    except Exception:
        pass
    say('PROGRESS 0.300')
    mono = {k: v.mean(axis=0).astype(np.float32) for k, v in stems.items()}
    mix_mono = sum(mono.values())
    mix_p95 = float(np.percentile(frame_level(mix_mono), 95)) or 1e-6
    p95 = {k: float(np.percentile(frame_level(v), 95)) for k, v in mono.items()}
    present = {k: p95[k] >= LAYER_MIN * mix_p95 for k in mono}
    import librosa
    melody, bass = [], []
    if present.get('vocals'):
        say('ENGINE vocal-melody')
        melody = track_notes(mono['vocals'], sr, librosa.note_to_hz('C2'), librosa.note_to_hz('C6'), gate=MELODY_GATE * p95['vocals'])
        for n in melody:
            n['track'] = SONG_TRACK['melody']
    melody_from = 'vocals' if melody else None
    melody_tracker = 'pitch-tracker' if melody else None   # which method followed the tune: shown on the review so a person can see which one ran
    if not present.get('vocals'):
        # no voice (an instrumental): the tune is played by an instrument - a synth, a guitar, a piano - that the piano models hear badly (a synth lead:
        # 43-55% of its notes on a synthetic piece with a known answer). The line of the stem that holds one clear pitch for the longest is the melody.
        lines = []
        use_bp = basic_pitch_ready()
        bp_work = tempfile.mkdtemp(prefix='lead-', dir=os.path.dirname(os.path.abspath(a.out))) if use_bp else None
        try:
            for k in LEAD_STEMS:
                if present.get(k):
                    line, tracker = None, 'pitch-tracker'
                    if use_bp:
                        try:
                            say('ENGINE lead-line-basic-pitch ' + k)
                            line = track_notes_bp(mono[k], sr, librosa.note_to_hz('C3'), librosa.note_to_hz('C7'), bp_work)
                            tracker = 'basic-pitch'
                        except Exception as e:
                            say('NOTE basic pitch failed on ' + k + ', following the pitch instead: ' + str(e)[:160])
                            line = None
                    if line is None:
                        say('ENGINE lead-line ' + k)
                        line = track_notes(mono[k], sr, librosa.note_to_hz('C3'), librosa.note_to_hz('C7'), gate=MELODY_GATE * p95[k])
                    lines.append((sum(n['off'] - n['on'] for n in line), k, line, tracker))
        finally:
            if bp_work:
                shutil.rmtree(bp_work, ignore_errors=True)
        if lines:
            line, k, tracker = lead_by_window(lines, {name: (frame_level(mono[name]), PT_HOP / float(sr)) for _h, name, _l, _t in lines}, duration)
            if sum(n['off'] - n['on'] for n in line) >= LEAD_MIN_SHARE * duration:
                melody, melody_from, melody_tracker = line, k, tracker
                for n in melody:
                    n['track'] = SONG_TRACK['melody']
    say('PROGRESS 0.400')
    if present.get('bass'):
        say('ENGINE bass-line')
        bass = track_notes(mono['bass'], sr, librosa.note_to_hz('A0'), librosa.note_to_hz('C4'), gate=0.1 * p95['bass'])
        for n in bass:
            n['track'] = SONG_TRACK['bass']
    say('PROGRESS 0.450')
    # the accompaniment: everything that is neither the voice, nor the bass, nor the drums
    rest_names = [k for k in stems if k not in ('vocals', 'bass', 'drums')]
    accomp, failures, merged = [], [], None
    # next to the output (the worker's job folder, which it removes even when it has to stop this process), not in the system's temp
    work = tempfile.mkdtemp(prefix='song-', dir=os.path.dirname(os.path.abspath(a.out)))
    try:
        if rest_names and any(present.get(k) for k in rest_names):
            rest = sum(stems[k] for k in rest_names)
            w44 = os.path.join(work, 'accomp.wav')
            sf.write(w44, rest.T, sr, subtype='PCM_16')
            w16 = os.path.join(work, 'accomp-16k.wav')
            sf.write(w16, librosa.resample(rest.mean(axis=0), orig_sr=sr, target_sr=16000), 16000, subtype='PCM_16')
            results, failures = run_piano_models(a, w44, w16, device, lo=0.45, width=0.53)
            if results:
                merged = consensus(results)
                accomp = merged['notes']
    finally:
        shutil.rmtree(work, ignore_errors=True)
    accomp, doubles = drop_doubles(accomp, melody + bass)
    for n in accomp:
        n['track'] = SONG_TRACK['accomp']
    notes = sorted(melody + bass + accomp, key=lambda n: (n['on'], n['midi']))
    if len(notes) < 4:
        raise SystemExit('SONG_NO_NOTES: no melody, bass or accompaniment was heard in this recording')
    used = [r for r in (merged['ensemble']['models'] if merged else [])]
    model = 'Demucs ' + SONG_MODEL + ' + pYIN melody and bass' + (' + ' + ' + '.join(MODEL_NAMES.get(m, m) for m in used) + ' on the accompaniment' if used else '')
    ens = merged['ensemble'] if merged else {'models': [], 'primary': None, 'agreement': None, 'accepted': 0, 'uncertain': 0}
    return {
        'engine': 'song',
        'mode': 'song',
        'model': model,
        'device': device,
        'duration': duration,
        'ms': int((time.time() - t0) * 1000),
        'notes': notes,
        'pedals': [],
        'uncertainNotes': merged['uncertainNotes'] if merged else [],
        'ensemble': ens,
        'song': {
            'separation': SONG_MODEL, 'melody': len(melody), 'melodyFrom': melody_from, 'melodyTracker': melody_tracker, 'bass': len(bass), 'accomp': len(accomp), 'doublesDropped': doubles,
            'layers': {k: round(p95[k] / mix_p95, 3) for k in sorted(p95)}
        },
        'modelFailures': failures
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
    ap.add_argument('--mode', default='piano', choices=['piano', 'song'])
    ap.add_argument('--song-lib', default='')
    ap.add_argument('--mt3-python', default='', help='song mode: the Python of a YourMT3 install (multi-instrument transcription)')
    ap.add_argument('--mt3-dir', default='', help='song mode: the YourMT3 code and checkpoints (the Hugging Face space mimbres/YourMT3)')
    ap.add_argument('--ss2-python', default='', help='song mode: the Python of a SheetSage2 install (the melody as a lead sheet writes it)')
    ap.add_argument('--ss2-dir', default='', help='song mode: the SheetSage2 model (the Hugging Face model m-a-p/SheetSage2)')
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

    if a.mode == 'song':
        result = run_song(a, device, duration, t0)
        with open(a.out, 'w', encoding='utf-8') as f:
            json.dump(result, f)
        say('PROGRESS 1')
        say('DONE')
        return

    results, failures = run_piano_models(a, a.wav, a.kong_wav, device)
    if not results:
        raise SystemExit('all transcription engines failed: ' + '; '.join(x['engine'] for x in failures))
    merged = consensus(results)
    notes, pedals = merged['notes'], merged['pedals']
    engine = 'ensemble' if len(results) > 1 else results[0]['engine']
    model_name = ' + '.join(MODEL_NAMES.get(r['engine'], r['engine']) for r in results)
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
