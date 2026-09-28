/* ============================================================================
   PPP SongGraph — phrases and cadences (docs/GOALS/G07 §5 "phrases and cadences")

   No cadence concept exists anywhere else in this codebase (design doc §3) — this is new, grounded
   in the two real signals the design doc names ("harmonic-rhythm/melodic-closure signals"), read
   from this phase's own harmony (harmony.js) and melody (voices.js) output, not a bare arbitrary
   heuristic:

     authentic-ish  a dominant-function chord (major or dominant-seventh) resolves to a chord a
                    fifth below (root drops 7 semitones, i.e. V-I or V7-I; also covers IV-I,
                    "plagal", the one other resolution a fifth apart that reads as a close) AND the
                    melody voice's note at the arrival sounds for at least as long as the beat
                    window itself (it does not immediately move on — a proxy for melodic closure,
                    not a full scale-degree analysis) AND the arrival chord holds for at least one
                    more beat window, or is the last beat of its measure (a metrical point of rest).
     harmonic-rest  weaker, no resolution required: a chord simply holds unchanged for 2+ beat
                    windows while the melody also holds a note at least that long — the harmonic
                    rhythm and the tune both stop moving at once, the general "something paused
                    here" signal the design doc's phrasing describes, at lower confidence than an
                    actual resolution.

   phrasesOf(g, opts) -> {part, cadences: [{w (ScorePos), type, conf}], phrases: [{from, to}]}
   per part: phrases are the spans between consecutive cadences (piece start to the first, cadence
   to cadence, last cadence to piece end).

   No ground truth exists to measure this against (§3: nothing pre-existing to compare to) — the
   mutation suite (tests/songgraph/mutation.test.js) is what actually exercises it: a planted
   authentic cadence must be found, and flattening all harmonic motion to one held chord must not
   fabricate one.

   promotePhrases(g, candidates, opts) writes them via ops.addPhrase, same promotion rule as
   sections.js.
   ========================================================================== */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('../scoregraph/rational.js'), require('../scoregraph/time.js'), require('../scoregraph/ops.js'),
      require('./util.js'), require('./harmony.js'), require('./voices.js'));
  } else {
    const SG = root.PPPScoreGraphModules || {};
    const M = root.PPPSongGraphModules = root.PPPSongGraphModules || {};
    M.phrases = factory(SG.rational, SG.time, SG.ops, M.util, M.harmony, M.voices);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (R, T, O, U, H, V) {
  'use strict';

  const DOMINANT_Q = { maj: true, dom7: true };
  const RESOLVE_Q = { maj: true, min: true };

  /* The melody voice's note (if any) sounding at instant w, and how much longer it keeps sounding. */
  function melodyHold(notes, voiceId, w) {
    const here = U.soundingAt(notes.filter(n => n.voiceId === voiceId), w);
    if (!here.length) return null;
    const n = here[0];
    return R.sub(n.w1, w);
  }

  function cadencesOfPart(g, part) {
    const harmony = H.harmonyOf(g);
    const mb = V.melodyBassOf(g, { part: part.id });
    const pr = mb.parts[0];
    const melodyVoice = pr && pr.melodyVoice;
    const notes = U.noteWindows(g, { part: part.id });
    const mIdx = new Map(g.timeline.measures.map((m, i) => [m.id, i]));
    const beatsByM = new Map();
    harmony.forEach(h => { if (!beatsByM.has(h.m)) beatsByM.set(h.m, []); beatsByM.get(h.m).push(h); });

    function dedupe(list) {
      const kept = [];
      list.forEach(c => {
        const last = kept[kept.length - 1];
        if (last && mIdx.get(c.m) - mIdx.get(last.m) <= 1 && R.le(c.w, R.add(last.w, R.make(1)))) return;
        kept.push(c);
      });
      return kept;
    }

    const authentic = [];
    for (let i = 1; i < harmony.length; i++) {
      const prev = harmony[i - 1], cur = harmony[i];
      if (cur.root === null || prev.root === null) continue;
      const beatLen = R.sub(cur.w1, cur.w0);
      const hold = melodyVoice ? melodyHold(notes, melodyVoice, cur.w0) : null;
      const melodyLandsHere = hold !== null && R.ge(hold, beatLen);
      const holdsOn = i + 1 < harmony.length && harmony[i + 1].root === cur.root && harmony[i + 1].quality === cur.quality;
      const lastBeatOfMeasure = i + 1 >= harmony.length || harmony[i + 1].m !== cur.m;
      const resolves = DOMINANT_Q[prev.quality] && RESOLVE_Q[cur.quality] && (prev.root - cur.root + 12) % 12 === 7;
      if (resolves && melodyLandsHere && (holdsOn || lastBeatOfMeasure)) authentic.push({ w: cur.w1, m: cur.m, type: 'authentic', conf: 0.7 });
    }
    if (authentic.length) return { melodyVoice: melodyVoice, cadences: dedupe(authentic) };

    /* A piece with only one distinct chord from start to end has no harmonic rhythm to pause in — every
       measure-end trivially "holds," which is not a meaningful signal, just the absence of any change
       at all. Report no cadences rather than manufacturing one per bar (a real regression this caught:
       a single sustained whole-note chord for 3 measures used to produce a "cadence" after every bar). */
    const distinctChords = new Set(harmony.filter(h => h.root !== null).map(h => h.root + '/' + h.quality));
    if (distinctChords.size <= 1) return { melodyVoice: melodyVoice, cadences: [] };

    /* Fallback, only when the piece states no clear V-I (or IV-I) motion anywhere: a chord held across
       an ENTIRE measure (every beat window of it, not just the last one — the earlier, over-eager
       version required only the last beat, which fired on almost every bar of a hymn and produced a
       one-measure "phrase" at nearly every line) while the melody also stops moving at that measure's
       end. Weaker and lower-confidence than an actual resolution, and never mixed with it. */
    const rest = [];
    for (let i = 1; i < harmony.length; i++) {
      const cur = harmony[i];
      if (cur.root === null) continue;
      const lastBeatOfMeasure = i + 1 >= harmony.length || harmony[i + 1].m !== cur.m;
      if (!lastBeatOfMeasure) continue;
      const wholeMeasure = beatsByM.get(cur.m) || [];
      const heldAllMeasure = wholeMeasure.every(h => h.root === cur.root && h.quality === cur.quality);
      const beatLen = R.sub(cur.w1, cur.w0);
      const hold = melodyVoice ? melodyHold(notes, melodyVoice, cur.w0) : null;
      const melodyLandsHere = hold !== null && R.ge(hold, beatLen);
      if (heldAllMeasure && melodyLandsHere) rest.push({ w: cur.w1, m: cur.m, type: 'harmonic-rest', conf: 0.4 });
    }
    return { melodyVoice: melodyVoice, cadences: dedupe(rest) };
  }

  function phrasesOfPart(g, part) {
    const { cadences } = cadencesOfPart(g, part);
    const ms = g.timeline.measures;
    const scoreStart = { m: ms[0].id, at: '0' };
    const lastM = ms[ms.length - 1];
    const scoreEnd = T.posAt(g, R.add(T.measureStart(g, lastM.id), R.parse(lastM.dur)));
    const bounds = [scoreStart].concat(cadences.map(c => T.posAt(g, c.w))).concat([scoreEnd]);
    const phrases = [];
    for (let i = 0; i < bounds.length - 1; i++) {
      const from = bounds[i], to = bounds[i + 1];
      if (from.m === to.m && from.at === to.at) continue; /* a cadence landing exactly on the piece's end */
      phrases.push({ from: from, to: to, cadence: i > 0 ? { type: cadences[i - 1].type, conf: cadences[i - 1].conf } : null });
    }
    return { part: part.id, cadences: cadences, phrases: phrases };
  }

  function phrasesOf(g, opts) {
    opts = opts || {};
    const parts = opts.part ? g.parts.filter(p => p.id === opts.part) : g.parts;
    return parts.map(part => phrasesOfPart(g, part));
  }

  const SOURCE = Object.freeze({ kind: 'generator', tool: 'ppp.songgraph.phrases' });

  /* Write candidates ([{part, from, to, section?}]) via ops.addPhrase. */
  function promotePhrases(g, candidates, opts) {
    opts = opts || {};
    let out = g, idMaps = [];
    candidates.forEach(c => {
      const res = O.addPhrase(out, c.from, c.to, {
        part: c.part, voices: c.voices, section: c.section,
        prov: { op: 'inferred', source: opts.source || SOURCE }
      });
      out = res.graph;
      idMaps.push(res.idMap);
    });
    return { graph: out, idMaps: idMaps };
  }

  return Object.freeze({ cadencesOfPart, phrasesOf, promotePhrases, SOURCE });
});
