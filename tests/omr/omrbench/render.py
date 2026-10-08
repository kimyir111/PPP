"""truth -> engraver -> pages -> degraded pages (docs/GOALS/G12_OMR.md section 10). Local tool: Verovio, Chrome, NumPy, OpenCV.

Per case (tests/omr/cases.json) under ``tests/omr/out/render/<case>/``:

    truth.musicxml            the excerpt (truth.py): the engraver's input and the answer
    A/p1.svg ...              engraver A, Verovio 6.3 (python package), A4 2100 x 2970 units, no header or footer
    B/p1.svg ...              engraver B, PPP's own print path (node/ppp-print.js)
    <E>/clean-p1.png ...      A4 300 DPI (2480 x 3508) by headless Chrome (node/raster.js)
    <E>/photo-p1.jpg ...      degrade.py, seed per (engraver, page)
    <E>/scan-p1.jpg ...       150 DPI grey
    <E>/score.pdf             a vector PDF of the SVG pages (only for the app path: ``ensure_pdf``)
    render.json               every file's sha256 and size, the tool versions

A page is rebuilt only when its input changed (the key is a hash of the truth bytes, the engraver and its options, the degradation
parameters); ``force`` rebuilds. Page images are NEVER committed.
"""

from __future__ import annotations

import hashlib
import json
import os
import subprocess
import struct
import sys
import tempfile
from typing import Any, Dict, List, Optional

from . import degrade, envinfo, truth as truthmod

HERE = envinfo.HERE
OUT = os.path.join(HERE, "out")
RENDER = os.path.join(OUT, "render")
NODE_DIR = os.path.join(HERE, "node")

ENGRAVERS = ("A", "B")
ENGRAVER_NAME = {"A": "verovio", "B": "ppp-print"}
CLEAN_PX = (2480, 3508)                  # A4 at 300 DPI
VEROVIO_OPTIONS = {"pageWidth": 2100, "pageHeight": 2970, "scale": 100, "adjustPageHeight": False, "breaks": "auto",
                   "footer": "none", "header": "none", "pageMarginTop": 100, "pageMarginBottom": 100, "pageMarginLeft": 100,
                   "pageMarginRight": 100,
                   # Verovio draws a fresh random xml:id for every element unless it is given a seed: the SVG text then differs between
                   # two runs (the picture does not). Seeded, the same excerpt is the same bytes every time
                   "xmlIdSeed": 1}


class RenderError(Exception):
    pass


def sha256_file(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def png_size(path: str) -> Optional[List[int]]:
    with open(path, "rb") as f:
        head = f.read(24)
    if head[:8] != b"\x89PNG\r\n\x1a\n":
        return None
    return list(struct.unpack(">II", head[16:24]))


def tool_versions() -> Dict[str, Any]:
    v: Dict[str, Any] = dict(degrade.versions())
    try:
        import verovio
        v["verovio"] = verovio.toolkit().getVersion().split("[")[0]
    except Exception:                                    # not installed: engraver A is unavailable
        v["verovio"] = "missing"
    try:
        pj = None
        for d in envinfo.node_modules_dirs():
            p = os.path.join(d, "puppeteer", "package.json")
            if os.path.isfile(p):
                pj = p
                break
        v["puppeteer"] = json.load(open(pj, encoding="utf-8"))["version"] if pj else "missing"
    except Exception:
        v["puppeteer"] = "missing"
    try:
        v["chrome"] = open(os.path.join(OUT, "chrome.txt"), encoding="utf-8").read().strip()
    except OSError:
        v["chrome"] = "unknown (not rasterised on this machine yet)"
    v["python"] = sys.version.split()[0]
    return v


# ---------------------------------------------------------------------------------------------- engravers
def _verovio_pages(xml_text: str) -> List[str]:
    import verovio
    tk = verovio.toolkit()
    tk.setOptions(VEROVIO_OPTIONS)
    if not tk.loadData(xml_text):
        raise RenderError("Verovio could not load the excerpt")
    return [tk.renderToSVG(p) for p in range(1, tk.getPageCount() + 1)]


def _ppp_pages(truth_path: str, out_dir: str) -> List[str]:
    r = subprocess.run([envinfo.node_binary(), os.path.join(NODE_DIR, "ppp-print.js"), "--in", truth_path, "--out", out_dir],
                       capture_output=True, env=envinfo.node_env(), timeout=300)
    if r.returncode != 0:
        lines = (r.stderr or b"").decode("utf-8", "replace").strip().splitlines()
        raise RenderError("ppp-print.js: " + (lines[-1] if lines else f"exit {r.returncode}"))
    files = sorted((f for f in os.listdir(out_dir) if f.startswith("p") and f.endswith(".svg")), key=lambda f: int(f[1:-4]))
    return [os.path.join(out_dir, f) for f in files]


def _write(path: str, data: bytes) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as f:
        f.write(data)


def svg_pages(case: Dict[str, Any], engraver: str, root: str = RENDER) -> List[str]:
    """Make (or find) the truth and the SVG pages of one engraver; returns the SVG files in page order."""
    cdir = os.path.join(root, case["case"])
    tpath = os.path.join(cdir, "truth.musicxml")
    data, _ = truthmod.export_bytes(os.path.join(envinfo.REPO, case["path"]), case["bars"])
    if not os.path.isfile(tpath) or open(tpath, "rb").read() != data:
        _write(tpath, data)
    edir = os.path.join(cdir, engraver)
    key = hashlib.sha256(json.dumps([truthmod.sha256(data), ENGRAVER_NAME[engraver], VEROVIO_OPTIONS if engraver == "A" else None,
                                     tool_versions().get("verovio") if engraver == "A" else None],
                                    sort_keys=True).encode()).hexdigest()
    stamp = os.path.join(edir, "svg.key")
    have = sorted((f for f in os.listdir(edir) if f.startswith("p") and f.endswith(".svg")), key=lambda f: int(f[1:-4])) if os.path.isdir(edir) else []
    if have and os.path.isfile(stamp) and open(stamp, encoding="utf-8").read() == key:
        return [os.path.join(edir, f) for f in have]
    if os.path.isdir(edir):
        for f in os.listdir(edir):
            os.remove(os.path.join(edir, f))
    os.makedirs(edir, exist_ok=True)
    if engraver == "A":
        pages = _verovio_pages(data.decode("utf-8"))
        files = []
        for i, svg in enumerate(pages, 1):
            p = os.path.join(edir, f"p{i}.svg")
            _write(p, svg.encode("utf-8"))
            files.append(p)
    else:
        files = _ppp_pages(tpath, edir)
    with open(stamp, "w", encoding="utf-8") as f:
        f.write(key)
    return files


# ---------------------------------------------------------------------------------------------- raster
def _png_job(svg: str, out: str, engraver: str) -> Dict[str, Any]:
    if engraver == "A":     # exactly the design document's: 2100 x 2970 units shot at 2480 / 2100
        return {"kind": "png", "svg": svg, "out": out,
                "viewport": {"width": 2100, "height": 2970, "deviceScaleFactor": CLEAN_PX[0] / 2100},
                "clip": {"x": 0, "y": 0, "width": 2100, "height": 2970}, "set_size": None}
    return {"kind": "png", "svg": svg, "out": out, "viewport": {"width": CLEAN_PX[0], "height": CLEAN_PX[1], "deviceScaleFactor": 1},
            "clip": {"x": 0, "y": 0, "width": CLEAN_PX[0], "height": CLEAN_PX[1]},
            "set_size": {"width": CLEAN_PX[0], "height": CLEAN_PX[1]}}


def run_raster(jobs: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Shoot the jobs with node/raster.js; returns its summary line ({"ok", "failed", "chrome"})."""
    if not jobs:
        return {"ok": 0, "failed": [], "chrome": None}
    with tempfile.TemporaryDirectory(prefix="omr-raster-") as tmp:
        jp = os.path.join(tmp, "jobs.json")
        with open(jp, "w", encoding="utf-8") as f:
            json.dump(jobs, f)
        r = subprocess.run([envinfo.node_binary(), os.path.join(NODE_DIR, "raster.js"), "--jobs", jp], capture_output=True,
                           env=envinfo.node_env(), timeout=3600)
    if r.returncode != 0:
        tail = ((r.stdout or b"") + (r.stderr or b"")).decode("utf-8", "replace").strip()
        raise RenderError("raster.js failed: " + tail[-600:])
    lines = (r.stdout or b"").decode("utf-8", "replace").strip().splitlines()
    summary = json.loads(lines[-1]) if lines else {"ok": len(jobs), "failed": [], "chrome": None}
    if summary.get("chrome"):
        os.makedirs(OUT, exist_ok=True)
        with open(os.path.join(OUT, "chrome.txt"), "w", encoding="utf-8") as f:
            f.write(summary["chrome"])
    return summary


def ensure_pdf(case: Dict[str, Any], engraver: str, root: str = RENDER) -> str:
    """A vector PDF of the case's SVG pages (A4), for the app path."""
    svgs = svg_pages(case, engraver, root)
    out = os.path.join(root, case["case"], engraver, "score.pdf")
    stamp = out + ".key"
    key = hashlib.sha256(("pdf2|" + "|".join(sha256_file(s) for s in svgs)).encode()).hexdigest()
    if os.path.isfile(out) and os.path.isfile(stamp) and open(stamp, encoding="utf-8").read() == key:
        return out
    run_raster([{"kind": "pdf", "svgs": svgs, "out": out, "mm": {"width": 210, "height": 297}}])
    with open(stamp, "w", encoding="utf-8") as f:
        f.write(key)
    return out


# ---------------------------------------------------------------------------------------------- everything
def render_cases(cases: List[Dict[str, Any]], engravers=ENGRAVERS, variants=degrade.VARIANTS, force: bool = False,
                 root: str = RENDER, log=print) -> Dict[str, Any]:
    """Make every page of the cases; returns {case: {engraver: [page entries]}} (also written as render.json per case)."""
    if not degrade.available():
        raise RenderError("NumPy and OpenCV are needed to degrade pages (pip install -r tests/omr/requirements.txt)")
    versions = tool_versions()
    plan: Dict[str, Dict[str, List[str]]] = {}
    for c in cases:
        plan[c["case"]] = {}
        for e in engravers:
            plan[c["case"]][e] = svg_pages(c, e, root)
    # clean pages in one Chrome
    jobs, todo = [], []
    for c in cases:
        for e in engravers:
            for i, svg in enumerate(plan[c["case"]][e], 1):
                out = os.path.join(root, c["case"], e, f"clean-p{i}.png")
                stamp = out + ".key"
                key = sha256_file(svg) + "|" + json.dumps(_png_job(svg, out, e)["viewport"], sort_keys=True) + "|" + str(versions["puppeteer"])
                if force or not os.path.isfile(out) or not os.path.isfile(stamp) or open(stamp, encoding="utf-8").read() != key:
                    jobs.append(_png_job(svg, out, e))
                    todo.append((stamp, key))
    log(f"render: {len(jobs)} clean pages to rasterise")
    run_raster(jobs)
    versions = tool_versions()
    for stamp, key in todo:
        with open(stamp, "w", encoding="utf-8") as f:
            f.write(key)
    # degraded pages
    report: Dict[str, Any] = {}
    for c in cases:
        report[c["case"]] = {}
        for e in engravers:
            pages = []
            for i, svg in enumerate(plan[c["case"]][e], 1):
                clean = os.path.join(root, c["case"], e, f"clean-p{i}.png")
                entry = {"page": i, "svg": {"sha256": sha256_file(svg)}, "clean": {"file": clean, "sha256": sha256_file(clean), "size": png_size(clean)}}
                for v in ("photo", "scan"):
                    if v not in variants:
                        continue
                    out = os.path.join(root, c["case"], e, f"{v}-p{i}.jpg")
                    stamp = out + ".key"
                    key = json.dumps([entry["clean"]["sha256"], v, degrade.describe(), degrade.seed_for(e, i), degrade.versions()], sort_keys=True)
                    if force or not os.path.isfile(out) or not os.path.isfile(stamp) or open(stamp, encoding="utf-8").read() != key:
                        data, _ = degrade.degrade_file(clean, v, e, i)
                        _write(out, data)
                        with open(stamp, "w", encoding="utf-8") as f:
                            f.write(key)
                    entry[v] = {"file": out, "sha256": sha256_file(out)}
                pages.append(entry)
            report[c["case"]][e] = pages
        with open(os.path.join(root, c["case"], "render.json"), "w", encoding="utf-8", newline="\n") as f:
            json.dump({"case": c["case"], "versions": versions, "engravers": report[c["case"]]}, f, indent=1, sort_keys=True)
    return report
