/* ============================================================================
   G9e-lite + G9e default-on (docs/GOALS/G09_CANDIDATES_CRITICS_REPAIR.md section 12): the app's "One note per hand", in the real page.

   PPP.arranger = 'single' (default since G9e default-on) | 'legacy' | 'g8'. 'single' hands the review screen's own graph (or the open song's graph
   in the Song Arranger) to G7a -> G7b -> G9a candidates.run({ singleNoteHands: true }) -> G9b repair -> TD16 8va/8vb -> the conversion 'g8' uses.
   The control ("chip") is pressed on a fresh page; pressing it turns it off (PPP.arranger 'legacy', the standard arrangement).

   What this checks (the two screens where a person arranges a piece: the Song Arranger in My Songs, and the recognition review screen):
     - the switch: single by default, 'legacy' and 'g8' accepted, anything else legacy
     - the option's 14 scripts and 2 data files are NOT on the way to the first paint: none is requested before the first paint and the load event,
       they arrive in the background afterwards, once each; an arrangement asked for while they are still in flight waits for them (no second request)
     - the identity guarantee moved: with PPP.arranger = 'legacy' the arrangement the real entry points make is identical to what origin/main made
       (sha-256 of the saved score, tests/fixtures/g9e-legacy-identity.json, made from a build of origin/main 14a76f8, PPP.arranger = 'legacy'),
       also after the background load has finished, and after the chip was pressed off in the page
     - the control: present on both screens, PRESSED on a fresh page, labelled in English and Korean, inside the viewport at 400 px with no sideways scroll;
       pressing it turns it off and on again
     - on by default: christ-arose, nearer-my-god, pass-me-not and all-creatures come out with no hand starting two notes at once, both hands used,
       drawn by the engraver (no fallback), with a sounding note list, and no console or page error; the review screen does it for the default
       'balanced' texture too (which 'g8' never did)
     - "Original transcription" is not arranged
     - refusals and failed downloads: an unreachable piece (sonatina/020 has no plan at any level), option scripts or reference data that cannot be
       loaded (also when it is the background load that fails: no error, and the next arrangement asks again). The Song Arranger saves nothing
       and says so; the review screen shows the standard arrangement, marked as such in its source, with the notice on screen

   The recognition review screen needs a recording and a transcription helper; here the heard notes are injected into the page (made from a hymn's own
   notes), and everything after that - the level and texture pickers, the control, Apply - is the real UI.

   Runs against its own server on a free port (tests/serve-free.js); PPP_URL=... runs it against another build (needed once to make
   the identity fixture: G9E_WRITE_GOLDEN=1 PPP_URL=<a build of origin/main> node tests/single-note-app.test.js - that build's default is 'legacy',
   and this suite sets 'legacy' explicitly for it, so it works on either). Requests to /helper/ and :8788 (a local helper nothing serves here, and
   production answers 503 by design) are refused and expected. */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const puppeteer = require('puppeteer');
const { preparePage } = require('./boot');
const { startServer } = require('./serve-free');

const REPO = path.resolve(__dirname, '..');
const GOLDEN = path.join(__dirname, 'fixtures', 'g9e-legacy-identity.json');
const errors = [];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ok = (name, cond, detail) => {
  console.log((cond ? '  ✓ ' : '  ✗ ') + name + (detail ? ' — ' + detail : ''));
  if (!cond) errors.push(name + (detail ? ' — ' + detail : ''));
};
const HYMN = n => path.join(REPO, 'catalog', 'hymns', n + '.musicxml');
const SONATINA_020 = path.join(REPO, 'catalog', 'method', 'sonatina', '020.mxl');
const OPTION_FILES = /\/(critics\/|candidates\/|repair\/|realize\/(ottava|handchords|clefs))|method-books\.json|weights\/g6a/;
const LEVELS = ['beginner', 'intermediate', 'advanced', 'original'];
/* a local helper: nothing serves it here, and production has none by design (server.js proxyHelper answers /helper/ with 503) */
const HELPER = /:8788\/|\/helper(\/|$|\?)/;
const OPTION_SCRIPTS = ['/realize/handchords.js', '/realize/clefs.js', '/realize/ottava.js', '/critics/voice-leading.js', '/critics/register-density.js', '/critics/register-floor.js', '/critics/left-hand-jump.js', '/critics/low-register-cluster.js', '/critics/vertical-clash.js', '/critics/metrics.js', '/critics/index.js', '/candidates/index.js', '/repair/plan.js', '/repair/index.js'];

const sha = s => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);
const VOLATILE = /^(id|createdAt|importedAt|parentSongId|addedAt|lastAt)$/;
function strip(v) {
  if (Array.isArray(v)) return v.map(strip);
  if (v && typeof v === 'object') { const o = {}; Object.keys(v).sort().forEach(k => { if (!VOLATILE.test(k)) o[k] = strip(v[k]); }); return o; }
  return v;
}

let BASE = null;
/* o.mode: PPP.arranger is set to it as soon as the page is up (the identity checks are 'legacy'); o.until: goto's waitUntil;
   o.block / o.failWhile: matching requests are refused while rec.blockOn / rec.failOn is true (a test may switch it off: a failure that goes away);
   o.delay {re, ms}: matching requests are held that long */
async function openPage(browser, o) {
  o = o || {};
  const page = await browser.newPage();
  await preparePage(page);
  if (o.locale) await page.evaluateOnNewDocument(loc => { try { localStorage.setItem('ppp-locale', loc); } catch (e) {} }, o.locale);
  const rec = { requests: [], consoleErrors: [], pageErrors: [], blocked: [], blockOn: true, failOn: true };
  page.__rec = rec;
  await page.setRequestInterception(true);
  page.on('request', req => {
    const u = req.url();
    rec.requests.push(u.replace(/^https?:\/\/[^/]+/, ''));
    /* the page's own health check of a local helper nothing serves here: refused, so the legacy engine is the browser one on every machine */
    if (HELPER.test(u)) return req.abort();
    if (o.block && rec.blockOn && o.block.test(u)) { rec.blocked.push(u); return req.abort(); }
    if (o.failWhile && rec.failOn && o.failWhile.test(u)) { rec.blocked.push(u); return req.abort(); }
    if (o.delay && o.delay.re.test(u)) return void setTimeout(() => { try { req.continue(); } catch (e) {} }, o.delay.ms);
    req.continue();
  });
  page.on('console', m => { if (m.type() === 'error' && !HELPER.test(JSON.stringify(m.location())) && !((o.block || o.failWhile) && /Failed to load resource/.test(m.text()))) rec.consoleErrors.push(m.text()); });
  page.on('pageerror', e => rec.pageErrors.push(e.message));
  await page.setViewport({ width: o.width || 1100, height: o.height || 1000 });
  await page.goto(BASE, { waitUntil: o.until || 'networkidle2', timeout: 60000 });
  await sleep(o.until ? 100 : 500);
  if (o.mode) {
    await page.waitForFunction(() => !!(window.PPP && window.PPP.app), { timeout: 30000 });
    await page.evaluate(m => { window.PPP.arranger = m; }, o.mode);
  }
  return page;
}

async function addSong(page, file) {
  await page.evaluate(() => window.__pppTest.nav('My Songs'));
  await sleep(250);
  await page.evaluate(() => document.querySelector('[data-add-card]').click());
  await sleep(250);
  await (await page.$('input[type=file][data-add-file]')).uploadFile(file);
  await page.waitForFunction(() => window.PPP.app.state.score && window.PPP.app.state.score.id !== 'demo' && window.PPP.app.state.screen !== 'analysis-pending', { timeout: 30000 });
  await sleep(1200);
  return page.evaluate(() => window.PPP.app.state.songId);
}
const songKeys = page => page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('ppp.song.v1.')));

/* the real Song Arranger: open it on a song card, pick the level and texture, press Create. Returns what happened. */
async function overlayArrange(page, songId, level, style, chip) {
  await page.evaluate(() => window.__pppTest.nav('My Songs'));
  await sleep(250);
  await page.evaluate(i => document.querySelector('[data-arrange-song="' + i + '"]').click(), songId);
  await sleep(250);
  if (chip) { await page.click('[data-song-arranger] [data-single-note-option]'); await sleep(250); } /* the real chip, pressed once */
  await page.select('[data-song-arrange-level]', level);
  await page.select('[data-song-arrange-style]', style);
  const before = await songKeys(page);
  await page.click('[data-create-song-arrangement]');
  /* finished: the dialog closed (saved), or it is idle again with a notice (refused) */
  await page.waitForFunction(() => {
    const d = document.querySelector('[data-song-arranger]');
    if (!d) return true;
    const b = document.querySelector('[data-create-song-arrangement]');
    return !!b && !/Creating/.test(b.innerText) && /could not be made|could not be opened|unavailable|could not be created/.test(d.innerText);
  }, { timeout: 90000 });
  await sleep(300);
  const mode = await page.evaluate(() => window.PPP.arranger);
  const after = await songKeys(page);
  const fresh = after.filter(k => before.indexOf(k) < 0)[0] || null;
  const open = await page.evaluate(() => !!document.querySelector('[data-song-arranger]'));
  const status = open ? await page.evaluate(() => document.querySelector('[data-song-arranger]').innerText) : '';
  if (!fresh) return { saved: false, open: open, status: status, mode: mode };
  const id = fresh.replace('ppp.song.v1.', '');
  const slot = JSON.parse(await page.evaluate(k => localStorage.getItem(k), fresh));
  const attacks = await page.evaluate(i => {
    const s = window.PPP.app.scoreForArrangement(i);
    const by = new Map();
    s.notes.filter(n => !n.rest).forEach(n => { const k = n.hand + '|' + n.m + '|' + n.b; by.set(k, (by.get(k) || 0) + 1); });
    return { perAttack: [...by.values()], hands: [...new Set(s.notes.filter(n => !n.rest).map(n => n.hand))].sort().join(''), notes: s.notes.filter(n => !n.rest).length };
  }, id);
  return { saved: true, id: id, slot: slot, open: open, mode: mode, hash: sha(JSON.stringify(strip(slot.score))), attacks: attacks };
}

/* the recognition review screen, with heard notes made from a file's own notes */
async function loadReview(page, file, title) {
  const bytes = fs.readFileSync(file).toString('base64');
  await page.evaluate(async (b64, name, isMxl) => {
    const P = window.PPP, A = P.app;
    const raw = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    const xml = isMxl ? await P.readMxl(raw.buffer) : new TextDecoder().decode(raw);
    const sc = P.parseMusicXML(xml, name);
    const tempo = sc.tempo || 90, spq = 60 / tempo;
    const notes = sc.notes.filter(n => !n.rest).map(n => { const on = (P.Score.startQ(sc, n.m) + n.b) * spq; return { on: on, off: on + Math.max(0.1, n.dur * spq * 0.95), midi: n.midi, vel: 64 }; });
    A._recording = { url: '', barStarts: [0] };
    A._heard = { notes: notes, pedals: [], duration: notes[notes.length - 1].off };
    A.adoptScore(sc);
    A.setState({
      screen: 'review', arrangementBusy: false, arrangementStatus: '', arrangementLevel: 'intermediate', arrangementStyle: 'balanced',
      importSource: { kind: 'audio', name: name + '.mp3', status: 'transcribed', tempo: tempo },
      importReport: { confidence: 0.9, level: 'good', issues: [], suspectMeasures: [], summary: null, advice: null, measures: P.Score.count(sc), notes: notes.length, staves: 2, tempo: tempo }
    });
  }, bytes, title, /\.mxl$/.test(file));
  await sleep(600);
}
async function reviewApply(page, level, style) {
  await page.select('[data-arrangement-level]', level);
  await page.select('[data-arrangement-style]', style);
  await sleep(100);
  await page.evaluate(() => { const s = window.PPP.app.state; window.PPP.app.setState({ importSource: Object.assign({}, s.importSource, { arrangement: null }) }); });
  await page.click('[data-apply-arrangement]');
  await page.waitForFunction(() => { const s = window.PPP.app.state; return !s.arrangementBusy && s.importSource && s.importSource.arrangement; }, { timeout: 90000 });
  await sleep(400);
  return page.evaluate(() => {
    const P = window.PPP, s = P.app.state, sc = s.score;
    const by = new Map();
    sc.notes.filter(n => !n.rest).forEach(n => { const k = n.hand + '|' + n.m + '|' + n.b; by.set(k, (by.get(k) || 0) + 1); });
    return {
      arrangement: s.importSource.arrangement, status: s.arrangementStatus, say: (document.querySelector('[role=status], [aria-live]') || {}).innerText || '',
      packed: JSON.stringify({ score: P.packScore(sc), arr: s.importSource.arrangement, n: s.importSource.arrangementNotes }),
      perAttack: [...by.values()], hands: [...new Set(sc.notes.filter(n => !n.rest).map(n => n.hand))].sort().join(''),
      notes: sc.notes.filter(n => !n.rest).length, via: window.PPPEngrave.app.resolveSync(sc).via,
      strikes: P.PianoScore.of(sc).strikes.length
    };
  });
}

/* a fixed recipe of default-mode requests; the same list makes the fixture and checks it */
async function identityHashes(browser) {
  const out = {};
  const page = await openPage(browser, { mode: 'legacy' });
  for (const name of ['christ-arose', 'nearer-my-god', 'pass-me-not']) {
    const id = await addSong(page, HYMN(name));
    for (const level of LEVELS) { const r = await overlayArrange(page, id, level, 'balanced'); out['overlay|' + name + '|' + level + '|balanced'] = r.saved ? r.hash : 'NOT SAVED'; if (process.env.G9E_VERBOSE) console.log('   ' + name + ' ' + level + ' ' + (r.saved ? r.hash : r.status)); }
    const j = await overlayArrange(page, id, 'intermediate', 'jazz'); out['overlay|' + name + '|intermediate|jazz'] = j.saved ? j.hash : 'NOT SAVED';
  }
  await page.close();
  const rp = await openPage(browser, { mode: 'legacy' });
  await loadReview(rp, HYMN('christ-arose'), 'christ-arose');
  for (const [level, style] of LEVELS.map(l => [l, 'balanced']).concat([['intermediate', 'jazz'], ['beginner', 'ballad']])) {
    const r = await reviewApply(rp, level, style);
    await loadReview(rp, HYMN('christ-arose'), 'christ-arose'); /* each request starts from the same heard notes */
    out['review|christ-arose|' + level + '|' + style] = sha(JSON.stringify(strip(JSON.parse(r.packed))));
  }
  await rp.close();
  return out;
}

(async () => {
  const srv = await startServer();
  BASE = srv.url;
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  try {
    console.log('\n── the switch, and what a page load asks for ──');
    const page0 = await openPage(browser);
    const sw = await page0.evaluate(() => {
      const P = window.PPP, out = { start: P.arranger };
      P.arranger = 'legacy'; out.legacy = P.arranger;
      P.arranger = 'g8'; out.g8 = P.arranger;
      P.arranger = 'typo'; out.typo = P.arranger;
      P.arranger = 'single'; out.single = P.arranger;
      P.arranger = 'single'; P.arranger = undefined; out.undef = P.arranger;
      P.arranger = 'single';
      return out;
    });
    ok('PPP.arranger is single at page load (G9e default-on)', sw.start === 'single', sw.start);
    ok('\'legacy\', \'g8\' and \'single\' are accepted', sw.legacy === 'legacy' && sw.g8 === 'g8' && sw.single === 'single', JSON.stringify(sw));
    ok('any other value is legacy (G4-F2-1)', sw.typo === 'legacy' && sw.undef === 'legacy', JSON.stringify(sw));
    /* the option's files arrive in the background after the page has settled: wait for them, then read WHEN the browser asked for them */
    await page0.waitForFunction(() => !!(window.PPPCandidates && window.PPPRepair), { timeout: 30000 }).catch(() => {});
    await sleep(300);
    const timing = await page0.evaluate(re => {
      const rx = new RegExp(re), nav = performance.getEntriesByType('navigation')[0] || {};
      const fcp = (performance.getEntriesByType('paint').find(x => x.name === 'first-contentful-paint') || {}).startTime;
      const mine = performance.getEntriesByType('resource').filter(r => rx.test(r.name));
      return { n: mine.length, first: Math.min.apply(null, mine.map(r => r.startTime)), fcp: fcp, loadEnd: nav.loadEventEnd, dcl: nav.domContentLoadedEventEnd };
    }, OPTION_FILES.source);
    ok('the option\'s scripts and reference data do come in the background (16 requests: 14 scripts, the weights, the method books)', timing.n === 16, JSON.stringify(timing));
    ok('and not on the way to the first paint: the first of them is asked for after the first paint and after the load event', timing.fcp > 0 && timing.first > timing.fcp && timing.first > timing.loadEnd, JSON.stringify(timing));
    const own = page0.__rec.requests.filter(r => OPTION_FILES.test(r)).map(r => r.split('?')[0]);
    ok('each of them was requested exactly once', OPTION_SCRIPTS.every(f => own.filter(n => n === f).length === 1) && own.filter(n => /method-books\.json$/.test(n)).length === 1 && own.filter(n => /g6a-v1\.json$/.test(n)).length === 1, own.join(' '));
    ok('no page or console error at load or in the background load', page0.__rec.pageErrors.length === 0 && page0.__rec.consoleErrors.length === 0, JSON.stringify(page0.__rec.pageErrors.concat(page0.__rec.consoleErrors)));
    await page0.close();

    console.log('\n── the identity guarantee: with PPP.arranger = \'legacy\' the output is origin/main\'s ──');
    const got = await identityHashes(browser);
    if (process.env.G9E_WRITE_GOLDEN === '1') {
      fs.writeFileSync(GOLDEN, JSON.stringify({ madeFrom: 'origin/main 14a76f8 (PPP.arranger = \'legacy\', then the default)', hashes: got }, null, 1) + '\n');
      console.log('  wrote ' + GOLDEN + ' (' + Object.keys(got).length + ' hashes)');
      await browser.close(); await srv.close(); process.exit(0);
    } else {
      const want = JSON.parse(fs.readFileSync(GOLDEN, 'utf8')).hashes;
      const keys = Object.keys(want);
      const bad = keys.filter(k => want[k] !== got[k]);
      ok('every legacy-mode arrangement (' + keys.length + ': Song Arranger at four levels, a jazz copy, and the review screen at four levels and two more textures) is identical to origin/main\'s', bad.length === 0 && Object.keys(got).length === keys.length, bad.slice(0, 4).join('; '));
    }

    console.log('\n── the control ──');
    const cp = await openPage(browser);
    const songId = await addSong(cp, HYMN('christ-arose'));
    await cp.evaluate(() => window.__pppTest.nav('My Songs'));
    await sleep(250);
    await cp.evaluate(i => document.querySelector('[data-arrange-song="' + i + '"]').click(), songId);
    await sleep(300);
    const c1 = await cp.evaluate(() => { const b = document.querySelector('[data-song-arranger] [data-single-note-option]'); return b && { text: b.innerText.trim(), pressed: b.getAttribute('aria-pressed'), mode: window.PPP.arranger, title: document.querySelector('[data-song-arrange-title]').value }; });
    ok('the Song Arranger has the control, pressed (on) on a fresh page, in English, and the copy is named accordingly', !!c1 && c1.pressed === 'true' && c1.mode === 'single' && c1.text === 'One note per hand' && /one-note-per-hand/.test(c1.title), JSON.stringify(c1));
    await cp.click('[data-song-arranger] [data-single-note-option]');
    await sleep(300);
    const c2 = await cp.evaluate(() => ({ pressed: document.querySelector('[data-single-note-option]').getAttribute('aria-pressed'), mode: window.PPP.arranger, title: document.querySelector('[data-song-arrange-title]').value }));
    ok('clicking it turns PPP.arranger to \'legacy\' and restores the standard copy name', c2.pressed === 'false' && c2.mode === 'legacy' && !/one-note-per-hand/.test(c2.title), JSON.stringify(c2));
    await cp.click('[data-song-arranger] [data-single-note-option]');
    await sleep(300);
    const c3 = await cp.evaluate(() => ({ pressed: document.querySelector('[data-single-note-option]').getAttribute('aria-pressed'), mode: window.PPP.arranger, title: document.querySelector('[data-song-arrange-title]').value }));
    ok('clicking again turns it back on (single) and names the copy accordingly', c3.pressed === 'true' && c3.mode === 'single' && /one-note-per-hand/.test(c3.title), JSON.stringify(c3));
    await cp.close();

    const rp = await openPage(browser);
    await loadReview(rp, HYMN('christ-arose'), 'christ-arose');
    const r1 = await rp.evaluate(() => { const b = document.querySelector('[data-arrangement] [data-single-note-option]'); return b && { text: b.innerText.trim(), pressed: b.getAttribute('aria-pressed') }; });
    ok('the recognition review screen has it too, pressed (on) on its first render', !!r1 && r1.pressed === 'true' && r1.text === 'One note per hand', JSON.stringify(r1));
    await rp.close();

    for (const width of [400, 1100]) {
      const wr = await openPage(browser, { width: width, height: 900 });
      await loadReview(wr, HYMN('christ-arose'), 'christ-arose');
      const geo = await wr.evaluate(() => { const b = document.querySelector('[data-arrangement] [data-single-note-option]').getBoundingClientRect(); const row = document.querySelector('[data-arrangement] [data-single-note-row]').getBoundingClientRect(); return { right: Math.round(b.right), rowRight: Math.round(row.right), scrollW: document.documentElement.scrollWidth, innerW: window.innerWidth }; });
      ok('review screen at ' + width + ' px: the control is inside the viewport and the page does not scroll sideways', geo.right <= geo.innerW && geo.rowRight <= geo.innerW && geo.scrollW <= geo.innerW + 1, JSON.stringify(geo));
      await wr.close();
      const wp = await openPage(browser, { width: width, height: 900 });
      const songId2 = await addSong(wp, HYMN('nearer-my-god'));
      await wp.evaluate(() => window.__pppTest.nav('My Songs'));
      await sleep(250);
      await wp.evaluate(i => document.querySelector('[data-arrange-song="' + i + '"]').click(), songId2);
      await sleep(300);
      const geo2 = await wp.evaluate(() => { const b = document.querySelector('[data-song-arranger] [data-single-note-option]').getBoundingClientRect(); const d = document.querySelector('[data-song-arranger]'); return { right: Math.round(b.right), innerW: window.innerWidth, scrollW: document.documentElement.scrollWidth, dialogScrollW: d.scrollWidth, dialogClientW: d.clientWidth }; });
      ok('Song Arranger at ' + width + ' px: the control is inside the viewport, nothing scrolls sideways', geo2.right <= geo2.innerW && geo2.scrollW <= geo2.innerW + 1 && geo2.dialogScrollW <= geo2.dialogClientW + 1, JSON.stringify(geo2));
      await wp.close();
    }

    const kp = await openPage(browser, { locale: 'ko-KR' });
    const ko = JSON.parse(fs.readFileSync(path.join(REPO, 'i18n', 'ko-KR.json'), 'utf8')).content;
    await loadReview(kp, HYMN('christ-arose'), 'christ-arose');
    const kt = await kp.evaluate(() => { const b = document.querySelector('[data-arrangement] [data-single-note-option]'); const p = b && b.parentElement.querySelector('p'); return { label: b && b.innerText.trim(), hint: p && p.innerText.trim() }; });
    ok('in Korean the control reads 한 손 단음, with its explanation, from the catalog', kt.label === '한 손 단음' && kt.label === ko['One note per hand'] && /한 손에 두 음 이상이 동시에/.test(kt.hint || '') && /화성 일부가 빠질 수 있습니다/.test(kt.hint || ''), JSON.stringify(kt));
    await kp.close();

    console.log('\n── on by default: the Song Arranger, four hymns (nothing is set: the page\'s own default) ──');
    const op = await openPage(browser);
    const before = op.__rec.requests.length;
    await op.evaluate(() => window.__pppTest.nav('My Songs'));
    const made = {};
    for (const name of ['christ-arose', 'nearer-my-god', 'pass-me-not', 'all-creatures']) {
      const id = await addSong(op, HYMN(name));
      const r = await overlayArrange(op, id, 'intermediate', 'balanced');
      made[name] = r;
      ok(name + ': saved as a new song, marked as the one-note-per-hand arranger', r.saved && r.slot.importSource && r.slot.importSource.arrangement && r.slot.importSource.arrangement.engine === 'ppp.g9-single' && r.slot.importSource.provider === 'PPP one-note-per-hand arranger', r.saved ? JSON.stringify(r.slot.importSource.arrangement) : r.status);
      ok(name + ': no hand starts two notes at once, both hands are used, ' + (r.attacks ? r.attacks.notes : '?') + ' notes', r.saved && r.attacks.perAttack.filter(n => n > 1).length === 0 && r.attacks.hands === 'lr' && r.attacks.notes > 100, r.saved ? JSON.stringify({ hands: r.attacks.hands, notes: r.attacks.notes }) : '');
    }
    /* whether the background load or the first arrangement asked first, over the whole life of the page each file was asked for once */
    const asked = op.__rec.requests.filter(u => OPTION_FILES.test(u));
    const names = asked.map(u => u.split('?')[0]);
    ok('the option\'s 14 scripts were requested once each over the whole session (background load or first arrangement, never both)', OPTION_SCRIPTS.every(f => names.filter(n => n === f).length === 1), names.join(' '));
    ok('and so was the reference data (G6a weights, method books), once each', names.filter(n => /method-books\.json$/.test(n)).length === 1 && names.filter(n => /g6a-v1\.json$/.test(n)).length === 1, names.filter(n => /json$/.test(n)).join(' '));
    const others = op.__rec.requests.slice(before).filter(u => !OPTION_FILES.test(u) && /\.(js|json)(\?|$)/.test(u) && !/engrave\/|i18n|catalog\//.test(u));
    ok('no other script or data request came with it', others.length === 0, others.join(' '));

    {
      const ch = await addSong(op, HYMN('christ-arose'));
      const og = await overlayArrange(op, ch, 'original', 'balanced');
      const wantOrig = process.env.G9E_WRITE_GOLDEN === '1' ? null : JSON.parse(fs.readFileSync(GOLDEN, 'utf8')).hashes['overlay|christ-arose|original|balanced'];
      ok('the Song Arranger, on by default, leaves "Original transcription" alone: the same copy origin/main makes', og.saved && og.slot.importSource.arrangement.engine !== 'ppp.g9-single' && og.hash === wantOrig, (og.hash || '') + ' vs ' + wantOrig);
    }
    const id = made['christ-arose'].id;
    const drawn = await (async () => {
      const d0 = await op.evaluate(() => (window.PPPEngravePage && window.PPPEngravePage.stats.draws) || 0);
      await op.evaluate(() => window.__pppTest.nav('My Songs'));
      await sleep(250);
      await op.evaluate(i => document.querySelector('[data-open-song="' + i + '"]').click(), id);
      await sleep(1800);
      return op.evaluate(d0 => ({
        draws: ((window.PPPEngravePage && window.PPPEngravePage.stats.draws) || 0) - d0, fallbacks: JSON.stringify(window.PPP.engraveStats.fallbacks),
        svg: !!document.querySelector('svg [data-onset], svg g[id^="i"], main svg'), songId: window.PPP.app.state.songId,
        strikes: window.PPP.PianoScore.of(window.PPP.app.state.score).strikes.length, notes: window.PPP.app.state.score.notes.filter(n => !n.rest).length
      }), d0);
    })();
    ok('the saved arrangement opens and the engraver draws it, no fallback', drawn.songId === id && drawn.draws > 0 && drawn.fallbacks === '{}' && drawn.svg, JSON.stringify(drawn));
    ok('it has a sounding note list (the plan PianoScore plays from) with every note in it', drawn.strikes >= drawn.notes * 0.9 && drawn.strikes > 0, drawn.strikes + ' strikes, ' + drawn.notes + ' notes');
    const played = await op.evaluate(async () => { window.PPP.app.togglePlay(); await new Promise(r => setTimeout(r, 700)); const on = !!window.PPP.app.state.playing; window.PPP.app.togglePlay(); return on; });
    ok('Play starts without an error', played === true, String(played));
    ok('no page or console error in all of it', op.__rec.pageErrors.length === 0 && op.__rec.consoleErrors.length === 0, JSON.stringify(op.__rec.pageErrors.concat(op.__rec.consoleErrors)));

    console.log('\n── the chip off gives origin/main\'s arrangement, on again gives one note per hand again ──');
    await op.close();
    const goldenNow = process.env.G9E_WRITE_GOLDEN === '1' ? null : JSON.parse(fs.readFileSync(GOLDEN, 'utf8')).hashes;
    {
      const vp = await openPage(browser);
      /* the background load has finished before legacy is asked for: it must not disturb the standard arrangement */
      await vp.waitForFunction(() => !!(window.PPPCandidates && window.PPPRepair), { timeout: 30000 });
      const vid = await addSong(vp, HYMN('christ-arose'));
      const on1 = await overlayArrange(vp, vid, 'intermediate', 'balanced');
      ok('fresh page, Song Arranger: the default arrangement is one note per hand', on1.saved && on1.mode === 'single' && on1.slot.importSource.arrangement.engine === 'ppp.g9-single', on1.saved ? on1.mode + ' ' + on1.slot.importSource.arrangement.engine : on1.status);
      const off = await overlayArrange(vp, vid, 'intermediate', 'balanced', 'chip');
      const want = goldenNow && goldenNow['overlay|christ-arose|intermediate|balanced'];
      ok('the chip pressed off: PPP.arranger is legacy and christ-arose (intermediate, balanced) is the origin/main arrangement, sha for sha, after the option\'s scripts had loaded', off.saved && off.mode === 'legacy' && off.slot.importSource.arrangement.engine !== 'ppp.g9-single' && (goldenNow === null || off.hash === want), (off.hash || off.status) + ' vs ' + want);
      const on2 = await overlayArrange(vp, vid, 'intermediate', 'balanced', 'chip');
      ok('the chip pressed on again: one note per hand again, the same arrangement as the first time', on2.saved && on2.mode === 'single' && on2.slot.importSource.arrangement.engine === 'ppp.g9-single' && on2.hash === on1.hash, on2.hash + ' vs ' + on1.hash);
      const og2 = await overlayArrange(vp, vid, 'original', 'balanced');
      const wantO = goldenNow && goldenNow['overlay|christ-arose|original|balanced'];
      ok('"Original transcription" with the default on: not arranged, the origin/main copy', og2.saved && og2.slot.importSource.arrangement.engine !== 'ppp.g9-single' && (goldenNow === null || og2.hash === wantO), (og2.hash || og2.status) + ' vs ' + wantO);
      ok('no page or console error', vp.__rec.pageErrors.length === 0 && vp.__rec.consoleErrors.length === 0, JSON.stringify(vp.__rec.pageErrors.concat(vp.__rec.consoleErrors)));
      await vp.close();
    }

    console.log('\n── on by default: the recognition review screen ──');
    const rv = await openPage(browser);
    await loadReview(rv, HYMN('christ-arose'), 'christ-arose');
    await sleep(800);
    const bal = await reviewApply(rv, 'intermediate', 'balanced');
    ok('the default \'balanced\' texture now takes the option (which \'g8\' never did): engine ppp.g9-single', bal.arrangement.engine === 'ppp.g9-single', JSON.stringify(bal.arrangement));
    ok('christ-arose: no hand starts two notes at once, both hands, the engraver\'s own graph kept (live), a sounding note list', bal.perAttack.filter(n => n > 1).length === 0 && bal.hands === 'lr' && bal.via === 'live' && bal.strikes > 100, JSON.stringify({ hands: bal.hands, via: bal.via, strikes: bal.strikes }));
    const adv = await reviewApply(rv, 'advanced', 'balanced');
    const jz = await reviewApply(rv, 'advanced', 'jazz');
    ok('a rich texture (jazz) takes it too, and the texture does not change the result: the same notes as balanced at that level',
      jz.arrangement.engine === 'ppp.g9-single' && jz.perAttack.filter(n => n > 1).length === 0 && JSON.stringify(JSON.parse(jz.packed).score.notes) === JSON.stringify(JSON.parse(adv.packed).score.notes), JSON.stringify(jz.arrangement));
    await loadReview(rv, HYMN('christ-arose'), 'christ-arose');
    const orig = await reviewApply(rv, 'original', 'balanced');
    ok('"Original transcription" is not arranged (the default is on): the heard notes are restored, engine not g9', orig.arrangement.engine !== 'ppp.g9-single' && !orig.arrangement.singleFallback, JSON.stringify(orig.arrangement));
    for (const name of ['nearer-my-god', 'pass-me-not']) {
      await loadReview(rv, HYMN(name), name);
      const r = await reviewApply(rv, 'intermediate', 'balanced');
      ok(name + ' on the review screen: one note per hand', r.arrangement.engine === 'ppp.g9-single' && r.perAttack.filter(n => n > 1).length === 0 && r.hands === 'lr', JSON.stringify({ arr: r.arrangement, hands: r.hands }));
    }
    ok('no page or console error on the review screen', rv.__rec.pageErrors.length === 0 && rv.__rec.consoleErrors.length === 0, JSON.stringify(rv.__rec.pageErrors.concat(rv.__rec.consoleErrors)));
    await rv.close();

    console.log('\n── the chip, from the keyboard; the mode it returns to ──');
    {
      const kb = await openPage(browser);
      await loadReview(kb, HYMN('christ-arose'), 'christ-arose');
      await kb.focus('[data-arrangement] [data-single-note-option]');
      await kb.keyboard.press('Space');
      await sleep(300);
      const s1 = await kb.evaluate(() => ({ pressed: document.querySelector('[data-single-note-option]').getAttribute('aria-pressed'), mode: window.PPP.arranger, playing: !!window.PPP.app.state.playing }));
      ok('Space on the focused chip (pressed by default) turns it off, back to legacy (and does not start playback)', s1.pressed === 'false' && s1.mode === 'legacy' && !s1.playing, JSON.stringify(s1));
      await kb.keyboard.press('Enter');
      await sleep(300);
      const s2 = await kb.evaluate(() => ({ pressed: document.querySelector('[data-single-note-option]').getAttribute('aria-pressed'), mode: window.PPP.arranger }));
      ok('Enter presses it again: on, single', s2.pressed === 'true' && s2.mode === 'single', JSON.stringify(s2));
      await kb.evaluate(() => { window.PPP.arranger = 'g8'; });
      await kb.click('[data-arrangement] [data-single-note-option]'); await sleep(200);
      const s3 = await kb.evaluate(() => window.PPP.arranger);
      await kb.click('[data-arrangement] [data-single-note-option]'); await sleep(200);
      const s4 = await kb.evaluate(() => window.PPP.arranger);
      ok('switching the chip off returns to the mode that was set before (a console-set g8 is not lost)', s3 === 'single' && s4 === 'g8', s3 + ' then ' + s4);
      await kb.close();
    }

    console.log('\n── refusals ──');
    const fp = await openPage(browser);
    const fid = await addSong(fp, SONATINA_020);
    const keysBefore = await songKeys(fp);
    const fr = await overlayArrange(fp, fid, 'intermediate', 'balanced');
    ok('Song Arranger, an unreachable piece (sonatina/020): nothing is saved, the dialog stays open and says why in words the person can act on', !fr.saved && fr.open && /could not be made in one-note-per-hand mode\. Turn the option off/.test(fr.status) && (await songKeys(fp)).length === keysBefore.length, fr.status.split('\n').filter(l => /one-note/.test(l)).join(' | '));
    await fp.close();

    const fr2 = await openPage(browser);
    await loadReview(fr2, SONATINA_020, 'sonatina 020');
    await sleep(600);
    const fb = await reviewApply(fr2, 'advanced', 'balanced');
    ok('review screen, an unreachable piece: the standard arrangement is shown, marked so in its source (singleFallback), not labelled one-note-per-hand',
      fb.arrangement.singleFallback === 'UNREACHABLE' && fb.arrangement.engine !== 'ppp.g9-single' && fb.notes > 100, JSON.stringify(fb.arrangement));
    ok('and the notice stays on the screen, under the controls', fb.status === 'This piece could not be made in one-note-per-hand mode, so the standard arrangement is shown.' &&
      (await fr2.evaluate(() => document.querySelector('[data-arrangement]').innerText.indexOf('so the standard arrangement is shown') > -1)), fb.status);
    ok('nothing was thrown for it', fr2.__rec.pageErrors.length === 0 && fr2.__rec.consoleErrors.length === 0, JSON.stringify(fr2.__rec.pageErrors.concat(fr2.__rec.consoleErrors)));
    await fr2.close();

    /* the option's scripts cannot be loaded: the background load fails quietly, and the Apply that needs them shows the notice; when the network is back the next Apply asks again */
    const bp = await openPage(browser, { block: /\/candidates\/index\.js/ });
    await loadReview(bp, HYMN('christ-arose'), 'christ-arose');
    await bp.waitForFunction(() => new Promise(r => { const n = performance.getEntriesByType('resource').filter(x => /candidates\/index\.js/.test(x.name)).length; r(n > 0); }), { timeout: 30000 }).catch(() => {});
    await sleep(1500);
    ok('a background load that fails is quiet: no page error, no console error, the chip still pressed', bp.__rec.pageErrors.length === 0 && bp.__rec.consoleErrors.length === 0 && bp.__rec.blocked.length > 0 && (await bp.evaluate(() => document.querySelector('[data-single-note-option]').getAttribute('aria-pressed') === 'true')), JSON.stringify({ blocked: bp.__rec.blocked.length, e: bp.__rec.pageErrors.concat(bp.__rec.consoleErrors) }));
    const nb = await reviewApply(bp, 'intermediate', 'balanced');
    ok('option scripts that cannot be loaded (candidates/index.js refused): the same notice and the standard arrangement, not a blank screen or a silent switch',
      nb.arrangement.singleFallback === 'SINGLE_NOT_LOADED' && /standard arrangement is shown/.test(nb.status) && bp.__rec.blocked.length > 0, JSON.stringify(nb.arrangement));
    bp.__rec.blockOn = false; /* the network is back */
    await loadReview(bp, HYMN('christ-arose'), 'christ-arose');
    const nb2 = await reviewApply(bp, 'intermediate', 'balanced');
    ok('the failure was not kept: the next Apply asks again and gives one note per hand, with no reload', nb2.arrangement.engine === 'ppp.g9-single' && !nb2.arrangement.singleFallback && nb2.perAttack.filter(n => n > 1).length === 0, JSON.stringify(nb2.arrangement));
    ok('no page error in all of it', bp.__rec.pageErrors.length === 0, JSON.stringify(bp.__rec.pageErrors));
    await bp.close();

    /* a blip in the reference data (whether the background load or the first Apply asks) must not cost the whole session */
    const rp2 = await openPage(browser, { failWhile: /method-books\.json/ });
    await loadReview(rp2, HYMN('christ-arose'), 'christ-arose');
    const b1 = await reviewApply(rp2, 'intermediate', 'balanced');
    ok('reference data that cannot be fetched: the notice and the standard arrangement (REFERENCE_UNAVAILABLE)', b1.arrangement.singleFallback === 'REFERENCE_UNAVAILABLE' && /standard arrangement is shown/.test(b1.status), JSON.stringify(b1.arrangement));
    rp2.__rec.failOn = false;
    await loadReview(rp2, HYMN('christ-arose'), 'christ-arose');
    const b2 = await reviewApply(rp2, 'intermediate', 'balanced');
    ok('the next Apply asks again and works, with no reload', b2.arrangement.engine === 'ppp.g9-single' && b2.perAttack.filter(n => n > 1).length === 0, JSON.stringify(b2.arrangement));
    await rp2.close();

    console.log('\n── an arrangement asked for while the background load is still in flight ──');
    {
      /* every file of the option is held 3 s; the page is used at once: the background load is started by hand (what the timer does at 2.5 s), then Apply */
      const ra = await openPage(browser, { until: 'domcontentloaded', delay: { re: OPTION_FILES, ms: 3000 } });
      await ra.waitForFunction(() => !!(window.PPP && window.PPP.app && window.PPP.app.warmSingleModules), { timeout: 30000 });
      await ra.evaluate(() => window.PPP.app.warmSingleModules());
      await sleep(300);
      await loadReview(ra, HYMN('christ-arose'), 'christ-arose');
      const pre = await ra.evaluate(() => ({ loaded: !!(window.PPPCandidates && window.PPPRepair), mode: window.PPP.arranger }));
      const t0 = Date.now();
      const rr = await reviewApply(ra, 'intermediate', 'balanced');
      const names2 = ra.__rec.requests.filter(u => OPTION_FILES.test(u)).map(u => u.split('?')[0]);
      ok('precondition: Apply was pressed while the files were still in flight', pre.loaded === false && pre.mode === 'single', JSON.stringify(pre));
      ok('Apply waited for the same download: one note per hand, and every script and data file was asked for exactly once', rr.arrangement.engine === 'ppp.g9-single' && !rr.arrangement.singleFallback && OPTION_SCRIPTS.every(f => names2.filter(n => n === f).length === 1) && names2.filter(n => /method-books\.json$/.test(n)).length === 1 && names2.filter(n => /g6a-v1\.json$/.test(n)).length === 1, JSON.stringify({ engine: rr.arrangement.engine, n: names2.length, ms: Date.now() - t0 }));
      await sleep(3500); /* the page's own timer for the background load has fired by now: it finds everything there and asks for nothing */
      const names3 = ra.__rec.requests.filter(u => OPTION_FILES.test(u));
      ok('and the page\'s own background timer, firing afterwards, asked for nothing more (16 requests in all)', names3.length === 16, String(names3.length));
      ok('no page or console error', ra.__rec.pageErrors.length === 0 && ra.__rec.consoleErrors.length === 0, JSON.stringify(ra.__rec.pageErrors.concat(ra.__rec.consoleErrors)));
      await ra.close();
    }
  } catch (e) {
    ok('the suite ran to the end', false, e && e.stack || String(e));
  } finally {
    await browser.close();
    await srv.close();
  }
  console.log(errors.length ? '\n' + errors.length + ' FAILED' : '\nall passed');
  process.exit(errors.length ? 1 : 0);
})();
