"""Writes tests/scoregraph/fixtures/g3/rhythm/R01-R24 (docs/GOALS/G03 §6.3): the input bars and the writing G3's
R-repr must give them, in the tests/scoregraph/g3-helpers.js language. The expectations are written by hand from
the rules (H1-H8, the S table, the §6.2 cost), never computed by running G3.

    python tests/scoregraph/tools/make-g3-rhythm-fixtures.py
"""
import json, io, os
D = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'fixtures', 'g3', 'rhythm')
os.makedirs(D, exist_ok=True)
P = ['rhythm', 'tuplet']


def w(name, about, inp, expect, extra=None):
    d = {"about": about, "spec": "G03 §6.3 " + name, "input": inp, "passes": P, "expect": expect}
    if extra:
        d.update(extra)
    io.open(os.path.join(D, name + '.json'), 'w', encoding='utf-8', newline='\n').write(json.dumps(d, indent=1, ensure_ascii=False) + '\n')


w('R01', '4/4: two eighths tied inside one beat are one quarter', {"time": [4, 4], "rh": "C5:8~ C5:8 D5:q E5:h"}, {"rh": "C5:q D5:q E5:h"})
w('R02', '4/4: a tie over the middle from beat 2 is the half of "4 2 4" (S table)', {"time": [4, 4], "rh": "C5:q D5:q~ D5:q E5:q"}, {"rh": "C5:q D5:h E5:q"})
w('R03', '4/4: a quarter tied to an eighth from a beat is a dotted quarter', {"time": [4, 4], "rh": "C5:q~ C5:8 D5:8 E5:h"}, {"rh": "C5:q. D5:8 E5:h"})
w('R04', '4/4: a double dot from a beat that does not reach the middle (H7); a double-dotted half from beat 1 would hide the middle and is not in the S table', {"time": [4, 4], "rh": "C5:q~ C5:8~ C5:16 D5:16 E5:h"}, {"rh": "C5:q.. D5:16 E5:h"})
w('R05', '2/4: 8 4 8, the half-beat syncopation (S table)', {"time": [2, 4], "rh": "C5:8 D5:8~ D5:8 E5:8"}, {"rh": "C5:8 D5:q E5:8"})
w('R06', '3/4: a half from beat 1 ("2 4")', {"time": [3, 4], "rh": "C5:q~ C5:q D5:q"}, {"rh": "C5:h D5:q"})
w('R07', '3/4: "8 4 4 8" is not allowed: an off-beat quarter hides a beat, so it is tied at the beat', {"time": [3, 4], "rh": "C5:8 D5:q E5:q F5:8"}, {"rh": "C5:8 D5:8~ D5:8 E5:8~ E5:8 F5:8"})
w('R08', '6/8: 8.~16 inside a beat is a quarter', {"time": [6, 8], "rh": "C5:8.~ C5:16 D5:8 E5:q."}, {"rh": "C5:q D5:8 E5:q."})
w('R09', '6/8: an off-beat dotted quarter hides the second dotted-quarter beat: it is tied there (H4)', {"time": [6, 8], "rh": "C5:8 D5:q. E5:q"}, {"rh": "C5:8 D5:q~ D5:8 E5:q"})
w('R10', '6/8 heard as 3/4 (hemiola): the metre is not changed, the beat is shown by a tie', {"time": [6, 8], "rh": "C5:q D5:q E5:q"}, {"rh": "C5:q D5:8~ D5:8 E5:q"})
w('R11', '12/8: two dotted quarters tied inside a group are a dotted half', {"time": [12, 8], "rh": "C5:q.~ C5:q. D5:h."}, {"rh": "C5:h. D5:h."})
w('R12', '3/8: a note filling the bar is a dotted quarter', {"time": [3, 8], "rh": "C5:8~ C5:q"}, {"rh": "C5:q."})
w('R12b', '9/8: a note filling the bar has no single value; like 3/4 ("2 4"), a dotted half on beats 1-2 and a dotted quarter', {"time": [9, 8], "rh": "C5:q.~ C5:q.~ C5:q."}, {"rh": "C5:h.~ C5:q."})
w('R13', '5/8 grouped 2+3: two tied eighths in the first group are a quarter', {"time": [5, 8], "rh": "C5:8~ C5:8 D5:q."}, {"rh": "C5:q D5:q."})
w('R13b', '7/8 grouped 2+2+3: a quarter tied to an eighth in the last group is a dotted quarter', {"time": [7, 8], "rh": "C5:q D5:q E5:8~ E5:q"}, {"rh": "C5:q D5:q E5:q."})
w('R14', '3/4 with a pickup: its grid lines up with the end of the bar (the pickup is beat 3)', {"time": [3, 4], "durs": ["1/4", "3/4"], "rh": "C5:8~ C5:8 | D5:h."}, {"rh": "C5:q | D5:h."})
w('R15', 'a tie over the bar line stays; each bar is written on its own', {"time": [4, 4], "rh": "r:h C5:h~ | C5:q D5:h."}, {"rh": "r:h C5:h~ | C5:q D5:h.", "same": True})
w('R16', 'rests: one per beat, the half rest of 4/4 on beat 3, a whole-measure rest', {"time": [4, 4], "rh": "C5:q r:8 r:8 r:h | r:h r:h"}, {"rh": "C5:q r:q r:h | r:w"})
w('R17', 'a one-tick rest (1/96, issue 19) is on no grid G3 writes: R-repr leaves the beat as it is (R-reg is G3b); read as a triplet 64th, no tuplet span holds it either', {"time": [4, 4], "rh": "C5:q=23/96 r:64=1/96 D5:q E5:h"}, {"rh": "C5:q=23/96 r:64=1/96 D5:q E5:h", "same": True, "issues": {"N-RHYTHM-UNREPRESENTABLE": 1, "N-TUPLET-UNGROUPABLE": 1}})
w('R18', 'a rest inside a triplet (issue 19): written as a triplet rest and grouped', {"time": [4, 4], "rh": "3[C5:8] 3[D5:8] r:8=1/12 r:q r:h"}, {"rh": "3e[C5:8 D5:8 r:8] r:q r:h", "warnings": {}})
w('R19', 'a triplet quarter written as two tied triplet eighths: one triplet quarter', {"time": [4, 4], "rh": "3[C5:8~] 3[C5:8] 3[D5:8] r:q r:h"}, {"rh": "3e[C5:q D5:8] r:q r:h", "warnings": {}})
w('R20', '5:4 and a 3:2 inside it, forced (an imported file): kept', {"musicxml": "xml/tuplets-nested.musicxml"}, {"same": True}, {"mode": "force"})
w('R21', 'a grace note stays before its main note while the notes around it are rewritten', {"time": [4, 4], "rh": "C5:8~ C5:8 D5:q E5:h", "graces": [{"staff": 0, "bar": 0, "at": "1/4", "pitch": "C#5", "type": "eighth"}]}, {"rh": "C5:q D5:q E5:h", "graces": 1})
w('R22', 'a septuplet piece (1/28) is on no grid: nothing changes, N-RHYTHM-UNREPRESENTABLE', {"time": [4, 4], "rh": "C5:16=1/28 D5:16=1/28 E5:16=1/28 F5:16=1/28 G5:16=1/28 A5:16=1/28 B5:16=1/28 r:h."}, {"same": True, "issues": {"N-RHYTHM-UNREPRESENTABLE": 1}})
w('R23', 'an already clean bar: the same graph object comes back', {"time": [4, 4], "rh": "C5:q D5:q E5:h"}, {"same": True})
w('R24', 'an imported bar is never rewritten (rewrite mode)', {"time": [4, 4], "rh": "C5:8~ C5:8 D5:q E5:h", "op": "imported"}, {"same": True})
print(len(os.listdir(D)))
