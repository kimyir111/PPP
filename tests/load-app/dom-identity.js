#!/usr/bin/env node
/* G13-4: is the page's DOM the same on two servers? Opens the app on Home, Practice and Settings (guest, English or the locale given), after the app is ready, and compares the
   page's innerHTML whitespace-normalised. Used to show that a load-performance change (fonts, hashed urls, the template re-fetch, the sample timer) draws byte-identical DOM
   against the origin/main archive served on another port.

     node tests/load-app/dom-identity.js <urlA> <urlB> [--locale ko-KR] [--viewport 1440x900] [--twice]

   --twice also compares A with a second visit of A (the noise floor: anything that differs there is time or randomness, not the change).
   Exit code 0 when A and B are identical on every screen. Needs puppeteer (NODE_PATH or D:/PPP/node_modules). */
'use strict';
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const [A, B] = args.filter((a, i) => !a.startsWith('--') && !['--locale', '--viewport'].includes(args[i - 1]));
const LOCALE = opt('--locale', 'en-US');
const [VW, VH] = String(opt('--viewport', '1440x900')).split('x').map(Number);
const sleep = ms => new Promise(r => setTimeout(r, ms));
function loadPuppeteer() {
  for (const spec of ['puppeteer', process.env.PPP_PUPPETEER, 'D:/PPP/node_modules/puppeteer']) { if (!spec) continue; try { return require(spec); } catch (e) { /* next */ } }
  throw new Error('puppeteer is not installed');
}

const SCREENS = [['home', null], ['practice', /^(Practice|연습|練習|练习)$/], ['settings', /^(Settings|설정|設定|设置)$/]];

async function capture(browser, base) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: VW, height: VH });
  await page.evaluateOnNewDocument(l => { try { localStorage.setItem('ppp-guest', '1'); localStorage.setItem('ppp-locale', l); } catch (e) { /* */ } }, LOCALE);
  const errors = [];
  page.on('pageerror', e => errors.push(String(e.message).slice(0, 160)));
  await page.goto(base + '/Piano%20Coach%20App.dc.html', { waitUntil: 'networkidle2', timeout: 90000 });
  await page.waitForFunction(() => document.querySelectorAll('aside nav button').length >= 6, { timeout: 30000 });
  await page.evaluate(() => window.PPP_I18N && window.PPP_I18N.ready);
  await sleep(2500);                                    // the template re-fetch (when the page does it) has long arrived
  const out = {};
  for (const [name, label] of SCREENS) {
    if (label) {
      const ok = await page.evaluate(src => {
        const re = new RegExp(src);
        const b = [...document.querySelectorAll('aside nav button')].find(x => re.test((x.innerText || '').trim().split('\n')[0].trim()));
        if (b) { b.click(); return true; } return false;
      }, label.source);
      if (!ok) throw new Error('no nav button for ' + name);
      await sleep(2500);
    }
    out[name] = await page.evaluate(() => { const r = document.getElementById('dc-root'); return r ? r.innerHTML : document.body.innerHTML; });   /* the rendered app: the page's own inline scripts are not DOM a person sees (and differ when the app's code does) */
  }
  await ctx.close();
  return { out, errors };
}
const norm = s => String(s).replace(/\s+/g, ' ').replace(/> </g, '><').trim();
function firstDiff(a, b) {
  const n = Math.min(a.length, b.length);
  let i = 0; while (i < n && a[i] === b[i]) i++;
  return { at: i, a: a.slice(Math.max(0, i - 80), i + 120), b: b.slice(Math.max(0, i - 80), i + 120) };
}

(async () => {
  if (!A || !B) { console.error('usage: dom-identity.js <urlA> <urlB>'); process.exit(2); }
  const browser = await loadPuppeteer().launch({ headless: 'new', args: ['--no-sandbox'] });
  let bad = 0;
  try {
    const a = await capture(browser, A);
    const b = await capture(browser, B);
    const a2 = args.includes('--twice') ? await capture(browser, A) : null;
    console.log(`page errors: A ${a.errors.length}, B ${b.errors.length}` + (a.errors.length || b.errors.length ? ' ' + JSON.stringify([a.errors, b.errors]) : ''));
    for (const [name] of SCREENS) {
      const x = norm(a.out[name]), y = norm(b.out[name]);
      const same = x === y;
      if (!same) bad++;
      console.log(`${same ? 'identical' : 'DIFFERENT'} ${name.padEnd(9)} A ${x.length} chars, B ${y.length} chars` + (same ? '' : '\n' + JSON.stringify(firstDiff(x, y), null, 1)));
      if (a2) { const z = norm(a2.out[name]); console.log(`   noise floor (A vs A again): ${x === z ? 'identical' : 'differs at ' + firstDiff(x, z).at}`); }
    }
  } finally { await browser.close(); }
  process.exitCode = bad ? 1 : 0;
})().catch(e => { console.error(e); process.exit(1); });
