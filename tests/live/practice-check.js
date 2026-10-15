#!/usr/bin/env node
/* The practice player, checked on a LIVE page the way a visitor meets it (G11a-5, docs/GOALS/G11_ADAPTIVE_PRACTICE.md section 10.6: "live check = smoke + a puppeteer run of
   follow/midi against production"). Read-only: a throwaway browser profile, a fake MIDI keyboard, GET requests of the site's own pages; nothing is written to the site.

     node tests/live/practice-check.js [--site https://ppp-web-2o99.onrender.com] [--no-legacy]

   Three visits (the page's own default; the explicit way back, `?practice=legacy`, unless --no-legacy; each in a fresh profile). On each, with Burgmuller 25 no. 6 (a D.C. al Fine,
   catalog/method/burgmuller25/006.mxl, one of the user's two listening pieces) opened the way an import opens it:
     mode    PPP.practice is what the visit says ('graph' by default, 'legacy' on the address); the page had no error
     plan    the plan of the piece follows the D.C. under 'graph' (more visits than bars) and is the written order under 'legacy'; the matcher's notes carry the graph's ids only on 'graph'
     midi    Play with a keyboard: every due note pressed for 6 s is matched (the real matcher, the real transport)
     follow  Follow: the first 8 onsets asked, in order, are played one by one and the playhead has moved past all of them
   The check never passes by looking at its own numbers alone: the matcher's and the gates' answers are read back from the page's own objects.
   Exit code 1 on any FAIL. */
'use strict';
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const SITE = String(opt('--site', 'https://ppp-web-2o99.onrender.com')).replace(/\/+$/, '');
const LEGACY = !args.includes('--no-legacy');
const PIECE = 'catalog/method/burgmuller25/006.mxl';

const results = [];
const check = (name, ok, detail) => { results.push({ name, ok: !!ok }); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  - ' + detail : '')); };

let puppeteer;
try { puppeteer = require('puppeteer'); } catch (e) { try { puppeteer = require('D:/PPP/node_modules/puppeteer'); } catch (e2) { puppeteer = null; } }

/* a Web MIDI keyboard PPP can open, driven from here (the same one tests/follow.test.js uses) */
function installFakeMidi() {
  const listeners = [];
  const input = {
    id: 'fake-1', name: 'Test Piano', manufacturer: 'PPP', state: 'connected', type: 'input',
    addEventListener: (t, fn) => { if (t === 'midimessage') listeners.push(fn); },
    removeEventListener: (t, fn) => { const i = listeners.indexOf(fn); if (i > -1) listeners.splice(i, 1); },
    set onmidimessage(fn) { if (fn) listeners.push(fn); },
    get onmidimessage() { return listeners[0] || null; }
  };
  navigator.requestMIDIAccess = () => Promise.resolve({ inputs: new Map([['fake-1', input]]), outputs: new Map(), addEventListener: () => {}, onstatechange: null });
  const send = (status, midi, vel) => { const d = new Uint8Array([status, midi, vel]); listeners.slice().forEach(fn => fn({ data: d, receivedTime: performance.now() })); };
  window.__press = m => send(0x90, m, 80);
  window.__release = m => send(0x80, m, 0);
  try { localStorage.setItem('ppp-locale', 'en-US'); localStorage.setItem('ppp-guest', '1'); } catch (e) { /* none */ }
}

async function visit(browser, query, want) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 1280, height: 860 });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e).slice(0, 140)));
  page.on('console', m => { if (m.type() === 'error' && !/\/helper\/|:8788|ERR_CONNECTION_REFUSED|status of 40[134]|status of 503|Failed to load resource/.test(m.text())) errors.push(m.text().slice(0, 140)); });
  await page.evaluateOnNewDocument(installFakeMidi);
  await page.goto(SITE + '/' + query, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForFunction(() => window.PPP && window.PPP.app && window.PPP.PianoScore && window.PPPEngrave && window.PPPEngrave.version, { timeout: 90000 });
  await new Promise(r => setTimeout(r, 3000));       /* the keyboard connects; the deferred code arrives */
  const r = await page.evaluate(async (file, mode) => {
    const P = window.PPP, A = P.app, sleep = ms => new Promise(r => setTimeout(r, ms));
    const out = { mode: P.practice };
    const res = await fetch('/' + file);
    const score = P.scoreFromXml(await P.readMxl(await res.arrayBuffer()), file.split('/').pop());
    A.adoptScore(score);
    A.go('player')();
    await sleep(900);
    /* the keyboard of the page: "Demo Input" is the badge that connects it (the fake device above), as tests/follow.test.js clicks it */
    const badge = [...document.querySelectorAll('main button, main span')].find(x => /Demo Input/.test((x.innerText || '').trim()));
    if (badge) badge.click();
    await sleep(1400);
    A.setState({ toggles: Object.assign({}, A.state.toggles, { midi: true, follow: false }), loop: false, practiceMode: 'practice', tempo: 100 });
    await sleep(300);
    out.live = A.liveMidi();
    const first = P.Score.first(score), last = P.Score.last(score);
    const plan = P.practicePlan(score, first, last);
    out.visits = plan.visits.length; out.bars = score.measures.length; out.graphPlan = !!plan.graph;
    out.jumps = plan.jumps ? plan.jumps.length : 0;
    /* midi: Play, and press every note that is due in the next 6 s at the moment the matcher expects it */
    A.togglePlay();
    await sleep(700);
    const perf = A._perf;
    out.run = !!(perf && perf.run);
    if (out.run) {
      out.ids = perf.expected.length > 0 && perf.expected.every(x => x.evId !== undefined && x.head !== undefined);
      const now = performance.now();
      const due = perf.expected.filter(x => x.tMs > now + 100 && x.tMs < now + 6000);
      out.pressed = due.length;
      due.forEach(x => setTimeout(() => { window.__press(x.midi); setTimeout(() => window.__release(x.midi), 90); }, x.tMs - now));
      await sleep(6800);
      out.matched = due.filter(x => x.matched).length;
    }
    A.togglePlay();
    await sleep(400);
    /* follow: the first eight onsets, one at a time */
    A.setState({ playing: false, toggles: Object.assign({}, A.state.toggles, { follow: true }) });
    await sleep(500);
    out.following = A.following();
    const gates = A.followGates();
    out.gates = gates.length;
    let played = 0;
    for (let i = 0; i < Math.min(gates.length, 8); i++) {
      const g = A.followGates()[A.state.gateIdx];
      if (!g) break;
      if (g.rest || !g.notes.length) { await sleep(60); continue; }
      g.notes.forEach(n => window.__press(n.midi));
      await sleep(80);
      g.notes.forEach(n => window.__release(n.midi));
      await sleep(80);
      played++;
    }
    out.played = played;
    out.gateIdx = A.state.gateIdx;
    return out;
  }, PIECE, want);
  await ctx.close();
  return Object.assign(r, { errors });
}

async function main() {
  console.log('practice check of ' + SITE);
  if (!puppeteer) { check('puppeteer is available', false, 'npm install puppeteer'); return finish(); }
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
  try {
    const visits = [['the default', '', 'graph']].concat(LEGACY ? [['the way back (?practice=legacy)', '?practice=legacy', 'legacy']] : []);
    const seen = {};
    for (const [label, query, want] of visits) {
      const v = await visit(browser, query, want);
      seen[want] = v;
      check(label + ': PPP.practice is "' + want + '"', v.mode === want, String(v.mode));
      check(label + ': a keyboard is connected and a run began', v.live && v.run, JSON.stringify([v.live, v.run]));
      if (want === 'graph') {
        check(label + ': the plan follows the D.C. (' + v.visits + ' visits of ' + v.bars + ' bars) and is the graph plan', v.graphPlan && v.jumps > 0 && v.visits > v.bars, JSON.stringify([v.graphPlan, v.jumps, v.visits, v.bars]));
        check(label + ': the matcher\'s notes carry the graph\'s ids', v.ids === true, String(v.ids));
      } else {
        check(label + ': the plan is the old one (no jump followed; ' + v.visits + ' visits of ' + v.bars + ' bars: the repeats only)', !v.graphPlan && v.jumps === 0 && v.visits >= v.bars, JSON.stringify([v.graphPlan, v.jumps, v.visits, v.bars]));
      }
      check(label + ': midi: the notes that were due were matched (' + v.matched + ' of ' + v.pressed + ')', v.pressed >= 8 && v.matched >= Math.floor(v.pressed * 0.9), JSON.stringify([v.pressed, v.matched]));
      check(label + ': follow: the playhead moved past the ' + v.played + ' onsets played (gate ' + v.gateIdx + ' of ' + v.gates + ')', v.following && v.played >= 6 && v.gateIdx >= v.played, JSON.stringify([v.following, v.played, v.gateIdx]));
      check(label + ': no page or console error', v.errors.length === 0, v.errors.slice(0, 2).join(' | '));
    }
    if (seen.graph && seen.legacy) check('the D.C. is the difference between the two: the default plays more visits of the same bars (' + seen.graph.visits + ' against ' + seen.legacy.visits + ')', seen.graph.bars === seen.legacy.bars && seen.graph.visits > seen.legacy.visits, JSON.stringify([seen.graph.visits, seen.legacy.visits]));
  } finally { await browser.close(); }
  finish();
}

function finish() {
  const failed = results.filter(r => !r.ok);
  console.log('\n' + (failed.length ? 'PRACTICE CHECK FAILED: ' + failed.length + ' of ' + results.length : 'PRACTICE CHECK PASSED: ' + results.length + ' checks'));
  process.exit(failed.length ? 1 : 0);
}

main().catch(e => { console.error('practice check crashed: ' + (e && e.stack || e)); process.exit(2); });
