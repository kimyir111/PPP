#!/usr/bin/env python3
"""Verify catalog/hymns/*.musicxml against MX-2's invariant, from scratch and from the shipped
MusicXML alone - it trusts neither abc-to-musicxml.js nor the one-off script that patched the 100
shipped files (that script was never committed: see ../README.md's "MX-2" section). It exists so
the correctness of this real, user-facing catalog data has an audit trail someone can rerun, since
the original patch does not.

For every note in every hymn, checks that <alter> equals:
  - its own <accidental> if this note prints one (an explicit accidental always wins), else
  - the alter of the most recent explicit-or-tie-stop note of the same pitch letter+octave on the
    same staff, earlier in the same bar (in onset order, across every voice on that staff - an
    accidental holds for the rest of the bar on the staff it is written on), else
  - the key signature's default alteration for that pitch letter.
Also checks every <tie type="stop"/> has a preceding <tie type="start"/> in the same voice at a
matching pitch letter+octave (and vice versa: no start without an eventual stop), and that a tied
note's <alter> matches the note it continues.

Usage: python check-accidentals.py [file.musicxml ...]   (default: every catalog/hymns/*.musicxml)
Exit 1 if any file has an error.
"""
import glob
import os
import sys
import xml.etree.ElementTree as ET

HERE = os.path.dirname(os.path.abspath(__file__))
HYMNS_DIR = os.path.dirname(HERE)

SHARP_ORDER = 'FCGDAEB'


def signature_alters(fifths):
    alters = {c: 0 for c in 'CDEFGAB'}
    if fifths > 0:
        for c in SHARP_ORDER[:fifths]:
            alters[c] = 1
    elif fifths < 0:
        for c in SHARP_ORDER[::-1][: -fifths]:
            alters[c] = -1
    return alters


def note_alter(note_el):
    pitch = note_el.find('pitch')
    if pitch is None:
        return None
    alter_el = pitch.find('alter')
    return int(alter_el.text) if alter_el is not None else 0


def note_step_octave(note_el):
    pitch = note_el.find('pitch')
    return pitch.find('step').text, int(pitch.find('octave').text)


def has_explicit_accidental(note_el):
    return note_el.find('accidental') is not None


def tie_types(note_el):
    return {t.get('type') for t in note_el.findall('tie')}


def check_file(path):
    errors = []
    tree = ET.parse(path)
    root = tree.getroot()
    fifths = 0
    sig = signature_alters(0)
    # per-voice pending tie-start, carried across measures like the converter's own tie pass
    pending_tie = {}
    for part in root.findall('part'):
        for measure in part.findall('measure'):
            mnum = measure.get('number')
            key_el = measure.find('attributes/key/fifths')
            if key_el is not None:
                fifths = int(key_el.text)
                sig = signature_alters(fifths)
            # gather notes per voice in document order, tracking onset via duration/backup/forward
            voice_onset = {}
            entries = []  # (onset, staff, step, octave, note_el, voice)
            cur_voice = None
            onset = 0
            for child in measure:
                tag = child.tag
                if tag == 'backup':
                    onset -= int(child.find('duration').text)
                elif tag == 'forward':
                    onset += int(child.find('duration').text)
                elif tag == 'note':
                    voice_el = child.find('voice')
                    voice = voice_el.text if voice_el is not None else '1'
                    if child.find('chord') is None:
                        this_onset = onset
                    else:
                        this_onset = entries[-1][0] if entries else onset
                    if child.find('rest') is None and child.find('pitch') is not None:
                        staff_el = child.find('staff')
                        staff = staff_el.text if staff_el is not None else '1'
                        step, octave = note_step_octave(child)
                        entries.append((this_onset, staff, step, octave, child, voice))
                    if child.find('chord') is None:
                        dur_el = child.find('duration')
                        if dur_el is not None:
                            onset += int(dur_el.text)
            entries.sort(key=lambda e: e[0])

            # tie-stop resolution + validation, per voice, using pending_tie carried from earlier bars
            tie_stop_alter = {}  # id(note_el) -> alter it must match
            by_voice_order = {}
            for onset_, staff, step, octave, note_el, voice in entries:
                by_voice_order.setdefault(voice, []).append((step, octave, note_el))
            for voice, seq in by_voice_order.items():
                pend = pending_tie.get(voice)
                for step, octave, note_el in seq:
                    tt = tie_types(note_el)
                    if pend is not None:
                        match = None
                        for pp in pend:
                            if not pp['used'] and pp['step'] == step and pp['octave'] == octave:
                                match = pp
                                break
                        if match is not None:
                            match['used'] = True
                            if 'stop' not in tt:
                                errors.append(f"{path} m{mnum} voice {voice} {step}{octave}: tied note has no <tie type=\"stop\">")
                            else:
                                tie_stop_alter[id(note_el)] = match['alter']
                        elif 'stop' in tt:
                            errors.append(f"{path} m{mnum} voice {voice} {step}{octave}: <tie type=\"stop\"> with no matching start")
                    elif 'stop' in tt:
                        errors.append(f"{path} m{mnum} voice {voice} {step}{octave}: <tie type=\"stop\"> with no matching start")
                    if 'start' in tt:
                        pend = [{'step': step, 'octave': octave, 'alter': note_alter(note_el), 'used': False}]
                    else:
                        pend = None
                pending_tie[voice] = pend
            # any pending tie left unconsumed at the very end of the piece is an orphaned start;
            # mid-piece it is fine (matched against a later measure) so only flagged after the loop

            # bar-carry validation, per staff, across every voice on that staff, in onset order
            state = {}
            for onset_, staff, step, octave, note_el, voice in entries:
                key2 = (staff, step, octave)
                actual = note_alter(note_el)
                explicit = has_explicit_accidental(note_el)
                is_tie_stop = id(note_el) in tie_stop_alter
                if explicit:
                    expected = actual
                    state[key2] = actual
                elif is_tie_stop:
                    expected = tie_stop_alter[id(note_el)]
                    state[key2] = expected
                elif key2 in state:
                    expected = state[key2]
                else:
                    expected = sig.get(step, 0)
                if actual != expected:
                    errors.append(
                        f"{path} m{mnum} staff {staff} {step}{octave}: alter={actual} expected {expected} "
                        f"(fifths={fifths}, explicit={explicit}, tie_stop={is_tie_stop})"
                    )
    for voice, pend in pending_tie.items():
        if pend:
            for pp in pend:
                if not pp['used']:
                    errors.append(f"{path} voice {voice} {pp['step']}{pp['octave']}: <tie type=\"start\"> never stops")
    return errors


def main(argv):
    paths = argv[1:] or sorted(glob.glob(os.path.join(HYMNS_DIR, '*.musicxml')))
    total_errors = []
    for p in paths:
        total_errors.extend(check_file(p))
    if total_errors:
        for e in total_errors:
            print('FAIL:', e)
        print(f'\n{len(total_errors)} error(s) in {len(paths)} file(s)')
        return 1
    print(f'OK: 0 errors in {len(paths)} file(s)')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
