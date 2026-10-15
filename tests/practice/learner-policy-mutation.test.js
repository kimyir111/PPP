'use strict';
/* G11b-2: would the tests notice if the learner model, the policy or their guards got worse? Each mutant is a copy of ONE file
   with one rule broken (practice/learner.js, practice/policy.js, the simulator's driver tests/practice-sim/drivers.js, the
   evaluation's tuning guard tests/practice-sim/policy-eval.js), compiled in memory next to the real file (Module._compile with the
   real path, so its own requires resolve; nothing is written to disk), and a probe reads the one thing a person, the policy or
   the Lead would see. The real files must pass every probe (the control) and each mutant must fail its own.
   The rules broken are the ones the G11b-2 brief names: the policy ignoring uncertainty, no forgetting, a tuning-data leak, a
   Coach.validate bypass - and the rest of §7.2/§7.3. An anchor that has drifted fails loudly (it must match exactly once). */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Module = require('module');
const { piece, entry, ctxOf, DAY, MIN, T0 } = require('./learner-helpers.js');

const REPO = path.resolve(__dirname, '..', '..');
const FILES = {
  learner: path.join(REPO, 'practice', 'learner.js'),
  policy: path.join(REPO, 'practice', 'policy.js'),
  drivers: path.join(REPO, 'tests', 'practice-sim', 'drivers.js'),
  eval: path.join(REPO, 'tests', 'practice-sim', 'policy-eval.js')
};
const SRC = {};
Object.keys(FILES).forEach(k => { SRC[k] = fs.readFileSync(FILES[k], 'utf8').split('\r\n').join('\n'); });

function compile(file, text, overrides) {
  const m = new Module(file, module);
  m.filename = file;
  m.paths = Module._nodeModulePaths(path.dirname(file));
  if (overrides) { const orig = m.require.bind(m); m.require = id => (Object.prototype.hasOwnProperty.call(overrides, id) ? overrides[id] : orig(id)); }
  m._compile(text, file);
  return m.exports;
}
function mutate(which, edits) {
  let text = SRC[which];
  edits.forEach(([find, replace]) => {
    const n = text.split(find).length - 1;
    assert.equal(n, 1, which + ': the anchor ' + JSON.stringify(find.slice(0, 80)) + ' matches ' + n + ' times, not once');
    text = text.replace(find, () => replace);
  });
  return text;
}
/* the four modules, with `which` replaced by a mutant (the policy always runs on the learner of the set) */
function set(which, edits) {
  const text = k => (k === which ? mutate(k, edits) : SRC[k]);
  const LE = compile(FILES.learner, text('learner'));
  const PO = compile(FILES.policy, text('policy'), { './learner.js': LE });
  return {
    LE, PO,
    DR: () => compile(FILES.drivers, text('drivers')),
    EV: () => compile(FILES.eval, text('eval'))
  };
}

/* ---------------------------------------------------------------- probes: true = the rule holds */
const acc = (M, m, i, cond, t) => M.LE.predictMeasure(m, i, Object.assign({ ratio: 1, hands: 'both' }, cond), t);
function trained(M, pc, bar, n) {
  const m = M.LE.create(pc);
  M.LE.update(m, entry(pc, T0, bar, bar, 0.5));
  for (let k = 1; k <= n; k++) M.LE.update(m, entry(pc, T0 + k * MIN, bar, bar, 1));
  return { m: m, t: T0 + (n + 1) * MIN };
}
const P = {
  forgetPredict(M) { const pc = piece(1); const { m, t } = trained(M, pc, 0, 30); return acc(M, m, 0, {}, t) > acc(M, m, 0, {}, t + 10 * DAY) + 0.02; },
  forgetUpdate(M) {
    const pc = piece(1);
    const a = trained(M, pc, 0, 30), b = trained(M, pc, 0, 30);
    M.LE.update(a.m, entry(pc, a.t + 10 * DAY, 0, 0, 1));
    M.LE.update(b.m, entry(pc, b.t + MIN, 0, 0, 1));
    return a.m.measures[0].r.a < b.m.measures[0].r.a - 0.3;
  },
  consolidate(M) { const pc = piece(1); const m = M.LE.create(pc); M.LE.update(m, entry(pc, T0, 0, 0, 0.8)); const h = m.measures[0].r.h; M.LE.update(m, entry(pc, T0 + DAY, 0, 0, 0.8)); return m.measures[0].r.h > h; },
  simulatedRefused(M) { const pc = piece(2); const m = M.LE.create(pc); const r = M.LE.update(m, entry(pc, T0, 0, 1, 0.9, { src: 'simulated' })); return !r.ok && m.measures[0].r.runs === 0 && m.version === 0; },
  followNoSkill(M) { const pc = piece(2); const m = M.LE.create(pc); const a = m.measures[0].r.a; M.LE.update(m, entry(pc, T0, 0, 1, 0.2, { src: 'follow' })); return m.measures[0].r.a === a && m.measures[0].r.runs === 0; },
  memoryNoSkill(M) { const pc = piece(2); const m = M.LE.create(pc); const a = m.measures[0].r.a; M.LE.update(m, entry(pc, T0, 0, 1, 0.2, { src: 'memory' })); return m.measures[0].r.a === a && m.measures[0].r.runs === 0; },
  uncertainShortfall(M) {
    const pc = piece(2); const m = M.LE.create(pc);
    for (let k = 0; k < 60; k++) M.LE.update(m, entry(pc, T0 + k * MIN, 0, 0, 0.97));
    M.LE.update(m, entry(pc, T0 + 61 * MIN, 1, 1, 0.97));
    const t = T0 + 62 * MIN;
    return M.LE.shortfall(m, 1, 0.9, t) > 3 * M.LE.shortfall(m, 0, 0.9, t);
  },
  narrows(M) { const pc = piece(1); const m = M.LE.create(pc); const s0 = Math.sqrt(m.measures[0].r.vaa); for (let k = 0; k < 6; k++) M.LE.update(m, entry(pc, T0 + k * MIN, 0, 0, 0.8)); return Math.sqrt(m.measures[0].r.vaa) < 0.7 * s0; },
  tempoSign(M) {
    const pc = piece(1); const m = M.LE.create(pc);
    for (let k = 0; k < 12; k++) { M.LE.update(m, entry(pc, T0 + k * MIN, 0, 0, 1, { ratio: 0.6 })); M.LE.update(m, entry(pc, T0 + k * MIN + 1000, 0, 0, 0.4)); }
    const t = T0 + 13 * MIN;
    return acc(M, m, 0, { ratio: 0.6 }, t) > acc(M, m, 0, { ratio: 1 }, t) + 0.2;
  },
  aloneBonus(M) {
    const pc = piece(1, { r: 10, l: 10 }); const m = M.LE.create(pc);
    for (let k = 0; k < 8; k++) M.LE.update(m, entry(pc, T0 + k * MIN, 0, 0, 0.9, { hands: 'left' }));
    const z = M.LE.itemZ(m, 0, 'l', { ratio: 1, alone: false }, T0 + 9 * MIN);
    return M.LE.meanSigma(z.m, z.v) < 0.875;
  },
  poolFirst(M) {
    const pc = piece(3); const m = M.LE.create(pc);
    M.LE.update(m, entry(pc, T0, 0, 0, 0.5));
    const u = acc(M, m, 2, {}, T0 + MIN);
    for (let k = 0; k < 40; k++) M.LE.update(m, entry(pc, T0 + (k + 2) * MIN, 0, 0, 1));
    return Math.abs(acc(M, m, 2, {}, T0 + 50 * MIN) - u) < 0.02;
  },
  boxOnce(M) { const pc = piece(2); const m = M.LE.create(pc); M.LE.update(m, entry(pc, T0, 0, 1, 1)); M.LE.update(m, entry(pc, T0 + MIN, 0, 1, 1)); return m.measures[0].box === 0 && m.measures[0].due === T0 + DAY; },
  boxFail(M) { const pc = piece(2); const m = M.LE.create(pc); M.LE.update(m, entry(pc, T0, 0, 1, 1)); M.LE.update(m, entry(pc, T0 + DAY, 0, 1, 0.2)); return m.measures[0].box === -1; },
  boxSlow(M) { const pc = piece(2); const m = M.LE.create(pc); M.LE.update(m, entry(pc, T0, 0, 1, 1, { ratio: 0.5 })); return m.measures[0].box === -1; },
  merged(M) {
    const pc = piece(4); const m = M.LE.create(pc); const e = entry(pc, T0, 0, 3, 0.8);
    const R = [];
    [0, 2].forEach(mi => [0, 1].forEach(h => { const rows = e.R.filter(r => (r[0] === mi || r[0] === mi + 1) && r[1] === h); R.push([mi, h, rows.reduce((s, r) => s + r[2], 0), rows.reduce((s, r) => s + r[3], 0), 0, 40]); }));
    M.LE.update(m, Object.assign({}, e, { g: 2, R: R }));
    return m.measures.every(x => x.r.runs === 1);
  },
  timingSign(M) { const pc = piece(1); const m = M.LE.create(pc); for (let k = 0; k < 6; k++) M.LE.update(m, entry(pc, T0 + k * MIN, 0, 0, 0.9, { signed: -70, abs: 80 })); return M.LE.view(m, 0, T0 + 7 * MIN).timing.signed < -50; },
  pMasteredUncertain(M) { const pc = piece(2); const m = M.LE.create(pc); for (let k = 0; k < 10; k++) M.LE.update(m, entry(pc, T0 + k * MIN, 0, 0, 1)); const p = M.LE.view(m, 1, T0 + 11 * MIN).pMastered; return p > 0.001 && p < 0.999; },
  cleanTempoFast(M) { const pc = piece(1); const m = M.LE.create(pc); for (let k = 0; k < 30; k++) M.LE.update(m, entry(pc, T0 + k * MIN, 0, 0, 1)); return M.LE.cleanTempo(m, 0, T0 + 31 * MIN) === 1; },

  /* the policy */
  uncertainBarsChecked(M) {
    const pc = piece(8); const m = M.LE.create(pc);
    for (let k = 0; k < 60; k++) M.LE.update(m, entry(pc, T0 + k * MIN, 0, 3, 0.97));
    for (let k = 0; k < 3; k++) M.LE.update(m, entry(pc, T0 + (61 + k) * MIN, 4, 7, 1));
    const d = M.PO.decide(m, T0 + 70 * MIN, M.PO.initState(), {});
    const a = pc.measures.findIndex(x => x.number === d.task.range.start);
    return d.kind === 'focus' && a >= 4;
  },
  stability(M) {
    /* two weak bars far apart; the passage chosen first turns clean at once: the other is now worth more, and still the passage is
       kept for minDwell laps */
    const s = run(M, piece(12), { maxLen: 3 });
    const two = i => (i === 2 || i === 9 ? 0.3 : 1);
    s.step(two);
    const first = s.step(() => 1);
    for (let k = 0; k < M.PO.DEFAULTS.minDwell - 1; k++) if (JSON.stringify(s.step(() => 1).task.range) !== JSON.stringify(first.task.range)) return false;
    let moved = false;
    for (let k = 0; k < 6 && !moved; k++) moved = JSON.stringify(s.step(() => 1).task.range) !== JSON.stringify(first.task.range);
    return moved;
  },
  checkedRejects(M) {
    const pc = piece(4); const m = M.LE.create(pc); const ctx = ctxOf(pc);
    const p = M.PO.plan(m, T0, M.PO.decide(m, T0, M.PO.initState(), {}).state, ctx);
    return M.PO.checked(p, ctx, () => ({ ok: false, plan: null, issues: [{ level: 'reject' }] })).ok === false;
  },
  checkedUsesValidated(M) {
    const pc = piece(4); const m = M.LE.create(pc); const ctx = ctxOf(pc);
    const p = M.PO.plan(m, T0, M.PO.decide(m, T0, M.PO.initState(), {}).state, ctx);
    const r = M.PO.checked(p, ctx, q => ({ ok: true, plan: Object.assign({}, q, { tasks: q.tasks.map(t => Object.assign({}, t, { repetitions: 7 })) }), issues: [] }));
    return r.ok && r.plan.tasks.every(t => t.repetitions === 7);
  },
  memoryGate(M) {
    const pc = piece(8); const s = run(M, pc); cleanAll(M, s, 40);
    const closed = ctxOf(pc, { sections: [{ id: 's1', from: 1, to: 8, state: 'memory-ready' }] });
    return M.PO.decide(s.m, s.t, M.PO.initState(), { ctx: closed }).task.mode !== 'memory';
  },
  memoryRecheck(M) {
    const pc = piece(8); const s = run(M, pc); cleanAll(M, s, 40);
    const sec = { id: 's1', from: 1, to: 8, state: 'memory-ready' };
    const open = ctxOf(pc, { eligible: [{ from: 1, to: 8 }], sections: [sec] }), closed = ctxOf(pc, { sections: [sec] });
    const d = M.PO.decide(s.m, s.t, M.PO.initState(), { ctx: open });
    if (d.task.mode !== 'memory') return false;
    return M.PO.decide(s.m, s.t + MIN, d.state, { current: cur(d.task), ctx: closed }).task.mode !== 'memory';
  },
  planMemoryGate(M) {
    const pc = piece(8); const s = run(M, pc); cleanAll(M, s, 40);
    const sec = { id: 's1', from: 1, to: 8, state: 'memory-ready' };
    const d = M.PO.decide(s.m, s.t, M.PO.initState(), { ctx: ctxOf(pc, { eligible: [{ from: 1, to: 8 }], sections: [sec] }) });
    if (d.task.mode !== 'memory') return false;
    return M.PO.plan(s.m, s.t, d.state, ctxOf(pc, { sections: [sec] })).tasks.every(t => t.mode !== 'memory');
  },
  severeFirst(M) {
    const pc = piece(8); const s = run(M, pc); cleanAll(M, s, 20);
    for (let k = 0; k < 10; k++) M.LE.update(s.m, entry(pc, s.t + k, 3, 3, 0.1));
    const due = ctxOf(pc, { eligible: [{ from: 1, to: 8 }], sections: [{ id: 's1', from: 1, to: 8, state: 'due' }], due: [{ id: 's1', from: 1, to: 8, daysOverdue: 1 }] });
    return M.PO.decide(s.m, s.t + 20, M.PO.initState(), { ctx: due }).task.mode === 'practice';
  },
  tempoCap(M) { const s = ladder(M, { stepUp: 33 }); let hi = 0; for (let k = 0; k < 40; k++) hi = Math.max(hi, s.step(() => 1).task.tempoPercent); return hi <= 100; },
  tempoFloor(M) { const s = ladder(M, { stepDown: 33 }); let lo = 100; for (let k = 0; k < 40; k++) lo = Math.min(lo, s.step(() => 0.02).task.tempoPercent); return lo >= 40; },
  stepDown(M) { const s = ladder(M, {}); const p0 = s.step(() => 0.05).task.tempoPercent; let lo = p0; for (let k = 0; k < 6; k++) lo = Math.min(lo, s.step(() => 0.05).task.tempoPercent); return lo < p0 || p0 === 40; },
  suggestion(M) { const s = ladder(M, {}); for (let k = 0; k < 6; k++) { const d = s.step(() => 1); if (d.suggestion) return true; } return false; },
  aloneWeakThenBoth(M) {
    const s = run(M, piece(4), { maxLen: 4 });
    const lefty = (i, h) => (h === 'l' ? 0.3 : 1);
    s.step(lefty);
    const d = s.step(lefty);
    if (d.task.hand !== 'left') return false;
    let last = d;
    for (let k = 0; k < M.PO.DEFAULTS.aloneLaps; k++) last = s.step(lefty);
    return last.task.hand === 'both';
  },
  reviewAtSession(M) { const pc = piece(8); const s = run(M, pc); cleanAll(M, s, 3); s.step(() => 1); s.t += DAY; return s.step(() => 1).kind === 'review'; },
  readFirst(M) { const s = run(M, piece(12)); const d = s.step(null); return d.kind === 'read' && d.task.range.start === 1 && d.task.range.end === 12; },
  stuck(M) {
    const s = run(M, piece(6), { maxLen: 2, review: false });
    for (let day = 0; day < 5; day++) { for (let k = 0; k < 8; k++) if (s.step(i => (i === 0 ? 0.05 : 1)).stuck) return true; s.t += DAY; }
    return false;
  },
  pure(M) {
    const s = run(M, piece(10));
    for (let k = 0; k < 6; k++) s.step(i => 0.4 + 0.06 * i);
    const before = JSON.stringify(s.st);
    M.PO.decide(s.m, s.t + DAY, s.st, { current: s.current });
    return JSON.stringify(s.st) === before;
  },
  shortWindow(M) {
    const pc = piece(16); const m = M.LE.create(pc);
    for (let k = 0; k < 30; k++) M.LE.update(m, entry(pc, T0 + k * MIN, 0, 15, i => (i === 8 ? 0.3 : 1)));
    const d = M.PO.decide(m, T0 + 31 * MIN, M.PO.initState(), {});
    const a = pc.measures.findIndex(x => x.number === d.task.range.start), b = pc.measures.findIndex(x => x.number === d.task.range.end);
    return d.kind === 'focus' && a <= 8 && b >= 8 && b - a + 1 <= 6;
  },

  /* the evaluation's guards */
  tuneGuardPieces(M) { try { M.EV().assertTuning([{ piece: 'beyer-060', k: 0 }]); return false; } catch (e) { return /hold-out piece/.test(e.message); } },
  tuneGuardSeeds(M) { try { M.EV().assertTuning([{ piece: 'beyer-050', k: 100 }]); return false; } catch (e) { return /hold-out seed/.test(e.message); } },
  tuneSet(M) {
    const EV = M.EV();
    const jobs = EV.jobsFor('tune', { arms: ['policy'], seeds: 100 });
    const pieces = new Set(jobs.map(j => j.piece));
    return jobs.length === 4 * 6 * 100 && pieces.size === 4 && [...pieces].every(id => /^(beyer-050|czerny599-010|burgmuller-001|hymn-amazing-grace)$/.test(id)) && jobs.every(j => j.k < 100);
  },
  holdoutOnce(M) {
    const EV = M.EV();
    return typeof EV.holdoutRefusal({ params: { hash: 'aaa', source: 's' } }, { hash: 'bbb', source: 's' }) === 'string' &&
      typeof EV.holdoutRefusal({ params: { hash: 'aaa', source: 's' } }, { hash: 'aaa', source: 't' }) === 'string' &&
      EV.holdoutRefusal({ params: { hash: 'aaa', source: 's' } }, { hash: 'aaa', source: 's' }) === null;
  },

  /* the simulator's policy arm plays only what Coach.validate returned */
  driverPlaysValidated(M) {
    const { drv, app, applied } = fakeDriver(M, q => ({ ok: true, plan: Object.assign({}, q, { tasks: q.tasks.map(t => Object.assign({}, t, { tempoPercent: 77 })) }), issues: [] }));
    const changed = drv.step({ app: app, E: app.E, now: T0, day: 0, first: true });
    return changed === true && applied.length === 1 && applied[0].tempo === 77 && drv.current.tempoPct === 77;
  },
  driverRejected(M) {
    let out;
    try {
      const { drv, app, applied } = fakeDriver(M, () => ({ ok: false, plan: null, issues: [{ level: 'reject' }] }));
      out = drv.step({ app: app, E: app.E, now: T0, day: 0, first: true }) === false && applied.length === 0 && drv.p.rejected === 1;
    } catch (e) { out = false; }
    return out;
  }
};

/* a person who does what the policy says (as in policy.test.js) */
const cur = t => ({ from: t.range.start, to: t.range.end, hands: t.hand, tempoPct: t.tempoPercent, mode: t.mode });
function run(M, pc, opts) {
  const s = { pc: pc, m: M.LE.create(pc), st: M.PO.initState(), t: T0, current: null };
  s.step = (fn) => {
    const d = M.PO.decide(s.m, s.t, s.st, { current: s.current, opts: opts });
    s.st = d.state; s.current = cur(d.task);
    const a = pc.measures.findIndex(x => x.number === d.task.range.start), b = pc.measures.findIndex(x => x.number === d.task.range.end);
    if (fn) M.LE.update(s.m, entry(pc, s.t, a, b, fn, { ratio: d.task.tempoPercent / 100, hands: d.task.hand, src: d.task.mode === 'memory' ? 'memory' : 'measured' }));
    s.t += 0.5 * MIN;
    return d;
  };
  return s;
}
function cleanAll(M, s, n) { for (let i = 0; i < n; i++) M.LE.update(s.m, entry(s.pc, s.t - 1000 * (n - i), 0, s.pc.measures.length - 1, 1)); }
/* a focus that starts slow: bars 1-2 lost at the score tempo, clean at half */
function ladder(M, opts) {
  const pc = piece(4);
  const s = run(M, pc, Object.assign({ maxLen: 2 }, opts));
  s.step(i => (i < 2 ? 0.2 : 1));
  for (let k = 0; k < 6; k++) M.LE.update(s.m, entry(pc, s.t - 1000 + k, 0, 1, 0.15));
  for (let k = 0; k < 6; k++) M.LE.update(s.m, entry(pc, s.t - 500 + k, 0, 1, 1, { ratio: 0.5 }));
  s.step(null);
  return s;
}
function fakeDriver(M, validate) {
  const DR = M.DR();
  const pc = piece(6);
  const drv = new DR.PolicyDriver({});
  drv.model = M.LE.create(pc); drv.state = M.PO.initState(); drv.current = null; drv.c = { scoreTempo: 100 };
  const applied = [];
  const app = {
    state: {}, setState(p) { Object.assign(this.state, p); }, applyRecommendation(r) { applied.push(r); },
    coachContext() { return ctxOf(pc); }, E: { Coach: { validate: validate } }
  };
  return { drv, app, applied };
}

/* ---------------------------------------------------------------- the mutants */
const MUTANTS = [
  { id: 'CONTROL', file: 'policy', edits: [['  const VERSION = 1;\n  const MIN = 60000;', '  const VERSION = 1; /* control */\n  const MIN = 60000;']], probes: Object.keys(P), control: true },
  /* the learner (§7.2) */
  { id: 'L-NO-FORGET-PREDICT', why: 'no forgetting in a prediction', file: 'learner', edits: [['if (it.b != null) a = it.b + (a - it.b) * Math.pow(2, -dd / it.h);', 'if (it.b != null) a = a;']], probes: ['forgetPredict'] },
  { id: 'L-NO-FORGET-UPDATE', why: 'no forgetting before an update', file: 'learner', edits: [['if (it.b != null) it.a = it.b + (it.a - it.b) * Math.pow(2, -dd / it.h);', 'if (it.b != null) it.a = it.a;']], probes: ['forgetUpdate'] },
  { id: 'L-BASE-FOLLOWS', why: 'the floor of forgetting follows the skill (nothing is ever forgotten)', file: 'learner', edits: [['if (it.b == null) it.b = it.a;', 'it.b = it.a;']], probes: ['forgetPredict'] },
  { id: 'L-NO-CONSOLIDATE', why: 'a new day of practice does not slow forgetting', file: 'learner', edits: [['it.h = Math.min(P.hMax, it.h * (1 + P.consolidate));', 'it.h = it.h;']], probes: ['consolidate'] },
  { id: 'L-SIM-ACCEPTED', why: 'a Demo Input run is taken as evidence (G11-D5, U4)', file: 'learner', edits: [["if (entry.src === 'simulated') return refuse('simulated');", ''], ['const SRC_OK = { measured: 1, follow: 1, memory: 1 };', 'const SRC_OK = { measured: 1, follow: 1, memory: 1, simulated: 1 };']], probes: ['simulatedRefused'] },
  { id: 'L-FOLLOW-AS-MEASURED', why: 'a Follow run moves the playing skill', file: 'learner', edits: [["if (entry.src === 'follow') { m.fol[hand].k += kj; m.fol[hand].e += ej; return; }", "if (entry.src === 'follow') { m.fol[hand].k += kj; m.fol[hand].e += ej; }"]], probes: ['followNoSkill'] },
  { id: 'L-MEMORY-AS-MEASURED', why: 'a recall with hidden notes moves the playing skill', file: 'learner', edits: [['          m.rec = r;\n          return;', '          m.rec = r;']], probes: ['memoryNoSkill'] },
  { id: 'L-SHORTFALL-MEAN-ONLY', why: 'the shortfall ignores the uncertainty', file: 'learner', edits: [['const f = ignoreUncertainty ? Math.max(0, target - sigma(z.m)) : expect(z.m, z.v, y => Math.max(0, target - sigma(y)));', 'const f = Math.max(0, target - sigma(z.m));']], probes: ['uncertainShortfall', 'uncertainBarsChecked'] },
  { id: 'L-NO-NARROWING', why: 'evidence never narrows the belief', file: 'learner', edits: [['it.vaa = h11 / det; it.vat = -h01 / det; it.vtt = h00 / det;', '']], probes: ['narrows'] },
  { id: 'L-TEMPO-SIGN', why: 'slowing down is read the wrong way round', file: 'learner', edits: [['const x = ratio == null ? 0 : 1 - Math.pow(ratio, P.gamma);', 'const x = ratio == null ? 0 : Math.pow(ratio, P.gamma) - 1;']], probes: ['tempoSign'] },
  { id: 'L-ALONE-AS-BOTH', why: 'one hand alone is read as that hand with both hands', file: 'learner', edits: [['const c = alone ? P.aloneBonus : 0;', 'const c = 0;']], probes: ['aloneBonus'] },
  { id: 'L-POOL-TRAINED', why: 'a bar nobody played borrows what practice made of the others', file: 'learner', edits: [['sa += it.b; st += it.t; n++;', 'sa += decayed(P, it, t).a; st += it.t; n++;']], probes: ['poolFirst'] },
  { id: 'L-BOX-EVERY-RUN', why: 'every clean run promotes a review box (no spacing)', file: 'learner', edits: [['if (m.box < 0 || (m.due != null && at >= m.due)) {', 'if (true) {']], probes: ['boxOnce'] },
  { id: 'L-BOX-NO-FAIL', why: 'a failed run keeps its review box', file: 'learner', edits: [['} else if (acc < P.failAcc) { m.box = -1; m.due = null; }', '}']], probes: ['boxFail'] },
  { id: 'L-BOX-SLOW', why: 'a clean run at half the tempo counts as a check of the bar', file: 'learner', edits: [["if (hands === 'b' && ratio != null && ratio >= P.cleanRatio - 1e-9) {", "if (hands === 'b' && ratio != null) {"]], probes: ['boxSlow'] },
  { id: 'L-MERGED-ROW', why: 'a merged row of a long lap lands on its first measure only', file: 'learner', edits: [['for (let j = mi0; j < Math.min(n, mi0 + g); j++) if (j >= 0) span.push(j);', 'for (let j = mi0; j < Math.min(n, mi0 + 1); j++) if (j >= 0) span.push(j);']], probes: ['merged'] },
  { id: 'L-TIMING-UNSIGNED', why: 'rushing and dragging look the same', file: 'learner', edits: [['it.ts += (+row[4] - it.ts) * w;', 'it.ts += (Math.abs(+row[4]) - it.ts) * w;']], probes: ['timingSign'] },
  { id: 'L-PMASTERED-MEAN-ONLY', why: 'P(mastered) ignores the uncertainty', file: 'learner', edits: [['p *= phi((z.m - zc) / Math.sqrt(z.v));', 'p *= z.m >= zc ? 1 : 0;']], probes: ['pMasteredUncertain'] },
  { id: 'L-CLEANTEMPO-SLOWEST', why: 'cleanTempo is the slowest clean step, not the fastest', file: 'learner', edits: [['for (let s = 100; s >= 40; s -= 5) {', 'for (let s = 40; s <= 100; s += 5) {']], probes: ['cleanTempoFast'] },
  /* the policy (§7.3) */
  { id: 'P-IGNORE-UNCERTAINTY', why: 'the policy reads the model\'s means only', file: 'policy', edits: [['const snap = snapshot(model, t, P, L, !!io.ignoreUncertainty);', 'const snap = snapshot(model, t, P, L, true);']], probes: ['uncertainBarsChecked'] },
  { id: 'P-NO-DWELL', why: 'the passage may change after every lap (advice that flips)', file: 'policy', edits: [['if (!stepped && f.laps >= P.minDwell) {', 'if (!stepped && f.laps >= 1) {']], probes: ['stability'] },
  { id: 'P-VALIDATE-BYPASS', why: 'a plan is used without Coach.validate', file: 'policy', edits: [['const r = validate(JSON.parse(JSON.stringify(p)), ctx);', 'const r = { ok: true, plan: p, issues: [] };']], probes: ['checkedRejects', 'checkedUsesValidated'] },
  { id: 'P-VALIDATE-IGNORED', why: 'the plan used is not the one Coach.validate returned', file: 'policy', edits: [['return { ok: true, plan: r.plan, issues: r.issues || [] };', 'return { ok: true, plan: p, issues: r.issues || [] };']], probes: ['checkedUsesValidated'] },
  { id: 'P-MEMORY-NO-GATE', why: 'memory work without the app\'s Memory.eligible gate', file: 'policy', edits: [["const sec = (ctx.memory.sections || []).filter(s => (s.state === 'memory-ready' || s.state === 'memorizing') && ok.some(g => s.from >= g.from && s.from <= g.to))[0];", "const sec = (ctx.memory.sections || []).filter(s => (s.state === 'memory-ready' || s.state === 'memorizing'))[0];"]], probes: ['memoryGate'] },
  { id: 'P-MEMORY-NO-RECHECK', why: 'a memory task is kept after its gate closed', file: 'policy', edits: [["else if (f.mode === 'memory' && (!ctxOf || !memoryOpen(ctxOf(), f.from))) f = null;", '']], probes: ['memoryRecheck'] },
  { id: 'P-PLAN-MEMORY-NO-GATE', why: 'the plan offers memory work the gate does not allow', file: 'policy', edits: [["for (let i = tasks.length - 1; i >= 0; i--) if (tasks[i].mode === 'memory' && !memoryOpen(ctx, tasks[i].range.start)) tasks.splice(i, 1);", '']], probes: ['planMemoryGate'] },
  { id: 'P-SEVERE-IGNORED', why: 'a memory review beats a severe technical weakness', file: 'policy', edits: [['    if (!severe) {\n      const due', '    if (true) {\n      const due']], probes: ['severeFirst'] },
  { id: 'P-TEMPO-OVER-TOP', why: 'the ladder goes past the score tempo', file: 'policy', edits: [['f.pct = Math.min(P.topPct, f.pct + P.stepUp);', 'f.pct = f.pct + P.stepUp;']], probes: ['tempoCap'] },
  { id: 'P-TEMPO-UNDER-FLOOR', why: 'the ladder goes below 40 %', file: 'policy', edits: [['f.pct = Math.max(P.floorPct, f.pct - P.stepDown);', 'f.pct = f.pct - P.stepDown;']], probes: ['tempoFloor'] },
  { id: 'P-NO-STEP-DOWN', why: 'two lost laps never slow the tempo', file: 'policy', edits: [['else if (f.down >= P.downLaps && f.pct > P.floorPct) {', 'else if (false) {']], probes: ['stepDown'] },
  { id: 'P-NOT-A-SUGGESTION', why: 'a tempo step is not marked as a suggestion (U6: the automatic step is off)', file: 'policy', edits: [["suggestion: changed && stepped === 'tempo' && !P.autoTempo,", 'suggestion: false,']], probes: ['suggestion'] },
  { id: 'P-ALONE-FOREVER', why: 'hands separately never comes back to both hands', file: 'policy', edits: [["if (f.alone > 0 && f.hands !== 'both' && f.laps >= f.alone) {", 'if (false) {']], probes: ['aloneWeakThenBoth'] },
  { id: 'P-ALONE-STRONG-HAND', why: 'the stronger hand is the one practised alone', file: 'policy', edits: [["hands = r.acc < l.acc ? 'right' : 'left';", "hands = r.acc < l.acc ? 'left' : 'right';"]], probes: ['aloneWeakThenBoth'] },
  { id: 'P-NO-REVIEW', why: 'no spaced re-check of the bars that are due', file: 'policy', edits: [['if (newSession && P.review) {', 'if (false) {']], probes: ['reviewAtSession'] },
  { id: 'P-NO-SESSION', why: 'a new day is not a new session', file: 'policy', edits: [['const newSession = st.lastAt == null || t - st.lastAt >= P.sessionGapMin * MIN;', 'const newSession = st.lastAt == null;']], probes: ['reviewAtSession'] },
  { id: 'P-NO-READING', why: 'no first reading of an unplayed piece', file: 'policy', edits: [['if (P.readShare < 1) {', 'if (false) {']], probes: ['readFirst'] },
  { id: 'P-NO-STUCK', why: 'a stuck passage is never flagged', file: 'policy', edits: [['if (rec.sessions.length >= P.stuckSessions && f.pct <= P.stuckPct', 'if (rec.sessions.length >= 99 && f.pct <= P.stuckPct']], probes: ['stuck'] },
  { id: 'P-STATE-MUTATED', why: 'a decision writes into the state it was given', file: 'policy', edits: [['const st = cloneState(st0);', 'const st = st0 || initState();']], probes: ['pure'] },
  { id: 'P-VALUE-IGNORES-TIME', why: 'a passage is chosen by how much is wrong, not how much per second (whole-piece loops on one bad bar)', file: 'policy', edits: [['const v = s / (d + P.lapSec + (same ? 0 : P.changeSec));', 'const v = s;']], probes: ['shortWindow'] },
  /* the tuning guard (the hold-out set is never tuned on) */
  { id: 'G-TUNE-HOLDOUT-PIECE', why: 'a hold-out piece is let into the tuning set', file: 'eval', edits: [["if (split.get(j.piece) !== 'tune') throw new Error('policy-eval: ' + j.piece + ' is a hold-out piece: not in the tuning set');", '']], probes: ['tuneGuardPieces'] },
  { id: 'G-TUNE-HOLDOUT-SEED', why: 'a hold-out seed is let into the tuning set', file: 'eval', edits: [["if (!(j.k >= 0 && j.k < TUNE_K)) throw new Error('policy-eval: seed k = ' + j.k + ' is a hold-out seed: not in the tuning set');", '']], probes: ['tuneGuardSeeds'] },
  { id: 'G-TUNE-ALL-PIECES', why: 'the tuning set is made of every piece', file: 'eval', edits: [["pieces = P.PIECES.filter(p => p.split === 'tune').map(p => p.id);", 'pieces = P.PIECES.map(p => p.id);']], probes: ['tuneSet'] },
  { id: 'G-HOLDOUT-AGAIN', why: 'the hold-out set may be reported again with re-tuned parameters', file: 'eval', edits: [['if (old.params.hash === cur.hash && (!old.params.source || old.params.source === cur.source)) return null;', 'return null;']], probes: ['holdoutOnce'] },
  { id: 'G-HOLDOUT-SOURCE', why: 'the hold-out set may be reported again on changed code with the same numbers', file: 'eval', edits: [['(!old.params.source || old.params.source === cur.source)', 'true']], probes: ['holdoutOnce'] },
  /* the simulator's policy arm and the only door */
  { id: 'D-PLAYS-UNVALIDATED', why: 'the simulated person plays the task as the policy wrote it, not as Coach.validate returned it', file: 'drivers', edits: [['    const t = ok.plan.tasks[0];\n    if (JSON.stringify(t) !== JSON.stringify(d.task)) this.p.firstDiffers++;', '    const t = d.task;\n    if (JSON.stringify(t) !== JSON.stringify(d.task)) this.p.firstDiffers++;']], probes: ['driverPlaysValidated'] },
  { id: 'D-PLAYS-REJECTED', why: 'a plan Coach.validate rejected is played anyway', file: 'drivers', edits: [['    if (!ok.ok) { this.p.rejected++; return false; }\n    if (ok.issues.length) this.p.repaired++;\n    const t = ok.plan.tasks[0];\n    if (JSON.stringify(t)', '    if (!ok.ok) { this.p.rejected++; }\n    if (ok.issues.length) this.p.repaired++;\n    const t = ok.plan.tasks[0];\n    if (JSON.stringify(t)']], probes: ['driverRejected'] }
];

const safe = (fn, M) => { try { return !!fn(M); } catch (e) { return false; } };

test('the control: the real files pass every probe (and a comment changes nothing)', () => {
  const M = set('policy', MUTANTS[0].edits);
  Object.keys(P).forEach(name => assert.equal(safe(P[name], M), true, 'probe ' + name));
});

test('at least 25 mutants, every probe used, every rule the brief names among them', () => {
  const ids = MUTANTS.filter(x => !x.control).map(x => x.id);
  assert.ok(ids.length >= 25, ids.length + ' mutants');
  const used = new Set(MUTANTS.filter(x => !x.control).reduce((a, x) => a.concat(x.probes), []));
  Object.keys(P).forEach(name => assert.ok(used.has(name), 'probe ' + name + ' guards no mutant'));
  ['P-IGNORE-UNCERTAINTY', 'L-NO-FORGET-PREDICT', 'G-TUNE-HOLDOUT-PIECE', 'G-TUNE-HOLDOUT-SEED', 'P-VALIDATE-BYPASS'].forEach(id => assert.ok(ids.indexOf(id) >= 0, id));
});

MUTANTS.filter(x => !x.control).forEach(mu => {
  test(mu.id + ': ' + mu.why, () => {
    const M = set(mu.file, mu.edits);
    const caught = mu.probes.filter(name => !safe(P[name], M));
    assert.ok(caught.length > 0, 'not noticed by ' + mu.probes.join(', '));
  });
});
