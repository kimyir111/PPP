/* G11a-4: THE FOUR FIXES UNDER PPP.practice = 'graph' (docs/GOALS/G11 section 6.1 and 10.5; the user's decisions U2 and U3 of 2026-10-13).

   PPP.practice 'graph' builds the plan with the fixes ON: D.C. / D.S. / Fine / To Coda are played once as an engraver reads them (JUMP), grace notes sound and are drawn small but are never
   asked of the matcher (GRACE), follow mode asks a repeated bar as often as Play plays it (FOLLOW_REPEAT) and asks exactly the notes Play strikes (FOLLOW_TIE). PPP.practiceFix takes any of them
   away again ('off' is the plan of G11a-3, equal to the legacy player to the bit: tests/practice/switch.js). What must hold, in a real page:

     choice      PPP.practiceFix: 'on' by default; 'off', a list such as 'jumps,ties', what is no choice (the default comes back, the remembered one is forgotten); 'legacy' never reads it
     plans       the 7 open catalogue pieces that carry a D.C. al Fine and a hand-written D.S. al Coda: planned from the graph, longer, the jump named; the grace pieces: the graces in the plan
                 and not in the matcher's list; the page's plan is practice/plan.js built with the same options
     laps        "Start to finish" and a loop window that holds a sign and its target are longer; a window without its target is the legacy lap, to the bit
     matcher     scripted performances: graces are never expected, a played grace is not a wrong note, graces on or off the same verdicts; each expected note names its bar (mIdx) and, through the engine's visitOf, its visit,
                 a bar played twice is two visits and one bucket of byMeasureIdx
     gates       follow mode asks exactly the notes Play strikes, as many times, in the order Play plays them; each option alone does what its name says
     spies       the real scheduler queues every strike once, graces included, and the plan's controller events and clicks
     visual      the falling notes: every strike a note, a grace flagged and short, a tie cut at a jump drawn cut
     run         the transport itself: the playhead walks the plan's visits (advance on a clock of the probe's own), a lap is the plan's length, a loop starts over at its first bar
     fixture     the tie at a jump (parity/ds-al-coda-repeat-volta): the coda's D5 is struck once (clock, matcher, follow), the note before the sign is held for its own length
     small       the simulation (no keyboard) judges what the matcher asks and a run keeps its plan; a change of option is seen by the next plan and by the gates; the keyboard hint
                 shows a note a tie leads into from nowhere
     fallbacks   a piece the plan cannot be made for keeps the legacy plan with the fixes on, counted by reason
     perf        the plan with the fixes on builds in no more than the legacy build + 25%, and asking again is the same object
     sweep       every file of the corpus: planned from the graph (fallbacks 0), Play = Follow, and the counts per cause equal to G11a-2's (JUMP 8 files, GRACE 17 files / 244 events,
                 FOLLOW_REPEAT 168, FOLLOW_TIE 6 files / 20 notes)

     node tests/practice/options.js                      all of it (about 4-6 minutes; the sweep is the 325 catalogue files)
     node tests/practice/options.js --quick              the pieces of every section, every 12th catalogue file for the sweep (about 1 minute)
     node tests/practice/options.js --sample 5           the sweep reads every 5th catalogue file (+ the files the baseline gives a cause)
     node tests/practice/options.js --only choice,plans  some sections: choice, plans, laps, matcher, gates, spies, visual, run, fixture, small, fallbacks, perf, sweep
     node tests/practice/options.js --url URL            a page already served (the mutation check's proxy)
   Needs puppeteer (npm ci; on a developer's machine NODE_PATH may point at another tree's node_modules). Exit code 1 when a check fails. */
'use strict';
const fs = require('fs');
const path = require('path');
const L = require('./lib');
const Parity = require('./parity');

const BASELINE = path.join(__dirname, 'baselines', 'parity.json');
const SWITCH_PAGE = fs.readFileSync(path.join(__dirname, 'switch-page.js'), 'utf8');
const OPTIONS_PAGE = fs.readFileSync(path.join(__dirname, 'options-page.js'), 'utf8');
const FIXTURE_DS = 'tests/practice/fixtures/parity/ds-al-coda-repeat-volta.musicxml';

/* the pieces the sections use, by what they hold (open catalogue files; the data is tests/practice/baselines/parity.json) */
const JUMPS = ['catalog/method/burgmuller25/006.mxl', 'catalog/method/czerny599/048.mxl', 'catalog/method/czerny599/053.mxl', 'catalog/method/czerny599/056.mxl',
  'catalog/method/sonatina/012.mxl', 'catalog/method/sonatina/015.mxl', 'catalog/method/sonatina/017.mxl'];
const GRACES = ['catalog/method/burgmuller25/003.mxl', 'catalog/method/czerny849/017.mxl', 'catalog/method/sonatina/014.mxl', 'catalog/method/sonatina/013.mxl', 'catalog/method/sonatina/002.mxl'];
const REPEATS = ['catalog/method/burgmuller25/021.mxl', 'catalog/method/beyer/046.mxl', 'catalog/method/sonatina/023.mxl', 'catalog/method/czerny849/003.mxl'];
const TIES = ['catalog/method/burgmuller25/021.mxl', 'catalog/method/sonatina/015.mxl', 'catalog/hymns/midnight-clear.musicxml'];
const PLAIN = ['catalog/hymns/all-creatures.musicxml', 'catalog/method/sonatina/020.mxl'];

function parseArgs(argv) {
  const a = { quick: false, sample: 0, only: null, url: null };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--quick') a.quick = true;
    else if (k === '--sample') a.sample = +argv[++i];
    else if (k === '--only') a.only = String(argv[++i] || '').split(',').filter(Boolean);
    else if (k === '--url') a.url = argv[++i];
    else throw new Error('unknown argument ' + k);
  }
  return a;
}

let nOk = 0;
const bad = [];
function check(name, ok, detail) {
  if (ok) { nOk++; console.log('  ✓ ' + name); return; }
  bad.push(name);
  console.log('  ✗ ' + name + (detail ? ' - ' + String(detail).slice(0, 400) : ''));
}
const head = s => console.log('\n' + s);

async function openPage(browser, url, o) {
  o = o || {};
  const { preparePage } = require('../boot');
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await preparePage(page);
  if (o.init) await page.evaluateOnNewDocument(o.init, ...(o.initArgs || []));
  const errors = [], requests = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('request', r => { requests.push(r.url()); });
  await page.goto(url + (o.query || ''), { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForFunction(() => window.PPP && window.PPP.app && window.PPP.PianoScore && window.PPPScoreGraph, { timeout: 90000 });
  await page.addScriptTag({ content: L.CANON_SRC });
  await page.addScriptTag({ content: SWITCH_PAGE });
  await page.addScriptTag({ content: OPTIONS_PAGE });
  return { page, ctx, errors, requests, close: () => ctx.close() };
}

const fixtureItem = () => ({ file: FIXTURE_DS, text: fs.readFileSync(path.join(L.ROOT, FIXTURE_DS), 'utf8').split(String.fromCharCode(13, 10)).join(String.fromCharCode(10)) });
const items = files => files.map(f => ({ file: f }));

/* run a probe over a list of items on one page, in small batches */
async function over(h, probe, list, opts, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size || 2) {
    const part = await h.page.evaluate((p, its, o) => Promise.all(its.map(it => window.PPPOptionsProbe[p](it, o))).then(r => r), probe, list.slice(i, i + (size || 2)), opts || {});
    part.forEach(r => out.push(r));
  }
  return out;
}
/* the probes use one page's shared state (PPP.practice): items go one after the other, not in parallel */
async function each(h, probe, list, opts) {
  const out = [];
  for (const it of list) out.push(await h.page.evaluate((p, item, o) => window.PPPOptionsProbe[p](item, o), probe, it, opts || {}));
  return out;
}
const failList = r => (r.fail || []).slice(0, 3).join(' | ') + ((r.fail || []).length > 3 ? ' ... ' + (r.fail.length - 3) + ' more' : '');
const short = f => f.replace(/^catalog\//, '').replace(/^tests\/practice\/fixtures\//, 'fixture ');

/* ---- choice ---- */
async function sectionChoice(browser, url) {
  head('PPP.practiceFix');
  const h = await openPage(browser, url, { query: '?practice=graph' });
  const r = await h.page.evaluate(() => window.PPPOptionsProbe.choice());
  check('the default is "on", nothing remembered', JSON.stringify(r.initial) === '["on",null]', JSON.stringify(r.initial));
  const want = [['off', 'off', 'off'], ['jumps,ties', 'jumps,ties', 'jumps,ties'], ['ties,jumps', 'jumps,ties', 'jumps,ties'], ['graces', 'graces', 'graces'],
    ['jumps,graces,repeats,ties', 'on', 'on'], ['on', 'on', 'on'], ['junk', 'on', null], ['jumps,junk', 'on', null], ['ON', 'on', null], ['', 'on', null], [' jumps', 'on', null], ['jumps,jumps', 'jumps', 'jumps']];
  check('"off", a list (in the order of the options), "on"; a value that is no choice is the default and is forgotten', JSON.stringify(r.seq) === JSON.stringify(want), JSON.stringify(r.seq.filter((x, i) => JSON.stringify(x) !== JSON.stringify(want[i]))));
  check('null puts the default back and forgets the remembered choice', JSON.stringify(r.forgot) === '["on",null]', JSON.stringify(r.forgot));
  check('"legacy" never reads it: practicePlan is PianoScore.of under on, off and a list, and counts no graph plan', r.legacy.every(Boolean) && r.legacyCounted === 0, JSON.stringify([r.legacy, r.legacyCounted]));
  check('the page ran without an error', h.errors.length === 0, h.errors.join(' | '));
  await h.close();
  /* the address chooses for that visit only; a remembered choice is read at start; a storage that throws is the default */
  for (const [q, want2] of [['?practice=graph&practiceFix=off', 'off'], ['?practice=graph&practiceFix=jumps,ties', 'jumps,ties'], ['?practice=graph&practiceFix=nonsense', 'on'], ['?practice=graph&practiceFix=', 'on']]) {
    const g = await openPage(browser, url, { query: q });
    const v = await g.page.evaluate(() => [window.PPP.practiceFix, (() => { try { return localStorage.getItem('ppp.practiceFix.v1'); } catch (e) { return 'throws'; } })()]);
    check(q + ' is "' + want2 + '" for that visit, nothing remembered', v[0] === want2 && v[1] === null, JSON.stringify(v));
    await g.close();
  }
  {
    const g = await openPage(browser, url, { init: () => { try { localStorage.setItem('ppp.practiceFix.v1', 'graces,ties'); } catch (e) { /* none */ } } });
    check('a remembered "graces,ties" is read at start', (await g.page.evaluate(() => window.PPP.practiceFix)) === 'graces,ties');
    await g.close();
    const k = await openPage(browser, url, { init: () => { try { localStorage.setItem('ppp.practiceFix.v1', 'rubbish'); } catch (e) { /* none */ } } });
    check('a remembered value that is no choice is the default', (await k.page.evaluate(() => window.PPP.practiceFix)) === 'on');
    await k.close();
    const t = await openPage(browser, url, { init: () => {
      const f = () => { throw new Error('storage blocked'); };
      try { Storage.prototype.getItem = f; Storage.prototype.setItem = f; Storage.prototype.removeItem = f; } catch (e) { /* none */ }
    } });
    const tv = await t.page.evaluate(() => { window.PPP.practiceFix = 'off'; return window.PPP.practiceFix; });
    check('a localStorage that throws: the default at start, the setter works for the visit', tv === 'off' && t.errors.length === 0, tv + ' ' + t.errors.join(' | '));
    await t.close();
  }
}

/* ---- plans ---- */
async function sectionPlans(browser, url, base) {
  head('the plan the page hands the player, the fixes on');
  const h = await openPage(browser, url);
  const rows = await each(h, 'plan', items(JUMPS.concat(GRACES, REPEATS, PLAIN)).concat([fixtureItem()]));
  rows.forEach(r => {
    const f = (base.files[r.file] || {});
    const isJump = JUMPS.indexOf(r.file) >= 0 || r.file === FIXTURE_DS, isGrace = GRACES.indexOf(r.file) >= 0 || r.file === FIXTURE_DS || f.ge > 0;
    const problems = [];
    if (!r.graph || r.fallbacks) problems.push('not planned from the graph (' + r.fallbacks + ' fallbacks)');
    if (!r.same) problems.push('asking again gives another plan');
    if (!r.sameAsBuild) problems.push('the page\'s plan is not practice/plan.js built with the same options');
    if (!r.notesOk) problems.push('a strike names a note that is neither a Score note nor a grace');
    if (!r.graceNotAsked) problems.push('the matcher asks a grace note, or another number of notes than the plan strikes');
    if (isJump) {
      if (!(r.jumps.length >= 1 && r.visits > r.legacy.visits - 1 && r.len > r.legacy.len - 1e-9 && r.len !== r.legacy.len)) problems.push('no jump followed: ' + JSON.stringify([r.jumps, r.visits, r.legacy.visits, r.len, r.legacy.len]));
      if (!r.arrivals) problems.push('the arrival of the jump is not marked');
      if (r.stats.jumps !== 1) problems.push('the jump is not counted in practiceStats');
    } else if (r.jumps.length) problems.push('a jump followed in a piece that has none');
    if (isGrace) {
      if (!r.graces) problems.push('no grace in the plan');
      if (r.stats.graces !== 1) problems.push('the graces are not counted in practiceStats');
      if (f.ge !== undefined && r.graceEvents !== f.ge) problems.push(r.graceEvents + ' grace events, the baseline says ' + f.ge);
    } else if (r.graces) problems.push('graces in a piece that has none');
    if (!isJump && !isGrace && r.len !== r.legacy.len) problems.push('a piece with no jump and no grace has another length than the legacy plan');
    check(short(r.file) + ': ' + (isJump ? r.jumps.join('+') + ', ' + r.legacy.visits + ' -> ' + r.visits + ' visits, ' + r.legacy.len + ' -> ' + r.len + ' quarters' : '') + (isGrace ? ' ' + r.graceEvents + ' grace events (' + r.graces + ' strikes)' : '') +
      (!isJump && !isGrace ? 'no sign, no grace: the legacy plan\'s length' : ''), problems.length === 0, problems.join(' | '));
  });
  check('the page ran without an error', h.errors.length === 0, h.errors.join(' | '));
  await h.close();
}

/* ---- laps ---- */
async function sectionLaps(browser, url) {
  head('laps: Start to finish and loop windows');
  const h = await openPage(browser, url);
  const rows = await each(h, 'lap', items(JUMPS).concat([fixtureItem()]));
  rows.forEach(r => {
    const problems = [];
    if (!(r.whole.graph > r.whole.legacy)) problems.push('Start to finish is not longer: ' + r.whole.legacy + ' -> ' + r.whole.graph);
    if (!r.windows.length) problems.push('no jump in the plan');
    r.windows.forEach(w => {
      if (w.what === 'sign and target inside' && !(w.graph > w.legacy && w.jumps >= 1)) problems.push('loop [' + w.from + '..' + w.to + '] holding the ' + w.kind + ' and its target is not longer: ' + w.legacy + ' -> ' + w.graph);
      /* a D.C. goes back to the start of the loop (G11a-1: the range is the whole world, as a repeat sign in a loop does), so a loop that is the sign's bar alone is played twice; a D.S. whose
         segno is outside the loop, and a To Coda that has no D.S. before it, cannot be followed there: the legacy lap, to the bit */
      if (w.what === 'sign alone' && w.kind === 'dacapo' && !(w.graph === 2 * w.legacy && w.jumps === 1)) problems.push('loop [' + w.from + '] holding only the D.C. is not played twice: ' + w.legacy + ' -> ' + w.graph);
      if (w.what === 'sign alone' && w.kind !== 'dacapo' && !(w.graph === w.legacy && w.same && w.jumps === 0)) problems.push('loop [' + w.from + '] holding only the ' + w.kind + ' is not the legacy lap');
    });
    check(short(r.file) + ': Start to finish ' + r.whole.legacy + ' -> ' + r.whole.graph + ' quarters; ' + r.windows.length + ' windows', problems.length === 0, problems.join(' | '));
  });
  check('the page ran without an error', h.errors.length === 0, h.errors.join(' | '));
  await h.close();
}

/* ---- matcher ---- */
async function sectionMatcher(browser, url, files) {
  head('the matcher: graces are not judged, a bar played twice is two visits and one bar');
  const h = await openPage(browser, url);
  const rows = await each(h, 'matcher', files, { windows: 1 });
  rows.forEach(r => check(short(r.file) + ' (' + r.runs + ' runs, ' + r.graceStrikes + ' grace strikes' + (r.repeatedBars ? ', ' + r.repeatedBars + ' bars played twice' : '') + ')', r.fail.length === 0, failList(r)));
  const graceful = rows.filter(r => r.graceStrikes > 0).length, repeated = rows.filter(r => r.repeatedBars > 0).length;
  check('the pieces hold graces and repeated bars (' + graceful + ' with graces, ' + repeated + ' with a bar played twice)', graceful >= 2 && repeated >= 2, graceful + ' / ' + repeated);
  check('the page ran without an error', h.errors.length === 0, h.errors.join(' | '));
  await h.close();
}

/* ---- gates ---- */
async function sectionGates(browser, url, files) {
  head("follow mode: Play and Follow are one piece");
  const h = await openPage(browser, url);
  const rows = await each(h, 'gates', files);
  rows.forEach(r => check(short(r.file) + ' (' + r.runs + ' runs; whole piece: +' + r.extraRepeat + ' gates from repeats, +' + r.extraTie + ' notes from ties)', r.fail.length === 0, failList(r)));
  check('some piece asks more because of repeats, and some because of a tie that leads nowhere', rows.some(r => r.extraRepeat > 0) && rows.some(r => r.extraTie > 0), JSON.stringify(rows.map(r => [r.extraRepeat, r.extraTie])));
  check('the page ran without an error', h.errors.length === 0, h.errors.join(' | '));
  await h.close();
}

/* ---- spies ---- */
async function sectionSpies(browser, url, files) {
  head('the real scheduler');
  const h = await openPage(browser, url);
  const rows = await each(h, 'spies', files);
  rows.forEach(r => check(short(r.file) + ' (' + r.runs + ' runs, ' + r.strikes + ' notes queued, ' + r.graces + ' of them graces)', r.fail.length === 0, failList(r)));
  check('the page ran without an error', h.errors.length === 0, h.errors.join(' | '));
  await h.close();
}

/* ---- visual ---- */
async function sectionVisual(browser, url, files) {
  head('the falling notes');
  const h = await openPage(browser, url);
  const rows = await each(h, 'visual', files);
  rows.forEach(r => check(short(r.file) + ' (' + r.notes + ' notes, ' + r.graces + ' graces)', r.fail.length === 0, failList(r)));
  check('the page ran without an error', h.errors.length === 0, h.errors.join(' | '));
  await h.close();
}

/* ---- run ---- */
async function sectionRun(browser, url, files) {
  head('the transport itself');
  const h = await openPage(browser, url);
  const rows = await each(h, 'run', files);
  rows.forEach(r => check(short(r.file) + ': the playhead walks ' + (r.whole ? r.whole.got.length : 0) + ' stays, ' + (r.whole ? r.whole.laps : 0) + ' lap' + (r.loop ? '; the loop [' + r.loop.win.from + '..' + r.loop.win.to + '] ' + r.loop.want.length + ' stays a lap' : ''), r.fail.length === 0, failList(r)));
  check('the page ran without an error', h.errors.length === 0, h.errors.join(' | '));
  await h.close();
}

/* ---- fixture ---- */
async function sectionFixture(browser, url) {
  head('the tie at a jump (D.S. al Coda over a volta: bar 6 ends on a D5 tied into the coda, bar 7)');
  const h = await openPage(browser, url);
  const r = await h.page.evaluate(item => window.PPPOptionsProbe.fixture(item), fixtureItem());
  check('the legacy plan: order 1 2 3 4 2 3 5 6 7 8 9, the D5 of bar 6 struck, the coda\'s D5 carried into (silent)', r.legacy.order === '1 2 3 4 2 3 5 6 7 8 9' && r.legacy.bar6 === 1 && r.legacy.bar7 === 0, JSON.stringify(r.legacy));
  check('with the fixes off: the same (the plan of G11a-3)', r.off.order === r.legacy.order && r.off.bar7 === 0 && JSON.stringify(r.off.bar6) === '[2]', JSON.stringify(r.off));
  check("with the fixes on: as an engraver reads it - 1 2 3 4 | 2 3 5 6 | 2' 3' 5' 7' 8' 9'", r.graph && r.order === "1 2 3 4 2 3 5 6 2' 3' 5' 7' 8' 9'", r.order);
  check("the D5 of bar 6 sounds its own quarter (the tie goes nowhere), the coda's D5 is struck once, on the way back, for its own quarter",
    JSON.stringify(r.bar6) === '[[0,1,1]]' && JSON.stringify(r.bar7) === '[[1,true,1,1]]', JSON.stringify([r.bar6, r.bar7]));
  check("the matcher asks the coda's D5 once and bar 6's once; a perfect performance matches everything", r.askedBar7 === 1 && r.askedBar6 === 1 && r.perfect[0] === r.perfect[1] && !r.perfect[2] && !r.perfect[3], JSON.stringify([r.askedBar7, r.askedBar6, r.perfect]));
  check("follow mode asks the coda's D5 once (the tie option on), and not with the tie option off", r.gateBar7 === 1 && r.gateBar7NoTies === 0, JSON.stringify([r.gateBar7, r.gateBar7NoTies]));
  check("with the jumps alone the clock strikes the coda's D5 and follow does not ask it (each option does one thing)", r.jumpsOnly.bar7 === 1 && r.jumpsOnly.gate === 0, JSON.stringify(r.jumpsOnly));
  check("the falling notes draw bar 6's D5 for one quarter, not two", JSON.stringify(r.drawn) === '[1]', JSON.stringify(r.drawn));
  check('the page ran without an error', h.errors.length === 0, h.errors.join(' | '));
  await h.close();
}

/* ---- sim, switching, hint ---- */
async function sectionSmall(browser, url) {
  head('the simulation, a change of option, resuming a pause, the keyboard hint');
  const h = await openPage(browser, url);
  const sims = await each(h, 'sim', items([JUMPS[0], GRACES[0], REPEATS[0]]).concat([fixtureItem()]));
  sims.forEach(r => check('without a keyboard ' + short(r.file) + ': ' + r.tot + ' notes judged (' + r.graces + ' graces are heard, not judged)', r.fail.length === 0, failList(r)));
  check('some piece of them has grace notes', sims.some(r => r.graces > 0), JSON.stringify(sims.map(r => r.graces)));
  const sw = await each(h, 'switching', items([JUMPS[0], REPEATS[0]]));
  sw.forEach(r => {
    const problems = [];
    if (!r.distinct) problems.push('"off" gave the plan of "on"');
    if (!r.back) problems.push('"on" again is not the plan it was');
    if (!r.offIsCompat) problems.push('"off" is not the legacy plan to the bit');
    if (!(r.gates[0] > r.gates[1] && r.gates[2] === r.gates[0])) problems.push('the gates of one object do not follow the option: ' + JSON.stringify(r.gates));
    check('a change of PPP.practiceFix is seen by the plan and by the gates: ' + short(r.file), problems.length === 0, problems.join(' | '));
  });
  const rs = await each(h, 'resume', items([JUMPS[0], REPEATS[0]]).concat([fixtureItem()]));
  rs.forEach(r => check('a pause in a bar played twice is resumed there (transport, falling notes, matcher): ' + short(r.file) + (r.graph && !r.graph.none ? ', visit ' + r.graph.vIdx + ' at sounding quarter ' + r.graph.sq + ' (the first visit of the bar: ' + r.graph.first + ')' : ''), r.fail.length === 0, failList(r)));
  const hint = await each(h, 'hint', items([TIES[0], TIES[1]]));
  hint.forEach(r => check('the keyboard hint shows the note a tie leads into from nowhere (' + r.dangling + ' in ' + short(r.file) + '): on ' + r.on + ', off ' + r.off, r.fail.length === 0, failList(r)));
  check('the page ran without an error', h.errors.length === 0, h.errors.join(' | '));
  await h.close();
}

/* ---- fallbacks ---- */
async function sectionFallbacks(browser, url) {
  head('a piece the plan cannot be made for, the fixes on');
  const h = await openPage(browser, url);
  const res = await h.page.evaluate(() => window.PPPOptionsProbe.fallbacks({ file: 'catalog/method/sonatina/017.mxl' }));
  res.forEach(r => check(r.name, r.ok, r.detail));
  check('the page ran without an error', h.errors.length === 0, h.errors.join(' | '));
  await h.close();
}

/* ---- perf ---- */
async function sectionPerf(browser, url) {
  head('building a plan with the fixes on');
  const h = await openPage(browser, url);
  const rows = [];
  for (const f of ['catalog/method/sonatina/020.mxl', 'catalog/method/sonatina/017.mxl', 'catalog/method/czerny849/017.mxl', 'catalog/method/sonatina/015.mxl']) {
    const r = await h.page.evaluate(item => window.PPPOptionsProbe.perf(item, {}), { file: f });
    rows.push(r);
    console.log('    ' + short(f) + ' (' + r.notes + ' notes, ' + r.jumps + ' jumps, ' + r.graces + ' graces): legacy ' + r.legacy.toFixed(2) + ' ms, graph with the fixes off ' + r.off.toFixed(2) + ', on ' + r.on.toFixed(2) + ' ms; asked again ' + r.cachedTime.toFixed(4) + ' ms');
    check(short(f) + ': the plan with the fixes on builds in no more than the legacy build + 25% (' + r.on.toFixed(2) + ' against ' + r.legacy.toFixed(2) + ' ms)', r.on <= r.legacy * 1.25 + 0.5, r.on + ' vs ' + r.legacy);
    check(short(f) + ': asking again is the same plan, and costs nothing', r.cached && r.cachedTime < 0.05, r.cached + ' ' + r.cachedTime);
  }
  await h.close();
  return rows;
}

/* ---- sweep ---- */
async function sectionSweep(browser, url, args, base) {
  head('the corpus with the fixes on');
  const corp = Parity.corpus();
  const catalog = corp.filter(c => c.set === 'catalog');
  const every = args.sample || (args.quick ? 12 : 1);
  const always = new Set(Object.keys(base.files).filter(f => { const e = base.files[f]; return !e.x && !e.fb && (e.jf || e.gs || e.ft); }));
  const list = catalog.filter((c, i) => i % every === 0 || always.has(c.path)).concat(corp.filter(c => c.set === 'practice-fixtures' || c.set === 'parity-fixtures'));
  const by = new Map(list.map(c => [c.path, c]));
  const h = await openPage(browser, url);
  const t0 = Date.now();
  const recs = [];
  for (let i = 0; i < list.length; i += 8) {
    const part = await h.page.evaluate(its => window.PPPOptionsProbe.sweep(its), list.slice(i, i + 8).map(c => ({ file: c.path, text: c.text })));
    part.forEach(r => recs.push(r));
    if ((i + 8) % 80 === 0 || i + 8 >= list.length) console.log('  ' + Math.min(list.length, i + 8) + '/' + list.length + ' files, ' + ((Date.now() - t0) / 1000).toFixed(0) + ' s');
  }
  const name = r => (by.get(r.file).quarantined ? 'a licence-quarantined file' : r.file);
  const cat = recs.filter(r => by.get(r.file).set === 'catalog' && !r.error);
  const problems = [];
  recs.forEach(r => {
    if (r.error) { if (by.get(r.file).set === 'catalog') problems.push(name(r) + ': ' + r.error); return; }
    (r.fail || []).forEach(f => problems.push(name(r) + ': ' + f));
    if (r.via === 'live' && r.linkOk && !r.graph) problems.push(name(r) + ': the renderer resolves it and no plan was made from the graph');
  });
  check('every file is planned from its graph, Play strikes what the matcher asks, and Follow asks what Play strikes (' + recs.length + ' files)', problems.length === 0,
    problems.slice(0, 4).join(' | ') + (problems.length > 4 ? ' ... ' + (problems.length - 4) + ' more' : ''));
  const fb = cat.reduce((n, r) => n + (r.fallback || 0), 0);
  check('fallbacks on the catalogue: 0 (' + cat.length + ' files read, ' + fb + ' counted)', fb === 0, fb);
  /* the counts per cause, read through the page, against what G11a-2 measured on the same files */
  const sums = rs => ({
    jump: rs.filter(r => r.jumps > 0).length,
    grace: rs.filter(r => r.graceStrikes > 0).length, graceEvents: rs.reduce((n, r) => n + (r.graceEvents || 0), 0),
    repeat: rs.filter(r => r.repeatGates > 0).length,
    tie: rs.filter(r => r.tieNotes > 0).length, tieNotes: rs.reduce((n, r) => n + (r.tieNotes || 0), 0)
  });
  const got = sums(cat);
  const full = every === 1;
  /* the catalogue is the open files plus the licence-quarantined ones (the baseline keeps their totals apart, never their names) */
  const sum = (a, b) => { const o = {}; Object.keys(a).forEach(c => { o[c] = {}; Object.keys(a[c]).forEach(k => { o[c][k] = a[c][k] + b[c][k]; }); }); return o; };
  const exp = sum(base.sets.catalog.causes, base.quarantined.causes);
  console.log('    per cause on ' + cat.length + ' catalogue files: ' + JSON.stringify(got));
  if (full) {
    check('JUMP: ' + exp.JUMP.files + ' catalogue files follow a sign', got.jump === exp.JUMP.files, got.jump);
    check('GRACE: ' + exp.GRACE.files + ' files / ' + exp.GRACE.events + ' grace events', got.grace === exp.GRACE.files && got.graceEvents === exp.GRACE.events, JSON.stringify([got.grace, got.graceEvents]));
    check('FOLLOW_REPEAT: ' + exp.FOLLOW_REPEAT.files + ' files ask more gates', got.repeat === exp.FOLLOW_REPEAT.files, got.repeat);
    check('FOLLOW_TIE: ' + exp.FOLLOW_TIE.files + ' files / ' + exp.FOLLOW_TIE.notes + ' notes', got.tie === exp.FOLLOW_TIE.files && got.tieNotes === exp.FOLLOW_TIE.notes, JSON.stringify([got.tie, got.tieNotes]));
  } else {
    check('every file the baseline gives a cause shows it (a sample: the totals are for the whole corpus; a licence-quarantined file has no per-file baseline)', cat.every(r => {
      if (by.get(r.file).quarantined) return true;
      const e = base.files[r.file] || {};
      return !!e.jf === (r.jumps > 0) && !!e.gs === (r.graceStrikes > 0) && (e.ge || 0) === (r.graceEvents || 0) && !!e.ft === (r.tieNotes > 0) && (e.ft || 0) === (r.tieNotes || 0);
    }), '');
  }
  const fx = recs.filter(r => by.get(r.file).set !== 'catalog');
  check('the hand-written fixtures (' + fx.length + ') are planned, and read the same way', fx.every(r => !r.error && (r.graph || !r.linkOk)), fx.filter(r => r.error || !r.graph).map(r => r.file).join(', '));
  check('the page ran without an error', h.errors.length === 0, h.errors.join(' | '));
  await h.close();
  return { files: recs.length, got: got, seconds: (Date.now() - t0) / 1000 };
}

/* ---- main ---- */
async function main() {
  const args = parseArgs(process.argv.slice(2));
  const want = name => !args.only || args.only.indexOf(name) >= 0;
  const base = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
  let srv = null, url = args.url;
  if (!url) { srv = await L.serve(); url = srv.url; }
  const browser = await L.puppeteer().launch({ headless: 'new', args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'], protocolTimeout: 900000 });
  const t0 = Date.now();
  let summary = {};
  const some = (list, n) => (args.quick ? list.slice(0, n) : list);
  try {
    if (want('choice')) await sectionChoice(browser, url);
    if (want('plans')) await sectionPlans(browser, url, base);
    if (want('laps')) await sectionLaps(browser, url);
    if (want('matcher')) await sectionMatcher(browser, url, items(some([JUMPS[0], JUMPS[6], GRACES[0], GRACES[1], REPEATS[0], REPEATS[1], PLAIN[0]], 5)).concat([fixtureItem()]));
    if (want('gates')) await sectionGates(browser, url, items(some([JUMPS[0], JUMPS[5], GRACES[0], REPEATS[0], REPEATS[1], TIES[2], PLAIN[0]], 5)).concat([fixtureItem()]));
    if (want('spies')) await sectionSpies(browser, url, items(some([JUMPS[0], JUMPS[6], GRACES[0], REPEATS[0]], 3)).concat([fixtureItem()]));
    if (want('visual')) await sectionVisual(browser, url, items(some([JUMPS[0], JUMPS[6], GRACES[0], GRACES[1], PLAIN[0]], 3)).concat([fixtureItem()]));
    if (want('run')) await sectionRun(browser, url, items(some([JUMPS[0], JUMPS[3], REPEATS[0], GRACES[4]], 2)).concat([fixtureItem()]));
    if (want('fixture')) await sectionFixture(browser, url);
    if (want('small')) await sectionSmall(browser, url);
    if (want('fallbacks')) await sectionFallbacks(browser, url);
    if (want('perf')) summary.perf = await sectionPerf(browser, url);
    if (want('sweep')) summary.sweep = await sectionSweep(browser, url, args, base);
  } finally {
    await browser.close();
    if (srv) await srv.close();
  }
  console.log('\n' + (nOk + bad.length) + ' checks, ' + bad.length + ' failed, ' + ((Date.now() - t0) / 1000).toFixed(0) + ' s' + (summary.sweep ? '; sweep: ' + summary.sweep.files + ' files' : ''));
  if (bad.length) { console.log('FAILED:'); bad.slice(0, 30).forEach(b => console.log('  ' + b)); process.exit(1); }
}

if (require.main === module) main().catch(e => { console.error(e); process.exit(2); });
module.exports = { main, check };
