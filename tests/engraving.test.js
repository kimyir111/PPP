/* ============================================================================
   ENGRAVING — a score read from a PDF is drawn so it can be read.

   An OMR pass of a real piano score produced everything in the fixture: two
   voices sharing a staff with nothing to tell their stems apart, a run of
   sixteenths with accidentals, a bar that holds more than its time signature
   allows, a voice that begins half a beat late, triplets, a left hand that
   changes clef halfway through a bar, and repeats with first and second
   endings. Drawn naively, notes ran over the bar line into the next bar, the
   voices sat on top of each other, the repeats were not drawn at all, and the
   time signature was printed at the head of every line.

   This checks the drawing itself: every note head inside its own bar, no two
   note heads on top of each other, the upper of two voices stemmed up and the
   lower down, the clef change drawn where it happens, the triplets marked,
   the repeat signs and endings drawn where the file puts them, the time
   signature printed once, and nothing outside the page.
   ========================================================================== */

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const { preparePage } = require('./boot');

const URL = 'http://127.0.0.1:8777/Piano%20Coach%20App.dc.html';
const errors = [];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ok = (name, cond, detail) => {
  console.log((cond ? '  ✓ ' : '  ✗ ') + name + (detail ? ' — ' + detail : ''));
  if (!cond) errors.push(name + (detail ? ' — ' + detail : ''));
};

const openPractice = page => page.evaluate(() => {
  const b = [...document.querySelectorAll('aside nav button')]
    .find(x => /^(Practice|연습)$/.test(((x.innerText || '').trim().split('\n')[0] || '').trim()));
  if (b) b.click();
  return !!b;
});

/* Everything the checks need, read from the drawn page. */
const survey = page => page.evaluate(() => {
  const svg = document.querySelector('.ppp-staffwrap svg');
  if (!svg || !svg.__ppp) return null;
  /* G4f-2: in the SVG's own units, through the element's own transform - getBBox() leaves that out. The legacy renderer
     puts no transform on these elements (its boxes are unchanged); the engraver places a scaled glyph - the smaller clef of
     a change inside a bar - as <use transform="translate(x y) scale(0.67)">, whose getBBox() alone reads the glyph at the
     origin (x 0). The page draws it with <use> since G4-D2-21; this read it as "0 clefs inside bar 2" (G04 §39.7, §43). */
  const box = e => {
    const b = e.getBBox();
    const tl = e.transform && e.transform.baseVal;
    const t = tl && tl.numberOfItems ? tl.consolidate().matrix : null;
    if (!t) return { x: b.x, y: b.y, w: b.width, h: b.height };
    const xs = [], ys = [];
    [[b.x, b.y], [b.x + b.width, b.y], [b.x, b.y + b.height], [b.x + b.width, b.y + b.height]].forEach(([x, y]) => {
      xs.push(t.a * x + t.c * y + t.e); ys.push(t.b * x + t.d * y + t.f);
    });
    return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
  };
  const heads = [];
  svg.querySelectorAll('g.ppp-note[data-onset]').forEach((g, gi) => {
    const [m, beat, staff] = g.getAttribute('data-onset').split('|');
    const st = g.querySelector('.vf-stem');
    const hs = [...g.querySelectorAll('.vf-notehead')].map(box);
    hs.forEach(b => heads.push({ g: gi, m: +m, beat: +beat, staff: +staff, b: b,
      stem: st ? box(st) : null, groupTop: Math.min.apply(null, hs.map(h => h.y)) }));
  });
  const staves = [...svg.querySelectorAll('g.ppp-stave')].map(g => ({
    m: +g.getAttribute('data-m'), staff: +g.getAttribute('data-staff'),
    begin: g.getAttribute('data-begin'), end: g.getAttribute('data-end'),
    volta: g.getAttribute('data-volta'), time: g.getAttribute('data-time'), b: box(g)
  }));
  const clefs = [...svg.querySelectorAll('.vf-clef')].map(box);
  const vb = svg.viewBox.baseVal;
  return {
    /* G4d-2: which renderer drew it (the engraver's SVG is svg.ppp-engraved - the default renderer since the G4f-2 flip;
       ?renderer=legacy draws the legacy one) */
    engraved: svg.classList.contains('ppp-engraved'),
    layout: svg.__ppp, heads: heads, staves: staves, clefs: clefs,
    tuplets: svg.querySelectorAll('g.ppp-tuplet').length,
    page: { w: vb.width }, drawn: box(svg)
  };
});

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const pageErrors = [];
  const warnings = [];

  /* the fixture is stored the way the app stores an imported score */
  const seed = await browser.newPage();
  await preparePage(seed);
  await seed.goto(URL, { waitUntil: 'domcontentloaded' });
  await seed.waitForFunction(() => window.PPP && window.PPP.parseMusicXML, { timeout: 25000 });
  const xml = fs.readFileSync(path.join(__dirname, 'fixtures', 'engraving-stress.musicxml'), 'utf8');
  const parsed = await seed.evaluate(x => {
    const sc = PPP.parseMusicXML(x, 'engraving-stress.musicxml');
    return {
      saved: JSON.stringify({ score: sc }),
      bars: sc.measures.map(mm => ({ m: mm.number, bar: mm.bar || null, clefs: mm.clefs, changes: mm.clefChanges || null })),
      tuplets: sc.notes.filter(n => n.tm).length
    };
  }, xml);
  await seed.close();

  console.log('\n── what the file says ─────────────────');
  const barOf = n => parsed.bars.filter(b => b.m === n)[0] || {};
  ok('the start repeat is read', !!(barOf(5).bar && barOf(5).bar.repeatStart));
  ok('the end repeat and first ending are read',
    !!(barOf(6).bar && barOf(6).bar.repeatEnd && barOf(6).bar.ending === '1.' && barOf(6).bar.endingEnd === 'stop'),
    JSON.stringify(barOf(6).bar));
  ok('the second ending is read, left open',
    !!(barOf(7).bar && barOf(7).bar.ending === '2.' && barOf(7).bar.endingEnd === 'open'), JSON.stringify(barOf(7).bar));
  ok('the final bar line is read', !!(barOf(8).bar && barOf(8).bar.style === 'light-heavy'));
  ok('bar 2 begins in treble on the lower staff and changes to bass on beat 2',
    barOf(2).clefs && barOf(2).clefs[2] === 'treble' && (barOf(2).changes || []).some(c => c.staff === 2 && c.clef === 'bass' && Math.abs(c.b - 1) < 1e-6),
    JSON.stringify({ clefs: barOf(2).clefs, changes: barOf(2).changes }));
  ok('bar 3 begins in bass: the change carries over', barOf(3).clefs && barOf(3).clefs[2] === 'bass');
  ok('the triplets are read', parsed.tuplets === 6, parsed.tuplets + ' notes');

  const page = await browser.newPage();
  await page.evaluateOnNewDocument(s => { try { localStorage.setItem('ppp.state.v2', s); } catch (e) {} }, parsed.saved);
  await preparePage(page);
  await page.setViewport({ width: 1600, height: 1000 });
  page.on('pageerror', e => pageErrors.push(e.message));
  page.on('console', m => { if (/engraving failed/.test(m.text())) warnings.push(m.text()); });
  await page.goto(URL, { waitUntil: 'networkidle2' });
  await page.waitForFunction(() => window.PPP && window.PPP.Score, { timeout: 25000 });
  await sleep(1200);
  await openPractice(page);
  await sleep(3500);

  const on = await page.evaluate(() => (document.querySelector('main') || document.body).innerText.indexOf('Engraving Stress') > -1);
  ok('the fixture is the score on screen', on);
  const d = await survey(page);
  ok('the score is engraved', !!d && d.heads.length > 40, d ? d.heads.length + ' note heads' : 'no staff');
  if (d) {
    console.log('\n── the page ───────────────────────────');
    /* G4d-2: four bars to a line is the legacy renderer's rule; the engraver follows the user's G4-U4 - four is the preference and
       density wins (a line of sparse bars may hold more, never a bar twice or out of order; G04 §15.2, §33.8) */
    if (!d.engraved) ok('lines hold at most four bars', d.layout.rows.every(r => r.length <= 4), JSON.stringify(d.layout.rows));
    else ok('lines hold every bar once, in order, four to a line by preference (G4-U4: at most six)',
      d.layout.rows.every(r => r.length <= 6) && [].concat.apply([], d.layout.rows).join() === d.layout.bars.map(b => b.m).join(), JSON.stringify(d.layout.rows));
    ok('nothing is drawn past the edge of the page', d.drawn.x + d.drawn.w <= d.page.w + 2,
      'drawn to ' + Math.round(d.drawn.x + d.drawn.w) + ' of ' + Math.round(d.page.w));

    console.log('\n── the notes ──────────────────────────');
    const bars = {};
    d.layout.bars.forEach(b => { bars[b.m] = b; });
    const outside = d.heads.filter(h => {
      const b = bars[h.m];
      return !b || h.b.x < b.x - 1 || h.b.x + h.b.w > b.x + b.w + 1;
    });
    ok('every note head is inside its own bar', outside.length === 0,
      outside.length ? outside.length + ', e.g. bar ' + outside[0].m + ' beat ' + (outside[0].beat + 1) : d.heads.length + ' checked');
    ok('the bar that holds more than four beats stays inside its bar lines',
      !outside.some(h => h.m === 3), d.heads.filter(h => h.m === 3).length + ' heads in bar 3');

    /* two heads from different notes that cover each other */
    const hits = [];
    for (let i = 0; i < d.heads.length; i++) {
      for (let j = i + 1; j < d.heads.length; j++) {
        const a = d.heads[i], b = d.heads[j];
        if (a.g === b.g || a.staff !== b.staff || a.m !== b.m) continue;
        const ix = Math.min(a.b.x + a.b.w, b.b.x + b.b.w) - Math.max(a.b.x, b.b.x);
        const iy = Math.min(a.b.y + a.b.h, b.b.y + b.b.h) - Math.max(a.b.y, b.b.y);
        if (ix <= 0 || iy <= 0) continue;
        const small = Math.min(a.b.w * a.b.h, b.b.w * b.b.h);
        if (ix * iy > 0.3 * small) hits.push(a.m + '|' + (a.beat + 1) + '~' + (b.beat + 1));
      }
    }
    ok('no note head sits on top of another', hits.length === 0, hits.length ? hits.slice(0, 4).join(', ') : 'none');

    /* bar 1: D5 over C5 on the downbeat, two voices */
    const down = d.heads.filter(h => h.m === 1 && h.staff === 1 && h.beat === 0);
    const groups = {};
    down.forEach(h => { groups[h.g] = h; });
    const gs = Object.keys(groups).map(k => groups[k]).sort((a, b) => a.b.y - b.b.y);
    const dir = h => !h.stem ? '?' : (h.stem.y + h.stem.h / 2 < h.b.y + h.b.h / 2 ? 'up' : 'down');
    ok('two voices on one staff: the upper stemmed up, the lower down',
      gs.length === 2 && dir(gs[0]) === 'up' && dir(gs[1]) === 'down', gs.map(dir).join(' / '));

    /* bar 2: after the clef change the left hand stays on its own staff */
    const lower2 = d.staves.filter(s => s.m === 2 && s.staff === 2)[0];
    const late = d.heads.filter(h => h.m === 2 && h.staff === 2 && h.beat >= 1);
    /* half a note head of slack: a note on the outer line pokes out that far */
    const inStaff = late.every(h => lower2 && h.b.y >= lower2.b.y - 8 && h.b.y + h.b.h <= lower2.b.y + lower2.b.h + 8);
    ok('after the clef change the left hand is drawn on its own staff', late.length > 0 && inStaff,
      late.length + ' notes after beat 2');
    const bar2 = bars[2];
    const midClef = d.clefs.filter(c => bar2 && c.x > bar2.x + 4 && c.x < bar2.x + bar2.w);
    ok('the clef change is drawn inside bar 2', midClef.length === 1, midClef.length + ' clef(s)');

    ok('both triplets are marked', d.tuplets === 2, d.tuplets + ' marked');

    console.log('\n── the marks ──────────────────────────');
    const st = (m, staff) => d.staves.filter(s => s.m === m && s.staff === (staff || 1))[0] || {};
    ok('the start repeat is drawn on bar 5', st(5).begin === 'repeat' && st(5, 2).begin === 'repeat');
    ok('the end repeat is drawn on bar 6', st(6).end === 'repeat' && st(6, 2).end === 'repeat');
    ok('the first ending is drawn over bar 6, closed', st(6).volta === 'BEGIN_END:1.', st(6).volta);
    ok('the second ending is drawn over bar 7, open', st(7).volta === 'BEGIN:2.', st(7).volta);
    ok('the endings are drawn over the top staff only', !st(6, 2).volta && !st(7, 2).volta);
    ok('the piece ends with a final bar line', st(8).end === 'final');
    const times = d.staves.filter(s => s.time);
    ok('the time signature is printed once, at the start',
      times.length === 2 && times.every(s => s.m === 1), times.map(s => s.m + ':' + s.staff).join(', '));
  }

  ok('no page errors', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | ') || 'clean');
  ok('nothing failed to engrave', warnings.length === 0, warnings.slice(0, 1).join('') || 'clean');

  console.log('\n── dark theme labels ──────────────────');
  const clickSetting = lab => page.evaluate(name => {
    const labs = [...document.querySelectorAll('div')].filter(d => (d.textContent || '').trim() === name);
    const el = labs[labs.length - 1];
    const row = el && el.parentElement && el.parentElement.parentElement;
    const btn = row && row.querySelector('button');
    if (!btn) return false;
    btn.click();
    return true;
  }, lab);
  await page.evaluate(() => window.__pppTest.nav('Settings'));
  await sleep(400);
  ok('dark mode can be switched on', await clickSetting('Dark mode'));
  ok('paper can be switched off', await clickSetting('Keep the score on paper'));
  await page.evaluate(() => window.__pppTest.nav('Practice'));
  await sleep(400);
  await page.evaluate(() => {
    const tab = [...document.querySelectorAll('main [role=tab]')].find(x => /Start to finish/.test(x.textContent || ''));
    if (tab) tab.click();
  });
  await sleep(500);
  await page.evaluate(() => {
    const whole = [...document.querySelectorAll('button')].find(x => (x.textContent || '').trim() === 'Whole score');
    if (!whole) return;
    const on = /var\(--accent\)/.test(whole.getAttribute('style') || '');
    if (!on) whole.click();
  });
  await sleep(2800);
  const dark = await page.evaluate(() => {
    const svg = document.querySelector('.ppp-staffwrap svg');
    if (!svg) return null;
    const lumOf = c => {
      const s = String(c || '');
      let r, g, b;
      const rgb = s.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i);
      if (rgb) { r = +rgb[1]; g = +rgb[2]; b = +rgb[3]; }
      else {
        const hex = s.match(/^#([0-9a-f]{3,8})$/i);
        if (!hex) return 0;
        let h = hex[1];
        if (h.length === 3 || h.length === 4) h = h.split('').map(ch => ch + ch).join('');
        r = parseInt(h.slice(0, 2), 16); g = parseInt(h.slice(2, 4), 16); b = parseInt(h.slice(4, 6), 16);
      }
      return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    };
    const anns = [...svg.querySelectorAll('text.ppp-ann')].map(t => {
      const fill = getComputedStyle(t).fill;
      return { text: (t.textContent || '').trim(), fill: fill, lum: lumOf(fill) };
    });
    return {
      theme: document.querySelector('[data-app]').getAttribute('data-app'),
      tempo: anns.filter(a => /=\s*\d+/.test(a.text))[0] || null,
      composer: anns.filter(a => /PPP tests/i.test(a.text))[0] || null,
      bars: anns.filter(a => /^\d+$/.test(a.text))
    };
  });
  ok('the page is in dark mode without paper', !!(dark && dark.theme === 'dark'), dark ? dark.theme : 'no score');
  ok('the tempo mark is light on a dark score', !!(dark && dark.tempo && dark.tempo.lum > 0.7),
    dark && dark.tempo ? dark.tempo.fill + ' lum=' + dark.tempo.lum.toFixed(2) : 'missing');
  ok('the composer is light on a dark score', !!(dark && dark.composer && dark.composer.lum > 0.7),
    dark && dark.composer ? dark.composer.fill + ' lum=' + dark.composer.lum.toFixed(2) : 'missing');
  ok('bar numbers are light on a dark score', !!(dark && dark.bars.length && dark.bars.every(b => b.lum > 0.7)),
    dark && dark.bars.length ? dark.bars.slice(0, 4).map(b => b.text + '=' + b.lum.toFixed(2)).join(', ') : 'missing');
  const SHOTS = path.join(__dirname, '.shots');
  fs.mkdirSync(SHOTS, { recursive: true });
  const staff = await page.$('.ppp-staffwrap');
  if (staff) await staff.screenshot({ path: path.join(SHOTS, 'engraving-dark-labels.png') });
  else await page.screenshot({ path: path.join(SHOTS, 'engraving-dark-labels.png'), fullPage: false });

  const chordTiePaths = await page.evaluate(async () => {
    const xml = '<?xml version="1.0"?><score-partwise version="3.1">' +
      '<part-list><score-part id="P1"><part-name>P</part-name></score-part></part-list><part id="P1">' +
      '<measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time>' +
      '<clef><sign>G</sign><line>2</line></clef></attributes>' +
      '<note><pitch><step>C</step><octave>5</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type>' +
      '<tie type="start"/><notations><tied type="start"/></notations></note>' +
      '<note><chord/><pitch><step>E</step><octave>5</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type></note>' +
      '<note><pitch><step>C</step><octave>5</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type>' +
      '<tie type="stop"/><notations><tied type="stop"/></notations></note>' +
      '<note><chord/><pitch><step>F</step><octave>5</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type></note>' +
      '<note><rest/><duration>2</duration><voice>1</voice><type>half</type></note></measure></part></score-partwise>';
    const score = PPP.parseMusicXML(xml, 'one-chord-tone-tied.musicxml');
    await new Promise(resolve => PPP.app.setState({
      score: score, screen: 'player', beat: 0, playing: false,
      loop: false, loopFrom: 1, loopTo: 1
    }, resolve));
    await new Promise(resolve => setTimeout(resolve, 300));
    const svg = document.querySelector('.ppp-staffwrap svg');
    /* G4d-2: VexFlow draws a tie as a path inside g.vf-stavetie, the engraver as path.vf-stavetie itself (G04 §16.4) */
    return svg ? svg.querySelectorAll('.vf-stavetie path, path.vf-stavetie').length : -1;
  });
  ok('a partial chord tie curves only the pitch that actually continues', chordTiePaths === 1,
    chordTiePaths + ' tie path(s)');

  const inferredTiePaths = await page.evaluate(async () => {
    const xml = '<?xml version="1.0"?><score-partwise version="3.1">' +
      '<part-list><score-part id="P1"><part-name>P</part-name></score-part></part-list><part id="P1">' +
      '<measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time>' +
      '<clef><sign>G</sign><line>2</line></clef></attributes>' +
      '<note><pitch><step>C</step><octave>5</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type>' +
      '<tie type="start"/><notations><tied type="start"/></notations></note>' +
      '<note><pitch><step>C</step><octave>5</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type>' +
      '<tie type="stop"/><notations><tied type="stop"/></notations></note>' +
      '<note><rest/><duration>2</duration><voice>1</voice><type>half</type></note></measure></part></score-partwise>';
    const score = PPP.parseMusicXML(xml, 'inferred-audio.xml');
    score.source = { kind: 'youtube', status: 'transcribed', amt: 'ensemble', transcriptionVersion: PPP.TRANSCRIPTION_VERSION };
    await new Promise(resolve => PPP.app.setState({
      score: score, screen: 'player', beat: 0, playing: false,
      loop: false, loopFrom: 1, loopTo: 1
    }, resolve));
    await new Promise(resolve => setTimeout(resolve, 300));
    const svg = document.querySelector('.ppp-staffwrap svg');
    return svg ? { n: svg.querySelectorAll('.vf-stavetie path, path.vf-stavetie').length, engraved: svg.classList.contains('ppp-engraved') } : { n: -1 };
  });
  /* G4d-2: the legacy renderer hides the tie PPP inferred inside a bar (G04 §4.5 O4); the engraver draws it, as the user
     decided (G4-U2 A: what playback and practice treat as one note the page shows as one, tied) */
  if (!inferredTiePaths.engraved) ok('audio inference does not present an intra-measure split as written legato',
    inferredTiePaths.n === 0, inferredTiePaths.n + ' tie path(s)');
  else ok('an inferred tie inside a bar is drawn, as playback and practice hear it (G4-U2 A)', inferredTiePaths.n === 1, inferredTiePaths.n + ' tie path(s)');

  /* MX-1: an octave line from a file is drawn as the page prints it - "8va" over the treble staff with its notes brought
     down onto the staff, "8vb" under the bass staff, "15ma" two octaves - while the notes sound where the file says
     (decision D-1: MusicXML's <pitch> sounds; the player's half is tests/playback-scheduler.test.js) */
  const e18 = fs.readFileSync(path.join(__dirname, 'engrave', 'fixtures', 'e', 'E18-ottava.musicxml'), 'utf8');
  /* G4d-2: the y of a staff's lines - VexFlow draws one path a line (M x yL x2 y) inside g.vf-stave, the engraver one
     path.vf-stave a staff (M x yH x2 M x y2H x2 ...) */
  await page.evaluate(() => {
    window.__lineYs = g => (g ? [...g.querySelectorAll('.vf-stave path, path.vf-stave')].flatMap(q => {
      const d = q.getAttribute('d') || '';
      return q.classList.contains('vf-stave') ? [...d.matchAll(/M[\d.]+ ([\d.]+)H/g)].map(m => +m[1]) : [+((/M[\d.]+ ([\d.]+)L/.exec(d) || [])[1])];
    }).filter(isFinite) : []);
  });
  const ott = await page.evaluate(async xml => {
    const lineYs = window.__lineYs;
    const score = PPP.parseMusicXML(xml, 'E18-ottava.musicxml');
    await new Promise(resolve => PPP.app.setState({
      score: score, screen: 'player', beat: 0, playing: false,
      loop: false, loopFrom: 1, loopTo: 3
    }, resolve));
    await new Promise(resolve => setTimeout(resolve, 400));
    const svg = document.querySelector('.ppp-staffwrap svg');
    if (!svg) return null;
    const lines = (m, st) => {
      const g = [...svg.querySelectorAll('g.ppp-stave')].find(x => x.getAttribute('data-m') === String(m) && x.getAttribute('data-staff') === String(st));
      const ys = lineYs(g);
      return ys.length ? { top: Math.min.apply(null, ys), bottom: Math.max.apply(null, ys) } : null;
    };
    const head = key => {
      const at = 'g.ppp-note[data-onset="' + key + '"] .vf-notehead';
      const h = svg.querySelector(at + ' path') || svg.querySelector(at);
      if (!h) return null;
      const b = h.getBBox();
      return b.y + b.height / 2;
    };
    const label = t => [...svg.querySelectorAll('text')].filter(x => x.textContent.trim() === t).map(x => { const b = x.getBBox(); return b.y + b.height / 2; });
    return { s1: lines(1, 1), s2: lines(1, 2), c6: head('1|0.000|1'), c2: head('1|0.000|2'),
      va: label('8va'), vb: label('8vb'), ma: label('15ma'), mb: label('15mb') };
  }, e18);
  ok('an 8va is labelled over the treble staff, an 8vb under the bass staff, a 15ma as two octaves',
    !!(ott && ott.s1 && ott.s2) && ott.va.some(y => y < ott.s1.top) && ott.vb.some(y => y > ott.s2.bottom) &&
      ott.ma.length > 0 && ott.mb.length === 0,
    ott ? JSON.stringify({ '8va': ott.va.map(Math.round), '8vb': ott.vb.map(Math.round), '15ma': ott.ma.length, '15mb': ott.mb.length,
      treble: ott.s1, bass: ott.s2 }) : 'no staff');
  ok('the C6 under the 8va and the C2 under the 8vb are drawn on their staves, where the page prints them (C5, C3)',
    !!(ott && ott.s1 && ott.s2 && ott.c6 != null && ott.c2 != null) &&
      ott.c6 >= ott.s1.top && ott.c6 <= ott.s1.bottom && ott.c2 >= ott.s2.top && ott.c2 <= ott.s2.bottom,
    ott ? 'C6 head at ' + Math.round(ott.c6) + ' (staff ' + (ott.s1 && ott.s1.top) + '-' + (ott.s1 && ott.s1.bottom) + '), C2 at ' +
      Math.round(ott.c2) + ' (staff ' + (ott.s2 && ott.s2.top) + '-' + (ott.s2 && ott.s2.bottom) + ')' : '');

  /* MX-1 fixer (R1): "This part" shows four bars of a line that starts before them and ends after them. Its notes are
     printed an octave below where they sound, so the line must be drawn over the bars shown - "(8va)", carried on from
     before, with no end hook - or the page would say C5 where the app plays C6. */
  const longLine = (() => {
    const bar = (m, inner) => '<measure number="' + m + '">' + (m === 1 ? '<attributes><divisions>1</divisions><key><fifths>0</fifths></key>' +
      '<time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef>' +
      '<clef number="2"><sign>F</sign><line>4</line></clef></attributes>' : '') + inner + '</measure>';
    const n = (step, oct, staff, dur, type) => '<note><pitch><step>' + step + '</step><octave>' + oct + '</octave></pitch><duration>' + dur +
      '</duration><voice>' + (staff === 1 ? 1 : 5) + '</voice><type>' + type + '</type><staff>' + staff + '</staff></note>';
    let body = '';
    for (let m = 1; m <= 8; m++) {
      body += bar(m, (m === 1 ? '<direction placement="above"><direction-type><octave-shift type="down" size="8"/></direction-type><staff>1</staff></direction>' : '') +
        n('C', 6, 1, 1, 'quarter') + n('E', 6, 1, 1, 'quarter') + n('G', 6, 1, 1, 'quarter') + n('C', 7, 1, 1, 'quarter') +
        (m === 8 ? '<direction><direction-type><octave-shift type="stop" size="8"/></direction-type><staff>1</staff></direction>' : '') +
        '<backup><duration>4</duration></backup>' + n('C', 3, 2, 4, 'whole'));
    }
    return '<?xml version="1.0"?><score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>' +
      '<part id="P1">' + body + '</part></score-partwise>';
  })();
  const part = await page.evaluate(async xml => {
    const lineYs = window.__lineYs;
    const score = PPP.scoreFromXml(xml, 'long-8va.musicxml');
    await new Promise(resolve => PPP.app.setState({
      score: score, screen: 'player', wholeScore: false, focus: false, beat: PPP.Score.startQ(score, 3), playing: false,
      loop: true, loopFrom: 3, loopTo: 6
    }, resolve));
    await new Promise(resolve => setTimeout(resolve, 500));
    const svg = document.querySelector('.ppp-staffwrap svg');
    if (!svg) return null;
    const bars = [...new Set([...svg.querySelectorAll('g.ppp-stave')].map(g => +g.getAttribute('data-m')))];
    const g = [...svg.querySelectorAll('g.ppp-stave')].find(x => x.getAttribute('data-m') === String(bars[0]) && x.getAttribute('data-staff') === '1');
    const ys = lineYs(g);
    const at = 'g.ppp-note[data-onset="' + bars[0] + '|0.000|1"] .vf-notehead';
    const h = svg.querySelector(at + ' path') || svg.querySelector(at);
    const hb = h ? h.getBBox() : null;
    /* G4d-2: the engraver labels a line carried on from before "(8)", the printed convention (G4-D1b-7, A10) */
    const labels = [...svg.querySelectorAll('text')].map(t => t.textContent.trim()).filter(t => /^\(?(8va|8vb|15ma|15mb)\)?$/.test(t) || /^\((8|15)\)$/.test(t));
    const dashes = [...svg.querySelectorAll('path.ppp-ottava')].map(q => q.getAttribute('d'));
    return { engraved: svg.classList.contains('ppp-engraved'), bars: bars, labels: labels, hooks: dashes.filter(d => (d.match(/ L /g) || []).length > 1).length, dashes: dashes.length,
      top: ys.length ? Math.min.apply(null, ys) : null, bottom: ys.length ? Math.max.apply(null, ys) : null, head: hb ? hb.y + hb.height / 2 : null };
  }, longLine);
  ok('a view of bars inside a longer 8va draws the line over them - "(8va)", carried on, no end hook - and the C6 it plays on the staff, as C5',
    !!part && part.bars[0] > 1 && part.bars[part.bars.length - 1] < 8 && part.labels.join() === (part.engraved ? '(8)' : '(8va)') && part.dashes === 1 && part.hooks === 0 &&
      part.head != null && part.head >= part.top && part.head <= part.bottom,
    part ? JSON.stringify({ bars: part.bars, labels: part.labels, dashes: part.dashes, hooks: part.hooks,
      head: Math.round(part.head), staff: [part.top, part.bottom] }) : 'no staff');

  await page.evaluate(() => { try { localStorage.removeItem('ppp.state.v2'); } catch (e) {} });

  await browser.close();
  console.log('\n────────────────────────────────────────');
  if (errors.length) {
    console.log(errors.length + ' PROBLEM(S):');
    errors.forEach(e => console.log('  ✗ ' + e));
    process.exit(1);
  }
  console.log('A score read from a PDF is drawn so it can be read.');
})().catch(e => { console.error(e); process.exit(1); });
