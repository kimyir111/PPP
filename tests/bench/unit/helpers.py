"""Small MusicXML builders for unit tests."""

from pppbench import musicxml


def measure(notes_rh="", notes_lh="", number=1, attrs="", implicit=False, rh_len=None):
    back = f"<backup><duration>{rh_len}</duration></backup>" if notes_lh and rh_len else ""
    return (f'<measure number="{number}"' + (' implicit="yes"' if implicit else "") + ">" +
            (f"<attributes>{attrs}</attributes>" if attrs else "") + notes_rh + back + notes_lh + "</measure>")


def note(step="C", octave=4, dur=1, staff=1, alter=0, extra="", chord=False, voice=None, tie=None, typ=None):
    t = ""
    if tie in ("start", "stop"):
        t = f'<tie type="{tie}"/>'
    v = voice or (1 if staff == 1 else 5)
    return ("<note>" + ("<chord/>" if chord else "") + f"<pitch><step>{step}</step>" +
            (f"<alter>{alter}</alter>" if alter else "") + f"<octave>{octave}</octave></pitch>"
            f"<duration>{dur}</duration>{t}<voice>{v}</voice>" + (f"<type>{typ}</type>" if typ else "") +
            extra + f"<staff>{staff}</staff></note>")


def rest(dur, staff=1):
    return f"<note><rest/><duration>{dur}</duration><staff>{staff}</staff></note>"


def score_xml(measures, divisions=1, time=(4, 4), fifths=0, mode="major", staves=2, tempo=None):
    attrs = (f"<divisions>{divisions}</divisions><key><fifths>{fifths}</fifths>" + (f"<mode>{mode}</mode>" if mode else "") +
             f"</key><time><beats>{time[0]}</beats><beat-type>{time[1]}</beat-type></time><staves>{staves}</staves>")
    body = []
    for i, m in enumerate(measures):
        if i == 0:
            tdir = (f'<direction><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>{tempo}</per-minute>'
                    f'</metronome></direction-type><sound tempo="{tempo}"/></direction>') if tempo else ""
            m = m.replace(">", ">" + f"<attributes>{attrs}</attributes>" + tdir, 1)
        body.append(m)
    return '<score-partwise><part id="P1">' + "".join(body) + "</part></score-partwise>"


def canon(measures, **kw):
    return musicxml.read_score(score_xml(measures, **kw))


def scale_melody(n_bars=4, dur=1, divisions=1, time=(4, 4), lh=True):
    """RH C major scale in quarter notes (dur = divisions per note), LH whole-bar C3."""
    steps = "CDEFGAB"
    per_bar = int(time[0] * 4 / time[1] * divisions // dur)
    out, k = [], 0
    for b in range(n_bars):
        rh = ""
        for _ in range(per_bar):
            rh += note(steps[k % 7], 4 + (k // 7) % 2, dur)
            k += 1
        bar_len = per_bar * dur
        left = note("C", 3, bar_len, staff=2) if lh else ""
        out.append(measure(rh, left, number=b + 1, rh_len=bar_len))
    return out
