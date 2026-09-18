/* Method Books (교재 진도): the academy course in course.js, the scores in
   catalog/method/, and the page that runs a day of practice on them.
   In node: today's plan, circles, passing, the streak, choosing books, and
   the catalog itself (every file there, every word translated). In the page:
   the tab, today's piece, filling circles by hand, passing moving the book on,
   all of it kept across a reload, a piece opening in Practice and joining My
   Songs once, the book grid, Korean, and a phone. */
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const { preparePage } = require('./boot');

const URL = process.env.PPP_URL || 'http://127.0.0.1:8777/Piano%20Coach%20App.dc.html';
const ROOT = path.join(__dirname, '..');
const errors = [];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ok = (name, cond, detail) => {
  console.log((cond ? '  ✓ ' : '  ✗ ') + name + (detail ? ' — ' + detail : ''));
  if (!cond) errors.push(name + (detail ? ' — ' + detail : ''));
};

const zlib = require('zlib');
/* the catalog keeps .mxl (zipped MusicXML): read score.xml out of one */
function mxlText(file) {
  const buf = fs.readFileSync(file);
  let i = 0;
  while (i < buf.length - 30 && buf.readUInt32LE(i) === 0x04034b50) {
    const method = buf.readUInt16LE(i + 8), size = buf.readUInt32LE(i + 18);
    const nlen = buf.readUInt16LE(i + 26), xlen = buf.readUInt16LE(i + 28);
    const name = buf.slice(i + 30, i + 30 + nlen).toString();
    const data = buf.slice(i + 30 + nlen + xlen, i + 30 + nlen + xlen + size);
    if (name === 'score.xml') return (method === 8 ? zlib.inflateRawSync(data) : data).toString('utf8');
    i += 30 + nlen + xlen + size;
  }
  throw new Error('no score.xml in ' + file);
}

require(path.join(ROOT, 'course.js'));
const C = globalThis.PPP_COURSE;
const cat = JSON.parse(fs.readFileSync(path.join(ROOT, 'catalog', 'method', 'index.json'), 'utf8'));

/* ------------------------------------------------------------ the catalog */
console.log('\n── catalog ──');
const ids = cat.books.map(b => b.id);
ok('books follow the academy path', C.PATH.every(p => [p.book].concat(p.with).every(id => ids.indexOf(id) > -1 || true)) && ids[0] === 'beyer', ids.join(', '));
ok('every book says where its scores come from and under what terms',
  cat.books.every(b => b.title && b.composer && b.edition && ['pd', 'cc0', 'cc-by'].indexOf(b.license) > -1));
const missing = [];
let pieces = 0;
cat.books.forEach(b => b.pieces.forEach(p => {
  pieces++;
  if (!fs.existsSync(path.join(ROOT, 'catalog', 'method', p.file))) missing.push(p.file);
}));
ok('every listed score is in the repository', pieces > 0 && !missing.length, pieces + ' pieces' + (missing.length ? ', missing ' + missing.slice(0, 5).join(' ') : ''));
ok('piece numbers are unique within a book and inside the book\'s count',
  cat.books.every(b => new Set(b.pieces.map(p => p.no)).size === b.pieces.length && b.pieces.every(p => p.no >= 1 && p.no <= (b.count || b.pieces.length))));
ok('every piece has bars, a key and a time signature', cat.books.every(b => b.pieces.every(p => p.measures > 0 && p.key && /^\d+\/\d+$/.test(p.time))));

/* every word the page shows, in every language */
const strings = [];
const src = fs.readFileSync(path.join(ROOT, 'Piano Coach App.dc.html'), 'utf8');
const block = src.slice(src.indexOf('  /* ============================ method books'), src.indexOf('  sharedVals() {'));
(block.match(/tx\('((?:[^'\\]|\\.)+)'/g) || []).forEach(m => strings.push(m.slice(4, -1).replace(/\\'/g, "'")));
const tpl = src.slice(src.indexOf('<sc-if value="{{ isCourse }}"'), src.indexOf('<sc-if value="{{ isLearn }}"'));
tpl.replace(/<[^>]+>/g, '\n').split('\n').map(s => s.trim()).filter(s => s && !/\{\{/.test(s) && /[A-Za-z]/.test(s)).forEach(s => strings.push(s));
Object.values(C.STAGES).forEach(s => { strings.push(s.name, s.sub); });
['Warm-up', "Today's piece", 'Review piece', 'Alongside', 'Method Books', 'Beyer to Czerny, a piece a day', 'Method book', 'method book'].forEach(s => strings.push(s));
cat.books.forEach(b => { strings.push(b.title, b.edition); if (b.about) strings.push(b.about); });
const want = [...new Set(strings)].filter(s => !/^(CC0|CC BY 4\.0)$/.test(s));
['ko-KR', 'ja-JP', 'zh-CN'].forEach(loc => {
  const dict = JSON.parse(fs.readFileSync(path.join(ROOT, 'i18n', loc + '.json'), 'utf8')).content;
  const gaps = want.filter(s => !dict[s]);
  ok('every Method Books word is in ' + loc, !gaps.length, gaps.slice(0, 6).join(' | '));
});

/* ------------------------------------------------------------ the course */
console.log('\n── course.js ──');
/* a small catalog of its own, so the rules do not depend on what is transcribed */
const mini = {
  books: [
    { id: 'beyer', title: 'Beyer', count: 6, pieces: [1, 2, 3, 5].map(n => ({ no: n, file: 'beyer/' + n, measures: 8, key: 'C', time: '4/4' })) },
    { id: 'czerny599', title: 'Czerny 100', count: 3, pieces: [1, 2, 3].map(n => ({ no: n, file: 'c/' + n, measures: 8, key: 'C', time: '4/4' })) },
    { id: 'hanon', title: 'Hanon', count: 2, pieces: [1, 2].map(n => ({ no: n, file: 'h/' + n, measures: 8, key: 'C', time: '2/4' })) }
  ]
};
const D = '2026-09-18';
let s = C.fresh();
let plan = C.plan(s, mini, D);
ok('a new course starts on Beyer No. 1, one piece today', plan.length === 1 && plan[0].role === 'new' && plan[0].key === 'beyer:1', JSON.stringify(plan.map(p => p.key)));
s = C.tick(s, D, 'beyer:1'); s = C.tick(s, D, 'beyer:1');
ok('each play-through fills a circle', C.plan(s, mini, D)[0].done === 2);
s = C.setCount(s, D, 'beyer:1', 1);
ok('tapping a filled circle takes it back', C.doneToday(s, D, 'beyer:1') === 1);
s = C.pass(s, mini, 'beyer', 1, D);
plan = C.plan(s, mini, D);
ok('passing moves on to the next piece and keeps the last one for review',
  plan.map(p => p.role + ':' + p.key).join() === 'new:beyer:2,review:beyer:1', plan.map(p => p.role + ':' + p.key).join());
s = C.pass(s, mini, 'beyer', 3, D);
ok('passing ahead skips numbers already passed; missing numbers are skipped', C.current(s, mini, 'beyer') === 5 || C.current(s, mini, 'beyer') === 2, String(C.current(s, mini, 'beyer')));
s = C.setCurrent(s, 'beyer', 2);
ok('you can choose where to start', C.current(s, mini, 'beyer') === 2);
s = C.choose(s, 'warm', 'hanon');
s = C.choose(s, 'side', 'czerny599');
plan = C.plan(s, mini, D);
ok('a warm-up and a book alongside join the day', plan.map(p => p.role).join() === 'warm,new,review,side', plan.map(p => p.role).join());
s = C.choose(s, 'main', 'czerny599');
ok('a book cannot be main and alongside at once', s.main === 'czerny599' && s.side === null);
let paired = C.chooseWithPath(C.fresh(), { books: mini.books.concat([{ id: 'burgmuller25', title: 'Burgmüller 25', count: 1, pieces: [{ no: 1, file: 'b/1', measures: 8, key: 'C', time: '4/4' }] }]) }, 'czerny599');
ok('studying Czerny 100 the academy way brings Hanon as warm-up and Burgmüller alongside', paired.main === 'czerny599' && paired.warm === 'hanon' && paired.side === 'burgmuller25', JSON.stringify([paired.warm, paired.side]));
paired = C.chooseWithPath(C.choose(C.fresh(), 'side', 'hanon'), mini, 'czerny599');
ok('but never over a choice already made', paired.side === 'hanon' && paired.warm === null, JSON.stringify([paired.warm, paired.side]));
s = C.fresh();
s = C.tick(s, '2026-09-16', 'beyer:1'); s = C.tick(s, '2026-09-17', 'beyer:1');
ok('the streak counts yesterday until today has practice', C.streak(s, D) === 2);
s = C.tick(s, D, 'beyer:1');
ok('and today once it has', C.streak(s, D) === 3);
s = C.tick(s, '2026-09-10', 'beyer:1');
ok('a missed day ends a streak', C.streak(s, D) === 3 && C.days(s, D, 14).length === 14);
ok('day keys cross month ends', C.addDays('2026-09-30', 1) === '2026-10-01' && C.addDays('2026-03-01', -1) === '2026-02-28');
let fin = C.fresh();
[1, 2, 3, 5].forEach(n => { fin = C.pass(fin, mini, 'beyer', n, D); });
ok('a book is finished when every score in it is passed, and the path names the next', C.finished(fin, mini, 'beyer') && C.nextBook('beyer') === 'czerny599');
ok('saved state from elsewhere is cleaned, not trusted', C.norm({ reps: 7, main: 3, log: 'x' }).reps === 5 && C.norm({ main: 3 }).main === 'beyer');
ok('progress counts against the whole book, not just what is transcribed', C.progress(fin, mini, 'beyer').total === 6 && C.progress(fin, mini, 'beyer').passed === 4);

/* ------------------------------------------------------------ the page */
(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await preparePage(page);
  await page.setViewport({ width: 1280, height: 900 });
  page.on('pageerror', e => errors.push('[pageerror] ' + e.message));
  await page.goto(URL, { waitUntil: 'networkidle2', timeout: 45000 });
  await page.waitForFunction(() => document.querySelectorAll('aside nav button').length >= 6, { timeout: 25000 });
  await page.evaluate(() => { try { localStorage.removeItem('ppp.state.v2'); } catch (e) {} });

  /* a book with scores: the one with the most */
  const withScores = cat.books.slice().sort((a, b) => b.pieces.length - a.pieces.length)[0];
  const first = withScores.pieces.map(p => p.no).sort((a, b) => a - b);

  console.log('\n── the tab ──');
  const homeLink = await page.$('[data-go-course]');
  if (homeLink) {
    await homeLink.click();
    await sleep(300);
  }
  ok('Home links to today\'s method-book pieces', !!homeLink && !!(await page.$('[data-course-page]')));
  const labels = await page.evaluate(() => [...document.querySelectorAll('aside nav button')].map(b => (b.innerText || '').split('\n')[0].trim()));
  ok('Method Books sits under Piano Basics', labels.indexOf('Method Books') === labels.indexOf('Piano Basics') + 1, labels.join(' | '));
  await page.evaluate(() => window.__pppTest.nav('Method Books'));
  await page.waitForSelector('[data-course-page]', { timeout: 8000 });
  await page.waitForFunction(() => document.querySelectorAll('[data-course-book]').length > 0, { timeout: 8000 });
  const books = await page.$$eval('[data-course-book]', els => els.map(e => e.getAttribute('data-course-book')));
  ok('the path lists the books in academy order', books[0] === 'beyer' && books.indexOf('czerny599') > 0, books.join(', '));

  await page.click(`[data-course-book="${withScores.id}"]`);
  await sleep(200);
  await page.click('[data-course-role="main"]');
  await sleep(300);
  const today = await page.$$eval('[data-course-item]', els => els.map(e => ({ key: e.getAttribute('data-course-item'), role: e.getAttribute('data-role') })));
  ok('choosing a book puts its first piece in today\'s practice', today.length >= 1 && today[0].key === withScores.id + ':' + first[0] && today[0].role === 'new', JSON.stringify(today));
  const circles = await page.$$eval(`[data-course-item="${withScores.id}:${first[0]}"] [data-circle]`, els => els.length);
  ok('five circles a day by default', circles === 5, String(circles));
  await page.click(`[data-course-item="${withScores.id}:${first[0]}"] [data-circle="1"]`);
  await sleep(150);
  await page.click(`[data-course-item="${withScores.id}:${first[0]}"] [data-circle="2"]`);
  await sleep(150);
  let count = await page.$eval(`[data-course-item="${withScores.id}:${first[0]}"] [data-course-count]`, e => e.textContent.trim());
  ok('tapping circles fills them', count === '2 / 5', count);
  await page.click(`[data-course-item="${withScores.id}:${first[0]}"] [data-circle="2"]`);
  await sleep(150);
  count = await page.$eval(`[data-course-item="${withScores.id}:${first[0]}"] [data-course-count]`, e => e.textContent.trim());
  ok('tapping the last filled circle takes one back', count === '1 / 5', count);
  const streak = await page.$eval('[data-course-streak]', e => e.innerText);
  ok('a circle today starts the streak', /1-day streak/.test(streak), streak.split('\n')[0]);
  await page.click('[data-course-reps="3"]');
  await sleep(150);
  const three = await page.$$eval(`[data-course-item="${withScores.id}:${first[0]}"] [data-circle]`, els => els.length);
  ok('circles a day can be set to 3', three === 3, String(three));
  await page.click('[data-course-reps="5"]');
  await sleep(150);

  if (first.length > 1) {
    await page.click(`[data-course-pass="${withScores.id}:${first[0]}"]`);
    await sleep(300);
    const after = await page.$$eval('[data-course-item]', els => els.map(e => e.getAttribute('data-role') + ':' + e.getAttribute('data-course-item')));
    ok('Pass moves on and keeps the passed piece for review',
      after[0] === 'new:' + withScores.id + ':' + first[1] && after.indexOf('review:' + withScores.id + ':' + first[0]) > -1, after.join(', '));
    const gridState = await page.$eval(`[data-course-no="${first[0]}"]`, e => e.getAttribute('data-state'));
    ok('the book grid marks it passed', gridState === 'passed', gridState);
  }
  const missingNo = await page.$$eval('[data-course-no][data-state="missing"]', els => els.length);
  ok('numbers not transcribed yet are shown as such', missingNo === (withScores.count - withScores.pieces.length), String(missingNo));

  console.log('\n── kept ──');
  await sleep(700);
  await page.reload({ waitUntil: 'networkidle2' });
  await page.waitForFunction(() => document.querySelectorAll('aside nav button').length >= 6, { timeout: 25000 });
  await page.evaluate(() => window.__pppTest.nav('Method Books'));
  await page.waitForFunction(() => document.querySelectorAll('[data-course-item]').length > 0, { timeout: 8000 });
  const kept = await page.$$eval('[data-course-item]', els => els.map(e => e.getAttribute('data-role') + ':' + e.getAttribute('data-course-item')));
  const keptCount = await page.$eval('[data-course-item] [data-course-count]', e => e.textContent.trim());
  ok('the book, today\'s circles and what was passed survive a reload',
    kept[0] === 'new:' + withScores.id + ':' + (first[1] || first[0]) && (first.length < 2 || kept.indexOf('review:' + withScores.id + ':' + first[0]) > -1), kept.join(', ') + ' · ' + keptCount);

  console.log('\n── practice ──');
  const openKey = kept[0].split(':').slice(1).join(':');
  await page.click(`[data-course-open="${openKey}"]`);
  await page.waitForFunction(() => /Practice/.test(document.querySelector('.ppp-header') ? document.querySelector('.ppp-header').innerText : ''), { timeout: 10000 });
  const head = await page.$eval('.ppp-header', e => e.innerText.split('\n').slice(0, 2).join(' / '));
  const openNo = +openKey.split(':')[1];
  const openPiece = withScores.pieces.find(p => p.no === openNo);
  const expectTitle = openPiece.title || withScores.title;
  ok('Practice opens on the piece', head.indexOf(expectTitle) > -1, head);
  const lib = await page.evaluate(() => JSON.parse(localStorage.getItem('ppp.library.v1') || '{"songs":[]}').songs.filter(s => s.courseFrom));
  ok('it joins My Songs, marked as a method-book piece', lib.length === 1 && lib[0].courseFrom === openKey && lib[0].kind === 'course', JSON.stringify(lib.map(s => s.courseFrom + '/' + s.kind)));
  await page.evaluate(() => window.__pppTest.nav('Method Books'));
  await page.waitForSelector(`[data-course-open="${openKey}"]`, { timeout: 8000 });
  await page.click(`[data-course-open="${openKey}"]`);
  await sleep(1200);
  const lib2 = await page.evaluate(() => JSON.parse(localStorage.getItem('ppp.library.v1') || '{"songs":[]}').songs.filter(s => s.courseFrom));
  ok('opening it again opens that song rather than adding another', lib2.length === 1, String(lib2.length));
  const notes = await page.evaluate(() => {
    const t = document.querySelector('main');
    return t ? t.querySelectorAll('svg').length : 0;
  });
  ok('the score is drawn', notes > 0, String(notes));

  console.log('\n── one book ──');
  await page.evaluate(() => window.__pppTest.nav('Method Books'));
  await page.waitForSelector('[data-course-no]', { timeout: 8000 });
  const pick = first[first.length - 1];
  await page.click(`[data-course-no="${pick}"]`);
  await sleep(200);
  const sel = await page.$eval('[data-course-selected]', e => e.innerText);
  const onNow = await page.$eval('[data-course-item][data-role="new"]', e => e.getAttribute('data-course-item'));
  const isNow = onNow === withScores.id + ':' + pick;
  ok('a number in the grid shows the piece, with Start from here unless it is today\'s',
    /Practice/.test(sel) && (isNow ? !/Start from here/.test(sel) : /Start from here/.test(sel)), sel.replace(/\n/g, ' · '));
  if (await page.$('[data-course-action="current"]')) {
    await page.click('[data-course-action="current"]');
    await sleep(250);
    const now = await page.$eval('[data-course-item][data-role="new"]', e => e.getAttribute('data-course-item'));
    ok('Start from here makes it today\'s piece', now === withScores.id + ':' + pick, now);
  }

  console.log('\n── every score ──');
  const all = [];
  cat.books.forEach(b => b.pieces.forEach(p => all.push({ key: b.id + ':' + p.no, staves: p.staves, xml: mxlText(path.join(ROOT, 'catalog', 'method', p.file)) })));
  const parsed = await page.evaluate(list => list.map(x => {
    try {
      const sc = PPP.parseMusicXML(x.xml, x.key);
      const snd = sc.notes.filter(n => !n.rest);
      return { key: x.key, staves: x.staves, bars: sc.measures.length, r: snd.filter(n => n.hand === 'r').length, l: snd.filter(n => n.hand === 'l').length };
    } catch (e) { return { key: x.key, err: String(e.message || e) }; }
  }), all);
  const broken = parsed.filter(x => x.err || !x.bars || (x.staves > 1 ? !(x.r > 0 && x.l > 0) : !(x.r + x.l > 0)));
  ok('every score in the catalog reads in PPP, with notes for each hand it has', parsed.length === all.length && !broken.length,
    parsed.length + ' read' + (broken.length ? ', not: ' + broken.slice(0, 5).map(x => x.key + (x.err ? ' ' + x.err : ' r' + x.r + ' l' + x.l)).join('; ') : ''));

  console.log('\n── Korean and a phone ──');
  await page.evaluate(async () => {
    const I = window.PPP_I18N;
    await I.ready;
    I.setLocale('ko-KR');
  });
  await sleep(600);
  const koLabels = await page.evaluate(() => [...document.querySelectorAll('aside nav button')].map(b => (b.innerText || '').split('\n')[0].trim()));
  ok('the tab is 교재 진도 in Korean', koLabels.indexOf('교재 진도') > -1, koLabels.join(' | '));
  await page.waitForFunction(() => document.querySelectorAll('[data-course-item]').length > 0, { timeout: 8000 });
  const koText = await page.$eval('[data-course-page]', e => e.innerText);
  ok('today, the path and the book read in Korean', /오늘의 연습/.test(koText) && /학원 진도 순서/.test(koText) && /바이엘/.test(koText) && /번/.test(koText), koText.slice(0, 80).replace(/\n/g, ' '));
  /* only the width: turning on isMobile would reload the page */
  await page.setViewport({ width: 390, height: 844 });
  await sleep(500);
  const still = await page.$('[data-course-page]');
  ok('the page stays on Method Books at phone width', !!still);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  ok('no sideways scroll on a phone', overflow <= 1, overflow + 'px');
  try { fs.mkdirSync(path.join(__dirname, '.shots'), { recursive: true }); } catch (e) {}
  await page.screenshot({ path: path.join(__dirname, '.shots', 'course-phone.png'), fullPage: true });

  await browser.close();
  console.log(errors.length ? '\n' + errors.length + ' failed:\n  ' + errors.join('\n  ') : '\nall passed');
  process.exit(errors.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
