const puppeteer = require('puppeteer');

const URL = process.env.PPP_URL || 'http://127.0.0.1:8777/';
const errors = [];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ok = (name, cond, detail) => {
  console.log((cond ? '  ✓ ' : '  ✗ ') + name + (detail ? ' — ' + detail : ''));
  if (!cond) errors.push(name + (detail ? ' — ' + detail : ''));
};

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.evaluateOnNewDocument(() => {
    try {
      localStorage.removeItem('ppp-guest');
      localStorage.setItem('ppp-locale', 'en-US');
    } catch (e) {}
  });
  await page.setViewport({ width: 1280, height: 900 });
  page.on('pageerror', e => errors.push('[pageerror] ' + e.message));
  await page.goto(URL, { waitUntil: 'networkidle2', timeout: 45000 });
  await sleep(800);

  const gate = await page.evaluate(() => {
    const h = document.querySelector('[data-auth] h1');
    return h ? h.innerText.trim() : '';
  });
  ok('login gate is shown when not a guest', /Sign in to PPP/.test(gate), gate);

  await page.evaluate(() => {
    const b = [...document.querySelectorAll('[data-auth] button')].find(x => /Need an account/.test(x.innerText || ''));
    if (b) b.click();
  });
  await sleep(300);
  const signupTitle = await page.evaluate(() => {
    const h = document.querySelector('[data-auth] h1');
    return h ? h.innerText.trim() : '';
  });
  ok('signup mode is reachable', /Create your PPP account/.test(signupTitle), signupTitle);

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
  ok('signup closes the gate', signed.gate === false, signed.err || signed.header);
  ok('header shows the display name', /Pat Pianist/.test(signed.header), signed.header);

  await page.evaluate(() => {
    const b = [...document.querySelectorAll('header button')].find(x => /Pat Pianist/.test(x.innerText || ''));
    if (b) b.click();
  });
  await sleep(600);
  const afterOut = await page.evaluate(() => ({
    gate: !!document.querySelector('[data-auth]'),
    title: document.querySelector('[data-auth] h1') ? document.querySelector('[data-auth] h1').innerText : ''
  }));
  ok('sign out returns to the login gate', afterOut.gate === true, afterOut.title);

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

  const guestCtx = await browser.createBrowserContext();
  const guestPage = await guestCtx.newPage();
  await guestPage.evaluateOnNewDocument(() => {
    try {
      localStorage.setItem('ppp-guest', '1');
      localStorage.setItem('ppp-locale', 'en-US');
    } catch (e) {}
  });
  await guestPage.goto(URL, { waitUntil: 'networkidle2', timeout: 45000 });
  await sleep(1200);
  const guestSnap = await guestPage.evaluate(() => ({
    gate: !!document.querySelector('[data-auth]'),
    signIn: [...document.querySelectorAll('header button')].some(b => (b.innerText || '').trim() === 'Sign in')
  }));
  ok('guest session skips the gate but shows Sign in', guestSnap.gate === false && guestSnap.signIn, JSON.stringify(guestSnap));
  await guestPage.evaluate(() => {
    const b = [...document.querySelectorAll('header button')].find(x => (x.innerText || '').trim() === 'Sign in');
    if (b) b.click();
  });
  await sleep(1500);
  const held = await guestPage.evaluate(() => ({
    gate: !!document.querySelector('[data-auth]'),
    title: document.querySelector('[data-auth] h1') ? document.querySelector('[data-auth] h1').innerText : ''
  }));
  ok('Sign in stays open after /api/auth/me returns', held.gate === true && /Sign in to PPP/.test(held.title), JSON.stringify(held));
  await guestPage.close();
  await guestCtx.close();

  await browser.close();
  if (errors.length) {
    console.error('\n' + errors.length + ' failed');
    errors.forEach(e => console.error('  ✗ ' + e));
    process.exit(1);
  }
  console.log('\nauth UI signup and login passed');
})().catch(e => { console.error(e); process.exit(1); });
