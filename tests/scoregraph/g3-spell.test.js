'use strict';
/* G3 Step 9: keys, spelling, printed accidentals (docs/GOALS/G03 §10; A25, A26, A27 fixture part). */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { SG, xml } = require('./helpers.js');
const { render, runSpec, accs } = require('./g3-helpers.js');
const C = require('../../scoregraph/pro-critic.js');

const DIR = path.join(__dirname, 'fixtures', 'g3', 'spell');
const specs = fs.readdirSync(DIR).filter(f => f.endsWith('.json')).sort();

test('A25: every S fixture gives exactly its sidecar; what sounds is never changed', () => {
  assert.ok(specs.length >= 10);
  const failures = [];
  specs.forEach(f => {
    try {
      const spec = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
      const r = runSpec(spec);
      const ex = spec.expect;
      if (ex.same) assert.equal(r.output, r.input, 'unchanged');
      if (ex.rh !== undefined) assert.equal(render(r.output)[0], ex.rh);
      if (ex.bar10 !== undefined) assert.equal(render(r.output)[0].split(' | ')[9], ex.bar10);
      if (ex.accs !== undefined) assert.deepEqual(accs(r.output, 0), ex.accs);
      if (ex.keys) {
        const mi = new Map(r.output.timeline.measures.map((m, i) => [m.id, i + 1]));
        assert.deepEqual(r.output.timeline.keys.map(k => [mi.get(k.m), k.fifths]), ex.keys);
      }
      assert.deepEqual(C.diff(C.fingerprint(r.input), C.fingerprint(r.output), ['sound', 'onsets', 'rests', 'marks', 'perf', 'timeline']), []);
    } catch (e) { failures.push(f + ': ' + e.message.split(/\r?\n/).slice(0, 4).join(' ')); }
  });
  assert.deepEqual(failures, []);
});

test('A26: a transposing part keeps its written spelling and sounds the same, even forced (G2-D15)', () => {
  const r = SG.musicxml.import(xml('transposing'), { scoreId: 'x8' });
  assert.equal(r.ok, true);
  const g = r.graph;
  const out = SG.professionalize(g, { mode: 'force', strict: true, spelling: true });
  const tp = g.parts.findIndex(p => p.instrument && p.instrument.transpose);
  assert.ok(tp >= 0, 'the fixture has a transposing part');
  const heads = gg => gg.parts[tp].events.flatMap(e => (e.heads || []).map(h => JSON.stringify([h.id, h.pitch, h.acc || null])));
  assert.deepEqual(heads(out.graph), heads(g));
  const midi = gg => gg.parts.flatMap(p => p.events.flatMap(e => (e.heads || []).filter(h => h.pitch).map(h => SG.pitch.midi(h.pitch)))).sort();
  assert.deepEqual(midi(out.graph), midi(g));
});

test('A27 (fixture part): every needed accidental is printed, as G0 reads them', () => {
  /* the G0 rule, on the pieces the pipeline writes: in a measure and staff, a head whose alteration is not the one in
     force prints one; a tied head needs none (tests/bench/pppbench/metrics/readability.py accidental_needs) */
  specs.forEach(f => {
    const spec = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
    if (spec.input.op === 'imported') return;
    const out = runSpec(spec).output;
    const part = out.parts[0];
    const tieIn = new Set(part.spanners.filter(s => s.type === 'tie' && s.to).map(s => s.to));
    out.timeline.measures.forEach(m => part.staves.forEach(st => {
      const k = SG.time.keyAt(out, { m: m.id, at: '0' }, part.id, st.id);
      const sig = require('../../scoregraph/pro-spell.js').keyAlters(k ? k.fifths : 0);
      const state = new Map();
      part.events.filter(e => e.m === m.id && e.staff === st.id && e.kind === 'note' && !e.grace)
        .sort((a, b) => SG.rational.cmp(SG.rational.parse(a.at), SG.rational.parse(b.at)))
        .forEach(e => e.heads.forEach(h => {
          if (tieIn.has(h.id)) return;
          const key = h.pitch.step + h.pitch.oct, alter = h.pitch.alter || 0;
          const prevailing = state.has(key) ? state.get(key) : sig[h.pitch.step];
          if (alter !== prevailing) assert.ok(h.acc, f + ': ' + h.id + ' in ' + m.id + ' needs an accidental');
          if (h.acc) state.set(key, alter);
        }));
    }));
  });
});
