/* ============================================================================
   PPP — from the notes in a recording to a score

   A transcription model hears notes: when each key went down, when it came
   up, how hard, and when the pedal moved. It does not hear bars, beats, hands
   or how a pitch should be spelled. This file works those out and writes
   MusicXML, so a recording enters PPP through exactly the same parser as a
   file someone engraved by hand — nothing downstream knows the difference.

     notes ─ beats ─ metre & downbeat ─ grid ─ key ─ hands ─ MusicXML

   Every step is a plain, explainable heuristic, and every one reports how
   sure it was, because a rhythm guessed from a rubato performance is a guess
   and PPP says so rather than presenting it as the composer's.

   Runs in the browser (window.PPPAudioScore) and in Node (require), with no
   dependencies, so it can be tested without a page.
   ========================================================================== */
(function (global) {
  'use strict';

  const FPS = 100;            /* onset envelope frames per second */
  const SUB = 4;              /* grid steps per beat: sixteenths when the beat is a quarter */
  const MIN_BPM = 40, MAX_BPM = 200;

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
      .map(n => ({ on: Math.max(0, +n.on), off: Math.max(+n.on + 0.03, +n.off), midi: n.midi | 0, vel: n.vel == null ? 64 : +n.vel }))
      .sort((a, b) => a.on - b.on || a.midi - b.midi);
  }

  /* --------------------------------------------------------------- beats */
  /* One impulse per key press, louder and lower notes counting for more,
     smoothed a little: the rhythm of the piece as a single signal. */
  function envelope(notes, length) {
    const env = new Float64Array(length);
    notes.forEach(n => {
      const i = Math.round(n.on * FPS);
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

  /* The beat period is the lag at which the signal best matches itself,
     leaning towards moderate tempi — otherwise a run of sixteenths reads as
     a very fast beat and a slow chorale as a very slow one. */
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
      /* a real beat also lines up at twice its period */
      const s = (ac[lag] + 0.5 * (ac[lag * 2] || 0)) * prior;
      if (s > bestScore) { bestScore = s; best = lag; }
    }
    /* parabolic refinement to a fractional lag */
    const a = ac[best - 1] || 0, b = ac[best], c = ac[best + 1] || 0;
    const d = a - 2 * b + c;
    return d < 0 ? best + clamp(0.5 * (a - c) / d, -0.5, 0.5) : best;
  }

  /* The beat period as it moves through the piece: the same self-matching,
     over eight seconds at a time, kept within a third of the overall period
     so it follows a slowing phrase without jumping to the half or the double. */
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

  /* Dynamic-programming beat tracking (Ellis 2007): each beat is placed on
     the strongest onsets it can reach while keeping close to the period
     around it, so the grid bends with rubato instead of drifting away from
     the playing. */
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
    /* Chains start at the first real onset and are never cut after it, as in
       librosa: cutting a chain wherever its running score dips hands the
       opening to a straight-line guess, and a tempo that moves then loses a
       beat there. */
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
    /* end on the last strong local maximum of the cumulative score */
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

  /* A player's first note is nearly always on a beat, and often a slow one.
     Weighing tempo against onsets, the tracker may put that beat a little
     after the note, in the silence, with more silent beats before it. Beats
     before the music are dropped, and a first beat that just misses the first
     note is moved onto it; a note well ahead of the beat stays a pickup. */
  function alignStart(beats, first) {
    const out = beats.filter(b => b >= first - 0.05);
    if (out.length < 2) return beats;
    const step = out[1] - out[0];
    if (out[0] - first > 0.02 && out[0] - first < 0.35 * step) out[0] = first;
    return out;
  }

  /* Beats before the first and after the last, so every note falls between
     two. Each added beat lands on a note if one is near where it is expected,
     and at the local spacing if not. */
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
    /* a note a hair before the first beat is that beat, played early */
    while (out[0] - from > 0.35 * (out[1] - out[0])) {
      /* the spacing of the nearest beats, so a tempo that was changing keeps changing */
      const step = out[1] - out[0];
      const t = out[0] - step;
      const hit = onsets ? near(t, step) : null;
      out.unshift(hit != null && hit < out[0] - step * 0.5 ? hit : t);
    }
    let step;
    step = out[out.length - 1] - out[out.length - 2];
    while (out[out.length - 1] < to + step) out.push(out[out.length - 1] + step);
    return out;
  }

  /* Seconds → beats, linearly between the tracked beats. */
  function beatPosition(beats, t) {
    let lo = 0, hi = beats.length - 1;
    if (t <= beats[0]) return (t - beats[0]) / (beats[1] - beats[0]);
    if (t >= beats[hi]) return hi + (t - beats[hi]) / (beats[hi] - beats[hi - 1]);
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (beats[mid] <= t) lo = mid; else hi = mid; }
    return lo + (t - beats[lo]) / (beats[lo + 1] - beats[lo]);
  }

  /* Snap to sixteenths, preferring the beat, then the half beat. The charge
     for a finer position is in seconds, not in fractions of a beat, because
     that is how expressive timing works: a chord placed 100 ms late is
     leaning on the beat at any tempo, while a real sixteenth at a fast tempo
     is only 100 ms long. */
  const LEVEL_COST = [0, 0.025, 0.06];
  function snap(pos, spb) {
    const k = Math.floor(pos);
    const f = pos - k;
    spb = spb || 0.6;
    let best = 0, bestCost = Infinity;
    for (let s = 0; s <= SUB; s++) {
      const c = s / SUB;
      const level = s % SUB === 0 ? 0 : s % 2 === 0 ? 1 : 2;
      const cost = Math.abs(f - c) * spb + LEVEL_COST[level];
      if (cost < bestCost) { bestCost = cost; best = s; }
    }
    return { tick: k * SUB + best, err: Math.abs(f - best / SUB) };
  }
  /* seconds per beat around a position */
  function spbAt(beats, pos) {
    const k = clamp(Math.floor(pos), 0, beats.length - 2);
    return beats[k + 1] - beats[k];
  }
  /* When a key comes up is far less exact than when it goes down, and a
     release written to the sixteenth reads as a fussy tie into the next bar.
     Ends go to the eighth, and to the beat when they are anywhere near it. */
  function snapEnd(pos) {
    const k = Math.floor(pos);
    const f = pos - k;
    let best = 0, bestCost = Infinity;
    [0, 0.5, 1].forEach(c => {
      const cost = Math.abs(f - c) + (c === 0.5 ? 0.12 : 0);
      if (cost < bestCost) { bestCost = cost; best = c; }
    });
    return k * SUB + Math.round(best * SUB);
  }

  /* ------------------------------------------------------- metre & downbeat */
  /* What makes a beat feel like the first of a bar is mostly the bass: a low
     note that arrives on it and is held. A thick chord on beat two is louder
     but is not a downbeat, so the upper notes only nudge. */
  function accents(qnotes, nBeats) {
    const bass = new Float64Array(nBeats), rest = new Float64Array(nBeats);
    const lowest = {};
    qnotes.forEach(n => { if (lowest[n.tick] == null || n.midi < lowest[n.tick]) lowest[n.tick] = n.midi; });
    qnotes.forEach(n => {
      if (n.tick % SUB) return;
      const k = n.tick / SUB;
      if (k < 0 || k >= nBeats) return;
      const w = (0.35 + n.vel / 127) * (1 + Math.min(4, n.lenTicks / SUB) / 2);
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
    const three = rate(3), four = rate(4);
    /* four is far more common, so three has to win clearly */
    return three.contrast > four.contrast * 1.08 ? three : four;
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
  /* Krumhansl–Kessler: which key's profile the pitch content best matches. */
  function estimateKey(notes) {
    const h = new Array(12).fill(0);
    notes.forEach(n => { h[n.midi % 12] += Math.min(2, n.off - n.on) * (0.5 + n.vel / 127); });
    let best = { fifths: 0, mode: 'major', tonic: 0, r: -2 }, second = -2;
    for (let t = 0; t < 12; t++) {
      const rot = i => h[(i + t) % 12];
      const hr = h.map((_, i) => rot(i));
      const rM = corr(hr, KK_MAJOR), rm = corr(hr, KK_MINOR);
      [[rM, 'major'], [rm, 'minor']].forEach(([r, mode]) => {
        if (r > best.r) {
          second = best.r;
          const rel = mode === 'major' ? t : (t + 3) % 12;
          let fifths = MAJOR_FIFTHS[rel];
          if (mode === 'minor' && rel === 6) fifths = -6;      /* E♭ minor, not D♯ minor */
          best = { fifths: fifths, mode: mode, tonic: t, r: r };
        } else if (r > second) second = r;
      });
    }
    best.margin = best.r - second;
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
  /* One spelling per pitch class for the whole piece: the key's own notes as
     the key spells them, and each of the other five as the chromatic degree
     it usually is in that mode — in C major C♯, E♭, F♯, G♯ and B♭; in A
     minor B♭, C♯, D♯, F♯ and G♯. So D major's C is C♮, never B♯. */
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
      /* raise the key's note a semitone below, or lower the one above */
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
  /* What it costs to divide one chord at pitch s: a hand stretched past an
     octave, a hand given more than five notes, or the hands crowding each
     other — two hands playing together leave a gap between them, so a split
     that puts them a few semitones apart is usually a chord cut in two. */
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
  /* Where the hands divide for the piece as a whole: the one split that asks
     least of them across every chord, nearest middle C when several do. A
     left hand that leaps from a bass note to a chord above it keeps that chord
     once the melody arrives over it, and so it keeps it before, too. */
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
  /* Then a split point per chord, free to move where a passage needs it but
     charged for every semitone it moves, so the hands do not trade notes back
     and forth from one chord to the next. The pull towards the overall split
     is kept faint on purpose: a chord that either hand could play takes its
     hand from the chords around it that could not — the bars before a melody
     enters follow the bars after — rather than from a fixed pitch. */
  function assignHands(qnotes) {
    const groups = [];
    const byTick = {};
    qnotes.forEach(n => {
      if (!byTick[n.tick]) { byTick[n.tick] = { tick: n.tick, notes: [] }; groups.push(byTick[n.tick]); }
      byTick[n.tick].notes.push(n);
    });
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
  const TYPES = { 16: ['whole', 0], 12: ['half', 1], 8: ['half', 0], 6: ['quarter', 1], 4: ['quarter', 0], 3: ['eighth', 1], 2: ['eighth', 0], 1: ['16th', 0] };
  /* A length in sixteenths, broken into values a player can read: nothing
     crosses a beat unless it starts on one. */
  function pieces(pos, len, bar) {
    const out = [];
    while (len > 0) {
      let v;
      if (pos % SUB) {
        const room = Math.min(len, SUB - (pos % SUB));
        v = [3, 2, 1].find(x => x <= room && (x !== 2 || pos % 2 === 0) && (x !== 3 || pos % SUB === 1)) || 1;
      } else {
        v = [16, 12, 8, 6, 4].find(x => x <= len && pos + x <= bar &&
          (x !== 16 || pos === 0) && (x !== 12 || pos % 4 === 0) && (x !== 8 || pos % 4 === 0)) ||
          [3, 2, 1].find(x => x <= len) || 1;
      }
      out.push(v);
      pos += v; len -= v;
    }
    return out;
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
  }

  /* One voice per staff: every onset in a hand becomes a chord that lasts
     until that hand plays again, or until its keys come up. Where the pedal
     or a short gap would leave a fussy rest, the note is held through it. */
  function staffEvents(notes, staff, pedalHeld) {
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
      let end = Math.max.apply(null, ns.map(n => n.endTick));
      if (next !== Infinity && end < next) {
        const gap = next - end;
        if (gap < SUB || pedalHeld(end, next)) end = next;
      }
      end = Math.min(end, next);
      if (end <= t) end = Math.min(t + 1, next);
      events.push({ start: t, end: end, notes: ns });
    });
    return events;
  }

  function buildXml(model) {
    const { title, key, beatsPerBar, bpm, bars, events1, events2, pedals, table } = model;
    const bar = beatsPerBar * SUB;
    const out = [];
    out.push('<?xml version="1.0" encoding="UTF-8"?>');
    out.push('<score-partwise version="3.1">');
    out.push('<work><work-title>' + esc(title) + '</work-title></work>');
    out.push('<identification><encoding><software>PPP audio transcription</software></encoding></identification>');
    out.push('<part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>');
    out.push('<part id="P1">');

    /* each event cut at the barlines, as tied pieces */
    const perBar = events => {
      const buckets = [];
      for (let b = 0; b < bars; b++) buckets.push([]);
      events.forEach(e => {
        let s = e.start;
        while (s < e.end) {
          const b = Math.floor(s / bar);
          if (b >= bars) break;
          const stop = Math.min(e.end, (b + 1) * bar);
          buckets[b].push({ start: s, end: stop, notes: e.notes, tieIn: s > e.start, tieOut: stop < e.end });
          s = stop;
        }
      });
      return buckets;
    };
    const b1 = perBar(events1), b2 = perBar(events2);
    const pedalAt = {};
    pedals.forEach(p => { (pedalAt[p.tick] = pedalAt[p.tick] || []).push(p.type); });

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
        pieces(from, to - from, bar).forEach(v => {
          emitPedalsUpTo(from + v, from);
          const t = full ? TYPES[bar] || ['whole', 0] : TYPES[v];
          x.push('<note>' + (full ? '<rest measure="yes"/>' : '<rest/>') + '<duration>' + v + '</duration><voice>' + voice +
            '</voice><type>' + t[0] + '</type>' + (t[1] ? '<dot/>' : '') + '<staff>' + staff + '</staff></note>');
          from += v;
        });
      };
      list.forEach(ev => {
        const s = ev.start - barStart, e = ev.end - barStart;
        if (s > cursor) rest(cursor, s);
        let pos = s;
        const parts = pieces(s, e - s, bar);
        parts.forEach((v, pi2) => {
          emitPedalsUpTo(pos + v, pos);
          const t = TYPES[v];
          const tieStop = pi2 > 0 || ev.tieIn, tieStart = pi2 < parts.length - 1 || ev.tieOut;
          ev.notes.forEach((n, ci) => {
            const sp = spell(n.midi, table);
            const k = sp.step + sp.octave;
            const current = k in accState ? accState[k] : state[sp.step];
            let acc = '';
            if (sp.alter !== current && !tieStop) {
              acc = '<accidental>' + ({ '-2': 'flat-flat', '-1': 'flat', '0': 'natural', '1': 'sharp', '2': 'double-sharp' }[sp.alter]) + '</accidental>';
            }
            accState[k] = sp.alter;
            x.push('<note>' + (ci ? '<chord/>' : '') +
              '<pitch><step>' + sp.step + '</step>' + (sp.alter ? '<alter>' + sp.alter + '</alter>' : '') + '<octave>' + sp.octave + '</octave></pitch>' +
              '<duration>' + v + '</duration>' +
              (tieStop ? '<tie type="stop"/>' : '') + (tieStart ? '<tie type="start"/>' : '') +
              '<voice>' + voice + '</voice><type>' + t[0] + '</type>' + (t[1] ? '<dot/>' : '') + acc +
              '<staff>' + staff + '</staff>' +
              ((tieStop || tieStart) ? '<notations>' + (tieStop ? '<tied type="stop"/>' : '') + (tieStart ? '<tied type="start"/>' : '') + '</notations>' : '') +
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

    for (let b = 0; b < bars; b++) {
      out.push('<measure number="' + (b + 1) + '">');
      if (b === 0) {
        out.push('<attributes><divisions>' + SUB + '</divisions><key><fifths>' + key.fifths + '</fifths><mode>' + key.mode +
          '</mode></key><time><beats>' + beatsPerBar + '</beats><beat-type>4</beat-type></time><staves>2</staves>' +
          '<clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes>');
        out.push('<direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>' + bpm +
          '</per-minute></metronome></direction-type><staff>1</staff><sound tempo="' + bpm + '"/></direction>');
      }
      out.push(writeStaff(b1[b], 1, 1, b));
      out.push('<backup><duration>' + bar + '</duration></backup>');
      out.push(writeStaff(b2[b], 2, 5, b));
      out.push('</measure>');
    }
    out.push('</part></score-partwise>');
    return out.join('\n');
  }

  /* ------------------------------------------------------------ the whole */
  function toMusicXml(input, opts) {
    opts = opts || {};
    const notes = clean(input.notes);
    if (notes.length < 4) {
      const e = new Error('No piano notes were heard in this recording.');
      e.code = 'no-notes';
      throw e;
    }
    const last = notes.reduce((m, n) => Math.max(m, n.off), 0);
    const env = envelope(notes, Math.ceil((last + 1) * FPS));

    /* beats */
    let period = estimatePeriod(env);
    let beats = trackBeats(env, period, localPeriods(env, period));
    if (beats.length < 4) {
      beats = [];
      for (let t = notes[0].on; t <= last + period / FPS; t += period / FPS) beats.push(t);
    }
    const onsets = [];
    notes.forEach(n => { if (!onsets.length || n.on - onsets[onsets.length - 1] > 0.03) onsets.push(n.on); });
    beats = extendBeats(alignStart(beats, notes[0].on), notes[0].on, last, onsets);

    /* A grid that races along at the level of the running notes is really
       counting half-beats: keep every other one. */
    const ibi = () => { const d = []; for (let i = 1; i < beats.length; i++) d.push(beats[i] - beats[i - 1]); return d; };
    let bpm = 60 / median(ibi());
    if (bpm > 150) {
      const even = [], odd = [];
      beats.forEach((b, i) => (i % 2 ? odd : even).push(b));
      const strength = list => list.reduce((s, b) => s + (env[Math.round(b * FPS)] || 0), 0) / Math.max(1, list.length);
      beats = strength(even) >= strength(odd) ? even : odd;
      beats = extendBeats(beats, notes[0].on, last, onsets);
      bpm = 60 / median(ibi());
    }

    /* grid */
    let errSum = 0;
    const q = notes.map(n => {
      const pos = beatPosition(beats, n.on);
      const a = snap(pos, spbAt(beats, pos));
      const b = snapEnd(beatPosition(beats, n.off));
      errSum += a.err;
      return { midi: n.midi, vel: n.vel, on: n.on, off: n.off, tick: a.tick, endTick: Math.max(a.tick + 1, b), err: a.err, lenTicks: Math.max(1, b - a.tick) };
    });

    /* metre and where the bar starts */
    const nBeats = Math.ceil(Math.max.apply(null, q.map(n => n.endTick)) / SUB) + 1;
    const mp = opts.beatsPerBar ? { m: opts.beatsPerBar, phase: 0, contrast: 1 } : meterAndPhase(accents(q, nBeats));
    const beatsPerBar = mp.m;
    const bar = beatsPerBar * SUB;
    const firstTick = Math.min.apply(null, q.map(n => n.tick));
    /* the downbeat at or before the first note */
    let origin = mp.phase * SUB;
    while (origin > firstTick) origin -= bar;
    while (origin + bar <= firstTick) origin += bar;
    q.forEach(n => { n.tick -= origin; n.endTick -= origin; });
    /* The piece ends with the bar its last note starts in. A final chord left
       ringing is held to the barline rather than tied on through bars of
       nothing but its own decay. */
    const lastOnset = Math.max.apply(null, q.map(n => n.tick));
    const bars = Math.max(1, Math.floor(lastOnset / bar) + 1);
    q.forEach(n => { n.endTick = Math.min(n.endTick, bars * bar); });

    /* key and hands */
    const key = estimateKey(notes);
    const table = spellingTable(key);
    assignHands(q);

    /* pedal, on the same grid */
    const pedals = [];
    const held = [];
    (input.pedals || []).forEach(p => {
      const pp = beatPosition(beats, p.on);
      const a = snap(pp, spbAt(beats, pp)).tick - origin;
      const b = snapEnd(beatPosition(beats, p.off)) - origin;
      if (b - a < 2 || b <= 0 || a >= bars * bar) return;
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
    const pedalHeld = (a, b) => held.some(h => h[0] <= a && h[1] >= b);

    const events1 = staffEvents(q, 1, pedalHeld);
    const events2 = staffEvents(q, 2, pedalHeld);

    const title = (opts.title || input.title || 'Transcribed recording').trim() || 'Transcribed recording';
    const roundBpm = Math.round(clamp(bpm, 30, 240));
    const xml = buildXml({ title: title, key: key, beatsPerBar: beatsPerBar, bpm: roundBpm, bars: bars, events1: events1, events2: events2, pedals: pedals, table: table });

    /* where each bar starts in the recording, for listening back */
    const tickToSec = tick => {
      const pos = (tick + origin) / SUB;
      const k = Math.floor(pos);
      if (k < 0) return beats[0] + pos * (beats[1] - beats[0]);
      if (k >= beats.length - 1) { const n = beats.length; return beats[n - 1] + (pos - (n - 1)) * (beats[n - 1] - beats[n - 2]); }
      return beats[k] + (pos - k) * (beats[k + 1] - beats[k]);
    };
    const barStarts = [];
    for (let b = 0; b <= bars; b++) barStarts.push(Math.round(tickToSec(b * bar) * 1000) / 1000);

    /* how sure each step was, per bar and overall */
    const perBar = [];
    for (let b = 0; b < bars; b++) perBar.push({ err: 0, n: 0, sec: barStarts[b + 1] - barStarts[b] });
    q.forEach(n => { const b = Math.floor(n.tick / bar); if (perBar[b]) { perBar[b].err += n.err; perBar[b].n++; } });
    const d = ibi();
    const med = median(d);
    const cv = Math.sqrt(d.reduce((s, x) => s + (x - med) * (x - med), 0) / Math.max(1, d.length)) / (med || 1);
    const medBar = median(perBar.map(p => p.sec));

    return {
      xml: xml,
      stats: {
        notes: notes.length, bars: bars, beatsPerBar: beatsPerBar, tempo: roundBpm,
        key: key, keyMargin: key.margin, meterContrast: mp.contrast,
        gridError: errSum / notes.length,
        tempoVariation: cv,
        barStarts: barStarts,
        beats: beats.map(b => Math.round(b * 1000) / 1000),
        rh: q.filter(n => n.staff === 1).length, lh: q.filter(n => n.staff === 2).length,
        perBar: perBar.map((p, i) => ({
          bar: i + 1, notes: p.n,
          gridError: p.n ? p.err / p.n : 0,
          stretch: medBar ? p.sec / medBar : 1
        }))
      }
    };
  }

  const api = {
    toMusicXml: toMusicXml,
    /* exposed for tests */
    _: { estimateKey, spellingTable, spell, pieces, snap, beatPosition, meterAndPhase, centreSplit, SUB }
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (global) global.PPPAudioScore = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : this);
