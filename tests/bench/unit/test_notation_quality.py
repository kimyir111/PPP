"""reader/5 and the nq.* metrics (docs/GOALS/G03 §20.2, §20.3, §20.4), each on a small hand-written file."""

import unittest
from fractions import Fraction

from pppbench import READS_AS, g3gate, musicxml, version_compatible, versions_compatible
from pppbench.metrics import notation_quality as NQ
from unit import test_notation_audit as A   # its score/note/rest builders (module attribute: its tests run once)


def canon(measures, **kw):
    return musicxml.read_score(A.score(measures, **kw))


def vals(measures, **kw):
    return NQ.values(NQ.file_stats(canon(measures, **kw)))


def beam(v):
    return f'<beam number="1">{v}</beam>'


def tnote(step, typ="eighth", dur=8, notations=""):
    """a 3:2 triplet note (24 divisions a quarter)"""
    return A.note(step, 5, dur, typ, notations=notations, tm=True)


def dotted_half():
    return A.note(dur=72, typ="half").replace("<type>half</type>", "<type>half</type><dot/>")


class ReaderFive(unittest.TestCase):
    def test_brackets_and_beams_are_read(self):
        bar = (tnote("C", notations='<tuplet type="start"/>') + tnote("D") + tnote("E", notations='<tuplet type="stop"/>')
               + A.note("F", dur=12, typ="eighth", extra=beam("begin")) + A.note("G", dur=12, typ="eighth", extra=beam("end"))
               + A.note(dur=48, typ="half") + A.whole_lh())
        n = canon([bar]).notation
        self.assertEqual([len(b["events"]) for b in n["brackets"]], [3])
        self.assertEqual(n["brackets"][0]["ratio"], (3, 2))
        self.assertEqual([len(b["events"]) for b in n["beams"]], [2])

    def test_nested_brackets_pair_by_number(self):
        bar = (tnote("C", notations='<tuplet type="start" number="1"/><tuplet type="start" number="2"/>') + tnote("D")
               + tnote("E", notations='<tuplet type="stop" number="2"/>') + tnote("F") + tnote("G") +
               tnote("A", notations='<tuplet type="stop" number="1"/>') + A.note(dur=48, typ="half") + A.whole_lh())
        n = canon([bar]).notation
        self.assertEqual(sorted(len(b["events"]) for b in n["brackets"]), [3, 6])

    def test_the_layer_is_not_part_of_the_canonical_score(self):
        c = canon([A.note(dur=96, typ="whole") + A.whole_lh()])
        self.assertNotIn("notation", c.to_json())
        d = canon([A.note(dur=96, typ="whole") + A.whole_lh()])
        d.notation = None
        self.assertEqual(c, d)   # compare=False: the layer never makes two readings differ

    def test_reader_5_reads_as_reader_4(self):
        self.assertEqual(READS_AS["reader/5"], ("reader/4",))
        self.assertTrue(version_compatible("reader", "reader/5", "reader/4"))
        self.assertFalse(version_compatible("reader", "reader/4", "reader/5"))
        now = {"reader": "reader/5", "metrics": "metrics/6"}
        self.assertTrue(versions_compatible(now, {"reader": "reader/4", "metrics": "metrics/6"}))
        self.assertFalse(versions_compatible(now, {"reader": "reader/4", "metrics": "metrics/5"}))


class NotationQuality(unittest.TestCase):
    def test_one_note_brackets_and_complete_groups(self):
        one = "".join(tnote(s, notations='<tuplet type="start"/><tuplet type="stop"/>') for s in "CDE")
        v = vals([one + dotted_half() + A.whole_lh()])
        self.assertEqual(v["nq.tuplet.one_note_rate"], 1.0)
        self.assertEqual(v["nq.tuplet.group_complete"], 0.0)
        grp = tnote("C", notations='<tuplet type="start"/>') + tnote("D") + tnote("E", notations='<tuplet type="stop"/>')
        v = vals([grp + dotted_half() + A.whole_lh()])
        self.assertEqual(v["nq.tuplet.one_note_rate"], 0.0)
        self.assertEqual(v["nq.tuplet.group_complete"], 1.0)
        # a triplet quarter + eighth: the unit is found from the members
        mixed = tnote("C", "quarter", 16, '<tuplet type="start"/>') + tnote("D", notations='<tuplet type="stop"/>')
        v = vals([mixed + dotted_half() + A.whole_lh()])
        self.assertEqual(v["nq.tuplet.group_complete"], 1.0)

    def test_no_bracket_is_none(self):
        v = vals([A.note(dur=96, typ="whole") + A.whole_lh()])
        self.assertIsNone(v["nq.tuplet.one_note_rate"])
        self.assertIsNone(v["nq.tie.mergeable_rate"])

    def test_triplet_lengths_without_time_modification(self):
        v = vals([A.rest(8, "eighth") + A.note(dur=16, typ="quarter") + dotted_half() + A.whole_lh()])
        self.assertEqual(v["nq.shape.tm_missing"], 2.0)

    def test_mergeable_ties(self):
        tie_s, tie_e = "<tie type=\"start\"/>", "<tie type=\"stop\"/>"
        v = vals([A.note(dur=12, typ="eighth", extra=tie_s) + A.note(dur=12, typ="eighth", extra=tie_e)   # 8~8 in a beat
                  + A.note(dur=24, extra=tie_s) + A.note(dur=24, extra=tie_e)                               # 4~4 over a beat
                  + A.note(dur=24) + A.whole_lh()])
        self.assertEqual(v["nq.tie.mergeable_rate"], 0.5)

    def test_hidden_beats_and_the_s_table(self):
        hb = NQ.hides_beat
        q = Fraction(1)
        self.assertFalse(hb((2, 4), Fraction(1, 2), q, "quarter", 0), "2/4: 8 4 8")
        self.assertTrue(hb((3, 4), Fraction(1, 2), q, "quarter", 0), "3/4: 8 4 4 8 is not allowed")
        self.assertFalse(hb((4, 4), Fraction(1, 2), q, "quarter", 0), "4/4: 8 4 8 in the first half")
        self.assertTrue(hb((4, 4), Fraction(3, 2), q, "quarter", 0), "4/4: over the middle")
        self.assertFalse(hb((4, 4), Fraction(1), Fraction(2), "half", 0), "4/4: 4 2 4")
        self.assertFalse(hb((4, 4), Fraction(0), Fraction(3, 2), "quarter", 1), "a dotted quarter from a beat")
        self.assertTrue(hb((6, 8), Fraction(0), Fraction(2), "half", 0), "6/8: a half hides the second beat")
        self.assertFalse(hb((6, 8), Fraction(0), Fraction(3), "half", 1), "6/8: the dotted half fills the group")
        self.assertFalse(hb((6, 8), Fraction(0), Fraction(1), "quarter", 0), "6/8: 4 8 inside the beat")
        v = vals([A.note(dur=12, typ="eighth") + A.note(dur=24) + A.note(dur=12, typ="eighth") + A.note(dur=48, typ="half")
                  + A.whole_lh()], time=(4, 4))
        self.assertEqual(v["nq.rhythm.hidden_beat_rate"], 0.0)
        v = vals([A.note(dur=12, typ="eighth") + A.note(dur=24) + A.note(dur=24) + A.note(dur=12, typ="eighth")],
                 time=(3, 4), staves=1)
        self.assertAlmostEqual(v["nq.rhythm.hidden_beat_rate"], 2 / 4)

    def test_rests_and_short_values_against_the_reference(self):
        pred = NQ.file_stats(canon([A.note(dur=21, typ="eighth") + A.rest(3, "32nd") + A.note(dur=72, typ="half") + A.whole_lh()]))
        ref = NQ.file_stats(canon([A.note(dur=24) + A.note(dur=72, typ="half") + A.whole_lh()]))
        out = NQ.compare(pred, ref, 0)
        self.assertEqual(out["nq.rest.per_measure_delta"], 1.0)
        self.assertAlmostEqual(out["nq.rhythm.short_rate_delta"], 1 / 4)
        self.assertEqual(out["nq.tie.mergeable_rate.delta"], None)

    def test_poly_recall_and_ned(self):
        two = (A.note(dur=96, typ="whole") + "<backup><duration>96</duration></backup>"
               + A.note("E", 4, 96, "whole", voice=2) + A.whole_lh())
        one = A.note(dur=96, typ="whole") + A.whole_lh()
        ref, pred = NQ.file_stats(canon([two])), NQ.file_stats(canon([one]))
        out = NQ.compare(pred, ref, 0)
        self.assertEqual(out["nq.voice.poly_recall"], 0.0)
        self.assertEqual(NQ.compare(ref, ref, 0)["nq.voice.poly_recall"], 1.0)
        self.assertEqual(NQ.compare(ref, ref, 0)["nq.ned"], 0.0)
        self.assertAlmostEqual(out["nq.ned"], 1 / 3)   # the second voice's whole note is missing
        self.assertEqual(NQ.levenshtein(list("kitten"), list("sitting")), 3)

    def test_beams(self):
        e = lambda s, b: A.note(s, dur=12, typ="eighth", extra=beam(b) if b else "")  # noqa: E731
        bar = e("C", "begin") + e("D", "end") + e("E", None) + e("F", None) + A.note(dur=48, typ="half") + A.whole_lh()
        v = vals([bar])
        self.assertEqual(v["nq.beam.coverage"], 0.5)
        self.assertEqual(v["nq.beam.boundary_ok"], 1.0)
        across = e("C", None) + e("D", "begin") + e("E", "end") + e("F", None) + A.note(dur=48, typ="half") + A.whole_lh()
        self.assertEqual(vals([across])["nq.beam.boundary_ok"], 0.0)
        self.assertIsNone(vals([A.note(dur=96, typ="whole") + A.whole_lh()])["nq.beam.coverage"])

    def test_redundant_accidentals_and_courtesy(self):
        sharp = lambda **k: A.note("F", 5, 24, "quarter", alter=1, acc="sharp", **k)   # noqa: E731
        # F#, F# again with its sign (redundant), then bar 2: F# with its sign is needed again (7 notes)
        v = vals([sharp() + sharp() + A.note(dur=48, typ="half") + A.whole_lh(),
                  sharp() + dotted_half() + A.whole_lh()])
        self.assertAlmostEqual(v["nq.acc.redundant_rate"], 1 / 7)
        # bar 2: a natural sign on F after bar 1's F# is a courtesy (a)
        nat = A.note("F", 5, 24, "quarter", acc="natural")
        v = vals([sharp() + dotted_half() + A.whole_lh(),
                  nat + dotted_half() + A.whole_lh()])
        self.assertEqual(v["nq.acc.redundant_rate"], 0.0)

    def test_spelling_mixed_bars_and_ledger_lines(self):
        v = vals([A.note("E", 5, 24, alter=1, acc="sharp") + A.note("B", 4, 24, alter=-1, acc="flat")
                  + A.note("C", 7, 48, "half") + A.whole_lh()])
        self.assertAlmostEqual(v["nq.spell.context_odd"], 1000 / 4)
        self.assertAlmostEqual(v["nq.spell.mixed_bar_rate"], 1 / 2)
        self.assertAlmostEqual(v["nq.range.ledger4_rate"], 1000 / 4)


class G3Gate(unittest.TestCase):
    def results(self, **m):
        base = {"nq.tuplet.one_note_rate": 0.0, "nq.shape.tm_missing": 0.0, "nq.tie.mergeable_rate": 0.0,
                "notation.hand.accuracy": 0.95, "critical.hands": 1.0, "critical.key": 1.0,
                "notation.spelling.accuracy": 1.0}
        base.update(m)
        return {"cases": [{"id": "x", "status": "ok", "metrics": base}]}

    def baseline(self):
        return {"cases": {"x": {"metrics": {"critical.hands": 1.0, "critical.key": 1.0, "notation.spelling.accuracy": 1.0}}}}

    def test_a_clean_run_passes(self):
        self.assertTrue(all(ok for _, ok, _ in g3gate.evaluate(self.results(), self.baseline())))

    def test_each_line_fails_on_its_own(self):
        for bad in ({"nq.tuplet.one_note_rate": 1.0}, {"nq.shape.tm_missing": 3.0}, {"nq.tie.mergeable_rate": 0.4},
                    {"notation.hand.accuracy": 0.88}, {"critical.hands": 0.0}, {"critical.key": 0.0},
                    {"notation.spelling.accuracy": 0.9}):
            lines = g3gate.evaluate(self.results(**bad), self.baseline())
            self.assertFalse(all(ok for _, ok, _ in lines), bad)
            self.assertIn("G3 gate: FAIL", g3gate.format_lines(lines))


if __name__ == "__main__":
    unittest.main()
