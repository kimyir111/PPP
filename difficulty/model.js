/* ============================================================================
   PPP Difficulty — the ranker's inference (docs/GOALS/G06_DIFFICULTY.md §3(b), G6a)

   predict(featuresResult, weights, opts) -> {
     version, weightsVersion,
     score        the ranker's number: only its ORDER means anything (pairwise training fixes no zero point),
     level        where that lands on the course: { position, stage, stageName, book, near, below, above,
                  beyond: 'top'|'bottom'|null } - anchored to named method-book pieces, never a bare number,
     reasons      the few features that raise this piece's score most, in words, with their values,
     contributions  every feature's { name, value, mean, weight, contribution } (contribution = weight * z),
     hotspots     the hardest measures: { m, number, score, hand: 'RH'|'LH'|'both', reasons },
     measures     every measure's local score (the hotspot map), in score order
   }

   `featuresResult` is difficulty/features.js featuresOf(); `weights` the committed JSON
   (difficulty/weights/g6a-v1.json, written by difficulty/tools/train.js). Deterministic: the same graph and
   weights give the same output. Not loaded by the app (G6b is the phase that may).

   ---- The model ----
   score = Σ_k w_k · (x_k − mean_k) / std_k, with every w_k ≥ 0. Each feature is built so that more of it is
   harder (features.js header), so a weight can only say how MUCH a feature matters, never flip what it
   means: every reason reads "above the method-book average on X", and the metamorphic properties the
   features share (tempo, transposition) hold for the whole score. mean/std are the training set's.

   ---- The hotspot map ----
   The same weights, applied to each measure's own value of every feature that decomposes by measure
   (features.js FEATURES[].local): a measure's local score is Σ_k w_k · (local_k − mean_k) / std_k over those
   features, so a hotspot is hard for the reasons the whole-piece level is, not for hand-set local rules.
   Whole-piece-only features (key, range, length, note-value variety) move the level, not the map. The
   hand is the one whose own values (features.js measures[].hand) carry most of the measure's positive
   contribution; 'both' when neither carries twice the other. */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./features.js'));
  else { const M = root.PPPDifficultyModules = root.PPPDifficultyModules || {}; M.model = factory(M.features); }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (F) {
  'use strict';

  const VERSION = '1.0.0';
  const SCHEMA = 'ppp.difficulty-weights/1';
  const BY_NAME = new Map(F.FEATURES.map(f => [f.name, f]));

  function check(weights) {
    if (!weights || weights.schema !== SCHEMA) throw new Error('difficulty weights: expected schema ' + SCHEMA);
    const n = weights.featureNames.length;
    ['mean', 'std', 'weights'].forEach(k => {
      if (!Array.isArray(weights[k]) || weights[k].length !== n) throw new Error('difficulty weights: ' + k + ' does not match featureNames');
    });
    weights.featureNames.forEach(name => { if (!BY_NAME.has(name)) throw new Error('difficulty weights: unknown feature ' + name); });
    weights.weights.forEach((w, i) => { if (!(w >= 0)) throw new Error('difficulty weights: ' + weights.featureNames[i] + ' has a negative weight'); });
  }

  function z(weights, i, x) { const s = weights.std[i]; return s > 0 ? (x - weights.mean[i]) / s : 0; }

  function contributions(piece, weights) {
    return weights.featureNames.map((name, i) => {
      const value = piece[name] == null ? 0 : piece[name];
      return { name: name, value: value, mean: weights.mean[i], weight: weights.weights[i], contribution: weights.weights[i] * z(weights, i, value) };
    });
  }

  function scoreOf(piece, weights) {
    let s = 0;
    weights.featureNames.forEach((name, i) => { s += weights.weights[i] * z(weights, i, piece[name] == null ? 0 : piece[name]); });
    return s;
  }

  /* ------------------------------------------------------------- level
     anchors: the final model's score of every training piece of a PATH book, sorted by score, each with its
     course position (stage + (rank in its book + 0.5) / pieces in its book) and that position's isotonic fit
     against score (train.js). Between two anchors the fitted position is interpolated linearly; outside
     them it is clamped and `beyond` says so. */
  function levelOf(score, weights) {
    const A = weights.anchors || [];
    const stages = weights.stages || {};
    if (!A.length) return null;
    let position, below = null, above = null, beyond = null;
    if (score < A[0].score) { position = A[0].fit; above = A[0]; beyond = 'bottom'; }
    else if (score >= A[A.length - 1].score) { position = A[A.length - 1].fit; below = A[A.length - 1]; beyond = score > A[A.length - 1].score ? 'top' : null; }
    else {
      let i = 0;
      while (i + 1 < A.length && A[i + 1].score <= score) i++;
      below = A[i]; above = A[i + 1];
      const t = above.score > below.score ? (score - below.score) / (above.score - below.score) : 0;
      position = below.fit + t * (above.fit - below.fit);
    }
    const stageNums = Object.keys(stages).map(Number).sort((a, b) => a - b);
    let stage = stageNums.length ? stageNums[0] : Math.floor(position);
    stageNums.forEach(s => { if (position >= s) stage = s; });
    const book = stages[stage] ? stages[stage].book : null;
    let near = null;
    A.forEach(a => { if (a.book === book && (!near || Math.abs(a.position - position) < Math.abs(near.position - position))) near = a; });
    const name = a => (a ? { book: a.book, no: a.no } : null);
    return {
      position: Math.round(position * 100) / 100,
      stage: stage, stageName: stages[stage] ? stages[stage].name : null, book: book,
      near: name(near), below: name(below), above: name(above), beyond: beyond
    };
  }

  /* ------------------------------------------------------------- reasons */
  function fmt(v) {
    const a = Math.abs(v);
    return a >= 100 ? v.toFixed(0) : a >= 10 ? v.toFixed(1) : v.toFixed(2);
  }
  function reasonText(c) {
    const f = BY_NAME.get(c.name);
    return f.what + ': ' + fmt(c.value) + ' ' + f.unit + ' (method-book average ' + fmt(c.mean) + ')';
  }
  function topReasons(contribs, n) {
    return contribs.filter(c => c.contribution > 0).sort((a, b) => b.contribution - a.contribution || (a.name < b.name ? -1 : 1))
      .slice(0, n).map(c => ({ feature: c.name, text: reasonText(c), contribution: c.contribution }));
  }

  /* ------------------------------------------------------------- hotspots */
  function measureMap(featuresResult, weights) {
    const idx = weights.featureNames.map((name, i) => [name, i]).filter(([name]) => BY_NAME.get(name).local);
    return featuresResult.measures.map(m => {
      let score = 0;
      const parts = [];
      idx.forEach(([name, i]) => {
        const c = weights.weights[i] * z(weights, i, m.local[name]);
        score += c;
        if (c > 0) parts.push({ name: name, c: c });
      });
      const handShare = { RH: 0, LH: 0 };
      ['RH', 'LH'].forEach(h => idx.forEach(([name, i]) => {
        if (!BY_NAME.get(name).hand) return;
        const c = weights.weights[i] * z(weights, i, m.hand[h][name]);
        if (c > 0) handShare[h] += c;
      }));
      const hand = handShare.RH > 2 * handShare.LH ? 'RH' : handShare.LH > 2 * handShare.RH ? 'LH' : 'both';
      parts.sort((a, b) => b.c - a.c || (a.name < b.name ? -1 : 1));
      /* A pickup or a short last bar has rates per beat of a fragment (one accidental in a quarter-beat upbeat
         is "four per beat"): its place in the hotspot ranking is scaled by the share of a full bar it is. */
      const share = m.barBeats > 0 ? Math.min(1, m.beats / m.barBeats) : 1;
      return { m: m.id, number: m.number, score: score, rank: score * share, hand: hand, top: parts.slice(0, 3).map(p => p.name), local: m.local };
    });
  }
  function hotspots(map, weights, n) {
    return map.filter(r => r.rank > 0).slice().sort((a, b) => b.rank - a.rank || (a.number < b.number ? -1 : 1)).slice(0, n)
      .map(r => ({
        m: r.m, number: r.number, score: r.score, hand: r.hand,
        reasons: r.top.map(name => {
          const f = BY_NAME.get(name);
          return f.what + ': ' + fmt(r.local[name]) + ' ' + f.unit;
        })
      }));
  }

  function predict(featuresResult, weights, opts) {
    opts = opts || {};
    check(weights);
    const contribs = contributions(featuresResult.piece, weights);
    const score = contribs.reduce((s, c) => s + c.contribution, 0);
    const map = measureMap(featuresResult, weights);
    return {
      version: VERSION, weightsVersion: weights.version,
      score: score,
      level: levelOf(score, weights),
      reasons: topReasons(contribs, opts.maxReasons || 3),
      contributions: contribs,
      hotspots: hotspots(map, weights, opts.maxHotspots || 5),
      measures: map.map(r => ({ m: r.m, number: r.number, score: r.score, hand: r.hand, top: r.top }))
    };
  }

  return Object.freeze({ VERSION, SCHEMA, check, scoreOf, contributions, levelOf, topReasons, measureMap, hotspots, predict });
});
