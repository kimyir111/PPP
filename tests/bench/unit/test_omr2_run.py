"""omr-live-2: the parts of a run that need no Audiveris, Chrome or app (tests/omr/omrbench/engine.py, suite.py, appmode.py), exercised with a
stand-in program for Audiveris: how a page's files are found and ordered, that a timeout is stopped by PID and never cached, that a finished
page is reused, that the movements of a page are all read (or one, as the helper keeps it), and how the app's Score is judged."""

import os
import sys
import tempfile
import textwrap
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import omr2_synth as S  # noqa: E402  (puts tests/omr on sys.path)
from omrbench import appmode as A  # noqa: E402
from omrbench import engine as E  # noqa: E402
from omrbench import suite as SU  # noqa: E402
from omrbench import xmlscore as X  # noqa: E402

FAKE = textwrap.dedent('''
    import io, os, sys, time, zipfile
    args = sys.argv[1:]
    out = args[args.index("-output") + 1]
    image = args[-1]
    mode = open(image, "rb").read().decode("latin-1").strip()
    xml = open(os.environ["FAKE_XML"], encoding="utf-8").read()
    def write(name):
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as z:
            z.writestr("META-INF/container.xml", '<container><rootfiles><rootfile full-path="s.xml"/></rootfiles></container>')
            z.writestr("s.xml", xml)
        os.makedirs(os.path.join(out, "book"), exist_ok=True)
        open(os.path.join(out, "book", name), "wb").write(buf.getvalue())
    if mode == "sleep":
        time.sleep(60)
    elif mode == "two":
        write("page.mvt2.mxl"); write("page.mvt1.mxl")
    elif mode == "none":
        pass
    elif mode == "steptimeout":
        print("WARN  [x]  SheetStub 527  | Timeout 120 seconds for step BEAMS"); sys.exit(1)
    else:
        write("page.mxl")
    print("done")
''')


class Stand(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = self.tmp.name
        self.script = os.path.join(self.dir, "fake_audiveris.py")
        with open(self.script, "w", encoding="utf-8") as h:
            h.write(FAKE)
        self.xml = os.path.join(self.dir, "page.xml")
        with open(self.xml, "w", encoding="utf-8") as h:
            h.write(S.piano(S.BARS[:3]))
        os.environ["FAKE_XML"] = self.xml
        self.exe = [sys.executable, self.script]
        self.engine = {"jar_sha256": "j1"}

    def tearDown(self):
        os.environ.pop("FAKE_XML", None)
        self.tmp.cleanup()

    def image(self, mode, name="img.png"):
        p = os.path.join(self.dir, name)
        with open(p, "wb") as h:
            h.write(mode.encode("latin-1"))
        return p

    def run_page(self, mode, **kw):
        return E.run_page(self.exe, self.image(mode, mode + ".png"), os.path.join(self.dir, "out-" + mode), self.engine, **kw)

    def test_a_page_is_read_and_a_second_ask_is_answered_from_the_first(self):
        a = self.run_page("one")
        self.assertEqual((a["rc"], len(a["mxl"]), a["cached"]), (0, 1, False))
        b = self.run_page("one")
        self.assertTrue(b["cached"])
        self.assertEqual(b["mxl"], a["mxl"])
        c = self.run_page("one", force=True)
        self.assertFalse(c["cached"])

    def test_another_engine_or_another_image_is_not_a_cache_hit(self):
        self.run_page("one")
        self.engine = {"jar_sha256": "j2"}
        self.assertFalse(self.run_page("one")["cached"])
        other = self.image("one ", "one.png")                    # the same name, other bytes
        self.assertFalse(E.run_page(self.exe, other, os.path.join(self.dir, "out-one"), self.engine)["cached"])

    def test_the_movements_of_a_page_come_in_movement_order(self):
        r = self.run_page("two")
        self.assertEqual([os.path.basename(p) for p in r["mxl"]], ["page.mvt1.mxl", "page.mvt2.mxl"])
        self.assertEqual(E.movement_order("a/b/page.mvt12.mxl"), 12)
        self.assertEqual(E.movement_order("a/b/page.mxl"), 0)

    def test_a_page_with_nothing_is_a_page_with_no_file_and_is_kept_as_an_answer(self):
        r = self.run_page("none")
        self.assertEqual((r["rc"], r["mxl"]), (0, []))
        self.assertTrue(self.run_page("none")["cached"])

    def test_a_timeout_stops_the_process_and_is_not_kept(self):
        r = self.run_page("sleep", timeout=2)
        self.assertEqual(r["rc"], -9)
        self.assertEqual(r["mxl"], [])
        self.assertFalse(self.run_page("sleep", timeout=2)["cached"], "asked again, not answered from the timeout")
        self.assertEqual(E._live, {}, "nothing started here is left running")

    def test_audiveris_own_step_timeout_is_a_timeout_and_is_not_kept(self):
        r = self.run_page("steptimeout")
        self.assertTrue(r["timed_out"])
        self.assertEqual((r["rc"], r["mxl"]), (1, []))
        self.assertFalse(self.run_page("steptimeout")["cached"])

    def test_the_options_of_the_engine_are_part_of_the_answer(self):
        self.assertEqual(E.engine_options(120), ["-option", "org.audiveris.omr.Main.sheetStepTimeOut=120"])
        self.run_page("one")
        other = E.run_page(self.exe, self.image("one", "one.png"), os.path.join(self.dir, "out-one"), self.engine, step_timeout=999)
        self.assertFalse(other["cached"])

    def test_run_pages_runs_the_jobs_in_parallel_and_returns_them_by_key(self):
        jobs = [{"key": f"k{i}", "image": self.image("one", f"i{i}.png"), "out": os.path.join(self.dir, f"o{i}")} for i in range(5)]
        got = E.run_pages(self.exe, jobs, self.engine, workers=3, log=lambda *a: None)
        self.assertEqual(sorted(got), [f"k{i}" for i in range(5)])
        self.assertTrue(all(len(r["mxl"]) == 1 for r in got.values()))

    def test_read_pages_joins_the_pages_and_takes_every_movement_or_one(self):
        r1, r2 = self.run_page("two"), self.run_page("one")
        both = SU.read_pages([r1, r2])
        self.assertEqual(len(both.bars), 3 * 3, "two movements of 3 bars and one page of 3")
        last = SU.read_pages([r1, r2], movements="last")
        self.assertEqual(len(last.bars), 3 * 2, "one file a page, as the helper keeps it")
        self.assertIsNone(SU.read_pages([self.run_page("none")]))
        self.assertIsNone(SU.read_pages([]))

    def test_normalize_units_reads_the_engines_files_through_omr_normalize(self):
        """G12-1 `run --normalize`: two parts of one staff (the issue 11 shape) written for a page come back as ONE part of two staves, every bar kept;
        the same files read as the engine wrote them are two parts. (Node only; the CLI reads a plain file as text too.)"""
        import shutil
        if not shutil.which("node"):
            self.skipTest("node is not installed")
        split = os.path.join(self.dir, "split.xml")
        with open(split, "w", encoding="utf-8") as h:
            h.write(S.piano(S.BARS[:3], parts="split"))
        got = SU.normalize_units({"case|tier": [[split]], "gone|tier": [[]]})
        self.assertTrue(got["case|tier"]["ok"])
        self.assertFalse(got["gone|tier"]["ok"])
        raw = X.parse_score(S.piano(S.BARS[:3], parts="split"))
        fixed = X.parse_score(got["case|tier"]["xml"])
        self.assertEqual([p.staves for p in raw.parts], [1, 1])
        self.assertEqual([p.staves for p in fixed.parts], [2])
        self.assertEqual(len(fixed.bars), 3)
        self.assertEqual(sorted(n.midi for b in fixed.bars for n in b.notes if not n.rest), sorted(n.midi for b in raw.bars for n in b.notes if not n.rest))

    def test_a_file_that_is_not_a_score_is_skipped_not_fatal(self):
        bad = os.path.join(self.dir, "bad.mxl")
        with open(bad, "wb") as h:
            h.write(b"not a zip")
        good = self.run_page("one")
        s = SU.read_pages([{"mxl": [bad]}, good])
        self.assertEqual(len(s.bars), 3)


def projection(notes, measures=3, staves=2, time=(4, 4)):
    return {"title": "x", "tempo": 80, "staves": staves,
            "measures": [{"number": str(i + 1), "startQ": 4 * i, "lenQ": 4, "time": list(time), "fifths": 0, "mode": "major", "bar": None} for i in range(measures)],
            "notes": notes}


def pn(m, b, dur, midi, staff=1, hand="r", rest=False):
    return {"m": m, "b": b, "dur": dur, "midi": None if rest else midi, "staff": staff, "hand": hand, "rest": rest}


class AppScore(unittest.TestCase):
    def truth(self):
        return X.parse_score(S.piano(S.BARS[:3]))

    def read_of(self, bars):
        notes = []
        for m, (rh, lh) in enumerate(bars):
            for side, items in ((0, rh), (1, lh)):
                t = 0.0
                for it in items:
                    name, q = it.rstrip("*").split(":")
                    q = float(q)
                    if name != "r":
                        for p in name.split("+"):
                            midi = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}[p[0]] + 12 * (int(p[1]) + 1)
                            notes.append(pn(m, t, q, midi, side + 1, "r" if side == 0 else "l"))
                    t += q
        return notes

    def row(self, notes, suspect=(), ok=True, **kw):
        return {"ok": ok, "engine": "Audiveris", "ms": 1000, "projection": projection(notes, **kw),
                "report": {"confidence": 0.8, "level": "good", "suspectMeasures": list(suspect), "issues": 0}}

    def test_the_truth_read_exactly_is_perfect_and_the_flags_have_nothing_to_find(self):
        r, note = A.judge_app(self.truth(), self.row(self.read_of(S.BARS[:3])))
        self.assertEqual(r.metrics["omr.played_f1"], 1.0)
        self.assertEqual(r.metrics["omr.note_f1"], 1.0)
        self.assertEqual(r.metrics["omr.bar_exact"], 1.0)
        self.assertEqual(r.metrics["omr.parts_ok"], 1.0)
        self.assertEqual(note["silenced"], 0)

    def test_a_staff_the_app_silences_costs_the_played_f1_and_not_the_note_f1(self):
        notes = self.read_of(S.BARS[:3])
        for n in notes:
            if n["staff"] == 2:
                n["hand"] = "x"                          # the hand rule of issue 11
        r, note = A.judge_app(self.truth(), self.row(notes))
        self.assertEqual(r.metrics["omr.note_f1"], 1.0, "the engine read it all")
        self.assertLess(r.metrics["omr.played_f1"], 0.9, "the app plays only one hand")
        self.assertGreater(note["silenced"], 0)
        self.assertLess(r.metrics["omr.bar_exact"], 1.0)

    def test_the_apps_suspect_bars_are_judged_as_flags_by_measure_number(self):
        notes = [n for n in self.read_of(S.BARS[:3]) if not (n["m"] == 1 and n["staff"] == 2)]     # bar 2: no left hand
        wrong_bar_number = 2
        hit, _ = A.judge_app(self.truth(), self.row(notes, suspect=[wrong_bar_number]))
        self.assertEqual((hit.metrics["omr.flag.app.recall"], hit.metrics["omr.flag.app.precision"]), (1.0, 1.0))
        miss, _ = A.judge_app(self.truth(), self.row(notes, suspect=[]))
        self.assertEqual(miss.metrics["omr.flag.app.recall"], 0.0)
        self.assertIsNone(miss.metrics["omr.flag.app.precision"])
        noisy, _ = A.judge_app(self.truth(), self.row(notes, suspect=[1, 2, 3]))
        self.assertAlmostEqual(noisy.metrics["omr.flag.app.precision"], 1 / 3, places=5)

    def test_a_failed_import_is_every_rate_zero(self):
        r, note = A.judge_app(self.truth(), {"ok": False, "error": "PPP could not read notation on that file", "code": "no-notation"})
        self.assertFalse(r.ok)
        self.assertEqual(r.metrics["omr.played_f1"], 0.0)
        self.assertEqual(note["code"], "no-notation")

    def test_the_extra_bars_of_a_misread_page_are_wrong_and_the_staves_are_the_apps(self):
        r, _ = A.judge_app(self.truth(), self.row(self.read_of(S.BARS[:3]), measures=5, staves=1))
        self.assertEqual(r.metrics["omr.bar_count_exact"], 0.0)
        self.assertEqual(r.metrics["omr.parts_ok"], 0.0, "one staff where the truth has a grand staff")

    def test_projection_to_score_keeps_rests_hands_and_the_time_signature(self):
        notes = [pn(0, 0, 4, None, 1, "r", rest=True), pn(0, 0, 4, 48, 2, "x"), pn(0, 0, 4, 60, 1, "r")]
        played = A.projection_score(projection(notes, measures=1, time=(3, 4)), True)
        everything = A.projection_score(projection(notes, measures=1, time=(3, 4)), False)
        self.assertEqual(sum(1 for n in played.bars[0].notes if not n.rest), 1)
        self.assertEqual(sum(1 for n in everything.bars[0].notes if not n.rest), 2)
        self.assertEqual(sum(1 for n in played.bars[0].notes if n.rest), 1)
        self.assertEqual(played.time, "3/4")


if __name__ == "__main__":
    unittest.main()
