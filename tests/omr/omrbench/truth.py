"""Truth export: a catalogue score -> the excerpt that is BOTH the truth and the engraver's input (docs/GOALS/G12_OMR.md section 10).

The first ``bars`` bars of every part, nothing else changed: the notes are the catalogue's exact MusicXML, so every bar of a read
can be judged exactly. What is removed is what could make an engraver (or an OCR pass) print something that is not music:
``<print>`` hints (new-system / new-page breaks of the catalogue's own layout) and ``<credit>`` blocks (printed titles); the
``<work-title>`` stays, so PPP's print path prints its own title area. The bytes are deterministic (the same on Windows and
Linux, any run order): one parse, a fixed edit, ElementTree's serialisation, UTF-8, no declaration.

Standard library only (the CI gate runs it).
"""

from __future__ import annotations

import hashlib
import xml.etree.ElementTree as ET
from typing import Dict, Tuple

from . import xmlscore

EXCERPT_BARS = 24


def cut_excerpt(xml: str, bars: int = EXCERPT_BARS) -> Tuple[str, Dict[str, int]]:
    """(excerpt text, {"bars_total", "bars"}). Raises xmlscore.ScoreError for something that is not a partwise score."""
    try:
        root = ET.fromstring(xml.encode("utf-8"))
    except ET.ParseError as exc:
        raise xmlscore.ScoreError(f"not XML: {exc}") from exc
    if root.tag != "score-partwise":
        raise xmlscore.ScoreError(f"not a score-partwise document ({root.tag})")
    sps = root.findall("part-list/score-part")
    parts = root.findall("part")
    for i, (sp, part) in enumerate(zip(sps, parts)):      # an engraver needs ids to match parts to their definitions
        if not sp.get("id"):
            sp.set("id", "P%d" % (i + 1))
        if not part.get("id"):
            part.set("id", sp.get("id"))
    total = 0
    for part in parts:
        ms = part.findall("measure")
        total = max(total, len(ms))
        for m in ms[bars:]:
            part.remove(m)
        for m in part.findall("measure"):
            for p in m.findall("print"):
                m.remove(p)
    for c in root.findall("credit"):
        root.remove(c)
    return ET.tostring(root, encoding="unicode"), {"bars_total": total, "bars": min(total, bars)}


def export_bytes(source_path: str, bars: int = EXCERPT_BARS) -> Tuple[bytes, Dict[str, int]]:
    text, info = cut_excerpt(xmlscore.read_text(source_path), bars)
    return text.encode("utf-8"), info


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()
