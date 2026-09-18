/* ============================================================================
   ALIGNMENT — notes that sound together are drawn together.

   The practice engine works from onsets: where in the bar a note starts. The
   engraving used to work from written lengths, laying each note after the
   last by the size of its glyph. When the two disagreed the picture was wrong
   and the timing right, so a left-hand chord that sounds with one right-hand
   note was drawn under another, and a player following the page was marked
   wrong for doing what it showed.

   This checks every beat where both hands start a note, on the demo and on a
   file written badly on purpose (a quarter where an eighth belongs, a printed
   dot) — the kind of thing an OMR pass or a careless export produces.
   ========================================================================== */

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const { preparePage } = require('./boot');

const URL = 'http://127.0.0.1:8777/Piano%20Coach%20App.dc.html';
const TOLERANCE_PX = 4;
const errors = [];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ok = (name, cond, detail) => {
  console.log((cond ? '  ✓ ' : '  ✗ ') + name + (detail ? ' — ' + detail : ''));
  if (!cond) errors.push(name + (detail ? ' — ' + detail : ''));
};

/* Practice, found by its own label rather than by any word that happens to
   appear in another item's description. */
const openPractice = page => page.evaluate(() => {
  const b = [...document.querySelectorAll('aside nav button')]
    .find(x => /^(Practice|연습)$/.test(((x.innerText || '').trim().split('\n')[0] || '').trim()));
  if (b) b.click();
  return !!b;
});

/* For every bar|beat where staff 1 and staff 2 both start a note, how far
   apart are their note heads drawn? */
const measure = page => page.evaluate(() => {
  const svg = document.querySelector('.ppp-staffwrap svg');
  if (!svg) return null;
  const at = {};
  svg.querySelectorAll('g.ppp-note[data-onset]').forEach(g => {
    const [m, beat, staff] = g.getAttribute('data-onset').split('|');
    const h = g.querySelector('.vf-notehead') || g;
    const bb = h.getBBox();
    (at[m + '|' + beat] = at[m + '|' + beat] || {})[staff] = bb.x + bb.width / 2;
  });
  const shared = Object.keys(at).filter(k => at[k]['1'] != null && at[k]['2'] != null);
  const gaps = shared.map(k => ({ k: k, dx: Math.abs(at[k]['1'] - at[k]['2']) }))
    .sort((a, b) => b.dx - a.dx);
  return { shared: shared.length, worst: gaps[0] || null, gaps: gaps };
});

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await preparePage(page);
  await page.setViewport({ width: 1600, height: 1000 });
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(e.message));

  /* ---------- the demo ---------- */
  console.log('\n── the demo ───────────────────────────');
  await page.evaluateOnNewDocument(() => { try { localStorage.removeItem('ppp.state.v2'); } catch (e) {} });
  await page.goto(URL, { waitUntil: 'networkidle2' });
  await page.waitForFunction(() => window.PPP && window.PPP.buildDemoScore, { timeout: 25000 });
  await sleep(1200);

  /* the model itself: no voice may hold more time than its bar */
  const overfull = await page.evaluate(() => {
    const sc = PPP.buildDemoScore();
    const out = [];
    sc.measures.forEach(mm => {
      const byVoice = {};
      PPP.Score.notesIn(sc, mm.number, mm.number).forEach(n => {
        if (n.chord) return;
        const k = n.staff + ':' + n.voice;
        byVoice[k] = (byVoice[k] || 0) + n.dur;
      });
      Object.keys(byVoice).forEach(k => { if (byVoice[k] > mm.lenQ + 1e-6) out.push(mm.number + ' ' + k + ' ' + byVoice[k]); });
    });
    return out;
  });
  ok('every demo voice fits its bar', overfull.length === 0,
    overfull.length ? overfull.slice(0, 3).join(', ') : 'no bar holds more than four beats');

  ok('the Practice screen opens', await openPractice(page));
  await sleep(3500);
  const demo = await measure(page);
  ok('the score is engraved', !!demo && demo.shared > 0, demo ? demo.shared + ' beats where both hands start' : 'no staff');
  if (demo) {
    const off = demo.gaps.filter(g => g.dx > TOLERANCE_PX);
    ok('both hands are drawn together wherever they sound together', off.length === 0,
      off.length ? off.length + ' misaligned, e.g. bar|beat ' + off[0].k + ' by ' + off[0].dx.toFixed(1) + 'px'
        : 'worst ' + (demo.worst ? demo.worst.dx.toFixed(1) : 0) + 'px across ' + demo.shared);
    const bar3 = demo.gaps.filter(g => g.k.indexOf('3|') === 0);
    ok('bar 3, beat 3: the left-hand chord sits under E, not F',
      bar3.length === 2 && bar3.every(g => g.dx <= TOLERANCE_PX),
      bar3.map(g => 'beat ' + (+g.k.split('|')[1] + 1) + ' ' + g.dx.toFixed(1) + 'px').join(', '));
  }

  /* ---------- a file written badly on purpose ---------- */
  console.log('\n── a mis-written file ─────────────────');
  const xml = fs.readFileSync(path.join(__dirname, 'fixtures', 'sloppy-lengths.musicxml'), 'utf8');
  /* Stored the way the app stores an imported score, so it loads without
     depending on the upload screen. The demo page is closed first: left open,
     its own debounced save could land after this one and put the demo back. */
  const saved = await page.evaluate(x => JSON.stringify({ score: PPP.parseMusicXML(x, 'sloppy-lengths.musicxml') }), xml);
  await page.close();
  const page2 = await browser.newPage();
  await page2.evaluateOnNewDocument(s => { try { localStorage.setItem('ppp.state.v2', s); } catch (e) {} }, saved);
  await preparePage(page2);
  await page2.setViewport({ width: 1600, height: 1000 });
  page2.on('pageerror', e => pageErrors.push(e.message));
  await page2.goto(URL, { waitUntil: 'networkidle2' });
  await page2.waitForFunction(() => window.PPP && window.PPP.Score, { timeout: 25000 });
  await sleep(1200);
  await openPractice(page2);
  await sleep(3500);
  const title = await page2.evaluate(() => (document.querySelector('main') || document.body).innerText.indexOf('Sloppy Lengths') > -1);
  ok('the mis-written file is the score on screen', title);
  const bad = await measure(page2);
  ok('it is engraved', !!bad && bad.shared > 0, bad ? bad.shared + ' beats where both hands start' : 'no staff');
  if (bad) {
    const off = bad.gaps.filter(g => g.dx > TOLERANCE_PX);
    ok('a quarter written where an eighth belongs does not push the right hand late',
      !bad.gaps.some(g => g.k.indexOf('1|') === 0 && g.dx > TOLERANCE_PX),
      bad.gaps.filter(g => g.k.indexOf('1|') === 0).map(g => 'beat ' + (+g.k.split('|')[1] + 1) + ' ' + g.dx.toFixed(1) + 'px').join(', '));
    ok('a printed dot is counted in the spacing',
      !bad.gaps.some(g => g.k.indexOf('2|') === 0 && g.dx > TOLERANCE_PX),
      bad.gaps.filter(g => g.k.indexOf('2|') === 0).map(g => 'beat ' + (+g.k.split('|')[1] + 1) + ' ' + g.dx.toFixed(1) + 'px').join(', '));
    ok('nothing misaligned anywhere in the file', off.length === 0,
      off.length ? off.map(g => g.k + ' ' + g.dx.toFixed(1) + 'px').join(', ') : 'all within ' + TOLERANCE_PX + 'px');
  }
  await page2.evaluate(() => { try { localStorage.removeItem('ppp.state.v2'); } catch (e) {} });

  ok('no page errors', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | ') || 'clean');

  await browser.close();
  console.log('\n────────────────────────────────────────');
  if (errors.length) {
    console.log(errors.length + ' PROBLEM(S):');
    errors.forEach(e => console.log('  ✗ ' + e));
    process.exit(1);
  }
  console.log('What sounds together is drawn together.');
})().catch(e => { console.error(e); process.exit(1); });
