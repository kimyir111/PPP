#!/usr/bin/env python3
"""Write tests/bench/corpus/provenance.json: where every candidate reference comes from and why its
licence is (or is not) evidenced in this repository (docs/GOALS/G00 §17 M10).

Only evidence that is *in the repository* counts: the file's own <rights>/<software>/<creator>, a
per-file entry in a catalog index, or a book statement that names the same typesetter the file
names. A generic book-level claim that the files of the same book contradict (burgmuller25 and
sonatina say "PDMX" at book level while their files name Mutopia, PianoXML or nothing) is not
evidence for a file on its own. Nothing is guessed: without evidence a file is "unverified" and is
quarantined from every benchmark suite.

    python tests/bench/tools/make_provenance.py [--check]
"""

from __future__ import annotations

import argparse
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

from pppbench import corpus, musicxml, util  # noqa: E402

OUT = os.path.join(util.bench_root(), "corpus", "provenance.json")


def _field(data: str, tag: str):
    m = re.search(rf"<{tag}[^>]*>(.*?)</{tag}>", data, re.S)
    return re.sub(r"\s+", " ", m.group(1)).strip() if m else None


def hymn_sources():
    text = util.read_text(os.path.join(util.repo_root(), "catalog", "hymns", "sources.js"))
    return dict(re.findall(r"id:\s*'([^']+)'[^}]*?abc:\s*'([^']+)'", text))


def build():
    root = util.repo_root()
    tracked = util.tracked_files()
    books = {b["id"]: b for b in util.load_json(os.path.join(root, "catalog", "method", "books.json"))["books"]}
    cat = {e["file"]: e for e in util.load_json(os.path.join(root, "catalog", "index.json"))["scores"]}
    hymn_index = {e["file"]: e for e in util.load_json(os.path.join(root, "catalog", "hymns", "index.json"))["hymns"]}
    abc = hymn_sources()
    entries = []
    for c in corpus.candidate_files(tracked):
        path = c["path"]
        data = musicxml.read_bytes(os.path.join(root, path)).decode("utf-8", "replace")
        rights, software, creator = _field(data, "rights"), _field(data, "software"), _field(data, "creator")
        e = {"id": c["id"], "path": path, "source": None, "original_id": None, "license": None,
             "license_status": "unverified", "evidence": [], "generated_internally": False,
             "transcribed_by_ppp": False, "eligible": None, "trusted": False}
        if rights:
            e["evidence"].append(f"{path} <rights>: {rights}")
        if software:
            e["evidence"].append(f"{path} <software>: {software}")
        s = c["set"]
        if s == "micro":
            e.update(source="written for the benchmark by tests/bench/tools/make_micro.py", license="CC0 1.0",
                     license_status="generated", generated_internally=True, trusted=True,
                     eligible="PPP's own benchmark piece, CC0 in the file")
        elif s == "omr":
            e.update(source="generated from tests/fixtures/truth.json by tests/bench/tools/make_omr_reference.py",
                     license="PPP's own test fixture", license_status="generated", generated_internally=True, trusted=True,
                     eligible="PPP's own OMR fixture")
        elif s == "samples":
            if software and "Hand-written sample for PPP" in software:
                e.update(source=f"hand-written for PPP (composer given as {creator})", license="PPP's own work",
                         license_status="ppp-own-work", generated_internally=True, trusted=True,
                         eligible="typeset by PPP; public-domain composer")
        elif s == "catalog":
            entry = cat.get(os.path.basename(path))
            if entry and entry.get("license"):
                e["evidence"].append(f"catalog/index.json {entry['id']}: license {entry['license']}")
                e.update(source=f"PPP public-domain catalog ({creator}, {entry['title']})", license=entry["license"],
                         license_status="repo-metadata", trusted=True,
                         eligible="per-file licence in catalog/index.json; public-domain composition")
        elif s == "hymns":
            name = os.path.basename(path)
            entry = hymn_index.get(name)
            src = abc.get(name[:-len(".musicxml")])
            if entry and entry.get("license") and src:
                e["evidence"] += [f"catalog/hymns/index.json {entry['id']}: {entry['license']}",
                                  f"catalog/hymns/sources.js {entry['id']}: abc {src}"]
                e.update(source="Open Hymnal Project ABC SATB setting (2014.06), converted by catalog/hymns/abc-to-musicxml.js",
                         original_id=src, license=entry["license"], license_status="repo-metadata",
                         generated_internally=True, trusted=True,
                         eligible="per-file public-domain statement and source in the hymn catalog")
        elif s == "method":
            book, no = c["book"], os.path.basename(path)[:-4]
            b = books.get(book, {})
            src_abc = f"catalog/method/src/{book}/{no}.abc"
            if rights and "Transcribed for PPP" in rights:
                e.update(source=(f"PPP transcription, {b.get('edition')}" if book in ("beyer", "czerny599") else
                                 "PPP transcription" + (f" (ABC source {src_abc})" if src_abc in tracked else "")),
                         license=rights, license_status="file-statement", transcribed_by_ppp=True, trusted=True,
                         eligible="transcribed by PPP from a public-domain edition (statement in the file)")
            elif rights and re.search(r"public domain", rights, re.I):
                mut = re.search(r"Mutopia-[\d/]+-\d+", rights)
                if mut:
                    source, oid = "Mutopia Project", mut.group(0)
                elif "PianoXML" in rights:
                    source, oid = "PianoXML typeset (named in the file; the book-level note says PDMX)", None
                else:
                    source, oid = f"community typeset; catalog/method/books.json says: {b.get('edition')} (no per-file identifier)", None
                e.update(source=source, original_id=oid, license=rights, license_status="file-statement", trusted=True,
                         eligible="public-domain statement in the file")
            elif rights and "Hayashi Neru" in rights and "Neru Hayashi" in (b.get("edition") or ""):
                e["evidence"].append(f"catalog/method/books.json {book}: {b.get('edition')}")
                e.update(source="Neru Hayashi's typeset (named in the file), via PDMX per catalog/method/books.json",
                         license="dedicated to the public domain (catalog/method/books.json, names the same typesetter)",
                         license_status="repo-metadata", trusted=True,
                         eligible="the book statement names the typesetter the file names")
            else:
                e["eligible"] = None
                e["quarantine_reason"] = ("no licence evidence in the repository: the file has "
                                          + (f"<rights> '{rights}'" if rights else "no <rights>")
                                          + f"; the only statement is the generic book-level '{b.get('edition')}', "
                                          "which other files of the method catalogue contradict")
        if not e["trusted"] and "quarantine_reason" not in e:
            e["quarantine_reason"] = "no licence evidence found in the repository"
        entries.append(e)
    return {"schema": "ppp.bench-provenance/1",
            "policy": "Only repository evidence counts (file <rights>/<software>, per-file catalog entries, a book "
                      "statement naming the file's own typesetter). Untrusted files are quarantined from all suites.",
            "entries": sorted(entries, key=lambda x: x["id"])}


def main(argv=None) -> int:
    util.setup_stdio()
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--check", action="store_true", help="fail if the committed manifest differs from a rebuild")
    a = ap.parse_args(argv)
    doc = build()
    text = util.dumps_json(doc)
    if a.check:
        same = os.path.exists(OUT) and util.read_text(OUT) == text
        print("provenance.json matches the repository evidence" if same else "provenance.json is stale: rerun make_provenance.py")
        return 0 if same else 1
    util.dump_json(doc, OUT)
    t = sum(1 for e in doc["entries"] if e["trusted"])
    print(f"wrote {util.rel(OUT)}: {len(doc['entries'])} files, {t} trusted, {len(doc['entries']) - t} quarantined")
    for e in doc["entries"]:
        if not e["trusted"]:
            print(f"  QUARANTINE {e['id']}: {e['quarantine_reason'][:110]}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
