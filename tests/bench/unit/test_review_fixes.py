"""Regression tests for the G0 independent-review findings (docs/GOALS/G00 §17).

Each test damages one thing a user sees in real toMusicXml output, or feeds the evaluator a correct
engraving the old evaluator punished, and checks the benchmark says so."""

import re
import unittest
from fractions import Fraction

from pppbench import compare, corpus, correctness, evaluate, known_defects, musicxml, perform, runner, stages, util
from pppbench import suite as suite_mod


def case(ref_id, profile="deadpan", beats="oracle"):
    e = corpus.by_id(corpus.load_corpus())[ref_id]
    c = corpus.read_reference(e)
    p = perform.perform(c, ref_id, profile, beats, 1, expect=e.expect)
    row = stages.notate_batch([{"id": "x", "input": p.input, "opts": p.opts}])["results"]["x"]
    return e, c, p, row


def metrics(c, p, row, xml=None, stats=None):
    r = dict(row, xml=xml if xml is not None else row["xml"], stats=stats if stats is not None else row["stats"])
    return evaluate.evaluate_timed(c, p, r)[0]


class MissingOutputIsNeverAnImprovement(unittest.TestCase):
    """B1: deleting the tempo mark used to raise the diagnostic score (the tempo metric became null)."""

    def test_removing_the_tempo_mark(self):
        e, c, p, row = case("micro/M01-waltz-3-4")
        good = metrics(c, p, row)
        xml = re.sub(r'<direction placement="above">.*?</direction>', "", row["xml"], count=1, flags=re.S)
        self.assertNotIn("<sound tempo", xml)
        bad = metrics(c, p, row, xml)
        self.assertEqual(bad["struct.tempo.present"], 0.0)
        self.assertEqual(bad["struct.tempo.ok_effective"], 0.0)
        self.assertEqual(bad["critical.playback_tempo"], 0.0)
        self.assertEqual(bad["struct.stats_consistent"], 0.0)   # stats still claim a tempo the file lacks
        self.assertEqual(bad["usable"], 0.0)
        self.assertLess(bad["sqi"], good["sqi"])


class PickupsAreNotPunished(unittest.TestCase):
    """M5: the reference itself, as the prediction, must be perfect — with its pickup written as an
    implicit bar (as in the file) or as a full bar starting with rests (as toMusicXml writes it)."""

    KEYS = ("notes.identity.f1", "notation.onset_pos.accuracy", "notation.duration.accuracy", "notation.ioi.accuracy",
            "struct.time_sig.exact", "struct.downbeat.f1", "usable", "sqi")

    def oracle(self, ref_id, xml_bytes=None):
        e = corpus.by_id(corpus.load_corpus())[ref_id]
        ref = corpus.read_reference(e)
        p = perform.perform(ref, ref_id, "deadpan", "oracle", 1, expect=e.expect)
        pred_xml = xml_bytes or musicxml.read_bytes(e.abspath)
        pred = musicxml.read_score(pred_xml, ottava="standard")
        # a pickup written as a full bar starts that bar early, by the rests in front of the pickup
        pickup = ref.measures[0].sig_q - ref.measures[0].len_q if not pred.measures[0].implicit and ref.measures[0].implicit else 0
        starts = [Fraction(0) - pickup] + [m.start_q for m in ref.measures[1:]]
        bar_starts = [p.timemap.sec(q) if q >= 0 else p.timemap.sec(0) + float(q) * 60 / p.expected["qpm"] for q in starts]
        bar_starts.append(p.timemap.sec(ref.end_q))
        t = corpus.expected_time(e, ref)
        stats = {"barStarts": bar_starts, "beats": list(p.input["beats"]), "beatsPerBar": t[0], "beatType": t[1],
                 "bars": len(pred.measures), "tempo": pred.sound_qpm}
        return evaluate.evaluate_timed(ref, p, {"ok": True, "xml": pred_xml, "stats": stats},
                                       skip_metrics=e.expect.get("skip_metrics", ()))[0]

    def test_reference_with_implicit_pickup_is_perfect(self):
        for rid in ("micro/M07-pickup-3-4", "micro/M08-pickup-4-4", "catalog/happy-birthday"):
            m = self.oracle(rid)
            for k in self.KEYS:
                self.assertEqual(m[k], 100.0 if k == "sqi" else 1.0, f"{rid} {k}")

    def test_pickup_written_as_a_full_bar_with_rests_is_perfect_too(self):
        e = corpus.by_id(corpus.load_corpus())["micro/M07-pickup-3-4"]
        xml = util.read_text(e.abspath)
        # M07: a one-beat pickup in 3/4 -> a full first bar: two beats of rest, then the pickup note
        m0 = re.search(r'<measure number="0" implicit="yes">.*?</measure>', xml, re.S).group(0)
        head = m0[:m0.index("<note>")].replace(' implicit="yes"', "")
        body = (head + '<note><rest/><duration>48</duration><voice>1</voice><type>half</type><staff>1</staff></note>'
                '<note><pitch><step>C</step><octave>5</octave></pitch><duration>24</duration><voice>1</voice>'
                '<type>quarter</type><staff>1</staff></note><backup><duration>72</duration></backup>'
                '<note><rest measure="yes"/><duration>72</duration><voice>5</voice><staff>2</staff></note></measure>')
        full = xml.replace(m0, body, 1)
        pred = musicxml.read_score(full)
        self.assertFalse(pred.measures[0].implicit)
        self.assertEqual(pred.measures[0].len_q, 3)
        m = self.oracle("micro/M07-pickup-3-4", full.encode("utf-8"))
        self.assertEqual(m["notation.onset_pos.accuracy"], 1.0)
        self.assertEqual(m["notes.identity.f1"], 1.0)


class DimensionsTheGateUsedToMiss(unittest.TestCase):
    """M4: pedal, printed accidentals and bar structure are measured semantically, not only by bytes."""

    def test_pedal_marks(self):
        e, c, p, row = case("micro/M02-alberti-4-4", "pedal", "oracle")
        self.assertTrue(p.input["pedals"])
        good = metrics(c, p, row)
        self.assertEqual(good["notation.pedal.f1"], 1.0)
        self.assertEqual(good["critical.pedal"], 1.0)
        stripped = re.sub(r'<direction placement="below"><direction-type><pedal [^>]*/></direction-type>.*?</direction>',
                          "", row["xml"], flags=re.S)
        bad = metrics(c, p, row, stripped)
        self.assertEqual(bad["notation.pedal.f1"], 0.0)
        self.assertEqual(bad["critical.pedal"], 0.0)
        # without pedal in the performance the pedal metric does not apply
        e, c, p, row = case("micro/M02-alberti-4-4", "human", "oracle")
        self.assertIsNone(metrics(c, p, row)["notation.pedal.f1"])

    def test_printed_accidentals(self):
        e, c, p, row = case("micro/M13-sharps-chromatic")
        good = metrics(c, p, row)
        self.assertEqual(good["notation.accidentals.required_recall"], 1.0)
        bad = metrics(c, p, row, re.sub(r"<accidental>[^<]*</accidental>", "", row["xml"]))
        self.assertLess(bad["notation.accidentals.required_recall"], 0.5)
        self.assertEqual(bad["critical.accidentals"], 0.0)
        wrong = metrics(c, p, row, row["xml"].replace("<accidental>sharp</accidental>", "<accidental>flat</accidental>"))
        self.assertLess(wrong["notation.accidentals.required_recall"], 1.0)

    def test_an_empty_bar_added_at_the_end(self):
        e, c, p, row = case("micro/M01-waltz-3-4")
        extra = ('<measure number="99"><note><rest measure="yes"/><duration>72</duration><voice>1</voice>'
                 '<staff>1</staff></note></measure></part>')
        bs = row["stats"]["barStarts"]
        stats = dict(row["stats"], bars=row["stats"]["bars"] + 1, barStarts=bs + [bs[-1] + (bs[-1] - bs[-2])])
        bad = metrics(c, p, row, row["xml"].replace("</part>", extra), stats)
        self.assertEqual(bad["struct.measures.extra_empty_edge"], 1.0)
        self.assertEqual(bad["critical.structure"], 0.0)


class ApplicabilityComesFromTheTruth(unittest.TestCase):
    """B1, the other direction: whether a metric applies must depend on the reference or the input,
    never on what the prediction wrote — otherwise an improvement that removes a spurious element
    (a needless tuplet) turns a metric null and the coverage rule calls it a regression."""

    def test_spurious_tuplets_and_needless_accidentals(self):
        from pppbench.metrics import notation, readability
        from unit.helpers import canon, measure, note
        ref = canon([measure(note("C", 5, 2) + note("D", 5, 2) + note("E", 5, 2), number=1)], divisions=2, time=(3, 4), staves=1)
        tm = "<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>"
        spurious = canon([measure(note("C", 5, 2, extra=tm) + note("D", 5, 2) + note("E", 5, 2), number=1)],
                         divisions=2, time=(3, 4), staves=1)

        def ctx(pred):
            r = sorted(ref.played(), key=lambda s: s.onset_q)
            p = sorted(pred.played(), key=lambda s: s.onset_q)
            return {"ref": ref, "pred": pred, "pairs": [(a.id, b.id, 0.0) for a, b in zip(r, p)], "kind": "T",
                    "skip_metrics": ()}
        bad, fixed = notation.compute(ctx(spurious)), notation.compute(ctx(ref))
        self.assertIsNone(bad["notation.tuplets.f1"])       # the reference has no tuplets: F1 does not apply
        self.assertIsNone(fixed["notation.tuplets.f1"])     # ... before and after the fix alike
        self.assertGreater(bad["notation.tuplets.false_per_100"], 0)
        self.assertEqual(fixed["notation.tuplets.false_per_100"], 0.0)
        # a score that needs no printed accidental has missed none
        self.assertEqual(readability.readability(ref)["notation.accidentals.required_recall"], 1.0)


class ReaderCorrectness(unittest.TestCase):
    """M6: the reader against spec-derived fixtures, separately from parity with the app."""

    def test_reference_reading_matches_every_fixture(self):
        r = correctness.check()
        self.assertEqual(r["failures"], [])
        self.assertGreaterEqual(r["fixtures"], 13)
        self.assertEqual(set(r["app_deviations"]), {"C10-octave-shift-8va", "C11-octave-shift-8vb"})

    def test_a_reader_that_never_merges_ties_is_caught(self):
        orig = musicxml.merge_ties

        def no_merge(notes):
            for n in notes:
                n.tie_stop = False
            return orig(notes)
        musicxml.merge_ties = no_merge
        try:
            fails = correctness.check()["failures"]
        finally:
            musicxml.merge_ties = orig
        self.assertTrue(any("C01-ties" in f for f in fails))


class KnownFailuresAreMeasured(unittest.TestCase):
    """M8/M9: catalogue defects are counted in every run, not only described."""

    def test_counts(self):
        kf = known_defects.audit()
        k = kf["classes"]
        self.assertEqual(k["key_signature_playback"]["by_collection"]["hymns"], 89)
        self.assertEqual(kf["files_by_collection"]["hymns"], 100)
        self.assertEqual(k["tie_without_stop"]["by_collection"]["hymns"], 10)
        self.assertGreaterEqual(k["octave_shift_playback"]["files_affected"], 29)
        # in time order across voices, as the page is read (the review's document-order count was 21)
        self.assertEqual((k["bar_accidental_not_carried"]["by_collection"], k["bar_accidental_not_carried"]["items"]),
                         ({"hymns": 10}, 18))
        for c in ("key_signature_playback", "tie_without_stop", "bar_accidental_not_carried", "octave_shift_playback"):
            self.assertEqual(k[c]["status"], "KNOWN_FAILURE", c)


class EditedReferenceIsInputDrift(unittest.TestCase):
    """m1: a reference edit that leaves the performance unchanged (here: the key signature) stops `run`."""

    def test_key_signature_edit(self):
        import os
        import tempfile
        s = suite_mod.load_suite("smoke")
        rid = "micro/M01-waltz-3-4"
        e = corpus.by_id(corpus.load_corpus())[rid]
        text = util.read_text(e.abspath).replace("<fifths>1</fifths>", "<fifths>0</fifths>", 1)
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "M01.musicxml")
            with open(path, "w", encoding="utf-8", newline="\n") as h:
                h.write(text)
            prop = corpus.RefEntry.abspath
            corpus.RefEntry.abspath = property(lambda self: path if self.id == rid else os.path.join(util.repo_root(), self.path))
            corpus._canon_cache.clear()
            try:
                _, rows, _ = runner.generate(s)
                drifts = suite_mod.verify_lock(s, rows, util.load_json(suite_mod.lock_path(s)))
            finally:
                corpus.RefEntry.abspath = prop
                corpus._canon_cache.clear()
        self.assertTrue(any(rid in d and "reference_sha256" in d for d in drifts), drifts[:3])

    def test_reordering_a_suite_is_not_drift(self):
        s = suite_mod.load_suite("smoke")
        t = dict(s, references=list(reversed(s["references"])))
        self.assertEqual(suite_mod.suite_sha256(s), suite_mod.suite_sha256(t))


class SuiteGatesMatchTheCode(unittest.TestCase):
    """The gate in effect is the one in suites/*.json; it must be the one suite.py defines."""

    def test_committed_gates(self):
        import json
        want = {"smoke": suite_mod.GATE_SMOKE, "core": suite_mod.GATE_CORE, "robust": suite_mod.GATE_CORE,
                "mutation": suite_mod.GATE_CORE, "full": suite_mod.GATE_FULL,
                "replay-public": suite_mod.GATE_REPLAY, "omr-live": suite_mod.GATE_OMR}
        for name, gate in want.items():
            self.assertEqual(suite_mod.load_suite(name)["gate"], json.loads(json.dumps(gate)), name)

    def test_full_guards_the_hold_out(self):
        # §17 m10: the open references hold steady while the unseen ones lose 3 points of usable rate
        gate = suite_mod.GATE_FULL
        agg = lambda usable, n: {"usable": {"mean": usable, "n": n}, "sqi": {"mean": 80.0, "n": n}, "cases": n}  # noqa: E731
        def res(hold):
            return {"suite": "full", "suite_sha256": "S", "lock_sha256": "L", "versions": dict(runner.VERSIONS),
                    "filtered": False, "cases": [],
                    "aggregates": {"all": agg(0.30, 1000), "by_tag": {"holdout": agg(hold, 200)}}}
        base = compare.baseline_from_results(res(0.30), {"git_sha": "x"}, reason="test", gate=gate)
        self.assertEqual(compare.compare(res(0.30), base, gate).status, "PASS")
        v = compare.compare(res(0.27), base, gate)
        self.assertEqual(v.status, "REGRESSION")
        self.assertIn("tag:holdout", v.failed_metrics)
        self.assertEqual(compare.compare(res(0.27), base, suite_mod.GATE_CORE).status, "PASS")


class ReplayPedalIsScoredAgainstThePerformance(unittest.TestCase):
    """M4: in replay the SUT's pedal input is the AMT's guess; truth is what the performer did."""

    def test_invented_pedal_is_counted_and_dropping_it_is_not_a_regression(self):
        e, c, p, row = case("method/beyer/029", profile="pedal")
        self.assertTrue(p.input["pedals"])
        written = metrics(c, p, row)
        self.assertGreater(written["notation.pedal.f1"], 0.5)          # synthetic: input pedal = truth
        self.assertLess(written["notation.pedal.false_per_min"], 1.0)
        # the same output, scored as a replay whose performer used no pedal (the AMT invented it)
        invented = evaluate.evaluate_timed(c, p, row, truth_pedals=[])[0]
        self.assertIsNone(invented["notation.pedal.f1"])               # no pedal gate: nothing to recall
        self.assertIsNone(invented["critical.pedal"])
        self.assertGreater(invented["notation.pedal.false_per_min"], 0.0)
        # a SUT that writes no pedal for that input is better, and nothing it is gated on gets worse
        bare = re.sub(r"<direction[^>]*><direction-type><pedal[^>]*/></direction-type>(<offset>[^<]*</offset>)?"
                      r"(<staff>\d</staff>)?(<sound[^>]*/>)?</direction>", "", row["xml"])
        self.assertNotIn("<pedal", bare)
        dropped = evaluate.evaluate_timed(c, p, dict(row, xml=bare), truth_pedals=[])[0]
        self.assertEqual(dropped["notation.pedal.false_per_min"], 0.0)
        self.assertEqual(dropped["usable"], invented["usable"])

    def test_unknown_pedal_is_not_scored(self):
        e, c, p, row = case("method/beyer/029", profile="pedal")
        m = evaluate.evaluate_timed(c, p, row, truth_pedals=None)[0]
        self.assertIsNone(m["notation.pedal.f1"])
        self.assertIsNone(m["notation.pedal.false_per_min"])
        self.assertGreater(m["notation.pedal.marks"], 0)


class StaleResults(unittest.TestCase):
    """m2: `check` refuses results produced by an audio-score.js that has changed since."""

    def test_stale_reason(self):
        run = {"audio_score_path": "audio-score.js", "audio_score_sha256": "0" * 64}
        self.assertIn("changed", compare.stale_reason(run))
        run["audio_score_sha256"] = util.content_sha256(stages.default_audio_score())
        self.assertIsNone(compare.stale_reason(run))


if __name__ == "__main__":
    unittest.main()
