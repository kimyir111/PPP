/* Piano Basics: the beginner course in lessons.js and the page that teaches it.
   The first half runs the course itself in node — every lesson well formed,
   every exercise finishable, every word translated. The second half drives
   the real page: the tab, a whole lesson by clicking, the computer keyboard,
   MIDI, the see-through hands, the staff drill, a chord, a rhythm tapped on
   time, progress kept across a reload, Korean, and a phone. */
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

/* ------------------------------------------------------------ the course */
require(path.join(ROOT, 'lessons.js'));
const C = globalThis.PPP_LESSONS;

console.log('course');
ok('twenty lessons in six units', C.LESSONS.length === 20 && C.COURSE.length === 6, C.LESSONS.length + ' / ' + C.COURSE.length);
ok('lesson ids are unique', new Set(C.LESSONS.map(l => l.id)).size === C.LESSONS.length);
ok('it starts from the keys and Do Re Mi', C.LESSONS[0].id === 'keys' && C.LESSONS[1].id === 'do' && C.LESSONS[2].id === 'doremi');

const KINDS = ['read', 'play', 'find', 'quiz', 'drill', 'rhythm', 'chord'];
const bad = [];
C.LESSONS.forEach(L => L.steps.forEach((st, i) => {
  const at = L.id + '#' + i;
  if (KINDS.indexOf(st.kind) < 0) bad.push(at + ' kind ' + st.kind);
  if (!st.title) bad.push(at + ' has no title');
  const k = C.keysFor(L, st);
  const inRange = m => m >= k.lo && m <= k.hi;
  if (st.kind === 'play' && !(st.seq && st.seq.length && st.seq.every(inRange))) bad.push(at + ' plays a key the keyboard does not show');
  if (st.kind === 'play' && st.beats && st.beats.length !== st.seq.length) bad.push(at + ' beats and notes differ');
  if (st.kind === 'chord' && !st.notes.every(inRange)) bad.push(at + ' chord off the keyboard');
  if (st.kind === 'drill' && !(st.pool.length > 1 && st.count > 0 && CLEFS(st.clef))) bad.push(at + ' drill');
  if (st.kind === 'find' && !C.targets(L, st).length) bad.push(at + ' nothing to find');
  if (st.kind === 'quiz') st.qs.forEach((q, j) => { if (!(q.answer >= 0 && q.answer < q.choices.length && q.why)) bad.push(at + ' question ' + j); });
  if (st.kind === 'rhythm' && !(C.onsets(st.pattern).length && C.length(st.pattern) % 4 === 0 && st.bpm > 0)) bad.push(at + ' rhythm');
}));
function CLEFS(c) { return c === 'treble' || c === 'bass'; }
ok('every step is well formed', !bad.length, bad.join('; '));

const songs = Object.keys(C.SONGS).map(k => [k, C.SONGS[k]]);
ok('each song has a length for every note, in whole 4/4 measures',
  songs.every(([, s]) => s.notes.length === s.beats.length && s.beats.reduce((a, b) => a + b, 0) % 4 === 0),
  songs.map(([k, s]) => k + ':' + s.notes.length + '/' + s.beats.reduce((a, b) => a + b, 0)).join(' '));
ok('the first song is Mi Re Do Re Mi Mi Mi', C.SONGS.airplane.notes.slice(0, 7).join() === '64,62,60,62,64,64,64');
ok('a written fingering has a finger for every note, and the song steps carry it',
  songs.every(([, s]) => !s.fingering || s.fingering.length === s.notes.length) &&
  C.lesson('twinkle').steps.slice(1).every(st => st.fingering && st.fingering.length === st.seq.length));
ok('Twinkle is fingered as beginner books print it', C.SONGS.twinkle.fingering.slice(0, 14).join('') === '11445543322111');

console.log('exercises');
{
  const L = C.lesson('doremi'), st = L.steps[1];
  let lx = C.fresh(st);
  lx = C.press(L, st, lx, 62);
  ok('a wrong key says what it was and what to look for', !lx.done && lx.idx === 0 && lx.tone === 'bad' && /Re/.test(lx.msg) && /Do/.test(lx.msg), lx.msg);
  [60, 62, 64].forEach(m => { lx = C.press(L, st, lx, m); });
  ok('Do Re Mi in order finishes the step', lx.done && lx.idx === 3, lx.msg);
  const reveal = C.press(L, L.steps[3], C.press(L, L.steps[3], C.fresh(L.steps[3]), 67), 65);
  ok('two slips on a no-hint step count toward showing the key', reveal.slips === 2);
}
{
  const L = C.lesson('keys'), st = L.steps[2];
  const all = C.targets(L, st);
  ok('the pairs of black keys are C♯ and D♯ in every octave', all.every(m => [1, 3].indexOf(C.pc(m)) > -1) && all.length === 6, all.join());
  let lx = C.press(L, st, C.fresh(st), 54);
  ok('a black key from a group of three is not a pair', lx.tone === 'bad' && lx.found.length === 0);
  all.forEach(m => { lx = C.press(L, st, lx, m); });
  ok('finding all of them finishes the step', lx.done, lx.msg);
}
{
  const L = C.lesson('chords'), st = L.steps[1];
  let lx = C.fresh(st);
  lx = C.press(L, st, lx, 60); lx = C.press(L, st, lx, 62);
  ok('a wrong note clears a chord half built', lx.got.length === 0 && lx.tone === 'bad');
  [67, 60, 64].forEach(m => { lx = C.press(L, st, lx, m); });
  ok('Do Mi Sol in any order is the chord', lx.done);
}
{
  const st = C.lesson('readlow').steps[1];
  let lx = C.fresh(st, () => 0.5), right = 0;
  ok('the drill starts on a note from its pool', st.pool.indexOf(lx.note) > -1, String(lx.note));
  lx = C.answer(st, lx, (C.pc(lx.note) + 2) % 12, null);
  ok('a wrong name is marked, not skipped', !lx.right && lx.wrong.length === 1);
  while (!lx.done && right < 20) {
    lx = C.answer(st, lx, C.pc(lx.note), null); right++;
    if (!lx.done) {
      const was = lx.note;
      lx = C.nextDrill(st, lx);
      if (lx.note === was) { ok('the drill never asks the same note twice in a row', false, String(was)); break; }
    }
  }
  ok('eight right answers finish the drill', lx.done && right === 8, right + ' answers');
}
{
  const st = C.lesson('octave').steps[3];
  let lx = C.choose(st, C.fresh(st), 1);
  ok('a wrong choice asks for another', !lx.right && lx.wrong.join() === '1');
  lx = C.choose(st, lx, 0);
  ok('the right choice explains why', lx.right && lx.msg === st.qs[0].why && lx.first === 0);
  lx = C.nextQuestion(st, lx);
  lx = C.choose(st, lx, st.qs[1].answer); lx = C.nextQuestion(st, lx); lx = C.choose(st, lx, st.qs[2].answer);
  ok('answering every question finishes the quiz', lx.done && lx.first === 2);
}
{
  const pat = [1, 1, -1, 1, 4];
  const ons = C.onsets(pat);
  ok('onsets skip rests', ons.map(o => o.at).join() === '0,1,3,4');
  const tol = C.tolerance(72);
  let run = { ons, hits: ons.map(() => false), tol, extra: 0 };
  [0.05, 1.1, 2.0, 3 - 0.15, 4.2].forEach(b => { run = C.tap(run, b); });
  const v = C.verdict(run);
  ok('taps near each note count; a tap on the rest does not', v.hits === 4 && v.extra === 1 && v.pass, JSON.stringify(v));
  let late = { ons, hits: ons.map(() => false), tol, extra: 0 };
  [0.6, 1.6, 3.6, 4.6].forEach(b => { late = C.tap(late, b); });
  ok('half a beat late is not on time', C.verdict(late).hits === 0 && !C.verdict(late).pass);
}
ok('the computer keyboard plays from Do: A S D F = Do Re Mi Fa', ['KeyA', 'KeyS', 'KeyD', 'KeyF'].map(c => C.codeToMidi(c, 60)).join() === '60,62,64,65');
ok('W and E are the black keys between them', C.codeToMidi('KeyW', 60) === 61 && C.codeToMidi('KeyE', 60) === 63 && C.codeToMidi('KeyQ', 60) === null);

console.log('translations');
{
  const words = new Set(C.strings());
  const src = fs.readFileSync(path.join(ROOT, 'lessons.js'), 'utf8');
  for (const m of src.matchAll(/\bt\('((?:[^'\\]|\\.)*)'/g)) words.add(m[1]);
  const app = fs.readFileSync(path.join(ROOT, 'Piano Coach App.dc.html'), 'utf8');
  const a = app.indexOf('/* ============================ piano basics'), b = app.indexOf('/* ============================ sight reading');
  ok('the page has its Piano Basics code', a > -1 && b > a);
  for (const m of app.slice(a, b).matchAll(/\btx\('((?:[^'\\]|\\.)*)'/g)) words.add(m[1]);
  ['Piano Basics', 'Step by step from Do Re Mi', 'Your course', 'How to play along', 'Practice again',
    'New to the piano? Start with Piano Basics →'].forEach(w => words.add(w));
  for (const loc of ['ko-KR', 'ja-JP', 'zh-CN']) {
    const cat = JSON.parse(fs.readFileSync(path.join(ROOT, 'i18n', loc + '.json'), 'utf8')).content;
    const missing = [...words].filter(w => !/^\d+$/.test(w) && cat[w] == null);
    ok(loc + ' has every Piano Basics word', !missing.length, missing.slice(0, 6).join(' | '));
    const holes = [...words].filter(w => cat[w] != null && (w.match(/\{\{\w+\}\}/g) || []).sort().join() !== (cat[w].match(/\{\{\w+\}\}/g) || []).sort().join());
    ok(loc + ' keeps every {{placeholder}}', !holes.length, holes.slice(0, 4).join(' | '));
  }
  const ko = JSON.parse(fs.readFileSync(path.join(ROOT, 'i18n', 'ko-KR.json'), 'utf8')).content;
  ok('Korean sings 도 레 미 파 솔 라 시', C.SOL.map(s => ko[s]).join(' ') === '도 레 미 파 솔 라 시');
}

/* ------------------------------------------------------------- the page */
(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage();
  await preparePage(page);
  page.on('pageerror', e => errors.push('[pageerror] ' + e.message));
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(URL, { waitUntil: 'networkidle2', timeout: 45000 });
  await page.waitForFunction(() => document.querySelectorAll('aside nav button').length >= 6, { timeout: 25000 });
  await page.evaluate(() => { try { localStorage.removeItem('ppp.state.v2'); } catch (e) {} });
  await page.reload({ waitUntil: 'networkidle2' });
  await page.waitForFunction(() => document.querySelectorAll('aside nav button').length >= 6, { timeout: 25000 });
  await sleep(300);

  const S = () => page.evaluate(() => {
    const s = window.PPP.app.state;
    return { screen: s.screen, lesson: s.learnLesson, step: s.learnStep, lx: s.lx, done: s.learnDone, focus: s.focus, playing: s.playing };
  });
  const next = () => page.evaluate(() => document.querySelector('[data-learn-next]').getAttribute('data-learn-next'));
  const clickNext = async () => { await page.click('[data-learn-next]'); await sleep(150); };
  const tapKey = async m => {
    await page.evaluate(m => {
      const r = document.querySelector('[data-learn-keyboard] rect[data-midi="' + m + '"]');
      r.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
    }, m);
    await sleep(60);
  };
  const feedback = () => page.$eval('[data-learn-feedback]', el => el.innerText.trim());

  console.log('the tab');
  const nav = await page.evaluate(() => [...document.querySelectorAll('aside nav button')].map(b => (b.innerText || '').trim().split('\n')[0].trim()));
  ok('Piano Basics sits right under Home', nav[0] === 'Home' && nav[1] === 'Piano Basics', nav.slice(0, 3).join(', '));
  const homeLink = await page.$('[data-go-learn]');
  ok('Home offers a way in for someone new to the piano', !!homeLink);
  await homeLink.click(); await sleep(300);
  let st = await S();
  ok('that link opens Piano Basics', st.screen === 'learn');
  const course = await page.evaluate(() => ({
    lessons: document.querySelectorAll('[data-learn-course] [data-lesson]').length,
    title: document.querySelector('[data-learn-title]').innerText.trim(),
    header: document.querySelector('.ppp-header').innerText
  }));
  ok('the course lists all twenty lessons', course.lessons === 20, String(course.lessons));
  ok('a fresh start is lesson 1', course.title === 'White keys and black keys', course.title);
  ok('the header names the page', /Piano Basics/.test(course.header));

  console.log('lesson 1, by clicking');
  ok('a reading step is ready at once', (await next()) === 'ready');
  await clickNext(); await clickNext();
  st = await S();
  ok('two Nexts reach the find step', st.step === 2 && st.lx.kind === 'find', st.step + ' ' + (st.lx && st.lx.kind));
  ok('the exercise holds Next until it is done', (await next()) === 'locked');
  await clickNext();
  ok('pressing Next early says why nothing happened', /Finish this step first/.test(await feedback()));
  await tapKey(54);
  ok('a black key from a three-group is marked wrong', /pair/.test(await feedback()), await feedback());
  for (const m of [49, 51, 61, 63, 73, 75]) await tapKey(m);
  ok('finding every pair finishes the step', (await next()) === 'ready', await feedback());
  await sleep(500);   /* the last key's green flash fades back to found */
  const found = await page.$$eval('[data-learn-keyboard] rect[data-mark="found"]', els => els.length);
  ok('the keys found stay lit', found === 6, String(found));
  await clickNext();
  ok('the quiz shows its first question', /higher/.test(await page.$eval('[data-learn-question]', el => el.innerText)));
  await page.click('[data-choice="0"]'); await sleep(120);
  ok('a wrong answer keeps the question open', (await next()) === 'locked' && /try another/.test(await feedback()));
  await page.click('[data-choice="1"]'); await sleep(120);
  ok('the right answer explains, then offers the next question',
    /higher/.test(await feedback()) && (await page.$eval('[data-learn-next]', el => el.innerText.trim())) === 'Next question');
  await clickNext();
  await page.click('[data-choice="0"]'); await sleep(120);
  ok('the last question finishes the lesson', (await page.$eval('[data-learn-next]', el => el.innerText.trim())) === 'Finish lesson');
  const xp0 = await page.evaluate(() => window.PPP.app.state.xp);
  await clickNext(); await sleep(200);
  const complete = await page.evaluate(() => ({
    card: !!document.querySelector('[data-learn-complete]'),
    text: (document.querySelector('[data-learn-complete]') || {}).innerText || '',
    tick: (document.querySelector('[data-lesson="keys"]') || {}).innerText || '',
    count: document.querySelector('[data-learn-course]').innerText,
    xp: window.PPP.app.state.xp
  }));
  ok('the lesson ends on a finished card that names the next one', complete.card && /Find Do/.test(complete.text), complete.text.replace(/\n/g, ' '));
  ok('the course ticks it off and counts it', /✓/.test(complete.tick) && /1 of 20 done/.test(complete.count));
  ok('finishing a lesson earns XP once', complete.xp === xp0 + 25, xp0 + ' → ' + complete.xp);
  await page.click('[data-learn-go-next]'); await sleep(200);
  st = await S();
  ok('Next lesson opens lesson 2 at its start', st.lesson === 'do' && st.step === 0);

  console.log('keys from anywhere');
  await page.evaluate(() => window.PPP.app.learnOpen('doremi', 1)); await sleep(150);
  ok('the hint lights Do first', (await page.$$eval('[data-learn-keyboard] rect[data-mark="next"]', els => els.map(e => e.getAttribute('data-midi')))).join() === '60');
  await page.keyboard.press('KeyA'); await sleep(80);
  await page.keyboard.press('KeyS'); await sleep(80);
  st = await S();
  ok('A and S on the computer keyboard play Do and Re', st.lx.idx === 2, JSON.stringify(st.lx.idx));
  await page.keyboard.press('KeyF'); await sleep(80);
  st = await S();
  ok('F is Fa here, not the focus-mode shortcut', !st.focus && st.screen === 'learn' && st.lx.idx === 2 && st.lx.tone === 'bad');
  await page.keyboard.press('Space'); await sleep(80);
  st = await S();
  ok('the space bar does not start the practice transport', !st.playing);
  await page.evaluate(() => window.PPP.app.onMidiEvent({ type: 'on', midi: 64, velocity: 80, t: performance.now() }));
  await sleep(80);
  st = await S();
  ok('a MIDI key is an answer too', st.lx.done && st.lx.idx === 3, JSON.stringify({ idx: st.lx.idx, done: st.lx.done }));

  await page.evaluate(() => window.PPP.app.learnOpen('doremi', 0)); await sleep(150);
  await page.click('[data-learn-tool="listen"]');
  await page.waitForFunction(() => document.querySelector('[data-learn-keyboard] rect[data-mark="next"]'), { timeout: 3000 }).catch(() => {});
  const lit = await page.$$eval('[data-learn-keyboard] rect[data-mark="next"]', els => els.map(e => e.getAttribute('data-midi')));
  ok('Listen lights each key as it sounds', lit.length === 1 && ['60', '62', '64'].indexOf(lit[0]) > -1, lit.join());
  await page.waitForFunction(() => !window.PPP.app.state.learnClock, { timeout: 5000 }).catch(() => {});
  ok('and stops when the example ends', !(await page.evaluate(() => window.PPP.app.state.learnClock)));

  console.log('hands');
  const hands = () => page.evaluate(() => {
    const kb = document.querySelector('[data-learn-keyboard]');
    const g = kb && kb.querySelector('[data-hand]');
    const btn = document.querySelector('[data-learn-tool="hands"]');
    const names = kb ? [...kb.children].filter(x => x.tagName === 'g').pop() : null;
    return {
      hand: g ? g.getAttribute('data-hand') : null,
      now: g ? [...g.querySelectorAll('[data-finger-state="now"]')].map(e => +e.getAttribute('data-finger')).sort() : [],
      numbers: g ? g.querySelectorAll('[data-finger]').length : 0,
      button: btn ? btn.getAttribute('aria-pressed') : null,
      keyDigits: names ? [...names.querySelectorAll('text')].some(t => /^[1-5]$/.test(t.textContent)) : false
    };
  });
  await page.evaluate(() => window.PPP.app.learnOpen('doremi', 1)); await sleep(200);
  let hd = await hands();
  ok('a play step shows the right hand, thumb marked for Do', hd.hand === 'r' && hd.now.join() === '1' && hd.button === 'true', JSON.stringify(hd));
  await page.keyboard.press('KeyA'); await sleep(120);
  hd = await hands();
  ok('after Do the mark moves to finger 2 for Re', hd.now.join() === '2', JSON.stringify(hd.now));
  await page.click('[data-learn-tool="hands"]'); await sleep(150);
  hd = await hands();
  ok('Show hands turns the hand off', hd.hand === null && hd.button === 'false');
  await page.click('[data-learn-tool="hands"]'); await sleep(150);
  hd = await hands();
  ok('and back on — the same setting as the practice screen', hd.hand === 'r' && (await page.evaluate(() => window.PPP.app.state.toggles.handGuide)) !== false);

  await page.evaluate(() => window.PPP.app.learnOpen('octave', 1)); await sleep(150);
  for (const k of ['KeyA', 'KeyS', 'KeyD']) { await page.keyboard.press(k); await sleep(80); }
  hd = await hands();
  ok('in the scale, after Mi the thumb goes under for Fa', hd.now.join() === '1', JSON.stringify(hd.now));
  await page.evaluate(() => window.PPP.app.learnOpen('lefthand', 2)); await sleep(150);
  hd = await hands();
  ok('the left-hand lesson shows the left hand, little finger on Do', hd.hand === 'l' && hd.now.join() === '5', JSON.stringify(hd));
  await page.evaluate(() => window.PPP.app.learnOpen('twinkle', 1)); await sleep(150);
  for (const k of ['KeyA', 'KeyA']) { await page.keyboard.press(k); await sleep(80); }
  hd = await hands();
  ok('Twinkle follows its written fingering: Sol with 4', hd.now.join() === '4', JSON.stringify(hd.now));
  await page.evaluate(() => window.PPP.app.learnOpen('chords', 1)); await sleep(150);
  hd = await hands();
  ok('the chord marks fingers 1, 3 and 5 together', hd.now.join() === '1,3,5', JSON.stringify(hd.now));
  await page.evaluate(() => window.PPP.app.learnOpen('doremi', 3)); await sleep(150);
  hd = await hands();
  ok('with no hints the hand is there but marks no finger', hd.hand === 'r' && hd.now.length === 0, JSON.stringify(hd));
  await page.evaluate(() => window.PPP.app.learnOpen('fingers', 1)); await sleep(150);
  hd = await hands();
  ok('“right hand on the keys” shows the hand in place, all five numbered', hd.hand === 'r' && hd.numbers === 5 && hd.now.length === 0, JSON.stringify(hd));
  ok('with a hand shown, the keys lose their own finger numbers', !hd.keyDigits);
  await page.evaluate(() => window.PPP.app.learnOpen('keys', 2)); await sleep(150);
  hd = await hands();
  ok('finding keys has no hand and no hand button', hd.hand === null && hd.button === null, JSON.stringify(hd));

  console.log('reading, a chord, a rhythm');
  await page.evaluate(() => window.PPP.app.learnOpen('readlow', 1)); await sleep(200);
  ok('the drill draws a note on a treble staff', await page.$eval('[data-learn-picture]', el => !!el.querySelector('[data-learn-staff="treble"]')));
  let answered = 0;
  for (let i = 0; i < 12; i++) {
    const s = await S();
    if (s.lx.done) break;
    await page.click('[data-choice="' + (s.lx.note % 12) + '"]');
    answered++;
    await sleep(950);
  }
  st = await S();
  ok('naming eight notes finishes the drill', st.lx.done && st.lx.n === 8, answered + ' answers');

  await page.evaluate(() => window.PPP.app.learnOpen('chords', 1)); await sleep(150);
  for (const m of [60, 64, 67]) await tapKey(m);
  st = await S();
  ok('Do, Mi and Sol tapped in turn make the chord', st.lx.done, st.lx.msg);

  await page.evaluate(() => window.PPP.app.learnOpen('beat', 2)); await sleep(150);
  ok('the rhythm step has a Tap pad and no keyboard', !!(await page.$('[data-learn-tap]')) && !(await page.$('[data-learn-keyboard]')));
  await page.click('[data-learn-tool="start"]'); await sleep(50);
  /* tap on each note from inside the page, on the page's own clock */
  await page.evaluate(() => {
    const run = window.PPP.app.state.lx.run;
    run.ons.forEach(o => {
      const at = run.t0 + o.at * run.beatMs + 30 - performance.now();
      setTimeout(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true })), at);
    });
  });
  await page.waitForFunction(() => { const lx = window.PPP.app.state.lx; return lx && lx.result; }, { timeout: 15000 }).catch(() => {});
  st = await S();
  ok('eight taps on the beat pass', st.lx.result && st.lx.result.pass && st.lx.result.hits === 8 && st.lx.done, JSON.stringify(st.lx.result));
  ok('every note is marked on time', (await page.$$eval('[data-learn-rhythm] ellipse', els => els.filter(e => /good/.test(e.getAttribute('stroke'))).length)) === 8);

  await page.evaluate(() => window.PPP.app.learnOpen('beat', 2)); await sleep(150);
  await page.click('[data-learn-tool="start"]');
  await page.waitForFunction(() => { const lx = window.PPP.app.state.lx; return lx && lx.result; }, { timeout: 15000 }).catch(() => {});
  st = await S();
  ok('not tapping at all does not pass', st.lx.result && !st.lx.result.pass && !st.lx.done && /Try again/.test(await feedback()), await feedback());
  await page.keyboard.press('Space'); await sleep(80);
  ok('a stray tap after the run leaves the result on screen', /Try again/.test(await feedback()));

  await page.click('[data-learn-tool="start"]'); await sleep(100);
  await page.click('[data-learn-tool="listen"]'); await sleep(100);
  ok('Listen does nothing while a rhythm is being tapped', !(await page.evaluate(() => window.PPP.app.state.learnClock)));
  await page.evaluate(() => window.__pppTest.nav('Home')); await sleep(250);
  await page.evaluate(() => window.__pppTest.nav('Piano Basics')); await sleep(250);
  const back = await page.evaluate(() => ({ run: window.PPP.app.state.lx.run, start: document.querySelector('[data-learn-tool="start"]').innerText.trim() }));
  ok('leaving in the middle of a rhythm drops it, and Start is back', back.run === null && back.start === 'Start', JSON.stringify(back));

  console.log('kept');
  await page.evaluate(() => window.PPP.app.learnOpen('fasol', 2)); await sleep(200);
  await page.evaluate(() => window.PPP.app.writeState());
  await page.reload({ waitUntil: 'networkidle2' });
  await page.waitForFunction(() => document.querySelectorAll('aside nav button').length >= 6, { timeout: 25000 });
  await page.evaluate(() => window.__pppTest.nav('Piano Basics')); await sleep(300);
  const kept = await page.evaluate(() => ({
    title: document.querySelector('[data-learn-title]').innerText.trim(),
    step: window.PPP.app.state.learnStep,
    done: window.PPP.app.state.learnDone
  }));
  ok('a reload comes back to the same lesson and step', kept.title === 'Fa and Sol' && kept.step === 2, kept.title + ' #' + kept.step);
  ok('and remembers what is finished', kept.done && kept.done.keys === true, JSON.stringify(kept.done));

  console.log('Korean');
  const ko = await page.evaluate(async () => {
    const I = window.PPP_I18N;
    await I.ready;
    I.setLocale('ko-KR');
    window.PPP.app.learnOpen('keys', 0);
    await new Promise(r => setTimeout(r, 600));
    return {
      nav: [...document.querySelectorAll('aside nav button')].map(b => (b.innerText || '').trim().split('\n')[0].trim())[1],
      title: document.querySelector('[data-learn-title]').innerText.trim(),
      text: document.querySelector('[data-learn-card]').innerText,
      course: document.querySelector('[data-learn-course]').innerText
    };
  });
  ok('the tab reads 피아노 기초', ko.nav === '피아노 기초', ko.nav);
  ok('the lesson is in Korean', ko.title === '흰 건반과 검은 건반' && /피아노에는 흰 건반과 검은 건반이 있어요/.test(ko.text), ko.title);
  ok('the course list and its words are in Korean', /나의 코스/.test(ko.course) && /떴다 떴다 비행기/.test(ko.course) && !/Your course/.test(ko.course));
  await page.evaluate(() => window.PPP.app.learnOpen('doremi', 1)); await sleep(200);
  const keyNames = await page.$$eval('[data-learn-keyboard] text', els => els.map(e => e.textContent));
  ok('keys are named 도 레 미', ['도', '레', '미'].every(n => keyNames.indexOf(n) > -1), keyNames.slice(0, 6).join(' '));
  await tapKey(62);
  ok('feedback names the notes in Korean', /레.*도/.test(await feedback()), await feedback());
  await page.evaluate(() => window.PPP_I18N.setLocale('en-US'));

  console.log('phone');
  /* turning on touch reloads the page */
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await page.waitForFunction(() => window.PPP && window.PPP.app && document.querySelectorAll('aside nav button').length >= 6, { timeout: 25000 });
  await page.evaluate(() => { window.PPP.app.go('learn')(); window.PPP.app.learnOpen('keys', 1); }); await sleep(500);
  const phone = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth - window.innerWidth,
    card: document.querySelector('[data-learn-card]').getBoundingClientRect().width,
    kbScroll: (() => { const w = document.querySelector('.ppp-learn-keys'); return w ? w.scrollWidth > w.clientWidth : null; })()
  }));
  ok('no sideways page scroll on a phone', phone.overflow <= 1, phone.overflow + 'px');
  ok('the lesson card fits the screen', phone.card <= 390 && phone.card > 300, phone.card + 'px');
  ok('a three-octave keyboard scrolls inside its frame instead', phone.kbScroll === true);
  fs.mkdirSync(path.join(__dirname, '.shots'), { recursive: true });
  await page.screenshot({ path: path.join(__dirname, '.shots', 'lessons-phone.png') });

  await browser.close();
  if (errors.length) {
    console.error('\n' + errors.length + ' failed');
    errors.forEach(e => console.error('  ✗ ' + e));
    process.exit(1);
  }
  console.log('\nall Piano Basics checks passed');
})().catch(e => { console.error(e); process.exit(1); });
