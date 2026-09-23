/* The synthetic score of G03 A39: 2,000 measures of 4/4 piano, about 40,000 heads, written the way audio-score writes
   (eighths and chords, a triplet beat, tied pieces a beat could hold as one, rests), as a graph. Deterministic. */
'use strict';
const { SG } = require('./helpers.js');

function perfGraph(measures) {
  measures = measures || 2000;
  const b = SG.builder({ id: 'g3-perf', meta: { title: 'G3 perf' } });
  const src = b.source({ kind: 'audio-score' });
  b.setDefault({ src: src.id, op: 'inferred' });
  const part = b.part({ name: 'Piano', instrument: { kind: 'piano', family: 'keyboard' } });
  const rh = b.staff(part, { limb: 'RH' }).id, lh = b.staff(part, { limb: 'LH' }).id;
  const v1 = b.voice(part, { staff: rh, label: '1' }).id, v5 = b.voice(part, { staff: lh, label: '5' }).id;
  const ms = [];
  for (let i = 0; i < measures; i++) ms.push(b.measure({ number: String(i + 1), dur: '1' }).id);
  b.meter({ m: ms[0], beats: [4], beatType: 4 });
  b.key({ m: ms[0], at: '0', fifths: 0, mode: 'major' });
  b.tempo({ m: ms[0], at: '0', qpm: '120' });
  b.clef(part, { staff: rh, m: ms[0], at: '0', sign: 'G' });
  b.clef(part, { staff: lh, m: ms[0], at: '0', sign: 'F' });
  const scale = [60, 62, 64, 65, 67, 69, 71, 72, 74, 76, 77, 79];
  const P = midi => { const names = ['C', 'C', 'D', 'D', 'E', 'F', 'F', 'G', 'G', 'A', 'A', 'B']; const alt = [0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0];
    const pc = midi % 12; return alt[pc] ? { step: names[pc], alter: 1, oct: Math.floor(midi / 12) - 1 } : { step: names[pc], oct: Math.floor(midi / 12) - 1 }; };
  const ties = [], tuplets = [];
  let seed = 7;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
  ms.forEach((m, i) => {
    /* right hand: beat 1 two eighths tied (8~8), beat 2 a chord of two and an eighth rest, beat 3 a triplet, beat 4 two sixteenths and an eighth */
    const r = k => scale[(i + k) % scale.length] + 12;
    const e1 = b.event(part, { kind: 'note', m: m, at: '0', dur: '1/8', voice: v1, staff: rh, display: { type: 'eighth' }, heads: [{ pitch: P(r(0)) }] });
    const e2 = b.event(part, { kind: 'note', m: m, at: '1/8', dur: '1/8', voice: v1, staff: rh, display: { type: 'eighth' }, heads: [{ pitch: P(r(0)) }] });
    ties.push({ from: e1.heads[0].id, to: e2.heads[0].id });
    b.event(part, { kind: 'note', m: m, at: '1/4', dur: '1/8', voice: v1, staff: rh, display: { type: 'eighth' }, heads: [{ pitch: P(r(2)) }, { pitch: P(r(4)) }] });
    b.event(part, { kind: 'rest', m: m, at: '3/8', dur: '1/8', voice: v1, staff: rh, display: { type: 'eighth' } });
    [0, 1, 2].forEach(k => {
      const t = b.event(part, { kind: 'note', m: m, at: ['1/2', '7/12', '2/3'][k], dur: '1/12', voice: v1, staff: rh, display: { type: 'eighth' }, heads: [{ pitch: P(r(k + 1)) }] });
      tuplets.push({ events: [t.id] });
    });
    b.event(part, { kind: 'note', m: m, at: '3/4', dur: '1/16', voice: v1, staff: rh, display: { type: '16th' }, heads: [{ pitch: P(r(3)) }, { pitch: P(r(6)) }] });
    b.event(part, { kind: 'note', m: m, at: '13/16', dur: '1/16', voice: v1, staff: rh, display: { type: '16th' }, heads: [{ pitch: P(r(4)) }] });
    b.event(part, { kind: 'note', m: m, at: '7/8', dur: '1/8', voice: v1, staff: rh, display: { type: 'eighth' }, heads: [{ pitch: P(r(5)) }] });
    /* left hand: chords on each beat, one of them sometimes an octave the right hand should take */
    [0, 1, 2, 3].forEach(k => {
      const base = 36 + ((i + k) % 7) * 2;
      const heads = [{ pitch: P(base) }, { pitch: P(base + 7) }];
      if (rnd() < 0.26) heads.push({ pitch: P(base + 16) });
      b.event(part, { kind: 'note', m: m, at: ['0', '1/4', '1/2', '3/4'][k], dur: '1/4', voice: v5, staff: lh, display: { type: 'quarter' }, heads: heads });
    });
  });
  ties.forEach(t => b.spanner(part, Object.assign({ type: 'tie' }, t)));
  tuplets.forEach(t => b.spanner(part, Object.assign({ type: 'tuplet', actual: 3, normal: 2 }, t)));
  return b.finish().graph;
}

module.exports = { perfGraph };
