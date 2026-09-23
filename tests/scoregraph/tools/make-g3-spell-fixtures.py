"""Writes tests/scoregraph/fixtures/g3/spell/S01-S12 (docs/GOALS/G03 §10.4): keys, spelling and printed accidentals,
in the tests/scoregraph/g3-helpers.js language. The input spells notes the way audio-score's key table does (so a sharp
or flat the fixture shows is the writer's). Expectations are written by hand from §10.2-10.3 as implemented in
scoregraph/pro-spell.js, never computed by running G3. "accs" lists the upper staff's printed accidentals per measure,
in time order and lowest head first: '' none, 'sharp', '(natural)' a courtesy one. The inputs carry no accidental of
their own (the helper writes none), so every fixture shows the whole set G3 prints. The line speller is off unless opts.spelling
(A24: it would lose 0.005 on one core hymn), so the fixtures that show it turn it on.

    python tests/scoregraph/tools/make-g3-spell-fixtures.py
"""
import io
import json
import os

D = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'fixtures', 'g3', 'spell')
os.makedirs(D, exist_ok=True)
P = ['spell']
SPELL = {"spelling": True}


def w(name, about, inp, expect, extra=None):
    d = {"about": about, "spec": "G03 §10.4 " + name, "input": inp, "passes": P, "expect": expect}
    if extra:
        d.update(extra)
    io.open(os.path.join(D, name + '.json'), 'w', encoding='utf-8', newline='\n').write(json.dumps(d, indent=1, ensure_ascii=False) + '\n')


C8 = ['C5:q E5:q G5:q C6:q', 'F5:q A5:q C6:q A5:q', 'G5:q B5:q D6:q B5:q', 'C5:q E5:q G5:q E5:q']
EB = ['Eb5:q G5:q Bb5:q Eb6:q', 'G#5:q C6:q Eb6:q C6:q', 'Bb5:q D6:q F6:q D6:q', 'Eb5:q G5:q Bb5:q G5:q']

w('S01', 'a rising chromatic passing note by step is raised: D Eb E becomes D D# E (the writer spells pitch class 3 of C '
    'major Eb)',
  {"time": [4, 4], "rh": "C5:8 C#5:8 D5:8 Eb5:8 E5:h"},
  {"rh": "C5:8 C#5:8 D5:8 D#5:8 E5:h", "accs": [["", "sharp", "", "sharp", ""]]}, {"opts": SPELL})
w('S02', 'a falling chromatic passing note by step is lowered: D C# C becomes D Db C',
  {"time": [4, 4], "rh": "E5:8 Eb5:8 D5:8 C#5:8 C5:h"},
  {"rh": "E5:8 Eb5:8 D5:8 Db5:8 C5:h", "accs": [["", "flat", "", "flat", ""]]}, {"opts": SPELL})
w('S03', 'the leading note of F# minor is E#, and stays E# (harmonic minor, not a stray spelling)',
  {"time": [4, 4], "key": {"fifths": 3, "mode": "minor"}, "rh": "F#4:8 G#4:8 A4:8 E#4:8 F#4:h"},
  {"rh": "F#4:8 G#4:8 A4:8 E#4:8 F#4:h", "accs": [["", "", "", "sharp", ""]]}, {"opts": SPELL})
w('S04', 'a diminished seventh chord keeps its spelling (its thirds are all minor: the exception)',
  {"time": [4, 4], "key": {"fifths": -3, "mode": "minor"}, "rh": "B3+D4+F4+Ab4:w"},
  {"rh": "B3+D4+F4+Ab4:w", "accs": [["natural", "", "", ""]]}, {"opts": SPELL})
w('S05', 'the Neapolitan sixth in C: a C# under F is a diminished fourth inside the chord, so it is Db',
  {"time": [4, 4], "rh": "F4+C#5:h E4+C5:h"},
  {"rh": "F4+Db5:h E4+C5:h", "accs": [["", "flat", "", ""]]}, {"opts": SPELL})
w('S06', 'a piece that goes from C to Eb major (Burgmuller 15 kind): a key signature where the new key starts and its '
    'notes spelled in it (G#5 of the C table becomes Ab5)',
  {"time": [4, 4], "rh": " | ".join(C8 + C8 + EB + EB + EB)},
  {"bar10": "Ab5:q C6:q Eb6:q C6:q", "keys": [[1, 0], [9, -3]]}, {"passes": ["spell"]})
w('S07', 'a tie over the bar line: the tied note needs no accidental and changes nothing; the next F# needs its sharp '
    'again, and the F after it a natural',
  {"time": [4, 4], "rh": "C5:h F#4:h~ | F#4:q F#4:q F4:h"},
  {"accs": [["", "sharp"], ["", "sharp", "natural"]]})
w('S08', 'courtesy (a): the measure after an F#, its F carries a courtesy natural',
  {"time": [4, 4], "rh": "F#4:w | F4:w"},
  {"accs": [["sharp"], ["(natural)"]]})
w('S09', 'courtesy (b): after a key change that takes the sharp off F, the first F gets a courtesy natural',
  {"time": [4, 4], "key": {"fifths": 1}, "keys": [{"bar": 1, "fifths": 0}], "rh": "F#4:w | F4:h F4:h"},
  {"accs": [[""], ["(natural)", ""]]})
w('S10', 'courtesy (c): a tie brought F# over the bar line; the F later in that measure carries a courtesy natural',
  {"time": [4, 4], "rh": "C5:h F#4:h~ | F#4:h F4:h"},
  {"accs": [["", "sharp"], ["", "(natural)"]]})
w('S11', 'an imported score keeps its spelling and accidentals (rewrite mode)',
  {"time": [4, 4], "rh": "C5:8 C#5:8 D5:8 Eb5:8 E5:h", "op": "imported"},
  {"same": True}, {"opts": SPELL})
w('S12', 'the line speller is off by default: the same bar keeps the spelling of the key table',
  {"time": [4, 4], "rh": "C5:8 C#5:8 D5:8 Eb5:8 E5:h"},
  {"rh": "C5:8 C#5:8 D5:8 Eb5:8 E5:h"})
print(len(os.listdir(D)))
