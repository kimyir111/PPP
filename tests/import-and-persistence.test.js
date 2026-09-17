const puppeteer = require('puppeteer');
const { preparePage } = require('./boot');
const fs = require('fs');
const path = require('path');

const URL = 'http://127.0.0.1:8777/Piano%20Coach%20App.dc.html';
const SHOTS = path.join(__dirname, '.shots');
const errors = [];
const sleep = ms => new Promise(r => setTimeout(r, ms));

const clickText = (page, text, root) => page.evaluate((t, sel) => {
  const r = sel ? document.querySelector(sel) : document;
  if (!r) return false;
  const hit = [...r.querySelectorAll('button, a, label')].find(e => (e.innerText || '').trim().indexOf(t) > -1);
  if (!hit) return false;
  hit.click();
  return true;
}, text, root || null);

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await preparePage(page);
  await page.setViewport({ width: 1500, height: 1000, deviceScaleFactor: 1 });
  page.on('console', m => { if (m.type() === 'error') errors.push('[console] ' + m.text()); });
  page.on('pageerror', e => errors.push('[pageerror] ' + e.message));
  page.on('requestfailed', r => errors.push('[requestfailed] ' + r.url()));
  page.on('response', r => { if (r.status() >= 400) errors.push('[http ' + r.status() + '] ' + r.url()); });

  const step = (n, d) => console.log('  ✓ ' + n + (d ? ' — ' + d : ''));

  await page.goto(URL, { waitUntil: 'networkidle2', timeout: 45000 });
  await page.waitForFunction(() => document.querySelectorAll('aside nav button').length >= 6, { timeout: 25000 });

  /* ---------- 1. an unsupported file is refused, clearly ---------- */
  const tmp = path.join(__dirname, 'moonlight-sonata.pdf');
  fs.writeFileSync(tmp, Buffer.alloc(287000, 1));
  await clickText(page, 'Upload', 'aside');
  await sleep(200);
  await clickText(page, 'Show drop zone');   /* mounts the file input */
  await sleep(200);
  let input = await page.$('input[type=file]');
  if (!input) { errors.push('file input not found on upload screen'); }
  else {
    await input.uploadFile(tmp);
    await sleep(400);
    const shown = await page.evaluate(() => document.body.innerText);
    const okName = /moonlight-sonata\.pdf/.test(shown);
    step('unsupported file accepted for upload', okName ? 'filename shown' : 'FILENAME MISSING');
    if (!okName) errors.push('uploaded filename not displayed');

    /* PDFs are supported now, so this one is refused for being corrupt rather
       than for being a PDF — and it must still say why and what to do next. */
    await clickText(page, 'Run analysis');
    await sleep(2500);
    const msg = await page.evaluate(() => (document.querySelector('main') || document.body).innerText);
    const refused = /could not be opened|corrupt|password|could not be read|no musical notation|could not reach/i.test(msg);
    const nextStep = /MusicXML|clearer|re-export|npm run omr/i.test(msg);
    step('a corrupt PDF is refused with a reason',
      (refused ? 'reason given' : 'NO REASON') + ', ' + (nextStep ? 'next step offered' : 'NO NEXT STEP'));
    if (!refused) errors.push('a corrupt PDF did not produce a clear reason');
    if (!nextStep) errors.push('a corrupt PDF refusal offered no next step');
  }

  /* ---------- 2. a real MusicXML file imports end to end ---------- */
  await clickText(page, 'Show drop zone');
  await sleep(250);
  input = await page.$('input[type=file]');
  if (!input) { errors.push('file input missing for the MusicXML import'); }
  else {
    await input.uploadFile('D:/PPP/samples/prelude-fragment.musicxml');
    await sleep(400);
    const ran = await clickText(page, 'Run analysis');
    if (!ran) errors.push('Run analysis button missing after MusicXML upload');
    await page.waitForFunction(() => /See analysis/.test(document.body.innerText), { timeout: 15000 })
      .catch(() => errors.push('MusicXML import never completed (no "See analysis" CTA)'));
    const summary = await page.evaluate(() => (document.body.innerText.match(/Parsed [^\n]+/) || ['?'])[0]);
    step('MusicXML imported', summary);
  }

  await clickText(page, 'See analysis');
  await sleep(300);
  const onAnalysis = await page.evaluate(() => /Your song is ready/.test(document.body.innerText));
  step('analysis screen reached', onAnalysis ? 'yes' : 'NO');
  if (!onAnalysis) errors.push('See analysis did not navigate to the analysis screen');

  /* ---------- 3. keyboard shortcuts ---------- */
  await clickText(page, 'Practice', 'aside nav');
  await sleep(250);
  const playing = () => page.evaluate(() => /Pause/.test(document.body.innerText));
  await page.keyboard.press('Space');
  await sleep(300);
  const p1 = await playing();
  await page.keyboard.press('Space');
  await sleep(300);
  const p2 = await playing();
  step('spacebar play/pause', p1 + ' → ' + p2);
  if (!(p1 === true && p2 === false)) errors.push('spacebar did not toggle playback (' + p1 + ',' + p2 + ')');

  /* typing in a field must not trigger shortcuts */
  await clickText(page, 'My Songs', 'aside nav');
  await sleep(250);
  await page.click('input[type=search]');
  await page.keyboard.type('a b');
  await sleep(250);
  const stillHome = await page.evaluate(() => (document.querySelector('input[type=search]') || {}).value);
  step('shortcuts ignored while typing', 'search value "' + stillHome + '"');
  if (stillHome !== 'a b') errors.push('typing in search was swallowed by shortcuts (got "' + stillHome + '")');

  /* ---------- 4. persistence across reload ---------- */
  await clickText(page, 'Practice', 'aside nav');
  await sleep(250);
  await page.evaluate(() => {
    const i = document.querySelector('input[type=range]');
    const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    s.call(i, '52');
    i.dispatchEvent(new Event('change', { bubbles: true }));
  });
  /* Wait for the value to actually reach storage rather than guessing at a
     delay. A fixed sleep passes on an idle machine and fails on a busy one,
     which is the worst way for a test to behave. */
  await page.waitForFunction(() => {
    try {
      for (let i = 0; i < localStorage.length; i++) {
        if (/"tempo":52\b/.test(localStorage.getItem(localStorage.key(i)) || '')) return true;
      }
    } catch (e) {}
    return false;
  }, { timeout: 10000 });
  await page.reload({ waitUntil: 'networkidle2' });
  await page.waitForFunction(() => document.querySelectorAll('aside nav button').length >= 6, { timeout: 25000 });
  await clickText(page, 'Practice', 'aside nav');
  await sleep(400);
  const restored = await page.evaluate(() => {
    const i = document.querySelector('input[type=range]');
    return i ? i.value : null;
  });
  step('tempo persisted across reload', restored + ' BPM');
  if (restored !== '52') errors.push('tempo did not persist across reload (got ' + restored + ')');

  /* ---------- 5. screenshots, light + dark ---------- */
  const screens = [['Home', 'home'], ['Practice', 'player'], ['Progress', 'progress']];
  const flows = [['Measure Loop', 'loop'], ['Memory Mode', 'memory'], ['Upload', 'upload']];
  for (const theme of ['light', 'dark']) {
    await page.evaluate(t => {
      const el = document.querySelector('[data-app]');
      if (el.getAttribute('data-app') !== t) {
        const b = [...document.querySelectorAll('header button')].find(x => /Light|Dark/.test(x.textContent));
        if (b) b.click();
      }
    }, theme);
    await sleep(350);
    for (const [label, id] of screens) {
      await clickText(page, label, 'aside nav');
      await sleep(400);
      await page.screenshot({ path: path.join(SHOTS, id + '-' + theme + '.png') });
    }
    for (const [label, id] of flows) {
      await clickText(page, label, 'aside');
      await sleep(400);
      await page.screenshot({ path: path.join(SHOTS, id + '-' + theme + '.png') });
    }
  }
  step('screenshots captured', fs.readdirSync(SHOTS).length + ' files');

  try { fs.unlinkSync(tmp); } catch (e) {}
  console.log('\n────────────────────────────────────────');
  if (errors.length) {
    console.log(errors.length + ' PROBLEM(S):');
    [...new Set(errors)].forEach(e => console.log('  ✗ ' + e));
  } else console.log('No console errors, page errors, or failed requests.');
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})().catch(e => { console.error('HARNESS FAILURE:', e); process.exit(2); });
