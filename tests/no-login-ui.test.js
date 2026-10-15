/* G13 "no login anywhere" (the user, 2026-10-15: everything must work without logging in, and the login card is not to be shown at all). A FRESH browser profile - no
   localStorage, no cookie - is driven as a visitor:

     1. no sign-in card, form or button on first load, in Korean first and in English, on a phone and on a PC, and none on a shared link's first load
     2. every screen opens, and the page itself produces no console error and no failed request of the site's own API (the 401 of /api/worker/status that suites used
        to tolerate is gone: a device with no PC link asks the site nothing)
     3. the features the audit lists (docs/GOALS/G13_PRODUCTIZATION.md "No login anywhere") work as a guest: import, practice, progress kept on the device with no
        /api/progress request, backup, post to Shared Scores, "Shared by me", take down, delete
     4. a person who already has an account stays signed in at load, sees their name, and no card is shown to them either

   Drives the real page against this tree's server on a free port, with a data directory of its own (tests/serve-free.js); PPP_URL points it at a server that is already running. */
'use strict';
const puppeteer = require('puppeteer');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { startServer } = require('./serve-free');

let BASE = '';
const SAMPLE = process.env.PPP_SAMPLE || (fs.existsSync(path.resolve(__dirname, '..', 'samples', 'prelude-fragment.musicxml')) ? path.resolve(__dirname, '..', 'samples', 'prelude-fragment.musicxml') : 'D:/PPP/samples/prelude-fragment.musicxml');
const errors = [];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ok = (name, cond, detail) => {
  console.log((cond ? '  ✓ ' : '  ✗ ') + name + (detail ? ' — ' + detail : ''));
  if (!cond) errors.push(name + (detail ? ' — ' + detail : ''));
};
/* the helper of a PC with Audiveris is not on the machine of a test: its refusals are not the page's fault */
const NOISE = /\/helper\/|:8788|ERR_CONNECTION_REFUSED/;

function api(method, p, o) {
  o = o || {};
  const u = new URL(BASE + p);
  return new Promise((resolve, reject) => {
    const body = o.body == null ? null : Buffer.from(JSON.stringify(o.body));
    const headers = {};
    if (body) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = body.length; }
    if (o.guest) headers['X-PPP-Guest'] = o.guest;
    if (o.cookie) headers['Cookie'] = o.cookie;
    headers['X-Forwarded-For'] = o.ip || ('198.51.100.' + (1 + Math.floor(Math.random() * 250)));
    const r = http.request({ host: u.hostname, port: u.port, method: method, path: u.pathname + u.search, headers: headers }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => { let j = null; try { j = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch (e) { /* none */ } resolve({ status: res.statusCode, body: j, headers: res.headers }); });
    });
    r.on('error', reject);
    r.end(body);
  });
}

/* a fresh profile: its own context, watched for console errors and for failed requests of the site's own API */
async function visitor(browser, o) {
  o = o || {};
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  const seen = { errors: [], failed: [], requests: [] };
  if (o.locale) await page.evaluateOnNewDocument(l => { try { localStorage.setItem('ppp-locale', l); } catch (e) { /* none */ } }, o.locale);
  await page.setViewport(o.phone ? { width: 400, height: 860, isMobile: true, hasTouch: true } : { width: 1280, height: 900 });
  page.on('pageerror', e => seen.errors.push('[pageerror] ' + String(e.message).slice(0, 140)));
  page.on('console', m => { if (m.type() === 'error' && !NOISE.test(m.text())) seen.errors.push(m.text().slice(0, 140)); });
  page.on('response', r => { if (r.status() >= 400 && !NOISE.test(r.url()) && /\/api\//.test(r.url())) seen.failed.push(r.status() + ' ' + r.url().replace(/^https?:\/\/[^/]+/, '').slice(0, 80)); });
  page.on('request', r => { if (/\/api\//.test(r.url())) seen.requests.push(r.method() + ' ' + r.url().replace(/^https?:\/\/[^/]+/, '').split('?')[0]); });
  return { ctx, page, seen };
}
const booted = page => page.waitForFunction(() => document.querySelectorAll('aside nav button').length >= 6 && !!window.PPP && !!window.PPP.app, { timeout: 30000 });
const gateShown = page => page.evaluate(() => !!document.querySelector('[data-auth]'));
/* a Sign in button anywhere but the one quiet row of Settings > Account (data-account-action) */
const signInButtons = page => page.evaluate(() => [...document.querySelectorAll('header button, main button')]
  .filter(b => !b.hasAttribute('data-account-action') && /^(sign in|log in|로그인|ログイン|登录)$/i.test((b.innerText || '').trim())).length);

(async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ppp-no-login-'));
  const srv = await startServer({ env: { PPP_DATA_DIR: dataDir } });
  BASE = srv.url.replace(/\/Piano%20Coach%20App\.dc\.html$/, '').replace(/\/+$/, '');
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  try {
    for (const [label, opt] of [['Korean, phone', { locale: 'ko-KR', phone: true }], ['English, PC', { locale: 'en-US' }]]) {
      console.log('\n── a fresh visitor (' + label + '): no card, every screen, no console error ──');
      const v = await visitor(browser, opt);
      await v.page.goto(BASE + '/', { waitUntil: 'networkidle2', timeout: 60000 });
      await booted(v.page);
      await sleep(900);
      ok('no sign-in card or form on the first load', (await gateShown(v.page)) === false);
      ok('no Sign in button on the page', (await signInButtons(v.page)) === 0);
      const text = await v.page.evaluate(() => document.body.innerText);
      ok('and no line that asks for an account (Sign in to PPP, Continue as guest, sync across devices)',
        !/Sign in to PPP|Continue as guest|sync progress across devices|PPP에 로그인|일단 둘러보기|로그인하면/.test(text));
      ok('the sample is "PPP Practice Theme" by PPP, not a film piece', await v.page.evaluate(() => /PPP (Practice Theme|연습곡)/.test(document.body.innerText) && !/Interstellar|Zimmer/.test(document.body.innerText)));
      const screens = ['home', 'upload', 'songs', 'player', 'analysis', 'progress', 'score', 'learn', 'basics', 'course', 'shared', 'settings'];
      const shownBad = [];
      for (const id of screens) {
        await v.page.evaluate(s => window.PPP.app.go(s)(), id);
        await sleep(450);
        if (await gateShown(v.page)) shownBad.push(id + ': card');
        if ((await signInButtons(v.page)) > 0) shownBad.push(id + ': Sign in button');
        const blank = await v.page.evaluate(() => (document.querySelector('main') || document.body).innerText.trim().length < 20);
        if (blank) shownBad.push(id + ': blank');
      }
      ok('every screen opens with no card, no Sign in button and is not blank (' + screens.join(', ') + ')', shownBad.length === 0, shownBad.join('; '));
      /* Shared Scores, "Shared by me" with no key yet: the empty answer, not a sign-in line, and no request */
      await v.page.evaluate(() => window.PPP.app.go('shared')());
      await sleep(500);
      await v.page.evaluate(() => { const b = [...document.querySelectorAll('[data-shared-page] button')].find(x => /Shared by me|내가 공유한/.test(x.innerText)); if (b) b.click(); });
      await sleep(500);
      const mine = await v.page.evaluate(() => document.querySelector('[data-shared-page]').innerText);
      ok('"Shared by me" with nothing shared says so, and does not ask to sign in', !/Sign in|로그인/.test(mine) && /not shared a score yet|아직 공유한 악보가 없어요/.test(mine), mine.replace(/\s+/g, ' ').slice(0, 140));
      await sleep(700);
      ok('the page itself produced no console error', v.seen.errors.length === 0, v.seen.errors.slice(0, 3).join(' | '));
      ok('and no request of the site\'s API failed (no 401 on /api/worker/status, /api/jobs, /api/progress ...)', v.seen.failed.length === 0, v.seen.failed.slice(0, 3).join(' | '));
      const authish = v.seen.requests.filter(r => /\/api\/(auth|progress)/.test(r) && r !== 'GET /api/auth/me');
      ok('the only account call is the quiet "who am I" (auth/me); progress is not sent anywhere', authish.length === 0, authish.join(', '));
      ok('a device with no PC link asks the PC queue nothing', !v.seen.requests.some(r => /\/api\/(jobs|worker|pc-links)/.test(r)), v.seen.requests.filter(r => /\/api\/(jobs|worker|pc-links)/.test(r)).join(', '));
      await v.ctx.close();
    }

    console.log('\n── a shared link\'s first load ──');
    const key = crypto.randomBytes(32).toString('hex');
    const made = await api('POST', '/api/shares', { guest: key, body: { songKey: 'nl-' + Date.now(), title: 'No-login post', listed: true, displayName: 'Min Ji',
      score: { title: 'No-login post', composer: 'Tester', tempo: 90, staves: 1, measures: [{ n: 1, time: { beats: 4, beatType: 4 }, key: { fifths: 0, mode: 'major' } }], notes: [{ m: 1, b: 1, midi: 60, dur: 1, hand: 'r', staff: 1 }] } } });
    ok('a guest posted a score through the API (201, listed)', made.status === 201 && made.body.listed === true, JSON.stringify(made.body).slice(0, 100));
    if (made.status === 201) {
      const v = await visitor(browser, { locale: 'ko-KR', phone: true });
      await v.page.goto(BASE + '/?share=' + made.body.id, { waitUntil: 'networkidle2', timeout: 60000 });
      await booted(v.page);
      await v.page.waitForFunction(() => !!document.querySelector('[data-shared-linked] [data-open-shared]'), { timeout: 15000 }).catch(() => {});
      const card = await v.page.evaluate(() => ((document.querySelector('[data-shared-linked]') || {}).innerText || '').replace(/\s+/g, ' '));
      ok('no card; the score is shown, with the name the guest gave', (await gateShown(v.page)) === false && /No-login post/.test(card) && /Min Ji/.test(card), card.slice(0, 120));
      ok('and no console error, no failed API request', v.seen.errors.length === 0 && v.seen.failed.length === 0, v.seen.errors.concat(v.seen.failed).slice(0, 3).join(' | '));
      await v.ctx.close();
      await api('DELETE', '/api/shares/' + made.body.id, { guest: key });
    }

    console.log('\n── the features, as a guest ──');
    {
      const v = await visitor(browser, { locale: 'en-US' });
      const page = v.page;
      await page.goto(BASE + '/', { waitUntil: 'networkidle2', timeout: 60000 });
      await booted(page);
      /* import a score (a file from this machine: nothing leaves the device) */
      await page.evaluate(() => window.PPP.app.go('upload')());
      await sleep(300);
      const input = await page.$('input[type=file][data-add-file]');
      ok('the Add screen has its file input (no sign-in in front of it)', !!input);
      if (input) await input.uploadFile(SAMPLE);
      await page.waitForFunction(() => /See analysis/.test(document.body.innerText), { timeout: 20000 }).catch(() => errors.push('import did not finish'));
      await page.evaluate(() => window.PPP.app.go('songs')());
      await sleep(400);
      const songId = await page.evaluate(() => { const c = [...document.querySelectorAll('[data-song]')].find(x => x.getAttribute('data-song') !== 'demo'); return c ? c.getAttribute('data-song') : null; });
      ok('import: the score is in My Songs', !!songId, String(songId));
      await page.evaluate(() => window.PPP.app.go('player')());
      await sleep(500);
      ok('practice: the player opens on it', await page.evaluate(() => window.PPP.app.state.screen === 'player' && window.PPP.app.state.score && window.PPP.app.state.score.notes.length > 0));
      const stored = await page.evaluate(() => ({ state: !!localStorage.getItem('ppp.state.v2'), songs: Object.keys(localStorage).filter(k => k.indexOf('ppp.song.v1.') === 0).length }));
      ok('progress is kept on this device (local state and the song slot)', stored.state && stored.songs >= 1, JSON.stringify(stored));
      ok('and none of it was sent to a server: no /api/progress request, no retry', !v.seen.requests.some(r => /\/api\/progress/.test(r)), v.seen.requests.filter(r => /progress/.test(r)).join(','));
      /* the account-free sharing, driven by the page's own methods (the dialog is share.test.js's) */
      const posted = await page.evaluate(id => window.PPP.app.publishSong(id, true).then(r => ({ id: r.id, listed: r.listed, owner: r.owner, mine: r.mine, guest: r.guest })).catch(e => ({ error: e.message })), songId);
      ok('post to Shared Scores as a guest: listed, "Guest", mine', posted.listed === true && posted.owner === 'Guest' && posted.mine === true && posted.guest === true, JSON.stringify(posted));
      await page.evaluate(() => window.PPP.app.go('shared')());
      await page.waitForFunction(id => !!document.querySelector('[data-shared="' + id + '"]'), { timeout: 10000 }, posted.id).catch(() => {});
      const card = await page.evaluate(id => { const c = document.querySelector('[data-shared="' + id + '"]'); return c ? c.innerText.replace(/\s+/g, ' ') : ''; }, posted.id);
      ok('it is in the list, marked as yours, by "a guest"', /Yours · posted/.test(card) && /Shared by a guest/.test(card), card.slice(0, 120));
      const down = await page.evaluate(id => window.PPP.app.shareApi('/' + id, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ listed: false }) }).then(r => r.listed, e => e.message), posted.id);
      ok('take it down from the list: unlisted', down === false, String(down));
      const del = await page.evaluate(id => window.PPP.app.shareApi('/' + id, { method: 'DELETE' }).then(r => r.ok, e => e.message), posted.id);
      ok('delete it: gone', del === true && (await api('GET', '/api/shares/' + posted.id)).status === 404, String(del));
      /* backup: a file made on the device, no server */
      await page.evaluate(() => window.PPP.app.go('settings')());
      await sleep(400);
      const before = v.seen.requests.length;
      ok('Settings has the backup section and the optional sign-in row', await page.evaluate(() => !!document.querySelector('[data-backup-make]') && !!document.querySelector('[data-account-settings]')));
      await page.evaluate(() => document.querySelector('[data-backup-make]').click());
      await sleep(1200);
      ok('making a backup calls no server', v.seen.requests.slice(before).filter(r => !/\/api\/(auth\/me)/.test(r)).length === 0, v.seen.requests.slice(before).join(','));
      ok('the PC link card is offered with no account, and a PC link is made by one tap (a code, no sign-in)', await page.evaluate(async () => {
        const btn = document.querySelector('[data-home-link-make]');
        if (!btn) return false;
        btn.click();
        for (let i = 0; i < 40; i++) { await new Promise(r => setTimeout(r, 150)); if (document.querySelector('[data-home-new]') || localStorage.getItem('ppp.pclink.v1')) return !document.querySelector('[data-auth]'); }
        return false;
      }));
      ok('the page produced no console error and no failed request in all of this', v.seen.errors.length === 0 && v.seen.failed.length === 0, v.seen.errors.concat(v.seen.failed).slice(0, 3).join(' | '));
      await v.ctx.close();
    }

    console.log('\n── a person who already has an account ──');
    {
      const email = 'nologin-' + Date.now() + '@example.com';
      const su = await api('POST', '/api/auth/signup', { body: { email: email, password: 'practice-ok', displayName: 'Existing Person' } });
      const cookie = (su.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');
      ok('an account exists', su.status === 201 && !!cookie, String(su.status));
      const v = await visitor(browser, { locale: 'en-US' });
      const [name, value] = cookie.split('=');
      const u = new URL(BASE);
      await v.page.setCookie({ name: name, value: value.split(';')[0], domain: u.hostname, path: '/' });
      await v.page.goto(BASE + '/', { waitUntil: 'networkidle2', timeout: 60000 });
      await booted(v.page);
      await v.page.waitForFunction(() => /Existing Person/.test(document.querySelector('header').innerText), { timeout: 10000 }).catch(() => {});
      ok('still signed in, shown by name, and no card', (await gateShown(v.page)) === false && await v.page.evaluate(() => /Existing Person/.test(document.querySelector('header').innerText)));
      await v.page.evaluate(() => window.PPP.app.go('settings')());
      await sleep(400);
      const row = await v.page.evaluate(() => ({ t: document.querySelector('[data-account-title]').innerText, a: document.querySelector('[data-account-action]').innerText }));
      ok('Settings says so and offers Sign out', /Signed in as Existing Person/.test(row.t) && row.a === 'Sign out', JSON.stringify(row));
      ok('its progress is the one place the server is told (an account keeps it)', v.seen.requests.some(r => /GET \/api\/progress/.test(r)), v.seen.requests.join(','));
      await v.ctx.close();
    }
  } finally {
    await browser.close();
    await srv.close();
    try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch (e) { /* a temp dir */ }
  }
  console.log('\n────────────────────────────────────────');
  if (errors.length) {
    console.log(errors.length + ' PROBLEM(S):');
    [...new Set(errors)].forEach(e => console.log('  ✗ ' + e));
    process.exit(1);
  }
  console.log('Nothing is behind an account: no card, every screen, every feature as a guest.');
})().catch(e => { console.error('HARNESS FAILURE:', e); process.exit(2); });
