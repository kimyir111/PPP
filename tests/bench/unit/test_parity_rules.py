"""One small MusicXML per app-parity rule (docs/GOALS/G00 §8.2)."""

import os
import unittest
from fractions import Fraction

from pppbench import musicxml, util


def score(measures, attrs="<divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time>",
          staves=None, extra_parts=""):
    st = f"<staves>{staves}</staves>" if staves else ""
    body = "".join(
        f'<measure number="{i + 1}"{m[1] if isinstance(m, tuple) else ""}>'
        + (f"<attributes>{attrs}{st}</attributes>" if i == 0 else "")
        + (m[0] if isinstance(m, tuple) else m) + "</measure>"
        for i, m in enumerate(measures))
    return f'<score-partwise><part id="P1">{body}</part>{extra_parts}</score-partwise>'


def n(step="C", octave=4, dur=1, extra="", staff=1, pre=""):
    return f"<note>{pre}<pitch><step>{step}</step><octave>{octave}</octave></pitch><duration>{dur}</duration>{extra}<staff>{staff}</staff></note>"


def rest(dur=1, staff=1):
    return f"<note><rest/><duration>{dur}</duration><staff>{staff}</staff></note>"


class ParityRules(unittest.TestCase):
    def test_r2_grace_is_skipped(self):
        c = musicxml.read_score(score([n("D", pre="<grace/>", dur=0) + n() * 4]))
        self.assertEqual(len(c.sounding), 4)
        self.assertEqual(c.diagnostics["grace_skipped"], 1)
        self.assertEqual(c.sounding[0].onset_q, 0)

    def test_r3_cue_is_kept(self):
        c = musicxml.read_score(score([n(pre="<cue/>") + n() * 3]))
        self.assertEqual(len(c.sounding), 4)
        self.assertEqual(c.diagnostics["cue_notes"], 1)
        self.assertTrue(c.notes[0].cue)

    def test_r4_backup_clamps_at_zero(self):
        c = musicxml.read_score(score([n(dur=2) + "<backup><duration>5</duration></backup>" + n("E", dur=4)]))
        self.assertEqual(c.diagnostics["backup_clamped"], 1)
        self.assertEqual([s.onset_q for s in c.sounding], [0, 0])

    def test_r5_forward_advances_and_grows_the_bar(self):
        c = musicxml.read_score(score([n() + "<forward><duration>5</duration></forward>"]))
        self.assertEqual(c.measures[0].len_q, 6)

    def test_r6_chord_uses_last_onset(self):
        c = musicxml.read_score(score([n(dur=2) + n("E", dur=1, pre="<chord/>") + n("G", dur=2)]))
        self.assertEqual([(s.midi, s.onset_q) for s in c.sounding], [(60, 0), (64, 0), (67, 2)])

    def test_r8_pickup_length_is_its_content(self):
        c = musicxml.read_score(score([(n(), ' implicit="yes"'), n() * 4]))
        self.assertEqual(c.measures[0].len_q, 1)
        self.assertTrue(c.measures[0].implicit)
        self.assertEqual(c.measures[1].start_q, 1)
        self.assertEqual(c.sounding[1].onset_q, 1)

    def test_r8_short_non_implicit_bar_keeps_signature_length(self):
        c = musicxml.read_score(score([n(), n() * 4]))
        self.assertEqual(c.measures[0].len_q, 4)

    def test_r8_overfull_bar_takes_content_length(self):
        c = musicxml.read_score(score([n() * 5]))
        self.assertEqual(c.measures[0].len_q, 5)

    def test_r8_only_part0_defines_grid(self):
        p2 = '<part id="P2"><measure number="1"><attributes><divisions>1</divisions></attributes>' + n(dur=8) + "</measure></part>"
        c = musicxml.read_score(score([n() * 4], extra_parts=p2))
        self.assertEqual(c.measures[0].len_q, 4)

    def test_r10_attributes_persist(self):
        c = musicxml.read_score(score([n() * 3, n() * 3],
                                      attrs="<divisions>1</divisions><key><fifths>-2</fifths><mode>minor</mode></key><time><beats>3</beats><beat-type>4</beat-type></time>"))
        self.assertEqual([m.time for m in c.measures], [(3, 4), (3, 4)])
        self.assertEqual(c.measures[1].fifths, -2)
        self.assertEqual(c.measures[1].mode, "minor")

    def test_r11_mode_default_and_explicit_flag(self):
        c = musicxml.read_score(score([n() * 4], attrs="<divisions>1</divisions><key><fifths>0</fifths></key>"))
        self.assertEqual(c.measures[0].mode, "major")
        self.assertFalse(c.measures[0].mode_explicit)

    def test_r12_alter_truncated_and_octave_default(self):
        x = "<note><pitch><step>C</step><alter>1.5</alter></pitch><duration>4</duration></note>"
        c = musicxml.read_score(score([x]))
        self.assertEqual(c.sounding[0].midi, 61)

    def test_r13_rest(self):
        c = musicxml.read_score(score([rest(2) + n(dur=2)]))
        self.assertEqual(len(c.rests), 1)
        self.assertEqual(c.sounding[0].onset_q, 2)

    def test_r14_ties_merge_and_tied_notations_are_ignored(self):
        tie_s = '<tie type="start"/>'
        tie_e = '<tie type="stop"/>'
        c = musicxml.read_score(score([n(dur=2) + n(dur=2, extra=tie_s), n(dur=2, extra=tie_e) + n(dur=2)]))
        self.assertEqual(len(c.notes), 4)
        self.assertEqual([(s.onset_q, s.dur_q, s.pieces) for s in c.sounding],
                         [(0, 2, 1), (2, 4, 2), (6, 2, 1)])
        # <notations><tied> alone does not tie (the app reads <tie>)
        tied = '<notations><tied type="start"/></notations>'
        c = musicxml.read_score(score([n(dur=2) + n(dur=2).replace("</note>", tied + "</note>"), n(dur=4)]))
        self.assertEqual(len(c.sounding), 3)

    def test_r15_tuplet(self):
        tm = "<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>"
        c = musicxml.read_score(score([n(dur=1, extra=tm) * 3 + n(dur=1)],
                                      attrs="<divisions>3</divisions><time><beats>2</beats><beat-type>4</beat-type></time>"))
        self.assertEqual(c.notes[0].tuplet, (3, 2))
        self.assertEqual(c.sounding[1].onset_q, Fraction(1, 3))
        self.assertTrue(c.sounding[0].tuplet)
        self.assertFalse(c.sounding[3].tuplet)

    def test_r16_r17_hands_two_parts(self):
        c = musicxml.read_score(os.path.join(util.repo_root(), "samples", "vocal-piano.musicxml"))
        hands = {}
        for s in c.sounding:
            hands.setdefault(s.staff, set()).add(s.hand)
        self.assertEqual(hands, {1: {"x"}, 2: {"r"}, 3: {"l"}})
        self.assertEqual(c.piano_part, 1)
        self.assertEqual(c.staves, 3)
        self.assertEqual(len(c.played()), 8)

    def test_r17_single_staff_plays_right_hand(self):
        c = musicxml.read_score(score([n() * 4]))
        self.assertEqual({s.hand for s in c.sounding}, {"r"})

    def test_r18_tempo_sound_first_then_dotted_metronome(self):
        met = ("<direction><direction-type><metronome><beat-unit>quarter</beat-unit><beat-unit-dot/>"
               "<per-minute>48</per-minute></metronome></direction-type></direction>")
        c = musicxml.read_score(score([met + n(dur=3) * 2],
                                      attrs="<divisions>2</divisions><time><beats>6</beats><beat-type>8</beat-type></time>"))
        self.assertEqual(c.effective_qpm, 72.0)
        self.assertEqual(c.printed_qpm, 72.0)
        self.assertIsNone(c.sound_qpm)
        both = ('<direction><direction-type><metronome><beat-unit>quarter</beat-unit><beat-unit-dot/>'
                '<per-minute>48</per-minute></metronome></direction-type><sound tempo="48"/></direction>')
        c = musicxml.read_score(score([both + n(dur=3) * 2],
                                      attrs="<divisions>2</divisions><time><beats>6</beats><beat-type>8</beat-type></time>"))
        # the app reads <sound tempo> first, as quarters a minute
        self.assertEqual(c.effective_qpm, 48.0)
        self.assertEqual(c.sound_qpm, 48.0)
        self.assertEqual(c.printed_qpm, 72.0)
        self.assertEqual([m.kind for m in c.marks], ["sound", "metronome"])

    def test_r18_measure_level_sound_and_first_value_wins(self):
        c = musicxml.read_score(score(['<sound tempo="90"/>' + n() * 4, '<sound tempo="60"/>' + n() * 4]))
        self.assertEqual(c.effective_qpm, 90.0)
        self.assertEqual([m.onset_q for m in c.marks], [0, 4])
        c = musicxml.read_score(score([n() * 4]))
        self.assertIsNone(c.effective_qpm)
        self.assertEqual(c.app_qpm, 84)

    def test_r19_direction_offset(self):
        d = '<direction><direction-type><words>x</words></direction-type><offset>2</offset><sound tempo="100"/></direction>'
        c = musicxml.read_score(score([n() + d + n() * 3]))
        self.assertEqual(c.marks[0].pos_q, 3)

    # r20: the reader's ottava="app" mode models the pre-MX-1 app; rebaselined in MX-2 (the app now reads an
    # octave-shift the MusicXML way).
    def test_r20_ottava_up_raises_the_sounding_pitch(self):
        up = '<direction><direction-type><octave-shift type="up" size="8"/></direction-type><staff>1</staff></direction>'
        stop = '<direction><direction-type><octave-shift type="stop" size="8"/></direction-type><staff>1</staff></direction>'
        c = musicxml.read_score(score([up + n() + stop + n() * 3]))
        self.assertEqual((c.notes[0].written_midi, c.notes[0].midi), (60, 72))
        self.assertEqual(c.notes[1].midi, 60)
        self.assertTrue(c.diagnostics["octave_shift"])

    def test_r20_unclosed_or_other_staff_ottava_does_nothing(self):
        up = '<direction><direction-type><octave-shift type="up" size="15"/></direction-type><staff>2</staff></direction>'
        stop = '<direction><direction-type><octave-shift type="stop"/></direction-type><staff>2</staff></direction>'
        c = musicxml.read_score(score([up + n() * 4 + stop], staves=2))
        self.assertEqual(c.notes[0].midi, 60)  # staff 1 note, shift on staff 2
        c = musicxml.read_score(score([up.replace("<staff>2</staff>", "") + n() * 4]))
        self.assertEqual(c.notes[0].midi, 60)  # never stopped

    def test_r20_down_15(self):
        dn = '<direction><direction-type><octave-shift type="down" size="15"/></direction-type></direction>'
        stop = '<direction><direction-type><octave-shift type="stop"/></direction-type></direction>'
        c = musicxml.read_score(score([dn + n() * 2 + stop + n() * 2]))
        self.assertEqual([x.midi for x in c.notes], [36, 36, 60, 60])

    def test_r21_staves_clamped(self):
        c = musicxml.read_score(score([n(staff=6) + n() * 3], staves=6))
        self.assertEqual(c.staves, 4)

    def test_namespace_is_ignored(self):
        x = score([n() * 4]).replace("<score-partwise>", '<score-partwise xmlns="urn:x">')
        self.assertEqual(len(musicxml.read_score(x).sounding), 4)


if __name__ == "__main__":
    unittest.main()
