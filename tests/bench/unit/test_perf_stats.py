"""node/perf-stats.js (G10a-0): the calibration statistics, on a hand-made graph with hand-computed values, and the
committed calibration files (aggregates only, E5's numbers)."""

import json
import os
import subprocess
import tempfile
import unittest

from pppbench import calibration, util

CAL = os.path.join(util.bench_root(), "corpus", "calibration")
S = 1e6


def graph():
    """One 4/4 bar (2 s at 120 qpm), RH four notes, LH two; times chosen on 32-ms frames. Written positions:
    RH 0, 1/4, 1/2, 3/4 of the bar; LH 0 and 1/2."""
    def ev(i, at, dur, staff):
        return {"id": f"e{i}", "m": "m1", "at": at, "dur": dur, "staff": staff, "heads": [{"id": f"h{i}"}]}
    events = [ev(1, "0", "1/4", "s1"), ev(2, "1/4", "1/4", "s1"), ev(3, "1/2", "1/4", "s1"), ev(4, "3/4", "1/4", "s1"),
              ev(5, "0", "1/2", "s2"), ev(6, "1/2", "1/2", "s2")]
    heard = [(1, 0.000, 0.384, 72, 70), (2, 0.512, 1.024, 74, 72), (3, 1.024, 1.800, 76, 68), (4, 1.504, 1.900, 77, 66),
             (5, 0.000, 2.000, 48, 60), (6, 1.056, 2.000, 43, 62)]
    return {
        "timeline": {"measures": [{"id": "m1", "number": "1", "dur": "1"}, {"id": "m2", "number": "2", "dur": "1"}]},
        "parts": [{"staves": [{"id": "s1", "limb": "RH"}, {"id": "s2", "limb": "LH"}], "events": events, "spanners": []}],
        "performances": [{"id": "p1", "kind": "source", "src": "sr1",
                          "notes": [{"id": f"pn{i}", "on": round(on * S), "off": round(off * S), "vel": v, "midi": m, "link": f"h{i}"}
                                    for i, on, off, m, v in heard],
                          "anchors": [{"m": "m1", "k": 1, "at": "0", "us": 0, "kind": "bar"},
                                      {"m": "m2", "k": 1, "at": "0", "us": 2000000, "kind": "bar"},
                                      {"m": "m2", "k": 1, "at": "1", "us": 4000000, "kind": "bar"}]}],
    }


def run_node(path, *args):
    res = subprocess.run(["node", calibration.PERF_STATS, path, *args], capture_output=True, text=True, encoding="utf-8")
    return res.returncode, res.stdout, res.stderr


class HandMadeGraph(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        path = os.path.join(cls.tmp.name, "g.json")
        util.dump_json(graph(), path)
        code, out, err = run_node(path, "--engine", "unit-engine")
        assert code == 0, err
        cls.s = json.loads(out)

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def test_resolution_velocity_density(self):
        s = self.s
        self.assertEqual((s["schema"], s["engine"], s["notes"], s["frameSec"]), ("ppp.perf-stats/1", "unit-engine", 6, 0.032))
        self.assertEqual((s["resolution"]["onsetsOnFrames"], s["resolution"]["offsetsOnFrames"]), (1, 0.3333))   # only .384 and 1.024 are frame multiples
        self.assertEqual(s["velocity"]["mean"], round((70 + 72 + 68 + 66 + 60 + 62) / 6, 3))
        self.assertEqual(s["density"]["seconds"], 1.504)

    def test_chords_one_frame_apart(self):
        c = self.s["chords"]
        self.assertEqual((c["multiNoteAttacks"], c["spreadZero"], c["spreadOneFrame"], c["spreadMoreThanOneFrame"]), (2, 0.5, 0.5, 0))

    def test_onset_residual_against_the_written_grid(self):
        r = self.s["onsetResidualVsWrittenMs"]
        # written times (2 s per bar): 0, .5, 1.0, 1.5 / 0, 1.0 ; heard 0, .512, 1.024, 1.504 / 0, 1.056
        dev = [0, 12, 24, 4, 0, 56]
        mean = sum(dev) / 6
        sd = (sum((d - mean) ** 2 for d in dev) / 6) ** 0.5
        self.assertEqual(r["n"], 6)
        self.assertAlmostEqual(r["mean"], mean, places=2)
        self.assertAlmostEqual(r["sd"], sd, places=2)
        self.assertEqual(r["absMedian"], 12)             # |dev| 0 0 4 12 24 56, nearest rank

    def test_releases_of_the_right_hand(self):
        rh = self.s["releasesByHand"]["RH"]
        # n1: held .384 of .512 = .75 (gap 128 ms); n2: 1.0 (to the next onset exactly); n3: .776 of .48 = 1.617 (overlap 296 ms)
        self.assertEqual(rh["n"], 3)
        self.assertAlmostEqual(rh["ratioMedian"], 1.0, places=3)
        self.assertAlmostEqual(rh["releasedBeforeNextOnset"], 1 / 3, places=3)
        self.assertEqual(rh["gapMsMedian"], 128)
        self.assertEqual(rh["overlapMsMedian"], 296)
        self.assertEqual(len(rh["ratioQuantiles"]), 21)

    def test_left_hand_and_tempo(self):
        lh = self.s["releasesByHand"]["LH"]
        self.assertEqual(lh["n"], 1)                                   # the last note of a hand has no next onset
        self.assertAlmostEqual(lh["ratioMedian"], 2.0 / 1.056, places=3)
        t = self.s["tempo"]
        self.assertEqual(t["qpmMedian"], 120)
        self.assertEqual(t["barDurCV"], 0)

    def test_free_notes_exclude_a_note_that_a_re_strike_could_have_cut(self):
        g = graph()
        # strike pitch 74 (n2) again at 1.2 s: n2 is no longer free, and the other RH notes still are
        g["parts"][0]["events"].append({"id": "e7", "m": "m1", "at": "5/8", "dur": "1/8", "staff": "s1", "heads": [{"id": "h7"}]})
        g["performances"][0]["notes"].append({"id": "pn7", "on": 1250000, "off": 1400000, "vel": 64, "midi": 74, "link": "h7"})
        path = os.path.join(self.tmp.name, "g2.json")
        util.dump_json(g, path)
        code, out, err = run_node(path)
        self.assertEqual(code, 0, err)
        s = json.loads(out)
        self.assertLess(s["releasesFreeByHand"]["RH"]["n"], s["releasesByHand"]["RH"]["n"])

    def test_no_notes_in_the_output(self):
        text = json.dumps(self.s)
        for needle in ('"midi"', '"on"', '"off"', '"link"', "title"):
            self.assertNotIn(needle, text)

    def test_deterministic(self):
        path = os.path.join(self.tmp.name, "g.json")
        self.assertEqual(run_node(path)[1], run_node(path)[1])

    def test_a_graph_without_a_performance_is_refused(self):
        g = graph()
        g["performances"] = []
        path = os.path.join(self.tmp.name, "g3.json")
        util.dump_json(g, path)
        code, _, err = run_node(path)
        self.assertEqual(code, 1)
        self.assertIn("no performance layer", err)


class CommittedCalibrationFiles(unittest.TestCase):
    def test_the_cover_file_holds_the_design_numbers(self):
        """E5 of docs/GOALS/G10: the numbers perf-stats.js gave on the teacher's private transcription."""
        d = util.load_json(os.path.join(CAL, "cover-of-2026-10.json"))
        self.assertEqual(d["engine"], "onsets-and-frames")
        self.assertEqual(d["notes"], 1214)
        self.assertEqual((d["resolution"]["onsetsOnFrames"], d["resolution"]["offsetsOnFrames"]), (1, 1))
        self.assertAlmostEqual(d["chords"]["spreadZero"], 0.571, places=3)
        self.assertAlmostEqual(d["chords"]["spreadOneFrame"], 0.429, places=3)
        self.assertEqual(d["velocity"]["mean"], 67.252)
        self.assertEqual(d["velocity"]["sd"], 6.493)
        self.assertEqual(d["tempo"]["barDurCV"], 0.007)
        self.assertAlmostEqual(d["onsetResidualVsWrittenMs"]["sd"], 28.0, places=0)
        self.assertAlmostEqual(d["onsetResidualVsWrittenMs"]["absP90"], 44.0, places=0)
        rh, lh = d["releasesByHand"]["RH"], d["releasesByHand"]["LH"]
        self.assertEqual([rh[k] for k in ("ratioP10", "ratioP25", "ratioMedian", "ratioP75", "ratioP90")], [0.333, 0.778, 1.833, 3.167, 8])
        self.assertEqual([lh[k] for k in ("ratioP10", "ratioP25", "ratioMedian", "ratioP75", "ratioP90")], [0.312, 0.706, 1.171, 2.4, 5])
        self.assertAlmostEqual(rh["overlapsNextOnset"], 0.73, places=2)
        self.assertAlmostEqual(lh["overlapsNextOnset"], 0.69, places=2)
        self.assertEqual(rh["gapMsMedian"], 128)
        self.assertEqual(d["tuplets"]["barsWithTripletBeat"], round(50 / 90, 4))
        self.assertAlmostEqual(d["beatPositions"]["offEveryGridPoint"], 0.142, places=3)

    def test_the_cover_file_is_aggregates_only(self):
        """Copyright: no note, no title, no per-note list. The longest list is a 21-knot quantile table."""
        d = util.load_json(os.path.join(CAL, "cover-of-2026-10.json"))

        def walk(x, path=""):
            if isinstance(x, list):
                self.assertLessEqual(len(x), 21, path)
                for i, y in enumerate(x):
                    walk(y, path + f"[{i}]")
            elif isinstance(x, dict):
                for k, y in x.items():
                    self.assertNotIn(k, ("notes_list", "title", "midi", "on", "off", "link"), path)
                    walk(y, path + "." + k)
        walk(d)
        self.assertNotIn("Looping", json.dumps(d))
        self.assertNotIn("Miku", json.dumps(d))

    def test_the_replay_file_is_what_the_extractor_gives_on_the_committed_fixtures(self):
        out = subprocess.run(["node", calibration.PERF_STATS, "--replay", os.path.join(util.bench_root(), "replay")],
                             capture_output=True, text=True, encoding="utf-8")
        self.assertEqual(out.returncode, 0, out.stderr)
        self.assertEqual(json.loads(out.stdout), util.load_json(os.path.join(CAL, "replay-helper.json")))

    def test_the_replay_file_has_the_measured_helper_errors(self):
        d = util.load_json(os.path.join(CAL, "replay-helper.json"))
        self.assertEqual(d["fixtures"], 6)
        self.assertAlmostEqual(d["onsetErrorMs"]["mean"], 9.0, delta=1.0)      # E8: +9 ms, sd 2.9
        self.assertAlmostEqual(d["onsetErrorMs"]["sd"], 2.9, delta=0.5)
        self.assertAlmostEqual(d["offsetErrorMs"]["median"], 12.0, delta=2.0)
        self.assertAlmostEqual(d["offsetErrorMs"]["absP90"], 191.0, delta=15.0)
        self.assertAlmostEqual(d["missed"], 0.019, delta=0.005)
        self.assertAlmostEqual(d["extra"], 0.033, delta=0.005)
        self.assertEqual(d["pedalInventedFixtures"], 5)


if __name__ == "__main__":
    unittest.main()
