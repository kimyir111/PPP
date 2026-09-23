"""python tests/scoregraph/tools/make_repeat_fixtures.py

Writes the six repeat fixtures of G01 §16.3 (A17) with their expected play orders, derived by hand from the
app's rule (G01 §6.7): a backward repeat returns to the last forward repeat still open (else the first bar),
nested repeats start over, an ending is skipped when the pass is not among its numbers."""
import json, os
D = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "fixtures", "xml")

HEAD = """<?xml version="1.0" encoding="UTF-8"?>
<!-- {about} -->
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
"""
TAIL = """  </part>
</score-partwise>
"""
STEPS = ["C", "D", "E", "F", "G", "A", "B"]


def measure(i, left="", right=""):
    attrs = ('<attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time>'
             '<clef><sign>G</sign><line>2</line></clef></attributes>') if i == 0 else ""
    lb = f'<barline location="left">{left}</barline>' if left else ""
    rb = f'<barline location="right">{right}</barline>' if right else ""
    return (f'    <measure number="{i + 1}">{lb}{attrs}<note><pitch><step>{STEPS[i % 7]}</step><octave>5</octave></pitch>'
            f'<duration>4</duration><voice>1</voice><type>whole</type></note>{rb}</measure>\n')


FWD = '<bar-style>heavy-light</bar-style><repeat direction="forward"/>'
def BWD(times=None):
    return '<bar-style>light-heavy</bar-style><repeat direction="backward"' + (f' times="{times}"' if times else '') + '/>'
def END(nums, ty, text=None):
    return f'<ending number="{nums}" type="{ty}">{text or ""}</ending>' if ty == "start" else f'<ending number="{nums}" type="{ty}"/>'


fixtures = {
    "repeats-simple": ("bars 1-2 between a forward and a backward repeat, then bar 3",
                       [("", FWD, ""), ("", "", BWD()), ("", "", "")],
                       # 1 2 | 1 2 | 3
                       [0, 1, 0, 1, 2]),
    "repeats-times-3": ("a backward repeat marked times=3 with no forward repeat: back to the first bar, three times through",
                        [("", "", ""), ("", "", BWD(3)), ("", "", "")],
                        [0, 1, 0, 1, 0, 1, 2]),
    "repeats-endings-1-2": ("a first ending (bar 3) and a second ending (bar 4) after a repeat that starts at bar 1",
                            [("", FWD, ""), ("", "", ""), ("", END("1", "start", "1."), BWD() + ""), ("", END("2", "start", "2."), END("2", "discontinue")), ("", "", "")],
                            # pass 1: 1 2 3(ending 1) back; pass 2: 1 2 (3 skipped) 4 5
                            [0, 1, 2, 0, 1, 3, 4]),
    "repeats-nested": ("a repeat of bars 2-3 inside a repeat of bars 1-4",
                       [("", FWD, ""), ("", FWD, ""), ("", "", BWD()), ("", "", BWD()), ("", "", "")],
                       # the app's rule: 1 2 3 | 2 3 (inner done, popped) 4 | back to the last open forward (bar 2): 2 3 | 2 3 4 | 5
                       [0, 1, 2, 1, 2, 3, 1, 2, 1, 2, 3, 4]),
    "repeats-backward-only": ("a backward repeat with no forward repeat anywhere: back to the first bar",
                              [("", "", ""), ("", "", BWD()), ("", "", "")],
                              [0, 1, 0, 1, 2]),
    "repeats-endings-12-3": ("an ending for passes 1 and 2 with a backward repeat played three times, then an ending for pass 3",
                             [("", FWD, ""), ("", "", ""), ("", END("1, 2", "start", "1.-2."), BWD(3)), ("", END("3", "start", "3."), END("3", "stop")), ("", "", "")],
                             # passes 1 and 2 play bar 3; pass 3 skips it and plays bar 4
                             [0, 1, 2, 0, 1, 2, 0, 1, 3, 4]),
}
for name, (about, bars, order) in fixtures.items():
    xml = HEAD.format(about=about)
    for i, (_, left, right) in enumerate(bars):
        # an ending start lives on the left bar line; the right bar line may close it
        if left.startswith("<ending") and 'type="start"' in left:
            stop = END(left.split('number="')[1].split('"')[0], "stop")
            # schema order inside <barline>: bar-style, ending, repeat
            xml += measure(i, left=left, right=right.replace('<repeat', stop + '<repeat') if 'repeat direction="backward"' in right else right)
        else:
            xml += measure(i, left=left, right=right)
    xml += TAIL
    with open(os.path.join(D, name + ".musicxml"), "w", encoding="utf-8", newline="\n") as h:
        h.write(xml)
    with open(os.path.join(D, name + ".expect.json"), "w", encoding="utf-8", newline="\n") as h:
        json.dump({"about": about, "spec": "G01 §6.7 (the app's Score.form rule, G0 canonical.app_play_order)",
                   "expect": {"unroll": order}}, h, indent=1)
        h.write("\n")
print("ok")
