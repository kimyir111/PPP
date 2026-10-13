'use strict';
/* G13-4c, the template re-fetch: the page is fetched once, and what is drawn is what it was when the runtime fetched it twice.
   (docs/GOALS/G13_PRODUCTIZATION.md G13-4 (c); the spike itself is tests/load-app/template-refetch.js)

   support.js (generated, not edited) fetches the page a second time and recompiles the template from the raw text unless window.__resources is set. The page now
   sets it to {} (a line in the head). This test loads the page both ways against this tree's own server - as served, and with that line removed (so the runtime
   fetches again, as it did) - and compares what each one has drawn on Home, Practice and Settings: the DOM, and the props React was handed by every element
   (the event handlers, the one thing the two templates spell differently). */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { boot } = require('../load/lib');

function loadPuppeteer() {
  for (const spec of ['puppeteer', process.env.PPP_PUPPETEER, 'D:/PPP/node_modules/puppeteer']) { if (!spec) continue; try { return require(spec); } catch (e) { /* next */ } }
  throw new Error('puppeteer is not installed (npm install puppeteer, or set PPP_PUPPETEER to its folder)');
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const norm = s => String(s).replace(/\s+/g, ' ').replace(/> </g, '><').trim();
const getText = (port, p) => new Promise((resolve, reject) => http.get({ host: '127.0.0.1', port, path: p }, res => {
  const c = []; res.on('data', d => c.push(d)); res.on('end', () => resolve(Buffer.concat(c).toString('utf8')));
}).on('error', reject));

let srv, browser;
test.before(async () => {
  srv = await boot();
  browser = await loadPuppeteer().launch({ headless: 'new', args: ['--no-sandbox'] });
});
test.after(async () => { if (browser) await browser.close(); if (srv) srv.close(); });

const SCREENS = [['home', null], ['practice', '^(Practice|연습|練習|练习)$'], ['settings', '^(Settings|설정|設定|设置)$']];

/* `refetch`: serve the page without the line that turns the second fetch off */
async function visit(refetch) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.evaluateOnNewDocument(() => { try { localStorage.setItem('ppp-guest', '1'); localStorage.setItem('ppp-locale', 'en-US'); } catch (e) { /* */ } });
  const pageRequests = [];
  const errors = [];
  page.on('pageerror', e => errors.push(String(e.message).slice(0, 160)));
  await page.setRequestInterception(true);
  page.on('request', async r => {
    if (/\/Piano(%20| )Coach(%20| )App\.dc\.html(\?|$)/.test(r.url())) {
      pageRequests.push(r.resourceType());
      if (refetch) {
        let text = await getText(srv.port, '/Piano%20Coach%20App.dc.html');
        text = text.replace(/<script>window\.__resources = window\.__resources \|\| \{\};[^\n]*<\/script>\r?\n?/, '');
        return r.respond({ status: 200, contentType: 'text/html; charset=utf-8', body: text }).catch(() => {});
      }
    }
    r.continue().catch(() => {});
  });
  await page.goto('http://127.0.0.1:' + srv.port + '/Piano%20Coach%20App.dc.html', { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => document.querySelectorAll('aside nav button').length >= 6, { timeout: 30000 });
  await page.evaluate(() => window.PPP_I18N && window.PPP_I18N.ready);
  await sleep(3000);
  const out = {};
  for (const [name, re] of SCREENS) {
    if (re) {
      const ok = await page.evaluate(src => {
        const rx = new RegExp(src);
        const b = [...document.querySelectorAll('aside nav button')].find(x => rx.test((x.innerText || '').trim().split('\n')[0].trim()));
        if (b) { b.click(); return true; } return false;
      }, re);
      assert.ok(ok, 'a nav button for ' + name);
      await sleep(1500);
    }
    out[name] = await page.evaluate(() => ({
      dom: document.body.innerHTML,
      props: [...document.body.querySelectorAll('*')].map(e => {
        const k = Object.keys(e).find(x => x.indexOf('__reactProps$') === 0);
        return k ? Object.keys(e[k]).filter(n => n !== 'children' && n !== 'style').sort().join(',') : '';
      })
    }));
  }
  await ctx.close();
  return { out, pageRequests, errors };
}

test('the page is fetched once, and Home, Practice and Settings are drawn exactly as when the runtime fetched it twice', async () => {
  const once = await visit(false);
  const twice = await visit(true);
  assert.deepEqual(once.pageRequests, ['document'], 'one request for the page: the document');
  assert.deepEqual(twice.pageRequests, ['document', 'fetch'], 'without the line the runtime fetches it again');
  assert.deepEqual(once.errors, []);
  assert.deepEqual(twice.errors, []);
  for (const [name] of SCREENS) {
    assert.equal(norm(once.out[name].dom), norm(twice.out[name].dom), name + ': the DOM is the same');
    assert.ok(once.out[name].props.some(p => /onClick/.test(p)), name + ': the elements have their click handlers (the props are really read)');
    assert.deepEqual(once.out[name].props, twice.out[name].props, name + ': React was handed the same props by every element');
  }
});

test('a click still does what it did: a nav button navigates without the second fetch', async () => {
  const v = await visit(false);
  assert.ok(norm(v.out.practice.dom) !== norm(v.out.home.dom), 'Practice is not Home');
  assert.ok(norm(v.out.settings.dom) !== norm(v.out.practice.dom), 'Settings is not Practice');
});
