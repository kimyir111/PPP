"""Suites, case expansion, reference selection and input locks (docs/GOALS/G00 §6.5, §6.7)."""

from __future__ import annotations

import hashlib
import os
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

from . import GENERATOR_VERSION, READER_VERSION, corpus, util

SUITES_DIR = os.path.join(util.bench_root(), "suites")
CASE_FIELDS = ("kind", "stage", "references", "matrix", "subsets", "align", "holdout_seeds", "cases", "fixtures")

GATE_CORE = {
    "metrics": {
        "sqi": {"dir": "up", "tol": -0.30},
        "notes.identity.f1": {"dir": "up", "tol": -0.002},
        "notes.onset.f1_50ms": {"dir": "up", "tol": -0.005},
        "notation.ioi.accuracy": {"dir": "up", "tol": -0.003},
        "notation.onset_pos.accuracy": {"dir": "up", "tol": -0.005},
        "notation.duration.accuracy": {"dir": "up", "tol": -0.003},
        "notation.hand.accuracy": {"dir": "up", "tol": -0.003},
        "notation.spelling.accuracy": {"dir": "up", "tol": -0.003},
        "notation.ties.extra_per_100": {"dir": "down", "tol": 0.5},
        "struct.time_sig.exact": {"dir": "up", "tol": -0.005},
        "struct.key.fifths_exact": {"dir": "up", "tol": -0.005},
        "struct.tempo.ok_effective": {"dir": "up", "tol": -0.005},
        "struct.downbeat.f1": {"dir": "up", "tol": -0.005},
        "read.bar_integrity": {"dir": "up", "tol": 0.0},
    },
    "tag_guards": {"metric": "sqi", "min_delta": -1.0,
                   "tags": ["set:micro", "set:hymns", "set:method", "set:catalog", "profile:deadpan", "profile:human",
                            "profile:amt", "beats:none", "beats:oracle"]},
    "case_fail_drop": 10.0,
    "case_warn_drop": 2.0,
}
GATE_SMOKE = {
    "metrics": {
        "sqi": {"dir": "up", "tol": -1.0},
        "notes.identity.f1": {"dir": "up", "tol": -0.01},
        "notes.onset.f1_50ms": {"dir": "up", "tol": -0.02},
        "notation.ioi.accuracy": {"dir": "up", "tol": -0.01},
        "notation.onset_pos.accuracy": {"dir": "up", "tol": -0.02},
        "notation.duration.accuracy": {"dir": "up", "tol": -0.01},
        "notation.hand.accuracy": {"dir": "up", "tol": -0.01},
        "notation.spelling.accuracy": {"dir": "up", "tol": -0.01},
        "notation.ties.extra_per_100": {"dir": "down", "tol": 2.0},
        "struct.time_sig.exact": {"dir": "up", "tol": -0.04},
        "struct.key.fifths_exact": {"dir": "up", "tol": -0.04},
        "struct.tempo.ok_effective": {"dir": "up", "tol": -0.04},
        "struct.downbeat.f1": {"dir": "up", "tol": -0.02},
        "read.bar_integrity": {"dir": "up", "tol": 0.0},
    },
    "tag_guards": {"metric": "sqi", "min_delta": -2.0,
                   "tags": ["set:micro", "set:hymns", "set:method", "set:catalog", "profile:deadpan", "profile:human",
                            "beats:none", "beats:oracle"]},
    "case_fail_drop": 10.0,
    "case_warn_drop": 2.0,
}


@dataclass
class Case:
    id: str
    ref_id: str
    profile: str
    beats: str
    seed: int
    opt_name: Optional[str] = None
    opts: Optional[Dict[str, Any]] = None
    holdout: bool = False
    tags: List[str] = field(default_factory=list)

    @property
    def key(self) -> str:
        return case_key(self.id)


def case_key(case_id: str) -> str:
    return hashlib.sha256(case_id.encode("utf-8")).hexdigest()[:12]


def case_id(ref_id: str, profile: str, beats: str, seed: int, opt_name: Optional[str] = None) -> str:
    return f"{ref_id}|{profile}|{beats}|s{seed}" + (f"|opt:{opt_name}" if opt_name else "")


def list_suites() -> List[str]:
    return sorted(f[:-5] for f in os.listdir(SUITES_DIR)
                  if f.endswith(".json") and not f.endswith(".lock.json"))


def suite_path(name_or_path: str) -> str:
    if name_or_path.endswith(".json") and os.path.exists(name_or_path):
        return os.path.abspath(name_or_path)
    return os.path.join(SUITES_DIR, name_or_path + ".json")


def load_suite(name_or_path: str) -> Dict[str, Any]:
    path = suite_path(name_or_path)
    s = util.load_json(path)
    s["_path"] = path
    return s


def is_private(suite: Dict[str, Any]) -> bool:
    return not os.path.abspath(suite["_path"]).startswith(os.path.abspath(util.repo_root()) + os.sep)


def suite_sha256(suite: Dict[str, Any]) -> str:
    return util.sha256_bytes(util.dumps_json({k: suite.get(k) for k in CASE_FIELDS}).encode("utf-8"))


def lock_path(suite: Dict[str, Any]) -> str:
    return suite["_path"][:-5] + ".lock.json"


def describe(suite: Dict[str, Any], refs=None) -> str:
    if suite.get("schema") == "ppp.bench-golden/1":
        return f"golden · {len(suite['cases'])} snapshots"
    if suite.get("kind") != "synthetic-notation":
        return f"{suite.get('kind')} · {suite.get('description', '')}"
    refs = refs if refs is not None else corpus.load_corpus()
    n = len(expand(suite, refs))
    return f"{len(suite['references'])} references · {n} cases"


def expand(suite: Dict[str, Any], refs: List[corpus.RefEntry]) -> List[Case]:
    by = corpus.by_id(refs)
    subsets = suite.get("subsets") or {}
    holdout_seeds = suite.get("holdout_seeds")
    cases: Dict[str, Case] = {}
    for rid in suite["references"]:
        if rid not in by:
            raise KeyError(f"suite {suite.get('name')}: unknown reference {rid}")
        entry = by[rid]
        for row in suite["matrix"]:
            sub = row.get("subset")
            if sub and rid not in subsets.get(sub, []):
                continue
            seeds = holdout_seeds if entry.holdout and holdout_seeds else row["seeds"]
            for seed in seeds:
                cid = case_id(rid, row["profile"], row["beats"], seed, row.get("opt_name"))
                cases[cid] = Case(cid, rid, row["profile"], row["beats"], seed, row.get("opt_name"),
                                  row.get("opts"), entry.holdout)
    return [cases[k] for k in sorted(cases)]


# ----------------------------------------------------------------- locks
def input_sha256(inp: Dict[str, Any], opts: Dict[str, Any]) -> str:
    return util.sha256_bytes(util.dumps_json({"input": inp, "opts": opts}).encode("utf-8"))


def make_lock(suite: Dict[str, Any], rows: List[Dict[str, str]]) -> Dict[str, Any]:
    return {"schema": "ppp.bench-lock/1", "suite_sha256": suite_sha256(suite), "generator": GENERATOR_VERSION,
            "reader": READER_VERSION, "cases": sorted(rows, key=lambda r: r["id"])}


def verify_lock(suite: Dict[str, Any], rows: List[Dict[str, str]], lock: Optional[Dict[str, Any]],
                partial: bool = False) -> List[str]:
    """Differences between freshly generated inputs and the committed lock."""
    if lock is None:
        return ["no lock file: run `python tests/bench/run.py relock --suite <name> --reason ...`"]
    drifts = []
    if lock.get("suite_sha256") != suite_sha256(suite):
        drifts.append("suite definition changed since the lock was written")
    for k, v in (("generator", GENERATOR_VERSION), ("reader", READER_VERSION)):
        if lock.get(k) != v:
            drifts.append(f"{k} version {lock.get(k)} in the lock, {v} now")
    locked = {c["id"]: c for c in lock.get("cases", [])}
    now = {r["id"]: r for r in rows}
    if not partial:
        for cid in sorted(set(locked) - set(now)):
            drifts.append(f"{cid}: in the lock, not generated")
    for cid in sorted(now):
        if cid not in locked:
            drifts.append(f"{cid}: generated, not in the lock")
            continue
        for k in ("reference_sha256", "input_sha256"):
            if locked[cid].get(k) != now[cid][k]:
                drifts.append(f"{cid}: {k} {locked[cid].get(k, '')[:12]} -> {now[cid][k][:12]}")
    return drifts


def cli_relock(args) -> int:
    from . import runner
    suite = load_suite(args.suite)
    rows = runner.generate(suite)[1]
    lock = make_lock(suite, rows)
    util.dump_json(lock, lock_path(suite))
    print(f"relocked {suite['name']}: {len(rows)} cases — reason: {args.reason}")
    print("Rebaseline next: run, then update-baseline with the same reason.")
    return 0


# ----------------------------------------------------------------- selection
def _fnv_sorted(ids):
    return sorted(ids, key=lambda i: (util.fnv1a32(i), i))


def select_references(refs: List[corpus.RefEntry]) -> Dict[str, Any]:
    """The one-time selection of smoke/core references (§6.5). Its output is written into the suite files."""
    info = {}
    for e in refs:
        c = corpus.read_reference(e)
        t = corpus.expected_time(e, c)
        info[e.id] = {"entry": e, "time": t, "class": corpus.metre_class(t), "fifths": corpus.expected_key(e, c)["fifths"]}
    open_refs = [e for e in refs if not e.holdout]
    ids = lambda pred: [e.id for e in open_refs if pred(e)]  # noqa: E731

    core = ids(lambda e: e.set in ("micro", "catalog")) + ids(lambda e: e.id == "samples/prelude-fragment")
    hymns = ids(lambda e: e.set == "hymns")
    quad = _fnv_sorted([i for i in hymns if info[i]["class"] == "simple-quadruple"])[:20]
    trip = _fnv_sorted([i for i in hymns if info[i]["class"] == "simple-triple"])[:10]
    other = _fnv_sorted([i for i in hymns if info[i]["class"] not in ("simple-quadruple", "simple-triple")])[:10]
    core += quad + trip + other
    quotas = {"beyer": 16, "czerny599": 16, "czerny849": 10, "hanon": 8, "burgmuller25": 10, "sonatina": 14, "czerny299": 6}
    for book, quota in quotas.items():
        pool = ids(lambda e, b=book: e.set == "method" and e.book == b)
        classes: Dict[str, List[str]] = {}
        for i in pool:
            classes.setdefault(info[i]["class"], []).append(i)
        queues = [_fnv_sorted(classes[k]) for k in sorted(classes)]
        picked: List[str] = []
        while len(picked) < quota and any(queues):
            for q in queues:
                if q and len(picked) < quota:
                    picked.append(q.pop(0))
        core += picked
    core = sorted(core)
    non_micro = _fnv_sorted([i for i in core if not i.startswith("micro/")])
    amt_subset, rubato_subset = sorted(non_micro[:60]), sorted(non_micro[60:100])

    smoke = [f"micro/{m}" for m in ("M01-waltz-3-4", "M02-alberti-4-4", "M03-jig-6-8", "M04-triplets-4-4",
                                     "M05-32nds-120", "M07-pickup-3-4", "M09-syncopation-ties",
                                     "M11-harmonic-minor", "M12-flats-db", "M14-melody-in-bass")]
    smoke += ["catalog/gymnopedie-1", "catalog/happy-birthday"]
    h_non44 = _fnv_sorted([i for i in hymns if info[i]["time"] != (4, 4)])[0]
    h_flat = _fnv_sorted([i for i in hymns if info[i]["fifths"] <= -3 and i != h_non44])[0]
    c24 = _fnv_sorted(ids(lambda e: e.book == "czerny599" and info[e.id]["time"] == (2, 4)))[0]
    son = _fnv_sorted(ids(lambda e: e.book == "sonatina"))[0]
    smoke += [h_non44, h_flat, c24, son]
    full = sorted(e.id for e in refs)
    return {"smoke": sorted(smoke), "core": core, "amt": amt_subset, "rubato": rubato_subset, "full": full}


def suite_templates(sel: Dict[str, Any]) -> Dict[str, Dict[str, Any]]:
    base = {"schema": "ppp.bench-suite/1", "kind": "synthetic-notation", "stage": {"name": "notate", "opts": {}},
            "align": {"window_s": 0.30}}
    return {
        "smoke": dict(base, name="smoke", description="Quick pre-commit check: 16 references × deadpan/onset and human/oracle beats",
                      references=sel["smoke"],
                      matrix=[{"profile": "deadpan", "beats": "none", "seeds": [1]},
                              {"profile": "human", "beats": "oracle", "seeds": [1]}],
                      subsets={}, gate=GATE_SMOKE),
        "core": dict(base, name="core", description=f"CI gate: {len(sel['core'])} stratified references × 3 main profiles + AMT/rubato subsets",
                     references=sel["core"],
                     matrix=[{"profile": "deadpan", "beats": "none", "seeds": [1]},
                             {"profile": "human", "beats": "none", "seeds": [1]},
                             {"profile": "human", "beats": "oracle", "seeds": [1]},
                             {"profile": "amt", "beats": "oracle-noisy", "seeds": [1], "subset": "amt-subset"},
                             {"profile": "rubato", "beats": "oracle", "seeds": [1], "subset": "rubato-subset"}],
                     subsets={"amt-subset": sel["amt"], "rubato-subset": sel["rubato"]}, gate=GATE_CORE),
        "full": dict(base, name="full", description="Nightly/manual: every lint-clean reference, hold-out included (seeds 11, 12)",
                     references=sel["full"], holdout_seeds=[11, 12],
                     matrix=[{"profile": p, "beats": b, "seeds": [1, 2]} for p, b in
                             (("deadpan", "none"), ("human", "none"), ("human", "oracle"), ("rubato", "oracle"),
                              ("amt", "oracle-noisy"), ("amt", "none"), ("human", "lowconf"))],
                     subsets={}, gate=GATE_CORE),
        "mutation": dict(base, name="mutation", description="Gate sensitivity check (§9.5): core references × deadpan/onset",
                         references=sel["core"], matrix=[{"profile": "deadpan", "beats": "none", "seeds": [1]}],
                         subsets={}, gate=GATE_CORE),
    }


def select_and_write() -> None:
    refs = corpus.load_corpus()
    sel = select_references(refs)
    for name, s in suite_templates(sel).items():
        util.dump_json(s, os.path.join(SUITES_DIR, name + ".json"))
        print(f"wrote suites/{name}.json: {len(s['references'])} references")
