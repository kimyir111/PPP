#!/usr/bin/env python3
"""Write the arranger jobs of a rec-arrange suite as ``jobs.jsonl`` (G10c-1a, docs/GOALS/G10 section 33.6).

    python tests/bench/tools/arrange_jobs.py --suite rec-arrange-core --opts app,v2 --out jobs.jsonl

One line per case of the suite, {id, ref, input, opts, bar_sec}, exactly what ``pppbench/recarrange.py generate`` hands to
``tests/bench/node/rec-arrange.js`` (the replay fixtures of the suite's ``replay_dirs`` included): the humanizer's performance of each
reference, as the heard notes the recording conversion is given. ``--opts`` keeps only the cases of those option rows (the suite's
``opt_name``; default: every row). It is the input of ``tests/bench/tools/arrange-identity.js --recordings jobs.jsonl``, the identity of
the reduction on recording graphs: the 168 jobs of ``--suite rec-arrange-core --opts app,v2`` (64 references and the 20 real-AMT fixtures
of replay-of, two rows) x 3 levels, which with the six private covers are the 522 requests of section 33.6. The lead sheet's own row
(``v2-lead``) is left out there because its recording graphs are v2's (the identity compares the reduction, which a ``recordingArrange``
key in a job's options does not reach).
"""

import argparse
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

from pppbench import corpus, recarrange, suite as suite_mod, util  # noqa: E402

util.setup_stdio()


def opt_of(job_id: str) -> str:
    return job_id.rsplit("|opt:", 1)[1] if "|opt:" in job_id else ""


def jobs_of(suite_name: str, opts=None) -> list:
    """The arranger jobs of a suite in id order; ``opts`` (a set of option-row names) keeps only those rows."""
    suite = suite_mod.load_suite(suite_name)
    if not suite.get("rec_arrange"):
        raise SystemExit(f"{suite_name} is not a rec-arrange suite")
    jobs = recarrange.generate(suite, corpus.load_corpus(), None)[0]
    return [j for j in jobs if not opts or opt_of(j["id"]) in opts]


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--suite", required=True, help="a rec-arrange suite (rec-arrange-core, ...)")
    ap.add_argument("--opts", default="", help="comma-separated option rows to keep (default: all)")
    ap.add_argument("--out", required=True, help="the jobs.jsonl to write")
    args = ap.parse_args()
    want = {x for x in args.opts.split(",") if x}
    jobs = jobs_of(args.suite, want)
    with open(args.out, "w", encoding="utf-8", newline="\n") as handle:
        for j in jobs:
            handle.write(json.dumps(j, ensure_ascii=False) + "\n")
    print(f"wrote {len(jobs)} jobs of {args.suite}" + (f" (rows {', '.join(sorted(want))})" if want else "") + f" to {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
