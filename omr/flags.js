/* ============================================================================
   PPP OMR flags (docs/GOALS/G12_OMR.md section 8, phase G12-3 "Which bars are suspect")

   analyze(graph, opts?) -> { ok, bars: [...], suspect: [bar numbers], counts, confidence, params }

   An OMR engine reads some bars wrong and does not say which. This module looks at the ScoreGraph the import made (and at what the
   normaliser reported, and what the page shows) and marks the bars that may be wrong, with a reason a person can read. It is transparent
   on purpose: a list of named signals, each a plain fact about a bar ("the notes do not fill it", "the page shows 6 bars on this line and
   PPP read 5"), each STRONG or WEAK, and one rule:

       a bar is suspect when ANY strong signal fires, or TWO weak ones

   "This page was read badly as a whole" is itself a weak signal that every bar of such a page carries, so on a badly read page one more
   doubt is enough. Which signals are strong, which are weak and every threshold is in PARAMS, fitted on the tuning half of omr-live-2
   (tests/omr/node/flags-fit.js; the record is tests/omr/baselines/flags-fit.json, which a test compares with PARAMS) and judged once on the
   other half. Nothing here learns at run time. Pure (no DOM, no network, no clock), Node and browser, deterministic; it never throws.

   Inputs
     graph            a ScoreGraph (scoregraph/import.js)
     opts.normalize   omr/normalize.js `report`: its `flags` by bar number (what the normaliser repaired, merged, switched) and `structure`
     opts.layout      what the PAGES show: { pages: [[bars on system 1, bars on system 2, ...], ...] } (PdfLayer.layout), a page may be null
     opts.external    { "<bar number>": ["code" | {code, strength: 'strong'|'weak', text}] }: flags from outside (a second engine pass, the
                      app's own checks)
     opts.params      a PARAMS to use instead of the fitted ones (the fit tool, the tests)
   Output, per bar (1-based `n`): { n, suspect, strong: [codes], weak: [codes], reasons: [{code, strength, ...numbers}] }
   reasonText(reason, tx) is the sentence for the user (`tx` is the app's translator: ko, ja, zh, en)
   ========================================================================== */
(function (root, factory) {
  'use strict';
  let NC = null;
  if (typeof module === 'object' && module.exports) { try { NC = require('../scoregraph/tools/notation-check.js'); } catch (e) { NC = null; } }
  else NC = (root.PPPScoreGraphModules && root.PPPScoreGraphModules.notationCheck) || null;
  const api = factory(NC);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PPPOmrFlags = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (NC) {
  'use strict';

  const VERSION = 1;
  const EPS = 1e-4;
  const STEP = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 };
  const SEMI = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const MAJOR = [0, 2, 4, 5, 7, 9, 11];

  /* ---------------------------------------------------------------- parameters (fitted: see the header) */
  const PARAMS = {
    strong: ['fill-short', 'fill-over', 'fill-overlap', 'empty-staff', 'many-voices', 'tuplet'],
    weak: ['hands-cross', 'big-leap', 'sparse', 'voice-loss', 'dup-pitch', 'bad-page'],
    weakNeeded: 2,
    thr: { leap: 19, sparse: 0.6, voiceLoss: 1, badPage: 0.3, offKey: 2, ledger: 4, xMis: 20, dense: 1.6 }
  };

  /* ---------------------------------------------------------------- small helpers */
  const frac = s => {
    if (typeof s === 'number') return s;
    const m = /^(-?\d+)(?:\/(\d+))?$/.exec(String(s));
    return m ? (+m[1]) / (m[2] ? +m[2] : 1) : NaN;
  };
  const q = s => frac(s) * 4;                                      /* whole notes -> quarter notes */
  const near = (a, b) => Math.abs(a - b) < 1e-3;
  const midiOf = p => 12 * (p.oct + 1) + SEMI[p.step] + (p.alter || 0);
  const dposOf = p => p.oct * 7 + STEP[p.step];
  const median = a => { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y), n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; };

  /* the bottom staff line of a clef as a diatonic position (octave * 7 + step): G on line 2 -> E4, F on line 4 -> G2, C on line 3 -> F3 */
  function clefBottom(cl) {
    if (!cl || !cl.sign) return 30;
    const sign = String(cl.sign).toUpperCase();
    const line = Number.isInteger(cl.line) ? cl.line : (sign === 'F' ? 4 : sign === 'C' ? 3 : 2);
    const ref = sign === 'F' ? 3 * 7 + 3 : sign === 'C' ? 4 * 7 : 4 * 7 + 4;
    let b = ref - 2 * (line - 1);
    if (Number.isInteger(cl.octaveChange)) b += 7 * cl.octaveChange;
    return b;
  }
  /* ledger lines a note sits beyond its staff */
  function ledgers(dpos, bottom) {
    if (dpos >= bottom + 10) return Math.floor((dpos - (bottom + 8)) / 2);
    if (dpos <= bottom - 2) return Math.floor((bottom - dpos) / 2);
    return 0;
  }

  /* ---------------------------------------------------------------- the graph, read once */
  function readGraph(g) {
    const M = (g.timeline && g.timeline.measures) || [];
    const n = M.length;
    const mIdx = new Map(M.map((m, i) => [m.id, i]));
    const barQ = M.map(m => q(m.dur));
    const order = (a, b) => (mIdx.get(a.m) || 0) - (mIdx.get(b.m) || 0) || frac(a.at || 0) - frac(b.at || 0);
    const meters = ((g.timeline && g.timeline.meters) || []).slice().sort(order);
    const keys = ((g.timeline && g.timeline.keys) || []).slice().sort(order);
    const nomQ = [], fifths = [];
    let mi = 0, ki = 0, meter = null, key = 0;
    for (let i = 0; i < n; i++) {
      while (mi < meters.length && (mIdx.get(meters[mi].m) || 0) <= i) meter = meters[mi++];
      while (ki < keys.length && (mIdx.get(keys[ki].m) || 0) <= i) { if (Number.isInteger(keys[ki].fifths)) key = keys[ki].fifths; ki++; }
      nomQ.push(meter && Array.isArray(meter.beats) && meter.beatType ? meter.beats.reduce((s, x) => s + x, 0) * 4 / meter.beatType : barQ[i]);
      fifths.push(key);
    }
    return { M, n, mIdx, barQ, nomQ, fifths, parts: g.parts || [] };
  }

  /* ---------------------------------------------------------------- feature extraction: facts about each bar, no thresholds */
  function newBar() {
    return {
      hole: 0, short: 0, over: 0, overlap: 0, lenDiff: 0, emptyStaff: 0, voices: 0, vb: 0, notes: 0, heads: 0, chordMax: 0,
      ledger: 0, cross: 0, leap: 0, offKey: 0, dup: 0, xMis: 0, nc5: 0, nc6: 0, nc7: 0, nc8: 0,
      lo1: null, hi1: null, lo2: null, hi2: null, width: null, onsets: 0, sys: 0, sysBars: 0, sysPos: 0
    };
  }

  function extract(graph) {
    const R = readGraph(graph);
    const n = R.n;
    const bars = [];
    for (let i = 0; i < n; i++) bars.push(newBar());
    if (!n) return { bars, doc: { bars: 0, systems: 0 } };

    const pickup = !!R.M[0].implicit && R.barQ[0] < R.nomQ[0] - EPS;
    /* the length each bar's voices are held to: the metre's; a pickup is as long as it is */
    const lenOf = i => (i === 0 && pickup ? R.barQ[0] : R.nomQ[i]);
    const pickupGap = pickup ? R.nomQ[0] - R.barQ[0] : 0;           /* what the last bar of such a piece lacks */
    for (let i = 0; i < n; i++) bars[i].lenDiff = Math.round((R.barQ[i] - lenOf(i)) * 1e4) / 1e4;

    R.parts.forEach(part => {
      const staves = part.staves || [];
      const staffIdx = new Map(staves.map((s, k) => [s.id, k]));
      const clefs = new Map();
      (part.clefs || []).forEach(c => { if (!clefs.has(c.staff)) clefs.set(c.staff, []); clefs.get(c.staff).push(c); });
      clefs.forEach(list => list.sort((a, b) => (R.mIdx.get(a.m) || 0) - (R.mIdx.get(b.m) || 0) || frac(a.at || 0) - frac(b.at || 0)));
      const clefAt = (staff, i) => { const l = clefs.get(staff) || []; let c = null; for (const x of l) { if ((R.mIdx.get(x.m) || 0) <= i) c = x; else break; } return c; };

      const byBar = [];
      for (let i = 0; i < n; i++) byBar.push(new Map());
      (part.events || []).forEach(e => {
        const i = R.mIdx.get(e.m);
        if (i === undefined || (e.kind !== 'note' && e.kind !== 'rest')) return;
        const k = staffIdx.has(e.staff) ? staffIdx.get(e.staff) : 0;
        const vk = k + '|' + e.voice;
        if (!byBar[i].has(vk)) byBar[i].set(vk, { staff: k, evs: [] });
        byBar[i].get(vk).evs.push(e);
      });

      /* 1. does each voice fill its bar */
      for (let i = 0; i < n; i++) {
        const b = bars[i], len = lenOf(i);
        const staffHas = new Set(), perStaff = new Map();
        byBar[i].forEach(vb => {
          const evs = vb.evs.filter(e => !e.grace).sort((x, y) => frac(x.at) - frac(y.at));
          if (!evs.length) return;
          staffHas.add(vb.staff);
          perStaff.set(vb.staff, (perStaff.get(vb.staff) || 0) + 1);
          if (evs.some(e => e.kind === 'note')) b.vb++;
          let cur = 0, hole = 0, overlap = 0;
          for (const e of evs) {
            if (e.display && e.display.measureRest) { cur = Math.max(cur, len); continue; }
            const at = q(e.at);
            if (at > cur + EPS) hole += at - cur;
            else if (at < cur - EPS) overlap += cur - at;
            cur = at + q(e.dur);
          }
          const closes = i === n - 1 && pickupGap > EPS && near(cur, pickupGap);        /* the last bar holds what the pickup lacks */
          b.hole = Math.max(b.hole, hole);
          b.overlap = Math.max(b.overlap, overlap);
          if (!closes && cur < len - EPS) b.short = Math.max(b.short, len - cur);
          if (cur > len + EPS) b.over = Math.max(b.over, cur - len);
        });
        staves.forEach((s, k) => { if (!staffHas.has(k)) b.emptyStaff++; });
        perStaff.forEach(c => { b.voices = Math.max(b.voices, c); });
      }

      /* 2. what the notes are: registers, ledger lines, off-key notes, leaps, doubled pitches, how the page spaces them */
      const byBarNotes = [];
      for (let i = 0; i < n; i++) byBarNotes.push([]);
      (part.events || []).forEach(e => {
        const i = R.mIdx.get(e.m);
        if (i !== undefined && e.kind === 'note' && !e.grace && e.heads && e.heads.length) byBarNotes[i].push(e);
      });
      const lastTop = new Map();                                       /* voice -> its last top pitch, carried over the bar line */
      const scale = new Set();
      for (let i = 0; i < n; i++) {
        const b = bars[i];
        scale.clear();
        MAJOR.forEach(s => scale.add((((s + 7 * R.fifths[i]) % 12) + 12) % 12));
        const evs = byBarNotes[i].slice().sort((x, y) => frac(x.at) - frac(y.at));
        const vlast = new Map(), seen = new Set(), at = new Map();
        evs.forEach(e => {
          const k = staffIdx.has(e.staff) ? staffIdx.get(e.staff) : 0;
          const midis = e.heads.map(h => midiOf(h.pitch));
          const lo = Math.min.apply(null, midis), hi = Math.max.apply(null, midis);
          b.notes++;
          b.heads += e.heads.length;
          b.chordMax = Math.max(b.chordMax, e.heads.length);
          const bottom = clefBottom(clefAt(e.staff, i));
          e.heads.forEach((h, hn) => {
            const pk = k + '|' + e.at + '|' + midis[hn];
            if (seen.has(pk)) b.dup++; else seen.add(pk);
            b.ledger = Math.max(b.ledger, ledgers(dposOf(h.pitch), bottom));
            if (!scale.has(((midis[hn] % 12) + 12) % 12)) b.offKey++;
          });
          const hk = k === 0 ? '1' : '2';
          b['lo' + hk] = b['lo' + hk] === null ? lo : Math.min(b['lo' + hk], lo);
          b['hi' + hk] = b['hi' + hk] === null ? hi : Math.max(b['hi' + hk], hi);
          const vk = k + '|' + e.voice;
          const prev = vlast.has(vk) ? vlast.get(vk) : lastTop.get(vk);
          if (prev !== undefined && e.heads.length === 1) b.leap = Math.max(b.leap, Math.abs(midis[0] - prev));
          vlast.set(vk, hi);
          if (e.display && Number.isFinite(e.display.x)) {
            const key = Math.round(q(e.at) * 1000);
            if (!at.has(key)) at.set(key, []);
            at.get(key).push(e.display.x);
          }
        });
        vlast.forEach((v, k) => lastTop.set(k, v));
        at.forEach(list => { if (list.length > 1) b.xMis = Math.max(b.xMis, Math.max.apply(null, list) - Math.min.apply(null, list)); });
        if (b.lo1 !== null && b.hi2 !== null && b.lo1 < b.hi2) b.cross = 1;
      }
    });

    /* 3. the engine's own layout: which bars start a system, how wide the page drew each, how many onsets it holds */
    const onsets = bars.map(() => new Set());
    R.parts.forEach(part => (part.events || []).forEach(e => { const i = R.mIdx.get(e.m); if (i !== undefined && e.kind === 'note') onsets[i].add(String(e.at)); }));
    let sys = -1, pos = 0;
    R.M.forEach((m, i) => {
      const lay = m.layout || {};
      if (i === 0 || lay.newSystem || lay.newPage) { sys++; pos = 0; }
      bars[i].sys = sys;
      bars[i].sysPos = pos++;
      bars[i].width = Number.isFinite(lay.width) ? lay.width : null;
      bars[i].onsets = onsets[i].size;
    });
    const count = new Map();
    bars.forEach(b => count.set(b.sys, (count.get(b.sys) || 0) + 1));
    bars.forEach(b => { b.sysBars = count.get(b.sys); });

    /* 4. notation-check classes 5-8 (the shared checker; absent in a page that did not load it) */
    if (NC && NC.checkGraph) {
      try {
        const r = NC.checkGraph(graph, {});
        [5, 6, 7, 8].forEach(c => r.classes[c].bars.forEach(x => { const b = bars[x.bar - 1]; if (b) b['nc' + c]++; }));
      } catch (e) { /* a graph the checker cannot read: the other signals stand */ }
    }
    return { bars, doc: { bars: n, systems: bars[n - 1].sys + 1 } };
  }

  /* ---------------------------------------------------------------- what is relative: the document's and the neighbours' */
  function derive(feat) {
    const bars = feat.bars, n = bars.length;
    const heads = bars.map(b => b.heads).filter(h => h > 0), vbs = bars.map(b => b.vb).filter(v => v > 0);
    feat.doc.medHeads = median(heads);
    feat.doc.medVb = median(vbs);
    bars.forEach((b, i) => {
      const nb = [];
      for (let j = Math.max(0, i - 2); j <= Math.min(n - 1, i + 2); j++) if (j !== i && bars[j].heads > 0) nb.push(bars[j].heads);
      b.hLocal = nb.length >= 2 && b.heads > 0 ? b.heads / median(nb) : 1;
      b.vbDoc = feat.doc.medVb && b.notes > 0 ? b.vb / feat.doc.medVb : 1;
    });
    return feat;
  }

  /* ---------------------------------------------------------------- the signals */
  /* code -> { test(bar, ctx) -> null | numbers for the reason }. Whether a signal is strong, weak or not used at all is PARAMS' business. */
  const SIGNALS = {
    'fill-short': { test: b => (b.short > EPS || b.hole > EPS) ? { beats: Math.max(b.short, b.hole) } : null },
    'fill-over': { test: b => (b.over > EPS || b.lenDiff > EPS) ? { beats: Math.max(b.over, b.lenDiff) } : null },
    'fill-overlap': { test: b => b.overlap > EPS ? { beats: b.overlap } : null },
    'empty-staff': { test: b => b.emptyStaff > 0 ? {} : null },
    'many-voices': { test: b => b.voices >= 3 ? { voices: b.voices } : null },
    'tuplet': { test: b => b.nc7 > 0 ? {} : null },
    'value': { test: b => b.nc6 > 0 ? {} : null },
    'sum-mismatch': { test: b => b.nc5 > 0 ? {} : null },
    'same-note': { test: b => b.nc8 > 0 ? {} : null },
    'x-misaligned': { test: (b, c) => b.xMis >= c.thr.xMis ? { x: b.xMis } : null },
    'hands-cross': { test: b => b.cross > 0 ? {} : null },
    'big-leap': { test: (b, c) => b.leap >= c.thr.leap ? { semitones: b.leap } : null },
    'sparse': { test: (b, c) => b.hLocal <= c.thr.sparse ? {} : null },
    'dense': { test: (b, c) => b.hLocal >= c.thr.dense ? {} : null },
    'voice-loss': { test: (b, c) => b.vbDoc < c.thr.voiceLoss ? {} : null },
    'dup-pitch': { test: b => b.dup > 0 ? {} : null },
    'off-key': { test: (b, c) => b.offKey >= c.thr.offKey ? { notes: b.offKey } : null },
    'ledger': { test: (b, c) => b.ledger >= c.thr.ledger ? { lines: b.ledger } : null },
    /* the normaliser's own record of what it did to a bar (omr/normalize.js report.flags) */
    'rebuilt': { test: (b, c) => c.n.indexOf('pair-merged') >= 0 || c.n.indexOf('folded') >= 0 ? {} : null },
    'switched': { test: (b, c) => c.n.indexOf('source-switch') >= 0 ? {} : null },
    'repaired': { test: (b, c) => c.n.indexOf('divisions-repaired') >= 0 || c.n.indexOf('duration-repaired') >= 0 ? {} : null },
    'unreadable-lengths': { test: (b, c) => c.n.indexOf('divisions-unknown') >= 0 || c.n.indexOf('duration-zero') >= 0 ? {} : null },
    'dropped': { test: (b, c) => c.n.indexOf('overlap') >= 0 ? {} : null },
    'fragmented': { test: (b, c) => c.n.indexOf('parts-fragmented') >= 0 ? {} : null },
    'joined': { test: (b, c) => c.n.indexOf('movement-start') >= 0 ? {} : null },
    /* what the pages show */
    'page-bars': { test: (b, c) => c.shown ? { shown: c.shown.shown, read: c.shown.read } : null },
    /* the page as a whole, and the bar's neighbours */
    'bad-page': { test: (b, c) => c.badPage ? { share: c.badPage } : null },
    'next-to-bad': { test: (b, c) => c.nextToBad ? {} : null }
  };
  const CODES = Object.keys(SIGNALS);

  /* ---------------------------------------------------------------- the rule */
  function normFlags(report) {
    const f = report && report.flags;
    return f && typeof f === 'object' ? f : {};
  }

  /* what the pages show against what was read: { barNumber: {shown, read} } for every bar of a system whose bar count differs */
  function pageBarsCheck(bars, report, layout) {
    const out = {};
    if (!layout || !Array.isArray(layout.pages) || !report || !Array.isArray(report.structure)) return out;
    /* which bars belong to which page: the movements are in page order and each says how many bars it holds */
    const pageOf = new Array(bars.length).fill(null);
    let at = 0;
    report.structure.forEach(m => {
      for (let k = 0; k < m.bars && at < bars.length; k++) pageOf[at++] = m.page;
    });
    const pages = new Map();
    pageOf.forEach((p, i) => { if (p === null) return; if (!pages.has(p)) pages.set(p, []); pages.get(p).push(i); });
    pages.forEach((idx, p) => {
      const shown = layout.pages[p];
      if (!Array.isArray(shown) || !shown.length) return;
      /* the page's systems as read: runs of bars from one new-system mark to the next */
      const read = [];
      idx.forEach((i, k) => {
        if (k === 0 || bars[i].sysPos === 0) read.push([]);
        read[read.length - 1].push(i);
      });
      if (read.length === shown.length) {
        read.forEach((list, s) => { if (list.length !== shown[s]) list.forEach(i => { out[i + 1] = { shown: shown[s], read: list.length }; }); });
      } else {
        const total = shown.reduce((a, c) => a + c, 0);
        if (total !== idx.length) idx.forEach(i => { out[i + 1] = { shown: total, read: idx.length, page: true }; });
      }
    });
    return out;
  }

  function decide(feat, ctx, params) {
    const P = params || PARAMS;
    const bars = feat.bars, n = bars.length;
    ctx = ctx || {};
    const nflags = normFlags(ctx.normalize);
    const shownAt = pageBarsCheck(bars, ctx.normalize, ctx.layout);
    const external = ctx.external && typeof ctx.external === 'object' ? ctx.external : {};
    const strongSet = new Set(P.strong), weakSet = new Set(P.weak);
    const thr = P.thr;
    const tag = (code, r) => Object.assign({ code: code, strength: strongSet.has(code) ? 'strong' : 'weak' }, r);
    /* pass 1: the signals that look at one bar only; the page-wide and the neighbours' come from them */
    const fired = bars.map((b, i) => {
      const c = { thr, n: nflags[i + 1] || [], shown: shownAt[i + 1] || null, badPage: 0, nextToBad: false };
      const list = [];
      CODES.forEach(code => {
        if (code === 'bad-page' || code === 'next-to-bad' || !(strongSet.has(code) || weakSet.has(code))) return;
        const r = SIGNALS[code].test(b, c);
        if (r) list.push(tag(code, r));
      });
      return list;
    });
    const isStrong = i => fired[i].some(r => r.strength === 'strong') || (external[i + 1] || []).some(x => x && typeof x === 'object' && x.strength === 'strong');
    const share = n ? bars.reduce((s, b, i) => s + (isStrong(i) ? 1 : 0), 0) / n : 0;
    const badPage = share >= thr.badPage ? share : 0;
    return bars.map((b, i) => {
      const list = fired[i].slice();
      const c = { thr, n: [], shown: null, badPage, nextToBad: (i > 0 && isStrong(i - 1)) || (i + 1 < n && isStrong(i + 1)) };
      ['bad-page', 'next-to-bad'].forEach(code => {
        if (!(strongSet.has(code) || weakSet.has(code))) return;
        const r = SIGNALS[code].test(b, c);
        if (r) list.push(tag(code, r));
      });
      (external[i + 1] || []).forEach(x => {
        const o = typeof x === 'string' ? { code: x } : x;
        if (o && typeof o === 'object' && o.code) list.push({ code: String(o.code), strength: o.strength === 'strong' ? 'strong' : 'weak', text: o.text ? String(o.text) : undefined, external: true });
      });
      const strong = list.filter(r => r.strength === 'strong'), weak = list.filter(r => r.strength === 'weak');
      return { n: i + 1, suspect: strong.length > 0 || weak.length >= P.weakNeeded, strong: strong.map(r => r.code), weak: weak.map(r => r.code), reasons: list };
    });
  }

  /* the report's confidence is never 0.85 ("good") when any bar is suspect (gate A3); more suspect bars lower it further */
  const GOOD = 0.85;
  function confidenceOf(suspectCount, barCount, base) {
    const b = typeof base === 'number' && isFinite(base) ? base : 1;
    if (!suspectCount) return b;
    const share = suspectCount / Math.max(1, barCount);
    return Math.max(0.05, Math.min(b, GOOD - 0.01 - 0.6 * share));
  }

  function analyze(graph, opts) {
    opts = opts || {};
    let feat;
    try { feat = derive(extract(graph)); } catch (e) { return { ok: false, error: 'internal-error', detail: String(e && e.message || e).slice(0, 160), bars: [], suspect: [], counts: {}, confidence: null }; }
    const params = opts.params || PARAMS;
    const bars = decide(feat, { normalize: opts.normalize, layout: opts.layout, external: opts.external }, params);
    const suspect = bars.filter(b => b.suspect).map(b => b.n);
    const counts = {};
    bars.forEach(b => b.reasons.forEach(r => { counts[r.code] = (counts[r.code] || 0) + 1; }));
    return { ok: true, version: VERSION, bars, suspect, counts, confidence: confidenceOf(suspect.length, bars.length, 1), features: feat, params };
  }

  return { VERSION, PARAMS, SIGNALS, CODES, GOOD, extract, derive, decide, analyze, confidenceOf, pageBarsCheck, midiOf, clefBottom, ledgers };
});
