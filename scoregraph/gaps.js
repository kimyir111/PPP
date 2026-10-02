/* ============================================================================
   PPP ScoreGraph - closing sub-sixteenth gaps (docs/GOALS/G09 section 12: G9f, and "Transcription rests at the source")

     closeSmallGaps(graph) -> { graph, changed, stats, issues }

   A transcription's note lengths are what a player did, not what a printed edition writes: the silences between its notes come out as rests of a 32nd, a 64th or
   a triplet 64th (the 90-bar audio piece i10: 102 of 169 gaps between right-hand notes were shorter than a 16th, 323 rests in the graph, 62 of them 32nd and 53 64th). A printed
   edition never writes such a rest between two notes: it lengthens the note before it or leaves the space.

   The rule, per staff (hand) and measure: a GAP is a stretch in which no note of the staff sounds, from the end of the last note before it (a note of the
   same measure must precede it: a gap at the start of a measure, which would need a note of the measure before, is never touched, so no note crosses a
   barline) to the next onset of any note of the staff or to the end of the measure. A gap of more than 0 and less than a 16th (1/16 of a whole note,
   exactly) is closed: every note that ends where the gap starts is lengthened to the end of the gap (never past the next onset of the hand, never past the
   measure), and the rests of the staff that lie wholly inside the gap are removed (a rest that reaches beyond the gap belongs to another voice that is
   silent there, and stays). No note is shortened, no onset or pitch changes. A lengthened note whose new length is a plain written value (a 32nd and a
   64th make a dotted 16th; at most one dot) takes it as its written value; any other keeps the value it was written with (the importer's own convention: a
   written value and an exact length that differ). The other half: a 32nd or 64th rest among the pieces of a LONGER silence that has a note after it (and the pieces at the start of a measure) is not
   drawn either: the rest event is omitted and the silence stays as it was (no note changes, so the sound is untouched). A silence with no note after it at all (the end of the
   staff's last measure with a note) keeps its rests; one at the end of an earlier measure has the next bar's note after it. Sound: a lengthened note rings at most a 16th of a whole note (a quarter of a beat in 4/4) less one grid step longer, and always
   stops where the hand's next note starts (a few tens of milliseconds at a normal tempo, and with the pedal as it was).

   Idempotent: a graph this pass has run on has no gap left, so a second run returns the very same object. Never a throw: a graph the pass does not understand (an edit the
   validator refuses) comes back as it is, with `stats.failed` saying why.

   A second pass, mergeRests (docs/GOALS/G09 section 12, "consecutive rests"), writes ONE silence as one rest (or the standard tiling): two rests of one voice that follow each other with no note
   between them (a dotted 16th rest and a 16th rest in a row; a dotted 16th rest between two 16ths) are merged and written again with the values a printed edition uses on the beat grid (see
   mergeRests below). A third pass, fillRunRests ("run rests", docs/GOALS/G09 section 12: the teacher's decision for a recording, first the left hand, then the right hand too), is for a lone 16th rest between two
   notes of a run: it is deleted and the note before it lengthened by that 16th when the result is a plain written value (16th -> eighth, dotted eighth -> quarter; see fillRunRests below). tidyRests = closeSmallGaps, then mergeRests, then fillRunRests, to a fixed point.

   Used by repair/index.js (G9f: the last step of a one-note-per-hand arrangement of a transcription) and by audio-score.js (the recording-to-score path, so the review screen, the saved
   transcription song and every arranger's input are clean at the source). Node and browser (a <script> after scoregraph/ops.js and rational.js).
   ========================================================================== */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./ops.js'), require('./rational.js'));
  else { const M = root.PPPScoreGraphModules = root.PPPScoreGraphModules || {}; M.gaps = factory(M.ops, M.rational); }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (OPS, R) {
  'use strict';

  const GAP_LIMIT = R.make(1, 16);
  const SIXTEENTH_OR_LONGER = new Set(['whole', 'half', 'quarter', 'eighth', '16th']);
  const GAP_SOURCE = Object.freeze({ kind: 'repair', tool: 'ppp.g9f-gaps', version: '1.0.0' });

  function plainValue(dur) {
    const names = ['whole', 'half', 'quarter', 'eighth', '16th', '32nd', '64th'];
    for (let i = 0; i < names.length; i++) {
      for (let dots = 0; dots <= 1; dots++) { /* one dot at most: a double-dotted note is not what a gap's closing should write */
        const v = R.mul(R.make(1, Math.pow(2, i)), R.make(Math.pow(2, dots + 1) - 1, Math.pow(2, dots)));
        if (R.eq(v, dur)) return dots ? { type: names[i], dots: dots } : { type: names[i] };
      }
    }
    return null;
  }

  /* the gaps to close in a graph: [{part, staff, m, a, b, notes: [event], rests: [event]}] (rationals a, b: measure-relative, whole notes) */
  function smallGaps(g, kept) {
    const out = [];
    g.parts.forEach(part => {
      const byKey = new Map();
      part.events.forEach(e => {
        if ((e.kind !== 'note' && e.kind !== 'rest') || e.grace || !e.staff) return;
        const k = e.staff + '|' + e.m;
        if (!byKey.has(k)) byKey.set(k, { staff: e.staff, m: e.m, notes: [], rests: [] });
        byKey.get(k)[e.kind === 'note' ? 'notes' : 'rests'].push(e);
      });
      const mDur = new Map(g.timeline.measures.map(m => [m.id, R.parse(m.dur)]));
      /* the last measure (by position) in which each staff has a note: a silence at the end of an earlier measure has a note after it (in a later bar) */
      const mIndex = new Map(g.timeline.measures.map((m, i) => [m.id, i]));
      const lastNoted = new Map();
      byKey.forEach(grp => { if (grp.notes.length) lastNoted.set(grp.staff, Math.max(lastNoted.has(grp.staff) ? lastNoted.get(grp.staff) : -1, mIndex.get(grp.m))); });
      byKey.forEach(grp => {
        if (!grp.notes.length || !mDur.has(grp.m)) return;
        const spans = grp.notes.map(e => { const on = R.parse(e.at); return { e: e, on: on, off: R.add(on, R.parse(e.dur)) }; });
        spans.sort((x, y) => R.cmp(x.on, y.on));
        /* `hasPrev`: a note of this measure ends where the gap starts; `bounded`: a note of this staff starts where it ends */
        const consider = (a, b, hasPrev, bounded) => {
          const len = R.sub(b, a);
          if (!(R.sign(len) > 0)) return;
          const inside = grp.rests.filter(r => { const on = R.parse(r.at); return R.ge(on, a) && R.le(R.add(on, R.parse(r.dur)), b); });
          if (hasPrev && R.lt(len, GAP_LIMIT)) {
            const ending = spans.filter(s => R.eq(s.off, a)).map(s => s.e);
            /* a lengthened note must not run into another event of ITS OWN voice (a rest of that voice that reaches past the gap, or a note of it): then this gap is left as it is */
            const gone = new Set(inside.map(r => r.id));
            const clash = ending.some(n => grp.rests.concat(grp.notes).some(o => o !== n && o.voice === n.voice && !gone.has(o.id) && R.lt(R.parse(o.at), b) && R.gt(R.add(R.parse(o.at), R.parse(o.dur)), a)));
            if (clash) { kept.skipped++; return; }
            out.push({ part: part, staff: grp.staff, m: grp.m, a: a, b: b, notes: ending, rests: inside });
            return;
          }
          /* a silence of a 16th or more (or at the start of the measure), with a note after it: the 32nd and 64th rests among the pieces that tile it are not drawn (the silence stays, in the
             sound too: no note changes). A silence with no note after it (the end of the measure) keeps its rests. */
          if (bounded) {
            const omit = inside.filter(r => r.display && !SIXTEENTH_OR_LONGER.has(r.display.type));
            if (omit.length) out.push({ part: part, staff: grp.staff, m: grp.m, a: a, b: b, notes: [], rests: omit, omitOnly: true });
          }
        };
        if (R.sign(spans[0].on) > 0) consider(R.ZERO, spans[0].on, false, true);
        let cur = spans[0].off;
        for (let i = 1; i < spans.length; i++) {
          if (R.gt(spans[i].on, cur)) consider(cur, spans[i].on, true, true);
          if (R.gt(spans[i].off, cur)) cur = spans[i].off;
        }
        if (R.lt(cur, mDur.get(grp.m))) consider(cur, mDur.get(grp.m), true, mIndex.get(grp.m) < lastNoted.get(grp.staff));
      });
    });
    return out;
  }

  /* is this graph a transcription (a recording's heard notes turned into a score by audio-score.js)? */
  function isTranscription(g) { return !!(g && g.provenance && (g.provenance.sources || []).some(x => x.kind === 'audio-score')); }

  function closeSmallGaps(g) {
    try { return closeSmallGapsUnsafe(g); } catch (e) { /* never a throw (a graph this pass does not understand is returned as it is) */ return { graph: g, changed: false, stats: { gaps: 0, notesLengthened: 0, restsRemoved: 0, rewritten: 0, longest: '0', omitted: 0, skipped: 0, failed: String(e && e.message || e).slice(0, 120) } }; }
  }
  function closeSmallGapsUnsafe(g) {
    const stats = { gaps: 0, notesLengthened: 0, restsRemoved: 0, rewritten: 0, longest: '0', omitted: 0, skipped: 0 };
    const gaps = smallGaps(g, stats);
    if (!gaps.length) return { graph: g, changed: false, stats: stats };
    const res = OPS.edit(g, d => {
      const gone = [];
      gaps.forEach(gp => {
        const add = R.sub(gp.b, gp.a);
        gp.notes.forEach(n => {
          const e = d.event(n.id);
          const nd = R.add(R.parse(e.dur), add);
          e.dur = R.format(nd);
          const disp = plainValue(nd);
          if (disp) { e.display = Object.assign({}, e.display || {}, { type: disp.type }); if (disp.dots) e.display.dots = disp.dots; else delete e.display.dots; stats.rewritten++; }
          d.markProv(e, ['rhythm'], 'repaired');
          stats.notesLengthened++;
        });
        gp.rests.forEach(r => gone.push(r.id));
        if (gp.omitOnly) { stats.omitted += gp.rests.length; return; }
        stats.gaps++;
        if (R.gt(add, R.parse(stats.longest))) stats.longest = R.format(add);
      });
      stats.restsRemoved = gone.length;
      d.removeEvents(gone);
      d.touch();
    }, { source: GAP_SOURCE });
    return { graph: res.graph, changed: true, stats: stats, issues: res.issues };
  }

  /* ---------------------------------------------------------------- consecutive rests (docs/GOALS/G09 section 12, "consecutive rests")

       mergeRests(graph) -> { graph, changed, stats, issues }

     A silence of one voice is written by audio-score.js (and by the arrangement that copies it) one piece at a time, so one stretch of silence comes out as two rests in a row (the user's
     bar: a dotted 16th rest and a 16th rest, one after the other, before a quarter note; a dotted 16th rest inside a beamed 16th group). A printed edition writes ONE rest for a
     silence, or the standard tiling of it on the beat grid. Per voice and measure, a RUN is rests that follow each other with no event of the voice between them (a rest that is the whole
     measure alone is not touched; neither is a rest a beam, tuplet or direction refers to). The run's silence [a, b) is written again:

     1. a and b both on the 32nd grid (a multiple of 1/32 of a whole note): the standard tiling, the one with the fewest pieces (then the fewest dots, then the longer value first), each piece a
        value that (a) fits in what is left, (b) starts on a multiple of its own length (an eighth rest at the half beat, a quarter rest on a beat, a half rest on beats 1 and 3 of 4/4), (c) does not cross a beat line unless it starts on a beat
        (a dotted eighth rest may also END on a beat: a 16th note, then a dotted eighth rest that fills the beat). The values are whole, dotted half, half, dotted quarter, quarter, dotted
        eighth, eighth, 16th and 32nd; NO dotted rest shorter than a dotted eighth (a dotted 16th rest is a 16th and a 32nd). In a compound metre (6/8, 9/8, 12/8) a value stays inside one
        beat (the dotted quarter) unless it is a whole number of beats and starts on one. In 4/4 nothing that starts after beat 1 crosses the middle of the bar (beats 2-4 are a quarter and a
        half rest). A 32nd piece that this leaves at the start or the end of the silence is not written when a note of
        the hand follows (the sound is untouched: no note changes; the rule closeSmallGaps already applies to the pieces it finds); at the end of the hand's last measure with a note it is
        kept. Only a remainder shorter than a 16th is ever a hole: a silence of a 16th or more always keeps a rest (a 16th that starts on an odd 32nd is one plain 16th rest; across a beat line it
        stays the two 32nd rests). A silence that is the whole measure in several pieces becomes one measure rest.
     2. a or b off the 32nd grid (a triplet position at one end, a straight one at the other: the quantiser's mixed grids; no standard tiling exists): ONE rest from the start of the silence,
        written as the longest plain value (at most one dot; a 16th or longer, no dotted value shorter than a dotted eighth) that is not longer than the silence, when the silence is less than
        a 16th longer than that value (what is left is not written, like the 32nd piece above: a hole, an I-VOICE-GAP info; the rest event is exactly the value it shows) and no beat line lies
        inside it unless it starts on a beat; a half rest only on beat 1 or 3 of 4/4, nothing from after beat 1 across its middle (a lone dotted 16th rest on a triplet position is a 16th rest too). Anything else is a tuplet silence and stays as it is (only triplet pieces; a quarter rest and a triplet eighth rest: 4/3 of a beat), except that
        the pieces at its start that end on the 32nd grid (a dotted 16th rest before a triplet rest) are a silence of their own, written by rule 1.

     Never a note, a pitch, an onset or a note length: only rest events change (a rest keeps its id when the new tiling has a piece for it; the others are removed or added). Gated like
     closeSmallGaps (its callers: a recording, repair/index.js's transcription gate). Idempotent: it runs to a fixed point (a silence written once can leave a neighbour that is now a run of its
     own), so a second run returns the very same object; tidyRests runs the closing and the merging to a fixed point together. Never a throw: a graph the pass does not understand comes back as it is, with `stats.failed` saying why. */
  const RESTS_SOURCE = Object.freeze({ kind: 'repair', tool: 'ppp.consecutive-rests', version: '1.0.0' });
  const TICKS = 96;                      /* a whole note is 96 ticks: audio-score's grid (a 32nd = 3 ticks, a triplet 16th = 4) */
  const U32 = 3;                         /* ticks in a 32nd */
  /* rest values in 32nd units, longest first: [units, type, dots] */
  const REST_VALUES = Object.freeze([[32, 'whole', 0], [24, 'half', 1], [16, 'half', 0], [12, 'quarter', 1], [8, 'quarter', 0], [6, 'eighth', 1], [4, 'eighth', 0], [2, '16th', 0], [1, '32nd', 0]]);

  function ticksOf(r) { const x = r.n * TICKS / r.d; return Number.isInteger(x) ? x : null; }
  function wholes(t) { return R.format(R.make(t, TICKS)); }

  /* the beat of a measure in 32nd units: simple metres one beat value, compound (6/8, 9/8, 12/8: three eighths) a dotted beat; additive and unusual metres: null (left alone) */
  function beatUnits(meter) {
    if (!meter || !Array.isArray(meter.beats) || meter.beats.length !== 1 || !Number.isInteger(meter.beatType)) return null;
    if (Array.isArray(meter.groups) && meter.groups.length) return null;
    const n = meter.beats[0], bt = meter.beatType;
    const compound = bt >= 8 && n % 3 === 0;
    if (bt >= 8 && !compound && n > 4) return null;                        /* 5/8, 7/8: additive */
    const u = 32 / bt * (compound ? 3 : 1);
    return Number.isInteger(u) && u >= 2 ? { B: u, compound: compound } : null;
  }

  /* the standard tiling of [a, b) (32nd units, measure-relative) in a measure of `len` units whose beat is B: [{at, len, type, dots}] */
  function tile(a, b, B, compound, len, wholeMeasure) {
    if (wholeMeasure) { const full = REST_VALUES.find(v => v[0] === len); return [{ at: a, len: len, type: full ? full[1] : 'whole', dots: full ? full[2] : 0, measureRest: true }]; }
    const out = [];
    let pos = a;
    const four = !compound && len === 4 * B;
    const allowed = (v, p) => {
      const units = v[0], onBeat = p % B === 0;
      if (four && p > 0 && p < 2 * B && p + units > 2 * B) return false;    /* in 4/4 a rest that starts after beat 1 does not cross the middle of the bar (beats 2-4: a quarter and a half rest) */
      if (v[2] > 0) {
        if (units < 6) return false;
        if (onBeat) return !compound || units % B === 0 || units === 6;
        return units === 6 && (p + 6) % B === 0 && p % 2 === 0;           /* a dotted eighth rest that fills the rest of the beat */
      }
      if (units === 32) return p === 0 && units === len;
      if (compound) return units <= 8 && p % units === 0 && (p % B) + units <= B;
      if (p % units !== 0) return false;
      return onBeat || (p % B) + units <= B;
    };
    /* the tiling with the fewest pieces (then the fewest dots, then the longer value first): two quarter rests, not a dotted quarter and an eighth, for beats 2 and 3 */
    const memo = new Map();
    const best = p => {
      if (p >= b) return { cost: 0, v: null };
      if (memo.has(p)) return memo.get(p);
      let res = null;
      REST_VALUES.forEach(v => {
        if (p + v[0] > b || p + v[0] > len || !allowed(v, p)) return;
        const c = 1000 + v[2] * 10 + best(p + v[0]).cost;
        if (!res || c < res.cost) res = { cost: c, v: v };
      });
      if (!res) res = { cost: 1e6, v: REST_VALUES[REST_VALUES.length - 1] };     /* never: a 32nd is always allowed */
      memo.set(p, res);
      return res;
    };
    while (pos < b) {
      const v = best(pos).v;
      out.push({ at: pos, len: v[0], type: v[1], dots: v[2] });
      pos += v[0];
    }
    return out;
  }

  /* the plain value that stands for a silence of `t` ticks that is not on the 32nd grid: the longest value (a 16th or longer, a dotted one a dotted eighth or longer) not longer than it, if
     the silence is less than a 16th longer than that value; else null */
  function plainFor(t, a, Bt, mt, compound) {
    for (let i = 1; i < REST_VALUES.length - 1; i++) {
      const v = REST_VALUES[i], vt = v[0] * U32;
      if (vt > t) continue;
      if (compound ? (v[2] === 0 && v[0] > 8) : (v[2] === 0 && v[0] >= 16 && a % (2 * Bt) !== 0)) continue;      /* a half rest only on beat 1 or 3 of 4/4 */
      if (!compound && mt === 4 * Bt && a > 0 && a < 2 * Bt && a + vt > 2 * Bt) continue;                         /* nothing that starts after beat 1 crosses the middle of 4/4 */
      return t - vt < 2 * U32 ? v : null;
    }
    return null;
  }

  /* the runs whose silence is not written the way mergeRests writes it: [{part, m, voice, staff, run: [rest events], pieces: [{at, len, type, dots, measureRest}]}] (ticks) */
  function restRuns(g, stats) {
    const out = [];
    const mIndex = new Map(g.timeline.measures.map((m, i) => [m.id, i]));
    const meterOf = [];
    const byM = new Map((g.timeline.meters || []).map(x => [x.m, x]));
    let cur = null;
    g.timeline.measures.forEach((m, i) => { if (byM.has(m.id)) cur = byM.get(m.id); meterOf[i] = cur; });
    g.parts.forEach(part => {
      const used = new Set();
      part.spanners.forEach(s => { (s.events || []).forEach(id => used.add(id)); [s.from, s.to].forEach(x => { if (typeof x === 'string') used.add(x); }); });
      part.directions.forEach(d => { if (d.event !== undefined) used.add(d.event); });
      const lastNoted = new Map(), noteOn = new Map();
      part.events.forEach(e => {
        if (e.kind !== 'note' || e.grace) return;
        const i = mIndex.get(e.m);
        if (i === undefined) return;
        if (!lastNoted.has(e.staff) || lastNoted.get(e.staff) < i) lastNoted.set(e.staff, i);
        const k = e.staff + '|' + e.m;
        if (!noteOn.has(k)) noteOn.set(k, []);
        noteOn.get(k).push(ticksOf(R.parse(e.at)));
      });
      const by = new Map();
      part.events.forEach(e => {
        if (e.kind !== 'rest' || e.grace || !e.staff) return;
        const k = e.voice + '|' + e.m;
        if (!by.has(k)) by.set(k, []);
        by.get(k).push(e);
      });
      by.forEach(list => {
        list.sort((x, y) => R.cmp(R.parse(x.at), R.parse(y.at)));
        const mi = mIndex.get(list[0].m);
        if (mi === undefined) return;
        const meter = meterOf[mi], bu = beatUnits(meter);
        const mt = ticksOf(R.parse(g.timeline.measures[mi].dur));
        const nomT = meter && meter.beats ? ticksOf(R.make(meter.beats.reduce((s, x) => s + x, 0), meter.beatType)) : null;
        if (!bu || mt === null || mt % U32 !== 0 || mt !== nomT) { stats.skipped++; return; }   /* a pickup or short measure, an additive metre, a measure off the grid */
        let run = [];
        /* the standard tiling of [a, b) (ticks, both on the 32nd grid), a 32nd left at either end not written when a note follows; a silence of a 16th or more always keeps a rest: one 16th rest from its start */
        const straight = (a, b, wholeMeasure, bounded) => {
          let pieces = tile(a / U32, b / U32, bu.B, bu.compound, mt / U32, wholeMeasure).map(p => ({ at: p.at * U32, len: p.len * U32, type: p.type, dots: p.dots, measureRest: p.measureRest }));
          if (bounded && !wholeMeasure) {
            pieces = pieces.filter(p => !(p.len === U32 && p.type === '32nd'));
            if (!pieces.length && b - a >= 2 * U32) {
              /* a 16th that starts on an odd 32nd: one plain 16th rest (nothing may vanish: only a remainder shorter than a 16th is a hole); across a beat line it is the two 32nd rests it was */
              const Bt = bu.B * U32;
              pieces = Math.floor(a / Bt) === Math.floor((a + 2 * U32 - 1) / Bt) ? [{ at: a, len: 2 * U32, type: '16th', dots: 0 }]
                : tile(a / U32, b / U32, bu.B, bu.compound, mt / U32, false).map(p => ({ at: p.at * U32, len: p.len * U32, type: p.type, dots: p.dots }));
            }
          }
          return pieces;
        };
        const handle = r0 => {
          const last = r0[r0.length - 1];
          const a = ticksOf(R.parse(r0[0].at)), b = ticksOf(R.add(R.parse(last.at), R.parse(last.dur)));
          if (a === null || b === null) { stats.skipped++; return; }
          if (r0.some(r => !r.display || !r.display.type || r.display.measureRest || used.has(r.id) || r.hidden || r.fermata || r.lyrics || r.arts || r.orn)) return;
          const wholeMeasure = a === 0 && b === mt;
          if (wholeMeasure && r0.length === 1) return;                       /* a measure rest is what it is */
          const bounded = (noteOn.get(last.staff + '|' + last.m) || []).some(on => on !== null && on >= b) || mi < (lastNoted.has(last.staff) ? lastNoted.get(last.staff) : -1);
          let pieces;
          if (a % U32 === 0 && b % U32 === 0) {
            pieces = straight(a, b, wholeMeasure, bounded);
          } else {
            /* mixed grids: one rest of the exact length, or a tuplet silence that stays */
            const B = bu.B * U32, v = plainFor(b - a, a, B, mt, bu.compound);
            const hasStraight = r0.some(r => { const t = ticksOf(R.parse(r.dur)); return t !== null && t % U32 === 0; })
              || (a % U32 === 0 && r0.slice(0, -1).some(r => { const e = ticksOf(R.add(R.parse(r.at), R.parse(r.dur))); return e !== null && e % U32 === 0; }));   /* a piece on the 32nd grid, or pieces that end on it: not only triplet pieces */
            /* a lone dotted 16th rest (a dotted rest shorter than a dotted eighth) that starts on a triplet position is a plain 16th rest too */
            const loneSmallDotted = r0.length === 1 && r0[0].display.dots > 0 && b - a < 6 * U32;
            if (((r0.length >= 2 && hasStraight) || loneSmallDotted) && v && (a % B === 0 || Math.floor(a / B) === Math.floor((b - 1) / B)))
              /* the rest is the plain value from the start of the silence; what is left (less than a 16th) is a hole. From a point on the 32nd grid it is written by rule 1 (so a second run finds it as it is) */
              pieces = a % U32 === 0 ? straight(a, a + v[0] * U32, false, bounded) : [{ at: a, len: v[0] * U32, type: v[1], dots: v[2] }];
            else {
              /* no single rest: the pieces that end on the 32nd grid (a dotted 16th rest before a triplet rest) are a silence of their own, and what follows them is a run of its own (it starts on the 32nd grid: it may be one rest) */
              if (a % U32 === 0) for (let i = r0.length - 2; i >= 0; i--) { const e = ticksOf(R.add(R.parse(r0[i].at), R.parse(r0[i].dur))); if (e !== null && e % U32 === 0) { handle(r0.slice(0, i + 1)); handle(r0.slice(i + 1)); return; } }
              return;
            }
          }
          const same = pieces.length === r0.length && pieces.every((p, i) => {
            const r = r0[i], d = r.display;
            return ticksOf(R.parse(r.at)) === p.at && ticksOf(R.parse(r.dur)) === p.len && d.type === p.type && (d.dots || 0) === p.dots && !!d.measureRest === !!p.measureRest;
          });
          if (same) return;
          out.push({ part: part, m: last.m, voice: last.voice, staff: last.staff, run: r0, pieces: pieces });
        };
        const flush = () => { if (run.length) { const r0 = run; run = []; handle(r0); } };
        list.forEach(r => {
          const prev = run[run.length - 1];
          if (prev && !R.eq(R.add(R.parse(prev.at), R.parse(prev.dur)), R.parse(r.at))) flush();
          run.push(r);
        });
        flush();
      });
    });
    return out;
  }

  function mergeRests(g) {
    /* to a fixed point: a silence written once can leave a neighbour that is now a run of its own (a piece before a triplet rest, a hole), so the pass runs again until it changes nothing (a few
       times at most: each run replaces rests by fewer or standard ones; the cap is a guard). */
    try {
      let cur = g, changed = false, issues;
      const stats = { runs: 0, restsBefore: 0, restsAfter: 0, skipped: 0 };
      for (let i = 0; i < 5; i++) {
        const r = mergeRestsUnsafe(cur);
        stats.skipped = r.stats.skipped;
        if (!r.changed) break;
        stats.runs += r.stats.runs; stats.restsBefore += r.stats.restsBefore; stats.restsAfter += r.stats.restsAfter;
        changed = true; cur = r.graph; issues = r.issues;
      }
      return changed ? { graph: cur, changed: true, stats: stats, issues: issues } : { graph: g, changed: false, stats: stats };
    } catch (e) { /* never a throw (a graph this pass does not understand is returned as it is) */ return { graph: g, changed: false, stats: { runs: 0, restsBefore: 0, restsAfter: 0, skipped: 0, failed: String(e && e.message || e).slice(0, 120) } }; }
  }
  function mergeRestsUnsafe(g) {
    const stats = { runs: 0, restsBefore: 0, restsAfter: 0, skipped: 0 };
    const runs = restRuns(g, stats);
    if (!runs.length) return { graph: g, changed: false, stats: stats };
    const res = OPS.edit(g, d => {
      const gone = [];
      runs.forEach(rn => {
        stats.runs++;
        stats.restsBefore += rn.run.length;
        stats.restsAfter += rn.pieces.length;
        const part = d.doc.parts.find(x => x.id === rn.part.id);
        rn.pieces.forEach((p, i) => {
          const display = { type: p.type };
          if (p.dots) display.dots = p.dots;
          if (p.measureRest) display.measureRest = true;
          let e;
          if (i < rn.run.length) {
            e = d.event(rn.run[i].id);
            /* the other fields of the printed shape stay (only the value, its dots and the measure-rest mark are written) */
            const keep = Object.assign({}, e.display);
            delete keep.dots; delete keep.measureRest;
            e.at = wholes(p.at); e.dur = wholes(p.len); e.display = Object.assign(keep, display);
          } else {
            const x = { kind: 'rest', m: rn.m, at: wholes(p.at), dur: wholes(p.len), voice: rn.voice, staff: rn.staff, display: display };
            if (rn.run[0].prov) x.prov = JSON.parse(JSON.stringify(rn.run[0].prov));
            e = d.event(d.addEvent(part, x));
          }
          d.markProv(e, ['rhythm'], 'repaired');
        });
        for (let i = rn.pieces.length; i < rn.run.length; i++) gone.push(rn.run[i].id);
      });
      d.removeEvents(gone);
      d.touch();
    }, { source: RESTS_SOURCE });
    return { graph: res.graph, changed: true, stats: stats, issues: res.issues };
  }

  /* ---------------------------------------------------------------- run rests (docs/GOALS/G09 section 12, "Left-hand run rests" and "Right-hand run rests")

       fillRunRests(graph) -> { graph, changed, stats, issues }

     A recording is a run of short notes (a left-hand arpeggio, a right-hand figure of 16ths) with a note missed here and there (the player's hand did not sound it, or the model dropped it), and what is left
     is a LONE 16th rest wedged between two notes; drawn, it looks like a broken pattern. The teacher's decision (explicit; first for the left hand, then for the right hand of the same piece, bar 11 of their
     copy: `dotted eighth, 16th rest, 16th, 16th rest, 16th, 16th`): "delete the rest and extend the previous note". ONE rule for every staff (both hands): a rest is removed and the note before it lengthened
     by that 16th when ALL of these hold:
       - the rest is exactly one 16th (a plain 16th: 1/16 of a whole note, not dotted, not in a tuplet), not a measure rest, not hidden, and nothing but a beam refers to it;
       - ONE note or chord ends exactly where the rest starts, in the same measure, staff and voice: not a grace note, no head of it tied to or from anything, not in a tuplet, nothing else (a
         spanner, a direction) refers to it, and it is drawn as what it lasts (a written value, one dot at most, that is its exact length: the page's own "every bar adds up");
       - the LENGTHENED note (its length plus 1/16) is again a plain written value (undotted or single-dotted): 16th -> eighth, eighth -> dotted eighth, dotted eighth -> quarter, 32nd -> dotted 16th. A length
         that has no plain value (a quarter plus a 16th is 5/16) keeps its rest; so does a note in a beam that would become a quarter or longer (a beam holds no quarter note);
       - a note of the same staff and voice STARTS exactly where the rest ends (a lone rest between two notes; when the rest ends the bar, the first note of the next bar). A rest with no note after it (the
         hand's last bar, or the next bar opens with a rest) keeps it;
       - nothing else of the voice lies in the rest's span, and no other note of the staff (another voice) starts inside it: the lengthened note never rings past the next onset of the hand.
     Every other rest (an eighth or longer: they are musical; a 32nd, a dotted 16th) is never touched. The note keeps its onset and pitch; its length and its written value become the lengthened plain value, so it
     rings exactly 1/16 of a whole note longer (a quarter of a beat in 4/4) and stops where the next note of the hand starts, as the silence did (the pedal is as it was; a note never crosses a barline). A beam
     over the run keeps its notes (the rest leaves it); the edit validates the graph. Idempotent (the result has no such rest: a second run returns the very same object), a fixed point with closeSmallGaps and
     mergeRests (tidyRests loops), never a throw (a graph the pass does not understand comes back as it is, with `stats.failed`). Gated like the others (a recording's callers); in audio-score.js it runs after the
     exact bars and the tuplets are written, and the lengthened note's written value is its exact length, so the bars still add up. */
  const FILL_SOURCE = Object.freeze({ kind: 'repair', tool: 'ppp.run-rests', version: '1.0.0' });
  const SIXTEENTH = R.make(1, 16);
  const BEAMED_TYPES = new Set(['eighth', '16th', '32nd', '64th']);

  /* the fills to make: [{part, rest: event, note: event, value: {type, dots?}}] */
  function runRestFills(g, stats) {
    const out = [];
    const mIndex = new Map(g.timeline.measures.map((m, i) => [m.id, i]));
    const mDur = new Map(g.timeline.measures.map(m => [m.id, R.parse(m.dur)]));
    g.parts.forEach(part => {
      /* what a spanner or a direction refers to: a tuplet (events), a tie (heads), a beam (events), anything else (events, from, to) */
      const tupleted = new Set(), tied = new Set(), referred = new Set(), beamed = new Set();
      part.spanners.forEach(s => {
        if (s.type === 'tuplet') (s.events || []).forEach(id => tupleted.add(id));
        else if (s.type === 'tie') { if (s.from !== undefined) tied.add(s.from); if (s.to !== undefined) tied.add(s.to); }
        else if (s.type === 'beam') (s.events || []).forEach(id => beamed.add(id));
        else { (s.events || []).forEach(id => referred.add(id)); [s.from, s.to].forEach(x => { if (typeof x === 'string') referred.add(x); }); }
      });
      part.directions.forEach(d => { if (d.event !== undefined) referred.add(d.event); });
      const byKey = new Map();                                    /* staff|measure -> the events of the staff in the measure (grace notes left out) */
      part.events.forEach(e => {
        if ((e.kind !== 'note' && e.kind !== 'rest') || e.grace) return;
        const k = e.staff + '|' + e.m;
        if (!byKey.has(k)) byKey.set(k, []);
        byKey.get(k).push(e);
      });
      const plain16 = e => e.display && e.display.type === '16th' && !e.display.dots && R.eq(R.parse(e.dur), SIXTEENTH) && !tupleted.has(e.id);
      /* a note drawn as what it lasts: its written value (one dot at most) is its exact length, outside a tuplet */
      const drawnAsLasts = e => {
        if (!e.display || tupleted.has(e.id)) return false;
        const v = plainValue(R.parse(e.dur));
        return !!v && v.type === e.display.type && (v.dots || 0) === (e.display.dots || 0);
      };
      byKey.forEach(evs => {
        evs.forEach(r => {
          if (r.kind !== 'rest' || !plain16(r) || r.display.measureRest || r.hidden || r.fermata || r.lyrics || r.arts || r.orn || referred.has(r.id)) return;
          const mi = mIndex.get(r.m);
          if (mi === undefined) return;
          const on = R.parse(r.at), off = R.add(on, SIXTEENTH);
          if (R.gt(off, mDur.get(r.m))) return;
          const before = evs.filter(e => e.kind === 'note' && e.voice === r.voice && R.eq(R.add(R.parse(e.at), R.parse(e.dur)), on));
          if (before.length !== 1) { stats.skipped++; return; }
          const p = before[0];
          if (!drawnAsLasts(p) || !(p.heads || []).length || p.heads.some(h => tied.has(h.id)) || referred.has(p.id)) { stats.skipped++; return; }
          const value = plainValue(R.add(R.parse(p.dur), SIXTEENTH));
          if (!value || (beamed.has(p.id) && !BEAMED_TYPES.has(value.type))) { stats.skipped++; return; }
          /* the note after: in the measure at the rest's end, or (the rest ends the bar) the first note of the voice in the next bar */
          let after;
          if (R.lt(off, mDur.get(r.m))) after = evs.filter(e => e.kind === 'note' && e.voice === r.voice && R.eq(R.parse(e.at), off));
          else {
            const nextM = g.timeline.measures[mi + 1];
            after = (nextM ? byKey.get(r.staff + '|' + nextM.id) || [] : []).filter(e => e.kind === 'note' && e.voice === r.voice && R.eq(R.parse(e.at), R.ZERO));
          }
          if (!after.length) { stats.skipped++; return; }
          /* nothing else of the voice in the rest's span, no other note of the staff starting in it */
          const busy = evs.some(e => e !== r && e !== p && ((e.kind === 'note' && R.ge(R.parse(e.at), on) && R.lt(R.parse(e.at), off))
            || (e.voice === r.voice && R.lt(R.parse(e.at), off) && R.gt(R.add(R.parse(e.at), R.parse(e.dur)), on))));
          if (busy) { stats.skipped++; return; }
          out.push({ part: part, rest: r, note: p, value: value });
        });
      });
    });
    return out;
  }

  function fillRunRests(g) {
    try { return fillRunRestsUnsafe(g); } catch (e) { /* never a throw (a graph this pass does not understand is returned as it is) */ return { graph: g, changed: false, stats: { fills: 0, notesLengthened: 0, restsRemoved: 0, skipped: 0, failed: String(e && e.message || e).slice(0, 120) } }; }
  }
  function fillRunRestsUnsafe(g) {
    const stats = { fills: 0, notesLengthened: 0, restsRemoved: 0, skipped: 0 };
    const fills = runRestFills(g, stats);
    if (!fills.length) return { graph: g, changed: false, stats: stats };
    const res = OPS.edit(g, d => {
      const gone = [];
      fills.forEach(f => {
        const e = d.event(f.note.id);
        e.dur = R.format(R.add(R.parse(f.note.dur), SIXTEENTH));
        e.display = Object.assign({}, e.display, { type: f.value.type });
        if (f.value.dots) e.display.dots = f.value.dots; else delete e.display.dots;
        d.markProv(e, ['rhythm'], 'repaired');
        gone.push(f.rest.id);
        stats.fills++; stats.notesLengthened++;
      });
      stats.restsRemoved = gone.length;
      d.removeEvents(gone);
      d.touch();
    }, { source: FILL_SOURCE });
    return { graph: res.graph, changed: true, stats: stats, issues: res.issues };
  }

  /* what the recording paths call: the gaps closed, each silence written once (the reports of the two kept apart), then the lone 16th rests of the left hand's runs filled */
  function tidyRests(g) {
    /* to a fixed point: a hole the merging leaves can turn a gap that closeSmallGaps skipped (a rest of the note's own voice reached past it) into one it closes, so the passes run again until
       none changes anything (a note only gets longer, never past the next onset: it ends; the cap is a guard). `stats` is the first closing's, `rests` the merging's, summed; `fill` is the
       run rests' (summed). */
    let cur = g, first = null, changed = false, issues;
    const rests = { runs: 0, restsBefore: 0, restsAfter: 0, skipped: 0 };
    const fill = { fills: 0, notesLengthened: 0, restsRemoved: 0, skipped: 0 };
    for (let i = 0; i < 6; i++) {
      const a = closeSmallGaps(cur), b = mergeRests(a.graph), c = fillRunRests(b.graph);
      if (!first) first = a.stats;
      rests.runs += b.stats.runs; rests.restsBefore += b.stats.restsBefore; rests.restsAfter += b.stats.restsAfter; rests.skipped = b.stats.skipped;
      if (b.stats.failed) rests.failed = b.stats.failed;
      fill.fills += c.stats.fills; fill.notesLengthened += c.stats.notesLengthened; fill.restsRemoved += c.stats.restsRemoved; fill.skipped = c.stats.skipped;
      if (c.stats.failed) fill.failed = c.stats.failed;
      if (!a.changed && !b.changed && !c.changed) break;
      changed = true; cur = c.graph; issues = c.changed ? c.issues : b.changed ? b.issues : a.issues;
    }
    return { graph: cur, changed: changed, stats: first, rests: rests, fill: fill, issues: issues };
  }

  return Object.freeze({ GAP_LIMIT, GAP_SOURCE, RESTS_SOURCE, plainValue, smallGaps, isTranscription, closeSmallGaps, mergeRests, tidyRests, tile, restRuns, FILL_SOURCE, fillRunRests });
});
