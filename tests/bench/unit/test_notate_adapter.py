import os
import tempfile
import unittest

from pppbench import stages, util


def notes(n=8):
    return [{"on": 1.0 + 0.5 * i, "off": 1.4 + 0.5 * i, "midi": 60 + (i % 5), "vel": 70} for i in range(n)]


class NotateAdapterTest(unittest.TestCase):
    def test_error_does_not_stop_the_batch_and_order_is_kept(self):
        jobs = [{"id": "a", "input": {"notes": notes(12), "pedals": []}, "opts": {"title": "t"}},
                {"id": "b", "input": {"notes": notes(3), "pedals": []}, "opts": {}},
                {"id": "c", "input": {"notes": notes(16), "pedals": []}, "opts": {}}]
        r = stages.notate_batch(jobs)
        self.assertEqual(list(r["results"]), ["a", "b", "c"])
        self.assertTrue(r["results"]["a"]["ok"])
        self.assertFalse(r["results"]["b"]["ok"])
        self.assertEqual(r["results"]["b"]["code"], "no-notes")
        self.assertTrue(r["results"]["c"]["ok"])
        self.assertIn("<score-partwise", r["results"]["a"]["xml"])
        self.assertIn("barStarts", r["results"]["a"]["stats"])

    def test_meta_names_the_sut_and_its_sha(self):
        r = stages.notate_batch([{"id": "a", "input": {"notes": notes(8), "pedals": []}}])
        meta = r["meta"]
        self.assertEqual(os.path.normcase(meta["audio_score_path"]), os.path.normcase(stages.default_audio_score()))
        self.assertEqual(meta["audio_score_sha256"], util.sha256_file(stages.default_audio_score()))
        self.assertTrue(meta["node"].startswith("v"))

    def test_audio_score_path_is_used(self):
        with tempfile.TemporaryDirectory() as tmp:
            fake = os.path.join(tmp, "fake-score.js")
            with open(fake, "w", encoding="utf-8") as h:
                h.write("module.exports = { toMusicXml: (i, o) => ({ xml: '<fake/>', stats: { n: i.notes.length } }) };\n")
            r = stages.notate_batch([{"id": "a", "input": {"notes": notes(8)}}], audio_score=fake)
            self.assertEqual(r["results"]["a"]["xml"], "<fake/>")
            self.assertEqual(r["results"]["a"]["stats"], {"n": 8})
            self.assertEqual(r["meta"]["audio_score_sha256"], util.sha256_file(fake))


if __name__ == "__main__":
    unittest.main()
