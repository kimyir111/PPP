"""omr-live-2: the Node half (tests/omr/node/*.test.js: PPP's print engraver B and the SVG sizing). The gate has no step of its own for it, so
the unit tests run it: Node is on every runner (the gate sets it up), and the test needs nothing else (no Chrome, no network)."""

import os
import shutil
import subprocess
import unittest

from pppbench import util

NODE_TESTS = os.path.join(util.repo_root(), "tests", "omr", "node")


@unittest.skipUnless(shutil.which("node"), "node is not installed")
class NodeHalf(unittest.TestCase):
    def test_ppp_print_and_raster_helpers(self):
        files = sorted(f for f in os.listdir(NODE_TESTS) if f.endswith(".test.js"))
        self.assertTrue(files)
        r = subprocess.run([shutil.which("node"), "--test", *[os.path.join(NODE_TESTS, f) for f in files]],
                           capture_output=True, timeout=300, cwd=util.repo_root())
        out = (r.stdout + r.stderr).decode("utf-8", "replace")
        self.assertEqual(r.returncode, 0, out[-3000:])
        self.assertIn("fail 0", out)


if __name__ == "__main__":
    unittest.main()
