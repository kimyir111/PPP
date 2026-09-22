import unittest
from fractions import Fraction

from pppbench.metrics import notation
from unit.helpers import canon, measure, note, rest


def ctx(ref, pred, pairs=None, kind="T"):
    if pairs is None:  # pair notes in order of (onset, midi)
        r = sorted(ref.played(), key=lambda s: (s.onset_q, s.midi))
        p = sorted(pred.played(), key=lambda s: (s.onset_q, s.midi))
        pairs = [(a.id, b.id, 0.0) for a, b in zip(r, p)]
    return {"ref": ref, "pred": pred, "pairs": pairs, "kind": kind, "skip_metrics": ()}


def melody(dur, n_bars=2, time=(4, 4)):
    steps = "CDEFGABC"
    per = int(time[0] * 4 // time[1] // dur) if dur >= 1 else int(time[0] * 4 / time[1] / dur)
    bars, k = [], 0
    for b in range(n_bars):
        rh = "".join(note(steps[(k + i) % 8], 5, dur * 2, typ=None) for i in range(per))
        k += per
        bars.append(measure(rh, number=b + 1))
    return bars


class NotationMetrics(unittest.TestCase):
    def test_identical_score_is_perfect(self):
        c = canon(melody(1), divisions=2)
        m = notation.compute(ctx(c, c))
        for k in ("notation.ioi.accuracy", "notation.onset_pos.accuracy", "notation.duration.accuracy",
                  "notation.spelling.accuracy"):
            self.assertEqual(m[k], 1.0, k)
        self.assertEqual(m["notation.ties.extra_per_100"], 0.0)
        self.assertEqual(m["notation.metrical_scale"], 1.0)
        self.assertIsNone(m["notation.tuplets.f1"])

    def test_double_tempo_notation_scales_by_half(self):
        # the same melody written with every value doubled (tempo read twice as fast)
        ref = canon([measure("".join(note(s, 5, 1) for s in "CDEF"), number=1),
                     measure("".join(note(s, 5, 1) for s in "GABC"), number=2)], divisions=1)
        pred = canon([measure(note("C", 5, 2) + note("D", 5, 2), number=1), measure(note("E", 5, 2) + note("F", 5, 2), number=2),
                      measure(note("G", 5, 2) + note("A", 5, 2), number=3), measure(note("B", 5, 2) + note("C", 5, 2), number=4)],
                     divisions=1)
        m = notation.compute(ctx(ref, pred))
        self.assertEqual(m["notation.metrical_scale"], 0.5)
        self.assertEqual(m["notation.ioi.accuracy"], 1.0)
        self.assertEqual(m["notation.ioi.accuracy_strict"], 0.0)
        self.assertEqual(m["notation.duration.accuracy"], 1.0)
        self.assertLess(m["notation.onset_pos.accuracy"], 0.5)

    def test_pickup_is_right_aligned(self):
        # reference: a one-beat pickup; prediction: a full bar of three rests then the note
        ref = canon([measure(note("G", 4, 1), number=0, implicit=True), measure(note("C", 5, 4), number=1)])
        pred = canon([measure(rest(3) + note("G", 4, 1), number=1), measure(note("C", 5, 4), number=2)])
        m = notation.compute(ctx(ref, pred))
        self.assertEqual(m["notation.onset_pos.accuracy"], 1.0)

    def test_a_one_bar_shift_is_absorbed_by_the_bar_offset(self):
        ref = canon([measure(note("C", 5, 4), number=1), measure(note("D", 5, 4), number=2)])
        pred = canon([measure(rest(4), number=1), measure(note("C", 5, 4), number=2), measure(note("D", 5, 4), number=3)])
        self.assertEqual(notation.compute(ctx(ref, pred))["notation.onset_pos.accuracy"], 1.0)

    def test_false_ties_and_durations(self):
        ref = canon([measure(note("C", 5, 3) + note("D", 5, 1), number=1)])
        pred = canon([measure(note("C", 5, 2, tie="start") + note("C", 5, 1, tie="stop") + note("D", 5, 1), number=1)])
        m = notation.compute(ctx(ref, pred))
        self.assertEqual(m["notation.ties.extra_per_100"], 50.0)   # 1 extra piece over 2 pairs
        self.assertEqual(m["notation.duration.accuracy"], 1.0)     # tied value still 3 beats
        short = canon([measure(note("C", 5, 2) + rest(1) + note("D", 5, 1), number=1)])
        self.assertEqual(notation.compute(ctx(ref, short))["notation.duration.accuracy"], 0.5)

    def test_hands_spelling_and_tuplets(self):
        ref = canon([measure(note("F", 5, 2, alter=1) + note("C", 5, 2), note("C", 3, 4, staff=2), number=1, rh_len=4)])
        pred = canon([measure(note("G", 5, 2, alter=-1) + note("C", 5, 2, staff=1),
                              note("C", 3, 4, staff=1, voice=2), number=1, rh_len=4)])
        m = notation.compute(ctx(ref, pred))
        self.assertAlmostEqual(m["notation.hand.accuracy"], 2 / 3)
        self.assertAlmostEqual(m["notation.spelling.accuracy"], 2 / 3)   # F# written as Gb
        tm = "<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>"
        tref = canon([measure("".join(note(s, 5, 2, extra=tm) for s in "CDE") + note("F", 5, 2) + note("G", 5, 4), number=1)],
                     divisions=3)
        tpred = canon([measure(note("C", 5, 1) + note("D", 5, 1) + note("E", 5, 2) + note("F", 5, 2) + note("G", 5, 2, extra=tm),
                               number=1)], divisions=2)
        m = notation.compute(ctx(tref, tpred))
        # C D E: tuplet only in the reference (3 FN); G: only in the prediction (1 FP); TP 0
        self.assertEqual(m["notation.tuplets.f1"], 0.0)
        m = notation.compute(ctx(tref, tref))
        self.assertEqual(m["notation.tuplets.f1"], 1.0)

    def test_skip_metrics(self):
        c = canon(melody(1), divisions=2)
        cx = ctx(c, c)
        cx["skip_metrics"] = ("notation.spelling.accuracy",)
        self.assertIsNone(notation.compute(cx)["notation.spelling.accuracy"])

    def test_single_staff_reference_has_no_hand_metric(self):
        c = canon([measure(note("C", 5, 4), number=1)], staves=1)
        self.assertIsNone(notation.compute(ctx(c, c))["notation.hand.accuracy"])

    def test_scale_snaps_only_near_a_metrical_ratio(self):
        self.assertIsNone(notation.metrical_scale([(Fraction(1), Fraction(1))] * 2))
        self.assertEqual(notation.metrical_scale([(Fraction(1), Fraction(3))] * 3), Fraction(1, 3))
        self.assertEqual(notation.metrical_scale([(Fraction(5), Fraction(4))] * 3), 1)  # 1.25 is no ratio


if __name__ == "__main__":
    unittest.main()
