/* 100 찬송가 piano scores: the shipped Open Hymnal reductions parse as
   two-hand pieces, and posting one through the real share API keeps its
   YouTube watch URL. */
const puppeteer = require('puppeteer');
const { preparePage } = require('./boot');
const fs = require('fs');
const path = require('path');

const BASE = 'http://127.0.0.1:8777';
const URL = BASE + '/Piano%20Coach%20App.dc.html';
const INDEX = path.join(__dirname, '..', 'catalog', 'hymns', 'index.json');
const errors = [];
const ok = (name, cond, detail) => {
  console.log((cond ? '  ✓ ' : '  ✗ ') + name + (detail ? ' — ' + detail : ''));
  if (!cond) errors.push(name + (detail ? ' — ' + detail : ''));
};

function watchUrl(id) {
  return 'https://www.youtube.com/watch?v=' + id;
}

(async () => {
  const catalog = JSON.parse(fs.readFileSync(INDEX, 'utf8'));
  const hymns = catalog.hymns || [];
  console.log('\n── catalog ──');
  const titles = hymns.map(h => h.title);
  const unique = new Set(titles);
  ok('the shipped set has 100 hymns', hymns.length === 100, String(hymns.length));
  ok('their Korean titles are distinct', unique.size === hymns.length, unique.size + ' unique');
  ok('every row names a MusicXML file and an 11-character YouTube id',
    hymns.every(h => h.file && fs.existsSync(path.join(__dirname, '..', 'catalog', 'hymns', h.file))
      && /^[\w-]{11}$/.test(h.youtubeId)),
    hymns.filter(h => !h.file || !h.youtubeId).map(h => h.id).join(', ') || 'all present');

  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await preparePage(page);
  await page.setViewport({ width: 1280, height: 800 });
  page.on('pageerror', e => errors.push('[pageerror] ' + e.message));
  await page.goto(URL, { waitUntil: 'networkidle2', timeout: 45000 });
  await page.waitForFunction(() => document.querySelectorAll('aside nav button').length >= 6, { timeout: 25000 });
  await page.waitForFunction(() => window.PPP && window.PPP.parseMusicXML, { timeout: 25000 });

  const health = await page.evaluate(async () => {
    const r = await fetch('/api/shares', { credentials: 'include', cache: 'no-store' });
    return { status: r.status };
  });
  if (health.status !== 200) {
    console.log('  – the Node server has no /api/shares (status ' + health.status + '); restart `npm run serve`. Skipping.');
    await browser.close();
    process.exit(0);
  }

  console.log('\n── parse with PPP.parseMusicXML ──');
  const parsed = [];
  let bothHands = 0;
  let parseFail = 0;
  for (let i = 0; i < hymns.length; i++) {
    const h = hymns[i];
    const xml = fs.readFileSync(path.join(__dirname, '..', 'catalog', 'hymns', h.file), 'utf8');
    const r = await page.evaluate((src, title, youtubeId, keepScore) => {
      try {
        const s = PPP.parseMusicXML(src, title + '.musicxml');
        const sounding = (s.notes || []).filter(n => !n.rest);
        const watch = PPP.Import.youtubeWatch(youtubeId);
        s.title = title;
        s.source = watch
          ? { kind: 'youtube', url: watch.url, youtubeId: watch.id }
          : { kind: 'shared' };
        delete s._byNumber;
        return {
          ok: true,
          title: s.title,
          measures: (s.measures || []).length,
          right: sounding.filter(n => n.hand === 'r').length,
          left: sounding.filter(n => n.hand === 'l').length,
          score: keepScore ? s : null
        };
      } catch (e) {
        return { ok: false, err: String(e && e.message || e) };
      }
    }, xml, h.title, h.youtubeId, i === 0);
    if (!r.ok) {
      parseFail++;
      errors.push(h.id + ' parse: ' + r.err);
      continue;
    }
    if (r.measures >= 1 && r.right > 0 && r.left > 0) bothHands++;
    else errors.push(h.id + ' not a two-hand piano score — ' + r.measures + 'm r' + r.right + ' l' + r.left);
    parsed.push({ hymn: h, result: r });
  }
  ok('every hymn parses as measures with sounding notes in both hands',
    bothHands === hymns.length && parseFail === 0,
    bothHands + '/' + hymns.length + ' two-hand, ' + parseFail + ' parse errors');

  console.log('\n── share API keeps the YouTube source ──');
  const email = 'ppp-hymn-' + Date.now() + '@example.com';
  const signed = await page.evaluate(async email => {
    const r = await fetch('/api/auth/signup', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email, password: 'practice-ok', displayName: 'Hymn Tester' })
    });
    return { status: r.status };
  }, email);
  ok('an account for the round-trip', signed.status === 201, String(signed.status));

  const sample = parsed[0];
  const posted = await page.evaluate(async payload => {
    const score = payload.score;
    const keep = {};
    score.measures.slice(0, 2).forEach(m => { keep[m.number] = true; });
    const preview = Object.assign({}, score, {
      measures: score.measures.slice(0, 2),
      notes: score.notes.filter(n => keep[n.m]),
      source: undefined
    });
    const r = await fetch('/api/shares', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        songKey: 'hymn-' + payload.id,
        title: payload.title,
        composer: payload.composer || '',
        kind: 'youtube',
        listed: true,
        score: score,
        preview: preview
      })
    });
    return { status: r.status, body: await r.json().catch(() => null) };
  }, {
    id: sample.hymn.id,
    title: sample.hymn.title,
    composer: sample.hymn.titleEn,
    score: sample.result.score
  });
  ok('POST /api/shares accepts a listed hymn', posted.status === 201 && posted.body && posted.body.id,
    posted.status + '');
  const shareId = posted.body && posted.body.id;
  const got = await page.evaluate(async id => {
    const r = await fetch('/api/shares/' + id, { credentials: 'include', cache: 'no-store' });
    return { status: r.status, body: await r.json().catch(() => null) };
  }, shareId);
  const src = got.body && got.body.score && got.body.score.source;
  const expectUrl = watchUrl(sample.hymn.youtubeId);
  ok('GET /api/shares/:id keeps source.kind youtube', src && src.kind === 'youtube', src ? src.kind : 'missing');
  ok('with a watch URL and matching youtubeId',
    src && src.youtubeId === sample.hymn.youtubeId && src.url === expectUrl,
    src ? JSON.stringify({ youtubeId: src.youtubeId, url: src.url }) : 'none');

  await page.evaluate(async id => {
    await fetch('/api/shares/' + id, { method: 'DELETE', credentials: 'include' });
  }, shareId);

  console.log('\n────────────────────────────────────────');
  if (errors.length) {
    console.log(errors.length + ' PROBLEM(S):');
    [...new Set(errors)].forEach(e => console.log('  ✗ ' + e));
  } else console.log('100 찬송가 parse as two-hand piano and share with a YouTube source.');
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})().catch(e => { console.error('HARNESS FAILURE:', e); process.exit(2); });
