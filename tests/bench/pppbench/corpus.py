"""Reference corpus: registry, lint and derived tags (docs/GOALS/G00 §6)."""

from __future__ import annotations

import os
from collections import Counter
from dataclasses import dataclass, field
from fractions import Fraction
from typing import Any, Dict, List, Optional, Tuple

from . import musicxml, util

CORPUS_DIR = os.path.join(util.bench_root(), "corpus")
REFERENCES = os.path.join(CORPUS_DIR, "references.json")
EXCLUDED = os.path.join(CORPUS_DIR, "excluded.json")
SETS = ("micro", "catalog", "samples", "hymns", "method", "omr")
SET_LABELS = {"micro": "micro (G0 benchmark pieces)", "catalog": "catalog (CC0)", "samples": "samples",
              "hymns": "hymns (찬송가, Open Hymnal)", "method": "method books (교재)", "omr": "omr fixtures"}

# Scores without a tempo mark are played at a tempo the benchmark chooses. It
# is a choice for the synthetic performance, not a claim about the score.
DEFAULT_TEMPO = {"hanon": 108, "czerny299": 120, "sonatina": 100}
COMPOUND_DEFAULT_QPM = 120  # dotted quarter = 80


@dataclass
class RefEntry:
    id: str
    path: str
    sha256: str
    set: str
    license: str
    book: Optional[str] = None
    expect: Dict[str, Any] = field(default_factory=dict)
    holdout: bool = False
    note: str = ""

    @property
    def abspath(self) -> str:
        return os.path.join(util.repo_root(), self.path)

    def to_json(self) -> Dict[str, Any]:
        d = {"id": self.id, "path": self.path, "sha256": self.sha256, "set": self.set, "license": self.license,
             "expect": self.expect, "holdout": self.holdout, "note": self.note}
        if self.book:
            d["book"] = self.book
        return d


@dataclass
class LintIssue:
    rule: str
    level: str  # error | warning | exclude
    ref: str
    message: str

    def __str__(self) -> str:
        return f"{self.level.upper():8} {self.rule:3} {self.ref}: {self.message}"


def load_corpus(path: str = REFERENCES) -> List[RefEntry]:
    data = util.load_json(path)
    out = []
    for r in data["references"]:
        out.append(RefEntry(id=r["id"], path=r["path"], sha256=r["sha256"], set=r["set"], license=r.get("license", ""),
                            book=r.get("book"), expect=r.get("expect") or {}, holdout=bool(r.get("holdout")),
                            note=r.get("note", "")))
    return out


def by_id(entries: List[RefEntry]) -> Dict[str, RefEntry]:
    return {e.id: e for e in entries}


_canon_cache: Dict[Tuple[str, str], Any] = {}


def read_reference(entry: RefEntry):
    key = (entry.path, entry.sha256)
    if key not in _canon_cache:
        _canon_cache[key] = musicxml.read_score(entry.abspath, source_path=entry.path)
    return _canon_cache[key]


# ----------------------------------------------------------------- expectations
def expected_qpm(entry: RefEntry, canon) -> Optional[float]:
    return entry.expect.get("tempo_qpm") or canon.effective_qpm


def expected_time(entry: RefEntry, canon) -> Tuple[int, int]:
    t = entry.expect.get("time")
    return (int(t[0]), int(t[1])) if t else canon.primary_time()


def expected_key(entry: RefEntry, canon) -> Dict[str, Any]:
    k = entry.expect.get("key")
    if k:
        return {"fifths": int(k["fifths"]), "mode": k.get("mode"), "mode_explicit": k.get("mode") is not None}
    m = canon.measures[0]
    return {"fifths": m.fifths, "mode": m.mode if m.mode_explicit else None, "mode_explicit": m.mode_explicit}


# ----------------------------------------------------------------- tags
def metre_class(time: Tuple[int, int]) -> str:
    b, t = time
    if t >= 8 and b % 3 == 0:
        return {1: "compound-single", 2: "compound-duple", 3: "compound-triple", 4: "compound-quadruple"}.get(b // 3, "irregular")
    return {2: "simple-duple", 3: "simple-triple", 4: "simple-quadruple"}.get(b, "irregular")


def derived_tags(entry: RefEntry, canon) -> List[str]:
    time = expected_time(entry, canon)
    key = expected_key(entry, canon)
    played = canon.played()
    tags = [f"set:{entry.set}", f"metre:{time[0]}/{time[1]}", f"metre-class:{metre_class(time)}",
            f"key:{key['fifths']}", f"mode:{key['mode'] or 'unknown'}", f"staves:{canon.staves}"]
    if entry.book:
        tags.append(f"book:{entry.book}")
    n = len(played)
    tags.append("size:" + ("s" if n < 100 else "m" if n < 400 else "l"))
    onsets = sorted({s.onset_q for s in played})
    groups = Counter(s.onset_q for s in played)
    if canon.measures and canon.measures[0].implicit:
        tags.append("feature:pickup")
    if any(s.tuplet for s in played):
        tags.append("feature:tuplets")
    if any(s.pieces > 1 for s in played):
        tags.append("feature:ties")
    if len({round(m.qpm, 3) for m in canon.marks}) > 1:
        tags.append("feature:tempo-change")
    if groups and sum(groups.values()) / len(groups) >= 3:
        tags.append("feature:dense-chords")
    qpm = expected_qpm(entry, canon) or 100
    if len(onsets) >= 2:
        min_ioi = min(b - a for a, b in zip(onsets, onsets[1:]))
        if float(min_ioi) * 60 / qpm <= 0.125 + 1e-9:
            tags.append("feature:fast-runs")
    if len(onsets) < 2 * len(canon.measures):
        tags.append("feature:low-information")
    return sorted(tags)


# ----------------------------------------------------------------- lint
def exclusion_reasons(canon) -> List[Tuple[str, str]]:
    out = []
    if canon.diagnostics.get("octave_shift"):
        out.append(("L5", "octave-shift semantics unresolved (§14 I3)"))
    if canon.diagnostics.get("duplicate_measure_numbers"):
        out.append(("L6", "duplicate measure numbers"))
    bi = canon.diagnostics["bar_integrity"]
    if bi["bad"]:
        kinds = Counter(b["kind"] for b in bi["bad"])
        out.append(("L8", "reference bar integrity below 100%: " +
                    ", ".join(f"{v} {k}" for k, v in sorted(kinds.items()))))
    return out


def lint(entries: List[RefEntry], tracked: Optional[set] = None) -> List[LintIssue]:
    tracked = util.tracked_files() if tracked is None else tracked
    issues: List[LintIssue] = []
    seen = set()
    for e in entries:
        if e.id in seen:
            issues.append(LintIssue("L11", "error", e.id, "duplicate id"))
        seen.add(e.id)
        if e.set not in SETS:
            issues.append(LintIssue("L11", "error", e.id, f"unknown set {e.set!r}"))
        if not e.license.strip():
            issues.append(LintIssue("L10", "error", e.id, "license is empty"))
        if not os.path.exists(e.abspath):
            issues.append(LintIssue("L1", "error", e.id, f"{e.path} does not exist"))
            continue
        if e.path not in tracked:
            issues.append(LintIssue("L1", "error", e.id, f"{e.path} is not committed to git"))
        if util.sha256_file(e.abspath) != e.sha256:
            issues.append(LintIssue("L2", "error", e.id, "sha256 changed: the reference was edited; re-register and rebaseline"))
        try:
            canon = read_reference(e)
        except musicxml.ReaderError as exc:
            issues.append(LintIssue("L3", "error", e.id, f"reader failed: {exc}"))
            continue
        if len(canon.played()) < 8:
            issues.append(LintIssue("L3", "error", e.id, f"only {len(canon.played())} played notes"))
        if not (canon.effective_qpm or e.expect.get("tempo_qpm")):
            issues.append(LintIssue("L4", "error", e.id, "no tempo in the file and no expect.tempo_qpm"))
        for rule, reason in exclusion_reasons(canon):
            issues.append(LintIssue(rule, "error", e.id, reason + " — must be in excluded.json, not references.json"))
        if canon.diagnostics["parts"] > 1 and canon.staves < 2:
            issues.append(LintIssue("L7", "warning", e.id, "several parts and no two-staff piano part"))
        if not canon.measures[0].mode_explicit and not (e.expect.get("key") or {}).get("mode"):
            issues.append(LintIssue("L9", "warning", e.id, "no <mode> and no expect.key.mode (struct.key.mirex will be null)"))
    return issues


# ----------------------------------------------------------------- registration
def holdout_for(set_name: str, ref_id: str) -> bool:
    return set_name in ("hymns", "method") and util.fnv1a32(ref_id) % 5 == 0


def candidate_files(tracked: set) -> List[Dict[str, Any]]:
    """Every licence-clean committed score, with the id/set/book/licence it would get."""
    root = util.repo_root()
    method_index = util.load_json(os.path.join(root, "catalog", "method", "index.json"))
    books = {b["id"]: b for b in method_index["books"]}
    out = []
    for f in sorted(tracked):
        if f.startswith("tests/bench/corpus/micro/") and f.endswith(".musicxml"):
            name = os.path.basename(f)[:-9]
            out.append({"id": f"micro/{name}", "path": f, "set": "micro",
                        "license": "CC0 1.0 — written for PPP's benchmark (tests/bench/tools/make_micro.py)"})
        elif f.startswith("catalog/hymns/") and f.endswith(".musicxml"):
            name = os.path.basename(f)[:-9]
            out.append({"id": f"hymns/{name}", "path": f, "set": "hymns",
                        "license": "Public domain — Open Hymnal Project tune, reduced to two-staff piano for PPP (catalog/hymns/README.md)"})
        elif f.startswith("catalog/method/") and f.endswith(".mxl"):
            book, no = f.split("/")[2], os.path.basename(f)[:-4]
            b = books.get(book, {})
            kind = "CC0 transcription for PPP" if book in ("beyer", "czerny599") else "PD/CC0 community typeset (PDMX)"
            out.append({"id": f"method/{book}/{no}", "path": f, "set": "method", "book": book,
                        "license": f"{kind} — {b.get('edition', '')} (catalog/method/index.json)"})
        elif f.startswith("catalog/") and f.count("/") == 1 and f.endswith(".musicxml"):
            name = os.path.basename(f)[:-9]
            out.append({"id": f"catalog/{name}", "path": f, "set": "catalog", "license": "CC0 (catalog/index.json)"})
        elif f == "samples/prelude-fragment.musicxml":
            out.append({"id": "samples/prelude-fragment", "path": f, "set": "samples",
                        "license": "PPP's own sample score (samples/)"})
    return out


def init_registry(micro_expect: Dict[str, Dict[str, Any]], manual_expect: Dict[str, Dict[str, Any]],
                  notes: Dict[str, str]) -> Tuple[List[RefEntry], List[Dict[str, str]]]:
    """Build references.json/excluded.json from the committed files (run once; later edits are by hand)."""
    tracked = util.tracked_files()
    refs, excluded = [], []
    for c in candidate_files(tracked):
        path = os.path.join(util.repo_root(), c["path"])
        canon = musicxml.read_score(path, source_path=c["path"])
        reasons = exclusion_reasons(canon)
        if reasons:
            excluded.append({"id": c["id"], "path": c["path"], "rule": reasons[0][0],
                             "reason": "; ".join(r for _, r in reasons)})
            continue
        expect: Dict[str, Any] = {}
        if c["set"] == "micro":
            expect = dict(micro_expect[c["id"].split("/", 1)[1]])
            expect.pop("measures", None)
        if not canon.effective_qpm and "tempo_qpm" not in expect:
            t = canon.primary_time()
            expect["tempo_qpm"] = (COMPOUND_DEFAULT_QPM if t[1] >= 8 and t[0] % 3 == 0
                                   else DEFAULT_TEMPO.get(c.get("book"), 100))
        expect.update(manual_expect.get(c["id"], {}))
        note = notes.get(c["id"], "")
        if not canon.effective_qpm and not note:
            note = f"No tempo in the file; the benchmark performs it at {expect['tempo_qpm']} qpm (a benchmark choice)."
        refs.append(RefEntry(id=c["id"], path=c["path"], sha256=util.sha256_file(path), set=c["set"],
                             license=c["license"], book=c.get("book"), expect=expect,
                             holdout=holdout_for(c["set"], c["id"]), note=note))
    return refs, excluded


def write_registry(refs: List[RefEntry], excluded: List[Dict[str, str]]) -> None:
    util.dump_json({"schema": "ppp.bench-corpus/1", "references": [r.to_json() for r in refs]}, REFERENCES)
    util.dump_json({"schema": "ppp.bench-excluded/1", "excluded": excluded}, EXCLUDED)
