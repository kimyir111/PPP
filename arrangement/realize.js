/* ============================================================================
   PPP Arrangement Realizer (G8a, docs/GOALS/G08_ARRANGEMENT_REALIZATION.md §6a)

   realize(g, sg, plan, opts) -> {ok: true, graph} | {ok: false, reason, detail}

   Turns a G7b ArrangementPlan (arrangement/plan.js's `plan` field of an {ok:true} result)
   into a real, playable two-staff piano ScoreGraph: a BRAND NEW graph built with
   scoregraph/build.js's builder (never an edit of the input `g` in place - G7b's plan can
   drop voices and reassign hands, so the realized piece's own voice/part shape genuinely
   differs from the source; building fresh, one piano part/two staves, sidesteps the
   ambiguity of editing a source that may have used a completely different part layout, e.g.
   two already-separate RH/LH parts for a method-book piece vs. one multi-voice part for a
   hymn - see this file's header note on scope below).

   Per planned section: the plan's own declared melody voice (G7a's real melodyVoice, G7b's
   `section.melody.voice`) is copied VERBATIM into whichever hand the plan assigned it to -
   G8a invents no melody pitch, ever (real simultaneous heads of one melody event - a chord
   in the melody line itself - are kept together as one realized chord event, not split into
   overlapping single notes). The OTHER hand (the accompaniment hand) is realized from a
   chosen pattern (arrangement/patterns.js) driven by the section's real per-beat harmony
   (songgraph/harmony.js's harmonyOf, already computed by G7a) and the plan's own real
   per-hand note budget (`section.voicing.maxNotesPerHand`) and register
   (`registerRH`/`registerLH`) - G7b already verified that many simultaneous notes fits G5's
   reach table and G6's difficulty band for this hand; voicing.js's clampToReach is the
   safety net for the SPECIFIC register/voicing this realizer chooses (the plan only ever
   checked the retained voice COUNT, never a specific register a pattern would place).

   Scope decision (disclosed, not hidden - see the design doc's implementation record): if
   the plan also retains an extra voice in the SAME hand as the melody (real for some
   full-texture hymn sections, e.g. soprano+alto both in the RH), v1 does not separately
   realize that extra voice - the melody hand plays only the declared melody line. This is a
   genuine scope narrowing versus everything G7b's plan technically allows; the evaluation
   harness (arrangement/tools/eval-harness.js) reports how often it actually applies to the
   real corpus sample it measures, rather than leaving it unmeasured.
   If a hand retains NO voices at all (plan.section.hands[accompHand].length === 0 - a
   melody-only or reduced-to-one-voice section), that hand is left silent (rests), never
   given an invented accompaniment the plan never budgeted reach/difficulty for.

   Fingering: playability/fingering.js's real solveGraph/write (G5b), not re-derived here.
   Provenance: the whole graph's `provenance.default` is {src: <a real registered Source
   {kind:'generator', tool:'ppp.arrangement.realize', version}>, op: 'generated'} - checked
   against scoregraph/schema.js directly (ProvRef.src is T.ref(['sr']), Source needs
   {id,kind,tool,version}; there is no per-event prov needed beyond the graph-level default
   since every event here is equally 'generated', the same shape tests/scoregraph/g3-
   helpers.js's own mk() fixture builder uses for its one fixed source). */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(
      require('../scoregraph/rational.js'), require('../scoregraph/time.js'), require('../scoregraph/build.js'),
      require('../songgraph/util.js'), require('../playability/reach.js'), require('../playability/fingering.js'),
      require('./plan.js'), require('./voicing.js'), require('./patterns.js'), require('./spell.js'));
  } else {
    const SG = root.PPPScoreGraphModules || {};
    const SGG = root.PPPSongGraphModules || {};
    const PP = root.PPPPlayabilityModules || {};
    const M = root.PPPArrangementModules = root.PPPArrangementModules || {};
    M.realize = factory(SG.rational, SG.time, SG.build, SGG.util, PP.reach, PP.fingering, M.plan, M.voicing, M.patterns, M.spell);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (R, T, Build, U, REACH, FINGERING, PLANJS, V, PATTERNS, SPELL) {
  'use strict';

  const VERSION = '0.1.0';

  function fail(reason, detail) { return { ok: false, reason: reason, detail: detail || null }; }

  function otherHand(h) { return h === 'RH' ? 'LH' : 'RH'; }

  function measureSpansOf(g) {
    let acc = R.ZERO;
    return g.timeline.measures.map(m => {
      const start = acc;
      acc = R.add(acc, R.parse(m.dur));
      return { id: m.id, dur: m.dur, start: start, end: acc };
    });
  }
  function findMeasure(spans, w) {
    for (let i = 0; i < spans.length; i++) if (R.ge(w, spans[i].start) && R.lt(w, spans[i].end)) return spans[i];
    return spans[spans.length - 1];
  }

  /* melody noteWindows entries -> [{w0, w1, midis:[...]}], one group per source EVENT (a chord in
     the melody voice keeps its heads together, never split into overlapping single-pitch notes -
     the E-VOICE-OVERLAP bug a first version of this file hit on a real hymn's occasional unison/
     third-doubled soprano beat). */
  function groupByEvent(notes) {
    const byEvent = new Map();
    notes.forEach(n => {
      if (!byEvent.has(n.eventId)) byEvent.set(n.eventId, { w0: n.w0, w1: n.w1, midis: [] });
      byEvent.get(n.eventId).midis.push(n.midi);
    });
    return Array.from(byEvent.values()).sort((a, b) => R.cmp(a.w0, b.w0));
  }

  /* One or more note/rest events covering [w0, w1), split at every measure boundary it crosses
     (an event never spans two measures in this schema - see the header). */
  function emitChunked(b, part, voice, staff, w0, w1, midis, spans, idOf, fifths) {
    let cur = w0;
    while (R.lt(cur, w1)) {
      const sp = findMeasure(spans, cur);
      const chunkEnd = R.lt(w1, sp.end) ? w1 : sp.end;
      const dur = R.sub(chunkEnd, cur);
      if (R.gt(dur, R.ZERO)) {
        const ev = { kind: midis && midis.length ? 'note' : 'rest', m: idOf.get(sp.id), at: R.format(R.sub(cur, sp.start)), dur: R.format(dur), voice: voice, staff: staff, display: V.wToDisplay(dur) };
        if (midis && midis.length) ev.heads = midis.map(mm => ({ pitch: SPELL.spellMidi(mm, fifths) }));
        b.event(part, ev);
      }
      cur = chunkEnd;
    }
  }

  function centerOf(reg, hand) {
    if (reg) return Math.round((reg.lo + reg.hi) / 2);
    return hand === 'LH' ? 48 : 72;
  }

  /* Real finding (docs/GOALS/G08_ARRANGEMENT_REALIZATION.md §14): songgraph/util.js's beatGrid
     always emits every one of the METER's own beat groups for a measure, even when that measure's
     own real `dur` is shorter (a pickup/anacrusis measure, `implicit: true`, real corpus example:
     catalog/hymns/o-come-emmanuel.musicxml's 1-beat measure 1 under a 4/4 meter). G7a's existing
     consumers (harmony/voices/energy) only ever key off `{m, beat}`, so the resulting overshoot
     into the NEXT measure's absolute position was never a problem for them; G8a's note placement
     needs a real, non-overlapping absolute timeline, so every harmony window used here is clipped
     to its own measure's REAL span (from this file's own `spans`, computed the same simple way
     scoregraph/time.js's ctx() does) before being handed to a pattern - a window that overshoots
     is trimmed, and one that lands entirely past its measure's real end is dropped. This is a
     defensive adaptation in G8a only; songgraph/ itself is untouched (out of scope, read-only
     consumption per the design doc §10). */
  function clipWindowsToMeasures(windows, spans) {
    const byId = new Map(spans.map(s => [s.id, s]));
    const out = [];
    windows.forEach(w => {
      const sp = byId.get(w.m);
      if (!sp) return;
      const w0 = R.gt(w.w0, sp.start) ? w.w0 : sp.start;
      const w1 = R.lt(w.w1, sp.end) ? w.w1 : sp.end;
      if (R.gt(w1, w0)) out.push(Object.assign({}, w, { w0: w0, w1: w1 }));
    });
    return out;
  }

  function realize(g, sg, plan, opts) {
    opts = opts || {};
    if (!plan || !Array.isArray(plan.sections) || !plan.sections.length) return fail('BAD_PLAN', 'plan.sections is empty');
    const part = g.parts.find(p => p.id === plan.part);
    if (!part) return fail('NO_PART', plan.part);
    const fifths = (plan.request && plan.request.key && plan.request.key.fifths) || 0;
    const profile = REACH.profileOf((plan.request || {}).handProfile);
    const spans = measureSpansOf(g);

    const b = Build.builder({ id: (opts.id || (g.id || 'g') + '-g8a'), meta: Object.assign({}, g.meta || {}) });
    const src = b.source({ kind: 'generator', tool: 'ppp.arrangement.realize', version: VERSION });
    b.setDefault({ src: src.id, op: 'generated' });
    const newPart = b.part({ name: (part.name || 'Piano'), instrument: part.instrument || { kind: 'piano', family: 'keyboard' } });
    const rhStaff = b.staff(newPart, { limb: 'RH' }).id;
    const lhStaff = b.staff(newPart, { limb: 'LH' }).id;
    const rhVoice = b.voice(newPart, { staff: rhStaff, label: '1' }).id;
    const lhVoice = b.voice(newPart, { staff: lhStaff, label: '5' }).id;
    const VOICE = { RH: rhVoice, LH: lhVoice }, STAFF = { RH: rhStaff, LH: lhStaff };

    /* one flat, ordered, non-overlapping list of the original measures every planned section covers
       (G07's sectionsOf partitions the whole piece in time order, §11's implementation record) */
    const origMeasures = [];
    plan.sections.forEach(sec => { PLANJS.sectionMeasures(g, sec.section).forEach(m => origMeasures.push(m)); });
    if (!origMeasures.length) return fail('NO_MEASURES', null);

    const idOf = new Map();
    origMeasures.forEach((m, i) => { const nm = b.measure({ number: String(i + 1), dur: m.dur }); idOf.set(m.id, nm.id); });
    const firstOrig = origMeasures[0].id, firstNew = idOf.get(firstOrig);

    /* meter/key/tempo: the effective one at the realized range's own start, then every real change
       strictly inside the realized range, verbatim on functional fields only - display-only fields
       (symbol, hidden, mark, display) and KeyEvent.scope (a part/staff reference into the OLD graph,
       meaningless in the new one - this realizer always writes one unscoped, piece-wide key) are
       deliberately dropped, not copied blind. */
    const firstIdx = g.timeline.measures.findIndex(m => m.id === firstOrig);
    const effectiveMeter = T.meterAt(g, firstOrig) || { beats: [4], beatType: 4 };
    b.meter({ m: firstNew, beats: effectiveMeter.beats, beatType: effectiveMeter.beatType });
    (g.timeline.meters || []).forEach(mt => { if (idOf.has(mt.m) && mt.m !== firstOrig) b.meter({ m: idOf.get(mt.m), beats: mt.beats, beatType: mt.beatType }); });

    const keysBefore = (g.timeline.keys || []).filter(k => !k.scope && g.timeline.measures.findIndex(m => m.id === k.m) <= firstIdx);
    const effectiveKey = keysBefore.length ? keysBefore[keysBefore.length - 1] : { fifths: fifths, mode: 'major' };
    b.key({ m: firstNew, at: '0', fifths: effectiveKey.fifths, mode: effectiveKey.mode || 'major' });
    (g.timeline.keys || []).forEach(k => { if (!k.scope && idOf.has(k.m) && k.m !== firstOrig) b.key({ m: idOf.get(k.m), at: k.at, fifths: k.fifths, mode: k.mode || 'major' }); });

    const temposBefore = (g.timeline.tempos || []).filter(t => t.qpm && g.timeline.measures.findIndex(m => m.id === t.m) <= firstIdx);
    const effectiveTempo = temposBefore.length ? temposBefore[temposBefore.length - 1].qpm : '120';
    b.tempo({ m: firstNew, at: '0', qpm: effectiveTempo });
    (g.timeline.tempos || []).forEach(t => { if (t.qpm && idOf.has(t.m) && t.m !== firstOrig) b.tempo({ m: idOf.get(t.m), at: t.at, qpm: t.qpm }); });

    b.clef(newPart, { staff: rhStaff, m: firstNew, at: '0', sign: 'G' });
    b.clef(newPart, { staff: lhStaff, m: firstNew, at: '0', sign: 'F' });

    /* melody, verbatim, per section */
    const carriedAccomp = { RH: null, LH: null };
    let extraVoiceInMelodyHandCount = 0;

    plan.sections.forEach(sec => {
      const ms = PLANJS.sectionMeasures(g, sec.section);
      if (!ms.length) return;
      const sectionStart = spans.find(s => s.id === ms[0].id).start;
      const sectionEnd = spans.find(s => s.id === ms[ms.length - 1].id).end;
      const melodyHand = (sec.hands.RH || []).indexOf(sec.melody.voice) >= 0 ? 'RH' : 'LH';
      const accompHand = otherHand(melodyHand);
      if ((sec.hands[melodyHand] || []).length > 1) extraVoiceInMelodyHandCount++;

      /* melody hand: the plan's own real melody voice, verbatim, rests filling any real silence */
      const measureIds = new Set(ms.map(m => m.id));
      const melodyRaw = U.noteWindows(g, { part: plan.part }).filter(n => n.voiceId === sec.melody.voice && measureIds.has(n.m));
      const melodyNotes = groupByEvent(melodyRaw);
      let cursor = sectionStart;
      melodyNotes.forEach(n => {
        if (R.lt(cursor, n.w0)) emitChunked(b, newPart, VOICE[melodyHand], STAFF[melodyHand], cursor, n.w0, null, spans, idOf, fifths);
        emitChunked(b, newPart, VOICE[melodyHand], STAFF[melodyHand], n.w0, n.w1, n.midis, spans, idOf, fifths);
        cursor = n.w1;
      });
      if (R.lt(cursor, sectionEnd)) emitChunked(b, newPart, VOICE[melodyHand], STAFF[melodyHand], cursor, sectionEnd, null, spans, idOf, fifths);

      /* accompaniment hand: the chosen pattern over the section's real per-beat harmony, or silence
         when the plan retained no voice there at all (never an invented, unbudgeted accompaniment) */
      const accompVoices = sec.hands[accompHand] || [];
      const n = accompVoices.length ? Math.min(REACH.MAX_KEYS, Math.max(1, (sec.voicing.maxNotesPerHand || {})[accompHand] || accompVoices.length)) : 0;
      if (n === 0) {
        emitChunked(b, newPart, VOICE[accompHand], STAFF[accompHand], sectionStart, sectionEnd, null, spans, idOf, fifths);
        return;
      }
      const style = PATTERNS.STYLES.indexOf((plan.request || {}).style) >= 0 ? plan.request.style : 'block';
      const reg = accompHand === 'RH' ? sec.voicing.registerRH : sec.voicing.registerLH;
      const windows = clipWindowsToMeasures(sg.harmony.filter(h => measureIds.has(h.m)), spans);
      const groups = PATTERNS.realizeStyle(style, windows, { n: n, center: centerOf(reg, accompHand), profile: profile, prevMidis: carriedAccomp[accompHand] });
      groups.forEach(gr => {
        emitChunked(b, newPart, VOICE[accompHand], STAFF[accompHand], gr.w0, gr.w1, gr.midis, spans, idOf, fifths);
        if (gr.midis && gr.midis.length) carriedAccomp[accompHand] = gr.midis;
      });
    });

    let sealed;
    try { sealed = b.finish(); } catch (e) { return fail('SEAL_FAILED', String(e && e.message || e)); }
    let graph = sealed.graph;
    try {
      const solved = FINGERING.solveGraph(graph);
      graph = FINGERING.write(graph, solved.results).graph;
    } catch (e) { /* fingering is best-effort here (G5b's own DP has its own edge cases); the notes themselves are already sealed and valid */ }

    return {
      ok: true, graph: graph,
      meta: { sections: plan.sections.length, style: (plan.request || {}).style || 'default', extraVoiceInMelodyHandSections: extraVoiceInMelodyHandCount }
    };
  }

  return Object.freeze({ version: VERSION, realize: realize, measureSpansOf: measureSpansOf });
});
