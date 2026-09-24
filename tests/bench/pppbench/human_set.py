"""The G3 human review set (docs/GOALS/G03 §21, A36), blind (§29 M4).

    run.py human-set --build          write the 60 review files, the review form and the answer key
    run.py human-set --pairs          write the review form again from the answer key (no new draw)
    run.py human-set --score FILE     judge a filled-in review against §21.5 through the key (exit 1 when a
                                      criterion fails)

Twenty 8-bar excerpts of core references, stratified (simple duple 4, simple triple 4, compound 4, with triplets 3,
two-voice texture 3, chromatic or modulating 2) and spread over the sources (the method books, hymns, the catalogue).
Only trusted references PPP neither transcribed nor generated, with a licence that lets the excerpt be kept, are used
(§21.2): human engraving is what is judged against. Each excerpt comes in three versions of the same bars: the
recording path's score with G3 off, the same with G3a on, and the reference itself; the first two are made from the
core case `<ref>|human|oracle|s1` (a synthetic performance of the reference, oracle beats), so their bars are the
reference's (bar offset 0, an assumption the key records). The window is the one where the stratum's feature is densest
in the reference, then where the two recording-path versions differ most.

Blind (M4): the reviewer sees `tests/bench/human/g3/E01-X.musicxml` … `E20-Z.musicxml`. The excerpt numbers are drawn
in a shuffled order and each excerpt's three versions are shuffled into X, Y and Z (seed ``SEED``), so neither a name
nor a position says which is which. Every file is normalized the same way (``normalize``): no title, composer, credit,
software, page layout, part abbreviation or instrument; no directions (words, dynamics, tempo, pedal, 8va), no slurs,
articulations, fingerings, ornaments or lyrics (G3a writes none of these, the references do); bars numbered 1-8. What
is left is what G3a writes and the review judges: notes, rests, ties, tuplets, beams, stems, voices, staves, clefs,
keys, metres, accidentals, barlines. The answer key (which version each letter is, the case, the reference, its source
and licence, the files' sha256) is `tests/bench/human/g3-key/key.json`, for the scoring tool; a reviewer does not open
it before the review is filed.

The rendering (MuseScore 4 on the reviewer's machine, never the app's renderer, which re-beams and re-brackets and so
hides G3's decisions) and the judging are the user's (D7). A review names the reviewer's role, never their name.
"""

from __future__ import annotations

import os
import random
import xml.etree.ElementTree as ET
from typing import Any, Dict, List, Optional, Tuple

from . import corpus, musicxml, perform, stages, suite as suite_mod, util
from .metrics import notation_quality as NQ

HUMAN = os.path.join(util.bench_root(), "human", "g3")
KEY_DIR = os.path.join(util.bench_root(), "human", "g3-key")
BARS = 8
SEED = 20260924
STRATA = [("simple-duple", 4), ("simple-triple", 4), ("compound", 4), ("tuplets", 3), ("two-voice", 3), ("chromatic", 2)]
AXES = ("rhythm", "voices", "spelling", "overall")
LABELS = ("X", "Y", "Z")
MEANING = {"A": "recording path, G3 off", "B": "recording path, G3a on", "C": "the reference"}


# ------------------------------------------------------------------ the references
def _eligible() -> List[Tuple[Any, Any, Any, Dict[str, Any]]]:
    """[(case, reference entry, canonical reference, provenance)] of core's `|human|oracle|s1` cases a human engraved,
    whose licence is known."""
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
        if not p.get("license"):
            continue
        out.append((c, ref, corpus.read_reference(ref), p))
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


# what normalize removes, recorded in the manifest
HEADER = ("work", "movement-number", "movement-title", "identification", "defaults", "credit")
MEASURE_MARKS = ("print", "direction", "harmony", "figured-bass", "sound", "listening", "grouping", "link", "bookmark")
NOTE_MARKS = ("lyric", "play", "listen", "notehead-text", "instrument")
KEEP_NOTATIONS = ("tied", "tuplet")
LOOKS = ("default-x", "default-y", "relative-x", "relative-y", "color", "font-family", "font-size", "font-style", "font-weight")
NORMALIZED = {
    "removed_header": list(HEADER), "part_list": "each score-part keeps only its part-name, set to Piano",
    "removed_from_measures": list(MEASURE_MARKS) + ["the width attribute"],
    "removed_from_notes": list(NOTE_MARKS) + ["every <notations> child but " + " and ".join(KEEP_NOTATIONS)],
    "removed_attributes": list(LOOKS), "bars": "renumbered 1-8", "title": "the file's opaque label (E01-X)",
    "parts": "ids P1, P2 … in order",
}


def normalize(xml: str, label: str) -> str:
    """One excerpt as the reviewer gets it: only what G3a writes and the review judges, under an opaque title, laid
    out the same way whichever version it is (NORMALIZED says what is removed)."""
    root = ET.fromstring(xml)
    for tag in HEADER:
        for el in root.findall(tag):
            root.remove(el)
    title = ET.Element("movement-title")
    title.text = label
    root.insert(0, title)
    # parts named P1, P2 … in order (some references have no id, which MuseScore needs to pair a part with its entry;
    # G03 §28 o3), each entry keeping only its part-name, Piano
    for i, (sp, part) in enumerate(zip(root.iter("score-part"), root.findall("part")), start=1):
        sp.set("id", f"P{i}")
        part.set("id", f"P{i}")
    for sp in root.iter("score-part"):
        for child in list(sp):
            if child.tag != "part-name":
                sp.remove(child)
        name = sp.find("part-name")
        if name is None:
            name = ET.SubElement(sp, "part-name")
        name.attrib.clear()
        name.text = "Piano"
    for part in root.findall("part"):
        for i, m in enumerate(part.findall("measure")):
            m.set("number", str(i + 1))
            m.attrib.pop("width", None)
            for el in list(m):
                if el.tag in MEASURE_MARKS:
                    m.remove(el)
            for note in m.findall("note"):
                for el in list(note):
                    if el.tag in NOTE_MARKS:
                        note.remove(el)
                for nt in note.findall("notations"):
                    for el in list(nt):
                        if el.tag not in KEEP_NOTATIONS:
                            nt.remove(el)
                    if not len(nt):
                        note.remove(nt)
    for el in root.iter():
        for a in LOOKS:
            el.attrib.pop(a, None)
    return '<?xml version="1.0" encoding="UTF-8"?>\n' + ET.tostring(root, encoding="unicode")


def _ned(pred_xml: str, ref_xml: str) -> Optional[float]:
    p, r = NQ.file_stats(musicxml.read_score(pred_xml)), NQ.file_stats(musicxml.read_score(ref_xml))
    return None if p is None or r is None else NQ.compare(p, r, 0)["nq.ned"]


def _symbols(xml: str) -> Dict[Tuple[int, int], List]:
    st = NQ.file_stats(musicxml.read_score(xml))
    return st["symbols"] if st else {}


def _write(path: str, text: str) -> None:
    with open(path, "w", encoding="utf-8", newline="\n") as handle:
        handle.write(text)


def _clear() -> None:
    """Remove what a build writes (and the unblinded HG01-HG20 layout it replaced), nothing else."""
    import shutil
    if os.path.isdir(HUMAN):
        for name in os.listdir(HUMAN):
            p = os.path.join(HUMAN, name)
            if os.path.isdir(p) and name.startswith("HG") and name[2:].isdigit():
                shutil.rmtree(p)
            elif name.endswith(".musicxml") and name[:1] == "E" or name in ("index.json", "pairs.json", "review-template.json",
                                                                             "manifest.json", "review-form.json"):
                os.remove(p)
    os.makedirs(HUMAN, exist_ok=True)
    os.makedirs(KEY_DIR, exist_ok=True)


# ------------------------------------------------------------------ --build
def build(audio_score: Optional[str] = None) -> int:
    rows = _eligible()
    feats = {c.id: _features(canon) for c, _, canon, _ in rows}
    chosen: List[Tuple[str, Any, Any, Any, Dict[str, Any]]] = []
    used, per_source = set(), {}
    for name, k in STRATA:
        for _ in range(k):
            cands = [x for x in rows if x[0].id not in used and _in_stratum(name, feats[x[0].id]) and feats[x[0].id]["n"] >= BARS]
            if not cands:
                print(f"human-set: no reference left for stratum {name}")
                return 2
            cands.sort(key=lambda x: (per_source.get(_source(x[1]), 0), -_feature_in(name, feats[x[0].id], 0, feats[x[0].id]["n"]), x[0].id))
            c, ref, canon, prov = cands[0]
            used.add(c.id)
            per_source[_source(ref)] = per_source.get(_source(ref), 0) + 1
            chosen.append((name, c, ref, canon, prov))
    by = corpus.by_id(corpus.load_corpus())
    jobs = []
    for _, c, ref, canon, _ in chosen:
        p = perform.perform(canon, c.ref_id, c.profile, c.beats, c.seed, expect=by[c.ref_id].expect, case_opts=c.opts, opt_name=c.opt_name)
        for v, pro in (("A", "off"), ("B", "on")):
            jobs.append({"id": c.id + "#" + v, "input": p.input, "opts": dict(p.opts, professional=pro)})
    res = stages.notate_batch(jobs, audio_score=audio_score)["results"]
    for name, c, ref, canon, _ in chosen:
        for v in ("A", "B"):
            if not res[c.id + "#" + v].get("ok"):
                print(f"human-set: {c.id} ({MEANING[v]}): toMusicXml failed ({res[c.id + '#' + v].get('code')})")
                return 1
    _clear()
    rnd = random.Random(SEED)
    order = list(range(len(chosen)))
    rnd.shuffle(order)                                   # which excerpt is E01, E02 …: not the strata's order
    key_rows, files = [], []
    for num, idx in enumerate(order, start=1):
        name, c, ref, canon, prov = chosen[idx]
        eid = f"E{num:02d}"
        a, b = res[c.id + "#A"]["xml"], res[c.id + "#B"]["xml"]
        f = feats[c.id]
        sa, sb = _symbols(a), _symbols(b)
        n = min(f["n"], len(musicxml.read_score(a).measures))
        best = None
        for start in range(0, max(1, n - BARS + 1), 4):
            diff = sum(1 for key in set(sa) | set(sb) if start <= key[0] < start + BARS and sa.get(key) != sb.get(key))
            score = (_feature_in(name, f, start, start + BARS), diff, -start)
            if best is None or score > best[0]:
                best = (score, start)
        start = best[1]
        raw = {"A": excerpt(a, start, BARS), "B": excerpt(b, start, BARS),
               "C": excerpt(musicxml.read_bytes(ref.abspath).decode("utf-8"), start, BARS)}
        versions = list("ABC")
        rnd.shuffle(versions)                            # X, Y, Z: a fresh order for every excerpt
        letters = dict(zip(LABELS, versions))
        sha = {}
        for label, v in letters.items():
            text = normalize(raw[v], f"{eid}-{label}")
            fname = f"{eid}-{label}.musicxml"
            _write(os.path.join(HUMAN, fname), text)
            sha[label] = util.sha256_bytes(text.encode("utf-8"))
            files.append({"file": fname, "sha256": sha[label]})
        key_rows.append({
            "id": eid, "versions": letters, "stratum": name, "case": c.id, "reference": ref.path,
            "source": _source(ref), "licence": prov.get("license"), "provenance": prov.get("source"),
            "bars_in_reference": [start + 1, start + BARS], "bar_offset": 0,
            "bar_offset_note": "the recording-path versions come from oracle beats: their bars are assumed to be the reference's",
            "sha256": sha, "ned": {"A": _ned(raw["A"], raw["C"]), "B": _ned(raw["B"], raw["C"])}})
        print(f"{eid} {name:13} bars {start + 1}-{start + BARS} ned A {key_rows[-1]['ned']['A']} B {key_rows[-1]['ned']['B']}")
    commit = (util.git_sha() or "")[:10]
    util.dump_json({"schema": "ppp.g3-human-key/1", "seed": SEED, "commit": commit, "meaning": MEANING,
                    "normalized": NORMALIZED, "excerpts": sorted(key_rows, key=lambda x: x["id"])},
                   os.path.join(KEY_DIR, "key.json"))
    util.dump_json({"schema": "ppp.g3-human-set/2", "seed": SEED, "commit": commit, "bars": BARS,
                    "excerpts": [f"E{i:02d}" for i in range(1, len(chosen) + 1)], "versions_per_excerpt": list(LABELS),
                    "licence": "every excerpt is of a public-domain or CC0 work; the answer key names each source and licence",
                    "normalized": NORMALIZED, "files": sorted(files, key=lambda x: x["file"])},
                   os.path.join(HUMAN, "manifest.json"))
    return form()


# ------------------------------------------------------------------ --pairs (the review form)
def form() -> int:
    key = util.load_json(os.path.join(KEY_DIR, "key.json"))
    ids = [x["id"] for x in key["excerpts"]]
    files = [f"{i}-{label}" for i in ids for label in LABELS]
    random.Random(SEED + 1).shuffle(files)               # every file rated on its own, in no excerpt's order
    template = {
        "schema": "ppp.g3-human-review/2",
        "reviewer_role": "", "date": "", "commit": key.get("commit"), "renderer": "",
        "instructions": "Render every file of tests/bench/human/g3 with the same engraver (MuseScore 4), not the app. "
                        "excerpts: for each excerpt rank its three versions X, Y, Z on each axis, 1 best (equal ranks for "
                        "equal quality). absolute: for each file on its own, give is yes, fix or no (could a piano "
                        "teacher hand this to a pupil, as it is or after small fixes?) and score 1-5. Write your role, "
                        "never your name. Do not open tests/bench/human/g3-key before the review is filed.",
        "excerpts": [{"id": i, "rank": {ax: {label: None for label in LABELS} for ax in AXES}, "note": ""} for i in ids],
        "absolute": [{"file": f, "give": None, "score": None} for f in files],
    }
    util.dump_json(template, os.path.join(HUMAN, "review-form.json"))
    print(f"human-set: {len(ids)} excerpts x {len(LABELS)} versions, {len(files)} absolute ratings -> "
          f"{os.path.relpath(HUMAN, util.repo_root())}; answer key in {os.path.relpath(KEY_DIR, util.repo_root())}")
    return 0


def pairs() -> int:
    return form()


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


def judge(review: Dict[str, Any], key: Dict[str, Any]) -> Dict[str, Any]:
    """§21.5 on a filled-in review, read through the answer key: [(criterion, passed, detail)] and the numbers."""
    exc = {x["id"]: x for x in key["excerpts"]}
    pref: Dict[str, Dict[str, Optional[int]]] = {}      # id -> axis -> +1 B better, 0 same, -1 A better
    c_first = 0
    for r in review.get("excerpts") or []:
        k = exc.get(r.get("id"))
        if k is None:
            continue
        letter = {v: x for x, v in k["versions"].items()}
        p = {}
        for ax in AXES:
            ranks = ((r.get("rank") or {}).get(ax) or {})
            ra, rb, rc = ranks.get(letter["A"]), ranks.get(letter["B"]), ranks.get(letter["C"])
            p[ax] = None if ra is None or rb is None or rc is None else (rb < ra) - (rb > ra)
            if ax == "overall" and rc is not None and ra is not None and rb is not None and rc <= min(ra, rb):
                c_first += 1
        pref[r["id"]] = p
    n = len(exc)
    missing = [i for i in exc if i not in pref or any(x is None for x in pref[i].values())]
    rated = {}
    for row in review.get("absolute") or []:
        eid, _, label = (row.get("file") or "").partition("-")
        if eid in exc and label in exc[eid]["versions"] and row.get("give") in ("yes", "fix", "no"):
            rated[(eid, label)] = row["give"]
    unrated = n * len(LABELS) - len(rated)
    usable = lambda ver: sum(1 for (eid, label), give in rated.items() if exc[eid]["versions"][label] == ver and give in ("yes", "fix"))  # noqa: E731
    b_ge_a = sum(1 for v in pref.values() if v["overall"] is not None and v["overall"] >= 0)
    rhythm_worse = sum(1 for v in pref.values() if v["rhythm"] == -1)
    ids = [i for i in pref if exc[i]["ned"]["A"] is not None and exc[i]["ned"]["B"] is not None and pref[i]["overall"] is not None]
    tau = _kendall([exc[i]["ned"]["A"] - exc[i]["ned"]["B"] for i in ids], [pref[i]["overall"] for i in ids]) if len(ids) > 1 else None
    mean = lambda v: sum(exc[i]["ned"][v] for i in ids) / len(ids) if ids else None  # noqa: E731
    lines = [
        ("every excerpt ranked on every axis, every file rated", not missing and not unrated,
         f"{len(missing)} excerpt(s) incomplete" + (f" ({', '.join(missing[:5])})" if missing else "") + f", {unrated} file(s) unrated"),
        ("overall: G3a at least as good as G3 off in 18 of 20 or more", b_ge_a >= 18 and n >= 20, f"{b_ge_a} of {n}"),
        ("rhythm: G3a worse than G3 off in none", rhythm_worse == 0, f"{rhythm_worse}"),
        ("absolute: more G3a than G3-off files a teacher would hand out (yes or after fixes)", usable("B") > usable("A"),
         f"G3a {usable('B')}, G3 off {usable('A')} (reference {usable('C')})"),
    ]
    return {"lines": lines, "ned_mean": {"A": mean("A"), "B": mean("B")}, "kendall_tau_ned_vs_overall": tau, "n": n,
            "reference_ranked_first_overall": c_first}


def score(path: str) -> int:
    review = util.load_json(path)
    key = util.load_json(os.path.join(KEY_DIR, "key.json"))
    res = judge(review, key)
    print(f"G3 human review ({review.get('reviewer_role') or 'reviewer role not given'}, {review.get('date')}, renderer {review.get('renderer')})")
    for name, ok, detail in res["lines"]:
        print(f"  {'PASS' if ok else 'FAIL'}  {name} — {detail}")
    print(f"  info  the reference ranked first (or equal first) overall in {res['reference_ranked_first_overall']} of {res['n']}")
    print(f"  info  nq.ned mean G3 off {res['ned_mean']['A']} -> G3a {res['ned_mean']['B']}; Kendall tau (ned drop vs overall) {res['kendall_tau_ned_vs_overall']}")
    if not review.get("second_reviewer"):
        print("  note  one reviewer: the result is one person's judgement")
    ok = all(x[1] for x in res["lines"])
    print("A36: " + ("PASS" if ok else "FAIL"))
    return 0 if ok else 1
