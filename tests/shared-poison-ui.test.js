/* G13 no login (the review of PR 275): ONE anonymous post must not freeze Shared Scores for everybody. The preview of a share is a mini score that the page's engraver DRAWS, and an
   engraver that loops over staves or staff is hung by 1e6 there. Three ways it could still arrive are driven in a real browser, each with a time budget (a hung page is a FAILURE here,
   not a stuck test: the page is asked "are you there?" and the browser is killed when it does not answer):

     1. rows stored with poisoned previews (staves 1e6, a note on staff 1e6, staves "1000000") - what an old row, or a store this code does not control, could hold: the server
        hands the list out rebuilt, and the screen draws within the budget
     2. the SAME poison arriving at the page itself (the answer of /api/shares rewritten on the way): the page's own rebuilding (thumbSafe) must hold on its own
     3. a link whose SCORE (not its preview) is poisoned: the card of the link draws its first bars, and adding it to My Songs and opening it works (scoreSafe)

   PPP_PAGE_MUTANT='[["from","to"], ...]' serves the page with those replacements (tests/guest-post.mutants.js G1, G4: the page's defences broken one at a time must make this fail).
   node tests/shared-poison-ui.test.js */
'use strict';
const puppeteer = require('puppeteer');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { startServer } = require('./serve-free');

const errors = [];
const ok = (name, cond, detail) => {
  console.log((cond ? '  ✓ ' : '  ✗ ') + name + (detail ? ' — ' + detail : ''));
  if (!cond) errors.push(name + (detail ? ' — ' + detail : ''));
};
const PREVIEWS = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'guest-previews.json'), 'utf8'));
const MUTANT = process.env.PPP_PAGE_MUTANT ? JSON.parse(process.env.PPP_PAGE_MUTANT) : null;
const BUDGET = 8000;
const DAY = 86400000;

const poisonRow = (id, title, mutate, score) => {
  const p = JSON.parse(JSON.stringify(PREVIEWS['prelude-fragment']));
  mutate(p);
  const sc = JSON.parse(JSON.stringify(PREVIEWS['prelude-fragment']));
  if (score) score(sc);
  return { id: id, ownerId: 'g_' + crypto.createHash('sha256').update(id).digest('hex').slice(0, 24), ownerName: 'Guest', songKey: id, title: title, composer: 'Poison', genre: '', kind: '',
    measures: 2, listed: true, preview: p, score: sc, bytes: 4000, addrTag: null, createdAt: new Date().toISOString(), updatedAt: new Date(Date.now() - 1000).toISOString(),
    expiresAt: new Date(Date.now() + 60 * DAY).toISOString() };
};
const alive = (page, ms) => Promise.race([page.evaluate(() => 1).then(() => true, () => false), new Promise(r => setTimeout(() => r(false), ms))]);

function fetchRaw(url, headers) {
  return new Promise((resolve, reject) => {
    http.get(url, { headers: headers || {} }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    }).on('error', reject);
  });
}

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ppp-poison-ui-'));
  const rows = [
    poisonRow('poisonA00001', 'Poison A staves 1e6', p => { p.staves = 1e6; }),
    poisonRow('poisonA00002', 'Poison B staff 1e6', p => { p.notes[0].staff = 1e6; p.notes[1].staff = 1e6; }),
    poisonRow('poisonA00003', 'Poison C staves string', p => { p.staves = '1000000'; }),
    poisonRow('poisonA00004', 'Poison D time 1e7', p => { p.measures[0].time.beats = 1e7; p.notes[0].voice = 1e9; p.notes[0].dots = 1e6; }),
    poisonRow('poisonL00001', 'Poison Linked score', p => { void p; }, sc => { sc.staves = 1e6; sc.notes.forEach(n => { n.staff = 1e6; }); })
  ];
  fs.writeFileSync(path.join(dir, 'shares.json'), JSON.stringify({ shares: rows }));
  const srv = await startServer({ env: { PPP_DATA_DIR: dir } });
  const base = srv.url.replace(/\/Piano%20Coach%20App\.dc\.html$/, '').replace(/\/+$/, '');
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const die = async why => {
    errors.push(why);
    console.log('  ✗ ' + why);
    try { browser.process().kill('SIGKILL'); } catch (e) { /* gone */ }
    try { await srv.close(); } catch (e) { /* gone */ }
    console.log('\n' + errors.length + ' PROBLEM(S): the page did not answer within ' + BUDGET + ' ms');
    process.exit(1);
  };
  try {
    const open = async (intercept) => {
      const ctx = await browser.createBrowserContext();
      const page = await ctx.newPage();
      await page.evaluateOnNewDocument(() => { try { localStorage.setItem('ppp-locale', 'en-US'); } catch (e) { /* none */ } });
      await page.setViewport({ width: 1280, height: 900 });
      page.on('pageerror', e => { errors.push('[pageerror] ' + String(e.message).slice(0, 140)); });
      if (intercept || MUTANT) {
        await page.setRequestInterception(true);
        page.on('request', async r => {
          try {
            const u = new URL(r.url());
            const isPage = r.method() === 'GET' && r.resourceType() === 'document' && (u.pathname === '/' || /Piano%20Coach|Piano Coach/.test(u.pathname));
            if (isPage && MUTANT) {
              const got = await fetchRaw(r.url(), { 'accept': 'text/html' });
              let text = got.body.toString('utf8').replace(/\r\n/g, '\n');
              MUTANT.forEach(([a, b]) => { if (text.indexOf(a) < 0) throw new Error('the mutant text is not in the page: ' + a.slice(0, 60)); text = text.replace(a, b); });
              return r.respond({ status: 200, contentType: 'text/html; charset=utf-8', body: text });
            }
            if (intercept && r.method() === 'GET' && u.pathname === '/api/shares') {
              const got = await fetchRaw(r.url());
              const j = JSON.parse(got.body.toString('utf8'));
              (j.shares || []).forEach((s, i) => {
                const p = JSON.parse(JSON.stringify(PREVIEWS['prelude-fragment']));
                if (i % 3 === 0) p.staves = 1e6; else if (i % 3 === 1) p.notes[0].staff = 1e6; else p.staves = '1000000';
                s.preview = p;
              });
              return r.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(j) });
            }
          } catch (e) { errors.push('[interceptor] ' + String(e.message).slice(0, 140)); }
          r.continue();
        });
      }
      return { ctx, page };
    };
    const waitCards = (page, n) => page.waitForFunction(k => document.querySelectorAll('[data-shared]').length >= k, { timeout: 20000 }, n).then(() => true, () => false);

    console.log('\n── 1. rows stored with poison: the list is handed out rebuilt, and drawn ──');
    {
      const { ctx, page } = await open(false);
      await page.goto(base + '/', { waitUntil: 'networkidle2', timeout: 60000 });
      await page.waitForFunction(() => !!(window.PPP && window.PPP.app), { timeout: 30000 });
      page.evaluate(() => window.PPP.app.go('shared')()).catch(() => {});
      if (!(await alive(page, BUDGET))) return die('1. the Shared Scores screen did not answer (rows stored with poison)');
      const cards = await waitCards(page, 4);
      if (!(await alive(page, BUDGET))) return die('1. the page stopped answering while it drew the list');
      const drawn = await page.evaluate(() => document.querySelectorAll('[data-shared] svg').length);
      ok('the screen shows the poisoned rows as cards, and the page answers', cards);
      ok('their previews are drawn (an svg in the cards)', drawn >= 1, String(drawn));
      await ctx.close();
    }

    console.log('\n── 2. the same poison arriving at the page: its own rebuilding holds ──');
    {
      const { ctx, page } = await open(true);
      await page.goto(base + '/', { waitUntil: 'networkidle2', timeout: 60000 });
      await page.waitForFunction(() => !!(window.PPP && window.PPP.app), { timeout: 30000 });
      page.evaluate(() => window.PPP.app.go('shared')()).catch(() => {});
      if (!(await alive(page, BUDGET))) return die('2. the Shared Scores screen did not answer (poison arriving at the page)');
      const cards = await waitCards(page, 4);
      if (!(await alive(page, BUDGET))) return die('2. the page stopped answering while it drew a list of poisoned previews');
      const drawn = await page.evaluate(() => document.querySelectorAll('[data-shared] svg').length);
      ok('the page answers and shows the cards', cards);
      ok('and draws the previews (rebuilt)', drawn >= 1, String(drawn));
      await ctx.close();
    }

    console.log('\n── 3. a link whose score is poisoned: its card, adding it, opening it ──');
    {
      const { ctx, page } = await open(false);
      await page.goto(base + '/?share=poisonL00001', { waitUntil: 'networkidle2', timeout: 60000 });
      await page.waitForFunction(() => !!(window.PPP && window.PPP.app), { timeout: 30000 });
      if (!(await alive(page, BUDGET))) return die('3. the page did not answer on the link of a poisoned score');
      await page.waitForFunction(() => !!document.querySelector('[data-shared-linked] [data-open-shared]'), { timeout: 20000 }).catch(() => {});
      if (!(await alive(page, BUDGET))) return die('3. the page stopped answering while it drew the card of the link');
      ok('the card of the link is there', await page.evaluate(() => !!document.querySelector('[data-shared-linked] [data-open-shared]')));
      page.evaluate(() => { const b = document.querySelector('[data-shared-linked] [data-open-shared]'); if (b) b.click(); }).catch(() => {});
      await page.waitForFunction(() => window.PPP.app.state.screen === 'player', { timeout: 20000 }).catch(() => {});
      if (!(await alive(page, BUDGET))) return die('3. the page stopped answering after the poisoned score was added and opened');
      const st = await page.evaluate(() => ({ screen: window.PPP.app.state.screen, staves: window.PPP.app.state.score.staves, staffs: Math.max.apply(null, window.PPP.app.state.score.notes.map(n => n.staff || 1)) }));
      ok('it was added and is open, with its staves bounded (1..8)', st.screen === 'player' && st.staves >= 1 && st.staves <= 8 && st.staffs <= 8, JSON.stringify(st));
      await ctx.close();
    }
    ok('no page error in any of it', !errors.some(e => /^\[pageerror\]/.test(e)), errors.filter(e => /^\[pageerror\]/.test(e)).slice(0, 2).join(' | '));
  } finally {
    await browser.close().catch(() => {});
    await srv.close();
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* temp */ }
  }
  console.log('\n────────────────────────────────────────');
  if (errors.length) {
    console.log(errors.length + ' PROBLEM(S):');
    [...new Set(errors)].forEach(e => console.log('  ✗ ' + e));
    process.exit(1);
  }
  console.log('One poisoned post does not freeze Shared Scores: not stored, not handed out, not drawn.');
})().catch(e => { console.error('HARNESS FAILURE:', e); process.exit(2); });
