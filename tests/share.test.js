/* Shared Scores: a song of yours can be posted for anyone to add, or only
   sent as a link; the link opens for someone with no account and no guest
   session; taking it down and stopping sharing do what they say.

   Drives the real UI against the Node server. Never reaches a social
   network: window.open is recorded, not followed. */
const puppeteer = require('puppeteer');
const { preparePage } = require('./boot');

const BASE = 'http://127.0.0.1:8777';
const URL = BASE + '/Piano%20Coach%20App.dc.html';
const SAMPLE = 'D:/PPP/samples/prelude-fragment.musicxml';
const errors = [];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ok = (name, cond, detail) => {
  console.log((cond ? '  ✓ ' : '  ✗ ') + name + (detail ? ' — ' + detail : ''));
  if (!cond) errors.push(name + (detail ? ' — ' + detail : ''));
};
const booted = page => page.waitForFunction(() => document.querySelectorAll('aside nav button').length >= 6, { timeout: 25000 });
const screenTitle = page => page.evaluate(() => (document.querySelector('header div div') || {}).textContent || '');
/* the server's view, asked from the page so the session cookie goes along */
const api = (page, path, opts) => page.evaluate(async (path, opts) => {
  const r = await fetch(path, Object.assign({ credentials: 'include', cache: 'no-store' }, opts || {}));
  return { status: r.status, body: await r.json().catch(() => null) };
}, path, opts);
/* window.open answers with a stand-in that records where it was sent */
const recordOpens = page => page.evaluateOnNewDocument(() => {
  window.__opened = [];
  window.open = function (url) {
    if (url) window.__opened.push(url);
    return { opener: null, close() {}, location: { set href(v) { window.__opened.push(v); } } };
  };
});

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const ctxA = await browser.createBrowserContext();
  const page = await ctxA.newPage();
  await preparePage(page);
  await recordOpens(page);
  await page.setViewport({ width: 1440, height: 950 });
  page.on('pageerror', e => errors.push('[pageerror A] ' + e.message));
  await page.goto(URL, { waitUntil: 'networkidle2', timeout: 45000 });
  await booted(page);

  const health = await api(page, '/api/shares');
  if (health.status !== 200) {
    console.log('  – the Node server has no /api/shares (status ' + health.status + '); restart `npm run serve`. Skipping.');
    await browser.close();
    process.exit(0);
  }

  console.log('\n── the tab ──');
  const tabbed = await page.evaluate(() => window.__pppTest.nav('Shared Scores'));
  await sleep(500);
  ok('Shared Scores is in the sidebar and opens', tabbed && (await screenTitle(page)) === 'Shared Scores', await screenTitle(page));
  ok('with a search box and All / Shared by me', await page.evaluate(() =>
    !!document.querySelector('[data-shared-search]') && /Shared by me/.test(document.querySelector('[data-shared-page]').innerText)));

  console.log('\n── a song of yours ──');
  await page.evaluate(() => window.__pppTest.upload());
  await sleep(300);
  await (await page.$('input[type=file][data-add-file]')).uploadFile(SAMPLE);
  await page.waitForFunction(() => /See analysis/.test(document.body.innerText), { timeout: 15000 }).catch(() => errors.push('import did not finish'));
  await page.evaluate(() => window.__pppTest.nav('My Songs'));
  await sleep(400);
  const songId = await page.evaluate(() => {
    const c = [...document.querySelectorAll('[data-song]')].find(x => x.getAttribute('data-song') !== 'demo');
    return c ? c.getAttribute('data-song') : null;
  });
  const buttons = await page.evaluate(id => ({
    mine: !!document.querySelector('[data-share-song="' + id + '"]'),
    sample: !!document.querySelector('[data-share-song="demo"]')
  }), songId);
  ok('your song has a Share button', !!songId && buttons.mine);
  ok('the built-in sample does not', !buttons.sample);

  console.log('\n── as a guest ──');
  await page.evaluate(id => document.querySelector('[data-share-song="' + id + '"]').click(), songId);
  await sleep(250);
  const guestDlg = await page.evaluate(() => ({
    open: !!document.querySelector('[data-share-dialog]'),
    signIn: !!document.querySelector('[data-share-signin]'),
    post: !!document.querySelector('[data-share-post]')
  }));
  ok('the dialog asks a guest to sign in, and offers nothing it cannot do', guestDlg.open && guestDlg.signIn && !guestDlg.post, JSON.stringify(guestDlg));
  await page.keyboard.press('Escape');
  await sleep(200);
  ok('Escape closes it', await page.evaluate(() => !document.querySelector('[data-share-dialog]')));

  console.log('\n── signed in ──');
  const email = 'ppp-share-' + Date.now() + '@example.com';
  const signed = await api(page, '/api/auth/signup', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: email, password: 'practice-ok', displayName: 'Share Tester' })
  });
  ok('an account for the test', signed.status === 201, String(signed.status));
  await page.reload({ waitUntil: 'networkidle2' });
  await booted(page);
  await page.waitForFunction(() => /Share Tester/.test(document.querySelector('header').innerText), { timeout: 8000 }).catch(() => errors.push('the page did not pick up the session'));
  const openDialog = async () => {
    await page.evaluate(() => window.__pppTest.nav('My Songs'));
    await sleep(400);
    await page.evaluate(id => document.querySelector('[data-share-song="' + id + '"]').click(), songId);
    await sleep(250);
  };
  await openDialog();
  const fresh = await page.evaluate(() => ({
    post: (document.querySelector('[data-share-post]') || {}).textContent,
    posted: (document.querySelector('[data-share-post]') || { getAttribute() { return null; } }).getAttribute('data-posted'),
    link: !!document.querySelector('[data-share-link]'),
    nets: [...document.querySelectorAll('[data-share-net]')].map(b => b.getAttribute('data-share-net'))
  }));
  ok('it offers to post to Shared Scores', /Post to Shared Scores/.test(fresh.post || '') && fresh.posted === 'false', fresh.post);
  ok('and to send a link: copy, X, Facebook, LINE, Threads, email', ['copy', 'x', 'facebook', 'line', 'threads', 'email'].every(n => fresh.nets.indexOf(n) > -1), fresh.nets.join(', '));
  ok('no link exists until one is sent', !fresh.link);

  console.log('\n── sending a link ──');
  await page.evaluate(() => document.querySelector('[data-share-net="x"]').click());
  await page.waitForFunction(() => !!document.querySelector('[data-share-link]'), { timeout: 8000 }).catch(() => {});
  const link = await page.evaluate(() => (document.querySelector('[data-share-link]') || {}).textContent || '');
  const shareId = (/[?&]share=([\w-]+)$/.exec(link) || [])[1];
  const opened = await page.evaluate(() => window.__opened.slice());
  const tweet = opened.find(u => /^https:\/\/twitter\.com\/intent\/tweet\?/.test(u)) || '';
  ok('the link is made, and shown', !!shareId, link);
  ok('X gets a post with the link in it', !!tweet && decodeURIComponent(tweet).indexOf(link) > -1, tweet.slice(0, 120));
  const row = await api(page, '/api/shares/' + shareId);
  ok('the server has it', row.status === 200 && row.body.mine === true, row.status + '');
  ok('sending a link does not post it', row.body && row.body.listed === false);
  const everyone = await api(page, '/api/shares');
  ok('so it is not in Shared Scores', !everyone.body.shares.some(s => s.id === shareId));
  const sc = (row.body && row.body.score) || {};
  ok('only the notes went: no history, no memory, no file name',
    !('history' in row.body) && !('memory' in row.body) && sc.source && sc.source.kind === 'shared' && !/\.musicxml/.test(JSON.stringify(sc.source)) && sc.notes.length > 0,
    JSON.stringify(sc.source));

  await page.evaluate(() => document.querySelector('[data-share-net="facebook"]').click());
  await sleep(150);
  const fb = (await page.evaluate(() => window.__opened.slice())).find(u => /facebook\.com\/sharer/.test(u)) || '';
  ok('Facebook opens straight away once the link exists', decodeURIComponent(fb).indexOf(link) > -1, fb.slice(0, 100));

  console.log('\n── posting ──');
  await page.evaluate(() => document.querySelector('[data-share-post]').click());
  await page.waitForFunction(() => (document.querySelector('[data-share-post]') || {}).getAttribute && document.querySelector('[data-share-post]').getAttribute('data-posted') === 'true', { timeout: 8000 }).catch(() => {});
  const posted = await page.evaluate(() => document.querySelector('[data-share-post]').textContent.trim());
  ok('Post turns into Take down', posted === 'Take down', posted);
  const listed = await api(page, '/api/shares');
  ok('it is listed in Shared Scores now, under the same link', listed.body.shares.some(s => s.id === shareId && s.listed), shareId);
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.__pppTest.nav('My Songs'));
  await sleep(400);
  ok('its card says it is shared', (await page.evaluate(id => document.querySelector('[data-share-song="' + id + '"]').textContent.trim(), songId)) === 'Shared');
  await page.evaluate(() => window.__pppTest.nav('Shared Scores'));
  await page.waitForFunction(id => !!document.querySelector('[data-shared="' + id + '"]'), { timeout: 8000 }, shareId).catch(() => {});
  const card = await page.evaluate(id => {
    const c = document.querySelector('[data-shared="' + id + '"]');
    return c ? { text: c.innerText, thumb: !!c.querySelector('svg') } : null;
  }, shareId);
  ok('the tab shows it, marked as yours, with its opening bars drawn', !!card && /Yours · posted/.test(card.text) && card.thumb, card ? card.text.replace(/\s+/g, ' ').slice(0, 90) : 'missing');

  console.log('\n── someone with the link and no account ──');
  const html = await (await fetch(BASE + '/?share=' + shareId)).text();
  ok('the link says what it is before it opens (Open Graph)', /<meta property="og:title" content="[^"]+">/.test(html) && /shared by Share Tester/.test(html));
  const ctxB = await browser.createBrowserContext();
  const other = await ctxB.newPage();
  await other.evaluateOnNewDocument(() => { try { localStorage.setItem('ppp-locale', 'en-US'); } catch (e) {} });
  other.on('pageerror', e => errors.push('[pageerror B] ' + e.message));
  await other.setViewport({ width: 1280, height: 900 });
  await other.goto(BASE + '/?share=' + shareId, { waitUntil: 'networkidle2', timeout: 45000 });
  await booted(other);
  await other.waitForFunction(() => !!document.querySelector('[data-shared-linked] [data-open-shared]'), { timeout: 10000 }).catch(() => {});
  const land = await other.evaluate(() => ({
    gate: !!document.querySelector('[data-auth]'),
    title: (document.querySelector('header div div') || {}).textContent,
    card: ((document.querySelector('[data-shared-linked]') || {}).innerText || '').replace(/\s+/g, ' '),
    url: location.search
  }));
  ok('it opens without the sign-in gate', !land.gate);
  ok('on Shared Scores, at the score it points to', land.title === 'Shared Scores' && /Shared with you/.test(land.card) && /Share Tester/.test(land.card), land.card.slice(0, 90));
  ok('and the address is tidied, so a reload is an ordinary visit', land.url === '', land.url);
  await other.evaluate(() => document.querySelector('[data-shared-linked] [data-open-shared]').click());
  await other.waitForFunction(() => (document.querySelector('header div div') || {}).textContent === 'Practice', { timeout: 10000 }).catch(() => {});
  const practising = await other.evaluate(() => document.querySelector('header').innerText.split('\n')[1] || '');
  ok('Add to My Songs puts it on the practice page', /Prelude/.test(practising), practising);
  await other.evaluate(() => window.__pppTest ? window.__pppTest.nav('My Songs') : [...document.querySelectorAll('aside nav button')].find(b => /^My Songs/.test(b.innerText)).click());
  await sleep(400);
  const shelfB = await other.evaluate(() => [...document.querySelectorAll('[data-song]')].map(c => c.innerText.replace(/\s+/g, ' ')));
  ok('it is in their My Songs, marked as a shared score', shelfB.some(t => /Prelude/.test(t) && /Shared score/.test(t)), shelfB.join(' | ').slice(0, 160));
  ok('and they cannot share it on as their own without an account', await other.evaluate(() => {
    const b = [...document.querySelectorAll('[data-share-song]')].find(x => x.getAttribute('data-share-song') !== 'demo');
    if (!b) return false;
    b.click();
    return new Promise(r => setTimeout(() => r(!!document.querySelector('[data-share-signin]')), 250));
  }));

  const theirs = await api(other, '/api/shares/' + shareId, { method: 'DELETE' });
  const kept = await api(other, '/api/shares/' + shareId);
  ok('nobody but the owner can take it away', theirs.status === 403 && kept.status === 200, theirs.status + ' then ' + kept.status);

  console.log('\n── taking it down, then stopping ──');
  await openDialog();
  await page.evaluate(() => document.querySelector('[data-share-post]').click());
  await page.waitForFunction(() => document.querySelector('[data-share-post]').getAttribute('data-posted') === 'false', { timeout: 8000 }).catch(() => {});
  const down = await api(page, '/api/shares');
  const stillThere = await api(page, '/api/shares/' + shareId);
  ok('Take down removes it from Shared Scores', !down.body.shares.some(s => s.id === shareId));
  ok('but the link still opens it', stillThere.status === 200);
  await page.evaluate(() => document.querySelector('[data-share-stop]').click());
  await sleep(150);
  const armed = await page.evaluate(() => document.querySelector('[data-share-stop]').textContent.trim());
  const beforeSecond = await api(page, '/api/shares/' + shareId);
  ok('Stop sharing asks first', /Stop sharing\?/.test(armed) && beforeSecond.status === 200, armed);
  await page.evaluate(() => document.querySelector('[data-share-stop]').click());
  await page.waitForFunction(() => !document.querySelector('[data-share-link]'), { timeout: 8000 }).catch(() => {});
  const gone = await api(page, '/api/shares/' + shareId);
  ok('then the link stops working', gone.status === 404, String(gone.status));
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.__pppTest.nav('My Songs'));
  await sleep(400);
  ok('and the card is back to Share', (await page.evaluate(id => document.querySelector('[data-share-song="' + id + '"]').textContent.trim(), songId)) === 'Share');

  console.log('\n────────────────────────────────────────');
  if (errors.length) {
    console.log(errors.length + ' PROBLEM(S):');
    [...new Set(errors)].forEach(e => console.log('  ✗ ' + e));
  } else console.log('Scores are shared as notes only, posted or by link, and taken back.');
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})().catch(e => { console.error('HARNESS FAILURE:', e); process.exit(2); });
