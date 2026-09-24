'use strict';
/* G3 Step 11: marks (docs/GOALS/G03 §12, §13; A30, A31, A32 fixture part). Each M case builds a small graph with marks,
   runs the pipeline in strict mode (the critic's marks component must hold) and checks where each mark is. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { SG } = require('./helpers.js');
const { mk, render } = require('./g3-helpers.js');
const D = require('./g3-corpus-data.js');

/* a graph from mk with marks added by edit(doc) */
function withMarks(spec, edit) {
  const doc = JSON.parse(SG.serialize(mk(spec)));
  edit(doc, doc.parts[0]);
  return SG.seal(doc).graph;
}
const next = doc => doc.nextId++;
const notes = p => p.events.filter(e => e.kind === 'note').sort((a, b) => (a.m === b.m ? SG.rational.cmp(SG.rational.parse(a.at), SG.rational.parse(b.at)) : 0));
const at = (g, id) => { const e = g.parts[0].events.find(x => x.id === id); return e ? e.m + '@' + e.at : null; };

test('M01: a slur over tied pieces R-repr merges keeps its first and last notes', () => {
  const g = withMarks({ rh: 'C5:8~ C5:8 D5:q E5:8~ E5:8 F5:q' }, (doc, p) => {
    const n = notes(p);
    p.spanners.push({ id: 's' + next(doc), type: 'slur', from: n[0].id, to: n[4].id });
  });
  const out = SG.professionalize(g, { strict: true }).graph;
  assert.equal(render(out)[0], 'C5:q D5:q E5:q F5:q');
  const s = out.parts[0].spanners.find(x => x.type === 'slur');
  assert.equal(at(out, s.from), at(g, notes(g.parts[0])[0].id));
  /* the slur ended on the second piece of E5; it now ends on E5 itself, the note that ends there */
  assert.equal(at(out, s.to), g.timeline.measures[0].id + '@1/2');
});

test('M02: a dynamic anchored to a tied piece R-repr retires moves to the note that covers it', () => {
  const g = withMarks({ rh: 'C5:8~ C5:8 D5:q E5:h' }, (doc, p) => {
    const n = notes(p);
    p.directions.push({ id: 'd' + next(doc), kind: 'dynamic', m: n[1].m, at: n[1].at, value: 'p', event: n[1].id, placement: 'below' });
  });
  const out = SG.professionalize(g, { strict: true }).graph;
  const d = out.parts[0].directions[0];
  assert.equal(d.m + '@' + d.at, g.parts[0].directions[0].m + '@' + g.parts[0].directions[0].at, 'the dynamic stays where it was printed');
  assert.equal(at(out, d.event), g.timeline.measures[0].id + '@0');
});

test('M03: a staccato and a fingering on notes that change hands stay on them (E6 octaves)', () => {
  const g = withMarks({ time: [3, 4], rh: 'D5+D6:q C5+C6:q B4+B5:q | A4+A5:h.', lh: 'r:h. | r:h.' }, (doc, p) => {
    const n = notes(p);
    n[0].arts = ['staccato'];
    n[0].heads.find(h => h.pitch.oct === 5).fingering = [{ f: '1' }];
  });
  const out = SG.professionalize(g, { strict: true }).graph;
  assert.equal(render(out)[1], 'D5:q C5:q B4:q | A4:h.');
  const d5 = out.parts[0].events.find(e => e.heads && e.heads.some(h => h.pitch.step === 'D' && h.pitch.oct === 5));
  assert.deepEqual(d5.heads.find(h => h.pitch.oct === 5).fingering, [{ f: '1' }], 'the fingering went with its head');
  const d6 = out.parts[0].events.find(e => e.heads && e.heads.some(h => h.pitch.step === 'D' && h.pitch.oct === 6));
  assert.deepEqual(d6.arts, ['staccato'], 'the chord keeps its staccato (written once)');
});

test('M04: a slur ending on a note that changes hands still ends on it', () => {
  const g = withMarks({ time: [2, 4], rh: 'E5:8 r:8 r:q', lh: 'D4:q F#4+A4+D5:q' }, (doc, p) => {
    const n = notes(p);
    const e5 = n.find(e => e.heads[0].pitch.step === 'E'), chord = n.find(e => e.heads.length === 3);
    p.spanners.push({ id: 's' + next(doc), type: 'slur', from: e5.id, to: chord.id });
  });
  const out = SG.professionalize(g, { strict: true }).graph;
  assert.equal(render(out)[0], 'E5:8 r:8 D5:q');
  const s = out.parts[0].spanners.find(x => x.type === 'slur');
  assert.equal(at(out, s.to), g.timeline.measures[0].id + '@1/4');
});

const pedalGraph = () => withMarks({ rh: 'C5:q D5:q E5:q F5:q | G5:w', lh: 'C3:w | C3:w' }, (doc, p) => {
  const m = doc.timeline.measures;
  p.spanners.push({ id: 's' + next(doc), type: 'pedal', pedal: 'damper', from: { m: m[0].id, at: '0' }, to: { m: m[0].id, at: '7/16' }, mark: { line: false } });
  p.spanners.push({ id: 's' + next(doc), type: 'pedal', pedal: 'damper', from: { m: m[0].id, at: '1/2' }, to: { m: m[1].id, at: '1/2' }, mark: { line: false } });
  p.spanners.push({ id: 's' + next(doc), type: 'pedal', pedal: 'damper', from: { m: m[1].id, at: '3/4' }, to: { m: m[1].id, at: '1' }, mark: { line: false } });
});

test('M05 / B1: by default every pedal is written as the writer wrote it (the app plays a change without lifting)', () => {
  const g = pedalGraph();
  const out = SG.professionalize(g, { strict: true }).graph;
  const ped = x => JSON.stringify(x.parts[0].spanners.filter(s => s.type === 'pedal'));
  assert.equal(ped(out), ped(g), 'no pedal joined, moved or dropped');
});

test('M05 (experimental, opts.pedalJoin): a release and a press less than a beat apart are one pedal with a change', () => {
  const g = pedalGraph();
  const out = SG.professionalize(g, { strict: true, pedalJoin: true }).graph;
  const ped = out.parts[0].spanners.filter(x => x.type === 'pedal');
  assert.equal(ped.length, 2, 'the first two joined; the third is a beat after the second: kept');
  assert.deepEqual(ped[0].changes, [{ m: g.timeline.measures[0].id, at: '1/2' }]);
  assert.equal(SG.professionalize(out, { strict: true, pedalJoin: true }).graph, out, 'idempotent');
});

/* The app's player, replayed on the Score a graph projects to (Piano Coach App.dc.html: Playback.ties, .pedal,
   .pedalEvents, .pedalUp and the note end in .strikes): damper spans, the CC64 values sent, and when every struck
   note stops sounding. */
function appPlayback(score) {
  const start = new Map();
  let acc = 0;
  score.measures.forEach(m => { start.set(m.number, acc); acc += m.lenQ; });
  const abs = x => start.get(x.m) + (x.b || 0);
  const ev = (score.pedals || []).filter(p => !p.kind || p.kind === 'damper').map(p => ({ q: abs(p), type: p.type }))
    .sort((a, b) => a.q - b.q);
  const spans = [];
  let down = null;
  ev.forEach(e => {
    if (e.type === 'start') { if (down == null) down = e.q; } else if (e.type === 'stop') { if (down != null) spans.push([down, e.q]); down = null; } else if (e.type === 'change') { if (down == null) down = e.q; }
  });
  if (down != null) spans.push([down, acc]);
  const cc = (score.pedals || []).map(p => [abs(p).toFixed(4), p.kind || 'damper', p.type,
    p.value != null ? p.value : p.type === 'stop' ? 0 : p.type === 'change' ? 64 : 127].join('|')).sort();
  const notes = score.notes.filter(n => !n.rest).map(n => Object.assign({}, n, { abs: abs(n) }));
  const at = {};
  notes.forEach(n => { if (n.tieStop) at[n.midi + '@' + n.abs.toFixed(3)] = n; });
  const cont = new Set(), hold = new Map();
  notes.forEach(n => {
    if (!n.tieStart || cont.has(n)) return;
    let q = n.dur, cur = n;
    for (let i = 0; i < 32 && cur.tieStart; i++) { const nx = at[n.midi + '@' + (cur.abs + cur.dur).toFixed(3)]; if (!nx || nx === cur) break; q += nx.dur; cur = nx; cont.add(nx); }
    hold.set(n, q);
  });
  const sounding = notes.filter(n => !(n.tieStop && cont.has(n))).map(n => {
    let up = n.abs + Math.max(0.05, hold.has(n) ? hold.get(n) : n.dur || 0);
    const s = spans.find(x => up > x[0] + 1e-6 && up < x[1] - 1e-6);
    if (s) up = s[1];
    return [n.abs.toFixed(4), n.midi, up.toFixed(4)].join('|');
  }).sort();
  return { spans: JSON.stringify(spans.map(s => s.map(x => x.toFixed(4)))), cc: cc, sounding: sounding };
}

test('B1: with G3 on (its defaults) the app plays every recording graph\'s pedal and sustain exactly as with G3 off', () => {
  let pedalled = 0, graphs = 0, cc = 0, notes = 0;
  D.recorded().forEach(r => {
    const out = SG.professionalize(r.graph).graph;
    const ped = x => JSON.stringify(x.parts.map(p => p.spanners.filter(s => s.type === 'pedal')));
    assert.equal(ped(out), ped(r.graph), r.id + ': pedal marks');
    const a = appPlayback(SG.legacy.toScore(r.graph)), b = appPlayback(SG.legacy.toScore(out));
    assert.equal(b.spans, a.spans, r.id + ': damper spans');
    assert.deepEqual(b.cc, a.cc, r.id + ': CC64 events');
    assert.deepEqual(b.sounding, a.sounding, r.id + ': when each struck note stops sounding');
    graphs++;
    if (a.cc.length) { pedalled++; cc += a.cc.length; notes += a.sounding.length; }
  });
  assert.ok(pedalled >= 20, pedalled + ' pedalled recording graphs');
  console.log('# ' + graphs + ' recording graphs, ' + pedalled + ' pedalled: ' + cc + ' CC64 events and the ends of ' + notes +
    ' struck notes the same with G3 on (no sustain added)');
});

test('M06: a fermata and a tenuto keep their notes (R-repr leaves a voice-measure with marks as it is)', () => {
  const g = withMarks({ rh: 'C5:8~ C5:8 D5:q E5:h' }, (doc, p) => {
    const n = notes(p);
    n[2].fermata = {}; n[2].arts = ['tenuto'];
  });
  const out = SG.professionalize(g, { strict: true }).graph;
  const d5 = out.parts[0].events.find(e => e.heads && e.heads[0].pitch.step === 'D');
  assert.deepEqual(d5.fermata, {});
  assert.deepEqual(d5.arts, ['tenuto']);
});

test('A31: G3 writes no dynamic, wedge, slur, articulation or fingering on the recording graphs', () => {
  D.recorded(['core']).forEach(r => {
    const out = SG.professionalize(r.graph, { strict: true }).graph;
    const count = g => {
      const p = g.parts[0];
      return [p.directions.filter(d => d.kind === 'dynamic').length, p.spanners.filter(s => s.type === 'wedge' || s.type === 'slur').length,
        p.events.filter(e => e.arts && e.arts.length).length, p.events.reduce((n, e) => n + (e.heads || []).filter(h => h.fingering).length, 0)];
    };
    assert.deepEqual(count(out), count(r.graph), r.id);
    const ped = g => g.parts[0].spanners.filter(s => s.type === 'pedal').length;
    assert.ok(ped(out) <= ped(r.graph), r.id + ': pedal marks only join');
  });
});
