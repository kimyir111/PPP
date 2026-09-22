/* ============================================================================
   PPP — from the notes in a recording to a score

   A transcription model hears notes: when each key went down, when it came
   up, how hard, and when the pedal moved. It does not hear bars, beats, hands
   or how a pitch should be spelled. This file works those out and writes
   MusicXML, so a recording enters PPP through exactly the same parser as a
   file someone engraved by hand — nothing downstream knows the difference.

     notes ─ cluster ─ beats ─ metre & grid (incl. 6/8, triplets) ─ key ─ hands ─ MusicXML

   Optional inputs, none required:
     input.beats / input.downbeats  — audio-derived times (Beat This)
     input.grid                     — already-quantized musical ticks (PM2S)
     opts.lock                      — metre, BPM, first downbeat; re-quantize only

   Every step is a plain, explainable heuristic, and every one reports how
   sure it was, because a rhythm guessed from a rubato performance is a guess
   and PPP says so rather than presenting it as the composer's.

   Runs in the browser (window.PPPAudioScore) and in Node (require), with no
   dependencies, so it can be tested without a page.
   ========================================================================== */
(function (global) {
  'use strict';

  const FPS = 100;            /* onset envelope frames per second */
  const Q = 24;               /* ticks per quarter: 16ths (6), 32nds (3), triplet 8ths (8) */
  const SUB = 4;              /* ordinary 16ths per quarter */
  const MIN_BPM = 40, MAX_BPM = 200;
  const CLUSTER_S = 0.05;     /* rolled-chord window, seconds */

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const median = xs => {
    if (!xs.length) return 0;
    const s = xs.slice().sort((a, b) => a - b);
    const h = s.length >> 1;
    return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2;
  };

  /* ---------------------------------------------------------------- clean */
  function clean(notes) {
    return (notes || [])
      .filter(n => n && isFinite(n.on) && isFinite(n.off) && n.midi >= 21 && n.midi <= 108)
      .filter(n => (n.vel == null ? 64 : n.vel) >= 8)
      .map(n => {
        const out = { on: Math.max(0, +n.on), off: Math.max(+n.on + 0.03, +n.off), midi: n.midi | 0, vel: n.vel == null ? 64 : +n.vel };
        if (n._arrangeId != null) out._arrangeId = n._arrangeId;
        return out;
      })
      .sort((a, b) => a.on - b.on || a.midi - b.midi);
  }

  /* Notes whose onsets sit inside CLUSTER_S of the first of a group are one
     attack — a rolled chord, not a run of sixteenths. */
  /* Keep the tune and the bass; drop inner accompaniment notes. A YouTube
     "piano accompaniment" of a simple song is otherwise written denser than
     the page in the video. */
  function simplifyNotes(notes) {
    return arrangeNotes(notes, { level: 'beginner', style: 'balanced' });
  }

  const ARRANGEMENT_LIMITS = { original: 99, beginner: 2, intermediate: 3, advanced: 5 };
  const ARRANGEMENT_STYLES = ['balanced', 'melody', 'accompaniment'];

  /* The model may choose a profile, but it never gets to invent pitches. This
     normalizer is the hard boundary shared by local and AI-assisted arranging. */
  function normaliseArrangement(spec) {
    if (typeof spec === 'string') spec = { level: spec };
    spec = spec || {};
    let level = String(spec.level || 'intermediate').toLowerCase();
    if (level === 'easy') level = 'beginner';
    if (!Object.prototype.hasOwnProperty.call(ARRANGEMENT_LIMITS, level)) level = 'intermediate';
    let style = String(spec.style || 'balanced').toLowerCase();
    if (ARRANGEMENT_STYLES.indexOf(style) < 0) style = 'balanced';
    const ceiling = ARRANGEMENT_LIMITS[level];
    const requested = isFinite(+spec.maxNotesPerAttack) ? Math.round(+spec.maxNotesPerAttack) : ceiling;
    return {
      level: level,
      style: style,
      maxNotesPerAttack: level === 'original' ? 99 : clamp(requested, 1, ceiling),
      reason: String(spec.reason || '').slice(0, 240),
      source: spec.source === 'ai' ? 'ai' : 'local'
    };
  }

  function attackGroups(notes) {
    const groups = [];
    let i = 0;
    while (i < notes.length) {
      const t0 = notes[i].attack != null ? notes[i].attack : notes[i].on;
      let j = i + 1;
      while (j < notes.length) {
        const t = notes[j].attack != null ? notes[j].attack : notes[j].on;
        if (Math.abs(t - t0) > 0.004) break;
        j++;
      }
      groups.push(notes.slice(i, j));
      i = j;
    }
    return groups;
  }

  function arrangementProfile(notes) {
    const src = clusterNotes(clean(notes), CLUSTER_S);
    const groups = attackGroups(src);
    const attacks = groups.map(g => g[0].attack != null ? g[0].attack : g[0].on);
    const gaps = attacks.slice(1).map((t, i) => t - attacks[i]).filter(x => x > 0.004);
    const sizes = groups.map(g => g.length);
    const pitches = src.map(n => n.midi);
    const start = src.length ? src[0].on : 0;
    const end = src.reduce((m, n) => Math.max(m, n.off), start);
    const rapid = gaps.filter(g => g < 0.16).length;
    return {
      notes: src.length,
      attacks: groups.length,
      seconds: Math.round((end - start) * 10) / 10,
      notesPerSecond: Math.round(src.length / Math.max(1, end - start) * 10) / 10,
      averageNotesPerAttack: Math.round(src.length / Math.max(1, groups.length) * 100) / 100,
      peakNotesPerAttack: sizes.length ? Math.max.apply(null, sizes) : 0,
      rapidAttackRatio: Math.round(rapid / Math.max(1, gaps.length) * 100) / 100,
      pitchSpan: pitches.length ? Math.max.apply(null, pitches) - Math.min.apply(null, pitches) : 0
    };
  }

  function recommendArrangement(notes, target) {
    const profile = arrangementProfile(notes);
    const plan = normaliseArrangement({ level: target || 'intermediate' });
    if (profile.rapidAttackRatio >= 0.4) plan.style = 'melody';
    else if (profile.averageNotesPerAttack >= 2.3) plan.style = 'balanced';
    else if (profile.pitchSpan >= 42) plan.style = 'accompaniment';
    plan.reason = profile.rapidAttackRatio >= 0.4
      ? 'Fast passages were detected, so the melodic line is protected while chord density is reduced.'
      : profile.averageNotesPerAttack >= 2.3
        ? 'Dense chords were detected, so outer voices are kept and inner voices are limited.'
        : 'The texture is already clear, so only simultaneous-note density is limited.';
    return { plan: plan, profile: profile };
  }

  /* Select notes from each performed attack. Timing and pitch are never
     generated: an arrangement is always a verifiable subset of what was heard. */
  function arrangeNotes(notes, spec) {
    const plan = normaliseArrangement(spec);
    const src = clusterNotes(clean(notes), CLUSTER_S);
    if (plan.level === 'original') return src.map(n => Object.assign({}, n));
    const out = [];
    attackGroups(src).forEach(group => {
      const g = group.slice().sort((a, b) => a.midi - b.midi);
      const groupLimit = plan.style === 'melody' ? Math.min(2, plan.maxNotesPerAttack) : plan.maxNotesPerAttack;
      if (g.length <= groupLimit) {
        g.forEach(n => out.push(Object.assign({}, n)));
        return;
      }
      const chosen = [], used = new Set();
      const take = n => {
        if (!n || used.has(n.midi) || chosen.length >= groupLimit) return;
        used.add(n.midi); chosen.push(n);
      };
      const lo = g[0], hi = g[g.length - 1];
      if (plan.style === 'melody') {
        take(hi);
        if (hi.midi - lo.midi >= 7) take(lo);
      } else if (plan.style === 'accompaniment') {
        take(lo); take(hi);
        const targets = [lo.midi + 7, lo.midi + 12, lo.midi + 16];
        targets.forEach(p => take(g.reduce((best, n) => Math.abs(n.midi - p) < Math.abs(best.midi - p) ? n : best, g[0])));
      } else {
        take(lo); take(hi);
      }
      /* Fill any remaining capacity with evenly spaced inner voices. */
      while (chosen.length < groupLimit && used.size < g.length) {
        let best = null, distance = -1;
        g.forEach(n => {
          if (used.has(n.midi)) return;
          const d = chosen.length ? Math.min.apply(null, chosen.map(c => Math.abs(c.midi - n.midi))) : 0;
          if (d > distance) { best = n; distance = d; }
        });
        take(best);
      }
      chosen.sort((a, b) => a.midi - b.midi).forEach(n => out.push(Object.assign({}, n)));
    });
    return out.sort((a, b) => a.on - b.on || a.midi - b.midi);
  }

  function clusterNotes(notes, window) {
    window = window == null ? CLUSTER_S : window;
    const out = notes.map(n => Object.assign({}, n));
    /* Four or more evenly-spaced attacks inside the rolled-chord window are a
       run/trill, not one very wide chord. A fixed 50 ms grouping window used
       to collapse 32nd-note passages at fast tempi into simultaneous notes. */
    const slotOf = [], slots = [];
    out.forEach((n, i) => {
      if (!slots.length || n.on - slots[slots.length - 1] > 0.004) slots.push(n.on);
      slotOf[i] = slots.length - 1;
    });
    const rapid = new Set();
    let run = null;
    for (let s = 1; s <= slots.length; s++) {
      const gap = s < slots.length ? slots[s] - slots[s - 1] : Infinity;
      /* At 120 BPM a 32nd note is about 62.5 ms apart.  The old 1.2
         multiplier (60 ms for the 50 ms chord window) classified those first
         attacks as a rolled chord before quantization could see the run. */
      if (gap >= 0.012 && gap <= window * 1.5) {
        if (run == null) run = s - 1;
      } else {
        if (run != null && s - run >= 4) for (let k = run; k < s; k++) rapid.add(k);
        run = null;
      }
    }
    let i = 0;
    while (i < out.length) {
      const t0 = out[i].on;
      let j = i + 1;
      while (j < out.length && out[j].on - t0 <= window) {
        /* Notes from the same onset slot remain a chord even inside a run. */
        if (slotOf[j] !== slotOf[i] && (rapid.has(slotOf[i]) || rapid.has(slotOf[j]))) break;
        j++;
      }
      /* A rolled chord can span a few more milliseconds than the nominal
         window. Extend only a short, non-run group; fast scalar passages are
         protected by the rapid-slot set above. */
      while (j < out.length && j - i < 4 && out[j].on - t0 <= window * 1.35 &&
        !rapid.has(slotOf[i]) && !rapid.has(slotOf[j])) j++;
      let sum = 0;
      for (let k = i; k < j; k++) sum += out[k].on;
      const attack = sum / (j - i);
      for (let k = i; k < j; k++) out[k].attack = attack;
      i = j;
    }
    return out;
  }

  /* --------------------------------------------------------------- beats */
  function envelope(notes, length) {
    const env = new Float64Array(length);
    notes.forEach(n => {
      const t = n.attack != null ? n.attack : n.on;
      const i = Math.round(t * FPS);
      if (i < 0 || i >= length) return;
      let w = 0.35 + n.vel / 127;
      if (n.midi < 55) w *= 1.4;
      env[i] += w;
    });
    const out = new Float64Array(length);
    const k = [0.06, 0.24, 0.4, 0.24, 0.06];
    for (let i = 0; i < length; i++) {
      let s = 0;
      for (let j = -2; j <= 2; j++) { const x = i + j; if (x >= 0 && x < length) s += env[x] * k[j + 2]; }
      out[i] = s;
    }
    return out;
  }

  function estimatePeriod(env) {
    const minLag = Math.floor(FPS * 60 / MAX_BPM), maxLag = Math.ceil(FPS * 60 / MIN_BPM);
    const ac = new Float64Array(maxLag * 2 + 2);
    for (let lag = minLag; lag <= Math.min(maxLag * 2, env.length - 1); lag++) {
      let s = 0;
      for (let i = lag; i < env.length; i++) s += env[i] * env[i - lag];
      ac[lag] = s;
    }
    let best = minLag, bestScore = -1;
    for (let lag = minLag; lag <= maxLag; lag++) {
      const bpm = 60 * FPS / lag;
      const prior = Math.exp(-0.5 * Math.pow(Math.log2(bpm / 100) / 0.9, 2));
      const s = (ac[lag] + 0.5 * (ac[lag * 2] || 0)) * prior;
      if (s > bestScore) { bestScore = s; best = lag; }
    }
    const a = ac[best - 1] || 0, b = ac[best], c = ac[best + 1] || 0;
    const d = a - 2 * b + c;
    return d < 0 ? best + clamp(0.5 * (a - c) / d, -0.5, 0.5) : best;
  }

  function localPeriods(env, period) {
    const n = env.length;
    const win = 8 * FPS, hop = FPS;
    const lagLo = Math.max(2, Math.floor(period * 0.7)), lagHi = Math.ceil(period * 1.4);
    const raw = [];
    for (let c = 0; c < n; c += hop) {
      const a = Math.max(0, c - win / 2), b = Math.min(n, c + win / 2);
      let best = period, bs = 0;
      for (let lag = lagLo; lag <= lagHi; lag++) {
        let s = 0;
        for (let i = a + lag; i < b; i++) s += env[i] * env[i - lag];
        s *= Math.exp(-0.5 * Math.pow(Math.log(lag / period) / 0.25, 2));
        if (s > bs) { bs = s; best = lag; }
      }
      raw.push(best);
    }
    const smooth = raw.map((v, i) => median(raw.slice(Math.max(0, i - 2), i + 3)));
    const P = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const x = i / hop, k = Math.floor(x), f = x - k;
      const p0 = smooth[Math.min(k, smooth.length - 1)], p1 = smooth[Math.min(k + 1, smooth.length - 1)];
      P[i] = p0 + (p1 - p0) * f;
    }
    return P;
  }

  function trackBeats(env, period, P) {
    const n = env.length;
    let mean = 0, sq = 0;
    for (let i = 0; i < n; i++) { mean += env[i]; sq += env[i] * env[i]; }
    mean /= n;
    const sd = Math.sqrt(Math.max(1e-9, sq / n - mean * mean));
    const local = new Float64Array(n);
    for (let i = 0; i < n; i++) local[i] = env[i] / sd;

    const tight = 100;
    const score = new Float64Array(n);
    const back = new Int32Array(n).fill(-1);
    let peak = 0;
    for (let i = 0; i < n; i++) peak = Math.max(peak, local[i]);
    const floor = 0.01 * peak;
    let started = false;
    for (let i = 0; i < n; i++) {
      const p = P ? P[i] : period;
      const lo = Math.round(p / 2), hi = Math.round(p * 2);
      let best = -Infinity, arg = -1;
      for (let j = i - hi; j <= i - lo; j++) {
        if (j < 0) continue;
        const r = Math.log((i - j) / p);
        const v = score[j] - tight * r * r;
        if (v > best) { best = v; arg = j; }
      }
      score[i] = local[i] + (arg >= 0 ? best : 0);
      if (!started && local[i] < floor) { back[i] = -1; continue; }
      started = true;
      back[i] = arg;
    }
    const peaks = [];
    for (let i = 1; i < n - 1; i++) if (score[i] > score[i - 1] && score[i] >= score[i + 1]) peaks.push(i);
    if (!peaks.length) return [];
    const thresh = 0.5 * median(peaks.map(i => score[i]));
    let end = peaks[peaks.length - 1];
    for (let k = peaks.length - 1; k >= 0; k--) { if (score[peaks[k]] >= thresh) { end = peaks[k]; break; } }
    const beats = [];
    for (let i = end; i >= 0; i = back[i]) { beats.push(i); if (back[i] < 0) break; }
    return beats.reverse().map(f => f / FPS);
  }

  function alignStart(beats, first) {
    const out = beats.filter(b => b >= first - 0.05);
    if (out.length < 2) return beats;
    const step = out[1] - out[0];
    if (out[0] - first > 0.02 && out[0] - first < 0.35 * step) out[0] = first;
    return out;
  }

  function extendBeats(beats, from, to, onsets) {
    if (beats.length < 2) return beats;
    const out = beats.slice();
    const near = (t, step) => {
      let best = null, bd = step * 0.3;
      for (let i = 0; i < onsets.length; i++) {
        const d = Math.abs(onsets[i] - t);
        if (d < bd) { bd = d; best = onsets[i]; }
      }
      return best;
    };
    while (out[0] - from > 0.35 * (out[1] - out[0])) {
      const step = out[1] - out[0];
      const t = out[0] - step;
      const hit = onsets ? near(t, step) : null;
      out.unshift(hit != null && hit < out[0] - step * 0.5 ? hit : t);
    }
    let step = out[out.length - 1] - out[out.length - 2];
    while (out[out.length - 1] < to + step) out.push(out[out.length - 1] + step);
    return out;
  }

  function beatPosition(beats, t) {
    let lo = 0, hi = beats.length - 1;
    if (t <= beats[0]) return (t - beats[0]) / (beats[1] - beats[0]);
    if (t >= beats[hi]) return hi + (t - beats[hi]) / (beats[hi] - beats[hi - 1]);
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (beats[mid] <= t) lo = mid; else hi = mid; }
    return lo + (t - beats[lo]) / (beats[lo + 1] - beats[lo]);
  }

  function ibiOf(beats) {
    const d = [];
    for (let i = 1; i < beats.length; i++) d.push(beats[i] - beats[i - 1]);
    return d;
  }

  /* Beat trackers occasionally switch to eighth-note pulses for a fast run,
     then back to quarters, or miss a pulse in a quiet bar. Repair those tempo
     octave slips before they become compressed/expanded notation. Gradual
     rubato remains: only half/double-beat mistakes are added/removed, while a
     median + slew-limited interval curve suppresses one-beat tempo jumps. */
  function stabilizeBeats(input) {
    const raw = (input || []).filter(Number.isFinite).slice().sort((a, b) => a - b)
      .filter((t, i, a) => !i || t - a[i - 1] > 0.02);
    if (raw.length < 4) return raw;
    const base = median(ibiOf(raw));
    if (!(base > 0)) return raw;
    const repaired = [raw[0]];
    let target = base, skipped = 0, inserted = 0;
    for (let i = 1; i < raw.length; i++) {
      const t = raw[i], gap = t - repaired[repaired.length - 1];
      /* A pulse near half the established interval is a subdivision. */
      if (gap < target * 0.62) { skipped++; continue; }
      /* A gap near two or three intervals means the tracker missed beats. */
      if (gap > target * 1.62) {
        const n = Math.max(2, Math.min(4, Math.round(gap / target)));
        const step = gap / n;
        if (Math.abs(step - target) <= target * 0.24) {
          for (let k = 1; k < n; k++) repaired.push(repaired[repaired.length - 1] + step);
          inserted += n - 1;
        }
      }
      const acceptedGap = t - repaired[repaired.length - 1];
      repaired.push(t);
      if (acceptedGap >= base * 0.68 && acceptedGap <= base * 1.42)
        target = target * 0.88 + acceptedGap * 0.12;
    }
    if (repaired.length < 4) return raw;

    const gaps = ibiOf(repaired);
    const local = gaps.map((_, i) => median(gaps.slice(Math.max(0, i - 2), Math.min(gaps.length, i + 3))));
    const smooth = [];
    let prev = median(local) || base;
    local.forEach(v => {
      prev = clamp(v, prev * 0.86, prev * 1.16);
      smooth.push(prev);
    });
    const fitted = [repaired[0]];
    smooth.forEach(v => fitted.push(fitted[fitted.length - 1] + v));
    const fittedSpan = fitted[fitted.length - 1] - fitted[0];
    const realSpan = repaired[repaired.length - 1] - repaired[0];
    const scale = fittedSpan > 0 ? realSpan / fittedSpan : 1;
    for (let i = 1; i < fitted.length; i++) fitted[i] = fitted[0] + (fitted[i] - fitted[0]) * scale;
    fitted._repairs = skipped + inserted;
    return fitted;
  }

  function foldFastBeats(beats, env, notes, onsets, last) {
    let bpm = 60 / median(ibiOf(beats));
    let out = beats;
    while (bpm > 150 && out.length > 8) {
      const even = [], odd = [];
      out.forEach((b, i) => (i % 2 ? odd : even).push(b));
      const strength = list => list.reduce((s, b) => s + (env[Math.round(b * FPS)] || 0), 0) / Math.max(1, list.length);
      out = strength(even) >= strength(odd) ? even : odd;
      out = extendBeats(out, notes[0].on, last, onsets);
      bpm = 60 / median(ibiOf(out));
    }
    return out;
  }

  /* A beat tracker can lock onto a half-note or dotted-half pulse in dense,
     fast piano. Keep that stable pulse, but make faster quarter-note
     hypotheses by interpolating it. The competing grids are compared later
     in seconds, not in fractions of their differently-sized beats. */
  function subdivideBeats(beats, factor) {
    if (!beats || beats.length < 2 || factor < 2) return beats ? beats.slice() : [];
    const out = [];
    for (let i = 0; i < beats.length - 1; i++) {
      const a = beats[i], d = (beats[i + 1] - a) / factor;
      for (let k = 0; k < factor; k++) out.push(a + d * k);
    }
    out.push(beats[beats.length - 1]);
    return out;
  }

  /* Seconds per written beat (quarter, or dotted quarter in 6/8). */
  function spbLock(lock) {
    const bpm = +lock.bpm;
    if (!isFinite(bpm) || bpm <= 0) return 0.5;
    const beats = lock.beats || lock.beatsPerBar || 4;
    const beatType = lock.beatType || 4;
    if (beatType >= 8 && beats % 3 === 0) return 60 / bpm; /* dotted-quarter pulse */
    return 60 / bpm;
  }

  function beatsFromLock(lock, notes) {
    const last = notes.reduce((m, n) => Math.max(m, n.off), 0);
    const first = notes[0].on;
    const t0 = lock.firstDownbeat != null && isFinite(+lock.firstDownbeat) ? +lock.firstDownbeat : first;
    const beatsN = lock.beats || lock.beatsPerBar || 4;
    const beatType = lock.beatType || 4;
    const compound = beatType >= 8 && beatsN % 3 === 0;
    /* Internal interpolation is in quarters, so a 6/8 bar is three quarters. */
    const spq = compound ? spbLock(lock) * 2 / 3 : spbLock(lock);
    const out = [];
    const start = t0;
    const end = last + spq * 2;
    for (let t = start; t <= end + 1e-9; t += spq) out.push(t);
    /* pickup: beats before t0 so early notes still have a pair */
    while (out[0] > first - spq * 0.2) out.unshift(out[0] - spq);
    if (out.length < 2) out.push(out[0] + spq);
    return out;
  }

  /* -------------------------------------------------------------- snap */
  const LEVEL_COST_16 = [0, 0.025, 0.06, 0.08];
  /* Snap an onset to a straight subdivision.  Older versions only considered
     sixteenth notes, so a genuine 32nd-note run was silently collapsed into
     pairs of sixteenths.  Keep the readable-value penalty, but let a finer
     grid win when it explains the measured onset materially better. */
  function snapStraight(pos, spb, subdivisions) {
    subdivisions = subdivisions === 8 ? 8 : 4;
    const k = Math.floor(pos);
    const f = pos - k;
    spb = spb || 0.6;
    let best = 0, bestCost = Infinity;
    for (let s = 0; s <= subdivisions; s++) {
      const c = s / subdivisions;
      const level = s === 0 || s === subdivisions ? 0 : (s % 2 === 0 ? 1 : 2);
      /* A fine grid is deliberately a little more expensive even when its
         point is exact: at an ordinary 16th the coarse spelling is clearer. */
      const finePenalty = subdivisions === 8 && s > 0 && s < subdivisions ? 0.035 : 0;
      const cost = Math.abs(f - c) * spb + (subdivisions === 4 ? LEVEL_COST_16[level] : finePenalty);
      if (cost < bestCost) { bestCost = cost; best = s; }
    }
    const frac = best / subdivisions;
    return {
      frac: frac, err: Math.abs(f - frac),
      kind: subdivisions === 8 ? '32nd' : '16th',
      subdivision: subdivisions, cost: bestCost
    };
  }

  function snap16(pos, spb) { return snapStraight(pos, spb, 4); }

  /* Choose between a readable 16th and a necessary 32nd.  The small
     complexity penalty prevents jitter from turning every ordinary 16th into
     a 32nd, while a real fast run wins because its 16th error is much larger. */
  function snapStraightBest(pos, spb) {
    const coarse = snapStraight(pos, spb, 4);
    const fine = snapStraight(pos, spb, 8);
    return fine.cost + 1e-6 < coarse.cost ? fine : coarse;
  }

  function snapTriplet(pos, spb) {
    const k = Math.floor(pos);
    const f = pos - k;
    spb = spb || 0.6;
    let best = 0, bestCost = Infinity;
    for (let s = 0; s <= 3; s++) {
      const c = s / 3;
      const cost = Math.abs(f - c) * spb + (s % 3 === 0 ? 0 : 0.02);
      if (cost < bestCost) { bestCost = cost; best = s; }
    }
    return { frac: best / 3, err: Math.abs(f - best / 3), kind: 'triplet' };
  }

  function spbAt(beats, pos) {
    const k = clamp(Math.floor(pos), 0, beats.length - 2);
    return beats[k + 1] - beats[k];
  }

  function snapEnd(pos, subdivisions) {
    const k = Math.floor(pos);
    const f = pos - k;
    let best = 0, bestCost = Infinity;
    const steps = subdivisions === 8 ? 8 : 4;
    for (let s = 0; s <= steps; s++) {
      const c = s / steps;
      /* Releases are noisier than attacks: favour a half-beat/beat ending,
         but still permit a real 32nd duration in a fast passage. */
      const cost = Math.abs(f - c) + (c !== 0 && c !== 0.5 && c !== 1 ? 0.08 : c === 0.5 ? 0.12 : 0);
      if (cost < bestCost) { bestCost = cost; best = c; }
    }
    return k + best;
  }

  /* Which beats of the piece are filled with triplet eighths rather than
     sixteenths: three (or a multiple of three) onsets sitting on the thirds. */
  function tripletBeats(notes, beats) {
    const flags = {};
    const byBeat = {};
    notes.forEach(n => {
      const t = n.attack != null ? n.attack : n.on;
      const pos = beatPosition(beats, t);
      const k = Math.floor(pos + 1e-6);
      (byBeat[k] = byBeat[k] || []).push(pos - k);
    });
    Object.keys(byBeat).forEach(k => {
      const fs = byBeat[k];
      if (fs.length < 2) return;
      let e16 = 0, e3 = 0;
      fs.forEach(f => {
        e16 += snap16(f, 1).err;
        e3 += snapTriplet(f, 1).err;
      });
      const off16 = fs.filter(f => {
        const x = f - Math.round(f * SUB) / SUB;
        return Math.abs(x) > 0.08;
      }).length;
      if (e3 * 1.02 < e16 && (off16 >= 2 || (fs.length % 3 === 0 && fs.length >= 3))) flags[+k] = true;
    });
    return flags;
  }

  function quantize(notes, beats, trip) {
    let errSum = 0;
    const q = notes.map(n => {
      const tOn = n.attack != null ? n.attack : n.on;
      const pos = beatPosition(beats, tOn);
      const k = Math.floor(pos + 1e-9);
      const useTrip = !!(trip && trip[k]);
      const a = useTrip ? snapTriplet(pos, spbAt(beats, pos)) : snapStraightBest(pos, spbAt(beats, pos));
      const endPos = snapEnd(beatPosition(beats, n.off), useTrip ? 4 : a.subdivision);
      errSum += a.err;
      const startQ = k + a.frac;
      let tick = Math.round(startQ * Q);
      let endTick = Math.round(endPos * Q);
      if (useTrip) {
        /* snap ticks onto the 8-tick (triplet-eighth) lattice within the beat */
        const base = k * Q;
        tick = base + Math.round((tick - base) / 8) * 8;
        endTick = Math.max(tick + 8, base + Math.round((endTick - base) / 8) * 8);
      } else {
        const unit = a.subdivision === 8 ? 3 : 6;
        tick = Math.round(tick / unit) * unit;
        endTick = Math.max(tick + unit, Math.round(endTick / unit) * unit);
      }
      return {
        midi: n.midi, vel: n.vel, on: n.on, off: n.off, attack: tOn,
        tick: tick, endTick: endTick, err: a.err, tuplet: useTrip,
        subdivision: useTrip ? 3 : (a.subdivision || 4),
        lenTicks: Math.max(1, endTick - tick)
      };
    });
    /* a clustered attack shares one tick */
    const byAtt = {};
    q.forEach((n, i) => {
      const key = n.attack.toFixed(4);
      if (byAtt[key] == null) byAtt[key] = n.tick;
      else n.tick = byAtt[key];
      n.endTick = Math.max(n.tick + (n.tuplet ? 8 : n.subdivision >= 8 ? 3 : 6), n.endTick);
      n.lenTicks = n.endTick - n.tick;
      q[i] = n;
    });
    return { q: q, errSum: errSum };
  }

  function gridErrorSeconds(qnotes, beats) {
    if (!qnotes.length || beats.length < 2) return Infinity;
    const errors = qnotes.map(n => {
      const pos = beatPosition(beats, n.attack != null ? n.attack : n.on);
      return (n.err || 0) * spbAt(beats, pos);
    }).sort((a, b) => a - b);
    /* Trim the noisiest tenth: AMT occasionally emits an onset between real
       notes, and one false note must not decide the tempo octave. */
    const keep = Math.max(1, Math.floor(errors.length * 0.9));
    let sum = 0;
    for (let i = 0; i < keep; i++) sum += errors[i];
    return sum / keep;
  }

  function quantizeCompound(notes, beats) {
    const q = notes.map(n => {
      const tOn = n.attack != null ? n.attack : n.on;
      const pos = beatPosition(beats, tOn);
      const coarse = Math.round(pos * 6) / 6;
      const fine = Math.round(pos * 12) / 12;
      const spb = spbAt(beats, pos);
      const coarseCost = Math.abs(pos - coarse) * spb;
      const fineCost = Math.abs(pos - fine) * spb + 0.012;
      const useFine = fineCost + 1e-6 < coarseCost;
      const subdivision = useFine ? 12 : 6;
      const snapped = useFine ? fine : coarse;
      const tick = Math.round(snapped * 36);
      const rawEnd = beatPosition(beats, n.off);
      const endPos = snapEnd(rawEnd, useFine ? 8 : 4);
      const endTick = Math.max(tick + (useFine ? 3 : 6), Math.round(endPos * 36));
      return {
        midi: n.midi, vel: n.vel, on: n.on, off: n.off, attack: tOn,
        tick: tick, endTick: endTick,
        err: Math.abs(pos - snapped), subdivision: subdivision,
        tuplet: false, lenTicks: endTick - tick
      };
    });
    const byAtt = {};
    q.forEach(n => {
      const key = n.attack.toFixed(4);
      if (byAtt[key] == null) byAtt[key] = n.tick;
      else n.tick = byAtt[key];
      n.endTick = Math.max(n.tick + (n.subdivision >= 12 ? 3 : 6), n.endTick);
    });
    return q;
  }

  /* ------------------------------------------------------- metre & downbeat */
  function accents(qnotes, nBeats, beatTicks) {
    beatTicks = beatTicks || Q;
    const bass = new Float64Array(nBeats), rest = new Float64Array(nBeats);
    const lowest = {};
    qnotes.forEach(n => { if (lowest[n.tick] == null || n.midi < lowest[n.tick]) lowest[n.tick] = n.midi; });
    qnotes.forEach(n => {
      if (n.tick % beatTicks) return;
      const k = n.tick / beatTicks;
      if (k < 0 || k >= nBeats) return;
      const w = (0.35 + n.vel / 127) * (1 + Math.min(4, n.lenTicks / beatTicks) / 2);
      if (n.midi === lowest[n.tick] && n.midi < 60) bass[k] = Math.max(bass[k], w * (1 + (60 - n.midi) / 24));
      else rest[k] += w;
    });
    const acc = new Float64Array(nBeats);
    for (let k = 0; k < nBeats; k++) acc[k] = bass[k] + 0.35 * Math.log(1 + rest[k]);
    return acc;
  }
  function meterAndPhase(acc) {
    let mean = 0;
    for (let i = 0; i < acc.length; i++) mean += acc[i];
    mean = mean / Math.max(1, acc.length) || 1;
    const rate = m => {
      let best = { m: m, phase: 0, contrast: 0 };
      for (let p = 0; p < m; p++) {
        let s = 0, c = 0;
        for (let k = p; k < acc.length; k += m) { s += acc[k]; c++; }
        const contrast = c ? (s / c) / mean : 0;
        if (contrast > best.contrast) best = { m: m, phase: p, contrast: contrast };
      }
      return best;
    };
    const two = rate(2), three = rate(3), four = rate(4);
    /* four is far more common, so three has to win clearly; two only if it
       is obviously stronger than four (a march, not a 4/4 with a backbeat). */
    if (three.contrast > four.contrast * 1.08 && three.contrast >= two.contrast) return three;
    if (two.contrast > four.contrast * 1.15) return two;
    return four;
  }

  /* 6/8 vs 3/4: same bar length (three quarters). 6/8 puts weight on the two
     dotted quarters; 3/4 puts it on the three quarters. */
  function compoundVsThree(qnotes, origin) {
    const bar = 3 * Q;
    let s68 = 0, s34 = 0, eighths = 0;
    qnotes.forEach(note => {
      const t = note.tick - origin;
      if (t < 0) return;
      const pos = ((t % bar) + bar) % bar;
      const w = 0.35 + note.vel / 127;
      const bass = note.midi < 55 ? 1.8 : 0.7;
      if (pos % 12 === 0) eighths++;
      if (pos === 0 || pos === 36) s68 += w * bass * 2.2;
      if (pos === 0 || pos === 24 || pos === 48) s34 += w * bass;
    });
    return { s68: s68, s34: s34, eighths: eighths };
  }

  function metreFromDownbeats(beats, downbeats) {
    if (!downbeats || downbeats.length < 2 || !beats || beats.length < 4) return null;
    const ibi = median(ibiOf(beats));
    const ibar = median(ibiOf(downbeats));
    if (!(ibi > 0) || !(ibar > 0)) return null;
    const n = Math.round(ibar / ibi);
    if (n === 3) return { beats: 3, beatType: 4, pulses: 3 };
    if (n === 4) return { beats: 4, beatType: 4, pulses: 4 };
    if (n === 2) return { beats: 2, beatType: 4, pulses: 2 };
    if (n === 6) return { beats: 6, beatType: 8, pulses: 6 };
    return null;
  }

  /* ------------------------------------------------------------------ key */
  const KK_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
  const KK_MINOR = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
  const MAJOR_FIFTHS = { 0: 0, 7: 1, 2: 2, 9: 3, 4: 4, 11: 5, 6: 6, 1: -5, 8: -4, 3: -3, 10: -2, 5: -1 };
  function corr(a, b) {
    const ma = a.reduce((s, x) => s + x, 0) / a.length, mb = b.reduce((s, x) => s + x, 0) / b.length;
    let n = 0, da = 0, db = 0;
    for (let i = 0; i < a.length; i++) { n += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2; }
    return n / Math.sqrt(da * db || 1);
  }
  function estimateKey(notes) {
    const h = new Array(12).fill(0);
    notes.forEach(n => {
      const dur = n.off != null && n.on != null ? Math.min(2, n.off - n.on)
        : n.endTick != null ? Math.min(2, (n.endTick - n.tick) / Q) : 0.5;
      h[n.midi % 12] += dur * (0.5 + (n.vel || 64) / 127);
    });
    const total = h.reduce((s, x) => s + x, 0) || 1;
    const scales = {
      major: [0, 2, 4, 5, 7, 9, 11],
      minor: [0, 2, 3, 5, 7, 8, 10]
    };
    let best = { fifths: 0, mode: 'major', tonic: 0, r: -2, score: -9 }, second = -9;
    for (let t = 0; t < 12; t++) {
      const rot = i => h[(i + t) % 12];
      const hr = h.map((_, i) => rot(i));
      const rM = corr(hr, KK_MAJOR), rm = corr(hr, KK_MINOR);
      [[rM, 'major'], [rm, 'minor']].forEach(([r, mode]) => {
        const fit = scales[mode].reduce((s, pc) => s + h[(t + pc) % 12], 0) / total;
        /* Correlation estimates the tonal centre. Diatonic fit estimates the
           key signature that produces the fewest accidentals on the page.
           Dense/chromatic piano can stress the dominant enough to fool the
           first signal alone, so notation needs both. */
        const score = r + 1.8 * fit;
        if (score > best.score) {
          second = best.score;
          const rel = mode === 'major' ? t : (t + 3) % 12;
          let fifths = MAJOR_FIFTHS[rel];
          if (mode === 'minor' && rel === 6) fifths = -6;
          best = { fifths: fifths, mode: mode, tonic: t, r: r, score: score, diatonicFit: fit };
        } else if (score > second) second = score;
      });
    }
    best.margin = best.score - second;
    return best;
  }

  /* ------------------------------------------------------------- spelling */
  const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
  const LETTER_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const SHARP_ORDER = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
  function keyAlters(fifths) {
    const a = { C: 0, D: 0, E: 0, F: 0, G: 0, A: 0, B: 0 };
    if (fifths > 0) SHARP_ORDER.slice(0, fifths).forEach(l => { a[l] = 1; });
    if (fifths < 0) SHARP_ORDER.slice().reverse().slice(0, -fifths).forEach(l => { a[l] = -1; });
    return a;
  }
  const CHROMATIC = {
    major: { 1: 1, 3: -1, 6: 1, 8: 1, 10: -1 },
    minor: { 1: -1, 4: 1, 6: 1, 9: 1, 11: 1 }
  };
  function spellingTable(key) {
    const ka = keyAlters(key.fifths);
    const table = {};
    LETTERS.forEach(l => { table[((LETTER_PC[l] + ka[l]) % 12 + 12) % 12] = { step: l, alter: ka[l] }; });
    const dirs = CHROMATIC[key.mode] || CHROMATIC.major;
    for (let pc = 0; pc < 12; pc++) {
      if (table[pc]) continue;
      const dir = dirs[(pc - key.tonic + 12) % 12] || (key.fifths < 0 ? -1 : 1);
      const from = table[(pc - dir + 12) % 12];
      table[pc] = from ? { step: from.step, alter: from.alter + dir } : { step: 'C', alter: 0 };
    }
    return table;
  }
  function spell(midi, table) {
    const s = table[midi % 12];
    return { step: s.step, alter: s.alter, octave: Math.floor((midi - s.alter) / 12) - 1 };
  }

  /* ---------------------------------------------------------------- hands */
  function splitCost(g, s) {
    let rLo = 999, rHi = -1, lLo = 999, lHi = -1, nr = 0, nl = 0;
    g.notes.forEach(n => {
      if (n.midi >= s) { nr++; rLo = Math.min(rLo, n.midi); rHi = Math.max(rHi, n.midi); }
      else { nl++; lLo = Math.min(lLo, n.midi); lHi = Math.max(lHi, n.midi); }
    });
    const over = span => (span > 12 ? (span - 12) * 1.5 : 0);
    let c = (nr ? over(rHi - rLo) : 0) + (nl ? over(lHi - lLo) : 0);
    if (nr > 5) c += (nr - 5) * 2;
    if (nl > 5) c += (nl - 5) * 2;
    if (nr && nl) c += 0.5 * Math.max(0, 7 - (rLo - lHi)) / 7;
    return c;
  }
  function centreSplit(groups) {
    let best = 60, bestCost = Infinity;
    for (let s = 48; s <= 72; s++) {
      let c = 0;
      groups.forEach(g => { c += splitCost(g, s); });
      c += 0.001 * Math.abs(s - 60);
      if (c < bestCost) { bestCost = c; best = s; }
    }
    return best;
  }
  function assignHands(qnotes) {
    const groups = [];
    const byTick = {};
    qnotes.forEach(n => {
      if (n.staff) return;
      if (!byTick[n.tick]) { byTick[n.tick] = { tick: n.tick, notes: [] }; groups.push(byTick[n.tick]); }
      byTick[n.tick].notes.push(n);
    });
    if (!groups.length) return;
    groups.sort((a, b) => a.tick - b.tick);
    const centre = centreSplit(groups);
    const S0 = 36, S1 = 84, NS = S1 - S0 + 1;
    const local = (g, s) => splitCost(g, s) + 0.004 * Math.abs(s - centre);
    let cost = new Float64Array(NS), prevArg = [];
    for (let i = 0; i < NS; i++) cost[i] = local(groups[0], S0 + i);
    for (let g = 1; g < groups.length; g++) {
      const next = new Float64Array(NS), arg = new Int16Array(NS);
      for (let i = 0; i < NS; i++) {
        let best = Infinity, bi = 0;
        for (let j = 0; j < NS; j++) {
          const v = cost[j] + 0.08 * Math.abs(i - j);
          if (v < best) { best = v; bi = j; }
        }
        next[i] = best + local(groups[g], S0 + i);
        arg[i] = bi;
      }
      prevArg.push(arg);
      cost = next;
    }
    let i = 0;
    for (let k = 1; k < NS; k++) if (cost[k] < cost[i]) i = k;
    for (let g = groups.length - 1; g >= 0; g--) {
      const s = S0 + i;
      groups[g].notes.forEach(n => { n.staff = n.midi >= s ? 1 : 2; });
      if (g > 0) i = prevArg[g - 1][i];
    }
  }

  /* -------------------------------------------------------------- notation */
  const TYPES = {
    96: ['whole', 0], 72: ['half', 1], 48: ['half', 0], 36: ['quarter', 1],
    24: ['quarter', 0], 18: ['eighth', 1], 16: ['quarter', 0], 12: ['eighth', 0],
    9: ['16th', 1], 8: ['eighth', 0], 6: ['16th', 0], 4: ['16th', 0], 3: ['32nd', 0], 2: ['32nd', 0], 1: ['64th', 0]
  };
  function tupletOf(v) {
    if (v === 8) return { a: 3, n: 2, type: 'eighth' };
    if (v === 16) return { a: 3, n: 2, type: 'quarter' };
    if (v === 4) return { a: 3, n: 2, type: '16th' };
    return null;
  }

  /* Ordinary written values, excluding the three values that mean a triplet
     only when the detector explicitly marked the event as one. */
  const STRAIGHT_VALUES = [96, 72, 48, 36, 24, 18, 12, 9, 6, 3, 2, 1];

  /* A recording gives us key-up time, not the composer's choice between a
     tied syncopation and an articulated note followed by space. Inside a
     simple-time bar prefer the nearest single readable value. This keeps
     release noise from being engraved as a chain of invented ties. We do not
     touch notes that really cross a bar line: those ties carry structural
     information and must remain. */
  function readableEnd(start, end, next, bar, beat, isTuplet) {
    if (beat !== Q || end <= start) return end;
    const local = ((start % bar) + bar) % bar;
    const boundary = start + (bar - local);
    if (end >= boundary - 1e-6) return end;
    const room = Math.min(boundary - start, next === Infinity ? Infinity : next - start);
    const values = isTuplet ? STRAIGHT_VALUES.concat([16, 8, 4]) : STRAIGHT_VALUES;
    const allowed = values.filter(v => v <= room && v < bar);
    if (!allowed.length) return end;
    const len = end - start;
    allowed.sort((a, b) => Math.abs(a - len) - Math.abs(b - len) || a - b);
    return start + allowed[0];
  }

  /* A length in ticks, broken into values a player can read: nothing
     crosses a beat unless it starts on one. beat is 24 (quarter) or 36 (6/8). */
  function pieces(pos, len, bar, beat) {
    beat = beat || Q;
    const out = [];
    const tupletLens = { 4: 1, 8: 1, 16: 1 };
    while (len > 0) {
      let v;
      if (tupletLens[len] && (pos % beat) + len <= beat) {
        v = len;
      } else if (pos % beat) {
        const room = Math.min(len, beat - (pos % beat));
        v = [18, 12, 9, 8, 6, 4, 3, 1].find(x => x <= room &&
          (x !== 18 || pos % 6 === 0) &&
          (x !== 12 || pos % 12 === 0 || (pos % beat) === 12) &&
          (x !== 8 || pos % 8 === 0)) || Math.min(room, 6) || 1;
      } else {
        v = [96, 72, 48, 36, 24, 18, 12, 8, 6].find(x => x <= len && pos + x <= bar &&
          (x !== 96 || pos === 0) &&
          (x !== 72 || beat >= 24) &&
          (x !== 48 || pos % beat === 0) &&
          (x !== 8 || len === 8)) ||
          [18, 12, 8, 6, 4, 3, 1].find(x => x <= len) || 1;
      }
      out.push(v);
      pos += v; len -= v;
    }
    return out;
  }

  /* In simple time an exact ordinary value is clearer as one symbol even when
     its tail crosses a beat line. The general pieces() routine remains strict
     for rests, compound metre and real bar crossings. */
  function notePieces(pos, len, bar, beat) {
    beat = beat || Q;
    if (len > 0 && pos + len <= bar && TYPES[len] && !tupletOf(len) &&
        (beat === Q || (len <= beat && TYPES[len][1]))) return [len];
    return pieces(pos, len, bar, beat);
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
  }

  function staffEvents(notes, staff, bar, beat, allowBarTies) {
    const mine = notes.filter(n => n.staff === staff);
    const byTick = {};
    const onsets = [];
    mine.forEach(n => {
      if (!byTick[n.tick]) { byTick[n.tick] = []; onsets.push(n.tick); }
      if (!byTick[n.tick].some(x => x.midi === n.midi)) byTick[n.tick].push(n);
    });
    onsets.sort((a, b) => a - b);
    const events = [];
    onsets.forEach((t, i) => {
      const next = i + 1 < onsets.length ? onsets[i + 1] : Infinity;
      const ns = byTick[t].sort((a, b) => a.midi - b.midi);
      /* A chord has one written value. Use the lower median release so one
         ringing overtone cannot lengthen every chord tone. Do not fill the
         space before the next attack: a small key-up gap is articulation, and
         sustain-pedal time belongs to the Ped. mark, not to a printed tie. */
      const ends = ns.map(n => n.endTick).sort((a, b) => a - b);
      let end = ends[Math.floor((ends.length - 1) / 2)];
      if (next !== Infinity && end < next) {
        const span = next - t, gap = next - end;
        const local = ((t % bar) + bar) % bar;
        /* Close only a tiny release gap, and only if doing so remains one
           symbol. This cleans up detector jitter without manufacturing a tie. */
        if (gap <= Math.max(1, Math.round(span * 0.2)) &&
            notePieces(local, span, bar, beat).length === 1) end = next;
      }
      end = Math.min(end, next);
      /* A key-up inferred from audio is not evidence that the composer wrote
         a tie over the next bar line. Room/pedal decay routinely crosses that
         line and used to turn almost every bar into fake legato notation.
         A symbolic PM2S grid does carry written durations, so keep its real
         cross-bar ties. */
      if (!allowBarTies) {
        const local = ((t % bar) + bar) % bar;
        end = Math.min(end, t + (bar - local));
      }
      end = readableEnd(t, end, next, bar, beat, ns.some(n => n.tuplet));
      if (end <= t) end = Math.min(t + 6, next);
      events.push({ start: t, end: end, notes: ns, tuplet: ns.some(n => n.tuplet) });
    });
    return events;
  }

  function buildXml(model) {
    const { title, key, beatsPerBar, beatType, bpm, bars, events1, events2, pedals, table } = model;
    const beatTicks = beatType >= 8 && beatsPerBar % 3 === 0 ? Q * 3 / 2 : Q; /* dotted quarter or quarter */
    const bar = Math.round(beatsPerBar * (4 / beatType) * Q);
    const out = [];
    out.push('<?xml version="1.0" encoding="UTF-8"?>');
    out.push('<score-partwise version="3.1">');
    out.push('<work><work-title>' + esc(title) + '</work-title></work>');
    out.push('<identification><encoding><software>PPP audio transcription</software></encoding></identification>');
    out.push('<part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>');
    out.push('<part id="P1">');

    const perBar = events => {
      const buckets = [];
      for (let b = 0; b < bars; b++) buckets.push([]);
      events.forEach(e => {
        let s = e.start;
        while (s < e.end) {
          const b = Math.floor(s / bar);
          if (b >= bars) break;
          const stop = Math.min(e.end, (b + 1) * bar);
          buckets[b].push({ start: s, end: stop, notes: e.notes, tuplet: e.tuplet, tieIn: s > e.start, tieOut: stop < e.end });
          s = stop;
        }
      });
      return buckets;
    };
    const b1 = perBar(events1), b2 = perBar(events2);

    const writeStaff = (list, staff, voice, barIdx) => {
      const x = [];
      const barStart = barIdx * bar;
      let cursor = 0;
      const state = Object.assign({}, keyAlters(key.fifths));
      const accState = {};
      const pedalsHere = staff === 2 ? pedals.filter(p => p.tick >= barStart && p.tick < barStart + bar) : [];
      let pi = 0;
      const emitPedalsUpTo = (tick, atCursor) => {
        while (pi < pedalsHere.length && pedalsHere[pi].tick - barStart < tick) {
          const off = pedalsHere[pi].tick - barStart - atCursor;
          x.push('<direction placement="below"><direction-type><pedal type="' + pedalsHere[pi].type + '" line="no"/></direction-type>' +
            (off ? '<offset>' + off + '</offset>' : '') + '<staff>' + staff + '</staff></direction>');
          pi++;
        }
      };
      const rest = (from, to) => {
        const full = from === 0 && to === bar;
        pieces(from, to - from, bar, beatTicks).forEach(v => {
          emitPedalsUpTo(from + v, from);
          const t = full ? TYPES[bar] || TYPES[v] || ['whole', 0] : TYPES[v] || ['16th', 0];
          x.push('<note>' + (full ? '<rest measure="yes"/>' : '<rest/>') + '<duration>' + v + '</duration><voice>' + voice +
            '</voice><type>' + t[0] + '</type>' + (t[1] ? '<dot/>' : '') + '<staff>' + staff + '</staff></note>');
          from += v;
        });
      };
      list.forEach(ev => {
        const s = ev.start - barStart, e = ev.end - barStart;
        if (s > cursor) rest(cursor, s);
        let pos = s;
        const parts = notePieces(s, e - s, bar, beatTicks);
        const anyTuplet = ev.tuplet || parts.some(v => tupletOf(v));
        parts.forEach((v, pi2) => {
          emitPedalsUpTo(pos + v, pos);
          const tu = tupletOf(v);
          const t = tu ? [tu.type, 0] : (TYPES[v] || ['16th', 0]);
          const tieStop = pi2 > 0 || ev.tieIn, tieStart = pi2 < parts.length - 1 || ev.tieOut;
          const tupStart = anyTuplet && tu && pi2 === 0;
          const tupStop = anyTuplet && tu && pi2 === parts.length - 1;
          ev.notes.forEach((n, ci) => {
            const sp = spell(n.midi, table);
            const k = sp.step + sp.octave;
            const current = k in accState ? accState[k] : state[sp.step];
            let acc = '';
            if (sp.alter !== current && !tieStop) {
              acc = '<accidental>' + ({ '-2': 'flat-flat', '-1': 'flat', '0': 'natural', '1': 'sharp', '2': 'double-sharp' }[sp.alter]) + '</accidental>';
            }
            accState[k] = sp.alter;
            const tm = tu ? '<time-modification><actual-notes>' + tu.a + '</actual-notes><normal-notes>' + tu.n + '</normal-notes></time-modification>' : '';
            const notations = [];
            if (tieStop) notations.push('<tied type="stop"/>');
            if (tieStart) notations.push('<tied type="start"/>');
            if (tupStart && !ci) notations.push('<tuplet type="start" bracket="yes" number="1"/>');
            if (tupStop && !ci) notations.push('<tuplet type="stop" number="1"/>');
            x.push('<note>' + (ci ? '<chord/>' : '') +
              '<pitch><step>' + sp.step + '</step>' + (sp.alter ? '<alter>' + sp.alter + '</alter>' : '') + '<octave>' + sp.octave + '</octave></pitch>' +
              '<duration>' + v + '</duration>' +
              (tieStop ? '<tie type="stop"/>' : '') + (tieStart ? '<tie type="start"/>' : '') +
              '<voice>' + voice + '</voice><type>' + t[0] + '</type>' + (t[1] ? '<dot/>' : '') + tm + acc +
              '<staff>' + staff + '</staff>' +
              (notations.length ? '<notations>' + notations.join('') + '</notations>' : '') +
              '</note>');
          });
          pos += v;
        });
        cursor = e;
      });
      if (cursor < bar) rest(cursor, bar);
      emitPedalsUpTo(bar + 1, bar);
      return x.join('');
    };

    const compound = beatType >= 8 && beatsPerBar % 3 === 0;
    const metro = compound
      ? '<metronome><beat-unit>quarter</beat-unit><beat-unit-dot/><per-minute>' + bpm + '</per-minute></metronome>'
      : '<metronome><beat-unit>quarter</beat-unit><per-minute>' + bpm + '</per-minute></metronome>';

    for (let b = 0; b < bars; b++) {
      out.push('<measure number="' + (b + 1) + '">');
      if (b === 0) {
        out.push('<attributes><divisions>' + Q + '</divisions><key><fifths>' + key.fifths + '</fifths><mode>' + key.mode +
          '</mode></key><time><beats>' + beatsPerBar + '</beats><beat-type>' + beatType + '</beat-type></time><staves>2</staves>' +
          '<clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes>');
        out.push('<direction placement="above"><direction-type>' + metro + '</direction-type><staff>1</staff><sound tempo="' + bpm + '"/></direction>');
      }
      out.push(writeStaff(b1[b], 1, 1, b));
      out.push('<backup><duration>' + bar + '</duration></backup>');
      out.push(writeStaff(b2[b], 2, 5, b));
      out.push('</measure>');
    }
    out.push('</part></score-partwise>');
    return out.join('\n');
  }

  /* ------------------------------------------------------------ ScoreGraph */
  /* The same score as a ScoreGraph (docs/GOALS/G01 §15.3): buildXml's musical decisions — bars, note pieces
     and the ties between them, rest pieces, triplet values, printed accidentals, pedal marks — as a canonical,
     validated graph whose MusicXML reads back as the same music. What was heard (onsets and releases in µs,
     velocities, the pedal, bar times) stays in the graph's performance layer instead of being dropped. */
  const SCOREGRAPH_VERSION = '1.0.0';
  let scoreGraphLib = null;
  function scoreGraph() {
    if (!scoreGraphLib) {
      const lib = typeof module === 'object' && module.exports ? require('./scoregraph/index.js') : global && global.PPPScoreGraph;
      if (!lib) throw new Error('PPPScoreGraph is not loaded: scoregraph/*.js must come before audio-score.js');
      if (lib.version !== SCOREGRAPH_VERSION)
        throw new Error('scoregraph ' + lib.version + ' does not match audio-score.js (' + SCOREGRAPH_VERSION + '): reload the page');
      scoreGraphLib = lib;
    }
    return scoreGraphLib;
  }
  const ACCIDENTAL_NAME = { '-2': 'flat-flat', '-1': 'flat', '0': 'natural', '1': 'sharp', '2': 'double-sharp' };

  /* heard: {notes: [{on, off, midi, vel, staff, tick}] (every note after clean; staff and tick once placed),
     pedals: [{on, off}], barSeconds: [bars + 1 times]} */
  function buildGraph(model, heard) {
    const SG = scoreGraph(), R = SG.rational;
    const { title, key, beatsPerBar, beatType, bpm, bars, events1, events2, pedals, table } = model;
    const beatTicks = beatType >= 8 && beatsPerBar % 3 === 0 ? Q * 3 / 2 : Q;
    const bar = Math.round(beatsPerBar * (4 / beatType) * Q);
    const W = t => R.format(R.make(t, Q * 4));            /* ticks (Q a quarter) as whole notes */
    const b = SG.builder({ id: model.scoreId || 'sg-audio', meta: { title: title } });
    const src = b.source({ kind: 'audio-score', tool: 'audio-score.js', params: model.params || {} });
    b.setDefault({ src: src.id, op: 'inferred' });
    const part = b.part({ name: 'Piano', instrument: { kind: 'piano', family: 'keyboard' } });
    const st = [null, b.staff(part, { limb: 'RH' }).id, b.staff(part, { limb: 'LH' }).id];
    const voice = [null, b.voice(part, { staff: st[1], label: '1' }).id, b.voice(part, { staff: st[2], label: '5' }).id];
    const mid = [];
    for (let i = 0; i < bars; i++) mid.push(b.measure({ number: String(i + 1), dur: W(bar) }).id);
    b.meter({ m: mid[0], beats: [beatsPerBar], beatType: beatType });
    b.key({ m: mid[0], at: '0', fifths: key.fifths, mode: key.mode });
    const compound = beatType >= 8 && beatsPerBar % 3 === 0;
    /* issue 1 kept as it is: a compound tempo plays bpm quarters a minute but prints dotted quarter = bpm */
    const mark = compound ? { unit: 'quarter', dots: 1, perMinute: String(bpm) } : { unit: 'quarter', perMinute: String(bpm) };
    b.tempo({ m: mid[0], at: '0', qpm: String(bpm), mark: mark, display: [{ part: part.id, staff: st[1], placement: 'above' }] });
    b.clef(part, { staff: st[1], m: mid[0], at: '0', sign: 'G' });
    b.clef(part, { staff: st[2], m: mid[0], at: '0', sign: 'F' });

    const perBar = events => {
      const buckets = [];
      for (let i = 0; i < bars; i++) buckets.push([]);
      events.forEach(e => {
        let s = e.start;
        while (s < e.end) {
          const i = Math.floor(s / bar);
          if (i >= bars) break;
          const stop = Math.min(e.end, (i + 1) * bar);
          buckets[i].push({ start: s, end: stop, notes: e.notes, tuplet: e.tuplet, tieIn: s > e.start, tieOut: stop < e.end });
          s = stop;
        }
      });
      return buckets;
    };
    const b1 = perBar(events1), b2 = perBar(events2);
    const ties = [], tuplets = [];
    const pendingTie = [null, new Map(), new Map()];      /* staff -> midi -> the head its tie continues from */
    const headOf = new Map();                              /* staff|onset tick|midi -> the head of the event's first piece */

    const writeStaff = (list, staff, barIdx) => {
      const barStart = barIdx * bar;
      const m = mid[barIdx];
      let cursor = 0;
      const state = keyAlters(key.fifths);             /* read only here */
      const accState = {};
      const rest = (from, to) => {
        const full = from === 0 && to === bar;
        pieces(from, to - from, bar, beatTicks).forEach(v => {
          /* issue 19 kept as it is: a rest inside a triplet is printed with its plain value */
          const t = full ? (TYPES[bar] || TYPES[v] || ['whole', 0]) : (TYPES[v] || ['16th', 0]);
          const display = { type: t[0] };
          if (t[1]) display.dots = t[1];
          if (full) display.measureRest = true;
          b.event(part, { kind: 'rest', m: m, at: W(from), dur: W(v), voice: voice[staff], staff: st[staff], display: display });
          from += v;
        });
      };
      list.forEach(ev => {
        const s = ev.start - barStart, e = ev.end - barStart;
        if (s > cursor) rest(cursor, s);
        let pos = s;
        const parts = notePieces(s, e - s, bar, beatTicks);
        const anyTuplet = ev.tuplet || parts.some(v => tupletOf(v));
        parts.forEach((v, pi2) => {
          const tu = tupletOf(v);
          const t = tu ? [tu.type, 0] : (TYPES[v] || ['16th', 0]);
          const tieStop = pi2 > 0 || ev.tieIn, tieStart = pi2 < parts.length - 1 || ev.tieOut;
          const display = { type: t[0] };
          if (t[1]) display.dots = t[1];
          const heads = ev.notes.map(n => {
            const sp = spell(n.midi, table);
            const k = sp.step + sp.octave;
            const current = k in accState ? accState[k] : state[sp.step];
            const head = { pitch: sp.alter ? { step: sp.step, alter: sp.alter, oct: sp.octave } : { step: sp.step, oct: sp.octave } };
            if (sp.alter !== current && !tieStop) head.acc = { type: ACCIDENTAL_NAME[sp.alter] };
            accState[k] = sp.alter;
            return head;
          });
          const event = b.event(part, { kind: 'note', m: m, at: W(pos), dur: W(v), voice: voice[staff], staff: st[staff], display: display, heads: heads });
          ev.notes.forEach((n, ci) => {
            const id = event.heads[ci].id;
            if (tieStop) {
              const from = pendingTie[staff].get(n.midi);
              ties.push(from ? { from: from, to: id } : { to: id });
              pendingTie[staff].delete(n.midi);
            }
            if (tieStart) pendingTie[staff].set(n.midi, id);
            if (pi2 === 0 && !ev.tieIn) headOf.set(staff + '|' + ev.start + '|' + n.midi, id);
          });
          /* a triplet value is one tuplet of its own piece; the bracket shows where buildXml draws one */
          if (tu) tuplets.push({ events: [event.id], printed: !!(anyTuplet && (pi2 === 0 || pi2 === parts.length - 1)) });
          pos += v;
        });
        cursor = e;
      });
      if (bar > cursor) rest(cursor, bar);
    };
    for (let i = 0; i < bars; i++) {
      writeStaff(b1[i], 1, i);
      writeStaff(b2[i], 2, i);
    }
    [1, 2].forEach(s => pendingTie[s].forEach(from => ties.push({ from: from })));
    ties.forEach(t => b.spanner(part, Object.assign({ type: 'tie' }, t)));
    tuplets.forEach(t => {
      const x = { type: 'tuplet', events: t.events, actual: 3, normal: 2 };
      if (!t.printed) x.printed = false;
      b.spanner(part, x);
    });
    /* the pedal marks as written: start, change... stop */
    const at = tick => ({ m: mid[Math.floor(tick / bar)], at: W(tick % bar) });
    let open = null;
    const close = () => {
      const x = { type: 'pedal', pedal: 'damper', from: open.from, mark: { line: false } };
      if (open.to) x.to = open.to;
      if (open.changes.length) x.changes = open.changes;
      b.spanner(part, x);
      open = null;
    };
    pedals.forEach(p => {
      if (p.type === 'start') { if (open) close(); open = { from: at(p.tick), changes: [] }; }
      else if (p.type === 'change') { if (open) open.changes.push(at(p.tick)); else open = { from: at(p.tick), changes: [] }; }
      else if (open) { open.to = at(p.tick); close(); }
    });
    if (open) close();

    /* what was heard: every note after clean (a note the arrangement left out has no head), the pedal, and
       where each bar started in the recording (a bar that starts before the recording has no anchor) */
    if (heard) {
      const pf = b.performance({ kind: 'source', src: src.id });
      heard.notes.forEach(n => {
        const x = { on: R.secondsToMicros(n.on), off: R.secondsToMicros(n.off), vel: Math.max(1, Math.min(127, Math.round(n.vel))), midi: n.midi };
        const link = n.staff ? headOf.get(n.staff + '|' + n.tick + '|' + n.midi) : null;
        if (link) x.link = link;
        b.perfNote(pf, x);
      });
      (heard.pedals || []).forEach(p => {
        if (!(isFinite(p.on) && isFinite(p.off) && p.on >= 0 && p.off > p.on)) return;
        const on = R.secondsToMicros(+p.on), off = R.secondsToMicros(+p.off);
        if (off > on) b.perfPedal(pf, { pedal: 'damper', on: on, off: off });
      });
      (heard.barSeconds || []).forEach((sec, i) => {
        if (!(sec >= 0)) return;
        b.anchor(pf, { m: mid[Math.min(i, bars - 1)], k: 1, at: i < bars ? '0' : W(bar), us: R.secondsToMicros(sec), kind: 'bar' });
      });
    }
    return b.finish();
  }

  function noNotes() {
    const e = new Error('No piano notes were heard in this recording.');
    e.code = 'no-notes';
    throw e;
  }

  function finish(q, notes, beats, opts, extra) {
    extra = extra || {};
    const beatsPerBar = extra.beatsPerBar;
    const beatType = extra.beatType || 4;
    const ticksPerBeat = extra.ticksPerBeat || Q;
    const bar = Math.round(beatsPerBar * (4 / beatType) * Q);
    const firstTick = Math.min.apply(null, q.map(n => n.tick));
    let origin = extra.origin != null ? extra.origin : 0;
    while (origin > firstTick) origin -= bar;
    while (origin + bar <= firstTick) origin += bar;
    q.forEach(n => { n.tick -= origin; n.endTick -= origin; });
    const lastOnset = Math.max.apply(null, q.map(n => n.tick));
    const bars = Math.max(1, Math.floor(lastOnset / bar) + 1);
    q.forEach(n => { n.endTick = Math.min(n.endTick, bars * bar); });

    const key = estimateKey(notes);
    const table = spellingTable(key);
    assignHands(q);

    const pedals = [];
    const held = [];
    (extra.pedals || []).forEach(p => {
      const pp = beatPosition(beats, p.on);
      const a = Math.round(pp * Q) - origin;
      const b = Math.round(snapEnd(beatPosition(beats, p.off)) * Q) - origin;
      if (b - a < 6 || b <= 0 || a >= bars * bar) return;
      held.push([a, b]);
    });
    held.sort((x, y) => x[0] - y[0]);
    held.forEach((h, i) => {
      const prev = held[i - 1];
      if (prev && prev[1] === h[0] && pedals.length && pedals[pedals.length - 1].type === 'stop' && pedals[pedals.length - 1].tick === h[0])
        pedals[pedals.length - 1].type = 'change';
      else pedals.push({ tick: Math.max(0, h[0]), type: 'start' });
      pedals.push({ tick: Math.min(bars * bar - 1, h[1]), type: 'stop' });
    });
    const notationBeat = beatType >= 8 && beatsPerBar % 3 === 0 ? Q * 3 / 2 : Q;
    const allowBarTies = extra.quantizer === 'pm2s';
    const events1 = staffEvents(q, 1, bar, notationBeat, allowBarTies);
    const events2 = staffEvents(q, 2, bar, notationBeat, allowBarTies);

    const title = (opts.title || extra.title || 'Transcribed recording').trim() || 'Transcribed recording';
    const ibi = ibiOf(beats);
    let bpm = extra.bpm;
    if (!(bpm > 0)) {
      const qIbi = median(ibi);
      bpm = ticksPerBeat === 36 || extra.tactus === 'dotted-quarter'
        ? 60 / qIbi
        : (beatType >= 8 && beatsPerBar % 3 === 0 ? 60 / (qIbi * 1.5) : 60 / qIbi);
    }
    const roundBpm = Math.round(clamp(bpm, 30, 240));
    const xml = buildXml({
      title: title, key: key, beatsPerBar: beatsPerBar, beatType: beatType, bpm: roundBpm,
      bars: bars, events1: events1, events2: events2, pedals: pedals, table: table
    });

    const tickToSec = tick => {
      const pos = (tick + origin) / ticksPerBeat;
      const k = Math.floor(pos);
      if (k < 0) return beats[0] + pos * (beats[1] - beats[0]);
      if (k >= beats.length - 1) { const n = beats.length; return beats[n - 1] + (pos - (n - 1)) * (beats[n - 1] - beats[n - 2]); }
      return beats[k] + (pos - k) * (beats[k + 1] - beats[k]);
    };
    const barStarts = [];
    for (let b = 0; b <= bars; b++) barStarts.push(Math.round(tickToSec(b * bar) * 1000) / 1000);

    const perBar = [];
    for (let b = 0; b < bars; b++) perBar.push({ err: 0, n: 0, sec: barStarts[b + 1] - barStarts[b] });
    q.forEach(n => { const b = Math.floor(n.tick / bar); if (perBar[b]) { perBar[b].err += n.err || 0; perBar[b].n++; } });
    const d = ibi;
    const med = median(d);
    const cv = Math.sqrt(d.reduce((s, x) => s + (x - med) * (x - med), 0) / Math.max(1, d.length)) / (med || 1);
    const medBar = median(perBar.map(p => p.sec));
    const errSum = extra.errSum || q.reduce((s, n) => s + (n.err || 0), 0);

    const result = {
      xml: xml,
      stats: {
        notes: notes.length, bars: bars, beatsPerBar: beatsPerBar, beatType: beatType, tempo: roundBpm,
        key: key, keyMargin: key.margin, meterContrast: extra.meterContrast || 1,
        gridError: errSum / Math.max(1, notes.length),
        tempoVariation: cv,
        barStarts: barStarts,
        beats: beats.map(b => Math.round(b * 1000) / 1000),
        rh: q.filter(n => n.staff === 1).length, lh: q.filter(n => n.staff === 2).length,
        quantizer: extra.quantizer || 'heuristic',
        beatSource: extra.beatSource || 'onset',
        tempoAlias: extra.tempoAlias || null,
        tempoCandidates: extra.tempoCandidates || [],
        beatRepairs: extra.beatRepairs || 0,
        arrangement: extra.arrangement || null,
        originalNotes: extra.originalNotes || notes.length,
        perBar: perBar.map((p, i) => ({
          bar: i + 1, notes: p.n,
          gridError: p.n ? p.err / p.n : 0,
          stretch: medBar ? p.sec / medBar : 1
        }))
      }
    };

    /* The same score as a ScoreGraph, on request (G01 §15.3 shadow): its graph, its issues and the MusicXML it
       writes, beside the MusicXML above. */
    if (opts.scoreGraph) {
      const model = {
        title: title, key: key, beatsPerBar: beatsPerBar, beatType: beatType, bpm: roundBpm,
        bars: bars, events1: events1, events2: events2, pedals: pedals, table: table,
        scoreId: opts.scoreId, params: { beatSource: result.stats.beatSource, quantizer: result.stats.quantizer }
      };
      if (extra.tempoAlias) model.params.tempoAlias = extra.tempoAlias;
      if (extra.arrangement) model.params.arrangement = extra.arrangement;
      /* where each heard note was written: the placed note with the same onset, release and pitch */
      const placed = new Map();
      q.forEach(n => {
        const k = n.on + '|' + n.off + '|' + n.midi;
        if (!placed.has(k)) placed.set(k, []);
        placed.get(k).push(n);
      });
      const heardNotes = (extra.heard || []).map(n => {
        const list = placed.get(n.on + '|' + n.off + '|' + n.midi);
        const p = list && list.length ? list.shift() : null;
        return { on: n.on, off: n.off, midi: n.midi, vel: n.vel, staff: p ? p.staff : 0, tick: p ? p.tick : 0 };
      });
      const barSeconds = [];
      for (let b = 0; b <= bars; b++) barSeconds.push(tickToSec(b * bar));
      const built = buildGraph(model, { notes: heardNotes, pedals: extra.pedals || [], barSeconds: barSeconds });
      result.graph = built.graph;
      result.graphIssues = built.issues;
      result.graphXml = scoreGraph().musicxml.export(built.graph, { software: 'PPP audio transcription' }).xml;
    }
    return result;
  }

  function fromGrid(input, opts) {
    const g = input.grid;
    const raw = (g.notes || []).filter(n => n && isFinite(n.tick) && n.midi >= 21 && n.midi <= 108);
    if (raw.length < 4) noNotes();
    const tpq = g.ticksPerQuarter || g.ticksPerBeat || Q;
    const scale = Q / tpq;
    let q = raw.map(n => {
      const tick = Math.round(n.tick * scale);
      const endTick = Math.round((n.endTick != null ? n.endTick : n.tick + tpq) * scale);
      return {
        midi: n.midi | 0, vel: n.vel == null ? 64 : +n.vel,
        tick: tick, endTick: Math.max(tick + 1, endTick),
        staff: n.staff || 0, tuplet: !!(n.tuplet || (endTick - tick === 8) || (Math.round(n.tick * scale) % 8 === 0 && (endTick - tick) % 8 === 0 && (endTick - tick) < Q && (endTick - tick) % 6)),
        err: 0, on: n.on, off: n.off
      };
    }).sort((a, b) => a.tick - b.tick || a.midi - b.midi);
    q.forEach(n => {
      if ((n.endTick - n.tick) === 8 || (n.endTick - n.tick) === 4) n.tuplet = true;
    });
    let notes = q.map((n, i) => ({
      midi: n.midi, vel: n.vel,
      on: n.on != null ? n.on : n.tick / Q,
      off: n.off != null ? n.off : n.endTick / Q,
      _arrangeId: i
    }));
    const arrangement = opts.arrangement || (opts.easy ? { level: 'beginner', style: 'balanced' } : null);
    const arrangementPlan = arrangement ? normaliseArrangement(arrangement) : null;
    const originalNotes = notes.length;
    if (arrangementPlan && arrangementPlan.level !== 'original') {
      const kept = new Set(arrangeNotes(notes, arrangementPlan).map(n => n._arrangeId));
      q = q.filter((n, i) => kept.has(i));
      notes = notes.filter(n => kept.has(n._arrangeId));
    }
    const beatsPerBar = g.beatsPerBar || g.beats || 4;
    const beatType = g.beatType || 4;
    const barQ = beatsPerBar * (4 / beatType);
    const last = notes.reduce((m, n) => Math.max(m, n.off), 0);
    let beats = (input.beats && input.beats.length >= 2) ? stabilizeBeats(input.beats) : null;
    if (!beats) {
      const spq = g.bpm ? 60 / (beatType >= 8 && beatsPerBar % 3 === 0 ? g.bpm * 1.5 : g.bpm) : 0.5;
      beats = [];
      for (let t = 0; t <= last + spq; t += spq) beats.push(t);
      if (beats.length < 2) beats = [0, 0.5];
    }
    return finish(q, notes, beats, opts, {
      beatsPerBar: beatsPerBar, beatType: beatType, origin: 0, bpm: g.bpm,
      heard: raw.filter(n => n.on != null && n.off != null).map(n => ({ on: n.on, off: n.off, midi: n.midi | 0, vel: n.vel == null ? 64 : +n.vel })),
      pedals: input.pedals, title: input.title, quantizer: 'pm2s',
      beatSource: input.beats ? 'audio' : 'grid', errSum: 0, meterContrast: 2,
      arrangement: arrangementPlan, originalNotes: originalNotes
    });
  }

  /* ------------------------------------------------------------ the whole */
  function toMusicXml(input, opts) {
    opts = opts || {};
    if (input && input.grid && input.grid.notes && input.grid.notes.length) return fromGrid(input, opts);

    const timingNotes = clean(input.notes);
    const arrangement = opts.arrangement || (opts.easy ? { level: 'beginner', style: 'balanced' } : null);
    const arrangementPlan = arrangement ? normaliseArrangement(arrangement) : null;
    const notes = arrangementPlan && arrangementPlan.level !== 'original'
      ? arrangeNotes(timingNotes, arrangementPlan) : timingNotes;
    if (notes.length < 4) noNotes();
    const clustered = clusterNotes(notes, CLUSTER_S);
    /* Arrangement must not change the detected tempo or metre. Analyse the
       original performance, then write only the selected voices. */
    const timingClustered = clusterNotes(timingNotes, CLUSTER_S);
    const last = timingClustered.reduce((m, n) => Math.max(m, n.off), 0);
    const env = envelope(timingClustered, Math.ceil((last + 1) * FPS));
    const onsets = [];
    timingClustered.forEach(n => { if (!onsets.length || n.attack - onsets[onsets.length - 1] > 0.03) onsets.push(n.attack); });

    const lock = opts.lock || null;
    let beats, beatSource = 'onset', beatRepairs = 0;

    if (lock && (lock.bpm || lock.firstDownbeat != null) && (lock.beats || lock.beatsPerBar)) {
      beats = beatsFromLock(lock, clustered);
      beatSource = 'lock';
    } else if (input.beats && input.beats.length >= 2) {
      beats = stabilizeBeats(input.beats);
      beatRepairs = beats._repairs || 0;
      beats = extendBeats(alignStart(beats, clustered[0].on), clustered[0].on, last, onsets);
      beatSource = 'audio';
    } else {
      let period = estimatePeriod(env);
      beats = trackBeats(env, period, localPeriods(env, period));
      if (beats.length < 4) {
        beats = [];
        for (let t = clustered[0].on; t <= last + period / FPS; t += period / FPS) beats.push(t);
      }
      beats = extendBeats(alignStart(beats, clustered[0].on), clustered[0].on, last, onsets);
      beats = foldFastBeats(beats, env, clustered, onsets, last);
      beats = stabilizeBeats(beats);
      beatRepairs = beats._repairs || 0;
    }
    if (beats.length < 2) {
      beats = [clustered[0].on, clustered[0].on + 0.5];
    }

    let trip = (lock && lock.grid === '16th') ? {} : tripletBeats(clustered, beats);
    let { q, errSum } = quantize(clustered, beats, trip);
    let tempoAlias = null;
    let tempoCandidates = [];

    /* A 6/8 jig's pulse is the dotted quarter. The tracker then sees three
       eighths on each pulse — the same local grid as triplets in 2/4. Bass
       on almost every pulse is 6/8; bass once a bar is 4/4 triplets. */
    function compoundTactus() {
      if (lock || opts.beatsPerBar) return false;
      const t0 = clustered[0].on, t1 = clustered[clustered.length - 1].off;
      const live = [];
      for (let i = 0; i < beats.length; i++) if (beats[i] >= t0 - 0.15 && beats[i] <= t1 + 0.15) live.push(i);
      const pulses = Math.max(1, live.length);
      const tripN = live.filter(i => trip[i]).length;
      if (tripN < pulses * 0.28) return false;
      let bassHits = 0;
      clustered.forEach(n => {
        if (n.midi > 55) return;
        const pos = beatPosition(beats, n.attack != null ? n.attack : n.on);
        const f = pos - Math.floor(pos + 1e-6);
        if (f < 0.14 || f > 0.86) bassHits++;
      });
      return bassHits >= pulses * 0.4;
    }
    function tryFastTempo() {
      const baseBpm = 60 / median(ibiOf(beats));
      const fastCandidates = [2, 3].filter(factor => {
        const bpm = baseBpm * factor;
        return bpm >= 120 && bpm <= MAX_BPM + 1;
      });
      if (!fastCandidates.length) return false;
      const compoundQ = quantizeCompound(clustered, beats);
      const compoundSeconds = gridErrorSeconds(compoundQ, beats);
      tempoCandidates.push({ kind: 'compound', bpm: baseBpm, errorMs: compoundSeconds * 1000 });
      let bestFast = null;
      fastCandidates.forEach(factor => {
        const candidateBeats = subdivideBeats(beats, factor);
        /* A straight grid is deliberately used for choosing the tempo. If
           tuplets were allowed to choose it, either candidate could overfit. */
        const straight = quantize(clustered, candidateBeats, {});
        const seconds = gridErrorSeconds(straight.q, candidateBeats);
        tempoCandidates.push({ kind: 'simple-x' + factor, bpm: baseBpm * factor, errorMs: seconds * 1000 });
        if (!bestFast || seconds < bestFast.seconds) {
          bestFast = { factor: factor, beats: candidateBeats, seconds: seconds };
        }
      });
      if (!bestFast || bestFast.seconds >= compoundSeconds * 0.9) return false;
      beats = bestFast.beats;
      trip = tripletBeats(clustered, beats);
      const fast = quantize(clustered, beats, trip);
      q = fast.q;
      errSum = fast.errSum;
      tempoAlias = 'x' + bestFast.factor;
      return true;
    }

    let compoundPulse = compoundTactus();

    /* The conservative compound detector above can reject syncopated music,
       after which the metre scorer may still label the same slow pulse 6/8.
       Run the tempo-octave comparison in that path as well. */
    if (!compoundPulse && !lock && !opts.beatsPerBar) {
      tryFastTempo();
    }
    if (compoundPulse) {
      /* Six slots per dotted-quarter retain compound-time sixteenths. */
      q = quantizeCompound(clustered, beats);
      errSum = q.reduce((s, n) => s + n.err, 0);

      /* Do not stop at the first plausible 6/8 reading. Fast 4/4 piano often
         has a strong attack every half note, so a tracker returns ~81 BPM for
         music written at ~162 and the old code then called it 6/8 at 54 BPM.
         Compare the compound grid with straight quarter-note grids at 2x and
         3x the tracked pulse. A real 6/8 performance fits its six slots per
         pulse better; a half-time 4/4 performance fits eight slots better. */
      if (!lock && !opts.beatsPerBar && tryFastTempo()) compoundPulse = false;
    }

    let beatsPerBar, beatType, origin, meterContrast = 1;

    const lockedMetre = lock && (lock.beats || lock.beatsPerBar);
    if (compoundPulse && !lockedMetre && !opts.beatsPerBar) {
      /* 6/8 is two dotted-quarter pulses; 12/8 is four. Downbeats decide. */
      const fromDown = metreFromDownbeats(beats, input.downbeats);
      const pulses = (fromDown && fromDown.beats === 4) ? 4 : 2;
      beatsPerBar = pulses === 4 ? 12 : 6;
      beatType = 8;
      /* With no audio downbeats this is still an inference from note attacks,
         and fast 4/4 triplets can imitate 6/8. Do not report false certainty. */
      meterContrast = input.downbeats && input.downbeats.length ? 2 : 1.1;
      origin = 0;
      if (input.downbeats && input.downbeats.length && beatSource === 'audio') {
        /* A detected downbeat can be a few milliseconds away from the beat
           track. It chooses the bar phase, not a new 1/36-beat notation grid. */
        origin = Math.round(beatPosition(beats, input.downbeats[0])) * 36;
      }
      const bar = pulses * 36;
      const firstTick = Math.min.apply(null, q.map(n => n.tick));
      while (origin > firstTick) origin -= bar;
      while (origin + bar <= firstTick) origin += bar;
    } else if (lockedMetre) {
      beatsPerBar = lock.beats || lock.beatsPerBar;
      beatType = lock.beatType || 4;
      const bar = Math.round(beatsPerBar * (4 / beatType) * Q);
      /* origin: first downbeat maps to tick 0 of a bar */
      if (lock.firstDownbeat != null && isFinite(+lock.firstDownbeat)) {
        /* The lock's downbeat chooses a whole written beat. Keeping the raw
           detector fraction here shifted every note by one tiny tick (for
           example 3.958 instead of 0), creating a false pickup bar and many
           tied fragments. */
        origin = Math.round(beatPosition(beats, +lock.firstDownbeat)) * Q;
      } else {
        origin = 0;
        const firstTick = Math.min.apply(null, q.map(n => n.tick));
        while (origin > firstTick) origin -= bar;
        while (origin + bar <= firstTick) origin += bar;
      }
      meterContrast = 2;
    } else if (opts.beatsPerBar) {
      beatsPerBar = opts.beatsPerBar;
      beatType = opts.beatType || 4;
      origin = 0;
      meterContrast = 1;
    } else {
      const fromDown = metreFromDownbeats(beats, input.downbeats);
      const nBeats = Math.ceil(Math.max.apply(null, q.map(n => n.endTick)) / Q) + 1;
      const acc = accents(q, nBeats, Q);
      const mp = meterAndPhase(acc);
      let pick = { beats: mp.m, beatType: 4, phase: mp.phase, contrast: mp.contrast };

      /* 6/8: same three-quarter bar as 3/4, different grouping */
      const phase3 = mp.m === 3 ? mp.phase : meterAndPhase(acc.length ? acc : new Float64Array(4)).phase;
      /* try origin of a 3-beat grouping */
      const origin3 = (mp.m === 3 ? mp.phase : 0) * Q;
      const cv = compoundVsThree(q, origin3, 1);
      if (!tempoAlias && cv.s68 > cv.s34 * 1.12 && cv.eighths >= 8) {
        pick = { beats: 6, beatType: 8, phase: Math.round(origin3 / Q) % 3, contrast: (cv.s68 / (cv.s34 || 1)) };
      }
      if (fromDown && beatSource === 'audio') {
        /* audio downbeats win on metre numerator when they are unambiguous */
        if (fromDown.beats === 3) pick = { beats: 3, beatType: 4, phase: 0, contrast: 2 };
        else if (fromDown.beats === 4) pick = { beats: 4, beatType: 4, phase: 0, contrast: 2 };
        else if (fromDown.beats === 2 && pick.beats !== 6) pick = { beats: 2, beatType: 4, phase: 0, contrast: 2 };
        else if (fromDown.beats === 6) pick = { beats: 6, beatType: 8, phase: 0, contrast: 2 };
      }
      beatsPerBar = pick.beats;
      beatType = pick.beatType;
      meterContrast = pick.contrast || mp.contrast;
      const bar = Math.round(beatsPerBar * (4 / beatType) * Q);
      const firstTick = Math.min.apply(null, q.map(n => n.tick));
      origin = (pick.phase || 0) * (beatType >= 8 ? Q * 3 / 2 : Q);
      /* phase is in quarter beats for simple metre */
      if (beatType === 4) origin = (pick.phase || 0) * Q;
      else origin = 0;
      if (input.downbeats && input.downbeats.length && beatSource === 'audio') {
        origin = Math.round(beatPosition(beats, input.downbeats[0])) * Q;
      }
      while (origin > firstTick) origin -= bar;
      while (origin + bar <= firstTick) origin += bar;
    }

    let bpm;
    if (lock && lock.bpm) bpm = +lock.bpm;
    const result = finish(q, clustered, beats, opts, {
      beatsPerBar: beatsPerBar, beatType: beatType, origin: origin, bpm: bpm, heard: timingNotes,
      pedals: input.pedals, title: input.title, quantizer: 'heuristic',
      beatSource: beatSource, errSum: errSum, meterContrast: meterContrast,
      ticksPerBeat: compoundPulse ? 36 : Q,
      tactus: compoundPulse ? 'dotted-quarter' : 'quarter',
      tempoAlias: tempoAlias,
      tempoCandidates: tempoCandidates,
      beatRepairs: beatRepairs,
      arrangement: arrangementPlan,
      originalNotes: timingNotes.length
    });
    return result;
  }

  const api = {
    toMusicXml: toMusicXml,
    arrangeNotes: arrangeNotes,
    arrangementProfile: arrangementProfile,
    recommendArrangement: recommendArrangement,
    normaliseArrangement: normaliseArrangement,
    _: { estimateKey, spellingTable, spell, pieces, notePieces, snap: snap16, beatPosition, stabilizeBeats, meterAndPhase, centreSplit, clusterNotes, simplifyNotes, arrangeNotes, arrangementProfile, recommendArrangement, normaliseArrangement, SUB, Q }
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (global) global.PPPAudioScore = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : this);
