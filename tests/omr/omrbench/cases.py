"""Which excerpts omr-live-2 holds (docs/GOALS/G12_OMR.md section 10, G12-D8).

The pool is the corpus registry's licence-clean part: sets hymns / method / catalog, never a G0 hold-out file, never a
quarantined one (excluded.json). From it a fixed number of excerpts (first 24 bars) is chosen, deterministically:

  1. the 15 pieces of the design document's section 1 (tag ``s1``): the numbers of that section are reproduced on exactly them;
  2. coverage: every time signature and every key (fifths) that the pool has is present at least once;
  3. each collection is filled to its quota, in the order of a hash of the piece's id (no one picked by hand, no one by taste).

A fixed 30 % of the excerpts is the HELD-OUT half (``split: held``): the reports of a phase quote it as a number, its cases are
not looked at one by one (G0 rules; the baseline file keeps per-case rows for the tuning half only). The result is committed as
tests/omr/cases.json; ``python -I tests/omr/omrbench/cases.py --check`` rebuilds it and compares, and the gate unit-tests it.

Standard library only.
"""

from __future__ import annotations

import hashlib
import json
import os
import sys
import xml.etree.ElementTree as ET
from typing import Dict, List, Optional

if __package__ in (None, ""):                 # run as a script: python -I tests/omr/omrbench/cases.py
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    __package__ = "omrbench"

from . import BENCH, xmlscore                 # noqa: E402

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))           # tests/omr
REPO = os.path.dirname(os.path.dirname(HERE))
REFERENCES = os.path.join(REPO, "tests", "bench", "corpus", "references.json")
EXCLUDED = os.path.join(REPO, "tests", "bench", "corpus", "excluded.json")
CASES = os.path.join(HERE, "cases.json")

SCHEMA = "ppp.omr-cases/1"
TOTAL = 60
HELD_SHARE = 0.30
SALT = "omr-live-2"
SETS = ("hymns", "method", "catalog")

# the design document's section 1 pages (reproduced within +-0.02 by A0)
S1 = ("hymns/silent-night", "hymns/joy-to-the-world", "hymns/blessed-assurance", "hymns/how-firm-a-foundation", "hymns/it-is-well",
      "method/beyer/012", "method/czerny599/010", "method/czerny849/005", "method/hanon/001",
      "method/burgmuller25/003", "method/burgmuller25/015", "method/sonatina/001", "method/sonatina/007",
      "catalog/gymnopedie-1", "catalog/happy-birthday")
# the six of them the app path (PDF + photo through Import.load) is run on: E1, E9
S1_APP = ("hymns/silent-night", "hymns/joy-to-the-world", "method/beyer/012", "method/czerny599/010", "method/sonatina/001",
          "catalog/gymnopedie-1")

# how many excerpts each collection ends with (they sum to TOTAL)
QUOTA = {"hymns": 21, "beyer": 9, "czerny599": 8, "czerny849": 5, "hanon": 3, "burgmuller25": 4, "sonatina": 8, "catalog": 2}
MIN_BARS_COVERAGE = 8        # a piece shorter than this is only an excerpt of itself
MIN_BARS_FILL = 16


# the brace-less tier (G0's omr-live fixtures, kept): VexFlow pages with a thin bracket instead of a brace and bar lines that do not
# cross the staves, so Audiveris sees two independent staves (issues 11 and 12). Their truth is the committed MusicXML the fixtures were
# generated from. Audiveris alone reads the two images; the app path reads all four (a PDF is rasterised by the page itself)
FIXTURE_TRUTH = "tests/bench/corpus/omr/piano-test-score.musicxml"
FIXTURES = (
    {"id": "brace-less/piano-clean.pdf", "path": "tests/fixtures/piano-clean.pdf", "type": "application/pdf", "engine": False},
    {"id": "brace-less/piano-clean.png", "path": "tests/fixtures/piano-clean.png", "type": "image/png", "engine": True},
    {"id": "brace-less/piano-clean.jpg", "path": "tests/fixtures/piano-clean.jpg", "type": "image/jpeg", "engine": True},
    {"id": "brace-less/piano-multipage.pdf", "path": "tests/fixtures/piano-multipage.pdf", "type": "application/pdf", "engine": False},
)


def fixtures(repo: str = REPO) -> List[Dict[str, object]]:
    out = []
    for f in FIXTURES:
        with open(os.path.join(repo, f["path"]), "rb") as h:
            digest = hashlib.sha256(h.read()).hexdigest()
        out.append(dict(f, case=f["id"].replace("/", "_"), sha256=digest, truth=FIXTURE_TRUTH, split="tune", tags=["brace-less"], bars=8))
    return out


def collection_of(ref_id: str) -> str:
    parts = ref_id.split("/")
    return parts[1] if parts[0] == "method" else parts[0]


def rank(ref_id: str, salt: str = SALT) -> str:
    return hashlib.sha256(f"{salt}|{ref_id}".encode("utf-8")).hexdigest()


def features(path: str) -> Dict[str, object]:
    """Bars, first time signature and key, staves, notes and tuplets of a catalogue file (a light read: no Fractions)."""
    root = ET.fromstring(xmlscore.read_text(path).encode("utf-8"))
    part = root.find("part")
    first = part.find("measure/attributes") if part is not None else None
    bars = len(part.findall("measure")) if part is not None else 0
    beats = part.find("measure/attributes/time/beats") if part is not None else None
    beat_type = part.find("measure/attributes/time/beat-type") if part is not None else None
    fifths = part.find("measure/attributes/key/fifths") if part is not None else None
    staves = part.find("measure/attributes/staves") if part is not None else None
    return {
        "bars_total": bars,
        "time": (beats.text + "/" + beat_type.text) if beats is not None and beat_type is not None else "?",
        "fifths": int(fifths.text) if fifths is not None else 0,
        "staves": int(staves.text) if staves is not None else 1,
        "notes": len(root.findall(".//note")),
        "tuplets": len(root.findall(".//time-modification")),
        "parts": len(root.findall("part")),
    }


def pool(repo: str = REPO) -> List[Dict[str, object]]:
    """The licence-clean pool: registry entries of the sets, not hold-out, not quarantined, with their features."""
    with open(os.path.join(repo, "tests", "bench", "corpus", "references.json"), encoding="utf-8") as h:
        refs = json.load(h)["references"]
    with open(os.path.join(repo, "tests", "bench", "corpus", "excluded.json"), encoding="utf-8") as h:
        excluded = {x["id"] for x in json.load(h)["excluded"]}
    out = []
    for r in refs:
        if r.get("holdout") or r["set"] not in SETS or r["id"] in excluded:
            continue
        f = features(os.path.join(repo, r["path"]))
        out.append(dict(f, id=r["id"], path=r["path"], set=r["set"], collection=collection_of(r["id"]), license=r.get("license", ""),
                        source_sha256=r["sha256"]))
    out.sort(key=lambda x: x["id"])
    return out


def select(candidates: List[Dict[str, object]], total: int = TOTAL, quota: Optional[Dict[str, int]] = None) -> List[str]:
    """The chosen ids, in id order. Deterministic: only the candidates' ids and features are read."""
    quota = dict(QUOTA if quota is None else quota)
    by_id = {c["id"]: c for c in candidates}
    chosen: List[str] = []

    def add(i: str) -> None:
        if i not in chosen:
            chosen.append(i)

    for i in S1:
        if i not in by_id:
            raise ValueError(f"the section-1 piece {i} is not in the pool")
        add(i)

    def has(cls_key: str, value) -> bool:
        return any(by_id[i][cls_key] == value for i in chosen)

    for cls_key in ("time", "fifths"):
        for value in sorted({c[cls_key] for c in candidates if c["bars_total"] >= MIN_BARS_COVERAGE}, key=str):
            if has(cls_key, value):
                continue
            options = sorted((c for c in candidates if c[cls_key] == value and c["id"] not in chosen
                              and c["bars_total"] >= MIN_BARS_COVERAGE),
                             key=lambda c: (c["bars_total"] < MIN_BARS_FILL, rank(c["id"])))
            if options:
                add(options[0]["id"])
    # fill each collection to its quota; whatever the S1 and coverage picks already hold counts
    held = {k: sum(1 for i in chosen if by_id[i]["collection"] == k) for k in quota}
    for k in sorted(quota):
        need = quota[k] - held[k]
        options = sorted((c for c in candidates if c["collection"] == k and c["id"] not in chosen and c["bars_total"] >= MIN_BARS_FILL),
                         key=lambda c: rank(c["id"]))
        for c in options[:max(0, need)]:
            add(c["id"])
    return sorted(chosen)


def split_of(chosen: List[str], share: float = HELD_SHARE) -> Dict[str, str]:
    """The held-out half: the ceil(share * N) ids with the smallest split hash. Stratifying is deliberately not done."""
    n_held = int(share * len(chosen) + 0.999999)
    order = sorted(chosen, key=lambda i: rank(i, SALT + "-split"))
    held = set(order[:n_held])
    return {i: ("held" if i in held else "tune") for i in chosen}


def build(repo: str = REPO, total: int = TOTAL) -> Dict[str, object]:
    cands = pool(repo)
    by_id = {c["id"]: c for c in cands}
    ids = select(cands, total)
    sp = split_of(ids)
    cases = []
    for i in ids:
        c = by_id[i]
        tags = ["collection:" + c["collection"], "time:" + c["time"], "key:%+d" % c["fifths"]]
        if i in S1:
            tags.append("s1")
        if i in S1_APP:
            tags.append("s1-app")
        cases.append({"id": i, "case": i.replace("/", "_"), "path": c["path"], "source_sha256": c["source_sha256"], "bars": min(24, c["bars_total"]),
                      "bars_total": c["bars_total"], "time": c["time"], "fifths": c["fifths"], "staves": c["staves"],
                      "split": sp[i], "tags": tags, "license": c["license"]})
    return {"schema": SCHEMA, "bench": BENCH, "excerpt_bars": 24, "salt": SALT, "pool": len(cands),
            "coverage": {"time": sorted({c["time"] for c in cases}), "fifths": sorted({c["fifths"] for c in cases})},
            "cases": cases, "fixtures": fixtures(repo)}


def load(path: str = CASES) -> Dict[str, object]:
    with open(path, encoding="utf-8") as h:
        doc = json.load(h)
    if doc.get("schema") != SCHEMA:
        raise ValueError(f"{path}: not a {SCHEMA} file")
    return doc


def dumps(doc: Dict[str, object]) -> str:
    return json.dumps(doc, indent=1, sort_keys=True, ensure_ascii=False) + "\n"


def main(argv: Optional[List[str]] = None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    doc = build()
    text = dumps(doc)
    if "--write" in argv:
        with open(CASES, "w", encoding="utf-8", newline="\n") as h:
            h.write(text)
        print(f"wrote {os.path.relpath(CASES, REPO)}: {len(doc['cases'])} cases, {sum(c['bars'] for c in doc['cases'])} bars")
        return 0
    if "--check" in argv:
        with open(CASES, encoding="utf-8", newline="") as h:
            have = h.read().replace("\r\n", "\n")
        if have != text:
            print("tests/omr/cases.json differs from the selection the corpus registry gives now: run with --write and look at the diff")
            return 1
        print(f"cases.json is what the registry gives: {len(doc['cases'])} cases")
        return 0
    print(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
