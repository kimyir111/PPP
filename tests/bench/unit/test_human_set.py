"""The G3 human review set's tools (docs/GOALS/G03 §21, A36): the excerpt a reviewer sees and the verdict on a review."""
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


def review(overall_b, rhythm_b_worse=0, b_ok=12, a_ok=6, n=20):
    pairs = []
    for i in range(n):
        left, right = ("A", "B") if i % 2 else ("B", "A")
        b_side, a_side = ("left", "right") if left == "B" else ("right", "left")
        ov = b_side if i < overall_b else a_side
        rh = a_side if i < rhythm_b_worse else "same"
        pairs.append({"id": f"HG{i + 1:02d}", "left": left, "right": right, "rhythm": rh, "voices": "same", "spelling": "same", "overall": ov})
    absolute = [{"id": f"HG{i + 1:02d}", "version": "B", "give": "yes" if i < b_ok else "no"} for i in range(n)]
    absolute_a = [{"id": f"HG{i + 1:02d}", "version": "A", "give": "fix" if i < a_ok else "no"} for i in range(n)]
    return {"pairs": pairs, "absolute": absolute, "absolute_A": absolute_a}


INDEX = [{"id": f"HG{i + 1:02d}", "ned": {"A": 1.0, "B": 0.9}} for i in range(20)]


class Judge(unittest.TestCase):
    def verdict(self, r):
        return [ok for _, ok, _ in human_set.judge(r, INDEX)["lines"]]

    def test_a_review_that_meets_every_criterion(self):
        self.assertEqual(self.verdict(review(18)), [True, True, True, True])

    def test_seventeen_of_twenty_is_not_enough(self):
        self.assertFalse(self.verdict(review(17))[1])

    def test_one_rhythm_loss_fails(self):
        self.assertFalse(self.verdict(review(20, rhythm_b_worse=1))[2])

    def test_absolute_needs_more_b_than_a(self):
        self.assertFalse(self.verdict(review(20, b_ok=6, a_ok=6))[3])

    def test_an_unjudged_pair_is_reported(self):
        r = review(20)
        r["pairs"][3]["voices"] = None
        self.assertFalse(self.verdict(r)[0])


if __name__ == "__main__":
    unittest.main()
