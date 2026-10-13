/* ============================================================================
   G12-3 in the real page: PPP.omr = 'v2' marks the bars of an OMR import that may be wrong, and says why (docs/GOALS/G12_OMR.md section 8, gate A3).
   Browser suite (puppeteer); not a step of the gate (the gate has no browser): `npm run test:omr-flags-app`, against a server of THIS tree
   (PPP_PORT=9601 NODE_ENV=production node server.js, and tests/engrave/tools/with-port.js). It reads pdf.js from the CDN the page reads it from.

   The helper is stood in for in the page (PPP.Import.health / .recognise return the pages the engine would have written), so what runs is the page's own
   Import.load, the real omr/normalize.js, omr/apply.js, omr/flags.js and the notation checker fetched the way the page fetches them, the real PdfLayer on a PDF of
   staff lines and bar lines, and the review screen's own strip and issue list.

   What this checks:
     - legacy never asks for omr/flags.js or the notation checker, and its report has no flags (the default import is the one main makes)
     - v2 on a clean page: the flags run (report.flagsVersion), nothing is marked, the confidence and the level are the validator's
     - v2 on a page with a bar that does not fill: that bar joins report.suspectMeasures with its codes (report.flagCodes), the issue list names it, the confidence is
       below 0.85 and the level is not "good" (gate A3); the sentences are made when they are shown (no sentence is kept in the report or the song)
     - v2 on a page whose only suspect bar is the validator's (a note at C9): the confidence is capped all the same (the review's major finding), and legacy's is not
     - v2 on a page that shows 4 bars where 3 were read: nothing is marked for it (PdfLayer's bars per line were measured and are not good enough to flag a bar by)
     - the review strip: the marked bar is red and its tooltip carries the sentence; a bar that was not marked is not; after a reload (codes only) the sentence comes
       back once the module has been fetched; in Korean they are Korean
     - the issue list: the bars on show first, 12 of them, and a line that says how many more the strip has
     - the song slot keeps the codes
     - a notation checker that cannot be fetched is said (report.flagsPartial and an issue line); omr/flags.js that cannot be fetched is v2's import and says why
   ============================================================================ */
'use strict';
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const { preparePage } = require('./boot');

const URL = 'http://127.0.0.1:8777/Piano%20Coach%20App.dc.html';
const PDFJS = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/legacy/build/pdf.min.js';
const PDFJS_WORKER = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/legacy/build/pdf.worker.min.js';
const errors = [];
const ok = (name, cond, detail) => {
  console.log((cond ? '  ✓ ' : '  ✗ ') + name + (detail ? ' — ' + detail : ''));
  if (!cond) errors.push(name + (detail ? ' — ' + detail : ''));
};
const short = x => { const s = typeof x === 'string' ? x : JSON.stringify(x); return s.length > 600 ? s.slice(0, 600) + '...' : s; };
const SENTENCE = 'The notes do not fill this measure.';

/* ---- a one-page PDF of two staves and `xs.length` bar lines: nothing else on it, so PdfLayer finds the system and its bars and no notes */
function linesPdf(xs) {
  const ops = ['0.5 w'];
  const line = (x0, y0, x1, y1) => ops.push(x0 + ' ' + y0 + ' m ' + x1 + ' ' + y1 + ' l S');
  [700, 620].forEach(top => { for (let i = 0; i < 5; i++) line(50, top - 6 * i, 550, top - 6 * i); });
  xs.forEach(x => line(x, 596, x, 700));
  const stream = ops.join('\n');
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << >> /Contents 4 0 R >>',
    '<< /Length ' + Buffer.byteLength(stream, 'latin1') + ' >>\nstream\n' + stream + '\nendstream'];
  let out = '%PDF-1.4\n';
  const offs = [];
  objs.forEach((o, i) => { offs.push(Buffer.byteLength(out, 'latin1')); out += (i + 1) + ' 0 obj\n' + o + '\nendobj\n'; });
  const xref = Buffer.byteLength(out, 'latin1');
  out += 'xref\n0 ' + (objs.length + 1) + '\n0000000000 65535 f \n' + offs.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('')
    + 'trailer\n<< /Size ' + (objs.length + 1) + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n';
  return Buffer.from(out, 'latin1').toString('base64');
}

/* ---- the recognition: bars of four quarters in the right hand and a whole note in the left; `cut` lists the bars (1-based) whose right hand has three quarters;
   `high` the bars whose first note is a C9 (the validator marks a note outside a piano) */
const rh = (cut, high) => ['C', 'D', 'E', 'F'].slice(0, cut ? 3 : 4).map((s, i) => '<note default-x="' + (20 + i * 30) + '"><pitch><step>' + s + '</step><octave>' + (high && i === 0 ? 9 : 5)
  + '</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type><staff>1</staff></note>').join('');
const lh = '<backup><duration>DUR</duration></backup><note default-x="20"><pitch><step>C</step><octave>3</octave></pitch><duration>4</duration><voice>5</voice><type>whole</type><staff>2</staff></note>';
function recognition(bars, cut, high) {
  let xml = '<?xml version="1.0" encoding="UTF-8"?><score-partwise version="3.1"><identification><encoding><software>Audiveris 5.11.0</software></encoding></identification>'
    + '<part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1">';
  for (let i = 1; i <= bars; i++) {
    const c = (cut || []).indexOf(i) >= 0, h = (high || []).indexOf(i) >= 0;
    xml += '<measure number="' + i + '" width="150">' + (i === 1 ? '<attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves>'
      + '<clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes>' : '')
      + rh(c, h) + lh.replace('DUR', c ? '3' : '4') + '</measure>';
  }
  return xml + '</part></score-partwise>';
}

/* in the page: stand in for the helper with the pages the engine would have written, then run Import.load on a file */
const IN_PAGE = `
  window.__import = async function (bodyXml, mode, pdfB64) {
    const I = window.PPP.Import;
    window.PPP.omr = mode;
    I.health = async () => ({ ok: true, audiveris: true });
    I.recognise = async () => ({ ok: true, engine: 'Audiveris', pages: [{ index: 0, ok: true }], musicxml: [bodyXml], movements: [[bodyXml]] });
    const bin = atob(pdfB64), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    const file = new File([u], 'lines.pdf', { type: 'application/pdf' });
    try { return { r: await I.load(file, null, { cancelled: false }) }; } catch (e) { return { error: String(e && e.message || e) }; }
  };
`;

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const fresh = async (intercept, locale) => {
    const page = await browser.newPage();
    await preparePage(page);
    if (locale) await page.evaluateOnNewDocument(l => { try { localStorage.setItem('ppp-locale', l); } catch (e) { /* none */ } }, locale);
    page.on('pageerror', e => errors.push('[pageerror] ' + e.message));
    const asked = [];
    await page.setRequestInterception(true);
    page.on('request', req => {
      const u = req.url();
      if (/omr\/(normalize|apply|flags)\.js|notation-check\.js/.test(u)) { asked.push(u.replace(/^.*\/(omr|scoregraph\/tools)\//, '$1/').replace(/\?.*$/, '')); if (intercept && intercept.test(u)) return req.abort('failed'); }
      req.continue();
    });
    await page.goto(URL, { waitUntil: 'networkidle2', timeout: 60000 });
    await page.waitForFunction(() => window.PPP && window.PPP.Import && window.PPP.Import.load && window.PPP.Import.omrFlags, { timeout: 30000 });
    await page.evaluate(IN_PAGE);
    await page.addScriptTag({ url: PDFJS });
    await page.evaluate(w => { window.pdfjsLib.GlobalWorkerOptions.workerSrc = w; }, PDFJS_WORKER);
    return { page, asked };
  };
  const run = (page, xml, mode, pdf) => page.evaluate(async (x, m, p) => {
    const o = await window.__import(x, m, p);
    if (o.error) return { error: o.error };
    const r = o.r;
    window.__last = r;
    return { suspect: r.report.suspectMeasures, codes: r.report.flagCodes || null, hasWhy: 'flagWhy' in r.report, conf: r.report.confidence, level: r.report.level,
      version: r.report.flagsVersion || null, failed: r.report.flagsFailed || null, partial: r.report.flagsPartial || null, issues: r.report.issues.map(i => [i.measure, i.kind, i.message]),
      bars: r.score.measures.length, graph: !!r.graph, keys: Object.keys(r.report).sort(), summary: r.report.summary, advice: r.report.advice, status: r.source.status };
  }, xml, mode, pdf);
  const showReview = (page, from) => page.evaluate(f => {
    const A = window.PPP.app, r = window.__last;
    A.setState({ screen: 'review', score: r.score, importReport: r.report, importSource: r.source, reviewFrom: f || 1, fileName: 'lines.pdf' });
    return true;
  }, from);
  const cellsOf = page => page.evaluate(() => [...document.querySelectorAll('button[title^="Measure "], button[title^="마디 "]')].map(b => ({ title: b.getAttribute('title'), bg: b.style.background })));
  const linesOf = page => page.evaluate(() => [...document.querySelectorAll('span.sc-interp')].map(e => e.textContent.trim())
    .filter(t => /^(Measure \d+:|\d+ more measures are marked|\d+마디:)/.test(t)));
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const pdf3 = linesPdf([50, 200, 350, 550]);              /* three bars */
  const pdf4 = linesPdf([50, 160, 260, 360, 550]);         /* four bars */
  const pdf8 = linesPdf([50, 110, 170, 230, 290, 350, 410, 470, 550]);   /* eight bars */

  /* ---------------------------------------------------------------- legacy */
  console.log('legacy: no flags, no new files');
  {
    const { page, asked } = await fresh();
    const v = await run(page, recognition(3, [2]), 'legacy', pdf3);
    ok('legacy imports the page', !v.error && v.bars === 3, short(v.error || v.bars));
    ok('legacy asked for none of omr/normalize.js, omr/apply.js, omr/flags.js, notation-check.js', asked.length === 0, short(asked));
    ok('legacy: no flags in the report', v.version === null && v.codes === null && v.failed === null && !v.keys.includes('flagCodes') && !v.keys.includes('flagsVersion') && !v.keys.includes('flagsPartial'), short(v.keys));
    ok('legacy: the short bar is not marked (the validator only sees a bar under half full)', !(v.suspect || []).includes(2), short(v.suspect));
    await page.close();
  }

  /* ---------------------------------------------------------------- v2, clean */
  console.log('v2: a page that reads clean');
  {
    const { page, asked } = await fresh();
    const v = await run(page, recognition(3, []), 'v2', pdf3);
    ok('v2 imports the page as a graph', !v.error && v.bars === 3 && v.graph === true, short(v.error || v));
    ok('v2 asked for omr/flags.js and the notation checker (once each)', asked.filter(a => a === 'omr/flags.js').length === 1 && asked.filter(a => /notation-check/.test(a)).length === 1, short(asked));
    ok('the flags ran (report.flagsVersion) and nothing is marked', v.version === 1 && v.codes === null && (v.suspect || []).length === 0 && v.failed === null && v.partial === null, short(v));
    ok('the confidence is the validator\'s (good)', v.conf >= 0.85 && v.level === 'good', v.conf + ' ' + v.level);
    await page.close();
  }

  /* ---------------------------------------------------------------- v2, a bar that does not fill */
  console.log('v2: bar 2 of 8 holds three quarters in the right hand');
  {
    const { page } = await fresh();
    const v = await run(page, recognition(8, [2]), 'v2', pdf8);
    ok('imports', !v.error && v.bars === 8, short(v.error || v.bars));
    ok('the short bar is a suspect bar of the report, and the bars around it are not', Array.isArray(v.suspect) && v.suspect.join() === '2', short(v.suspect));
    ok('with its code, and no sentence kept in the report', v.codes && v.codes[2] && v.codes[2][0] === 'fill-short' && v.hasWhy === false, short(v.codes));
    ok('the issue list names the bar', v.issues.some(i => i[0] === 2 && i[1] === 'flag' && new RegExp('Measure 2: ' + SENTENCE.replace(/\./g, '\\.')).test(i[2])), short(v.issues));
    ok('the confidence is below 0.85 and the level is not "good" (gate A3)', v.conf < 0.85 && v.level !== 'good', v.conf + ' ' + v.level);
    ok('the summary and the advice say so', /but 1 measure need checking/.test(v.summary) && /measures 2\./.test(v.advice), short([v.summary, v.advice]));
    ok('the song is "recognised" or "low-confidence", never silently good', v.status === 'recognised' || v.status === 'low-confidence', v.status);

    /* the review strip */
    await showReview(page, 1);
    await wait(700);
    const cells = await cellsOf(page);
    const c2 = cells.find(c => /^Measure 2 /.test(c.title)), c1 = cells.find(c => /^Measure 1/.test(c.title));
    ok('the strip has a cell for each bar', cells.length >= 8 && !!c1 && !!c2, short(cells));
    ok('the marked bar is red and its tooltip carries the sentence (made from the code, now)', c2 && /needs checking/.test(c2.title) && c2.title.includes(SENTENCE) && /bad/.test(c2.bg), short(c2));
    ok('a bar that was not marked is not', c1 && !/needs checking/.test(c1.title) && !/bad/.test(c1.bg), short(c1));
    const lines = await linesOf(page);
    ok('the issue list shows the bar with its reason, as text, not as a tooltip', lines.some(l => l.startsWith('Measure 2: ' + SENTENCE)), short(lines));
    /* the song slot keeps the codes, not the sentences */
    const slot = await page.evaluate(() => {
      const A = window.PPP.app;
      A.writeSlot();
      const id = A.state.songId || 'demo';
      const keys = Object.keys(localStorage).filter(k => k.indexOf(id) > -1);
      const k = keys.find(x => { try { return !!JSON.parse(localStorage[x]).importReport; } catch (e) { return false; } });
      return k ? JSON.parse(localStorage[k]).importReport : null;
    });
    ok('the song slot keeps the suspect bars and their codes, and no sentence', slot && slot.suspectMeasures.includes(2) && slot.flagCodes && slot.flagCodes[2][0] === 'fill-short' && !('flagWhy' in slot) && slot.confidence < 0.85, short(slot));

    /* the same graph, the same answer, in the page and in Node */
    const inPage = await page.evaluate(() => ({ params: JSON.stringify(window.PPPOmrFlags.PARAMS), nc: !!(window.PPPScoreGraphModules && window.PPPScoreGraphModules.notationCheck), has: window.PPPOmrFlags.hasChecker }));
    const nodeFlags = require(path.join(__dirname, '..', 'omr', 'flags.js'));
    ok('the notation checker was loaded before the module (classes 5-8 are on in the page)', inPage.nc === true && inPage.has === true);
    ok('the page\'s parameters are the repository\'s', inPage.params === JSON.stringify(nodeFlags.PARAMS), inPage.params.slice(0, 120));
    await page.close();
  }

  /* ---------------------------------------------------------------- v2, the only suspect bar is the validator's */
  console.log('v2: bar 3 of 8 has a note at C9 (the validator marks it; no flag does)');
  {
    const legacy = await fresh();
    const l = await run(legacy.page, recognition(8, [], [3]), 'legacy', pdf8);
    ok('legacy: the validator marks bar 3 and the page stays "good" (the cap is v2\'s only)', !l.error && (l.suspect || []).join() === '3' && l.conf >= 0.85 && l.level === 'good', short([l.suspect, l.conf, l.level]));
    await legacy.page.close();
    const { page } = await fresh();
    const v = await run(page, recognition(8, [], [3]), 'v2', pdf8);
    ok('v2: the validator\'s bar is the suspect bar, no flag marked anything', !v.error && (v.suspect || []).join() === '3' && v.codes === null && v.version === 1, short([v.suspect, v.codes, v.version]));
    ok('v2: a suspect bar caps the confidence below 0.85 all the same, and the level is not "good" (gate A3)', v.conf < 0.85 && v.level !== 'good', v.conf + ' ' + v.level);
    ok('v2: the summary no longer says "clean"', /need checking/.test(v.summary) && !/looks clean/.test(v.summary), short(v.summary));
    await page.close();
  }

  /* ---------------------------------------------------------------- v2, the page shows more bars than were read */
  console.log('v2: the page shows 4 bars on its line, 3 were read (the count of bars per line is measured, not trusted: G12 section 23)');
  {
    const { page } = await fresh();
    const v = await run(page, recognition(3, []), 'v2', pdf4);
    ok('imports', !v.error && v.bars === 3, short(v.error || v.bars));
    ok('no bar is marked for the number of bars on the page (the page passes no layout)', v.codes === null && (v.suspect || []).length === 0, short(v.codes));
    await page.close();
  }

  /* ---------------------------------------------------------------- the issue list: the bars on show first, and how many more */
  console.log('v2: 13 short bars of 40: twelve lines, the bars on show first, and the count of the rest');
  {
    const { page } = await fresh();
    const cut = []; for (let i = 3; i <= 39; i += 3) cut.push(i);
    const v = await run(page, recognition(40, cut), 'v2', pdf8);
    ok('imports', !v.error && v.bars === 40, short(v.error || v.bars));
    await showReview(page, 1);
    await wait(700);
    const first = await linesOf(page);
    ok('twelve lines of bars and one that counts the rest', first.length === 13 && /^\d+ more measures are marked on the strip above\.$/.test(first[12]) && first.slice(0, 12).every(l => /^Measure \d+:/.test(l)), short(first));
    ok('the bars on show (1 to 4) come first', /^Measure 2:/.test(first[0]) || /^Measure 3:/.test(first[0]), short(first.slice(0, 3)));
    await showReview(page, 30);
    await wait(700);
    const later = await linesOf(page);
    ok('and when the strip moves, the bars now on show come first', later.length === 13 && /^Measure 3[0-3]:/.test(later[0]), short(later.slice(0, 3)));
    await page.close();
  }

  /* ---------------------------------------------------------------- a saved report: codes only, the module fetched when it is wanted */
  console.log('a saved report has codes; the sentence comes when the module has been fetched');
  {
    const { page, asked } = await fresh();
    const l = await run(page, recognition(8, []), 'legacy', pdf8);     /* a score and a page that has never loaded omr/flags.js */
    ok('the page has not loaded omr/flags.js', !l.error && asked.length === 0, short(asked));
    await page.evaluate(() => {
      const A = window.PPP.app, r = window.__last;
      const rep = Object.assign({}, r.report, { suspectMeasures: [2], flagCodes: { 2: ['fill-short', 'hands-cross'] } });
      A.setState({ screen: 'review', score: r.score, importReport: rep, importSource: r.source, reviewFrom: 1, fileName: 'lines.pdf' });
    });
    await wait(1500);
    const cells = await cellsOf(page);
    const c2 = cells.find(c => /^Measure 2 /.test(c.title));
    ok('the tooltip has the sentences of the codes after the module came', c2 && c2.title.includes(SENTENCE) && c2.title.includes('The right hand plays lower than the left hand here.'), short(c2));
    ok('and it was fetched, with its checker, because a saved report asked', asked.includes('omr/flags.js'), short(asked));
    const lines = await linesOf(page);
    ok('and the issue lines, which a saved report does not have, are made from the codes (text, for a screen without tooltips)', lines.some(l => l.startsWith('Measure 2: ' + SENTENCE)), short(lines));
    await page.close();
  }

  /* ---------------------------------------------------------------- the language */
  console.log('the sentences are the page\'s language, now');
  {
    const { page } = await fresh(null, 'ko-KR');
    const v = await run(page, recognition(8, [2]), 'v2', pdf8);
    ok('ko: the code is not a sentence', v.codes && v.codes[2][0] === 'fill-short' && v.hasWhy === false, short(v.codes));
    ok('ko: the issue line is Korean', v.issues.some(i => i[0] === 2 && i[2].indexOf('이 마디의 음표가 마디를 다 채우지 않아요.') > -1), short(v.issues));
    await showReview(page, 1);
    await wait(700);
    const cells = await cellsOf(page);
    const c2 = cells.find(c => /2/.test(c.title) && /이 마디의 음표가 마디를 다 채우지 않아요\./.test(c.title));
    ok('ko: the tooltip is Korean', !!c2, short(cells.slice(0, 3)));
    await page.close();
  }

  /* ---------------------------------------------------------------- the notation checker cannot be fetched */
  console.log('v2: the notation checker cannot be fetched');
  {
    const { page } = await fresh(/notation-check\.js/);
    const v = await run(page, recognition(8, [2]), 'v2', pdf8);
    ok('the flags run without it, and the report says the check was partial (a field and an issue line)', !v.error && v.version === 1 && v.partial === 'no-notation-checker'
      && v.issues.some(i => i[0] === null && i[1] === 'flags-partial'), short([v.version, v.partial, v.issues]));
    ok('the bar that does not fill is still marked (the fill checks do not need the checker)', (v.suspect || []).join() === '2', short(v.suspect));
    const kept = await page.evaluate(() => !!window.PPPOmrFlags);
    ok('the module that came without its checker is not kept: the next import asks again', kept === false, String(kept));
    await page.close();
  }

  /* ---------------------------------------------------------------- the module cannot be fetched */
  console.log('v2: omr/flags.js cannot be fetched');
  {
    const { page } = await fresh(/omr\/flags\.js/);
    const v = await run(page, recognition(8, [2]), 'v2', pdf8);
    ok('the import is v2\'s, without flags, and says why', !v.error && v.graph === true && v.failed === 'not-loaded' && v.codes === null, short(v));
    ok('nothing is made up: the confidence is the validator\'s', v.conf >= 0.85, String(v.conf));
    await page.close();
  }

  await browser.close();
  console.log(errors.length ? '\nFAILED: ' + errors.length + '\n' + errors.map(e => '  - ' + e).join('\n') : '\nall checks passed');
  process.exit(errors.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
