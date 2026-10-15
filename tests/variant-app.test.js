/* ============================================================================
   PPP.variant (G11c-1): "Make this passage easier" - an easier passage as a SEPARATE COPY, in the real page
   docs/GOALS/G11_ADAPTIVE_PRACTICE.md section 8, decision U7; practice/variant.js (G11c-0) behind the page's own glue

   Real pages (headless Chrome against the tree's server). The teacher's flow is driven by clicking what a person clicks: add a piece, Loop a passage, the bars, "Make this passage easier",
   "Make an easier version", the before and after, "Practice this version", a practice lap on a (fake) keyboard, "Practice this passage as written". Sections (VA_ONLY=a,b runs some):
     switch    PPP.variant: default 'off', ?variant=, the remembered choice, garbage, a throwing storage, the setter (PPP.recording's idiom); 'off' is the page as it was (no button, no request for
               practice/variant.js, the methods do nothing); Settings > Labs turns it on, and the button is there
     flow      the teacher's flow end to end on a hymn: the panel, the busy state, the preview (before and after drawn, what changed), accept: a NEW song in My Songs with the title
               "<song> · 3-6 measures easier", source.variantOf, opened on the same bars with the hand chosen, practised on a fake keyboard (its own progress), back to the original on the same bars
     original  the original is never touched: its saved score, its card and its progress are byte for byte what they were; the copy keeps every bar outside the passage as it was
     determ    the same request is the same copy: the same song id and the same music hash on another device (a fresh browser context); asking again opens the copy that is there (one copy, not two)
     refusal   a passage that is already easy, one that cannot be made easier, a piece with no easier version, a one-staff piece: the sentence, the one-tap alternatives (70 % tempo, the harder
               hand, a shorter loop) and that nothing was saved
     levels    a piece of a higher stage offers "as easy as possible" as another choice and makes a different copy
     sharing   a variant of a YouTube-derived song stays derived (the flag, also when the original is gone), is not posted to Shared Scores, and goes through the backup as any song
     i18n      the panel in Korean, Japanese and Chinese: the words are the catalogs', no English left
     budget    at CPU 4x: 16 bars of a hymn - the splice, the score and the preview in <= 300 ms, the arranger is the page's own sliced run (and was started while the person chose)
     offline   after the files are in, the flow asks for nothing from a server and no language model is involved
   Needs puppeteer; 127.0.0.1:8777 (tests/engrave/tools/with-port.js rewrites it; tests/practice/run-suites.js does).
   ========================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const { preparePage } = require('./boot');

const REPO = path.resolve(__dirname, '..');
const BASE = 'http://127.0.0.1:8777/Piano%20Coach%20App.dc.html';
const KEY = 'ppp.variant.v1';
const errors = [];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ok = (name, cond, detail) => {
  console.log((cond ? '  ✓ ' : '  ✗ ') + name + (detail ? ' — ' + detail : ''));
  if (!cond) errors.push(name + (detail ? ' — ' + detail : ''));
};
const ONLY = (process.env.VA_ONLY || '').split(',').filter(Boolean);
const want = name => !ONLY.length || ONLY.indexOf(name) >= 0;
const F = rel => path.join(REPO, rel);
const HYMN = F('catalog/hymns/christ-arose.musicxml');           /* 20 bars, 301 notes: a real easier passage in every window */
const HELPER = /:8788\/|\/helper(\/|$|\?)/;

/* in the page, before its scripts: a keyboard that is there, and nothing played yet */
function installFakeMidi() {
  const listeners = [];
  const input = {
    id: 'fake-1', name: 'Test Piano', manufacturer: 'PPP', state: 'connected', type: 'input',
    addEventListener: (t, fn) => { if (t === 'midimessage') listeners.push(fn); },
    removeEventListener: (t, fn) => { const i = listeners.indexOf(fn); if (i > -1) listeners.splice(i, 1); },
    set onmidimessage(fn) { if (fn) listeners.push(fn); },
    get onmidimessage() { return listeners[0] || null; }
  };
  navigator.requestMIDIAccess = () => Promise.resolve({ inputs: new Map([['fake-1', input]]), outputs: new Map(), addEventListener: () => {}, onstatechange: null });
  const send = (status, midi, vel) => {
    const d = new Uint8Array([status, midi, vel]);
    listeners.slice().forEach(fn => fn({ data: d, receivedTime: performance.now() }));
  };
  window.__press = m => send(0x90, m, 80);
  window.__release = m => send(0x80, m, 0);
}

/* o.query, o.init [[fn, arg]], o.locale, o.midi, o.cpu, o.delay {re, ms}, o.block re */
async function open(browser, o) {
  o = o || {};
  const ctx = o.ctx || await browser.createBrowserContext();
  const page = await ctx.newPage();
  const probe = { requests: [], errors: [], consoleErrors: [], longTasks: [] };
  await preparePage(page);
  if (o.locale) await page.evaluateOnNewDocument(loc => { try { localStorage.setItem('ppp-locale', loc); } catch (e) { /* none */ } }, o.locale);
  if (o.midi) await page.evaluateOnNewDocument(installFakeMidi);
  for (const [fn, arg] of o.init || []) await page.evaluateOnNewDocument(fn, arg);
  await page.setRequestInterception(true);
  page.on('request', req => {
    const u = req.url();
    probe.requests.push(u.replace(/^https?:\/\/[^/]+/, ''));
    if (HELPER.test(u)) return req.abort();
    if (o.block && o.block.test(u)) return req.abort();
    if (o.delay && o.delay.re.test(u)) return void setTimeout(() => { try { req.continue(); } catch (e) { /* closed */ } }, o.delay.ms);
    req.continue();
  });
  page.on('pageerror', e => probe.errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !HELPER.test(JSON.stringify(m.location())) && !/Failed to load resource/.test(m.text())) probe.consoleErrors.push(m.text()); });
  if (o.cpu) { const cdp = await page.target().createCDPSession(); await cdp.send('Emulation.setCPUThrottlingRate', { rate: o.cpu }); }
  await page.setViewport({ width: o.width || 1100, height: o.height || 1000 });
  await page.goto(BASE + (o.query || ''), { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => window.PPP && window.PPP.app && window.PPP.PianoScore, { timeout: 60000 });
  await sleep(o.settle || 1000);
  return { ctx, page, probe, close: async () => { try { await page.close(); } catch (e) { /* gone */ } if (!o.ctx) await ctx.close(); } };
}

/* add a file of the repository as a song, the way a person does: My Songs, the add card, the file chooser */
async function addSong(page, file) {
  await page.evaluate(() => window.PPP.app.setState({ screen: 'songs' }));
  await sleep(300);
  await page.evaluate(() => document.querySelector('[data-add-card]').click());
  await sleep(300);
  await (await page.$('input[type=file][data-add-file]')).uploadFile(file);
  await page.waitForFunction(() => { const S = window.PPP.app.state; return S.score && S.score.id !== 'demo' && S.songId && S.songId !== 'demo' && S.screen !== 'analysis-pending' && S.analysis === 'done'; }, { timeout: 60000 });
  await sleep(1500);
  return page.evaluate(() => window.PPP.app.state.songId);
}
/* the Loop panel on bars a..b (numbers): the practice page, Loop a passage, the bars picked */
async function toLoop(page, a, b) {
  await page.evaluate((a, b) => {
    const A = window.PPP.app;
    A.setState({ screen: 'player', loop: true, practiceMode: 'practice' });
    A.setLoop(a, b);
  }, a, b);
  await sleep(500);
}
const panel = page => page.evaluate(() => {
  const p = document.querySelector('[data-variant-panel]');
  if (!p) return null;
  return { phase: p.getAttribute('data-phase'), text: p.innerText.replace(/\s+/g, ' ').trim(),
    reason: (p.querySelector('[data-variant-refusal]') || { getAttribute: () => null }).getAttribute('data-reason'),
    before: !!p.querySelector('[data-variant-before] svg'), after: !!p.querySelector('[data-variant-after] svg'),
    alts: [...p.querySelectorAll('[data-variant-alt]')].map(b => b.getAttribute('data-variant-alt')),
    lines: [...p.querySelectorAll('[data-variant-lines] li')].map(l => l.innerText.trim()),
    levels: [...p.querySelectorAll('[data-variant-level]')].map(b => b.getAttribute('data-variant-level')) };
});
const click = (page, sel) => page.evaluate(s => { const e = document.querySelector(s); if (e) e.click(); return !!e; }, sel);
async function waitPhase(page, phases, ms) {
  const t0 = Date.now();
  for (;;) {
    const p = await panel(page);
    if (p && phases.indexOf(p.phase) > -1) return p;
    if (Date.now() - t0 > (ms || 90000)) return p;
    await sleep(150);
  }
}
/* press the button, choose, make: -> the panel when the answer is there */
async function makeEasier(page, o) {
  o = o || {};
  if (!(await panel(page))) { await click(page, '[data-variant-open]'); await sleep(250); }
  if (o.level) await click(page, '[data-variant-level="' + o.level + '"]');
  if (o.hands) await click(page, '[data-variant-hand="' + o.hands + '"]');
  await click(page, '[data-variant-make]');
  return waitPhase(page, ['preview', 'refused', 'exists'], o.ms);
}
const state = (page, fn, arg) => page.evaluate(fn, arg);
const slotText = (page, id) => page.evaluate(i => localStorage.getItem('ppp.song.v1.' + i), id);
/* a saved slot's score, as what it says: unpacked (the packer's key order depends on which fields a score had when it was last written, which is no change to the song), keys sorted, nulls dropped */
const canonScore = (page, id) => page.evaluate(i => {
  const slot = JSON.parse(localStorage.getItem('ppp.song.v1.' + i));
  const norm = v => {
    if (Array.isArray(v)) return v.map(norm);
    if (v && typeof v === 'object') { const o = {}; Object.keys(v).sort().forEach(k => { if (k !== '_byNumber' && v[k] !== null && v[k] !== undefined) o[k] = norm(v[k]); }); return o; }
    return v;
  };
  return JSON.stringify(norm(PPP.unpackScore(slot.score)));
}, id);
const notesOf = page => page.evaluate(() => window.PPP.app.state.score.notes.filter(n => !n.rest).map(n => [n.m, Math.round(n.b * 1000), Math.round(n.dur * 1000), n.midi, n.hand, n.staff || 1].join(',')));

/* a real clock lap on a fake keyboard (tests/learner-log.test.js realLapInPage): press the due notes, wait until the lap is counted, stop */
function realLapInPage(o) {
  return (async () => {
    const A = window.PPP.app, sl = ms => new Promise(r => setTimeout(r, ms));
    A.setState({ toggles: Object.assign({}, A.state.toggles, { follow: false }), practiceMode: 'practice', loop: true, tempo: o.tempo || 200, hands: o.hands || 'both' });
    A.setLoop(o.from, o.to);
    await sl(300);
    const l0 = A.state.laps;
    A.togglePlay();
    await sl(250);
    const perf = A._perf, now = performance.now();
    if (perf && perf.run) {
      perf.expected.forEach((x, i) => {
        if (i % 5 === 4) return;
        setTimeout(() => { window.__press(x.midi); setTimeout(() => window.__release(x.midi), 60); }, Math.max(0, x.tMs - now) + (i % 3) * 20 - 20);
      });
    }
    const t0 = performance.now();
    while (A.state.laps === l0 && performance.now() - t0 < 20000) await sl(100);
    const counted = A.state.laps > l0;
    if (A.state.playing) A.togglePlay();
    await sl(400);
    return { counted: counted, live: A.liveMidi() };
  })();
}

/* ---------------------------------------------------------------- 1. the switch */
async function switchSection(browser) {
  console.log('\n── PPP.variant: off by default, the same idiom as PPP.recording ──');
  const stored = v => [a => { localStorage.setItem(a[0], a[1]); }, [KEY, v]];
  const mode = async (query, init) => {
    const p = await open(browser, { query: query, init: init || [] });
    const r = await p.page.evaluate(() => ({ variant: PPP.variant, mod: typeof window.PPPPracticeVariant, key: (() => { try { return localStorage.getItem('ppp.variant.v1'); } catch (e) { return 'throws'; } })() }));
    r.requests = p.probe.requests.filter(u => /practice\/variant\.js/.test(u)).length;
    r.errors = p.probe.errors;
    await p.close();
    return r;
  };
  const a = await mode('');
  ok('the default is off, with no remembered choice and no request for practice/variant.js', a.variant === 'off' && a.key === null && a.mod === 'undefined' && a.requests === 0, JSON.stringify(a));
  const b = await mode('?variant=on');
  ok('?variant=on turns it on for this visit and is not remembered', b.variant === 'on' && b.key === null, JSON.stringify(b));
  const c = await mode('', [stored('on')]);
  ok('a remembered on is on', c.variant === 'on');
  const junk = [await mode('', [stored('yes')]), await mode('', [stored('ON')]), await mode('?variant=junk'), await mode('?variant=On')];
  ok('anything else (a typo, another word, the wrong case) is no choice, and the default is off', junk.every(x => x.variant === 'off'), junk.map(x => x.variant).join(','));
  const d = await mode('?variant=off', [stored('on')]);
  ok('the address beats the remembered choice', d.variant === 'off');
  const e = await mode('', [[a2 => {
    const get = Storage.prototype.getItem;
    Storage.prototype.getItem = function (k) { if (k === a2[0]) throw new DOMException('denied', 'SecurityError'); return get.call(this, k); };
  }, [KEY]]]);
  ok('a storage that throws gives the default', e.variant === 'off' && e.errors.length === 0, JSON.stringify(e));

  /* the setter, and the page when it is off */
  const p = await open(browser, {});
  const s = await p.page.evaluate(() => {
    const out = {};
    PPP.variant = 'on'; out.on = [PPP.variant, localStorage.getItem('ppp.variant.v1')];
    PPP.variant = 'bogus'; out.bogus = [PPP.variant, localStorage.getItem('ppp.variant.v1')];
    PPP.variant = 'off';
    return out;
  });
  ok('the setter remembers a choice; a value that is no choice puts the default back and forgets the remembered one', s.on[0] === 'on' && s.on[1] === 'on' && s.bogus[0] === 'off' && s.bogus[1] === null, JSON.stringify(s));
  await addSong(p.page, HYMN);
  await toLoop(p.page, 3, 6);
  const off = await p.page.evaluate(() => ({ button: !!document.querySelector('[data-variant-open]'), row: !!document.querySelector('[data-variant-row]') }));
  ok('while it is off the Loop panel has no button and no row', !off.button && !off.row, JSON.stringify(off));
  const idle = await p.page.evaluate(async () => {
    const A = PPP.app;
    A.openVariantPanel();
    await new Promise(r => setTimeout(r, 300));
    const a = A.state.variantUi;
    A.makeVariant();
    await new Promise(r => setTimeout(r, 300));
    return { ui: a, after: A.state.variantUi, mod: typeof window.PPPPracticeVariant };
  });
  ok('and the methods do nothing: no panel, nothing made, no module', idle.ui === null && idle.after === null && idle.mod === 'undefined', JSON.stringify(idle));
  ok('and nothing asked for practice/variant.js or the notation checker', p.probe.requests.filter(u => /practice\/variant\.js|notation-check/.test(u)).length === 0);

  /* Settings > Labs */
  await p.page.evaluate(() => PPP.app.setState({ screen: 'settings' }));
  await sleep(500);
  const labs = await p.page.evaluate(() => ({ btn: !!document.querySelector('[data-setting="variant"]'), text: document.body.innerText.indexOf('Labs') > -1 && document.body.innerText.indexOf('Make a passage easier') > -1 }));
  ok('Settings has a Labs group with the row "Make a passage easier"', labs.btn && labs.text, JSON.stringify(labs));
  await click(p.page, '[data-setting="variant"]');
  await sleep(300);
  const turned = await p.page.evaluate(() => [PPP.variant, localStorage.getItem('ppp.variant.v1')]);
  ok('its switch turns PPP.variant on, and remembers it', turned[0] === 'on' && turned[1] === 'on', JSON.stringify(turned));
  await toLoop(p.page, 3, 6);
  const onNow = await p.page.evaluate(() => { const b = document.querySelector('[data-variant-open]'); return b ? b.innerText.trim() : null; });
  ok('and the Loop panel has the button: "Make this passage easier"', onNow === 'Make this passage easier', String(onNow));
  await click(p.page, '[data-setting="variant"]');
  await p.page.evaluate(() => PPP.app.setState({ screen: 'settings' }));
  await sleep(300);
  await click(p.page, '[data-setting="variant"]');
  await sleep(200);
  ok('pressed again it is off again', (await p.page.evaluate(() => PPP.variant)) === 'off');
  ok('no page error', p.probe.errors.length === 0, p.probe.errors.join(' | '));
  await p.close();
}

/* ---------------------------------------------------------------- 2. the teacher's flow, the original, the copy */
async function flowSection(browser) {
  console.log('\n── the teacher\'s flow: open a piece, loop 3-6, make it easier, preview, accept, practise, back ──');
  const p = await open(browser, { query: '?variant=on', midi: true });
  const songId = await addSong(p.page, HYMN);
  const before = await p.page.evaluate(id => {
    const A = PPP.app, lib = A.libraryRead();
    return { id: id, title: A.state.score.title, composer: A.state.score.composer, bars: A.state.score.measures.length, tempo: A.state.score.tempo, cards: lib.songs.length,
      notes: A.state.score.notes.filter(n => !n.rest).map(n => [n.m, Math.round(n.b * 1000), Math.round(n.dur * 1000), n.midi, n.hand, n.staff || 1].join(',')) };
  }, songId);
  /* the original has been practised: a lap on the (fake) keyboard, so that "its progress is its own" is something a copy could have inherited */
  await p.page.evaluate(() => PPP.app.connectMidi());
  await sleep(1200);
  const lap0 = await p.page.evaluate(realLapInPage, { from: 1, to: 2, tempo: 200, hands: 'both' });
  await p.page.evaluate(() => PPP.app.saveNow());
  const prog0 = await p.page.evaluate(() => ({ runs: PPP.app.state.history.runs.length, bars: Object.keys(PPP.app.state.history.byMeasure).sort().join(',') }));
  ok('the original has been practised on the keyboard (a lap on bars 1-2 is in its history)', lap0.counted && prog0.runs >= 1 && prog0.bars === '1,2', JSON.stringify([lap0, prog0]));
  const slot0 = await slotText(p.page, songId);
  const canon0 = await canonScore(p.page, songId);
  const card0 = await p.page.evaluate(id => JSON.stringify(PPP.app.libraryRead().songs.find(s => s.id === id)), songId);
  const hist0 = JSON.stringify(JSON.parse(slot0).history);
  await toLoop(p.page, 3, 6);

  /* the button, then the panel */
  const btn = await p.page.evaluate(() => { const b = document.querySelector('[data-variant-open]'); return b ? { text: b.innerText.trim(), title: b.getAttribute('title') } : null; });
  ok('the Loop panel has the button "Make this passage easier", with what it does in its title', !!btn && btn.text === 'Make this passage easier' && /separate, easier copy/.test(btn.title || ''), JSON.stringify(btn));
  await click(p.page, '[data-variant-open]');
  await sleep(400);
  const choose = await panel(p.page);
  ok('pressing it opens the panel on the bars of the loop, with the hand to practise and the one button', !!choose && choose.phase === 'choose' && /Make measures 3–6 easier/.test(choose.text) && /Hand to practice/.test(choose.text) && /Make an easier version/.test(choose.text), choose && choose.text);
  await click(p.page, '[data-variant-hand="left"]');
  await sleep(100);
  const lib0 = await p.page.evaluate(() => PPP.app.libraryRead().songs.length);
  await click(p.page, '[data-variant-make]');
  const busy = await panel(p.page);
  ok('"Make an easier version" shows a busy state while it works (or has the answer already)', !!busy && (busy.phase === 'busy' || busy.phase === 'preview'), busy && busy.phase);
  const pv = await waitPhase(p.page, ['preview', 'refused'], 90000);
  ok('the answer is a preview: the bars before and after drawn side by side', !!pv && pv.phase === 'preview' && pv.before && pv.after, pv && pv.phase + ' ' + pv.text);
  ok('and it says what changed: notes, hands, the tune stays as written', !!pv && pv.lines.some(l => /^Notes in these bars: \d+ → \d+$/.test(l)) && pv.lines.some(l => /The tune stays as written/.test(l)) && pv.lines.some(l => /Right hand:|Left hand:/.test(l)), pv && JSON.stringify(pv.lines));
  const ui = await p.page.evaluate(() => { const u = PPP.app.state.variantUi; return { ms: u.ms, stats: u.stats, level: u.level, copyId: u.copyId }; });
  ok('the line "The tune stays as written" is there exactly when every attack of the original keeps its highest note', pv.lines.some(l => /The tune stays as written/.test(l)) === ui.stats.tuneKept && ui.stats.tuneKept === true, JSON.stringify(ui.stats.tuneKept));
  ok('the numbers are the passage\'s: fewer notes after than before, in the bars asked for', ui.stats.after.notes < ui.stats.before.notes && ui.stats.fromNo === 3 && ui.stats.toNo === 6, JSON.stringify({ b: ui.stats.before.notes, a: ui.stats.after.notes }));
  ok('nothing is saved until "Practice this version" (the library has as many songs as before, the original is still open)', (await p.page.evaluate(() => PPP.app.libraryRead().songs.length)) === lib0 && (await p.page.evaluate(() => PPP.app.state.songId)) === songId);
  ok('the answer\'s own time (splice, score, preview) is on record and small', ui.ms >= 0 && ui.ms < 1500, String(ui.ms) + ' ms');

  /* accept */
  await click(p.page, '[data-variant-accept]');
  await sleep(2500);
  const cp = await p.page.evaluate(() => {
    const A = PPP.app, S = A.state, lib = A.libraryRead();
    const card = lib.songs.find(s => s.id === S.songId);
    return { id: S.songId, title: S.score.title, composer: S.score.composer, screen: S.screen, loop: [S.loopFrom, S.loopTo], loopOn: S.loop, hands: S.hands, mode: S.practiceMode,
      src: S.importSource, scoreSrc: S.score.source, card: card, cards: lib.songs.length, bars: S.score.measures.length, numbers: S.score.measures.map(m => m.number).join(','),
      hist: Object.keys(S.history.byMeasure).length, runs: S.history.runs.length, tempo: S.tempo, panel: !!document.querySelector('[data-variant-panel]'), back: !!document.querySelector('[data-variant-back]') };
  });
  ok('a NEW song is in My Songs, titled "<song> · measures 3-6 easier"', cp.id !== songId && cp.cards === before.cards + 1 && cp.title === before.title + ' · measures 3-6 easier' && cp.card && cp.card.title === cp.title, cp.title);
  ok('it opens on the practice page, looping the same bars (3-6), with the hand chosen (the left)', cp.screen === 'player' && cp.loopOn && cp.loop[0] === 3 && cp.loop[1] === 6 && cp.hands === 'left' && cp.mode === 'practice', JSON.stringify([cp.screen, cp.loop, cp.hands]));
  ok('its source names the original: variantOf { songId, hash, from, to } (indexes) and the numbers', !!cp.src && !!cp.src.variantOf && cp.src.variantOf.songId === songId && typeof cp.src.variantOf.hash === 'string' && cp.src.variantOf.hash.length > 6
    && cp.src.variantOf.from === 2 && cp.src.variantOf.to === 5 && cp.src.variantOf.fromNumber === 3 && cp.src.variantOf.toNumber === 6, JSON.stringify(cp.src && cp.src.variantOf));
  ok('it is an arrangement of it (kind, parentSongId, the card\'s arrangedFrom), so it goes through the same paths as any copy', cp.src.kind === 'arrangement' && cp.src.parentSongId === songId && cp.card.arrangedFrom === songId && cp.card.kind === 'arrangement' && cp.scoreSrc && cp.scoreSrc.variantOf);
  ok('it has the original\'s bars one for one, and the composer line says what it is', cp.bars === before.bars && cp.numbers === Array.from({ length: before.bars }, (_, i) => i + 1).join(',') && /PPP easier passage/.test(cp.composer), cp.composer);
  ok('its progress is its own: nothing practised yet, though the original has been', cp.hist === 0 && cp.runs === 0, JSON.stringify([cp.hist, cp.runs]));
  ok('the panel is gone, and the way back is on the Loop panel', !cp.panel && cp.back);
  const copyNotes = await notesOf(p.page);
  const inRange = n => { const m = +n.split(',')[0]; return m >= 3 && m <= 6; };
  const outside = (xs) => xs.filter(n => !inRange(n)).slice().sort().join('|');
  ok('every bar outside 3-6 is the original\'s, note for note', outside(copyNotes) === outside(before.notes), 'outside ' + copyNotes.filter(n => !inRange(n)).length + ' of ' + before.notes.filter(n => !inRange(n)).length);
  ok('the passage itself is not the original\'s: fewer notes', copyNotes.filter(inRange).length < before.notes.filter(inRange).length, copyNotes.filter(inRange).length + ' < ' + before.notes.filter(inRange).length);

  /* the copy is engraved and playable now: the staff is drawn, a plan is made */
  await sleep(800);
  const drawn = await p.page.evaluate(() => ({ svg: !!document.querySelector('.ppp-staffwrap svg'), plan: !!(PPP.practicePlan && PPP.practicePlan(PPP.app.state.score, 3, 6)), stats: PPP.engraveStats && PPP.engraveStats.fallbacks }));
  ok('the copy is drawn by the engraver and has a practice plan', drawn.svg && drawn.plan, JSON.stringify(drawn));

  /* practise the copy: a lap on the (fake) keyboard, judged */
  const lap = await p.page.evaluate(realLapInPage, { from: 3, to: 6, tempo: 200, hands: 'both' });
  const afterLap = await p.page.evaluate(() => { const S = PPP.app.state; return { runs: S.history.runs.length, bars: Object.keys(S.history.byMeasure).sort().join(',') }; });
  ok('a lap on the keyboard counts for the copy (its own history has the run and bars 3-6)', lap.counted && afterLap.runs >= 1 && /3/.test(afterLap.bars), JSON.stringify([lap, afterLap]));
  await p.page.evaluate(() => PPP.app.saveNow());
  const copyId = cp.id;

  /* back to the original, on the same bars */
  const backLabel = await p.page.evaluate(() => { const b = document.querySelector('[data-variant-back]'); return b ? b.innerText.trim() : null; });
  ok('the way back says "Practice this passage as written"', backLabel === 'Practice this passage as written', String(backLabel));
  /* with the switch off a copy that is there still has its way back, and no button to make another */
  await p.page.evaluate(() => { PPP.variant = 'off'; PPP.app.setState({}); });
  await sleep(300);
  const offOnCopy = await p.page.evaluate(() => ({ back: !!document.querySelector('[data-variant-back]'), open: !!document.querySelector('[data-variant-open]') }));
  ok('with the switch off a copy still has its way back, and no button to make another', offOnCopy.back && !offOnCopy.open, JSON.stringify(offOnCopy));
  await p.page.evaluate(() => { PPP.variant = 'on'; PPP.app.setState({}); });
  await sleep(300);
  await click(p.page, '[data-variant-back]');
  await sleep(1500);
  const orig = await p.page.evaluate(() => { const S = PPP.app.state; return { id: S.songId, title: S.score.title, loop: [S.loopFrom, S.loopTo], loopOn: S.loop, screen: S.screen, hands: S.hands, runs: S.history.runs.length, bars: Object.keys(S.history.byMeasure).length }; });
  ok('one tap opens the original song on the same bars (3-6), looping, on the practice page', orig.id === songId && orig.title === before.title && orig.loop[0] === 3 && orig.loop[1] === 6 && orig.loopOn && orig.screen === 'player', JSON.stringify(orig));
  ok('and the original has none of the copy\'s practice: its history is the lap it had', orig.runs === prog0.runs && orig.bars === prog0.bars.split(',').length, JSON.stringify([orig, prog0]));
  const origNotes = await notesOf(p.page);
  ok('the original\'s notes are exactly what they were', origNotes.slice().sort().join('|') === before.notes.slice().sort().join('|'));
  await p.page.evaluate(() => PPP.app.saveNow());
  const slot1 = await slotText(p.page, songId);
  ok('the original\'s saved score is, to the last field, what it was before the copy was made', (await canonScore(p.page, songId)) === canon0 && canon0.length > 5000, canon0.length + ' bytes');
  ok('its history is byte for byte what it was: the lap on bars 1-2 and none of the copy lap',JSON.stringify(JSON.parse(slot1).history) === hist0);
  const card1 = await p.page.evaluate(id => { const c = PPP.app.libraryRead().songs.find(s => s.id === id); return JSON.stringify(Object.assign({}, c, { lastAt: null, prog: 0, mem: 0 })); }, songId);
  ok('its card is what it was (title, composer, kind, bars; only the "last opened" moved)', card1 === JSON.stringify(Object.assign({}, JSON.parse(card0), { lastAt: null, prog: 0, mem: 0 })), card1);
  /* and the copy kept the lap */
  const copySlot = await slotText(p.page, copyId);
  ok('the copy\'s own slot kept the lap', JSON.parse(copySlot).history.runs.length >= 1);
  const again = await p.page.evaluate(id => PPP.app.libraryRead().songs.filter(s => s.id === id).length, copyId);
  ok('and it is in My Songs once', again === 1);
  ok('no page error, no console error', p.probe.errors.length === 0 && p.probe.consoleErrors.length === 0, p.probe.errors.concat(p.probe.consoleErrors).join(' | '));
  await p.close();
  return { songId, copyId, title: before.title };
}

/* ---------------------------------------------------------------- 3. determinism, and asking again */
async function determSection(browser) {
  console.log('\n── the same request is the same copy ──');
  const make = async () => {
    const p = await open(browser, { query: '?variant=on' });
    const parent = await addSong(p.page, HYMN);
    await toLoop(p.page, 3, 6);
    const r = await makeEasier(p.page, {});
    const acc = await click(p.page, '[data-variant-accept]');
    await sleep(2000);
    const out = await p.page.evaluate(() => {
      const A = PPP.app, S = A.state, E = window.PPPEngrave;
      const v = S.importSource.variantOf;
      return { id: S.songId, hash: E.scoreHash(S.score), notes: S.score.notes.filter(n => !n.rest).map(n => [n.m, Math.round(n.b * 1000), Math.round(n.dur * 1000), n.midi, n.hand].join(',')).join('|'),
        v: v, title: S.score.title, expect: PPP.variantIdOf(v.songId, v.hash, v.from, v.to, 'one'), other: PPP.variantIdOf('another-song', v.hash, v.from, v.to, 'one'),
        otherBars: PPP.variantIdOf(v.songId, v.hash, v.from, v.to + 1, 'one'), easiest: PPP.variantIdOf(v.songId, v.hash, v.from, v.to, 'easiest') };
    });
    out.phase = r && r.phase; out.accepted = acc; out.parent = parent;
    return { p, out };
  };
  const a = await make();
  const b = await make();
  ok('both asked for a preview and accepted', a.out.phase === 'preview' && b.out.phase === 'preview' && a.out.accepted && b.out.accepted, a.out.phase + ' ' + b.out.phase);
  ok('the copy song id is a function of the request alone: the original, its music, the bars, the level (not of the clock)', a.out.id === a.out.expect && b.out.id === b.out.expect && /^song-v[0-9a-f]{14}$/.test(a.out.id), a.out.id + ' ' + a.out.expect + ' / ' + b.out.id + ' ' + b.out.expect);
  ok('another original, other bars or another level are other ids', new Set([a.out.id, a.out.other, a.out.otherBars, a.out.easiest]).size === 4, JSON.stringify([a.out.id, a.out.other, a.out.otherBars, a.out.easiest]));
  ok('the same music hash', a.out.hash === b.out.hash && a.out.hash.length >= 8, a.out.hash + ' ' + b.out.hash);
  ok('the same notes, to the last one', a.out.notes === b.out.notes && a.out.notes.length > 100);
  ok('the same variantOf hash (the original\'s music)', a.out.v.hash === b.out.v.hash);
  await b.p.close();

  /* asking again, on the first page: the copy that is there, once */
  await a.p.page.evaluate(() => PPP.app.openVariantOriginal());
  await sleep(1500);
  await toLoop(a.p.page, 3, 6);
  const cards0 = await a.p.page.evaluate(() => PPP.app.libraryRead().songs.length);
  const r2 = await makeEasier(a.p.page, {});
  ok('asking again for the same bars says so: the copy is there already', !!r2 && r2.phase === 'exists' && /You already made this easier version/.test(r2.text), r2 && r2.phase + ' ' + r2.text);
  const slotCanon = await canonScore(a.p.page, a.out.id);
  await click(a.p.page, '[data-variant-exists-open]');
  await sleep(1500);
  const o = await a.p.page.evaluate(() => ({ id: PPP.app.state.songId, cards: PPP.app.libraryRead().songs.length, loop: [PPP.app.state.loopFrom, PPP.app.state.loopTo] }));
  ok('"Open it" opens that copy on the bars, and no second copy is made', o.id === a.out.id && o.cards === cards0 && o.loop[0] === 3 && o.loop[1] === 6, JSON.stringify(o));
  ok('and opening it did not rewrite its score', (await canonScore(a.p.page, a.out.id)) === slotCanon);
  /* other bars are another copy */
  await a.p.page.evaluate(() => PPP.app.openVariantOriginal());
  await sleep(1500);
  await toLoop(a.p.page, 8, 11);
  const r3 = await makeEasier(a.p.page, {});
  await click(a.p.page, '[data-variant-accept]');
  await sleep(1800);
  const o3 = await a.p.page.evaluate(() => ({ id: PPP.app.state.songId, title: PPP.app.state.score.title, cards: PPP.app.libraryRead().songs.length }));
  ok('other bars are another copy, with its own name', !!r3 && r3.phase === 'preview' && o3.id !== a.out.id && o3.cards === cards0 + 1 && / · measures 8-11 easier$/.test(o3.title), JSON.stringify(o3));
  await a.p.close();
}

/* ---------------------------------------------------------------- 4. refusals */
async function refusalSection(browser) {
  console.log('\n── refusals: the sentence, the alternatives, nothing saved ──');
  const refuse = async (file, a, b, o) => {
    const p = await open(browser, { query: '?variant=on' });
    await addSong(p.page, file);
    await toLoop(p.page, a, b);
    const cards = await p.page.evaluate(() => PPP.app.libraryRead().songs.length);
    const r = await makeEasier(p.page, o || {});
    const after = await p.page.evaluate(() => ({ cards: PPP.app.libraryRead().songs.length, tempo: PPP.app.state.tempo, scoreTempo: PPP.app.state.score.tempo, hands: PPP.app.state.hands, id: PPP.app.state.songId }));
    return { p, r, cards, after };
  };
  /* already easy: a method book's first exercise */
  const i = await refuse(F('catalog/method/hanon/001.mxl'), 1, 4);
  ok('a passage that is already easy: refused, with the sentence of "already easy enough" and the 70% question', !!i.r && i.r.phase === 'refused' && i.r.reason === 'VARIANT_IDENTICAL' && /already easy enough/.test(i.r.text) && /70% tempo/.test(i.r.text), i.r && i.r.reason + ' ' + i.r.text);
  ok('with one-tap alternatives: both hands at 70%, the harder hand, a shorter loop', !!i.r && i.r.alts.indexOf('tempo') > -1 && i.r.alts.indexOf('short') > -1, i.r && JSON.stringify(i.r.alts));
  ok('and nothing was saved', i.after.cards === i.cards);
  const t0 = i.after.tempo;
  await click(i.p.page, '[data-variant-alt="tempo"]');
  await sleep(300);
  const s1 = await i.p.page.evaluate(() => ({ tempo: PPP.app.state.tempo, st: PPP.app.state.score.tempo, hands: PPP.app.state.hands, panel: !!document.querySelector('[data-variant-panel]') }));
  ok('"Both hands at 70% tempo" sets the tempo to 70% of the score\'s and closes the panel', s1.tempo === Math.round(s1.st * 0.7) && !s1.panel && s1.hands === 'both', JSON.stringify(s1) + ' was ' + t0);
  await toLoop(i.p.page, 1, 4);
  await makeEasier(i.p.page, {});
  const shortAlt = await click(i.p.page, '[data-variant-alt="short"]');
  await sleep(300);
  const s2 = await i.p.page.evaluate(() => [PPP.app.state.loopFrom, PPP.app.state.loopTo]);
  ok('"Loop only measures 1–2" shortens the loop to its first half', shortAlt && s2[0] === 1 && s2[1] === 2, JSON.stringify(s2));
  await i.p.close();

  /* cannot be made easier: Czerny op. 849 no. 3 */
  const e = await refuse(F('catalog/method/czerny849/003.mxl'), 1, 4);
  ok('a passage that cannot be made easier: "could not make this passage any easier" and the alternatives', !!e.r && e.r.phase === 'refused' && (e.r.reason === 'VARIANT_NOT_EASIER' || e.r.reason === 'VARIANT_IDENTICAL') && e.r.alts.length >= 1, e.r && e.r.reason + ' ' + e.r.text);
  ok('and nothing was saved', e.after.cards === e.cards);
  await e.p.close();

  /* no easier version of the piece at all: the arranger refuses it */
  const n = await refuse(F('catalog/method/czerny849/009.mxl'), 1, 4);
  ok('a piece the arranger cannot make: "could not make an easier version of this piece", with alternatives', !!n.r && n.r.phase === 'refused' && n.r.reason === 'NO_VARIANT' && /could not make an easier version of this piece/.test(n.r.text) && n.r.alts.length >= 1, n.r && n.r.reason + ' ' + n.r.text);
  ok('and nothing was saved', n.after.cards === n.cards);
  await n.p.close();

  /* a piece on one staff */
  const s = await refuse(F('catalog/method/beyer/001.mxl'), 1, 4);
  ok('a piece written on one staff: the reason says so', !!s.r && s.r.phase === 'refused' && /one staff/.test(s.r.text), s.r && s.r.reason + ' ' + s.r.text);
  await s.p.close();
}

/* ---------------------------------------------------------------- 5. levels */
async function levelsSection(browser) {
  console.log('\n── levels: "as easy as possible" is a choice where there is a step to take ──');
  /* a hymn is stage 2: one level, nothing to choose; Czerny op. 299 no. 10 is stage 3: one step easier (intermediate) or the easiest (beginner) */
  const h = await open(browser, { query: '?variant=on' });
  await addSong(h.page, HYMN);
  await toLoop(h.page, 3, 6);
  await click(h.page, '[data-variant-open]');
  await sleep(2500);
  const hp = await panel(h.page);
  const hs = await h.page.evaluate(() => PPP.app.state.variantUi.stage);
  ok('a piece of stage ' + hs + ' offers no second level', !!hp && hs < 3 && hp.levels.length === 0, JSON.stringify([hs, hp && hp.levels]));
  await h.close();
  const p = await open(browser, { query: '?variant=on' });
  await addSong(p.page, F('catalog/method/czerny299/010.mxl'));
  await toLoop(p.page, 5, 8);
  await click(p.page, '[data-variant-open]');
  await sleep(3000);
  const pp = await panel(p.page);
  const st = await p.page.evaluate(() => PPP.app.state.variantUi.stage);
  ok('a piece of stage ' + st + ' offers both levels', !!pp && st >= 3 && pp.levels.join() === 'one,easiest', JSON.stringify([st, pp && pp.levels]));
  const one = await makeEasier(p.page, {});
  const u1 = await p.page.evaluate(() => ({ id: PPP.app.state.variantUi.copyId, level: PPP.app.state._variantLevelProbe }));
  await click(p.page, '[data-variant-cancel]');
  await sleep(200);
  const easiest = await makeEasier(p.page, { level: 'easiest' });
  const u2 = await p.page.evaluate(() => ({ id: PPP.app.state.variantUi && PPP.app.state.variantUi.copyId, level: PPP.app.state.variantUi && PPP.app.state.variantUi.level }));
  ok('both are answered with a preview', !!one && !!easiest && one.phase === 'preview' && easiest.phase === 'preview', (one && one.phase) + ' ' + (easiest && easiest.phase));
  const tuneNow = await p.page.evaluate(() => PPP.app.state.variantUi.stats.tuneKept);
  ok('the line about the tune follows what is so on this piece too (' + (tuneNow ? 'kept' : 'not kept') + ')', easiest.lines.some(l => /The tune stays as written/.test(l)) === tuneNow, JSON.stringify(easiest.lines));
  ok('and "as easy as possible" is another copy (another song id) at the level of a beginner', u1.id && u2.id && u1.id !== u2.id && u2.level === 'easiest', JSON.stringify([u1, u2]));
  const lv = await p.page.evaluate(() => { const A = PPP.app; return A._variantDraft && A._variantDraft.level; });
  ok('the arranger was asked for beginner pieces for it', lv === 'beginner', String(lv));
  await p.close();
}

/* ---------------------------------------------------------------- 6. sharing, backup, YouTube */
async function sharingSection(browser) {
  console.log('\n── a variant of a YouTube-derived song stays derived; the backup and the share paths take it as any song ──');
  const p = await open(browser, { query: '?variant=on' });
  const parent = await addSong(p.page, HYMN);
  /* the song is marked as made from a YouTube link (G13-3), as a score added from Shared Scores keeps the mark */
  await p.page.evaluate(() => {
    const A = PPP.app;
    A.setState(st => ({ score: Object.assign(st.score, { source: Object.assign({}, st.score.source || {}, { youtubeDerived: true }) }) }));
  });
  await sleep(200);
  await p.page.evaluate(() => PPP.app.saveNow());
  const derived0 = await p.page.evaluate(id => PPP.app.youtubeDerivedOf(id), parent);
  ok('the original is YouTube-derived (the mark the page reads)', derived0 === true);
  await toLoop(p.page, 3, 6);
  const r = await makeEasier(p.page, {});
  await click(p.page, '[data-variant-accept]');
  await sleep(2000);
  const c = await p.page.evaluate(() => {
    const A = PPP.app, S = A.state, id = S.songId;
    let shared = null;
    try { shared = A.shareScoreOf(id); } catch (e) { shared = null; }
    return { id: id, flag: S.importSource && S.importSource.youtubeDerived, derived: A.youtubeDerivedOf(id), sharedMark: shared && shared.source && shared.source.youtubeDerived };
  });
  ok('the copy carries the mark itself (source.youtubeDerived), not only through its parent', !!r && r.phase === 'preview' && c.flag === true && c.derived === true, JSON.stringify(c));
  ok('and its shared form carries it, so whoever adds it keeps it', c.sharedMark === true);
  const posted = await p.page.evaluate(id => PPP.app.publishSong(id, true).then(() => 'posted', e => String(e && e.message)), c.id);
  ok('it is not posted to Shared Scores (its link can still be sent)', /cannot be posted to Shared Scores/.test(posted), posted);
  /* the original is removed: the mark stays with the copy */
  await p.page.evaluate(id => { PPP.app.openSong(id, { stay: true, quiet: true }); }, c.id);
  await sleep(500);
  await p.page.evaluate(id => PPP.app.removeSong(id, { quiet: true }), parent);
  await sleep(500);
  const gone = await p.page.evaluate(id => ({ derived: PPP.app.youtubeDerivedOf(id), has: !!PPP.app.libraryRead().songs.find(s => s.id === id) }), c.id);
  ok('and when the original is gone from My Songs the copy is still derived (the flag was copied)', gone.has && gone.derived === true, JSON.stringify(gone));
  /* the backup takes it as any song */
  const bk = await p.page.evaluate(id => {
    const b = window.PPPBackup && window.PPPBackup.build ? window.PPPBackup.build(localStorage, {}) : null;
    if (!b) return null;
    const card = b.library.songs.find(s => s.id === id);
    return { card: !!card, slot: !!(b.slots && b.slots[id]), v: card && card.variantOf, flag: b.slots[id] && b.slots[id].importSource && b.slots[id].importSource.youtubeDerived, valid: window.PPPBackup.validate(b).ok };
  }, c.id);
  ok('the backup holds the copy: its card, its slot, its mark; and the file is valid', !!bk && bk.card && bk.slot && bk.flag === true && bk.valid, JSON.stringify(bk));
  await p.close();

  /* a song that is not derived: no mark, and the link is as any */
  const q = await open(browser, { query: '?variant=on' });
  await addSong(q.page, HYMN);
  await toLoop(q.page, 3, 6);
  await makeEasier(q.page, {});
  await click(q.page, '[data-variant-accept]');
  await sleep(2000);
  const n = await q.page.evaluate(() => ({ flag: PPP.app.state.importSource.youtubeDerived, derived: PPP.app.youtubeDerivedOf(PPP.app.state.songId) }));
  ok('an ordinary song\'s copy has no YouTube mark', n.flag === undefined && n.derived === false, JSON.stringify(n));
  await q.close();
}

/* ---------------------------------------------------------------- 7. four languages */
async function i18nSection(browser) {
  console.log('\n── the panel in Korean, Japanese and Chinese ──');
  const want = {
    'ko-KR': { open: '이 구간 쉽게 만들기', title: /3–6마디 쉽게 만들기/, title2: '· 3-6마디 쉽게', back: '이 구간 원래대로 연습하기' },
    'ja-JP': { open: 'この区間をやさしくする', title: /3–6小節をやさしくする/, title2: '· 3-6小節をやさしく', back: 'この区間を元の楽譜どおりに練習する' },
    'zh-CN': { open: '把这一段变简单', title: /把第3–6小节变简单/, title2: '· 第3-6小节简化版', back: '按原谱练习这一段' }
  };
  for (const loc of Object.keys(want)) {
    const w = want[loc];
    const p = await open(browser, { query: '?variant=on', locale: loc });
    await addSong(p.page, HYMN);
    await toLoop(p.page, 3, 6);
    const btn = await p.page.evaluate(() => { const b = document.querySelector('[data-variant-open]'); return b ? b.innerText.trim() : null; });
    ok(loc + ': the button reads "' + w.open + '"', btn === w.open, String(btn));
    await click(p.page, '[data-variant-open]');
    await sleep(500);
    const ch = await panel(p.page);
    const r = await makeEasier(p.page, {});
    const latin = t => (t || '').replace(/\{\{[^}]*\}\}/g, '').match(/[A-Za-z]{3,}/g) || [];
    ok(loc + ': the panel\'s title is in the language, with no English left in the panel', !!ch && w.title.test(ch.text) && latin(ch.text).length === 0, ch && (ch.text + ' / ' + latin(ch.text).join(',')));
    ok(loc + ': the preview says what changed in the language', !!r && r.phase === 'preview' && r.lines.length >= 2 && latin(r.lines.join(' ')).length === 0, r && JSON.stringify(r.lines));
    await click(p.page, '[data-variant-accept]');
    await sleep(2000);
    const cp = await p.page.evaluate(() => ({ title: PPP.app.state.score.title, back: (document.querySelector('[data-variant-back]') || {}).innerText }));
    ok(loc + ': the copy\'s title ends "' + w.title2 + '" and the way back reads "' + w.back + '"', cp.title.indexOf(w.title2) > -1 && String(cp.back).trim() === w.back, JSON.stringify(cp));
    await p.close();
  }
  /* the refusal in Korean */
  const k = await open(browser, { query: '?variant=on', locale: 'ko-KR' });
  await addSong(k.page, F('catalog/method/hanon/001.mxl'));
  await toLoop(k.page, 1, 4);
  const r = await makeEasier(k.page, {});
  ok('ko-KR: the refusal is "이 구간은 이미 충분히 쉬워요. 70% 빠르기로 연습해 볼까요?"', !!r && r.phase === 'refused' && r.text.indexOf('이 구간은 이미 충분히 쉬워요. 70% 빠르기로 연습해 볼까요?') > -1 && /양손 70% 빠르기/.test(r.text), r && r.text);
  await k.close();
}

/* ---------------------------------------------------------------- 8. the budget at CPU 4x */
/* the fixed workload tests/learner-log.test.js calibrates its limits with: the time of this machine on it, against the reference machine's (CALIB_REF) */
const CALIB_REF = 92;
async function calibration(browser) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.goto('about:blank');
  const ms = await page.evaluate(() => {
    const once = () => {
      const t = performance.now();
      let s = 0;
      for (let round = 0; round < 8; round++) {
        let x = 1 + round;
        const a = new Array(30000);
        for (let i = 0; i < a.length; i++) { x = (Math.imul(x, 1664525) + 1013904223) >>> 0; a[i] = x; }
        a.sort((p, q) => p - q);
        for (let i = 0; i < 2000000; i++) s = (s + Math.imul(i, 31)) | 0;
      }
      return performance.now() - t + (s === 0.5 ? 1 : 0);
    };
    const runs = [];
    for (let i = 0; i < 5; i++) runs.push(once());
    runs.sort((p, q) => p - q);
    return runs[2];
  });
  await ctx.close();
  return ms;
}
async function budgetSection(browser) {
  const calib = await calibration(browser);
  const scale = Math.min(3, Math.max(1, calib / CALIB_REF));
  console.log('\n── budget at CPU 4x: 16 bars of a hymn (limits x ' + scale.toFixed(2) + ': this machine ' + calib.toFixed(0) + ' ms on the reference workload, reference ' + CALIB_REF + ') ──');
  const p = await open(browser, { query: '?variant=on', cpu: 4, settle: 1500 });
  await addSong(p.page, HYMN);
  await toLoop(p.page, 1, 16);
  await p.page.evaluate(() => {
    window.__long = [];
    try { new PerformanceObserver(l => l.getEntries().forEach(e => window.__long.push(Math.round(e.duration)))).observe({ entryTypes: ['longtask'] }); } catch (e) { /* none */ }
  });
  await click(p.page, '[data-variant-open]');
  await sleep(4000);          /* the person is choosing: the files come, the arranger starts */
  const t0 = Date.now();
  await click(p.page, '[data-variant-make]');
  const r = await waitPhase(p.page, ['preview', 'refused'], 120000);
  const total = Date.now() - t0;
  const ui = await p.page.evaluate(() => ({ ms: PPP.app.state.variantUi.ms, phase: PPP.app.state.variantUi.phase }));
  await sleep(300);
  const long = await p.page.evaluate(() => window.__long.slice());
  ok('the answer is a preview', !!r && r.phase === 'preview', r && r.phase);
  ok('splice, score and preview took <= 300 ms at CPU 4x (16 bars)', ui.ms != null && ui.ms <= 300 * scale, String(ui.ms) + ' ms (limit ' + Math.round(300 * scale) + ')');
  console.log('    press to answer ' + total + ' ms (the arranger had been started while the person chose); long tasks (>50 ms) while it ran: ' + JSON.stringify(long));
  /* another passage of the same piece: the arranger's answer is cached, so this is the splice alone */
  await click(p.page, '[data-variant-cancel]');
  await sleep(200);
  await toLoop(p.page, 5, 20);
  await click(p.page, '[data-variant-open]');
  await sleep(300);
  const t1 = Date.now();
  await click(p.page, '[data-variant-make]');
  const r2 = await waitPhase(p.page, ['preview', 'refused'], 60000);
  const total2 = Date.now() - t1;
  const ms2 = await p.page.evaluate(() => PPP.app.state.variantUi.ms);
  ok('another passage of the same piece: the arranger\'s answer is there, the whole press takes <= 1.2 s at CPU 4x', !!r2 && r2.phase === 'preview' && total2 <= 1200 * scale, total2 + ' ms (splice etc. ' + ms2 + ' ms)');
  await p.close();
}

/* ---------------------------------------------------------------- 9. nothing from a server */
async function offlineSection(browser) {
  console.log('\n── after the files are in the flow asks for nothing from a server; no model is involved ──');
  const p = await open(browser, { query: '?variant=on' });
  await addSong(p.page, HYMN);
  await toLoop(p.page, 3, 6);
  await click(p.page, '[data-variant-open]');
  await sleep(2500);       /* the files, once */
  const n0 = p.probe.requests.length;
  p.probe.requests.length = 0;
  const r = await makeEasier(p.page, {});
  await click(p.page, '[data-variant-accept]');
  await sleep(2000);
  await click(p.page, '[data-variant-back]');
  await sleep(1000);
  const reqs = p.probe.requests.slice();
  ok('the flow made a preview and a copy', !!r && r.phase === 'preview');
  ok('no /api/ request, no helper, no language model (/coach, /arrange) while it ran', reqs.filter(u => /\/api\/|\/helper|:8788|\/coach|\/arrange/.test(u)).length === 0, JSON.stringify(reqs.filter(u => /\/api\/|\/helper|:8788|\/coach|\/arrange/.test(u))));
  ok('and after the files, no script or data file was asked for again (' + n0 + ' requests before)', reqs.filter(u => /\.(js|json)(\?|$)/.test(u)).length === 0, JSON.stringify(reqs.filter(u => /\.(js|json)(\?|$)/.test(u)).slice(0, 5)));
  await p.close();
  const q = await open(browser, { query: '?variant=on' });
  await addSong(q.page, HYMN);
  await toLoop(q.page, 3, 6);
  await click(q.page, '[data-variant-open]');
  await sleep(3000);
  const mods = q.probe.requests.filter(u => /practice\/variant\.js/.test(u)).length;
  const chk = q.probe.requests.filter(u => /notation-check\.js/.test(u)).length;
  ok('practice/variant.js is asked for once, and the notation checker at most once', mods === 1 && chk <= 1, mods + ' / ' + chk);
  await q.close();
}

/* ---------------------------------------------------------------- 10. a busy state the person can leave */
async function busySection(browser) {
  console.log('\n── a run in progress shows a busy state, and can be left ──');
  const p = await open(browser, { query: '?variant=on', delay: { re: /\/candidates\/index\.js/, ms: 2500 } });
  await addSong(p.page, HYMN);
  await toLoop(p.page, 3, 6);
  await click(p.page, '[data-variant-open]');
  await sleep(300);
  await click(p.page, '[data-variant-make]');
  await sleep(600);
  const b = await panel(p.page);
  ok('while the arranger\'s files are on their way: the busy state, with its sentence', !!b && b.phase === 'busy' && /Making an easier version/.test(b.text), b && b.phase + ' ' + b.text);
  await click(p.page, '[data-variant-close]');
  await sleep(300);
  ok('the person can close it: the panel is gone', (await panel(p.page)) === null);
  await sleep(9000);
  const after = await p.page.evaluate(() => ({ ui: PPP.app.state.variantUi, cards: PPP.app.libraryRead().songs.length }));
  ok('and the answer that comes later is not shown, and nothing was saved', after.ui === null && after.cards === 1, JSON.stringify(after));
  const r = await makeEasier(p.page, {});
  ok('pressing again is quick: the run that finished is the answer', !!r && r.phase === 'preview');
  /* another song is opened while a run works: its panel is not waiting when the person comes back */
  await p.page.evaluate(() => PPP.app.closeVariantPanel());
  await addSong(p.page, F('catalog/method/sonatina/016.mxl'));      /* a piece whose arranger run takes seconds (1,565 notes): it is still working when the song is put away */
  await toLoop(p.page, 5, 8);
  await click(p.page, '[data-variant-open]');
  await sleep(200);
  await click(p.page, '[data-variant-make]');
  await sleep(400);
  const mid = await panel(p.page);
  const home = await p.page.evaluate(() => { const A = PPP.app, id = A.state.songId; A.openSong('demo', { stay: true, quiet: true }); return id; });
  await sleep(14000);
  const gone = await p.page.evaluate(() => ({ ui: PPP.app.state.variantUi, cards: PPP.app.libraryRead().songs.length, id: PPP.app.state.songId }));
  ok('and a run whose song was put away is let go of: no panel, nothing saved', !!mid && mid.phase === 'busy' && gone.ui === null && gone.cards === 2 && gone.id === 'demo', JSON.stringify([mid && mid.phase, gone]));
  await p.page.evaluate(id => PPP.app.openSong(id, { stay: true, quiet: true }), home);
  await sleep(800);
  ok('and it is not there when the person comes back', (await panel(p.page)) === null);
  await p.close();
}

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  try {
    if (want('switch')) await switchSection(browser);
    if (want('flow') || want('original')) await flowSection(browser);
    if (want('determ')) await determSection(browser);
    if (want('refusal')) await refusalSection(browser);
    if (want('levels')) await levelsSection(browser);
    if (want('sharing')) await sharingSection(browser);
    if (want('i18n')) await i18nSection(browser);
    if (want('budget')) await budgetSection(browser);
    if (want('offline')) await offlineSection(browser);
    if (want('busy')) await busySection(browser);
  } catch (e) {
    console.log('  ✗ the suite crashed — ' + (e && e.stack || e));
    errors.push('crash: ' + (e && e.message));
  } finally {
    await browser.close();
  }
  console.log('\n' + (errors.length ? errors.length + ' check(s) failed:\n  - ' + errors.join('\n  - ') : 'all checks passed'));
  process.exit(errors.length ? 1 : 0);
})();
