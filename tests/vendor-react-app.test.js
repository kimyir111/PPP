/* G13-1 (docs/GOALS/G13_PRODUCTIZATION.md section 6 row 2, section 10 gate 1): the page runs on the React that PPP serves itself.

     node tests/vendor-react-app.test.js          (a free port of its own: tests/serve-free.js; PPP_URL points it at another build)

   1. offline-3p - every request to a host other than the site is refused: Home renders, the built-in demo opens and plays, 0 page errors, and the page
      never even asks unpkg.com (before G13-1 the page stayed blank).
   2. the way back - ?cdn=1, a stored ppp.cdn = '1' and PPP.cdn = 1: the pinned unpkg copies are loaded (with their SRI) and the vendored ones dropped;
      ?cdn=0 is vendored again for a visit; a value that is no choice is the default. Here unpkg is answered from the vendored bytes (which
      tests/engrave/vendor-react.test.js proves equal to what unpkg serves), so the suite needs no network.
   3. the DOM of Home, Practice (the demo) and Settings is the same with and without ?cdn=1.
   PPP_REAL_UNPKG=1 lets 2 and 3 use the real unpkg.com instead of the vendored bytes (needs the network). */
'use strict';
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const { preparePage } = require('./boot');
const { startServer } = require('./serve-free');

const REPO = path.resolve(__dirname, '..');
const support = fs.readFileSync(path.join(REPO, 'support.js'), 'utf8');
const pin = n => { const m = new RegExp('var ' + n + ' = "([^"]+)";').exec(support); if (!m) throw new Error('support.js has no ' + n); return m[1]; };
const UNPKG = { [pin('REACT_URL')]: 'vendor/react-18.3.1/react.production.min.js', [pin('REACT_DOM_URL')]: 'vendor/react-18.3.1/react-dom.production.min.js' };
const SRI = { [pin('REACT_URL')]: pin('REACT_SRI'), [pin('REACT_DOM_URL')]: pin('REACT_DOM_SRI') };

const sleep = ms => new Promise(r => setTimeout(r, ms));
const failures = [];
const ok = (name, cond, detail) => {
  console.log((cond ? '  ✓ ' : '  ✗ ') + name + (detail ? ' — ' + detail : ''));
  if (!cond) failures.push(name + (detail ? ' — ' + detail : ''));
};

/* a page in a fresh context (empty storage), third parties refused; `unpkg: 'serve'` answers the two pinned React URLs from the vendored bytes */
async function open(browser, site, query, o) {
  o = o || {};
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  const st = { asked: [], refused: [], pageErrors: [], failedOwn: [], page: page, ctx: ctx };
  await preparePage(page);
  if (o.stored) await page.evaluateOnNewDocument(v => { try { localStorage.setItem('ppp.cdn', v); } catch (e) {} }, o.stored);
  await page.setViewport({ width: 1440, height: 950 });
  await page.setRequestInterception(true);
  page.on('request', req => {
    const url = req.url();
    st.asked.push(url);
    let host = '';
    try { host = new URL(url).host; } catch (e) { /* data: and blob: */ }
    if (!host || host === new URL(site).host) return req.continue();
    if (o.unpkg === 'serve' && process.env.PPP_REAL_UNPKG && /^https:\/\/unpkg\.com\//.test(url)) return req.continue();   /* PPP_REAL_UNPKG=1: the real unpkg (needs the network) instead of the vendored bytes */
    if (o.unpkg === 'serve' && UNPKG[url]) {
      return req.respond({ status: 200, contentType: 'text/javascript; charset=utf-8', headers: { 'Access-Control-Allow-Origin': '*' }, body: fs.readFileSync(path.join(REPO, UNPKG[url])) });
    }
    st.refused.push(url);
    return req.abort('blockedbyclient');
  });
  page.on('pageerror', e => st.pageErrors.push(String(e && e.message || e).slice(0, 200)));
  page.on('requestfailed', r => {
    const u = r.url();
    let host = ''; try { host = new URL(u).host; } catch (e) { /* */ }
    if (host === new URL(site).host) st.failedOwn.push(u + ' ' + ((r.failure() || {}).errorText));
  });
  await page.goto(site + (query || ''), { waitUntil: 'domcontentloaded', timeout: 45000 });
  st.ready = await page.waitForFunction(() => window.PPP && PPP.app && document.querySelector('aside nav button'), { timeout: 25000 }).then(() => true, () => false);
  return st;
}
const close = async st => { try { await st.ctx.close(); } catch (e) { /* closed */ } };
const unpkgAsked = st => st.asked.filter(u => /^https:\/\/unpkg\.com\//.test(u));
const vendorAsked = st => st.asked.filter(u => /\/vendor\/react-18\.3\.1\//.test(u));

async function clickText(page, text) {
  return page.evaluate(t => {
    const hit = [...document.querySelectorAll('button, a, label')].find(e => (e.innerText || e.textContent || '').trim() === t);
    if (hit) hit.click();
    return !!hit;
  }, text);
}
const nav = (page, label) => page.evaluate(l => window.__pppTest.nav(l), label);
const beat = page => page.evaluate(() => {
  const el = [...document.querySelectorAll('span')].find(e => /^Measure \d+ · beat \d$/.test((e.textContent || '').trim()));
  return el ? el.textContent.trim() : null;
});
const reactInfo = page => page.evaluate(() => ({
  cdn: window.PPP ? PPP.cdn : null, react: window.React && window.React.version, dom: window.ReactDOM && window.ReactDOM.version,
  headScripts: [...document.head.querySelectorAll('script[src]')].map(s => ({ src: s.src, integrity: s.integrity || '', cors: s.crossOrigin || '' }))
    .filter(s => /react/.test(s.src) && !/\/vendor\/react-/.test(s.src))   /* the ones support.js added; the page's own vendored tags are not these */
}));

(async () => {
  const srv = await startServer();
  const site = srv.url;
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  try {
    console.log('\n── 1. offline-3p: every host but the site refused ──');
    {
      const st = await open(browser, site, '');
      ok('the page starts (nav rendered)', st.ready);
      ok('0 page errors', st.pageErrors.length === 0, st.pageErrors.join(' | '));
      ok('0 requests to unpkg.com', unpkgAsked(st).length === 0, unpkgAsked(st).join(', '));
      ok('every request to the site itself succeeded', st.failedOwn.length === 0, st.failedOwn.slice(0, 3).join(' | '));
      const vend = vendorAsked(st);
      ok('React and ReactDOM came from vendor/react-18.3.1/ (2 requests, by hash)', vend.length === 2 && vend.every(u => /\?h=[0-9a-f]{12}$/.test(u)), vend.map(u => u.replace(/^.*vendor\//, '')).join(', '));
      const info = await reactInfo(st.page);
      ok('React 18.3.1 and ReactDOM 18.3.1 are loaded', info.react === '18.3.1' && /^18\.3\.1/.test(info.dom), info.react + ' / ' + info.dom);
      ok('PPP.cdn is false; support.js added no script of its own for React', info.cdn === false && info.headScripts.length === 0, JSON.stringify(info.headScripts));
      const home = await st.page.evaluate(() => {
        const labels = [...document.querySelectorAll('aside nav button')].map(b => (b.innerText || '').trim().split('\n')[0].trim());
        return { labels, text: (document.querySelector('main') || document.body).innerText.length };
      });
      ok('Home renders (a sidebar, a page with text)', home.labels.length >= 3 && home.text > 100, home.labels.join(', ') + ' / ' + home.text + ' chars');
      ok('the demo opens in Practice', await nav(st.page, 'Practice'));
      await sleep(400);
      const b0 = await beat(st.page);
      ok('the demo is the piece on screen (a position is shown)', !!b0, String(b0));
      ok('Play is offered and clicked', await clickText(st.page, 'Play'));
      await sleep(1600);
      const b1 = await beat(st.page);
      ok('the demo plays: the position moves', !!b1 && b1 !== b0, b0 + ' -> ' + b1);
      await clickText(st.page, 'Pause');
      ok('still 0 page errors after playing', st.pageErrors.length === 0, st.pageErrors.join(' | '));
      ok('still 0 requests to unpkg.com', unpkgAsked(st).length === 0);
      await close(st);
    }

    console.log('\n── 2. the way back: PPP.cdn ──');
    {
      const want = Object.keys(UNPKG);
      const check = async (name, query, o, expectCdn) => {
        const st = await open(browser, site, query, Object.assign({ unpkg: 'serve' }, o));
        const info = await reactInfo(st.page);
        const asked = unpkgAsked(st);
        ok(name + ': the page starts, 0 page errors', st.ready && st.pageErrors.length === 0, st.pageErrors.join(' | '));
        ok(name + ': PPP.cdn is ' + expectCdn, info.cdn === expectCdn, String(info.cdn));
        if (expectCdn) {
          ok(name + ': the two pinned unpkg files are asked for, once each, and nothing else of unpkg', asked.length === 2 && want.every(u => asked.filter(a => a === u).length === 1), asked.join(', '));
          ok(name + ': they are added by support.js with their SRI and crossorigin=anonymous',
            info.headScripts.length === 2 && want.every(u => info.headScripts.some(s => s.src === u && s.integrity === SRI[u] && s.cors === 'anonymous')), JSON.stringify(info.headScripts));
          ok(name + ': React 18.3.1 runs', info.react === '18.3.1' && /^18\.3\.1/.test(info.dom), info.react + ' / ' + info.dom);
          ok(name + ': the page works (Practice has a position)', (await nav(st.page, 'Practice')) && (await sleep(400), !!(await beat(st.page))));
        } else {
          ok(name + ': nothing is asked of unpkg', asked.length === 0, asked.join(', '));
          ok(name + ': no React script added by support.js', info.headScripts.length === 0);
        }
        await close(st);
        return info;
      };
      await check('?cdn=1', '?cdn=1', {}, true);
      await check('stored ppp.cdn=1', '', { stored: '1' }, true);
      await check('stored 1 and ?cdn=0', '?cdn=0', { stored: '1' }, false);
      await check('?cdn=2 (no choice)', '?cdn=2', {}, false);
      await check('stored "true" (no choice)', '', { stored: 'true' }, false);

      /* the setter: remembered on this device, and a value that is no choice forgets it; the getter says what THIS load did */
      const st = await open(browser, site, '', {});
      const r = await st.page.evaluate(() => {
        const out = {};
        PPP.cdn = 1; out.afterOne = localStorage.getItem('ppp.cdn'); out.stillThisLoad = PPP.cdn;
        PPP.cdn = '1'; out.afterStringOne = localStorage.getItem('ppp.cdn');
        PPP.cdn = 'no'; out.afterNo = localStorage.getItem('ppp.cdn');
        PPP.cdn = true; out.afterTrue = localStorage.getItem('ppp.cdn');
        PPP.cdn = null; out.afterNull = localStorage.getItem('ppp.cdn');
        return out;
      });
      ok('PPP.cdn = 1 / "1" / true remembers "1" on this device; anything else forgets it', r.afterOne === '1' && r.afterStringOne === '1' && r.afterTrue === '1' && r.afterNo === null && r.afterNull === null, JSON.stringify(r));
      ok('PPP.cdn still says what this load did', r.stillThisLoad === false);
      await close(st);
    }

    console.log('\n── 3. the DOM of Home, Practice and Settings: with and without ?cdn=1 ──');
    {
      const shots = {};
      for (const [tag, query] of [['vendored', ''], ['cdn', '?cdn=1']]) {
        const st = await open(browser, site, query, { unpkg: 'serve' });
        if (!st.ready) ok(tag + ': the page starts', false);
        shots[tag] = {};
        for (const [screen, label] of [['Home', 'Home'], ['Practice', 'Practice'], ['Settings', 'Settings']]) {
          const went = await nav(st.page, label);
          await sleep(900);
          shots[tag][screen] = went ? await st.page.evaluate(() => document.body.innerHTML.replace(/\s+/g, ' ')) : null;
        }
        shots[tag].url = await st.page.evaluate(() => PPP.cdn);
        await close(st);
      }
      ok('the two loads are the two paths (PPP.cdn false, then true)', shots.vendored.url === false && shots.cdn.url === true);
      for (const screen of ['Home', 'Practice', 'Settings']) {
        const a = shots.vendored[screen], b = shots.cdn[screen];
        let detail = a ? a.length + ' chars' : 'screen not reachable';
        if (a && b && a !== b) { let i = 0; while (i < a.length && a[i] === b[i]) i++; detail = 'differs at ' + i + ': ' + JSON.stringify(a.slice(Math.max(0, i - 60), i + 80)) + ' vs ' + JSON.stringify(b.slice(Math.max(0, i - 60), i + 80)); }
        ok(screen + ': the same DOM with and without ?cdn=1', !!a && a === b, detail);
        ok(screen + ': it is a real screen (not an empty shell)', !!a && a.length > 3000, a ? a.length + ' chars' : '');
      }
    }
  } finally {
    await browser.close();
    await srv.close();
  }
  console.log('\n' + (failures.length ? failures.length + ' FAILED:\n  ' + failures.join('\n  ') : 'all passed'));
  process.exit(failures.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
