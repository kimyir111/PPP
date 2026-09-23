"""The G3 human review set (docs/GOALS/G03 §21, A36).

    run.py human-set --build          write tests/bench/human/g3/HG01-HG20/{A,B,C}.musicxml + meta.json
    run.py human-set --pairs          write pairs.json and review-template.json (blind order, fixed seed)
    run.py human-set --score FILE     judge a filled-in review against §21.5 (exit 1 when a criterion fails)

Twenty 8-bar excerpts of core references, stratified (simple duple 4, simple triple 4, compound 4, with triplets 3,
two-voice texture 3, chromatic or modulating 2) and spread over the sources (the method books, hymns, the catalogue).
Only trusted references PPP neither transcribed nor generated are used (§21.2): human engraving is what is judged
against. Each excerpt comes in three versions of the same bars: A the recording path's score with G3 off, B with G3a
on, C the reference itself; A and B are made from the core case `<ref>|human|oracle|s1` (a synthetic performance of
the reference, oracle beats), so their bars are the reference's (bar offset 0, recorded as an assumption in meta.json).
Everything is built from files in the repository, deterministically; the window is the one where the stratum's feature
is densest in the reference, then where A and B differ most.

The rendering (MuseScore 4 on the reviewer's machine, never the app's renderer, which re-beams and re-brackets and so
hides G3's decisions) and the judging are the user's (D7). A review names the reviewer's role, never their name.
"""

from __future__ import annotations

import json
import os
import random
import xml.etree.ElementTree as ET
from typing import Any, Dict, List, Optional, Tuple

from . import corpus, musicxml, perform, stages, suite as suite_mod, util
from .metrics import notation_quality as NQ

HUMAN = os.path.join(util.bench_root(), "human", "g3")
BARS = 8
SEED = 20260924
STRATA = [("simple-duple", 4), ("simple-triple", 4), ("compound", 4), ("tuplets", 3), ("two-voice", 3), ("chromatic", 2)]
AXES = ("rhythm", "voices", "spelling", "overall")


# ------------------------------------------------------------------ the references
def _eligible() -> List[Tuple[Any, Any, Any]]:
    """[(case, reference entry, canonical reference)] of core's `|human|oracle|s1` cases a human engraved."""
    prov = {e["id"]: e for e in util.load_json(os.path.join(util.bench_root(), "corpus", "provenance.json"))["entries"]}
    refs = corpus.load_corpus()
    by = corpus.by_id(refs)
    out = []
    for c in suite_mod.expand(suite_mod.load_suite("core"), refs):
        if not c.id.endswith("|human|oracle|s1") or c.holdout:
            continue
        p = prov.get(c.ref_id) or {}
        ref = by[c.ref_id]
        if not p.get("trusted") or p.get("transcribed_by_ppp") or p.get("generated_internally") or ref.set == "micro":
            continue
        out.append((c, ref, corpus.read_reference(ref)))
    return sorted(out, key=lambda x: x[0].id)


def _source(ref) -> str:
    return ref.book or ref.set or "other"


def _features(canon) -> Dict[str, Any]:
    """What a reference is, per bar: metre class, tuplet notes, two-voice staves, accidentals and key changes."""
    n = len(canon.measures)
    tup, poly, acc = [0] * n, [0] * n, [0] * n
    voices: Dict[Tuple[int, int], set] = {}
    for x in canon.notes:
        if x.tuplet:
            tup[x.measure] += 1
        if x.accidental:
            acc[x.measure] += 1
        voices.setdefault((x.measure, x.staff), set()).add(x.voice)
    for (m, _), vs in voices.items():
        if len(vs) > 1:
            poly[m] += 1
    keys = [0] + [1 if canon.measures[i].fifths != canon.measures[i - 1].fifths else 0 for i in range(1, n)]
    beats, bt = canon.measures[0].time if n else (4, 4)
    compound = bt >= 8 and beats % 3 == 0
    metre = "compound" if compound else "simple-triple" if beats in (3,) else "simple-duple" if beats in (2, 4) else "other"
    notes = max(1, len(canon.notes))
    return {"metre": metre, "tup": tup, "poly": poly, "acc": acc, "keys": keys,
            "chromatic": (sum(acc) / notes) + 0.1 * sum(keys), "n": n}


def _in_stratum(name: str, f: Dict[str, Any]) -> bool:
    if name in ("simple-duple", "simple-triple", "compound"):
        return f["metre"] == name
    if name == "tuplets":
        return sum(f["tup"]) > 0
    if name == "two-voice":
        return sum(f["poly"]) > 0
    return f["chromatic"] >= 0.05


def _feature_in(name: str, f: Dict[str, Any], a: int, b: int) -> float:
    key = {"tuplets": "tup", "two-voice": "poly"}.get(name)
    if key:
        return float(sum(f[key][a:b]))
    if name == "chromatic":
        return float(sum(f["acc"][a:b]) + 5 * sum(f["keys"][a:b]))
    return 0.0


# ------------------------------------------------------------------ MusicXML excerpts
CARRIED = ("divisions", "key", "time", "staves", "clef", "transpose")


def excerpt(xml: str, first: int, count: int) -> str:
    """Measures first..first+count-1 (0-based, in file order) of every part, the first of them opening with the
    attributes in force there (divisions, key, time, staves, clefs, transposition). Numbers are kept."""
    root = ET.fromstring(xml)
    for part in root.findall("part"):
        measures = part.findall("measure")
        state: Dict[Tuple[str, str], ET.Element] = {}
        for m in measures[:first]:
            for attrs in m.findall("attributes"):
                for child in attrs:
                    if child.tag in CARRIED:
                        state[(child.tag, child.get("number", ""))] = child
        keep = measures[first:first + count]
        for m in measures:
            if m not in keep:
                part.remove(m)
        if keep and state:
            head = keep[0]
            own = head.find("attributes")
            have = {(c.tag, c.get("number", "")) for c in own} if own is not None else set()
            carried = ET.Element("attributes")
            for tag in CARRIED:                       # MusicXML's order inside <attributes>
                for (t, num), el in sorted(state.items()):
                    if t == tag and (t, num) not in have:
                        carried.append(el)
            if own is not None:
                for i, el in enumerate(list(carried)):
                    own.insert(i, el)
            elif len(carried):
                head.insert(0, carried)
    return '<?xml version="1.0" encoding="UTF-8"?>\n' + ET.tostring(root, encoding="unicode")


def _ned(pred_xml: str, ref_xml: str) -> Optional[float]:
    p, r = NQ.file_stats(musicxml.read_score(pred_xml)), NQ.file_stats(musicxml.read_score(ref_xml))
    return None if p is None or r is None else NQ.compare(p, r, 0)["nq.ned"]


def _symbols(xml: str) -> Dict[Tuple[int, int], List]:
    st = NQ.file_stats(musicxml.read_score(xml))
    return st["symbols"] if st else {}


# ------------------------------------------------------------------ --build
def build(audio_score: Optional[str] = None) -> int:
    rows = _eligible()
    feats = {c.id: _features(canon) for c, _, canon in rows}
    chosen: List[Tuple[str, Any, Any, Any]] = []
    used, per_source = set(), {}
    for name, k in STRATA:
        for _ in range(k):
            cands = [(c, ref, canon) for c, ref, canon in rows if c.id not in used and _in_stratum(name, feats[c.id])
                     and feats[c.id]["n"] >= BARS]
            if not cands:
                print(f"human-set: no reference left for stratum {name}")
                return 2
            cands.sort(key=lambda x: (per_source.get(_source(x[1]), 0), -_feature_in(name, feats[x[0].id], 0, feats[x[0].id]["n"]), x[0].id))
            c, ref, canon = cands[0]
            used.add(c.id)
            per_source[_source(ref)] = per_source.get(_source(ref), 0) + 1
            chosen.append((name, c, ref, canon))
    by = corpus.by_id(corpus.load_corpus())
    jobs = []
    for _, c, ref, canon in chosen:
        p = perform.perform(canon, c.ref_id, c.profile, c.beats, c.seed, expect=by[c.ref_id].expect, case_opts=c.opts, opt_name=c.opt_name)
        for v, pro in (("A", "off"), ("B", "on")):
            jobs.append({"id": c.id + "#" + v, "input": p.input, "opts": dict(p.opts, professional=pro)})
    res = stages.notate_batch(jobs, audio_score=audio_score)["results"]
    os.makedirs(HUMAN, exist_ok=True)
    index = []
    for i, (name, c, ref, canon) in enumerate(chosen, start=1):
        hid = f"HG{i:02d}"
        a, b = res[c.id + "#A"], res[c.id + "#B"]
        if not a.get("ok") or not b.get("ok"):
            print(f"{hid} {c.id}: toMusicXml failed ({a.get('code') or b.get('code')})")
            return 1
        cxml = musicxml.read_bytes(ref.abspath).decode("utf-8")
        f = feats[c.id]
        sa, sb = _symbols(a["xml"]), _symbols(b["xml"])
        n = min(f["n"], len(musicxml.read_score(a["xml"]).measures))
        best = None
        for start in range(0, max(1, n - BARS + 1), 4):
            diff = sum(1 for key in set(sa) | set(sb) if start <= key[0] < start + BARS and sa.get(key) != sb.get(key))
            score = (_feature_in(name, f, start, start + BARS), diff, -start)
            if best is None or score > best[0]:
                best = (score, start)
        start = best[1]
        out = {v: excerpt(x, start, BARS) for v, x in (("A", a["xml"]), ("B", b["xml"]), ("C", cxml))}
        d = os.path.join(HUMAN, hid)
        os.makedirs(d, exist_ok=True)
        for v, x in out.items():
            with open(os.path.join(d, v + ".musicxml"), "w", encoding="utf-8", newline="\n") as handle:
                handle.write(x)
        meta = {"schema": "ppp.g3-human-excerpt/1", "id": hid, "stratum": name, "case": c.id, "reference": ref.path,
                "source": _source(ref), "bars": [start + 1, start + BARS], "bar_offset": 0,
                "bar_offset_note": "A and B come from oracle beats: their bars are assumed to be the reference's",
                "versions": {"A": "recording path, G3 off", "B": "recording path, G3a on", "C": "the reference"},
                "sha256": {v: util.sha256_bytes(x.encode("utf-8")) for v, x in out.items()},
                "ned": {"A": _ned(out["A"], out["C"]), "B": _ned(out["B"], out["C"])},
                "commit": (util.git_sha() or "")[:10], "renderer": None}
        util.dump_json(meta, os.path.join(d, "meta.json"))
        index.append({k: meta[k] for k in ("id", "stratum", "case", "bars", "source", "ned")})
        print(f"{hid} {name:13} {c.id} bars {start + 1}-{start + BARS} ned A {meta['ned']['A']} B {meta['ned']['B']}")
    util.dump_json({"schema": "ppp.g3-human-set/1", "excerpts": index}, os.path.join(HUMAN, "index.json"))
    return 0


# ------------------------------------------------------------------ --pairs
def pairs() -> int:
    index = util.load_json(os.path.join(HUMAN, "index.json"))["excerpts"]
    rnd = random.Random(SEED)
    rows = []
    for x in index:
        left, right = ("A", "B") if rnd.random() < 0.5 else ("B", "A")
        rows.append({"id": x["id"], "left": left, "right": right})
    absolute = [{"id": x["id"], "version": v} for x in index for v in ("B", "C")]
    rnd.shuffle(absolute)
    baseline = [{"id": x["id"], "version": "A"} for x in index]
    rnd.shuffle(baseline)
    util.dump_json({"schema": "ppp.g3-human-pairs/1", "seed": SEED, "pairs": rows, "absolute": absolute, "absolute_A": baseline},
                   os.path.join(HUMAN, "pairs.json"))
    template = {
        "schema": "ppp.g3-human-review/1",
        "reviewer_role": "", "date": "", "commit": (util.git_sha() or "")[:10], "renderer": "",
        "instructions": "pairs: for each axis write left, same or right (which reads better); absolute: give is yes, fix "
                        "or no (could a piano teacher hand this to a pupil?) and score 1-5. Render every file with the "
                        "same engraver (MuseScore 4). Write your role, never your name.",
        "pairs": [dict(r, **{k: None for k in AXES}, note="") for r in rows],
        "absolute": [dict(r, give=None, score=None) for r in absolute],
        "absolute_A": [dict(r, give=None, score=None) for r in baseline],
    }
    util.dump_json(template, os.path.join(HUMAN, "review-template.json"))
    print(f"human-set: {len(rows)} pairs, {len(absolute)} + {len(baseline)} absolute ratings -> {os.path.relpath(HUMAN, util.repo_root())}")
    return 0


# ------------------------------------------------------------------ --score
def _kendall(xs: List[float], ys: List[float]) -> Optional[float]:
    num = den_x = den_y = 0
    for i in range(len(xs)):
        for j in range(i + 1, len(xs)):
            a, b = (xs[i] > xs[j]) - (xs[i] < xs[j]), (ys[i] > ys[j]) - (ys[i] < ys[j])
            num += a * b
            den_x += a * a
            den_y += b * b
    return num / (den_x * den_y) ** 0.5 if den_x and den_y else None


def judge(review: Dict[str, Any], index: List[Dict[str, Any]]) -> Dict[str, Any]:
    """§21.5 on a filled-in review: [(criterion, passed, detail)] and the numbers behind them."""
    pref = {}                                   # id -> axis -> +1 B better, 0 same, -1 A better
    for p in review["pairs"]:
        b_side = "left" if p["left"] == "B" else "right"
        pref[p["id"]] = {ax: (0 if p.get(ax) == "same" else 1 if p.get(ax) == b_side else -1 if p.get(ax) else None) for ax in AXES}
    n = len(pref)
    missing = [i for i, v in pref.items() if any(x is None for x in v.values())]
    b_ge_a = sum(1 for v in pref.values() if v["overall"] is not None and v["overall"] >= 0)
    rhythm_worse = sum(1 for v in pref.values() if v["rhythm"] == -1)
    usable = lambda rows, ver: sum(1 for r in rows if r["version"] == ver and r.get("give") in ("yes", "fix"))
    b_ok, a_ok = usable(review["absolute"], "B"), usable(review["absolute_A"], "A")
    ned = {x["id"]: x["ned"] for x in index}
    ids = [i for i in pref if ned.get(i) and ned[i]["A"] is not None and ned[i]["B"] is not None and pref[i]["overall"] is not None]
    tau = _kendall([ned[i]["A"] - ned[i]["B"] for i in ids], [pref[i]["overall"] for i in ids]) if len(ids) > 1 else None
    mean = lambda v: sum(ned[i][v] for i in ids) / len(ids) if ids else None
    lines = [
        ("every pair judged on every axis", not missing, f"{len(missing)} incomplete" + (f": {', '.join(missing[:5])}" if missing else "")),
        ("overall: B at least as good as A in 18 of 20 or more", b_ge_a >= 18 and n >= 20, f"{b_ge_a} of {n}"),
        ("rhythm: B worse than A in none", rhythm_worse == 0, f"{rhythm_worse}"),
        ("absolute: more B than A a teacher would hand out (yes or after fixes)", b_ok > a_ok, f"B {b_ok}, A {a_ok}"),
    ]
    return {"lines": lines, "ned_mean": {"A": mean("A"), "B": mean("B")}, "kendall_tau_ned_vs_overall": tau, "n": n}


def score(path: str) -> int:
    review = util.load_json(path)
    index = util.load_json(os.path.join(HUMAN, "index.json"))["excerpts"]
    res = judge(review, index)
    print(f"G3 human review ({review.get('reviewer_role') or 'reviewer role not given'}, {review.get('date')}, renderer {review.get('renderer')})")
    for name, ok, detail in res["lines"]:
        print(f"  {'PASS' if ok else 'FAIL'}  {name} — {detail}")
    print(f"  info  nq.ned mean A {res['ned_mean']['A']} -> B {res['ned_mean']['B']}; Kendall tau (ned drop vs overall) {res['kendall_tau_ned_vs_overall']}")
    print("  note  one reviewer: the result is one person's judgement" if not review.get("second_reviewer") else "")
    ok = all(x[1] for x in res["lines"])
    print("A36: " + ("PASS" if ok else "FAIL"))
    return 0 if ok else 1
