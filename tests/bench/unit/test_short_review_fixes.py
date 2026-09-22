"""Regression tests for the short final review's findings (docs/GOALS/G00 §21).

S-M1: repeat signs and endings are read, compared as the app's play order in critical.structure, and golden
      calls a change of them STRUCTURAL_CHANGE (a fake middle repeat, a real one removed or moved).
S-M2: a prediction's implicit="yes" never excuses a short bar in the middle of the piece.
S-m1: golden sees which staff is which hand (<staves> removed).
S-m2: two short bars are one split bar only at a repeat sign (or where the truth splits the same way)."""

import re
import unittest

from pppbench import corpus, evaluate, musicxml, perform, semantic, tiers
from pppbench.metrics import readability, structure
from unit.helpers import canon, measure, note, rest, score_xml

BACKWARD = '<barline location="right"><bar-style>light-heavy</bar-style><repeat direction="backward"{}/></barline>'
FORWARD = '<barline location="left"><bar-style>heavy-light</bar-style><repeat direction="forward"/></barline>'
DOUBLE = '<barline location="right"><bar-style>light-light</bar-style></barline>'


def bars(n, extra=None, lh=True):
    """n 4/4 bars of quarter notes (left hand a whole note); extra[i] is appended to bar i."""
    out = []
    for b in range(n):
        rh = "".join(note("CDEFGAB"[(b + k) % 7], 5, 1) for k in range(4)) + (extra or {}).get(b, "")
        out.append(measure(rh, note("C", 3, 4, staff=2) if lh else "", number=b + 1, rh_len=4))
    return out


# ------------------------------------------------------------------ XML surgery on part 0 of a real reference
def _part0_measures(xml):
    p = re.search(r"<part\b[^>]*>", xml)
    end = xml.index("</part>", p.end())
    return [(m.start(), m.end()) for m in re.finditer(r"<measure\b.*?</measure>", xml[p.end():end], re.S)], p.end()


def edit_bar(xml, index, fn):
    spans, off = _part0_measures(xml)
    a, b = spans[index]
    return xml[:off + a] + fn(xml[off + a:off + b]) + xml[off + b:]


def add_backward(xml, index, times=None):
    t = f' times="{times}"' if times else ""
    return edit_bar(xml, index, lambda m: m[:-len("</measure>")] + BACKWARD.format(t) + "</measure>")


def drop_backward(xml, index):
    return edit_bar(xml, index, lambda m: re.sub(r'<repeat direction="backward"\s*/>', "", m))


def strip_repeats(xml):
    return re.sub(r"<repeat\b[^>]*/>|<ending\b[^>]*/>|<ending\b[^>]*>.*?</ending>", "", xml, flags=re.S)


class Reader(unittest.TestCase):
    def test_repeats_endings_and_styles_are_read_from_part_0(self):
        xml = score_xml([measure(FORWARD + note("C", 5, 4), number=1),
                         measure(note("D", 5, 4) + '<barline location="right"><ending number="1" type="start">1.</ending>'
                                 + BACKWARD.format(' times="3"')[len('<barline location="right">'):], number=2),
                         measure(note("E", 5, 4) + '<barline location="left"><bar-style>light-light</bar-style>'
                                 '<ending number="2" type="start"/></barline><barline location="right">'
                                 '<ending number="2" type="discontinue"/></barline>', number=3)], staves=1)
        # a second part's barlines are not the app's (it reads part 0 only)
        xml = xml.replace("</part></score-partwise>", '</part><part id="P2"><measure number="1">'
                          + note("C", 4, 4) + BACKWARD.format("") + "</measure></part></score-partwise>")
        c = musicxml.read_score(xml)
        self.assertEqual(c.measures[0].bar, {"repeatStart": True})
        self.assertEqual(c.measures[1].bar, {"endingNos": [1], "endingType": "start", "ending": "1.", "style": "light-heavy",
                                             "repeatEnd": 3})
        # a left bar line's style is not drawn by the app; "discontinue" leaves the bracket open
        self.assertEqual(c.measures[2].bar, {"endingNos": [2], "endingType": "start", "ending": "2.", "endingEnd": "open"})

    def test_play_order_follows_the_app(self):
        plain = canon(bars(4), staves=2)
        self.assertEqual(plain.app_play_order(), [0, 1, 2, 3])
        twice = canon(bars(4, {1: BACKWARD.format("")}))
        self.assertEqual(twice.app_play_order(), [0, 1, 0, 1, 2, 3])          # no forward repeat: from the start
        three = canon(bars(4, {1: FORWARD, 2: BACKWARD.format(' times="3"')}))
        self.assertEqual(three.app_play_order(), [0, 1, 2, 1, 2, 1, 2, 3])
        volta = canon(bars(5, {2: '<barline location="left"><ending number="1" type="start"/></barline>'
                                  + BACKWARD.format("").replace("<bar-style>", '<ending number="1" type="stop"/><bar-style>'),
                               3: '<barline location="left"><ending number="2" type="start"/></barline>'
                                  '<barline location="right"><ending number="2" type="stop"/></barline>'}))
        self.assertEqual(volta.app_play_order(), [0, 1, 2, 0, 1, 3, 4])

    def test_parity_compares_repeats_and_play_order(self):
        from unit.test_tiers import app_projection
        c = canon(bars(4, {1: BACKWARD.format("")}))
        proj = app_projection(c)
        for a, m in zip(proj["measures"], c.measures):
            a["bar"] = dict(m.bar) or None
        proj["visits"] = c.app_play_order()
        self.assertEqual(tiers.compare_projection(c, proj), [])
        proj["measures"][1]["bar"] = None
        proj["visits"] = [0, 1, 2, 3]
        diffs = tiers.compare_projection(c, proj)
        self.assertTrue(any("repeats/endings" in d for d in diffs))
        self.assertTrue(any("play order" in d for d in diffs))


def _ctx(pred, ref, kind):
    return {"pred": pred, "ref": ref, "kind": kind}


class PlayOrderMetric(unittest.TestCase):
    """S-M1 at the metric: the prediction must play what the truth plays."""

    def test_performed_input(self):
        ref = canon(bars(8, {0: "", 3: BACKWARD.format(""), 4: FORWARD, 7: BACKWARD.format("")}))
        ok = lambda pred: structure.play_order(_ctx(pred, ref, "T"))["struct.form.order_exact"]  # noqa: E731
        self.assertEqual(ok(canon(bars(8))), 1.0)                                  # no repeat: as performed
        self.assertEqual(ok(ref), 1.0)                                             # the reference's own repeats
        self.assertEqual(ok(canon(bars(8, {3: BACKWARD.format("")}))), 0.0)       # one of two repeats removed
        self.assertEqual(ok(canon(bars(8, {4: BACKWARD.format(""), 5: FORWARD, 7: BACKWARD.format("")}))), 0.0)  # moved
        self.assertEqual(ok(canon(bars(8, {3: BACKWARD.format(' times="3"'), 4: FORWARD, 7: BACKWARD.format("")}))), 0.0)
        plain = canon(bars(8))
        self.assertEqual(structure.play_order(_ctx(canon(bars(8, {3: BACKWARD.format("")})), plain, "T"))
                         ["struct.form.order_exact"], 0.0)                         # a fake middle repeat
        self.assertEqual(structure.play_order(_ctx(canon(bars(8, {3: BACKWARD.format("")})), plain, "T"))
                         ["struct.form.plays_per_bar"], 12 / 8)

    def test_score_read_from_a_score(self):
        ref = canon(bars(8, {3: BACKWARD.format("")}))
        ok = lambda pred: structure.play_order(_ctx(pred, ref, "S"))["struct.form.order_exact"]  # noqa: E731
        self.assertEqual(ok(ref), 1.0)
        self.assertEqual(ok(canon(bars(8))), 0.0)                                  # the real repeat removed
        self.assertEqual(ok(canon(bars(8, {4: BACKWARD.format("")}))), 0.0)       # moved a bar later
        self.assertEqual(structure.play_order(_ctx(canon(bars(9)), canon(bars(8)), "S"))["struct.form.order_exact"], 1.0)


class RealReference(unittest.TestCase):
    """S-M1 end to end on a core reference with two repeated sections (czerny599/027: :| after bar 4, |: before
    bar 5, :| after bar 8), scored like final_oracle's ideal output against the benchmark's performance."""

    @classmethod
    def setUpClass(cls):
        rid = "method/czerny599/027"
        cls.e = corpus.by_id(corpus.load_corpus())[rid]
        cls.ref = corpus.read_reference(cls.e)
        cls.p = perform.perform(cls.ref, rid, "deadpan", "oracle", 1, expect=cls.e.expect)
        t = corpus.expected_time(cls.e, cls.ref)
        cls.stats = {"barStarts": [cls.p.timemap.sec(m.start_q) for m in cls.ref.measures] + [cls.p.timemap.sec(cls.ref.end_q)],
                     "beats": list(cls.p.input["beats"]), "beatsPerBar": t[0], "beatType": t[1]}
        cls.raw = musicxml.read_bytes(cls.e.abspath).decode("utf-8")
        cls.expected = {"qpm": corpus.expected_qpm(cls.e, cls.ref), "time": list(t), "key": corpus.expected_key(cls.e, cls.ref),
                        "measures": len(cls.ref.measures), "bar_starts": []}

    def timed(self, xml):
        return evaluate.evaluate_timed(self.ref, self.p, {"ok": True, "xml": xml.encode("utf-8"), "stats": self.stats},
                                       skip_metrics=self.e.expect.get("skip_metrics", ()))[0]

    def symbolic(self, xml):
        return evaluate.evaluate_symbolic(self.ref, musicxml.read_score(xml), self.expected)[0]

    def label(self, xml):
        return semantic.classify(semantic.projection(musicxml.read_score(self.raw)),
                                 semantic.projection(musicxml.read_score(xml)))[0]

    def assert_caught(self, xml, timed=True):
        if timed:
            m = self.timed(xml)
            self.assertEqual((m["struct.form.order_exact"], m["critical.structure"], m["usable"]), (0.0, 0.0, 0.0))
        s = self.symbolic(xml)
        self.assertEqual((s["struct.form.order_exact"], s["critical.structure"], s["usable"]), (0.0, 0.0, 0.0))
        self.assertEqual(self.label(xml), "STRUCTURAL_CHANGE")

    def test_the_reference_has_its_repeats(self):
        self.assertEqual([m.index for m in self.ref.measures if m.bar.get("repeatEnd")], [3, 7])
        self.assertEqual(self.ref.app_play_order(), [0, 1, 2, 3, 0, 1, 2, 3, 4, 5, 6, 7, 4, 5, 6, 7])

    def test_right_outputs_are_perfect(self):
        for xml in (self.raw, strip_repeats(self.raw)):     # as printed; as performed (no repeat taken)
            m = self.timed(xml)
            self.assertEqual((m["struct.form.order_exact"], m["read.bar_completeness"], m["usable"], m["sqi"]),
                             (1.0, 1.0, 1.0, 100.0))
        self.assertEqual(self.symbolic(self.raw)["struct.form.order_exact"], 1.0)
        self.assertEqual(self.label(self.raw), None)

    def test_fake_middle_repeat(self):
        self.assert_caught(add_backward(self.raw, 1))

    def test_real_repeat_removed(self):
        self.assert_caught(drop_backward(self.raw, 3))
        self.assert_caught(drop_backward(self.raw, 7))
        # every repeat removed: what was performed, right for the recording, wrong against the printed score
        linear = strip_repeats(self.raw)
        self.assertEqual(self.timed(linear)["struct.form.order_exact"], 1.0)
        self.assertEqual(self.symbolic(linear)["struct.form.order_exact"], 0.0)
        self.assertEqual(self.label(linear), "STRUCTURAL_CHANGE")

    def test_repeat_moved(self):
        self.assert_caught(add_backward(drop_backward(self.raw, 3), 2))

    def test_repeat_times_changed(self):
        self.assert_caught(re.sub(r'<repeat direction="backward"\s*/>', '<repeat direction="backward" times="3"/>',
                                  self.raw, count=2))


class ImplicitNeverExcuses(unittest.TestCase):
    """S-M2: the prediction cannot switch the complete-bar check off with implicit="yes"."""

    def score(self, implicit_inner, short="rh"):
        out = []
        for b in range(4):
            inner = 0 < b < 3
            rh = note("C", 5, 1) + (rest(2) if inner and short else rest(3))
            lh = note("C", 3, 3 if inner and short == "both" else 4, staff=2)
            out.append(measure(rh, lh, number=b + 1, rh_len=3 if inner and short else 4,
                               implicit=implicit_inner and inner))
        return canon(out)

    def test_inner_implicit_short_bars_are_incomplete(self):
        for implicit in (False, True):
            c = self.score(implicit)
            self.assertEqual(readability.bar_completeness_detail(c)["bad"],
                             [{"bar": 2, "kind": "staff short"}, {"bar": 3, "kind": "staff short"}], implicit)
            self.assertEqual(readability.bar_completeness_detail(c, truth=canon(bars(4)))["bad"],
                             [{"bar": 2, "kind": "staff short"}, {"bar": 3, "kind": "staff short"}], implicit)
        both = self.score(True, short="both")
        self.assertTrue(all(m.implicit for m in both.measures[1:3]))
        self.assertEqual(readability.bar_completeness_detail(both, truth=canon(bars(4)))["bad"],
                         [{"bar": 2, "kind": "bar short"}, {"bar": 3, "kind": "bar short"}])

    def test_a_pickup_is_still_a_pickup(self):
        pick = [measure(note("G", 4, 1), note("C", 3, 1, staff=2), number=0, implicit=True, rh_len=1)] + bars(3)
        self.assertEqual(readability.bar_completeness_detail(canon(pick))["bad"], [])


class SplitNeedsARepeat(unittest.TestCase):
    """S-m2: two short bars that add up to one are a split bar only where the music splits it."""

    @staticmethod
    def split_at(i, mark="", lh=True):
        out = []
        for b in range(5):
            if b in (i, i + 1):
                rh = note("D", 5, 2) + (mark if b == i else "")
                out.append(measure(rh, note("C", 3, 2, staff=2) if lh else "", number=b + 1, rh_len=2))
            else:
                out.append(measure(note("C", 5, 4), note("C", 3, 4, staff=2) if lh else "", number=b + 1, rh_len=4))
        return canon(out)

    def test_fake_split_half_measures(self):
        fake = self.split_at(2)
        bad = [{"bar": 3, "kind": "bar short"}, {"bar": 4, "kind": "bar short"}]
        self.assertEqual(readability.bar_completeness_detail(fake)["bad"], bad)
        self.assertEqual(readability.bar_completeness_detail(fake, truth=canon(bars(4)))["bad"], bad)
        # a double bar line the prediction writes excuses nothing (nothing checks where it writes one)
        self.assertEqual(readability.bar_completeness_detail(self.split_at(2, DOUBLE), truth=canon(bars(4)))["bad"], bad)

    def test_split_at_a_repeat_or_where_the_truth_splits(self):
        at_repeat = self.split_at(2, BACKWARD.format(""))
        self.assertEqual(readability.bar_completeness_detail(at_repeat)["bad"], [])
        self.assertEqual(readability.bar_completeness_detail(at_repeat, truth=canon(bars(4)))["bad"], [])
        # a reference's section end ("Fine") splits a bar; a prediction reproducing that split is right
        fine = self.split_at(2, DOUBLE)
        self.assertEqual(readability.bar_completeness_detail(fine)["bad"], [])
        self.assertEqual(readability.bar_completeness_detail(self.split_at(2), truth=fine)["bad"], [])
        # ... and so is one that writes the reference's repeat-split bars without the repeat (as performed)
        self.assertEqual(readability.bar_completeness_detail(self.split_at(2), truth=at_repeat)["bad"], [])
        # the truth's own split must be excused for a prediction to borrow it
        self.assertEqual(len(readability.bar_completeness_detail(self.split_at(2), truth=self.split_at(2))["bad"]), 2)


class GoldenSeesHandsAndRepeats(unittest.TestCase):
    def label(self, a, b):
        return semantic.classify(semantic.projection(musicxml.read_score(a)), semantic.projection(musicxml.read_score(b)))[0]

    def test_staves_removed_is_structural(self):
        xml = score_xml(bars(4))
        c = musicxml.read_score(xml.replace("<staves>2</staves>", ""))
        self.assertEqual({n.hand for n in c.notes if n.staff == 2}, {"x"})     # the app shows it and never plays it
        self.assertEqual(self.label(xml, xml.replace("<staves>2</staves>", "")), "STRUCTURAL_CHANGE")

    def test_repeat_changes_are_structural(self):
        plain = score_xml(bars(4))
        once = score_xml(bars(4, {1: BACKWARD.format("")}))
        self.assertEqual(self.label(plain, once), "STRUCTURAL_CHANGE")                                  # added
        self.assertEqual(self.label(once, plain), "STRUCTURAL_CHANGE")                                  # removed
        self.assertEqual(self.label(once, score_xml(bars(4, {2: BACKWARD.format("")}))), "STRUCTURAL_CHANGE")   # moved
        self.assertEqual(self.label(once, score_xml(bars(4, {1: BACKWARD.format(' times="3"')}))), "STRUCTURAL_CHANGE")
        _, lines = semantic.classify(semantic.projection(musicxml.read_score(plain)),
                                     semantic.projection(musicxml.read_score(once)))
        self.assertTrue(any("play order: 4 bars played -> 6" in x for x in lines), lines)
        self.assertEqual(self.label(once, once.replace("><", ">\n<")), None)                          # formatting only


if __name__ == "__main__":
    unittest.main()
