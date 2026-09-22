import io
import os
import unittest
from contextlib import redirect_stdout

from pppbench import golden, mutation, stages, util


class Golden(unittest.TestCase):
    def test_every_case_has_committed_input_and_expected_output(self):
        suite = util.load_json(os.path.join(util.bench_root(), "suites", "golden.json"))
        self.assertEqual(len(suite["cases"]), 17)
        sources = " ".join(c["source"] for c in suite["cases"])
        for needed in ("|pedal|", "|amt|", "|rubato|", "method/", "grid:"):   # §17 m13: not only easy micro cases
            self.assertIn(needed, sources)
        for c in suite["cases"]:
            for p in golden._paths(c["key"]) + golden._extra_paths(c["key"]):
                self.assertTrue(os.path.exists(p), p)

    def _row(self, key):
        data = util.load_json(golden._paths(key)[0])
        return stages.notate_batch([{"id": key, "input": data["input"], "opts": data.get("opts") or {}}])["results"][key]

    def test_structural_change_is_labelled_not_a_crash(self):
        # §17 M7: an extra bar changes the bar count; reader/1's reporter crashed with KeyError here.
        # §19 F3: a bar added is a change of the frame, STRUCTURAL_CHANGE
        case = {"key": "G01", "source": "micro/M01-waltz-3-4|deadpan|none|s1"}
        row = self._row("G01")
        self.assertEqual(golden._check_case(case, row)[0], "ok")
        extra = ('<measure number="99"><note><rest measure="yes"/><duration>72</duration><voice>1</voice><staff>1</staff>'
                 '</note></measure></part>')
        stats = dict(row["stats"], bars=row["stats"]["bars"] + 1,
                     barStarts=row["stats"]["barStarts"] + [row["stats"]["barStarts"][-1] + 1.0])
        label, lines = golden._check_case(case, dict(row, xml=row["xml"].replace("</part>", extra), stats=stats))
        self.assertEqual(label, "STRUCTURAL_CHANGE")
        text = "\n".join(lines)
        self.assertIn("bars:", text)
        self.assertIn("metric struct.measures.extra_empty_edge: 0.0 -> 1.0", text)

    def test_bar_times_alone_are_a_semantic_change(self):
        # the MusicXML is untouched but the bar times the app syncs audio with are a beat late
        # (FIX-STATS-LATE-BARS); golden reported that as identical before the fixer's final pass
        case = {"key": "G01", "source": "micro/M01-waltz-3-4|deadpan|none|s1"}
        row = self._row("G01")
        late = [round(t + 0.5, 3) for t in row["stats"]["barStarts"]]
        label, lines = golden._check_case(case, dict(row, stats=dict(row["stats"], barStarts=late)))
        self.assertEqual(label, "SEMANTIC_CHANGE")
        text = "\n".join(lines)
        self.assertIn("stats.barStarts:", text)
        self.assertIn("first difference at [0]", text)

    def test_serialisation_only_change_is_labelled_as_such(self):
        case = {"key": "G01", "source": "micro/M01-waltz-3-4|deadpan|none|s1"}
        row = self._row("G01")
        reformatted = row["xml"].replace("<note>", "<note >").replace("\n", "\n  ")
        self.assertEqual(golden._check_case(case, dict(row, xml=reformatted))[0], "SERIALIZATION_ONLY")

    def test_unreadable_output_fails_without_crashing(self):
        case = {"key": "G01", "source": "micro/M01-waltz-3-4|deadpan|none|s1"}
        row = self._row("G01")
        label, lines = golden._check_case(case, dict(row, xml=row["xml"][: len(row["xml"]) // 2]))
        self.assertEqual(label, "FAIL")
        self.assertIn("not readable MusicXML", lines[0])

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
            for find, _ in mutation.edits(m):
                self.assertEqual(src.count(find), 1, m["id"])
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
