/* ============================================================================
   PPP rec/ S5 - the voices of each staff (docs/GOALS/G10_AUDIO_TO_SCORE.md section 8, stage S5; phase G10a-3)

     assign(notes, ctx) -> { voice: [1|2 per note], report }
     assignQ(q, ctx)    -> the same, written on q[i].voice

   A one-voice writer writes a staff as one line of chords: where the staff holds two parts with different rhythms (a
   hymn's tenor and bass in the lower staff, its soprano and alto in the upper one) a held note is cut at the other
   part's next onset, and a part that rests while the other moves becomes a rest of the whole chord. The catalogue writes
   two voices in 97 % of the hymns' staff-bars and in 0-16 % of the other collections' (G10 section 22). This stage gives a
   staff a second voice only where the texture is four-part writing - S4's piece-level style 'chorale' (rec/hands.js: the
   hymnal's two parts per staff, decided from the whole piece) - and there splits every staff into an upper and a lower
   part, as the hymnal does:
     - an onset with two or more notes in the staff: the highest is the upper voice, the others the lower one;
     - a single note: the part it continues - the nearer by pitch to the part's last note (two more terms were measured and
       made no difference, so they are not here: a part whose last note is still heard sounding cannot take it - hymn voice F1
       0.912 -> 0.92 without it, note values 0.963 -> 0.96, the releases of the calibrated performances say little, G10 E5;
       a cost for crossing the other part - voice F1 0.9589 -> 0.9581 without it; G10 section 22);
   Each voice is then written with its own durations (rec/writer.js: each note until the next onset of ITS voice, rests by
   S6). Piano writing ('piano' style) keeps one voice per staff: there a release is weak evidence (70 % of real notes are
   held past the next onset, G10 E5) and the catalogue rarely writes two voices; that choice is measured (section 22).

   ctx: {style ('chorale'|'piano'), minDense}. Pure, deterministic; UMD: Node
   require('./rec/voices.js'), page PPPRecVoices.
   ========================================================================== */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PPPRecVoices = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const VERSION = '0.1.0';
  const MIN_DENSE = 0.5;       /* a staff is split only when at least half of its onsets sound exactly two notes (two parts) */
  const MAX_CHORDS = 0.25;     /* ... and at most a quarter sound three or more (block chords are one part) */

  function assign(notes, ctx) {
    ctx = ctx || {};
    const voice = notes.map(() => 1);
    const report = { version: VERSION, style: ctx.style || 'piano', staves: [0, 0], second: 0, single: 0 };
    if (ctx.style !== 'chorale') return { voice: voice, report: report };
    [1, 2].forEach(staff => {
      const idx = [];
      notes.forEach((n, i) => { if (n.staff === staff) idx.push(i); });
      if (!idx.length) return;
      const byTick = new Map();
      idx.forEach(i => { const t = notes[i].tick; if (!byTick.has(t)) byTick.set(t, []); byTick.get(t).push(i); });
      const ticks = Array.from(byTick.keys()).sort((a, b) => a - b);
      /* a staff that holds two parts sounds two notes at most of its onsets; a melody over a chorale-like left hand does not */
      const two = ticks.filter(t => byTick.get(t).length === 2).length / ticks.length;
      const more = ticks.filter(t => byTick.get(t).length >= 3).length / ticks.length;
      if (two < (ctx.minDense != null ? ctx.minDense : MIN_DENSE) || more > MAX_CHORDS) { report.staves[staff - 1] = 1; return; }
      const last = [null, null, null];          /* per voice: {midi, off} of its last note (the lowest of a chord for the lower voice) */
      ticks.forEach(t => {
        const g = byTick.get(t).slice().sort((a, b) => notes[b].midi - notes[a].midi || a - b);
        if (g.length >= 2) {
          voice[g[0]] = 1;
          for (let k = 1; k < g.length; k++) voice[g[k]] = 2;
          last[1] = { midi: notes[g[0]].midi };
          last[2] = { midi: notes[g[1]].midi };
          report.second += g.length - 1;
          return;
        }
        const i = g[0], n = notes[i];
        const cost = v => {
          const L = last[v];
          return L ? Math.abs(n.midi - L.midi) : (v === 1 ? 0 : 1);
        };
        const v = cost(2) < cost(1) ? 2 : 1;
        voice[i] = v;
        last[v] = { midi: n.midi };
        report.single++;
        if (v === 2) report.second++;
      });
      report.staves[staff - 1] = 2;
    });
    return { voice: voice, report: report };
  }

  function assignQ(q, ctx) {
    const r = assign(q, ctx);
    q.forEach((n, i) => { n.voice = r.voice[i]; });
    return r;
  }

  return Object.freeze({ VERSION, assign, assignQ });
});
