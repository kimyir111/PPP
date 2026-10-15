/* Shared parts of the sync browser suites (G13-S1): a "device" is a puppeteer browser context (its own localStorage, as a device has) and one page in it, with the
   helpers that the section's own selectors need; and the songs, made by the page's own importer (PPP.scoreFromXml, PPP.packScore) so that what is planted is what the page
   writes. Used by page.test.js, big.test.js and pg.test.js.

     const B = require('./browser-lib.js').make({ browser, pageUrl, ko, allRequests, pageErrors, mutant, repo })
     const dev = await B.newDevice('A', { cards, slots, secrets, xp, minutes, width, height })
     const songs = await B.prepSongs(30)        { cards, slots, bCards, bSlots, edited, measures } */
'use strict';
const fs = require('fs');
const path = require('path');

const sleep = ms => new Promise(r => setTimeout(r, ms));

function make(o) {
  const { browser, pageUrl, ko, allRequests, pageErrors, mutant, repo } = o;
  const applyMutant = mutant ? require('./mutants.js').applyMutant : null;
  const waitFor = async (fn, ms) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > (ms || 12000)) return null; await sleep(100); } };
  const ready = page => page.waitForFunction(() => document.querySelectorAll('aside nav button').length >= 6, { timeout: 30000 });

  class Dev {
    constructor(name, ctx, page) { this.name = name; this.ctx = ctx; this.page = page; }
    text(sel) { return this.page.evaluate(s => { const e = document.querySelector(s); return e ? e.innerText.replace(/\s+/g, ' ').trim() : null; }, sel); }
    exists(sel) { return this.page.evaluate(s => !!document.querySelector(s), sel); }
    count(sel) { return this.page.evaluate(s => document.querySelectorAll(s).length, sel); }
    click(sel) { return this.page.evaluate(s => { const e = document.querySelector(s); if (e) e.click(); return !!e; }, sel); }
    attr(sel, a) { return this.page.evaluate((s, n) => { const e = document.querySelector(s); return e ? e.getAttribute(n) : null; }, sel, a); }
    value(sel) { return this.page.evaluate(s => { const e = document.querySelector(s); return e ? e.value : null; }, sel); }
    async type(sel, text) { await this.page.evaluate((s, t) => { const e = document.querySelector(s); e.value = t; e.dispatchEvent(new Event('input', { bubbles: true })); }, sel, text); }
    async nav(label) { return this.page.evaluate(l => { const b = [...document.querySelectorAll('aside nav button')].find(x => x.innerText.split('\n')[0].trim() === l); if (b) b.click(); return !!b; }, label); }
    async settings() {
      for (let i = 0; i < 3; i++) {
        await this.nav(ko('Settings'));
        if (await waitFor(() => this.exists('[data-sync-section]'), 8000)) { await sleep(200); return true; }
      }
      return false;
    }
    ls() { return this.page.evaluate(() => { const o = {}; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); o[k] = localStorage.getItem(k); } return o; }); }
    status() { return this.page.evaluate(() => (window.PPP && PPP.app && PPP.app._sync) ? PPP.app._sync.engine.status() : null); }
    engine() { return this.page.evaluate(() => PPP.app._sync.engine.syncNow('test')); }
    cards() { return this.page.evaluate(() => { const d = JSON.parse(localStorage.getItem('ppp.library.v1') || '{"songs":[]}'); return d.songs.map(c => ({ id: c.id, title: c.title })); }); }
    /* the page's own removal (what the "remove" button ends in) */
    remove(id) { return this.page.evaluate(i => { PPP.app.removeSong(i, { quiet: true }); }, id); }
    async open(query) {
      await this.page.goto(pageUrl + (query || ''), { waitUntil: 'networkidle2', timeout: 60000 });
      await ready(this.page);
      await sleep(300);
    }
    /* the section's own account of itself settles: not syncing, and nothing left to send */
    async synced(ms) {
      return waitFor(async () => {
        const s = await this.status();
        return s && s.on && s.phase === 'idle' && !s.error && s.songs.pending === 0 && s.songs.left === 0 && s.lastSyncAt > 0 ? s : null;
      }, ms || 30000);
    }
  }

  async function newDevice(name, opts) {
    opts = opts || {};
    const ctx = await browser.createBrowserContext();
    const page = await ctx.newPage();
    page.on('pageerror', e => pageErrors.push('[' + name + ' pageerror] ' + e.message));
    page.on('request', r => allRequests.push(name + ' ' + r.method() + ' ' + r.url()));
    await page.setViewport({ width: opts.width || 1100, height: opts.height || 1500 });
    if (mutant) {
      const src = applyMutant(fs.readFileSync(path.join(repo, mutant.file), 'utf8'), mutant);
      await page.setRequestInterception(true);
      page.on('request', r => {
        let u = null;
        try { u = new URL(r.url()); } catch (e) { u = null; }
        const p = u ? decodeURIComponent(u.pathname) : '';
        const isPage = mutant.file === 'Piano Coach App.dc.html' && p.endsWith('/Piano Coach App.dc.html') && r.isNavigationRequest();
        if (p === '/' + mutant.file || isPage) r.respond({ status: 200, contentType: mutant.file.endsWith('.html') ? 'text/html; charset=utf-8' : 'text/javascript', body: src });
        else r.continue();
      });
    }
    await page.evaluateOnNewDocument(cfg => {
      try {
        if (sessionStorage.getItem('__seeded')) return;
        sessionStorage.setItem('__seeded', '1');
        localStorage.setItem('ppp-locale', cfg.locale);
        localStorage.setItem('ppp-guest', '1');
        localStorage.setItem('unrelated.key', 'keep');
        if (cfg.slots) Object.keys(cfg.slots).forEach(id => localStorage.setItem('ppp.song.v1.' + id, cfg.slots[id]));
        if (cfg.cards) localStorage.setItem('ppp.library.v1', JSON.stringify({ songs: cfg.cards, current: 'demo', demo: null }));
        if (cfg.secrets) {
          localStorage.setItem('ppp.pclink.v1', JSON.stringify({ v: 1, code: cfg.secrets.pc }));
          localStorage.setItem('ppp-guest-key', cfg.secrets.guest);
        }
        if (cfg.xp) localStorage.setItem('ppp.state.v2', JSON.stringify({ xp: cfg.xp, minutes: cfg.minutes || 0, songId: 'demo' }));
        /* a clock the suite can move (the engine's budgets and waits are by Date.now): window.__skew milliseconds are added */
        if (cfg.skew) {
          window.__skew = 0;
          const real = Date.now.bind(Date);
          Date.now = () => real() + (window.__skew || 0);
        }
      } catch (e) { /* none */ }
    }, { locale: 'ko-KR', slots: opts.slots || null, cards: opts.cards || null, secrets: opts.secrets || null, xp: opts.xp || 0, minutes: opts.minutes || 0, skew: !!opts.skew });
    return new Dev(name, ctx, page);
  }

  /* n songs made by the page's own importer; B's: two of them the same scores as A's under other names, three of its own */
  async function prepSongs(n, small) {
    const prep = await newDevice('prep');
    await prep.page.goto(pageUrl, { waitUntil: 'networkidle2', timeout: 60000 });
    await ready(prep.page);
    const songs = await prep.page.evaluate(async (n2, small2) => {
      const xml = await fetch('samples/prelude-fragment.musicxml').then(r => r.text());
      const mk = (i, tag) => { const sc = PPP.scoreFromXml(xml, tag + ' ' + i + '.musicxml'); sc.title = tag + ' ' + i; sc.id = 'import:' + tag + i; return sc; };
      const slotOf = (i, tag) => {
        const sc = mk(i, tag), secs = {};
        (sc.sections || []).forEach(s => { secs[s.id] = { acc: 10 + i, mem: 0, reps: 1 }; });
        const hand = { expected: 4, matched: 3, timingAbsSum: 50, timingCount: 3 };
        const stat = { m: 1, attempts: 1 + (i % 4), expected: 8, matched: 6, wrong: 1, missed: 1, extra: 0, onTime: 5, early: 1, late: 0, timingAbsSum: 100, timingCount: 6, hands: { r: hand, l: hand }, tempos: {}, recent: [{ at: 1000 + i, acc: 0.75, tempo: 70, hands: 'both', timing: 16 }], lastAt: 1000 + i };
        const slot = {
          score: PPP.packScore(sc), secs: secs, history: { rev: 1, byMeasure: { 1: stat }, runs: [{ at: 1000 + i, from: 1, to: 2, hands: 'both', tempo: 70, simulated: false, accuracy: 0.8 }] },
          memory: { rev: 0, sections: {} }, loopFrom: 1, loopTo: Math.min(2, sc.measures.length), tempo: 60 + i, memLevel: 0, blindRuns: 0, mastered: false,
          fileName: sc.title + '.musicxml', fileMeta: '8 KB · MusicXML', importSource: { kind: 'musicxml' }, importReport: null
        };
        /* small: a tune of one bar, so that 500 of them fit in a browser's storage */
        if (small2) {
          const bar = slot.score.measures.slice(0, 1);
          slot.score = Object.assign({}, slot.score, { measures: bar, notes: slot.score.notes.slice(0, 6), sections: [] });
          slot.secs = {}; slot.loopTo = 1;
        }
        return slot;
      };
      const cards = [], slots = {};
      for (let i = 0; i < n2; i++) {
        const id = 'song-pa' + i, slot = slotOf(i, 'Song');
        cards.push({ id: id, title: 'Song ' + i, composer: 'Composer ' + i, kind: 'musicxml', url: null, addedAt: 1700000000000 + i * 1000, lastAt: 1700000000000 + i * 1000, prog: i % 100, mem: 0, measures: slot.score.measures.length });
        slots[id] = JSON.stringify(slot);
      }
      const bCards = [], bSlots = {};
      [5, 6].forEach(i => { const id = 'song-bsame' + i; bSlots[id] = slots['song-pa' + i]; bCards.push({ id: id, title: 'Song ' + i, composer: 'Composer ' + i, kind: 'musicxml', url: null, addedAt: 1700000500000 + i, lastAt: 1700000500000 + i, prog: 0, mem: 0, measures: cards[i].measures }); });
      for (let i = 0; i < 3; i++) { const id = 'song-bonly' + i, s = slotOf(100 + i, 'Mine'); bSlots[id] = JSON.stringify(s); bCards.push({ id: id, title: 'Mine ' + i, composer: 'B', kind: 'musicxml', url: null, addedAt: 1700000600000 + i, lastAt: 1700000600000 + i, prog: 0, mem: 0, measures: s.score.measures.length }); }
      const edited = [0, 1].map(i => slotOf(200 + i, 'Edited'));
      return { cards: cards, slots: slots, bCards: bCards, bSlots: bSlots, edited: edited.map(s => JSON.stringify(s)), measures: cards[0].measures };
    }, n, !!small);
    await prep.ctx.close();
    return songs;
  }

  return { Dev, newDevice, prepSongs, waitFor, sleep, ready };
}

module.exports = { make, sleep };
