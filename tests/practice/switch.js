/* G11a-3: THE PRACTICE SWITCH (docs/GOALS/G11 section 6.3, G11-D11). PPP.practice = 'legacy' (default) | 'graph', and practicePlan(), the one function the nine places that used to ask
   PianoScore.of for a plan now ask. What must hold, in a real page:

     switch      'legacy' is the default, and anything that is not exactly 'legacy' or 'graph' is legacy (?practice=garbage, a stored garbage value, a throwing localStorage); 'legacy' never
                 requests practice/plan.js (the page does not even know it); 'graph' requests it once, and the setter PPP.practice = ... does the same and is remembered
     identity    under 'legacy' practicePlan IS PianoScore.of (the very object); the scheduler's queue (every note on/off, CC64/66/67, metronome click) at 8x the written tempo on the
                 12 pieces of the parity harness has the digests recorded on the tree BEFORE this phase (tests/practice/baselines/switch.json: `record` is run on a checkout of main)
     graph       the same 12 pieces under 'graph': the same queue to the bit, and the scheduler really ran on a graph plan; five scripted performances through the real
                 PerformanceEngine give the same verdicts, results and Learning.record history, `expected` carries evId/head/mIdx (the graph's event id, by value, before and after a match: noteOn keeps the key event in `ev`) and the result byMeasureIdx; the falling notes and follow
                 mode's gates are the same
     fallback    a song whose graph does not state its music (link not ok, no graph, no identity, another measure count, a plan that cannot be built, the module not here) keeps the
                 legacy plan - the very object - and is counted by reason and by song, once per decision; nothing throws; playback is not held up; a decision made while something was
                 missing is made again when it arrives
     sweep       every file of the corpus under 'graph': the plan is the graph plan whenever the renderer resolves the song (fallbacks on the catalogue: 0), equal to the legacy plan to
                 the bit, and names the Score's own notes (what hangs on a Score note - PianoScore.hold and .struck - answers for them)
     perf        building a plan from the graph costs no more than the legacy build plus a quarter (G11 section 11)

     node tests/practice/switch.js                      all of it (about 3-4 minutes; the sweep is the 418 files of the parity corpus)
     node tests/practice/switch.js --quick              3 pieces for the scheduler and the matcher, every 12th catalogue file for the sweep (about 1 minute)
     node tests/practice/switch.js --sample 5           the sweep reads every 5th catalogue file (+ every fixture)
     node tests/practice/switch.js --only switch,spies  some sections: switch, spies, matcher, visual, gates, leak, fallbacks, late, sweep, perf
     node tests/practice/switch.js --url URL            a page already served (the mutation check's proxy); the page of a tree from before this phase answers `record` only
     node tests/practice/switch.js record               rewrite tests/practice/baselines/switch.json: run it on a checkout of main from BEFORE G11a-3 (git archive), with --url
   Needs puppeteer (npm ci; on a developer's machine NODE_PATH may point at another tree's node_modules). Exit code 1 when a check fails. */
'use strict';
const fs = require('fs');
const path = require('path');
const L = require('./lib');
const Parity = require('./parity');

const BASELINE = path.join(__dirname, 'baselines', 'switch.json');
/* Hand-written songs the catalogue has none of (tests/practice/fixtures/switch): measure numbers that skip, that are text, a pickup numbered 0 tied into bar 1 - planned from the graph, equal to the legacy plan -
   and two measures that share a number (1, 2, 2, 3): the Score puts the notes of both at the later one and the graph at their own places, so the graph plan must NOT be used (ABS_MISMATCH, counted). */
const SWITCH_FIXTURES = path.join(__dirname, 'fixtures', 'switch');
const SWITCH_EXPECT = { 'dup-numbers.musicxml': 'ABS_MISMATCH', 'tie-dup-numbers.musicxml': 'ABS_MISMATCH' };
function switchFixtures() {
  return fs.readdirSync(SWITCH_FIXTURES).filter(f => /\.musicxml$/.test(f)).sort().map(f => ({
    path: 'tests/practice/fixtures/switch/' + f, set: 'switch-fixtures', quarantined: false, text: fs.readFileSync(path.join(SWITCH_FIXTURES, f), 'utf8'), expect: SWITCH_EXPECT[f] || null }));
}
const PAGE_SRC = fs.readFileSync(path.join(__dirname, 'switch-page.js'), 'utf8');
const PLAN_FILE = /\/practice\/plan\.js(\?|$)/;
const ANY_PRACTICE = /\/practice\//;

function parseArgs(argv) {
  const a = { cmd: 'check', quick: false, sample: 0, only: null, url: null };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === 'check' || k === 'record') a.cmd = k;
    else if (k === '--quick') a.quick = true;
    else if (k === '--sample') a.sample = +argv[++i];
    else if (k === '--only') a.only = String(argv[++i] || '').split(',').filter(Boolean);
    else if (k === '--url') a.url = argv[++i];
    else throw new Error('unknown argument ' + k);
  }
  return a;
}

/* ---- checks ---- */
let nOk = 0;
const bad = [];
function check(name, ok, detail) {
  if (ok) { nOk++; console.log('  ✓ ' + name); return; }
  bad.push(name);
  console.log('  ✗ ' + name + (detail ? ' - ' + String(detail).slice(0, 400) : ''));
}
const head = s => console.log('\n' + s);

/* ---- pages ---- */
/* A page in a browser context of its own (its own localStorage), on the app, with canon.js and the probes. Options:
     query     appended to the URL            init(...initArgs)  a function run before the app's scripts           block  a RegExp of requests to refuse
     hold      a RegExp of requests held until release() is called */
async function openPage(browser, url, o) {
  o = o || {};
  const { preparePage } = require('../boot');
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await preparePage(page);
  if (o.init) await page.evaluateOnNewDocument(o.init, ...(o.initArgs || []));
  const requests = [], errors = [], held = [];
  page.on('request', r => { requests.push(r.url()); });
  page.on('pageerror', e => errors.push(e.message));
  if (o.block || o.hold) {
    await page.setRequestInterception(true);
    page.on('request', r => {
      if (o.block && o.block.test(r.url())) r.abort();
      else if (o.hold && o.hold.test(r.url())) held.push(r);
      else r.continue();
    });
  }
  await page.goto(url + (o.query || ''), { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForFunction(() => window.PPP && window.PPP.app && window.PPP.PianoScore && window.PPPScoreGraph, { timeout: 90000 });
  await page.addScriptTag({ content: L.CANON_SRC });
  await page.addScriptTag({ content: PAGE_SRC });
  return { page, ctx, requests, errors, release: async () => { for (const r of held.splice(0)) await r.continue(); }, close: () => ctx.close() };
}
const planRequests = h => h.requests.filter(u => PLAN_FILE.test(u)).length;
const practiceRequests = h => h.requests.filter(u => ANY_PRACTICE.test(u));

/* ---- the switch ---- */
async function sectionSwitch(browser, url) {
  head('the switch');
  const exercise = async page => page.evaluate(async () => {
    /* what the player does: a plan for a range, the matcher begins a run, the falling notes, a scheduler pass */
    const P = window.PPP, Probe = window.PPPSwitchProbe;
    const sc = await Probe.loadScore({ file: 'catalog/hymns/all-creatures.musicxml' });
    const a = P.Score.first(sc), b = P.Score.last(sc);
    const out = { mode: P.practice, key: (() => { try { return localStorage.getItem('ppp.practice.v1'); } catch (e) { return 'throws'; } })() };
    out.same = [[a, b], [a + 1, a + 4], [null, null], [a, null]].every(r => P.practicePlan(sc, r[0], r[1]) === P.PianoScore.of(sc, r[0], r[1]));
    out.nullScore = JSON.stringify(P.practicePlan(null)) === JSON.stringify(P.PianoScore.of(null));
    const eng = new P.PerformanceEngine(sc);
    eng.begin({ from: a, to: b, hands: 'both', tempo: sc.tempo || 84, startedAt: 0 });
    out.expected = eng.expected.length;
    out.graphPlan = !!(eng._plan && eng._plan.graph);
    out.timeline = P.PianoVisual.scoreToTimeline(sc, { from: a, to: b, tempo: sc.tempo || 84 }).notes.length;
    out.module = !!(window.PPPPractice && window.PPPPractice.plan);
    out.stats = JSON.parse(JSON.stringify(P.practiceStats));
    return out;
  });

  /* the default */
  {
    const h = await openPage(browser, url);
    const r = await exercise(h.page);
    check('the default is legacy', r.mode === 'legacy' && r.key === null, JSON.stringify([r.mode, r.key]));
    check('legacy: practicePlan is PianoScore.of (the very object, whole piece, a window, open ends)', r.same && r.nullScore);
    check('legacy: the matcher and the falling notes ran on the legacy plan, no ev on a note', !r.graphPlan && r.expected > 0 && r.timeline > 0);
    check('legacy: practice/plan.js is not requested, and the page does not know it', practiceRequests(h).length === 0 && !r.module, JSON.stringify(practiceRequests(h)));
    check('legacy: nothing is counted', r.stats.graph === 0 && r.stats.practiceFallback.total === 0, JSON.stringify(r.stats));
    check('the page ran without an error', h.errors.length === 0, h.errors.join(' | '));
    await h.close();
  }
  /* ?practice= */
  {
    const h = await openPage(browser, url, { query: '?practice=graph' });
    const loaded = await h.page.evaluate(() => window.PPP.loadPracticeModule());
    const r = await exercise(h.page);
    check('?practice=graph is graph, the module is requested exactly once', r.mode === 'graph' && loaded === true && planRequests(h) === 1 && r.module, JSON.stringify([r.mode, loaded, planRequests(h)]));
    check('graph: the matcher ran on a graph plan, the very plan practicePlan gives', r.graphPlan && !r.same && r.stats.graph >= 1 && r.stats.practiceFallback.total === 0, JSON.stringify(r.stats));
    check('?practice=graph is for that visit only (nothing is remembered)', r.key === null, String(r.key));
    check('graph: the page ran without an error', h.errors.length === 0, h.errors.join(' | '));
    await h.close();
  }
  for (const q of ['?practice=garbage', '?practice=GRAPH', '?practice=', '?practice=graph%20', '?practice=1', '?practice=legacy&practice=graph']) {
    const h = await openPage(browser, url, { query: q });
    const r = await exercise(h.page);
    check(q + ' is legacy, and nothing of practice/ is requested', r.mode === 'legacy' && practiceRequests(h).length === 0 && !r.module && r.same, JSON.stringify([r.mode, practiceRequests(h)]));
    await h.close();
  }
  /* what the device remembers */
  {
    const h = await openPage(browser, url, { init: () => { try { localStorage.setItem('ppp.practice.v1', 'graph'); } catch (e) { /* none */ } } });
    const loaded = await h.page.evaluate(() => window.PPP.loadPracticeModule());
    check('a remembered "graph" is graph, and asks for the module at start', (await h.page.evaluate(() => window.PPP.practice)) === 'graph' && loaded && planRequests(h) === 1);
    await h.close();
  }
  for (const v of ['junk', 'Graph', '', '1', 'true']) {
    const h = await openPage(browser, url, { init: v2 => { try { localStorage.setItem('ppp.practice.v1', v2); } catch (e) { /* none */ } }, initArgs: [v] });
    const r = await exercise(h.page);
    check('a remembered ' + JSON.stringify(v) + ' is legacy, nothing requested', r.mode === 'legacy' && practiceRequests(h).length === 0 && r.same, JSON.stringify([r.mode, practiceRequests(h)]));
    await h.close();
  }
  /* a storage that throws */
  {
    const throwing = () => {
      const t = () => { throw new Error('storage blocked'); };
      try { Storage.prototype.getItem = t; Storage.prototype.setItem = t; Storage.prototype.removeItem = t; } catch (e) { /* none */ }
    };
    const h = await openPage(browser, url, { init: throwing });
    const mode = await h.page.evaluate(() => window.PPP.practice);
    check('a localStorage that throws is legacy, and the page still starts', mode === 'legacy' && practiceRequests(h).length === 0, mode + ' ' + h.errors.join(' | '));
    await h.page.evaluate(() => { window.PPP.practice = 'graph'; });
    check('...setting the switch does not throw either (it is just not remembered)', (await h.page.evaluate(() => window.PPP.practice)) === 'graph');
    await h.close();
    const h2 = await openPage(browser, url, { init: throwing, query: '?practice=graph' });
    check('...and the address still chooses for that visit', (await h2.page.evaluate(() => window.PPP.practice)) === 'graph');
    await h2.close();
  }
  /* the setter */
  {
    const h = await openPage(browser, url);
    const r = await h.page.evaluate(async () => {
      const P = window.PPP, key = () => localStorage.getItem('ppp.practice.v1');
      const out = {};
      P.practice = 'graph';
      out.a = [P.practice, key()];
      /* the setter asks for the module by itself: it is here a moment later without anybody calling loadPracticeModule */
      for (let i = 0; i < 100 && !(window.PPPPractice && window.PPPPractice.plan); i++) await new Promise(r => setTimeout(r, 50));
      out.arrived = !!(window.PPPPractice && window.PPPPractice.plan);
      out.loaded = await P.loadPracticeModule();
      P.practice = 'junk';
      out.b = [P.practice, key()];
      P.practice = 'graph'; P.practice = null;
      out.c = [P.practice, key()];
      P.practice = 'legacy';
      out.d = [P.practice, key()];
      return out;
    });
    check('PPP.practice = "graph" is remembered and asks for the module', JSON.stringify(r.a) === '["graph","graph"]' && r.arrived && r.loaded === true && planRequests(h) === 1, JSON.stringify(r));
    check('a value that is no choice puts legacy back and forgets the remembered one', JSON.stringify(r.b) === '["legacy",null]' && JSON.stringify(r.c) === '["legacy",null]', JSON.stringify([r.b, r.c]));
    check('"legacy" is remembered', JSON.stringify(r.d) === '["legacy","legacy"]', JSON.stringify(r.d));
    await h.close();
  }
}

/* ---- the files the probes read ---- */
function itemsOf(list) { return list.map(c => ({ file: c.path, text: c.text })); }
async function inBatches(page, probe, items, opts, size, onBatch) {
  const out = [];
  for (let i = 0; i < items.length; i += size) {
    const part = await page.evaluate((p, its, o) => window.PPPSwitchProbe[p](its, o), probe, items.slice(i, i + size), opts);
    part.forEach(r => out.push(r));
    if (onBatch) onBatch(out.length, items.length);
  }
  return out;
}
function reportFails(label, recs) {
  recs.forEach(r => {
    const fails = r.fail || [];
    check(label + ' ' + r.file + (r.runs ? ' (' + r.runs + ' runs)' : ''), fails.length === 0, fails.slice(0, 3).join(' | ') + (fails.length > 3 ? ' ... ' + (fails.length - 3) + ' more' : ''));
  });
}

async function sectionSpies(browser, url, files, baseline) {
  head('scheduler: the 12 pieces at 8x, legacy against graph, and legacy against the tree before this phase');
  const h = await openPage(browser, url, { query: '?practice=graph' });
  await h.page.evaluate(() => window.PPP.loadPracticeModule());
  const corp = Parity.corpus();
  const list = itemsOf(files.map(f => corp.find(c => c.path === f)).filter(Boolean));
  const recs = await inBatches(h.page, 'spies', list, { graph: true }, 2);
  recs.forEach(r => {
    const fails = r.fail.slice();
    const want = baseline && baseline.spies && baseline.spies[r.file];
    if (!want) fails.push('no baseline digest: record one on a checkout of main (node tests/practice/switch.js record --url ...)');
    else if (want.digest !== r.digest || want.runs !== r.runs || want.events !== r.events) fails.push('the legacy queue is not the one recorded on main: ' + r.runs + ' runs / ' + r.events + ' events / ' + r.digest + ' against ' + want.runs + ' / ' + want.events + ' / ' + want.digest);
    if (r.graphRuns !== r.runs) fails.push('only ' + r.graphRuns + ' of ' + r.runs + ' runs used a graph plan');
    check('spies ' + r.file + ' (' + r.runs + ' runs, ' + r.events + ' events)', fails.length === 0, fails.slice(0, 3).join(' | '));
  });
  check('the page ran without an error', h.errors.length === 0, h.errors.join(' | '));
  await h.close();
  return recs;
}

async function sectionProbe(browser, url, probe, label, files, size, opts) {
  head(label);
  const h = await openPage(browser, url, { query: '?practice=graph' });
  await h.page.evaluate(() => window.PPP.loadPracticeModule());
  const corp = Parity.corpus();
  const list = itemsOf(files.map(f => corp.find(c => c.path === f)).filter(Boolean));
  const recs = await inBatches(h.page, probe, list, opts || {}, size);
  recs.forEach(r => {
    const fails = (r.fail || []).slice();
    if (r.graphRuns !== undefined && r.graphRuns === 0 && r.runs) fails.push('no run used a graph plan');
    check(probe + ' ' + r.file + ' (' + r.runs + ' runs)', fails.length === 0, fails.slice(0, 3).join(' | ') + (fails.length > 3 ? ' ... ' + (fails.length - 3) + ' more' : ''));
  });
  check('the page ran without an error', h.errors.length === 0, h.errors.join(' | '));
  await h.close();
  return recs;
}

/* ---- no call site left on the legacy plan ---- */
async function sectionLeak(browser, url) {
  head('every place that asks for a plan asks the graph');
  const h = await openPage(browser, url, { query: '?practice=graph' });
  await h.page.evaluate(() => window.PPP.loadPracticeModule());
  const res = await h.page.evaluate(() => window.PPPSwitchProbe.leak({ file: 'catalog/hymns/all-creatures.musicxml' }));
  res.forEach(r => check(r.name, r.ok, r.detail));
  check('the page ran without an error', h.errors.length === 0, h.errors.join(' | '));
  await h.close();
}

/* ---- fallbacks ---- */
async function sectionFallbacks(browser, url) {
  head('a song whose graph does not state its music');
  {
    const h = await openPage(browser, url, { query: '?practice=graph' });
    const res = await h.page.evaluate(() => window.PPPSwitchProbe.fallbacks({ file: 'catalog/hymns/all-creatures.musicxml' }));
    res.forEach(r => check(r.name, r.ok, r.detail));
    check('the page ran without an error', h.errors.length === 0, h.errors.join(' | '));
    await h.close();
  }
  /* the module is not here: refused */
  {
    const h = await openPage(browser, url, { query: '?practice=graph', block: PLAN_FILE });
    const r = await h.page.evaluate(async () => {
      const P = window.PPP, Probe = window.PPPSwitchProbe;
      const item = { file: 'catalog/hymns/all-creatures.musicxml' };
      const sc = await Probe.loadScore(item);
      const out = { mode: P.practice };
      out.loaded = await P.loadPracticeModule();
      const plan = P.practicePlan(sc);
      out.legacy = !plan.graph && plan === P.PianoScore.of(sc);
      out.reasons = JSON.parse(JSON.stringify(P.practiceStats.practiceFallback.reasons));
      out.bySong = JSON.parse(JSON.stringify(P.practiceStats.practiceFallback.bySong[String(sc.id)] || null));
      const c = { mode: 'audio', hands: 'both', loop: false, range: { from: P.Score.first(sc), to: P.Score.last(sc) } };
      out.plays = Probe.runCase(sc, c).log.notes.length;
      const eng = new P.PerformanceEngine(sc);
      eng.begin({ from: c.range.from, to: c.range.to, hands: 'both', tempo: sc.tempo || 84, startedAt: 0 });
      out.expected = eng.expected.length;
      return out;
    });
    check('the module cannot be had: the switch stays "graph", the load says false', r.mode === 'graph' && r.loaded === false, JSON.stringify(r));
    check('...the plan is the legacy plan, counted as NOT_LOADED, for the song', r.legacy && r.reasons.NOT_LOADED >= 1 && r.bySong && r.bySong.reasons.NOT_LOADED >= 1, JSON.stringify([r.legacy, r.reasons, r.bySong]));
    check('...and the player plays and the matcher expects as ever', r.plays > 0 && r.expected > 0, JSON.stringify([r.plays, r.expected]));
    await h.close();
  }
  /* the module arrives late: the song is planned again */
  {
    const h = await openPage(browser, url, { query: '?practice=graph', hold: PLAN_FILE });
    const first = await h.page.evaluate(async () => {
      const P = window.PPP;
      window.__sc = await window.PPPSwitchProbe.loadScore({ file: 'catalog/hymns/all-creatures.musicxml' });
      const p1 = P.practicePlan(window.__sc);
      window.__p1 = p1;
      return { graph: !!p1.graph, notLoaded: P.practiceStats.practiceFallback.reasons.NOT_LOADED || 0, same: P.practicePlan(window.__sc) === p1, total: P.practiceStats.practiceFallback.total };
    });
    check('before the module arrives: the legacy plan, NOT_LOADED counted once, asking again counts nothing', !first.graph && first.notLoaded === 1 && first.same && first.total === 1, JSON.stringify(first));
    await h.release();
    const second = await h.page.evaluate(async () => {
      const P = window.PPP;
      const loaded = await P.loadPracticeModule();
      const p2 = P.practicePlan(window.__sc);
      return { loaded: loaded, graph: !!p2.graph, changed: p2 !== window.__p1, total: P.practiceStats.practiceFallback.total, plans: P.practiceStats.graph };
    });
    check('after it arrives: the song is planned again, from its graph', second.loaded && second.graph && second.changed && second.total === 1 && second.plans === 1, JSON.stringify(second));
    await h.close();
  }
}

/* ---- the falling notes asked for while the module is on its way ---- */
async function sectionLate(browser, url) {
  head('the falling notes while practice/plan.js is still on its way');
  const h = await openPage(browser, url, { query: '?practice=graph', hold: PLAN_FILE });
  const first = await h.page.evaluate(() => window.PPPSwitchProbe.lateStart({ file: 'catalog/hymns/all-creatures.musicxml' }));
  check('before the module arrives: the timeline is built on the legacy plan, and kept while nothing changes', !first.graph && first.notes > 0 && first.same, JSON.stringify(first));
  await h.release();
  const second = await h.page.evaluate(() => window.PPPSwitchProbe.lateEnd());
  check('after it arrives: the timeline is built again, on the plan the transport has (visualTransportFrame follows the transport), and kept', second.loaded && second.graph && second.rebuilt && second.sameAsTransport && second.again, JSON.stringify(second));
  check('...and shows the same notes at the same times', second.sameNotes, JSON.stringify(second));
  check('the page ran without an error', h.errors.length === 0, h.errors.join(' | '));
  await h.close();
}

/* ---- the sweep ---- */
async function sectionSweep(browser, url, args) {
  head('the corpus under "graph"');
  const corp = Parity.corpus().concat(switchFixtures());
  let n = -1;
  const list = corp.filter(c => {
    if (c.set !== 'catalog') return true;
    n++;
    const every = args.sample || (args.quick ? 12 : 1);
    return n % every === 0;
  });
  const h = await openPage(browser, url, { query: '?practice=graph' });
  await h.page.evaluate(() => window.PPP.loadPracticeModule());
  const by = new Map(list.map(c => [c.path, c]));
  const t0 = Date.now();
  const recs = await inBatches(h.page, 'sweep', itemsOf(list), { projected: true }, 6, (done, all) => { if (done === all || done % 120 < 6) console.log('  ' + done + '/' + all + ' files, ' + ((Date.now() - t0) / 1000).toFixed(0) + ' s'); });
  const name = r => (by.get(r.file).quarantined ? 'a licence-quarantined file' : r.file);
  const count = pred => recs.filter(pred).length;
  const catalog = recs.filter(r => by.get(r.file).set === 'catalog');
  const expecting = recs.filter(r => by.get(r.file).expect);
  const resolved = recs.filter(r => !r.error && r.via === 'live' && r.linkOk && !by.get(r.file).expect);
  const unresolved = recs.filter(r => !r.error && !(r.via === 'live' && r.linkOk));
  const refused = recs.filter(r => r.error);
  const problems = [], expectProblems = [];
  recs.forEach(r => {
    const c = by.get(r.file);
    if (r.error) { if (c.set === 'catalog' || c.set === 'engrave-e' || c.set === 'switch-fixtures') problems.push(name(r) + ': refused (' + r.error + ')'); return; }
    (r.fail || []).forEach(f => problems.push(name(r) + ': ' + f));
    if (c.expect) {
      /* every range falls back, with the reason, and the song's own count says so */
      const ok = r.graph === 0 && r.fallback === r.ranges && r.reasons[c.expect] === r.ranges && r.song && r.song.total === r.ranges && r.song.reasons[c.expect] === r.ranges;
      if (!ok) expectProblems.push(name(r) + ': wanted ' + c.expect + ' counted for each of its ' + r.ranges + ' range(s) and for the song, got ' + JSON.stringify([r.graph, r.fallback, r.reasons, r.song]));
      return;
    }
    if (r.via === 'live' && r.linkOk && r.fallback) problems.push(name(r) + ': the renderer resolves it and the plan fell back (' + JSON.stringify(r.reasons) + ')');
    if (r.via === 'live' && r.linkOk && !r.graph) problems.push(name(r) + ': the renderer resolves it and no plan was made from the graph');
  });
  check('every file the renderer resolves is planned from its graph, and equal to the legacy plan (' + resolved.length + ' files)', problems.length === 0, problems.slice(0, 4).join(' | ') + (problems.length > 4 ? ' ... ' + (problems.length - 4) + ' more' : ''));
  check('songs whose measures share a number keep the legacy plan, counted as ABS_MISMATCH once per range and for the song (' + expecting.length + ' fixtures)', expecting.length >= 2 && expectProblems.length === 0, expectProblems.join(' | ') || 'no such fixture');
  const fixtures = recs.filter(r => by.get(r.file).set === 'switch-fixtures' && !by.get(r.file).expect);
  check('skipped, text and zero measure numbers: planned from the graph, equal to the legacy plan (' + fixtures.length + ' fixtures)', fixtures.length >= 3 && fixtures.every(r => !r.error && r.graph === r.ranges && !r.fallback && !(r.fail || []).length), fixtures.map(r => r.file.replace(/^.*\//, '') + ' ' + JSON.stringify([r.graph, r.ranges, r.fallback, r.error, r.fail])).join(' | '));
  const fbResolved = resolved.reduce((t, r) => t + r.fallback, 0);
  const fbCatalog = catalog.filter(r => !r.error && r.via === 'live' && r.linkOk).reduce((t, r) => t + r.fallback, 0);
  check('fallbacks on the catalogue: 0 (' + count(r => by.get(r.file).set === 'catalog' && !r.error) + ' catalogue files read; ' + fbCatalog + ' counted)', fbCatalog === 0 && fbResolved === 0, fbCatalog + ' / ' + fbResolved);
  /* the files the renderer does not resolve fall back, and say so */
  const reasons = {};
  unresolved.forEach(r => Object.keys(r.reasons).forEach(k => { reasons[k] = (reasons[k] || 0) + r.reasons[k]; }));
  const unresolvedBad = unresolved.filter(r => r.graph + r.fallback === 0 || (r.via !== 'projected' && r.graph));
  check('a file the renderer does not resolve to a live graph falls back and is counted (' + unresolved.length + ' files: ' + (Object.keys(reasons).map(k => k + ' ' + reasons[k]).join(', ') || 'none') + ')', unresolvedBad.length === 0, unresolvedBad.slice(0, 3).map(name).join(', '));
  if (unresolved.length) console.log('    not resolved: ' + unresolved.slice(0, 12).map(r => name(r) + ' (' + r.via + (r.linkOk ? '' : ', link not ok') + ')').join('; ') + (unresolved.length > 12 ? '; ... ' + (unresolved.length - 12) + ' more' : ''));
  if (refused.length) console.log('    refused by the importer (not a practice matter): ' + refused.length + ' (' + refused.filter(r => by.get(r.file).set !== 'catalog' && by.get(r.file).set !== 'engrave-e').length + ' reader fixtures meant to be refused)');
  /* a projected graph (the source of a song nobody holds the producer's graph of) */
  const proj = recs.filter(r => r.projLinkOk);
  const projDiff = proj.filter(r => r.projPlan === false || r.projSame === false);
  console.log('    projected graphs: ' + proj.length + ' linked, ' + projDiff.length + ' whose plan differs from the legacy plan' + (projDiff.length ? ' (' + projDiff.slice(0, 4).map(name).join(', ') + ')' : ''));
  check('the page ran without an error', h.errors.length === 0, h.errors.join(' | '));
  await h.close();
  return { files: recs.length, resolved: resolved.length, unresolved: unresolved.length, refused: refused.length, projected: proj.length, projDiff: projDiff.length, reasons: reasons, fbCatalog: fbCatalog, seconds: (Date.now() - t0) / 1000 };
}

/* ---- perf ---- */
async function sectionPerf(browser, url) {
  head('building a plan');
  const h = await openPage(browser, url, { query: '?practice=graph' });
  await h.page.evaluate(() => window.PPP.loadPracticeModule());
  const out = [];
  for (const f of ['catalog/method/sonatina/020.mxl', 'catalog/hymns/all-creatures.musicxml']) {
    const r = await h.page.evaluate(item => window.PPPSwitchProbe.perf(item, {}), { file: f });
    out.push(r);
    console.log('    ' + f + ' (' + r.notes + ' notes): legacy ' + r.legacy.toFixed(2) + ' ms, graph ' + r.graph.toFixed(2) + ' ms (plan.js alone ' + r.planOnly.toFixed(2) + ', resolveSync ' + r.resolveSync.toFixed(2) + '); first plan of a new Score: legacy ' + r.coldLegacy.toFixed(2) + ' ms, graph ' + r.coldGraph.toFixed(2) + ' ms');
    /* the budget of G11 section 11: no more than the legacy build and a quarter (a floor of half a millisecond for the timer on a tiny piece) */
    check(f.replace(/^.*\//, '') + ': the graph plan builds in no more than the legacy build + 25% (' + r.graph.toFixed(2) + ' against ' + r.legacy.toFixed(2) + ' ms)', r.graph <= r.legacy * 1.25 + 0.5, r.graph + ' vs ' + r.legacy);
    /* the first plan of a song also asks the engraver for the song's source once (resolveSync hashes the Score: 6 ms for 1,800 notes), which the legacy plan has no need of; G11 section 11 allows 10 ms
       (1x) for the whole piece, and a runner that is slower than this machine is allowed the same factor over the legacy build */
    check(f.replace(/^.*\//, '') + ': the first plan of a new song stays under the budget (' + r.coldGraph.toFixed(2) + ' ms; legacy ' + r.coldLegacy.toFixed(2) + ')', r.coldGraph <= Math.max(10, r.coldLegacy * 5), r.coldGraph + ' vs ' + r.coldLegacy);
  }
  await h.close();
  return out;
}

/* ---- main ---- */
const FILES12 = Parity.SPY_FILES;
async function main() {
  const args = parseArgs(process.argv.slice(2));
  const want = name => !args.only || args.only.indexOf(name) >= 0;
  let srv = null, url = args.url;
  if (!url) { srv = await L.serve(); url = srv.url; }
  const browser = await L.puppeteer().launch({ headless: 'new', args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'], protocolTimeout: 900000 });
  const t0 = Date.now();
  let summary = {};
  try {
    if (args.cmd === 'record') {
      const h = await openPage(browser, url);
      const corp = Parity.corpus();
      const list = itemsOf(FILES12.map(f => corp.find(c => c.path === f)));
      const recs = await inBatches(h.page, 'spies', list, { graph: false }, 2);
      const spies = {};
      recs.forEach(r => { if (r.fail.length) throw new Error(r.file + ': ' + r.fail.join(' | ')); spies[r.file] = { runs: r.runs, events: r.events, digest: r.digest }; });
      await h.close();
      fs.mkdirSync(path.dirname(BASELINE), { recursive: true });
      fs.writeFileSync(BASELINE, JSON.stringify({ schema: 1, about: 'G11a-3 off-path identity (tests/practice/switch.js): the scheduler queue of the 12 pieces of the parity harness at 8x (every note on/off, CC and click, six to eight cases a piece) as the legacy player made it on main before the switch existed (a070d70): runs, queued events and a digest of the lot. Rewritten by `node tests/practice/switch.js record --url URL` on a checkout of that tree.', spies: spies }, null, 1) + '\n');
      console.log('recorded ' + recs.length + ' pieces -> ' + path.relative(L.ROOT, BASELINE));
      return;
    }
    const baseline = fs.existsSync(BASELINE) ? JSON.parse(fs.readFileSync(BASELINE, 'utf8')) : null;
    const files = args.quick ? FILES12.slice(0, 3) : FILES12;
    if (want('switch')) await sectionSwitch(browser, url);
    if (want('spies')) await sectionSpies(browser, url, files, baseline);
    if (want('matcher')) await sectionProbe(browser, url, 'matcher', 'the matcher: five scripted performances on each plan', files, 2, { windows: 2 });
    if (want('visual')) await sectionProbe(browser, url, 'visual', 'the falling notes', files, 3);
    if (want('gates')) await sectionProbe(browser, url, 'gates', "follow mode's gates", files, 3);
    if (want('leak')) await sectionLeak(browser, url);
    if (want('fallbacks')) await sectionFallbacks(browser, url);
    if (want('late')) await sectionLate(browser, url);
    if (want('sweep')) summary.sweep = await sectionSweep(browser, url, args);
    if (want('perf')) summary.perf = await sectionPerf(browser, url);
  } finally {
    await browser.close();
    if (srv) await srv.close();
  }
  console.log('\n' + (nOk + bad.length) + ' checks, ' + bad.length + ' failed, ' + ((Date.now() - t0) / 1000).toFixed(0) + ' s' + (summary.sweep ? '; sweep: ' + summary.sweep.files + ' files, fallbacks on the catalogue ' + summary.sweep.fbCatalog : ''));
  if (bad.length) { console.log('FAILED:'); bad.slice(0, 30).forEach(b => console.log('  ' + b)); process.exit(1); }
}

if (require.main === module) main().catch(e => { console.error(e); process.exit(2); });
module.exports = { main, check };
