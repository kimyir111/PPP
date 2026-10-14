#!/usr/bin/env node
/* G13-4e: which of the page's code-split globals does the page read, from where, in which phase? A tool, not a test: it is how the call graph in
   docs/GOALS/G13_PRODUCTIZATION.md ("G13-4e: code splitting - analysis") was made, and how a new consumer of a deferred module is found.

     node tests/load-app/split-reads.js <base url> [--locale ko-KR] [--viewport 412x823]

   Before any script of the page runs it puts an accessor on every name of NAMES; each read is recorded once per (phase, name, caller) with the top of its stack. The page
   is then booted (guest), left alone, and every screen of the sidebar is opened in turn. Run it on a page where the scripts are in the head (?split=off, or a tree from
   before G13-4e): with the split on, lazy-load.js defines its own accessors over these. Needs puppeteer (NODE_PATH or D:/PPP/node_modules). Prints, per phase, the reads. */
'use strict';
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const base = args.find((a, i) => !a.startsWith('--') && !['--locale', '--viewport'].includes(args[i - 1]));
const LOCALE = opt('--locale', 'ko-KR');
const [VW, VH] = String(opt('--viewport', '412x823')).split('x').map(Number);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const NAMES = ['PPPScoreGraph', 'PPPScoreGraphModules', 'PPPAudioScore', 'PPPSongGraph', 'PPPSongGraphModules', 'PPPRealize', 'PPPRealizeModules', 'PPPArrangement', 'PPPArrangementModules',
  'PPPPlayability', 'PPPPlayabilityModules', 'PPPDifficulty', 'PPPDifficultyModules', 'PPPEngrave', 'PPPEngraveModules', 'PPPEngravePage', 'PPPBackup', 'PPP_LESSONS', 'PPP_COURSE', 'PPPScoreSearch', 'PPP_I18N'];
const SCREENS = [['practice', /^(Practice|연습)$/], ['songs', /^(My Songs|내 곡)$/], ['progress', /^(Progress|실력)$/], ['sight', /^(Sight-reading|보고 치기)$/], ['course', /^(Method Books|교재 진도)$/], ['shared', /^(Shared Scores|악보 공유)$/],
  ['learn', /^(Piano Basics|피아노 기초)$/], ['settings', /^(Settings|설정)$/]];
function loadPuppeteer() {
  for (const spec of ['puppeteer', process.env.PPP_PUPPETEER, 'D:/PPP/node_modules/puppeteer']) { if (!spec) continue; try { return require(spec); } catch (e) { /* next */ } }
  throw new Error('puppeteer is not installed');
}
(async () => {
  if (!base) { console.error('usage: split-reads.js <base url>'); process.exit(2); }
  const browser = await loadPuppeteer().launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await (await browser.createBrowserContext()).newPage();
  await page.setViewport({ width: VW, height: VH, deviceScaleFactor: 2, isMobile: VW < 700, hasTouch: VW < 700 });
  page.on('pageerror', e => console.log('PAGEERROR', String(e.message).slice(0, 200)));
  await page.evaluateOnNewDocument((names, locale) => {
    try { localStorage.setItem('ppp-guest', '1'); localStorage.setItem('ppp-locale', locale); } catch (e) { /* no storage */ }
    window.__reads = []; window.__phase = 'boot';
    const seen = new Set();
    const rec = (name) => {
      const st = (new Error().stack || '').split('\n').slice(3, 7).map(s => s.trim().replace(/^at /, '').replace(/https?:\/\/[^/]+/, '').replace(/\?[^:)]*/g, '')).join(' < ');
      const id = window.__phase + '|' + name + '|' + st.split(' < ')[0];
      if (seen.has(id)) return;
      seen.add(id);
      window.__reads.push({ t: Math.round(performance.now()), name: name, stack: st });
    };
    for (const n of names) {
      let v;
      Object.defineProperty(window, n, { configurable: true, enumerable: true, get() { if (v !== undefined) rec(n); return v; }, set(x) { v = x; } });
    }
  }, NAMES, LOCALE);
  await page.goto(base + (base.includes('.html') ? '' : '/Piano%20Coach%20App.dc.html') + (base.includes('?') ? '' : '?split=off'), { waitUntil: 'load', timeout: 120000 });
  await page.waitForFunction(() => document.querySelectorAll('aside nav button, nav button').length >= 4, { timeout: 60000 });
  await sleep(2500);
  const dump = async label => {
    const r = await page.evaluate(() => window.__reads.splice(0));
    console.log('=== ' + label + ' (' + r.length + ' reads)');
    for (const e of r) console.log('  ' + String(e.t).padStart(6) + '  ' + e.name.padEnd(22) + e.stack.replace(/\(eval at [^)]*\), /g, '').slice(0, 300));
  };
  await dump('boot, until Home has settled');
  for (const [name, re] of SCREENS) {
    await page.evaluate(n => { window.__phase = n; }, name);
    const ok = await page.evaluate(src => {
      const rx = new RegExp(src);
      const b = [...document.querySelectorAll('aside nav button, nav button')].find(x => rx.test((x.innerText || '').trim().split('\n')[0].trim()));
      if (b) { b.click(); return true; } return false;
    }, re.source);
    await sleep(3000);
    await dump('screen ' + name + (ok ? '' : ' (no such button)'));
  }
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
