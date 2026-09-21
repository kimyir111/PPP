import os
import unittest

from pppbench import musicxml, util

ROOT = util.repo_root()


def path(*p):
    return os.path.join(ROOT, *p)


class ReaderOnRepositoryFiles(unittest.TestCase):
    def test_prelude_fragment(self):
        c = musicxml.read_score(path("samples", "prelude-fragment.musicxml"))
        self.assertEqual(len(c.measures), 8)
        self.assertEqual(c.measures[0].time, (3, 4))
        self.assertEqual(c.measures[0].fifths, 1)
        self.assertEqual(c.effective_qpm, 72.0)
        self.assertEqual(c.app_qpm, 72)
        self.assertEqual(len(c.notes), 38)
        # one tie joins two written notes into one key press
        self.assertEqual(len(c.sounding), 37)
        self.assertEqual(sum(1 for s in c.sounding if s.pieces == 2), 1)
        self.assertEqual(c.staves, 2)

    def test_mxl(self):
        c = musicxml.read_score(path("catalog", "method", "beyer", "008.mxl"))
        self.assertGreater(len(c.sounding), 8)
        self.assertTrue(c.source_sha256)
        self.assertEqual(c.measures[0].start_q, 0)
        for a, b in zip(c.measures, c.measures[1:]):
            self.assertEqual(b.start_q, a.start_q + a.len_q)

    def test_to_json_round_numbers(self):
        c = musicxml.read_score(path("samples", "prelude-fragment.musicxml"))
        text = util.dumps_json(c)
        self.assertIn('"schema": "ppp.canonical-score/1"', text)

    def test_errors(self):
        with self.assertRaises(musicxml.ReaderError) as e:
            musicxml.read_score("<score-timewise/>")
        self.assertEqual(e.exception.code, "timewise")
        with self.assertRaises(musicxml.ReaderError) as e:
            musicxml.read_score("<score-partwise><part-list/></score-partwise>")
        self.assertEqual(e.exception.code, "no-parts")
        with self.assertRaises(musicxml.ReaderError) as e:
            musicxml.read_score("<score-partwise><part id='P1'></part></score-partwise>")
        self.assertEqual(e.exception.code, "no-measures")
        with self.assertRaises(musicxml.ReaderError) as e:
            musicxml.read_score("<score-partwise><part id='P1'><measure number='1'><note><rest/><duration>4</duration></note></measure></part></score-partwise>")
        self.assertEqual(e.exception.code, "no-notes")
        with self.assertRaises(musicxml.ReaderError) as e:
            musicxml.read_score("<score-partwise><part")
        self.assertEqual(e.exception.code, "bad-xml")


if __name__ == "__main__":
    unittest.main()
