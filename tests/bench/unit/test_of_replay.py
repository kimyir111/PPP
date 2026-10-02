"""The real-AMT runner's Python halves and the replay-of suite (G10a-0 step 5); the page run itself is a manual refresh."""

import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import unittest

from pppbench import corpus, private, suite as suite_mod, util

TOOLS = os.path.join(util.bench_root(), "tools")
sys.path.insert(0, TOOLS)
import of_prepare  # noqa: E402

HAVE_NUMPY = importlib.util.find_spec("numpy") is not None


class Prepare(unittest.TestCase):
    def test_case_ids_and_keys_are_stable(self):
        cid = of_prepare.case_id("method/hanon/004", "cover-pedal", 1)
        self.assertEqual(cid, "replay/method/hanon/004|salamander-v2|cover-pedal|s1|of")
        self.assertEqual(suite_mod.case_key(cid), suite_mod.case_key(of_prepare.case_id("method/hanon/004", "cover-pedal", 1)))

    def test_pick_refs_is_deterministic_short_and_licence_clean(self):
        class A:
            refs, n, max_seconds, profile, seed = None, 6, 45.0, "cover-pedal", 1
        a, b = of_prepare.pick_refs(A), of_prepare.pick_refs(A)
        self.assertEqual(a, b)
        self.assertEqual(len(a), 6)
        by = corpus.by_id(corpus.load_corpus())
        for rid in a:
            self.assertIn(rid, by)
            self.assertFalse(rid.startswith("micro/"))
            self.assertFalse(by[rid].holdout, rid)

    def test_assemble_writes_notes_only_fixtures(self):
        with tempfile.TemporaryDirectory() as tmp:
            rid = "method/hanon/004"
            cid = of_prepare.case_id(rid, "cover-pedal", 1)
            key = suite_mod.case_key(cid)
            manifest = {"schema": "ppp.of-replay-manifest/1", "pieces": [{
                "id": cid, "key": key, "reference": rid, "reference_sha256": "abc", "wav": os.path.join(tmp, key + ".wav"),
                "profile": "cover-pedal", "seed": 1, "room": True, "qpm": 108.0, "start_s": 1.0, "bar_starts_s": [1.0, 3.2],
                "truth_notes": [{"midi": 60, "on": 1.0, "off": 1.5, "ref_sounding_id": 0}], "pedals_used": [{"on": 1.05, "off": 3.18}]}]}
            util.dump_json(manifest, os.path.join(tmp, "manifest.json"))
            result = {"helper_result": {"engine": "onsets-and-frames", "qualityTier": "browser-fallback", "truncated": False, "duration": 3.0,
                                        "notes": [{"on": 1.0000000002, "off": 1.4960000001, "midi": 60, "vel": 71}]},
                      "seconds": 12.5, "model": "m"}
            util.dump_json(result, os.path.join(tmp, key + ".result.json"))
            out = os.path.join(tmp, "replay-of")
            args = type("A", (), {"dir": tmp, "replay_dir": out})
            self.assertEqual(of_prepare.assemble(args), 0)
            fx = util.load_json(os.path.join(out, key + ".json"))
            self.assertEqual(fx["schema"], "ppp.replay-case/1")
            self.assertEqual(fx["helper_result"]["engine"], "onsets-and-frames")
            self.assertEqual(fx["helper_result"]["notes"], [{"on": 1.0, "off": 1.496, "midi": 60, "vel": 71}])
            self.assertIsNone(fx["truth"]["pedals"])                         # not scored: O&F writes none and no reference marks it
            self.assertEqual(fx["truth"]["pedals_used"], [{"on": 1.05, "off": 3.18}])
            self.assertNotIn("wav", json.dumps(fx).lower().replace("render_piano", ""))   # no audio path, no audio
            self.assertEqual(fx["provenance"]["seconds"], 12.5)

    def test_a_replay_suite_can_name_its_fixture_directory(self):
        """replay-of reads tests/bench/replay-of; replay-public (no `dir`) is unchanged."""
        s = suite_mod.load_suite("replay-of")
        self.assertEqual((s["kind"], s["fixtures"], s["dir"]), ("replay", "replay", "replay-of"))
        public = suite_mod.load_suite("replay-public")
        self.assertNotIn("dir", public)
        self.assertEqual(s["gate"], public["gate"])
        pub_ids = {c["id"] for c in private.load_cases(public)}
        of_ids = {c["id"] for c in private.load_cases(s)}
        self.assertEqual(len(pub_ids), 6)
        self.assertFalse(pub_ids & of_ids)

    def test_replay_of_app_runs_the_same_fixtures_with_the_apps_options(self):
        a, b = suite_mod.load_suite("replay-of"), suite_mod.load_suite("replay-of-app")
        self.assertEqual((b["dir"], b["fixtures"], b["kind"], b["gate"]), (a["dir"], a["fixtures"], a["kind"], a["gate"]))
        self.assertEqual(b["stage"]["opts"], {"closeGaps": True, "exactBars": True})
        self.assertNotIn("stage", a)                                            # replay-public and replay-of: the library default
        self.assertNotIn("stage", suite_mod.load_suite("replay-public"))
        self.assertEqual({c["id"] for c in private.load_cases(a)}, {c["id"] for c in private.load_cases(b)})

    def test_the_runner_script_parses(self):
        r = subprocess.run(["node", "--check", os.path.join(TOOLS, "of_replay.js")], capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stderr)


@unittest.skipUnless(HAVE_NUMPY, "render_piano.py needs numpy (the transcribe venv has it)")
class Render(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import render_piano
        cls.rp = render_piano

    def test_a_note_lasts_to_the_pedal_that_holds_it(self):
        pedals = [{"on": 1.0, "off": 3.0}, {"on": 3.5, "off": 4.0}]
        self.assertEqual(self.rp.sounding_end(2.0, pedals), 3.0)
        self.assertEqual(self.rp.sounding_end(3.2, pedals), 3.2)              # between the spans: the damper was down
        self.assertEqual(self.rp.sounding_end(0.5, pedals), 0.5)
        self.assertEqual(self.rp.sounding_end(2.0, None), 2.0)
        self.assertEqual(self.rp.sounding_end(2.0, []), 2.0)

    def test_the_room_is_deterministic_and_normalised(self):
        a, b = self.rp.room_ir(), self.rp.room_ir()
        self.assertTrue((a == b).all())
        self.assertAlmostEqual(float((a ** 2).sum()), 1.0, places=6)
        self.assertEqual(len(a), int(self.rp.ROOM_SECONDS * self.rp.SR))

    def test_the_default_render_path_is_unchanged(self):
        """No pedals and no room: the same samples as render_piano.py/1 (the six committed fixtures were made with it)."""
        import numpy as np
        table = self.rp.sample_table()
        notes = [{"on": 0.1, "off": 0.6, "midi": 60, "vel": 70}, {"on": 0.4, "off": 1.0, "midi": 64, "vel": 80}]
        a = self.rp.render(notes, table)
        b = self.rp.render(notes, table, pedals=None, room=False)
        self.assertTrue(np.array_equal(a, b))
        pedalled = self.rp.render(notes, table, pedals=[{"on": 0.0, "off": 2.0}])
        self.assertGreater(len(pedalled), len(a) - 1)
        self.assertFalse(np.array_equal(a[: min(len(a), len(pedalled))], pedalled[: min(len(a), len(pedalled))]))


if __name__ == "__main__":
    unittest.main()
