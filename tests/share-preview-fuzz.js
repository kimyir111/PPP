/* G13 no login (the review of PR 275): fuzz the ENGRAVER's entry with random preview JSON, each case with a time budget, and report every hang.

     node tests/share-preview-fuzz.js [--cases 1000] [--raw 300] [--budget 2000] [--seed 1015]

   Two paths, in the page of this tree's own server:
     raw   what the engraver did with a preview AS SENT (the opening bars finalised and handed to the page's ScoreView, the way a card draws it before this change). Hangs here are
           the classes of input the rebuilding exists for; they are listed so that each one is covered by tests/guest-post.test.js, not left to the fuzz.
     safe  the page's own path now (sharedThumb: thumbSafe, then the same drawing). It must have NO hang: that is the claim of the change, and this exits 1 when it fails.
   A case that does not answer in the budget is stopped with the DevTools protocol (Runtime.terminateExecution), the page is reloaded and the run goes on.
   Not part of the gate (a thousand drawings take minutes): the job no-login-suite may run it by hand. */
'use strict';
const puppeteer = require('puppeteer');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { startServer } = require('./serve-free');

const arg = (n, d) => { const i = process.argv.indexOf(n); return i >= 0 ? Number(process.argv[i + 1]) : d; };
const CASES = arg('--cases', 1000), RAW = arg('--raw', 300), BUDGET = arg('--budget', 2000), SEED = arg('--seed', 1015);
const PREVIEWS = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'guest-previews.json'), 'utf8'));

function prng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
/* a real preview with one to three values replaced by the kind that hangs or bloats a drawing; what was done is kept, to name the class of a hang */
function mutated(rand) {
  const names = Object.keys(PREVIEWS);
  const p = JSON.parse(JSON.stringify(PREVIEWS[names[Math.floor(rand() * names.length)]]));
  const pool = [0, -1, 1, 2, 3, 4, 5, 8, 16, 100, 1e4, 1e6, 1e9, -1e9, 0.5, 1e-9, null, true, false, '', 'abc', '1000000', '‮', 'x'.repeat(2000), {}, [], [1, 2, 3],
    { a: { b: { c: { d: { e: { f: { g: { h: 1 } } } } } } } }, Array.from({ length: 700 }, (_, i) => ({ m: 1, b: i % 4, dur: 1, staff: 1, voice: 1, midi: 60 })), 1e300, -1e300];
  const paths = [];
  const collect = (v, pre, d) => { if (d > 3 || v === null || typeof v !== 'object') return; Object.keys(v).slice(0, 14).forEach(k => { paths.push(pre.concat(k)); collect(v[k], pre.concat(k), d + 1); }); };
  collect(p, [], 0);
  const did = [];
  const n = 1 + Math.floor(rand() * 3);
  for (let i = 0; i < n; i++) {
    const at = paths[Math.floor(rand() * paths.length)];
    let o = p;
    for (let j = 0; j < at.length - 1; j++) { if (o && typeof o === 'object') o = o[at[j]]; }
    const val = pool[Math.floor(rand() * pool.length)];
    if (o && typeof o === 'object') {
      o[at[at.length - 1]] = JSON.parse(JSON.stringify(val));
      did.push(at.filter(k => !/^\d+$/.test(k)).join('.') + ' = ' + (JSON.stringify(val) || '').slice(0, 30));
    }
  }
  return { p: p, did: did };
}

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ppp-fuzz-'));
  const srv = await startServer({ env: { PPP_DATA_DIR: dir } });
  const base = srv.url.replace(/\/Piano%20Coach%20App\.dc\.html$/, '').replace(/\/+$/, '');
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  await page.evaluateOnNewDocument(() => { try { localStorage.setItem('ppp-locale', 'en-US'); } catch (e) { /* none */ } });
  const client = await page.createCDPSession();
  const boot = async () => {
    await page.goto(base + '/', { waitUntil: 'networkidle2', timeout: 60000 });
    await page.waitForFunction(() => !!(window.PPP && window.PPP.app && window.React && window.ReactDOM), { timeout: 30000 });
  };
  await boot();
  const draw = (p, mode, k) => page.evaluate(async (p, mode, k) => {
    const A = window.PPP.app, S = window.PPP.Score;
    let sc = null;
    try {
      if (mode === 'safe') sc = A.sharedThumb('fz' + k + ':' + Date.now(), p, 2);
      else {
        /* as a card did it before: the first two bars finalised, whatever they said */
        const c = JSON.parse(JSON.stringify(p));
        const ms = c.measures.slice(0, 2);
        const keep = {}; ms.forEach(m => { keep[m.number] = true; });
        sc = S.finalize(Object.assign({}, c, { measures: ms, notes: c.notes.filter(n => keep[n.m]), sections: [{ id: 's1', from: ms[0].number, to: ms[ms.length - 1].number }] }));
      }
    } catch (e) { return { threw: String(e && e.message).slice(0, 80) }; }
    if (!sc) return { none: true };
    const box = document.createElement('div');
    box.style.cssText = 'position:fixed;left:0;top:0;width:600px;height:300px;overflow:hidden;opacity:0';
    document.body.appendChild(box);
    const root = window.ReactDOM.createRoot(box);
    try {
      root.render(A.sv({ score: sc, staves: sc.staves, startM: S.first(sc), count: 2, mW: 150, numbers: false, guidance: false, fluid: true, grand: sc.staves > 1 }));
      await new Promise(r => setTimeout(r, 40));
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      const n = box.querySelectorAll('svg').length;
      return { svgs: n };
    } finally { try { root.unmount(); } catch (e) { /* gone */ } box.remove(); }
  }, p, mode, k);
  const attempt = async (p, mode, k) => {
    const done = draw(p, mode, k).then(r => ({ r }), e => ({ err: String(e && e.message).slice(0, 80) }));
    const first = await Promise.race([done, new Promise(r => setTimeout(() => r({ hang: true }), BUDGET))]);
    if (!first.hang) return first;
    try { await client.send('Runtime.terminateExecution'); } catch (e) { /* done anyway */ }
    await done.catch(() => {});
    try { await boot(); } catch (e) { await page.reload({ waitUntil: 'load' }).catch(() => {}); await boot(); }
    return { hang: true };
  };

  const report = { raw: { n: 0, hang: 0, threw: 0, classes: {}, examples: [] }, safe: { n: 0, hang: 0, threw: 0, examples: [] } };
  const rand = prng(SEED);
  const t0 = Date.now();
  /* the three known reproducers first, on the raw path, so the report says they are real */
  const base0 = JSON.parse(JSON.stringify(PREVIEWS['prelude-fragment']));
  const known = [['staves 1e6', p => { p.staves = 1e6; }], ['a note on staff 1e6', p => { p.notes[0].staff = 1e6; }], ['staves "1000000"', p => { p.staves = '1000000'; }],
    ['voice 1e9', p => { p.notes[0].voice = 1e9; }], ['dots 1e6', p => { p.notes[0].dots = 1e6; }], ['time.beats 1e7', p => { p.measures[0].time.beats = 1e7; }],
    ['time.beatType 1e6', p => { p.measures[0].time.beatType = 1e6; }], ['lenQ 1e9', p => { p.measures[0].lenQ = 1e9; }], ['dur 1e9', p => { p.notes[0].dur = 1e9; }],
    ['b 1e9', p => { p.notes[0].b = 1e9; }], ['measure number 1e9', p => { p.measures[0].number = 1e9; }], ['midi 1e9', p => { p.notes[0].midi = 1e9; }],
    ['key.fifths 1e6', p => { p.measures[0].key.fifths = 1e6; }], ['tempo 1e9', p => { p.tempo = 1e9; }], ['tm 1e6:1', p => { p.notes[0].tm = { a: 1e6, n: 1 }; }],
    ['5000 notes', p => { p.notes = Array.from({ length: 5000 }, (_, i) => Object.assign({}, p.notes[0], { b: i % 4 })); }],
    ['9 bars', p => { p.measures = Array.from({ length: 9 }, (_, i) => Object.assign({}, p.measures[0], { number: i + 1 })); }]];
  for (const [name, f] of known) {
    const p = JSON.parse(JSON.stringify(base0)); f(p);
    const a = await attempt(p, 'raw', 'k');
    const b = await attempt(p, 'safe', 'k');
    console.log('known  ' + name.padEnd(24) + 'raw: ' + (a.hang ? 'HANG' : a.r && a.r.threw ? 'threw' : 'drew') + '   safe: ' + (b.hang ? 'HANG' : 'drew'));
    if (b.hang) { report.safe.hang++; report.safe.examples.push(name); }
  }
  for (let i = 0; i < RAW; i++) {
    const { p, did } = mutated(rand);
    const a = await attempt(p, 'raw', i);
    report.raw.n++;
    if (a.hang) { report.raw.hang++; did.forEach(d => { const k = d.split(' = ')[0]; report.raw.classes[k] = (report.raw.classes[k] || 0) + 1; }); if (report.raw.examples.length < 12) report.raw.examples.push(did.join(' ; ')); }
    else if (a.r && a.r.threw) report.raw.threw++;
  }
  const rand2 = prng(SEED + 1);
  for (let i = 0; i < CASES; i++) {
    const { p, did } = mutated(rand2);
    const b = await attempt(p, 'safe', i);
    report.safe.n++;
    if (b.hang) { report.safe.hang++; if (report.safe.examples.length < 12) report.safe.examples.push(did.join(' ; ')); }
    else if (b.r && b.r.threw) report.safe.threw++;
    if ((i + 1) % 200 === 0) console.log('  safe ' + (i + 1) + '/' + CASES + ' hangs ' + report.safe.hang + ' (' + Math.round((Date.now() - t0) / 1000) + ' s)');
  }
  await browser.close().catch(() => {});
  await srv.close();
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* temp */ }
  console.log('\nraw  (preview AS SENT, ' + report.raw.n + ' cases, ' + BUDGET + ' ms each): ' + report.raw.hang + ' hang, ' + report.raw.threw + ' threw');
  console.log('     the mutated fields of the hangs: ' + JSON.stringify(Object.entries(report.raw.classes).sort((a, b) => b[1] - a[1]).slice(0, 15)));
  report.raw.examples.slice(0, 6).forEach(e => console.log('       e.g. ' + e));
  console.log('safe (the page\'s path now, ' + report.safe.n + ' cases): ' + report.safe.hang + ' hang, ' + report.safe.threw + ' threw');
  report.safe.examples.forEach(e => console.log('       HANG ' + e));
  process.exit(report.safe.hang ? 1 : 0);
})().catch(e => { console.error('HARNESS FAILURE:', e); process.exit(2); });
