/* ============================================================================
   PPP.learner (G11b-1): typed practice evidence and the run log
   docs/GOALS/G11_ADAPTIVE_PRACTICE.md G11-D4, G11-D5, G11-D6, decision U4; practice/runlog.js

   Real pages (headless Chrome against the tree's server), a fake MIDI keyboard, real laps. Sections (LL_ONLY=a,b runs some):
     switch    PPP.learner: default 'legacy', ?learner=, the remembered choice, garbage, a throwing storage, the setter (PPP.recording's idiom)
     identity  under 'legacy' a scripted practice session writes the localStorage aggregates byte for byte as the golden dump of the page before
               this phase (tests/practice/baselines/learner-legacy.json; node tests/learner-log.test.js --record writes it from a commit), and
               nothing new: no request for practice/runlog.js, no IndexedDB 'ppp-runlog'; under 'typed' the same session differs only by the
               `source` key of each run summary
     kinds     a measured lap, a Follow lap, a recall lap and a Demo Input lap are logged as what they are; a simulated run never reaches evidence
     log       the cap of 300 (the oldest goes), 2 KB per run, a new music hash = a new epoch (the old one read-only), ratings, the export
               round trip, the file carries nothing but practice, a song removed takes its log
     failures  storage full, blocked storage, a database that will not open, one that never answers, a damaged log: the page keeps working,
               the log is given up once and counted, no message
     budget    the lap's share of the log at CPU 4x on the 1,776-note Sonatina, and 2 KB for every run of a whole-piece lap
     demo      PPP.demoRuns (decision U4, OFF): 'separate' keeps Demo Input out of history and memory under 'typed' only
     ui        Settings > Practice log and the rating row exist only under 'typed', in four languages
   Needs puppeteer; 127.0.0.1:8777 (tests/engrave/tools/with-port.js rewrites it; tests/practice/run-suites.js does).
   ========================================================================== */
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const puppeteer = require('puppeteer');
const { preparePage } = require('./boot');

const PAGE = 'Piano Coach App.dc.html';
const BASE = 'http://127.0.0.1:8777/Piano%20Coach%20App.dc.html';
const GOLDEN = path.join(__dirname, 'practice', 'baselines', 'learner-legacy.json');
const errors = [];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ok = (name, cond, detail) => {
  console.log((cond ? '  ✓ ' : '  ✗ ') + name + (detail ? ' — ' + detail : ''));
  if (!cond) errors.push(name + (detail ? ' — ' + detail : ''));
};
const ONLY = (process.env.LL_ONLY || '').split(',').filter(Boolean);
const want = name => !ONLY.length || ONLY.indexOf(name) >= 0;
const RECORD = process.argv.includes('--record');

/* ---------------------------------------------------------------- in the page, before its scripts */
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
  const send = (status, midi, vel) => {
    const d = new Uint8Array([status, midi, vel]);
    listeners.slice().forEach(fn => fn({ data: d, receivedTime: performance.now() }));
  };
  window.__press = m => send(0x90, m, 80);
  window.__release = m => send(0x80, m, 0);
}

/* ---------------------------------------------------------------- pages */
async function open(browser, o) {
  o = o || {};
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  const probe = { errors: [], requests: [], toasts: [] };
  page.on('pageerror', e => probe.errors.push(e.message));
  page.on('request', r => { if (/practice\/runlog/.test(r.url())) probe.requests.push(r.url()); });
  await preparePage(page);
  if (o.midi) await page.evaluateOnNewDocument(installFakeMidi);
  for (const [fn, arg] of o.init || []) await page.evaluateOnNewDocument(fn, arg);
  if (o.cpu) { const cdp = await page.target().createCDPSession(); await cdp.send('Emulation.setCPUThrottlingRate', { rate: o.cpu }); }
  await page.goto((o.base || BASE) + (o.query || ''), { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => window.PPP && window.PPP.app && window.PPP.PianoScore, { timeout: 60000 });
  await sleep(o.settle || 1200);
  return { ctx, page, probe, close: () => ctx.close() };
}
const toPractice = async (page, connect) => {
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('aside nav button')].find(x => /^Practice/.test((x.innerText || '').trim()));
    if (b) b.click(); else PPP.app.setState({ screen: 'player' });   /* another language's label: the same screen */
  });
  await sleep(900);
  if (connect) {
    await page.evaluate(() => {
      const b = [...document.querySelectorAll('main button, main span')].find(x => /Demo Input/.test((x.innerText || '').trim()));
      if (b) b.click(); else PPP.app.connectMidi();
    });
    await sleep(1400);
  }
};
const toSettings = async page => {
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('aside nav button')].find(x => /^Settings/.test((x.innerText || '').trim()));
    if (b) b.click(); else PPP.app.setState({ screen: 'settings' });
  });
  await sleep(900);
};
const dbNames = page => page.evaluate(() => (indexedDB.databases ? indexedDB.databases().then(l => l.map(d => d.name)) : []));

/* ---------------------------------------------------------------- in the page: laps */
/* a real clock lap on a fake keyboard: press the due notes (all but the ones `skip(i)` names), wait until the lap is counted, stop */
function realLapInPage(o) {
  return (async () => {
    const A = window.PPP.app, sl = ms => new Promise(r => setTimeout(r, ms));
    A.setState({ toggles: Object.assign({}, A.state.toggles, { follow: false }), practiceMode: o.mode || 'practice', loop: true, tempo: o.tempo || 200, hands: o.hands || 'both', hints: o.hints || [] });
    A.setLoop(o.from || 1, o.to || 2);
    await sl(300);
    const l0 = A.state.laps;
    if (o.mode === 'memory') A.startRecall(); else A.togglePlay();
    await sl(250);
    const perf = A._perf, now = performance.now();
    let pressed = 0;
    if (perf && perf.run && o.press !== false) {
      perf.expected.forEach((x, i) => {
        if (i % 5 === 4) return;
        pressed++;
        setTimeout(() => { window.__press(x.midi); setTimeout(() => window.__release(x.midi), 60); }, Math.max(0, x.tMs - now) + (i % 3) * 20 - 20);
      });
    }
    const t0 = performance.now();
    while (A.state.laps === l0 && performance.now() - t0 < 20000) await sl(100);
    const counted = A.state.laps > l0;
    if (A.state.playing) A.togglePlay();
    await sl(500);
    return { counted: counted, pressed: pressed, live: A.liveMidi() };
  })();
}
/* a Follow lap: play every gate's notes in order until the lap is counted */
function followLapInPage(o) {
  return (async () => {
    const A = window.PPP.app, sl = ms => new Promise(r => setTimeout(r, ms));
    A.setState({ toggles: Object.assign({}, A.state.toggles, { follow: true }), practiceMode: 'practice', loop: true, hands: 'both', hints: [] });
    A.setLoop(o.from || 1, o.to || 2);
    await sl(400);
    const l0 = A.state.laps;
    const following = A.following();
    for (let i = 0; i < 120 && A.state.laps === l0; i++) {
      const gates = A.followGates();
      let gi = A.state.gateIdx || 0;
      while (gi < gates.length && !(gates[gi].notes && gates[gi].notes.length)) gi++;
      const g = gates[gi];
      if (!g) { await sl(60); continue; }
      g.notes.forEach(n => window.__press(n.midi));
      await sl(40);
      g.notes.forEach(n => window.__release(n.midi));
      await sl(40);
    }
    await sl(300);
    return { counted: A.state.laps > l0, following: following };
  })();
}
function lastRunInPage() {
  const h = window.PPP.app.state.history;
  return h.runs[h.runs.length - 1];
}

/* ---------------------------------------------------------------- 1. the switch */
async function switchSection(browser) {
  console.log('\n── PPP.learner: the same switch as PPP.recording ──');
  const KEY = 'ppp.learner.v1';
  const stored = v => [(a) => { localStorage.setItem(a[0], a[1]); }, [KEY, v]];
  const mode = async (query, init) => {
    const p = await open(browser, { query: query, init: init || [] });
    const r = await p.page.evaluate(() => ({ learner: PPP.learner, demo: PPP.demoRuns, mod: typeof window.PPPRunLog, key: (() => { try { return localStorage.getItem('ppp.learner.v1'); } catch (e) { return 'throws'; } })(), app: !!PPP.app }));
    r.requests = p.probe.requests.length; r.dbs = await dbNames(p.page); r.errors = p.probe.errors;
    await p.close();
    return r;
  };
  const a = await mode('');
  ok('the default is legacy', a.learner === 'legacy' && a.demo === 'count', a.learner + ' / ' + a.demo);
  ok('and then practice/runlog.js is not even requested, there is no PPPRunLog and no IndexedDB ppp-runlog', a.requests === 0 && a.mod === 'undefined' && a.dbs.indexOf('ppp-runlog') < 0 && a.key === null, JSON.stringify({ requests: a.requests, mod: a.mod, dbs: a.dbs }));
  const b = await mode('?learner=typed');
  ok('?learner=typed makes this visit typed and loads the module once', b.learner === 'typed' && b.mod === 'object' && b.requests === 1, JSON.stringify({ requests: b.requests, mod: b.mod }));
  ok('and a choice made in the address is not remembered', b.key === null);
  const c = await mode('', [stored('typed')]);
  ok('a remembered typed is typed', c.learner === 'typed' && c.mod === 'object');
  const d1 = await mode('', [stored('adaptive')]);
  const d2 = await mode('', [stored('TYPED')]);
  const d3 = await mode('?learner=junk');
  const d4 = await mode('?learner=Typed');
  ok('anything else (a typo, another phase\'s word, the wrong case) is no choice and the default is legacy', d1.learner === 'legacy' && d2.learner === 'legacy' && d3.learner === 'legacy' && d4.learner === 'legacy' && d1.requests + d2.requests + d3.requests + d4.requests === 0,
    [d1, d2, d3, d4].map(x => x.learner).join(','));
  const e = await mode('?learner=legacy', [stored('typed')]);
  ok('the address beats the remembered choice', e.learner === 'legacy' && e.mod === 'undefined');
  const f = await mode('', [[a2 => {
    localStorage.setItem(a2[0], a2[1]);
    const get = Storage.prototype.getItem;
    Storage.prototype.getItem = function (k) { if (k === a2[0]) throw new DOMException('denied', 'SecurityError'); return get.call(this, k); };
  }, [KEY, 'typed']]]);
  ok('a storage that throws on the read is legacy, and the page boots', f.learner === 'legacy' && f.app && f.errors.length === 0, f.learner + ' ' + f.errors.join('|'));
  const g = await mode('?learner=typed', [[a2 => {
    const get = Storage.prototype.getItem;
    Storage.prototype.getItem = function (k) { if (k === a2) throw new DOMException('denied', 'SecurityError'); return get.call(this, k); };
  }, KEY]]);
  ok('while the address still decides when the storage is closed to it', g.learner === 'typed');

  const p = await open(browser);
  const s1 = await p.page.evaluate(() => { PPP.learner = 'typed'; return { m: PPP.learner, key: localStorage.getItem('ppp.learner.v1') }; });
  await p.page.waitForFunction(() => !!window.PPPRunLog, { timeout: 8000 }).catch(() => {});
  const s2 = await p.page.evaluate(() => { const had = !!window.PPPRunLog; PPP.learner = 'junk'; return { had: had, m: PPP.learner, key: localStorage.getItem('ppp.learner.v1') }; });
  ok('the setter remembers a choice and loads the module', s1.m === 'typed' && s1.key === 'typed' && s2.had, JSON.stringify([s1, s2]));
  ok('a value that is no choice puts the default back and forgets the remembered one', s2.m === 'legacy' && s2.key === null);
  const s3 = await p.page.evaluate(() => { PPP.demoRuns = 'separate'; const a = [PPP.demoRuns, localStorage.getItem('ppp.demoRuns.v1')]; PPP.demoRuns = 'x'; return a.concat([PPP.demoRuns, localStorage.getItem('ppp.demoRuns.v1')]); });
  ok('PPP.demoRuns has the same shape (count is the default)', s3[0] === 'separate' && s3[1] === 'separate' && s3[2] === 'count' && s3[3] === null, JSON.stringify(s3));
  await p.close();
}

/* ---------------------------------------------------------------- 2. byte identity under legacy */
/* a scripted practice session: ten laps of every kind through the app's own completeLap, a seeded Math.random and the app's injectable clock;
   returns what the legacy readers can see afterwards (the localStorage of the page, the state they read) */
function scenarioInPage() {
  return (async () => {
    const PPP = window.PPP, app = PPP.app, sl = ms => new Promise(r => setTimeout(r, ms));
    let seed = 20261008;
    const lcg = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    const withSeed = fn => { const keep = Math.random; Math.random = lcg; try { return fn(); } finally { Math.random = keep; } };
    let clock = 1760000000000;
    PPP.Clock.now = () => clock;
    const score = app.state.score;
    const PLAN = ['ok', 'ok', 'late', 'ok', 'miss', 'early', 'ok', 'wrong'];
    const engine = (from, to, hands, tempo, mode, off) => {
      const e = new PPP.PerformanceEngine(score).begin({ from: from, to: to, hands: hands, tempo: tempo, practiceMode: mode, startedAt: 1000 });
      e.expected.forEach((x, i) => {
        const k = PLAN[(i + off) % PLAN.length];
        if (k === 'miss') return;
        e.noteOn({ midi: x.midi, t: x.tMs + (k === 'late' ? 90 : k === 'early' ? -70 : k === 'ok' ? 12 : 0), type: 'on' });
        if (k === 'wrong') e.noteOn({ midi: x.midi + 1, t: x.tMs + 5, type: 'on' });
      });
      e.noteOn({ midi: 21, t: 1000 + 99999, type: 'on' });
      e.advanceTo(1e9);
      return e;
    };
    const lap = async (S, e, result, extra) => {
      if (e) app._perf = e;
      const res = result || e.result();
      const patch = withSeed(() => app.completeLap(S, res ? res.counts ? res.counts.matched : res.matched : 0, res ? res.counts ? res.counts.expected : res.expected : 0, res));
      app.setState(Object.assign(patch, extra || {}));
      clock += 90000;
      await sl(140);
    };
    const set = async patch => { app.setState(patch); await sl(140); };
    const base = { loop: true, practiceMode: 'practice', hands: 'both', tempo: 84, hints: [], memReveal: false };

    await set(Object.assign({ loopFrom: 1, loopTo: 4 }, base));
    await lap(app.state, engine(1, 4, 'both', 84, 'practice', 0));
    await lap(app.state, engine(1, 4, 'both', 84, 'practice', 3));
    await set(Object.assign({ loopFrom: 1, loopTo: 4, hands: 'left', tempo: 63 }, base, { hands: 'left', tempo: 63 }));
    await lap(app.state, engine(1, 4, 'left', 63, 'practice', 1));
    await set(Object.assign({}, base, { loopFrom: 5, loopTo: 8, hands: 'right', tempo: 42 }));
    await lap(app.state, engine(5, 8, 'right', 42, 'practice', 5));
    /* a recall with two hints */
    await set(Object.assign({}, base, { loopFrom: 1, loopTo: 4, practiceMode: 'memory', hints: ['a', 'b'] }));
    await lap(app.state, engine(1, 4, 'both', 84, 'memory', 2));
    /* Follow: its result has the shape followFinish makes */
    await set(Object.assign({}, base, { loopFrom: 1, loopTo: 2 }));
    const hand = (t, m) => ({ total: t, matched: m, timingAbsSum: 0, timingCount: 0 });
    const fol = { byMeasure: { 1: { total: 7, matched: 7, missed: 0, wrong: 2, extra: 2, onTime: 7, early: 0, late: 0, timingAbsSum: 0, timingCount: 0, accuracy: 1, hands: { r: hand(4, 4), l: hand(3, 3) } },
      2: { total: 5, matched: 5, missed: 0, wrong: 0, extra: 0, onTime: 5, early: 0, late: 0, timingAbsSum: 0, timingCount: 0, accuracy: 1, hands: { r: hand(3, 3), l: hand(2, 2) } } },
      bySection: {}, expected: 12, matched: 12, accuracy: 1, meanDeltaMs: 0, timing: null, follow: true };
    await lap(app.state, null, fol);
    /* Demo Input: three lap-end results of the random kind, one in a recall */
    for (let k = 0; k < 3; k++) {
      await set(Object.assign({}, base, { loopFrom: 1 + 4 * k, loopTo: 4 + 4 * k, tempo: 84 + 20 * k }));
      app._sim = app.newSim();
      const S = app.state;
      const ev = withSeed(() => app.fire(S, 0, 1e6));
      const patch = withSeed(() => app.completeLap(S, ev.hit, ev.tot, null));
      app.setState(patch); clock += 90000; await sl(140);
    }
    await set(Object.assign({}, base, { loopFrom: 1, loopTo: 4, practiceMode: 'memory' }));
    app._sim = app.newSim();
    { const S = app.state; const ev = withSeed(() => app.fire(S, 0, 1e6)); const patch = withSeed(() => app.completeLap(S, ev.hit, ev.tot, null)); app.setState(patch); clock += 90000; await sl(140); }
    app.saveNow();
    await sl(400);
    const ls = {};
    Object.keys(localStorage).filter(k => k.indexOf('ppp.') === 0).sort().forEach(k => { ls[k] = localStorage.getItem(k); });
    const st = app.state;
    return { ls: ls, history: JSON.stringify(st.history), memory: JSON.stringify(st.memory), secs: JSON.stringify(st.secs), laps: st.laps, minutes: st.minutes, xp: st.xp, sessions: JSON.stringify(st.sessions) };
  })();
}
/* the same dump with the kind of each run summary taken out (what a 'legacy' reader never had) */
function withoutSource(dump) {
  const strip = h => { if (h && Array.isArray(h.runs)) h.runs.forEach(r => { delete r.source; }); return h; };
  const out = JSON.parse(JSON.stringify(dump));
  out.history = JSON.stringify(strip(JSON.parse(dump.history)));
  Object.keys(out.ls).forEach(k => {
    let v; try { v = JSON.parse(out.ls[k]); } catch (e) { return; }
    if (v && v.history) { strip(v.history); out.ls[k] = JSON.stringify(v); }
  });
  return out;
}
const sha = t => crypto.createHash('sha256').update(t).digest('hex');
const dig = t => ({ bytes: Buffer.byteLength(t), sha256: sha(t) });
/* what the golden file keeps of a dump: the size and SHA-256 of every localStorage value and of the state the legacy readers use (a 190 KB dump three times over is not
   something to commit), and the run list in the clear, which is what shows a person what a difference is about */
const digestOf = d => ({
  ls: Object.keys(d.ls).sort().reduce((o, k) => { o[k] = dig(d.ls[k]); return o; }, {}),
  history: dig(d.history), memory: dig(d.memory), secs: dig(d.secs), laps: d.laps, minutes: d.minutes, xp: d.xp, sessions: d.sessions,
  runs: JSON.parse(d.history).runs.map(r => [r.from, r.to, r.hands, r.tempo, r.simulated, Math.round(r.accuracy * 1000) / 1000, (r.counts || {}).expected, (r.counts || {}).matched])
});
const canon = d => JSON.stringify(digestOf(d), null, 1);

async function identitySection(browser, base) {
  console.log('\n── PPP.learner = legacy: the aggregates are the golden dump, byte for byte ──');
  const run = async query => {
    /* the clock stands still from the first script on: the sample song's seeded history is made from Date.now() when the page opens */
    const p = await open(browser, { query: query, base: base, init: [[() => { Date.now = () => 1760000000000; }, null]] });
    await toPractice(p.page, false);
    const dump = await p.page.evaluate(scenarioInPage);
    const dbs = await dbNames(p.page);
    const out = { dump: dump, requests: p.probe.requests.length, dbs: dbs, errors: p.probe.errors, mod: await p.page.evaluate(() => typeof window.PPPRunLog) };
    await p.close();
    return out;
  };
  const legacy = await run('');
  if (RECORD) {
    fs.mkdirSync(path.dirname(GOLDEN), { recursive: true });
    fs.writeFileSync(GOLDEN, canon(legacy.dump) + '\n');
    console.log('golden written: ' + GOLDEN + ' (' + Object.keys(legacy.dump.ls).length + ' keys, history ' + legacy.dump.history.length + ' bytes)');
    return;
  }
  const golden = fs.readFileSync(GOLDEN, 'utf8').replace(/\r\n/g, '\n');
  const same = canon(legacy.dump) + '\n' === golden;
  const gd = JSON.parse(golden), nd = digestOf(legacy.dump);
  const diffKeys = same ? [] : ['history', 'memory', 'secs', 'laps', 'minutes', 'xp', 'sessions'].filter(k => JSON.stringify(gd[k]) !== JSON.stringify(nd[k]))
    .concat(Object.keys(Object.assign({}, gd.ls, nd.ls)).filter(k => JSON.stringify(gd.ls[k]) !== JSON.stringify(nd.ls[k])));
  ok('a session of ten laps (measured x4, a recall, Follow, Demo Input x4) leaves the legacy aggregates exactly as the page before this phase did', same, same ? Object.keys(legacy.dump.ls).length + ' keys, history ' + legacy.dump.history.length + ' bytes, sha256 ' + nd.history.sha256.slice(0, 12) : 'differs in ' + diffKeys.join(', '));
  ok('and no run summary names its kind', !/"source"/.test(legacy.dump.history) && !/"source"/.test(JSON.stringify(legacy.dump.ls)));
  ok('nothing new was loaded or opened: no request for practice/runlog.js, no PPPRunLog, no IndexedDB ppp-runlog, no new localStorage key', legacy.requests === 0 && legacy.mod === 'undefined' && legacy.dbs.indexOf('ppp-runlog') < 0 && Object.keys(legacy.dump.ls).every(k => !/learner|runlog|demoRuns/.test(k)), JSON.stringify({ r: legacy.requests, dbs: legacy.dbs }));
  ok('the golden dump is a real session: the ten laps come on top of the seeded history of the sample, with a memory record and section progress', gd.runs.length >= 10 && legacy.dump.memory.length > 40 && gd.laps >= 8 && Object.keys(gd.ls).length >= 2 && gd.runs.slice(-10).filter(r => r[4] === true).length === 4 && gd.runs.slice(-10).filter(r => r[4] === false).length === 6, 'runs ' + gd.runs.length + ', laps ' + gd.laps);

  const typed = await run('?learner=typed');
  const strippedSame = canon(withoutSource(typed.dump)) + '\n' === golden;
  ok('under typed, with demoRuns count, the same session differs from the golden only by the `source` of each run summary', strippedSame);
  const kinds = JSON.parse(typed.dump.history).runs.slice(-10).map(r => r.source).join(',');
  ok('and each summary names what the run was: measured x4, a recall, Follow, simulated x4', kinds === 'measured,measured,measured,measured,memory,follow,simulated,simulated,simulated,simulated', kinds);
  ok('typed and legacy pages both ran without a page error', legacy.errors.length === 0 && typed.errors.length === 0, legacy.errors.concat(typed.errors).join('|'));
}

/* ---------------------------------------------------------------- 3. the kinds of run, end to end */
async function kindsSection(browser) {
  console.log('\n── typed: a measured, a Follow, a recall and a Demo Input lap are logged as what they are ──');
  const p = await open(browser, { query: '?learner=typed', midi: true });
  await toPractice(p.page, true);
  const read = async () => p.page.evaluate(async () => { const log = PPP.runLog.log; const e = await log.epochs(); const h = e.epochs[0] && e.epochs[0].hash; const r = h ? await log.read('demo', h) : null; return { epochs: e.epochs, runs: r ? r.runs : [] }; });

  // measured
  const m = await p.page.evaluate(realLapInPage, { mode: 'practice', from: 1, to: 2 });
  const hm = await p.page.evaluate(lastRunInPage);
  const s1 = await read();
  const run1 = s1.runs[s1.runs.length - 1] && s1.runs[s1.runs.length - 1].run;
  ok('a measured lap (fake keyboard, clock run) is logged with src measured', m.counted && m.live && hm.source === 'measured' && run1 && run1.src === 'measured', JSON.stringify({ hist: hm.source, log: run1 && run1.src }));
  ok('with the rows of the matcher: per measure index and hand the expected and matched notes, the signed and absolute timing, the missed note ids', run1 && run1.R.length >= 2 && run1.md === 'practice' && run1.hd === 'b' && run1.ht > 0 && run1.ht < run1.ex &&
    run1.R.every(r => r[4] !== null && r[5] !== null) && run1.R.some(r => Array.isArray(r[6]) && r[6].length) && run1.f === 0 && run1.t === 1, run1 && JSON.stringify(run1.R));
  ok('the numbers agree with the history the legacy readers use', run1 && hm.counts.expected === run1.ex && hm.counts.matched === run1.ht && Math.abs(hm.accuracy - run1.ac) < 0.001);

  // Follow
  const tb = () => p.page.evaluate(() => { const t = PPP.app.state.history.byMeasure[1].tempos; return { 50: (t[50] || {}).expected || 0, 75: (t[75] || {}).expected || 0, 100: (t[100] || {}).expected || 0 }; });
  const tempos0 = await tb();
  const fo = await p.page.evaluate(followLapInPage, { from: 1, to: 2 });
  const hf = await p.page.evaluate(lastRunInPage);
  const s2 = await read();
  const run2 = s2.runs[s2.runs.length - 1] && s2.runs[s2.runs.length - 1].run;
  ok('a Follow lap is logged with src follow', fo.counted && fo.following && hf.source === 'follow' && run2 && run2.src === 'follow', JSON.stringify({ hist: hf.source, log: run2 && run2.src, counted: fo.counted }));
  ok('a Follow row has no timing at all (null signed and absolute means)', run2 && run2.R.length > 0 && run2.R.every(r => r[4] === null && r[5] === null), run2 && JSON.stringify(run2.R.slice(0, 2)));
  const tempos1 = await tb();
  ok('and Follow never counts for timing or tempo (the legacy rule, unchanged): measure 1 gained notes in the 50 % bucket and none in the 75 or 100 % ones', tempos1[50] > tempos0[50] && tempos1[75] === tempos0[75] && tempos1[100] === tempos0[100], JSON.stringify([tempos0, tempos1]));

  // a recall
  await p.page.evaluate(() => { PPP.app.setState({ toggles: Object.assign({}, PPP.app.state.toggles, { follow: false }) }); });
  const re = await p.page.evaluate(realLapInPage, { mode: 'memory', from: 1, to: 2, hints: ['a'] });
  const hr = await p.page.evaluate(lastRunInPage);
  const s3 = await read();
  const run3 = s3.runs[s3.runs.length - 1] && s3.runs[s3.runs.length - 1].run;
  ok('a recall lap is logged with src memory, md memory, and its hints', re.counted && hr.source === 'memory' && run3 && run3.src === 'memory' && run3.md === 'memory' && run3.hn === 1, JSON.stringify({ hist: hr.source, log: run3 && { s: run3.src, md: run3.md, hn: run3.hn, lv: run3.lv } }));

  // Demo Input: no keyboard
  const before = (await read()).runs.length;
  const ev0 = await p.page.evaluate(async () => (await PPP.runLog.log.evidence('demo', (await PPP.runLog.log.epochs()).epochs[0].hash)).runs.length);
  await p.page.evaluate(() => {
    const A = PPP.app;
    // the keyboard goes away: Demo Input
    A.setState({ toggles: Object.assign({}, A.state.toggles, { midi: false }), practiceMode: 'practice' });
  });
  await sleep(300);
  const dm = await p.page.evaluate(async () => {
    const A = PPP.app, sl = ms => new Promise(r => setTimeout(r, ms));
    const live = A.liveMidi();
    A.setState({ practiceMode: 'practice', loop: true, tempo: 200, hands: 'both' }); A.setLoop(1, 2); await sl(300);
    const l0 = A.state.laps; A.togglePlay();
    const t0 = performance.now(); while (A.state.laps === l0 && performance.now() - t0 < 15000) await sl(100);
    if (A.state.playing) A.togglePlay();
    await sl(500);
    return { live: live, counted: A.state.laps > l0 };
  });
  const hd = await p.page.evaluate(lastRunInPage);
  const s4 = await read();
  const ev1 = await p.page.evaluate(async () => (await PPP.runLog.log.evidence('demo', (await PPP.runLog.log.epochs()).epochs[0].hash)).runs.length);
  ok('a Demo Input lap (no keyboard) is named simulated', !dm.live && dm.counted && hd.source === 'simulated' && hd.simulated === true, JSON.stringify({ live: dm.live, hist: hd.source }));
  ok('and is not in the log: nothing new for the evidence the model reads, the epoch counts it', s4.runs.length === before && ev1 === ev0 && s4.epochs[0].sim.n === 1, JSON.stringify({ runs: before + '->' + s4.runs.length, evidence: ev0 + '->' + ev1, sim: s4.epochs[0].sim }));
  const kinds = s4.runs.map(r => r.run.src).join(',');
  ok('so the log holds exactly the three real kinds, in the order they were played', kinds === 'measured,follow,memory', kinds);
  ok('the screen still moved for the simulated lap (laps, the section bars, the toast): Demo Input keeps its display state', await p.page.evaluate(() => PPP.app.state.laps >= 4 && PPP.app.state.lastAcc > 0));
  ok('no page error in the whole session', p.probe.errors.length === 0, p.probe.errors.join('|'));
  await p.close();
}

/* ---------------------------------------------------------------- 4. the log: cap, size, epochs, ratings, export */
async function logSection(browser) {
  console.log('\n── the log: 300 per epoch, 2 KB per run, epochs, ratings, the export ──');
  const p = await open(browser, { query: '?learner=typed', midi: true });
  await toPractice(p.page, true);

  // the cap: 310 runs through the app's own lap, then the raw store
  const cap = await p.page.evaluate(async () => {
    const A = PPP.app, sl = ms => new Promise(r => setTimeout(r, ms));
    const score = A.state.score;
    const e = new PPP.PerformanceEngine(score).begin({ from: 1, to: 4, hands: 'both', tempo: 84, practiceMode: 'practice', startedAt: 1000 });
    e.expected.forEach((x, i) => { if (i % 4 !== 3) e.noteOn({ midi: x.midi, t: x.tMs + (i % 5) * 9 - 18, type: 'on' }); });
    e.advanceTo(1e9);
    A._perf = e;
    const res = e.result();
    A.setState({ loopFrom: 1, loopTo: 4, loop: true, practiceMode: 'practice', hands: 'both', tempo: 84 }); await sl(200);
    const t0 = performance.now();
    for (let i = 0; i < 310; i++) A.completeLap(A.state, res.counts.matched, res.counts.expected, res);
    const sync = performance.now() - t0;
    await PPP.runLog.log.idle();
    const log = PPP.runLog.log;
    const eps = await log.epochs();
    const hash = eps.epochs[0].hash;
    const r = await log.read('demo', hash);
    // the raw rows, as stored
    const raw = await new Promise((resolve, reject) => {
      const q = indexedDB.open('ppp-runlog');
      q.onsuccess = () => { const t = q.result.transaction('runs'); const g = t.objectStore('runs').getAll(); g.onsuccess = () => { q.result.close(); resolve(g.result); }; g.onerror = () => reject(g.error); };
      q.onerror = () => reject(q.error);
    });
    return { n: r.runs.length, first: r.runs[0].n, last: r.runs[r.runs.length - 1].n, stats: log.stats, bytes: raw.map(x => JSON.stringify(x.e).length), rawN: raw.length, epochRuns: eps.epochs[0].runs, syncPerLap: sync / 310, laps: PPP.runLog.laps.length };
  });
  ok('310 runs leave 300 in the epoch, and the oldest ten are the ones gone', cap.n === 300 && cap.rawN === 300 && cap.first === 11 && cap.last === 310 && cap.epochRuns === 300, JSON.stringify({ n: cap.n, first: cap.first, last: cap.last }));
  ok('the log counted them: 310 appended, 10 dropped', cap.stats.appended === 310 && cap.stats.dropped === 10 && !cap.stats.degraded, JSON.stringify(cap.stats));
  ok('every stored run is at most 2048 bytes of JSON', Math.max.apply(null, cap.bytes) <= 2048, 'largest ' + Math.max.apply(null, cap.bytes));
  ok('a lap\'s own share of the work (building the entry and queueing the write) is far below the 5 ms budget', cap.syncPerLap < 5, cap.syncPerLap.toFixed(2) + ' ms per lap');

  // a new music hash = a new epoch; the old one is kept and read-only
  const ep = await p.page.evaluate(async () => {
    const A = PPP.app, sl = ms => new Promise(r => setTimeout(r, ms));
    const log = PPP.runLog.log;
    const first = (await log.epochs()).epochs[0];
    const before = await log.read('demo', first.hash);
    const sc = PPP.Score.finalize(PPP.unpackScore(PPP.packScore(A.state.score)));
    const n0 = sc.notes.findIndex(n => !n.rest && n.midi != null);
    sc.notes[n0].midi += 2; sc.notes[n0].p = null;
    A.setState({ score: sc }); await sl(300);
    A.setState({ loopFrom: 1, loopTo: 4, loop: true, practiceMode: 'practice' }); await sl(200);
    const e2 = new PPP.PerformanceEngine(sc).begin({ from: 1, to: 4, hands: 'both', tempo: 84, practiceMode: 'practice', startedAt: 1000 });
    e2.expected.forEach(x => e2.noteOn({ midi: x.midi, t: x.tMs, type: 'on' }));
    e2.advanceTo(1e9); A._perf = e2;
    const res = e2.result();
    A.completeLap(A.state, res.counts.matched, res.counts.expected, res);
    await log.idle();
    const eps = (await log.epochs()).epochs;
    const old = eps.find(e => e.hash === first.hash), neu = eps.find(e => e.hash !== first.hash);
    const after = await log.read('demo', first.hash);
    const direct = await log.append('demo', first.hash, before.runs[0].run, {}, 'h2');   // the app never writes the old epoch; the log still takes a run for the hash it is told
    const eps2 = (await log.epochs()).epochs;
    return { n: eps.length, old: old && { current: old.current, readOnly: old.readOnly, runs: old.runs }, neu: neu && { current: neu.current, runs: neu.runs }, same: JSON.stringify(before.runs) === JSON.stringify(after.runs),
      direct: direct.ok, cur: eps2.map(e => [e.hash === first.hash ? 'old' : 'new', e.current]) };
  });
  ok('changing the music (a note edited) starts a new epoch for the same song', ep.n === 2 && ep.neu && ep.neu.current && ep.neu.runs === 1, JSON.stringify(ep));
  ok('and the old epoch is kept untouched, read-only', ep.old && !ep.old.current && ep.old.readOnly && ep.old.runs === 300 && ep.same, JSON.stringify(ep.old));
  ok('(a run told to go to the old hash makes it the current one again - the way Undo of a rewrite comes back - and the other becomes read-only)', ep.direct && ep.cur.find(c => c[0] === 'old')[1] === true && ep.cur.find(c => c[0] === 'new')[1] === false, JSON.stringify(ep.cur));

  // a rating
  await p.close();
  const q = await open(browser, { query: '?learner=typed', midi: true });
  await toPractice(q.page, true);
  await q.page.evaluate(realLapInPage, { mode: 'practice', from: 1, to: 2 });
  await sleep(600);
  const rate1 = await q.page.evaluate(() => ({ shown: !!document.querySelector('[data-run-rating]'), n: document.querySelectorAll('[data-run-rating-v]').length, text: (document.querySelector('[data-run-rating]') || {}).innerText }));
  ok('after a run, once the music has stopped, one row asks how it felt: three taps and a skip', rate1.shown && rate1.n === 3, JSON.stringify(rate1));
  await q.page.evaluate(() => document.querySelector('[data-run-rating-v="3"]').click());
  await sleep(500);
  const rated = await q.page.evaluate(async () => {
    const log = PPP.runLog.log; const h = (await log.epochs()).epochs[0].hash; const r = await log.read('demo', h);
    return { rt: r.runs.map(x => x.run.rt), gone: !document.querySelector('[data-run-rating]'), rated: log.stats.rated, ex: await log.exportAll() };
  });
  ok('a tap is kept as a separate record and shows as `rt` on that run (3 = hard); the row goes away', rated.rt[rated.rt.length - 1] === 3 && rated.gone && rated.rated === 1, JSON.stringify({ rt: rated.rt, gone: rated.gone }));
  await q.page.evaluate(realLapInPage, { mode: 'practice', from: 1, to: 2 });
  await sleep(500);
  await q.page.evaluate(() => document.querySelector('[data-run-rating-skip]').click());
  await sleep(300);
  const skipped = await q.page.evaluate(async () => { const log = PPP.runLog.log; const h = (await log.epochs()).epochs[0].hash; const r = await log.read('demo', h); return { rt: r.runs.map(x => x.run.rt), gone: !document.querySelector('[data-run-rating]') }; });
  ok('skipping writes nothing', skipped.gone && skipped.rt[skipped.rt.length - 1] == null && skipped.rt.length === 2, JSON.stringify(skipped.rt));

  // a loop: while it plays the row does not show
  const during = await q.page.evaluate(async () => {
    const A = PPP.app, sl = ms => new Promise(r => setTimeout(r, ms));
    A.setState({ practiceMode: 'practice', loop: true, tempo: 200 }); A.setLoop(1, 2); await sl(300);
    const l0 = A.state.laps; A.togglePlay();
    let shownWhilePlaying = false;
    const t0 = performance.now();
    while (A.state.laps < l0 + 2 && performance.now() - t0 < 15000) { await sl(150); if (A.state.playing && document.querySelector('[data-run-rating]')) shownWhilePlaying = true; }
    if (A.state.playing) A.togglePlay();
    await sl(500);
    return { shownWhilePlaying: shownWhilePlaying, laps: A.state.laps - l0 };
  });
  ok('while laps are looping the rating row stays out of the way', during.laps >= 2 && !during.shownWhilePlaying, JSON.stringify(during));

  // the export: through the Settings button, as a person does it
  await q.page.evaluate(() => { window.__dl = []; const mk = URL.createObjectURL.bind(URL); URL.createObjectURL = b => { window.__dl.push(b); return mk(b); }; });
  await toSettings(q.page);
  const status = await q.page.evaluate(() => ({ title: (document.querySelector('[data-run-log-settings]') || {}).innerText, status: (document.querySelector('[data-run-log-status]') || {}).innerText }));
  ok('Settings shows the practice log and what it holds', /Practice log/.test(status.title || '') && /Runs saved: 4 · songs: 1/.test(status.status || ''), JSON.stringify(status));
  await q.page.evaluate(() => document.querySelector('[data-run-log-export]').click());
  await sleep(900);
  const text = await q.page.evaluate(async () => (window.__dl[0] ? await window.__dl[0].text() : null));
  ok('the button hands over one file', typeof text === 'string' && text.length > 100);
  const parsed = await q.page.evaluate(async t => {
    const P = window.PPPRunLog;
    const r = P.parseExport(t);
    const live = await PPP.runLog.log.exportAll();
    return { ok: r.ok, rejected: r.rejected, same: r.ok && JSON.stringify(r.file.epochs) === JSON.stringify(live.file.epochs), epochs: r.ok ? r.file.epochs.length : 0, runs: r.ok ? r.file.epochs[0].runs.length : 0, format: r.ok && r.file.format, rt: r.ok && r.file.epochs[0].runs.map(x => x.rt) };
  }, text);
  ok('and re-reading the file gives back exactly the log (every epoch, every run, the rating)', parsed.ok && parsed.same && parsed.rejected === 0 && parsed.epochs === 1 && parsed.runs === 4 && parsed.format === 'ppp-practice-log' && parsed.rt[0] === 3 && parsed.rt.slice(1).every(v => v == null), JSON.stringify(parsed));
  // nothing of the account in it
  await q.page.evaluate(() => { localStorage.setItem('ppp.guest.key', 'SECRET-GUEST-KEY-123'); localStorage.setItem('ppp.pc.link', 'SECRET-PC-CODE-456'); });
  const secret = await q.page.evaluate(async () => { const ex = await PPP.runLog.log.exportAll(); const t = PPPRunLog.exportText(ex.file); return { has: /SECRET|guest|pc\.link|token|password/i.test(t), keys: Object.keys(ex.file).join(','), epochKeys: Object.keys(ex.file.epochs[0]).join(',') }; });
  ok('the file carries no guest key, PC code or secret: only the log\'s own fields', !secret.has && secret.keys === 'format,version,exportedAt,schema,epochs,skipped', JSON.stringify(secret));

  // a song taken out of My Songs takes its log
  const forgot = await q.page.evaluate(async () => {
    const log = PPP.runLog.log;
    const e0 = (await log.epochs()).epochs.length;
    PPP.app.removeSong('demo', { quiet: true });   // the sample is not removable: nothing may happen
    await log.idle();
    const e1 = (await log.epochs()).epochs.length;
    await log.append('song-gone', 'h1', PPPRunLog.buildEntry({ id: 'rx', at: 1, src: 'measured', mode: 'practice', hands: 'both', tempo: 80, scoreTempo: 80, from: 0, to: 0, rows: [], wrongs: [], expected: 1, matched: 1, accuracy: 1 }).entry, { measures: 1 }, 'h2');
    const e2 = (await log.epochs()).epochs.length;
    PPP.app.removeSong('song-gone', { quiet: true });
    await log.idle();
    const e3 = (await log.epochs()).epochs.length;
    return [e0, e1, e2, e3];
  });
  ok('a song removed from My Songs takes its log with it (the sample song cannot be removed and keeps its)', forgot[0] === 1 && forgot[1] === 1 && forgot[2] === 2 && forgot[3] === 1, JSON.stringify(forgot));
  ok('no page error', q.probe.errors.length === 0, q.probe.errors.join('|'));
  await q.close();
}

/* ---------------------------------------------------------------- 5. failing storage */
const LAPS_PER_FAILURE = 8;
/* the app laps through its own completeLap, as many as asked, with a result of the matcher; reports what a person could see */
function manyLapsInPage(n) {
  return (async () => {
    const A = PPP.app, sl = ms => new Promise(r => setTimeout(r, ms));
    const e = new PPP.PerformanceEngine(A.state.score).begin({ from: 1, to: 4, hands: 'both', tempo: 84, practiceMode: 'practice', startedAt: 1000 });
    e.expected.forEach((x, i) => { if (i % 4 !== 3) e.noteOn({ midi: x.midi, t: x.tMs + 10, type: 'on' }); });
    e.advanceTo(1e9); A._perf = e;
    const res = e.result();
    A.setState({ loopFrom: 1, loopTo: 4, loop: true, practiceMode: 'practice', hands: 'both', tempo: 84 }); await sl(200);
    const l0 = A.state.laps, toasts = [];
    for (let i = 0; i < n; i++) {
      const patch = A.completeLap(A.state, res.counts.matched, res.counts.expected, res);
      A.setState(patch); await sl(120);
      toasts.push(A.state.toast || '');
    }
    await sl(300);
    return { laps: A.state.laps - l0, toasts: toasts, histRuns: A.state.history.runs.length, log: window.PPPRunLog && PPP.runLog.log ? { stats: PPP.runLog.log.stats, degraded: PPP.runLog.log.degraded } : null };
  })();
}
async function failuresSection(browser) {
  console.log('\n── failing storage: the page keeps working, the log is given up once and counted, no message ──');
  const noLogToast = r => r.toasts.every(t => !/log|record|storage|저장/i.test(t) || /Run finished/.test(t));
  const check = (name, r, code) => {
    ok(name + ': the page counts every lap and keeps its history as under legacy', r.laps === LAPS_PER_FAILURE && r.histRuns >= LAPS_PER_FAILURE, JSON.stringify({ laps: r.laps, hist: r.histRuns }));
    ok(name + ': the log is degraded once, with the right reason, and later laps are skipped, not retried', r.log && r.log.degraded === code && r.log.stats.errors[code] === 1 && r.log.stats.skipped >= LAPS_PER_FAILURE - 2 && r.log.stats.appended === 0, JSON.stringify(r.log && { d: r.log.degraded, e: r.log.stats.errors, s: r.log.stats.skipped }));
    ok(name + ': no message about the log, no toast but the lap\'s own', noLogToast(r), JSON.stringify(Array.from(new Set(r.toasts))));
  };

  // storage full: a write that throws QuotaExceededError
  let p = await open(browser, { query: '?learner=typed', init: [[() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (v) { if (this.name === 'runs') throw new DOMException('The quota has been exceeded.', 'QuotaExceededError'); return put.apply(this, arguments); };
  }, null]] });
  await toPractice(p.page, false);
  await p.page.waitForFunction(() => !!window.PPPRunLog, { timeout: 8000 });
  let r = await p.page.evaluate(manyLapsInPage, LAPS_PER_FAILURE);
  check('storage full', r, 'quota');
  ok('storage full: no page error', p.probe.errors.length === 0, p.probe.errors.join('|'));
  await p.close();

  // blocked: indexedDB itself refuses (a private window)
  p = await open(browser, { query: '?learner=typed', init: [[() => {
    Object.defineProperty(window, 'indexedDB', { configurable: true, get() { throw new DOMException('denied', 'SecurityError'); } });
  }, null]] });
  await toPractice(p.page, false);
  await p.page.waitForFunction(() => !!window.PPPRunLog, { timeout: 8000 });
  r = await p.page.evaluate(manyLapsInPage, LAPS_PER_FAILURE);
  check('blocked storage', r, 'blocked');
  ok('blocked storage: no page error', p.probe.errors.length === 0, p.probe.errors.join('|'));
  await p.close();

  // a database that will not open (a newer version already there)
  p = await open(browser, { query: '?learner=typed', settle: 300, init: [[() => {
    // make 'ppp-runlog' exist at version 99 before the app asks for version 1
    const q = indexedDB.open('ppp-runlog', 99);
    q.onsuccess = () => q.result.close();
  }, null]] });
  await toPractice(p.page, false);
  await p.page.waitForFunction(() => !!window.PPPRunLog, { timeout: 8000 });
  r = await p.page.evaluate(manyLapsInPage, LAPS_PER_FAILURE);
  check('a newer database (VersionError)', r, 'version');
  await p.close();

  // a database that never answers
  p = await open(browser, { query: '?learner=typed', init: [[() => {
    const open = indexedDB.open.bind(indexedDB);
    indexedDB.open = function (name) {
      if (name === 'ppp-runlog') return { set onsuccess(f) {}, set onerror(f) {}, set onblocked(f) {}, set onupgradeneeded(f) {}, get result() { return null; } };
      return open.apply(indexedDB, arguments);
    };
  }, null]] });
  await toPractice(p.page, false);
  await p.page.waitForFunction(() => !!window.PPPRunLog, { timeout: 8000 });
  const t0 = Date.now();
  r = await p.page.evaluate(manyLapsInPage, LAPS_PER_FAILURE);
  const took = Date.now() - t0;
  await sleep(3000);
  const r2 = await p.page.evaluate(() => ({ degraded: PPP.runLog.log.degraded, errors: PPP.runLog.log.stats.errors, skipped: PPP.runLog.log.stats.skipped }));
  ok('a database that never answers: the laps are not held up by it (the page does not wait for the log)', r.laps === LAPS_PER_FAILURE && took < 6000, took + ' ms for ' + LAPS_PER_FAILURE + ' laps');
  ok('and after the time limit the log is degraded once (timeout), the rest skipped', r2.degraded === 'timeout' && r2.errors.timeout === 1, JSON.stringify(r2));
  await p.close();

  // a damaged log: junk rows, a damaged epoch, then more laps
  p = await open(browser, { query: '?learner=typed', midi: true });
  await toPractice(p.page, true);
  await p.page.evaluate(manyLapsInPage, 3);
  await p.page.evaluate(() => PPP.runLog.log.idle());
  const dmg = await p.page.evaluate(async () => {
    const log = PPP.runLog.log;
    const eps = (await log.epochs()).epochs;
    const h = eps[0].hash, ep = 'demo|' + h;
    await new Promise((resolve, reject) => {
      const q = indexedDB.open('ppp-runlog');
      q.onsuccess = () => {
        const db = q.result, t = db.transaction(['runs', 'epochs'], 'readwrite');
        const rs = t.objectStore('runs');
        rs.put({ ep: ep, n: 50, e: 'garbage' });
        rs.put({ ep: ep, n: 51, e: { v: 1, id: 'x' } });
        rs.put({ ep: ep, n: 52, e: { v: 1, id: 'rZ', at: 1, src: 'simulated', md: 'practice', hd: 'b', tp: 1, sr: 1, f: 0, t: 0, g: 1, hn: 0, lv: 0, ex: 1, ht: 1, wr: 0, xt: 0, ac: 1, R: [], W: [] } });
        rs.put({ ep: ep, n: 53, e: null });
        t.objectStore('epochs').put({ ep: 'bad|record', songId: 7 });
        t.oncomplete = () => { db.close(); resolve(); };
        t.onerror = () => reject(t.error);
      };
    });
    const ex = await log.exportAll();
    return { ok: ex.ok, skipped: ex.ok && ex.file.skipped.corrupt, runs: ex.ok ? ex.file.epochs.map(e => e.runs.length) : null, nums: ex.ok ? ex.file.epochs[0].runs.map(r => r.n) : null, corrupt: log.stats.corrupt, epochs: ex.ok && ex.file.epochs.length };
  });
  ok('a damaged log is read around: junk rows, a simulated row and a half-written one are skipped and counted, the three real runs come out', dmg.ok && dmg.runs[0] === 3 && dmg.skipped >= 4 && dmg.epochs === 1, JSON.stringify(dmg));
  const heal = await p.page.evaluate(async () => {
    const log = PPP.runLog.log;
    const h = (await log.epochs()).epochs[0].hash;
    // the current epoch's own record is damaged: the next run repairs it, and the runs already kept stay
    await new Promise((resolve, reject) => { const q = indexedDB.open('ppp-runlog'); q.onsuccess = () => { const t = q.result.transaction('epochs', 'readwrite'); t.objectStore('epochs').put({ ep: 'demo|' + h, songId: 'demo', hash: 12 }); t.oncomplete = () => { q.result.close(); resolve(); }; t.onerror = () => reject(t.error); }; });
    const before = (await log.read('demo', h)).runs.map(r => r.n);
    return { before: before };
  });
  const lapsAfter = await p.page.evaluate(manyLapsInPage, 2);
  const healed = await p.page.evaluate(async () => { const log = PPP.runLog.log; const e = (await log.epochs()).epochs[0]; return { epochs: (await log.epochs()).epochs.length, runs: (await log.read('demo', e.hash)).runs.map(r => r.n), repaired: log.stats.repaired, degraded: log.degraded }; });
  ok('a damaged epoch record is repaired by the next run: the numbers carry on after the highest one kept, nothing is overwritten, nothing degraded', lapsAfter.laps === 2 && healed.repaired === 1 && healed.degraded === null && healed.runs.slice(0, 3).join() === heal.before.slice(0, 3).join() && healed.runs.length === 5, JSON.stringify({ heal: heal.before, healed: healed }));
  ok('no page error while the log was damaged', p.probe.errors.length === 0, p.probe.errors.join('|'));
  await p.close();
}

/* ---------------------------------------------------------------- 6. the budget */
/* the speed of this machine against the one these limits were set on: a fixed CPU workload (the one tests/practice/perf.js calls calib), timed on a plain page BEFORE any throttle.
   92 ms is this suite's reference (a developer's laptop; the CI runners of tests/practice/baselines/perf.json come out at 108); a slower machine gets proportionally more milliseconds, up to 3x, a faster one no fewer */
const CALIB_REF = 92;
async function calibration(browser) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.goto('about:blank');
  const ms = await page.evaluate(() => {
    const once = () => {
      const t = performance.now();
      let s = 0;
      for (let round = 0; round < 8; round++) {
        let x = 1 + round;
        const a = new Array(30000);
        for (let i = 0; i < a.length; i++) { x = (Math.imul(x, 1664525) + 1013904223) >>> 0; a[i] = x; }
        a.sort((p, q) => p - q);
        for (let i = 0; i < 2000000; i++) s = (s + Math.imul(i, 31)) | 0;
      }
      return performance.now() - t + (s === 0.5 ? 1 : 0);
    };
    const runs = [];
    for (let i = 0; i < 5; i++) runs.push(once());
    runs.sort((p, q) => p - q);
    return runs[2];
  });
  await ctx.close();
  return ms;
}
async function budgetSection(browser) {
  const calib = await calibration(browser);
  const scale = Math.min(3, Math.max(1, calib / CALIB_REF));
  console.log('\n── budgets: the lap\'s share of the log at CPU 4x, 2 KB for a whole-piece lap ──');
  const p = await open(browser, { query: '?learner=typed', midi: true, cpu: 4 });
  const m = await p.page.evaluate(async file => {
    const A = PPP.app, sl = ms => new Promise(r => setTimeout(r, ms));
    const res = await fetch('/' + file);
    const sc = PPP.scoreFromXml(await PPP.readMxl(await res.arrayBuffer()), file.split('/').pop());
    A.adoptScore(sc);
    await sl(3000);
    const nav = [...document.querySelectorAll('aside nav button')].find(x => /^Practice/.test((x.innerText || '').trim()));
    if (nav) nav.click();
    await sl(3500);
    const demo = [...document.querySelectorAll('main button, main span')].find(x => /Demo Input/.test((x.innerText || '').trim()));
    if (demo) demo.click();
    await sl(1500);
    A.setState({ toggles: Object.assign({}, A.state.toggles, { follow: false }), loop: false, practiceMode: 'practice', hands: 'both' });
    await sl(500);
    A.togglePlay();
    await sl(800);
    const perf = A._perf;
    const live = !!(perf && perf.run);
    A.togglePlay();
    await sl(400);
    perf.expected.forEach((x, i) => {
      if (i % 6 === 5) { x.closed = true; x.verdict = 'missed'; return; }
      x.matched = true; x.closed = true; x.deltaMs = ((i * 37) % 120) - 60; x.verdict = Math.abs(x.deltaMs) <= 55 ? 'on' : x.deltaMs < 0 ? 'early' : 'late';
    });
    A._perf = perf;
    const result = perf.result();
    const runs = [];
    for (let i = 0; i < 60; i++) {
      const t = performance.now();
      A.completeLap(A.state, result.counts.matched, result.counts.expected, result);
      runs.push(performance.now() - t);
      await sl(30);
    }
    const t1 = performance.now();
    await PPP.runLog.log.idle();
    const idle = performance.now() - t1;
    const share = PPP.runLog.laps.map(l => l.ms);
    const log = PPP.runLog.log;
    const hash = (await log.epochs()).epochs[0].hash;
    const stored = (await log.read(A.state.songId, hash)).runs.map(r => r.run);
    return { live: live, notes: perf.expected.length, measures: A.state.score.measures.length, whole: runs, share: share.slice(-60), idle: idle,
      bytes: stored.map(r => JSON.stringify(r).length), g: stored.map(r => r.g), tr: stored.filter(r => r.tr).length, ex: stored.length ? stored[0].ex : 0, degraded: log.degraded, failed: log.stats.refused };
  }, 'catalog/method/sonatina/020.mxl');
  const at = (a, q) => { const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };
  const mean = a => a.reduce((s, v) => s + v, 0) / a.length;
  ok('a whole-piece lap of the 1,776-note Sonatina is judged by a live engine with the log on', m.live && m.notes > 1700 && !m.degraded, m.notes + ' notes, ' + m.measures + ' measures');
  /* Chrome's CPU throttle slows a short task by 1x to 5x depending on where in its duty cycle the task falls (tests/practice/perf.js knows it too), so one lap in twenty
     can show 3 to 5 times its real cost; the budget is held by the median and the 90th percentile of 60 laps, and the worst lap is reported */
  ok('the synchronous share of the log in a lap (build the entry, queue the write) is within 5 ms at CPU 4x: median and p90 of 60 laps of a 158-measure piece', at(m.share, 0.5) <= 3 * scale && at(m.share, 0.9) <= 5 * scale,
    'limits 3 and 5 ms x ' + scale.toFixed(2) + ' (this machine ' + calib.toFixed(0) + ' ms on the reference workload, reference ' + CALIB_REF + '): median ' + at(m.share, 0.5).toFixed(2) + ' ms, mean ' + mean(m.share).toFixed(2) + ', p90 ' + at(m.share, 0.9).toFixed(2) + ', max ' + Math.max.apply(null, m.share).toFixed(2) + ' (first lap ' + m.share[0].toFixed(2) + ')');
  ok('(the whole completeLap call, for scale: mean ' + mean(m.whole).toFixed(1) + ' ms, p95 ' + at(m.whole, 0.95).toFixed(1) + ' ms, and the IndexedDB commits all done ' + m.idle.toFixed(0) + ' ms after the last lap)', m.whole.length === 60);
  ok('a whole piece in one run still fits 2 KB: ' + m.measures + ' measures, rows merged by ' + (m.g.length ? Math.max.apply(null, m.g) : '-') + ' (`g`), largest ' + (m.bytes.length ? Math.max.apply(null, m.bytes) : '-') + ' bytes, none emptied', m.bytes.length === 60 && Math.max.apply(null, m.bytes) <= 2048 && m.tr === 0, JSON.stringify({ bytes: m.bytes.length ? Math.max.apply(null, m.bytes) : null, g: m.g[0], kept: m.bytes.length, refused: m.failed }));
  ok('no page error', p.probe.errors.length === 0, p.probe.errors.join('|'));
  await p.close();
}

/* ---------------------------------------------------------------- 7. decision U4 */
async function demoSection(browser) {
  console.log('\n── PPP.demoRuns (decision U4, OFF): a run without a keyboard kept out of history and memory ──');
  const demoLaps = page => page.evaluate(async () => {
    const A = PPP.app, sl = ms => new Promise(r => setTimeout(r, ms));
    const clone = o => JSON.parse(JSON.stringify(o));
    const before = { hist: clone(A.state.history), mem: clone(A.state.memory), laps: A.state.laps };
    const doLap = async mode => {
      A.setState({ practiceMode: mode, loop: true, tempo: 200, hands: 'both' }); A.setLoop(1, 2); await sl(300);
      A._sim = A.newSim();
      const ev = A.fire(A.state, 0, 1e6);
      const patch = A.completeLap(A.state, ev.hit, ev.tot, null);
      A.setState(patch); await sl(200);
    };
    await doLap('practice');
    const afterP = { hist: clone(A.state.history), laps: A.state.laps, toast: A.state.toast, secs: JSON.stringify(A.state.secs) };
    await doLap('memory');
    const afterM = { hist: clone(A.state.history), mem: clone(A.state.memory), laps: A.state.laps, toast: A.state.toast };
    return { before: before, afterP: afterP, afterM: afterM };
  });
  const run = async query => { const p = await open(browser, { query: query }); await toPractice(p.page, false); const r = await demoLaps(p.page); r.errors = p.probe.errors; r.secs0 = null; await p.close(); return r; };
  const cnt = await run('?learner=typed');
  ok('the default (count): a lap without a keyboard is folded into the history as before, named simulated', Object.keys(cnt.afterP.hist.byMeasure).length > Object.keys(cnt.before.hist.byMeasure).length - 1 && cnt.afterP.hist.runs.length === cnt.before.hist.runs.length + 1 && cnt.afterP.hist.runs[cnt.afterP.hist.runs.length - 1].source === 'simulated', JSON.stringify({ runs: cnt.before.hist.runs.length + '->' + cnt.afterP.hist.runs.length }));
  const sep = await run('?learner=typed&demoRuns=separate');
  ok('with demoRuns=separate under typed, history.byMeasure and history.runs are exactly what they were', JSON.stringify(sep.afterP.hist) === JSON.stringify(sep.before.hist), 'rev ' + sep.before.hist.rev + '->' + sep.afterP.hist.rev);
  ok('and the recall record is untouched too', JSON.stringify(sep.afterM.mem) === JSON.stringify(sep.before.mem) && JSON.stringify(sep.afterM.hist) === JSON.stringify(sep.before.hist));
  ok('but the screen moved: the lap counter, and the toast says why nothing was kept', sep.afterP.laps === sep.before.laps + 1 && sep.afterM.laps === sep.before.laps + 2 && /not counted/i.test(sep.afterP.toast || ''), JSON.stringify({ laps: sep.before.laps + '->' + sep.afterM.laps, toast: sep.afterP.toast }));
  const leg = await run('?demoRuns=separate');
  ok('under legacy the switch does nothing (history is folded as ever, no `source`)', leg.afterP.hist.runs.length === leg.before.hist.runs.length + 1 && leg.afterP.hist.runs[leg.afterP.hist.runs.length - 1].source === undefined, JSON.stringify({ runs: leg.before.hist.runs.length + '->' + leg.afterP.hist.runs.length }));
  ok('no page error', cnt.errors.length + sep.errors.length + leg.errors.length === 0);
}

/* ---------------------------------------------------------------- 8. what a person sees */
async function uiSection(browser) {
  console.log('\n── Settings > Practice log and the rating row: typed only, in four languages ──');
  const LOCALES = {
    'en-US': { title: 'Practice log', btn: 'Export practice log', rate: 'How was that run?', chips: ['Easy', 'Just right', 'Hard'] },
    'ko-KR': { title: '연습 기록', btn: '연습 기록 내보내기', rate: '방금 연습은 어땠나요?', chips: ['쉬움', '알맞음', '어려움'] },
    'ja-JP': { title: '練習ログ', btn: '練習ログを書き出す', rate: '今の演奏はどうでしたか？', chips: ['易しい', 'ちょうどいい', '難しい'] },
    'zh-CN': { title: '练习日志', btn: '导出练习日志', rate: '刚才这一遍感觉如何？', chips: ['简单', '刚刚好', '困难'] }
  };
  for (const loc of Object.keys(LOCALES)) {
    const L = LOCALES[loc];
    const p = await open(browser, { query: '?learner=typed', midi: true, init: [[l => { localStorage.setItem('ppp-locale', l); }, loc]] });
    await toPractice(p.page, true);
    await p.page.evaluate(realLapInPage, { mode: 'practice', from: 1, to: 2 });
    await sleep(700);
    const row = await p.page.evaluate(() => { const r = document.querySelector('[data-run-rating]'); return r ? { text: r.innerText, chips: [...r.querySelectorAll('[data-run-rating-v]')].map(b => b.innerText.trim()) } : null; });
    await toSettings(p.page);
    const set = await p.page.evaluate(() => { const r = document.querySelector('[data-run-log-settings]'); return r ? { text: r.innerText, btn: (r.querySelector('[data-run-log-export]') || {}).innerText } : null; });
    ok(loc + ': the rating row says ' + L.rate + ' with ' + L.chips.join(' / '), row && row.text.indexOf(L.rate) >= 0 && L.chips.every((c, i) => row.chips[i] === c), JSON.stringify(row));
    ok(loc + ': Settings has the practice log card with its export button ' + L.btn, set && set.text.indexOf(L.title) >= 0 && (set.btn || '').trim() === L.btn, JSON.stringify(set));
    await p.close();
  }
  const p = await open(browser, { midi: true });
  await toPractice(p.page, true);
  await p.page.evaluate(realLapInPage, { mode: 'practice', from: 1, to: 2 });
  await sleep(600);
  const leg = await p.page.evaluate(() => ({ rating: !!document.querySelector('[data-run-rating]'), body: document.body.innerText }));
  await toSettings(p.page);
  const legSet = await p.page.evaluate(() => ({ card: !!document.querySelector('[data-run-log-settings]'), body: document.body.innerText }));
  ok('under legacy there is no rating row, no practice log card, no word of either', !leg.rating && !legSet.card && !/Practice log|How was that run/.test(leg.body + legSet.body));
  await p.close();
}

/* ---------------------------------------------------------------- main */
(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  try {
    if (RECORD) {
      await identitySection(browser, process.env.LL_RECORD_URL || undefined);
    } else {
      if (want('switch')) await switchSection(browser);
      if (want('identity')) await identitySection(browser);
      if (want('kinds')) await kindsSection(browser);
      if (want('log')) await logSection(browser);
      if (want('failures')) await failuresSection(browser);
      if (want('budget')) await budgetSection(browser);
      if (want('demo')) await demoSection(browser);
      if (want('ui')) await uiSection(browser);
    }
  } finally {
    await browser.close();
  }
  console.log('\n' + (errors.length ? errors.length + ' check(s) failed:\n  ' + errors.join('\n  ') : 'all checks passed'));
  process.exit(errors.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
