"""MusicXML -> ScoreGraph -> MusicXML judged by the app's reader and the notation inventory
(docs/GOALS/G01 §16.2, A21-A24, A22 over the corpus, A34).

The whole committed corpus is `run.py sg-roundtrip` (A32, A33); these tests run the G1 XML fixtures and the
G0 correctness fixtures through the same judge (L1 the G0 semantic projection, L1+ the notation inventory, L2 the
graph fixed point, the play order), check the allowlist fixtures still show their difference, and compare the
open ties the graph reports with the unpaired <tie> elements G0's own reader finds in every corpus file.
"""

import os
import re
import unittest

from pppbench import musicxml, notation_inventory, sg_roundtrip, util

REPO = util.repo_root()
XML = "tests/scoregraph/fixtures/xml/"
CORR = "tests/bench/corpus/correctness/"
ROUND = [XML + n + ".musicxml" for n in ("voices-4", "grand-staff", "cross-staff", "ties-slurs", "piano-marks", "tuplets-nested",
                                         "tempo-meter-key-changes", "transposing", "pickup-3-4", "repeats-simple", "repeats-times-3",
                                         "repeats-endings-1-2", "repeats-nested", "repeats-backward-only", "repeats-endings-12-3",
                                         "dropped")]
ROUND += [CORR + f for f in sorted(os.listdir(os.path.join(REPO, CORR))) if f.endswith(".musicxml")]


class FixtureRoundTrip(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.results = sg_roundtrip.run_files(ROUND)

    def test_every_fixture_passes_l1_l1plus_l2_and_the_play_order(self):
        for p in ROUND:
            r = self.results[p]
            self.assertTrue(r["ok"], p + "\n" + "\n".join(r["fail"]))
            self.assertEqual(set(r["levels"]), {"L1", "L1+", "L2", "play_order"})

    def test_the_inventory_sees_what_it_should(self):
        """The inventory is not empty where the fixture has the notation (it would pass trivially otherwise)."""
        kinds = lambda p: {notation_inventory.kind(row) for row in notation_inventory.inventory(os.path.join(REPO, p))}
        self.assertTrue({"tie", "slur"} <= kinds(XML + "ties-slurs.musicxml"))
        self.assertTrue({"pedal", "fingering", "arpeggiate"} <= kinds(XML + "piano-marks.musicxml"))
        self.assertIn("tuplet", kinds(XML + "tuplets-nested.musicxml"))
        self.assertIn("transpose", kinds(XML + "transposing.musicxml"))
        self.assertIn("octave-shift", kinds(CORR + "C10-octave-shift-8va.musicxml"))
        self.assertIn("grace", kinds(CORR + "C07-grace.musicxml"))


class AllowlistFixtures(unittest.TestCase):
    def test_each_allowlist_fixture_still_shows_its_difference(self):
        allow = sg_roundtrip.load_allowlist()
        self.assertLessEqual(len(allow), sg_roundtrip.MAX_ALLOWLIST)
        res = sg_roundtrip.run_files([a["fixture"] for a in allow])
        for a in allow:
            self.assertTrue(a["reason"])
            self.assertFalse(res[a["fixture"]]["ok"], a["fixture"])


def unpaired_ties(path):
    """<tie> elements G0's reader cannot pair (merge_ties, the app's rule): a chain that ends in a tie start, or
    one that begins with a tie stop."""
    canon = musicxml.read_score(os.path.join(REPO, path), ottava="standard")
    by_id = {n.id: n for n in canon.notes}
    n = 0
    for s in canon.sounding:
        first, last = by_id[s.notes[0]], by_id[s.notes[-1]]
        n += int(bool(last.tie_start)) + int(bool(first.tie_stop))
    return n


class CorpusOpenTies(unittest.TestCase):
    def test_open_ties_in_the_graph_are_the_unpaired_ties_of_the_file(self):
        """A22: every committed score's W-TIE-OPEN count is the number of <tie> elements its own reading leaves
        unpaired (the eleven files whose starts and stops do not balance, and all the others)."""
        files = sg_roundtrip.corpus_files()
        rows = sg_roundtrip.run_node([{"id": p, "xml": sg_roundtrip.xml_text(musicxml.read_bytes(os.path.join(REPO, p))),
                                       "name": os.path.basename(p), "sha256": "", "container": "musicxml"} for p in files])
        unbalanced = 0
        for p in files:
            row = rows[p]
            self.assertTrue(row["ok"], p)
            data = musicxml.read_bytes(os.path.join(REPO, p)).decode("utf-8", "replace")
            data = re.sub(r"<!--.*?-->", "", data, flags=re.S)
            if len(re.findall(r'<tie\s+type="start"', data)) != len(re.findall(r'<tie\s+type="stop"', data)):
                unbalanced += 1
            self.assertEqual(row["issues"].get("W-TIE-OPEN", 0), unpaired_ties(p), p)
        self.assertGreaterEqual(unbalanced, 11)


if __name__ == "__main__":
    unittest.main()
