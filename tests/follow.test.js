/* ============================================================================
   FOLLOW MODE

   The clock-driven transport measures a performance. Follow mode is for
   learning notes you do not have yet: the playhead parks on the next onset and
   moves only when you play it.

   A fake MIDI keyboard is driven through the real app. Everything is read back
   from the DOM — which keys PPP is asking for, and where the playhead is — so
   nothing here can pass by inspecting internals the user never sees.
   ========================================================================== */

const puppeteer = require('puppeteer');
const { preparePage } = require('./boot');

const URL = 'http://127.0.0.1:8777/Piano%20Coach%20App.dc.html';
const errors = [];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ok = (name, cond, detail) => {
  console.log((cond ? '  ✓ ' : '  ✗ ') + name + (detail ? ' — ' + detail : ''));
  if (!cond) errors.push(name + (detail ? ' — ' + detail : ''));
};

/* A Web MIDI device PPP can actually open, driven from the test. */
function installFakeMidi() {
  const listeners = [];
  const input = {
    id: 'fake-1', name: 'Test Piano', manufacturer: 'PPP', state: 'connected', type: 'input',
    addEventListener: (t, fn) => { if (t === 'midimessage') listeners.push(fn); },
    removeEventListener: (t, fn) => { const i = listeners.indexOf(fn); if (i > -1) listeners.splice(i, 1); },
    set onmidimessage(fn) { if (fn) listeners.push(fn); },
    get onmidimessage() { return listeners[0] || null; }
  };
  const inputs = new Map([['fake-1', input]]);
  navigator.requestMIDIAccess = () => Promise.resolve({
    inputs: inputs, outputs: new Map(),
    addEventListener: () => {}, onstatechange: null
  });
  const send = (status, midi, vel) => {
    const d = new Uint8Array([status, midi, vel]);
    listeners.slice().forEach(fn => fn({ data: d, receivedTime: performance.now() }));
  };
  window.__press = m => send(0x90, m, 80);
  window.__release = m => send(0x80, m, 0);
}

/* What PPP is asking for, straight off the on-screen keyboard. */
const wanted = page => page.evaluate(() =>
  [...document.querySelectorAll('[data-state="expected"]')].map(e => +e.getAttribute('data-midi')).sort((a, b) => a - b));

const look = page => page.evaluate(() => {
  const t = document.querySelector('main').innerText;
  return {
    badge: (t.match(/MIDI Connected|Demo Input/) || [])[0] || null,
    followOn: /Follow on/.test(t),
    followOff: /Follow off/.test(t),
    hint: /the score waits for each note/i.test(t),
    at: (t.match(/Measure (\d+) · beat (\d+)/) || []).slice(1).join(':'),
    wrongKeys: document.querySelectorAll('[data-state="wrong"]').length
  };
});

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  const consoleErrors = [], pageErrors = [];
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', e => pageErrors.push(e.message));

  await preparePage(page);
  await page.evaluateOnNewDocument(installFakeMidi);
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await sleep(3000);

  await page.evaluate(() => {
    const b = [...document.querySelectorAll('aside nav button')].find(x => /Practice/.test(x.innerText || ''));
    if (b) b.click();
  });
  await sleep(900);
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('main button, main span')]
      .find(x => /Demo Input/.test((x.innerText || '').trim()));
    if (b) b.click();
  });
  await sleep(1400);

  console.log('\n── it connects and starts following ──');
  const s0 = await look(page);
  ok('the fake keyboard connects', s0.badge === 'MIDI Connected', s0.badge);
  ok('follow mode is on by default', s0.followOn === true);
  ok('and the app says how it works', s0.hint === true,
    'the hint is on screen instead of leaving you to guess');

  console.log('\n── it asks for something, and waits ──');
  const want1 = await wanted(page);
  ok('the keyboard shows which notes it wants', want1.length > 0, 'expecting ' + want1.join(', '));
  const before = await look(page);
  await sleep(1600);
  const still = await look(page);
  ok('nothing advances while you sit there', before.at === still.at && before.at !== '',
    'playhead stayed at measure ' + still.at.replace(':', ' beat '));
  const want2 = await wanted(page);
  ok('and it is still asking for the same notes', want2.join() === want1.join(), want2.join(', '));

  console.log('\n── a wrong note does not move it ──');
  const wrongKey = want1[0] === 108 ? want1[0] - 1 : want1[0] + 1;
  await page.evaluate(m => window.__press(m), wrongKey);
  await sleep(400);
  const afterWrong = await look(page);
  ok('the playhead stays put on a wrong key', afterWrong.at === still.at, 'measure ' + afterWrong.at);
  ok('and the wrong key is shown as wrong', afterWrong.wrongKeys > 0, afterWrong.wrongKeys + ' key(s) marked');
  await page.evaluate(m => window.__release(m), wrongKey);
  await sleep(200);

  console.log('\n── the right notes move it ──');
  await page.evaluate(ms => ms.forEach(m => window.__press(m)), want1);
  await sleep(500);
  const moved = await look(page);
  const want3 = await wanted(page);
  ok('playing what it asked for advances the playhead', moved.at !== still.at,
    still.at.replace(':', ' beat ') + '  →  ' + moved.at.replace(':', ' beat '));
  ok('and it now asks for the next notes', want3.join() !== want1.join(),
    want1.join(', ') + '  →  ' + want3.join(', '));
  await page.evaluate(ms => ms.forEach(m => window.__release(m)), want1);
  await sleep(200);

  console.log('\n── a chord waits for all of its notes ──');
  let chordChecked = false;
  for (let step = 0; step < 40 && !chordChecked; step++) {
    const w = await wanted(page);
    if (!w.length) break;
    if (w.length > 1) {
      await page.evaluate(m => window.__press(m), w[0]);
      await sleep(320);
      const mid = await wanted(page);
      ok('one note of a chord is not enough',
        mid.length === w.length - 1 && mid.join() !== w.join(),
        'still owes ' + mid.join(', '));
      await page.evaluate(ms => ms.forEach(m => window.__press(m)), w.slice(1));
      await sleep(320);
      const after = await wanted(page);
      ok('the whole chord releases it', after.join() !== w.join() && after.join() !== mid.join(),
        'moved on to ' + (after.join(', ') || 'the end'));
      await page.evaluate(ms => ms.forEach(m => window.__release(m)), w);
      chordChecked = true;
      break;
    }
    await page.evaluate(ms => ms.forEach(m => window.__press(m)), w);
    await sleep(120);
    await page.evaluate(ms => ms.forEach(m => window.__release(m)), w);
    await sleep(80);
  }
  if (!chordChecked) console.log('  (no chord reached in this range — skipped)');

  console.log('\n── timing is never invented ──');
  const drift = await page.evaluate(() => {
    const t = document.querySelector('main').innerText;
    const i = t.search(/Timing drift|타이밍/i);
    return i < 0 ? null : t.slice(i, i + 40).split('\n').slice(0, 2).join(' ').trim();
  });
  ok('no timing figure is reported while following', drift != null && /—/.test(drift), drift);

  console.log('\n── turning it off restores the clock ──');
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('main button')].find(x => /Follow on/.test(x.innerText || ''));
    if (b) b.click();
  });
  await sleep(700);
  const off = await look(page);
  ok('the toggle switches back to the timed transport', off.followOff === true);
  ok('and the follow hint goes away', off.hint === false);
  const timed = await page.evaluate(async () => {
    const b = [...document.querySelectorAll('main button')].find(x => /^(Play|재생)$/.test((x.innerText || '').trim()));
    if (!b) return null;
    const t0 = (document.querySelector('main').innerText.match(/Measure (\d+) · beat (\d+)/) || []).slice(1).join(':');
    b.click();
    await new Promise(r => setTimeout(r, 1200));
    const t1 = (document.querySelector('main').innerText.match(/Measure (\d+) · beat (\d+)/) || []).slice(1).join(':');
    const stop = [...document.querySelectorAll('main button')].find(x => /^(Pause|일시정지)$/.test((x.innerText || '').trim()));
    if (stop) stop.click();
    return { t0, t1 };
  });
  ok('the clock moves the playhead again once following is off',
    !!timed && timed.t0 !== timed.t1, timed ? timed.t0 + ' → ' + timed.t1 : 'no play button');

  console.log('\n── nothing broke ──');
  ok('no console errors', consoleErrors.length === 0, consoleErrors.slice(0, 2).join(' | ') || 'clean');
  ok('no page errors', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | ') || 'clean');

  await browser.close();
  console.log('\n────────────────────────────────────────');
  if (errors.length) {
    console.log(errors.length + ' PROBLEM(S):');
    errors.forEach(e => console.log('  ✗ ' + e));
    process.exit(1);
  }
  console.log('Follow mode waits, advances on the right notes, and invents no timing.');
})().catch(e => { console.error(e); process.exit(1); });
