/* The build stamp: the server puts the commit it runs (Render's RENDER_GIT_COMMIT, or PPP_BUILD) in the page as window.PPP_BUILD, and the Song Arranger
   writes it on the copy it makes ("... · build abc1234"), so a screenshot of a song says which build made it (an old saved copy keeps its old rests,
   and "it is still the same" could not be told from a stale copy before). Without a build id nothing is stamped. */
'use strict';
const puppeteer = require('puppeteer');
const http = require('http');
const { startServer } = require('./serve-free');
const { preparePage } = require('./boot');
const path = require('path');
const sleep = ms => new Promise(r => setTimeout(r, ms));
let failed = 0;
const ok = (name, cond, detail) => { console.log((cond ? '  ✓ ' : '  ✗ ') + name + (detail ? ' — ' + detail : '')); if (!cond) failed++; };
const get = (port, p) => new Promise((res, rej) => http.get({ host: '127.0.0.1', port: port, path: p }, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res({ status: r.statusCode, body: d })); }).on('error', rej));

async function makeCopy(browser, url) {
  const page = await browser.newPage();
  await preparePage(page);
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForFunction(() => !!(window.PPP && window.PPP.app), { timeout: 30000 });
  const build = await page.evaluate(() => window.PPP_BUILD || null);
  await page.evaluate(() => window.__pppTest.nav('My Songs')); await sleep(300);
  await page.evaluate(() => document.querySelector('[data-add-card]').click()); await sleep(300);
  await (await page.$('input[type=file][data-add-file]')).uploadFile(path.resolve(__dirname, '..', 'catalog/hymns/all-creatures.musicxml'));
  await page.waitForFunction(() => window.PPP.app.state.score && window.PPP.app.state.score.id !== 'demo' && window.PPP.app.state.screen !== 'analysis-pending', { timeout: 30000 });
  await sleep(1200);
  const songId = await page.evaluate(() => window.PPP.app.state.songId);
  await page.evaluate(() => window.__pppTest.nav('My Songs')); await sleep(500);
  await page.evaluate(i => document.querySelector('[data-arrange-song="' + i + '"]').click(), songId); await sleep(400);
  await page.select('[data-song-arrange-level]', 'intermediate');
  await page.click('[data-create-song-arrangement]');
  await page.waitForFunction(() => !document.querySelector('[data-song-arranger]'), { timeout: 90000 });
  const composer = await page.evaluate(() => { const lib = window.PPP.app.libraryRead(); const s = lib.songs.find(x => x.kind === 'arrangement'); return s && s.composer; });
  await page.close();
  return { build, composer };
}

(async () => {
  const browser = await puppeteer.launch({ headless: 'new' });
  try {
    const withId = await startServer({ env: { PPP_BUILD: 'abc1234', RENDER_GIT_COMMIT: '' } });
    const html = (await get(withId.port, '/')).body;
    ok('the page carries the build id when the server has one', /window\.PPP_BUILD="abc1234"/.test(html));
    ok('and the id is stamped before the app script runs (right after the charset)', html.indexOf('<script>window.PPP_BUILD=') > -1 && html.indexOf('<script>window.PPP_BUILD=') < 400);
    const a = await makeCopy(browser, 'http://127.0.0.1:' + withId.port + '/');
    ok('the page exposes window.PPP_BUILD', a.build === 'abc1234', String(a.build));
    ok('a Song Arranger copy says which build made it', /build abc1234/.test(a.composer || ''), a.composer);
    await withId.close();

    const without = await startServer({ env: { PPP_BUILD: '', RENDER_GIT_COMMIT: '' } });
    const html2 = (await get(without.port, '/')).body;
    ok('with no build id nothing is injected', !/<script>window.PPP_BUILD=/.test(html2));
    const b = await makeCopy(browser, 'http://127.0.0.1:' + without.port + '/');
    ok('and the copy carries no build tag', !/build /.test(b.composer || ''), b.composer);
    await without.close();
  } finally { await browser.close(); }
  console.log(failed ? '\n' + failed + ' FAILED' : '\nall passed');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
