#!/usr/bin/env node
/* G11b-2 (docs/GOALS/G11_ADAPTIVE_PRACTICE.md §20, the acceptance "every plan passes Coach.validate, 10^4 random states"):
   practice/policy.js against the app's OWN Coach.validate (cut out of the app file, tests/practice-sim/app-legacy.js), on
   random states of the learner model, the policy's own state, the page's memory picture and the piece.

     node tests/practice/policy-validate.js [--n 10000] [--seed S]

   A state is (piece, model, policy state, context, time):
     - a fifth of them on the eight pieces of the simulator inside the app's own page methods: a random legacy history
       (Learning.record of random results) and random memory records (Memory.recordAttempt), the context from the page's
       coachContext() - exactly what Coach.validate is given in the page;
     - the rest on made-up pieces of 1-160 bars: numbers from 1, from 0 (a pickup), with gaps; bars with no notes for one hand
       or both; random memory gates, sections and due reviews (also ones whose section is NOT behind the gate);
     - the model: 0-60 random run log entries (measured, follow, memory and simulated - refused - runs, one hand or both, tempi
       30-120 %, over up to 30 days); the policy state: 0-12 decisions with random laps between them, sometimes with the gate
       closed between two decisions; sometimes random policy options.
   Each must give a decision and a plan; the plan through Coach.validate must come back ok with NO issue (nothing repaired, nothing
   dropped) and the same tasks; the decision's task alone likewise; every task names bars of the piece, a hand that plays there,
   a tempo of the ladder, the app's modes, no figure in its words; the same input gives the same decision. Exit 1 on any failure. */
'use strict';
const path = require('path');
const REPO = path.resolve(__dirname, '..', '..');
const SIM = require(path.join(REPO, 'practice', 'sim.js'));
const LE = require(path.join(REPO, 'practice', 'learner.js'));
const PO = require(path.join(REPO, 'practice', 'policy.js'));
const H = require('./learner-helpers.js');

const argv = process.argv.slice(2);
const val = n => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
const N = +(val('--n') || 10000);
const SEED = +(val('--seed') || 20261015);

function randomPiece(g) {
  const n = 1 + g.int(g.chance(0.3) ? 160 : 40);
  const scheme = g.int(3);
  let num = scheme === 1 ? 0 : 1;
  const nums = [];
  for (let i = 0; i < n; i++) { nums.push(num); num += scheme === 2 ? 1 + g.int(3) : 1; }
  const notes = nums.map(() => {
    const k = g.int(10);
    if (k === 0) return { r: 0, l: 0 };
    if (k === 1) return { r: 1 + g.int(8), l: 0 };
    if (k === 2) return { r: 0, l: 1 + g.int(8) };
    return { r: 1 + g.int(10), l: 1 + g.int(8) };
  });
  if (!notes.some(x => x.r + x.l)) notes[0] = { r: 2, l: 1 };
  return H.piece(n, { numbers: nums, notes: notes, tempo: 40 + g.int(160), q: [2, 3, 4, 6][g.int(4)] });
}
function randomCtx(g, pc) {
  const nums = pc.measures.map(m => m.number);
  const span = () => { const a = g.int(nums.length), b = Math.min(nums.length - 1, a + g.int(8)); return { from: nums[a], to: nums[b] }; };
  const eligible = [], sections = [], due = [];
  for (let k = g.int(3); k > 0; k--) eligible.push(span());
  for (let k = g.int(4); k > 0; k--) {
    const s = span();
    sections.push(Object.assign({ id: 's' + k, state: ['memory-ready', 'memorizing', 'stable', 'weak', 'due'][g.int(5)] }, g.chance(0.5) && eligible.length ? eligible[g.int(eligible.length)] : s));
  }
  for (let k = g.int(3); k > 0; k--) due.push(Object.assign({ id: 'd' + k, daysOverdue: g.int(5) }, g.chance(0.6) && eligible.length ? eligible[g.int(eligible.length)] : span()));
  const pct = [];
  for (let k = g.int(6); k > 0; k--) pct.push(g.int(101));
  return H.ctxOf(pc, { eligible: eligible, sections: sections, due: due, percentages: pct });
}
function randomOpts(g) {
  if (!g.chance(0.2)) return undefined;
  return { maxLen: 1 + g.int(32), target: 0.8 + 0.15 * g.float(), minDwell: 1 + g.int(5), switchGain: g.float(), startAcc: 0.2 + 0.7 * g.float(),
    upAcc: 0.6 + 0.35 * g.float(), downAcc: 0.1 + 0.5 * g.float(), handGap: 0.05 + 0.3 * g.float(), handRuns: g.int(4), aloneBelow: 0.4 + 0.5 * g.float(),
    stepUp: 5 * (1 + g.int(3)), stepDown: 5 * (1 + g.int(3)), review: g.chance(0.7), readShare: g.chance(0.5) ? 1 : g.float(), need: g.chance(0.2) ? 'below' : 'shortfall', autoTempo: g.chance(0.3) };
}
function randomEntry(g, pc, t) {
  const n = pc.measures.length;
  const a = g.int(n), b = Math.min(n - 1, a + g.int(g.chance(0.2) ? n : 12));
  const hands = ['both', 'both', 'left', 'right'][g.int(4)];
  const src = ['measured', 'measured', 'measured', 'follow', 'memory', 'simulated'][g.int(6)];
  const base = g.float();
  return H.entry(pc, t, a, b, (i, h) => Math.max(0, Math.min(1, base + 0.3 * (g.float() - 0.5) - (h === 'l' ? 0.2 * g.float() : 0))), {
    hands: hands, src: src, ratio: 0.3 + 0.9 * g.float(), signed: g.chance(0.5) ? Math.round(200 * (g.float() - 0.5)) : 0, abs: 20 + g.int(200)
  });
}

/* every task: bars of the piece, a hand that plays there, a ladder tempo, the app's modes, no figure in its words */
function problemsOf(task, pc, ctx, opts) {
  const P = Object.assign({}, PO.DEFAULTS, opts || {});
  const out = [];
  const ia = pc.measures.findIndex(m => m.number === task.range.start), ib = pc.measures.findIndex(m => m.number === task.range.end);
  if (ia < 0 || ib < 0) out.push('a bar that is not in the piece');
  if (!(task.range.start <= task.range.end)) out.push('a backward range');
  if (['both', 'left', 'right'].indexOf(task.hand) < 0) out.push('an unknown hand');
  if (['practice', 'memory'].indexOf(task.mode) < 0) out.push('an unknown mode');
  if (!Number.isInteger(task.tempoPercent) || task.tempoPercent < Math.min(P.floorPct, 100) || task.tempoPercent > Math.max(P.topPct, 40)) out.push('a tempo off the ladder ' + task.tempoPercent);
  if (!(task.repetitions >= 1 && task.repetitions <= 8)) out.push('repetitions ' + task.repetitions);
  if (/\d/.test(task.reason || '')) out.push('a figure in the reason');
  if (task.hand !== 'both' && ia >= 0 && ib >= ia) {
    const h = task.hand === 'left' ? 'l' : 'r';
    let k = 0;
    for (let i = ia; i <= ib; i++) k += pc.measures[i].notes[h];
    if (!k) out.push('a hand with no notes there');
  }
  if (task.mode === 'memory' && !ctx.allowed.memoryEligibleSections.some(s => task.range.start >= s.from && task.range.start <= s.to)) out.push('memory work outside the gate');
  return out;
}

async function main() {
  const t0 = Date.now();
  const L = require('../practice-sim/app-legacy.js');
  const Pieces = require('../practice-sim/pieces.js');
  const env = L.build();
  const E = env.E;
  const validate = E.Coach.validate;
  const real = await Pieces.loadAll(E);
  const realPieces = real.map(p => ({ p: p, pc: require('../practice-sim/drivers.js').pieceOf(p.score, E) }));
  const g = SIM.rng(SEED);
  const fails = [];
  const counts = { states: 0, real: 0, kinds: {}, tasks: 0, memoryTasks: 0, alone: 0, slow: 0 };
  for (let s = 0; s < N; s++) {
    let pc, ctx, app = null, score = null;
    const useReal = s % 5 === 0;
    if (useReal) {
      const rp = realPieces[g.int(realPieces.length)];
      pc = rp.pc; score = rp.p.score;
      app = env.newApp();
      app.state.score = score; app.state.loopFrom = score.measures[0].number; app.state.loopTo = score.measures[score.measures.length - 1].number;
      app.state.secs = {}; (score.sections || []).forEach(sec => { app.state.secs[sec.id] = { acc: 70, mem: 0, reps: 0 }; });
      /* a random legacy history and memory, through the app's own functions */
      let hist = E.Learning.empty(), mem = E.Memory.empty();
      const tNow = H.T0 + g.int(30) * H.DAY;
      E.Clock.now = () => tNow;
      for (let r = g.int(12); r > 0; r--) {
        const byMeasure = {};
        const a = g.int(score.measures.length), b = Math.min(score.measures.length - 1, a + g.int(8));
        let ex = 0, ht = 0;
        for (let i = a; i <= b; i++) {
          const tot = 1 + g.int(8), k = g.int(tot + 1), rt = Math.ceil(tot / 2), rk = Math.min(rt, k);
          byMeasure[score.measures[i].number] = { total: tot, matched: k, missed: tot - k, wrong: g.int(2), extra: 0, onTime: k, early: 0, late: 0, timingAbsSum: 40 * k, timingCount: k,
            hands: { r: { total: rt, matched: rk, timingAbsSum: 40 * rk, timingCount: rk }, l: { total: tot - rt, matched: k - rk, timingAbsSum: 40 * (k - rk), timingCount: k - rk } } };
          ex += tot; ht += k;
        }
        hist = E.Learning.record(hist, { byMeasure: byMeasure, accuracy: ht / ex, run: { from: score.measures[a].number, to: score.measures[b].number }, counts: { expected: ex, matched: ht, wrong: 0, extra: 0 } },
          { at: tNow - g.int(10) * H.DAY, tempo: score.tempo * (g.chance(0.5) ? 1 : 0.75), scoreTempo: score.tempo, hands: 'both' });
      }
      (score.sections || []).forEach(sec => {
        for (let r = g.int(4); r > 0; r--) mem = E.Memory.recordAttempt(mem, sec.id, { at: tNow - g.int(20) * H.DAY, level: g.int(5), hints: [], accuracy: g.float(), review: g.chance(0.3) });
      });
      app.state.history = hist; app.state.memory = mem;
      ctx = app.coachContext();
      counts.real++;
    } else {
      pc = randomPiece(g);
      ctx = randomCtx(g, pc);
    }
    const opts = randomOpts(g);
    const model = LE.create(pc);
    let t = H.T0;
    for (let k = g.int(60); k > 0; k--) { t += g.chance(0.1) ? g.int(3) * H.DAY : 10000 + g.int(60000); LE.update(model, randomEntry(g, pc, t)); }
    /* a sixth of the states: a piece practised clean (the memory and run-through branches), now and then one bar left weak */
    if (g.chance(0.17)) {
      const weakBar = g.chance(0.3) ? g.int(pc.measures.length) : -1;
      for (let k = 20 + g.int(30); k > 0; k--) { t += 20000; LE.update(model, H.entry(pc, t, 0, pc.measures.length - 1, i => (i === weakBar ? 0.3 : 1))); }
    }
    let st = PO.initState(), current = null;
    const ctxB = useReal ? ctx : (g.chance(0.3) ? randomCtx(g, pc) : ctx);
    for (let k = g.int(12); k > 0; k--) {
      t += 10000 + g.int(g.chance(0.1) ? 3 * H.DAY : 120000);
      const d = PO.decide(model, t, st, { current: current, ctx: k === 1 ? ctx : ctxB, opts: opts });
      st = d.state;
      current = g.chance(0.85) ? { from: d.task.range.start, to: d.task.range.end, hands: d.task.hand, tempoPct: d.task.tempoPercent, mode: d.task.mode } : current;
      const ia = pc.measures.findIndex(m => m.number === d.task.range.start), ib = pc.measures.findIndex(m => m.number === d.task.range.end);
      if (g.chance(0.8)) LE.update(model, H.entry(pc, t, ia, ib, () => g.float(), { ratio: d.task.tempoPercent / 100, hands: d.task.hand, src: d.task.mode === 'memory' ? 'memory' : 'measured' }));
    }
    t += 5000 + g.int(g.chance(0.2) ? 2 * H.DAY : 60000);
    counts.states++;
    const where = (useReal ? 'real ' : 'made-up ') + 'state ' + s;
    try {
      const d = PO.decide(model, t, st, { current: current, ctx: ctx, opts: opts });
      const again = PO.decide(model, t, st, { current: current, ctx: ctx, opts: opts });
      if (JSON.stringify(again) !== JSON.stringify(d)) fails.push(where + ': the same input gave another decision');
      const p = PO.plan(model, t, d.state, ctx, opts);
      const r = validate(JSON.parse(JSON.stringify(p)), ctx);
      if (!r.ok) fails.push(where + ': the plan was rejected: ' + JSON.stringify(r.issues));
      else {
        if (r.issues.length) fails.push(where + ': the plan needed repairs: ' + JSON.stringify(r.issues));
        if (JSON.stringify(r.plan.tasks) !== JSON.stringify(p.tasks)) fails.push(where + ': validate changed the tasks');
      }
      const r1 = validate({ summary: '', todayGoal: '', tasks: [JSON.parse(JSON.stringify(d.task))], coachNote: '', sessionMinutes: 15 }, ctx);
      if (!r1.ok || r1.issues.length) fails.push(where + ': the decision\'s task did not pass: ' + JSON.stringify(r1.issues));
      if (JSON.stringify(p.tasks[0]) !== JSON.stringify(d.task)) fails.push(where + ': the plan does not start with the decision\'s task');
      p.tasks.forEach(task => {
        problemsOf(task, pc, ctx, opts).forEach(x => fails.push(where + ': ' + x + ' ' + JSON.stringify(task)));
        counts.tasks++;
        if (task.mode === 'memory') counts.memoryTasks++;
        if (task.hand !== 'both') counts.alone++;
        if (task.tempoPercent < 100) counts.slow++;
      });
      counts.kinds[d.kind] = (counts.kinds[d.kind] || 0) + 1;
    } catch (e) { fails.push(where + ': threw ' + (e && e.stack || e)); }
    if (fails.length > 20) break;
  }
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  if (fails.length) {
    console.error('policy-validate: ' + fails.length + ' problem(s) in ' + counts.states + ' states:');
    fails.slice(0, 20).forEach(f => console.error('  ' + f));
    process.exit(1);
  }
  console.log('policy-validate: ' + counts.states + ' random states (' + counts.real + ' in the app\'s own page methods), ' + counts.tasks + ' tasks: every plan passed the app\'s Coach.validate with no issue; ' +
    'decisions ' + JSON.stringify(counts.kinds) + '; memory tasks ' + counts.memoryTasks + ', one-hand tasks ' + counts.alone + ', slower than the score ' + counts.slow + ' (' + secs + ' s)');
}

main().catch(e => { console.error(e); process.exit(1); });
