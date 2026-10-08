/* G11a-0: the PRACTICE PERFORMANCE PROBE. The measurements of G11 section 1 (E5-E7), made repeatable and held to a committed baseline
   (tests/practice/baselines/perf.json), so a slower matcher, plan builder or practice screen shows up as a red job and not as a teacher's complaint.

   One probe run, on the 1,776-note Sonatina (catalog/method/sonatina/020.mxl, the piece G06 timed), at CPU 1x and 4x (Chrome's throttle):
     unit     MusicXML import, toScore+finalize, legacy.link, legacy.agree, PianoScore.build (cold, the first call in a fresh page - what a person
              waits for - and the mean of 20), time.unroll, time.tempoMap, PerformanceEngine.begin (cold, and the mean of 60)
     matcher  noteOn + advanceTo per press (mean, p95, max of 2000 presses), a wrong key (mean, p95 of 500), result() (mean of 20)
     live     the app's own MIDI handler through a live clock run with a fake keyboard (p95, max), press -> painted frame (two requestAnimationFrames;
              median, p95, max over the presses with a time of their own), the long tasks of 8 s of play, the long tasks of entering Practice
     counters strikes, expected notes, presses, paint samples (exact: a probe that measured nothing must not pass)
   A machine's speed is taken out first: a fixed CPU workload (calib) is timed in the same page under the same throttle, and every time is
   compared as `time / max(1, calib(now) / calib(baseline))` (every limit grows with a slower machine, up to 3x; none shrinks for a faster one:
   a frame is bound by the compositor as much as by the CPU). A metric passes when that is within 20 % of the baseline (plus a small floor, because
   performance.now() has a resolution of 0.1 ms: a p95 of 0.1 ms is one tick; the floor is 4x as large under the 4x throttle). Slower than that is RED; faster than 20 % under the baseline is
   reported, not failed (refresh the baseline when it is a real gain). Noise only adds time, so a metric counts at its BEST attempt, in the
   baseline (3 probes recorded, 5 for the runner) and in `check` (up to 3 probes, it stops at the first clean one). The baseline is kept per
   profile (local, ci), because a shared runner and a developer's machine are not the same kind of machine; the profile is `ci` when
   GITHUB_ACTIONS is set.

     node tests/practice/perf.js check [--attempts 3] [--profile local|ci] [--url URL]
     node tests/practice/perf.js record [--attempts 3] [--profile local|ci]     merge this machine's best-of-N into baselines/perf.json
     node tests/practice/perf.js show                                           one probe run, printed, nothing compared
   The design document's own measurements (E5-E7, at 3567e27) are kept beside the baseline as `doc`; `record` prints whether each is
   reproduced within 20 %. */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const L = require('./lib');

const BASELINE = path.join(__dirname, 'baselines', 'perf.json');
const PIECE = 'catalog/method/sonatina/020.mxl';
const TOL = 0.2;

/* key suffix -> { floor (ms or count slack), doc: [1x, 4x] from G11 section 1, kind, info4 }. `info4`: a single short task (or the worst of
   many) under the 4x throttle is slowed by 1x-5x depending on where in the throttle's duty cycle it falls, so at 4x the number is reported
   against the baseline but cannot turn the job red; the means of batches (unit.buildMean, unit.beginMean, the matcher means) hold the 4x line.
   `cold`: a single first call in a fresh page. Its best of 5 baseline probes is luck (the baseline's own probes spread 1.5-2x), so it is held to
   the baseline's SLOWEST probe (+20 % and the floor); the means hold the tight line. The floors of the means are small on purpose: a mean over
   many calls does not have the timer's 0.1 ms quantum, and a floor larger than the value would hide a planted 2x slowdown (perf-selftest.js). */
const SPECS = {
  'unit.import': { floor: 6, info4: true, cold: true, doc: [76, 353] },
  'unit.toScore': { floor: 2, info4: true, cold: true, doc: [7, 44] },
  'unit.link': { floor: 3, info4: true, cold: true, doc: [15, 81] },
  'unit.agree': { floor: 3, info4: true, cold: true, doc: [19, 99] },
  'unit.build': { floor: 2.5, info4: true, cold: true, doc: [7, 35] },
  'unit.buildMean': { floor: 0.5, doc: [null, null] },
  'unit.unroll': { floor: 0.6, info4: true, cold: true, doc: [0.1, 0.2] },
  'unit.tempoMap': { floor: 0.6, info4: true, cold: true, doc: [0.1, 1.0] },
  'unit.begin': { floor: 2.5, info4: true, cold: true, doc: [8, 30] },
  'unit.beginMean': { floor: 0.08, doc: [null, null] },
  'matcher.noteOnMean': { floor: 0.003, doc: [null, null] },
  'matcher.noteOnP95': { floor: 0.15, doc: [0.1, 0.2] },
  'matcher.noteOnMax': { floor: 0.8, info4: true, doc: [0.3, 1.7] },
  'matcher.wrongMean': { floor: 0.005, doc: [null, null] },
  'matcher.wrongP95': { floor: 0.15, doc: [0.2, null] },
  'matcher.resultMean': { floor: 0.05, doc: [null, null] },
  'live.handlerP95': { floor: 0.3, doc: [0.1, 0.4] },
  'live.handlerMax': { floor: 1.5, info4: true, doc: [null, null] },
  'live.paintMed': { floor: 6, doc: [null, 31] },
  'live.paintP95': { floor: 10, doc: [null, 55] },
  'live.paintMax': { floor: 16, doc: [null, 64] },
  /* long tasks: counts, with the slack they are allowed over the baseline (the entry's belong to the engraver, G4 B5) */
  'long.play': { kind: 'count', slack: [0, 1], doc: [0, 1] },
  'long.entry': { kind: 'count', slack: [1, 1], doc: [2, 3] }
};
/* counters that must come out exactly the same, and counters that depend on when the clock run starts (how many of the piece's onsets fall into
   the 7.5 s and 10 s windows): those need only be 80 % of the baseline's, which is what "the probe measured something" asks */
const EXACT = ['strikes', 'expected', 'measures'];
const AT_LEAST = ['presses', 'paintSamples'];

/* ---------------- in the page ---------------- */
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
  window.__lt = [];
  try { new PerformanceObserver(l => l.getEntries().forEach(e => window.__lt.push({ t: e.startTime, d: e.duration }))).observe({ type: 'longtask', buffered: true }); } catch (e) { /* no long task API */ }
}

/* a fixed CPU workload of about 45 ms (8 rounds of sort, hash-like loop): the median of 5 runs, in ms. It is measured BEFORE the CPU throttle is set:
   Chrome's throttle slows the main thread in a duty cycle whose period is longer than a short task, so a 5 ms task sees anything from 1x to 5x, and a
   calibration taken under it would measure the throttle's phase and not the machine. The machine's speed is what is taken out of the times. */
function calibInPage() {
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
}

async function unitsInPage(file) {
  const SG = window.PPPScoreGraph, PPP = window.PPP;
  const T = f => { const t = performance.now(); const r = f(); return [r, performance.now() - t]; };
  const med = a => { const s = a.slice().sort((x, y) => x - y); return s[(s.length - 1) >> 1]; };
  const q = (a, p) => { const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
  const res = await fetch('/' + file);
  const xml = await PPP.readMxl(await res.arrayBuffer());
  const [imp, tImport] = T(() => SG.musicxml.import(xml, { scoreId: 'f-perf', sourceName: file }));
  if (!imp.ok) throw new Error('import refused: ' + imp.code);
  const g = imp.graph;
  const [score, tToScore] = T(() => PPP.Score.finalize(SG.legacy.toScore(g, { name: file })));
  const [link, tLink] = T(() => SG.legacy.link(score, g));
  const [agree, tAgree] = T(() => SG.legacy.agree(score, g));
  const first = PPP.Score.first(score), last = PPP.Score.last(score);
  const [plan, tBuild] = T(() => PPP.PianoScore.build(score, first, last));
  const [, tUnroll] = T(() => SG.time.unroll(g));
  const [, tTempo] = T(() => SG.time.tempoMap(g, { defaultQpm: 84 }));
  const beginRun = { from: first, to: last, hands: 'both', tempo: score.tempo || 84, startedAt: 0 };
  const eng = new PPP.PerformanceEngine(score);
  const [, tBegin] = T(() => eng.begin(beginRun));
  /* batches: the mean of many calls. A single task shorter than the throttle's duty cycle is slowed by anything from 1x to 5x, depending on
     where in the cycle it falls, so the single shots above are the cold first calls (what a person waits for) and the numbers a check can hold
     are these means */
  const batch = (n, f) => { const t = performance.now(); for (let i = 0; i < n; i++) f(); return (performance.now() - t) / n; };
  const buildMean = batch(20, () => PPP.PianoScore.build(score, first, last));
  const beginMean = batch(60, () => new PPP.PerformanceEngine(score).begin(beginRun));
  const exp = eng.expected.slice();
  const n = Math.min(400, exp.length), lat = [], wrong = [];
  for (let round = 0; round < 5; round++) {
    const e = round === 0 ? eng : new PPP.PerformanceEngine(score).begin(beginRun);
    for (let i = 0; i < n; i++) {
      const x = exp[Math.floor(i * exp.length / n)];
      const t = performance.now();
      e.noteOn({ midi: x.midi, t: x.tMs + 20, type: 'on' });
      e.advanceTo(x.tMs);
      lat.push(performance.now() - t);
    }
    const e2 = new PPP.PerformanceEngine(score).begin(beginRun);
    for (let i = 0; i < 100; i++) {
      const t = performance.now();
      e2.noteOn({ midi: 20, t: e2.expected[Math.floor(i * e2.expected.length / 100)].tMs, type: 'on' });
      wrong.push(performance.now() - t);
    }
  }
  const mean = a => a.reduce((s, v) => s + v, 0) / a.length;
  const resultMean = batch(20, () => eng.result());
  return {
    exact: { strikes: plan.strikes.length, expected: exp.length, measures: score.measures.length, linkOk: link.ok, agreeOk: agree.ok },
    v: {
      'unit.import': tImport, 'unit.toScore': tToScore, 'unit.link': tLink, 'unit.agree': tAgree, 'unit.build': tBuild, 'unit.buildMean': buildMean,
      'unit.unroll': tUnroll, 'unit.tempoMap': tTempo, 'unit.begin': tBegin, 'unit.beginMean': beginMean,
      'matcher.noteOnMean': mean(lat), 'matcher.noteOnP95': q(lat, 0.95), 'matcher.noteOnMax': Math.max.apply(null, lat),
      'matcher.wrongMean': mean(wrong), 'matcher.wrongP95': q(wrong, 0.95), 'matcher.resultMean': resultMean
    }
  };
}

/* Practice entry, then two live clock runs with a fake keyboard that presses every note due. The first (8.5 s) is G11 section 1's "live play":
   the app's MIDI handler and the long tasks. The second (10.5 s, after the entry has long been idle, with only the first note of each onset
   pressed) is its press-to-paint run: from the key press to the second animation frame after it. */
async function liveInPage(file) {
  const PPP = window.PPP, app = PPP.app;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const at = (a, p) => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : null; };
  const res = await fetch('/' + file);
  const sc = PPP.scoreFromXml(await PPP.readMxl(await res.arrayBuffer()), file.split('/').pop());
  window.__lt = [];
  const t0 = performance.now();
  app.adoptScore(sc);
  const nav = [...document.querySelectorAll('aside nav button')].find(x => /^Practice/.test((x.innerText || '').trim()));
  if (nav) nav.click();
  await sleep(4000);
  const entry = window.__lt.filter(e => e.t >= t0 - 5).map(e => Math.round(e.d));
  const demo = [...document.querySelectorAll('main button, main span')].find(x => /Demo Input/.test((x.innerText || '').trim()));
  if (demo) demo.click();
  await sleep(1500);
  app.setState({ toggles: Object.assign({}, app.state.toggles, { follow: false }), loop: false, practiceMode: 'practice' });
  await sleep(300);

  /* 1. live play: every due note pressed, the handler timed */
  const handler = [];
  const orig = app.onMidiEvent.bind(app);
  app.onMidiEvent = ev => { const t = performance.now(); orig(ev); handler.push(performance.now() - t); };
  window.__lt = [];
  const tPlay = performance.now();
  app.togglePlay();
  await sleep(600);
  let perf = app._perf;
  const live = !!(perf && perf.run);
  let pressed = 0;
  if (live) {
    const now = performance.now();
    perf.expected.filter(x => x.tMs > now && x.tMs < now + 8000).forEach(x => {
      pressed++;
      setTimeout(() => { window.__press(x.midi); setTimeout(() => window.__release(x.midi), 120); }, x.tMs - now);
    });
  }
  await sleep(8500);
  const plays = window.__lt.filter(e => e.t >= tPlay).map(e => Math.round(e.d));
  app.togglePlay();
  await sleep(500);
  app.onMidiEvent = orig;

  /* 2. press to paint: the first note of each onset, two animation frames after the press */
  const paint = [];
  app.togglePlay();
  await sleep(800);
  perf = app._perf;
  if (perf && perf.run) {
    const now = performance.now();
    const seen = new Set();
    perf.expected.filter(x => x.tMs > now + 200 && x.tMs < now + 10000).forEach(x => {
      if (seen.has(Math.round(x.tMs))) return;
      seen.add(Math.round(x.tMs));
      setTimeout(() => {
        const t = performance.now();
        window.__press(x.midi);
        requestAnimationFrame(() => requestAnimationFrame(() => paint.push(performance.now() - t)));
        setTimeout(() => window.__release(x.midi), 100);
      }, x.tMs - now);
    });
  }
  await sleep(10500);
  app.togglePlay();
  await sleep(200);
  return {
    live, presses: pressed, paintSamples: paint.length, events: handler.length,
    v: {
      'live.handlerP95': at(handler, 0.95), 'live.handlerMax': handler.length ? Math.max.apply(null, handler) : null,
      'live.paintMed': at(paint, 0.5), 'live.paintP95': at(paint, 0.95), 'live.paintMax': paint.length ? Math.max.apply(null, paint) : null,
      'long.play': plays.length, 'long.entry': entry.length
    },
    longPlay: plays, longEntry: entry
  };
}

/* ---------------- one probe run ---------------- */
async function probeOnce(url) {
  const out = { rate: {} };
  for (const rate of [1, 4]) {
    const app = await L.openApp(url, { fakeMidi: installFakeMidi });
    try {
      await L.sleep(2500);
      const calib = await app.page.evaluate(calibInPage);
      /* the throttle is verified, not trusted: the same workload is timed under it, and it must take about 4x as long (Chrome's throttle
         has been seen not to take hold) - up to three tries, and an attempt whose throttle is still wrong is not used for the 4x numbers */
      const throttle = { before: 1, after: 1, tries: 0 };
      let cdp = null;
      if (rate !== 1) {
        cdp = await app.page.target().createCDPSession();
        for (let tries = 1; tries <= 3; tries++) {
          await cdp.send('Emulation.setCPUThrottlingRate', { rate: rate });
          throttle.before = (await app.page.evaluate(calibInPage)) / calib;
          throttle.tries = tries;
          if (throttle.before >= 3 && throttle.before <= 6) break;
          await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
          await L.sleep(500);
        }
      }
      const u = await app.page.evaluate(unitsInPage, PIECE);
      const l = await app.page.evaluate(liveInPage, PIECE);
      if (rate !== 1) throttle.after = (await app.page.evaluate(calibInPage)) / calib;
      throttle.valid = rate === 1 || (throttle.before >= 3 && throttle.before <= 6 && throttle.after >= 3 && throttle.after <= 6);
      out.rate[rate] = { calib: calib, throttle: throttle, exact: Object.assign({}, u.exact, { presses: l.presses, paintSamples: l.paintSamples, events: l.events, live: l.live }),
        v: Object.assign({}, u.v, l.v), longPlay: l.longPlay, longEntry: l.longEntry, problems: app.problems.slice(0, 3) };
    } finally { await app.close(); }
  }
  return out;
}

/* flat view: "r1.unit.build" -> value (ms, or a count) */
function flatten(run) {
  const f = { calib: {}, v: {}, exact: {}, long: {}, throttle: {} };
  [1, 4].forEach(r => {
    const x = run.rate[r];
    f.calib['r' + r] = x.calib;
    f.throttle['r' + r] = x.throttle;
    Object.keys(x.v).forEach(k => { f.v['r' + r + '.' + k] = x.v[k]; });
    Object.keys(x.exact).forEach(k => { f.exact['r' + r + '.' + k] = x.exact[k]; });
    f.long['r' + r + '.play'] = x.longPlay;
    f.long['r' + r + '.entry'] = x.longEntry;
  });
  return f;
}
const median = a => { const s = a.slice().sort((x, y) => x - y); return s[(s.length - 1) >> 1]; };
const best = a => Math.min.apply(null, a);
const specOf = key => SPECS[key.replace(/^r[14]\./, '')];
const rateOf = key => (key.startsWith('r4.') ? 4 : 1);
const round = x => (x == null ? null : Math.abs(x) >= 10 ? Math.round(x * 10) / 10 : Math.round(x * 1000) / 1000);

function machine() {
  const cpus = os.cpus();
  return { cpu: cpus.length ? cpus[0].model.trim() : '?', cores: cpus.length, platform: process.platform, node: process.version };
}
const profileName = () => (process.env.PROFILE_OVERRIDE || (process.env.GITHUB_ACTIONS ? 'ci' : 'local'));
function arg(name, dflt) { const i = process.argv.indexOf(name); return i < 0 ? dflt : process.argv[i + 1]; }

async function runAttempts(url, n) {
  const runs = [];
  for (let i = 0; i < n; i++) {
    const t0 = Date.now();
    const run = flatten(await probeOnce(url));
    runs.push(run);
    console.log('  probe ' + (i + 1) + '/' + n + ': ' + ((Date.now() - t0) / 1000).toFixed(0) + ' s, calib ' + round(run.calib.r1) + ' / ' + round(run.calib.r4) + ' ms, 4x throttle measured ' + round(run.throttle.r4.before) + ' then ' + round(run.throttle.r4.after) + (run.throttle.r4.valid ? '' : ' NOT VALID') + ', live ' + run.exact['r1.live'] + '/' + run.exact['r4.live']);
  }
  return runs;
}

/* the baseline of one profile from several runs: the median of every metric, its spread, the median calib */
function summarise(runs) {
  const keys = Object.keys(runs[0].v);
  if (!runs.some(x => x.throttle.r4.valid)) throw new Error('the CPU throttle never took hold in ' + runs.length + ' probes (' + runs.map(x => x.throttle.r4.before.toFixed(1) + '/' + x.throttle.r4.after.toFixed(1)).join(', ') + '): nothing recorded');
  const b = { machine: machine(), calib: {}, metrics: {}, exact: runs[0].exact, long: {} };
  ['r1', 'r4'].forEach(r => { b.calib[r] = round(median(runs.map(x => x.calib[r]))); });   // the machine's speed: its typical, not its best
  keys.forEach(k => {
    const vals = runs.filter(x => rateOf(k) === 1 || x.throttle.r4.valid).map(x => x.v[k]).filter(v => v != null);
    const spec = specOf(k);
    /* the BEST attempt: noise only ever adds time, and `check` takes the best of its attempts too */
    const base = vals.length ? best(vals) : null;
    b.metrics[k] = { v: round(base), spread: vals.length ? [round(Math.min.apply(null, vals)), round(Math.max.apply(null, vals))] : null };
    if (spec && spec.kind === 'count') b.metrics[k].v = base;
  });
  Object.keys(runs[0].long).forEach(k => { b.long[k] = runs.map(x => x.long[k]); });
  b.throttle = { r4: runs.map(x => [round(x.throttle.r4.before), round(x.throttle.r4.after)]) };
  return b;
}

/* how many times slower this probe's machine is than the baseline's: the calibration workload timed in the two pages (unthrottled), the median of
   the two (their mean); 1 when it is as fast or faster; at most 3 (a machine slower than that cannot be measured with, and goes red) */
const calibOf = c => (c.r1 + c.r4) / 2;
const SLOWEST = 3;
function machineScale(base, run) { return Math.min(SLOWEST, Math.max(1, calibOf(run.calib) / calibOf(base.calib))); }

function compareRuns(base, runs) {
  const rows = [];
  let red = 0;
  const usable = rate => runs.filter(x => rate === 1 || x.throttle.r4.valid);
  if (!usable(4).length) {
    red++;
    rows.push({ k: 'r4.throttle', base: '~4x', now: runs.map(x => x.throttle.r4.before.toFixed(1) + '/' + x.throttle.r4.after.toFixed(1)).join(' '), status: 'RED', note: 'the CPU throttle did not take hold (the same workload must take 3-6x as long under it): no 4x number can be trusted' });
  }
  Object.keys(base.metrics).forEach(k => {
    const spec = specOf(k), b = base.metrics[k], rate = rateOf(k);
    if (b.v == null || !usable(rate).length) return;
    const vals = usable(rate).map(x => x.v[k]).filter(v => v != null);
    if (!vals.length) { rows.push({ k, status: 'RED', note: 'not measured' }); red++; return; }
    if (spec.kind === 'count') {
      const best = Math.min.apply(null, vals);
      const limit = b.v + spec.slack[rate === 1 ? 0 : 1];
      const bad = best > limit;
      if (bad) red++;
      rows.push({ k, base: b.v, now: best, limit, status: bad ? 'RED' : 'ok', note: bad ? 'more long tasks than the baseline allows' : '' });
      return;
    }
    /* what the machine is worth: every limit grows with how much slower than the baseline's machine this probe's machine is (the calibration
       workload, the two pages' median), and none shrinks when it is faster; the +20 % band is on top */
    const norms = usable(rate).filter(x => x.v[k] != null).map(x => x.v[k] / machineScale(base, x));
    const best = Math.min.apply(null, norms);
    /* the floor is for a 1x machine; under the 4x throttle every task, and the jitter of the throttle's duty cycle, is 4x as long */
    const floor = spec.floor * (rate === 4 ? 4 : 1);
    const ref = spec.cold && b.spread ? Math.max(b.v, b.spread[1]) : b.v;       // a cold single shot: the baseline's slowest probe, not its luckiest
    const limit = ref * (1 + TOL) + floor;
    const low = b.v * (1 - TOL) - floor;
    const bad = best > limit;
    const info = !!spec.info4 && rate === 4;
    if (bad && !info) red++;
    rows.push({ k, base: b.v, now: round(best), limit: round(limit), status: bad ? (info ? 'info' : 'RED') : (best < low && !info) ? 'faster' : 'ok',
      note: bad ? (info ? 'over the baseline; a single short task under the throttle is not held (info)' : 'slower than the baseline by more than 20 %') : (best < low && !info) ? 'faster than the baseline by more than 20 %: refresh it if this is a real gain' : '' });
  });
  EXACT.forEach(e => ['r1', 'r4'].forEach(r => {
    const k = r + '.' + e;
    const got = runs.map(x => x.exact[k]);
    const bad = got.some(v => v !== base.exact[k]);
    if (bad) red++;
    rows.push({ k, base: base.exact[k], now: got[got.length - 1], status: bad ? 'RED' : 'ok', note: bad ? 'a counter differs: the probe did not measure what it did' : '' });
  }));
  AT_LEAST.forEach(e => ['r1', 'r4'].forEach(r => {
    const k = r + '.' + e;
    const got = Math.max.apply(null, runs.map(x => x.exact[k]));
    const bad = !(got >= 0.8 * base.exact[k]);
    if (bad) red++;
    rows.push({ k, base: base.exact[k], now: got, status: bad ? 'RED' : 'ok', note: bad ? 'far fewer presses than the baseline: the probe did not measure what it did' : '' });
  }));
  ['r1', 'r4'].forEach(r => {
    const bad = runs.some(x => !x.exact[r + '.live']);
    if (bad) { red++; rows.push({ k: r + '.live', base: true, now: false, status: 'RED', note: 'the keyboard never started a run' }); }
  });
  return { rows, red };
}

function printRows(rows, onlyBad) {
  rows.filter(r => !onlyBad || r.status !== 'ok').forEach(r => {
    console.log('  ' + r.status.padEnd(7) + r.k.padEnd(26) + ('base ' + r.base).padEnd(16) + ('now ' + r.now).padEnd(14) + (r.limit != null ? 'limit ' + r.limit : '') + (r.note ? '  ' + r.note : ''));
  });
}

async function main() {
  const cmd = process.argv[2];
  const attempts = +arg('--attempts', 3);
  if (arg('--profile')) process.env.PROFILE_OVERRIDE = arg('--profile');
  let srv = null, url = arg('--url');
  if (!url) { srv = await L.serve(); url = srv.url; }
  try {
    if (cmd === 'show') {
      const runs = await runAttempts(url, 1);
      console.log(JSON.stringify(runs[0], null, 1));
      return;
    }
    if (cmd === 'record') {
      const runs = await runAttempts(url, attempts);
      const prof = summarise(runs);
      const file = fs.existsSync(BASELINE) ? JSON.parse(fs.readFileSync(BASELINE, 'utf8')) : { schema: 1, piece: PIECE, tolerance: TOL, profiles: {}, doc: {} };
      file.profiles[profileName()] = prof;
      file.doc = {};
      Object.keys(SPECS).forEach(k => { file.doc[k] = { '1x': SPECS[k].doc[0], '4x': SPECS[k].doc[1] }; });
      fs.mkdirSync(path.dirname(BASELINE), { recursive: true });
      fs.writeFileSync(BASELINE, JSON.stringify(file, null, 1) + '\n');
      console.log('recorded profile "' + profileName() + '" (' + attempts + ' probes, best of each metric) -> ' + path.relative(L.ROOT, BASELINE));
      console.log('does it reproduce the design document (E5-E7, +-20 % plus the metric floor)?');
      let within = 0, total = 0;
      Object.keys(prof.metrics).forEach(k => {
        const spec = specOf(k), rate = rateOf(k), d = spec.doc[rate === 1 ? 0 : 1], v = prof.metrics[k].v;
        if (d == null) return;
        total++;
        const slack = spec.kind === 'count' ? (spec.slack[rate === 1 ? 0 : 1]) : spec.floor;
        const ok = Math.abs(v - d) <= d * TOL + slack;
        if (ok) within++;
        console.log('  ' + (ok ? 'ok     ' : 'OUTSIDE') + ' ' + k.padEnd(24) + 'doc ' + String(d).padEnd(7) + 'measured ' + v);
      });
      console.log(within + ' of ' + total + ' within 20 %');
      return;
    }
    if (cmd === 'check') {
      const file = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
      const base = file.profiles[profileName()];
      if (!base) throw new Error('no baseline for profile "' + profileName() + '" in baselines/perf.json (run `record` on this kind of machine)');
      const runs = [];
      let result = null;
      for (let i = 0; i < attempts; i++) {
        const t0 = Date.now();
        runs.push(flatten(await probeOnce(url)));
        result = compareRuns(base, runs);
        const last = runs[runs.length - 1];
        console.log('  probe ' + (i + 1) + '/' + attempts + ': ' + ((Date.now() - t0) / 1000).toFixed(0) + ' s, calib ' + round(last.calib.r1) + ' / ' + round(last.calib.r4) + ' ms (baseline ' + base.calib.r1 + ' / ' + base.calib.r4 + '), machine x' + machineScale(base, last).toFixed(2) + ', 4x throttle measured ' + round(last.throttle.r4.before) + ' then ' + round(last.throttle.r4.after) + (last.throttle.r4.valid ? '' : ' NOT VALID') + ', ' + (result.red ? result.red + ' metric(s) over' : 'all within'));
        if (!result.red) break;
      }
      console.log('perf probe vs profile "' + profileName() + '": ' + result.rows.length + ' metrics, best of ' + runs.length + ' probe(s)');
      printRows(result.rows, !process.env.PERF_VERBOSE);
      if (result.rows.some(r => r.status === 'faster')) console.log('  (faster than the baseline is not a failure)');
      if (result.red) { console.log(result.red + ' RED'); process.exit(1); }
      console.log('perf probe within the baseline');
      return;
    }
    console.log('usage: node tests/practice/perf.js check|record|show [--attempts N] [--profile local|ci]');
    process.exit(2);
  } finally {
    if (srv) await srv.close();
  }
}

if (require.main === module) main().catch(e => { console.error(e); process.exit(2); });
module.exports = { probeOnce, flatten, summarise, compareRuns, machineScale, specOf, rateOf, SPECS, BASELINE, TOL };
