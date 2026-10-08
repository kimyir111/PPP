"""omr-live-2: the degradations (tests/omr/omrbench/degrade.py). The parameters and the seed rule are plain data and are tested everywhere; the
pixel half needs NumPy and OpenCV, which the CI runners do not have (the gate installs nothing), so it runs where they are installed."""

import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import omr2_synth  # noqa: E402,F401  (puts tests/omr on sys.path)
from omrbench import degrade as D  # noqa: E402


class Parameters(unittest.TestCase):
    def test_the_measured_parameters_of_the_design_document(self):
        p = D.PHOTO
        self.assertEqual((p["perspective"], p["rotation_deg"], p["blur_sigma"], p["noise_sigma"]), (0.025, 1.5, 1.1, 6.0))
        self.assertEqual((p["light_x"], p["light_y"]), ((1.0, 0.75), (0.95, 1.0)))
        self.assertEqual((p["height_px"], p["jpeg_quality"]), (3000, 70))
        self.assertEqual(D.SCAN150, {"factor": 2, "jpeg_quality": 60})

    def test_the_seed_is_a_function_of_the_engraver_and_the_page(self):
        self.assertEqual([D.seed_for("A", n) for n in (1, 2, 3)], [1001, 1003, 1005], "the design document's seeds")
        self.assertEqual(D.seed_for("B", 1), 1501)
        self.assertEqual(D.seed_for("A", 2), D.seed_for("A", 2))
        self.assertNotEqual(D.seed_for("A", 1), D.seed_for("B", 1))
        for bad in (("C", 1), ("A", 0)):
            with self.assertRaises(ValueError):
                D.seed_for(*bad)

    def test_describe_is_stable_json_data(self):
        import json
        d = D.describe()
        self.assertEqual(json.loads(json.dumps(d)), d)
        self.assertEqual(d["seed_rule"], "base + 2*page - 1")

    def test_versions_name_the_tools_or_say_missing(self):
        v = D.versions()
        self.assertEqual(set(v), {"numpy", "opencv"})
        self.assertEqual(D.available(), "missing" not in v.values())

    def test_a_bad_variant_is_refused_before_anything_is_read(self):
        with self.assertRaises(ValueError):
            D.degrade_file("nonexistent.png", "clean", "A", 1)


@unittest.skipUnless(D.available(), "NumPy and OpenCV are not installed (the CI runners have neither: a local test)")
class Pixels(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import numpy as np
        rng = np.random.default_rng(7)
        img = np.full((350, 248, 3), 255, np.uint8)
        for y in range(40, 300, 40):                   # five "staff lines" and some blobs, so the warps have something to move
            img[y:y + 2, 20:230] = 0
        img[rng.integers(0, 350, 50), rng.integers(0, 248, 50)] = 0
        cls.img = img

    def test_a_photo_is_the_same_picture_for_the_same_seed_and_another_for_another(self):
        a = D.photo_array(self.img, 1001)
        b = D.photo_array(self.img, 1001)
        c = D.photo_array(self.img, 1003)
        self.assertTrue((a == b).all())
        self.assertFalse(a.shape == c.shape and (a == c).all())

    def test_a_photo_is_3000_px_tall_darker_on_one_side_and_noisy(self):
        a = D.photo_array(self.img, 1001)
        self.assertEqual(a.shape[0], 3000)
        self.assertEqual(a.shape[2], 3)
        mid = a.shape[0] // 2
        left, right = a[mid - 30:mid + 30, 100:300].mean(), a[mid - 30:mid + 30, -300:-100].mean()
        self.assertGreater(left, right + 15, "the light falls from 1.0 to 0.75 across the page")

    def test_a_scan_is_half_size_and_grey(self):
        s = D.scan_array(self.img)
        self.assertEqual(s.shape, (175, 124))

    def test_jpeg_bytes_are_deterministic(self):
        a = D.jpeg_bytes(D.photo_array(self.img, 1001), 70)
        b = D.jpeg_bytes(D.photo_array(self.img, 1001), 70)
        self.assertEqual(a, b)
        self.assertEqual(a[:2], b"\xff\xd8")

    def test_degrade_file_reads_a_png_and_gives_jpeg_bytes(self):
        import tempfile
        import cv2
        with tempfile.TemporaryDirectory() as d:
            p = os.path.join(d, "clean-p1.png")
            cv2.imwrite(p, self.img)
            for v in ("photo", "scan"):
                data, ext = D.degrade_file(p, v, "A", 1)
                self.assertEqual(ext, ".jpg")
                self.assertEqual(data[:2], b"\xff\xd8")
            self.assertEqual(D.degrade_file(p, "photo", "A", 1)[0], D.degrade_file(p, "photo", "A", 1)[0])


if __name__ == "__main__":
    unittest.main()
