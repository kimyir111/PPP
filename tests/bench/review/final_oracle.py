#!/usr/bin/env python3
"""G0 FINAL independent review: correct outputs written differently from the reference must score perfectly.

adversarial.py's oracle feeds (a cleaned copy of) the reference file itself back in. This check writes
the same music the way another correct engraver would, and requires no penalty on any critical gate,
the diagnostic score or the metrics they use:

  as-is       the fixer's ideal output (reproduced, for comparison)
  pickup-bar  a pickup written as a full first bar that starts with typed rests (PPP's own style)
  mode-flip   <mode> written as the other mode (the key signature is what the reader sees)
  tempo-mark  every tempo only as a printed metronome mark (the <sound tempo>s removed)
  no-repeats  every repeat sign and ending removed: the score as the benchmark performs it (each bar once;
              added by the last fixer, G00 §21.15, with struct.form.order_exact among the checked metrics)

The checked metrics include the critical gates and the usable verdict (G00 §19 m3). A reference file is
not the ideal output where the catalogue itself is wrong; a metric below perfect is accepted only when
the reference carries a counted known failure that explains that metric (EXPLAINS), and the report
names how many references that is. Anything else below perfect is a GAP (exit 1).

    python tests/bench/review/final_oracle.py
"""

from __future__ import annotations

import os
import re
import sys
from collections import Counter
from fractions import Fraction

BENCH = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BENCH)
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from pppbench import corpus, evaluate, musicxml, perform, suite as suite_mod, util  # noqa: E402
import adversarial  # noqa: E402  (its _ideal_prediction: the fixer's construction)

util.setup_stdio()
KEYS = ["usable", "sqi", "notes.identity.f1", "notation.onset_pos.accuracy", "notation.onset_pos.accuracy_ref",
        "notation.duration.accuracy", "notation.duration.page_accuracy", "notation.ioi.accuracy", "notation.hand.accuracy",
        "notation.spelling.accuracy", "notation.note_shape.consistency", "struct.time_sig.exact",
        "struct.time_sig.timeline_accuracy", "struct.key.fifths_exact", "struct.key.timeline_accuracy",
        "struct.tempo.ok_effective", "struct.tempo.timeline_accuracy", "struct.downbeat.f1", "struct.measures.count_exact",
        "struct.measures.extra_empty_edge", "struct.measure_numbers.valid", "struct.measure_numbers.app_onset_accuracy",
        "notation.accidentals.required_recall", "read.bar_integrity", "read.bar_completeness", "struct.form.order_exact"] + \
    [k for k in __import__("pppbench.metrics.critical", fromlist=["GATES"]).GATES]

# A reference file is not the ideal output where the catalogue PPP ships is itself wrong, and the benchmark
# must say so rather than score it perfect (G00 §19 m3). A metric below perfect is accepted only when the
# reference carries a counted known failure (pppbench/known_defects.py) that explains exactly that metric.
EXPLAINS = {
    "key_signature_ignored": {"notation.accidentals.required_recall", "critical.accidentals", "usable"},
    "bar_accidental_not_carried": {"notation.accidentals.required_recall", "critical.accidentals", "usable"},
    "wrong_accidental": {"notation.accidentals.required_recall", "critical.accidentals", "usable"},
    "note_shape_mismatches": {"notation.note_shape.consistency", "notation.duration.page_accuracy", "critical.note_values",
                              "usable"},
    "incomplete_bars": {"read.bar_completeness", "critical.structure", "usable"},
    # the file's printed mark and <sound tempo> disagree: whichever the output keeps, one of the app's two tempi is wrong
    "tempo_marks_disagree": {"struct.tempo.timeline_accuracy", "struct.tempo.ok_effective", "critical.playback_tempo",
                             "usable", "sqi"},
}


def known_defects_of(path: str):
    from pppbench import known_defects
    if not path.startswith(("catalog/", "samples/")):
        return {}
    a = known_defects.audit_file(path)
    return {k: a[k] for k in EXPLAINS if a.get(k)}


def first_measure_span(xml: str):
    m = re.search(r"<measure\b[^>]*>.*?</measure>", xml, re.S)
    return m.start(), m.end()


def pickup_as_full_bar(xml: str, ref) -> str | None:
    """Make the implicit first bar full with a rest before the first voice. Every <backup> in that bar
    returns by the old voice length, so the voices after it start at the rest's end already."""
    m0 = ref.measures[0]
    if not m0.implicit:
        return None
    a, b = first_measure_span(xml)
    bar = xml[a:b]
    div = re.search(r"<divisions>(\d+)</divisions>", xml)
    if not div:
        return None
    d = (m0.sig_q - m0.len_q) * int(div.group(1))
    if d.denominator != 1 or d <= 0:
        return None
    d = int(d)
    bar = re.sub(r'\s+implicit="yes"', "", bar, count=1)
    note = re.search(r"<note\b", bar)
    staff = re.search(r"<staff>(\d+)</staff>", bar[note.start():])
    divisions = int(div.group(1))
    rests = ""
    for q in rest_values(m0.sig_q - m0.len_q):      # printed rests, each a single glyph (type + dots)
        typ, dots = GLYPHS[q]
        rests += (f"<note><rest/><duration>{int(q * divisions)}</duration><voice>1</voice><type>{typ}</type>"
                  + "<dot/>" * dots + (f"<staff>{staff.group(1)}</staff>" if staff else "") + "</note>")
    bar = bar[:note.start()] + rests + bar[note.start():]
    return xml[:a] + bar + xml[b:]


GLYPHS = {}
for _name, _q in (("whole", Fraction(4)), ("half", Fraction(2)), ("quarter", Fraction(1)), ("eighth", Fraction(1, 2)),
                  ("16th", Fraction(1, 4)), ("32nd", Fraction(1, 8))):
    GLYPHS[_q] = (_name, 0)
    GLYPHS[_q * Fraction(3, 2)] = (_name, 1)


def rest_values(total: Fraction):
    """Split a length into rests that each have one printed glyph, longest first."""
    out = []
    while total > 0:
        q = max((v for v in GLYPHS if v <= total), default=None)
        if q is None:
            break
        out.append(q)
        total -= q
    return out


def mode_flip(xml: str) -> str | None:
    if "<mode>major</mode>" in xml:
        return xml.replace("<mode>major</mode>", "<mode>minor</mode>")
    if "<mode>minor</mode>" in xml:
        return xml.replace("<mode>minor</mode>", "<mode>major</mode>")
    return None


def tempo_mark_only(xml: str, qpm: float, compound: bool) -> str:
    """Every tempo only as a printed metronome mark: the <sound tempo>s go, the printed marks stay where
    they are (a tempo change included); a file with no printed mark gets one at the start, counted in
    dotted quarters in compound time."""
    xml = re.sub(r"<sound\b[^>]*\btempo=\"[^\"]*\"[^>]*/>", "", xml)
    if "<metronome" in xml:
        return xml
    per = f"{qpm / 1.5:g}" if compound else f"{qpm:g}"
    unit = "<beat-unit>quarter</beat-unit><beat-unit-dot/>" if compound else "<beat-unit>quarter</beat-unit>"
    mark = f'<direction placement="above"><direction-type><metronome>{unit}<per-minute>{per}</per-minute></metronome></direction-type></direction>'
    a = re.search(r"<measure\b[^>]*>", xml)
    return xml[:a.end()] + mark + xml[a.end():]


def main() -> int:
    refs = corpus.by_id(corpus.load_corpus())
    s = suite_mod.load_suite("core")
    below = {v: Counter() for v in ("as-is", "pickup-bar", "mode-flip", "tempo-mark", "no-repeats")}
    explained = {v: Counter() for v in below}
    tried = Counter()
    examples = {}
    for rid in s["references"]:
        e = refs[rid]
        ref = corpus.read_reference(e)
        defects = known_defects_of(e.path)
        allowed = set().union(*(EXPLAINS[d] for d in defects)) if defects else set()
        p = perform.perform(ref, rid, "deadpan", "oracle", 1, expect=e.expect)
        t = corpus.expected_time(e, ref)
        qpm = corpus.expected_qpm(e, ref)
        bar_starts = [p.timemap.sec(m.start_q) for m in ref.measures] + [p.timemap.sec(ref.end_q)]
        raw = musicxml.read_bytes(e.abspath).decode("utf-8")
        ideal = adversarial._ideal_prediction(raw, qpm, ref.effective_qpm is not None)
        compound = t[1] >= 8 and t[0] % 3 == 0
        variants = {"as-is": (ideal, bar_starts)}
        pb = pickup_as_full_bar(ideal, ref)
        if pb is not None:
            m0 = ref.measures[0]
            spq = (bar_starts[1] - bar_starts[0]) / float(m0.len_q)
            variants["pickup-bar"] = (pb, [bar_starts[0] - float(m0.sig_q - m0.len_q) * spq] + bar_starts[1:])
        mf = mode_flip(ideal)
        if mf is not None:
            variants["mode-flip"] = (mf, bar_starts)
        variants["tempo-mark"] = (tempo_mark_only(ideal, qpm, compound), bar_starts)
        if re.search(r"<repeat\b|<ending\b", ideal):
            variants["no-repeats"] = (re.sub(r"<repeat\b[^>]*/>|<ending\b[^>]*/>|<ending\b[^>]*>.*?</ending>", "", ideal,
                                             flags=re.S), bar_starts)
        for name, (xml, bs) in variants.items():
            tried[name] += 1
            stats = {"barStarts": bs, "beats": list(p.input["beats"]), "beatsPerBar": t[0], "beatType": t[1]}
            try:
                m = evaluate.evaluate_timed(ref, p, {"ok": True, "xml": xml.encode("utf-8"), "stats": stats},
                                            skip_metrics=e.expect.get("skip_metrics", ()))[0]
            except Exception as exc:  # noqa: BLE001
                below[name]["ERROR " + type(exc).__name__] += 1
                examples.setdefault((name, "error"), f"{rid}: {exc}")
                continue
            short = []
            for k in KEYS:
                v = m.get(k)
                if v is None:
                    continue
                perfect = 0.0 if k == "struct.measures.extra_empty_edge" else (100.0 if k == "sqi" else 1.0)
                if abs(v - perfect) > 1e-9:
                    short.append((k, v))
            if short and all(k in allowed for k, _ in short):
                for d in defects:
                    explained[name][d] += 1
                continue
            for k, v in short:
                below[name][k] += 1
                examples.setdefault((name, k), f"{rid} {v:.4f}")
    ok = True
    for name in below:
        bad = below[name]
        ok &= not bad
        print(f"{'OK ' if not bad else 'GAP'}  {name:11} {tried[name]:3} references; below perfect: "
              + (", ".join(f"{k} {n} (e.g. {examples[(name, k)] if (name, k) in examples else ''})" for k, n in bad.items()) or "none")
              + (f"; below perfect only where the reference carries a known catalogue failure that explains it: "
                 f"{dict(explained[name])}" if explained[name] else ""))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
