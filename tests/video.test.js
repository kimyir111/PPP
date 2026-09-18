/* The performance beside the score.

   A song made from a YouTube link shows that video, embedded, under the coach;
   a song made from a video file shows the file, kept in IndexedDB. Either can
   play the passage being practised, from where its first bar starts in the
   performance, at the practice speed, and stop at its end.

   Nothing here reaches YouTube: the embed address is answered by a stand-in
   that reports back every command PPP sends it, so the test reads what the
   player was actually told to do. The video file is recorded in the page. */
const puppeteer = require('puppeteer');
const { preparePage } = require('./boot');

const URL = 'http://127.0.0.1:8777/Piano%20Coach%20App.dc.html';
const errors = [];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ok = (name, cond, detail) => {
  console.log((cond ? '  ✓ ' : '  ✗ ') + name + (detail ? ' — ' + detail : ''));
  if (!cond) errors.push(name + (detail ? ' — ' + detail : ''));
};

/* the stand-in player: echoes each command back to the page that sent it */
const FAKE_EMBED = '<!doctype html><title>player</title><body style="background:#000"><script>' +
  'addEventListener("message",function(e){try{parent.postMessage(JSON.stringify({echo:JSON.parse(e.data)}),"*")}catch(x){}});' +
  '</script></body>';

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage();
  await preparePage(page);
  await page.evaluateOnNewDocument(() => {
    window.__ytEcho = [];
    addEventListener('message', e => { try { const d = JSON.parse(e.data); if (d && d.echo) window.__ytEcho.push(d.echo); } catch (x) {} });
  });
  await page.setRequestInterception(true);
  page.on('request', r => {
    if (/youtube(-nocookie)?\.com\/embed\//.test(r.url())) return r.respond({ status: 200, contentType: 'text/html', body: FAKE_EMBED });
    if (/youtube|ytimg|googlevideo/.test(r.url())) return r.abort();
    r.continue();
  });
  await page.setViewport({ width: 1440, height: 1000 });
  page.on('pageerror', e => errors.push('[pageerror] ' + e.message));
  await page.goto(URL, { waitUntil: 'networkidle2', timeout: 45000 });
  await page.waitForFunction(() => document.querySelectorAll('aside nav button').length >= 6, { timeout: 25000 });

  const practice = () => page.evaluate(async () => {
    window.__pppTest.nav('Practice');
    await new Promise(r => setTimeout(r, 500));
    const v = document.querySelector('[data-video]');
    return v ? { text: v.innerText, iframe: (v.querySelector('iframe') || {}).src || null, video: !!v.querySelector('video') } : null;
  });

  console.log('\n── only a song made from a video has one ──');
  ok('the sample shows no video panel', (await practice()) === null);

  /* a song of our own, then told it came from YouTube, with its bar times */
  await page.evaluate(() => window.__pppTest.upload());
  await sleep(300);
  await (await page.$('input[type=file][data-add-file]')).uploadFile('D:/PPP/samples/prelude-fragment.musicxml');
  await page.waitForFunction(() => /See analysis/.test(document.body.innerText), { timeout: 15000 });
  ok('a song read from MusicXML shows none either', (await practice()) === null);

  /* Rewritten while the app is not running — it saves itself as the page
     goes, and would write over a change made behind its back. */
  const makeSource = async kind => {
    await page.goto('http://127.0.0.1:8777/health', { waitUntil: 'load' });
    const id = await page.evaluate(kind => {
      const st = JSON.parse(localStorage.getItem('ppp.state.v2'));
      st.importSource = Object.assign({}, st.importSource, {
        kind: kind, url: kind === 'youtube' ? 'https://www.youtube.com/watch?v=oU5jRnpJqM4' : null,
        barStarts: [2, 4, 6, 8, 10, 12, 14, 16, 18]      /* eight bars, two seconds each, from 0:02 */
      });
      localStorage.setItem('ppp.state.v2', JSON.stringify(st));
      return st.songId;
    }, kind);
    await page.goto(URL, { waitUntil: 'networkidle2' });
    await page.waitForFunction(() => document.querySelectorAll('aside nav button').length >= 6, { timeout: 25000 });
    return id;
  };

  console.log('\n── from YouTube ──');
  const songId = await makeSource('youtube');
  const yt = await practice();
  ok('the video is embedded under the coach', !!(yt && yt.iframe), yt && yt.iframe);
  ok('from the privacy-enhanced domain, with the player API on',
    !!(yt && /^https:\/\/www\.youtube-nocookie\.com\/embed\/oU5jRnpJqM4\?/.test(yt.iframe) && /enablejsapi=1/.test(yt.iframe)));
  const link = await page.evaluate(() => (document.querySelector('[data-video] a') || {}).href);
  ok('with a way to open it on YouTube', link === 'https://www.youtube.com/watch?v=oU5jRnpJqM4', link);
  const place = await page.evaluate(() => {
    const coach = document.querySelector('.ppp-sidecol .ppp-panel').getBoundingClientRect();
    const v = document.querySelector('[data-video]').getBoundingClientRect();
    const col = document.querySelector('.ppp-playcol').getBoundingClientRect();
    return { below: v.top >= coach.bottom - 1, right: v.left >= col.right, inView: v.bottom <= innerHeight + 1 };
  });
  ok('it sits in the right-hand column, below the coach, in view', place.below && place.right && place.inView, JSON.stringify(place));

  /* the loop is the whole prelude: bars 1–8, which start at 0:02 and end at 0:18 */
  await sleep(600);
  const played = await page.evaluate(async () => {
    window.__ytEcho = [];
    const b = document.querySelector('[data-video-play]');
    const label = b.textContent;
    b.click();
    await new Promise(r => setTimeout(r, 400));
    return { label: label, sent: window.__ytEcho.map(c => c.func + '(' + (c.args || []).join(',') + ')') };
  });
  const [from, to] = await page.evaluate(() => {
    const m = document.querySelector('header').innerText.match(/Measures (\d+)–(\d+)/);
    return m ? [+m[1], +m[2]] : [1, 8];
  });
  const wantStart = 2 + (from - 1) * 2;
  ok('the button names the passage', new RegExp('Watch measures ' + from + '–' + to).test(played.label), played.label);
  ok('it seeks to where the passage starts, then plays',
    played.sent.indexOf('seekTo(' + wantStart + ',true)') > -1 && played.sent.indexOf('playVideo()') > played.sent.indexOf('seekTo(' + wantStart + ',true)'),
    played.sent.join(' '));
  ok('at the practice speed', played.sent.indexOf('setPlaybackRate(1)') > -1, played.sent[0]);

  /* slower practice → slower performance, in YouTube's quarter steps */
  const slow = await page.evaluate(async () => {
    const i = document.querySelector('.ppp-transport input[type=range]') || document.querySelector('input[type=range]');
    const sc = window.PPP && window.PPP.Score;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, String(Math.round(72 * 0.75)));
    i.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise(r => setTimeout(r, 300));
    window.__ytEcho = [];
    const b = document.querySelector('[data-video-play]');
    const label = b.textContent;
    b.click();
    await new Promise(r => setTimeout(r, 400));
    return { label: label, sent: window.__ytEcho.map(c => c.func + '(' + (c.args || []).join(',') + ')') };
  });
  ok('practising at 75% plays the performance at 75%', /75%/.test(slow.label) && slow.sent.indexOf('setPlaybackRate(0.75)') > -1,
    slow.label + ' — ' + slow.sent.join(' '));

  /* one sound at a time: starting the score stops the performance */
  const stopped = await page.evaluate(async () => {
    window.__ytEcho = [];
    const play = [...document.querySelectorAll('.ppp-transport button')].find(b => /^Play$/.test(b.innerText.trim()));
    if (play) play.click();
    await new Promise(r => setTimeout(r, 400));
    const sent = window.__ytEcho.map(c => c.func);
    const pause = [...document.querySelectorAll('.ppp-transport button')].find(b => /^Pause$/.test(b.innerText.trim()));
    if (pause) pause.click();
    return sent;
  });
  ok('pressing Play on the score pauses the video', stopped.indexOf('pauseVideo') > -1, stopped.join(' '));

  console.log('\n── from a video file ──');
  await makeSource('video');
  /* a short video, recorded in the page, kept where PPP keeps videos */
  const kept = await page.evaluate(async id => {
    const c = document.createElement('canvas'); c.width = 160; c.height = 90;
    const g = c.getContext('2d');
    const rec = new MediaRecorder(c.captureStream(15), { mimeType: 'video/webm' });
    const parts = [];
    rec.ondataavailable = e => parts.push(e.data);
    const t0 = performance.now();
    const draw = () => { g.fillStyle = 'hsl(' + ((performance.now() - t0) / 10 % 360) + ',60%,50%)'; g.fillRect(0, 0, 160, 90); if (rec.state === 'recording') requestAnimationFrame(draw); };
    rec.start(); draw();
    await new Promise(r => setTimeout(r, 2500));
    await new Promise(r => { rec.onstop = r; rec.stop(); });
    const blob = new Blob(parts, { type: 'video/webm' });
    await new Promise((res, rej) => {
      const o = indexedDB.open('ppp-media', 1);
      o.onupgradeneeded = () => o.result.createObjectStore('videos');
      o.onsuccess = () => { const t = o.result.transaction('videos', 'readwrite'); t.objectStore('videos').put(blob, id); t.oncomplete = res; t.onerror = rej; };
      o.onerror = rej;
    });
    return blob.size;
  }, songId);
  ok('a video is kept for the song', kept > 0, kept + ' bytes');
  await page.reload({ waitUntil: 'networkidle2' });
  await page.waitForFunction(() => document.querySelectorAll('aside nav button').length >= 6, { timeout: 25000 });
  await practice();
  const vid = await page.waitForFunction(() => { const v = document.querySelector('[data-video] video'); return v && v.src ? v.src : null; }, { timeout: 15000 })
    .then(h => h.jsonValue()).catch(() => null);
  ok('the video file plays under the coach after a reload', /^blob:/.test(vid || ''), vid);
  const vplay = await page.evaluate(async () => {
    const v = document.querySelector('[data-video] video');
    await new Promise(r => { if (v.readyState >= 1) r(); else v.onloadedmetadata = r; setTimeout(r, 3000); });
    document.querySelector('[data-video-play]').click();
    await new Promise(r => setTimeout(r, 300));
    return { t: v.currentTime, paused: v.paused, rate: v.playbackRate };
  });
  ok('"Watch measures" plays the file from the passage, at the practice speed',
    !vplay.paused && vplay.rate === 0.75, 'at ' + vplay.t.toFixed(2) + 's, rate ' + vplay.rate + (vplay.paused ? ', paused' : ', playing'));

  console.log('\n── when the video was not kept ──');
  await page.evaluate(async id => {
    await new Promise((res) => {
      const o = indexedDB.open('ppp-media', 1);
      o.onsuccess = () => { const t = o.result.transaction('videos', 'readwrite'); t.objectStore('videos').delete(id); t.oncomplete = res; t.onerror = res; };
      o.onerror = res;
    });
  }, songId);
  await page.reload({ waitUntil: 'networkidle2' });
  await page.waitForFunction(() => document.querySelectorAll('aside nav button').length >= 6, { timeout: 25000 });
  await practice();
  await sleep(700);
  const missing = await page.evaluate(() => {
    const v = document.querySelector('[data-video]');
    return { text: v ? v.innerText : '', input: !!(v && v.querySelector('input[type=file]')) };
  });
  ok('it says so, and offers to take the file again', /was not kept/.test(missing.text) && missing.input, missing.text.split('\n').slice(1, 2).join(''));

  console.log('\n── removing the song removes its video ──');
  await page.evaluate(async id => {
    await new Promise((res) => {
      const o = indexedDB.open('ppp-media', 1);
      o.onsuccess = () => { const t = o.result.transaction('videos', 'readwrite'); t.objectStore('videos').put(new Blob(['x'], { type: 'video/webm' }), id); t.oncomplete = res; };
    });
    window.__pppTest.nav('My Songs');
    await new Promise(r => setTimeout(r, 400));
    const b = document.querySelector('[data-remove-song="' + id + '"]');
    b.click(); await new Promise(r => setTimeout(r, 150)); b.click();
    await new Promise(r => setTimeout(r, 600));
  }, songId);
  const left = await page.evaluate(id => new Promise(res => {
    const o = indexedDB.open('ppp-media', 1);
    o.onsuccess = () => { const g = o.result.transaction('videos').objectStore('videos').get(id); g.onsuccess = () => res(!!g.result); };
    o.onerror = () => res(null);
  }), songId);
  ok('the stored video goes with it', left === false);

  console.log('\n────────────────────────────────────────');
  if (errors.length) {
    console.log(errors.length + ' PROBLEM(S):');
    [...new Set(errors)].forEach(e => console.log('  ✗ ' + e));
  } else console.log('The performance plays beside the score, from the passage you are on.');
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})().catch(e => { console.error('HARNESS FAILURE:', e); process.exit(2); });
