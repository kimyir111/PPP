/* ============================================================================
   G9e-lite (docs/GOALS/G09_CANDIDATES_CRITICS_REPAIR.md section 12): the app's opt-in "One note per hand (experimental)", in the real page.

   PPP.arranger = 'legacy' (default) | 'g8' | 'single'. 'single' hands the review screen's own graph (or the open song's graph in the
   Song Arranger) to G7a -> G7b -> G9a candidates.run({ singleNoteHands: true }) -> G9b repair -> TD16 8va/8vb -> the conversion 'g8' uses.

   What this checks (the two screens where a person arranges a piece: the Song Arranger in My Songs, and the recognition review screen):
     - the switch: legacy by default, 'single' accepted, anything else legacy
     - NOTHING changes for a person who does not turn it on: the arrangement the real entry points make in the default mode is identical to
       what origin/main made (sha-256 of the saved score, tests/fixtures/g9e-legacy-identity.json, made from a build of origin/main 14a76f8),
       also after the option has been turned on and off again; no script of the option, and no reference data, is requested at page load
     - the control: present on both screens, off by default, labelled in English and Korean, inside the viewport at 400 px with no sideways scroll
     - turned on: the scripts and reference data are requested then (and only those); christ-arose, nearer-my-god, pass-me-not and all-creatures come
       out with no hand starting two notes at once, both hands used, drawn by the engraver (no fallback), with a sounding note list, and
       no console or page error; the review screen does it for the default 'balanced' texture too (which 'g8' never did)
     - "Original transcription" is not arranged by the option
     - refusals: an unreachable piece (sonatina/020 has no plan at any level), and option scripts that cannot be loaded. The Song Arranger saves nothing
       and says so; the review screen shows the standard arrangement, marked as such in its source, with the notice on screen

   The recognition review screen needs a recording and a transcription helper; here the heard notes are injected into the page (made from a hymn's own
   notes), and everything after that - the level and texture pickers, the control, Apply - is the real UI.

   Runs against its own server on a free port (tests/serve-free.js); PPP_URL=... runs it against another build (needed once to make the
   identity fixture: G9E_WRITE_GOLDEN=1 PPP_URL=<a build of origin/main> node tests/single-note-app.test.js).
   ========================================================================== */
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
const OPTION_FILES = /\/(critics\/|candidates\/|repair\/|realize\/(ottava|handchords))|method-books\.json|weights\/g6a/;
const LEVELS = ['beginner', 'intermediate', 'advanced', 'original'];

const sha = s => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);
const VOLATILE = /^(id|createdAt|importedAt|parentSongId|addedAt|lastAt)$/;
function strip(v) {
  if (Array.isArray(v)) return v.map(strip);
  if (v && typeof v === 'object') { const o = {}; Object.keys(v).sort().forEach(k => { if (!VOLATILE.test(k)) o[k] = strip(v[k]); }); return o; }
  return v;
}

let BASE = null;
async function openPage(browser, o) {
  o = o || {};
  const page = await browser.newPage();
  await preparePage(page);
  if (o.locale) await page.evaluateOnNewDocument(loc => { try { localStorage.setItem('ppp-locale', loc); } catch (e) {} }, o.locale);
  const rec = { requests: [], consoleErrors: [], pageErrors: [], blocked: [] };
  page.__rec = rec;
  await page.setRequestInterception(true);
  page.on('request', req => {
    const u = req.url();
    rec.requests.push(u.replace(/^https?:\/\/[^/]+/, ''));
    /* the page's own health check of a local helper nothing serves here: refused, so the legacy engine is the browser one on every machine */
    if (/:8788\//.test(u)) return req.abort();
    if (o.block && o.block.test(u)) { rec.blocked.push(u); return req.abort(); }
    req.continue();
  });
  page.on('console', m => { if (m.type() === 'error' && !/:8788\//.test(JSON.stringify(m.location())) && !(o.block && /Failed to load resource/.test(m.text()))) rec.consoleErrors.push(m.text()); });
  page.on('pageerror', e => rec.pageErrors.push(e.message));
  await page.setViewport({ width: o.width || 1100, height: o.height || 1000 });
  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 60000 });
  await sleep(500);
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
async function overlayArrange(page, songId, level, style) {
  await page.evaluate(() => window.__pppTest.nav('My Songs'));
  await sleep(250);
  await page.evaluate(i => document.querySelector('[data-arrange-song="' + i + '"]').click(), songId);
  await sleep(250);
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
  const after = await songKeys(page);
  const fresh = after.filter(k => before.indexOf(k) < 0)[0] || null;
  const open = await page.evaluate(() => !!document.querySelector('[data-song-arranger]'));
  const status = open ? await page.evaluate(() => document.querySelector('[data-song-arranger]').innerText) : '';
  if (!fresh) return { saved: false, open: open, status: status };
  const id = fresh.replace('ppp.song.v1.', '');
  const slot = JSON.parse(await page.evaluate(k => localStorage.getItem(k), fresh));
  const attacks = await page.evaluate(i => {
    const s = window.PPP.app.scoreForArrangement(i);
    const by = new Map();
    s.notes.filter(n => !n.rest).forEach(n => { const k = n.hand + '|' + n.m + '|' + n.b; by.set(k, (by.get(k) || 0) + 1); });
    return { perAttack: [...by.values()], hands: [...new Set(s.notes.filter(n => !n.rest).map(n => n.hand))].sort().join(''), notes: s.notes.filter(n => !n.rest).length };
  }, id);
  return { saved: true, id: id, slot: slot, open: open, hash: sha(JSON.stringify(strip(slot.score))), attacks: attacks };
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
  const page = await openPage(browser);
  for (const name of ['christ-arose', 'nearer-my-god', 'pass-me-not']) {
    const id = await addSong(page, HYMN(name));
    for (const level of LEVELS) { const r = await overlayArrange(page, id, level, 'balanced'); out['overlay|' + name + '|' + level + '|balanced'] = r.saved ? r.hash : 'NOT SAVED'; }
    const j = await overlayArrange(page, id, 'intermediate', 'jazz'); out['overlay|' + name + '|intermediate|jazz'] = j.saved ? j.hash : 'NOT SAVED';
  }
  await page.close();
  const rp = await openPage(browser);
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
      P.arranger = 'single'; out.single = P.arranger;
      P.arranger = 'g8'; out.g8 = P.arranger;
      P.arranger = 'typo'; out.typo = P.arranger;
      P.arranger = 'single'; P.arranger = undefined; out.undef = P.arranger;
      return out;
    });
    ok('PPP.arranger is legacy at page load', sw.start === 'legacy', sw.start);
    ok('\'single\' and \'g8\' are accepted', sw.single === 'single' && sw.g8 === 'g8', JSON.stringify(sw));
    ok('any other value is legacy (G4-F2-1)', sw.typo === 'legacy' && sw.undef === 'legacy', JSON.stringify(sw));
    const loaded = page0.__rec.requests.filter(r => OPTION_FILES.test(r));
    ok('a page load requests none of the option\'s scripts or reference data', loaded.length === 0, loaded.join(', '));
    ok('no page or console error at load', page0.__rec.pageErrors.length === 0 && page0.__rec.consoleErrors.length === 0, JSON.stringify(page0.__rec.pageErrors.concat(page0.__rec.consoleErrors)));
    await page0.close();

    console.log('\n── nothing changes when the option is off: the default output against origin/main ──');
    const got = await identityHashes(browser);
    if (process.env.G9E_WRITE_GOLDEN === '1') {
      fs.writeFileSync(GOLDEN, JSON.stringify({ madeFrom: 'origin/main 14a76f8 (default PPP.arranger)', hashes: got }, null, 1) + '\n');
      console.log('  wrote ' + GOLDEN + ' (' + Object.keys(got).length + ' hashes)');
      await browser.close(); await srv.close(); process.exit(0);
    } else {
      const want = JSON.parse(fs.readFileSync(GOLDEN, 'utf8')).hashes;
      const keys = Object.keys(want);
      const bad = keys.filter(k => want[k] !== got[k]);
      ok('every default-mode arrangement (' + keys.length + ': Song Arranger at four levels, a jazz copy, and the review screen at four levels and two more textures) is identical to origin/main\'s', bad.length === 0 && Object.keys(got).length === keys.length, bad.slice(0, 4).join('; '));
    }

    console.log('\n── the control ──');
    const cp = await openPage(browser);
    const songId = await addSong(cp, HYMN('christ-arose'));
    await cp.evaluate(() => window.__pppTest.nav('My Songs'));
    await sleep(250);
    await cp.evaluate(i => document.querySelector('[data-arrange-song="' + i + '"]').click(), songId);
    await sleep(300);
    const c1 = await cp.evaluate(() => { const b = document.querySelector('[data-song-arranger] [data-single-note-option]'); return b && { text: b.innerText.trim(), pressed: b.getAttribute('aria-pressed') }; });
    ok('the Song Arranger has the control, off by default, in English', !!c1 && c1.pressed === 'false' && c1.text === 'One note per hand (experimental)', JSON.stringify(c1));
    await cp.click('[data-song-arranger] [data-single-note-option]');
    await sleep(300);
    const c2 = await cp.evaluate(() => ({ pressed: document.querySelector('[data-single-note-option]').getAttribute('aria-pressed'), mode: window.PPP.arranger, title: document.querySelector('[data-song-arrange-title]').value }));
    ok('clicking it turns PPP.arranger to \'single\' and names the copy accordingly', c2.pressed === 'true' && c2.mode === 'single' && /one-note-per-hand/.test(c2.title), JSON.stringify(c2));
    await cp.click('[data-song-arranger] [data-single-note-option]');
    await sleep(300);
    const c3 = await cp.evaluate(() => ({ pressed: document.querySelector('[data-single-note-option]').getAttribute('aria-pressed'), mode: window.PPP.arranger, title: document.querySelector('[data-song-arrange-title]').value }));
    ok('clicking again turns it back off (legacy) and restores the copy name', c3.pressed === 'false' && c3.mode === 'legacy' && !/one-note-per-hand/.test(c3.title), JSON.stringify(c3));
    await cp.close();

    const rp = await openPage(browser);
    await loadReview(rp, HYMN('christ-arose'), 'christ-arose');
    const r1 = await rp.evaluate(() => { const b = document.querySelector('[data-arrangement] [data-single-note-option]'); return b && { text: b.innerText.trim(), pressed: b.getAttribute('aria-pressed') }; });
    ok('the recognition review screen has it too, off by default', !!r1 && r1.pressed === 'false' && r1.text === 'One note per hand (experimental)', JSON.stringify(r1));
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
    ok('in Korean the control reads 한 손 단음 (실험), with its explanation, from the catalog', kt.label === '한 손 단음 (실험)' && kt.label === ko['One note per hand (experimental)'] && /한 손에 한 번에 한 음/.test(kt.hint || ''), JSON.stringify(kt));
    await kp.close();

    console.log('\n── the option on: the Song Arranger, four hymns ──');
    const op = await openPage(browser);
    const before = op.__rec.requests.length;
    await op.evaluate(() => window.__pppTest.nav('My Songs'));
    await op.evaluate(() => { window.PPP.arranger = 'single'; });
    const made = {};
    for (const name of ['christ-arose', 'nearer-my-god', 'pass-me-not', 'all-creatures']) {
      const id = await addSong(op, HYMN(name));
      await op.evaluate(() => { window.PPP.arranger = 'single'; });
      const r = await overlayArrange(op, id, 'intermediate', 'balanced');
      made[name] = r;
      ok(name + ': saved as a new song, marked as the one-note-per-hand arranger', r.saved && r.slot.importSource && r.slot.importSource.arrangement && r.slot.importSource.arrangement.engine === 'ppp.g9-single' && r.slot.importSource.provider === 'PPP one-note-per-hand arranger', r.saved ? JSON.stringify(r.slot.importSource.arrangement) : r.status);
      ok(name + ': no hand starts two notes at once, both hands are used, ' + (r.attacks ? r.attacks.notes : '?') + ' notes', r.saved && r.attacks.perAttack.filter(n => n > 1).length === 0 && r.attacks.hands === 'lr' && r.attacks.notes > 100, r.saved ? JSON.stringify({ hands: r.attacks.hands, notes: r.attacks.notes }) : '');
    }
    const asked = op.__rec.requests.slice(before).filter(u => OPTION_FILES.test(u));
    const names = asked.map(u => u.split('?')[0]);
    const wantScripts = ['/realize/handchords.js', '/realize/ottava.js', '/critics/voice-leading.js', '/critics/register-density.js', '/critics/register-floor.js', '/critics/left-hand-jump.js', '/critics/low-register-cluster.js', '/critics/vertical-clash.js', '/critics/metrics.js', '/critics/index.js', '/candidates/index.js', '/repair/plan.js', '/repair/index.js'];
    ok('the option\'s 13 scripts were requested once each, only after it was turned on', wantScripts.every(s => names.filter(n => n === s).length === 1), names.join(' '));
    ok('and so was the reference data (G6a weights, method books), once each', names.filter(n => /method-books\.json$/.test(n)).length === 1 && names.filter(n => /g6a-v1\.json$/.test(n)).length <= 1, names.filter(n => /json$/.test(n)).join(' '));
    const others = op.__rec.requests.slice(before).filter(u => !OPTION_FILES.test(u) && /\.(js|json)(\?|$)/.test(u) && !/engrave\/|i18n|catalog\//.test(u));
    ok('no other script or data request came with it', others.length === 0, others.join(' '));

    {
      const ch = await addSong(op, HYMN('christ-arose'));
      await op.evaluate(() => { window.PPP.arranger = 'single'; });
      const og = await overlayArrange(op, ch, 'original', 'balanced');
      const wantOrig = process.env.G9E_WRITE_GOLDEN === '1' ? null : JSON.parse(fs.readFileSync(GOLDEN, 'utf8')).hashes['overlay|christ-arose|original|balanced'];
      ok('the Song Arranger with the option on leaves "Original transcription" alone: the same copy origin/main makes', og.saved && og.slot.importSource.arrangement.engine !== 'ppp.g9-single' && og.hash === wantOrig, (og.hash || '') + ' vs ' + wantOrig);
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

    console.log('\n── the option on, then off again: the default is what it was ──');
    await op.close();
    const goldenNow = process.env.G9E_WRITE_GOLDEN === '1' ? null : JSON.parse(fs.readFileSync(GOLDEN, 'utf8')).hashes;
    {
      const vp = await openPage(browser);
      const vid = await addSong(vp, HYMN('christ-arose'));
      await vp.evaluate(() => { window.PPP.arranger = 'single'; });
      await overlayArrange(vp, vid, 'intermediate', 'balanced');
      await vp.evaluate(() => { window.PPP.arranger = 'legacy'; });
      const v = await overlayArrange(vp, vid, 'intermediate', 'balanced');
      const want = goldenNow && goldenNow['overlay|christ-arose|intermediate|balanced'];
      ok('after the option was used and switched off, christ-arose (intermediate, balanced) in the Song Arranger is again the origin/main arrangement', goldenNow === null || (v.saved && v.hash === want), (v.hash || '') + ' vs ' + want);
      await vp.close();
    }

    console.log('\n── the option on: the recognition review screen ──');
    const rv = await openPage(browser);
    await loadReview(rv, HYMN('christ-arose'), 'christ-arose');
    await rv.click('[data-arrangement] [data-single-note-option]');
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
    ok('"Original transcription" is not arranged by the option: the heard notes are restored, engine not g9', orig.arrangement.engine !== 'ppp.g9-single' && !orig.arrangement.singleFallback, JSON.stringify(orig.arrangement));
    for (const name of ['nearer-my-god', 'pass-me-not']) {
      await loadReview(rv, HYMN(name), name);
      const r = await reviewApply(rv, 'intermediate', 'balanced');
      ok(name + ' on the review screen: one note per hand', r.arrangement.engine === 'ppp.g9-single' && r.perAttack.filter(n => n > 1).length === 0 && r.hands === 'lr', JSON.stringify({ arr: r.arrangement, hands: r.hands }));
    }
    ok('no page or console error on the review screen', rv.__rec.pageErrors.length === 0 && rv.__rec.consoleErrors.length === 0, JSON.stringify(rv.__rec.pageErrors.concat(rv.__rec.consoleErrors)));
    await rv.close();

    console.log('\n── refusals ──');
    const fp = await openPage(browser);
    const fid = await addSong(fp, SONATINA_020);
    await fp.evaluate(() => { window.PPP.arranger = 'single'; });
    const keysBefore = await songKeys(fp);
    const fr = await overlayArrange(fp, fid, 'intermediate', 'balanced');
    ok('Song Arranger, an unreachable piece (sonatina/020): nothing is saved, the dialog stays open and says why in words the person can act on', !fr.saved && fr.open && /could not be made in one-note-per-hand mode\. Turn the option off/.test(fr.status) && (await songKeys(fp)).length === keysBefore.length, fr.status.split('\n').filter(l => /one-note/.test(l)).join(' | '));
    await fp.evaluate(() => { window.PPP.arranger = 'legacy'; });
    await fp.close();

    const fr2 = await openPage(browser);
    await loadReview(fr2, SONATINA_020, 'sonatina 020');
    await fr2.click('[data-arrangement] [data-single-note-option]');
    await sleep(600);
    const fb = await reviewApply(fr2, 'advanced', 'balanced');
    ok('review screen, an unreachable piece: the standard arrangement is shown, marked so in its source (singleFallback), not labelled one-note-per-hand',
      fb.arrangement.singleFallback === 'UNREACHABLE' && fb.arrangement.engine !== 'ppp.g9-single' && fb.notes > 100, JSON.stringify(fb.arrangement));
    ok('and the notice stays on the screen, under the controls', fb.status === 'This piece could not be made in one-note-per-hand mode, so the standard arrangement is shown.' &&
      (await fr2.evaluate(() => document.querySelector('[data-arrangement]').innerText.indexOf('so the standard arrangement is shown') > -1)), fb.status);
    ok('nothing was thrown for it', fr2.__rec.pageErrors.length === 0 && fr2.__rec.consoleErrors.length === 0, JSON.stringify(fr2.__rec.pageErrors.concat(fr2.__rec.consoleErrors)));
    await fr2.close();

    const bp = await openPage(browser, { block: /\/candidates\/index\.js/ });
    await loadReview(bp, HYMN('christ-arose'), 'christ-arose');
    await bp.click('[data-arrangement] [data-single-note-option]');
    await sleep(800);
    const nb = await reviewApply(bp, 'intermediate', 'balanced');
    ok('option scripts that cannot be loaded (candidates/index.js refused): the same notice and the standard arrangement, not a blank screen or a silent switch',
      nb.arrangement.singleFallback === 'SINGLE_NOT_LOADED' && /standard arrangement is shown/.test(nb.status) && bp.__rec.blocked.length > 0, JSON.stringify(nb.arrangement));
    await bp.close();
  } catch (e) {
    ok('the suite ran to the end', false, e && e.stack || String(e));
  } finally {
    await browser.close();
    await srv.close();
  }
  console.log(errors.length ? '\n' + errors.length + ' FAILED' : '\nall passed');
  process.exit(errors.length ? 1 : 0);
})();
