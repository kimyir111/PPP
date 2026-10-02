"""The humanizer's profiles and overlays (G10a-0, docs/GOALS/G10 section 7.3): what each one does to a performance,
and that the original profiles are untouched."""

import unittest
from fractions import Fraction

from pppbench import calibration, corpus, humanize, perform, runner, suite as suite_mod, util

from unit.helpers import canon, scale_melody

FRAME = 0.032
REFS = ["method/czerny599/027", "method/hanon/004", "method/beyer/059", "hymns/amazing-grace", "micro/M01-waltz-3-4",
        "micro/M03-jig-6-8", "method/sonatina/025", "method/burgmuller25/013"]


def ref(rid):
    e = corpus.by_id(corpus.load_corpus())[rid]
    return e, corpus.read_reference(e)


def make(rid, profile, beats="none", seed=1):
    e, c = ref(rid)
    return c, perform.perform(c, rid, profile, beats, seed, expect=e.expect)


def on_frames(t, frame):
    return abs(t / frame - round(t / frame)) < 2e-3


class ProfileNames(unittest.TestCase):
    def test_parse(self):
        self.assertIsNone(humanize.parse("human"))
        self.assertIsNone(humanize.parse("human-alt"))
        self.assertEqual(humanize.parse("cover").overlays, ())
        self.assertEqual(humanize.parse("cover-pedal+of+helper").overlays, ("of", "helper"))
        self.assertEqual(humanize.parse("human-real").frame, 0.01)
        self.assertEqual(humanize.parse("cover").frame, FRAME)
        with self.assertRaises(KeyError):
            humanize.parse("cover+nonsense")

    def test_every_profile_runs(self):
        _, c = ref("micro/M01-waltz-3-4")
        for name in humanize.all_profiles():
            p = perform.perform(c, "micro/M01-waltz-3-4", name, "oracle-noisy", 1)
            self.assertGreater(len(p.input["notes"]), 20, name)
            self.assertIn("beats", p.input, name)


class OriginalProfilesAreUntouched(unittest.TestCase):
    def test_the_locks_of_the_existing_suites_still_hold(self):
        """smoke, core, robust and full are locked case by case (the sha256 of every generated input): the same
        inputs must come out of the generator that now also knows the humanizer."""
        for name in ("smoke", "core", "robust"):
            s = suite_mod.load_suite(name)
            _, rows, _ = runner.generate(s)
            lock = util.load_json(suite_mod.lock_path(s))
            self.assertEqual(suite_mod.verify_lock(s, rows, lock), [], name)

    def test_their_generator_version_is_unchanged(self):
        for name in ("smoke", "core", "robust", "full", "smoke-app", "core-app"):
            self.assertEqual(suite_mod.generator_version(suite_mod.load_suite(name)), "perform/2", name)
        self.assertEqual(suite_mod.generator_version({"matrix": [{"profile": "cover"}]}), "perform/2+humanize/1")
        self.assertEqual(suite_mod.generator_version({"matrix": [{"profile": "human"}, {"profile": "swing+of"}]}), "perform/2+humanize/1")


class CoverFamily(unittest.TestCase):
    def test_deterministic_and_seeded(self):
        a, b = make(REFS[0], "cover")[1], make(REFS[0], "cover")[1]
        self.assertEqual(suite_mod.input_sha256(a.input, a.opts), suite_mod.input_sha256(b.input, b.opts))
        c = make(REFS[0], "cover", seed=2)[1]
        self.assertNotEqual(suite_mod.input_sha256(a.input, a.opts), suite_mod.input_sha256(c.input, c.opts))

    def test_everything_sits_on_the_32_ms_clock(self):
        for rid in REFS[:4]:
            for n in make(rid, "cover")[1].input["notes"]:
                self.assertTrue(on_frames(n["on"], FRAME) and on_frames(n["off"], FRAME), (rid, n))

    def test_no_pedal_and_the_tempo_is_steady(self):
        c, p = make("hymns/amazing-grace", "cover")
        self.assertEqual(p.input["pedals"], [])
        bars = [p.timemap.sec(m.start_q) for m in c.measures if not m.implicit]
        d = [b - a for a, b in zip(bars, bars[1:])]
        self.assertLess((max(d) - min(d)) / (sum(d) / len(d)), 0.001)

    def test_chords_are_one_attack_never_spread_by_more_than_a_frame(self):
        c, p = make("hymns/amazing-grace", "cover")
        by_ref = {}
        for n, t in zip(p.input["notes"], p.truth):
            by_ref.setdefault(c.sounding[t["ref"]].onset_q, []).append(n["on"])
        spreads = [max(v) - min(v) for v in by_ref.values() if len(v) >= 2]
        self.assertTrue(spreads)
        self.assertLessEqual(max(spreads), FRAME + 1e-6)
        self.assertGreater(sum(1 for s in spreads if s > 1e-6), 0)          # some chords do split by a frame

    def test_a_note_is_never_held_through_the_next_strike_of_its_own_pitch(self):
        for rid in ("method/hanon/004", "hymns/amazing-grace", "micro/M23-repeated-notes"):
            _, p = make(rid, "cover")
            last = {}                       # pitch -> (onset, release) of the latest strike; a unison at one onset is fine
            for n in sorted(p.input["notes"], key=lambda n: (n["on"], n["off"])):
                if n["midi"] in last and last[n["midi"]][0] < n["on"] - 1e-6:
                    self.assertLessEqual(last[n["midi"]][1], n["on"] + 1e-6, (rid, n))
                last[n["midi"]] = (n["on"], n["off"])

    def test_notes_before_a_written_rest_are_articulated(self):
        """A note followed by a written rest in its hand ends before the rest does (written x 0.6-0.95)."""
        c, p = make("micro/M16-long-notes-rests", "cover")
        short = 0
        for n, t in zip(p.input["notes"], p.truth):
            written = t["nominal_off"] - t["nominal_on"]
            if n["off"] - n["on"] < 0.97 * written - FRAME:
                short += 1
        self.assertGreater(short, 0)

    def test_truth_carries_every_performed_note(self):
        c, p = make("hymns/amazing-grace", "cover")
        self.assertEqual(len(p.input["notes"]), len(c.played()))
        self.assertEqual(sorted(t["ref"] for t in p.truth), sorted(s.id for s in c.played()))


class CoverPedal(unittest.TestCase):
    def test_a_note_lasts_to_the_pedal(self):
        c, p = make("method/hanon/004", "cover-pedal")      # scales: no key is struck again while the pedal holds it
        self.assertGreater(len(p.input["pedals"]), 5)
        ends = {n["off"] for n in p.input["notes"]}
        up = {humanize._floor(s["off"] / FRAME + 0.5) * FRAME for s in p.input["pedals"]}
        # a clear majority of the notes end exactly where a pedal comes up (to the frame)
        hit = sum(1 for n in p.input["notes"] if any(abs(n["off"] - u) < 0.0015 or abs(n["off"] - u - FRAME) < 0.0015 for u in up))
        self.assertGreater(hit / len(p.input["notes"]), 0.5)
        self.assertEqual(ends, {round(e, 4) for e in ends})

    def test_it_overlaps_the_next_onset_more_than_cover(self):
        flats_c = calibration.humanize_pieces("cover", REFS[:4])
        flats_p = calibration.humanize_pieces("cover-pedal", REFS[:4])
        a, b = calibration.extract(flats_c, FRAME), calibration.extract(flats_p, FRAME)
        self.assertGreater(b["releasesByHand"]["RH"]["overlapsNextOnset"], a["releasesByHand"]["RH"]["overlapsNextOnset"])

    def test_no_pedal_is_pressed_after_the_last_attack_and_none_is_shorter_than_a_quarter_second(self):
        """A pedal that starts after the last note crashed the SUT's graph builder (E-SPAN-ORDER, found by rec-full on
        method/czerny599/001); a real performer has no reason to press it there, and the humanizer does not."""
        for prof in ("cover-pedal", "cover-pedal+helper"):
            _, p = make("method/czerny599/001", prof)
            last = max(n["on"] for n in p.input["notes"])
            self.assertTrue(p.input["pedals"], prof)
            for sp in p.input["pedals"]:
                self.assertLess(sp["on"], last, prof)
                self.assertGreater(sp["off"] - sp["on"], humanize.MIN_PEDAL_S, prof)


class HumanReal(unittest.TestCase):
    def test_finer_clock_and_drifting_tempo(self):
        c, p = make("hymns/amazing-grace", "human-real")
        for n in p.input["notes"]:
            self.assertTrue(on_frames(n["on"], 0.01) and on_frames(n["off"], 0.01), n)
        got = calibration.extract([calibration.flat_input(c, p)], 0.01)
        self.assertGreater(got["tempo"]["barDurCV"], 0.015)                # drift 3-6 % plus phrase-end ritardandi
        self.assertLess(got["tempo"]["barDurCV"], 0.15)

    def test_it_is_a_different_performer_from_cover(self):
        a = make("hymns/amazing-grace", "human-real")[1].input["notes"]
        b = make("hymns/amazing-grace", "cover")[1].input["notes"]
        self.assertNotEqual([n["on"] for n in a], [n["on"] for n in b])

    def test_the_last_beats_of_a_phrase_slow_down(self):
        c, p = make("method/czerny599/027", "human-real")
        tm = p.timemap
        bars = [m for m in c.measures if not m.implicit]
        self.assertGreater(len(bars), 4)
        end = bars[3].start_q + bars[3].len_q if len(bars) < 16 else bars[7].start_q + bars[7].len_q
        slow = tm.sec(end) - tm.sec(end - 1)           # the last beat of the first phrase
        mid = tm.sec(bars[1].start_q + 1) - tm.sec(bars[1].start_q)
        self.assertGreater(slow, mid * 1.02)


class Swing(unittest.TestCase):
    def test_off_beat_eighths_move_late_in_some_blocks_and_not_in_others(self):
        c = canon(scale_melody(16, dur=1, divisions=2, lh=False), tempo=120, divisions=2)
        p = perform.perform(c, "unit/swing", "swing", "none", 1)
        by_id = {s.id: s for s in c.played()}
        delay_by_bar = {}
        for n, t in zip(p.input["notes"], p.truth):
            s = by_id[t["ref"]]
            if (s.onset_q % 1) == Fraction(1, 2):
                delay_by_bar.setdefault(s.measure, []).append(n["on"] - p.timemap.sec(s.onset_q))
        means = {m: sum(v) / len(v) for m, v in delay_by_bar.items()}
        swung = [m for m, v in means.items() if v > 0.04]            # R 1.6-2 on a 0.5-s beat: +58 to +83 ms
        straight = [m for m, v in means.items() if v <= 0.04]
        self.assertTrue(swung and straight, means)
        self.assertEqual(len(swung) + len(straight), len(means), means)
        # swung in whole 4-bar blocks
        for b in range(0, 16, 4):
            kinds = {m in swung for m in means if b <= m - min(means) < b + 4}
            self.assertEqual(len(kinds), 1, (b, means))

    def test_the_downbeats_stay_where_they_were(self):
        c = canon(scale_melody(8, dur=1, divisions=2, lh=False), tempo=120, divisions=2)
        p = perform.perform(c, "unit/swing", "swing", "none", 1)
        by_id = {s.id: s for s in c.played()}
        for n, t in zip(p.input["notes"], p.truth):
            s = by_id[t["ref"]]
            if (s.onset_q % 1) == 0:
                self.assertLess(abs(n["on"] - p.timemap.sec(s.onset_q)), 0.1)      # only the clock's jitter and rounding


class OfOverlay(unittest.TestCase):
    def test_the_browser_model_errors(self):
        tot = dict(notes=0, dropped=0, ghosts=0, merged=0)
        base_notes = 0
        for rid in REFS[:6]:
            _, p = make(rid, "cover+of")
            _, q = make(rid, "cover")
            self.assertEqual(p.input["pedals"], [], rid)
            base_notes += len(q.input["notes"])
            for k in ("dropped", "ghosts", "merged"):
                tot[k] += p.errors[k]
            truth_refs = {t["ref"] for t in p.truth if t["ref"] is not None}
            base_refs = {t["ref"] for t in q.truth}
            self.assertTrue(truth_refs <= base_refs, rid)                   # the base performance is the same: only removals
        self.assertGreater(tot["dropped"], 0)
        self.assertGreater(tot["ghosts"], 0)
        self.assertLess(tot["dropped"] / base_notes, 0.08)
        self.assertLess(tot["ghosts"] / base_notes, 0.06)

    def test_ghosts_are_octaves_or_twelfths_with_no_written_note(self):
        _, p = make("method/hanon/004", "cover+of")
        _, q = make("method/hanon/004", "cover")
        base = {(n["on"], n["midi"]) for n in q.input["notes"]}
        ghosts = [n for n, t in zip(p.input["notes"], p.truth) if t["ref"] is None]
        self.assertTrue(ghosts)
        for n in ghosts:
            self.assertTrue(any(abs(n["on"] - on) < 0.0002 and n["midi"] - m in (12, 19) for on, m in base), n)
            self.assertLess(n["vel"], 50)

    def test_isolated_notes_shorter_than_55_ms_are_dropped_and_chord_mates_are_not(self):
        rng = util.Lcg(7)
        notes = [{"on": 1.0, "off": 1.032, "midi": 60, "vel": 70, "_truth": {"ref": 1}},          # lone, one frame: dropped
                 {"on": 2.0, "off": 2.032, "midi": 60, "vel": 70, "_truth": {"ref": 2}},          # chord mates: kept
                 {"on": 2.0, "off": 2.5, "midi": 64, "vel": 70, "_truth": {"ref": 3}},
                 {"on": 3.0, "off": 3.5, "midi": 67, "vel": 70, "_truth": {"ref": 4}}]            # lone, long: kept
        out, err = humanize.overlay_of(notes, rng, FRAME)
        refs = [n["_truth"]["ref"] for n in out if n["_truth"]["ref"] is not None]
        self.assertNotIn(1, refs)
        for kept in (2, 3, 4):
            self.assertIn(kept, refs)
        self.assertGreaterEqual(err["dropped"], 1)

    def test_a_repeated_note_one_frame_after_the_release_can_merge(self):
        notes = [{"on": 1.0 + 0.2 * i, "off": 1.0 + 0.2 * i + 0.168, "midi": 60, "vel": 70, "_truth": {"ref": i}} for i in range(200)]
        out, err = humanize.overlay_of(notes, util.Lcg(5), FRAME)
        self.assertGreater(err["merged"], 10)                                  # ~20 % of 199 pairs, minus ghosts
        self.assertLess(err["merged"], 80)


class CoverAlt(unittest.TestCase):
    """The independent family of the robust suite: not calibrated, early-release-heavy, triangular jitter, flat velocity."""

    def test_it_is_a_different_performer_on_the_same_clock(self):
        for n in make("method/czerny599/027", "cover-alt")[1].input["notes"]:
            self.assertTrue(on_frames(n["on"], FRAME) and on_frames(n["off"], FRAME), n)
        a = calibration.extract(calibration.humanize_pieces("cover-alt", REFS[:4]), FRAME)
        b = calibration.extract(calibration.humanize_pieces("cover", REFS[:4]), FRAME)
        self.assertGreater(a["releasesByHand"]["RH"]["releasedBeforeNextOnset"], b["releasesByHand"]["RH"]["releasedBeforeNextOnset"] + 0.15)
        self.assertGreater(a["velocity"]["sd"], b["velocity"]["sd"] + 2.0)             # no voicing but a wider noise
        self.assertAlmostEqual(a["velocity"]["mean"], 70.0, delta=2.0)
        self.assertEqual(a["chords"]["spreadMoreThanOneFrame"], 0)

    def test_its_jitter_is_triangular_not_normal(self):
        """Two uniforms averaged never reach the tails a normal would (here: no onset more than 60 ms + 1.5 frames from its place)."""
        c, p = make("method/hanon/004", "cover-alt")
        worst = max(abs(n["on"] - t["nominal_on"]) for n, t in zip(p.input["notes"], p.truth))
        self.assertLessEqual(worst, 0.060 + 1.5 * FRAME + 1e-6)          # the jitter, the rounding to a frame and a chord's frame


class HelperOverlay(unittest.TestCase):
    def test_the_measured_helper_errors(self):
        on_err, off_err, base, missed, extra = [], [], 0, 0, 0
        invented, truth_pedal_marker = 0, 0
        for rid in REFS:
            c, p = make(rid, "cover+helper")
            q = make(rid, "cover")[1]
            base += len(q.input["notes"])
            missed += p.errors["dropped"]
            extra += p.errors["ghosts"]
            invented += len(p.input["pedals"]) > 0
            truth_pedal_marker += p.has_truth_pedals and p.truth_pedals == []
            clean = {t["ref"]: n for n, t in zip(q.input["notes"], q.truth)}
            for n, t in zip(p.input["notes"], p.truth):
                if t["ref"] is not None:
                    on_err.append(n["on"] - clean[t["ref"]]["on"])
                    off_err.append(n["off"] - clean[t["ref"]]["off"])
        mean = sum(on_err) / len(on_err)
        sd = (sum((e - mean) ** 2 for e in on_err) / len(on_err)) ** 0.5
        self.assertAlmostEqual(mean, 0.009, delta=0.002)               # +9 ms
        self.assertAlmostEqual(sd, 0.0029, delta=0.001)                # sd 2.9 ms (before the 0.1-ms rounding)
        off_err.sort()
        self.assertAlmostEqual(off_err[len(off_err) // 2], 0.012, delta=0.012)
        self.assertAlmostEqual(missed / base, 0.019, delta=0.01)
        self.assertAlmostEqual(extra / base, 0.033, delta=0.012)
        self.assertEqual(truth_pedal_marker, len(REFS))                  # the true pedal is stated: there was none
        self.assertGreater(invented, 0)                                  # but the helper invents one in most pieces
        self.assertLess(invented, len(REFS) + 1)

    def test_the_truth_pedals_of_a_pedaled_performance_are_the_real_ones(self):
        c, p = make("method/czerny599/027", "cover-pedal+helper")
        self.assertTrue(p.has_truth_pedals)
        self.assertGreater(len(p.truth_pedals), 5)                       # what was played; p.input["pedals"] is the guess
        self.assertNotEqual(p.truth_pedals, p.input["pedals"])

    def test_a_suite_with_the_overlay_is_scored_against_the_real_pedal(self):
        """The runner hands evaluate_timed the performer's own pedal when the input's is a guess."""
        import inspect
        self.assertIn("truth_pedals", inspect.getsource(runner.run_suite))


if __name__ == "__main__":
    unittest.main()
