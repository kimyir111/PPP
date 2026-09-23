"""Writes tests/scoregraph/fixtures/g3/hands/H01-H08 (docs/GOALS/G03 §9.4): input bars and the hands, staves and clefs
G3's P2 must give them, in the tests/scoregraph/g3-helpers.js language. Written by hand from the §9.2 costs (as fixed
in scoregraph/pro-staff.js), never computed by running G3.

    python tests/scoregraph/tools/make-g3-hands-fixtures.py
"""
import io
import json
import os

D = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'fixtures', 'g3', 'hands')
os.makedirs(D, exist_ok=True)
P = ['staff', 'voice', 'rhythm', 'tuplet']


def w(name, about, inp, expect, extra=None):
    d = {"about": about, "spec": "G03 §9.4 " + name, "input": inp, "passes": P, "expect": expect}
    if extra:
        d.update(extra)
    io.open(os.path.join(D, name + '.json'), 'w', encoding='utf-8', newline='\n').write(json.dumps(d, indent=1, ensure_ascii=False) + '\n')


w('H01', 'parallel octaves written as right-hand octaves (Beyer 032, E6): one hand each, the left hand in a treble clef '
    'while every note is 4 or more ledger lines above the bass staff',
  {"time": [3, 4], "rh": "D5+D6:q C5+C6:q B4+B5:q | A4+A5:h.", "lh": "r:h. | r:h."},
  {"rh": "D6:q C6:q B5:q | A5:h.", "lh": "D5:q C5:q B4:q | A4:h.", "clefs": ["RH m1 G", "LH m1 G", "LH m2 F"]})
w('H02', 'the melody note at the top of a left-hand chord while the right hand rests (Czerny 849/006, E7): it goes back '
    'to the right hand (melody 1.5 against keep 0.9)',
  {"time": [2, 4], "rh": "E5:8 r:8 r:q", "lh": "D4:q F#4+A4+D5:q"},
  {"rh": "E5:8 r:8 D5:q", "lh": "D4:q F#4+A4:q"})
w('H03', 'a triplet arpeggio split between the hands (Burgmuller 021, E3): the left hand keeps its figure',
  {"time": [4, 4], "rh": "r:q=1/6 3[E4:8] 3[E5:8] 3[C5:8] 3[G4:8] r:h", "lh": "3[G3:8] 3[C4:8] r:8=1/12 r:q r:h"},
  {"rh": "r:q 3e[E5:8 C5:8 G4:8] r:h", "lh": "3e[G3:8 C4:8 E4:8] r:q r:h"})
w('H04', 'a chord wider than one hand (19 semitones) with the left hand free: split where each hand holds a playable '
    'chord and no octave (G4 and G5 in one hand would be one)',
  {"time": [4, 4], "rh": "C4+E4+G4+C5+E5+G5:w", "lh": "r:w"},
  {"rh": "C5+E5+G5:w", "lh": "C4+E4+G4:w"})
w('H05', 'the hands never cross: a left-hand note above a right-hand note at one onset goes up, into the chord of the right hand '
    'chord (moving one note costs less than swapping two)',
  {"time": [4, 4], "rh": "C4:h C4:h", "lh": "E4:h C3:h"},
  {"rh": "C4+E4:h C4:h", "lh": "r:h C3:h"})
w('H06', 'a left hand high for a whole measure under a higher right hand keeps its notes (no hand can take them) and '
    'takes a treble clef for that measure',
  {"time": [4, 4], "rh": "C6:w | G6:w | C6:w", "lh": "C3:w | C5+E5:w | C3:w"},
  {"rh": "C6:w | G6:w | C6:w", "lh": "C3:w | C5+E5:w | C3:w", "clefs": ["RH m1 G", "LH m1 F", "LH m2 G", "LH m3 F"]})
w('H07', 'a right-hand scale that dips below middle C stays in the right hand (the melody would change hands)',
  {"time": [4, 4], "rh": "E4:8 D4:8 C4:8 B3:8 C4:h", "lh": "C3:w"},
  {"same": True})
w('H08', 'an imported score keeps its hands (rewrite mode)',
  {"time": [3, 4], "rh": "D5+D6:q C5+C6:q B4+B5:q | A4+A5:h.", "lh": "r:h. | r:h.", "op": "imported"},
  {"same": True})
print(len(os.listdir(D)))
