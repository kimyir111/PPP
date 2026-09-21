import io
import os
import unittest
from contextlib import redirect_stdout

from pppbench import golden, mutation, stages, util


class Golden(unittest.TestCase):
    def test_every_case_has_committed_input_and_expected_output(self):
        suite = util.load_json(os.path.join(util.bench_root(), "suites", "golden.json"))
        self.assertEqual(len(suite["cases"]), 14)
        for c in suite["cases"]:
            for p in golden._paths(c["key"]):
                self.assertTrue(os.path.exists(p), p)

    def test_diff_names_the_measure(self):
        a = '<score-partwise><measure number="1"><note>C</note></measure><measure number="2"><note>D</note></measure></score-partwise>'
        b = a.replace("<note>D</note>", "<note>E</note>")
        d = "\n".join(golden.xml_diff(a, b))
        self.assertIn("expected measure 2", d)
        self.assertIn("-<note>D</note>", d)
        self.assertNotIn("measure 1", d)
        self.assertEqual(golden.xml_diff(a, a), [])

    def test_bless_needs_a_reason(self):
        with redirect_stdout(io.StringIO()):
            self.assertEqual(golden.run_golden(bless=True, reason=None), 2)

    def test_stats_subset(self):
        s = golden.stats_subset({"bars": 4, "key": {"fifths": 1, "mode": "major"}, "arrangement": None, "extra": 1})
        self.assertEqual(s["key.fifths"], 1)
        self.assertIsNone(s["arrangement.level"])
        self.assertNotIn("extra", s)

    def test_golden_passes_on_the_current_sut(self):
        buf = io.StringIO()
        with redirect_stdout(buf):
            self.assertEqual(golden.run_golden(), 0, buf.getvalue())


class Mutation(unittest.TestCase):
    def test_every_anchor_occurs_exactly_once(self):
        src = util.normalise_eol(util.read_text(stages.default_audio_score()).encode("utf-8")).decode("utf-8")
        for m in mutation.MUTATIONS:
            self.assertEqual(src.count(m["find"]), 1, m["id"])
            self.assertNotEqual(mutation.apply_mutation(src, m), src)

    def test_missing_anchor_is_an_explicit_error(self):
        with self.assertRaises(mutation.AnchorMissing):
            mutation.apply_mutation("no anchors here", mutation.MUTATIONS[0])

    def test_mutant_is_a_copy(self):
        path = mutation.write_mutant(mutation.MUTATIONS[-1], stages.default_audio_score())
        self.assertTrue(path.startswith(mutation.MUT_DIR))
        self.assertIn("/* noop mutation */", util.read_text(path))
        self.assertNotIn("noop mutation", util.read_text(stages.default_audio_score()))


if __name__ == "__main__":
    unittest.main()
