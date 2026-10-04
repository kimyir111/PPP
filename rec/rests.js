/* ============================================================================
   PPP rec/ S6 - is this silence a rest? (docs/GOALS/G10_AUDIO_TO_SCORE.md section 8, stage S6; phase G10a-3, model AI-5b)

     decide(cands, ctx, opts) -> { rest: [bool], p: [probability], report }
     features(cands, ctx) -> [Float64Array]      (the model's inputs, one row per candidate; FEATURES names them)

   A transcription hears when each key went UP, and that says little about the written value: in the teacher's real
   transcription 70 % of notes are held past the next onset of their hand and 27-31 % are released early (G10 E5), while
   94 % of the catalogue's written notes last exactly until the next onset of their staff (E6). G10-D4: a written value
   comes from the onsets; a release only decides whether a silence is a REST. audio-score.js's fixed rule wrote a rest for
   every silence of an eighth or more between a release and the next onset of the voice; on the calibrated humanizer
   most of those are not in the score (rest precision 0.20 on rec-core v2). This stage decides each such silence with a
   small logistic model over evidence a release cannot fake alone: how big the silence is against the inter-onset
   interval (heard and written), the pedal, where the silence starts and ends in the bar, whether the other hand is
   silent too, the same place in the other bars of the piece, the next onset's loudness. Default (no weights): the rule.

   The candidates are the writer's (rec/writer.js): a silence of at least restMin (an eighth, G10 U7: no shorter rest is
   written) between the written release of an event and the next onset of its voice. Its fields: {staff, voice, start,
   end, next (ticks, 24 a quarter), notes, nextNotes (audio-score.js's placed notes: on, off, vel, midi, tick)}.
   ctx: {bar, unit (24 or 36), notes (every placed note of the piece), pedals ([{on, off}] seconds, the heard pedal; none
   from the browser model)}.

   Pure, deterministic. UMD: Node require('./rec/rests.js') (loads rec/weights/ai5b-rests-v1.json), page PPPRecRests
   (window.PPPRecRestsModel or opts.model).
   ========================================================================== */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) {
    let model = null;
    try { model = require('./weights/ai5b-rests-v1.json'); } catch (e) { model = null; }
    module.exports = factory(model);
  } else {
    root.PPPRecRests = factory(root.PPPRecRestsModel || null);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (DEFAULT_MODEL) {
  'use strict';

  const VERSION = '0.1.0';
  const SCHEMA = 'ppp.rec-rests-model/1';
  const FEATURES = Object.freeze([
    'bias',
    'gapWritten',      /* written silence / written inter-onset interval (0-1) */
    'gapHeard',        /* heard silence (next onset - the chord's lower-median release) / heard inter-onset interval, clipped to [-1, 1] */
    'gapHeardMax',     /* the same from the chord's LAST release: negative when any note of it is held to the next onset */
    'gapSec',          /* the heard silence in seconds, clipped to [-0.5, 1.5] */
    'pedalAtRelease',  /* the damper is down where the chord was released (its release says nothing then) */
    'pedalKnown',      /* the input has a pedal at all (the browser's model has none) */
    'pedalCover',      /* share of the heard silence under the damper */
    'startBar', 'startBeat', 'startHalf',      /* where the silence starts: a bar line, a beat, a half beat (else finer) */
    'nextBar', 'nextBeat', 'nextHalf',         /* where it ends (the next onset) */
    'gapBeats',        /* written silence in beats, clipped to 4 */
    'ioiBeats',        /* written inter-onset interval in beats, clipped to 8 */
    'nextVel',         /* the next onset's velocity against the piece (z, clipped to +-3) */
    'otherBusy',       /* the other staff has an onset inside the silence */
    'otherSilent',     /* the other staff sounds nothing (heard) where the silence starts */
    'parallel',        /* mean gapHeard of the other candidates of the staff at the same place in the bar with the same written interval */
    'parallelN',       /* log(1 + how many there are) */
    'chord',           /* notes in the chord / 4 */
    'shortIoi',        /* the written interval is an eighth or shorter */
    'gapHeard25', 'gapHeard50', 'gapHeard75',  /* gapHeard above 0.25 / 0.5 / 0.75 */
    'gapWritten50',    /* gapWritten at least a half */
    'peerRest',        /* share of those other candidates whose gapHeard is above a half */
    'otherVoice',      /* the staff's other voice is heard sounding where the silence starts (no silence of the staff then) */
    'gapHeardPedal',   /* gapHeard where the input has a pedal (0 without one) */
    'lastInBar'        /* the note is its voice's last onset in the bar */
  ]);
  const NF = FEATURES.length;

  let defaultModel = DEFAULT_MODEL && DEFAULT_MODEL.schema === SCHEMA ? DEFAULT_MODEL : null;
  function setModel(m) { if (m && m.schema !== SCHEMA) throw new Error('rec/rests: expected schema ' + SCHEMA); defaultModel = m || null; }

  const clip = (x, a, b) => (x < a ? a : x > b ? b : x);
  const mean = xs => xs.reduce((s, x) => s + x, 0) / Math.max(1, xs.length);

  /* where a tick lies in the bar: 3 bar line, 2 beat, 1 half beat, 0 finer */
  function strength(tick, bar, unit) {
    const p = ((tick % bar) + bar) % bar;
    if (p === 0) return 3;
    if (p % unit === 0) return 2;
    if (unit === 24 ? p % 12 === 0 : p % 12 === 0) return 1;
    return 0;
  }

  function features(cands, ctx) {
    const bar = ctx.bar, unit = ctx.unit || 24;
    const notes = ctx.notes || [];
    const pedals = (ctx.pedals || []).filter(p => isFinite(p.on) && isFinite(p.off) && p.off > p.on);
    const pedalKnown = pedals.length ? 1 : 0;
    const underPedal = t => pedals.some(p => p.on - 0.02 <= t && t <= p.off + 0.02);
    const pedalShare = (a, b) => {
      if (!(b > a)) return 0;
      let s = 0;
      pedals.forEach(p => { s += Math.max(0, Math.min(b, p.off) - Math.max(a, p.on)); });
      return clip(s / (b - a), 0, 1);
    };
    const vels = notes.map(n => (n.vel == null ? 64 : +n.vel));
    const vm = mean(vels), vsd = Math.sqrt(mean(vels.map(v => (v - vm) * (v - vm)))) || 1;
    /* onsets per staff (ticks) and the heard sounding spans per staff */
    const onsetsOf = [null, [], []], spansOf = [null, [], []], voiceSpans = new Map();
    notes.forEach(n => {
      if (n.staff !== 1 && n.staff !== 2) return;
      onsetsOf[n.staff].push(n.tick);
      spansOf[n.staff].push([n.on, n.off]);
      const k = n.staff * 10 + (n.voice === 2 ? 2 : 1);
      if (!voiceSpans.has(k)) voiceSpans.set(k, []);
      voiceSpans.get(k).push([n.on, n.off, n.tick]);
    });
    onsetsOf.forEach(a => { if (a) a.sort((x, y) => x - y); });
    const hasOnsetIn = (staff, a, b) => {
      const list = onsetsOf[staff];
      let lo = 0, hi = list.length;
      while (lo < hi) { const m = (lo + hi) >> 1; if (list[m] <= a) lo = m + 1; else hi = m; }
      return lo < list.length && list[lo] < b;
    };
    const soundsAt = (staff, t) => spansOf[staff].some(s => s[0] <= t && t < s[1]);
    const heard = c => {
      const ons = c.notes.map(n => +n.on), offs = c.notes.map(n => +n.off).sort((a, b) => a - b);
      const on = mean(ons), next = mean(c.nextNotes.map(n => +n.on));
      const ioi = Math.max(0.02, next - on);
      const rel = offs[Math.floor((offs.length - 1) / 2)], relMax = offs[offs.length - 1];
      return { on: on, next: next, ioi: ioi, rel: rel, relMax: relMax, gap: next - rel, gapMax: next - relMax };
    };
    const H = cands.map(heard);
    /* the same place in other bars: candidates of the staff grouped by (position of the onset in the bar, written interval) */
    const groups = new Map();
    cands.forEach((c, i) => {
      const k = c.staff + '|' + (((c.start % bar) + bar) % bar) + '|' + (c.next - c.start);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(i);
    });
    return cands.map((c, i) => {
      const h = H[i];
      const x = new Float64Array(NF);
      const ioiW = c.next - c.start, gapW = c.next - c.end;
      const gw = clip(gapW / ioiW, 0, 1), gh = clip(h.gap / h.ioi, -1, 1);
      const k = c.staff + '|' + (((c.start % bar) + bar) % bar) + '|' + ioiW;
      const peers = groups.get(k).filter(j => j !== i);
      const sS = strength(c.end, bar, unit), sN = strength(c.next, bar, unit);
      const other = c.staff === 1 ? 2 : 1;
      x[0] = 1;
      x[1] = gw;
      x[2] = gh;
      x[3] = clip(h.gapMax / h.ioi, -1, 1);
      x[4] = clip(h.gap, -0.5, 1.5);
      x[5] = pedalKnown && underPedal(h.rel) ? 1 : 0;
      x[6] = pedalKnown;
      x[7] = pedalKnown ? pedalShare(h.rel, h.next) : 0;
      x[8] = sS === 3 ? 1 : 0; x[9] = sS === 2 ? 1 : 0; x[10] = sS === 1 ? 1 : 0;
      x[11] = sN === 3 ? 1 : 0; x[12] = sN === 2 ? 1 : 0; x[13] = sN === 1 ? 1 : 0;
      x[14] = clip(gapW / unit, 0, 4);
      x[15] = clip(ioiW / unit, 0, 8);
      x[16] = clip((mean(c.nextNotes.map(n => (n.vel == null ? 64 : +n.vel))) - vm) / vsd, -3, 3);
      x[17] = hasOnsetIn(other, c.end, c.next) ? 1 : 0;
      x[18] = soundsAt(other, h.rel + 0.03) ? 0 : 1;
      x[19] = peers.length ? mean(peers.map(j => clip(H[j].gap / H[j].ioi, -1, 1))) : 0;
      x[20] = Math.log(1 + peers.length);
      x[21] = Math.min(4, c.notes.length) / 4;
      x[22] = ioiW <= 12 ? 1 : 0;
      x[23] = gh > 0.25 ? 1 : 0; x[24] = gh > 0.5 ? 1 : 0; x[25] = gh > 0.75 ? 1 : 0;
      x[26] = gw >= 0.5 ? 1 : 0;
      x[27] = peers.length ? peers.filter(j => H[j].gap / H[j].ioi > 0.5).length / peers.length : 0;
      const ov = voiceSpans.get(c.staff * 10 + (c.voice === 2 ? 1 : 2));
      x[28] = ov && ov.some(s => s[0] <= h.rel + 0.03 && h.rel + 0.03 < s[1]) ? 1 : 0;
      x[29] = pedalKnown ? gh : 0;
      const barEnd = (Math.floor(c.start / bar) + 1) * bar;
      x[30] = c.next >= barEnd ? 1 : 0;
      return x;
    });
  }

  function decide(cands, ctx, opts) {
    opts = opts || {};
    const model = opts.model || defaultModel;
    if (!model) return { rest: cands.map(() => true), p: cands.map(() => 1), report: { model: 'rule', asked: cands.length, rest: cands.length } };
    const stumps = model.form === 'stumps';
    if (model.schema !== SCHEMA || (model.features || []).length !== NF ||
        (stumps ? !Array.isArray(model.trees) : !(Array.isArray(model.weights) && model.weights.length === NF))) throw new Error('rec/rests: the model does not match the features (' + NF + ')');
    const X = features(cands, ctx);
    const thr = opts.threshold != null ? opts.threshold : (model.threshold != null ? model.threshold : 0.5);
    /* logistic: sigmoid(w . x); boosted stumps: sigmoid(bias + the leaf of each [feature, threshold, left, right]) */
    const score = stumps
      ? x => { let s = model.bias; const T = model.trees; for (let i = 0; i < T.length; i++) s += x[T[i][0]] <= T[i][1] ? T[i][2] : T[i][3]; return s; }
      : x => { let s = 0; for (let k = 0; k < NF; k++) s += model.weights[k] * x[k]; return s; };
    const p = X.map(x => 1 / (1 + Math.exp(-score(x))));
    const rest = p.map(v => v >= thr);
    return { rest: rest, p: p, report: { model: (model.name || 'rests') + '@' + model.version, asked: cands.length, rest: rest.filter(Boolean).length, threshold: thr } };
  }

  return Object.freeze({ VERSION, SCHEMA, FEATURES, features, decide, setModel, strength });
});
