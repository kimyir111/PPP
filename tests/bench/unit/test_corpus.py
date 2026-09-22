import io
import os
import sys
from contextlib import redirect_stdout
import unittest

from pppbench import corpus, musicxml, util
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

    def test_octave_shift_scores_are_measured_not_hidden(self):
        # §17 M9: they are references again, read the MusicXML way, tagged, and the app's different
        # reading is a known failure; only a missing licence or broken bars keep a score out
        ex = util.load_json(corpus.EXCLUDED)["excluded"]
        self.assertEqual({x["rule"] for x in ex} - {"L6", "L8", "P1"}, set())
        ids = {r.id for r in self.refs}
        self.assertFalse(ids & {x["id"] for x in ex})
        ottava = [r for r in self.refs if corpus.read_reference(r).diagnostics.get("octave_shift")]
        self.assertGreaterEqual(len(ottava), 19)
        for r in ottava:
            c = corpus.read_reference(r)
            self.assertIn("feature:ottava", corpus.derived_tags(r, c))
            self.assertEqual(c.diagnostics["ottava_mode"], "standard")
        app = musicxml.read_score(ottava[0].abspath, ottava="app")
        std = corpus.read_reference(ottava[0])
        self.assertGreater(app.diagnostics["ottava_shifted_notes"], 0)
        self.assertNotEqual([n.midi for n in app.notes], [n.midi for n in std.notes])

    def test_every_reference_has_repository_licence_evidence(self):
        # §17 M10: the manifest is rebuilt from repository evidence only; untrusted files are quarantined
        sys.path.insert(0, os.path.join(util.bench_root(), "tools"))
        import make_provenance
        with redirect_stdout(io.StringIO()):
            self.assertEqual(make_provenance.main(["--check"]), 0)
        prov = corpus.provenance()
        for r in self.refs:
            self.assertTrue(prov[r.id]["trusted"], r.id)
            self.assertTrue(prov[r.id]["evidence"] or prov[r.id]["license_status"] == "generated", r.id)
            if "PDMX" in r.license:
                self.assertFalse(prov[r.id]["transcribed_by_ppp"], r.id)
        quarantined = {x["id"] for x in util.load_json(corpus.EXCLUDED)["excluded"] if x["rule"] == "P1"}
        self.assertEqual(quarantined, {i for i, e in prov.items() if not e["trusted"]})
        self.assertIn("method/czerny299/010", quarantined)       # no <rights>, generic book claim only
        self.assertIn("method/burgmuller25/004", quarantined)    # a Mutopia id without a licence
        self.assertEqual(prov["method/burgmuller25/016"]["transcribed_by_ppp"], True)

    def test_lint_flags_a_file_whose_tempo_marks_disagree(self):
        rules = {(i.rule, i.ref) for i in corpus.lint(self.refs)}
        self.assertIn(("L13", "method/hanon/001"), rules)

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
