/* G9 single-note hands packet switch (docs/GOALS/G09 section 12 "G9 single-note hands (post user review 5)"): `--single-note-hands` of review/build.js
   (candidates `singleNoteHands`: no two-note chord in either hand at ANY stage, G9 arm only). On a real hymn whose default G9 arm is a stage-4 candidate
   with dyads (pass-me-not at 3.87): with the flag the G9 arm has no multi-note hand onset in the packet data and no two-notehead column in the drawn SVG;
   the legacy arm is identical with and without it; the flag is in the key and nowhere in the packet. The DOM part is skipped if puppeteer cannot be found. */
'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { REPO, tmpDir } = require('./helpers.js');
const { buildPacket } = require(path.join(REPO, 'review/build.js'));
const { arrangeItem } = require(path.join(REPO, 'review/lib/arrange.js'));
const NEUTRAL = require(path.join(REPO, 'review/lib/neutral.js'));

function findPuppeteer() {
  for (const p of ['puppeteer', 'D:/PPP/node_modules/puppeteer', path.join(REPO, 'node_modules', 'puppeteer')]) {
    try { return require(p); } catch (e) { /* next */ }
  }
  return null;
}
const puppeteer = findPuppeteer();
const skip = puppeteer ? false : 'puppeteer is not installed';

const ITEM = { file: 'catalog/hymns/pass-me-not.musicxml', targetLevel: 3.87, handProfile: 'large' };
const SEED = 'single-note-seed-0123456789-abc';
let on, off, arrOn, arrOff, browser;
before(async () => {
  on = await buildPacket({ mode: 'h9', seed: SEED, out: path.join(tmpDir('sn-on'), 'p'), keyOut: path.join(tmpDir('sn-onk'), 'key'), items: [ITEM], cache: new Map(), singleNoteHands: true });
  off = await buildPacket({ mode: 'h9', seed: SEED, out: path.join(tmpDir('sn-off'), 'p'), keyOut: path.join(tmpDir('sn-offk'), 'key'), items: [ITEM], cache: new Map() });
  arrOn = await arrangeItem(ITEM, { singleNoteHands: true });
  arrOff = await arrangeItem(ITEM, {});
  if (puppeteer) browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
});
after(async () => { if (browser) await browser.close(); });

/* onsets at which a written hand (staff 1 = right, 2 = left) sounds two or more notes, from the packet's own note list (wire-score notes with staff) */
function multiOnsets(arr) {
  const nn = NEUTRAL.neutralNotes(arr.measures, arr.g9.notes);
  const start = []; let acc = 0; arr.measures.forEach(m => { start.push(acc); acc += m.lenQ; });
  const ns = nn.map(n => ({ on: start[n.m - 1] + n.b, off: start[n.m - 1] + n.b + n.dur, staff: n.staff, tieStop: n.tieStop }));
  const out = { LH: 0, RH: 0 };
  [...new Set(ns.map(n => Math.round(n.on * 1000)))].map(x => x / 1000).forEach(t => [[1, 'RH'], [2, 'LH']].forEach(([st, h]) => {
    const att = ns.filter(n => n.staff === st && Math.abs(n.on - t) < 1e-6 && !n.tieStop);
    if (!att.length) return;
    if (ns.filter(n => n.staff === st && n.on <= t + 1e-6 && n.off > t + 1e-6).length >= 2) out[h]++;
  }));
  return out;
}

test('data: with the flag the G9 arm has no multi-note hand onset; without it this hymn has (the control)', () => {
  assert.deepEqual(multiOnsets(arrOn), { LH: 0, RH: 0 });
  const c = multiOnsets(arrOff);
  assert.ok(c.LH + c.RH > 0, 'control: the default G9 arm of this item holds two-note chords (' + JSON.stringify(c) + ')');
  assert.notDeepEqual(arrOn.g9.notes, arrOff.g9.notes);
});

test('the legacy arm is identical with and without the flag; the key records the flag and the packet never does', () => {
  assert.equal(JSON.stringify(arrOn.legacy), JSON.stringify(arrOff.legacy));
  assert.equal(JSON.stringify(arrOn.measures), JSON.stringify(arrOff.measures));
  const kOn = JSON.parse(fs.readFileSync(on.files.key, 'utf8')), kOff = JSON.parse(fs.readFileSync(off.files.key, 'utf8'));
  assert.equal(kOn.singleNoteHands, true); assert.equal(kOff.singleNoteHands, false);
  const id = Object.keys(kOn.items)[0], arm = kOn.items[id].X === 'legacy' ? 'X' : 'Y';
  for (const f of ['index.html', 'manifest.json']) {
    const t = fs.readFileSync(path.join(on.outDir, f), 'utf8');
    assert.ok(!/singleNote|single-note|single_note|handMaxNotes|maxNotes/i.test(t), f + ' names the flag');
  }
  assert.ok(arm === 'X' || arm === 'Y');
});

/* the drawn SVG of the G9 side: columns (one staff row, one x) holding two or more noteheads */
async function dyadColumns(packet, key) {
  const page = await browser.newPage();
  await page.setViewport({ width: 400, height: 900 });
  await page.goto(pathToFileURL(packet.files.html).href, { waitUntil: 'load' });
  const id = Object.keys(key.items)[0], side = key.items[id].X === 'g9' ? 'X' : 'Y';
  const res = await page.evaluate((id, side) => {
    const panel = document.querySelectorAll('article[data-item="' + id + '"] .panel')[side === 'X' ? 0 : 1];
    const svg = [...panel.querySelectorAll('.paper svg')].find(s => s.getBoundingClientRect().width > 0);
    const heads = [...svg.querySelectorAll('use.vf-notehead:not(.vf-rest)')].map(e => e.getBoundingClientRect()).filter(r => r.width > 0);
    const rows = []; [...svg.querySelectorAll('path.vf-stave')].forEach(s => { const r = s.getBoundingClientRect(), cy = r.top + r.height / 2; if (!rows.some(y => Math.abs(y - cy) < 2)) rows.push(cy); });
    const hw = heads[0].width, cells = new Map();
    heads.forEach(r => {
      const cy = r.top + r.height / 2, cx = r.left + r.width / 2;
      let row = 0, bd = 1e9; rows.forEach((y, i) => { if (Math.abs(y - cy) < bd) { bd = Math.abs(y - cy); row = i; } });
      let key = null; for (const k of cells.keys()) { const [rr, xx] = k.split('|'); if (+rr === row && Math.abs(+xx - cx) <= 0.45 * hw) { key = k; break; } }
      if (!key) { key = row + '|' + cx; cells.set(key, 0); }
      cells.set(key, cells.get(key) + 1);
    });
    let multi = 0; cells.forEach(n => { if (n >= 2) multi++; });
    return { heads: heads.length, multi: multi };
  }, id, side);
  await page.close();
  return res;
}

test('DOM: with the flag the drawn G9 side has no column with two noteheads; without it this hymn does (the control)', { skip }, async () => {
  const a = await dyadColumns(on, JSON.parse(fs.readFileSync(on.files.key, 'utf8')));
  const b = await dyadColumns(off, JSON.parse(fs.readFileSync(off.files.key, 'utf8')));
  assert.ok(a.heads > 50);
  assert.equal(a.multi, 0);
  assert.ok(b.multi > 0, 'control: ' + b.multi);
});
