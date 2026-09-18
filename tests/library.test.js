/* My Songs: adding a song keeps it, and each song keeps its own progress.

   Add a file, practise-configure it, switch to another song and back, reload,
   remove — and check what the player sees each time, not the storage. */
const puppeteer = require('puppeteer');
const { preparePage } = require('./boot');

const URL = 'http://127.0.0.1:8777/Piano%20Coach%20App.dc.html';
const SAMPLE = 'D:/PPP/samples/prelude-fragment.musicxml';
const errors = [];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ok = (name, cond, detail) => {
  console.log((cond ? '  ✓ ' : '  ✗ ') + name + (detail ? ' — ' + detail : ''));
  if (!cond) errors.push(name + (detail ? ' — ' + detail : ''));
};

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await preparePage(page);
  await page.setViewport({ width: 1500, height: 1000 });
  page.on('pageerror', e => errors.push('[pageerror] ' + e.message));
  await page.goto(URL, { waitUntil: 'networkidle2', timeout: 45000 });
  await page.waitForFunction(() => document.querySelectorAll('aside nav button').length >= 6, { timeout: 25000 });

  const cards = () => page.evaluate(async () => {
    window.__pppTest.nav('My Songs');
    await new Promise(r => setTimeout(r, 400));
    return [...document.querySelectorAll('[data-song]')].map(c => ({
      id: c.getAttribute('data-song'), current: c.getAttribute('data-current-song') === 'true',
      title: (c.querySelector('[data-no-i18n]') || {}).textContent
    }));
  });
  const title = () => page.evaluate(() => {
    window.__pppTest.nav('Practice');
    return new Promise(r => setTimeout(() => r((document.querySelector('header').innerText.split('\n')[1] || '').split(' · ')[0]), 350));
  });
  const setTempo = v => page.evaluate(async v => {
    window.__pppTest.nav('Practice');
    await new Promise(r => setTimeout(r, 300));
    const i = document.querySelector('input[type=range]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, String(v));
    i.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise(r => setTimeout(r, 200));
    return i.value;
  }, v);
  const tempo = () => page.evaluate(async () => {
    window.__pppTest.nav('Practice');
    await new Promise(r => setTimeout(r, 300));
    return (document.querySelector('input[type=range]') || {}).value;
  });

  console.log('\n── a fresh library ──');
  const c0 = await cards();
  ok('only the sample is on the shelf, no made-up songs', c0.length === 1 && c0[0].id === 'demo' && c0[0].current, c0.map(c => c.title).join(', '));
  const addCard = await page.evaluate(() => !!document.querySelector('[data-add-card]'));
  ok('My Songs offers a way to add one', addCard);

  console.log('\n── adding a song ──');
  await setTempo(60);
  await cards();
  await page.evaluate(() => document.querySelector('[data-add-card]').click());
  await sleep(300);
  const onAdd = await page.evaluate(() => !!document.querySelector('[data-add-sheet]') && !!document.querySelector('[data-youtube]'));
  ok('the add card opens the add page, with file and YouTube side by side', onAdd);
  const input = await page.$('input[type=file][data-add-file]');
  await input.uploadFile(SAMPLE);
  await page.waitForFunction(() => /See analysis/.test(document.body.innerText), { timeout: 15000 }).catch(() => errors.push('import did not finish'));
  const c1 = await cards();
  const prelude = c1.find(c => c.id !== 'demo');
  ok('the added song is kept in My Songs', c1.length === 2 && !!prelude, c1.map(c => c.title + (c.current ? ' (open)' : '')).join(', '));
  ok('and it is the one open', prelude && prelude.current && !c1.find(c => c.id === 'demo').current);
  ok('the practice page is on it', /Prelude/.test(await title()));

  console.log('\n── each song keeps its own progress ──');
  await setTempo(52);
  await cards();
  await page.evaluate(() => document.querySelector('[data-open-song="demo"]').click());
  await sleep(500);
  ok('opening the sample switches the song', /Interstellar/.test(await title()));
  const demoTempo = await tempo();
  ok('the sample has its own tempo back', demoTempo === '60', demoTempo + ' BPM (was left at 60)');
  await cards();
  await page.evaluate(id => document.querySelector('[data-open-song="' + id + '"]').click(), prelude.id);
  await sleep(500);
  const back = await tempo();
  ok('and the added song has its own', /Prelude/.test(await title()) && back === '52', back + ' BPM (was left at 52)');

  console.log('\n── across a reload ──');
  await page.waitForFunction(() => /"songId":"song-/.test(localStorage.getItem('ppp.state.v2') || ''), { timeout: 10000 }).catch(() => {});
  await page.reload({ waitUntil: 'networkidle2' });
  await page.waitForFunction(() => document.querySelectorAll('aside nav button').length >= 6, { timeout: 25000 });
  const c2 = await cards();
  ok('the shelf survives a reload', c2.length === 2 && c2.some(c => c.id === prelude.id && c.current), c2.map(c => c.title + (c.current ? ' (open)' : '')).join(', '));
  ok('with the same song open, at its tempo', /Prelude/.test(await title()) && (await tempo()) === '52');

  console.log('\n── removing ──');
  await cards();
  await page.evaluate(id => document.querySelector('[data-remove-song="' + id + '"]').click(), prelude.id);
  await sleep(200);
  const armed = await page.evaluate(id => document.querySelector('[data-remove-song="' + id + '"]').textContent.trim(), prelude.id);
  const still = await page.evaluate(() => document.querySelectorAll('[data-song]').length);
  ok('one click only asks', /Remove\?/.test(armed) && still === 2, armed);
  await page.evaluate(id => document.querySelector('[data-remove-song="' + id + '"]').click(), prelude.id);
  await sleep(400);
  const c3 = await cards();
  ok('the second removes it', c3.length === 1 && c3[0].id === 'demo', c3.map(c => c.title).join(', '));
  ok('and PPP goes back to a song that exists', c3[0].current && /Interstellar/.test(await title()));
  const noSample = await page.evaluate(() => !document.querySelector('[data-remove-song="demo"]'));
  ok('the sample cannot be removed', noSample);

  console.log('\n── a score saved before there was a library ──');
  /* the old shape is written while the app is not running — the app saves
     itself as the page goes, and would otherwise write over it */
  const oldScore = await page.evaluate(async () => {
    const xml = await (await fetch('samples/prelude-fragment.musicxml')).text();
    return Object.assign({}, window.PPP.parseMusicXML(xml, 'old.musicxml'), { _byNumber: undefined });
  });
  await page.goto('http://127.0.0.1:8777/health', { waitUntil: 'load' });
  const migrated = await page.evaluate(sc => {
    const st = JSON.parse(localStorage.getItem('ppp.state.v2') || '{}');
    st.score = sc;
    delete st.songId;
    localStorage.setItem('ppp.state.v2', JSON.stringify(st));
    localStorage.removeItem('ppp.library.v1');
    return true;
  }, oldScore);
  await page.goto(URL, { waitUntil: 'networkidle2' });
  await page.waitForFunction(() => document.querySelectorAll('aside nav button').length >= 6, { timeout: 25000 });
  const c4 = await cards();
  ok('an imported score from before is listed, not lost', migrated && c4.length === 2 && c4.some(c => c.id !== 'demo' && c.current),
    c4.map(c => c.title + (c.current ? ' (open)' : '')).join(', '));

  console.log('\n── nothing is lost to a quick reload ──');
  await page.evaluate(() => window.__pppTest.upload());
  await sleep(300);
  await (await page.$('input[type=file][data-add-file]')).uploadFile(SAMPLE);
  await page.waitForFunction(() => /See analysis/.test(document.body.innerText), { timeout: 15000 });
  /* no pause at all: the song must already be written */
  await page.reload({ waitUntil: 'networkidle2' });
  await page.waitForFunction(() => document.querySelectorAll('aside nav button').length >= 6, { timeout: 25000 });
  const quick = await cards();
  const fresh = quick.filter(c => c.id !== 'demo' && c.id !== (c4.find(x => x.id !== 'demo') || {}).id)[0];
  ok('a song added a moment before a reload is still there', !!fresh && fresh.current, quick.map(c => c.title + (c.current ? ' (open)' : '')).join(', '));
  ok('and opens', /Prelude/.test(await title()));

  await setTempo(47);
  await page.reload({ waitUntil: 'networkidle2' });      /* straight away, inside the save debounce */
  await page.waitForFunction(() => document.querySelectorAll('aside nav button').length >= 6, { timeout: 25000 });
  ok('a change made just before leaving the page is kept', (await tempo()) === '47', (await tempo()) + ' BPM (set to 47)');

  console.log('\n── a card with nothing behind it ──');
  await page.evaluate(() => {
    const lib = JSON.parse(localStorage.getItem('ppp.library.v1'));
    /* added a while ago — a song this minute's may still be being written by another tab */
    lib.songs.push({ id: 'song-ghost', title: 'Ghost Song', composer: '', kind: 'musicxml', addedAt: Date.now() - 300000, lastAt: Date.now() - 300000, prog: 0, mem: 0, measures: 4 });
    localStorage.setItem('ppp.library.v1', JSON.stringify(lib));
  });
  await page.reload({ waitUntil: 'networkidle2' });
  await page.waitForFunction(() => document.querySelectorAll('aside nav button').length >= 6, { timeout: 25000 });
  const said = await page.waitForFunction(() => /Ghost Song was not saved/.test(document.body.innerText), { timeout: 4000 }).then(() => true).catch(() => false);
  const ghost = (await cards()).some(c => c.id === 'song-ghost');
  ok('a song whose score was never saved is taken off, and PPP says so', !ghost && said);

  console.log('\n────────────────────────────────────────');
  if (errors.length) {
    console.log(errors.length + ' PROBLEM(S):');
    [...new Set(errors)].forEach(e => console.log('  ✗ ' + e));
  } else console.log('Songs you add stay, each with its own progress.');
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})().catch(e => { console.error('HARNESS FAILURE:', e); process.exit(2); });
