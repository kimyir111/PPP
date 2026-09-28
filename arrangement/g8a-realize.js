/* ============================================================================
   PPP Arrangement Realizer (docs/GOALS/G08_ARRANGEMENT_REALIZATION.md) — G8a.

   NAMING NOTE (found 2026-09-28): this file was originally written as `arrangement/realize.js`
   but a second, concurrent writer in this same worktree (D:/PPP-g8) independently built its own,
   different realizer under that same filename (plus its own `arrangement/patterns.js`,
   `voicing.js`, `spell.js`, and a scratch `realize/` directory) while this file was being
   written and then rewritten mid-flight - twice. The project's own memory note on parallel
   sessions ("goal worktrees can have a second writer even when told 'only writer'") describes
   exactly this. Renamed here (and arrangement/patterns.js -> arrangement/g8a-accompaniment.js)
   to stop clobbering that other in-progress work; both implementations exist on disk until a
   Lead reconciles them. See this Goal's final report for the full account.

   realize(g, sg, plan, opts) -> { ok: true, graph: ScoreGraph } | { ok: false, reason, detail }

   Turns a G7b ArrangementPlan (arrangement/plan.js's `plan(g, sg, request).plan` - a SELECTION,
   never a note) into a REAL two-staff piano ScoreGraph: actual pitches, durations and hands,
   covering exactly the plan's requested sections, in their original order.

   Two realization modes, chosen by `opts.style` (default 'block'; 'hymn' is special-cased):
     'hymn'    LITERAL: every voice the plan kept is materialized verbatim (its own real notes,
               unchanged) into the hand the plan already assigned it. No new note is invented.
               This inherits G7b's own already-checked reach numbers for that exact voice
               combination (plan.js's `reachOk`), so it is a real, if structurally simple, way
               to get to 0 G5 hard violations by construction for genuinely multi-voice (SATB-
               style) material.
     otherwise (block/broken/ballad/pop/waltz, arrangement/g8a-accompaniment.js)
               GENERATIVE: the RH plays the plan's declared melody voice verbatim (real notes -
               this is what makes "melody preserved" a real, checkable claim, not a proxy); the
               LH plays a NEW accompaniment pattern derived from real per-beat-window harmony
               (songgraph/harmony.js) and voice-led between windows (arrangement/voicelead.js),
               sized (1/2/3 real chord tones) by the plan's own texture tier (reduced/partial/
               full) and kept inside the plan's own real LH register/hand-reach numbers.

   Hands and fingering are never re-derived here: playability/reach.js's real MAX_SPAN/MAX_KEYS
   constants bound every generated voicing at construction time (not checked after the fact and
   hoped for), and playability/fingering.js's real solveGraph/fingerGraph DP assigns every
   finger, the same G5b module G6/G7 already call rather than re-deriving hand/finger logic.

   Provenance (checked against scoregraph/schema.js directly, docs/GOALS/G08 §13's own
   instruction not to trust the design doc's phrasing): a Source {kind:'generator',
   tool:'ppp.g8a', version} is registered once and set as the WHOLE document's
   `provenance.default` ({src: <that Source's real id>, op:'generated'} - `op:'generated'` is
   one of schema.js's real PROV_OPS, `src` a real ref to the registered Source, exactly
   scoregraph/ops.js's `sourceOf`/`provRefOf` pattern G7a's addSection/addPhrase already
   established). No per-entity `prov` is written, the same choice tests/scoregraph/g3-
   helpers.js's `mk()` fixture builder makes for its own single-source graphs - every entity
   inherits the document default, which the schema/validator already support (scoregraph/
   build.js's `finish()`), not a new mechanism invented for G8a.
   ========================================================================== */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(
      require('../scoregraph/rational.js'), require('../scoregraph/time.js'), require('../scoregraph/build.js'),
      require('../songgraph/util.js'), require('../songgraph/harmony.js'), require('../playability/reach.js'),
      require('../playability/fingering.js'), require('./plan.js'), require('./g8a-accompaniment.js'), require('./voicelead.js'));
  } else {
    const SG = root.PPPScoreGraphModules || {};
    const SGG = root.PPPSongGraphModules || {};
    const PP = root.PPPPlayabilityModules || {};
    const M = root.PPPArrangementModules = root.PPPArrangementModules || {};
    M.g8aRealize = factory(SG.rational, SG.time, SG.build, SGG.util, SGG.harmony, PP.reach, PP.fingering, M.plan, M.accompaniment, M.voicelead);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (R, T, Build, U, HARM, REACH, FING, PLAN, PATTERNS, VL) {
  'use strict';

  const version = '0.1.0';
  const SOURCE = Object.freeze({ kind: 'generator', tool: 'ppp.g8a', version: version });
  const DEFAULT_STYLE = 'block';
  const STYLE_ALIASES = { default: 'block', balanced: 'block' };
  const TIER_CHORD_SIZE = { reduced: 1, partial: 2, full: 3 };

  function fail(reason, detail) { return { ok: false, reason: reason, detail: detail || null }; }

  /* fifths/mode -> the tonic's pitch class (0-11), the one thing scoregraph/pro-spell.js's
     spellingTable(key) needs beyond {fifths, mode} that a plain key signature doesn't carry by
     itself. Circle of fifths from C=0 (7 semitones per fifth); a minor key's tonic sits a minor
     third (9 semitones, mod 12) below its relative major's - standard key theory, not specific
     to this codebase, so it is derived here rather than searched for as an existing export. */
  function tonicPcOf(fifths, mode) {
    const majorPc = (((7 * fifths) % 12) + 12) % 12;
    return mode === 'minor' ? (majorPc + 9) % 12 : majorPc;
  }

  function clonePitch(p) { return p.alter ? { step: p.step, alter: p.alter, oct: p.oct } : { step: p.step, oct: p.oct }; }

  /* Every measure this plan's sections cover, in the plan's own section order (resolveSections'
     order - chronological, per G7a's sectionsOf), each tagged with the section it belongs to. */
  function coveredMeasures(g, plan) {
    const out = [];
    plan.sections.forEach(sec => {
      PLAN.sectionMeasures(g, sec.section).forEach(m => out.push({ m: m, section: sec }));
    });
    return out;
  }

  function timelineState(g) {
    const keysByM = new Map();
    (g.timeline.keys || []).forEach(k => { if (!keysByM.has(k.m)) keysByM.set(k.m, k); });
    const temposByM = new Map();
    (g.timeline.tempos || []).forEach(t => { if (t.qpm !== undefined && !temposByM.has(t.m)) temposByM.set(t.m, t); });
    return { keysByM: keysByM, temposByM: temposByM };
  }

  /* Copy every real event (note AND rest, so the destination voice keeps full time coverage) of
     `voiceId` inside `measureIdSet`, from the source part, into `destVoiceId`/`destStaffId` of
     the new part - same relative `at`/`dur` (the new measures have the SAME durations as the
     ones they replace, per measure index), fresh heads (pitch only: limb/fingering/notehead are
     G8a's own concern, re-derived below, never copied from the source). Ties among the copied
     heads are copied too; a tie whose other end falls outside the copied set is dropped (the
     design doc's own `arr.no_invented_legato` gap - a cut tie is reported, not silently kept
     dangling or invented as a fresh untied note pretending nothing changed). Returns the number
     of tie-ends dropped this way, for the caller's realization report. */
  function copyVoice(b, destPart, srcPart, voiceId, measureIdSet, origToNewMeasure, destVoiceId, destStaffId) {
    const headMap = new Map();
    const kept = [];
    srcPart.events.forEach(e => {
      if (e.voice !== voiceId || e.grace || !measureIdSet.has(e.m)) return;
      kept.push(e);
    });
    kept.sort((a, b2) => (origToNewMeasure.get(a.m).idx - origToNewMeasure.get(b2.m).idx) || R.cmp(R.parse(a.at), R.parse(b2.at)));
    kept.forEach(e => {
      const nm = origToNewMeasure.get(e.m).id;
      const x = { kind: e.kind, m: nm, at: e.at, dur: e.dur, voice: destVoiceId, staff: destStaffId };
      if (e.display) x.display = JSON.parse(JSON.stringify(e.display));
      if (e.kind === 'note') x.heads = (e.heads || []).filter(h => h.pitch).map(h => ({ pitch: clonePitch(h.pitch) }));
      const ev = b.event(destPart, x);
      (e.heads || []).forEach((h, i) => { if (ev.heads && ev.heads[i]) headMap.set(h.id, ev.heads[i].id); });
    });
    let cutTies = 0;
    srcPart.spanners.forEach(s => {
      if (s.type !== 'tie') return;
      const fromNew = s.from && headMap.get(s.from), toNew = s.to && headMap.get(s.to);
      if (fromNew && toNew) b.spanner(destPart, { type: 'tie', from: fromNew, to: toNew });
      else if (fromNew || toNew) cutTies++;
    });
    return cutTies;
  }

  /* One section's generated LH accompaniment (or bass alone, when the tier is 'reduced' and
     there is truly nothing above the bass): runs the chosen pattern (arrangement/g8a-
     accompaniment.js) over this section's slice of the real, whole-score beat-window harmony
     (songgraph/harmony.js, computed once by the caller), and writes the result - one real event
     per pattern attack, a rest for any window with no sounding harmony at all - into the LH
     voice. Voice-leading state (`vlState`) is threaded in from the caller so a new section
     continues the previous one's own voicing rather than restarting cold. */
  function writeGenerated(b, destPart, section, origToNewMeasure, measureIdSet, style, profile, vlState, allWindows) {
    const windows = allWindows.filter(w => measureIdSet.has(w.m));
    const chordSize = TIER_CHORD_SIZE[section.texture] || 1;
    const regLH = section.voicing.registerLH ||
      (section.voicing.registerRH ? { lo: section.voicing.registerRH.lo - 24, hi: section.voicing.registerRH.lo - 4 } : { lo: 36, hi: 60 });
    const seed = Math.round((regLH.lo + regLH.hi) / 2);
    const maxSpan = REACH.MAX_SPAN[profile];
    const ctx = { QUALITIES: HARM.QUALITIES, chordSize: chordSize, seed: seed, register: regLH, maxSpan: maxSpan, state: vlState };
    const fn = PATTERNS.STYLES[style];
    const raw = fn(windows, ctx);
    /* Reconcile: every real window either produced pattern events (consumed here, in window
       order - g8a-accompaniment.js never reorders or skips a non-null window) or is a real
       silence, which becomes one explicit rest spanning the whole window (full time coverage,
       never a gap the validator would reject and never an invented note over real silence). */
    let idx = 0;
    const events = [];
    windows.forEach(w => {
      if (w.root == null) { events.push({ w0: w.w0, w1: w.w1, midis: null }); return; }
      while (idx < raw.length && R.cmp(raw[idx].w0, w.w1) < 0) { events.push(raw[idx]); idx++; }
    });
    events.forEach(ev => {
      const mEntry = origToNewMeasure.get(windowMeasureOf(windows, ev));
      const at = R.format(R.sub(ev.w0, mEntry.origStart));
      const dur = R.format(R.sub(ev.w1, ev.w0));
      if (!ev.midis) { b.event(destPart, { kind: 'rest', m: mEntry.id, at: at, dur: dur }); return; }
      const heads = ev.midis.slice().sort((a, c) => a - c).map(m => ({ pitch: { midiOnly: m } }));
      b.event(destPart, { kind: 'note', m: mEntry.id, at: at, dur: dur, heads: heads });
    });
  }
  /* A generated event has no `.m` of its own (it only carries absolute w0/w1) - find which
     covered window it fell inside, to recover the original measure id its w0 belongs to. */
  function windowMeasureOf(windows, ev) {
    const w = windows.find(x => R.ge(ev.w0, x.w0) && R.lt(ev.w0, x.w1));
    return w ? w.m : windows.length ? windows[windows.length - 1].m : null;
  }

  /* Spell every generated head's placeholder {midiOnly} pitch for real, against the real key in
     force at its own measure (scoregraph/pro-spell.js's spellingTable/spellMidi - the same
     enharmonic-spelling module G3's own passes use, not a second spelling algorithm). Copied
     (melody/hymn) heads already carry a real spelled pitch from the source and are untouched. */
  function spellGenerated(destPart, keyByMeasure) {
    const SPELL = require('../scoregraph/pro-spell.js');
    const tableCache = new Map();
    destPart.events.forEach(e => {
      if (e.kind !== 'note') return;
      (e.heads || []).forEach(h => {
        if (h.pitch && h.pitch.midiOnly !== undefined) {
          const key = keyByMeasure.get(e.m) || { fifths: 0, mode: 'major' };
          const cacheKey = key.fifths + ':' + key.mode;
          let table = tableCache.get(cacheKey);
          if (!table) { table = SPELL.spellingTable({ fifths: key.fifths, mode: key.mode, tonic: tonicPcOf(key.fifths, key.mode) }); tableCache.set(cacheKey, table); }
          h.pitch = SPELL.spellMidi(h.pitch.midiOnly, table);
        }
      });
    });
  }

  function realize(g, sg, plan, opts) {
    opts = opts || {};
    if (!plan || !plan.sections || !plan.sections.length) return fail('EMPTY_PLAN', null);
    const rawStyle = opts.style || plan.request.style || DEFAULT_STYLE;
    const style = STYLE_ALIASES[rawStyle] || rawStyle;
    if (style !== 'hymn' && !PATTERNS.STYLES[style]) return fail('UNKNOWN_STYLE', { style: rawStyle });

    const srcPart = g.parts.find(p => p.id === plan.part);
    if (!srcPart) return fail('NO_PART', { part: plan.part });
    const profile = REACH.profileOf(plan.request.handProfile);

    const covered = coveredMeasures(g, plan);
    if (!covered.length) return fail('NO_MEASURES', null);
    const { keysByM, temposByM } = timelineState(g);

    const b = Build.builder({ id: (g.id || 'g8a') + ':arr', meta: { title: (g.meta && g.meta.title ? g.meta.title : 'Untitled') + ' (G8a: ' + style + ')' } });
    const src = b.source(SOURCE);
    b.setDefault({ src: src.id, op: 'generated' });
    const part = b.part({ name: 'Piano', instrument: { kind: 'piano', family: 'keyboard' } });

    const staffRH = b.staff(part, {}).id, staffLH = b.staff(part, {}).id;

    /* how many real voices the plan ever puts on each hand, across every covered section - the
       'hymn' literal path needs one destination voice per slot; every other style only ever
       needs one RH voice (melody) and one LH voice (the generated pattern). */
    let maxRH = 1, maxLH = 1;
    if (style === 'hymn') {
      maxRH = Math.max(1, ...plan.sections.map(s => s.hands.RH.length || 1));
      maxLH = Math.max(1, ...plan.sections.map(s => s.hands.LH.length || 1));
    }
    const rhVoices = [], lhVoices = [];
    for (let i = 0; i < maxRH; i++) rhVoices.push(b.voice(part, { staff: staffRH, label: String(i + 1) }).id);
    for (let i = 0; i < maxLH; i++) lhVoices.push(b.voice(part, { staff: staffLH, label: String(i + 5) }).id);

    /* measures, meter, key, tempo - one continuous timeline, section by section, in order.
       Never invented or defaulted except at the very first covered measure when the graph truly
       states none (mirrors tests/scoregraph/g3-helpers.js's mk() fixture defaults: 4/4, C major,
       120 qpm - a real, declared fallback, not a silent guess). */
    const origToNewMeasure = new Map();
    let prevMeterKey = null, prevKey = null, prevTempo = null, firstMeasureId = null;
    let cutTiesTotal = 0;
    covered.forEach((entry, i) => {
      const m = entry.m;
      const origStart = T.measureStart(g, m.id);
      const nm = b.measure({ number: String(i + 1), dur: m.dur });
      if (!firstMeasureId) firstMeasureId = nm.id;
      let meter = null;
      try { meter = T.meterAt(g, m.id); } catch (e) { meter = null; }
      const meterKey = meter ? meter.beats.join(',') + '/' + meter.beatType : null;
      if (meterKey !== prevMeterKey) {
        b.meter(meter ? { m: nm.id, beats: meter.beats.slice(), beatType: meter.beatType } : { m: nm.id, beats: [4], beatType: 4 });
        prevMeterKey = meterKey;
      }
      const k = keysByM.get(m.id);
      const keyVal = k ? { fifths: k.fifths, mode: k.mode || 'major' } : (prevKey ? null : { fifths: 0, mode: 'major' });
      if (keyVal && (!prevKey || keyVal.fifths !== prevKey.fifths || keyVal.mode !== prevKey.mode)) {
        b.key({ m: nm.id, at: '0', fifths: keyVal.fifths, mode: keyVal.mode });
        prevKey = keyVal;
      }
      const tp = temposByM.get(m.id);
      const tempoVal = tp ? R.toNumber(R.parse(tp.qpm)) : (prevTempo ? null : 120);
      if (tempoVal !== null && tempoVal !== prevTempo) { b.tempo({ m: nm.id, at: '0', qpm: String(tempoVal) }); prevTempo = tempoVal; }
      origToNewMeasure.set(m.id, { id: nm.id, idx: i, origStart: origStart });
    });
    b.clef(part, { staff: staffRH, m: firstMeasureId, at: '0', sign: 'G' });
    b.clef(part, { staff: staffLH, m: firstMeasureId, at: '0', sign: 'F' });

    const keyByMeasure = new Map();
    { let running = { fifths: 0, mode: 'major' }; covered.forEach(entry => { const k = keysByM.get(entry.m.id); if (k) running = { fifths: k.fifths, mode: k.mode || 'major' }; keyByMeasure.set(origToNewMeasure.get(entry.m.id).id, running); }); }

    /* one section at a time, sharing voice-leading state across the whole piece. Harmony is a
       real, whole-score pass (songgraph/harmony.js), computed once here rather than once per
       section: a single-part piano piece (the only kind G7b ever plans over, plan.js's
       pickPart) has one part, so "whole-score" and "this plan's part" read the same content. */
    const allWindows = HARM.harmonyOf(g, {});
    const vlState = { prevChord: null, prevBass: null };
    const bySection = new Map();
    covered.forEach(entry => { if (!bySection.has(entry.section)) bySection.set(entry.section, []); bySection.get(entry.section).push(entry.m); });

    plan.sections.forEach(section => {
      const ms = bySection.get(section) || [];
      if (!ms.length) return;
      const measureIdSet = new Set(ms.map(m => m.id));
      if (style === 'hymn') {
        section.hands.RH.forEach((vid, i) => { cutTiesTotal += copyVoice(b, part, srcPart, vid, measureIdSet, origToNewMeasure, rhVoices[i], staffRH); });
        section.hands.LH.forEach((vid, i) => { cutTiesTotal += copyVoice(b, part, srcPart, vid, measureIdSet, origToNewMeasure, lhVoices[i], staffLH); });
        /* an unused slot in this section (fewer real voices than another section uses) gets one
           whole-measure rest per measure, so every destination voice keeps full time coverage -
           never an invented note, just silence where G7b's plan itself keeps nothing this hand. */
        for (let i = section.hands.RH.length; i < maxRH; i++) ms.forEach(m => b.event(part, { kind: 'rest', m: origToNewMeasure.get(m.id).id, at: '0', dur: m.dur }));
        for (let i = section.hands.LH.length; i < maxLH; i++) ms.forEach(m => b.event(part, { kind: 'rest', m: origToNewMeasure.get(m.id).id, at: '0', dur: m.dur }));
      } else {
        cutTiesTotal += copyVoice(b, part, srcPart, section.melody.voice, measureIdSet, origToNewMeasure, rhVoices[0], staffRH);
        writeGenerated(b, part, section, origToNewMeasure, measureIdSet, style, profile, vlState, allWindows);
      }
    });

    spellGenerated(part, keyByMeasure);

    let built;
    try { built = b.finish(); } catch (e) { return fail('BUILD_FAILED', { message: String(e && e.message || e), issues: e && e.issues }); }

    const fingered = FING.fingerGraph(built.graph, {});
    return {
      ok: true, graph: fingered.graph, style: style,
      report: { cutTies: cutTiesTotal, sections: plan.sections.length }
    };
  }

  /* Convenience: G7b's plan() then G8a's realize(), in one call - what the harness and most
     tests actually want. Fails cleanly (never throws) the same way plan() does when the request
     is itself unreachable; realize() never runs on a plan that never existed. */
  function arrange(g, sg, request, opts) {
    opts = opts || {};
    const p = PLAN.plan(g, sg, request, opts.planOpts);
    if (!p.ok) return p;
    const r = realize(g, sg, p.plan, opts);
    if (!r.ok) return r;
    return { ok: true, plan: p.plan, graph: r.graph, style: r.style, report: r.report };
  }

  return Object.freeze({ version: version, SOURCE: SOURCE, TIER_CHORD_SIZE: TIER_CHORD_SIZE, realize: realize, arrange: arrange, tonicPcOf: tonicPcOf });
});
