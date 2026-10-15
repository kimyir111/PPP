"""The real-scan tier of omr-live-2 (G12-6; docs/GOALS/G12_OMR.md section 10 and 25): public-domain scans of the very editions the
catalogue was transcribed from, judged against the catalogue's own transcription.

    tests/omr/real-scan.json   the entries (fetched and rendered by fetch_real.py to tests/omr/out/real-scan/, never committed); each
                               entry's ``pages`` map a PDF page to the catalogue pieces on it (bars [first, last]) and its ``cases`` group
                               PDF pages into the cases (one page, or two when a piece runs over the page)

A case is ``<entry id>-p<first page>[-<last page>]``; its truth is its pieces' bars, in page order, read from the catalogue files by the
benchmark's reader; its pages are read by the engine one by one, as any case's. 30 % of the cases (the smallest split hashes) are the
held-out half, as for the excerpts. Standard library only (the gate tests it, on the committed manifest and catalogue).
"""

from __future__ import annotations

import hashlib
import json
import math
import os
from typing import Any, Dict, List, Optional

from . import fetch_real, xmlscore

REPO = fetch_real.REPO
SALT = "omr-live-2-real-scan"
HELD_SHARE = 0.30
TIER = "real-scan"


def _registry_paths(repo: str = REPO) -> Dict[str, str]:
    with open(os.path.join(repo, "tests", "bench", "corpus", "references.json"), encoding="utf-8") as h:
        return {r["id"]: r["path"] for r in json.load(h)["references"]}


def rank(case_id: str) -> str:
    return hashlib.sha256(f"{SALT}|{case_id}".encode("utf-8")).hexdigest()


def cases(doc: Optional[Dict[str, Any]] = None, out_dir: str = fetch_real.DEFAULT_OUT) -> List[Dict[str, Any]]:
    """Every case of the manifest: {id, case, entry, pdf_pages, rows, images, split, tags, bars}."""
    doc = doc or fetch_real.load_manifest()
    out: List[Dict[str, Any]] = []
    for e in doc.get("entries", []):
        for group in e.get("cases") or [[p] for p in sorted({r["pdf_page"] for r in e["pages"]})]:
            rows = [r for p in group for r in e["pages"] if r["pdf_page"] == p]
            cid = f"{e['id']}-p{group[0]}" + (f"-{group[-1]}" if len(group) > 1 else "")
            out.append({"id": cid, "case": cid, "entry": e["id"], "pdf_pages": list(group), "rows": rows,
                        "images": [fetch_real.page_image(e, p, out_dir) for p in group], "tags": [TIER, "work:" + e["work"]],
                        "bars": sum(r["bars"][1] - r["bars"][0] + 1 for r in rows)})
    order = sorted(out, key=lambda c: rank(c["id"]))
    n_held = math.ceil(HELD_SHARE * len(out) - 1e-9) if out else 0
    held = {c["id"] for c in order[:n_held]}
    for c in out:
        c["split"] = "held" if c["id"] in held else "tune"
    return out


def select(all_cases: List[Dict[str, Any]], selector: str) -> List[Dict[str, Any]]:
    """The real-scan cases of a --cases selector: all / tune / held by their split; ids by name; anything else (s1, a catalogue id): none."""
    if selector in ("all", "", None):
        return list(all_cases)
    if selector in ("tune", "held"):
        return [c for c in all_cases if c["split"] == selector]
    toks = {t.strip() for t in selector.split(",")}
    return [c for c in all_cases if c["id"] in toks or ("tag:" + TIER) in toks]


def truth(case: Dict[str, Any], repo: str = REPO, paths: Optional[Dict[str, str]] = None) -> xmlscore.Score:
    """The case's pieces' bars [first, last], in page order, as one score (the catalogue files, read as the benchmark reads a truth)."""
    paths = paths or _registry_paths(repo)
    parts: List[xmlscore.Score] = []
    for r in case["rows"]:
        s = xmlscore.parse_score(xmlscore.read_text(os.path.join(repo, paths[r["piece"]])))
        a, b = r["bars"]
        if b > len(s.bars):
            raise xmlscore.ScoreError(f"{r['piece']} has {len(s.bars)} bars, the manifest asks for {a}-{b}")
        parts.append(xmlscore.Score(parts=s.parts, bars=s.bars[a - 1:b], key=s.key, time=s.time, div0=s.div0))
    return xmlscore.join(parts)


def missing_images(sel: List[Dict[str, Any]]) -> List[str]:
    return [p for c in sel for p in c["images"] if not os.path.isfile(p)]
