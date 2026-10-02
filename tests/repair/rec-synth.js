'use strict';
/* Seeded random recordings for the recording-notation tests and the proof's fuzz (docs/GOALS/G09 section 12): both hands, a 16th grid with jitter, triplet beats, rests, chords, held notes, and
   now and then a run of 32nds (slow tempi). A heard release is a fraction (0.5 to 1) of the written length plus 40 ms: the key-up noise a recording has (never a pedal-long tail).
   Not a test file (the runner globs *.test.js). */
/* ---- seeded random recordings: both hands, a 16th grid with jitter, triplet beats, rests, chords, held notes, now and then a run of 32nds (slow tempi) */
function rng(seed) { let s = seed >>> 0 || 1; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
function recording(seed, opts) {
  opts = opts || {};
  const rnd = rng(seed);
  const bpm = opts.bpm || (60 + Math.floor(rnd() * 110));
  const spb = 60 / bpm, bars = opts.bars || 12;
  const notes = [];
  const jitter = () => (rnd() - 0.5) * (opts.jitter || 0.03);
  const add = (t, len, midi, vel) => notes.push({ on: Math.max(0, t + jitter()), off: Math.max(0, t + len * (0.5 + 0.5 * rnd())) + 0.04, midi: midi, vel: vel || 70 + Math.floor(rnd() * 40) });
  for (let b = 0; b < bars; b++) {
    for (let beat = 0; beat < 4; beat++) {
      const t0 = (b * 4 + beat) * spb;
      const kind = rnd();
      /* left hand */
      const lh = 36 + Math.floor(rnd() * 14);
      if (kind < 0.25) { [0, 1 / 3, 2 / 3].forEach((f, i) => add(t0 + f * spb, spb / 3, lh + 7 * i)); }
      else if (kind < 0.75) { [0, 0.25, 0.5, 0.75].forEach((f, i) => { if (rnd() < 0.9) add(t0 + f * spb, spb / 4, lh + [0, 7, 12, 7][i]); }); }
      else if (kind < 0.9) { add(t0, spb * (0.5 + rnd() * 0.5), lh); }
      /* right hand: a rest, a plain run, a triplet, a held note, a 32nd run */
      const r = rnd(), m0 = 64 + Math.floor(rnd() * 20);
      if (r < 0.25) { /* rest */ }
      else if (r < 0.45) { [0, 1 / 3, 2 / 3].forEach((f, i) => { if (rnd() < 0.85) add(t0 + f * spb, spb / 3, m0 + i * 2); }); }
      else if (r < 0.6) { add(t0 + spb / 3, spb / 3, m0); add(t0 + 2 * spb / 3, spb / 3, m0 + 2); }
      else if (r < 0.8) { [0, 0.25, 0.5, 0.75].forEach((f, i) => { if (rnd() < 0.9) add(t0 + f * spb, spb / 4, m0 + i); }); }
      else if (r < 0.88 && opts.runs) { for (let i = 0; i < 8; i++) add(t0 + i * spb / 8, spb / 8, m0 + (i % 4) * 2); }
      else if (r < 0.95) { add(t0, spb * (0.7 + rnd() * 0.3), m0, 90); if (rnd() < 0.5) add(t0, spb * 0.8, m0 + 4, 80); }
      else { add(t0 + 0.5 * spb, spb / 2, m0); }
    }
  }
  return { notes: notes, bpm: bpm };
}

module.exports = { rng, recording };
