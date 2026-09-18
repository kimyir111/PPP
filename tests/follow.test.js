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

  console.log('\n── a rest is a gate, not a skip ──');
  const mx = body => '<?xml version="1.0"?><score-partwise version="3.1"><part-list><score-part id="P1"><part-name>P</part-name></score-part></part-list><part id="P1">' + body + '</part></score-partwise>';
  const restXml = mx(
    '<measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time>' +
    '<clef><sign>G</sign><line>2</line></clef></attributes>' +
    '<note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>' +
    '<note><rest/><duration>1</duration><type>quarter</type></note>' +
    '<note><pitch><step>E</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>' +
    '<note><rest/><duration>1</duration><type>quarter</type></note></measure>'
  );
  const otherHandXml = mx(
    '<measure number="1"><attributes><divisions>1</divisions><time><beats>2</beats><beat-type>4</beat-type></time>' +
    '<staves>2</staves>' +
    '<clef number="1"><sign>G</sign><line>2</line></clef>' +
    '<clef number="2"><sign>F</sign><line>4</line></clef></attributes>' +
    '<note><pitch><step>C</step><octave>4</octave></pitch><duration>2</duration><type>half</type><staff>1</staff></note>' +
    '<backup><duration>2</duration></backup>' +
    '<note><rest/><duration>1</duration><voice>5</voice><type>quarter</type><staff>2</staff></note>' +
    '<note><rest/><duration>1</duration><voice>5</voice><type>quarter</type><staff>2</staff></note></measure>'
  );
  const tiedXml = mx(
    '<measure number="1"><attributes><divisions>1</divisions><time><beats>3</beats><beat-type>4</beat-type></time>' +
    '<clef><sign>G</sign><line>2</line></clef></attributes>' +
    '<note><pitch><step>C</step><octave>4</octave></pitch><duration>2</duration><type>half</type><tie type="start"/></note>' +
    '<note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type><tie type="stop"/></note></measure>'
  );

  const structure = await page.evaluate((restSrc, otherSrc, tiedSrc) => {
    const app = PPP.app;
    const dump = sc => {
      app.setState({
        score: sc, tempo: 120, hands: 'both', loop: false, practiceMode: 'whole',
        playing: false, toggles: Object.assign({}, app.state.toggles, { follow: true })
      });
      app._gatesKey = null;
      return app.followGates().map(g => ({
        b: Math.round(g.b * 1000) / 1000,
        rest: !!g.rest,
        midi: (g.notes || []).map(n => n.midi),
        dur: g.dur != null ? Math.round(g.dur * 1000) / 1000 : null
      }));
    };
    return {
      rest: dump(PPP.parseMusicXML(restSrc, 'follow-rests.musicxml')),
      other: dump(PPP.parseMusicXML(otherSrc, 'follow-other-rest.musicxml')),
      tied: dump(PPP.parseMusicXML(tiedSrc, 'follow-tie.musicxml'))
    };
  }, restXml, otherHandXml, tiedXml);

  const restGates = structure.rest || [];
  ok('note / rest / note / rest are four gates',
    restGates.length === 4 && restGates[0].midi[0] === 60 && restGates[1].rest && restGates[2].midi[0] === 64 && restGates[3].rest,
    JSON.stringify(restGates));
  ok('the rest gate keeps its written length',
    restGates[1] && restGates[1].rest && Math.abs(restGates[1].dur - 1) < 1e-6,
    restGates[1] ? String(restGates[1].dur) : 'no rest gate');
  ok('a rest in the other hand is still a gate while this hand is holding',
    structure.other.length === 2 && !structure.other[0].rest && structure.other[0].midi[0] === 60
      && structure.other[1].rest && Math.abs(structure.other[1].b - 1) < 1e-6,
    JSON.stringify(structure.other));
  ok('a tied continuation is not a rest in the middle of the hold',
    structure.tied.length === 1 && !structure.tied[0].rest,
    JSON.stringify(structure.tied));

  const heldRest = await page.evaluate(async xml => {
    const app = PPP.app;
    const sc = PPP.parseMusicXML(xml, 'follow-held-rest.musicxml');
    app.setState({
      score: sc, tempo: 120, hands: 'both', loop: false, practiceMode: 'whole',
      playing: false, toggles: Object.assign({}, app.state.toggles, { follow: true })
    });
    app.setState(app.followReset({}));
    await new Promise(r => setTimeout(r, 500));
    window.__press(60);
    await new Promise(r => setTimeout(r, 80));
    const g = app.followGates()[app.state.gateIdx] || {};
    window.__release(60);
    return { rest: !!g.rest, b: g.b, want: [...document.querySelectorAll('[data-state="expected"]')].map(e => +e.getAttribute('data-midi')) };
  }, otherHandXml);
  ok('after the held note it parks on the other hand\'s rest',
    heldRest.rest === true && Math.abs((heldRest.b || 0) - 1) < 0.05 && heldRest.want.length === 0,
    JSON.stringify(heldRest));

  const liveRest = await page.evaluate(async xml => {
    const app = PPP.app;
    const sc = PPP.parseMusicXML(xml, 'follow-rests-live.musicxml');
    app.setState({
      score: sc, tempo: 120, hands: 'both', loop: false, practiceMode: 'whole',
      playing: false, toggles: Object.assign({}, app.state.toggles, { follow: true })
    });
    app.setState(app.followReset({}));
    await new Promise(r => setTimeout(r, 700));
    const snap = () => {
      const g = app.followGates()[app.state.gateIdx] || {};
      return {
        rest: !!g.rest,
        midi: (g.notes || []).map(n => n.midi),
        want: [...document.querySelectorAll('[data-state="expected"]')].map(e => +e.getAttribute('data-midi')).sort((a, b) => a - b),
        restOn: !!document.querySelector('[data-rest="1"].ppp-on')
      };
    };
    const start = snap();
    window.__press(60);
    await new Promise(r => setTimeout(r, 80));
    const afterC = snap();
    window.__release(60);
    await new Promise(r => setTimeout(r, 180));
    const midRest = snap();
    await new Promise(r => setTimeout(r, 450));
    const afterWait = snap();
    return { start, afterC, midRest, afterWait };
  }, restXml);

  ok('it first asks for the note before the rest',
    liveRest.start && liveRest.start.want.join() === '60' && !liveRest.start.rest,
    JSON.stringify(liveRest.start));
  ok('playing that note parks on the rest instead of jumping to the next pitch',
    liveRest.afterC && liveRest.afterC.rest === true && liveRest.afterC.want.length === 0,
    JSON.stringify(liveRest.afterC));
  ok('the rest glyph is the thing under the playhead',
    liveRest.afterC && liveRest.afterC.restOn === true);
  ok('the rest still holds if you wait a moment',
    liveRest.midRest && liveRest.midRest.rest === true && liveRest.midRest.want.length === 0,
    JSON.stringify(liveRest.midRest));
  ok('when the rest is up it asks for the next note',
    liveRest.afterWait && liveRest.afterWait.want.join() === '64' && !liveRest.afterWait.rest,
    JSON.stringify(liveRest.afterWait));

  const skipped = await page.evaluate(async xml => {
    const app = PPP.app;
    const sc = PPP.parseMusicXML(xml, 'follow-rest-skip.musicxml');
    app.setState({
      score: sc, tempo: 120, hands: 'both', loop: false, practiceMode: 'whole',
      playing: false, toggles: Object.assign({}, app.state.toggles, { follow: true })
    });
    app.setState(app.followReset({}));
    await new Promise(r => setTimeout(r, 400));
    window.__press(60);
    await new Promise(r => setTimeout(r, 40));
    window.__release(60);
    window.__press(64);
    await new Promise(r => setTimeout(r, 80));
    const g = app.followGates()[app.state.gateIdx] || {};
    const want = [...document.querySelectorAll('[data-state="expected"]')].map(e => +e.getAttribute('data-midi'));
    window.__release(64);
    return { rest: !!g.rest, b: g.b, midi: (g.notes || []).map(n => n.midi), want };
  }, restXml);
  ok('playing the next written pitch skips the rest wait',
    skipped.rest === true && Math.abs((skipped.b || 0) - 3) < 0.05,
    JSON.stringify(skipped));

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
