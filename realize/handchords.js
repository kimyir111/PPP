/* ============================================================================
   PPP Realization - source-copied hand chords (docs/GOALS/G09 section 12 "G9 source-copied hand chords (post user review 4)").

   The user (a piano teacher, reviewing blind) still found, after the clash-guard round, two noteheads stacked touching (a second) and two notes an
   octave or more apart played together "by one hand", and said levels 2-4 students find both very hard. The earlier guards (`handGuard`, `melodyClash`,
   `hymnThin`) governed GENERATED left-hand stacks and thinned verbatim hymn copies' unprotected notes; what is left comes from SOURCE material the
   realizer protects (the melody with a harmony note, an octave-doubled melody) and from the two hands' voices meeting around middle C (a tenor drawn in
   the bass staff at C4 under an alto D4 in the treble staff reads as one stacked second).

   thin(notes, opts) -> { removedIds: [note id], removedChains, stats }     (pure, deterministic, no clock, no randomness; realize/index.js is the caller)

   A NOTE is {id, hand: 'LH' | 'RH', on, off, midi, cont, chain, keep, low}: one head of a note event, onset and end in quarter notes, `cont` = the `to`
   end of a tie (sounds, does not attack), `chain` = any value shared by the heads of one tie chain (a note is never shortened, so a chain goes whole or
   stays), `keep` = PROTECTED (the top head of a melody-voice event, and the bass: the lowest head of the left hand's bass event), `low` = a head of a
   melody-voice event that is not its top head (a harmony note or an octave doubling inside the melody's own event).

   CHORD MODELS (`opts.model`, default 'limbSeconds'). A violation is looked for in the notes one group sounds together (held notes included, at least one
   attacking), in
     'limb'         the notes of one hand (the staff they are written on: what the pianist's hand plays);
     'limbSeconds'  (default) limb, plus every note of both hands together checked for SECONDS only: a left-hand tenor C#4 and a right-hand alto D#4, or B3
                    under C4, are two noteheads touching whichever side of middle C they fall on;
     'pitch'        the notes below middle C and the notes at or above it (HAND_PITCH_SPLIT = 60), seconds and octave-plus spans: how a reader groups what is
                    stacked near the boundary between the staves (opt-in: it removes the most notes and flipped two hymns' patterns);
     'both'         limb and pitch (the first version's default, opt-in).
   The measured reasons are in docs/GOALS/G09 section 12 ("post user review 4", revised after the independent review).

   A VIOLATION of a group at an onset: two of its notes adjacent in pitch are 1 or 2 semitones apart (SECOND_MAX_SEMITONES; a unison is not a second), or
   its highest minus lowest note is OCTAVE_SEMITONES (12) or more.

   WHAT GOES (least important first; never a protected note, never a shortening or a move; remaining notes keep pitch, onset, duration and ties):
     1. only a note INVOLVED in the violation can go: a member of a second, or the lowest or highest note of a span of an octave or more;
     2. a note that is neither protected nor a head of a melody-voice event (an inner voice, a generated tone) before a `low` head (the melody's own
        doubling or harmony note: if the violation is between the melody note and its own octave double, the doubling goes);
     3. among those, one whose removal clears the whole violation, then a doubling (a pitch class another note of the group also sounds), then the note
        farthest from the nearest protected note of the group, then the higher pitch, then the id.
   A violation whose involved notes are all protected is left and counted (`stats.unfixable`). Removing a note never creates a second or widens a span,
   so one ascending pass is enough and thin() is idempotent: thin(thin(x)) removes nothing.
   ========================================================================== */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else { const M = root.PPPRealizeModules = root.PPPRealizeModules || {}; M.handchords = factory(); }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const HAND_CHORDS_MAX_STAGE = 3;   /* stages 1-3 only; stage 4 (the plan's hardest stage) keeps the source's own voices */
  const HAND_PITCH_SPLIT = 60;       /* middle C: below it = the lower group, at or above = the upper group, in the 'pitch' model */
  const SECOND_MAX_SEMITONES = 2;    /* a second: 1 or 2 semitones between adjacent notes */
  const OCTAVE_SEMITONES = 12;       /* a span of an octave or more */
  /* the models: which groupings of the sounding notes are searched for a violation.
       limb         the hands as written (seconds and octave-plus spans);
       limbSeconds  (the default) limb, plus 'cross': ALL sounding notes of both hands together, seconds only: two noteheads 1 or 2 semitones apart that two hands
                    play next to each other (B3 under C4, C#4 under D#4) read as one stacked chord whatever side of middle C they fall on;
       pitch        the pitch grouping (below C4 / at or above it), seconds and octave-plus spans (an opt-in: the first version's second grouping);
       both         limb and pitch (the first version's default, kept as an opt-in for its numbers). */
  const MODEL_RULES = Object.freeze({ limb: ['limb'], limbSeconds: ['limb', 'cross'], pitch: ['pitch'], both: ['limb', 'pitch'] });
  const MODELS = Object.freeze(Object.keys(MODEL_RULES));
  const DEFAULT_MODEL = 'limbSeconds';
  const EPS = 1e-6;

  function groupOf(grouping, n) { return grouping === 'limb' ? n.hand : grouping === 'cross' ? 'all' : (n.midi < HAND_PITCH_SPLIT ? 'low' : 'high'); }
  const GROUP_NAMES = { limb: ['LH', 'RH'], pitch: ['low', 'high'], cross: ['all'] };

  /* what is wrong with a sorted list of midi numbers: {second, octave} */
  function problems(midis, secondsOnly) {
    const m = midis.slice().sort((a, b) => a - b);
    let second = false;
    for (let i = 1; i < m.length; i++) { const d = m[i] - m[i - 1]; if (d > 0 && d <= SECOND_MAX_SEMITONES) second = true; }
    return { second: second, octave: !secondsOnly && m.length > 1 && m[m.length - 1] - m[0] >= OCTAVE_SEMITONES };
  }

  /* the violating (model, group, onset) chords of a note list: { 'limb:LH': {second, octave, chords}, ... }; `removed` = a Set of chains left out */
  function count(notes, models, times, removed) {
    const out = {};
    models.forEach(model => GROUP_NAMES[model].forEach(g => { out[model + ':' + g] = { second: 0, octave: 0, chords: 0, handChords: 0 }; }));
    times.forEach(t => {
      const snd = notes.filter(n => !removed.has(n.chain) && n.on <= t + EPS && n.off > t + EPS);
      models.forEach(model => {
        const groups = {};
        snd.forEach(n => { (groups[groupOf(model, n)] = groups[groupOf(model, n)] || []).push(n); });
        Object.keys(groups).forEach(g => {
          const list = groups[g];
          if (list.length < 2 || !list.some(n => !n.cont && Math.abs(n.on - t) <= EPS)) return;
          const cell = out[model + ':' + g];
          cell.handChords++;
          const p = problems(list.map(n => n.midi), model === 'cross');
          if (p.second) cell.second++;
          if (p.octave) cell.octave++;
          if (p.second || p.octave) cell.chords++;
        });
      });
    });
    return out;
  }

  function sumChords(c) { return Object.keys(c).reduce((a, k) => a + c[k].chords, 0); }

  function thin(notes, opts) {
    opts = opts || {};
    const model = opts.model || DEFAULT_MODEL;
    if (MODELS.indexOf(model) < 0) throw new Error('handchords: unknown model ' + model + ' (one of ' + MODELS.join(', ') + ')');
    const models = MODEL_RULES[model];
    const timeSeen = new Set(), times = [];
    notes.forEach(n => { if (n.cont) return; const k = Math.round(n.on / EPS); if (!timeSeen.has(k)) { timeSeen.add(k); times.push(n.on); } });
    times.sort((a, b) => a - b);
    const keepChain = new Set(), lowChain = new Set();
    notes.forEach(n => { if (n.keep) keepChain.add(n.chain); if (n.low) lowChain.add(n.chain); });
    const removed = new Set(); /* chains */
    const before = count(notes, models, times, removed);

    times.forEach(t => {
      models.forEach(mdl => {
        const snapshot = notes.filter(n => n.on <= t + EPS && n.off > t + EPS);
        const groupNames = Array.from(new Set(snapshot.map(n => groupOf(mdl, n)))).sort();
        groupNames.forEach(g => {
          for (let guard = 0; guard < 64; guard++) {
            const list = notes.filter(n => !removed.has(n.chain) && n.on <= t + EPS && n.off > t + EPS && groupOf(mdl, n) === g);
            if (list.length < 2 || !list.some(n => !n.cont && Math.abs(n.on - t) <= EPS)) break;
            const sorted = list.slice().sort((a, b) => a.midi - b.midi);
            const so = mdl === 'cross';
            { const pr = problems(sorted.map(n => n.midi), so); if (!pr.second && !pr.octave) break; }
            /* the notes involved in a violation */
            const involved = new Set();
            for (let i = 1; i < sorted.length; i++) { const d = sorted[i].midi - sorted[i - 1].midi; if (d > 0 && d <= SECOND_MAX_SEMITONES) { involved.add(sorted[i - 1]); involved.add(sorted[i]); } }
            if (!so && sorted[sorted.length - 1].midi - sorted[0].midi >= OCTAVE_SEMITONES) { involved.add(sorted[0]); involved.add(sorted[sorted.length - 1]); }
            const cands = Array.from(involved).filter(n => !keepChain.has(n.chain));
            if (!cands.length) break; /* only protected notes make it: left, counted below */
            const prot = list.filter(n => keepChain.has(n.chain));
            const pcCount = new Map();
            list.forEach(n => { const pc = ((n.midi % 12) + 12) % 12; pcCount.set(pc, (pcCount.get(pc) || 0) + 1); });
            const clears = n => { const rest = list.filter(x => x.chain !== n.chain).map(x => x.midi); const p = problems(rest, so); return !p.second && !p.octave; };
            const dist = n => prot.length ? Math.min.apply(null, prot.map(p => Math.abs(p.midi - n.midi))) : 0;
            const key = n => [lowChain.has(n.chain) ? 1 : 0, clears(n) ? 0 : 1, pcCount.get(((n.midi % 12) + 12) % 12) > 1 ? 0 : 1, -dist(n), -n.midi];
            cands.sort((a, b) => {
              const ka = key(a), kb = key(b);
              for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i] - kb[i];
              return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
            });
            removed.add(cands[0].chain);
          }
        });
      });
    });

    const after = count(notes, models, times, removed);
    const removedNotes = notes.filter(n => removed.has(n.chain));
    const tally = c => {
      const o = { second: 0, octave: 0, chords: 0 };
      Object.keys(c).forEach(k => { o.second += c[k].second; o.octave += c[k].octave; o.chords += c[k].chords; });
      return o;
    };
    return {
      removedIds: removedNotes.map(n => n.id),
      removedChains: removed.size,
      stats: {
        model: model, notes: notes.length, removedNotes: removedNotes.length, removedChains: removed.size,
        before: before, after: after, violationsBefore: sumChords(before), violationsAfter: sumChords(after),
        unfixable: sumChords(after), unfixableSeconds: tally(after).second, unfixableOctave: tally(after).octave,
        /* the chords left, by grouping: the hands as written (a real one-hand chord) and the pitch grouping (two hands' notes stacked near middle C) */
        unfixableLimb: sumChords(Object.keys(after).filter(k => k.indexOf('limb:') === 0).reduce((o, k) => { o[k] = after[k]; return o; }, {})),
        unfixablePitch: sumChords(Object.keys(after).filter(k => k.indexOf('pitch:') === 0).reduce((o, k) => { o[k] = after[k]; return o; }, {})),
        unfixableCross: sumChords(Object.keys(after).filter(k => k.indexOf('cross:') === 0).reduce((o, k) => { o[k] = after[k]; return o; }, {}))
      }
    };
  }

  return Object.freeze({ HAND_CHORDS_MAX_STAGE, HAND_PITCH_SPLIT, SECOND_MAX_SEMITONES, OCTAVE_SEMITONES, MODELS, MODEL_RULES, DEFAULT_MODEL, problems, count, thin });
});
