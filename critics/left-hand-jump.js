/* ============================================================================
   PPP Critics - left-hand jump rate (G9 post-H-8 re-look, docs/GOALS/G09 section 12
   "G9 left-hand jumps (post H-8 re-look)").

   The user's first blind review (H-8) flagged "awkward hand position" on 9 of 16 G9 arrangements, with notes like
   "the distance between the low notes, an octave or a tenth, is too far". The register floor fixed the wrong main
   cause (it only removed extreme low notes); the cause was the bass jumping an octave or more from one left-hand
   note to the next. Nothing measured that. This critic does.

   leftHandJump(graph, opts) -> { splitMidi, jumpSemitones, steps, jumps, rate, maxJump, belowG2, lowest }
     A LEFT-HAND STEP is defined by pitch, the same proxy the review analysis used (so a legacy arrangement, whose
     hands are projected from note lists, and a G9 one are measured the same way): at every onset where some note
     sounds below `splitMidi` (MIDI 60, middle C), the BASS is the lowest such note; the steps are between
     consecutive such onsets (an onset with nothing below middle C is skipped, not a step). A JUMP is a step whose
     bass moves by `jumpSemitones` (12, an octave) or more. `rate` = jumps / steps (0 when there are no steps).
     `belowG2` counts every note below G2 (MIDI 43, the bottom line of the bass staff: the notes that need ledger
     lines), source and arranged alike (the register-floor critic separates arranged from source; this is the
     plain count the review comparison used). Tied continuations are not told apart from attacks (the realizer's
     accompaniment has no ties; a copied hymn voice may).

   Deterministic, no randomness, no clock. Report only: weight 0 in `candidates/index.js` DEFAULT_WEIGHTS (the standing
   rule is no further tuning of selection; the realizer's geometry is what changes). */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./register-floor.js'));
  } else {
    const M = root.PPPCriticsModules = root.PPPCriticsModules || {};
    M.leftHandJump = factory(M.registerFloor);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (RF) {
  'use strict';

  const SPLIT_MIDI = 60;   /* middle C: below it a sounding note counts as left-hand register */
  const JUMP_SEMITONES = 12; /* an octave or more between consecutive basses */
  const G2 = 43;           /* the bottom line of the bass staff */

  /* the bass line {onsetQ, bass} of a plain note list [{onsetQ, midi}], in time order, one entry per onset that has a
     note below `split` */
  function bassLine(notes, split) {
    const byOnset = new Map();
    notes.forEach(n => {
      if (n.midi >= split) return;
      const k = Math.round(n.onsetQ * 1e6);
      const cur = byOnset.get(k);
      if (!cur || n.midi < cur.bass) byOnset.set(k, { onsetQ: n.onsetQ, bass: n.midi });
    });
    return Array.from(byOnset.values()).sort((a, b) => a.onsetQ - b.onsetQ);
  }

  function ofNotes(notes, opts) {
    opts = opts || {};
    const split = opts.splitMidi == null ? SPLIT_MIDI : opts.splitMidi;
    const jump = opts.jumpSemitones == null ? JUMP_SEMITONES : opts.jumpSemitones;
    const line = bassLine(notes, split);
    const out = { splitMidi: split, jumpSemitones: jump, steps: 0, jumps: 0, rate: 0, maxJump: 0, belowG2: 0, lowest: null };
    for (let i = 1; i < line.length; i++) {
      const d = Math.abs(line[i].bass - line[i - 1].bass);
      out.steps++;
      if (d >= jump) out.jumps++;
      if (d > out.maxJump) out.maxJump = d;
    }
    out.rate = out.steps ? out.jumps / out.steps : 0;
    notes.forEach(n => {
      if (n.midi < G2) out.belowG2++;
      if (out.lowest == null || n.midi < out.lowest) out.lowest = n.midi;
    });
    return out;
  }

  function leftHandJump(graph, opts) { return ofNotes(RF.notesOf(graph), opts); }

  /* ---- the repair guard's questions (repair/plan.js, repair/index.js): would an edit CREATE a jump? ----
     A jump is identified by its two onsets ("fromKey>toKey"), so the same step before and after an edit is the same jump
     and a step whose bass an edit changed is a new jump only if it was not one before. */
  const keyOf = q => Math.round(q * 1e6);

  /* the identities of every jump of a plain note list [{onsetQ, midi}] */
  function jumpIds(notes, opts) {
    opts = opts || {};
    const jump = opts.jumpSemitones == null ? JUMP_SEMITONES : opts.jumpSemitones;
    const line = bassLine(notes, opts.splitMidi == null ? SPLIT_MIDI : opts.splitMidi);
    const ids = new Set();
    for (let i = 1; i < line.length; i++) if (Math.abs(line[i].bass - line[i - 1].bass) >= jump) ids.add(keyOf(line[i - 1].onsetQ) + '>' + keyOf(line[i].onsetQ));
    return ids;
  }
  /* how many jumps `after` has that `before` did not (same onsets, edited pitches) */
  function newJumps(before, after, opts) {
    const b = jumpIds(before, opts);
    let n = 0;
    jumpIds(after, opts).forEach(id => { if (!b.has(id)) n++; });
    return n;
  }

  /* a per-state index for asking the same question about ONE note moved, without rebuilding the whole line each time */
  function bassIndex(notes, opts) {
    const split = opts && opts.splitMidi != null ? opts.splitMidi : SPLIT_MIDI;
    const lows = new Map();
    notes.forEach(n => { if (n.midi < split) { const k = keyOf(n.onsetQ); if (!lows.has(k)) lows.set(k, []); lows.get(k).push(n.midi); } });
    return { split: split, jump: opts && opts.jumpSemitones != null ? opts.jumpSemitones : JUMP_SEMITONES, lows: lows, keys: Array.from(lows.keys()).sort((a, b) => a - b) };
  }
  function stepsAround(idx, key, lowsAtKey) {
    const keys = idx.keys;
    let lo = 0, hi = keys.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (keys[mid] < key) lo = mid + 1; else hi = mid; }
    const prev = lo > 0 ? keys[lo - 1] : null;
    const next = lo < keys.length && keys[lo] === key ? (lo + 1 < keys.length ? keys[lo + 1] : null) : (lo < keys.length ? keys[lo] : null);
    const bassOf = k => k === key ? (lowsAtKey.length ? Math.min.apply(null, lowsAtKey) : null) : Math.min.apply(null, idx.lows.get(k));
    const step = (a, b) => { const x = bassOf(a), y = bassOf(b); return x == null || y == null ? null : { id: a + '>' + b, jump: Math.abs(x - y) >= idx.jump }; };
    const out = [];
    if (lowsAtKey.length) { if (prev != null) out.push(step(prev, key)); if (next != null) out.push(step(key, next)); }
    else if (prev != null && next != null) out.push(step(prev, next));
    return out.filter(Boolean);
  }
  /* would moving a note from `from` to `to` (both MIDI, at onsetQ) create a jump that was not there? */
  function createsJump(idx, onsetQ, from, to) {
    const key = keyOf(onsetQ);
    const before = (idx.lows.get(key) || []).slice();
    const after = before.slice();
    const at = after.indexOf(from);
    if (at >= 0) after.splice(at, 1);
    if (to < idx.split) after.push(to);
    const was = stepsAround(idx, key, before);
    return stepsAround(idx, key, after).some(s => s.jump && !was.some(w => w.id === s.id && w.jump));
  }

  return Object.freeze({ SPLIT_MIDI, JUMP_SEMITONES, G2, bassLine, ofNotes, leftHandJump, jumpIds, newJumps, bassIndex, createsJump });
});
