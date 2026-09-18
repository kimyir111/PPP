const puppeteer = require('puppeteer');
const { preparePage } = require('./boot');

const URL = 'http://127.0.0.1:8777/Piano%20Coach%20App.dc.html';
const errors = [];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ok = (name, cond, detail) => {
  console.log((cond ? '  ✓ ' : '  ✗ ') + name + (detail ? ' — ' + detail : ''));
  if (!cond) errors.push(name + (detail ? ' — ' + detail : ''));
};

/* Runs inside the page. Builds run-results by hand so every assertion below is
   deterministic — no randomness, no timing races. */
function harness() {
  const S = PPP.Score, L = PPP.Learning;
  const score = PPP.buildDemoScore();

  /* One run over a measure range at given per-hand accuracy and timing error. */
  const mkResult = (from, to, o) => {
    const byMeasure = {};
    let exp = 0, mat = 0, tsum = 0, tcnt = 0;
    const rR = o.r == null ? o.acc : o.r, lR = o.l == null ? o.acc : o.l;
    const d = o.timing == null ? 40 : o.timing;
    for (let m = from; m <= to; m++) {
      const notes = S.notesIn(score, m, m);
      if (!notes.length) continue;
      const rN = notes.filter(n => n.hand === 'r').length;
      const lN = notes.filter(n => n.hand === 'l').length;
      const rM = Math.round(rN * rR), lM = Math.round(lN * lR);
      const total = rN + lN, matched = rM + lM;
      byMeasure[m] = {
        total: total, matched: matched, missed: total - matched, wrong: 0, extra: 0,
        onTime: matched, early: 0, late: 0,
        timingAbsSum: d * matched, timingCount: matched,
        accuracy: total ? matched / total : 1,
        hands: {
          r: { total: rN, matched: rM, timingAbsSum: d * rM, timingCount: rM },
          l: { total: lN, matched: lM, timingAbsSum: d * lM, timingCount: lM }
        }
      };
      exp += total; mat += matched; tsum += d * matched; tcnt += matched;
    }
    const noteAcc = exp ? mat / exp : 1;
    return {
      accuracy: noteAcc, noteAccuracy: noteAcc, timingAccuracy: 1,
      meanDeltaMs: tcnt ? Math.round(tsum / tcnt) : 0,
      byMeasure: byMeasure, byHand: {}, bySection: {},
      counts: { expected: exp, matched: mat, missed: exp - mat, wrong: 0, extra: 0, onTime: mat, early: 0, late: 0 },
      run: { from: from, to: to, hands: o.hands || 'both', tempo: o.tempo || score.tempo }
    };
  };
  const play = (h, times, from, to, o) => {
    let out = h;
    for (let i = 0; i < times; i++) {
      out = L.record(out, mkResult(from, to, o), {
        at: 1700000000000 + (out.rev + 1) * 60000,
        tempo: o.tempo || score.tempo, scoreTempo: score.tempo,
        hands: o.hands || 'both', simulated: true
      });
    }
    return out;
  };
  const view = (h, m) => L.measureView(h.byMeasure[m]);
  const R = {};

  /* --- 1. repeated failure makes a measure weak --- */
  let h = L.empty();
  h = play(h, 1, 21, 24, { acc: 0.55, timing: 180 });
  R.afterOneFail = view(h, 22).weakness;
  h = play(h, 3, 21, 24, { acc: 0.55, timing: 180 });
  R.afterFourFails = view(h, 22).weakness;
  R.weakState = view(h, 22).state;

  /* --- 2. one good run does not make a measure mastered --- */
  let g = L.empty();
  g = play(g, 1, 30, 30, { acc: 1.0, timing: 30 });
  R.oneGoodState = view(g, 30).state;
  R.oneGoodAttempts = view(g, 30).attempts;
  g = play(g, 3, 30, 30, { acc: 1.0, timing: 30 });
  R.fourGoodState = view(g, 30).state;

  /* --- 3. adjacent weak measures become one useful range --- */
  R.ranges = L.weakRanges(score, h).map(r => r.from + '-' + r.to);
  /* a single bad bar should grow, not stay a one-bar sliver */
  let one = L.empty();
  one = play(one, 4, 40, 40, { acc: 0.4, timing: 200 });
  R.singleRange = L.weakRanges(score, one).map(r => r.from + '-' + r.to);
  /* a long weak stretch splits into drillable chunks, not one huge block */
  let long = L.empty();
  long = play(long, 4, 9, 20, { acc: 0.45, timing: 190 });
  R.longRanges = L.weakRanges(score, long).map(r => r.from + '-' + r.to);
  R.longMax = Math.max.apply(null, L.weakRanges(score, long).map(r => r.to - r.from + 1));

  /* --- 4. left-hand failures recommend left-hand practice --- */
  let lh = L.empty();
  lh = play(lh, 4, 21, 24, { r: 0.97, l: 0.52, timing: 60 });
  R.lhRec = L.recommend(score, lh);
  R.lhExplain = L.explain(score, lh, 21, 24);

  /* and the mirror case */
  let rh = L.empty();
  rh = play(rh, 4, 21, 24, { r: 0.50, l: 0.97, timing: 60 });
  R.rhRecHands = L.recommend(score, rh).hands;

  /* --- 5. poor timing recommends a slower tempo --- */
  let tm = L.empty();
  tm = play(tm, 4, 21, 24, { acc: 0.93, timing: 260 });
  R.timingRec = L.recommend(score, tm);

  /* --- 6. successful repeated runs reduce weakness --- */
  let imp = L.empty();
  imp = play(imp, 4, 21, 24, { acc: 0.55, timing: 170 });
  R.weakBefore = view(imp, 22).weakness;
  R.recBefore = L.recommend(score, imp).action;
  imp = play(imp, 5, 21, 24, { acc: 0.98, timing: 40 });
  R.weakAfter = view(imp, 22).weakness;
  R.stateAfter = view(imp, 22).state;
  R.recAfter = L.recommend(score, imp).action;
  R.rangesAfter = L.weakRanges(score, imp).map(r => r.from + '-' + r.to);

  /* --- 7. stable performance unlocks memory practice --- */
  let mem = L.empty();
  /* cover the whole first section so the section can settle */
  mem = play(mem, 4, 1, 64, { acc: 0.98, timing: 35 });
  R.memRec = L.recommend(score, mem);
  R.memSection = L.sectionState(score, mem, score.sections[0], 20).state;
  R.memMeasure = view(mem, 3).state;

  /* --- 8. hand-isolated runs only score the hand that was played --- */
  let iso = L.empty();
  const isoRes = mkResult(21, 24, { r: 0.95, l: 0.95 });
  /* simulate a right-hand-only run by zeroing the left side */
  Object.keys(isoRes.byMeasure).forEach(k => {
    const b = isoRes.byMeasure[k];
    b.total -= b.hands.l.total; b.matched -= b.hands.l.matched;
    b.hands.l = { total: 0, matched: 0, timingAbsSum: 0, timingCount: 0 };
  });
  iso = L.record(iso, isoRes, { at: 1, tempo: score.tempo, scoreTempo: score.tempo, hands: 'right', simulated: true });
  const isoAgg = L.aggregate(score, iso, 21, 24);
  R.isoHands = { r: isoAgg.hands.r.expected, l: isoAgg.hands.l.expected };

  /* --- 9. tempo is tracked per bucket --- */
  let tb = L.empty();
  tb = play(tb, 2, 21, 24, { acc: 0.95, tempo: Math.round(score.tempo * 0.5) });
  tb = play(tb, 2, 21, 24, { acc: 0.60, tempo: score.tempo });
  const tbAgg = L.aggregate(score, tb, 21, 24);
  R.tempoBuckets = Object.keys(tbAgg.tempos).sort();
  R.slowBetter = L.explain(score, tb, 21, 24).join(' | ');
  R.tempoUpRec = (() => {
    /* clean at 75% but never tried at full tempo */
    let x = L.empty();
    x = play(x, 3, 21, 24, { acc: 0.97, timing: 40, tempo: Math.round(score.tempo * 0.75) });
    return L.recommend(score, x);
  })();

  /* --- 10. a fresh score asks for a reading rather than inventing weakness --- */
  R.emptyRec = L.recommend(score, L.empty());
  R.emptyRanges = L.weakRanges(score, L.empty()).length;

  /* --- 11. the drill sequence adapts to the failure --- */
  R.seqLeft = L.practiceSequence(score, lh, 21, 24).map(s => s.label + '@' + s.tempoPct);
  R.seqTiming = L.practiceSequence(score, tm, 21, 24).map(s => s.label + '@' + s.tempoPct);
  R.seqFresh = L.practiceSequence(score, L.empty(), 21, 24).map(s => s.label + '@' + s.tempoPct);

  /* --- 12. history stays bounded --- */
  let big = L.empty();
  big = play(big, 60, 21, 21, { acc: 0.8 });
  R.runsCapped = big.runs.length;
  R.recentCapped = big.byMeasure[21].recent.length;
  R.noRawMidi = Object.keys(big.byMeasure[21]).indexOf('events') === -1;

  return R;
}

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await preparePage(page);
  await page.setViewport({ width: 1500, height: 1000 });
  page.on('pageerror', e => errors.push('[pageerror] ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('[console] ' + m.text()); });

  await page.goto(URL, { waitUntil: 'networkidle2', timeout: 45000 });
  await page.waitForFunction(() => window.PPP && window.PPP.Learning, { timeout: 25000 });
  await sleep(400);
  const R = await page.evaluate(harness);

  console.log('\n── weakness from repeated failure ──');
  ok('failing once registers, failing repeatedly is worse',
    R.afterFourFails > R.afterOneFail,
    R.afterOneFail.toFixed(3) + ' → ' + R.afterFourFails.toFixed(3));
  ok('a repeatedly failed measure is weak', R.weakState === 'weak', R.weakState);
  ok('one good run does not mean mastered',
    R.oneGoodState !== 'stable' && R.oneGoodState !== 'memory-ready' && R.oneGoodAttempts === 1, R.oneGoodState);
  ok('repeated good runs build confidence',
    R.fourGoodState === 'stable' || R.fourGoodState === 'memory-ready', R.fourGoodState);

  console.log('\n── grouping into practice ranges ──');
  ok('adjacent weak bars form one range', R.ranges.indexOf('21-24') > -1, R.ranges.join(', '));
  ok('no one-bar fragments', R.ranges.every(r => { const [a, b] = r.split('-').map(Number); return b - a + 1 >= 2; }), R.ranges.join(', '));
  ok('a lone weak bar grows into a passage',
    R.singleRange.length === 1 && R.singleRange[0] !== '40-40', R.singleRange.join(', '));
  ok('a long weak stretch splits into drillable chunks',
    R.longRanges.length > 1 && R.longMax <= 4, R.longRanges.join(', ') + ' (max ' + R.longMax + ')');

  console.log('\n── recommendations from real data ──');
  ok('left-hand failures recommend the left hand', R.lhRec.hands === 'left', R.lhRec.action);
  ok('right-hand failures recommend the right hand', R.rhRecHands === 'right', R.rhRecHands);
  ok('the explanation names the weak hand and its accuracy',
    /Left hand accuracy is \d+% in measures 21–24\./.test(R.lhExplain[0] || ''), R.lhExplain[0]);
  ok('poor timing recommends a slower tempo',
    R.timingRec.tempoPct < 100 && R.timingRec.hands === 'both', R.timingRec.action);
  ok('the timing recommendation cites the drift', /\d+ ms/.test(R.timingRec.headline), R.timingRec.headline);
  ok('clean-but-slow recommends returning to full tempo',
    R.tempoUpRec.tempoPct === 100, R.tempoUpRec.action);
  ok('slower-is-better is detected from the tempo buckets',
    /slowed to 50%|slowed to 75%/.test(R.slowBetter), R.slowBetter.slice(0, 90));
  ok('tempo is tracked per bucket', R.tempoBuckets.join(',') === '100,50', R.tempoBuckets.join(','));

  console.log('\n── improvement changes the advice ──');
  ok('practising reduces weakness', R.weakAfter < R.weakBefore,
    R.weakBefore.toFixed(3) + ' → ' + R.weakAfter.toFixed(3));
  ok('the measure stops being weak', R.stateAfter !== 'weak', R.stateAfter);
  ok('the range is no longer flagged', R.rangesAfter.indexOf('21-24') === -1,
    R.rangesAfter.length ? R.rangesAfter.join(', ') : 'nothing flagged');
  ok('the recommendation changes after improving', R.recAfter !== R.recBefore,
    '"' + R.recBefore + '" → "' + R.recAfter + '"');

  console.log('\n── memory practice unlocks on stability ──');
  ok('stable playing recommends Memory Mode', R.memRec.mode === 'memory', R.memRec.action);
  ok('stable measures reach memory-ready', R.memMeasure === 'memory-ready', R.memMeasure);
  ok('the section reports memory-ready', R.memSection === 'memory-ready', R.memSection);

  console.log('\n── hands, sequence and storage ──');
  ok('a right-hand run records only right-hand notes',
    R.isoHands.r > 0 && R.isoHands.l === 0, JSON.stringify(R.isoHands));
  ok('a left-hand problem drills the left hand first', /^Left hand alone/.test(R.seqLeft[0] || ''), R.seqLeft.join(' → '));
  ok('a timing problem drills slowly, not hands-apart',
    R.seqTiming.every(s => !/alone/.test(s)), R.seqTiming.join(' → '));
  ok('an unplayed passage starts with a read-through', /Read it through/.test(R.seqFresh[0] || ''), R.seqFresh.join(' → '));
  ok('no practice data asks for a reading, not a guess',
    R.emptyRec.kind === 'assess' && R.emptyRanges === 0, R.emptyRec.action);
  ok('run history is capped', R.runsCapped <= 40, R.runsCapped + ' runs kept of 60');
  ok('per-measure recents are capped', R.recentCapped <= 10, R.recentCapped + ' kept');
  ok('raw MIDI is not retained', R.noRawMidi === true);

  /* ---------- persistence across a reload ---------- */
  console.log('\n── survives a reload ──');
  const before = await page.evaluate(async () => {
    const click = re => {
      const b = [...document.querySelectorAll('main button, aside button')].find(x => re.test((x.innerText || '').trim()));
      if (b) b.click();
    };
    await window.__pppTest.practice('Loop a passage');
    const cells = document.querySelectorAll('button[title^="Measure "]');
    cells[20].click(); cells[20].click();       /* loop one weak bar */
    await new Promise(r => setTimeout(r, 300));
    click(/^Play$/);
    await new Promise(r => setTimeout(r, 9000));
    click(/^Pause$/);
    await new Promise(r => setTimeout(r, 600));
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem('ppp.state.v2')); } catch (e) {}
    return { rev: saved && saved.history ? saved.history.rev : null, m21: saved && saved.history ? saved.history.byMeasure['21'] : null };
  });
  ok('practice is written to storage', before.rev > 0 && !!before.m21,
    'rev ' + before.rev + ', measure 21 has ' + (before.m21 ? before.m21.attempts : 0) + ' attempts');

  await page.reload({ waitUntil: 'networkidle2' });
  await page.waitForFunction(() => window.PPP && window.PPP.Learning, { timeout: 25000 });
  await sleep(900);
  const after = await page.evaluate(() => {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem('ppp.state.v2')); } catch (e) {}
    return { rev: saved && saved.history ? saved.history.rev : null,
      attempts: saved && saved.history && saved.history.byMeasure['21'] ? saved.history.byMeasure['21'].attempts : 0 };
  });
  ok('what PPP learned survives the reload',
    after.rev === before.rev && after.attempts === (before.m21 ? before.m21.attempts : -1),
    'rev ' + after.rev + ', ' + after.attempts + ' attempts');

  console.log('\n────────────────────────────────────────');
  if (errors.length) {
    console.log(errors.length + ' PROBLEM(S):');
    [...new Set(errors)].forEach(e => console.log('  ✗ ' + e));
  } else console.log('Weakness detection, adaptation and persistence all check out.');
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})().catch(e => { console.error('HARNESS FAILURE:', e); process.exit(2); });
