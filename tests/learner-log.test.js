/* ============================================================================
   PPP.learner (G11b-1): typed practice evidence and the run log
   docs/GOALS/G11_ADAPTIVE_PRACTICE.md G11-D4, G11-D5, G11-D6, decision U4; practice/runlog.js

   Real pages (headless Chrome against the tree's server), a fake MIDI keyboard, real laps. Sections (LL_ONLY=a,b runs some):
     switch    PPP.learner: default 'legacy', ?learner=, the remembered choice, garbage, a throwing storage, the setter (PPP.recording's idiom)
     identity  under 'legacy' a scripted practice session writes the localStorage aggregates byte for byte as the golden dumps of the page before
               this phase (node tests/practice/learner-record.js --rev COMMIT writes both from that commit): learner-legacy.json, the session as the
               page then counted it (Demo Input laps included), is what `?demoRuns=count` (decision U4's explicit opt-out) must equal; and
               learner-legacy-separate.json, the same session on that page with the four Demo Input laps walked but not applied, is what the
               default (U4: a run without a keyboard writes no evidence) must equal, the lap counter apart. And nothing new: no request for
               practice/runlog.js, no IndexedDB 'ppp-runlog'; under 'typed' the same sessions differ only by the `source` key of each run summary
     kinds     a measured lap, a Follow lap, a recall lap and a Demo Input lap are logged as what they are; a simulated run never reaches evidence
     fields    what a run says: hands, tempo, range, hints, memory level, wrong and extra keys; a Follow run has no tempo
     idle      a loop with a keyboard attached and nothing played is counted, not logged, not rated; a lap with one real note still logs
     log       the cap of 300 (the oldest goes), 2 KB per run, a new music hash = a new epoch (the old one read-only), ratings, the export
               round trip, the file carries nothing but practice, a song removed takes its log
     frozen    a lap that ends while Delete everything is wiping the page does not recreate the log
     failures  storage full, blocked storage, a database that will not open, one that never answers, a damaged log: the page keeps working,
               the log is given up once and counted, no message
     budget    the lap's share of the log at CPU 4x on the 1,776-note Sonatina, and 2 KB for every run of a whole-piece lap
     demo      PPP.demoRuns (decision U4, decided YES 2026-10-13): by default a run without a keyboard moves the screen and writes no evidence, under 'legacy' and
               'typed' alike (history, memory, section bars, coach and Loop counters, minutes, xp, weekly bars, the log), and the card says so in four languages;
               'count' is the opt-out
     demolive  the same on the page's own clock: five and five real laps in Korean without a keyboard leave the progress as it was; with a (fake) keyboard they count
     democonnect  a keyboard that goes live after Play is judged from the next lap (the lap in which it came is lost, with a line that says so); when the card says a run was not
               recorded (while it plays, and after it until a recorded run replaces it), and what Progress and Home say of a run that was not
     ui        Settings > Practice log and the rating row exist only under 'typed', in four languages
   Needs puppeteer; 127.0.0.1:8777 (tests/engrave/tools/with-port.js rewrites it; tests/practice/run-suites.js does).
   ========================================================================== */
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const puppeteer = require('puppeteer');
const { preparePage } = require('./boot');

const BASE = 'http://127.0.0.1:8777/Piano%20Coach%20App.dc.html';
const GOLDEN = path.join(__dirname, 'practice', 'baselines', 'learner-legacy.json');
const GOLDEN_SEP = path.join(__dirname, 'practice', 'baselines', 'learner-legacy-separate.json');
const DEMO_LAPS = 4;       /* the Demo Input laps of the scripted session: they count on the lap counter (the screen) and nowhere else under U4 */
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
  const probe = { errors: [], requests: [], toasts: [], all: [] };
  page.on('pageerror', e => probe.errors.push(e.message));
  page.on('request', r => { if (/practice\/runlog/.test(r.url())) probe.requests.push(r.url()); if (/\/practice\//.test(r.url())) probe.all.push(r.url()); });
  if (o.block) {       /* a request the page is not to get (G11b-3: a module that cannot be had) */
    await page.setRequestInterception(true);
    page.on('request', r => { if (o.block.test(r.url())) r.abort(); else r.continue(); });
  }
  await preparePage(page);
  if (o.midi) await page.evaluateOnNewDocument(installFakeMidi);
  for (const [fn, arg] of o.init || []) await page.evaluateOnNewDocument(fn, arg);
  if (o.cpu) { const cdp = await page.target().createCDPSession(); await cdp.send('Emulation.setCPUThrottlingRate', { rate: o.cpu }); }
  await page.goto((o.base || BASE) + (o.query || ''), { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => window.PPP && window.PPP.app && window.PPP.PianoScore, { timeout: 60000 });
  await sleep(o.settle || 1200);
  /* the page is closed BEFORE its context: tests/engrave/tools/with-port.js reads what a page did (the engraver's draws, and the graph plans of --practice graph) when the page closes */
  return { ctx, page, probe, close: async () => { try { await page.close(); } catch (e) { /* gone already */ } await ctx.close(); } };
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
        if (o.only != null && i >= o.only) return;   /* press only the first o.only notes */
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
  ok('the default is legacy, and a run without a keyboard is kept apart (U4: demoRuns separate)', a.learner === 'legacy' && a.demo === 'separate', a.learner + ' / ' + a.demo);
  ok('and then practice/runlog.js is not even requested, there is no PPPRunLog and no IndexedDB ppp-runlog', a.requests === 0 && a.mod === 'undefined' && a.dbs.indexOf('ppp-runlog') < 0 && a.key === null, JSON.stringify({ requests: a.requests, mod: a.mod, dbs: a.dbs }));
  const b = await mode('?learner=typed');
  ok('?learner=typed makes this visit typed and loads the module once', b.learner === 'typed' && b.mod === 'object' && b.requests === 1, JSON.stringify({ requests: b.requests, mod: b.mod }));
  ok('and a choice made in the address is not remembered', b.key === null);
  const c = await mode('', [stored('typed')]);
  ok('a remembered typed is typed', c.learner === 'typed' && c.mod === 'object');
  const d1 = await mode('', [stored('adaptiv')]);   /* a typo (G11b-3: 'adaptive' itself is the third word now, tests/practice/adaptive-sections.js) */
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
  const s3 = await p.page.evaluate(() => { PPP.demoRuns = 'count'; const a = [PPP.demoRuns, localStorage.getItem('ppp.demoRuns.v1')]; PPP.demoRuns = 'x'; return a.concat([PPP.demoRuns, localStorage.getItem('ppp.demoRuns.v1')]); });
  ok('PPP.demoRuns has the same shape (separate is the default, count the explicit opt-out)', s3[0] === 'count' && s3[1] === 'count' && s3[2] === 'separate' && s3[3] === null, JSON.stringify(s3));
  await p.close();

  /* U4: the default holds for anything that is no choice, under both learner values, and a throwing storage */
  const DKEY = 'ppp.demoRuns.v1';
  const dmode = async (query, init) => {
    const q = await open(browser, { query: query, init: init || [] });
    const r = await q.page.evaluate(() => ({ learner: PPP.learner, demo: PPP.demoRuns, app: !!PPP.app }));
    r.errors = q.probe.errors;
    await q.close();
    return r;
  };
  const dstored = v => [(a) => { localStorage.setItem(a[0], a[1]); }, [DKEY, v]];
  const k1 = await dmode('?demoRuns=count');
  const k2 = await dmode('?learner=typed&demoRuns=count');
  const k3 = await dmode('', [dstored('count')]);
  ok('demoRuns=count in the address, or remembered, is the opt-out, under legacy and under typed', k1.demo === 'count' && k1.learner === 'legacy' && k2.demo === 'count' && k2.learner === 'typed' && k3.demo === 'count', [k1, k2, k3].map(x => x.learner + '/' + x.demo).join(','));
  const g1 = await dmode('', [dstored('adaptive')]);
  const g2 = await dmode('', [dstored('COUNT')]);
  const g3 = await dmode('?demoRuns=junk');
  const g4 = await dmode('?learner=typed&demoRuns=Count');
  const g5 = await dmode('', [dstored('')]);
  ok('anything else (a typo, the wrong case, an empty string) is no choice and the default is separate, under both learner values', [g1, g2, g3, g4, g5].every(x => x.demo === 'separate') && g4.learner === 'typed', [g1, g2, g3, g4, g5].map(x => x.demo).join(','));
  const g6 = await dmode('', [[a => {
    localStorage.setItem(a[0], a[1]);
    const get = Storage.prototype.getItem;
    Storage.prototype.getItem = function (k) { if (k === a[0]) throw new DOMException('denied', 'SecurityError'); return get.call(this, k); };
  }, [DKEY, 'count']]]);
  ok('a storage that throws on the read is separate (the decision is not undone by a failing disk), and the page boots', g6.demo === 'separate' && g6.app && g6.errors.length === 0, g6.demo + ' ' + g6.errors.join('|'));
  const g7 = await dmode('?demoRuns=separate', [dstored('count')]);
  ok('the address beats the remembered choice', g7.demo === 'separate');
}

/* ---------------------------------------------------------------- 2. byte identity under legacy */
/* a scripted practice session: ten laps of every kind through the app's own completeLap, a seeded Math.random and the app's injectable clock;
   returns what the legacy readers can see afterwards (the localStorage of the page, the state they read).
   `o.demoLaps === false` walks the four Demo Input laps (the state is set for them, the random hits are drawn) and does NOT apply their lap-end patch: what the page
   before decision U4, which counted them, shows when a run without a keyboard is left out - the recording of learner-legacy-separate.json (the default must equal it) */
function scenarioInPage(o) {
  const applyDemo = !o || o.demoLaps !== false;
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
      if (applyDemo) { const patch = withSeed(() => app.completeLap(S, ev.hit, ev.tot, null)); app.setState(patch); }
      clock += 90000; await sl(140);
    }
    await set(Object.assign({}, base, { loopFrom: 1, loopTo: 4, practiceMode: 'memory' }));
    app._sim = app.newSim();
    { const S = app.state; const ev = withSeed(() => app.fire(S, 0, 1e6)); if (applyDemo) { const patch = withSeed(() => app.completeLap(S, ev.hit, ev.tot, null)); app.setState(patch); } clock += 90000; await sl(140); }
    app.saveNow();
    await sl(400);
    /* the progress of the person: the three keys the page writes it to. A key the HARNESS puts into the page (with-port.js: ppp.strictEngrave; a run of the suites under another
       switch: ppp.practice.v1) is not progress and is not compared; `keys` lists every ppp.* key, for the check that this phase added none */
    const keys = Object.keys(localStorage).filter(k => k.indexOf('ppp.') === 0).sort();
    const ls = {};
    keys.filter(k => /^ppp\.(library\.v1|state\.v2|song\.v1\..+)$/.test(k)).forEach(k => { ls[k] = localStorage.getItem(k); });
    const st = app.state;
    return { ls: ls, keys: keys, history: JSON.stringify(st.history), memory: JSON.stringify(st.memory), secs: JSON.stringify(st.secs), laps: st.laps, minutes: st.minutes, xp: st.xp, sessions: JSON.stringify(st.sessions) };
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
  console.log('\n── PPP.learner = legacy: the aggregates are the golden dumps, byte for byte ──');
  const run = async (query, o) => {
    /* the clock stands still from the first script on: the sample song's seeded history is made from Date.now() when the page opens */
    const p = await open(browser, { query: query, base: base, init: [[() => { Date.now = () => 1760000000000; }, null]] });
    await toPractice(p.page, false);
    const dump = await p.page.evaluate(scenarioInPage, o || {});
    const dbs = await dbNames(p.page);
    const out = { dump: dump, requests: p.probe.requests.length, dbs: dbs, errors: p.probe.errors, mod: await p.page.evaluate(() => typeof window.PPPRunLog) };
    if (/learner=typed/.test(query)) {
      /* what the log says of the same session: the runs it holds, and what it counted without logging them */
      out.log = await p.page.evaluate(async () => {
        const log = PPP.runLog.log;
        await log.idle();
        const e = (await log.epochs()).epochs;
        const ev = e[0] ? await log.evidence('demo', e[0].hash) : { runs: [] };
        return { epochs: e.length, runs: e.reduce((a, x) => a + x.runs, 0), sim: e.reduce((a, x) => a + x.sim.n, 0), idle: e.reduce((a, x) => a + x.idle.n, 0), evidence: ev.runs.length };
      });
    }
    await p.close();
    return out;
  };
  const writeGolden = (file, d) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, canon(d) + '\n');
    console.log('golden written: ' + file + ' (' + Object.keys(d.ls).length + ' keys, history ' + d.history.length + ' bytes, laps ' + d.laps + ')');
  };
  if (RECORD) {
    /* the page before this phase: the session as it counted it, and the same session with its Demo Input laps left out (U4) */
    writeGolden(GOLDEN, (await run('')).dump);
    writeGolden(GOLDEN_SEP, (await run('', { demoLaps: false })).dump);
    return;
  }
  const golden = fs.readFileSync(GOLDEN, 'utf8').replace(/\r\n/g, '\n');
  const goldenSep = fs.readFileSync(GOLDEN_SEP, 'utf8').replace(/\r\n/g, '\n');
  const gd = JSON.parse(golden), gs = JSON.parse(goldenSep);
  const sepCanon = d => { const o = digestOf(d); o.laps -= DEMO_LAPS; return JSON.stringify(o, null, 1) + '\n'; };
  const diffOf = (g, n) => ['history', 'memory', 'secs', 'laps', 'minutes', 'xp', 'sessions'].filter(k => JSON.stringify(g[k]) !== JSON.stringify(n[k]))
    .concat(Object.keys(Object.assign({}, g.ls, n.ls)).filter(k => JSON.stringify(g.ls[k]) !== JSON.stringify(n.ls[k])));

  /* the opt-out: U4 changes a default, and `?demoRuns=count` is the page of before it, byte for byte */
  const legacyCount = await run('?demoRuns=count');
  const sameCount = canon(legacyCount.dump) + '\n' === golden;
  ok('?demoRuns=count: a session of ten laps (measured x4, a recall, Follow, Demo Input x4) leaves the legacy aggregates exactly as the page before this phase did', sameCount,
    sameCount ? Object.keys(legacyCount.dump.ls).length + ' keys, history ' + legacyCount.dump.history.length + ' bytes, sha256 ' + digestOf(legacyCount.dump).history.sha256.slice(0, 12) : 'differs in ' + diffOf(gd, digestOf(legacyCount.dump)).join(', '));
  ok('and no run summary names its kind', !/"source"/.test(legacyCount.dump.history) && !/"source"/.test(JSON.stringify(legacyCount.dump.ls)));
  ok('the golden dump is a real session: the ten laps come on top of the seeded history of the sample, with a memory record and section progress', gd.runs.length >= 10 && legacyCount.dump.memory.length > 40 && gd.laps >= 8 && Object.keys(gd.ls).length >= 2 && gd.runs.slice(-10).filter(r => r[4] === true).length === 4 && gd.runs.slice(-10).filter(r => r[4] === false).length === 6, 'runs ' + gd.runs.length + ', laps ' + gd.laps);

  /* the default: the same session, the four Demo Input laps no longer count */
  const legacy = await run('');
  const nd = digestOf(legacy.dump);
  const sameSep = sepCanon(legacy.dump) === goldenSep;
  ok('the default (U4): the same ten laps leave the aggregates exactly as the page before this phase did with its four Demo Input laps left out (history, memory, section bars, minutes, xp, weekly bars, saved state; only the lap counter, which is the screen, counts them)', sameSep,
    sameSep ? 'laps ' + legacy.dump.laps + ' (golden ' + gs.laps + ' + ' + DEMO_LAPS + '), history ' + legacy.dump.history.length + ' bytes, sha256 ' + nd.history.sha256.slice(0, 12) : 'differs in ' + diffOf(gs, Object.assign({}, nd, { laps: nd.laps - DEMO_LAPS })).join(', '));
  ok('and the two goldens differ exactly where U4 says: the Demo Input runs, the minutes and xp they added, the memory they moved (the six real laps are the same in both)',
    gs.runs.length === gd.runs.length - DEMO_LAPS && gs.minutes < gd.minutes && gs.xp < gd.xp && gs.history.sha256 !== gd.history.sha256 && gs.memory.sha256 !== gd.memory.sha256 && gs.laps === gd.laps - DEMO_LAPS,
    'runs ' + gd.runs.length + '->' + gs.runs.length + ', minutes ' + gd.minutes + '->' + gs.minutes + ', xp ' + gd.xp + '->' + gs.xp + ', laps ' + gd.laps + '->' + gs.laps);
  ok('the lap counter did count the four laps (the screen moves), and no run summary names its kind', legacy.dump.laps === gs.laps + DEMO_LAPS && !/"source"/.test(legacy.dump.history) && !/"source"/.test(JSON.stringify(legacy.dump.ls)), 'laps ' + legacy.dump.laps);
  ok('the sample\'s own seeded history stays: 23 runs, every one marked simulated, in front of the six real runs of the session', gs.runs.length === 29 && gs.runs.slice(0, 23).every(r => r[4] === true) && gs.runs.slice(-6).every(r => r[4] === false), 'runs ' + gs.runs.length);
  ok('nothing new was loaded or opened: no request for practice/runlog.js, no PPPRunLog, no IndexedDB ppp-runlog, no new localStorage key', legacy.requests === 0 && legacy.mod === 'undefined' && legacy.dbs.indexOf('ppp-runlog') < 0 && legacy.dump.keys.every(k => !/learner|runlog|demoRuns/.test(k)) && legacyCount.requests === 0 && legacyCount.dbs.indexOf('ppp-runlog') < 0, JSON.stringify({ r: legacy.requests, dbs: legacy.dbs }));

  const typedCount = await run('?learner=typed&demoRuns=count');
  const strippedSame = canon(withoutSource(typedCount.dump)) + '\n' === golden;
  ok('under typed, with demoRuns count, the same session differs from the golden only by the `source` of each run summary', strippedSame);
  const kindsCount = JSON.parse(typedCount.dump.history).runs.slice(-10).map(r => r.source).join(',');
  ok('and each summary names what the run was: measured x4, a recall, Follow, simulated x4', kindsCount === 'measured,measured,measured,measured,memory,follow,simulated,simulated,simulated,simulated', kindsCount);

  const typed = await run('?learner=typed');
  const strippedSep = sepCanon(withoutSource(typed.dump)) === goldenSep;
  ok('under typed, by default, the same session differs from the separated golden only by the `source` of each run summary', strippedSep);
  const typedRuns = JSON.parse(typed.dump.history).runs;
  const kinds = typedRuns.slice(-6).map(r => r.source).join(',');
  ok('and the runs it names are the six real ones: measured x4, a recall, Follow - the four Demo Input laps are in no summary', kinds === 'measured,measured,measured,measured,memory,follow' && typedRuns.length === 29, kinds + ' of ' + typedRuns.length);
  ok('the log holds the six real runs, counts the four Demo Input laps on its epoch (never as a run), and the evidence a model would read is the six - not the sample\'s 23 seeded ones',
    typed.log && typed.log.runs === 6 && typed.log.sim === 4 && typed.log.evidence === 6 && typedRuns.slice(0, 23).every(r => r.simulated === true && r.source === undefined), JSON.stringify(typed.log));
  ok('typed and legacy pages both ran without a page error', legacy.errors.length === 0 && typed.errors.length === 0 && legacyCount.errors.length === 0 && typedCount.errors.length === 0, legacy.errors.concat(typed.errors, legacyCount.errors, typedCount.errors).join('|'));
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
  const hist0 = await p.page.evaluate(() => ({ runs: PPP.app.state.history.runs.length, rev: PPP.app.state.history.rev, xp: PPP.app.state.xp, minutes: PPP.app.state.minutes, laps: PPP.app.state.laps }));
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
  const hist1 = await p.page.evaluate(() => ({ runs: PPP.app.state.history.runs.length, rev: PPP.app.state.history.rev, xp: PPP.app.state.xp, minutes: PPP.app.state.minutes, laps: PPP.app.state.laps }));
  ok('a Demo Input lap (no keyboard, decision U4) is not in the history: no new run, the same revision, the last run is still the recall', !dm.live && dm.counted && hist1.runs === hist0.runs && hist1.rev === hist0.rev && hd.source === 'memory', JSON.stringify({ live: dm.live, hist0: hist0, hist1: hist1, last: hd.source }));
  ok('and is not in the log: nothing new for the evidence the model reads, the epoch counts it', s4.runs.length === before && ev1 === ev0 && s4.epochs[0].sim.n === 1, JSON.stringify({ runs: before + '->' + s4.runs.length, evidence: ev0 + '->' + ev1, sim: s4.epochs[0].sim }));
  const kinds = s4.runs.map(r => r.run.src).join(',');
  ok('so the log holds exactly the three real kinds, in the order they were played', kinds === 'measured,follow,memory', kinds);
  ok('the screen still moved for the simulated lap (the lap counter), and nothing else did: no minutes, no xp', hist1.laps === hist0.laps + 1 && hist1.xp === hist0.xp && hist1.minutes === hist0.minutes, JSON.stringify([hist0, hist1]));
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
    /* a rating of a run that is not there is refused, and no record is written for it */
    const rateMissing = await log.rate('demo', hash, 999999, 2);
    const ratingsAfter = await new Promise((resolve, reject) => {
      const q = indexedDB.open('ppp-runlog');
      q.onsuccess = () => { const t = q.result.transaction('ratings'); const g = t.objectStore('ratings').getAll(); g.onsuccess = () => { q.result.close(); resolve(g.result.map(x => x.n)); }; g.onerror = () => reject(g.error); };
      q.onerror = () => reject(q.error);
    });
    return { rateMissing: rateMissing, ratingsAfter: ratingsAfter, n: r.runs.length, first: r.runs[0].n, last: r.runs[r.runs.length - 1].n, stats: log.stats, bytes: raw.map(x => JSON.stringify(x.e).length), rawN: raw.length, epochRuns: eps.epochs[0].runs, syncPerLap: sync / 310, laps: PPP.runLog.laps.length };
  });
  ok('310 runs leave 300 in the epoch, and the oldest ten are the ones gone', cap.n === 300 && cap.rawN === 300 && cap.first === 11 && cap.last === 310 && cap.epochRuns === 300, JSON.stringify({ n: cap.n, first: cap.first, last: cap.last }));
  ok('a rating of a run that is not there is refused (no-run) and writes nothing', cap.rateMissing.ok === false && cap.rateMissing.code === 'no-run' && cap.ratingsAfter.indexOf(999999) < 0, JSON.stringify({ r: cap.rateMissing, ratings: cap.ratingsAfter }));
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

  // a loop that is PLAYED (every lap is a real, logged run): while it plays the row does not show, and the laps are in the log
  const during = await q.page.evaluate(async () => {
    const A = PPP.app, sl = ms => new Promise(r => setTimeout(r, ms));
    A.setState({ practiceMode: 'practice', loop: true, tempo: 200 }); A.setLoop(1, 2); await sl(300);
    const a0 = PPP.runLog.log.stats.appended;
    const l0 = A.state.laps; A.togglePlay();
    let shownWhilePlaying = false, playingSeen = 0;
    const pressed = new WeakSet();
    const t0 = performance.now();
    while (A.state.laps < l0 + 2 && performance.now() - t0 < 20000) {
      await sl(100);
      const now = performance.now();
      ((A._perf && A._perf.expected) || []).forEach((x, i) => {      /* the notes of every lap, as they come due */
        if (pressed.has(x) || i % 5 === 4) return;
        const due = x.tMs - now;
        if (due < 400 && due > -60) { pressed.add(x); setTimeout(() => { window.__press(x.midi); setTimeout(() => window.__release(x.midi), 50); }, Math.max(0, due)); }
      });
      if (A.state.playing) { playingSeen++; if (document.querySelector('[data-run-rating]')) shownWhilePlaying = true; }
    }
    if (A.state.playing) A.togglePlay();
    await sl(500);
    await PPP.runLog.log.idle();
    return { shownWhilePlaying: shownWhilePlaying, playingSeen: playingSeen, laps: A.state.laps - l0, logged: PPP.runLog.log.stats.appended - a0, rowAfter: !!document.querySelector('[data-run-rating]') };
  });
  ok('while laps are looping (and being logged) the rating row stays out of the way; once the music has stopped it is there', during.laps >= 2 && during.logged >= 2 && during.playingSeen >= 3 && !during.shownWhilePlaying && during.rowAfter, JSON.stringify(during));

  // the export: through the Settings button, as a person does it
  await q.page.evaluate(() => { window.__dl = []; window.__urls = []; window.__revoked = []; const mk = URL.createObjectURL.bind(URL); URL.createObjectURL = b => { const u = mk(b); window.__dl.push(b); window.__urls.push(u); return u; }; const rv = URL.revokeObjectURL.bind(URL); URL.revokeObjectURL = u => { window.__revoked.push(u); return rv(u); }; });
  await toSettings(q.page);
  const status = await q.page.evaluate(() => ({ title: (document.querySelector('[data-run-log-settings]') || {}).innerText, status: (document.querySelector('[data-run-log-status]') || {}).innerText }));
  ok('Settings shows the practice log and what it holds', /Practice log/.test(status.title || '') && /Runs saved: 4 · songs: 1/.test(status.status || '') && !/Nothing played/.test(status.status || ''), JSON.stringify(status));
  await q.page.evaluate(() => document.querySelector('[data-run-log-export]').click());
  await sleep(900);
  const text = await q.page.evaluate(async () => (window.__dl[0] ? await window.__dl[0].text() : null));
  ok('the button hands over one file', typeof text === 'string' && text.length > 100);
  await sleep(1300);
  const given = await q.page.evaluate(() => ({ made: window.__urls.length, back: window.__urls.length > 0 && window.__revoked.indexOf(window.__urls[0]) >= 0 }));
  ok('and the address of the file is given back to the browser a moment later (revokeObjectURL on the very address createObjectURL made)', given.made >= 1 && given.back, JSON.stringify(given));
  const parsed = await q.page.evaluate(async t => {
    const P = window.PPPRunLog;
    const r = P.parseExport(t);
    const live = await PPP.runLog.log.exportAll();
    return { ok: r.ok, rejected: r.rejected, same: r.ok && JSON.stringify(r.file.epochs) === JSON.stringify(live.file.epochs), epochs: r.ok ? r.file.epochs.length : 0, runs: r.ok ? r.file.epochs[0].runs.length : 0, format: r.ok && r.file.format, rt: r.ok && r.file.epochs[0].runs.map(x => x.rt) };
  }, text);
  ok('and re-reading the file gives back exactly the log (every epoch, every run, the rating)', parsed.ok && parsed.same && parsed.rejected === 0 && parsed.epochs === 1 && parsed.runs === 4 && parsed.format === 'ppp-practice-log' && parsed.rt[0] === 3 && parsed.rt.slice(1).every(v => v == null), JSON.stringify(parsed));
  // nothing of the account in it: the keys the app really uses (library-backup.js KEY: the link-sharing key, the PC link and the one before it)
  const secret = await q.page.evaluate(async () => {
    localStorage.setItem('ppp-guest-key', 'SECRET-GUEST-KEY-123');
    localStorage.setItem('ppp.pclink.v1', JSON.stringify({ v: 1, code: 'SECRET-PC-CODE-456' }));
    localStorage.setItem('ppp.pclink.prev.v1', JSON.stringify({ v: 1, code: 'SECRET-PC-PREV-789' }));
    const planted = ['ppp-guest-key', 'ppp.pclink.v1', 'ppp.pclink.prev.v1'].every(k => localStorage.getItem(k) !== null);
    const ex = await PPP.runLog.log.exportAll(); const t = PPPRunLog.exportText(ex.file);
    return { planted: planted, has: /SECRET-GUEST|SECRET-PC|guest-key|pclink/i.test(t), keys: Object.keys(ex.file).join(','), epochKeys: Object.keys(ex.file.epochs[0]).join(',') };
  });
  ok('the file carries no guest key, PC code or secret (planted under the names the app really uses): only the fields of the log itself', secret.planted && !secret.has && secret.keys === 'format,version,exportedAt,schema,epochs,skipped', JSON.stringify(secret));

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
    for (let round = 0; round < 2; round++) {          /* two rounds of 60 laps; see the rule below */
      for (let i = 0; i < 60; i++) {
        const t = performance.now();
        A.completeLap(A.state, result.counts.matched, result.counts.expected, result);
        runs.push(performance.now() - t);
        await sl(30);
      }
      await sl(400);
    }
    const t1 = performance.now();
    await PPP.runLog.log.idle();
    const idle = performance.now() - t1;
    const share = PPP.runLog.laps.map(l => l.ms);
    const log = PPP.runLog.log;
    const eps = (await log.epochs()).epochs;   /* none when every run was refused (too large): the checks below say so, the page does not crash */
    const stored = eps.length ? (await log.read(A.state.songId, eps[0].hash)).runs.map(r => r.run) : [];
    return { live: live, notes: perf.expected.length, measures: A.state.score.measures.length, whole: runs, share: share.slice(-120), idle: idle,
      bytes: stored.map(r => JSON.stringify(r).length), g: stored.map(r => r.g), tr: stored.filter(r => r.tr).length, ex: stored.length ? stored[0].ex : 0, degraded: log.degraded, failed: log.stats.refused };
  }, 'catalog/method/sonatina/020.mxl');
  const at = (a, q) => { const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };
  const mean = a => a.reduce((s, v) => s + v, 0) / a.length;
  ok('a whole-piece lap of the 1,776-note Sonatina is judged by a live engine with the log on', m.live && m.notes > 1700 && !m.degraded, m.notes + ' notes, ' + m.measures + ' measures');
  /* THE RULE. Chrome's CPU throttle slows a short task by 1x to 5x depending on where in its duty cycle the task falls (tests/practice/perf.js knows it too), and another process on the
     machine adds time to any lap: noise only ever ADDS time. So the budget is held by the median and the 90th percentile of 60 laps, scaled by the speed of this machine (calibration), and a
     round counts at its best: the check passes when EITHER of two rounds of 60 laps is within the limits (a loaded machine has to be loaded for both). The worst lap is reported, never failed on. */
  const rounds = [m.share.slice(0, 60), m.share.slice(60, 120)];
  const within = r => at(r, 0.5) <= 3 * scale && at(r, 0.9) <= 5 * scale;
  ok('the synchronous share of the log in a lap (build the entry, queue the write) is within 5 ms at CPU 4x: median and p90 of 60 laps of a 158-measure piece, best of two rounds', rounds.some(within),
    'limits 3 and 5 ms x ' + scale.toFixed(2) + ' (this machine ' + calib.toFixed(0) + ' ms on the reference workload, reference ' + CALIB_REF + '); round 1: median ' + at(rounds[0], 0.5).toFixed(2) + ' p90 ' + at(rounds[0], 0.9).toFixed(2) + ' max ' + Math.max.apply(null, rounds[0]).toFixed(2) +
    ' ms (first lap ' + m.share[0].toFixed(2) + '); round 2: median ' + at(rounds[1], 0.5).toFixed(2) + ' p90 ' + at(rounds[1], 0.9).toFixed(2) + ' max ' + Math.max.apply(null, rounds[1]).toFixed(2) + ' ms');
  ok('(the whole completeLap call, for scale: mean ' + mean(m.whole).toFixed(1) + ' ms, p95 ' + at(m.whole, 0.95).toFixed(1) + ' ms, and the IndexedDB commits all done ' + m.idle.toFixed(0) + ' ms after the last lap)', m.whole.length === 120);
  ok('a whole piece in one run still fits 2 KB: ' + m.measures + ' measures, rows merged by ' + (m.g.length ? Math.max.apply(null, m.g) : '-') + ' (`g`), largest ' + (m.bytes.length ? Math.max.apply(null, m.bytes) : '-') + ' bytes, none emptied', m.bytes.length === 120 && Math.max.apply(null, m.bytes) <= 2048 && m.tr === 0, JSON.stringify({ bytes: m.bytes.length ? Math.max.apply(null, m.bytes) : null, g: m.g[0], kept: m.bytes.length, refused: m.failed }));
  ok('no page error', p.probe.errors.length === 0, p.probe.errors.join('|'));
  await p.close();
}

/* ---------------------------------------------------------------- 7. decision U4 */
async function demoSection(browser) {
  console.log('\n── PPP.demoRuns (decision U4, decided YES 2026-10-13): a run without a keyboard moves the screen and writes no evidence ──');
  /* ---- A. lap-end results of the random kind through the app's own completeLap (exact and fast): what each switch value keeps */
  const demoLaps = page => page.evaluate(async () => {
    const A = PPP.app, sl = ms => new Promise(r => setTimeout(r, ms));
    const clone = o => JSON.parse(JSON.stringify(o));
    const said = [];
    const say = A.say.bind(A);
    A.say = m => { said.push(m); return say(m); };
    /* a coach plan whose first task is a loop the laps are played on, so that a counted lap would be a repetition of that task */
    await A.requestPlan();
    const plan = clone(A.state.coachPlan);
    plan.tasks[0].range = { start: 1, end: 4 }; plan.tasks[0].repetitions = 4; plan.tasks[0].hand = 'both'; plan.tasks[0].mode = 'practice'; plan.tasks[0].tempoPercent = 100;
    A.setState({ coachPlan: plan, coachTask: 0, coachReps: 0, coachDone: [] });
    const snap = () => {
      const S = A.state;
      return { hist: clone(S.history), mem: clone(S.memory), secs: clone(S.secs), minutes: S.minutes, xp: S.xp, sessions: clone(S.sessions), laps: S.laps,
        seqStep: S.seqStep, seqReps: S.seqReps, coachTask: S.coachTask, coachReps: S.coachReps, coachDone: S.coachDone.length, lastAcc: S.lastAcc, drift: S.drift };
    };
    const doLap = async (mode, from, to) => {
      A.setState({ practiceMode: mode, loop: true, tempo: 200, hands: 'both' }); A.setLoop(from, to); await sl(300);
      A._sim = A.newSim();
      const ev = A.fire(A.state, 0, 1e6);
      const patch = A.completeLap(A.state, ev.hit, ev.tot, null);
      A.setState(patch); await sl(200);
    };
    const before = snap();
    await doLap('practice', 1, 4);               /* the coach's own loop: a counted lap would be a repetition of the task */
    const afterC = snap();
    await doLap('practice', 5, 8);               /* a passage the person picked: a counted lap would step the Loop panel */
    const afterP = snap();
    await doLap('memory', 1, 4);                 /* a recall: a counted one would move memory */
    const afterM = snap();
    await doLap('practice', 1, 4);
    const second = snap();
    const text = sel => { const e = document.querySelector(sel); return e ? (e.innerText || '').trim() : null; };
    let sim = null;
    if (PPP.learner === 'typed' && PPP.runLog.log) { await PPP.runLog.log.idle(); sim = (await PPP.runLog.log.epochs()).epochs.reduce((a, x) => a + x.sim.n, 0); }
    return { before: before, afterC: afterC, afterP: afterP, afterM: afterM, second: second, said: said.slice(), sim: sim,
      note: text('[data-demo-note]'), acc: text('[data-run-accuracy]'), drift: text('[data-run-drift]') };
  });
  const run = async query => { const p = await open(browser, { query: query }); await toPractice(p.page, false); const r = await demoLaps(p.page); r.errors = p.probe.errors; await p.close(); return r; };
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const untouched = (a, b) => same(a.hist, b.hist) && same(a.mem, b.mem) && same(a.secs, b.secs) && a.minutes === b.minutes && a.xp === b.xp && same(a.sessions, b.sessions) &&
    a.seqStep === b.seqStep && a.seqReps === b.seqReps && a.coachTask === b.coachTask && a.coachReps === b.coachReps && a.coachDone === b.coachDone && a.lastAcc === b.lastAcc && a.drift === b.drift;

  const sep = await run('');
  ok('the default, under legacy: four laps without a keyboard leave history, memory, section bars, minutes, xp, weekly bars, the Loop panel and the coach task exactly as they were',
    untouched(sep.before, sep.second), JSON.stringify({ rev: sep.before.hist.rev + '->' + sep.second.hist.rev, xp: sep.before.xp + '->' + sep.second.xp, minutes: sep.before.minutes + '->' + sep.second.minutes, coach: sep.before.coachReps + '->' + sep.second.coachReps, seq: sep.before.seqReps + '->' + sep.second.seqReps }));
  ok('step by step: the coach\'s loop, a passage of one\'s own and a recall each leave all of it alone',
    untouched(sep.before, sep.afterC) && untouched(sep.afterC, sep.afterP) && untouched(sep.afterP, sep.afterM) && untouched(sep.afterM, sep.second));
  ok('and the recall record in particular: a random recall cannot move memory strength or mark a section memorized',
    same(sep.afterM.mem, sep.before.mem) && Object.keys(sep.afterM.mem.sections || {}).every(k => !sep.afterM.mem.sections[k].memorized || sep.before.mem.sections[k].memorized));
  ok('but the screen moved: the lap counter counted each of the four laps', sep.before.laps + 4 === sep.second.laps, sep.before.laps + '->' + sep.second.laps);
  ok('and the person is told that it was not recorded, and what to do: once on a practice lap (not on every one), and after the recall, which is a deliberate attempt', sep.said.length === 2 && sep.said.every(m => /Not recorded/.test(m) && /MIDI keyboard/.test(m)), JSON.stringify(sep.said));
  ok('the card on the practice page says plainly that this run is not recorded, and shows no accuracy and no drift of its own', /not recorded/.test(sep.note || '') && sep.acc === '—' && sep.drift === '—', JSON.stringify({ note: sep.note, acc: sep.acc, drift: sep.drift }));
  const lg = await run('?demoRuns=count');
  ok('?demoRuns=count: the same four laps are folded in as before U4 (history, section bars, minutes, xp; the recall is recorded; the coach task moves), with no `source` under legacy and no line on the card',
    lg.second.hist.runs.length === lg.before.hist.runs.length + 4 && lg.second.hist.rev === lg.before.hist.rev + 4 && lg.second.xp > lg.before.xp && lg.second.minutes > lg.before.minutes && lg.second.coachReps > 0 &&
    lg.second.hist.runs[lg.second.hist.runs.length - 1].source === undefined && !lg.note && /%$/.test(lg.acc || ''),
    JSON.stringify({ runs: lg.before.hist.runs.length + '->' + lg.second.hist.runs.length, coach: lg.second.coachReps, note: lg.note, acc: lg.acc }));
  const ty = await run('?learner=typed');
  ok('the default, under typed: the same, and the epoch counts the four laps without a keyboard (an export says how much practice had none)',
    untouched(ty.before, ty.second) && ty.before.laps + 4 === ty.second.laps && ty.sim === 4, JSON.stringify({ sim: ty.sim }));
  const tc = await run('?learner=typed&demoRuns=count');
  ok('typed with demoRuns count: the laps are folded in and named simulated', tc.second.hist.runs.slice(-4).every(r => r.source === 'simulated') && tc.second.hist.runs.length === tc.before.hist.runs.length + 4);
  ok('no page error', sep.errors.length + lg.errors.length + ty.errors.length + tc.errors.length === 0, [sep, lg, ty, tc].map(x => x.errors.join('|')).join(';'));

  /* ---- C. the line on the card and the hint, in the four languages: with no keyboard, and after one has been connected */
  const WORDS = {
    'en-US': { note: 'No keyboard connected, so this run is not recorded. (Demo Input)', last: 'The last run was played without a keyboard, so it was not recorded. (Demo Input)',
      toast: 'Not recorded. To record your practice, click "Demo Input" at the top and connect a MIDI keyboard.' },
    'ko-KR': { note: '건반이 연결되지 않아 이번 연습은 기록되지 않아요. (데모 입력)', last: '직전 연습은 건반 없이 해서 기록되지 않았어요. (데모 입력)',
      toast: '기록되지 않았어요. 연습을 기록하려면 위쪽의 "데모 입력"을 눌러 MIDI 건반을 연결해 주세요.' },
    'ja-JP': { note: 'キーボードがつながっていないため、今回の練習は記録されません。（デモ入力）', last: '直前の練習はキーボードなしだったため、記録されていません。（デモ入力）',
      toast: '記録されませんでした。練習を記録するには、上の「デモ入力」を押してMIDIキーボードをつないでください。' },
    'zh-CN': { note: '没有连接键盘，所以这次练习不会被记录。（演示输入）', last: '上一遍练习没有键盘，所以没有记录。（演示输入）',
      toast: '这次没有记录。要记录练习，请点击上方的“演示输入”并连接 MIDI 键盘。' }
  };
  for (const loc of Object.keys(WORDS)) {
    const p = await open(browser, { midi: true, init: [[l => { localStorage.setItem('ppp-locale', l); }, loc]] });
    await toPractice(p.page, false);
    const r = await p.page.evaluate(async () => {
      const A = PPP.app, sl = ms => new Promise(res => setTimeout(res, ms));
      A.setState({ practiceMode: 'practice', loop: true, tempo: 200, hands: 'both' }); A.setLoop(1, 2); await sl(300);
      A._sim = A.newSim();
      const ev = A.fire(A.state, 0, 1e6);
      A.setState(A.completeLap(A.state, ev.hit, ev.tot, null));
      const toast = A.state.toast;
      await sl(300);
      const text = () => { const n = document.querySelector('[data-demo-note]'); return n ? n.innerText.trim() : null; };
      const note = text();
      /* the keyboard comes (no run has been played on it): the line is about the LAST run now, and no number of an older one stands next to it */
      await A.connectMidi();
      await sl(900);
      const acc = document.querySelector('[data-run-accuracy]');
      return { note: note, toast: toast, last: text(), live: A.liveMidi(), acc: acc ? acc.innerText.trim() : null };
    });
    ok(loc + ': the card says ' + WORDS[loc].note, r.note === WORDS[loc].note, JSON.stringify(r.note));
    ok(loc + ': and the hint says where to click', r.toast === WORDS[loc].toast, JSON.stringify(r.toast));
    ok(loc + ': with a keyboard connected since, the line says the last run was not recorded, and its accuracy is not a stale number', r.live && r.last === WORDS[loc].last && r.acc === '—', JSON.stringify({ live: r.live, last: r.last, acc: r.acc }));
    await p.close();
  }
  {
    /* a browser without Web MIDI (an iPhone, an iPad): the hint does not send anyone to a button that cannot work */
    const p = await open(browser, { init: [[() => { try { delete navigator.requestMIDIAccess; Object.defineProperty(Navigator.prototype, 'requestMIDIAccess', { value: undefined, configurable: true }); } catch (e) { /* none */ } }, null]] });
    await toPractice(p.page, false);
    const r = await p.page.evaluate(async () => {
      const A = PPP.app, sl = ms => new Promise(res => setTimeout(res, ms));
      A.setState({ practiceMode: 'practice', loop: true, tempo: 200, hands: 'both' }); A.setLoop(1, 2); await sl(300);
      A._sim = A.newSim();
      const ev = A.fire(A.state, 0, 1e6);
      A.setState(A.completeLap(A.state, ev.hit, ev.tot, null));
      return { toast: A.state.toast, web: A.midiLayer().supported() };
    });
    ok('no Web MIDI: the hint says the browser cannot record, instead of pointing at the Demo Input button', !r.web && /no Web MIDI/.test(r.toast || ''), JSON.stringify(r));
    await p.close();
  }
}

/* ---------------------------------------------------------------- 7b. decision U4, in the page's real clock */
async function demoLiveSection(browser) {
  console.log('\n── PPP.demoRuns (decision U4): real laps in Korean without a keyboard leave the progress as it was; with a (fake) keyboard they count ──');
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  /* real laps in the page, in Korean: five laps without a keyboard leave the progress as it was; with a (fake) keyboard they count */
  {
    const p = await open(browser, { midi: true, init: [[l => { localStorage.setItem('ppp-locale', l); }, 'ko-KR']] });
    await toPractice(p.page, false);
    const snapIn = async () => {
      const A = PPP.app, S = A.state, clone = o => JSON.parse(JSON.stringify(o));
      A.saveNow(); await new Promise(r => setTimeout(r, 400));
      let saved = null;
      try { const j = JSON.parse(localStorage.getItem('ppp.state.v2')); saved = JSON.stringify({ history: j.history, memory: j.memory, secs: j.secs, minutes: j.minutes, xp: j.xp, sessions: j.sessions }); } catch (e) { /* none */ }
      return { hist: clone(S.history), mem: clone(S.memory), secs: clone(S.secs), minutes: S.minutes, xp: S.xp, sessions: clone(S.sessions), laps: S.laps,
        seqStep: S.seqStep, seqReps: S.seqReps, coachTask: S.coachTask, coachReps: S.coachReps, coachDone: S.coachDone.length, saved: saved };
    };
    const lapsInPage = (page, o) => page.evaluate(async o2 => {
      const A = PPP.app, sl = ms => new Promise(r => setTimeout(r, ms));
      if (!window.__said) { window.__said = []; const say = A.say.bind(A); A.say = m => { window.__said.push(m); return say(m); }; }
      A.setState({ toggles: Object.assign({}, A.state.toggles, { follow: false }), practiceMode: 'practice', loop: true, tempo: 200, hands: 'both' });
      A.setLoop(o2.from, o2.to); await sl(300);
      const l0 = A.state.laps;
      A.togglePlay();
      const t0 = performance.now();
      while (A.state.laps < l0 + o2.laps && performance.now() - t0 < 90000) await sl(100);
      const n = A.state.laps - l0;
      if (A.state.playing) A.togglePlay();
      await sl(600);
      const note = document.querySelector('[data-demo-note]');
      return { laps: n, live: A.liveMidi(), note: note ? note.innerText.trim() : null, said: window.__said.slice() };
    }, o);
    /* a coach task on bars 1-2 (four repetitions), and a passage of one's own on bars 3-4 */
    await p.page.evaluate(async () => {
      const A = PPP.app;
      await A.requestPlan();
      const plan = JSON.parse(JSON.stringify(A.state.coachPlan));
      plan.tasks[0].range = { start: 1, end: 2 }; plan.tasks[0].repetitions = 4; plan.tasks[0].hand = 'both'; plan.tasks[0].mode = 'practice'; plan.tasks[0].tempoPercent = 240;
      A.setState({ coachPlan: plan, coachTask: 0, coachReps: 0, coachDone: [] });
    });
    const s0 = await p.page.evaluate(snapIn);
    const d1 = await lapsInPage(p.page, { from: 3, to: 4, laps: 5 });          /* a passage of one's own: the Loop panel's steps would move */
    const s1 = await p.page.evaluate(snapIn);
    const d2 = await lapsInPage(p.page, { from: 1, to: 2, laps: 5 });          /* the coach's task: its repetitions would move */
    const s2 = await p.page.evaluate(snapIn);
    const ui = await p.page.evaluate(() => { const n = document.querySelector('[data-demo-note]'); return n ? n.innerText.trim() : null; });
    const ident = (a, b) => same(a.hist, b.hist) && same(a.mem, b.mem) && same(a.secs, b.secs) && a.minutes === b.minutes && a.xp === b.xp && same(a.sessions, b.sessions) &&
      a.seqStep === b.seqStep && a.seqReps === b.seqReps && a.coachTask === b.coachTask && a.coachReps === b.coachReps && a.coachDone === b.coachDone && a.saved === b.saved;
    ok('five real laps without a keyboard on a passage of one\'s own: the page played them (the lap counter moved by 5) and nothing was recorded, in the state or in what was saved',
      d1.laps === 5 && !d1.live && s1.laps === s0.laps + 5 && ident(s0, s1), JSON.stringify({ laps: d1.laps, live: d1.live, hist: s0.hist.rev + '->' + s1.hist.rev, seq: s0.seqReps + '->' + s1.seqReps }));
    ok('five more on the coach\'s task: history, memory, section bars, minutes, xp, weekly bars, Loop panel steps, the task\'s repetitions and what was saved are exactly as before',
      d2.laps === 5 && s2.laps === s1.laps + 5 && ident(s0, s2), JSON.stringify({ coach: s0.coachReps + '->' + s2.coachReps, done: s0.coachDone + '->' + s2.coachDone, xp: s0.xp + '->' + s2.xp, min: s0.minutes + '->' + s2.minutes }));
    ok('the card says so in Korean in one line, and the first lap told what to do (once)',
      /건반이 연결되지 않아 이번 연습은 기록되지 않아요/.test(ui || '') && d1.said.filter(m => /기록되지 않았어요/.test(m)).length === 1 && d2.said.length === d1.said.length, JSON.stringify({ note: ui, said: d2.said }));

    /* the keyboard comes: the same laps count */
    await toPractice(p.page, true);
    const live = await p.page.evaluate(() => PPP.app.liveMidi());
    const k1 = await p.page.evaluate(realLapInPage, { mode: 'practice', from: 1, to: 2 });
    const k2 = await p.page.evaluate(realLapInPage, { mode: 'practice', from: 1, to: 2 });
    const k3 = await p.page.evaluate(realLapInPage, { mode: 'practice', from: 3, to: 4 });
    const s3 = await p.page.evaluate(snapIn);
    const noteGone = await p.page.evaluate(() => !document.querySelector('[data-demo-note]'));
    ok('with a (fake) keyboard connected the same laps count: three runs in the history, section bars, minutes and xp up',
      live && k1.counted && k2.counted && k3.counted && k1.live && s3.hist.runs.length === s2.hist.runs.length + 3 && s3.xp > s2.xp && s3.minutes > s2.minutes && !same(s3.secs, s2.secs),
      JSON.stringify({ live: live, runs: s2.hist.runs.length + '->' + s3.hist.runs.length, xp: s2.xp + '->' + s3.xp, min: s2.minutes + '->' + s3.minutes }));
    ok('and the coach task and the Loop panel step with them, and the line on the card is gone',
      (s3.coachReps > s2.coachReps || s3.coachDone > s2.coachDone) && (s3.seqStep > s2.seqStep || s3.seqReps > s2.seqReps) && noteGone,
      JSON.stringify({ coach: s2.coachReps + '/' + s2.coachDone + '->' + s3.coachReps + '/' + s3.coachDone, seq: s2.seqStep + '/' + s2.seqReps + '->' + s3.seqStep + '/' + s3.seqReps, noteGone: noteGone }));
    ok('no page error', p.probe.errors.length === 0, p.probe.errors.join('|'));
    await p.close();
  }
}

/* ---------------------------------------------------------------- 7c. a keyboard that goes live after Play */
/* Play without a keyboard, then connect one (or the MIDI permission resolves): the lap in progress is a Demo Input lap, the next one is judged. The page used to decide at the START of
   a lap whether the next one was a real run, so a keyboard that came later was never judged until Stop and Play. Also the rules of when the card says so (the line shows while a run
   without a keyboard plays, and, about the last run, after a keyboard has come, until a recorded run replaces it) and what the Progress and Home screens say of it. */
async function demoConnectSection(browser) {
  console.log('\n-- a keyboard that goes live after Play is judged from the next lap; what the card, Progress and Home say meanwhile --');
  const p = await open(browser, { midi: true });
  await toPractice(p.page, false);
  const state = () => p.page.evaluate(() => {
    const A = PPP.app, S = A.state;
    const n = document.querySelector('[data-demo-note]'), a = document.querySelector('[data-run-accuracy]');
    return { runs: S.history.runs.length, xp: S.xp, laps: S.laps, lastDemo: !!S.lastDemo, lastRec: !!S.lastRec, playing: S.playing, live: A.liveMidi(), note: n ? n.innerText.trim() : null, acc: a ? a.innerText.trim() : null };
  });
  /* the value under a label on a screen, by its English label (the page is en-US): the first word of the line after it */
  const progressAccuracy = async () => {
    await p.page.evaluate(l => window.__pppTest.nav(l), 'Progress');
    await sleep(600);
    return p.page.evaluate(() => {
      const el = document.querySelector('[data-progress-song]');
      const lines = (el ? el.innerText : '').split('\n').map(x => x.trim()).filter(Boolean);
      const i = lines.indexOf('Accuracy');
      return i >= 0 && lines[i + 1] ? lines[i + 1].split(' ')[0] : null;
    });
  };
  const homePracticed = async () => {
    await p.page.evaluate(l => window.__pppTest.nav(l), 'Home');
    await sleep(600);
    return p.page.evaluate(() => {
      const lines = document.body.innerText.split('\n').map(x => x.trim()).filter(Boolean);
      const i = lines.indexOf('Last practiced');
      return i >= 0 ? lines[i + 1] : null;
    });
  };

  // 1. no keyboard: a run in progress is already named, before any lap has ended
  await p.page.evaluate(async () => {
    const A = PPP.app, sl = ms => new Promise(r => setTimeout(r, ms));
    A.setState({ toggles: Object.assign({}, A.state.toggles, { follow: false }), practiceMode: 'practice', loop: true, tempo: 200, hands: 'both' });
    A.setLoop(1, 2); await sl(300);
    window.__l0 = A.state.laps;
    A.togglePlay();
  });
  await sleep(700);
  const during = await state();
  ok('while the FIRST lap without a keyboard plays (no lap has ended yet) the card already says that this run is not recorded', during.playing && during.laps === 0 && during.note === 'No keyboard connected, so this run is not recorded. (Demo Input)', JSON.stringify(during));
  await p.page.evaluate(async () => { const A = PPP.app, sl = ms => new Promise(r => setTimeout(r, ms)); const t0 = performance.now(); while (A.state.laps < 2 && performance.now() - t0 < 30000) await sl(100); A.togglePlay(); await sl(500); });
  const demoOnly = await state();
  ok('after two laps without a keyboard: nothing recorded (history, xp), the line is there, the card shows no number', demoOnly.laps >= 2 && demoOnly.runs === 23 && demoOnly.xp === 1240 && demoOnly.lastDemo && /not recorded/.test(demoOnly.note || '') && demoOnly.acc === '—', JSON.stringify(demoOnly));
  const acc0 = await progressAccuracy();
  const prac0 = await homePracticed();
  ok('Progress shows no accuracy for a run that was not recorded (not the 91% of a fresh page), and Home does not say "just now"', acc0 === '—' && prac0 !== 'just now', JSON.stringify({ acc: acc0, practiced: prac0 }));
  await p.page.evaluate(l => window.__pppTest.practice(null, 'Practice'), null);
  await sleep(500);

  // 2. Play again with no keyboard, connect one in the middle of the loop, press the notes that are due
  const mid = await p.page.evaluate(async () => {
    const A = PPP.app, sl = ms => new Promise(r => setTimeout(r, ms));
    A.setLoop(1, 2); await sl(300);
    A.togglePlay();
    const t0 = performance.now();
    const l1 = A.state.laps;
    while (A.state.laps < l1 + 1 && performance.now() - t0 < 30000) await sl(100);      /* one more lap without a keyboard, so that the loop is running */
    const hist0 = A.state.history.runs.length, xp0 = A.state.xp, lapsAtConnect = A.state.laps;
    const nextTo = () => { const n = document.querySelector('[data-demo-note]'); return n ? n.innerText.trim() : null; };
    await A.connectMidi();
    const t1 = performance.now();
    while (!A.liveMidi() && performance.now() - t1 < 5000) await sl(50);
    await sl(150);
    const lineOnConnect = nextTo();
    const accOnConnect = (document.querySelector('[data-run-accuracy]') || {}).innerText;
    const pressed = new WeakSet();
    const t2 = performance.now();
    let lineWhileJudged = null, lapsToRecord = null;
    while (performance.now() - t2 < 45000) {
      await sl(100);
      const now = performance.now();
      ((A._perf && A._perf.expected) || []).forEach((x, i) => {      /* the notes of every lap, as they come due */
        if (pressed.has(x) || i % 5 === 4) return;
        const due = x.tMs - now;
        if (due < 400 && due > -60) { pressed.add(x); setTimeout(() => { window.__press(x.midi); setTimeout(() => window.__release(x.midi), 50); }, Math.max(0, due)); }
      });
      if (A.state.history.runs.length > hist0) { lapsToRecord = A.state.laps - lapsAtConnect; break; }
    }
    await sl(500);                                       /* still playing: the next lap of the loop is under way, with a keyboard */
    lineWhileJudged = nextTo();
    const playingThen = A.state.playing;
    const accWhileJudged = (document.querySelector('[data-run-accuracy]') || {}).innerText;
    const lastDemoThen = !!A.state.lastDemo;
    if (A.state.playing) A.togglePlay();
    await sl(600);
    return { hist0: hist0, hist1: A.state.history.runs.length, xp0: xp0, xp1: A.state.xp, lapsToRecord: lapsToRecord, lineOnConnect: lineOnConnect, accOnConnect: accOnConnect,
      lineWhileJudged: lineWhileJudged, accWhileJudged: accWhileJudged, playingThen: playingThen, lastDemoThen: lastDemoThen, live: A.liveMidi(), last: A.state.history.runs[A.state.history.runs.length - 1] };
  });
  ok('a keyboard connected in the middle of a loop that began without one is judged from the next lap: one run is recorded within three laps, and xp goes up',
    mid.live && mid.hist1 === mid.hist0 + 1 && mid.xp1 > mid.xp0 && mid.lapsToRecord >= 1 && mid.lapsToRecord <= 3 && mid.last && mid.last.simulated === false && mid.last.counts && mid.last.counts.matched > 0, JSON.stringify({ hist: mid.hist0 + '->' + mid.hist1, xp: mid.xp0 + '->' + mid.xp1, laps: mid.lapsToRecord, last: mid.last && mid.last.simulated }));
  ok('meanwhile the line is about the LAST run (it was without a keyboard)', mid.lineOnConnect === 'The last run was played without a keyboard, so it was not recorded. (Demo Input)', JSON.stringify({ line: mid.lineOnConnect }));
  ok('and once a run is recorded, while the loop goes on with the keyboard, the line is gone and the run is no longer called unrecorded', mid.playingThen && mid.lineWhileJudged === null && !mid.lastDemoThen, JSON.stringify({ line: mid.lineWhileJudged, lastDemo: mid.lastDemoThen, playing: mid.playingThen }));
  const acc1 = await progressAccuracy();
  const prac1 = await homePracticed();
  ok('Progress now shows the accuracy of the recorded run, and Home says "just now"', /^\d+%$/.test(acc1 || '') && prac1 === 'just now', JSON.stringify({ acc: acc1, practiced: prac1 }));
  await p.page.evaluate(l => window.__pppTest.practice(null, 'Practice'), null);
  await sleep(500);

  // 3. unplug: a recorded run is never called unrecorded afterwards
  await p.page.evaluate(() => { const A = PPP.app; A.setState({ toggles: Object.assign({}, A.state.toggles, { midi: false }) }); });
  await sleep(500);
  const gone = await state();
  ok('after the keyboard is switched off, the last run was a recorded one: no line, and its accuracy is still on the card', !gone.live && !gone.lastDemo && gone.note === null && /%$/.test(gone.acc || ''), JSON.stringify(gone));
  ok('no page error', p.probe.errors.length === 0, p.probe.errors.join('|'));
  await p.close();
}

/* ---------------------------------------------------------------- 8. what a person sees */
async function uiSection(browser) {
  console.log('\n── Settings > Practice log and the rating row: typed only, in four languages ──');
  const LOCALES = {
    'en-US': { title: 'Practice log', btn: 'Export practice log', rate: 'How was that run?', chips: ['Easy', 'Just right', 'Hard'] },
    'ko-KR': { title: '연습 로그', btn: '연습 로그 내보내기', rate: '방금 연습은 어땠나요?', chips: ['쉬움', '알맞음', '어려움'] },
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

/* ---------------------------------------------------------------- 3b. what a run says */
/* laps made through the page's own completeLap with real matcher results (a seeded script, no clock): what the run in the log says of the hands, the tempo, the hints, the
   memory level and the wrong and extra keys, and what a Follow run does NOT say (a tempo) */
async function fieldsSection(browser) {
  console.log('\n── what a run says: hands, tempo, range, hints, memory level, wrong and extra keys; a Follow run has no tempo ──');
  const p = await open(browser, { query: '?learner=typed' });
  await toPractice(p.page, false);
  const o = await p.page.evaluate(async () => {
    const A = PPP.app, sl = ms => new Promise(r => setTimeout(r, ms));
    const score = A.state.score;
    const engine = (from, to, hands, tempo, mode, wrong) => {
      const e = new PPP.PerformanceEngine(score).begin({ from: from, to: to, hands: hands, tempo: tempo, practiceMode: mode, startedAt: 1000 });
      e.expected.forEach((x, i) => {
        if (wrong && i % 3 === 0) e.noteOn({ midi: x.midi + 1, t: x.tMs + 5, type: 'on' });
        if (i % 4 !== 3) e.noteOn({ midi: x.midi, t: x.tMs + 8, type: 'on' });
      });
      if (wrong) e.noteOn({ midi: 21, t: 1000 + 99999, type: 'on' });
      e.advanceTo(1e9);
      return e;
    };
    const hand = (t, m) => ({ total: t, matched: m, timingAbsSum: 0, timingCount: 0 });
    const follow = { byMeasure: { 1: { total: 7, matched: 7, missed: 0, wrong: 1, extra: 0, onTime: 7, early: 0, late: 0, timingAbsSum: 0, timingCount: 0, accuracy: 1, hands: { r: hand(4, 4), l: hand(3, 3) } } },
      bySection: {}, expected: 7, matched: 7, accuracy: 1, meanDeltaMs: 0, timing: null, follow: true };
    const results = [];
    const lap = async (patch, e, result) => {
      A.setState(Object.assign({ loop: true, loopFrom: 1, loopTo: 2, practiceMode: 'practice', hints: [], memReveal: false }, patch)); await sl(250);
      if (e) A._perf = e;
      const res = result || e.result();
      A.completeLap(A.state, res.counts ? res.counts.matched : res.matched, res.counts ? res.counts.expected : res.expected, res);
      results.push(res.counts || null);
      await PPP.runLog.log.idle();
    };
    await lap({ hands: 'left', tempo: 120 }, engine(1, 2, 'left', 120, 'practice'));
    await lap({ hands: 'right', tempo: 63 }, engine(1, 2, 'right', 63, 'practice'));
    await lap({ hands: 'both', tempo: 84, loopFrom: 3, loopTo: 5 }, engine(3, 5, 'both', 84, 'practice', true));
    A.setState({ loopFrom: 1, loopTo: 2 }); await sl(250);
    A.setMemLevel(2); await sl(250);                                    /* the section's recall level: 2 */
    await lap({ practiceMode: 'memory', hints: ['a'], hands: 'both', tempo: 84 }, engine(1, 2, 'both', 84, 'memory'));
    await lap({ practiceMode: 'memory', hints: [], memReveal: true, hands: 'both', tempo: 84 }, engine(1, 2, 'both', 84, 'memory'));
    await lap({ practiceMode: 'memory', hands: 'both', tempo: 150 }, null, follow);      /* Follow, with the memory tab open */
    await lap({ practiceMode: 'practice', hands: 'both', tempo: 150 }, null, follow);
    const log = PPP.runLog.log;
    const h = (await log.epochs()).epochs[0].hash;
    const r = await log.read(A.state.songId || 'demo', h);
    return { runs: r.runs.map(x => x.run), counts: results, scoreTempo: score.tempo };
  });
  const [l, r, w, m1, m2, f1, f2] = o.runs;
  ok('seven laps, seven runs', o.runs.length === 7, o.runs.map(x => x.src).join(','));
  ok('the hand, the tempo and the score tempo of the lap are in the run: left hand at 120 bpm, right hand at 63, the score says ' + o.scoreTempo,
    l.hd === 'l' && l.tp === 120 && l.sr === Math.round(120 / o.scoreTempo * 1000) / 1000 && r.hd === 'r' && r.tp === 63 && r.sr === Math.round(63 / o.scoreTempo * 1000) / 1000 && w.hd === 'b' && w.tp === 84 && w.sr === 1, JSON.stringify([l.hd, l.tp, l.sr, r.hd, r.tp, r.sr, w.hd, w.tp, w.sr]));
  ok('and the range of the loop, as measure indexes (bars 1-2 are 0-1, bars 3-5 are 2-4)', l.f === 0 && l.t === 1 && w.f === 2 && w.t === 4, JSON.stringify([l.f, l.t, w.f, w.t]));
  const wsum = w.W.reduce((a, x) => [a[0] + x[1], a[1] + x[2]], [0, 0]);
  ok('wrong and extra keys: the run counts them as the matcher did, and says in which measures', w.wr >= 1 && w.xt >= 1 && w.wr === o.counts[2].wrong && w.xt === o.counts[2].extra && wsum[0] === w.wr && wsum[1] === w.xt && w.W.length >= 1, JSON.stringify({ wr: w.wr, xt: w.xt, W: w.W, matcher: o.counts[2] }));
  ok('a lap with no wrong key says so (0 and an empty list)', l.wr === 0 && l.xt === 0 && l.W.length === 0 && l.hn === 0 && l.lv === 0 && l.md === 'practice', JSON.stringify([l.wr, l.xt, l.W, l.hn, l.lv]));
  ok('a recall says its hints and the level of the section when it was played (2); with the notation revealed the level is 0', m1.src === 'memory' && m1.md === 'memory' && m1.hn === 1 && m1.lv === 2 && m2.src === 'memory' && m2.lv === 0 && m2.hn === 0, JSON.stringify([m1.src, m1.md, m1.hn, m1.lv, m2.lv, m2.hn]));
  ok('a Follow lap is a follow run even with the memory tab open, and the tab does not make it a recall', f1.src === 'follow' && f1.md === 'memory' && f2.src === 'follow' && f2.md === 'practice', JSON.stringify([f1.src, f1.md, f2.src, f2.md]));
  ok('a Follow run has no tempo (null), whatever the slider says (150): a reader that skips `src` cannot take it for a run at tempo', f1.tp === null && f1.sr === null && f2.tp === null && f2.sr === null && f1.R.every(x => x[4] === null && x[5] === null), JSON.stringify([f1.tp, f1.sr, f2.tp, f2.sr]));
  ok('no page error', p.probe.errors.length === 0, p.probe.errors.join('|'));
  await p.close();
}

/* ---------------------------------------------------------------- 3c. a keyboard that nobody plays */
async function idleSection(browser) {
  console.log('\n── a loop with a keyboard attached and nothing played is not evidence ──');
  const p = await open(browser, { query: '?learner=typed', midi: true });
  await toPractice(p.page, true);
  const info = () => p.page.evaluate(async () => {
    const log = PPP.runLog.log, eps = (await log.epochs()).epochs;
    const r = eps.length ? await log.read('demo', eps[0].hash) : { runs: [] };
    return { runs: r.runs.map(x => x.run), idle: eps.length ? eps[0].idle.n : 0, sim: eps.length ? eps[0].sim.n : 0, appended: log.stats.appended, rating: !!document.querySelector('[data-run-rating]'), stats: log.stats.idle };
  });
  const five = await p.page.evaluate(async () => {
    const A = PPP.app, sl = ms => new Promise(r => setTimeout(r, ms));
    A.setState({ toggles: Object.assign({}, A.state.toggles, { follow: false }), practiceMode: 'practice', loop: true, tempo: 200, hands: 'both', hints: [] });
    A.setLoop(1, 2); await sl(300);
    const l0 = A.state.laps; A.togglePlay();
    const t0 = performance.now(); while (A.state.laps < l0 + 5 && performance.now() - t0 < 45000) await sl(100);
    const during = !!document.querySelector('[data-run-rating]');
    if (A.state.playing) A.togglePlay();
    await sl(800);
    const h = A.state.history;
    return { laps: A.state.laps - l0, hist: h.runs.slice(-5).map(x => x.source), during: during };
  });
  const a = await info();
  ok('five laps with the keyboard attached and nothing played: the page counts them (laps) and names them idle in the history', five.laps >= 5 && five.hist.length === 5 && five.hist.every(s => s === 'idle'), JSON.stringify(five));
  ok('0 rows in the log, no rating row, the epoch counts them (idle >= 5)', a.runs.length === 0 && a.appended === 0 && !a.rating && !five.during && a.idle >= 5 && a.idle === a.stats, JSON.stringify({ runs: a.runs.length, appended: a.appended, rating: a.rating, idle: a.idle, sim: a.sim }));
  const n0 = a.idle;
  const one = await p.page.evaluate(realLapInPage, { mode: 'practice', from: 1, to: 2, only: 1 });
  const b = await info();
  ok('a lap with one real note still logs: one measured run with one matched note, the rating row is there, the idle counter did not move', one.counted && b.runs.length === 1 && b.runs[0].src === 'measured' && b.runs[0].ht === 1 && b.rating && b.idle === n0, JSON.stringify({ runs: b.runs.length, ht: b.runs[0] && b.runs[0].ht, rating: b.rating, idle: b.idle + '/' + n0 }));
  const stray = await p.page.evaluate(async () => {
    const A = PPP.app, sl = ms => new Promise(r => setTimeout(r, ms));
    const l0 = A.state.laps; A.togglePlay(); await sl(250);
    const x = A._perf.expected[0];
    setTimeout(() => { window.__press(x.midi + 13); setTimeout(() => window.__release(x.midi + 13), 60); }, Math.max(0, x.tMs - performance.now()) + 5);
    const t0 = performance.now(); while (A.state.laps === l0 && performance.now() - t0 < 20000) await sl(100);
    if (A.state.playing) A.togglePlay();
    await sl(600);
    return { counted: A.state.laps > l0, src: A.state.history.runs[A.state.history.runs.length - 1].source };
  });
  const c = await info();
  ok('and so does a lap with only a stray key (it is playing, wrongly): logged as measured', stray.counted && stray.src === 'measured' && c.runs.length === 2 && c.runs[1].src === 'measured' && c.runs[1].ht === 0 && c.runs[1].xt + c.runs[1].wr >= 1, JSON.stringify({ src: stray.src, runs: c.runs.length, last: c.runs[1] && [c.runs[1].ht, c.runs[1].wr, c.runs[1].xt] }));
  ok('no page error', p.probe.errors.length === 0, p.probe.errors.join('|'));
  await p.close();
}

/* ---------------------------------------------------------------- 4b. a delete in progress */
/* G13-6: "Delete everything" freezes the page, wipes every ppp* storage and reloads; a lap that ends between the wipe and the reload must not make the log again */
async function frozenSection(browser) {
  console.log('\n── a lap that ends while the page is being wiped does not recreate the log ──');
  const p = await open(browser, { query: '?learner=typed', midi: true });
  await toPractice(p.page, true);
  await p.page.evaluate(realLapInPage, { mode: 'practice', from: 1, to: 2 });
  const names = () => p.page.evaluate(() => indexedDB.databases().then(l => l.map(d => d.name)));
  const before = await names();
  const wiped = await p.page.evaluate(async () => {
    const A = PPP.app;
    A.freezeStorage();
    const rep = await window.PPPBackup.wipe({ closeHandles: () => A.closeDataHandles() });
    return { ok: rep.ok, failed: rep.failed.length };
  });
  const mid = await names();
  await p.page.evaluate(async () => {
    const A = PPP.app, sl = ms => new Promise(r => setTimeout(r, ms));
    const e = new PPP.PerformanceEngine(A.state.score).begin({ from: 1, to: 2, hands: 'both', tempo: 84, practiceMode: 'practice', startedAt: 1000 });
    e.expected.forEach(x => e.noteOn({ midi: x.midi, t: x.tMs, type: 'on' }));
    e.advanceTo(1e9); A._perf = e;
    const res = e.result();
    for (let i = 0; i < 3; i++) { A.completeLap(A.state, res.counts.matched, res.counts.expected, res); await sl(150); }
    A.rateRun(2);
    await sl(900);
  });
  const after = await names();
  ok('the real wipe took ppp-runlog with the other databases', before.indexOf('ppp-runlog') >= 0 && mid.indexOf('ppp-runlog') < 0 && wiped.ok, JSON.stringify({ before: before, mid: mid, wiped: wiped }));
  ok('three laps and a rating after the wipe (the page is frozen until it reloads) leave no ppp-runlog behind', after.indexOf('ppp-runlog') < 0, JSON.stringify(after));
  ok('no page error', p.probe.errors.length === 0, p.probe.errors.join('|'));
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
      if (want('fields')) await fieldsSection(browser);
      if (want('idle')) await idleSection(browser);
      if (want('log')) await logSection(browser);
      if (want('frozen')) await frozenSection(browser);
      if (want('failures')) await failuresSection(browser);
      if (want('budget')) await budgetSection(browser);
      if (want('demo')) await demoSection(browser);
      if (want('demolive')) await demoLiveSection(browser);
      if (want('democonnect')) await demoConnectSection(browser);
      if (want('ui')) await uiSection(browser);
      /* G11b-3: PPP.learner 'adaptive' (tests/practice/adaptive-sections.js) */
      if (['adswitch', 'adcard', 'adseq', 'adtempo', 'adlocale', 'addemo', 'adfallback', 'adpersist', 'adbudget', 'adui'].some(want)) {
        await require('./practice/adaptive-sections').run(browser, { open, toPractice, toSettings, ok, sleep, errors, calibration, CALIB_REF }, want);
      }
    }
  } finally {
    await browser.close();
  }
  console.log('\n' + (errors.length ? errors.length + ' check(s) failed:\n  ' + errors.join('\n  ') : 'all checks passed'));
  process.exit(errors.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
