#!/usr/bin/env python3
"""tests/fixtures/truth.json -> tests/bench/corpus/omr/piano-test-score.musicxml.

truth.json is the ground truth that tests/fixtures/make-fixtures.js engraved
into piano-clean.{pdf,png,jpg} and piano-multipage.pdf: treble quarter notes,
bass half notes, one bar per list entry. The output is committed and is the
reference of the omr-live suite (T1-O).

    python tests/bench/tools/make_omr_reference.py [--check]
"""

import argparse
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(HERE)))
TRUTH = os.path.join(ROOT, "tests", "fixtures", "truth.json")
OUT = os.path.join(os.path.dirname(HERE), "corpus", "omr", "piano-test-score.musicxml")


def note(key: str, dur: int, typ: str, voice: int, staff: int) -> str:
    step, octave = key.split("/")
    step = step.upper()
    alter = 1 if "#" in step else -1 if step.endswith("B") and len(step) > 1 else 0
    return (f"<note><pitch><step>{step[0]}</step>" + (f"<alter>{alter}</alter>" if alter else "") +
            f"<octave>{octave}</octave></pitch><duration>{dur}</duration><voice>{voice}</voice>"
            f"<type>{typ}</type><staff>{staff}</staff></note>")


def build(truth) -> str:
    div = 1
    bar = truth["beats"] * 4 // truth["beatType"]
    out = ['<?xml version="1.0" encoding="UTF-8"?>', '<score-partwise version="3.1">',
           f"<work><work-title>{truth['title']}</work-title></work>",
           '<identification><creator type="composer">PPP test fixture</creator>'
           "<rights>PPP's own OMR fixture (tests/fixtures/make-fixtures.js)</rights></identification>",
           '<part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>', '<part id="P1">']
    for i, (tre, bas) in enumerate(zip(truth["treble"], truth["bass"])):
        out.append(f'<measure number="{i + 1}">')
        if i == 0:
            out.append(f"<attributes><divisions>{div}</divisions><key><fifths>{truth['keyFifths']}</fifths><mode>major</mode></key>"
                       f"<time><beats>{truth['beats']}</beats><beat-type>{truth['beatType']}</beat-type></time><staves>2</staves>"
                       '<clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes>')
            out.append('<direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit>'
                       f"<per-minute>{truth['tempo']}</per-minute></metronome></direction-type><staff>1</staff>"
                       f"<sound tempo=\"{truth['tempo']}\"/></direction>")
        q = bar // len(tre)
        out += [note(k, q * div, "quarter" if q == 1 else "half", 1, 1) for k in tre]
        out.append(f"<backup><duration>{bar * div}</duration></backup>")
        h = bar // len(bas)
        out += [note(k, h * div, "half" if h == 2 else "whole", 5, 2) for k in bas]
        out.append("</measure>")
    out.append("</part></score-partwise>")
    return "\n".join(out) + "\n"


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args(argv)
    with open(TRUTH, encoding="utf-8") as h:
        text = build(json.load(h))
    old = None
    if os.path.exists(OUT):
        with open(OUT, encoding="utf-8") as h:
            old = h.read()
    if args.check:
        print("omr reference matches truth.json" if old == text else "omr reference differs from truth.json")
        return 0 if old == text else 1
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8", newline="\n") as h:
        h.write(text)
    print(f"wrote {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
