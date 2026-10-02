/* ============================================================================
   G9e-lite + G9e default-on (docs/GOALS/G09_CANDIDATES_CRITICS_REPAIR.md section 12): the app's "One note per hand", in the real page.

   PPP.arranger = 'single' (default since G9e default-on) | 'legacy' | 'g8'. 'single' hands the review screen's own graph (or the open song's graph
   in the Song Arranger) to G7a -> G7b -> G9a candidates.run({ singleNoteHands: true }) -> G9b repair -> TD16 8va/8vb -> the conversion 'g8' uses.
   The control ("chip") is pressed on a fresh page; pressing it turns it off (PPP.arranger 'legacy', the standard arrangement).

   What this checks (the two screens where a person arranges a piece: the Song Arranger in My Songs, and the recognition review screen):
     - the switch: single by default, 'legacy' and 'g8' accepted, anything else legacy
     - the option's 14 scripts and 2 data files (16 requests) are asked for only when a screen that arranges opens (the Song Arranger, the recognition
       review), never by a page that does not arrange, and then once each, after the first paint; an arrangement asked for while they are still
       in flight waits for them (no second request); a script that fails to load is asked for again with the ones after it, nothing before it twice
     - the identity guarantee moved: with PPP.arranger = 'legacy' the arrangement the real entry points make is identical to what origin/main made
       (sha-256 of the saved score, tests/fixtures/g9e-legacy-identity.json, made from a build of origin/main 14a76f8, PPP.arranger = 'legacy'),
       also after the background load has finished, and after the chip was pressed off in the page
     - the control: present on both screens, PRESSED on a fresh page, labelled in English and Korean, inside the viewport at 400 px with no sideways scroll;
       pressing it turns it off and on again
     - on by default: christ-arose, nearer-my-god, pass-me-not and all-creatures come out with no hand starting two notes at once, both hands used,
       drawn by the engraver (no fallback), with a sounding note list, and no console or page error; the review screen does it for the default
       'balanced' texture too (which 'g8' never did)
     - "Original transcription" is not arranged; its copy title does not say one note per hand (the suggestion follows the level)
     - the copy is saved under the title the person typed (or the one suggested), on the card and in the score
     - the texture note ("Texture choices don't apply in one-note-per-hand mode") beside the texture control, only when the mode applies (ko/ja/zh in the catalogs)
     - formerly refused pieces (G9e refusals): happy-birthday (no plan at any level under the strict search) and sonatina/020 on the review screen are now
       made one note per hand, marked levelNote 'relaxed-plan', with a sentence that stays on the review screen and is in the success toast (ko/ja/zh in the
       catalogs); the library card says one-note-per-hand; a piece that needs no relaxation has no such note
     - a stray note (G9e stray-note rescue): a piece whose only obstacle is a note no hand can reach in the time between its neighbours (tests/fixtures/g9e-stray-note.musicxml: a
       [C4, F4] chord between A6 and D6 in the melody voice, twice) was refused with ALL_CANDIDATES_HAVE_HARD_VIOLATIONS; it is now made one note per hand with the stray notes left
       out, marked (arrangement.rescued = how many), with a sentence in the Song Arranger's toast and on the review screen (ko/ja/zh in the catalogs)
     - small gaps (G9f): tests/fixtures/g9f-small-gaps.musicxml (a printed score with a 64th rest between its right-hand notes, 32 of them) keeps them; only a transcription is tidied
     - transcription rests at the source: the review screen's "Rewrite the rhythm" of heard notes (seeded run on the 32nd grid) writes a score with no 32nd or 64th rest (Score,
       the drawn graph and the DOM), the same notes, none shorter, the same strikes; the same notes written without the pass have them
     - consecutive rests: the same kind of heard notes (a seeded 10-bar piece whose silences come in several pieces) through "Rewrite the rhythm", Accept (the saved transcription) and the Song Arranger's
       one-note copy: no run of rests that is not in the standard tiling (gaps.restRuns), no dotted 16th, 32nd or 64th rest in the graph or the DOM, the same notes; the control has them
     - left-hand run rests: a seeded left-hand run of 16ths with about one note in eight not heard (the transcription writes a lone 16th rest in it) through "Rewrite the rhythm", Accept and the
       Song Arranger's one-note copy: no lone 16th rest of the left hand between two notes in the Score, the graph or the DOM, the previous note an eighth, the same note onsets and pitches, the right
       hand's rests untouched, a valid graph; the control (written without the pass) has them
     - recording notation (tuplets and the grid): a seeded 10-bar piece with triplet beats (three eighths, a rest and two eighths, a quarter and an eighth) and straight 16ths in both hands through
       "Rewrite the rhythm", Accept and the Song Arranger's one-note copy: every voice of every bar adds up as the Score draws it (drawn values with the tuplet ratio), tuplet brackets in the
       Score and the DOM, a valid graph with no W-DISPLAY-DURATION, a strike for every heard note; the control (written without exact bars) has bars that do not add up
     - refusals and failed downloads: a piece that stays unreachable (czerny849/009), option scripts (the candidates one, or another of the fourteen) or
       reference data that cannot be loaded (also when it is the warm-up that fails: no error, and the next arrangement asks again). The Song Arranger
       saves NOTHING behind the person's back: its window stays open with a notice that does not go away and two choices ('Save the standard arrangement',
       'Cancel'); the standard copy (titled as a standard copy) is saved on the click. The review screen shows the STANDARD arrangement instead, with a
       notice that stays on the screen, marked in its source; both are what the option-off request gives

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
const HAPPY = path.join(REPO, 'catalog', 'happy-birthday.musicxml');
const SONATINA_020 = path.join(REPO, 'catalog', 'method', 'sonatina', '020.mxl');
const SMALL_GAPS = path.join(REPO, 'tests', 'fixtures', 'g9f-small-gaps.musicxml'); /* G9f: a 64th rest after the first eighth of every beat, between notes */
const STRAY = path.join(REPO, 'tests', 'fixtures', 'g9e-stray-note.musicxml'); /* G9e stray-note rescue: melody A6 / [C4, F4] chord / D6, twice; refused before the rescue */
const CZERNY_849_009 = path.join(REPO, 'catalog', 'method', 'czerny849', '009.mxl'); /* no plan even relaxed (too fast for the levels): the refusal that stays (G9e refusals) */
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
async function overlayArrange(page, songId, level, style, chip, typed) {
  await page.evaluate(() => window.__pppTest.nav('My Songs'));
  await sleep(250);
  await page.evaluate(i => document.querySelector('[data-arrange-song="' + i + '"]').click(), songId);
  await sleep(250);
  if (chip) { await page.click('[data-song-arranger] [data-single-note-option]'); await sleep(250); } /* the real chip, pressed once */
  await page.select('[data-song-arrange-level]', level);
  await page.select('[data-song-arrange-style]', style);
  if (typed) { await page.$eval('[data-song-arrange-title]', el => { el.focus(); el.select(); }); await page.keyboard.type(typed); await sleep(150); }
  const inputTitle = await page.evaluate(() => (document.querySelector('[data-song-arrange-title]') || {}).value);
  const before = await songKeys(page);
  await page.click('[data-create-song-arrangement]');
  /* finished: the dialog closed (saved), or it is idle again with a notice (refused) */
  await page.waitForFunction(() => {
    const d = document.querySelector('[data-song-arranger]');
    if (!d) return true;
    const b = document.querySelector('[data-create-song-arrangement]');
    return !!b && !/Creating/.test(b.innerText) && /could not be made|could not be opened|unavailable|could not be created/.test(d.innerText);
  }, { timeout: 90000 });
  const toast = await page.evaluate(() => window.PPP.app.state.toast || '');
  await sleep(300);
  const mode = await page.evaluate(() => window.PPP.arranger);
  const after = await songKeys(page);
  const fresh = after.filter(k => before.indexOf(k) < 0)[0] || null;
  const open = await page.evaluate(() => !!document.querySelector('[data-song-arranger]'));
  const status = open ? await page.evaluate(() => document.querySelector('[data-song-arranger]').innerText) : '';
  if (!fresh) return { saved: false, open: open, status: status, mode: mode, toast: toast, inputTitle: inputTitle };
  const id = fresh.replace('ppp.song.v1.', '');
  const slot = JSON.parse(await page.evaluate(k => localStorage.getItem(k), fresh));
  const titles = await page.evaluate(i => ({
    card: (window.PPP.app.libraryRead().songs.find(x => x.id === i) || {}).title,
    score: window.PPP.app.scoreForArrangement(i).title,
    shelf: document.body.innerText
  }), id);
  const notesHash = await page.evaluate(i => JSON.stringify(window.PPP.app.scoreForArrangement(i).notes.map(n => [n.hand, n.m, n.b, n.midi, n.dur, n.rest ? 1 : 0])), id);
  const attacks = await page.evaluate(i => {
    const s = window.PPP.app.scoreForArrangement(i);
    const by = new Map();
    s.notes.filter(n => !n.rest).forEach(n => { const k = n.hand + '|' + n.m + '|' + n.b; by.set(k, (by.get(k) || 0) + 1); });
    return { perAttack: [...by.values()], hands: [...new Set(s.notes.filter(n => !n.rest).map(n => n.hand))].sort().join(''), notes: s.notes.filter(n => !n.rest).length };
  }, id);
  return { saved: true, id: id, slot: slot, open: open, mode: mode, toast: toast, inputTitle: inputTitle, cardTitle: titles.card, scoreTitle: titles.score, shelf: titles.shelf,
    notesHash: sha(notesHash), hash: sha(JSON.stringify(strip(slot.score))), attacks: attacks };
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
      arrangement: s.importSource.arrangement, status: s.arrangementStatus, toast: s.toast || '', say: (document.querySelector('[role=status], [aria-live]') || {}).innerText || '',
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
  /* the review screen's heard notes are a recording (made from the hymn, each held 95% of its length), and the app now closes a recording's sub-16th gaps (docs/GOALS/G09 section 12,
     'Transcription rests at the source'): the golden is origin/main's, so the closing is switched off here, which is what compares everything else (the arrangers, the layout of the copy)
     with origin/main. The closing itself is checked in its own section below. */
  await rp.evaluate(() => { const A = window.PPPAudioScore, f = A.toMusicXml; A.toMusicXml = (i, o) => f.call(A, i, Object.assign({}, o, { closeGaps: false, exactBars: false })); });
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
    /* a page that does not arrange asks for none of the option's files, however long it stays (no timer starts a download) */
    await sleep(4500);
    const idle = page0.__rec.requests.filter(r => OPTION_FILES.test(r));
    ok('a fresh page that never opens an arranging screen requests none of the option\'s 16 files, 5 s after load', idle.length === 0, idle.join(', '));
    /* the Song Arranger opens on the sample: now they come */
    await page0.evaluate(() => window.__pppTest.nav('My Songs'));
    await sleep(250);
    await page0.evaluate(() => document.querySelector('[data-arrange-song="demo"]').click());
    await page0.waitForFunction(() => !!(window.PPPCandidates && window.PPPRepair), { timeout: 30000 }).catch(() => {});
    await sleep(300);
    const timing = await page0.evaluate(re => {
      const rx = new RegExp(re), nav = performance.getEntriesByType('navigation')[0] || {};
      const fcp = (performance.getEntriesByType('paint').find(x => x.name === 'first-contentful-paint') || {}).startTime;
      const mine = performance.getEntriesByType('resource').filter(r => rx.test(r.name));
      return { n: mine.length, first: Math.min.apply(null, mine.map(r => r.startTime)), fcp: fcp, loadEnd: nav.loadEventEnd, dcl: nav.domContentLoadedEventEnd };
    }, OPTION_FILES.source);
    ok('opening the Song Arranger asks for them (16 requests: 14 scripts, the weights, the method books)', timing.n === 16, JSON.stringify(timing));
    ok('and that is after the first paint and after the load event', timing.fcp > 0 && timing.first > timing.fcp && timing.first > timing.loadEnd, JSON.stringify(timing));
    const own = page0.__rec.requests.filter(r => OPTION_FILES.test(r)).map(r => r.split('?')[0]);
    ok('each of them was requested exactly once', OPTION_SCRIPTS.every(f => own.filter(n => n === f).length === 1) && own.filter(n => /method-books\.json$/.test(n)).length === 1 && own.filter(n => /g6a-v1\.json$/.test(n)).length === 1, own.join(' '));
    ok('no page or console error at load or in the download', page0.__rec.pageErrors.length === 0 && page0.__rec.consoleErrors.length === 0, JSON.stringify(page0.__rec.pageErrors.concat(page0.__rec.consoleErrors)));
    await page0.close();

    console.log('\n── the identity guarantee: with PPP.arranger = \'legacy\' the output is origin/main\'s ──');
    const got = process.env.G9E_FAST === '1' ? null : await identityHashes(browser); /* G9E_FAST=1: development only, skips the slow identity recipe */
    if (process.env.G9E_WRITE_GOLDEN === '1') {
      fs.writeFileSync(GOLDEN, JSON.stringify({ madeFrom: 'origin/main 14a76f8 (PPP.arranger = \'legacy\', then the default)', hashes: got }, null, 1) + '\n');
      console.log('  wrote ' + GOLDEN + ' (' + Object.keys(got).length + ' hashes)');
      await browser.close(); await srv.close(); process.exit(0);
    } else if (got) {
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
      /* the option's first arrangement below loads its scripts before legacy is asked for: they must not disturb the standard arrangement */
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

    console.log('\n── the copy\'s title: what is typed (or suggested) is what is saved; the suggestion follows the level ──');
    {
      const tp = await openPage(browser);
      const tid = await addSong(tp, HYMN('christ-arose'));
      await tp.evaluate(() => window.__pppTest.nav('My Songs'));
      await sleep(250);
      await tp.evaluate(i => document.querySelector('[data-arrange-song="' + i + '"]').click(), tid);
      await sleep(300);
      const titleNow = () => tp.evaluate(() => document.querySelector('[data-song-arrange-title]').value);
      const t1 = await titleNow();
      await tp.select('[data-song-arrange-level]', 'original'); await sleep(250);
      const t2 = await titleNow();
      await tp.select('[data-song-arrange-level]', 'beginner'); await sleep(250);
      const t3 = await titleNow();
      await tp.select('[data-song-arrange-style]', 'jazz'); await sleep(250);
      const t4 = await titleNow();
      ok('the suggested title says one-note-per-hand for a level that goes to it, not for "Original transcription", and follows the level back and forth', /one-note-per-hand/.test(t1) && !/one-note-per-hand/.test(t2) && / Balanced piano arrangement$/.test(t2) && /one-note-per-hand/.test(t3) && /one-note-per-hand/.test(t4), JSON.stringify([t1, t2, t3, t4]));
      await tp.$eval('[data-song-arrange-title]', el => { el.focus(); el.select(); }); await tp.keyboard.type('My own name'); await sleep(200);
      await tp.select('[data-song-arrange-level]', 'original'); await sleep(250);
      ok('a title the person typed is not touched by a level change', (await titleNow()) === 'My own name', await titleNow());
      await tp.evaluate(() => window.PPP.app.closeSongArranger());
      await sleep(200);
      const a1 = await overlayArrange(tp, tid, 'intermediate', 'balanced');
      ok('the copy saved in one-note-per-hand mode has the suggested title, on the card and in the score (not the original\'s)', a1.saved && a1.slot.importSource.arrangement.engine === 'ppp.g9-single' && /one-note-per-hand/.test(a1.inputTitle) && a1.cardTitle === a1.inputTitle && a1.scoreTitle === a1.inputTitle && a1.slot.fileName === a1.inputTitle, JSON.stringify({ input: a1.inputTitle, card: a1.cardTitle, score: a1.scoreTitle }));
      const a2 = await overlayArrange(tp, tid, 'advanced', 'balanced', null, 'Typed 한 손 title');
      ok('and with a title the person typed, that is the card\'s and the score\'s title', a2.saved && a2.cardTitle === 'Typed 한 손 title' && a2.scoreTitle === 'Typed 한 손 title' && a2.shelf.indexOf('Typed 한 손 title') > -1, JSON.stringify({ card: a2.cardTitle, score: a2.scoreTitle }));
      const a3 = await overlayArrange(tp, tid, 'original', 'balanced');
      ok('"Original transcription": the input and the saved title agree, and neither says one note per hand', a3.saved && !/one-note-per-hand/.test(a3.inputTitle) && a3.cardTitle === a3.inputTitle && a3.scoreTitle === a3.inputTitle, JSON.stringify({ input: a3.inputTitle, card: a3.cardTitle, score: a3.scoreTitle }));
      ok('no page or console error', tp.__rec.pageErrors.length === 0 && tp.__rec.consoleErrors.length === 0, JSON.stringify(tp.__rec.pageErrors.concat(tp.__rec.consoleErrors)));
      await tp.close();
    }

    console.log('\n── the texture note: the texture choices do nothing in this mode, and the screens say so ──');
    {
      const NOTE = 'Texture choices don\'t apply in one-note-per-hand mode; turn it off to use them.';
      const xp = await openPage(browser);
      await loadReview(xp, HYMN('christ-arose'), 'christ-arose');
      const note = () => xp.evaluate(() => { const e = document.querySelector('[data-arrangement] [data-texture-note]'); return e ? e.innerText.trim() : null; });
      const n1 = await note();
      await xp.select('[data-arrangement-level]', 'original'); await sleep(250);
      const n2 = await note();
      await xp.select('[data-arrangement-level]', 'advanced'); await sleep(250);
      const n3 = await note();
      await xp.click('[data-arrangement] [data-single-note-option]'); await sleep(250);
      const n4 = await note();
      await xp.click('[data-arrangement] [data-single-note-option]'); await sleep(250);
      const n5 = await note();
      ok('review screen: the note is beside the texture control when the mode applies (default, level advanced)', n1 === NOTE && n3 === NOTE && n5 === NOTE, JSON.stringify([n1, n3, n5]));
      ok('and absent for "Original transcription" and when the chip is off', n2 === null && n4 === null, JSON.stringify([n2, n4]));
      const jz = await reviewApply(xp, 'advanced', 'jazz');
      ok('the success message of a one-note-per-hand result claims no texture (jazz was chosen)', jz.arrangement.engine === 'ppp.g9-single' && /one-note-per-hand/.test(jz.toast) && !/jazz/i.test(jz.toast + ' ' + jz.status), JSON.stringify({ toast: jz.toast, status: jz.status }));
      await xp.close();

      const sp = await openPage(browser);
      const sid = await addSong(sp, HYMN('christ-arose'));
      await sp.evaluate(() => window.__pppTest.nav('My Songs'));
      await sleep(250);
      await sp.evaluate(i => document.querySelector('[data-arrange-song="' + i + '"]').click(), sid);
      await sleep(300);
      const hint = () => sp.evaluate(() => document.querySelector('[data-song-style-hint]').innerText.trim());
      const h1 = await hint();
      await sp.select('[data-song-arrange-level]', 'original'); await sleep(250);
      const h2 = await hint();
      await sp.select('[data-song-arrange-level]', 'beginner'); await sleep(250);
      await sp.click('[data-song-arranger] [data-single-note-option]'); await sleep(250);
      const h3 = await hint();
      ok('Song Arranger: beside the texture control the note replaces the texture\'s description while the mode applies', h1 === NOTE, h1);
      ok('and for "Original transcription" and with the chip off the texture\'s own description is there', h2 !== NOTE && h3 !== NOTE && h2.length > 20 && h3.length > 20 && !/one-note-per-hand/.test(h2 + h3), JSON.stringify([h2, h3]));
      await sp.close();

      const cat = {};
      for (const loc of ['ko-KR', 'ja-JP', 'zh-CN']) cat[loc] = JSON.parse(fs.readFileSync(path.join(REPO, 'i18n', loc + '.json'), 'utf8')).content;
      const KEYS = [NOTE, 'This piece could not be made in one-note-per-hand mode, so the standard arrangement was saved.'];
      ok('the note and the saved-standard-copy notice are in the ko, ja and zh catalogs, translated (not the English)', Object.keys(cat).every(l => KEYS.every(k => typeof cat[l][k] === 'string' && cat[l][k].length > 5 && cat[l][k] !== k)), JSON.stringify(Object.keys(cat).map(l => KEYS.map(k => !!cat[l][k]))));
      const kx = await openPage(browser, { locale: 'ko-KR' });
      await loadReview(kx, HYMN('christ-arose'), 'christ-arose');
      const kn = await kx.evaluate(() => { const e = document.querySelector('[data-arrangement] [data-texture-note]'); return e ? e.innerText.trim() : null; });
      ok('in Korean the note on the review screen is the catalog\'s', kn === cat['ko-KR'][NOTE], String(kn));
      await kx.close();
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

    console.log('\n── formerly refused pieces: now one note per hand, and the screens say when it may be harder than the level ──');
    /* G9e refusals (docs/GOALS/G09 section 12): a dense piece has no plan under the strict search (a hand's source chords, key count, density, range) although the
       one-note-per-hand pass would never play them; arrangement/plan.js relax 2 plans it, and the result says it may be harder than the level that was chosen */
    const NOTE_HARD = 'This piece has many notes, so the arrangement may be a little harder than the level you chose.';
    {
      const hp = await openPage(browser);
      const hid = await addSong(hp, HAPPY);
      const h1 = await overlayArrange(hp, hid, 'intermediate', 'balanced');
      const hcard = h1.saved ? await hp.evaluate(i => { const s = window.PPP.app.libraryRead().songs.find(x => x.id === i); return { title: s.title, composer: s.composer, arr: s.arrangement }; }, h1.id) : null;
      ok('Song Arranger, happy-birthday (it had no plan at any level): saved as a one-note-per-hand arrangement, marked as planned by the relaxed pass, no fallback',
        h1.saved && h1.slot.importSource.arrangement.engine === 'ppp.g9-single' && h1.slot.importSource.arrangement.levelNote === 'relaxed-plan' && !h1.slot.importSource.arrangement.singleFallback && h1.slot.importSource.provider === 'PPP one-note-per-hand arranger', h1.saved ? JSON.stringify(h1.slot.importSource.arrangement) : h1.status);
      ok('its library card says one-note-per-hand, not "Balanced piano arrangement" (title and composer line)', !!hcard && /one-note-per-hand arrangement$/.test(hcard.title) && !/Balanced piano/.test(hcard.title + ' ' + hcard.composer) && /PPP one-note-per-hand arrangement/.test(hcard.composer), JSON.stringify(hcard));
      ok('the toast carries the harder-than-chosen sentence after the saved message', h1.saved && h1.toast.indexOf('Saved ') === 0 && h1.toast.indexOf(NOTE_HARD) > 0, h1.toast);
      ok('no hand starts two notes, both hands are used', h1.saved && h1.attacks.perAttack.filter(n => n > 1).length === 0 && h1.attacks.hands === 'lr' && h1.attacks.notes > 20, h1.saved ? JSON.stringify({ hands: h1.attacks.hands, notes: h1.attacks.notes }) : '');
      ok('no page or console error', hp.__rec.pageErrors.length === 0 && hp.__rec.consoleErrors.length === 0, JSON.stringify(hp.__rec.pageErrors.concat(hp.__rec.consoleErrors)));
      await hp.close();
      ok('a piece that needs no relaxation (the four hymns above) has no such note, in its source or its toast', Object.keys(made).every(k => made[k].saved && !made[k].slot.importSource.arrangement.levelNote && !/harder than the level/.test(made[k].toast)), Object.keys(made).map(k => made[k].toast).join(' | '));

      /* the review screen: sonatina/020 (refused there before) is made, and the note stays on the screen, under the controls, like the fallback notice */
      const sr = await openPage(browser);
      await loadReview(sr, SONATINA_020, 'sonatina 020');
      await sleep(600);
      const sa = await reviewApply(sr, 'advanced', 'balanced');
      ok('review screen, sonatina/020 (refused there before): one note per hand, marked with the relaxed pass, no fallback', sa.arrangement.engine === 'ppp.g9-single' && sa.arrangement.levelNote === 'relaxed-plan' && !sa.arrangement.singleFallback && sa.perAttack.filter(n => n > 1).length === 0 && sa.hands === 'lr', JSON.stringify(sa.arrangement));
      ok('the note is on the screen under the controls (persistent), and in the success message', sa.status === NOTE_HARD && (await sr.evaluate(() => document.querySelector('[data-arrangement]').innerText.indexOf('may be a little harder than the level you chose') > -1)) && sa.toast.indexOf(NOTE_HARD) > 0, JSON.stringify({ status: sa.status, toast: sa.toast }));
      await sleep(4000);
      ok('and still there after the message has gone', await sr.evaluate(() => document.querySelector('[data-arrangement]').innerText.indexOf('may be a little harder than the level you chose') > -1));
      await sr.select('[data-arrangement-level]', 'beginner'); await sleep(250);
      ok('choosing another level takes the note off the screen (it was about the level that was applied)', await sr.evaluate(() => document.querySelector('[data-arrangement]').innerText.indexOf('may be a little harder than the level you chose') < 0));
      await loadReview(sr, HYMN('christ-arose'), 'christ-arose');
      const ca = await reviewApply(sr, 'intermediate', 'balanced');
      ok('a piece that needs no relaxation has no note (christ-arose)', ca.arrangement.engine === 'ppp.g9-single' && !ca.arrangement.levelNote && ca.status === '' && !/harder than the level/.test(ca.toast), JSON.stringify({ arr: ca.arrangement, status: ca.status }));
      ok('no page or console error', sr.__rec.pageErrors.length === 0 && sr.__rec.consoleErrors.length === 0, JSON.stringify(sr.__rec.pageErrors.concat(sr.__rec.consoleErrors)));
      await sr.close();
      const ck = await openPage(browser, { locale: 'ko-KR' });
      const koCat = JSON.parse(fs.readFileSync(path.join(REPO, 'i18n', 'ko-KR.json'), 'utf8')).content;
      await loadReview(ck, SONATINA_020, 'sonatina 020');
      const ka = await reviewApply(ck, 'advanced', 'balanced');
      ok('in Korean the note is the catalog\'s sentence', ka.status === koCat[NOTE_HARD] && /음이 많아/.test(ka.status), ka.status);
      await ck.close();
      const cats = {};
      for (const loc of ['ko-KR', 'ja-JP', 'zh-CN']) cats[loc] = JSON.parse(fs.readFileSync(path.join(REPO, 'i18n', loc + '.json'), 'utf8')).content;
      const KEYS2 = [NOTE_HARD, 'Save the standard arrangement', 'Dismiss', 'This piece could not be made in one-note-per-hand mode, so nothing was saved. You can save the standard arrangement instead, in which a hand may play two or more notes at once.'];
      ok('the new sentences and the Dismiss label are in the ko, ja and zh catalogs, translated', Object.keys(cats).every(l => KEYS2.every(k => typeof cats[l][k] === 'string' && cats[l][k].length > 1 && cats[l][k] !== k)), JSON.stringify(Object.keys(cats).map(l => KEYS2.map(k => !!cats[l][k]))));
    }

    console.log('\n── a stray note: the piece is made with it left out, and the screens say so ──');
    /* G9e stray-note rescue (docs/GOALS/G09 section 12): one note per hand keeps one note of the chord that sits between two high melody notes, and no hand can make that shift in the
       time (VELOCITY); every candidate had that one violation and the piece was refused. candidates/index.js strayRescue leaves the note out (its event becomes a rest). */
    const NOTE_STRAY1 = '{{n}} note was left out because it could not be played smoothly.', NOTE_STRAY = '{{n}} notes were left out because they could not be played smoothly.';
    const STRAY_TEXT = NOTE_STRAY.replace('{{n}}', '2');
    {
      const sp = await openPage(browser);
      const sid = await addSong(sp, STRAY);
      const s1 = await overlayArrange(sp, sid, 'intermediate', 'balanced');
      ok('Song Arranger, the stray-note piece: saved as a one-note-per-hand arrangement, no fallback, marked with the two notes left out',
        s1.saved && s1.slot.importSource.arrangement.engine === 'ppp.g9-single' && s1.slot.importSource.arrangement.rescued === 2 && !s1.slot.importSource.arrangement.singleFallback && !s1.slot.importSource.arrangement.levelNote, s1.saved ? JSON.stringify(s1.slot.importSource.arrangement) : JSON.stringify({ open: s1.open, status: s1.status }));
      ok('the toast carries the sentence after the saved message', s1.saved && s1.toast.indexOf('Saved ') === 0 && s1.toast.indexOf(STRAY_TEXT) > 0, s1.toast);
      ok('no hand starts two notes, both hands are used, and the rest of the piece is there (50 of the 54 notes of the source: the other note of each chord thinned, and the two left out)', s1.saved && s1.attacks.perAttack.filter(n => n > 1).length === 0 && s1.attacks.hands === 'lr' && s1.attacks.notes === 50, s1.saved ? JSON.stringify(s1.attacks) : '');
      const sn = s1.saved ? await sp.evaluate(i => window.PPP.app.scoreForArrangement(i).notes.filter(n => !n.rest && n.hand === 'r').map(n => n.midi), s1.id) : [];
      ok('the [C4, F4] chord is not in the right hand and A6 and D6 are (twice each)', s1.saved && !sn.includes(60) && !sn.includes(65) && sn.filter(x => x === 93).length === 2 && sn.filter(x => x === 86).length === 2, JSON.stringify(sn));
      ok('the library card still says one-note-per-hand', s1.saved && /one-note-per-hand arrangement$/.test(s1.cardTitle), s1.cardTitle);
      ok('no page or console error', sp.__rec.pageErrors.length === 0 && sp.__rec.consoleErrors.length === 0, JSON.stringify(sp.__rec.pageErrors.concat(sp.__rec.consoleErrors)));
      const pl = await sp.evaluate(() => [1, 2, 5].map(n => window.PPP.app.rescuedText(n)));
      ok('the sentence is singular for one note and plural for more (two keys, as the app does elsewhere)', pl[0] === NOTE_STRAY1.replace('{{n}}', '1') && pl[1] === NOTE_STRAY.replace('{{n}}', '2') && pl[2] === NOTE_STRAY.replace('{{n}}', '5'), JSON.stringify(pl));
      await sp.close();

      /* the review screen: the graph built from the heard notes */
      const rs = await openPage(browser);
      await loadReview(rs, STRAY, 'stray note');
      await sleep(600);
      const ra = await reviewApply(rs, 'intermediate', 'balanced');
      ok('review screen, the stray-note piece: one note per hand, marked with the two notes left out, no fallback', ra.arrangement.engine === 'ppp.g9-single' && ra.arrangement.rescued === 2 && !ra.arrangement.singleFallback && ra.perAttack.filter(n => n > 1).length === 0 && ra.hands === 'lr', JSON.stringify({ arr: ra.arrangement, hands: ra.hands }));
      ok('the sentence is on the screen under the controls (persistent), and in the success message', ra.status === STRAY_TEXT && (await rs.evaluate(() => document.querySelector('[data-arrangement]').innerText.indexOf('2 notes were left out because') > -1)) && ra.toast.indexOf(STRAY_TEXT) > 0, JSON.stringify({ status: ra.status, toast: ra.toast }));
      await sleep(4000);
      ok('and still there after the message has gone', await rs.evaluate(() => document.querySelector('[data-arrangement]').innerText.indexOf('2 notes were left out because') > -1));
      await rs.select('[data-arrangement-level]', 'beginner'); await sleep(250);
      ok('choosing another level takes it off the screen (it was about the arrangement that was applied)', await rs.evaluate(() => document.querySelector('[data-arrangement]').innerText.indexOf('left out because') < 0));
      await loadReview(rs, HYMN('christ-arose'), 'christ-arose');
      const rc = await reviewApply(rs, 'intermediate', 'balanced');
      ok('a piece with nothing left out has no such sentence or mark (christ-arose)', rc.arrangement.engine === 'ppp.g9-single' && rc.arrangement.rescued === undefined && rc.status === '' && !/left out because/.test(rc.toast), JSON.stringify({ arr: rc.arrangement, status: rc.status }));
      ok('no page or console error', rs.__rec.pageErrors.length === 0 && rs.__rec.consoleErrors.length === 0, JSON.stringify(rs.__rec.pageErrors.concat(rs.__rec.consoleErrors)));
      await rs.close();
      const kp = await openPage(browser, { locale: 'ko-KR' });
      const koCat2 = JSON.parse(fs.readFileSync(path.join(REPO, 'i18n', 'ko-KR.json'), 'utf8')).content;
      await loadReview(kp, STRAY, 'stray note');
      const kr = await reviewApply(kp, 'intermediate', 'balanced');
      ok('in Korean the sentence is the catalog\'s, with the count filled in', kr.status === koCat2[NOTE_STRAY].replace('{{n}}', '2') && /부드럽게 치기 어려운 음 2개/.test(kr.status), kr.status);
      await kp.close();
      const cats2 = {};
      for (const loc of ['ko-KR', 'ja-JP', 'zh-CN']) cats2[loc] = JSON.parse(fs.readFileSync(path.join(REPO, 'i18n', loc + '.json'), 'utf8')).content;
      ok('both forms of the sentence are in the ko, ja and zh catalogs, translated, with {{n}}', Object.keys(cats2).every(l => [NOTE_STRAY1, NOTE_STRAY].every(k => typeof cats2[l][k] === 'string' && cats2[l][k] !== k && cats2[l][k].indexOf('{{n}}') > -1)), JSON.stringify(Object.keys(cats2).map(l => cats2[l][NOTE_STRAY])));
    }

    console.log('\n── small gaps between notes: a printed score keeps its short rests, only a transcription is tidied (G9f) ──');
    /* G9f (docs/GOALS/G09 section 12 "G9f final-review fixes"): a transcription's note lengths are what a player did, so its arrangement kept 64th and 32nd rests between right-hand
       notes (the 90-bar audio piece: 102 of 169 gaps shorter than a 16th, rests hanging below the staff); repair/index.js closeSmallGaps tidies them, but ONLY for a transcription (the
       graph's provenance says audio-score; tests/repair/g9f-gaps.test.js covers that case: the stored real transcription and a recording-marked copy of the fixture). Here the same notes
       arrive as a MusicXML file, a printed score: tests/fixtures/g9f-small-gaps.musicxml has a 64th rest after the first eighth of every beat (32 of them, between notes), and they are
       what its edition wrote: the saved arrangement keeps them, all 72 notes and no overlap. */
    {
      const gp = await openPage(browser);
      const gid = await addSong(gp, SMALL_GAPS);
      const g1 = await overlayArrange(gp, gid, 'intermediate', 'balanced');
      ok('Song Arranger, a printed score with a 64th rest between its notes: saved as a one-note-per-hand arrangement, no fallback',
        g1.saved && g1.slot.importSource.arrangement.engine === 'ppp.g9-single' && !g1.slot.importSource.arrangement.singleFallback, g1.saved ? JSON.stringify(g1.slot.importSource.arrangement) : JSON.stringify(g1.status));
      const gs = g1.saved ? await gp.evaluate(i => {
        const sc = window.PPP.app.scoreForArrangement(i);
        const rests = sc.notes.filter(n => n.rest), by = {};
        rests.forEach(n => { by[n.type] = (by[n.type] || 0) + 1; });
        const rh = sc.notes.filter(n => !n.rest && n.hand === 'r').sort((a, b) => a.m - b.m || a.b - b.b);
        let overlapping = 0;
        for (let k = 0; k < rh.length - 1; k++) { const a = rh[k], b = rh[k + 1]; if (a.m === b.m && a.b + a.dur > b.b + 1e-9) overlapping++; }
        return { rests: rests.length, byType: by, notes: sc.notes.filter(n => !n.rest).length, rh: rh.length, overlapping: overlapping };
      }, g1.id) : null;
      ok('the printed score\'s 32 64th rests are left exactly as written (nothing is tidied unless the graph says transcription)', !!gs && gs.byType['64th'] === 32 && gs.rests === 32, JSON.stringify(gs));
      ok('every note is still there (72 of the 72 the source has: 64 right hand, 8 left hand) and no right-hand note passes the next one', !!gs && gs.notes === 72 && gs.rh === 64 && gs.overlapping === 0, JSON.stringify(gs));
      ok('no page or console error', gp.__rec.pageErrors.length === 0 && gp.__rec.consoleErrors.length === 0, JSON.stringify(gp.__rec.pageErrors.concat(gp.__rec.consoleErrors)));
      await gp.close();
    }

    console.log('\n── transcription rests at the source: the review screen\'s rewrite of a recording (docs/GOALS/G09 section 12) ──');
    /* A recording's notes keep the lengths they were heard with, so the score the review screen draws had a 32nd or 64th rest after most notes of a fast run (the user's 90-bar
       YouTube piece: 90 + 64). The app asks audio-score.js to close those gaps at its four recording call sites (scoregraph/gaps.js). Here the heard notes of a seeded 6-bar piece
       (120 bpm, a run on the 32nd grid, each note held 55-85% of its gap) are injected into the review screen and "Rewrite the rhythm" (the real button, the real toMusicXml call)
       writes the score: the Score the screen holds, the graph the page draws and the rest glyphs in the DOM have no 32nd or 64th rest, every note is where it was, none is shorter,
       and the player's strikes are the same notes. The same heard notes written the way the library does by default (closeGaps off) have them: the control. */
    {
      const rp = await openPage(browser);
      await rp.evaluate(() => {
        const P = window.PPP, A = P.app;
        let s = 3; const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
        const pat = [72, 74, 76, 77, 79, 77, 76, 74, 72, 71, 72, 74, 76, 74, 72, 71], notes = [];
        for (let b = 0; b < 6; b++) {
          const t0 = b * 2; notes.push({ on: t0, off: t0 + 0.93, midi: 48, vel: 70 }); notes.push({ on: t0 + 1, off: t0 + 1.93, midi: 43, vel: 70 });
          let t = 0, i = 0;
          while (t < 2 - 1e-9) {
            const r = rnd(), ioi32 = r < 0.55 ? 4 : r < 0.7 ? 3 : r < 0.8 ? 5 : r < 0.9 ? 2 : 8, ioi = ioi32 * 0.0625;
            if (t + ioi > 2 + 1e-9) break;
            notes.push({ on: t0 + t + (rnd() - 0.5) * 0.01, off: t0 + t + ioi * (0.55 + 0.3 * rnd()), midi: pat[i % 16], vel: 80 }); t += ioi; i++;
          }
        }
        const A0 = window.PPPAudioScore;
        const mk = o => A0.toMusicXml({ notes: notes, pedals: [] }, Object.assign({ title: 'run', lock: { beats: 4, beatType: 4, bpm: 120, firstDownbeat: 0 } }, o));
        const control = P.parseMusicXML(mk({ closeGaps: false }).xml, 'run');
        window.__gapsControl = control.notes.filter(n => n.rest).reduce((m, n) => { m[n.type] = (m[n.type] || 0) + 1; return m; }, {});
        window.__gapsControlNotes = control.notes.filter(n => !n.rest).map(n => n.m + '|' + (Math.round(n.b * 1e4) / 1e4) + '|' + n.midi + '|' + n.dur);
        window.__gapsControlStrikes = P.PianoScore.of(control).strikes.length;
        A._recording = { url: '', barStarts: [0] };
        A._heard = { notes: notes, pedals: [], duration: notes[notes.length - 1].off };
        A.adoptScore(P.parseMusicXML(mk({ closeGaps: false }).xml, 'run'));
        A.setState({ screen: 'review', lockMetre: '4/4', lockBpm: 120, lockDownbeat: 0, importSource: { kind: 'audio', name: 'run.mp3', status: 'transcribed', tempo: 120, amt: 'onsets-and-frames' },
          importReport: { confidence: 0.9, level: 'good', issues: [], suspectMeasures: [], summary: null, advice: null, measures: 6, notes: notes.length, staves: 2, tempo: 120 } });
      });
      await sleep(500);
      await rp.click('[data-lock-rewrite]');
      await rp.waitForFunction(() => /Rewrote the rhythm/.test((window.PPP.app.state.toast || '') + document.body.innerText), { timeout: 30000 });
      await sleep(1500);
      const rr = await rp.evaluate(() => {
        const P = window.PPP, S = P.app.state, sc = S.score;
        const rests = sc.notes.filter(n => n.rest).reduce((m, n) => { m[n.type] = (m[n.type] || 0) + 1; return m; }, {});
        const rs = window.PPPEngrave.app.resolveSync(sc), g = rs.graph;
        const byId = new Map(g.parts[0].events.map(e => [e.id, e]));
        const dom = {}; document.querySelectorAll('g.ppp-note[data-rest="1"]').forEach(el => { const e = byId.get(el.getAttribute('data-ev')); const k = e ? e.display.type : '?'; dom[k] = (dom[k] || 0) + 1; });
        const notes = sc.notes.filter(n => !n.rest).map(n => n.m + '|' + (Math.round(n.b * 1e4) / 1e4) + '|' + n.midi + '|' + n.dur);
        return { rests: rests, via: rs.via, dom: dom, notes: notes, strikes: P.PianoScore.of(sc).strikes.length, domHeads: document.querySelectorAll('path.vf-notehead:not(.vf-rest)').length };
      });
      const control = await rp.evaluate(() => ({ rests: window.__gapsControl, notes: window.__gapsControlNotes, strikes: window.__gapsControlStrikes }));
      const small = o => (o['32nd'] || 0) + (o['64th'] || 0);
      ok('control: the heard notes written without the pass have 32nd and 64th rests (the "before")', small(control.rests) >= 8, JSON.stringify(control.rests));
      ok('"Rewrite the rhythm": the Score has no 32nd or 64th rest', small(rr.rests) === 0 && Object.keys(rr.rests).length > 0, JSON.stringify(rr.rests));
      ok('the page draws the kept graph (live) and it has none either; no rest glyph of a 32nd or 64th in the DOM', rr.via === 'live' && small(rr.dom) === 0, JSON.stringify({ via: rr.via, dom: rr.dom }));
      /* the page asks for exact bars too (docs/GOALS/G09 section 12, "Recording notation: tuplets and the grid"): an onset on the 32nd lattice goes to the 16th grid, 1/32 of a whole note (0.125 quarter) at most, so a note
         is where it was to within that, with its pitch, and none is lost */
      const abs = x => { const f = x.split('|'); return +f[0] * 4 + +f[1]; };
      const byPitch = list => { const m = new Map(); list.forEach(x => { const k = x.split('|')[2]; if (!m.has(k)) m.set(k, []); m.get(k).push(abs(x)); }); m.forEach(v => v.sort((a, b) => a - b)); return m; };
      const p0 = byPitch(control.notes), p1 = byPitch(rr.notes);
      let moved = 0, worst = 0, lost = rr.notes.length === control.notes.length ? 0 : 1;
      p0.forEach((v, k) => { const w = p1.get(k) || []; if (w.length !== v.length) lost++; v.forEach((t, i) => { if (w[i] !== undefined) { const d = Math.abs(w[i] - t); if (d > 1e-6) moved++; worst = Math.max(worst, d); } }); });
      ok('every note is where it was with its pitch (' + control.notes.length + ' notes) to within 1/32 of a whole note (the onsets are on the grid now), none lost', lost === 0 && worst <= 0.125 + 1e-6, JSON.stringify({ a: rr.notes.length, b: control.notes.length, moved: moved, worst: worst }));
      ok('the player has the same strikes as for the unclosed score (what is drawn is what is played)', rr.strikes === control.strikes && rr.strikes > 0, JSON.stringify({ strikes: rr.strikes, control: control.strikes }));
      ok('no page or console error', rp.__rec.pageErrors.length === 0 && rp.__rec.consoleErrors.length === 0, JSON.stringify(rp.__rec.pageErrors.concat(rp.__rec.consoleErrors)));
      await rp.close();
    }

    console.log('\n── consecutive rests: one silence is one rest, in the review screen, the saved transcription and its one-note copy (docs/GOALS/G09 section 12) ──');
    /* The teacher's score of a YouTube transcription had two small dotted rests in a row before a quarter note, and a dotted 16th rest inside a beamed 16th group: audio-score.js writes a
       silence one piece at a time. scoregraph/gaps.js mergeRests (run with the gap closing at the four recording call sites, and last in the one-note pipeline of a transcription)
       writes each silence once, in the standard tiling on the beat grid. Here the heard notes of a seeded 10-bar piece (120 bpm, a run on the 32nd grid, each note held 25-85% of its
       gap, so silences come in several pieces) go through the real screens: "Rewrite the rhythm", Accept (the saved transcription), and the Song Arranger's one-note copy. In each:
       no run of rests is left that is not in the standard tiling (gaps.restRuns), no dotted 16th (or 32nd, 64th) rest in the graph or the DOM, the same notes; the control (the same
       heard notes written without the pass) has the runs. */
    {
      const cp = await openPage(browser);
      await cp.evaluate(() => {
        const P = window.PPP, A = P.app;
        let s = 7; const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
        const pat = [72, 74, 76, 77, 79, 77, 76, 74, 72, 71, 72, 74, 76, 74, 72, 71], notes = [];
        for (let b = 0; b < 10; b++) {
          const t0 = b * 2; notes.push({ on: t0, off: t0 + 0.93, midi: 48, vel: 70 }); notes.push({ on: t0 + 1, off: t0 + 1.93, midi: 43, vel: 70 });
          let t = 0, i = 0;
          while (t < 2 - 1e-9) {
            const r = rnd(), ioi32 = r < 0.45 ? 4 : r < 0.6 ? 3 : r < 0.7 ? 5 : r < 0.8 ? 2 : r < 0.9 ? 8 : 12, ioi = ioi32 * 0.0625;
            if (t + ioi > 2 + 1e-9) break;
            notes.push({ on: t0 + t + (rnd() - 0.5) * 0.01, off: t0 + t + ioi * (0.25 + 0.6 * rnd()), midi: pat[i % 16], vel: 80 }); t += ioi; i++;
          }
        }
        const A0 = window.PPPAudioScore, lock = { beats: 4, beatType: 4, bpm: 120, firstDownbeat: 0 };
        const mk = o => A0.toMusicXml({ notes: notes, pedals: [], title: 'run' }, Object.assign({ title: 'run', lock: lock }, o));
        const gaps = window.PPPScoreGraphModules.gaps;
        const small = g => g.parts[0].events.filter(e => e.kind === 'rest' && ((e.display.dots && e.display.type === '16th') || /^(32nd|64th)$/.test(e.display.type))).length;
        const control = mk({ closeGaps: false });
        window.__ctl = { runs: gaps.restRuns(control.graph, { skipped: 0 }).length, small: small(control.graph), notes: control.graph.parts[0].events.filter(e => e.kind === 'note').length };
        /* the control with only the gaps closed (what the app wrote before this change): the runs are still there */
        const gapsOnly = gaps.closeSmallGaps(control.graph).graph;
        window.__ctl.runsGapsOnly = gaps.restRuns(gapsOnly, { skipped: 0 }).length;
        window.__ctl.smallGapsOnly = small(gapsOnly);
        A._recording = { url: '', barStarts: [0] };
        A._heard = { notes: notes, pedals: [], duration: notes[notes.length - 1].off };
        A.adoptScore(P.parseMusicXML(mk({ closeGaps: false }).xml, 'run'));
        A.setState({ screen: 'review', lockMetre: '4/4', lockBpm: 120, lockDownbeat: 0, importSource: { kind: 'audio', name: 'run.mp3', status: 'transcribed', tempo: 120, amt: 'onsets-and-frames' },
          importReport: { confidence: 0.9, level: 'good', issues: [], suspectMeasures: [], summary: null, advice: null, measures: 10, notes: notes.length, staves: 2, tempo: 120 } });
      });
      await sleep(500);
      const probe = () => cp.evaluate(() => {
        const P = window.PPP, S = P.app.state, sc = S.score, gaps = window.PPPScoreGraphModules.gaps;
        const rs = window.PPPEngrave.app.resolveSync(sc), g = rs.graph, byId = new Map(g.parts[0].events.map(e => [e.id, e]));
        const small = e => e && e.kind === 'rest' && ((e.display.dots && e.display.type === '16th') || /^(32nd|64th)$/.test(e.display.type));
        let domSmall = 0, domRests = 0;
        document.querySelectorAll('g.ppp-note[data-rest="1"]').forEach(el => { domRests++; if (small(byId.get(el.getAttribute('data-ev')))) domSmall++; });
        return { via: rs.via, runs: gaps.restRuns(g, { skipped: 0 }).length, small: g.parts[0].events.filter(small).length, domSmall: domSmall, domRests: domRests,
          notes: g.parts[0].events.filter(e => e.kind === 'note').length, scoreNotes: sc.notes.filter(n => !n.rest).length, scoreRests: sc.notes.filter(n => n.rest).length,
          errors: window.PPPScoreGraph.validate(g).issues.filter(i => /^E-/.test(i.code)).length, strikes: P.PianoScore.of(sc).strikes.length };
      });
      const ctl = await cp.evaluate(() => window.__ctl);
      ok('control: the heard notes written without the pass have runs of rests that are not in the standard tiling, and dotted 16th rests', ctl.runs >= 4 && ctl.small >= 4, JSON.stringify(ctl));
      ok('control: with only the gaps closed (what the app wrote before) the runs are still there', ctl.runsGapsOnly >= 3, JSON.stringify(ctl));
      await cp.click('[data-lock-rewrite]');
      await cp.waitForFunction(() => /Rewrote the rhythm/.test((window.PPP.app.state.toast || '') + document.body.innerText), { timeout: 30000 });
      await sleep(1500);
      const rr = await probe();
      ok('"Rewrite the rhythm": the page draws the kept graph (live); no run of rests is left that is not in the standard tiling', rr.via === 'live' && rr.runs === 0, JSON.stringify(rr));
      ok('no dotted 16th, 32nd or 64th rest in the graph or in the DOM (the glyphs drawn)', rr.small === 0 && rr.domSmall === 0 && rr.domRests > 0, JSON.stringify(rr));
      ok('the same notes (' + ctl.notes + ' note events in the graph), a valid graph, the player has strikes', rr.notes === ctl.notes && rr.errors === 0 && rr.strikes > 0, JSON.stringify({ rr: rr, ctl: ctl }));
      /* Accept: the saved transcription */
      await cp.evaluate(() => { const b = [...document.querySelectorAll('button')].find(x => /Accept and practise/.test(x.innerText)); if (b) b.click(); });
      await sleep(2500);
      const sid = await cp.evaluate(() => window.PPP.app.state.songId);
      const sv = await probe();
      ok('the saved transcription (after Accept): no run of rests left, no dotted 16th/32nd/64th rest in the graph or DOM, the same notes', !!sid && sv.runs === 0 && sv.small === 0 && sv.domSmall === 0 && sv.notes === ctl.notes, JSON.stringify(sv));
      /* the Song Arranger's one-note copy of that transcription */
      const cop = await overlayArrange(cp, sid, 'intermediate', 'balanced');
      ok('Song Arranger on the saved transcription: saved as a one-note-per-hand arrangement', cop.saved && cop.slot.importSource.arrangement.engine === 'ppp.g9-single' && !cop.slot.importSource.arrangement.singleFallback, cop.saved ? JSON.stringify(cop.slot.importSource.arrangement) : JSON.stringify(cop.status));
      if (cop.saved) {
        await cp.evaluate(() => window.__pppTest.nav('My Songs')); await sleep(600);
        await cp.evaluate(i => { const b = document.querySelector('[data-open-song="' + i + '"]'); if (b) b.click(); }, cop.id); await sleep(3000);
        await cp.evaluate(() => { const t = [...document.querySelectorAll('main [role=tab]')].find(x => /Start to finish/.test(x.innerText)); if (t) t.click(); }); await sleep(2500);
        const cc = await probe();
        ok('the copy: no run of rests left that is not in the standard tiling, no dotted 16th/32nd/64th rest in the graph or DOM', cc.runs === 0 && cc.small === 0 && cc.domSmall === 0 && cc.domRests > 0, JSON.stringify(cc));
        ok('the copy has its notes and a valid graph', cc.notes >= ctl.notes * 0.9 && cc.errors === 0, JSON.stringify({ cc: cc, ctl: ctl }));
      }
      ok('no page or console error', cp.__rec.pageErrors.length === 0 && cp.__rec.consoleErrors.length === 0, JSON.stringify(cp.__rec.pageErrors.concat(cp.__rec.consoleErrors)));
      await cp.close();
    }

    console.log('\n── left-hand run rests: a lone 16th rest inside a left-hand 16th run is deleted and the note before it lengthened (docs/GOALS/G09 section 12) ──');
    /* The teacher's copy of a YouTube transcription had 5 lone 16th rests inside the left hand's continuous 16th-note run (a broken-looking arpeggio). Their decision: "delete the rest and
       extend the previous note". scoregraph/gaps.js fillRunRests (a part of tidyRests, run with the gap closing at the recording call sites and last in the one-note pipeline of a
       transcription). Here the heard notes of a seeded 10-bar piece (a right-hand melody, a left-hand arpeggio of 16ths with about one note in eight not heard) go through the real screens:
       "Rewrite the rhythm", Accept (the saved transcription) and the Song Arranger's one-note copy. In each: no lone 16th rest of the LEFT hand between two of its notes (Score, graph, DOM),
       the same notes (onsets and pitches), the right hand's rests as they are, a valid graph; the control (written without the pass) has them. */
    {
      const lp = await openPage(browser);
      await lp.evaluate(() => {
        const P = window.PPP, A = P.app;
        let s = 3; const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
        const notes = [];
        for (let b = 0; b < 10; b++) {
          const t0 = b * 2;
          notes.push({ on: t0 + 0.25, off: t0 + 1.9, midi: 76 + (b % 3), vel: 80 });
          for (let k = 0; k < 16; k++) {
            if (rnd() < 0.12 && k > 0 && !(b === 9 && k === 15)) continue;
            notes.push({ on: t0 + k * 0.125, off: t0 + k * 0.125 + 0.118, midi: [48, 52, 55, 52][k % 4], vel: 60 });
          }
        }
        const A0 = window.PPPAudioScore, lock = { beats: 4, beatType: 4, bpm: 120, firstDownbeat: 0 };
        const mk = o => A0.toMusicXml({ notes: notes, pedals: [], title: 'lh-run' }, Object.assign({ title: 'lh-run', lock: lock }, o));
        const control = mk({ closeGaps: false });
        const lhIds = new Set(control.graph.parts[0].staves.filter(s => s.limb === 'LH').map(s => s.id));
        window.__lhCtl = { rests: control.graph.parts[0].events.filter(e => e.kind === 'rest' && lhIds.has(e.staff) && e.display.type === '16th' && !e.display.dots).length,
          /* the right hand's rests with the earlier passes (closing, merging) but not the fill: what the fill must leave alone */
          rhRests: (() => { const G = window.PPPScoreGraphModules.gaps, g2 = G.mergeRests(G.closeSmallGaps(control.graph).graph).graph; return g2.parts[0].events.filter(e => e.kind === 'rest' && !lhIds.has(e.staff)).length; })() };
        A._recording = { url: '', barStarts: [0] };
        A._heard = { notes: notes, pedals: [], duration: notes[notes.length - 1].off };
        A.adoptScore(P.parseMusicXML(mk({ closeGaps: false }).xml, 'lh-run'));
        A.setState({ screen: 'review', lockMetre: '4/4', lockBpm: 120, lockDownbeat: 0, importSource: { kind: 'audio', name: 'lh-run.mp3', status: 'transcribed', tempo: 120, amt: 'onsets-and-frames' },
          importReport: { confidence: 0.9, level: 'good', issues: [], suspectMeasures: [], summary: null, advice: null, measures: 10, notes: notes.length, staves: 2, tempo: 120 } });
      });
      await sleep(500);
      const probeLh = () => lp.evaluate(() => {
        const sc = window.PPP.app.state.score, EPS = 1e-6;
        const lh = sc.notes.filter(n => n.staff === 2 && !n.chord), lhNotes = lh.filter(n => !n.rest);
        const lone = lh.filter(r => r.rest && r.type === '16th' && !r.dots && Math.abs(r.dur - 0.25) < EPS
          && lhNotes.some(n => Math.abs((n.abs + n.dur) - r.abs) < EPS) && lhNotes.some(n => Math.abs(n.abs - (r.abs + r.dur)) < EPS));
        const rs = window.PPPEngrave.app.resolveSync(sc), g = rs.graph, part = g.parts[0];
        const lhIds = new Set(part.staves.filter(s => s.limb === 'LH').map(s => s.id));
        const gl = part.events.filter(e => e.kind === 'rest' && lhIds.has(e.staff) && e.display.type === '16th' && !e.display.dots).length;
        let domLone = 0;
        document.querySelectorAll('g.ppp-note[data-rest="1"]').forEach(el => { const o = (el.getAttribute('data-onset') || '').split('|'); if (o[2] === '2' && lone.some(l => String(l.m) === o[0] && Math.abs(l.b - Number(o[1])) < 1e-3)) domLone++; });
        const sig = sc.notes.filter(n => !n.rest).map(n => [n.m, n.b, n.p, n.staff].join('|')).sort();
        return { lone: lone.length, graphLh16thRests: gl, domLone: domLone, via: rs.via, notes: sig.length, sigHash: sig.join(',').length, sig: sig,
          rhRests: part.events.filter(e => e.kind === 'rest' && !lhIds.has(e.staff)).length,
          eighths: lhNotes.filter(n => n.type === 'eighth').length,
          errors: window.PPPScoreGraph.validate(g).issues.filter(i => /^E-/.test(i.code)).length };
      });
      const lctl = await lp.evaluate(() => window.__lhCtl);
      ok('control: the heard notes written without the pass have lone 16th rests in the left hand', lctl.rests >= 3, JSON.stringify(lctl));
      await lp.click('[data-lock-rewrite]');
      await lp.waitForFunction(() => /Rewrote the rhythm/.test((window.PPP.app.state.toast || '') + document.body.innerText), { timeout: 30000 });
      await sleep(1500);
      const lrr = await probeLh();
      ok('"Rewrite the rhythm": no lone 16th rest between left-hand notes in the Score, the graph or the DOM; the previous notes are eighths; a valid graph', lrr.lone === 0 && lrr.graphLh16thRests === 0 && lrr.domLone === 0 && lrr.eighths >= 3 && lrr.errors === 0, JSON.stringify(Object.assign({}, lrr, { sig: undefined })));
      ok('the right hand\'s rests are as the control wrote them', lrr.rhRests === lctl.rhRests, JSON.stringify({ lrr: lrr.rhRests, ctl: lctl.rhRests }));
      await lp.evaluate(() => { const b = [...document.querySelectorAll('button')].find(x => /Accept and practise/.test(x.innerText)); if (b) b.click(); });
      await sleep(2500);
      const lsid = await lp.evaluate(() => window.PPP.app.state.songId);
      const lsv = await probeLh();
      ok('the saved transcription: no lone 16th rest in the left hand (Score, graph, DOM), the same notes (onsets and pitches) as the rewrite', !!lsid && lsv.lone === 0 && lsv.graphLh16thRests === 0 && lsv.domLone === 0 && lsv.errors === 0 && JSON.stringify(lsv.sig) === JSON.stringify(lrr.sig), JSON.stringify(Object.assign({}, lsv, { sig: undefined })));
      const lcop = await overlayArrange(lp, lsid, 'intermediate', 'balanced');
      ok('Song Arranger on the saved transcription: saved as a one-note-per-hand arrangement', lcop.saved && lcop.slot.importSource.arrangement.engine === 'ppp.g9-single' && !lcop.slot.importSource.arrangement.singleFallback, lcop.saved ? JSON.stringify(lcop.slot.importSource.arrangement) : JSON.stringify(lcop.status));
      if (lcop.saved) {
        await lp.evaluate(() => window.__pppTest.nav('My Songs')); await sleep(600);
        await lp.evaluate(i => { const b = document.querySelector('[data-open-song="' + i + '"]'); if (b) b.click(); }, lcop.id); await sleep(3000);
        await lp.evaluate(() => { const t = [...document.querySelectorAll('main [role=tab]')].find(x => /Start to finish/.test(x.innerText)); if (t) t.click(); }); await sleep(2500);
        const lcc = await probeLh();
        ok('the copy: no lone 16th rest in the left hand (Score, graph, DOM), a valid graph, its notes', lcc.lone === 0 && lcc.graphLh16thRests === 0 && lcc.domLone === 0 && lcc.errors === 0 && lcc.notes >= lrr.notes * 0.9, JSON.stringify(Object.assign({}, lcc, { sig: undefined })));
      }
      ok('no page or console error', lp.__rec.pageErrors.length === 0 && lp.__rec.consoleErrors.length === 0, JSON.stringify(lp.__rec.pageErrors.concat(lp.__rec.consoleErrors)));
      await lp.close();
    }

    console.log('\n── recording notation: tuplets and the grid, in the review screen, the saved transcription and its one-note copy (docs/GOALS/G09 section 12) ──');
    /* A recording with a triplet feel was drawn with NO tuplet (a third of a beat is an eighth, two thirds a quarter, so a bar showed up to six beats) and with onsets on a 32nd lattice that no
       plain value expresses (the teacher's 90-bar piece: 59 of 90 right-hand bars did not add up as drawn, 28 were right). The app asks audio-score.js for exact bars at its four recording call
       sites (opts.exactBars): one tuplet over each triplet beat, rests inside it, every onset and release on the beat's grid. Here the heard notes of a seeded 10-bar piece (120 bpm, 4/4: triplet
       beats of three eighths, a rest and two eighths, a quarter and an eighth, straight 16ths in both hands, every onset a few milliseconds off, a few of them on the 32nd lattice) go through the
       real screens: "Rewrite the rhythm", Accept (the saved transcription) and the Song Arranger's one-note copy. In each: every voice of every bar adds up as the Score draws it (the sum of the
       drawn values with the tuplet ratio is the bar, each event starts where the ones before end and lasts what it is drawn as), the graph the page draws is valid with no W-DISPLAY-DURATION,
       tuplet brackets are in the DOM, and the player has a strike for every heard note; the control (written without exact bars) has bars that do not add up. */
    {
      const tp = await openPage(browser);
      await tp.evaluate(() => {
        const P = window.PPP, A = P.app;
        let s = 11; const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
        const notes = [], B = 0.5, T = B / 3;                           /* 120 bpm: a beat is 0.5 s */
        const add = (t, len, midi, vel) => notes.push({ on: Math.max(0, t + (rnd() - 0.5) * 0.02), off: t + len, midi: midi, vel: vel || 80 });
        for (let b = 0; b < 10; b++) {
          const t0 = b * 4 * B;
          for (let beat = 0; beat < 4; beat++) {
            const t = t0 + beat * B, pick = (b + beat) % 4;
            if (pick === 0) { for (let i = 0; i < 3; i++) add(t + i * T, T * 0.9, 72 + 2 * i); }                                   /* three eighths of a triplet beat */
            else if (pick === 1) { add(t + T, T * 0.9, 79); add(t + 2 * T, T * 0.9, 77); }                                         /* a rest and two eighths */
            else if (pick === 2) { add(t, 2 * T * 0.95, 76); add(t + 2 * T, T * 0.9, 74); }                                       /* a quarter and an eighth */
            else { for (let i = 0; i < 4; i++) add(t + i * B / 4, B / 4 * 0.85, 71 + i); }                                      /* straight 16ths */
            /* left hand: a bass note on each beat, the thirds in a triplet beat, 16ths in the others */
            if (pick === 3) { for (let i = 0; i < 4; i++) add(t + i * B / 4, B / 4 * 0.9, [43, 50, 55, 50][i], 60); }
            else { for (let i = 0; i < 3; i++) add(t + i * T, T * 0.9, [43, 50, 55][i], 60); }
          }
        }
        const A0 = window.PPPAudioScore, lock = { beats: 4, beatType: 4, bpm: 120, firstDownbeat: 0 };
        const mk = o => A0.toMusicXml({ notes: notes, pedals: [], title: 'triplets' }, Object.assign({ title: 'triplets', lock: lock }, o));
        /* the control: the library's own output (what the app wrote before exact bars) */
        const control = mk({ closeGaps: true, exactBars: false });
        window.__tupControl = { warnings: window.PPPScoreGraph.validate(control.graph).issues.filter(i => i.code === 'W-DISPLAY-DURATION').length,
          tuplets: control.graph.parts[0].spanners.filter(x => x.type === 'tuplet').length };
        window.__tupHeard = notes.length;
        A._recording = { url: '', barStarts: [0] };
        A._heard = { notes: notes, pedals: [], duration: notes[notes.length - 1].off };
        A.adoptScore(P.parseMusicXML(control.xml, 'triplets'));
        A.setState({ screen: 'review', lockMetre: '4/4', lockBpm: 120, lockDownbeat: 0, importSource: { kind: 'audio', name: 'triplets.mp3', status: 'transcribed', tempo: 120, amt: 'onsets-and-frames' },
          importReport: { confidence: 0.9, level: 'good', issues: [], suspectMeasures: [], summary: null, advice: null, measures: 10, notes: notes.length, staves: 2, tempo: 120 } });
      });
      await sleep(500);
      /* the Score's own bars: per staff, voice and measure, the drawn values (with the tuplet ratio) add up to the measure, with no hole or overlap, each event lasting what it is drawn as */
      const probeBars = () => tp.evaluate(() => {
        const sc = window.PPP.app.state.score, TV = { whole: 4, half: 2, quarter: 1, eighth: 0.5, '16th': 0.25, '32nd': 0.125, '64th': 0.0625 }, near = (a, b) => Math.abs(a - b) < 1e-6;
        const lenQ = new Map(sc.measures.map(m => [m.number, m.lenQ])), by = new Map();
        sc.notes.forEach(n => { const k = n.staff + '|' + n.voice + '|' + n.m; if (!by.has(k)) by.set(k, new Map()); const ev = by.get(k), kb = n.b.toFixed(6); if (!ev.has(kb)) ev.set(kb, n); });
        let total = 0, good = 0; const bad = [];
        by.forEach((ev, k) => {
          const list = Array.from(ev.values()).sort((a, b) => a.b - b.b); let cur = 0, ok1 = true;
          list.forEach(n => { const base = TV[n.type] * (2 - Math.pow(2, -(n.dots || 0))), drawn = n.tm ? base * n.tm.n / n.tm.a : base; if (!near(n.b, cur) || !near(n.dur, drawn)) ok1 = false; cur = n.b + n.dur; });
          if (!near(cur, lenQ.get(+k.split('|')[2]))) ok1 = false;
          total++; if (ok1) good++; else bad.push(k);
        });
        const rs = window.PPPEngrave.app.resolveSync(sc), g = rs.graph, issues = window.PPPScoreGraph.validate(g).issues;
        return { voiceBars: total, good: good, bad: bad.slice(0, 6), via: rs.via, domBrackets: document.querySelectorAll('g.ppp-tuplet').length, tupletStarts: sc.notes.filter(n => n.tupletStart).length,
          warnDisplay: issues.filter(i => i.code === 'W-DISPLAY-DURATION').length, errors: issues.filter(i => /^E-/.test(i.code)).length,
          strikes: window.PPP.PianoScore.of(sc).strikes.length, notes: sc.notes.filter(n => !n.rest).length };
      });
      const c0 = await probeBars();
      const tctl = await tp.evaluate(() => ({ c: window.__tupControl, heard: window.__tupHeard }));
      ok('control: the heard notes written without exact bars have bars that do not add up and no bracket per beat', c0.good < c0.voiceBars && tctl.c.warnings >= 10, JSON.stringify({ c0: c0, ctl: tctl.c }));
      await tp.click('[data-lock-rewrite]');
      await tp.waitForFunction(() => /Rewrote the rhythm/.test((window.PPP.app.state.toast || '') + document.body.innerText), { timeout: 30000 });
      await sleep(1500);
      const t1 = await probeBars();
      ok('"Rewrite the rhythm": every voice of every bar adds up as the Score draws it (' + t1.voiceBars + ' voice-bars), tuplet brackets are in the Score and the DOM, a valid graph with no W-DISPLAY-DURATION',
        t1.voiceBars >= 20 && t1.good === t1.voiceBars && t1.tupletStarts >= 10 && t1.domBrackets >= 10 && t1.warnDisplay === 0 && t1.errors === 0 && t1.via === 'live', JSON.stringify(t1));
      ok('the player has a strike for every heard note (what is drawn is what is played)', t1.strikes >= tctl.heard * 0.9 && t1.strikes <= tctl.heard, JSON.stringify({ strikes: t1.strikes, heard: tctl.heard }));
      await tp.evaluate(() => { const b = [...document.querySelectorAll('button')].find(x => /Accept and practise/.test(x.innerText)); if (b) b.click(); });
      await sleep(2500);
      const tsid = await tp.evaluate(() => window.PPP.app.state.songId);
      await tp.evaluate(() => window.__pppTest.nav('My Songs')); await sleep(600);
      await tp.evaluate(i => { const b = document.querySelector('[data-open-song="' + i + '"]'); if (b) b.click(); }, tsid); await sleep(3000);
      await tp.evaluate(() => { const t = [...document.querySelectorAll('main [role=tab]')].find(x => /Start to finish/.test(x.innerText)); if (t) t.click(); }); await sleep(2500);
      const t2 = await probeBars();
      ok('the saved transcription: every voice-bar adds up, brackets drawn, valid', !!tsid && t2.good === t2.voiceBars && t2.domBrackets >= 10 && t2.warnDisplay === 0 && t2.errors === 0, JSON.stringify(t2));
      const tcop = await overlayArrange(tp, tsid, 'intermediate', 'balanced');
      ok('Song Arranger on the saved transcription: saved as a one-note-per-hand arrangement', tcop.saved && tcop.slot.importSource.arrangement.engine === 'ppp.g9-single' && !tcop.slot.importSource.arrangement.singleFallback, tcop.saved ? JSON.stringify(tcop.slot.importSource.arrangement) : JSON.stringify(tcop.status));
      if (tcop.saved) {
        await tp.evaluate(() => window.__pppTest.nav('My Songs')); await sleep(600);
        await tp.evaluate(i => { const b = document.querySelector('[data-open-song="' + i + '"]'); if (b) b.click(); }, tcop.id); await sleep(3000);
        await tp.evaluate(() => { const t = [...document.querySelectorAll('main [role=tab]')].find(x => /Start to finish/.test(x.innerText)); if (t) t.click(); }); await sleep(2500);
        const t3 = await probeBars();
        ok('the one-note copy: every voice-bar adds up as drawn (the copy keeps the brackets), brackets in the DOM, valid, no W-DISPLAY-DURATION', t3.good === t3.voiceBars && t3.tupletStarts >= 5 && t3.domBrackets >= 5 && t3.warnDisplay === 0 && t3.errors === 0, JSON.stringify(t3));
      }
      ok('no page or console error', tp.__rec.pageErrors.length === 0 && tp.__rec.consoleErrors.length === 0, JSON.stringify(tp.__rec.pageErrors.concat(tp.__rec.consoleErrors)));
      await tp.close();
    }

    console.log('\n── refusals ──');
    /* G9e refusals: the Song Arranger does NOT save the standard arrangement behind the person's back. A piece the option still cannot make (czerny849/009 has no plan
       even relaxed; or scripts that did not load) leaves the window open with a notice that stays, and two choices; the standard copy is saved only on the click */
    const fp = await openPage(browser);
    const fid = await addSong(fp, CZERNY_849_009);
    const keysBefore = await songKeys(fp);
    const fr = await overlayArrange(fp, fid, 'intermediate', 'balanced');
    const refusal = () => fp.evaluate(() => {
      const b = document.querySelector('[data-single-refusal]');
      if (!b) return null;
      const r = b.getBoundingClientRect(), save = b.querySelector('[data-single-refusal-save]'), cancel = b.querySelector('[data-single-refusal-cancel]');
      return { text: b.innerText, role: b.getAttribute('role'), visible: r.width > 0 && r.height > 0, save: save && save.innerText.trim(), cancel: cancel && cancel.innerText.trim(), saveVisible: !!save && save.getBoundingClientRect().height > 0 };
    });
    const box1 = await refusal();
    ok('Song Arranger, a piece that stays refused (czerny849/009): nothing is saved, the window stays open, with the notice and the two choices',
      !fr.saved && fr.open && !!box1 && box1.visible && box1.role === 'alert' && box1.saveVisible && box1.save === 'Save the standard arrangement' && box1.cancel === 'Dismiss' && (await fp.evaluate(() => [...document.querySelectorAll('[data-song-arranger] button')].filter(b => b.innerText.trim() === 'Cancel').length)) === 1 && /could not be made in one-note-per-hand mode, so nothing was saved/.test(box1.text) && (await songKeys(fp)).length === keysBefore.length,
      JSON.stringify({ saved: fr.saved, open: fr.open, box: box1, keys: (await songKeys(fp)).length - keysBefore.length }));
    await sleep(4500); /* the toast lasts 2.8 s */
    ok('the notice does not go away by itself (there 4.5 s later, after every toast)', !!(await refusal()));
    await fp.select('[data-song-arrange-level]', 'beginner'); await sleep(250);
    ok('changing the level clears it (the request it was about is gone)', (await refusal()) === null);
    await fp.click('[data-create-song-arrangement]');
    await fp.waitForSelector('[data-single-refusal]', { timeout: 90000 });
    await fp.click('[data-song-arranger] [data-single-note-option]'); await sleep(250);
    ok('turning the chip off clears it too (the notice was about that mode)', (await refusal()) === null && (await fp.evaluate(() => window.PPP.arranger)) === 'legacy');
    await fp.click('[data-song-arranger] [data-single-note-option]'); await sleep(250);
    await fp.click('[data-create-song-arrangement]');
    await fp.waitForSelector('[data-single-refusal]', { timeout: 90000 });
    await fp.click('[data-single-refusal-cancel]'); await sleep(250);
    ok('Cancel dismisses the notice, keeps the window open and saves nothing', (await refusal()) === null && (await fp.evaluate(() => !!document.querySelector('[data-song-arranger]'))) && (await songKeys(fp)).length === keysBefore.length);
    await fp.click('[data-create-song-arrangement]');
    await fp.waitForSelector('[data-single-refusal]', { timeout: 90000 });
    await fp.click('[data-single-refusal-save]');
    await fp.waitForFunction(() => !document.querySelector('[data-song-arranger]'), { timeout: 60000 });
    const sv = await fp.evaluate(() => { const t = window.PPP.app.state.toast || ''; return { toast: t }; });
    const afterKeys = await songKeys(fp);
    const newKey = afterKeys.filter(k => keysBefore.indexOf(k) < 0)[0];
    const svSlot = newKey ? JSON.parse(await fp.evaluate(k => localStorage.getItem(k), newKey)) : null;
    const svCard = newKey ? await fp.evaluate(i => (window.PPP.app.libraryRead().songs.find(x => x.id === i) || {}).title, newKey.replace('ppp.song.v1.', '')) : null;
    ok('"Save the standard arrangement" saves the standard copy, marked (singleFallback), never labelled one-note-per-hand, and says so',
      afterKeys.length === keysBefore.length + 1 && !!svSlot && svSlot.importSource.arrangement.singleFallback === 'UNREACHABLE' && svSlot.importSource.arrangement.engine !== 'ppp.g9-single' && svSlot.importSource.provider !== 'PPP one-note-per-hand arranger' && !/one-note-per-hand arrangement$/.test(svCard) && /so the standard arrangement was saved/.test(sv.toast),
      JSON.stringify({ keys: afterKeys.length - keysBefore.length, arr: svSlot && svSlot.importSource.arrangement, card: svCard, toast: sv.toast }));
    /* the chip off gives the same standard arrangement at once (the person asked for it), with no notice */
    const svNotes = newKey ? await fp.evaluate(i => JSON.stringify(window.PPP.app.scoreForArrangement(i).notes.map(n => [n.hand, n.m, n.b, n.midi, n.dur, n.rest ? 1 : 0])), newKey.replace('ppp.song.v1.', '')) : '';
    const fc = await overlayArrange(fp, fid, 'beginner', 'balanced', 'chip');
    await fp.evaluate(() => { window.PPP.arranger = 'single'; });
    ok('the same notes as the chip-off request makes (one standard path, not another engine); the chip off saves at once, with no notice', fc.saved && fc.mode === 'legacy' && !(fc.slot.importSource.arrangement || {}).singleFallback && fc.notesHash === sha(svNotes), JSON.stringify({ chipSaved: fc.saved, same: fc.saved && fc.notesHash === sha(svNotes) }));
    ok('no page or console error', fp.__rec.pageErrors.length === 0 && fp.__rec.consoleErrors.length === 0, JSON.stringify(fp.__rec.pageErrors.concat(fp.__rec.consoleErrors)));
    await fp.close();

    /* scripts that cannot be loaded (also "crashes": same path): the same persistent notice, and when the network is back the next Create works */
    {
      const bp0 = await openPage(browser, { block: /\/candidates\/index\.js/ });
      const bid = await addSong(bp0, HYMN('christ-arose'));
      const k0 = await songKeys(bp0);
      const b0 = await overlayArrange(bp0, bid, 'intermediate', 'balanced');
      const bx = await bp0.evaluate(() => { const b = document.querySelector('[data-single-refusal]'); return b && b.innerText; });
      ok('Song Arranger, the option\'s scripts cannot be loaded: nothing saved, the notice and the choice in the window', !b0.saved && b0.open && !!bx && /nothing was saved/.test(bx) && (await songKeys(bp0)).length === k0.length, JSON.stringify({ saved: b0.saved, open: b0.open, box: bx }));
      bp0.__rec.blockOn = false; /* the network is back */
      await bp0.click('[data-create-song-arrangement]');
      await bp0.waitForFunction(() => !document.querySelector('[data-song-arranger]'), { timeout: 90000 });
      const k1 = await songKeys(bp0);
      const fresh1 = k1.filter(x => k0.indexOf(x) < 0)[0];
      const slot1 = fresh1 ? JSON.parse(await bp0.evaluate(k => localStorage.getItem(k), fresh1)) : null;
      ok('the failure was not kept: the next Create gives one note per hand, with no reload', !!slot1 && slot1.importSource.arrangement.engine === 'ppp.g9-single' && !slot1.importSource.arrangement.singleFallback, JSON.stringify(slot1 && slot1.importSource.arrangement));
      await bp0.close();
    }

    /* the review screen's refused piece: czerny849/009 was refused there too until the stray-note rescue, which now makes it (its heard-note graph has two low notes, 70 and 69, among
       98 to 101 in measure 11); a hymn with no plan at any level is what stays unreachable on this path */
    const HYMN_REFUSED = HYMN('beneath-the-cross');
    /* the review screen keeps its fallback: the standard arrangement is shown (a person is looking at it), with a notice that stays under the controls */
    const hr = await openPage(browser);
    await loadReview(hr, HYMN_REFUSED, 'beneath the cross');
    const same = [];
    const fbk = {};
    for (const st of ['balanced', 'jazz']) {
      const f = await reviewApply(hr, 'advanced', st);
      fbk[st] = f;
      await loadReview(hr, HYMN_REFUSED, 'beneath the cross');
    }
    await hr.click('[data-arrangement] [data-single-note-option]'); await sleep(250);
    for (const st of ['balanced', 'jazz']) {
      const l = await reviewApply(hr, 'advanced', st);
      await loadReview(hr, HYMN_REFUSED, 'beneath the cross');
      same.push(JSON.stringify(JSON.parse(fbk[st].packed).score.notes) === JSON.stringify(JSON.parse(l.packed).score.notes));
    }
    ok('review screen, beneath-the-cross, balanced and jazz: the refusal gives the same notes the chip off gives (balanced by the rhythm rewriter, jazz by the arranger, as with the chip off), marked singleFallback, with the notice',
      !!fbk.balanced.arrangement.singleFallback && !!fbk.jazz.arrangement.singleFallback && same.every(Boolean) && fbk.balanced.arrangement.engine !== 'ppp.g9-single' && /standard arrangement is shown/.test(fbk.balanced.status), JSON.stringify({ same: same, b: fbk.balanced.arrangement, j: fbk.jazz.arrangement }));
    await hr.close();

    const fr2 = await openPage(browser);
    await loadReview(fr2, HYMN_REFUSED, 'beneath the cross');
    await sleep(600);
    const fb = await reviewApply(fr2, 'advanced', 'balanced');
    ok('review screen, a piece that stays refused: the standard arrangement is shown, marked so in its source (singleFallback), not labelled one-note-per-hand',
      !!fb.arrangement.singleFallback && fb.arrangement.engine !== 'ppp.g9-single' && fb.notes > 30, JSON.stringify(fb.arrangement));
    ok('and the notice stays on the screen, under the controls', fb.status === 'This piece could not be made in one-note-per-hand mode, so the standard arrangement is shown.' &&
      (await fr2.evaluate(() => document.querySelector('[data-arrangement]').innerText.indexOf('so the standard arrangement is shown') > -1)), fb.status);
    await sleep(4000);
    ok('and is still there after the message has gone', await fr2.evaluate(() => document.querySelector('[data-arrangement]').innerText.indexOf('so the standard arrangement is shown') > -1));
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

    /* one of the OTHER scripts fails (not candidates/index.js, whose global is what the old check looked for): the session must not be poisoned, and what loaded
       before the failure is not fetched again when the network is back */
    const np = await openPage(browser, { block: /\/critics\/vertical-clash\.js/ });
    await loadReview(np, HYMN('christ-arose'), 'christ-arose');
    await np.waitForFunction(() => performance.getEntriesByType('resource').some(x => /candidates\/index\.js/.test(x.name)), { timeout: 30000 }).catch(() => {});
    await sleep(1500);
    const m1 = await reviewApply(np, 'intermediate', 'balanced');
    ok('one script of the fourteen refused (critics/vertical-clash.js) while the others load: the notice and the standard arrangement, no crash', m1.arrangement.singleFallback === 'SINGLE_NOT_LOADED' && /standard arrangement is shown/.test(m1.status) && np.__rec.pageErrors.length === 0, JSON.stringify(m1.arrangement));
    np.__rec.blockOn = false;
    await loadReview(np, HYMN('christ-arose'), 'christ-arose');
    const m2 = await reviewApply(np, 'intermediate', 'balanced');
    ok('when it is back the next Apply recovers, with no reload: one note per hand', m2.arrangement.engine === 'ppp.g9-single' && !m2.arrangement.singleFallback && m2.perAttack.filter(n => n > 1).length === 0, JSON.stringify(m2.arrangement));
    const nn = np.__rec.requests.filter(u => OPTION_FILES.test(u)).map(u => u.split('?')[0]);
    const cnt = f => nn.filter(n => n === f).length;
    ok('the scripts before the failed one were fetched once, the failed one and those after it again', ['/realize/handchords.js', '/realize/clefs.js', '/realize/ottava.js', '/critics/voice-leading.js', '/critics/register-density.js', '/critics/register-floor.js', '/critics/left-hand-jump.js', '/critics/low-register-cluster.js'].every(f => cnt(f) === 1) && cnt('/critics/vertical-clash.js') >= 2 && ['/critics/metrics.js', '/critics/index.js', '/candidates/index.js', '/repair/plan.js', '/repair/index.js'].every(f => cnt(f) >= 2), nn.map(u => u.replace(/^\//, '')).join(' '));
    await np.close();

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

    console.log('\n── an arrangement asked for while the download is still in flight ──');
    {
      /* every file of the option is held 3 s; opening the review screen starts the download, Apply is pressed at once */
      const ra = await openPage(browser, { until: 'domcontentloaded', delay: { re: OPTION_FILES, ms: 3000 } });
      await ra.waitForFunction(() => !!(window.PPP && window.PPP.app), { timeout: 30000 });
      await sleep(500);
      const early = ra.__rec.requests.filter(u => OPTION_FILES.test(u)).length;
      await loadReview(ra, HYMN('christ-arose'), 'christ-arose');
      const pre = await ra.evaluate(() => ({ loaded: !!(window.PPPCandidates && window.PPPRepair), mode: window.PPP.arranger }));
      const t0 = Date.now();
      const rr = await reviewApply(ra, 'intermediate', 'balanced');
      const names2 = ra.__rec.requests.filter(u => OPTION_FILES.test(u)).map(u => u.split('?')[0]);
      ok('nothing was requested before a screen that arranges opened', early === 0, String(early));
      ok('precondition: Apply was pressed while the files were still in flight', pre.loaded === false && pre.mode === 'single', JSON.stringify(pre));
      ok('Apply waited for the same download: one note per hand, and every script and data file was asked for exactly once', rr.arrangement.engine === 'ppp.g9-single' && !rr.arrangement.singleFallback && OPTION_SCRIPTS.every(f => names2.filter(n => n === f).length === 1) && names2.filter(n => /method-books\.json$/.test(n)).length === 1 && names2.filter(n => /g6a-v1\.json$/.test(n)).length === 1, JSON.stringify({ engine: rr.arrangement.engine, n: names2.length, ms: Date.now() - t0 }));
      await sleep(3500);
      const names3 = ra.__rec.requests.filter(u => OPTION_FILES.test(u));
      ok('and nothing asked for more afterwards (16 requests in all)', names3.length === 16, String(names3.length));
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
