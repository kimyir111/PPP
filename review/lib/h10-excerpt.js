/* G10a-5 (H-10): which seconds of a piece the review shows, the same seconds for both arms.

   The two arms of a recording number their bars differently (v2 reads the downbeat a beat away from the classic reading in the teacher's own
   piece, and may read another metre), so the region is chosen in TIME, from the heard notes alone, and each arm then shows the bars that
   cover those seconds (at most one bar of margin at each end). Deterministic, no randomness:

     length    `seconds` when given (the command line or the item), else `bars` (default 12) times the mean of the two arms' median bar
               length, kept between MIN_SECONDS and MAX_SECONDS and never longer than the piece
     start     `start` when given (an item's override, in seconds), else the window that
                 - is sounding for at least 95% of its length (no silence: a window is cut in 0.25 s steps and a step counts when some
                   heard note sounds at its middle),
                 - holds at least 60% of the onsets per second that the piece's median window holds (no near-empty stretch of long notes),
                 - and lies closest to the middle of the piece (the first of two equally close ones, the earlier);
               when no window has both properties, the one with the most sounding steps, then the most onsets, then the one closest to
               the middle
     bars      per arm, from its own bar starts (seconds, `built.stats.barStarts`): the bar that holds `start` through the bar that holds
               `start + length` (the end belongs to the bar before the one that begins exactly there). */
'use strict';

const STEP = 0.25, MIN_SECONDS = 6, MAX_SECONDS = 60, DEFAULT_BARS = 12, SOUNDING_SHARE = 0.95, DENSITY_SHARE = 0.6;

const median = xs => { const s = xs.slice().sort((a, b) => a - b); const n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : 0; };
const r3 = v => Math.round(v * 1000) / 1000;

/* the median bar length of one arm, in seconds, from its bar starts (the last entry is the end of the last bar) */
function medianBarSeconds(barStarts) {
  const d = [];
  for (let i = 1; i < barStarts.length; i++) { const x = barStarts[i] - barStarts[i - 1]; if (isFinite(x) && x > 0) d.push(x); }
  return median(d);
}

/* the bars [i0, i1] (0-based, inclusive) of an arm that cover [start, end] */
function barsCovering(barStarts, start, end) {
  const n = barStarts.length - 1;
  if (n < 1) throw new Error('an arm has no bars');
  let i0 = 0;
  for (let i = 0; i < n; i++) if (barStarts[i] <= start + 1e-9) i0 = i;
  let i1 = i0;
  for (let i = i0; i < n; i++) if (barStarts[i] < end - 1e-9) i1 = i;
  return [i0, i1];
}

/* heard: [{on, off, midi}] in seconds. -> { start, end, seconds, how } (no bars: they depend on the arm) */
function chooseWindow(heard, opts) {
  opts = opts || {};
  const notes = heard.filter(n => isFinite(n.on) && isFinite(n.off) && n.off > n.on);
  if (!notes.length) throw new Error('no heard notes to choose an excerpt from');
  const first = Math.min.apply(null, notes.map(n => n.on)), last = Math.max.apply(null, notes.map(n => n.off));
  const span = last - first;
  let W = opts.seconds > 0 ? +opts.seconds : Math.min(MAX_SECONDS, Math.max(MIN_SECONDS, (opts.bars || DEFAULT_BARS) * (opts.barSeconds || 2)));
  W = Math.min(W, span);
  if (opts.start != null && isFinite(opts.start)) {
    const s = Math.max(first, Math.min(+opts.start, Math.max(first, last - W)));
    return { start: r3(s), end: r3(s + W), seconds: r3(W), how: 'given start' + (s !== +opts.start ? ' (moved inside the piece)' : '') };
  }
  /* 0.25 s steps from the first heard onset: sounding[k] and onsets[k] for the step k */
  const steps = Math.max(1, Math.ceil(span / STEP));
  const sounding = new Uint8Array(steps), onsets = new Uint16Array(steps);
  notes.forEach(n => {
    const a = Math.floor((n.on - first) / STEP), b = Math.min(steps - 1, Math.floor((n.off - first) / STEP));
    if (a >= 0 && a < steps) onsets[a] = Math.min(65535, onsets[a] + 1);
    for (let k = Math.max(0, a); k <= b; k++) { const mid = first + (k + 0.5) * STEP; if (n.on <= mid && mid < n.off) sounding[k] = 1; }
  });
  const pre = (arr, f) => { const p = new Float64Array(arr.length + 1); for (let i = 0; i < arr.length; i++) p[i + 1] = p[i] + f(arr[i]); return p; };
  const ps = pre(sounding, x => x), po = pre(onsets, x => x);
  const len = Math.max(1, Math.round(W / STEP));
  const cands = [];
  for (let k = 0; k <= Math.max(0, steps - len); k++) {
    const hi = Math.min(steps, k + len);
    cands.push({ k: k, s: first + k * STEP, sound: (ps[hi] - ps[k]) / Math.max(1, hi - k), dens: (po[hi] - po[k]) / ((hi - k) * STEP) });
  }
  const mid = first + span / 2, dist = c => Math.abs(c.s + (len * STEP) / 2 - mid);
  const medDens = median(cands.map(c => c.dens));
  const ok = cands.filter(c => c.sound >= SOUNDING_SHARE - 1e-9 && c.dens >= DENSITY_SHARE * medDens - 1e-9);
  const byMid = (a, b) => dist(a) - dist(b) || a.k - b.k;
  let pick, how;
  if (ok.length) { pick = ok.slice().sort(byMid)[0]; how = 'the sounding, dense window closest to the middle of the piece'; }
  else { pick = cands.slice().sort((a, b) => b.sound - a.sound || b.dens - a.dens || byMid(a, b))[0]; how = 'no window is sounding throughout and dense: the one with the most sound'; }
  return { start: r3(pick.s), end: r3(pick.s + W), seconds: r3(W), how: how, sounding: r3(pick.sound), onsetsPerSecond: r3(pick.dens), pieceMedianOnsetsPerSecond: r3(medDens) };
}

/* the whole choice for an item: heard notes and each arm's bar starts -> { start, end, seconds, how, arms: { name: { bars: [i0, i1], covers: [t0, t1], count } } } */
function pickExcerpt(o) {
  const names = Object.keys(o.barStarts);
  /* `lengthArms` (G10b-0, the engine comparison): the arms whose bar length sets the default length of the window; every arm still shows the bars that cover it */
  const lengthNames = (o.lengthArms || names).filter(n => o.barStarts[n]);
  const bars = lengthNames.map(n => medianBarSeconds(o.barStarts[n])).filter(x => x > 0);
  const barSeconds = bars.length ? bars.reduce((a, b) => a + b, 0) / bars.length : 2;
  const w = chooseWindow(o.heard, { seconds: o.seconds, start: o.start, bars: o.bars, barSeconds: barSeconds });
  const arms = {};
  names.forEach(n => {
    const bs = o.barStarts[n], win = barsCovering(bs, w.start, w.end);
    arms[n] = { bars: win, count: win[1] - win[0] + 1, covers: [r3(bs[win[0]]), r3(bs[win[1] + 1])] };
  });
  return Object.assign({}, w, { barSeconds: r3(barSeconds), arms: arms });
}

module.exports = { pickExcerpt, chooseWindow, barsCovering, medianBarSeconds, STEP, MIN_SECONDS, MAX_SECONDS, DEFAULT_BARS };
