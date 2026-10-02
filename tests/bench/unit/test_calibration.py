"""The calibrated humanizer reproduces the real transcription's statistics (G10a-0, docs/GOALS/G10 section 7.3)."""

import os
import re
import unittest

from pppbench import calibration, corpus, humanize, util

TARGET = util.load_json(os.path.join(humanize.CAL_DIR, humanize.COVER_FILE))


class CoverReproducesTheRealStatistics(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.flats = calibration.humanize_pieces("cover", calibration.CALIBRATION_REFERENCES)
        cls.got = calibration.extract(cls.flats, 0.032)
        cls.rows = calibration.check(cls.got, TARGET)

    def test_twenty_fixed_references(self):
        self.assertEqual(len(calibration.CALIBRATION_REFERENCES), 20)
        self.assertEqual(len(set(calibration.CALIBRATION_REFERENCES)), 20)
        by = corpus.by_id(corpus.load_corpus())
        for rid in calibration.CALIBRATION_REFERENCES:
            self.assertIn(rid, by)
            self.assertFalse(by[rid].holdout, rid)                      # never a hold-out reference
        self.assertEqual(self.got["pieces"], 20)

    def test_every_band_holds(self):
        bad = [r for r in self.rows if not r["ok"]]
        self.assertFalse(bad, "\n".join(f"{r['stat']}: target {r['target']} got {r['got']} (band {r['band']:.3f})" for r in bad))

    def test_the_statistics_the_design_names_are_all_checked(self):
        stats = {r["stat"] for r in self.rows}
        for needed in ("releasesFreeByHand.RH.ratioMedian", "releasesFreeByHand.LH.ratioP90", "releasesFreeByHand.RH.releasedBeforeNextOnset",
                       "releasesFreeByHand.RH.gapMsMedian", "chords.spreadOneFrame", "onsetResidualVsWrittenMs.sd", "velocity.mean",
                       "velocity.sd", "tempo.barDurCV", "resolution.onsetsOnFrames"):
            self.assertIn(needed, stats)

    def test_the_real_overlap_is_reproduced_on_all_notes_too_when_the_pieces_allow_it(self):
        """The design's headline (E5/E7): 70 % of the notes of a real transcription overlap the next onset of their
        hand. On the calibration pieces the humanized share is within 15 points (re-strikes of the same pitch cut
        some notes short: the all-notes share is lower than the free-notes one)."""
        for h in ("RH", "LH"):
            self.assertGreater(self.got["releasesByHand"][h]["overlapsNextOnset"], 0.5, h)
            self.assertLess(abs(self.got["releasesByHand"][h]["overlapsNextOnset"] - TARGET["releasesByHand"][h]["overlapsNextOnset"]), 0.2, h)

    def test_chords_never_spread_more_than_one_frame(self):
        self.assertEqual(self.got["chords"]["spreadMoreThanOneFrame"], 0)

    def test_the_old_synthetic_performer_gets_the_sign_of_the_release_wrong(self):
        """E7: G0's `human` releases 20-80 ms early and never past the next onset; the calibrated one does."""
        old = calibration.extract(calibration.humanize_pieces("human", calibration.CALIBRATION_REFERENCES), 0.001)
        self.assertLess(old["releasesByHand"]["RH"]["overlapsNextOnset"], 0.05)
        self.assertGreater(self.got["releasesByHand"]["RH"]["overlapsNextOnset"], 0.4)

    def test_deterministic(self):
        again = calibration.extract(calibration.humanize_pieces("cover", calibration.CALIBRATION_REFERENCES[:3]), 0.032)
        first = calibration.extract(calibration.humanize_pieces("cover", calibration.CALIBRATION_REFERENCES[:3]), 0.032)
        self.assertEqual(again, first)


class DisjointPiecesAreReported(unittest.TestCase):
    """Not an acceptance band: how the bands fare on pieces the calibration did not use (the fit is to one cover)."""

    def test_the_cover_family_keeps_its_clock_and_overlap_on_other_pieces(self):
        others = [r for r in ("hymns/amazing-grace", "method/beyer/008", "method/czerny849/001", "method/sonatina/003", "hymns/silent-night",
                              "method/burgmuller25/013") if r not in calibration.CALIBRATION_REFERENCES]
        got = calibration.extract(calibration.humanize_pieces("cover", others), 0.032)
        self.assertEqual((got["resolution"]["onsetsOnFrames"], got["resolution"]["offsetsOnFrames"]), (1, 1))
        self.assertEqual(got["chords"]["spreadMoreThanOneFrame"], 0)
        self.assertLess(abs(got["onsetResidualVsWrittenMs"]["sd"] - 28.0), 8.0)
        self.assertGreater(got["releasesByHand"]["RH"]["overlapsNextOnset"], 0.4)


class GeneratorRules(unittest.TestCase):
    def test_no_libm_and_no_random_in_the_humanizer(self):
        for module in (humanize,):
            src = util.read_text(module.__file__)
            code = "\n".join(l for l in src.splitlines() if not l.strip().startswith("#"))
            code = re.sub(r'"""[\s\S]*?"""', "", code)
            for bad in ("math.", "import random", "random.", "import math", "numpy"):
                self.assertNotIn(bad, code, (module.__name__, bad))

    def test_inverse_cdf_is_piecewise_linear_through_the_knots(self):
        table = [float(i) for i in range(21)]                      # the identity: quantile p is 20 p
        self.assertEqual(humanize.inv_cdf(table, 0.0), 0.0)
        self.assertAlmostEqual(humanize.inv_cdf(table, 0.5), 10.0)
        self.assertAlmostEqual(humanize.inv_cdf(table, 0.975), 19.5)
        self.assertAlmostEqual(humanize.inv_cdf([0] * 10 + [10] * 11, 0.45), 0.0)
        self.assertAlmostEqual(humanize.inv_cdf([0] * 10 + [10] * 11, 0.475), 5.0)

    def test_normal_draws_have_unit_variance(self):
        rng = util.Lcg(12345)
        xs = [humanize.norm(rng) for _ in range(20000)]
        mean = sum(xs) / len(xs)
        var = sum((x - mean) ** 2 for x in xs) / len(xs)
        self.assertLess(abs(mean), 0.03)
        self.assertLess(abs(var - 1.0), 0.05)


if __name__ == "__main__":
    unittest.main()
