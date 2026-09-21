"""Intentionally degraded outputs and inputs must make the metrics worse.

A benchmark that cannot tell a damaged score from a good one measures
nothing. Each test takes a prediction whose metrics are known, breaks one
aspect of it, and checks that the metric for that aspect falls (and the
unrelated ones do not move)."""

import re
import unittest

from pppbench import corpus, evaluate, perform, stages


def case(ref_id, profile="deadpan", beats="oracle"):
    e = corpus.by_id(corpus.load_corpus())[ref_id]
    c = corpus.read_reference(e)
    p = perform.perform(c, ref_id, profile, beats, 1, expect=e.expect)
    row = stages.notate_batch([{"id": "x", "input": p.input, "opts": p.opts}])["results"]["x"]
    return c, p, row


def metrics(c, p, row, xml=None):
    r = dict(row, xml=xml if xml is not None else row["xml"])
    return evaluate.evaluate_timed(c, p, r)[0]


class DegradedOutput(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.c, cls.p, cls.row = case("micro/M01-waltz-3-4")
        cls.good = metrics(cls.c, cls.p, cls.row)

    def test_the_undamaged_output_is_good(self):
        self.assertGreater(self.good["sqi"], 95)
        self.assertEqual(self.good["notes.identity.f1"], 1.0)

    def test_wrong_pitches(self):
        n = [0]

        def shift(m):
            n[0] += 1
            return "<octave>" + str(int(m.group(1)) + 1) + "</octave>" if n[0] % 3 == 0 else m.group(0)
        bad = metrics(self.c, self.p, self.row, re.sub(r"<octave>(\d)</octave>", shift, self.row["xml"]))
        self.assertLess(bad["notes.identity.f1"], self.good["notes.identity.f1"] - 0.2)
        self.assertLess(bad["sqi"], self.good["sqi"])

    def test_wrong_hands(self):
        xml = self.row["xml"].replace("<staff>2</staff></note>", "<staff>1</staff></note>")
        bad = metrics(self.c, self.p, self.row, xml)
        self.assertLess(bad["notation.hand.accuracy"], self.good["notation.hand.accuracy"] - 0.3)
        self.assertEqual(bad["notes.identity.f1"], self.good["notes.identity.f1"])

    def test_wrong_time_signature_and_key(self):
        xml = self.row["xml"].replace("<beats>3</beats>", "<beats>6</beats>").replace("<beat-type>4</beat-type>", "<beat-type>8</beat-type>")
        stats = dict(self.row["stats"], beatsPerBar=6, beatType=8)
        bad = evaluate.evaluate_timed(self.c, self.p, dict(self.row, xml=xml, stats=stats))[0]
        self.assertEqual(bad["struct.time_sig.exact"], 0.0)
        self.assertEqual(bad["struct.time_sig.score"], 0.25)
        xml = self.row["xml"].replace("<fifths>1</fifths>", "<fifths>-2</fifths>")
        self.assertEqual(metrics(self.c, self.p, self.row, xml)["struct.key.fifths_exact"], 0.0)

    def test_wrong_tempo_mark(self):
        xml = re.sub(r'<sound tempo="\d+"/>', '<sound tempo="48"/>', self.row["xml"])
        bad = metrics(self.c, self.p, self.row, xml)
        self.assertEqual(bad["struct.tempo.ok_effective"], 0.0)
        self.assertEqual(bad["struct.tempo.mark_consistent"], 0.0)

    def test_shortened_durations(self):
        xml = self.row["xml"].replace("<duration>72</duration>", "<duration>24</duration>").replace(
            "<type>half</type><dot/>", "<type>quarter</type>")
        bad = metrics(self.c, self.p, self.row, xml)
        self.assertLess(bad["notation.duration.accuracy"], self.good["notation.duration.accuracy"])

    def test_dropped_notes(self):
        xml = re.sub(r"<note><chord/>.*?</note>", "", self.row["xml"])
        bad = metrics(self.c, self.p, self.row, xml)
        self.assertLess(bad["notes.identity.recall"], 0.8)
        self.assertEqual(bad["notes.identity.precision"], 1.0)

    def test_bad_stats_shape_is_an_error_not_a_guess(self):
        stats = dict(self.row["stats"], barStarts=self.row["stats"]["barStarts"][:-2])
        with self.assertRaises(evaluate.CaseError) as e:
            evaluate.evaluate_timed(self.c, self.p, dict(self.row, stats=stats))
        self.assertEqual(e.exception.code, "STATS_SHAPE")


class DegradedInput(unittest.TestCase):
    def test_noisier_performances_score_lower(self):
        ref_id = "method/czerny599/001"
        scores = {}
        for profile, beats in (("deadpan", "oracle"), ("amt", "oracle-noisy")):
            c, p, row = case(ref_id, profile, beats)
            scores[profile] = metrics(c, p, row)
        self.assertLess(scores["amt"]["notes.identity.f1"], scores["deadpan"]["notes.identity.f1"])
        self.assertLess(scores["amt"]["notes.input_fidelity.f1"] - scores["amt"]["notes.identity.f1"], 0.10)


if __name__ == "__main__":
    unittest.main()
