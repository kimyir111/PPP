import json
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import golden_benchmark as benchmark


ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SAMPLE = os.path.join(ROOT, 'samples', 'prelude-fragment.musicxml')


class GoldenBenchmarkTest(unittest.TestCase):
    def _write_prediction(self, directory, score, scale=0.5):
        payload = {
            'notes': [
                {'midi': note['midi'], 'on': note['on'] * scale, 'off': note['off'] * scale}
                for note in score['notes']
            ],
            'beats': [round(i * scale, 6) for i in range(80)],
            'engine': 'test-fixture',
        }
        path = os.path.join(directory, 'prediction.json')
        with open(path, 'w', encoding='utf-8') as handle:
            json.dump(payload, handle)
        return path

    def test_musicxml_and_helper_json_can_share_prediction_beats(self):
        score = benchmark.load_musicxml(SAMPLE)
        with tempfile.TemporaryDirectory() as directory:
            prediction = self._write_prediction(directory, score)
            result = benchmark.run_case({
                'name': 'beat-aligned-fixture',
                'reference': SAMPLE,
                'prediction': prediction,
                'alignment': 'prediction-beats',
                'minF1': 1.0,
                'maxOnsetErrorMs': 0.01,
            }, directory)
        self.assertEqual(result['metrics']['f1'], 1.0)
        self.assertEqual(result['metrics']['offset_f1'], 1.0)
        self.assertEqual(result['metrics']['mean_onset_error_ms'], 0.0)

    def test_musicxml_and_helper_json_can_use_constant_tempo(self):
        score = benchmark.load_musicxml(SAMPLE)
        with tempfile.TemporaryDirectory() as directory:
            prediction = self._write_prediction(directory, score)
            result = benchmark.run_case({
                'name': 'tempo-aligned-fixture',
                'reference': SAMPLE,
                'prediction': prediction,
                'alignment': 'tempo',
                'tempo': 120,
                'minF1': 1.0,
            }, directory)
        self.assertEqual(result['metrics']['f1'], 1.0)

    def test_bad_beat_alignment_is_reported(self):
        score = benchmark.load_musicxml(SAMPLE)
        with tempfile.TemporaryDirectory() as directory:
            prediction = self._write_prediction(directory, score)
            with open(prediction, 'r', encoding='utf-8') as handle:
                payload = json.load(handle)
            payload.pop('beats', None)
            with open(prediction, 'w', encoding='utf-8') as handle:
                json.dump(payload, handle)
            with self.assertRaises(ValueError):
                benchmark.run_case({
                    'reference': SAMPLE,
                    'prediction': prediction,
                    'alignment': 'prediction-beats',
                    'beatOffset': 0,
                    'minF1': 1.0,
                }, directory)


if __name__ == '__main__':
    unittest.main()
