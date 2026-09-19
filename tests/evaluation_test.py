#!/usr/bin/env python3
import os
import sys
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from evaluate_transcription import evaluate  # noqa: E402


class EvaluationTests(unittest.TestCase):
    def test_note_and_offset_metrics(self):
        reference = {"notes": [
            {"midi": 60, "on": 0.0, "off": 0.6},
            {"midi": 62, "on": 1.0, "off": 1.5},
            {"midi": 64, "on": 2.0, "off": 2.4},
        ], "pedals": [{"on": 0.0, "off": 2.0}]}
        prediction = {"notes": [
            {"midi": 60, "on": 0.02, "off": 0.58},
            {"midi": 62, "on": 1.10, "off": 1.5},
            {"midi": 65, "on": 2.0, "off": 2.4},
        ], "pedals": [{"on": 0.5, "off": 2.5}]}
        result = evaluate(reference, prediction)
        self.assertEqual(result["matched_notes"], 1)
        self.assertAlmostEqual(result["f1"], 1 / 3, places=5)
        self.assertAlmostEqual(result["offset_f1"], 1 / 3, places=5)
        self.assertEqual(result["mean_onset_error_ms"], 20.0)
        self.assertAlmostEqual(result["pedal_iou"], 0.6, places=5)

    def test_empty_scores_are_well_defined(self):
        result = evaluate({"notes": []}, {"notes": []})
        self.assertEqual(result["f1"], 1.0)
        self.assertIsNone(result["mean_onset_error_ms"])


if __name__ == "__main__":
    unittest.main()
