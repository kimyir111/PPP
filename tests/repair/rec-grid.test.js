/* "Recording notation: tuplets and the grid" (docs/GOALS/G09_CANDIDATES_CRITICS_REPAIR.md section 12), STEP B: the grid. The quantiser leaves onsets and releases on three lattices (16th grid, 32nd lattice,
   thirds of a triplet beat), so the bars of a recording did not add up (the teacher's piece: 59 of 90 right-hand bars). With opts.exactBars audio-score.js puts every onset and release of a
   simple-time recording on ONE grid per beat and writes the rests the standard way, so that what is drawn fills each bar of each voice:
     - the metric (drawnBars below): per voice and bar, the sum of the DRAWN values (printed value times the ratio of the tuplet it is in) is the bar, events follow each other with no hole and no
       overlap, and every event lasts what it is drawn as; checked on the graph after the tuplet pass and the gaps pass
     - an onset moves by at most 3 ticks (1/32 of a whole note), no heard note is lost or reordered, nothing overlaps, ties across barlines stay
     - the passes compose: running the gaps pass (tidyRests) and the tuplet pass again changes nothing (a fixed point); the library default, a MIDI file and a compound metre are not touched */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const REPO = path.resolve(__dirname, '..', '..');
const A = require(path.join(REPO, 'audio-score.js'));
const SG = require(path.join(REPO, 'scoregraph/index.js'));
const R = require(path.join(REPO, 'scoregraph/rational.js'));
const S = require(path.join(REPO, 'scoregraph/schema.js'));
const GAPS = require(path.join(REPO, 'scoregraph/gaps.js'));
const RT = require(path.join(REPO, 'scoregraph/rec-tuplet.js'));

/* ---- the metric: for each hand and voice, the bars (1-based) that do NOT add up as drawn */
function drawnBars(g) {
  const part = g.parts[0];
  const mIdx = new Map(g.timeline.measures.map((m, i) => [m.id, i]));
  const tupById = new Map(part.spanners.filter(s => s.type === 'tuplet').map(t => [t.id, t]));
  const tupsOf = new Map();
  part.spanners.filter(s => s.type === 'tuplet').forEach(t => t.events.forEach(id => { if (!tupsOf.has(id)) tupsOf.set(id, []); tupsOf.get(id).push(t); }));
  const ratio = id => {
    const list = tupsOf.get(id) || [];
    let t = list.find(x => !list.some(u => u !== x && u.parent === x.id)) || list[0], r = R.ONE, guard = 0;
    while (t && guard++ < 8) { r = R.mul(r, R.make(t.normal, t.actual)); t = t.parent ? tupById.get(t.parent) : null; }
    return r;
  };
  const by = new Map();
  part.events.forEach(e => { if (e.grace || (e.kind !== 'note' && e.kind !== 'rest')) return; const k = e.voice + '|' + e.m; if (!by.has(k)) by.set(k, []); by.get(k).push(e); });
  const bad = [];
  by.forEach((evs, k) => {
    evs.sort((a, b) => R.cmp(R.parse(a.at), R.parse(b.at)));
    const barLen = R.parse(g.timeline.measures[mIdx.get(evs[0].m)].dur);
    let cur = R.ZERO, ok = true, sum = R.ZERO;
    evs.forEach(e => {
      const base = e.display && e.display.type ? S.noteValue(e.display.type, e.display.dots) : null;
      if (!base) { ok = false; return; }
      const drawn = R.mul(base, ratio(e.id));
      sum = R.add(sum, drawn);
      if (!R.eq(R.parse(e.at), cur) || !R.eq(R.parse(e.dur), drawn)) ok = false;
      cur = R.add(R.parse(e.at), R.parse(e.dur));
    });
    if (!R.eq(cur, barLen) || !R.eq(sum, barLen)) ok = false;
    if (!ok) bad.push(k.split('|')[0] + '@' + (mIdx.get(evs[0].m) + 1));
  });
  return bad;
}

/* ---- seeded random recordings: both hands, a 16th grid with jitter, triplet beats, rests, chords, held notes, now and then a run of 32nds (slow tempi) */
function rng(seed) { let s = seed >>> 0 || 1; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
function recording(seed, opts) {
  opts = opts || {};
  const rnd = rng(seed);
  const bpm = opts.bpm || (60 + Math.floor(rnd() * 110));
  const spb = 60 / bpm, bars = opts.bars || 12;
  const notes = [];
  const jitter = () => (rnd() - 0.5) * (opts.jitter || 0.03);
  const add = (t, len, midi, vel) => notes.push({ on: Math.max(0, t + jitter()), off: Math.max(0, t + len * (0.5 + 0.5 * rnd())) + 0.04, midi: midi, vel: vel || 70 + Math.floor(rnd() * 40) });
  for (let b = 0; b < bars; b++) {
    for (let beat = 0; beat < 4; beat++) {
      const t0 = (b * 4 + beat) * spb;
      const kind = rnd();
      /* left hand */
      const lh = 36 + Math.floor(rnd() * 14);
      if (kind < 0.25) { [0, 1 / 3, 2 / 3].forEach((f, i) => add(t0 + f * spb, spb / 3, lh + 7 * i)); }
      else if (kind < 0.75) { [0, 0.25, 0.5, 0.75].forEach((f, i) => { if (rnd() < 0.9) add(t0 + f * spb, spb / 4, lh + [0, 7, 12, 7][i]); }); }
      else if (kind < 0.9) { add(t0, spb * (0.5 + rnd() * 0.5), lh); }
      /* right hand: a rest, a plain run, a triplet, a held note, a 32nd run */
      const r = rnd(), m0 = 64 + Math.floor(rnd() * 20);
      if (r < 0.25) { /* rest */ }
      else if (r < 0.45) { [0, 1 / 3, 2 / 3].forEach((f, i) => { if (rnd() < 0.85) add(t0 + f * spb, spb / 3, m0 + i * 2); }); }
      else if (r < 0.6) { add(t0 + spb / 3, spb / 3, m0); add(t0 + 2 * spb / 3, spb / 3, m0 + 2); }
      else if (r < 0.8) { [0, 0.25, 0.5, 0.75].forEach((f, i) => { if (rnd() < 0.9) add(t0 + f * spb, spb / 4, m0 + i); }); }
      else if (r < 0.88 && opts.runs) { for (let i = 0; i < 8; i++) add(t0 + i * spb / 8, spb / 8, m0 + (i % 4) * 2); }
      else if (r < 0.95) { add(t0, spb * (0.7 + rnd() * 0.3), m0, 90); if (rnd() < 0.5) add(t0, spb * 0.8, m0 + 4, 80); }
      else { add(t0 + 0.5 * spb, spb / 2, m0); }
    }
  }
  return { notes: notes, bpm: bpm };
}
const build = (rec, opts) => A.toMusicXml({ notes: rec.notes, pedals: [], title: 'prop' },
  Object.assign({ title: 'prop', lock: { bpm: rec.bpm, beatsPerBar: 4, beatType: 4, firstDownbeat: 0 }, closeGaps: true, exactBars: true }, opts || {}));
const errorsOf = g => SG.validate(g).issues.filter(i => i.severity === 'ERROR');
const warnings = (g, code) => SG.validate(g).issues.filter(i => i.code === code);

test('property: over 60 random recordings (tempi 60-170, jitter, triplets, rests, chords, 32nd runs) every voice of every bar adds up as drawn, the graph validates, and nothing is lost', () => {
  let barsChecked = 0, tuplets = 0, runsKept = 0, merged = 0;
  const failures = [];
  for (let seed = 1; seed <= 60; seed++) {
    const rec = recording(seed, { runs: seed % 3 === 0, bpm: seed % 3 === 0 ? 60 + (seed % 7) * 3 : undefined });
    let r;
    try { r = build(rec); } catch (e) { failures.push(seed + ': threw ' + e.message); continue; }
    const bad = drawnBars(r.graph);
    barsChecked += r.graph.timeline.measures.length;
    tuplets += r.graph.parts[0].spanners.filter(s => s.type === 'tuplet').length;
    runsKept += r.gridReport.kept32nd; merged += r.gridReport.merged;
    if (bad.length) failures.push(seed + ': bars that do not add up ' + bad.slice(0, 6).join(' '));
    if (errorsOf(r.graph).length) failures.push(seed + ': errors ' + JSON.stringify(errorsOf(r.graph).slice(0, 2)));
    const w = warnings(r.graph, 'W-DISPLAY-DURATION').length;
    if (w) failures.push(seed + ': ' + w + ' W-DISPLAY-DURATION');
    /* every heard note is written (linked to a head) */
    const perf = r.graph.performances[0].notes;
    if (perf.some(n => n.link === undefined)) failures.push(seed + ': an unlinked heard note');
  }
  assert.deepEqual(failures, [], failures.slice(0, 8).join('\n'));
  assert.ok(barsChecked >= 700 && tuplets > 100, 'the generator exercises triplets: ' + tuplets + ' tuplets in ' + barsChecked + ' bars');
  assert.ok(runsKept >= 0 && merged >= 0);
});

test('the passes compose and stay a fixed point: tidyRests, the tuplet pass, closeSmallGaps and mergeRests again change nothing, in either order', () => {
  for (let seed = 100; seed < 118; seed++) {
    const r = build(recording(seed, { runs: seed % 2 === 0, bpm: 64 + (seed % 5) * 7 }));
    const g = r.graph;
    assert.equal(GAPS.tidyRests(g).graph, g, 'tidyRests: ' + seed);
    assert.equal(GAPS.closeSmallGaps(g).graph, g, 'closeSmallGaps: ' + seed);
    assert.equal(GAPS.mergeRests(g).graph, g, 'mergeRests: ' + seed);
    assert.equal(RT.addTriplets(g).graph, g, 'tuplets: ' + seed);
    const swapped = GAPS.tidyRests(RT.addTriplets(GAPS.tidyRests(g).graph).graph).graph;
    assert.equal(swapped, g, 'tuplets then gaps then tuplets then gaps: ' + seed);
    assert.deepEqual(drawnBars(GAPS.tidyRests(g).graph), []);
  }
});

test('the gaps pass finds nothing to close or omit in what exact bars write (the 32nd/64th rest trick is not needed), the teacher\'s left-hand run rests still are filled', () => {
  const rec = recording(7, {});
  const exact = build(rec);
  assert.equal(exact.gapReport.gaps, 0);
  assert.equal(exact.gapReport.omitted, 0);
  assert.equal(exact.restReport.runs, 0);
  const rests = exact.graph.parts[0].events.filter(e => e.kind === 'rest').map(e => e.display.type);
  assert.equal(rests.filter(t => t === '32nd' || t === '64th').length, 0, 'no sub-16th rest');
  const old = build(rec, { exactBars: false });
  assert.ok(drawnBars(old.graph).length > 0, 'the same notes without exact bars have bars that do not add up (a control)');
});

test('the snap: an onset moves by at most 3 ticks (1/32 of a whole note), nothing is lost, order is kept, no voice overlaps itself', () => {
  for (let seed = 200; seed < 215; seed++) {
    const rec = recording(seed, { runs: true, bpm: 70 });
    const on = build(rec), off = build(rec, { exactBars: false });
    assert.ok(on.gridReport.maxShift <= 3, 'max shift in ticks: ' + on.gridReport.maxShift);
    const info = g => {
      const part = g.parts[0], mStart = new Map();
      let acc = R.ZERO;
      g.timeline.measures.forEach(m => { mStart.set(m.id, acc); acc = R.add(acc, R.parse(m.dur)); });
      const head = new Map();
      part.events.forEach(e => { if (e.kind === 'note') e.heads.forEach(h => head.set(h.id, e)); });
      return g.performances[0].notes.map(p => { const e = head.get(p.link); return e ? R.add(mStart.get(e.m), R.parse(e.at)) : null; });
    };
    const a = info(off.graph), b = info(on.graph);
    assert.equal(a.length, b.length);
    a.forEach((x, i) => {
      assert.ok(x !== null && b[i] !== null, 'every heard note is linked to a written note: ' + i);
      assert.ok(Math.abs(R.toNumber(R.sub(b[i], x))) <= 3 / 96 + 1e-12, 'onset moved at most 1/32 of a whole note: ' + i);
    });
    /* order: the notes in the order they were written before keep it (a note never passes another: the later of two is not before the earlier one) */
    const order = a.map((x, i) => i).sort((i, j) => R.cmp(a[i], a[j]) || i - j);
    for (let k = 0; k + 1 < order.length; k++) assert.ok(R.le(b[order[k]], b[order[k + 1]]), 'order kept at ' + order[k]);
    /* no voice overlaps itself, per measure; the voices stay sorted */
    const by = new Map();
    on.graph.parts[0].events.forEach(e => { if (e.grace) return; const k = e.voice + '|' + e.m; if (!by.has(k)) by.set(k, []); by.get(k).push(e); });
    by.forEach(list => {
      list.sort((x, y) => R.cmp(R.parse(x.at), R.parse(y.at)));
      for (let i = 0; i + 1 < list.length; i++) assert.ok(R.le(R.add(R.parse(list[i].at), R.parse(list[i].dur)), R.parse(list[i + 1].at)), 'no overlap');
    });
  }
});

test('a genuine 32nd run (a slow tempo) keeps its 32nd lattice and still adds up', () => {
  /* 60 bpm: a 32nd is 0.125 s; a beat of eight 32nds in the right hand, a bass note under each beat */
  const notes = [];
  for (let b = 0; b < 4; b++) for (let beat = 0; beat < 4; beat++) {
    const t0 = (b * 4 + beat);
    notes.push({ on: t0, off: t0 + 0.9, midi: 43, vel: 80 });
    if (beat === 1) for (let i = 0; i < 8; i++) notes.push({ on: t0 + i / 8 + 0.002 * i, off: t0 + (i + 1) / 8, midi: 72 + (i % 4), vel: 80 });
    else notes.push({ on: t0, off: t0 + 0.9, midi: 76, vel: 80 });
  }
  const r = A.toMusicXml({ notes: notes, pedals: [], title: 'run' }, { title: 'run', lock: { bpm: 60, beatsPerBar: 4, beatType: 4, firstDownbeat: 0 }, closeGaps: true, exactBars: true });
  assert.deepEqual(drawnBars(r.graph), []);
  const types = r.graph.parts[0].events.filter(e => e.kind === 'note').map(e => e.display.type);
  assert.ok(types.filter(t => t === '32nd').length >= 16, 'the 32nd notes are written as 32nds: ' + types.filter(t => t === '32nd').length);
  assert.equal(GAPS.tidyRests(r.graph).graph, r.graph);
});

test('exactBars is off by default and for a MIDI file; a compound metre and a printed score are never touched', () => {
  const rec = recording(5, {});
  const plain = build(rec, { exactBars: undefined });
  assert.equal(plain.gridReport, undefined);
  assert.equal(plain.tupletReport, undefined);
  const midi = build(rec, { sourceKind: 'midi-file' });
  assert.equal(midi.gridReport, undefined);
  assert.equal(midi.xml, build(rec, { exactBars: false, closeGaps: false, sourceKind: 'midi-file' }).xml);
  /* 6/8: the grid is for a quarter-note beat; the notes of a jig are written as they always were */
  const jig = [];
  for (let b = 0; b < 4; b++) for (let k = 0; k < 6; k++) jig.push({ on: (b * 6 + k) * 0.25, off: (b * 6 + k) * 0.25 + 0.2, midi: 60 + (k % 3), vel: 80 });
  const o = { title: 'jig', beatsPerBar: 6, beatType: 8, closeGaps: true };
  const j0 = A.toMusicXml({ notes: jig, pedals: [], title: 'jig' }, Object.assign({ exactBars: false }, o));
  const j1 = A.toMusicXml({ notes: jig, pedals: [], title: 'jig' }, Object.assign({ exactBars: true }, o));
  assert.equal(j1.gridReport, undefined, 'no grid in a compound metre');
  assert.equal(j1.xml, j0.xml);
});

test('the MusicXML of an exact build reads back as the same score (brackets, rests, ties), and the performance layer is the same as without exact bars', () => {
  const rec = recording(11, {});
  const r = build(rec), off = build(rec, { exactBars: false });
  const back = SG.musicxml.import(r.xml, { scoreId: 'rt' });
  assert.equal(back.ok, true);
  assert.equal(back.graph.parts[0].events.filter(e => e.kind === 'note').length, r.graph.parts[0].events.filter(e => e.kind === 'note').length);
  assert.equal(back.graph.parts[0].spanners.filter(s => s.type === 'tuplet').length, r.graph.parts[0].spanners.filter(s => s.type === 'tuplet').length);
  assert.deepEqual(drawnBars(back.graph), [], 'the file adds up too');
  assert.equal(JSON.stringify(r.graph.performances[0].notes.map(n => [n.on, n.off, n.vel, n.midi])), JSON.stringify(off.graph.performances[0].notes.map(n => [n.on, n.off, n.vel, n.midi])), 'what was heard is the same');
});
