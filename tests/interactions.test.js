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
  /* The design file's showcase screens ("Empty state", "Loading & errors") are
     not navigation for a player, so the sidebar only offers them under this
     flag. They are still worth walking, so this suite asks for them. */
  await page.evaluateOnNewDocument(() => {
    try { localStorage.setItem('ppp-dev', '1'); } catch (e) {}
  });
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
  const navItems = ['Home', 'My Songs', 'Analysis & Plan', 'Practice', 'Progress', 'Sight Reading', 'Settings'];
  for (const item of navItems) {
    const ok = await page.evaluate(l => window.__pppTest.nav(l), item);
    if (!ok) { errors.push('nav item not found: ' + item); continue; }
    await sleep(160);
    const title = await screenTitle(page);
    step('nav → ' + item, 'title "' + title + '"');
    if (title !== item) errors.push('nav ' + item + ' opened "' + title + '"');
  }

  /* ---------- 2. one list, and the merged places ---------- */
  /* The loop, memory, plan and upload places are no longer separate entries:
     each lives inside another page, and the sidebar says so in words. */
  const listed = await page.evaluate(() => [...document.querySelectorAll('aside button')]
    .map(b => (b.innerText || '').trim().split('\n')[0].trim()));
  const gone = ['Upload', 'AI Analysis', 'Practice Plan', 'Measure Loop', 'Memory Mode'].filter(l => listed.indexOf(l) > -1);
  step('merged places are not separate entries', gone.length ? 'still listed: ' + gone.join(', ') : 'none listed');
  if (gone.length) errors.push('sidebar still lists merged places: ' + gone.join(', '));
  const practiceSub = await page.evaluate(() => {
    const b = [...document.querySelectorAll('aside nav button')].find(x => /^Practice/.test((x.innerText || '').trim()));
    return b ? (b.innerText || '').trim().split('\n').slice(1).join(' ').trim() : '';
  });
  step('Practice says what is inside it', practiceSub);
  if (!/loop/i.test(practiceSub) || !/memori/i.test(practiceSub)) errors.push('Practice entry does not mention loop and memorize: ' + practiceSub);
  const railOrBar = await page.evaluate(() => !!document.querySelector('.ppp-rail, .ppp-nextbar'));
  if (railOrBar) errors.push('the step rail or the next-step bar is still on the page');

  /* the showcase pages are still reachable in dev mode */
  for (const f of ['Empty state', 'Loading & errors']) {
    const ok = await clickText(page, f, { root: 'aside' });
    if (!ok) { errors.push('dev page not found: ' + f); continue; }
    await sleep(160);
    step('dev → ' + f, 'title "' + (await screenTitle(page)) + '"');
  }

  /* old addresses land where that work lives now */
  for (const [label, crumb] of [['Start to finish', /Start to finish/], ['Loop a passage', /Loop a passage · Measures \d+–\d+/], ['Memorize', /Memorize · Measures \d+–\d+/]]) {
    const ok = await page.evaluate(t => window.__pppTest.practice(t), label);
    await sleep(150);
    const got = await page.evaluate(() => document.querySelector('header').innerText);
    step('practice tab → ' + label, ok ? got.split('\n').slice(0, 2).join(' / ') : 'NOT FOUND');
    if (!ok) errors.push('practice tab not found: ' + label);
    else if (!crumb.test(got)) errors.push('practice tab ' + label + ' did not show in the header: ' + got);
  }

  /* ---------- 3. upload → analysis ---------- */
  await page.evaluate(() => window.__pppTest.upload());
  await sleep(150);
  /* adding something starts reading it at once; the sample is the quickest */
  const ranAnalysis = await clickText(page, 'Use the sample');
  step('upload screen adds the sample', ranAnalysis ? 'clicked' : 'NOT FOUND');
  if (!ranAnalysis) errors.push('"Use the sample" missing on the add screen');
  await sleep(1200);
  const analysed = await page.evaluate(() => /See analysis/.test(document.body.innerText));
  step('sample read without a second click', analysed ? 'See analysis offered' : 'NO RESULT');
  if (!analysed) errors.push('adding the sample did not finish reading it');

  /* ---------- 4. practice transport ---------- */
  await page.evaluate(l => window.__pppTest.nav(l), 'Practice');
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

  /* the three ways to use the page */
  for (const tab of ['Memorize', 'Start to finish', 'Loop a passage']) {
    const ok = await page.evaluate(t => window.__pppTest.practice(t), tab);
    await sleep(140);
    if (!ok) errors.push('practice tab not found: ' + tab); else step('tab → ' + tab);
  }
  const wholeRange = await page.evaluate(async () => {
    await window.__pppTest.practice('Start to finish');
    const steppers = !![...document.querySelectorAll('main div')].find(d => /^Measures/.test((d.innerText || '').trim()) && d.querySelectorAll('button').length === 4);
    const strip = document.querySelectorAll('button[title^="Measure "]').length;
    await window.__pppTest.practice('Loop a passage');
    return { steppers, strip };
  });
  step('start to finish hides the passage tools', JSON.stringify(wholeRange));
  if (wholeRange.steppers || wholeRange.strip) errors.push('passage tools shown while playing start to finish');

  /* Clicking a bar in start-to-finish plays from that bar to the end, and
     must not switch the page into a one-bar loop. */
  await page.evaluate(() => window.__pppTest.practice('Start to finish'));
  await page.waitForFunction(() => {
    const svg = document.querySelector('.ppp-staffwrap svg');
    return !!(svg && svg.__ppp && (svg.__ppp.bars || []).some(b => b.m === 12));
  }, { timeout: 8000 });
  const seeked = await page.evaluate(() => {
    const svg = document.querySelector('.ppp-staffwrap svg');
    const bar = (svg.__ppp.bars || []).find(b => b.m === 12);
    if (!bar) return { ok: false, why: 'no-bar' };
    const pt = svg.createSVGPoint();
    pt.x = bar.x + Math.min(20, bar.w * 0.2);
    pt.y = bar.y + 40;
    const s = pt.matrixTransform(svg.getScreenCTM());
    const fire = type => svg.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, composed: true,
      pointerId: 1, pointerType: 'mouse', isPrimary: true,
      clientX: s.x, clientY: s.y, button: 0,
      buttons: type === 'pointerdown' ? 1 : 0
    }));
    fire('pointerdown');
    fire('pointerup');
    return { ok: true };
  });
  await sleep(350);
  const afterSeek = await page.evaluate(() => {
    const header = document.querySelector('header');
    const crumb = header ? header.innerText : '';
    const beatEl = [...document.querySelectorAll('span')].find(e => /^Measure \d+ · beat \d$/.test((e.textContent || '').trim()));
    const play = [...document.querySelectorAll('button')].find(b => /^(Play|Pause)$/.test((b.textContent || '').trim()));
    return {
      crumb: crumb,
      beat: beatEl ? beatEl.textContent.trim() : null,
      play: play ? play.textContent.trim() : null
    };
  });
  step('start to finish click seeks', JSON.stringify(afterSeek));
  if (!seeked.ok) errors.push('could not click measure 12 on the score');
  if (!/Start to finish/.test(afterSeek.crumb || '')) errors.push('clicking a bar left start-to-finish: ' + afterSeek.crumb);
  if (!/^Measure 12 · beat /.test(afterSeek.beat || '')) errors.push('clicking measure 12 did not move the playhead (got ' + afterSeek.beat + ')');
  if (afterSeek.play !== 'Pause') errors.push('clicking a bar did not start playback (got ' + afterSeek.play + ')');
  await sleep(1600);
  const afterRun = await page.evaluate(() => {
    const beatEl = [...document.querySelectorAll('span')].find(e => /^Measure \d+ · beat \d$/.test((e.textContent || '').trim()));
    const header = document.querySelector('header');
    return {
      beat: beatEl ? beatEl.textContent.trim() : null,
      crumb: header ? header.innerText : ''
    };
  });
  step('start to finish keeps playing past the click', JSON.stringify(afterRun));
  const mAfter = afterRun.beat && afterRun.beat.match(/^Measure (\d+)/);
  if (!mAfter || +mAfter[1] < 12) errors.push('playback did not continue from the clicked bar (got ' + afterRun.beat + ')');
  if (!/Start to finish/.test(afterRun.crumb || '')) errors.push('playback switched away from start-to-finish: ' + afterRun.crumb);
  await clickText(page, 'Pause');
  await sleep(120);
  await page.evaluate(() => window.__pppTest.practice('Loop a passage'));
  await sleep(200);

  /* loop range steppers */
  const loopLabel = () => page.evaluate(() => {
    const row = [...document.querySelectorAll('main div')].find(d => /^Measures/.test((d.innerText || '').trim()) && d.querySelectorAll('button').length === 4);
    return row ? (row.innerText || '').replace(/[−+\s]+/g, ' ').trim() : null;
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

  /* ---------- 5. picking a passage on the practice page ---------- */
  await page.evaluate(() => window.__pppTest.practice('Loop a passage'));
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
    const m = document.querySelector('header').innerText.match(/Measures \d+–\d+/);
    return m ? m[0] : null;
  });
  step('measure-strip loop select', loopTitle);
  if (!/10.*16/.test(loopTitle || '')) errors.push('measure strip did not set loop 10–16 (got ' + loopTitle + ')');

  /* ---------- 6. progress updates during the flow ---------- */
  await page.evaluate(l => window.__pppTest.nav(l), 'Progress');
  await sleep(200);
  const readStat = () => page.evaluate(() => {
    const t = document.querySelector('[data-progress-song] [data-stat="progress"]');
    if (!t) return null;
    const m = (t.textContent || '').match(/(\d+)%/);
    return m ? +m[1] : null;
  });
  const p0 = await readStat();
  const sectionAcc = () => page.evaluate(() => {
    const row = document.querySelector('[data-song-map] [data-sec="21-28"]');
    const m = row && (row.textContent || '').match(/(\d+)%/);
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
  await page.evaluate(() => window.__pppTest.practice('Loop a passage'));
  await sleep(200);
  await page.evaluate(() => {
    const c = document.querySelectorAll('button[title^="Measure "]');
    c[20].click(); c[20].click();
  });
  await sleep(200);
  await clickText(page, 'Play');
  await sleep(10000);
  await clickText(page, 'Pause');
  await sleep(300);

  await page.evaluate(l => window.__pppTest.nav(l), 'Progress');
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
  await page.evaluate(() => window.__pppTest.practice('Memorize'));
  await sleep(250);
  /* The visibility read-out is the exact MEM_VIS label beside the memory prompt. */
  const VIS = ['100% visible', '75% visible', '50% visible', 'notes hidden', 'no sheet music', 'measure revealed'];
  const visibility = () => page.evaluate(v => {
    const el = [...document.querySelectorAll('span')].find(e => v.indexOf((e.textContent || '').trim()) > -1);
    return el ? el.textContent.trim() : null;
  }, VIS);
  /* Target the level buttons by their unique descriptions. */
  /* Deep memory work is gated on the passage being stable, so measures 21–28
     (weak in the demo) must refuse Recall and Blind Play. */
  const lockedNote = await page.evaluate(() =>
    [...document.querySelectorAll('main button')].filter(b => /Needs stable practice first/.test(b.innerText || '')).length);
  step('unstable passage locks deep memory modes', lockedNote + ' of 4 modes locked');
  if (lockedNote !== 2) errors.push('expected Recall and Blind Play locked for a weak passage, got ' + lockedNote);

  /* Now move to a section that has earned memory work and walk the levels. */
  await page.evaluate(() => window.__pppTest.practice('Loop a passage'));
  await sleep(350);
  await page.evaluate(() => {
    const c = document.querySelectorAll('button[title^="Measure "]');
    c[0].click(); c[7].click();          /* measures 1–8 */
  });
  await sleep(300);
  await page.evaluate(() => window.__pppTest.practice('Memorize'));
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

  /* the score itself is gone, not just described as gone */
  const hiddenStaff = await page.evaluate(() => {
    const w = document.querySelector('.ppp-staffwrap');
    return !!w && /Sheet music hidden/.test(w.innerText || '') && !w.querySelector('.ppp-note');
  });
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
  await page.evaluate(() => window.__pppTest.nav('Analysis & Plan'));
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
  const stayed = await screenTitle(page);
  if (stayed !== 'Analysis & Plan') errors.push('ticking a plan task moved the page to ' + stayed);

  /* a task's Start opens the practice page set up for it */
  const started = await page.evaluate(async () => {
    const row = [...document.querySelectorAll('button')].find(b => /Left hand, first section/.test(b.textContent || ''));
    const start = row && row.parentElement.querySelector('button:last-child');
    if (start) start.click();
    await new Promise(r => setTimeout(r, 400));
    return { title: document.querySelector('header div div').textContent.trim(), crumb: document.querySelector('header').innerText };
  });
  step('plan task Start opens practice', started.title + ' — ' + (started.crumb.match(/Loop a passage[^\n]*/) || [''])[0]);
  if (started.title !== 'Practice' || !/Loop a passage/.test(started.crumb)) errors.push('plan Start did not open the loop tab: ' + JSON.stringify(started));

  await page.evaluate(l => window.__pppTest.nav(l), 'My Songs');
  await sleep(200);
  await page.evaluate(() => {
    const i = document.querySelector('input[type=search]');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(i, 'zimmer');
    i.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await sleep(250);
  const cardCount = await page.evaluate(() => document.querySelectorAll('[data-song]').length);
  const cardHit = await page.evaluate(() => /Interstellar Theme/.test(document.body.innerText));
  step('song search filter', cardHit ? 'matched Interstellar Theme (' + cardCount + ' card)' : 'NO match');
  if (!cardHit) errors.push('song search by composer did not find the sample');
  await page.evaluate(() => {
    const i = document.querySelector('input[type=search]');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(i, 'no such song');
    i.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await sleep(250);
  const noneLeft = await page.evaluate(() => document.querySelectorAll('[data-song]').length);
  step('song search filters out non-matches', noneLeft + ' cards');
  if (noneLeft !== 0) errors.push('song search left ' + noneLeft + ' non-matching cards');
  await page.evaluate(() => {
    const i = document.querySelector('input[type=search]');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(i, '');
    i.dispatchEvent(new Event('change', { bubbles: true }));
  });

  await page.evaluate(l => window.__pppTest.nav(l), 'Sight Reading');
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

  await page.evaluate(l => window.__pppTest.nav(l), 'Settings');
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
