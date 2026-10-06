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
  /* DURATIONS FROM ONSETS (docs/GOALS/G09 section 12): in a recording with opts.exactBars a note lasts until the next onset of its voice, and a rest is written only for a silence of at least REST_MIN
     (a fraction of a whole note: 1/8, an eighth) between its heard release and that onset. opts.restMin changes it, opts.onsetDurations: false writes the heard releases as before. */
  const REST_MIN = 1 / 8;
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
        /* where the note came from, when the source states it (a MIDI file does) */
        if (Number.isInteger(n.track)) out.track = n.track;
        if (Number.isInteger(n.channel)) out.channel = n.channel;
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
        if (!best) break; /* unison across voices: every distinct pitch is already taken */
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

  /* exact (v2 only, G10a-1): an onset within 1e-9 of a beat is ON the beat. Legacy floors the position with 1e-9 of slack
     here but without it in snapStraight, so an onset a hair before a beat (a beat grid interpolated through the onsets
     themselves, as v2's is) was written one beat late; legacy keeps that, byte for byte */
  function quantize(notes, beats, trip, exact) {
    let errSum = 0;
    const q = notes.map(n => {
      const tOn = n.attack != null ? n.attack : n.on;
      let pos = beatPosition(beats, tOn);
      if (exact) { const r = Math.round(pos); if (Math.abs(pos - r) < 1e-9) pos = r; }
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

  /* ------------------------------------------------------- exact bars (docs/GOALS/G09 section 12, "Recording notation: tuplets and the grid")
     The quantiser leaves onsets and releases on three lattices at once: the 16th grid (6 ticks), a 32nd lattice (3) and the thirds of a triplet beat (8). A note on the 32nd lattice (a G3 at
     3.625 beats lasting 3/8 of a beat), a release between two lattices and a gap of an eighth of a beat that no rest is written for gave the teacher's piece 38 bars whose values do not
     add up. For a recording in a simple-time bar (a quarter-note beat) with opts.exactBars, every onset and every release is put on ONE grid per beat:
       - a triplet beat (a beat with an onset on a third: 8 or 16 ticks into it): the thirds, 0 / 8 / 16 / 24;
       - any other beat: the 16th grid, 0 / 6 / 12 / 18 / 24 - except a beat that holds a genuine 32nd run (see snapOnsets), which keeps the 32nd lattice (a multiple of 3).
     An onset on the 32nd lattice moves to the 16th-grid point beside it (3 ticks = 1/32 of a whole note at most, 0.05 s at 162 bpm), the one nearer its measured time, unless another onset already
     sits on that point (a run: 0, 3, 6): then it stays when every hand that plays it also played a note a 32nd before (a genuine run: nothing is silent before it, so no rest needs a 32nd piece), and
     otherwise goes to the nearer point, two notes of a hand that meet there being one chord (a pitch the chord already holds is not given up: that onset stays). Every note keeps its order, none is
     lost, and a note of a plain length is never shorter than a 16th (a third in a triplet beat) in the score unless it was: the release is the nearest plain value on the grid, as readableEnd
     chose it, and a silence is the standard tiling (scoregraph/gaps.js tile), never a piece shorter than a 16th, so the gaps pass has nothing to close or omit. */
  const exactGrid = (q, bars, bar, restMin) => {
    const trip = new Set(), fast = new Set();
    q.forEach(n => {
      const j = Math.floor(n.tick / Q), o = n.tick - j * Q;
      if (o === 8 || o === 16) trip.add(j); else if (o % 6) fast.add(j);
    });
    const valid = p => {
      const j = Math.floor(p / Q), o = p - j * Q;
      if (!o) return true;
      return trip.has(j) ? o % 8 === 0 : (fast.has(j) ? o % 3 === 0 : o % 6 === 0);
    };
    /* the nearest valid point to p in [lo, hi], a tie going to the later one; null when there is none */
    const nearest = (p, lo, hi) => {
      for (let d = 0; d <= Q; d++) {
        if (p + d <= hi && p + d >= lo && valid(p + d)) return p + d;
        if (p - d >= lo && p - d <= hi && valid(p - d)) return p - d;
      }
      return null;
    };
    return { trip: trip, fast: fast, valid: valid, nearest: nearest, bars: bars, bar: bar, last: bars * bar, restMin: restMin || 0 };
  };

  /* every onset on the grid. Returns {moved, maxShift, onsets}: how many distinct onsets moved and the largest move (ticks). `beats`, `origin` and `perBeat` give each note's measured position in ticks. */
  function snapOnsets(q, bars, bar, beats, origin, perBeat) {
    const last = bars * bar;
    const ticks = Array.from(new Set(q.map(n => n.tick))).sort((a, b) => a - b);
    const tripBeat = new Set();
    ticks.forEach(t => { const o = t - Math.floor(t / Q) * Q; if (o === 8 || o === 16) tripBeat.add(Math.floor(t / Q)); });
    /* where each distinct onset was measured, in ticks (the mean of its notes: a clustered attack shares one tick) */
    const measured = new Map();
    q.forEach(n => {
      const at = n.attack != null ? n.attack : n.on;
      const x = at != null && isFinite(at) ? beatPosition(beats, at) * perBeat - origin : n.tick;
      const m = measured.get(n.tick) || { sum: 0, n: 0 };
      m.sum += x; m.n++; measured.set(n.tick, m);
    });
    const onGrid = t => { const j = Math.floor(t / Q), o = t - j * Q; return !o || (tripBeat.has(j) ? o % 8 === 0 : o % 6 === 0); };
    const taken = new Set();                            /* the points an onset sits on or has moved to */
    ticks.forEach(t => { if (onGrid(t)) taken.add(t); });
    /* the onsets of each staff, and the staves that have a note at each onset: a genuine 32nd run is told apart per staff */
    const staffTicks = [null, new Set(), new Set()], staffsAt = new Map();
    q.forEach(n => {
      if (n.staff === 1 || n.staff === 2) staffTicks[n.staff].add(n.tick);
      if (!staffsAt.has(n.tick)) staffsAt.set(n.tick, new Set());
      staffsAt.get(n.tick).add(n.staff);
    });
    /* the notes (staff|pitch) at each point, as they stand: two notes of one hand with one pitch may not meet on a point (one chord holds a pitch once) */
    const heldAt = new Map();
    q.forEach(n => { if (!heldAt.has(n.tick)) heldAt.set(n.tick, new Set()); heldAt.get(n.tick).add(n.staff + '|' + n.midi); });
    const collides = (t, k) => { const there = heldAt.get(k); return !!there && Array.from(heldAt.get(t)).some(x => there.has(x)); };
    const map = new Map();
    let moved = 0, maxShift = 0, kept = 0, merged = 0;
    ticks.forEach(t => {
      if (onGrid(t)) { map.set(t, t); return; }
      const j = Math.floor(t / Q), step = tripBeat.has(j) ? 8 : 6;
      const m = measured.get(t), x = m.sum / m.n;
      /* the grid points within a step either side, the nearest to its measured time first */
      const c = [];
      for (let k = Math.floor((t - step) / step) * step; k <= t + step; k += step) if (k >= 0 && k < last && Math.abs(k - t) < step && onGrid(k)) c.push(k);
      c.sort((a, b) => Math.abs(a - x) - Math.abs(b - x) || a - b);
      const free = c.find(k => !taken.has(k));
      let to = t;
      if (free !== undefined) to = free;
      else {
        /* both neighbours are taken: a 32nd-lattice onset is a genuine run when every staff that plays it also played a note a 32nd before (so no silence of a staff ends on an odd 32nd: a
           rest would need a 32nd piece); then it stays on the 32nd lattice. Anything else goes to the nearer neighbour (two notes of a staff that meet there are one chord). */
        const run = t % 3 === 0 && !tripBeat.has(j) && Array.from(staffsAt.get(t)).every(st => st >= 1 && staffTicks[st].has(t - 3));
        const meet = c.find(k => !collides(t, k));
        if (run || meet === undefined) kept++;              /* (a pitch that would be lost where two notes meet also stays) */
        else { to = meet; merged++; }
      }
      if (to !== t) { if (!heldAt.has(to)) heldAt.set(to, new Set()); heldAt.get(t).forEach(x => heldAt.get(to).add(x)); }
      taken.add(to);
      if (to !== t) { moved++; maxShift = Math.max(maxShift, Math.abs(to - t)); }
      map.set(t, to);
    });
    q.forEach(n => { n.tick = map.get(n.tick); n.endTick = Math.max(n.endTick, n.tick + 1); });
    return { moved: moved, maxShift: maxShift, onsets: ticks.length, kept32nd: kept, merged: merged };
  }

  /* the written length of a note that starts at `start` and was released at `end` (ticks): the nearest plain value, or a third / two thirds of a beat, that ends on the grid and fits in `room`; null when none does */
  /* what a tie costs when the release is put on the grid (in ticks of distance from the heard release): a note that starts on a third of a triplet beat has little else to reach */
  const CHAIN_COST = 13, CHAIN_COST_TRIP = 3;

  /* A span [a0, a0 + len) of one voice in ticks that does not cross a bar line, as the values it is written with: a triplet beat's third / two thirds (8 / 16) for the part that starts or ends inside
     one, the ordinary pieces for the rest (nothing starts or ends off the grid, so these never need a value that is not 3, 6, 9, 12, 18, 24 ...). `kind`: 'note' (an exact plain value is one symbol
     even over a beat line) or 'rest' (nothing crosses a beat unless it starts on one). */
  function exactPieces(a0, len, bar, grid, kind) {
    const out = [];
    const barStart = Math.floor(a0 / bar) * bar;
    let pos = a0, rem = len;
    while (rem > 0) {
      const j = Math.floor(pos / Q), off = pos - j * Q;
      if (grid.trip.has(j) && !(off === 0 && rem >= Q)) {
        const take = Math.min(rem, (j + 1) * Q - pos);
        out.push(take); pos += take; rem -= take;
        continue;
      }
      const end = pos + rem, k = Math.floor(end / Q);
      let lim = rem;
      if (end % Q && grid.trip.has(k)) lim = k * Q - pos;
      const rel = pos - barStart, G = kind === 'rest' ? gapsLib() : null;
      if (G && G.tile && rel % 3 === 0 && lim % 3 === 0) {
        /* a silence is written the way scoregraph/gaps.js mergeRests writes it (the standard tiling on the beat grid), so that pass finds nothing to change */
        G.tile(rel / 3, (rel + lim) / 3, 8, false, bar / 3, false).forEach(pc => out.push(pc.len * 3));
      } else (kind === 'note' ? notePieces : pieces)(rel, lim, bar, Q).forEach(v => out.push(v));
      pos += lim; rem -= lim;
    }
    return out;
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
  }

  function staffEvents(notes, staff, bar, beat, allowBarTies, grid) {
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
            (grid ? exactPieces(t, span, bar, grid, 'note').length : notePieces(local, span, bar, beat).length) === 1) end = next;
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
      if (grid) {
        /* exact bars: the release on the grid (a plain value, or a third of a beat), never past the next onset or the bar line the note is clamped to */
        const loc = ((t % bar) + bar) % bar, boundary = t + (bar - loc);
        const cap = Math.min(next, allowBarTies ? grid.last : boundary);
        if (end > cap) end = cap;
        if (end >= boundary - 1e-6) {
          /* a note that reaches the bar line (or, with a symbolic grid, crosses it) keeps its end when that is a point of the grid */
          if (!grid.valid(end)) { const nr = grid.nearest(end, t + 1, cap); end = nr === null ? cap : nr; }
        } else {
          /* inside the bar: the point of the grid nearest the release, where a length that needs a tie (two pieces) costs an extra CHAIN_COST ticks, so a note is not tied over a beat to fill a
             silence it was released before (readableEnd's rule: the nearest single readable value) unless that value is further from the release than the cost of the tie. A note that starts on a
             third of a triplet beat can reach no single value but the beat's end, so its tie costs little: it keeps the length it was heard with (the next beat's grid) instead of being cut to a third. */
          const e0 = end, hi = Math.min(next, boundary);
          const inTrip = grid.trip.has(Math.floor(t / Q)) && t % Q !== 0;
          const pen = inTrip ? CHAIN_COST_TRIP : CHAIN_COST;
          let bestP = null, bestCost = Infinity, bestN = 0;
          for (let p = t + 1; p <= hi; p++) {
            if (!grid.valid(p)) continue;
            const np = exactPieces(t, p - t, bar, grid, 'note').length, cost = Math.abs(p - e0) + pen * (np - 1);
            if (cost < bestCost - 1e-9 || (Math.abs(cost - bestCost) < 1e-9 && np < bestN)) { bestP = p; bestCost = cost; bestN = np; }
          }
          end = bestP === null ? cap : bestP;
        }
        /* no silence shorter than a 16th, and none that starts on an odd 32nd (a rest would need a 32nd piece): the note rings up to the next onset, or to the next point of the 16th grid */
        if (end < cap) {
          const j = Math.floor(end / Q);
          if (!grid.trip.has(j) && (end - j * Q) % 6 === 3 && grid.valid(end + 3)) end += 3;
          if (next !== Infinity && end < next && next - end < 6) end = next;
        }
        /* DURATIONS FROM ONSETS (docs/GOALS/G09 section 12, "Recording durations from onsets"): the onsets are what the model heard well, the releases are not (a pedal, a room, a weak key-up). A note lasts until
           the next onset of its voice (legato, the inter-onset interval, on the grid the onsets are on) unless the silence between its release and that onset is long enough to be a rest on purpose: at
           least grid.restMin (REST_MIN, an eighth). A shorter silence is measurement noise and is not written, so no 16th, 32nd or triplet-third rest is ever drawn between two notes of a hand. The note
           may cross a barline then (a tie: the same notation as a note held into the next bar); with no note after it (the end of the hand's last bar with a note) the release stays as heard. */
        if (grid.restMin > 0 && next !== Infinity && end < next && next - end < grid.restMin) end = next;
        events.push({ start: t, end: end, notes: ns, tuplet: ns.some(n => n.tuplet) });
        return;
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
  const SCOREGRAPH_VERSION = '1.3.2';
  /* G3 in toMusicXml: 'off' | 'shadow' | 'on' (opts.professional overrides it). Off until the G3a flip (G03 Step 13). */
  const PROFESSIONAL_DEFAULT = 'off';
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
  /* "Transcription rests at the source" (docs/GOALS/G09 section 12): scoregraph/gaps.js, the pass G9f runs on a one-note arrangement of a transcription. It is run here, on the graph a RECORDING's
     heard notes became (sourceKind 'audio-score'), so the review screen, the saved transcription song, the 'original' copy and every arranger's input have no 32nd or 64th rest between notes:
     a gap shorter than a 16th after a note lengthens that note (never shortening, never moving an onset or a pitch, never over a barline or the hand's next onset), and a 32nd or 64th rest among
     the pieces of a longer silence with a note after it is not drawn. A MIDI file (sourceKind 'midi-file') is the player's own file and is left as it is.
     Off by default in the library, like G3 below: the committed goldens, the benchmark's snapshots and the G3/G4 contracts on "the recording graphs" (one source, no per-entity provenance)
     are about toMusicXml's own output; the APP asks for it (opts.closeGaps: true at its four recording call sites). A page that has not loaded scoregraph/gaps.js (an old cached page)
     writes the score as it did before: this never throws. */
  const CLOSE_GAPS_DEFAULT = false;
  function gapsLib() {
    try {
      return typeof module === 'object' && module.exports ? require('./scoregraph/gaps.js') : (global && global.PPPScoreGraphModules && global.PPPScoreGraphModules.gaps) || null;
    } catch (e) { return null; }
  }
  /* "Recording notation: tuplets and the grid" (docs/GOALS/G09 section 12): scoregraph/rec-tuplet.js, the pass that writes one tuplet over each triplet beat. Asked for with opts.exactBars (the app
     does, with closeGaps, at its four recording call sites; off by default for the same reason closeGaps is: the goldens, the benchmark's snapshots and the G3/G4 contracts are about toMusicXml's own
     output); only for a recording (a MIDI file is the player's own); a page that has not loaded it writes the score as before. */
  function tupletLib() {
    try {
      return typeof module === 'object' && module.exports ? require('./scoregraph/rec-tuplet.js') : (global && global.PPPScoreGraphModules && global.PPPScoreGraphModules.recTuplet) || null;
    } catch (e) { return null; }
  }
  /* G10a-2 (docs/GOALS/G10_AUDIO_TO_SCORE.md section 8, stage S3): rec/grid.js, the grid of each beat decided from the evidence of all its onsets (straight 16ths, 32nds, triplets, swung eighths)
     and every onset placed on it. The recording conversion v2's stage S3 (recordingV2, opts.recording 'v2'): it replaces this file's onset placement (tripletBeats / snapStraightBest /
     snapTriplet in quantize and snapOnsets with exactBars for a simple-time skeleton, quantizeCompound for a compound one). opts.grid 'legacy' keeps G10a-1's S3 (the legacy quantisers)
     under v2, for comparison. Legacy (no opts.recording) never loads it. A page without rec/grid.js writes v2 with the legacy quantisers. */
  function gridLib() {
    try {
      return typeof module === 'object' && module.exports ? require('./rec/grid.js') : (global && global.PPPRecGrid) || null;
    } catch (e) { return null; }
  }
  /* G10a-3 (docs/GOALS/G10_AUDIO_TO_SCORE.md section 8, stages S5-S7): rec/writer.js, the written rhythm of every voice in every metre (exact bars for x/4, x/2 and
     compound bars, triplet and triplet-16th beats, up to two voices per staff, the rest decision of S6). Only the recording conversion v2 with opts.exactBars loads it;
     a page without it writes v2 with the exact-bars writer below (x/4 only). */
  function writerLib() {
    try {
      return typeof module === 'object' && module.exports ? require('./rec/writer.js') : (global && global.PPPRecWriter) || null;
    } catch (e) { return null; }
  }
  /* S5 (G10a-3): rec/voices.js, the voice of each note in its staff; null when absent (one voice per staff) */
  function voicesLib() {
    try {
      return typeof module === 'object' && module.exports ? require('./rec/voices.js') : (global && global.PPPRecVoices) || null;
    } catch (e) { return null; }
  }
  /* S6 (G10a-3, AI-5b): rec/rests.js, whether a silence between two notes of a voice is a rest; null when absent (a page without it: every silence of restMin or more is a rest, as before) */
  function restsLib() {
    try {
      return typeof module === 'object' && module.exports ? require('./rec/rests.js') : (global && global.PPPRecRests) || null;
    } catch (e) { return null; }
  }
  /* The hands (docs/GOALS/G10_AUDIO_TO_SCORE.md section 8, stage S4, G10a-2): rec/'s S4 (rec/hands.js, through rec/index.js) writes the
     staff of every note for the recording conversion v2 (opts.recording 'v2'), or on any path with opts.hands 'v2' (a measurement:
     the app's path with only S4 swapped); opts.hands 'legacy' keeps assignHands under v2. Without either, the hands are assignHands'
     as always. Asked for by name and not loaded is an error (a measurement must know which ran); under v2 without the option, a
     page whose rec/ has no hand model keeps assignHands and the report says so. */
  function writeHands(q, opts, extra) {
    const mode = opts.hands || (extra.recording === 'v2' ? 'v2' : 'legacy');
    if (mode !== 'v2') { assignHands(q); return null; }
    const lib = recLib();
    const H = lib && lib.hands;
    try {
      if (!H) { const e = new Error('rec/hands.js (S4) is not loaded'); e.code = 'E-HANDS-NO-LIB'; throw e; }
      return H.assignQ(q, {}).report;
    } catch (e) {
      if (opts.hands === 'v2' || !(e.code === 'E-HANDS-NO-LIB' || e.code === 'E-HANDS-NO-MODEL')) throw e;
      assignHands(q);
      return { fallback: 'legacy', code: e.code };
    }
  }
  /* The key and the spelling (docs/GOALS/G10_AUDIO_TO_SCORE.md section 8, stage S8, G10a-3): rec/key.js decides the key signature from the onsets (not the releases), the tonal regions, the spelling of every note
     from its region, and the printed accidentals by the rule the benchmark checks (a tied-over head neither needs one nor changes what is in force). It is the recording conversion v2's S8 (opts.recording 'v2'),
     or on any path with opts.keys 'v2' (a measurement: the app's path with only S8 swapped); opts.keys 'legacy' keeps estimateKey / spellingTable under v2. Without either nothing here runs. Asked for by name and
     not loaded is an error (a measurement must know which ran); under v2 without the option, a page without rec/key.js keeps the legacy key. The ScoreGraph writer only: opts.legacyWriter keeps buildXml. */
  function keyLib() {
    try {
      return typeof module === 'object' && module.exports ? require('./rec/key.js') : (global && global.PPPRecKey) || null;
    } catch (e) { return null; }
  }
  function writeKeys(q, opts, extra, bar, bars) {
    const mode = opts.keys || (extra.recording === 'v2' ? 'v2' : 'legacy');
    if (mode !== 'v2' || opts.legacyWriter) return null;
    const lib = keyLib();
    if (!lib) {
      if (opts.keys === 'v2') { const e = new Error('rec/key.js (S8) is not loaded'); e.code = 'E-KEY-NO-LIB'; throw e; }
      return null;
    }
    const r = lib.analyse(q, { barTicks: bar, bars: bars, ticksPerQuarter: Q });
    q.forEach((n, i) => { n.sp = r.spell[i]; });
    return r;
  }
  /* The pedal marks (docs/GOALS/G10_AUDIO_TO_SCORE.md section 8, stage S9, G10a-3): a heard pedal is written as a mark only when the heard notes agree with it (rec/pedal.js: long enough, holding notes,
     their releases at its end), the mark where those releases are; the pedal the browser model does not hear is never invented, and every heard span stays in the performance layer whatever is written.
     The recording conversion v2's S9 (opts.recording 'v2'), or on any path with opts.pedal 'v2' (a measurement: the app's path with only S9 swapped); opts.pedal 'legacy' writes every heard span under v2.
     Not for a MIDI file: its controller events are the player's own (sourceKind 'midi-file'). Asked for by name and not loaded is an error; under v2 without the option, a page without rec/pedal.js writes
     every span. */
  function pedalLib() {
    try {
      return typeof module === 'object' && module.exports ? require('./rec/pedal.js') : (global && global.PPPRecPedal) || null;
    } catch (e) { return null; }
  }
  function pedalSpans(opts, extra) {
    const heard = extra.pedals || [];
    const mode = opts.pedal || (extra.recording === 'v2' ? 'v2' : 'legacy');
    if (mode !== 'v2' || (opts.sourceKind || 'audio-score') !== 'audio-score') return null;
    const lib = pedalLib();
    if (!lib) {
      if (opts.pedal === 'v2') { const e = new Error('rec/pedal.js (S9) is not loaded'); e.code = 'E-PEDAL-NO-LIB'; throw e; }
      return null;
    }
    return lib.analyse(heard, extra.heard || [], {});
  }
  /* G10a-6 (docs/GOALS/G10_AUDIO_TO_SCORE.md section 29): the automatic 8va / 8vb (15ma / 15mb) of realize/ottava.js (TD16), on the graph a v2 RECORDING became. A real recording has notes that
     sound far above or below the staff (the teacher's six covers: 7-15% of the heard notes at or above E6, 4-14% at or below E2) and the score printed them on a stack of ledger lines. The graph keeps
     the SOUNDING pitch and only gains an `ottava` spanner (the engraver prints the displaced octave, the MusicXML keeps <pitch> as it sounds and writes <octave-shift>, the app's Score plays the
     sounding pitch: MX-1); the pass runs through scoregraph/pro.js professionalize, whose critic gives the INPUT graph back unless nothing but the octave lines changed. Only under v2 (opts.recording
     'v2'): the classic conversion writes what it always wrote. opts.ottava false or 'off' keeps the graph without the lines (a comparison arm, a rollback). A page that has not loaded
     realize/ottava.js writes the score without them: this never throws. */
  function ottavaLib() {
    try {
      return typeof module === 'object' && module.exports ? require('./realize/ottava.js') : (global && global.PPPRealizeModules && global.PPPRealizeModules.ottava) || null;
    } catch (e) { return null; }
  }
  const ottavaWanted = (opts, extra) => extra.recording === 'v2' && opts.ottava !== false && opts.ottava !== 'off' && (opts.sourceKind || 'audio-score') === 'audio-score';
  const ACCIDENTAL_NAME = { '-2': 'flat-flat', '-1': 'flat', '0': 'natural', '1': 'sharp', '2': 'double-sharp' };

  /* heard: {notes: [{on, off, midi, vel, staff, tick}] (every note after clean; staff and tick once placed),
     pedals: [{on, off}], barSeconds: [bars + 1 times]} */
  function buildGraph(model, heard) {
    const SG = scoreGraph(), R = SG.rational;
    const { title, key, beatsPerBar, beatType, bpm, bars, events1, events2, pedals, table } = model;
    const beatTicks = beatType >= 8 && beatsPerBar % 3 === 0 ? Q * 3 / 2 : Q;
    const bar = Math.round(beatsPerBar * (4 / beatType) * Q);
    const grid = model.grid || null;                        /* exact bars: every value on the beat's grid; the tuplets are written by scoregraph/rec-tuplet.js */
    const W = t => R.format(R.make(t, Q * 4));            /* ticks (Q a quarter) as whole notes */
    const b = SG.builder({ id: model.scoreId || 'sg-audio', meta: { title: title } });
    /* what the notes came from, which is not always a microphone: a MIDI file says so (G02 §7.6) */
    const srcDraft = { kind: model.sourceKind || 'audio-score', tool: 'audio-score.js', params: model.params || {} };
    if (model.sourceInput) srcDraft.input = model.sourceInput;
    const src = b.source(srcDraft);
    b.setDefault({ src: src.id, op: 'inferred' });
    const part = b.part({ name: 'Piano', instrument: { kind: 'piano', family: 'keyboard' } });
    const st = [null, b.staff(part, { limb: 'RH' }).id, b.staff(part, { limb: 'LH' }).id];
    const voice = [null, b.voice(part, { staff: st[1], label: '1' }).id, b.voice(part, { staff: st[2], label: '5' }).id];
    const mid = [];
    for (let i = 0; i < bars; i++) mid.push(b.measure({ number: String(i + 1), dur: W(bar) }).id);
    b.meter({ m: mid[0], beats: [beatsPerBar], beatType: beatType });
    b.key({ m: mid[0], at: '0', fifths: key.fifths, mode: key.mode });
    /* S8 (G10a-3): a key signature written after the first, and the signature in force in every bar */
    const sigOfBar = [];
    for (let i = 0; i < bars; i++) sigOfBar.push(key.fifths);
    (model.keyChanges || []).forEach(k => {
      if (k.bar < 1 || k.bar >= bars) return;
      b.key({ m: mid[k.bar], at: '0', fifths: k.fifths, mode: k.mode });
      for (let i = k.bar; i < bars; i++) sigOfBar[i] = k.fifths;
    });
    /* the spelling of a head: S8's (the note's own, from its region) or the key's table */
    const spellOf = n => (n.sp ? { step: n.sp.step, alter: n.sp.alter, octave: Math.floor((n.midi - n.sp.alter) / 12) - 1 } : spell(n.midi, table));
    const compound = beatType >= 8 && beatsPerBar % 3 === 0;
    /* issue 1 kept as it is in legacy: a compound tempo plays bpm quarters a minute but prints dotted quarter = bpm. The
       recording conversion v2 (opts.recording 'v2', G10a-1) sets model.qpm: the quarters a minute that dotted quarter =
       bpm means (3 bpm / 2), so what is printed is what plays */
    const mark = compound ? { unit: 'quarter', dots: 1, perMinute: String(bpm) } : { unit: 'quarter', perMinute: String(bpm) };
    b.tempo({ m: mid[0], at: '0', qpm: model.qpm != null ? model.qpm : String(bpm), mark: mark, display: [{ part: part.id, staff: st[1], placement: 'above' }] });
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
      /* S8 (G10a-3): the signature in force in this bar, and the accidentals by the benchmark's rule (a tied-over head changes nothing in force); the legacy lines below keep their own */
      const accV2 = model.keysV2 ? keyLib().accidentals() : null;
      if (accV2) { accV2.begin(sigOfBar[barIdx]); Object.assign(state, keyAlters(sigOfBar[barIdx])); }
      const rest = (from, to) => {
        const full = from === 0 && to === bar;
        (grid ? exactPieces(barStart + from, to - from, bar, grid, 'rest') : pieces(from, to - from, bar, beatTicks)).forEach(v => {
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
        const parts = grid ? exactPieces(barStart + s, e - s, bar, grid, 'note') : notePieces(s, e - s, bar, beatTicks);
        const anyTuplet = ev.tuplet || parts.some(v => tupletOf(v));
        parts.forEach((v, pi2) => {
          const tu = grid ? null : tupletOf(v);
          const t = tu ? [tu.type, 0] : (TYPES[v] || ['16th', 0]);
          const tieStop = pi2 > 0 || ev.tieIn, tieStart = pi2 < parts.length - 1 || ev.tieOut;
          const display = t[1] ? { type: t[0], dots: t[1] } : { type: t[0] };
          const heads = ev.notes.map(n => {
            if (accV2) {                                   /* S8: the note's own spelling, the accidental by the benchmark's rule */
              const s2 = spellOf(n), h2 = { pitch: s2.alter ? { step: s2.step, alter: s2.alter, oct: s2.octave } : { step: s2.step, oct: s2.octave } };
              if (accV2.next(s2.step, s2.octave, s2.alter, tieStop)) h2.acc = { type: ACCIDENTAL_NAME[s2.alter] };
              return h2;
            }
            const sp = spell(n.midi, table), k = sp.step + sp.octave;
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
    /* The recording conversion v2's writer (rec/writer.js, S5-S7, G10a-3): every piece of every voice is already decided
       (values, ties, rests, tuplet groups, up to two voices per staff, every metre); this only emits them. The heads are
       spelled here as above, with one accidental state per staff and bar walked in time order over the staff's voices. */
    const writeV2 = Wr => {
      const vid = { 11: voice[1], 21: voice[2] };
      Wr.tracks.forEach(tr => {
        const k = tr.staff * 10 + tr.voice;
        if (!vid[k] && tr.pieces.length) vid[k] = b.voice(part, { staff: st[tr.staff], label: tr.staff === 1 ? String(tr.voice) : String(4 + tr.voice) }).id;
      });
      const evId = new Map();
      const pending = Wr.tracks.map(() => new Map());       /* track -> midi -> the head its tie continues from */
      const byBar = [];
      for (let i = 0; i < bars; i++) byBar.push([[], [], []]);
      Wr.tracks.forEach((tr, ti) => tr.pieces.forEach((p, pi) => {
        const i = Math.floor(p.at / bar);
        if (i >= 0 && i < bars) byBar[i][tr.staff].push({ ti: ti, pi: pi, p: p, tr: tr });
      }));
      for (let i = 0; i < bars; i++) {
        [1, 2].forEach(staff => {
          const items = byBar[i][staff];
          const state = keyAlters(sigOfBar[i]), accState = {};
          /* S8 (lane B, rec/key.js): the note's own spelling and the bar's signature, accidentals by its rule (the same tied-over rule as below) */
          const accV2 = model.keysV2 ? keyLib().accidentals() : null;
          if (accV2) accV2.begin(sigOfBar[i]);
          const heads = new Map();
          items.filter(x => x.p.kind === 'note').sort((x, y) => x.p.at - y.p.at || x.tr.voice - y.tr.voice).forEach(x => {
            heads.set(x, x.p.notes.map(n => {
              if (accV2) {
                const s2 = spellOf(n), h2 = { pitch: s2.alter ? { step: s2.step, alter: s2.alter, oct: s2.octave } : { step: s2.step, oct: s2.octave } };
                if (accV2.next(s2.step, s2.octave, s2.alter, x.p.tieIn)) h2.acc = { type: ACCIDENTAL_NAME[s2.alter] };
                return h2;
              }
              const sp = spell(n.midi, table), k = sp.step + sp.octave;
              const current = k in accState ? accState[k] : state[sp.step];
              const head = { pitch: sp.alter ? { step: sp.step, alter: sp.alter, oct: sp.octave } : { step: sp.step, oct: sp.octave } };
              if (sp.alter !== current && !x.p.tieIn) head.acc = { type: ACCIDENTAL_NAME[sp.alter] };
              /* a tied-over note needs no accidental and changes nothing (the engraver's rule; the legacy writer let it set the bar's state,
                 which drops the sign of a later note of the same pitch after a note tied over the bar line) */
              if (!x.p.tieIn) accState[k] = sp.alter;
              return head;
            }));
          });
          items.sort((x, y) => x.ti - y.ti || x.p.at - y.p.at).forEach(x => {
            const p = x.p, m = mid[i], from = p.at - i * bar;
            const display = p.dots ? { type: p.type, dots: p.dots } : { type: p.type };
            if (p.measureRest) display.measureRest = true;
            const v = vid[x.tr.staff * 10 + x.tr.voice];
            if (p.kind === 'rest') {
              evId.set(x.ti + '|' + x.pi, b.event(part, { kind: 'rest', m: m, at: W(from), dur: W(p.len), voice: v, staff: st[staff], display: display }).id);
              return;
            }
            const event = b.event(part, { kind: 'note', m: m, at: W(from), dur: W(p.len), voice: v, staff: st[staff], display: display, heads: heads.get(x) });
            evId.set(x.ti + '|' + x.pi, event.id);
            p.notes.forEach((n, ci) => {
              const id = event.heads[ci].id;
              if (p.tieIn) {
                const f = pending[x.ti].get(n.midi);
                ties.push(f ? { from: f, to: id } : { to: id });
                pending[x.ti].delete(n.midi);
              }
              if (p.tieOut) pending[x.ti].set(n.midi, id);
              if (!p.tieIn && p.at === p.evStart) headOf.set(staff + '|' + p.evStart + '|' + n.midi, id);
            });
          });
        });
      }
      pending.forEach(mp => mp.forEach(f => ties.push({ from: f })));
      Wr.tuplets.forEach(t => {
        const x = { type: 'tuplet', events: t.pieces.map(pi => evId.get(t.track + '|' + pi)), actual: t.actual, normal: t.normal };
        if (t.unit) x.unit = t.unit;
        b.spanner(part, x);
      });
    };
    if (model.v2) writeV2(model.v2);
    else {
      for (let i = 0; i < bars; i++) {
        writeStaff(b1[i], 1, i);
        writeStaff(b2[i], 2, i);
      }
      [1, 2].forEach(s => pendingTie[s].forEach(from => ties.push({ from: from })));
    }
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
        /* a time that is not a number, before the recording or no longer than its start is not a performance */
        if (!(isFinite(n.on) && isFinite(n.off) && +n.on >= 0 && +n.off > +n.on)) return;
        const on = R.secondsToMicros(+n.on), off = R.secondsToMicros(+n.off);
        if (!(off > on)) return;
        const vel = isFinite(n.vel) ? Math.max(1, Math.min(127, Math.round(+n.vel))) : 64;
        const x = { on: on, off: off, vel: vel, midi: n.midi };
        /* a MIDI file states which track and channel a note came from; a microphone does not */
        if (Number.isInteger(n.track)) x.track = n.track;
        if (Number.isInteger(n.channel)) x.channel = n.channel;
        const link = n.staff ? headOf.get(n.staff + '|' + n.tick + '|' + n.midi) : null;
        if (link) x.link = link;
        b.perfNote(pf, x);
      });
      (heard.pedals || []).forEach(p => {
        if (!(isFinite(p.on) && isFinite(p.off) && p.on >= 0 && p.off > p.on)) return;
        const on = R.secondsToMicros(+p.on), off = R.secondsToMicros(+p.off);
        if (off > on) b.perfPedal(pf, { pedal: 'damper', on: on, off: off });
      });
      /* the controller stream, when the source had one (a MIDI file does, a recording does not) */
      (heard.controls || []).forEach(c => {
        if (!(isFinite(c.us) && c.us >= 0 && c.cc >= 0 && c.cc <= 127 && c.value >= 0 && c.value <= 127)) return;
        const x = { cc: c.cc | 0, us: Math.round(c.us), value: c.value | 0 };
        if (Number.isInteger(c.channel)) x.channel = c.channel;
        if (Number.isInteger(c.track)) x.track = c.track;
        b.perfControl(pf, x);
      });
      let lastUs = -1;
      (heard.barSeconds || []).forEach((sec, i) => {
        if (!(isFinite(sec) && sec >= 0)) return;
        const us = R.secondsToMicros(sec);
        if (us <= lastUs) return;                          /* anchors increase strictly (E-PERF) */
        lastUs = us;
        b.anchor(pf, { m: mid[Math.min(i, bars - 1)], k: 1, at: i < bars ? '0' : W(bar), us: us, kind: 'bar' });
      });
    }
    return b.finish();
  }

  /* The floor: fewer than four notes give the beat and metre nothing to stand on (G2 R4; it stays until G10a). The
     message says what happened, not that there were none; the app words it for a recording or a MIDI file by the
     code (App midiMessage, and the recording import). */
  function noNotes(count) {
    const e = new Error('PPP needs at least four notes to write a score; this has ' + (count | 0) + '.');
    e.code = 'no-notes';
    e.notes = count | 0;
    throw e;
  }

  function finish(q, notes, beats, opts, extra) {
    extra = extra || {};
    const beatsPerBar = extra.beatsPerBar;
    const beatType = extra.beatType || 4;
    const ticksPerBeat = extra.ticksPerBeat || Q;
    const bar = Math.round(beatsPerBar * (4 / beatType) * Q);
    /* v2's stage S3 (rec/grid.js, G10a-2): the onsets are already on one grid per beat */
    const gridV2 = extra.gridV2 || null;
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
    const handsReport = writeHands(q, opts, extra);

    const pedals = [];
    const held = [];
    /* S9 (G10a-3): the spans the heard notes agree with; null = every heard span, as before */
    const pedalV2 = pedalSpans(opts, extra);
    /* v2 (G10a-3): a beat is ticksPerBeat ticks - 36 in a compound skeleton - so a mark's tick is a beat position times that. Legacy multiplies by Q whatever the beat is (a compound piece's marks land a third
       early: 24 ticks for a 36-tick beat; found on rec-core, kept as it is in legacy like the other defects of section 17) */
    const pedalTicks = extra.recording === 'v2' || pedalV2 ? ticksPerBeat : Q;
    (pedalV2 ? pedalV2.spans : (extra.pedals || [])).forEach(p => {
      const pp = beatPosition(beats, p.on);
      const a = Math.round(pp * pedalTicks) - origin;
      const b = Math.round(snapEnd(beatPosition(beats, p.off)) * pedalTicks) - origin;
      /* A press or release that is not a number leaves no position to write the mark at, the same way
         clean() drops a note whose times are not finite. The three range tests beside it cannot see
         that — every comparison against NaN is false — so it has to be asked for. Without it the pedal
         reached the writers with a NaN tick: the ScoreGraph writer threw the whole score away and the
         G0 writer left an unpaired <pedal> mark. A press with no release (off Infinity) is not this:
         it is finite once clamped and still lasts to the last tick (G01 §26 F2). */
      if (isNaN(a) || isNaN(b) || b - a < 6 || b <= 0 || a >= bars * bar) return;
      /* TD20, fixed for v2 only (G10a-1; legacy keeps it, docs/GOALS/G10 section 17): a press in the score's last tick has
         its release clamped to that tick (bars * bar - 1 below), a span that ends where it starts, and the graph builder
         threw E-SPAN-ORDER for the whole score. Such a press has nothing left to sustain in the score: it is not written
         (the performance layer keeps it) */
      if ((extra.recording === 'v2' || pedalV2) && Math.min(bars * bar - 1, b) <= Math.max(0, a)) return;
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
    /* exact bars (see exactGrid): a recording in a simple-time bar with opts.exactBars; the library default and a MIDI file write the score as they always did */
    let grid = null, gridReport = null, v2w = null;
    /* v2 (G10a-3): the writer of rec/writer.js (S5-S7: voices, rests, exact bars in every metre, the tuplets) instead of exactGrid / staffEvents below;
       opts.writer 'legacy' keeps them under v2 (for comparison) */
    const v2Writer = extra.recording === 'v2' && opts.exactBars && !opts.legacyWriter && opts.writer !== 'legacy' && (opts.sourceKind || 'audio-score') === 'audio-score' ? writerLib() : null;
    if (v2Writer) {
      /* the run rule of the grid stage (a staff silent before an odd-32nd onset: no 32nd rest is written), now that the hands are known; simple time only (a compound beat's grid has no 32nds) */
      if (notationBeat !== Q * 3 / 2) gridReport = gridV2 ? Object.assign({ v2: gridV2.report }, gridLib().writable(q)) : snapOnsets(q, bars, bar, beats, origin, ticksPerBeat);
      /* S5 (rec/voices.js): a second voice per staff where S4 read four-part writing (its 'chorale' style); opts.voices 'one' keeps one voice per staff */
      const VL = opts.voices === 'one' ? null : voicesLib();
      const voicesReport = VL ? VL.assignQ(q, { style: handsReport && handsReport.style }).report : null;
      /* S6 (rec/rests.js, AI-5b): which silences of restMin or more between two notes of a voice are rests; opts.rests 'rule' keeps the fixed rule (every one is) */
      const RS = opts.rests === 'rule' ? null : restsLib();
      if (opts.rests === 'model' && !RS) { const e = new Error('rec/rests.js (S6) is not loaded'); e.code = 'E-RESTS-NO-LIB'; throw e; }
      let restsReport = null;
      const decideRests = RS ? (cands, info) => {
        const d = RS.decide(cands, { bar: bar, unit: info.unit, notes: q, pedals: extra.pedals || [] });
        restsReport = d.report;
        return d.rest;
      } : null;
      v2w = v2Writer.write(q, { bar: bar, bars: bars, beatType: beatType, beatsPerBar: beatsPerBar, compound: notationBeat === Q * 3 / 2,
        restMin: opts.onsetDurations === false ? 0 : Math.round((opts.restMin !== undefined ? +opts.restMin : REST_MIN) * 4 * Q), allowBarTies: allowBarTies,
        decideRests: decideRests });
      if (restsReport) v2w.report.restModel = restsReport;
      if (voicesReport) v2w.report.voiceModel = voicesReport;
    } else if (opts.exactBars && !opts.legacyWriter && (opts.sourceKind || 'audio-score') === 'audio-score' && beatType === 4 && ticksPerBeat === Q && tupletLib() && tupletLib().addTriplets) {
      /* with rec/grid.js the onsets are already on one grid per beat: snapOnsets' work is done but for its "genuine run" rule (a staff silent before
         an odd-32nd onset cannot be written: no rest shorter than a 16th), applied now that the hands are known */
      gridReport = gridV2 ? Object.assign({ v2: gridV2.report }, gridLib().writable(q)) : snapOnsets(q, bars, bar, beats, origin, ticksPerBeat);
      grid = exactGrid(q, bars, bar, opts.onsetDurations === false ? 0 : Math.round((opts.restMin !== undefined ? +opts.restMin : REST_MIN) * 4 * Q));
    }
    /* S8 (G10a-3): on the final ticks and staves, before the events are written (their heads carry the spelling) */
    const keyV2 = writeKeys(q, opts, extra, bar, bars);
    const keyW = keyV2 ? keyV2.key : key;
    const events1 = v2w ? [] : staffEvents(q, 1, bar, notationBeat, allowBarTies, grid);
    const events2 = v2w ? [] : staffEvents(q, 2, bar, notationBeat, allowBarTies, grid);

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
    const model = {
      title: title, key: keyW, beatsPerBar: beatsPerBar, beatType: beatType, bpm: roundBpm,
      bars: bars, events1: events1, events2: events2, pedals: pedals, table: table, grid: grid
    };
    if (v2w) model.v2 = v2w;
    if (keyV2) { model.keysV2 = true; model.keyChanges = keyV2.changes; }
    /* v2 (G10a-1): issue 1 fixed - a compound metre's printed dotted quarter = bpm plays 3 bpm / 2 quarters a minute */
    const v2Compound = extra.recording === 'v2' && beatType >= 8 && beatsPerBar % 3 === 0;
    if (extra.recording === 'v2') model.qpm = v2Compound ? (roundBpm % 2 ? (3 * roundBpm) + '/2' : String(3 * roundBpm / 2)) : String(roundBpm);

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
      xml: null,
      stats: {
        notes: notes.length, bars: bars, beatsPerBar: beatsPerBar, beatType: beatType, tempo: v2Compound ? 1.5 * roundBpm : roundBpm,
        key: keyW, keyMargin: keyW.margin, meterContrast: extra.meterContrast || 1,
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

    /* The MusicXML is written from the score as a ScoreGraph (docs/GOALS/G01 §15.3): the graph, its issues
       (warnings and notes; an error throws) and the file its exporter writes. opts.legacyWriter keeps the
       G0 writer, buildXml, for one release as the way back; it does not load the ScoreGraph library. */
    if (opts.legacyWriter) {
      result.xml = buildXml(model);
      return result;
    }
    model.scoreId = opts.scoreId;
    if (opts.sourceKind) model.sourceKind = opts.sourceKind;
    if (opts.sourceInput) model.sourceInput = opts.sourceInput;
    model.params = { beatSource: result.stats.beatSource, quantizer: result.stats.quantizer };
    if (extra.tempoAlias) model.params.tempoAlias = extra.tempoAlias;
    /* v2: the time skeleton is inferred by a learned model; the graph's provenance says which, and how sure it was */
    if (extra.recording === 'v2') model.params.recording = { pipeline: 'v2', skeleton: extra.recSkeleton || null };
    /* and which grid model placed the onsets (S3, G10a-2), with how many beats it was unsure of */
    if (gridV2) model.params.recording.grid = { model: gridV2.report.model, lowConf: gridV2.report.lowConf, beats: gridV2.plan.length };
    /* and which key stage wrote the key and the spelling (S8, G10a-3), with how many tonal regions and written key changes it found */
    if (keyV2) model.params.keys = { model: keyV2.report.version, regions: keyV2.regions.length, changes: keyV2.changes.length };
    /* and which pedal policy wrote the marks (S9, G10a-3): the spans heard, written, and dropped by reason */
    if (pedalV2) model.params.pedal = { model: pedalV2.report.version, heard: pedalV2.report.heard, kept: pedalV2.report.kept, dropped: pedalV2.report.dropped };
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
      const out = { on: n.on, off: n.off, midi: n.midi, vel: n.vel, staff: p ? p.staff : 0, tick: p ? p.tick : 0 };
      if (Number.isInteger(n.track)) out.track = n.track;
      if (Number.isInteger(n.channel)) out.channel = n.channel;
      return out;
    });
    const barSeconds = [];
    for (let b = 0; b <= bars; b++) barSeconds.push(tickToSec(b * bar));
    const built = buildGraph(model, { notes: heardNotes, pedals: extra.pedals || [],
      controls: extra.controls || [], barSeconds: barSeconds });
    let graph = built.graph, graphIssues = built.issues;
    const exactOn = !v2w && !!opts.exactBars && (model.sourceKind || 'audio-score') === 'audio-score' && !!(tupletLib() && tupletLib().addTriplets);
    const gaps = (opts.closeGaps === undefined ? CLOSE_GAPS_DEFAULT : !!opts.closeGaps) && (model.sourceKind || 'audio-score') === 'audio-score' ? gapsLib() : null;
    /* one tuplet over each triplet beat, rests inside it included (it replaces the one-note tuplets of the beats it describes): opts.exactBars (below: "exact bars"). BEFORE the gaps pass: a rest
       that a tuplet holds is not touched by mergeRests (a quarter rest and the triplet rest after it are not one dotted rest with a hole) */
    if (exactOn) {
      const tu = tupletLib().addTriplets(graph);
      if (tu.changed) { graph = tu.graph; graphIssues = tu.issues || graphIssues; }
      result.tupletReport = tu.stats;
    }
    if (gaps) {
      /* the gaps closed, then each silence written once: "consecutive rests" (scoregraph/gaps.js mergeRests; a page with an older gaps.js has no tidyRests and closes the gaps only) */
      const cg = gaps.tidyRests ? gaps.tidyRests(graph) : gaps.closeSmallGaps(graph);
      if (cg.changed) { graph = cg.graph; graphIssues = cg.issues || graphIssues; }
      result.gapReport = cg.stats; /* beside the graph, not in stats (the benchmark snapshots stats) */
      if (cg.rests) result.restReport = cg.rests;
    }
    /* G3 (docs/GOALS/G03 §5.1): the notation passes between the graph and the file. 'off' writes the graph as
       built; 'shadow' runs G3 and reports what it would change (proReport) but writes the graph as built; 'on'
       writes G3's graph. The report never goes into stats (the benchmark's snapshots). */
    const professional = opts.professional || PROFESSIONAL_DEFAULT;
    if (professional === 'shadow' || professional === 'on') {
      const pro = scoreGraph().professionalize(graph, opts.professionalOptions || {});
      result.proReport = pro.report;
      if (professional === 'on' && pro.graph !== graph) { graph = pro.graph; graphIssues = pro.issues; }
    }
    /* G10a-6: the octave lines of a v2 recording, last: every position above is final, and the critic of professionalize compares the graph with the one it is handed (see ottavaLib) */
    if (ottavaWanted(opts, extra)) {
      const OT = ottavaLib();
      if (OT) {
        try {
          const o = OT.addOttava(graph);
          result.ottavaReport = { changed: !!o.changed, fallback: !!o.fallback, spans: o.spans };   /* beside the graph, not in stats */
          if (o.changed && !o.fallback) { graph = o.graph; graphIssues = o.issues || graphIssues; }
        } catch (e) { result.ottavaReport = { changed: false, fallback: true, error: String(e && e.message || e) }; }
      } else result.ottavaReport = { changed: false, fallback: false, missing: true };
    }
    if (gridReport) result.gridReport = gridReport;            /* beside the graph, not in stats (the benchmark snapshots stats) */
    if (extra.recReport) result.recReport = extra.recReport;   /* v2's time skeleton report (G10a-1), beside the graph too */
    if (handsReport) result.handsReport = handsReport;         /* the same: v2's hands (S4, G10a-2) */
    if (keyV2) result.keyReport = { report: keyV2.report, key: keyV2.key, regions: keyV2.regions, changes: keyV2.changes };   /* and v2's key stage (S8, G10a-3) */
    if (pedalV2) result.pedalReport = { report: pedalV2.report, spans: pedalV2.spans, dropped: pedalV2.dropped };   /* and v2's pedal policy (S9, G10a-3) */
    if (gridV2) result.gridPlan = { plan: gridV2.plan, report: gridV2.report };   /* rec/grid.js's GridPlan (S3, G10a-2), beside the graph too */
    if (v2w) result.writerReport = v2w.report;                 /* v2's writer (S5-S7, G10a-3): voices, rest decisions, tuplets; beside the graph too */
    result.xml = scoreGraph().musicxml.export(graph, { software: 'PPP audio transcription' }).xml;
    result.graph = graph;
    result.graphIssues = graphIssues;
    return result;
  }

  function fromGrid(input, opts) {
    const g = input.grid;
    const raw = (g.notes || []).filter(n => n && isFinite(n.tick) && n.midi >= 21 && n.midi <= 108);
    if (raw.length < 4) noNotes(raw.length);
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
      pedals: input.pedals, controls: input.controls, title: input.title, quantizer: 'pm2s',
      beatSource: input.beats ? 'audio' : 'grid', errSum: 0, meterContrast: 2,
      arrangement: arrangementPlan, originalNotes: originalNotes
    });
  }

  /* ------------------------------------------------------------ v2 (G10a-1) */
  /* rec/ (the browser loads rec/*.js before this file and the weights as window.PPPRecWeights); null when it is absent */
  function recLib() {
    try {
      return typeof module === 'object' && module.exports ? require('./rec/index.js') : (global && global.PPPRec) || null;
    } catch (e) { return null; }
  }
  /* the score of a recording on rec/'s time skeleton, or null (the caller then writes it the legacy way) */
  function recordingV2(input, opts, clustered, timingClustered, timingNotes, arrangementPlan) {
    const lib = recLib();
    if (!lib) return null;
    /* the skeleton is read from the whole performance (an arrangement must not change the tempo or the metre) */
    const sk = lib.skeleton(timingClustered, { weights: opts.recWeights, beats: input.beats, downbeats: input.downbeats });
    if (!sk) return null;
    const beats = sk.beats;
    const compound = !!sk.metre.compound;
    let q, errSum, gridV2 = null;
    if (opts.grid !== 'legacy' && gridLib()) {
      /* S3 (G10a-2): the grid of each beat and the onsets on it, rec/grid.js on the skeleton's beats (ticks from beats[0], as quantize and quantizeCompound
         place them: 24 a quarter, 36 a dotted quarter) */
      gridV2 = gridLib().legacyQ(clustered, beats, { compound: compound });
      q = gridV2.q; errSum = gridV2.errSum;
    } else if (compound) {
      q = quantizeCompound(clustered, beats);
      errSum = q.reduce((s, n) => s + n.err, 0);
    } else {
      const trip = tripletBeats(clustered, beats);
      const r = quantize(clustered, beats, trip, true);
      q = r.q; errSum = r.errSum;
    }
    return finish(q, clustered, beats, opts, {
      beatsPerBar: sk.metre.beats, beatType: sk.metre.beatType, origin: 0, heard: timingNotes,
      pedals: input.pedals, controls: input.controls, title: input.title, quantizer: 'heuristic',
      beatSource: sk.report.chosen.audio ? 'audio-v2' : 'onset-v2', errSum: errSum, meterContrast: 1 + sk.conf,
      ticksPerBeat: compound ? 36 : Q, tactus: compound ? 'dotted-quarter' : 'quarter',
      arrangement: arrangementPlan, originalNotes: timingNotes.length,
      recording: 'v2', recSkeleton: { model: sk.model.name + '@' + sk.model.version, conf: Math.round(sk.conf * 1000) / 1000, metre: sk.metre.key },
      recReport: sk, gridV2: gridV2
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
    if (notes.length < 4) noNotes(notes.length);
    const clustered = clusterNotes(notes, CLUSTER_S);
    /* Arrangement must not change the detected tempo or metre. Analyse the
       original performance, then write only the selected voices. */
    const timingClustered = clusterNotes(timingNotes, CLUSTER_S);
    const last = timingClustered.reduce((m, n) => Math.max(m, n.off), 0);
    const env = envelope(timingClustered, Math.ceil((last + 1) * FPS));
    const onsets = [];
    timingClustered.forEach(n => { if (!onsets.length || n.attack - onsets[onsets.length - 1] > 0.03) onsets.push(n.attack); });

    const lock = opts.lock || null;
    /* The recording conversion v2 (docs/GOALS/G10 sections 6 and 8, G10a-1): rec/ decides the time skeleton - the
       beats, the metre, the bar lines, the pickup and the tempo - with a model learned from the catalogue, and the
       quantiser and writer below write the score on it (S3-S10 stay as they are until G10a-2/3). Only when asked
       (opts.recording 'v2') and only for a recording the caller has not already fixed (no lock, no stated metre);
       a page without rec/ or its weights, or a performance rec/ cannot read, is written exactly as before. */
    if (opts.recording === 'v2' && !lock && !opts.beatsPerBar) {
      const written = recordingV2(input, opts, clustered, timingClustered, timingNotes, arrangementPlan);
      if (written) return written;
    }
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
      pedals: input.pedals, controls: input.controls, title: input.title, quantizer: 'heuristic',
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

  /* --------------------------------------------------------------- MIDI ---
     A MIDI file is a recording of key presses, so it comes in the same door as
     one: what it states goes to the performance layer exactly, and the notation
     is worked out by the quantizer this file already has - the one G0 measures
     (docs/GOALS/G02 §7.6, decision D3). No new rhythm, voice or hand work here.

     fromMidi(bytes, opts) -> what toMusicXml returns, plus `midi`:
       {xml, stats, graph, graphIssues, midi: {raw, report, notes, dropped}}

     The graph's notation is inferred and says so: its source is this file, its
     default provenance is `inferred`, and legacy.toScore marks the Score
     `sgFrom.inferred`. The performance layer is the file's own facts - every
     note with its track and channel, the pedals, the whole controller stream -
     and nothing here rewrites them to suit the notation (D3 point 5). */
  function fromMidi(bytes, opts) {
    opts = opts || {};
    const SG = scoreGraph();
    const read = SG.midi.read(bytes, opts);
    if (!read.ok) { const e = new Error(read.code + ': ' + read.message); e.code = read.code; e.report = read.report; throw e; }
    const raw = read.raw;
    if (!raw.notes.length) { const e = new Error('the MIDI file holds no note'); e.code = 'MIDI-NO-NOTES'; throw e; }
    const us = raw.usAt;
    const sec = t => us(t) / 1e6;

    const notes = raw.notes.filter(n => us(n.offTick) > us(n.onTick)).map(n => ({
      on: sec(n.onTick), off: sec(n.offTick), midi: n.midi,
      vel: Math.max(1, Math.min(127, n.onVel)), track: n.track, channel: n.channel
    }));
    /* the damper, read as spans the way the pedal is everywhere else in PPP */
    const pedals = [];
    const down = new Map();
    raw.controls.forEach(c => {
      if (c.cc !== 64) return;
      const key = c.track + '|' + c.channel;
      if (c.value >= 64) { if (!down.has(key)) down.set(key, sec(c.tick)); }
      else if (down.has(key)) { const on = down.get(key); down.delete(key); if (sec(c.tick) > on) pedals.push({ on: on, off: sec(c.tick) }); }
    });
    const endSec = sec(raw.endTick);
    down.forEach(on => { if (endSec > on) pedals.push({ on: on, off: endSec }); });
    pedals.sort((a, b) => a.on - b.on);
    const controls = raw.controls.map(c => ({ cc: c.cc, us: us(c.tick), value: c.value, channel: c.channel, track: c.track }));

    /* The beat grid is the file's own, not a guess: one tempo and one metre make a lock, and a tempo
       that moves gives the beat times the map computes. Both are paths audio-score already had. */
    const input = { notes: notes, pedals: pedals, controls: controls, title: opts.title || midiTitle(raw) };
    const one = raw.tempoMap.length <= 1 && raw.meterMap.length <= 1;
    const met = raw.meterMap[0] || { num: 4, den: 4 };
    const upq = raw.tempoMap.length ? raw.tempoMap[0].usPerQuarter : 500000;
    const o = Object.assign({}, opts, { sourceKind: 'midi-file' });
    if (opts.sourceName || opts.sourceSha256) {
      o.sourceInput = {};
      if (opts.sourceName) o.sourceInput.name = opts.sourceName;
      if (opts.sourceSha256) o.sourceInput.sha256 = opts.sourceSha256;
    }
    if (raw.division.kind === 'ppq' && one) {
      o.lock = { bpm: 60000000 / upq, beatsPerBar: met.num, beatType: met.den, firstDownbeat: 0 };
    } else if (raw.division.kind === 'ppq') {
      const ppq = raw.division.ppq;
      const beats = [];
      for (let k = 0; k * ppq <= raw.endTick + ppq; k++) beats.push(sec(k * ppq));
      input.beats = beats;
    }
    const result = toMusicXml(input, o);
    result.midi = { raw: raw, report: read.report, notes: raw.notes.length, kept: notes.length,
      dropped: raw.notes.length - notes.length };
    return result;
  }
  function midiTitle(raw) {
    const first = raw.tracks[0];
    if (raw.tracks.length > 1 && first && first.name) return first.name;
    const named = raw.tracks.find(t => t.name);
    return named ? named.name : 'MIDI file';
  }

  const api = {
    toMusicXml: toMusicXml,
    fromMidi: fromMidi,
    arrangeNotes: arrangeNotes,
    arrangementProfile: arrangementProfile,
    recommendArrangement: recommendArrangement,
    normaliseArrangement: normaliseArrangement,
    _: { estimateKey, spellingTable, spell, pieces, notePieces, snap: snap16, beatPosition, stabilizeBeats, meterAndPhase, centreSplit, clusterNotes, simplifyNotes, arrangeNotes, arrangementProfile, recommendArrangement, normaliseArrangement, SUB, Q, REST_MIN, clean, quantize }
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (global) global.PPPAudioScore = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : this);
