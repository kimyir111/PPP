import io
import os
import sys
from contextlib import redirect_stdout
import unittest

from pppbench import corpus, util
from unit.helpers import canon, measure, note

sys.path.insert(0, os.path.join(util.bench_root(), "tools"))
import make_micro  # noqa: E402


class CorpusRegistry(unittest.TestCase):
    def setUp(self):
        self.refs = corpus.load_corpus()

    def test_registry_is_clean(self):
        errors = [i for i in corpus.lint(self.refs) if i.level == "error"]
        self.assertEqual(errors, [])
        self.assertGreaterEqual(len(self.refs), 150)
        self.assertEqual(sum(1 for r in self.refs if r.set == "micro"), 24)
        self.assertTrue(all(r.license.strip() for r in self.refs))

    def test_octave_shift_files_are_excluded_with_a_reason(self):
        ex = util.load_json(corpus.EXCLUDED)["excluded"]
        l5 = [x for x in ex if x["rule"] == "L5"]
        self.assertGreater(len(l5), 20)
        self.assertTrue(all("octave-shift" in x["reason"] for x in l5))
        ids = {r.id for r in self.refs}
        self.assertFalse(ids & {x["id"] for x in ex})

    def test_micro_files_match_their_generator(self):
        with redirect_stdout(io.StringIO()):
            self.assertEqual(make_micro.main(["--check"]), 0)

    def test_micro_scores_read_as_written(self):
        by = corpus.by_id(self.refs)
        for piece, extra in make_micro.build():
            exp = make_micro.expectations(piece, extra)
            c = corpus.read_reference(by["micro/" + piece.id])
            self.assertEqual(list(c.primary_time()), exp["time"], piece.id)
            self.assertEqual(c.measures[0].fifths, exp["key"]["fifths"], piece.id)
            self.assertEqual(c.measures[0].mode, exp["key"]["mode"], piece.id)
            self.assertEqual(c.effective_qpm, exp["tempo_qpm"], piece.id)
            self.assertEqual(c.printed_qpm, exp["tempo_qpm"], piece.id)   # metronome and sound agree
            self.assertEqual(len(c.measures), exp["measures"], piece.id)
            self.assertEqual(c.diagnostics["bar_integrity"]["bad"], [], piece.id)

    def test_lint_catches_edits_and_missing_licence(self):
        e = corpus.by_id(self.refs)["micro/M01-waltz-3-4"]
        bad = corpus.RefEntry(id=e.id, path=e.path, sha256="0" * 64, set="micro", license=" ")
        rules = {i.rule for i in corpus.lint([bad, bad])}
        self.assertTrue({"L2", "L10", "L11"} <= rules)
        untracked = corpus.RefEntry(id="x", path=e.path, sha256=e.sha256, set="nope", license="CC0")
        rules = {i.rule for i in corpus.lint([untracked], tracked=set())}
        self.assertTrue({"L1", "L11"} <= rules)

    def test_key_signature_defect_is_detected(self):
        # G major signature, F written without its sharp: the file's own pitches ignore the signature
        c = canon([measure(note("F", 4, 1) * 4, number=1), measure(note("F", 5, 4), number=2)], fifths=1)
        self.assertTrue(corpus.keysig_contradicted(c))
        ok = canon([measure(note("F", 4, 1, alter=1) * 4, number=1)], fifths=1)
        self.assertFalse(corpus.keysig_contradicted(ok))
        for e in self.refs:
            if e.set == "hymns" and corpus.keysig_contradicted(corpus.read_reference(e)):
                self.assertTrue(set(corpus.KEY_METRICS) <= set(e.expect.get("skip_metrics", [])), e.id)

    def test_tags(self):
        by = corpus.by_id(self.refs)
        e = by["micro/M07-pickup-3-4"]
        tags = corpus.derived_tags(e, corpus.read_reference(e))
        for t in ("set:micro", "metre:3/4", "metre-class:simple-triple", "key:-1", "mode:major", "feature:pickup", "size:s"):
            self.assertIn(t, tags)
        e = by["micro/M04-triplets-4-4"]
        self.assertIn("feature:tuplets", corpus.derived_tags(e, corpus.read_reference(e)))
        e = by["micro/M24-block-chords"]
        tags = corpus.derived_tags(e, corpus.read_reference(e))
        self.assertIn("feature:low-information", tags)
        self.assertIn("feature:dense-chords", tags)
        e = by["micro/M06-32nds-176"]
        self.assertIn("feature:fast-runs", corpus.derived_tags(e, corpus.read_reference(e)))
        e = by["micro/M22-tempo-change"]
        self.assertIn("feature:tempo-change", corpus.derived_tags(e, corpus.read_reference(e)))
        self.assertEqual(corpus.metre_class((6, 8)), "compound-duple")
        self.assertEqual(corpus.metre_class((5, 4)), "irregular")
        self.assertEqual(corpus.metre_class((3, 8)), "compound-single")

    def test_crlf_checkout_gives_the_same_pin(self):
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            a, b = os.path.join(tmp, "a.xml"), os.path.join(tmp, "b.xml")
            util.write_bytes(a, b"<x>\n<y/>\n</x>\n")
            util.write_bytes(b, b"<x>\r\n<y/>\r\n</x>\r\n")
            self.assertEqual(util.content_sha256(a), util.content_sha256(b))


if __name__ == "__main__":
    unittest.main()
