'use strict';
/* G13-8 (the independent review of PR #277): the two TensorFlow.js versions of the page - 2.8.6 for Onsets and Frames, 3.21.0 for Basic Pitch - keep their engines in two page globals, which the page
   swaps (pppOwnTf, pppUseTf). Sections that overlapped swapped them under each other and gave silently WRONG notes, or threw "Cannot read properties of undefined (reading 'backend')", and the
   page then stayed wrong. Everything that touches TensorFlow.js now runs inside pppTfLock, one section at a time. This is that, in a browser:

     the REAL Basic Pitch (vendored, offline) and an Onsets and Frames stand-in that does its work with the REAL TensorFlow.js 2.8.6 (its transcription.js is answered by a small file of this test:
     the Google checkpoint is not here, and what is under test is the page's handling of the two engines, not the model);
     sequential runs in both orders are the reference; then the loads together, the runs together, one started 300 ms or 1.5 s after the other, in both orders: every result is the reference's,
     to the note; a cancelled import lets the next one in at its next step (not when it would have finished), a cancelled request that is only waiting does not wait, and a request that gave up does
     not let the one behind it overtake the section ahead.
   Mutants (tests/load/mutants.js, T1-T7) take the lock out, or one of its parts, and this file must fail. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { boot } = require('../load/lib');

function loadPuppeteer() {
  for (const spec of ['puppeteer', process.env.PPP_PUPPETEER, 'D:/PPP/node_modules/puppeteer']) { if (!spec) continue; try { return require(spec); } catch (e) { /* next */ } }
  throw new Error('puppeteer is not installed (npm install puppeteer, or set PPP_PUPPETEER to its folder)');
}
let srv, browser;
test.before(async () => {
  srv = await boot();
  browser = await loadPuppeteer().launch({ headless: 'new', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
});
test.after(async () => { if (browser) await browser.close(); if (srv) srv.close(); });

/* ---- the stand-in for transcription.js: the real TensorFlow.js 2.8.6 (window.tf) does the work, so the engine the page puts in place is what is exercised ---- */
const FAKE_OAF = `
(function () {
  function OnsetsAndFrames(url) { this.url = url; this.w = null; }
  OnsetsAndFrames.prototype.initialize = function () {
    var self = this;
    return new Promise(function (r) { setTimeout(r, 200); }).then(function () {
      self.w = window.tf.variable(window.tf.tensor1d([1, 2, 3]));      /* a variable made on the engine, as the real model makes its weights */
      window.tf.tensor1d([1, 2, 3]).dispose();                          /* and the weights it has built from are disposed, which finds the engine through the page's globals */
    });
  };
  OnsetsAndFrames.prototype.transcribeFromAudioBuffer = function (buf) {
    var tf = window.tf, sr = buf.sampleRate, n = 4096, hop = Math.round(sr * 0.05), pitches = [];
    for (var m = 55; m <= 76; m++) pitches.push(m);
    var wait = window.__oafDelay || 300;
    return new Promise(function (r) { setTimeout(r, wait); }).then(function () {
      var x = buf.getChannelData(0), frames = Math.floor((x.length - n) / hop) + 1, notes = [];
      if (frames < 1) return { notes: [], totalTime: buf.duration };
      var data = new Float32Array(frames * n);
      for (var f = 0; f < frames; f++) data.set(x.subarray(f * hop, f * hop + n), f * n);
      var P = pitches.length;
      var mags = tf.tidy(function () {
        var t = tf.range(0, n).div(sr);
        var hz = tf.tensor1d(pitches.map(function (p) { return 440 * Math.pow(2, (p - 69) / 12); }));
        var ph = t.expandDims(1).mul(hz.expandDims(0)).mul(2 * Math.PI);
        var bank = tf.concat([ph.cos(), ph.sin()], 1);
        var prod = tf.matMul(tf.tensor2d(data, [frames, n]), bank);
        var c = prod.slice([0, 0], [frames, P]), s = prod.slice([0, P], [frames, P]);
        return c.square().add(s.square()).sqrt().div(n / 2);
      });
      return mags.data().then(function (d) {
        mags.dispose();
        var cur = null;
        function close(i) { if (cur && (i - cur.f0) * hop / sr >= 0.15) notes.push({ pitch: cur.p, startTime: cur.f0 * hop / sr, endTime: (i * hop + n) / sr, velocity: 80 }); cur = null; }
        for (var i = 0; i < frames; i++) {
          var best = -1, bv = 0.02;
          for (var j = 0; j < P; j++) if (d[i * P + j] > bv) { bv = d[i * P + j]; best = j; }
          var p = best < 0 ? null : pitches[best];
          if (cur && cur.p !== p) close(i);
          if (p !== null && !cur) cur = { p: p, f0: i };
        }
        close(frames);
        return { notes: notes, totalTime: buf.duration };
      });
    });
  };
  OnsetsAndFrames.prototype.dispose = function () { if (this.w) { this.w.dispose(); this.w = null; } };
  window.transcription = { OnsetsAndFrames: OnsetsAndFrames };
})();
`;

/* ---- a recording: C4 E4 G4 and C5 as a chord with E5 at the end (a few harmonics each, a piano-like decay), mono 16-bit WAV at 22.05 kHz; `pad` seconds of silence after it ---- */
function makeWav(pad) {
  const sr = 22050, NOTES = [{ midi: 60, at: 0.1, dur: 0.7 }, { midi: 64, at: 0.9, dur: 0.7 }, { midi: 67, at: 1.7, dur: 0.7 }, { midi: 72, at: 2.5, dur: 0.6 }];
  const n = Math.floor((3.3 + (pad || 0)) * sr);
  const f = new Float32Array(n);
  NOTES.forEach(nt => {
    const hz = 440 * Math.pow(2, (nt.midi - 69) / 12);
    const s0 = Math.floor(nt.at * sr), len = Math.floor(nt.dur * sr);
    for (let i = 0; i < len && s0 + i < n; i++) {
      const t = i / sr, env = Math.min(1, t / 0.005) * Math.exp(-t * 2.2);
      let v = 0;
      for (let h = 1; h <= 6; h++) v += Math.sin(2 * Math.PI * hz * h * t) / (h * h);
      f[s0 + i] += 0.35 * env * v;
    }
  });
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8); buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(sr, 24);
  buf.writeUInt32LE(sr * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(f[i] * 32767))), 44 + i * 2);
  return buf.toString('base64');
}
const SHORT = makeWav(0), MEDIUM = makeWav(9), LONG = makeWav(62);

/* a page: every other site refused; the Onsets and Frames code is the stand-in above */
async function open() {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  const st = { ctx, page, errors: [] };
  await page.evaluateOnNewDocument(() => { try { localStorage.setItem('ppp-guest', '1'); localStorage.setItem('ppp-locale', 'en-US'); } catch (e) { /* */ } });
  const site = 'http://127.0.0.1:' + srv.port;
  await page.setRequestInterception(true);
  page.on('request', r => {
    const u = r.url();
    if (/\/vendor\/magenta-music-1\.23\.1\/transcription\.js/.test(u)) return r.respond({ status: 200, contentType: 'text/javascript; charset=utf-8', body: FAKE_OAF }).catch(() => {});
    if (u.startsWith(site) || /^(data|blob):/.test(u)) return r.continue().catch(() => {});
    return r.abort('blockedbyclient').catch(() => {});
  });
  page.on('pageerror', e => st.errors.push(String(e && e.message || e).slice(0, 200)));
  await page.goto(site + '/Piano%20Coach%20App.dc.html', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => window.PPP && PPP.Import && PPP.Import.amtNotes && PPP.Import.pianoAmtNotes && PPP.Import.loadAmt, { timeout: 60000 });
  return st;
}
const close = st => st.ctx.close().catch(() => {});

/* one scenario, in the page; returns [{ fn, ok, sig, error, code, t0, t1 }] in the order they were started */
const drive = (page, scenario) => page.evaluate(async (scenario, SHORT, MEDIUM, LONG) => {
  const bytes = b64 => { const bin = atob(b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u.buffer; };
  const T0 = Date.now();
  const run = (fn, o) => {
    o = o || {};
    const t0 = Date.now() - T0;
    return PPP.Import[fn](bytes(o.long ? LONG : SHORT), () => {}, o.ctl).then(got => ({ fn, ok: true, sig: got.notes.map(n => [n.midi, +n.on.toFixed(2), +n.off.toFixed(2)].join(':')).join(','), n: got.notes.length, engine: got.engine, t0, t1: Date.now() - T0 }),
      e => ({ fn, ok: false, error: String(e && e.message || e).slice(0, 160), code: e && e.code, t0, t1: Date.now() - T0 }));
  };
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const seq = async list => { const o = []; for (const fn of list) o.push(await run(fn)); return o; };
  const tail = () => seq(['amtNotes', 'pianoAmtNotes']);
  let out = [];
  const OAF = 'pianoAmtNotes', BP = 'amtNotes';
  if (scenario === 'seqA') out = await seq([BP, OAF, BP, OAF]);
  else if (scenario === 'seqB') out = await seq([OAF, BP, OAF, BP]);
  else if (scenario === 'concA') {
    const t = await Promise.allSettled([PPP.Import.loadAmt(), PPP.Import.loadPianoAmt()]);
    out.push({ fn: 'loads', ok: t.every(x => x.status === 'fulfilled'), error: t.filter(x => x.status !== 'fulfilled').map(x => String(x.reason && x.reason.message || x.reason)).join('; ') });
    out = out.concat(await tail());
  } else if (scenario === 'concB') {
    out = await Promise.all([run(BP), run(OAF)]);
    out = out.concat(await tail());
  } else if (scenario === 'concC' || scenario === 'concE' || scenario === 'concD') {
    const [first, second, gap] = scenario === 'concD' ? [BP, OAF, 300] : scenario === 'concC' ? [OAF, BP, 300] : [OAF, BP, 1500];
    const p1 = run(first);
    await wait(gap);
    const p2 = run(second);
    out = [await p1, await p2].concat(await tail());
  } else if (scenario === 'cancelHolder') {
    /* an O&F import of a 65 s recording (three chunks, 0.7 s each) is cancelled during its first chunk; a Basic Pitch import is asked for just after */
    window.__oafDelay = 700;
    const ctl = { cancelled: false };
    const p1 = run(OAF, { long: true, ctl });
    await wait(450);
    ctl.cancelled = true;
    const tCancel = Date.now() - T0;
    await wait(60);
    const p2 = run(BP);
    const r1 = await p1, r2 = await p2;
    out = [r1, r2, { fn: 'times', tCancel }];
  } else if (scenario === 'cancelBP') {
    /* a Basic Pitch import of 12 s is cancelled once it reports 20 %: it stops between two batches of the model, and a normal run works after it */
    const ctl = { cancelled: false };
    let last = 0;
    const r = await PPP.Import.amtNotes(bytes(MEDIUM), p => { last = p; if (p > 0.2) ctl.cancelled = true; }, ctl).then(() => ({ ok: true }), e => ({ ok: false, code: e && e.code }));
    out = [Object.assign({ fn: 'cancelled', last }, r), await run(BP)];
  } else if (scenario === 'cancelWaiter') {
    /* Basic Pitch is running; an O&F import is only waiting for it and is cancelled; a third import is asked for after that and must still wait for Basic Pitch */
    const p1 = run(BP);
    await wait(200);
    const ctl = { cancelled: false };
    const p2 = run(OAF, { ctl });
    await wait(150);
    ctl.cancelled = true;
    const r2 = await p2;
    const tGone = Date.now() - T0;
    const p3 = run(OAF);
    const r1 = await p1, r3 = await p3;
    out = [r1, r2, r3, { fn: 'times', tGone }];
  }
  out.push({ fn: 'fallbacks', fallbacks: PPP.libFallbacks });
  return out;
}, scenario, SHORT, MEDIUM, LONG);

const sigs = rs => rs.filter(r => r.sig).reduce((m, r) => { (m[r.fn] = m[r.fn] || new Set()).add(r.sig); return m; }, {});
let REF = null;
async function reference() {
  if (REF) return REF;
  const st = await open();
  try {
    const a = await drive(st.page, 'seqA');
    assert.ok(a.filter(r => r.fn !== 'fallbacks').every(r => r.ok), 'the sequential runs work: ' + JSON.stringify(a));
    const s = sigs(a);
    assert.equal(s.amtNotes.size, 1, 'Basic Pitch gives the same notes every time it runs');
    assert.equal(s.pianoAmtNotes.size, 1, 'the stand-in gives the same notes every time it runs');
    REF = { bp: Array.from(s.amtNotes)[0], oaf: Array.from(s.pianoAmtNotes)[0], bpN: a.find(r => r.fn === 'amtNotes').n, oafN: a.find(r => r.fn === 'pianoAmtNotes').n };
    assert.ok(REF.oafN >= 3, 'the stand-in hears the notes of the recording: ' + REF.oaf);
    assert.ok(REF.bpN >= 3, 'Basic Pitch hears the notes of the recording: ' + REF.bp);
    assert.notEqual(REF.bp, REF.oaf, 'the two models give different notes, so that a result of the wrong one is seen');
    const b = await drive(st.page, 'seqB');
    assert.ok(b.filter(r => r.fn !== 'fallbacks').every(r => r.ok), 'in the other order too: ' + JSON.stringify(b));
    return REF;
  } finally { await close(st); }
}
const expectSame = (rs, ref) => {
  rs.filter(r => r.fn === 'amtNotes' || r.fn === 'pianoAmtNotes').forEach(r => {
    assert.equal(r.ok, true, r.fn + ' did not fail: ' + JSON.stringify(r));
    assert.equal(r.sig, r.fn === 'amtNotes' ? ref.bp : ref.oaf, r.fn + ' heard exactly the notes it hears when it runs alone');
  });
};

test('sequential: Basic Pitch and Onsets and Frames, in both orders, repeated, are the same notes each time (the reference)', async () => {
  await reference();
});

for (const [name, what] of [
  ['concA', 'both loads asked for together, then both runs'],
  ['concB', 'both runs asked for together'],
  ['concC', 'Onsets and Frames, Basic Pitch 300 ms later'],
  ['concD', 'Basic Pitch, Onsets and Frames 300 ms later'],
  ['concE', 'Onsets and Frames, Basic Pitch 1.5 s later']
]) {
  test('overlapping imports (' + what + ') give the notes each gives alone, and the page stays right afterwards', async () => {
    const ref = await reference();
    const st = await open();
    try {
      const rs = await drive(st.page, name);
      if (name === 'concA') assert.equal(rs[0].ok, true, 'the loads: ' + rs[0].error);
      expectSame(rs, ref);
      assert.deepEqual(rs.find(r => r.fn === 'fallbacks').fallbacks, {});
      assert.deepEqual(st.errors, [], 'no page error');
    } finally { await close(st); }
  });
}

test('a cancelled import lets the next one in at its next step, not when it would have finished; and does not go on to the other model', async () => {
  const ref = await reference();
  const st = await open();
  try {
    const rs = await drive(st.page, 'cancelHolder');
    const [r1, r2, times] = rs;
    assert.equal(r1.ok, false, 'the cancelled import ended: ' + JSON.stringify(r1));
    assert.equal(r1.code, 'cancelled');
    /* it would have run 3 chunks of 0.7 s after its load (about 2.5 s in all); cancelled at 0.45 s it stops when the chunk it is in is done */
    /* a chunk takes a second or so here and several on a slow runner: what is guarded is that it did not run on for the minutes the other chunks would have taken */
    assert.ok(r1.t1 < times.tCancel + 30000, 'it stopped within a chunk of the cancel: ' + (r1.t1 - times.tCancel) + ' ms');
    assert.ok(r2.t1 > r1.t1 - 50, 'the next import came after the cancelled one let go, not beside it: ' + r2.t1 + ' vs ' + r1.t1);
    expectSame([r2], ref);
  } finally { await close(st); }
});

test('a cancelled Basic Pitch import stops between two batches of the model, and the next run is right', async () => {
  const ref = await reference();
  const st = await open();
  try {
    const [c, after] = await drive(st.page, 'cancelBP');
    assert.equal(c.ok, false, 'it did not run to the end: ' + JSON.stringify(c));
    assert.equal(c.code, 'cancelled');
    assert.ok(c.last > 0.2 && c.last < 0.95, 'it stopped part-way: ' + c.last);
    expectSame([after], ref);
  } finally { await close(st); }
});

test('a request that is only waiting, and is cancelled, does not wait; and the one asked for after it still waits for the section ahead', async () => {
  const ref = await reference();
  const st = await open();
  try {
    const rs = await drive(st.page, 'cancelWaiter');
    const [r1, r2, r3, times] = rs;
    assert.equal(r2.ok, false);
    assert.equal(r2.code, 'cancelled');
    assert.ok(r2.t1 < r1.t1, 'the waiting request was cancelled while the running one went on: ' + r2.t1 + ' < ' + r1.t1);
    /* (timers are late while Basic Pitch is computing: the main thread is busy; what matters is that the lock was not waited for) */
    assert.ok(times.tGone < r1.t1, 'gone before the section ahead was done: ' + times.tGone + ' < ' + r1.t1);
    expectSame([r1, r3], ref);
    assert.ok(r3.t1 > r1.t1 - 50, 'the third import did not overtake Basic Pitch: ' + r3.t1 + ' vs ' + r1.t1);
  } finally { await close(st); }
});
