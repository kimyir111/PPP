"""The real-scan tier: public-domain page images, fetched by id, never committed (docs/GOALS/G12_OMR.md section 10, G12-D8).

    python tests/bench/run.py omr-live-2 fetch-real --check                 offline: is tests/omr/real-scan.json well formed and clean?
    python tests/bench/run.py omr-live-2 fetch-real --list
    python tests/bench/run.py omr-live-2 fetch-real --verify  [--allow-network]    ask the host about each file's licence; download nothing
    python tests/bench/run.py omr-live-2 fetch-real --fetch --allow-network [--out DIR]   verify, download, check the sha256, render pages
    python tests/bench/run.py omr-live-2 fetch-real --pin ID --allow-network       download once and PRINT the sha256 (for a maintainer to commit)

The page images are scans of the very editions the catalogue was transcribed from (catalog/method/books.json: Beyer, Peters, Leipzig 1895;
Czerny Op. 599, Schirmer, New York 1893). Their files are NOT in the repository and this script never writes inside a tracked path: the
output directory must be git-ignored (default tests/omr/out/real-scan/).

What it will and will not download:
  * only an entry of tests/omr/real-scan.json, whose host is on the allow-list (Wikimedia Commons, IMSLP), whose URL is https, whose
    sha256 is pinned, and that carries a licence statement with the page that shows it (``licence_evidence``);
  * only after the host itself says the file is public domain: for Commons, the file's ``extmetadata`` must say it is not copyrighted
    and name a public-domain licence; for IMSLP, the evidence page must show "Copyright Status: Public Domain" (IMSLP states a
    status per work). If the host does not say so, or the answer cannot be read, NOTHING is downloaded for that entry;
  * the bytes must hash to the pinned sha256, else the file is deleted;
  * the network is touched only with --allow-network. Without it every command works offline on the manifest alone.

The manifest ships EMPTY: nobody has checked a file's licence on the host yet, and an id or URL written down from memory would be a
guess. To add one: find the scan on the host, read the licence on the page, write the entry with a sha256 of 64 zeros, run ``--pin ID --allow-network``
(it asks the host about the licence, downloads once and prints the real sha256), look at the file once, put the sha256 in the entry and commit it.
Standard library only (PyMuPDF, when installed, renders the downloaded PDFs to 300 DPI PNGs).
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
import urllib.parse
import urllib.request
from typing import Any, Dict, List, Optional, Tuple

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))            # tests/omr
REPO = os.path.dirname(os.path.dirname(HERE))
MANIFEST = os.path.join(HERE, "real-scan.json")
DEFAULT_OUT = os.path.join(HERE, "out", "real-scan")
SCHEMA = "ppp.omr-real-scan/1"
USER_AGENT = "PPP-omr-bench/1 (tests/omr/omrbench/fetch_real.py; a local benchmark tool; fetches a few public-domain scan pages)"

HOSTS = {
    "commons": ("upload.wikimedia.org", "commons.wikimedia.org"),
    "imslp": ("imslp.org", "petruccimusiclibrary.org", "ks.imslp.net", "ks4.imslp.net", "ks15.imslp.net"),
}
API = {"commons": "https://commons.wikimedia.org/w/api.php"}
# a Commons licence short name that means "public domain": Public domain, PD-old-70, PD-US, PD-self, CC0 ... (nothing else)
PD_LICENCE = re.compile(r"^(public domain|pd[-\s]|pd$|cc0|creative commons zero)", re.I)
NEEDED = ("id", "source", "title", "url", "sha256", "licence", "licence_evidence", "edition", "work", "pages")


def load_manifest(path: str = MANIFEST) -> Dict[str, Any]:
    with open(path, encoding="utf-8") as h:
        doc = json.load(h)
    if doc.get("schema") != SCHEMA:
        raise ValueError(f"{path}: not a {SCHEMA} file")
    return doc


# ---------------------------------------------------------------------------------------- pure checks (unit-tested in the gate)
def host_of(url: str) -> Optional[str]:
    try:
        p = urllib.parse.urlparse(url)
    except ValueError:
        return None
    return p.hostname if p.scheme == "https" else None


def check_manifest(doc: Dict[str, Any]) -> List[str]:
    """Every problem of the manifest (an empty list = it may be used)."""
    problems: List[str] = []
    if doc.get("schema") != SCHEMA:
        problems.append("schema")
    seen = set()
    for i, e in enumerate(doc.get("entries", [])):
        tag = f"entry {i} ({e.get('id', '?')})"
        for k in NEEDED:
            if not e.get(k):
                problems.append(f"{tag}: {k} is missing")
        if e.get("id") in seen:
            problems.append(f"{tag}: duplicate id")
        seen.add(e.get("id"))
        src = e.get("source")
        if src not in HOSTS:
            problems.append(f"{tag}: source must be one of {', '.join(sorted(HOSTS))}")
            continue
        host = host_of(e.get("url", ""))
        if host is None:
            problems.append(f"{tag}: url must be https")
        elif host not in HOSTS[src]:
            problems.append(f"{tag}: host {host} is not on the {src} allow-list")
        if not re.fullmatch(r"[0-9a-f]{64}", e.get("sha256", "") or ""):
            problems.append(f"{tag}: sha256 must be 64 hex digits")
        if host_of(e.get("licence_evidence", "")) is None:
            problems.append(f"{tag}: licence_evidence must be the https page that shows the licence")
        for p in e.get("pages", []):
            if not (isinstance(p.get("pdf_page"), int) and p["pdf_page"] >= 1 and p.get("piece") and
                    isinstance(p.get("bars"), list) and len(p["bars"]) == 2 and 1 <= p["bars"][0] <= p["bars"][1]):
                problems.append(f"{tag}: a page needs pdf_page (1-based), piece and bars [first, last]")
                break
    return problems


def commons_licence_ok(api_json: Dict[str, Any], title: str) -> Tuple[bool, str]:
    """Does the Commons API answer (prop=imageinfo, iiprop=url|sha1|size|extmetadata) say this file is public domain?"""
    try:
        pages = api_json["query"]["pages"]
        page = next(iter(pages.values()))
        info = page["imageinfo"][0]
        meta = info["extmetadata"]
    except (KeyError, IndexError, StopIteration, TypeError):
        return False, "the answer has no file information"
    if page.get("title") and page["title"].replace("_", " ") != title.replace("_", " "):
        return False, f"the answer is for {page.get('title')}, not {title}"
    copyrighted = str((meta.get("Copyrighted") or {}).get("value", "")).strip().lower()
    short = str((meta.get("LicenseShortName") or {}).get("value", "")).strip()
    if copyrighted != "false":
        return False, f"Commons says Copyrighted={copyrighted or 'unknown'}"
    if not PD_LICENCE.match(short):
        return False, f"licence {short or 'unknown'!r} is not a public-domain licence"
    return True, short


def imslp_licence_ok(html: str) -> Tuple[bool, str]:
    """Does an IMSLP work page show 'Copyright Status: Public Domain'? (IMSLP states a status per work.)"""
    text = re.sub(r"<[^>]+>", " ", html or "")
    text = re.sub(r"\s+", " ", text)
    m = re.search(r"Copyright Status\s*:?\s*([A-Za-z][A-Za-z ./-]{2,40})", text)
    if not m:
        return False, "no 'Copyright Status' on the page"
    status = m.group(1).strip()
    return (status.lower().startswith("public domain"), status)


def sha256_bytes(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


# ---------------------------------------------------------------------------------------- the network half (never run by the gate)
def http_get(url: str, allow_network: bool, maxbytes: int = 200 * 1024 * 1024) -> bytes:
    if not allow_network:
        raise RuntimeError("the network is not touched without --allow-network")
    if host_of(url) is None:
        raise RuntimeError(f"refusing a non-https URL: {url}")
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=60) as r:
        data = r.read(maxbytes + 1)
    if len(data) > maxbytes:
        raise RuntimeError("the file is larger than the cap")
    return data


def verify_entry(e: Dict[str, Any], allow_network: bool) -> Tuple[bool, str]:
    """Ask the host whether the file is public domain. (False, reason) when it says not or cannot be read: then nothing is downloaded."""
    if e["source"] == "commons":
        q = urllib.parse.urlencode({"action": "query", "titles": e["title"], "prop": "imageinfo", "iiprop": "url|sha1|size|extmetadata",
                                    "format": "json"})
        try:
            ok, why = commons_licence_ok(json.loads(http_get(API["commons"] + "?" + q, allow_network)), e["title"])
        except (OSError, ValueError, RuntimeError) as exc:
            return False, f"could not ask Commons: {exc}"
        return ok, why
    try:
        return imslp_licence_ok(http_get(e["licence_evidence"], allow_network, 8 * 1024 * 1024).decode("utf-8", "replace"))
    except (OSError, RuntimeError) as exc:
        return False, f"could not read the evidence page: {exc}"


def ensure_ignored(path: str) -> None:
    """A page image goes to a git-ignored folder or nowhere."""
    r = subprocess.run(["git", "check-ignore", "-q", os.path.join(path, "x")], cwd=REPO)
    if r.returncode != 0:
        raise RuntimeError(f"{path} is not git-ignored: page images are never committed (use a folder under tests/omr/out/)")


def render_pdf(pdf_path: str, out_dir: str, stem: str) -> List[str]:
    try:
        import pymupdf as fitz      # noqa
    except ImportError:
        try:
            import fitz            # noqa
        except ImportError:
            return []
    files = []
    with fitz.open(pdf_path) as doc:
        for i, page in enumerate(doc, 1):
            p = os.path.join(out_dir, f"{stem}-p{i}.png")
            page.get_pixmap(dpi=300, colorspace=fitz.csGRAY).save(p)
            files.append(p)
    return files


def fetch(entries: List[Dict[str, Any]], out_dir: str, allow_network: bool, log=print) -> int:
    ensure_ignored(out_dir)
    os.makedirs(out_dir, exist_ok=True)
    bad = 0
    for e in entries:
        ok, why = verify_entry(e, allow_network)
        if not ok:
            log(f"REFUSED {e['id']}: {why}")
            bad += 1
            continue
        try:
            data = http_get(e["url"], allow_network)
        except (OSError, RuntimeError) as exc:
            log(f"FAILED {e['id']}: {exc}")
            bad += 1
            continue
        if sha256_bytes(data) != e["sha256"]:
            log(f"REFUSED {e['id']}: the file's sha256 is {sha256_bytes(data)}, not the pinned one")
            bad += 1
            continue
        pdf = os.path.join(out_dir, e["id"] + ".pdf")
        with open(pdf, "wb") as h:
            h.write(data)
        pngs = render_pdf(pdf, out_dir, e["id"])
        log(f"fetched {e['id']} ({why}): {len(data)} bytes, {len(pngs)} page image(s)")
    return 1 if bad else 0


def pin(entry_id: str, doc: Dict[str, Any], allow_network: bool, log=print) -> int:
    e = next((x for x in doc.get("entries", []) if x["id"] == entry_id), None)
    if e is None:
        log(f"no entry {entry_id!r}")
        return 2
    ok, why = verify_entry(e, allow_network)
    if not ok:
        log(f"REFUSED {entry_id}: {why}")
        return 1
    data = http_get(e["url"], allow_network)
    log(f"{entry_id}: licence {why}; {len(data)} bytes; sha256 {sha256_bytes(data)}")
    return 0


def main(argv: Optional[List[str]] = None) -> int:
    ap = argparse.ArgumentParser(prog="run.py omr-live-2 fetch-real", description=__doc__.split("\n\n")[0])
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--check", action="store_true")
    g.add_argument("--list", action="store_true")
    g.add_argument("--verify", action="store_true")
    g.add_argument("--fetch", action="store_true")
    g.add_argument("--pin", metavar="ID")
    ap.add_argument("--allow-network", action="store_true")
    ap.add_argument("--out", default=DEFAULT_OUT)
    ap.add_argument("--manifest", default=MANIFEST)
    args = ap.parse_args(argv)
    doc = load_manifest(args.manifest)
    problems = check_manifest(doc)
    if args.check or problems:
        for p in problems:
            print("PROBLEM", p)
        print(f"real-scan manifest: {len(doc.get('entries', []))} entries, {len(problems)} problems")
        return 1 if problems else 0
    if args.list:
        for e in doc.get("entries", []):
            print(f"{e['id']:32} {e['source']:8} {e['edition']} · {len(e['pages'])} pages · {e['licence']}")
        return 0
    if args.pin:
        return pin(args.pin, doc, args.allow_network)
    if not doc.get("entries"):
        print("the manifest has no entries yet (see the module docstring: add one after reading its licence on the host)")
        return 0
    if args.verify:
        bad = 0
        for e in doc["entries"]:
            ok, why = verify_entry(e, args.allow_network)
            print(("ok      " if ok else "REFUSED ") + f"{e['id']}: {why}")
            bad += not ok
        return 1 if bad else 0
    return fetch(doc["entries"], args.out, args.allow_network)


if __name__ == "__main__":
    sys.exit(main())
