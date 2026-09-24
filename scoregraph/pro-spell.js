/* ============================================================================
   PPP ScoreGraph — G3 pass P6: keys, spelling, printed accidentals
   (docs/GOALS/G03 §10)

   Printed accidentals (§10.3), for every staff of an inferred part:
     needed     a head whose alteration is not the one in force: the key
                signature's, or the last one printed on that step and octave
                of the staff in this measure (MusicXML's rule, and G0's
                critical.accidentals). A head a tie comes into needs none and
                changes nothing.
     courtesy   (cautionary) the first head of a step and octave in a measure
                (a) after the previous measure printed that step and octave
                    with another alteration,
                (b) after a key change that alters that step (once a step),
                (c) after a tie over the bar line brought another alteration
                    of it into the measure.
     otherwise  no accidental.
   Imported accidentals are kept (§14); fill mode only adds a needed one.

   Keys by region (§10.2, below): windows and a Viterbi from the writer's opening key; a later region changes key
   only when its windows outweigh the change. The line speller (§10.2) is below too, off unless opts.spelling.
   ========================================================================== */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports)
    module.exports = factory(require('./rational.js'), require('./pitch.js'), require('./ops.js'), require('./time.js'));
  else { const M = root.PPPScoreGraphModules = root.PPPScoreGraphModules || {}; M.proSpell = factory(M.rational, M.pitch, M.ops, M.time); }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (R, P, O, T) {
  'use strict';

  const SHARP_ORDER = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
  const ACC_OF = { '-2': 'flat-flat', '-1': 'flat', '0': 'natural', '1': 'sharp', '2': 'double-sharp' };

  /* A head whose exact pitch is a microtone the file stated (G2-D16: head.pitch is rounded, ext holds the value): its
     step and its printed accidental (quarter-sharp …) are the file's, and G3 has no microtonal spelling of its own, so
     it neither respells nor re-accidentals it, in any mode (G03 §28 m3). */
  const microtone = h => !!(h.ext && h.ext['musicxml.microtone']);

  /* the alteration of each step under a key signature (fifths) */
  function keyAlters(fifths) {
    const a = { C: 0, D: 0, E: 0, F: 0, G: 0, A: 0, B: 0 };
    if (fifths > 0) SHARP_ORDER.slice(0, fifths).forEach(l => { a[l] = 1; });
    if (fifths < 0) SHARP_ORDER.slice().reverse().slice(0, -fifths).forEach(l => { a[l] = -1; });
    return a;
  }

  /* The accidental each head should print: Map headId -> {type, cautionary?} | null. */
  function plan(g, part, opts) {
    opts = opts || {};
    const out = new Map();
    const tieIn = new Set(), tieFrom = new Map();
    const evOfHead = new Map();
    part.events.forEach(e => (e.heads || []).forEach(h => evOfHead.set(h.id, e)));
    part.spanners.forEach(s => { if (s.type === 'tie' && s.from !== undefined && s.to !== undefined) { tieIn.add(s.to); tieFrom.set(s.to, s.from); } });
    const ms = g.timeline.measures;
    const mIdx = new Map(ms.map((m, i) => [m.id, i]));
    /* the key in force at the start of each measure, per staff: time.keyAt's rule (the latest key at or before the
       measure's start; at one position a staff key beats a part key beats a global one), read once from the key list */
    const keyCache = new Map();
    const keysByM = new Map();
    (g.timeline.keys || []).forEach(k => { const i = mIdx.get(k.m); if (i === undefined) return; if (!keysByM.has(i)) keysByM.set(i, []); keysByM.get(i).push(k); });
    const rank = (k, staff) => (!k.scope ? 0 : k.scope.part !== part.id ? -1 : !k.scope.staff ? 1 : k.scope.staff === staff ? 2 : -1);
    part.staves.forEach(st => {
      let cur = null;
      ms.forEach((m, i) => {
        /* keys at this measure's start apply now; later in the measure, from the next one */
        const here = (keysByM.get(i) || []).filter(k => rank(k, st.id) >= 0);
        const atStart = here.filter(k => R.isZero(R.parse(k.at))).sort((a, b) => rank(b, st.id) - rank(a, st.id));
        if (atStart.length) cur = atStart[0];
        keyCache.set(m.id + '|' + st.id, cur ? cur.fifths : 0);
        const later = here.filter(k => !R.isZero(R.parse(k.at))).sort((a, b) => R.cmp(R.parse(a.at), R.parse(b.at)) || rank(a, st.id) - rank(b, st.id));
        if (later.length) cur = later[later.length - 1];
      });
    });
    const keyOf = (m, staff) => (keyCache.has(m + '|' + staff) ? keyCache.get(m + '|' + staff) : 0);
    part.staves.forEach(st => {
      /* the heads of this staff, per measure, in time order (grace notes before their main note) */
      const byM = ms.map(() => []);
      part.events.forEach(e => {
        if (e.kind !== 'note') return;
        e.heads.forEach(h => {
          if (!h.pitch || (h.staff || e.staff) !== st.id) return;
          byM[mIdx.get(e.m)].push({ e: e, h: h, at: R.parse(e.at), grace: e.grace ? e.grace.order : 0 });
        });
      });
      let prevPrinted = new Map();   /* step+oct -> alteration printed in the previous measure (courtesy a) */
      let prevKey = null;
      byM.forEach((list, mi) => {
        list.sort((a, b) => R.cmp(a.at, b.at) || (a.grace && !b.grace ? -1 : !a.grace && b.grace ? 1 : a.grace - b.grace) ||
          P.midi(a.h.pitch) - P.midi(b.h.pitch));
        const fifths = keyOf(ms[mi].id, st.id);
        const sig = keyAlters(fifths);
        const oldSig = prevKey === null ? sig : keyAlters(prevKey);
        const state = new Map(), printed = new Map(), seen = new Set(), seenStep = new Set();
        const tiedIn = new Map();      /* step+oct -> alteration a tie over the bar line brought in (courtesy c) */
        list.forEach(x => {
          const p = x.h.pitch, k = p.step + p.oct, alter = p.alter || 0;
          if (tieIn.has(x.h.id)) {
            out.set(x.h.id, null);
            const from = evOfHead.get(tieFrom.get(x.h.id));
            if (from && from.m !== x.e.m && !seen.has(k)) tiedIn.set(k, alter);
            return;
          }
          const prevailing = state.has(k) ? state.get(k) : sig[p.step];
          let acc = null;
          if (alter !== prevailing) acc = { type: ACC_OF[String(alter)] };
          else if (!seen.has(k) && opts.courtesy !== false) {
            const a = prevPrinted.has(k) && prevPrinted.get(k) !== alter;
            const b = prevKey !== null && prevKey !== fifths && oldSig[p.step] !== sig[p.step] && !seenStep.has(p.step);
            const c = tiedIn.has(k) && tiedIn.get(k) !== alter;
            if (a || b || c) acc = { type: ACC_OF[String(alter)], cautionary: true };
          }
          if (acc && !ACC_OF[String(alter)]) acc = null;
          out.set(x.h.id, acc);
          if (acc) { state.set(k, alter); printed.set(k, alter); }
          seen.add(k); seenStep.add(p.step);
        });
        prevPrinted = printed;
        prevKey = fifths;
      });
    });
    return out;
  }

  /* ------------------------------------------------------------ keys by region (§10.2) */
  /* audio-score's estimateKey, as it is (G03 §10.2: "the same function on a window"): Krumhansl-Kessler correlation
     plus 1.8 × diatonic fit, over a pitch-class histogram weighted by length (at most 2 quarters) */
  const KK_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
  const KK_MINOR = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
  const MAJOR_FIFTHS = { 0: 0, 7: 1, 2: 2, 9: 3, 4: 4, 11: 5, 6: 6, 1: -5, 8: -4, 3: -3, 10: -2, 5: -1 };
  const SCALES = { major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10] };
  function corr(a, b) {
    const ma = a.reduce((x, y) => x + y, 0) / a.length, mb = b.reduce((x, y) => x + y, 0) / b.length;
    let n = 0, da = 0, db = 0;
    for (let i = 0; i < a.length; i++) { n += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2; }
    return n / Math.sqrt(da * db || 1);
  }
  /* the 24 keys scored on a histogram: [{tonic, mode, fifths, score}] */
  function keyScores(h) {
    const total = h.reduce((x, y) => x + y, 0) || 1;
    const out = [];
    for (let t = 0; t < 12; t++) {
      const hr = h.map((_, i) => h[(i + t) % 12]);
      [[corr(hr, KK_MAJOR), 'major'], [corr(hr, KK_MINOR), 'minor']].forEach(([r, mode]) => {
        const fit = SCALES[mode].reduce((x, pc) => x + h[(t + pc) % 12], 0) / total;
        const rel = mode === 'major' ? t : (t + 3) % 12;
        let fifths = MAJOR_FIFTHS[rel];
        if (mode === 'minor' && rel === 6) fifths = -6;
        out.push({ tonic: t, mode: mode, fifths: fifths, score: r + 1.8 * fit });
      });
    }
    return out;
  }
  /* the spelling table of audio-score (spellingTable): the diatonic steps of a key, and each chromatic pitch class
     spelled from its neighbour in the direction the mode prefers */
  const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
  const LETTER_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const CHROMATIC = { major: { 1: 1, 3: -1, 6: 1, 8: 1, 10: -1 }, minor: { 1: -1, 4: 1, 6: 1, 9: 1, 11: 1 } };
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
  function spellMidi(midi, table) {
    const x = table[midi % 12];
    const oct = Math.floor((midi - x.alter) / 12) - 1;
    return x.alter ? { step: x.step, alter: x.alter, oct: oct } : { step: x.step, oct: oct };
  }
  const KEY_W = Object.freeze({ WINDOW: 8, HOP: 4, MIN: 4, CHANGE: 1.5, FIFTH: 0.5 });
  /* The key of every measure by windows and a Viterbi (§10.2), or null when the piece is too short to have regions.
     A change costs 1.5 plus 0.5 a fifth, a key lasts at least 4 measures, a change of one fifth is not written. Scores are rounded to thousandths so no
     float decides a tie. */
  function regionKeys(g, part, opening) {
    const ms = g.timeline.measures, n = ms.length;
    if (n < KEY_W.WINDOW + KEY_W.HOP) return null;
    const mIdx = new Map(ms.map((m, i) => [m.id, i]));
    const hist = ms.map(() => new Array(12).fill(0));
    part.events.forEach(e => {
      if (e.kind !== 'note' || e.grace) return;
      const q = Math.min(2, R.toNumber(R.parse(e.dur)) * 4);
      e.heads.forEach(h => { if (h.pitch) hist[mIdx.get(e.m)][P.midi(h.pitch) % 12] += q * (0.5 + 64 / 127); });
    });
    const starts = [];
    for (let st = 0; st + KEY_W.WINDOW <= n; st += KEY_W.HOP) starts.push(st);
    if (starts[starts.length - 1] + KEY_W.WINDOW < n) starts.push(n - KEY_W.WINDOW);
    const wins = starts.map(st => {
      const h = new Array(12).fill(0);
      for (let i = st; i < st + KEY_W.WINDOW; i++) hist[i].forEach((x, k) => { h[k] += x; });
      return keyScores(h).map(k => Object.assign(k, { score: Math.round(k.score * 1000) }));
    });
    const K = 24, change = Math.round(KEY_W.CHANGE * 1000), fifth = Math.round(KEY_W.FIFTH * 1000);
    /* the opening key is the writer's (audio-score estimated it from what was heard, velocities and releases included,
       which the graph does not hold): the path starts there, and a later region changes key only when its windows
       outweigh the change */
    let cost = wins[0].map(k => (opening === undefined || k.fifths === opening ? -k.score : Infinity));
    const back = [];
    for (let w = 1; w < wins.length; w++) {
      const next = [], arg = [];
      for (let j = 0; j < K; j++) {
        let best = Infinity, bi = 0;
        for (let i = 0; i < K; i++) {
          const a = wins[w - 1][i], b = wins[w][j];
          const df = Math.abs(a.fifths - b.fifths);
          const t = i === j ? 0 : change + fifth * Math.min(12 - df, df);
          if (cost[i] + t < best) { best = cost[i] + t; bi = i; }
        }
        next.push(best - wins[w][j].score);
        arg.push(bi);
      }
      back.push(arg);
      cost = next;
    }
    let j = 0;
    for (let i = 1; i < K; i++) if (cost[i] < cost[j]) j = i;
    const path = new Array(wins.length);
    for (let w = wins.length - 1; w >= 0; w--) { path[w] = j; if (w > 0) j = back[w - 1][j]; }
    /* a measure takes the key of the window whose middle is nearest; a key that would last fewer than MIN measures is
       not written */
    const keyOfM = ms.map((_, i) => {
      let best = 0;
      starts.forEach((st, w) => { if (Math.abs(st + KEY_W.WINDOW / 2 - (i + 0.5)) < Math.abs(starts[best] + KEY_W.WINDOW / 2 - (i + 0.5))) best = w; });
      return wins[best][path[best]];
    });
    /* a change between two windows lands on the bar, between their middles, that best splits the bars' own diatonic
       fit between the old key and the new one */
    const fitOf = (i, k) => { const t = hist[i].reduce((x, y) => x + y, 0); return t ? SCALES[k.mode].reduce((x, pc) => x + hist[i][(k.tonic + pc) % 12], 0) / t : 1; };
    for (let w = 1; w < wins.length; w++) {
      const A = wins[w - 1][path[w - 1]], B = wins[w][path[w]];
      if (A.fifths === B.fifths) continue;
      const lo = Math.max(0, Math.floor(starts[w - 1] + KEY_W.WINDOW / 2)), hi = Math.min(n, Math.ceil(starts[w] + KEY_W.WINDOW / 2));
      let bestAt = lo, best = -Infinity;
      for (let b = lo; b <= hi; b++) {
        let v = 0;
        for (let i = lo; i < hi; i++) v += i < b ? fitOf(i, A) : fitOf(i, B);
        if (v > best + 1e-9) { best = v; bestAt = b; }
      }
      for (let i = lo; i < hi; i++) keyOfM[i] = i < bestAt ? A : B;
    }
    for (let i = 1; i < n; i++) {
      if (keyOfM[i].fifths === keyOfM[i - 1].fifths) continue;
      let j2 = i;
      while (j2 < n && keyOfM[j2].fifths === keyOfM[i].fifths) j2++;
      /* a region one fifth from the signature in force (the dominant or subdominant side) keeps that signature: an
         engraver writes a closely related modulation with accidentals (§24 record: sonata expositions given the
         dominant's signature cost G0's key gate three cases on full, A24) */
      const df = Math.abs(keyOfM[i].fifths - keyOfM[i - 1].fifths);
      if (j2 - i < KEY_W.MIN || Math.min(12 - df, df) === 1) for (let x = i; x < j2; x++) keyOfM[x] = keyOfM[i - 1];
    }
    return keyOfM;
  }

  const spell = Object.freeze({
    name: 'spell',
    may: ['spelling', 'acc', 'keys'],
    run(g, ctx) {
      const changes = [];
      const res = O.edit(g, d => {
        g.parts.forEach((gpart, pi) => {
          const part = d.doc.parts[pi];
          /* a transposing part prints written pitches in its written key (G2-D15): its accidentals, spelling and keys
             are the file's, and G3 leaves them (A26) */
          if (gpart.instrument && gpart.instrument.transpose) return;
          if (ctx.opts.regionKeys !== false) regionPass(g, d, gpart, part, ctx, changes);
          /* the line speller is off unless opts.spelling: on core it raises spelling accuracy (0.99682 -> 0.99736, 30
             cases better) but 4 cases (one hymn, every profile) lose 0.005, and A24 allows no case to lose (§24 record) */
          if (ctx.opts.spelling === true) spellPass(g, d, gpart, part, ctx, changes);
          const want = plan(d.doc, part, { courtesy: ctx.opts.courtesy });
          part.events.forEach(e => {
            if (e.kind !== 'note' || ctx.skip.has(e.m)) return;
            const right = ctx.perm.event(part, e, 'display');
            if (right === 'none') return;
            e.heads.forEach(h => {
              if (!want.has(h.id) || microtone(h)) return;
              const acc = want.get(h.id);
              const now = h.acc || null;
              if (right === 'fill') {
                /* an imported head keeps its accidental; a needed one it lacks is added */
                if (now || !acc || acc.cautionary) return;
              }
              const same = (!now && !acc) || (now && acc && now.type === acc.type && !!now.cautionary === !!acc.cautionary);
              if (same) return;
              /* a printed accidental G3 did not decide on (editorial, bracketed) is the input's to keep */
              if (now && (now.editorial || now.bracket || now.paren) && right !== 'rewrite') return;
              d.setAcc(h.id, acc);
              changes.push({ pass: 'spell', kind: 'acc', ids: [h.id], m: e.m });
            });
          });
        });
      }, { validate: false, source: ctx.source });
      return { graph: res.graph, idMap: res.idMap, changes: changes };
    }
  });

  /* Keys by region and the spelling they give, on a piano part G3 may respell (inferred, not transposing: the written
     spelling of a transposing part follows its concert spelling, G2-D15, and G3 leaves it). A key signature is written
     at the bar where each region starts; the notes of every measure whose key changed are spelled from that key
     (the table audio-score itself spells with). */
  function regionPass(g, d, gpart, part, ctx, changes) {
    if (ctx.perm.graph('spelling') !== 'rewrite' || (gpart.instrument && gpart.instrument.transpose)) return;
    if (gpart.events.some(e => e.kind === 'note' && ctx.perm.event(gpart, e, 'spelling') !== 'rewrite')) return;
    if ((g.timeline.keys || []).some(k => k.at !== '0' || k.scope)) return;
    const ms = g.timeline.measures;
    const written = ms.map(m => { const k = T.keyAt(g, { m: m.id, at: '0' }, gpart.id, null); return k ? k.fifths : 0; });
    const keys = regionKeys(g, gpart, written[0]);
    if (!keys) return;
    if (keys.every((k, i) => k.fifths === written[i])) return;
    if (ms.some(m => ctx.skip.has(m.id))) return;
    for (let i = 0; i < ms.length; i++) {
      if (i > 0 && keys[i].fifths === keys[i - 1].fifths) continue;
      if (d.setKey(ms[i].id, keys[i].fifths, keys[i].mode)) changes.push({ pass: 'spell', kind: 'key', ids: [], m: ms[i].id });
    }
    (d.doc.timeline.keys || []).slice().forEach(k => {
      const i = ms.findIndex(m => m.id === k.m);
      if (i > 0 && keys[i].fifths === keys[i - 1].fifths) d.removeKey(k.id);
    });
    const mIdx = new Map(ms.map((m, i) => [m.id, i]));
    const tables = new Map();
    part.events.forEach(e => {
      if (e.kind !== 'note') return;
      const i = mIdx.get(e.m);
      if (keys[i].fifths === written[i]) return;
      const k = keys[i];
      const tk = k.fifths + ':' + k.mode + ':' + k.tonic;
      if (!tables.has(tk)) tables.set(tk, spellingTable(k));
      e.heads.forEach(h => {
        if (!h.pitch || microtone(h)) return;
        const p2 = spellMidi(P.midi(h.pitch), tables.get(tk));
        if (d.setSpelling(h.id, p2)) { d.markProv(h, ['spelling']); changes.push({ pass: 'spell', kind: 'spelling', ids: [h.id], m: e.m }); }
      });
    });
  }

  /* ------------------------------------------------------------ spelling (§10.2) */
  /* The line of fifths: C 0, G 1, D 2 … F -1; a sharp adds 7, a flat takes 7. */
  const LOF = { F: -1, C: 0, G: 1, D: 2, A: 3, E: 4, B: 5 };
  const lof = p => LOF[p.step] + 7 * (p.alter || 0);
  const SP = Object.freeze({ KEY: 1000, AUG: 800, PASSING: 1500, DOUBLE: 2000 });
  /* the spellings of a MIDI number with at most a double accidental */
  function candidates(midi) {
    const out = [];
    LETTERS.forEach(l => {
      for (let alter = -2; alter <= 2; alter++) {
        const pc = (LETTER_PC[l] + alter + 12) % 12;
        if (pc !== midi % 12) continue;
        const oct = Math.floor((midi - alter - LETTER_PC[l]) / 12) - 1;
        out.push(alter ? { step: l, alter: alter, oct: oct } : { step: l, oct: oct });
      }
    });
    return out;
  }
  /* A voice's chromatic notes spelled by a DP along the voice (state: the spelling of the note before). Only a note
     whose pitch class is not in the key moves; the key's own notes are spelled by the key. Cost (×1000): 1 for a
     spelling other than the one the note has (the key's table: G03 §10.2 starts from the distance on the line of fifths,
     which spelled D# of A minor as E flat and lost 19 core cases; §24 record), 0.8 for an augmented or diminished step
     from the note before (8 or more fifths apart, by step), 1.5 for a chromatic passing note by step written against its
     direction (a flat going up, a sharp going down), 2 for a double accidental. A tie keeps the spelling the note has. Returns headId -> pitch for every
     head it would respell. */
  function spellVoice(notes, fifths) {
    const diatonic = new Set(LETTERS.map(l => (LETTER_PC[l] + keyAlters(fifths)[l] + 12) % 12));
    const out = new Map();
    const opts = notes.map((x, i) => {
      if (diatonic.has(x.midi % 12)) return [x.h.pitch];
      const cs = candidates(x.midi);
      /* the spelling it has first, so a tie in cost keeps it */
      cs.sort((a, b) => (sameP(a, x.h.pitch) ? -1 : sameP(b, x.h.pitch) ? 1 : 0));
      void i;
      return cs;
    });
    const local = (p, i) => {
      /* the spelling the note has (the key's table, which knows what a mode leans to) is the start; another one has to
         be earned by the line (an augmented or diminished step it removes, a chromatic step it points the right way) */
      let c = sameP(p, notes[i].h.pitch) ? 0 : SP.KEY;
      if (Math.abs(p.alter || 0) === 2) c += SP.DOUBLE;
      /* a chromatic passing note, by step both sides: raised going up, lowered going down */
      const prev = notes[i - 1], next = notes[i + 1], me = notes[i].midi;
      const stepwise = prev && next && Math.abs(me - prev.midi) <= 2 && Math.abs(next.midi - me) <= 2;
      if (stepwise && prev.midi < me && me < next.midi && (p.alter || 0) < 0 && !diatonic.has(me % 12)) c += SP.PASSING;
      if (stepwise && prev.midi > me && me > next.midi && (p.alter || 0) > 0 && !diatonic.has(me % 12)) c += SP.PASSING;
      return c;
    };
    /* an augmented or diminished step: 8 or more fifths apart (an augmented second, a diminished third; the tritone, 6,
       is a step a key has, and the augmented unison, 7, is the chromatic step itself), and only a step (3 semitones or
       less): around a leap (F5 down to C#5, a diminished
       fourth to a leading note) the harmony decides the spelling, which a line cannot see (§24 record) */
    const step = (a, b, dm) => (dm <= 3 && Math.abs(lof(a) - lof(b)) >= 8 ? SP.AUG : 0);
    let states = opts[0].map(p => ({ cost: local(p, 0), back: -1 }));
    const trail = [states];
    for (let i = 1; i < notes.length; i++) {
      const next = opts[i].map(p => {
        let best = Infinity, bi = 0;
        const dm = Math.abs(notes[i].midi - notes[i - 1].midi);
        opts[i - 1].forEach((q, j) => { const v = states[j].cost + step(q, p, dm); if (v < best) { best = v; bi = j; } });
        return { cost: best + local(p, i), back: bi };
      });
      trail.push(next);
      states = next;
    }
    let j = 0;
    states.forEach((st, k) => { if (st.cost < states[j].cost) j = k; });
    for (let i = notes.length - 1; i >= 0; i--) {
      const p = opts[i][j];
      if (!sameP(p, notes[i].h.pitch)) out.set(notes[i].h.id, p);
      j = trail[i][j].back;
    }
    return out;
  }
  const sameP = (a, b) => a.step === b.step && (a.alter || 0) === (b.alter || 0) && a.oct === b.oct;

  /* The spelling pass over an inferred, non-transposing part: each voice's line (the top head of each chord), the
     tied pieces of a note spelled like its first. */
  function spellPass(g, d, gpart, part, ctx, changes) {
    if (ctx.perm.graph('spelling') !== 'rewrite' || (gpart.instrument && gpart.instrument.transpose)) return;
    const tieIn = new Map();
    part.spanners.forEach(sp => { if (sp.type === 'tie' && sp.from !== undefined && sp.to !== undefined) tieIn.set(sp.to, sp.from); });
    const mStart = new Map();
    let acc = R.ZERO;
    d.doc.timeline.measures.forEach(m => { mStart.set(m.id, acc); acc = R.add(acc, R.parse(m.dur)); });
    const byVoice = new Map();
    part.events.forEach(e => {
      if (e.kind !== 'note' || e.grace || ctx.skip.has(e.m)) return;
      if (ctx.perm.event(gpart, gpart.events.find(x => x.id === e.id) || e, 'spelling') !== 'rewrite') return;
      e.heads.forEach(h => {
        if (!h.pitch || tieIn.has(h.id) || microtone(h)) return;
        if (!byVoice.has(e.voice)) byVoice.set(e.voice, []);
        byVoice.get(e.voice).push({ e: e, h: h, midi: P.midi(h.pitch), w: R.add(mStart.get(e.m), R.parse(e.at)) });
      });
    });
    byVoice.forEach(list => {
      list.sort((a, b) => R.cmp(a.w, b.w) || b.midi - a.midi);
      /* the line: the top head at each onset; the other heads of a chord follow its spelling of their own pitch class */
      const line = [];
      list.forEach(x => { if (!line.length || !R.eq(line[line.length - 1].w, x.w)) line.push(x); });
      const segments = [];
      line.forEach(x => {
        const k = T.keyAt(d.doc, { m: x.e.m, at: '0' }, part.id, null);
        const f = k ? k.fifths : 0;
        const last = segments[segments.length - 1];
        if (last && last.fifths === f) last.notes.push(x); else segments.push({ fifths: f, notes: [x] });
      });
      const want = new Map();
      segments.forEach(sg => spellVoice(sg.notes, sg.fifths).forEach((p2, id) => want.set(id, p2)));
      /* chord heads under a respelled top: the same pitch class takes the same letter */
      const byPc = new Map();
      line.forEach(x => { const p2 = want.get(x.h.id); if (p2) byPc.set(x.e.id + '|' + x.midi % 12, p2); });
      /* the other heads of a chord (§10.2, 0.5 for an augmented or diminished interval in a chord, the diminished
         seventh and augmented sixth chords excepted): a chromatic head that makes such an interval with a head of its
         chord, when its other spelling makes none, takes the other spelling */
      const chords = new Map();
      list.forEach(x => { if (!chords.has(x.e.id)) chords.set(x.e.id, []); chords.get(x.e.id).push(x); });
      chords.forEach(heads => {
        if (heads.length < 2) return;
        const k = T.keyAt(d.doc, { m: heads[0].e.m, at: '0' }, part.id, null);
        const dia = new Set(LETTERS.map(l => (LETTER_PC[l] + keyAlters(k ? k.fifths : 0)[l] + 12) % 12));
        const pcs = heads.map(x => x.midi % 12).sort((a, b) => a - b);
        const iv = pcs.map((pc, i) => (pcs[(i + 1) % pcs.length] - pc + 12) % 12);
        if (pcs.length === 4 && iv.every(x => x === 3)) return;              /* a diminished seventh */
        const spelled = x => want.get(x.h.id) || byPc.get(x.e.id + '|' + x.midi % 12) || x.h.pitch;
        const bad = (p2, x) => heads.some(y => y !== x && Math.abs(lof(p2) - lof(spelled(y))) >= 8 && Math.abs(lof(p2) - lof(spelled(y))) !== 10);
        heads.forEach(x => {
          if (dia.has(x.midi % 12) || want.has(x.h.id)) return;
          const now = spelled(x);
          if (!bad(now, x)) return;
          const alt = candidates(x.midi).find(c => !sameP(c, now) && Math.abs(c.alter || 0) <= 1 && !bad(c, x));
          if (alt) want.set(x.h.id, alt);
        });
      });
      list.forEach(x => {
        const p2 = want.get(x.h.id) || (byPc.has(x.e.id + '|' + x.midi % 12) ? byPc.get(x.e.id + '|' + x.midi % 12) : null);
        if (!p2) return;
        const oct = Math.floor((x.midi - (p2.alter || 0) - LETTER_PC[p2.step]) / 12) - 1;
        const pitch = p2.alter ? { step: p2.step, alter: p2.alter, oct: oct } : { step: p2.step, oct: oct };
        if (d.setSpelling(x.h.id, pitch)) {
          /* the tied pieces follow */
          let cur = x.h.id;
          const tieOut = new Map();
          part.spanners.forEach(sp => { if (sp.type === 'tie' && sp.from !== undefined && sp.to !== undefined) tieOut.set(sp.from, sp.to); });
          let k2 = 0;
          while (tieOut.has(cur) && k2++ < 10000) { cur = tieOut.get(cur); d.setSpelling(cur, pitch); }
          d.markProv(d.head(x.h.id), ['spelling']);
          changes.push({ pass: 'spell', kind: 'spelling', ids: [x.h.id], m: x.e.m });
        }
      });
    });
  }

  return Object.freeze({ spell, plan, keyAlters, keyScores, spellingTable, regionKeys, spellVoice, candidates, KEY_W, SP });
});
