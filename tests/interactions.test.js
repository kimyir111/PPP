const puppeteer = require('puppeteer');
const { preparePage } = require('./boot');

const URL = 'http://127.0.0.1:8777/Piano%20Coach%20App.dc.html';
const errors = [];
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* Click the first element whose trimmed text matches, within an optional root selector. */
async function clickText(page, text, opts) {
  const o = opts || {};
  const ok = await page.evaluate((t, sel, exact) => {
    const root = sel ? document.querySelector(sel) : document;
    if (!root) return false;
    const els = [...root.querySelectorAll('button, a, label')];
    const hit = els.find(e => {
      const s = (e.innerText || e.textContent || '').trim();
      return exact ? s === t : s.indexOf(t) > -1;
    });
    if (!hit) return false;
    hit.click();
    return true;
  }, text, o.root || null, o.exact !== false);
  return ok;
}

async function readText(page, needle) {
  return page.evaluate(n => {
    const el = [...document.querySelectorAll('*')].find(e =>
      e.children.length === 0 && (e.textContent || '').trim() === n);
    return el ? el.textContent.trim() : null;
  }, needle);
}

/* Header crumb tells us which screen is mounted. */
const screenTitle = page => page.evaluate(() => {
  const h = document.querySelector('header div div');
  return h ? h.textContent.trim() : null;
});

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await preparePage(page);
  await page.setViewport({ width: 1440, height: 950 });

  page.on('console', m => {
    if (m.type() === 'error' || m.type() === 'warning') errors.push('[console.' + m.type() + '] ' + m.text());
  });
  page.on('pageerror', e => errors.push('[pageerror] ' + e.message));
  page.on('requestfailed', r => errors.push('[requestfailed] ' + r.url() + ' — ' + (r.failure() || {}).errorText));

  const steps = [];
  const step = (name, detail) => { steps.push({ name, detail }); console.log('  ✓ ' + name + (detail ? ' — ' + detail : '')); };

  await page.goto(URL, { waitUntil: 'networkidle2', timeout: 45000 });
  await page.waitForFunction(() => document.querySelectorAll('aside nav button').length >= 6, { timeout: 25000 });
  step('app booted', 'sidebar rendered');

  /* ---------- 1. main navigation ---------- */
  const navItems = ['Home', 'My Songs', 'Practice', 'Sight Reading', 'Progress', 'Settings'];
  for (const item of navItems) {
    const ok = await clickText(page, item, { root: 'aside nav' });
    if (!ok) { errors.push('nav item not found: ' + item); continue; }
    await sleep(160);
    const title = await screenTitle(page);
    step('nav → ' + item, 'title "' + title + '"');
  }

  /* ---------- 2. song-flow navigation ---------- */
  const flows = ['Upload', 'AI Analysis', 'Practice Plan', 'Measure Loop', 'Memory Mode', 'Empty state', 'Loading & errors'];
  for (const f of flows) {
    const ok = await clickText(page, f, { root: 'aside' });
    if (!ok) { errors.push('flow item not found: ' + f); continue; }
    await sleep(160);
    step('flow → ' + f, 'title "' + (await screenTitle(page)) + '"');
  }

  /* ---------- 3. upload → analysis ---------- */
  await clickText(page, 'Upload', { root: 'aside' });
  await sleep(150);
  const ranAnalysis = await clickText(page, 'Run analysis') || await clickText(page, 'See analysis');
  step('upload screen analyze button', ranAnalysis ? 'clicked' : 'NOT FOUND');
  await sleep(1200);

  /* ---------- 4. practice transport ---------- */
  await clickText(page, 'Practice', { root: 'aside nav' });
  await sleep(200);

  const beatNow = () => page.evaluate(() => {
    const el = [...document.querySelectorAll('span')].find(e => /^Measure \d+ · beat \d$/.test((e.textContent || '').trim()));
    return el ? el.textContent.trim() : null;
  });

  const b0 = await beatNow();
  await clickText(page, 'Play');
  await sleep(1400);
  const b1 = await beatNow();
  step('Play advances playhead', b0 + '  →  ' + b1);
  if (b0 === b1) errors.push('playhead did not advance after Play');

  await clickText(page, 'Pause');
  await sleep(120);
  const b2 = await beatNow();
  await sleep(700);
  const b3 = await beatNow();
  step('Pause halts playhead', b2 + '  →  ' + b3);
  if (b2 !== b3) errors.push('playhead kept moving after Pause');

  await clickText(page, 'Restart');
  await sleep(150);
  step('Restart', await beatNow());

  /* tempo */
  const tempoBefore = await page.evaluate(() => {
    const i = document.querySelector('input[type=range]');
    return i ? i.value : null;
  });
  await page.evaluate(() => {
    const i = document.querySelector('input[type=range]');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(i, '60');
    i.dispatchEvent(new Event('change', { bubbles: true }));
    i.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await sleep(200);
  const tempoLabel = await page.evaluate(() => {
    const el = [...document.querySelectorAll('span')].find(e => /BPM$/.test((e.textContent || '').trim()));
    return el ? el.textContent.trim() : null;
  });
  step('tempo change', tempoBefore + ' → ' + tempoLabel);
  if (!/60 BPM/.test(tempoLabel || '')) errors.push('tempo did not update to 60 BPM (got ' + tempoLabel + ')');

  /* hands */
  for (const hand of ['Right', 'Left', 'Both Hands']) {
    const ok = await clickText(page, hand);
    await sleep(140);
    if (!ok) errors.push('hand tab not found: ' + hand); else step('hand → ' + hand);
  }

  /* practice / memory switching — scoped to main so the sidebar flow link can't shadow it */
  for (const mode of ['Memory', 'Practice']) {
    const ok = await clickText(page, mode, { root: 'main' });
    await sleep(140);
    if (!ok) errors.push('mode tab not found: ' + mode); else step('mode → ' + mode);
  }

  /* loop range steppers */
  const loopLabel = () => page.evaluate(() => {
    const el = [...document.querySelectorAll('button')].find(e => /^Loop \d+ → \d+$/.test((e.textContent || '').trim()));
    return el ? el.textContent.trim() : null;
  });
  const l0 = await loopLabel();
  await page.evaluate(() => {
    const row = [...document.querySelectorAll('main div')].find(d => /Measures/.test(d.textContent || '') && d.querySelectorAll('button').length === 4);
    if (row) row.querySelectorAll('button')[3].click();
  });
  await sleep(180);
  const l1 = await loopLabel();
  step('loop range stepper', l0 + '  →  ' + l1);
  if (l0 === l1) errors.push('loop range did not change via stepper');

  await clickText(page, 'Metronome');
  await sleep(120);
  step('metronome toggle');
  await clickText(page, 'Guidance on') || await clickText(page, 'Guidance off');
  await sleep(120);
  step('guidance toggle');

  /* ---------- 5. measure loop screen ---------- */
  await clickText(page, 'Measure Loop', { root: 'aside' });
  await sleep(200);
  const cells = await page.evaluate(() => document.querySelectorAll('button[title^="Measure "]').length);
  step('measure strip', cells + ' cells');
  if (cells !== 64) errors.push('expected 64 measure cells, found ' + cells);

  await page.evaluate(() => {
    const c = document.querySelectorAll('button[title^="Measure "]');
    c[9].click();
  });
  await sleep(150);
  await page.evaluate(() => {
    const c = document.querySelectorAll('button[title^="Measure "]');
    c[15].click();
  });
  await sleep(180);
  const loopTitle = await page.evaluate(() => {
    const h = document.querySelector('h1');
    return h ? h.textContent.trim() : null;
  });
  step('measure-strip loop select', loopTitle);
  if (!/10.*16/.test(loopTitle || '')) errors.push('measure strip did not set loop 10–16 (got ' + loopTitle + ')');

  /* ---------- 6. progress updates during the flow ---------- */
  await clickText(page, 'Progress', { root: 'aside nav' });
  await sleep(200);
  const readStat = () => page.evaluate(() => {
    const tiles = [...document.querySelectorAll('section > div')];
    const t = tiles.find(d => /Song Progress/.test(d.textContent || ''));
    if (!t) return null;
    const m = (t.textContent || '').match(/(\d+)%/);
    return m ? +m[1] : null;
  });
  const p0 = await readStat();
  const sectionAcc = () => page.evaluate(() => {
    /* the map meta now leads with a learning state, so match the number loosely */
    const m = document.body.innerText.match(/Measures 21–28\s*\n?\s*[\w \-]*\s*(\d+)%/);
    return m ? +m[1] : null;
  });
  const a0 = await sectionAcc();
  const attemptsOf = m => page.evaluate(n => {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem('ppp.state.v2')); } catch (e) {}
    const bm = saved && saved.history ? saved.history.byMeasure : {};
    return bm[n] ? bm[n].attempts : 0;
  }, String(m));
  const att0 = await attemptsOf(21);
  const untouched0 = await attemptsOf(45);

  /* Loop a single weak measure so laps complete fast enough to observe. */
  await clickText(page, 'Measure Loop', { root: 'aside' });
  await sleep(200);
  await page.evaluate(() => {
    const c = document.querySelectorAll('button[title^="Measure "]');
    c[20].click(); c[20].click();
  });
  await sleep(200);
  await clickText(page, '100%');
  await sleep(150);
  await clickText(page, 'Play');
  await sleep(10000);
  await clickText(page, 'Pause');
  await sleep(300);

  await clickText(page, 'Progress', { root: 'aside nav' });
  await sleep(250);
  const p1 = await readStat();
  const a1 = await sectionAcc();
  step('song progress after a practice run', p0 + '%  →  ' + p1 + '%');
  step('drilled section 21–28 accuracy', a0 + '%  →  ' + a1 + '%');
  if (p0 == null || p1 == null) errors.push('could not read Song Progress stat');
  if (a0 == null || a1 == null) errors.push('could not read section accuracy');

  /* Only the bar that was actually drilled gains attempts. The section number
     barely moves when you practise one measure of eight — that is the point of
     measuring per measure rather than per section. */
  await sleep(700);                       /* let the persist debounce flush */
  const att1 = await attemptsOf(21);
  const untouched1 = await attemptsOf(45);
  step('drilled measure records the practice', 'measure 21: ' + att0 + ' → ' + att1 + ' attempts');
  step('undrilled measure is left alone', 'measure 45: ' + untouched0 + ' → ' + untouched1 + ' attempts');
  if (!(att1 > att0)) errors.push('drilling measure 21 recorded no new attempts (' + att0 + ' → ' + att1 + ')');
  if (untouched1 !== untouched0) errors.push('measure 45 changed without being played');

  /* ---------- 7. memory progression ---------- */
  await clickText(page, 'Memory Mode', { root: 'aside' });
  await sleep(250);
  /* The visibility read-out is the exact MEM_VIS label beside the memory prompt. */
  const VIS = ['100% visible', '75% visible', '50% visible', 'notes hidden', 'no sheet music', 'measure revealed'];
  const visibility = () => page.evaluate(v => {
    const el = [...document.querySelectorAll('span')].find(e => v.indexOf((e.textContent || '').trim()) > -1);
    return el ? el.textContent.trim() : null;
  }, VIS);
  /* Target the mode buttons by their unique descriptions — the journey rail has its
     own buttons labelled "Memory", "Fade" and "Recall" that would otherwise match. */
  /* Deep memory work is gated on the passage being stable, so measures 21–28
     (weak in the demo) must refuse Recall and Blind Play. */
  const lockedNote = await page.evaluate(() =>
    [...document.querySelectorAll('main button')].filter(b => /Needs stable practice first/.test(b.innerText || '')).length);
  step('unstable passage locks deep memory modes', lockedNote + ' of 4 modes locked');
  if (lockedNote !== 2) errors.push('expected Recall and Blind Play locked for a weak passage, got ' + lockedNote);

  /* Now move to a section that has earned memory work and walk the levels. */
  await clickText(page, 'Measure Loop', { root: 'aside' });
  await sleep(350);
  await page.evaluate(() => {
    const c = document.querySelectorAll('button[title^="Measure "]');
    c[0].click(); c[7].click();          /* measures 1–8 */
  });
  await sleep(300);
  await clickText(page, 'Memory Mode', { root: 'aside' });
  await sleep(400);

  const MODES = [
    ['Guided', 'Full sheet music visible'],
    ['Assisted Memory', 'Some notes hidden'],
    ['Recall', 'Measure numbers only'],
    ['Blind Play', 'Sheet music hidden']
  ];
  const levels = [];
  for (const [m, desc] of MODES) {
    const ok = await clickText(page, desc, { root: 'main', exact: false });
    await sleep(200);
    const v = await visibility();
    levels.push(m + '=' + v);
    if (!ok) errors.push('memory mode not found: ' + m);
    if (!v) errors.push('no visibility label for memory mode ' + m);
  }
  if (new Set(levels.map(l => l.split('=')[1])).size < 4) errors.push('memory modes did not change sheet visibility: ' + levels.join(' | '));
  step('memory progression', levels.join(' | '));

  const hiddenStaff = await page.evaluate(() => /Sheet music hidden/.test(document.body.innerText));
  step('blind play hides sheet music', hiddenStaff ? 'yes' : 'NO');
  if (!hiddenStaff) errors.push('Blind Play did not hide the sheet music');

  await clickText(page, 'Starting note', { root: 'main' });
  await sleep(250);
  const assistLine = await page.evaluate(() => (document.body.innerText.match(/Assistance:[^\n]+/) || [''])[0]);
  step('using a hint is recorded as assistance', assistLine);
  if (!/hint/.test(assistLine)) errors.push('using a hint was not reflected in the assistance line');

  /* The panel must state the goal and the assistance in force. Actual
     memorization is proven in tests/memory.test.js. */
  const panel = await page.evaluate(() => document.body.innerText);
  const hasGoal = /recall/i.test(panel) || /Memorized/.test(panel);
  const hasAssist = /Assistance:/.test(panel);
  step('memory panel states goal and assistance',
    (hasGoal ? 'goal shown' : 'NO goal') + ', ' + (hasAssist ? 'assistance shown' : 'NO assistance'));
  if (!hasGoal) errors.push('memory panel does not state the next goal');
  if (!hasAssist) errors.push('memory panel does not state the assistance level');

  /* ---------- 8. plan / songs / sight reading / settings ---------- */
  await clickText(page, 'Practice Plan', { root: 'aside' });
  await sleep(200);
  const planPct = () => page.evaluate(() => {
    const m = document.body.innerText.match(/Plan progress\s*(\d+)%/);
    return m ? +m[1] : null;
  });
  const pp0 = await planPct();
  await page.evaluate(() => {
    const t = [...document.querySelectorAll('button')].find(b => /Full song/.test(b.textContent || ''));
    if (t) t.click();
  });
  await sleep(220);
  const pp1 = await planPct();
  step('plan task toggle', pp0 + '%  →  ' + pp1 + '%');
  if (pp0 === pp1) errors.push('plan progress did not change when ticking a task');

  await clickText(page, 'My Songs', { root: 'aside nav' });
  await sleep(200);
  await page.evaluate(() => {
    const i = document.querySelector('input[type=search]');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(i, 'satie');
    i.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await sleep(250);
  const cardCount = await page.evaluate(() => document.body.innerText.match(/Gymnop/) ? 1 : 0);
  step('song search filter', cardCount ? 'matched Gymnopédie' : 'NO match');

  await clickText(page, 'Sight Reading', { root: 'aside nav' });
  await sleep(200);
  const q0 = await page.evaluate(() => (document.body.innerText.match(/Question (\d+) of 10/) || [])[1]);
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find(x => /^[CDEFG]$/.test((x.textContent || '').trim()));
    if (b) b.click();
  });
  await sleep(1300);
  const q1 = await page.evaluate(() => (document.body.innerText.match(/Question (\d+) of 10/) || [])[1]);
  step('sight-reading quiz advances', 'Q' + q0 + ' → Q' + q1);
  if (q0 === q1) errors.push('quiz did not advance after answering');

  await clickText(page, 'Settings', { root: 'aside nav' });
  await sleep(200);
  const themeBefore = await page.evaluate(() => document.querySelector('[data-app]').getAttribute('data-app'));
  await page.evaluate(() => {
    const rows = [...document.querySelectorAll('div')].filter(d => /Dark mode/.test(d.textContent || ''));
    const row = rows[rows.length - 1];
    const btn = row && row.closest('div[style*="display: flex"]');
    const b = [...document.querySelectorAll('button')].filter(x => (x.textContent || '').trim() === '');
    if (b.length) b[b.length - 1].click();
  });
  await sleep(220);
  const themeAfter = await page.evaluate(() => document.querySelector('[data-app]').getAttribute('data-app'));
  step('settings toggle', 'theme ' + themeBefore + ' → ' + themeAfter);

  /* ---------- report ---------- */
  console.log('\n────────────────────────────────────────');
  console.log(steps.length + ' interaction checks completed.');
  if (errors.length) {
    console.log('\n' + errors.length + ' PROBLEM(S):');
    [...new Set(errors)].forEach(e => console.log('  ✗ ' + e));
  } else {
    console.log('No console errors, page errors, or failed requests.');
  }
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})().catch(e => { console.error('HARNESS FAILURE:', e); process.exit(2); });
