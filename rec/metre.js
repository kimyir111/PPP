/* ============================================================================
   PPP rec/ (G10a-1) - S2: metre, tempo octave, downbeat and pickup (docs/GOALS/G10 section 8.1)

     hypotheses(att, cls, tracks, tables, opts) -> { list: [{ track, rho, mi, phi, qpm, fr }], X (raw features, n x F),
                                                    nBeats, frames }
     scaledRow(H, i, alpha, out) -> the features of reading i as the weights read them
     choose(att, cls, tracks, model weights, opts) -> { best, posterior, confidence, metrePosterior, slots, count }
     writtenBeats(best, tracks, slots, att) -> { beats: [s], metre, qpm }

   Every reading of every pulse track (rec/beats.js) is scored with the learned model (rec/model.js) and the best one wins:
   a Bayesian choice of metre x phase x tactus whose likelihoods and weights were learned from the catalogue. The
   posterior of the winner (a softmax over every reading) and the share of the posterior on readings that put the bar
   lines in the same places are its confidence. Readings whose quarter tempo falls outside 36-260 are not considered.
   G10a-1b (G10 section 28): a model with `swing` also reads every simple metre swung (its eighths long-short), and a model
   with `beatCap` lets the accent evidence of a reading grow with its beats only up to that many. A model with
   `conventionPrior` (nats per metre key) adds it to every reading of that metre when no downbeats are heard: 2/4 and 4/4 at
   the same pulse differ only in where every other bar line is written, which a performance without downbeats cannot
   decide (the trainer chooses the preference by its cross-validation, G10 section 28).

   Node and browser (window.PPPRecModules.metre).
   ========================================================================== */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./model.js'), require('./beats.js'));
  else { const M = root.PPPRecModules = root.PPPRecModules || {}; M.metre = factory(M.model, M.beats); }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (model, beats) {
  'use strict';

  const RHOS = [1 / 4, 1 / 3, 1 / 2, 2 / 3, 1, 3 / 2, 2, 3, 4];
  const QPM_LO = 36, QPM_HI = 260;
  const F = model.FEATURES.length;

  /* opts.swing (G10a-1b, the weights' `swing`): the long-short points s of the swung frames; each (track, rho) of a simple metre
     is then also read swung at each s, its quarters starting on the frame's beat or half a beat later (a reading's bar phase
     says which). Compound metres are never swung (their eighths are the beat's thirds already). */
  function hypotheses(att, cls, tracks, tables, opts) {
    opts = opts || {};
    const sigma = opts.sigma || 0.03;
    const swings = opts.swing || [];
    const list = [];
    const frames = [];
    tracks.forEach((tr, ti) => {
      RHOS.forEach(rho => {
        const fr = model.frame(att, cls, tr, rho, sigma, opts.downbeats);
        if (!(fr.qpm >= QPM_LO && fr.qpm <= QPM_HI)) return;
        frames.push(fr);
        const f0 = frames.length - 1;
        model.METRES.forEach((m, mi) => {
          if (opts.metres && opts.metres.indexOf(m.key) < 0) return;
          for (let phi = 0; phi < m.barQ - 1e-9; phi += model.PHASE_STEP_Q) list.push({ track: ti, rho: rho, mi: mi, phi: phi, qpm: fr.qpm, fr: f0 });
        });
        swings.forEach(s => [0, model.R / 2].forEach(o => {
          const fs = model.frame(att, cls, tr, rho, sigma, opts.downbeats, { s: s, o: o });
          frames.push(fs);
          const fi = frames.length - 1;
          model.METRES.forEach((m, mi) => {
            if (m.compound || (opts.metres && opts.metres.indexOf(m.key) < 0)) return;
            for (let phi = 0; phi < m.barQ - 1e-9; phi += model.PHASE_STEP_Q)
              if (Math.round(phi * model.R) % model.R === o) list.push({ track: ti, rho: rho, mi: mi, phi: phi, qpm: fr.qpm, fr: fi, swing: s });
          });
        }));
      });
    });
    const X = new Float64Array(list.length * F);
    const nBeats = new Int32Array(list.length);
    const fv = new Float64Array(F);
    list.forEach((h, i) => {
      model.features(frames[h.fr], h.mi, h.phi, tables, fv, false);
      for (let k = 0; k < F; k++) X[i * F + k] = fv[k];
      nBeats[i] = fv.nBeats || 1;
    });
    return { list: list, X: X, nBeats: nBeats, frames: frames, n: att.length };
  }

  function scaledRow(H, i, alpha, out, cap) {
    const fv = H.X.subarray(i * F, i * F + F);
    return model.scaled(fv, H.n, alpha, out, H.nBeats[i], cap);
  }

  function softmax(scores) {
    let mx = -Infinity;
    for (let i = 0; i < scores.length; i++) if (scores[i] > mx) mx = scores[i];
    let z = 0;
    const p = new Float64Array(scores.length);
    for (let i = 0; i < scores.length; i++) { p[i] = Math.exp(scores[i] - mx); z += p[i]; }
    for (let i = 0; i < scores.length; i++) p[i] /= z;
    return p;
  }

  /* weights: { tables, weights: [F numbers], alpha, sigma, beatCap?, swing?, conventionPrior? } (rec/weights/*.json; a model
     without beatCap, swing or conventionPrior - ai5a-v1 - reads as it was trained: no cap, no swung frames, no preference) */
  function choose(att, cls, tracks, W, opts) {
    opts = Object.assign({ sigma: W.sigma, swing: W.swing || null }, opts || {});
    const H = hypotheses(att, cls, tracks, W.tables, opts);
    if (!H.list.length) return null;
    const sc = new Float64Array(H.list.length), row = new Float64Array(F);
    const cap = W.beatCap || 0;
    /* the convention preference per metre index, only when the caller has no downbeats */
    const conv = !opts.downbeats && W.conventionPrior ? model.METRES.map(m => W.conventionPrior[m.key] || 0) : null;
    let bi = 0;
    for (let i = 0; i < H.list.length; i++) {
      scaledRow(H, i, W.alpha, row, cap);
      sc[i] = model.score(row, W.weights);
      if (conv) sc[i] += conv[H.list[i].mi];
      if (sc[i] > sc[bi]) bi = i;
    }
    const p = softmax(sc);
    const metrePost = {};
    H.list.forEach((h, i) => { const k = model.METRES[h.mi].key; metrePost[k] = (metrePost[k] || 0) + p[i]; });
    const best = H.list[bi];
    const fv = new Float64Array(F);
    const slots = model.features(H.frames[best.fr], best.mi, best.phi, W.tables, fv, true);
    /* the confidence of the reading: the share of the posterior on readings that agree with it (the same metre, the
       same quarter tempo within 4 %, bar lines at the same times) */
    let agree = 0;
    H.list.forEach((h, i) => {
      if (h.mi !== best.mi || Math.abs(Math.log(h.qpm / best.qpm)) > 0.04) return;
      if (sameBars(h, best, tracks, att)) agree += p[i];
    });
    for (const k in metrePost) metrePost[k] = Math.round(metrePost[k] * 1e4) / 1e4;
    return { best: Object.assign({}, best, { features: Array.from(scaledRow(H, bi, W.alpha, row, cap)), score: sc[bi] }), posterior: p[bi],
      confidence: agree, metrePosterior: metrePost, slots: slots, count: H.list.length };
  }

  /* two readings put their bar lines at the same times (checked at the first and the last attack) */
  function sameBars(a, b, tracks, att) {
    const m = model.METRES[a.mi];
    const qAt = (h, t) => h.rho * beats.position(tracks[h.track].beats, t) - h.phi;
    return [att[0].t, att[att.length - 1].t].every(t => {
      const d = (qAt(a, t) - qAt(b, t)) / m.barQ;
      return Math.abs(d - Math.round(d)) * m.barQ < 0.25;
    });
  }

  /* the written beats (quarters, or dotted quarters in compound time) of the chosen reading, from the bar line of the
     first attack's bar to two beats past the last attack: beats[0] is that bar line */
  function writtenBeats(best, tracks, slots, att) {
    const m = model.METRES[best.mi];
    const tr = tracks[best.track];
    const bar0 = Math.floor(slots[0] / m.S);
    const startQ = bar0 * m.barQ;
    const lastQ = best.rho * beats.position(tr.beats, att[att.length - 1].t) - best.phi;
    const out = [];
    for (let k = 0; startQ + k * m.unitQ <= lastQ + 2 * m.unitQ + 1e-9; k++) out.push(beats.timeAt(tr.beats, (startQ + k * m.unitQ + best.phi) / best.rho));
    return { beats: out, metre: m, qpm: best.qpm };
  }

  return Object.freeze({ RHOS, QPM_LO, QPM_HI, hypotheses, scaledRow, choose, writtenBeats, softmax, sameBars });
});
