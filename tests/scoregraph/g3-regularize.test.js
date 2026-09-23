'use strict';
/* G3b (docs/GOALS/G03 §6.4 R-reg, §8.3 voices from the performance; Step 14, A19 in part). Both passes are OFF by default
   and in production until three real recordings are the baseline their weight is set on (D1, M11); these are
   synthetic fixtures, for the algorithm only: nothing here sets or approves λ. Each case is a graph with a performance
   whose releases say how long each note was held (g3-helpers mk: heard), run with opts.g3b. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { SG } = require('./helpers.js');
const { mk, render } = require('./g3-helpers.js');
const C = require('../../scoregraph/pro-critic.js');
const PR = require('../../scoregraph/pro-rhythm.js');

const run = (spec, opts) => {
  const g = mk(Object.assign({ perf: true, time: [4, 4] }, spec));
  return { g: g, r: SG.professionalize(g, Object.assign({ g3b: true, strict: true }, opts || {})) };
};

/* [name, spec, expected staff line (0 right hand, 1 left hand), what it shows] */
const REG = [
  ['RG01', { rh: 'C5:8. r:16 D5:8. r:16 E5:8. r:16 F5:8. r:16 | G5:w', heard: ['1/4', '1/4', '1/4', '1/4', '1'] }, 0,
    'C5:q D5:q E5:q F5:q | G5:w', 'held legato to the next onset: the dotted eighth and its 16th rest are one quarter'],
  ['RG02', { rh: 'C5:32 r:32 D5:16 E5:8 F5:q G5:h', heard: ['1/16', '1/16', '1/8', '1/4', '1/2'] }, 0,
    'C5:16 D5:16 E5:8 F5:q G5:h', '32nd + 32nd rest held a 16th: a 16th (§6.4)'],
  ['RG03', { rh: 'C5:8. r:16 D5:8. r:16 E5:h', heard: ['1/8', '1/8', '1/2'] }, 0,
    'C5:8 r:8 D5:8 r:8 E5:h', 'released within half the IOI: the rest stays (C5); the end moves only as far back as the release'],
  ['RG04', { rh: 'C5:16 r:16 r:8 D5:16 r:16 r:8 E5:h', heard: ['1/16', '1/16', '1/2'] }, 0,
    'C5:16 r:16 r:8 D5:16 r:16 r:8 E5:h', 'staccato: held a 16th of a quarter, nothing to regularize'],
  ['RG05', { rh: 'C5:8~ C5:64 r:64 r:32 r:16 r:q r:h', heard: ['9/64'] }, 0,
    'C5:8~ C5:64 r:16.. r:q r:h', 'never shorter than heard (C4): the 8 the grid would like ends before the release (the rests after it are those R-repr writes: one double-dotted 16th completing the beat)'],
  ['RG06', { rh: 'C5:q. r:8 D5:h', heard: ['11/32', '1/2'] }, 0,
    'C5:h D5:h', 'held 11/32 of a half-note IOI: not detached, so the end moves (within the budget) to the next onset'],
];
const VOICES = [
  ['PV01', { rh: 'r:w', lh: 'C3:8 G3:8 E3:8 G3:8 C3:8 G3:8 E3:8 G3:8', heard: ['1/2', '1/8', '1/8', '1/8', '1/8', '1/8', '1/8', '1/8'] }, 1,
    'r:8 G3:8 E3:8 G3:8 C3:8 G3:8 E3:8 G3:8 // C3:h r:h', 'a bass held a half under three eighths: a second voice (§8.3)'],
  ['PV02', { rh: 'r:w', lh: 'C3:8 G3:8 E3:8 G3:8 G3:h', heard: ['1/8', '1/8', '1/8', '1/8', '1/2'] }, 1,
    'C3:8 G3:8 E3:8 G3:8 G3:h', 'not held past the next onset: one voice'],
  ['PV03', { rh: 'r:w', lh: 'C3:8 G3:8 E3:q G3:h', heard: ['1/4', '1/8', '1/4', '1/2'] }, 1,
    'C3:8 G3:8 E3:q G3:h', 'held past one onset only: one voice'],
  ['PV04', { rh: 'r:w', lh: 'C3:16 r:16 G3:8 E3:8 G3:8 G3:h', heard: ['1/2', '1/8', '1/8', '1/8', '1/2'] }, 1,
    'r:8 G3:8 E3:8 G3:8 G3:h // C3:h r:h', 'a held note written with a rest after it: the rest stays, the span it leaves is a rest too (no overlap)'],
];

test('G3b is off unless asked for: the same graph comes back with a performance that says otherwise', () => {
  REG.concat(VOICES).forEach(([name, spec]) => {
    const { g, r } = run(spec, { g3b: false, passes: { staff: false, voice: false, rhythm: false, tuplet: false, spell: false, beam: false, marks: false } });
    assert.equal(r.graph, g, name);
    assert.equal(r.report.g3b, false, name);
  });
});

test('A19 (synthetic): R-reg and voices from the performance give each fixture its writing; the onsets and the performance stay', () => {
  REG.concat(VOICES).forEach(([name, spec, staff, want, what]) => {
    const { g, r } = run(spec);
    assert.equal(render(r.graph)[staff], want, name + ': ' + what);
    assert.deepEqual(C.diff(C.fingerprint(g), C.fingerprint(r.graph), ['onsets', 'perf', 'timeline', 'marks']), [], name);
    assert.equal(r.report.fallback, false, name);
    assert.deepEqual(SG.validate(r.graph).issues.filter(i => i.severity !== 'INFO').map(i => i.code), [], name);
    /* every head the performance links to is still there */
    const heads = new Set();
    r.graph.parts[0].events.forEach(e => (e.heads || []).forEach(h => heads.add(h.id)));
    g.performances[0].notes.forEach(pn => assert.ok(heads.has(pn.link), name + ': ' + pn.link));
  });
});

test('R-reg moves a notated end by no more than its budget, max(1/32 W, 0.35 IOI) (C3)', () => {
  const R = SG.rational;
  REG.forEach(([name, spec]) => {
    const { g, r } = run(spec, { passList: [PR.regularize] });
    const sound = gr => C.fingerprint(gr).sound;
    const a = sound(g), b = sound(r.graph);
    a.forEach((val, m) => {
      const before = val.split('\n').map(x => x.split('|')), after = (b.get(m) || '').split('\n').map(x => x.split('|'));
      before.forEach(x => {
        const y = after.find(z => z[1] === x[1] && z[2] === x[2]);
        assert.ok(y, name + ': note ' + x.join('|') + ' still sounds from the same onset');
        const on = R.parse(x[1]);
        const next = before.map(z => R.parse(z[1])).filter(w => R.gt(w, on)).sort(R.cmp)[0];
        const ioi = next ? R.toNumber(R.sub(next, on)) : 1;
        const moved = Math.abs(R.toNumber(R.parse(y[3])) - R.toNumber(R.parse(x[3])));
        assert.ok(moved <= Math.max(1 / 32, 0.35 * ioi) + 1e-9, name + ': ' + x.join('|') + ' -> ' + y[3]);
      });
    });
  });
});

test('G3b is idempotent: a second run changes nothing', () => {
  REG.concat(VOICES).forEach(([name, spec]) => {
    const { r } = run(spec);
    const again = SG.professionalize(r.graph, { g3b: true, strict: true });
    assert.equal(again.graph, r.graph, name);
  });
});
