/* G13-S1: Settings > "Sync between devices (beta)" in real browsers (puppeteer; the harness of tests/sync-page/harness.js: this tree's page, the song-library service of
   sync.js with a counting store and a clock this suite moves; every screen in Korean, read from i18n/ko-KR.json).

   Two profiles - two browser contexts, so two localStorages, as two devices have - and a third for the recovery code:
     - the switch is off (the default): not one request of the feature, no entry in Settings, a #lib= in the address is left alone;
     - A turns syncing on with 30 songs: the link, the QR code, the code in groups, the recovery code once (and gone after "I saved it"); the 30 songs and the state are
       in the library; the code was in no URL and in no log;
     - B opens the link: the question comes first (its 5 songs, one of them the same score as one of A's); joined: 30 + its own, the same song once, practice merged;
     - edits converge: A practises, B opens once (and A, B again): the same text; xp is the sum;
     - both change a score while offline: both are kept, with the visible name of a copy, on both devices;
     - 17 songs removed on A are asked about (nothing is sent), "yes", B asks too and "no" keeps them; a single removal needs no question and arrives in Recently deleted,
       and Restore brings it back, also to A;
     - a device that was away 31 days is asked, and "keep" brings its songs back;
     - the library busy (503) and refusing (429, Retry-After): a short wait, no loop, then it goes through;
     - a new code: the other device is told and takes it; the recovery code on a third; stop syncing here; delete the library (asks twice);
     - an idle visit costs the library's store no more than 4 calls;
     - no sync file, no request, no entry with the switch off - and the page's DOM is the one of origin/main's tree (when git can make one).
   On a phone (360 px) nothing of the section overflows. */
'use strict';
const puppeteer = require('puppeteer');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { startHarness } = require('./harness.js');

process.env.PPP_PORT_RANGE = process.env.PPP_PORT_RANGE || '10850-10899';
const REPO = path.resolve(__dirname, '..', '..');
const KO = JSON.parse(fs.readFileSync(path.join(REPO, 'i18n', 'ko-KR.json'), 'utf8')).content;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const errors = [];
let passed = 0;
/* PPP_SYNC_FAILFAST=1: the first failed check ends the run (the mutation runner needs a verdict, not a report); the finally block still closes the browser and the servers */
const FAILFAST = process.env.PPP_SYNC_FAILFAST === '1';
const ok = (name, cond, detail) => {
  console.log((cond ? '  ✓ ' : '  ✗ ') + name + (detail ? ' — ' + detail : ''));
  if (cond) passed++; else { errors.push(name + (detail ? ' — ' + detail : '')); if (FAILFAST) throw new Error('failfast: ' + name); }
};
/* PPP_SYNC_MUTANT={id,file,from,to}: that file (sync/ui.js, sync/client.js, the page ...) is served with one rule broken (tests/sync-page/mutants.js) */
const MUTANT = process.env.PPP_SYNC_MUTANT ? JSON.parse(process.env.PPP_SYNC_MUTANT) : null;
const fill = (s, vars) => String(s).replace(/\{\{(\w+)\}\}/g, (_, k) => (vars && vars[k] != null ? vars[k] : ''));
/* the Korean of an English source string: a string with no Korean fails the suite (it would show English to the person) */
const ko = (key, vars) => {
  const k = String(key).replace(/[‘’]/g, "'").replace(/[“”]/g, '"');
  const v = KO[k] !== undefined ? KO[k] : KO[key];
  if (typeof v !== 'string' || !/[가-힣]/.test(v)) { errors.push('no Korean for: ' + key); return '⟨no Korean: ' + key + '⟩'; }
  return fill(v, vars);
};
const heading = t => console.log('\n── ' + t + ' ──');

(async () => {
  const H = await startHarness({});
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const pageErrors = [];
  const allRequests = [];                       /* every request any page made: method + url */
  try {
    /* ------------------------------------------------------------------ helpers (tests/sync-page/browser-lib.js) */
    const BL = require('./browser-lib.js').make({ browser: browser, pageUrl: H.pageUrl, ko: ko, allRequests: allRequests, pageErrors: pageErrors, mutant: MUTANT, repo: REPO });
    const { waitFor, ready, newDevice } = BL;

    /* ------------------------------------------------------------------ the songs, made by the page's own code */
    heading('preparing 30 songs with the page own importer');
    const SONGS = await BL.prepSongs(30, false);

    ok('30 songs, 5 for B (two of them are A\'s songs under other names)', SONGS.cards.length === 30 && SONGS.bCards.length === 5, 'a song is ' + SONGS.measures + ' measures');

    /* ------------------------------------------------------------------ the switch is off */
    heading('the switch is off (the default): no request of the feature, no entry, an address left alone');
    const OFFCODE = 'ab'.repeat(32);
    {
      const D = await newDevice('off', { cards: SONGS.cards.slice(0, 3), slots: SONGS.slots });
      const n0 = allRequests.length;
      await D.page.goto(H.pageUrl + '#lib=' + OFFCODE, { waitUntil: 'networkidle2', timeout: 60000 });
      await ready(D.page);
      await sleep(1500);
      const gotoOk = await D.nav(ko('Settings'));
      await sleep(1200);
      const mine = allRequests.slice(n0).filter(r => r.startsWith('off '));
      ok('Settings opened and has no sync entry at all', gotoOk && !(await D.exists('[data-sync-mount]')) && !(await D.exists('[data-sync-section]')) && !/동기화 \(베타\)|Sync between devices/.test(await D.page.evaluate(() => document.body.innerText)));
      ok('not one request for sync/ files, /api/libs or /api/sync', !mine.some(r => /\/sync\/|\/api\/libs|\/api\/sync/.test(r)), mine.filter(r => /sync|libs/.test(r)).join(' | '));
      ok('PPP.sync says off, and nothing of the feature is loaded', (await D.page.evaluate(() => PPP.sync + '|' + typeof window.PPPSync + '|' + typeof window.PPPSyncClient)) === 'off|undefined|undefined');
      ok('a #lib= in the address is left alone (the page did not take it)', (await D.page.evaluate(() => location.hash)) === '#lib=' + OFFCODE);
      ok('and no sync key was written', !Object.keys(await D.ls()).some(k => /^ppp\.sync/.test(k)));
      await D.ctx.close();
    }

    heading('with the lazy loader off (PPP.split off) the files come as script tags and the section is the same');
    {
      const D = await newDevice('nosplit', { cards: SONGS.cards.slice(0, 2), slots: SONGS.slots });
      await D.open('?sync=on&split=off');
      ok('the section is in Settings, and PPPSync is there', await D.settings() && (await D.page.evaluate(() => typeof window.PPPSync + '|' + (window.PPP_LAZY ? window.PPP_LAZY.mode : 'none'))) === 'object|off');
      await D.ctx.close();
    }

    /* ------------------------------------------------------------------ A turns it on */
    heading('A turns syncing on with 30 songs');
    const A = await newDevice('A', { cards: SONGS.cards, slots: SONGS.slots, secrets: { pc: 'aa'.repeat(32), guest: 'bb'.repeat(16) }, xp: 100, minutes: 40 });
    await A.open('?sync=on');
    ok('the section is in Settings with the switch on, in Korean', await A.settings() && (await A.text('[data-sync-title]')) === ko('Sync between devices (beta)'));
    const offText = await A.text('[data-sync-section]');
    ok('it says what it does and warns about the code', offText.includes(ko('Anyone who has the code can see and change your songs. Keep it like a password: PPP cannot recover it for you.')) && offText.includes(ko('Turn on syncing')));
    const t0 = Date.now();
    await A.click('[data-sync-on]');
    ok('the code panel opens: the link, the code in groups of 8, the QR picture', await waitFor(() => A.exists('[data-sync-qr] svg'), 10000) && /^http:\/\/127\.0\.0\.1:\d+\/\?sync=on#lib=[0-9a-f]{64}$/.test(await A.value('[data-sync-link]')) && /^([0-9a-f]{8} ){7}[0-9a-f]{8}$/.test(await A.text('[data-sync-code-text]')));
    const link = await A.value('[data-sync-link]');
    const CODE = link.split('#lib=')[1];
    const RECOVERY = await A.value('[data-sync-recovery-value]');
    ok('the recovery code is shown, another secret', /^[0-9a-f]{64}$/.test(RECOVERY) && RECOVERY !== CODE);
    ok('and the QR picture is a picture of the link (the encoder\'s own symbol)', await A.page.evaluate(() => { const s = document.querySelector('[data-sync-qr] svg'); return !!s && /viewBox="0 0 \d+ \d+"/.test(s.outerHTML) && s.querySelector('path') && s.querySelector('path').getAttribute('d').length > 200; }));
    ok('the warning says it in Korean, and the section holds no English sentence', (await A.text('[data-sync-warning]')) === ko('Anyone who has this code can see and change your songs. Keep it like a password: PPP cannot recover it for you.'));
    await A.click('[data-sync-recovery-saved]');
    ok('"I saved it" makes the recovery code go: not in the page, not in the session', !(await A.exists('[data-sync-recovery-box]')) && !(await A.page.evaluate(() => sessionStorage.getItem('ppp.sync.rc'))));
    const first = await A.synced(60000);
    const firstMs = Date.now() - t0;
    ok('30 songs are synced (the first sync of 30 songs: ' + (firstMs / 1000).toFixed(1) + ' s)', !!first && first.songs.total === 30 && first.songs.done === 30, JSON.stringify(first && first.songs));
    const L1 = await H.list(CODE);
    ok('the library holds 30 songs and the state', L1.status === 200 && L1.items.length === 31 && L1.items.filter(i => /^song:song-pa/.test(i.key)).length === 30 && L1.items.some(i => i.key === 'state'), String(L1.items.length));
    ok('"kept until" is shown (180 days after the last sync)', /\d{4}/.test((await A.text('[data-sync-kept]')) || '') && (await A.text('[data-sync-status]')).includes('동기화됨'));
    ok('the status line says synced, in Korean', (await A.text('[data-sync-status]')) === ko('Synced {{when}}', { when: ko('just now') }) || /^동기화됨 · /.test(await A.text('[data-sync-status]')));
    const lsA = await A.ls();
    ok('the page remembers the switch on this device, and the state holds the code', lsA['ppp.sync.v1'] === 'on' && JSON.parse(lsA['ppp.syncstate.v1']).code === CODE);
    ok('"Delete everything" in Settings says that the code of the library goes with it (and that the library stays on the server)', (await A.text('[data-wipe-row]') || '').includes(ko('The code of your synced song library is removed from this browser too, so keep it if you want to use the library again. The library itself stays on the server until you delete it.')));
    ok('a backup of A has neither the code nor the PC link nor the guest key', await A.page.evaluate(async () => {
      const B = window.PPPBackup, f = B.build(localStorage, {}), s = JSON.stringify(f);
      const st = JSON.parse(localStorage.getItem('ppp.syncstate.v1'));
      return s.indexOf(st.code) < 0 && s.indexOf('aa'.repeat(32)) < 0 && s.indexOf('bb'.repeat(16)) < 0;
    }));
    const texts = await H.itemTexts(CODE);
    ok('and no item of the library holds the PC link, the guest key or the code itself (' + texts.length + ' items read back)', texts.length === 31 && texts.every(s => s.indexOf('aa'.repeat(32)) < 0 && s.indexOf('bb'.repeat(16)) < 0 && s.indexOf(CODE) < 0), String(texts.length));

    /* ------------------------------------------------------------------ B opens the link */
    heading('B opens the link: the question first, then the library comes and its own songs are added');
    const B = await newDevice('B', { cards: SONGS.bCards, slots: SONGS.bSlots, xp: 30, minutes: 5 });
    const calls0 = H.store.total();
    await B.page.goto(link, { waitUntil: 'networkidle2', timeout: 60000 });
    await ready(B.page);
    ok('the fragment is off the address bar at once', (await B.page.evaluate(() => location.hash)) === '' && !(await B.page.evaluate(() => location.href)).includes(CODE));
    ok('Settings opens on its own with the question', await waitFor(() => B.exists('[data-sync-join-box]'), 15000));
    const q = await B.text('[data-sync-join-box]');
    ok('the question says how many songs of its own will be added and that nothing is removed', q.includes(ko('Join this song library?')) && q.includes(ko('Your {{n}} songs on this device will be added to it. The same song becomes one song and your practice is merged. Nothing on this device is removed or replaced.', { n: 5 })), q.slice(0, 200));
    ok('nothing has been sent or taken before the answer', !B.page.url().includes(CODE) && !(await B.ls())['ppp.syncstate.v1'] && !H.syncSeen.some(x => x.hasCode && /^GET \/api\/sync/.test(x.method + ' ' + x.url) && x.at > Date.now() - 400000 && false));
    await B.click('[data-sync-join-yes]');
    const bs = await B.synced(60000);
    ok('B is synced', !!bs, JSON.stringify(bs && bs.songs));
    const bc = await B.cards();
    ok('B has the 30 songs of A and its 3 own, and the 2 songs that were A\'s are not doubled', bc.length === 33 && bc.filter(c => c.title === 'Song 5').length === 1 && bc.filter(c => c.title === 'Song 6').length === 1, bc.length + ' songs');
    const ac1 = (await H.list(CODE)).items;
    ok('the library has 33 songs now (A\'s 30 and B\'s 3), under the names the library knows', ac1.filter(i => /^song:/.test(i.key)).length === 33, String(ac1.length));
    const xpB = await B.page.evaluate(() => PPP.app.state.xp + '/' + PPP.app.state.minutes);
    ok('B\'s xp and minutes are the sum of both devices (100 + 30, 40 + 5)', xpB === '130/45', xpB);
    await A.engine();
    const ac2 = await A.cards();
    ok('A has B\'s three songs too, and 33 in all', ac2.length === 33 && ac2.some(c => c.title === 'Mine 0'), ac2.length + ' songs');
    ok('A\'s xp is the same sum', (await A.page.evaluate(() => PPP.app.state.xp + '/' + PPP.app.state.minutes)) === '130/45');

    /* ------------------------------------------------------------------ edits converge */
    heading('edits converge after at most two opens');
    await A.page.evaluate(() => {
      const raw = localStorage.getItem('ppp.song.v1.song-pa7'); const s = JSON.parse(raw);
      s.history.byMeasure['2'] = { m: 2, attempts: 9, lastAt: 777777 }; s.memLevel = 3; s.tempo = 77;
      localStorage.setItem('ppp.song.v1.song-pa7', JSON.stringify(s));
      const lib = JSON.parse(localStorage.getItem('ppp.library.v1')); lib.songs.find(c => c.id === 'song-pa7').lastAt = 1800000000000; localStorage.setItem('ppp.library.v1', JSON.stringify(lib));
    });
    await A.engine();                                   /* A's page is hidden or closed: its flush */
    await B.engine();                                   /* B opens once */
    const b7 = await B.page.evaluate(() => JSON.parse(localStorage.getItem('ppp.song.v1.song-pa7')));
    ok('after one open of B: A\'s practice is there (measure 2, memLevel 3, tempo 77)', b7.history.byMeasure['2'] && b7.history.byMeasure['2'].attempts === 9 && b7.memLevel === 3 && b7.tempo === 77);
    const a7 = await A.page.evaluate(() => JSON.parse(localStorage.getItem('ppp.song.v1.song-pa7')));
    ok('and it is the same text on both devices', JSON.stringify(a7.history) === JSON.stringify(b7.history));

    /* ------------------------------------------------------------------ both change a score while offline */
    heading('both devices change one score while offline: both are kept');
    await A.page.setOfflineMode(true); await B.page.setOfflineMode(true);
    const e0 = JSON.parse(SONGS.edited[0]), e1 = JSON.parse(SONGS.edited[1]);
    const putScore = (dev, id, slot) => dev.page.evaluate((i, sj) => {
      const s = JSON.parse(localStorage.getItem('ppp.song.v1.' + i)); const n = JSON.parse(sj);
      s.score = n.score; localStorage.setItem('ppp.song.v1.' + i, JSON.stringify(s));
    }, id, JSON.stringify(slot));
    await putScore(A, 'song-pa9', e0);
    await sleep(1100);
    await putScore(B, 'song-pa9', e1);
    await A.engine();                                   /* offline: nothing goes, nothing breaks */
    ok('offline: it says there is no connection and keeps both edits', (await A.status()).error === 'offline');
    await A.page.setOfflineMode(false); await B.page.setOfflineMode(false);
    await A.engine();                                   /* A sends its edit */
    await B.engine(); await B.engine();                 /* B meets it: the newer stays, the other is a copy */
    await A.engine();
    const titlesB = (await B.cards()).map(c => c.title), titlesA = (await A.cards()).map(c => c.title);
    const copyName = ko('{{title}} (copy from another device)', { title: 'Song 9' });
    ok('both devices have 34 songs: one is a copy, with the visible name of a copy', titlesB.length === 34 && titlesA.length === 34 && titlesB.includes(copyName) && titlesA.includes(copyName), titlesB.filter(t => /Song 9/.test(t)).join(' | '));
    /* which device sees the clash first depends on who looked first: the song is one of the two edits on both, the copy is the other, the notice is on the device that made it */
    const scoreTitleOf = (d, id) => d.page.evaluate(i => { const s = localStorage.getItem('ppp.song.v1.' + i); return s ? JSON.parse(s).score.title : null; }, id);
    const copyIdB = (await B.cards()).find(c => c.title === copyName).id;
    const songTitles = [await scoreTitleOf(A, 'song-pa9'), await scoreTitleOf(B, 'song-pa9')];
    const copyTitles = [await scoreTitleOf(A, copyIdB), await scoreTitleOf(B, copyIdB)];
    ok('both devices agree on the song, and on the copy, and these are the two edits (nothing is lost)', songTitles[0] === songTitles[1] && copyTitles[0] === copyTitles[1] && [songTitles[0], copyTitles[0]].sort().join() === 'Edited 200,Edited 201', JSON.stringify([songTitles, copyTitles]));
    await A.settings();
    const noteA = (await A.text('[data-sync-notices]')) || '';
    await B.settings();
    const noteB = (await B.text('[data-sync-notices]')) || '';
    ok('the device that kept both versions says so, in Korean', noteA.includes('두 기기에서') || noteB.includes('두 기기에서'), noteA + ' | ' + noteB);

    /* ------------------------------------------------------------------ 17 removals */
    heading('17 removals are asked about; one is not; Recently deleted brings a song back');
    const ids17 = Array.from({ length: 17 }, (_, i) => 'song-pa' + (10 + i));
    for (const id of ids17) await A.remove(id);
    await A.engine();
    await A.settings();
    ok('A asks (and says how many), and has sent no tombstone', await waitFor(() => A.exists('[data-sync-ask="delete-out"]'), 8000) && (await A.text('[data-sync-ask="delete-out"]')).includes(ko('You removed {{n}} songs here. Remove them from your other devices too?', { n: 17 })));
    ok('the library has 0 deletions so far', (await H.list(CODE)).items.filter(i => i.deleted).length === 0);
    await A.click('[data-sync-ask="delete-out"] [data-sync-ask-yes]');
    await A.synced(30000);
    ok('after "yes" the library has 17 tombstones', (await H.list(CODE)).items.filter(i => i.deleted).length === 17);
    await B.engine();
    await B.settings();
    ok('B asks before it removes 17, and removed none', await waitFor(() => B.exists('[data-sync-ask="delete-in"]'), 8000) && (await B.cards()).filter(c => ids17.includes(c.id)).length === 17);
    await B.click('[data-sync-ask="delete-in"] [data-sync-ask-no]');
    await B.engine();
    ok('"keep them on this device" keeps the 17, and the question is gone', (await B.cards()).filter(c => ids17.includes(c.id)).length === 17 && !(await B.exists('[data-sync-ask]')));
    /* one removal needs no question */
    await A.remove('song-pa28');
    await A.engine();
    ok('one removal on A is sent at once, no question', !(await A.exists('[data-sync-ask]')) && (await H.list(CODE)).items.some(i => i.key === 'song:song-pa28' && i.deleted));
    await B.engine();
    ok('and B has removed it too (it is in its Recently deleted)', !(await B.cards()).some(c => c.id === 'song-pa28'));
    await B.settings();
    await B.click('[data-sync-trash]');
    ok('Recently deleted lists it with a Restore button', await waitFor(() => B.exists('[data-sync-trash-row="song-pa28"]'), 8000));
    await B.click('[data-sync-restore="song-pa28"]');
    await B.synced(30000);
    ok('Restore brings it back on B', (await B.cards()).some(c => c.id === 'song-pa28'));
    await A.engine();
    ok('and on A, over the tombstone', (await A.cards()).some(c => c.id === 'song-pa28'));

    /* ------------------------------------------------------------------ the library is busy, or refuses */
    heading('the library busy, then refusing with Retry-After: a wait, no loop, then it goes through');
    await A.page.evaluate(() => {
      const raw = localStorage.getItem('ppp.song.v1.song-pa3'); const s = JSON.parse(raw); s.tempo = 99; localStorage.setItem('ppp.song.v1.song-pa3', JSON.stringify(s));
    });
    H.fail({ method: 'PUT', path: '/api/sync/items', status: 503, code: 'busy', times: 1 });
    const putsBefore = H.syncSeen.filter(x => x.method === 'PUT').length;
    await A.engine();
    const stBusy = await A.status();
    ok('503 busy: it says the server is busy, and waits (the next try is later)', stBusy.error === 'busy' && stBusy.next > Date.now(), JSON.stringify([stBusy.error, stBusy.next - Date.now()]));
    ok('one request, not a loop', H.syncSeen.filter(x => x.method === 'PUT').length - putsBefore === 1);
    await A.engine();                                    /* the page's own button forces; a poll would wait */
    await A.synced(30000);
    ok('and then it goes through', (await A.status()).songs.pending === 0 && (await H.list(CODE)).items.length > 0);
    await A.page.evaluate(() => {
      const s = JSON.parse(localStorage.getItem('ppp.song.v1.song-pa3')); s.tempo = 98; localStorage.setItem('ppp.song.v1.song-pa3', JSON.stringify(s));
    });
    H.fail({ method: 'PUT', path: '/api/sync/items', status: 429, code: 'too-many', retryAfter: 90, times: 1 });
    await A.engine();
    const st429 = await A.status();
    ok('429 with Retry-After 90 s: the wait is at least that long', st429.error === 'busy' && st429.next - Date.now() >= 85000, String(st429.next - Date.now()));
    await A.page.evaluate(() => { const s = JSON.parse(localStorage.getItem('ppp.syncstate.v1')); s.next = 0; localStorage.setItem('ppp.syncstate.v1', JSON.stringify(s)); });
    await A.engine(); await A.synced(30000);

    /* ------------------------------------------------------------------ 31 days away */
    heading('a device away for 31 days is asked before it pushes what the library lost');
    await B.page.goto('about:blank');                   /* B is away */
    await A.remove('song-pa29');
    await A.remove('song-pa0');
    await A.engine(); await A.synced(30000);
    H.advance(31 * 24 * 3600 * 1000);
    await A.page.evaluate(() => { const s = JSON.parse(localStorage.getItem('ppp.song.v1.song-pa4')); s.tempo = 55; localStorage.setItem('ppp.song.v1.song-pa4', JSON.stringify(s)); });
    await A.engine(); await A.synced(30000);
    await B.open('');
    await B.settings();
    await B.engine();
    ok('B is asked about the songs the library no longer has (2), and has removed none', await waitFor(() => B.exists('[data-sync-ask="gone"]'), 15000) && (await B.cards()).some(c => c.id === 'song-pa29') && (await B.cards()).some(c => c.id === 'song-pa0'));
    await B.click('[data-sync-ask="gone"] [data-sync-ask-yes]');
    await B.synced(30000);
    ok('"keep them" sends them to the library as new songs', (await H.list(CODE)).items.some(i => i.key === 'song:song-pa29' && !i.deleted) && (await H.list(CODE)).items.some(i => i.key === 'song:song-pa0' && !i.deleted));

    /* ------------------------------------------------------------------ the store's statements on an idle visit */
    heading('an idle visit costs the library\'s store at most 4 calls');
    await A.synced(30000); await B.synced(30000);
    const idle0 = H.store.total();
    await A.open('');
    await sleep(5000);                                   /* the page's own first cycle is 2.5 s after its load */
    await A.synced(15000);
    await sleep(500);
    const idleCalls = H.store.total() - idle0;
    ok('opening A with nothing changed: ' + idleCalls + ' store calls (≤ 4)', idleCalls <= 4, JSON.stringify(H.store.calls));

    /* ------------------------------------------------------------------ a frozen page */
    heading('a page that is frozen (a restore or a delete is on its way to a reload) is left alone');
    {
      await A.synced(30000);
      await A.page.evaluate(() => { PPP.app.freezeStorage(); });
      const puts0 = H.syncSeen.filter(x => x.method === 'PUT').length, all0 = H.syncSeen.length;
      await A.page.evaluate(() => { const s = JSON.parse(localStorage.getItem('ppp.song.v1.song-pa7')); s.tempo = 33; localStorage.setItem('ppp.song.v1.song-pa7', JSON.stringify(s)); });
      await A.engine();
      ok('frozen: nothing was sent for the change, and no request was made at all', H.syncSeen.filter(x => x.method === 'PUT').length === puts0 && H.syncSeen.length === all0, String(H.syncSeen.length - all0));
      await A.page.evaluate(() => { PPP.app.thawStorage(); });
      await A.engine();
      ok('thawed: the change goes', H.syncSeen.filter(x => x.method === 'PUT').length > puts0);
      await A.synced(30000);
    }

    /* ------------------------------------------------------------------ a new code, the recovery code, stop, delete */
    heading('a new code, the recovery code, stop syncing, delete the library');
    await A.settings();
    await A.click('[data-sync-rotate]');
    ok('changing the code asks first, and says the others must enter the new one', await waitFor(() => A.exists('[data-sync-rotate-box]'), 5000) && (await A.text('[data-sync-rotate-box]')).includes('새 코드'));
    await A.click('[data-sync-rotate-yes]');
    ok('a new code is shown; it is not the old one', await waitFor(() => A.exists('[data-sync-link]'), 10000) && (await A.value('[data-sync-link]')).split('#lib=')[1] !== CODE);
    const CODE2 = (await A.value('[data-sync-link]')).split('#lib=')[1];
    await B.engine();
    ok('B is told the library has a new code, and syncs nothing', await waitFor(async () => (await B.status()).error === 'rotated', 8000) && /새 코드/.test((await B.text('[data-sync-status]')) || ''));
    await B.page.evaluate(() => PPP.app.syncMount());
    await B.type('[data-sync-newcode]', CODE2.slice(0, 32) + ' ' + CODE2.slice(32));
    await B.click('[data-sync-newcode-go]');
    ok('B enters the new code (spaces and all) and is connected again', await waitFor(async () => { const s = await B.status(); return s && !s.error && s.on; }, 10000));
    await B.synced(30000);
    const C = await newDevice('C', { width: 360, height: 800 });
    await C.open('?sync=on');
    await C.settings();
    await C.click('[data-sync-recover-toggle]');
    await C.type('[data-sync-recovery-input]', RECOVERY);
    await C.click('[data-sync-recover]');
    ok('the recovery code gives C the library with a NEW code (and a new recovery code, shown once)', await waitFor(() => C.exists('[data-sync-recovery-value]'), 15000) && (await C.value('[data-sync-recovery-value]')) !== RECOVERY);
    await C.click('[data-sync-recovery-saved]');
    const CODE3 = (await C.value('[data-sync-link]')).split('#lib=')[1];
    ok('C holds a code that is neither of the earlier ones', /^[0-9a-f]{64}$/.test(CODE3) && CODE3 !== CODE && CODE3 !== CODE2);
    await C.synced(60000);
    ok('C received the library: its 34 songs less the 17 that were removed', (await C.cards()).length === 17, String((await C.cards()).length));
    /* a link whose code was typed in groups (spaces, dashes) is read as well */
    {
      const D = await newDevice('grouped');
      await D.page.goto(H.pageUrl + '?sync=on#lib=' + CODE3.replace(/(.{8})(?=.)/g, '$1%20').replace(/%20(.{8})%20/, '-$1-'), { waitUntil: 'networkidle2', timeout: 60000 });
      ok('a link with spaces and dashes between the groups is read: the question comes', await waitFor(() => D.exists('[data-sync-join-box]'), 15000) && (await D.page.evaluate(() => location.hash)) === '');
      await D.ctx.close();
    }
    const overflow = await C.page.evaluate(() => { const s = document.querySelector('[data-sync-section]'); return s ? s.scrollWidth - s.clientWidth : -1; });
    ok('on a 360 px phone the section does not overflow', overflow <= 1 && (await C.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)), String(overflow));
    await A.engine();
    ok('A\'s code is "rotated" by the recovery: it is told, and A enters the new one', await waitFor(async () => (await A.status()).error === 'rotated', 8000));
    await A.page.evaluate(() => PPP.app.syncMount());
    await A.type('[data-sync-newcode]', 'http://127.0.0.1/?sync=on#lib=' + CODE3);
    await A.click('[data-sync-newcode-go]');
    ok('a link pasted instead of a code is read too', await waitFor(async () => { const s = await A.status(); return s && !s.error; }, 10000));
    await A.synced(30000);
    /* stop syncing on B */
    await B.settings();
    await B.click('[data-sync-stop]');
    ok('stopping asks, and says the songs here stay', await waitFor(() => B.exists('[data-sync-stop-box]'), 5000));
    const bBefore = (await B.cards()).length;
    await B.click('[data-sync-stop-yes]');
    ok('B forgot the code and kept every song', !(await B.ls())['ppp.syncstate.v1'] || JSON.parse((await B.ls())['ppp.syncstate.v1']).code === '', String((await B.cards()).length === bBefore));
    ok('and shows the first view again, with a message', await waitFor(() => B.exists('[data-sync-on]'), 5000) && (await B.cards()).length === bBefore);
    /* delete the library (A): two steps */
    await A.settings();
    await A.click('[data-sync-delete]');
    ok('the first question explains', await waitFor(() => A.exists('[data-sync-delete-box="1"]'), 5000));
    await A.click('[data-sync-delete-next]');
    ok('and a second asks for the last time', await waitFor(() => A.exists('[data-sync-delete-box="2"]'), 5000));
    await A.click('[data-sync-delete-yes]');
    await waitFor(async () => !(await A.exists('[data-sync-status]')), 10000);
    const gone = await H.list(CODE3);
    ok('the library is gone from the server (the code is "deleted"), and A keeps its songs', gone.status === 401 && gone.body.code === 'deleted' && (await A.cards()).length === 17, JSON.stringify([gone.status, gone.body && gone.body.code]));
    await C.engine();
    ok('C is told the library was deleted, and keeps its songs', await waitFor(async () => (await C.status()).error === 'deleted', 8000) && (await C.cards()).length === 17);

    /* ------------------------------------------------------------------ the code was in no URL and no log */
    heading('the codes were never in a URL, a log, or a request of any page');
    const codes = [CODE, CODE2, CODE3, RECOVERY];
    const urlHit = codes.filter(c => allRequests.some(r => r.includes(c) && !/#lib=/.test(r) || (r.includes(c) && /^B GET http:\/\/127\.0\.0\.1:\d+\/\?sync=on#lib=/.test(r))));
    /* puppeteer lists the navigation to the link itself (B opened it: the fragment is in that one URL, never on the wire): that one is allowed */
    const wire = allRequests.filter(r => codes.some(c => r.includes(c)) && !/^B GET .*\/\?sync=on#lib=/.test(r));
    ok('no request of any page names a code (the fragment of the link B opened is not sent)', wire.length === 0, wire.slice(0, 2).join(' | '));
    ok('the server saw no code in any URL', !H.urls.some(u => codes.some(c => u.includes(c))) && !H.syncSeen.some(x => codes.some(c => x.url.includes(c))));
    ok('no log of the page server or of the service holds a code', !codes.some(c => H.childLog().includes(c)) && !codes.some(c => H.logged.join('\n').includes(c)));
    ok('every request of the library carried the code only in its header (hasCode) or none (the one that makes a library)', H.syncSeen.filter(x => x.url !== '/api/libs' && !/recover/.test(x.url)).every(x => x.hasCode));
    ok('no page error in any device', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));
  } finally {
    try { await browser.close(); } catch (e) { /* gone */ }
    await H.close();
  }
  if (errors.length) {
    console.error('\n' + errors.length + ' failed (' + passed + ' passed): sync page in real browsers');
    errors.slice(0, 15).forEach(e => console.error('  - ' + e));
    process.exit(1);
  }
  console.log('\n' + passed + ' passed: sync page in real browsers');
})().catch(e => { console.error(e); process.exit(1); });
