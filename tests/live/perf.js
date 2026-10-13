#!/usr/bin/env node
/* G13-0 performance measurement of a RUNNING PPP site: cold load, repeat visit, third parties blocked, per-screen cost. READ-ONLY: GET requests
   and a throwaway browser profile (nothing is written to the site; any non-GET request to it is counted and fails the run). Not part of CI
   (it needs the network and the live site): the release checklist runs it (docs/RELEASE_CHECKLIST.md), numbers go in the PR and in docs/RELEASES.md.

     node tests/live/perf.js <mode>[,<mode>...] [--site https://ppp-web-2o99.onrender.com] [--runs 2] [--out report.json] [--check] [--path /Piano%20Coach%20App.dc.html]

   modes (G13 section 1, E2-E4, and the budgets of section 11):
     desktop    cold load, 1440x900, no throttling
     phone      cold load on the Lighthouse "mobile" profile: 150 ms RTT, 1.6 Mbps down, 750 kbps up, CPU 4x, 412x823 at DPR 2.625 (not a real device: U-K7)
     offline3p  cold load on the desktop profile with every host other than the site blocked (a CDN down): does Home render, are there page errors?
     repeat     the phone profile twice in one browser profile with the HTTP cache on: the second visit is the "repeat visit"
     screens    the phone profile, guest, Korean: the longest task, heap and DOM nodes after opening each screen, and after 10 s of practice playback
     all        every mode above
   --runs N     repeat each mode N times (default 2: the doc's "two runs each"), each in a fresh browser; the report gives every run and the median.
                Bytes, request counts, first paint and ready time reproduce within about 10% run to run; the longest task, TBT and the practice
                screen's task vary by 20-40% (a shared CPU), and the repeat visit's KB with how many of the 31 piano samples the first visit had
                finished downloading when it navigated away (the unfinished ones are fetched again: see audioKB): judge by the median.
   --out FILE   where the JSON report goes (default: a file in the temp directory; its path is printed)
   --check      exit 1 when a measured budget of section 11 is missed (without it the exit code is 0: today's site misses most of them by design)
   --settle MS  how long to keep measuring after the app is ready (default 8000 on the phone profile, 4000 otherwise)

   Exit codes: 0 report written (and, with --check, every measured budget met); 1 a budget missed (--check) or a mode failed to run;
   3 a non-GET request reached the site (this tool must never write). */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const http = require('http');

const args = process.argv.slice(2);
const VALUE_OPTS = ['--site', '--path', '--runs', '--out', '--settle'];
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : d; };
const positional = args.filter((a, i) => !a.startsWith('--') && !VALUE_OPTS.includes(args[i - 1]));
const SITE = String(opt('--site', 'https://ppp-web-2o99.onrender.com')).replace(/\/+$/, '');
const APP_PATH = opt('--path', '/Piano%20Coach%20App.dc.html');
const RUNS = Math.max(1, parseInt(opt('--runs', '2'), 10) || 2);
const SETTLE = opt('--settle', null);
const MODES = ['desktop', 'phone', 'offline3p', 'repeat', 'screens'];
const wanted = (positional.join(',') || 'phone').split(',').map(s => s.trim()).filter(Boolean).flatMap(m => (m === 'all' ? MODES : [m]));
const siteHost = new URL(SITE).host;
const sleep = ms => new Promise(r => setTimeout(r, ms));

// The Lighthouse "mobile" simulation, as G13 section 1 measured it.
const PHONE = {
  net: { offline: false, latency: 150, downloadThroughput: 1.6 * 1024 * 1024 / 8, uploadThroughput: 750 * 1024 / 8 },
  cpu: 4,
  viewport: { width: 412, height: 823, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true },
  ua: 'Mozilla/5.0 (Linux; Android 11; moto g power (2022)) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36'
};
const DESKTOP = { viewport: { width: 1440, height: 900 } };

// What G13 section 1 measured on 3567e27 on 2026-10-08 (E2 and E4): the numbers a fresh run is compared with ("within +-15%" is noise).
const DOC = {
  desktop: { requests: 139, ownRequests: 121, transferredKB: 3322, ownKB: 2692, fcp: 1530, readyMs: 1610, longTasks: 3, longTaskMaxMs: 150 },
  phone: { requests: 139, ownRequests: 121, transferredKB: 2987, ownKB: 2363, fcp: 8780, readyMs: 9290, longTaskSumMs: 1970, longTaskMaxMs: 1124, tbtMs: 421, heapMB: 42 },
  repeat: { requests: 139, servedFromCache: 33, kb: 2334, readyMs: 7031 },
  offline3p: { ownRequests: 72, blank: true },
  screens: { practiceMaxMs: 616, sharedDom: 14636, sharedHeapMB: 89, playingHeapMB: 90 }
};

// The budgets of G13 section 11. `get` reads a metric from the runs of a mode; `tol` is the room allowed on top of the target ("not worse").
const BUDGETS = [
  { id: 'cold-fcp', name: 'Cold first contentful paint (phone)', mode: 'phone', unit: 'ms', target: 4000, today: 8780, get: r => r.fcp },
  { id: 'cold-ready', name: 'Cold app ready (phone)', mode: 'phone', unit: 'ms', target: 5000, today: 9290, get: r => r.readyMs },
  { id: 'cold-bytes', name: 'Bytes transferred before ready, cold (phone)', mode: 'phone', unit: 'KB', target: 1200, today: 2987, get: r => r.bytesBeforeReadyKB,
    note: 'measured at the instant the app is ready; the doc\'s 2,987 KB is the total of the whole window (ready + 8 s), see "transferred KB" in the table against the doc' },
  { id: 'repeat-bytes', name: 'Repeat-visit bytes (phone)', mode: 'repeat', unit: 'KB', target: 450, today: 2334, get: r => r.second.kb },
  { id: 'repeat-ready', name: 'Repeat-visit ready (phone)', mode: 'repeat', unit: 'ms', target: 3000, today: 7031, get: r => r.second.readyMs },
  { id: 'tbt', name: 'Total blocking time at boot (phone)', mode: 'phone', unit: 'ms', target: 300, today: 421, get: r => r.tbtMs },
  { id: 'boot-task', name: 'Longest boot task (phone)', mode: 'phone', unit: 'ms', target: 500, today: 1124, get: r => r.longTaskMaxMs },
  { id: 'practice-task', name: 'Practice screen open, longest task (CPU 4x)', mode: 'screens', unit: 'ms', target: 400, today: 616, get: r => r.rows.practice && r.rows.practice.max },
  { id: 'shared-dom', name: 'Shared Scores DOM nodes (phone)', mode: 'screens', unit: 'nodes', target: 3000, today: 14636, get: r => r.rows.shared && r.rows.shared.dom },
  { id: 'shared-heap', name: 'Shared Scores JS heap (phone)', mode: 'screens', unit: 'MB', target: 60, today: 89, get: r => r.rows.shared && r.rows.shared.heapMB },
  { id: 'playing-heap', name: 'Heap after 10 s of practice playback', mode: 'screens', unit: 'MB', target: 100, today: 90, get: r => r.rows.playing && r.rows.playing.heapMB },
  { id: 'desktop-ready', name: 'Desktop cold ready (not worse than today)', mode: 'desktop', unit: 'ms', target: 1610, tol: 0.15, today: 1610, get: r => r.readyMs },
  // G13 section 10, gate 1: the core has no runtime third-party dependency (today the page is blank when unpkg is down)
  { id: 'offline-renders', name: 'Third parties blocked: Home renders (1 = yes)', mode: 'offline3p', unit: '', target: 1, dir: 'min', today: 0, get: r => (r.homeRendered ? 1 : 0) },
  { id: 'offline-errors', name: 'Third parties blocked: page errors', mode: 'offline3p', unit: '', target: 0, today: 1, get: r => r.pageErrors.length },
  { id: 'offline-attempts', name: 'Third parties blocked: requests attempted to unpkg.com', mode: 'offline3p', unit: '', target: 0, today: 2, get: r => r.third.filter(t => /(^|\.)unpkg\.com\//.test(t.url.replace(/^https?:\/\//, ''))).length }
];

const median = xs => { const v = xs.filter(x => typeof x === 'number' && isFinite(x)).sort((a, b) => a - b); return v.length ? (v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2) : null; };
const spreadPct = xs => { const v = xs.filter(x => typeof x === 'number' && isFinite(x)); const m = median(v); return v.length > 1 && m ? Math.round(100 * (Math.max(...v) - Math.min(...v)) / m) : 0; };

function loadPuppeteer() {
  for (const spec of ['puppeteer', process.env.PPP_PUPPETEER, 'D:/PPP/node_modules/puppeteer']) { if (!spec) continue; try { return require(spec); } catch (e) { /* next */ } }
  throw new Error('puppeteer is not installed (npm install puppeteer, or set PPP_PUPPETEER to its folder)');
}

function get(p) {
  return new Promise(resolve => {
    const u = new URL(SITE + p);
    const req = (u.protocol === 'https:' ? https : http).request(u, { method: 'GET', timeout: 60000 }, res => {
      let body = '';
      res.on('data', c => { if (body.length < 3e6) body += c; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, body: '' }); });
    req.on('error', () => resolve({ status: 0, body: '' }));
    req.end();
  });
}
/** Render's free instance sleeps: wake it first, so a run measures the page and not the boot of the server. Returns the live build stamp. */
async function wake() {
  const t0 = Date.now();
  for (let i = 0; i < 6; i++) { if ((await get('/health')).status === 200) break; await sleep(5000); }
  const page = await get('/');                                 // the build stamp is on `/` (window.PPP_BUILD), the way tests/live/smoke.js reads it
  await get(APP_PATH);
  console.log(`site awake (${Math.round((Date.now() - t0) / 1000)} s)`);
  const m = /PPP_BUILD="([^"]*)"/.exec(page.body);
  return m ? m[1] : null;
}

/** Collects what the network did, per visit, from the DevTools protocol. */
function tracker(cdp) {
  const t = { reqs: new Map(), fromCache: 0, bytes: 0, pageErrors: [], consoleErrors: [] };
  t.reset = () => { t.reqs = new Map(); t.fromCache = 0; t.bytes = 0; t.pageErrors = []; t.consoleErrors = []; };
  cdp.on('Network.requestWillBeSent', e => { t.reqs.set(e.requestId, { url: e.request.url, method: e.request.method, type: e.type }); });
  cdp.on('Network.responseReceived', e => {
    const r = t.reqs.get(e.requestId); if (!r) return;
    const h = k => e.response.headers[k] || e.response.headers[k[0].toUpperCase() + k.slice(1)] || '';
    r.status = e.response.status; r.enc = h('content-encoding'); r.cache = h('cache-control');
  });
  cdp.on('Network.requestServedFromCache', () => { t.fromCache++; });
  cdp.on('Network.loadingFinished', e => { const r = t.reqs.get(e.requestId); if (r) r.bytes = e.encodedDataLength; t.bytes += e.encodedDataLength; });
  cdp.on('Network.loadingFailed', e => { const r = t.reqs.get(e.requestId); if (r) r.failed = e.errorText; });
  return t;
}
const hostOf = u => { try { return new URL(u).host; } catch (e) { return ''; } };

async function newPage(browser, o) {
  const ctx = await browser.createBrowserContext();            // a throwaway profile: no cookies, no storage, no cache of an earlier run
  const page = await ctx.newPage();
  const cdp = await page.createCDPSession();
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: !o.cache });
  if (o.phone) {
    await cdp.send('Network.emulateNetworkConditions', PHONE.net);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: PHONE.cpu });
    await page.setViewport(PHONE.viewport);
    await page.setUserAgent(PHONE.ua);
  } else if (o.mobileViewport) {
    await page.setViewport(PHONE.viewport);                   // the per-screen run loads unthrottled and slows the CPU only after the load
  } else {
    await page.setViewport(DESKTOP.viewport);
  }
  if (o.blockThirdParties) {
    await page.setRequestInterception(true);                  // disables the HTTP cache: only used for the cold, cache-off profile
    page.on('request', r => { const h = hostOf(r.url()); if (h && h !== siteHost && !r.url().startsWith('data:')) r.abort('internetdisconnected'); else r.continue(); });
  }
  const t = tracker(cdp);
  page.on('pageerror', e => t.pageErrors.push(String(e.message).slice(0, 200)));
  page.on('console', m => { if (m.type() === 'error') t.consoleErrors.push(m.text().slice(0, 200)); });
  await page.evaluateOnNewDocument(guest => {
    window.__lt = []; window.__fcp = null; window.__lcp = null;
    try { new PerformanceObserver(l => { for (const e of l.getEntries()) window.__lt.push([Math.round(e.startTime), Math.round(e.duration)]); }).observe({ type: 'longtask', buffered: true }); } catch (e) { /* unsupported */ }
    try { new PerformanceObserver(l => { for (const e of l.getEntries()) if (e.name === 'first-contentful-paint') window.__fcp = Math.round(e.startTime); }).observe({ type: 'paint', buffered: true }); } catch (e) { /* unsupported */ }
    try { new PerformanceObserver(l => { const es = l.getEntries(); window.__lcp = Math.round(es[es.length - 1].startTime); }).observe({ type: 'largest-contentful-paint', buffered: true }); } catch (e) { /* unsupported */ }
    if (guest) { try { localStorage.setItem('ppp-guest', '1'); localStorage.setItem('ppp-locale', guest.locale); } catch (e) { /* private mode */ } }
  }, o.guest || null);
  return { page, cdp, t };
}

/** One visit of the app page: navigate, wait for the app to be ready (its navigation rendered), keep measuring for `settle` ms, and read the numbers. */
async function visit({ page, t }, settle) {
  t.reset();
  const t0 = Date.now();
  let navOk = true, readyBytes = null, readyReqs = null;
  try { await page.goto(SITE + APP_PATH, { waitUntil: 'load', timeout: 180000 }); } catch (e) { navOk = false; }
  const loadMs = Date.now() - t0;
  let readyMs = null;
  try {
    await page.waitForFunction(() => document.querySelectorAll('aside nav button').length >= 6 || document.querySelectorAll('nav button').length >= 4, { timeout: 60000, polling: 100 });
    readyMs = Date.now() - t0; readyBytes = t.bytes; readyReqs = t.reqs.size;
  } catch (e) { readyMs = null; }
  await sleep(settle);
  const m = await page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0] || {};
    return {
      fcp: window.__fcp, lcp: window.__lcp, dcl: Math.round(nav.domContentLoadedEventEnd || 0), longTasks: window.__lt.slice(),
      heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null, domNodes: document.getElementsByTagName('*').length,
      bodyText: (document.body ? document.body.innerText : '').slice(0, 160).replace(/\s+/g, ' '), react: !!window.React, build: window.PPP_BUILD || null,
      navButtons: document.querySelectorAll('aside nav button, nav button').length
    };
  });
  const list = [...t.reqs.values()];
  const own = list.filter(r => hostOf(r.url) === siteHost);
  const third = list.filter(r => { const h = hostOf(r.url); return h && h !== siteHost; });
  const kb = x => Math.round(x / 1024);
  const sum = xs => xs.reduce((s, r) => s + (r.bytes || 0), 0);
  const byHost = {};
  for (const r of list) { const h = hostOf(r.url) || 'data'; byHost[h] = byHost[h] || { n: 0, KB: 0, failed: 0 }; byHost[h].n++; byHost[h].KB += (r.bytes || 0) / 1024; if (r.failed) byHost[h].failed++; }
  for (const h of Object.keys(byHost)) byHost[h].KB = Math.round(byHost[h].KB);
  const lt = m.longTasks;
  const nonGet = list.filter(r => r.method && !['GET', 'HEAD', 'OPTIONS'].includes(r.method) && !r.url.startsWith('data:')).map(r => r.method + ' ' + r.url.slice(0, 120));
  return {
    navOk, build: m.build, loadMs, readyMs, fcp: m.fcp, lcp: m.lcp, dcl: m.dcl,
    requests: list.length, servedFromCache: t.fromCache, transferredKB: kb(sum(list)), bytesBeforeReadyKB: readyBytes == null ? null : kb(readyBytes), requestsBeforeReady: readyReqs,
    ownRequests: own.length, ownKB: kb(sum(own)), ownNoStore: own.filter(r => /no-store/.test(r.cache || '')).length, ownImmutable: own.filter(r => /immutable/.test(r.cache || '')).length,
    ownCompressed: own.filter(r => /gzip|br/.test(r.enc || '')).length, audioKB: kb(sum(own.filter(r => /[.]mp3([?]|$)/.test(r.url)))),
    longTasks: lt.length, longTaskSumMs: lt.reduce((s, x) => s + x[1], 0), longTaskMaxMs: lt.reduce((s, x) => Math.max(s, x[1]), 0),
    tbtMs: lt.filter(x => m.fcp == null || x[0] >= m.fcp).reduce((s, x) => s + Math.max(0, x[1] - 50), 0),
    heapMB: m.heapMB, domNodes: m.domNodes, byHost,
    third: third.map(r => ({ url: r.url.slice(0, 160), KB: kb(r.bytes || 0), status: r.status || 0, failed: r.failed || '' })),
    failed: list.filter(r => r.failed).map(r => r.url.slice(0, 120) + ' ' + r.failed),
    pageErrors: t.pageErrors.slice(), consoleErrors: t.consoleErrors.slice(0, 10), react: m.react, homeRendered: m.navButtons >= 4 && readyMs != null, bodyText: m.bodyText,
    nonGet,
    ownRequestList: own.map(r => ({ path: r.url.replace(SITE, '').slice(0, 140), status: r.status || 0, KB: kb(r.bytes || 0), enc: r.enc || '', cache: r.cache || '', failed: r.failed || '' }))
  };
}

async function runCold(browser, profile) {
  const phone = profile === 'phone';
  const p = await newPage(browser, { cache: false, phone, blockThirdParties: profile === 'offline3p' });
  const r = await visit(p, SETTLE != null ? +SETTLE : (phone ? 8000 : 4000));
  await p.page.close();
  return Object.assign({ profile }, r);
}

async function runRepeat(browser) {
  const p = await newPage(browser, { cache: true, phone: true });
  const settle = SETTLE != null ? +SETTLE : 6000;
  const pick = r => ({ readyMs: r.readyMs, fcp: r.fcp, requests: r.requests, servedFromCache: r.servedFromCache, kb: r.transferredKB, audioKB: r.audioKB, kbWithoutSamples: r.transferredKB - r.audioKB, ownNoStore: r.ownNoStore, ownImmutable: r.ownImmutable, nonGet: r.nonGet, pageErrors: r.pageErrors, build: r.build });
  const first = pick(await visit(p, settle));
  const second = pick(await visit(p, settle));
  await p.page.close();
  return { profile: 'repeat', first, second, nonGet: first.nonGet.concat(second.nonGet) };
}

/** Per-screen cost: guest, Korean (the labels below are the Korean navigation), CPU 4x. Clicks only navigate. */
async function runScreens(browser) {
  const p = await newPage(browser, { cache: true, mobileViewport: true, guest: { locale: 'ko-KR' } });
  const { page, cdp, t } = p;
  await page.goto(SITE + APP_PATH, { waitUntil: 'networkidle2', timeout: 180000 });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: PHONE.cpu });
  await sleep(2000);
  const mark = async () => page.evaluate(() => {
    const lt = window.__lt.splice(0);
    return { n: lt.length, max: lt.reduce((m, x) => Math.max(m, x[1]), 0), sum: lt.reduce((s, x) => s + x[1], 0), heapMB: performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : null, dom: document.getElementsByTagName('*').length };
  });
  const clickLabel = labels => page.evaluate(ls => {
    const els = [...document.querySelectorAll('button, a, [role=button]')];
    for (const l of ls) { const b = els.find(e => (e.innerText || '').trim().split('\n')[0].trim() === l); if (b) { b.click(); return l; } }
    return null;
  }, labels);
  const rows = { home: await mark() };
  const clicked = {};
  for (const [name, labels] of [['songs', ['내 곡']], ['practice', ['연습']], ['progress', ['실력']], ['sight', ['보고 치기']], ['course', ['교재 진도']], ['shared', ['악보 공유']]]) {
    clicked[name] = await clickLabel(labels);
    await sleep(4000);
    rows[name] = await mark();
  }
  clicked.practiceAgain = await clickLabel(['연습']);
  await sleep(3000); await mark();
  clicked.play = await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find(e => /재생|Play|▶/.test((e.getAttribute('aria-label') || '') + (e.innerText || '')));
    if (b) { b.click(); return (b.getAttribute('aria-label') || b.innerText || '').slice(0, 30); }
    return null;
  });
  await sleep(10000);
  rows.playing = await mark();
  const nonGet = [...t.reqs.values()].filter(r => r.method && !['GET', 'HEAD', 'OPTIONS'].includes(r.method)).map(r => r.method + ' ' + r.url.slice(0, 120));
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  const errors = t.pageErrors.slice();
  await page.close();
  return { profile: 'screens', rows, clicked, pageErrors: errors, nonGet, missedClicks: Object.entries(clicked).filter(([, v]) => v == null).map(([k]) => k) };
}

/** Median of a metric over a mode's runs, and the budget verdicts. */
function evaluate(results) {
  const rows = [];
  for (const b of BUDGETS) {
    const runs = results[b.mode];
    if (!runs || !runs.length) continue;
    const values = runs.map(r => { try { const v = b.get(r); return typeof v === 'number' ? v : null; } catch (e) { return null; } });
    const med = median(values);
    const limit = b.target * (1 + (b.tol || 0));
    const pass = med == null ? null : (b.dir === 'min' ? med >= b.target : med <= limit);
    rows.push({ id: b.id, name: b.name, unit: b.unit, runs: values, median: med == null ? null : Math.round(med * 10) / 10, target: b.target, today: b.today, pass, spreadPct: spreadPct(values), note: b.note || '' });
  }
  return rows;
}

/** The runs against the doc's E2 numbers, for "reproduces within +-15%". */
function againstDoc(results) {
  const rows = [];
  const add = (mode, metric, docKey, get) => {
    const runs = results[mode]; if (!runs || !runs.length || DOC[mode][docKey] == null) return;
    const values = runs.map(get), med = median(values), doc = DOC[mode][docKey];
    rows.push({ mode, metric, doc, runs: values, median: med == null ? null : Math.round(med * 10) / 10, vsDocPct: med == null ? null : Math.round(100 * (med - doc) / doc), within15: med == null ? null : Math.abs(med - doc) <= 0.15 * doc });
  };
  for (const mode of ['desktop', 'phone']) {
    add(mode, 'requests', 'requests', r => r.requests); add(mode, 'transferred KB', 'transferredKB', r => r.transferredKB); add(mode, 'own KB', 'ownKB', r => r.ownKB);
    add(mode, 'FCP ms', 'fcp', r => r.fcp); add(mode, 'ready ms', 'readyMs', r => r.readyMs); add(mode, 'long task max ms', 'longTaskMaxMs', r => r.longTaskMaxMs);
  }
  for (const mode of ['desktop', 'phone']) add(mode, 'own requests', 'ownRequests', r => r.ownRequests);
  add('phone', 'long task sum ms', 'longTaskSumMs', r => r.longTaskSumMs); add('phone', 'TBT ms', 'tbtMs', r => r.tbtMs);
  add('repeat', 'second visit KB', 'kb', r => r.second.kb); add('repeat', 'second visit ready ms', 'readyMs', r => r.second.readyMs);
  add('repeat', 'second visit requests', 'requests', r => r.second.requests); add('repeat', 'second visit served from cache', 'servedFromCache', r => r.second.servedFromCache);
  add('offline3p', 'own requests', 'ownRequests', r => r.ownRequests);
  return rows;
}

async function main() {
  for (const m of wanted) if (!MODES.includes(m)) { console.error(`unknown mode "${m}" (one of ${MODES.join(', ')}, all)`); return 2; }
  console.log(`perf: ${wanted.join(', ')} x ${RUNS} on ${SITE}${APP_PATH}`);
  const build = await wake();
  const puppeteer = loadPuppeteer();
  const results = {}, failures = [];
  let chrome = null;
  for (const mode of wanted) {
    results[mode] = [];
    for (let i = 1; i <= RUNS; i++) {
      const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--enable-precise-memory-info', '--autoplay-policy=no-user-gesture-required'] });
      try {
        chrome = chrome || await browser.version();
        const r = mode === 'repeat' ? await runRepeat(browser) : mode === 'screens' ? await runScreens(browser) : await runCold(browser, mode);
        results[mode].push(r);
        console.log(`  ${mode} run ${i}/${RUNS}: ` + (mode === 'repeat' ? `first ready ${r.first.readyMs} ms ${r.first.kb} KB, second ready ${r.second.readyMs} ms ${r.second.kb} KB, of which piano samples ${r.second.audioKB} KB, the rest ${r.second.kbWithoutSamples} KB (${r.second.servedFromCache} from cache)`
          : mode === 'screens' ? `practice ${r.rows.practice.max} ms, shared ${r.rows.shared.dom} nodes ${r.rows.shared.heapMB} MB, playing ${r.rows.playing.heapMB} MB`
          : `fcp ${r.fcp} ms, ready ${r.readyMs} ms, ${r.transferredKB} KB in ${r.requests} requests, long task max ${r.longTaskMaxMs} ms, ${r.pageErrors.length} page errors`));
      } catch (e) {
        failures.push(`${mode} run ${i}: ${e && e.message || e}`);
        console.log(`  ${mode} run ${i}/${RUNS}: FAILED ${e && e.message || e}`);
      } finally { await browser.close().catch(() => {}); }
    }
  }
  const budgets = evaluate(results), docRows = againstDoc(results);
  const nonGet = Object.values(results).flat().flatMap(r => r.nonGet || []);
  const report = { tool: 'tests/live/perf.js', finishedAt: new Date().toISOString(), site: SITE, path: APP_PATH, build, chrome, node: process.version, runs: RUNS, modes: wanted,
    budgets, againstDoc: docRows, readOnlyViolations: nonGet, failures, results };
  const out = opt('--out', path.join(os.tmpdir(), `ppp-perf-${new Date().toISOString().replace(/[:.]/g, '-')}.json`));
  fs.writeFileSync(out, JSON.stringify(report, null, 2));

  console.log(`\nbuild ${build}, ${chrome}`);
  if (docRows.length) {
    console.log('\nagainst the numbers in docs/GOALS/G13_PRODUCTIZATION.md (E2-E4, build 3567e27); +-15% is noise:');
    for (const r of docRows) console.log(`  ${r.within15 ? 'ok  ' : 'DIFF'} ${(r.mode + ' ' + r.metric).padEnd(36)} doc ${String(r.doc).padStart(6)}  runs ${r.runs.join(' / ').padEnd(16)} median ${String(r.median).padStart(7)}  ${r.vsDocPct == null ? '' : (r.vsDocPct >= 0 ? '+' : '') + r.vsDocPct + '%'}`);
  }
  console.log('\nbudgets of G13 section 11 (target; today = the doc):');
  for (const b of budgets) console.log(`  ${b.pass == null ? 'n/a ' : b.pass ? 'PASS' : 'MISS'} ${b.name.padEnd(54)} ${String(b.median).padStart(7)} ${b.unit.padEnd(5)} target ${String(b.target).padStart(5)}  today ${String(b.today).padStart(5)}  runs ${b.runs.join(' / ')}${b.spreadPct > 15 ? '  (runs differ by ' + b.spreadPct + '%)' : ''}`);
  for (const b of budgets) if (b.note) console.log(`  note (${b.id}): ${b.note}`);
  console.log(`\nJSON report: ${out}`);
  if (nonGet.length) { console.log(`\nFAIL: ${nonGet.length} non-GET request(s) reached the site: ${nonGet.slice(0, 5).join('; ')}`); return 3; }
  if (failures.length) { console.log('\nFAIL: ' + failures.join('; ')); return 1; }
  if (args.includes('--check') && budgets.some(b => b.pass === false)) { console.log('\nFAIL (--check): ' + budgets.filter(b => b.pass === false).map(b => b.id).join(', ')); return 1; }
  return 0;
}

main().then(code => { process.exitCode = code; }, e => { console.error(e); process.exitCode = 1; });
