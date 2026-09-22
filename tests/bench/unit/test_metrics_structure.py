import unittest

from pppbench.metrics import structure as S
from unit.helpers import canon, measure, note


class TimeSignatureScore(unittest.TestCase):
    def test_four_grades(self):
        self.assertEqual(S.time_sig_score((3, 4), (3, 4)), 1.0)
        self.assertEqual(S.time_sig_score((4, 4), (2, 4)), 0.5)    # regrouped quarters
        self.assertEqual(S.time_sig_score((3, 4), (4, 4)), 0.0)    # not a regrouping (§17 m4)
        self.assertEqual(S.time_sig_score((2, 4), (3, 4)), 0.0)
        self.assertEqual(S.time_sig_score((6, 8), (3, 8)), 0.5)    # regrouped dotted quarters
        self.assertEqual(S.time_sig_score((12, 8), (6, 8)), 0.5)
        self.assertEqual(S.time_sig_score((6, 8), (3, 4)), 0.25)   # same bar, other beat
        self.assertEqual(S.time_sig_score((4, 4), (2, 2)), 0.25)
        self.assertEqual(S.time_sig_score((12, 8), (6, 4)), 0.25)
        self.assertEqual(S.time_sig_score((6, 8), (2, 4)), 0.0)
        self.assertEqual(S.time_sig_score((3, 4), (3, 8)), 0.0)


class KeyMirex(unittest.TestCase):
    def test_table(self):
        self.assertEqual(S.key_mirex(0, "major", 0, "major"), 1.0)
        self.assertEqual(S.key_mirex(1, "major", 0, "major"), 0.5)     # G for C: a fifth up
        self.assertEqual(S.key_mirex(-1, "major", 0, "major"), 0.5)    # F for C: a fifth down
        self.assertEqual(S.key_mirex(0, "minor", 0, "major"), 0.3)     # A minor for C: relative
        self.assertEqual(S.key_mirex(-3, "minor", 0, "major"), 0.2)    # C minor for C: parallel
        self.assertEqual(S.key_mirex(2, "major", 0, "major"), 0.0)
        self.assertEqual(S.key_mirex(0, "major", 0, "minor"), 0.3)     # C for A minor
        self.assertIsNone(S.key_mirex(0, "major", 0, None))
        self.assertEqual(S.tonic_pc(-5, "major"), 1)   # D-flat
        self.assertEqual(S.tonic_pc(4, "major"), 4)    # E
        self.assertEqual(S.tonic_pc(0, "minor"), 9)    # A


class Tempo(unittest.TestCase):
    def ctx(self, sound, printed, qpm=72.0):
        class P:  # a prediction with only what the tempo metrics read
            pass
        p = P()
        p.sound_qpm, p.printed_qpm = sound, printed
        p.effective_qpm = sound if sound is not None else printed

        class M:
            fifths, mode, implicit, app_number, time = 0, "major", False, 1, (3, 4)
        p.measures = [M()]
        p.primary_time = lambda: (3, 4)
        p.played = lambda: []
        p.notes, p.marks, p.app_qpm = [], [], int((p.effective_qpm or 84) + 0.5)
        p.app_bar_starts = lambda: {1: 0}
        p.app_play_order = lambda: [0]
        ref = canon([measure(note("C", 5, 3), number=1)], time=(3, 4), staves=1)
        return {"pred": p, "ref": ref, "expected": {"time": [3, 4], "key": {"fifths": 0, "mode": "major"}, "measures": 1,
                                                    "qpm": qpm},
                "kind": "T", "stats": {"beatsPerBar": 3, "beatType": 4}, "perf": None}

    def test_the_6_8_sound_tempo_mismatch_is_visible(self):
        # §14 I1: <metronome> dotted quarter = 48 (72 qpm) with <sound tempo="48">
        m = S.compute(self.ctx(sound=48.0, printed=72.0))
        self.assertEqual(m["struct.tempo.ok_effective"], 0.0)
        self.assertEqual(m["struct.tempo.ok_written"], 1.0)
        self.assertEqual(m["struct.tempo.mark_consistent"], 0.0)
        self.assertAlmostEqual(m["struct.tempo.ratio_effective"], 48 / 72)
        self.assertEqual(m["struct.tempo.metrical_ok"], 1.0)

    def test_double_tempo_is_metrical_but_not_ok(self):
        m = S.compute(self.ctx(sound=144.0, printed=144.0))
        self.assertEqual(m["struct.tempo.ok_effective"], 0.0)
        self.assertEqual(m["struct.tempo.metrical_ok"], 1.0)
        self.assertEqual(m["struct.tempo.mark_consistent"], 1.0)
        m = S.compute(self.ctx(sound=100.0, printed=100.0))
        self.assertEqual(m["struct.tempo.metrical_ok"], 0.0)
        m = S.compute(self.ctx(sound=74.0, printed=None))
        self.assertEqual(m["struct.tempo.ok_effective"], 1.0)
        # the reference has a tempo, so a missing printed mark is missing output, not "n/a" (§17 B1)
        self.assertEqual(m["struct.tempo.ok_written"], 0.0)
        self.assertEqual(m["struct.tempo.mark_consistent"], 0.0)

    def test_missing_tempo_is_zero_not_null(self):
        # §17 B1: a score that writes no tempo plays at the app's default 84 qpm; that is a failure
        m = S.compute(self.ctx(sound=None, printed=None))
        for k in ("struct.tempo.present", "struct.tempo.ok_effective", "struct.tempo.ok_written",
                  "struct.tempo.mark_consistent", "struct.tempo.metrical_ok"):
            self.assertEqual(m[k], 0.0, k)
        # only a reference without any tempo makes the tempo metrics not applicable
        c = self.ctx(sound=None, printed=None)
        c["expected"]["qpm"] = None
        self.assertIsNone(S.compute(c)["struct.tempo.ok_effective"])


class Downbeats(unittest.TestCase):
    def test_f1_with_window_and_tolerance(self):
        ref = [1.0, 3.0, 5.0, 7.0]
        self.assertEqual(S.downbeat_f1(ref, ref, 0.9, 7.1), 1.0)
        # one late by 60 ms (inside ±70 ms), one late by 90 ms (outside)
        self.assertAlmostEqual(S.downbeat_f1([1.06, 3.09, 5.0, 7.0], ref, 0.9, 7.1), 0.75)
        # a leading bar of rests before the first note is out of the window and ignored
        self.assertEqual(S.downbeat_f1([-1.0, 1.0, 3.0, 5.0, 7.0], ref, 0.9, 7.1), 1.0)
        self.assertIsNone(S.downbeat_f1([], [], 0.9, 7.1))


if __name__ == "__main__":
    unittest.main()
