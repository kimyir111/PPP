import argparse
import io
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from contextlib import redirect_stdout

from pppbench import legacy, private, suite as suite_mod, util

ROOT = util.repo_root()


class Legacy(unittest.TestCase):
    def test_same_note_metrics_as_golden_benchmark(self):
        manifest = os.path.join(ROOT, "tests", "golden", "manifest.example.json")
        old = subprocess.run([sys.executable, os.path.join(ROOT, "tests", "golden_benchmark.py"), manifest],
                             capture_output=True, env=dict(os.environ, PYTHONIOENCODING="utf-8"))
        self.assertEqual(old.returncode, 0, old.stderr)
        old_case = json.loads(old.stdout.decode("utf-8"))["cases"][0]
        new_case = legacy.run_manifest(manifest)["cases"][0]
        for k in ("reference_notes", "predicted_notes", "matched_notes", "precision", "recall", "f1", "offset_f1", "pedal_iou"):
            self.assertEqual(new_case["metrics"][k], old_case["metrics"][k], k)
        # the unit is named for what it is (docs/GOALS/G00 §2 P6)
        self.assertEqual(new_case["unit"], "quarter-beats")
        self.assertEqual(new_case["metrics"]["onset_tolerance_quarter"], 0.05)
        self.assertNotIn("onset_tolerance_ms", new_case["metrics"])

    def test_same_note_metrics_on_different_files(self):
        # §17 m8: the example manifest compares a file with itself (F1 1.0); these pairs are a reference
        # and a real toMusicXml output of it (pickup, ties, hymn ties with no stop), and a reference
        # with grace notes against the same music without them
        bench = util.bench_root()
        with tempfile.TemporaryDirectory() as tmp:
            grace = util.read_text(os.path.join(bench, "corpus", "correctness", "C07-grace.musicxml"))
            import re
            no_grace = os.path.join(tmp, "C07-no-grace.musicxml")
            with open(no_grace, "w", encoding="utf-8", newline="\n") as h:
                h.write(re.sub(r"<note>(?:(?!</note>).)*<grace/>(?:(?!</note>).)*</note>", "", grace, flags=re.S))
            pairs = [(os.path.join(bench, "corpus", "micro", "M07-pickup-3-4.musicxml"), os.path.join(bench, "golden", "expected", "G05.musicxml")),
                     (os.path.join(bench, "corpus", "micro", "M09-syncopation-ties.musicxml"), os.path.join(bench, "golden", "expected", "G06.musicxml")),
                     (os.path.join(ROOT, "catalog", "hymns", "all-hail-the-power.musicxml"), os.path.join(bench, "golden", "expected", "G11.musicxml")),
                     (os.path.join(bench, "corpus", "correctness", "C07-grace.musicxml"), no_grace)]
            man = os.path.join(tmp, "manifest.json")
            util.dump_json({"cases": [{"name": f"pair-{i}", "reference": r, "prediction": p} for i, (r, p) in enumerate(pairs)]}, man)
            old = subprocess.run([sys.executable, os.path.join(ROOT, "tests", "golden_benchmark.py"), man],
                                 capture_output=True, env=dict(os.environ, PYTHONIOENCODING="utf-8"))
            self.assertIn(old.returncode, (0, 1), old.stderr)       # 1: a case below its minF1, which is fine here
            old_cases = json.loads(old.stdout.decode("utf-8"))["cases"]
            new_cases = legacy.run_manifest(man)["cases"]
        self.assertEqual(len(old_cases), len(pairs))
        f1s = []
        for o, n in zip(old_cases, new_cases):
            for k in ("reference_notes", "predicted_notes", "matched_notes", "precision", "recall", "f1", "offset_f1", "pedal_iou"):
                self.assertEqual(n["metrics"][k], o["metrics"][k], f"{o.get('name')}: {k}")
            f1s.append(o["metrics"]["f1"])
        self.assertTrue(any(f < 1.0 for f in f1s), f1s)                # not a set of trivial self-matches

    def test_private_manifest_keeps_output_outside_the_repository(self):
        with tempfile.TemporaryDirectory() as tmp:
            man = os.path.join(tmp, "manifest.json")
            util.dump_json({"cases": [{"name": "x", "reference": os.path.join(ROOT, "samples", "prelude-fragment.musicxml"),
                                       "prediction": os.path.join(ROOT, "samples", "prelude-fragment.musicxml")}]}, man)
            args = argparse.Namespace(manifest=man, out=os.path.join(util.bench_root(), "out", "leak.json"))
            with redirect_stdout(io.StringIO()):
                self.assertEqual(legacy.cli_legacy(args), 2)
                self.assertEqual(legacy.cli_legacy(argparse.Namespace(manifest=man, out=None)), 0)
            self.assertTrue(os.path.exists(os.path.join(tmp, "out", "legacy-results.json")))


class PrivateSuite(unittest.TestCase):
    def test_prediction_file_case_and_output_location(self):
        with tempfile.TemporaryDirectory() as tmp:
            shutil.copy(os.path.join(ROOT, "samples", "prelude-fragment.musicxml"), os.path.join(tmp, "ref.musicxml"))
            text = util.read_text(os.path.join(tmp, "ref.musicxml"))
            # a "recognised" copy with one wrong pitch
            util.write_bytes(os.path.join(tmp, "pred.musicxml"), (text.replace("<step>D</step>", "<step>E</step>", 1)).encode("utf-8"))
            util.dump_json({"schema": "ppp.bench-suite/1", "name": "private-t", "kind": "prediction-file",
                            "cases": [{"id": "p1", "reference": "ref.musicxml", "prediction": "pred.musicxml"},
                                      {"id": "p0", "reference": "ref.musicxml", "prediction": "ref.musicxml"}]},
                           os.path.join(tmp, "suite.json"))
            s = suite_mod.load_suite(os.path.join(tmp, "suite.json"))
            self.assertTrue(suite_mod.is_private(s))
            args = argparse.Namespace(audio_score=None, out=None)
            with redirect_stdout(io.StringIO()):
                self.assertEqual(private.run_private(s, args), 0)
            res = util.load_json(os.path.join(tmp, "out", "private-t", "results.json"))
            by = {c["id"]: c for c in res["cases"]}
            self.assertEqual(by["p0"]["metrics"]["notes.symbolic.f1"], 1.0)
            self.assertLess(by["p1"]["metrics"]["notes.symbolic.f1"], 1.0)
            self.assertEqual(by["p0"]["metrics"]["omr.measure_alignment_rate"], 1.0)
            with redirect_stdout(io.StringIO()):
                self.assertEqual(private.run_private(s, argparse.Namespace(audio_score=None,
                                 out=os.path.join(util.bench_root(), "out", "leak"))), 2)

    def test_replay_suite_without_fixtures_is_skipped(self):
        s = suite_mod.load_suite("replay-public")
        buf = io.StringIO()
        with redirect_stdout(buf):
            code = private.run_private(s, argparse.Namespace(audio_score=None, out=None))
        if not os.listdir(private.REPLAY_DIR):
            self.assertEqual(code, 0)
            self.assertIn("SKIPPED", buf.getvalue())


if __name__ == "__main__":
    unittest.main()
