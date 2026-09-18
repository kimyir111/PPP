const puppeteer = require('puppeteer');
const { preparePage } = require('./boot');

const URL = 'http://127.0.0.1:8777/Piano%20Coach%20App.dc.html';
const errors = [];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ok = (name, cond, detail) => {
  console.log((cond ? '  ✓ ' : '  ✗ ') + name + (detail ? ' — ' + detail : ''));
  if (!cond) errors.push(name + (detail ? ' — ' + detail : ''));
};

/* Context and guardrails are pure functions over facts the engines produced,
   so these run in-page with no provider and no clock dependence. */
function harness() {
  const S = PPP.Score, L = PPP.Learning, M = PPP.Memory, C = PPP.Coach;
  PPP.Clock.now = () => 1700000000000;
  const score = PPP.buildDemoScore();
  const R = {};

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
        total, matched, missed: total - matched, wrong: 0, extra: 0,
        onTime: matched, early: 0, late: 0, timingAbsSum: d * matched, timingCount: matched,
        accuracy: total ? matched / total : 1,
        hands: { r: { total: rN, matched: rM, timingAbsSum: d * rM, timingCount: rM },
                 l: { total: lN, matched: lM, timingAbsSum: d * lM, timingCount: lM } }
      };
      exp += total; mat += matched; tsum += d * matched; tcnt += matched;
    }
    const a = exp ? mat / exp : 1;
    return { accuracy: a, noteAccuracy: a, timingAccuracy: 1, meanDeltaMs: tcnt ? Math.round(tsum / tcnt) : 0,
      byMeasure, byHand: {}, bySection: {},
      counts: { expected: exp, matched: mat, missed: exp - mat, wrong: 0, extra: 0, onTime: mat, early: 0, late: 0 },
      run: { from, to, hands: 'both', tempo: o.tempo || score.tempo } };
  };
  const practise = (h, times, from, to, o) => {
    let out = h;
    for (let i = 0; i < times; i++)
      out = L.record(out, mkResult(from, to, o), { at: PPP.Clock.now(), tempo: o.tempo || score.tempo,
        scoreTempo: score.tempo, hands: 'both', simulated: true });
    return out;
  };
  const ctxFor = (history, memory, stateOver) => {
    const model = {
      views: L.views(score, history), ranges: L.weakRanges(score, history),
      rec: L.recommend(score, history)
    };
    const st = Object.assign({
      loopFrom: 21, loopTo: 28, hands: 'both', tempo: score.tempo, practiceMode: 'practice',
      minutes: 12, laps: 3, lastAcc: 70, coachDone: []
    }, stateOver || {});
    return C.context({
      score, history, memory, model, state: st,
      recommendation: M.nextTask(score, history, memory, { now: PPP.Clock.now(), base: model.rec, ranges: model.ranges }),
      songProgress: 70, songMemory: 10, completed: []
    });
  };

  /* ---- a player with a measured left-hand problem in 21–24 ---- */
  let hist = L.empty();
  hist = practise(hist, 4, 21, 28, { r: 0.96, l: 0.56, timing: 70 });
  const ctx = ctxFor(hist, M.empty());
  R.ctx = {
    title: ctx.song.title, measureCount: ctx.song.measureCount,
    hasHistory: ctx.learning.hasHistory,
    weakTop: ctx.learning.weakRanges[0]
      ? { from: ctx.learning.weakRanges[0].from, to: ctx.learning.weakRanges[0].to,
          left: ctx.learning.weakRanges[0].leftAccuracy, right: ctx.learning.weakRanges[0].rightAccuracy,
          explain: ctx.learning.weakRanges[0].explanation[0] } : null,
    measuresSummarised: Object.keys(ctx.learning.measures).length,
    sampleMeasure: ctx.learning.measures[22] || null,
    allowedCount: ctx.allowed.measures.length,
    memorySections: ctx.memory.sections.length,
    eligibleCount: ctx.allowed.memoryEligibleSections.length,
    recKind: ctx.recommendation ? ctx.recommendation.kind : null,
    structuralNote: ctx.structural.note,
    keys: Object.keys(ctx)
  };
  /* raw performance data must not travel */
  const json = JSON.stringify(ctx);
  R.leak = {
    bytes: json.length,
    hasMidiField: /"midi"\s*:/.test(json),
    hasVelocity: /"velocity"/.test(json),
    hasNoteEvents: /"noteOn"|"deltaMs"|"channel"|"timeStamp"/.test(json),
    hasNotesArray: /"notes"\s*:\s*\[/.test(json)
  };

  /* ---- guardrails ---- */
  const base = { summary: 'x', todayGoal: 'y', coachNote: '', sessionMinutes: 15 };
  const task = o => Object.assign({ range: { start: 21, end: 24 }, hand: 'both', tempoPercent: 75, mode: 'practice', repetitions: 2, reason: 'ok' }, o);
  const v = plan => C.validate(JSON.parse(JSON.stringify(plan)), ctx);

  R.goodPlan = v(Object.assign({}, base, { tasks: [task()] }));
  R.badMeasure = v(Object.assign({}, base, { tasks: [task({ range: { start: 900, end: 901 } })] }));
  R.badMeasureMixed = v(Object.assign({}, base, { tasks: [task({ range: { start: 900, end: 901 } }), task()] }));
  R.badHand = v(Object.assign({}, base, { tasks: [task({ hand: 'third' })] }));
  R.badMode = v(Object.assign({}, base, { tasks: [task({ mode: 'sightread' })] }));
  R.lockedMemory = v(Object.assign({}, base, { tasks: [task({ mode: 'memory' })] }));
  R.wildTempo = v(Object.assign({}, base, { tasks: [task({ tempoPercent: 400 })] }));
  R.wildReps = v(Object.assign({}, base, { tasks: [task({ repetitions: 99 })] }));
  R.backwards = v(Object.assign({}, base, { tasks: [task({ range: { start: 24, end: 21 } })] }));
  R.notAnObject = v('nope');
  R.noTasks = v(Object.assign({}, base, { tasks: [] }));
  /* an invented measurement must not survive */
  R.invented = v(Object.assign({}, base, {
    summary: 'Your left hand is at 3% accuracy here.',
    tasks: [task({ reason: 'Right hand measured 91% in these bars.' })]
  }));
  /* a figure that IS in the context may stay */
  const realPct = ctx.learning.weakRanges[0].leftAccuracy;
  R.realFigure = v(Object.assign({}, base, {
    summary: 'Left hand is at ' + realPct + '% in measures 21–24.', tasks: [task()]
  }));
  R.realPct = realPct;

  /* memory becomes permissible once a section has earned it */
  let solid = L.empty();
  solid = practise(solid, 4, 1, 8, { acc: 0.98, timing: 30 });
  const ctxSolid = ctxFor(solid, M.empty(), { loopFrom: 1, loopTo: 8 });
  R.memoryAllowed = C.validate(Object.assign({}, base, {
    tasks: [task({ range: { start: 1, end: 8 }, mode: 'memory' })]
  }), ctxSolid);
  R.eligibleSolid = ctxSolid.allowed.memoryEligibleSections.length;

  /* ---- deterministic planning ---- */
  R.detWeak = C.deterministicPlan(ctx);
  const fresh = ctxFor(L.empty(), M.empty());
  R.detFresh = C.deterministicPlan(fresh);
  R.freshHasHistory = fresh.learning.hasHistory;
  R.freshWeakRanges = fresh.learning.weakRanges.length;
  R.freshStructural = fresh.structural.sections.length > 0;

  /* a due review should be able to enter a session */
  let mem = M.empty();
  mem = M.recordAttempt(mem, 's1', { at: PPP.Clock.now() - 5 * 86400000, level: 4, hints: [], accuracy: 0.96, byMeasure: { 1: { acc: 0.96 } } });
  mem = M.recordAttempt(mem, 's1', { at: PPP.Clock.now() - 4 * 86400000, level: 4, hints: [], accuracy: 0.96, byMeasure: { 1: { acc: 0.96 } } });
  const ctxDue = ctxFor(hist, mem);
  R.dueCount = ctxDue.memory.dueReviews.length;
  R.detDue = C.deterministicPlan(ctxDue);

  /* ---- replanning decisions ---- */
  const printA = C.fingerprint(ctx);
  let improved = practise(hist, 6, 21, 28, { r: 0.98, l: 0.97, timing: 35 });
  const ctxImproved = ctxFor(improved, M.empty());
  R.replanAfterImprovement = C.shouldReplan(printA, C.fingerprint(ctxImproved));
  let worse = practise(hist, 4, 21, 28, { r: 0.5, l: 0.4, timing: 220 });
  R.replanAfterFailure = C.shouldReplan(printA, C.fingerprint(ctxFor(worse, M.empty())));
  R.noReplanWhenStatic = C.shouldReplan(printA, C.fingerprint(ctxFor(hist, M.empty())));
  R.planChangedAfterImprovement =
    JSON.stringify(C.deterministicPlan(ctxImproved).tasks) !== JSON.stringify(R.detWeak.tasks);
  R.improvedTop = ctxImproved.learning.weakRanges[0]
    ? ctxImproved.learning.weakRanges[0].from + '-' + ctxImproved.learning.weakRanges[0].to : null;

  /* ---- provider boundary ---- */
  const bad = [
    { name: 'throws', gen: () => { throw new Error('provider exploded'); } },
    { name: 'rejects', gen: () => Promise.reject(new Error('network down')) },
    { name: 'malformed', gen: () => Promise.resolve('{ not json at all') },
    { name: 'empty', gen: () => Promise.resolve({}) },
    { name: 'all-invalid', gen: () => Promise.resolve(Object.assign({}, base, { tasks: [task({ range: { start: 999, end: 999 } })] })) }
  ];
  return Promise.all(bad.map(b =>
    C.plan(ctx, { provider: { name: 'Fake', generate: b.gen } })
      .then(r => ({ name: b.name, source: r.source, ai: r.ai, tasks: r.plan ? r.plan.tasks.length : 0, note: !!r.note }))
  )).then(fallbacks => {
    R.fallbacks = fallbacks;
    /* a good AI plan is accepted and attributed */
    return C.plan(ctx, {
      provider: {
        name: 'Fake', generate: () => Promise.resolve(Object.assign({}, base, {
          todayGoal: 'Isolate the left hand', tasks: [task({ hand: 'left', repetitions: 3 })]
        }))
      }
    });
  }).then(good => {
    R.accepted = { source: good.source, ai: good.ai, tasks: good.plan.tasks.length, goal: good.plan.todayGoal, hand: good.plan.tasks[0].hand };
    PPP.Clock.now = () => Date.now();
    return R;
  });
}

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await preparePage(page);
  await page.setViewport({ width: 1500, height: 1000 });
  page.on('pageerror', e => errors.push('[pageerror] ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('[console] ' + m.text()); });

  await page.goto(URL, { waitUntil: 'networkidle2', timeout: 45000 });
  await page.waitForFunction(() => window.PPP && window.PPP.Coach, { timeout: 25000 });
  await sleep(600);
  const R = await page.evaluate(harness);

  console.log('\n── what the coach is allowed to know ──');
  ok('the context carries the real song', R.ctx.title === 'Interstellar Theme' && R.ctx.measureCount === 64,
    R.ctx.title + ', ' + R.ctx.measureCount + ' measures');
  ok('it carries measured weakness, not a guess',
    !!R.ctx.weakTop && R.ctx.weakTop.left < R.ctx.weakTop.right,
    R.ctx.weakTop ? 'measures ' + R.ctx.weakTop.from + '–' + R.ctx.weakTop.to + ': left ' + R.ctx.weakTop.left + '%, right ' + R.ctx.weakTop.right + '%' : 'none');
  ok('it carries the deterministic explanation', /Left hand accuracy is \d+%/.test(R.ctx.weakTop.explain || ''), R.ctx.weakTop.explain);
  ok('per-measure data is summarised', R.ctx.measuresSummarised > 0 && !!R.ctx.sampleMeasure,
    R.ctx.measuresSummarised + ' measures, e.g. ' + JSON.stringify(R.ctx.sampleMeasure));
  ok('it declares what a plan may reference',
    R.ctx.allowedCount === 64 && Array.isArray(R.ctx.keys) && R.ctx.keys.indexOf('allowed') > -1,
    R.ctx.allowedCount + ' allowed measures');
  ok('it carries the deterministic recommendation', !!R.ctx.recKind, R.ctx.recKind);

  console.log('\n── raw performance data stays home ──');
  ok('no MIDI note events in the context',
    !R.leak.hasNoteEvents && !R.leak.hasVelocity && !R.leak.hasMidiField,
    'velocity=' + R.leak.hasVelocity + ' events=' + R.leak.hasNoteEvents + ' midi=' + R.leak.hasMidiField);
  ok('no note array in the context', !R.leak.hasNotesArray);
  ok('the context stays compact', R.leak.bytes < 60000, Math.round(R.leak.bytes / 1024) + ' KB');

  console.log('\n── guardrails ──');
  ok('a valid plan is accepted', R.goodPlan.ok && R.goodPlan.plan.tasks.length === 1);
  ok('a measure that does not exist is rejected',
    !R.badMeasure.ok && /not in this score/.test(JSON.stringify(R.badMeasure.issues)),
    (R.badMeasure.issues[0] || {}).message);
  ok('one bad task does not sink a good one',
    R.badMeasureMixed.ok && R.badMeasureMixed.plan.tasks.length === 1,
    R.badMeasureMixed.plan ? R.badMeasureMixed.plan.tasks.length + ' task kept' : 'rejected');
  ok('an invented hand mode is rejected', !R.badHand.ok, (R.badHand.issues[0] || {}).message);
  ok('an invented practice mode is rejected', !R.badMode.ok, (R.badMode.issues[0] || {}).message);
  ok('memory work on an ineligible passage is refused',
    !R.lockedMemory.ok && /earned memory work/.test(JSON.stringify(R.lockedMemory.issues)),
    (R.lockedMemory.issues[0] || {}).message);
  ok('memory work is allowed once earned',
    R.memoryAllowed.ok && R.memoryAllowed.plan.tasks[0].mode === 'memory',
    R.eligibleSolid + ' eligible section(s)');
  ok('an out-of-range tempo is repaired, not obeyed',
    R.wildTempo.ok && R.wildTempo.plan.tasks[0].tempoPercent === 120, R.wildTempo.plan.tasks[0].tempoPercent + '%');
  ok('runaway repetitions are clamped', R.wildReps.ok && R.wildReps.plan.tasks[0].repetitions === 8);
  ok('a backwards range is corrected',
    R.backwards.ok && R.backwards.plan.tasks[0].range.start === 21 && R.backwards.plan.tasks[0].range.end === 24);
  ok('a non-object plan is rejected', !R.notAnObject.ok);
  ok('a plan with no tasks is rejected', !R.noTasks.ok);

  console.log('\n── the coach cannot invent measurements ──');
  ok('a fabricated figure is stripped from prose',
    R.invented.ok && R.invented.plan.summary === '', '"' + R.invented.plan.summary + '"');
  ok('a fabricated figure is stripped from a task reason',
    R.invented.plan.tasks[0].reason === '', '"' + R.invented.plan.tasks[0].reason + '"');
  ok('a figure PPP did measure is left alone',
    R.realFigure.ok && R.realFigure.plan.summary.indexOf(String(R.realPct)) > -1, R.realFigure.plan.summary);

  console.log('\n── deterministic planning ──');
  ok('PPP plans a real session on its own',
    R.detWeak.tasks.length >= 3 && R.detWeak.tasks.every(t => t.range && t.hand && t.mode),
    R.detWeak.tasks.length + ' tasks, ' + R.detWeak.sessionMinutes + ' min');
  ok('it isolates the measured weak hand',
    R.detWeak.tasks[0].hand === 'left', R.detWeak.tasks[0].hand + ' @ ' + R.detWeak.tasks[0].tempoPercent + '%');
  ok('it builds towards target tempo',
    R.detWeak.tasks[R.detWeak.tasks.length - 1].tempoPercent >= R.detWeak.tasks[0].tempoPercent,
    R.detWeak.tasks.map(t => t.tempoPercent + '%').join(' → '));
  ok('a due review enters the session',
    R.dueCount > 0 && R.detDue.tasks[0].mode === 'memory',
    R.dueCount + ' due, first task is ' + R.detDue.tasks[0].mode);

  console.log('\n── a score with no history ──');
  ok('an unplayed score claims no weaknesses',
    R.freshWeakRanges === 0 && R.freshHasHistory === false, R.freshWeakRanges + ' weak ranges');
  ok('it asks for a reading instead of inventing one',
    /not been practised|play it through|where you stand|not heard you play/i.test(R.detFresh.tasks[0].reason), R.detFresh.tasks[0].reason);
  ok('structural difficulty is still offered', R.freshStructural);
  ok('and is labelled as prediction, not measurement',
    /not a measurement of this player/i.test(R.ctx.structuralNote), R.ctx.structuralNote);

  console.log('\n── adaptation ──');
  ok('improvement triggers a re-plan', R.replanAfterImprovement === true);
  ok('continued failure triggers a re-plan', R.replanAfterFailure === true);
  ok('a static picture does not', R.noReplanWhenStatic === false);
  ok('the plan itself changes after improvement', R.planChangedAfterImprovement === true,
    'weakest is now ' + (R.improvedTop || 'nothing'));

  console.log('\n── provider boundary ──');
  R.fallbacks.forEach(f => {
    ok('a ' + f.name + ' provider falls back to PPP',
      f.source === 'PPP' && f.ai === false && f.tasks > 0 && f.note,
      f.tasks + ' tasks from PPP');
  });
  ok('a valid AI plan is accepted and attributed',
    R.accepted.ai === true && R.accepted.source === 'Fake' && R.accepted.hand === 'left',
    '"' + R.accepted.goal + '"');

  /* ---------- through the real UI ---------- */
  console.log('\n── the plan drives the real player ──');
  /* The fake provider is installed BEFORE the page loads, so the very first
     plan of the session is the fake one. Asking for a re-plan afterwards would
     depend on the startup request having finished — and if a real provider is
     configured on this machine, that request is still in flight and PPP
     correctly refuses to stack a second one. This suite must not care whether
     a live coach happens to be running, so it never lets one answer. */
  await page.evaluateOnNewDocument(() => {
    window.__pppCoachProvider = {
      name: 'FakeCoach',
      generate: () => Promise.resolve({
        summary: 'Fake plan for the test.',
        todayGoal: 'Drill the left hand',
        tasks: [
          { range: { start: 9, end: 12 }, hand: 'left', tempoPercent: 50, mode: 'practice', repetitions: 2, reason: 'because' },
          { range: { start: 900, end: 901 }, hand: 'both', tempoPercent: 100, mode: 'practice', repetitions: 1, reason: 'invalid' }
        ],
        coachNote: 'note', sessionMinutes: 12
      })
    };
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await sleep(2500);

  /* the coach panel lives on the player screen */
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('aside nav button')].find(x => /Practice/.test(x.innerText || ''));
    if (b) b.click();
  });
  await sleep(1200);

  const uiPlan = await page.evaluate(() => {
    const panel = [...document.querySelectorAll('main section')]
      .find(s => /PPP Coach/.test(s.innerText || ''));
    const text = panel ? panel.innerText : '';
    /* case-insensitive: the label's capitalisation is styling, not behaviour */
    return { text, source: (text.match(/PLANNED BY [^\n]+/i) || [''])[0] };
  });
  ok('an injected provider is used', /FakeCoach/i.test(uiPlan.source), uiPlan.source);
  ok('the invalid task never reaches the UI', !/900/.test(uiPlan.text) && /9–12/.test(uiPlan.text),
    (uiPlan.text.match(/Measures \d+–\d+ · [^\n]+/) || ['?'])[0]);

  const applied = await page.evaluate(async () => {
    /* scoped to the coach panel: Home and the analysis screen have their own
       "bars 9–12" buttons, and clicking one of those would prove nothing */
    const panel = [...document.querySelectorAll('main section')]
      .find(s => /PPP Coach/.test(s.innerText || ''));
    const b = [...(panel ? panel.querySelectorAll('button') : [])]
      .find(x => /bars 9–12/.test(x.innerText || ''));
    if (b) b.click();
    await new Promise(r => setTimeout(r, 800));
    const t = document.querySelector('main').innerText;
    const crumb = document.querySelector('header').innerText;
    const loop = (crumb.match(/Measures (\d+)–(\d+)/) || []).slice(1).join('-');
    const tempo = (t.match(/(\d+)\s*BPM/) || [])[1];
    /* Test what the hand setting does, not how a button is styled: with the
       left hand selected, the right-hand notes are filtered out of the score. */
    const nav = [...document.querySelectorAll('aside nav button')].find(x => /Practice/.test(x.innerText || ''));
    if (nav) nav.click();
    await new Promise(r => setTimeout(r, 800));
    const total = document.querySelectorAll('.ppp-note').length;
    const hidden = document.querySelectorAll('.ppp-note.ppp-off').length;
    return { loop, tempo, total, hidden };
  });
  ok('clicking a task configures the loop range', applied.loop === '9-12', 'loop ' + applied.loop);
  ok('clicking a task configures the tempo', +applied.tempo === 42, applied.tempo + ' BPM (50% of 84)');
  ok('clicking a task configures the hand',
    applied.hidden > 0 && applied.hidden < applied.total,
    applied.hidden + ' of ' + applied.total + ' notes hidden — right hand filtered out');

  console.log('\n────────────────────────────────────────');
  if (errors.length) {
    console.log(errors.length + ' PROBLEM(S):');
    [...new Set(errors)].forEach(e => console.log('  ✗ ' + e));
  } else console.log('CoachContext, guardrails, planning and fallback all check out.');
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})().catch(e => { console.error('HARNESS FAILURE:', e); process.exit(2); });
