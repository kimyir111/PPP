/* ============================================================================
   G10c-1b: the lead sheet of a recording in the real page (docs/GOALS/G10_AUDIO_TO_SCORE.md section 34)

   PPP.recordingArrange = 'leadsheet' (the default: RECORDING_ARRANGE_DEFAULT, one line to flip) | 'reduce' (what the page did before). The transcription model is replaced by a stub that returns heard
   notes made from numbers (a synthetic cover: a tune in quarters over a bass and a chord, tests/rec/leadsheet-fixtures.js; no recording, no private notes); everything after the notes - the import,
   the review screen, Accept, the saved song, the reload, the Song Arranger, the lazy load, the copies - is the real app. What this checks:
     - nothing new loads with the page: a fresh page asks for no file of rec/ (v2's 17 files nor rec/leadsheet.js) and its script requests are the page's own <script> list; the chip and the setter:
       the default, the remembered choice, the address for one visit, a value that is no choice
     - a saved v2 song opened in a FRESH page (nothing of v2 loaded) is arranged from its lead sheet at beginner, intermediate and advanced: the Song Arranger's chip is there and pressed, rec/leadsheet.js
       (and v2's files, which it reads) are asked for once each when the Arranger opens, the copy's source says recordingArrange 'leadsheet', its composer line says "(lead sheet)", its right hand is the tune,
       its bars add up (checker classes 1-7 are 0), one note per hand
     - the two loaders (v2's conversion, the lead sheet) started together in either order both say yes at once, each file asked for once; a file the lead sheet reads that failed once leaves no half-loaded
       lead sheet: the next Create asks for it again and the copy is the lead sheet, equal to the one a page that never failed makes
     - the chip pressed (reduce): the copy is EXACTLY the copy the page's arrangeSingleNote (main's function) makes, with no mark and the old composer line; pressed again, the lead sheet
     - a refusal falls back: the lead sheet refused (any reason; the module blocked) -> the reduction's copy, marked reduce with the reason, equal to main's; refused by both -> the existing refusal notice and
       nothing saved (the standard arrangement is the person's click)
     - the relaxed note: a cover in six sharps, which the reduction refuses (UNREACHABLE), is a lead-sheet copy with the lead-sheet words (key signature and melody, not the left hand), in English and Korean
     - a recording whose arrangement was applied on the review screen and accepted is kept as that arrangement's graph (no audio-score source): its Song Arranger shows NO chip, Create there is the reduction's
       copy with no claim of the lead sheet; a song accepted as heard keeps its chip (the chip is shown where Create would make a lead sheet)
     - the review screen's Apply arrangement has the chip and the same two ways; "Original transcription" has no chip and no lead sheet; a catalogue piece has no chip and the same copy either way
     - Korean first: the chip, its two lines, the composer line, in 400 px with no sideways scroll
     - no page error and no console error throughout
   Runs against its own server on a free port (tests/serve-free.js); PPP_URL=... runs it against another build. node tests/recording-leadsheet-app.test.js
   LS_ONLY=defaults|fresh|interplay|loaders|reduce|refuse|relaxed|review|applied|others|korean (a regular expression) runs only those sections.
   ========================================================================== */
'use strict';
const puppeteer = require('puppeteer');
const { startServer } = require('./serve-free');
const L = require('./recording-v2-lib');
const { fs, path, REPO, errors, sleep, ok, want: wantV2, setBase, openPage, recReqs, clean, errs, addChecker, importHeard, press, stateOf, accept, slotOf } = L;
const { cover, tune, SCALE } = require('./rec/leadsheet-fixtures.js');
const E = require('./realize/app-single-extract.js');

const ONLY = process.env.LS_ONLY ? new RegExp(process.env.LS_ONLY) : null;
const want = n => !ONLY || ONLY.test(n);
const KEY = 'ppp.recordingArrange.v1';
/* the page's own default (its one line, RECORDING_ARRANGE_DEFAULT): the sections that need the lead sheet ask for it as a person who pressed the chip would (the device remembers it), and the lines
   of the chip say "(the default)" of the state that is the default; so the flip of the default changes nothing in this test (it is written for either value); the 'defaults' section is the one that looks at the
   default itself */
const DEFAULT = /^const RECORDING_ARRANGE_DEFAULT = '(\w+)';$/m.exec(fs.readFileSync(path.join(REPO, 'Piano Coach App.dc.html'), 'utf8').replace(/\r\n/g, '\n'))[1];
const LEAD = { [KEY]: 'leadsheet' };
const LABEL = 'Arrange from a lead sheet';
const ON_BODY = 'a recording is arranged from its melody and chords. The melody stays one line and an easy accompaniment is written under it. Turn it off to thin out the recording\'s own notes instead.';
const OFF_BODY = 'a recording\'s own notes are thinned out to fit the level. Turn it on to arrange from its melody and chords instead.';
const ON_LINE = (DEFAULT === 'leadsheet' ? 'On (the default): ' : 'On: ') + ON_BODY;
const OFF_LINE = (DEFAULT === 'reduce' ? 'Off (the default): ' : 'Off: ') + OFF_BODY;
const RELAXED_EN = 'This arrangement keeps the recording\'s own key signature and melody as they are, so it may be harder than the level you chose. The difficulty comes from the key signature and the melody itself, not from the left hand.';
const RELAXED_OLD = 'This piece has many notes, so the arrangement may be a little harder than the level you chose.';
const RELAXED_NEUTRAL = 'This arrangement may be harder than the level you chose.';
const FELL_EN = 'The lead sheet could not be used, so the recording\'s own notes were thinned out instead.';
const told = says => (says || []).filter(s => s.indexOf(FELL_EN) > -1).length;   /* how many of the page's messages carry the fallback notice */
const CODE = 'ALL_CANDIDATES_HAVE_HARD_VIOLATIONS';
const heard = c => ({ notes: c.notes.map(n => ({ on: n.on, off: n.off, midi: n.midi, vel: n.vel })) });
const COVERS = { sc0: heard(cover(24, tune)), sc6: heard(cover(24, tune, { shift: 6 })) };
const CATALOG = L.CATALOG;
const HYMN = path.join(REPO, 'catalog', 'hymns', 'christ-arose.musicxml');

/* the notes of a Score the way the checks compare them (a copy against a copy) */
const NOTE_HASH = `sc => JSON.stringify(sc.notes.map(n => [n.m, n.b, n.midi, Math.round(n.dur * 1000), n.rest ? 1 : 0, n.hand, n.staff, n.voice, n.tieStart ? 1 : 0, n.tieStop ? 1 : 0]))`;
const says = page => page.evaluate(() => { const A = window.PPP.app; if (!A.__sayHook) { const real = A.say.bind(A); A.__sayHook = true; window.__says = []; A.say = m => { window.__says.push(m); return real(m); }; } });

/* the review screen's Accept button, in any language the tests use */
const acceptAny = async page => { await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find(x => /Accept and practise|확인하고 연습/.test(x.innerText)); if (b) b.click(); }); await sleep(2500); };
const toSongs = async page => { await page.evaluate(() => window.PPP.app.go('songs')()); await sleep(700); };

/* a fresh page with the saved song, v2's files NOT loaded: import the cover, accept, reload (what a saved v2 song is when it is opened later) */
async function savedSong(browser, cover, o) {
  o = Object.assign({}, o, { store: Object.assign({}, LEAD, o && o.store) });
  const p = await openPage(browser, o);
  if (o.failOff) p.__rec.failOn = false;   /* the requests that fail are not what the import is about: they fail from the moment the caller sets failOn */
  await addChecker(p);
  await importHeard(p, cover);
  const s = await stateOf(p);
  await acceptAny(p);
  await sleep(2500);
  const id = s.songId;
  await p.reload({ waitUntil: 'networkidle2' });
  await p.waitForFunction(() => !!(window.PPP && window.PPP.app));
  await sleep(800);
  p.__mark = p.__rec.requests.length;   /* what the fresh page asks for is counted from here: the import before the reload had asked for v2's files */
  await addChecker(p);
  await says(p);
  return { page: p, id: id, state: s };
}
/* the real Song Arranger: open the song's card, pick the level, press Create. `mode`: nothing; wait for a copy or a refusal. */
async function arrangeCopy(page, songId, level, o) {
  o = o || {};
  await page.evaluate(() => { try { window.PPP.app.closeSongArranger(); } catch (e) { /* none open */ } });
  await toSongs(page);
  await page.waitForSelector('[data-arrange-song="' + songId + '"]', { timeout: 30000 });
  await page.evaluate(i => document.querySelector('[data-arrange-song="' + i + '"]').click(), songId); await sleep(500);
  if (o.beforeCreate) await o.beforeCreate();
  await page.waitForFunction(() => !!(window.PPPCandidates && window.PPPCandidates.runAsync), { timeout: 60000 });
  await page.select('[data-song-arrange-level]', level);
  await page.select('[data-song-arrange-style]', 'balanced');
  await sleep(300);
  const before = await page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('ppp.song.v1.')));
  await page.evaluate(() => { window.__says = []; });
  await page.click('[data-create-song-arrangement]');
  await page.waitForFunction(() => { const S = window.PPP.app.state; return !S.songArrange || (!S.songArrange.busy && (S.songArrange.singleRefusal || S.songArrange.status)); }, { timeout: 300000, polling: 400 });
  await sleep(700);
  return page.evaluate(b => {
    const S = window.PPP.app.state, keys = Object.keys(localStorage).filter(k => k.startsWith('ppp.song.v1.') && b.indexOf(k) < 0);
    const slot = keys.length ? JSON.parse(localStorage.getItem(keys[0])) : null;
    return { refusal: S.songArrange && S.songArrange.singleRefusal ? S.songArrange.singleRefusal.reason : null, notice: !!document.querySelector('[data-single-refusal]'), newKeys: keys, slot: slot,
      says: (window.__says || []).slice(), arrangement: slot && slot.importSource && slot.importSource.arrangement || null, composer: slot ? (slot.score && slot.score.composer || null) : null };
  }, before);
}
/* what the page's own arrangeSingleNote (the function main has, unchanged) makes of the saved song's graph, and what the saved copy holds, as note hashes */
const mainHash = (page, id, level) => page.evaluate(async (i, lv, src) => {
  const P = window.PPP, h = (0, eval)(src);
  const sc = P.app.scoreForArrangement(i);
  /* a copy of the graph with its title changed: the page's cache of arrangements is keyed by the graph's fingerprint and level, so the Song Arranger's own result (the same graph) would be served back and
     "equal to main's" would be equal to itself; the title does not touch a note, so this is main's function running the same recording for real */
  const g = JSON.parse(JSON.stringify((await window.PPPEngrave.app.resolve(sc, { key: i })).graph));
  g.meta = Object.assign({}, g.meta, { title: 'uncached ' + Date.now() + Math.random() });
  const r = await P.arrangeSingleNote(g, { level: lv });
  return r.ok ? { ok: true, hash: h(P.graphToReviewScore(r.graph, 'x')) } : { ok: false, reason: r.reason };
}, id, level, NOTE_HASH);
const copyHash = (page, key) => page.evaluate((k, src) => { const P = window.PPP, h = (0, eval)(src); const sc = P.unpackScore(JSON.parse(localStorage.getItem(k)).score); return h(P.Score.finalize(sc)); }, key, NOTE_HASH);
const copyFacts = (page, key) => page.evaluate((k, tuneSrc) => {
  const P = window.PPP, raw = JSON.parse(localStorage.getItem(k)), sc = P.Score.finalize(P.unpackScore(raw.score));
  const notes = sc.notes.filter(n => !n.rest), by = new Map();
  notes.forEach(n => { const q = n.hand + '|' + n.m + '|' + n.b; by.set(q, (by.get(q) || 0) + 1); });
  const rh = notes.filter(n => n.hand === 'r' && !n.tieStop).sort((a, b) => a.abs - b.abs);
  const NC = window.PPPScoreGraphModules && window.PPPScoreGraphModules.notationCheck;
  let classes = null;
  try { const r = NC.checkScore(sc); classes = {}; for (let c = 1; c <= 7; c++) classes[c] = r.classes[c].count; } catch (e) { classes = { error: String(e && e.message || e) }; }
  return { notes: notes.length, maxPerHand: Math.max.apply(null, [...by.values()]), rh: rh.map(n => n.midi), classes: classes, measures: sc.measures.length,
    composer: sc.composer || raw.score.composer || (raw.importSource && raw.importSource.composer) || null, title: raw.fileName };
}, key);
const chip = page => page.evaluate(() => { const b = document.querySelector('[data-song-arranger] [data-recording-arrange-option]'); if (!b) return null; const p = b.parentElement.querySelector('p'); const r = b.getBoundingClientRect();
  return { text: b.innerText.trim(), pressed: b.getAttribute('aria-pressed'), hint: p && p.innerText.trim(), inView: r.right <= window.innerWidth && r.left >= 0, noSideScroll: document.documentElement.scrollWidth <= window.innerWidth + 1 }; });
const recSince = p => p.__rec.requests.slice(p.__mark || 0).filter(u => /^\/rec\//.test(u)).map(u => u.split('?')[0]);
const LEAD_FILES = ['/rec/weights/ai5b-grid-v1.json', '/rec/grid.js', '/rec/writer.js', '/rec/leadsheet.js'];
const tuneOf =n => { const o = []; for (let b = 0; b < n; b++) for (let k = 0; k < 4; k++) o.push(tune(b, k)); return o; };
const prefixOf = (a, b) => b.length >= a.length && a.every((x, i) => x === b[i]);

(async () => {
  const srv = await startServer();
  setBase(srv.url);
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'], protocolTimeout: 600000 });
  try {
    /* ------------------------------------------------------------------ the page's default, the setter, and what loads with the page */
    if (want('defaults')) {
      console.log('\n── PPP.recordingArrange: the default, the setter, nothing new at page load ──');
      const p0 = await openPage(browser);
      const mode = p => p.evaluate(() => window.PPP.recordingArrange);
      const stored = p => p.evaluate(k => localStorage.getItem(k), KEY);
      ok('the page\'s default is one of the two choices (RECORDING_ARRANGE_DEFAULT, one line: the user\'s decision of 2026-10-07 is leadsheet; this suite reads it and is written for either)', DEFAULT === 'leadsheet' || DEFAULT === 'reduce', DEFAULT);
      ok('a fresh page holds the page\'s default (' + DEFAULT + '), nothing stored, loading writes nothing', (await mode(p0)) === DEFAULT && (await stored(p0)) === null);
      await sleep(3500);
      const idle = p0.__rec.requests.map(u => u.split('?')[0]);
      ok('a fresh page asks for no file of rec/ (not v2\'s 17, not rec/leadsheet.js) however long it stays idle', idle.filter(u => /^\/rec\//.test(u)).length === 0, idle.filter(u => /^\/rec\//.test(u)).join(' '));
      const head = new Set(E.scriptListOfPage().head.map(f => '/' + f));
      const js = Array.from(new Set(idle.filter(u => /\.js$/.test(u))));
      const known = u => head.has(u) || u === '/i18n.js' || /^\/(react|react-dom)@/.test(u) || /^\/engrave\//.test(u);   /* the page's own list, React, and the engraver's modules the page fetches after its first paint (as main does) */
      ok('its script requests are the page\'s own: no arranger script (candidates, repair, critics, realize/ottava...) and no file of rec/ - rec/leadsheet.js is lazy, like the other arranger scripts', js.every(known) && !js.some(u => /leadsheet|^\/(candidates|repair|critics)\//.test(u)), js.filter(u => !known(u)).join(' '));
      ok('rec/leadsheet.js is no <script> of the page and PPPRecLeadsheet does not exist yet', await p0.evaluate(() => ![...document.scripts].some(s => /leadsheet/.test(s.src)) && typeof window.PPPRecLeadsheet === 'undefined'));
      await p0.evaluate(() => { window.PPP.recordingArrange = 'reduce'; });
      ok('PPP.recordingArrange = reduce is remembered (localStorage ' + KEY + ')', (await mode(p0)) === 'reduce' && (await stored(p0)) === 'reduce');
      await p0.reload({ waitUntil: 'networkidle2' }); await p0.waitForFunction(() => !!(window.PPP && window.PPP.app));
      ok('and it is reduce after a reload', (await mode(p0)) === 'reduce');
      await p0.evaluate(() => { window.PPP.recordingArrange = 'leadsheet'; });
      ok('leadsheet is remembered too (the choice made is the choice kept)', (await mode(p0)) === 'leadsheet' && (await stored(p0)) === 'leadsheet');
      for (const bad of ['typo', null, true, 'Reduce', 'v2', '']) {
        await p0.evaluate(v => { window.PPP.recordingArrange = 'reduce'; window.PPP.recordingArrange = v; }, bad);
        if (!((await mode(p0)) === DEFAULT && (await stored(p0)) === null)) ok('a value that is no choice (' + JSON.stringify(bad) + '): the default, the remembered choice forgotten', false, (await mode(p0)) + ' ' + (await stored(p0)));
      }
      ok('a value that is no choice (typo, null, true, "Reduce", "v2", ""): the default comes back and the remembered choice is forgotten', (await mode(p0)) === DEFAULT && (await stored(p0)) === null);
      await p0.close();
      const q1 = await openPage(browser, { query: '?recordingArrange=reduce' });
      ok('?recordingArrange=reduce in the address is reduce for that visit and is not remembered', (await mode(q1)) === 'reduce' && (await stored(q1)) === null);
      await q1.close();
      const q2 = await openPage(browser, { query: '?recordingArrange=leadsheet', store: { [KEY]: 'reduce' } });
      ok('?recordingArrange=leadsheet wins over a remembered reduce for that visit; the remembered choice stays', (await mode(q2)) === 'leadsheet' && (await stored(q2)) === 'reduce');
      await q2.close();
      const q3 = await openPage(browser, { query: '?recordingArrange=bogus', store: { [KEY]: 'reduce' } });
      ok('an unknown value in the address has no say: a remembered reduce stands', (await mode(q3)) === 'reduce');
      await q3.close();
      const q4 = await openPage(browser, { store: { [KEY]: 'garbage' } });
      ok('a remembered value that is neither is no choice: the default', (await mode(q4)) === DEFAULT);
      ok('no page or console error', clean(q4), errs(q4));
      await q4.close();
    }

    /* ------------------------------------------------------------------ a saved v2 song in a fresh page: the lead sheet, three levels */
    let saved = null;
    if (want('fresh|reduce|refuse')) saved = await savedSong(browser, COVERS.sc0);
    if (want('fresh')) {
      console.log('\n── a saved v2 song opened in a fresh page: the Song Arranger makes lead-sheet copies ──');
      const { page: p, id } = saved;
      ok('the saved song is a v2 song, and the fresh page has none of v2 loaded and none of rec/leadsheet.js (nothing was asked for yet)', saved.state.pipeline === 'v2' && !(await p.evaluate(() => window.PPP.recordingModulesReady() || typeof window.PPPRecLeadsheet !== 'undefined')) && recSince(p).length === 0, JSON.stringify(recSince(p).slice(0, 4)));
      const tuneWant = tuneOf(24);
      for (const level of ['beginner', 'intermediate', 'advanced']) {
        const r = await arrangeCopy(p, id, level, { beforeCreate: async () => {
          if (level === 'beginner') {
            const c = await chip(p);
            ok('the Song Arranger has the chip, pressed (the suite asks for the lead sheet), labelled "' + LABEL + '", with the ON line', !!c && c.text === LABEL && c.pressed === 'true' && c.hint === ON_LINE, JSON.stringify(c));
            ok('opening the Song Arranger on a recording asks for what the lead sheet reads and for rec/leadsheet.js, nothing else of v2: the grid model, rec/grid.js, rec/writer.js, rec/leadsheet.js, once each in that order (87 KB), before Create is pressed',
              await p.waitForFunction(() => !!window.PPPRecLeadsheet, { timeout: 60000 }).then(() => true).catch(() => false)
              && JSON.stringify(recSince(p)) === JSON.stringify(LEAD_FILES) && !(await p.evaluate(() => window.PPP.recordingModulesReady())), JSON.stringify(recSince(p)));
          }
        } });
        const a = r.arrangement;
        ok(level + ': a copy was saved (not refused)', r.refusal === null && r.newKeys.length === 1 && !!a, JSON.stringify({ refusal: r.refusal, keys: r.newKeys.length }));
        const f = r.newKeys[0] ? await copyFacts(p, r.newKeys[0]) : null;
        ok(level + ': its source says it was made from the lead sheet (recordingArrange "leadsheet", the lead sheet\'s own counts), by the one-note-per-hand engine, no refusal and no fallback mark',
          !!a && a.recordingArrange === 'leadsheet' && !a.leadsheetRefusal && a.engine === 'ppp.g9-single' && !a.handsFallback && !a.classicFallback && !!a.leadsheet && a.leadsheet.melodyNotes >= 90 && a.leadsheet.version, JSON.stringify(a));
        ok(level + ': its composer line says "(lead sheet)"', !!f && /PPP one-note-per-hand arrangement \(lead sheet\)/.test(JSON.stringify(r.slot)), JSON.stringify(f && f.composer));
        ok(level + ': one note per hand, its bars add up (checker classes 1-7 are 0), the notes are there', !!f && f.maxPerHand === 1 && f.notes > 150 && f.classes && Object.values(f.classes).every(v => v === 0), JSON.stringify(f && { n: f.notes, per: f.maxPerHand, c: f.classes }));
        ok(level + ': its right hand IS the tune (the cover\'s 96 melody notes, first to last, in order, the accompaniment is under them)', !!f && prefixOf(tuneWant, f.rh), JSON.stringify(f && f.rh.slice(0, 12)));
        const same = await p.evaluate(() => window.PPP.recordingArrange);
        if (level === 'beginner') ok('the lead sheet copy is not the reduction\'s copy', (await copyHash(p, r.newKeys[0])) !== (await mainHash(p, id, level)).hash, same);
      }
      const reqs = recSince(p);
      ok('over the whole session of three Creates each of those four files was asked for once, and not one other file of rec/ (v2\'s conversion is not what a lead sheet needs)', JSON.stringify(reqs) === JSON.stringify(LEAD_FILES), reqs.join(' ').slice(0, 400));
      ok('no page or console error', clean(p), errs(p));
    }

    /* ------------------------------------------------------------------ the two loaders share their files */
    if (want('interplay')) {
      console.log('\n── the lead sheet\'s files and v2\'s conversion share the page: asked for once, and the conversion is the same ──');
      const base = await savedSong(browser, COVERS.sc0);   /* v2 came by the Add screen, as ever */
      const sb = await savedSong(browser, COVERS.sc0);
      const pb = sb.page;
      await toSongs(pb);
      await pb.evaluate(i => document.querySelector('[data-arrange-song="' + i + '"]').click(), sb.id);
      await pb.waitForFunction(() => !!window.PPPRecLeadsheet, { timeout: 60000 });
      ok('a fresh page with a saved v2 song, the Song Arranger opened first: the lead sheet is there with four requests and v2\'s conversion is not loaded', JSON.stringify(recSince(pb)) === JSON.stringify(LEAD_FILES) && !(await pb.evaluate(() => window.PPP.recordingModulesReady())), JSON.stringify(recSince(pb)));
      await pb.evaluate(() => window.PPP.app.closeSongArranger());
      const imp = await importHeard(pb, COVERS.sc0);   /* the Add screen asks for v2's conversion now */
      const st = await stateOf(pb);
      const all = recSince(pb);
      ok('then the Add screen and an import: v2 asks for the rest only (the 14 files that were not there), and every file of rec/ was asked for once in the whole session (v2\'s 17 and rec/leadsheet.js: 18, none twice)', imp.screen === 'review' && all.length === 18 && new Set(all).size === 18 && all.slice(0, 4).join() === LEAD_FILES.join(), String(all.length) + ' ' + all.slice(4).join(' ').slice(0, 300));
      ok('and the conversion is the one a page that never opened the Song Arranger makes: v2, the same notation note for note (hash, measures, notes, rests, brackets)', st.pipeline === 'v2' && st.hash === base.state.hash && st.measures === base.state.measures && st.notes === base.state.notes && st.rests === base.state.rests && st.brackets === base.state.brackets, JSON.stringify([st.hash, base.state.hash]));
      ok('no page or console error', clean(pb) && clean(base.page), errs(pb) + errs(base.page));
      await pb.close(); await base.page.close();
    }

    /* ------------------------------------------------------------------ the two loaders at once; a file that failed once */
    if (want('loaders')) {
      console.log('\n── both loaders at once, in either order; a file the lead sheet reads failed once ──');
      for (const order of ['rec-then-lead', 'lead-then-rec']) {
        const p = await openPage(browser, { store: LEAD });
        p.__mark = p.__rec.requests.length;
        const r = await p.evaluate(async order => {
          const t0 = performance.now(), P = window.PPP;
          const tag = (n, pr) => pr.then(v => [n, v, Math.round(performance.now() - t0)]);
          const calls = order === 'rec-then-lead' ? [() => tag('rec', P.loadRecordingModules()), () => tag('lead', P.loadLeadsheetModule())] : [() => tag('lead', P.loadLeadsheetModule()), () => tag('rec', P.loadRecordingModules())];
          return Promise.all(calls.map(c => c()));
        }, order);
        ok(order + ': started in the same moment, both loaders say yes, each long before the 15 s of a stall (it was 15 s and no, both, when each waited for the other)', r.every(x => x[1] === true && x[2] < 10000), JSON.stringify(r));
        const files = recSince(p);
        ok(order + ': v2 is ready, the lead sheet is on the page, and each of the 18 files of rec/ (the 17 of v2 and rec/leadsheet.js) was asked for once',
          (await p.evaluate(() => window.PPP.recordingModulesReady() && !!window.PPPRecLeadsheet)) && files.length === 18 && new Set(files).size === 18, files.length + ' ' + new Set(files).size);
        ok(order + ': no page or console error', clean(p), errs(p));
        await p.close();
      }
      /* a file the lead sheet reads fails once (a bad network) while it is being loaded: the next Create asks for it again; no lead sheet that holds no writer (or no grid) is left on the page */
      const ref = await savedSong(browser, COVERS.sc0);
      const refCopy = await arrangeCopy(ref.page, ref.id, 'beginner');
      const refHash = refCopy.newKeys[0] ? await copyHash(ref.page, refCopy.newKeys[0]) : null;
      await ref.page.close();
      ok('(reference) a page that never failed makes the lead sheet copy', !!refHash && !!refCopy.arrangement && refCopy.arrangement.recordingArrange === 'leadsheet');
      for (const file of ['writer', 'grid']) {
        const sv = await savedSong(browser, COVERS.sc0, { failWhile: new RegExp('/rec/' + file + '[.]js'), failOff: true });
        const p = sv.page, asked = name => p.__rec.requests.filter(u => u.split('?')[0] === '/rec/' + name + '.js').length;
        p.__rec.failOn = true;
        const c1 = await arrangeCopy(p, sv.id, 'beginner');
        ok('rec/' + file + '.js fails: the first Create makes the reduction copy (main\'s), marked reduce with LEADSHEET_NOT_LOADED, nothing thrown', c1.refusal === null && c1.newKeys.length === 1 && !!c1.arrangement && c1.arrangement.recordingArrange === 'reduce' && c1.arrangement.leadsheetRefusal === 'LEADSHEET_NOT_LOADED', JSON.stringify(c1.arrangement));
        ok('and no lead sheet is left on the page (it would hold no ' + file + '): PPPRecLeadsheet is gone', await p.evaluate(() => typeof window.PPPRecLeadsheet === 'undefined'));
        p.__rec.failOn = false;
        const before = [asked(file), asked('leadsheet')];
        const c2 = await arrangeCopy(p, sv.id, 'beginner');
        ok('rec/' + file + '.js reachable again: the Song Arranger asks for it and for the lead sheet again (once each), and for nothing else of v2, and the second Create makes the lead sheet copy',
          c2.refusal === null && c2.newKeys.length === 1 && !!c2.arrangement && c2.arrangement.recordingArrange === 'leadsheet' && !c2.arrangement.leadsheetRefusal && asked(file) - before[0] === 1 && asked('leadsheet') - before[1] === 1
          && !['hands', 'index', 'metre', 'voices'].some(n => recSince(p).indexOf('/rec/' + n + '.js') > -1), JSON.stringify([c2.arrangement, before, asked(file), asked('leadsheet')]));
        ok('and that copy is the lead sheet a page that never failed makes, note for note (the lead sheet holds its ' + file + ')', !!c2.newKeys[0] && (await copyHash(p, c2.newKeys[0])) === refHash);
        ok('no page error (the failed file is a failed request, not a script error)', p.__rec.pageErrors.length === 0, JSON.stringify(p.__rec.pageErrors));
        await p.close();
      }
    }

    /* ------------------------------------------------------------------ the chip: reduce is main's copy */
    if (want('reduce')) {
      console.log('\n── the chip pressed (reduce): the copy is main\'s; pressed again, the lead sheet ──');
      const { page: p, id } = saved;
      await p.evaluate(() => { window.PPP.recordingArrange = 'leadsheet'; });
      await p.evaluate(() => window.PPP.app.closeSongArranger());
      await toSongs(p);
      await p.evaluate(i => document.querySelector('[data-arrange-song="' + i + '"]').click(), id); await sleep(500);
      await p.click('[data-song-arranger] [data-recording-arrange-option]'); await sleep(400);
      const c1 = await chip(p);
      ok('pressing the chip: not pressed, the OFF line, PPP.recordingArrange reduce, remembered', !!c1 && c1.pressed === 'false' && c1.hint === OFF_LINE && (await p.evaluate(k => [window.PPP.recordingArrange, localStorage.getItem(k)].join(), KEY)) === 'reduce,reduce', JSON.stringify(c1));
      await p.evaluate(() => window.PPP.app.closeSongArranger());
      for (const level of ['beginner', 'advanced']) {
        const r = await arrangeCopy(p, id, level);
        const want0 = await mainHash(p, id, level);
        ok(level + ': reduce - a copy is saved, it is EXACTLY the copy the page\'s own arrangeSingleNote (main\'s function) makes, note for note (hand, bar, beat, pitch, length, voice, tie)',
          r.newKeys.length === 1 && want0.ok && (await copyHash(p, r.newKeys[0])) === want0.hash, JSON.stringify(want0.ok ? 'differs' : want0));
        ok(level + ': its source is main\'s: no recordingArrange, no leadsheet, no refusal mark; the composer line is the plain one', !!r.arrangement && r.arrangement.recordingArrange === undefined && r.arrangement.leadsheet === undefined && r.arrangement.leadsheetRefusal === undefined && r.arrangement.engine === 'ppp.g9-single'
          && /PPP one-note-per-hand arrangement/.test(JSON.stringify(r.slot)) && !/lead sheet/.test(JSON.stringify(r.slot)), JSON.stringify(r.arrangement));
      }
      await p.evaluate(() => window.PPP.app.closeSongArranger());
      await toSongs(p);
      await p.evaluate(i => document.querySelector('[data-arrange-song="' + i + '"]').click(), id); await sleep(500);
      await p.click('[data-song-arranger] [data-recording-arrange-option]'); await sleep(400);
      const c2 = await chip(p);
      ok('pressed again: pressed, the ON line, leadsheet', !!c2 && c2.pressed === 'true' && c2.hint === ON_LINE && (await p.evaluate(() => window.PPP.recordingArrange)) === 'leadsheet');
      await p.evaluate(() => window.PPP.app.closeSongArranger());
      const r3 = await arrangeCopy(p, id, 'beginner');
      ok('and the copy is the lead sheet again', !!r3.arrangement && r3.arrangement.recordingArrange === 'leadsheet');
      ok('no page or console error', clean(p), errs(p));
    }

    /* ------------------------------------------------------------------ a refusal falls back to the reduction */
    if (want('refuse')) {
      console.log('\n── a refusal of the lead sheet falls back to the reduction; only then the refusal notice ──');
      /* a page of its own: the page keeps the last arrangements by (graph, level), and a result served from that memory would be no refusal and no run */
      const { page: p, id } = await savedSong(browser, COVERS.sc0);
      await p.evaluate(() => { window.PPP.recordingArrange = 'leadsheet'; });
      /* the lead sheet refuses (any reason) and the candidates stage can be made to refuse: wrapped in the page once the arranger's modules have loaded (the Song Arranger's open asks for them), so everything else is real */
      const plant = (leadRefuse, candRefuse) => async () => {
        await p.waitForFunction(() => !!(window.PPPCandidates && window.PPPCandidates.runAsync && window.PPPRecLeadsheet), { timeout: 90000 });
        await p.evaluate((code, lr, cr) => {
          window.__leadRefuse = lr; window.__candRefuse = cr; window.__prepared = 0; window.__candRuns = 0;
          if (window.__planted) return;
          window.__planted = true;
          const realLead = window.PPPRecLeadsheet, realCand = window.PPPCandidates;
          window.PPPRecLeadsheet = Object.assign({}, realLead, { prepare: function () { window.__prepared++; return window.__leadRefuse ? { ok: false, reason: window.__leadRefuse, message: 'planted' } : realLead.prepare.apply(realLead, arguments); } });
          window.PPPCandidates = Object.assign({}, realCand, { runAsync: function () { window.__candRuns++; return window.__candRefuse === 'always' ? Promise.resolve({ ok: false, reason: code, discarded: [] }) : realCand.runAsync.apply(realCand, arguments); } });
        }, CODE, leadRefuse, candRefuse);
      };
      /* both refuse first (a refusal is not remembered): the existing refusal notice, nothing saved, the reduction's own reason, its three tries and the lead sheet's none beyond the one */
      const rb = await arrangeCopy(p, id, 'beginner', { beforeCreate: plant('LEADSHEET_NO_MELODY', 'always') });
      ok('refused by both: the refusal notice (the standard arrangement is the person\'s click), nothing saved, the reduction\'s reason; the lead sheet was asked once, the reduction ran its three tries (the classic hands, then the classic conversion)',
        rb.refusal === CODE && rb.notice && rb.newKeys.length === 0 && (await p.evaluate(() => [window.__prepared, window.__candRuns].join())) === '1,3', JSON.stringify({ r: rb.refusal, n: rb.notice, k: rb.newKeys.length }));
      /* then each reason at a level of its own (the reduction's copy is remembered by level) */
      for (const [reason, level] of [['LEADSHEET_NO_MELODY', 'beginner'], ['LEADSHEET_IRREGULAR_BARS', 'intermediate'], ['LEADSHEET_METRE', 'advanced']]) {
        const r = await arrangeCopy(p, id, level, { beforeCreate: plant(reason, 'none') });
        const used = await p.evaluate(() => ({ prepared: window.__prepared, runs: window.__candRuns }));
        const want0 = await mainHash(p, id, level);
        ok(reason + ': the copy is the reduction\'s, exactly main\'s copy, saved (the Song Arranger shows no refusal)', r.refusal === null && r.newKeys.length === 1 && want0.ok && (await copyHash(p, r.newKeys[0])) === want0.hash, JSON.stringify({ r: r.refusal, k: r.newKeys.length }));
        ok(reason + ': it says which path made it - recordingArrange "reduce", leadsheetRefusal "' + reason + '" - and the composer line is the plain one', !!r.arrangement && r.arrangement.recordingArrange === 'reduce' && r.arrangement.leadsheetRefusal === reason && !r.arrangement.leadsheet && !/lead sheet/.test(JSON.stringify(r.slot)), JSON.stringify(r.arrangement));
        ok(reason + ': and the person is told, once, with the message that says the copy was saved: the lead sheet could not be used, the recording\'s own notes were thinned out instead', told(r.says) === 1 && r.says.length === 1, JSON.stringify(r.says));
        ok(reason + ': the lead sheet was asked once and the candidates stage ran once (the reduction), not for the lead sheet: no hands retry, nothing converted again', used.prepared === 1 && used.runs === 1, JSON.stringify(used));
      }
      const rc = await arrangeCopy(p, id, 'beginner', { beforeCreate: plant(null, 'none') });
      ok('and with the lead sheet allowed again the copy is a lead sheet copy (the refusal notice of before is gone)', rc.refusal === null && !rc.notice && !!rc.arrangement && rc.arrangement.recordingArrange === 'leadsheet');
      ok('and a lead sheet copy says nothing of the kind', told(rc.says) === 0, JSON.stringify(rc.says));
      ok('no page or console error', clean(p), errs(p));
      await p.close();
      /* the module cannot be had: blocked at the server */
      const pb = await savedSong(browser, COVERS.sc0, { failWhile: /\/rec\/leadsheet\.js/ });
      await pb.page.evaluate(() => { window.PPP.recordingArrange = 'leadsheet'; });
      const rb2 = await arrangeCopy(pb.page, pb.id, 'beginner');
      const wantB = await mainHash(pb.page, pb.id, 'beginner');
      ok('rec/leadsheet.js blocked: no module, no error - the copy is the reduction\'s, main\'s, marked reduce with LEADSHEET_NOT_LOADED', rb2.refusal === null && rb2.newKeys.length === 1 && wantB.ok && (await copyHash(pb.page, rb2.newKeys[0])) === wantB.hash
        && !!rb2.arrangement && rb2.arrangement.recordingArrange === 'reduce' && rb2.arrangement.leadsheetRefusal === 'LEADSHEET_NOT_LOADED', JSON.stringify(rb2.arrangement));
      ok('and it says so, once: the lead sheet could not be used, the recording\'s own notes were thinned out instead (the copy was saved silently before)', told(rb2.says) === 1 && rb2.says.length === 1, JSON.stringify(rb2.says));
      ok('no page error (the blocked file is a failed request, not a script error)', pb.page.__rec.pageErrors.length === 0, JSON.stringify(pb.page.__rec.pageErrors));
      await pb.page.close();
    }
    if (saved && saved.page && !saved.page.isClosed()) await saved.page.close();

    /* ------------------------------------------------------------------ the relaxed note, in six sharps */
    if (want('relaxed')) {
      console.log('\n── a cover in six sharps: the reduction refuses it, the lead sheet makes it and says why it may be hard ──');
      const sv = await savedSong(browser, COVERS.sc6);
      const p = sv.page;
      ok('the cover is in six sharps or flats', await p.evaluate(() => { const g = window.PPPEngrave.app.resolveSync(window.PPP.app.state.score).graph; return Math.abs(g.timeline.keys[0].fifths) >= 5; }));
      const r = await arrangeCopy(p, sv.id, 'beginner');
      const a = r.arrangement;
      ok('beginner: a lead sheet copy is made, with the relaxed plan\'s note recorded (levelNote "relaxed-plan")', r.refusal === null && !!a && a.recordingArrange === 'leadsheet' && a.levelNote === 'relaxed-plan', JSON.stringify(a));
      ok('and what the page says is the lead-sheet words (the key signature and the melody, not the left hand), not the old "many notes" line', r.says.some(s => s.indexOf(RELAXED_EN) > -1) && !r.says.some(s => s.indexOf(RELAXED_OLD) > -1), JSON.stringify(r.says));
      /* a lead-sheet copy that is "relaxed" with no key signature to blame: the words claim no cause (a tune in C major gets the note too) */
      const TOY = { notes: Array.from({ length: 12 }, (_, i) => ({ on: 0.5 + i * 0.25, off: 0.72 + i * 0.25, midi: [60, 62, 64, 65, 67, 69, 71, 72][i % 8], vel: 80 })) };   /* a C major scale in sixteenths */
      const st = await savedSong(browser, TOY);
      const pt = st.page;
      ok('the toy is in C major (no sharps or flats in the kept key)', await pt.evaluate(() => Math.max.apply(null, window.PPPEngrave.app.resolveSync(window.PPP.app.state.score).graph.timeline.keys.map(k => Math.abs(k.fifths)))) < 3);
      const rt = await arrangeCopy(pt, st.id, 'beginner');
      ok('a lead sheet copy is made and the relaxed plan\'s note is recorded (levelNote "relaxed-plan")', rt.refusal === null && !!rt.arrangement && rt.arrangement.recordingArrange === 'leadsheet' && rt.arrangement.levelNote === 'relaxed-plan', JSON.stringify(rt.arrangement));
      ok('and what the page says is the neutral sentence, not one that blames the key signature, the melody or the left hand', rt.says.some(s => s.indexOf(RELAXED_NEUTRAL) > -1) && !rt.says.some(s => s.indexOf(RELAXED_EN) > -1 || s.indexOf(RELAXED_OLD) > -1 || /key signature|left hand/.test(s)), JSON.stringify(rt.says));
      ok('the words by the number of sharps or flats: 0, 1, 2 the neutral sentence; 3 and more the key signature and the melody; a reduction copy the old words', await pt.evaluate((neutral, key, old) => {
        const A = window.PPP.app, ok3 = [0, 1, 2].every(n => A.levelNoteText(true, n) === neutral) && [3, 5, 7].every(n => A.levelNoteText(true, n) === key);
        return ok3 && A.levelNoteText(false, 6) === old && A.levelNoteText() === old;
      }, RELAXED_NEUTRAL, RELAXED_EN, RELAXED_OLD));
      ok('no page or console error', clean(pt), errs(pt));
      await pt.close();
      /* the same cover in reduce mode is refused by the arranger (UNREACHABLE: six sharps beat the beginner's ceiling) - the notice as before */
      await p.evaluate(() => { window.PPP.recordingArrange = 'reduce'; });
      const rr = await arrangeCopy(p, sv.id, 'beginner');
      ok('reduce: refused with UNREACHABLE, the existing notice, nothing saved (what the page does today)', rr.refusal === 'UNREACHABLE' && rr.notice && rr.newKeys.length === 0, JSON.stringify({ r: rr.refusal, k: rr.newKeys.length }));
      await p.evaluate(() => { window.PPP.recordingArrange = 'leadsheet'; });
      /* the lead sheet refuses too -> the reduction is refused as well: the notice names the reduction's reason, once */
      await p.evaluate(() => { const real = window.PPPRecLeadsheet; window.PPPRecLeadsheet = Object.assign({}, real, { prepare: () => ({ ok: false, reason: 'LEADSHEET_METRE', message: 'planted' }) }); });
      const rd = await arrangeCopy(p, sv.id, 'intermediate');
      ok('refused by the lead sheet and by the reduction (UNREACHABLE): the existing refusal notice, nothing saved', rd.refusal === 'UNREACHABLE' && rd.notice && rd.newKeys.length === 0, JSON.stringify({ r: rd.refusal, k: rd.newKeys.length }));
      ok('no page or console error', clean(p), errs(p));
      await p.close();
      /* in Korean */
      const sk = await savedSong(browser, COVERS.sc6, { locale: 'ko-KR' });
      const rk = await arrangeCopy(sk.page, sk.id, 'beginner');
      const koNote = CATALOG['ko-KR'][RELAXED_EN];
      ok('in Korean the note is the catalog\'s: 조표와 멜로디, 왼손이 아니라', !!koNote && /조표/.test(koNote) && /멜로디/.test(koNote) && /왼손이 아니라/.test(koNote) && rk.says.some(s => s.indexOf(koNote) > -1), JSON.stringify(rk.says));
      ok('and the composer line is Korean: PPP 한 손 단음 편곡 (리드 시트)', JSON.stringify(rk.slot).indexOf('PPP 한 손 단음 편곡 (리드 시트)') > -1);
      ok('no page or console error', clean(sk.page), errs(sk.page));
      await sk.page.close();
    }

    /* ------------------------------------------------------------------ the review screen */
    if (want('review')) {
      console.log('\n── the review screen\'s Apply arrangement: the chip, and the same two ways ──');
      const apply = async (page, level) => {
        await page.select('[data-arrangement-level]', level);
        await page.click('[data-apply-arrangement]');
        await page.waitForFunction(() => { const st = window.PPP.app.state; return !st.arrangementBusy && st.importSource && st.importSource.arrangement && st.importSource.arrangement.level; }, { timeout: 240000 });
        await sleep(600);
        return page.evaluate(() => { const S = window.PPP.app.state; return { arrangement: S.importSource.arrangement, status: S.arrangementStatus, notes: S.score.notes.filter(n => !n.rest).length, composer: S.score.composer }; });
      };
      const pr = await openPage(browser, { store: LEAD });
      await importHeard(pr, COVERS.sc0);
      await pr.waitForFunction(() => !!document.querySelector('[data-arrangement] [data-single-note-option]'), { timeout: 30000 });
      const cr = await pr.evaluate(() => { const b = document.querySelector('[data-recording-arrange-row="review"] [data-recording-arrange-option]'); const p = b && b.parentElement.querySelector('p'); return b ? { text: b.innerText.trim(), pressed: b.getAttribute('aria-pressed'), hint: p && p.innerText.trim() } : null; });
      ok('the review screen\'s arrangement panel has the chip, pressed, the same label and ON line', !!cr && cr.text === LABEL && cr.pressed === 'true' && cr.hint === ON_LINE, JSON.stringify(cr));
      const a1 = await apply(pr, 'beginner');
      ok('Apply arrangement at beginner: made from the lead sheet, the copy says so', a1.arrangement.engine === 'ppp.g9-single' && a1.arrangement.recordingArrange === 'leadsheet' && !a1.arrangement.leadsheetRefusal && a1.notes > 150, JSON.stringify(a1.arrangement));
      const rhash = page => page.evaluate(() => { const S = window.PPP.app.state; return JSON.stringify(S.score.notes.map(n => [n.m, n.b, n.midi, Math.round(n.dur * 1000), n.rest ? 1 : 0, n.hand, n.staff, n.voice, n.tieStart ? 1 : 0, n.tieStop ? 1 : 0])); });
      const leadHash = await rhash(pr);
      await pr.click('[data-recording-arrange-row="review"] [data-recording-arrange-option]'); await sleep(300);
      ok('the chip pressed there is reduce for the whole page (the same setting as the Song Arranger\'s)', (await pr.evaluate(() => window.PPP.recordingArrange)) === 'reduce' && (await pr.evaluate(() => document.querySelector('[data-recording-arrange-row="review"] [data-recording-arrange-option]').getAttribute('aria-pressed'))) === 'false');
      const a2 = await apply(pr, 'beginner');
      ok('Apply arrangement again: the reduction, no mark', a2.arrangement.engine === 'ppp.g9-single' && a2.arrangement.recordingArrange === undefined && a2.arrangement.leadsheet === undefined, JSON.stringify(a2.arrangement));
      ok('and it is another copy than the lead sheet\'s', (await rhash(pr)) !== leadHash);
      /* the review screen's Rewrite (the rhythm controls) re-applies the stored arrangement as the plan of a new request: the copy that was made from the lead sheet must not decide it, the chip does */
      const redHash = await rhash(pr);
      const chipRow = '[data-recording-arrange-row="review"] [data-recording-arrange-option]';
      const rewrite = async () => {
        await says(pr);
        const n0 = await pr.evaluate(() => window.__says.length);
        await pr.evaluate(() => document.querySelector('[data-lock-rewrite]').click());
        await pr.waitForFunction(n => !window.PPP.app.state.arrangementBusy && window.__says.length > n, { timeout: 240000 }, n0);
        await sleep(600);
        return pr.evaluate(() => { const S = window.PPP.app.state; return { arrangement: S.importSource.arrangement, notes: S.score.notes.filter(n => !n.rest).length }; });
      };
      await pr.click(chipRow); await sleep(300);
      const a2b = await apply(pr, 'beginner');
      ok('the chip on again and Apply arrangement: the lead sheet copy again, the first copy note for note', a2b.arrangement.recordingArrange === 'leadsheet' && (await rhash(pr)) === leadHash, JSON.stringify(a2b.arrangement));
      await pr.click(chipRow); await sleep(300);
      ok('the chip turned off after that copy', (await pr.evaluate(() => window.PPP.recordingArrange)) === 'reduce');
      const w1 = await rewrite();
      ok('Rewrite with the chip off, on a lead sheet copy: the reduction copy (no lead sheet record in its source), the very copy Apply arrangement makes with the chip off - not the lead sheet again', w1.arrangement.engine === 'ppp.g9-single' && w1.arrangement.recordingArrange === undefined && w1.arrangement.leadsheet === undefined && w1.arrangement.leadsheetRefusal === undefined && (await rhash(pr)) === redHash && (await rhash(pr)) !== leadHash, JSON.stringify(w1.arrangement));
      await pr.click(chipRow); await sleep(300);
      const w2 = await rewrite();
      ok('and Rewrite with the chip on, on that reduction copy: the lead sheet copy (the old copy decides nothing either way)', w2.arrangement.recordingArrange === 'leadsheet' && (await rhash(pr)) === leadHash, JSON.stringify(w2.arrangement));
      await pr.click(chipRow); await sleep(300);   /* off again for what follows (the original level, the Korean chip) */
      /* "Original transcription" has no chip */
      await pr.select('[data-arrangement-level]', 'original'); await sleep(300);
      ok('at "Original transcription" the chip is not shown (the lead sheet is for the easier levels)', await pr.evaluate(() => !document.querySelector('[data-recording-arrange-row="review"]')));
      ok('no page or console error', clean(pr), errs(pr));
      await pr.close();
      /* the review screen of the six-sharp cover: the relaxed words */
      const ps = await openPage(browser, { store: LEAD });
      await importHeard(ps, COVERS.sc6);
      await ps.waitForFunction(() => !!document.querySelector('[data-arrangement] [data-single-note-option]'), { timeout: 30000 });
      const a3 = await apply(ps, 'beginner');
      ok('six sharps, Apply arrangement at beginner: made from the lead sheet, and the status line under the panel is the lead-sheet words', a3.arrangement.recordingArrange === 'leadsheet' && a3.arrangement.levelNote === 'relaxed-plan' && a3.status === RELAXED_EN, JSON.stringify({ a: a3.arrangement, s: a3.status }));
      ok('no page or console error', clean(ps), errs(ps));
      await ps.close();
      /* the lead sheet cannot be used on the review screen either: the copy is the reduction's, marked, and the status line under the panel and the message say so (once) */
      const pf2 = await openPage(browser, { store: LEAD });
      await importHeard(pf2, COVERS.sc0);
      await pf2.waitForFunction(() => !!document.querySelector('[data-arrangement] [data-single-note-option]'), { timeout: 30000 });
      await pf2.evaluate(() => window.PPP.loadLeadsheetModule());
      await pf2.evaluate(() => { const real = window.PPPRecLeadsheet; window.PPPRecLeadsheet = Object.assign({}, real, { prepare: () => ({ ok: false, reason: 'LEADSHEET_METRE', message: 'planted' }) }); });
      await says(pf2);
      const a5 = await apply(pf2, 'beginner');
      const said5 = await pf2.evaluate(() => window.__says.slice());
      ok('the lead sheet refuses on the review screen: Apply arrangement makes the reduction copy, marked reduce with the reason', a5.arrangement.engine === 'ppp.g9-single' && a5.arrangement.recordingArrange === 'reduce' && a5.arrangement.leadsheetRefusal === 'LEADSHEET_METRE' && !a5.arrangement.leadsheet, JSON.stringify(a5.arrangement));
      ok('and the status line under the panel begins with the notice (it stays until the level is changed), and the message carries it once', a5.status.indexOf(FELL_EN) === 0 && told(said5) === 1, JSON.stringify({ s: a5.status, m: said5 }));
      await pf2.select('[data-arrangement-level]', 'intermediate'); await sleep(300);
      ok('choosing another level takes the notice off the screen, as it does the other notes', await pf2.evaluate(() => window.PPP.app.state.arrangementStatus === ''));
      ok('no page or console error', clean(pf2), errs(pf2));
      await pf2.close();
    }

    /* ------------------------------------------------------------------ what the lead sheet does not touch */
    if (want('others')) {
      console.log('\n── "Original transcription", a catalogue piece: no chip, and the copy is the same either way ──');
      const sv = await savedSong(browser, COVERS.sc0);
      const p = sv.page;
      await toSongs(p);
      await p.evaluate(i => document.querySelector('[data-arrange-song="' + i + '"]').click(), sv.id); await sleep(500);
      ok('Song Arranger on a recording at intermediate: the chip is there', !!(await chip(p)));
      await p.select('[data-song-arrange-level]', 'original'); await sleep(300);
      ok('at "Original transcription" the chip is not shown', (await chip(p)) === null);
      await p.evaluate(() => window.PPP.app.closeSongArranger());
      const ro = await arrangeCopy(p, sv.id, 'original');
      ok('the "Original transcription" copy is made by the old arranger as ever: not the one-note engine, no lead sheet mark', ro.newKeys.length === 1 && !!ro.arrangement && ro.arrangement.engine !== 'ppp.g9-single' && ro.arrangement.recordingArrange === undefined && ro.arrangement.leadsheet === undefined, JSON.stringify(ro.arrangement));
      /* a catalogue piece */
      await toSongs(p);
      await p.evaluate(() => document.querySelector('[data-add-card]').click()); await sleep(300);
      await (await p.$('input[type=file][data-add-file]')).uploadFile(HYMN);
      await p.waitForFunction(() => window.PPP.app.state.score && window.PPP.app.state.score.id !== 'demo' && window.PPP.app.state.songId && window.PPP.app.state.importSource && window.PPP.app.state.importSource.name, { timeout: 30000 });
      await sleep(1500);
      const hymnId = await p.evaluate(() => window.PPP.app.state.songId);
      await toSongs(p);
      await p.evaluate(i => document.querySelector('[data-arrange-song="' + i + '"]').click(), hymnId); await sleep(500);
      ok('Song Arranger on a catalogue hymn: no lead-sheet chip', (await chip(p)) === null);
      await p.evaluate(() => window.PPP.app.closeSongArranger());
      const rh = await arrangeCopy(p, hymnId, 'beginner');
      const wantH = await mainHash(p, hymnId, 'beginner');
      ok('and its copy is exactly main\'s copy (the default mode changes nothing for a printed score), with no mark', rh.newKeys.length === 1 && wantH.ok && (await copyHash(p, rh.newKeys[0])) === wantH.hash && !!rh.arrangement && rh.arrangement.recordingArrange === undefined && rh.arrangement.leadsheet === undefined, JSON.stringify(rh.arrangement));
      ok('no page or console error', clean(p), errs(p));
      await p.close();
      /* a "Full song" import is an arrangement already (written by the classic method): its review screen has no lead-sheet chip, and Apply arrangement does not ask for the lead sheet */
      const pf = await openPage(browser, { store: LEAD });
      await pf.evaluate(() => window.PPP.app.setState({ transcriptionMode: 'arrange' }));
      await importHeard(pf, COVERS.sc0);
      await sleep(600);
      ok('the review screen of a Full song import has the one-note chip but no lead-sheet chip', await pf.evaluate(() => !!document.querySelector('[data-arrangement] [data-single-note-option]') && !document.querySelector('[data-recording-arrange-option]')) && (await pf.evaluate(() => window.PPP.app.state.importSource.taskMode)) === 'piano-arrangement');
      await pf.select('[data-arrangement-level]', 'beginner');
      await pf.click('[data-apply-arrangement]');
      await pf.waitForFunction(() => { const st = window.PPP.app.state; return !st.arrangementBusy && st.importSource && st.importSource.arrangement && st.importSource.arrangement.level; }, { timeout: 240000 });
      ok('and Apply arrangement there is made without the lead sheet: nothing of rec/leadsheet.js is asked for, no mark in the copy\'s source', !pf.__rec.requests.some(u => /leadsheet/.test(u)) && (await pf.evaluate(() => { const a = window.PPP.app.state.importSource.arrangement; return a.recordingArrange === undefined && a.leadsheet === undefined && a.leadsheetRefusal === undefined; })));
      ok('no page or console error', clean(pf), errs(pf));
      await pf.close();
    }

    /* ------------------------------------------------------------------ a recording whose arrangement was applied on the review screen: no chip */
    if (want('applied')) {
      console.log('\n── Apply arrangement on the review screen, Accept, reload: the song is no lead sheet song, so the Song Arranger shows no chip ──');
      const p = await openPage(browser, { store: LEAD });
      await addChecker(p);
      await importHeard(p, COVERS.sc0);
      const s1 = await stateOf(p);
      await p.waitForFunction(() => !!document.querySelector('[data-arrangement] [data-single-note-option]'), { timeout: 30000 });
      await p.select('[data-arrangement-level]', 'beginner');
      await p.click('[data-apply-arrangement]');
      await p.waitForFunction(() => { const st = window.PPP.app.state; return !st.arrangementBusy && st.importSource && st.importSource.arrangement && st.importSource.arrangement.level; }, { timeout: 240000 });
      await sleep(600);
      ok('the arrangement applied on the review screen is a lead sheet copy (what the song is kept as when it is accepted)', await p.evaluate(() => window.PPP.app.state.importSource.arrangement.recordingArrange === 'leadsheet'));
      await acceptAny(p); await sleep(2000);
      const s2 = await (async () => { await importHeard(p, COVERS.sc0); const st = await stateOf(p); await acceptAny(p); await sleep(2000); return st; })();   /* a second song of the same recording, accepted as it is */
      ok('two songs, one applied and one as heard', s1.songId !== s2.songId);
      await p.reload({ waitUntil: 'networkidle2' });
      await p.waitForFunction(() => !!(window.PPP && window.PPP.app));
      await sleep(800);
      p.__mark = p.__rec.requests.length;
      await addChecker(p);
      const open = async id => {
        await p.evaluate(() => { try { window.PPP.app.closeSongArranger(); } catch (e) { /* none open */ } });
        await toSongs(p);
        await p.waitForSelector('[data-arrange-song="' + id + '"]', { timeout: 30000 });
        await p.evaluate(i => document.querySelector('[data-arrange-song="' + i + '"]').click(), id);
        await p.waitForFunction(() => { const d = window.PPP.app.state.songArrange; return !!d && d.leadGraph !== null; }, { timeout: 30000 });   /* the page has looked at the song's graph */
        await sleep(300);
        return p.evaluate(() => ({ graph: window.PPP.app.state.songArrange.leadGraph, chip: !!document.querySelector('[data-song-arranger] [data-recording-arrange-option]') }));
      };
      const applied = await open(s1.songId);
      const graphOf = id => p.evaluate(async i => { const r = await window.PPPEngrave.app.resolve(window.PPP.app.scoreForArrangement(i), { key: i }); return ((r.graph.provenance || {}).sources || []).map(x => x.kind); }, id);
      ok('the applied song\'s kept graph is the arrangement\'s: no audio-score source (the reason the lead sheet cannot be made for it)', !(await graphOf(s1.songId)).includes('audio-score'));
      ok('its Song Arranger has no lead-sheet chip (the default mode is the lead sheet; the chip would say on and Create would not make one)', applied.graph === false && applied.chip === false, JSON.stringify(applied));
      ok('and nothing of the lead sheet was asked for: no rec/leadsheet.js request opening it', !recSince(p).some(u => /leadsheet/.test(u)), recSince(p).join(' '));
      const ra = await arrangeCopy(p, s1.songId, 'beginner');
      const wantA = await mainHash(p, s1.songId, 'beginner');
      ok('Create there makes the reduction\'s copy as ever (main\'s, note for note) and claims nothing of the lead sheet: no recordingArrange, no leadsheet, no refusal in its source, no notice', ra.newKeys.length === 1 && wantA.ok && (await copyHash(p, ra.newKeys[0])) === wantA.hash
        && !!ra.arrangement && ra.arrangement.recordingArrange === undefined && ra.arrangement.leadsheet === undefined && ra.arrangement.leadsheetRefusal === undefined && told(ra.says) === 0, JSON.stringify(ra.arrangement));
      const plain = await open(s2.songId);
      ok('the song accepted as heard keeps its chip: its graph is the recording\'s', plain.graph === true && plain.chip === true, JSON.stringify(plain));
      ok('and its lead sheet files are asked for when the Arranger opens it (not before)', await p.waitForFunction(() => !!window.PPPRecLeadsheet, { timeout: 60000 }).then(() => true).catch(() => false));
      ok('no page or console error', clean(p), errs(p));
      await p.close();
    }

    /* ------------------------------------------------------------------ Korean first, 400 px */
    if (want('korean')) {
      console.log('\n── Korean first: the chip and its lines, in 400 px ──');
      const sk = await savedSong(browser, COVERS.sc0, { locale: 'ko-KR', width: 400, height: 900 });
      const p = sk.page;
      await toSongs(p);
      await p.evaluate(i => document.querySelector('[data-arrange-song="' + i + '"]').click(), sk.id); await sleep(700);
      const c = await chip(p);
      const ko = CATALOG['ko-KR'];
      ok('ko-KR: the chip reads "리드 시트로 편곡", pressed, with its line, inside 400 px and no sideways scroll', !!c && c.text === '리드 시트로 편곡' && c.text === ko[LABEL] && c.hint === ko[ON_LINE] && c.pressed === 'true' && c.inView && c.noSideScroll, JSON.stringify(c));
      ok('the Korean ON line says what the lead sheet is ("멜로디와 코드") and how to go back ("끄면")', /멜로디와 코드/.test(c.hint) && /끄면/.test(c.hint));
      await p.click('[data-song-arranger] [data-recording-arrange-option]'); await sleep(300);
      const c2 = await chip(p);
      ok('ko-KR: pressed once it is OFF, with the OFF line', !!c2 && c2.pressed === 'false' && c2.hint === ko[OFF_LINE] && /켜면/.test(c2.hint), JSON.stringify(c2));
      for (const loc of ['ja-JP', 'zh-CN']) {
        ok(loc + ': the chip, both lines, the composer line and the relaxed note are translated (not the English), with no left-over placeholder', [LABEL, ON_LINE, OFF_LINE, 'PPP one-note-per-hand arrangement (lead sheet)', RELAXED_EN].every(k => !!CATALOG[loc][k] && CATALOG[loc][k] !== k));
      }
      ok('no page or console error', clean(p), errs(p));
      await p.close();
    }
  } catch (e) {
    ok('the suite ran to the end', false, e && e.stack || String(e));
  } finally {
    await browser.close();
    await srv.close();
    try { fs.unlinkSync(L.WAV); } catch (e) { /* the temp file */ }
  }
  console.log(errors.length ? '\n' + errors.length + ' FAILED' : '\nall passed');
  process.exit(errors.length ? 1 : 0);
})();
