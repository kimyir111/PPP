/* ============================================================================
   G12-1 in the real page: PPP.omr ('legacy' | 'v2') and what an import does with what the engine read (docs/GOALS/G12_OMR.md G12-D10, section 7.1).
   Browser suite (puppeteer); not a step of the gate (the gate has no browser): `npm run test:omr-app`, against a server of THIS tree
   (tests/engrave/tools/with-port.js: PPP_PORT=8801 NODE_ENV=production node server.js).

   The helper is stood in for in the page (PPP.Import.health / .recognise return the pages the engine would have written: pages made by
   tests/omr/normalize/lib.js the way Audiveris was seen to split them), so what runs is the page's own Import.load, mergeMusicXml,
   parseMusicXML and hand rule, with the real omr/normalize.js fetched the way the page fetches it.

   What this checks:
     - the switch: legacy by default; 'v2' remembered on this device (localStorage ppp.omr.v1) and read back after a reload; ?omr=v2 for that visit only;
       anything else (a typo, 'V2', null) is no choice: the default comes back and the remembered choice is forgotten; ?omr=bogus is ignored
     - legacy is the import as it was: omr/normalize.js is never requested, the helper's `movements` field is ignored, the returned xml IS
       mergeMusicXml of the `musicxml` field, a grand staff split into two parts has the first one silenced (hand x) as before
     - v2: every movement of the page (the old helper kept the newest file), one part of two staves for a split grand staff, a half-note
       page of divisions 0 keeps its half notes, no note is silenced (also when the parts cannot be joined), report.normalize says what was done,
       PdfLayer's per-page documents carry each page's bar count
     - v2 with an old helper (no `movements`) works from `musicxml`; a normaliser that cannot be fetched leaves the import exactly what legacy makes
     - the fixture piano-clean.png, read the two ways the engine reads it (two one-staff parts; the PDF's 16 bars of one staff), is 8 bars of two staves in v2
   ============================================================================ */
'use strict';
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const { preparePage } = require('./boot');
const L = require('./omr/normalize/lib.js');
const SC = require('./omr/normalize/scenarios.js');
const { part, doc } = L;

const URL = 'http://127.0.0.1:8777/Piano%20Coach%20App.dc.html';
const PNG = fs.readFileSync(path.join(__dirname, 'fixtures', 'piano-clean.png')).toString('base64');
const errors = [];
const ok = (name, cond, detail) => {
  console.log((cond ? '  ✓ ' : '  ✗ ') + name + (detail ? ' — ' + detail : ''));
  if (!cond) errors.push(name + (detail ? ' — ' + detail : ''));
};

/* ---- the pages an engine would write ---- */
const mv1 = doc([part('P1', SC.series(0, 3, SC.rhBar, SC.first({ clefs: ['G'] })), { div: 2 }), part('P2', SC.series(0, 3, SC.lhBar, SC.first({ clefs: ['F'] })), { div: 2 })]);
const mv2 = doc([part('P1', [SC.restBar(SC.first({ clefs: ['G'] })), SC.restBar(), SC.restBar()], { div: 2 }), part('P2', [SC.restBar(SC.first({ clefs: ['F'] })), SC.restBar(), SC.restBar()], { div: 2 }),
  part('P3', SC.series(3, 6, SC.grandBar, SC.grandFirst()), { div: 2, staved: true })]);
const split = { ok: true, engine: 'Audiveris', pages: [{ index: 0, ok: true }], musicxml: [mv2], movements: [[mv1, mv2]] };             /* two movements; the old field is the newest file */
const pairOnly = doc([part('P1', SC.series(0, 4, SC.rhBar, SC.first({ clefs: ['G'] })), { div: 2 }), part('P2', SC.series(0, 4, SC.lhBar, SC.first({ clefs: ['F'] })), { div: 2 })]);
const pairBody = { ok: true, engine: 'Audiveris', pages: [{ index: 0, ok: true }], musicxml: [pairOnly], movements: [[pairOnly]] };
const trio = doc([part('P1', SC.series(0, 4, SC.rhBar, SC.first({ clefs: ['G'] })), { div: 2 }), part('P2', SC.series(0, 4, SC.lhBar, SC.first({ clefs: ['F'] })), { div: 2 }),
  part('P3', SC.series(0, 4, SC.rhBar, SC.first({ clefs: ['G'] })), { div: 2 })]);
const trioBody = { ok: true, engine: 'Audiveris', pages: [{ index: 0, ok: true }], musicxml: [trio], movements: [[trio]] };
const halves = doc([part('P1', [
  '<measure number="1" width="200"><attributes><divisions>0</divisions><time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes>' +
  '<note><pitch><step>E</step><octave>5</octave></pitch><duration>1</duration><voice>1</voice><type>half</type><staff>1</staff></note><note><pitch><step>G</step><octave>5</octave></pitch><duration>1</duration><voice>1</voice><type>half</type><staff>1</staff></note>' +
  '<backup><duration>2</duration></backup><note><pitch><step>C</step><octave>3</octave></pitch><duration>2</duration><voice>5</voice><type>whole</type><staff>2</staff></note></measure>',
  '<measure number="2" width="200"><note><pitch><step>F</step><octave>5</octave></pitch><duration>1</duration><voice>1</voice><type>half</type><staff>1</staff></note><note><pitch><step>A</step><octave>5</octave></pitch><duration>1</duration><voice>1</voice><type>half</type><staff>1</staff></note>' +
  '<backup><duration>2</duration></backup><note><pitch><step>D</step><octave>3</octave></pitch><duration>2</duration><voice>5</voice><type>whole</type><staff>2</staff></note></measure>'])]);
const halvesBody = { ok: true, engine: 'Audiveris', pages: [{ index: 0, ok: true }], musicxml: [halves], movements: [[halves]] };
const twoPages = { ok: true, engine: 'Audiveris', pages: [{ index: 0, ok: true }, { index: 1, ok: true }], musicxml: [mv1, pairOnly], movements: [[mv1], [pairOnly]] };
/* the fixture as the PDF reads it: one part of one staff, four systems G F G F of four bars (tests/fixtures/piano-clean.pdf through pdf.js, Audiveris 5.11) */
const pdfRead = doc([part('P1', [
  SC.rhBar(0, { div: 1, key: 0, time: [4, 4], clefs: ['G'], print: true }), SC.rhBar(1), SC.rhBar(2), SC.rhBar(3),
  SC.lhBar(0, { clefs: ['F'], time: [4, 4], newSystem: true }), SC.lhBar(1), SC.lhBar(2), SC.lhBar(3),
  SC.rhBar(4, { clefs: ['G'], time: [4, 4], newSystem: true }), SC.rhBar(5), SC.rhBar(6), SC.rhBar(7),
  SC.lhBar(4, { clefs: ['F'], time: [4, 4], newSystem: true }), SC.lhBar(5), SC.lhBar(6), SC.lhBar(7)], { div: 1 })]);
const pdfBody = { ok: true, engine: 'Audiveris', pages: [{ index: 0, ok: true }], musicxml: [pdfRead], movements: [[pdfRead]] };

/* in the page: stand in for the helper, run the real Import.load on the fixture PNG, summarise what comes out */
async function importWith(page, body, mode) {
  return page.evaluate(async (body, mode, png) => {
    const I = window.PPP.Import;
    I.health = async () => ({ ok: true, audiveris: true });
    I.recognise = async () => JSON.parse(JSON.stringify(body));
    window.PPP.omr = mode;
    const bin = atob(png), bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    try {
      const r = await I.load(new File([bytes], 'page.png', { type: 'image/png' }), null, { cancelled: false });
      const s = r.score, hands = {};
      s.notes.forEach(n => { if (!n.rest) hands[n.hand] = (hands[n.hand] || 0) + 1; });
      return { ok: true, bars: s.measures.length, staves: s.staves, notes: s.notes.filter(n => !n.rest).length, hands: hands, xml: r.musicxml,
        normalize: r.report.normalize ? { counts: r.report.normalize.counts, notes: r.report.normalize.notes, bars: r.report.normalize.bars } : null,
        mergedLegacy: I.mergeMusicXml(body.musicxml), lengths: s.notes.filter(n => !n.rest).map(n => Math.round(n.dur * 100) / 100).slice(0, 6) };
    } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
  }, body, mode, PNG);
}

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const fresh = async (url, intercept) => {
    const page = await browser.newPage();
    await preparePage(page);
    page.on('pageerror', e => errors.push('[pageerror] ' + e.message));
    const asked = [];
    if (intercept) {
      await page.setRequestInterception(true);
      page.on('request', req => { const u = req.url(); if (/omr\/normalize\.js/.test(u)) { asked.push(u); if (intercept === 'block') return req.abort('failed'); } req.continue(); });
    } else page.on('request', req => { if (/omr\/normalize\.js/.test(req.url())) asked.push(req.url()); });
    await page.goto(url || URL, { waitUntil: 'networkidle2', timeout: 60000 });
    await page.waitForFunction(() => window.PPP && window.PPP.Import && window.PPP.Import.load, { timeout: 30000 });
    return { page, asked };
  };

  /* ---------------------------------------------------------------- the switch */
  console.log('PPP.omr, the switch');
  {
    const { page } = await fresh();
    const v = await page.evaluate(() => {
      const out = {};
      out.first = window.PPP.omr;
      window.PPP.omr = 'v2'; out.v2 = window.PPP.omr; out.stored = localStorage.getItem('ppp.omr.v1');
      window.PPP.omr = 'V2'; out.upper = window.PPP.omr; out.afterUpper = localStorage.getItem('ppp.omr.v1');
      window.PPP.omr = 'v2'; window.PPP.omr = null; out.nulled = window.PPP.omr; out.afterNull = localStorage.getItem('ppp.omr.v1');
      window.PPP.omr = 'legacy'; out.legacy = window.PPP.omr; out.legacyStored = localStorage.getItem('ppp.omr.v1');
      window.PPP.omr = 'v2'; window.PPP.omr = 'banana'; out.banana = window.PPP.omr; out.afterBanana = localStorage.getItem('ppp.omr.v1');
      window.PPP.omr = 'v2';
      return out;
    });
    ok('a fresh page is legacy', v.first === 'legacy');
    ok("'v2' is accepted and remembered", v.v2 === 'v2' && v.stored === 'v2');
    ok("'V2' is no choice: the default comes back and the remembered choice is forgotten", v.upper === 'legacy' && v.afterUpper === null, JSON.stringify([v.upper, v.afterUpper]));
    ok('null is no choice', v.nulled === 'legacy' && v.afterNull === null);
    ok("'legacy' is a choice and is remembered", v.legacy === 'legacy' && v.legacyStored === 'legacy');
    ok('a typo is no choice', v.banana === 'legacy' && v.afterBanana === null);
    await page.reload({ waitUntil: 'networkidle2' });
    await page.waitForFunction(() => window.PPP && window.PPP.Import, { timeout: 30000 });
    ok("a remembered 'v2' is v2 after a reload", await page.evaluate(() => window.PPP.omr) === 'v2');
    await page.evaluate(() => { window.PPP.omr = null; });
    await page.close();
    const q = await fresh(URL + '?omr=v2');
    ok('?omr=v2 is v2 for that visit', await q.page.evaluate(() => window.PPP.omr) === 'v2');
    ok('... and is not remembered', await q.page.evaluate(() => localStorage.getItem('ppp.omr.v1')) === null);
    await q.page.close();
    const b = await fresh(URL + '?omr=bogus');
    ok('?omr=bogus is ignored', await b.page.evaluate(() => window.PPP.omr) === 'legacy');
    await b.page.close();
  }

  /* ---------------------------------------------------------------- legacy: the import as it was */
  console.log('legacy: the import as it was');
  {
    const { page, asked } = await fresh();
    const a = await importWith(page, split, 'legacy');
    ok('legacy import of a page the engine split into two movements works', a.ok, a.error);
    ok('the helper\'s `movements` are ignored: only the newest file is read (3 bars)', a.bars === 3, 'bars ' + a.bars);
    ok('the returned xml is mergeMusicXml of the `musicxml` field, byte for byte', a.xml === a.mergedLegacy);
    ok('no report.normalize', a.normalize === null);
    const p = await importWith(page, pairBody, 'legacy');
    ok('two parts of one staff: the hand rule plays the last and silences the first (today\'s behaviour)', p.hands.x === 16 && p.hands.r === 8 && !p.hands.l, JSON.stringify(p.hands));
    ok('omr/normalize.js was never asked for', asked.length === 0 && await page.evaluate(() => !window.PPPOmrNormalize), JSON.stringify(asked));
    const h = await importWith(page, halvesBody, 'legacy');
    ok('divisions 0 is read as 1 (every half note a quarter) as before', h.ok && h.lengths.slice(0, 3).sort((a, b) => a - b).join() === '1,1,2', JSON.stringify(h.lengths));
    await page.close();
  }

  /* ---------------------------------------------------------------- v2 */
  console.log("v2: keep what the engine read");
  {
    const { page, asked } = await fresh();
    const a = await importWith(page, split, 'v2');
    ok('v2 import of the two movements works', a.ok, a.error);
    ok('every movement is kept: 6 bars of two staves', a.bars === 6 && a.staves === 2, JSON.stringify([a.bars, a.staves]));
    ok('every note is played and none is silenced', a.notes === 36 && !a.hands.x && a.hands.r === 24 && a.hands.l === 12, JSON.stringify(a.hands));
    ok('omr/normalize.js was asked for once', asked.length === 1, JSON.stringify(asked));
    ok('report.normalize says what it did', a.normalize && a.normalize.counts.movementsJoined === 1 && a.normalize.counts.partsMerged >= 1 && a.normalize.bars === 6, JSON.stringify(a.normalize));
    const p = await importWith(page, pairBody, 'v2');
    ok('two parts of one staff are one piano: 4 bars of two staves, nothing silenced', p.bars === 4 && p.staves === 2 && !p.hands.x && p.hands.r === 16 && p.hands.l === 8, JSON.stringify(p));
    const t = await importWith(page, trioBody, 'v2');
    ok('parts that cannot be joined keep their parts, but no staff is silent (top staff right, the others left)', t.ok && !t.hands.x && t.hands.r > 0 && t.hands.l > 0, JSON.stringify(t.hands));
    const l = await importWith(page, trioBody, 'legacy');
    ok('the control: legacy silences the first two of them', l.hands.x > 0, JSON.stringify(l.hands));
    const h = await importWith(page, halvesBody, 'v2');
    ok('divisions 0: the half notes stay half notes (2 quarters), the whole note 4', h.ok && h.lengths.slice(0, 3).sort((a, b) => a - b).join() === '2,2,4', JSON.stringify(h.lengths));
    ok('... and the report says it repaired them', h.normalize && h.normalize.counts.divisionsRepaired === 1);
    const two = await importWith(page, twoPages, 'v2');
    ok('two pages, the second split differently: 3 + 4 bars in one part', two.bars === 7 && two.staves === 2 && !two.hands.x, JSON.stringify([two.bars, two.staves, two.hands]));
    const old = await importWith(page, { ok: true, engine: 'Audiveris', pages: pairBody.pages, musicxml: [pairOnly] }, 'v2');
    ok('an old helper (no `movements`) is read from `musicxml`', old.bars === 4 && old.staves === 2 && !old.hands.x, JSON.stringify([old.bars, old.staves, old.hands]));
    const pd = await importWith(page, pdfBody, 'v2');
    ok('the PDF read as 16 bars of one staff is 8 bars of two staves (issue 12)', pd.bars === 8 && pd.staves === 2 && !pd.hands.x && pd.notes === 48, JSON.stringify([pd.bars, pd.staves, pd.hands, pd.notes]));
    /* the per-page documents PdfLayer.apply counts bars in */
    const docs = await page.evaluate(async (body) => {
      const omr = JSON.parse(JSON.stringify(body));
      const xml = await window.PPP.Import.omrXml(omr);
      const counts = omr.musicxml.map(d => (d ? new DOMParser().parseFromString(d, 'application/xml').querySelector('part').querySelectorAll('measure').length : 0));
      return { counts, whole: new DOMParser().parseFromString(xml, 'application/xml').querySelector('part').querySelectorAll('measure').length };
    }, twoPages);
    ok('PdfLayer\'s per-page documents carry each page\'s bar count', docs.counts.join() === '3,4' && docs.whole === 7, JSON.stringify(docs));
    await page.close();
  }

  /* ---------------------------------------------------------------- the normaliser cannot be fetched */
  console.log('v2 with a normaliser that cannot be fetched');
  {
    const { page, asked } = await fresh(URL, 'block');
    const a = await importWith(page, split, 'v2');
    ok('the import is what legacy makes (3 bars, the returned xml is mergeMusicXml of `musicxml`)', a.ok && a.bars === 3 && a.xml === a.mergedLegacy && a.normalize === null, JSON.stringify([a.ok, a.bars, a.error]));
    ok('it asked', asked.length >= 1);
    await page.close();
  }

  await browser.close();
  console.log(errors.length ? '\n' + errors.length + ' FAILED:\n  ' + errors.join('\n  ') : '\nall passed');
  process.exit(errors.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
