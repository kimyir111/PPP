/* G13-3: Settings > About & licences, the YouTube notice, and the Shared Scores block, in a real browser (puppeteer; its own server on a free port with its own
   data folder; every screen in Korean, read from i18n/ko-KR.json). PPP_NOTICES_ROOT serves a copy of the tree (tests/notices/mutants.js).

   What a person does, with the page's own buttons:
     1. Settings: "About & licences" is there after ONE tap (Settings), in Korean: the build, "your songs stay on this device unless you share them", the YouTube
        rights notice, the CC BY 3.0 attribution of the piano sounds with its licence link and its source link, and the link to the notices file, which opens.
     2. The Add screen: the one-line rights notice sits in the YouTube link box, before the link is typed.
     3. Sharing, signed in to a real account on the real server: a song transcribed from a YouTube link, an arrangement of one (by its parent, and by the mark it
        carries), a copy somebody else added - the Post button is off and says why in one line; the link is still made, and what is stored carries the mark. An
        ordinary song, an arrangement of one, a hymn with a performance to watch and a public-domain score found by a link's title are posted as before. A share the
        page cannot recognise (not on this shelf, but its stored score carries the mark) is refused BY THE SERVER, and the page shows that reason in Korean. A share
        posted before the rule can still be taken down; once down the page does not offer to post it again. */
'use strict';
const puppeteer = require('puppeteer');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { startServer } = require('./serve-free');
const { ROOT } = require('./notices/lib.js');

const KO = JSON.parse(fs.readFileSync(path.join(ROOT, 'i18n', 'ko-KR.json'), 'utf8')).content;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const errors = [];
const ok = (name, cond, detail) => {
  console.log((cond ? '  ✓ ' : '  ✗ ') + name + (detail ? ' — ' + detail : ''));
  if (!cond) errors.push(name + (detail ? ' — ' + detail : ''));
};
const fill = (s, vars) => String(s).replace(/\{\{(\w+)\}\}/g, (_, k) => (vars && vars[k] != null ? vars[k] : ''));
const ko = (key, vars) => {
  const v = KO[key];
  if (typeof v !== 'string' || !/[가-힣]/.test(v)) { errors.push('no Korean for: ' + key); return '⟨no Korean: ' + key + '⟩'; }
  return fill(v, vars);
};
const REASON = 'A score made from a YouTube link cannot be posted to Shared Scores. You can still send its link.';
const NOTICE = 'Use recordings you have the right to use. The score PPP writes is for your own practice.';
const SOUNDS = 'Piano sounds: Salamander Grand Piano V3 by Alexander Holm, licensed under CC BY 3.0. Notes longer than nine seconds are shortened.';
const WATCH = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';

(async () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'ppp-notices-ui-'));
  const srv = await startServer({ root: ROOT, env: { PPP_DATA_DIR: data, PPP_BUILD: 'abc1234' } });
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const pageErrors = [];
  try {
    /* ------------------------------------------------------------------------------------------ helpers */
    const waitFor = async (fn, ms) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > (ms || 10000)) return null; await sleep(120); } };
    const ready = page => page.waitForFunction(() => document.querySelectorAll('aside nav button').length >= 6, { timeout: 30000 });
    const nav = (page, label) => page.evaluate(l => { const b = [...document.querySelectorAll('aside nav button')].find(x => x.innerText.split('\n')[0].trim() === l); if (b) b.click(); return !!b; }, label);
    const text = (page, sel) => page.evaluate(s => { const e = document.querySelector(s); return e ? e.innerText.replace(/\s+/g, ' ').trim() : null; }, sel);
    const exists = (page, sel) => page.evaluate(s => !!document.querySelector(s), sel);
    const click = (page, sel) => page.evaluate(s => { const e = document.querySelector(s); if (e) e.click(); return !!e; }, sel);
    const api = (page, method, p, body) => page.evaluate(async (m, u, b) => {
      const r = await fetch(u, { method: m, credentials: 'include', headers: b ? { 'Content-Type': 'application/json' } : {}, body: b ? JSON.stringify(b) : undefined });
      let j = null; try { j = await r.json(); } catch (e) { j = null; }
      return { status: r.status, body: j };
    }, method, p, body || null);

    /* ------------------------------------------------------------------------------------------ the songs, made by the page's own importer */
    console.log('\n── preparing songs with the page\'s own importer ──');
    const ctx0 = await browser.createBrowserContext();
    const p0 = await ctx0.newPage();
    p0.on('pageerror', e => pageErrors.push('[pageerror] ' + e.message));
    await p0.goto(srv.url, { waitUntil: 'networkidle2', timeout: 60000 });
    await ready(p0);
    const PLANT = await p0.evaluate(async watch => {
      const xml = await fetch('samples/prelude-fragment.musicxml').then(r => r.text());
      const slot = (title, source, importSource) => {
        const sc = PPP.scoreFromXml(xml, title + '.musicxml');
        sc.title = title; sc.id = 'import:' + title;
        sc.source = Object.assign({}, sc.source || {}, source);
        const secs = {};
        (sc.sections || []).forEach(s => { secs[s.id] = { acc: 10, mem: 0, reps: 0 }; });
        return {
          score: PPP.packScore(sc), secs: secs, history: { rev: 1, byMeasure: {}, runs: [] }, memory: { rev: 0, sections: {} },
          loopFrom: 1, loopTo: Math.min(2, sc.measures.length), tempo: 70, memLevel: 0, blindRuns: 0, mastered: false,
          fileName: title, fileMeta: '8 KB', importSource: importSource || null, importReport: null, measures: sc.measures.length
        };
      };
      const id = 'dQw4w9WgXcQ';
      const defs = [
        /* id, title, card kind, score source, extra card fields */
        ['song-yt', 'From YouTube', 'youtube', { kind: 'youtube', url: watch, youtubeId: id, engine: 'Piano ensemble (Transkun + Kong)', transcriptionVersion: 7, amt: 'ensemble' }, { url: watch }],
        ['song-ok', 'Ordinary', 'musicxml', { kind: 'musicxml' }, {}],
        ['song-arr-yt', 'Arranged from YouTube', 'arrangement', { kind: 'arrangement', parentSongId: 'song-yt', arrangement: { engine: 'ppp.g9-single' } }, { arrangedFrom: 'song-yt' }],
        ['song-arr-ok', 'Arranged ordinary', 'arrangement', { kind: 'arrangement', parentSongId: 'song-ok', arrangement: { engine: 'ppp.g9-single' } }, { arrangedFrom: 'song-ok' }],
        ['song-marked', 'Marked copy', 'arrangement', { kind: 'arrangement', youtubeDerived: true, arrangement: { engine: 'ppp.g9-single' } }, { arrangedFrom: 'song-gone' }],
        /* a hymn with a performance to watch, and a public-domain score found by the title of a link: a YouTube source, and no transcription */
        ['song-hymn', 'Hymn with a performance', 'youtube', { kind: 'youtube', url: watch, youtubeId: id }, { url: watch }],
        ['song-found', 'Found by its title', 'youtube', { kind: 'youtube', url: watch, youtubeId: id, retrieved: true, engine: 'Public-domain catalog', catalogId: 'fur-elise' }, { url: watch }],
        ['song-legacy', 'Posted long ago', 'youtube', { kind: 'youtube', url: watch, youtubeId: id, engine: 'Piano ensemble (Transkun + Kong)', transcriptionVersion: 7 }, { url: watch }]
      ];
      const cards = [], slots = {};
      defs.forEach(([sid, title, kind, source, extra], i) => {
        const s = slot(title, source, { kind: kind });
        cards.push(Object.assign({ id: sid, title: title, composer: '', kind: kind, url: null, addedAt: 1700000000000 + i, lastAt: 1700000000000 + i, prog: 0, mem: 0, measures: s.measures }, extra));
        slots[sid] = JSON.stringify(s);
      });
      return { cards: cards, slots: slots };
    }, WATCH);
    await ctx0.close();
    ok('8 songs were made by the page', PLANT.cards.length === 8 && Object.keys(PLANT.slots).length === 8);

    /* ------------------------------------------------------------------------------------------ a profile */
    const ctx = await browser.createBrowserContext();
    const page = await ctx.newPage();
    const posts = [];                      /* every POST to /api/shares the page makes: its body as sent */
    page.on('pageerror', e => pageErrors.push('[pageerror] ' + e.message));
    page.on('request', r => {
      if (r.method() === 'POST' && /\/api\/shares$/.test(new URL(r.url()).pathname)) { try { posts.push(JSON.parse(r.postData() || '{}')); } catch (e) { posts.push({ unreadable: true }); } }
    });
    await page.setViewport({ width: 1100, height: 1500 });
    await page.evaluateOnNewDocument(cfg => {
      try {
        if (sessionStorage.getItem('__seeded')) return;
        sessionStorage.setItem('__seeded', '1');
        localStorage.setItem('ppp-locale', 'ko-KR');
        localStorage.setItem('ppp-guest', '1');
        localStorage.setItem('ppp.library.v1', JSON.stringify({ songs: cfg.cards, current: 'demo', demo: null }));
        Object.keys(cfg.slots).forEach(id => localStorage.setItem('ppp.song.v1.' + id, cfg.slots[id]));
      } catch (e) { /* none */ }
    }, PLANT);
    await page.goto(srv.url, { waitUntil: 'networkidle2', timeout: 60000 });
    await ready(page);

    /* ------------------------------------------------------------------------------------------ 1. Settings */
    console.log('\n── 1. Settings > About & licences (Korean, one tap) ──');
    await nav(page, ko('Settings'));
    const about = await waitFor(() => exists(page, '[data-about-section]'), 8000);
    ok('after one tap on Settings the section is on the page', !!about);
    const shown = await page.evaluate(() => { const e = document.querySelector('[data-about-section]'); return !!e && e.getClientRects().length > 0; });
    ok('and it is drawn (not hidden)', shown);
    ok('its title is "정보 및 라이선스"', (await text(page, '[data-about-section] > div:first-child > div:first-child')) === ko('About & licences'), await text(page, '[data-about-section] > div:first-child > div:first-child'));
    ok('the build line: the app and the build the server runs', (await text(page, '[data-about-build]')) === ko('PPP — Piano Practice Partner') + ' · ' + ko('build {{build}}', { build: 'abc1234' }), await text(page, '[data-about-build]'));
    ok('"your songs stay on this device unless you share them"', (await text(page, '[data-about-local]')) === ko('Your songs stay on this device unless you share them.'), await text(page, '[data-about-local]'));
    ok('the YouTube rights notice and what it means for sharing', (await text(page, '[data-about-youtube]')) === ko(NOTICE) + ' ' + ko(REASON), await text(page, '[data-about-youtube]'));
    const sounds = await text(page, '[data-about-sounds]');
    ok('the CC BY attribution: title, author, licence', !!sounds && sounds.startsWith(ko(SOUNDS)) && sounds.includes('Salamander Grand Piano V3') && sounds.includes('Alexander Holm') && sounds.includes('CC BY 3.0'), sounds);
    const links = await page.evaluate(() => ['cc', 'source', 'notices'].map(k => { const a = document.querySelector('[data-about-' + k + ']'); return a ? { href: a.href, target: a.target, rel: a.rel, text: a.innerText.trim() } : null; }));
    ok('it links the licence text (CC BY 3.0), in a new tab', !!links[0] && links[0].href === 'https://creativecommons.org/licenses/by/3.0/' && links[0].target === '_blank' && /noopener/.test(links[0].rel), JSON.stringify(links[0]));
    ok('and the source of the recordings', !!links[1] && links[1].href === 'https://archive.org/details/SalamanderGrandPianoV3', JSON.stringify(links[1]));
    ok('and the licence notices of the code, fonts and scores (Korean label)', !!links[2] && links[2].text === ko('Open-source licences and notices') && /\/THIRD_PARTY_NOTICES\.md$/.test(links[2].href), JSON.stringify(links[2]));
    const notices = await page.evaluate(async h => { const r = await fetch(h); return { status: r.status, type: r.headers.get('content-type'), text: await r.text() }; }, links[2] && links[2].href);
    ok('that link opens the generated file, as text', notices.status === 200 && /^text\/plain/.test(notices.type) && notices.text.includes('Alexander Holm') && notices.text.includes('# Third-party notices'), notices.status + ' ' + notices.type);

    /* ------------------------------------------------------------------------------------------ 2. Add screen */
    console.log('\n── 2. the rights notice where a YouTube link is entered ──');
    await page.evaluate(() => PPP.app.go('upload')());
    await waitFor(() => exists(page, '[data-youtube-url]'), 8000);
    /* the page translates its template text a moment after it is drawn: wait for the Korean, and say what was there if it never comes */
    await waitFor(async () => (await text(page, '[data-youtube-notice]')) === ko(NOTICE), 6000);
    const inBox = await page.evaluate(() => { const n = document.querySelector('[data-youtube-notice]'), box = document.querySelector('[data-youtube]'); return { in: !!n && !!box && box.contains(n), text: n ? n.innerText.replace(/\s+/g, ' ').trim() : null, before: !!n && !!document.querySelector('[data-youtube-url]') && !!(n.compareDocumentPosition(document.querySelector('[data-youtube-url]')) & Node.DOCUMENT_POSITION_FOLLOWING) }; });
    ok('one line sits in the YouTube box, above the link field (Korean)', inBox.in && inBox.before && inBox.text === ko(NOTICE), JSON.stringify(inBox));
    ok('it is a line, not a dialog', !(await exists(page, '[role="dialog"]')) && !(await exists(page, '[role="alertdialog"]')));

    /* ------------------------------------------------------------------------------------------ 3. sharing */
    console.log('\n── 3. Shared Scores: a song made from a YouTube link is not posted; its link is ──');
    const su = await api(page, 'POST', '/api/auth/signup', { email: 'teacher' + Date.now() + '@example.com', password: 'practice-ok', displayName: 'Teacher' });
    ok('an account is made on the real server', su.status === 201, JSON.stringify(su));
    await page.reload({ waitUntil: 'networkidle2' });
    await ready(page);
    const me = await api(page, 'GET', '/api/auth/me');
    ok('the page is signed in (the cookie holds on this origin)', me.status === 200 && !!me.body && !!me.body.id, JSON.stringify(me));
    const myId = me.body && me.body.id;

    const openDialog = async id => {
      await nav(page, ko('My Songs'));
      await page.waitForSelector('[data-share-song="' + id + '"]', { timeout: 15000 });
      await click(page, '[data-share-song="' + id + '"]');
      await page.waitForSelector('[data-share-dialog] [data-share-post]', { timeout: 8000 });
      await sleep(150);
      return page.evaluate(() => {
        const b = document.querySelector('[data-share-post]'), n = document.querySelector('[data-share-post-note]');
        return { disabled: !!b.disabled, aria: b.getAttribute('aria-disabled'), posted: b.getAttribute('data-posted'), label: b.innerText.replace(/\s+/g, ' ').trim(),
          note: n ? n.innerText.replace(/\s+/g, ' ').trim() : null, blocked: n ? n.getAttribute('data-blocked') : null,
          linkButton: !!document.querySelector('[data-share-net="copy"]') };
      });
    };
    const closeDialog = async () => { await click(page, '[data-share-close]'); await sleep(150); };
    const sendLink = async () => {
      const before = posts.length;
      await click(page, '[data-share-net="copy"]');
      await waitFor(() => exists(page, '[data-share-link]'), 10000);
      await waitFor(() => posts.length > before, 5000);
      return posts[posts.length - 1];
    };
    const mineByKey = async () => { const r = await api(page, 'GET', '/api/shares?mine=1'); return Object.fromEntries((r.body.shares || []).map(s => [s.songKey, s])); };

    const blockedIds = ['song-yt', 'song-arr-yt', 'song-marked'];
    for (const id of blockedIds) {
      const d = await openDialog(id);
      ok(id + ': the Post button is off', d.disabled && d.aria === 'true' && d.blocked === 'true', JSON.stringify(d));
      ok(id + ': one line says why (Korean)', d.note === ko(REASON), d.note);
      ok(id + ': the link can still be made', d.linkButton);
      const body = await sendLink();
      ok(id + ': the link was made as an unlisted share carrying the mark', !!body && body.listed === undefined && body.youtubeDerived === true && body.score && body.score.source && body.score.source.youtubeDerived === true, JSON.stringify({ listed: body && body.listed, flag: body && body.youtubeDerived, mark: body && body.score && body.score.source && body.score.source.youtubeDerived }));
      await closeDialog();
    }
    {
      /* the button is off; asked directly, the page itself does not send a post for such a song either */
      const before = posts.length;
      const refused = await page.evaluate(() => PPP.app.publishSong('song-yt', true).then(() => 'posted', e => e.message));
      ok('asked to post it directly, the page refuses without asking the server', refused === ko(REASON) && posts.length === before, refused + ' / posts +' + (posts.length - before));
    }
    {
      const mine = await mineByKey();
      ok('the server holds the three as links only (listed false)', blockedIds.every(k => mine[k] && mine[k].listed === false), JSON.stringify(blockedIds.map(k => mine[k] && mine[k].listed)));
      const stored = await api(page, 'GET', '/api/shares/' + mine['song-arr-yt'].id);
      ok('what is stored for the arrangement of a YouTube song says it is one (its own source has no YouTube link)', stored.status === 200 && stored.body.score.source.youtubeDerived === true && stored.body.score.source.kind === 'shared', JSON.stringify(stored.body && stored.body.score && stored.body.score.source));
    }

    const openIds = ['song-ok', 'song-arr-ok', 'song-hymn', 'song-found'];
    for (const id of openIds) {
      const d = await openDialog(id);
      ok(id + ': Post is on, with the usual invitation', !d.disabled && d.blocked === 'false' && d.note !== ko(REASON) && d.note === ko('Post it, and anyone using PPP can find it in Shared Scores and add it to their songs.'), JSON.stringify(d));
      const before = posts.length;
      await click(page, '[data-share-post]');
      const got = await waitFor(async () => { const t = await text(page, '[data-share-post]'); return t === ko('Take down') ? t : null; }, 10000);
      ok(id + ': it is posted', !!got);
      const body = posts[posts.length - 1];
      ok(id + ': the payload is asked to be listed and carries no YouTube mark', posts.length === before + 1 && body.listed === true && body.youtubeDerived === undefined && !(body.score.source && body.score.source.youtubeDerived), JSON.stringify({ listed: body.listed, flag: body.youtubeDerived }));
      await closeDialog();
    }
    {
      const pub = await api(page, 'GET', '/api/shares');
      const titles = (pub.body.shares || []).map(s => s.title);
      ok('the public list has the four (ordinary, its arrangement, the hymn, the score found by a title) and none of the three', ['Ordinary', 'Arranged ordinary', 'Hymn with a performance', 'Found by its title'].every(t => titles.includes(t)) && !titles.some(t => /From YouTube|Arranged from YouTube|Marked copy/.test(t)), titles.join(' | '));
    }

    console.log('\n── 3b. the server says no when the page cannot tell ──');
    {
      /* a link made earlier for a song that is not on this shelf; what is stored carries the mark (as a link of a YouTube transcription does) */
      const made = await api(page, 'POST', '/api/shares', {
        songKey: 'song-not-on-this-shelf', title: 'Link only, not on this shelf', composer: '', kind: 'arrangement', youtubeDerived: true,
        score: Object.assign({}, await page.evaluate(() => PPP.app.shareScoreOf('song-ok')), { source: { kind: 'shared', youtubeDerived: true } }), preview: null
      });
      ok('made through the server as a link', made.status === 201 && made.body.listed === false, JSON.stringify(made.body).slice(0, 100));
      await nav(page, ko('Shared Scores'));
      await sleep(400);
      await page.evaluate(() => { PPP.app.setSharedFilter('Mine'); PPP.app.loadShared(true, false, true); });
      ok('it is in Shared by me', !!(await waitFor(() => exists(page, '[data-share-shared="' + made.body.id + '"]'), 10000)));
      await click(page, '[data-share-shared="' + made.body.id + '"]');
      await page.waitForSelector('[data-share-dialog] [data-share-post]', { timeout: 8000 });
      await sleep(150);
      const d = await page.evaluate(() => { const b = document.querySelector('[data-share-post]'); return { disabled: !!b.disabled }; });
      ok('the page has no song to read it from, so the Post button is on', !d.disabled, JSON.stringify(d));
      await click(page, '[data-share-post]');
      const err = await waitFor(() => text(page, '[data-share-error]'), 10000);
      ok('the server refused, and the dialog shows its reason in Korean', err === ko(REASON), err);
      const row = await api(page, 'GET', '/api/shares/' + made.body.id);
      ok('the share is still a link only', row.status === 200 && row.body.listed === false);
      await closeDialog();
    }

    console.log('\n── 3c. a share posted before the rule ──');
    {
      /* a row posted long ago with a YouTube source, owned by this account, in the server's own file */
      const old = {
        id: 'legacyYT0001', ownerId: myId, ownerName: 'Teacher', songKey: 'song-legacy', title: 'Posted long ago', composer: '', genre: '', kind: 'youtube',
        measures: 2, listed: true, preview: null, score: { title: 'Posted long ago', measures: [{ number: 1 }, { number: 2 }], notes: [{ midi: 60 }], source: { kind: 'youtube', youtubeId: 'dQw4w9WgXcQ' } },
        createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z'
      };
      const f = path.join(data, 'shares.json');
      const cur = JSON.parse(fs.readFileSync(f, 'utf8'));
      cur.shares.push(old);
      fs.writeFileSync(f, JSON.stringify(cur));
      await page.evaluate(() => PPP.app.loadShared(true, false, true));
      await nav(page, ko('Shared Scores'));
      await sleep(600);
      /* the card of My Songs follows the server's list (the page marks its songs "shared" from it) */
      await page.evaluate(() => { PPP.app.setSharedFilter('Mine'); });
      await waitFor(() => exists(page, '[data-share-shared="legacyYT0001"]'), 10000);
      ok('it is still in the list of what I shared', await exists(page, '[data-share-shared="legacyYT0001"]'));
      await click(page, '[data-share-shared="legacyYT0001"]');
      await page.waitForSelector('[data-share-dialog] [data-share-post]', { timeout: 8000 });
      await sleep(150);
      const d = await page.evaluate(() => { const b = document.querySelector('[data-share-post]'); return { disabled: !!b.disabled, posted: b.getAttribute('data-posted'), label: b.innerText.trim() }; });
      ok('it can be taken down: the button is "Take down" and is on', !d.disabled && d.posted === 'true' && d.label === ko('Take down'), JSON.stringify(d));
      await click(page, '[data-share-post]');
      const downed = await waitFor(async () => (await text(page, '[data-share-post]')) === ko('Post to Shared Scores'), 10000);
      ok('after the take-down it reads "Post to Shared Scores" again', !!downed);
      const after = await page.evaluate(() => { const b = document.querySelector('[data-share-post]'), n = document.querySelector('[data-share-post-note]'); return { disabled: !!b.disabled, blocked: n.getAttribute('data-blocked'), note: n.innerText.trim() }; });
      ok('and then it is off, with the reason: a new posting is under the rule', after.disabled && after.blocked === 'true' && after.note === ko(REASON), JSON.stringify(after));
      await closeDialog();
      const row = await api(page, 'GET', '/api/shares/legacyYT0001');
      ok('the take-down reached the server', row.status === 200 && row.body.listed === false);
    }

    console.log('\n── 3d. a copy somebody else added keeps the mark ──');
    {
      /* what the page makes for an arrangement of a YouTube song: no YouTube link of its own, the mark (a real score of the page's own, with that source) */
      const plain = await page.evaluate(() => PPP.app.shareScoreOf('song-ok'));
      const made = await api(page, 'POST', '/api/shares', {
        songKey: 'song-elsewhere', title: 'Arranged by someone', composer: '', kind: 'arrangement', youtubeDerived: true,
        score: Object.assign({}, plain, { source: { kind: 'shared', youtubeDerived: true } }), preview: null
      });
      ok('a link is made for it', made.status === 201 && made.body.listed === false, JSON.stringify(made.body).slice(0, 120));
      await page.evaluate(id => PPP.app.openShared({ id: id, title: 'Someone\'s arrangement', owner: 'Teacher', mine: false }), made.body.id);
      const added = await waitFor(() => page.evaluate(() => { const S = PPP.app.state; return S.score && S.score.source && S.score.source.shareId ? S.songId : null; }), 15000);
      ok('it was added to My Songs', !!added, String(added));
      const marked = added && await page.evaluate(id => ({ mark: PPP.app.state.score.source.youtubeDerived === true, derived: PPP.app.youtubeDerivedOf(id) }), added);
      ok('the copy carries the mark, so it is not posted again by whoever added it', !!marked && marked.mark && marked.derived, JSON.stringify(marked));
      const d = added && await openDialog(added);
      ok('and its Post button is off, with the reason', !!d && d.disabled && d.note === ko(REASON), JSON.stringify(d));
      await closeDialog();
      /* a share of a hymn: a YouTube performance link and no mark. Adding it does not make it a YouTube-derived score (a source of kind youtube alone is not one) */
      const hymn = await api(page, 'POST', '/api/shares', {
        songKey: 'song-hymn-elsewhere', title: 'A hymn with a performance', composer: '', kind: 'youtube',
        score: Object.assign({}, plain, { title: 'A hymn with a performance', source: { kind: 'youtube', url: WATCH, youtubeId: 'dQw4w9WgXcQ' } }), preview: null
      });
      ok('a link is made for the hymn', hymn.status === 201, JSON.stringify(hymn.body).slice(0, 100));
      await page.evaluate(id => PPP.app.openShared({ id: id, title: 'A hymn with a performance', owner: 'Teacher', mine: false }), hymn.body.id);
      const addedHymn = await waitFor(() => page.evaluate(() => { const S = PPP.app.state; return S.score && S.score.title === 'A hymn with a performance' ? S.songId : null; }), 15000);
      ok('it was added to My Songs', !!addedHymn, String(addedHymn));
      const hymnState = addedHymn && await page.evaluate(id => ({ mark: PPP.app.state.score.source.youtubeDerived === true, kind: PPP.app.state.score.source.kind, derived: PPP.app.youtubeDerivedOf(id) }), addedHymn);
      ok('it carries no mark and is not YouTube-derived', !!hymnState && !hymnState.mark && hymnState.kind === 'youtube' && hymnState.derived === false, JSON.stringify(hymnState));
      const dh = addedHymn && await openDialog(addedHymn);
      ok('its Post button is on', !!dh && !dh.disabled && dh.blocked === 'false', JSON.stringify(dh));
      await closeDialog();
    }

    console.log('\n── 3f. an arrangement made by the page\'s own arranger ──');
    {
      const made = await page.evaluate(async () => {
        const run = async id => {
          PPP.app.openSongArranger(id);
          await new Promise(r => setTimeout(r, 250));
          const before = PPP.app.libraryRead().songs.map(s => s.id);
          const saved = await PPP.app.saveSongArrangement({ level: 'intermediate', style: 'balanced' }, null, null);
          await new Promise(r => setTimeout(r, 400));
          const fresh = PPP.app.libraryRead().songs.find(s => !before.includes(s.id));
          const d = fresh ? PPP.app.readSong(fresh.id) : null;
          const src = d && d.score && d.score.source ? d.score.source : null;
          return { saved: saved, id: fresh ? fresh.id : null, from: fresh ? fresh.arrangedFrom : null, kind: src && src.kind, mark: !!src && src.youtubeDerived === true, ownYoutube: !!src && !!src.youtubeId };
        };
        const yt = await run('song-yt');
        const plain = await run('song-ok');
        return { yt: yt, plain: plain, derivedYt: yt.id ? PPP.app.youtubeDerivedOf(yt.id) : null, derivedPlain: plain.id ? PPP.app.youtubeDerivedOf(plain.id) : null };
      });
      ok('the arrangement of a YouTube song was saved as an arrangement of it', made.yt.saved === true && made.yt.from === 'song-yt' && made.yt.kind === 'arrangement', JSON.stringify(made.yt));
      ok('it has no YouTube link of its own, and carries the mark', !made.yt.ownYoutube && made.yt.mark && made.derivedYt === true, JSON.stringify(made.yt));
      ok('the arrangement of an ordinary song has no mark', made.plain.saved === true && made.plain.from === 'song-ok' && !made.plain.mark && made.derivedPlain === false, JSON.stringify(made.plain));
      const d = await openDialog(made.yt.id);
      ok('and its Post button is off', d.disabled && d.note === ko(REASON), JSON.stringify(d));
      await closeDialog();
    }

    ok('no page errors', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));
    await ctx.close();
  } catch (e) {
    errors.push('threw: ' + (e && e.stack || e));
    console.log('  ✗ threw: ' + (e && e.stack || e));
  } finally {
    await browser.close();
    await srv.close();
    try { fs.rmSync(data, { recursive: true, force: true }); } catch (e) { /* stays */ }
  }
  console.log('\n' + (errors.length ? 'FAILED: ' + errors.length + '\n  ' + errors.join('\n  ') : 'notices UI passed'));
  process.exit(errors.length ? 1 : 0);
})();
