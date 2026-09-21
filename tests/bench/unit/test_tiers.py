import argparse
import io
import unittest
from contextlib import redirect_stdout

from pppbench import align, projection, tiers
from unit.helpers import canon, measure, note


def app_projection(c, hand_override=None):
    """What node/omr-live.js / conformance.js would return for a canonical score."""
    names = {0: "C", 1: "C#", 2: "D", 3: "Eb", 4: "E", 5: "F", 6: "F#", 7: "G", 8: "Ab", 9: "A", 10: "Bb", 11: "B"}
    return {"title": c.title, "tempo": c.app_qpm, "staves": c.staves,
            "measures": [{"number": m.number, "startQ": float(m.start_q), "lenQ": float(m.len_q), "time": list(m.time),
                          "fifths": m.fifths, "mode": m.mode} for m in c.measures],
            "notes": [{"m": n.measure, "b": float(n.pos_q), "dur": float(n.dur_q), "midi": n.midi, "writtenMidi": n.written_midi,
                       "p": names[n.midi % 12] + str(n.midi // 12 - 1), "staff": n.staff,
                       "hand": (hand_override or {}).get(n.staff, n.hand), "voice": n.voice, "rest": False, "chord": n.chord,
                       "tieStart": n.tie_start, "tieStop": n.tie_stop, "tm": None, "type": n.type, "dots": n.dots, "acc": None}
                      for n in c.notes]}


def two_hand_score():
    return canon([measure(note("C", 5, 1) * 4, note("C", 3, 4, staff=2), number=i + 1, rh_len=4) for i in range(4)])


class Tiers(unittest.TestCase):
    def test_projection_round_trip_and_conformance_compare(self):
        c = two_hand_score()
        proj = app_projection(c)
        self.assertEqual(tiers.compare_projection(c, proj), [])
        back = projection.canonical_from_projection(proj)
        self.assertEqual([(s.measure, s.pos_q, s.dur_q, s.midi, s.hand) for s in back.played()],
                         [(s.measure, s.pos_q, s.dur_q, s.midi, s.hand) for s in c.played()])
        proj["notes"][0]["midi"] += 12
        self.assertTrue(any("notes differ" in d for d in tiers.compare_projection(c, proj)))
        proj = app_projection(c)
        proj["measures"][1]["lenQ"] = 3
        self.assertTrue(tiers.compare_projection(c, proj))

    def test_omr_flags(self):
        ref = two_hand_score()
        # the treble staff marked as not played (what the app does with Audiveris' two one-staff parts)
        pred = projection.canonical_from_projection(app_projection(ref, hand_override={1: "x", 2: "r"}))
        sa = align.align_symbolic(ref, pred)
        f = tiers.omr_flags(sa, pred, suspects=[2, 3])
        self.assertEqual(f["omr.wrong_measures"], 4.0)     # every bar lost its right hand
        self.assertEqual(f["omr.flag.precision"], 1.0)
        self.assertEqual(f["omr.flag.recall"], 0.5)
        good = projection.canonical_from_projection(app_projection(ref))
        f = tiers.omr_flags(align.align_symbolic(ref, good), good, suspects=[])
        self.assertEqual(f["omr.wrong_measures"], 0.0)
        self.assertIsNone(f["omr.flag.precision"])
        self.assertIsNone(f["omr.flag.recall"])

    def test_missing_environment_is_skipped(self):
        args = argparse.Namespace(base_url="http://127.0.0.1:9", require_env=False)
        buf = io.StringIO()
        with redirect_stdout(buf):
            self.assertEqual(tiers.conformance(args), 0)
        self.assertIn("SKIPPED", buf.getvalue())
        args.require_env = True
        with redirect_stdout(io.StringIO()):
            self.assertEqual(tiers.conformance(args), 2)
            self.assertEqual(tiers.omr_live(args), 2)


if __name__ == "__main__":
    unittest.main()
