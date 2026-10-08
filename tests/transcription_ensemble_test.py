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


if __name__ == '__main__':
    unittest.main()
