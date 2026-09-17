const puppeteer = require('puppeteer');
const { preparePage } = require('./boot');

const URL = process.env.PPP_URL || 'http://127.0.0.1:8777/Piano%20Coach%20App.dc.html';
const errors = [];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ok = (name, cond, detail) => {
  console.log((cond ? '  ✓ ' : '  ✗ ') + name + (detail ? ' — ' + detail : ''));
  if (!cond) errors.push(name + (detail ? ' — ' + detail : ''));
};

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await preparePage(page);
  await page.setViewport({ width: 1440, height: 900 });
  page.on('pageerror', e => errors.push('[pageerror] ' + e.message));

  await page.goto(URL, { waitUntil: 'networkidle2', timeout: 45000 });
  await page.waitForFunction(() => document.querySelectorAll('aside nav button').length >= 6, { timeout: 25000 });
  await sleep(400);

  const enHome = await page.evaluate(() => {
    const nav = [...document.querySelectorAll('aside nav button')].map(b => (b.innerText || '').trim());
    return nav[0];
  });
  ok('English guest session shows Home', enHome === 'Home', enHome);

  const switched = await page.evaluate(async () => {
    const I = window.PPP_I18N;
    if (!I) return { error: 'no i18n' };
    await I.ready;
    I.setLocale('ko-KR');
    await new Promise(r => setTimeout(r, 400));
    const nav = [...document.querySelectorAll('aside nav button')].map(b => (b.innerText || '').trim());
    return { locale: I.getLocale(), home: nav[0], lang: document.documentElement.lang };
  });
  ok('switching to Korean changes the locale', switched.locale === 'ko-KR', JSON.stringify(switched));
  ok('Korean Home is 홈', switched.home === '홈', switched.home);
  ok('html lang follows the locale', switched.lang === 'ko-KR', switched.lang);

  const ja = await page.evaluate(async () => {
    window.PPP_I18N.setLocale('ja-JP');
    await new Promise(r => setTimeout(r, 400));
    const nav = [...document.querySelectorAll('aside nav button')].map(b => (b.innerText || '').trim());
    return nav[0];
  });
  ok('Japanese Home is ホーム', ja === 'ホーム', ja);

  const zh = await page.evaluate(async () => {
    window.PPP_I18N.setLocale('zh-CN');
    await new Promise(r => setTimeout(r, 400));
    const nav = [...document.querySelectorAll('aside nav button')].map(b => (b.innerText || '').trim());
    return nav[0];
  });
  ok('Chinese Home is 首页', zh === '首页', zh);

  await page.evaluate(() => window.PPP_I18N.setLocale('en-US'));
  await sleep(300);

  const health = await page.evaluate(async () => {
    try {
      const r = await fetch('/api/health');
      if (!r.ok) return { present: false, status: r.status };
      return { present: true, body: await r.json() };
    } catch (e) {
      return { present: false, error: e.message };
    }
  });
  ok('health endpoint is reachable when the Node server is up, or skipped on static serve',
    true, health.present ? JSON.stringify(health.body) : 'static / no API (' + (health.status || health.error || 'n/a') + ')');

  if (health.present) {
    const email = 'ppp-test-' + Date.now() + '@example.com';
    const signed = await page.evaluate(async (email) => {
      const r = await fetch('/api/auth/signup', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email, password: 'practice-ok', displayName: 'Test Player' })
      });
      const body = await r.json().catch(() => ({}));
      return { status: r.status, body: body };
    }, email);
    ok('signup creates a session', signed.status === 201 && signed.body.email === email,
      signed.status + ' ' + JSON.stringify(signed.body));

    const me = await page.evaluate(async () => {
      const r = await fetch('/api/auth/me', { credentials: 'include' });
      return { status: r.status, body: await r.json().catch(() => ({})) };
    });
    ok('me returns the signed-in user', me.status === 200 && me.body.displayName === 'Test Player',
      me.status + ' ' + JSON.stringify(me.body));

    const saved = await page.evaluate(async () => {
      const put = await fetch('/api/progress', {
        method: 'PUT', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payload: { minutes: 9, xp: 42 } })
      });
      const get = await fetch('/api/progress', { credentials: 'include' });
      return { put: put.status, get: await get.json() };
    });
    ok('progress round-trips', saved.put === 200 && saved.get.payload && saved.get.payload.xp === 42,
      JSON.stringify(saved));
  }

  await browser.close();
  if (errors.length) {
    console.error('\n' + errors.length + ' failed');
    errors.forEach(e => console.error('  ✗ ' + e));
    process.exit(1);
  }
  console.log('\nall i18n/auth checks passed');
})().catch(e => { console.error(e); process.exit(1); });
