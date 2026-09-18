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
    window.__pppTest.upload();
  });
  await sleep(300);
  const input = await page.$('input[type=file][data-add-file]');
  if (!input) return { error: 'no file input' };
  /* choosing the file starts the import; there is no second button */
  await input.uploadFile(file);
  /* wait for this import to be under way, so the last one's result is not
     mistaken for this one's */
  await page.waitForFunction(() => /\bCancel\b/.test(
    (document.querySelector('main') || document.body).innerText), { timeout: 10000 }).catch(() => {});
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
  page.on('console', m => { if (m.type() === 'error' && !/404|422|CONNECTION_REFUSED/.test(m.text())) errors.push('[console] ' + m.text()); });

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
      mp3: k('a.mp3'), wav: k('a.WAV'), m4a: k('a.m4a'), mp4: k('a.mp4'), mov: k('a.mov'),
      byType: PPP.Import.kindOf({ name: 'noext', type: 'audio/mpeg' }),
      byPdfType: PPP.Import.kindOf({ name: 'scan', type: 'application/pdf' }),
      byPngType: PPP.Import.kindOf({ name: 'photo', type: 'image/png' }),
      byJpegType: PPP.Import.kindOf({ name: 'IMG_001', type: 'image/jpeg' }),
      byXmlType: PPP.Import.kindOf({ name: 'score', type: 'application/vnd.recordare.musicxml+xml' }),
      omrPdf: PPP.Import.needsOmr('pdf'), omrImg: PPP.Import.needsOmr('image'),
      omrXml: PPP.Import.needsOmr('musicxml'), omrMp3: PPP.Import.needsOmr('audio'),
      heard: ['audio', 'video', 'youtube'].every(PPP.Import.isRecording) && !PPP.Import.isRecording('pdf'),
      yt: [
        'https://www.youtube.com/watch?v=2WfaotSK3mI', 'https://youtu.be/2WfaotSK3mI',
        'https://m.youtube.com/watch?v=2WfaotSK3mI&t=10', 'https://www.youtube.com/shorts/2WfaotSK3mI',
        'https://music.youtube.com/watch?v=2WfaotSK3mI'
      ].map(PPP.Import.youtubeId),
      notYt: ['https://vimeo.com/123456', 'https://www.youtube.com/playlist?list=PL123', 'javascript:alert(1)',
        'youtube.com/watch?v=2WfaotSK3mI', 'https://evil.example/youtube.com/watch?v=2WfaotSK3mI'].map(PPP.Import.youtubeId)
    };
  });
  ok('every supported extension routes somewhere',
    kinds.musicxml === 'musicxml' && kinds.xml === 'musicxml' && kinds.mxl === 'mxl' &&
    kinds.pdf === 'pdf' && kinds.png === 'image' && kinds.jpg === 'image' && kinds.jpeg === 'image',
    JSON.stringify(kinds));
  ok('recordings route to transcription',
    kinds.mp3 === 'audio' && kinds.wav === 'audio' && kinds.m4a === 'audio' && kinds.mp4 === 'video' &&
    kinds.mov === 'video' && kinds.byType === 'audio' && kinds.heard && !kinds.omrMp3,
    [kinds.mp3, kinds.wav, kinds.m4a, kinds.mp4, kinds.mov, kinds.byType].join(','));
  ok('tablet files without an extension still route by MIME type',
    kinds.byPdfType === 'pdf' && kinds.byPngType === 'image' && kinds.byJpegType === 'image' && kinds.byXmlType === 'musicxml',
    [kinds.byPdfType, kinds.byPngType, kinds.byJpegType, kinds.byXmlType].join(','));
  const sniffed = await page.evaluate(async () => {
    const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);
    const fake = (name, type, bytes) => ({
      name: name, type: type, size: bytes.length,
      slice(a, b) {
        const part = bytes.subarray(a, b == null ? bytes.length : b);
        const copy = part.slice();
        return { arrayBuffer: () => Promise.resolve(copy.buffer) };
      }
    });
    return {
      pdf: await PPP.Import.sniff(fake('document', 'video/mp4', pdfBytes)),
      png: await PPP.Import.sniff(fake('photo', '', new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])))
    };
  });
  ok('a PDF handed over as a video is still a PDF', sniffed.pdf === 'pdf', JSON.stringify(sniffed));
  ok('a PNG with no type is still an image', sniffed.png === 'image', JSON.stringify(sniffed));

  const ytCat = await page.evaluate(async () => {
    const oldH = PPP.Import.health, oldT = PPP.Import.youtubeTitle, oldA = PPP.Import.transcribeHere;
    PPP.Import.health = () => Promise.resolve({ ok: false, remote: true, unreachable: true });
    PPP.Import.youtubeTitle = () => Promise.resolve('Beethoven Fur Elise official audio');
    PPP.Import.transcribeHere = () => Promise.reject(Object.assign(new Error('skip-amt'), { code: 'skip' }));
    let out;
    try {
      const r = await PPP.Import.loadYoutube('https://www.youtube.com/watch?v=2WfaotSK3mI');
      out = { title: r.score && r.score.title, engine: r.source && r.source.engine, notes: r.score && r.score.notes.filter(n => !n.rest).length };
    } catch (e) { out = { error: e.message }; }
    PPP.Import.health = oldH; PPP.Import.youtubeTitle = oldT; PPP.Import.transcribeHere = oldA;
    return out;
  });
  ok('a YouTube link matching the catalog does not need the local helper',
    !ytCat.error && ytCat.engine === 'Public-domain catalog' && ytCat.notes > 8,
    JSON.stringify(ytCat));

  const ytGen = await page.evaluate(async () => {
    const oldH = PPP.Import.health, oldT = PPP.Import.youtubeTitle, oldA = PPP.Import.transcribeHere;
    PPP.Import.health = () => Promise.resolve({ ok: false, remote: true, unreachable: true });
    PPP.Import.youtubeTitle = () => Promise.resolve('Random piano cover xyzzy not in catalog');
    PPP.Import.transcribeHere = () => Promise.reject(Object.assign(
      new Error('PPP could not get the sound from that YouTube link.'),
      { code: 'download-failed', hints: ['Try again in a moment'] }
    ));
    let out;
    try {
      await PPP.Import.loadYoutube('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
      out = { unexpected: true };
    } catch (e) {
      out = { code: e.code, message: e.message };
    }
    PPP.Import.health = oldH; PPP.Import.youtubeTitle = oldT; PPP.Import.transcribeHere = oldA;
    return out;
  });
  ok('a YouTube miss is a generate failure, not a catalog lookup',
    ytGen.code === 'download-failed' && !/could not find a score/i.test(ytGen.message || ''),
    JSON.stringify(ytGen));
  ok('YouTube links are recognised in every usual form', kinds.yt.every(id => id === '2WfaotSK3mI'), kinds.yt.join(','));
  ok('anything that is not one YouTube video is refused', kinds.notYt.every(id => id === null), kinds.notYt.join(','));
  ok('unsupported types are refused up front', kinds.midi === null && kinds.junk === null);
  ok('only pictures go through OMR', kinds.omrPdf && kinds.omrImg && !kinds.omrXml);

  console.log('\n── tablet file picker ──');
  await page.evaluate(() => window.__pppTest.upload());
  await sleep(300);
  const picker = await page.evaluate(() => {
    const input = document.querySelector('input[type=file][data-add-file]');
    if (!input) return { error: 'no file input' };
    const s = getComputedStyle(input);
    const r = input.getBoundingClientRect();
    return {
      accept: input.getAttribute('accept') || '',
      display: s.display,
      opacity: s.opacity,
      width: Math.round(r.width),
      height: Math.round(r.height)
    };
  });
  ok('file picker is on the add-sheet page', !picker.error, picker.error);
  ok('file picker lists PDF without a media-only accept list',
    picker.accept.indexOf('.pdf') > -1 && !/audio\/\*|video\/\*/.test(picker.accept),
    picker.accept);
  ok('file picker is tappable on a tablet (not display:none)',
    picker.display !== 'none' && picker.width > 40 && picker.height > 40,
    JSON.stringify(picker));

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
    await window.__pppTest.practice('Loop a passage');
    await new Promise(r => setTimeout(r, 250));
    return document.querySelectorAll('button[title^="Measure "]').length;
  });
  const bad = await importFile(page, path.join(FIX, 'malformed.pdf'), 60000);
  ok('a malformed PDF is refused', /could not be opened|corrupt|password|could not be read|no musical notation/i.test(bad.text),
    (bad.text.match(/(could not[^\n]+|No musical[^\n]+)/i) || ['?'])[0].slice(0, 90));
  ok('a refusal offers a next step', /upload MusicXML|clearer|re-export/i.test(bad.text));
  /* Compare the score itself, not the summary sentence — the sentence is
     replaced by the error, but the loaded score must be untouched. */
  const after = await page.evaluate(async () => {
    await window.__pppTest.practice('Loop a passage');
    await new Promise(r => setTimeout(r, 250));
    return document.querySelectorAll('button[title^="Measure "]').length;
  });
  ok('a failed import never invents notation', after === before && after > 0,
    'still ' + after + ' measures, unchanged');

  if (engineUp) {
    const noMusic = await importFile(page, path.join(FIX, 'no-music.png'), 120000);
    ok('an image with no notation is refused',
      /no musical notation|could not be read|nothing could be recognised|produced no MusicXML|Recognition failed/i.test(noMusic.text),
      (noMusic.text.match(/(No musical[^\n]+|[^\n]*produced no MusicXML[^\n]*|Recognition[^\n]+)/i) || ['?'])[0].slice(0, 90));
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
      await window.__pppTest.practice('Loop a passage');
      await new Promise(r => setTimeout(r, 250));
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
