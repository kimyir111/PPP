#!/usr/bin/env node
/* G13-0 live i18n walk: the untranslated text a person SEES on a running PPP site, per locale, over the main screens. READ-ONLY: GET requests,
   a throwaway browser profile, and clicks that only navigate (nothing is written to the site; a non-GET request to it fails the run).

     node tests/live/i18n-walk.js <ko-KR|ja-JP|zh-CN>[,...]|all [--site https://ppp-web-2o99.onrender.com] [--known FILE] [--out FILE] [--write-known FILE] [--max N]

   Why it exists: the static checker (tests/i18n/gaps.js) reads the sources, so it cannot see a text built by concatenation ("Left hand at 75%
   tempo"), a text that comes from data (a coach quote), or a tab label drawn by a component. This opens the page in the locale, visits Home,
   every item of the side navigation and the Add Sheet Music screen, and collects every visible text node that looks like English: two or more
   Latin words of 3+ letters, or one Latin word of 4+ letters standing alone (the walker of PPP_I18N.apply skips svg, script, style, textarea,
   input and code, so does this). Strings that start with a proper noun (PPP, MIDI, a composer or a book) are not counted.
   --known FILE  strings that are known to be untranslated today ({"ko-KR": ["text", ...], ...}; default tests/live/i18n-walk-known.json), compared with
                 the digits ignored. The run FAILS (exit 1) on a string that is not in the file: that is "a new gap". G13-2 empties the file.
                 The coach hints ("Left hand at 75% tempo", built in code by concatenation) show in some loads and not in others, in any
                 locale (the demo's practice history is drawn per load): the file lists the ones seen, so run twice before believing a NEW.
   --write-known FILE  write this run's strings in that format (to shrink or start the known file; do not use it to hide a new gap).
   --max N       also fail when more than N strings are found, known or not.
   --out FILE    the JSON report (default: a file in the temp directory; its path is printed). */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const args = process.argv.slice(2);
const VALUE_OPTS = ['--site', '--known', '--out', '--write-known', '--max'];
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : d; };
const positional = args.filter((a, i) => !a.startsWith('--') && !VALUE_OPTS.includes(args[i - 1]));
const SITE = String(opt('--site', 'https://ppp-web-2o99.onrender.com')).replace(/\/+$/, '');
const URL_ = SITE + '/Piano%20Coach%20App.dc.html';
const LOCALES = ['ko-KR', 'ja-JP', 'zh-CN'];
const wanted = (positional.join(',') || 'ko-KR').split(',').map(s => s.trim()).filter(Boolean).flatMap(l => (l === 'all' ? LOCALES : [l]));
const KNOWN_FILE = opt('--known', path.join(__dirname, 'i18n-walk-known.json'));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const siteHost = new URL(SITE).host;

// Strings that begin with one of these need no translation (proper nouns: the product, formats, composers, books).
const PROPER = /^(PPP|MIDI|MusicXML|YouTube|PDF|BPM|Beyer|Czerny|Hanon|Burgm|Clementi|Bach|Mozart|Beethoven|Chopin|Satie|Debussy|Gymnop|Ludwig|Erik|Johann|Wolfgang|Fr\u00e9d\u00e9ric|Muzio|Ferdinand|Friedrich|Carl)/;

const shape = t => t.replace(/[0-9]+/g, '#');                    // numbers do not make a new gap ("accuracy: 56%" is "accuracy: 41%" tomorrow)

function loadPuppeteer() {
  for (const spec of ['puppeteer', process.env.PPP_PUPPETEER, 'D:/PPP/node_modules/puppeteer']) { if (!spec) continue; try { return require(spec); } catch (e) { /* next */ } }
  throw new Error('puppeteer is not installed (npm install puppeteer, or set PPP_PUPPETEER to its folder)');
}

async function walk(browser, locale) {
  const ctx = await browser.createBrowserContext();             // a throwaway profile
  const page = await ctx.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.evaluateOnNewDocument(loc => { try { localStorage.setItem('ppp-locale', loc); localStorage.setItem('ppp-guest', '1'); } catch (e) { /* private mode */ } }, locale);
  const errors = [], nonGet = [];
  page.on('pageerror', e => errors.push(String(e.message).slice(0, 160)));
  page.on('request', r => { if (!['GET', 'HEAD', 'OPTIONS'].includes(r.method()) && !r.url().startsWith('data:')) nonGet.push(r.method() + ' ' + r.url().slice(0, 120)); });
  await page.goto(URL_, { waitUntil: 'networkidle2', timeout: 120000 });
  await page.waitForFunction(() => document.querySelectorAll('aside nav button').length >= 6, { timeout: 60000 });
  await page.evaluate(() => window.PPP_I18N && window.PPP_I18N.ready);
  await sleep(800);
  const lang = await page.evaluate(() => document.documentElement.lang);
  const collect = () => page.evaluate(() => {
    const out = [];
    const skip = 'svg, script, style, textarea, input, code, [data-no-i18n]';
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (w.nextNode()) {
      const n = w.currentNode, p = n.parentElement;
      if (!p || p.closest(skip)) continue;
      const r = p.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      const cs = getComputedStyle(p); if (cs.visibility === 'hidden' || cs.display === 'none') continue;
      const s = String(n.nodeValue || '').replace(/\s+/g, ' ').trim();
      const words = s.match(/[A-Za-z]{3,}/g) || [];
      if (words.length >= 2 || (words.length === 1 && s.length === words[0].length && s.length >= 4)) out.push(s.slice(0, 120));
    }
    return out;
  });
  const navLabels = await page.evaluate(() => [...document.querySelectorAll('aside nav button')].map(b => (b.innerText || '').trim().split('\n')[0]));
  const seen = new Map(), screens = [];
  const add = (screen, arr) => { for (const s of arr) if (!seen.has(s)) seen.set(s, screen); screens.push({ screen, visibleEnglish: arr.length }); };
  add('home', await collect());
  for (let i = 0; i < navLabels.length; i++) {
    await page.evaluate(i2 => { const b = document.querySelectorAll('aside nav button')[i2]; if (b) b.click(); }, i);
    await sleep(1500);
    add(navLabels[i], await collect());
  }
  await page.evaluate(() => { const b = document.querySelector('aside > button'); if (b) b.click(); });   // the Add Sheet Music screen
  await sleep(1500);
  add('add', await collect());
  await ctx.close();
  const strings = [...seen.entries()].map(([text, screen]) => ({ screen, text })).filter(x => !PROPER.test(x.text));
  return { locale, htmlLang: lang, navItems: navLabels.length, screens, distinct: seen.size, likelyUntranslated: strings.length, strings, errors, nonGet };
}

async function main() {
  for (const l of wanted) if (!LOCALES.includes(l)) { console.error(`unknown locale "${l}" (one of ${LOCALES.join(', ')}, all)`); return 2; }
  let known = null;
  try { known = JSON.parse(fs.readFileSync(KNOWN_FILE, 'utf8')); } catch (e) { console.log(`(no known-gaps file at ${KNOWN_FILE}: every string counts as new)`); }
  const puppeteer = loadPuppeteer();
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const results = [];
  try { for (const l of wanted) results.push(await walk(browser, l)); } finally { await browser.close().catch(() => {}); }

  let failed = false;
  const max = opt('--max', null);
  console.log(`i18n walk of ${SITE}`);
  for (const r of results) {
    const knownSet = new Set((known && known[r.locale] || []).map(shape));
    r.new = r.strings.filter(x => !knownSet.has(shape(x.text)));
    r.fixed = [...knownSet].filter(t => !r.strings.some(x => shape(x.text) === t)).length;
    console.log(`\n${r.locale} (html lang ${r.htmlLang}): ${r.screens.length} screens, ${r.likelyUntranslated} untranslated-looking strings, ${r.new.length} new, ${r.fixed} known ones gone`);
    for (const x of r.strings) console.log(`  ${knownSet.has(shape(x.text)) ? 'known' : 'NEW  '} ${x.screen} | ${x.text}`);
    if (r.htmlLang !== r.locale) { console.log(`  FAIL: the page did not switch to ${r.locale}`); failed = true; }
    if (r.new.length) failed = true;
    if (max != null && r.likelyUntranslated > +max) { console.log(`  FAIL: more than --max ${max}`); failed = true; }
    if (r.nonGet.length) { console.log(`  FAIL: non-GET request(s) reached the site: ${r.nonGet.slice(0, 3).join('; ')}`); failed = true; }
    if (r.errors.length) console.log(`  page errors: ${r.errors.slice(0, 3).join(' | ')}`);
  }
  const out = opt('--out', path.join(os.tmpdir(), `ppp-i18n-walk-${new Date().toISOString().replace(/[:.]/g, '-')}.json`));
  fs.writeFileSync(out, JSON.stringify({ tool: 'tests/live/i18n-walk.js', finishedAt: new Date().toISOString(), site: SITE, results }, null, 2));
  console.log(`\nJSON report: ${out}`);
  const wk = opt('--write-known', null);
  if (wk) {
    const merged = Object.assign({}, known || {});
    for (const r of results) merged[r.locale] = [...new Set(r.strings.map(x => x.text))].sort();
    fs.writeFileSync(wk, JSON.stringify(merged, null, 2) + '\n');
    console.log(`known file written: ${wk}`);
  }
  console.log(failed ? '\nFAIL: a new untranslated string (or another failure above)' : '\nPASS: no new untranslated string');
  return failed ? 1 : 0;
}

main().then(code => { process.exitCode = code; }, e => { console.error(e); process.exitCode = 1; });
