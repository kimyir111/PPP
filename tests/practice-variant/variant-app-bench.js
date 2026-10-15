/* G11c-1: how often "Make this passage easier" makes a real easier passage, refuses, and why - measured THROUGH THE PAGE (the app's own glue: the page's arranger, practice/variant.js, graphToReviewScore),
   not in Node. The question of docs/GOALS/G11 section 10.2 asked again of the finished feature: on the catalogue's pieces, windows of 4 bars (seeded, as the G11c-0 benchmark picks them), what does a
   person see - a preview, or which refusal?

     node tests/practice-variant/variant-app-bench.js [--filter RE] [--windows N] [--len N] [--pages N] [--cpu N] [--out FILE] [--list]
       --filter    only catalogue files whose path matches RE (default: all)         --windows  windows per piece (default 10, as G11c-0)
       --len       bars per window (default 4)                                        --pages    pieces at once, one browser page each (default 4)
       --cpu       CPU throttling rate (default 1)                                    --out      write the records as JSON
   It starts this tree's server on a free port (PPP_PORT_RANGE keeps it in a band) and needs puppeteer (NODE_PATH may point at another tree's node_modules). Not a CI step: a measurement. */
'use strict';
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const { startServer } = require('../serve-free');
const { preparePage } = require('../boot');

const REPO = path.resolve(__dirname, '..', '..');
const sleep = ms => new Promise(r => setTimeout(r, ms));

function args() {
  const a = { filter: null, windows: 10, len: 4, pages: 4, cpu: 1, out: null, list: false };
  const v = process.argv.slice(2);
  for (let i = 0; i < v.length; i++) {
    const k = v[i];
    if (k === '--filter') a.filter = new RegExp(v[++i]);
    else if (k === '--windows') a.windows = +v[++i];
    else if (k === '--len') a.len = +v[++i];
    else if (k === '--pages') a.pages = +v[++i];
    else if (k === '--cpu') a.cpu = +v[++i];
    else if (k === '--out') a.out = path.resolve(v[++i]);
    else if (k === '--list') a.list = true;
    else throw new Error('unknown argument ' + k);
  }
  return a;
}

/* the catalogue's pieces: the same corpus as the G11c-0 benchmark (catalog/*.musicxml, hymns, method books) */
function catalogFiles() {
  const out = [];
  const top = fs.readdirSync(path.join(REPO, 'catalog')).filter(f => /\.(musicxml|mxl)$/.test(f)).sort();
  top.forEach(f => out.push('catalog/' + f));
  const hy = path.join(REPO, 'catalog', 'hymns');
  fs.readdirSync(hy).filter(f => /\.(musicxml|mxl)$/.test(f)).sort().forEach(f => out.push('catalog/hymns/' + f));
  const me = path.join(REPO, 'catalog', 'method');
  fs.readdirSync(me).filter(d => fs.statSync(path.join(me, d)).isDirectory() && d !== 'src').sort().forEach(d => {
    fs.readdirSync(path.join(me, d)).filter(f => /\.(musicxml|mxl)$/.test(f)).sort().forEach(f => out.push('catalog/method/' + d + '/' + f));
  });
  return out;
}

/* a small seeded generator (mulberry32 over an FNV of the file name): the same windows in every run */
function windowsOf(id, bars, len, n) {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  const rnd = () => { h = (h + 0x6D2B79F5) | 0; let t = Math.imul(h ^ (h >>> 15), 1 | h); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const L = Math.min(len, bars), out = [];
  for (let i = 0; i < n; i++) { const from = Math.floor(rnd() * (bars - L + 1)); out.push({ from: from, to: from + L - 1 }); }
  return out;
}

async function main() {
  const o = args();
  let files = catalogFiles();
  if (o.filter) files = files.filter(f => o.filter.test(f));
  if (o.list) { console.log(files.join('\n')); return; }
  const srv = await startServer({ root: REPO });
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const results = [];
  let next = 0;
  const t0 = Date.now();
  async function worker(k) {
    const ctx = await browser.createBrowserContext();
    for (;;) {
      const i = next++;
      if (i >= files.length) break;
      const file = files[i];
      const page = await ctx.newPage();
      await preparePage(page);
      await page.evaluateOnNewDocument(() => { try { localStorage.setItem('ppp.variant.v1', 'on'); } catch (e) { /* none */ } });
      if (o.cpu > 1) { const cdp = await page.target().createCDPSession(); await cdp.send('Emulation.setCPUThrottlingRate', { rate: o.cpu }); }
      await page.setViewport({ width: 1100, height: 900 });
      let rec;
      try {
        await page.goto(srv.url, { waitUntil: 'domcontentloaded', timeout: 90000 });
        await page.waitForFunction(() => window.PPP && window.PPP.app && window.PPP.PianoScore, { timeout: 90000 });
        await sleep(800);
        /* the windows are computed in the page from the bar count (the same generator) */
        await page.exposeFunction('__windowsOf', (id, bars) => windowsOf(id, bars, o.len, o.windows));
        rec = await page.evaluate(async (file) => {
          const A = PPP.app, sl = ms => new Promise(r => setTimeout(r, ms));
          const out = { file: file, bars: 0, notes: 0, windows: [], error: null };
          try {
            const res = await fetch('/' + file);
            const buf = await res.arrayBuffer();
            const sc = /\.mxl$/.test(file) ? PPP.scoreFromXml(await PPP.readMxl(buf), file.split('/').pop()) : PPP.scoreFromXml(new TextDecoder().decode(buf), file.split('/').pop());
            A.adoptScore(sc);
            await sl(1500);
            A.setState({ screen: 'player', loop: true, practiceMode: 'practice' });
            await sl(300);
            const S = A.state.score;
            out.bars = S.measures.length;
            out.notes = S.notes.filter(n => !n.rest).length;
            const wins = await window.__windowsOf(file, out.bars);
            for (const w of wins) {
              A.setLoop(S.measures[w.from].number, S.measures[w.to].number);
              await sl(30);
              A.openVariantPanel();
              await sl(30);
              const t0 = performance.now();
              A.makeVariant();
              let u = null;
              for (let i = 0; i < 4800; i++) { await sl(25); u = A.state.variantUi; if (u && u.phase !== 'busy' && u.phase !== 'choose') break; }
              const total = Math.round(performance.now() - t0);
              const r = { from: w.from, to: w.to, phase: u ? u.phase : 'none', reason: u && u.refusal ? u.refusal.reason : null, total: total, ms: u && u.ms != null ? u.ms : null, stage: u ? u.stage : null };
              if (u && u.phase === 'preview') { r.before = u.stats.before.notes; r.after = u.stats.after.notes; r.widened = u.stats.widened; r.tuneKept = u.stats.tuneKept; }
              if (u && u.phase === 'refused' && u.refusal.why) r.why = String(u.refusal.why).slice(0, 120);
              out.windows.push(r);
              A.closeVariantPanel();
              await sl(20);
            }
          } catch (e) { out.error = String(e && e.message || e); }
          return out;
        }, file);
      } catch (e) { rec = { file: file, windows: [], error: String(e && e.message) }; }
      results.push(rec);
      try { await page.close(); } catch (e) { /* gone */ }
      process.stderr.write('[' + results.length + '/' + files.length + '] ' + file + ' ' + rec.windows.map(w => (w.phase === 'preview' ? 'A' : w.reason === 'VARIANT_IDENTICAL' ? 'I' : w.reason === 'VARIANT_NOT_EASIER' ? 'E' : w.reason === 'NO_VARIANT' ? '-' : '?')).join('') + (rec.error ? ' ERROR ' + rec.error : '') + '\n');
    }
    await ctx.close();
  }
  await Promise.all(Array.from({ length: Math.max(1, o.pages) }, (_, k) => worker(k)));
  await browser.close();
  await srv.close();
  results.sort((a, b) => (a.file < b.file ? -1 : 1));
  if (o.out) fs.writeFileSync(o.out, JSON.stringify({ args: { windows: o.windows, len: o.len, cpu: o.cpu }, seconds: Math.round((Date.now() - t0) / 1000), results: results }, null, 1));
  console.log(table(results));
}

function table(results) {
  const tier = f => (/^catalog\/hymns\//.test(f) ? 'hymn' : /^catalog\/method\//.test(f) ? 'method' : 'piece');
  const cell = () => ({ windows: 0, A: 0, I: 0, E: 0, none: 0, other: 0, err: 0, pieces: 0 });
  const by = { hymn: cell(), method: cell(), piece: cell(), ALL: cell() };
  const ms = [], total = [], reasons = {};
  results.forEach(r => {
    [tier(r.file), 'ALL'].forEach(t => {
      by[t].pieces++;
      if (r.error) by[t].err++;
      r.windows.forEach(w => {
        by[t].windows++;
        if (w.phase === 'preview') by[t].A++;
        else if (w.reason === 'VARIANT_IDENTICAL') by[t].I++;
        else if (w.reason === 'VARIANT_NOT_EASIER') by[t].E++;
        else if (w.reason === 'NO_VARIANT' || w.reason === 'NO_GRAPH') by[t].none++;
        else by[t].other++;
      });
    });
    r.windows.forEach(w => {
      if (w.ms != null) ms.push(w.ms);
      total.push(w.total);
      if (w.phase !== 'preview') { const k = w.reason || w.phase; reasons[k] = (reasons[k] || 0) + 1; }
    });
  });
  const pct = (a, b) => (b ? (100 * a / b).toFixed(1) + '%' : '-');
  const q = (xs, p) => { if (!xs.length) return null; const s = xs.slice().sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
  const lines = ['tier      pieces windows  preview   identical  not-easier  no-variant  other  piece-errors'];
  Object.keys(by).forEach(t => {
    const c = by[t];
    lines.push(t.padEnd(9) + String(c.pieces).padStart(6) + String(c.windows).padStart(8) + (c.A + ' ' + pct(c.A, c.windows)).padStart(14) + (c.I + ' ' + pct(c.I, c.windows)).padStart(12)
      + (c.E + ' ' + pct(c.E, c.windows)).padStart(13) + (c.none + ' ' + pct(c.none, c.windows)).padStart(13) + String(c.other).padStart(7) + String(c.err).padStart(8));
  });
  lines.push('refusals by reason: ' + JSON.stringify(reasons));
  lines.push('splice + score + preview (ms): n ' + ms.length + ', median ' + q(ms, 0.5) + ', p95 ' + q(ms, 0.95) + ', max ' + (ms.length ? Math.max(...ms) : null));
  lines.push('press to answer, arranger included (ms): n ' + total.length + ', median ' + q(total, 0.5) + ', p95 ' + q(total, 0.95) + ', max ' + (total.length ? Math.max(...total) : null));
  return lines.join('\n');
}

if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });
module.exports = { catalogFiles, windowsOf, table };
