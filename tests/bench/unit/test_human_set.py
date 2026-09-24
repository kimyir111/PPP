"""The G3 human review set's tools (docs/GOALS/G03 §21, A36; blind since §29 M4): the excerpt a reviewer sees, what
normalizing it removes, and the verdict on a review read through the answer key."""
import unittest

from pppbench import human_set, musicxml

XML = """<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
<part id="P1">
<measure number="1"><attributes><divisions>1</divisions><key><fifths>2</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes>
<note><pitch><step>D</step><octave>5</octave></pitch><duration>4</duration><voice>1</voice><type>whole</type><staff>1</staff></note></measure>
<measure number="2"><attributes><clef number="2"><sign>G</sign><line>2</line></clef></attributes><note><pitch><step>E</step><octave>5</octave></pitch><duration>4</duration><voice>1</voice><type>whole</type><staff>1</staff></note></measure>
<measure number="3"><note><pitch><step>F</step><alter>1</alter><octave>5</octave></pitch><duration>4</duration><voice>1</voice><type>whole</type><staff>1</staff></note></measure>
</part></score-partwise>"""


class Excerpt(unittest.TestCase):
    def test_the_excerpt_opens_with_what_is_in_force_there(self):
        out = human_set.excerpt(XML, 2, 1)
        canon = musicxml.read_score(out)
        self.assertEqual(len(canon.measures), 1)
        self.assertEqual(canon.measures[0].fifths, 2)
        self.assertEqual(tuple(canon.measures[0].time), (4, 4))
        self.assertIn('<measure number="3">', out)
        self.assertIn("<divisions>1</divisions>", out)
        # the second staff's clef is the treble clef measure 2 changed it to
        self.assertEqual(out.count("<sign>G</sign>"), 2)

    def test_a_first_measure_keeps_its_own_attributes(self):
        self.assertEqual(musicxml.read_score(human_set.excerpt(XML, 0, 2)).measures[0].fifths, 2)


NOISY = """<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0"><work><work-title>Sonatina</work-title></work><identification><creator type="composer">Clementi</creator><encoding><software>MuseScore 4</software></encoding></identification><defaults><scaling><millimeters>7</millimeters><tenths>40</tenths></scaling></defaults><credit page="1"><credit-words>Sonatina</credit-words></credit>
<part-list><score-part id="P1"><part-name print-object="no">Pno.</part-name><part-abbreviation>Pno.</part-abbreviation><score-instrument id="P1-I1"><instrument-name>Piano</instrument-name></score-instrument></score-part></part-list>
<part id="P1">
<measure number="12" width="300"><print new-system="yes"/><attributes><divisions>2</divisions><key><fifths>0</fifths></key><time><beats>2</beats><beat-type>4</beat-type></time><staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes>
<direction placement="below"><direction-type><dynamics><p/></dynamics></direction-type></direction>
<note default-x="80"><pitch><step>C</step><octave>5</octave></pitch><duration>2</duration><tie type="start"/><voice>1</voice><type>quarter</type><staff>1</staff><notations><tied type="start"/><slur type="start"/><technical><fingering>1</fingering></technical></notations><lyric><text>la</text></lyric></note>
<note><pitch><step>C</step><octave>5</octave></pitch><duration>2</duration><tie type="stop"/><voice>1</voice><type>quarter</type><staff>1</staff><notations><tied type="stop"/><slur type="stop"/></notations></note>
</measure></part></score-partwise>"""


class Normalize(unittest.TestCase):
    def test_what_would_tell_the_versions_apart_is_gone(self):
        out = human_set.normalize(NOISY, "E07-Y")
        for gone in ("Sonatina", "Clementi", "MuseScore", "<defaults", "<credit", "Pno.", "score-instrument", "<print",
                     "<direction", "<slur", "fingering", "<lyric", "default-x", "width="):
            self.assertNotIn(gone, out)
        self.assertIn("<movement-title>E07-Y</movement-title>", out)
        self.assertIn("<part-name>Piano</part-name>", out)
        self.assertIn('<measure number="1">', out)

    def test_parts_without_ids_get_them(self):
        bare = NOISY.replace('<score-part id="P1">', "<score-part>").replace('<part id="P1">', "<part>")
        out = human_set.normalize(bare, "E02-Z")
        self.assertIn('<score-part id="P1">', out)
        self.assertIn('<part id="P1">', out)

    def test_what_the_review_judges_is_kept(self):
        before, after = musicxml.read_score(NOISY), musicxml.read_score(human_set.normalize(NOISY, "E01-X"))
        self.assertEqual([(x.midi, x.onset_q, x.dur_q) for x in before.notes], [(x.midi, x.onset_q, x.dur_q) for x in after.notes])
        out = human_set.normalize(NOISY, "E01-X")
        self.assertEqual(out.count("<tied "), 2)
        self.assertEqual(out.count("<tie "), 2)


def key(n=20):
    """A key where excerpt i's X, Y, Z are rotated through the three versions."""
    rot = ["ABC", "BCA", "CAB"]
    return {"excerpts": [{"id": f"E{i + 1:02d}", "versions": dict(zip("XYZ", rot[i % 3])), "ned": {"A": 1.0, "B": 0.9}}
                         for i in range(n)]}


def review(overall_b, rhythm_b_worse=0, b_ok=12, a_ok=6, n=20):
    k = key(n)
    excerpts, absolute = [], []
    for i, x in enumerate(k["excerpts"]):
        letter = {v: lab for lab, v in x["versions"].items()}
        ranks = {}
        for ax in human_set.AXES:
            r = {"A": 2, "B": 2, "C": 1}
            if ax == "overall":
                r = {"A": 3, "B": 2, "C": 1} if i < overall_b else {"A": 2, "B": 3, "C": 1}
            if ax == "rhythm" and i < rhythm_b_worse:
                r = {"A": 2, "B": 3, "C": 1}
            ranks[ax] = {letter[v]: rank for v, rank in r.items()}
        excerpts.append({"id": x["id"], "rank": ranks})
        absolute.append({"file": f"{x['id']}-{letter['B']}", "give": "yes" if i < b_ok else "no"})
        absolute.append({"file": f"{x['id']}-{letter['A']}", "give": "fix" if i < a_ok else "no"})
        absolute.append({"file": f"{x['id']}-{letter['C']}", "give": "yes"})
    return {"excerpts": excerpts, "absolute": absolute}, k


class Judge(unittest.TestCase):
    def verdict(self, rk):
        return [ok for _, ok, _ in human_set.judge(*rk)["lines"]]

    def test_a_review_that_meets_every_criterion(self):
        self.assertEqual(self.verdict(review(18)), [True, True, True, True])

    def test_seventeen_of_twenty_is_not_enough(self):
        self.assertFalse(self.verdict(review(17))[1])

    def test_one_rhythm_loss_fails(self):
        self.assertFalse(self.verdict(review(20, rhythm_b_worse=1))[2])

    def test_absolute_needs_more_g3a_than_g3_off(self):
        self.assertFalse(self.verdict(review(20, b_ok=6, a_ok=6))[3])

    def test_an_unranked_axis_or_unrated_file_is_reported(self):
        r, k = review(20)
        r["excerpts"][3]["rank"]["voices"]["Y"] = None
        self.assertFalse(self.verdict((r, k))[0])
        r, k = review(20)
        r["absolute"].pop()
        self.assertFalse(self.verdict((r, k))[0])

    def test_the_letters_mean_nothing_without_the_key(self):
        # the same ranks read through another key are another verdict: the review form alone does not decide
        r, k = review(20)
        other = {"excerpts": [dict(x, versions={"X": x["versions"]["Y"], "Y": x["versions"]["X"], "Z": x["versions"]["Z"]})
                              for x in k["excerpts"]]}
        self.assertNotEqual(self.verdict((r, k)), self.verdict((r, other)))


if __name__ == "__main__":
    unittest.main()
