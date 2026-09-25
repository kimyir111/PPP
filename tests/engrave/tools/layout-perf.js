/* G04 §19.2, §21.6: the layout core's time against the budgets, on this machine (Node; the browser and a 4x slower
   CPU are tests/engrave/tools/browser-parity.js). Budgets are judged here, not in CI (§19.2: time shakes with the
   machine; CI checks the deterministic proxies - touched counts, hashes).

     node tests/engrave/tools/layout-perf.js [--runs=N]    -> tests/engrave/out/layout-perf.json and a table

   What G4b can measure of each budget (it has no SVG and no app switch yet - those are G4c-G4f):
     B1  plan, the longest corpus score                                  <= 60 ms
     B2  a close-view window (4 bars) laid out, no cache (layout only)   p95 <= 25 ms (the budget includes the SVG)
     B3  the same window again, from the engraver's cache                p95 <= 8 ms
     B4  the whole score laid out (the first screen needs it: breaks are global)   <= 100 ms
     B5  the whole score, sonatina/020: measured, NOT judged here. §19.2 asks <= 300 ms done, <= 12 ms per chunk and no
         long task - that is the page's time slicing (G4f); G4b has one synchronous prepare + layout call
     B6  a highlight update during playback                              p95 <= 1 ms, touched = changed
     B7  a resize inside a breakpoint                                    0 layouts
   plus the practice map (build, hit-test, seek) and a reflow to the other breakpoint.

   The pieces are G04 §19.1's baseline sizes, taken from outside the G0 hold-out (tests/bench/corpus/references.json
   holdout: true): per-piece values are printed, and a hold-out file's never are (G04 §22.2). beyer/028 and
   hymns/take-my-life stand for §19.1's beyer/030 and hymns/amazing-grace (hold-outs) at the same size. */
'use strict';
const fs = require('fs');
const path = require('path');
const H = require('../helpers.js');
const { REPO, E } = H;

const PIECES = ['catalog/method/beyer/028.mxl', 'catalog/hymns/take-my-life.musicxml', 'catalog/method/burgmuller25/021.mxl',
  'catalog/method/czerny849/001.mxl', 'catalog/method/sonatina/013.mxl', 'catalog/method/sonatina/016.mxl', 'catalog/method/sonatina/020.mxl'];
const now = () => Number(process.hrtime.bigint()) / 1e6;
const pct = (xs, p) => { const s = xs.slice().sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)] : 0; };
const med = xs => pct(xs, 0.5);
const r2 = v => Math.round(v * 100) / 100;

async function main() {
  const arg = process.argv.find(a => a.startsWith('--runs='));
  const RUNS = arg ? +arg.slice(7) : 5;
  const holdout = H.holdoutPaths();
  const bad = PIECES.filter(r => holdout.has(r));
  if (bad.length) throw new Error('a G0 hold-out file is not measured per piece: ' + bad.join(', '));
  const out = { machine: process.platform + ' node ' + process.version, runs: RUNS, pieces: {}, corpus: {}, budgets: {} };

  /* the corpus: plan, prepare and one layout of every committed score (cold: each graph once) */
  const all = await H.corpusGraphs();
  const planMs = [], fullMs = [], prepMs = [];
  let longest = null;
  all.forEach(([rel, g]) => {
    let t = now();
    const p = E.plan(g);
    const tp = now() - t;
    t = now();
    const P = E.layout.prepare(p);
    const tr = now() - t;
    t = now();
    E.layout.layout(P, { breakpoint: 'desktop' });
    const tl = now() - t;
    planMs.push(tp); prepMs.push(tr); fullMs.push(tr + tl);
    if (!longest || p.events.length > longest.events) longest = { rel: rel, events: p.events.length, plan: tp };
  });
  out.corpus = { graphs: all.length, planMs: { median: r2(med(planMs)), max: r2(Math.max(...planMs)) },
    prepareMs: { median: r2(med(prepMs)), max: r2(Math.max(...prepMs)) }, fullLayoutMs: { median: r2(med(fullMs)), p95: r2(pct(fullMs, 0.95)), max: r2(Math.max(...fullMs)) },
    longest: { rel: longest.rel, events: longest.events, planMs: r2(longest.plan) } };

  /* the G04 baseline pieces (§19.1): warm medians over RUNS */
  const windows = [], hits = [], updates = [], hitTests = [], seeks = [];
  let touchedOk = true, resizeLayouts = 0;
  for (const rel of PIECES) {
    const g = await H.graphOf(rel);
    const p = E.plan(g);
    const row = { events: p.events.length, measures: p.measures.length };
    const t = { plan: [], prepare: [], desktop: [], phone: [], map: [] };
    let P, eng, map;
    for (let r = 0; r < RUNS; r++) {
      let a = now(); E.plan(g); t.plan.push(now() - a);
      a = now(); P = E.layout.prepare(p); t.prepare.push(now() - a);
      a = now(); eng = E.layout.layout(P, { breakpoint: 'desktop' }); t.desktop.push(now() - a);
      a = now(); E.layout.layout(P, { breakpoint: 'phone' }); t.phone.push(now() - a);
      a = now(); map = E.practice.createPracticeMap(eng, p); t.map.push(now() - a);
    }
    Object.keys(t).forEach(k => { row[k + 'Ms'] = r2(med(t[k])); });
    row.fullMs = r2(row.prepareMs + row.desktopMs);
    row.objects = eng.objects.length;
    row.systems = eng.systems.length;
    /* B2/B3: every 4-bar window, laid out from the prepared plan, then again from the cache */
    const en = E.layout.createEngraver(p);
    for (let i = 0; i + 3 < p.measures.length; i += 4) {
      let a = now(); en.layout({ window: [i, i + 3] }); windows.push(now() - a);
      a = now(); en.layout({ window: [i, i + 3] }); hits.push(now() - a);
    }
    /* B7: resizing the window across desktop widths is the same config: no layout */
    const before = en.stats.layouts;
    en.layout(E.layout.screenConfig(1280));
    [900, 1024, 1366, 1600, 1920, 721].forEach(px => en.layout(E.layout.screenConfig(px)));
    resizeLayouts += en.stats.layouts - before - 1;
    /* B6: play through at a 40 ms tick, 120 bpm */
    const h = E.practice.createHighlighter(map);
    const end = map.measures[map.measures.length - 1].startQ + map.measures[map.measures.length - 1].lenQ;
    let prev = new Set();
    for (let q = 0; q < end; q += 0.08) {
      const a = now();
      const res = h.update(q);
      updates.push(now() - a);
      const cur = new Set(h.active());
      let changed = 0;
      cur.forEach(id => { if (!prev.has(id)) changed++; });
      prev.forEach(id => { if (!cur.has(id)) changed++; });
      if (res.touched !== changed) touchedOk = false;
      prev = cur;
    }
    /* lookups: a hit-test at every event, a seek to every measure */
    map.eventIds().forEach(id => { const x = map.event(id); const a = now(); map.hitTest((x.box[0] + x.box[2]) / 2, (x.box[1] + x.box[3]) / 2); hitTests.push(now() - a); });
    map.measures.forEach(m => { const a = now(); map.locate(m.startQ + m.lenQ / 2); seeks.push(now() - a); });
    out.pieces[rel] = row;
  }
  const s020 = out.pieces['catalog/method/sonatina/020.mxl'];
  out.budgets = {
    B1: { what: 'plan, the longest corpus score (ms)', value: out.corpus.longest.planMs, budget: 60 },
    B2: { what: '4-bar window layout, no cache, p95 (ms; layout only - the SVG is G4c+)', value: r2(pct(windows, 0.95)), budget: 25, n: windows.length },
    B3: { what: 'the same window from the cache, p95 (ms)', value: r2(pct(hits, 0.95)), budget: 8 },
    B4: { what: 'whole-score layout, prepare + layout, worst baseline piece (ms)', value: Math.max(...PIECES.map(r => out.pieces[r].fullMs)), budget: 100 },
    /* measured, not judged (§19.2 B5: <= 300 ms, <= 12 ms per chunk, long task 0 - the page's time slicing, G4f) */
    B5: { what: 'sonatina/020 whole layout, prepare + layout (ms), and its longest single call (ms) - not judged in G4b', value: s020.fullMs,
      longestCallMs: Math.max(s020.prepareMs, s020.desktopMs), judged: false },
    B6: { what: 'highlight update p95 (ms); touched = changed every frame', value: r2(pct(updates, 0.95)), max: r2(Math.max(...updates)), budget: 1, touchedOk: touchedOk, n: updates.length },
    B7: { what: 'layouts on resize inside a breakpoint', value: resizeLayouts, budget: 0 },
    lookup: { hitTestP95: r2(pct(hitTests, 0.95)), seekP95: r2(pct(seeks, 0.95)), mapBuild020Ms: s020.mapMs },
    reflow: { what: 'sonatina/020 to the phone breakpoint, from the prepared plan (ms)', value: s020.phoneMs }
  };
  Object.values(out.budgets).forEach(b => { if (b.budget !== undefined) b.ok = b.value <= b.budget && (b.touchedOk !== false); });
  const dir = path.join(REPO, 'tests', 'engrave', 'out');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'layout-perf.json'), JSON.stringify(out, null, 1) + '\n');
  console.log(out.machine + ', ' + RUNS + ' runs, medians');
  console.log('corpus ' + out.corpus.graphs + ' graphs: plan ' + JSON.stringify(out.corpus.planMs) + ', prepare+layout ' + JSON.stringify(out.corpus.fullLayoutMs));
  console.log('piece'.padEnd(40) + 'events  bars  plan  prep  desk  phone  map  systems objects');
  PIECES.forEach(r => {
    const x = out.pieces[r];
    console.log(r.padEnd(40) + String(x.events).padStart(6) + String(x.measures).padStart(6) + [x.planMs, x.prepareMs, x.desktopMs, x.phoneMs, x.mapMs].map(v => String(v).padStart(6)).join('') +
      String(x.systems).padStart(8) + String(x.objects).padStart(8));
  });
  Object.keys(out.budgets).forEach(k => console.log(k.padEnd(7) + JSON.stringify(out.budgets[k])));
  const failed = Object.keys(out.budgets).filter(k => out.budgets[k].ok === false);
  console.log(failed.length ? 'OVER BUDGET: ' + failed.join(', ') : 'every budget met');
  process.exit(failed.length ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
