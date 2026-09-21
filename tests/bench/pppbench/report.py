"""summary.md — the human-readable report of a run (docs/GOALS/G00 §9.1)."""

from __future__ import annotations

import os
from typing import Any, Dict, List, Optional

HEADLINE = ["sqi", "notes.identity.f1", "notes.onset.f1_50ms", "notation.ioi.accuracy", "notation.onset_pos.accuracy",
            "notation.duration.accuracy", "notation.hand.accuracy", "notation.spelling.accuracy",
            "notation.ties.extra_per_100", "struct.time_sig.exact", "struct.time_sig.score", "struct.key.fifths_exact",
            "struct.key.mirex", "struct.tempo.ok_effective", "struct.tempo.ok_written", "struct.tempo.mark_consistent",
            "struct.tempo.metrical_ok", "struct.measures.count_exact", "struct.downbeat.f1", "read.bar_integrity",
            "notes.input_fidelity.f1", "notes.identity.recall_micro", "notes.identity.precision_micro"]
TAG_METRICS = ["sqi", "notes.identity.f1", "notation.ioi.accuracy", "struct.time_sig.exact", "struct.key.fifths_exact",
               "notation.hand.accuracy"]
TAG_PREFIXES = ("set:", "metre-class:", "profile:", "beats:", "book:")


def _m(agg: Dict[str, Any], k: str) -> Optional[float]:
    v = (agg or {}).get(k)
    return v.get("mean") if isinstance(v, dict) else None


def _f(x: Optional[float], nd: int = 4) -> str:
    return "–" if x is None else f"{x:.{nd}f}"


def _cell(text: str) -> str:
    """A case id inside a Markdown table: GitHub splits cells on | even inside code spans."""
    return text.replace("|", "\\|")


def _d(x: Optional[float], nd: int = 4) -> str:
    return "–" if x is None else f"{x:+.{nd}f}"


def write_summary(results: Dict[str, Any], run: Dict[str, Any], verdict, baseline: Optional[Dict[str, Any]],
                  path: str, *, reveal_holdout: bool = False, title: Optional[str] = None) -> None:
    agg = results["aggregates"]
    allm = agg["all"]
    base_all = (baseline or {}).get("aggregates", {}).get("all", {})
    anchor = ((baseline or {}).get("anchor") or {}).get("aggregates_all", {})
    L: List[str] = []
    L.append(f"# {title or 'Benchmark: ' + results['suite']}")
    L.append("")
    L.append(f"git `{(run.get('git_sha') or '?')[:10]}`{' (dirty)' if run.get('git_dirty') else ''} · "
             f"audio-score `{(run.get('audio_score_sha256') or '?')[:12]}` · node {run.get('node')} · "
             f"python {run.get('python')} · {run.get('platform')} · {run.get('cases')} cases, "
             f"{allm['errors']['count']} errors · {run.get('timing', {}).get('total_s')} s")
    L.append("")
    L.append("## Verdict")
    L.append("")
    if verdict is None:
        L.append("No baseline to compare with (record one with `update-baseline`).")
    else:
        L.append(f"**{verdict.status}**")
        for name, items in (("Errors", verdict.errors), ("Failures", verdict.failures),
                            ("Warnings", verdict.warnings), ("Improvements", verdict.improvements)):
            if items:
                L.append("")
                L.append(f"{name}:")
                L += [f"- {x}" for x in items[:30]]
                if len(items) > 30:
                    L.append(f"- … {len(items) - 30} more")
    L.append("")
    L.append("## Headline")
    L.append("")
    L.append("| metric | value | n | baseline | Δ | Δ vs anchor | status |")
    L.append("| --- | --- | --- | --- | --- | --- | --- |")
    for k in HEADLINE:
        v = allm.get(k)
        if not isinstance(v, dict):
            continue
        b, a = _m(base_all, k), _m(anchor, k)
        st = (verdict.deltas.get(k, {}).get("status") if verdict else None) or ""
        nd = 2 if k in ("sqi", "notation.ties.extra_per_100") else 4
        L.append(f"| `{k}` | {_f(v['mean'], nd)} | {v['n']} | {_f(b, nd)} | "
                 f"{_d(v['mean'] - b if v['mean'] is not None and b is not None else None, nd)} | "
                 f"{_d(v['mean'] - a if v['mean'] is not None and a is not None else None, nd)} | {st} |")
    L.append("")
    L.append("## By tag")
    L.append("")
    L.append("| tag | cases | " + " | ".join(f"`{m}`" for m in TAG_METRICS) + " | Δ SQI |")
    L.append("| --- | --- | " + " | ".join("---" for _ in TAG_METRICS) + " | --- |")
    base_tags = (baseline or {}).get("aggregates", {}).get("by_tag", {})
    for tag, t in agg["by_tag"].items():
        if not tag.startswith(TAG_PREFIXES):
            continue
        b = _m(base_tags.get(tag, {}), "sqi")
        s = _m(t, "sqi")
        L.append(f"| {tag} | {t['cases']} | " + " | ".join(_f(_m(t, m), 2 if m == "sqi" else 3) for m in TAG_METRICS) +
                 f" | {_d(s - b if s is not None and b is not None else None, 2)} |")
    L.append("")
    L.append("## Largest case changes")
    L.append("")
    if verdict is None or not verdict.case_deltas:
        L.append("No case changed its SQI." if verdict else "No baseline.")
        L.append("")
    else:
        deltas = [d for d in verdict.case_deltas if reveal_holdout or not d["holdout"]]
        for title2, rows in (("Down", deltas[:10]), ("Up", sorted(deltas, key=lambda x: (-x["delta"], x["id"]))[:10])):
            rows = [r for r in rows if (r["delta"] < 0) == (title2 == "Down")]
            if not rows:
                continue
            L.append(f"**{title2}**")
            L.append("")
            L.append("| case | Δ SQI | SQI | main cause | output |")
            L.append("| --- | --- | --- | --- | --- |")
            for r in rows:
                L.append(f"| `{_cell(r['id'])}` | {r['delta']:+.2f} | {r['sqi']:.2f} | {r['cause'] or '–'} | `cases/{r['key']}.musicxml` |")
            L.append("")
    L.append("## Lowest SQI cases")
    L.append("")
    low = sorted((c for c in results["cases"] if c["status"] == "ok" and (reveal_holdout or "holdout" not in c["tags"])
                  and c["metrics"].get("sqi") is not None), key=lambda c: (c["metrics"]["sqi"], c["id"]))[:10]
    L.append("| case | SQI | metre (exp → got) | key fifths (exp → got) | output |")
    L.append("| --- | --- | --- | --- | --- |")
    for c in low:
        e, p = c["expected"], c["predicted"]
        L.append(f"| `{_cell(c['id'])}` | {c['metrics']['sqi']:.2f} | {e['time'][0]}/{e['time'][1]} → {p['time'][0]}/{p['time'][1]} | "
                 f"{e['key']['fifths']} → {p['key']['fifths']} | `cases/{c['key']}.musicxml` |")
    L.append("")
    L.append("## Errors")
    L.append("")
    errs = [c for c in results["cases"] if c["status"] == "error" and (reveal_holdout or "holdout" not in c["tags"])]
    if not errs:
        L.append("None.")
    else:
        L.append("| code | count | example |")
        L.append("| --- | --- | --- |")
        by: Dict[str, List[str]] = {}
        for c in errs:
            by.setdefault(c["error_code"], []).append(c["id"])
        for code, ids in sorted(by.items()):
            L.append(f"| {code} | {len(ids)} | `{_cell(ids[0])}` |")
    L.append("")
    L.append("## Hold-out (aggregate only)")
    L.append("")
    h = agg["by_tag"].get("holdout")
    if not h:
        L.append("This suite has no hold-out cases.")
    else:
        L.append(f"{h['cases']} cases · SQI {_f(_m(h, 'sqi'), 2)} · identity F1 {_f(_m(h, 'notes.identity.f1'))} · "
                 f"time signature exact {_f(_m(h, 'struct.time_sig.exact'))} · key {_f(_m(h, 'struct.key.fifths_exact'))} · "
                 f"hands {_f(_m(h, 'notation.hand.accuracy'))}. Per-case rows need `--reveal-holdout`.")
    L.append("")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as handle:
        handle.write("\n".join(L))
