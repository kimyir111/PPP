/* ============================================================================
   PPP practice/variant.js - the splice of an easier (or harder) arrangement of a passage into a piece
   (docs/GOALS/G11_ADAPTIVE_PRACTICE.md section 8.2, G11-D10; phase G11c-0)

     splice(base, variant, opts) -> { ok: true,  graph, range, final, applied, widened, seams, judge, variantOf, stats }
                                  | { ok: false, reason, message, alternative, detail }

   base      the ScoreGraph the person has (a printed piece, an arrangement copy, a recording's transcription)
   variant   a ScoreGraph of THE SAME PIECE with the same bars: the arrangement at another level (arrangeSingleNote, or the
             lead sheet of a recording), or the source the copy was arranged from. The arrangers plan whole pieces, so a
             variant is whole and its bar i is the base's bar i (the realizer keeps one measure per source measure, E13).
   opts      from, to      the passage, as 0-based measure INDEXES in written order, both included (G11-D4: an index, not a number)
             direction     'easier' (default) | 'harder'
             weights       the G6 weights (difficulty/weights/g6a-v1.json); Node defaults to the committed file
             profile       the hand profile G5 judges with ('small' | 'medium' | 'large'); default 'large'
             songId, level what the copy records (variantOf); strictNotation: true also refuses a splice whose range holds a
                           checker hit that only the variant had (default: only a hit NEITHER source had is a failure)

   WHAT IT DOES (the numbered steps of section 8.2)
    1 refuse (VARIANT_TIMELINE) unless both graphs have the same bars: the same number, and the same durations, meters and key
      signatures in the passage +- 2 bars; a base or variant that is not one keyboard part with the staves of the other
      (VARIANT_PARTS, VARIANT_STAVES). A passage whose notes are the base's own, bar for bar, is VARIANT_IDENTICAL; bars at its
      ends that are the same are left alone (the splice is the bars that differ, `applied`).
    2 take the variant's events of the range; ties and slurs that cross a seam are cut (the note keeps its written value inside the
      range); the base's pedal, 8va and wedge spans are clipped at the seams (a span over the whole range becomes two) and the
      variant's are clipped to the range; the clef of each staff is carried in at the left seam and put back at the right seam.
      The base's own directions (dynamics, words, chords) stay; the variant's are added where the base has none of that kind.
    3 seams: G5 judges the first attack of each hand after each seam (the hand must reach it in time); a hard violation widens the
      range by one bar on that side, at most twice, then VARIANT_SEAM.
    4 verify: the validator (no ERROR, no warning that neither source had), notation-check classes 1-7 (no hit that neither source had, in
      the range and its neighbours: the checker's classes also fire on printed music and on the arrangers' own output, so a hit a source
      already had is that source's, not the splice's; strictNotation: true refuses those too) and G5 hard violations (none in the range,
      none new beside it).
    5 judge: G6 local score (difficulty/model.js measureMap over both whole graphs) of the bars that differ; easier needs it lower by
      JUDGE_MARGIN, harder higher (VARIANT_NOT_EASIER / VARIANT_NOT_HARDER); the widened bars may not move the wrong way.
    6 provenance: copied events and heads carry the variant's source with op 'generated' (the variant's own op where it states one);
      the copy gets a Source 'ppp.g11c0-variant' whose params hold variantOf {songId, from, to, level, direction} and the request.
   The clefs and 8va lines of the range are the variant's own (realize/clefs.js and realize/ottava.js wrote them for it), clipped to the
   range; they are not worked out again on the spliced range.
   Nothing outside the final range changes: every event, head, direction, bar, key, meter, tempo, section and performance note is
   as it was (a tie or slur across a seam, a clipped span and a clef put back are the seams, listed in `seams`).

   Every refusal has a reason code, a Korean sentence for the person and an alternative (a tempo, the harder hand).
   Pure and deterministic (no Date, no random, no I/O). UMD: Node require('./practice/variant.js'); page PPPPracticeVariant after
   scoregraph/ (rational, schema, pitch, time, serialize, validate, build, ops, tools/notation-check), playability/ and difficulty/.
   ========================================================================== */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) {
    let weights = null;
    try { weights = require('../difficulty/weights/g6a-v1.json'); } catch (e) { weights = null; }
    module.exports = factory({
      R: require('../scoregraph/rational.js'), T: require('../scoregraph/time.js'), P: require('../scoregraph/pitch.js'),
      V: require('../scoregraph/validate.js'), O: require('../scoregraph/ops.js'), PL: require('../playability/index.js'),
      NC: require('../scoregraph/tools/notation-check.js'), DF: require('../difficulty/features.js'), DM: require('../difficulty/model.js'),
      weights: weights
    });
  } else {
    const SG = root.PPPScoreGraphModules || {}, DM = root.PPPDifficultyModules || {};
    root.PPPPracticeVariant = factory({
      R: SG.rational, T: SG.time, P: SG.pitch, V: SG.validate, O: SG.ops, PL: root.PPPPlayability, NC: SG.notationCheck,
      DF: DM.features, DM: DM.model, weights: null
    });
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (D) {
  'use strict';

  const R = D.R, T = D.T, P = D.P, V = D.V, O = D.O, PL = D.PL, NC = D.NC, DF = D.DF, DM = D.DM;
  const VERSION = '1.0.0';
  const TOOL = 'ppp.g11c0-variant';
  const WIDEN_MAX = 2;            /* bars the range may grow on each side to make a seam playable */
  const TIMELINE_MARGIN = 2;      /* bars either side of the range whose durations, meters and keys must agree */
  const JUDGE_MARGIN = 0.25;      /* G6 local-score units (a sum of weight x z over the per-measure features) the passage must move by */
  const TEMPO_PERCENT = 70;       /* the alternative's tempo (the lesson's usual first step, G11 section 8.3) */

  const isObj = x => !!x && typeof x === 'object' && !Array.isArray(x);
  const arr = x => (Array.isArray(x) ? x : []);
  const clone = x => JSON.parse(JSON.stringify(x));
  const idNum = id => { const m = /^[a-z]+([0-9]+)$/.exec(String(id)); return m ? Number(m[1]) : 0; };
  const sameClef = (a, b) => !!a && !!b && a.sign === b.sign && (a.line || null) === (b.line || null) && (a.octave || 0) === (b.octave || 0);

  /* ------------------------------------------------------------------ refusals */
  /* code -> the sentence the person reads (Korean first, G11 section 8.3) */
  const REASONS = Object.freeze({
    VARIANT_ARGS: '이 구간을 바꿀 수 없어요. 악보나 마디 범위가 올바르지 않아요.',
    VARIANT_NOT_LOADED: '필요한 기능을 아직 불러오지 못했어요.',
    VARIANT_TIMELINE: '이 곡의 다른 버전과 마디 구성이 달라서 이 구간만 바꿀 수 없어요.',
    VARIANT_PARTS: '악보의 파트 구성이 달라서 이 구간만 바꿀 수 없어요.',
    VARIANT_STAVES: '악보의 오선 구성이 달라서 이 구간만 바꿀 수 없어요.',
    VARIANT_IDENTICAL: null,
    VARIANT_NOT_EASIER: null,
    VARIANT_NOT_HARDER: null,
    VARIANT_SEAM: '구간의 앞뒤로 손이 자연스럽게 이어지지 않아서 이 구간만 바꿀 수 없어요.',
    VARIANT_INVALID: '바꾼 악보가 올바르지 않아서 적용하지 않았어요.',
    VARIANT_NOTATION: '바꾼 구간의 악보 표기가 어긋나서 적용하지 않았어요.',
    VARIANT_HARD: '바꾼 구간에 손이 닿기 어려운 자리가 있어서 적용하지 않았어요.'
  });
  const CODES = Object.freeze(Object.keys(REASONS));
  const NO_ALTERNATIVE = new Set(['VARIANT_ARGS', 'VARIANT_NOT_LOADED']);

  /* the alternative the app offers with one tap: a slower tempo and, when one hand carries the passage, that hand alone */
  function alternativeOf(direction, hand) {
    if (direction === 'harder') return { tempoPercent: 100, hands: 'both', text: '대신 빠르기를 조금씩 올려서 연습해 보세요.' };
    const hands = hand === 'LH' || hand === 'RH' ? hand : 'both';
    const text = hands === 'LH' ? '대신 ' + TEMPO_PERCENT + '% 빠르기와 왼손만 연습을 추천해요.'
      : hands === 'RH' ? '대신 ' + TEMPO_PERCENT + '% 빠르기와 오른손만 연습을 추천해요.'
        : '대신 ' + TEMPO_PERCENT + '% 빠르기로 천천히 연습해 보세요.';
    return { tempoPercent: TEMPO_PERCENT, hands: hands, text: text };
  }
  function refuse(reason, detail, direction, hand) {
    let sentence = REASONS[reason];
    if (sentence === null) sentence = reason === 'VARIANT_NOT_HARDER' || (reason === 'VARIANT_IDENTICAL' && direction === 'harder')
      ? '이 구간은 지금보다 더 어렵게 만들 수 없어요.' : '이 구간은 지금보다 더 쉽게 만들 수 없어요.';
    const out = { ok: false, reason: reason, message: sentence, detail: detail || null };
    if (!NO_ALTERNATIVE.has(reason)) { out.alternative = alternativeOf(direction, hand); out.message = sentence + ' ' + out.alternative.text; }
    return out;
  }

  /* ------------------------------------------------------------------ reading a graph */
  function keyboardPart(g) {
    const parts = arr(g && g.parts);
    if (parts.length === 1) return parts[0];
    const kb = parts.filter(p => p && p.instrument && p.instrument.family === 'keyboard');
    return kb.length === 1 ? kb[0] : null;
  }
  const indexOfIds = ids => { const m = new Map(); ids.forEach((id, i) => m.set(id, i)); return m; };
  const barIds = g => g.timeline.measures.map(m => m.id);

  /* the notes the passage SOUNDS, per bar: 'at|dur|staff index|midi', sorted (graces marked): two graphs whose bar lists are equal play
     the same notes on the same staves; voices, spelling, rests and display do not count */
  function soundByBar(g, part, lo, hi) {
    const mIdx = indexOfIds(barIds(g)), sIdx = indexOfIds(part.staves.map(s => s.id));
    const out = [];
    for (let i = lo; i <= hi; i++) out.push([]);
    part.events.forEach(e => {
      if (e.kind !== 'note') return;
      const i = mIdx.get(e.m);
      if (i === undefined || i < lo || i > hi) return;
      arr(e.heads).forEach(h => {
        if (!h.pitch) return;
        out[i - lo].push(e.at + '|' + e.dur + '|' + sIdx.get(h.staff || e.staff) + '|' + P.midi(h.pitch) + (e.grace ? 'g' : ''));
      });
    });
    out.forEach(l => l.sort());
    return out;
  }
  const sameList = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

  /* the first reason the two graphs cannot share a bar index, or null (step 1) */
  function timelineProblem(base, variant, lo, hi) {
    const bm = base.timeline.measures, vm = variant.timeline.measures;
    if (bm.length !== vm.length) return 'the bars differ in number (' + bm.length + ' and ' + vm.length + ')';
    const a = Math.max(0, lo - TIMELINE_MARGIN), b = Math.min(bm.length - 1, hi + TIMELINE_MARGIN);
    for (let i = 0; i < bm.length && i <= hi; i++) {
      if (bm[i].multiRest && i + bm[i].multiRest - 1 >= lo) return 'bar ' + (i + 1) + ' opens a multi-measure rest over the passage';
    }
    for (let i = a; i <= b; i++) {
      if (!R.eq(R.parse(bm[i].dur), R.parse(vm[i].dur))) return 'bar ' + (i + 1) + ' lasts ' + bm[i].dur + ' and ' + vm[i].dur;
      const mb = T.meterAt(base, bm[i].id), mv = T.meterAt(variant, vm[i].id);
      const ms = x => (x ? JSON.stringify([x.beats, x.beatType, x.groups && x.groups.length ? x.groups : null]) : 'none');
      if (ms(mb) !== ms(mv)) return 'bar ' + (i + 1) + ' has another meter';
    }
    const keysOf = (g, ids) => {
      const idx = indexOfIds(ids);
      return arr(g.timeline.keys).filter(k => idx.has(k.m) && idx.get(k.m) >= a && idx.get(k.m) <= b)
        .map(k => JSON.stringify([idx.get(k.m), k.at, k.fifths, k.mode || null, k.scope || null])).sort().join(';');
    };
    if (keysOf(base, barIds(base)) !== keysOf(variant, barIds(variant))) return 'the key signatures differ near the passage';
    const kb = T.keyAt(base, { m: bm[a].id, at: '0' }), kv = T.keyAt(variant, { m: vm[a].id, at: '0' });
    if ((kb ? kb.fifths + '|' + (kb.mode || '') : '') !== (kv ? kv.fifths + '|' + (kv.mode || '') : '')) return 'the key at the passage differs';
    return null;
  }

  /* ------------------------------------------------------------------ the analyses the judge and the checks use (cached per graph) */
  const CACHE = new WeakMap();
  function cached(g, key, make) {
    if (!Object.isFrozen(g)) return make();      /* a graph that can still change is read afresh */
    let c = CACHE.get(g);
    if (!c) { c = {}; CACHE.set(g, c); }
    if (!(key in c)) c[key] = make();
    return c[key];
  }
  const validationOf = g => cached(g, 'validate', () => V.validate(g));
  const noteCheckOf = g => cached(g, 'nc', () => NC.checkGraph(g));
  const hardOf = (g, profile) => cached(g, 'g5:' + profile, () => PL.analyzeGraph(g, { profile: profile }));
  const featuresOf = g => cached(g, 'features', () => DF.featuresOf(g));
  const mapOf = (g, weights) => DM.measureMap(featuresOf(g), weights);

  /* G5 hard violations of a graph: Map 'bar index|hand|code' -> count, and the attack that follows a seam for each hand */
  function hardCounts(g, report) {
    const idx = indexOfIds(barIds(g)), out = new Map();
    report.events.forEach(e => e.hard.forEach(v => {
      const k = idx.get(e.m) + '|' + e.limb + '|' + v.code;
      out.set(k, (out.get(k) || 0) + 1);
    }));
    return out;
  }
  /* validator warnings: Map 'bar index|code' -> count (bar -1: no place) */
  function warningCounts(g, issues) {
    const idx = indexOfIds(barIds(g)), out = new Map();
    issues.forEach(it => {
      if (it.severity !== 'WARNING') return;
      const i = it.at && it.at.m !== undefined && idx.has(it.at.m) ? idx.get(it.at.m) : -1;
      const k = i + '|' + it.code;
      out.set(k, (out.get(k) || 0) + 1);
    });
    return out;
  }
  /* notation-check hits of classes 1-7: Set 'bar index|hand|class' */
  function noteHits(report) {
    const out = new Set();
    for (let c = 1; c <= 7; c++) report.classes[c].bars.forEach(b => out.add((b.bar - 1) + '|' + b.hand + '|' + c));
    return out;
  }
  const keyBar = k => Number(k.slice(0, k.indexOf('|')));

  /* ------------------------------------------------------------------ the splice */
  /* the spans that hang on positions (not on notes) */
  const POSITION_SPANS = new Set(['pedal', 'ottava', 'wedge']);

  /* what a spanner holds on to: the events and heads it names, and whether it names any that go */
  function refsOf(sp) {
    const ev = [], hd = [];
    if (sp.type === 'tie' || sp.type === 'gliss') { if (sp.from !== undefined) hd.push(sp.from); if (sp.to !== undefined) hd.push(sp.to); }
    else if (sp.type === 'slur') { if (sp.from !== undefined) ev.push(sp.from); if (sp.to !== undefined) ev.push(sp.to); }
    else if (sp.type === 'tuplet' || sp.type === 'beam') { arr(sp.events).forEach(e => ev.push(e)); arr(sp.breaks).forEach(b => ev.push(b.after)); }
    else if (sp.type === 'arpeggio') arr(sp.heads).forEach(h => hd.push(h));
    return { ev: ev, hd: hd };
  }

  /* One attempt at the range [lo, hi]: the edited base (a sealed graph) and what was done. Throws OpError when the result is invalid. */
  function build(c, lo, hi, opts) {
    const base = c.base, variant = c.variant, bm = c.bm, n = bm.length;
    const bIdx = c.bIdx, vIdx = c.vIdx;
    const rs = c.bStart[lo], re = c.bStart[hi + 1];
    const rsV = c.vStart[lo], reV = c.vStart[hi + 1];
    const durStr = i => base.timeline.measures[i].dur;
    const hasAfter = hi + 1 < n;
    const res = O.edit(base, d => {
      const doc = d.doc;
      const part = doc.parts.find(p => p.id === c.bPart.id);
      const info = { removedEvents: 0, addedEvents: 0, tiesCut: 0, slursCut: 0, otherCut: 0, variantTiesCut: 0, variantSlursCut: 0,
        pedalClipped: 0, ottavaClipped: 0, wedgeClipped: 0, clefsAdded: 0, clefsRemoved: 0, voicesAdded: 0, directionsCopied: 0, directionsKept: 0 };
      const inRange = new Set(bm.slice(lo, hi + 1));

      /* ---- 1. what the base had in the range goes */
      const goneEv = new Set(), goneHd = new Set();
      part.events.forEach(e => { if (inRange.has(e.m)) { goneEv.add(e.id); arr(e.heads).forEach(h => goneHd.add(h.id)); } });
      part.spanners.slice().forEach(sp => {
        if (POSITION_SPANS.has(sp.type)) return;
        const r = refsOf(sp);
        const touches = r.ev.some(x => goneEv.has(x)) || r.hd.some(x => goneHd.has(x));
        if (!touches) return;
        const inside = r.ev.every(x => goneEv.has(x)) && r.hd.every(x => goneHd.has(x));
        if (!inside) { if (sp.type === 'tie') info.tiesCut++; else if (sp.type === 'slur') info.slursCut++; else info.otherCut++; }
        d.removeSpanner(sp.id);
      });
      part.spanners.forEach(sp => { if (sp.type === 'tuplet' && sp.parent !== undefined && !part.spanners.some(x => x.id === sp.parent)) delete sp.parent; });
      /* the base's own position spans (pedal, 8va, wedge) are clipped at the seams: a span over the whole range becomes two */
      const bW = pos => T.scorePos(base, pos);
      part.spanners.slice().forEach(sp => {
        if (!POSITION_SPANS.has(sp.type)) return;
        const a = bW(sp.from), b = sp.to !== undefined ? bW(sp.to) : null;
        if (!(R.lt(a, re) && (b === null || R.gt(b, rs)))) return;
        const left = R.lt(a, rs), right = hasAfter && (b === null || R.gt(b, re));
        info[sp.type === 'pedal' ? 'pedalClipped' : sp.type === 'ottava' ? 'ottavaClipped' : 'wedgeClipped']++;
        const changes = arr(sp.changes), origTo = sp.to !== undefined ? clone(sp.to) : undefined;
        if (left) {
          sp.to = { m: bm[lo - 1], at: durStr(lo - 1) };
          if (sp.changes) { sp.changes = changes.filter(ch => R.lt(bW(ch), rs)); if (!sp.changes.length) delete sp.changes; }
          if (right) {
            const rest = clone(sp);
            rest.id = d.newId('s');
            rest.from = { m: bm[hi + 1], at: '0' };
            if (origTo === undefined) delete rest.to; else rest.to = origTo;
            const keep = changes.filter(ch => R.gt(bW(ch), re));
            if (keep.length) rest.changes = keep; else delete rest.changes;
            part.spanners.push(rest);
            d.touch();
          }
        } else if (right) {
          sp.from = { m: bm[hi + 1], at: '0' };
          if (sp.changes) { sp.changes = changes.filter(ch => R.gt(bW(ch), re)); if (!sp.changes.length) delete sp.changes; }
        } else d.removeSpanner(sp.id);
      });
      const baseKinds = new Set();
      part.directions.forEach(dd => { if (bIdx.has(dd.m) && bIdx.get(dd.m) >= lo && bIdx.get(dd.m) <= hi) { baseKinds.add(dd.kind); info.directionsKept++; } });
      if (goneEv.size) d.removeEvents(Array.from(goneEv));
      info.removedEvents = goneEv.size;

      /* ---- 2. the variant's sources, and the provenance of what is copied */
      const srcCopy = new Map();
      const srcOf = id => {
        if (srcCopy.has(id)) return srcCopy.get(id);
        const s = arr(variant.provenance && variant.provenance.sources).find(x => x.id === id);
        let out = null;
        if (s) { const desc = clone(s); delete desc.id; out = d.sourceOf(desc); }
        srcCopy.set(id, out);
        return out;
      };
      const vdef = variant.provenance && ((variant.provenance.default && variant.provenance.default.src) || (arr(variant.provenance.sources)[0] || {}).id);
      const defaultSrc = vdef ? srcOf(vdef) : null;
      const provOf = prov => {
        const p = prov ? clone(prov) : { op: 'generated' };
        if (p.src !== undefined) p.src = srcOf(p.src) || undefined;
        else if (defaultSrc) p.src = defaultSrc;
        if (p.src === undefined) delete p.src;
        if (isObj(p.asp)) Object.keys(p.asp).forEach(k => { if (isObj(p.asp[k]) && p.asp[k].src !== undefined) { p.asp[k].src = srcOf(p.asp[k].src) || undefined; if (p.asp[k].src === undefined) delete p.asp[k].src; } });
        return p;
      };

      /* ---- 3. voices: each variant voice used in the range takes the base voice of its staff with its label, else the next free one, else a new one */
      const voiceMap = new Map(), taken = new Set();
      const usedVoices = new Set();
      c.vPart.events.forEach(e => { const i = vIdx.get(e.m); if (i >= lo && i <= hi) usedVoices.add(e.voice); });
      const baseVoices = sid => part.voices.filter(v => v.staff === sid);
      c.vPart.voices.filter(v => usedVoices.has(v.id)).forEach(v => {
        const sid = c.staffMap.get(v.staff), pool = baseVoices(sid).filter(x => !taken.has(x.id));
        let pick = pool.find(x => x.label !== undefined && x.label === v.label) || pool[0];
        if (!pick) {
          const nid = d.addVoice(sid, v.label, part);
          pick = part.voices.find(x => x.id === nid);
          const st = part.staves.find(s => s.id === sid);
          if (st && st.limb) pick.limb = st.limb;
          info.voicesAdded++;
        }
        taken.add(pick.id);
        voiceMap.set(v.id, pick.id);
      });

      /* ---- 4. the variant's events of the range */
      const vRank = new Map(c.vPart.voices.map((v, i) => [v.id, i]));
      const evs = c.vPart.events.map((e, i) => ({ e: e, i: i })).filter(x => { const k = vIdx.get(x.e.m); return k >= lo && k <= hi; })
        .sort((a, b) => (vIdx.get(a.e.m) - vIdx.get(b.e.m)) || R.cmp(R.parse(a.e.at), R.parse(b.e.at)) || (vRank.get(a.e.voice) - vRank.get(b.e.voice)) || (a.i - b.i));
      const evMap = new Map(), hdMap = new Map();
      evs.forEach(({ e }) => {
        const x = clone(e);
        delete x.id;
        x.m = bm[vIdx.get(e.m)];
        x.voice = voiceMap.get(e.voice);
        x.staff = c.staffMap.get(e.staff);
        if (x.heads) x.heads = x.heads.map(h => { const y = clone(h); delete y.id; if (y.staff !== undefined) y.staff = c.staffMap.get(y.staff); y.prov = provOf(h.prov); return y; });
        x.prov = provOf(e.prov);
        const id = d.addEvent(part, x);
        evMap.set(e.id, id);
        const ne = d.ev.get(id).e;
        arr(e.heads).forEach((h, i) => hdMap.set(h.id, ne.heads[i].id));
        info.addedEvents++;
      });

      /* ---- 5. the variant's spanners of the range */
      const spMap = new Map(), pendingParent = [];
      const posIn = pos => { const i = vIdx.get(pos.m); return { m: bm[i], at: pos.at }; };
      const vW = pos => T.scorePos(variant, pos);
      c.vPart.spanners.forEach(sp => {
        const ns = clone(sp);
        delete ns.id;
        if (ns.prov) ns.prov = provOf(ns.prov);
        if (POSITION_SPANS.has(sp.type)) {
          const a = vW(sp.from), b = sp.to !== undefined ? vW(sp.to) : null;
          const A = R.gt(a, rsV) ? a : rsV, B = b === null || R.gt(b, reV) ? reV : b;
          if (!R.lt(A, B)) return;
          ns.from = R.gt(a, rsV) ? posIn(sp.from) : { m: bm[lo], at: '0' };
          if (b !== null && R.lt(b, reV)) ns.to = posIn(sp.to); else ns.to = { m: bm[hi], at: durStr(hi) };
          if (ns.changes) { ns.changes = arr(sp.changes).filter(ch => R.gt(vW(ch), A) && R.lt(vW(ch), B)).map(posIn); if (!ns.changes.length) delete ns.changes; }
          if (ns.staff !== undefined) ns.staff = c.staffMap.get(ns.staff);
          if (ns.staff === undefined) delete ns.staff;
          spMap.set(sp.id, d.addSpanner(part, ns));
          return;
        }
        const r = refsOf(sp);
        const has = r.ev.filter(x => evMap.has(x)).length + r.hd.filter(x => hdMap.has(x)).length;
        const all = r.ev.length + r.hd.length;
        if (!has) return;
        if (has < all) { if (sp.type === 'tie') info.variantTiesCut++; else if (sp.type === 'slur') info.variantSlursCut++; return; }
        if (sp.type === 'tie' || sp.type === 'gliss') { ns.from = hdMap.get(sp.from); ns.to = hdMap.get(sp.to); }
        else if (sp.type === 'slur') { ns.from = evMap.get(sp.from); ns.to = evMap.get(sp.to); }
        else if (sp.type === 'tuplet' || sp.type === 'beam') {
          ns.events = sp.events.map(x => evMap.get(x));
          if (ns.breaks) ns.breaks = sp.breaks.map(b => Object.assign({}, b, { after: evMap.get(b.after) }));
          if (sp.type === 'tuplet' && sp.parent !== undefined) { delete ns.parent; pendingParent.push(sp); }
        } else if (sp.type === 'arpeggio') ns.heads = sp.heads.map(x => hdMap.get(x));
        spMap.set(sp.id, d.addSpanner(part, ns));
      });
      pendingParent.forEach(sp => {
        const ns = part.spanners.find(x => x.id === spMap.get(sp.id));
        if (ns && spMap.has(sp.parent)) ns.parent = spMap.get(sp.parent);
      });

      /* ---- 7. clefs: the variant's, with the base's state carried in at the left seam and put back at the right one */
      const clefW = (g, cl) => T.scorePos(g, cl);
      const lastClef = (g, list) => list.reduce((best, cl) => {
        if (!best) return cl;
        const k = R.cmp(clefW(g, cl), clefW(g, best));
        return k > 0 || (k === 0 && idNum(cl.id) > idNum(best.id)) ? cl : best;
      }, null);
      c.vPart.staves.forEach((vs, si) => {
        const bs = part.staves[si];
        if (!bs || c.staffMap.get(vs.id) !== bs.id) return;
        const bList = c.bPart.clefs.filter(cl => cl.staff === bs.id), vList = c.vPart.clefs.filter(cl => cl.staff === vs.id);
        const bi = cl => bIdx.get(cl.m), vi = cl => vIdx.get(cl.m);
        const before = lastClef(base, bList.filter(cl => bi(cl) < lo));
        const endState = lastClef(base, bList.filter(cl => bi(cl) <= hi));
        const nextHas = bList.some(cl => bi(cl) === hi + 1 && R.eq(R.parse(cl.at), R.ZERO));
        const startV = lastClef(variant, vList.filter(cl => vi(cl) < lo || (vi(cl) === lo && R.eq(R.parse(cl.at), R.ZERO))));
        const copied = vList.filter(cl => vi(cl) >= lo && vi(cl) <= hi);
        bList.filter(cl => bi(cl) >= lo && bi(cl) <= hi).forEach(cl => { d.removeClef(part, cl.id); info.clefsRemoved++; });
        const add = (src, m, at) => {
          const x = { staff: bs.id, m: m, at: at, sign: src.sign };
          if (src.line !== undefined) x.line = src.line;
          if (src.octave !== undefined) x.octave = src.octave;
          d.addClef(part, x);
          info.clefsAdded++;
        };
        copied.forEach(cl => add(cl, bm[vi(cl)], cl.at));
        const atStart = copied.some(cl => vi(cl) === lo && R.eq(R.parse(cl.at), R.ZERO));
        if (!atStart && startV && !sameClef(before, startV)) add(startV, bm[lo], '0');
        const now = copied.length ? lastClef(variant, copied) : (startV || before);
        if (hasAfter && !nextHas && endState && now && !sameClef(now, endState)) add(endState, bm[hi + 1], '0');
      });

      /* ---- 8. directions: the base's stay; the variant's are added where the base has none of the kind */
      c.vPart.directions.forEach(dd => {
        const i = vIdx.get(dd.m);
        if (i === undefined || i < lo || i > hi || baseKinds.has(dd.kind)) return;
        const x = clone(dd);
        x.id = d.newId('d');
        x.m = bm[i];
        if (x.staff !== undefined) x.staff = c.staffMap.get(x.staff);
        if (x.voice !== undefined) x.voice = voiceMap.get(x.voice);
        if (x.event !== undefined) x.event = evMap.get(x.event);
        ['staff', 'voice', 'event'].forEach(k => { if (x[k] === undefined) delete x[k]; });
        if (x.prov) x.prov = provOf(x.prov);
        part.directions.push(x);
        info.directionsCopied++;
      });

      /* ---- 9. the copy says what it is */
      const params = { variantOf: { from: lo, to: hi, direction: opts.direction } };
      if (opts.songId !== undefined) params.variantOf.songId = String(opts.songId);
      if (opts.level !== undefined) params.variantOf.level = String(opts.level);
      params.requested = { from: c.lo0, to: c.hi0 };
      doc.provenance.sources.push({ id: d.newId('sr'), kind: 'generator', tool: TOOL, version: VERSION, params: params });
      d.touch();
      return info;
    });
    return { graph: res.graph, issues: res.issues, info: res.result };
  }

  /* G5 on the spliced graph: the hard violations beside the range and in it, told apart by where they came from.
     - inside the range, a violation the variant alone already has is the variant's (`own`); one it does not have is the left seam's
     - at or after bar hi + 1, one the base alone does not have is the right seam's */
  function hardCheck(c, graph, lo, hi, profile) {
    const sp = hardCounts(graph, hardOf(graph, profile)), vr = c.hardVariant(profile), br = c.hardBase(profile);
    let own = 0, left = 0, right = 0;
    sp.forEach((count, k) => {
      const i = keyBar(k);
      if (i >= lo && i <= hi) { const v = vr.get(k) || 0; if (count > v) left += count - v; }
      else if (i > hi) { const b = br.get(k) || 0; if (count > b) right += count - b; }
    });
    vr.forEach((count, k) => { const i = keyBar(k); if (i >= lo && i <= hi) own += count; });
    return { own: own, left: left, right: right };
  }

  /* step 4: what the splice introduced that neither source had */
  function verify(c, graph, issues, lo, hi, opts) {
    /* a warning moves with the thing it is about (an open pedal cut at the seam is the same open pedal, in another bar), so warnings are counted by code:
       the splice may have as many as the base had in all, and the variant's in the range */
    const byCode = (m, keep) => { const o = {}; m.forEach((n, k) => { if (keep(keyBar(k))) { const code = k.slice(k.indexOf('|') + 1); o[code] = (o[code] || 0) + n; } }); return o; };
    const bWarn = byCode(warningCounts(c.base, validationOf(c.base).issues), () => true);
    const vWarn = byCode(warningCounts(c.variant, validationOf(c.variant).issues), i => i >= lo && i <= hi);
    const sWarn = byCode(warningCounts(graph, issues), () => true);
    const badWarn = Object.keys(sWarn).filter(code => sWarn[code] > (bWarn[code] || 0) + (vWarn[code] || 0));
    if (badWarn.length) return { reason: 'VARIANT_INVALID', detail: 'the validator warns of ' + badWarn.slice(0, 4).join(', ') };
    const sHits = noteHits(noteCheckOf(graph)), bHits = noteHits(noteCheckOf(c.base)), vHits = noteHits(noteCheckOf(c.variant));
    const bad = [];
    sHits.forEach(k => {
      const i = keyBar(k), inside = i >= lo && i <= hi;
      if (!(inside ? vHits : bHits).has(k)) bad.push('class ' + k.split('|')[2] + ' in bar ' + (i + 1));
      else if (inside && opts.strictNotation) bad.push('class ' + k.split('|')[2] + ' in bar ' + (i + 1) + ' (the variant\'s)');
    });
    if (bad.length) return { reason: 'VARIANT_NOTATION', detail: 'the checker finds ' + bad.slice(0, 4).join(', ') };
    return null;
  }

  /* the hand that carries the passage in the base (for the alternative), from G6's per-measure hand */
  function handOf(c, weights, lo, hi) {
    try {
      const map = mapOf(c.base, weights);
      const w = { RH: 0, LH: 0 };
      for (let i = lo; i <= hi; i++) if (map[i] && (map[i].hand === 'RH' || map[i].hand === 'LH')) w[map[i].hand] += Math.max(0.001, map[i].score + 5);
      return w.LH > w.RH ? 'LH' : w.RH > w.LH ? 'RH' : 'both';
    } catch (e) { return 'both'; }
  }

  const meanScore = (map, lo, hi) => { let s = 0; for (let i = lo; i <= hi; i++) s += map[i].score; return s / (hi - lo + 1); };

  function splice(base, variant, opts) {
    opts = opts || {};
    const direction = opts.direction === 'harder' ? 'harder' : 'easier';
    const fail = (reason, detail, hand) => refuse(reason, detail, direction, hand);
    if (!R || !T || !O || !V || !PL || !NC || !DF || !DM) return fail('VARIANT_NOT_LOADED', 'a module of scoregraph/, playability/ or difficulty/ is missing');
    const weights = opts.weights || D.weights;
    if (!weights) return fail('VARIANT_NOT_LOADED', 'the G6 weights');
    const okGraph = g => isObj(g) && isObj(g.timeline) && Array.isArray(g.timeline.measures) && g.timeline.measures.length > 0 && Array.isArray(g.parts) && isObj(g.provenance);
    if (!okGraph(base) || !okGraph(variant)) return fail('VARIANT_ARGS', 'not two ScoreGraphs');
    if (opts.direction !== undefined && opts.direction !== 'easier' && opts.direction !== 'harder') return fail('VARIANT_ARGS', 'direction is easier or harder');
    const n = base.timeline.measures.length, lo0 = opts.from, hi0 = opts.to;
    if (!Number.isInteger(lo0) || !Number.isInteger(hi0) || lo0 < 0 || hi0 < lo0 || hi0 >= n) return fail('VARIANT_ARGS', 'from and to are bar indexes with 0 <= from <= to < ' + n);
    const profile = PL.reach.profileOf(opts.profile || 'large');

    const tl = timelineProblem(base, variant, lo0, hi0);
    if (tl) return fail('VARIANT_TIMELINE', tl);
    const bPart = keyboardPart(base), vPart = keyboardPart(variant);
    if (!bPart || !vPart) return fail('VARIANT_PARTS', 'no single keyboard part in ' + (!bPart ? 'the piece' : 'the variant'));
    if (vPart.staves.length > bPart.staves.length) return fail('VARIANT_STAVES', 'the variant has ' + vPart.staves.length + ' staves, the piece ' + bPart.staves.length);
    const staffMap = new Map();
    for (let i = 0; i < vPart.staves.length; i++) {
      const bs = bPart.staves[i], vs = vPart.staves[i];
      if (bs.limb && vs.limb && bs.limb !== vs.limb) return fail('VARIANT_STAVES', 'staff ' + (i + 1) + ' is the ' + bs.limb + ' of the piece and the ' + vs.limb + ' of the variant');
      staffMap.set(vs.id, bs.id);
    }

    /* the bars that really differ: the ends that sound the same are left alone */
    const bSound = soundByBar(base, bPart, lo0, hi0), vSound = soundByBar(variant, vPart, lo0, hi0);
    let lo = lo0, hi = hi0;
    while (lo <= hi && sameList(bSound[lo - lo0], vSound[lo - lo0])) lo++;
    while (hi >= lo && sameList(bSound[hi - lo0], vSound[hi - lo0])) hi--;
    const hand = handOf({ base: base }, weights, lo0, hi0);
    if (lo > hi) return fail('VARIANT_IDENTICAL', 'bars ' + (lo0 + 1) + '-' + (hi0 + 1) + ' sound the same in both', hand);

    const c = {
      base: base, variant: variant, bPart: bPart, vPart: vPart, staffMap: staffMap, lo0: lo0, hi0: hi0,
      bm: barIds(base), vm: barIds(variant), bIdx: indexOfIds(barIds(base)), vIdx: indexOfIds(barIds(variant)),
      bStart: [], vStart: [],
      hardBase: p => hardCounts(base, hardOf(base, p)), hardVariant: p => hardCounts(variant, hardOf(variant, p))
    };
    base.timeline.measures.forEach(m => c.bStart.push(T.measureStart(base, m.id)));
    variant.timeline.measures.forEach(m => c.vStart.push(T.measureStart(variant, m.id)));
    c.bStart.push(R.add(c.bStart[n - 1], R.parse(base.timeline.measures[n - 1].dur)));
    c.vStart.push(R.add(c.vStart[n - 1], R.parse(variant.timeline.measures[n - 1].dur)));
    const applied = { from: lo, to: hi };

    /* steps 2 and 3: build, look at the seams, widen where a hand cannot get across */
    let built = null, wl = 0, wr = 0;
    for (;;) {
      try { built = build(c, lo, hi, { direction: direction, songId: opts.songId, level: opts.level }); }
      catch (e) { return fail('VARIANT_INVALID', e && e.code ? e.code + ' ' + String(e.message).slice(0, 200) : String(e && e.message).slice(0, 200), hand); }
      const h = hardCheck(c, built.graph, lo, hi, profile);
      if (h.own > 0) return fail('VARIANT_HARD', h.own + ' hard violation(s) in the variant\'s own bars ' + (lo + 1) + '-' + (hi + 1), hand);
      if (!h.left && !h.right) break;
      if ((h.left && (wl >= WIDEN_MAX || lo === 0)) || (h.right && (wr >= WIDEN_MAX || hi === n - 1)))
        return fail('VARIANT_SEAM', 'a hand cannot cross the seam' + (h.left ? ' at bar ' + (lo + 1) : '') + (h.right ? ' after bar ' + (hi + 1) : '') + ' after ' + (wl + wr) + ' widening(s)', hand);
      if (h.left) { lo--; wl++; }
      if (h.right) { hi++; wr++; }
    }

    /* step 4 */
    const bad = verify(c, built.graph, built.issues, lo, hi, opts);
    if (bad) return fail(bad.reason, bad.detail, hand);

    /* step 5 */
    const mb = mapOf(base, weights), ms = DM.measureMap(DF.featuresOf(built.graph), weights);
    const sign = direction === 'easier' ? 1 : -1;
    /* the bars that differ are what moved (the ends that sound the same are left alone and would only dilute the mean) */
    const jf = applied.from, jt = applied.to;
    const before = meanScore(mb, jf, jt), after = meanScore(ms, jf, jt);
    const finalDelta = sign * (meanScore(mb, lo, hi) - meanScore(ms, lo, hi));
    const delta = sign * (before - after);
    const judge = { direction: direction, from: jf, to: jt, before: before, after: after, delta: delta, margin: JUDGE_MARGIN };
    if (!(delta >= JUDGE_MARGIN) || finalDelta < 0) return fail(direction === 'easier' ? 'VARIANT_NOT_EASIER' : 'VARIANT_NOT_HARDER', 'G6 local score of bars ' + (jf + 1) + '-' + (jt + 1) + ' ' + before.toFixed(2) + ' -> ' + after.toFixed(2) + ' (needs ' + (direction === 'easier' ? 'a drop' : 'a rise') + ' of ' + JUDGE_MARGIN + ')', hand);

    const info = built.info;
    const variantOf = { from: lo, to: hi, direction: direction };
    if (opts.songId !== undefined) variantOf.songId = String(opts.songId);
    if (opts.level !== undefined) variantOf.level = String(opts.level);
    return {
      ok: true, graph: built.graph, range: { from: lo0, to: hi0 }, applied: applied, final: { from: lo, to: hi },
      widened: { left: wl, right: wr }, judge: judge, variantOf: variantOf,
      seams: {
        tiesCut: info.tiesCut, slursCut: info.slursCut, otherCut: info.otherCut, variantTiesCut: info.variantTiesCut, variantSlursCut: info.variantSlursCut,
        pedalClipped: info.pedalClipped, ottavaClipped: info.ottavaClipped, wedgeClipped: info.wedgeClipped,
        clefsAdded: info.clefsAdded, clefsRemoved: info.clefsRemoved
      },
      stats: { removedEvents: info.removedEvents, addedEvents: info.addedEvents, voicesAdded: info.voicesAdded, directionsKept: info.directionsKept, directionsCopied: info.directionsCopied }
    };
  }

  return Object.freeze({ VERSION, TOOL, CODES, REASONS, WIDEN_MAX, TIMELINE_MARGIN, JUDGE_MARGIN, TEMPO_PERCENT, splice, soundByBar, timelineProblem });
});
