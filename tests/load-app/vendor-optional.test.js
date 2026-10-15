'use strict';
/* G13-8: the optional libraries - pdf.js, TensorFlow.js, Magenta.js, Basic Pitch - come from PPP itself (docs/GOALS/G13_PRODUCTIZATION.md, G13-8).

   Browser test: it starts this tree's server.js on a free port (tests/load/lib.js) and drives it with puppeteer. Every host but the site is refused, as a CDN
   that is down would be, and these are asked of the page:
     1. PDF import: a (generated, one-page, vector) PDF is read and notated with pdf.js and its worker coming from vendor/, by content hash, immutable;
        no request goes to jsDelivr, unpkg, esm.sh or cdnjs.
     2. the Onsets and Frames model starts - TensorFlow.js 2.8.6 and transcription.js are PPP's - and the one thing it cannot do offline, fetch its 60 MB
        checkpoint from Google, ends in the clear "needs an internet connection" error (G13 U8), not in "Failed to fetch".
     3. Basic Pitch works with no network at all: the code, TensorFlow.js 3.21.0 and the model are PPP's (an import map, no bundler).
     4. a whole recording with the checkpoint unreachable ends in Basic Pitch, and says it fell back.
     5. the way back: ?cdn=1 and a stored ppp.cdn = '1' ask the CDN addresses and no vendored file; a vendored file that cannot be fetched is asked for at its
        CDN address once. The CDN answers here are the vendored bytes (tests/engrave/vendor-optional.test.js proves them equal to what the CDN serves).
     6. (PPP_REAL_CDN=1, needs the network) the CDN path and the vendored path hear the same notes in the same audio, note for note.
   The recording is a generated four-note signal, not a G10 fixture: those keep heard notes only (the audio never leaves the work directory). */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { boot } = require('../load/lib');

const REPO = path.resolve(__dirname, '..', '..');
const REAL = !!process.env.PPP_REAL_CDN;
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

/* ---- the CDN addresses, and the vendored bytes that stand in for them ---- */
const JSD = 'https://cdn.jsdelivr.net/npm/';
const STAND_IN = {
  [JSD + 'pdfjs-dist@3.11.174/legacy/build/pdf.min.js']: 'vendor/pdfjs-3.11.174/pdf.min.js',
  [JSD + 'pdfjs-dist@3.11.174/legacy/build/pdf.worker.min.js']: 'vendor/pdfjs-3.11.174/pdf.worker.min.js',
  [JSD + '@tensorflow/tfjs@2.8.6/dist/tf.min.js']: 'vendor/tfjs-2.8.6/tf.min.js',
  [JSD + '@magenta/music@1.23.1/es6/transcription.js']: 'vendor/magenta-music-1.23.1/transcription.js'
};
/* ?cdn=1 also puts React back on unpkg (G13-1), so that page needs its two files answered to start at all */
const REACT_STAND_IN = {
  'https://unpkg.com/react@18.3.1/umd/react.production.min.js': 'vendor/react-18.3.1/react.production.min.js',
  'https://unpkg.com/react-dom@18.3.1/umd/react-dom.production.min.js': 'vendor/react-18.3.1/react-dom.production.min.js'
};
const NPM_HOST = /^https?:\/\/(cdn\.jsdelivr\.net|unpkg\.com|esm\.sh|cdnjs\.cloudflare\.com)\//;

/* opts.cdn: undefined (every other host refused, except React's two unpkg files, which only a ?cdn=1 page asks for, answered with the vendored bytes: the page cannot start without them)
   | 'stand-in' (the four jsDelivr files are answered with the vendored bytes too) | 'real' (everything goes to the network); opts.query; opts.stored: a value for localStorage
   ppp.cdn; opts.failVendored: [path fragments] answered 404 */
async function open(opts) {
  opts = opts || {};
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  const st = { asked: [], refused: [], answered: [], statuses: new Map(), headers: new Map(), pageErrors: [], ctx, page };
  await page.setViewport({ width: 1100, height: 800 });
  await page.evaluateOnNewDocument(stored => {
    try { localStorage.setItem('ppp-guest', '1'); localStorage.setItem('ppp-locale', 'en-US'); if (stored) localStorage.setItem('ppp.cdn', stored); } catch (e) { /* */ }
  }, opts.stored || null);
  const site = 'http://127.0.0.1:' + srv.port;
  await page.setRequestInterception(true);
  page.on('request', r => {
    const u = r.url();
    st.asked.push(u);
    if (u.startsWith(site) || /^(data|blob):/.test(u)) {
      if ((opts.failVendored || []).some(f => u.indexOf(f) >= 0)) { st.refused.push(u); return r.respond({ status: 404, body: 'not here' }).catch(() => {}); }
      return r.continue().catch(() => {});
    }
    if (opts.cdn === 'real') return r.continue().catch(() => {});
    const bare = u.split('?')[0];
    const stand = STAND_IN[bare] || REACT_STAND_IN[bare];
    if (opts.cdn !== 'refuse' && opts.cdn !== 'real' && stand && (opts.cdn === 'stand-in' || REACT_STAND_IN[bare])) {
      st.answered.push(u);
      return r.respond({ status: 200, contentType: 'text/javascript; charset=utf-8', headers: { 'Access-Control-Allow-Origin': '*' }, body: fs.readFileSync(path.join(REPO, stand)) }).catch(() => {});
    }
    st.refused.push(u);
    return r.abort('blockedbyclient').catch(() => {});
  });
  page.on('response', res => {
    st.statuses.set(res.url(), res.status());
    st.headers.set(res.url(), res.headers());
  });
  page.on('pageerror', e => st.pageErrors.push(String(e && e.message || e).slice(0, 300)));
  await page.goto(site + '/Piano%20Coach%20App.dc.html' + (opts.query || ''), { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => window.PPP && PPP.Import && PPP.Import.amtNotes && PPP.Import.pianoAmtNotes, { timeout: 60000 });
  return st;
}
const close = st => st.ctx.close().catch(() => {});
const npmAsked = st => st.asked.filter(u => NPM_HOST.test(u));
const vendorAsked = (st, frag) => st.asked.filter(u => u.indexOf('/vendor/' + (frag || '')) >= 0);

/* ---- a one-page vector PDF (the one tests/pdf-layer.test.js writes: staves, notes in the music font, chord names, a title), as base64 ---- */
function makePdf() {
  const ops = [];
  const text = (font, size, x, y, s) => ops.push('BT /' + font + ' ' + size + ' Tf ' + x + ' ' + y + ' Td (' + s + ') Tj ET');
  const line = (x0, y0, x1, y1) => ops.push(x0 + ' ' + y0 + ' m ' + x1 + ' ' + y1 + ' l S');
  ops.push('0.5 w');
  text('F1', 24, 220, 790, 'Vector Song');
  text('F1', 11, 420, 765, 'Music by Test Composer');
  [700, 620].forEach(top => { for (let i = 0; i < 5; i++) line(50, top - 6 * i, 550, top - 6 * i); });
  [50, 200, 350, 550].forEach(x => line(x, 596, x, 700));
  [[90, 682], [90, 688], [90, 694], [140, 685], [230, 691], [300, 697], [380, 703], [450, 688], [500, 694], [520, 691]]
    .forEach(p => text('F2', 20, p[0], p[1], '\\234'));
  [[90, 617], [230, 605], [380, 596]].forEach(p => text('F2', 20, p[0], p[1], '\\234'));
  const stream = ops.join('\n');
  const objs = [];
  objs.push('<< /Type /Catalog /Pages 2 0 R >>');
  objs.push('<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  objs.push('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>');
  objs.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  objs.push('<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman /Encoding /WinAnsiEncoding >>');
  objs.push('<< /Length ' + Buffer.byteLength(stream, 'latin1') + ' >>\nstream\n' + stream + '\nendstream');
  let out = '%PDF-1.4\n';
  const offs = [];
  objs.forEach((o, i) => { offs.push(Buffer.byteLength(out, 'latin1')); out += (i + 1) + ' 0 obj\n' + o + '\nendobj\n'; });
  const xref = Buffer.byteLength(out, 'latin1');
  out += 'xref\n0 ' + (objs.length + 1) + '\n0000000000 65535 f \n' + offs.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('') +
    'trailer\n<< /Size ' + (objs.length + 1) + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n';
  return Buffer.from(out, 'latin1').toString('base64');
}

/* ---- a four-note recording: C4 E4 G4 C5, a few harmonics each, a piano-like decay; mono 16-bit WAV at 22.05 kHz ---- */
const NOTES = [{ midi: 60, at: 0.1, dur: 0.8 }, { midi: 64, at: 1.0, dur: 0.8 }, { midi: 67, at: 1.9, dur: 0.8 }, { midi: 72, at: 2.8, dur: 1.0 }];
function makeWav() {
  const sr = 22050;
  const n = Math.floor((NOTES.reduce((t, x) => Math.max(t, x.at + x.dur), 0) + 0.3) * sr);
  const f = new Float32Array(n);
  NOTES.forEach(nt => {
    const hz = 440 * Math.pow(2, (nt.midi - 69) / 12);
    const s0 = Math.floor(nt.at * sr), len = Math.floor(nt.dur * sr);
    for (let i = 0; i < len && s0 + i < n; i++) {
      const t = i / sr;
      const env = Math.min(1, t / 0.005) * Math.exp(-t * 2.2);
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
const WAV = makeWav();

/* what a page does with the PDF: Import.load with no helper (the browser reads the page itself), as tests/pdf-layer.test.js does */
const importPdf = (page, b64) => page.evaluate(async data => {
  const bin = atob(data); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  PPP.Import.health = () => Promise.resolve({ ok: false, remote: true, unreachable: true });
  try {
    const got = await PPP.Import.load({ name: 'vector.pdf', type: 'application/pdf', size: u.length, arrayBuffer: () => Promise.resolve(u.slice().buffer) });
    const notes = got.score.notes.filter(x => !x.rest);
    return { ok: true, engine: got.source && got.source.engine, notes: notes.length, pitches: notes.map(x => x.p), title: got.score.title, lib: !!window.pdfjsLib,
      worker: window.pdfjsLib && window.pdfjsLib.GlobalWorkerOptions.workerSrc };
  } catch (e) { return { ok: false, error: String(e && e.message || e), code: e && e.code }; }
}, b64);
const callAmt = (page, which) => page.evaluate(async (data, fn) => {
  const bin = atob(data); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  try {
    const got = await PPP.Import[fn](u.buffer, () => {});
    return { ok: true, engine: got.engine, tier: got.qualityTier, notes: got.notes.map(n => [n.midi, +n.on.toFixed(3), +n.off.toFixed(3), n.vel]) };
  } catch (e) { return { ok: false, error: String(e && e.message || e), code: e && e.code, cause: String(e && e.cause && e.cause.message || '') }; }
}, WAV, which);
/* the pitches heard, the note blips of the model's start removed: what the recording says */
const pitchesOf = notes => notes.filter(n => n[2] - n[1] > 0.3).map(n => n[0]);

test('PDF import with every other site refused: pdf.js and its worker are PPP\'s, by hash, immutable', async () => {
  const st = await open();
  try {
    const r = await importPdf(st.page, makePdf());
    assert.equal(r.ok, true, 'the import: ' + JSON.stringify(r));
    assert.equal(r.engine, 'pdf', 'the page notated itself from the vector PDF');
    assert.ok(r.notes >= 8, 'notes: ' + r.notes);
    assert.deepEqual(npmAsked(st), [], 'no request to jsDelivr, unpkg, esm.sh or cdnjs');
    const lib = vendorAsked(st, 'pdfjs-3.11.174/');
    assert.equal(lib.length, 2, 'pdf.min.js and pdf.worker.min.js: ' + lib.join(', '));
    lib.forEach(u => {
      assert.match(u, /\?h=[0-9a-f]{12}$/, u + ' is asked for by its content hash');
      assert.equal(st.statuses.get(u), 200, u + ' was served');
      assert.match(st.headers.get(u)['cache-control'], /immutable/, u + ' is immutable');
    });
    assert.ok(/\/vendor\/pdfjs-3\.11\.174\/pdf\.worker\.min\.js\?h=[0-9a-f]{12}$/.test(r.worker), 'the worker is the vendored file: ' + r.worker);
    assert.deepEqual(st.pageErrors, [], 'no page error');
  } finally { await close(st); }
});

test('the Onsets and Frames model starts offline and says what it needs: an internet connection for its weights (U8)', async () => {
  const st = await open();
  try {
    const r = await callAmt(st.page, 'pianoAmtNotes');
    assert.equal(r.ok, false, 'the checkpoint is at Google and Google is refused: ' + JSON.stringify(r));
    assert.equal(r.code, 'model-offline');
    assert.match(r.error, /needs an internet connection/);
    assert.deepEqual(npmAsked(st), [], 'no request to a CDN: TensorFlow.js 2.8.6 and transcription.js are PPP\'s');
    const lib = vendorAsked(st).filter(u => /tfjs-2\.8\.6|magenta-music/.test(u));
    assert.equal(lib.length, 2, 'tf.min.js and transcription.js: ' + lib.join(', '));
    lib.forEach(u => { assert.match(u, /\?h=[0-9a-f]{12}$/); assert.equal(st.statuses.get(u), 200); });
    assert.ok(st.asked.some(u => /^https:\/\/storage\.googleapis\.com\/magentadata\/js\/checkpoints\/transcription\/onsets_frames_uni/.test(u)), 'the model got as far as asking for its weights');
    /* and a second try asks again (a connection that comes back is not held against it) */
    const again = await callAmt(st.page, 'pianoAmtNotes');
    assert.equal(again.code, 'model-offline');
  } finally { await close(st); }
});

test('Basic Pitch works with no network: its code, TensorFlow.js 3.21.0 and its model are PPP\'s', async () => {
  const st = await open();
  try {
    const r = await callAmt(st.page, 'amtNotes');
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.engine, 'basic-pitch');
    assert.deepEqual(pitchesOf(r.notes), [60, 64, 67, 72], 'the four notes of the recording, in order');
    assert.deepEqual(npmAsked(st), [], 'no request to jsDelivr, unpkg, esm.sh or cdnjs');
    const lib = vendorAsked(st).filter(u => /tfjs-3\.21\.0|basic-pitch/.test(u));
    assert.equal(lib.length, 6, 'tf.fesm.min.js, three modules, model.json, the weights: ' + lib.join(', '));
    lib.forEach(u => {
      assert.match(u, /\?h=[0-9a-f]{12}$/, u + ' is asked for by its content hash');
      assert.equal(st.statuses.get(u), 200, u + ' was served');
      assert.match(st.headers.get(u)['cache-control'], /immutable/, u + ' is immutable (the weights too: a hash of their own)');
    });
    assert.deepEqual(st.pageErrors, [], 'no page error');
  } finally { await close(st); }
});

test('a whole recording with the Google checkpoint unreachable ends in Basic Pitch, and says it fell back', async () => {
  const st = await open();
  try {
    const r = await st.page.evaluate(async data => {
      const bin = atob(data); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
      const file = new File([u], 'four-notes.wav', { type: 'audio/wav' });
      try {
        const got = await PPP.Import.transcribeHere({ file: file }, () => {}, null);
        const h = got.heard;
        return { ok: true, engine: h.engine, tier: h.qualityTier, from: h.fallbackFrom, reason: h.fallbackReason, notes: h.notes.map(n => [n.midi, n.on, n.off]), title: got.title };
      } catch (e) { return { ok: false, error: String(e && e.message || e), code: e && e.code }; }
    }, WAV);
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.engine, 'basic-pitch');
    assert.equal(r.from, 'onsets-and-frames');
    assert.equal(r.reason, 'model-offline', 'the reason the piano model could not run');
    assert.deepEqual(r.notes.filter(n => n[2] - n[1] > 0.3).map(n => n[0]), [60, 64, 67, 72]);
    assert.deepEqual(npmAsked(st), []);
  } finally { await close(st); }
});

test('the way back: ?cdn=1 asks the CDN addresses and no vendored file (PDF, Onsets and Frames)', async () => {
  const st = await open({ query: '?cdn=1', cdn: 'stand-in' });
  try {
    assert.equal(await st.page.evaluate(() => PPP.cdn), true);
    const r = await importPdf(st.page, makePdf());
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.engine, 'pdf');
    assert.equal(r.worker, JSD + 'pdfjs-dist@3.11.174/legacy/build/pdf.worker.min.js', 'the worker is the CDN one');
    const o = await callAmt(st.page, 'pianoAmtNotes');
    assert.equal(o.code, 'model-offline', 'the checkpoint is still refused: ' + JSON.stringify(o));
    const asked = st.asked.filter(u => /^https:\/\/cdn\.jsdelivr\.net\//.test(u));
    const once = u => asked.filter(a => a === u).length;
    [JSD + 'pdfjs-dist@3.11.174/legacy/build/pdf.min.js', JSD + '@tensorflow/tfjs@2.8.6/dist/tf.min.js', JSD + '@magenta/music@1.23.1/es6/transcription.js']
      .forEach(u => assert.equal(once(u), 1, u + ' is asked for once'));
    /* the worker is fetched by the worker's own importScripts (not seen by the page) or, in a browser that falls back to a fake worker, by a script tag: both are right */
    asked.forEach(u => assert.ok(STAND_IN[u], 'no jsDelivr address but the four of PPP_LIBS: ' + u));
    assert.deepEqual(vendorAsked(st).filter(u => /pdfjs|tfjs|magenta|basic-pitch/.test(u)), [], 'no vendored library file is asked for');
  } finally { await close(st); }
});

test('the way back: a remembered ppp.cdn = 1 does the same, and ?cdn=0 is vendored for one visit', async () => {
  const a = await open({ stored: '1', cdn: 'stand-in' });
  try {
    assert.equal(await a.page.evaluate(() => PPP.cdn), true);
    const r = await importPdf(a.page, makePdf());
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.ok(a.asked.some(u => u === JSD + 'pdfjs-dist@3.11.174/legacy/build/pdf.min.js'), 'pdf.js from jsDelivr');
    assert.deepEqual(vendorAsked(a, 'pdfjs-3.11.174/'), []);
  } finally { await close(a); }
  const b = await open({ stored: '1', query: '?cdn=0', cdn: 'stand-in' });
  try {
    assert.equal(await b.page.evaluate(() => PPP.cdn), false);
    const r = await importPdf(b.page, makePdf());
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.deepEqual(npmAsked(b), []);
    assert.equal(vendorAsked(b, 'pdfjs-3.11.174/').length, 2);
  } finally { await close(b); }
});

test('the way back for Basic Pitch asks esm.sh, then jsDelivr, and says so when neither answers; none of PPP\'s files is used', async () => {
  const st = await open({ query: '?cdn=1' });
  try {
    const r = await callAmt(st.page, 'amtNotes');
    assert.equal(r.ok, false);
    assert.equal(r.code, 'amt-offline');
    assert.match(r.error, /needs an internet connection/);
    assert.ok(st.asked.some(u => u === 'https://esm.sh/@tensorflow/tfjs@3.21.0'), 'esm.sh is asked first');
    /* the page answers as soon as a module of the second try fails (the esm.sh one is a failure it already has), so the request for the other one may still be on its way here */
    for (let i = 0; i < 40 && !st.asked.some(u => u === 'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@3.21.0/+esm'); i++) await new Promise(r => setTimeout(r, 50));
    assert.ok(st.asked.some(u => u === 'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@3.21.0/+esm'), 'then jsDelivr');
    assert.deepEqual(vendorAsked(st).filter(u => /tfjs-3\.21\.0|basic-pitch/.test(u)), [], 'no vendored file');
    assert.equal(await st.page.evaluate(() => !!document.querySelector('script[type=importmap]')), false, 'no import map was added');
  } finally { await close(st); }
});

test('a vendored file that cannot be fetched falls back to its CDN copy once (pdf.js, Onsets and Frames code)', async () => {
  const st = await open({ cdn: 'stand-in', failVendored: ['/vendor/pdfjs-3.11.174/pdf.min.js', '/vendor/tfjs-2.8.6/tf.min.js'] });
  try {
    assert.equal(await st.page.evaluate(() => PPP.cdn), false, 'the default is vendored');
    const r = await importPdf(st.page, makePdf());
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.ok(st.answered.includes(JSD + 'pdfjs-dist@3.11.174/legacy/build/pdf.min.js'), 'the CDN copy answered');
    const o = await callAmt(st.page, 'pianoAmtNotes');
    assert.equal(o.code, 'model-offline', 'the code loaded (from the CDN copy) and the weights are what failed: ' + JSON.stringify(o));
    assert.ok(st.answered.includes(JSD + '@tensorflow/tfjs@2.8.6/dist/tf.min.js'));
  } finally { await close(st); }
});

test('a vendored Basic Pitch file that cannot be fetched ends in the CDN way (esm.sh), and says so when that is not there either', async () => {
  const st = await open({ failVendored: ['/vendor/basic-pitch-1.0.1/model/'] });
  try {
    const r = await callAmt(st.page, 'amtNotes');
    assert.equal(r.ok, false);
    assert.equal(r.code, 'amt-offline');
    assert.ok(st.asked.some(u => u === 'https://esm.sh/@spotify/basic-pitch@1.0.1'), 'esm.sh was tried after the vendored path failed');
  } finally { await close(st); }
});

test('PPP_REAL_CDN=1: the CDN path and the vendored path hear the same notes, note for note (Basic Pitch; the Onsets and Frames model too)', { skip: !REAL, timeout: 900000 }, async () => {
  const v = await open({ cdn: 'real' });
  const c = await open({ cdn: 'real', query: '?cdn=1' });
  try {
    for (const fn of ['amtNotes', 'pianoAmtNotes']) {
      const a = await callAmt(v.page, fn);
      const b = await callAmt(c.page, fn);
      assert.equal(a.ok, true, 'vendored ' + fn + ': ' + JSON.stringify(a));
      assert.equal(b.ok, true, 'CDN ' + fn + ': ' + JSON.stringify(b));
      assert.ok(a.notes.length >= 4, fn + ': notes heard: ' + a.notes.length);
      assert.deepEqual(a.notes, b.notes, fn + ': the same notes, onsets, offsets and velocities');
      console.log('      ' + fn + ': ' + a.notes.length + ' notes, identical on both paths; engine ' + a.engine + '; pitches ' + pitchesOf(a.notes).join(' '));
    }
    assert.deepEqual(npmAsked(v), [], 'the vendored page asked no CDN');
    assert.ok(npmAsked(c).length > 0, 'the ?cdn=1 page did');
  } finally { await close(v); await close(c); }
});
