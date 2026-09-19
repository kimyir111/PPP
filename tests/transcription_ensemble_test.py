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
