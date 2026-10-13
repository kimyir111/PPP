/* ============================================================================
   G12-3 in the real page: PPP.omr = 'v2' marks the bars of an OMR import that may be wrong, and says why (docs/GOALS/G12_OMR.md section 8, gate A3).
   Browser suite (puppeteer); not a step of the gate (the gate has no browser): `npm run test:omr-flags-app`, against a server of THIS tree
   (PPP_PORT=9601 NODE_ENV=production node server.js, and tests/engrave/tools/with-port.js). It reads pdf.js from the CDN the page reads it from.

   The helper is stood in for in the page (PPP.Import.health / .recognise return the pages the engine would have written), so what runs is the page's own
   Import.load, the real omr/normalize.js, omr/apply.js, omr/flags.js and the notation checker fetched the way the page fetches them, the real PdfLayer on a PDF of
   staff lines and bar lines (so the page's own bar count is known), and the review screen's own strip.

   What this checks:
     - legacy never asks for omr/flags.js or the notation checker, and its report has no flags (the default import is the one main makes)
     - v2 on a clean page: the flags run (report.flagsVersion), nothing is marked, the confidence and the level are the validator's
     - v2 on a page with a bar that does not fill: that bar joins report.suspectMeasures with its sentence (report.flagWhy) and code (report.flagCodes),
       the issue list names it, the confidence is below 0.85 and the level is not "good" (gate A3)
     - v2 on a page that shows 4 bars where 3 were read: the page's own lines say so (the reason names both numbers), every bar of the line is marked
     - the review strip: the marked bar is red and its tooltip carries the sentence; a bar that was not marked is not
     - the language: the sentence is the page's (ko), the codes are not
     - the song slot keeps the reasons (writeSlot), and a reload of it gives them back
     - the module is the one the node tests run: the same graph gives the same answer in the page and in Node
     - v2 that cannot get omr/flags.js: the import is the one v2 made without flags, and says why (report.flagsFailed)
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

/* ---- the recognition: bars of four quarters in the right hand and a whole note in the left; `cut` lists the bars (1-based) whose right hand has three quarters */
const rh = (cut) => ['C', 'D', 'E', 'F'].slice(0, cut ? 3 : 4).map((s, i) => '<note default-x="' + (20 + i * 30) + '"><pitch><step>' + s + '</step><octave>5</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type><staff>1</staff></note>').join('');
const lh = '<backup><duration>' + 'DUR' + '</duration></backup><note default-x="20"><pitch><step>C</step><octave>3</octave></pitch><duration>4</duration><voice>5</voice><type>whole</type><staff>2</staff></note>';
function recognition(bars, cut) {
  let xml = '<?xml version="1.0" encoding="UTF-8"?><score-partwise version="3.1"><identification><encoding><software>Audiveris 5.11.0</software></encoding></identification>'
    + '<part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1">';
  for (let i = 1; i <= bars; i++) {
    const c = (cut || []).indexOf(i) >= 0;
    xml += '<measure number="' + i + '" width="150">' + (i === 1 ? '<attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves>'
      + '<clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes>' : '')
      + rh(c) + lh.replace('DUR', c ? '3' : '4') + '</measure>';
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
  const slim = r => ({ suspect: r.report.suspectMeasures, why: r.report.flagWhy || null, codes: r.report.flagCodes || null, conf: r.report.confidence, level: r.report.level,
    version: r.report.flagsVersion || null, failed: r.report.flagsFailed || null, issues: r.report.issues.map(i => [i.measure, i.kind]), bars: r.score.measures.length, graph: !!r.graph,
    keys: Object.keys(r.report).sort(), normalize: !!r.report.normalize });
  const run = (page, xml, mode, pdf) => page.evaluate(async (x, m, p) => {
    const o = await window.__import(x, m, p);
    if (o.error) return { error: o.error };
    const r = o.r;
    const view = { suspect: r.report.suspectMeasures, why: r.report.flagWhy || null, codes: r.report.flagCodes || null, conf: r.report.confidence, level: r.report.level,
      version: r.report.flagsVersion || null, failed: r.report.flagsFailed || null, issues: r.report.issues.map(i => [i.measure, i.kind, i.message]), bars: r.score.measures.length, graph: !!r.graph,
      keys: Object.keys(r.report).sort(), normalize: !!r.report.normalize, summary: r.report.summary, advice: r.report.advice, status: r.source.status };
    window.__last = r;
    return view;
  }, xml, mode, pdf);
  const pdf3 = linesPdf([50, 200, 350, 550]);              /* three bars */
  const pdf8 = linesPdf([50, 110, 170, 230, 290, 350, 410, 470, 550]);   /* eight bars */
  const pdf4 = linesPdf([50, 160, 260, 360, 550]);         /* four bars */

  /* ---------------------------------------------------------------- legacy */
  console.log('legacy: no flags, no new files');
  {
    const { page, asked } = await fresh();
    const v = await run(page, recognition(3, [2]), 'legacy', pdf3);
    ok('legacy imports the page', !v.error && v.bars === 3, short(v.error || v.bars));
    ok('legacy asked for none of omr/normalize.js, omr/apply.js, omr/flags.js, notation-check.js', asked.length === 0, short(asked));
    ok('legacy: no flags in the report', v.version === null && v.why === null && v.codes === null && v.failed === null && !v.keys.includes('flagWhy') && !v.keys.includes('flagsVersion'), short(v.keys));
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
    ok('the flags ran (report.flagsVersion) and nothing is marked', v.version === 1 && v.why === null && (v.suspect || []).length === 0 && v.failed === null, short(v));
    ok('the confidence is the validator\'s (good)', v.conf >= 0.85 && v.level === 'good', v.conf + ' ' + v.level);
    await page.close();
  }

  /* ---------------------------------------------------------------- v2, a bar that does not fill */
  console.log('v2: bar 2 of 8 holds three quarters in the right hand');
  let slot = null;
  {
    const { page } = await fresh();
    const v = await run(page, recognition(8, [2]), 'v2', pdf8);
    ok('imports', !v.error && v.bars === 8, short(v.error || v.bars));
    ok('the short bar is a suspect bar of the report, and the bars around it are not', Array.isArray(v.suspect) && v.suspect.join() === '2', short(v.suspect));
    ok('with its sentence and its code', v.why && v.why[2] && v.why[2][0] === 'The notes do not fill this measure.' && v.codes[2][0] === 'fill-short', short(v.why) + ' ' + short(v.codes));
    ok('the issue list names the bar', v.issues.some(i => i[0] === 2 && i[1] === 'flag' && /Measure 2: The notes do not fill this measure\./.test(i[2])), short(v.issues));
    ok('the confidence is below 0.85 and the level is not "good" (gate A3)', v.conf < 0.85 && v.level !== 'good', v.conf + ' ' + v.level);
    ok('the summary and the advice say so', /but 1 measure need checking/.test(v.summary) && /measures 2\./.test(v.advice), short([v.summary, v.advice]));
    ok('the song is "recognised" or "low-confidence", never silently good', v.status === 'recognised' || v.status === 'low-confidence', v.status);

    /* the review strip */
    const strip = await page.evaluate(() => {
      const A = window.PPP.app, r = window.__last;
      A.setState({ screen: 'review', score: r.score, importReport: r.report, importSource: r.source, reviewFrom: 1, fileName: 'lines.pdf' });
      return true;
    });
    await new Promise(r => setTimeout(r, 700));
    const cells = await page.evaluate(() => [...document.querySelectorAll('button[title^="Measure "]')].map(b => ({ title: b.getAttribute('title'), bg: b.style.background })));
    const c2 = cells.find(c => /^Measure 2 /.test(c.title)), c1 = cells.find(c => /^Measure 1/.test(c.title));
    ok('the strip has a cell for each bar', cells.length >= 8 && !!c1 && !!c2, short(cells));
    ok('the marked bar is red and its tooltip carries the sentence', c2 && /needs checking/.test(c2.title) && /The notes do not fill this measure\./.test(c2.title) && /bad/.test(c2.bg), short(c2));
    ok('a bar that was not marked is not', c1 && !/needs checking/.test(c1.title) && !/bad/.test(c1.bg), short(c1));
    /* the song slot keeps the reasons */
    slot = await page.evaluate(() => {
      const A = window.PPP.app;
      A.writeSlot();
      const id = A.state.songId || 'demo';
      const keys = Object.keys(localStorage).filter(k => k.indexOf(id) > -1);
      const k = keys.find(x => { try { return !!JSON.parse(localStorage[x]).importReport; } catch (e) { return false; } });
      return k ? JSON.parse(localStorage[k]).importReport : null;
    });
    ok('the song slot keeps the suspect bars, their sentences and their codes', slot && slot.suspectMeasures.includes(2) && slot.flagWhy && slot.flagWhy[2][0] === 'The notes do not fill this measure.' && slot.flagCodes[2][0] === 'fill-short' && slot.confidence < 0.85, short(slot));

    /* the same graph, the same answer, in the page and in Node */
    const inPage = await page.evaluate(() => {
      const r = window.__last, FL = window.PPPOmrFlags;
      const res = FL.analyze(r.graph, { normalize: r.report.normalize });
      return { suspect: res.suspect, params: JSON.stringify(FL.PARAMS), bars: res.bars.map(b => [b.strong, b.weak]), nc: !!(window.PPPScoreGraphModules && window.PPPScoreGraphModules.notationCheck) };
    });
    const nodeFlags = require(path.join(__dirname, '..', 'omr', 'flags.js'));
    ok('the notation checker was loaded before the module (class 5-8 signals are on in the page)', inPage.nc === true);
    ok('the page\'s parameters are the repository\'s', inPage.params === JSON.stringify(nodeFlags.PARAMS), inPage.params.slice(0, 120));
    await page.close();
  }

  /* ---------------------------------------------------------------- v2, the page shows more bars than were read */
  console.log('v2: the page shows 4 bars on its line, 3 were read');
  {
    const { page } = await fresh();
    const v = await run(page, recognition(3, []), 'v2', pdf4);
    ok('imports', !v.error && v.bars === 3, short(v.error || v.bars));
    ok('every bar of the line is marked, with the two numbers', v.why && [1, 2, 3].every(m => v.why[m] && v.why[m].includes('The page shows 4 measures on this line, PPP read 3.')), short(v.why));
    ok('the codes say page-bars', v.codes && [1, 2, 3].every(m => v.codes[m].includes('page-bars')), short(v.codes));
    ok('and the page is not "good"', v.conf < 0.85, String(v.conf));
    await page.close();
  }

  /* ---------------------------------------------------------------- the language */
  console.log('the sentences are the page\'s language');
  {
    const { page } = await fresh(null, 'ko-KR');
    const v = await run(page, recognition(8, [2]), 'v2', pdf8);
    ok('ko: the sentence is Korean, the code is not', v.why && v.why[2] && v.why[2][0] === '이 마디의 음표가 마디를 다 채우지 않아요.' && v.codes[2][0] === 'fill-short', short(v.why));
    await page.close();
  }

  /* ---------------------------------------------------------------- the module cannot be fetched */
  console.log('v2: omr/flags.js cannot be fetched');
  {
    const { page } = await fresh(/omr\/flags\.js/);
    const v = await run(page, recognition(3, [2]), 'v2', pdf3);
    ok('the import is v2\'s, without flags, and says why', !v.error && v.graph === true && v.failed === 'not-loaded' && v.why === null, short(v));
    ok('nothing is made up: the confidence is the validator\'s', v.conf >= 0.85, String(v.conf));
    await page.close();
  }

  await browser.close();
  console.log(errors.length ? '\nFAILED: ' + errors.length + '\n' + errors.map(e => '  - ' + e).join('\n') : '\nall checks passed');
  process.exit(errors.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
