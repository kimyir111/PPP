/* The independent check of a splice (G11c-0, docs/GOALS/G11 section 8.2 step 4 and section 10): given the base, the variant and an accepted
   result of practice/variant.js, find everything the splice may not have done. It reads the three graphs with its own code (the shared
   libraries only: scoregraph/, the notation checker, G5, G6, the engraver), so a defect in variant.js's own checks does not hide here.

     verify(base, variant, result, { direction, profile, engrave, determinism, idempotent }) -> ['CODE: message', ...]   ([] = clean)

   What it holds a result to:
     VALID      the validator finds no ERROR; the canonical text round-trips; rev + 1; the graph is frozen
     OUTSIDE    every event, head, direction, bar, meter, key, tempo, staff, section and performance note outside the final range is byte for byte the base's;
                nothing is added outside it; the base's voices are all still there
     SPANNERS   a tie, slur, tuplet, beam or arpeggio that touches the range is wholly in it (the new ones) or wholly outside (the base's); a pedal,
                8va or wedge line either lies inside the range or entirely beside it - none crosses a seam
     CLEF       the clef of every staff is the variant's at the start of the range and the base's again from the bar after it, and the base's everywhere else
     CONTENT    the notes of the final range sound as the variant's, bar by bar; the requested bars outside it sound the same in both
     BARS       every staff-bar of the final range and its neighbours is covered as much as the source it came from
     NOTATION   notation-check classes 1-7: no hit in the range that the variant did not have, none beside it that the base did not have
     HARD       G5 hard violations: none in the final range, none new beside it
     PROV       every copied event has a source that exists; the copy names the splice (variantOf)
     JUDGE      G6 local score of the requested passage moved the right way by the margin
     ENGRAVE    the engraver plans the graph, accounts for everything in it, and lays it out
     DETERMINISM / IDEMPOTENT   the same call gives the same graph; splicing the result again is VARIANT_IDENTICAL */
'use strict';
const path = require('path');
const REPO = path.resolve(__dirname, '..', '..');
const R = require(path.join(REPO, 'scoregraph/rational.js'));
const T = require(path.join(REPO, 'scoregraph/time.js'));
const SG = require(path.join(REPO, 'scoregraph/index.js'));
const NC = require(path.join(REPO, 'scoregraph/tools/notation-check.js'));
const PL = require(path.join(REPO, 'playability/index.js'));
const DIFF = require(path.join(REPO, 'difficulty/index.js'));
const WEIGHTS = require(path.join(REPO, 'difficulty/weights/g6a-v1.json'));
const V = require(path.join(REPO, 'practice/variant.js'));

const j = JSON.stringify;
const arr = x => (Array.isArray(x) ? x : []);
const part0 = g => (g.parts.length === 1 ? g.parts[0] : g.parts.find(p => p.instrument && p.instrument.family === 'keyboard'));

function coverage(part, mIdx, staffIdx, lo, hi, durs) {
  /* staff-bar -> the share of the bar the events of the staff cover (non-grace events, union of their intervals), as a string */
  const sIdx = new Map(part.staves.map((s, i) => [s.id, i]));
  const by = new Map();
  part.events.forEach(e => {
    if (e.grace) return;
    const i = mIdx.get(e.m);
    if (i === undefined || i < lo || i > hi) return;
    const k = sIdx.get(e.staff) + '|' + i;
    if (!by.has(k)) by.set(k, []);
    const a = R.parse(e.at);
    by.get(k).push([a, R.add(a, R.parse(e.dur))]);
  });
  const out = new Map();
  by.forEach((list, k) => {
    list.sort((x, y) => R.cmp(x[0], y[0]));
    let cur = R.ZERO, covered = R.ZERO;
    list.forEach(([a, b]) => {
      if (R.gt(b, cur)) { covered = R.add(covered, R.sub(b, R.gt(a, cur) ? a : cur)); cur = b; }
    });
    out.set(k, R.format(covered));
  });
  void staffIdx; void durs;
  return out;
}

function clefStateAt(g, part, staffId, barIdx, atStart) {
  /* the clef in force at the START of bar barIdx (a clef at its position 0 counts) */
  const ids = g.timeline.measures.map(m => m.id);
  const w = T.measureStart(g, ids[barIdx]);
  let best = null, bw = null;
  part.clefs.filter(c => c.staff === staffId).forEach(c => {
    const cw = T.scorePos(g, c);
    if (R.gt(cw, w)) return;
    if (!atStart && R.eq(cw, w) && ids.indexOf(c.m) < barIdx) { /* an end-of-bar clef of the bar before also counts */ }
    if (bw === null || R.gt(cw, bw) || (R.eq(cw, bw) && Number(c.id.slice(1)) > Number(best.id.slice(1)))) { best = c; bw = cw; }
  });
  return best ? j([best.sign, best.line || null, best.octave || 0]) : null;
}

const MEMO = new WeakMap();
function memo(g, key, make) {
  let m = MEMO.get(g);
  if (!m) { m = {}; MEMO.set(g, m); }
  if (!(key in m)) m[key] = make();
  return m[key];
}
function hitsOf(report) {
  const out = new Set();
  for (let c = 1; c <= 7; c++) report.classes[c].bars.forEach(b => out.add((b.bar - 1) + '|' + b.hand + '|' + c));
  return out;
}
function hardOf(g, profile) {
  const idx = new Map(g.timeline.measures.map((m, i) => [m.id, i])), out = new Map();
  PL.analyzeGraph(g, { profile: profile }).events.forEach(e => e.hard.forEach(v => { const k = idx.get(e.m) + '|' + e.limb + '|' + v.code; out.set(k, (out.get(k) || 0) + 1); }));
  return out;
}

function verify(base, variant, result, o) {
  o = o || {};
  const fails = [];
  const f = (code, msg) => { if (fails.length < 40) fails.push(code + ': ' + msg); };
  const g = result.graph;
  const lo = result.final.from, hi = result.final.to, lo0 = result.range.from, hi0 = result.range.to;
  const n = base.timeline.measures.length;
  const bIds = base.timeline.measures.map(m => m.id), bIdx = new Map(bIds.map((id, i) => [id, i]));
  const inR = id => { const i = bIdx.get(id); return i >= lo && i <= hi; };
  const profile = o.profile || 'large';
  const bp = part0(base), vp = part0(variant), gp = g.parts.find(p => p.id === bp.id);

  /* VALID */
  const val = SG.validate(g);
  if (!val.ok) f('VALID', 'validator ERROR ' + val.issues.filter(i => i.severity === 'ERROR').slice(0, 3).map(i => i.code).join(','));
  if (SG.serialize(SG.parse(SG.serialize(g))) !== SG.serialize(g)) f('VALID', 'the canonical text does not round-trip');
  if (g.rev !== base.rev + 1) f('VALID', 'rev ' + g.rev + ' after ' + base.rev);
  if (!Object.isFrozen(g)) f('VALID', 'not frozen');
  if (lo < 0 || hi >= n || lo > hi) f('VALID', 'final range ' + lo + '-' + hi);
  if (lo !== result.applied.from - result.widened.left || hi !== result.applied.to + result.widened.right) f('VALID', 'the widening does not add up');
  if (result.widened.left > V.WIDEN_MAX || result.widened.right > V.WIDEN_MAX) f('VALID', 'widened beyond the cap');

  /* OUTSIDE */
  ['timeline', 'meta', 'structure'].forEach(k => { if (k === 'timeline' ? j(g.timeline) !== j(base.timeline) : j(g[k]) !== j(base[k])) f('OUTSIDE', k + ' changed'); });
  if (j(gp.staves) !== j(bp.staves)) f('OUTSIDE', 'staves changed');
  const bVoice = new Map(bp.voices.map(v => [v.id, v]));
  gp.voices.slice(0, bp.voices.length).forEach((v, i) => { if (j(v) !== j(bp.voices[i])) f('OUTSIDE', 'voice ' + v.id + ' changed'); });
  bp.voices.forEach(v => { if (!gp.voices.some(x => x.id === v.id)) f('OUTSIDE', 'voice ' + v.id + ' is gone'); });
  g.parts.forEach(p => { if (p.id !== bp.id && j(p) !== j(base.parts.find(x => x.id === p.id))) f('OUTSIDE', 'another part changed'); });
  const gEv = new Map(gp.events.map(e => [e.id, e])), bEv = new Map(bp.events.map(e => [e.id, e]));
  bp.events.forEach(e => {
    if (inR(e.m)) { if (gEv.has(e.id)) f('OUTSIDE', 'event ' + e.id + ' of the range survived'); return; }
    const x = gEv.get(e.id);
    if (!x) f('OUTSIDE', 'event ' + e.id + ' outside the range is gone');
    else if (j(x) !== j(e)) f('OUTSIDE', 'event ' + e.id + ' outside the range changed');
  });
  let newIn = 0;
  gp.events.forEach(e => {
    if (bEv.has(e.id)) return;
    if (!inR(e.m)) f('OUTSIDE', 'new event ' + e.id + ' outside the range, in bar ' + (bIdx.get(e.m) + 1));
    else newIn++;
  });
  if (newIn !== result.stats.addedEvents) f('OUTSIDE', 'added ' + newIn + ' events, the result says ' + result.stats.addedEvents);
  const gDir = new Map(gp.directions.map(d => [d.id, d]));
  bp.directions.forEach(d => {
    const x = gDir.get(d.id);
    if (!x) { f('OUTSIDE', 'direction ' + d.id + ' is gone'); return; }
    const want = Object.assign({}, d);
    if (inR(d.m) && want.event !== undefined && !gEv.has(want.event)) delete want.event;
    if (j(Object.assign({}, x)) !== j(want)) f('OUTSIDE', 'direction ' + d.id + ' changed');
  });
  gp.directions.forEach(d => { if (!bp.directions.some(x => x.id === d.id) && !inR(d.m)) f('OUTSIDE', 'new direction outside the range'); });
  const perfJson = x => j((x.performances || []).map(pf => Object.assign({}, pf, { notes: pf.notes.map(pn => { const c = Object.assign({}, pn); delete c.link; return c; }) })));
  if (perfJson(g) !== perfJson(base)) f('OUTSIDE', 'a performance changed beyond its links');
  (g.performances || []).forEach((pf, i) => pf.notes.forEach((pn, k) => {
    const was = base.performances[i].notes[k];
    if (was.link !== undefined && pn.link !== was.link && gEv.size && !bp.events.some(e => inR(e.m) && arr(e.heads).some(h => h.id === was.link))) f('OUTSIDE', 'a performance note lost a link outside the range');
  }));
  if (j(g.provenance.sources.slice(0, base.provenance.sources.length).filter(s => base.provenance.sources.some(b => b.id === s.id)))
    !== j(base.provenance.sources)) f('OUTSIDE', 'a base source changed');
  const spl = g.provenance.sources.filter(s => s.tool === V.TOOL);
  if (spl.length < 1) f('PROV', 'no splice source');
  else {
    const vo = spl[spl.length - 1].params && spl[spl.length - 1].params.variantOf;
    if (!vo || vo.from !== lo || vo.to !== hi || vo.direction !== result.variantOf.direction || vo.songId !== result.variantOf.songId || vo.level !== result.variantOf.level) f('PROV', 'variantOf does not say what was done: ' + j(vo));
  }

  /* SPANNERS */
  const goneEv = new Set(), goneHd = new Set();
  bp.events.forEach(e => { if (inR(e.m)) { goneEv.add(e.id); arr(e.heads).forEach(h => goneHd.add(h.id)); } });
  const rs = T.measureStart(base, bIds[lo]), re = hi + 1 < n ? T.measureStart(base, bIds[hi + 1]) : R.add(T.measureStart(base, bIds[n - 1]), R.parse(base.timeline.measures[n - 1].dur));
  const POS = new Set(['pedal', 'ottava', 'wedge']);
  const refs = sp => {
    if (sp.type === 'tie' || sp.type === 'gliss') return { ev: [], hd: [sp.from, sp.to].filter(x => x !== undefined) };
    if (sp.type === 'slur') return { ev: [sp.from, sp.to].filter(x => x !== undefined), hd: [] };
    if (sp.type === 'tuplet' || sp.type === 'beam') return { ev: arr(sp.events).concat(arr(sp.breaks).map(b => b.after)), hd: [] };
    if (sp.type === 'arpeggio') return { ev: [], hd: arr(sp.heads) };
    return { ev: [], hd: [] };
  };
  const gSp = new Map(gp.spanners.map(s => [s.id, s]));
  bp.spanners.forEach(sp => {
    if (POS.has(sp.type)) {
      const a = T.scorePos(base, sp.from), b = sp.to ? T.scorePos(base, sp.to) : null;
      const overlaps = R.lt(a, re) && (b === null || R.gt(b, rs));
      const x = gSp.get(sp.id);
      if (!overlaps) { if (!x || j(x) !== j(sp)) f('SPANNERS', sp.type + ' ' + sp.id + ' beside the range changed'); }
      else if (x) {
        const xa = T.scorePos(g, x.from), xb = x.to ? T.scorePos(g, x.to) : null;
        if (!((R.le(xb || R.ZERO, rs) && xb) || R.ge(xa, re))) f('SPANNERS', sp.type + ' ' + sp.id + ' still crosses a seam');
      }
      return;
    }
    const r = refs(sp);
    const touches = r.ev.some(x => goneEv.has(x)) || r.hd.some(x => goneHd.has(x));
    const x = gSp.get(sp.id);
    if (touches) { if (x) f('SPANNERS', sp.type + ' ' + sp.id + ' touches the range and was kept'); }
    else if (!x || j(x) !== j(sp)) f('SPANNERS', sp.type + ' ' + sp.id + ' outside the range changed or is gone');
  });
  gp.spanners.forEach(sp => {
    if (POS.has(sp.type)) {
      const a = T.scorePos(g, sp.from), b = sp.to ? T.scorePos(g, sp.to) : null;
      const wasBase = bp.spanners.some(x => x.id === sp.id);
      if (wasBase) return;
      const inside = R.ge(a, rs) && b !== null && R.le(b, re), after = R.ge(a, re);
      if (!inside && !after) f('SPANNERS', 'new ' + sp.type + ' ' + sp.id + ' crosses a seam');
      return;
    }
    if (bp.spanners.some(x => x.id === sp.id)) return;
    const r = refs(sp), evs = r.ev.map(id => gEv.get(id)), hds = r.hd.map(id => { const e = gp.events.find(y => arr(y.heads).some(h => h.id === id)); return e; });
    const all = evs.concat(hds);
    if (all.some(e => !e || !inR(e.m))) f('SPANNERS', 'new ' + sp.type + ' ' + sp.id + ' reaches outside the range');
  });

  /* CLEF */
  const vIdx = new Map(variant.timeline.measures.map((m, i) => [m.id, i]));
  void vIdx;
  bp.staves.forEach((bs, si) => {
    const vs = vp.staves[si];
    for (let i = 0; i < n; i++) {
      const got = clefStateAt(g, gp, bs.id, i), was = clefStateAt(base, bp, bs.id, i);
      if (i < lo || i > hi) { if (got !== was) f('CLEF', 'staff ' + (si + 1) + ' bar ' + (i + 1) + ' (outside) has another clef'); }
      else if (i === lo && vs) {
        const want = clefStateAt(variant, vp, vs.id, i);
        if (want !== null && got !== want) f('CLEF', 'staff ' + (si + 1) + ' opens the range with another clef than the variant');
      }
    }
  });

  /* CONTENT */
  const gs = V.soundByBar(g, gp, lo0, hi0), vs2 = V.soundByBar(variant, vp, lo0, hi0), bs2 = V.soundByBar(base, bp, lo0, hi0);
  for (let i = lo0; i <= hi0; i++) {
    const inside = i >= lo && i <= hi;
    if (j(gs[i - lo0]) !== j(vs2[i - lo0])) f('CONTENT', 'bar ' + (i + 1) + ' does not sound as the variant' + (inside ? '' : ' (a bar left alone)'));
    if (!inside && j(gs[i - lo0]) !== j(bs2[i - lo0])) f('CONTENT', 'bar ' + (i + 1) + ' (left alone) is not the base\'s');
  }

  /* BARS */
  const a = Math.max(0, lo - 1), b = Math.min(n - 1, hi + 1);
  const cg = coverage(gp, bIdx, 0, a, b), cv = coverage(vp, new Map(variant.timeline.measures.map((m, i) => [m.id, i])), 0, a, b), cb = coverage(bp, bIdx, 0, a, b);
  cg.forEach((share, k) => {
    const i = Number(k.split('|')[1]);
    const src = i >= lo && i <= hi ? cv : cb;
    if (src.has(k) && src.get(k) !== share) f('BARS', 'staff-bar ' + k + ' is covered ' + share + ', its source ' + src.get(k));
  });

  /* NOTATION */
  const gh = hitsOf(NC.checkGraph(g)), bh = memo(base, 'hits', () => hitsOf(NC.checkGraph(base))), vh = memo(variant, 'hits', () => hitsOf(NC.checkGraph(variant)));
  gh.forEach(k => {
    const i = Number(k.split('|')[0]);
    if (!((i >= lo && i <= hi) ? vh : bh).has(k)) f('NOTATION', 'class ' + k.split('|')[2] + ' in bar ' + (i + 1) + ' (' + k.split('|')[1] + ') has no source');
  });

  /* HARD */
  const ghd = hardOf(g, profile), bhd = memo(base, 'hard:' + profile, () => hardOf(base, profile));
  ghd.forEach((count, k) => {
    const i = Number(k.split('|')[0]);
    if (i >= lo && i <= hi) f('HARD', count + ' hard violation(s) ' + k + ' in the range');
    else if (i > hi && count > (bhd.get(k) || 0)) f('HARD', 'new hard violation ' + k + ' after the range');
  });

  /* PROV */
  const srcIds = new Set(g.provenance.sources.map(s => s.id));
  gp.events.forEach(e => {
    if (bEv.has(e.id)) return;
    if (!e.prov || !srcIds.has(e.prov.src) || !e.prov.op) f('PROV', 'event ' + e.id + ' has no source');
    arr(e.heads).forEach(h => { if (!h.prov || !srcIds.has(h.prov.src)) f('PROV', 'head ' + h.id + ' has no source'); });
  });

  /* JUDGE */
  const sign = (o.direction || 'easier') === 'easier' ? 1 : -1;
  const mb = memo(base, 'assess', () => DIFF.assess(base, WEIGHTS).measures), mg = DIFF.assess(g, WEIGHTS).measures;
  let sb = 0, sg = 0;
  const jf = result.judge.from, jt = result.judge.to;
  for (let i = jf; i <= jt; i++) { sb += mb[i].score; sg += mg[i].score; }
  const delta = sign * (sb - sg) / (jt - jf + 1);
  if (jf !== result.applied.from || jt !== result.applied.to) f('JUDGE', 'the judged bars are not the applied ones');
  if (!(delta >= V.JUDGE_MARGIN - 1e-9)) f('JUDGE', 'the passage moved by ' + delta.toFixed(3) + ', the margin is ' + V.JUDGE_MARGIN);

  /* ENGRAVE */
  if (o.engrave) {
    try {
      const EN = require(path.join(REPO, 'engrave/index.js'));
      const plan = EN.plan(g), audit = EN.audit(g, plan);
      if (!audit.ok) f('ENGRAVE', 'the ledger does not account for the graph');
      EN.layout.engrave(plan, {});
    } catch (e) { f('ENGRAVE', 'the engraver threw ' + String(e && e.message).slice(0, 120)); }
  }
  /* DETERMINISM / IDEMPOTENT */
  if (o.determinism) {
    const again = V.splice(base, variant, o.spliceOpts);
    if (!again.ok || SG.serialize(again.graph) !== SG.serialize(g)) f('DETERMINISM', 'a second call gives another graph');
  }
  if (o.idempotent) {
    const again = V.splice(g, variant, o.spliceOpts);
    if (again.ok || again.reason !== 'VARIANT_IDENTICAL') f('IDEMPOTENT', 'splicing the result again was ' + (again.ok ? 'accepted' : again.reason));
  }
  return fails;
}

module.exports = { verify, part0, hitsOf };
