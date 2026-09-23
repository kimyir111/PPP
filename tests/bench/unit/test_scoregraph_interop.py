"""ScoreGraph JSON read by Python's standard library alone (docs/GOALS/G01 §14.6, A14).

A graph is JSON with rationals as "n/d" strings and times as integers, so ``json`` and ``Fraction`` read it
exactly. Every valid fixture must hold that each (measure, voice)'s events end within the measure, and the
content length of each measure computed here must be the one the JavaScript library computes.
"""

import json
import os
import subprocess
import unittest
from collections import defaultdict
from fractions import Fraction

from pppbench import stages, util

FIX = os.path.join(util.repo_root(), "tests", "scoregraph", "fixtures", "valid")

JS = r"""
const SG = require(process.argv[1]);
const fs = require('fs');
const out = {};
for (const f of process.argv.slice(2)) {
  const g = SG.parse(fs.readFileSync(f, 'utf8'));
  const ends = {};
  g.parts.forEach(p => p.events.forEach(e => {
    if (e.grace) return;
    const end = SG.rational.add(SG.rational.parse(e.at), SG.rational.parse(e.dur));
    const cur = ends[e.m];
    if (!cur || SG.rational.gt(end, cur)) ends[e.m] = end;
  }));
  out[f] = g.timeline.measures.map(m => ends[m.id] ? SG.rational.format(ends[m.id]) : '0');
}
process.stdout.write(JSON.stringify(out));
"""


def files():
    return sorted(os.path.join(FIX, f) for f in os.listdir(FIX) if f.endswith(".sg.json"))


def content_lengths(doc):
    ends = {}
    for part in doc["parts"]:
        for e in part["events"]:
            if "grace" in e:
                continue
            end = Fraction(e["at"]) + Fraction(e["dur"])
            if e["m"] not in ends or end > ends[e["m"]]:
                ends[e["m"]] = end
    return [str(ends.get(m["id"], Fraction(0))) for m in doc["timeline"]["measures"]]


class ScoreGraphInterop(unittest.TestCase):
    def test_every_valid_fixture_reads_with_json_and_fraction_and_fits_its_measures(self):
        self.assertGreaterEqual(len(files()), 16)
        for f in files():
            with open(f, encoding="utf-8") as h:
                doc = json.load(h)
            self.assertEqual(doc["scoregraph_version"], 1)
            dur = {m["id"]: Fraction(m["dur"]) for m in doc["timeline"]["measures"]}
            by = defaultdict(list)
            for part in doc["parts"]:
                for e in part["events"]:
                    by[(e["m"], e["voice"])].append(e)
            for (m, v), evs in by.items():
                for e in evs:
                    self.assertLessEqual(Fraction(e["at"]) + Fraction(e["dur"]), dur[m], f"{os.path.basename(f)} {e['id']}")
            for perf in doc.get("performances", []):
                for n in perf["notes"]:
                    self.assertIsInstance(n["on"], int)
                    self.assertIsInstance(n["off"], int)

    def test_python_and_javascript_agree_on_every_measure_content_length(self):
        fs = files()
        out = subprocess.run([stages.node_binary(), "-e", JS, os.path.join(util.repo_root(), "scoregraph", "index.js")] + fs,
                             capture_output=True, check=True)
        js = json.loads(out.stdout.decode("utf-8"))
        for f in fs:
            with open(f, encoding="utf-8") as h:
                self.assertEqual(content_lengths(json.load(h)), js[f], os.path.basename(f))

    def test_a_rational_string_is_a_fraction_literal(self):
        for s, v in (("3/8", Fraction(3, 8)), ("0", Fraction(0)), ("-1/4", Fraction(-1, 4)), ("181/2", Fraction(181, 2))):
            self.assertEqual(Fraction(s), v)


if __name__ == "__main__":
    unittest.main()
