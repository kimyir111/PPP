#!/usr/bin/env node
/* Deploy smoke check: ONE command, about a minute, read-only (GET requests and a throwaway browser profile: nothing is written to the site).

     node tests/live/smoke.js [--site https://ppp-web-2o99.onrender.com] [--sha 7ec61cb] [--pc-code-file <file>] [--logs]

   --sha        the commit that must be live: window.PPP_BUILD has to start with it (the first 7 characters are compared)
   --pc-code-file  a file holding (somewhere in it) the user's 64-hex PC code: opens `#pc=<code>` in a fresh profile and checks that the page
                removes the fragment, keeps the code, and that the server knows the link (GET /api/worker/status). The code is never printed.
   --logs       also reads `render logs` (read-only) and fails on error lines since the deploy (needs the render CLI)

   What it checks (each line PASS/FAIL, exit code 1 on any FAIL):
     /health ok; the page carries the expected build; a fresh profile loads with no page error and no failed request, with no /rec/ request at
     first paint; the app globals (PPP.recording, PPP.recordingArrange) have the intended defaults; anonymous routes answer as designed
     (auth/me, shares, the PC queue routes 401, no CORS headers); optionally the pairing link and the logs.
   It does NOT run the real transcription (6 minutes): that is for a change of the pipeline, by hand (docs/GOALS/G10 section 25). */
'use strict';
const fs = require('fs');
const https = require('https');
const http = require('http');
const { execFileSync } = require('child_process');

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const SITE = String(opt('--site', 'https://ppp-web-2o99.onrender.com')).replace(/\/+$/, '');
const SHA = opt('--sha', '');
const CODE_FILE = opt('--pc-code-file', '');
const WANT_LOGS = args.includes('--logs');

const results = [];
const check = (name, ok, detail) => { results.push({ name, ok: !!ok, detail: detail || '' }); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  - ' + detail : '')); };

function get(path, headers) {
  return new Promise(resolve => {
    const u = new URL(SITE + path);
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request(u, { method: 'GET', headers: headers || {}, timeout: 45000 }, res => {
      let body = '';
      res.on('data', c => { if (body.length < 3e6) body += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, headers: {}, body: '' }); });
    req.on('error', () => resolve({ status: 0, headers: {}, body: '' }));
    req.end();
  });
}
const json = s => { try { return JSON.parse(s); } catch (e) { return null; } };

async function main() {
  console.log('smoke check of ' + SITE + (SHA ? ' (expects ' + SHA + ')' : ''));
  // 1. server
  const h = await get('/health');
  check('/health answers ok', h.status === 200 && (json(h.body) || {}).ok === true, 'HTTP ' + h.status);
  const page = await get('/');
  const m = /PPP_BUILD="([^"]*)"/.exec(page.body);
  check('the page serves a build stamp', !!m, m ? m[1] : 'none');
  if (SHA) check('the live build is the expected commit', !!m && m[1].startsWith(SHA.slice(0, 7)), m ? m[1] + ' vs ' + SHA.slice(0, 7) : '');

  // 2. anonymous API
  const me = await get('/api/auth/me');
  check('/api/auth/me answers for a visitor', me.status === 200, 'HTTP ' + me.status);
  const shares = await get('/api/shares');
  const sj = json(shares.body);
  check('/api/shares lists shares', shares.status === 200 && sj && (Array.isArray(sj) || Array.isArray(sj.shares)), 'HTTP ' + shares.status);
  for (const p of ['/api/jobs', '/api/worker/status']) {
    const r = await get(p);
    check('anonymous ' + p + ' is refused (401), not an error', r.status === 401, 'HTTP ' + r.status);
    check('anonymous ' + p + ' sends no CORS header', !r.headers['access-control-allow-origin']);
  }

  // 3. a fresh browser profile
  let puppeteer;
  try { puppeteer = require('puppeteer'); } catch (e) { try { puppeteer = require('D:/PPP/node_modules/puppeteer'); } catch (e2) { puppeteer = null; } }
  if (!puppeteer) { check('puppeteer is available for the browser checks', false, 'npm install puppeteer'); return finish(); }
  const browser = await puppeteer.launch({ headless: 'new' });
  try {
    const ctx = await browser.createBrowserContext();
    const p = await ctx.newPage();
    await p.setViewport({ width: 400, height: 900 });
    const errors = [], failed = [], recReqs = [];
    p.on('pageerror', e => errors.push(String(e).slice(0, 140)));
    p.on('console', msg => { if (msg.type() === 'error' && !/\/helper\/|:8788|ERR_CONNECTION_REFUSED|status of 503/.test(msg.text())) errors.push(msg.text().slice(0, 140)); });
    p.on('response', r => { if (r.status() >= 400 && !/\/helper\/|:8788/.test(r.url()) && !/\/api\/(jobs|worker\/status)\b/.test(r.url())) failed.push(r.status() + ' ' + r.url().slice(0, 100)); });
    p.on('request', r => { if (r.url().includes('/rec/')) recReqs.push(r.url()); });
    await p.goto(SITE + '/', { waitUntil: 'networkidle2', timeout: 90000 });
    await new Promise(r => setTimeout(r, 1500));
    check('a fresh profile loads with no page or console error', errors.length === 0, errors.slice(0, 3).join(' | '));
    check('a fresh profile has no failed request (4xx/5xx)', failed.length === 0, failed.slice(0, 3).join(' | '));
    check('no /rec/ request at first paint', recReqs.length === 0, recReqs.length + ' requests');
    const g = await p.evaluate(() => ({ build: window.PPP_BUILD, rec: window.PPP && window.PPP.recording, lead: window.PPP && window.PPP.recordingArrange, arranger: window.PPP && window.PPP.arranger }));
    check('PPP.recording is v2 by default', g.rec === 'v2', String(g.rec));
    check('PPP.recordingArrange is the lead sheet by default', g.lead === 'leadsheet', String(g.lead));
    check('PPP.arranger is the one-note arranger by default', g.arranger === 'single', String(g.arranger));
    await ctx.close();

    // 4. the pairing link (read-only: the status route)
    if (CODE_FILE) {
      const codeMatch = fs.readFileSync(CODE_FILE, 'utf8').match(/[0-9a-f]{64}/i);
      if (!codeMatch) check('the PC code file holds a code', false, CODE_FILE);
      else {
        const code = codeMatch[0].toLowerCase();
        const st = await get('/api/worker/status', { 'X-PPP-PC': code });
        const stj = json(st.body) || {};
        check('the server knows the PC link of that code', st.status === 200 && !!stj.worker, 'HTTP ' + st.status);
        const ctx2 = await browser.createBrowserContext();
        const p2 = await ctx2.newPage();
        const reqs2 = [];
        p2.on('request', r => { if (r.url().includes('/api/')) reqs2.push({ url: r.url(), pc: !!r.headers()['x-ppp-pc'] }); });
        await p2.goto(SITE + '/#pc=' + code, { waitUntil: 'networkidle2', timeout: 90000 });
        await new Promise(r => setTimeout(r, 3000));
        const out = await p2.evaluate(() => ({ hash: location.hash, stored: localStorage.getItem('ppp.pclink.v1'), text: document.body.innerText.slice(0, 4000) }));
        let storedCode = null; try { storedCode = JSON.parse(out.stored).code; } catch (e) { /* none */ }
        check('the pairing link: the fragment is removed from the address bar', out.hash === '', JSON.stringify(out.hash));
        check('the pairing link: the page keeps the code (or asks first, when another link is held)', storedCode === code || /연결할까요|Connect this device/i.test(out.text), storedCode ? 'stored' : 'asked or not stored');
        check('the pairing link: the code is sent only in the X-PPP-PC header', reqs2.every(r => !r.url.includes(code)));
        await ctx2.close();
      }
    }
  } finally { await browser.close(); }

  // 5. logs
  if (WANT_LOGS) {
    try {
      const out = execFileSync('render', ['logs', '-r', 'srv-dalt5s6k1f9s739cuetg', '--limit', '150', '-o', 'text', '--confirm'], { encoding: 'utf8', timeout: 60000 });
      const bad = out.split(/\r?\n/).filter(l => /\b(error|exception|unhandled|ECONNREFUSED|queue: OFF)\b/i.test(l) && !/pg SSL|sslmode|DeprecationWarning/i.test(l));
      check('the server log has no error lines', bad.length === 0, bad.slice(0, 2).join(' | ').slice(0, 200));
    } catch (e) { check('the server log could be read', false, String(e.message).slice(0, 100)); }
  }
  finish();
}

function finish() {
  const failed = results.filter(r => !r.ok);
  console.log('\n' + (failed.length ? 'SMOKE FAILED: ' + failed.length + ' of ' + results.length : 'SMOKE PASSED: ' + results.length + ' checks'));
  process.exit(failed.length ? 1 : 0);
}

main().catch(e => { console.error('smoke crashed: ' + (e && e.stack || e)); process.exit(2); });
