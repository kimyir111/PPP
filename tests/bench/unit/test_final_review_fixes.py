"""Regression tests for the final independent review's findings (docs/GOALS/G00 §19).

F1: tempo, metre and key are judged over the whole score, not only by their first value.
F2: printed note shapes, complete bars, bar numbers (and clefs) are measured.
F3: golden never calls a change of structure or music "serialization only".
m1: PredTime maps positions with the SUT's own beat model (a bar before the first beat).
Usable: note values are part of the verdict."""

import re
import unittest
from fractions import Fraction

from pppbench import corpus, evaluate, golden, known_defects, musicxml, mutation, perform, stages, util
from pppbench.metrics import critical, readability, structure
from pppbench.timemap import PredTime, extend_beats
from unit.helpers import canon, measure, note, rest

BAR = re.compile(r'<measure number="(\d+)">')


def case(ref_id, profile="deadpan", beats="oracle"):
    e = corpus.by_id(corpus.load_corpus())[ref_id]
    c = corpus.read_reference(e)
    p = perform.perform(c, ref_id, profile, beats, 1, expect=e.expect)
    row = stages.notate_batch([{"id": "x", "input": p.input, "opts": p.opts}])["results"]["x"]
    return e, c, p, row


def metrics(e, c, p, row, xml=None):
    r = dict(row, xml=xml if xml is not None else row["xml"])
    return evaluate.evaluate_timed(c, p, r, skip_metrics=e.expect.get("skip_metrics", ()))[0]


def insert_at_bar(xml, number, text):
    """Insert ``text`` at the start of bar ``number`` (1-based)."""
    m = re.search(rf'<measure number="{number}">', xml)
    return xml[:m.end()] + text + xml[m.end():]


class WholeScoreSequences(unittest.TestCase):
    """F1: a wrong tempo, metre or key signature late in the piece is a regression."""

    @classmethod
    def setUpClass(cls):
        cls.e, cls.c, cls.p, cls.row = case("micro/M01-waltz-3-4")
        cls.good = metrics(cls.e, cls.c, cls.p, cls.row)
        cls.bars = len(BAR.findall(cls.row["xml"]))

    def test_the_sut_output_is_right_throughout(self):
        for k in ("struct.tempo.timeline_accuracy", "struct.time_sig.timeline_accuracy", "struct.key.timeline_accuracy"):
            self.assertEqual(self.good[k], 1.0, k)
        self.assertEqual(self.good["critical.playback_tempo"], 1.0)

    def test_tempo_halved_midway(self):
        mid = self.bars // 2 + 1
        bpm = int(re.search(r'<sound tempo="([\d.]+)"', self.row["xml"]).group(1))
        mark = (f'<direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>{bpm // 2}'
                f'</per-minute></metronome></direction-type><staff>1</staff><sound tempo="{bpm // 2}"/></direction>')
        bad = metrics(self.e, self.c, self.p, self.row, insert_at_bar(self.row["xml"], mid, mark))
        self.assertEqual(bad["struct.tempo.ok_effective"], 1.0)          # the first mark is still right
        self.assertLess(bad["struct.tempo.timeline_accuracy"], 0.95)      # the player's second half is not
        self.assertEqual(bad["critical.playback_tempo"], 0.0)
        self.assertEqual(bad["usable"], 0.0)

    def test_late_metre_change(self):
        tail = 2 * self.bars // 3 + 1
        bad = metrics(self.e, self.c, self.p, self.row,
                      insert_at_bar(self.row["xml"], tail, "<attributes><time><beats>6</beats><beat-type>8</beat-type></time></attributes>"))
        self.assertEqual(bad["struct.time_sig.exact"], 1.0)               # the main metre is still 3/4
        self.assertLess(bad["struct.time_sig.timeline_accuracy"], 0.95)
        self.assertEqual(bad["critical.meter"], 0.0)

    def test_late_key_change(self):
        tail = 2 * self.bars // 3 + 1
        bad = metrics(self.e, self.c, self.p, self.row,
                      insert_at_bar(self.row["xml"], tail, "<attributes><key><fifths>3</fifths><mode>major</mode></key></attributes>"))
        self.assertEqual(bad["struct.key.fifths_exact"], 1.0)             # bar 1 is still right
        self.assertLess(bad["struct.key.timeline_accuracy"], 0.95)
        self.assertEqual(bad["critical.key"], 0.0)

    def test_the_player_follows_the_later_mark_at_one_position(self):
        # verified in the app (G00 §20): 6/8 output with <sound tempo="60"> and a dotted-quarter mark of 60 plays
        # at 90 qpm (PianoScore.tempoMap keeps the metronome, read after the sound); Score.tempo is 60
        e, c, p, row = case("micro/M03-jig-6-8", "deadpan", "none")
        m = metrics(e, c, p, row)
        pred = musicxml.read_score(row["xml"])
        self.assertEqual(structure.app_tempo_timeline(pred)[-1][1], 90.0)
        self.assertEqual(pred.app_qpm, 60)
        self.assertEqual(m["struct.tempo.timeline_accuracy"], 1.0)
        self.assertEqual(m["struct.tempo.ok_effective"], 0.0)
        self.assertEqual(m["critical.playback_tempo"], 0.0)             # practice tempo and metronome are 2/3

    def test_a_real_key_change_is_judged_bar_by_bar(self):
        e, c, p, row = case("method/burgmuller25/015", "deadpan", "oracle")
        self.assertGreater(len({x.fifths for x in c.measures}), 1)
        m = metrics(e, c, p, row)
        self.assertEqual(m["struct.key.fifths_exact"], 1.0)
        self.assertLess(m["struct.key.timeline_accuracy"], 0.95)          # the SUT writes one key for the piece
        self.assertEqual(m["critical.key"], 0.0)

    def test_an_untrusted_key_is_not_trusted_bar_by_bar_either(self):
        rid = next(r.id for r in corpus.load_corpus() if "struct.key.fifths_exact" in r.expect.get("skip_metrics", ()))
        e, c, p, row = case(rid, "deadpan", "oracle")
        m = metrics(e, c, p, row)
        self.assertIsNone(m["struct.key.fifths_exact"])
        self.assertIsNone(m["struct.key.timeline_accuracy"])
        self.assertIsNone(m["critical.key"])


class NoteShapesBarsAndNumbers(unittest.TestCase):
    """F2: what the app draws from <type>/<dot>, <rest> and <measure number>, and the clef."""

    @classmethod
    def setUpClass(cls):
        cls.e, cls.c, cls.p, cls.row = case("micro/M10-dotted")
        cls.good = metrics(cls.e, cls.c, cls.p, cls.row)

    def test_the_sut_output_is_consistent(self):
        self.assertEqual(self.good["notation.note_shape.consistency"], 1.0)
        self.assertEqual(self.good["read.bar_completeness"], 1.0)
        self.assertEqual(self.good["struct.measure_numbers.valid"], 1.0)
        self.assertEqual(self.good["struct.measure_numbers.app_onset_accuracy"], 1.0)

    def test_dots_removed(self):
        xml = re.sub(r"(<note>(?:(?!</note>).)*?<pitch>(?:(?!</note>).)*?)<dot/>", r"\1", self.row["xml"], flags=re.S)
        self.assertNotEqual(xml, self.row["xml"])
        bad = metrics(self.e, self.c, self.p, self.row, xml)
        self.assertEqual(bad["notation.duration.accuracy"], self.good["notation.duration.accuracy"])   # it plays the same
        self.assertLess(bad["notation.note_shape.consistency"], 1.0)
        self.assertLess(bad["notation.duration.page_accuracy"], self.good["notation.duration.page_accuracy"])

    def test_note_type_changed(self):
        xml = self.row["xml"].replace("<type>quarter</type>", "<type>eighth</type>")
        bad = metrics(self.e, self.c, self.p, self.row, xml)
        self.assertLess(bad["notation.duration.page_accuracy"], self.good["notation.duration.page_accuracy"])
        self.assertLess(bad["notation.note_shape.consistency"], 1.0)

    def test_bar_numbers_repeated_skipped_or_reordered(self):
        n = iter(range(10 ** 6))
        restart = BAR.sub(lambda m: f'<measure number="{next(n) % 4 + 1}">', self.row["xml"])
        bad = metrics(self.e, self.c, self.p, self.row, restart)
        self.assertEqual(bad["struct.measure_numbers.valid"], 0.0)
        self.assertLess(bad["struct.measure_numbers.app_onset_accuracy"], 1.0)   # the app lays bars over each other
        self.assertEqual(bad["critical.structure"], 0.0)
        for new in ((lambda k: k + 1 if k < 3 else k + 2), (lambda k: {2: 3, 3: 2}.get(k, k))):
            xml = BAR.sub(lambda m: f'<measure number="{new(int(m.group(1)))}">', self.row["xml"])
            bad = metrics(self.e, self.c, self.p, self.row, xml)
            self.assertEqual(bad["struct.measure_numbers.valid"], 0.0)
            self.assertEqual(bad["struct.measure_numbers.app_onset_accuracy"], 1.0)   # unique: placed right, numbered wrong
            self.assertEqual(bad["critical.structure"], 0.0)

    def test_a_short_rest_leaves_a_bar_incomplete(self):
        c = canon([measure(note("C", 5, 4), note("C", 3, 4, staff=2), number=1, rh_len=4),
                   measure(note("D", 5, 1) + rest(2), note("C", 3, 4, staff=2), number=2, rh_len=3),
                   measure(note("E", 5, 4), note("C", 3, 4, staff=2), number=3, rh_len=4)])
        self.assertEqual(readability.bar_completeness_detail(c)["bad"], [{"bar": 2, "kind": "staff short"}])
        # the two halves of a bar split at a repeat are one whole bar
        repeat = '<barline location="right"><bar-style>light-heavy</bar-style><repeat direction="backward"/></barline>'
        split = canon([measure(note("C", 5, 4), number=1), measure(note("D", 5, 2) + repeat, number=2),
                       measure(note("E", 5, 2), number=3), measure(note("F", 5, 4), number=4)], staves=1)
        self.assertEqual(readability.bar_completeness_detail(split)["bad"], [])
        # ... but not without one (G00 §21 S-m2: two short bars are not a split because they add up)
        fake = canon([measure(note("C", 5, 4), number=1), measure(note("D", 5, 2), number=2),
                      measure(note("E", 5, 2), number=3), measure(note("F", 5, 4), number=4)], staves=1)
        self.assertEqual(readability.bar_completeness_detail(fake)["bad"],
                         [{"bar": 2, "kind": "bar short"}, {"bar": 3, "kind": "bar short"}])

    def test_bass_staff_in_treble_clef(self):
        xml = self.row["xml"].replace('<clef number="2"><sign>F</sign><line>4</line></clef>',
                                      '<clef number="2"><sign>G</sign><line>2</line></clef>')
        bad = metrics(self.e, self.c, self.p, self.row, xml)
        self.assertGreater(bad["read.ledger_lines.heavy_rate"], self.good["read.ledger_lines.heavy_rate"])

    def test_committed_scores(self):
        k = known_defects.audit()["classes"]
        self.assertEqual(k["bar_numbering"]["files_affected"], 0)        # every committed score counts up by one
        self.assertEqual(k["note_shape_mismatch"]["status"], "KNOWN_FAILURE")
        self.assertIn("catalog/fur-elise.musicxml", k["note_shape_mismatch"]["examples"])


class GoldenClassification(unittest.TestCase):
    """F3: only formatting may be SERIALIZATION_ONLY."""

    KEY = "G15"

    @classmethod
    def setUpClass(cls):
        suite = util.load_json(util.bench_root() + "/suites/golden.json")
        cls.case = next(c for c in suite["cases"] if c["key"] == cls.KEY)
        data = util.load_json(golden._paths(cls.KEY)[0])
        cls.row = stages.notate_batch([{"id": "g", "input": data["input"], "opts": data.get("opts") or {}}])["results"]["g"]

    def label(self, xml):
        self.assertNotEqual(xml, self.row["xml"])
        return golden._check_case(self.case, dict(self.row, xml=xml))[0]

    def test_unchanged(self):
        self.assertEqual(golden._check_case(self.case, self.row)[0], "ok")

    def test_formatting_and_voice_numbers_are_serialization_only(self):
        self.assertEqual(self.label(self.row["xml"].replace("<note>", "<note >")), "SERIALIZATION_ONLY")
        self.assertEqual(self.label(self.row["xml"].replace("<voice>5</voice>", "<voice>2</voice>")), "SERIALIZATION_ONLY")

    def test_dot_type_and_rest_changes_are_semantic(self):
        x = self.row["xml"]
        self.assertIn("<dot/>", x)
        self.assertEqual(self.label(x.replace("<dot/>", "", 1)), "SEMANTIC_CHANGE")
        self.assertEqual(self.label(x.replace("<type>quarter</type>", "<type>eighth</type>", 1)), "SEMANTIC_CHANGE")
        rest_el = re.search(r"<note><rest/>.*?<type>([a-z0-9]+)</type>", x, re.S)
        self.assertIsNotNone(rest_el)
        swapped = x[:rest_el.start(1)] + ("whole" if rest_el.group(1) != "whole" else "half") + x[rest_el.end(1):]
        self.assertEqual(self.label(swapped), "SEMANTIC_CHANGE")

    def test_clef_staff_and_bar_number_changes_are_structural(self):
        x = self.row["xml"]
        self.assertEqual(self.label(x.replace('<clef number="2"><sign>F</sign><line>4</line></clef>',
                                              '<clef number="2"><sign>G</sign><line>2</line></clef>')), "STRUCTURAL_CHANGE")
        self.assertEqual(self.label(x.replace('<measure number="2">', '<measure number="1">', 1)), "STRUCTURAL_CHANGE")
        # one note of the left hand moved to the treble staff
        first_lh = re.search(r"(<note>(?:(?!</note>).)*?<pitch>(?:(?!</note>).)*?<staff>)2(</staff>)", x, re.S)
        moved = x[:first_lh.start(1)] + first_lh.group(1) + "1" + first_lh.group(2) + x[first_lh.end():]
        self.assertEqual(self.label(moved), "STRUCTURAL_CHANGE")


class PredTimeFollowsTheSutBeatModel(unittest.TestCase):
    """m1: a bar that reaches past the tracked beats (a pickup written as a full bar) is mapped with the
    SUT's extended grid, not by spreading the few beats inside it over the whole bar."""

    def test_full_first_bar_before_the_first_beat(self):
        pred = canon([measure(rest(3) + note("C", 5, 1), number=1), measure(note("D", 5, 4), number=2)], staves=1)
        beat = 0.6
        beats = [1.0 + k * beat for k in range(6)]                 # the first tracked beat is the pickup's
        stats = {"barStarts": [1.0 - 3 * beat, 1.0 + beat, 1.0 + 5 * beat], "beats": beats}
        pt = PredTime(pred, stats)
        self.assertAlmostEqual(pt.sec(0, Fraction(3)), 1.0)         # reader/2 said 1.0 + beat / 2
        self.assertAlmostEqual(pt.sec(0, Fraction(0)), 1.0 - 3 * beat)
        self.assertAlmostEqual(pt.sec(1, Fraction(2)), 1.0 + 3 * beat)

    def test_bar_lines_between_beats(self):
        # dotted-quarter beats every 0.9 s (1.5 q), bars of 3 q starting a third of a beat after a beat
        pred = canon([measure(note("C", 5, 6), number=1), measure(note("D", 5, 6), number=2)], divisions=2, time=(6, 8),
                     staves=1)
        stats = {"barStarts": [0.3, 2.1, 3.9], "beats": [0.0, 0.9, 1.8, 2.7, 3.6, 4.5]}
        pt = PredTime(pred, stats)
        for q in (0, 1, Fraction(3, 2), 2):
            self.assertAlmostEqual(pt.sec(0, Fraction(q)), 0.3 + float(q) * 0.6)

    def test_extend_beats(self):
        self.assertEqual(extend_beats([2.0, 2.5, 3.0], 1.0, 4.0), [1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0])
        self.assertEqual(extend_beats([2.0], 1.0, 4.0), [2.0])

    def test_golden_g05_pickup_note_is_on_its_beat(self):
        data = util.load_json(golden._paths("G05")[0])
        row = stages.notate_batch([{"id": "g", "input": data["input"], "opts": data.get("opts") or {}}])["results"]["g"]
        pred = musicxml.read_score(row["xml"])
        pt = PredTime(pred, row["stats"])
        first = min(pred.played(), key=lambda s: s.onset_q)
        self.assertAlmostEqual(pt.sec(first.measure, first.pos_q), data["input"]["beats"][0], places=2)


class UsableNeedsTheRightNoteValues(unittest.TestCase):
    """The usable verdict includes note values (G00 §19 usable-duration)."""

    def test_gate(self):
        conds = dict((k, t) for k, _, t in critical.GATES["critical.note_values"][0])
        self.assertEqual(conds, {"notation.duration.accuracy": 0.80, "notation.duration.page_accuracy": 0.80})

    def test_written_as_32nds_and_rests_is_not_usable(self):
        e, c, p, row = case("method/czerny599/049", "human", "none")
        m = metrics(e, c, p, row)
        self.assertLess(m["notation.duration.accuracy"], 0.8)
        self.assertEqual(m["critical.note_values"], 0.0)
        self.assertEqual(m["usable"], 0.0)
        self.assertEqual(m["critical.meter"], 1.0)                        # everything else about it is right
        self.assertEqual(m["critical.beat_placement"], 1.0)


class FixtureSuitesCompareWhatTheyWrite(unittest.TestCase):
    """replay-public compared unrounded results with its 6-decimal baseline; on a zero-tolerance metric
    a residue of 1e-7 would have been a regression (seen as a +0.000000 'improvement' while fixing §19)."""

    def test_replay_compares_rounded_results(self):
        import io
        import types
        from contextlib import redirect_stdout
        from pppbench import compare, private, suite as suite_mod
        seen = []
        orig = compare.compare

        def spy(results, baseline, gate):
            seen.append(results)
            return orig(results, baseline, gate)
        compare.compare = spy
        try:
            with redirect_stdout(io.StringIO()):
                private.run_private(suite_mod.load_suite("replay-public"),
                                    types.SimpleNamespace(audio_score=None, out=util.bench_root() + "/out/unit-replay"))
        finally:
            compare.compare = orig
        self.assertTrue(seen)
        self.assertEqual(seen[0], util.load_json_text(util.dumps_json(seen[0])))


class NewMutations(unittest.TestCase):
    def test_final_review_mutations_are_checked(self):
        ids = {m["id"]: m for m in mutation.MUTATIONS}
        for mid in ("FIN-TEMPO-HALVED-MIDWAY", "FIN-METRE-TAIL", "FIN-KEY-TAIL", "FIN-DOTS-DROPPED", "FIN-NOTE-TYPE-SHORTER",
                    "FIN-LONG-NOTES-HALVED", "FIN-BAR-NUMBERS-RESTART", "FIN-BAR-NUMBERS-SKIP", "FIN-BAR-NUMBERS-SWAP",
                    "FIN-BASS-STAFF-TREBLE-CLEF", "FIN-TRAILING-RESTS-SHORT", "FIN-REST-TYPE-LONGER",
                    "FIN-ACCIDENTAL-ON-EVERY-NOTE"):
            self.assertEqual(ids[mid]["expect"], "REGRESSION", mid)
            self.assertTrue(ids[mid]["metrics"], mid)


if __name__ == "__main__":
    unittest.main()
