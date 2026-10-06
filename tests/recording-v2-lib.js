/* The shared parts of the app's v2 browser tests (tests/recording-v2-app.test.js, tests/recording-v2-play.test.js): a page in a browser context of its own, the stubbed transcription model, an import
   through the real screen, what is measured of the open song, and the checks "what is drawn = what is played". */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { preparePage } = require('./boot');

const REPO = path.resolve(__dirname, '..');
const errors = [];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ok = (name, cond, detail) => {
  console.log((cond ? '  ✓ ' : '  ✗ ') + name + (detail ? ' — ' + detail : ''));
  if (!cond) errors.push(name + (detail ? ' — ' + detail : ''));
};
const HELPER = /:8788\/|\/helper(\/|$|\?)/;
const REC_FILES = /^\/rec\//;
const SCRIPTS = ['attacks', 'beats', 'model', 'metre', 'hands', 'index', 'grid', 'voices', 'rests', 'writer', 'key', 'pedal', 'app'].map(n => '/rec/' + n + '.js');
const WEIGHTS = ['ai5a-v1', 'hands-v1', 'ai5b-grid-v1', 'ai5b-rests-v1'].map(n => '/rec/weights/' + n + '.json');
const CATALOG = {};
['ko-KR', 'ja-JP', 'zh-CN'].forEach(l => { CATALOG[l] = JSON.parse(fs.readFileSync(path.join(REPO, 'i18n', l + '.json'), 'utf8')).content; });

/* V2_ONLY=fixtures|calls|... runs only those sections (development) */
const ONLY = process.env.V2_ONLY ? new RegExp(process.env.V2_ONLY) : null;
const want = n => !ONLY || ONLY.test(n);
let BASE = null, ORIGIN = null;
const setBase = b => { BASE = b; ORIGIN = new URL(b).origin; };
const WAV = path.join(os.tmpdir(), 'zz-ppp-fixture-' + process.pid + '.wav');
(function makeWav() {
  const n = 800, buf = Buffer.alloc(44 + n);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n, 4); buf.write('WAVE', 8); buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(8000, 24); buf.writeUInt32LE(8000, 28); buf.writeUInt16LE(1, 32); buf.writeUInt16LE(8, 34); buf.write('data', 36); buf.writeUInt32LE(n, 40); buf.fill(128, 44);
  fs.writeFileSync(WAV, buf);
})();

/* G10a-5b: v2 is the DEFAULT, so a page opened with no store is a v2 page. A test of the classic path asks for it the way a person gets it: the device remembers 'legacy' (the chip turned off) */
const CLASSIC = { 'ppp.recording.v1': 'legacy' };
/* o.query: appended to the address; o.locale; o.store {key: value} set before the page's scripts run; o.legacy: the device remembers 'legacy' (CLASSIC), the way the chip turned off leaves it;
   o.failWhile {re}: matching requests fail while rec.failOn is true;
   o.corrupt {re, body}: matching requests are answered 200 with `body` (a file that is not the file) while rec.failOn is true;
   o.holdWhile {re}: matching requests are never answered (a server that stalls) until page.__rec.release() lets the held ones go on */
async function openPage(browser, o) {
  o = o || {};
  if (o.legacy) o = Object.assign({}, o, { store: Object.assign({}, o.store || {}, CLASSIC) });
  /* a browser context of its own: localStorage (the remembered choice) is not shared with another page of this suite */
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  const closeOnly = page.close.bind(page);
  page.close = async () => { try { await closeOnly(); } finally { await ctx.close(); } };
  await preparePage(page);
  if (o.locale) await page.evaluateOnNewDocument(loc => { try { localStorage.setItem('ppp-locale', loc); } catch (e) {} }, o.locale);
  if (o.store) await page.evaluateOnNewDocument(st => { try { Object.keys(st).forEach(k => localStorage.setItem(k, st[k])); } catch (e) {} }, o.store);
  const rec = { requests: [], consoleErrors: [], pageErrors: [], failOn: true, failed: [], held: [], holdOn: true, release: () => { rec.holdOn = false; rec.held.splice(0).forEach(r => { try { r.continue(); } catch (e) { /* the page is gone */ } }); } };
  page.__rec = rec;
  await page.setRequestInterception(true);
  page.on('request', req => {
    const u = req.url();
    rec.requests.push(u.replace(/^https?:\/\/[^/]+/, ''));
    if (HELPER.test(u)) return req.abort();
    if (o.failWhile && rec.failOn && o.failWhile.test(u)) { rec.failed.push(u.replace(/^https?:\/\/[^/]+/, '')); return req.abort(); }
    if (o.holdWhile && rec.holdOn && o.holdWhile.test(u)) { rec.held.push(req); return; }
    if (o.corrupt && rec.failOn && o.corrupt.re.test(u)) { rec.failed.push(u.replace(/^https?:\/\/[^/]+/, '')); return req.respond({ status: 200, contentType: 'application/javascript', body: o.corrupt.body, headers: { 'Cache-Control': 'no-store' } }); }
    req.continue();
  });
  page.on('console', m => { if (m.type() === 'error' && !HELPER.test(JSON.stringify(m.location())) && !(o.failWhile && /Failed to load resource/.test(m.text()))) rec.consoleErrors.push(m.text()); });
  page.on('pageerror', e => rec.pageErrors.push(e.message));
  await page.setViewport({ width: o.width || 1100, height: o.height || 1000 });
  await page.goto(BASE + (o.query || ''), { waitUntil: o.until || 'networkidle2', timeout: 60000 });
  await page.waitForFunction(() => !!(window.PPP && window.PPP.app), { timeout: 30000 });
  await sleep(300);
  return page;
}
const recReqs = page => page.__rec.requests.filter(u => REC_FILES.test(u)).map(u => u.split('?')[0]);
const clean = page => page.__rec.pageErrors.length === 0 && page.__rec.consoleErrors.length === 0;
const errs = page => JSON.stringify(page.__rec.pageErrors.concat(page.__rec.consoleErrors));

/* the checker of the notation, in the page (a tool, not part of the app) */
async function addChecker(page) {
  await page.addScriptTag({ url: ORIGIN + '/scoregraph/tools/notation-check.js' });
}
/* the transcription stub: the page's "AMT" returns these heard notes. A stub of the model is the one thing replaced; the import it feeds is the real one. */
async function stubAmt(page, heard) {
  await page.evaluate(h => {
    window.__heard = h;
    window.PPP.Import.pianoAmtNotes = async () => ({ notes: h.notes.map(n => Object.assign({}, n)), pedals: (h.pedals || []).map(p => Object.assign({}, p)), duration: h.notes.reduce((m, n) => Math.max(m, n.off), 0) + 1,
      engine: 'onsets-and-frames', qualityTier: 'browser-fallback' });
    /* the 'Full song' recording type asks the broad model (amtNotes) instead: the same stub */
    window.PPP.Import.amtNotes = window.PPP.Import.pianoAmtNotes;
  }, heard);
}
/* an import through the real screen: the file goes in, the stubbed model hears the notes, and the review screen opens */
async function importHeard(page, heard) {
  await stubAmt(page, heard);
  await page.evaluate(() => window.PPP.app.go('upload')());   /* the Add-sheet-music screen by the app's own route (any language) */
  await sleep(500);
  await (await page.$('input[type=file][data-add-file]')).uploadFile(WAV);
  await page.waitForFunction(() => window.PPP.app.state.screen === 'review' || window.PPP.app.state.analysis === 'error', { timeout: 90000 });
  await sleep(1200);
  return page.evaluate(() => { const S = window.PPP.app.state; return { screen: S.screen, error: S.parseError || null, songId: S.songId }; });
}
/* a click on a control by its selector; the page's own click handler, as a person's click reaches it (a sticky header can cover a button that page.click scrolls under) */
const press = (page, sel) => page.evaluate(q => { const b = document.querySelector(q); if (!b) throw new Error('no ' + q); b.click(); }, sel);
/* the engraver is fetched by the first screen that draws a score; wait for it rather than race it */
const stateOf = async page => { await page.waitForFunction(() => !!(window.PPPEngrave && window.PPPEngrave.app && window.PPPScoreGraphModules && window.PPPScoreGraphModules.notationCheck), { timeout: 30000 }); return stateNow(page); };
const stateNow = page => page.evaluate(() => {
  const A = window.PPP.app, S = A.state, sc = S.score, rs = window.PPPEngrave.app.resolveSync(sc), V = window.PPPScoreGraph.validate(rs.graph);
  const NC = window.PPPScoreGraphModules.notationCheck;
  const cls = r => { const o = {}; for (let c = 1; c <= 7; c++) o[c] = r.classes[c].count; return o; };
  return {
    pipeline: S.importSource && S.importSource.recordingPipeline || null, version: S.importSource && S.importSource.transcriptionVersion, screen: S.screen, songId: S.songId,
    measures: sc.measures.length, notes: sc.notes.filter(n => !n.rest).length, rests: sc.notes.filter(n => n.rest).length, brackets: sc.notes.filter(n => n.tupletStart).length,
    voices: Array.from(new Set(sc.notes.map(n => n.staff + ':' + n.voice))).sort().join(','),
    via: rs.via, errors: V.issues.filter(i => i.severity === 'error').map(i => i.code), warnDisplay: V.issues.filter(i => i.code === 'W-DISPLAY-DURATION').length,
    scoreClasses: cls(NC.checkScore(sc)), graphClasses: cls(NC.checkGraph(rs.graph)),
    unc: (S.importReport && S.importReport.uncertainMeasures) || null, uncPiece: (S.importReport && S.importReport.uncertainPiece) || null, uncWhy: (S.importReport && S.importReport.uncertainWhy) || null, issues: ((S.importReport && S.importReport.issues) || []).map(i => i.kind),
    hash: JSON.stringify(sc.notes.map(n => [n.m, n.b, n.midi, n.dur, n.rest ? 1 : 0, n.staff, n.voice])).length + ':' + sc.notes.reduce((h, n) => (h * 31 + Math.round((n.abs || 0) * 1000) + (n.midi || 0) * 7 + Math.round(n.dur * 1000)) % 1000000007, 7),
    sound: window.PPP.PianoScore.of(sc).strikes.length
  };
});
/* the practice screen's whole score: what is drawn, what is sounded, what is written */
async function drawSound(page) {
  await page.evaluate(() => window.__pppTest.nav('Practice')); await sleep(500);
  await page.evaluate(() => { const t = [...document.querySelectorAll('main [role=tab]')].find(x => /Start to finish/.test(x.innerText)); if (t) t.click(); });
  let heads = 0;
  for (let k = 0; k < 40; k++) { await sleep(700); heads = await page.evaluate(() => document.querySelectorAll('path.vf-notehead:not(.vf-rest), use.vf-notehead:not(.vf-rest)').length); if (heads > 0) { await sleep(1500); break; } }
  return page.evaluate(() => {
    const P = window.PPP, sc = P.app.state.score, plan = P.PianoScore.of(sc);
    const notes = sc.notes.filter(n => !n.rest), k = (abs, midi) => Math.round(abs * 1000) + '|' + midi;
    const want = new Map(), got = new Map();
    notes.filter(n => !n.tieStop).forEach(n => want.set(k(n.abs, n.midi), (want.get(k(n.abs, n.midi)) || 0) + 1));
    plan.strikes.forEach(s => got.set(k(s.abs, s.midi), (got.get(k(s.abs, s.midi)) || 0) + 1));
    let onlyWritten = 0, onlySounded = 0;
    want.forEach((c, key) => { onlyWritten += Math.max(0, c - (got.get(key) || 0)); });
    got.forEach((c, key) => { onlySounded += Math.max(0, c - (want.get(key) || 0)); });
    /* a sounding length is the written length of the note and its ties, or longer under a written pedal; never shorter */
    const byEnd = new Map(); notes.forEach(n => { const key = n.midi + '|' + Math.round((n.abs) * 1000); byEnd.set(key, n); });
    let tooShort = 0, lenChecked = 0;
    plan.strikes.forEach(s => {
      let n = s.note, len = n.dur, guard = 0;
      while (n.tieStart && guard++ < 50) { const nx = byEnd.get(n.midi + '|' + Math.round((n.abs + n.dur) * 1000)); if (!nx || !nx.tieStop) break; len += nx.dur; n = nx; }
      lenChecked++;
      if ((s.upQ - s.q) < len - 1e-3) tooShort++;
    });
    const svgs = [...document.querySelectorAll('svg')].filter(s => s.querySelector('path.vf-stave'));
    const heads = svgs.reduce((a, s) => a + s.querySelectorAll('path.vf-notehead:not(.vf-rest), use.vf-notehead:not(.vf-rest)').length, 0);
    return { notes: notes.length, tieStops: notes.filter(n => n.tieStop).length, struck: plan.strikes.length, heads: heads, onlyWritten: onlyWritten, onlySounded: onlySounded, tooShort: tooShort, lenChecked: lenChecked,
      brackets: document.querySelectorAll('g.ppp-tuplet').length, bracketStarts: notes.filter(n => n.tupletStart).length, pedalMarks: (plan.pedal || []).length };
  });
}
async function arrangeCheck(page, level) {
  return page.evaluate(async lv => {
    const P = window.PPP, S = P.app.state, g = window.PPPEngrave.app.resolveSync(S.score).graph;
    try {
      const r = await P.arrangeSingleNote(g, { level: lv });
      if (!r.ok) return { ok: false, reason: r.reason };
      const sc = P.graphToReviewScore(r.graph, 'x');
      const by = new Map(); sc.notes.filter(n => !n.rest).forEach(n => { const k = n.hand + '|' + n.m + '|' + n.b; by.set(k, (by.get(k) || 0) + 1); });
      return { ok: true, notes: sc.notes.filter(n => !n.rest).length, maxPerHand: Math.max.apply(null, [...by.values()]), plays: P.PianoScore.of(sc).strikes.length };
    } catch (e) { return { ok: false, reason: 'THROWN ' + e.message }; }
  }, level);
}
async function accept(page) {
  await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find(x => /Accept and practise/.test(x.innerText)); if (b) b.click(); });
  await sleep(2500);
}
async function slotOf(page, songId) { return page.evaluate(i => JSON.parse(localStorage.getItem('ppp.song.v1.' + i) || 'null'), songId); }

module.exports = { fs, os, path, REPO, errors, sleep, ok, HELPER, REC_FILES, SCRIPTS, WEIGHTS, CATALOG, ONLY, want, WAV, CLASSIC, setBase, openPage, recReqs, clean, errs, addChecker, stubAmt, importHeard, press, stateOf, drawSound, arrangeCheck, accept, slotOf };
