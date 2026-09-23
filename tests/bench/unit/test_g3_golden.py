"""G3's golden check (docs/GOALS/G03 §20.6, A35): what G3a may change in a snapshot, and what it may not."""
import copy
import unittest

from pppbench import golden


def snap():
    """A two-bar 4/4 snapshot: C4 quarter tied to C4 quarter, E4 half; a rest; a pedal lifted and pressed again."""
    notes = [[0, "0", "1", 60, "C", 0, True, False, None, "", "quarter", 0],
             [0, "1", "1", 60, "C", 0, False, True, None, "", "quarter", 0],
             [0, "2", "2", 64, "E", 0, False, False, None, "", "half", 0],
             [1, "0", "4", 63, "D", 1, False, False, None, "sharp", "whole", 0]]
    return {"schema": "ppp.bench-semantic/3", "stats": {"bars": 2},
            "score": {"structure": {"bars": [{"i": 0, "number": "1", "len": "4"}, {"i": 1, "number": "2", "len": "4"}],
                                    "play_order": [0, 1], "staves": 2, "piano_part": 0, "clefs": [], "placement": []},
                      "music": {"measures": [{"i": 0, "time": [4, 4], "fifths": 0, "mode": "major"},
                                             {"i": 1, "time": [4, 4], "fifths": 0, "mode": "major"}],
                                "tempo": [], "notes": notes, "rests": [],
                                "pedals": [[0, "0", "start"], [0, "15/4", "stop"], [1, "0", "start"], [1, "4", "stop"]]}}}


TIME = {"barStarts": [0, 2, 4], "beats": []}


class G3Golden(unittest.TestCase):
    def diff(self, a):
        return golden.g3_difference(snap(), a, TIME, TIME)

    def test_the_same_snapshot_is_allowed(self):
        self.assertEqual(self.diff(snap()), [])

    def test_a_tie_merged_into_one_value_and_a_respelling_are_allowed(self):
        a = snap()
        n = a["score"]["music"]["notes"]
        n[0:2] = [[0, "0", "2", 60, "C", 0, False, False, None, "", "half", 0]]
        n[-1] = [1, "0", "4", 63, "E", -1, False, False, None, "flat", "whole", 0]
        a["score"]["music"]["measures"][1]["fifths"] = -3
        self.assertEqual(self.diff(a), [])

    def test_a_release_and_press_joined_into_a_change_is_allowed(self):
        a = snap()
        a["score"]["music"]["pedals"] = [[0, "0", "start"], [1, "0", "change"], [1, "4", "stop"]]
        self.assertEqual(self.diff(a), [])

    def test_a_pitch_an_onset_a_length_a_bar_or_a_metre_is_not(self):
        cases = {
            "pitch": lambda s: s["score"]["music"]["notes"][2].__setitem__(3, 65),
            "onset": lambda s: s["score"]["music"]["notes"][2].__setitem__(1, "5/2"),
            "tied length": lambda s: s["score"]["music"]["notes"].__setitem__(1, [0, "1", "1", 60, "C", 0, False, False, None, "", "quarter", 0]),
            "bar": lambda s: s["score"]["structure"]["bars"][1].__setitem__("len", "3"),
            "metre": lambda s: s["score"]["music"]["measures"][1].__setitem__("time", [3, 4]),
            "pedal moved": lambda s: s["score"]["music"].__setitem__("pedals", [[0, "0", "start"], [0, "2", "stop"], [1, "0", "start"], [1, "4", "stop"]]),
        }
        for what, change in cases.items():
            a = snap()
            change(a)
            self.assertTrue(self.diff(a), what)

    def test_bar_times_are_fixed(self):
        self.assertTrue(golden.g3_difference(snap(), snap(), TIME, {"barStarts": [0, 2.1, 4], "beats": []}))


if __name__ == "__main__":
    unittest.main()
