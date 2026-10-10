/* ============================================================================
   PPP rec/key.js - stage S8 of the recording conversion v2: key signature, tonal regions, spelling
   (docs/GOALS/G10_AUDIO_TO_SCORE.md sections 6 and 8: "S8 key + spelling"; G10a-3, lane B)

     analyse(notes, ctx) -> {
       key:      { fifths, mode, tonic, margin, conf }        the key signature written first
       regions:  [{ from, to, fifths, mode, tonic }]          tonal regions, bar indices, every bar in exactly one
       changes:  [{ bar, fifths, mode, tonic }]               key signatures written after the first (usually none)
       spell:    [{ step, alter }]                            the spelling of every input note, input order
       report:   { version, bars, regions, changes, ... }
     }

   notes: [{ midi, tick, endTick?, staff?, vel? }] as audio-score.js's quantized notes (24 ticks a quarter; `tick` from
   the first bar line). ctx: { barTicks, bars, ticksPerQuarter (24), regions (true), line (false) }.

   What it does and why (every constant below was fitted on the non-hold-out catalogue and is evaluated on the hold-out
   in rec/tools/key-v1.evaluation.json; docs/GOALS/G10 section 22 has the measurements):
   - The first key is chosen from 24 candidates by Krumhansl-Kessler correlation and diatonic fit (audio-score.js's
     estimateKey), but on durations to the next onset of the same staff (G10-D4: a release says nothing about a value, and a
     pedal makes every heard release long), with the first and last bass notes and a small prior for a simple signature.
   - Tonal regions (modulations) by windows and a Viterbi over the bars (the idea of scoregraph/pro-spell.js regionKeys,
     G03 section 10.2); a region spells its notes from its own key. A new key SIGNATURE is written only for a long, clearly
     different region that saves accidentals (the catalogue has one such piece in 312: composers rarely change signature).
   - Spelling: the key's table (diatonic notes by the signature, each other pitch class spelled in the direction the mode
     prefers), the same table audio-score.js spells with, taken from the note's region.
   - printedAccidental(): the engraving rule the benchmark checks (an accidental applies to its step and octave on its
     staff to the end of the bar; a tied-over note neither needs one nor changes what is in force).

   Pure and deterministic: no Date, no Math.random, no exp/log, ties broken in a fixed order. Node: require('./rec/key.js');
   browser: rec/key.js (window.PPPRecKey, registered as PPPRecModules.key).
   ========================================================================== */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else { const M = root.PPPRecModules = root.PPPRecModules || {}; M.key = root.PPPRecKey = factory(); }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const VERSION = 'key/1';
  const KK_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
  const KK_MINOR = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
  const MAJOR_FIFTHS = { 0: 0, 7: 1, 2: 2, 9: 3, 4: 4, 11: 5, 6: 6, 1: -5, 8: -4, 3: -3, 10: -2, 5: -1 };
  const SCALE = { major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10] };
  const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
  const LETTER_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const SHARP_ORDER = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
  const CHROMATIC = { major: { 1: 1, 3: -1, 6: 1, 8: 1, 10: -1 }, minor: { 1: -1, 4: 1, 6: 1, 9: 1, 11: 1 } };

  /* The constants (fitted on the catalogue, section 22). FIT: weight of the diatonic fit next to the correlation;
     PRIOR: per sharp or flat of the signature; FIRST/LAST: the piece starts or ends on the tonic in the bass; LAST_IN: the
     last chord holds it. WINDOW/HOP/CHANGE/FIFTH/MIN: tonal regions as scoregraph/pro-spell.js KEY_W. */
  const W = Object.freeze({ FIT: 4, PRIOR: 0.08, FIRST: 0.25, LAST: 0.1, LAST_IN: 0.1, LAST_SPAN: 0,
    WINDOW: 8, HOP: 4, MIN: 4, CHANGE: 1.5, FIFTH: 0.5,
    SIG_MIN_BARS: 8, SIG_MIN_FIFTHS: 2, SIG_SAVE: 8, SIG_SAVE_SHARE: 0.06 });

  /* ------------------------------------------------------------------ keys */
  function mod12(x) { return ((x % 12) + 12) % 12; }
  function fifthsOf(tonic, mode) {
    const rel = mode === 'major' ? tonic : (tonic + 3) % 12;
    let f = MAJOR_FIFTHS[rel];
    if (mode === 'minor' && rel === 6) f = -6;
    return f;
  }
  function corr(a, b) {
    const ma = a.reduce((s, x) => s + x, 0) / a.length, mb = b.reduce((s, x) => s + x, 0) / b.length;
    let n = 0, da = 0, db = 0;
    for (let i = 0; i < a.length; i++) { n += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) * (a[i] - ma); db += (b[i] - mb) * (b[i] - mb); }
    return n / Math.sqrt(da * db || 1);
  }
  /* the 24 keys scored on a pitch-class histogram: [{tonic, mode, fifths, r, fit}] (no extras) */
  function keyScores(h) {
    const total = h.reduce((s, x) => s + x, 0) || 1;
    const out = [];
    for (let t = 0; t < 12; t++) {
      const hr = h.map((_, i) => h[(i + t) % 12]);
      ['major', 'minor'].forEach(mode => {
        const r = corr(hr, mode === 'major' ? KK_MAJOR : KK_MINOR);
        const fit = SCALE[mode].reduce((s, pc) => s + h[(t + pc) % 12], 0) / total;
        out.push({ tonic: t, mode: mode, fifths: fifthsOf(t, mode), r: r, fit: fit });
      });
    }
    return out;
  }

  /* ----------------------------------------------------------- the evidence */
  /* onset groups per staff and the weight of every note: quarters to the next onset of its staff, at most two (a release is
     not a value: G10-D4). Returns {w: [weight per note], groups: [{tick, idx: [note indices], staff}]} */
  function evidence(notes, tpq) {
    const byStaff = new Map();
    notes.forEach((n, i) => {
      if (!(n && isFinite(n.midi))) return;
      const s = n.staff === 2 ? 2 : 1;
      if (!byStaff.has(s)) byStaff.set(s, new Map());
      const m = byStaff.get(s);
      if (!m.has(n.tick)) m.set(n.tick, []);
      m.get(n.tick).push(i);
    });
    const w = new Array(notes.length).fill(0);
    const groups = [];
    byStaff.forEach((m, staff) => {
      const ticks = Array.from(m.keys()).sort((a, b) => a - b);
      ticks.forEach((t, k) => {
        const idx = m.get(t);
        let span;
        if (k + 1 < ticks.length) span = ticks[k + 1] - t;
        else { let e = t; idx.forEach(i => { if (notes[i].endTick > e) e = notes[i].endTick; }); span = Math.max(e - t, tpq / 2); }
        const q = Math.min(2, span / tpq);
        idx.forEach(i => { w[i] = q; });
        groups.push({ tick: t, idx: idx, staff: staff, q: q });
      });
    });
    groups.sort((a, b) => a.tick - b.tick || a.staff - b.staff);
    return { w: w, groups: groups };
  }

  function histogram(notes, w, from, to, barOf) {
    const h = new Array(12).fill(0);
    for (let i = 0; i < notes.length; i++) {
      if (!(w[i] > 0)) continue;
      const b = barOf[i];
      if (b < from || b >= to) continue;
      h[mod12(notes[i].midi)] += w[i];
    }
    return h;
  }

  /* The first key: every candidate by the correlation, the diatonic fit and the cues of the piece's ends. */
  function chooseKey(notes, ev, opts) {
    opts = opts || {};
    const c = Object.assign({}, W, opts.weights || {});
    const h = new Array(12).fill(0);
    notes.forEach((n, i) => { if (ev.w[i] > 0) h[mod12(n.midi)] += ev.w[i]; });
    let firstBass = -1, lastBass = -1, lastPcs = [];
    if (ev.groups.length) {
      const lowest = g => g.idx.reduce((m, i) => Math.min(m, notes[i].midi), 999);
      const firstTick = ev.groups[0].tick, lastTick = ev.groups[ev.groups.length - 1].tick;
      const firstGs = ev.groups.filter(g => g.tick === firstTick);
      /* the last bass: the lowest note struck at the piece's last onset (LAST_SPAN ticks back from it: 0, the best of 0 / 12 / 24 / 48 / 96 on the catalogue) */
      const lastGs = ev.groups.filter(g => g.tick >= lastTick - (opts.lastSpan != null ? opts.lastSpan : c.LAST_SPAN));
      firstBass = mod12(Math.min.apply(null, firstGs.map(lowest)));
      lastBass = mod12(Math.min.apply(null, lastGs.map(lowest)));
      lastGs.forEach(g => g.idx.forEach(i => lastPcs.push(mod12(notes[i].midi))));
    }
    const cands = keyScores(h).map(k => {
      const extra = (k.tonic === firstBass ? c.FIRST : 0) + (k.tonic === lastBass ? c.LAST : 0) + (lastPcs.indexOf(k.tonic) >= 0 ? c.LAST_IN : 0);
      const score = k.r + c.FIT * k.fit + extra - c.PRIOR * Math.abs(k.fifths);
      return Object.assign({ score: Math.round(score * 1e6) / 1e6 }, k);
    });
    /* best first; ties: fewer accidentals, then the lower tonic, then major */
    cands.sort((a, b) => b.score - a.score || Math.abs(a.fifths) - Math.abs(b.fifths) || a.tonic - b.tonic || (a.mode === 'major' ? -1 : 1));
    const best = cands[0];
    const other = cands.find(k => k.fifths !== best.fifths);
    return { best: best, margin: other ? best.score - other.score : best.score, cands: cands };
  }

  /* ------------------------------------------------------------- spelling */
  function keyAlters(fifths) {
    const a = { C: 0, D: 0, E: 0, F: 0, G: 0, A: 0, B: 0 };
    if (fifths > 0) SHARP_ORDER.slice(0, fifths).forEach(l => { a[l] = 1; });
    if (fifths < 0) SHARP_ORDER.slice().reverse().slice(0, -fifths).forEach(l => { a[l] = -1; });
    return a;
  }
  /* the spelling table of a key: the diatonic steps of its signature, every other pitch class spelled from its neighbour in
     the direction the mode prefers (the table audio-score.js spells with) */
  function spellingTable(key, plain) {
    const ka = keyAlters(key.fifths);
    const table = {};
    LETTERS.forEach(l => { table[mod12(LETTER_PC[l] + ka[l])] = { step: l, alter: ka[l] }; });
    const dirs = CHROMATIC[key.mode] || CHROMATIC.major;
    for (let pc = 0; pc < 12; pc++) {
      if (table[pc]) continue;
      const dir = dirs[mod12(pc - key.tonic)] || (key.fifths < 0 ? -1 : 1);
      const from = table[mod12(pc - dir)];
      /* plain (a song: opts.songLayers): a double sharp or flat only when the other neighbour needs one too - F# major's D is
         D, not C double-sharp. The catalogue writes the raised fifth (B major's F double-sharp), so only a song asks for it */
      const alt = table[mod12(pc + dir)];
      if (plain && from && Math.abs(from.alter + dir) > 1 && alt && Math.abs(alt.alter - dir) <= 1) { table[pc] = { step: alt.step, alter: alt.alter - dir }; continue; }
      table[pc] = from ? { step: from.step, alter: from.alter + dir } : { step: 'C', alter: 0 };
    }
    return table;
  }
  /* the pitch of a MIDI number under a table, as {step, alter, octave} (octave of the spelled letter: B#3 is C4's sound) */
  function pitchOf(midi, sp) {
    return { step: sp.step, alter: sp.alter, octave: Math.floor((midi - sp.alter) / 12) - 1 };
  }

  /* ---------------------------------------------------------- the regions */
  /* the tonal key of every bar: windows scored by the correlation and fit (no cues of the ends), a Viterbi with a free start
     whose change costs CHANGE plus FIFTH a fifth; a key lasts at least MIN bars. Bars without a window (a piece shorter than
     WINDOW + HOP bars) keep the first key. Returns [{fifths, mode, tonic}] per bar. */
  function barKeys(notes, ev, barOf, bars, first, c) {
    const out = [];
    for (let i = 0; i < bars; i++) out.push(first);
    if (bars < c.WINDOW + c.HOP) return out;
    const starts = [];
    for (let st = 0; st + c.WINDOW <= bars; st += c.HOP) starts.push(st);
    if (starts[starts.length - 1] + c.WINDOW < bars) starts.push(bars - c.WINDOW);
    const wins = starts.map(st => {
      const h = histogram(notes, ev.w, st, st + c.WINDOW, barOf);
      return keyScores(h).map(k => Object.assign(k, { s: Math.round((k.r + c.FIT * k.fit) * 1000) }));
    });
    const K = 24, change = Math.round(c.CHANGE * 1000), fifth = Math.round(c.FIFTH * 1000);
    /* a free start: the first region may be another key than the piece's best overall (a piece that opens in its minor and
       ends in the major); a later region changes key only when its windows outweigh the change */
    let cost = wins[0].map(k => -k.s);
    const back = [];
    for (let w = 1; w < wins.length; w++) {
      const next = [], arg = [];
      for (let j = 0; j < K; j++) {
        let best = Infinity, bi = 0;
        for (let i = 0; i < K; i++) {
          const df = Math.abs(wins[w - 1][i].fifths - wins[w][j].fifths);
          const t = i === j ? 0 : change + fifth * Math.min(12 - df, df);
          if (cost[i] + t < best) { best = cost[i] + t; bi = i; }
        }
        next.push(best - wins[w][j].s);
        arg.push(bi);
      }
      back.push(arg);
      cost = next;
    }
    let j = 0;
    for (let i = 1; i < K; i++) if (cost[i] < cost[j]) j = i;
    const path = new Array(wins.length);
    for (let w = wins.length - 1; w >= 0; w--) { path[w] = j; if (w > 0) j = back[w - 1][j]; }
    const keyOfBar = [];
    for (let i = 0; i < bars; i++) {
      let bw = 0;
      starts.forEach((st, w) => { if (Math.abs(st + c.WINDOW / 2 - (i + 0.5)) < Math.abs(starts[bw] + c.WINDOW / 2 - (i + 0.5))) bw = w; });
      const k = wins[bw][path[bw]];
      keyOfBar.push({ fifths: k.fifths, mode: k.mode, tonic: k.tonic });
    }
    /* a change lands on the bar, between two windows' middles, that best splits the bars' own diatonic fit */
    const bh = [];
    for (let i = 0; i < bars; i++) bh.push(histogram(notes, ev.w, i, i + 1, barOf));
    const fitOf = (i, k) => { const t = bh[i].reduce((x, y) => x + y, 0); return t ? SCALE[k.mode].reduce((x, pc) => x + bh[i][(k.tonic + pc) % 12], 0) / t : 1; };
    for (let w = 1; w < wins.length; w++) {
      const A = wins[w - 1][path[w - 1]], B = wins[w][path[w]];
      if (A.fifths === B.fifths && A.mode === B.mode) continue;
      const lo = Math.max(0, Math.floor(starts[w - 1] + c.WINDOW / 2)), hi = Math.min(bars, Math.ceil(starts[w] + c.WINDOW / 2));
      let bestAt = lo, bestV = -Infinity;
      for (let b = lo; b <= hi; b++) {
        let v = 0;
        for (let i = lo; i < hi; i++) v += i < b ? fitOf(i, A) : fitOf(i, B);
        if (v > bestV + 1e-9) { bestV = v; bestAt = b; }
      }
      for (let i = lo; i < hi; i++) keyOfBar[i] = i < bestAt ? { fifths: A.fifths, mode: A.mode, tonic: A.tonic } : { fifths: B.fifths, mode: B.mode, tonic: B.tonic };
    }
    /* a key that would last fewer than MIN bars is not a region */
    for (let i = 1; i < bars; i++) {
      if (keyOfBar[i].fifths === keyOfBar[i - 1].fifths && keyOfBar[i].mode === keyOfBar[i - 1].mode) continue;
      let j2 = i;
      while (j2 < bars && keyOfBar[j2].fifths === keyOfBar[i].fifths && keyOfBar[j2].mode === keyOfBar[i].mode) j2++;
      if (j2 - i < c.MIN) for (let x = i; x < j2; x++) keyOfBar[x] = keyOfBar[i - 1];
    }
    return keyOfBar;
  }

  function regionsOf(keyOfBar) {
    const regions = [];
    let from = 0;
    for (let i = 1; i <= keyOfBar.length; i++) {
      if (i === keyOfBar.length || keyOfBar[i].fifths !== keyOfBar[from].fifths || keyOfBar[i].mode !== keyOfBar[from].mode) {
        regions.push({ from: from, to: i - 1, fifths: keyOfBar[from].fifths, mode: keyOfBar[from].mode, tonic: keyOfBar[from].tonic });
        from = i;
      }
    }
    return regions;
  }

  /* The key signatures to write (after the first, or instead of it at bar 0). A region is written only when it is long (SIG_MIN_BARS), two or more
     fifths from the signature in force (a closer key is written with accidentals: the engraver's habit, G03 section 24),
     and the new signature saves at least SIG_SAVE accidentals and SIG_SAVE_SHARE of the region's notes. A region that
     returns to the signature in force is a change back, under the same test. */
  function signatureChanges(notes, ev, barOf, regions, first, c, spellOf) {
    const changes = [];
    let inForce = first.fifths;
    regions.forEach((r, ri) => {
      /* region 0 is tested too: a piece that opens in another key than its best overall (C minor, then C major) is written
         in the key it opens in (a change at bar 0) */
      if (r.fifths === inForce) return;
      if (r.to - r.from + 1 < c.SIG_MIN_BARS) return;
      const df = Math.abs(r.fifths - inForce);
      if (Math.min(12 - df, df) < c.SIG_MIN_FIFTHS) return;
      const under = f => {
        const ka = keyAlters(f);
        let n = 0, all = 0;
        for (let i = 0; i < notes.length; i++) {
          if (!(ev.w[i] > 0)) continue;
          const b = barOf[i];
          if (b < r.from || b > r.to) continue;
          all++;
          const sp = spellOf(i);
          if (ka[sp.step] !== sp.alter) n++;
        }
        return { n: n, all: all };
      };
      const old = under(inForce), neu = under(r.fifths);
      const saved = old.n - neu.n;
      if (saved >= c.SIG_SAVE && old.all && saved >= c.SIG_SAVE_SHARE * old.all) {
        changes.push({ bar: r.from, fifths: r.fifths, mode: r.mode, tonic: r.tonic, saved: saved });
        inForce = r.fifths;
      }
    });
    return changes;
  }

  /* ----------------------------------------------------------------- analyse */
  function analyse(notes, ctx) {
    ctx = ctx || {};
    const tpq = ctx.ticksPerQuarter || 24;
    const c = Object.assign({}, W, ctx.weights || {});
    const barTicks = ctx.barTicks > 0 ? ctx.barTicks : 4 * tpq;
    let bars = ctx.bars > 0 ? ctx.bars : 0;
    if (!bars) notes.forEach(n => { if (n && n.bar != null && isFinite(n.bar)) bars = Math.max(bars, (n.bar | 0) + 1); else if (n && isFinite(n.tick)) bars = Math.max(bars, Math.floor(n.tick / barTicks) + 1); });
    bars = Math.max(1, bars);
    const ev = evidence(notes, tpq);
    /* a note may name its bar (a score whose bars are not all one length); otherwise the bar is tick / barTicks */
    const barOf = notes.map(n => (n && n.bar != null && isFinite(n.bar) ? Math.max(0, Math.min(bars - 1, n.bar | 0))
      : n && isFinite(n.tick) ? Math.max(0, Math.min(bars - 1, Math.floor(n.tick / barTicks))) : 0));
    const chosen = chooseKey(notes, ev, { weights: ctx.weights });
    const best = chosen.best;
    const key = { fifths: best.fifths, mode: best.mode, tonic: best.tonic, margin: Math.round(chosen.margin * 1e4) / 1e4,
      score: best.score, r: best.r, diatonicFit: best.fit };
    const keyOfBar = ctx.regions === false ? new Array(bars).fill({ fifths: key.fifths, mode: key.mode, tonic: key.tonic }) : barKeys(notes, ev, barOf, bars, key, c);
    const regions = regionsOf(keyOfBar);
    const tables = new Map();
    const tableOf = k => { const id = k.fifths + ':' + k.mode + ':' + k.tonic; if (!tables.has(id)) tables.set(id, spellingTable(k, !!ctx.plain)); return tables.get(id); };
    const spell = notes.map((n, i) => {
      if (!(n && isFinite(n.midi))) return null;
      const t = tableOf(keyOfBar[barOf[i]])[mod12(n.midi)];
      return { step: t.step, alter: t.alter };
    });
    const changes = signatureChanges(notes, ev, barOf, regions, key, c, i => spell[i]);
    /* a change at bar 0 is the opening key */
    if (changes.length && changes[0].bar === 0) {
      const o = changes.shift();
      key.fifths = o.fifths; key.mode = o.mode; key.tonic = o.tonic; key.opening = 'region';
    }
    return { key: key, regions: regions, changes: changes, spell: spell,
      report: { version: VERSION, bars: bars, notes: notes.length, regions: regions.length, changes: changes.length,
        weights: { FIT: c.FIT, PRIOR: c.PRIOR } } };
  }

  /* --------------------------------------------------- printed accidentals */
  /* The accidentals of one staff, bar by bar. begin(fifths) starts a bar (the signature in force); next(step, octave, alter,
     tieStop) returns true when the head prints an accidental. A tied-over head needs none and changes nothing (the
     benchmark's rule and G03 section 10.3); a note that is not tied prints one when its alteration is not the one in force
     (the signature's, or the last printed on that step and octave in this bar). */
  function accidentals() {
    let sig = keyAlters(0), state = {};
    return {
      begin: function (fifths) { sig = keyAlters(fifths); state = {}; },
      next: function (step, octave, alter, tieStop) {
        if (tieStop) return false;
        const k = step + octave;
        const cur = k in state ? state[k] : sig[step];
        const print = alter !== cur;
        state[k] = alter;
        return print;
      }
    };
  }

  return Object.freeze({ VERSION, W, analyse, chooseKey, keyScores, spellingTable, pitchOf, keyAlters, accidentals, barKeys, regionsOf, evidence });
});
