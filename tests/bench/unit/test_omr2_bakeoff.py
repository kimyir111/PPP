"""omr-live-2, G12-6 (the AI-7 bake-off): the pure parts, offline, no engine.

  * omrbench/kern.py: the SMT's Humdrum **kern -> MusicXML, on valid kern and on the faults the model makes (a split it never wrote, a join
    of spines that are not there, a grace-note line), read back by the benchmark's own reader;
  * omrbench/bakeoff.py: gate A7 clause by clause, the timing figures, the held-out half judged once;
  * omrbench/realscan.py: the committed real-scan manifest's cases, split and truths;
  * omrbench/fetch_real.py: the Internet Archive's IMSLP mirror (only IMSLP's own file, only "Public Domain");
  * omrbench/engines.py: a runner that answers, one that hangs (stopped by PID, recorded timed out), one that dies inside a page;
  * suite.read_pages: a learned engine's plain MusicXML is read like Audiveris' .mxl.
"""

import io
import json
import os
import sys
import tempfile
import textwrap
import unittest
import zipfile
from fractions import Fraction as Fr

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import omr2_synth as S  # noqa: E402  (puts tests/omr on sys.path)
from omrbench import bakeoff as B  # noqa: E402
from omrbench import engines as EN  # noqa: E402
from omrbench import fetch_real as FR  # noqa: E402
from omrbench import kern as K  # noqa: E402
from omrbench import metrics as M  # noqa: E402
from omrbench import realscan as R  # noqa: E402
from omrbench import suite as SU  # noqa: E402
from omrbench import xmlscore as X  # noqa: E402


def notes(score, bar):
    return sorted((n.midi, n.on, n.dur, n.staff) for n in score.bars[bar].notes if not n.rest)


def rests(score, bar):
    return sorted((n.on, n.dur, n.staff) for n in score.bars[bar].notes if n.rest)


def read(kern_text):
    xml, counts = K.convert(kern_text)
    return X.parse_score(xml), counts


class KernTokens(unittest.TestCase):
    def test_recip_values(self):
        self.assertEqual(K.recip_quarters("4", 0), 1)
        self.assertEqual(K.recip_quarters("8", 1), Fr(3, 4))
        self.assertEqual(K.recip_quarters("2", 2), Fr(7, 2))
        self.assertEqual(K.recip_quarters("0", 0), 8)
        self.assertEqual(K.recip_quarters("12", 0), Fr(1, 3))
        self.assertEqual(K.recip_quarters("3%2", 0), Fr(8, 3))
        self.assertIsNone(K.recip_quarters("", 0))
        self.assertIsNone(K.recip_quarters("0%2", 0))

    def test_pitch_octaves_accidentals_and_signifiers(self):
        self.assertEqual(K.parse_note("4c"), (1, ("C", 0, 4), False))
        self.assertEqual(K.parse_note("4cc#"), (1, ("C", 1, 5), False))
        self.assertEqual(K.parse_note("16GG-Jk"), (Fr(1, 4), ("G", -1, 2), False))
        self.assertEqual(K.parse_note("(8.dL"), (Fr(3, 4), ("D", 0, 4), False))
        self.assertEqual(K.parse_note("4B"), (1, ("B", 0, 3), False))
        self.assertEqual(K.parse_note("4ee'"), (1, ("E", 0, 5), False))
        self.assertEqual(K.parse_note("2r"), (2, None, True))
        self.assertEqual(K.parse_note("rr"), (None, None, True))
        self.assertIsNone(K.parse_note("8qff#/"), "a grace note is not read")
        self.assertIsNone(K.parse_note(">"))
        self.assertEqual(K.key_fifths("*k[f#c#]"), 2)
        self.assertEqual(K.key_fifths("*k[b-e-a-]"), -3)
        self.assertEqual(K.meter("*M6/8"), (6, 8))
        self.assertEqual(K.clef("*clefF4"), ("F", 4))


VALID = "\n".join([
    "**kern\t**kern", "*clefF4\t*clefG2", "*k[f#]\t*k[f#]", "*M3/4\t*M3/4",
    "4G\t4b", "4d\t8cc", ".\t8dd", "4g\t4ee", "=\t=",
    "*\t*^", "2.G\t2b\t4gg", ".\t.\t4ff#", ".\t.\t4gg", "*\t*v\t*v", "=\t=",
    "2.r\t2.dd", "==\t==", "*-\t*-"])


class KernFiles(unittest.TestCase):
    def test_a_valid_file_is_read_note_for_note(self):
        s, counts = read(VALID)
        self.assertEqual(len(s.bars), 3)
        self.assertEqual(s.time, "3/4")
        self.assertEqual(s.key, 1)
        self.assertEqual(s.structure, "2")
        # staff 0 = the upper (the right spine), 1 = the lower; MusicXML staff 1 is the upper
        self.assertEqual(notes(s, 0), [(55, 0, 1, 1), (62, 1, 1, 1), (67, 2, 1, 1), (71, 0, 1, 0), (72, 1, Fr(1, 2), 0),
                                       (74, Fr(3, 2), Fr(1, 2), 0), (76, 2, 1, 0)])
        self.assertEqual(notes(s, 1), [(55, 0, 3, 1), (71, 0, 2, 0), (78, 1, 1, 0), (79, 0, 1, 0), (79, 2, 1, 0)])
        self.assertEqual(rests(s, 2), [(0, 3, 1)])
        self.assertEqual(counts["extra_fields"] + counts["bad_joins"] + counts["missing_fields"], 0)

    def test_it_reads_the_truth_back_through_the_metrics(self):
        s, _ = read(VALID)
        r = M.judge(s, read(VALID)[0])
        self.assertEqual(r.metrics["omr.bar_exact"], 1.0)

    def test_a_split_the_model_never_wrote_adds_a_voice_on_the_last_staff(self):
        text = "*clefF4\t*clefG2\n*M4/4\t*M4/4\n4C\t4c\t2e\n4D\t4d\t.\n2E\t2e\t2g\n=\t=\n"
        s, counts = read(text)
        self.assertEqual(counts["extra_fields"], 1)
        self.assertEqual(notes(s, 0), [(48, 0, 1, 1), (50, 1, 1, 1), (52, 2, 2, 1), (60, 0, 1, 0), (62, 1, 1, 0), (64, 0, 2, 0),
                                       (64, 2, 2, 0), (67, 2, 2, 0)])

    def test_a_join_of_spines_that_are_not_there_is_ignored(self):
        text = "*clefF4\t*clefG2\n*M2/4\t*M2/4\n4C\t4c\n4D\t4d\n*\t*v\t*v\n=\t=\n2E\t2e\n=\t=\n"
        s, counts = read(text)
        self.assertEqual(counts["bad_joins"], 1)
        self.assertEqual(len(s.bars), 2)
        self.assertEqual(notes(s, 1), [(52, 0, 2, 1), (64, 0, 2, 0)])

    def test_a_grace_line_takes_no_time_and_a_null_line_none_either(self):
        text = "**kern\t**kern\n*M2/4\t*M2/4\n.\t.\n.\t8qd\n4C\t4c\n4D\t4e\n=\t=\n"
        s, _ = read(text)
        self.assertEqual(notes(s, 0), [(48, 0, 1, 1), (50, 1, 1, 1), (60, 0, 1, 0), (64, 1, 1, 0)])

    def test_other_spines_and_staff_marks(self):
        text = "**kern\t**kern\t**dynam\n*staff2\t*staff1\t*\n*M2/4\t*M2/4\t*\n4C\t4c\tf\n4D\t4d\tp\n=\t=\t=\n"
        s, _ = read(text)
        self.assertEqual(notes(s, 0), [(48, 0, 1, 1), (50, 1, 1, 1), (60, 0, 1, 0), (62, 1, 1, 0)])

    def test_a_leading_bar_line_and_nothing_at_all(self):
        s, _ = read("*clefF4\t*clefG2\n*M2/4\t*M2/4\n=\t=\n2C\t2c\n=\t=\n")
        self.assertEqual(len(s.bars), 1)
        xml, counts = K.convert("")
        self.assertIn("<score-partwise", xml)

    def test_the_writer_places_every_note_at_its_onset(self):
        # a voice that starts late and two voices on a staff: forward / backup
        text = "*clefF4\t*clefG2\n*M4/4\t*M4/4\n*\t*^\n1C\t2r\t1g\n.\t2c\t.\n*\t*v\t*v\n=\t=\n"
        s, _ = read(text)
        self.assertEqual(notes(s, 0), [(48, 0, 4, 1), (60, 2, 2, 0), (67, 0, 4, 0)])
        self.assertEqual(rests(s, 0), [(0, 2, 0)])


class Gate(unittest.TestCase):
    REF = {"photo": {"omr.bar_exact": 0.40}, "real-scan": {"omr.bar_exact": 0.30}, "clean-A": {"omr.bar_exact": 0.70},
           "clean-B": {"omr.bar_exact": 0.75}}

    def eng(self, photo, real, ca, cb):
        return {"photo": {"omr.bar_exact": photo}, "real-scan": {"omr.bar_exact": real}, "clean-A": {"omr.bar_exact": ca},
                "clean-B": {"omr.bar_exact": cb}}

    def test_every_clause_passes_at_its_line(self):
        v = B.verdict("homr", self.eng(0.50, 0.40, 0.68, 0.73), self.REF, 60.0)
        self.assertTrue(v["pass"], v)
        self.assertIn("worker-side option", v["decision"])

    def test_each_clause_alone_fails_the_gate(self):
        cases = [self.eng(0.49, 0.40, 0.70, 0.75), self.eng(0.50, 0.39, 0.70, 0.75), self.eng(0.50, 0.40, 0.67, 0.75),
                 self.eng(0.50, 0.40, 0.70, 0.72)]
        for e in cases:
            v = B.verdict("homr", e, self.REF, 10.0)
            self.assertFalse(v["pass"], e)
            self.assertEqual(sum(not c["pass"] for c in v["clauses"]), 1, e)
            self.assertEqual(v["decision"], "do not adopt")
        self.assertFalse(B.verdict("homr", self.eng(0.9, 0.9, 0.9, 0.9), self.REF, 60.01)["pass"], "too slow")
        self.assertFalse(B.verdict("homr", self.eng(0.9, 0.9, 0.9, 0.9), self.REF, None)["pass"], "no time measured")
        self.assertFalse(B.verdict("unknown-engine", self.eng(0.9, 0.9, 0.9, 0.9), self.REF, 1.0)["pass"], "no licence known")

    def test_a_missing_tier_cannot_pass(self):
        e = self.eng(0.9, 0.9, 0.9, 0.9)
        del e["real-scan"]
        v = B.verdict("oemer", e, self.REF, 1.0)
        self.assertFalse(v["pass"])
        self.assertFalse(next(c for c in v["clauses"] if c.get("tier") == "real-scan")["pass"])

    def test_timing(self):
        self.assertEqual(B.timing([])["p90_s"], None)
        t = B.timing([1000 * i for i in range(1, 11)])
        self.assertEqual((t["pages"], t["median_s"], t["p90_s"], t["max_s"], t["mean_s"]), (10, 5.5, 9.0, 10.0, 5.5))
        self.assertEqual(B.timing([5000])["p90_s"], 5.0)

    def test_the_held_out_half_is_judged_once(self):
        with tempfile.TemporaryDirectory() as d:
            self.assertIsNone(B.held_already(d))
            B.mark_held(d, {"engines": ["audiveris", "homr"]})
            self.assertEqual(len(B.held_already(d)["runs"]), 1)
            B.mark_held(d, {"again": "a reason"})
            self.assertEqual(len(B.held_already(d)["runs"]), 2)
            out = io.StringIO()
            import contextlib
            with contextlib.redirect_stdout(out):
                rc = SU.main(["bakeoff", "--half", "held", "--out", d])
            self.assertEqual(rc, 2)
            self.assertIn("judged once", out.getvalue())
            with contextlib.redirect_stdout(out):
                self.assertEqual(SU.main(["bakeoff", "--half", "held", "--cases", "tag:s1", "--out", d]), 2, "never a part of the held-out half")


class RealScan(unittest.TestCase):
    def test_the_committed_manifest_makes_eighteen_cases_six_held_out(self):
        cs = R.cases()
        self.assertEqual(len(cs), 18)
        self.assertEqual(sum(c["split"] == "held" for c in cs), 6)
        self.assertEqual(sum(len(c["pdf_pages"]) for c in cs), 20)
        self.assertEqual([c["id"] for c in R.cases()], [c["id"] for c in cs], "deterministic")
        self.assertEqual(R.select(cs, "held"), [c for c in cs if c["split"] == "held"])
        self.assertEqual(R.select(cs, "s1"), [])
        self.assertEqual(len(R.select(cs, cs[0]["id"])), 1)

    def test_every_truth_is_the_catalogue_s_bars_and_no_piece_is_a_g0_hold_out(self):
        with open(os.path.join(R.REPO, "tests", "bench", "corpus", "references.json"), encoding="utf-8") as h:
            refs = {r["id"]: r for r in json.load(h)["references"]}
        paths = R._registry_paths()
        for c in R.cases():
            for r in c["rows"]:
                self.assertIn(r["piece"], refs, r)
                self.assertFalse(refs[r["piece"]].get("holdout"), r["piece"])
            t = R.truth(c, paths=paths)
            self.assertEqual(len(t.bars), c["bars"], c["id"])
            self.assertEqual(t.structure, "2")
            self.assertGreater(sum(1 for b in t.bars for n in b.notes if not n.rest), 100)
            for img in c["images"]:
                self.assertTrue(img.replace("\\", "/").split("/")[-1].startswith(c["entry"] + "-p"))

    def test_a_piece_over_two_pages_is_read_in_page_order(self):
        c = next(x for x in R.cases() if x["id"].endswith("p14-15"))
        self.assertEqual([r["piece"][-3:] for r in c["rows"]], ["026", "027", "028", "028", "029"])
        self.assertEqual([r["bars"] for r in c["rows"] if r["piece"].endswith("028")], [[1, 4], [5, 16]])


class Archive(unittest.TestCase):
    META = {"metadata": {"collection": ["imslp", "patron-library-collection"]},
            "files": [{"name": "PMLP1-x.pdf", "sha1": "a" * 40}, {"name": "other.pdf", "sha1": "b" * 40}]}
    RECS = {"extvals": {"Copyright": "Public Domain"}, "intvals": {"0": {"filename": "PMLP1-x.pdf"}, "sectionheaders": []}}

    def test_the_item_and_the_url(self):
        self.assertEqual(FR.archive_item("https://archive.org/download/imslp-x-op1/PMLP1-x.pdf"), ("imslp-x-op1", "PMLP1-x.pdf"))
        for bad in ("http://archive.org/download/a/b.pdf", "https://archive.org/details/a", "https://archive.org/download/a/b/c.pdf",
                    "https://evil.example/download/a/b.pdf", "https://archive.org/download/a%2F../b.pdf"):
            self.assertIsNone(FR.archive_item(bad), bad)

    def test_only_imslp_s_own_public_domain_file(self):
        self.assertTrue(FR.archive_licence_ok(self.META, self.RECS, "PMLP1-x.pdf", "a" * 40)[0])
        self.assertFalse(FR.archive_licence_ok(self.META, self.RECS, "PMLP1-x.pdf", "c" * 40)[0], "not IMSLP's bytes")
        self.assertFalse(FR.archive_licence_ok(self.META, self.RECS, "missing.pdf", "a" * 40)[0])
        for status in ("Public Domain - Non-PD EU", "Creative Commons Attribution 4.0", "", "Copyright"):
            recs = json.loads(json.dumps(self.RECS))
            recs["extvals"]["Copyright"] = status
            self.assertFalse(FR.archive_licence_ok(self.META, recs, "PMLP1-x.pdf", "a" * 40)[0], status)
        meta = json.loads(json.dumps(self.META))
        meta["metadata"]["collection"] = "texts"
        self.assertFalse(FR.archive_licence_ok(meta, self.RECS, "PMLP1-x.pdf", "a" * 40)[0], "not the IMSLP collection")
        self.assertFalse(FR.archive_licence_ok({}, self.RECS, "PMLP1-x.pdf", "a" * 40)[0])
        self.assertFalse(FR.archive_licence_ok(self.META, {}, "PMLP1-x.pdf", "a" * 40)[0])

    def test_the_evidence_page(self):
        html = "<td>New York: Schirmer, 1893. Plate 11038.</td><td>Copyright</td><td>Public Domain&#160;</td>"
        self.assertTrue(FR.evidence_says(html, "Plate 11038. Copyright Public Domain"))
        self.assertFalse(FR.evidence_says(html, "Plate 11039. Copyright Public Domain"))
        self.assertFalse(FR.evidence_says("", "x"))

    def test_an_archive_entry_needs_imslp_s_sha1_and_the_words(self):
        e = dict(FR.load_manifest()["entries"][1])
        self.assertEqual(e["source"], "archive")
        self.assertEqual(FR.check_manifest({"schema": FR.SCHEMA, "entries": [e]}), [])
        for k in ("sha1", "licence_text"):
            bad = dict(e)
            del bad[k]
            self.assertTrue(FR.check_manifest({"schema": FR.SCHEMA, "entries": [bad]}), k)


class Runners(unittest.TestCase):
    FAKE = textwrap.dedent('''
        import json, os, sys, time
        a = sys.argv
        jobs = json.load(open(a[a.index("--jobs") + 1]))
        for j in jobs:
            rec = os.path.join(j["out"], "engine.json")
            if os.path.isfile(rec) and "--force" not in a:
                print("SKIP " + j["key"], flush=True); continue
            mode = open(j["image"]).read().strip()
            print("START " + j["key"], flush=True)
            os.makedirs(j["out"], exist_ok=True)
            if mode == "hang":
                time.sleep(120)
            if mode == "die":
                os._exit(3)
            xml = os.path.join(j["out"], "page.musicxml")
            open(xml, "w").write("<score-partwise/>")
            json.dump({"engine": "fake", "ok": True, "files": [xml], "ms": 5, "image_sha256": "x"}, open(rec, "w"))
            print("DONE %s 5 ok" % j["key"], flush=True)
    ''')

    def tmp(self):
        t = tempfile.TemporaryDirectory()
        self.addCleanup(t.cleanup)
        return t.name

    @staticmethod
    def write(path, text):
        with open(path, "w", encoding="utf-8") as h:
            h.write(text)

    def run_fake(self, modes, timeout=3):
        d = self.tmp()
        runner = os.path.join(d, "fake_runner.py")
        self.write(runner, self.FAKE)
        jobs = []
        for i, m in enumerate(modes):
            img = os.path.join(d, f"p{i}.txt")
            self.write(img, m)
            jobs.append({"key": f"k{i}", "image": img, "out": os.path.join(d, f"out{i}")})
        res = EN.run_pages("homr", sys.executable, jobs, log=lambda *x: None, timeout=timeout, runner=runner, sample_gpu=False)
        return res, jobs

    def test_pages_are_read_and_recorded(self):
        res, _ = self.run_fake(["ok", "ok"])
        self.assertEqual(sorted(res["records"]), ["k0", "k1"])
        self.assertTrue(all(r["rc"] == 0 and len(r["mxl"]) == 1 for r in res["records"].values()))
        self.assertEqual(res["restarts"], 0)

    def test_a_page_that_hangs_is_stopped_and_the_rest_are_read(self):
        res, _ = self.run_fake(["ok", "hang", "ok"], timeout=3)
        r = res["records"]
        self.assertTrue(r["k1"]["timed_out"])
        self.assertEqual(r["k1"]["rc"], 1)
        self.assertEqual((r["k0"]["rc"], r["k2"]["rc"]), (0, 0))
        self.assertEqual(res["restarts"], 1)

    def test_a_runner_that_dies_inside_a_page(self):
        res, _ = self.run_fake(["die", "ok"])
        self.assertTrue(res["records"]["k0"]["crashed"])
        self.assertEqual(res["records"]["k1"]["rc"], 0)

    def test_a_runner_that_never_starts_is_an_error_not_a_loop(self):
        d = self.tmp()
        runner = os.path.join(d, "broken.py")
        self.write(runner, "import sys; print('no such module'); sys.exit(1)\n")
        with self.assertRaises(RuntimeError):
            EN.run_pages("homr", sys.executable, [{"key": "k", "image": runner, "out": os.path.join(d, "o")}], log=lambda *x: None,
                         timeout=5, runner=runner, sample_gpu=False)

    def test_the_record_shape(self):
        r = EN.to_record({"ok": True, "files": [__file__], "ms": 12, "cold": True, "peak_rss_mb": 3.0}, cached=True)
        self.assertEqual((r["rc"], r["mxl"], r["ms"], r["cold"], r["cached"]), (0, [__file__], 12, True, True))
        r = EN.to_record({"ok": False, "files": ["/nonexistent.xml"], "error": "x"}, cached=False)
        self.assertEqual((r["rc"], r["mxl"]), (1, []))
        self.assertEqual(sorted(EN.names()), ["homr", "oemer", "smt"])
        for n in EN.names():
            self.assertTrue(os.path.isfile(EN.runner_path(n)), n)
            self.assertTrue(B.LICENCE_OK_FOR_U1[n])


class PlainMusicXML(unittest.TestCase):
    def test_read_pages_reads_plain_musicxml_and_mxl_alike(self):
        xml = S.piano([(["C4:4"], ["C3:4"]), (["D4:4"], ["D3:4"])])
        with tempfile.TemporaryDirectory() as d:
            plain = os.path.join(d, "page.musicxml")
            with open(plain, "w", encoding="utf-8") as h:
                h.write(xml)
            mxl = os.path.join(d, "page.mxl")
            buf = io.BytesIO()
            with zipfile.ZipFile(buf, "w") as z:
                z.writestr("META-INF/container.xml", '<container><rootfiles><rootfile full-path="s.xml"/></rootfiles></container>')
                z.writestr("s.xml", xml)
            with open(mxl, "wb") as h:
                h.write(buf.getvalue())
            a = SU.read_pages([{"mxl": [plain]}])
            b = SU.read_pages([{"mxl": [mxl]}])
        self.assertEqual(len(a.bars), 2)
        self.assertEqual([notes(a, i) for i in range(2)], [notes(b, i) for i in range(2)])


if __name__ == "__main__":
    unittest.main()
