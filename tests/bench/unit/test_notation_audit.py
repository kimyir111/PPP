"""tests/bench/tools/notation_audit.py (G03 Step 0): each metric on a small hand-written file."""

import os
import sys
import unittest
from fractions import Fraction

from pppbench import util

_saved_path = list(sys.path)
sys.path.insert(0, os.path.join(util.bench_root(), "tools"))
import notation_audit as na  # noqa: E402
sys.path[:] = _saved_path   # the tools directory stays off the path the other tests see


def score(measures, time=(4, 4), fifths=0, staves=2, extra_attr=""):
    """A one-part score. measures: list of inner XML strings (notes, backups, directions)."""
    out = ['<?xml version="1.0" encoding="UTF-8"?><score-partwise version="4.0"><part-list>'
           '<score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1">']
    for i, body in enumerate(measures):
        attrs = ""
        if i == 0:
            attrs = (f"<attributes><divisions>24</divisions><key><fifths>{fifths}</fifths></key>"
                     f"<time><beats>{time[0]}</beats><beat-type>{time[1]}</beat-type></time>"
                     f"<staves>{staves}</staves><clef number=\"1\"><sign>G</sign><line>2</line></clef>"
                     f"<clef number=\"2\"><sign>F</sign><line>4</line></clef>{extra_attr}</attributes>")
        out.append(f'<measure number="{i + 1}">{attrs}{body}</measure>')
    out.append("</part></score-partwise>")
    return "".join(out).encode("utf-8")


def note(step="C", octave=5, dur=24, typ="quarter", alter=0, staff=1, voice=1, chord=False, extra="", notations="",
         tm=False, acc=None):
    p = f"<pitch><step>{step}</step>{f'<alter>{alter}</alter>' if alter else ''}<octave>{octave}</octave></pitch>"
    tmx = "<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>" if tm else ""
    accx = f"<accidental>{acc}</accidental>" if acc else ""
    nx = f"<notations>{notations}</notations>" if notations else ""
    return (f"<note>{'<chord/>' if chord else ''}{p}<duration>{dur}</duration>{extra}<voice>{voice}</voice>"
            f"<type>{typ}</type>{accx}{tmx}<staff>{staff}</staff>{nx}</note>")


def rest(dur=24, typ="quarter", staff=1, voice=1, tm=False):
    tmx = "<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>" if tm else ""
    return f"<note><rest/><duration>{dur}</duration><voice>{voice}</voice><type>{typ}</type>{tmx}<staff>{staff}</staff></note>"


def whole_lh():
    return "<backup><duration>96</duration></backup>" + note("C", 3, 96, "whole", staff=2, voice=5)


class NotationAuditTest(unittest.TestCase):
    def test_rests_events_and_short_share(self):
        c = na.count(score([note() + rest(12, "eighth") + rest(3, "32nd") + rest(3, "32nd") + rest(6, "16th")
                            + note(dur=48, typ="half") + whole_lh()]))
        self.assertEqual(c["bars"], 1)
        self.assertEqual(c["events"], 7)
        self.assertEqual(c["rests"], 4)
        self.assertEqual(c["elements"], 7)
        self.assertEqual(c["short"], 2)

    def test_chord_tones_are_elements_not_events(self):
        c = na.count(score([note("C", 5) + note("E", 5, chord=True) + note("G", 5, chord=True)
                            + note(dur=72, typ="half", extra="") + whole_lh()]))
        self.assertEqual(c["events"], 3)
        self.assertEqual(c["elements"], 5)
        self.assertEqual(c["notes"], 5)

    def test_tie_inside_one_beat_is_mergeable(self):
        # 8~8 on beat 1: one quarter could replace it
        m = (note(dur=12, typ="eighth", extra='<tie type="start"/>', notations='<tied type="start"/>')
             + note(dur=12, typ="eighth", extra='<tie type="stop"/>') + note(dur=72, typ="half", extra="") + whole_lh())
        c = na.count(score([m]))
        self.assertEqual(c["ties"], 1)
        self.assertEqual(c["tie_same_beat"], 1)
        self.assertEqual(c["tie_unmatched"], 0)

    def test_tie_across_a_beat_or_not_one_symbol_is_not_mergeable(self):
        # 8 then 8~4 across beats 1-2: the tie crosses a beat line
        across = (note(dur=12, typ="eighth") + note(dur=12, typ="eighth", extra='<tie type="start"/>')
                  + note(dur=24, extra='<tie type="stop"/>') + note(dur=48, typ="half") + whole_lh())
        self.assertEqual(na.count(score([across]))["tie_same_beat"], 0)
        # 16~16. inside one beat: 1/4 + 3/8 = 5/8 of a quarter is not one plain value
        odd = (note(dur=6, typ="16th", extra='<tie type="start"/>') + note(dur=9, typ="16th", extra='<tie type="stop"/><dot/>')
               + rest(9, "16th") + note(dur=72, typ="half") + whole_lh())
        self.assertEqual(na.count(score([odd]))["tie_same_beat"], 0)

    def test_chain_middle_pieces_and_unmatched(self):
        m = (note(dur=24, extra='<tie type="start"/>') + note(dur=24, extra='<tie type="stop"/><tie type="start"/>')
             + note(dur=24, extra='<tie type="stop"/>') + note("D", 5, 24, extra='<tie type="start"/>') + whole_lh())
        c = na.count(score([m]))
        self.assertEqual(c["ties"], 3)
        self.assertEqual(c["chain3"], 1)
        self.assertEqual(c["tie_unmatched"], 1)
        self.assertEqual(c["tie_unmatched_app"], 1)

    def test_app_rule_needs_the_stop_where_the_tied_note_ends(self):
        # the stop comes after a gap: the loose rule joins it, the app's rule does not
        m = (note(dur=24, extra='<tie type="start"/>') + rest(24) + note(dur=48, typ="half", extra='<tie type="stop"/>')
             + whole_lh())
        c = na.count(score([m]))
        self.assertEqual(c["tie_unmatched"], 0)
        self.assertEqual(c["tie_unmatched_app"], 1)

    def test_one_note_brackets_and_tm_missing(self):
        one = '<tuplet type="start" bracket="yes"/><tuplet type="stop"/>'
        m = (note(dur=8, typ="eighth", tm=True, notations=one) + note(dur=8, typ="eighth", tm=True, notations=one)
             + rest(8, "eighth")                                    # a triplet-length rest with no time-mod
             + note(dur=72, typ="half", extra="<dot/>") + whole_lh())
        c = na.count(score([m]))
        self.assertEqual(c["tm"], 2)
        self.assertEqual(c["brackets"], 2)
        self.assertEqual(c["bracket_one"], 2)
        self.assertEqual(c["tm_missing"], 1)
        self.assertEqual(c["tm_missing_rests"], 1)

    def test_a_bracket_over_three_notes_is_not_one_note(self):
        stop_rest = rest(8, "eighth", tm=True).replace("</staff>", '</staff><notations><tuplet type="stop"/></notations>')
        m = (note(dur=8, typ="eighth", tm=True, notations='<tuplet type="start"/>') + note(dur=8, typ="eighth", tm=True)
             + stop_rest + note(dur=72, typ="half", extra="<dot/>") + whole_lh())
        c = na.count(score([m]))
        self.assertEqual(c["brackets"], 1)
        self.assertEqual(c["bracket_one"], 0)
        self.assertEqual(c["tm"], 3)
        self.assertEqual(c["tm_missing"], 0)

    def test_voices_per_staff_bar(self):
        two = (note(dur=96, typ="whole", voice=1) + "<backup><duration>96</duration></backup>"
               + note("E", 4, 48, "half", voice=2) + note("F", 4, 48, "half", voice=2) + whole_lh())
        c = na.count(score([two]))
        self.assertEqual(c["staff_bars"], 2)
        self.assertEqual(c["voice_sum"], 3)
        self.assertEqual(c["poly"], 1)

    def test_beams_stems_and_offbeat(self):
        m = (note(dur=12, typ="eighth", extra="<stem>up</stem><beam number=\"1\">begin</beam>")
             + note(dur=24, typ="quarter")                         # off the beat, crosses beat 2
             + note(dur=12, typ="eighth") + note(dur=48, typ="half") + whole_lh())
        c = na.count(score([m]))
        self.assertEqual(c["beamed"], 1)
        self.assertEqual(c["stem"], 1)
        self.assertEqual(c["offbeat"], 1)

    def test_accidentals_and_spelling(self):
        m = (note("E", 5, 24, alter=1, acc="sharp") + note("B", 4, 24, alter=-1, acc="flat")
             + note("F", 5, 24, alter=2, acc="double-sharp") + note("C", 5, 24, alter=-1) + whole_lh())
        c = na.count(score([m]))
        self.assertEqual(c["printed_acc"], 3)
        self.assertEqual(c["double_acc"], 1)
        self.assertEqual(c["odd_spell"], 2)                       # E# and Cb in C major
        self.assertEqual(c["mixed_acc"], 1)
        # in C# major (7 sharps) E# and B# belong to the key
        k = na.count(score([note("E", 5, 48, "half", alter=1) + note("B", 4, 48, "half", alter=1) + whole_lh()], fifths=7))
        self.assertEqual(k["odd_spell"], 0)

    def test_ledger_lines_and_hand_ranges(self):
        self.assertEqual(na.ledger_lines("A", 5, ("G", 2)), 1)
        self.assertEqual(na.ledger_lines("C", 6, ("G", 2)), 2)
        self.assertEqual(na.ledger_lines("G", 6, ("G", 2)), 4)
        self.assertEqual(na.ledger_lines("C", 4, ("G", 2)), 1)
        self.assertEqual(na.ledger_lines("C", 4, ("F", 4)), 1)
        self.assertEqual(na.ledger_lines("E", 2, ("F", 4)), 1)
        self.assertEqual(na.ledger_lines("F", 5, ("G", 2)), 0)
        m = (note("G", 6, 24) + note("B", 6, 24) + note("E", 3, 48, "half")
             + "<backup><duration>96</duration></backup>" + note("A", 4, 96, "whole", staff=2, voice=5))
        c = na.count(score([m]))
        self.assertEqual(c["ledger4"], 2)                         # G6 (4) and B6 (5) on treble; A4 on bass has 3
        self.assertEqual(c["ledger5"], 1)
        self.assertEqual(c["rh_low"], 1)                          # E3 on the upper staff
        self.assertEqual(c["lh_high"], 1)                         # A4 on the lower staff

    def test_marks_are_counted_per_file(self):
        directions = ('<direction><direction-type><dynamics><p/></dynamics></direction-type></direction>'
                      '<direction><direction-type><wedge type="crescendo"/></direction-type></direction>'
                      '<direction><direction-type><pedal type="start"/></direction-type></direction>'
                      '<direction><direction-type><octave-shift type="down" size="8"/></direction-type></direction>')
        m = (directions + note(notations='<slur type="start"/><articulations><staccato/><accent/></articulations>')
             + note(notations='<slur type="stop"/>') + note(dur=48, typ="half") + whole_lh())
        grace = '<note><grace/><pitch><step>D</step><octave>5</octave></pitch><voice>1</voice><type>eighth</type><notations><slur type="start"/></notations></note>'
        c = na.count(score([grace + m]))
        self.assertEqual((c["dynamics"], c["wedge"], c["pedal"], c["octave"]), (1, 1, 1, 1))
        self.assertEqual(c["slur"], 1)                            # the grace note's slur is not counted
        self.assertEqual(c["artic"], 2)
        self.assertEqual(c["events"], 4)                          # the grace note is not an event

    def test_short_voice_bars_are_inner_only(self):
        full = note(dur=96, typ="whole") + whole_lh()
        short = note(dur=48, typ="half") + whole_lh()
        c = na.count(score([short, short, full, short]))
        self.assertEqual(c["inner_vb"], 4)                        # bars 2 and 3, two voices each
        self.assertEqual(c["vb_short"], 1)

    def test_compound_beat_and_single_symbol(self):
        self.assertEqual(na.beat_len((6, 8)), Fraction(3, 2))
        self.assertEqual(na.beat_len((3, 4)), Fraction(1))
        self.assertEqual(na.beat_len((2, 2)), Fraction(2))
        self.assertTrue(na.is_compound((12, 8)))
        self.assertFalse(na.is_compound((3, 4)))
        self.assertTrue(na.single_symbol(Fraction(3, 2)))
        self.assertTrue(na.single_symbol(Fraction(7, 8)))
        self.assertFalse(na.single_symbol(Fraction(5, 4)))

    def test_aggregate_pools_and_sums(self):
        a = {"files": 1, "rests": 1, "bars": 1, "tie_unmatched": 2}
        b = {"files": 1, "rests": 5, "bars": 3, "tie_unmatched": 1}
        agg = na.aggregate([a, b])
        self.assertEqual(agg["files"], 2)
        self.assertAlmostEqual(agg["rests_per_bar"], 1.5)
        self.assertEqual(agg["tie_unmatched"], 3)
        self.assertIsNone(agg["tie_same_beat"])                   # no ties at all


if __name__ == "__main__":
    unittest.main()
