/* ============================================================================
   PPP rec/ - the recording conversion v2 (docs/GOALS/G10_AUDIO_TO_SCORE.md sections 6 and 8)

     skeleton(notes, opts) -> the time skeleton of a performance (S0-S2), or null when it cannot be read:
       { metre: { beats, beatType, compound }, beats: [s]   (written beats: quarters, or dotted quarters in compound time;
                                                             beats[0] is the bar line of the first attack's bar),
         qpm (quarters a minute, the median of the reading), conf, posterior, metrePosterior, model, report }
     loadWeights() -> the committed weights (Node), or the page's (window.PPPRecWeights)
     hands       -> S4, the staff of every note (rec/hands.js, G10a-2): hands.assign(notes, opts) -> {staff, conf, report};
                    hands.assignQ(q) writes q[i].staff (1 right hand / upper staff, 2 left) on audio-score.js's quantized notes.
                    Its weights: rec/weights/hands-v1.json (Node), window.PPPRecHandsWeights or opts.model (a page)

   G10a-1 builds S0 (rec/attacks.js), S1 (rec/beats.js: pulse tracks, a DP over tempo and phase) and S2 (rec/metre.js +
   rec/model.js: metre, tempo octave, downbeat and pickup, chosen by a model learned from the licence-clean catalogue,
   AI-5a). audio-score.js calls it for toMusicXml(input, { recording: 'v2' }) and writes the score from the skeleton with
   its own quantiser and writer (S3-S10 stay legacy until G10a-2/3). Without opts.recording, or with 'legacy', nothing
   here runs. The input is the notes audio-score.js has already cleaned and clustered (every note has `attack`).

   Node: require('./rec/index.js'). Browser: rec/attacks.js, beats.js, model.js, metre.js, hands.js, index.js after scoregraph/,
   and the weights (rec/weights/ai5a-v1.json) as window.PPPRecWeights or opts.weights (hands: window.PPPRecHandsWeights).

   The whole v2 page order (for G10a-4; audio-score.js finds each stage on the page and writes the legacy way, or v2 with a stage's
   own fallback, when one is missing):
     1. scoregraph/*.js, gaps.js and rec-tuplet.js among them (PPPScoreGraphModules)
     2. the weights as globals BEFORE their modules: rec/weights/ai5a-v1.json -> window.PPPRecWeights, hands-v1.json ->
        window.PPPRecHandsWeights, ai5b-grid-v1.json -> window.PPPRecGridModel, ai5b-rests-v1.json -> window.PPPRecRestsModel
        (63.5 KB together; section 11 budget 200 KB)
     3. rec/attacks.js, beats.js, model.js, metre.js, hands.js, index.js (S0-S2, S4: window.PPPRec)
     4. rec/grid.js (S3: window.PPPRecGrid), rec/voices.js (S5: PPPRecVoices), rec/rests.js (S6: PPPRecRests),
        rec/writer.js (S7: PPPRecWriter; it reads scoregraph/gaps.js at load, so after 1), rec/key.js (S8: PPPRecKey) and
        rec/pedal.js (S9: PPPRecPedal) - G10a-3 lane B
     5. audio-score.js; scoregraph/tools/notation-check.js is a tool, not needed by the page
   ========================================================================== */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./attacks.js'), require('./beats.js'), require('./model.js'), require('./metre.js'), require('./hands.js'));
  else { const M = root.PPPRecModules = root.PPPRecModules || {}; root.PPPRec = factory(M.attacks, M.beats, M.model, M.metre, M.hands || null); }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (attacks, beats, model, metre, hands) {
  'use strict';

  const VERSION = '0.1.0';
  const WEIGHTS_FILE = 'ai5a-v1.json';
  const MIN_ATTACKS = 4;
  let cached = null;

  function loadWeights() {
    if (cached) return cached;
    let w = null;
    if (typeof module === 'object' && module.exports) {
      try { w = require('./weights/' + WEIGHTS_FILE); } catch (e) { w = null; }
    } else if (typeof globalThis !== 'undefined' && globalThis.PPPRecWeights) w = globalThis.PPPRecWeights;
    if (w && w.schema === model.SCHEMA) cached = w;
    return cached;
  }

  function skeleton(notes, opts) {
    opts = opts || {};
    const W = opts.weights || loadWeights();
    if (!W || W.schema !== model.SCHEMA) return null;
    const att = attacks.attacksOf(notes);
    if (att.length < MIN_ATTACKS) return null;
    const cls = attacks.classes(att);
    const tracks = beats.tracks(att, { tight: W.tight, maxTracks: W.maxTracks });
    /* the helper's audio beats, when the caller has them (Beat This on the helper; the browser path has none): one more
       track, and its downbeats are evidence for the bar lines.
       G10a-1d (a model with `phase`, G10 section 36): only beats the caller marks as known bar lines (opts.beatsTrusted: the benchmark's
       own performer, whose downbeats are the score's bar lines) that are also steady - the beat track one pulse (helperGate.maxIrregular,
       .maxExtra) and the downbeats one bar (helperGate.minSteady of their intervals within 15 % of the median). The beats of a real
       tracker (Beat This on the user's PC, any helper) never reach the metre model: steady is not right (regular half-bar downbeats
       would make a 4/4 piece 2/4), so the metre and the tempo are read from the notes alone, exactly as without beats, and the
       downbeats are evidence of the bar phase only (the phase step of metre.choose). */
    const downs = opts.downbeats && opts.downbeats.length ? opts.downbeats : null;
    const helper = helperUse(opts.beats, downs, att, W, !!opts.beatsTrusted);
    const audio = helper === 'used' ? beats.audioTrack(opts.beats, att) : null;
    if (audio) tracks.unshift(audio);
    if (!tracks.length) return null;
    /* the phase step runs when the metre model heard no downbeats (they decide the phase there, as before) */
    const ch = metre.choose(att, cls, tracks, W, { downbeats: audio && downs ? downs : null, phaseDownbeats: phaseOk(W) && downs && helper ? downs : null,
      phaseStep: !(audio && downs) });
    if (!ch) return null;
    const wb = metre.writtenBeats(ch.best, tracks, ch.slots, att);
    if (wb.beats.length < 2) return null;
    const m = wb.metre;
    return {
      metre: { beats: m.beats, beatType: m.beatType, compound: m.compound, key: m.key },
      beats: wb.beats,
      qpm: wb.qpm,
      conf: Math.round(ch.confidence * 1e4) / 1e4,
      posterior: Math.round(ch.posterior * 1e4) / 1e4,
      metrePosterior: ch.metrePosterior,
      model: { name: W.name, version: W.version, sha256: W.sha256 || null },
      report: { tracks: tracks.map(t => Math.round(t.period * 1e4) / 1e4), readings: ch.count,
        chosen: Object.assign({ track: ch.best.track, audio: !!tracks[ch.best.track].audio, rho: ch.best.rho, phi: ch.best.phi, metre: m.key },
          ch.best.swing ? { swing: ch.best.swing } : {}, ch.phase ? { phase: ch.phase } : {}, helper ? { helperBeats: helper } : {}) }
    };
  }

  /* G10a-1d: how the helper's beats are used: null (none given), 'used' (as before: one more track, and the downbeats in the metre model),
     'phase' (a model with `phase`: the downbeats are phase evidence only). A model without `phase` (v1.1) reads them as it always did.
     With `phase`: 'used' only for beats the caller trusts as bar lines (the benchmark's performer) that pass a well-formed helperGate;
     anything else - a real tracker, a missing or broken gate - fails closed to 'phase' */
  function helperUse(beatTimes, downs, att, W, trusted) {
    if (!beatTimes || !beatTimes.length) return null;
    if (!W.phase) return 'used';
    const g = W.phase.helperGate;
    if (!trusted || !gateOk(g)) return 'phase';
    /* judged on a whole song only: a short performance has too few beats to tell a tracker's slip from its noise, and is used as before */
    if (beatTimes.length >= g.minBeats && !beats.audioTrack(beatTimes, att, { maxIrregular: g.maxIrregular, maxExtra: g.maxExtra })) return 'phase';
    if (downs && downs.length - 1 >= g.minDownbeats && beats.steadyShare(downs) < g.minSteady) return 'phase';
    return 'used';
  }

  /* a weights file's phase step and helper gate are used only when well formed (fails closed: no phase step, no beats to the metre model) */
  const fin = x => typeof x === 'number' && isFinite(x);
  function gateOk(g) {
    return !!g && ['maxIrregular', 'maxExtra', 'minSteady', 'minBeats', 'minDownbeats'].every(k => fin(g[k]));
  }
  function phaseOk(W) {
    const p = W && W.phase;
    return !!p && Array.isArray(p.weights) && p.weights.length === 3 && p.weights.every(fin) && (p.margin == null || fin(p.margin)) && (p.chordSat == null || (fin(p.chordSat) && p.chordSat > 0));
  }

  return Object.freeze({ VERSION, skeleton, loadWeights, helperUse, gateOk, phaseOk, attacks, beats, model, metre, hands });
});
