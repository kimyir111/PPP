import unittest

from pppbench import align
from unit.helpers import canon, measure, note


class TimedAlignment(unittest.TestCase):
    def test_pitch_is_matched_separately(self):
        ref = [(0, 60, 1.0), (1, 64, 1.0)]
        pred = [(10, 64, 1.02), (11, 60, 0.99)]
        pairs = align.align_timed(ref, pred)
        self.assertEqual([(r, p) for r, p, _ in pairs], [(0, 11), (1, 10)])
        self.assertAlmostEqual(pairs[0][2], -0.01)

    def test_outside_the_window_is_not_a_match(self):
        self.assertEqual(align.align_timed([(0, 60, 1.0)], [(5, 60, 1.5)], window_s=0.30), [])
        self.assertEqual(len(align.align_timed([(0, 60, 1.0)], [(5, 60, 1.25)], window_s=0.30)), 1)
        self.assertEqual(len(align.align_timed([(0, 60, 1.0)], [(5, 60, 1.5)], window_s=0.50)), 1)

    def test_repeated_notes_stay_in_order(self):
        # a fast repeated G: one prediction missing in the middle
        ref = [(i, 67, 1.0 + 0.1 * i) for i in range(5)]
        pred = [(10, 67, 1.0), (11, 67, 1.1), (13, 67, 1.3), (14, 67, 1.4)]
        pairs = align.align_timed(ref, pred)
        self.assertEqual([(r, p) for r, p, _ in pairs], [(0, 10), (1, 11), (3, 13), (4, 14)])

    def test_dp_keeps_two_matches_where_greedy_keeps_one(self):
        # greedy nearest-first pairs 0.2 with 0.12 and strands both others; the DP scores
        # (0.3 - 0.12) + (0.3 - 0.2) = 0.28 > 0.3 - 0.08 = 0.22 and keeps two
        ref = [(0, 60, 0.0), (1, 60, 0.2)]
        pred = [(10, 60, 0.12), (11, 60, 0.40)]
        pairs = align.align_timed(ref, pred)
        self.assertEqual([(r, p) for r, p, _ in pairs], [(0, 10), (1, 11)])

    def test_tie_prefers_diagonal(self):
        # equal score either way: a single ref note between two equally distant predictions
        ref = [(0, 60, 1.0)]
        pred = [(10, 60, 0.75), (11, 60, 1.25)]   # binary-exact, so the two scores really tie
        pairs = align.align_timed(ref, pred)
        self.assertEqual(len(pairs), 1)
        self.assertEqual(pairs[0][:2], (0, 11))  # the backtrace takes the diagonal at the last column


class SymbolicAlignment(unittest.TestCase):
    def test_a_missing_bar_is_skipped(self):
        bars = [measure(note(s, 4, 4), number=i + 1) for i, s in enumerate("CDEFG")]
        ref = canon(bars, staves=1)
        pred = canon([b for i, b in enumerate(bars) if i != 2], staves=1)
        sa = align.align_symbolic(ref, pred)
        self.assertEqual([(r, p) for r, p, _ in sa.measure_pairs], [(0, 0), (1, 1), (3, 2), (4, 3)])
        self.assertEqual(len(sa.pairs), 4)

    def test_wrong_pitch_is_not_paired(self):
        ref = canon([measure(note("C", 4, 1) + note("E", 4, 1) + note("G", 4, 2))], staves=1)
        pred = canon([measure(note("C", 4, 1) + note("F", 4, 1) + note("G", 4, 2))], staves=1)
        sa = align.align_symbolic(ref, pred)
        self.assertEqual(len(sa.pairs), 2)


if __name__ == "__main__":
    unittest.main()
