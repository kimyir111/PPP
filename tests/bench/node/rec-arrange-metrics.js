/* G10c-0: the pure part of the rec-arrange metrics (tests/bench/node/rec-arrange.js): note lists in, numbers out. No graph, no module of the system under
   test, so tests/bench/node/rec-arrange.test.js can feed it hand-made notes.

   A note is {q0, q1, midi, staff (0 = the upper staff, the melody hand; 1 = the lower), tieStop}: quarter notes. */
'use strict';

const TOL_Q = 0.15;               /* a note of the arrangement and the position it is looked for at: positions are copied, so this is the same slack the G9 melody metrics use */
const EPS = 1e-6;
const C6 = 84;

function indexNotes(notes) {
  const onsets = notes.filter(n => !n.tieStop);
  const byMidi = new Map();
  onsets.forEach(n => { if (!byMidi.has(n.midi)) byMidi.set(n.midi, []); byMidi.get(n.midi).push(n); });
  return { all: notes, onsets, byMidi };
}
const hasOnset = (ix, midi, q, staff) => (ix.byMidi.get(midi) || []).some(n => n.staff === staff && Math.abs(n.q0 - q) <= TOL_Q);
const sounds = (ix, q, staff) => ix.all.some(n => n.staff === staff && n.q0 <= q + EPS && q < n.q1 - EPS);

/* melodyAt: [{q, midi}], the true melody notes at the positions the recording graph has them. Shares of those notes: kept (same pitch, upper staff), cross (only in the
   lower staff), lost (nowhere), gap_rate (the upper staff sounds nothing at the onset, whatever else it has). null with no melody. */
function melodyStats(ix, melodyAt) {
  if (!melodyAt.length) return null;
  let kept = 0, cross = 0, lost = 0, gap = 0;
  melodyAt.forEach(m => {
    const inUp = hasOnset(ix, m.midi, m.q, 0), inLow = hasOnset(ix, m.midi, m.q, 1);
    if (inUp) kept++; else if (inLow) cross++; else lost++;
    if (!sounds(ix, m.q, 0)) gap++;
  });
  const n = melodyAt.length;
  return { kept: kept / n, cross: cross / n, lost: lost / n, gap_rate: gap / n };
}

/* The upper staff's attacks that are not a true melody note (same pitch, onset within the slack): the share of them, null with none. A note moved into the melody hand that is not the melody
   (an accompaniment note a guard took for it) shows here; `melodyAt` is the heard true melody. */
function notMelody(ix, melodyAt) {
  const up = ix.onsets.filter(n => n.staff === 0);
  if (!up.length) return null;
  const isMelody = n => melodyAt.some(m => m.midi === n.midi && Math.abs(m.q - n.q0) <= TOL_Q);
  return up.filter(n => !isMelody(n)).length / up.length;
}

/* chordsAt: [{q, chord}] the true chord at a position; `windows`: [{q0, q1, chord}] the graph's own. Share of the true positions that fall in a window with the same chord
   (a position in no window is not counted); null when none is. */
function chordAgreement(windows, chordsAt) {
  let n = 0, hit = 0;
  chordsAt.forEach(t => {
    const w = windows.find(x => x.q0 <= t.q + EPS && t.q < x.q1 - EPS);
    if (!w) return;
    n++; if (w.chord === t.chord) hit++;
  });
  return n ? hit / n : null;
}

/* the left hand's attacks per bar, and the right hand's share above C6 */
function handStats(ix, bars) {
  const lh = ix.onsets.filter(n => n.staff === 1).length, rh = ix.onsets.filter(n => n.staff === 0);
  return { lh_notes_per_bar: bars ? lh / bars : null, rh_above_c6: rh.length ? rh.filter(n => n.midi > C6).length / rh.length : null };
}

/* the set of a level's attacks, for the level spread */
const keysOf = ix => new Set(ix.onsets.map(n => Math.round(n.q0 * 96) + '|' + n.midi + '|' + n.staff));

/* levels: [{key: Set, fp}] of the levels made. distinct: (distinct arrangements - 1) / (levels - 1); distance: mean Jaccard distance over the pairs. null with one level. */
function levelSpread(levels) {
  if (levels.length < 2) return null;
  const fps = new Set(levels.map(l => l.fp));
  const d = [];
  for (let i = 0; i < levels.length; i++) for (let j = i + 1; j < levels.length; j++) {
    let inter = 0; levels[i].keys.forEach(k => { if (levels[j].keys.has(k)) inter++; });
    const union = levels[i].keys.size + levels[j].keys.size - inter;
    d.push(union ? 1 - inter / union : 0);
  }
  return { distinct: (fps.size - 1) / (levels.length - 1), distance: d.reduce((a, b) => a + b, 0) / d.length };
}

/* the heard note each true melody note became: one to one, same pitch, the nearest in time within `windowS`. truth: [{sec, midi, q}] in time order;
   heard: [{midi, sec, ref}] (`ref` is whatever the caller wants back). Returns [{truth, heard}]. */
function matchHeard(truth, heard, windowS) {
  const byMidi = new Map();
  heard.forEach(h => { if (!byMidi.has(h.midi)) byMidi.set(h.midi, []); byMidi.get(h.midi).push(h); });
  const used = new Set(), out = [];
  truth.forEach(t => {
    let best = null, bd = windowS + 1e-9;
    (byMidi.get(t.midi) || []).forEach(h => {
      if (used.has(h)) return;
      const d = Math.abs(h.sec - t.sec);
      if (d < bd) { bd = d; best = h; }
    });
    if (!best) return;
    used.add(best);
    out.push({ truth: t, heard: best });
  });
  return out;
}

module.exports = { TOL_Q, C6, indexNotes, hasOnset, sounds, melodyStats, notMelody, chordAgreement, handStats, keysOf, levelSpread, matchHeard };
