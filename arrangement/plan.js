/* ============================================================================
   PPP Arrangement Planner (docs/GOALS/G07B_ARRANGEMENT_PLANNER.md) — G7b.

   plan(g, sg, request, opts) -> { ok: true, plan: ArrangementPlan } | { ok: false, reason, detail }

   Consumes a ScoreGraph (g) and its already-built SongGraph (sg, songgraph/index.js's
   analyze(g) - G7a, merged and reviewed) plus an ArrangementRequest, and searches for an
   ArrangementPlan: WHICH of the piece's real, already-identified voices (G7a's
   voiceRolesOf) each section keeps, which hand plays each, and whether that selection fits
   the requested hand profile (playability/reach.js, G5) and difficulty level
   (arrangement/reference.js's real per-stage bands, built from G6's own training corpus).

   G7b writes NO notes and NO pitches: every voice a plan keeps is a real voice with real
   notes already in the ScoreGraph (g.parts[*].events); every voice it drops is simply
   omitted from the plan. This is a SELECTION and HAND-ASSIGNMENT plan, not a generative
   one - see arrangement/texture.js's header for why the vocabulary is a retention ladder,
   not an invented rhythmic-pattern list.

   ---- §3's open question: which G0 Step 14 invariants are plan-level-checkable ----
   (docs/GOALS/G07B_ARRANGEMENT_PLANNER.md §3; full reasoning + real numbers in that doc's
   §11 "Implementation record" once measured.) The 10 invariants, and what this module
   actually does about each:

     REAL, CHECKED HERE (no notes needed, because the plan is already a real subset of
     real notes - not proxies standing in for something else, actual values):
     - read.max_chord_size    the plan's own maxNotesPerHand IS the real simultaneous note
                               count of the retained voices in this section (checkReach).
     - read.over_span_rate    the plan's own hand span IS the real simultaneous span of the
                               retained voices in this section, checked against G5's real
                               MAX_SPAN[handProfile] (checkReach). Not a rate (no notes to
                               compute a rate over) - a per-section worst-case span check;
                               see §11 for why that's a fair proxy for the rate being 0.
     - arr.max_notes_per_attack<=cap  the SAME simultaneous-count check as read.max_chord_size
                               (G0's two chord-size invariants collapse to one check here).

     STRUCTURALLY GUARANTEED BY WHAT A PLAN CAN EVEN SAY (not independently verified, since
     there is nothing in a plan's shape that could violate them - real verification of G8's
     actual output is still required and deferred there):
     - arr.invented_pitches=0   a plan names existing voice ids, never a pitch; it has no
                               field capable of inventing one.
     - arr.metre_preserved     a plan never proposes a meter change (no such field exists).
     - arr.tempo_preserved     same - no tempo field.

     PARTIAL / EMPIRICAL PROXY (real numbers, but bounding a DECLARED target, not measuring
     a realized one - G8 must still confirm the real value once notes exist):
     - arr.density_ratio       the retained voices' real notesPerBeat/chordLoad (100% real,
                               computed from the SAME notes G8 would keep) checked against
                               arrangement/reference.js's real per-stage percentile bands
                               from G6's own training corpus. This bounds what the plan
                               TARGETS, not what a later hand-arranged realization with
                               invented fills would actually contain.
     - arr.melody_retention    a plan requires melodyConf/bassConf above a threshold before
     - arr.bass_retention      trusting G7a's identification (degradeReason below) and
                               always keeps the identified voice's OWN real notes verbatim
                               when it keeps that role at all - but the fraction of the
                               ORIGINAL melodic content actually present in a REALIZED
                               arrangement (G8 may thin a kept voice further) is not
                               something a plan can measure.

     GENUINELY DEFERRED TO G8 (no plan-level proxy exists; not silently dropped, reported
     here and in §11 rather than claimed):
     - arr.no_invented_legato  articulation/slur content does not exist in a plan's shape at
                               all - there is no proxy for this at the plan level.
   ========================================================================== */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(
      require('../scoregraph/rational.js'), require('../scoregraph/time.js'),
      require('../songgraph/util.js'), require('../playability/reach.js'),
      require('./reference.js'), require('./texture.js'));
  } else {
    const SG = root.PPPScoreGraphModules || {};
    const SGG = root.PPPSongGraphModules || {};
    const PP = root.PPPPlayabilityModules || {};
    const M = root.PPPArrangementModules = root.PPPArrangementModules || {};
    M.plan = factory(SG.rational, SG.time, SGG.util, PP.reach, M.reference, M.texture);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (R, T, U, REACH, REF, TEX) {
  'use strict';

  const version = '0.1.0';

  /* Below this, G7a's own melody/bass identification (songgraph/voices.js) is not trusted
     enough to plan around confidently: real corpus evidence this threshold actually fires
     on, not a guessed number (arrangement/tools/corpus-check.js; §11 has the real count) -
     e.g. catalog/hymns/for-all-the-saints.musicxml's second part measures melodyConf=0.0,
     bassConf=0.0 (both voices trade the outer positions about equally often - a real,
     not synthetic, "no clear melody/bass" case). */
  const LOW_CONFIDENCE = 0.3;
  const HAND_SPLIT_MIDI = 60; /* middle C: the default RH/LH register split (G6a's own
     one-staff-piano-is-RH convention has no equivalent split point to reuse - documented
     here as G7b's own choice, same spirit as reach.js's cited-where-possible, declared-
     where-not numbers). */

  function fail(reason, detail) { return { ok: false, reason: reason, detail: detail || null }; }

  /* ---- small real helpers over a ScoreGraph, none of which duplicate G7a's algorithms -
     just its exported util.js primitives, scoped to one section instead of the whole piece
     (G7a's melodyBass/voiceRoles/harmony are whole-part passes, not section-scoped; see
     the design doc's §11 for why re-deriving THAT scoping here, rather than inside G7a's
     already-reviewed modules, is the right boundary). ---- */

  function beatsOf(g, m) {
    let meter = null;
    try { meter = T.meterAt(g, m.id); } catch (e) { meter = null; }
    if (!meter) return R.toNumber(R.parse(m.dur)) * 4;
    return T.groups(meter).length;
  }

  function sectionMeasures(g, section) {
    const ms = g.timeline.measures;
    const i0 = ms.findIndex(m => m.id === section.from);
    const i1 = ms.findIndex(m => m.id === section.to);
    if (i0 < 0 || i1 < 0 || i1 < i0) return [];
    return ms.slice(i0, i1 + 1);
  }

  function sectionBeats(g, ms) { return ms.reduce((s, m) => s + beatsOf(g, m), 0); }

  function distinctOnsets(notes) {
    const seen = new Map();
    notes.forEach(n => { const k = R.format(n.w0); if (!seen.has(k)) seen.set(k, n.w0); });
    return Array.from(seen.values()).sort((a, b) => R.cmp(a, b));
  }

  /* {span, count}: the widest simultaneous interval and largest simultaneous note count
     these notes ever produce together - sampled at every distinct onset among them, which
     is sufficient (the sounding count only changes at an onset or an offset, so its maximum
     always occurs immediately after some onset - the same principle songgraph/voices.js's
     perPartVoiceStats already relies on). */
  function maxSimultaneous(notes) {
    if (!notes.length) return { span: 0, count: 0 };
    let span = 0, count = 0;
    distinctOnsets(notes).forEach(w => {
      const here = U.soundingAt(notes, w);
      if (!here.length) return;
      const midis = here.map(n => n.midi);
      span = Math.max(span, Math.max.apply(null, midis) - Math.min.apply(null, midis));
      count = Math.max(count, here.length);
    });
    return { span: span, count: count };
  }

  /* Real attacks/beat for these notes (distinct onsets / beats) - the SAME definition
     difficulty/features.js's notesPerBeatRH/LH uses (pb(attacks)). */
  function notesPerBeat(notes, beats) { return beats > 0 ? distinctOnsets(notes).length / beats : 0; }

  /* A real, declared-approximate proxy for difficulty/features.js's chordLoad ("extra keys
     struck together, per beat"): sum over onsets of max(0, simultaneous count - 1), per
     beat. Not the identical computation (features.js's chordLoad is per-attack across the
     WHOLE hand's real attack stream with its own onset/offbeat bucketing; this is the same
     idea applied to a section's retained voices) - close enough in the same units to compare
     against reference.js's real chordLoad band, not claimed to be bit-identical. */
  function extraKeysPerBeat(notes, beats) {
    if (!(beats > 0) || !notes.length) return 0;
    let sum = 0;
    distinctOnsets(notes).forEach(w => { sum += Math.max(0, U.soundingAt(notes, w).length - 1); });
    return sum / beats;
  }

  function registerOf(notes) {
    if (!notes.length) return null;
    const midis = notes.map(n => n.midi);
    return { lo: Math.min.apply(null, midis), hi: Math.max.apply(null, midis) };
  }

  function mean(xs) { return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null; }

  /* ---- request / part / section resolution ---- */

  function defaultKeyOf(g) {
    const k = (g.timeline.keys || [])[0];
    return k ? { fifths: k.fifths, mode: k.mode || 'major' } : { fifths: 0, mode: 'major' };
  }

  function pickPart(g, request) {
    if (request.part) { const p = g.parts.find(x => x.id === request.part); if (p) return p; }
    return g.parts.slice().sort((a, b) => b.voices.length - a.voices.length || (a.id < b.id ? -1 : 1))[0];
  }

  function resolveSections(sg, request) {
    if (!request.sections || request.sections === 'all') return sg.sections.slice();
    const wanted = new Set(request.sections);
    const found = sg.sections.filter(s => wanted.has(s.label));
    return found;
  }

  /* ---- one section ---- */

  /* ---- the relaxed pass (docs/GOALS/G09 §12 "G9e refusals") ----
     `opts.relax` (0 = off, the default and the exact behaviour above; 1 or 2) is for a caller that WILL keep one note per hand (candidates/ with
     singleNoteHands): the strict checks below measure the SOURCE notes of the retained voices, but the realizer then thins every hand to one note
     at every onset, so a dense piano cover (a hand holding an octave plus a chord, six or more keys, two voices a tenth apart) was refused for chords
     that would never be played. A section is planned STRICT first, with exactly the search above, and only when no rung of the strict search fits does
     a relaxed search run, for that section only:
       relax 1  reach and chordLoad on the THINNED view: a hand's simultaneous count is min(count, 1) and its span 0, extra keys per beat 0; the density
                ceilings (notes per beat, range, key signature) are the strict ones;
       relax 2  also the density ceiling at the stage's real MAXIMUM (band.notesPerBeatRH/LH.max instead of p90) and the range ceiling dropped (a one-note
                hand over a wide range is played with 8va/8vb marks and a hand move, not a stretch);
     relax 3  (G10c-1a, the lead sheet of a recording: docs/GOALS/G10 section 33.5; only a caller that asks for it) the ceilings the arranger cannot act on, on the FLOOR rung only
                (nothing left to drop: the melody alone, or the melody and bass): the key signature ceiling (a piece heard in B major or G flat major has 5 or 6 accidentals at every
                level and the arranger does not transpose) and the right hand's density ceiling (the melody is copied verbatim, so no level can thin it); the left hand's density and the
                chord load stay checked. The section says so (`relaxed: 3`) and the output can read harder than the requested level, as at relax 2.
     A section planned with a relaxed search carries `relaxed: 1 | 2`, and so does the plan (the highest tier any section needed). A strict plan has
     neither field, so its object is what it always was. Nothing else changes: no voice is invented, the melody/bass identification is G7a's. */
  const THIN_SIM = sim => ({ span: 0, count: Math.min(1, sim.count) });

  function planSection(g, sg, section, partId, request, refBands, stage, relax) {
    relax = relax === 1 || relax === 2 || relax === 3 ? relax : 0;
    const mbAll = sg.melodyBass.parts.find(p => p.part === partId);
    const rolesAll = sg.voiceRoles.parts.find(p => p.part === partId);
    if (!mbAll || !rolesAll || !rolesAll.roles.length) return fail('NO_VOICES', { part: partId });

    const nVoices = rolesAll.roles.length;
    const degradeConf = nVoices >= 2 && (mbAll.melodyConf < LOW_CONFIDENCE || (mbAll.bassVoice != null && mbAll.bassConf < LOW_CONFIDENCE));
    const confidenceTier = degradeConf ? 'low' : (Math.min(mbAll.melodyConf, mbAll.bassVoice != null ? mbAll.bassConf : 1) < 0.6 ? 'medium' : 'high');

    const ms = sectionMeasures(g, section);
    if (!ms.length) return fail('BAD_SECTION_SPAN', { section: section });
    const measureIds = new Set(ms.map(m => m.id));
    const beats = sectionBeats(g, ms);
    const allNotes = U.noteWindows(g, { part: partId }).filter(n => measureIds.has(n.m));

    const ladder = TEX.ladder(rolesAll.roles, mbAll);
    const maxExtra = degradeConf ? 0 : TEX.startExtraForStage(stage);
    const rungs = TEX.rungsFrom(ladder, maxExtra);

    const attempts = [];
    const tiers = relax === 3 ? [0, 1, 2, 3] : relax === 2 ? [0, 1, 2] : relax === 1 ? [0, 1] : [0]; /* strict first; a relaxed tier only when no rung fits the one before it */
    for (const tier of tiers) for (const rung of rungs) {
      const voiceNotes = new Map(rung.voiceIds.map(v => [v, allNotes.filter(n => n.voiceId === v)]));
      /* Hand assignment is by each RETAINED voice's own real register in this section
         (higher -> RH, lower -> LH), not by role label - this stays correct even when
         melody/bass confidence is low (a role label can be wrong; a real average pitch
         cannot cross itself). A voice silent in this section (a real rest throughout, not
         a gap in the data) falls back to its whole-piece average from G7a's own melodyBass
         output - still real data, just not section-scoped. */
      const avg = new Map();
      rung.voiceIds.forEach(v => {
        const notes = voiceNotes.get(v);
        if (notes.length) { avg.set(v, mean(notes.map(n => n.midi))); return; }
        const whole = mbAll.voices.find(x => x.voice === v);
        avg.set(v, whole && whole.avgMidi != null ? whole.avgMidi : HAND_SPLIT_MIDI);
      });
      const hands = { RH: [], LH: [] };
      rung.voiceIds.slice().sort((a, b) => (avg.get(b) - avg.get(a)) || (a < b ? -1 : 1)).forEach(v => {
        hands[avg.get(v) >= HAND_SPLIT_MIDI ? 'RH' : 'LH'].push(v);
      });
      /* relaxed tiers only: keep the hands in order. With both voices on one side of middle C the split above leaves one hand empty, and realize/index.js rebalanceHands then moves the
         LOWER voice of the busy hand across: right for two voices in RH (the bass goes to LH), but with both in LH it puts the bass in the RIGHT hand under the melody in the left (a
         crossing: the right hand below the left at 20-40% of the moments on hanon/007, 008, 009...). The strict tier never gets this far for such a section (its reach check refuses two
         voices an octave apart), so only the relaxed tiers do the split themselves, in the direction that keeps RH above LH: the lowest voice of an all-RH section goes to LH, the
         highest voice of an all-LH section goes to RH. (A strict section is unchanged: its output is byte for byte what it was.) */
      if (tier >= 1) {
        if (hands.LH.length === 0 && hands.RH.length >= 2) hands.LH.push(hands.RH.pop());
        else if (hands.RH.length === 0 && hands.LH.length >= 2) hands.RH.push(hands.LH.shift());
      }

      const notesFor = hand => hands[hand].reduce((acc, v) => acc.concat(voiceNotes.get(v)), []);
      const rhNotes = notesFor('RH'), lhNotes = notesFor('LH');
      const rhSim = tier >= 1 ? THIN_SIM(maxSimultaneous(rhNotes)) : maxSimultaneous(rhNotes);
      const lhSim = tier >= 1 ? THIN_SIM(maxSimultaneous(lhNotes)) : maxSimultaneous(lhNotes);
      const profile = REACH.profileOf(request.handProfile);
      const maxSpan = REACH.MAX_SPAN[profile], maxKeys = REACH.MAX_KEYS;
      const reachOk = rhSim.span <= maxSpan && lhSim.span <= maxSpan && rhSim.count <= maxKeys && lhSim.count <= maxKeys;

      const npbRH = notesPerBeat(rhNotes, beats), npbLH = notesPerBeat(lhNotes, beats);
      const chordLoad = tier >= 1 ? 0 : extraKeysPerBeat(rhNotes, beats) + extraKeysPerBeat(lhNotes, beats);
      const allRegNotes = rhNotes.concat(lhNotes);
      const reg = registerOf(allRegNotes);
      const range = reg ? reg.hi - reg.lo : 0;
      const keyLoad = Math.abs((request.key || {}).fifths || 0);

      /* Ceilings: p90 of the REAL per-stage corpus for the two continuous features
         (range, notesPerBeatRH/LH), but the real MAX for chordLoad/keyLoad - both are
         zero for the large majority of real pieces at the lower stages (measured:
         stage 1's real chordLoad p50=p90=0, only 1 of 54 anchors is ever nonzero), so a
         p90 ceiling of exactly 0 would reject ANY real chord at all, which the corpus
         itself disproves (that one real Beyer piece has chordLoad 1.16 and is still a
         real, committed stage-1 piece). Using the real max instead keeps this a genuine
         "a real piece at this stage has done this" bound rather than a degenerate one. */
      const band = refBands;
      const densityOk = !band || (tier >= 3 && rung.extraKept === 0 ? (
        npbLH <= band.notesPerBeatLH.max && chordLoad <= band.chordLoad.max
      ) : tier >= 2 ? (
        npbRH <= band.notesPerBeatRH.max && npbLH <= band.notesPerBeatLH.max &&
        chordLoad <= band.chordLoad.max && keyLoad <= band.keyLoad.max
      ) : (
        npbRH <= band.notesPerBeatRH.p90 && npbLH <= band.notesPerBeatLH.p90 &&
        chordLoad <= band.chordLoad.max && range <= band.range.p90 && keyLoad <= band.keyLoad.max
      ));

      const attempt = {
        tier: rung.tier, extraKept: rung.extraKept, dropped: rung.dropped,
        hands: hands, reach: { ok: reachOk, profile: profile, maxSpan: maxSpan, maxKeys: maxKeys, RH: rhSim, LH: lhSim, comfortSpan: REACH.COMFORT_SPAN[profile] },
        budget: { ok: densityOk, notesPerBeatRH: npbRH, notesPerBeatLH: npbLH, chordLoad: chordLoad, range: range, keyLoad: keyLoad, band: band },
        registerRH: registerOf(rhNotes), registerLH: registerOf(lhNotes)
      };
      if (tier > 0) attempt.relaxed = tier;
      attempts.push(attempt);
      if (reachOk && densityOk) {
        return Object.assign({
          ok: true,
          section: { from: section.from, to: section.to, label: section.label },
          confidenceTier: confidenceTier, degraded: degradeConf,
          melody: { part: partId, voice: mbAll.melodyVoice, confidence: mbAll.melodyConf },
          bass: mbAll.bassVoice != null ? { part: partId, voice: mbAll.bassVoice, confidence: mbAll.bassConf } : null,
          texture: attempt.tier, voices: rung.voiceIds, dropped: rung.dropped, hands: hands,
          voicing: {
            maxNotesPerHand: { RH: attempt.reach.RH.count, LH: attempt.reach.LH.count },
            registerRH: attempt.registerRH, registerLH: attempt.registerLH,
            maxSpan: { RH: attempt.reach.RH.span, LH: attempt.reach.LH.span }
          },
          density: attempt.budget,
          attempts: attempts,
          explanation: explainSection(section, attempt, mbAll, confidenceTier, degradeConf, stage, request)
        }, tier > 0 ? { relaxed: tier } : {});
      }
    }
    return fail('UNREACHABLE', { section: section, part: partId, handProfile: request.handProfile, attempts: attempts });
  }

  function fmtReg(reg) { return reg ? (reg.lo + '-' + reg.hi + ' MIDI') : 'silent'; }

  function explainSection(section, attempt, mb, confidenceTier, degraded, stage, request) {
    const parts = [];
    parts.push('Section ' + section.label + ' (measures ' + section.from + '-' + section.to + '): kept ' +
      (attempt.hands.RH.length + attempt.hands.LH.length) + ' of the part\'s real voices (' +
      attempt.tier + ', ' + attempt.extraKept + ' extra voice(s) beyond melody/bass' +
      (attempt.dropped.length ? ', dropped ' + attempt.dropped.join(',') : '') + ').');
    parts.push('RH ' + attempt.hands.RH.join(',') + ' register ' + fmtReg(attempt.registerRH) +
      ', span ' + attempt.reach.RH.span + '/' + attempt.reach.maxSpan + ' semitones, ' + attempt.reach.RH.count + ' notes max.');
    parts.push('LH ' + attempt.hands.LH.join(',') + ' register ' + fmtReg(attempt.registerLH) +
      ', span ' + attempt.reach.LH.span + '/' + attempt.reach.maxSpan + ' semitones, ' + attempt.reach.LH.count + ' notes max ' +
      '(' + attempt.reach.profile + ' hand profile).');
    if (attempt.budget.band) {
      parts.push('Difficulty budget vs. G6 stage ' + stage + (attempt.budget.band.extrapolated ? ' (extrapolated from stage ' + attempt.budget.band.fallbackStage + ', no real stage-' + stage + ' anchors)' : '') +
        ': RH ' + attempt.budget.notesPerBeatRH.toFixed(2) + '<=' + attempt.budget.band.notesPerBeatRH.p90.toFixed(2) +
        ' notes/beat, LH ' + attempt.budget.notesPerBeatLH.toFixed(2) + '<=' + attempt.budget.band.notesPerBeatLH.p90.toFixed(2) +
        ' notes/beat, range ' + attempt.budget.range + '<=' + attempt.budget.band.range.p90 + ' semitones (p90 of ' + attempt.budget.band.n + ' real method-book pieces).');
    }
    if (attempt.relaxed) {
      parts.push('RELAXED (relax ' + attempt.relaxed + '): no rung fit the strict search, so this section was planned for a caller that keeps one note per hand - reach and chord load on the thinned view' +
        (attempt.relaxed >= 2 ? ', density ceiling at the stage maximum, range ceiling dropped' : '') + (attempt.relaxed >= 3 ? ', key signature and right-hand density ceilings dropped (floor rung)' : '') + '; the output can read harder than the requested level.');
    }
    if (degraded) {
      parts.push('DEGRADED: melody confidence ' + mb.melodyConf.toFixed(2) + (mb.bassVoice != null ? ', bass confidence ' + mb.bassConf.toFixed(2) : '') +
        ' is below G7b\'s ' + LOW_CONFIDENCE + ' threshold - G7a\'s voice identification is not trusted here; forced to the simplest (melody+bass only) texture regardless of the requested level.');
    } else if (confidenceTier === 'medium') {
      parts.push('Melody/bass confidence is moderate (' + mb.melodyConf.toFixed(2) + '/' + (mb.bassVoice != null ? mb.bassConf.toFixed(2) : 'n/a') + ') - plan followed normally, flagged for awareness.');
    }
    return parts.join(' ');
  }

  /* ---- request validation ---- */

  function validateRequest(request) {
    if (!request || typeof request !== 'object') return fail('BAD_REQUEST', 'request must be an object');
    if (typeof request.targetLevel !== 'number' || !Number.isFinite(request.targetLevel)) return fail('BAD_REQUEST', 'targetLevel must be a finite number (G6 course position)');
    if (REACH.PROFILES.indexOf(request.handProfile) < 0) return fail('BAD_REQUEST', 'handProfile must be one of ' + REACH.PROFILES.join(', '));
    return { ok: true };
  }

  /* ---- entry point ---- */

  function plan(g, sg, request, opts) {
    opts = opts || {};
    const v = validateRequest(request);
    if (!v.ok) return v;
    /* `style` is part of ArrangementRequest's declared shape (design doc §4) and is accepted
       and carried through to the plan, but has NO effect on the search today: G7a's texture
       vocabulary is a voice-role retention ladder (arrangement/texture.js's header), and
       nothing in G7a's output distinguishes a "style" without inventing a feature nobody
       has evaluated - reported here plainly rather than silently ignored or faked. */
    request = Object.assign({ style: 'default', key: defaultKeyOf(g) }, request);

    const part = pickPart(g, request);
    if (!part) return fail('NO_PART', null);

    const sections = resolveSections(sg, request);
    if (!sections.length) return fail('NO_SECTIONS', { requested: request.sections || 'all' });

    const ref = REF.ref(opts.reference);
    const stage = ref.stageForPosition(request.targetLevel);
    const band = REF.bandsForStage(stage, opts.reference);

    const planned = [];
    for (const section of sections) {
      const r = planSection(g, sg, section, part.id, request, band, stage, opts.relax);
      if (!r.ok) return fail(r.reason, Object.assign({ section: section }, r.detail));
      planned.push(r);
    }

    const degraded = planned.some(p => p.degraded);
    const relaxed = planned.reduce((m, p) => Math.max(m, p.relaxed || 0), 0);
    return {
      ok: true,
      plan: Object.assign({
        version: version,
        request: request,
        part: part.id,
        stage: stage,
        band: band,
        sections: planned,
        degraded: degraded,
        deferredToG8: ['arr.no_invented_legato', 'arr.invented_pitches=0 (realized)', 'arr.metre_preserved (realized)',
          'arr.tempo_preserved (realized)', 'arr.melody_retention (realized fraction)', 'arr.bass_retention (realized fraction)',
          'arr.density_ratio (realized value)']
      }, relaxed ? { relaxed: relaxed } : {})
    };
  }

  return Object.freeze({
    version: version, LOW_CONFIDENCE: LOW_CONFIDENCE, HAND_SPLIT_MIDI: HAND_SPLIT_MIDI,
    plan: plan, validateRequest: validateRequest, defaultKeyOf: defaultKeyOf, pickPart: pickPart,
    resolveSections: resolveSections, planSection: planSection,
    maxSimultaneous: maxSimultaneous, notesPerBeat: notesPerBeat, extraKeysPerBeat: extraKeysPerBeat,
    sectionMeasures: sectionMeasures, sectionBeats: sectionBeats
  });
});
