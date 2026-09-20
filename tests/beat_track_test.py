import unittest

from beat_track import beat_quality


class BeatTrackQualityTest(unittest.TestCase):
    def test_stable_grid_is_confident(self):
        confidence, cv, median = beat_quality([0, 0.5, 1.0, 1.5, 2.0])
        self.assertGreaterEqual(confidence, 0.99)
        self.assertAlmostEqual(cv, 0.0)
        self.assertAlmostEqual(median, 0.5)

    def test_subdivision_and_missed_pulse_are_penalised(self):
        confidence, cv, median = beat_quality([0, 0.5, 0.75, 1.25, 1.75, 2.25])
        self.assertLess(confidence, 0.5)
        self.assertGreaterEqual(cv, 0.2)
        self.assertAlmostEqual(median, 0.5)

    def test_short_sequence_is_not_certified(self):
        self.assertEqual(beat_quality([0, 0.5, 1.0]), (0.0, 0.0, None))


if __name__ == '__main__':
    unittest.main()
