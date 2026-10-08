/* G13-6: Settings > My data in a real browser (puppeteer; its own server on a free port; no 8777; every screen in Korean, read from i18n/ko-KR.json).

   What a person does, with the page's own buttons, on fresh profiles (one browser context each):
     - 30 songs planted (the page's own scoreFromXml / packScore shapes), the secrets of this browser planted (PC link code, the one before it, guest key), a video in
       ppp-media: "Back up now" downloads ppp-library-<date>.ppp-library.json.gz; no secret and no setting is in it (grep for the planted values);
     - on ANOTHER fresh profile: choose that file, read the summary (30 new, 0 here, 0 copies), restore: the 30 slots are byte for byte the same text, the cards the
       same, a restored song opens, and the secrets of the second profile are its own (nothing came over);
     - into a profile that has other songs: none is removed or changed; the same id with another score keeps both (the copy has the visible Korean suffix) and a
       second restore adds nothing; a song with the same score gets the progress merged;
     - refusals that change nothing: a PNG, foreign JSON, a 25 MB file, a small gzip that inflates past the bound (zip bomb), a newer version, a corrupt gzip, a
       __proto__ key, a javascript: link;
     - delete everything: the first question cancels, the second (count of songs, "Back up first" which really downloads, a typed word) cancels, a wrong word keeps
       the button off, the right word deletes: 0 ppp* localStorage keys and 0 ppp* IndexedDB databases are read BEFORE the reload (the reload is held back), then the
       reload: nothing of the old data comes back; a database another tab holds open is reported (and the retry works once it is closed).
   And for each safety property a MUTANT of library-backup.js is served to the page (tests/backup/mutants.js): the same check must go red. */
'use strict';
const puppeteer = require('puppeteer');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { startServer } = require('./serve-free');
const { MUTANTS, applyMutant } = require('./backup/mutants.js');

const REPO = path.resolve(__dirname, '..');
const KO = JSON.parse(fs.readFileSync(path.join(REPO, 'i18n', 'ko-KR.json'), 'utf8')).content;
const MODULE_SRC = fs.readFileSync(path.join(REPO, 'library-backup.js'), 'utf8');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const errors = [];
const ok = (name, cond, detail) => {
  console.log((cond ? '  ✓ ' : '  ✗ ') + name + (detail ? ' — ' + detail : ''));
  if (!cond) errors.push(name + (detail ? ' — ' + detail : ''));
};
const fill = (s, vars) => String(s).replace(/\{\{(\w+)\}\}/g, (_, k) => (vars && vars[k] != null ? vars[k] : ''));
/* the Korean of an English source string: a string without Korean fails the suite (it would show English to the person) */
const ko = (key, vars) => {
  const v = KO[key];
  if (typeof v !== 'string' || !/[가-힣]/.test(v)) { errors.push('no Korean for: ' + key); return '⟨no Korean: ' + key + '⟩'; }
  return fill(v, vars);
};

const SECRET = { pc: '0123456789abcdef'.repeat(4), pcPrev: 'fedcba9876543210'.repeat(4), guest: 'abcd1234ef567890'.repeat(4) };
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ppp-backup-ui-'));
const COUNTS = 'Songs in the file: {{total}}. New here: {{fresh}}. Already here: {{same}}. Kept as separate copies: {{copies}}.';
const GENERIC = 'That file is not a PPP backup, or it is damaged. Nothing was changed.';

(async () => {
  const srv = await startServer();
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const pageErrors = [];
  const cdp = await browser.target().createCDPSession();
  try {
    /* ------------------------------------------------------------------------------------------ helpers */
    const base = srv.url.replace(/[^/]*$/, '');
    /* a context that does not save a download anywhere (the page's file is read from the blob it was made from), or one that does (dir) */
    async function newContext(downloadDir) {
      const ctx = await browser.createBrowserContext();
      try {
        await cdp.send('Browser.setDownloadBehavior', downloadDir ? { behavior: 'allow', downloadPath: downloadDir, browserContextId: ctx.id } : { behavior: 'deny', browserContextId: ctx.id });
      } catch (e) { /* the browser keeps its default */ }
      return ctx;
    }
    async function openProfile(ctx, o) {
      o = o || {};
      const page = await ctx.newPage();
      page.on('pageerror', e => pageErrors.push('[pageerror] ' + e.message));
      await page.setViewport({ width: 1100, height: 1400 });
      await page.evaluateOnNewDocument(cfg => {
        /* every file the page offers as a download is kept here: its name and its bytes */
        if (!window.__dl) {
          window.__dl = [];
          const click = HTMLAnchorElement.prototype.click;
          HTMLAnchorElement.prototype.click = function () {
            if (this.download && /^blob:/.test(this.href)) {
              const name = this.download;
              fetch(this.href).then(r => r.arrayBuffer()).then(b => {
                let s = ''; const u = new Uint8Array(b);
                for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
                window.__dl.push({ name: name, b64: btoa(s) });
              });
            }
            return click.apply(this, arguments);
          };
        }
        /* a profile is made once: a reload (after a restore, after a delete) must not make it again */
        try {
          if (sessionStorage.getItem('__seeded')) return;
          sessionStorage.setItem('__seeded', '1');
          localStorage.setItem('ppp-locale', cfg.locale);
          localStorage.setItem('ppp-guest', '1');
          localStorage.setItem('unrelated.key', 'keep');          /* not ours: a delete must leave it */
          if (cfg.slots) Object.keys(cfg.slots).forEach(id => localStorage.setItem('ppp.song.v1.' + id, cfg.slots[id]));
          if (cfg.cards) localStorage.setItem('ppp.library.v1', JSON.stringify({ songs: cfg.cards, current: 'demo', demo: null }));
          if (cfg.secrets) {
            localStorage.setItem('ppp.pclink.v1', JSON.stringify({ v: 1, code: cfg.secrets.pc }));
            localStorage.setItem('ppp.pclink.prev.v1', JSON.stringify({ v: 1, code: cfg.secrets.pcPrev }));
            localStorage.setItem('ppp-guest-key', cfg.secrets.guest);
            localStorage.setItem('ppp.homemode.v1', 'song');
            localStorage.setItem('ppp.cdn', '1');
          }
        } catch (e) { /* none */ }
      }, { locale: o.locale || 'ko-KR', slots: o.slots || null, cards: o.cards || null, secrets: o.secrets || null });
      /* one handler for every request of the page: a mutant of library-backup.js in its place, and the reload held back when a check wants to read the page first */
      const ctl = page.__ctl = { src: o.mutant ? applyMutant(MODULE_SRC, o.mutant) : null, hold: false, held: 0 };
      await page.setRequestInterception(true);
      page.on('request', r => {
        if (ctl.src && /\/library-backup\.js(\?|$)/.test(r.url())) r.respond({ status: 200, contentType: 'text/javascript', body: ctl.src });
        else if (ctl.hold && r.isNavigationRequest() && r.frame() === page.mainFrame()) { ctl.held++; r.abort('aborted'); }
        else r.continue();
      });
      await page.goto(srv.url, { waitUntil: 'networkidle2', timeout: 60000 });
      await ready(page);
      return page;
    }
    const ready = page => page.waitForFunction(() => document.querySelectorAll('aside nav button').length >= 6, { timeout: 30000 });
    /* after a delete the first screen is a new visitor's: the sign-in gate */
    const readyOrGate = page => page.waitForFunction(() => document.querySelector('[data-auth]') || document.querySelectorAll('aside nav button').length >= 6, { timeout: 30000 });
    const waitFor = async (fn, ms) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > (ms || 10000)) return null; await sleep(120); } };
    const nav = (page, label) => page.evaluate(l => { const b = [...document.querySelectorAll('aside nav button')].find(x => x.innerText.split('\n')[0].trim() === l); if (b) b.click(); return !!b; }, label);
    const gotoSettings = async page => {
      for (let i = 0; i < 3; i++) {
        await nav(page, ko('Settings'));
        if (await waitFor(() => exists(page, '[data-backup-section]'), 6000)) { await sleep(300); return; }
      }
      const where = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').slice(0, 240));
      throw new Error('Settings did not open: ' + where);
    };
    const gotoSongs = async page => { await nav(page, ko('My Songs')); await page.waitForSelector('[data-open-song]', { timeout: 15000 }); await sleep(300); };
    const dump = page => page.evaluate(() => { const o = {}; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); o[k] = localStorage.getItem(k); } return o; });
    const dbNames = page => page.evaluate(async () => (await indexedDB.databases()).map(d => d.name).sort());
    const text = (page, sel) => page.evaluate(s => { const e = document.querySelector(s); return e ? e.innerText.replace(/\s+/g, ' ').trim() : null; }, sel);
    const exists = (page, sel) => page.evaluate(s => !!document.querySelector(s), sel);
    const click = (page, sel) => page.evaluate(s => { const e = document.querySelector(s); if (e) e.click(); return !!e; }, sel);
    const pppKeys = d => Object.keys(d).filter(k => /^ppp/i.test(k));
    const songKeys = d => Object.keys(d).filter(k => /^ppp\.song\.v1\.song-/.test(k)).sort();
    /* what the page rewrites by itself while it runs is not what a check is about */
    const stable = d => JSON.stringify(Object.keys(d).filter(k => k !== 'ppp.state.v2' && k !== 'ppp.backup.v1').sort().map(k => [k, d[k]]));
    /* a download: the n-th file the page offered */
    async function download(page, n) {
      const got = await waitFor(() => page.evaluate(i => (window.__dl && window.__dl[i]) || null, n), 15000);
      return got ? { name: got.name, bytes: Buffer.from(got.b64, 'base64') } : null;
    }
    const readBackup = buf => JSON.parse((buf[0] === 0x1f && buf[1] === 0x8b ? zlib.gunzipSync(buf) : buf).toString('utf8'));
    const chooseFile = async (page, file) => { const input = await page.$('[data-backup-file]'); await input.uploadFile(file); };
    /* what the section says now: the message line, or null */
    const msgOf = page => text(page, '[data-backup-msg]');
    /* every text the message line shows from now on (a refusal that says the same as the one before it is still seen) */
    const logMessages = page => page.evaluate(() => {
      window.__msgLog = [];
      const el = document.querySelector('[data-backup-section]');
      new MutationObserver(() => { const m = document.querySelector('[data-backup-msg]'); window.__msgLog.push(m ? m.innerText.replace(/\s+/g, ' ').trim() : null); }).observe(el, { subtree: true, childList: true, characterData: true });
    });
    const nextFinalMessage = (page, from, reading) => waitFor(() => page.evaluate((n, r) => (window.__msgLog.slice(n).find(m => m && m !== r)) || null, from, reading), 30000);
    /* the summary panel appeared, or a message did */
    const planOrMsg = page => waitFor(async () => { if (await exists(page, '[data-backup-plan]')) return 'plan'; const m = await msgOf(page); return m && m !== ko('Reading the file…') ? 'msg' : null; }, 20000);
    /* press Restore and wait for the reload that follows */
    async function restoreNow(page) {
      const navigated = page.waitForNavigation({ waitUntil: 'load', timeout: 30000 }).catch(() => null);
      await click(page, '[data-backup-restore-yes]');
      await navigated;
      await ready(page);
    }
    const holdReloads = page => { page.__ctl.hold = true; page.__ctl.held = 0; return page.__ctl; };

    /* ------------------------------------------------------------------------------------------ the songs, made by the page's own code */
    console.log('\n── preparing 30 songs with the page\'s own importer ──');
    const PLANT = await (async () => {
      const ctx = await newContext();
      const page = await ctx.newPage();
      page.on('pageerror', e => pageErrors.push('[pageerror] ' + e.message));
      await page.goto(srv.url, { waitUntil: 'networkidle2', timeout: 60000 });
      await ready(page);
      const plant = await page.evaluate(async n => {
        const xml = await fetch('samples/prelude-fragment.musicxml').then(r => r.text());
        const mk = (i, tag) => { const sc = PPP.scoreFromXml(xml, 'Song ' + i + '.musicxml'); sc.title = tag + ' ' + i; sc.id = 'import:' + tag + i; return sc; };
        const slotOf = (i, tag) => {
          const sc = mk(i, tag), secs = {};
          (sc.sections || []).forEach(s => { secs[s.id] = { acc: 10 + i, mem: 0, reps: 0 }; });
          const hand = { expected: 4, matched: 3, timingAbsSum: 50, timingCount: 3 };
          const stat = { m: 1, attempts: 1 + (i % 4), expected: 8, matched: 6, wrong: 1, missed: 1, extra: 0, onTime: 5, early: 1, late: 0, timingAbsSum: 100, timingCount: 6, hands: { r: hand, l: hand }, tempos: {}, recent: [{ at: 1000 + i, acc: 0.75, tempo: 70, hands: 'both', timing: 16 }], lastAt: 1000 + i };
          return {
            score: PPP.packScore(sc), secs: secs, history: { rev: 1, byMeasure: { 1: stat }, runs: [{ at: 1000 + i, from: 1, to: 2, hands: 'both', tempo: 70, simulated: false, accuracy: 0.8 }] },
            memory: { rev: 0, sections: {} }, loopFrom: 1, loopTo: Math.min(2, sc.measures.length), tempo: 60 + i, memLevel: 0, blindRuns: 0, mastered: false,
            fileName: sc.title + '.musicxml', fileMeta: '8 KB · MusicXML', importSource: { kind: 'musicxml' }, importReport: null
          };
        };
        const cards = [], slots = {}, alt = {}, none = {};
        for (let i = 0; i < n; i++) {
          const id = 'song-pa' + i, slot = slotOf(i, 'Song');
          cards.push({ id: id, title: 'Song ' + i, composer: 'Composer ' + i, kind: 'musicxml', url: null, addedAt: 1700000000000 + i * 1000, lastAt: 1700000000000 + i * 1000, prog: i % 100, mem: 0, measures: slot.score.measures.length });
          slots[id] = JSON.stringify(slot);
          if (i < 3) alt[id] = JSON.stringify(slotOf(i, 'Edited'));        /* another version of the same song: another score */
          if (i === 3) { const quiet = JSON.parse(slots[id]); quiet.history = { rev: 0, byMeasure: {}, runs: [] }; none[id] = JSON.stringify(quiet); }   /* the same song, no practice yet */
        }
        const locals = [], localSlots = {};
        for (let i = 0; i < 5; i++) {
          const id = 'song-lo' + i, slot = slotOf(i, 'Local');
          locals.push({ id: id, title: 'Local ' + i, composer: 'Me', kind: 'musicxml', url: null, addedAt: 1700000100000 + i, lastAt: 1700000100000 + i, prog: 5, mem: 0, measures: slot.score.measures.length });
          localSlots[id] = JSON.stringify(slot);
        }
        return { cards: cards, slots: slots, alt: alt, none: none, locals: locals, localSlots: localSlots };
      }, 30);
      await ctx.close();
      return plant;
    })();
    ok('30 songs were made by the page (packed Scores)', PLANT.cards.length === 30 && Object.keys(PLANT.slots).length === 30 && JSON.parse(PLANT.slots['song-pa0']).score._packedNoteKeys.length > 3);
    const LABELS = { title: ko('My data'), make: ko('Back up now'), pick: ko('Choose a backup file'), wipe: ko('Delete everything…'), last0: ko('No backup has been made on this device yet.') };

    /* ------------------------------------------------------------------------------------------ 1. back up */
    console.log('\n── 1. back up: Korean labels, the file, no secret ──');
    const DL_DIR = path.join(TMP, 'downloads');
    fs.mkdirSync(DL_DIR, { recursive: true });
    const ctxA = await newContext(DL_DIR);
    const A = await openProfile(ctxA, { cards: PLANT.cards, slots: PLANT.slots, secrets: SECRET });
    await A.evaluate(() => PPP.app.keepVideo('song-pa0', new Blob([new Uint8Array(4096)], { type: 'video/webm' })));    /* the page's own connection to ppp-media */
    await waitFor(async () => (await dbNames(A)).includes('ppp-media'), 8000);
    await gotoSettings(A);
    const sec = await text(A, '[data-backup-section]');
    ok('Settings has the "My data" section in Korean', !!sec && sec.includes(LABELS.title) && sec.includes(LABELS.make) && sec.includes(LABELS.pick) && sec.includes(LABELS.wipe), sec && sec.slice(0, 80));
    ok('it says that the secrets are not in the file (Korean)', !!sec && sec.includes(ko('One file with your songs and your practice progress. It does not contain your PC link code, your link-sharing key or any password, and not the videos you uploaded.')));
    ok('"no backup yet" before the first backup', (await text(A, '[data-backup-last]')) === LABELS.last0);
    const before = await dump(A);
    ok('the planted profile is what the page holds (30 slots, the secrets, the library)', songKeys(before).length === 30 && !!before['ppp.pclink.v1'] && !!before['ppp-guest-key'] && JSON.parse(before['ppp.library.v1']).songs.length === 30);
    await click(A, '[data-backup-make]');
    const dl1 = await download(A, 0);
    ok('the page offered one download', !!dl1);
    ok('its name is ppp-library-<date>.ppp-library.json.gz', !!dl1 && /^ppp-library-\d{4}-\d{2}-\d{2}\.ppp-library\.json\.gz$/.test(dl1.name), dl1 && dl1.name);
    const FILE = path.join(TMP, dl1 ? dl1.name : 'x.gz');
    fs.writeFileSync(FILE, dl1.bytes);
    const onDisk = await waitFor(() => { const f = fs.readdirSync(DL_DIR).filter(n => !/\.crdownload$/.test(n)); return f.length ? f : null; }, 8000);
    ok('the browser saved the file under that name, with the same bytes', !!onDisk && onDisk.includes(dl1.name) && fs.readFileSync(path.join(DL_DIR, dl1.name)).equals(dl1.bytes), onDisk && onDisk.join(','));
    ok('it is gzip', dl1.bytes[0] === 0x1f && dl1.bytes[1] === 0x8b);
    const bk = readBackup(dl1.bytes);
    ok('the format is {app:ppp-library, v:1} with 30 songs, their slots and the library', bk.app === 'ppp-library' && bk.v === 1 && bk.library.songs.length === 30 && Object.keys(bk.slots).filter(k => k !== 'demo').length === 30);
    ok('every slot in the file is the page\'s own slot', PLANT.cards.every(c => JSON.stringify(bk.slots[c.id]) === before['ppp.song.v1.' + c.id]));
    const raw = zlib.gunzipSync(dl1.bytes).toString('utf8');
    const leaked = Object.keys(SECRET).filter(k => raw.includes(SECRET[k]));
    ok('no secret of this browser is in the file (PC code, the one before it, guest key)', leaked.length === 0, leaked.join(','));
    ok('no setting and no key name is in the file', !/pclink|ppp-guest|ppp-locale|"theme"|"toggles"|midiDeviceId|ppp\.cdn|homemode/.test(raw));
    ok('the videos are not in the file (it is small)', dl1.bytes.length < 400 * 1024, dl1.bytes.length + ' bytes');
    ok('the page said where it went (Korean) and shows the date of the last backup', (await msgOf(A)) === ko('Backup saved as {{file}}. Songs in it: {{n}}.', { file: dl1.name, n: 30 }) && /^마지막 백업: \d{4}-\d{2}-\d{2}$/.test(await text(A, '[data-backup-last]')), await msgOf(A));
    const nowA = await dump(A);
    ok('making a backup changed no song and left this browser\'s own secrets where they were', songKeys(nowA).length === 30 && songKeys(nowA).every(k => before[k] === nowA[k]) && nowA['ppp.pclink.v1'] === before['ppp.pclink.v1'] && nowA['ppp-guest-key'] === before['ppp-guest-key']);
    await ctxA.close();

    /* ------------------------------------------------------------------------------------------ 2. restore on a fresh profile */
    console.log('\n── 2. restore into a fresh profile: byte for byte ──');
    const ctxB = await newContext();
    const Bp = await openProfile(ctxB, {});
    await Bp.evaluate(() => { localStorage.setItem('ppp-guest-key', 'b'.repeat(64)); });         /* this browser's own key, to see that the restore leaves it */
    await gotoSettings(Bp);
    await chooseFile(Bp, FILE);
    ok('a plan panel appears', (await planOrMsg(Bp)) === 'plan', await msgOf(Bp));
    ok('the summary is in Korean: 30 songs, 30 new, 0 here, 0 copies', (await text(Bp, '[data-backup-plan-counts]')) === ko(COUNTS, { total: 30, fresh: 30, same: 0, copies: 0 }), await text(Bp, '[data-backup-plan-counts]'));
    ok('it names the date of the backup', /^\d{4}-\d{2}-\d{2}에 만든 백업입니다\.$/.test(await text(Bp, '[data-backup-plan-date]')), await text(Bp, '[data-backup-plan-date]'));
    ok('it asks once, in Korean', (await text(Bp, '[data-backup-plan]')).includes(ko('Add these to this device? Nothing here will be removed.')));
    ok('nothing was written before the question was answered', songKeys(await dump(Bp)).length === 0);
    await restoreNow(Bp);
    const after = await dump(Bp);
    ok('after the restore: 30 song slots', songKeys(after).length === 30, String(songKeys(after).length));
    ok('every slot is the same text as on the first profile, byte for byte', PLANT.cards.every(c => after['ppp.song.v1.' + c.id] === before['ppp.song.v1.' + c.id]));
    ok('the cards are the same, in the same order', JSON.stringify(JSON.parse(after['ppp.library.v1']).songs) === JSON.stringify(PLANT.cards));
    ok('the secrets were not carried over: the PC link and the sharing key of the first profile are not here, this browser\'s own key is', !after['ppp.pclink.v1'] && !after['ppp.pclink.prev.v1'] && after['ppp-guest-key'] === 'b'.repeat(64) && !JSON.stringify(after).includes(SECRET.pc) && !JSON.stringify(after).includes(SECRET.guest));
    ok('the page said what it did (Korean toast)', !!(await waitFor(() => Bp.evaluate(t => document.body.innerText.includes(t), ko('Restored: {{fresh}} new, {{same}} merged, {{copies}} kept as copies.', { fresh: 30, same: 0, copies: 0 })), 15000)));
    await gotoSongs(Bp);
    ok('My Songs lists the 30 songs and the sample', (await Bp.evaluate(() => document.querySelectorAll('[data-open-song]').length)) === 31);
    await click(Bp, '[data-open-song="song-pa3"]');
    ok('a restored song opens (its Score is read from the restored slot)', !!(await waitFor(async () => { const d = await dump(Bp); try { return JSON.parse(d['ppp.state.v2']).songId === 'song-pa3'; } catch (e) { return false; } }, 15000)));
    await ctxB.close();

    /* ------------------------------------------------------------------------------------------ 3. restore into a profile with other songs; conflicts */
    console.log('\n── 3. restore into a profile that has songs: none removed, a different score is kept as a copy ──');
    async function restoreIntoLocals(mutant, withConflicts) {
      const v = [];
      const cards = PLANT.locals.slice(), slots = Object.assign({}, PLANT.localSlots);
      /* song-pa0..2: here with ANOTHER score; song-pa3: here with the same score and no practice */
      if (withConflicts) {
        ['song-pa0', 'song-pa1', 'song-pa2'].forEach(id => { cards.push(Object.assign({}, PLANT.cards.find(c => c.id === id), { title: 'Edited ' + id })); slots[id] = PLANT.alt[id]; });
        cards.push(PLANT.cards.find(c => c.id === 'song-pa3')); slots['song-pa3'] = PLANT.none['song-pa3'];
      }
      const ctx = await newContext();
      try {
        const page = await openProfile(ctx, { cards: cards, slots: slots, mutant: mutant });
        const pre = await dump(page);
        await gotoSettings(page);
        await chooseFile(page, FILE);
        if ((await planOrMsg(page)) !== 'plan') { v.push('no plan panel: ' + (await msgOf(page))); return { v, page, ctx }; }
        const counts = await text(page, '[data-backup-plan-counts]');
        await restoreNow(page);
        const post = await dump(page);
        const libNow = JSON.parse(post['ppp.library.v1']);
        const ids = libNow.songs.map(c => c.id);
        PLANT.locals.forEach(c => { if (!ids.includes(c.id)) v.push('a local song was removed from the library: ' + c.id); if (post['ppp.song.v1.' + c.id] !== pre['ppp.song.v1.' + c.id]) v.push('a local slot changed: ' + c.id); });
        if (withConflicts) ['song-pa0', 'song-pa1', 'song-pa2'].forEach(id => { if (post['ppp.song.v1.' + id] !== pre['ppp.song.v1.' + id]) v.push('a different score replaced the local one: ' + id); if (!ids.includes(id)) v.push('the local card is gone: ' + id); });
        return { v, page, ctx, pre, post, libNow, counts, ids };
      } catch (e) { v.push('threw: ' + e.message); return { v, page: null, ctx }; }
    }
    {
      const r = await restoreIntoLocals(null, false);
      ok('into a profile with 5 other songs: none removed, none changed', r.v.length === 0, r.v.join('; '));
      ok('the 30 are added to the 5 (35 cards)', !!r.ids && r.ids.length === 35, r.ids && String(r.ids.length));
      await r.ctx.close();
    }
    {
      const r = await restoreIntoLocals(null, true);
      ok('with the same id and another score: the local slots are untouched and kept', r.v.length === 0, r.v.join('; '));
      ok('the summary counted 26 new, 1 here, 3 copies (Korean)', r.counts === ko(COUNTS, { total: 30, fresh: 26, same: 1, copies: 3 }), r.counts);
      const day = bk.exportedAt.slice(0, 10);
      const wanted = ['Song 0', 'Song 1', 'Song 2'].map(t => ko('{{title}} (from backup {{date}})', { title: t, date: day }));
      const copies = r.libNow.songs.filter(c => wanted.includes(c.title));
      ok('3 copies were added, each with the visible Korean suffix (backup <date>)', copies.length === 3 && /\(백업 \d{4}-\d{2}-\d{2}\)$/.test(wanted[0]), r.libNow.songs.map(c => c.title).filter(t => /백업/.test(t)).join(' | '));
      ok('each copy holds the backup\'s version under an id of its own', copies.every(c => !PLANT.cards.some(p => p.id === c.id) && JSON.parse(r.post['ppp.song.v1.' + c.id]).score.title === 'Song ' + c.title.match(/\d+/)[0]));
      ok('the song with the same score got the backup\'s practice (the larger attempts)', JSON.parse(r.post['ppp.song.v1.song-pa3']).history.byMeasure[1].attempts === JSON.parse(PLANT.slots['song-pa3']).history.byMeasure[1].attempts);
      ok('and its score is the same text as before', JSON.stringify(JSON.parse(r.post['ppp.song.v1.song-pa3']).score) === JSON.stringify(JSON.parse(PLANT.none['song-pa3']).score));
      /* the second restore of the same file */
      await gotoSettings(r.page);
      await chooseFile(r.page, FILE);
      ok('a plan panel appears again', (await planOrMsg(r.page)) === 'plan');
      const counts2 = await text(r.page, '[data-backup-plan-counts]');
      ok('the second restore of the same file sees everything as already here (0 new, 0 copies)', counts2 === ko(COUNTS, { total: 30, fresh: 0, same: 30, copies: 0 }), counts2);
      await click(r.page, '[data-backup-restore-yes]');
      await sleep(2500);
      await readyOrGate(r.page);
      const post2 = await dump(r.page);
      ok('and adds no song', JSON.parse(post2['ppp.library.v1']).songs.length === r.ids.length, String(JSON.parse(post2['ppp.library.v1']).songs.length));
      await r.ctx.close();
    }

    /* ------------------------------------------------------------------------------------------ 4. refusals */
    console.log('\n── 4. a file that is not a backup is refused and nothing changes ──');
    {
      const ctx = await newContext();
      const page = await openProfile(ctx, { cards: PLANT.locals, slots: PLANT.localSlots, secrets: SECRET });
      await gotoSettings(page);
      const snap = async () => stable(await dump(page)) + JSON.stringify(await dbNames(page));
      const s0 = await snap();
      await logMessages(page);
      const files = {
        png: { buf: Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(300, 7)]), msg: ko(GENERIC), label: 'a PNG' },
        foreign: { buf: Buffer.from('{"hello":"world","songs":[1,2,3]}'), msg: ko(GENERIC), label: 'JSON of another program' },
        foreignGz: { buf: zlib.gzipSync(Buffer.from('{"app":"other","v":1}')), msg: ko(GENERIC), label: 'a gzip of other JSON' },
        corrupt: { buf: (() => { const g = zlib.gzipSync(Buffer.from(JSON.stringify({ app: 'ppp-library', v: 1, pad: 'x'.repeat(5000) }))); return g.subarray(0, g.length - 20); })(), msg: ko(GENERIC), label: 'a cut-off gzip' },
        newer: { buf: Buffer.from(JSON.stringify({ app: 'ppp-library', v: 2, library: { songs: [] }, slots: {} })), msg: ko('That backup was made by a newer version of PPP. Update PPP and try again. Nothing was changed.'), label: 'a newer version' },
        proto: { buf: Buffer.from('{"app":"ppp-library","v":1,"library":{"songs":[]},"slots":{"demo":{"score":null,"__proto__":{"polluted":1}}}}'), msg: ko(GENERIC), label: 'a __proto__ key' },
        badurl: { buf: Buffer.from(JSON.stringify({ app: 'ppp-library', v: 1, library: { songs: [{ id: 'song-x1', title: 'x', url: 'javascript:alert(1)' }] }, slots: { 'song-x1': { score: { measures: [], notes: [] } } } })), msg: ko(GENERIC), label: 'a javascript: link' },
        big: { buf: Buffer.alloc(25 * 1024 * 1024, 0x20), msg: ko('That file is too large to be a PPP backup ({{mb}} MB). Nothing was changed.', { mb: 25 }), label: 'a 25 MB file' },
        bomb: { buf: zlib.gzipSync(Buffer.alloc(50 * 1024 * 1024, 0x20), { level: 9 }), msg: ko('That file expands to far more than a backup can hold, so it was not opened. Nothing was changed.'), label: 'a small gzip that inflates to 50 MB' }
      };
      for (const k of Object.keys(files)) {
        const f = path.join(TMP, 'refuse-' + k + '.bin');
        fs.writeFileSync(f, files[k].buf);
        const from = await page.evaluate(() => window.__msgLog.length);
        await chooseFile(page, f);
        const got = await nextFinalMessage(page, from, ko('Reading the file…'));
        ok('refused: ' + files[k].label + (k === 'bomb' ? ' (' + files[k].buf.length + ' bytes on disk)' : ''), got === files[k].msg, got);
        ok('  no plan panel, nothing changed', !(await exists(page, '[data-backup-plan]')) && (await snap()) === s0);
      }
      ok('nothing was polluted by the __proto__ file', await page.evaluate(() => ({}).polluted === undefined));
      await ctx.close();
    }

    /* ------------------------------------------------------------------------------------------ 5. delete everything */
    console.log('\n── 5. delete everything: two questions, cancel leaves all, then 0 keys and 0 databases ──');
    async function plantDatabases(page) {
      /* the page's own connections: keepVideo opens ppp-media and keeps it, and resolving a Score's graph opens the graphs cache ppp-engrave and keeps it */
      await page.evaluate(() => PPP.app.keepVideo('song-pa0', new Blob([new Uint8Array(4096)], { type: 'video/webm' })));
      await page.evaluate(() => PPPEngrave.app.resolve(PPP.buildDemoScore(), { key: 'song-pa0' }));
      await waitFor(async () => { const n = await dbNames(page); return n.includes('ppp-media') && n.includes('ppp-engrave'); }, 8000);
    }
    const WORD = ko('delete');
    const DELETED = ko('Everything on this device was deleted. The page reloads now.');
    async function toSecondQuestion(page) {
      await click(page, '[data-wipe-start]');
      await page.waitForSelector('[data-wipe-step1]', { timeout: 5000 });
      await click(page, '[data-wipe-next]');
      await page.waitForSelector('[data-wipe-step2]', { timeout: 5000 });
    }
    async function deleteScenario(mutant, full) {
      const v = [];
      const ctx = await newContext(), page0 = { page: null };
      try {
        const page = page0.page = await openProfile(ctx, { cards: PLANT.cards, slots: PLANT.slots, secrets: SECRET, mutant: mutant });
        await plantDatabases(page);
        await gotoSettings(page);
        const pre = await dump(page), preDbs = await dbNames(page);
        if (full) {
          /* first question: cancel */
          await click(page, '[data-wipe-start]');
          await page.waitForSelector('[data-wipe-step1]', { timeout: 5000 });
          const t1 = await text(page, '[data-wipe-step1]');
          ok('the first question names the count of songs and offers "back up first" (Korean)', t1.includes(ko('This removes all your songs, your practice progress and your settings from this device. Songs on this device: {{n}}. Make a backup first if you want to keep them.', { n: 30 })) && t1.includes(ko('Back up first')), t1);
          await click(page, '[data-wipe-cancel]');
          await sleep(300);
          ok('cancel at the first question leaves everything', !(await exists(page, '[data-wipe-step1]')) && stable(await dump(page)) === stable(pre) && JSON.stringify(await dbNames(page)) === JSON.stringify(preDbs));
          /* second question */
          await toSecondQuestion(page);
          const t2 = await text(page, '[data-wipe-step2]');
          ok('the second question is another dialog: the count again, the reminder to back up, a typed word (Korean)', t2.includes(ko('Last check. Everything on this device will be lost for good, including your songs ({{n}}). Have you made a backup? To confirm, type {{word}} below.', { n: 30, word: WORD })) && t2.includes(ko('Back up first')) && t2.includes(ko('Delete everything')), t2);
          ok('the delete button is off until the word is typed', await page.evaluate(() => document.querySelector('[data-wipe-go]').disabled === true));
          await click(page, '[data-wipe-go]');
          await page.type('[data-wipe-input]', WORD.slice(0, 1) + 'x');
          await sleep(300);
          ok('a wrong word keeps it off and a click does nothing', (await page.evaluate(() => document.querySelector('[data-wipe-go]').disabled === true)) && stable(await dump(page)) === stable(pre));
          /* "Back up first" from the second dialog really backs up, and the question stays */
          const n0 = await page.evaluate(() => window.__dl.length);
          await click(page, '[data-wipe-backup2]');
          const dl = await download(page, n0);
          ok('"Back up first" in the second dialog starts the backup (a file is offered) and the question stays', !!dl && dl.name.endsWith('.ppp-library.json.gz') && (await exists(page, '[data-wipe-step2]')), dl && dl.name);
          if (dl) ok('that backup has the 30 songs', readBackup(dl.bytes).library.songs.length === 30);
          /* cancel at the second question */
          await click(page, '[data-wipe-cancel2]');
          await sleep(300);
          const mid = await dump(page);
          ok('cancel at the second question leaves everything (the 30 slots, the secrets, the databases)', songKeys(mid).length === 30 && !!mid['ppp.pclink.v1'] && !!mid['ppp-guest-key'] && JSON.stringify(await dbNames(page)) === JSON.stringify(preDbs));
        }
        await toSecondQuestion(page);
        await page.type('[data-wipe-input]', WORD);
        await waitFor(() => page.evaluate(() => document.querySelector('[data-wipe-go]').disabled === false), 3000);
        if (full) ok('with the right word the button is on', await page.evaluate(() => document.querySelector('[data-wipe-go]').disabled === false));
        const ctl = holdReloads(page);
        await click(page, '[data-wipe-go]');
        const done = await waitFor(async () => { const m = await msgOf(page); return m === DELETED || (m && /^일부 데이터를 지우지 못했습니다/.test(m)) ? m : null; }, 25000);
        const keys = pppKeys(await dump(page)), dbs = (await dbNames(page)).filter(n => /^ppp/i.test(n));
        if (done !== DELETED) v.push('no "deleted" message: ' + done);
        if (keys.length) v.push('ppp* localStorage keys left: ' + keys.join(','));
        if (dbs.length) v.push('ppp* IndexedDB databases left: ' + dbs.join(','));
        const ss = await page.evaluate(() => Object.keys(sessionStorage).filter(k => /^ppp/i.test(k)));
        if (ss.length) v.push('ppp* session keys left: ' + ss.join(','));
        if (full) {
          ok('the page says it was deleted (Korean) and, read before the reload: 0 ppp* localStorage keys', done === DELETED && keys.length === 0, keys.join(','));
          ok('read before the reload: 0 ppp* IndexedDB databases (indexedDB.databases())', dbs.length === 0, dbs.join(','));
          ok('the reload was asked for (and held back for this check)', !!(await waitFor(() => ctl.held > 0, 4000)));
          const left = await dump(page);
          ok('a key that is not ppp* is not ours to remove', left['unrelated.key'] === 'keep' && Object.keys(left).length === 1, Object.keys(left).join(','));
          ctl.hold = false;
          await page.reload({ waitUntil: 'networkidle2' });
          await readyOrGate(page);
          const fresh = await dump(page);
          ok('after the real reload: no song, no secret, no old setting is back', songKeys(fresh).length === 0 && !fresh['ppp.pclink.v1'] && !fresh['ppp.pclink.prev.v1'] && !fresh['ppp-guest-key'] && !fresh['ppp-locale'] && !fresh['ppp.homemode.v1'] && !fresh['ppp.cdn'] && !JSON.stringify(fresh).includes(SECRET.pc), Object.keys(fresh).join(','));
          ok('the library is the empty one', JSON.parse(fresh['ppp.library.v1'] || '{"songs":[]}').songs.length === 0);
          const videos = await page.evaluate(async () => {
            if (!(await indexedDB.databases()).some(d => d.name === 'ppp-media')) return 0;
            return await new Promise(res => { const r = indexedDB.open('ppp-media'); r.onsuccess = () => { const d = r.result; if (!d.objectStoreNames.contains('videos')) { d.close(); return res(0); } const q = d.transaction('videos').objectStore('videos').count(); q.onsuccess = () => { d.close(); res(q.result); }; }; r.onerror = () => res(0); });
          });
          ok('the video is gone', videos === 0, String(videos));
        }
        return { v, ctx };
      } catch (e) { v.push('threw: ' + e.message); return { v, ctx }; }
    }
    {
      const r = await deleteScenario(null, true);
      ok('delete everything: every check of the scenario holds', r.v.length === 0, r.v.join('; '));
      await r.ctx.close();
    }

    /* a database that another tab holds open is reported, and the retry works once it is closed */
    console.log('\n── 5b. a database another tab holds open: reported, then retried ──');
    {
      const ctx = await newContext();
      const page = await openProfile(ctx, { cards: PLANT.locals, slots: PLANT.localSlots, secrets: SECRET });
      await plantDatabases(page);
      const other = await ctx.newPage();
      await other.goto(base + 'support.js', { waitUntil: 'domcontentloaded' });
      await other.evaluate(() => new Promise((resolve, reject) => { const r = indexedDB.open('ppp-media', 1); r.onsuccess = () => { window.__held = r.result; resolve(); }; r.onerror = () => reject(r.error); }));   /* no versionchange handler: an old tab */
      await gotoSettings(page);
      await toSecondQuestion(page);
      await page.type('[data-wipe-input]', WORD);
      const ctl = holdReloads(page);
      await click(page, '[data-wipe-go]');
      const failed = await waitFor(() => exists(page, '[data-wipe-failed]'), 25000);
      const m = await msgOf(page);
      ok('a database held open by another tab is reported by name, with the retry and reload buttons (Korean)', !!failed && m === ko('Some data could not be removed ({{what}}). Close other PPP tabs and try again.', { what: 'ppp-media' }) && (await text(page, '[data-wipe-failed]')).includes(ko('Try again')), m);
      ok('the rest was removed anyway (no ppp* localStorage key)', pppKeys(await dump(page)).length === 0);
      ok('and the page did not reload over a half-deleted profile', ctl.held === 0);
      await other.close();
      await sleep(300);
      await click(page, '[data-wipe-retry]');
      const done = await waitFor(async () => (await msgOf(page)) === DELETED, 25000);
      ok('after the other tab is closed the retry deletes the rest: 0 databases, 0 keys', !!done && (await dbNames(page)).filter(n => /^ppp/i.test(n)).length === 0 && pppKeys(await dump(page)).length === 0);
      ctl.hold = false;
      await ctx.close();
    }

    /* ------------------------------------------------------------------------------------------ 6. the mutants: the same checks go red */
    console.log('\n── 6. mutants of library-backup.js served to the page: the browser checks notice ──');
    const mut = name => { const m = MUTANTS.find(x => x.name === name); if (!m) throw new Error('no mutant: ' + name); return m; };
    {
      const r = await restoreIntoLocals(mut('a restore drops the songs that are here'), false);
      ok('mutant "a restore drops the songs that are here": the restore check goes red', r.v.length > 0, r.v.slice(0, 2).join('; '));
      await r.ctx.close();
    }
    {
      const r = await restoreIntoLocals(mut('a different score replaces the local one (no copy)'), true);
      ok('mutant "a different score replaces the local one": the conflict check goes red', r.v.length > 0, r.v.slice(0, 2).join('; '));
      await r.ctx.close();
    }
    {
      const ctx = await newContext();
      const page = await openProfile(ctx, { cards: PLANT.cards, slots: PLANT.slots, secrets: SECRET, mutant: mut('the backup holds the PC code (the guard is off)') });
      await gotoSettings(page);
      await click(page, '[data-backup-make]');
      const dl = await download(page, 0);
      const bad = dl ? Object.keys(SECRET).filter(k => zlib.gunzipSync(dl.bytes).toString('utf8').includes(SECRET[k])) : ['no download'];
      ok('mutant "the backup holds the PC code": the grep for the planted codes goes red', bad.length > 0, bad.join(','));
      await ctx.close();
    }
    {
      const r = await deleteScenario(mut('the wipe misses ppp-media'), false);
      ok('mutant "the wipe misses ppp-media": the databases check goes red', r.v.some(x => /IndexedDB databases left: .*ppp-media/.test(x)), r.v.join('; '));
      await r.ctx.close();
    }
    {
      const r = await deleteScenario(mut('the wipe leaves the settings keys'), false);
      ok('mutant "the wipe leaves the settings keys": the keys check goes red', r.v.some(x => /localStorage keys left/.test(x)), r.v.join('; '));
      await r.ctx.close();
    }
  } catch (e) {
    errors.push('suite threw: ' + ((e && e.stack) || e));
    console.log(e);
  } finally {
    try { await browser.close(); } catch (e) { /* closed */ }
    try { await srv.close(); } catch (e) { /* closed */ }
    try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* the temp folder stays */ }
  }
  ok('the page raised no error', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));
  console.log('\n' + (errors.length ? errors.length + ' check(s) FAILED:\n  ' + errors.join('\n  ') : 'all checks passed'));
  process.exit(errors.length ? 1 : 0);
})();
