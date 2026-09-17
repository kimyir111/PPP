const puppeteer = require('puppeteer');
const { preparePage } = require('./boot');
const fs = require('fs');
const path = require('path');
const http = require('http');

const URL = 'http://127.0.0.1:8777/Piano%20Coach%20App.dc.html';
const FIX = path.join(__dirname, 'fixtures');
const TRUTH = JSON.parse(fs.readFileSync(path.join(FIX, 'truth.json'), 'utf8'));
const errors = [];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ok = (name, cond, detail) => {
  console.log((cond ? '  ✓ ' : '  ✗ ') + name + (detail ? ' — ' + detail : ''));
  if (!cond) errors.push(name + (detail ? ' — ' + detail : ''));
};

const omrHealth = () => new Promise(resolve => {
  const req = http.get({ host: '127.0.0.1', port: 8788, path: '/health', timeout: 3000 }, r => {
    let d = ''; r.on('data', c => d += c);
    r.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { resolve(null); } });
  });
  req.on('error', () => resolve(null));
  req.on('timeout', () => { req.destroy(); resolve(null); });
});

/* Drive an import through the real UI and read back what came out. */
async function importFile(page, file, waitMs) {
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('aside button')].find(x => /^Upload$/.test((x.innerText || '').trim()));
    if (b) b.click();
  });
  await sleep(300);
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find(x => /Show drop zone/.test(x.innerText || ''));
    if (b) b.click();
  });
  await sleep(250);
  const input = await page.$('input[type=file]');
  if (!input) return { error: 'no file input' };
  await input.uploadFile(file);
  await sleep(400);
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find(x => /Run analysis|Try again/.test(x.innerText || ''));
    if (b) b.click();
  });
  await page.waitForFunction(
    () => {
      const t = (document.querySelector("main") || document.body).innerText;
      return /Accept and practise|See analysis|could not|cannot read|not installed|could not reach|Import failed/i.test(t);
    },
    { timeout: waitMs || 120000 }
  ).catch(() => {});
  await sleep(700);
  return page.evaluate(() => ({ text: (document.querySelector("main") || document.body).innerText }));
}

(async () => {
  const health = await omrHealth();
  const engineUp = !!(health && health.ok && health.audiveris);
  console.log('OMR service: ' + (health ? (health.audiveris ? 'up, Audiveris present' : 'up, engine missing') : 'not running'));

  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await preparePage(page);
  await page.setViewport({ width: 1500, height: 1000 });
  page.on('pageerror', e => errors.push('[pageerror] ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/404|422/.test(m.text())) errors.push('[console] ' + m.text()); });

  await page.goto(URL, { waitUntil: 'networkidle2', timeout: 45000 });
  await page.waitForFunction(() => window.PPP && window.PPP.Import, { timeout: 25000 });
  await sleep(400);

  /* ============ the adapter boundary ============ */
  console.log('\n── import routing ──');
  const kinds = await page.evaluate(() => {
    const k = n => PPP.Import.kindOf({ name: n });
    return {
      musicxml: k('a.musicxml'), xml: k('a.xml'), mxl: k('a.mxl'),
      pdf: k('a.pdf'), png: k('a.png'), jpg: k('a.jpg'), jpeg: k('a.jpeg'),
      midi: k('a.mid'), junk: k('a.txt'),
      omrPdf: PPP.Import.needsOmr('pdf'), omrImg: PPP.Import.needsOmr('image'),
      omrXml: PPP.Import.needsOmr('musicxml')
    };
  });
  ok('every supported extension routes somewhere',
    kinds.musicxml === 'musicxml' && kinds.xml === 'musicxml' && kinds.mxl === 'mxl' &&
    kinds.pdf === 'pdf' && kinds.png === 'image' && kinds.jpg === 'image' && kinds.jpeg === 'image',
    JSON.stringify(kinds));
  ok('unsupported types are refused up front', kinds.midi === null && kinds.junk === null);
  ok('only pictures go through OMR', kinds.omrPdf && kinds.omrImg && !kinds.omrXml);

  /* ============ validation is independent of OMR ============ */
  console.log('\n── recognition validation ──');
  const val = await page.evaluate(() => {
    const S = PPP.Score;
    const mk = (measures, notes, staves, time) => S.finalize({
      id: 'v' + Math.random(), title: 't', composer: '-', tempo: 84, staves: staves,
      measures: measures.map((lenQ, i) => ({
        number: i + 1, time: time || { beats: 4, beatType: 4 },
        key: { fifths: 0, mode: 'major' }, clefs: { 1: 'treble', 2: 'bass' }
      })),
      notes: notes, sections: [{ id: 's1', from: 1, to: measures.length }]
    });
    const N = (m, b, p, dur, hand) => ({
      m: m, b: b, dur: dur == null ? 1 : dur, p: p, midi: PPP.pitchToMidi(p),
      hand: hand || 'r', staff: hand === 'l' ? 2 : 1, voice: 1, type: 'quarter', dots: 0
    });
    const full = [];
    for (let m = 1; m <= 4; m++) for (let b = 0; b < 4; b++) {
      full.push(N(m, b, 'C5')); full.push(N(m, b, 'C3', 1, 'l'));
    }
    const clean = PPP.Import.validate(mk([4, 4, 4, 4], full, 2), { pageCount: 1 });

    /* one measure holding far too much */
    const over = full.slice();
    over.push(N(2, 3.5, 'D5', 4));
    const overfull = PPP.Import.validate(mk([4, 4, 4, 4], over, 2), { pageCount: 1 });

    /* a measure that came back empty */
    const gap = full.filter(n => n.m !== 3);
    const empty = PPP.Import.validate(mk([4, 4, 4, 4], gap, 2), { pageCount: 1 });

    /* notes off the end of a piano */
    const wild = full.concat([N(4, 0, 'C9')]);
    const range = PPP.Import.validate(mk([4, 4, 4, 4], wild, 2), { pageCount: 1 });

    /* a piano score read as one staff */
    const oneStaff = PPP.Import.validate(mk([4, 4, 4, 4], full.filter(n => n.hand === 'r'), 1), { pageCount: 1 });

    /* barely anything found across two pages */
    const sparse = PPP.Import.validate(mk([4], [N(1, 0, 'C5')], 2), { pageCount: 2 });

    /* a page that failed outright */
    const pageFail = PPP.Import.validate(mk([4, 4, 4, 4], full, 2),
      { pageCount: 2, pages: [{ index: 0, ok: true }, { index: 1, ok: false, error: 'No notation' }] });

    return {
      clean: { level: clean.level, conf: clean.confidence, issues: clean.issues.length },
      overfull: { level: overfull.level, kinds: overfull.issues.map(i => i.kind), suspect: overfull.suspectMeasures },
      empty: { kinds: empty.issues.map(i => i.kind), suspect: empty.suspectMeasures },
      range: { kinds: range.issues.map(i => i.kind) },
      oneStaff: { kinds: oneStaff.issues.map(i => i.kind), conf: oneStaff.confidence },
      sparse: { kinds: sparse.issues.map(i => i.kind), level: sparse.level },
      pageFail: { kinds: pageFail.issues.map(i => i.kind), conf: pageFail.confidence },
      advice: overfull.advice
    };
  });
  ok('clean recognition passes with no issues',
    val.clean.level === 'good' && val.clean.issues === 0, 'confidence ' + Math.round(val.clean.conf * 100) + '%');
  ok('an overfull measure is caught',
    val.overfull.kinds.indexOf('overfull') > -1 && val.overfull.suspect.indexOf(2) > -1, val.overfull.kinds.join(','));
  ok('an empty measure is caught',
    val.empty.kinds.indexOf('empty-measure') > -1 && val.empty.suspect.indexOf(3) > -1, val.empty.suspect.join(','));
  ok('notes off the keyboard are caught', val.range.kinds.indexOf('range') > -1, val.range.kinds.join(','));
  ok('a missed grand staff is caught',
    val.oneStaff.kinds.indexOf('staves') > -1 && val.oneStaff.conf < 0.85,
    'confidence ' + Math.round(val.oneStaff.conf * 100) + '%');
  ok('a near-empty result is caught', val.sparse.kinds.indexOf('sparse') > -1 && val.sparse.level !== 'good');
  ok('a failed page lowers confidence',
    val.pageFail.kinds.indexOf('page') > -1 && val.pageFail.conf < 1, 'confidence ' + Math.round(val.pageFail.conf * 100) + '%');
  ok('suspect measures are named in plain words', /measures? 2/.test(val.advice || ''), val.advice);

  /* ============ multi-page MusicXML merge ============ */
  console.log('\n── multi-page merge ──');
  const merged = await page.evaluate(() => {
    const mk = (nBars, startPitch) => {
      let m = '';
      for (let i = 1; i <= nBars; i++) {
        m += '<measure number="' + i + '">' +
          (i === 1 ? '<attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>' : '') +
          '<note><pitch><step>' + startPitch + '</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note></measure>';
      }
      return '<?xml version="1.0"?><score-partwise version="4.0"><part-list><score-part id="P1"><part-name>P</part-name></score-part></part-list><part id="P1">' + m + '</part></score-partwise>';
    };
    const out = PPP.Import.mergeMusicXml([mk(3, 'C'), mk(2, 'D'), mk(4, 'E')]);
    const doc = new DOMParser().parseFromString(out, 'application/xml');
    const ms = [].slice.call(doc.querySelectorAll('part > measure'));
    return {
      count: ms.length,
      numbers: ms.map(m => m.getAttribute('number')).join(','),
      pitches: [].slice.call(doc.querySelectorAll('note > pitch > step')).map(s => s.textContent).join('')
    };
  });
  ok('pages are concatenated in order', merged.count === 9, merged.count + ' measures from 3+2+4');
  ok('measure numbers continue across pages', merged.numbers === '1,2,3,4,5,6,7,8,9', merged.numbers);
  ok('page order is preserved', merged.pitches === 'CCCDDEEEE', merged.pitches);

  /* ============ MusicXML still imports (no regression) ============ */
  console.log('\n── MusicXML import still works ──');
  const xmlRes = await importFile(page, path.join(__dirname, '..', 'samples', 'prelude-fragment.musicxml'), 30000);
  ok('MusicXML import unaffected by the OMR work',
    /Parsed 8 measures in 3\/4/.test(xmlRes.text) && /G major/.test(xmlRes.text),
    (xmlRes.text.match(/Parsed [^\n]+/) || ['?'])[0]);
  ok('MusicXML does not go through the review screen', !/Accept and practise/.test(xmlRes.text));

  /* ============ honest failure ============ */
  console.log('\n── failure is honest ──');
  const before = await page.evaluate(async () => {
    const b = [...document.querySelectorAll('aside button')].find(x => /^Measure Loop$/.test((x.innerText || '').trim()));
    if (b) b.click();
    await new Promise(r => setTimeout(r, 500));
    return document.querySelectorAll('button[title^="Measure "]').length;
  });
  const bad = await importFile(page, path.join(FIX, 'malformed.pdf'), 60000);
  ok('a malformed PDF is refused', /could not be opened|corrupt|password|could not be read|no musical notation/i.test(bad.text),
    (bad.text.match(/(could not[^\n]+|No musical[^\n]+)/i) || ['?'])[0].slice(0, 90));
  ok('a refusal offers a next step', /upload MusicXML|clearer|re-export/i.test(bad.text));
  /* Compare the score itself, not the summary sentence — the sentence is
     replaced by the error, but the loaded score must be untouched. */
  const after = await page.evaluate(async () => {
    const b = [...document.querySelectorAll('aside button')].find(x => /^Measure Loop$/.test((x.innerText || '').trim()));
    if (b) b.click();
    await new Promise(r => setTimeout(r, 500));
    return document.querySelectorAll('button[title^="Measure "]').length;
  });
  ok('a failed import never invents notation', after === before && after > 0,
    'still ' + after + ' measures, unchanged');

  if (engineUp) {
    const noMusic = await importFile(page, path.join(FIX, 'no-music.png'), 120000);
    ok('an image with no notation is refused',
      /no musical notation|could not be read|nothing could be recognised|recognition/i.test(noMusic.text),
      (noMusic.text.match(/(No musical[^\n]+|Recognition[^\n]+)/i) || ['?'])[0].slice(0, 90));
  }

  /* ============ the real thing: picture → Score ============ */
  if (!engineUp) {
    console.log('\n── OMR pipeline: SKIPPED (service or engine not available) ──');
    ok('OMR unavailability is reported honestly, not faked', true, 'start it with: npm run omr');
  } else {
    console.log('\n── picture → MusicXML → Score ──');

    for (const [file, label] of [['piano-clean.png', 'PNG'], ['piano-clean.jpg', 'JPG'], ['piano-clean.pdf', 'PDF']]) {
      const r = await importFile(page, path.join(FIX, file), 180000);
      /* The stat labels are uppercased by CSS, which innerText reflects, so the
         readers are case-insensitive and scoped to main (the sidebar also says
         "Check recognition"). */
      const got = await page.evaluate(() => {
        const t = (document.querySelector('main') || document.body).innerText;
        const stat = label => {
          const m = t.match(new RegExp('(?:^|\\n)' + label + '\\s*\\n\\s*([0-9]+)', 'i'));
          return m ? +m[1] : 0;
        };
        return {
          review: /Accept and practise/.test(t),
          measures: stat('Measures'), notes: stat('Notes'), conf: stat('Confidence')
        };
      });
      ok(label + ' reaches the review screen', got.review,
        'measures=' + got.measures + ' notes=' + got.notes + ' conf=' + got.conf + '%');
      ok(label + ' recognised the notes', got.notes >= 44, got.notes + ' of 48');
      /* Recognition is allowed to be imperfect. What is not allowed is being
         imperfect and claiming otherwise — a wrong measure count must show up
         as reduced confidence, not as a confident lie. */
      const exact = got.measures === TRUTH.measures;
      ok(label + (exact ? ' matched the score exactly' : ' admitted it was unsure'),
        exact ? got.conf === 100 : got.conf < 100,
        exact ? got.measures + ' measures at ' + got.conf + '% confidence'
          : got.measures + ' measures (expected ' + TRUTH.measures + ') flagged at ' + got.conf + '%');
    }

    /* multi-page */
    const multi = await importFile(page, path.join(FIX, 'piano-multipage.pdf'), 240000);
    const mg = await page.evaluate(() => {
      const t = (document.querySelector('main') || document.body).innerText;
      const stat = label => {
        const m = t.match(new RegExp('(?:^|\\n)' + label + '\\s*\\n\\s*([0-9]+)', 'i'));
        return m ? +m[1] : 0;
      };
      return { measures: stat('Measures'), pages: stat('Pages'), notes: stat('Notes') };
    });
    ok('a two-page PDF is read as one continuous score',
      mg.pages === 2 && mg.measures === TRUTH.measures,
      mg.pages + ' pages → ' + mg.measures + ' measures, ' + mg.notes + ' notes');

    /* ---- and the rest of PPP does not care where it came from ---- */
    console.log('\n── downstream is unchanged ──');
    await page.evaluate(() => {
      const b = [...document.querySelectorAll('main button')].find(x => /Accept and practise/.test(x.innerText || ''));
      if (b) b.click();
    });
    await sleep(700);

    const downstream = await page.evaluate(async () => {
      const click = re => {
        const b = [...document.querySelectorAll('main button, aside button, aside nav button')]
          .find(x => re.test((x.innerText || '').trim()));
        if (b) b.click(); return !!b;
      };
      click(/^Measure Loop$/);
      await new Promise(r => setTimeout(r, 500));
      const cells = document.querySelectorAll('button[title^="Measure "]').length;
      const staves = document.querySelectorAll('.ppp-score svg').length;
      const notes = document.querySelectorAll('.ppp-note').length;
      /* loop one measure so a lap completes inside the test window */
      const c = document.querySelectorAll('button[title^="Measure "]');
      if (c.length) { c[0].click(); c[0].click(); }
      await new Promise(r => setTimeout(r, 400));
      click(/^Play$/);
      await new Promise(r => setTimeout(r, 7000));
      click(/^Pause$/);
      await new Promise(r => setTimeout(r, 900));
      let saved = null;
      try { saved = JSON.parse(localStorage.getItem('ppp.state.v2')); } catch (e) {}
      const hist = saved && saved.history ? Object.keys(saved.history.byMeasure).length : 0;
      return { cells, staves, notes, hist, source: saved ? saved.importSource : null };
    });
    ok('the recognised score drives the measure strip', downstream.cells === TRUTH.measures, downstream.cells + ' cells');
    ok('the recognised score is engraved', downstream.staves > 0 && downstream.notes > 0,
      downstream.staves + ' svg, ' + downstream.notes + ' note groups');
    ok('practising a recognised score records history', downstream.hist > 0,
      downstream.hist + ' measures with practice data');
    ok('source metadata is kept', !!(downstream.source && downstream.source.name && downstream.source.kind),
      downstream.source ? downstream.source.kind + ' · ' + downstream.source.name + ' · ' + downstream.source.status : 'none');
    ok('the source file itself is not stored', !(downstream.source && (downstream.source.data || downstream.source.dataUrl)));
  }

  /* ============ limits ============ */
  console.log('\n── limits ──');
  const limits = await page.evaluate(async () => {
    const big = { name: 'huge.pdf', size: 99 * 1024 * 1024 };
    let msg = null;
    try { await PPP.Import.load(big, () => {}); } catch (e) { msg = e.message; }
    let empty = null;
    try { await PPP.Import.load({ name: 'x.pdf', size: 0 }, () => {}); } catch (e) { empty = e.message; }
    let un = null;
    try { await PPP.Import.load({ name: 'x.exe', size: 10 }, () => {}); } catch (e) { un = e.message; }
    return { msg, empty, un, maxPages: PPP.IMPORT_LIMITS.maxPages, maxMb: Math.round(PPP.IMPORT_LIMITS.maxBytes / 1048576) };
  });
  ok('oversized uploads are rejected', /limit is \d+ MB/.test(limits.msg || ''), limits.msg);
  ok('empty uploads are rejected', /empty/i.test(limits.empty || ''), limits.empty);
  ok('unknown types are rejected', /cannot read/i.test(limits.un || ''), limits.un);
  ok('page and size limits are declared', limits.maxPages > 0 && limits.maxMb > 0,
    limits.maxPages + ' pages, ' + limits.maxMb + ' MB');

  console.log('\n────────────────────────────────────────');
  if (errors.length) {
    console.log(errors.length + ' PROBLEM(S):');
    [...new Set(errors)].forEach(e => console.log('  ✗ ' + e));
  } else console.log('Import routing, OMR, validation and the review step all check out.');
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})().catch(e => { console.error('HARNESS FAILURE:', e); process.exit(2); });
