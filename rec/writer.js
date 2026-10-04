/* ============================================================================
   PPP rec/ S7 - the written rhythm of a recording: values, ties, rests and tuplets, per voice, in every metre
   (docs/GOALS/G10_AUDIO_TO_SCORE.md section 8, stages S6-S7; phase G10a-3)

     write(notes, ctx) -> { tracks, tuplets, report }

   The recording conversion v2 decides WHEN each note starts (S3, rec/grid.js: the onsets are on one grid per beat),
   WHICH hand plays it (S4, rec/hands.js) and in WHICH voice of its staff (S5, rec/voices.js). This stage writes it: for
   every voice of every staff, how long each note is written (S6: until the next onset of its voice unless the silence
   before it is a rest - rec/rests.js decides), the pieces that make each note and each silence (exact bars: every
   piece a plain value or a tuplet value, every voice-bar adding up), the ties between pieces and one tuplet bracket per
   tuplet beat. It is the writer audio-score.js used for x/4 bars under opts.exactBars (exactGrid / staffEvents /
   exactPieces, G09 section 12), generalised:
     - every metre the skeleton writes: x/4 and x/2 (a quarter-note grid; rests tiled on the metre's beat: a half in x/2),
       compound metres 3/8, 6/8, 9/8, 12/8 (a dotted-quarter beat: eighths or 16ths; rests and values grouped by the beat);
     - per beat, the grid kind S3 chose: straight 16ths, 32nds, triplet eighths (one 3:2 bracket per beat of a voice) and
       triplet 16ths (kind '6': one 3:2 bracket of 16ths per half beat, the way the catalogue's editions print them);
     - up to two voices per staff, each with its own exact bars;
     - the rest decision as a hook (ctx.decideRests, S6); without it, the fixed rule: a silence shorter than ctx.restMin
       (an eighth) is not a rest, any longer one is.
   Pure and deterministic (no Date, no random, no I/O). UMD: Node require('./rec/writer.js'), page PPPRecWriter (after
   scoregraph/gaps.js, whose standard rest tiling it uses).

   INPUT
     notes  audio-score.js's placed notes: [{midi, tick, endTick, staff (1|2), voice (1|2, default 1), on, off, vel, ...}]
            ticks: 24 a quarter, measured from the first bar line (bar k starts at k * ctx.bar).
     ctx    { bar, bars           ticks in a bar, number of bars
              beatType, beatsPerBar
              compound            a dotted-quarter beat (6/8, 9/8, 12/8, 3/8)
              restMin             ticks: a silence shorter than this is never a rest (default 12, an eighth; G10 U7)
              decideRests         optional (cands, {bar, unit, compound}) -> [boolean]: S6, called once with every silence of
                                  restMin or more between two notes of a voice (cand: {staff, voice, start, end, next, notes,
                                  nextNotes}); true = a rest, false = the note lasts until `next`
              allowBarTies        a symbolic grid's notes keep heard ties over bar lines (default false) }

   OUTPUT
     tracks   [{staff, voice, events: [{start, end, notes}], pieces: [{at, len, kind: 'note'|'rest', notes, type, dots,
               tieIn, tieOut, tup}]}] in staff, voice order; pieces in time order, absolute ticks, none crossing a bar line;
              `tup` is the index of the piece's tuplet in `tuplets` or -1
     tuplets  [{track, pieces: [piece indexes], actual: 3, normal: 2, unit: {type}}]
     report   {version, voices (tracks with notes), rests: {asked, rest, legato}, tuplets: {beat, half}}
   ========================================================================== */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) {
    let gaps = null;
    try { gaps = require('../scoregraph/gaps.js'); } catch (e) { gaps = null; }
    module.exports = factory(gaps);
  } else {
    const M = root.PPPScoreGraphModules || {};
    root.PPPRecWriter = factory(M.gaps || null);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (GAPS) {
  'use strict';

  const VERSION = '0.1.0';
  const Q = 24;
  /* plain written values in ticks (Q = 24 a quarter): [type, dots] */
  const TYPES = {
    144: ['whole', 1], 96: ['whole', 0], 72: ['half', 1], 48: ['half', 0], 36: ['quarter', 1],
    24: ['quarter', 0], 18: ['eighth', 1], 12: ['eighth', 0], 9: ['16th', 1], 6: ['16th', 0], 3: ['32nd', 0]
  };
  /* the legacy table audio-score.js uses for its straight pieces (it keeps 16 / 8 / 4 as triplet values) */
  const LTYPES = {
    96: ['whole', 0], 72: ['half', 1], 48: ['half', 0], 36: ['quarter', 1],
    24: ['quarter', 0], 18: ['eighth', 1], 16: ['quarter', 0], 12: ['eighth', 0],
    9: ['16th', 1], 8: ['eighth', 0], 6: ['16th', 0], 4: ['16th', 0], 3: ['32nd', 0], 2: ['32nd', 0], 1: ['64th', 0]
  };
  const ltuplet = v => v === 8 || v === 16 || v === 4;
  const CHAIN_COST = 13, CHAIN_COST_TRIP = 3;
  const REST_MIN = 12;

  /* ---- the straight pieces of audio-score.js (pieces / notePieces), kept exactly: an x/4 bar is written as before */
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
  function notePieces(pos, len, bar, beat) {
    beat = beat || Q;
    if (len > 0 && pos + len <= bar && LTYPES[len] && !ltuplet(len) &&
        (beat === Q || (len <= beat && LTYPES[len][1]))) return [len];
    return pieces(pos, len, bar, beat);
  }

  /* ---- compound metres: values grouped by the dotted-quarter beat (B = 36 ticks). A note inside one beat is the
     plain value that fits from where it starts (a quarter only from the beat's first or second eighth); a note across
     a beat line is split there unless it starts on a beat and lasts whole beats with a plain value (a dotted quarter,
     a dotted half, a dotted whole). */
  const CB = 36;
  function compoundPieces(pos, len, bar) {
    const out = [];
    while (len > 0) {
      const off = pos % CB;
      let v = 0;
      if (off === 0 && len >= CB) {
        [144, 72, 36].some(x => {
          if (x <= len && pos + x <= bar && TYPES[x] && (x === CB || pos % x === 0 || x === 72 && pos % 72 === 0)) { v = x; return true; }
          return false;
        });
        if (!v) v = CB;
      } else {
        const room = Math.min(len, CB - off);
        v = [24, 18, 12, 9, 6, 3].find(x => x <= room &&
          (x !== 24 || off === 0 || off === 12) &&
          (x !== 18 || off % 18 === 0) &&
          (x !== 12 || off % 12 === 0 || off === 6 && room === 12) &&
          (x !== 9 || off % 3 === 0)) || Math.min(room, 3) || 1;
      }
      out.push(v);
      pos += v; len -= v;
    }
    return out;
  }

  /* ---- the grid of each beat. unit: the grid beat in ticks (24 simple, 36 compound). Kinds: '16' straight 16ths, '32',
     '3' triplet eighths, '6' triplet 16ths, 'c8' / 'c16' / 'c32' compound eighths / 16ths / 32nds. The kind of a beat is read
     from the onsets in it (any staff), as audio-score.js exactGrid did (a third: triplet; an odd 32nd: 32nds), plus triplet
     16ths (an onset on a sixth that is no third): S3 has put every onset on its beat's grid, so the onsets say which. A
     release or a rest boundary may sit on any point of its beat's grid (16ths in a beat with no onset). */
  function gridOf(notes, ctx) {
    const unit = ctx.compound ? CB : Q;
    const kinds = new Map();
    const onsetKinds = new Map();
    notes.forEach(n => {
      const j = Math.floor(n.tick / unit), o = n.tick - j * unit;
      let k = onsetKinds.get(j) || 0;          /* bits: 1 third, 2 odd 32nd, 4 sixth, 8 odd 16th (compound) */
      if (!ctx.compound) {
        if (o === 8 || o === 16) k |= 1;
        else if (o % 6 === 3) k |= 2;
        else if (o === 4 || o === 20) k |= 4;
      } else {
        if (o % 6 === 3) k |= 2;
        else if (o % 12 === 6) k |= 8;
      }
      onsetKinds.set(j, k);
    });
    onsetKinds.forEach((k, j) => {
      if (ctx.compound) kinds.set(j, k & 2 ? 'c32' : k & 8 ? 'c16' : 'c8');
      else kinds.set(j, k & 4 ? '6' : k & 1 ? '3' : k & 2 ? '32' : '16');
    });
    const kindAt = j => kinds.get(j) || (ctx.compound ? 'c8' : '16');
    /* the step of the grid inside beat j: where an onset, a release or a rest boundary may be */
    const stepOf = j => {
      const k = kindAt(j);
      return k === '3' ? 8 : k === '6' ? 4 : k === '32' || k === 'c32' ? 3 : 6;
    };
    const valid = p => {
      const j = Math.floor(p / unit), o = p - j * unit;
      if (!o) return true;
      return o % stepOf(j) === 0;
    };
    const nearest = (p, lo, hi) => {
      for (let d = 0; d <= unit; d++) {
        if (p + d <= hi && p + d >= lo && valid(p + d)) return p + d;
        if (p - d >= lo && p - d <= hi && valid(p - d)) return p - d;
      }
      return null;
    };
    return { unit: unit, kindAt: kindAt, stepOf: stepOf, valid: valid, nearest: nearest, kinds: kinds };
  }

  /* ---- the segments of a span [a, b) inside ONE bar (absolute ticks): straight stretches and tuplet stretches. A
     tuplet stretch lies inside one triplet beat (kind '3': the bracket of the beat) or one half of a triplet-16th beat
     (kind '6': the bracket of the half beat) and is not that whole beat (half beat) from its start: a beat (half beat)
     the span covers wholly is written with plain values. Returns [{from, to, tup: key | null, unit}] */
  function segments(a, b, G, ctx) {
    const out = [];
    let pos = a;
    const pushStraight = (from, to) => {
      const last = out[out.length - 1];
      if (last && last.tup === null && last.to === from) last.to = to;
      else out.push({ from: from, to: to, tup: null });
    };
    while (pos < b) {
      if (ctx.compound) { pushStraight(pos, b); break; }
      const j = Math.floor(pos / Q), bs = j * Q, be = bs + Q, k = G.kindAt(j);
      if (k === '3') {
        if (pos === bs && b >= be) { pushStraight(pos, be); pos = be; continue; }
        const to = Math.min(b, be);
        out.push({ from: pos, to: to, tup: 'B' + j, actual: 3, normal: 2, unit: 'eighth', span: [bs, be] });
        pos = to;
        continue;
      }
      if (k === '6') {
        const h = pos < bs + 12 ? 0 : 1, hs = bs + 12 * h, he = hs + 12;
        if (pos === hs && b >= he) { pushStraight(pos, he); pos = he; continue; }
        const to = Math.min(b, he);
        out.push({ from: pos, to: to, tup: 'H' + j + ':' + h, actual: 3, normal: 2, unit: '16th', span: [hs, he] });
        pos = to;
        continue;
      }
      /* a straight beat: on to the end of the span, or the start of the next tuplet beat it does not cover wholly */
      let to = Math.min(b, be);
      let jj = j + 1;
      while (to < b) {
        const kk = G.kindAt(jj);
        if (kk === '3' || kk === '6') {
          if (b >= (jj + 1) * Q && kk === '3') { to = Math.min(b, (jj + 1) * Q); jj++; continue; }
          if (kk === '6' && b >= (jj + 1) * Q) { to = Math.min(b, (jj + 1) * Q); jj++; continue; }
          break;
        }
        to = Math.min(b, (jj + 1) * Q);
        jj++;
      }
      pushStraight(pos, to);
      pos = to;
    }
    return out;
  }

  /* the rest tiling of a straight silence [a, b) (bar-relative ticks) in a bar of `bar` ticks: scoregraph/gaps.js tile on
     the metre's beat (a quarter in x/4, a half in x/2, a dotted quarter in compound time) */
  function restValues(rel, len, bar, ctx) {
    if (GAPS && GAPS.tile && rel % 3 === 0 && len % 3 === 0) {
      const B = ctx.compound ? 12 : (ctx.beatType === 2 ? 16 : 8);
      return GAPS.tile(rel / 3, (rel + len) / 3, B, !!ctx.compound, bar / 3, false).map(pc => pc.len * 3);
    }
    return ctx.compound ? compoundPieces(rel, len, bar) : pieces(rel, len, bar, Q);
  }

  /* the written pieces of a span [a, b) inside one bar: [{at, len, type, dots, tup, actual, normal, unit}] */
  function spanPieces(a, b, kind, G, ctx) {
    const bar = ctx.bar;
    const barStart = Math.floor(a / bar) * bar;
    const out = [];
    segments(a, b, G, ctx).forEach(sg => {
      const len = sg.to - sg.from;
      if (sg.tup) {
        /* one tuplet value: in a triplet beat a third (an eighth under 3:2) or two thirds (a quarter); in a triplet-16th
           half beat a sixth (a 16th under 3:2) or two sixths (an eighth) */
        const drawn = len * 3 / 2;
        const t = TYPES[drawn] || ['16th', 0];
        out.push({ at: sg.from, len: len, type: t[0], dots: t[1], tup: sg.tup, actual: 3, normal: 2, unit: sg.unit, tupSpan: sg.span });
        return;
      }
      const rel = sg.from - barStart;
      const vals = kind === 'rest' ? restValues(rel, len, bar, ctx)
        : (ctx.compound ? compoundPieces(rel, len, bar) : notePieces(rel, len, bar, Q));
      let at = sg.from;
      vals.forEach(v => {
        const t = TYPES[v] || LTYPES[v] || ['16th', 0];
        out.push({ at: at, len: v, type: t[0], dots: t[1], tup: null });
        at += v;
      });
    });
    return out;
  }

  /* ---- the events of one voice: onsets (a chord = the notes of one tick), each written until its end */
  function voiceEvents(mine, G, ctx, cands, staff, voice) {
    const bar = ctx.bar, last = ctx.bars * bar;
    const restMin = ctx.restMin === undefined ? REST_MIN : ctx.restMin;
    const byTick = new Map();
    const onsets = [];
    mine.forEach(n => {
      if (!byTick.has(n.tick)) { byTick.set(n.tick, []); onsets.push(n.tick); }
      const list = byTick.get(n.tick);
      if (!list.some(x => x.midi === n.midi)) list.push(n);
    });
    onsets.sort((a, b) => a - b);
    const npieces = (t, p) => {
      /* how many pieces the note [t, p) needs (within one bar) */
      return spanPieces(t, p, 'note', G, ctx).length;
    };
    const events = [];
    onsets.forEach((t, i) => {
      const next = i + 1 < onsets.length ? onsets[i + 1] : Infinity;
      const ns = byTick.get(t).sort((a, b) => a.midi - b.midi);
      const ends = ns.map(n => n.endTick).sort((a, b) => a - b);
      let end = ends[Math.floor((ends.length - 1) / 2)];
      if (next !== Infinity && end < next) {
        const span = next - t, gap = next - end;
        if (gap <= Math.max(1, Math.round(span * 0.2)) && t % bar + span <= bar && npieces(t, next) === 1) end = next;
      }
      end = Math.min(end, next);
      const loc = ((t % bar) + bar) % bar, boundary = t + (bar - loc);
      if (!ctx.allowBarTies) end = Math.min(end, boundary);
      const cap = Math.min(next, ctx.allowBarTies ? last : boundary);
      if (end > cap) end = cap;
      if (end >= boundary - 1e-6) {
        if (!G.valid(end)) { const nr = G.nearest(end, t + 1, cap); end = nr === null ? cap : nr; }
      } else {
        const e0 = end, hi = Math.min(next, boundary);
        const k0 = G.kindAt(Math.floor(t / G.unit));
        const inTrip = (k0 === '3' || k0 === '6') && t % G.unit !== 0;
        const pen = inTrip ? CHAIN_COST_TRIP : CHAIN_COST;
        let bestP = null, bestCost = Infinity, bestN = 0;
        for (let p = t + 1; p <= hi; p++) {
          if (!G.valid(p)) continue;
          const np = npieces(t, p), cost = Math.abs(p - e0) + pen * (np - 1);
          if (cost < bestCost - 1e-9 || (Math.abs(cost - bestCost) < 1e-9 && np < bestN)) { bestP = p; bestCost = cost; bestN = np; }
        }
        end = bestP === null ? cap : bestP;
      }
      /* no silence shorter than a 16th, none that starts on an odd 32nd */
      if (end < cap) {
        const j = Math.floor(end / G.unit), k = G.kindAt(j);
        if (k !== '3' && k !== '6' && (end % 6) === 3 && G.valid(end + 3)) end += 3;
        /* nor with a triplet-16th piece (a sixth of a beat is shorter than a 16th): a release on the third sixth of a half
           beat rings to the half beat's end */
        if (k === '6' && (end % 12) === 8) end += 4;
        if (next !== Infinity && end < next && next - end < 6) end = next;
      }
      /* S6: a silence between two notes of the voice is a rest only when it is long enough (restMin) AND, with a
         decider, when the decider says so (decided in one batch for the whole piece, below); otherwise the note lasts
         until the next onset of its voice */
      const ev = { start: t, end: end, notes: ns };
      if (next !== Infinity && end < next) {
        if (next - end < restMin) ev.end = next;
        else if (cands) cands.push({ staff: staff, voice: voice, start: t, end: end, next: next, notes: ns, nextNotes: byTick.get(next), ev: ev });
      }
      events.push(ev);
    });
    return events;
  }

  /* ---- write */
  function write(notes, ctx) {
    ctx = Object.assign({}, ctx);
    const bar = ctx.bar;
    const G = gridOf(notes, ctx);
    const report = { version: VERSION, voices: 0, rests: { asked: 0, rest: 0, legato: 0 }, tuplets: { beat: 0, half: 0 } };
    const keys = [];
    const by = new Map();
    notes.forEach(n => {
      if (n.staff !== 1 && n.staff !== 2) return;
      const v = n.voice === 2 ? 2 : 1;
      const k = n.staff * 10 + v;
      if (!by.has(k)) { by.set(k, []); keys.push(k); }
      by.get(k).push(n);
    });
    /* a staff with no note at all is still written (one voice of rests) */
    [11, 21].forEach(k => { if (!by.has(k)) { by.set(k, []); keys.push(k); } });
    keys.sort((a, b) => a - b);
    const tracks = [], tuplets = [];
    /* the events of every voice; then S6 decides every candidate silence of the piece in one batch (a decider may compare a
       silence with the same place in other bars); a silence that is not a rest is legato: the note lasts to the next onset */
    const cands = ctx.decideRests ? [] : null;
    const evOf = new Map();
    keys.forEach(k => evOf.set(k, voiceEvents(by.get(k), G, ctx, cands, Math.floor(k / 10), k % 10)));
    if (cands && cands.length) {
      const dec = ctx.decideRests(cands, { bar: bar, unit: G.unit, compound: !!ctx.compound });
      cands.forEach((c, i) => {
        report.rests.asked++;
        if (dec[i]) report.rests.rest++;
        else { report.rests.legato++; c.ev.end = c.next; }
      });
    }
    keys.forEach(k => {
      const staff = Math.floor(k / 10), voice = k % 10;
      const events = evOf.get(k);
      const ps = [];
      const tupIndex = new Map();
      const track = tracks.length;
      const add = (p, kind, notesOf, tieIn, tieOut, evStart) => {
        const x = { at: p.at, len: p.len, kind: kind, notes: notesOf, type: p.type, dots: p.dots, tieIn: tieIn, tieOut: tieOut, tup: -1, evStart: evStart };
        if (p.measureRest) x.measureRest = true;
        if (p.tup) {
          if (!tupIndex.has(p.tup)) {
            tupIndex.set(p.tup, tuplets.length);
            tuplets.push({ track: track, pieces: [], actual: p.actual, normal: p.normal, unit: { type: p.unit }, key: p.tup, span: p.tupSpan });
          }
          x.tup = tupIndex.get(p.tup);
          tuplets[x.tup].pieces.push(ps.length);
        }
        ps.push(x);
      };
      /* the bars this voice writes: every bar for the first voice of a staff; for a second voice only the bars where it has a
         note (it is silent - not written - elsewhere: a voice-bar is only checked where the voice writes something) */
      const lastTick0 = ctx.bars * bar;
      const noteBars = new Set();
      events.forEach(ev => { for (let bi = Math.floor(ev.start / bar); bi * bar < Math.min(ev.end, lastTick0); bi++) noteBars.add(bi); });
      const writes = bi => voice === 1 || noteBars.has(bi);
      const restSpan = (a, b) => {
        /* a silence [a, b) of the voice, bar by bar; a whole silent bar is one measure rest */
        let s = a;
        while (s < b) {
          const bi = Math.floor(s / bar), stop = Math.min(b, (bi + 1) * bar);
          if (writes(bi)) {
            if (s === bi * bar && stop === (bi + 1) * bar) {
              const t = LTYPES[bar] || ['whole', 0];
              add({ at: s, len: bar, type: t[0], dots: t[1], tup: null, measureRest: true }, 'rest', null, false, false, s);
            } else spanPieces(s, stop, 'rest', G, ctx).forEach(p => add(p, 'rest', null, false, false, s));
          }
          s = stop;
        }
      };
      let cursor = 0;
      const lastTick = ctx.bars * bar;
      events.forEach(ev => {
        if (ev.start >= lastTick) return;
        if (ev.start > cursor) restSpan(cursor, ev.start);
        const end = Math.min(ev.end, lastTick);
        let s = ev.start;
        const all = [];
        while (s < end) {
          const bi = Math.floor(s / bar), stop = Math.min(end, (bi + 1) * bar);
          spanPieces(s, stop, 'note', G, ctx).forEach(p => all.push(p));
          s = stop;
        }
        all.forEach((p, i) => add(p, 'note', ev.notes, i > 0, i < all.length - 1, ev.start));
        cursor = Math.max(cursor, end);
      });
      if (cursor < lastTick) restSpan(cursor, lastTick);
      /* a whole-bar silence is one measure rest */
      tracks.push({ staff: staff, voice: voice, events: events, pieces: ps });
    });
    /* a tuplet that is one piece filling its whole span is no tuplet (cannot happen: such a span is straight); a tuplet
       group must hold its whole span: every tuplet group's pieces tile it (they do: every piece of a voice inside the span
       belongs to it, notes and rests alike) */
    tuplets.forEach(t => { if (t.unit.type === 'eighth') report.tuplets.beat++; else report.tuplets.half++; });
    report.voices = tracks.filter(t => t.events.length).length;
    return { tracks: tracks, tuplets: tuplets, report: report, grid: G };
  }

  return Object.freeze({ VERSION, write, _: { pieces, notePieces, compoundPieces, segments, spanPieces, gridOf, restValues, TYPES } });
});
