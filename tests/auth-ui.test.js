/* The account is OPTIONAL (G13 "no login anywhere"): a visitor is shown no sign-in card or form at the start; Settings > Account has a quiet "Sign in (optional)" that
   opens the form (sign up, sign in, "Not now"); a person who signs up or in is shown by name, can sign out from Settings or from the header, and a signed-out person
   is back in the same app. Nothing here may be behind the form: tests/no-login-ui.test.js walks every screen as a guest. */
const puppeteer = require('puppeteer');

const URL = process.env.PPP_URL || 'http://127.0.0.1:8777/';
const errors = [];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ok = (name, cond, detail) => {
  console.log((cond ? '  ✓ ' : '  ✗ ') + name + (detail ? ' — ' + detail : ''));
  if (!cond) errors.push(name + (detail ? ' — ' + detail : ''));
};
const gateTitle = page => page.evaluate(() => { const h = document.querySelector('[data-auth] h1'); return h ? h.innerText.trim() : ''; });
const openSettings = async page => {
  await page.evaluate(() => window.PPP.app.go('settings')());
  await page.waitForSelector('[data-account-settings]', { timeout: 10000 });
  await sleep(200);
};
const openGate = async page => {
  await openSettings(page);
  await page.evaluate(() => document.querySelector('[data-account-action]').click());
  await page.waitForSelector('[data-auth] h1', { timeout: 5000 });
  await sleep(150);
};

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.evaluateOnNewDocument(() => {
    try { localStorage.setItem('ppp-locale', 'en-US'); } catch (e) {}
  });
  await page.setViewport({ width: 1280, height: 900 });
  page.on('pageerror', e => errors.push('[pageerror] ' + e.message));
  const authCalls = [];
  page.on('request', r => { if (/\/api\/(auth|progress)/.test(r.url())) authCalls.push(r.method() + ' ' + r.url().replace(/^https?:\/\/[^/]+/, '')); });
  await page.goto(URL, { waitUntil: 'networkidle2', timeout: 45000 });
  await page.waitForFunction(() => document.querySelectorAll('aside nav button').length >= 6, { timeout: 25000 });
  await sleep(800);

  console.log('\n── a visitor: no card, no form, no nag ──');
  const first = await page.evaluate(() => ({
    gate: !!document.querySelector('[data-auth]'),
    signIn: [...document.querySelectorAll('header button')].some(b => /sign in/i.test((b.innerText || '').trim())),
    text: /Sign in to PPP|Continue as guest|sync progress across devices/i.test(document.body.innerText)
  }));
  ok('the app is there at the start, with no sign-in gate', first.gate === false);
  ok('no Sign in button in the header and no line that asks for one', first.signIn === false && first.text === false, JSON.stringify(first));
  ok('the only request about accounts is the quiet "who am I" (auth/me)', authCalls.join(', ') === 'GET /api/auth/me', authCalls.join(', '));

  console.log('\n── Settings > Account: optional ──');
  await openSettings(page);
  const row = await page.evaluate(() => ({
    title: (document.querySelector('[data-account-title]') || {}).innerText,
    sub: (document.querySelector('[data-account-sub]') || {}).innerText,
    action: (document.querySelector('[data-account-action]') || {}).innerText
  }));
  ok('a row says "Sign in (optional)", that everything works without it, and has a Sign in button', row.title === 'Sign in (optional)' && /works without an account/.test(row.sub) && row.action === 'Sign in', JSON.stringify(row));
  await page.evaluate(() => document.querySelector('[data-account-action]').click());
  await sleep(300);
  ok('it opens the sign-in form', /Sign in to PPP/.test(await gateTitle(page)), await gateTitle(page));
  await page.evaluate(() => document.querySelector('[data-auth-close]').click());
  await sleep(200);
  ok('"Not now" closes it, and the app is as it was', await page.evaluate(() => !document.querySelector('[data-auth]') && document.querySelectorAll('aside nav button').length >= 6));

  console.log('\n── sign up ──');
  await openGate(page);
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('[data-auth] button')].find(x => /Need an account/.test(x.innerText || ''));
    if (b) b.click();
  });
  await sleep(300);
  ok('signup mode is reachable', /Create your PPP account/.test(await gateTitle(page)), await gateTitle(page));
  const email = 'ppp-ui-' + Date.now() + '@example.com';
  const fields = await page.$$('[data-auth] input');
  ok('signup has name, email, password, confirm', fields.length >= 4, String(fields.length));
  if (fields.length >= 4) {
    await fields[0].type('Pat Pianist');
    await fields[1].type(email);
    await fields[2].type('practice-ok');
    await fields[3].type('practice-ok');
  }
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('[data-auth] button')].find(x => /Create account/.test(x.innerText || ''));
    if (b) b.click();
  });
  await page.waitForFunction(() => !document.querySelector('[data-auth]'), { timeout: 15000 }).catch(() => {});
  const signed = await page.evaluate(() => ({
    gate: !!document.querySelector('[data-auth]'),
    header: document.querySelector('header') ? document.querySelector('header').innerText : '',
    err: document.querySelector('[data-auth]') ? document.querySelector('[data-auth]').innerText : ''
  }));
  ok('signup closes the form', signed.gate === false, signed.err || signed.header);
  ok('header shows the display name', /Pat Pianist/.test(signed.header), signed.header);
  await openSettings(page);
  const signedRow = await page.evaluate(() => ({ title: document.querySelector('[data-account-title]').innerText, action: document.querySelector('[data-account-action]').innerText }));
  ok('Settings says who is signed in, and offers Sign out', /Signed in as Pat Pianist/.test(signedRow.title) && signedRow.action === 'Sign out', JSON.stringify(signedRow));

  console.log('\n── sign out: the same app, no card ──');
  await page.evaluate(() => document.querySelector('[data-account-action]').click());
  await sleep(600);
  const afterOut = await page.evaluate(() => ({
    gate: !!document.querySelector('[data-auth]'),
    nav: document.querySelectorAll('aside nav button').length,
    header: document.querySelector('header').innerText,
    action: (document.querySelector('[data-account-action]') || {}).innerText
  }));
  ok('after Sign out there is no card or form; the app and Settings are still there', afterOut.gate === false && afterOut.nav >= 6 && afterOut.action === 'Sign in', JSON.stringify(afterOut));
  ok('and the header no longer carries the name', !/Pat Pianist/.test(afterOut.header));

  console.log('\n── sign in again ──');
  await page.evaluate(() => document.querySelector('[data-account-action]').click());
  await page.waitForSelector('[data-auth] h1', { timeout: 5000 });
  await page.evaluate((email) => {
    const inputs = [...document.querySelectorAll('[data-auth] input')];
    const setVal = (el, v) => {
      if (!el) return;
      const proto = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
      proto.set.call(el, v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    };
    setVal(inputs.find(i => i.type === 'email') || inputs[0], email);
    setVal(inputs.find(i => i.type === 'password'), 'practice-ok');
  }, email);
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('[data-auth] button')].find(x => (x.innerText || '').trim() === 'Sign in');
    if (b) b.click();
  });
  await page.waitForFunction(() => !document.querySelector('[data-auth]'), { timeout: 15000 }).catch(() => {});
  const logged = await page.evaluate(() => ({
    gate: !!document.querySelector('[data-auth]'),
    header: document.querySelector('header') ? document.querySelector('header').innerText : ''
  }));
  ok('login with the new account works', logged.gate === false && /Pat Pianist/.test(logged.header), logged.header);
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('header button')].find(x => /Pat Pianist/.test(x.innerText || ''));
    if (b) b.click();
  });
  await sleep(500);
  ok('the header name still signs out, as before, and leaves the app (no card)', await page.evaluate(() => !document.querySelector('[data-auth]') && !/Pat Pianist/.test(document.querySelector('header').innerText)));

  console.log('\n── the form stays open until it is closed ──');
  const stay = await ctx.newPage();
  await stay.evaluateOnNewDocument(() => { try { localStorage.setItem('ppp-locale', 'en-US'); } catch (e) {} });
  stay.on('pageerror', e => errors.push('[pageerror stay] ' + e.message));
  await stay.goto(URL, { waitUntil: 'networkidle2', timeout: 45000 });
  await stay.waitForFunction(() => !!window.PPP && !!window.PPP.app, { timeout: 25000 });
  await openGate(stay);
  await sleep(1500);
  const held = await stay.evaluate(() => ({ gate: !!document.querySelector('[data-auth]'), title: document.querySelector('[data-auth] h1') ? document.querySelector('[data-auth] h1').innerText : '' }));
  ok('Sign in stays open after /api/auth/me returns', held.gate === true && /Sign in to PPP/.test(held.title), JSON.stringify(held));
  await stay.keyboard.press('Escape');
  await sleep(300);
  ok('Escape closes it, as "Not now" does', await stay.evaluate(() => !document.querySelector('[data-auth]')));
  await stay.close();

  await browser.close();
  if (errors.length) {
    console.error('\n' + errors.length + ' failed');
    errors.forEach(e => console.error('  ✗ ' + e));
    process.exit(1);
  }
  console.log('\nauth UI: optional sign-in, sign up, sign out, sign in passed');
})().catch(e => { console.error(e); process.exit(1); });
