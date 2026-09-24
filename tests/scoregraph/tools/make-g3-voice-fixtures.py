"""Writes tests/scoregraph/fixtures/g3/voice/V01-V06 (docs/GOALS/G03 §8.2, A23): second voices and the rests around
them, in the tests/scoregraph/g3-helpers.js language. Written by hand from §8.2, never computed by running G3.

    python tests/scoregraph/tools/make-g3-voice-fixtures.py
"""
import io
import json
import os

D = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'fixtures', 'g3', 'voice')
os.makedirs(D, exist_ok=True)
P = ['staff', 'voice', 'rhythm', 'tuplet']


def w(name, about, inp, expect, extra=None):
    d = {"about": about, "spec": "G03 §8.2 " + name, "input": inp, "passes": P, "expect": expect}
    if extra:
        d.update(extra)
    io.open(os.path.join(D, name + '.json'), 'w', encoding='utf-8', newline='\n').write(json.dumps(d, indent=1, ensure_ascii=False) + '\n')


w('V01', 'a second voice with a gap: the gap becomes a rest you can see',
  {"time": [4, 4], "rh": "E5:q E5:q E5:q E5:q", "rh2": "C5:h r:8=1/4 r:8=1/4", "lh": "C3:w"},
  {"rh": "E5:q E5:q E5:q E5:q // C5:h r:h"})
w('V02', 'a second voice with only rests in a measure has no events there (it is not needed)',
  {"time": [4, 4], "rh": "E5:w | E5:w", "rh2": "C5:w | r:w", "lh": "C3:w | C3:w"},
  {"rh": "E5:w | E5:w // C5:w | "})
w('V03', 'a second voice with only rests anywhere goes',
  {"time": [4, 4], "rh": "E5:w", "rh2": "r:w", "lh": "C3:w"},
  {"rh": "E5:w", "voices": 2})
w('V04', 'an imported score with two voices on a staff that never overlap keeps them (the editor meant them)',
  {"time": [4, 4], "rh": "E5:h r:h", "rh2": "r:h C5:h", "lh": "C3:w", "op": "imported"},
  {"same": True})
w('V05', 'a note P2 must move (a left-hand chord of 16 semitones) onto a staff where it would overlap goes to the second voice of that staff '
    ', with rests you can see around it: never an E-VOICE-OVERLAP',
  {"time": [4, 4], "rh": "C6:q D6:q E6:q F6:q", "lh": "C3:h C3+E5:h"},
  {"rh": "C6:q D6:q E6:q F6:q // r:h E5:h", "lh": "C3:h C3:h", "voices": 3})
w('V06', 'a chord note cannot join a hand whose span it would make unplayable (G3 with D5: 19 semitones), so that octave '
    'stays; the free A4 of the next measure goes down. At most two voices a staff',
  {"time": [3, 4], "rh": "D5+D6:h. | A4+A5:h.", "lh": "G3:h. | r:h."},
  {"rh": "D5+D6:h. | A5:h.", "lh": "G3:h. | A4:h.", "voices": 2})
print(len(os.listdir(D)))
