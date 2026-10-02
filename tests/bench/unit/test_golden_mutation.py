import io
import os
import re
import unittest
from contextlib import redirect_stdout

from pppbench import golden, mutation, stages, suite as suite_mod, util


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
        div = int(re.search(r"<divisions>(\d+)</divisions>", row["xml"]).group(1))   # the file's own (G1: the fewest)
        extra = (f'<measure number="99"><note><rest measure="yes"/><duration>{3 * div}</duration><voice>1</voice><staff>1</staff>'
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
        root = os.path.dirname(stages.default_audio_score())
        for m in mutation.MUTATIONS + mutation.REC_MUTATIONS:
            with open(os.path.join(root, *mutation.target(m).split("/")), "rb") as handle:
                src = util.normalise_eol(handle.read()).decode("utf-8")
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


class RecMutations(unittest.TestCase):
    """G10a-0: every recording metric has a planted defect that must be flagged by name (mutation-check --rec)."""

    def test_every_recording_metric_is_named_by_a_mutation(self):
        from tools import make_rec_suites
        named = {x for m in mutation.REC_MUTATIONS for x in m["metrics"]}
        for metric in make_rec_suites.REC_GATE:
            self.assertIn(metric, named, metric)
        for m in mutation.REC_MUTATIONS:
            if m["expect"] == "REGRESSION":
                self.assertTrue(any(x.startswith("rec.") for x in m["metrics"]), m["id"])

    def test_every_v2_decision_has_a_planted_defect(self):
        """G10a-1: the time skeleton's decisions (metre, bar lines, tempo octave, the compound tempo of issue 1, the helper's
        beats, the on-beat quantiser fix) each have a mutation that must be flagged on a critical gate or a structure metric."""
        v2 = mutation.REC_V2_MUTATIONS
        self.assertEqual({m["id"] for m in v2[:-1]}, {"REC-V2-NO-ACCENTS", "REC-V2-BAR-LINE-LATE", "REC-V2-HALF-TEMPO", "REC-V2-ISSUE-1-BACK",
                                                      "REC-V2-NO-AUDIO-BEATS", "REC-V2-LATE-ON-BEAT"})
        self.assertEqual((v2[-1]["id"], v2[-1]["expect"]), ("MUT-NOOP", "PASS"))
        self.assertFalse([m for m in mutation.REC_MUTATIONS if m.get("v2")])
        for m in v2[:-1]:
            self.assertEqual(m["expect"], "REGRESSION")
            self.assertTrue(any(x.startswith(("critical.", "struct.", "notes.")) for x in m["metrics"]), m["id"])

    def test_ids_are_unique_and_the_noop_is_last(self):
        ids = [m["id"] for m in mutation.REC_MUTATIONS]
        self.assertEqual(len(ids), len(set(ids)))
        self.assertEqual(mutation.REC_MUTATIONS[-1]["id"], "MUT-NOOP")
        self.assertEqual(mutation.REC_MUTATIONS[-1]["expect"], "PASS")

    def test_the_suite_exists_and_asks_for_the_recording_metrics(self):
        s = suite_mod.load_suite("rec-mutation")
        self.assertTrue(s["rec"])
        for k in make_rec_gate_keys():
            self.assertIn(k, s["gate"]["metrics"], k)


def make_rec_gate_keys():
    from tools import make_rec_suites
    return make_rec_suites.REC_GATE.keys()


if __name__ == "__main__":
    unittest.main()
