"""G1: the SUT is a snapshot of audio-score.js and the scoregraph/ library beside it (docs/GOALS/G01 §15.4).

Before G1 the bench copied and hashed audio-score.js alone. Once audio-score.js requires ./scoregraph/,
that is not the whole SUT: an A/B against a revision would run the working tree's library on both sides,
a mutant copied alone would not find its library, and `check` would call results fresh after a library
edit. These tests plant exactly those failures in a throwaway SUT (a tiny audio-score.js that writes its
XML through a scoregraph/ module) and require the bench to see them (A38, A39).
"""

import os
import subprocess
import tempfile
import unittest

from pppbench import compare, mutation, runner, stages, suite as suite_mod, sut as sut_mod, util

ENTRY_JS = """'use strict';
const SG = require('./scoregraph/index.js');
module.exports = { toMusicXml: (input, opts) => ({ xml: SG.write(input.notes.length), stats: { n: input.notes.length } }) };
"""
INDEX_JS = """'use strict';
const note = require('./sub/note.js');
module.exports = { write: n => '<score-partwise>' + note.repeat(n) + '</score-partwise>' };
"""
NOTE_JS = "module.exports = { repeat: n => '<note/>'.repeat(n) };\n"


def notes(n=8):
    return [{"on": 1.0 + 0.5 * i, "off": 1.4 + 0.5 * i, "midi": 60 + (i % 5), "vel": 70} for i in range(n)]


def write(root, rel, text):
    path = os.path.join(root, *rel.split("/"))
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as handle:
        handle.write(text)
    return path


def make_sut(root):
    write(root, "scoregraph/index.js", INDEX_JS)
    write(root, "scoregraph/sub/note.js", NOTE_JS)
    write(root, "scoregraph/README.md", "not code\n")
    return write(root, "audio-score.js", ENTRY_JS)


def notate(entry, n=3):
    return stages.notate_batch([{"id": "a", "input": {"notes": notes(n)}}], audio_score=entry)


class SnapshotIdentity(unittest.TestCase):
    def test_files_are_the_entry_and_every_library_module(self):
        with tempfile.TemporaryDirectory() as tmp:
            entry = make_sut(tmp)
            self.assertEqual(sut_mod.sut_files(entry),
                             ["audio-score.js", "scoregraph/index.js", "scoregraph/sub/note.js"])

    def test_sha_depends_on_every_library_module_and_not_on_docs(self):
        with tempfile.TemporaryDirectory() as tmp:
            entry = make_sut(tmp)
            h0 = sut_mod.sut_sha256(entry)
            write(tmp, "scoregraph/README.md", "edited docs\n")
            self.assertEqual(sut_mod.sut_sha256(entry), h0)
            write(tmp, "scoregraph/sub/note.js", NOTE_JS.replace("<note/>", "<rest/>"))
            h1 = sut_mod.sut_sha256(entry)
            self.assertNotEqual(h1, h0)
            write(tmp, "scoregraph/extra.js", "module.exports = 1;\n")
            self.assertNotEqual(sut_mod.sut_sha256(entry), h1)

    def test_sha_reads_crlf_as_lf(self):
        with tempfile.TemporaryDirectory() as a, tempfile.TemporaryDirectory() as b:
            ea, eb = make_sut(a), make_sut(b)
            with open(os.path.join(b, "scoregraph", "index.js"), "wb") as handle:
                handle.write(INDEX_JS.replace("\n", "\r\n").encode("utf-8"))
            self.assertEqual(sut_mod.sut_sha256(ea), sut_mod.sut_sha256(eb))

    def test_a_sut_without_the_library_is_just_its_entry(self):
        with tempfile.TemporaryDirectory() as tmp:
            entry = write(tmp, "audio-score.js", "module.exports = {};\n")
            self.assertEqual(sut_mod.sut_files(entry), ["audio-score.js"])


class LibraryChangesAreObserved(unittest.TestCase):
    """The regression that matters: a change inside scoregraph/ must reach the bench's output."""

    def test_notate_loads_the_suts_own_library_and_reports_the_closure(self):
        with tempfile.TemporaryDirectory() as tmp:
            r = notate(make_sut(tmp))
            self.assertEqual(r["results"]["a"]["xml"], "<score-partwise>" + "<note/>" * 3 + "</score-partwise>")
            self.assertEqual(r["meta"]["sut_modules"],
                             ["audio-score.js", "scoregraph/index.js", "scoregraph/sub/note.js"])
            self.assertEqual(r["meta"]["sut_outside"], [])

    def test_a_mutant_of_a_library_module_changes_the_output_and_leaves_the_original(self):
        with tempfile.TemporaryDirectory() as tmp, tempfile.TemporaryDirectory() as out:
            entry = make_sut(tmp)
            before = notate(entry)["results"]["a"]["xml"]
            mutant = sut_mod.write_mutant_dir(os.path.join(out, "M"),
                                              {"scoregraph/sub/note.js": [("'<note/>'", "'<rest/>'")]}, entry=entry)
            self.assertEqual(sut_mod.sut_files(mutant), sut_mod.sut_files(entry))
            after = notate(mutant)["results"]["a"]["xml"]
            self.assertNotEqual(after, before)
            self.assertIn("<rest/>", after)
            self.assertEqual(notate(entry)["results"]["a"]["xml"], before)   # the original is untouched
            self.assertNotEqual(sut_mod.sut_sha256(mutant), sut_mod.sut_sha256(entry))

    def test_an_ab_between_revisions_that_differ_only_in_the_library_sees_the_change(self):
        with tempfile.TemporaryDirectory() as repo, tempfile.TemporaryDirectory() as cache:
            def git(*args):
                subprocess.run(["git", *args], cwd=repo, check=True, capture_output=True)
            git("init", "-q")
            git("config", "user.email", "bench@example.invalid")
            git("config", "user.name", "bench")
            git("config", "core.autocrlf", "false")
            make_sut(repo)
            git("add", ".")
            git("commit", "-q", "-m", "one")
            write(repo, "scoregraph/sub/note.js", NOTE_JS.replace("<note/>", "<chord/>"))
            git("commit", "-q", "-am", "library only")
            a = sut_mod.extract_git("HEAD~1", os.path.join(cache, "a"), repo=repo)
            b = sut_mod.extract_git("HEAD", os.path.join(cache, "b"), repo=repo)
            self.assertEqual(sut_mod.sut_files(a), ["audio-score.js", "scoregraph/index.js", "scoregraph/sub/note.js"])
            xa, xb = notate(a)["results"]["a"]["xml"], notate(b)["results"]["a"]["xml"]
            self.assertIn("<note/>", xa)
            self.assertIn("<chord/>", xb)
            self.assertNotEqual(sut_mod.sut_sha256(a), sut_mod.sut_sha256(b))
            # extracting again into a used directory leaves no file of the earlier extraction behind
            write(os.path.join(cache, "a"), "scoregraph/stale.js", "module.exports = 0;\n")
            sut_mod.extract_git("HEAD~1", os.path.join(cache, "a"), repo=repo)
            self.assertNotIn("scoregraph/stale.js", sut_mod.sut_files(a))


class ClosureGuard(unittest.TestCase):
    def test_a_module_outside_the_sut_directory_is_refused(self):
        with tempfile.TemporaryDirectory() as tmp:
            write(tmp, "outside.js", "module.exports = { write: n => '<x/>' };\n")
            entry = write(tmp, "sut/audio-score.js", "const O = require('../outside.js');\n"
                          "module.exports = { toMusicXml: () => ({ xml: O.write(1), stats: {} }) };\n")
            with self.assertRaises(stages.StageError) as e:
                notate(entry)
            self.assertIn("SUT_MODULE_OUTSIDE", str(e.exception))

    def test_a_module_the_snapshot_does_not_hold_is_refused(self):
        with tempfile.TemporaryDirectory() as tmp:
            write(tmp, "helper.js", "module.exports = { write: n => '<x/>' };\n")
            entry = write(tmp, "audio-score.js", "const H = require('./helper.js');\n"
                          "module.exports = { toMusicXml: () => ({ xml: H.write(1), stats: {} }) };\n")
            with self.assertRaises(stages.StageError) as e:
                notate(entry)
            self.assertIn("SUT_MODULE_UNDECLARED", str(e.exception))


class RepositorySut(unittest.TestCase):
    def test_resolve_git_head_rebuilds_heads_snapshot(self):
        entry = runner.resolve_sut("git:HEAD", "unit-head")
        self.assertEqual(os.path.basename(entry), "audio-score.js")
        files = sut_mod.sut_files(entry)
        self.assertEqual(files, sut_mod.git_sut_files("HEAD"))
        root = os.path.dirname(entry)
        for rel in files:
            with open(os.path.join(root, *rel.split("/")), "rb") as handle:
                self.assertEqual(util.normalise_eol(handle.read()).decode("utf-8"), util.git("show", f"HEAD:{rel}"), rel)

    def test_a_mutation_check_mutant_is_a_whole_snapshot(self):
        noop = mutation.MUTATIONS[-1]
        path = mutation.write_mutant(noop, stages.default_audio_score())
        self.assertEqual(os.path.dirname(path), os.path.join(mutation.MUT_DIR, noop["id"]))
        self.assertEqual(sut_mod.sut_files(path), sut_mod.sut_files(stages.default_audio_score()))

    def test_a_mutation_on_a_file_outside_the_sut_is_an_anchor_error(self):
        bad = {"id": "UNIT-NOT-A-SUT-FILE", "file": "server.js", "find": "x", "replace": "y",
               "expect": "REGRESSION", "metrics": []}
        with self.assertRaises(mutation.AnchorMissing):
            mutation.write_mutant(bad, stages.default_audio_score())

    def test_run_json_records_the_snapshot_and_its_closure(self):
        smoke = suite_mod.load_suite("smoke")
        with tempfile.TemporaryDirectory() as out:
            r = runner.run_suite(smoke, out_dir=out, filter_="micro/M01-waltz-3-4|deadpan|none|s1",
                                 write_cases=False, quiet=True)
            run = util.load_json(os.path.join(out, "run.json"))
        entry = stages.default_audio_score()
        self.assertEqual(run["sut_sha256"], sut_mod.sut_sha256(entry))
        self.assertEqual(run["sut_files"], sut_mod.sut_files(entry))
        self.assertIn("audio-score.js", run["sut_modules"])
        self.assertTrue(set(run["sut_modules"]) <= set(run["sut_files"]))
        self.assertEqual(r["run"]["audio_score_sha256"], util.content_sha256(entry))   # the G0 field is kept

    def test_check_calls_results_stale_after_a_library_edit(self):
        with tempfile.TemporaryDirectory() as tmp:
            entry = make_sut(tmp)
            run = {"audio_score_path": entry, "audio_score_sha256": util.content_sha256(entry),
                   "sut_sha256": sut_mod.sut_sha256(entry)}
            self.assertIsNone(compare.stale_reason(run))
            write(tmp, "scoregraph/index.js", INDEX_JS + "// edited\n")
            self.assertIn("snapshot", compare.stale_reason(run))
            self.assertIsNone(compare.stale_reason({k: v for k, v in run.items() if k != "sut_sha256"}))  # a G0 run.json


if __name__ == "__main__":
    unittest.main()
