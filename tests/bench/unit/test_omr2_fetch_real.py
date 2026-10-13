"""omr-live-2: the real-scan fetch script (tests/omr/omrbench/fetch_real.py, tests/omr/real-scan.json). Only its pure half is tested, offline, on
answers written here in the shape the hosts use: the script's licence rules must refuse everything that is not plainly public domain, and it
must not touch the network without --allow-network. The gate never downloads anything."""

import contextlib
import copy
import io
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import omr2_synth  # noqa: E402,F401
from omrbench import fetch_real as F  # noqa: E402

GOOD = {
    "id": "beyer-op101-peters-1895", "source": "commons", "title": "File:Beyer Vorschule Op101.pdf",
    "url": "https://upload.wikimedia.org/wikipedia/commons/a/ab/Beyer_Vorschule_Op101.pdf", "sha256": "ab" * 32,
    "licence": "Public domain (author died 1883)", "licence_evidence": "https://commons.wikimedia.org/wiki/File:Beyer_Vorschule_Op101.pdf",
    "edition": "Peters, Leipzig 1895", "work": "method/beyer", "pages": [{"pdf_page": 12, "piece": "method/beyer/012", "bars": [1, 8]}],
}


def doc(*entries):
    return {"schema": F.SCHEMA, "entries": list(entries)}


def commons(licence="Public domain", copyrighted="False", title="File:Beyer Vorschule Op101.pdf"):
    return {"query": {"pages": {"123": {"title": title, "imageinfo": [{"url": GOOD["url"], "sha1": "x", "size": 1, "extmetadata": {
        "LicenseShortName": {"value": licence}, "Copyrighted": {"value": copyrighted}}}]}}}}


class Manifest(unittest.TestCase):
    def test_the_committed_manifest_is_well_formed(self):
        d = F.load_manifest()
        self.assertEqual(F.check_manifest(d), [])
        self.assertEqual(d["entries"], [], "no file's licence has been read on its host yet: the list stays empty until someone has")

    def test_a_good_entry_passes(self):
        self.assertEqual(F.check_manifest(doc(GOOD)), [])

    def test_each_missing_field_is_a_problem(self):
        for k in F.NEEDED:
            e = copy.deepcopy(GOOD)
            del e[k]
            self.assertTrue(any(k in p for p in F.check_manifest(doc(e))), k)

    def test_only_https_urls_on_the_allow_list(self):
        for url in ("http://upload.wikimedia.org/x.pdf", "https://example.com/x.pdf", "https://upload.wikimedia.org.evil.example/x.pdf",
                    "ftp://upload.wikimedia.org/x.pdf", "file:///etc/passwd"):
            e = dict(GOOD, url=url)
            self.assertTrue(F.check_manifest(doc(e)), url)
        self.assertEqual(F.check_manifest(doc(dict(GOOD, source="imslp", url="https://ks4.imslp.net/files/imglnks/usimg/x.pdf"))), [])
        self.assertTrue(F.check_manifest(doc(dict(GOOD, source="imslp"))), "a Commons host is not an IMSLP host")

    def test_sha256_pages_ids_and_source(self):
        self.assertTrue(F.check_manifest(doc(dict(GOOD, sha256="xyz"))))
        self.assertTrue(F.check_manifest(doc(dict(GOOD, sha256="AB" * 32))))
        self.assertTrue(F.check_manifest(doc(GOOD, GOOD)), "duplicate id")
        self.assertTrue(F.check_manifest(doc(dict(GOOD, source="flickr"))))
        self.assertTrue(F.check_manifest(doc(dict(GOOD, pages=[{"pdf_page": 0, "piece": "p", "bars": [1, 8]}]))))
        self.assertTrue(F.check_manifest(doc(dict(GOOD, pages=[{"pdf_page": 1, "piece": "p", "bars": [8, 1]}]))))
        self.assertTrue(F.check_manifest(doc(dict(GOOD, licence_evidence="http://insecure.example/x"))))
        self.assertTrue(F.check_manifest({"schema": "other", "entries": []}))


class Licence(unittest.TestCase):
    def test_commons_public_domain_is_accepted(self):
        for name in ("Public domain", "PD-old-70", "PD-US", "PD-self", "CC0", "Creative Commons Zero"):
            ok, why = F.commons_licence_ok(commons(name), GOOD["title"])
            self.assertTrue(ok, name)

    def test_everything_else_is_refused(self):
        for name in ("CC BY-SA 4.0", "CC BY 3.0", "GFDL", "Attribution", "Fair use", "", "Copyrighted free use", "pdf"):
            self.assertFalse(F.commons_licence_ok(commons(name), GOOD["title"])[0], name)
        self.assertFalse(F.commons_licence_ok(commons("Public domain", copyrighted="True"), GOOD["title"])[0])
        self.assertFalse(F.commons_licence_ok(commons("Public domain", copyrighted=""), GOOD["title"])[0])

    def test_an_answer_that_cannot_be_read_or_is_about_another_file_is_a_refusal(self):
        for bad in ({}, {"query": {}}, {"query": {"pages": {"-1": {"title": "File:x.pdf", "missing": ""}}}}, "text", None):
            self.assertFalse(F.commons_licence_ok(bad, GOOD["title"])[0])
        self.assertFalse(F.commons_licence_ok(commons(title="File:Another.pdf"), GOOD["title"])[0])

    def test_imslp_needs_the_status_public_domain_on_the_page(self):
        self.assertTrue(F.imslp_licence_ok("<td>Copyright Status</td><td>Public Domain</td>")[0])
        self.assertEqual(F.imslp_licence_ok("<b>Copyright Status:</b> Public Domain (Canada)"), (True, "Public Domain"))
        self.assertFalse(F.imslp_licence_ok("<b>Copyright Status:</b> Copyright")[0])
        self.assertFalse(F.imslp_licence_ok("<b>Copyright Status:</b> Creative Commons Attribution 4.0")[0])
        self.assertFalse(F.imslp_licence_ok("nothing about it")[0])
        self.assertFalse(F.imslp_licence_ok("")[0])

    def test_the_hash_is_a_sha256(self):
        self.assertEqual(F.sha256_bytes(b""), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855")


class NoNetworkByDefault(unittest.TestCase):
    def test_http_get_refuses_without_the_flag_and_for_non_https(self):
        with self.assertRaises(RuntimeError):
            F.http_get("https://upload.wikimedia.org/x.pdf", False)
        with self.assertRaises(RuntimeError):
            F.http_get("http://upload.wikimedia.org/x.pdf", True)

    def test_verify_with_the_network_off_refuses_and_downloads_nothing(self):
        ok, why = F.verify_entry(GOOD, False)
        self.assertFalse(ok)
        self.assertIn("network", why)
        ok, why = F.verify_entry(dict(GOOD, source="imslp"), False)
        self.assertFalse(ok)

    def test_the_command_line_check_is_offline_and_exits_zero_on_the_empty_manifest(self):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            self.assertEqual(F.main(["--check"]), 0)
            self.assertEqual(F.main(["--fetch"]), 0, "an empty manifest has nothing to fetch")
        self.assertIn("0 entries", out.getvalue())

    def test_a_folder_that_is_not_git_ignored_is_refused(self):
        import tempfile
        with tempfile.TemporaryDirectory(dir=os.path.dirname(F.HERE)) as d:      # a folder under tests/, not under tests/omr/out/
            with self.assertRaises(RuntimeError):
                F.ensure_ignored(d)
        F.ensure_ignored(F.DEFAULT_OUT)


if __name__ == "__main__":
    unittest.main()
