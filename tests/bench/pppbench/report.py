"""summary.md — the human-readable report of a run (docs/GOALS/G00 §9.1, §17).

Order matters: the release headline (usable-score rate and critical gates) comes first, the
diagnostic score after it, and every run lists the known production failures and what the
benchmark leaves out, so that neither can hide behind a good number.
"""

from __future__ import annotations

import os
from typing import Any, Dict, List, Optional

from .metrics.critical import GATES

HEADLINE = ["usable"] + list(GATES) + [
    "sqi", "notes.identity.f1", "notes.onset.f1_50ms", "notation.ioi.accuracy", "notation.onset_pos.accuracy",
    "notation.onset_pos.accuracy_ref", "notation.duration.accuracy", "notation.duration.page_accuracy",
    "notation.note_shape.consistency",
    "notation.hand.accuracy", "notation.spelling.accuracy", "notation.ties.extra_per_100", "notation.tuplets.f1",
    "notation.tuplets.false_per_100", "notation.accidentals.required_recall", "notation.accidentals.courtesy_per_100",
    "notation.pedal.f1", "struct.time_sig.exact", "struct.time_sig.timeline_accuracy", "struct.time_sig.score",
    "struct.key.fifths_exact", "struct.key.timeline_accuracy", "struct.key.mirex", "struct.tempo.present",
    "struct.tempo.ok_effective", "struct.tempo.timeline_accuracy", "struct.tempo.ok_written",
    "struct.tempo.mark_consistent", "struct.tempo.metrical_ok", "struct.stats_consistent",
    "struct.measures.count_exact", "struct.measures.extra_empty_edge", "struct.measure_numbers.valid",
    "struct.measure_numbers.app_onset_accuracy", "struct.downbeat.f1", "read.bar_integrity", "read.bar_completeness",
    "read.ledger_lines.heavy_rate", "notes.input_fidelity.f1", "notes.identity.recall_micro",
    "notes.identity.precision_micro"]
TAG_METRICS = ["usable", "sqi", "notes.identity.f1", "struct.time_sig.exact", "struct.tempo.ok_effective",
               "struct.key.fifths_exact", "notation.onset_pos.accuracy", "notation.hand.accuracy"]
TAG_PREFIXES = ("set:", "metre-class:", "profile:", "beats:", "book:", "mode:", "feature:", "input:")


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


def _pct(x: Optional[float]) -> str:
    return "–" if x is None else f"{100 * x:.1f} %"


def write_summary(results: Dict[str, Any], run: Dict[str, Any], verdict, baseline: Optional[Dict[str, Any]],
                  path: str, *, reveal_holdout: bool = False, title: Optional[str] = None) -> None:
    agg = results["aggregates"]
    allm = agg["all"]
    base_all = (baseline or {}).get("aggregates", {}).get("all", {})
    anchor = ((baseline or {}).get("anchor") or {}).get("aggregates_all", {})
    visible = [c for c in results["cases"] if c["status"] == "ok" and (reveal_holdout or "holdout" not in c["tags"])]
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
        if verdict.semantic_changes:
            L.append("")
            L.append(f"Semantic changes: {verdict.semantic_changes} case(s) now write different music. Whether that "
                     "is better or worse is what the metrics above say; `cases/<key>.musicxml` shows it.")
    L.append("")
    L.append("## Release headline: usable scores and critical gates")
    L.append("")
    L.append(f"**Usable-score rate: {_pct(_m(allm, 'usable'))}** of {_n(allm, 'usable')} cases pass every critical gate "
             "that applies. A failed gate makes a score unusable however high its diagnostic score is "
             "(`pppbench/metrics/critical.py` has the thresholds and why).")
    L.append("")
    fails: Dict[str, int] = {}
    for c in visible:
        for g in GATES:
            if c["metrics"].get(g) == 0.0:
                fails[g] = fails.get(g, 0) + 1
    L.append("| critical gate | pass rate | cases it applies to | failing cases | baseline | rule |")
    L.append("| --- | --- | --- | --- | --- | --- |")
    for g, (_, why) in GATES.items():
        L.append(f"| `{g}` | {_pct(_m(allm, g))} | {_n(allm, g)} | {fails.get(g, 0)} | {_pct(_m(base_all, g))} | {why} |")
    L.append("")
    ds_mean = _m(allm, "sqi")
    high_bad = sorted((c for c in visible if c["metrics"].get("usable") == 0.0 and ds_mean is not None
                       and (c["metrics"].get("sqi") or 0) >= ds_mean), key=lambda c: (-c["metrics"]["sqi"], c["id"]))
    L.append(f"**Diagnostic score high but unusable:** {len(high_bad)} case(s) score at or above the mean diagnostic "
             f"score ({_f(ds_mean, 2)}) yet fail a critical gate. The diagnostic score is a trend line, not a verdict.")
    if high_bad:
        L.append("")
        L.append("| case | diagnostic | failed gates |")
        L.append("| --- | --- | --- |")
        for c in high_bad[:10]:
            failed = [g.split(".", 1)[1] for g in GATES if c["metrics"].get(g) == 0.0]
            L.append(f"| `{_cell(c['id'])}` | {c['metrics']['sqi']:.2f} | {', '.join(failed)} |")
    L.append("")
    L.append("## Headline metrics")
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
        name = "sqi (diagnostic score)" if k == "sqi" else k
        L.append(f"| `{name}` | {_f(v['mean'], nd)} | {v['n']} | {_f(b, nd)} | "
                 f"{_d(v['mean'] - b if v['mean'] is not None and b is not None else None, nd)} | "
                 f"{_d(v['mean'] - a if v['mean'] is not None and a is not None else None, nd)} | {st} |")
    L.append("")
    L.append("## By tag")
    L.append("")
    L.append("| tag | cases | " + " | ".join(f"`{m}`" for m in TAG_METRICS) + " | Δ diagnostic |")
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
    _known(L, results)
    _exclusions(L, results, visible)
    L.append("## Largest case changes")
    L.append("")
    if verdict is None or not verdict.case_deltas:
        L.append("No case changed its diagnostic score." if verdict else "No baseline.")
        L.append("")
    else:
        deltas = [d for d in verdict.case_deltas if reveal_holdout or not d["holdout"]]
        for title2, rows in (("Down", deltas[:10]), ("Up", sorted(deltas, key=lambda x: (-x["delta"], x["id"]))[:10])):
            rows = [r for r in rows if (r["delta"] < 0) == (title2 == "Down")]
            if not rows:
                continue
            L.append(f"**{title2}**")
            L.append("")
            L.append("| case | Δ diagnostic | diagnostic | main cause | output |")
            L.append("| --- | --- | --- | --- | --- |")
            for r in rows:
                L.append(f"| `{_cell(r['id'])}` | {r['delta']:+.2f} | {r['sqi']:.2f} | {r['cause'] or '–'} | `cases/{r['key']}.musicxml` |")
            L.append("")
    L.append("## Lowest diagnostic scores")
    L.append("")
    low = sorted((c for c in visible if c["metrics"].get("sqi") is not None), key=lambda c: (c["metrics"]["sqi"], c["id"]))[:10]
    L.append("| case | diagnostic | usable | metre (exp → got) | key fifths (exp → got) | output |")
    L.append("| --- | --- | --- | --- | --- | --- |")
    for c in low:
        e, p = c["expected"], c["predicted"]
        L.append(f"| `{_cell(c['id'])}` | {c['metrics']['sqi']:.2f} | {'yes' if c['metrics'].get('usable') == 1.0 else 'no'} | "
                 f"{e['time'][0]}/{e['time'][1]} → {p['time'][0]}/{p['time'][1]} | "
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
        L.append(f"{h['cases']} cases · usable {_pct(_m(h, 'usable'))} · diagnostic {_f(_m(h, 'sqi'), 2)} · "
                 f"identity F1 {_f(_m(h, 'notes.identity.f1'))} · time signature exact {_f(_m(h, 'struct.time_sig.exact'))} · "
                 f"key {_f(_m(h, 'struct.key.fifths_exact'))} · hands {_f(_m(h, 'notation.hand.accuracy'))}. "
                 "Per-case rows need `--reveal-holdout`. Hold-out uses the same generator: it shows generalisation to "
                 "unseen pieces, not to real playing (see the `robust` and `replay-public` suites).")
    L.append("")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as handle:
        handle.write("\n".join(L))


def _n(agg: Dict[str, Any], k: str) -> int:
    v = (agg or {}).get(k)
    return int(v.get("n") or 0) if isinstance(v, dict) else 0


def _known(L: List[str], results: Dict[str, Any]) -> None:
    from .known_defects import summary_lines
    kf = results.get("known_failures")
    L.append("## Known production failures (measured, not fixed in G0)")
    L.append("")
    if not kf:
        L.append("Not measured in this run.")
        L.append("")
        return
    L.append(f"Every committed score users can open ({kf['files_scanned']} files under catalog/ and samples/), whether "
             "or not it is a benchmark reference. `check` fails if a count grows.")
    L.append("")
    L += summary_lines(kf)
    L.append("")


def _exclusions(L: List[str], results: Dict[str, Any], visible) -> None:
    ex = results.get("exclusions")
    L.append("## What this benchmark leaves out")
    L.append("")
    if not ex:
        L.append("Not recorded in this run.")
        L.append("")
        return
    for rule, r in ex["excluded_references"].items():
        L.append(f"- **{r['count']} references excluded ({rule})**: {r['why']}. "
                 + ", ".join(r["ids"][:8]) + (" …" if len(r["ids"]) > 8 else ""))
    sk = ex["skipped_metrics"]
    skipped_cases = sum(1 for c in visible if "struct.key.fifths_exact" in c["metrics"]
                        and c["metrics"]["struct.key.fifths_exact"] is None)
    L.append(f"- **Metrics skipped on {sk['references']} references** ({', '.join(sk['metrics'])}): {sk['why']}. "
             f"In this suite that is {skipped_cases} of {len(visible)} cases. Production impact: {sk['production_impact']}.")
    L.append("")
    L.append("| collection | committed | registered | hold-out | excluded |")
    L.append("| --- | --- | --- | --- | --- |")
    for col, cnt in ex["coverage_by_collection"].items():
        exc = ", ".join(f"{k.split(' ', 1)[1]} {v}" for k, v in cnt.items() if k.startswith("excluded"))
        L.append(f"| {col} | {cnt.get('committed', 0)} | {cnt.get('registered', 0)} | {cnt.get('hold-out', 0)} | {exc or '–'} |")
    L.append("")
