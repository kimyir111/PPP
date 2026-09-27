"""G05 G5a - the `arrange_score.py` legacy arranger's own output, run through every style x level
combination on the same fixture tests/arranger_test.py uses (not a synthetic input invented for this
baseline: it is the score `arrange_score.py`'s own shipped test suite already treats as representative).

Prints one JSON object per line to stdout: {"level", "style", "tempo", "notes": [...]} - the arranger's
raw `notes` list, unmodified, plus the tempo it planned around. tests/playability/arranger-baseline.test.js
reads this (via child_process, one Python process for the whole run) and feeds each note list through the
playability analyzer, exactly as it would a ScoreGraph's attacks, to measure the "legacy-arranger
baseline" the goal doc's G0 Step 14 half asks for.
"""
import copy
import json
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[3]))

from arrange_score import Arranger, STYLES, LEVELS  # noqa: E402


def fixture():
    # Identical to tests/arranger_test.py's fixture() - see that file for provenance.
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


def main():
    score = fixture()
    out = []
    for level in sorted(LEVELS):
        for style in sorted(STYLES):
            before = copy.deepcopy(score)
            result = Arranger({"score": score, "arrangement": {"level": level, "style": style}}).arrange()
            assert score == before, "arranging must not mutate the source"
            out.append({"level": level, "style": style, "tempo": score["tempo"], "notes": result["notes"]})
    json.dump(out, sys.stdout)


if __name__ == "__main__":
    main()
