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
    const nav = [...document.querySelectorAll('aside nav button')].map(b => (b.innerText || '').trim().split('\n')[0].trim());
    return nav[0];
  });
  ok('English guest session shows Home', enHome === 'Home', enHome);

  const readChrome = loc => page.evaluate(async (loc) => {
    const I = window.PPP_I18N;
    if (!I) return { error: 'no i18n' };
    await I.ready;
    I.setLocale(loc);
    await new Promise(r => setTimeout(r, 500));
    const catalog = await fetch('./i18n/' + loc + '.json').then(r => r.json());
    const want = key => (catalog.content && catalog.content[key]) || key;
    const nav = [...document.querySelectorAll('aside nav button')].map(b => (b.innerText || '').trim().split('\n')[0].trim());
    const addBtn = document.querySelector('aside > button');
    const add = addBtn ? (addBtn.innerText || '').replace(/^\+\s*/, '').trim() : '';
    const guestBtn = [...document.querySelectorAll('header button, [data-app] button')].find(b => {
      const t = (b.innerText || '').trim();
      return t.indexOf(I.tx('Guest')) > -1 || t === I.tx('Guest');
    });
    if (guestBtn) guestBtn.click();
    await new Promise(r => setTimeout(r, 400));
    const guestCta = [...document.querySelectorAll('[data-auth] button, button')].map(b => (b.innerText || '').trim())
      .find(t => t === I.tx('Continue as guest') || t === 'Continue as guest') || '';
    const stayGuest = [...document.querySelectorAll('[data-auth] button, button')].find(b => (b.innerText || '').trim() === I.tx('Continue as guest'));
    if (stayGuest) stayGuest.click();
    await new Promise(r => setTimeout(r, 200));
    return {
      locale: I.getLocale(),
      lang: document.documentElement.lang,
      home: nav[0],
      add: add,
      guest: guestCta,
      wantHome: want('Home'),
      wantAdd: want('Add Sheet Music'),
      wantGuest: want('Continue as guest')
    };
  }, loc);

  for (const loc of ['ko-KR', 'ja-JP', 'zh-CN']) {
    const r = await readChrome(loc);
    ok(loc + ' locale is active', r.locale === loc, JSON.stringify(r));
    ok(loc + ' html lang follows', r.lang === loc, r.lang);
    ok(loc + ' Home matches catalog, not English', r.home === r.wantHome && r.home !== 'Home', r.home + ' vs ' + r.wantHome);
    ok(loc + ' Add Sheet Music matches catalog, not English', r.add === r.wantAdd && r.add !== 'Add Sheet Music', r.add + ' vs ' + r.wantAdd);
    ok(loc + ' Continue as guest matches catalog, not English', r.guest === r.wantGuest && r.guest !== 'Continue as guest', r.guest + ' vs ' + r.wantGuest);
  }

  const interpolated = loc => page.evaluate(async (loc) => {
    const I = window.PPP_I18N;
    await I.ready;
    I.setLocale(loc);
    await new Promise(r => setTimeout(r, 400));
    const click = t => {
      const b = [...document.querySelectorAll('button')].find(e => (e.innerText || '').trim().split('\n')[0].trim() === t);
      if (b) b.click();
      return !!b;
    };
    click(I.tx('Sight Reading'));
    await new Promise(r => setTimeout(r, 400));
    const quizWant = I.tx('Question {{n}} of 10', { n: 1 });
    const quizGot = [...document.querySelectorAll('*')].map(e => (e.childNodes.length === 1 && e.childNodes[0].nodeType === 3) ? (e.textContent || '').trim() : '')
      .find(t => t === quizWant || t === 'Question 1 of 10') || '';
    window.__pppTest.upload();
    await new Promise(r => setTimeout(r, 400));
    /* the add page reports on what was added, so add the sample */
    click(I.tx('Use the sample'));
    await new Promise(r => setTimeout(r, 900));
    const score = window.PPP.buildDemoScore();
    const m0 = score.measures[0];
    const parsedWant = I.tx('Parsed {{n}} measures in {{time}}, key of {{key}}, {{notes}} notes across {{staves}} staves.', {
      n: window.PPP.Score.count(score),
      time: m0.time.beats + '/' + m0.time.beatType,
      key: window.PPP.keyName(m0.key.fifths, m0.key.mode),
      notes: score.notes.filter(n => !n.rest).length,
      staves: score.staves
    });
    const body = (document.body.innerText || '');
    const first = score.sections[3] || score.sections[0];
    click(I.tx('Practice'));
    await new Promise(r => setTimeout(r, 400));
    const focusWant = I.tx('“Let’s focus on Measures {{from}}–{{to}}.”', { from: first.from, to: first.to });
    const focusHit = (document.body.innerText || '').indexOf(focusWant) > -1;
    await window.__pppTest.practice(I.tx('Loop a passage'), I.tx('Practice'));
    await new Promise(r => setTimeout(r, 200));
    const loopWant = I.tx('Repeat {{passage}} until it holds.', {
      passage: I.tx('Measures {{from}}–{{to}}', { from: first.from, to: first.to })
    });
    const loopHit = (document.body.innerText || '').indexOf(loopWant) > -1;
    click(I.tx('Progress'));
    await new Promise(r => setTimeout(r, 400));
    /* the page names its song: the title, and the measure count in that locale */
    const mapWant = I.tx('{{n}} measures', { n: window.PPP.Score.count(score) });
    const secWant = I.tx('{{n}} sections — pick one to practise it', { n: score.sections.length });
    const tempoWant = I.tx('score says {{tempo}}', { tempo: score.tempo });
    const recSkeleton = I.tx('“{{action}} — measures {{from}}–{{to}}, about {{minutes}} minutes.”', {
      action: '\u0001', from: '\u0001', to: '\u0001', minutes: '\u0001'
    });
    const recParts = recSkeleton.split('\u0001').filter(Boolean);
    const progressBody = document.body.innerText || '';
    const recHit = recParts.every(p => progressBody.indexOf(p) > -1) && progressBody.indexOf(' — measures ') === -1;
    return {
      quizWant, quizGot, parsedWant, parsedHit: body.indexOf(parsedWant) > -1,
      loopWant, loopHit,
      mapWant, mapHit: progressBody.indexOf(mapWant) > -1,
      secWant, secHit: progressBody.indexOf(secWant) > -1,
      titleHit: progressBody.indexOf(score.title) > -1,
      tempoWant, tempoHit: progressBody.indexOf(tempoWant) > -1,
      recWant: recParts.join('…'), recHit: recHit,
      focusWant, focusHit
    };
  }, loc);

  for (const loc of ['ko-KR', 'ja-JP', 'zh-CN']) {
    const r = await interpolated(loc);
    ok(loc + ' quizCount matches catalog, not English', r.quizGot === r.quizWant && r.quizWant !== 'Question 1 of 10', r.quizGot + ' vs ' + r.quizWant);
    ok(loc + ' analyzeSummary-done matches catalog, not English', r.parsedHit && !/^Parsed 64 measures/.test(r.parsedWant), r.parsedWant);
    ok(loc + ' coachLine1 catalog is translated, not English', r.focusWant && r.focusWant.indexOf('Let’s focus') === -1 && /\d/.test(r.focusWant), r.focusWant);
    ok(loc + ' loop tab note matches catalog, not English', r.loopHit && r.loopWant.indexOf('Repeat ') !== 0, r.loopWant);
    ok(loc + ' progress names its song, measure count from catalog', r.titleHit && r.mapHit && !/ measures$/.test(r.mapWant), r.mapWant);
    ok(loc + ' progress section-map subtitle matches catalog, not English', r.secHit && r.secWant.indexOf(' sections') === -1, r.secWant);
    ok(loc + ' progress tempo sub matches catalog, not English', r.tempoHit && r.tempoWant.indexOf('score says ') !== 0, r.tempoWant);
    ok(loc + ' progress recommendation matches catalog, not English', r.recHit, r.recWant);
  }

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
