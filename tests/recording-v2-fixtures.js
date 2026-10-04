/* Heard-note fixtures for the app's v2 tests (G10a-4): deterministic (a seeded LCG, no Math.random), made of nothing but numbers - no recording, no copyrighted notes.
   Each returns { notes: [{on, off, midi, vel}], pedals?: [{on, off}] } in seconds, the shape the browser's transcription gives the page. */
'use strict';

function lcg(seed) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}
const r3 = x => Math.round(x * 1000) / 1000;
function sorted(notes) { return notes.sort((a, b) => a.on - b.on || a.midi - b.midi); }

/* 4/4 at 100 quarters a minute. Beat 1: six notes (sixteenth triplets: 3:2 over a half beat, twice); beat 2: two eighths; beat 3: six again; beat 4: a quarter. A quarter in the bass on every beat.
   The sextuplet runs are what a v2 graph writes as 3:2 brackets of 16ths over half beats. */
function sextuplets(bars, seed) {
  const rnd = lcg(seed || 7), spq = 60 / 100, notes = [];
  const run = [72, 74, 76, 77, 79, 77], run2 = [79, 77, 76, 74, 72, 71];
  for (let b = 0; b < bars; b++) {
    const t0 = 1 + b * 4 * spq, j = () => (rnd() * 2 - 1) * 0.008;
    for (let k = 0; k < 6; k++) notes.push({ on: r3(t0 + k * spq / 6 + j()), off: r3(t0 + (k + 0.8) * spq / 6), midi: run[k] + (b % 2), vel: 70 });
    notes.push({ on: r3(t0 + spq + j()), off: r3(t0 + spq * 1.45), midi: 76, vel: 64 }, { on: r3(t0 + spq * 1.5 + j()), off: r3(t0 + spq * 1.95), midi: 74, vel: 64 });
    for (let k = 0; k < 6; k++) notes.push({ on: r3(t0 + 2 * spq + k * spq / 6 + j()), off: r3(t0 + 2 * spq + (k + 0.8) * spq / 6), midi: run2[k], vel: 70 });
    notes.push({ on: r3(t0 + 3 * spq + j()), off: r3(t0 + 3.9 * spq), midi: 72, vel: 66 });
    for (let k = 0; k < 4; k++) notes.push({ on: r3(t0 + k * spq + j()), off: r3(t0 + (k + 0.9) * spq), midi: 48 + (k % 2) * 7, vel: 60 });
  }
  return { notes: sorted(notes) };
}

/* 4/4 at 120: a bass half note per bar and a melody of quarters over the major scale of each section's tonic; sections = [[bars, tonic pitch class], ...] (the key-change test's performer) */
function keyChange(sections, seed, jitter) {
  const rnd = lcg(seed || 3), jit = jitter || 0, MAJOR = [0, 2, 4, 5, 7, 9, 11], deg = [0, 2, 4, 2, 5, 4, 2, 1, 0, 4, 2, 0, 6, 4, 1, 0], notes = [];
  let bar = 0;
  sections.forEach(([bars, tonic]) => {
    for (let b = 0; b < bars; b++, bar++) {
      const t0 = 1 + bar * 2, bassDeg = [0, 3, 4, 0][b % 4], j = () => (rnd() * 2 - 1) * jit;
      notes.push({ on: r3(t0 + j()), off: r3(t0 + 0.95), midi: 36 + tonic + MAJOR[bassDeg], vel: 80 });
      notes.push({ on: r3(t0 + 1 + j()), off: r3(t0 + 1.9), midi: 48 + tonic + MAJOR[bassDeg], vel: 60 });
      for (let k = 0; k < 4; k++) notes.push({ on: r3(t0 + k * 0.5 + j()), off: r3(t0 + k * 0.5 + 0.45), midi: 60 + tonic + MAJOR[deg[(b * 4 + k) % deg.length]], vel: 70 });
    }
  });
  return { notes: sorted(notes), bars: bar };
}

/* 4/4 at 120 from 1 s: per bar a bass half note, a chord on beat 3 and a melody of quarters; `sustain` pedals every bar and every note struck under it rings to the pedal's lift
   (the pedal's mechanism: the policy keeps a pedal the notes agree with) */
function pedalPiece(bars, sustain) {
  const notes = [], pedals = [];
  for (let b = 0; b < bars; b++) {
    const t0 = 1 + b * 2, up = t0 + 1.98;
    if (sustain) pedals.push({ on: t0 + 0.05, off: up });
    const end = (on, len) => (sustain && on >= t0 + 0.05 ? up : on + len);
    notes.push({ on: t0, off: end(t0, 0.9), midi: 48, vel: 80 });
    notes.push({ on: t0 + 1, off: end(t0 + 1, 0.45), midi: 55, vel: 70 });
    [64, 67, 72, 67].forEach((m, k) => notes.push({ on: t0 + k * 0.5, off: end(t0 + k * 0.5, 0.45), midi: m, vel: 70 }));
  }
  return { notes: sorted(notes), pedals: pedals };
}

/* a performance of a score the page has already parsed (its notes as {abs quarter onset, dur quarters, midi}): each note held `hold` of its length, seeded timing noise; for the hymns' four-part writing */
function performanceOf(list, qpm, seed, hold) {
  const rnd = lcg(seed || 11), spq = 60 / qpm;
  return sorted(list.map(n => {
    const on = 0.5 + n.abs * spq + (rnd() * 2 - 1) * 0.01;
    return { on: r3(on), off: r3(on + Math.max(0.12, n.dur * spq * (hold || 0.9))), midi: n.midi, vel: 60 + Math.round(rnd() * 12) };
  }));
}

module.exports = { lcg, sextuplets, keyChange, pedalPiece, performanceOf };
