/* Shared fixtures of the lead sheet tests (tests/rec/leadsheet.test.js, leadsheet-mutation.test.js): a synthetic 4/4 cover with a known tune, converted by the app's v2 path. */
'use strict';
const path = require('path');
const { REPO, lcg } = require('./helpers.js');
const AS = require(path.join(REPO, 'audio-score.js'));

const OPTS = { title: 't', closeGaps: true, exactBars: true, recording: 'v2' };

/* A 4/4 cover at 100 quarters a minute: a melody of quarter notes (given per bar), a bass note on beats 1 and 3 and a chord of the right hand under the melody on every beat.
   `melodyOf(bar, beat)` -> midi or null (a rest of the melody). Returns { notes, melody } with melody = the heard notes (on, midi) that ARE the tune.
   opts: qpm, seed, chord (false: no chord under the tune), melodyLen (the tune's notes last this part of a beat; default 0.9), shift (semitones: the whole cover, tune included, moved) */
function cover(bars, melodyOf, opts) {
  opts = opts || {};
  const spq = 60 / (opts.qpm || 100), start = 1, rnd = lcg(opts.seed || 7);
  const notes = [], melody = [];
  const roots = [48, 53, 55, 48].map(r => r + (opts.shift || 0));
  const len = opts.melodyLen || 0.9;
  for (let b = 0; b < bars; b++) {
    const root = roots[b % roots.length];
    for (let k = 0; k < 4; k++) {
      const t = Math.round((start + (b * 4 + k) * spq + (rnd() * 2 - 1) * 0.01) * 1000) / 1000;
      const off = Math.round((t + spq * 0.9) * 1000) / 1000;
      if (k % 2 === 0) notes.push({ on: t, off: Math.round((t + spq * 1.9) * 1000) / 1000, midi: root - 12, vel: 56 });      /* bass */
      if (opts.chord !== false) { notes.push({ on: t, off: off, midi: root + 4, vel: 50 }, { on: t, off: off, midi: root + 7, vel: 50 }); } /* chord under the tune */
      const m = melodyOf(b, k);
      if (m !== null && m !== undefined) {
        const n = { on: t, off: Math.round((t + spq * len) * 1000) / 1000, midi: m + (opts.shift || 0), vel: 78 };
        notes.push(n); melody.push(n);
      }
    }
  }
  notes.sort((a, c) => a.on - c.on || a.midi - c.midi);
  return { notes: notes, melody: melody };
}
const SCALE = [72, 74, 76, 77, 79, 77, 76, 74];
const tune = (b, k) => SCALE[(b * 4 + k) % SCALE.length];

/* the head ids of the graph that are the heard notes `melody` (by onset and pitch, through the performance layer's links) */
function headsOf(g, melody) {
  const want = new Set(melody.map(n => Math.round(n.on * 1e6) + '|' + n.midi));
  const out = new Set();
  g.performances[0].notes.forEach(pn => { if (want.has(pn.on + '|' + pn.midi) && pn.link) out.add(pn.link); });
  return out;
}
function convert(c) { return AS.toMusicXml({ notes: c.notes }, OPTS).graph; }
const f1 = (got, truth) => {
  const hit = got.filter(h => truth.has(h)).length;
  const p = got.length ? hit / got.length : 0, r = truth.size ? hit / truth.size : 0;
  return { p: p, r: r, f1: p + r ? 2 * p * r / (p + r) : 0 };
};

module.exports = { OPTS, cover, SCALE, tune, headsOf, convert, f1 };
