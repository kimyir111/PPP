/* G13-S1: a first sync of 500 songs in a real browser, with the clock moved (a page of this suite adds `window.__skew` to Date.now, and the harness moves the service's
   clock by the same): 234 items in the first hour, 234 in the next, the rest in the third; the section says how long it will take; practice is not held (the page answers
   during it); and the second device reads 300 an hour. Prints the timings (work done here, not the library's waits). Not in the gate: ~1 minute. */
'use strict';
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const { startHarness } = require('./harness.js');

process.env.PPP_PORT_RANGE = process.env.PPP_PORT_RANGE || '10850-10899';
const REPO = path.resolve(__dirname, '..', '..');
const KO = JSON.parse(fs.readFileSync(path.join(REPO, 'i18n', 'ko-KR.json'), 'utf8')).content;
const errors = [];
let passed = 0;
const ok = (name, cond, detail) => { console.log((cond ? '  ✓ ' : '  ✗ ') + name + (detail ? ' — ' + detail : '')); if (cond) passed++; else errors.push(name + (detail ? ' — ' + detail : '')); };
const ko = key => { const v = KO[key]; return typeof v === 'string' ? v : '⟨no Korean: ' + key + '⟩'; };
const HOUR = 3600 * 1000;
const N = Number(process.env.PPP_SYNC_BIG) || 500;

(async () => {
  const H = await startHarness({});
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const allRequests = [], pageErrors = [];
  try {
    const BL = require('./browser-lib.js').make({ browser: browser, pageUrl: H.pageUrl, ko: ko, allRequests: allRequests, pageErrors: pageErrors, mutant: null, repo: REPO });
    const t0 = Date.now();
    const SONGS = await BL.prepSongs(N, true);
    console.log('    (' + N + ' songs made by the page\'s importer in ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s)');
    const A = await BL.newDevice('A', { cards: SONGS.cards, slots: SONGS.slots, skew: true });
    await A.open('?sync=on');
    await A.settings();
    const bytes = JSON.stringify(await A.ls()).length;
    console.log('    (the browser holds ' + (bytes / 1048576).toFixed(1) + ' MB of PPP data)');
    const rounds = [];
    let tStart = Date.now();
    await A.click('[data-sync-on]');
    await BL.waitFor(() => A.exists('[data-sync-link]'), 15000);
    const CODE = (await A.value('[data-sync-link]')).split('#lib=')[1];
    await A.click('[data-sync-recovery-saved]');
    for (let r = 0; r < 5; r++) {
      /* wait until this hour's room is spent (phase waiting) or everything is sent */
      const s = await BL.waitFor(async () => { const x = await A.status(); return x && x.on && (x.phase === 'waiting' || (x.phase === 'idle' && x.songs.left === 0 && x.songs.pending === 0 && x.lastSyncAt)) ? x : null; }, 60000);
      rounds.push({ round: r + 1, ms: Date.now() - tStart, done: s ? s.songs.done : -1, phase: s ? s.phase : 'timeout', etaH: s ? Math.round(s.songs.etaMs / HOUR) : -1 });
      if (!s || s.songs.left === 0) break;
      /* the page is usable meanwhile: a tap on the section answers at once */
      const tt = Date.now();
      await A.settings();
      rounds[rounds.length - 1].uiMs = Date.now() - tt;
      rounds[rounds.length - 1].text = await A.text('[data-sync-status]');
      await A.page.evaluate(ms => { window.__skew += ms; }, HOUR + 1000);
      H.advance(HOUR + 1000);
      tStart = Date.now();
      await A.engine();
    }
    rounds.forEach(r => console.log('    round ' + r.round + ': ' + r.done + ' of ' + N + ' songs, ' + r.phase + ', ' + (r.ms / 1000).toFixed(1) + ' s of work' + (r.etaH >= 0 ? ', "about ' + r.etaH + ' h left"' : '') + (r.uiMs !== undefined ? ', the page answered in ' + r.uiMs + ' ms' : '')));
    ok('the first hour sends the room it has (about 234 items) and says it will take hours', rounds[0].phase === 'waiting' && rounds[0].done >= 220 && rounds[0].done <= 240 && rounds[0].etaH >= 1, JSON.stringify(rounds[0]));
    ok('the text says how many are synced and about how long the rest takes', /\d+곡 중 \d+곡|\d+/.test(rounds[0].text || '') && /시간/.test(rounds[0].text || ''), rounds[0].text);
    ok('the page answers while it waits (the section opens in under 2 s)', rounds[0].uiMs < 2000, String(rounds[0].uiMs));
    ok('three hours at the most; all ' + N + ' are in the library', rounds.length <= 4 && rounds[rounds.length - 1].done === N, JSON.stringify(rounds.map(r => r.done)));
    const L1 = await H.list(CODE);
    ok('the library holds ' + N + ' songs and the state', L1.items.length === N + 1, String(L1.items.length));
    ok('and it never refused a write (it stayed under 240 an hour)', !H.syncSeen.some(x => x.faulted) && H.svc._state.window().refused.too_many === undefined, JSON.stringify(H.svc._state.window().refused));

    /* the second device */
    const B = await BL.newDevice('B', { skew: true });
    await B.open('?sync=on#lib=' + CODE);
    await BL.waitFor(() => B.exists('[data-sync-join-box]'), 15000);
    const tB = Date.now();
    await B.click('[data-sync-join-yes]');
    const reads = [];
    let reads0Text = '';
    for (let r = 0; r < 5; r++) {
      await BL.waitFor(async () => { const c = await B.cards(); const s = await B.status(); return (c.length >= N || (s && s.error === 'busy')) ? true : null; }, 60000);
      reads.push({ songs: (await B.cards()).length, ms: Date.now() - tB, error: (await B.status() || {}).error });
      if (r === 0) { await B.settings(); reads0Text = await B.text('[data-sync-status]'); }
      if (reads[reads.length - 1].songs >= N) break;
      await B.page.evaluate(ms => { window.__skew += ms; }, HOUR + 1000);
      H.advance(HOUR + 1000);
      await B.page.evaluate(() => PPP.app._sync.engine.forceWake ? PPP.app._sync.engine.forceWake() : PPP.app._sync.engine.syncNow('test'));
    }
    console.log('    second device: ' + reads.map(r => r.songs + ' songs after ' + (r.ms / 1000).toFixed(1) + ' s').join(', '));
    ok('the second device reads 300 songs an hour: ' + N + ' songs in two hours', reads[reads.length - 1].songs === N && reads.length <= 3, JSON.stringify(reads));
    ok('the first read says how many songs of the library it has (and how long the rest takes), not just "busy"', reads[0].songs >= 290 && reads[0].error === 'busy' && /^\d+곡 중 \d+곡/.test(reads0Text || ''), reads0Text);
    ok('no page error', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));
  } finally {
    try { await browser.close(); } catch (e) { /* gone */ }
    await H.close();
  }
  if (errors.length) { console.error('\n' + errors.length + ' failed (' + passed + ' passed)'); errors.forEach(e => console.error('  - ' + e)); process.exit(1); }
  console.log('\n' + passed + ' passed: a first sync of ' + N + ' songs');
})().catch(e => { console.error(e); process.exit(1); });
