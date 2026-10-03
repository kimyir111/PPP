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
       track, and its downbeats are evidence for the bar lines */
    const audio = opts.beats ? beats.audioTrack(opts.beats, att) : null;
    if (audio) tracks.unshift(audio);
    if (!tracks.length) return null;
    const ch = metre.choose(att, cls, tracks, W, { downbeats: audio && opts.downbeats && opts.downbeats.length ? opts.downbeats : null });
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
        chosen: { track: ch.best.track, audio: !!tracks[ch.best.track].audio, rho: ch.best.rho, phi: ch.best.phi, metre: m.key } }
    };
  }

  return Object.freeze({ VERSION, skeleton, loadWeights, attacks, beats, model, metre, hands });
});
