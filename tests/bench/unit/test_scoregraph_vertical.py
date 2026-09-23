"""The ScoreGraph writer against what it writes (docs/GOALS/G01 A40, A42), read here from the files.

A42: W-DISPLAY-DURATION, which the graph gives an event printed as a value it does not last (issue 19: a rest
inside a triplet printed with its plain value), is counted again from each golden MusicXML: a <note> whose
<duration> is not what its <type>, <dot>s and <time-modification> say. A chord is one event: its <chord/>
notes are not counted again; grace notes have no duration.
A40: every smoke case's graph has no error, and notate.js --emit-graph leaves the results as they were.
"""

import io
import json
import os
import sys
import unittest
import xml.etree.ElementTree as ET
from contextlib import redirect_stdout
from fractions import Fraction

from pppbench import util

REPO = util.repo_root()
GOLDEN_XML = os.path.join(util.bench_root(), "golden", "expected")
SG_GOLDEN = os.path.join(REPO, "tests", "scoregraph", "golden")
TOOLS = os.path.join(REPO, "tests", "scoregraph", "tools")
TYPE_Q = {"maxima": 32, "long": 16, "breve": 8, "whole": 4, "half": 2, "quarter": 1, "eighth": Fraction(1, 2),
          "16th": Fraction(1, 4), "32nd": Fraction(1, 8), "64th": Fraction(1, 16), "128th": Fraction(1, 32)}


def display_mismatches(text: str) -> int:
    root = ET.fromstring(text)
    n = 0
    for part in root.iter("part"):
        divisions = None
        for measure in part.iter("measure"):
            for el in measure:
                if el.tag == "attributes" and el.findtext("divisions"):
                    divisions = int(el.findtext("divisions"))
                if el.tag != "note" or el.find("grace") is not None or el.find("chord") is not None:
                    continue
                typ = el.findtext("type")
                if typ is None:
                    continue
                value = Fraction(TYPE_Q[typ])
                dots = len(el.findall("dot"))
                value *= 2 - Fraction(1, 2 ** dots)
                tm = el.find("time-modification")
                if tm is not None:
                    value *= Fraction(int(tm.findtext("normal-notes")), int(tm.findtext("actual-notes")))
                if Fraction(int(el.findtext("duration")), divisions) != value:
                    n += 1
    return n


class DisplayDuration(unittest.TestCase):
    def test_counted_from_the_musicxml(self):
        keys = sorted(f[:-len(".musicxml")] for f in os.listdir(GOLDEN_XML) if f.endswith(".musicxml"))
        self.assertEqual(len(keys), 17)
        seen = 0
        for key in keys:
            with open(os.path.join(GOLDEN_XML, key + ".musicxml"), encoding="utf-8") as handle:
                counted = display_mismatches(handle.read())
            issues = util.load_json(os.path.join(SG_GOLDEN, key + ".issues.json"))
            self.assertEqual(issues["warnings"].get("W-DISPLAY-DURATION", 0), counted, key)
            seen += counted
        self.assertGreater(seen, 0, "the golden set holds issue 19 at least once")

    def test_the_counter_sees_a_triplet_rest_printed_plain(self):
        xml = ("<score-partwise><part id='P1'><measure number='1'><attributes><divisions>6</divisions></attributes>"
               "<note><rest/><duration>2</duration><type>eighth</type></note>"
               "<note><rest/><duration>2</duration><type>eighth</type><time-modification><actual-notes>3</actual-notes>"
               "<normal-notes>2</normal-notes></time-modification></note>"
               "<note><pitch><step>C</step><octave>4</octave></pitch><duration>9</duration><type>quarter</type><dot/></note>"
               "<note><chord/><pitch><step>E</step><octave>4</octave></pitch><duration>7</duration><type>quarter</type></note>"
               "</measure></part></score-partwise>")
        self.assertEqual(display_mismatches(xml), 1)


class SmokeGraphs(unittest.TestCase):
    def test_every_smoke_graph_has_no_error_and_emit_graph_changes_nothing(self):
        sys.path.insert(0, TOOLS)
        import graph_check
        buf = io.StringIO()
        with redirect_stdout(buf):
            code = graph_check.main(["--suite", "smoke"])
        self.assertEqual(code, 0, buf.getvalue())
        self.assertIn("smoke: 44 graphs, 44 without an error", buf.getvalue())


if __name__ == "__main__":
    unittest.main()
