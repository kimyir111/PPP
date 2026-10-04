"""G10a-2b (docs/GOALS/G10 section 26): the octave textures (pppbench/texture.py), textured cases, and the rec.hands.* metrics."""

import json
import os
import subprocess
import tempfile
import unittest
from fractions import Fraction

from pppbench import corpus, stages, suite as suite_mod, texture, util
from pppbench.metrics import rec

NODE_DIR = os.path.join(util.bench_root(), "node")


def by_id():
    return corpus.by_id(corpus.load_corpus())


class Texture(unittest.TestCase):
    def setUp(self):
        self.entry = by_id()["method/hanon/016"]
        self.canon = corpus.read_reference(self.entry)

    def test_octaves_doubles_every_single_note_in_its_own_hand(self):
        t = texture.apply(self.canon, "octaves")
        plain = self.canon.played()
        played = t.played()
        # hanon: every onset has one note per hand, so every note gets its octave: the left hand's below, the right hand's above
        self.assertEqual(len(played), 2 * len(plain))
        groups = {}
        for s in played:
            groups.setdefault((s.onset_q, s.hand), []).append(s.midi)
        for (onset, hand), midis in groups.items():
            self.assertEqual(len(midis), 2, (onset, hand))
            self.assertEqual(max(midis) - min(midis), 12, (onset, hand))
        for s in plain:
            mine = groups[(s.onset_q, s.hand)]
            self.assertIn(s.midi, mine)
            self.assertIn(s.midi - 12 if s.hand == "l" else s.midi + 12, mine)
        self.assertEqual(t.diagnostics["texture"], {"name": "octaves", "added_notes": len(plain)})

    def test_one_hand_textures_and_the_reference_untouched(self):
        n = len(self.canon.played())
        left = texture.apply(self.canon, "octaves-l")
        right = texture.apply(self.canon, "octaves-r")
        self.assertEqual(len(left.played()), n + sum(1 for s in self.canon.played() if s.hand == "l"))
        self.assertEqual(len(right.played()), n + sum(1 for s in self.canon.played() if s.hand == "r"))
        self.assertEqual(len(self.canon.played()), n)                  # a new score; the reference's own object is not changed
        self.assertIsNotNone(self.canon.notation)
        self.assertIsNone(left.notation)                                # nq.* has no printed layer for a textured score
        self.assertEqual([s.id for s in left.sounding], list(range(len(left.sounding))))

    def test_a_chord_is_not_doubled_and_no_pitch_twice(self):
        e = by_id()["method/sonatina/018"]
        canon = corpus.read_reference(e)
        t = texture.apply(canon, "octaves")
        seen = {}
        for s in t.played():
            key = (s.onset_q, s.midi)
            self.assertNotIn(key, seen, "a pitch sounding twice at one onset")
            seen[key] = s.hand
        plain = {}
        for s in canon.played():
            plain.setdefault((s.onset_q, s.hand), set()).add(s.midi)
        for (onset, hand), midis in plain.items():
            now = {s.midi for s in t.played() if s.onset_q == onset and s.hand == hand}
            if len(midis) > 1:
                self.assertEqual(now, midis, "a hand that plays two or more pitches is left as it is")
            else:
                self.assertLessEqual(max(now) - min(now), 12)

    def test_tie_pieces_are_doubled_piece_by_piece(self):
        e = by_id()["method/sonatina/018"]
        canon = corpus.read_reference(e)
        t = texture.apply(canon, "octaves")
        tied = [s for s in canon.played() if s.pieces > 1]
        self.assertTrue(tied, "the test needs a tied note")
        for s in tied:
            partner = [x for x in t.played() if x.onset_q == s.onset_q and x.hand == s.hand and abs(x.midi - s.midi) == 12]
            single = {x.midi for x in canon.played() if x.onset_q == s.onset_q and x.hand == s.hand} == {s.midi}
            if single and partner:
                self.assertEqual(partner[0].pieces, s.pieces)
                self.assertEqual(partner[0].dur_q, s.dur_q)

    def test_unknown_texture(self):
        with self.assertRaises(ValueError):
            texture.apply(self.canon, "thirds")

    def test_deterministic_and_cached(self):
        a = corpus.reference_for(self.entry, "octaves")
        b = corpus.reference_for(self.entry, "octaves")
        self.assertIs(a, b)
        c = texture.apply(self.canon, "octaves")
        self.assertEqual(json.dumps(a.to_json(), default=str), json.dumps(c.to_json(), default=str))
        self.assertIs(corpus.reference_for(self.entry, None), self.canon)


class Cases(unittest.TestCase):
    def test_a_texture_row_names_its_cases_and_no_other_case_moves(self):
        self.assertEqual(suite_mod.case_id("r", "cover", "none", 1, "v2"), "r|cover|none|s1|opt:v2")
        self.assertEqual(suite_mod.case_id("r", "cover", "none", 1, "v2", "octaves"), "r|cover|none|s1|opt:v2|tex:octaves")
        s = suite_mod.load_suite("rec-hands-play")
        cases = suite_mod.expand(s, corpus.load_corpus())
        tex = [c for c in cases if c.texture]
        self.assertTrue(tex and all(c.id.endswith("|tex:" + c.texture) for c in tex))
        self.assertTrue(s["hands_play"])
        for k in ("rec.hands.crossing", "rec.hands.hard_per_100_bars", "rec.hands.line_velocity_per_100_bars"):
            self.assertIn(k, s["gate"]["metrics"])
        # the suites before G10a-2b have no texture rows
        for name in ("rec-core", "rec-hands", "rec-arrange-core"):
            self.assertFalse(any(r.get("texture") for r in suite_mod.load_suite(name)["matrix"]), name)

    def test_the_committed_suites_are_the_generators(self):
        from tools import make_rec_suites
        built = dict(make_rec_suites.build())
        built.update(make_rec_suites.build_arrange())
        for name in ("rec-hands-play", "rec-arrange-play"):
            have = util.load_json(os.path.join(suite_mod.SUITES_DIR, name + ".json"))
            self.assertEqual(have, util.load_json_text(util.dumps_json(built[name])), name)


class Metrics(unittest.TestCase):
    def test_rec_hands_from_the_tool_row(self):
        m = rec.hands_play({"bars": 20, "moments": 200, "crossed": 3, "hard": {"SPAN": 1, "KEYS": 0, "VELOCITY": 3}, "lines": 2})
        self.assertAlmostEqual(m["rec.hands.crossing"], 0.015)
        self.assertAlmostEqual(m["rec.hands.hard_per_100_bars"], 20.0)
        self.assertAlmostEqual(m["rec.hands.line_velocity_per_100_bars"], 10.0)
        self.assertEqual(rec.hands_play(None), {"rec.hands.crossing": None, "rec.hands.hard_per_100_bars": None,
                                                "rec.hands.line_velocity_per_100_bars": None})
        self.assertEqual(rec.hands_play({"bars": 4, "moments": 0, "crossed": 0, "hard": {}, "lines": 0})["rec.hands.crossing"], 0.0)

    def test_the_node_tool_on_a_crossing_and_a_leap(self):
        """node/rec-hands-play.js on a two-bar graph: the right hand under the left at one of two moments, and a right-hand
        leap of three octaves in a 16th (a VELOCITY of the hand and of its top line)."""
        # the graph is written by audio-score.js from notes, the path every recording graph takes
        notes = [{"on": 0.0, "off": 0.5, "midi": 72, "vel": 70}, {"on": 0.0, "off": 1.9, "midi": 48, "vel": 70},
                 {"on": 0.5, "off": 1.9, "midi": 52, "vel": 70},
                 {"on": 2.0, "off": 2.1, "midi": 60, "vel": 70}, {"on": 2.12, "off": 2.4, "midi": 96, "vel": 70},
                 {"on": 2.0, "off": 3.9, "midi": 40, "vel": 70}]
        with tempfile.TemporaryDirectory() as tmp:
            jin, jout, graphs = (os.path.join(tmp, n) for n in ("jobs.jsonl", "out.jsonl", "graphs.jsonl"))
            with open(jin, "w", encoding="utf-8", newline="\n") as h:
                h.write(json.dumps({"id": "x", "input": {"notes": notes, "title": "t"}, "opts": {}}) + "\n")
            node = stages.node_binary()
            subprocess.run([node, os.path.join(NODE_DIR, "notate.js"), "--in", jin, "--out", jout, "--check", "--emit-graph", graphs],
                           check=True, capture_output=True)
            pout = os.path.join(tmp, "play.jsonl")
            subprocess.run([node, os.path.join(NODE_DIR, "rec-hands-play.js"), "--graphs", graphs, "--out", pout], check=True, capture_output=True)
            with open(pout, encoding="utf-8") as h:
                row = json.loads(h.readline())
        play = row["play"]
        self.assertEqual(row["id"], "x")
        self.assertGreater(play["bars"], 0)
        self.assertGreater(play["moments"], 0)
        self.assertGreaterEqual(play["hard"]["VELOCITY"], 1)
        self.assertGreaterEqual(play["lines"], 1)
        self.assertEqual(set(play["hard"]), {"SPAN", "KEYS", "VELOCITY"})


if __name__ == "__main__":
    unittest.main()
