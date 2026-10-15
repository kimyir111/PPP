/* G11b-2: the arms of the practice simulator that are not the legacy app (docs/GOALS/G11_ADAPTIVE_PRACTICE.md §7.3, §20),
   and the model that watches the legacy arms. They plug into tests/practice-sim/runner.js (opts.driver, opts.observer).

   What every one of them sees is what the page sees: the app's own state, the app's own matcher result of each lap, and the
   run log entry practice/runlog.js makes of it (the page's logRun, line for line: rowsFromEngine, wrongsFromResult,
   buildEntry, with the page's own runSource to name the run). None of them sees the learner (practice/sim.js) - only the
   runner's `oracle` arm does.

     observer   practice/learner.js fed with the typed evidence of every lap, predicting each measure before the lap (the
                Brier score against the legacy recentAcc on the same attempts). It changes nothing in the page.
     policy     practice/policy.js: after every lap it decides what to play next; a new task is planned (policy.plan), passed
                through the app's own Coach.validate (the only door, G11-D8) and the VALIDATED first task is what the page is
                set to (applyRecommendation, as the card's button does). The page's legacy drill steps (the Loop panel's
                Learning.practiceSequence) are switched off under this arm: in G11b-3 the policy feeds that panel. A tempo
                step is a suggestion (U6, automatic off): the simulated person always takes the advice, as in every arm.
     random     a negative control: a random window (1-8 bars), hand, tempo (50-100 %) for 1-5 laps, seeded.
     through    a negative control: the whole piece, hands together, at the score tempo, every lap (no advice at all).
   The `none` control (no practice at all, the floor) needs no page: tests/practice-sim/policy-eval.js computes it. */
'use strict';
const path = require('path');
const vm = require('vm');
const REPO = path.resolve(__dirname, '..', '..');
const SIM = require(path.join(REPO, 'practice', 'sim.js'));
const RUNLOG = require(path.join(REPO, 'practice', 'runlog.js'));
const LEARNER = require(path.join(REPO, 'practice', 'learner.js'));
const POLICY = require(path.join(REPO, 'practice', 'policy.js'));

/* the learner model's piece: every measure's number, its length and the notes each hand strikes in one written pass (the
   plan of the whole piece, as pieces.js counts them; nothing of the simulator's difficulty) */
function pieceOf(score, E) {
  const ms = score.measures;
  const one = E.PianoScore.of(score, ms[0].number, ms[ms.length - 1].number);
  const idx = {};
  ms.forEach((mm, i) => { if (idx[mm.number] == null) idx[mm.number] = i; });
  const notes = ms.map(() => ({ r: 0, l: 0 }));
  const seen = new Set();
  one.strikes.forEach(s => {
    if (s.hand !== 'r' && s.hand !== 'l') return;
    if (seen.has(s.note)) return;
    seen.add(s.note);
    notes[idx[s.m]][s.hand]++;
  });
  return { scoreTempo: score.tempo || 84, measures: ms.map((mm, i) => ({ number: mm.number, q: mm.lenQ, notes: notes[i] })) };
}

class Observer {
  constructor(o) { this.o = o || {}; this.stats = { entries: 0, refused: {}, idle: 0 }; }
  init(c) {
    this.c = c;
    this.piece = pieceOf(c.score, c.E);
    this.model = LEARNER.create(this.piece, this.o.learner);
    this.info = RUNLOG.scoreInfo(c.score, null);
    this.runSource = vm.runInContext('runSource', c.env.ctx);
    this.seq = 0;
  }
  /* before a lap: a function from a measure index to the predicted share of its notes that land */
  predictor(now, cond) {
    const model = this.model;
    const pl = LEARNER.pools(model, now);
    const c = { ratio: cond.ratio, hands: cond.hands };
    return i => {
      const tech = LEARNER.predictMeasure(model, i, c, now, pl);
      if (tech == null) return null;
      if (!cond.memory) return tech;
      const rec = model.measures[i].rec;
      return rec ? rec.acc : tech * (1 - (cond.hide || 0));
    };
  }
  /* the page's logRun, for one finished lap */
  entryOf(lap) {
    const { S, result, perf, app, E, at } = lap;
    const kind = this.runSource(S, result);
    if (kind === 'idle' || kind === 'simulated') { this.stats.idle++; return null; }
    const [from, to] = app.range(S);
    const info = this.info;
    const fromEngine = kind !== 'follow' && perf && perf.run && perf.expected && result && result.counts && perf.expected.length === result.counts.expected;
    const rr = fromEngine ? RUNLOG.rowsFromEngine(perf, info) : RUNLOG.rowsFromResult(result, info);
    const mem = S.practiceMode === 'memory' ? E.Memory.get(S.memory, app.sectionOf(from).id) : null;
    return RUNLOG.buildEntry({
      id: 'r' + at.toString(36) + (++this.seq).toString(36), at: at, src: kind,
      mode: S.practiceMode === 'memory' ? 'memory' : 'practice', hands: S.hands, tempo: S.tempo, scoreTempo: S.score.tempo,
      from: Math.max(0, info.idxOf(from)), to: Math.max(0, info.idxOf(to)), hints: (S.hints || []).length, level: mem ? (S.memReveal ? 0 : mem.level) : 0,
      expected: rr.expected, matched: rr.matched, wrong: result && result.counts ? result.counts.wrong : 0, extra: result && result.counts ? result.counts.extra : 0,
      accuracy: result ? result.accuracy : 0, rows: rr.rows, wrongs: RUNLOG.wrongsFromResult(result, info)
    }).entry;
  }
  afterLap(lap) {
    const e = this.entryOf(lap);
    if (!e) return;
    const r = LEARNER.update(this.model, e);
    if (r.ok) this.stats.entries++; else this.stats.refused[r.code] = (this.stats.refused[r.code] || 0) + 1;
  }
  report() { return { entries: this.stats.entries, idle: this.stats.idle, refused: this.stats.refused }; }
}

/* set the page to a task (the card's button: applyRecommendation), with the legacy drill steps off */
function apply(app, task, scoreTempo) {
  app.applyRecommendation({ from: task.range.start, to: task.range.end, hands: task.hand,
    tempo: Math.max(30, Math.min(200, Math.round(scoreTempo * task.tempoPercent / 100))),
    mode: task.mode === 'memory' ? 'memory' : 'practice', action: '' });
  app.setState({ seqStep: 1e9, seqReps: 0 });
}
const asCurrent = t => ({ from: t.range.start, to: t.range.end, hands: t.hand, tempoPct: t.tempoPercent, mode: t.mode });

class PolicyDriver extends Observer {
  constructor(o) {
    super(o);
    this.p = { plans: 0, rejected: 0, repaired: 0, decisions: 0, changes: 0, suggestions: 0, stuck: 0, kinds: {}, firstDiffers: 0 };
  }
  init(c) {
    super.init(c);
    this.state = POLICY.initState();
    this.current = null;
    c.app.setState({ coachPlan: null, coachTask: 0, coachReps: 0, coachDone: [] });
  }
  step(s) {
    const { app, E, now } = s;
    let ctx = null;
    const ctxOf = () => ctx || (ctx = app.coachContext());
    const d = POLICY.decide(this.model, now, this.state, { current: this.current, ctx: ctxOf, opts: this.o.policy });
    this.state = d.state;
    this.p.decisions++;
    if (d.stuck) this.p.stuck++;
    if (!d.changed) return false;
    /* the only door: the plan of this decision through the app's own Coach.validate; the validated first task is played */
    const plan = POLICY.plan(this.model, now, this.state, ctxOf(), this.o.policy);
    const ok = POLICY.checked(plan, ctxOf(), E.Coach.validate);
    this.p.plans++;
    if (!ok.ok) { this.p.rejected++; return false; }
    if (ok.issues.length) this.p.repaired++;
    const t = ok.plan.tasks[0];
    if (JSON.stringify(t) !== JSON.stringify(d.task)) this.p.firstDiffers++;
    apply(app, t, this.c.scoreTempo);
    this.current = asCurrent(t);
    this.p.changes++;
    if (d.suggestion) this.p.suggestions++;
    this.p.kinds[d.kind] = (this.p.kinds[d.kind] || 0) + 1;
    return true;
  }
  report() { return Object.assign(super.report(), { policy: this.p }); }
}

class RandomDriver extends Observer {
  init(c) {
    super.init(c);
    this.g = SIM.rng(SIM.hashSeed(c.driverSeed + '|random'));
    this.left = 0;
    this.current = null;
    this.p = { plans: 0, rejected: 0, repaired: 0 };
    c.app.setState({ coachPlan: null });
  }
  step(s) {
    if (this.left > 0) { this.left--; return false; }
    const { app, E } = s;
    const n = this.piece.measures.length;
    const ms = this.piece.measures;
    let a = this.g.int(n), b = Math.min(n - 1, a + this.g.int(8));
    while (b > a && ms[a].number > ms[b].number) b--;
    const has = h => { for (let i = a; i <= b; i++) if (ms[i].notes[h]) return true; return false; };
    let hand = ['both', 'left', 'right'][this.g.int(3)];
    if ((hand === 'left' && !has('l')) || (hand === 'right' && !has('r'))) hand = 'both';
    const pct = 50 + 10 * this.g.int(6);
    this.left = this.g.int(5);
    const task = { range: { start: ms[a].number, end: ms[b].number }, hand: hand, tempoPercent: pct, mode: 'practice', repetitions: this.left + 1, reason: 'A random choice (a negative control).' };
    const ok = POLICY.checked({ summary: '', todayGoal: '', tasks: [task], coachNote: '', sessionMinutes: 15 }, app.coachContext(), E.Coach.validate);
    this.p.plans++;
    if (!ok.ok) { this.p.rejected++; return false; }
    if (ok.issues.length) this.p.repaired++;
    const t = ok.plan.tasks[0];
    if (this.current && JSON.stringify(asCurrent(t)) === JSON.stringify(this.current)) return false;
    apply(app, t, this.c.scoreTempo);
    this.current = asCurrent(t);
    return true;
  }
  report() { return Object.assign(super.report(), { policy: this.p }); }
}

class ThroughDriver extends Observer {
  init(c) { super.init(c); this.done = false; c.app.setState({ coachPlan: null }); }
  step(s) {
    if (this.done) return false;
    const ms = this.piece.measures;
    apply(s.app, { range: { start: ms[0].number, end: ms[ms.length - 1].number }, hand: 'both', tempoPercent: 100, mode: 'practice' }, this.c.scoreTempo);
    this.done = true;
    return true;
  }
}

const DRIVERS = { policy: PolicyDriver, random: RandomDriver, through: ThroughDriver };
function make(arm, o) {
  if (arm === 'observer') return new Observer(o);
  const D = DRIVERS[arm];
  if (!D) throw new Error('drivers: unknown arm ' + arm);
  return new D(o);
}

module.exports = { Observer, PolicyDriver, RandomDriver, ThroughDriver, make, pieceOf, apply, DRIVER_ARMS: Object.keys(DRIVERS) };
