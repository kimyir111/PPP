"""Suites, case expansion, reference selection and input locks (docs/GOALS/G00 §6.5, §6.7)."""

from __future__ import annotations

import hashlib
import os
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

from . import GENERATOR_VERSION, READER_VERSION, corpus, util, version_compatible

SUITES_DIR = os.path.join(util.bench_root(), "suites")
CASE_FIELDS = ("kind", "stage", "references", "matrix", "subsets", "align", "holdout_seeds", "cases", "fixtures")

CRITICAL_KEYS = ["usable", "critical.meter", "critical.playback_tempo", "critical.beat_placement",
                 "critical.note_values", "critical.pitch_integrity", "critical.key", "critical.hands",
                 "critical.structure", "critical.accidentals", "critical.pedal"]


def _gate(scale: float, flip_max: int, prefixes, min_cases: int) -> Dict[str, Any]:
    """gate/3 (docs/GOALS/G00 §9.3, §17, §19). ``scale`` widens every aggregate tolerance for small suites.

    Aggregate tolerances: in a deterministic suite every change is real; a tolerance is the size of
    trade-off a change may make without a new baseline (about 2-3 cases of core). Zero where any
    change is a defect (bar integrity, missing tempo, stats that disagree with the MusicXML, empty
    edge bars, and since §19: printed shapes that contradict their length, incomplete bars, bar
    numbers)."""
    up = lambda tol: {"dir": "up", "tol": round(tol * scale, 6)}      # noqa: E731
    down = lambda tol: {"dir": "down", "tol": round(tol * scale, 6)}  # noqa: E731
    metrics = {k: up(-0.005) for k in CRITICAL_KEYS}
    metrics.update({
        "sqi": up(-0.30),
        "notes.identity.f1": up(-0.002),
        "notes.onset.f1_50ms": up(-0.005),
        "notation.ioi.accuracy": up(-0.003),
        "notation.onset_pos.accuracy": up(-0.005),
        "notation.onset_pos.accuracy_ref": up(-0.005),
        "notation.duration.accuracy": up(-0.003),
        "notation.duration.page_accuracy": up(-0.003),
        "notation.hand.accuracy": up(-0.003),
        "notation.spelling.accuracy": up(-0.003),
        "notation.ties.extra_per_100": down(0.5),
        "notation.tuplets.f1": up(-0.01),
        "notation.tuplets.false_per_100": down(0.5),
        "notation.accidentals.required_recall": up(-0.002),
        "notation.pedal.f1": up(-0.01),
        "notation.pedal.false_per_min": down(0.05),
        "struct.time_sig.exact": up(-0.005),
        "struct.key.fifths_exact": up(-0.005),
        "struct.tempo.ok_effective": up(-0.005),
        "struct.tempo.ok_written": up(-0.005),
        "struct.tempo.present": {"dir": "up", "tol": 0.0},
        "struct.stats_consistent": {"dir": "up", "tol": 0.0},
        "struct.measures.count_exact": up(-0.005),
        "struct.measures.extra_empty_edge": {"dir": "down", "tol": 0.0},
        "struct.downbeat.f1": up(-0.005),
        "read.bar_integrity": {"dir": "up", "tol": 0.0},
        # §19: the whole-score sequences, the printed note shapes, complete bars, bar numbers, clefs, clutter
        "struct.time_sig.timeline_accuracy": up(-0.005),
        "struct.key.timeline_accuracy": up(-0.005),
        "struct.tempo.timeline_accuracy": up(-0.005),
        "notation.note_shape.consistency": {"dir": "up", "tol": 0.0},
        "read.bar_completeness": {"dir": "up", "tol": 0.0},
        "struct.measure_numbers.valid": {"dir": "up", "tol": 0.0},
        "struct.measure_numbers.app_onset_accuracy": {"dir": "up", "tol": 0.0},
        # §21: the app's play order (repeat signs and endings)
        "struct.form.order_exact": {"dir": "up", "tol": 0.0},
        "read.ledger_lines.heavy_rate": down(0.005),
        "notation.accidentals.courtesy_per_100": down(0.5),
    })
    sub = {k: "rate" for k in CRITICAL_KEYS}
    sub.update({"sqi": "sqi", "struct.time_sig.exact": "rate", "struct.key.fifths_exact": "rate",
                "struct.tempo.ok_effective": "rate", "notes.identity.f1": "mean", "notation.ioi.accuracy": "mean",
                "notation.onset_pos.accuracy": "mean", "notation.duration.accuracy": "mean",
                "notation.hand.accuracy": "mean", "notation.spelling.accuracy": "mean",
                "notation.accidentals.required_recall": "mean", "notation.pedal.f1": "mean",
                "struct.time_sig.timeline_accuracy": "mean", "struct.key.timeline_accuracy": "mean",
                "struct.tempo.timeline_accuracy": "mean", "notation.note_shape.consistency": "mean",
                "notation.duration.page_accuracy": "mean"})
    return {
        "metrics": metrics,
        "subgroups": {"prefixes": list(prefixes), "min_cases": min_cases, "metrics": sub,
                      "sqi_abs": 1.0, "rate_abs": 0.02, "mean_abs": 0.01, "mean_per_case": 0.25},
        "case_fail_drop": 10.0,
        "case_warn_drop": 2.0,
        "case_flip_max": flip_max,
    }


SUBGROUP_PREFIXES = ["set:", "book:", "profile:", "beats:", "metre-class:", "mode:", "feature:", "size:"]
GATE_CORE = _gate(1.0, 2, SUBGROUP_PREFIXES, 15)
GATE_SMOKE = _gate(4.0, 1, ["set:", "profile:", "beats:"], 8)
# full also guards the hold-out aggregate (§17 m10): a change that helps the open references and
# costs the unseen ones is the overfitting the hold-out exists to show
GATE_FULL = _gate(1.0, 2, SUBGROUP_PREFIXES + ["holdout"], 15)
# mutation-check (G00 §9.5) also reads the G3 notation-quality metrics its G3 mutations must regress (G03 §20.5,
# A37); core gets them only when G3 flips on and they enter its baseline (§20.4)
NQ_GATE = {
    "nq.beam.boundary_ok": {"dir": "up", "tol": -0.005},
    "nq.beam.coverage": {"dir": "up", "tol": -0.01},
    "nq.rhythm.hidden_beat_rate": {"dir": "down", "tol": 0.005},
    "nq.shape.tm_missing": {"dir": "down", "tol": 0.05},
    "nq.spell.context_odd": {"dir": "down", "tol": 0.05},
    "nq.tie.mergeable_rate": {"dir": "down", "tol": 0.005},
    "nq.tuplet.group_complete": {"dir": "up", "tol": -0.005},
    "nq.tuplet.one_note_rate": {"dir": "down", "tol": 0.005},
    # the reason split (G03 §29 M6): the residuals G3a must not leave, and R17, which it leaves to G3b but must not add to
    "nq.shape.tm_missing.unexpected": {"dir": "down", "tol": 0.0},
    "nq.shape.tm_missing.r17": {"dir": "down", "tol": 0.0},
    "nq.tuplet.one_note.unexpected": {"dir": "down", "tol": 0.0},
    "nq.tie.mergeable.defect": {"dir": "down", "tol": 0.0},
}
GATE_MUTATION = _gate(1.0, 2, SUBGROUP_PREFIXES, 15)
GATE_MUTATION["metrics"].update(NQ_GATE)


def _fixture_gate(extra: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """A suite of a few fixed, recorded inputs (replay-public, omr-live). Every case is a real input
    through real models, so one case that passed a critical gate and now fails it is a regression
    (flip limit 0); the aggregate tolerances are smoke's."""
    g = _gate(4.0, 0, [], 1)
    g["metrics"].update(extra or {})
    return g


GATE_REPLAY = _fixture_gate()
GATE_OMR = _fixture_gate({"notes.symbolic.f1": {"dir": "up", "tol": -0.008},
                          "omr.measure_alignment_rate": {"dir": "up", "tol": -0.02}})
FIXTURE_SUITES = {"replay-public": GATE_REPLAY, "omr-live": GATE_OMR}   # hand-written suites; select-core sets their gate


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
    """Hash of what decides the cases. Reference and subset lists are sets: their order does not
    change a single case, so it does not change the hash either (§17 m1)."""
    fields = {k: suite.get(k) for k in CASE_FIELDS}
    if isinstance(fields.get("references"), list):
        fields["references"] = sorted(fields["references"])
    if isinstance(fields.get("subsets"), dict):
        fields["subsets"] = {k: sorted(v) for k, v in fields["subsets"].items()}
    return util.sha256_bytes(util.dumps_json(fields).encode("utf-8"))


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
        if not version_compatible(k, v, lock.get(k)):
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
    # a separate ordering, so the pedal cases are not the amt or rubato ones again
    pedal_subset = sorted(sorted(core, key=lambda i: (util.fnv1a32("pedal|" + i), i))[:30])

    smoke = [f"micro/{m}" for m in ("M01-waltz-3-4", "M02-alberti-4-4", "M03-jig-6-8", "M04-triplets-4-4",
                                     "M05-32nds-120", "M07-pickup-3-4", "M09-syncopation-ties",
                                     "M11-harmonic-minor", "M12-flats-db", "M14-melody-in-bass")]
    smoke += ["catalog/gymnopedie-1", "catalog/happy-birthday"]
    h_non44 = _fnv_sorted([i for i in hymns if info[i]["time"] != (4, 4)])[0]
    h_flat = _fnv_sorted([i for i in hymns if info[i]["fifths"] <= -3 and i != h_non44])[0]
    c24 = _fnv_sorted(ids(lambda e: e.book == "czerny599" and info[e.id]["time"] == (2, 4)))[0]
    son = _fnv_sorted(ids(lambda e: e.book == "sonatina"))[0]
    smoke += [h_non44, h_flat, c24, son]
    smoke = sorted(smoke)
    smoke_varied = sorted(smoke, key=lambda i: (util.fnv1a32("smoke|" + i), i))
    full = sorted(e.id for e in refs if e.set != "omr")  # omr references are scored by omr-live only
    return {"smoke": smoke, "core": core, "amt": amt_subset, "rubato": rubato_subset, "pedal": pedal_subset,
            "smoke-amt": sorted(smoke_varied[:4]), "smoke-rubato": sorted(smoke_varied[4:8]),
            "smoke-pedal": sorted(smoke_varied[8:12]), "full": full}


def suite_templates(sel: Dict[str, Any]) -> Dict[str, Dict[str, Any]]:
    base = {"schema": "ppp.bench-suite/1", "kind": "synthetic-notation", "stage": {"name": "notate", "opts": {}},
            "align": {"window_s": 0.30}}
    return {
        "smoke": dict(base, name="smoke", description="Quick pre-commit check: 16 references × deadpan/onset and human/oracle, "
                                                      "plus 4 each with AMT errors, rubato and the pedal",
                      references=sel["smoke"],
                      matrix=[{"profile": "deadpan", "beats": "none", "seeds": [1]},
                              {"profile": "human", "beats": "oracle", "seeds": [1]},
                              {"profile": "amt", "beats": "oracle-noisy", "seeds": [1], "subset": "smoke-amt"},
                              {"profile": "rubato", "beats": "oracle", "seeds": [1], "subset": "smoke-rubato"},
                              {"profile": "pedal", "beats": "oracle", "seeds": [1], "subset": "smoke-pedal"}],
                      subsets={"smoke-amt": sel["smoke-amt"], "smoke-rubato": sel["smoke-rubato"],
                               "smoke-pedal": sel["smoke-pedal"]}, gate=GATE_SMOKE),
        "core": dict(base, name="core", description=f"CI gate: {len(sel['core'])} stratified references × 3 main profiles "
                                                    "+ AMT/rubato/pedal subsets",
                     references=sel["core"],
                     matrix=[{"profile": "deadpan", "beats": "none", "seeds": [1]},
                             {"profile": "human", "beats": "none", "seeds": [1]},
                             {"profile": "human", "beats": "oracle", "seeds": [1]},
                             {"profile": "amt", "beats": "oracle-noisy", "seeds": [1], "subset": "amt-subset"},
                             {"profile": "rubato", "beats": "oracle", "seeds": [1], "subset": "rubato-subset"},
                             {"profile": "pedal", "beats": "oracle", "seeds": [1], "subset": "pedal-subset"}],
                     subsets={"amt-subset": sel["amt"], "rubato-subset": sel["rubato"], "pedal-subset": sel["pedal"]},
                     gate=GATE_CORE),
        "full": dict(base, name="full", description="Nightly/manual: every lint-clean reference, hold-out included (seeds 11, 12)",
                     references=sel["full"], holdout_seeds=[11, 12],
                     matrix=[{"profile": p, "beats": b, "seeds": [1, 2]} for p, b in
                             (("deadpan", "none"), ("human", "none"), ("human", "oracle"), ("rubato", "oracle"),
                              ("amt", "oracle-noisy"), ("amt", "none"), ("human", "lowconf"), ("pedal", "oracle"))],
                     subsets={}, gate=GATE_FULL),
        "robust": dict(base, name="robust",
                       description="A second generator family (human-alt: no accents, no voicing, no rolls, triangular "
                                   "timing) on the core references: catches tuning to the main generator's habits (§17 M11)",
                       references=sel["core"],
                       matrix=[{"profile": "human-alt", "beats": "none", "seeds": [1]},
                               {"profile": "human-alt", "beats": "oracle", "seeds": [1]}],
                       subsets={}, gate=GATE_CORE),
        "mutation": dict(base, name="mutation", description="Gate sensitivity check (§9.5): core references × deadpan/onset "
                                                            "+ the pedal subset",
                         references=sel["core"], matrix=[{"profile": "deadpan", "beats": "none", "seeds": [1]},
                                                         {"profile": "pedal", "beats": "oracle", "seeds": [1],
                                                          "subset": "pedal-subset"}],
                         subsets={"pedal-subset": sel["pedal"]}, gate=GATE_CORE),
    }


def select_and_write() -> None:
    refs = corpus.load_corpus()
    sel = select_references(refs)
    for name, s in suite_templates(sel).items():
        util.dump_json(s, os.path.join(SUITES_DIR, name + ".json"))
        print(f"wrote suites/{name}.json: {len(s['references'])} references")
    for name, gate in FIXTURE_SUITES.items():
        path = os.path.join(SUITES_DIR, name + ".json")
        s = util.load_json(path)
        s["gate"] = gate
        util.dump_json(s, path)
        print(f"wrote suites/{name}.json: gate only (its cases are fixtures)")
