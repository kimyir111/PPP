/* G4d-2: the renderer in the page, its Node-testable half (docs/GOALS/G04 §16; A31, A32; DECISIONS G4-D2-*).

   engrave/page.js is the app's ScoreView under renderer 'engrave'. What does not need a DOM is checked here: the layout
   config a view asks for (a resize inside a breakpoint is the same config - no layout), the drawKey (the plan and layout
   versions are in it; the playhead, the notes lit, the theme are not), the page's sync (the legacy rule on every frame,
   touching only what changed - A31's deterministic proxy, M22), the practice layer's groups and text. The page itself -
   the SVG in the view, the fallback, the pointer, the theme, the timings - is tests/engrave/tools/page-check.js. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { REPO, SG, E, graphOf, appFinalize } = require('./helpers.js');
const PG = require('../../engrave/page.js');
const LY = require('../../engrave/layout.js');
const PL = require('../../engrave/plan.js');

const html = fs.readFileSync(path.join(REPO, 'Piano Coach App.dc.html'), 'utf8');
const HOLD = +/const SCORE_HAND_HOLD_Q = ([\d.]+);/.exec(html)[1];
const noteEnd = (abs, dur) => abs + Math.max(dur || 0, HOLD);

/* the app's Score for a graph (toScore, then the app's own Score.finalize), its render source (the graph remembered live,
   agree and link checked), plan, layout, SVG and the page's groups - what the page builds, without a DOM */
async function pageOf(rel, cfg) {
  const g = await graphOf(rel);
  const score = appFinalize()(SG.legacy.toScore(g, { name: path.basename(rel), id: 'page:' + rel }));
  const src = E.createSource({});
  src.remember(score, g, 'test');
  const s = src.resolveSync(score);
  assert.equal(s.via, 'live', rel + ': the file\'s graph agrees with the Score');
  assert.ok(s.agree.ok && s.link.ok);
  const plan = PL.plan(g, PG.semanticConfig({}));
  const eng = LY.engrave(plan, cfg || { breakpoint: 'desktop' });
  const text = E.svg(eng, plan, PG.SVG_OPTS);
  const items = [...text.matchAll(/<g class="ppp-note vf-stavenote" data-onset="([^"]+)" data-ev="([^"]+)"( data-rest="1")?>/g)]
    .map(m => ({ el: null, ev: m[2], staff: +m[1].split('|')[2], rest: !!m[3], onset: m[1] }));
  const ident = E.identity(score, s, plan);
  const groups = PG.groupsFor(items, score, ident, noteEnd);
  return { g, score, src: s, plan, eng, text, items, ident, groups };
}

/* a classList that counts what is written */
function fakeEl() {
  const set = new Set();
  const el = { writes: 0, classList: { toggle(c, on) { el.writes++; if (on) set.add(c); else set.delete(c); }, has: c => set.has(c) }, classes: () => [...set].sort() };
  return el;
}

test('layoutConfig: a view\'s bars are a window, the whole piece none; the breakpoint is the only thing the viewport decides (A32); zoom and bars to a line set the width', async () => {
  const { score } = await pageOf('catalog/method/sonatina/020.mxl');
  const n = score.measures.length;
  const close = { startM: score.measures[4].number, count: 4, perRow: 0, zoom: 1 };
  const c1 = PG.layoutConfig(close, score, 1400);
  assert.deepEqual(c1.window, [4, 7]);
  assert.equal(c1.barsPerSystem, 4);
  assert.equal(c1.width, 100);
  /* a resize inside a breakpoint is the same config, so the view is not laid out (or even drawn) again */
  [721, 900, 1280, 1920, 3000].forEach(w => assert.deepEqual(PG.layoutConfig(close, score, w), c1, w + ' px'));
  /* across 720 px it is the phone's (two bars in 40 sp are 20 sp a bar), the same for every phone width */
  const ph = PG.layoutConfig(Object.assign({}, close, { count: 2 }), score, 700);
  assert.equal(ph.breakpoint, 'phone');
  assert.equal(ph.width, 40);
  [320, 390, 720].forEach(w => assert.deepEqual(PG.layoutConfig(Object.assign({}, close, { count: 2 }), score, w), ph));
  /* zoom (the close view's 0.7-1.6): fewer staff spaces to the line - bigger notes */
  assert.equal(PG.layoutConfig(Object.assign({}, close, { zoom: 1.25 }), score, 1400).width, 80);
  assert.equal(PG.layoutConfig(Object.assign({}, close, { zoom: 0.7 }), score, 1400).width, 143);
  /* the whole score: no window, four bars a line on a desktop, two on a phone (barsPerLine) */
  const whole = { startM: score.measures[0].number, count: n, perRow: 4, fluid: true };
  assert.deepEqual(PG.layoutConfig(whole, score, 1400), LY.normalizeConfig({ breakpoint: 'desktop', width: 100, barsPerSystem: 4 }));
  assert.deepEqual(PG.layoutConfig(Object.assign({}, whole, { perRow: 2 }), score, 700), LY.normalizeConfig({ breakpoint: 'phone', width: 40, barsPerSystem: 2 }));
  /* the window stops at the end of the piece */
  assert.deepEqual(PG.layoutConfig({ startM: score.measures[n - 2].number, count: 4 }, score, 1400).window, [n - 2, n - 1]);
});

test('drawKey: the graph, the plan and layout versions and configs make a new drawing; the playhead, lit notes, hands, memory, wrong notes, theme and paper do not (G04 §16.1, G4-D1a-1)', () => {
  const sem = PG.semanticConfig({});
  const cfg = LY.normalizeConfig({ breakpoint: 'desktop' });
  const base = { numbers: true, fluid: true, perRow: 4, heading: true };
  const k = PG.viewKey('g:abc', PL.PLAN_VERSION, sem, cfg, base);
  assert.ok(k.indexOf(PL.PLAN_VERSION) >= 0 && k.indexOf(LY.VERSION) >= 0, 'the version rule: plan/N and engr/N are in the key');
  assert.notEqual(PG.viewKey('g:abd', PL.PLAN_VERSION, sem, cfg, base), k, 'another graph');
  assert.notEqual(PG.viewKey('g:abc', 'plan/999', sem, cfg, base), k, 'another plan version');
  assert.notEqual(PG.viewKey('g:abc', PL.PLAN_VERSION, PG.semanticConfig({ marks: false }), cfg, base), k, 'marks hidden');
  assert.notEqual(PG.viewKey('g:abc', PL.PLAN_VERSION, sem, LY.normalizeConfig({ breakpoint: 'phone' }), base), k, 'another layout');
  assert.notEqual(PG.viewKey('g:abc', PL.PLAN_VERSION, sem, cfg, Object.assign({}, base, { guidance: true })), k, 'the note-name letters');
  /* what sync and CSS do */
  const same = Object.assign({}, base, { beat: 12.5, playX: 12.5, hands: 'left', wrong: [60, 64], hidePlan: { hide: {} }, hide: 2, currentM: 7, loopFrom: 3,
    loopTo: 9, theme: 'dark', paper: false, pick: () => {} });
  assert.equal(PG.viewKey('g:abc', PL.PLAN_VERSION, sem, cfg, same), k);
});

test('the page\'s groups are the Score\'s notes: every note of a drawn event in one group of its staff, with the legacy renderer\'s start, end, pitches, hand and onset key', async () => {
  for (const rel of ['catalog/method/sonatina/020.mxl', 'tests/fixtures/engraving-stress.musicxml', 'catalog/hymns/for-all-the-saints.musicxml']) {
    const { score, groups, ident, items } = await pageOf(rel);
    assert.ok(ident.complete, rel + ': identity complete');
    assert.equal(groups.length, items.length, rel + ': every g.ppp-note has its notes');
    const seen = new Map();
    groups.forEach(gr => {
      const x = ident.events[gr.ev];
      x.notes.filter(i => (score.notes[i].staff || 1) === gr.staff).forEach(i => seen.set(i, (seen.get(i) || 0) + 1));
      const head = score.notes[Math.min(...x.notes.filter(i => (score.notes[i].staff || 1) === gr.staff))];
      assert.equal(gr.start, head.abs);
      assert.equal(gr.end, noteEnd(head.abs, head.dur));
      assert.equal(gr.key, head.m + '|' + (+head.b).toFixed(3) + '|' + (head.staff || 1), 'the App onsetKey');
      assert.equal(gr.hand, head.hand);
    });
    /* each Score note that is drawn (not a grace note: those are g.ppp-grace, not lit) is in exactly one group */
    score.notes.forEach((n, i) => { if (!n.grace) assert.equal(seen.get(i), 1, rel + ' note ' + i + ' ' + n.m + '|' + n.b); });
    /* the onset key a group names is the one its g.ppp-note carries (svg.js, plan.onsetKey) */
    groups.forEach((gr, i) => assert.equal(gr.key, items[i].onset));
  }
});

test('A31 (Node proxy, M22): on every frame the page\'s sync gives each note the legacy renderer\'s classes, and writes only what changed - the whole of sonatina/020', async (t) => {
  const { groups, score } = await pageOf('catalog/method/sonatina/020.mxl');
  const els = groups.map(() => fakeEl());
  const gs = groups.map((g, i) => Object.assign({}, g, { el: els[i] }));
  const sync = PG.createSync(gs);
  const end = score.measures[score.measures.length - 1].startQ + score.measures[score.measures.length - 1].lenQ;
  /* a memory plan that hides every third onset key, and one that ghosts */
  const keys = [...new Set(gs.map(g => g.key))];
  const planA = { hide: Object.fromEntries(keys.filter((k, i) => i % 3 === 0).map(k => [k, true])) };
  const planB = { ghost: true, hide: planA.hide };
  let p = { beat: null, hands: 'both', wrong: [] };
  const frames = [];
  let rnd = 7;
  const next = () => { rnd = (rnd * 1103515245 + 12345) % 2147483648; return rnd / 2147483648; };
  /* playback at 120 per minute, a 40 ms tick = 0.08 quarter; now and then a seek, a hand or memory change, wrong notes */
  for (let q = 0, i = 0; q < end; i++) {
    const r = next();
    if (r < 0.01) q = Math.max(0, q - 8 * next());
    else if (r < 0.015) q = end * next();
    else q += 0.08;
    const pp = Object.assign({}, p, { beat: q });
    if (i % 997 === 500) pp.hands = pp.hands === 'both' ? 'right' : pp.hands === 'right' ? 'left' : 'both';
    if (i % 1499 === 700) pp.hidePlan = pp.hidePlan === planA ? planB : pp.hidePlan === planB ? null : planA;
    if (i % 1201 === 300) pp.hide = ((pp.hide || 0) + 1) % 4;
    if (i % 53 === 0) pp.wrong = next() < 0.5 ? [] : [60 + Math.floor(next() * 24)];
    const before = els.map(e => e.classes().join());
    const writes0 = els.reduce((s, e) => s + e.writes, 0);
    const res = sync.update(pp);
    const after = els.map(e => e.classes().join());
    const changed = before.filter((c, k) => c !== after[k]).length;
    const touchedEls = els.filter(e => e.writes > 0).length;
    frames.push({ touched: res.touched, changed: changed, ms: res.ms, full: pp.hands !== p.hands || pp.hidePlan !== p.hidePlan || pp.hide !== p.hide });
    /* the legacy rule, note by note */
    if (i % 25 === 0 || res.touched) gs.forEach((g, k) => assert.deepEqual(els[k].classes(), PG.legacyClasses(g, pp).sort(), 'frame ' + i + ' note ' + k));
    assert.ok(res.touched <= changed, 'frame ' + i + ': touched ' + res.touched + ' > changed ' + changed);
    assert.equal(res.touched, changed, 'what is written is what changed');
    assert.ok(els.reduce((s, e) => s + e.writes, 0) - writes0 >= res.touched);
    els.forEach(e => { e.writes = 0; });
    void touchedEls;
    p = pp;
  }
  const normal = frames.filter(f => !f.full);
  const ms = normal.map(f => f.ms).sort((a, b) => a - b);
  const p95 = ms[Math.floor(ms.length * 0.95)];
  const maxTouched = Math.max(...normal.map(f => f.touched));
  t.diagnostic(frames.length + ' frames over ' + gs.length + ' note groups: touched per frame max ' + maxTouched + ', p95 ' + p95.toFixed(3) + ' ms (Node), full frames ' +
    frames.filter(f => f.full).length + ', visited ' + sync.stats.visited);
  assert.ok(frames.length > 3000);
  /* the cost of a frame does not grow with the piece: what is visited is what changes, not every note */
  const fullVisits = sync.stats.fullFrames * gs.length;
  assert.ok(sync.stats.visited - fullVisits < 4 * (frames.length + normal.reduce((s, f) => s + f.touched, 0)), 'visited ~ changed, not n per frame');
  assert.ok(maxTouched < gs.length / 10, 'no ordinary frame touches the whole score');
});

test('the practice layer\'s text: a bar number for every bar (or none), the heading only on the whole score, a letter under every note when asked - and a bar number clear of the engraving', async () => {
  const { eng, plan, score, groups } = await pageOf('catalog/method/sonatina/020.mxl');
  const U = PG.UNIT;
  const all = PG.annotations(eng, plan, score, { numbers: true, heading: true, perRow: 4, guidance: true }, groups);
  const bars = all.filter(t => t.kind === 'bar');
  assert.equal(bars.length, eng.measures.length);
  assert.deepEqual(bars.map(t => t.text), score.measures.map(m => String(m.number)), 'the Score\'s numbers, in order');
  assert.equal(all.filter(t => t.kind === 'title').length, score.title ? 1 : 0);
  assert.ok(all.filter(t => t.kind === 'title' || t.kind === 'composer').every(t => t.y < 0), 'the heading stands above the page');
  assert.equal(all.filter(t => t.kind === 'guide').length, groups.filter(gr => !gr.rest && gr.letter).length);
  assert.equal(PG.annotations(eng, plan, score, { numbers: false, heading: true, perRow: 0, guidance: false }, groups).length, 0);
  /* a bar number is lifted over whatever the engraver drew where it would stand (its box against every object's) */
  const boxes = eng.objects.filter(o => ['staff', 'barline', 'brace'].indexOf(o.kind) < 0).map(o => [o.system, o.box.map(v => v * U)]);
  let lifted = 0;
  bars.forEach(t => {
    const w = t.text.length * t.size * 0.6, b = [t.x, t.y - t.size * 0.75, t.x + w, t.y + t.size * 0.2];
    const top = eng.systems[t.row].staves[0].y * U;
    if (t.y < top - 9) lifted++;
    boxes.filter(([s]) => s === t.row).forEach(([, o]) => assert.ok(!(b[0] < o[2] && o[0] < b[2] && b[1] < o[3] && o[1] < b[3]), 'bar ' + t.text + ' clear'));
  });
  assert.ok(lifted > 0 && lifted < bars.length, lifted + ' of ' + bars.length + ' lifted');
});

test('svg.js {unit: 10}: the page\'s SVG is the same drawing in the legacy renderer\'s px - every length times ten, every scale factor kept', async () => {
  let checked = 0;
  for (const rel of ['tests/engrave/fixtures/e/E16-dynamics-hairpins.musicxml', 'tests/engrave/fixtures/e/E40-arpeggio-gliss.musicxml',
    'tests/engrave/fixtures/e/E14-grace.musicxml', 'catalog/method/czerny849/020.mxl']) {
    if (!fs.existsSync(path.join(REPO, rel))) continue;
    const g = await graphOf(rel);
    const plan = E.plan(g);
    const eng = E.layout.engrave(plan, { breakpoint: 'desktop' });
    const one = E.svg(eng, plan), ten = E.svg(eng, plan, { unit: 10 });
    assert.equal(E.svg(eng, plan, { unit: 1 }), one, 'unit 1 is the default, byte for byte');
    /* the same elements with the same attributes; a geometric attribute's numbers are ten times (to the rounding, 0.01 either
       way), except a glyph's scale() factor; every other attribute (classes, data-*, ids, hrefs) is the same text; the root's
       width and height stay px; a symbol's own path is the font's and stays, its scale() carries the unit */
    const GEOM = new Set(['x', 'y', 'width', 'height', 'd', 'transform', 'stroke-width', 'stroke-dasharray', 'font-size', 'viewBox', 'x1', 'x2', 'y1', 'y2', 'cx', 'cy', 'r', 'rx']);
    const tags = s => [...s.matchAll(/<(\w+)((?:\s+[\w:-]+="[^"]*")*)\s*\/?>/g)].map(m => ({ tag: m[1], at: [...m[2].matchAll(/([\w:-]+)="([^"]*)"/g)].map(x => [x[1], x[2]]) }));
    const nums = v => (v.match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
    const A = tags(one), B = tags(ten);
    assert.equal(A.length, B.length, rel + ': the same elements');
    A.forEach((ea, i) => {
      const eb = B[i];
      assert.equal(eb.tag, ea.tag);
      assert.deepEqual(eb.at.map(x => x[0]), ea.at.map(x => x[0]), rel + ' <' + ea.tag + '> attributes');
      ea.at.forEach(([name, va], k) => {
        const vb = eb.at[k][1];
        const root = ea.tag === 'svg' && (name === 'width' || name === 'height');
        const symbolPath = ea.tag === 'path' && name === 'd' && A[i - 1] && A[i - 1].tag === 'symbol';
        if (!GEOM.has(name) || root || symbolPath) { assert.equal(vb, va, rel + ' <' + ea.tag + ' ' + name + '>'); return; }
        if (name === 'transform' && /scale\(/.test(va) && ea.tag === 'path') {
          /* a symbol's path: scale(k -k) becomes scale(10k -10k) */
          const x = nums(va), y = nums(vb);
          x.forEach((v, j) => assert.ok(Math.abs(v * 10 - y[j]) < 1e-6, rel + ' symbol scale ' + va + ' -> ' + vb));
          return;
        }
        const x = nums(va), y = nums(vb);
        assert.equal(x.length, y.length);
        /* a glyph's transform: translate(x y) x10, then scale(s) kept */
        const factorAt = name === 'transform' ? x.length - 1 : -1;
        x.forEach((v, j) => {
          if (j === factorAt) assert.equal(y[j], v, rel + ' a glyph\'s scale factor is kept');
          else assert.ok(Math.abs(v * 10 - y[j]) <= 0.051, rel + ' <' + ea.tag + ' ' + name + '> ' + va + ' -> ' + vb);
          checked++;
        });
      });
    });
    assert.match(ten, /viewBox="0 0 [\d.]+ [\d.]+" width="[\d.]+" height="[\d.]+"/);
    const vb = /viewBox="0 0 ([\d.]+) ([\d.]+)" width="([\d.]+)" height="([\d.]+)"/.exec(ten);
    assert.ok(Math.abs(+vb[1] - +vb[3]) < 0.05 && Math.abs(+vb[2] - +vb[4]) < 0.05, 'one user unit is one px');
  }
  assert.ok(checked > 5000, checked + ' numbers compared');
});

test('svg.js {inline}: the page\'s SVG writes every glyph as a path where the layout put it - the <use> drawing, point for point, and nothing else changed', async () => {
  /* svg.js's own inline mode against its own <use> mode (not page.js's SVG_OPTS, which chose <use> for B9 from G4-D2-19
     on - this test is about the two modes svg.js offers agreeing with each other, not about which one the page draws) */
  const INLINE_OPTS = Object.assign({}, PG.SVG_OPTS, { inline: true });
  let scaled = 0, total = 0;
  const OL = require('../../engrave/outlines.js');
  for (const rel of ['tests/engrave/fixtures/e/E14-grace.musicxml', 'tests/engrave/fixtures/e/E19-clefs.musicxml', 'tests/engrave/fixtures/e/E16-dynamics-hairpins.musicxml',
    'tests/engrave/fixtures/e/E22-repeats-jumps.musicxml', 'catalog/method/czerny849/020.mxl']) {
    const g = await graphOf(rel);
    const plan = E.plan(g);
    const eng = E.layout.engrave(plan, { breakpoint: 'phone' });
    const a = E.svg(eng, plan, { unit: 10 }), b = E.svg(eng, plan, INLINE_OPTS);
    assert.equal(E.svg(eng, plan, INLINE_OPTS), b, 'deterministic');
    assert.doesNotMatch(b, /<use |<symbol |<defs>/, rel + ': no <use>, no <symbol>');
    /* each <use> of the unit-10 SVG is, in the inline one, a path: the symbol's outline moved to the <use>'s place and scaled by
       its transform - worked out here from the <use> itself, not from the layout */
    const uses = [...a.matchAll(/<use href="#ppp-g-([^"]+)"( class="[^"]*")?( x="([-\d.]+)" y="([-\d.]+)"| transform="translate\(([-\d.]+) ([-\d.]+)\) scale\(([\d.]+)\)")\/>/g)];
    assert.ok(uses.length > 0);
    total += uses.length;
    let k = 0;
    const out = a.replace(/<defs>[\s\S]*?<\/defs>\n/, '').replace(/<use [^>]*\/>/g, () => {
      const m = uses[k++];
      const x = +(m[4] !== undefined ? m[4] : m[6]), y = +(m[5] !== undefined ? m[5] : m[7]), s = m[8] !== undefined ? +m[8] : 1;
      if (s !== 1) scaled++;
      const K = 10 / 360 * s;
      let n = 0;
      const d = OL.PATHS[m[1]].replace(/-?\d+(?:\.\d+)?/g, v => { const r = n++ % 2 === 0 ? x + K * +v : y - K * +v; const q = Math.round(r * 100) / 100; return String(q === 0 ? 0 : q); });
      return '<path' + (m[2] || '') + ' d="' + d + '"/>';
    });
    /* the <use>'s own place is rounded to 0.01 before it is scaled, the inline path's is not: a point may differ by 0.01 */
    const nums = s => s.split(/(-?\d+(?:\.\d+)?)/);
    const A = nums(out), B = nums(b);
    assert.equal(A.length, B.length, rel + ': the same elements');
    for (let i = 0; i < A.length; i++) {
      if (i % 2 === 0) assert.equal(B[i], A[i], rel + ': the same text around the numbers');
      else assert.ok(Math.abs(+A[i] - +B[i]) <= 0.011, rel + ': ' + A[i] + ' vs ' + B[i]);
    }
  }
  assert.ok(scaled > 10, scaled + ' glyphs drawn smaller');
  assert.ok(total > 300, total + ' glyphs');
});
