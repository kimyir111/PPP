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


if __name__ == '__main__':
    unittest.main()
