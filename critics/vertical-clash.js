/* ============================================================================
   PPP Critics - vertical clashes and one-hand spans (G9 clash guard, docs/GOALS/G09 section 12
   "G9 clash guard, seconds and one-hand spans (post user review 3)").

   The user's third look at G9 output ("notes stuck together, a second", "an octave or more at once in one hand is very
   hard", "the harmony got weirder") was measured on the review packets: a harsh vertical pair (a minor second or a major
   seventh between two notes that sound together) and a chord of one hand that spans an octave or more. The harness had no
   number for either. This critic counts them, report only (weight 0 in candidates/index.js DEFAULT_WEIGHTS, not a hard filter).

   verticalClash(graph, opts) -> {
     onsets, harshPairs, harshOnsets, harshPerOnset,           harsh vertical pairs
     harshArranged,                                             (only with opts.sourceNotes) harsh pairs with at least one note the source does not have
     handOnsets, octaveChords, octaveChordsLH, octaveChordsRH,   one-hand chords spanning OCTAVE_SEMITONES (12) or more
     octaveChordRate,
     seconds, secondsLH, secondsRH, secondsRate,                one-hand chords with two adjacent notes 1 or 2 semitones apart
     violations, violationsLH, violationsRH,                    one-hand chords with a second OR an octave-plus span (a chord with both is one)
     pitchHandOnsets, pitchOctaveChords[Low|High], pitchSeconds[Low|High], pitchViolations[Low|High]
                                                                the same counts with the two "hands" taken as the notes below middle C and the notes at or above it
                                                                (PITCH_SPLIT = 60: how the reviewer, who sees no hand labels, groups what is stacked near the staves' boundary)
     onsetsLH, notesLH, notesPerOnsetLH, onsetsRH, notesRH, notesPerOnsetRH    written notes per onset for each hand
     sourceKnown }
   (G9 source-copied hand chords, docs/GOALS/G09 section 12 "post user review 4": on the 8 hymns the drawn hands held 1 second and 0 octave chords while the
   pitch grouping held 6 seconds and 33 octave chords; realize/handchords.js removes both, and `violationKeys` / `newViolations` let repair prove it adds none.)

   Definitions. A NOTE is a head of a note event (grace notes excluded) with its onset, end and hand (scoregraph/pitch.js limbOf:
   the head's, else the voice's, else the staff's). A head that is the `to` end of a tie is a CONTINUATION: it sounds but is not
   an attack. An ONSET is a time at which at least one non-continuation note attacks. At an onset the SOUNDING notes are those with
   onset <= t < end (held notes included).
   - HARSH PAIR: two sounding notes whose pitch-class interval is 1 or 11 (a minor second, a major seventh, a minor ninth,
     whatever the octave), at least one of them attacking at this onset (a clash is counted when it begins, not again on every
     later onset it survives). `harshPerOnset` = harshPairs / onsets; `harshOnsets` = onsets with at least one.
   - ONE-HAND CHORD: the notes one hand has sounding at an onset (held notes included), two or more of them, at least one
     attacking there. `handOnsets` = how many such (hand, onset) chords there are. OCTAVE CHORD: its highest minus lowest note
     is 12 or more semitones. SECOND: two of its notes adjacent in pitch are 1 or 2 semitones apart. Rates are over `handOnsets`.
   With `opts.sourceNotes` ({onsetQ, midi} list of the original piece, critics/metrics.js graphNoteList) a pair is ARRANGED when at
   least one of its two notes is not in the source (same pitch at the same onset). A note without a hand is left out of the
   one-hand counts but still counts in the pairs.

   Deterministic, no randomness, no clock. */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('../scoregraph/rational.js'), require('../scoregraph/pitch.js'));
  } else {
    const SG = root.PPPScoreGraphModules || {};
    const M = root.PPPCriticsModules = root.PPPCriticsModules || {};
    M.verticalClash = factory(SG.rational, SG.pitch);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (R, P) {
  'use strict';

  const OCTAVE_SEMITONES = 12;
  const SECOND_MAX = 2;
  const PITCH_SPLIT = 60; /* the reader's grouping: notes below middle C / at or above it (= realize/handchords.js HAND_PITCH_SPLIT) */
  const EPS = 1e-6;

  function isHarshInterval(a, b) {
    const pc = ((Math.abs(a - b) % 12) + 12) % 12;
    return pc === 1 || pc === 11;
  }

  /* every sounding note of a graph: {on, off (quarters), midi, hand ('LH'|'RH'|undefined), cont (tie continuation)} */
  function notesOf(g) {
    const mStart = new Map(); let acc = R.ZERO;
    g.timeline.measures.forEach(m => { mStart.set(m.id, acc); acc = R.add(acc, R.parse(m.dur)); });
    const out = [];
    g.parts.forEach(part => {
      const tieTo = new Set((part.spanners || []).filter(s => s.type === 'tie').map(s => s.to));
      part.events.forEach(e => {
        if (e.kind !== 'note' || e.grace) return;
        const on = R.toNumber(R.add(mStart.get(e.m), R.parse(e.at))) * 4;
        const off = on + R.toNumber(R.parse(e.dur)) * 4;
        (e.heads || []).forEach(h => {
          if (!h.pitch) return;
          out.push({ on: on, off: off, midi: P.midi(h.pitch), hand: P.limbOf(part, e, h), cont: tieTo.has(h.id) });
        });
      });
    });
    return out;
  }

  /* the onsets (sorted) of a note list, each with the sounding notes and the attacking ones */
  function slices(notes) {
    const times = [];
    const seen = new Set();
    notes.forEach(n => { if (n.cont) return; const k = Math.round(n.on / EPS); if (!seen.has(k)) { seen.add(k); times.push(n.on); } });
    times.sort((a, b) => a - b);
    const sorted = notes.slice().sort((a, b) => a.on - b.on);
    return times.map(t => {
      const sounding = [], attack = [];
      for (let i = 0; i < sorted.length && sorted[i].on <= t + EPS; i++) {
        const n = sorted[i];
        if (n.off <= t + EPS) continue;
        sounding.push(n);
        if (!n.cont && Math.abs(n.on - t) <= EPS) attack.push(n);
      }
      return { t: t, sounding: sounding, attack: attack };
    });
  }

  function isSource(n, srcIdx) {
    return (srcIdx.get(n.midi) || []).some(q => Math.abs(q - n.on) <= EPS);
  }

  function ofNotes(notes, opts) {
    opts = opts || {};
    const sourceKnown = Array.isArray(opts.sourceNotes);
    const srcIdx = new Map();
    if (sourceKnown) opts.sourceNotes.forEach(n => { if (!srcIdx.has(n.midi)) srcIdx.set(n.midi, []); srcIdx.get(n.midi).push(n.onsetQ); });
    const out = {
      onsets: 0, harshPairs: 0, harshOnsets: 0, harshPerOnset: 0, harshArranged: sourceKnown ? 0 : null,
      handOnsets: 0, octaveChords: 0, octaveChordsLH: 0, octaveChordsRH: 0, octaveChordRate: 0,
      seconds: 0, secondsLH: 0, secondsRH: 0, secondsRate: 0, sourceKnown: sourceKnown,
      /* chords of one hand with a second OR an octave or more, each counted once (a chord with both is one) */
      violations: 0, violationsLH: 0, violationsRH: 0,
      /* the same counts with the two "hands" taken as the notes below middle C (low) and at or above it (high): how a reader groups what is stacked near the staves' boundary */
      pitchHandOnsets: 0, pitchOctaveChords: 0, pitchOctaveChordsLow: 0, pitchOctaveChordsHigh: 0, pitchSeconds: 0, pitchSecondsLow: 0, pitchSecondsHigh: 0,
      pitchViolations: 0, pitchViolationsLow: 0, pitchViolationsHigh: 0,
      /* notes written per onset, per hand: an onset is a moment the hand starts at least one note (tie continuations included, as critics/left-hand-thickness.js does) */
      onsetsLH: 0, notesLH: 0, onsetsRH: 0, notesRH: 0, notesPerOnsetLH: 0, notesPerOnsetRH: 0
    };
    const starts = { LH: new Map(), RH: new Map() };
    notes.forEach(n => { if (n.hand !== 'LH' && n.hand !== 'RH') return; const k = Math.round(n.on / EPS); starts[n.hand].set(k, (starts[n.hand].get(k) || 0) + 1); });
    ['LH', 'RH'].forEach(h => { starts[h].forEach(c => { out['onsets' + h]++; out['notes' + h] += c; }); out['notesPerOnset' + h] = out['onsets' + h] ? out['notes' + h] / out['onsets' + h] : 0; });
    slices(notes).forEach(s => {
      out.onsets++;
      const att = new Set(s.attack);
      let harsh = 0;
      for (let i = 0; i < s.sounding.length; i++) for (let j = i + 1; j < s.sounding.length; j++) {
        const a = s.sounding[i], b = s.sounding[j];
        if (!att.has(a) && !att.has(b)) continue;
        if (!isHarshInterval(a.midi, b.midi)) continue;
        harsh++;
        if (sourceKnown && !(isSource(a, srcIdx) && isSource(b, srcIdx))) out.harshArranged++;
      }
      out.harshPairs += harsh;
      if (harsh) out.harshOnsets++;
      ['LH', 'RH'].forEach(hand => {
        const h = s.sounding.filter(n => n.hand === hand);
        if (h.length < 2 || !h.some(n => att.has(n))) return;
        out.handOnsets++;
        const m = h.map(n => n.midi).sort((a, b) => a - b);
        if (m[m.length - 1] - m[0] >= OCTAVE_SEMITONES) { out.octaveChords++; out['octaveChords' + hand]++; }
        let second = false;
        for (let i = 1; i < m.length; i++) { const d = m[i] - m[i - 1]; if (d > 0 && d <= SECOND_MAX) second = true; }
        if (second) { out.seconds++; out['seconds' + hand]++; }
        if (second || m[m.length - 1] - m[0] >= OCTAVE_SEMITONES) { out.violations++; out['violations' + hand]++; }
      });
      ['low', 'high'].forEach(grp => {
        const h = s.sounding.filter(n => (n.midi < PITCH_SPLIT) === (grp === 'low'));
        if (h.length < 2 || !h.some(n => att.has(n))) return;
        out.pitchHandOnsets++;
        const m = h.map(n => n.midi).sort((a, b) => a - b);
        const G = grp === 'low' ? 'Low' : 'High';
        const oct = m[m.length - 1] - m[0] >= OCTAVE_SEMITONES;
        let second = false;
        for (let i = 1; i < m.length; i++) { const d = m[i] - m[i - 1]; if (d > 0 && d <= SECOND_MAX) second = true; }
        if (oct) { out.pitchOctaveChords++; out['pitchOctaveChords' + G]++; }
        if (second) { out.pitchSeconds++; out['pitchSeconds' + G]++; }
        if (oct || second) { out.pitchViolations++; out['pitchViolations' + G]++; }
      });
    });
    out.harshPerOnset = out.onsets ? out.harshPairs / out.onsets : 0;
    out.octaveChordRate = out.handOnsets ? out.octaveChords / out.handOnsets : 0;
    out.secondsRate = out.handOnsets ? out.seconds / out.handOnsets : 0;
    return out;
  }

  function verticalClash(graph, opts) { return ofNotes(notesOf(graph), opts); }

  /* What an edit CREATED: how many more harsh pairs, one-hand octave-plus chords and one-hand seconds `after` has than `before` (each at least 0; a count that
     fell or stayed is 0). repair/index.js uses it so a repair never writes what the clash guard removed: { harsh, octave, seconds }. */
  function newClashes(before, after) {
    const a = verticalClash(before), b = verticalClash(after);
    return { harsh: Math.max(0, b.harshPairs - a.harshPairs), octave: Math.max(0, b.octaveChords - a.octaveChords), seconds: Math.max(0, b.seconds - a.seconds) };
  }

  /* The violating chords, by identity: a Set of 'limb:LH:<onset>:second' ... 'pitch:low:<onset>:octave' keys (a chord of one group at one onset with a second,
     and/or with a span of an octave or more, for the hands as written and for the pitch grouping). */
  function violationKeys(g) {
    const keys = new Set();
    slices(notesOf(g)).forEach(s => {
      const att = new Set(s.attack);
      const check = (tag, list) => {
        if (list.length < 2 || !list.some(n => att.has(n))) return;
        const m = list.map(n => n.midi).sort((a, b) => a - b);
        const t = Math.round(s.t / EPS);
        if (m[m.length - 1] - m[0] >= OCTAVE_SEMITONES) keys.add(tag + ':' + t + ':octave');
        for (let i = 1; i < m.length; i++) { const d = m[i] - m[i - 1]; if (d > 0 && d <= SECOND_MAX) { keys.add(tag + ':' + t + ':second'); break; }}
      };
      ['LH', 'RH'].forEach(hand => check('limb:' + hand, s.sounding.filter(n => n.hand === hand)));
      ['low', 'high'].forEach(grp => check('pitch:' + grp, s.sounding.filter(n => (n.midi < PITCH_SPLIT) === (grp === 'low'))));
    });
    return keys;
  }

  /* the violating chords `after` has that `before` did not (exact, by identity, both groupings): { limb, pitch } counts. An edit that clears one chord and makes another
     is 1, not 0 (newClashes above counts the net change). */
  function newViolations(before, after) {
    const a = violationKeys(before), b = violationKeys(after);
    const out = { limb: 0, pitch: 0 };
    b.forEach(k => { if (!a.has(k)) out[k.slice(0, 5) === 'limb:' ? 'limb' : 'pitch']++; });
    return out;
  }

  return Object.freeze({ OCTAVE_SEMITONES, SECOND_MAX, PITCH_SPLIT, isHarshInterval, notesOf, slices, ofNotes, verticalClash, newClashes, violationKeys, newViolations });
});
