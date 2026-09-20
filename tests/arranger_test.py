import copy
import pathlib
import sys
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from arrange_score import Arranger, STYLES


def fixture():
    measures = [
        {"number": index + 1, "lenQ": 4, "time": {"beats": 4, "beatType": 4},
         "key": {"fifths": 0, "mode": "major"}}
        for index in range(4)
    ]
    progressions = ([48, 52, 55], [45, 48, 52], [41, 45, 48], [43, 47, 50])
    melodies = ([60, 62, 64, 67], [69, 67, 64, 60], [65, 64, 62, 60], [67, 65, 62, 59])
    notes = []
    for measure, (chord, melody) in enumerate(zip(progressions, melodies), 1):
        for beat, midi in enumerate(melody):
            notes.append({"m": measure, "b": beat, "dur": 1, "midi": midi,
                          "staff": 1, "hand": "r", "voice": 1,
                          "slurStart": True, "tieStart": True})
        for midi in chord:
            notes.append({"m": measure, "b": 0, "dur": 4, "midi": midi,
                          "staff": 2, "hand": "l", "voice": 5})
    return {"tempo": 96, "measures": measures, "notes": notes,
            "sections": [{"from": 1, "to": 4}]}


class ArrangerTests(unittest.TestCase):
    def arrange(self, level="intermediate", style="jazz"):
        score = fixture()
        before = copy.deepcopy(score)
        result = Arranger({"score": score,
                           "arrangement": {"level": level, "style": style}}).arrange()
        self.assertEqual(score, before, "arranging must not mutate the source")
        return result

    def test_harmony_is_planned_across_the_piece(self):
        result = self.arrange()
        symbols = [change["symbol"] for change in result["analysis"]["harmonyChanges"]]
        self.assertTrue(any(symbol.startswith("C") for symbol in symbols), symbols)
        self.assertTrue(any(symbol.startswith("Am") for symbol in symbols), symbols)
        self.assertTrue(any(symbol.startswith("F") for symbol in symbols), symbols)
        self.assertTrue(any(symbol.startswith("G") for symbol in symbols), symbols)
        self.assertLess(result["analysis"]["averageVoiceMovement"], 1.0)

    def test_every_style_is_playable_and_does_not_invent_legato(self):
        for style in STYLES:
            with self.subTest(style=style):
                result = self.arrange(style=style)
                self.assertGreater(len(result["notes"]), 16)
                self.assertTrue(result["analysis"]["metrePreserved"])
                self.assertFalse(any("slurStart" in note or "slurStop" in note or
                                     "tieStart" in note or "tieStop" in note
                                     for note in result["notes"]))
                self.assertTrue(all(0 <= note["b"] < 4 for note in result["notes"]))

    def test_beginner_density_is_capped_across_both_hands(self):
        result = self.arrange(level="beginner", style="bossa")
        attacks = {}
        for note in result["notes"]:
            attacks.setdefault((note["m"], note["b"]), 0)
            attacks[(note["m"], note["b"])] += 1
        self.assertLessEqual(max(attacks.values()), 2)


if __name__ == "__main__":
    unittest.main()
