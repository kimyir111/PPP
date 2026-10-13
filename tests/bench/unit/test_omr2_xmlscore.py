"""omr-live-2: the raw MusicXML reader (tests/omr/omrbench/xmlscore.py). Standard library only, runs in the gate."""

import io
import os
import sys
import unittest
import zipfile
from fractions import Fraction as F

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import omr2_synth as S  # noqa: E402  (also puts tests/omr on sys.path)
from omrbench import xmlscore as X  # noqa: E402


def mxl(xml: str, container=True) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        if container:
            z.writestr("META-INF/container.xml", '<container><rootfiles><rootfile full-path="score/main.xml"/></rootfiles></container>')
            z.writestr("score/main.xml", xml)
        else:
            z.writestr("whatever.xml", xml)
    return buf.getvalue()


class Reading(unittest.TestCase):
    def test_notes_onsets_durations_staves_and_rests(self):
        s = X.parse_score(S.piano(S.BARS))
        self.assertEqual(len(s.bars), 6)
        self.assertEqual(s.structure, "2")
        self.assertEqual(s.time, "4/4")
        self.assertEqual(s.key, 0)
        b0 = s.bars[0]
        self.assertEqual(b0.len, F(4))
        rh = [(n.midi, n.on, n.dur) for n in b0.notes if n.staff == 0]
        self.assertEqual(rh, [(60, F(0), F(1)), (64, F(1), F(1)), (67, F(2), F(1)), (64, F(3), F(1))])
        lh = [(n.midi, n.on, n.dur) for n in b0.notes if n.staff == 1]
        self.assertEqual(lh, [(48, F(0), F(2)), (55, F(2), F(2))])
        self.assertTrue(any(n.rest for n in s.bars[4].notes))
        self.assertEqual(sum(1 for n in s.bars[5].notes if n.staff == 0), 3, "a chord is three notes at one onset")
        self.assertEqual({n.on for n in s.bars[5].notes if n.staff == 0}, {F(0)})

    def test_voices_sum_to_the_bar_and_the_end_is_the_last_note_end(self):
        s = X.parse_score(S.piano(S.BARS))
        for b in s.bars:
            self.assertEqual(sorted(v for v in b.voices.values()), [F(4), F(4)])
            self.assertEqual(b.end, F(4))

    def test_beams_are_read(self):
        s = X.parse_score(S.piano(S.BARS))
        self.assertTrue(any(n.beam for n in s.bars[2].notes))
        self.assertFalse(any(n.beam for n in s.bars[0].notes))

    def test_two_single_staff_parts_are_two_parts_and_staves_are_counted_across_parts(self):
        s = X.parse_score(S.piano(S.BARS, parts="split"))
        self.assertEqual(s.structure, "1x1")
        self.assertEqual({n.staff for b in s.bars for n in b.notes}, {0, 1})
        self.assertEqual({n.part for b in s.bars for n in b.notes}, {0, 1})
        self.assertEqual(len(s.bars), 6, "the bars of the parts sit on one grid")

    def test_a_doctype_with_an_external_dtd_is_not_fetched(self):
        s = X.parse_score(S.piano(S.BARS, doctype=True))
        self.assertEqual(len(s.bars), 6)

    def test_divisions_zero_is_read_as_one_or_repaired_from_type(self):
        halves = [(["C4:2", "E4:2"], ["C3:4"]), (["G4:2", "C5:2"], ["G2:4"])]
        xml = S.piano(halves, divisions=0)
        a = X.parse_score(xml)                       # as the app reads it: a half note is one quarter
        self.assertTrue(a.div0)
        self.assertEqual([n.dur for n in a.bars[0].notes if n.staff == 0], [F(1), F(1)])
        self.assertEqual(a.bars[0].end, F(2), "a half-full bar")
        r = X.parse_score(xml, divisions="repair")   # the fix G12-1 makes
        self.assertTrue(r.div0)
        self.assertEqual([n.dur for n in r.bars[0].notes if n.staff == 0], [F(2), F(2)])
        self.assertEqual(r.bars[0].end, F(4))
        self.assertFalse(X.parse_score(S.piano(S.BARS)).div0)

    def test_a_nonsense_divisions_value_does_not_crash(self):
        xml = S.piano(S.BARS[:1]).replace("<divisions>4</divisions>", "<divisions>x</divisions>")
        self.assertTrue(X.parse_score(xml).div0)

    def test_grace_and_cue_notes_and_unpitched_notes_are_skipped(self):
        xml = S.piano(S.BARS[:1]).replace("<note><pitch>", "<note><grace/><pitch>", 1)
        s = X.parse_score(xml)
        self.assertEqual(sum(1 for n in s.bars[0].notes if n.staff == 0), 3)

    def test_the_first_key_and_time_win(self):
        s = X.parse_score(S.piano(S.BARS, time=(3, 4), fifths=-2))
        self.assertEqual((s.time, s.key), ("3/4", -2))
        self.assertEqual(s.bars[0].len, F(3))

    def test_additive_time_uses_the_first_number(self):
        xml = S.piano(S.BARS[:1]).replace("<beats>4</beats>", "<beats>2+2</beats>")
        self.assertEqual(X.parse_score(xml).bars[0].len, F(2))

    def test_errors_are_scoreerror(self):
        for bad in ("not xml", "<score-timewise/>", "<a><b></a>"):
            with self.assertRaises(X.ScoreError):
                X.parse_score(bad)
        with self.assertRaises(ValueError):
            X.parse_score(S.piano(S.BARS), divisions="nonsense")


class Files(unittest.TestCase):
    def test_mxl_with_a_container(self):
        xml = S.piano(S.BARS)
        self.assertEqual(X.mxl_text(mxl(xml)), xml)

    def test_mxl_without_a_container_takes_the_first_xml(self):
        xml = S.piano(S.BARS)
        self.assertEqual(X.mxl_text(mxl(xml, container=False)), xml)

    def test_an_mxl_without_xml_is_an_error(self):
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as z:
            z.writestr("readme.txt", "x")
        with self.assertRaises(X.ScoreError):
            X.mxl_text(buf.getvalue())

    def test_read_text_handles_mxl_xml_and_bom(self):
        import tempfile
        xml = S.piano(S.BARS)
        with tempfile.TemporaryDirectory() as d:
            for name, data in (("a.mxl", mxl(xml)), ("b.musicxml", xml.encode("utf-8")), ("c.xml", b"\xef\xbb\xbf" + xml.encode("utf-8"))):
                p = os.path.join(d, name)
                with open(p, "wb") as h:
                    h.write(data)
                self.assertEqual(len(X.parse_score(X.read_text(p)).bars), 6, name)


class Joining(unittest.TestCase):
    def test_pages_are_joined_bar_after_bar_with_the_first_pages_parts_key_and_time(self):
        a = X.parse_score(S.piano(S.BARS[:3], time=(4, 4), fifths=1))
        b = X.parse_score(S.piano(S.BARS[3:], time=(3, 4), fifths=-1))
        j = X.join([a, b])
        self.assertEqual(len(j.bars), 6)
        self.assertEqual((j.key, j.time, j.structure), (1, "4/4", "2"))

    def test_a_missing_key_reads_as_zero_and_nothing_to_join_is_an_error(self):
        s = X.parse_score(S.piano(S.BARS[:1]).replace("<key><fifths>0</fifths></key>", ""))
        self.assertEqual(X.join([s]).key, 0)
        with self.assertRaises(X.ScoreError):
            X.join([])


if __name__ == "__main__":
    unittest.main()
