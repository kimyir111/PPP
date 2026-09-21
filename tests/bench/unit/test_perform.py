import os
import re
import unittest
from fractions import Fraction

from pppbench import corpus, perform, suite as suite_mod, util

from unit.helpers import canon, scale_melody


def ref(entry_id):
    e = corpus.by_id(corpus.load_corpus())[entry_id]
    return e, corpus.read_reference(e)


class PerformTest(unittest.TestCase):
    def test_deadpan_follows_the_time_map(self):
        c = canon(scale_melody(4), tempo=120)
        p = perform.perform(c, "unit/scale", "deadpan", "none", 1)
        start = 1.0 + 0.25 * (util.fnv1a32("unit/scale") % 5)
        self.assertEqual(p.start_s, start)
        # at 120 qpm a quarter is 0.5 s; deadpan releases 40 ms early
        rh = [n for n in p.input["notes"] if n["midi"] >= 60]
        self.assertEqual(rh[0]["on"], util.round_t(start))
        self.assertEqual(rh[1]["on"], util.round_t(start + 0.5))
        self.assertAlmostEqual(rh[0]["off"] - rh[0]["on"], 0.5 - 0.04, places=4)
        self.assertEqual(p.expected["bar_starts"][1], util.round_t(start + 2.0))
        self.assertEqual(p.expected["qpm"], 120.0)
        self.assertNotIn("beats", p.input)

    def test_same_case_same_bytes(self):
        e, c = ref("micro/M01-waltz-3-4")
        a = perform.perform(c, e.id, "amt", "oracle-noisy", 1, expect=e.expect)
        b = perform.perform(c, e.id, "amt", "oracle-noisy", 1, expect=e.expect)
        self.assertEqual(suite_mod.input_sha256(a.input, a.opts), suite_mod.input_sha256(b.input, b.opts))
        other = perform.perform(c, e.id, "amt", "oracle-noisy", 2, expect=e.expect)
        self.assertNotEqual(suite_mod.input_sha256(a.input, a.opts), suite_mod.input_sha256(other.input, other.opts))

    def test_rubato_keeps_the_average_tempo(self):
        e, c = ref("hymns/amazing-grace")
        flat = perform.TimeMap(c.end_q, 100, 1.0)
        rub = perform.TimeMap(c.end_q, 100, 1.0, drift=0.10, period=14)
        end = c.end_q
        ratio = (flat.sec(end) - 1.0) / (rub.sec(end) - 1.0)
        self.assertLess(abs(ratio - 1), 0.02)
        # and it really moves inside the piece
        self.assertGreater(max(abs(flat.sec(q) - rub.sec(q)) for q in range(0, int(end))), 0.05)

    def test_amt_drops_about_three_to_six_percent(self):
        played, dropped, ghosts, merged = 0, 0, 0, 0
        for rid in ("micro/M02-alberti-4-4", "micro/M17-march-2-4", "hymns/amazing-grace", "method/beyer/008"):
            e, c = ref(rid)
            for seed in range(1, 6):
                p = perform.perform(c, e.id, "amt", "none", seed, expect=e.expect)
                played += len(c.played())
                dropped += p.errors["dropped"]
                ghosts += p.errors["ghosts"]
                merged += p.errors["merged"]
                kept = {t["ref"] for t in p.truth if t["ref"] is not None}
                # a merge can swallow a real note or a ghost, so this is a bound
                self.assertLessEqual(len(kept), len(c.played()) - p.errors["dropped"])
                self.assertGreaterEqual(len(kept), len(c.played()) - p.errors["dropped"] - p.errors["merged"])
        self.assertGreater(dropped / played, 0.03)
        self.assertLess(dropped / played, 0.06)
        self.assertGreater(ghosts / played, 0.01)
        self.assertLess(ghosts / played, 0.03)
        self.assertGreater(merged, 0)
        p = perform.perform(c, e.id, "human", "none", 1, expect=e.expect)
        self.assertIsNone(p.errors)
        self.assertEqual(len(p.input["notes"]), len(c.played()))

    def test_oracle_tactus_count(self):
        e, c = ref("micro/M03-jig-6-8")   # 8 bars of 6/8: two dotted-quarter beats a bar
        p = perform.perform(c, e.id, "human", "oracle", 1, expect=e.expect)
        self.assertEqual(len(p.input["beats"]), 8 * 2 + 1)  # both ends of [0, end]
        self.assertEqual(len(p.input["downbeats"]), 8)
        self.assertEqual(p.input["beatConfidence"], 0.90)
        e, c = ref("micro/M07-pickup-3-4")  # quarter pickup + 8 bars of 3/4
        p = perform.perform(c, e.id, "human", "oracle", 1, expect=e.expect)
        self.assertEqual(len(p.input["beats"]), 1 + 8 * 3 + 1)
        self.assertEqual(len(p.input["downbeats"]), 8)
        self.assertEqual(perform.tactus_q((5, 8)), Fraction(1, 2))
        self.assertEqual(perform.tactus_q((2, 2)), 2)

    def test_lowconf_and_noisy_profiles(self):
        e, c = ref("micro/M02-alberti-4-4")
        low = perform.perform(c, e.id, "human", "lowconf", 1, expect=e.expect)
        self.assertEqual(low.input["beatConfidence"], 0.30)
        clean = perform.perform(c, e.id, "human", "oracle", 1, expect=e.expect)
        noisy = perform.perform(c, e.id, "human", "oracle-noisy", 1, expect=e.expect)
        self.assertLessEqual(len(noisy.input["beats"]), len(clean.input["beats"]))
        self.assertNotEqual(noisy.input["beats"][:5], clean.input["beats"][:5])

    def test_start_s_placeholder_in_options(self):
        e, c = ref("micro/M05-32nds-120")
        p = perform.perform(c, e.id, "deadpan", "none", 1, expect=e.expect,
                            case_opts={"lock": {"beats": 4, "firstDownbeat": "<start_s>"}}, opt_name="lock")
        self.assertEqual(p.opts["lock"]["firstDownbeat"], util.round_t(p.start_s))

    def test_generator_uses_no_libm_or_random(self):
        src = util.read_text(perform.__file__)
        code = "\n".join(l for l in src.splitlines() if not l.strip().startswith("#"))
        code = re.sub(r'"""[\s\S]*?"""', "", code)
        for bad in ("math.sin", "math.cos", "math.exp", "math.log", "math.pow", "import random", "random."):
            self.assertNotIn(bad, code, bad)


if __name__ == "__main__":
    unittest.main()
