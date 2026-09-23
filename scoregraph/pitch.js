/* ============================================================================
   PPP ScoreGraph — derived pitch values (docs/GOALS/G01 §7.2, §8.2)

   A head stores its concert (sounding) pitch with its spelling. Everything
   else is computed here and never stored: the MIDI number, the written pitch
   of a transposing instrument, the octave an ottava displays, the written key
   signature of a transposing part, and the limb that plays a head.
   ========================================================================== */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else { const M = root.PPPScoreGraphModules = root.PPPScoreGraphModules || {}; M.pitch = factory(); }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
  const PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

  /* Sounding MIDI number: 12 × (oct + 1) + pc(step) + alter. */
  function midi(p) { return 12 * (p.oct + 1) + PC[p.step] + (p.alter || 0); }

  /* Move a spelled pitch by an interval: `diatonic` letter steps and `chromatic` semitones. */
  function transpose(p, diatonic, chromatic) {
    const li = LETTERS.indexOf(p.step) + diatonic;
    const oct = p.oct + Math.floor(li / 7);
    const step = LETTERS[((li % 7) + 7) % 7];
    const target = midi(p) + chromatic;
    const alter = target - (12 * (oct + 1) + PC[step]);
    const out = { step: step, oct: oct };
    if (alter) out.alter = alter;
    return out;
  }
  /* written → sounding interval of an instrument.transpose (MusicXML <transpose>): chromatic and diatonic
     plus whole octaves. */
  function interval(tr) {
    const o = (tr && tr.octave) || 0;
    return { diatonic: ((tr && tr.diatonic) || 0) + 7 * o, chromatic: ((tr && tr.chromatic) || 0) + 12 * o };
  }
  /* The written pitch of a concert pitch (§7.2: transpose backwards). */
  function written(concertPitch, tr) {
    if (!tr) return concertPitch;
    const iv = interval(tr);
    return transpose(concertPitch, -iv.diatonic, -iv.chromatic);
  }
  /* The concert pitch of a written pitch (import: MusicXML <pitch> is written). */
  function concert(writtenPitch, tr) {
    if (!tr) return writtenPitch;
    const iv = interval(tr);
    return transpose(writtenPitch, iv.diatonic, iv.chromatic);
  }
  /* The key signature printed on a transposing part: written fifths = concert fifths − (7c − 12d), wrapped
     into −7…7 by ±12 (the enharmonic key). */
  function writtenFifths(concertFifths, tr) {
    if (!tr) return concertFifths;
    const iv = interval(tr);
    let w = concertFifths - (7 * iv.chromatic - 12 * iv.diatonic);
    while (w > 7) w -= 12;
    while (w < -7) w += 12;
    return w;
  }
  function concertFifths(writtenF, tr) {
    if (!tr) return writtenF;
    const iv = interval(tr);
    let c = writtenF + (7 * iv.chromatic - 12 * iv.diatonic);
    while (c > 7) c -= 12;
    while (c < -7) c += 12;
    return c;
  }
  /* The octave an ottava displays a written pitch at (§5.10): written.oct − shift. */
  function displayOctave(writtenPitch, shift) { return writtenPitch.oct - (shift || 0); }

  /* limbOf(head) = head.limb ?? voice.limb ?? staff.limb (§8.2); staff is the one the head is written on. */
  function limbOf(part, event, head) {
    if (head.limb) return head.limb;
    const voice = part.voices.find(v => v.id === event.voice);
    if (voice && voice.limb) return voice.limb;
    const staffId = head.staff || event.staff;
    const staff = part.staves.find(s => s.id === staffId);
    return staff && staff.limb ? staff.limb : undefined;
  }

  return Object.freeze({ LETTERS, PC, midi, transpose, interval, written, concert, writtenFifths, concertFifths,
    displayOctave, limbOf });
});
