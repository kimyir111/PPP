"""Why a residual is there (pppbench.notation_reasons) and the reason-aware G3 gate (G03 §29 M6, U-1/U-2), each on a
small hand-written file. The four proofs M6 asks for: a true mergeable defect, a triplet length without
time-modification that R17 does not explain, and more R17 than the recorded baseline all FAIL the gate; ties an H6 or
H7 rule (or a beat the S table keeps) requires PASS it."""

import unittest

from pppbench import g3gate, musicxml, notation_reasons as RS
from pppbench.metrics import notation_quality as NQ
from unit import test_notation_audit as A   # its score/note/rest builders

TIE_START = dict(extra='<tie type="start"/>', notations='<tied type="start"/>')
TIE_STOP = dict(extra='<tie type="stop"/>', notations='<tied type="stop"/>')


def reasons(measures, divisions=24, implicit=False, **kw):
    xml = A.score(measures, **kw).replace(b"<divisions>24</divisions>", f"<divisions>{divisions}</divisions>".encode())
    if implicit:
        xml = xml.replace(b'<measure number="1">', b'<measure number="1" implicit="yes">')
    canon = musicxml.read_score(xml)
    return RS.reasons(canon.notation), NQ.values(NQ.file_stats(canon))


def tnote(step, typ="eighth", dur=8, notations="", **kw):
    return A.note(step, 5, dur, typ, notations=notations, tm=True, **kw)


def lh(dur=96, typ="whole"):
    return f"<backup><duration>{dur}</duration></backup>" + A.note("C", 3, dur, typ, staff=2, voice=5)


class Reasons(unittest.TestCase):
    def test_a_tie_one_symbol_could_replace_is_a_defect(self):
        # 16~16 on beat 1, nothing else in the beat: one eighth could replace it
        bar = (A.note(dur=6, typ="16th", **TIE_START) + A.note(dur=6, typ="16th", **TIE_STOP) + A.rest(12, "eighth")
               + A.note(dur=72, typ="half").replace("<type>half</type>", "<type>half</type><dot/>") + lh())
        r, v = reasons([bar])
        self.assertEqual(r["tie.MERGEABLE_DEFECT"], 1)
        self.assertEqual(v["nq.tie.mergeable.defect"], 1.0)

    def test_a_clean_triplet_length_without_time_modification_is_unexpected(self):
        # a whole beat of triplet eighths, the last a rest without <time-modification>: nothing keeps G3a from writing it
        bar = (tnote("C", notations='<tuplet type="start"/>') + tnote("D") + A.rest(8, "eighth")
               + A.note(dur=72, typ="half").replace("<type>half</type>", "<type>half</type><dot/>") + lh())
        r, v = reasons([bar])
        self.assertEqual(r["tm.unexpected"], 1)
        self.assertEqual(r["tm.r17"], 0)
        self.assertEqual(v["nq.shape.tm_missing.unexpected"], 1.0)

    def test_a_release_one_tick_off_the_triplet_grid_is_r17(self):
        # triplet eighths written as plain lengths (no time-modification), the second released one tick (1/96 W) early
        bar = (A.note("C", dur=8, typ="eighth") + A.note("D", dur=7, typ="eighth") + A.rest(1, "64th")
               + A.note("E", dur=8, typ="eighth")
               + A.note(dur=72, typ="half").replace("<type>half</type>", "<type>half</type><dot/>") + lh())
        r, v = reasons([bar])
        self.assertEqual(r["tm.r17"], 4)
        self.assertEqual(r["tm.unexpected"], 0)
        self.assertEqual(v["nq.shape.tm_missing"], 4.0)

    def test_an_onset_off_both_grids_is_not_r17(self):
        # an onset on the binary grid among triplet ones: the quantizer's, not a release G3b could move
        bar = (A.note("C", dur=8, typ="eighth") + A.note("D", dur=4, typ="16th") + A.note("F", dur=4, typ="16th")
               + A.note("E", dur=8, typ="eighth")
               + A.note(dur=72, typ="half").replace("<type>half</type>", "<type>half</type><dot/>") + lh())
        r, _ = reasons([bar])
        self.assertEqual(r["tm.r17"], 0)
        self.assertEqual(r["tm.unexpected"], 4)

    def test_a_double_dotted_value_off_the_beat_is_required_h7(self):
        # 96 divisions: r16, then 16~32. from the second 16th (joined: a double-dotted 16th that neither starts nor
        # completes a beat), r32 r32.
        bar = (A.rest(24, "16th") + A.note(dur=24, typ="16th", **TIE_START)
               + A.note(dur=18, typ="32nd", **TIE_STOP).replace("<type>32nd</type>", "<type>32nd</type><dot/>")
               + A.rest(12, "32nd") + A.rest(18, "32nd") + A.note(dur=288, typ="half").replace("<type>half</type>", "<type>half</type><dot/>")
               + lh(384))
        r, v = reasons([bar], divisions=96)
        self.assertEqual(r["tie.REQUIRED_H7"], 1)
        self.assertEqual(r["tie.MERGEABLE_DEFECT"], 0)
        self.assertGreater(v["nq.tie.mergeable_rate"], 0)

    def test_a_tie_out_of_a_bracket_is_required_h6(self):
        # triplet 16ths C D E, E tied to a triplet eighth F in the next bracket: joined 1/2 quarter, but F is in
        # another group
        bar = (tnote("C", "16th", 4, '<tuplet type="start"/>') + tnote("D", "16th", 4)
               + tnote("E", "16th", 4, '<tuplet type="stop"/><tied type="start"/>', extra='<tie type="start"/>')
               + tnote("E", "eighth", 8, '<tuplet type="start"/><tied type="stop"/>', extra='<tie type="stop"/>')
               + A.rest(4, "16th", tm=True).replace("</note>", '<notations><tuplet type="stop"/></notations></note>')
               + A.note(dur=72, typ="half").replace("<type>half</type>", "<type>half</type><dot/>") + lh())
        r, _ = reasons([bar])
        self.assertEqual(r["tie.REQUIRED_H6"], 1)
        self.assertEqual(r["tie.MERGEABLE_DEFECT"], 0)

    def test_a_pickup_tie_that_would_hide_a_beat_is_required(self):
        # a pickup of 3.5 quarters (offset an eighth): 16~8 from its second 16th is inside one beat of the bar's own
        # frame (the metric's), but in the full bar's frame it runs from the 4th 16th over beat 2
        bar = (A.rest(6, "16th") + A.note(dur=6, typ="16th", **TIE_START) + A.note(dur=12, typ="eighth", **TIE_STOP)
               + A.note(dur=48, typ="half") + A.note(dur=12, typ="eighth")
               + "<backup><duration>84</duration></backup>" + A.note("C", 3, 48, "half", staff=2, voice=5)
               + A.note("C", 3, 36, "quarter", staff=2, voice=5).replace("<type>quarter</type>", "<type>quarter</type><dot/>"))
        r, _ = reasons([bar, A.note(dur=96, typ="whole") + lh()], implicit=True)
        self.assertEqual(r["tie.REQUIRED_BEAT_SPLIT"], 1)
        self.assertEqual(r["tie.MERGEABLE_DEFECT"], 0)

    def test_a_chord_only_partly_tied_is_required(self):
        # C+E eighth, only C tied to the next eighth (C alone): one symbol would change what sounds (U-2)
        bar = (A.note("C", dur=12, typ="eighth", **TIE_START) + A.note("E", dur=12, typ="eighth", chord=True)
               + A.note("C", dur=12, typ="eighth", **TIE_STOP)
               + A.note(dur=72, typ="half").replace("<type>half</type>", "<type>half</type><dot/>") + lh())
        r, v = reasons([bar])
        self.assertEqual(r["tie.PARTIAL_CHORD_REQUIRED"], 1)
        self.assertEqual(r["tie.MERGEABLE_DEFECT"], 0)
        self.assertEqual(v["nq.tie.mergeable.partial_chord"], 1.0)


class ReasonAwareGate(unittest.TestCase):
    ZERO = {k: 0.0 for k in NQ.REASONS}

    def results(self, **m):
        base = dict(self.ZERO, **{"notation.hand.accuracy": 0.95, "critical.hands": 1.0, "critical.key": 1.0,
                                  "notation.spelling.accuracy": 1.0})
        base.update(m)
        return {"cases": [{"id": "x", "status": "ok", "metrics": base}]}

    def baseline(self):
        return {"cases": {"x": {"metrics": {"critical.hands": 1.0, "critical.key": 1.0, "notation.spelling.accuracy": 1.0}}}}

    def r17(self, **counts):
        return {"schema": g3gate.R17_SCHEMA, "cases": {"x": counts} if counts else {}}

    def passes(self, results, r17):
        return all(ok for _, ok, _ in g3gate.evaluate(results, self.baseline(), r17))

    def test_a_clean_run_passes(self):
        self.assertTrue(self.passes(self.results(), self.r17()))

    def test_legitimate_splits_and_recorded_r17_pass(self):
        # proof 4: mergeable ties an H6 or H7 rule, a beat, a partial chord or R17 requires; R17 residuals as recorded
        ok = self.results(**{"nq.tie.mergeable_rate": 0.4, "nq.tie.mergeable.required_h6": 3.0,
                             "nq.tie.mergeable.required_h7": 5.0, "nq.tie.mergeable.required_beat_split": 1.0,
                             "nq.tie.mergeable.partial_chord": 2.0, "nq.tie.mergeable.r17": 1.0,
                             "nq.shape.tm_missing": 6.0, "nq.shape.tm_missing.r17": 6.0,
                             "nq.tuplet.one_note_rate": 0.2, "nq.tuplet.one_note.r17": 2.0})
        self.assertTrue(self.passes(ok, self.r17(tm=6, one=2, tie=1)))

    def test_the_three_failures(self):
        # proofs 1-3: a true mergeable defect, a non-R17 triplet length without time-modification, R17 above baseline
        for bad in ({"nq.tie.mergeable.defect": 1.0}, {"nq.shape.tm_missing.unexpected": 1.0},
                    {"nq.tuplet.one_note.unexpected": 1.0}, {"nq.shape.tm_missing.r17": 7.0},
                    {"nq.tuplet.one_note.r17": 3.0}, {"nq.tie.mergeable.r17": 2.0}):
            lines = g3gate.evaluate(self.results(**bad), self.baseline(), self.r17(tm=6, one=2, tie=1))
            self.assertFalse(all(ok for _, ok, _ in lines), bad)
            self.assertIn("G3 gate: FAIL", g3gate.format_lines(lines))

    def test_no_r17_baseline_or_no_reason_split_fails(self):
        self.assertFalse(self.passes(self.results(), None))
        old = {"cases": [{"id": "x", "status": "ok", "metrics": {"nq.shape.tm_missing": 0.0, "notation.hand.accuracy": 0.95}}]}
        self.assertFalse(self.passes(old, self.r17()))

    def test_the_other_lines_still_fail_on_their_own(self):
        for bad in ({"notation.hand.accuracy": 0.88}, {"critical.hands": 0.0}, {"critical.key": 0.0},
                    {"notation.spelling.accuracy": 0.9}):
            self.assertFalse(self.passes(self.results(**bad), self.r17()), bad)

    def test_hold_out_cases_are_held_as_one_pool(self):
        # G00 §17 m10: no per-case hold-out value is kept or printed; their R17 sum may not grow
        def res(*counts):
            rows = []
            for i, n in enumerate(counts):
                m = dict(self.ZERO, **{"notation.hand.accuracy": 0.95, "nq.shape.tm_missing.r17": float(n)})
                rows.append({"id": f"h{i}", "status": "ok", "tags": ["holdout"], "metrics": m})
            return {"cases": rows}
        r17 = {"schema": g3gate.R17_SCHEMA, "cases": {}, "holdout": {"tm": 5, "one": 0, "tie": 0}}
        base = {"cases": {}}
        ok = lambda r: all(x for _, x, _ in g3gate.evaluate(r, base, r17))  # noqa: E731
        self.assertTrue(ok(res(2, 3)))
        self.assertTrue(ok(res(5, 0)))            # moved between hold-out cases: the pool is what is held
        lines = g3gate.evaluate(res(3, 3), base, r17)
        self.assertFalse(all(x for _, x, _ in lines))
        self.assertIn("hold-out cases, pooled", g3gate.format_lines(lines))
        self.assertNotIn("h0", g3gate.format_lines(lines))

    def test_a_run_with_a_defect_cannot_become_the_r17_baseline(self):
        ok, msg = g3gate.record_r17(self.results(**{"nq.shape.tm_missing.unexpected": 2.0}), {}, "unit-test", "test")
        self.assertFalse(ok)
        self.assertIn("cannot be the R17 allowance", msg)


if __name__ == "__main__":
    unittest.main()
