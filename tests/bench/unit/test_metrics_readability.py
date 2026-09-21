import unittest

from pppbench.metrics import composite, readability
from unit.helpers import canon, measure, note


class Readability(unittest.TestCase):
    def test_overfull_underfull_empty(self):
        c = canon([measure(note("C", 5, 4), number=1),
                   measure(note("C", 5, 5), number=2),                   # overfull
                   measure(note("C", 5, 1), number=3),                   # underfull (< half a bar)
                   measure("", number=4),                                # empty
                   measure(note("C", 5, 2), number=5)], staves=1)        # exactly half: fine
        d = readability.bar_integrity_detail(c)
        self.assertEqual([(b["index"], b["kind"]) for b in d["bad"]], [(1, "overfull"), (2, "underfull"), (3, "empty")])
        self.assertEqual(readability.readability(c)["read.bar_integrity"], 2 / 5)

    def test_implicit_first_and_last_bars_may_be_short(self):
        c = canon([measure(note("G", 4, 1), number=0, implicit=True), measure(note("C", 5, 4), number=1),
                   measure(note("C", 5, 3), number=2, implicit=True)], staves=1)
        self.assertEqual(readability.bar_integrity_detail(c)["bad"], [])

    def test_rates(self):
        c = canon([measure(note("C", 5, 1, tie="start") + note("C", 5, 1, tie="stop") +
                           note("F", 5, 2, alter=1, extra="<accidental>sharp</accidental>"),
                           note("C", 3, 4, staff=2) + note("E", 4, 4, staff=2, chord=True), number=1, rh_len=4)])
        r = readability.readability(c)
        self.assertEqual(r["read.ties_per_note"], 1 / 5)
        self.assertEqual(r["read.accidentals_per_note"], 1 / 5)
        self.assertEqual(r["read.max_chord_size"], 2.0)
        self.assertEqual(r["read.over_span_rate"], 1 / 3)   # the LH C3+E4 is a 16-semitone stretch

    def test_delta_against_reference(self):
        ref = canon([measure(note("C", 5, 4), number=1)], staves=1)
        pred = canon([measure(note("C", 5, 2, tie="start") + note("C", 5, 2, tie="stop"), number=1)], staves=1)
        out = readability.compute({"pred": pred, "ref": ref})
        self.assertEqual(out["read.ties_per_note.delta"], 0.5)


class Composite(unittest.TestCase):
    def test_nulls_are_renormalised(self):
        full = {k: 1.0 for k in composite.SQI_WEIGHTS}
        self.assertAlmostEqual(composite.sqi(full), 100.0)
        m = dict(full, **{"notation.hand.accuracy": None, "notes.identity.f1": 0.0})
        # hands (0.10) dropped; identity (0.20) scores 0 -> 100 * 0.70 / 0.90
        self.assertAlmostEqual(composite.sqi(m), 100 * 0.70 / 0.90)

    def test_too_few_components_is_null(self):
        m = {"notes.identity.f1": 1.0, "notation.ioi.accuracy": 1.0}   # 0.40 of the weight
        self.assertIsNone(composite.sqi(m))
        m["notation.duration.accuracy"] = 1.0                          # 0.50
        self.assertEqual(composite.sqi(m), 100.0)

    def test_symbolic(self):
        self.assertAlmostEqual(composite.sqi_symbolic({k: 0.5 for k in composite.SQI_S_WEIGHTS}), 50.0)


if __name__ == "__main__":
    unittest.main()
