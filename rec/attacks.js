/* ============================================================================
   PPP rec/ (G10a-1) - S0: the attacks of a performance (docs/GOALS/G10 section 8.1)

     attacksOf(notes) -> [{ t, n, low, high, vel, pcs (a 12-bit mask of its pitch classes), notes: [index] }]
     classes(attacks) -> per attack { bass, ioi, size }: the H-independent observations the metre model reads

   Input: the heard notes after audio-score.js's clean() and clusterNotes() (every note has `attack`, the mean onset of its
   rolled-chord cluster; a note without one is its own attack). One attack per distinct attack time, in time order. Nothing
   here drops or adds a note: S0's cleaning rules (21-108, velocity >= 8, a release at least 30 ms after the onset) are
   audio-score.js's own clean(), which v2 keeps, so the notes v2 writes are exactly the notes legacy writes.

   The observation classes are defined the same way on a heard performance (here) and on a written truth score
   (rec/tools/train.js reads tests/bench/tools/rec_dataset.py's onsets with the same rules), so a table learned on the
   score is read on the performance:
     bass  0: the lowest note is the previous attack's lowest note; 1: another lowest note (a bass change) at or above
           middle C's G (55); 2: another lowest note below 55 (a new bass note in the bass register)
     ioi   the time to the next attack against the piece's median: 0 < 0.75x, 1 < 1.5x, 2 < 3x, 3 >= 3x, 4 the last attack
     size  fewer notes than the piece's median attack (0), as many (1), more (2): a fuller attack than usual, whatever
           the texture
   Node and browser (window.PPPRecModules.attacks). Pure functions, no state.
   ========================================================================== */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else { const M = root.PPPRecModules = root.PPPRecModules || {}; M.attacks = factory(); }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const SAME_ATTACK_S = 1e-6;
  const BASS_MIDI = 55;

  /* audio-score.js's clean(), the same rules (a note 21-108, velocity >= 8, a release at least 30 ms after its onset;
     sorted by onset then pitch): the training tool (rec/tools/train.js) gives rec/ exactly what toMusicXml gives it
     (tests/rec/attacks.test.js checks the two agree) */
  function cleanNotes(notes) {
    return (notes || [])
      .filter(n => n && isFinite(n.on) && isFinite(n.off) && n.midi >= 21 && n.midi <= 108)
      .filter(n => (n.vel == null ? 64 : n.vel) >= 8)
      .map(n => ({ on: Math.max(0, +n.on), off: Math.max(+n.on + 0.03, +n.off), midi: n.midi | 0, vel: n.vel == null ? 64 : +n.vel }))
      .sort((a, b) => a.on - b.on || a.midi - b.midi);
  }

  function attacksOf(notes) {
    const out = [];
    (notes || []).forEach((n, i) => {
      const t = n.attack != null ? n.attack : n.on;
      const last = out[out.length - 1];
      if (last && Math.abs(t - last.t) < SAME_ATTACK_S) {
        last.notes.push(i);
        if (n.midi < last.low) last.low = n.midi;
        if (n.midi > last.high) last.high = n.midi;
        if (n.vel > last.vel) last.vel = n.vel;
        last.pcs |= 1 << (n.midi % 12);
        last.n++;
        return;
      }
      out.push({ t: t, n: 1, low: n.midi, high: n.midi, vel: n.vel == null ? 64 : n.vel, pcs: 1 << (n.midi % 12), notes: [i] });
    });
    out.sort((a, b) => a.t - b.t);
    return out;
  }

  function median(xs) {
    if (!xs.length) return 0;
    const s = xs.slice().sort((a, b) => a - b);
    const h = s.length >> 1;
    return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2;
  }

  /* the classes of a sequence of onsets given as { t (any unit), low, n }: shared by the performance and the truth */
  function classesOf(seq) {
    const iois = [];
    for (let i = 0; i + 1 < seq.length; i++) iois.push(seq[i + 1].t - seq[i].t);
    const med = median(iois.filter(x => x > 0)) || 1;
    const medN = median(seq.map(a => a.n));
    return seq.map((a, i) => {
      const prev = i ? seq[i - 1].low : null;
      const bass = prev === null || prev === a.low ? 0 : (a.low < BASS_MIDI ? 2 : 1);
      let ioi = 4;
      if (i + 1 < seq.length) {
        const r = (seq[i + 1].t - a.t) / med;
        ioi = r < 0.75 ? 0 : r < 1.5 ? 1 : r < 3 ? 2 : 3;
      }
      const size = a.n < medN ? 0 : a.n > medN ? 2 : 1;
      return { bass: bass, ioi: ioi, size: size };
    });
  }

  function classes(attacks) { return classesOf(attacks); }

  return Object.freeze({ attacksOf, classes, classesOf, cleanNotes, median, BASS_MIDI });
});
