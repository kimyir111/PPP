"""The recording metrics (G10a-0, pppbench/metrics/rec.py): planted fixtures, one per metric."""

import json
import os
import unittest
from fractions import Fraction

from pppbench import corpus, recrun, runner, suite as suite_mod, util
from pppbench.metrics import rec
from unit.helpers import canon, measure, note, rest

OUT = os.path.join(util.bench_root(), "out", "rec-unit")
TRI = "<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>"


def bar(rh, lh=None, number=1, rh_len=4, lh_len=4):
    """A 4/4 bar, divisions 1 (a quarter is 1), right hand ``rh``, left hand ``lh`` (default: a whole note)."""
    return measure(rh, lh if lh is not None else note("C", 3, lh_len, staff=2), number=number, rh_len=rh_len)


def score(*bars, divisions=1):
    return canon(list(bars), divisions=divisions)


def four(*pitches, durs=(1, 1, 1, 1)):
    return "".join(note(p, 4, d) for p, d in zip(pitches, durs))


class RestMetrics(unittest.TestCase):
    def setUp(self):
        self.ref = score(bar(note("C", 4, 1) + rest(1) + note("D", 4, 1) + note("E", 4, 1)))

    def test_the_same_score_is_perfect(self):
        got = rec.rest_metrics(self.ref, self.ref, 0, Fraction(0))
        self.assertEqual((got["rec.rest.precision"], got["rec.rest.recall"], got["rec.rest.false_per_100_bars"]), (1.0, 1.0, 0.0))

    def test_a_missing_rest_costs_recall_not_precision(self):
        pred = score(bar(note("C", 4, 2) + note("D", 4, 1) + note("E", 4, 1)))
        got = rec.rest_metrics(self.ref, pred, 0, Fraction(0))
        self.assertEqual((got["rec.rest.precision"], got["rec.rest.recall"], got["rec.rest.false_per_100_bars"]), (1.0, 0.0, 0.0))

    def test_an_invented_rest_is_false(self):
        ref = score(bar(four("C", "D", "E", "F")))
        pred = score(bar(note("C", 4, 1) + rest(1) + note("E", 4, 1) + note("F", 4, 1)))
        got = rec.rest_metrics(ref, pred, 0, Fraction(0))
        self.assertEqual((got["rec.rest.precision"], got["rec.rest.false_per_100_bars"]), (0.0, 100.0))
        self.assertIsNone(got["rec.rest.recall"])                      # the truth has no silence: not applicable

    def test_a_rest_that_covers_half_the_silence_counts(self):
        ref = score(bar(note("C", 4, 1) + rest(2) + note("E", 4, 1)))                  # silence [1, 3)
        pred = score(bar(note("C", 4, 1) + rest(1) + note("D", 4, 1) + note("E", 4, 1)))   # rest [1, 2): exactly half the truth silence
        got = rec.rest_metrics(ref, pred, 0, Fraction(0))
        self.assertEqual((got["rec.rest.precision"], got["rec.rest.recall"]), (1.0, 1.0))

    def test_a_tiny_rest_is_false_even_inside_a_silence_of_the_truth(self):
        ref = score(bar(note("C", 4, 8) + note("D", 4, 8) + rest(8) + note("E", 4, 8) + note("F", 4, 8)), divisions=8)
        pred = score(bar(note("C", 4, 8) + note("D", 4, 8) + rest(1) + note("E", 4, 8) + note("F", 4, 8) + rest(7)), divisions=8)
        # the truth silence is a quarter (8 of 8 per quarter); a rest of a 32nd covers an eighth of it
        got = rec.rest_metrics(ref, pred, 0, Fraction(0))
        self.assertLess(got["rec.rest.precision"], 1.0)

    def test_the_bar_offset_aligns_the_bars(self):
        ref = score(bar(note("C", 4, 1) + rest(1) + note("D", 4, 1) + note("E", 4, 1)))
        pred = score(bar(four("A", "B", "C", "D"), number=1),
                     bar(note("C", 4, 1) + rest(1) + note("D", 4, 1) + note("E", 4, 1), number=2))
        got = rec.rest_metrics(ref, pred, 1, Fraction(0))
        self.assertEqual((got["rec.rest.precision"], got["rec.rest.recall"]), (1.0, 1.0))

    def test_a_second_voice_rest_under_the_first_voice_is_no_silence_of_the_staff(self):
        # rec/2 (G10a-3): the truth's silences are where nothing of the staff sounds; a predicted rest counts there too. The
        # right hand's voice 1 plays four quarters, its voice 2 a half note and a half rest: the staff never rests
        ref = score(bar(four("C", "D", "E", "F")))
        v1 = "".join(note(p, 5, 1, voice=1) for p in "CDEF")
        v2 = ("<backup><duration>4</duration></backup>" + note("A", 4, 2, voice=2) +
              "<note><rest/><duration>2</duration><voice>2</voice><staff>1</staff></note>")
        pred = canon([measure(v1 + v2, note("C", 3, 4, staff=2), number=1, rh_len=4)])
        got = rec.rest_metrics(ref, pred, 0, Fraction(0))
        self.assertEqual((got["rec.rest.precision"], got["rec.rest.false_per_100_bars"]), (1.0, 0.0))
        # where both voices rest, the staff is silent: one rest of the staff
        v1r = note("C", 5, 1, voice=1) + note("D", 5, 1, voice=1) + "<note><rest/><duration>2</duration><voice>1</voice><staff>1</staff></note>"
        pred2 = canon([measure(v1r + v2, note("C", 3, 4, staff=2), number=1, rh_len=4)])
        self.assertEqual(rec.predicted_rests(pred2, False), {(0, 1): [(Fraction(2), Fraction(4))]})

    def test_a_staff_in_one_voice_keeps_its_rest_spans(self):
        # rec/2 is rec/1 for every staff-bar written in one voice
        pred = score(bar(note("C", 4, 1) + rest(1) + note("D", 4, 1) + rest(1)))
        self.assertEqual(rec.predicted_rests(pred, False), {(0, 1): [(Fraction(1), Fraction(2)), (Fraction(3), Fraction(4))]})

    def test_a_one_staff_reference_is_judged_on_the_whole_score(self):
        ref = canon([measure(note("C", 4, 1) + rest(1) + note("D", 4, 1) + note("E", 4, 1), number=1)], staves=1)
        # the prediction splits the same notes over two staves and rests in each where the other plays: only the
        # stretch rested in BOTH staves is a silence of the score
        pred = canon([measure(note("C", 4, 1) + rest(1) + note("D", 4, 1) + note("E", 4, 1),
                              rest(1, 2) + note("C", 3, 1, staff=2) + rest(2, 2), number=1, rh_len=4)])
        got = rec.rest_metrics(ref, pred, 0, Fraction(0))
        self.assertEqual(got["rec.rest.false_per_100_bars"], 0.0)


class TupletMetrics(unittest.TestCase):
    def beat_with_triplet(self, divisions=3):
        d = divisions
        return (note("C", 4, d) + note("D", 4, 1, extra=TRI) + note("E", 4, 1, extra=TRI) + note("F", 4, 1, extra=TRI)
                + note("G", 4, d) + note("A", 4, d))

    def test_triplet_beats_found_and_missed(self):
        ref = score(bar(self.beat_with_triplet(), rh_len=12, lh_len=12), divisions=3)
        same = rec.tuplet_metrics(ref, ref, 0, Fraction(0))
        self.assertEqual((same["rec.tuplet.precision"], same["rec.tuplet.recall"], same["rec.tuplet.false_per_100_beats"]), (1.0, 1.0, 0.0))
        plain = score(bar(note("C", 4, 3) + note("D", 4, 3) + note("G", 4, 3) + note("A", 4, 3)), divisions=3)
        none = rec.tuplet_metrics(ref, plain, 0, Fraction(0))
        self.assertEqual((none["rec.tuplet.precision"], none["rec.tuplet.recall"]), (1.0, 0.0))     # nothing claimed, nothing found

    def test_a_triplet_where_there_is_none_is_false(self):
        ref = score(bar(note("C", 4, 3) + note("D", 4, 3) + note("G", 4, 3) + note("A", 4, 3)), divisions=3)
        pred = score(bar(self.beat_with_triplet(), rh_len=12, lh_len=12), divisions=3)
        got = rec.tuplet_metrics(ref, pred, 0, Fraction(0))
        self.assertEqual(got["rec.tuplet.precision"], 0.0)
        self.assertEqual(got["rec.tuplet.false_per_100_beats"], 25.0)                    # 1 false beat in 4
        self.assertIsNone(got["rec.tuplet.recall"])

    def test_a_triplet_in_the_wrong_beat_is_a_miss_and_a_false_one(self):
        ref = score(bar(self.beat_with_triplet(), rh_len=12, lh_len=12), divisions=3)
        late = (note("C", 4, 3) + note("D", 4, 3) + note("G", 4, 3) + note("A", 4, 1, extra=TRI) + note("B", 4, 1, extra=TRI) +
                note("C", 5, 1, extra=TRI))
        pred = score(bar(late, rh_len=12, lh_len=12), divisions=3)
        got = rec.tuplet_metrics(ref, pred, 0, Fraction(0))
        self.assertEqual((got["rec.tuplet.precision"], got["rec.tuplet.recall"]), (0.0, 0.0))


class VoiceF1(unittest.TestCase):
    def two_voices(self):
        # RH: voice 1 four quarters, voice 2 a half note then a half note (a held lower line)
        v1 = "".join(note(p, 5, 1, voice=1) for p in "CDEF")
        v2 = "<backup><duration>4</duration></backup>" + note("A", 4, 2, voice=2) + note("G", 4, 2, voice=2)
        return measure(v1 + v2, note("C", 3, 4, staff=2), number=1)

    def test_a_voice_that_is_split_the_same_way_is_perfect(self):
        ref = canon([self.two_voices()])
        pairs = [(s.id, s.id) for s in ref.played()]
        self.assertEqual(rec.voice_f1(ref, ref, pairs), 1.0)

    def test_one_voice_for_two_loses_precision_and_recall(self):
        ref = canon([self.two_voices()])
        merged = canon([measure(note("C", 5, 1) + note("A", 4, 1) + note("D", 5, 1) + note("G", 4, 1) + note("E", 5, 1) + note("F", 5, 1) +
                                note("A", 4, 1), note("C", 3, 4, staff=2), number=1, rh_len=7)])
        by_key = {(s.midi, s.onset_q): s.id for s in ref.played()}
        pairs = [(by_key[(s.midi, s.onset_q)], s.id) for s in merged.played() if (s.midi, s.onset_q) in by_key]
        got = rec.voice_f1(ref, merged, pairs)
        self.assertIsNotNone(got)
        self.assertLess(got, 1.0)

    def test_a_single_note_staff_has_no_pairs(self):
        one = canon([measure(note("C", 4, 4), "", number=1)])
        self.assertIsNone(rec.voice_f1(one, one, [(s.id, s.id) for s in one.played()]))


class MetreAndHarmony(unittest.TestCase):
    def test_boundaries_in_seconds(self):
        c = score(bar(four("C", "D", "E", "F")), bar(four("G", "A", "B", "C"), number=2))
        sec = lambda m, q: float(m.start_q + q) * 0.5                                   # 120 qpm   # noqa: E731
        self.assertEqual(rec.metre_f1(c, c, sec, sec), 1.0)
        late = lambda m, q: float(m.start_q + q) * 0.5 + 0.5                            # a whole beat late  # noqa: E731
        got = rec.metre_f1(c, c, sec, late)
        self.assertLess(got, 0.8)
        near = lambda m, q: float(m.start_q + q) * 0.5 + 0.03                           # 30 ms: inside the tolerance  # noqa: E731
        self.assertEqual(rec.metre_f1(c, c, sec, near), 1.0)

    def test_the_wrong_metre_has_the_wrong_beats(self):
        ref = score(bar(four("C", "D", "E", "F")), bar(four("G", "A", "B", "C"), number=2))
        three = canon([measure(note("C", 4, 1) + note("D", 4, 1) + note("E", 4, 1), note("C", 3, 3, staff=2), number=i + 1, rh_len=3)
                       for i in range(3)], time=(3, 4))
        sec = lambda m, q: float(m.start_q + q) * 0.5                                   # noqa: E731
        got = rec.metre_f1(ref, three, sec, sec)
        self.assertLess(got, 1.0)
        self.assertGreater(got, 0.0)                                                     # the beats still line up

    def test_harmony_agreement(self):
        ref = ["0:maj", "7:maj", None, "5:maj"]
        self.assertEqual(rec.harmony_agreement(ref, ["0:maj", "7:maj", "9:min", "5:maj"], 0), 1.0)
        self.assertAlmostEqual(rec.harmony_agreement(ref, ["0:maj", "7:min", "9:min", "5:maj"], 0), 2 / 3)
        self.assertEqual(rec.harmony_agreement(ref, ["2:maj", "0:maj", "7:maj", None, "5:maj"], 1), 1.0)      # bar offset
        self.assertEqual(rec.harmony_agreement(ref, None, 0), 0.0)
        self.assertIsNone(rec.harmony_agreement([None, None], ["0:maj"], 0))
        self.assertIsNone(rec.harmony_agreement(None, ["0:maj"], 0))


class StabilityAndChecks(unittest.TestCase):
    def test_bar_digests_and_the_share_of_changed_bars(self):
        a = score(bar(four("C", "D", "E", "F")), bar(four("G", "A", "B", "C"), number=2))
        b = score(bar(four("C", "D", "E", "F")), bar(four("G", "A", "B", "D"), number=2))
        self.assertEqual(rec.changed_bar_share(rec.bar_digests(a), rec.bar_digests(a)), 0.0)
        self.assertEqual(rec.changed_bar_share(rec.bar_digests(a), rec.bar_digests(b)), 0.5)
        c = score(bar(four("C", "D", "E", "F")))
        self.assertEqual(rec.changed_bar_share(rec.bar_digests(a), rec.bar_digests(c)), 0.5)        # a bar fewer: that bar changed
        self.assertEqual(rec.changed_bar_share([], []), 0.0)

    def test_perturb_is_small_deterministic_and_keeps_the_notes(self):
        inp = {"notes": [{"on": 1.0 + i * 0.5, "off": 1.4 + i * 0.5, "midi": 60 + i, "vel": 70} for i in range(40)], "pedals": [], "title": "t"}
        a, b = recrun.perturb(inp, "case", 1), recrun.perturb(inp, "case", 1)
        self.assertEqual(a, b)
        self.assertNotEqual(a, recrun.perturb(inp, "case", 2))
        self.assertEqual([n["midi"] for n in a["notes"]], [n["midi"] for n in inp["notes"]])
        self.assertLessEqual(max(abs(x["on"] - y["on"]) for x, y in zip(a["notes"], inp["notes"])), 0.0101)
        self.assertEqual(a["title"], "t")
        self.assertEqual(recrun.perturb(inp, "case", 1, noise=0.0)["notes"], inp["notes"])

    def test_the_stability_of_identical_runs_is_zero(self):
        c = corpus.by_id(corpus.load_corpus())["micro/M01-waltz-3-4"]
        xml = util.read_text(c.abspath)
        self.assertEqual(recrun.stability_of(xml, [xml, xml, xml]), 0.0)
        self.assertEqual(recrun.stability_of(xml, [None, xml]), 0.5)                 # a run that failed counts as all bars changed

    def test_usable_needs_the_gates_the_classes_and_the_rest_and_tuplet_budgets(self):
        good = {"usable": 1.0, "notes.onset.f1_50ms": 1.0, "rec.voice.f1": 1.0, "rec.metre.f1": 1.0, "notation.duration.accuracy_ref": 1.0,
                "rec.harmony.agreement": 1.0, "rec.rest.false_per_100_bars": 4.0, "rec.tuplet.false_per_100_beats": 2.0}
        good.update({f"rec.check.{c}": 0.0 for c in range(1, 11)})
        self.assertEqual(rec.finish(good)["rec.usable"], 1.0)
        self.assertEqual(rec.finish(good)["rec.mv2h"], 1.0)
        for key, bad in (("usable", 0.0), ("rec.check.5", 0.5), ("rec.check.1", 0.01), ("rec.rest.false_per_100_bars", 5.1),
                         ("rec.tuplet.false_per_100_beats", 2.1), ("rec.check.7", None)):
            m = dict(good, **{key: bad})
            self.assertEqual(rec.finish(m)["rec.usable"], 0.0, key)
        m = dict(good, **{"rec.check.8": 3.0, "rec.check.9": 9.0})                      # classes 8-10 are information
        self.assertEqual(rec.finish(m)["rec.usable"], 1.0)

    def test_mv2h_is_the_mean_of_what_is_there(self):
        m = {"notes.onset.f1_50ms": 1.0, "rec.voice.f1": None, "rec.metre.f1": 0.5, "notation.duration.accuracy_ref": 0.0,
             "rec.harmony.agreement": None}
        self.assertAlmostEqual(rec.finish(m)["rec.mv2h"], 0.5)


class RunsThroughTheRunner(unittest.TestCase):
    """The plumbing: a rec suite computes the metrics and the others do not; two runs are the same bytes."""

    @classmethod
    def setUpClass(cls):
        cls.suite = suite_mod.load_suite("rec-smoke")

    def run_one(self, flt):
        return runner.run_suite(self.suite, filter_=flt, write_cases=False, quiet=True, out_dir=OUT)["results"]

    def test_metrics_exist_and_are_deterministic(self):
        a = self.run_one("catalog/gymnopedie-1|cover-pedal")
        b = self.run_one("catalog/gymnopedie-1|cover-pedal")
        self.assertEqual(json.dumps(a["cases"], sort_keys=True), json.dumps(b["cases"], sort_keys=True))
        self.assertEqual(len(a["cases"]), 3)                                              # legacy, app and v2 options (G10a-1)
        for c in a["cases"]:
            self.assertEqual(c["status"], "ok")
            m = c["metrics"]
            for k in ("rec.onset_f1", "rec.rest.precision", "rec.rest.false_per_100_bars", "rec.tuplet.precision", "rec.voice.f1",
                      "rec.harmony.agreement", "rec.stability", "rec.metre.f1", "rec.mv2h", "rec.usable") + tuple(f"rec.check.{i}" for i in range(1, 11)):
                self.assertIn(k, m, k)
            self.assertIn(m["rec.usable"], (0.0, 1.0))
            self.assertTrue(0.0 <= m["rec.stability"] <= 1.0)
            self.assertIn("opts:" + c["id"].rsplit("opt:", 1)[1], c["tags"])

    def test_the_legacy_app_and_v2_options_get_the_same_performance(self):
        r = self.run_one("catalog/gymnopedie-1|cover-pedal")
        self.assertEqual(len({c["counts"]["input"] for c in r["cases"]}), 1)

    def test_a_library_suite_has_no_rec_metrics(self):
        s = suite_mod.load_suite("smoke")
        r = runner.run_suite(s, filter_="micro/M01-waltz-3-4|deadpan", write_cases=False, quiet=True, out_dir=OUT)["results"]
        self.assertFalse([k for k in r["cases"][0]["metrics"] if k.startswith("rec.")])


if __name__ == "__main__":
    unittest.main()
