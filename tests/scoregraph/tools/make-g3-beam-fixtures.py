"""Writes tests/scoregraph/fixtures/g3/beam/B01-B11 (docs/GOALS/G03 §11.3): the beams P7 gives a voice-measure, in the
tests/scoregraph/g3-helpers.js language ("beams" per measure: each beam's notes, '/' where the beams below the eighth
break). Written by hand from the §11.2 table, never computed by running G3.

    python tests/scoregraph/tools/make-g3-beam-fixtures.py
"""
import io
import json
import os

D = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'fixtures', 'g3', 'beam')
os.makedirs(D, exist_ok=True)
P = ['tuplet', 'beam']


def w(name, about, inp, expect, extra=None):
    d = {"about": about, "spec": "G03 §11.3 " + name, "input": inp, "passes": P, "expect": expect}
    if extra:
        d.update(extra)
    io.open(os.path.join(D, name + '.json'), 'w', encoding='utf-8', newline='\n').write(json.dumps(d, indent=1, ensure_ascii=False) + '\n')


w('B01', '2/4: eighths beamed by the beat', {"time": [2, 4], "rh": "C5:8 D5:8 E5:8 F5:8"}, {"beams": [["C5 D5", "E5 F5"]]})
w('B02', '3/4: eighths beamed by the beat', {"time": [3, 4], "rh": "C5:8 D5:8 E5:8 F5:8 G5:8 A5:8"}, {"beams": [["C5 D5", "E5 F5", "G5 A5"]]})
w('B03', '4/4: eighths beamed by the beat (the half-bar grouping is an option, not the default)',
  {"time": [4, 4], "rh": "C5:8 D5:8 E5:8 F5:8 G5:8 A5:8 B5:8 C6:8"}, {"beams": [["C5 D5", "E5 F5", "G5 A5", "B5 C6"]]})
w('B04', '2/2: eighths beamed by the quarter', {"time": [2, 2], "rh": "C5:8 D5:8 E5:8 F5:8 G5:8 A5:8 B5:8 C6:8"},
  {"beams": [["C5 D5", "E5 F5", "G5 A5", "B5 C6"]]})
w('B05', '3/8: the whole measure is one beam', {"time": [3, 8], "rh": "C5:8 D5:8 E5:8"}, {"beams": [["C5 D5 E5"]]})
w('B06', '6/8: eighths beamed by the dotted quarter', {"time": [6, 8], "rh": "C5:8 D5:8 E5:8 F5:8 G5:8 A5:8"}, {"beams": [["C5 D5 E5", "F5 G5 A5"]]})
w('B07', '7/8 grouped 2+2+3', {"time": [7, 8], "rh": "C5:8 D5:8 E5:8 F5:8 G5:8 A5:8 B5:8"}, {"beams": [["C5 D5", "E5 F5", "G5 A5 B5"]]})
w('B08', 'a rest breaks the beam; one note alone has none', {"time": [4, 4], "rh": "C5:8 r:8 E5:8 F5:8 G5:q A5:q"}, {"beams": [["E5 F5"]]})
w('B09', 'a triplet is one beam; four 16ths share the primary beam and break the secondary one at the eighth',
  {"time": [4, 4], "rh": "3e[C5:8 D5:8 E5:8] F5:16 G5:16 A5:16 B5:16 C6:h"}, {"beams": [["C5 D5 E5", "F5 G5 / A5 B5"]]})
w('B10', 'an eighth and two 16ths: one beam, no break (the break is between two notes shorter than an eighth)',
  {"time": [2, 4], "rh": "C5:8 D5:16 E5:16 F5:q"}, {"beams": [["C5 D5 E5"]]})
w('B12', 'a beam passes over a 16th rest between two of its notes (PPP writes many; G03 §24 record)',
  {"time": [2, 4], "rh": "C5:16 r:16 D5:16 E5:16 F5:q"}, {"beams": [["C5 / D5 E5"]]})
w('B11', 'an imported score keeps its beams (none here: rewrite mode adds none)',
  {"time": [2, 4], "rh": "C5:8 D5:8 E5:8 F5:8", "op": "imported"}, {"same": True})
print(len(os.listdir(D)))
