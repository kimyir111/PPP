'use strict';
/* The validator (G01 §13, A5-A9). Fixtures come from tests/scoregraph/tools/make-fixtures.js; each sidecar
   states, from the specification, what the validator must report. */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { SG, FIX, json, list, sidecar, codes } = require('./helpers.js');

const V = SG.validate;
const ERRORS = SG.CODES.filter(c => c.startsWith('E-'));
const WARNINGS = SG.CODES.filter(c => c.startsWith('W-'));
const invalidFiles = list('invalid', '.json');
const validFiles = list('valid', '.sg.json');

test('every invalid fixture fails with exactly the ERROR codes of its sidecar (A5)', () => {
  assert.ok(invalidFiles.length >= ERRORS.length);
  invalidFiles.forEach(f => {
    const r = V(json(path.join(FIX, 'invalid', f)));
    assert.equal(r.ok, false, f);
    const got = Object.keys(codes(r.issues, 'ERROR')).sort();
    assert.deepEqual(got, sidecar('invalid', f).errors.slice().sort(), f + ': ' + r.issues.filter(i => i.severity === 'ERROR').map(i => i.code + ' ' + i.message).join('; '));
  });
});

test('every ERROR code has an invalid fixture (A5)', () => {
  const covered = new Set();
  invalidFiles.forEach(f => sidecar('invalid', f).errors.forEach(c => covered.add(c)));
  ERRORS.forEach(c => assert.ok(covered.has(c), c + ' has no invalid fixture'));
});

test('every WARNING code has a valid fixture that reports it (A6)', () => {
  const covered = new Set();
  validFiles.forEach(f => {
    const r = V(json(path.join(FIX, 'valid', f)));
    if (r.ok) Object.keys(codes(r.issues, 'WARNING')).forEach(c => covered.add(c));
  });
  WARNINGS.forEach(c => assert.ok(covered.has(c), c + ' is reported by no valid fixture'));
});

test('every valid fixture has no ERROR and exactly the WARNINGs of its sidecar (A7)', () => {
  assert.ok(validFiles.length >= 16, validFiles.length + ' valid fixtures');
  validFiles.forEach(f => {
    const r = V(SG.parse(require('fs').readFileSync(path.join(FIX, 'valid', f), 'utf8')));
    assert.equal(r.ok, true, f + ': ' + r.issues.filter(i => i.severity === 'ERROR').map(i => i.code + ' ' + i.message).join('; '));
    assert.deepEqual(codes(r.issues, 'WARNING'), sidecar('valid', f).warnings, f);
  });
});

test('issues are sorted by severity, code, first ID number, message; each has a known code and severity', () => {
  const r = V(json(path.join(FIX, 'invalid', 'E-ID-COUNTER.json')));
  const rank = { ERROR: 0, WARNING: 1, INFO: 2 };
  for (let i = 1; i < r.issues.length; i++) {
    const a = r.issues[i - 1], b = r.issues[i];
    assert.ok(rank[a.severity] < rank[b.severity] || (rank[a.severity] === rank[b.severity] && a.code <= b.code));
  }
  validFiles.concat(invalidFiles).forEach(f => {
    const dir = f.endsWith('.sg.json') ? 'valid' : 'invalid';
    V(json(path.join(FIX, dir, f))).issues.forEach(i => {
      assert.ok(SG.CODES.includes(i.code), i.code);
      assert.equal(i.severity, i.code[0] === 'E' ? 'ERROR' : i.code[0] === 'W' ? 'WARNING' : 'INFO');
    });
  });
});

/* shuffle every array whose order the canonical form fixes, and every object's key order */
function shuffled(doc, seed) {
  let s = seed;
  const rnd = () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; };
  const ORDERED = new Set(['measures', 'parts', 'staves', 'voices', 'sources', 'numbers', 'beats', 'heads', 'events',
    'fingering', 'orn', 'items', 'groups', 'display', 'changes', 'breaks', 'degrees', 'ids', 'lyrics']);
  const walk = (v, key) => {
    if (Array.isArray(v)) {
      const out = v.map(x => walk(x));
      if (!ORDERED.has(key) || key === 'heads' || key === 'events') {
        /* entity arrays the canonical form sorts (tuplet/beam member lists keep their order) */
        if (!(key === 'events' && out.every(x => typeof x === 'string'))) {
          for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
        }
      }
      return out;
    }
    if (v && typeof v === 'object') {
      const keys = Object.keys(v);
      for (let i = keys.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [keys[i], keys[j]] = [keys[j], keys[i]]; }
      const o = {};
      keys.forEach(k => { o[k] = walk(v[k], k); });
      return o;
    }
    return v;
  };
  return walk(JSON.parse(JSON.stringify(doc)));
}

test('validating again, or a shuffled copy, gives the same issue list in the same order (A8)', () => {
  validFiles.forEach(f => {
    const g = SG.parse(require('fs').readFileSync(path.join(FIX, 'valid', f), 'utf8'));
    const a = V(g), b = V(g), c = V(g);
    assert.deepEqual(b, a);
    assert.deepEqual(c, a);
    const d = V(SG.parse(JSON.stringify(shuffled(g, 7))));
    assert.deepEqual(d, a, f);
  });
});

/* a large synthetic graph: 2,000 measures of 4/4, two staves, five two-head chords per staff and measure (four
   sixteenths and a dotted half: 2,000 x 2 x 5 x 2 = 40,000 heads), ties across every bar line, a slur per measure */
function big() {
  const b = SG.builder({ id: 'big', source: { kind: 'generator' } });
  const p = b.part({ instrument: { kind: 'piano', family: 'keyboard' } });
  const st1 = b.staff(p, { limb: 'RH' }).id, st2 = b.staff(p, { limb: 'LH' }).id;
  const v1 = b.voice(p, { staff: st1, label: '1' }).id, v2 = b.voice(p, { staff: st2, label: '5' }).id;
  let prev = null;
  for (let i = 0; i < 2000; i++) {
    const m = b.measure({ number: String(i + 1), dur: '1' }).id;
    if (i === 0) {
      b.meter({ m: m, beats: [4], beatType: 4 });
      b.clef(p, { staff: st1, m: m, at: '0', sign: 'G' }); b.clef(p, { staff: st2, m: m, at: '0', sign: 'F' });
    }
    [[v1, st1, 5], [v2, st2, 3]].forEach(([v, st, oct]) => {
      const evs = [];
      for (let k = 0; k < 5; k++) {
        const dur = k < 4 ? '1/16' : '3/4';
        const at = SG.rational.format(SG.rational.make(k, 16));
        evs.push(b.event(p, { kind: 'note', m: m, at: at, dur: dur, voice: v, staff: st, display: k < 4 ? { type: '16th' } : { type: 'half', dots: 1 },
          heads: [{ pitch: { step: 'C', oct: oct } }, { pitch: { step: 'G', oct: oct } }] }));
      }
      b.spanner(p, { type: 'slur', from: evs[0].id, to: evs[4].id });
      if (v === v1) {
        if (prev) b.spanner(p, { type: 'tie', from: prev.heads[0].id, to: evs[0].heads[0].id });
        prev = evs[4];
      }
    });
  }
  return b.finish().graph;
}

test('a 2,000-measure graph with 40,000 heads validates in under 5 s (A9)', () => {
  const g = big();
  const heads = g.parts[0].events.reduce((s, e) => s + e.heads.length, 0);
  assert.equal(g.timeline.measures.length, 2000);
  assert.equal(heads, 40000);
  const t0 = process.hrtime.bigint();
  const r = V(g);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  assert.equal(r.ok, true, r.issues.slice(0, 3).map(i => i.code + ' ' + i.message).join('; '));
  assert.ok(ms < 5000, 'validate took ' + ms + ' ms');
});

test('the validator never changes its input', () => {
  const f = path.join(FIX, 'invalid', 'E-TIE-CHAIN.json');
  const a = json(f), before = JSON.stringify(a);
  V(a);
  assert.equal(JSON.stringify(a), before);
});
