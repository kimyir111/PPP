"""Writes tests/scoregraph/fixtures/g3/rhythm/R01-R28 (docs/GOALS/G03 §6.3): the input bars and the writing G3's
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
w('R07', '3/4: "8 4 4 8" is not allowed: a quarter G3 writes from the half-beat is tied at the beat (the writer wrote D5 as four 16ths)', {"time": [3, 4], "rh": "C5:8 D5:16~ D5:16~ D5:16~ D5:16 E5:q F5:8"}, {"rh": "C5:8 D5:8~ D5:8 E5:q F5:8"})
w('R07b', 'a single value the writer chose across a beat is kept: G3a never splits it into more tied pieces (G03 §24 record: that raised G0 notation.ties.extra_per_100 past its gate)', {"time": [3, 4], "rh": "C5:8 D5:q E5:q F5:8"}, {"rh": "C5:8 D5:q E5:q F5:8", "same": True})
w('R08', '6/8: 8.~16 inside a beat is a quarter', {"time": [6, 8], "rh": "C5:8.~ C5:16 D5:8 E5:q."}, {"rh": "C5:q D5:8 E5:q."})
w('R09', '6/8: a note over the dotted-quarter beat, written in pieces one of which hides the beat: rewritten to show it (H4)', {"time": [6, 8], "rh": "C5:8 D5:16~ D5:16~ D5:q E5:q"}, {"rh": "C5:8 D5:q~ D5:8 E5:q"})
w('R10', '6/8 heard as 3/4 (hemiola): the metre is not changed; the middle quarter, written in pieces, is tied at the beat', {"time": [6, 8], "rh": "C5:q D5:16~ D5:16~ D5:8 E5:q"}, {"rh": "C5:q D5:8~ D5:8 E5:q"})
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
w('R25', '6/8: three 16th-triplet pieces inside one eighth of a dotted beat are one 3:2 group, unit 16th (§7.3: a span starts where the beat hierarchy has a point)', {"time": [6, 8], "rh": "C5:8 3[D5:16] 3[E5:16] 3[F5:16] G5:8 A5:q."}, {"rh": "C5:8 3s[D5:16 E5:16 F5:16] G5:8 A5:q.", "warnings": {}})
w('R26', '6/8: triplet eighths across the dotted-quarter beat are never one bracket over the beat: each eighth of it is a 16th triplet, the note over the beat tied there (H4)', {"time": [6, 8], "rh": "C5:q 3[D5:8] 3[E5:8] 3[F5:8] r:8 r:8"}, {"rh": "C5:q 3s[D5:8 E5:16~] 3s[E5:16 F5:8] r:q", "warnings": {}})
w('R27', '6/8: a rest inside a 16th triplet (issue 19 in a compound metre): written as a triplet rest and grouped', {"time": [6, 8], "rh": "C5:8 3[D5:16] 3[E5:16] r:16=1/24 G5:8 A5:q."}, {"rh": "C5:8 3s[D5:16 E5:16 r:16] G5:8 A5:q.", "warnings": {}})
w('R28', '9/8: a 16th triplet in the second eighth of beat 2', {"time": [9, 8], "rh": "C5:q. D5:8 3[E5:16] 3[F5:16] 3[G5:16] A5:8 B5:q."}, {"rh": "C5:q. D5:8 3s[E5:16 F5:16 G5:16] A5:8 B5:q.", "warnings": {}})
print(len(os.listdir(D)))
