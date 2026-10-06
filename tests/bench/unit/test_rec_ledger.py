"""G10a-6 (docs/GOALS/G10 section 29): the rec.ledger.* metrics, and how a PREDICTION's octave lines are read.

A v2 recording's score has 8va/8vb lines (audio-score.js, opts.ottava). Two things follow for the benchmark: the notes under a line must still be read at the pitch they
sound (MusicXML's <pitch> is the sounding pitch, MX-1; the reader's "app" mode is the pre-MX-1 app and would put every note under a line an octave off), and the heads still
on 3 or more ledger lines are a number worth reading (rec.ledger.*, from scoregraph/tools/ledger-stats.js on the predicted graph).
"""

import os
import unittest

from pppbench import evaluate, musicxml, recrun, stages, util
from pppbench.metrics import rec

DIR = util.bench_root()
C10 = os.path.join(DIR, "corpus", "correctness", "C10-octave-shift-8va.musicxml")
V2 = {"closeGaps": True, "exactBars": True, "recording": "v2", "title": "t"}


def two_registers(bars=12):
    """The right hand far above the staff (E6 to C7) for the first half, then in the middle over a left hand far below the staff (E1 to B1): 4/4 at 100."""
    spq, notes = 0.6, []
    high, mid, bass_mid, bass_low = [88, 91, 93, 96, 95, 93, 91, 88], [76, 79, 77, 74, 76, 72, 74, 71], [48, 55, 52, 55], [28, 35, 33, 31]
    for b in range(bars):
        t0, hi = 1 + b * 4 * spq, b < bars // 2
        for k in range(8):
            notes.append({"on": round(t0 + k * spq / 2, 3), "off": round(t0 + (k + 0.85) * spq / 2, 3), "midi": (high if hi else mid)[k], "vel": 92 if k == 0 else 62})
        for k in range(4):
            notes.append({"on": round(t0 + k * spq, 3), "off": round(t0 + (k + 0.9) * spq, 3), "midi": (bass_mid if hi else bass_low)[k], "vel": 80})
    notes.sort(key=lambda n: (n["on"], n["midi"]))
    return {"notes": notes, "title": "t"}


class LedgerMetrics(unittest.TestCase):
    def test_per_100_heads_with_the_lines_and_without_them(self):
        got = rec.ledger_metrics({"heads": 200, "ge3": 10, "plain": {"ge3": 40}})
        self.assertEqual((got["rec.ledger.ge3_per_100_heads"], got["rec.ledger.plain_ge3_per_100_heads"]), (5.0, 20.0))

    def test_a_graph_with_no_heads_or_no_tool_row_has_no_value(self):
        for ledger in (None, {}, {"heads": 0, "ge3": 0}):
            got = rec.ledger_metrics(ledger)
            self.assertEqual((got["rec.ledger.ge3_per_100_heads"], got["rec.ledger.plain_ge3_per_100_heads"]), (None, None), str(ledger))

    def test_a_row_without_the_plain_count_reads_it_as_the_same(self):
        got = rec.ledger_metrics({"heads": 50, "ge3": 5})
        self.assertEqual((got["rec.ledger.ge3_per_100_heads"], got["rec.ledger.plain_ge3_per_100_heads"]), (10.0, 10.0))


class PredictionReading(unittest.TestCase):
    def test_a_prediction_is_read_the_way_the_app_reads_it_since_mx1(self):
        self.assertEqual(musicxml.PREDICTION_OTTAVA, "standard")
        std = musicxml.read_score(C10, ottava=musicxml.PREDICTION_OTTAVA)
        app = musicxml.read_score(C10, ottava="app")
        self.assertEqual(std.diagnostics["ottava_mode"], "standard")
        self.assertGreater(std.diagnostics["ottava_shifted_notes"], 0)
        std_midi = sorted(s.midi for s in std.sounding)
        app_midi = sorted(s.midi for s in app.sounding)
        self.assertNotEqual(std_midi, app_midi, "the fixture has notes under an 8va: the two readings differ")
        self.assertTrue(all(abs(a - b) in (0, 12) for a, b in zip(std_midi, app_midi)))

    def test_the_evaluator_and_the_stability_probe_read_predictions_that_way(self):
        for module in (evaluate, recrun):
            with open(module.__file__.replace(".pyc", ".py"), encoding="utf-8") as handle:
                text = handle.read()
            self.assertIn("ottava=musicxml.PREDICTION_OTTAVA", text, module.__name__)
        with open(evaluate.__file__.replace(".pyc", ".py"), encoding="utf-8") as handle:
            self.assertNotIn("musicxml.read_score(row[\"xml\"])", handle.read())


class OneConversion(unittest.TestCase):
    """The whole path on one recording: the SUT, the metric tool, the reader and the metric."""

    @classmethod
    def setUpClass(cls):
        cls.on = stages.notate_batch([{"id": "on", "input": two_registers(), "opts": V2}], check=True)["results"]["on"]
        cls.off = stages.notate_batch([{"id": "off", "input": two_registers(), "opts": dict(V2, ottava="off")}], check=True)["results"]["off"]
        cls.classic = stages.notate_batch([{"id": "classic", "input": two_registers(), "opts": {"closeGaps": True, "exactBars": True, "title": "t"}}], check=True)["results"]["classic"]

    def test_the_lines_take_the_heads_off_the_ledger_lines(self):
        led = self.on["ledger"]
        self.assertGreater(led["plain"]["ge3"], 40)
        self.assertEqual(led["ge3"], 0)
        self.assertGreater(led["shifted"], 40)
        self.assertEqual(led["heads"], self.off["ledger"]["heads"])
        got = rec.ledger_metrics(led)
        self.assertEqual(got["rec.ledger.ge3_per_100_heads"], 0.0)
        self.assertGreater(got["rec.ledger.plain_ge3_per_100_heads"], 15.0)

    def test_without_the_lines_or_with_the_classic_conversion_the_two_are_equal(self):
        for row in (self.off, self.classic):
            got = rec.ledger_metrics(row["ledger"])
            self.assertEqual(got["rec.ledger.ge3_per_100_heads"], got["rec.ledger.plain_ge3_per_100_heads"])
            self.assertGreater(got["rec.ledger.ge3_per_100_heads"], 15.0)
            self.assertEqual(row["ledger"]["shifted"], 0)
        self.assertNotIn("<octave-shift", self.off["xml"])
        self.assertNotIn("<octave-shift", self.classic["xml"])

    def test_the_notes_under_a_line_are_read_at_the_pitch_they_sound(self):
        self.assertIn("<octave-shift", self.on["xml"])
        heard = sorted(n["midi"] for n in two_registers()["notes"])
        std = musicxml.read_score(self.on["xml"], ottava=musicxml.PREDICTION_OTTAVA)
        self.assertEqual(sorted(s.midi for s in std.sounding), heard)
        std_off = musicxml.read_score(self.off["xml"], ottava=musicxml.PREDICTION_OTTAVA)
        self.assertEqual([(s.measure, s.pos_q, s.midi) for s in std.sounding], [(s.measure, s.pos_q, s.midi) for s in std_off.sounding],
                         "the lines move no note: the same notes at the same places with and without them")
        app = musicxml.read_score(self.on["xml"], ottava="app")
        self.assertNotEqual(sorted(s.midi for s in app.sounding), heard, "read the old way, every note under a line is an octave away")


if __name__ == "__main__":
    unittest.main()
