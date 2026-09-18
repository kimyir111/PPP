const puppeteer = require('puppeteer');
const { preparePage } = require('./boot');
const path = require('path');
const fs = require('fs');

const URL = process.env.PPP_URL || 'http://127.0.0.1:8777/Piano%20Coach%20App.dc.html';
const errors = [];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ok = (name, cond, detail) => {
  console.log((cond ? '  ✓ ' : '  ✗ ') + name + (detail ? ' — ' + detail : ''));
  if (!cond) errors.push(name + (detail ? ' — ' + detail : ''));
};

const SHOTS = path.join(__dirname, '.shots');
function shot(page, name) {
  fs.mkdirSync(SHOTS, { recursive: true });
  return page.screenshot({ path: path.join(SHOTS, name), fullPage: false });
}

async function metrics(page) {
  return page.evaluate(() => {
    const shell = document.querySelector('.ppp-shell');
    const aside = document.querySelector('aside');
    const hide = document.querySelector('[data-sidebar-toggle="hide"]');
    const show = document.querySelector('[data-sidebar-toggle="show"]');
    const main = document.querySelector('main');
    const split = document.querySelector('.ppp-split');
    const ar = aside ? aside.getBoundingClientRect() : null;
    const mr = main ? main.getBoundingClientRect() : null;
    const sr = split ? split.getBoundingClientRect() : null;
    const overflow = document.documentElement.scrollWidth > document.documentElement.clientWidth + 2;
    const showStyle = show ? getComputedStyle(show) : null;
    const splitCols = split ? getComputedStyle(split).gridTemplateColumns.split(' ').filter(Boolean).length : 0;
    return {
      collapsed: shell ? shell.getAttribute('data-sidebar-collapsed') : null,
      open: shell ? shell.getAttribute('data-sidebar-open') : null,
      asideWidth: ar ? Math.round(ar.width) : 0,
      asideLeft: ar ? Math.round(ar.left) : 0,
      asideRight: ar ? Math.round(ar.right) : 0,
      mainLeft: mr ? Math.round(mr.left) : 0,
      mainWidth: mr ? Math.round(mr.width) : 0,
      splitHeight: sr ? Math.round(sr.height) : 0,
      splitWidth: sr ? Math.round(sr.width) : 0,
      hideVisible: !!(hide && hide.getBoundingClientRect().width > 8),
      showVisible: !!(show && showStyle && showStyle.display !== 'none' && show.getBoundingClientRect().width > 8),
      overflow,
      splitCols,
      navCount: document.querySelectorAll('aside nav button').length
    };
  });
}

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await preparePage(page);
  page.on('pageerror', e => errors.push('[pageerror] ' + e.message));

  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(URL, { waitUntil: 'networkidle2', timeout: 45000 });
  await page.waitForFunction(() => document.querySelectorAll('aside nav button').length >= 6, { timeout: 25000 });
  await sleep(300);

  let m = await metrics(page);
  ok('desktop sidebar is open', m.asideWidth > 200 && m.collapsed === 'false', JSON.stringify(m));
  ok('desktop hide button is visible', m.hideVisible, 'hideVisible=' + m.hideVisible);
  ok('desktop menu button is hidden while sidebar is open', !m.showVisible, 'showVisible=' + m.showVisible);
  await shot(page, 'layout-desktop-open.png');

  await page.click('[data-sidebar-toggle="hide"]');
  await sleep(280);
  m = await metrics(page);
  ok('desktop hide collapses the sidebar', m.collapsed === 'true' && m.asideWidth < 8, JSON.stringify(m));
  ok('desktop menu button appears after hide', m.showVisible, 'showVisible=' + m.showVisible);
  ok('desktop main uses the full width once hidden', m.mainLeft < 8 && m.mainWidth > 1200, JSON.stringify(m));
  await shot(page, 'layout-desktop-hidden.png');

  await page.click('[data-sidebar-toggle="show"]');
  await sleep(280);
  m = await metrics(page);
  ok('desktop menu restores the sidebar', m.collapsed === 'false' && m.asideWidth > 200, JSON.stringify(m));

  await page.setViewport({ width: 768, height: 1024 });
  await sleep(280);
  m = await metrics(page);
  ok('tablet starts with sidebar off-canvas', m.asideRight <= 8 && m.open === 'false', JSON.stringify(m));
  ok('tablet menu button is visible', m.showVisible, 'showVisible=' + m.showVisible);
  ok('tablet page does not scroll sideways', !m.overflow, 'overflow=' + m.overflow);
  await shot(page, 'layout-tablet-closed.png');

  await page.evaluate(() => window.__pppTest.upload());
  await sleep(300);
  const picker = await page.evaluate(() => {
    const input = document.querySelector('input[type=file][data-add-file]');
    if (!input) return { error: 'no file input' };
    const s = getComputedStyle(input);
    const r = input.getBoundingClientRect();
    const title = (document.querySelector('[data-drop-zone]') || {}).innerText || '';
    return {
      accept: input.getAttribute('accept') || '',
      display: s.display,
      width: Math.round(r.width),
      height: Math.round(r.height),
      tapCopy: /Tap to add/.test(title)
    };
  });
  ok('tablet add-sheet copy is tap, not drop', picker.tapCopy, JSON.stringify(picker));
  ok('tablet file picker is a real tap target',
    !picker.error && picker.display !== 'none' && picker.width > 80 && picker.height > 80,
    JSON.stringify(picker));
  ok('tablet file picker can offer a PDF',
    picker.accept && picker.accept.indexOf('.pdf') > -1 && !/audio\/\*|video\/\*/.test(picker.accept),
    picker.accept);

  await page.evaluate(() => window.__pppTest.nav('Practice'));
  await sleep(400);
  await page.evaluate(() => { window.__pppNativeRandom = Math.random; Math.random = () => 1; });
  const play = await page.evaluate(async () => {
    const b = document.querySelector('.ppp-playbtn')
      || [...document.querySelectorAll('main button')].find(x => /^Play$/.test((x.innerText || '').trim()));
    if (!b) return { error: 'no play' };
    const r = b.getBoundingClientRect();
    b.click();
    await new Promise(res => setTimeout(res, 250));
    return {
      height: Math.round(r.height),
      label: b.textContent.trim()
    };
  });
  ok('tablet Play control is large enough to tap', play.height >= 40, JSON.stringify(play));
  ok('tablet Play starts the run', play.label === 'Pause', JSON.stringify(play));
  await sleep(500);
  const simulatedWrongKeys = await page.$$eval('.ppp-kbwrap [data-state="wrong"]', els => els.map(e => e.getAttribute('data-midi')));
  ok('automatic playback never paints written notes as wrong keys', simulatedWrongKeys.length === 0, simulatedWrongKeys.join(', ') || 'none');
  await page.evaluate(() => { Math.random = window.__pppNativeRandom; delete window.__pppNativeRandom; });
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('main button')].find(x => /^Pause$/.test((x.innerText || '').trim()));
    if (b) b.click();
  });
  await sleep(120);

  async function focusMetrics() {
    return page.evaluate(() => {
      const shell = document.querySelector('.ppp-shell');
      const staff = document.querySelector('.ppp-staffwrap');
      const now = staff && staff.querySelector('.ppp-now');
      const kb = document.querySelector('.ppp-kbwrap');
      const transport = document.querySelector('.ppp-transport');
      const sr = staff && staff.getBoundingClientRect();
      const nr = now && now.getAttribute('opacity') !== '0' ? now.getBoundingClientRect() : null;
      const kr = kb && kb.getBoundingClientRect();
      const tr = transport && transport.getBoundingClientRect();
      const ksvg = kb && kb.querySelector('svg');
      const ksr = ksvg && ksvg.getBoundingClientRect();
      const split = document.querySelector('[data-kb-split]');
      const vh = window.innerHeight, vw = window.innerWidth;
      const nowInView = !!(nr && sr && nr.top >= sr.top - 8 && nr.bottom <= sr.bottom + 8);
      return {
        focus: shell ? shell.getAttribute('data-focus') : null,
        vh, vw,
        staffH: sr ? Math.round(sr.height) : 0,
        staffTop: sr ? Math.round(sr.top) : 0,
        staffBot: sr ? Math.round(sr.bottom) : 0,
        nowTop: nr ? Math.round(nr.top) : null,
        nowBot: nr ? Math.round(nr.bottom) : null,
        nowInView,
        kbH: kr ? Math.round(kr.height) : 0,
        kbBot: kr ? Math.round(kr.bottom) : 0,
        kbSvgH: ksr ? Math.round(ksr.height) : 0,
        kbClipped: !!(kr && ksr && ksr.bottom > kr.bottom + 6),
        splitOn: !!(split && getComputedStyle(split).display !== 'none' && split.getBoundingClientRect().height > 4),
        transportBot: tr ? Math.round(tr.bottom) : 0
      };
    });
  }
  async function clickFocusLabel(label) {
    return page.evaluate(want => {
      const b = [...document.querySelectorAll('button')].find(x => (x.innerText || '').trim() === want);
      if (b) b.click();
      return !!b;
    }, label);
  }

  const entered = await clickFocusLabel('Focus');
  await sleep(900);
  let f = await focusMetrics();
  ok('tablet Focus enters focus mode', entered && f.focus === 'true', JSON.stringify(f));
  ok('tablet focus keeps the score taller than the keyboard',
    f.staffH > f.kbH && f.staffH >= Math.round(f.vh * 0.48), JSON.stringify(f));
  ok('tablet focus keeps the current bar on the score', f.nowInView, JSON.stringify(f));
  ok('tablet focus keeps the keyboard on screen',
    f.kbBot <= f.vh + 8 && f.transportBot <= f.vh + 8, JSON.stringify(f));
  ok('tablet focus has no empty band under the keyboard',
    f.vh - f.transportBot <= 24, JSON.stringify(f));
  const pan = await page.evaluate(() => {
    const wrap = document.querySelector('.ppp-staffwrap');
    const svg = wrap && wrap.querySelector('svg');
    const beatEl = [...document.querySelectorAll('span')].find(e => /^Measure \d+ · beat/.test((e.textContent || '').trim()));
    const before = beatEl ? beatEl.textContent.trim() : '';
    if (!svg) return { error: 'no svg', before };
    const r = svg.getBoundingClientRect();
    const x = r.left + Math.min(48, r.width * 0.2);
    const y = r.top + Math.min(40, r.height * 0.2);
    const fire = (type, yy) => svg.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, composed: true,
      pointerId: 7, pointerType: 'touch', isPrimary: true,
      clientX: x, clientY: yy, button: 0,
      buttons: type === 'pointerup' ? 0 : 1
    }));
    fire('pointerdown', y);
    fire('pointermove', y + 90);
    fire('pointerup', y + 90);
    const afterEl = [...document.querySelectorAll('span')].find(e => /^Measure \d+ · beat/.test((e.textContent || '').trim()));
    return {
      before,
      after: afterEl ? afterEl.textContent.trim() : '',
      canScroll: wrap.scrollHeight > wrap.clientHeight + 4,
      touchAction: getComputedStyle(svg).touchAction,
      overflowY: getComputedStyle(wrap).overflowY
    };
  });
  ok('vertical pan on the score does not seek a bar',
    !pan.error && pan.before === pan.after, JSON.stringify(pan));
  ok('focused score can scroll vertically',
    pan.canScroll && /pan-y/.test(pan.touchAction) && /auto|scroll/.test(pan.overflowY), JSON.stringify(pan));
  await shot(page, 'layout-tablet-focus.png');

  await page.setViewport({ width: 1024, height: 768 });
  await sleep(900);
  f = await focusMetrics();
  ok('tablet landscape focus still shows a tall score',
    f.focus === 'true' && f.staffH > f.kbH && f.staffH >= Math.round(f.vh * 0.45), JSON.stringify(f));
  ok('tablet landscape focus keeps the current bar on the score', f.nowInView, JSON.stringify(f));
  ok('tablet landscape focus fits the keyboard on screen',
    f.kbBot <= f.vh + 8 && f.transportBot <= f.vh + 8, JSON.stringify(f));
  ok('tablet landscape has no empty band under the keyboard',
    f.vh - f.transportBot <= 24, JSON.stringify(f));
  ok('tablet landscape shows the full keyboard, not a cropped strip',
    f.kbH >= 160 && f.kbSvgH >= 150 && !f.kbClipped, JSON.stringify(f));
  ok('tablet landscape has a keyboard resize handle', f.splitOn, JSON.stringify(f));
  await shot(page, 'layout-tablet-focus-landscape.png');

  const kbBefore = f.kbH;
  await page.evaluate(() => {
    const split = document.querySelector('[data-kb-split]');
    if (!split) return;
    const r = split.getBoundingClientRect();
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    const fire = (type, yy) => split.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, composed: true,
      pointerId: 9, pointerType: 'mouse', isPrimary: true,
      clientX: x, clientY: yy, button: 0,
      buttons: type === 'pointerup' ? 0 : 1
    }));
    fire('pointerdown', y);
    fire('pointermove', y - 50);
    fire('pointerup', y - 50);
  });
  await sleep(200);
  f = await focusMetrics();
  ok('dragging the handle enlarges the keyboard', f.kbH >= kbBefore + 20, JSON.stringify({ kbBefore, kbH: f.kbH }));

  const seeked = await page.evaluate(() => {
    const svg = document.querySelector('.ppp-staffwrap svg');
    if (!svg || !svg.__ppp || !svg.__ppp.bars) return { ok: false, why: 'no-bars' };
    const bar = (svg.__ppp.bars || []).find(b => b.m === 23) || svg.__ppp.bars[1];
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
    return { ok: true, m: bar.m };
  });
  await sleep(400);
  const afterSeek = await page.evaluate(() => {
    const beatEl = [...document.querySelectorAll('span')].find(e => /^Measure \d+ · beat/.test((e.textContent || '').trim()));
    const play = [...document.querySelectorAll('button')].find(b => /^(Play|Pause)$/.test((b.textContent || '').trim()));
    return {
      beat: beatEl ? beatEl.textContent.trim() : null,
      play: play ? play.textContent.trim() : null
    };
  });
  ok('focus tap on a bar plays from there',
    seeked.ok && afterSeek.play === 'Pause' && /^Measure 2[0-8]/.test(afterSeek.beat || ''),
    JSON.stringify({ seeked, afterSeek }));
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find(x => /^Pause$/.test((x.innerText || '').trim()));
    if (b) b.click();
  });
  await sleep(120);

  const flashed = await page.evaluate(() => {
    const app = window.PPP && window.PPP.app;
    if (!app || !app.flashMiss) return { ok: false };
    app.setState({ loop: true, toggles: Object.assign({}, app.state.toggles, { tellRight: true }) });
    app.flashMiss([60], 61);
    return { ok: true };
  });
  await sleep(80);
  const miss = await page.evaluate(() => {
    const el = document.querySelector('.ppp-miss');
    if (!el) return { on: false };
    const s = getComputedStyle(el);
    return { on: s.opacity !== '0' && el.textContent.trim().length > 0, text: el.textContent.trim() };
  });
  ok('a wrong note names the pitch that was owed',
    flashed.ok && miss.on && /C4/.test(miss.text) && /C#4/.test(miss.text), JSON.stringify(miss));

  const unnamed = await page.evaluate(() => {
    const app = window.PPP && window.PPP.app;
    app.setState({ toggles: Object.assign({}, app.state.toggles, { tellRight: false }) });
    app.flashMiss([60], 61);
    return true;
  });
  await sleep(80);
  const missOff = await page.evaluate(() => {
    const el = document.querySelector('.ppp-miss');
    return el ? el.textContent.trim() : '';
  });
  ok('Answer off keeps the miss unnamed',
    unnamed && missOff === 'Wrong note', 'text=' + missOff);

  const toggleHit = await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find(x => /Answer (on|off)/.test((x.innerText || '').trim()));
    if (!b) return { ok: false };
    b.click();
    return { ok: true, label: b.textContent.trim() };
  });
  await sleep(80);
  const afterToggle = await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find(x => /Answer (on|off)/.test((x.innerText || '').trim()));
    const app = window.PPP && window.PPP.app;
    return {
      label: b ? b.textContent.trim() : '',
      on: !!(app && app.state.toggles.tellRight !== false)
    };
  });
  ok('Answer on/off toggles from the transport',
    toggleHit.ok && afterToggle.on === true, JSON.stringify({ toggleHit, afterToggle }));

  const hid = await clickFocusLabel('Hide keys');
  await sleep(700);
  f = await focusMetrics();
  const kbHidden = await page.evaluate(() => {
    const kb = document.querySelector('.ppp-kbwrap');
    const s = kb && getComputedStyle(kb);
    return !kb || s.display === 'none' || kb.getBoundingClientRect().height < 8;
  });
  ok('tablet Hide keys hides the keyboard', hid && kbHidden, JSON.stringify(f));
  ok('tablet Hide keys gives the score most of the landscape screen',
    f.staffH >= Math.round(f.vh * 0.7), JSON.stringify(f));
  await shot(page, 'layout-tablet-focus-landscape-nokeys.png');
  await clickFocusLabel('Show keys');
  await sleep(400);

  await page.setViewport({ width: 768, height: 1024 });
  await sleep(400);
  const left = await clickFocusLabel('Leave focus');
  await sleep(400);
  f = await focusMetrics();
  ok('tablet Leave focus restores the full screen', left && f.focus === 'false', JSON.stringify(f));

  await page.click('[data-sidebar-toggle="show"]');
  await sleep(280);
  m = await metrics(page);
  ok('tablet menu opens the sidebar overlay', m.open === 'true' && m.asideWidth > 200 && m.asideLeft >= 0, JSON.stringify(m));
  await shot(page, 'layout-tablet-open.png');

  const wentHome = await page.evaluate(() => {
    const b = [...document.querySelectorAll('aside nav button')].find(x => /Home/.test(x.innerText || ''));
    if (!b) return false;
    b.click();
    return true;
  });
  await sleep(280);
  m = await metrics(page);
  ok('tablet nav click closes the overlay', wentHome && m.open === 'false' && m.asideRight <= 8, JSON.stringify(m));

  await page.setViewport({ width: 390, height: 844 });
  await sleep(280);
  await page.click('[data-sidebar-toggle="show"]');
  await sleep(280);
  m = await metrics(page);
  ok('phone menu opens overlay', m.open === 'true' && m.asideWidth > 180, JSON.stringify(m));
  await shot(page, 'layout-phone-open.png');

  const vp = page.viewport();
  await page.mouse.click(vp.width - 20, 140);
  await sleep(280);
  m = await metrics(page);
  ok('phone dimmed area closes overlay', m.open === 'false' && m.asideRight <= 8, JSON.stringify(m));

  await page.click('[data-sidebar-toggle="show"]');
  await sleep(220);
  await page.click('[data-sidebar-toggle="hide"]');
  await sleep(280);
  m = await metrics(page);
  ok('phone hide button closes overlay', m.open === 'false' && m.asideRight <= 8, JSON.stringify(m));
  ok('phone page does not scroll sideways', !m.overflow, 'overflow=' + m.overflow);
  await shot(page, 'layout-phone-closed.png');

  await page.click('[data-sidebar-toggle="show"]');
  await sleep(200);
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('aside nav button')].find(x => /Practice/.test(x.innerText || ''));
    if (b) b.click();
  });
  await sleep(400);
  m = await metrics(page);
  ok('phone practice screen stacks the coach column', m.splitCols === 1, JSON.stringify(m));
  ok('phone practice does not scroll sideways', !m.overflow, 'overflow=' + m.overflow);
  await shot(page, 'layout-phone-practice.png');

  console.log('\n────────────────────────────────────────');
  if (errors.length) {
    console.log(errors.length + ' PROBLEM(S):');
    [...new Set(errors)].forEach(e => console.log('  ✗ ' + e));
  } else {
    console.log('layout checks passed.');
  }
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})().catch(e => { console.error('HARNESS FAILURE:', e); process.exit(2); });
