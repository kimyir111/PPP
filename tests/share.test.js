/* Shared Scores: a song of yours can be posted for anyone to add, or only
   sent as a link; the link opens for someone with no account and no guest
   session; taking it down and stopping sharing do what they say.

   Sharing needs no account (guest link sharing): with none, the Share dialog makes an
   UNLISTED link, a second person opens it, and the guest can stop sharing it from the
   browser that made it. Posting to Shared Scores stays an account feature.

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

  console.log('\n── as a guest: no sign-in wall, an unlisted link ──');
  await page.evaluate(id => document.querySelector('[data-share-song="' + id + '"]').click(), songId);
  await sleep(250);
  const guestDlg = await page.evaluate(() => {
    const dlg = document.querySelector('[data-share-dialog]');
    return {
      open: !!dlg,
      signIn: !!document.querySelector('[data-share-signin]'),
      hint: ((document.querySelector('[data-share-signin]') || {}).innerText || '').replace(/\s+/g, ' '),
      post: !!document.querySelector('[data-share-post]'),
      copy: !!document.querySelector('[data-share-net="copy"]'),
      nets: [...document.querySelectorAll('[data-share-net]')].map(b => b.getAttribute('data-share-net')),
      fine: /Only the notes are shared/.test(dlg ? dlg.innerText : '') && /Share only music you have the right to share/.test(dlg ? dlg.innerText : ''),
      text: dlg ? dlg.innerText.replace(/\s+/g, ' ') : ''
    };
  });
  ok('the dialog opens for a guest', guestDlg.open);
  ok('it offers the link flow: copy, X, Facebook, LINE, Threads, email', ['copy', 'x', 'facebook', 'line', 'threads', 'email'].every(n => guestDlg.nets.indexOf(n) > -1), guestDlg.nets.join(', '));
  ok('it does not offer posting to Shared Scores, and says why in one line', !guestDlg.post && guestDlg.signIn && /Posting to Shared Scores needs an account/.test(guestDlg.hint), guestDlg.hint);
  ok('the optional sign-in hint has the Login button', await page.evaluate(() => /^Sign in$/.test(((document.querySelector('[data-share-signin] button') || {}).textContent || '').trim())));
  ok('and the copyright line stays visible', guestDlg.fine, guestDlg.text.slice(-160));
  ok('it says the link is unlisted and expires', /not listed/.test(guestDlg.text) && /30 days/.test(guestDlg.text));
  ok('and no wall: nothing says "Sign in to share your scores"', !/Sign in to share your scores/.test(guestDlg.text));
  ok('and it does not warn that the browser cannot keep a key, before any key exists (storage works)', !/cannot keep a key/.test(guestDlg.text), guestDlg.text.slice(0, 200));
  await page.evaluate(() => document.querySelector('[data-share-net="x"]').click());
  await page.waitForFunction(() => !!document.querySelector('[data-share-link]'), { timeout: 8000 }).catch(() => {});
  const gLink = await page.evaluate(() => (document.querySelector('[data-share-link]') || {}).textContent || '');
  const gId = (/[?&]share=([\w-]+)$/.exec(gLink) || [])[1];
  ok('a link is made without any login screen', !!gId && await page.evaluate(() => !document.querySelector('[data-auth]')), gLink);
  const gOpened = (await page.evaluate(() => window.__opened.slice())).find(u => /twitter\.com\/intent\/tweet/.test(u)) || '';
  ok('and X gets a post with the link', decodeURIComponent(gOpened).indexOf(gLink) > -1);
  const gKey = await page.evaluate(() => localStorage.getItem('ppp-guest-key'));
  ok('the browser keeps a random secret of 64 hex characters', /^[0-9a-f]{64}$/.test(gKey || ''), String(gKey).length + '');
  const gRow = await api(page, '/api/shares/' + gId, { headers: { 'X-PPP-Guest': gKey } });
  ok('the server has it, unlisted, from "Guest", mine for this browser', gRow.status === 200 && gRow.body.listed === false && gRow.body.owner === 'Guest' && gRow.body.mine === true, JSON.stringify(gRow.body && { l: gRow.body.listed, o: gRow.body.owner, m: gRow.body.mine }));
  ok('and the server never sees the secret as an owner name', JSON.stringify(gRow.body).indexOf(gKey) < 0);
  ok('it is not in the Shared Scores directory', !(await api(page, '/api/shares')).body.shares.some(s => s.id === gId));

  const ctxG = await browser.createBrowserContext();
  const gOther = await ctxG.newPage();
  await gOther.evaluateOnNewDocument(() => { try { localStorage.setItem('ppp-locale', 'en-US'); } catch (e) {} });
  gOther.on('pageerror', e => errors.push('[pageerror G] ' + e.message));
  await gOther.setViewport({ width: 1280, height: 900 });
  await gOther.goto(BASE + '/?share=' + gId, { waitUntil: 'networkidle2', timeout: 45000 });
  await booted(gOther);
  await gOther.waitForFunction(() => !!document.querySelector('[data-shared-linked] [data-open-shared]'), { timeout: 10000 }).catch(() => {});
  const gLand = await gOther.evaluate(() => ({
    gate: !!document.querySelector('[data-auth]'),
    card: ((document.querySelector('[data-shared-linked]') || {}).innerText || '').replace(/\s+/g, ' ')
  }));
  ok('a second person opens the guest link in another browser and sees the score', !gLand.gate && /Shared with you/.test(gLand.card) && /Guest/.test(gLand.card) && /Prelude/.test(gLand.card), gLand.card.slice(0, 100));
  const gTheirDelete = await api(gOther, '/api/shares/' + gId, { method: 'DELETE' });
  ok('and cannot take it down', gTheirDelete.status === 403 && (await api(gOther, '/api/shares/' + gId)).status === 200, String(gTheirDelete.status));
  await ctxG.close();

  await page.evaluate(() => document.querySelector('[data-share-stop]').click());
  await sleep(150);
  const gArmed = await page.evaluate(() => document.querySelector('[data-share-stop]').textContent.trim());
  ok('the guest can stop sharing, after a confirm', /Stop sharing\?/.test(gArmed) && (await api(page, '/api/shares/' + gId)).status === 200, gArmed);
  await page.evaluate(() => document.querySelector('[data-share-stop]').click());
  await page.waitForFunction(() => !document.querySelector('[data-share-link]'), { timeout: 8000 }).catch(() => {});
  ok('then the link is 404', (await api(page, '/api/shares/' + gId)).status === 404);
  await page.keyboard.press('Escape');
  await sleep(200);
  ok('Escape closes it', await page.evaluate(() => !document.querySelector('[data-share-dialog]')));
  await page.evaluate(() => window.__pppTest.nav('My Songs'));
  await sleep(300);
  ok('and the card is back to Share', (await page.evaluate(id => document.querySelector('[data-share-song="' + id + '"]').textContent.trim(), songId)) === 'Share');

  console.log('\n── the server\'s own words are shown, in every language, not "could not reach the server" ──');
  {
    const full = { error: 'Guest links are full right now. Try again later, or sign in to share.', code: 'guest-full' };
    const perBrowser = { error: 'This browser has made as many guest links as PPP keeps. Stop sharing one, or sign in.' };
    const tooMany = { error: 'Too many links were made from here just now. Try again in a little while.' };
    const tooBig = { error: 'That score is too large to share as a guest. Sign in to share larger scores.' };
    const cases = [
      ['503 guest links are full', 503, full, { 'en-US': /Guest links are full right now/, 'ko-KR': /게스트 링크가 가득 찼어요/, 'ja-JP': /ゲストリンクがいっぱいです/, 'zh-CN': /访客链接目前已满/ }],
      ['429 one browser has 20', 429, perBrowser, { 'en-US': /as many guest links/, 'ko-KR': /게스트 링크 수를 다 채웠어요/, 'ja-JP': /ゲストリンクの上限/, 'zh-CN': /访客链接数量已达上限/ }],
      ['429 too many from one address', 429, tooMany, { 'en-US': /Too many links were made/, 'ko-KR': /링크가 너무 많이 만들어졌어요/, 'ja-JP': /リンクが多すぎます/, 'zh-CN': /链接太多了/ }],
      ['413 too large for a guest', 413, tooBig, { 'en-US': /too large to share as a guest/, 'ko-KR': /게스트로는 이렇게 큰 악보/, 'ja-JP': /ゲストではこの大きさ/, 'zh-CN': /访客无法分享这么大/ }]
    ];
    let fake = null;
    const handler = r => {
      if (fake && r.method() === 'POST' && /\/api\/shares$/.test(r.url())) r.respond({ status: fake.status, contentType: 'application/json', body: JSON.stringify(fake.body) });
      else r.continue();
    };
    await page.setRequestInterception(true);
    page.on('request', handler);
    for (const [name, status, body, byLocale] of cases) {
      const seen = [];
      for (const loc of Object.keys(byLocale)) {
        await page.evaluate(l => window.PPP_I18N.setLocale(l), loc);
        fake = { status: status, body: body };
        await page.evaluate(id => document.querySelector('[data-share-song="' + id + '"]').click(), songId);
        await sleep(200);
        await page.evaluate(() => document.querySelector('[data-share-net="x"]').click());
        await page.waitForFunction(() => !!document.querySelector('[data-share-error]'), { timeout: 5000 }).catch(() => {});
        const shown = await page.evaluate(() => (document.querySelector('[data-share-error]') || {}).textContent || '');
        if (!byLocale[loc].test(shown) || /Could not reach|서버에 연결/.test(shown)) seen.push(loc + ': ' + shown.slice(0, 60));
        await page.keyboard.press('Escape');
        await sleep(120);
      }
      ok(name + ' reads right in en, ko, ja and zh', !seen.length, seen.join(' | '));
    }
    fake = null;
    page.off('request', handler);
    await page.setRequestInterception(false);
    await page.evaluate(() => window.PPP_I18N.setLocale('en-US'));
    await sleep(200);
  }

  console.log('\n── a browser that cannot keep the key ──');
  {
    const ctxN = await browser.createBrowserContext();
    const noKeep = await ctxN.newPage();
    await preparePage(noKeep);
    await recordOpens(noKeep);
    /* the one write the key needs is refused; the rest of the app is untouched */
    await noKeep.evaluateOnNewDocument(() => {
      const set = Storage.prototype.setItem;
      Storage.prototype.setItem = function (k, v) {
        if (k === 'ppp-guest-key') throw new Error('storage is blocked');
        return set.apply(this, arguments);
      };
    });
    noKeep.on('pageerror', e => errors.push('[pageerror N] ' + e.message));
    await noKeep.setViewport({ width: 1280, height: 900 });
    await noKeep.goto(URL, { waitUntil: 'networkidle2', timeout: 45000 });
    await booted(noKeep);
    await noKeep.evaluate(() => window.__pppTest.upload());
    await sleep(300);
    await (await noKeep.$('input[type=file][data-add-file]')).uploadFile(SAMPLE);
    await noKeep.waitForFunction(() => /See analysis/.test(document.body.innerText), { timeout: 15000 }).catch(() => errors.push('import did not finish (N)'));
    await noKeep.evaluate(() => window.__pppTest.nav('My Songs'));
    await sleep(400);
    const nId = await noKeep.evaluate(() => {
      const c = [...document.querySelectorAll('[data-song]')].find(x => x.getAttribute('data-song') !== 'demo');
      return c ? c.getAttribute('data-song') : null;
    });
    await noKeep.evaluate(id => document.querySelector('[data-share-song="' + id + '"]').click(), nId);
    await sleep(250);
    ok('it warns, before the link exists, that the link can only be taken down while the page is open',
      await noKeep.evaluate(() => /cannot keep a key for this link/.test(document.querySelector('[data-share-dialog]').innerText)));
    await noKeep.evaluate(() => document.querySelector('[data-share-net="x"]').click());
    await noKeep.waitForFunction(() => !!document.querySelector('[data-share-link]'), { timeout: 8000 }).catch(() => {});
    const nLink = await noKeep.evaluate(() => (document.querySelector('[data-share-link]') || {}).textContent || '');
    const nId2 = (/[?&]share=([\w-]+)$/.exec(nLink) || [])[1];
    ok('the link is still made, with a key held in memory (nothing in localStorage)', !!nId2 && (await noKeep.evaluate(() => localStorage.getItem('ppp-guest-key'))) === null, nLink);
    await noKeep.evaluate(() => document.querySelector('[data-share-stop]').click());
    await sleep(150);
    await noKeep.evaluate(() => document.querySelector('[data-share-stop]').click());
    await noKeep.waitForFunction(() => !document.querySelector('[data-share-link]'), { timeout: 8000 }).catch(() => {});
    ok('and it can be stopped in the same page session', (await api(noKeep, '/api/shares/' + nId2)).status === 404);
    await ctxN.close();
  }

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
  ok('and with no account they can send it on as a link, but not post it', await other.evaluate(() => {
    const b = [...document.querySelectorAll('[data-share-song]')].find(x => x.getAttribute('data-share-song') !== 'demo');
    if (!b) return false;
    b.click();
    return new Promise(r => setTimeout(() => r(!!document.querySelector('[data-share-net="copy"]') && !document.querySelector('[data-share-post]') && !!document.querySelector('[data-share-signin]')), 250));
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
