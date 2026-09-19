/* ============================================================================
   HAND GUIDE

   Which finger plays each note, drawn as a see-through hand over the
   on-screen keyboard, for someone who has never had a lesson.

   The first half runs the fingering model in the page against fingerings any
   piano book prints — scales with the thumb passing under, five-finger
   melodies that never leave their position, triads, the thumb kept off black
   keys — and checks that a finger printed in a MusicXML file is kept.

   The second half drives the real app with a fake MIDI keyboard and reads the
   picture back from the DOM: the fingers marked "play now" must be lying on
   exactly the keys PPP is asking for, and must move on when those keys are
   played. The toggle, the hand filter and persistence are checked the same
   way, by what is drawn.
   ========================================================================== */

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const { preparePage } = require('./boot');

const URL = 'http://127.0.0.1:8777/Piano%20Coach%20App.dc.html';
const errors = [];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ok = (name, cond, detail) => {
  console.log((cond ? '  ✓ ' : '  ✗ ') + name + (detail ? ' — ' + detail : ''));
  if (!cond) errors.push(name + (detail ? ' — ' + detail : ''));
};

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

/* The keys PPP is asking for, and the keys under the fingers the hand guide
   says to play now — found by where each finger's number is drawn. */
const picture = page => page.evaluate(() => {
  const keyAt = (x, y) => {
    const rects = [...document.querySelectorAll('.ppp-kbwrap rect[data-midi]')];
    /* black keys sit on top of the whites */
    const hit = r => { const b = r.getBoundingClientRect(); return x >= b.left && x <= b.right && y >= b.top && y <= b.bottom; };
    const black = rects.filter(r => +r.getAttribute('height') < 120).find(hit);
    const white = rects.filter(r => +r.getAttribute('height') >= 120).find(hit);
    return +(black || white || { getAttribute: () => NaN }).getAttribute('data-midi');
  };
  const under = state => [...document.querySelectorAll('.ppp-hand [data-finger-state="' + state + '"]')].map(g => {
    const b = g.querySelector('circle').getBoundingClientRect();
    return { hand: g.closest('.ppp-hand').getAttribute('data-hand'), finger: +g.getAttribute('data-finger'), midi: keyAt(b.left + b.width / 2, b.top + b.height / 2), artOffset: +g.getAttribute('data-art-offset') };
  });
  const svg = document.querySelector('.ppp-kbwrap svg');
  return {
    hands: [...document.querySelectorAll('.ppp-hand')].map(g => g.getAttribute('data-hand')).sort(),
    arts: [...document.querySelectorAll('.ppp-hand image[data-hand-art]')].map(img => {
      const b = img.getBoundingClientRect(), hand = img.closest('.ppp-hand');
      return { pose: img.getAttribute('data-hand-art'), href: img.getAttribute('href'), transform: img.getAttribute('transform'), width: b.width, height: b.height, wrist: +hand.getAttribute('data-hand-wrist-size') };
    }),
    expected: [...document.querySelectorAll('.ppp-kbwrap [data-state="expected"]')].map(e => +e.getAttribute('data-midi')).sort((a, b) => a - b),
    sounding: [...document.querySelectorAll('.ppp-kbwrap [data-state="on"]')].map(e => +e.getAttribute('data-midi')).sort((a, b) => a - b),
    now: under('now'),
    viewH: svg ? +svg.getAttribute('viewBox').split(' ')[3] : 0,
    labelsBelowHands: svg ? (() => {
      const children = [...svg.children], firstHand = children.findIndex(e => e.classList && e.classList.contains('ppp-hand'));
      const lastLabel = children.reduce((n, e, i) => e.tagName.toLowerCase() === 'text' && !(e.closest && e.closest('.ppp-hand')) ? i : n, -1);
      return lastLabel > -1 && firstHand > lastLabel;
    })() : false,
    button: ([...document.querySelectorAll('main button')].find(b => /Show hands/.test(b.innerText || '')) || { getAttribute: () => null }).getAttribute('aria-pressed'),
    legend: /1 thumb · 2 index · 3 middle · 4 ring · 5 little finger/.test(document.querySelector('main').innerText)
  };
});
const clickText = (page, re) => page.evaluate(src => {
  const r = new RegExp(src);
  const b = [...document.querySelectorAll('main button')].find(x => r.test((x.innerText || '').trim()));
  if (b) b.click();
  return !!b;
}, re.source);

(async () => {
  const pairMasks = ['12', '13', '14', '15', '23', '24', '25', '34', '35', '45'];
  const pairAssets = pairMasks.map(mask => path.join(__dirname, '..', 'assets', 'hands', 'hand-right-pair-' + mask + '.png'));
  ok('every two-finger combination has its own illustrated pose', pairAssets.every(file => fs.existsSync(file) && fs.statSync(file).size > 10000), pairMasks.join(', '));
  const fourFingerAssets = ['chord-1234-v2', 'chord-1235-v2', 'chord-1245-wide-v2', 'chord-1345-v2', 'chord-2345-v2']
    .map(name => path.join(__dirname, '..', 'assets', 'hands', 'hand-right-' + name + '.png'));
  ok('four-finger chords use dedicated illustrated poses', fourFingerAssets.every(file => fs.existsSync(file) && fs.statSync(file).size > 10000), fourFingerAssets.map(file => path.basename(file)).join(', '));
  const threeFingerAssets = ['chord-125-mid-v2', 'chord-135-wide-v2', 'chord-145-wide-v2']
    .map(name => path.join(__dirname, '..', 'assets', 'hands', 'hand-right-' + name + '.png'));
  ok('wide three-finger chords use dedicated illustrated poses', threeFingerAssets.every(file => fs.existsSync(file) && fs.statSync(file).size > 10000), threeFingerAssets.map(file => path.basename(file)).join(', '));
  const naturalOctave = path.join(__dirname, '..', 'assets', 'hands', 'hand-right-pair-15-level-wide-natural-v3.png');
  ok('wide octaves use a relaxed five-finger illustration', fs.existsSync(naturalOctave) && fs.statSync(naturalOctave).size > 10000, path.basename(naturalOctave));

  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  const consoleErrors = [], pageErrors = [];
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', e => pageErrors.push(e.message));

  await preparePage(page);
  await page.evaluateOnNewDocument(installFakeMidi);
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await sleep(3000);

  console.log('\n── the fingering a piano book would print ──');
  const book = await page.evaluate(() => {
    const F = window.PPP.Fingering;
    const P = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
    const midi = s => { const m = /^([A-G])(#|b)?(\d)$/.exec(s); return (+m[3] + 1) * 12 + P[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0); };
    const run = (str, hand) => {
      let t = 0; const notes = [];
      str.split(' ').forEach(tok => {
        if (tok === 'r') { t++; return; }
        tok.split('+').forEach(p => notes.push({ abs: t, dur: 1, midi: midi(p), hand }));
        t++;
      });
      const plan = F.plan({ notes });
      return { fingers: plan.hands[hand].events.map(e => e.fingers.filter(Boolean).join('')).join(' '), poses: plan.hands[hand].poses };
    };
    const cases = [
      ['C major scale, right hand up', 'C4 D4 E4 F4 G4 A4 B4 C5', 'r', '1 2 3 1 2 3 4 5'],
      ['C major scale, right hand down', 'C5 B4 A4 G4 F4 E4 D4 C4', 'r', '5 4 3 2 1 3 2 1'],
      ['C major scale, left hand up', 'C3 D3 E3 F3 G3 A3 B3 C4', 'l', '5 4 3 2 1 3 2 1'],
      ['C major scale, left hand down', 'C4 B3 A3 G3 F3 E3 D3 C3', 'l', '1 2 3 1 2 3 4 5'],
      ['two octaves, right hand', 'C4 D4 E4 F4 G4 A4 B4 C5 D5 E5 F5 G5 A5 B5 C6', 'r', '1 2 3 1 2 3 4 1 2 3 1 2 3 4 5'],
      ['G major, right hand', 'G4 A4 B4 C5 D5 E5 F#5 G5', 'r', '1 2 3 1 2 3 4 5'],
      ['F major keeps the thumb off B flat', 'F4 G4 A4 Bb4 C5 D5 E5 F5', 'r', '1 2 3 4 1 2 3 4'],
      ['Ode to Joy', 'E4 E4 F4 G4 G4 F4 E4 D4 C4 C4 D4 E4 E4 D4 D4', 'r', '3 3 4 5 5 4 3 2 1 1 2 3 3 2 2'],
      ['Mary had a little lamb', 'E4 D4 C4 D4 E4 E4 E4 r D4 D4 D4 r E4 G4 G4', 'r', '3 2 1 2 3 3 3 2 2 2 3 5 5'],
      ['Minuet in G', 'D5 G4 A4 B4 C5 D5 G4 G4', 'r', '5 1 2 3 4 5 1 1'],
      ['Happy Birthday', 'G4 G4 A4 G4 C5 B4 r G4 G4 A4 G4 D5 C5', 'r', '1 1 2 1 4 3 1 1 2 1 5 4'],
      ['C triad, right hand', 'C4+E4+G4', 'r', '135'],
      ['first inversion, right hand', 'E4+G4+C5', 'r', '125'],
      ['C triad, left hand', 'C3+E3+G3', 'l', '531'],
      ['I–IV–V–I, left hand', 'C3+E3+G3 C3+F3+A3 B2+D3+G3 C3+E3+G3', 'l', '531 521 531 531'],
      ['Alberti bass', 'C3 G3 E3 G3 C3 G3 E3 G3', 'l', '5 1 3 1 5 1 3 1'],
      ['arpeggio, thumb under', 'C4 E4 G4 C5 E5 G5 C6', 'r', '1 2 3 1 2 3 5']
    ];
    const got = cases.map(([name, str, hand, want]) => ({ name, want, got: run(str, hand).fingers }));
    const ode = run('E4 E4 F4 G4 G4 F4 E4 D4 C4 C4 D4 E4 E4 D4 D4', 'r').poses;
    return { got, odePoses: ode.length, odeKeys: ode[0].key };
  });
  book.got.forEach(c => ok(c.name, c.got === c.want, c.got === c.want ? c.got : 'got ' + c.got + ', a book prints ' + c.want));
  ok('a five-finger melody never moves the hand', book.odePoses === 1 && book.odeKeys.join() === '60,62,64,65,67',
    book.odePoses + ' position(s), fingers over ' + book.odeKeys.join(' '));

  console.log('\n── resting fingers stay in the key ──');
  const rest = await page.evaluate(() => {
    const F = window.PPP.Fingering;
    return {
      f: F.restFingers({ 1: 65, 2: 67, 3: 69 }, 'r', -1).key,     /* F major: 4 over B flat */
      d: F.restFingers({ 3: 66 }, 'r', 2).key,                   /* D major, 3 on F sharp */
      c: F.restFingers({ 3: 64 }, 'r', 0).key
    };
  });
  ok('in F major the fourth finger rests over B flat, not B', rest.f[3] === 70, 'fingers over ' + rest.f.join(' '));
  ok('in D major the hand around F sharp is D E F# G A', rest.d.join() === '62,64,66,67,69', rest.d.join(' '));
  ok('in C the hand around E is C D E F G', rest.c.join() === '60,62,64,65,67', rest.c.join(' '));

  const tiedFinger = await page.evaluate(() => {
    const notes = [
      { abs: 0, dur: 4, midi: 60, hand: 'l', tieStart: true },
      { abs: 4, dur: 4, midi: 60, hand: 'l', tieStop: true }
    ];
    const H = window.PPP.Fingering.plan({ notes, _byNumber: {} }).hands.l;
    return { events: H.events.length, end: H.events[0].end, until: H.events[0].until[0] };
  });
  ok('a finger stays down through a tie instead of jumping to the next note',
    tiedFinger.events === 1 && tiedFinger.end === 8 && tiedFinger.until === 8,
    JSON.stringify(tiedFinger));
  const shortVisualHold = await page.evaluate(() => {
    const notes = [
      { abs: 0, dur: 0.125, midi: 64, hand: 'r' },
      { abs: 0.125, dur: 0.125, midi: 65, hand: 'r' }
    ];
    const H = window.PPP.Fingering.plan({ notes, _byNumber: {} }).hands.r;
    return H.events.map(e => e.end);
  });
  ok('short notes keep the hand on the same visual window as the score',
    shortVisualHold.length === 2 &&
      Math.abs(shortVisualHold[0] - 0.25) < 1e-6 &&
      Math.abs(shortVisualHold[1] - 0.375) < 1e-6,
    shortVisualHold.join(', '));

  console.log('\n── the hand is drawn on the keys it plays ──');
  const drawn = await page.evaluate(() => {
    const F = window.PPP.Fingering;
    /* C–E–G–C in F minor, repeated: E to G is a stretch for 2 and 3 by the
       table, and once made the drawn hand fall back to a made-up position */
    const notes = [];
    for (let i = 0; i < 8; i++) [60, 64, 67, 72].forEach(m => notes.push({ abs: i * 0.25, dur: 0.25, midi: m, hand: 'r', m: 20 }));
    const plan = F.plan({ notes, _byNumber: { 20: { key: { fifths: -4 } } } });
    const e = plan.hands.r.events[0], pose = plan.hands.r.poses[e.pose];
    /* and every onset of a piece full of wide chords */
    let seed = 11;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const wide = [];
    let m = 64;
    for (let i = 0; i < 400; i++) {
      m = Math.max(48, Math.min(84, m + Math.round((rnd() - 0.5) * 9)));
      wide.push({ abs: i / 2, dur: 0.5, midi: m, hand: 'r' });
      const k = rnd() < 0.4 ? 1 + Math.floor(rnd() * 3) : 0;
      for (let c = 0; c < k; c++) wide.push({ abs: i / 2, dur: 0.5, midi: m + [3, 4, 7, 8, 12][Math.floor(rnd() * 5)] + c, hand: 'r' });
      wide.push({ abs: i / 2, dur: 0.5, midi: m - 12 - Math.floor(rnd() * 12), hand: 'l' });
    }
    const off = (sc) => {
      const p = F.plan(sc);
      let n = 0, bad = 0;
      ['r', 'l'].forEach(h => p.hands[h].events.forEach(ev => {
        const ps = p.hands[h].poses[ev.pose];
        n++;
        if (!ev.fingers.every((f, j) => !f || (ps.key[f - 1] === ev.midi[j] && ps.played[f - 1]))) bad++;
      }));
      return n + ' onsets, ' + bad + ' off';
    };
    return { fingers: e.fingers.join(''), keys: pose.key.join(','), played: pose.played.map(Number).join(''),
      wide: off({ notes: wide, _byNumber: {} }), demo: off(window.PPP.buildDemoScore()) };
  });
  ok('C–E–G–C in F minor puts 1 2 3 5 on C E G C', drawn.fingers === '1235' && drawn.played === '11101' &&
    drawn.keys.split(',').filter((k, i) => drawn.played[i] === '1').join() === '60,64,67,72', 'hand over ' + drawn.keys);
  ok('every onset of a piece of wide chords is drawn on its own keys', / 0 off$/.test(drawn.wide), drawn.wide);
  ok('and every onset of the demo', / 0 off$/.test(drawn.demo), drawn.demo);

  console.log('\n── every visible hand shape ──');
  const shapes = await page.evaluate(() => {
    const A = window.PPP.HandArt, KW = 34, H = 148;
    /* Natural five-finger position, mixed black/white keys, and a wide chord.
       For both hands, visit every one of the 2^5 played/resting combinations. */
    const positions = [
      [0, 1, 2, 3, 4],
      [0, 0.5, 1.5, 2, 3.5],
      [-2, 0, 2, 4, 6]
    ];
    let count = 0, invalid = 0, offKey = 0;
    ['l', 'r'].forEach(hand => positions.forEach(x => {
      for (let mask = 0; mask < 32; mask++) {
        const played = x.map((_, i) => !!(mask & (1 << i)));
        const g = A.geometry(x, played, hand, KW, H);
        const fingers = [1, 2, 3, 4, 5].map(f => f === 1
          ? A.finger(g.thumbRoot, g.thumbBend, g.tip[0], A.WIDTH[0], A.TIP[0])
          : A.finger(g.root[f], g.bend[f], g.tip[f - 1], A.WIDTH[f - 1], A.TIP[f - 1]));
        const paths = [A.smooth(g.palm), g.palmEdge].concat(g.web, g.detail)
          .concat(fingers.flatMap(f => [f.body, f.side, f.nail].concat(f.crease)));
        if (paths.some(d => !d || /NaN|Infinity|undefined/.test(d))) invalid++;
        if (g.tip.some((p, i) => Math.abs(p[0] - (x[i] + 0.5) * KW) > 1e-6)) offKey++;
        count++;
      }
    }));
    return { count, invalid, offKey };
  });
  ok('left and right hands render all 192 finger combinations', shapes.count === 192 && shapes.invalid === 0,
    shapes.count + ' shapes, ' + shapes.invalid + ' invalid');
  ok('every fingertip stays centred on its assigned key', shapes.offKey === 0, shapes.offKey + ' off-key shapes');

  console.log('\n── the whole demo piece ──');
  const demo = await page.evaluate(() => {
    const sc = window.PPP.buildDemoScore();
    const t0 = performance.now();
    const plan = window.PPP.Fingering.plan(sc);
    const ms = performance.now() - t0;
    const struck = sc.notes.filter(n => !n.rest && n.hand !== 'x');
    let slips = 0, chords = 0;
    ['r', 'l'].forEach(h => plan.hands[h].events.forEach((e, i, evs) => {
      const fs = e.fingers.filter(Boolean);
      const order = fs.slice().sort((a, b) => h === 'r' ? a - b : b - a);
      if (fs.join() !== order.join() || new Set(fs).size !== fs.length) chords++;
      const p = evs[i - 1];
      if (p && p.midi.length === 1 && e.midi.length === 1 && p.fingers[0] === e.fingers[0] && p.midi[0] !== e.midi[0] && e.at - p.end < 1e-6) slips++;
    }));
    return { ms, struck: struck.length, fingered: struck.filter(n => plan.finger.get(n) >= 1 && plan.finger.get(n) <= 5).length, slips, chords };
  });
  ok('every note of the demo gets a finger', demo.fingered === demo.struck, demo.fingered + ' of ' + demo.struck);
  ok('chords use each finger once, in order along the keys', demo.chords === 0, demo.chords + ' out of order');
  ok('no finger slides from one key to the next in a connected line', demo.slips === 0, demo.slips + ' slide(s)');
  ok('and it is quick', demo.ms < 400, Math.round(demo.ms) + ' ms');

  console.log('\n── a finger printed on the page is kept ──');
  const printed = await page.evaluate(() => {
    const note = (step, oct, fing) => '<note><pitch><step>' + step + '</step><octave>' + oct + '</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type>' +
      (fing ? '<notations><technical><fingering>' + fing + '</fingering></technical></notations>' : '') + '</note>';
    const xml = '<?xml version="1.0"?><score-partwise version="3.1"><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>' +
      '<part id="P1"><measure number="1"><attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>' +
      note('C', 4, 2) + note('D', 4) + note('E', 4) + note('F', 4, 5) + '</measure></part></score-partwise>';
    const sc = window.PPP.parseMusicXML(xml, 'fingered.musicxml');
    const plan = window.PPP.Fingering.plan(sc);
    return { read: sc.notes.map(n => n.finger || 0).join(' '), used: sc.notes.map(n => plan.finger.get(n)).join(' ') };
  });
  ok('the parser reads <fingering>', printed.read === '2 0 0 5', printed.read);
  ok('and the guide plays it as printed, fitting the rest around it', /^2 \d \d 5$/.test(printed.used) && printed.used !== '2 2 2 5', printed.used);

  console.log('\n── on the practice page ──');
  await page.evaluate(() => window.__pppTest.practice());
  await sleep(1000);
  const p0 = await picture(page);
  ok('both hands are drawn over the keyboard', p0.hands.join() === 'l,r', p0.hands.join(', '));
  ok('each hand uses a loaded illustrated pose', p0.arts.length === 2 && p0.arts.every(a => /\/assets\/hands\/hand-right-.+\.png(?:\?.*)?$/.test(a.href) && a.width > 0 && a.height > 0), p0.arts.map(a => a.pose).join(', '));
  const naturalAspect = p0.arts.every(a => {
    const m = /scale\((-?[\d.]+) ([\d.]+)\)/.exec(a.transform || '');
    return m && Math.abs(Math.abs(+m[1]) - Math.abs(+m[2])) < 0.0001;
  });
  ok('illustrated hands keep their natural aspect ratio', naturalAspect, p0.arts.map(a => a.transform).join(' | '));
  const wristSizes = p0.arts.map(a => a.wrist).filter(Boolean);
  ok('left and right illustrated hands use one physical size', wristSizes.length === 2 && Math.max(...wristSizes) / Math.min(...wristSizes) <= 1.01, wristSizes.map(n => n.toFixed(1)).join(', '));
  ok('playing markers sit on the illustrated fingertips', p0.now.every(n => n.artOffset <= 8), p0.now.map(n => n.artOffset).join(', '));
  ok('key names stay below the hand and finger-number layer', p0.labelsBelowHands === true);
  ok('the keyboard grows a strip below the keys for the palms', p0.viewH > 148, 'viewBox height ' + p0.viewH);
  ok('the toggle says the guide is on', p0.button === 'true');
  ok('the finger numbers are explained under the keyboard', p0.legend === true);
  ok('a finger is marked to play', p0.now.length > 0, p0.now.map(n => n.hand + n.finger).join(' '));
  const pausedKeys = [...new Set(p0.now.map(n => n.midi))].sort((a, b) => a - b);
  ok('while paused, the keyboard and both hands show the same complete onset',
    p0.sounding.length === 0 && pausedKeys.join() === p0.expected.join(),
    'keys ' + p0.expected.join(',') + ', fingers ' + pausedKeys.join(',') + ', sounding ' + p0.sounding.join(','));
  const overlappingHands = await page.evaluate(() => {
    let logic = null;
    for (const el of [...document.querySelectorAll('*')]) {
      const key = Object.keys(el).find(k => k.indexOf('__reactFiber') === 0);
      if (!key) continue;
      let fiber = el[key], depth = 0;
      while (fiber && depth++ < 60) {
        const stateNode = fiber.stateNode, candidate = stateNode && stateNode.logic;
        if (candidate && candidate.state && candidate.state.score && typeof candidate.guideOnset === 'function') { logic = candidate; break; }
        fiber = fiber.return;
      }
      if (logic) break;
    }
    if (!logic) return null;
    const saved = logic.state;
    logic.state = Object.assign({}, saved, { playing: true, beat: 81.1, hands: 'both' });
    const sort = a => a.slice().sort((x, y) => x - y);
    const result = {
      left: logic.guideOnset('l'), right: logic.guideOnset('r'),
      expected: sort(logic.expected()), lit: sort(logic.litNotes())
    };
    logic.state = saved;
    return result;
  });
  ok('overlapping hand durations keep each hand on its own current onset',
    !!overlappingHands && overlappingHands.left === 80 && overlappingHands.right === 81 &&
      overlappingHands.expected.join() === '48,55,81' && overlappingHands.lit.join() === '48,55,81',
    JSON.stringify(overlappingHands));

  console.log('\n── following a MIDI keyboard ──');
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('main button, main span')].find(x => /Demo Input/.test((x.innerText || '').trim()));
    if (b) b.click();
  });
  await sleep(1400);
  let moves = 0, matched = 0, chordSeen = false, maxArtOffset = 0;
  let last = null;
  for (let step = 0; step < 14; step++) {
    const p = await picture(page);
    if (!p.expected.length) break;
    const under = [...new Set(p.now.map(n => n.midi))].sort((a, b) => a - b);
    if (under.join() === p.expected.join()) matched++;
    else ok('the fingers marked to play lie on the keys it asks for (step ' + (step + 1) + ')', false,
      'asks for ' + p.expected.join(',') + ', fingers on ' + under.join(','));
    if (p.expected.length > 1) chordSeen = true;
    p.now.forEach(n => { maxArtOffset = Math.max(maxArtOffset, n.artOffset || 0); });
    if (last && under.join() !== last) moves++;
    last = under.join();
    await page.evaluate(ms => ms.forEach(m => window.__press(m)), p.expected);
    await sleep(260);
    await page.evaluate(ms => ms.forEach(m => window.__release(m)), p.expected);
    await sleep(160);
  }
  ok('at every step the fingers marked to play lie on exactly the keys it asks for', matched >= 10, matched + ' of the steps');
  ok('and they move on as the right keys are played', moves >= 5, moves + ' moves');
  ok('a chord marks one finger per key', chordSeen, chordSeen ? 'seen' : 'no chord in these steps');
  ok('the markers stay on the drawn fingertips while following', maxArtOffset <= 8, 'maximum offset ' + maxArtOffset.toFixed(1));

  console.log('\n── one hand at a time ──');
  await clickText(page, /^(Right|Right hand)$/);
  await sleep(500);
  const pr = await picture(page);
  ok('practising the right hand draws only the right hand', pr.hands.join() === 'r', pr.hands.join(', ') || 'none');
  await clickText(page, /^Both Hands$/i);
  await sleep(400);

  console.log('\n── it can be turned off, and stays off ──');
  await clickText(page, /^Show hands$/);
  await sleep(500);
  const off = await picture(page);
  ok('the hands go away', off.hands.length === 0);
  ok('and the keyboard is its old height', off.viewH === 148, 'viewBox height ' + off.viewH);
  ok('the toggle says so', off.button === 'false');
  ok('the finger legend goes with them', off.legend === false);
  await sleep(4600);   /* persistence is batched */
  await page.reload({ waitUntil: 'domcontentloaded' });
  await sleep(3000);
  await page.evaluate(() => window.__pppTest.practice());
  await sleep(1000);
  const again = await picture(page);
  ok('still off after a reload', again.hands.length === 0 && again.button === 'false');
  await clickText(page, /^Show hands$/);
  await sleep(500);
  const back = await picture(page);
  ok('and back on with one click', back.hands.length === 2 && back.button === 'true');
  await page.screenshot({ path: 'tests/.shots/hand-guide.png' });

  console.log('\n── drawn the way you want it ──');
  const handset = () => page.evaluate(() => ({
    see: (document.querySelector('.ppp-handset input[type=range]') || {}).value,
    opacity: [...document.querySelectorAll('.ppp-hand-skin')].map(g => +g.getAttribute('opacity')),
    badges: [...document.querySelectorAll('.ppp-hand [data-finger]')].map(g => g.getAttribute('data-finger-state')),
    outlines: document.querySelectorAll('.ppp-hand [data-finger-outline]').length,
    names: document.querySelectorAll('.ppp-hand [data-hand-name]').length,
    legend: /1 thumb · 2 index/.test(document.querySelector('main').innerText)
  }));
  const h0 = await handset();
  ok('the hands start 45% see-through', h0.see === '45' && h0.opacity.every(o => Math.abs(o - 0.55) < 1e-6), h0.see + '%, opacity ' + h0.opacity.join(', '));
  ok('with all five numbers on each hand', h0.badges.length === 10, h0.badges.length + ' numbers');
  ok('and each hand named', h0.names === 2);
  await page.evaluate(() => {
    const r = document.querySelector('.ppp-handset input[type=range]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(r, '70');
    r.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await sleep(300);
  const h1 = await handset();
  ok('the slider makes the hands more see-through', h1.see === '70' && h1.opacity.every(o => Math.abs(o - 0.3) < 1e-6), 'opacity ' + h1.opacity.join(', '));
  await clickText(page, /^Playing only$/);
  await sleep(300);
  const h2 = await handset();
  ok('"Playing only" numbers just the fingers to play', h2.badges.length > 0 && h2.badges.every(b => b !== 'rest'), h2.badges.join(', '));
  await clickText(page, /^Off$/);
  await sleep(300);
  const h3 = await handset();
  ok('"Off" draws no numbers', h3.badges.length === 0);
  ok('but the finger to play is still outlined', h3.outlines > 0, h3.outlines + ' outlined');
  ok('and the number key under the keyboard goes too', h3.legend === false);
  await clickText(page, /^Left \/ right labels$/);
  await sleep(300);
  const h4 = await handset();
  ok('the hand names can be hidden', h4.names === 0);
  await sleep(4600);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await sleep(3000);
  await page.evaluate(() => window.__pppTest.practice());
  await sleep(1000);
  const h5 = await handset();
  ok('all of it is remembered after a reload', h5.see === '70' && h5.badges.length === 0 && h5.names === 0,
    h5.see + '%, ' + h5.badges.length + ' numbers, ' + h5.names + ' names');
  await clickText(page, /^All$/);
  await clickText(page, /^Left \/ right labels$/);
  await sleep(300);
  const h6 = await handset();
  ok('and one click each puts the numbers and names back', h6.badges.length === 10 && h6.names === 2);

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
  console.log('The hand guide fingers like a piano book and points at the keys PPP asks for.');
})().catch(e => { console.error(e); process.exit(1); });
