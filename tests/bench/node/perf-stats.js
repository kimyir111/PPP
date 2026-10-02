#!/usr/bin/env node
/* G10a-0 calibration statistics (docs/GOALS/G10 section 7.3, section 15 step 2).

   Aggregate statistics of a transcription's performance layer: what a humanizer must reproduce. Deterministic,
   no network, no dependency outside this file. The output holds counts, shares, moments and quantiles only: never
   a note, a title, a pitch or a time of a note (a real transcription of a copyrighted recording must stay out of
   the repository, G10-D15).

     node perf-stats.js <input.json> [--engine NAME] [--frame 0.032] [--source LABEL] [--out FILE]
     node perf-stats.js --replay <dir with replay fixtures> [--out FILE]

   Input, one of
     a ScoreGraph with a `source` performance (performances[0]: notes in microseconds, each linked to a head,
       bar anchors) - the statistics read the written position of every linked note from its head's event;
     a flat input  {notes: [{on, off, midi, vel, hand: 'RH'|'LH', w}], anchors: [{w, s}], tuplets?: {...}}
       with times in seconds, `w` the written position in whole notes, `anchors` the written position -> seconds
       map (at least two). This is what the benchmark's humanizer is checked with (the truth is known there).
   --replay: committed replay fixtures (rendered audio through the real helper): the transcription's error against
       the truth that rendered it (matched by pitch and onset within 50 ms).

   The statistics are those of scratchpad/g10/calib.js and grid.js (the G10 design's reference implementation),
   so the teacher's transcription gives the design's numbers (E5). */
'use strict';
const fs = require('fs');
const path = require('path');

const SCHEMA = 'ppp.perf-stats/1';
const FREE_ATTACKS = 12;
const KNOTS = [0, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95, 1];

// ---------------------------------------------------------------- small helpers
const q = (xs, p) => {
  if (!xs.length) return null;
  const s = xs.slice().sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))))];
};
const mean = xs => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const sd = xs => { const m = mean(xs); return Math.sqrt(mean(xs.map(x => (x - m) * (x - m)))); };
const r3 = x => (x === null || x === undefined || Number.isNaN(x)) ? null : Math.round(x * 1000) / 1000;
const share = (n, d) => d ? Math.round(1e4 * n / d) / 1e4 : null;
const ms = x => x === null ? null : r3(x * 1000);
const table = xs => xs.length ? KNOTS.map(p => r3(q(xs, p))) : null;
const rat = s => { const [a, b] = String(s).split('/'); return b ? +a / +b : +a; };

// ---------------------------------------------------------------- graph -> flat
function flatFromGraph(g) {
  const pf = (g.performances || []).find(p => p.kind === 'source') || (g.performances || [])[0];
  if (!pf) throw new Error('the graph has no performance layer');
  const measures = g.timeline.measures;
  const mIdx = {}, mStart = [];
  let acc = 0;
  measures.forEach((m, i) => { mIdx[m.id] = i; mStart[i] = acc; acc += rat(m.dur); });
  const headEv = {}, limb = {}, tup = [], evById = {};
  (g.parts || []).forEach(part => {
    (part.staves || []).forEach(s => { limb[s.id] = s.limb; });
    (part.events || []).forEach(e => { evById[e.id] = e; (e.heads || []).forEach(h => { headEv[h.id] = e; }); });
    (part.spanners || []).forEach(s => { if (s.type === 'tuplet') tup.push(s); });
  });
  const notes = [];
  let unlinked = 0;
  pf.notes.forEach(pn => {
    const e = pn.link ? headEv[pn.link] : null;
    const base = { on: pn.on / 1e6, off: pn.off / 1e6, midi: pn.midi, vel: pn.vel };
    if (!e || mIdx[e.m] === undefined) { unlinked++; notes.push(Object.assign(base, { hand: null, w: null })); return; }
    notes.push(Object.assign(base, { hand: limb[e.staff] === 'LH' ? 'LH' : 'RH', w: mStart[mIdx[e.m]] + rat(e.at) }));
  });
  const anchors = (pf.anchors || []).filter(a => mIdx[a.m] !== undefined).map(a => ({ w: mStart[mIdx[a.m]] + rat(a.at), s: a.us / 1e6, kind: a.kind || 'bar' }));
  const tupBars = new Set(), tupBeats = new Set();
  tup.forEach(s => {
    const e = evById[s.events[0]];
    if (!e) return;
    tupBars.add(e.m);
    tupBeats.add(e.m + '|' + e.staff + '|' + Math.floor(rat(e.at) * 4));
  });
  const nStaves = Math.max(1, new Set(Object.keys(limb).map(k => limb[k])).size);
  return {
    notes, anchors, unlinked, engine: (pf.src && (pf.src.engine || pf.src.name)) || null,
    tuplets: { spanners: tup.length, barsWithTriplet: tupBars.size, bars: measures.length, staffBeatsTriplet: tupBeats.size,
               staffBeats: measures.length * 4 * nStaves },
  };
}

// ---------------------------------------------------------------- the statistics
/* collect: the raw samples of one piece; summarize: the statistics of one or several pieces pooled (the calibration
   test pools 20 humanized pieces; a real transcription is one piece). */
function collect(flat, opts) {
  const frame = (opts && opts.frame) || 0.032;
  const heard = flat.notes.slice();
  const R = { frame, engine: flat.engine || null, heard: heard.length, onGrid: 0, offGrid: 0, dur: [], vel: [], span: 0, clusters: 0, spreads: [],
              barDur: [], ratios: [], resid: [], rel: { RH: { r: [], gaps: [], overl: [] }, LH: { r: [], gaps: [], overl: [] } },
              free: { RH: { r: [], gaps: [], overl: [] }, LH: { r: [], gaps: [], overl: [] } },
              cls: { attacks: 0, beat: 0, eighth: 0, sixteenth: 0, third: 0, other: 0 }, ghosts: 0, restrike: 0, overlapSame: 0,
              hand: { RH: 0, LH: 0, cross: 0, both: 0 }, rep: { n: 0, same: 0, n3: 0, within3: 0 }, tuplets: flat.tuplets || null, unlinked: flat.unlinked || 0 };
  heard.forEach(n => {
    if (Math.abs(n.on / frame - Math.round(n.on / frame)) < 1e-4) R.onGrid++;
    if (Math.abs(n.off / frame - Math.round(n.off / frame)) < 1e-4) R.offGrid++;
    R.dur.push(n.off - n.on); R.vel.push(n.vel);
  });
  const sorted = heard.slice().sort((a, b) => a.on - b.on);
  R.span = sorted[sorted.length - 1].on - sorted[0].on;
  const clusters = [];
  let cur = null;
  sorted.forEach(n => { if (!cur || n.on - cur.t0 > 0.05) { cur = { t0: n.on, notes: [n] }; clusters.push(cur); } else cur.notes.push(n); });
  R.clusters = clusters.length;
  clusters.filter(c => c.notes.length > 1).forEach(c => R.spreads.push(Math.max(...c.notes.map(n => n.on)) - Math.min(...c.notes.map(n => n.on))));

  const anc = flat.anchors.slice().sort((a, b) => a.w - b.w);
  if (anc.length < 2) throw new Error('at least two anchors are needed');
  const wToS = w => { let i = 0; while (i < anc.length - 2 && anc[i + 1].w <= w) i++; const a = anc[i], b = anc[i + 1]; return a.s + (w - a.w) * (b.s - a.s) / (b.w - a.w); };
  const sToW = s => { let i = 0; while (i < anc.length - 2 && anc[i + 1].s <= s) i++; const a = anc[i], b = anc[i + 1]; return a.w + (s - a.s) * (b.w - a.w) / (b.s - a.s); };
  const bar = anc.filter(a => (a.kind || 'bar') === 'bar');
  const useA = bar.length >= 3 ? bar : anc;
  for (let i = 1; i < useA.length; i++) R.barDur.push((useA[i].s - useA[i - 1].s) / (useA[i].w - useA[i - 1].w));
  for (let i = 1; i < R.barDur.length; i++) R.ratios.push(R.barDur[i] / R.barDur[i - 1]);
  R.cv = sd(R.barDur) / mean(R.barDur);
  const samePitchOn = {};
  heard.forEach(n => { (samePitchOn[n.midi] = samePitchOn[n.midi] || []).push(n.on); });
  const linked = heard.filter(n => n.hand && n.w !== null);
  linked.forEach(n => R.resid.push(n.on - wToS(n.w)));
  ['RH', 'LH'].forEach(L => {
    const ns = linked.filter(n => n.hand === L).sort((a, b) => a.on - b.on);
    const onsets = Array.from(new Set(ns.map(n => Math.round(n.on * 1000)))).sort((a, b) => a - b).map(x => x / 1000);
    const starts = [];
    onsets.forEach(t => { if (!starts.length || t - starts[starts.length - 1] > 0.05) starts.push(t); });
    const byOn = {};
    ns.forEach(n => { (byOn[Math.round(n.on * 1000)] = byOn[Math.round(n.on * 1000)] || []).push(n.midi); });
    ns.forEach(n => {
      const nx = onsets.find(t => t > n.on + 0.02);
      if (nx === undefined) return;
      R.rep.n++;
      if ((byOn[Math.round(nx * 1000)] || []).indexOf(n.midi) >= 0) R.rep.same++;
      R.rep.n3++;
      const k0 = onsets.indexOf(nx);
      for (let k = k0; k < Math.min(onsets.length, k0 + 3); k++) {
        if ((byOn[Math.round(onsets[k] * 1000)] || []).indexOf(n.midi) >= 0) { R.rep.within3++; break; }
      }
      const ioi = nx - n.on, d = n.off - n.on;
      R.rel[L].r.push(d / ioi);
      if (n.off < nx) R.rel[L].gaps.push(nx - n.off); else R.rel[L].overl.push(n.off - nx);
      /* free notes: the pitch is not struck again (in either hand) before the hand's FREE_ATTACKS-th next attack, so
         no re-strike can have cut the note short whatever its release was (a key cannot be struck while held; a
         transcriber, like the humanizer, cuts a note at the next strike of its own pitch). Chosen on onsets and
         pitches only, never on the release, so the selection does not bias the ratios. Their next onset is the next
         attack of the hand: onsets within 50 ms of an attack's first onset are the same attack (a chord sounding one
         frame apart is one attack, not two). */
      let ci = 0;
      while (ci + 1 < starts.length && starts[ci + 1] <= n.on + 1e-9) ci++;
      const horizon = starts[Math.min(starts.length - 1, ci + FREE_ATTACKS)];
      if (!(samePitchOn[n.midi] || []).some(t => t > n.on + 1e-6 && t < horizon)) {
        if (ci + 1 < starts.length) {
          const ax = starts[ci + 1], ai = ax - n.on;
          R.free[L].r.push(d / ai);
          if (n.off < ax) R.free[L].gaps.push(ax - n.off); else R.free[L].overl.push(n.off - ax);
        }
      }
    });
  });
  const att = [];
  sorted.forEach(n => { const t = n.on; if (!att.length || t - att[att.length - 1] > 0.04) att.push(t); });
  const spb = (anc[anc.length - 1].s - anc[0].s) / ((anc[anc.length - 1].w - anc[0].w) * 4);
  const tol = 0.035 / spb;
  att.forEach(t => {
    const qn = sToW(t) * 4, f = qn - Math.floor(qn);
    const near = x => Math.min(Math.abs(f - x), Math.abs(f - x - 1), Math.abs(f - x + 1));
    const c = [['beat', 0], ['eighth', 0.5], ['sixteenth', 0.25], ['sixteenth', 0.75], ['third', 1 / 3], ['third', 2 / 3]]
      .map(([k, x]) => [k, near(x)]).sort((a, b) => a[1] - b[1])[0];
    R.cls.attacks++;
    if (c[1] <= tol) R.cls[c[0]]++; else R.cls.other++;
  });
  sorted.forEach(n => { if (sorted.some(m => m !== n && Math.abs(m.on - n.on) <= 0.033 && (n.midi - m.midi === 12 || n.midi - m.midi === 19) && n.vel < m.vel - 10)) R.ghosts++; });
  const byPitch = {};
  sorted.forEach(n => { (byPitch[n.midi] = byPitch[n.midi] || []).push(n); });
  Object.keys(byPitch).forEach(k => {
    const list = byPitch[k];
    for (let i = 1; i < list.length; i++) { const gp = list[i].on - list[i - 1].off; if (gp < 0) R.overlapSame++; else if (gp < 0.08) R.restrike++; }
  });
  const byBar = {};
  linked.forEach(n => { const b = Math.floor(n.w); (byBar[b] = byBar[b] || { RH: [], LH: [] })[n.hand].push(n.midi); });
  Object.keys(byBar).forEach(k => { const b = byBar[k]; if (b.RH.length && b.LH.length) { R.hand.both++; if (Math.min(...b.RH) < Math.max(...b.LH)) R.hand.cross++; } });
  R.hand.RH = linked.filter(n => n.hand === 'RH').length; R.hand.LH = linked.filter(n => n.hand === 'LH').length;
  return R;
}

function cat(raws, f) { return raws.reduce((a, r) => a.concat(f(r)), []); }
const sum = (raws, f) => raws.reduce((a, r) => a + f(r), 0);

function summarize(raws, opts) {
  opts = opts || {};
  const frame = raws[0].frame;
  const out = { schema: SCHEMA };
  const engine = opts.engine || raws[0].engine;
  if (engine) out.engine = engine;
  if (opts.source) out.source = opts.source;
  if (raws.length > 1) out.pieces = raws.length;
  out.frameSec = frame;
  const N = sum(raws, r => r.heard);
  out.notes = N;
  out.resolution = { onsetsOnFrames: share(sum(raws, r => r.onGrid), N), offsetsOnFrames: share(sum(raws, r => r.offGrid), N) };
  const dur = cat(raws, r => r.dur);
  out.durationsSec = { p05: r3(q(dur, 0.05)), p25: r3(q(dur, 0.25)), median: r3(q(dur, 0.5)), p75: r3(q(dur, 0.75)), p95: r3(q(dur, 0.95)),
                       under55ms: share(dur.filter(d => d < 0.055).length, dur.length) };
  const vel = cat(raws, r => r.vel);
  out.velocity = { mean: r3(mean(vel)), sd: r3(sd(vel)), p05: q(vel, 0.05), median: q(vel, 0.5), p95: q(vel, 0.95) };
  out.density = { seconds: r3(sum(raws, r => r.span)), notesPerSecond: r3(N / sum(raws, r => r.span)) };
  const sp = cat(raws, r => r.spreads);
  out.chords = { attacks: sum(raws, r => r.clusters), multiNoteAttacks: sp.length,
                 spreadZero: share(sp.filter(s => s < 1e-6).length, sp.length),
                 spreadOneFrame: share(sp.filter(s => s > 1e-6 && s < frame * 1.03).length, sp.length),
                 spreadMoreThanOneFrame: share(sp.filter(s => s >= frame * 1.03).length, sp.length) };
  const barDur = cat(raws, r => r.barDur), ratios = cat(raws, r => r.ratios);
  out.tempo = { bars: barDur.length, qpmMedian: r3(240 / q(barDur, 0.5)), barDurCV: r3(mean(raws.map(r => r.cv))),   // per piece, averaged: pieces differ in tempo
                barToBarRatioP05: r3(q(ratios, 0.05)), barToBarRatioP95: r3(q(ratios, 0.95)) };
  const resid = cat(raws, r => r.resid), absr = resid.map(Math.abs);
  out.onsetResidualVsWrittenMs = { n: resid.length, mean: ms(mean(resid)), sd: ms(sd(resid)), absMedian: ms(q(absr, 0.5)),
                                   absP90: ms(q(absr, 0.9)), absP99: ms(q(absr, 0.99)) };
  const relOf = key => {
    const rel = {};
    ['RH', 'LH'].forEach(L => {
      const r = cat(raws, x => x[key][L].r), gaps = cat(raws, x => x[key][L].gaps), overl = cat(raws, x => x[key][L].overl);
      rel[L] = { n: r.length, ratioQuantiles: table(r),
                 ratioP10: r3(q(r, 0.1)), ratioP25: r3(q(r, 0.25)), ratioMedian: r3(q(r, 0.5)), ratioP75: r3(q(r, 0.75)), ratioP90: r3(q(r, 0.9)),
                 releasedBeforeNextOnset: share(gaps.length, r.length), overlapsNextOnset: share(overl.length, r.length),
                 gapMsMedian: ms(q(gaps, 0.5)), gapMsP90: ms(q(gaps, 0.9)),
                 gapMsQuantiles: table(gaps.map(x => x * 1000)),
                 gapShorterThan16th: share(gaps.filter(x => x < 0.0926).length, gaps.length),
                 gapShorterThan8th: share(gaps.filter(x => x < 0.185).length, gaps.length),
                 overlapMsMedian: ms(q(overl, 0.5)), overlapMsP90: ms(q(overl, 0.9)) };
    });
    return rel;
  };
  const rel = relOf('rel');
  out.releasesByHand = rel;
  out.releasesFreeByHand = relOf('free');   // notes no re-strike of their own pitch cut short (the humanizer's table)
  out.repeatedPitchShare = share(sum(raws, r => r.rep.same), sum(raws, r => r.rep.n));   // notes whose pitch sounds again at their hand's next onset
  out.repeatedPitchWithin3Share = share(sum(raws, r => r.rep.within3), sum(raws, r => r.rep.n3));   // ... again within their hand's next three onsets
  const A = sum(raws, r => r.cls.attacks);
  out.beatPositions = { attacks: A, tolerance35ms: true, beat: share(sum(raws, r => r.cls.beat), A), eighth: share(sum(raws, r => r.cls.eighth), A),
                        sixteenth: share(sum(raws, r => r.cls.sixteenth), A), third: share(sum(raws, r => r.cls.third), A),
                        offEveryGridPoint: share(sum(raws, r => r.cls.other), A) };
  const gh = sum(raws, r => r.ghosts);
  out.octaveGhostCandidates = { n: gh, share: share(gh, N) };
  out.samePitch = { restrikeWithin80ms: sum(raws, r => r.restrike), overlapSamePitch: sum(raws, r => r.overlapSame) };
  out.hands = { RH: sum(raws, r => r.hand.RH), LH: sum(raws, r => r.hand.LH), barsWithOverlappingRanges: share(sum(raws, r => r.hand.cross), sum(raws, r => r.hand.both)) };
  const tu = raws.map(r => r.tuplets).filter(Boolean);
  if (tu.length) {
    const t = n => tu.reduce((a, x) => a + x[n], 0);
    out.tuplets = { spanners: t('spanners'), barsWithTripletBeat: share(t('barsWithTriplet'), t('bars')), staffBeatsTriplet: share(t('staffBeatsTriplet'), t('staffBeats')) };
  }
  out.unlinkedNotes = sum(raws, r => r.unlinked);
  return out;
}

/* one flat input, or {pieces: [flat, ...]} pooled */
function stats(input, opts) {
  const flats = input.pieces || [input];
  return summarize(flats.map(f => collect(f, opts)), opts);
}

// ---------------------------------------------------------------- replay fixtures
function replayStats(dir) {
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort();
  const allon = [], alloff = [], allrel = [];
  let miss = 0, extra = 0, tot = 0, pred = 0, pedalFixtures = 0, fixtures = 0, pedalSpans = 0;
  const engines = new Set();
  files.forEach(f => {
    const d = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    if (!d.truth || !d.truth.notes || !d.helper_result) return;
    fixtures++;
    engines.add(d.helper_result.engine);
    const truth = d.truth.notes, hr = d.helper_result.notes;
    tot += truth.length; pred += hr.length;
    const used = new Set();
    truth.forEach(t => {
      let best = null;
      hr.forEach((h, i) => {
        if (used.has(i) || h.midi !== t.midi) return;
        const e = h.on - t.on;
        if (Math.abs(e) <= 0.05 && (best === null || Math.abs(e) < Math.abs(best[1]))) best = [i, e];
      });
      if (best === null) { miss++; return; }
      used.add(best[0]);
      const h = hr[best[0]];
      allon.push(best[1]); alloff.push(h.off - t.off);
      allrel.push((h.off - h.on) / Math.max(1e-3, t.off - t.on));
    });
    extra += hr.length - used.size;
    const np = (d.helper_result.pedals || []).length;
    if (np) { pedalFixtures++; pedalSpans += np; }
  });
  const abs = xs => xs.map(Math.abs);
  return {
    schema: SCHEMA + '-replay', engines: Array.from(engines).sort(), fixtures, truthNotes: tot, heardNotes: pred,
    onsetErrorMs: { mean: ms(mean(allon)), sd: ms(sd(allon)), absP90: ms(q(abs(allon), 0.9)) },
    offsetErrorMs: { mean: ms(mean(alloff)), median: ms(q(alloff, 0.5)), p10: ms(q(alloff, 0.1)), p90: ms(q(alloff, 0.9)), absP90: ms(q(abs(alloff), 0.9)),
                     quantiles: table(alloff.map(x => x * 1000)) },
    heldOverTrueLength: { p10: r3(q(allrel, 0.1)), median: r3(q(allrel, 0.5)), p90: r3(q(allrel, 0.9)) },
    missed: share(miss, tot), extra: share(extra, pred),
    pedalInventedFixtures: pedalFixtures, pedalSpansPerFixtureWithPedal: pedalFixtures ? r3(pedalSpans / pedalFixtures) : 0,
  };
}

// ---------------------------------------------------------------- CLI
function argv(name) { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : null; }

if (require.main === module) {
  try {
    let result;
    const replay = argv('--replay');
    if (replay) result = replayStats(replay);
    else {
      const file = process.argv[2];
      if (!file || file.startsWith('--')) { process.stderr.write('usage: perf-stats.js <input.json> [--engine NAME] [--frame 0.032] [--source LABEL] [--out FILE]\n       perf-stats.js --replay DIR\n'); process.exit(2); }
      const input = JSON.parse(fs.readFileSync(file, 'utf8'));
      const flat = input.parts ? flatFromGraph(input) : input;
      result = stats(flat, { frame: argv('--frame') ? +argv('--frame') : undefined, engine: argv('--engine'), source: argv('--source') });
    }
    const text = JSON.stringify(result, null, 1) + '\n';
    if (argv('--out')) fs.writeFileSync(argv('--out'), text); else process.stdout.write(text);
  } catch (e) {
    process.stderr.write('perf-stats: ' + e.message + '\n');
    process.exit(1);
  }
}

module.exports = { stats, collect, summarize, flatFromGraph, replayStats, KNOTS };
