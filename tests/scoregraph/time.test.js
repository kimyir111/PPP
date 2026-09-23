'use strict';
/* Time: positions, metre, keys, play order, tempo, seconds, microseconds, performance time, spans
   (G01 §6, §10, A15-A18, A27). */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { REPO, SG, FIX, read, list, sidecar, xml, importXml, codes } = require('./helpers.js');
const T = SG.time, R = SG.rational;

test('seconds, micros, metre and key at the twelve positions of tempo-meter-key-changes (A15)', () => {
  const g = importXml(xml('tempo-meter-key-changes')).graph;
  const exp = sidecar('xml', 'tempo-meter-key-changes.musicxml');
  const ms = g.timeline.measures;
  exp.positions.forEach(p => {
    const pos = { m: ms[p.m].id, k: 1, at: p.at };
    const sec = T.secondsAt(g, pos, { defaultQpm: exp.defaultQpm });
    assert.equal(R.format(sec), p.seconds, JSON.stringify(p));
    assert.equal(T.micros(sec), p.micros, JSON.stringify(p));
  });
  exp.meters.forEach(x => {
    const mt = T.meterAt(g, ms[x.m].id);
    assert.deepEqual([mt.beats, mt.beatType], [x.beats, x.beatType]);
  });
  const part = g.parts[0].id, staff = g.parts[0].staves[0].id;
  exp.keys.forEach(x => assert.equal(T.keyAt(g, { m: ms[x.m].id, at: x.at }, part, staff).fifths, x.fifths, JSON.stringify(x)));
  assert.deepEqual(ms.map(m => m.dur), exp.measureDurations);
  assert.throws(() => T.tempoMap(g, {}), TypeError);        /* no hidden default tempo */
});

test('a 3/4 pickup: measure lengths, the pickup on beat 3, no measure-length warning; an unmarked short first measure warns (A16)', () => {
  const g = importXml(xml('pickup-3-4')).graph;
  const exp = sidecar('xml', 'pickup-3-4.musicxml');
  assert.deepEqual(g.timeline.measures.map(m => m.dur), exp.measureDurations);
  const first = g.parts[0].events.find(e => e.m === g.timeline.measures[0].id);
  assert.equal(T.metric(g, first).beat, exp.pickupBeat);
  assert.equal(codes(SG.validate(g).issues)['W-MEASURE-LENGTH'], undefined);
  const graphPickup = SG.parse(read(path.join(FIX, 'valid', 'pickup.sg.json')));
  assert.equal(codes(SG.validate(graphPickup).issues)['W-MEASURE-LENGTH'], undefined);
  const unmarked = SG.parse(read(path.join(FIX, 'valid', 'warn-pickup-not-implicit.sg.json')));
  assert.equal(codes(SG.validate(unmarked).issues)['W-MEASURE-LENGTH'], 1);
});

test('the play order of the six repeat fixtures is the one their sidecars derive by the app\'s rule (A17)', () => {
  const names = list('xml', '.musicxml').filter(f => f.startsWith('repeats-'));
  assert.equal(names.length, 6);
  names.forEach(f => {
    const g = importXml(read(path.join(FIX, 'xml', f))).graph;
    const index = new Map(g.timeline.measures.map((m, i) => [m.id, i]));
    assert.deepEqual(T.unroll(g).map(v => index.get(v.m)), sidecar('xml', f).unroll, f);
  });
});

test('visits count k per measure and carry PlaybackW starts; playback lists every visit of a position', () => {
  const g = SG.parse(read(path.join(FIX, 'valid', 'piano-waltz.sg.json')));
  const v = T.unroll(g);
  assert.deepEqual(v.map(x => x.m + '/' + x.k), ['m7/1', 'm8/1', 'm9/1', 'm8/2', 'm10/1']);
  assert.deepEqual(v.map(x => R.format(x.start)), ['0', '1/4', '1', '7/4', '5/2']);
  assert.deepEqual(T.playback(g, { m: 'm8', at: '1/4' }), [{ m: 'm8', k: 1, at: '1/4' }, { m: 'm8', k: 2, at: '1/4' }]);
  assert.equal(T.metric(g, { m: 'm7', at: '0' }).beat, 2);
});

test('performance time: µs -> position -> µs within 1 µs over 100 positions; anchors must increase (A18)', () => {
  const g = SG.parse(read(path.join(FIX, 'valid', 'anchors.sg.json')));
  const pf = g.performances[0];
  assert.ok(pf.anchors.length >= 3);
  const map = T.perfTimeMap(g, pf.id, { defaultQpm: 120 });
  const ms = g.timeline.measures;
  for (let i = 0; i < 100; i++) {
    const mi = i % ms.length, at = R.format(R.make(i % 16, 16));
    const p = { m: ms[mi].id, k: 1, at: at };
    const us = map.toUs(p);
    const back = map.fromUs(us);
    assert.ok(Math.abs(map.toUs(back) - us) <= 1, JSON.stringify(p));
    const dW = R.sub(T.playbackW(g, back), T.playbackW(g, p));
    /* one microsecond at the fastest slope here (2 s a bar) is 1/2,000,000 of a whole note */
    assert.ok(R.le(R.make(Math.abs(dW.n), dW.d), R.make(1, 1000000)), JSON.stringify(p) + ' ' + R.format(dW));
  }
  /* the anchors: 2.0 s at bar 1, 4.0 s at bar 2, 6.1 s at bar 3: the note linked to bar 2 is 100 ms late */
  const late = pf.notes[1];
  const head = g.parts[0].events.find(e => e.heads && e.heads[0].id === late.link);
  assert.equal(late.on - map.toUs({ m: head.m, k: 1, at: head.at }), 100000);
  /* no anchors: the tempo map from 0; one anchor: the tempo map's slope through it */
  const bare = SG.parse(read(path.join(FIX, 'valid', 'piano-waltz.sg.json')));
  const pm = T.perfTimeMap(bare, 'pf51', { defaultQpm: 96 });
  assert.equal(pm.toUs({ m: 'm8', k: 1, at: '0' }), 1625000);
  const invalid = JSON.parse(read(path.join(FIX, 'invalid', 'E-PERF-anchors.json')));
  assert.deepEqual(Object.keys(codes(SG.validate(invalid).issues, 'ERROR')), ['E-PERF']);
});

test('spans: across measures, limited to voices and parts, a missing measure is E-REF-MISSING, the order is fixed (A27)', () => {
  const g = SG.parse(read(path.join(FIX, 'valid', 'voices-4.sg.json')));
  const m = g.timeline.measures[0].id;
  const all = T.resolveSpan(g, { from: { m: m, at: '0' }, to: { m: m, at: '1' } });
  assert.equal(all.length, 6);
  assert.deepEqual(T.resolveSpan(g, { from: { m: m, at: '0' }, to: { m: m, at: '1' } }).map(e => e.id), all.map(e => e.id));
  const v1 = g.parts[0].voices[0].id;
  const only = T.resolveSpan(g, { part: g.parts[0].id, voices: [v1], from: { m: m, at: '0' }, to: { m: m, at: '1' } });
  assert.deepEqual(only.map(e => e.voice), [v1, v1]);
  assert.deepEqual(only.map(e => e.at), ['0', '1/2']);
  const second = T.resolveSpan(g, { from: { m: m, at: '1/2' }, to: { m: m, at: '1' } });
  assert.deepEqual(second.map(e => e.at), ['1/2', '1/2']);
  assert.throws(() => T.resolveSpan(g, { from: { m: 'm99', at: '0' }, to: { m: m, at: '1' } }), e => e.code === 'E-REF-MISSING');
  assert.throws(() => T.resolveSpan(g, { part: 'p99', from: { m: m, at: '0' }, to: { m: m, at: '1' } }), e => e.code === 'E-REF-MISSING');
  /* across measures */
  const s = SG.parse(read(path.join(FIX, 'valid', 'structure.sg.json')));
  const ms = s.timeline.measures.map(m => m.id);
  const across = T.resolveSpan(s, { from: { m: ms[1], at: '0' }, to: { m: ms[3], at: '0' } });
  assert.deepEqual(across.map(e => e.m), [ms[1], ms[2]]);
  const span = T.spanOf(s, across.map(e => e.id));
  assert.deepEqual(span, { part: s.parts[0].id, voices: [across[0].voice], from: { m: ms[1], at: '0' }, to: { m: ms[3], at: '0' } });
  assert.deepEqual(T.resolveSpan(s, span).map(e => e.id), across.map(e => e.id));
  const headSpan = T.spanOf(s, [across[0].heads[0].id]);
  assert.deepEqual(headSpan.from, { m: ms[1], at: '0' });
});

test('ScoreGraph knows nothing of SongGraph: "songgraph" appears in no code outside comments (A27, §10)', () => {
  const dir = path.join(REPO, 'scoregraph');
  fs.readdirSync(dir).filter(f => f.endsWith('.js')).forEach(f => {
    const code = fs.readFileSync(path.join(dir, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    assert.ok(!/songgraph/i.test(code), f);
  });
  const schema = JSON.stringify(SG.schema.SHAPES);
  assert.ok(!/songgraph/i.test(schema));
});
