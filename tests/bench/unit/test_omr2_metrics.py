"""omr-live-2: the omr.* metrics (tests/omr/omrbench/metrics.py), each proven by a planted defect (A0).

A metric that cannot tell a damaged read from a good one measures nothing: each test takes a truth, breaks ONE aspect of a copy of it
(a dropped bar, a wrong staff, a halved duration, a missed flag ...), and checks that the metric of that aspect falls and the unrelated
ones do not move. Standard library only; runs in the gate."""

import copy
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import omr2_synth as S  # noqa: E402
from omrbench import metrics as M  # noqa: E402
from omrbench import xmlscore as X  # noqa: E402

BARS = S.BARS


def read(bars, **kw):
    return X.parse_score(S.piano(bars, **kw))


def judge(out_bars, truth_bars=BARS, **kw):
    out_kw = {k: v for k, v in kw.items() if k in ("parts", "time", "fifths", "divisions")}
    jk = {k: v for k, v in kw.items() if k not in out_kw}
    return M.judge(read(truth_bars), read(out_bars, **out_kw), **jk)


def mut(bars, i, side, notes):
    """A copy of ``bars`` with the right (0) or left (1) hand of bar i replaced."""
    b = [list(map(list, x)) for x in bars]
    b[i][side] = notes
    return [(rh, lh) for rh, lh in b]


class SelfTest(unittest.TestCase):
    def test_the_truth_against_itself_is_perfect(self):
        r = judge(BARS)
        m = r.metrics
        self.assertTrue(r.ok)
        for k in ("omr.note_f1", "omr.note_precision", "omr.note_recall", "omr.played_f1", "omr.duration_acc", "omr.staff_acc",
                  "omr.bar_exact", "omr.measure_alignment_rate", "omr.bar_count_exact", "omr.parts_ok", "omr.time_ok", "omr.key_ok"):
            self.assertEqual(m[k], 1.0, k)
        self.assertEqual((m["omr.parts_fragmented"], m["omr.div0"]), (0.0, 0.0))
        self.assertEqual(m["omr.beam_kept"], 1.0)
        self.assertEqual((r.counts["wrong"], r.counts["exact"], r.counts["truth_bars"]), (0, 6, 6))
        self.assertIsNone(m["omr.flag.app.recall"], "nothing is wrong, so there is nothing to recall")
        self.assertIsNone(m["omr.flag.app.precision"], "and nothing was flagged")
        self.assertEqual(r.structure, "2")

    def test_the_metrics_do_not_depend_on_how_the_notes_are_written_down(self):
        # the same music with a different divisions value
        self.assertEqual(judge(BARS, divisions=8).metrics["omr.bar_exact"], 1.0)


class PlantedDefects(unittest.TestCase):
    base = None

    @classmethod
    def setUpClass(cls):
        cls.base = judge(BARS).metrics

    def test_a_dropped_bar(self):
        r = judge(BARS[:2] + BARS[3:])
        m = r.metrics
        self.assertEqual(m["omr.bar_count_exact"], 0.0)
        self.assertAlmostEqual(m["omr.measure_alignment_rate"], 5 / 6)
        self.assertAlmostEqual(m["omr.bar_exact"], 5 / 6)
        self.assertLess(m["omr.note_f1"], 1.0)
        self.assertLess(m["omr.note_recall"], 1.0)
        self.assertEqual(m["omr.note_precision"], 1.0, "what was read is right: only a bar is missing")
        self.assertEqual(r.counts["missed_bars"], 1)
        self.assertEqual(r.counts["wrong"], 0, "no output bar is wrong; the truth bar nothing matched is `missed`")
        self.assertEqual(m["omr.parts_ok"], 1.0)

    def test_an_extra_bar_is_wrong_and_the_rest_still_aligns(self):
        extra = (["D4:1", "F4:1", "A4:2"], ["D3:4"])
        r = judge(BARS[:3] + [extra] + BARS[3:])
        self.assertEqual(r.metrics["omr.bar_count_exact"], 0.0)
        self.assertEqual(r.metrics["omr.measure_alignment_rate"], 1.0)
        self.assertEqual(r.metrics["omr.bar_exact"], 1.0)
        self.assertEqual(r.counts["wrong"], 1)
        self.assertLess(r.metrics["omr.note_precision"], 1.0)

    def test_a_wrong_staff_moves_only_the_staff_accuracy(self):
        out = read(BARS)
        for b in out.bars:
            for n in b.notes:
                n.staff = 0
        r = M.judge(read(BARS), out)
        self.assertLess(r.metrics["omr.staff_acc"], 0.7)
        self.assertEqual(r.metrics["omr.note_f1"], 1.0)
        self.assertEqual(r.metrics["omr.bar_exact"], 1.0)

    def test_a_halved_duration_moves_the_duration_accuracy_and_the_exact_bar_not_the_note_f1(self):
        out = mut(BARS, 2, 1, ["G2:2"])                       # the left hand of bar 3 held half as long, same pitch and onset
        r = judge(out)
        self.assertEqual(r.metrics["omr.note_f1"], 1.0)
        self.assertLess(r.metrics["omr.duration_acc"], 1.0)
        self.assertAlmostEqual(r.metrics["omr.bar_exact"], 5 / 6)
        self.assertEqual(r.counts["wrong"], 1)

    def test_a_wrong_pitch_moves_the_note_f1_and_the_exact_bar(self):
        out = mut(BARS, 0, 0, ["C4:1", "F4:1", "G4:1", "E4:1"])
        r = judge(out)
        self.assertLess(r.metrics["omr.note_f1"], 1.0)
        self.assertAlmostEqual(r.metrics["omr.bar_exact"], 5 / 6)
        self.assertEqual(r.metrics["omr.duration_acc"], 1.0)
        self.assertEqual(r.metrics["omr.measure_alignment_rate"], 1.0)

    def test_a_missing_rest_moves_the_exact_bar_only(self):
        out = mut(BARS, 4, 0, [])                             # the rest bar of the right hand read as nothing
        r = judge(out)
        self.assertEqual(r.metrics["omr.note_f1"], 1.0)
        self.assertAlmostEqual(r.metrics["omr.bar_exact"], 5 / 6)

    def test_a_missed_note_lowers_the_recall_and_not_the_precision(self):
        out = mut(BARS, 3, 0, ["C5:1", "B4:1", "A4:1", "r:1"])
        m = judge(out).metrics
        self.assertLess(m["omr.note_recall"], 1.0)
        self.assertEqual(m["omr.note_precision"], 1.0)

    def test_fragmented_parts_move_the_part_metrics_and_the_played_f1_not_the_note_f1(self):
        r = judge(BARS, parts="split")                         # two parts of one staff each: issue 11
        m = r.metrics
        self.assertEqual(m["omr.parts_ok"], 0.0)
        self.assertEqual(m["omr.parts_fragmented"], 1.0)
        self.assertEqual(m["omr.note_f1"], 1.0, "every note was read")
        self.assertLess(m["omr.played_f1"], 0.75, "the app's hand rule plays only the LAST part")
        self.assertEqual(r.structure, "1x1")

    def test_the_hand_rule_takes_the_first_part_with_two_staves(self):
        parts = [X.PartInfo(6, 1), X.PartInfo(6, 2), X.PartInfo(6, 1)]
        self.assertEqual(M._app_hand_rule_part(parts), 1)
        self.assertEqual(M._app_hand_rule_part([X.PartInfo(6, 1), X.PartInfo(6, 1)]), 1)
        self.assertEqual(M._app_hand_rule_part([X.PartInfo(6, 1)]), 0)

    def test_a_misread_time_signature_and_key(self):
        m = judge(BARS, time=(6, 4), fifths=2).metrics
        self.assertEqual((m["omr.time_ok"], m["omr.key_ok"]), (0.0, 0.0))
        self.assertEqual(m["omr.note_f1"], 1.0)

    def test_divisions_zero_halves_every_value_as_the_app_reads_it(self):
        halves = [(["C4:2", "E4:2"], ["C3:4"]), (["G4:2", "C5:2"], ["G2:4"])]
        truth = read(halves)
        xml = S.piano(halves, divisions=0)
        as_read = M.judge(truth, X.parse_score(xml))
        self.assertEqual(as_read.metrics["omr.div0"], 1.0)
        self.assertEqual(as_read.metrics["omr.bar_exact"], 0.0, "every half note became a quarter")
        self.assertLess(as_read.metrics["omr.note_f1"], 1.0)
        fixed = M.judge(truth, X.parse_score(xml, divisions="repair"))
        self.assertEqual(fixed.metrics["omr.bar_exact"], 1.0)
        self.assertEqual(fixed.metrics["omr.note_f1"], 1.0)
        self.assertEqual(fixed.metrics["omr.div0"], 1.0, "the quirk is still reported")

    def test_beams_are_kept_or_lost(self):
        out = read(BARS)
        for n in out.bars[2].notes:
            n.beam = False
        self.assertEqual(M.judge(read(BARS), out).metrics["omr.beam_kept"], 0.0)

    def test_nothing_read_is_every_rate_zero_and_counted(self):
        r = M.judge(read(BARS), None)
        self.assertFalse(r.ok)
        for k in ("omr.note_f1", "omr.played_f1", "omr.bar_exact", "omr.measure_alignment_rate", "omr.parts_ok", "omr.staff_acc"):
            self.assertEqual(r.metrics[k], 0.0, k)
        self.assertEqual(r.counts["missed_bars"], 6)
        self.assertEqual(M.judge(read(BARS), X.Score(parts=[], bars=[])).ok, False)


class Flags(unittest.TestCase):
    def test_the_app_rule_flags_empty_overfull_and_under_half_bars(self):
        s = read([(["C4:4"], ["C3:4"]), (["C4:1"], ["C3:1"]), ([], []), (["C4:4", "D4:1"], ["C3:4"])])
        self.assertEqual([M.suspect_app(b) for b in s.bars], [False, True, True, True])

    def test_the_stricter_rule_also_flags_a_voice_that_does_not_fill_the_bar(self):
        s = read([(["C4:4"], ["C3:2"]), (["C4:4"], ["C3:4"])])
        self.assertEqual([M.suspect_app(b) for b in s.bars], [False, False])
        self.assertEqual([M.suspect_voice(b) for b in s.bars], [True, False])

    def test_flag_recall_and_precision_are_judged_against_the_wrong_bars(self):
        out = mut(BARS, 2, 1, ["G2:2"])                         # bar 3 wrong, and its voice is short
        wrong_bar = 2
        m = judge(out).metrics
        self.assertEqual(m["omr.flag.voice.recall"], 1.0)
        self.assertEqual(m["omr.flag.voice.precision"], 1.0)
        self.assertEqual(m["omr.flag.app.recall"], 0.0, "the app's rule does not see a short left hand")
        self.assertIsNone(m["omr.flag.app.precision"], "and flagged nothing")
        # a flag source from outside (the app's report, G12-3's flags): a hit, a miss, a false alarm
        hit = judge(out, external_flags={"x": [wrong_bar]}).metrics
        self.assertEqual((hit["omr.flag.x.recall"], hit["omr.flag.x.precision"]), (1.0, 1.0))
        miss = judge(out, external_flags={"x": []}).metrics
        self.assertEqual(miss["omr.flag.x.recall"], 0.0)
        noisy = judge(out, external_flags={"x": [wrong_bar, 0, 1, 4]}).metrics
        self.assertEqual(noisy["omr.flag.x.recall"], 1.0)
        self.assertAlmostEqual(noisy["omr.flag.x.precision"], 0.25)
        outside = judge(out, external_flags={"x": [99, -1]}).metrics
        self.assertEqual(outside["omr.flag.x.recall"], 0.0, "bars that do not exist are not flags")

    def test_a_planted_miss_is_seen_through_the_aggregate(self):
        good = judge(mut(BARS, 2, 1, ["G2:2"]), external_flags={"x": [2]})
        missed = judge(mut(BARS, 2, 1, ["G2:2"]), external_flags={"x": []})
        self.assertEqual(M.aggregate([good])["omr.flag.x.recall"], 1.0)
        self.assertEqual(M.aggregate([missed])["omr.flag.x.recall"], 0.0)
        both = M.aggregate([good, missed])
        self.assertEqual(both["omr.flag.x.recall"], 0.5)
        self.assertEqual(both["omr.flag.x.flagged"], 1)

    def test_the_stricter_rule_is_quiet_on_a_clean_truth(self):
        m = judge(BARS).metrics
        self.assertIsNone(m["omr.flag.voice.precision"])
        self.assertEqual(sum(1 for b in read(BARS).bars if M.suspect_voice(b)), 0)


class Aggregates(unittest.TestCase):
    def test_bar_exact_is_pooled_over_bars_and_its_macro_is_kept(self):
        a = M.judge(read(BARS * 2), read(BARS * 2))             # 12 bars, all exact
        b = M.judge(read(BARS[:2]), read([(["D4:4"], ["D3:4"]), (["E4:4"], ["E3:4"])]))   # 2 bars, none exact
        agg = M.aggregate([a, b])
        self.assertEqual(agg["cases"], 2)
        self.assertAlmostEqual(agg["omr.bar_exact"], 12 / 14, places=5)
        self.assertAlmostEqual(agg["omr.bar_exact.macro"], 0.5)
        self.assertEqual((agg["exact_bars"], agg["truth_bars"], agg["wrong_bars"]), (12, 14, 2))

    def test_a_failed_case_counts_as_zero_in_the_means(self):
        ok = M.judge(read(BARS), read(BARS))
        gone = M.judge(read(BARS), None)
        agg = M.aggregate([ok, gone])
        self.assertEqual(agg["failed"], 1)
        self.assertEqual(agg["omr.note_f1"], 0.5)
        self.assertEqual(agg["omr.bar_exact"], 0.5)

    def test_structures_are_counted(self):
        agg = M.aggregate([judge(BARS), judge(BARS), judge(BARS, parts="split")])
        self.assertEqual(agg["structures"], {"2": 2, "1x1": 1})
        self.assertAlmostEqual(agg["omr.parts_ok"], 2 / 3, places=5)
        self.assertAlmostEqual(agg["omr.parts_fragmented"], 1 / 3, places=5)

    def test_the_micro_f1_weights_by_notes(self):
        big = M.judge(read(BARS * 4), read(BARS * 4))
        small = M.judge(read(BARS[:1]), read([(["D4:4"], ["D3:4"])]))
        agg = M.aggregate([big, small])
        self.assertLess(abs(agg["omr.note_f1"] - (1.0 + small.metrics["omr.note_f1"]) / 2), 1e-9)
        self.assertGreater(agg["omr.note_f1.micro"], agg["omr.note_f1"])


class Alignment(unittest.TestCase):
    def test_an_inserted_bar_does_not_shift_the_pairs(self):
        t = read(BARS).bars
        o = read(BARS[:3] + [(["D4:4"], ["D3:4"])] + BARS[3:]).bars
        pairs = [(i, j) for i, j, s in M.align(t, o) if s >= M.ALIGN_MIN]
        self.assertEqual(pairs, [(0, 0), (1, 1), (2, 2), (3, 4), (4, 5), (5, 6)])

    def test_empty_bars_pair_with_empty_bars(self):
        t = read([([], []), (["C4:4"], ["C3:4"])]).bars
        self.assertEqual([(i, j) for i, j, _ in M.align(t, copy.deepcopy(t))], [(0, 0), (1, 1)])


if __name__ == "__main__":
    unittest.main()
