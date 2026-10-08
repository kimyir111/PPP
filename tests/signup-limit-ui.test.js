/* G13-5: what a PERSON sees when the signup limiter refuses them, and the empty Shared Scores search (browser; needs puppeteer; its own server on a free port).

   - A refusal that carries code 'too-many' (the address cap, the request limit, the site cap) is shown at once, in the person's language, and the page does NOT ask again:
     exactly one POST. (It used to treat every 429 as a busy edge and try again for 75 seconds - "creating account..." - and then say "Could not reach the server".)
   - Any other 429 is still a busy edge: it is tried again, and the account is made.
   - A search that finds nothing says so, not "Nothing has been shared yet".
   The Korean is read from i18n/ko-KR.json, so the test follows a change of wording and fails if a string has no Korean at all. */
'use strict';
const puppeteer = require('puppeteer');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { startServer } = require('./serve-free');
const { preparePage } = require('./boot');
const { addrKey } = require('../home-jobs.js');

const REPO = path.resolve(__dirname, '..');
const SECRET = 'signup-ui-test-secret';
const KO = JSON.parse(fs.readFileSync(path.join(REPO, 'i18n', 'ko-KR.json'), 'utf8')).content;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const errors = [];
const ok = (name, cond, detail) => {
  console.log((cond ? '  ✓ ' : '  ✗ ') + name + (detail ? ' — ' + detail : ''));
  if (!cond) errors.push(name + (detail ? ' — ' + detail : ''));
};
const tagOf = ip => {
  const key = crypto.createHmac('sha256', SECRET).update('ppp-signup-address').digest();
  return crypto.createHmac('sha256', key).update(addrKey(ip)).digest('hex').slice(0, 16);
};
const user = (i, ip, ageMs) => ({ id: 'seed-' + i, email: 'seed' + i + '@example.com', displayName: 'S', passwordHash: 'x', ipTag: tagOf(ip), createdAt: new Date(Date.now() - ageMs).toISOString() });

const MSG_ADDRESS = 'Too many accounts were made from here just now. Try again later.';
const MSG_ATTEMPTS = 'Too many attempts. Try again later.';
const MSG_SITE = 'PPP is making a lot of accounts just now. Try again in a little while.';

(async () => {
  [MSG_ADDRESS, MSG_ATTEMPTS, MSG_SITE].forEach(m => ok('Korean has: ' + m.slice(0, 40), typeof KO[m] === 'string' && /[가-힣]/.test(KO[m])));
  const ja = JSON.parse(fs.readFileSync(path.join(REPO, 'i18n', 'ja-JP.json'), 'utf8')).content, zh = JSON.parse(fs.readFileSync(path.join(REPO, 'i18n', 'zh-CN.json'), 'utf8')).content;
  [MSG_ADDRESS, MSG_ATTEMPTS, MSG_SITE].forEach(m => ok('Japanese and Chinese have: ' + m.slice(0, 40), !!ja[m] && !!zh[m]));

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ppp-signup-ui-'));
  /* 10 accounts from 198.51.100.1 in the last hour (its cap), 89 from other addresses: 99 for the site */
  const users = [];
  for (let i = 0; i < 10; i++) users.push(user(i, '198.51.100.1', 5 * 60e3));
  for (let i = 0; i < 89; i++) users.push(user(100 + i, '10.' + i + '.0.1', 10 * 60e3));
  fs.writeFileSync(path.join(dir, 'store.json'), JSON.stringify({ users: users, progress: {} }));
  const srv = await startServer({ env: { PPP_DATA_DIR: dir, SESSION_SECRET: SECRET } });
  if (srv.external) { console.log('  – PPP_URL names another server: this test seeds its own data and needs its own. Skipping.'); process.exit(0); }
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  try {
    /* a person at the sign-up form, from an address (X-Forwarded-For), in a language; opts.intercept(request) may answer a request itself */
    async function signUpAs(ip, locale, o) {
      o = o || {};
      const ctx = await browser.createBrowserContext();
      const page = await ctx.newPage();
      await page.setExtraHTTPHeaders({ 'x-forwarded-for': ip });
      await page.evaluateOnNewDocument(loc => { try { localStorage.removeItem('ppp-guest'); localStorage.setItem('ppp-locale', loc); } catch (e) { /* none */ } }, locale);
      await page.setViewport({ width: 420, height: 900 });
      const posts = [], statuses = [];
      const route = o.login ? /\/api\/auth\/login$/ : /\/api\/auth\/signup$/;
      page.on('request', r => { if (r.method() === 'POST' && route.test(r.url())) posts.push(Date.now()); });
      page.on('response', r => { if (route.test(r.url())) statuses.push(r.status()); });
      if (o.intercept) { await page.setRequestInterception(true); page.on('request', r => { if (!o.intercept(r)) r.continue(); }); }
      if (o.before) await o.before(page);
      await page.goto(srv.url, { waitUntil: 'networkidle2', timeout: 60000 });
      await page.waitForSelector('[data-auth] form', { timeout: 20000 });
      const email = 'ui-' + Date.now() + '-' + Math.floor(Math.random() * 1e6) + '@example.com';
      if (o.login) {
        await page.type('[data-auth] input[name=email]', email);
        await page.type('[data-auth] input[name=password]', 'practice-ok');
      } else {
        await page.evaluate(() => { const b = document.querySelectorAll('[data-auth] button[type=button]')[0]; if (b) b.click(); }); /* "Need an account?" */
        await page.waitForSelector('[data-auth] input[name=confirmPassword]', { timeout: 10000 });
        await page.type('[data-auth] input[name=displayName]', 'Pat');
        await page.type('[data-auth] input[name=email]', email);
        await page.type('[data-auth] input[name=password]', 'practice-ok');
        await page.type('[data-auth] input[name=confirmPassword]', 'practice-ok');
      }
      posts.length = 0; statuses.length = 0; /* what the FORM sends is counted, not what a case did first */
      await page.click('[data-auth] button[type=submit]');
      const gate = () => page.evaluate(() => { const g = document.querySelector('[data-auth]'); return g ? g.innerText.replace(/\s+/g, ' ') : null; });
      return { page, ctx, posts, statuses, gate, email };
    }
    const waitFor = async (fn, ms) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) return null; await sleep(150); } };

    console.log('\n── the address cap: Korean, one request, a final message ──');
    {
      const s = await signUpAs('198.51.100.1', 'ko-KR');
      const shown = await waitFor(async () => { const t = await s.gate(); return t && t.includes(KO[MSG_ADDRESS]) ? t : null; }, 6000);
      ok('the Korean message is on the sign-up form within 6 seconds', !!shown, shown ? '' : String(await s.gate()).slice(0, 200));
      await sleep(8000); /* longer than the 3 seconds the page used to wait before asking again */
      ok('exactly one POST, and it was answered 429', s.posts.length === 1 && s.statuses.join() === '429', s.posts.length + ' POSTs, statuses ' + s.statuses.join());
      const t = await s.gate();
      ok('still the same message after 8 more seconds - no "could not reach the server", no "creating account"', t && t.includes(KO[MSG_ADDRESS]) && !t.includes(KO['Could not reach the server.']), String(t).slice(0, 160));
      const busy = await s.page.evaluate(() => window.PPP.app.state.authBusy);
      ok('the form is free again (not busy)', busy === false);
      ok('nobody is signed in', await s.page.evaluate(() => !window.PPP.app.state.user));
      await s.ctx.close();
    }

    console.log('\n── the request limit ("Too many attempts"): one request, a final message ──');
    {
      const s = await signUpAs('198.51.100.2', 'ko-KR', {
        before: async page => {
          /* 20 requests from this address first (the cap of requests), straight to the server */
          await page.goto(srv.url, { waitUntil: 'domcontentloaded' });
          await page.evaluate(async () => { for (let i = 0; i < 20; i++) await fetch('/api/auth/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'nope' }) }); });
        }
      });
      const shown = await waitFor(async () => { const t = await s.gate(); return t && t.includes(KO[MSG_ATTEMPTS]) ? t : null; }, 6000);
      ok('the Korean "too many attempts" is shown', !!shown, shown ? '' : String(await s.gate()).slice(0, 200));
      await sleep(5000);
      ok('exactly one POST from the form', s.posts.length === 1, s.posts.length + '');
      await s.ctx.close();
    }

    console.log('\n── a limited LOGIN: one request, a final message in Korean ──');
    {
      const s = await signUpAs('198.51.100.9', 'ko-KR', {
        login: true,
        before: async page => {
          /* 40 wrong-password logins from this address first (the cap), straight to the server */
          await page.goto(srv.url, { waitUntil: 'domcontentloaded' });
          const codes = await page.evaluate(async () => { const out = []; for (let i = 0; i < 40; i++) out.push((await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'nobody@example.com', password: 'wrong-password' }) })).status); return out; });
          ok('40 logins from the address are answered (401 each) before the cap', codes.every(c => c === 401), codes.filter(c => c !== 401).join());
        }
      });
      const shown = await waitFor(async () => { const t = await s.gate(); return t && t.includes(KO[MSG_ATTEMPTS]) ? t : null; }, 6000);
      ok('the Korean "too many attempts" is shown on the login form', !!shown, shown ? '' : String(await s.gate()).slice(0, 200));
      await sleep(8000); /* longer than the 3 seconds the page used to wait before asking again */
      ok('exactly one POST to the login route, answered 429', s.posts.length === 1 && s.statuses.join() === '429', s.posts.length + ' POSTs, statuses ' + s.statuses.join());
      const t = await s.gate();
      ok('still that message: no "could not reach the server"', t && t.includes(KO[MSG_ATTEMPTS]) && !t.includes(KO['Could not reach the server.']), String(t).slice(0, 120));
      ok('the form is free again, nobody is signed in', await s.page.evaluate(() => window.PPP.app.state.authBusy === false && !window.PPP.app.state.user));
      await s.ctx.close();
    }

    console.log('\n── a 429 that is not the limiter\'s is still a busy edge: tried again, and the account is made ──');
    {
      let answered = 0;
      const s = await signUpAs('203.0.113.77', 'en-US', {
        intercept: r => {
          if (r.method() === 'POST' && /\/api\/auth\/signup$/.test(r.url()) && answered++ === 0) {
            r.respond({ status: 429, contentType: 'application/json', body: JSON.stringify({ error: 'Too many attempts. Try again later.' }) }); /* no code: not the signup limiter's */
            return true;
          }
          return false;
        }
      });
      const signedIn = await waitFor(() => s.page.evaluate(() => !!(window.PPP.app.state.user)), 12000);
      ok('the page asked again (2 POSTs) and the account was made', !!signedIn && s.posts.length === 2, s.posts.length + ' POSTs, signed in: ' + !!signedIn);
      ok('the second answer was the server\'s 201', s.statuses[s.statuses.length - 1] === 201, s.statuses.join());
      await s.ctx.close();
    }

    console.log('\n── the site cap (that was the 100th account of the hour): one request, a final message ──');
    {
      const s = await signUpAs('192.0.2.4', 'ko-KR');
      const shown = await waitFor(async () => { const t = await s.gate(); return t && t.includes(KO[MSG_SITE]) ? t : null; }, 6000);
      ok('the Korean "PPP is making a lot of accounts" is shown', !!shown, shown ? '' : String(await s.gate()).slice(0, 200));
      await sleep(5000);
      ok('exactly one POST', s.posts.length === 1, s.posts.length + '');
      await s.ctx.close();
    }

    console.log('\n── Shared Scores: a search with no result ──');
    {
      const ctx = await browser.createBrowserContext();
      const page = await ctx.newPage();
      await preparePage(page);
      await page.setViewport({ width: 1100, height: 800 });
      await page.goto(srv.url, { waitUntil: 'networkidle2', timeout: 60000 });
      await page.waitForFunction(() => window.PPP && window.PPP.app && document.querySelectorAll('aside nav button').length >= 6, { timeout: 30000 });
      await page.evaluate(() => window.PPP.app.go('shared')());
      await page.waitForSelector('[data-shared]', { timeout: 20000 });
      const first = await page.evaluate(() => document.querySelectorAll('[data-shared]').length);
      ok('the seeded library is listed', first >= 7, first + ' cards');
      await page.type('[data-shared-search]', 'qqqzzzxxx');
      /* the list on screen is filtered at once; the server's answer (an empty list) comes after the typing stops, and replaces it: read the note after that */
      await waitFor(() => page.evaluate(() => document.querySelectorAll('[data-shared]').length === 0), 6000);
      await sleep(1500);
      const note = await waitFor(() => page.evaluate(() => { const n = document.querySelector('[data-shared-note]'); return n ? n.innerText.trim() : null; }), 6000);
      ok('it says nothing matches, with the words searched', !!note && /No shared score matches/.test(note) && note.includes('qqqzzzxxx'), String(note));
      ok('it does not say that nothing has been shared yet', !!note && !/Nothing has been shared yet/.test(note), String(note));
      await page.evaluate(() => { const i = document.querySelector('[data-shared-search]'); i.value = ''; });
      await ctx.close();
    }
  } catch (e) {
    errors.push('crashed: ' + (e && e.stack || e));
    console.log('  ✗ crashed: ' + (e && e.stack || e));
  } finally {
    await browser.close();
    await srv.close();
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* stays */ }
  }
  console.log('\n' + (errors.length ? 'FAILED: ' + errors.length : 'signup limiter and Shared Scores search passed'));
  process.exit(errors.length ? 1 : 0);
})();
