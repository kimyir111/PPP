import os
import subprocess
import sys
import unittest
from fractions import Fraction

from pppbench import util

RUN = os.path.join(util.bench_root(), "run.py")


class UtilTest(unittest.TestCase):
    def test_lcg_matches_transcription_test_rng(self):
        # node: rng(7) from tests/transcription.test.js, first five values
        expected = [0.23878083983436227, 0.9134932646993548, 0.6124916663393378,
                    0.9269814591389149, 0.049341175239533186]
        r = util.Lcg(7)
        self.assertEqual([r.next() for _ in range(5)], expected)

    def test_fnv1a32(self):
        self.assertEqual(util.fnv1a32("abc"), 0x1A47E90B)
        self.assertEqual(util.fnv1a32(""), 2166136261)

    def test_round_t(self):
        self.assertEqual(util.round_t(1.23456), 1.2346)
        self.assertEqual(util.round_t(1.00004), 1.0)
        self.assertEqual(util.round_t(2.00005), 2.0001)

    def test_dump_json_is_deterministic_and_rejects_nan(self):
        text = util.dumps_json({"b": Fraction(1, 3), "a": [1.0000004, -0.0], "k": "한글"})
        self.assertEqual(text, '{\n "a": [\n  1.0,\n  0.0\n ],\n "b": 0.333333,\n "k": "한글"\n}\n')
        with self.assertRaises(ValueError):
            util.dumps_json({"x": float("nan")})
        with self.assertRaises(ValueError):
            util.dumps_json([float("inf")])

    def test_cli_prints_korean_on_a_cp949_console(self):
        env = {k: v for k, v in os.environ.items() if k not in ("PYTHONIOENCODING", "PYTHONUTF8")}
        out = subprocess.run([sys.executable, RUN, "list"], env=env, capture_output=True)
        self.assertEqual(out.returncode, 0, out.stderr.decode("utf-8", "replace"))
        text = out.stdout.decode("utf-8")
        self.assertIn("smoke", text)
        self.assertIn("찬송가", text)  # a Korean line, printed without PYTHONIOENCODING


if __name__ == "__main__":
    unittest.main()
