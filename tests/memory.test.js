const puppeteer = require('puppeteer');
const { preparePage } = require('./boot');

const URL = 'http://127.0.0.1:8777/Piano%20Coach%20App.dc.html';
const errors = [];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ok = (name, cond, detail) => {
  console.log((cond ? '  ✓ ' : '  ✗ ') + name + (detail ? ' — ' + detail : ''));
  if (!cond) errors.push(name + (detail ? ' — ' + detail : ''));
};

/* Everything below runs on a frozen, injectable clock — no test depends on the
   real date, and "three days later" is one assignment. */
function harness() {
  const S = PPP.Score, L = PPP.Learning, M = PPP.Memory, C = PPP.Clock;
  const score = PPP.buildDemoScore();
  const DAY = 86400000;
  const T0 = 1700000000000;
  let T = T0;
  C.now = () => T;                       /* injected clock */
  const at = days => { T = T0 + days * DAY; return T; };

  const sec = score.sections[3];         /* measures 21–28 */
  const easy = score.sections[0];        /* measures 1–8 */

  /* ---- build practice history at a chosen quality ---- */
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
        onTime: matched, early: 0, late: 0, timingAbsSum: d * matched, timingCount: matched,
        accuracy: total ? matched / total : 1,
        hands: { r: { total: rN, matched: rM, timingAbsSum: d * rM, timingCount: rM },
                 l: { total: lN, matched: lM, timingAbsSum: d * lM, timingCount: lM } }
      };
      exp += total; mat += matched; tsum += d * matched; tcnt += matched;
    }
    const a = exp ? mat / exp : 1;
    return { accuracy: a, noteAccuracy: a, timingAccuracy: 1,
      meanDeltaMs: tcnt ? Math.round(tsum / tcnt) : 0, byMeasure: byMeasure,
      byHand: {}, bySection: {},
      counts: { expected: exp, matched: mat, missed: exp - mat, wrong: 0, extra: 0, onTime: mat, early: 0, late: 0 },
      run: { from: from, to: to, hands: 'both', tempo: o.tempo || score.tempo } };
  };
  const practice = (h, times, from, to, o) => {
    let out = h;
    for (let i = 0; i < times; i++)
      out = L.record(out, mkResult(from, to, o), { at: T, tempo: o.tempo || score.tempo,
        scoreTempo: score.tempo, hands: 'both', simulated: true });
    return out;
  };
  /* a recall attempt over a section, optionally with a bad measure */
  const recall = (mem, id, o) => {
    const from = o.from, to = o.to;
    const byMeasure = {};
    for (let m = from; m <= to; m++) {
      const bad = o.badMeasure === m;
      const acc = bad ? (o.badAcc == null ? 0.2 : o.badAcc) : o.accuracy;
      byMeasure[m] = { acc: acc, r: o.rightAcc == null ? acc : (bad ? o.rightAcc : acc),
                       l: o.leftAcc == null ? acc : (bad ? o.leftAcc : acc) };
    }
    const vals = Object.keys(byMeasure).map(k => byMeasure[k].acc);
    const overall = o.overall != null ? o.overall : vals.reduce((a, b) => a + b, 0) / vals.length;
    return M.recordAttempt(mem, id, {
      at: T, level: o.level, hints: o.hints || [], accuracy: overall,
      byMeasure: byMeasure, review: !!o.review,
      weakMeasure: o.badMeasure == null ? null : o.badMeasure
    });
  };

  const R = {};

  /* ===== 1. reading it well is not remembering it ===== */
  let hist = L.empty();
  hist = practice(hist, 5, easy.from, easy.to, { acc: 0.99, timing: 30 });
  let mem = M.empty();
  R.practiceOnly = {
    practiceState: L.sectionState(score, hist, easy, null).state,
    memState: M.stateOf(score, hist, easy, mem, T).state,
    strength: M.get(mem, easy.id).strength,
    memorized: M.get(mem, easy.id).memorized
  };

  /* ===== 2. an unstable section cannot start serious memory work ===== */
  let shaky = L.empty();
  shaky = practice(shaky, 4, sec.from, sec.to, { r: 0.95, l: 0.55, timing: 210 });
  R.shakyEligible = M.eligible(score, shaky, sec);
  R.solidEligible = M.eligible(score, hist, easy);

  /* ===== 3 & 4. assisted recall moves strength, hints move it less ===== */
  const assisted = recall(M.empty(), easy.id, { from: easy.from, to: easy.to, level: 2, accuracy: 0.95 });
  const hinted = recall(M.empty(), easy.id, { from: easy.from, to: easy.to, level: 2, accuracy: 0.95, hints: ['start'] });
  const blindOne = recall(M.empty(), easy.id, { from: easy.from, to: easy.to, level: 4, accuracy: 0.95 });
  R.assistedGain = M.get(assisted, easy.id).strength;
  R.hintedGain = M.get(hinted, easy.id).strength;
  R.blindGain = M.get(blindOne, easy.id).strength;

  /* ===== 5 & 6. assistance drops only on repeated clean recall ===== */
  let prog = M.empty();
  prog = recall(prog, easy.id, { from: easy.from, to: easy.to, level: 0, accuracy: 0.97 });
  R.afterOneClean = M.get(prog, easy.id).level;
  prog = recall(prog, easy.id, { from: easy.from, to: easy.to, level: 0, accuracy: 0.97 });
  R.afterTwoClean = M.get(prog, easy.id).level;
  R.notMemorizedYet = M.get(prog, easy.id).memorized;

  /* a pass that needed a hint must not advance the level */
  let held = M.empty();
  held = recall(held, easy.id, { from: easy.from, to: easy.to, level: 1, accuracy: 0.97, hints: ['left'] });
  held = recall(held, easy.id, { from: easy.from, to: easy.to, level: 1, accuracy: 0.97, hints: ['left'] });
  R.hintedNoAdvance = M.get(held, easy.id).level;

  /* ===== 7. repeated blind recall memorizes ===== */
  let blind = M.empty();
  blind = recall(blind, easy.id, { from: easy.from, to: easy.to, level: 4, accuracy: 0.96 });
  R.oneBlind = M.get(blind, easy.id).memorized;
  blind = recall(blind, easy.id, { from: easy.from, to: easy.to, level: 4, accuracy: 0.96 });
  R.twoBlind = M.get(blind, easy.id).memorized;

  /* ===== 10. and schedules a review ===== */
  const memorizedRec = M.get(blind, easy.id);
  R.scheduled = { nextReview: memorizedRec.nextReview, stage: memorizedRec.reviewStage,
    days: M.daysUntil(memorizedRec, T) };

  /* ===== 8 & 9. failure finds the weak bar and restores notation ===== */
  let fail = M.empty();
  fail = recall(fail, sec.id, { from: sec.from, to: sec.to, level: 3, accuracy: 0.6, badMeasure: 23, badAcc: 0.1 });
  R.weakAfterOne = M.weakestMeasure(M.get(fail, sec.id));
  R.levelAfterOneFail = M.get(fail, sec.id).level;
  fail = recall(fail, sec.id, { from: sec.from, to: sec.to, level: 3, accuracy: 0.6, badMeasure: 23, badAcc: 0.1 });
  R.levelAfterTwoFails = M.get(fail, sec.id).level;
  R.failExplain = M.explain(M.get(fail, sec.id), sec.from, sec.to);

  /* a hand that holds while the other slips */
  let handFail = M.empty();
  handFail = recall(handFail, sec.id, { from: sec.from, to: sec.to, level: 4, accuracy: 0.7,
    badMeasure: 24, badAcc: 0.5, rightAcc: 0.95, leftAcc: 0.3 });
  R.handExplain = M.explain(M.get(handFail, sec.id), sec.from, sec.to);

  /* ===== 11 & 12. reviews stretch on success and shrink on failure ===== */
  const firstDue = M.get(blind, easy.id).nextReview;
  at(2);                                            /* two days later */
  R.dueAtDay2 = M.due(blind, T).map(d => d.id);
  let reviewed = recall(blind, easy.id, { from: easy.from, to: easy.to, level: 4, accuracy: 0.96, review: true });
  const afterPass = M.get(reviewed, easy.id);
  R.reviewPass = { stage: afterPass.reviewStage, days: M.daysUntil(afterPass, T), grew: afterPass.nextReview - T > firstDue - T0 };

  at(20);
  let failedReview = recall(reviewed, easy.id, { from: easy.from, to: easy.to, level: 4, accuracy: 0.4, review: true });
  const afterFail = M.get(failedReview, easy.id);
  R.reviewFail = { stage: afterFail.reviewStage, days: M.daysUntil(afterFail, T),
    strengthDropped: afterFail.strength < afterPass.strength };

  /* ===== 13. a due review reaches the recommendation ===== */
  at(2);
  const ranges = L.weakRanges(score, hist);
  const base = L.recommend(score, hist);
  R.taskWithDue = M.nextTask(score, hist, blind, { now: T, base: base, ranges: ranges });
  /* but a serious technical weakness still wins */
  const severeRanges = L.weakRanges(score, shaky);
  R.taskWithSevere = M.nextTask(score, shaky, blind, { now: T, base: L.recommend(score, shaky), ranges: severeRanges });
  /* and a memory suggestion for an unearned section is downgraded */
  R.taskUnearned = M.nextTask(score, shaky, M.empty(), {
    now: T, base: { kind: 'memory', from: sec.from, to: sec.to, mode: 'memory', action: 'Start Memory Mode', reasons: [] },
    ranges: []
  });

  /* ===== musically meaningful hiding ===== */
  const planFull = M.hidePlan(score, 21, 24, 0, []);
  const plan1 = M.hidePlan(score, 21, 24, 1, []);
  const plan2 = M.hidePlan(score, 21, 24, 2, []);
  const plan3 = M.hidePlan(score, 21, 24, 3, []);
  const onsets = {};
  S.notesIn(score, 21, 24).forEach(n => { onsets[PPP.onsetKey(n.m, n.b, n.staff)] = n; });
  const total = Object.keys(onsets).length;
  const kept = plan => Object.keys(onsets).filter(k => !plan.hide[k]);
  const downbeatsKept = plan => kept(plan).filter(k => onsets[k].b < 0.001).length;
  const downbeatsTotal = Object.keys(onsets).filter(k => onsets[k].b < 0.001).length;
  R.hiding = {
    total: total,
    keptL0: kept(planFull).length, keptL1: kept(plan1).length,
    keptL2: kept(plan2).length, keptL3: kept(plan3).length,
    downbeatsTotal: downbeatsTotal,
    downbeatsKeptL1: downbeatsKept(plan1), downbeatsKeptL2: downbeatsKept(plan2)
  };
  /* the same level twice must produce the same page */
  R.stablePlan = JSON.stringify(M.hidePlan(score, 21, 24, 2, []).hide) === JSON.stringify(M.hidePlan(score, 21, 24, 2, []).hide);
  /* hints put specific things back */
  const withLeft = M.hidePlan(score, 21, 24, 2, ['left']);
  R.leftHintKeeps = Object.keys(onsets).filter(k => onsets[k].hand === 'l' && withLeft.hide[k]).length;
  const withStart = M.hidePlan(score, 21, 24, 3, ['start']);
  R.startHintKeeps = kept(withStart).length;
  R.rhythmGhosts = M.hidePlan(score, 21, 24, 3, ['rhythm']).ghost;

  C.now = () => Date.now();     /* restore */
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
  await page.waitForFunction(() => window.PPP && window.PPP.Memory, { timeout: 25000 });
  await sleep(400);
  const R = await page.evaluate(harness);

  console.log('\n── playing well is not remembering ──');
  ok('practice alone never marks a section memorized',
    R.practiceOnly.memorized === false && R.practiceOnly.strength === 0,
    'practice "' + R.practiceOnly.practiceState + '", memory "' + R.practiceOnly.memState + '", strength ' + R.practiceOnly.strength);
  ok('a well-played section reads as memory-ready, not memorized',
    R.practiceOnly.memState === 'memory-ready', R.practiceOnly.memState);

  console.log('\n── eligibility ──');
  ok('an unstable section cannot enter memory training',
    R.shakyEligible.ok === false && R.shakyEligible.reasons.length > 0, R.shakyEligible.reasons.join('; '));
  ok('a stable section can', R.solidEligible.ok === true, 'accuracy ' + Math.round(R.solidEligible.accuracy * 100) + '%');

  console.log('\n── recall moves memory, hints move it less ──');
  ok('assisted recall increases strength modestly',
    R.assistedGain > 0 && R.assistedGain < R.blindGain,
    'assisted ' + R.assistedGain.toFixed(1) + ' vs blind ' + R.blindGain.toFixed(1));
  ok('hints reduce the confidence gained',
    R.hintedGain < R.assistedGain && R.hintedGain > 0,
    'with hint ' + R.hintedGain.toFixed(1) + ' vs without ' + R.assistedGain.toFixed(1));

  console.log('\n── assistance drops only on evidence ──');
  ok('one clean recall does not reduce assistance', R.afterOneClean === 0, 'level ' + R.afterOneClean);
  ok('two clean recalls do', R.afterTwoClean === 1, 'level ' + R.afterTwoClean);
  ok('a hinted pass holds the level', R.hintedNoAdvance === 1, 'level ' + R.hintedNoAdvance);
  ok('one successful run is not memorization', R.notMemorizedYet === false && R.oneBlind === false);
  ok('two clean blind recalls memorize it', R.twoBlind === true);

  console.log('\n── where recall breaks ──');
  ok('the failed measure is identified', R.weakAfterOne && R.weakAfterOne.measure === 23,
    'measure ' + (R.weakAfterOne || {}).measure);
  ok('one failure does not restore notation', R.levelAfterOneFail === 3, 'level ' + R.levelAfterOneFail);
  ok('repeated failure restores notation', R.levelAfterTwoFails === 2, 'level ' + R.levelAfterTwoFails);
  ok('the explanation names the weak measure',
    /Measure 23 is the weakest point in your recall\./.test(R.failExplain[0] || ''), R.failExplain[0]);
  ok('a one-handed lapse is described as such',
    R.handExplain.some(x => /left-hand entry in measure 24 is unstable/.test(x)),
    R.handExplain.join(' '));

  console.log('\n── review scheduling, on an injected clock ──');
  ok('blind recall schedules a review', R.scheduled.nextReview != null && R.scheduled.days === 1,
    'in ' + R.scheduled.days + ' day(s), stage ' + R.scheduled.stage);
  ok('the review comes due', R.dueAtDay2.length === 1, R.dueAtDay2.join(','));
  ok('a passed review extends the interval',
    R.reviewPass.stage === 1 && R.reviewPass.days === 3,
    'stage ' + R.reviewPass.stage + ', next in ' + R.reviewPass.days + ' days');
  ok('a failed review shortens it and costs confidence',
    R.reviewFail.stage === 0 && R.reviewFail.days === 1 && R.reviewFail.strengthDropped,
    'stage ' + R.reviewFail.stage + ', next in ' + R.reviewFail.days + ' day, strength dropped');

  console.log('\n── choosing today\'s task ──');
  ok('a due review reaches the recommendation', R.taskWithDue.kind === 'review', R.taskWithDue.action);
  ok('serious technical weakness still outranks review',
    R.taskWithSevere.kind !== 'review', R.taskWithSevere.action);
  ok('memory work is refused until the passage has earned it',
    R.taskUnearned.kind === 'stabilise', R.taskUnearned.action);

  console.log('\n── the page is removed musically ──');
  ok('level 0 shows everything', R.hiding.keptL0 === R.hiding.total, R.hiding.keptL0 + '/' + R.hiding.total);
  ok('level 1 keeps about three quarters',
    R.hiding.keptL1 < R.hiding.total && R.hiding.keptL1 >= Math.floor(R.hiding.total * 0.7),
    R.hiding.keptL1 + '/' + R.hiding.total);
  ok('level 2 keeps about half',
    R.hiding.keptL2 < R.hiding.keptL1 && R.hiding.keptL2 >= Math.floor(R.hiding.total * 0.45),
    R.hiding.keptL2 + '/' + R.hiding.total);
  ok('level 3 hides every note', R.hiding.keptL3 === 0, R.hiding.keptL3 + ' left');
  ok('downbeats survive as anchors at level 1',
    R.hiding.downbeatsKeptL1 === R.hiding.downbeatsTotal,
    R.hiding.downbeatsKeptL1 + '/' + R.hiding.downbeatsTotal + ' bar-line onsets kept');
  ok('downbeats survive as anchors at level 2',
    R.hiding.downbeatsKeptL2 === R.hiding.downbeatsTotal,
    R.hiding.downbeatsKeptL2 + '/' + R.hiding.downbeatsTotal);
  ok('the same level always hides the same notes', R.stablePlan === true);
  ok('the left-hand hint restores the left hand', R.leftHintKeeps === 0, R.leftHintKeeps + ' left-hand onsets still hidden');
  ok('the starting-note hint restores the opening', R.startHintKeeps > 0 && R.startHintKeeps <= 2, R.startHintKeeps + ' onset group(s) shown');
  ok('rhythm-only ghosts rather than hides', R.rhythmGhosts === true);

  /* ---------- survives a reload ---------- */
  console.log('\n── survives a reload ──');
  const saved = await page.evaluate(async () => {
    /* drive a real recall through the UI so the component writes it */
    const click = re => {
      const b = [...document.querySelectorAll('main button, aside button')].find(x => re.test((x.innerText || '').trim()));
      if (b) b.click(); return !!b;
    };
    /* one measure, so a recall lap completes in a couple of seconds */
    click(/^Measure Loop$/);
    await new Promise(r => setTimeout(r, 400));
    const cells = document.querySelectorAll('button[title^="Measure "]');
    cells[20].click(); cells[20].click();
    await new Promise(r => setTimeout(r, 300));
    click(/^Memory Mode$/);
    await new Promise(r => setTimeout(r, 500));
    const started = click(/^Start recall$/);
    await new Promise(r => setTimeout(r, 7000));
    click(/^Pause$/);
    await new Promise(r => setTimeout(r, 800));
    let st = null;
    try { st = JSON.parse(localStorage.getItem('ppp.state.v2')); } catch (e) {}
    return { started: started, rev: st && st.memory ? st.memory.rev : null,
      sections: st && st.memory ? Object.keys(st.memory.sections) : [] };
  });
  ok('a recall attempt runs from the UI', saved.started === true);
  ok('memory state is written to storage', saved.rev > 0 && saved.sections.length > 0,
    'rev ' + saved.rev + ', sections ' + saved.sections.join(','));

  await page.reload({ waitUntil: 'networkidle2' });
  await page.waitForFunction(() => window.PPP && window.PPP.Memory, { timeout: 25000 });
  await sleep(900);
  const restored = await page.evaluate(() => {
    let st = null;
    try { st = JSON.parse(localStorage.getItem('ppp.state.v2')); } catch (e) {}
    return { rev: st && st.memory ? st.memory.rev : null,
      sections: st && st.memory ? Object.keys(st.memory.sections) : [] };
  });
  ok('memory state survives the reload',
    restored.rev === saved.rev && restored.sections.join(',') === saved.sections.join(','),
    'rev ' + restored.rev);

  console.log('\n────────────────────────────────────────');
  if (errors.length) {
    console.log(errors.length + ' PROBLEM(S):');
    [...new Set(errors)].forEach(e => console.log('  ✗ ' + e));
  } else console.log('Memory learning, hiding, scheduling and persistence all check out.');
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})().catch(e => { console.error('HARNESS FAILURE:', e); process.exit(2); });
