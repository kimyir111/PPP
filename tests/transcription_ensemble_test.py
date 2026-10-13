import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import midi_notes
import transcribe


class TranscriptionEnsembleTest(unittest.TestCase):
    def test_primary_is_recall_floor_and_agreement_refines_timing(self):
        merged = transcribe.consensus([
            {
                'engine': 'transkun',
                'notes': [
                    {'on': 1.00, 'off': 2.00, 'midi': 60, 'vel': 70},
                    {'on': 2.00, 'off': 3.00, 'midi': 64, 'vel': 68},
                ],
                'pedals': [],
            },
            {
                'engine': 'piano-transcription',
                'notes': [
                    {'on': 1.04, 'off': 2.06, 'midi': 60, 'vel': 74},
                    {'on': 3.00, 'off': 4.00, 'midi': 67, 'vel': 65},
                ],
                'pedals': [{'on': 0.9, 'off': 2.2}],
            },
        ])
        self.assertEqual([n['midi'] for n in merged['notes']], [60, 64])
        self.assertAlmostEqual(merged['notes'][0]['on'], 1.02, places=3)
        self.assertEqual(merged['notes'][0]['support'], 2)
        self.assertEqual([n['midi'] for n in merged['uncertainNotes']], [67])
        self.assertEqual(merged['ensemble']['primary'], 'transkun')
        self.assertEqual(merged['ensemble']['pedalSource'], 'piano-transcription')

    def test_two_secondary_models_can_recover_a_primary_miss(self):
        merged = transcribe.consensus([
            {'engine': 'transkun', 'notes': [], 'pedals': []},
            {'engine': 'piano-transcription', 'notes': [{'on': 1, 'off': 2, 'midi': 72, 'vel': 60}], 'pedals': []},
            {'engine': 'aria-amt', 'notes': [{'on': 1.05, 'off': 2.1, 'midi': 72, 'vel': 64}], 'pedals': []},
        ])
        self.assertEqual(len(merged['notes']), 1)
        self.assertEqual(merged['notes'][0]['midi'], 72)
        self.assertEqual(merged['notes'][0]['support'], 2)

    def test_secondary_fast_run_recovers_primary_misses(self):
        merged = transcribe.consensus([
            {
                'engine': 'transkun',
                'notes': [
                    {'on': 1.00, 'off': 1.07, 'midi': 72, 'vel': 70},
                    {'on': 1.16, 'off': 1.23, 'midi': 74, 'vel': 70},
                    {'on': 1.32, 'off': 1.39, 'midi': 76, 'vel': 70},
                ], 'pedals': []
            },
            {
                'engine': 'piano-transcription',
                'notes': [
                    {'on': 1.00, 'off': 1.06, 'midi': 72, 'vel': 68},
                    {'on': 1.08, 'off': 1.14, 'midi': 73, 'vel': 68},
                    {'on': 1.16, 'off': 1.22, 'midi': 74, 'vel': 68},
                    {'on': 1.24, 'off': 1.30, 'midi': 75, 'vel': 68},
                    {'on': 1.32, 'off': 1.38, 'midi': 76, 'vel': 68},
                ], 'pedals': []
            },
        ])
        recovered = [n for n in merged['notes'] if n.get('recovered') == 'fast-run']
        self.assertEqual([n['midi'] for n in recovered], [73, 75])
        self.assertEqual(merged['ensemble']['fastRecovered'], 2)

    def test_isolated_secondary_note_is_still_rejected(self):
        merged = transcribe.consensus([
            {'engine': 'transkun', 'notes': [
                {'on': 1.0, 'off': 1.3, 'midi': 60, 'vel': 70},
                {'on': 1.2, 'off': 1.4, 'midi': 64, 'vel': 70},
            ], 'pedals': []},
            {'engine': 'piano-transcription', 'notes': [
                {'on': 1.1, 'off': 1.4, 'midi': 91, 'vel': 30},
            ], 'pedals': []},
        ])
        self.assertNotIn(91, [n['midi'] for n in merged['notes']])

    def test_midi_reader_keeps_damper_pedal(self):
        handle = tempfile.NamedTemporaryFile(suffix='.mid', delete=False)
        handle.close()
        try:
            midi_notes.write_notes(
                handle.name,
                [{'on': 0.5, 'off': 1.0, 'midi': 60, 'vel': 70}],
                pedals=[{'on': 0.4, 'off': 1.2}],
            )
            parsed = midi_notes.read_notes(handle.name)
            self.assertEqual(len(parsed['pedals']), 1)
            self.assertAlmostEqual(parsed['pedals'][0]['on'], 0.4, places=2)
            self.assertAlmostEqual(parsed['pedals'][0]['off'], 1.2, places=2)
        finally:
            os.unlink(handle.name)

try:
    import numpy as np
    import librosa  # noqa: F401
    HAVE_LIBROSA = True
except Exception:
    HAVE_LIBROSA = False


@unittest.skipUnless(HAVE_LIBROSA, 'librosa is not installed')
class SongModeTest(unittest.TestCase):
    """G10d song mode: one note at a time from a separated stem, and the accompaniment that only repeats the melody."""

    SR = 44100

    def tone(self, midi, seconds, level=0.3):
        t = np.arange(int(seconds * self.SR)) / float(self.SR)
        f = 440.0 * 2 ** ((midi - 69) / 12.0)
        y = level * (np.sin(2 * np.pi * f * t) + 0.3 * np.sin(4 * np.pi * f * t))
        fade = min(len(y) // 2, int(0.01 * self.SR))
        y[:fade] *= np.linspace(0, 1, fade)
        y[-fade:] *= np.linspace(1, 0, fade)
        return y.astype(np.float32)

    def silence(self, seconds):
        return np.zeros(int(seconds * self.SR), dtype=np.float32)

    def test_a_melody_of_three_notes_is_three_notes_at_their_pitches(self):
        y = np.concatenate([self.silence(0.3), self.tone(67, 0.5), self.tone(72, 0.5), self.tone(64, 0.6), self.silence(0.3)])
        notes = transcribe.track_notes(y, self.SR, librosa.note_to_hz('C2'), librosa.note_to_hz('C6'), gate=0.01)
        self.assertEqual([n['midi'] for n in notes], [67, 72, 64])
        self.assertAlmostEqual(notes[0]['on'], 0.3, delta=0.08)
        self.assertAlmostEqual(notes[1]['on'], 0.8, delta=0.08)

    def test_a_repeated_note_after_a_short_break_is_two_notes(self):
        y = np.concatenate([self.silence(0.3), self.tone(69, 0.4), self.silence(0.08), self.tone(69, 0.4), self.silence(0.3)])
        notes = transcribe.track_notes(y, self.SR, librosa.note_to_hz('C2'), librosa.note_to_hz('C6'), gate=0.01)
        self.assertEqual([n['midi'] for n in notes], [69, 69])

    def test_a_quiet_stem_is_silence(self):
        y = np.concatenate([self.silence(0.3), self.tone(67, 0.6, level=0.001), self.silence(0.3)])
        notes = transcribe.track_notes(y, self.SR, librosa.note_to_hz('C2'), librosa.note_to_hz('C6'), gate=0.01)
        self.assertEqual(notes, [])

    def test_a_click_inside_a_held_note_does_not_cut_it(self):
        """a drum bleeding into the stem makes an onset but no dip of the note's level: one note"""
        y = np.concatenate([self.silence(0.3), self.tone(69, 1.2), self.silence(0.3)])
        rng = np.random.default_rng(3)
        for t in (0.6, 0.85, 1.1):
            i = int(t * self.SR)
            y[i:i + 400] += (0.25 * rng.standard_normal(400) * np.exp(-np.arange(400) / 80.0)).astype(np.float32)
        notes = transcribe.track_notes(y, self.SR, librosa.note_to_hz('C2'), librosa.note_to_hz('C6'), gate=0.01)
        self.assertEqual([n['midi'] for n in notes], [69])
        self.assertGreater(notes[0]['off'] - notes[0]['on'], 1.0)

    def test_a_note_struck_again_without_silence_is_two_notes(self):
        """a re-attack: the level falls to a fifth for 30 ms and comes back, with no silence between"""
        a = self.tone(64, 0.5)
        b = self.tone(64, 0.5)
        dip = (self.tone(64, 0.03) * 0.2).astype(np.float32)
        y = np.concatenate([self.silence(0.3), a, dip, b, self.silence(0.3)])
        notes = transcribe.track_notes(y, self.SR, librosa.note_to_hz('C2'), librosa.note_to_hz('C6'), gate=0.005)
        self.assertEqual([n['midi'] for n in notes], [64, 64])

    def test_an_accompaniment_note_that_repeats_the_melody_goes(self):
        melody = [{'on': 1.0, 'off': 1.5, 'midi': 72}]
        accomp = [{'on': 1.03, 'off': 1.4, 'midi': 72}, {'on': 1.0, 'off': 1.4, 'midi': 64}, {'on': 1.2, 'off': 1.4, 'midi': 72}]
        kept, dropped = transcribe.drop_doubles(accomp, melody)
        self.assertEqual(dropped, 1)
        self.assertEqual([(n['on'], n['midi']) for n in kept], [(1.0, 64), (1.2, 72)])

    @unittest.skipUnless(transcribe.basic_pitch_ready(), 'Basic Pitch (optional) is not installed')
    def test_basic_pitch_lead_line_keeps_the_top_note_of_a_chord_stab(self):
        import numpy as np
        sr = 44100
        t = np.arange(int(0.6 * sr)) / sr

        def tone(midi):
            f = 440.0 * 2 ** ((midi - 69) / 12.0)
            return sum(np.sin(2 * np.pi * f * k * t) / k for k in range(1, 8)) * np.minimum(1, t / 0.01) * np.minimum(1, (0.6 - t) / 0.04)
        y = np.zeros(int(4 * sr), dtype=np.float32)
        for start, chord in ((0.4, (64, 68, 71)), (1.6, (62, 66, 69))):
            i = int(start * sr)
            y[i:i + len(t)] += (0.2 * sum(tone(m) for m in chord)).astype(np.float32)
        with tempfile.TemporaryDirectory() as work:
            line = transcribe.track_notes_bp(y, sr, 130.0, 2100.0, work)
        self.assertEqual([n['midi'] for n in line], [71, 69])
        self.assertTrue(all(set(n) == {'on', 'off', 'midi', 'vel', '_n'} for n in line))   # '_n': notes in the attack, for choosing the lead; never written out
        self.assertEqual([n['_n'] for n in line], [3, 3])

    def test_lead_moves_to_the_instrument_that_plays_the_tune(self):
        import numpy as np
        tune = lambda t0, pitches: [{'on': t0 + 0.5 * i, 'off': t0 + 0.5 * i + 0.45, 'midi': m, 'vel': 80} for i, m in enumerate(pitches)]
        strum = lambda t0, n: [{'on': t0 + 0.5 * i, 'off': t0 + 0.5 * i + 0.45, 'midi': 64, 'vel': 90, '_n': 3} for i in range(n)]
        guitar = tune(0.0, [67, 69, 71, 72, 74, 72, 71, 69] * 2) + strum(8.0, 16)       # the tune, then a strummed accompaniment
        synth = strum(0.0, 16) + tune(8.0, [76, 74, 72, 71, 72, 74, 76, 77] * 2)        # a pad, then the tune
        lines = [(8.0, 'guitar', guitar, 'basic-pitch'), (8.0, 'other', synth, 'basic-pitch')]
        levels = {'guitar': (np.full(2000, 0.4), 0.01), 'other': (np.full(2000, 0.2), 0.01)}  # the strum is LOUDER than the synth's tune
        notes, lead, tracker = transcribe.lead_by_window(lines, levels, 16.0)
        self.assertEqual([n['midi'] for n in notes], [67, 69, 71, 72, 74, 72, 71, 69] * 2 + [76, 74, 72, 71, 72, 74, 76, 77] * 2)
        self.assertTrue(all('_n' not in n for n in notes))
        self.assertEqual(tracker, 'basic-pitch')
        self.assertIn(lead, ('guitar', 'other'))


def _write_multi_midi(path, tracks, tpq=480, bpm=120):
    """A format-1 MIDI: tracks = [(channel, program, [(on_s, off_s, midi)])], one track each, its program set at the start."""
    import struct
    spt = 60.0 / bpm / tpq

    def vlq(n):
        out = [n & 0x7F]
        n >>= 7
        while n:
            out.append(0x80 | (n & 0x7F))
            n >>= 7
        return bytes(reversed(out))
    chunks = []
    for ch, prog, notes in tracks:
        ev = []
        for on, off, m in notes:
            ev.append((int(round(on / spt)), 1, bytes([0x90 | ch, m, 80])))
            ev.append((int(round(off / spt)), 0, bytes([0x80 | ch, m, 0])))
        ev.sort(key=lambda e: (e[0], e[1]))
        body, last = bytearray(vlq(0) + bytes([0xC0 | ch, prog])), 0
        for tick, _k, msg in ev:
            body += vlq(tick - last) + msg
            last = tick
        body += vlq(0) + b'\xff\x2f\x00'
        chunks.append(b'MTrk' + struct.pack('>I', len(body)) + bytes(body))
    with open(path, 'wb') as f:
        f.write(b'MThd' + struct.pack('>IHHH', 6, 1, len(chunks), tpq) + b''.join(chunks))


class MultiInstrumentTest(unittest.TestCase):
    """Song mode with YourMT3: its MIDI (one program per instrument) becomes melody, bass and accompaniment."""
    TUNE_A = [67, 69, 71, 72, 74, 72, 71, 69] * 2
    TUNE_B = [76, 74, 72, 71, 72, 74, 76, 77] * 2

    def tracks(self):
        tune = lambda t0, ps: [(t0 + 0.5 * i, t0 + 0.5 * i + 0.45, m) for i, m in enumerate(ps)]
        strum = lambda t0, n: [(t0 + 0.5 * i, t0 + 0.5 * i + 0.45, m) for i in range(n) for m in (57, 60, 64)]
        return [(0, 25, tune(0.0, self.TUNE_A) + strum(8.0, 16)),     # guitar: the tune, then strums
                (1, 81, strum(0.0, 16) + tune(8.0, self.TUNE_B)),     # synth lead: a pad, then the tune
                (2, 33, [(0.5 * i, 0.5 * i + 0.4, 40) for i in range(32)]),   # bass
                (9, 0, [(0.5 * i, 0.5 * i + 0.1, 36) for i in range(32)])]    # drums

    def test_read_notes_keeps_channel_and_program_when_asked(self):
        with tempfile.TemporaryDirectory() as d:
            mid = os.path.join(d, 'm.mid')
            _write_multi_midi(mid, self.tracks())
            plain = midi_notes.read_notes(mid)['notes']
            rich = midi_notes.read_notes(mid, instruments=True)['notes']
        self.assertTrue(all(set(n) == {'on', 'off', 'midi', 'vel'} for n in plain))   # unchanged for every other caller
        self.assertEqual({(n['channel'], n['program']) for n in rich}, {(0, 25), (1, 81), (2, 33), (9, 0)})

    def test_layers_follow_the_tune_across_instruments(self):
        with tempfile.TemporaryDirectory() as d:
            mid = os.path.join(d, 'm.mid')
            _write_multi_midi(mid, self.tracks())
            notes = midi_notes.read_notes(mid, instruments=True)['notes']
        melody, bass, accomp, melody_from = transcribe.song_from_instruments(notes, 16.0)
        self.assertEqual([n['midi'] for n in melody], self.TUNE_A + self.TUNE_B)
        self.assertEqual({n['midi'] for n in bass}, {40})
        self.assertNotIn(36, {n['midi'] for n in melody + bass + accomp})   # drums left out
        self.assertEqual(len(accomp), 16 * 3 * 2 - 0)                     # every strum and pad note, no tune note
        self.assertIn(melody_from, ('guitar', 'other'))
        self.assertTrue(all(set(n) == {'on', 'off', 'midi', 'vel'} for n in melody + bass + accomp))

    @unittest.skipIf(os.name == 'nt', 'the fake YourMT3 is a shell script')
    def test_song_mode_runs_yourmt3_and_writes_layers(self):
        with tempfile.TemporaryDirectory() as d:
            src = os.path.join(d, 'answer.mid')
            _write_multi_midi(src, self.tracks())
            fake = os.path.join(d, 'fake-python')
            with open(fake, 'w') as f:   # stands in for YourMT3's Python running yourmt3_run.py: copies the answer to --mid
                f.write('#!/bin/sh\nwhile [ $# -gt 0 ]; do if [ "$1" = "--mid" ]; then cp "%s" "$2"; fi; shift; done\n' % src)
            os.chmod(fake, 0o755)
            space = os.path.join(d, 'space')
            os.mkdir(space)
            a = type('A', (), {'mt3_python': fake, 'mt3_dir': space, 'wav': os.path.join(d, 'in.wav'), 'out': os.path.join(d, 'out.json')})
            self.assertTrue(transcribe.mt3_ready(a))
            r = transcribe.run_song_mt3(a, 'cpu', 16.0, 0.0)
        self.assertEqual(r['song']['melodyTracker'], 'multi-instrument')
        self.assertEqual(r['song']['separation'], 'yourmt3')
        self.assertEqual((r['song']['melody'], r['song']['bass']), (32, 32))
        self.assertEqual(sorted({n['track'] for n in r['notes']}), [1, 2, 3])

    def test_lead_sheet_labels(self):
        self.assertEqual(transcribe.chord_tones('F#:min'), [6, 9, 1])
        self.assertEqual(transcribe.chord_tones('Bb:7/3'), [10, 2, 5, 8])
        self.assertEqual(transcribe.chord_tones('Ebmaj7'), [3, 7, 10, 2])
        self.assertEqual(transcribe.chord_tones('C#m'), [1, 4, 8])
        self.assertIsNone(transcribe.chord_tones('N'))
        self.assertEqual(transcribe.lead_key([(0.0, 10.0, 'F#:minor'), (10.0, 12.0, 'A:major')]), {'tonic': 6, 'mode': 'minor'})
        self.assertEqual(transcribe.lead_key([(0.0, 5.0, 'Db major')]), {'tonic': 1, 'mode': 'major'})
        self.assertEqual(transcribe.lead_key([(0.0, 5.0, 'Am')]), {'tonic': 9, 'mode': 'minor'})
        self.assertIsNone(transcribe.lead_key([]))
        self.assertEqual(transcribe.lab_times([(1.0, None, '2'), (0.5, None, '1'), (0.5, None, '1')]), [0.5, 1.0])

    def test_a_lead_sheet_note_far_from_the_tune_is_written_in_its_octave(self):
        notes = [{'on': 0.5 * i, 'off': 0.5 * i + 0.4, 'midi': m} for i, m in enumerate([76, 78, 55, 79, 81, 102])]
        self.assertEqual([n['midi'] for n in transcribe.fold_outliers(notes)], [76, 78, 67, 79, 81, 90])   # within an octave of the tune

    def test_a_lead_sheet_note_takes_the_octave_yourmt3_heard_it_in(self):
        heard = [{'on': 0.0, 'off': 0.4, 'midi': 64, 'channel': 0, 'program': 25}, {'on': 0.5, 'off': 0.9, 'midi': 67, 'channel': 0, 'program': 25},
                 {'on': 0.5, 'off': 0.9, 'midi': 43, 'channel': 2, 'program': 33}, {'on': 1.0, 'off': 1.4, 'midi': 36, 'channel': 9, 'program': 0}]
        sheet = [{'on': 0.02, 'off': 0.5, 'midi': 76}, {'on': 0.5, 'off': 1.0, 'midi': 79}, {'on': 1.0, 'off': 1.5, 'midi': 84}]
        got = transcribe.melody_octaves(sheet, heard)
        self.assertEqual([n['midi'] for n in got], [64, 67, 84])   # an octave down where the band played it; the bass and drums not; none heard: kept

    @unittest.skipIf(os.name == 'nt', 'the fake SheetSage2 is a shell script')
    def test_song_mode_takes_the_lead_sheet_melody_when_sheetsage2_is_there(self):
        with tempfile.TemporaryDirectory() as d:
            src = os.path.join(d, 'answer.mid')
            _write_multi_midi(src, self.tracks())
            sheet = os.path.join(d, 'sheet.mid')   # what SheetSage2 writes: the tune alone, a lead sheet's melody
            _write_multi_midi(sheet, [(0, 0, [(8.0 + 0.5 * i, 8.45 + 0.5 * i, m) for i, m in enumerate(self.TUNE_B)])])
            py = os.path.join(d, 'fake-python')
            with open(py, 'w') as f:
                f.write('#!/bin/sh\nwhile [ $# -gt 0 ]; do if [ "$1" = "--mid" ]; then cp "%s" "$2"; fi; shift; done\n' % src)
            os.chmod(py, 0o755)
            labs = os.path.join(d, 'labs')
            os.mkdir(labs)
            with open(os.path.join(labs, 'beat.lab'), 'w') as f:
                f.write(''.join('%.3f\t%d\n' % (0.5 * i, i % 4 + 1) for i in range(33)))
            with open(os.path.join(labs, 'downbeat.lab'), 'w') as f:
                f.write(''.join('%.3f\n' % (2.0 * i) for i in range(9)))
            with open(os.path.join(labs, 'key.lab'), 'w') as f:
                f.write('0.000 16.000 C:maj\n')
            with open(os.path.join(labs, 'chord.lab'), 'w') as f:
                f.write('0.000 4.000 C:maj\n4.000 8.000 A:min\n8.000 12.000 F:maj7\n12.000 16.000 G:7\n')
            ss2 = os.path.join(d, 'fake-ss2-python')
            with open(ss2, 'w') as f:
                f.write('#!/bin/sh\nwhile [ $# -gt 0 ]; do if [ "$1" = "--out-dir" ]; then cp "%s" "$2/melody.mid"; cp %s/*.lab "$2/"; fi; shift; done\n'
                        % (sheet, labs))
            os.chmod(ss2, 0o755)
            space, model = os.path.join(d, 'space'), os.path.join(d, 'sheetsage2')
            os.mkdir(space)
            os.mkdir(model)
            a = type('A', (), {'mt3_python': py, 'mt3_dir': space, 'ss2_python': ss2, 'ss2_dir': model,
                               'wav': os.path.join(d, 'in.wav'), 'out': os.path.join(d, 'out.json')})
            r = transcribe.run_song_mt3(a, 'cpu', 16.0, 0.0)
            kept = sorted(os.listdir(os.path.join(d, 'sheetsage2-last')))
        mel = sorted((n for n in r['notes'] if n['track'] == 1), key=lambda n: n['on'])
        self.assertEqual([n['midi'] for n in mel], self.TUNE_B)
        self.assertEqual(r['song']['melodyTracker'], 'lead-sheet')
        # a "boom-chick" left hand: the chord's root on each downbeat (and chord change) for a beat, the chord in close position on
        # the other three beats, each inversion the nearest to the one before (C: E G C, Am: E A C, Fmaj7: F A E, G7: F G B)
        acc = [n for n in r['notes'] if n['track'] == 3]
        self.assertEqual(r['song']['accompFrom'], 'lead-sheet')
        self.assertEqual(len(acc), 24 * 3)
        at = lambda t: sorted(n['midi'] for n in acc if abs(n['on'] - t) < 1e-6)
        self.assertEqual([at(0.5), at(4.5), at(8.5), at(12.5)], [[52, 55, 60], [52, 57, 60], [53, 57, 64], [53, 55, 59]])
        self.assertEqual(at(0.0), [])
        self.assertTrue(all(max(at(n['on'])) - min(at(n['on'])) <= 12 for n in acc))   # one hand, no stretch
        bass = sorted((n for n in r['notes'] if n['track'] == 2), key=lambda n: n['on'])
        self.assertEqual([(n['on'], n['midi']) for n in bass], [(0.0, 48), (2.0, 48), (4.0, 45), (6.0, 45), (8.0, 41), (10.0, 41), (12.0, 43), (14.0, 43)])
        self.assertTrue(all(n['off'] - n['on'] <= 0.53 for n in bass))           # for a beat: the chord answers it
        self.assertEqual(r['song']['bass'], 8)
        # its beats, bar lines and key go with the notes
        self.assertEqual(len(r['beats']), 33)
        self.assertEqual(r['downbeats'][:3], [0.0, 2.0, 4.0])
        self.assertEqual(r['song']['beatsFrom'], 'lead-sheet')
        self.assertEqual(r['song']['key'], {'tonic': 0, 'mode': 'major'})
        self.assertEqual(kept, ['beat.lab', 'chord.lab', 'downbeat.lab', 'key.lab', 'melody.mid'])

    @unittest.skipIf(os.name == 'nt', 'the fake SheetSage2 is a shell script')
    def test_a_failing_sheetsage2_leaves_the_song_as_before(self):
        with tempfile.TemporaryDirectory() as d:
            src = os.path.join(d, 'answer.mid')
            _write_multi_midi(src, self.tracks())
            py = os.path.join(d, 'fake-python')
            with open(py, 'w') as f:
                f.write('#!/bin/sh\nwhile [ $# -gt 0 ]; do if [ "$1" = "--mid" ]; then cp "%s" "$2"; fi; shift; done\n' % src)
            os.chmod(py, 0o755)
            ss2 = os.path.join(d, 'fake-ss2-python')
            with open(ss2, 'w') as f:
                f.write('#!/bin/sh\necho "SHEETSAGE2_FAILED: no model" >&2\nexit 2\n')
            os.chmod(ss2, 0o755)
            space, model = os.path.join(d, 'space'), os.path.join(d, 'sheetsage2')
            os.mkdir(space)
            os.mkdir(model)
            a = type('A', (), {'mt3_python': py, 'mt3_dir': space, 'ss2_python': ss2, 'ss2_dir': model,
                               'wav': os.path.join(d, 'in.wav'), 'out': os.path.join(d, 'out.json')})
            r = transcribe.run_song_mt3(a, 'cpu', 16.0, 0.0)
        self.assertEqual(r['song']['melodyTracker'], 'multi-instrument')
        self.assertEqual(r['song']['melody'], 32)

    def test_low_and_dipping_notes_are_not_the_tune(self):
        tune = [{'on': 0.25 * i, 'off': 0.25 * i + 0.2, 'midi': m, 'vel': 80} for i, m in enumerate([72, 74, 76, 74, 72, 74, 76, 77])]
        dip = {'on': 0.9, 'off': 1.0, 'midi': 57, 'vel': 80}       # a guitar's arpeggio dipping to its low string
        bass = {'on': 2.5, 'off': 2.7, 'midi': 29, 'vel': 80}      # an F1 taken where no tune was heard
        kept = transcribe.drop_dips(sorted(tune + [dip, bass], key=lambda n: n['on']))
        self.assertEqual([n['midi'] for n in kept], [n['midi'] for n in tune])

    def test_melody_gaps(self):
        mel = [{'on': 0.0, 'off': 0.5, 'midi': 72}, {'on': 0.6, 'off': 1.0, 'midi': 74}, {'on': 3.0, 'off': 3.5, 'midi': 76}]
        self.assertEqual(transcribe.melody_gaps(mel, 6.0), [(1.0, 3.0), (3.5, 6.0)])
        self.assertEqual(transcribe.melody_gaps(mel, 4.0), [(1.0, 3.0)])

    def test_without_yourmt3_song_mode_is_unchanged(self):
        a = type('A', (), {'mt3_python': '', 'mt3_dir': ''})
        self.assertFalse(transcribe.mt3_ready(a))


def _tune_audio(sr, tune, t0=0.0, length=None, chord=(48, 52, 55)):
    """A lead line (harmonic tones, 0.25 s a note from t0) over a quieter sustained low chord and a little noise."""
    import numpy as np
    length = length or t0 + 0.25 * len(tune) + 0.5
    t = np.arange(int(length * sr)) / sr
    y = 0.003 * np.random.RandomState(1).randn(len(t))
    for m in chord:
        f = 440 * 2 ** ((m - 69) / 12)
        y += 0.08 * sum(np.sin(2 * np.pi * f * h * t) / h for h in (1, 2, 3))
    for i, m in enumerate(tune):
        a, b = int((t0 + 0.25 * i) * sr), int((t0 + 0.25 * i + 0.23) * sr)
        k = t[a:b] - t[a]
        f = 440 * 2 ** ((m - 69) / 12)
        y[a:b] += 0.3 * sum(np.sin(2 * np.pi * f * h * k) * 0.7 ** h for h in range(1, 7)) * np.minimum(1, k / 0.01)
    return (y / np.abs(y).max() * 0.9).astype(np.float32)


@unittest.skipUnless(HAVE_LIBROSA, 'numpy, scipy and librosa are not installed')
class MelodyContourTest(unittest.TestCase):
    """melody_contour.py: the predominant line of a mix, and the song mode's gaps filled from it."""
    TUNE = [76, 78, 79, 81, 83, 81, 79, 78, 76, 74, 76, 78]

    def test_the_lead_over_a_chord_is_the_contour(self):
        import melody_contour
        sr = 22050
        times, midi = melody_contour.contour(_tune_audio(sr, self.TUNE), sr)
        got = [n['midi'] for n in melody_contour.notes(times, midi)]
        self.assertEqual(got, self.TUNE)

    def test_a_gap_in_the_melody_is_filled_from_the_audio(self):
        import soundfile as sf
        sr = 22050
        with tempfile.TemporaryDirectory() as d:
            wav = os.path.join(d, 'mix.wav')
            sf.write(wav, _tune_audio(sr, self.TUNE, t0=2.0, length=6.0), sr)
            heard = [{'on': 0.25 * i, 'off': 0.25 * i + 0.2, 'midi': 76, 'vel': 80} for i in range(6)]   # the model's tune stops at 1.5 s
            filled = transcribe.fill_melody_gaps(heard, wav, 6.0)
        self.assertEqual([n['midi'] for n in filled], self.TUNE)
        self.assertTrue(all(2.0 - 0.05 <= n['on'] < 5.1 for n in filled))


if __name__ == '__main__':
    unittest.main()
