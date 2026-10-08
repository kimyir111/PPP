"""omr-live-2: the truth export and the case list (tests/omr/omrbench/truth.py, cases.py, tests/omr/cases.json). Standard library only."""

import hashlib
import json
import os
import sys
import unittest
import xml.etree.ElementTree as ET

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import omr2_synth as S  # noqa: E402  (puts tests/omr on sys.path)
from omrbench import cases as C  # noqa: E402
from omrbench import truth as T  # noqa: E402
from omrbench import xmlscore as X  # noqa: E402
from pppbench import util  # noqa: E402

REPO = util.repo_root()


def src(rel):
    return os.path.join(REPO, rel)


class TruthExport(unittest.TestCase):
    def test_the_first_bars_of_every_part_and_nothing_else_changed(self):
        text, info = T.cut_excerpt(S.piano(S.BARS), 4)
        self.assertEqual(info, {"bars_total": 6, "bars": 4})
        a, b = X.parse_score(S.piano(S.BARS)), X.parse_score(text)
        self.assertEqual(len(b.bars), 4)
        for x, y in zip(a.bars, b.bars):
            self.assertEqual([(n.midi, n.on, n.dur, n.staff, n.rest) for n in x.notes], [(n.midi, n.on, n.dur, n.staff, n.rest) for n in y.notes])

    def test_a_shorter_piece_is_whole(self):
        text, info = T.cut_excerpt(S.piano(S.BARS[:3]), 24)
        self.assertEqual(info, {"bars_total": 3, "bars": 3})
        self.assertEqual(len(X.parse_score(text).bars), 3)

    def test_print_hints_and_credits_go_and_the_work_title_stays(self):
        xml = ('<score-partwise version="3.1"><work><work-title>T</work-title></work><credit page="1"><credit-words>Title</credit-words></credit>'
               '<part-list><score-part><part-name>P</part-name></score-part></part-list><part>'
               '<measure number="1"><print new-system="yes"/><attributes><divisions>1</divisions></attributes>'
               '<note><rest/><duration>4</duration></note></measure></part></score-partwise>')
        text, _ = T.cut_excerpt(xml, 24)
        root = ET.fromstring(text)
        self.assertIsNone(root.find("credit"))
        self.assertIsNone(root.find(".//print"))
        self.assertEqual(root.find("work/work-title").text, "T")
        self.assertEqual(root.find("part-list/score-part").get("id"), "P1", "an engraver needs the ids")
        self.assertEqual(root.find("part").get("id"), "P1")

    def test_a_score_that_is_not_partwise_is_refused(self):
        for bad in ("<score-timewise/>", "nope"):
            with self.assertRaises(X.ScoreError):
                T.cut_excerpt(bad)

    def test_the_bytes_are_the_same_in_every_run_and_in_any_order(self):
        paths = ["catalog/hymns/silent-night.musicxml", "catalog/method/beyer/012.mxl", "catalog/method/sonatina/001.mxl"]
        paths = [p for p in paths if os.path.isfile(src(p))]
        self.assertGreaterEqual(len(paths), 3)

        def run(order):
            return {p: T.sha256(T.export_bytes(src(p), 24)[0]) for p in order}
        a, b, c = run(paths), run(list(reversed(paths))), run(paths[1:] + paths[:1])
        self.assertEqual(a, b)
        self.assertEqual(a, c)

    def test_no_carriage_returns_and_no_byte_order_mark_whatever_the_source_has(self):
        data, _ = T.export_bytes(src("catalog/hymns/silent-night.musicxml"), 12)
        self.assertNotIn(b"\r", data)
        self.assertFalse(data.startswith(b"\xef\xbb\xbf"))
        self.assertTrue(data.startswith(b"<score-partwise"))


class CaseList(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.doc = C.load()
        cls.cases = cls.doc["cases"]
        with open(C.REFERENCES, encoding="utf-8") as h:
            cls.refs = {r["id"]: r for r in json.load(h)["references"]}
        with open(C.EXCLUDED, encoding="utf-8") as h:
            cls.excluded = {x["id"] for x in json.load(h)["excluded"]}

    def test_the_committed_list_is_what_the_registry_gives(self):
        self.assertEqual(C.dumps(C.build()), C.dumps(self.doc), "run `python -I tests/omr/omrbench/cases.py --write` and look at the diff")

    def test_sixty_excerpts_of_licence_clean_catalogue_files(self):
        self.assertEqual(len(self.cases), C.TOTAL)
        ids = [c["id"] for c in self.cases]
        self.assertEqual(len(set(ids)), len(ids))
        for c in self.cases:
            r = self.refs[c["id"]]
            self.assertFalse(r["holdout"], c["id"] + " is a G0 hold-out file")
            self.assertNotIn(c["id"], self.excluded, c["id"] + " is quarantined")
            self.assertIn(r["set"], C.SETS)
            self.assertEqual(c["source_sha256"], r["sha256"])
            self.assertEqual(c["path"], r["path"])
            self.assertRegex(r["license"], r"(?i)public domain|cc0|dedicated to the public domain|pd")
            self.assertEqual(c["bars"], min(24, c["bars_total"]))

    def test_the_sources_are_the_files_the_registry_pinned(self):
        for c in self.cases:
            self.assertEqual(util.content_sha256(src(c["path"])), c["source_sha256"], c["id"])

    def test_the_section_one_pages_are_all_in(self):
        for i in C.S1:
            self.assertIn(i, [c["id"] for c in self.cases])
        self.assertEqual(sum("s1" in c["tags"] for c in self.cases), 15)
        self.assertEqual(sum("s1-app" in c["tags"] for c in self.cases), 6)

    def test_every_metre_and_key_of_the_pool_is_present(self):
        pool = C.pool()
        want_t = {p["time"] for p in pool if p["bars_total"] >= C.MIN_BARS_COVERAGE}
        want_k = {p["fifths"] for p in pool if p["bars_total"] >= C.MIN_BARS_COVERAGE}
        self.assertEqual(want_t - {c["time"] for c in self.cases}, set())
        self.assertEqual(want_k - {c["fifths"] for c in self.cases}, set())

    def test_the_collections_hold_their_quota(self):
        got = {}
        for c in self.cases:
            k = C.collection_of(c["id"])
            got[k] = got.get(k, 0) + 1
        for k, n in C.QUOTA.items():
            self.assertGreaterEqual(got.get(k, 0), n, k)

    def test_thirty_percent_is_held_out_and_the_split_is_a_function_of_the_ids(self):
        held = [c["id"] for c in self.cases if c["split"] == "held"]
        self.assertEqual(len(held), 18)
        self.assertEqual(C.split_of([c["id"] for c in self.cases]), {c["id"]: c["split"] for c in self.cases})
        self.assertEqual(C.split_of(list(reversed([c["id"] for c in self.cases]))), {c["id"]: c["split"] for c in self.cases})

    def test_selection_is_deterministic_and_does_not_read_the_order(self):
        pool = C.pool()
        a = C.select(pool)
        b = C.select(list(reversed(pool)))
        self.assertEqual(a, b)

    def test_the_brace_less_fixtures_are_the_g0_ones(self):
        fx = self.doc["fixtures"]
        self.assertEqual([f["path"] for f in fx], ["tests/fixtures/piano-clean.pdf", "tests/fixtures/piano-clean.png",
                                                    "tests/fixtures/piano-clean.jpg", "tests/fixtures/piano-multipage.pdf"])
        for f in fx:
            with open(src(f["path"]), "rb") as h:
                self.assertEqual(hashlib.sha256(h.read()).hexdigest(), f["sha256"], f["path"])
        s = X.parse_score(X.read_text(src(C.FIXTURE_TRUTH)))
        self.assertEqual((len(s.bars), s.structure), (8, "2"))
        self.assertEqual([f["engine"] for f in fx], [False, True, True, False], "Audiveris alone reads the two images; the PDFs are rasterised by the page")

    def test_excerpts_read_back_as_the_cases_say(self):
        for c in self.cases[:12]:
            data, info = T.export_bytes(src(c["path"]), c["bars"])
            s = X.parse_score(data.decode("utf-8"))
            self.assertEqual(len(s.bars), c["bars"], c["id"])
            self.assertEqual(s.time, c["time"], c["id"])
            self.assertEqual(s.key or 0, c["fifths"], c["id"])
            self.assertEqual(info["bars_total"], c["bars_total"], c["id"])


if __name__ == "__main__":
    unittest.main()
