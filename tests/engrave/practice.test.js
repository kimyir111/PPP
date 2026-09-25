/* G4b - the practice map and the highlighter (docs/GOALS/G04 §8.4, §16.4-§16.6; B6, B7, A31, A32 at the layout level).
   The practice layer reads geometry from a PracticeMap and never lays anything out: highlighting, seeking, looping and
   hit-testing are lookups. The DOM side (class toggles on SVG elements) is G4f's; here the counts are deterministic:
   how many events an update touches, how many it visits. */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { REPO, E, graphOf } = require('./helpers.js');

const L = E.layout, PR = E.practice;
const CN = require(path.join(REPO, 'engrave', 'canon.js'));

async function setup(rel, cfg) {
  const p = E.plan(await graphOf(rel));
  const eng = L.engrave(p, cfg || {});
  return { p, eng, map: PR.createPracticeMap(eng, p) };
}
const SONATINA = 'catalog/method/sonatina/020.mxl';

test('every drawn event maps to its objects, box, measure and onset keys; the keys are the legacy renderer\'s data-onset', async () => {
  const { p, eng, map } = await setup(SONATINA);
  const drawn = new Set(eng.objects.filter(o => o.event).map(o => o.event));
  assert.deepEqual(map.eventIds(), [...drawn].sort());
  map.eventIds().forEach(id => {
    const x = map.event(id);
    const objs = eng.objects.filter(o => o.event === id);
    assert.deepEqual(x.objects.slice().sort(), objs.map(o => o.id).sort());
    objs.forEach(o => assert.ok(o.box[0] >= x.box[0] && o.box[2] <= x.box[2] && o.box[1] >= x.box[1] && o.box[3] <= x.box[3]));
    assert.equal(x.system, objs[0].system);
  });
  /* onset keys: exactly E.onsetKey of each event on each staff its heads are drawn on */
  let keys = 0;
  p.events.filter(e => drawn.has(e.id) && !e.grace).forEach(e => {
    const staves = e.kind === 'rest' ? [e.staff] : [...new Set(e.heads.map(h => h.staff || e.staff))];
    staves.forEach(st => {
      const k = E.onsetKey(p, e, st);
      assert.ok(map.byOnset(k).indexOf(e.id) >= 0, k);
      keys++;
    });
  });
  assert.ok(keys > 1500);
  assert.deepEqual(map.byOnset('no|such|key'), []);
});

test('time: measures start where the ones before end; xAt runs through the columns to the bar line; locate agrees', async () => {
  const { p, map } = await setup(SONATINA);
  let q = 0;
  map.measures.forEach((m, i) => {
    assert.equal(m.index, i);
    assert.ok(Math.abs(m.startQ - q) < 1e-9, m.id);
    q += m.lenQ;
    m.columns.forEach(c => assert.ok(Math.abs(map.xAt(m.id, c.b) - c.x) < 1e-9, 'a column time is the column x'));
    let prev = -Infinity;
    for (let b = 0; b <= m.lenQ + 1e-9; b += m.lenQ / 16) {
      const x = map.xAt(i, b);
      assert.ok(x >= prev - 1e-9, 'x never goes back');
      assert.ok(x >= m.box[0] && x <= m.box[2]);
      prev = x;
    }
    assert.ok(Math.abs(map.xAt(m, m.lenQ) - m.content[1]) < 1e-9, 'the end of the bar: the end of its content');
    const at = map.locate(m.startQ + m.lenQ / 3);
    assert.equal(at.measure, m.id);
    assert.ok(Math.abs(at.x - map.xAt(m.id, m.lenQ / 3)) < 1e-9);
  });
  assert.equal(map.measures.length, p.measures.length);
  assert.equal(map.xAt('m-none', 0), null);
});

test('hit-testing: an event\'s box finds that event, its measure and beat; a point between systems finds the nearer one', async () => {
  const { eng, map } = await setup(SONATINA);
  map.eventIds().filter((_, i) => i % 37 === 0).forEach(id => {
    const x = map.event(id);
    const r = map.hitTest((x.box[0] + x.box[2]) / 2, (x.box[1] + x.box[3]) / 2);
    assert.equal(r.system, x.system);
    assert.equal(r.measure, x.m);
    assert.ok(r.event !== null && map.event(r.event).m === x.m);
    if (!x.grace) assert.ok(Math.abs(r.q - x.startQ) < 1e-9 || r.event !== id, id);
  });
  const s0 = eng.systems[0], s1 = eng.systems[1];
  const gap = (s0.box[3] + s1.box[1]) / 2;
  assert.equal(map.hitTest(s1.box[0] + 10, gap + 0.4).system, 1);
  assert.equal(map.hitTest(s0.box[0] + 10, -50).system, 0);
  const far = map.hitTest(1e6, 1e6);
  assert.equal(far.system, eng.systems.length - 1, 'beyond the page: the last system, its last measure');
  assert.equal(far.measure, eng.systems[eng.systems.length - 1].measures.slice(-1)[0]);
});

test('loops: one box per system a range of measures crosses; the legacy map has the _map shape', async () => {
  const { eng, map } = await setup(SONATINA);
  const s0 = eng.systems[0];
  const boxes = map.loopBoxes(2, 6);
  assert.deepEqual(boxes.map(b => b.system), [0, 1]);
  assert.equal(boxes[0].box[0], map.measure(2).box[0]);
  assert.equal(boxes[1].box[2], map.measure(6).box[2]);
  assert.deepEqual(map.loopBoxes(6, 2), boxes, 'either order');
  assert.equal(map.loopBoxes(1, 1).length, 1);
  assert.ok(map.systems[0].band[0] < s0.staves[0].y && map.systems[0].band[1] > s0.staves[1].y + 4);
  /* a system drawn at a smaller staff size has a band in its own staff space */
  const small = await setup('catalog/method/czerny849/005.mxl', { breakpoint: 'phone' });
  const sc = small.eng.systems.find(x => x.space < 1);
  const band = small.map.systems[sc.index].band, last = sc.staves[sc.staves.length - 1];
  assert.ok(Math.abs(band[0] - (sc.staves[0].y - 1.5 * sc.space)) < 1e-9 && Math.abs(band[1] - (last.y + last.h + 1.5 * sc.space)) < 1e-9);
  assert.ok(Math.abs(last.h - 4 * sc.space) < 0.011);
  const lm = map.legacyMap();
  assert.equal(lm.length, map.measures.length);
  lm.forEach((m, i) => {
    assert.deepEqual(Object.keys(m).sort(), ['id', 'lenQ', 'number', 'pts', 'startQ', 'system', 'w', 'x']);
    assert.equal(m.startQ, map.measures[i].startQ);
    m.pts.forEach(([q, x], k) => { if (k) assert.ok(q > m.pts[k - 1][0] && x > m.pts[k - 1][1]); assert.ok(q >= m.startQ && q < m.startQ + m.lenQ); });
  });
});

test('B6, A31: the highlighter lights exactly the sounding notes and touches only what changes - never all of them', async () => {
  const { eng, map } = await setup(SONATINA);
  const h = PR.createHighlighter(map);
  const timed = map.timed();
  const brute = q => timed.filter(e => e.start <= q && q < e.end).map(e => e.id).sort();
  const end = map.measures[map.measures.length - 1].startQ + map.measures[map.measures.length - 1].lenQ;
  const hash = CN.hash(eng), layouts = L.counters.layout, prepares = L.counters.prepare;
  let maxTouched = 0, frames = 0, prev = [];
  /* play through at a 40 ms tick at 120 bpm (0.08 quarters a frame) */
  for (let q = 0; q < end; q += 0.08) {
    const r = h.update(q);
    const now = brute(q);
    assert.deepEqual(h.active(), now);
    const changed = now.filter(id => prev.indexOf(id) < 0).length + prev.filter(id => now.indexOf(id) < 0).length;
    assert.equal(r.touched, changed, 'touched = what changed');
    assert.deepEqual(r.on.concat(r.off).sort(), now.filter(id => prev.indexOf(id) < 0).concat(prev.filter(id => now.indexOf(id) < 0)).sort());
    maxTouched = Math.max(maxTouched, r.touched);
    prev = now;
    frames++;
  }
  assert.ok(frames > 3000);
  assert.ok(maxTouched <= 12, 'a frame touches a chord or two, not the piece: ' + maxTouched);
  /* forward play visits each event at most twice (on, off): the per-frame cost does not grow with the piece */
  assert.ok(h.stats.visited <= 2 * timed.length);
  /* seeks: backwards re-derives the set from the events that can still sound, then only the difference is touched */
  [300, 10, 10.5, 0, 150.25, 150.26, 42].forEach(q => {
    const before = h.active();
    const r = h.update(q);
    assert.deepEqual(h.active(), brute(q), 'seek to ' + q);
    const now = h.active();
    assert.equal(r.touched, now.filter(id => before.indexOf(id) < 0).length + before.filter(id => now.indexOf(id) < 0).length);
  });
  assert.ok(h.stats.rebuilds >= 3);
  /* highlighting never lays out and never changes the geometry */
  assert.equal(L.counters.layout, layouts);
  assert.equal(L.counters.prepare, prepares);
  assert.equal(CN.hash(eng), hash);
  /* rests are not lit unless asked */
  assert.ok(timed.every(e => !map.event(e.id).rest));
  assert.ok(PR.createHighlighter(map, { rests: true }).size > timed.length);
});

test('B6: the cost of a frame does not depend on the length of the piece', async () => {
  const short = await setup('catalog/method/beyer/013.mxl');
  const long = await setup(SONATINA);
  const visitsPerFrame = m => {
    const h = PR.createHighlighter(m.map);
    const lenQ = 16;
    for (let q = 0; q < lenQ; q += 0.08) h.update(q);
    return h.stats.visited / h.stats.updates;
  };
  /* the same number of quarters played: visits per frame track the music's density, not the number of events */
  assert.ok(long.map.timed().length > 5 * short.map.timed().length);
  assert.ok(visitsPerFrame(long) < 1.5, 'visits per frame in a 1,500-note piece: ' + visitsPerFrame(long));
  assert.ok(visitsPerFrame(short) < 1.5);
});

test('reflow keeps the practice ids: desktop and phone maps name the same events, keys, times; only the geometry moves', async () => {
  const p = E.plan(await graphOf(SONATINA));
  const eng = L.createEngraver(p);
  const d = PR.createPracticeMap(eng.layout({ breakpoint: 'desktop' }), p), ph = PR.createPracticeMap(eng.layout({ breakpoint: 'phone' }), p);
  assert.deepEqual(d.eventIds(), ph.eventIds());
  assert.deepEqual(d.onsetKeys(), ph.onsetKeys());
  d.eventIds().forEach(id => { assert.equal(d.event(id).startQ, ph.event(id).startQ); assert.deepEqual(d.event(id).objects, ph.event(id).objects); });
  assert.deepEqual(d.measures.map(m => [m.id, m.startQ, m.lenQ, m.columns.map(c => c.q)]), ph.measures.map(m => [m.id, m.startQ, m.lenQ, m.columns.map(c => c.q)]));
  assert.notDeepEqual(d.measures.map(m => m.system), ph.measures.map(m => m.system));
  /* a highlighter's state is event ids and time: it carries over to the other width unchanged */
  const h = PR.createHighlighter(d);
  h.update(33.3);
  const h2 = PR.createHighlighter(ph);
  h2.update(33.3);
  assert.deepEqual(h.active(), h2.active());
});
