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
