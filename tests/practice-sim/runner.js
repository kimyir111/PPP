/* G11b-0: the legacy-policy runner (docs/GOALS/G11_ADAPTIVE_PRACTICE.md §7.4). One synthetic learner (practice/sim.js)
   practises one piece for 23 days of 20-minute sessions, then a 7-day break, doing what today's app tells it to, with
   every decision taken by the app's own code (tests/practice-sim/app-legacy.js) and every lap judged by the app's own
   PerformanceEngine. Nothing here decides what to practise (except in the `oracle` reference arm, below ARMS).

   The two legacy arms (the two ways the app tells a person what to do today):
     coach   "Start today's plan": the session plan (Coach.deterministicPlan through Coach.plan and Coach.validate, the
             local provider: production has no AI coach, G11 E12/U8); the person runs the first task not yet done, plays
             its repetitions (advanceCoach counts them), and the page replans when Coach.shouldReplan says so
             (maybeReplan, as componentDidUpdate calls it). Each day starts with the plan the page requests on load.
     card    the recommendation card: Memory.nextTask over Learning.recommend (App.recommendation), applied with
             applyRecommendation; the Loop panel's drill steps (Learning.practiceSequence, through completeLap) move
             the hands and tempo; the person applies the card again when the steps are done, after each recall, or
             when a coach task on that same passage is done (the page's plan owns a loop that sits on its current
             task, and completeLap then counts the task's repetitions instead of the drill steps: the app's rule).
   A lap is a clock run started with Play (follow mode is not simulated; G11-D5: follow laps carry no timing).

   The learner's keys go to PerformanceEngine.noteOn in time order; the lap ends the way tick() ends one:
   advanceTo(end + window + 1), live() for the hit/total counts, result(), completeLap(), then beginRun for the next.

   Metrics (one learner; aggregated by tests/practice-sim/baseline.js):
     minutesToMastery   simulated session minutes (the music, the pause between laps, tapping a task: every arm has the
                        same 20 minutes a day) until every measure's TRUE accuracy (the simulator's, hands together,
                        rested, reading) is >= 0.9 at 0.95 x the score tempo; null if never in 23 days
     masteredShareEnd   share of measures >= 0.9 at 0.95 x tempo after the last practice day
     retention30        mean true accuracy at the score tempo on day 30, after the 7-day break;
     retainedShare30    share of measures >= 0.9 at 0.95 x tempo on day 30
     weakQuartileShare  share of practice time spent on the measures that were TRULY the weakest quarter (at the
                        score tempo) when each lap started
     masteredTimeShare  share of practice time on measures that were already truly mastered (time not needed)
     flipsPerSession    times per session the advice changed to a different passage from one lap to the next (card:
                        the recommendation the card shows after each lap; coach: the passage of the next task)
     flipsPerLap        the same per lap
     longestStreak      the most laps in a row on one passage within a session (a loop that does not end shows here)
     brier              the legacy model's predicted next-run accuracy of a measure (Learning.measureView recentAcc,
                        before the lap) against the measure's measured accuracy in the lap (result.byMeasure), squared
                        error, over every measure-attempt with history; brierOracle: the same with the simulator's own
                        expected accuracy under the lap's conditions (the floor the run-to-run noise allows) */
'use strict';
const path = require('path');
const SIM = require(path.join(__dirname, '..', '..', 'practice', 'sim.js'));

const CFG = Object.freeze({
  t0: Date.UTC(2026, 0, 5, 18, 0, 0),   /* a Monday, 18:00; any fixed instant */
  practiceDays: 23, breakDays: 7, retentionDay: 30,
  sessionMinutes: 20,
  lapOverheadMs: 4000,                  /* between laps: hands back, a breath, Play */
  taskChangeMs: 6000,                   /* tapping a task or the card, and reading it */
  masteryAcc: 0.9, masteryRatio: 0.95,
  maxLapsPerSession: 400                /* a guard; 20 minutes of the shortest lap is far below it */
});
/* coach and card are the legacy policy; oracle is NOT a policy anyone could ship (it reads the simulator's ground truth):
   every lap it puts the loop on the truly weakest measure and the next one, both hands, at 75 % while that measure is
   below 50 % at the score tempo and at 100 % after, through the app's own applyRecommendation. It is there to show that
   the metrics can tell policies apart and that mastery is reachable in the simulated month - a reference, not a target. */
const ARMS = ['coach', 'card', 'oracle'];
const LEGACY_ARMS = ['coach', 'card'];

function measureIndex(score) { const o = {}; score.measures.forEach((mm, i) => { o[mm.number] = i; }); return o; }

/* the matcher's expected list joined to the plan strike it came from (begin() filters plan.strikes by hand, in order) */
function lapNotes(perf, idx) {
  const plan = perf._plan;
  const strikes = (plan.strikes || []).filter(s => perf._handOk(s.note, perf.run.hands));
  if (strikes.length !== perf.expected.length) throw new Error('runner: the expected list is not the hand-filtered strikes');
  return perf.expected.map((x, k) => {
    const s = strikes[k];
    return { midi: x.midi, tMs: x.tMs, i: idx[x.m], hand: x.hand === 'l' ? 'l' : 'r', rep: s.visit + '|' + idx[x.m], q: s.q };
  });
}

/* seconds of music in [from, to], per measure index, for one pass of the lap's plan (repeats are visits) */
function lapMeasureMs(plan, scale, idx, PianoScore) {
  const out = new Map();
  (plan.visits || []).forEach(v => {
    const ms = PianoScore.msAt(plan, v.soundQ + v.lenQ, scale) - PianoScore.msAt(plan, v.soundQ, scale);
    const i = idx[v.number];
    out.set(i, (out.get(i) || 0) + ms);
  });
  return out;
}

async function simulate(env, piece, type, k, arm) {
  const { E, newApp, drainTimers } = env;
  if (ARMS.indexOf(arm) < 0) throw new Error('runner: unknown arm ' + arm);
  const seed = SIM.hashSeed(piece.id + '|' + type + '|' + k);
  const L = SIM.makeLearner(type, piece, seed, CFG.t0);
  const g = SIM.rng(SIM.hashSeed(seed + '|play'));
  const score = piece.score;
  const idx = measureIndex(score);
  const scoreTempo = score.tempo || 84;
  let now = CFG.t0;
  E.Clock.now = () => now;

  const app = newApp();
  /* the plan request's promise, kept so the runner can wait for it (requestPlan is the app's; this only remembers
     what it returned - maybeReplan calls it without returning it) */
  const requestPlan = app.requestPlan;
  app.requestPlan = function (o) { const p = requestPlan.call(this, o); this._pendingPlan = p; return p; };
  const settle = async () => { while (app._pendingPlan) { const p = app._pendingPlan; app._pendingPlan = null; await p; } };
  app.adoptScore(score);
  await Promise.all(drainTimers());       /* adoptScore's first plan (setTimeout 0) */

  const m = {
    laps: 0, minutes: 0, minutesToMastery: null, lapsToMastery: null,
    hands: { both: 0, left: 0, right: 0 }, memoryLaps: 0, tempoRatioSum: 0,
    weakMs: 0, masteredMs: 0, totalMusicMs: 0, flips: 0, flipLaps: 0, sessions: 0,
    brier: [], brierOracle: [], taskChanges: 0, longestStreak: 0
  };
  const isMastered = acc => acc != null && acc >= CFG.masteryAcc;
  const target = () => {
    const S = app.state;
    if (arm === 'card') { const r = app.recommendation(); return r ? r.from + '-' + r.to : ''; }
    return S.loopFrom + '-' + S.loopTo;
  };

  for (let day = 0; day < CFG.practiceDays; day++) {
    now = CFG.t0 + day * SIM.DAY;
    SIM.advance(L, now);
    /* a new visit to the page: it asks for today's plan on load (componentDidMount) */
    app.requestPlan();
    await settle();
    let elapsed = 0, prevTarget = null, lapsToday = 0, streak = 0, prevRange = null;
    const start = () => {
      if (arm === 'oracle') {
        const t1 = SIM.truth(L, 1);
        let wi = -1;
        t1.forEach((a, i) => { if (a != null && (wi < 0 || a < t1[wi])) wi = i; });
        /* the two-bar window that really plays that measure: a loop that starts on a second-ending bar does not play
           it (Score.form takes the first pass, which skips that ending - measured on burgmuller-002 bar 28) */
        const nM = score.measures.length, num = j => score.measures[Math.max(0, Math.min(nM - 1, j))].number;
        const want = num(wi);
        const tries = [[wi, wi + 1], [wi - 1, wi], [wi - 1, wi + 1], [wi - 2, wi], [wi, wi + 2], [0, nM - 1]];
        const win = tries.find(([x, y]) => E.PianoScore.of(score, num(x), num(y)).visits.some(v => v.number === want)) || [0, nM - 1];
        const a = num(win[0]), b = num(win[1]);
        const pct = t1[wi] < 0.5 ? 75 : 100;
        const S0 = app.state;
        if (S0.loopFrom === a && S0.loopTo === b && S0.tempo === Math.round(scoreTempo * pct / 100) && S0.loop && S0.practiceMode === 'practice') return;
        app.applyRecommendation({ from: a, to: b, hands: 'both', tempo: Math.max(30, Math.min(200, Math.round(scoreTempo * pct / 100))), mode: 'practice', action: '' });
      } else if (arm === 'coach') app.startToday();
      else app.applyRecommendation(app.recommendation());
      now += CFG.taskChangeMs; elapsed += CFG.taskChangeMs; m.minutes += CFG.taskChangeMs / SIM.MIN; m.taskChanges++;
    };
    start();
    m.sessions++;
    while (elapsed < CFG.sessionMinutes * SIM.MIN && lapsToday < CFG.maxLapsPerSession) {
      const S = app.state;
      const [from, to] = app.range(S);
      const ratio = S.tempo / scoreTempo;
      const memory = S.practiceMode === 'memory';
      const hide = memory ? (E.MEMORY.hideFraction[app.memLevel()] || 0) : 0;
      const ctx = { ratio: ratio, both: S.hands === 'both', hide: hide, fatigue: SIM.fatigueAt(elapsed / SIM.MIN) };
      SIM.advance(L, now);

      /* Play: the run starts now (beginRun with the lap's first beat heard at `now`) */
      app.beginRun(S, E.Score.startQ(score, from), now);
      const perf = app._perf;
      const notes = lapNotes(perf, idx);

      /* before the lap: the legacy prediction per measure, and the truth's weakest quarter */
      const preds = [];
      score.measures.forEach(mm => {
        if (mm.number < from || mm.number > to) return;
        const st = S.history.byMeasure[mm.number];
        if (!st || !st.attempts) return;
        const v = E.Learning.measureView(st);
        preds.push([mm.number, v.recentAcc]);
      });
      const truth1 = SIM.truth(L, 1);
      const order = truth1.map((a, i) => [a, i]).filter(x => x[0] != null).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      const weakSet = new Set(order.slice(0, Math.max(1, Math.ceil(order.length / 4))).map(x => x[1]));
      const truthM = SIM.truth(L, CFG.masteryRatio);

      /* the lap */
      const play = SIM.perform(L, notes, ctx, g);
      play.events.forEach(ev => perf.noteOn(ev));
      const plan = perf._plan, scale = perf._scale;
      const lapMs = E.PianoScore.msAt(plan, plan.soundLengthQ, scale) - E.PianoScore.msAt(plan, 0, scale);
      perf.advanceTo(perf.run.startedAt + E.PianoScore.msAt(plan, plan.soundLengthQ, scale) + perf.timing.window + 1);
      const live = perf.live();
      const result = perf.result();
      const patch = { beat: E.Score.startQ(score, from), runHit: live.matched, runTot: live.seen };
      Object.assign(patch, app.completeLap(app.state, live.matched, live.seen, result));
      const before = { plan: S.coachPlan, task: S.coachTask, done: S.coachDone.length };
      app.setState(patch);
      app.maybeReplan();                  /* componentDidUpdate */
      await settle();
      SIM.practise(L, play.reps, ctx, day);
      if (env.trace) env.trace({ day, from, to, hands: S.hands, pct: Math.round(ratio * 100), mode: S.practiceMode, hide, acc: Math.round(result.accuracy * 100), kind: S.coachPlan && S.coachPlan.tasks[S.coachTask] ? S.coachTask : null, truth: SIM.truth(L, 1).map(a => a == null ? null : Math.round(a * 100)) });

      /* metrics of the lap */
      const byM = result.byMeasure || {};
      preds.forEach(([num, pred]) => {
        const b = byM[num];
        if (!b || !b.total) return;
        const obs = b.matched / b.total;
        m.brier.push([pred, obs]);
        /* the oracle: the simulator's expected share of this measure's notes in this lap (the hands in play) */
        const i = idx[num];
        let nr = 0, nl = 0;
        notes.forEach(n => { if (n.i === i) { if (n.hand === 'l') nl++; else nr++; } });
        const exp = (nr * SIM.pHit(L, i, 'r', ctx) + nl * SIM.pHit(L, i, 'l', ctx)) / Math.max(1, nr + nl);
        m.brierOracle.push([exp, obs]);
      });
      lapMeasureMs(plan, scale, idx, E.PianoScore).forEach((ms, i) => {
        m.totalMusicMs += ms;
        if (weakSet.has(i)) m.weakMs += ms;
        if (isMastered(truthM[i])) m.masteredMs += ms;
      });
      m.laps++; lapsToday++;
      streak = (from + '-' + to) === prevRange ? streak + 1 : 1;
      prevRange = from + '-' + to;
      if (streak > m.longestStreak) m.longestStreak = streak;
      m.hands[S.hands] = (m.hands[S.hands] || 0) + 1;
      if (memory) m.memoryLaps++;
      m.tempoRatioSum += ratio;
      const spent = lapMs + CFG.lapOverheadMs;
      now += spent; elapsed += spent; m.minutes += spent / SIM.MIN;

      SIM.advance(L, now);
      if (m.minutesToMastery == null && SIM.truth(L, CFG.masteryRatio).every(a => a == null || isMastered(a))) {
        m.minutesToMastery = m.minutes; m.lapsToMastery = m.laps;
      }

      /* what the person does next */
      /* coach: a task done (or a new plan) sends the person to the next task not yet done, as the home card's button
         does; card: the drill steps done, a recall made, or a coach task of the same passage done ("Task n done" -
         the page's plan owns any loop that sits on its current task, and completeLap then counts that task's
         repetitions instead of the drill steps) send the person back to the card */
      const S2 = app.state;
      const taskMoved = S2.coachPlan !== before.plan || S2.coachTask !== before.task || S2.coachDone.length !== before.done;
      if (arm === 'oracle') start();
      else if (arm === 'coach') {
        if (taskMoved || !app.coachOwnsLoop(S2)) start();
      } else if (S2.practiceMode === 'memory' || S2.seqStep >= app.seq().length || (taskMoved && S2.coachDone.length !== before.done)) start();
      const tg = target();
      if (prevTarget != null) { m.flipLaps++; if (tg !== prevTarget) m.flips++; }
      prevTarget = tg;
    }
  }

  const tEnd = now;
  const endTruth = SIM.truth(L, CFG.masteryRatio).filter(a => a != null);
  now = CFG.t0 + CFG.retentionDay * SIM.DAY;
  SIM.advance(L, now);
  const ret1 = SIM.truth(L, 1).filter(a => a != null);
  const retM = SIM.truth(L, CFG.masteryRatio).filter(a => a != null);
  const memorized = Object.keys(app.state.memory.sections || {}).filter(id => app.state.memory.sections[id].memorized).length;
  return {
    piece: piece.id, split: piece.split, type: type, k: k, arm: arm, seed: seed,
    laps: m.laps, minutes: m.minutes, sessions: m.sessions,
    minutesToMastery: m.minutesToMastery, lapsToMastery: m.lapsToMastery,
    masteredShareEnd: endTruth.filter(isMastered).length / endTruth.length,
    retention30: ret1.reduce((a, b) => a + b, 0) / ret1.length,
    retainedShare30: retM.filter(isMastered).length / retM.length,
    weakQuartileShare: m.totalMusicMs ? m.weakMs / m.totalMusicMs : null,
    masteredTimeShare: m.totalMusicMs ? m.masteredMs / m.totalMusicMs : null,
    longestStreak: m.longestStreak,
    flipsPerSession: m.flips / m.sessions, flipsPerLap: m.flipLaps ? m.flips / m.flipLaps : 0,
    brier: SIM.brier(m.brier), brierOracle: SIM.brier(m.brierOracle), brierN: m.brier.length,
    handsShare: { left: m.hands.left / m.laps, right: m.hands.right / m.laps },
    memoryLapShare: m.memoryLaps / m.laps, meanTempoRatio: m.tempoRatioSum / m.laps,
    memorizedSections: memorized, sections: score.sections.length,
    lastPracticeAt: tEnd
  };
}

module.exports = { simulate, CFG, ARMS, LEGACY_ARMS };
