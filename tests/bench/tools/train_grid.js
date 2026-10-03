#!/usr/bin/env node
/* G10a-2 S3 (docs/GOALS/G10 section 8, AI-5b): train the per-beat grid model of rec/grid.js, and measure it against
   the legacy quantiser on the stage alone (the true beat times given, so the time skeleton can neither hide nor cause an
   error).

     node tests/bench/tools/train_grid.js --write       regenerate the training data, fit, write rec/weights/ai5b-grid-v1.json
     node tests/bench/tools/train_grid.js --check       regenerate and fit; exit 1 unless the committed weights are exactly that
     node tests/bench/tools/train_grid.js --evaluate [--write|--check]
                                                         also the stage-level evaluation (rec/tools/ai5b-grid-v1.evaluation.json):
                                                         legacy vs the model on the hold-out references, the robustness family
                                                         and the training references' other seeds, true and +-20 ms beats
     node tests/bench/tools/train_grid.js --data DIR    reuse DIR's data files (development; --check always regenerates)
     node tests/bench/tools/train_grid.js --eval E.jsonl [--noisy] [--by-tempo] [--confusion] [--legacy-only]
                                                         development: print the evaluation of the fitted model on E.jsonl

   The data: tests/bench/tools/grid_data.py (Python, the benchmark's own performer and humanizer, LCG-deterministic):
   humanized performances of the licence-clean catalogue with the true grid of every beat. TRAINING = every lint-clean
   NON-hold-out reference (grid_data.py --refs train refuses a hold-out one) x cover, cover-pedal, human-real, swing,
   cover+of x seeds 101 and 102 (seeds no suite uses, as G10a-1's AI-5a). cover-alt (the robustness family) is never
   trained on. No external data, no audio, no user material, no note-level data committed: the weights file holds counts
   turned into probabilities (a few hundred numbers).

   ---- What is learned (all by counting; deterministic, no iteration, no random start) ----
   patterns   per grid kind, P(the set of its grid points that hold a heard onset): '16' and 'swing8' over the four 16th
              points (16 patterns), '3' over the thirds (8), '32' as the 16th-point pattern (16) times independent
              occupancies of the four odd 32nds, at least one of them. Counted on the HEARD onsets of the true beats (a
              written onset the transcription lost or merged is not heard), Laplace-smoothed. Kind of a true beat: S16 -> '16',
              S32 -> '32', T3 -> '3', a straight beat the swing family played long-short -> 'swing8', T6 (triplet 16ths)
              -> '6' over the sixths (64 patterns; G10a-3: rec/writer.js writes them; before, a T6 beat was '3' for the chain
              with no pattern and came out as 32nds).
   prior      the kinds' shares among beats that hold an onset; stay: the chance that the next beat with an onset keeps the
              kind, as the chain of rec/grid.js models it (stay + (1 - stay) * prior).
   sigmaSec   the timing noise: the root mean square of heard onset minus true time (seconds; the largest 2 % trimmed);
              rec/grid.js adapts it to each piece from its own residuals.
   outlier    the share of heard onsets no written note explains (an AMT ghost) or more than 4 sigma off.
   early      the share of beats whose next beat's first onset was heard inside this beat (before the window edge).
   split      of the onsets at most JOIN_GAP after the one before, the share that sound the same written onset (a chord
              heard a frame apart): the cost of joining them.
   chordSigmaSec  the spread of such a chord: the root mean square offset of its onsets from their mean (seconds), times
              sqrt(2) (an offset from a mean of two is half the gap's spread).
   minSpacing32  the shortest 32nd (seconds) of any true 32nd beat, times 0.9: below it a 32nd is no hypothesis.

   ---- The legacy quantiser, for comparison only ----
   LEGACY below is a verbatim copy of audio-score.js tripletBeats / snapStraight / snapStraightBest / snapTriplet / the onset
   part of quantize (audio-score.js does not export them). A beat is '3' when tripletBeats flags it, '32' when one of its
   onsets took the 32nd lattice, else '16'.

   ---- Measures (per beat that holds a heard onset; and per heard note) ----
   kind accuracy, triplet-beat precision / recall (a beat with an onset WRITTEN on a third or a sixth vs a true T3/T6 beat), 32nd P/R,
   the onset position accuracy (the written onset, beat + fraction, equals the true written onset) and, on the swing
   family, the share of swung straight beats written straight. Pooled counts. */
'use strict';
const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..', '..', '..');
const A = require(path.join(REPO, 'audio-score.js'));
const G = require(path.join(REPO, 'rec', 'grid.js'));
const MODEL_PATH = path.join(REPO, 'rec', 'weights', 'ai5b-grid-v1.json');
const EVAL_PATH = path.join(REPO, 'rec', 'tools', 'ai5b-grid-v1.evaluation.json');
const DATASET = path.join(REPO, 'tests', 'bench', 'tools', 'grid_data.py');
const { spawnSync } = require('child_process');
const os = require('os');
/* the data files: [name, grid_data.py arguments] */
const DATA = {
  train: ['--refs', 'train', '--profiles', 'cover,cover-pedal,human-real,swing,cover+of', '--beats', 'oracle', '--seeds', '101,102'],
  holdout: ['--refs', 'holdout', '--profiles', 'cover,cover-pedal,human-real,swing,cover+of,cover-alt', '--beats', 'oracle', '--seeds', '11,12'],
  robust: ['--refs', 'train', '--profiles', 'cover-alt', '--beats', 'oracle', '--seeds', '103'],
  open: ['--refs', 'train', '--profiles', 'cover,human-real,swing,cover+of', '--beats', 'oracle', '--seeds', '104']
};
const MODEL_VERSION = '1.0.0';
const JOIN_GAP = 0.04;             /* seconds: an onset this close after the one before may be the same written onset (a chord heard a frame apart) */

function arg(name) { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : null; }
function args(name) { const out = []; process.argv.forEach((a, i) => { if (a === name) out.push(process.argv[i + 1]); }); return out; }
const has = name => process.argv.indexOf(name) >= 0;

function load(p) { return fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)); }

/* a deterministic uniform stream (the bench's LCG) */
function lcg(seed) { let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }
function fnv(text) { let h = 2166136261; for (const ch of Buffer.from(text, 'utf8')) { h ^= ch; h = Math.imul(h, 16777619) >>> 0; } return h; }

/* The beats of a performance (one per quarter-note beat of the reference: the windows' true times) when every window is
   one quarter long (simple metres, x/4 and x/2; a bar of 3/8 or a pickup of an eighth is left out), else null. */
function quarterFrame(row, noisy) {
  const T = row.time;
  if (!(T[1] === 4 || T[1] === 2)) return null;
  const W = row.windows;
  if (!W.length || W.some(w => Math.abs(w[1] - w[0] - 1) > 1e-9)) return null;
  for (let i = 1; i < W.length; i++) if (Math.abs(W[i][0] - W[i - 1][1]) > 1e-9) return null;
  const beats = W.map(w => w[2]).concat([W[W.length - 1][3]]);
  if (noisy) {
    const r = lcg(fnv(row.id + '|beats'));
    for (let i = 0; i < beats.length; i++) beats[i] += (r() * 2 - 1) * 0.02;
    for (let i = 1; i < beats.length; i++) if (beats[i] <= beats[i - 1] + 0.05) beats[i] = beats[i - 1] + 0.05;
  }
  return { beats: beats, q0: W[0][0] };
}

/* The same for a compound metre (6/8, 9/8, 12/8, 3/8): one beat per dotted quarter (the cwindows' true times), every window
   a dotted quarter long (a pickup of another length leaves the performance out), else null. q0 is in quarters; a beat is
   1.5 quarters. */
function compoundFrame(row, noisy) {
  const W = row.cwindows || [];
  if (!W.length || W.some(w => Math.abs(w[1] - w[0] - 1.5) > 1e-9)) return null;
  for (let i = 1; i < W.length; i++) if (Math.abs(W[i][0] - W[i - 1][1]) > 1e-9) return null;
  const beats = W.map(w => w[2]).concat([W[W.length - 1][3]]);
  if (noisy) {
    const r = lcg(fnv(row.id + '|cbeats'));
    for (let i = 0; i < beats.length; i++) beats[i] += (r() * 2 - 1) * 0.02;
    for (let i = 1; i < beats.length; i++) if (beats[i] <= beats[i - 1] + 0.05) beats[i] = beats[i - 1] + 0.05;
  }
  return { beats: beats, q0: W[0][0], unit: 1.5, compound: true };
}

/* the heard notes as the SUT sees them before its quantiser: audio-score.js clean() rules, then clusterNotes */
function clustered(row) {
  const notes = row.notes.map((n, i) => ({ on: Math.max(0, n[0]), off: Math.max(n[0] + 0.03, n[1]), midi: n[2], vel: n[3], _i: i }))
    .filter(n => n.midi >= 21 && n.midi <= 108 && n.vel >= 8)
    .sort((a, b) => a.on - b.on || a.midi - b.midi);
  return A._.clusterNotes(notes, 0.05);
}

/* ---------------------------------------------------------------- the legacy quantiser (verbatim copy, see header) */
const LEGACY = (function () {
  const SUB = 4;
  const LEVEL_COST_16 = [0, 0.025, 0.06, 0.08];
  function snapStraight(pos, spb, subdivisions) {
    subdivisions = subdivisions === 8 ? 8 : 4;
    const k = Math.floor(pos); const f = pos - k; spb = spb || 0.6;
    let best = 0, bestCost = Infinity;
    for (let s = 0; s <= subdivisions; s++) {
      const c = s / subdivisions;
      const level = s === 0 || s === subdivisions ? 0 : (s % 2 === 0 ? 1 : 2);
      const finePenalty = subdivisions === 8 && s > 0 && s < subdivisions ? 0.035 : 0;
      const cost = Math.abs(f - c) * spb + (subdivisions === 4 ? LEVEL_COST_16[level] : finePenalty);
      if (cost < bestCost) { bestCost = cost; best = s; }
    }
    const frac = best / subdivisions;
    return { frac: frac, err: Math.abs(f - frac), kind: subdivisions === 8 ? '32nd' : '16th', subdivision: subdivisions, cost: bestCost };
  }
  const snap16 = (pos, spb) => snapStraight(pos, spb, 4);
  function snapStraightBest(pos, spb) { const c = snapStraight(pos, spb, 4), f = snapStraight(pos, spb, 8); return f.cost + 1e-6 < c.cost ? f : c; }
  function snapTriplet(pos, spb) {
    const k = Math.floor(pos); const f = pos - k; spb = spb || 0.6;
    let best = 0, bestCost = Infinity;
    for (let s = 0; s <= 3; s++) { const c = s / 3; const cost = Math.abs(f - c) * spb + (s % 3 === 0 ? 0 : 0.02); if (cost < bestCost) { bestCost = cost; best = s; } }
    return { frac: best / 3, err: Math.abs(f - best / 3), kind: 'triplet' };
  }
  const spbAt = (beats, pos) => { const k = Math.min(Math.max(Math.floor(pos), 0), beats.length - 2); return beats[k + 1] - beats[k]; };
  function tripletBeats(notes, beats) {
    const flags = {}, byBeat = {};
    notes.forEach(n => { const t = n.attack != null ? n.attack : n.on; const pos = A._.beatPosition(beats, t); const k = Math.floor(pos + 1e-6); (byBeat[k] = byBeat[k] || []).push(pos - k); });
    Object.keys(byBeat).forEach(k => {
      const fs = byBeat[k];
      if (fs.length < 2) return;
      let e16 = 0, e3 = 0;
      fs.forEach(f => { e16 += snap16(f, 1).err; e3 += snapTriplet(f, 1).err; });
      const off16 = fs.filter(f => Math.abs(f - Math.round(f * SUB) / SUB) > 0.08).length;
      if (e3 * 1.02 < e16 && (off16 >= 2 || (fs.length % 3 === 0 && fs.length >= 3))) flags[+k] = true;
    });
    return flags;
  }
  /* per note: tick (24 per beat) and the grid it took */
  function ticks(notes, beats) {
    const trip = tripletBeats(notes, beats);
    const Q = 24;
    const q = notes.map(n => {
      const tOn = n.attack != null ? n.attack : n.on;
      const pos = A._.beatPosition(beats, tOn);
      const k = Math.floor(pos + 1e-9);
      const useTrip = !!trip[k];
      const a = useTrip ? snapTriplet(pos, spbAt(beats, pos)) : snapStraightBest(pos, spbAt(beats, pos));
      let tick = Math.round((k + a.frac) * Q);
      if (useTrip) { const base = k * Q; tick = base + Math.round((tick - base) / 8) * 8; }
      else { const unit = a.subdivision === 8 ? 3 : 6; tick = Math.round(tick / unit) * unit; }
      return { tick: tick, trip: useTrip, sub: useTrip ? 3 : a.subdivision, attack: tOn };
    });
    const byAtt = {};
    q.forEach(n => { const key = n.attack.toFixed(4); if (byAtt[key] == null) byAtt[key] = n.tick; else n.tick = byAtt[key]; });
    return q.map(n => ({ tick: n.tick, kind: n.trip ? '3' : (n.sub === 8 ? '32' : '16') }));
  }
  /* audio-score.js quantizeCompound (verbatim, the onset part): 36 ticks a dotted-quarter beat, 16ths or 32nds per onset */
  function compoundTicks(notes, beats) {
    const q = notes.map(n => {
      const tOn = n.attack != null ? n.attack : n.on;
      const pos = A._.beatPosition(beats, tOn);
      const coarse = Math.round(pos * 6) / 6;
      const fine = Math.round(pos * 12) / 12;
      const spb = spbAt(beats, pos);
      const coarseCost = Math.abs(pos - coarse) * spb;
      const fineCost = Math.abs(pos - fine) * spb + 0.012;
      const useFine = fineCost + 1e-6 < coarseCost;
      return { tick: Math.round((useFine ? fine : coarse) * 36), attack: tOn };
    });
    const byAtt = {};
    q.forEach(n => { const key = n.attack.toFixed(4); if (byAtt[key] == null) byAtt[key] = n.tick; else n.tick = byAtt[key]; });
    return q.map(n => ({ tick: n.tick }));
  }
  return { ticks: ticks, compoundTicks: compoundTicks };
})();

/* the written grid of each beat from per-note ticks: '3' when a note is written on a third, '32' on an odd 32nd, else straight */
function writtenKinds(ticks) {
  const per = new Map();
  ticks.forEach(t => {
    const k = Math.floor(t.tick / 24), o = t.tick - k * 24;
    const cur = per.get(k) || '16';
    let kind = '16';
    if (o === 4 || o === 20) kind = '6'; else if (o === 8 || o === 16) kind = '3'; else if (o % 6) kind = '32';
    if (kind === '6' || (kind === '3' && cur !== '6') || (kind === '32' && cur === '16')) per.set(k, kind); else if (!per.has(k)) per.set(k, cur);
  });
  return per;
}

function newStats(top) { const s = { beats: 0, kindOk: 0, conf: {}, trip: { tp: 0, fp: 0, fn: 0 }, b32: { tp: 0, fp: 0, fn: 0 }, notes: 0, posOk: 0, sw: { n: 0, straight: 0 } }; if (top) s.byTempo = {}; return s; }
function addConf(st, truth, got) { const k = truth + '>' + got; st.conf[k] = (st.conf[k] || 0) + 1; }

/* one performance through one decider; `decide(cl, beats)` returns per clustered note {tick} */
function score(row, frame, cl, ticks, st) {
  const W = row.windows;
  const written = writtenKinds(ticks);
  /* the heard beats: every beat window that holds a heard onset (as the stage sees it) */
  const heardBeat = new Set(cl.map(n => Math.floor(A._.beatPosition(frame.beats, n.attack) + 1 / 16)));
  W.forEach((w, k) => {
    if (!heardBeat.has(k)) return;
    const truth = w[4], swing = w[5];
    const got = written.get(k) || '16';
    if (st.byTempo) {
      const b = (w[3] - w[2]) < 0.33 ? 'fast<0.33s' : (w[3] - w[2]) < 0.5 ? 'mid<0.5s' : 'slow';
      if (!st.byTempo[b]) st.byTempo[b] = newStats();
      const sub = st.byTempo[b];
      sub.beats++;
      const tr0 = truth === 'T3' ? '3' : truth === 'T6' ? '6' : (truth === 'S32' ? '32' : '16');
      if (tr0 === got) sub.kindOk++;
      const t0 = tr0 === '3' || tr0 === '6', g0 = got === '3' || got === '6';
      if (t0 && g0) sub.trip.tp++; else if (g0) sub.trip.fp++; else if (t0) sub.trip.fn++;
      if (tr0 === '32' && got === '32') sub.b32.tp++; else if (got === '32') sub.b32.fp++; else if (tr0 === '32') sub.b32.fn++;
    }
    st.beats++;
    const tr = truth === 'T3' ? '3' : truth === 'T6' ? '6' : (truth === 'S32' ? '32' : '16');
    if (tr === got) st.kindOk++;
    addConf(st, truth + (swing ? '~' : ''), got);
    const tTrip = tr === '3' || tr === '6', gTrip = got === '3' || got === '6';
    if (tTrip && gTrip) st.trip.tp++; else if (gTrip) st.trip.fp++; else if (tTrip) st.trip.fn++;
    const t32 = tr === '32', g32 = got === '32';
    if (t32 && g32) st.b32.tp++; else if (g32) st.b32.fp++; else if (t32) st.b32.fn++;
    if (swing && truth === 'S16') { st.sw.n++; if (got === '16') st.sw.straight++; }
  });
  cl.forEach((n, i) => {
    const tq = row.notes[n._i][4];
    if (tq === null || tq === undefined) return;
    st.notes++;
    const wq = frame.q0 + ticks[i].tick / 24;
    if (Math.abs(wq - tq) < 1e-6) st.posOk++;
  });
}

/* a compound performance: per dotted-quarter beat with a heard onset, the written kind ('c16' when an onset is on an odd 16th
   of the beat, 6 / 18 / 30 ticks of 36, else 'c8') against the true one, and the onset positions */
function scoreCompound(row, frame, cl, ticks, st) {
  const W = row.cwindows;
  const per = new Map();
  ticks.forEach(t => { const k = Math.floor(t.tick / 36), o = t.tick - k * 36; if (o % 12) per.set(k, 'c16'); else if (!per.has(k)) per.set(k, 'c8'); });
  const heardBeat = new Set(cl.map(n => Math.floor(A._.beatPosition(frame.beats, n.attack) + 1 / 16)));
  W.forEach((w, k) => {
    if (!heardBeat.has(k)) return;
    const tr = w[4] === 'C8' ? 'c8' : 'c16';
    const got = per.get(k) || 'c8';
    st.beats++;
    if (tr === got) st.kindOk++;
    addConf(st, w[4], got);
    if (tr === 'c16' && got === 'c16') st.b32.tp++; else if (got === 'c16') st.b32.fp++; else if (tr === 'c16') st.b32.fn++;
  });
  cl.forEach((n, i) => {
    const tq = row.notes[n._i][4];
    if (tq === null || tq === undefined) return;
    st.notes++;
    const wq = frame.q0 + ticks[i].tick / 36 * 1.5;
    if (Math.abs(wq - tq) < 1e-6) st.posOk++;
  });
}
function evaluateCompound(rows, label, opts) {
  const all = { legacy: newStats(), v2: newStats() };
  let n = 0, skipped = 0;
  rows.forEach(row => {
    if (!(row.cwindows && row.cwindows.length)) return;
    const frame = compoundFrame(row, opts.noisy);
    if (!frame) { skipped++; return; }
    const cl = clustered(row);
    if (cl.length < 4) { skipped++; return; }
    n++;
    scoreCompound(row, frame, cl, LEGACY.compoundTicks(cl, frame.beats), all.legacy);
    const r = G.plan(frame.beats, cl, { model: opts.model, compound: true });
    scoreCompound(row, frame, cl, r.onsets.map(o => ({ tick: o.tick })), all.v2);
  });
  const f = x => x.toFixed(4);
  ['legacy', 'v2'].forEach(k => {
    const st = all[k];
    console.log(`${(label + ' compound ' + k).padEnd(34)} perf ${n} (skipped ${skipped}) beats ${st.beats}  kind ${f(st.kindOk / Math.max(1, st.beats))}  16th-beats P ${f(st.b32.tp / Math.max(1, st.b32.tp + st.b32.fp))} R ${f(st.b32.tp / Math.max(1, st.b32.tp + st.b32.fn))}  onset pos ${f(st.posOk / Math.max(1, st.notes))}`);
  });
  if (has('--confusion')) { console.log('legacy', JSON.stringify(all.legacy.conf)); console.log('v2', JSON.stringify(all.v2.conf)); }
  all.performances = n;
  return all;
}

function report(name, st) {
  const pr = c => ({ P: c.tp + c.fp ? c.tp / (c.tp + c.fp) : 1, R: c.tp + c.fn ? c.tp / (c.tp + c.fn) : null });
  const t = pr(st.trip), b = pr(st.b32);
  const f = x => (x === null ? '-' : x.toFixed(4));
  console.log(`${name.padEnd(28)} beats ${String(st.beats).padStart(6)}  kind ${f(st.kindOk / st.beats)}  triplet P ${f(t.P)} R ${f(t.R)} (tp ${st.trip.tp} fp ${st.trip.fp} fn ${st.trip.fn})  32nd P ${f(b.P)} R ${f(b.R)} (tp ${st.b32.tp} fp ${st.b32.fp} fn ${st.b32.fn})  onset pos ${f(st.posOk / st.notes)}  swing->straight ${st.sw.n ? f(st.sw.straight / st.sw.n) : '-'}`);
}

function evaluate(rows, label, opts) {
  const byProfile = new Map();
  const all = { legacy: newStats(true), v2: newStats(true) };
  let skipped = 0;
  rows.forEach(row => {
    const frame = quarterFrame(row, opts.noisy);
    if (!frame) { skipped++; return; }
    const cl = clustered(row);
    if (cl.length < 4) { skipped++; return; }
    if (!byProfile.has(row.profile)) byProfile.set(row.profile, { legacy: newStats(), v2: newStats() });
    const P = byProfile.get(row.profile);
    const lt = LEGACY.ticks(cl, frame.beats);
    score(row, frame, cl, lt, P.legacy); score(row, frame, cl, lt, all.legacy);
    if (!opts.legacyOnly) {
      const r = G.plan(frame.beats, cl, { model: opts.model });
      const vt = r.onsets.map(o => ({ tick: o.tick }));
      score(row, frame, cl, vt, P.v2); score(row, frame, cl, vt, all.v2);
    }
  });
  console.log(`\n== ${label}${opts.noisy ? ' (beats +-20 ms)' : ''}: ${rows.length - skipped} performances (${skipped} not in quarter beats)`);
  Array.from(byProfile.keys()).sort().forEach(p => {
    report(p + ' legacy', byProfile.get(p).legacy);
    if (!opts.legacyOnly) report(p + ' v2', byProfile.get(p).v2);
  });
  report('ALL legacy', all.legacy);
  if (!opts.legacyOnly) report('ALL v2', all.v2);
  all.byProfile = byProfile; all.performances = rows.length - skipped;
  if (has('--by-tempo')) ['legacy', 'v2'].forEach(s => Object.keys(all[s].byTempo || {}).sort().forEach(b => { const x = all[s].byTempo[b]; x.notes = 1; report(s + ' ' + b, x); }));
  if (has('--confusion')) { console.log('legacy', JSON.stringify(all.legacy.conf)); if (!opts.legacyOnly) console.log('v2', JSON.stringify(all.v2.conf)); }
  return all;
}

/* ---------------------------------------------------------------- training (counting) */
function kindOfWindow(w) {
  if (w[4] === 'T3') return '3';
  if (w[4] === 'T6') return '6';
  if (w[4] === 'S32') return '32';
  return w[5] ? 'swing8' : '16';
}
function round6(x) { return Math.round(x * 1e6) / 1e6; }

function fit(rows) {
  const kinds = G.KINDS;
  const pts = { '16': [0, 0.25, 0.5, 0.75], '3': [0, 1 / 3, 2 / 3], 'swing8': [0, 0.25, 0.5, 0.75], '6': [0, 1 / 6, 1 / 3, 0.5, 2 / 3, 5 / 6] };
  const ODD = [0.125, 0.375, 0.625, 0.875];
  const pat = { '16': new Array(16).fill(0), '3': new Array(8).fill(0), 'swing8': new Array(16).fill(0), '32even': new Array(16).fill(0), '6': new Array(64).fill(0) };
  const odd = [0, 0, 0, 0];
  let n32 = 0;
  const maskOf = (fr, P) => P.reduce((m, p, j) => (fr.some(f => Math.abs(f - p) < 1e-6) ? m | (1 << j) : m), 0);
  const count = {}, same = {}, from = {};
  kinds.forEach(k => { count[k] = 0; same[k] = 0; from[k] = 0; });
  const res = [];
  let heard = 0, unexplained = 0, early = 0, windows = 0;
  let min32 = Infinity;
  rows.forEach(row => {
    const frame = quarterFrame(row, false);
    if (!frame) return;
    const W = row.windows;
    const cl = clustered(row);
    /* the written onsets that were HEARD as an onset of their own: per window, the fractions of the heard attacks'
       written onsets (an attack sounding several written onsets - a merge - counts its most common one) */
    const heardFr = new Map();
    const byAtt = new Map();
    G._.onsetsOf(cl, JOIN_GAP).forEach((o, x) => { byAtt.set(x, o.notes.map(i => row.notes[cl[i]._i][4])); });
    byAtt.forEach(tqs => {
      const c = new Map();
      tqs.forEach(t => { if (t !== null && t !== undefined) c.set(t, (c.get(t) || 0) + 1); });
      if (!c.size) return;
      const tq = Array.from(c.entries()).sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
      const wi = Math.floor(tq - frame.q0 + 1e-9);
      if (wi < 0 || wi >= W.length) return;
      if (!heardFr.has(wi)) heardFr.set(wi, []);
      heardFr.get(wi).push(tq - W[wi][0]);
    });
    /* the beats the stage sees an onset in (by time, as rec/grid.js beatsOf assigns them): a beat with no written onset of
       its own can still hold one - the next beat's first onset heard early - and is then an EMPTY '16' pattern whose onset
       the early downbeat point explains (without it the empty pattern would have no mass and such an onset would be
       forced onto a 32nd) */
    const seen = new Set();
    const onsT = G._.onsetsOf(cl, JOIN_GAP);
    G._.beatsOf(onsT, frame.beats);
    onsT.forEach(o => seen.add(o.beat));
    let prev = null;
    W.forEach((w, wi) => {
      if (!w[6]) {
        if (seen.has(wi)) { pat['16'][0]++; count['16']++; if (prev !== null) { from[prev]++; if (prev === '16') same[prev]++; } prev = '16'; }
        return;
      }
      const k = kindOfWindow(w);
      const fr = heardFr.get(wi) || [];
      /* the heard occupancy pattern of the beat (a triplet-16th beat, T6, over the sixths) */
      if (fr.length) {
        if (k === '32') {
          n32++;
          pat['32even'][maskOf(fr, pts['16'])]++;
          ODD.forEach((p, j) => { if (fr.some(f => Math.abs(f - p) < 1e-6)) odd[j]++; });
        } else pat[k][maskOf(fr, pts[k])]++;
      }
      count[k]++;
      if (prev !== null) { from[prev]++; if (prev === k) same[prev]++; }
      prev = k;
      if (k === '32') min32 = Math.min(min32, (w[3] - w[2]) / 8);
    });
    /* timing residuals (heard onset minus the true time of its written onset, linear in its window) */
    G._.onsetsOf(cl, JOIN_GAP).forEach(o => {
      const tqs = o.notes.map(i => row.notes[cl[i]._i][4]);
      heard++;
      const known = tqs.filter(t => t !== null && t !== undefined);
      if (!known.length) { unexplained++; return; }
      const tq = known[0];
      const wi = Math.min(W.length - 1, Math.max(0, Math.floor(tq - frame.q0)));
      const w = W[wi];
      const tt = w[2] + (tq - w[0]) * (w[3] - w[2]);
      res.push(o.t - tt);
    });
    /* early next-beat onsets: the first onset of beat k+1 (written at its 0) heard before the window edge of beat k */
    W.forEach((w, k) => {
      if (k + 1 >= W.length) return;
      windows++;
      const nxt = W[k + 1];
      if (!nxt[9].length || Math.abs(nxt[9][0]) > 1e-9) return;
      const edge = w[2] + (1 - G._.WINDOW_EARLY) * (w[3] - w[2]);
      const firstHeard = cl.filter(n => { const tq = row.notes[n._i][4]; return tq !== null && Math.abs(tq - nxt[0]) < 1e-9; })
        .reduce((m, n) => Math.min(m, n.attack), Infinity);
      if (firstHeard < edge) early++;
    });
  });
  /* split: of the onsets rec/grid.js makes that are at most JOIN_GAP after the onset before them, the share that sounds the
     same written onset as that onset (a chord heard a frame apart) */
  let splitSame = 0, splitAll = 0;
  const chordDev = [];                          /* offsets (s) of the onsets of one written onset from their mean, chained within JOIN_GAP */
  rows.forEach(row => {
    const frame = quarterFrame(row, false);
    if (!frame) return;
    const cl = clustered(row);
    const ons = G._.onsetsOf(cl, JOIN_GAP);
    let prevTq = null, prevT = -Infinity, group = [];
    const flushGroup = () => { if (group.length > 1) { const m = group.reduce((a, b) => a + b, 0) / group.length; group.forEach(t => chordDev.push(t - m)); } group = []; };
    ons.forEach(o => {
      const c = new Map();
      o.notes.forEach(i => { const t = row.notes[cl[i]._i][4]; if (t !== null && t !== undefined) c.set(t, (c.get(t) || 0) + 1); });
      const tq = c.size ? Array.from(c.entries()).sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0] : null;
      const same = tq !== null && prevTq !== null && Math.abs(tq - prevTq) < 1e-9;
      if (o.t - prevT <= JOIN_GAP) {
        splitAll++;
        if (same) splitSame++;
      }
      if (!(same && o.t - prevT <= JOIN_GAP)) flushGroup();
      group.push(o.t);
      prevTq = tq; prevT = o.t;
    });
    flushGroup();
  });
  res.sort((a, b) => Math.abs(a) - Math.abs(b));
  const keep = res.slice(0, Math.floor(res.length * 0.98));
  const sigma = Math.sqrt(keep.reduce((s, r) => s + r * r, 0) / keep.length);
  const far = res.filter(r => Math.abs(r) > 4 * sigma).length;
  /* compound metres: the eighths / 16ths patterns of every dotted-quarter beat and the chain over them (a beat that needs a
     32nd or a tuplet counts in the chain as a 16th beat, with no pattern) */
  const cpat = { c8: new Array(8).fill(0), c16: new Array(64).fill(0) };
  const ccount = { c8: 0, c16: 0 }, csame = { c8: 0, c16: 0 }, cfrom = { c8: 0, c16: 0 };
  const SIX = [0, 1 / 6, 1 / 3, 0.5, 2 / 3, 5 / 6], THIRDS = [0, 1 / 3, 2 / 3];
  rows.forEach(row => {
    const frame = compoundFrame(row, false);
    if (!frame) return;
    const W = row.cwindows;
    const cl = clustered(row);
    const heardFr = new Map();
    G._.onsetsOf(cl, JOIN_GAP).forEach(o => {
      const c = new Map();
      o.notes.forEach(i => { const t = row.notes[cl[i]._i][4]; if (t !== null && t !== undefined) c.set(t, (c.get(t) || 0) + 1); });
      if (!c.size) return;
      const tq = Array.from(c.entries()).sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
      const wi = Math.floor((tq - frame.q0) / 1.5 + 1e-9);
      if (wi < 0 || wi >= W.length) return;
      if (!heardFr.has(wi)) heardFr.set(wi, []);
      heardFr.get(wi).push((tq - W[wi][0]) / 1.5);
    });
    let prev = null;
    W.forEach((w, wi) => {
      if (!w[6]) return;
      const k = w[4] === 'C8' ? 'c8' : 'c16';
      const fr = heardFr.get(wi) || [];
      if ((w[4] === 'C8' || w[4] === 'C16') && fr.length) cpat[k][maskOf(fr, k === 'c8' ? THIRDS : SIX)]++;
      ccount[k]++;
      if (prev !== null) { cfrom[prev]++; if (prev === k) csame[prev]++; }
      prev = k;
    });
  });
  const total = kinds.reduce((s, k) => s + count[k], 0);
  const prior = {}, stay = {};
  const table = c => { const N = c.reduce((a, b) => a + b, 0); return c.map(x => round6((x + 1) / (N + c.length))); };
  const patterns = { '16': table(pat['16']), '3': table(pat['3']), 'swing8': table(pat['swing8']), '32even': table(pat['32even']), '6': table(pat['6']),
    '32odd': odd.map(c => round6((c + 1) / (n32 + 2))), c8: table(cpat.c8), c16: table(cpat.c16) };
  const ctotal = ccount.c8 + ccount.c16;
  ['c8', 'c16'].forEach(k => {
    prior[k] = round6((ccount[k] + 1) / (ctotal + 2));
    const pSame = (csame[k] + 1) / (cfrom[k] + 2);
    stay[k] = round6(Math.max(0, Math.min(0.999, (pSame - prior[k]) / (1 - prior[k]))));
  });
  kinds.forEach(k => {
    prior[k] = round6((count[k] + 1) / (total + kinds.length));
  });
  kinds.forEach(k => {
    const pSame = (same[k] + 1) / (from[k] + 2);
    stay[k] = round6(Math.max(0, Math.min(0.999, (pSame - prior[k]) / (1 - prior[k]))));
  });
  return {
    schema: G.SCHEMA, name: 'ai5b-grid', version: MODEL_VERSION,
    trainedOn: { tool: 'tests/bench/tools/train_grid.js', rows: rows.length, beatsWithOnsets: total, refs: new Set(rows.map(r => r.ref)).size,
      profiles: Array.from(new Set(rows.map(r => r.profile))).sort(), holdout: rows.filter(r => r.holdout).length },
    kinds: kinds.slice(),
    sigmaSec: round6(sigma), sigmaPrior: 30, sigmaMin: 0.008, sigmaMax: 0.06,
    outlier: round6((unexplained + far + 1) / (heard + 2)),
    early: round6((early + 1) / (windows + 2)),
    split: round6((splitSame + 1) / (splitAll + 2)), joinGap: JOIN_GAP,
    chordSigmaSec: round6(Math.sqrt(chordDev.reduce((a, d) => a + d * d, 0) / Math.max(1, chordDev.length)) * Math.sqrt(2)),
    patterns: patterns, prior: prior, stay: stay,
    minSpacing32: round6(Number.isFinite(min32) ? min32 * 0.9 : G.FALLBACK.minSpacing32)
  };
}

function python() {
  const given = arg('--python') || process.env.PPP_PYTHON;
  const cands = given ? [given] : ['python3', 'python'];
  for (const c of cands) { const r = spawnSync(c, ['--version'], { encoding: 'utf8' }); if (r.status === 0) return c; }
  throw new Error('no Python found for ' + DATASET + ' (give --python)');
}
/* the data files in `dir`, regenerated unless `reuse` and present */
function dataset(dir, names, reuse) {
  const py = reuse ? null : python();
  const out = {};
  names.forEach(name => {
    const f = path.join(dir, 'grid-' + name + '.jsonl');
    if (!(reuse && fs.existsSync(f))) {
      const r = spawnSync(py || python(), [DATASET].concat(DATA[name], ['--out', f]), { cwd: REPO, encoding: 'utf8',
        env: Object.assign({}, process.env, { PYTHONIOENCODING: 'utf-8' }), maxBuffer: 1 << 26 });
      if (r.status !== 0) throw new Error('grid_data.py failed: ' + (r.stderr || '').slice(-1500));
    }
    out[name] = load(f);
  });
  return out;
}
const pr = c => ({ P: c.tp + c.fp ? round6(c.tp / (c.tp + c.fp)) : 1, R: c.tp + c.fn ? round6(c.tp / (c.tp + c.fn)) : null, tp: c.tp, fp: c.fp, fn: c.fn });
function summary(st) {
  return { beats: st.beats, kind: round6(st.kindOk / Math.max(1, st.beats)), triplet: pr(st.trip), b32: pr(st.b32),
    onsetPos: round6(st.posOk / Math.max(1, st.notes)), notes: st.notes, swingStraight: st.sw.n ? round6(st.sw.straight / st.sw.n) : null, swingBeats: st.sw.n };
}
function evalSummary(all) {
  const by = {};
  Array.from(all.byProfile.keys()).sort().forEach(p => { by[p] = { legacy: summary(all.byProfile.get(p).legacy), model: summary(all.byProfile.get(p).v2) }; });
  return { performances: all.performances, all: { legacy: summary(all.legacy), model: summary(all.v2) }, byProfile: by };
}

function main() {
  const evals = args('--eval');
  const opts = { noisy: has('--noisy'), legacyOnly: has('--legacy-only') };
  const check = has('--check'), write = has('--write'), doEval = has('--evaluate');
  const given = arg('--data') || arg('--train-dir');
  const dir = given || fs.mkdtempSync(path.join(os.tmpdir(), 'ppp-grid-'));
  if (given) fs.mkdirSync(dir, { recursive: true });
  const names = ['train'].concat(doEval ? ['holdout', 'robust', 'open'] : []);
  let data;
  if (arg('--train')) data = { train: load(arg('--train')) };            /* development: a given training file */
  else data = dataset(dir, names, !!given && !check);
  if (data.train.some(r => r.holdout)) { console.error('the training set holds a hold-out reference'); process.exit(2); }
  const model = fit(data.train);
  const text = JSON.stringify(model, null, 1) + '\n';
  let bad = 0;
  if (check) {
    const same = fs.existsSync(MODEL_PATH) && fs.readFileSync(MODEL_PATH, 'utf8').replace(/\r\n/g, '\n') === text;
    console.log((same ? 'same ' : 'DIFFERS ') + path.relative(REPO, MODEL_PATH).split(path.sep).join('/'));
    bad += !same;
  }
  if (write) { fs.writeFileSync(MODEL_PATH, text); console.log('wrote ' + path.relative(REPO, MODEL_PATH).split(path.sep).join('/')); }
  if (has('--print')) console.log(text);
  opts.model = model;
  if (doEval) {
    const out = { schema: 'ppp.rec-grid-evaluation/1', model: model.name + '@' + model.version, tool: 'tests/bench/tools/train_grid.js --evaluate',
      what: 'the grid stage alone: the true beat times given (and moved by up to +-20 ms), legacy quantiser vs the model, pooled counts',
      sets: {} };
    ['holdout', 'robust', 'open'].forEach(name => {
      const comp = st => ({ beats: st.beats, kind: round6(st.kindOk / Math.max(1, st.beats)), b16: pr(st.b32), onsetPos: round6(st.posOk / Math.max(1, st.notes)), notes: st.notes });
      const c0 = evaluateCompound(data[name], name, opts), c1 = evaluateCompound(data[name], name, Object.assign({}, opts, { noisy: true }));
      out.sets[name] = { data: DATA[name].join(' '), beats: evalSummary(evaluate(data[name], name, opts)),
        noisyBeats: evalSummary(evaluate(data[name], name, Object.assign({}, opts, { noisy: true }))),
        compound: { performances: c0.performances, beats: { legacy: comp(c0.legacy), model: comp(c0.v2) }, noisyBeats: { legacy: comp(c1.legacy), model: comp(c1.v2) } } };
    });
    const etext = JSON.stringify(out, null, 1) + '\n';
    if (check) {
      const same = fs.existsSync(EVAL_PATH) && fs.readFileSync(EVAL_PATH, 'utf8').replace(/\r\n/g, '\n') === etext;
      console.log((same ? 'same ' : 'DIFFERS ') + path.relative(REPO, EVAL_PATH).split(path.sep).join('/'));
      bad += !same;
    }
    if (write) { fs.writeFileSync(EVAL_PATH, etext); console.log('wrote ' + path.relative(REPO, EVAL_PATH).split(path.sep).join('/')); }
  }
  if (has('--train-eval')) evaluate(data.train, 'train', opts);
  if (has('--fallback')) opts.model = G.FALLBACK;
  evals.forEach(p => { const rows = load(p); evaluate(rows, 'eval ' + path.basename(p), opts); evaluateCompound(rows, path.basename(p), opts); });
  if (!given && !arg('--train')) fs.rmSync(dir, { recursive: true, force: true });
  process.exit(bad ? 1 : 0);
}

main();
