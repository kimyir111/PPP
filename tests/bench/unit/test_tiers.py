import argparse
import io
import unittest
from contextlib import redirect_stdout

from pppbench import align, projection, tiers
from pppbench.metrics.readability import app_type
from unit.helpers import canon, measure, note


def app_projection(c, hand_override=None):
    """What node/omr-live.js / conformance.js would return for a canonical score (a player that
    joins ties the way the reader does)."""
    held = {}
    for s in c.sounding:
        held[s.notes[0]] = float(s.dur_q)
    return {"title": c.title, "tempo": c.app_qpm, "staves": c.staves,
            "measures": [{"number": m.app_number, "startQ": float(m.start_q), "lenQ": float(m.len_q), "time": list(m.time),
                          "fifths": m.fifths, "mode": m.mode} for m in c.measures],
            "notes": [{"m": n.measure, "b": float(n.pos_q), "dur": float(n.dur_q), "midi": n.midi, "writtenMidi": n.written_midi,
                       "p": tiers._pitch_name(n.step, n.alter, n.octave), "staff": n.staff,
                       "hand": (hand_override or {}).get(n.staff, n.hand), "voice": n.voice, "rest": False, "chord": n.chord,
                       "tieStart": n.tie_start, "tieStop": n.tie_stop, "tm": list(n.tuplet) if n.tuplet else None,
                       "type": app_type(n.type, n.dur_q), "dots": n.dots, "acc": None,
                       "struck": n.id in held, "hold": held.get(n.id, float(n.dur_q))}
                      for n in c.notes],
            "rests": [{"m": r.measure, "b": float(r.pos_q), "dur": float(r.dur_q), "staff": r.staff,
                       "type": app_type(r.type, r.dur_q), "dots": r.dots} for r in c.rests]}


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

    def test_parity_covers_spelling_mode_tuplets_and_tie_merging(self):
        # §17 M6: 224/224 used to hold for a reader that broke any of these
        c = canon([measure(note("F", 5, 2, alter=1) + note("C", 5, 1, tie="start") + note("C", 5, 1, tie="stop"),
                           note("C", 3, 4, staff=2), number=1, rh_len=4)])
        self.assertEqual(tiers.compare_projection(c, app_projection(c)), [])
        proj = app_projection(c)
        proj["notes"][0]["p"] = "Gb5"                                   # same midi, other spelling
        self.assertTrue(any("spellings" in d for d in tiers.compare_projection(c, proj)))
        proj = app_projection(c)
        proj["measures"][0]["mode"] = "minor"
        self.assertTrue(any("mode" in d for d in tiers.compare_projection(c, proj)))
        proj = app_projection(c)
        proj["notes"][0]["tm"] = [3, 2]
        self.assertTrue(any("tuplets" in d for d in tiers.compare_projection(c, proj)))
        proj = app_projection(c)
        for n in proj["notes"]:          # a player that strikes the tied C again
            n["struck"], n["hold"] = True, n["dur"]
        self.assertTrue(any("key presses" in d for d in tiers.compare_projection(c, proj)))

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
